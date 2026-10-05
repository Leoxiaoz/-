/**
 * Ball Movement State Foundation（Step 39F-M-C-23）。
 * 层级归属：Simulation Core / Match Movement。**纯数据 + 纯函数、确定性、无 Math.random、无墙钟**。
 *
 * 职责：定义「一次 Ball Movement Boundary（startPosition → endPosition）」的标准化纯数据结构，
 *       并把外部输入（`start + end` 或 `start + displacement`）**归一化为统一 State**。
 *
 * 因果链（单向，冻结）：
 *   Ball Movement State ─▶ C-23 Ball Position Integration ─▶ MatchCore.ball.position
 *
 * 边界（冻结）：
 * - Movement State 只描述「球从哪里到哪里」，是 **Transient Input / State**；
 *   既不是 Ball Truth，也不是 Trajectory Truth，更不是 Velocity Truth。
 * - 只允许 `startPosition` / `endPosition` / 派生 `displacement`；
 *   **不含** velocity / acceleration / spin / curve / force / collision 等字段。
 * - 不 clamp 坐标；不判断进球；不依赖 Goal Geometry；不调用 C-14~C-22。
 * - 不建 Movement ID / Ledger / History；不建第二套 Position Truth。
 *
 * Deferred：Velocity / Physics / Collision / Spin / Bounce；Movement State 的产生方（Action / Interaction）。
 */

export const BALL_MOVEMENT_STATE_SOURCE = 'BALL_MOVEMENT_STATE';
export const BALL_MOVEMENT_STATE_RULE_VERSION = 'ball-movement-state-v1';

export const BALL_MOVEMENT_STATE_REASON = Object.freeze({
  INVALID_MOVEMENT_STATE: 'INVALID_MOVEMENT_STATE',
  INVALID_POSITION: 'INVALID_POSITION',
  INVALID_DURATION: 'INVALID_DURATION',
  INVALID_DISPLACEMENT: 'INVALID_DISPLACEMENT',
});

/** State 允许字段（严格白名单；无 velocity / acceleration / spin / force / collision）。 */
export const BALL_MOVEMENT_STATE_FIELDS = Object.freeze([
  'ok', 'startPosition', 'endPosition', 'displacement', 'duration', 'source', 'ruleVersion',
]);

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 读取一个合法点（返回新对象，绝不共享引用）；非法返回 null。 */
function readPoint(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  return isFiniteNum(p.x) && isFiniteNum(p.y) ? { x: p.x, y: p.y } : null;
}

/**
 * 标准化构造 Ball Movement State。
 * 输入：`{ startPosition, endPosition, duration }` 或 `{ startPosition, displacement, duration }`。
 * 同时提供 `endPosition` 与 `displacement` 时以前者为准，但二者必须自洽（否则 INVALID_DISPLACEMENT）。
 *
 * @param {object} input
 * @returns {object} 标准 Movement State 或 `{ ok:false, reason }`
 */
export function createBallMovementState(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: BALL_MOVEMENT_STATE_REASON.INVALID_MOVEMENT_STATE };
  }

  const start = readPoint(input.startPosition);
  if (!start) return { ok: false, reason: BALL_MOVEMENT_STATE_REASON.INVALID_POSITION };

  const hasEnd = input.endPosition !== undefined;
  const hasDisplacement = input.displacement !== undefined;
  if (!hasEnd && !hasDisplacement) {
    return { ok: false, reason: BALL_MOVEMENT_STATE_REASON.INVALID_POSITION };
  }

  const endInput = hasEnd ? readPoint(input.endPosition) : null;
  if (hasEnd && !endInput) return { ok: false, reason: BALL_MOVEMENT_STATE_REASON.INVALID_POSITION };

  const dispInput = hasDisplacement ? readPoint(input.displacement) : null;
  if (hasDisplacement && !dispInput) return { ok: false, reason: BALL_MOVEMENT_STATE_REASON.INVALID_DISPLACEMENT };

  let endPosition;
  if (hasEnd) {
    endPosition = { x: endInput.x, y: endInput.y };
    if (hasDisplacement
      && (dispInput.x !== endPosition.x - start.x || dispInput.y !== endPosition.y - start.y)) {
      return { ok: false, reason: BALL_MOVEMENT_STATE_REASON.INVALID_DISPLACEMENT };
    }
  } else {
    endPosition = { x: start.x + dispInput.x, y: start.y + dispInput.y };
  }

  const duration = input.duration;
  if (!isFiniteNum(duration) || duration <= 0) {
    return { ok: false, reason: BALL_MOVEMENT_STATE_REASON.INVALID_DURATION };
  }

  return {
    ok: true,
    startPosition: { x: start.x, y: start.y },
    endPosition,
    displacement: { x: endPosition.x - start.x, y: endPosition.y - start.y },
    duration,
    source: BALL_MOVEMENT_STATE_SOURCE,
    ruleVersion: BALL_MOVEMENT_STATE_RULE_VERSION,
  };
}

/**
 * 校验 Ball Movement State（纯函数，不抛异常；严格白名单 + 自洽性）。
 * @returns {{valid:boolean, issues:string[], reason:(string|null)}}
 */
export function validateBallMovementState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { valid: false, issues: ['INVALID_MOVEMENT_STATE'], reason: BALL_MOVEMENT_STATE_REASON.INVALID_MOVEMENT_STATE };
  }

  const issues = [];
  for (const key of Object.keys(state)) {
    if (!BALL_MOVEMENT_STATE_FIELDS.includes(key)) issues.push(`UNKNOWN_FIELD:${key}`);
  }
  if (state.ok !== true) issues.push('INVALID_OK');
  if (state.source !== BALL_MOVEMENT_STATE_SOURCE) issues.push('INVALID_SOURCE');
  if (state.ruleVersion !== BALL_MOVEMENT_STATE_RULE_VERSION) issues.push('INVALID_RULE_VERSION');

  const sp = readPoint(state.startPosition);
  const ep = readPoint(state.endPosition);
  const dp = readPoint(state.displacement);
  if (!sp || !ep) issues.push('INVALID_POSITION');
  if (!dp) issues.push('INVALID_DISPLACEMENT');
  if (!isFiniteNum(state.duration) || state.duration <= 0) issues.push('INVALID_DURATION');
  if (sp && ep && dp && (dp.x !== ep.x - sp.x || dp.y !== ep.y - sp.y)) issues.push('INVALID_DISPLACEMENT');

  let reason = null;
  if (issues.some((i) => i.startsWith('UNKNOWN_FIELD') || i === 'INVALID_OK' || i === 'INVALID_SOURCE' || i === 'INVALID_RULE_VERSION')) {
    reason = BALL_MOVEMENT_STATE_REASON.INVALID_MOVEMENT_STATE;
  } else if (issues.includes('INVALID_POSITION')) {
    reason = BALL_MOVEMENT_STATE_REASON.INVALID_POSITION;
  } else if (issues.includes('INVALID_DURATION')) {
    reason = BALL_MOVEMENT_STATE_REASON.INVALID_DURATION;
  } else if (issues.includes('INVALID_DISPLACEMENT')) {
    reason = BALL_MOVEMENT_STATE_REASON.INVALID_DISPLACEMENT;
  }

  return { valid: issues.length === 0, issues, reason };
}

/** 结构判断：是否为合法 Ball Movement State。 */
export function isBallMovementState(state) {
  return validateBallMovementState(state).valid;
}