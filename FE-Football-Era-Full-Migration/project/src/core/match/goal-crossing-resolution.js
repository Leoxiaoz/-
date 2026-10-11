/**
 * Goal Crossing → Goal Resolution / Score Integration（Step 39F-M-C-21）。
 * 层级归属：Simulation Core / Match Orchestration。**纯编排层：无副作用、无 Math.random、无墙钟**。
 *
 * 因果链（单向，冻结）：
 *   C-19 Trajectory → C-20 Goal-Line Detection → C-21 → C-14 resolveGoal → C-14 applyGoalScoreUpdate → matchCore.score
 *
 * 职责：接收 C-20 Detection Result，按 Trajectory 顺序把每个 crossing 转为 C-14 Goal Candidate，
 *       交给 C-14 解析 / 写比分，返回最终 MatchCore + transient resolution trace。
 *
 * 边界（冻结）：
 * - **Score Write Authority 只有 C-14**：本模块**从不**直接写 `matchCore.score`。
 * - **不复制** Goal Geometry（C-15）/ Goal Resolution Rule（C-14）/ Phase 判断。
 * - **无 Dedup Ledger**：幂等完全依赖 C-14 `nextScore` 单调收敛；不建 goalId/crossingId Set。
 * - **不保存 MatchCore 历史**（无 scoreHistory / snapshots），trace 仅存纯 JSON。
 * - **不生成** goalId / playerId（缺则保持 null，不推断）。
 *
 * Deferred：C-17/C-18 接入 / Match Tick / Ball Physics / Collision / Goal Event·History /
 * Player Attribution / Own Goal / VAR。
 */

import { resolveGoal, applyGoalScoreUpdate } from './goal-resolution.js';
import { GOAL_CROSSING_SOURCE } from './goal-geometry-config.js';
import { TRAJECTORY_GOAL_DETECTION_SOURCE } from './trajectory-goal-detection.js';

export const GOAL_CROSSING_RESOLUTION_RULE_VERSION = 'goal-crossing-resolution-v1';
export const GOAL_CROSSING_RESOLUTION_SOURCE = 'TRAJECTORY_GOAL_RESOLUTION';

export const GOAL_CROSSING_RESOLUTION_REASON = Object.freeze({
  INVALID_DETECTION_RESULT: 'INVALID_DETECTION_RESULT',
  INVALID_MATCH_CORE: 'INVALID_MATCH_CORE',
  INVALID_GOAL_CANDIDATE: 'INVALID_GOAL_CANDIDATE',
  GOAL_RESOLUTION_THREW: 'GOAL_RESOLUTION_THREW',
  SCORE_UPDATE_FAILED: 'SCORE_UPDATE_FAILED',
});

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** MatchCore 合法性（含唯一 Score Truth）。 */
function isValidMatchCore(matchCore) {
  if (!matchCore || typeof matchCore !== 'object') return false;
  const s = matchCore.score;
  if (!s || typeof s !== 'object' || !isFiniteNum(s.home) || !isFiniteNum(s.away)) return false;
  const t = matchCore.teams;
  return !!t && typeof t === 'object';
}

/** C-20 Detection Result 合法性。 */
function isValidDetectionResult(detectionResult) {
  return !!detectionResult && typeof detectionResult === 'object'
    && detectionResult.ok === true
    && Array.isArray(detectionResult.crossings)
    && detectionResult.source === TRAJECTORY_GOAL_DETECTION_SOURCE;
}

/**
 * 由 C-20 crossing 构造 C-14 可消费的 Goal Candidate（纯适配；不重判归属 / 不生成 ID）。
 * @returns {object} Goal Candidate | { ok:false, reason }
 */
export function createGoalCandidateFromTrajectoryCrossing(crossing, options = {}) {
  if (!crossing || typeof crossing !== 'object' || typeof crossing.scoringTeamId !== 'string') {
    return { ok: false, reason: GOAL_CROSSING_RESOLUTION_REASON.INVALID_GOAL_CANDIDATE };
  }
  return {
    ok: true,
    teamId: crossing.scoringTeamId,
    playerId: typeof options.playerId === 'string' ? options.playerId : null,
    ballState: typeof options.ballState === 'string' ? options.ballState : null,
    source: GOAL_CROSSING_SOURCE,
    reason: crossing.reason ?? GOAL_CROSSING_SOURCE,
    goalId: typeof options.goalId === 'string' ? options.goalId : null,
  };
}

/**
 * 将 C-20 Detection Result 逐 crossing 解析为 Goal Resolution 并写入 Score（纯编排）。
 *
 * @param {object} matchCore 当前 MatchCore（只读；Score 只经 C-14 写入）
 * @param {object} detectionResult C-20 输出（只读）
 * @param {object} [options] { phase?, ballState?, playerId?, goalId? }
 * @returns {object} TrajectoryGoalResolutionResult（纯 JSON）
 */
export function resolveTrajectoryGoalCrossings(matchCore, detectionResult, options = {}) {
  if (!isValidMatchCore(matchCore)) {
    return { ok: false, reason: GOAL_CROSSING_RESOLUTION_REASON.INVALID_MATCH_CORE };
  }
  if (!isValidDetectionResult(detectionResult)) {
    return { ok: false, reason: GOAL_CROSSING_RESOLUTION_REASON.INVALID_DETECTION_RESULT };
  }

  const { crossings } = detectionResult;
  const resolutions = [];
  let currentMatchCore = matchCore;
  let goalCount = 0;

  for (let i = 0; i < crossings.length; i += 1) {
    const crossing = crossings[i];

    // Candidate Adapter（失败 → fail-fast，保留已成功部分）。
    const candidate = createGoalCandidateFromTrajectoryCrossing(crossing, options);
    if (!candidate.ok) {
      return {
        ok: false,
        reason: GOAL_CROSSING_RESOLUTION_REASON.INVALID_GOAL_CANDIDATE,
        failedCrossingIndex: i,
        crossingsProcessed: resolutions.length,
        goalCount,
        currentMatchCore,
        resolutions,
      };
    }

    // C-14 Goal Resolution（唯一 Goal Rule）。异常 → fail-fast，不吞错。
    let goalResult;
    try {
      goalResult = resolveGoal(candidate, currentMatchCore, { phase: options.phase ?? null });
    } catch (err) {
      return {
        ok: false,
        reason: GOAL_CROSSING_RESOLUTION_REASON.GOAL_RESOLUTION_THREW,
        failedCrossingIndex: i,
        crossingsProcessed: resolutions.length,
        goalCount,
        currentMatchCore,
        resolutions,
        error: { message: err?.message ?? String(err) },
      };
    }

    // NO_GOAL（含 C-14 的 REGULATION_COMPLETE 阻断）→ 不写 Score，继续后续 crossing。
    if (!goalResult.ok) {
      resolutions.push({
        crossingIndex: i,
        segmentIndex: crossing.segmentIndex ?? null,
        candidate,
        goalResult,
        applied: false,
      });
      continue;
    }

    // GOAL_CONFIRMED → 唯一 Score Write Authority（C-14），使用返回的新 MatchCore 继续。
    let updated;
    try {
      updated = applyGoalScoreUpdate(currentMatchCore, goalResult);
    } catch (err) {
      return {
        ok: false,
        reason: GOAL_CROSSING_RESOLUTION_REASON.SCORE_UPDATE_FAILED,
        failedCrossingIndex: i,
        crossingsProcessed: resolutions.length,
        goalCount,
        currentMatchCore,
        resolutions,
        error: { message: err?.message ?? String(err) },
      };
    }
    if (!updated || typeof updated !== 'object') {
      return {
        ok: false,
        reason: GOAL_CROSSING_RESOLUTION_REASON.SCORE_UPDATE_FAILED,
        failedCrossingIndex: i,
        crossingsProcessed: resolutions.length,
        goalCount,
        currentMatchCore,
        resolutions,
      };
    }

    currentMatchCore = updated;
    goalCount += 1;
    resolutions.push({
      crossingIndex: i,
      segmentIndex: crossing.segmentIndex ?? null,
      candidate,
      goalResult,
      applied: true,
    });
  }

  return {
    ok: true,
    finalMatchCore: currentMatchCore,
    crossingsProcessed: crossings.length,
    goalCount,
    resolutions,
    source: GOAL_CROSSING_RESOLUTION_SOURCE,
    ruleVersion: GOAL_CROSSING_RESOLUTION_RULE_VERSION,
  };
}

/**
 * 校验 TrajectoryGoalResolutionResult（结构 + 自洽；不抛异常）。
 * @returns {{valid:boolean, issues:string[]}}
 */
export function validateTrajectoryGoalResolutionResult(result) {
  const issues = [];
  if (!result || typeof result !== 'object') return { valid: false, issues: ['NOT_OBJECT'] };
  if (result.ok !== true) issues.push('NOT_OK');
  if (result.source !== GOAL_CROSSING_RESOLUTION_SOURCE) issues.push('INVALID_SOURCE');
  if (result.ruleVersion !== GOAL_CROSSING_RESOLUTION_RULE_VERSION) issues.push('INVALID_RULE_VERSION');
  if (!Array.isArray(result.resolutions)) issues.push('INVALID_RESOLUTIONS');
  if (!Number.isInteger(result.goalCount)) issues.push('INVALID_GOAL_COUNT');
  if (!Number.isInteger(result.crossingsProcessed)) issues.push('INVALID_CROSSINGS_PROCESSED');
  if (Array.isArray(result.resolutions) && Number.isInteger(result.goalCount)) {
    const applied = result.resolutions.filter((r) => r.applied === true).length;
    if (applied !== result.goalCount) issues.push('GOAL_COUNT_MISMATCH');
  }
  if (!isValidMatchCore(result.finalMatchCore)) issues.push('INVALID_FINAL_MATCH_CORE');
  return { valid: issues.length === 0, issues };
}