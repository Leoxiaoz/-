/**
 * Interaction Ball Position Ownership Boundary（Step 39F-M-C-32）。
 * 层级归属：Simulation Core / Match Movement。**纯函数、确定性、Immutable、无副作用、无 RNG、无墙钟**。
 *
 * 职责：成为 **Interaction Ball Position 的唯一写入归属边界**，与 Interaction State Mutation
 * （Ball State / Possession / Control / LastTouch / Velocity，见 `interaction-state-update.js`）
 * **职责分离**。本边界决定「本次 Interaction Resolution 是否写入 Ball Position」，并在需要时
 * 委托既有 C-29 `applyInstantBallPositionUpdate` 完成实际写入。
 *
 * 背景（C-32 Ownership Decoupling）：
 * - 此前 C-05 `applyInteractionStateUpdate` 原子地同时写 `position` + state/possession/…，
 *   造成 Ball Position Ownership 与 State Mutation 耦合。
 * - 本 Gate 将 Position 写入职责从 C-05 剥离：C-05 不再写 position（只做 State Mutation）；
 *   Interaction 的 position 由本边界负责。
 * - C-05 仍是唯一 State Mutation 层；本边界只处理 **Ball Position**，不改任何 State。
 *
 * 语义（冻结）：
 * - **不创建** 第二 Ball Position Truth；最终 Truth 仍是 `MatchCore.ball.position`。
 * - **不创建** Movement State / Transit / Duration / Velocity / Trajectory / Physics / Collision。
 * - **不重算** position：只消费上游 Resolution 已确定的 `result.ball.position`。
 * - **不重复实现** Position Validation：委托既有 C-29（Instant Position Boundary），仅复用其通用
 *   有限数 / 不可变性语义；不建立第二套 Instant Position Boundary。
 * - **IN_TRANSIT（未拦截）不写 Position**：C-27 已冻结 IN_TRANSIT「仅失败拦截时保留，且不属于
 *   该 Interaction 自身的运动」；历史 C-05 亦对该态不做 position 写入。故本边界对 IN_TRANSIT
 *   返回「跳过（未集成）」，保持 NO_POSITION_CHANGE。
 *
 * 边界（冻结）：
 * - 只处理 Interaction（SECOND_BALL = NO_POSITION_CHANGE，见 C-31；**不经过本边界**）。
 * - 不调用 C-23 Continuous Movement / C-25 / C-24 / C-30；不直接写 MatchCore（委托 C-29 产出新对象）。
 * - 不改 possession / control / lastTouch / velocity / score / clock / players / save。
 */

import { applyInstantBallPositionUpdate } from './instant-ball-position-integration.js';
import { INTERACTION_BALL_STATE as BS } from './interaction-resolution-config.js';

export const INTERACTION_BALL_POSITION_OWNERSHIP_SOURCE = 'INTERACTION_BALL_POSITION_OWNERSHIP';
export const INTERACTION_BALL_POSITION_OWNERSHIP_RULE_VERSION = 'interaction-ball-position-ownership-v1';

/** 未集成（无 Position 写入）的原因码。 */
export const INTERACTION_BALL_POSITION_OWNERSHIP_REASON = Object.freeze({
  NOT_APPLICABLE: 'POSITION_NOT_APPLICABLE',     // 非 Interaction Result / 非 ok / 无 ball → 不写
  NO_POSITION_CHANGE: 'POSITION_NO_CHANGE',      // IN_TRANSIT：非该 Interaction 自身运动 → 不写
});

const R = INTERACTION_BALL_POSITION_OWNERSHIP_REASON;

/**
 * 将上游 Resolution 已确定的 Target Position 写入 `MatchCore.ball.position`
 * （Interaction 的唯一 Position 归属边界）。内部委托 C-29（复用通用 Instant Position Validation）。
 *
 * 返回契约：
 * - 写入成功 → `{ ok:true, integrated:true, matchCore, reason:null, source, ruleVersion }`
 *   （**新** MatchCore；输入不变）。
 * - 无需写入（非法 / 非 Interaction / IN_TRANSIT）→ `{ ok:true, integrated:false, matchCore, reason, source, ruleVersion }`
 *   （matchCore === 输入；不产生新对象）。
 * - 写入失败（C-29 INVALID_*）→ `{ ok:false, integrated:false, reason, source, ruleVersion }`
 *   （不产出新 MatchCore；不自动修正 / 不 clamp）。
 *
 * @param {object} matchCore MatchCore Truth（只读）
 * @param {object} result InteractionResolutionResult（只读；只用其 `ball.position` / `ball.state`）
 * @returns {object}
 */
export function applyInteractionBallPositionUpdate(matchCore, result) {
  const envelope = {
    source: INTERACTION_BALL_POSITION_OWNERSHIP_SOURCE,
    ruleVersion: INTERACTION_BALL_POSITION_OWNERSHIP_RULE_VERSION,
  };

  if (!result || result.type !== 'INTERACTION_RESOLUTION' || result.ok !== true || !result.ball) {
    return { ok: true, integrated: false, matchCore, reason: R.NOT_APPLICABLE, ...envelope };
  }
  if (result.ball.state === BS.IN_TRANSIT) {
    return { ok: true, integrated: false, matchCore, reason: R.NO_POSITION_CHANGE, ...envelope };
  }

  const res = applyInstantBallPositionUpdate(matchCore, result.ball.position);
  if (!res.ok) return { ok: false, integrated: false, reason: res.reason, ...envelope };
  return { ok: true, integrated: true, matchCore: res.matchCore, reason: null, ...envelope };
}