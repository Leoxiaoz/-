/**
 * Interaction Instant Ball Position Integration Gate（Step 39F-M-C-33）。
 * 层级归属：Simulation Core / Match Movement。**纯函数、确定性、Immutable、无副作用、无 RNG、无墙钟**。
 *
 * 职责：作为 `Interaction Resolution → C-32 Position Ownership → C-29 Instant Position`
 * 生产链的 **C-27 Semantic Gate**。只有 C-27 语义被确认为 **INSTANT** 的 Interaction
 * 才允许进入 Position Integration；未知 / 未审查 / 非 INSTANT 类型一律 **明确失败**，
 * **绝不静默视为 INSTANT**（不得进入 C-32 / C-29）。
 *
 * 最终生产链（C-33 冻结）：
 *   Interaction Resolution
 *     → [本 Gate：C-27 semantics === INSTANT?]
 *     → C-32 `applyInteractionBallPositionUpdate`（唯一 Position Ownership Boundary）
 *     → C-29 `applyInstantBallPositionUpdate`（唯一最终 Position Writer）
 *     → MatchCore.ball.position
 *     → C-05 State Mutation（不写 position）
 *
 * 边界（冻结）：
 * - **不创建** 第二 Position Boundary；**不写** MatchCore.ball.position；**不调用** C-29（由 C-32 负责）。
 * - 只做 Semantic 判定（只读 `result.actionType`），**不重算** position / destination / scatter / contestPoint。
 * - **不硬编码** actionType 白名单：统一委托既有 C-27 `resolveInteractionBallMovementSemantics`，
 *   避免 C-27 Semantic Contract 出现第二套 Truth。
 * - **只处理 Interaction**（`type === 'INTERACTION_RESOLUTION'`）；SECOND_BALL 不经本 Gate（C-31 = NO_POSITION_CHANGE）。
 * - 不产生 duration / Movement State / Transit / Velocity / Trajectory / Physics / Collision。
 */

import {
  resolveInteractionBallMovementSemantics, BALL_MOVEMENT_SEMANTICS,
} from './interaction-ball-movement-semantics.js';

export const INTERACTION_INSTANT_BALL_POSITION_INTEGRATION_SOURCE = 'INTERACTION_INSTANT_BALL_POSITION_INTEGRATION';
export const INTERACTION_INSTANT_BALL_POSITION_INTEGRATION_RULE_VERSION = 'interaction-instant-ball-position-integration-v1';

/** Gate 结论原因码。 */
export const INTERACTION_INSTANT_BALL_POSITION_INTEGRATION_REASON = Object.freeze({
  NOT_INTERACTION_RESULT: 'POSITION_NOT_APPLICABLE',                       // 非 Interaction Result → 不适用
  SEMANTICS_UNSUPPORTED: 'INTERACTION_BALL_MOVEMENT_SEMANTICS_UNSUPPORTED', // 非 INSTANT / 未知 → 明确失败
});

const S = BALL_MOVEMENT_SEMANTICS;
const R = INTERACTION_INSTANT_BALL_POSITION_INTEGRATION_REASON;

/**
 * C-27 Semantic Gate：判定一个 InteractionResolutionResult 是否有资格进入 Position Integration。
 *
 * 返回契约：
 * - 语义 = INSTANT → `{ ok:true, instant:true, actionType, semantics, reason:null, source, ruleVersion }`
 * - 非 Interaction / 非 ok / 无 ball → `{ ok:false, instant:false, reason:'POSITION_NOT_APPLICABLE', ... }`
 * - 未知 / 非 INSTANT → `{ ok:false, instant:false, reason:'INTERACTION_BALL_MOVEMENT_SEMANTICS_UNSUPPORTED', ... }`
 *
 * @param {object} result InteractionResolutionResult（只读；只用 `type` / `ok` / `ball` / `actionType`）
 * @returns {object}
 */
export function resolveInteractionInstantBallPositionSemantics(result) {
  const envelope = {
    source: INTERACTION_INSTANT_BALL_POSITION_INTEGRATION_SOURCE,
    ruleVersion: INTERACTION_INSTANT_BALL_POSITION_INTEGRATION_RULE_VERSION,
  };

  if (!result || result.type !== 'INTERACTION_RESOLUTION' || result.ok !== true || !result.ball) {
    return { ...envelope, ok: false, instant: false, actionType: null, semantics: null, reason: R.NOT_INTERACTION_RESULT };
  }

  const sem = resolveInteractionBallMovementSemantics(result.actionType);
  if (!sem.ok || sem.semantics !== S.INSTANT) {
    return {
      ...envelope, ok: false, instant: false,
      actionType: result.actionType ?? null, semantics: sem.semantics ?? null,
      reason: R.SEMANTICS_UNSUPPORTED,
    };
  }
  return { ...envelope, ok: true, instant: true, actionType: result.actionType, semantics: S.INSTANT, reason: null };
}