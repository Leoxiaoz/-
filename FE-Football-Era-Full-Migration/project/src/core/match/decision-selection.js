/**
 * Candidate Eligibility + Bounded Decision Randomness + Action Selection
 * （Step 39F-M-B-IMPLEMENTATION-01）。
 * 层级归属：Simulation Core / Match Decision。纯函数，无副作用。
 *
 * 冻结语义：
 * - Candidate Eligibility = **Top-K ∧ Relative Preference Band**（AND，非 OR，非全量 softmax）。
 * - Bounded Decision Randomness：**只能**在 Eligible Set 内做 seeded 加权选择。
 * - 单候选 / 单 eligible → 直接选择（**不消费 RNG**）。
 * - Eligible 为空 → 确定性 fallback（最高偏好合法候选）；无合法候选 → `NO_VALID_ACTION`。
 * - 不允许无限重试 / while(true)。
 */

import { DECISION_SELECTION_CONFIG } from './decision-config.js';
import { REJECTION_REASONS } from './decision-debug.js';
import { candidateKey } from './decision-candidates.js';

/** 确定性排序：preference DESC → candidateKey ASC。 */
export function sortCandidates(candidates) {
  return [...candidates].sort((a, b) => (
    (b.preference - a.preference) || candidateKey(a).localeCompare(candidateKey(b))
  ));
}

/**
 * 计算 Eligiblity（Top-K ∧ Preference Band）。
 * @returns {{eligible:object[], annotated:object[], best:number}}
 */
export function evaluateEligibility(candidates, config = DECISION_SELECTION_CONFIG) {
  const sorted = sortCandidates(candidates ?? []);
  if (sorted.length === 0) return { eligible: [], annotated: [], best: null };
  const k = Math.max(1, Math.floor(Number(config.TOP_K) || 1));
  const band = Math.max(0, Number(config.PREFERENCE_BAND) || 0);
  const best = sorted[0].preference;
  const threshold = best - band;
  const inTopK = new Set(sorted.slice(0, k).map((c) => candidateKey(c)));
  const annotated = sorted.map((c) => {
    const isTopK = inTopK.has(candidateKey(c));
    const inBand = c.preference >= threshold;
    const eligible = isTopK && inBand;
    return {
      ...c,
      eligible,
      rejectionReason: eligible ? null : (isTopK ? REJECTION_REASONS.OUTSIDE_PREFERENCE_BAND : REJECTION_REASONS.OUTSIDE_TOP_K),
    };
  });
  return { eligible: annotated.filter((c) => c.eligible), annotated, best };
}

/**
 * 在 Eligible Set 内做 seeded 加权选择。
 * @param {object[]} eligible
 * @param {{next:()=>number}} rng
 * @returns {object|null}
 */
export function selectEligible(eligible, rng) {
  if (!Array.isArray(eligible) || eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0]; // 单候选：不消费 RNG
  const weights = eligible.map((c) => Math.max(0, Number(c.preference) || 0));
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return eligible[0]; // 退化：不消费 RNG
  let r = rng.next() * total;
  for (let i = 0; i < eligible.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return eligible[i];
  }
  return eligible[eligible.length - 1];
}

/**
 * 选择动作（编排 Eligibility + Selection + Fallback）。
 * @returns {{selected:object|null, annotated:object[], selectionReason:string, fallbackUsed:boolean}}
 */
export function selectAction(candidates, rng, config = DECISION_SELECTION_CONFIG) {
  const { eligible, annotated } = evaluateEligibility(candidates, config);
  if (eligible.length > 0) {
    const selected = selectEligible(eligible, rng);
    return { selected, annotated, selectionReason: 'ELIGIBLE_SELECTED', fallbackUsed: false };
  }
  if (annotated.length > 0) {
    return { selected: annotated[0], annotated, selectionReason: 'FALLBACK_TOP_PREFERENCE', fallbackUsed: true };
  }
  return { selected: null, annotated, selectionReason: 'NO_VALID_ACTION', fallbackUsed: false };
}
