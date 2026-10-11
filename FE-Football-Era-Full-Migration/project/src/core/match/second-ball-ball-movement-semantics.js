/**
 * SECOND_BALL Ball Movement Semantics Foundation（Step 39F-M-C-31）。
 * 层级归属：Simulation Core / Match Semantics。**纯数据 + 纯查询函数；无副作用、无 RNG、无墙钟**。
 *
 * 职责（Semantic Decision Gate）：冻结「SECOND_BALL Resolution 是否改变 Ball Position」的语义。
 *
 * 调查结论（基于现有冻结事实，非足球现实经验）：
 * - C-07 `resolveSecondBall` 的所有 outcome 均令 `result.ball.position = ballFacts.position`
 *   = 当前 MatchCore.ball.position（经 ball-facts 只读派生，**不投影、不推进**）。
 *   见 `second-ball-resolution.js` L257-260 / L266 / L285 / L296。
 * - C-05 `applyInteractionStateUpdate` 以该 position 原子写入；因值恒等于当前球位 → **写入为恒等（no-op）**。
 * - C-07 无 from / 无 to / 无 duration / 无 transit / 无 velocity / 无 trajectory；无任何连续运动规则。
 *
 * 因此冻结：SECOND_BALL 对 **所有实际 outcome** 的 Ball Position Movement Semantics =
 *   **NO_POSITION_CHANGE**（本次 Resolution 不发生 Ball Position Movement）。
 *   - **不是** CONTINUOUS；**不是** INSTANT（无位移）；**不是** "duration = 0"。
 *
 * 边界（冻结）：
 * - 只决定 Position Movement Semantics；**不**重定义 Ball State / possession / control /
 *   looseBall / lastTouch / velocity（仍由 C-07 Resolution Contract 决定）。
 * - 未识别 outcome → **UNDEFINED**（禁止默认归类为 NO_POSITION_CHANGE / INSTANT）。
 * - 不调用 C-05 / C-06 / C-07 Resolution / C-08 / C-23 / C-29 / C-30；不写 MatchCore；不产生 duration / transit / velocity / trajectory / physics。
 */

import { SECOND_BALL_OUTCOMES } from './second-ball-resolution-config.js';

export const SECOND_BALL_BALL_MOVEMENT_SEMANTICS_SOURCE = 'SECOND_BALL_BALL_MOVEMENT_SEMANTICS';
export const SECOND_BALL_BALL_MOVEMENT_SEMANTICS_RULE_VERSION = 'second-ball-ball-movement-semantics-v1';

/** Position Movement Semantics 枚举。 */
export const SECOND_BALL_POSITION_SEMANTICS = Object.freeze({
  NO_POSITION_CHANGE: 'NO_POSITION_CHANGE',
  UNDEFINED: 'SECOND_BALL_BALL_MOVEMENT_SEMANTICS_UNDEFINED',
});

const NO_CHANGE = SECOND_BALL_POSITION_SEMANTICS.NO_POSITION_CHANGE;

/**
 * 冻结映射：SECOND_BALL outcome → Ball Position Movement Semantics。
 * 每个实际 outcome 均有明确结论；无 CLOSED 的 outcome 不得静默归类。
 */
export const SECOND_BALL_OUTCOME_POSITION_SEMANTICS = Object.freeze({
  [SECOND_BALL_OUTCOMES.WON]: NO_CHANGE,
  [SECOND_BALL_OUTCOMES.NO_WINNER]: NO_CHANGE,
  [SECOND_BALL_OUTCOMES.INVALID]: NO_CHANGE,
});

/**
 * 查询某 SECOND_BALL outcome 的 Ball Position Movement Semantics。
 *
 * @param {string} outcome SECOND_BALL_OUTCOMES 之一
 * @returns {{ok:boolean, actionType:'SECOND_BALL', outcome:(string|null), semantics?:string, reason?:string, source:string, ruleVersion:string}}
 */
export function getSecondBallBallMovementSemantics(outcome) {
  const base = {
    actionType: 'SECOND_BALL',
    outcome: typeof outcome === 'string' ? outcome : (outcome ?? null),
    source: SECOND_BALL_BALL_MOVEMENT_SEMANTICS_SOURCE,
    ruleVersion: SECOND_BALL_BALL_MOVEMENT_SEMANTICS_RULE_VERSION,
  };
  const semantics = typeof outcome === 'string'
    ? SECOND_BALL_OUTCOME_POSITION_SEMANTICS[outcome]
    : undefined;
  if (semantics === undefined) {
    return { ...base, ok: false, reason: SECOND_BALL_POSITION_SEMANTICS.UNDEFINED };
  }
  return { ...base, ok: true, semantics };
}