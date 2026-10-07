/**
 * Ball Movement Segment / Tick Position Snapshot Foundation（Step 39F-M-C-16）。
 * 层级归属：Simulation Core / Match Orchestration。**纯函数、确定性、无 Math.random、无墙钟**。
 *
 * 职责：在**一次已完成的 Match Tick** 前后，对 Ball Position 取值快照（P0 / P1），
 *       生成离散 Movement Segment，供后续 C-15 Goal-Line Crossing 使用。
 *
 * 因果链（单向，冻结）：
 *   MatchCore.ball.position (Tick Start) ─┐
 *                                          ├─▶ Ball Movement Segment（transient derived）
 *   MatchCore.ball.position (Tick End)   ─┘
 *
 * 边界（冻结）：
 * - **不是**新的 Ball Truth：只读 Tick 开始 / 结束的 `matchCore.ball.position` 值快照；
 *   不建 `previousBallPosition / lastBallPosition / ballPositionHistory` 等第二套持久化 Truth。
 * - **不修改 MatchCore Schema**；不写 `ball.previousPosition / tickStartPosition / segment`。
 * - **不实现 Ball Physics**（无 velocity 积分 / gravity / bounce / spin / 碰撞 / 连续轨迹）；
 *   `P0 → P1` 仅为**离散 Tick 线段**，不声称是真实连续物理轨迹。
 * - **不自动接入** Goal Detection / Resolution / Score Update（属后续 Gate）。
 * - 不反向修改 Ball / Possession / MatchCore / Player / Tactical / Decision / Score。
 *
 * Deferred：Goal-Aware Tick Driver、Ball Physics、Trajectory、Continuous Simulation、GK / Shot / Set Pieces。
 */

import { runMatchTick } from './match-tick.js';

export const BALL_TICK_SEGMENT_RULE_VERSION = 'ball-tick-segment-v1';

export const BALL_SEGMENT_SOURCE = 'MATCH_TICK_BOUNDARY';

export const BALL_SEGMENT_REASON = Object.freeze({
  INVALID_START_MATCORE: 'INVALID_START_MATCORE',
  INVALID_END_MATCORE: 'INVALID_END_MATCORE',
  MISSING_BALL_POSITION: 'MISSING_BALL_POSITION',
  INVALID_POSITION: 'INVALID_POSITION',
  INVALID_SEGMENT: 'INVALID_SEGMENT',
});

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 读取并校验某个 MatchCore 的 ball.position 值快照（不返回原对象引用）。 */
function readBallPosition(matchCore, which) {
  if (!matchCore || typeof matchCore !== 'object') {
    return { ok: false, reason: which === 'start' ? BALL_SEGMENT_REASON.INVALID_START_MATCORE : BALL_SEGMENT_REASON.INVALID_END_MATCORE };
  }
  const ball = matchCore.ball;
  if (!ball || typeof ball !== 'object' || !ball.position || typeof ball.position !== 'object') {
    return { ok: false, reason: BALL_SEGMENT_REASON.MISSING_BALL_POSITION };
  }
  const { x, y } = ball.position;
  if (!isFiniteNum(x) || !isFiniteNum(y)) {
    return { ok: false, reason: BALL_SEGMENT_REASON.INVALID_POSITION };
  }
  return { ok: true, position: { x, y }, state: typeof ball.state === 'string' ? ball.state : null };
}

/**
 * 根据 Tick 开始 / 结束 MatchCore 的 Ball Position，生成离散 Movement Segment。
 * **值快照**：start/end 为新对象，绝不与 `matchCore.ball.position` 共享引用。
 *
 * @param {object} startMatchCore Tick 开始时的 MatchCore（只读）
 * @param {object} endMatchCore   Tick 结束时的 MatchCore（只读）
 * @param {object} [options] { tickIndex?: number }
 * @returns {object} Ball Movement Segment（纯 JSON）或 `{ ok:false, reason }`
 */
export function deriveBallTickSegment(startMatchCore, endMatchCore, options = {}) {
  const s = readBallPosition(startMatchCore, 'start');
  if (!s.ok) return { ok: false, reason: s.reason };
  const e = readBallPosition(endMatchCore, 'end');
  if (!e.ok) return { ok: false, reason: e.reason };

  const start = { x: s.position.x, y: s.position.y };
  const end = { x: e.position.x, y: e.position.y };
  const displacement = { x: end.x - start.x, y: end.y - start.y };
  const distance = Math.sqrt(displacement.x * displacement.x + displacement.y * displacement.y);
  const moved = displacement.x !== 0 || displacement.y !== 0;

  return {
    ok: true,
    tickIndex: Number.isInteger(options.tickIndex) ? options.tickIndex : null,
    start,
    end,
    displacement,
    distance,
    moved,
    ballStateAtStart: s.state,
    ballStateAtEnd: e.state,
    source: BALL_SEGMENT_SOURCE,
    ruleVersion: BALL_TICK_SEGMENT_RULE_VERSION,
  };
}

/** 结构判断：此 Segment 是否存在实际位移（距离 > 0）。 */
export function hasBallMovement(segment) {
  return !!segment && segment.ok === true && segment.moved === true && isFiniteNum(segment.distance) && segment.distance > 0;
}

/**
 * 校验 Ball Movement Segment（纯函数，不抛异常）。严格白名单。
 * @returns {{valid:boolean, issues:string[]}}
 */
export function validateBallTickSegment(segment) {
  const issues = [];
  if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
    return { valid: false, issues: [BALL_SEGMENT_REASON.INVALID_SEGMENT] };
  }
  const allowed = ['ok', 'tickIndex', 'start', 'end', 'displacement', 'distance', 'moved',
    'ballStateAtStart', 'ballStateAtEnd', 'source', 'ruleVersion'];
  for (const key of Object.keys(segment)) {
    if (!allowed.includes(key)) issues.push(`UNKNOWN_FIELD:${key}`);
  }
  if (segment.ok !== true) issues.push('INVALID_OK');
  if (segment.source !== BALL_SEGMENT_SOURCE) issues.push('INVALID_SOURCE');
  if (segment.ruleVersion !== BALL_TICK_SEGMENT_RULE_VERSION) issues.push('INVALID_RULE_VERSION');
  if (!(segment.tickIndex === null || Number.isInteger(segment.tickIndex))) issues.push('INVALID_TICK_INDEX');
  const point = (p) => p && typeof p === 'object' && isFiniteNum(p.x) && isFiniteNum(p.y);
  if (!point(segment.start)) issues.push('INVALID_START');
  if (!point(segment.end)) issues.push('INVALID_END');
  if (!point(segment.displacement)) issues.push('INVALID_DISPLACEMENT');
  if (!isFiniteNum(segment.distance) || segment.distance < 0) issues.push('INVALID_DISTANCE');
  if (typeof segment.moved !== 'boolean') issues.push('INVALID_MOVED');
  if (!(segment.ballStateAtStart === null || typeof segment.ballStateAtStart === 'string')) issues.push('INVALID_STATE_START');
  if (!(segment.ballStateAtEnd === null || typeof segment.ballStateAtEnd === 'string')) issues.push('INVALID_STATE_END');
  // 一致性：displacement / distance / moved 与 start·end 自洽。
  if (point(segment.start) && point(segment.end) && point(segment.displacement)) {
    const dx = segment.end.x - segment.start.x; const dy = segment.end.y - segment.start.y;
    if (segment.displacement.x !== dx || segment.displacement.y !== dy) issues.push('DISPLACEMENT_MISMATCH');
    const d = Math.sqrt(dx * dx + dy * dy);
    if (Math.abs(segment.distance - d) > 1e-12) issues.push('DISTANCE_MISMATCH');
    if (segment.moved !== (dx !== 0 || dy !== 0)) issues.push('MOVED_MISMATCH');
  }
  return { valid: issues.length === 0, issues };
}

/**
 * 极薄 Tick 边界适配器：**复用** C-08 `runMatchTick`（不重写 Tick 编排），
 * 在 Tick 前后取 Ball Position 快照并派生 Segment。
 * **不自动接入** Goal Detection / Resolution / Score Update。
 *
 * @param {object} matchCore Tick 输入 MatchCore
 * @param {object} [tickInput] 传给 runMatchTick 的 tickInput
 * @param {object} [options] { ruleVersion?, decisionRuleVersion?, interactionRuleVersion?, secondBallRuleVersion?, secondBallRange?, tickIndex? }
 * @returns {{ tick:object, segment:object }}
 */
export function runMatchTickWithBallSegment(matchCore, tickInput = {}, options = {}) {
  const tick = runMatchTick(matchCore, tickInput, options);          // C-08：唯一 Tick 编排
  const tickIndex = Number.isInteger(tickInput?.tickIndex)
    ? tickInput.tickIndex
    : (Number.isInteger(options.tickIndex) ? options.tickIndex : null);
  const segment = deriveBallTickSegment(matchCore, tick.matchCore, { tickIndex });
  return { tick, segment };
}

/** 规则版本（metadata）。 */
export const BALL_TICK_SEGMENT_CONFIG_VERSION = BALL_TICK_SEGMENT_RULE_VERSION;