/**
 * PASS Resolution（Step 39F-M-B-RESOLUTION-PASS）。
 * 层级归属：Simulation Core / Match Resolution。**纯函数、无副作用、无 Math.random**。
 *
 * 职责：接收 Decision 已产出的 `ActionInstance`（PASS），执行该动作，产出
 * `PassResolutionResult`（意图目标 ≠ 最终落点；失败可细分 COMPLETED/INACCURATE/INTERCEPTED/BLOCKED）。
 *
 * 红线（冻结）：
 * - **不重新决策**（不调用 decidePlayerAction / 不重生成 Candidate / 不换目标）。
 * - **不产生 Event / 不写 stats / 不碰 Growth·Training·Development / 不持久化**。
 * - 不改 MatchCore（状态变更由 `pass-state-update.js` 承担）。
 * - Resolution RNG 与 Decision RNG **隔离**；无 OVR / teamStrength。
 */

import { dist, pointSegmentDistance, clamp01 } from './player-situation.js';
import { buildDecisionScope, createDecisionRng } from './decision-rng.js';
import {
  PASS_RESOLUTION_CONFIG as C, PASS_RESOLUTION_RULE_VERSION, PASS_OUTCOMES,
} from './pass-resolution-config.js';

/** 半径夹取到 pitch。 */
function clampPitch(v) {
  return Math.min(C.PITCH_MAX, Math.max(C.PITCH_MIN, Number.isFinite(v) ? v : 0.5));
}

/** 取球员坐标（缺失回退球场中心）。 */
function posOf(p) {
  const x = Number(p?.positionOnPitch?.x);
  const y = Number(p?.positionOnPitch?.y);
  return { x: Number.isFinite(x) ? x : 0.5, y: Number.isFinite(y) ? y : 0.5 };
}

/** 属性归一化 [0,1]（缺失回退中值）。 */
function abilityOf(p, key) {
  const v = Number(p?.attributes?.[key]);
  return clamp01((Number.isFinite(v) ? v : 50) / 99);
}

/** Resolution 侧压力派生（与 Decision 压力语义不同；基于 MatchCore 事实）。 */
export function resolvePressure(matchCore, origin, actorId) {
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];
  const actorTeam = players.find((p) => p.playerId === actorId)?.teamId;
  let n = 0;
  for (const p of players) {
    if (p.teamId === actorTeam || p.playerId === actorId) continue;
    if (p.onPitch === false || p.injured || p.sentOff) continue;
    if (dist(posOf(p), origin) <= C.PRESSURE_RANGE) n += 1;
  }
  return clamp01(n / C.PRESSURE_NORM);
}

/** 传球难度（可解释、非黑箱）。 */
export function calculatePassDifficulty({ distance, pressure, ability, riskLevel }) {
  const distanceRatio = clamp01(distance / C.DISTANCE_REF);
  const abilityPenalty = 1 - ability; // 能力越低越难
  const raw = 0.5 * distanceRatio + 0.3 * pressure + 0.2 * abilityPenalty;
  const riskMod = C.RISK_ERROR_MOD[riskLevel] ?? 1;
  return clamp01(raw * riskMod);
}

/** 误差幅度（有界；由 ability/distance/pressure/risk/intent + RNG 抖动决定）。 */
export function calculatePassError({ distance, pressure, ability, riskLevel, passIntent, rng }) {
  const distanceRatio = clamp01(distance / C.DISTANCE_REF);
  const abilityMod = 1 + C.ABILITY_ERROR_SCALE * (1 - ability);
  const distanceMod = 1 + C.DISTANCE_ERROR_SCALE * distanceRatio;
  const pressureMod = 1 + C.PRESSURE_ERROR_SCALE * pressure;
  const riskMod = C.RISK_ERROR_MOD[riskLevel] ?? 1;
  const intentMod = C.INTENT_ERROR_MOD[passIntent] ?? 1;
  const f = C.ERROR_RNG_FACTOR;
  const jitter = 1 - f + 2 * f * clamp01(rng.next());
  const raw = C.BASE_ERROR * abilityMod * distanceMod * pressureMod * riskMod * intentMod * jitter;
  return Math.min(C.MAX_ERROR, Math.max(C.MIN_ERROR, raw));
}

/** 拦截暴露度（线路走廊内的对手贡献）。 */
export function calculateInterceptionExposure(matchCore, actorId, from, to) {
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];
  const actorTeam = players.find((p) => p.playerId === actorId)?.teamId;
  let exposure = 0;
  let nearest = null;
  let nearestDist = Infinity;
  let bestDefending = 0;
  for (const p of players) {
    if (p.teamId === actorTeam) continue;
    if (p.onPitch === false || p.injured || p.sentOff) continue;
    const d = pointSegmentDistance(posOf(p), from, to);
    if (d <= C.INTERCEPTION_CORRIDOR) {
      exposure += 1 - d / C.INTERCEPTION_CORRIDOR;
      if (d < nearestDist) { nearestDist = d; nearest = p.playerId; }
      bestDefending = Math.max(bestDefending, abilityOf(p, 'defending'));
    }
  }
  return { exposure: clamp01(exposure / 2), interceptorId: nearest, defenderAbility: bestDefending };
}

/** 飞行时长（简化；有界）。 */
export function calculateTransitDuration(distance, passIntent) {
  const base = C.MIN_PASS_DURATION + distance / Math.max(1e-6, C.PASS_SPEED);
  const mod = C.INTENT_DURATION_MOD[passIntent] ?? 1;
  return Math.min(C.MAX_PASS_DURATION, Math.max(C.MIN_PASS_DURATION, base * mod));
}

/** 构造 PASS Resolution RNG scope（与 Decision RNG 完全隔离）。 */
export function buildPassResolutionScope(matchCore, actorId, targetId, passSequence = 0, seed = null, ruleVersion = PASS_RESOLUTION_RULE_VERSION) {
  const base = buildDecisionScope(matchCore, actorId, passSequence, seed, ruleVersion);
  return `${base}|pass|${targetId}`;
}

/** 非法输入的确定性取消结果。 */
function cancelled(actorId, targetId, reason, meta) {
  return {
    type: 'PASS_RESOLUTION', ok: false, outcome: PASS_OUTCOMES.CANCELLED, reason,
    actorId: actorId ?? null, targetId: targetId ?? null, intendedTarget: targetId ?? null,
    intendedDestination: null, actualDestination: null, ballDestination: null,
    transit: null, riskProfile: null, interceptorId: null, resolutionMeta: meta, debug: null,
  };
}

/**
 * 执行一次 PASS Resolution。
 * @param {object} actionInstance 必须为 PASS 的 ActionInstance
 * @param {object} matchCore MatchCore-like 状态
 * @param {{seed?:string, passSequence?:number, ruleVersion?:string, debug?:boolean}} [options]
 * @returns {object} PassResolutionResult
 */
export function resolvePass(actionInstance, matchCore, options = {}) {
  const ruleVersion = options.ruleVersion ?? PASS_RESOLUTION_RULE_VERSION;
  const meta = { ruleVersion, passSequence: options.passSequence ?? 0 };

  // 1) 输入合法性（明确拒绝，不偷偷修改 / 不重新决策）
  if (!actionInstance || actionInstance.actionType !== 'PASS') {
    return cancelled(actionInstance?.actionId ?? actionInstance?.actorId, actionInstance?.target?.playerId, 'NOT_PASS_ACTION', meta);
  }
  const actorId = actionInstance.actorId;
  const targetId = actionInstance.target?.playerId ?? null;
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];
  const actor = players.find((p) => p.playerId === actorId);
  const target = players.find((p) => p.playerId === targetId);
  if (!actor) return cancelled(actorId, targetId, 'INVALID_ACTOR', meta);
  if (actor.onPitch === false || actor.injured || actor.sentOff) return cancelled(actorId, targetId, 'INVALID_ACTOR', meta);
  if (!target) return cancelled(actorId, targetId, 'INVALID_TARGET', meta);
  if (target.onPitch === false || target.injured || target.sentOff) return cancelled(actorId, targetId, 'INVALID_TARGET', meta);
  if (target.teamId !== actor.teamId) return cancelled(actorId, targetId, 'INVALID_TARGET', meta);
  if (matchCore?.ball?.control !== actorId) return cancelled(actorId, targetId, 'BALL_NOT_CONTROLLED_BY_ACTOR', meta);

  // 2) 几何与语义
  const origin = posOf(actor);
  const intendedDestination = posOf(target);
  const distance = dist(origin, intendedDestination);
  const pressure = resolvePressure(matchCore, origin, actorId);
  const ability = abilityOf(actor, 'passing');
  const riskLevel = actionInstance.riskIntent?.level ?? 'MEDIUM';
  const passIntent = actionInstance.intent ?? 'NORMAL';

  const scope = buildPassResolutionScope(matchCore, actorId, targetId, options.passSequence ?? 0, options.seed ?? null, ruleVersion);
  const rng = createDecisionRng(scope);

  // 3) 误差
  const difficulty = calculatePassDifficulty({ distance, pressure, ability, riskLevel });
  const errorMagnitude = calculatePassError({ distance, pressure, ability, riskLevel, passIntent, rng });
  const angle = rng.next() * Math.PI * 2;
  // HIGH risk 允许更激进落点前推（仅 execution profile，不是 success bonus）
  const push = C.RISK_DESTINATION_PUSH[riskLevel] ?? 0;
  const bx = intendedDestination.x + Math.cos(angle) * errorMagnitude + push;
  const by = intendedDestination.y + Math.sin(angle) * errorMagnitude;
  const actualDestination = { x: clampPitch(bx), y: clampPitch(by) };

  // 4) 拦截暴露
  const lane = calculateInterceptionExposure(matchCore, actorId, origin, actualDestination);
  const defenderFactor = 1 - C.DEFENDING_INTERCEPT_SCALE + C.DEFENDING_INTERCEPT_SCALE * lane.defenderAbility;
  const interceptionRisk = Math.min(C.INTERCEPTION_MAX, clamp01(C.INTERCEPTION_BASE * lane.exposure * defenderFactor));

  // 5) 结果判定（顺序：拦截 → 精度 → 封堵 → 成功）
  const landed = dist(actualDestination, intendedDestination) <= C.CONTROL_RADIUS;
  let outcome = PASS_OUTCOMES.COMPLETED;
  let interceptorId = null;
  let blockerId = null;
  if (lane.exposure > 0 && rng.next() < interceptionRisk) {
    outcome = PASS_OUTCOMES.INTERCEPTED;
    interceptorId = lane.interceptorId;
  } else if (!landed) {
    outcome = PASS_OUTCOMES.INACCURATE;
  } else {
    // 封堵：落点附近有防守球员
    let nearestDef = null; let nd = Infinity;
    for (const p of players) {
      if (p.teamId === actor.teamId) continue;
      if (p.onPitch === false || p.injured || p.sentOff) continue;
      const d = dist(posOf(p), intendedDestination);
      if (d < nd) { nd = d; nearestDef = p.playerId; }
    }
    if (nearestDef && nd <= C.BLOCK_RADIUS && rng.next() < C.BLOCK_BASE) {
      outcome = PASS_OUTCOMES.BLOCKED; blockerId = nearestDef;
    }
  }

  const duration = calculateTransitDuration(distance, passIntent);
  const startedAt = Number(matchCore?.clock?.simulationTime) || 0;
  const transit = {
    state: 'IN_TRANSIT', from: { ...origin }, to: { ...actualDestination },
    intendedTargetId: targetId, startedAt, duration, progress: 0, elapsed: 0,
    outcome, interceptorId, blockerId, targetTeamId: target.teamId,
  };

  const result = {
    type: 'PASS_RESOLUTION', ok: true,
    actorId, targetId, intendedTarget: targetId,
    intendedDestination: { ...intendedDestination },
    actualDestination: { ...actualDestination },
    outcome,
    ballDestination: { ...actualDestination },
    transit,
    riskProfile: { level: riskLevel },
    interceptorId, blockerId,
    execution: { distance, pressure, ability, difficulty, errorMagnitude, interceptionRisk, laneExposure: lane.exposure },
    resolutionMeta: { ...meta, rngScope: scope, seed: options.seed ?? null },
    debug: null,
  };

  if (options.debug) {
    result.debug = {
      actorId, targetId, origin: { ...origin }, intendedDestination: { ...intendedDestination },
      actualDestination: { ...actualDestination }, distance, pressure, ability,
      riskIntent: riskLevel, passIntent, errorMagnitude, interceptionRisk,
      laneExposure: lane.exposure, outcome, rngScope: scope,
    };
  }
  return result;
}
