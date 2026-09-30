/**
 * 球员生命周期引擎（Simulation Core）。
 * 层级归属：Simulation Core。纯逻辑，**不依赖 DOM / 存储 / UI**。
 *
 * 规范来源：DECISIONS D-17、SIMULATION_SPEC §23（第 19 步）。
 * 职责：
 *   1) 退役判定（年龄软区间线性概率 + 硬上限强制；RNG 可复现）
 *   2) 退役归档（写入 `runtime.retired`，保留职业统计与终值快照）
 *   3) 新生代生成（同位置静态模板 + 三路独立有界抖动；ID 独立命名空间）
 *   4) 人口补位（Step 26B：World 最低边界 + Club 阵容边界/位置最低保障；不再恢复到固定人数）
 *
 * 红线：
 * - **不改 `state.static`**（静态库只读）；新生代落于 `runtime.generated`。
 * - 退役 playerId **永久失效、永不复用**；新生代用 `ply_g_<seq>` 独立命名空间。
 * - 分布**平稳**：模板取自不可变 static + 有界零均值抖动 → 无逐代漂移。
 * - 全部随机为项目 deterministic RNG；`ENABLED=false` 时完全跳过（结构不变）。
 */

import {
  RETIREMENT_CONFIG,
  GENERATION_CONFIG,
  ROSTER_CONFIG,
  WORLD_MIN_POPULATION,
} from './sim-config.js';
import { createRng, hashSeed } from './rng.js';
import { ageOn } from './date-utils.js';
import {
  PLAYER_ATTRIBUTES,
  PLAYER_PERSONALITY_KEYS,
  ATTRIBUTE_DEFAULT,
} from '../shared/football-schema.js';
import {
  getWorldPlayers,
  getTeamPlayers,
  getPlayerRuntime,
  createPlayerRuntime,
} from './player-runtime.js';
import { addPlayerMembership, removePlayerMembership } from './membership.js';
import { getPlayerContract, terminateContract } from './contract.js';
import { recordEvent } from './game-state.js';

const C = RETIREMENT_CONFIG;
const G = GENERATION_CONFIG;

/** 整数夹取。 */
function clampInt(value, min, max) {
  const v = Math.round(Number(value));
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

/** 有界零均值抖动（返回浮点，由调用方取整）。 */
function jitter(rng, magnitude) {
  return (rng.next() * 2 - 1) * magnitude;
}

/** 软区间线性退役概率；软区间外 0，硬上限 1。 */
export function retireProbability(age, curve) {
  if (!curve || !Number.isFinite(age)) return 0;
  if (age >= curve.hardCap) return 1;
  if (age < curve.softStart) return 0;
  const span = curve.hardCap - curve.softStart + 1;
  return Math.min(1, (age - curve.softStart + 1) / span);
}

/** 阵容缓冲球员的位置补充顺序（确定性；仅用于「位置保障已满足但人数仍低于下限」时）。 */
const EXTRA_POSITION_ORDER = ['DF', 'MF', 'FW', 'GK'];

/** 统计某俱乐部的活跃球员位置分布。 */
function clubPositionCounts(state, clubId) {
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const player of getTeamPlayers(state, clubId)) {
    if (counts[player.position] != null) counts[player.position] += 1;
  }
  return counts;
}

/** 某俱乐部「位置最低保障」缺口（确定性顺序：GK → DF → MF → FW）。 */
function positionMinimumNeeds(counts) {
  const needs = [];
  const gkNeed = Math.max(0, ROSTER_CONFIG.MIN_GK - counts.GK);
  for (let i = 0; i < gkNeed; i += 1) needs.push('GK');
  for (const position of ['DF', 'MF', 'FW']) {
    const min = ROSTER_CONFIG.MIN_BY_POSITION[position] ?? 0;
    const need = Math.max(0, min - counts[position]);
    for (let i = 0; i < need; i += 1) needs.push(position);
  }
  return needs;
}

/**
 * 评估整个世界的人口健康（**只读**、确定性、无随机）。
 * 职责分离（Step 26B / D16）：
 * - **World Population**：回答「整个世界是否缺人」——`worldActive < 有效世界下限`；
 * - **Club Roster**：回答「某俱乐部是否低于阵容边界或位置最低保障」。
 * 说明：**不再读取 `runtime.populationTarget`**（其已退出人口业务逻辑，仅作 legacy 快照）。
 * @returns {{worldActive:number, worldMin:number, worldDeficit:number,
 *            clubs:Record<string,{count:number,byPosition:object,needs:string[],
 *                             deficit:boolean,overCap:boolean}>}}
 */
export function evaluatePopulationHealth(state) {
  const clubs = {};
  for (const clubId of Object.keys(state.runtime.clubs)) {
    const counts = clubPositionCounts(state, clubId);
    const total = counts.GK + counts.DF + counts.MF + counts.FW;
    const needs = positionMinimumNeeds(counts);
    // 位置保障满足后仍低于人数下限 → 追加阵容缓冲球员（确定性顺序；不恢复固定人数）。
    const buffer = Math.max(0, ROSTER_CONFIG.MIN_PLAYERS - (total + needs.length));
    for (let i = 0; i < buffer; i += 1) {
      needs.push(EXTRA_POSITION_ORDER[i % EXTRA_POSITION_ORDER.length]);
    }
    clubs[clubId] = {
      count: total,
      byPosition: { ...counts },
      needs,
      deficit: needs.length > 0,
      overCap: total > ROSTER_CONFIG.MAX_PLAYERS,
    };
  }
  const worldActive = getWorldPlayers(state).length;
  const clubCount = Object.keys(state.runtime.clubs).length;
  // 有效世界下限 = min(MVP 基线, 实际俱乐部数 × 阵容下限)，避免小规模自定义世界被强制膨胀到 MVP 规模。
  const worldMin = Math.min(WORLD_MIN_POPULATION, clubCount * ROSTER_CONFIG.MIN_PLAYERS);
  return { worldActive, worldMin, worldDeficit: Math.max(0, worldMin - worldActive), clubs };
}

/** 取球员基础属性向量。 */
function pickAttributes(entity) {
  const out = {};
  for (const attr of PLAYER_ATTRIBUTES) out[attr] = entity[attr];
  return out;
}

/** 归档一名退役球员（保留职业统计与终值快照），并移出 active。 */
function archiveRetired(state, player, season) {
  const rt = getPlayerRuntime(state, player.id);
  const age = player.birthDate ? ageOn(player.birthDate, state.currentDate) : null;
  // 合同地基（Step 25 / D11）：先取终值快照（**复制**，不与活动合同共享引用），再终止合同。
  const contract = getPlayerContract(state, player.id);
  state.runtime.retired[player.id] = {
    playerId: player.id,
    retiredSeason: season,
    lastTeamId: player.teamId ?? null,
    generated: Boolean(player.generated),
    profile: {
      name: player.name,
      position: player.position,
      birthDate: player.birthDate,
      attributes: pickAttributes(player),
      potential: { ...(player.potential ?? {}) },
      personality: { ...(player.personality ?? {}) },
    },
    career: rt ? { ...rt.stats.career } : { appearances: 0, minutes: 0, goals: 0, assists: 0 },
    finalDeltas: rt ? { ...rt.ability.deltas } : {},
    // 最终合同快照（无合同时为 null；退役者不得再持有 active contract）。
    contract: contract ? { ...contract } : null,
  };
  // 退役者不得持有任何合同（不存在合同时安全返回 null，不抛异常）。
  terminateContract(state, player.id);
  delete state.runtime.players[player.id];
  if (state.runtime.generated[player.id]) delete state.runtime.generated[player.id];
  // 退役者移出运行期成员关系（active membership 不得含退役球员；G0）。
  removePlayerMembership(state, player.id);
  recordEvent(state, 'player_retired', {
    playerId: player.id,
    season,
    age,
    teamId: player.teamId ?? null,
  });
}

/**
 * 处理本季退役。返回退役 playerId 列表。
 * 确定性：每名球员独立 RNG（种子含 worldId + 'retire' + season + playerId）。
 */
export function processRetirements(state, season) {
  const out = [];
  for (const player of getWorldPlayers(state)) {
    const curve = C.CURVES[player.position];
    if (!curve) continue;
    const age = player.birthDate ? ageOn(player.birthDate, state.currentDate) : 0;
    const pRet = retireProbability(age, curve);
    if (pRet <= 0) continue;
    if (age < curve.hardCap) {
      const rng = createRng(hashSeed(`${state.worldId}|retire|${season}|${player.id}`));
      if (rng.next() >= pRet) continue;
    }
    archiveRetired(state, player, season);
    out.push(player.id);
  }
  return out;
}

/**
 * 生成一名新生代球员并初始化其运行时状态。
 * @param {{position: string, teamId: string, season: number, fromSeason: number}} ctx
 *   season = 所属新赛季；fromSeason = 刚结束的赛季（用于首次成长时机）。
 */
export function generatePlayer(state, ctx) {
  const sequence = state.runtime.nextGeneratedSeq;
  const id = `${G.ID_PREFIX}${String(sequence).padStart(G.ID_PAD, '0')}`;
  const rng = createRng(hashSeed(`${state.worldId}|gen|${ctx.season}|${sequence}`));

  // 同位置静态模板（不可变）；无同位置时回退全体。
  const samePos = state.static.players.filter((p) => p.position === ctx.position);
  const pool = samePos.length > 0 ? samePos : state.static.players;
  const template = pool[Math.floor(rng.next() * pool.length)];

  const attributes = {};
  const potential = {};
  for (const attr of PLAYER_ATTRIBUTES) {
    const tBase = Number.isFinite(Number(template[attr])) ? Number(template[attr]) : ATTRIBUTE_DEFAULT;
    const base = clampInt(tBase + jitter(rng, G.BASE_JITTER), 1, 99);
    const rawHead = Number.isFinite(Number(template.potential?.[attr]))
      ? Number(template.potential[attr]) - tBase
      : 0;
    const head = clampInt(
      Math.max(0, rawHead) + jitter(rng, G.HEADROOM_JITTER),
      0,
      G.MAX_HEADROOM,
    );
    attributes[attr] = base;
    potential[attr] = clampInt(base + head, base, 99); // 保证 base ≤ potential ≤ 99
  }

  const personality = {};
  for (const key of PLAYER_PERSONALITY_KEYS) {
    const src = Number.isFinite(Number(template.personality?.[key]))
      ? Number(template.personality[key])
      : ATTRIBUTE_DEFAULT;
    personality[key] = clampInt(src + jitter(rng, G.PERSONALITY_JITTER), 1, 99);
  }

  const age = G.AGE_MIN + Math.floor(rng.next() * (G.AGE_MAX - G.AGE_MIN + 1));
  const birthDate = `${Number(state.currentDate.slice(0, 4)) - age}-01-15`;

  state.runtime.generated[id] = {
    playerId: id,
    name: `Player g${String(sequence).padStart(G.ID_PAD, '0')}`,
    teamId: ctx.teamId, // 兼容镜像（denormalized）；归属真相源为 membership
    position: ctx.position,
    birthDate,
    attributes,
    potential,
    personality,
    generatedSeason: ctx.season,
    sequence,
  };

  // 运行期成员关系（G0）：与 generated 写入在同一次生命周期事件内保持一致。
  addPlayerMembership(state, id, ctx.teamId);

  // 运行时状态：默认 vitals / 健康 / 空伤病史。
  const rt = createPlayerRuntime(id, { seasonNumber: ctx.season });
  // 首次成长时机：属于下一赛季，首次成长发生在其**完整赛季结束后**的那次 rollover。
  // 显式设为"刚结束的赛季"，而**不是 0**（见 D-17）。
  rt.growth.lastEvaluatedSeason = ctx.fromSeason;
  state.runtime.players[id] = rt;

  state.runtime.nextGeneratedSeq = sequence + 1;
  recordEvent(state, 'player_generated', {
    playerId: id,
    season: ctx.season,
    position: ctx.position,
    teamId: ctx.teamId,
  });
  return id;
}

/**
 * 人口补位（Step 26B 重写）：**边界驱动、确定性、只生成不删除**。
 * 流程（职责分离）：
 *   1) `Population Policy` 评估 World/Club 健康（`evaluatePopulationHealth`）——决定「是否需要生成 / 缺什么 / 给哪个 Club」；
 *   2) 对存在缺口（位置最低保障或人数下限）的俱乐部，按**缺失位置**生成；
 *   3) World 安全网：俱乐部补位后**重新评估**，若世界仍低于有效下限，**确定性**选一个未达上限的俱乐部承接
 *      （**绝不创建无归属 active 球员 / 自由球员**；Free Agent 生命周期属 Step 27）。
 * 明确：不再按 `populationTarget` 补足固定人数；退休不直接触发生成（统一在此评估）；超过 MAX 不裁员（仅诊断）。
 */
export function replenishPopulation(state, { fromSeason, toSeason }) {
  const generated = [];

  // 1) 俱乐部缺口（位置优先驱动；顺序 = clubs 插入序，确定性）。
  const health = evaluatePopulationHealth(state);
  for (const clubId of Object.keys(health.clubs)) {
    for (const position of health.clubs[clubId].needs) {
      generated.push(generatePlayer(state, {
        position,
        teamId: clubId,
        season: toSeason,
        fromSeason,
      }));
    }
  }

  // 2) World 安全网（俱乐部补位后重新评估，避免重复计数；正常生命周期通常不触发）。
  const after = evaluatePopulationHealth(state);
  if (after.worldDeficit > 0) {
    const order = Object.keys(after.clubs)
      .filter((clubId) => after.clubs[clubId].count < ROSTER_CONFIG.MAX_PLAYERS)
      .sort((a, b) => after.clubs[a].count - after.clubs[b].count || a.localeCompare(b));
    for (let k = 0; k < after.worldDeficit && order.length > 0; k += 1) {
      generated.push(generatePlayer(state, {
        position: EXTRA_POSITION_ORDER[k % EXTRA_POSITION_ORDER.length],
        teamId: order[k % order.length],
        season: toSeason,
        fromSeason,
      }));
    }
  }

  return generated;
}

/**
 * 赛季滚动的球员生命周期编排（在 `developPlayers` 之后、`resetSeasonStats` 之前调用）。
 * 顺序：退役+归档 → 计算人口/位置缺口 → 生成属于下一赛季的新生代。
 * @param {{fromSeason: number, toSeason: number}} ctx
 * @returns {{retired: string[], generated: string[]}}
 */
export function runPlayerLifecycle(state, { fromSeason, toSeason }) {
  if (!C.ENABLED) return { retired: [], generated: [] };
  const retired = processRetirements(state, fromSeason);
  const generated = replenishPopulation(state, { fromSeason, toSeason });
  return { retired, generated };
}
