/**
 * Action / Interaction → Ball Movement State Adapter Foundation（Step 39F-M-C-24）。
 * 层级归属：Simulation Core / Match Movement。**纯函数、确定性、Immutable、无 Math.random、无墙钟**。
 *
 * 职责：消费**已存在的** Action / Interaction Resolution Result，读取其中**已经确定**的球运动边界，
 *       归一化为 C-23 可消费的 Ball Movement State。**不重新实现 Action / Interaction Resolution**。
 *
 * 因果链（单向，冻结）：
 *   ActionInstance ─▶ Existing Action / Interaction Resolution ─▶ C-24 Adapter ─▶ Ball Movement State ─▶ C-23 Integration ─▶ MatchCore.ball.position
 *
 * 边界（冻结）：
 * - **不决定球怎么运动**：只读取结果里已存在的运动边界；无边界 → `BALL_MOVEMENT_NOT_SPECIFIED`（业务正常，非崩溃）。
 * - 不根据 actionType / player position / direction / random 猜测球的位置；无 `x += 0.1` 之类规则。
 * - **不修改 MatchCore**；不写 `matchCore.ball.position`（C-23 才是 Position Write Authority）。
 * - 不调用 C-14 / C-15 / C-20 / C-21 / C-22；不判断进球。
 * - 不建立 Velocity / Physics / Collision / Movement Ledger / Event ID。
 * - 产出 adherence：movementState 为 **C-23 canonical Movement State**（可被 C-23 直接消费）；
 *   provenance（ACTION_BALL_MOVEMENT / action-ball-movement-v1）记录在 Adapter 结果信封上。
 *
 * Deferred：Velocity / Acceleration / Force / Spin / Curve / Gravity / Bounce / Collision / Ball Physics；
 *           Interaction 结果暴露正式 Movement Boundary（当前仅 PASS transit 具备）；C-22 Tick Integration。
 */

import { createBallMovementState } from './ball-movement-state.js';

export const ACTION_BALL_MOVEMENT_SOURCE = 'ACTION_BALL_MOVEMENT';
export const ACTION_BALL_MOVEMENT_RULE_VERSION = 'action-ball-movement-v1';

export const ACTION_BALL_MOVEMENT_REASON = Object.freeze({
  INVALID_ACTION_RESULT: 'INVALID_ACTION_RESULT',
  BALL_MOVEMENT_NOT_SPECIFIED: 'BALL_MOVEMENT_NOT_SPECIFIED',
  INVALID_POSITION: 'INVALID_POSITION',
  INVALID_DURATION: 'INVALID_DURATION',
  INVALID_DISPLACEMENT: 'INVALID_DISPLACEMENT',
  MOVEMENT_START_POSITION_MISMATCH: 'MOVEMENT_START_POSITION_MISMATCH',
  MOVEMENT_DURATION_NOT_SPECIFIED: 'MOVEMENT_DURATION_NOT_SPECIFIED',
});

const R = ACTION_BALL_MOVEMENT_REASON;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** 读取合法点（新对象）；非法返回 null。 */
function readPoint(p) {
  if (!isObj(p)) return null;
  return typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y)
    ? { x: p.x, y: p.y } : null;
}

/** 结果是否显式携带 movement 边界字段。 */
function hasExplicitMovementFields(result) {
  return result.startPosition !== undefined || result.endPosition !== undefined || result.displacement !== undefined;
}

/**
 * 从已存在的 Action / Interaction Result 中读取运动边界（不推断、不计算）。
 * 优先级：显式 movement 块 → PASS transit → 顶层显式字段。
 * @returns {{startPosition?,endPosition?,displacement?,duration?,kind}|null}
 */
function extractMovementBoundary(result) {
  if (isObj(result.movement)) {
    const m = result.movement;
    return { startPosition: m.startPosition, endPosition: m.endPosition, displacement: m.displacement, duration: m.duration, kind: 'MOVEMENT_BLOCK' };
  }
  if (isObj(result.transit)) {
    const t = result.transit;
    return { startPosition: t.from, endPosition: t.to, displacement: undefined, duration: t.duration, kind: 'TRANSIT' };
  }
  if (hasExplicitMovementFields(result)) {
    return { startPosition: result.startPosition, endPosition: result.endPosition, displacement: result.displacement, duration: result.duration, kind: 'EXPLICIT_FIELDS' };
  }
  return null;
}

/**
 * 由 Action / Interaction Resolution Result 派生 Ball Movement State。
 *
 * @param {object} actionResult 已存在的 Action / Interaction Resolution Result（只读）
 * @param {object} [context] { matchCore? } —— 可提供 Tick Ball Position Context 作为 startPosition 来源
 * @returns {object} 成功 `{ ok:true, movementApplied:true, movementState, source, ruleVersion }`；
 *                   无运动边界 `{ ok:true, movementApplied:false, movementState:null, reason:BALL_MOVEMENT_NOT_SPECIFIED, ... }`；
 *                   失败 `{ ok:false, reason, source, ruleVersion }`
 */
export function deriveBallMovementStateFromAction(actionResult, context = {}) {
  const provenance = { source: ACTION_BALL_MOVEMENT_SOURCE, ruleVersion: ACTION_BALL_MOVEMENT_RULE_VERSION };

  if (!isObj(actionResult) || actionResult.ok === false) {
    return { ok: false, reason: R.INVALID_ACTION_RESULT, ...provenance };
  }

  const raw = extractMovementBoundary(actionResult);
  if (!raw) {
    // 业务正常：该 Action 没有 Ball Movement（不是系统崩溃，也不是 Action 失败）。
    return { ok: true, movementApplied: false, movementState: null, reason: R.BALL_MOVEMENT_NOT_SPECIFIED, ...provenance };
  }

  const ctxStart = readPoint(context?.matchCore?.ball?.position);
  const hasStart = raw.startPosition !== undefined && raw.startPosition !== null;
  let start;
  if (hasStart) {
    start = readPoint(raw.startPosition);
    if (!start) return { ok: false, reason: R.INVALID_POSITION, ...provenance };
    // Start Position 一致性：Result 提供的 start 必须与 Ball Position Context 一致（不自动选择其一）。
    if (ctxStart && (start.x !== ctxStart.x || start.y !== ctxStart.y)) {
      return { ok: false, reason: R.MOVEMENT_START_POSITION_MISMATCH, ...provenance };
    }
  } else {
    start = ctxStart; // 仅从显式 Ball Position Context 取 start，不猜测。
    if (!start) return { ok: false, reason: R.INVALID_POSITION, ...provenance };
  }

  if (raw.duration === undefined || raw.duration === null) {
    return { ok: false, reason: R.MOVEMENT_DURATION_NOT_SPECIFIED, ...provenance };
  }

  const built = createBallMovementState({
    startPosition: start,
    ...(raw.endPosition !== undefined ? { endPosition: raw.endPosition } : {}),
    ...(raw.displacement !== undefined ? { displacement: raw.displacement } : {}),
    duration: raw.duration,
  });
  if (!built.ok) return { ok: false, reason: built.reason, ...provenance };

  return { ok: true, movementApplied: true, movementState: built, ...provenance };
}

/** 规则版本（metadata）。 */
export const ACTION_BALL_MOVEMENT_CONFIG_VERSION = ACTION_BALL_MOVEMENT_RULE_VERSION;