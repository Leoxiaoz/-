/**
 * Goal-Aware Match Tick Driver（Step 39F-M-C-17）。
 * 层级归属：Simulation Core / Match Orchestration。**纯编排、确定性、无 Math.random、无墙钟**。
 *
 * 因果链（单向，冻结）：
 *   Ball Truth ─▶ C-16 Segment ─▶ C-15 Goal Geometry ─▶ C-14 Goal Resolution ─▶ C-14 Score Write ─▶ matchCore.score
 *
 * 职责：在一次 Match Tick 后处理 Ball Movement Segment；若从场内穿过有效球门线，则自动生成
 *       Goal Candidate（C-15）→ Goal Resolution（C-14）→ Score Update（C-14）。
 *
 * 边界（冻结）：
 * - **不复制** Tick 生命周期：复用 C-08 `runMatchTick`（经 C-16 适配器）。
 * - **不复制** Goal Geometry / Candidate / Resolution：全部复用 C-15 / C-14。
 * - **不写比分**：唯一写入口为 C-14 `applyGoalScoreUpdate`。
 * - 不建第二套 Ball / Score / Goal Geometry Truth；不建 goal ledger / history / registry。
 * - Goal metadata 为 **transient result**，不进入 MatchCore Truth。
 * - 不创建 / 修改 Clock、Phase、tickIndex；不调用 C-13 FinalMatchResult。
 * - 只消费 P0 → P1；不实现 Ball Physics。
 *
 * 一个 Tick = 一个离散 Segment（Tick 内多次穿越 / 折返属未来 Ball Physics / Trajectory Gate）。
 *
 * Deferred：Ball Physics / Trajectory / GK / Shot / Set Pieces / Offside / Foul / VAR / Match Result Finalization。
 */

import { runMatchTickWithBallSegment } from './ball-tick-segment.js';
import { deriveGoalGeometry, detectGoalLineCrossing, createGoalCandidateFromCrossing } from './goal-geometry.js';
import { resolveGoal, applyGoalScoreUpdate } from './goal-resolution.js';

export const GOAL_AWARE_TICK_RULE_VERSION = 'goal-aware-match-tick-v1';

export const GOAL_AWARE_STATUS = Object.freeze({
  NO_GOAL: 'NO_GOAL',
  GOAL_CONFIRMED: 'GOAL_CONFIRMED',
});

export const GOAL_AWARE_REASON = Object.freeze({
  NO_SEGMENT: 'NO_SEGMENT',
  NO_MOVEMENT: 'NO_MOVEMENT',
  NO_CROSSING: 'NO_CROSSING',
  CANDIDATE_REJECTED: 'CANDIDATE_REJECTED',
  RESOLUTION_NO_GOAL: 'RESOLUTION_NO_GOAL',
});

/**
 * 由显式 Segment 解析进球（复用 C-15 + C-14；**不修改** 输入 MatchCore）。
 * 供 Goal-Aware Driver 复用，也可独立用于确定性测试。
 *
 * @param {object} matchCore Tick 结束时的 MatchCore（只读；比分以此为准）
 * @param {object} segment C-16 Ball Movement Segment
 * @param {object} [options] { geometry?, phase?, playerId?, goalId? }
 * @returns {{ goal:object, matchCore:object }}
 */
export function resolveGoalFromSegment(matchCore, segment, options = {}) {
  const noGoal = (reason, extra = {}) => ({
    goal: { status: GOAL_AWARE_STATUS.NO_GOAL, reason, crossing: null, candidate: null, resolution: null, ...extra },
    matchCore,
  });

  if (!segment || segment.ok !== true) return noGoal(GOAL_AWARE_REASON.NO_SEGMENT);
  if (segment.moved !== true) return noGoal(GOAL_AWARE_REASON.NO_MOVEMENT);

  const geometry = options.geometry ?? deriveGoalGeometry(matchCore);
  const crossing = detectGoalLineCrossing(segment.start, segment.end, geometry);       // C-15
  if (!crossing.crossed) return noGoal(GOAL_AWARE_REASON.NO_CROSSING);

  const candidate = createGoalCandidateFromCrossing(crossing, matchCore, {               // C-15
    ballState: segment.ballStateAtEnd,
    playerId: options.playerId,
    goalId: options.goalId,
  });
  if (!candidate.ok) {
    return { goal: { status: GOAL_AWARE_STATUS.NO_GOAL, reason: GOAL_AWARE_REASON.CANDIDATE_REJECTED, crossing, candidate, resolution: null }, matchCore };
  }

  const resolution = resolveGoal(candidate, matchCore, { phase: options.phase });         // C-14
  if (!resolution.ok) {
    return { goal: { status: GOAL_AWARE_STATUS.NO_GOAL, reason: GOAL_AWARE_REASON.RESOLUTION_NO_GOAL, crossing, candidate, resolution }, matchCore };
  }

  const updated = applyGoalScoreUpdate(matchCore, resolution);                            // C-14（唯一 Score Write）
  return { goal: { status: GOAL_AWARE_STATUS.GOAL_CONFIRMED, reason: resolution.reason, crossing, candidate, resolution }, matchCore: updated };
}

/**
 * Goal-Aware Match Tick：基础 Tick（C-08/C-16）→ 进球后处理（C-15/C-14）。
 *
 * @param {object} matchCore Tick 输入 MatchCore
 * @param {object} [options] { tickInput?, phase?, geometry?, playerId?, goalId?, tickIndex?, ruleVersion?, decisionRuleVersion?, interactionRuleVersion?, secondBallRuleVersion?, secondBallRange? }
 * @returns {object} Goal Result Envelope（纯 JSON；transient goal metadata）
 */
export function runGoalAwareMatchTick(matchCore, options = {}) {
  if (!matchCore || typeof matchCore !== 'object') throw new TypeError('runGoalAwareMatchTick: matchCore 必须为对象');

  const { tick, segment } = runMatchTickWithBallSegment(matchCore, options.tickInput ?? {}, options); // C-08 + C-16
  const { goal, matchCore: finalCore } = resolveGoalFromSegment(tick.matchCore, segment, options);

  return {
    ok: true,
    matchCore: finalCore,
    tickResult: tick,
    ballSegment: segment,
    goal,
    ruleVersion: GOAL_AWARE_TICK_RULE_VERSION,
  };
}

/** 规则版本（metadata）。 */
export const GOAL_AWARE_MATCH_TICK_CONFIG_VERSION = GOAL_AWARE_TICK_RULE_VERSION;