/**
 * 球队实力计算（Simulation Core）。
 * 对应 SIMULATION_SPEC §5（球队实力按"进攻/中场/防守/门将"分维度聚合）。
 *
 * MVP 口径（DECISIONS D-11）：按阵型各线人数取样，取该线评分最高者求平均，
 * 属性缺失时回退到 ATTRIBUTE_DEFAULT（并在数据校验阶段提示）。
 * 纯函数：只读静态世界 + 运行时战术，不修改任何状态。
 */

import {
  FORMATIONS,
  DEFAULT_FORMATION,
} from './sim-config.js';
import { ATTRIBUTE_DEFAULT } from '../shared/football-schema.js';

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

/** 单个球员在某线的评分（相关属性均值）。 */
function playerLineRating(player, attrs) {
  let sum = 0;
  for (const attr of attrs) {
    const v = Number(player?.[attr]);
    sum += Number.isFinite(v) ? v : ATTRIBUTE_DEFAULT;
  }
  return sum / attrs.length;
}

/**
 * 取某队某线评分最高的 count 名球员求均值。
 * @param {object[]} players 该队全部球员
 * @param {string} position 位置枚举
 * @param {number} count 需要的该线人数
 */
function lineRating(players, position, count) {
  const attrs = LINE_ATTRIBUTES[position];
  const candidates = players.filter((p) => p.position === position);
  if (candidates.length === 0) return ATTRIBUTE_DEFAULT;
  const ratings = candidates
    .map((p) => playerLineRating(p, attrs))
    .sort((a, b) => b - a)
    .slice(0, Math.max(1, count));
  return ratings.reduce((s, r) => s + r, 0) / ratings.length;
}

/**
 * 计算一支球队的四维实力。
 * @param {object} state 运行时状态（读取 static 世界）
 * @param {string} teamId
 * @param {{formation?: string, mentality?: string}} [tactics]
 * @returns {{attack: number, midfield: number, defence: number, goalkeeping: number}}
 */
export function computeTeamStrength(state, teamId, tactics = {}) {
  const players = state.static.players.filter((p) => p.teamId === teamId);
  const counts = lineCounts(tactics.formation);
  const gk = lineRating(players, 'GK', 1);
  const defence = lineRating(players, 'DF', counts.DF);
  const midfield = lineRating(players, 'MF', counts.MF);
  const attack = lineRating(players, 'FW', counts.FW);
  return { attack, midfield, defence, goalkeeping: gk };
}