/**
 * Development Value（D39 Phase 1 / Step 39F-A）。
 * 层级归属：Simulation Core / AI。纯派生、只读、无 RNG、不持久化。
 *
 * 规范来源：D39-L（Step 39C 冻结）/ Step 39E-R §八（R-8 归一化冻结）。
 * 语义：Development Value 是 **AI Decision Signal**（0–100），回答「这个球员值不值得发展」；
 * 不是 OVR / Talent / Potential / Growth Rate。
 *
 * ⚠ AI Information Boundary（D39C-03 / Step 39F-A §八.1、§十一）：
 * - 本模块**完全不读取 True Potential**（不 import 任何 potential 访问）。
 * - `headroomScore` 必须由调用方通过 `context.headroomScore`（0–100）注入。
 * - Phase 1 **Estimated Potential 尚未实现**，因此 **AI 不得调用本函数**；
 *   Phase 2 完成后，`context.headroomScore` 必须来自 `estimatePotential()`。
 *
 * 其他红线：不得改 Ability / Potential / Growth；不直接制造 Playing Opportunity；
 * 不改 Match Engine / Team Strength；不影响实际首发（AI Match Selection 属 Phase 4）。
 */

import { getPlayerProfile } from '../player-runtime.js';
import {
  clamp0100,
  getPlayerAge,
  playerLineRating,
  bestLineRatingAtPosition,
  squadDepthFit,
  positionNeedFit,
  developmentPhaseFit,
} from './ai-development-signals.js';
import { getDevelopmentPhase, DEVELOPMENT_PHASE_SCORE } from './ai-development-phase.js';
import { evaluatePlayingOpportunity } from './ai-playing-opportunity.js';
import { evaluateDevelopmentEnvironment } from './ai-development-environment.js';

/** DV 组件权重（D39E-R §八 冻结）。 */
export const DV_WEIGHTS = Object.freeze({
  HEADROOM: 0.30,
  PLAYING_OPPORTUNITY: 0.25,
  PHASE: 0.15,
  ABILITY_GAP: 0.10,
  ENVIRONMENT: 0.10,
  PERSONALITY: 0.05,
  CAREER_PATH: 0.05,
});

/**
 * Current Ability Gap Score（D39E-R §八.3 冻结；保留 gap=0 的阶梯）。
 * `gap = targetLineRating − currentLineRating`。
 * @returns {number} 0–100
 */
export function currentAbilityGapScore(gap) {
  const g = Number(gap);
  if (!Number.isFinite(g) || g <= 0) return 20;
  if (g >= 15) return 100;
  return 50 + (g / 15) * 50;
}

/**
 * Personality Score（0–100）：professionalism / determination / ambition 均值，按 1–99 量程归一化。
 * 不新增任何 Development Trait。
 */
export function personalityScore(profile) {
  const p = profile?.personality ?? {};
  const val = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(99, Math.max(1, n)) : 50;
  };
  const avg = (val(p.professionalism) + val(p.determination) + val(p.ambition)) / 3;
  return clamp0100((avg * 100) / 99);
}

/**
 * 评估某球员的 Development Value（Phase 1）。
 * @param {object} state
 * @param {string} clubId
 * @param {string} playerId
 * @param {{headroomScore?: number}} [context] `headroomScore` ∈ [0,100]（须来自 Estimated Potential；Phase 1 由调用方注入）
 * @returns {{value: number, components: object}|null}
 */
export function evaluateDevelopmentValue(state, clubId, playerId, context = {}) {
  const profile = getPlayerProfile(state, playerId);
  if (!profile) return null;

  // Headroom：Phase 1 由调用方注入（Phase 2 起必须来自 Estimated Potential）；**不读 True Potential**。
  const headroomScore = clamp0100(Number(context.headroomScore) || 0);

  const opportunity = evaluatePlayingOpportunity(state, clubId, playerId, context);
  const environment = evaluateDevelopmentEnvironment(state, clubId, playerId, context);
  if (!opportunity || !environment) return null;

  const age = getPlayerAge(state, playerId);
  const phase = age == null ? null : getDevelopmentPhase(age);
  const phaseScore = phase ? (DEVELOPMENT_PHASE_SCORE[phase] ?? 0) : 0;

  // Current Ability Gap：gap = 本队该位置最佳线评分 − 本球员线评分
  const mine = playerLineRating(state, playerId);
  const best = bestLineRatingAtPosition(state, clubId, profile.position, playerId);
  const ref = Number.isFinite(best) ? best : (Number.isFinite(mine) ? mine : 0);
  const gap = ref - (Number.isFinite(mine) ? mine : 0);
  const abilityGapScore = currentAbilityGapScore(gap);

  const environmentScore = clamp0100(environment.environmentInput * 100);
  const persScore = personalityScore(profile);

  // Career Path Feasibility（D39E-R §八.6 冻结权重）
  const careerPathFeasibilityScore = clamp0100(
    0.40 * opportunity.currentOpportunity
    + 0.30 * (squadDepthFit(state, clubId) * 100)
    + 0.20 * (positionNeedFit(state, clubId, playerId) * 100)
    + 0.10 * (developmentPhaseFit(state, playerId) * 100),
  );

  const value = clamp0100(
    DV_WEIGHTS.HEADROOM * headroomScore
    + DV_WEIGHTS.PLAYING_OPPORTUNITY * opportunity.playingOpportunityScore
    + DV_WEIGHTS.PHASE * phaseScore
    + DV_WEIGHTS.ABILITY_GAP * abilityGapScore
    + DV_WEIGHTS.ENVIRONMENT * environmentScore
    + DV_WEIGHTS.PERSONALITY * persScore
    + DV_WEIGHTS.CAREER_PATH * careerPathFeasibilityScore,
  );

  return {
    value,
    components: {
      headroomScore,
      playingOpportunityScore: opportunity.playingOpportunityScore,
      phaseScore,
      currentAbilityGapScore: abilityGapScore,
      environmentScore,
      personalityScore: persScore,
      careerPathFeasibilityScore,
    },
  };
}
