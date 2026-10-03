/**
 * Candidate Generation + Hard Constraints + Situation Validity
 * （Step 39F-M-B-IMPLEMENTATION-01）。
 * 层级归属：Simulation Core / Match Decision。纯函数，无副作用、无 RNG。
 *
 * 语义：候选生成**必须 action-specific**（由 ActionDefinition.generateCandidates 提供）；
 * 本模块只做统一编排：Availability → Generate → Hard Constraint → Situation Validity。
 * 被淘汰的候选**必须记录明确 rejection reason**；淘汰者不得进入 Preference Band。
 */

import { REJECTION_REASONS } from './decision-debug.js';

/** 合法 GOAL_AREA 区域。 */
const GOAL_ZONES = Object.freeze(['CENTER', 'LEFT', 'RIGHT']);

/** 稳定候选键（用于确定性 tie-break）。 */
export function candidateKey(c) {
  const t = c?.target ?? {};
  const tail = t.playerId ?? t.zone ?? `${Number(t.x) || 0},${Number(t.y) || 0}`;
  // 含 intent：不同 intent 即使 target 相同也是不同候选（避免 Top-K 判定因键碰撞而失效）。
  return `${c?.actionType}|${c?.intent ?? ''}|${t.type ?? ''}|${tail}`;
}

/** 目标在当前 Situation 下是否有效（Situation Validity Filter）。 */
export function isTargetValid(candidate, situation) {
  const t = candidate?.target;
  if (!t || typeof t !== 'object') return false;
  switch (t.type) {
    case 'SPACE':
      return Number.isFinite(t.x) && Number.isFinite(t.y)
        && t.x >= 0 && t.x <= 1 && t.y >= 0 && t.y <= 1;
    case 'TEAMMATE':
      return situation.teammates.some((m) => m.playerId === t.playerId && m.available);
    case 'OPPONENT':
      return situation.opponents.some((o) => o.playerId === t.playerId && o.available);
    case 'GOAL_AREA':
      return GOAL_ZONES.includes(t.zone);
    default:
      return false;
  }
}

/**
 * 生成全部合法候选（未经 Preference）。
 * @param {object} situation
 * @param {object} registry
 * @returns {{candidates: object[], rejected: object[]}}
 */
export function generateCandidates(situation, registry) {
  const candidates = [];
  const rejected = [];
  if (!situation) return { candidates, rejected };

  const actable = situation.ownState?.availability;
  const playerUsable = actable && actable.onPitch && !actable.injured && !actable.sentOff;
  if (!playerUsable) {
    for (const type of registry.list()) rejected.push({ actionType: type, reason: REJECTION_REASONS.PLAYER_UNAVAILABLE });
    return { candidates, rejected };
  }

  const seen = new Set();
  for (const type of registry.list()) {
    const def = registry.get(type);
    if (!def) continue;
    if (!def.availability(situation)) {
      rejected.push({ actionType: type, reason: REJECTION_REASONS.ACTION_UNAVAILABLE });
      continue;
    }
    // Action-specific 候选生成。
    const raw = def.generateCandidates(situation) || [];
    if (raw.length === 0) {
      rejected.push({ actionType: type, reason: REJECTION_REASONS.NO_TARGET });
      continue;
    }
    // Hard Constraint #2 + Situation Validity：目标必须真实有效；重复候选去重。
    let acceptedForType = 0;
    for (const c of raw) {
      if (!isTargetValid(c, situation)) {
        rejected.push({ actionType: type, reason: REJECTION_REASONS.INVALID_TARGET, target: c.target });
        continue;
      }
      const candidate = { actionType: c.actionType, target: c.target, intent: c.intent };
      const key = candidateKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
      acceptedForType += 1;
    }
    if (acceptedForType === 0) {
      rejected.push({ actionType: type, reason: REJECTION_REASONS.NO_TARGET });
    }
  }
  return { candidates, rejected };
}
