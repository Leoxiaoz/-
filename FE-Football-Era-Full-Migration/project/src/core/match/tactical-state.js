/**
 * Tactical State 规范化（Step 39F-M-C）。
 * 层级归属：Simulation Core / Match Tactical。**纯函数**，无副作用、无 RNG。
 *
 * 职责：把 `matchCore.tactical[teamId]` 规范化为 §3 冻结字段集合，缺失 / 非法回退默认。
 * 语义：
 * - **不新增持久化字段**；不写 MatchCore；不改 Schema（仍为 10）。
 * - 既有的 `pressing` 字段被 `pressingIntensity` 优先覆盖（复用现状，避免双真相）。
 * - 本模块只描述「球队声明的战术意图」，**不参与任何 Resolution 成功率**。
 */

import { FORMATIONS, DEFAULT_FORMATION } from '../sim-config.js';
import { TACTICAL_DEFAULTS, TACTICAL_ENUMS } from './movement-config.js';

/** 合法枚举成员判定。 */
function oneOf(value, list, fallback) {
  return list.includes(value) ? value : fallback;
}

/**
 * 规范化单支球队的 Tactical State。
 * @param {object|null|undefined} raw `matchCore.tactical[teamId]`
 * @returns {{formation:string, mentality:string, possessionStyle:string,
 *   pressingIntensity:string, defensiveLine:string, width:string, tempo:string, transitionStyle:string}}
 */
export function normalizeTacticalState(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const formation = (typeof t.formation === 'string' && FORMATIONS[t.formation]) ? t.formation : DEFAULT_FORMATION;
  // pressingIntensity 优先；兼容既有 `pressing`（可能只提供其一）。
  const pressingRaw = t.pressingIntensity ?? t.pressing;
  return {
    formation,
    mentality: oneOf(t.mentality, TACTICAL_ENUMS.mentality, TACTICAL_DEFAULTS.mentality),
    possessionStyle: oneOf(t.possessionStyle, TACTICAL_ENUMS.possessionStyle, TACTICAL_DEFAULTS.possessionStyle),
    pressingIntensity: oneOf(pressingRaw, TACTICAL_ENUMS.pressingIntensity, TACTICAL_DEFAULTS.pressingIntensity),
    defensiveLine: oneOf(t.defensiveLine, TACTICAL_ENUMS.defensiveLine, TACTICAL_DEFAULTS.defensiveLine),
    width: oneOf(t.width, TACTICAL_ENUMS.width, TACTICAL_DEFAULTS.width),
    tempo: oneOf(t.tempo, TACTICAL_ENUMS.tempo, TACTICAL_DEFAULTS.tempo),
    transitionStyle: oneOf(t.transitionStyle, TACTICAL_ENUMS.transitionStyle, TACTICAL_DEFAULTS.transitionStyle),
  };
}

/**
 * 取某队规范化 Tactical State。
 * @param {object} matchCore
 * @param {string} teamId
 * @returns {object} 规范化结果（新对象，不引用 MatchCore）
 */
export function getTacticalState(matchCore, teamId) {
  return normalizeTacticalState(matchCore?.tactical?.[teamId]);
}