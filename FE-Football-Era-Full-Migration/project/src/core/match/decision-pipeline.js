/**
 * Decision Pipeline —— 球员决策编排入口（Step 39F-M-B-IMPLEMENTATION-01）。
 * 层级归属：Simulation Core / Match Decision。纯函数，无副作用、无 RNG 污染。
 *
 * 冻结的 Decision Hierarchy v1（**语义顺序，非数学加法**）：
 *   1 Candidate Generation → 2 Hard Constraints → 3 Situation Validity →
 *   4 Team Intent → 5 Position Context → 6 Ability Preference →
 *   7 Player State Soft Influence → 8 Match Context → 9 RiskIntent →
 *   10 Candidate Eligibility → 11 Bounded Decision Randomness → 12 Action Selection
 *
 * 边界（冻结）：Decision **只决定“做什么”**；停在 `ActionInstance`，**不进入 Resolution**；
 * 不修改 MatchCore / Growth / Training / Development；不读 Team Strength；无 Math.random。
 */

import { ACTION_NONE, ACTION_TYPES, DECISION_RULE_VERSION, GOAL, SOFT_MODIFIER_BOUNDS } from './decision-config.js';
import { buildPlayerSituation, clamp01 } from './player-situation.js';
import { DEFAULT_ACTION_REGISTRY } from './action-registry.js';
import { generateCandidates } from './decision-candidates.js';
import { selectAction } from './decision-selection.js';
import { buildDecisionScope, createDecisionRng } from './decision-rng.js';
import { buildDebugTrace, REJECTION_REASONS } from './decision-debug.js';

/** 夹取 soft modifier 到允许区间。 */
function clampMod(m) {
  const v = Number.isFinite(m) ? m : SOFT_MODIFIER_BOUNDS.NEUTRAL;
  return Math.min(SOFT_MODIFIER_BOUNDS.MAX, Math.max(SOFT_MODIFIER_BOUNDS.MIN, v));
}

/** Team Intent → Preference 软修正（不强制 Action）。 */
function teamIntentModifier(situation, actionType) {
  const { mentality, tempo, pressing } = situation.tacticalState;
  let m = 1;
  if (mentality === 'attacking') {
    if (actionType === 'PASS' || actionType === 'SHOT' || actionType === 'DRIBBLE') m *= 1.06;
    if (actionType === 'PRESS' || actionType === 'TACKLE') m *= 0.97;
  } else if (mentality === 'defensive') {
    if (actionType === 'PRESS' || actionType === 'TACKLE') m *= 1.05;
    if (actionType === 'SHOT' || actionType === 'DRIBBLE') m *= 0.93;
  }
  if (tempo === 'high' && (actionType === 'PASS' || actionType === 'MOVE')) m *= 1.05;
  if (tempo === 'low' && (actionType === 'PASS' || actionType === 'MOVE')) m *= 0.97;
  if (pressing === 'high' && actionType === 'PRESS') m *= 1.08;
  if (pressing === 'high' && actionType === 'TACKLE') m *= 1.03;
  if (pressing === 'low' && actionType === 'PRESS') m *= 0.90;
  return clampMod(m);
}

/** Position Context → Preference 软修正（Position ≠ Role）。 */
function positionModifier(situation, actionType) {
  const pos = situation.positionContext.position;
  const table = POSITION_TABLE[pos];
  if (!table) return 1;
  return clampMod(table[actionType] ?? 1);
}

const POSITION_TABLE = {
  GK: { MOVE: 0.90, PASS: 1.05, DRIBBLE: 0.70, SHOT: 0.50, PRESS: 0.30, TACKLE: 0.30 },
  DF: { MOVE: 1.00, PASS: 1.00, DRIBBLE: 0.95, SHOT: 0.90, PRESS: 1.05, TACKLE: 1.08 },
  MF: { MOVE: 1.05, PASS: 1.05, DRIBBLE: 1.05, SHOT: 0.98, PRESS: 1.00, TACKLE: 1.00 },
  FW: { MOVE: 1.00, PASS: 0.98, DRIBBLE: 1.06, SHOT: 1.12, PRESS: 0.95, TACKLE: 0.92 },
};

/** Player State Soft Influence（只软影响，绝不硬约束）。 */
function playerStateModifier(situation, actionType) {
  const s = situation.ownState.soft;
  const condition = (s.fitness + s.form + s.morale) / 3;
  let m = 0.92 + 0.16 * condition;
  if (actionType === 'PRESS') m *= (1 - 0.15 * s.matchLoad);
  else if (actionType === 'DRIBBLE') m *= (1 - 0.10 * s.matchLoad);
  else if (actionType === 'SHOT') m *= (1 - 0.05 * s.matchLoad);
  return clampMod(m);
}

/** Match Context → Preference 软修正（比分/时间；不直接改能力）。 */
function matchContextModifier(situation, actionType) {
  const { diff } = situation.matchContext.score;
  const late = situation.matchContext.timeFraction >= 0.75;
  let m = 1;
  if (late && diff > 0) {
    if (actionType === 'SHOT' || actionType === 'DRIBBLE') m *= 0.92;
    if (actionType === 'PASS') m *= 1.03;
  } else if (late && diff < 0) {
    if (actionType === 'SHOT' || actionType === 'DRIBBLE') m *= 1.08;
    if (actionType === 'PASS') m *= 0.98;
  }
  return clampMod(m);
}

/** RiskIntent（属 Decision 层，非 Resolution 参数）。 */
export function computeRiskIntent(situation) {
  const { mentality } = situation.tacticalState;
  const { diff } = situation.matchContext.score;
  const late = situation.matchContext.timeFraction >= 0.75;
  const s = situation.ownState.soft;
  let risk = 0.5;
  if (mentality === 'attacking') risk += 0.12;
  else if (mentality === 'defensive') risk -= 0.12;
  if (late && diff < 0) risk += 0.15;
  else if (late && diff > 0) risk -= 0.15;
  risk += 0.10 * (s.morale - 0.5);
  risk -= 0.10 * s.matchLoad;
  risk = clamp01(risk);
  const level = risk < 0.34 ? 'LOW' : risk < 0.67 ? 'MEDIUM' : 'HIGH';
  return { level, value: Math.round(risk * 1000) / 1000 };
}

/** 评估单个候选的最终偏好（base × 软修正，clamp [0,1]）。 */
function evaluateCandidatePreference(situation, registry, candidate) {
  const def = registry.get(candidate.actionType);
  const base = clamp01(def.preference(situation, candidate));
  const final = clamp01(
    base
    * teamIntentModifier(situation, candidate.actionType)
    * positionModifier(situation, candidate.actionType)
    * playerStateModifier(situation, candidate.actionType)
    * matchContextModifier(situation, candidate.actionType),
  );
  return Math.round(final * 1000) / 1000;
}

/** 构造空决策（NO_VALID_ACTION / PLAYER_UNAVAILABLE）。 */
function noneDecision(playerId, reason) {
  return {
    decision: {
      playerId,
      actionType: ACTION_NONE,
      target: null,
      intent: null,
      riskIntent: null,
      commitment: null,
      decisionMeta: { selectionReason: reason, fallbackUsed: false, ruleVersion: DECISION_RULE_VERSION },
    },
    actionInstance: null,
  };
}

/**
 * 球员决策入口：给定 MatchCore-like 状态 + playerId，确定性地产出一个 ActionInstance。
 * @param {object} matchCore MatchCoreState（输入契约，见 player-situation.js）
 * @param {string} playerId
 * @param {{debug?:boolean, seed?:string, decisionSequence?:number, ruleVersion?:string, registry?:object, selectionConfig?:object}} [options]
 * @returns {{decision:object, actionInstance:object|null, debug:object|null}}
 */
export function decidePlayerAction(matchCore, playerId, options = {}) {
  const registry = options.registry ?? DEFAULT_ACTION_REGISTRY;
  const ruleVersion = options.ruleVersion ?? DECISION_RULE_VERSION;

  const situation = buildPlayerSituation(matchCore, playerId);
  if (!situation) {
    const { decision, actionInstance } = noneDecision(playerId, REJECTION_REASONS.PLAYER_UNAVAILABLE);
    return { decision, actionInstance, debug: options.debug ? { playerId, selectionReason: REJECTION_REASONS.PLAYER_UNAVAILABLE } : null };
  }

  // 1–3：Candidate Generation + Hard Constraints + Situation Validity
  const { candidates: rawCandidates, rejected } = generateCandidates(situation, registry);

  // 4–8：Preference（含 Soft Influences）
  const candidates = rawCandidates.map((c) => ({ ...c, preference: evaluateCandidatePreference(situation, registry, c) }));

  // 9：RiskIntent
  const riskIntent = computeRiskIntent(situation);

  // 10–12：Eligibility + Bounded Randomness + Selection
  const scope = buildDecisionScope(matchCore, playerId, options.decisionSequence ?? 0, options.seed ?? null, ruleVersion);
  const rng = createDecisionRng(scope);
  const { selected, annotated, selectionReason, fallbackUsed } = selectAction(candidates, rng, options.selectionConfig);

  if (!selected) {
    const { decision, actionInstance } = noneDecision(playerId, 'NO_VALID_ACTION');
    const debug = options.debug
      ? buildDebugTrace({ situation, candidates: annotated, rejected, selected: null, selectionReason: 'NO_VALID_ACTION', fallbackUsed: false })
      : null;
    return { decision, actionInstance, debug };
  }

  const def = registry.get(selected.actionType);
  const commitment = def?.commitmentPolicy ? { ...def.commitmentPolicy } : null;
  const decision = {
    playerId,
    actionType: selected.actionType,
    target: selected.target,
    intent: selected.intent ?? null,
    riskIntent,
    commitment,
    decisionMeta: {
      selectionReason,
      fallbackUsed,
      ruleVersion,
      decisionSequence: options.decisionSequence ?? 0,
      preference: selected.preference,
    },
  };
  const actionInstance = {
    actionType: selected.actionType,
    actorId: playerId,
    target: selected.target,
    intent: selected.intent ?? null,
    riskIntent,
    commitment,
  };
  const debug = options.debug
    ? buildDebugTrace({ situation, candidates: annotated, rejected, selected, selectionReason, fallbackUsed })
    : null;
  return { decision, actionInstance, debug };
}

export { ACTION_TYPES, GOAL };
