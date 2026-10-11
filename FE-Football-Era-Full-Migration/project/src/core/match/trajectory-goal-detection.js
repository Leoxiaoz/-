/**
 * Trajectory-Aware Goal-Line Detection（Step 39F-M-C-20）。
 * 层级归属：Simulation Core / Match Geometry Adapter。**纯函数、确定性、无 Math.random、无墙钟**。
 *
 * 因果链（单向，冻结）：
 *   C-19 Ball Trajectory → C-20 逐段 Goal-Line Detection → C-15 Goal Geometry →（上层 C-14 Goal Resolution）
 *
 * 职责：把一个 Tick 内的离散 Ball Trajectory（P0 → S1 → … → P1）拆成相邻 Sample Segment，
 *       逐段调用 C-15 `detectGoalLineCrossing`，收集**所有** Goal-Line Crossing（含多次穿越 / 折返）。
 *
 * 边界（冻结）：
 * - **复用** C-15 的几何与判定（`detectGoalLineCrossing` / `intersectSegmentWithVerticalLine`）；
 *   **不复制** 球门线 / 门框 / 方向 / 交点公式；**不新增** epsilon。
 * - 只是 **Trajectory Consumer / Detection Adapter**，不是新的 Goal Truth。
 * - **不调用 C-14**、不写 Score、不升级为 GOAL_CONFIRMED、不做 Dedup / Ledger。
 * - 不修改 MatchCore / Ball / Geometry / Trajectory 输入；不实现 Ball Physics / Collision。
 *
 * Deferred：Goal Resolution（C-14）/ Score Write / Goal Event Persistence / Ball Physics / Collision /
 * 自动接入 C-17·C-18 / 重采样 / 递归细分。
 */

import { detectGoalLineCrossing, intersectSegmentWithVerticalLine } from './goal-geometry.js';

export const TRAJECTORY_GOAL_DETECTION_RULE_VERSION = 'trajectory-goal-detection-v1';
export const TRAJECTORY_GOAL_DETECTION_SOURCE = 'TRAJECTORY_GOAL_DETECTION';

export const TRAJECTORY_GOAL_REASON = Object.freeze({
  INVALID_TRAJECTORY: 'INVALID_TRAJECTORY',
  INVALID_GEOMETRY: 'INVALID_GEOMETRY',
  INVALID_SEGMENT: 'INVALID_SEGMENT',
});

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPoint = (p) => p && typeof p === 'object' && isFiniteNum(p.x) && isFiniteNum(p.y);

/** 校验 C-19 Trajectory 结构（不抛异常）。 */
function validateTrajectory(trajectory) {
  if (!trajectory || typeof trajectory !== 'object' || trajectory.ok !== true) return false;
  const { samples, sampleCount } = trajectory;
  if (!Array.isArray(samples) || samples.length < 2) return false;
  if (Number.isInteger(sampleCount) && samples.length !== sampleCount) return false;
  for (const s of samples) {
    if (!isFiniteNum(s?.t) || s.t < 0 || s.t > 1) return false;
    if (!isPoint(s)) return false;
  }
  if (samples[0].t !== 0) return false;
  if (samples[samples.length - 1].t !== 1) return false;
  return true;
}

/** 校验 Goal Geometry 结构（来自 C-15 deriveGoalGeometry）。 */
function validateGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') return false;
  for (const side of [geometry.left, geometry.right]) {
    if (!side || !isFiniteNum(side.lineX) || !isFiniteNum(side.yMin) || !isFiniteNum(side.yMax)) return false;
  }
  return true;
}

/**
 * 对 Trajectory 逐段执行 Goal-Line Detection（纯函数）。
 *
 * @param {object} trajectory C-19 Trajectory（只读）
 * @param {object} geometry C-15 deriveGoalGeometry 输出（只读）
 * @param {object} [options] 保留扩展（当前未使用）
 * @returns {object} TrajectoryGoalDetectionResult（纯 JSON）
 */
export function detectGoalsFromTrajectory(trajectory, geometry, options = {}) { // eslint-disable-line no-unused-vars
  if (!validateTrajectory(trajectory)) {
    return { ok: false, reason: TRAJECTORY_GOAL_REASON.INVALID_TRAJECTORY };
  }
  if (!validateGeometry(geometry)) {
    return { ok: false, reason: TRAJECTORY_GOAL_REASON.INVALID_GEOMETRY };
  }

  const { samples } = trajectory;
  const crossings = [];

  for (let i = 0; i + 1 < samples.length; i += 1) {
    const p0 = samples[i];
    const p1 = samples[i + 1];

    // 逐段调用 C-15（唯一 Geometry Truth）。
    const crossing = detectGoalLineCrossing(p0, p1, geometry);
    if (!crossing.ok) {
      return { ok: false, reason: TRAJECTORY_GOAL_REASON.INVALID_SEGMENT, segmentIndex: i };
    }
    if (!crossing.crossed) continue; // NO_CROSSING：保持 C-15 语义，继续后续 Segment。

    // 穿越在 Tick 内的归一化时间 crossingT：复用 C-15 交点参数（不自行推导几何）。
    const hit = intersectSegmentWithVerticalLine(p0, p1, crossing.crossingPoint.x);
    const segT = hit ? hit.t : 0;
    const crossingT = p0.t + (p1.t - p0.t) * segT;

    crossings.push({
      segmentIndex: i,
      t0: p0.t,
      t1: p1.t,
      crossingT,
      crossingPoint: { x: crossing.crossingPoint.x, y: crossing.crossingPoint.y },
      scoringSide: crossing.goalSide,
      scoringTeamId: crossing.scoringTeamId,
      defendingTeamId: crossing.defendingTeamId,
      reason: crossing.reason,
    });
  }

  return {
    ok: true,
    trajectoryTickIndex: Number.isInteger(trajectory.tickIndex) ? trajectory.tickIndex : null,
    segmentCount: samples.length - 1,
    crossings,
    goalCount: crossings.length,
    source: TRAJECTORY_GOAL_DETECTION_SOURCE,
    ruleVersion: TRAJECTORY_GOAL_DETECTION_RULE_VERSION,
  };
}

/**
 * 校验 TrajectoryGoalDetectionResult（结构 + 自洽）。
 * @returns {{valid:boolean, issues:string[]}}
 */
export function validateTrajectoryGoalDetectionResult(result) {
  const issues = [];
  if (!result || typeof result !== 'object') return { valid: false, issues: ['NOT_OBJECT'] };
  if (result.ok !== true) issues.push('NOT_OK');
  if (!Array.isArray(result.crossings)) issues.push('INVALID_CROSSINGS');
  if (!Number.isInteger(result.segmentCount) || result.segmentCount < 1) issues.push('INVALID_SEGMENT_COUNT');
  if (!Number.isInteger(result.goalCount)) issues.push('INVALID_GOAL_COUNT');
  else if (Array.isArray(result.crossings) && result.goalCount !== result.crossings.length) issues.push('GOAL_COUNT_MISMATCH');
  if (Array.isArray(result.crossings)) {
    for (let i = 0; i < result.crossings.length; i += 1) {
      const c = result.crossings[i];
      if (!Number.isInteger(c?.segmentIndex) || !isFiniteNum(c?.crossingT)) issues.push('INVALID_CROSSING');
      if (!isPoint(c?.crossingPoint)) issues.push('INVALID_CROSSING_POINT');
      if (i > 0 && c.crossingT < result.crossings[i - 1].crossingT) issues.push('CROSSINGS_NOT_ORDERED');
    }
  }
  if (result.source !== TRAJECTORY_GOAL_DETECTION_SOURCE) issues.push('INVALID_SOURCE');
  return { valid: issues.length === 0, issues };
}