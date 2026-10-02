/**
 * 球队实力计算（Simulation Core）。
 * 对应 SIMULATION_SPEC §5（球队实力按"进攻/中场/防守/门将"分维度聚合）。
 *
 * 口径（DECISIONS D-11，第 18 步修订 D-16）：
 * - **使用球员当前有效属性**（静态基础 + 运行时 `ability.deltas`，并按 `potential` 与属性量程夹取），
 *   而非静态基础属性——这样成长/衰退才真正影响球队实力与比赛结果。
 * - 按阵型各线人数取样，取该线评分最高者求平均；伤病球员不可用（第 17 步）；
 *   属性缺失回退 `ATTRIBUTE_DEFAULT`；某线无可用者回退中性值（无 NaN / 负数）。
 * - 纯函数：只读静态世界 + 运行时状态，不修改任何状态。
 */

import {
  FORMATIONS,
  DEFAULT_FORMATION,
  LINE_ATTRIBUTES,
  MATCH_LOAD_CONFIG,
} from './sim-config.js';
import { ATTRIBUTE_DEFAULT } from '../shared/football-schema.js';
import {
  getPlayerRuntime,
  getEffectiveAttributes,
  getTeamPlayers,
  INJURY_STATUS,
} from './player-runtime.js';
import { getClubRuntime, recordEvent } from './game-state.js';
import { repairSquadForMatch, selectBenchCandidates, LINEUP_LIMITS } from './player-lineup.js';
import {
  rankLineCandidates,
  selectionDevelopmentPriority,
  developmentProximity,
} from './ai/ai-development-signals.js';
import { AI_SELECTION_DEVELOPMENT_CONFIG } from './ai/ai-config.js';

/** 阵型各线人数（含 GK 固定 1）。 */
function lineCounts(formation) {
  return FORMATIONS[formation] ?? FORMATIONS[DEFAULT_FORMATION];
}

/** 某队**可用**（非伤停）球员。经世界球员访问器获取（含新生代、排除退役）；伤病不参与（第 17 步）。 */
function availablePlayers(state, teamId) {
  return getTeamPlayers(state, teamId)
    .filter((p) => getPlayerRuntime(state, p.id)?.injury?.status !== INJURY_STATUS.INJURED);
}

/** 从**有效属性向量**取某线评分（相关属性均值；缺失回退 `ATTRIBUTE_DEFAULT`）。 */
function ratingFrom(bag, attrs) {
  let sum = 0;
  for (const attr of attrs) {
    const v = Number(bag?.[attr]);
    sum += Number.isFinite(v) ? v : ATTRIBUTE_DEFAULT;
  }
  return sum / attrs.length;
}

/** 某球员某线的有效评分。 */
function playerLineRating(state, player, attrs) {
  return ratingFrom(getEffectiveAttributes(state, player.id), attrs);
}

/**
 * 自动选阵：选出本场**出场集合**（比赛模拟实际使用的球员）。
 * Step 39F-G：对 AI club（非 managed）在同位置线内使用 B2 Marginal Starter Cutoff + C2
 * Bounded Effective Competitive Score（current rating + bounded development influence）排序；
 * managed club / 无 dev context 时退化为 `rating DESC, playerId ASC`。
 * 用于 AI 球队 / 未选择管理球队 / 玩家阵容修复失败时的回退（第 20 步起统一入口见 `resolveMatchSquad`）。
 * @returns {object[]} 静态球员对象数组（GK×1 + 各线按阵型人数）
 */
export function selectMatchSquad(state, teamId, tactics = {}) {
  const players = availablePlayers(state, teamId);
  const counts = lineCounts(tactics.formation);
  // Step 39F-G：development-aware soft priority 仅作用于 **AI club**（非 managed）。
  // managed club 的 selectMatchSquad（及 repair 路径）行为保持完全不变。
  const devCfg = AI_SELECTION_DEVELOPMENT_CONFIG;
  const devEnabled = devCfg.ENABLED && teamId !== (state?.runtime?.managedClubId ?? null);
  const pickLine = (position, count) => {
    const slot = Math.max(1, count);
    const pool = players
      .filter((p) => p.position === position)
      .map((p) => ({ player: p, rating: playerLineRating(state, p, LINE_ATTRIBUTES[position]) }));
    if (!devEnabled) {
      pool.sort((a, b) => b.rating - a.rating || a.player.id.localeCompare(b.player.id));
      return pool.slice(0, slot).map((x) => x.player);
    }
    // B2 Marginal Starter Cutoff + C2 Bounded Effective Competitive Score。
    const candidates = pool.map((x) => ({
      playerId: x.player.id,
      rating: x.rating,
      priority: selectionDevelopmentPriority(state, teamId, x.player.id),
    }));
    const ranked = rankLineCandidates(candidates, {
      slotCount: slot,
      distanceScale: devCfg.DISTANCE_SCALE,
      cap: devCfg.CAP,
    });
    const byId = new Map(pool.map((x) => [x.player.id, x.player]));
    return ranked.slice(0, slot).map((x) => byId.get(x.playerId));
  };
  return [
    ...pickLine('GK', 1),
    ...pickLine('DF', counts.DF),
    ...pickLine('MF', counts.MF),
    ...pickLine('FW', counts.FW),
  ];
}

/**
 * 解析某队本场的**出场集合**——统一入口（第 20 步）。
 * - 若该队是玩家**管理球队**且已保存首发：先用 `repairSquadForMatch` 按阵型严格修复玩家阵容；
 *   修复失败（某线无法凑齐健康球员）时记录 `lineup_fallback` 事件并**回退自动选阵**。
 * - 其余情况（AI 球队 / 未选择管理球队 / 首发为空）继续使用 `selectMatchSquad`（自动选阵）。
 * @param {object} state
 * @param {string} teamId
 * @param {{formation?: string, mentality?: string}} [tactics]
 * @returns {object[]} 静态球员对象数组
 */
export function resolveMatchSquad(state, teamId, tactics = {}) {
  const club = getClubRuntime(state, teamId);
  const lineup = club?.lineup;
  if (teamId === state.runtime?.managedClubId && Array.isArray(lineup?.starters) && lineup.starters.length > 0) {
    const squad = repairSquadForMatch(
      state,
      teamId,
      lineup,
      tactics.formation,
      (player, position) => playerLineRating(state, player, LINE_ATTRIBUTES[position]),
    );
    if (squad) return squad;
    recordEvent(state, 'lineup_fallback', { clubId: teamId, reason: 'invalid lineup' });
  }
  return selectMatchSquad(state, teamId, tactics);
}

/**
 * 基于自动选阵生成一份玩家阵容（供"自动填充"）：首发 = 自动选阵；替补 = 剩余球员综合评分前 N。
 * @returns {{starters: string[], bench: string[]}}
 */
export function buildAutoLineup(state, teamId, tactics = {}) {
  const starters = selectMatchSquad(state, teamId, tactics).map((p) => p.id);
  const bench = selectBenchCandidates(state, teamId, starters, LINEUP_LIMITS.BENCH);
  return { starters, bench };
}

/**
 * 计算一支球队的四维实力（基于有效属性）。
 * @param {object} state 运行时状态（读取 static 世界 + runtime 增量）
 * @param {string} teamId
 * @param {{formation?: string, mentality?: string}} [tactics]
 * @param {object[]} [squad] 显式传入的出场集合（玩家阵容修复结果）；缺省则自动选阵
 * @returns {{attack: number, midfield: number, defence: number, goalkeeping: number}}
 */
export function computeTeamStrength(state, teamId, tactics = {}, squad = null) {
  const used = squad ?? selectMatchSquad(state, teamId, tactics);
  const average = (position) => {
    const ratings = used
      .filter((p) => p.position === position)
      .map((p) => playerLineRating(state, p, LINE_ATTRIBUTES[position]));
    if (ratings.length === 0) return ATTRIBUTE_DEFAULT; // 空阵容保护：回退中性值
    return ratings.reduce((s, r) => s + r, 0) / ratings.length;
  };
  return {
    attack: average('FW'),
    midfield: average('MF'),
    defence: average('DF'),
    goalkeeping: average('GK'),
  };
}

// =====================================================================================
// Step 39F-H — Rotation / Actual Match Minutes（纯派生；仅 AI Club；Managed 保持 90/0）
// 红线：不改 Team Strength / Expected Goals / Match Result / Growth / Fitness cost；
//       不新增 runtime state；无 RNG（确定性 + playerId tie-break）。
// =====================================================================================

/** 正常位置线（GK 不参与轮换）。 */
const ROTATION_POSITIONS = Object.freeze(['DF', 'MF', 'FW']);

/**
 * 轮换强度 → 离散分钟模板（降序匹配第一个 `strength ≥ min`）；无匹配返回 0。
 * @returns {number} 0 / 15 / 20 / 30 / 45
 */
export function rotationMinutesFor(strength) {
  const s = Number(strength);
  if (!Number.isFinite(s) || s <= 0) return 0;
  for (const t of AI_SELECTION_DEVELOPMENT_CONFIG.ROTATION_TEMPLATES) {
    if (s >= t.min) return t.minutes;
  }
  return 0;
}

/**
 * 计算本场 **AI Club** 的分钟分配计划（纯函数，不改 state，无 RNG）。
 *
 * 规则（D-39F-H 冻结结构 + Owner N1/N2/N3）：
 * - 按 **position line** 分区：每条线 90×slotCount 分钟，只在本线 available 球员间重分配（守恒）。
 * - `Effective XI` 中的球员得到基础 90；每个非 GK 位置线最多发生**一次**有限轮换：
 *   取本线**最弱主力**（rating asc, playerId asc），在非 XI 的 available 候选中选**轮换强度最大**者
 *   （`strength = selectionDevelopmentPriority × proximity`，proximity 基于与最弱主力的 rating gap）。
 * - 轮换分钟 ∈ 离散模板；且主力保留 ≥ `STARTER_MIN_MINUTES`（starter protection）。
 * - GK 永不轮换；Managed Club 永不轮换（全 XI = 90）。
 *
 * @param {object} state
 * @param {string} teamId
 * @param {{formation?: string}} [tactics]
 * @param {object[]} [effectiveXI] `resolveMatchSquad` 的输出（Effective XI，用于 Team Strength）
 * @returns {{slots: object[], minutesByPlayer: Map<string, number>}}
 */
export function planMatchMinutes(state, teamId, tactics = {}, effectiveXI = null) {
  const cfg = AI_SELECTION_DEVELOPMENT_CONFIG;
  const base = MATCH_LOAD_CONFIG.MINUTES_PER_MATCH;
  const counts = lineCounts(tactics.formation);
  const xi = Array.isArray(effectiveXI) ? effectiveXI.filter(Boolean) : [];
  const managed = state?.runtime?.managedClubId ?? null;
  const rotationEnabled = cfg.ROTATION_ENABLED && teamId !== managed;
  const avail = availablePlayers(state, teamId);
  const slots = [];
  const minutesByPlayer = new Map();

  for (const position of ['GK', 'DF', 'MF', 'FW']) {
    const starters = xi.filter((p) => p.position === position);
    const starterIds = new Set(starters.map((p) => p.id));
    const line = starters.map((p) => ({ playerId: p.id, minutes: base }));
    const total = starters.length * base;

    if (rotationEnabled && ROTATION_POSITIONS.includes(position) && starters.length > 0) {
      const rated = new Map(starters.map((p) => [p.id, playerLineRating(state, p, LINE_ATTRIBUTES[position])]));
      const weakest = line
        .map((l) => ({ playerId: l.playerId, minutes: l.minutes, rating: rated.get(l.playerId) }))
        .sort((a, b) => a.rating - b.rating || a.playerId.localeCompare(b.playerId))[0];
      const candidates = avail
        .filter((p) => p.position === position && !starterIds.has(p.id))
        .map((p) => ({ playerId: p.id, rating: playerLineRating(state, p, LINE_ATTRIBUTES[position]) }))
        .sort((a, b) => b.rating - a.rating || a.playerId.localeCompare(b.playerId));

      let best = null;
      const headroomCap = weakest.minutes - cfg.STARTER_MIN_MINUTES;
      for (const c of candidates) {
        const gap = Math.max(0, weakest.rating - c.rating);
        const proximity = developmentProximity(gap, cfg.DISTANCE_SCALE);
        if (proximity <= 0) continue;
        const priority = selectionDevelopmentPriority(state, teamId, c.playerId);
        const strength = priority * proximity;
        const minutes = Math.min(rotationMinutesFor(strength), headroomCap);
        if (minutes <= 0) continue;
        if (best === null || strength > best.strength) best = { playerId: c.playerId, strength, minutes };
      }
      if (best) {
        const w = line.find((l) => l.playerId === weakest.playerId);
        w.minutes -= best.minutes;
        line.push({ playerId: best.playerId, minutes: best.minutes });
      }
    }

    for (const l of line) minutesByPlayer.set(l.playerId, (minutesByPlayer.get(l.playerId) || 0) + l.minutes);
    slots.push({
      position,
      slotCount: position === 'GK' ? 1 : (counts[position] ?? 0),
      total,
      allocations: line.map((l) => ({ playerId: l.playerId, minutes: l.minutes })),
    });
  }
  return { slots, minutesByPlayer };
}

/**
 * `planMatchMinutes` 的便捷包装：仅返回 `playerId → minutes`。
 * @returns {Map<string, number>}
 */
export function allocateMatchMinutes(state, teamId, tactics = {}, effectiveXI = null) {
  return planMatchMinutes(state, teamId, tactics, effectiveXI).minutesByPlayer;
}
