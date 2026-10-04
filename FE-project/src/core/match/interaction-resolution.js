/**
 * Interaction Resolution Foundation（Step 39F-M-C-05）。
 * 层级归属：Simulation Core / Match Resolution。**纯函数、无副作用、无 Math.random**。
 *
 * 职责：接收 Decision（或 transit 子系统）已产出的 `ActionInstance`，对
 * DRIBBLE / TACKLE / PRESS / INTERCEPTION 执行确定性的 Interaction Resolution，
 * 产出纯数据 `InteractionResolutionResult`（描述「这次互动产生了什么结果」）。
 *
 * 数据流（单向）：
 *   MatchCore.ball → ball-facts / TacticalContext / PlayerSituation → decidePlayerAction
 *     → ActionInstance → resolveInteraction → InteractionResolutionResult
 *     → interaction-state-update → MatchCore Truth
 *
 * 红线（冻结）：
 * - **不重新决策**（不调用 decidePlayerAction / 不重生成候选 / 不换目标）。
 * - **不修改 MatchCore / BallState / PlayerState**（状态变更由 interaction-state-update.js 承担）。
 * - **不产生 Event / 不写 stats / 不碰 Growth·Training·Development / 不持久化**。
 * - **单一 Ball Truth**：只读 MatchCore.ball，无第二套球状态。
 * - Resolution RNG 与 Decision / PASS / SHOT RNG **隔离**；无 OVR / teamStrength。
 * - 明确 Deferred：FOUL / 红黄牌 / OFFSIDE / GK Interaction / Set Piece /
 *   SECOND_BALL 完整 Resolution / 高级身体对抗 —— 本模块只标记，不实现。
 */

import { dist, clamp01 } from './player-situation.js';
import { buildDecisionScope, createDecisionRng } from './decision-rng.js';
import {
  INTERACTION_RESOLUTION_CONFIG as C, INTERACTION_RESOLUTION_RULE_VERSION,
  DRIBBLE_OUTCOMES, TACKLE_OUTCOMES, PRESS_OUTCOMES, INTERCEPTION_OUTCOMES,
  INTERACTION_BALL_STATE as BS, FOLLOW_UP_KIND,
} from './interaction-resolution-config.js';

const clampPitch = (v) => Math.min(C.PITCH_MAX, Math.max(C.PITCH_MIN, Number.isFinite(Number(v)) ? Number(v) : 0.5));

/** 取球员坐标（缺失回退球场中心）。 */
function posOf(p) {
  const x = Number(p?.positionOnPitch?.x);
  const y = Number(p?.positionOnPitch?.y);
  return { x: Number.isFinite(x) ? x : 0.5, y: Number.isFinite(y) ? y : 0.5 };
}

/** 属性归一化 [0,1]（缺失回退中值 50）。 */
function abilityOf(p, key) {
  const v = Number(p?.attributes?.[key]);
  return clamp01((Number.isFinite(v) ? v : 50) / 99);
}

const isUsable = (p) => !!p && p.onPitch !== false && !p.injured && !p.sentOff;

function findPlayer(matchCore, id) {
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];
  return players.find((p) => p.playerId === id) ?? null;
}

function teamIdOf(matchCore, playerId) {
  return findPlayer(matchCore, playerId)?.teamId ?? null;
}

/** 围绕某点的对手压迫（附近可用对手数 / NORM）。 */
export function resolveInteractionPressure(matchCore, origin, actorId) {
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];
  const actorTeam = teamIdOf(matchCore, actorId);
  let n = 0;
  for (const p of players) {
    if (p.teamId === actorTeam || p.playerId === actorId) continue;
    if (!isUsable(p)) continue;
    if (dist(posOf(p), origin) <= C.PRESSURE_RANGE) n += 1;
  }
  return clamp01(n / C.PRESSURE_NORM);
}

/** 最近的可用对手（range 内；无则 null）。 */
function nearestOpponent(matchCore, actor, range) {
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];
  const origin = posOf(actor);
  let best = null;
  let bestD = Infinity;
  for (const p of players) {
    if (p.teamId === actor.teamId || !isUsable(p)) continue;
    const d = dist(origin, posOf(p));
    if (d <= range && (d < bestD || (d === bestD && best && p.playerId < best.playerId))) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** 确定性散布点（消耗 2 次 RNG；有界；bounce/spin 属 Deferred）。 */
function scatterPoint(origin, rng) {
  const angle = rng.next() * Math.PI * 2;
  const radius = C.SCATTER_MAX * clamp01(rng.next());
  return { x: clampPitch(origin.x + Math.cos(angle) * radius), y: clampPitch(origin.y + Math.sin(angle) * radius) };
}

/** 线段上距 p 最近的点（用于拦截判定）。 */
function closestPointOnSegment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 1e-12) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * vx, y: a.y + t * vy };
}

/** 战术压迫特征（读只读战术状态；缺失回退 medium）。 */
function pressingFeature(matchCore, teamId) {
  const p = matchCore?.tactical?.[teamId]?.pressing;
  if (p === 'high') return 1;
  if (p === 'low') return 0.3;
  return 0.6;
}

/** 构造 Interaction Resolution RNG scope（与 Decision / PASS / SHOT 完全隔离）。 */
export function buildInteractionResolutionScope(matchCore, actionType, actorId, sequence = 0, seed = null, ruleVersion = INTERACTION_RESOLUTION_RULE_VERSION) {
  const base = buildDecisionScope(matchCore, actorId, sequence, seed, ruleVersion);
  return `${base}|interaction|${actionType}`;
}

// ===========================================================================
// Result 构造（纯数据）
// ===========================================================================

function mkMeta(options, ruleVersion) {
  return { ruleVersion, sequence: options.sequence ?? 0 };
}

/** 统一结果骨架（纯数据；不持有 authoritative state）。 */
function makeResult(actionType, { ok, outcome, reason = null, actorId = null, targetId = null, meta }) {
  return {
    type: 'INTERACTION_RESOLUTION',
    actionType,
    ok,
    outcome,
    reason,
    actorId,
    targetId,
    ball: { position: { x: 0.5, y: 0.5 }, state: null, inTransit: false },
    possession: {
      changed: false, retained: false, loose: false,
      fromPlayerId: null, fromTeamId: null, toPlayerId: null, toTeamId: null,
    },
    looseBall: false,
    requiresFollowUp: false,
    followUpKind: null,
    execution: null,
    resolutionMeta: meta,
    debug: null,
  };
}

/** 非法输入的确定性取消结果。 */
function cancelled(actionType, outcomeCancelled, actorId, targetId, reason, meta, matchCore) {
  const r = makeResult(actionType, { ok: false, outcome: outcomeCancelled, reason, actorId, targetId, meta });
  r.ball = { position: { ...posOf(findPlayer(matchCore, matchCore?.ball?.control)) }, state: null, inTransit: !!matchCore?.ball?.transit };
  r.possession.fromPlayerId = matchCore?.ball?.control ?? null;
  r.possession.fromTeamId = matchCore?.ball?.possessingTeamId ?? null;
  return r;
}

/** 填充球的终态语义（供 state-update 消费）。 */
function setBall(result, position, state, inTransit = false) {
  result.ball = { position: { ...position }, state, inTransit };
  return result;
}

/** 填充 possession 语义。 */
function setPossession(result, { changed, retained = false, loose = false, fromPlayerId, fromTeamId, toPlayerId = null, toTeamId = null }) {
  result.possession = { changed, retained, loose, fromPlayerId: fromPlayerId ?? null, fromTeamId: fromTeamId ?? null, toPlayerId, toTeamId };
  return result;
}

function markFollowUp(result) {
  result.looseBall = true;
  result.requiresFollowUp = true;
  result.followUpKind = FOLLOW_UP_KIND.SECOND_BALL;
  return result;
}

// ===========================================================================
// A. DRIBBLE Resolution
// ===========================================================================

/**
 * 执行一次 DRIBBLE Resolution。
 * @param {object} actionInstance 必须为 DRIBBLE 的 ActionInstance
 * @param {object} matchCore MatchCore-like 状态（只读）
 * @param {{seed?:string, sequence?:number, ruleVersion?:string, debug?:boolean}} [options]
 * @returns {object} InteractionResolutionResult
 */
export function resolveDribble(actionInstance, matchCore, options = {}) {
  const ruleVersion = options.ruleVersion ?? INTERACTION_RESOLUTION_RULE_VERSION;
  const meta = mkMeta(options, ruleVersion);
  const T = 'DRIBBLE';

  if (!actionInstance || actionInstance.actionType !== T) {
    return cancelled(T, DRIBBLE_OUTCOMES.CANCELLED, actionInstance?.actorId ?? null, null, 'NOT_DRIBBLE_ACTION', meta, matchCore);
  }
  const actorId = actionInstance.actorId;
  const actor = findPlayer(matchCore, actorId);
  if (!isUsable(actor)) return cancelled(T, DRIBBLE_OUTCOMES.CANCELLED, actorId, null, 'INVALID_ACTOR', meta, matchCore);
  if (matchCore?.ball?.control !== actorId) return cancelled(T, DRIBBLE_OUTCOMES.CANCELLED, actorId, null, 'BALL_NOT_CONTROLLED_BY_ACTOR', meta, matchCore);
  const target = actionInstance.target;
  if (!target || target.type !== 'SPACE') return cancelled(T, DRIBBLE_OUTCOMES.CANCELLED, actorId, null, 'INVALID_TARGET', meta, matchCore);

  const origin = posOf(actor);
  const destination = { x: clampPitch(target.x), y: clampPitch(target.y) };
  const pressure = resolveInteractionPressure(matchCore, origin, actorId);
  const technique = abilityOf(actor, 'technique');
  const pace = abilityOf(actor, 'pace');
  const challenger = nearestOpponent(matchCore, actor, C.DRIBBLE_CHALLENGE_RANGE);

  const scope = buildInteractionResolutionScope(matchCore, T, actorId, options.sequence ?? 0, options.seed ?? null, ruleVersion);
  const rng = createDecisionRng(scope);

  const successProb = clamp01(
    C.DRIBBLE_BASE_SUCCESS
    + C.DRIBBLE_TECHNIQUE_WEIGHT * technique
    + C.DRIBBLE_PACE_WEIGHT * pace
    - C.DRIBBLE_PRESSURE_PENALTY * pressure
    + C.DRIBBLE_FREE_SPACE_BONUS * (challenger ? 0 : 1),
  );

  const fromPlayerId = actorId;
  const fromTeamId = actor.teamId;
  const roll = rng.next();
  let outcome;
  if (roll < successProb) {
    outcome = DRIBBLE_OUTCOMES.COMPLETED;
  } else if (!challenger) {
    outcome = DRIBBLE_OUTCOMES.KNOCKED_LOOSE; // 无挑战者时的自身失误
  } else {
    outcome = rng.next() < C.DRIBBLE_LOOSE_RATIO ? DRIBBLE_OUTCOMES.KNOCKED_LOOSE : DRIBBLE_OUTCOMES.LOST;
  }

  const result = makeResult(T, { ok: true, outcome, actorId, targetId: challenger?.playerId ?? null, meta });
  if (outcome === DRIBBLE_OUTCOMES.COMPLETED) {
    setBall(result, destination, BS.CONTROLLED);
    setPossession(result, { changed: false, retained: true, fromPlayerId, fromTeamId, toPlayerId: actorId, toTeamId: fromTeamId });
  } else if (outcome === DRIBBLE_OUTCOMES.LOST) {
    setBall(result, posOf(challenger), BS.CONTROLLED);
    setPossession(result, { changed: true, fromPlayerId, fromTeamId, toPlayerId: challenger.playerId, toTeamId: challenger.teamId });
  } else {
    setBall(result, scatterPoint(origin, rng), BS.FREE);
    setPossession(result, { changed: true, loose: true, fromPlayerId, fromTeamId });
    markFollowUp(result);
  }

  result.execution = {
    origin: { ...origin }, destination, pressure, technique, pace,
    challengerId: challenger?.playerId ?? null, successProb, roll,
  };
  if (options.debug) result.debug = { ...result.execution, rngScope: scope };
  return result;
}

// ===========================================================================
// B. TACKLE Resolution
// ===========================================================================

/**
 * 执行一次 TACKLE Resolution。
 * @param {object} actionInstance 必须为 TACKLE 的 ActionInstance
 * @param {object} matchCore
 * @param {{seed?:string, sequence?:number, ruleVersion?:string, debug?:boolean}} [options]
 * @returns {object} InteractionResolutionResult
 */
export function resolveTackle(actionInstance, matchCore, options = {}) {
  const ruleVersion = options.ruleVersion ?? INTERACTION_RESOLUTION_RULE_VERSION;
  const meta = mkMeta(options, ruleVersion);
  const T = 'TACKLE';

  if (!actionInstance || actionInstance.actionType !== T) {
    return cancelled(T, TACKLE_OUTCOMES.CANCELLED, actionInstance?.actorId ?? null, actionInstance?.target?.playerId ?? null, 'NOT_TACKLE_ACTION', meta, matchCore);
  }
  const actorId = actionInstance.actorId;
  const targetId = actionInstance.target?.playerId ?? null;
  const actor = findPlayer(matchCore, actorId);
  if (!isUsable(actor)) return cancelled(T, TACKLE_OUTCOMES.CANCELLED, actorId, targetId, 'INVALID_ACTOR', meta, matchCore);
  if (matchCore?.ball?.control === actorId) return cancelled(T, TACKLE_OUTCOMES.CANCELLED, actorId, targetId, 'ACTOR_ALREADY_CONTROLS_BALL', meta, matchCore);
  if (!actionInstance.target || actionInstance.target.type !== 'OPPONENT') return cancelled(T, TACKLE_OUTCOMES.CANCELLED, actorId, targetId, 'INVALID_TARGET', meta, matchCore);
  const carrier = findPlayer(matchCore, targetId);
  if (!isUsable(carrier)) return cancelled(T, TACKLE_OUTCOMES.CANCELLED, actorId, targetId, 'INVALID_TARGET', meta, matchCore);
  if (carrier.teamId === actor.teamId) return cancelled(T, TACKLE_OUTCOMES.CANCELLED, actorId, targetId, 'TARGET_NOT_OPPONENT', meta, matchCore);
  if (matchCore?.ball?.control !== targetId) return cancelled(T, TACKLE_OUTCOMES.CANCELLED, actorId, targetId, 'TARGET_NOT_CARRIER', meta, matchCore);

  const actorPos = posOf(actor);
  const carrierPos = posOf(carrier);
  const d = dist(actorPos, carrierPos);
  const defending = abilityOf(actor, 'defending');
  const carrierTechnique = abilityOf(carrier, 'technique');
  const carrierPace = abilityOf(carrier, 'pace');
  const closeness = clamp01(1 - d / Math.max(1e-9, C.TACKLE_RANGE));

  const scope = buildInteractionResolutionScope(matchCore, T, actorId, options.sequence ?? 0, options.seed ?? null, ruleVersion);
  const rng = createDecisionRng(scope);

  const successProb = clamp01(
    C.TACKLE_BASE_SUCCESS
    + C.TACKLE_DEFENDING_WEIGHT * defending
    + C.TACKLE_CLOSENESS_WEIGHT * closeness
    - C.TACKLE_CARRIER_TECHNIQUE_PENALTY * carrierTechnique
    - C.TACKLE_CARRIER_PACE_PENALTY * carrierPace,
  );

  const fromPlayerId = targetId;
  const fromTeamId = carrier.teamId;
  const roll = rng.next();
  let outcome;
  if (roll < successProb) {
    outcome = TACKLE_OUTCOMES.WON;
  } else {
    outcome = rng.next() < C.TACKLE_LOOSE_RATIO ? TACKLE_OUTCOMES.LOOSE : TACKLE_OUTCOMES.LOST;
  }

  const contestPoint = { x: clampPitch((actorPos.x + carrierPos.x) / 2), y: clampPitch((actorPos.y + carrierPos.y) / 2) };
  const result = makeResult(T, { ok: true, outcome, actorId, targetId, meta });
  if (outcome === TACKLE_OUTCOMES.WON) {
    setBall(result, contestPoint, BS.CONTROLLED);
    setPossession(result, { changed: true, fromPlayerId, fromTeamId, toPlayerId: actorId, toTeamId: actor.teamId });
  } else if (outcome === TACKLE_OUTCOMES.LOST) {
    setBall(result, carrierPos, BS.CONTROLLED);
    setPossession(result, { changed: false, retained: true, fromPlayerId, fromTeamId, toPlayerId: targetId, toTeamId: fromTeamId });
  } else {
    setBall(result, scatterPoint(contestPoint, rng), BS.FREE);
    setPossession(result, { changed: true, loose: true, fromPlayerId, fromTeamId });
    markFollowUp(result);
  }

  result.execution = {
    distance: d, defending, carrierTechnique, carrierPace, closeness,
    successProb, roll, contestPoint,
  };
  if (options.debug) result.debug = { ...result.execution, rngScope: scope };
  return result;
}

// ===========================================================================
// C. PRESS Resolution
// ===========================================================================

/**
 * 执行一次 PRESS Resolution。
 * 语义 ≠ TACKLE：压迫不直接夺球入控，只迫使持球人失控（loose）或施压（保留控制）。
 * @param {object} actionInstance 必须为 PRESS 的 ActionInstance
 * @param {object} matchCore
 * @param {{seed?:string, sequence?:number, ruleVersion?:string, debug?:boolean}} [options]
 * @returns {object} InteractionResolutionResult
 */
export function resolvePress(actionInstance, matchCore, options = {}) {
  const ruleVersion = options.ruleVersion ?? INTERACTION_RESOLUTION_RULE_VERSION;
  const meta = mkMeta(options, ruleVersion);
  const T = 'PRESS';

  if (!actionInstance || actionInstance.actionType !== T) {
    return cancelled(T, PRESS_OUTCOMES.CANCELLED, actionInstance?.actorId ?? null, actionInstance?.target?.playerId ?? null, 'NOT_PRESS_ACTION', meta, matchCore);
  }
  const actorId = actionInstance.actorId;
  const targetId = actionInstance.target?.playerId ?? null;
  const actor = findPlayer(matchCore, actorId);
  if (!isUsable(actor)) return cancelled(T, PRESS_OUTCOMES.CANCELLED, actorId, targetId, 'INVALID_ACTOR', meta, matchCore);
  if (matchCore?.ball?.control === actorId) return cancelled(T, PRESS_OUTCOMES.CANCELLED, actorId, targetId, 'ACTOR_ALREADY_CONTROLS_BALL', meta, matchCore);
  if (!actionInstance.target || actionInstance.target.type !== 'OPPONENT') return cancelled(T, PRESS_OUTCOMES.CANCELLED, actorId, targetId, 'INVALID_TARGET', meta, matchCore);
  const carrier = findPlayer(matchCore, targetId);
  if (!isUsable(carrier)) return cancelled(T, PRESS_OUTCOMES.CANCELLED, actorId, targetId, 'INVALID_TARGET', meta, matchCore);
  if (carrier.teamId === actor.teamId) return cancelled(T, PRESS_OUTCOMES.CANCELLED, actorId, targetId, 'TARGET_NOT_OPPONENT', meta, matchCore);
  if (matchCore?.ball?.control !== targetId) return cancelled(T, PRESS_OUTCOMES.CANCELLED, actorId, targetId, 'TARGET_NOT_CARRIER', meta, matchCore);

  const actorPos = posOf(actor);
  const carrierPos = posOf(carrier);
  const d = dist(actorPos, carrierPos);
  const defending = abilityOf(actor, 'defending');
  const carrierComposure = abilityOf(carrier, 'technique');
  const closeness = clamp01(1 - d / Math.max(1e-9, C.PRESS_RANGE));
  const teamPressing = pressingFeature(matchCore, actor.teamId);

  const scope = buildInteractionResolutionScope(matchCore, T, actorId, options.sequence ?? 0, options.seed ?? null, ruleVersion);
  const rng = createDecisionRng(scope);

  const successProb = clamp01(
    C.PRESS_BASE_SUCCESS
    + C.PRESS_DEFENDING_WEIGHT * defending
    + C.PRESS_CLOSENESS_WEIGHT * closeness
    + C.PRESS_TEAM_PRESSING_WEIGHT * teamPressing
    - C.PRESS_CARRIER_COMPOSURE_PENALTY * carrierComposure,
  );

  const fromPlayerId = targetId;
  const fromTeamId = carrier.teamId;
  const roll = rng.next();
  let outcome;
  if (roll < successProb) {
    outcome = PRESS_OUTCOMES.SUCCESS;
  } else {
    outcome = rng.next() < C.PRESS_PRESSURE_ONLY_RATIO ? PRESS_OUTCOMES.PRESSURE_ONLY : PRESS_OUTCOMES.FAILED;
  }

  const result = makeResult(T, { ok: true, outcome, actorId, targetId, meta });
  if (outcome === PRESS_OUTCOMES.SUCCESS) {
    setBall(result, scatterPoint(carrierPos, rng), BS.FREE);
    setPossession(result, { changed: true, loose: true, fromPlayerId, fromTeamId });
    markFollowUp(result);
  } else if (outcome === PRESS_OUTCOMES.PRESSURE_ONLY) {
    setBall(result, carrierPos, BS.CONTROLLED);
    setPossession(result, { changed: false, retained: true, fromPlayerId, fromTeamId, toPlayerId: targetId, toTeamId: fromTeamId });
  } else {
    setBall(result, carrierPos, BS.CONTROLLED);
    setPossession(result, { changed: false, retained: true, fromPlayerId, fromTeamId, toPlayerId: targetId, toTeamId: fromTeamId });
  }

  result.execution = {
    distance: d, defending, carrierComposure, closeness, teamPressing,
    successProb, roll,
    pressureApplied: outcome !== PRESS_OUTCOMES.FAILED,
    carrierRetainedControl: outcome !== PRESS_OUTCOMES.SUCCESS,
  };
  if (options.debug) result.debug = { ...result.execution, rngScope: scope };
  return result;
}

// ===========================================================================
// D. INTERCEPTION Resolution
// ===========================================================================

/**
 * 执行一次 INTERCEPTION Resolution（针对 in-transit 球）。
 *
 * 说明：`INTERCEPTION` 是 **Resolution 级动作描述**（见 action-definitions：`INTERCEPT = Resolution Result`），
 * 不在冻结的 MVP Action 集合（Decision 产生）中；由 transit 子系统在未来集成时调用。
 * 输入仍保持 ActionInstance 形状以保证流水线一致：{ actionType:'INTERCEPTION', actorId, target:{type:'BALL'} }。
 *
 * @param {object} actionInstance { actionType:'INTERCEPTION', actorId, target:{type:'BALL'} }
 * @param {object} matchCore
 * @param {{seed?:string, sequence?:number, ruleVersion?:string, debug?:boolean}} [options]
 * @returns {object} InteractionResolutionResult
 */
export function resolveInterception(actionInstance, matchCore, options = {}) {
  const ruleVersion = options.ruleVersion ?? INTERACTION_RESOLUTION_RULE_VERSION;
  const meta = mkMeta(options, ruleVersion);
  const T = 'INTERCEPTION';

  if (!actionInstance || actionInstance.actionType !== T) {
    return cancelled(T, INTERCEPTION_OUTCOMES.CANCELLED, actionInstance?.actorId ?? null, null, 'NOT_INTERCEPTION_ACTION', meta, matchCore);
  }
  const actorId = actionInstance.actorId;
  const actor = findPlayer(matchCore, actorId);
  if (!isUsable(actor)) return cancelled(T, INTERCEPTION_OUTCOMES.CANCELLED, actorId, null, 'INVALID_ACTOR', meta, matchCore);
  const transit = matchCore?.ball?.transit;
  if (!transit || typeof transit.from?.x !== 'number' || typeof transit.to?.x !== 'number') {
    return cancelled(T, INTERCEPTION_OUTCOMES.CANCELLED, actorId, null, 'BALL_NOT_IN_TRANSIT', meta, matchCore);
  }

  const origin = posOf(actor);
  const from = { x: clampPitch(transit.from.x), y: clampPitch(transit.from.y) };
  const to = { x: clampPitch(transit.to.x), y: clampPitch(transit.to.y) };
  const point = closestPointOnSegment(origin, from, to);
  const d = dist(origin, point);
  const defending = abilityOf(actor, 'defending');
  const reach = clamp01(1 - d / Math.max(1e-9, C.INTERCEPTION_RANGE));
  const progress = clamp01(Number(transit.progress) || 0);
  const ballPos = posOf({ positionOnPitch: matchCore?.ball?.position ?? { x: from.x, y: from.y } });

  const scope = buildInteractionResolutionScope(matchCore, T, actorId, options.sequence ?? 0, options.seed ?? null, ruleVersion);
  const rng = createDecisionRng(scope);

  const successProb = clamp01(
    C.INTERCEPTION_BASE_SUCCESS
    + C.INTERCEPTION_DEFENDING_WEIGHT * defending
    + C.INTERCEPTION_REACH_WEIGHT * reach
    - C.INTERCEPTION_PROGRESS_PENALTY * progress,
  );

  const fromTeamId = transit.targetTeamId ?? matchCore?.ball?.possessingTeamId ?? null;
  const roll = rng.next();
  let outcome;
  if (roll < successProb) {
    outcome = INTERCEPTION_OUTCOMES.INTERCEPTED;
  } else {
    outcome = rng.next() < C.INTERCEPTION_DEFLECT_RATIO ? INTERCEPTION_OUTCOMES.DEFLECTED : INTERCEPTION_OUTCOMES.FAILED;
  }

  const result = makeResult(T, { ok: true, outcome, actorId, targetId: transit.intendedTargetId ?? transit.actorId ?? null, meta });
  if (outcome === INTERCEPTION_OUTCOMES.INTERCEPTED) {
    setBall(result, point, BS.CONTROLLED, false);
    setPossession(result, { changed: true, fromPlayerId: transit.actorId ?? null, fromTeamId, toPlayerId: actorId, toTeamId: actor.teamId });
  } else if (outcome === INTERCEPTION_OUTCOMES.DEFLECTED) {
    setBall(result, scatterPoint(point, rng), BS.FREE, false);
    setPossession(result, { changed: true, loose: true, fromPlayerId: transit.actorId ?? null, fromTeamId });
    markFollowUp(result);
  } else {
    // 未拦截：球继续处于 transit（state-update 不改动权威球状态）。
    setBall(result, ballPos, BS.IN_TRANSIT, true);
    setPossession(result, { changed: false, retained: true, fromPlayerId: transit.actorId ?? null, fromTeamId, toPlayerId: null, toTeamId: fromTeamId });
  }

  result.execution = {
    interceptPoint: point, distance: d, defending, reach, progress, successProb, roll,
  };
  if (options.debug) result.debug = { ...result.execution, rngScope: scope };
  return result;
}

// ===========================================================================
// Dispatcher
// ===========================================================================

const HANDLERS = Object.freeze({
  DRIBBLE: resolveDribble,
  TACKLE: resolveTackle,
  PRESS: resolvePress,
  INTERCEPTION: resolveInterception,
});

/**
 * 统一入口：按 ActionInstance.actionType 分派到对应 Interaction Resolution。
 * 未支持的类型返回 `unsupported` 结果（ok:false），不抛错、不改状态。
 * @param {object} actionInstance
 * @param {object} matchCore
 * @param {{seed?:string, sequence?:number, ruleVersion?:string, debug?:boolean}} [options]
 * @returns {object} InteractionResolutionResult
 */
export function resolveInteraction(actionInstance, matchCore, options = {}) {
  const ruleVersion = options.ruleVersion ?? INTERACTION_RESOLUTION_RULE_VERSION;
  const handler = HANDLERS[actionInstance?.actionType];
  if (!handler) {
    const meta = mkMeta(options, ruleVersion);
    const r = makeResult(actionInstance?.actionType ?? 'UNKNOWN', {
      ok: false, outcome: 'INTERACTION_UNSUPPORTED', reason: 'UNSUPPORTED_ACTION_TYPE',
      actorId: actionInstance?.actorId ?? null, targetId: null, meta,
    });
    return r;
  }
  return handler(actionInstance, matchCore, options);
}