/**
 * Ball Movement State → Ball Position Integration（Step 39F-M-C-23）。
 * 层级归属：Simulation Core / Match Movement。**纯函数、确定性、Immutable、无 Math.random、无墙钟**。
 *
 * 职责：建立**唯一**的「合法 Ball Movement State → 新 MatchCore.ball.position」写入边界。
 *
 * 因果链（单向，冻结）：
 *   Ball Movement State ─▶ applyBallMovementPositionUpdate ─▶ MatchCore.ball.position（唯一 Ball Position Truth）
 *
 * 边界（冻结）：
 * - **Ball Position Truth = `MatchCore.ball.position`**；Movement State 仅为 transient input，
 *   不建 `ballMovement.position` / `trajectory.positionTruth` / `movementState.currentPosition` 等第二 Truth。
 * - **Start Position 一致性**：`movementState.startPosition` 必须等于 `matchCore.ball.position`，
 *   否则 `MOVEMENT_START_POSITION_MISMATCH`（**不自动修正**，避免 Movement State 偷偷成为第二 Ball Truth）。
 * - **忠实写入 endPosition，不 clamp**（Goal-Line Detection 需要观察 x>1 / x<0 / y 超界）。
 * - 只改 `ball.position`；**不修改** velocity / spin / rotation / control / possessingTeamId / state 等其他 Ball 字段。
 * - 不涉及 Possession / Ownership / Dribble / Tackle / Interception / Second Ball。
 * - **不调用 C-19**、不判断进球、不依赖 Goal Geometry、不调用 C-14 / C-15 / C-20 / C-21 / C-22。
 * - `inputMatchCore` 不得原地修改（`inputMatchCore !== outputMatchCore`）。
 * - 无 duration→velocity 换算；不建 Velocity / Physics / Collision / Movement Ledger。
 *
 * Deferred：Velocity / Acceleration / Force / Spin / Curve / Gravity / Bounce / Collision / Ball Physics；
 *           Multi-Tick Movement；Movement State 的产生方（Action / Interaction）；C-22 迁移。
 */

import {
  validateBallMovementState, BALL_MOVEMENT_STATE_REASON,
} from './ball-movement-state.js';

export const BALL_MOVEMENT_INTEGRATION_SOURCE = 'BALL_MOVEMENT_INTEGRATION';
export const BALL_MOVEMENT_INTEGRATION_RULE_VERSION = 'ball-movement-integration-v1';

export const BALL_MOVEMENT_INTEGRATION_REASON = Object.freeze({
  INVALID_MATCH_CORE: 'INVALID_MATCH_CORE',
  INVALID_MOVEMENT_STATE: 'INVALID_MOVEMENT_STATE',
  MOVEMENT_START_POSITION_MISMATCH: 'MOVEMENT_START_POSITION_MISMATCH',
});

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 读取并校验 matchCore.ball.position（唯一 Ball Position Truth 的来源）。 */
function readBallPosition(matchCore) {
  if (!matchCore || typeof matchCore !== 'object' || Array.isArray(matchCore)) {
    return { ok: false, reason: BALL_MOVEMENT_INTEGRATION_REASON.INVALID_MATCH_CORE };
  }
  const pos = matchCore.ball?.position;
  if (!pos || typeof pos !== 'object' || !isFiniteNum(pos.x) || !isFiniteNum(pos.y)) {
    return { ok: false, reason: BALL_MOVEMENT_INTEGRATION_REASON.INVALID_MATCH_CORE };
  }
  return { ok: true, position: { x: pos.x, y: pos.y } };
}

/**
 * 唯一 Position Integration：把合法 Ball Movement State 写入 `MatchCore.ball.position`。
 *
 * - 成功 → `{ ok:true, matchCore, source, ruleVersion }`（**新** MatchCore；`inputMatchCore` 不变）。
 * - 失败 → `{ ok:false, reason }`（不产生新 MatchCore，不自动修正）。
 *
 * @param {object} matchCore 输入 MatchCore（只读；其 `ball.position` 为唯一 Ball Position Truth）
 * @param {object} movementState 合法 Ball Movement State（由 C-23 State 层构造/校验）
 * @returns {object}
 */
export function applyBallMovementPositionUpdate(matchCore, movementState) {
  const current = readBallPosition(matchCore);
  if (!current.ok) return { ok: false, reason: current.reason };

  const v = validateBallMovementState(movementState);
  if (!v.valid) {
    return { ok: false, reason: v.reason ?? BALL_MOVEMENT_INTEGRATION_REASON.INVALID_MOVEMENT_STATE };
  }

  // Start Position 一致性（唯一权威 = matchCore.ball.position）。不一致 → 失败，不自动修正。
  if (current.position.x !== movementState.startPosition.x || current.position.y !== movementState.startPosition.y) {
    return { ok: false, reason: BALL_MOVEMENT_INTEGRATION_REASON.MOVEMENT_START_POSITION_MISMATCH };
  }

  // 忠实写入 endPosition（不 clamp）；其余 Ball 字段保持不变。
  const ball = matchCore.ball;
  const nextBall = { ...ball, position: { x: movementState.endPosition.x, y: movementState.endPosition.y } };

  return {
    ok: true,
    matchCore: { ...matchCore, ball: nextBall },
    source: BALL_MOVEMENT_INTEGRATION_SOURCE,
    ruleVersion: BALL_MOVEMENT_INTEGRATION_RULE_VERSION,
  };
}

/** 规则版本（metadata）。 */
export const BALL_MOVEMENT_INTEGRATION_CONFIG_VERSION = BALL_MOVEMENT_INTEGRATION_RULE_VERSION;

/** 便于调用方引用：Movement State 失败原因常量（不重复定义）。 */
export const BALL_MOVEMENT_INTEGRATION_STATE_REASON = BALL_MOVEMENT_STATE_REASON;