/**
 * Trajectory-Goal Match Tick Integration（Step 39F-M-C-22）。
 * 层级归属：Simulation Core / Match Orchestration。**纯编排、确定性、无 Math.random、无墙钟**。
 *
 * 因果链（单向，冻结）：
 *   C-08 Match Tick → C-19 Ball Trajectory → C-20 Goal-Line Detection → C-21 Goal Resolution → C-14 Score → Final MatchCore
 *
 * 职责：在一次 Match Tick 内编排「显式 Ball Movement Input → Trajectory → Crossing Detection → Goal Resolution/Score」。
 *
 * 边界（冻结）：
 * - **C-08 仍是 Tick 生命周期 Authority**：只调用 `runMatchTick`，**不复制** Validate/Snapshot/Action/Interaction/Integration/Invariant。
 * - **Movement Input 必须由调用方显式提供**：无则 `MISSING_BALL_MOVEMENT_INPUT`；结构非法则 `INVALID_BALL_MOVEMENT_INPUT`；
 *   **绝不**猜测 / 随机 / 自行推进球位置（无隐式 displacement）。
 * - **Trajectory ≠ MatchCore Ball**：不把 `trajectory.end` 写回 `matchCore.ball.position`（Ball Movement State 写入属未来 Gate）。
 * - **不绕过 C-20 / C-21**：Detection 经 C-20，Resolution/Score 经 C-21 → C-14；**不 import** goal-geometry / goal-resolution。
 * - **不写比分**：唯一入口为 C-14 `applyGoalScoreUpdate`（经 C-21）。
 * - 不建 Ball Movement / Velocity / Goal / Score Truth；无 Goal Ledger / History / Event；不保存 MatchCore 历史链。
 * - 不修改 C-08 / C-10 / C-14~C-21；不创建 Clock / Phase / tickIndex 语义。
 *
 * Deferred：Ball Movement State Truth / Velocity / Physics / Collision / Goal Event·ID·History /
 * Player Attribution / C-17·C-18 replacement / Multi-Tick Trajectory Driver / Match Result Finalization。
 */

import { runMatchTick } from './match-tick.js';
import { deriveBallTrajectory } from './ball-trajectory.js';
import { detectGoalsFromTrajectory } from './trajectory-goal-detection.js';
import { resolveTrajectoryGoalCrossings } from './goal-crossing-resolution.js';

export const TRAJECTORY_GOAL_MATCH_TICK_RULE_VERSION = 'trajectory-goal-match-tick-v1';
export const TRAJECTORY_GOAL_MATCH_TICK_SOURCE = 'TRAJECTORY_GOAL_MATCH_TICK';

export const TRAJECTORY_GOAL_MATCH_TICK_REASON = Object.freeze({
  INVALID_MATCH_CORE: 'INVALID_MATCH_CORE',
  MISSING_BALL_MOVEMENT_INPUT: 'MISSING_BALL_MOVEMENT_INPUT',
  INVALID_BALL_MOVEMENT_INPUT: 'INVALID_BALL_MOVEMENT_INPUT',
  MISSING_GEOMETRY: 'MISSING_GEOMETRY',
  TICK_FAILED: 'TICK_FAILED',
  TRAJECTORY_FAILED: 'TRAJECTORY_FAILED',
  GOAL_DETECTION_FAILED: 'GOAL_DETECTION_FAILED',
  GOAL_RESOLUTION_FAILED: 'GOAL_RESOLUTION_FAILED',
});

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isFiniteNonNeg = (v) => isFiniteNum(v) && v >= 0;
const isPoint = (p) => !!p && typeof p === 'object' && isFiniteNum(p.x) && isFiniteNum(p.y);

function isValidMatchCore(matchCore) {
  if (!matchCore || typeof matchCore !== 'object') return false;
  const s = matchCore.score;
  if (!s || typeof s !== 'object' || !isFiniteNonNeg(s.home) || !isFiniteNonNeg(s.away)) return false;
  return !!matchCore.teams && typeof matchCore.teams === 'object';
}

function isValidGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') return false;
  for (const side of [geometry.left, geometry.right]) {
    if (!side || !isFiniteNum(side.lineX) || !isFiniteNum(side.yMin) || !isFiniteNum(side.yMax)) return false;
  }
  return true;
}

/**
 * C-22 自身的最小 Movement Input 结构校验（存在性 / 形状）。
 * **不复制** C-19 的公式；`duration` / `sampleCount` 等由 C-19 判定（失败 → `TRAJECTORY_FAILED`）。
 */
function isValidMovementShape(movement) {
  if (!isPoint(movement.startPosition)) return false;
  if (movement.endPosition !== undefined) return isPoint(movement.endPosition);
  if (movement.displacement !== undefined) return isPoint(movement.displacement);
  return false;
}

/**
 * 纯编排：显式 Trajectory → C-20 Detection → C-21 Resolution / Score（**不修改任何输入**）。
 *
 * 供 Tick 入口复用，也可独立用于确定性测试（调用方显式提供合法 C-19 Trajectory）。
 * 本函数**不产生** Movement Truth、**不写** `matchCore.ball`、**不写** Score（Score 只经 C-21 → C-14）。
 *
 * @param {object} matchCore 当前 MatchCore（只读；Score 以此为准）
 * @param {object} trajectory C-19 Trajectory（只读；由调用方显式提供）
 * @param {object} geometry C-15 Goal Geometry（只读；由调用方显式提供）
 * @param {object} [options] { phase?, ballState?, playerId?, goalId? }
 * @returns {object} { ok, detection, resolution, finalMatchCore } | { ok:false, reason, ... }
 */
export function resolveTrajectoryGoalTick(matchCore, trajectory, geometry, options = {}) {
  if (!isValidMatchCore(matchCore)) {
    return { ok: false, reason: TRAJECTORY_GOAL_MATCH_TICK_REASON.INVALID_MATCH_CORE };
  }

  // C-20：Trajectory → 逐段 Crossing Detection（**不绕过 C-20**）。
  const detection = detectGoalsFromTrajectory(trajectory, geometry);
  if (!detection || detection.ok !== true) {
    return {
      ok: false, reason: TRAJECTORY_GOAL_MATCH_TICK_REASON.GOAL_DETECTION_FAILED,
      detection: detection ?? null, resolution: null, finalMatchCore: matchCore,
    };
  }

  // C-21：Crossing → C-14 Resolution / Score（**不直接调用 C-14**）。
  const resolution = resolveTrajectoryGoalCrossings(matchCore, detection, {
    phase: options.phase ?? null,
    ballState: options.ballState,
    playerId: options.playerId,
    goalId: options.goalId,
  });
  if (!resolution || resolution.ok !== true) {
    return {
      ok: false, reason: TRAJECTORY_GOAL_MATCH_TICK_REASON.GOAL_RESOLUTION_FAILED,
      detection, resolution: resolution ?? null,
      finalMatchCore: resolution?.currentMatchCore ?? matchCore,
    };
  }

  return { ok: true, detection, resolution, finalMatchCore: resolution.finalMatchCore };
}

/**
 * 执行一次 Trajectory-Goal Match Tick（纯编排）。
 *
 * 顺序（冻结）：Validate MatchCore → Validate Movement Input → runMatchTick（C-08）→ deriveBallTrajectory（C-19）
 *             → detectGoalsFromTrajectory（C-20）→ resolveTrajectoryGoalCrossings（C-21）→ Final MatchCore。
 *
 * @param {object} matchCore Tick 输入 MatchCore（只读）
 * @param {object} [options] {
 *   ballMovement: C-19 movementInput（**必填**，显式）
 *   geometry: C-15 Goal Geometry（**必填**，显式；C-22 不自行做 Geometry）
 *   tickInput?, phase?, playerId?, goalId?, ballState?
 * }
 * @returns {object} Trajectory Goal Tick Result（纯 JSON；transient trace）
 */
export function runTrajectoryGoalMatchTick(matchCore, options = {}) {
  // 1. Validate MatchCore
  if (!isValidMatchCore(matchCore)) {
    return { ok: false, reason: TRAJECTORY_GOAL_MATCH_TICK_REASON.INVALID_MATCH_CORE };
  }

  // 2. Validate Movement Input（显式；缺失 / 结构非法 → 不执行 Tick，§21）
  const movement = options.ballMovement;
  if (!movement || typeof movement !== 'object') {
    return { ok: false, reason: TRAJECTORY_GOAL_MATCH_TICK_REASON.MISSING_BALL_MOVEMENT_INPUT };
  }
  if (!isValidMovementShape(movement)) {
    return { ok: false, reason: TRAJECTORY_GOAL_MATCH_TICK_REASON.INVALID_BALL_MOVEMENT_INPUT };
  }

  // 2b. Validate Geometry（显式；C-22 不自行做 Geometry，§35）
  if (!isValidGeometry(options.geometry)) {
    return { ok: false, reason: TRAJECTORY_GOAL_MATCH_TICK_REASON.MISSING_GEOMETRY };
  }

  // 3. C-08：Tick 生命周期 Authority（**不复制**其内部阶段）。
  const matchTickResult = runMatchTick(matchCore, options.tickInput ?? {});
  if (!matchTickResult || matchTickResult.tick?.status !== 'COMPLETED') {
    return {
      ok: false, reason: TRAJECTORY_GOAL_MATCH_TICK_REASON.TICK_FAILED,
      matchTickResult: matchTickResult ?? null,
    };
  }
  const tickMatchCore = matchTickResult.matchCore;

  // 4. C-19：显式 Movement Input → Trajectory（**不重新实现 C-19 公式**）。
  const trajectory = deriveBallTrajectory(movement);
  if (!trajectory || trajectory.ok !== true) {
    return {
      ok: false, reason: TRAJECTORY_GOAL_MATCH_TICK_REASON.TRAJECTORY_FAILED,
      matchTickResult, trajectory: trajectory ?? null,
    };
  }

  // 5–6. C-20 → C-21（复用纯编排；Score 只经 C-21 → C-14）。
  const orchestration = resolveTrajectoryGoalTick(tickMatchCore, trajectory, options.geometry, {
    phase: options.phase, ballState: options.ballState, playerId: options.playerId, goalId: options.goalId,
  });
  if (!orchestration.ok) {
    return {
      ok: false, reason: orchestration.reason,
      matchTickResult, trajectory,
      detection: orchestration.detection ?? null,
      resolution: orchestration.resolution ?? null,
      finalMatchCore: orchestration.finalMatchCore ?? tickMatchCore,
    };
  }

  return {
    ok: true,
    tickIndex: matchTickResult.tick?.tickIndex ?? null,
    matchTickResult,
    trajectory,
    detection: orchestration.detection,
    resolution: orchestration.resolution,
    finalMatchCore: orchestration.finalMatchCore,
    source: TRAJECTORY_GOAL_MATCH_TICK_SOURCE,
    ruleVersion: TRAJECTORY_GOAL_MATCH_TICK_RULE_VERSION,
  };
}

/**
 * 校验 Trajectory Goal Tick Result（结构 + 自洽；不抛异常）。
 * @returns {{valid:boolean, issues:string[]}}
 */
export function validateTrajectoryGoalTickResult(result) {
  const issues = [];
  if (!result || typeof result !== 'object') return { valid: false, issues: ['NOT_OBJECT'] };
  if (result.ok !== true) issues.push('NOT_OK');
  if (result.source !== TRAJECTORY_GOAL_MATCH_TICK_SOURCE) issues.push('INVALID_SOURCE');
  if (result.ruleVersion !== TRAJECTORY_GOAL_MATCH_TICK_RULE_VERSION) issues.push('INVALID_RULE_VERSION');
  if (!result.matchTickResult || typeof result.matchTickResult !== 'object') issues.push('INVALID_MATCH_TICK_RESULT');
  if (!result.trajectory || result.trajectory.ok !== true) issues.push('INVALID_TRAJECTORY');
  if (!result.detection || result.detection.ok !== true) issues.push('INVALID_DETECTION');
  if (!result.resolution || result.resolution.ok !== true) issues.push('INVALID_RESOLUTION');
  if (!isValidMatchCore(result.finalMatchCore)) issues.push('INVALID_FINAL_MATCH_CORE');
  if (result.detection && result.resolution) {
    const scored = result.resolution.goalCount ?? 0;
    if (Number.isInteger(scored) && scored !== (result.detection.goalCount ?? scored)) {
      // goalCount 可小于 crossing（NO_GOAL），但不得大于 crossing 数。
      if (scored > (result.detection.goalCount ?? 0)) issues.push('GOAL_COUNT_EXCEEDS_CROSSINGS');
    }
  }
  return { valid: issues.length === 0, issues };
}