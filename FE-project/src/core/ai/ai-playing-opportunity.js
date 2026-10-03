/**
 * Playing Opportunity —— Phase 1 近似（D39 Phase 1 / Step 39F-A）。
 * 层级归属：Simulation Core / AI。纯派生、只读、无 RNG、不持久化。
 *
 * 规范来源：D39-R（Step 39C 冻结）/ Step 39E-R §六（R-8 归一化）。
 * 三层语义：① Actual Minutes（事实）② Current Opportunity（当前赛季现实机会）
 *          ③ Path Opportunity（继续留队是否存在合理发展路径）。
 *
 * 红线：
 * - 不是 Player Static Attribute；不是 Growth Multiplier；不是 Potential 别名。
 * - **不得读取 True / Estimated Potential**（AI Information Boundary，Phase 2 才引入 estimator）。
 * - 不写入 Player Runtime；不改 Match Engine / Team Strength；不影响实际首发（AI Match Selection 属 Phase 4）。
 */

import { getPlayerProfile } from '../player-runtime.js';
import {
  clamp01,
  clamp0100,
  actualMinutesScore,
  availabilityScore,
  surplusAtPosition,
  playerLineRating,
  bestLineRatingAtPosition,
  squadDepthFit,
  abilityGapFit,
  developmentPhaseFit,
  positionCompetitionFit,
} from './ai-development-signals.js';

/**
 * 评估某球员在 (club, 当前赛季进度) 下的 Playing Opportunity（Phase 1 近似）。
 * @param {object} state
 * @param {string} clubId
 * @param {string} playerId
 * @param {object} [context] 预留（Phase 1 未使用）
 * @returns {{actualMinutes: number, actualMinutesScore: number,
 *            currentOpportunity: number, pathOpportunity: number,
 *            playingOpportunityScore: number}|null}
 *   `actualMinutesScore` ∈ [0,1]（Owner §6.2）；其余 ∈ [0,100]。
 *   球员不存在返回 null。
 */
export function evaluatePlayingOpportunity(state, clubId, playerId, context = {}) {
  const profile = getPlayerProfile(state, playerId);
  if (!profile) return null;
  const position = profile.position;

  // ① Actual Minutes（事实）
  const rt = state?.runtime?.players?.[playerId] ?? null;
  const actualMinutes = Math.max(0, Math.floor(Number(rt?.stats?.season?.minutes) || 0));
  const ams = actualMinutesScore(state, clubId, playerId); // 0–1

  // ② Current Opportunity（0–100）：只使用既有事实
  const availability = availabilityScore(state, playerId);            // 0–100
  const squadDepthOpportunity = clamp0100(100 - surplusAtPosition(state, clubId, position) * 25);
  const mine = playerLineRating(state, playerId);
  const best = bestLineRatingAtPosition(state, clubId, position, playerId);
  const ref = Number.isFinite(best) ? best : (Number.isFinite(mine) ? mine : 0);
  const gapToBest = Math.max(0, ref - (Number.isFinite(mine) ? mine : 0));
  const abilityOpportunity = clamp0100(100 - gapToBest * 5);

  const currentOpportunity = clamp0100(
    0.40 * (ams * 100)
    + 0.25 * availability
    + 0.20 * squadDepthOpportunity
    + 0.15 * abilityOpportunity,
  );

  // ③ Path Opportunity（0–100）：Current Opportunity / Squad Depth / Ability Gap / Phase / Position Competition
  const pathOpportunity = clamp0100(
    0.40 * currentOpportunity
    + 0.20 * (squadDepthFit(state, clubId) * 100)
    + 0.20 * (abilityGapFit(state, clubId, playerId) * 100)
    + 0.10 * (developmentPhaseFit(state, playerId) * 100)
    + 0.10 * (positionCompetitionFit(state, clubId, position) * 100),
  );

  const playingOpportunityScore = clamp0100(
    0.50 * (ams * 100)
    + 0.30 * currentOpportunity
    + 0.20 * pathOpportunity,
  );

  return { actualMinutes, actualMinutesScore: clamp01(ams), currentOpportunity, pathOpportunity, playingOpportunityScore };
}
