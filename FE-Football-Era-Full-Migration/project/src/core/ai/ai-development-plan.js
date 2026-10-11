/**
 * AI Development Plan —— Step 39F-J-LAYER-B（SIGNAL-IMPLEMENTATION）。
 * 层级归属：Simulation Core / AI。**纯派生、只读、无副作用、无 RNG、不持久化**。
 *
 * 语义分层（严格不可合并）：
 *   Development Need     —— 这个球员为什么值得发展
 *   Development Gap      —— 发展需求与预期比赛机会之间的缺口
 *   Development Priority —— 当前发展问题有多紧迫
 *   Development Plan     —— AI 本赛季针对该球员的发展策略意图
 *
 * 单向数据流：
 *   Need → Gap → Priority → Plan{ trainingIntent, playingOpportunityIntent }
 *
 * 红线：
 * - **不读 True Potential**：只用 AI-observable `estimateHeadroomScore`（AI Information Boundary）。
 * - 不修改 state / 不写 runtime / 不持久化 / 无 RNG / deterministic。
 * - `Training Intent ≠ Training Level`；本模块**不接** Training Decision / Selection / Rotation / Minutes / Growth。
 * - Need **不读** Expected Playing Opportunity / actual minutes / personality / environment / injury。
 * - Priority 才读 injury / environment；Gap 才读 Expected Playing Opportunity。
 * - 参数冻结于 `AI_DEVELOPMENT_PLAN_CONFIG`（见 ai-config.js）。
 */

import { getPlayerProfile, getPlayerRuntime, INJURY_STATUS } from '../player-runtime.js';
import { getPlayerAge, abilityGapFit, positionCompetitionFit } from './ai-development-signals.js';
import { getDevelopmentPhase, DEVELOPMENT_PHASE_SCORE } from './ai-development-phase.js';
import { estimateHeadroomScore } from './ai-potential-estimate.js';
import { evaluateDevelopmentEnvironment } from './ai-development-environment.js';
import { deriveExpectedRole, getExpectedParticipation } from './ai-relative-role-load.js';
import { AI_DEVELOPMENT_PLAN_CONFIG as C } from './ai-config.js';

const GROWTH_PHASES = Object.freeze(new Set(['EMERGING', 'DEVELOPING', 'ESTABLISHING']));
const PHASE = Object.freeze({
  EMERGING: 'EMERGING', DEVELOPING: 'DEVELOPING', ESTABLISHING: 'ESTABLISHING',
  PRIME: 'PRIME', VETERAN: 'VETERAN',
});

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Development Need（为什么值得发展）。
 * `H = clamp01(estimateHeadroomScore / HEADROOM_REF_SCORE)`；`Ph = phaseScore/100`；`A = abilityGapFit`。
 * 资格：EMERGING / DEVELOPING / ESTABLISHING；PRIME 仅当 `H >= PRIME_H_MIN`；VETERAN → 0。
 * `Need = clamp01(0.50·H + 0.30·Ph + 0.20·A)`（eligible 时），否则 0。
 * @returns {{need:number, headroomNorm:number, phaseScore:number, abilityGapFit:number,
 *            phase:string|null, eligible:boolean, reason?:string}|null}
 */
export function evaluateDevelopmentNeed(state, clubId, playerId, _options = {}) {
  const profile = getPlayerProfile(state, playerId);
  if (!profile || !clubId) return null;
  const age = getPlayerAge(state, playerId);
  if (age == null) {
    return { need: 0, headroomNorm: 0, phaseScore: 0, abilityGapFit: 0, phase: null, eligible: false, reason: 'missing_age' };
  }
  const phase = getDevelopmentPhase(age);
  const H = clamp01(estimateHeadroomScore(state, clubId, playerId) / C.HEADROOM_REF_SCORE);
  const Ph = (DEVELOPMENT_PHASE_SCORE[phase] ?? 0) / 100;
  const A = clamp01(abilityGapFit(state, clubId, playerId));
  const growth = GROWTH_PHASES.has(phase);
  const primeOk = phase === PHASE.PRIME && H >= C.PRIME_H_MIN;
  const eligible = growth || primeOk;
  const need = eligible
    ? clamp01(C.NEED_WEIGHTS.HEADROOM * H + C.NEED_WEIGHTS.PHASE * Ph + C.NEED_WEIGHTS.ABILITY_GAP * A)
    : 0;
  return { need, headroomNorm: H, phaseScore: Ph, abilityGapFit: A, phase, eligible };
}

/**
 * Development Gap（需求 − 预期机会供给）。
 * `Supply = ExpectedParticipationUpperBound(role)`（复用 39F-J-B role anchor）。
 * `Gap = clamp01(max(0, Need − Supply))`；连续值，不做 Band。
 * @returns {{gap:number, need:number, supply:number, role:string|null}|null}
 */
export function evaluateDevelopmentGap(state, clubId, playerId, options = {}) {
  const needR = evaluateDevelopmentNeed(state, clubId, playerId, options);
  if (!needR) return null;
  const role = deriveExpectedRole(state, clubId, playerId)?.role ?? null;
  const supply = role ? getExpectedParticipation(role).upperBound : 0;
  const gap = clamp01(Math.max(0, needR.need - supply));
  return { gap, need: needR.need, supply, role };
}

/**
 * Development Priority（当前紧迫度）。
 * `Raw = 0.45·Need + 0.40·Gap + 0.15·positionCompetitionFit`；
 * `Priority = clamp01(Raw × injuryAttenuation × environmentModifier)`。
 * - INJURED → attenuation 0；RECOVERY → `REC_MIN`；否则 1。
 * - environmentModifier = `clamp01(ENV_FLOOR + ENV_RANGE × environmentInput)`。
 * @returns {{priority:number, need:number, gap:number, supply:number, role:string|null,
 *            context:number, injuryAttenuation:number, environmentModifier:number,
 *            injured:boolean, recovery:boolean}|null}
 */
export function evaluateDevelopmentPriority(state, clubId, playerId, options = {}) {
  const gapR = evaluateDevelopmentGap(state, clubId, playerId, options);
  if (!gapR) return null;
  const position = getPlayerProfile(state, playerId)?.position ?? 'MF';
  const context = clamp01(positionCompetitionFit(state, clubId, position));
  const raw = C.PRIORITY_WEIGHTS.NEED * gapR.need
    + C.PRIORITY_WEIGHTS.GAP * gapR.gap
    + C.PRIORITY_WEIGHTS.CONTEXT * context;
  const rt = getPlayerRuntime(state, playerId);
  const injured = rt?.injury?.status === INJURY_STATUS.INJURED;
  const recovery = !injured && Number(rt?.growth?.injuryPenaltySeasons) > 0;
  const injuryAttenuation = injured ? 0 : (recovery ? C.REC_MIN : 1);
  const env = evaluateDevelopmentEnvironment(state, clubId, playerId);
  const environmentModifier = clamp01(C.ENV_FLOOR + C.ENV_RANGE * (env ? clamp01(env.environmentInput) : 0));
  const priority = clamp01(raw * injuryAttenuation * environmentModifier);
  return {
    priority, need: gapR.need, gap: gapR.gap, supply: gapR.supply, role: gapR.role,
    context, injuryAttenuation, environmentModifier, injured, recovery,
  };
}

/**
 * Priority → Training Intent（`NONE < TRAINING_NONE_MAX ≤ DEVELOP < TRAINING_DEVELOP_MAX ≤ ACCELERATE`）。
 * 纯函数；`Training Intent ≠ Training Level`。
 * @returns {'NONE'|'DEVELOP'|'ACCELERATE'}
 */
export function resolveTrainingIntent(priority) {
  const p = clamp01(priority);
  if (p < C.TRAINING_NONE_MAX) return C.TRAINING_INTENT.NONE;
  if (p < C.TRAINING_DEVELOP_MAX) return C.TRAINING_INTENT.DEVELOP;
  return C.TRAINING_INTENT.ACCELERATE;
}

/**
 * Gap + Supply → Playing Opportunity Intent。
 * 仅当 `Gap >= GAP_OPP_MIN AND Supply <= SUPPLY_LOW` 时为 `NEEDS_MORE_OPPORTUNITY`，否则 `NORMAL`。
 * @returns {'NORMAL'|'NEEDS_MORE_OPPORTUNITY'}
 */
export function resolvePlayingOpportunityIntent(gap, supply) {
  const g = clamp01(gap);
  const s = Number(supply);
  const supplyLow = Number.isFinite(s) && s <= C.SUPPLY_LOW;
  return (g >= C.GAP_OPP_MIN && supplyLow)
    ? C.PLAYING_OPPORTUNITY_INTENT.NEEDS_MORE_OPPORTUNITY
    : C.PLAYING_OPPORTUNITY_INTENT.NORMAL;
}

/**
 * Development Plan（AI 本赛季发展策略意图）。
 * **仅输出** `{ trainingIntent, playingOpportunityIntent }`；priority/need/gap 为独立 signal，不放入 Plan。
 * Free Agent / 无俱乐部 → `null`。player-level、season-level、derived、transient、non-persistent。
 * @returns {{trainingIntent:'NONE'|'DEVELOP'|'ACCELERATE',
 *            playingOpportunityIntent:'NORMAL'|'NEEDS_MORE_OPPORTUNITY'}|null}
 */
export function evaluateDevelopmentPlan(state, clubId, playerId, options = {}) {
  if (!clubId) return null;
  const prioR = evaluateDevelopmentPriority(state, clubId, playerId, options);
  if (!prioR) return null;
  return {
    trainingIntent: resolveTrainingIntent(prioR.priority),
    playingOpportunityIntent: resolvePlayingOpportunityIntent(prioR.gap, prioR.supply),
  };
}
