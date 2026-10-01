/**
 * AI Potential Estimator —— AI Information Layer（D39 Phase 2 / Step 39F-B）。
 * 层级归属：Simulation Core / AI。纯函数：**不修改 state、不持久化、无 RNG（仅确定性 hash 派生）**。
 *
 * 规范来源：D39C-03（Step 39C 冻结）/ D39-M / Step 39E §一 / Step 39E-R §九、§十。
 *
 * 语义：AI **永远不能**读取 True Potential；AI 只能使用本模块给出的
 *   `Estimated Potential + Confidence`（AI Perception，**不是** Player Truth）。
 *
 * 红线：
 * - **禁止**读取 `profile.potential` / `potentialHeadroom` / 任何 True Potential 派生值。
 * - **禁止** `Math.random()` / `Date.now()`；同一 `(worldId, clubId, playerId, difficulty)` 结果恒等。
 * - **不写入** Player Runtime / Save；不入 Schema；不修改 Ability / Potential / Growth。
 * - 用户 §19：Growth Engine 使用 True Potential（World Simulation），本模块 **不得** 参与 Growth。
 *
 * 明确 Deferred：Scout / Scout Knowledge / Observation History / Staff / Scouting Reports / Information Memory。
 * 未来完整 Scouting System 可替换本模块内部实现，但对外 API 尽量保持 `estimatePotential(...)`。
 */

import { hashSeed, createRng } from '../rng.js';
import { getDevelopmentPhase } from './ai-development-phase.js';
import { getPlayerProfile, getEffectiveAttributes, deriveAverageRating } from '../player-runtime.js';
import { ageOn } from '../date-utils.js';
import { PLAYER_ATTRIBUTES, ATTRIBUTE_DEFAULT, ATTRIBUTE_RANGE } from '../../shared/football-schema.js';

/** Difficulty 枚举（Step 39F-B 只用于"信息质量"；完整 Difficulty System 属 Phase 7）。 */
export const AI_DIFFICULTY = Object.freeze({
  CASUAL: 'CASUAL',
  NORMAL: 'NORMAL',
  ADVANCED: 'ADVANCED',
  HARD: 'HARD',
  MASTER: 'MASTER',
});

/** 缺省难度（既有 AI 无 difficulty 上下文时使用）。 */
export const DEFAULT_AI_DIFFICULTY = AI_DIFFICULTY.NORMAL;

/** Difficulty → Perception Offset 绝对上限（Step 39E-R §九 冻结）。 */
export const PERCEPTION_OFFSET_MAX = Object.freeze({
  CASUAL: 4,
  NORMAL: 3,
  ADVANCED: 2,
  HARD: 1,
  MASTER: 1,
});

/** Phase → 估计起点偏移（Step 39E §一 P2-F1.2 冻结）。**不是 Growth**。 */
export const PHASE_BASE_PROJECTION = Object.freeze({
  EMERGING: 8,
  DEVELOPING: 6,
  ESTABLISHING: 4,
  PRIME: 2,
  VETERAN: 0,
});

/** Phase → Base Confidence（Step 39E §一 P2-F1.5 冻结）。 */
export const PHASE_BASE_CONFIDENCE = Object.freeze({
  EMERGING: 0.35,
  DEVELOPING: 0.45,
  ESTABLISHING: 0.60,
  PRIME: 0.75,
  VETERAN: 0.85,
});

/** Confidence 量程（冻结）。 */
export const CONFIDENCE_RANGE = Object.freeze({ MIN: 0.35, MAX: 0.95 });

/** Observable performance signal 量程（冻结）。 */
export const PERFORMANCE_SIGNAL_RANGE = Object.freeze({ MIN: -2, MAX: 2 });

/** Performance 基线（= 比赛评分模型的中性值 6.0）。 */
const PERFORMANCE_RATING_BASELINE = 6.0;
/** 满证据所需出场数（evidence = clamp(appearances / EVIDENCE_FULL, 0, 1)）。 */
const PERFORMANCE_EVIDENCE_FULL = 10;

function clamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** 归一化难度（未知 / 缺失 → NORMAL）。 */
export function normalizeDifficulty(difficulty) {
  return PERCEPTION_OFFSET_MAX[difficulty] != null ? difficulty : DEFAULT_AI_DIFFICULTY;
}

/**
 * Observable Performance Signal（Owner §七，∈[-2,+2]）。
 * 仅使用**已存在的赛季可观察数据**（出场数 + 平均评分），无任何 True Potential / 隐藏数据。
 *   evidence = clamp(appearances / 10, 0, 1)
 *   signal   = clamp((averageRating − 6.0) × evidence, −2, +2)
 * 无出场 / 无评分 ⇒ 0（无可观察证据）。
 * @returns {number} ∈ [-2, 2]
 */
export function observablePerformanceSignal(state, playerId) {
  const rt = state?.runtime?.players?.[playerId];
  const season = rt?.stats?.season ?? null;
  const appearances = Math.max(0, Math.floor(Number(season?.appearances) || 0));
  if (appearances <= 0) return 0;
  const avg = deriveAverageRating(season?.ratingSum, appearances);
  if (avg == null) return 0;
  const evidence = clamp(appearances / PERFORMANCE_EVIDENCE_FULL, 0, 1);
  return clamp((avg - PERFORMANCE_RATING_BASELINE) * evidence, PERFORMANCE_SIGNAL_RANGE.MIN, PERFORMANCE_SIGNAL_RANGE.MAX);
}

/**
 * Deterministic Perception Offset（Owner §八）：单值，作用于该球员全部属性。
 * 种子 = `worldId|potential-estimate|clubId|playerId|difficulty`（确定性，无 RNG 全局状态）。
 * @returns {number} ∈ [−max, +max]
 */
export function perceptionOffset(state, clubId, playerId, difficulty) {
  const d = normalizeDifficulty(difficulty);
  const max = PERCEPTION_OFFSET_MAX[d];
  const rng = createRng(hashSeed(`${state?.worldId ?? 'w'}|potential-estimate|${clubId}|${playerId}|${d}`));
  return (rng.next() * 2 - 1) * max;
}

/**
 * 估计某球员在**某俱乐部视角 / 某难度**下的潜在上限（AI Perception）。
 *
 * ```
 * estimated[attr] = clamp(CA[attr] + phaseBaseProjection + performanceSignal + perceptionOffset, CA[attr], 99)
 * overallHeadroom = clamp(average(estimated[attr] − CA[attr]), 0, 99)
 * confidence      = clamp(baseConfidence + clamp(appearances/20, 0, 0.10), 0.35, 0.95)
 * ```
 *
 * @param {object} state
 * @param {string} clubId
 * @param {string} playerId
 * @param {string} [difficulty='NORMAL']
 * @returns {{playerId: string, clubId: string, difficulty: string, estimated: Record<string, number>,
 *            overallHeadroom: number, confidence: number,
 *            phase: string, performanceSignal: number, perceptionOffset: number}|null}
 */
export function estimatePotential(state, clubId, playerId, difficulty = DEFAULT_AI_DIFFICULTY) {
  const profile = getPlayerProfile(state, playerId);
  if (!profile) return null;
  const d = normalizeDifficulty(difficulty);

  const eff = getEffectiveAttributes(state, playerId) ?? {};

  const age = profile.birthDate ? ageOn(profile.birthDate, state.currentDate) : NaN;
  const phase = getDevelopmentPhase(age);
  const baseProjection = PHASE_BASE_PROJECTION[phase] ?? 0;

  const perf = observablePerformanceSignal(state, playerId);
  const offset = perceptionOffset(state, clubId, playerId, d);
  const shift = baseProjection + perf + offset;

  const estimated = {};
  let headroomSum = 0;
  for (const attr of PLAYER_ATTRIBUTES) {
    const ca = Number.isFinite(Number(eff[attr])) ? Number(eff[attr]) : ATTRIBUTE_DEFAULT;
    const raw = ca + shift;
    const value = clamp(raw, ca, ATTRIBUTE_RANGE.MAX);
    estimated[attr] = value;
    headroomSum += value - ca;
  }
  const overallHeadroom = clamp(headroomSum / PLAYER_ATTRIBUTES.length, 0, 99);

  const appearances = Math.max(0, Math.floor(Number(state?.runtime?.players?.[playerId]?.stats?.season?.appearances) || 0));
  const evidenceBonus = clamp(appearances / 20, 0, 0.10);
  const baseConfidence = PHASE_BASE_CONFIDENCE[phase] ?? CONFIDENCE_RANGE.MIN;
  const confidence = clamp(baseConfidence + evidenceBonus, CONFIDENCE_RANGE.MIN, CONFIDENCE_RANGE.MAX);

  return {
    playerId,
    clubId,
    difficulty: d,
    estimated,
    overallHeadroom,
    confidence,
    // 可解释性附加字段（ephemeral，不持久化）
    phase,
    performanceSignal: perf,
    perceptionOffset: offset,
  };
}

/**
 * AI-only shared throat：估计潜在余量（**统一入口**，替代旧 `potentialHeadroom(profile)`）。
 * 内部直接调用 `estimatePotential`，不存在第二个绕过 estimator 的 AI 路径。
 * @returns {number} overallHeadroom（0–99）；球员不存在返回 0
 */
export function estimatePotentialHeadroom(state, clubId, playerId, difficulty = DEFAULT_AI_DIFFICULTY) {
  const est = estimatePotential(state, clubId, playerId, difficulty);
  return est ? est.overallHeadroom : 0;
}

/**
 * AI-facing：Development Value 的 Headroom Component（0–100）。
 * 由 Estimated Headroom 归一化（Owner §二十：Estimated Potential → Estimated Headroom → DV Headroom Component）。
 * `headroomScore = clamp(overallHeadroom / 25 × 100, 0, 100)`（与 D39E-R §八.1 同一归一化）。
 * @returns {number} 0–100
 */
export function estimateHeadroomScore(state, clubId, playerId, difficulty = DEFAULT_AI_DIFFICULTY) {
  const headroom = estimatePotentialHeadroom(state, clubId, playerId, difficulty);
  return clamp((headroom / 25) * 100, 0, 100);
}
