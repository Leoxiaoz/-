/**
 * 球员成长 / 衰退引擎（Simulation Core）—— Step 39F-C（D39 Phase 3）。
 * 层级归属：Simulation Core。纯逻辑，**不依赖 DOM / 存储 / UI**。
 *
 * 规范来源：D39.31–D39.38 / Step 39E §二~§十二 / **OD-39FC-1 · OD-39FC-2 · OD-39FC-3**（DECISIONS D-39）。
 * 每赛季结算一次，**六属性各自独立**（不存在 OVR / 总体分配）：
 *   Growth branch（age < peakAge）：
 *     headroomFactor = clamp((potential − current) / 20, 0, 1)
 *     ageFactor      = clamp(1 − 0.06 × ((peakAge − age)/(peakAge − 17))², 0, 1)      // OD-39FC-3
 *     baseCapacity   = 2.4 × ageFactor × headroomFactor
 *     inputFactor    = 0.75 + 0.50 × clamp(0.40·training + 0.40·matchExperience + 0.20·environment, 0, 1)
 *     preRandom      = clamp(baseCapacity × inputFactor + conditionAdjustment, −2.50, +2.50)
 *   Decline branch（age >= peakAge）：
 *     preRandom      = clamp(−(age − peakAge + 1) × 0.18 × sensitivity[attr] × floorFactor, −2.50, 0)
 *   Both：delta = clamp(round(preRandom + noise), −3, +3)，noise ∈ [−0.20, +0.20]（确定性 seed）
 *
 * Condition Adjustment（加性、有界）：Personality ∈ [−0.10,+0.10]；Form / Morale 分档 ±0.05/±0.02/0；
 * Severe Injury（`growth.injuryPenaltySeasons > 0`）−0.15。**Fitness 不进入 Growth。**
 *
 * 红线：
 * - **只写 runtime deltas**（`applyAbilityDelta`），绝不修改 `state.static`。
 * - 结果始终在 1–99 且 **≤ per-attribute Potential**（Runtime 层再夹取一次）。
 * - **确定性**：seed = `worldId|growth|playerId|season|attribute`；同一（库+档+种子）必复现；同赛季幂等。
 * - **无 BREAKOUT**、无 Talent / GrowthRate 字段；不使用 `Math.random()` / `Date.now()`。
 * - Potential 是 **World Simulation Ceiling** —— 本引擎可读 True Potential；**AI 侧不可读**（D39C-03）。
 */

import { PLAYER_ATTRIBUTES, ATTRIBUTE_RANGE } from '../shared/football-schema.js';
import { SimulationError } from '../shared/errors.js';
import { PLAYER_GROWTH_CONFIG } from './sim-config.js';
import { createRng, hashSeed } from './rng.js';
import { ageOn } from './date-utils.js';
import {
  getEffectiveAttributes,
  getPlayerRuntime,
  applyAbilityDelta,
  getPlayerProfile,
  getWorldPlayers,
} from './player-runtime.js';
import { getPlayerClub } from './membership.js';
import { evaluateDevelopmentEnvironment } from './ai/ai-development-environment.js';

const C = PLAYER_GROWTH_CONFIG;

/** 人格条件调整使用的三项（不新增 Personality 维度）。 */
const PERSONALITY_KEYS = Object.freeze(['professionalism', 'determination', 'ambition']);

function clamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Pre-peak 平滑 ageFactor（OD-39FC-3，**冻结公式，不得修改**）。
 * `normalizedDistance = (peakAge − age) / (peakAge − 17)`；`ageFactor = clamp(1 − 0.06 × d², 0, 1)`。
 * 边界：age = 17 → 0.94；age = peakAge → 1.00；随年龄增大单调不减；连续无跳变。
 * @returns {number} ∈ [0.94, 1]（峰值区间内）
 */
export function prePeakAgeFactor(age, peakAge) {
  const span = Number(peakAge) - C.PRE_PEAK.ANCHOR_AGE;
  if (!(span > 0)) return 1;
  const d = clamp((Number(peakAge) - Number(age)) / span, 0, 1);
  return clamp(1 - C.PRE_PEAK.CURVATURE * d * d, 0, 1);
}

/**
 * 解析 Training 输入：接受档位字符串（LIMITED/NORMAL/STRONG）或数值；数值夹取到冻结档位区间。
 * @returns {number} ∈ [0.75, 1.15]
 */
export function resolveTrainingInput(value) {
  if (typeof value === 'string' && C.TRAINING_LEVELS[value] != null) return C.TRAINING_LEVELS[value];
  const n = Number(value);
  if (!Number.isFinite(n)) return C.TRAINING_LEVELS[C.DEFAULT_TRAINING_LEVEL];
  return clamp(n, C.TRAINING_LEVELS.LIMITED, C.TRAINING_LEVELS.STRONG);
}

/** Match Experience（P3-F6 冻结）：`sqrt(clamp(minutes / 1800, 0, 1))`，>1800 不再增加。 */
export function matchExperienceInput(minutes) {
  return Math.sqrt(clamp(Number(minutes) / C.MATCH_EXPERIENCE_FULL_MINUTES, 0, 1));
}

/** 状态 / 士气的分档条件调整（39E §八 冻结）。 */
export function conditionBandAdjustment(value, bands = C.CONDITION.BANDS) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  for (const band of bands) {
    if (v >= band.min) return band.value;
  }
  return 0;
}

/** 人格条件调整：三项均值（1–99）→ 归一化 → ±0.10（39E §八 冻结）。 */
export function personalityAdjustment(personality) {
  let sum = 0;
  for (const key of PERSONALITY_KEYS) {
    const n = Number(personality?.[key]);
    sum += Number.isFinite(n) ? clamp(n, 1, 99) : 50;
  }
  const avg = sum / PERSONALITY_KEYS.length;
  const norm = (avg - 50) / 50; // −1..1
  return clamp(C.CONDITION.PERSONALITY_MAX * norm, -C.CONDITION.PERSONALITY_MAX, C.CONDITION.PERSONALITY_MAX);
}

/**
 * 某球员的 Development Environment 输入（∈[0,1]）。
 * 复用 Phase 1 的纯函数 `evaluateDevelopmentEnvironment`（无循环依赖）；
 * 自由球员（无俱乐部）使用中性值。**Environment 只作为 Development Input 的一部分**，
 * 不是 Growth multiplier；Club Strength / Reputation / Budget / Cash 均不参与。
 */
function environmentInputFor(state, playerId) {
  const clubId = getPlayerClub(state, playerId);
  if (!clubId) return C.NEUTRAL_ENVIRONMENT_INPUT;
  const env = evaluateDevelopmentEnvironment(state, clubId, playerId);
  if (!env || !Number.isFinite(env.environmentInput)) return C.NEUTRAL_ENVIRONMENT_INPUT;
  return clamp(env.environmentInput, 0, 1);
}

/**
 * 结算一名球员一个赛季的成长/衰退（内部）。
 * @returns {{ applied: boolean }}
 */
function developPlayer(state, playerId, seasonNumber, trainingInput, date) {
  const player = getPlayerProfile(state, playerId);
  const rt = getPlayerRuntime(state, playerId);
  if (!player || !rt) return { applied: false };
  if (rt.growth.lastEvaluatedSeason >= seasonNumber) return { applied: false }; // 幂等
  if (!player.birthDate) return { applied: false };

  const age = ageOn(player.birthDate, date);
  const effective = getEffectiveAttributes(state, playerId);

  // ---- Development Inputs（每赛季每球员一次）----
  const matchExperience = matchExperienceInput(rt.stats?.season?.minutes ?? 0);
  const environment = environmentInputFor(state, playerId);
  const w = C.INPUT_WEIGHTS;
  const rawInputScore = w.TRAINING * trainingInput
    + w.MATCH_EXPERIENCE * matchExperience
    + w.ENVIRONMENT * environment;
  const inputScore = clamp(rawInputScore, 0, 1);
  const inputFactor = C.INPUT_FACTOR.BASE + C.INPUT_FACTOR.SLOPE * inputScore;

  // ---- Limited Condition Adjustments（加性、有界）----
  const conditionAdjustment =
    personalityAdjustment(player.personality)
    + conditionBandAdjustment(rt.form)
    + conditionBandAdjustment(rt.morale)
    + (rt.growth.injuryPenaltySeasons > 0 ? C.CONDITION.INJURY_PENALTY : 0);

  // ---- 六属性独立结算 ----
  for (const attr of PLAYER_ATTRIBUTES) {
    const peak = C.PEAK_AGE[attr];
    const potRaw = Number(player.potential?.[attr]);
    const cap = Number.isFinite(potRaw) ? clamp(potRaw, ATTRIBUTE_RANGE.MIN, ATTRIBUTE_RANGE.MAX) : ATTRIBUTE_RANGE.MAX;
    const current = effective[attr];

    // 每属性独立确定性随机（seed 含 attribute）
    const rng = createRng(hashSeed(`${state.worldId}|growth|${playerId}|${seasonNumber}|${attr}`));
    const noise = (rng.next() * 2 - 1) * C.NOISE_AMPLITUDE;

    let preRandom;
    if (age < peak) {
      // GROWTH branch（OD-39FC-2）
      const headroomFactor = clamp((cap - current) / C.HEADROOM_REFERENCE, 0, 1);
      const ageFactor = prePeakAgeFactor(age, peak);
      const baseCapacity = C.BASE_CAPACITY_FACTOR * ageFactor * headroomFactor;
      const rawDevelopment = baseCapacity * inputFactor;
      preRandom = clamp(rawDevelopment + conditionAdjustment, -C.EFFICIENCY_CAP, C.EFFICIENCY_CAP);
    } else {
      // DECLINE branch（OD-39FC-2）
      const floorFactor = clamp((current - C.DECLINE.FLOOR) / C.DECLINE.FLOOR_REFERENCE, 0, 1);
      const sensitivity = C.DECLINE.SENSITIVITY[attr] ?? 0;
      const declineBase = (age - peak + 1) * C.DECLINE.BASE_PER_YEAR * sensitivity;
      const decline = clamp(declineBase * floorFactor, 0, C.DECLINE.MAX);
      preRandom = clamp(-decline, -C.EFFICIENCY_CAP, 0);
    }

    let delta = Math.round(preRandom + noise);
    delta = clamp(delta, -C.ANNUAL_SAFETY_BOUND, C.ANNUAL_SAFETY_BOUND);
    if (current + delta > cap) delta = cap - current;                       // 不越 Potential
    if (current + delta < ATTRIBUTE_RANGE.MIN) delta = ATTRIBUTE_RANGE.MIN - current;
    if (delta !== 0) applyAbilityDelta(state, playerId, attr, delta);
  }

  if (rt.growth.injuryPenaltySeasons > 0) rt.growth.injuryPenaltySeasons -= 1;
  rt.growth.lastEvaluatedSeason = seasonNumber;
  return { applied: true };
}

/**
 * 结算全部球员一个赛季的成长/衰退（赛季滚动时调用；幂等）。
 * @param {object} state
 * @param {{seasonNumber?: number, training?: (playerId: string, ctx: object) => (string|number)}} [options]
 *   `training`：Development Input 接口。返回档位（LIMITED/NORMAL/STRONG）或数值；缺省 NORMAL。
 * @returns {object} state（原地）
 */
export function developPlayers(state, options = {}) {
  if (!state || !state.static || !state.runtime) {
    throw new SimulationError('developPlayers 需要包含 static 与 runtime 的状态', {
      context: { received: typeof state },
    });
  }
  const seasonNumber = options.seasonNumber ?? state.season ?? 1;
  const training = typeof options.training === 'function'
    ? options.training
    : () => C.DEFAULT_TRAINING_LEVEL;
  const date = state.currentDate;

  state.runtime.players ??= {};
  for (const player of getWorldPlayers(state)) {
    const rt = getPlayerRuntime(state, player.id);
    if (!rt) continue;
    const trainingInput = resolveTrainingInput(training(player.id, { seasonNumber, date }));
    developPlayer(state, player.id, seasonNumber, trainingInput, date);
  }
  return state;
}
