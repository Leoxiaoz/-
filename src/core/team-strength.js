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
} from './sim-config.js';
import { ATTRIBUTE_DEFAULT } from '../shared/football-schema.js';
import {
  getPlayerRuntime,
  getEffectiveAttributes,
  INJURY_STATUS,
} from './player-runtime.js';

/** 各线参考属性（MVP 最小集，DECISIONS D-11）。 */
const LINE_ATTRIBUTES = Object.freeze({
  GK: ['goalkeeping'],
  DF: ['defending', 'pace'],
  MF: ['passing', 'technique'],
  FW: ['finishing', 'technique', 'pace'],
});

/** 阵型各线人数（含 GK 固定 1）。 */
function lineCounts(formation) {
  return FORMATIONS[formation] ?? FORMATIONS[DEFAULT_FORMATION];
}

/** 某队**可用**（非伤停）球员。伤病球员不参与实力与出场（第 17 步）。 */
function availablePlayers(state, teamId) {
  return state.static.players
    .filter((p) => p.teamId === teamId)
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
 * 选出本场**出场集合**（比赛模拟实际使用的球员）。
 * 本步无首发/替补/换人系统，故按位置取各线评分最高者（与实力计算同源）。
 * **可替换点**：未来以正式首发/换人系统替换本函数即可，无需重写统计层。
 * @returns {object[]} 静态球员对象数组（GK×1 + 各线按阵型人数）
 */
export function selectMatchSquad(state, teamId, tactics = {}) {
  const players = availablePlayers(state, teamId);
  const counts = lineCounts(tactics.formation);
  const pickLine = (position, count) => players
    .filter((p) => p.position === position)
    .map((p) => ({ player: p, rating: playerLineRating(state, p, LINE_ATTRIBUTES[position]) }))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, Math.max(1, count))
    .map((x) => x.player);
  return [
    ...pickLine('GK', 1),
    ...pickLine('DF', counts.DF),
    ...pickLine('MF', counts.MF),
    ...pickLine('FW', counts.FW),
  ];
}

/**
 * 计算一支球队的四维实力（基于有效属性）。
 * @param {object} state 运行时状态（读取 static 世界 + runtime 增量）
 * @param {string} teamId
 * @param {{formation?: string, mentality?: string}} [tactics]
 * @returns {{attack: number, midfield: number, defence: number, goalkeeping: number}}
 */
export function computeTeamStrength(state, teamId, tactics = {}) {
  const squad = selectMatchSquad(state, teamId, tactics);
  const average = (position) => {
    const ratings = squad
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
