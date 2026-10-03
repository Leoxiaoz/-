/**
 * Decision Debug（Step 39F-M-B-IMPLEMENTATION-01）。
 * 层级归属：Simulation Core / Match Decision。纯函数，无副作用、无 RNG。
 *
 * 语义：Debug **默认关闭**，仅当 `options.debug` 时收集。它只记录 Decision Pipeline 的
 * **中间语义**，**不得**新增玩家属性 / 评分字段，**不得**修改 MatchCore。
 */

/** 候选被淘汰的原因（确定性枚举）。 */
export const REJECTION_REASONS = Object.freeze({
  PLAYER_UNAVAILABLE: 'PLAYER_UNAVAILABLE',
  ACTION_UNAVAILABLE: 'ACTION_UNAVAILABLE',
  NO_TARGET: 'NO_TARGET',
  INVALID_TARGET: 'INVALID_TARGET',
  INVALID_STATE: 'INVALID_STATE',
  OUTSIDE_TOP_K: 'OUTSIDE_TOP_K',
  OUTSIDE_PREFERENCE_BAND: 'OUTSIDE_PREFERENCE_BAND',
});

/** Situation 摘要（面向 Debug 的可读快照，新对象）。 */
export function summarizeSituation(situation) {
  if (!situation) return null;
  return {
    playerId: situation.playerId,
    teamId: situation.teamId,
    position: situation.positionContext?.position ?? null,
    hasBall: !!situation.ownState?.hasBall,
    coordinates: { ...situation.ownState?.coordinates },
    phase: situation.matchContext?.phase ?? null,
    pressure: situation.spatialContext?.pressure ?? null,
    distanceToGoal: situation.spatialContext?.distanceToGoal ?? null,
    score: { ...situation.matchContext?.score },
    timeFraction: situation.matchContext?.timeFraction ?? null,
  };
}

/**
 * 构造 Debug trace（仅记录，不参与决策）。
 * @param {object} args
 * @returns {object}
 */
export function buildDebugTrace({ situation, candidates, rejected, selected, selectionReason, fallbackUsed }) {
  return {
    situation: summarizeSituation(situation),
    candidates: (candidates ?? []).map((c) => ({
      actionType: c.actionType,
      target: c.target,
      intent: c.intent ?? null,
      preference: c.preference ?? null,
      eligible: !!c.eligible,
      rejectionReason: c.rejectionReason ?? null,
    })),
    rejected: (rejected ?? []).map((r) => ({ actionType: r.actionType, reason: r.reason, target: r.target ?? null })),
    selected: selected ? { actionType: selected.actionType, target: selected.target, intent: selected.intent ?? null } : null,
    selectionReason: selectionReason ?? null,
    fallbackUsed: !!fallbackUsed,
  };
}
