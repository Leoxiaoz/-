/**
 * 玩家阵容（Player Lineup）——解析、校验、清洗与修复。
 * 层级归属：Simulation Core。纯数据 + 纯函数，**不依赖 DOM / 存储 / UI**。
 *
 * 规范来源：DECISIONS D-18（第 20 步，玩家阵容 / 战术选择）。核心约定：
 * - 阵容进入 `runtime`（`runtime.managedClubId` + `runtime.clubs[].lineup`），是比赛模拟的**真实输入**，
 *   而非纯 UI 状态；非管理球队继续走自动选阵（`selectMatchSquad`）。
 * - **首发严格匹配阵型**：GK=1，DF/MF/FW 等于阵型各线人数；不足时按规则修复，无法修复则回退自动阵容。
 * - **替补仅存储与展示**，本步骤不参与比赛、不参与换人（换人引擎属 out-of-scope）。
 * - 伤病球员**不得进入实际首发**（比赛修复时以健康球员顶替）；但玩家选择被保留，康复后可重新首发。
 *   允许受伤球员进入替补席。
 * - 退役 / 离队 / 不存在 / 重复的 playerId 一律被清洗剔除；首发与替补不得重复。
 *
 * 本模块**不重写比赛比分算法**：只负责产出「比赛实际使用的球员集合」，交由 match.js 使用。
 * 评分函数由调用方注入（`ratePlayer`），避免与 team-strength 形成循环依赖。
 */

import { FORMATIONS, DEFAULT_FORMATION, LINEUP_CONFIG, LINE_ATTRIBUTES } from './sim-config.js';
import { PLAYER_ATTRIBUTES, ATTRIBUTE_DEFAULT } from '../shared/football-schema.js';
import {
  getPlayerRuntime,
  getTeamPlayers,
  getEffectiveAttributes,
  INJURY_STATUS,
} from './player-runtime.js';

/** 阵容容量上限。 */
export const LINEUP_LIMITS = Object.freeze({
  STARTERS: LINEUP_CONFIG.STARTERS,
  BENCH: LINEUP_CONFIG.BENCH,
});

/** 阵型槽位（顺序固定：GK → DF → MF → FW），供首发构成校验与修复使用。 */
export function formationSlots(formation) {
  const counts = FORMATIONS[formation] ?? FORMATIONS[DEFAULT_FORMATION];
  return [
    { position: 'GK', count: 1 },
    { position: 'DF', count: counts.DF },
    { position: 'MF', count: counts.MF },
    { position: 'FW', count: counts.FW },
  ];
}

/** 某球员是否健康（未伤停）。 */
function isFit(state, playerId) {
  return getPlayerRuntime(state, playerId)?.injury?.status !== INJURY_STATUS.INJURED;
}

/** 默认评分函数（与 team-strength 同源的各线有效属性均值；由配置 `LINE_ATTRIBUTES` 驱动）。 */
export function ratePlayerByLine(state, player, position) {
  const attrs = LINE_ATTRIBUTES[position] ?? LINE_ATTRIBUTES.MF;
  const eff = getEffectiveAttributes(state, player.id) ?? {};
  let sum = 0;
  for (const attr of attrs) {
    const v = Number(eff[attr]);
    sum += Number.isFinite(v) ? v : ATTRIBUTE_DEFAULT;
  }
  return sum / attrs.length;
}

/**
 * 清洗一份玩家阵容：只保留**结构合法**的引用。
 * 规则：非字符串 / 不存在 / 已退役 / 不属于该队 / 重复 → 剔除；首发与替补去重；超出容量截断。
 * **不校验位置构成**（位置严格匹配在比赛修复时处理），**不剔除伤病**（玩家选择保留，比赛时替换）。
 * @returns {{starters: string[], bench: string[]}}
 */
export function cleanLineup(state, clubId, lineup) {
  const rosterIds = new Set(getTeamPlayers(state, clubId).map((p) => p.id));
  const norm = (arr) => {
    const out = [];
    for (const id of Array.isArray(arr) ? arr : []) {
      if (typeof id !== 'string' || !rosterIds.has(id) || out.includes(id)) continue;
      out.push(id);
    }
    return out;
  };
  const starters = norm(lineup?.starters).slice(0, LINEUP_LIMITS.STARTERS);
  const bench = norm(lineup?.bench)
    .filter((id) => !starters.includes(id))
    .slice(0, LINEUP_LIMITS.BENCH);
  return { starters, bench };
}

/**
 * 校验一份（已清洗的）玩家阵容，返回可解释的问题列表（**不抛错、不阻塞**，供 UI 反馈）。
 * 覆盖：首发人数、替补人数、位置构成、GK 约束、重复引用、伤病首发提示。
 * @returns {string[]}
 */
export function validateLineup(state, clubId, lineup) {
  const issues = [];
  const starters = Array.isArray(lineup?.starters) ? lineup.starters : [];
  const bench = Array.isArray(lineup?.bench) ? lineup.bench : [];
  const slots = formationSlots(getClubFormation(state, clubId));

  if (starters.length !== LINEUP_LIMITS.STARTERS) {
    issues.push(`首发人数应为 ${LINEUP_LIMITS.STARTERS}，当前 ${starters.length}`);
  }
  if (bench.length > LINEUP_LIMITS.BENCH) {
    issues.push(`替补人数不得超过 ${LINEUP_LIMITS.BENCH}，当前 ${bench.length}`);
  }
  if (new Set(starters).size !== starters.length) issues.push('首发存在重复球员');
  if (new Set(bench).size !== bench.length) issues.push('替补存在重复球员');
  for (const id of bench) {
    if (starters.includes(id)) issues.push('同一球员不得同时出现在首发与替补');
  }

  // 位置构成严格匹配阵型。
  const positionOf = (id) => getTeamPlayers(state, clubId).find((p) => p.id === id)?.position ?? null;
  for (const slot of slots) {
    const actual = starters.filter((id) => positionOf(id) === slot.position).length;
    if (actual !== slot.count) {
      issues.push(`首发 ${slot.position} 应为 ${slot.count} 人，当前 ${actual} 人`);
    }
  }
  // 伤病球员不得进入实际首发（比赛将自动以健康球员顶替）。
  for (const id of starters) {
    if (!isFit(state, id)) issues.push('首发包含伤病球员，比赛时将自动替换');
  }
  return issues;
}

/** 取俱乐部当前阵型（缺省回退默认阵型）。 */
function getClubFormation(state, clubId) {
  return state?.runtime?.clubs?.[clubId]?.tactics?.formation ?? DEFAULT_FORMATION;
}

/**
 * 为一场比赛修复/解析首发阵容（严格匹配阵型）。
 * 步骤：按槽位顺序，优先保留玩家已保存且位置相符的健康球员；不足则用同位置**评分最高**的健康球员补齐。
 * @param {object} state
 * @param {string} clubId
 * @param {{starters?: string[]}} lineup 玩家已保存阵容
 * @param {string} formation 当前阵型
 * @param {(player: object, position: string) => number} ratePlayer 评分函数（由调用方注入）
 * @returns {object[]|null} 静态球员对象数组（GK→DF→MF→FW 顺序）；某线无法凑齐时返回 null
 */
export function repairSquadForMatch(state, clubId, lineup, formation, ratePlayer) {
  const slots = formationSlots(formation);
  const roster = getTeamPlayers(state, clubId).filter((p) => isFit(state, p.id));
  const byPosition = new Map();
  for (const p of roster) {
    if (!byPosition.has(p.position)) byPosition.set(p.position, []);
    byPosition.get(p.position).push(p);
  }

  const savedOrder = Array.isArray(lineup?.starters) ? lineup.starters : [];
  const picked = new Set();
  const out = [];

  for (const slot of slots) {
    const pool = byPosition.get(slot.position) ?? [];
    // 1) 保留玩家选择中位置相符、健康、未被占用者（按保存顺序，最多该线人数）。
    const kept = [];
    for (const id of savedOrder) {
      if (kept.length >= slot.count) break;
      const p = pool.find((x) => x.id === id && !picked.has(x.id));
      if (p) {
        picked.add(p.id);
        kept.push(p);
      }
    }
    // 2) 不足则按评分从高到低补齐；仍不足 → 无法修复。
    const need = slot.count - kept.length;
    if (need > 0) {
      const rest = pool
        .filter((p) => !picked.has(p.id))
        .map((p) => ({ p, r: ratePlayer(p, slot.position) }))
        .sort((a, b) => b.r - a.r || a.p.id.localeCompare(b.p.id))
        .slice(0, need);
      if (rest.length < need) return null;
      for (const x of rest) {
        picked.add(x.p.id);
        kept.push(x.p);
      }
    }
    out.push(...kept);
  }
  return out;
}

/**
 * 赛季滚动后修复所有俱乐部的玩家阵容：剔除退役/离队/不存在/重复的引用，并**补齐缺口**。
 * - 清洗引用（`cleanLineup`）；
 * - 首发不足阵型所需人数时，用同位置健康球员回填（`repairSquadForMatch`，保留玩家的有效选择）；
 * - 替补不足容量时，用剩余球员综合评分靠前者补齐（保留玩家已有的替补选择）。
 * 位置构成与容量在比赛时另有 `repairSquadForMatch` 严格保证。
 * @returns {object} state（原地）
 */
export function repairManagedLineups(state) {
  for (const [clubId, club] of Object.entries(state?.runtime?.clubs ?? {})) {
    if (!club?.lineup) continue;
    const cleaned = cleanLineup(state, clubId, club.lineup);
    const formation = club.tactics?.formation ?? DEFAULT_FORMATION;
    const required = formationSlots(formation).reduce((sum, s) => sum + s.count, 0);

    let starters = cleaned.starters;
    if (starters.length < required) {
      const repaired = repairSquadForMatch(
        state, clubId, cleaned, formation, (player, position) => ratePlayerByLine(state, player, position),
      );
      if (repaired) starters = repaired.map((p) => p.id);
    }

    let bench = cleaned.bench;
    if (bench.length < LINEUP_LIMITS.BENCH) {
      const extra = selectBenchCandidates(state, clubId, starters, LINEUP_LIMITS.BENCH)
        .filter((id) => !bench.includes(id));
      bench = [...bench, ...extra].slice(0, LINEUP_LIMITS.BENCH);
    }
    club.lineup = { starters, bench };
  }
  return state;
}

/**
 * 生成替补席候选：从该队**未入选首发**的活跃球员中，按综合评分（全部属性均值）降序取前 limit 名。
 * 说明：替补仅存储/展示，本步骤不参与比赛与换人。
 * @returns {string[]} playerId 列表
 */
export function selectBenchCandidates(state, clubId, starterIds, limit = LINEUP_LIMITS.BENCH) {
  const excluded = new Set(Array.isArray(starterIds) ? starterIds : []);
  const overall = (playerId) => {
    const eff = getEffectiveAttributes(state, playerId) ?? {};
    let sum = 0;
    for (const attr of PLAYER_ATTRIBUTES) {
      const v = Number(eff[attr]);
      sum += Number.isFinite(v) ? v : ATTRIBUTE_DEFAULT;
    }
    return sum / PLAYER_ATTRIBUTES.length;
  };
  return getTeamPlayers(state, clubId)
    .filter((p) => !excluded.has(p.id))
    .map((p) => ({ id: p.id, r: overall(p.id) }))
    .sort((a, b) => b.r - a.r || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit))
    .map((x) => x.id);
}
