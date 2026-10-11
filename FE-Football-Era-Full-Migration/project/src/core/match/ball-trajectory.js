/**
 * Ball Trajectory / Tick-Internal Movement Foundation（Step 39F-M-C-19）。
 * 层级归属：Simulation Core / Ball Movement。**纯函数、确定性、无 Math.random、无墙钟、无真实物理**。
 *
 * 职责：把一段时间内的 Ball 位移表达为「Tick 内离散 Position Samples」（P0 → S1 → … → P1），
 * 为 C-15 Goal-Line Crossing 提供更细粒度的候选线段。
 *
 * 定位（冻结）：
 * - Trajectory 是 **transient derived / simulation result**，不是第二套 Ball Truth。
 * - **不写回** MatchCore（无 `ball.trajectory / samples / path / history / previousPosition`）。
 * - 只做 **Deterministic Linear Movement**：P(t) = P0 + (P1 − P0)·t，t ∈ [0,1]。
 * - 不 clamp 位置（越界坐标保留，供 Goal-Line 判定使用）。
 *
 * 边界（冻结）：
 * - 不依赖 C-14 / C-15 / C-17 / C-18（Goal 层位于其上层）。
 * - 不创建 Clock / Velocity / Position Truth；`velocity` 仅为派生值。
 * - 仅离散采样，**不宣称**连续物理解。
 *
 * Deferred：acceleration / gravity / friction / drag / bounce / spin / curve / collision / radius /
 * CCD / 真实轨迹 / Shot·Pass·Dribble physics / 自动 Goal Detection 集成 / Goal Event Persistence。
 */

export const BALL_TRAJECTORY_RULE_VERSION = 'ball-trajectory-v1';
export const DEFAULT_SAMPLE_COUNT = 2;
export const MAX_SAMPLE_COUNT = 64;
export const MIN_SAMPLE_COUNT = 2;
export const TRAJECTORY_SOURCE = 'TICK_INTERNAL_TRAJECTORY';

export const TRAJECTORY_REASON = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_START: 'MISSING_START',
  MISSING_END: 'MISSING_END',
  INVALID_POSITION: 'INVALID_POSITION',
  INVALID_SAMPLE_COUNT: 'INVALID_SAMPLE_COUNT',
  SAMPLE_COUNT_OUT_OF_RANGE: 'SAMPLE_COUNT_OUT_OF_RANGE',
  INVALID_DURATION: 'INVALID_DURATION',
});

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPoint = (p) => p && typeof p === 'object' && isFiniteNum(p.x) && isFiniteNum(p.y);
const clonePoint = (p) => ({ x: p.x, y: p.y });

/**
 * 生成线性离散采样（纯函数）。
 * @param {{x:number,y:number}} start P0
 * @param {{x:number,y:number}} end P1
 * @param {number} [sampleCount] 采样数（≥2）
 * @returns {{ok:boolean, reason?:string, samples?:{t:number,x:number,y:number}[]}}
 */
export function sampleTrajectory(start, end, sampleCount = DEFAULT_SAMPLE_COUNT) {
  if (!isPoint(start)) return { ok: false, reason: TRAJECTORY_REASON.MISSING_START };
  if (!isPoint(end)) return { ok: false, reason: TRAJECTORY_REASON.MISSING_END };
  if (!Number.isInteger(sampleCount) || sampleCount < MIN_SAMPLE_COUNT || sampleCount > MAX_SAMPLE_COUNT) {
    return { ok: false, reason: TRAJECTORY_REASON.INVALID_SAMPLE_COUNT };
  }
  const n = sampleCount;
  const samples = [];
  const denom = n - 1;
  for (let i = 0; i < n; i += 1) {
    const t = i / denom;
    // 首尾精确锚定 P0 / P1，避免浮点漂移。
    if (i === 0) samples.push({ t: 0, x: start.x, y: start.y });
    else if (i === denom) samples.push({ t: 1, x: end.x, y: end.y });
    else samples.push({ t, x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
  }
  return { ok: true, samples };
}

/**
 * 由 Movement Input 派生 Ball Trajectory（纯函数）。
 *
 * @param {{startPosition:{x,y}, endPosition?:{x,y}, displacement?:{x,y}, duration?:number, sampleCount?:number, tickIndex?:number}} input
 * @param {{sampleCount?:number}} [options]
 * @returns {object} Trajectory（纯 JSON）或 { ok:false, reason }
 */
export function deriveBallTrajectory(input, options = {}) {
  if (!input || typeof input !== 'object') return { ok: false, reason: TRAJECTORY_REASON.INVALID_INPUT };
  const start = input.startPosition;
  if (!isPoint(start)) return { ok: false, reason: TRAJECTORY_REASON.MISSING_START };

  let end;
  if (input.endPosition !== undefined) {
    if (!isPoint(input.endPosition)) return { ok: false, reason: TRAJECTORY_REASON.MISSING_END };
    end = input.endPosition;
  } else if (input.displacement !== undefined) {
    if (!isPoint(input.displacement)) return { ok: false, reason: TRAJECTORY_REASON.MISSING_END };
    end = { x: start.x + input.displacement.x, y: start.y + input.displacement.y };
  } else {
    return { ok: false, reason: TRAJECTORY_REASON.MISSING_END };
  }

  if (input.duration !== undefined && (!isFiniteNum(input.duration) || input.duration <= 0)) {
    return { ok: false, reason: TRAJECTORY_REASON.INVALID_DURATION };
  }

  const sampleCount = options.sampleCount ?? input.sampleCount ?? DEFAULT_SAMPLE_COUNT;
  const sampled = sampleTrajectory(start, end, sampleCount);
  if (!sampled.ok) {
    const reason = (!Number.isInteger(sampleCount) || sampleCount < MIN_SAMPLE_COUNT || sampleCount > MAX_SAMPLE_COUNT)
      ? TRAJECTORY_REASON.SAMPLE_COUNT_OUT_OF_RANGE : sampled.reason;
    return { ok: false, reason };
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const duration = input.duration ?? null;
  const velocity = (isFiniteNum(duration) && duration > 0) ? { x: dx / duration, y: dy / duration } : null;

  return {
    ok: true,
    tickIndex: Number.isInteger(input.tickIndex) ? input.tickIndex : null,
    start: clonePoint(start),
    end: clonePoint(end),
    samples: sampled.samples,
    sampleCount: sampled.samples.length,
    duration,
    distance,
    displacement: { x: dx, y: dy },
    velocity, // 派生值（非 Truth）
    source: TRAJECTORY_SOURCE,
    ruleVersion: BALL_TRAJECTORY_RULE_VERSION,
  };
}

/**
 * 校验 Trajectory（结构 + 自洽；不抛异常）。
 * @returns {{valid:boolean, issues:string[]}}
 */
export function validateBallTrajectory(trajectory) {
  const issues = [];
  if (!trajectory || typeof trajectory !== 'object') return { valid: false, issues: ['NOT_OBJECT'] };
  if (trajectory.ok !== true) issues.push('NOT_OK');
  if (!isPoint(trajectory.start)) issues.push('INVALID_START');
  if (!isPoint(trajectory.end)) issues.push('INVALID_END');
  if (!Array.isArray(trajectory.samples) || trajectory.samples.length < MIN_SAMPLE_COUNT) {
    issues.push('INVALID_SAMPLES');
  } else {
    const s = trajectory.samples;
    for (const p of s) {
      if (!isFiniteNum(p?.t) || !isFiniteNum(p?.x) || !isFiniteNum(p?.y)) issues.push('INVALID_SAMPLE');
      else if (p.t < 0 || p.t > 1) issues.push('SAMPLE_T_OUT_OF_RANGE');
    }
    if (s[0].t !== 0 || s[0].x !== trajectory.start?.x || s[0].y !== trajectory.start?.y) issues.push('FIRST_NOT_START');
    const last = s[s.length - 1];
    if (last.t !== 1 || last.x !== trajectory.end?.x || last.y !== trajectory.end?.y) issues.push('LAST_NOT_END');
    for (let i = 1; i < s.length; i += 1) if (!(s[i].t >= s[i - 1].t)) issues.push('T_NOT_MONOTONIC');
  }
  if (trajectory.source !== TRAJECTORY_SOURCE) issues.push('INVALID_SOURCE');
  return { valid: issues.length === 0, issues };
}