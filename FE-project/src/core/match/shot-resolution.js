/**
 * SHOT Resolution（Step 39F-M-B-RESOLUTION-SHOT）。
 * 层级归属：Simulation Core / Match Resolution。**纯函数、无副作用、无 Math.random**。
 *
 * 四层语义（冻结）：
 *   SHOT ActionInstance → Shot Execution → Goalkeeper Reaction → Result
 * 严格顺序：Validate → Geometry → Error → Destination → Block → MISS → GK Reaction → GOAL/SAVE。
 *
 * 红线：
 * - **不重新 Decision / 不调用 resolvePass / 不换目标**。
 * - **不产生 Event / 不写 stats / 不碰 Growth·Training·Development / 不持久化 / 不改 Score**。
 * - 不改 MatchCore（状态变更由 shot-state-update.js 承担）。
 * - Shot RNG 与 Decision RNG / PASS RNG **隔离**；无 OVR / teamStrength。
 * - SAVE ≠ BLOCKED；MISS ≠ SAVE；SHOT 目标为 goal area（非 playerId）。
 */

import { dist, pointSegmentDistance, clamp01 } from './player-situation.js';
import { buildDecisionScope, createDecisionRng } from './decision-rng.js';
import {
  SHOT_RESOLUTION_CONFIG as C, SHOT_RESOLUTION_RULE_VERSION, SHOT_OUTCOMES,
} from './shot-resolution-config.js';

const clampPitch = (v) => Math.min(C.PITCH_MAX, Math.max(C.PITCH_MIN, Number.isFinite(v) ? v : 0.5));
const posOf = (p) => {
  const x = Number(p?.positionOnPitch?.x); const y = Number(p?.positionOnPitch?.y);
  return { x: Number.isFinite(x) ? x : 0.5, y: Number.isFinite(y) ? y : 0.5 };
};
const abilityOf = (p, key) => clamp01((Number.isFinite(Number(p?.attributes?.[key])) ? Number(p.attributes[key]) : 50) / 99);
const isUsable = (p) => !!p && p.onPitch !== false && !p.injured && !p.sentOff;

/** 进攻方向：home attacks +x ⇒ home 射 x=1；away 射 x=0。 */
function goalXFor(matchCore, teamId) {
  return teamId === matchCore?.teams?.home ? 1 : 0;
}

/** Shot 几何：distance / angleFactor。 */
export function calculateShotGeometry(origin, goal) {
  const dx = Math.abs(goal.x - origin.x);
  const dy = Math.abs(goal.y - origin.y);
  const distance = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, Math.max(1e-9, dx)); // [0, π/2]
  const angleFactor = clamp01(angle / (Math.PI / 4)); // 0 正面 → 1 侧面
  return { distance, angle, angleFactor, goalDistance: distance };
}

/** Resolution 侧压力派生（围绕射门者；与 PASS pressure 语义不同）。 */
export function resolveShotPressure(matchCore, origin, actorId) {
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];
  const actorTeam = players.find((p) => p.playerId === actorId)?.teamId;
  let n = 0;
  for (const p of players) {
    if (p.teamId === actorTeam || p.playerId === actorId) continue;
    if (!isUsable(p)) continue;
    if (dist(posOf(p), origin) <= C.PRESSURE_RANGE) n += 1;
  }
  return clamp01(n / C.PRESSURE_NORM);
}

/** Shot 误差（有界；消耗 1 次 RNG 抖动）。 */
export function calculateShotError({ distance, angleFactor, pressure, finishing, technique, riskLevel, shotIntent, rng }) {
  const distanceRatio = clamp01(distance / C.DISTANCE_REF);
  const distanceMod = 1 + C.DISTANCE_ERROR_SCALE * distanceRatio;
  const angleMod = 1 + C.ANGLE_ERROR_SCALE * angleFactor;
  const pressureMod = 1 + C.PRESSURE_ERROR_SCALE * pressure;
  const abilityMod = 1 + C.ABILITY_ERROR_SCALE * (1 - finishing);
  const techniqueMod = 1 + C.TECHNIQUE_ERROR_SCALE * (1 - technique);
  const riskMod = C.RISK_ERROR_MOD[riskLevel] ?? 1;
  const intentMod = C.INTENT_MODIFIERS[shotIntent] ?? 1;
  const f = C.ERROR_RNG_FACTOR;
  const jitter = 1 - f + 2 * f * clamp01(rng.next());
  const raw = C.BASE_SHOT_ERROR * abilityMod * techniqueMod * distanceMod * angleMod * pressureMod * riskMod * intentMod * jitter;
  return Math.min(C.MAX_SHOT_ERROR, Math.max(C.MIN_SHOT_ERROR, raw));
}

/** shotQuality（内部临时；不持久化）。 */
export function calculateShotQuality({ finishing, technique, distance, angleFactor }) {
  const w = C.QUALITY_WEIGHTS;
  const distanceScore = 1 - clamp01(distance / C.DISTANCE_REF);
  const angleScore = 1 - angleFactor;
  return clamp01(w.FINISHING * finishing + w.TECHNIQUE * technique + w.DISTANCE * distanceScore + w.ANGLE * angleScore);
}

/** 封堵暴露度（射门线路走廊内的场上防守球员；不含门将）。 */
export function calculateShotBlockExposure(matchCore, actorId, from, to) {
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];
  const actorTeam = players.find((p) => p.playerId === actorId)?.teamId;
  let exposure = 0; let nearest = null; let nd = Infinity;
  for (const p of players) {
    if (p.teamId === actorTeam || !isUsable(p) || p.position === 'GK') continue;
    const d = pointSegmentDistance(posOf(p), from, to);
    if (d <= C.BLOCK_CORRIDOR) {
      exposure += 1 - d / C.BLOCK_CORRIDOR;
      if (d < nd) { nd = d; nearest = p.playerId; }
    }
  }
  return { exposure: clamp01(exposure / 2), blockerId: nearest };
}

/** 是否在门框内（2D，无高度）。 */
export function isOnTarget(destination, goalY) {
  return Math.abs(destination.y - goalY) <= C.GOAL_HALF_WIDTH;
}

/** 门将反应能力（ability + position + shot quality）。 */
export function calculateSaveExposure({ goalkeeping, gkPosition, destination, shotQuality }) {
  const abilityFactor = clamp01(goalkeeping);
  const posFactor = clamp01(1 - dist(gkPosition, destination) / C.GK_POSITION_REF);
  const base = C.GK_ABILITY_WEIGHT * abilityFactor + C.GK_POSITION_WEIGHT * posFactor;
  const discount = 1 - C.QUALITY_SAVE_DISCOUNT * clamp01(shotQuality);
  return Math.max(0, base * discount);
}

/** 由 (ability, position) 计算扑救概率，bounded。 */
export function calculateSaveProb(saveExposure) {
  return Math.min(C.GK_REACTION_MAX, clamp01(C.GK_REACTION_BASE * clamp01(saveExposure)));
}

/** 门将反应（纯函数；consumes 1 RNG）。返回 'SAVE' | 'NO_SAVE'。 */
export function resolveGoalkeeperReaction(goalkeeperId, saveProb, rng) {
  if (!goalkeeperId) return 'NO_SAVE'; // 无门将（空门）
  return rng.next() < saveProb ? 'SAVE' : 'NO_SAVE';
}

/** 飞行时长。 */
export function calculateShotTransitDuration(distance) {
  const base = C.MIN_SHOT_DURATION + distance / Math.max(1e-6, C.SHOT_SPEED);
  return Math.min(C.MAX_SHOT_DURATION, Math.max(C.MIN_SHOT_DURATION, base));
}

/** SHOT RNG scope（与 Decision / PASS 隔离）。 */
export function buildShotResolutionScope(matchCore, actorId, shotSequence = 0, seed = null, ruleVersion = SHOT_RESOLUTION_RULE_VERSION) {
  const base = buildDecisionScope(matchCore, actorId, shotSequence, seed, ruleVersion);
  return `${base}|shot`;
}

function invalid(actorId, reason, meta) {
  return {
    type: 'SHOT_RESOLUTION', ok: false, outcome: SHOT_OUTCOMES.INVALID_SHOT, reason,
    actorId: actorId ?? null, goalkeeperId: null, blockerId: null,
    intendedTarget: null, intendedDestination: null, actualDestination: null,
    transit: null, riskProfile: null, execution: null, resolutionMeta: meta, debug: null,
  };
}

/**
 * 执行一次 SHOT Resolution。
 * @param {object} actionInstance 必须为 SHOT
 * @param {object} matchCore
 * @param {{seed?:string, shotSequence?:number, ruleVersion?:string, debug?:boolean}} [options]
 * @returns {object} ShotResolutionResult
 */
export function resolveShot(actionInstance, matchCore, options = {}) {
  const ruleVersion = options.ruleVersion ?? SHOT_RESOLUTION_RULE_VERSION;
  const meta = { ruleVersion, shotSequence: options.shotSequence ?? 0 };

  // 1) Validate
  if (!actionInstance || actionInstance.actionType !== 'SHOT') {
    return invalid(actionInstance?.actorId ?? null, 'NOT_SHOT_ACTION', meta);
  }
  const actorId = actionInstance.actorId;
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];
  const actor = players.find((p) => p.playerId === actorId);
  if (!actor || !isUsable(actor)) return invalid(actorId, 'INVALID_ACTOR', meta);
  if (matchCore?.ball?.control !== actorId) return invalid(actorId, 'BALL_NOT_CONTROLLED_BY_ACTOR', meta);
  const target = actionInstance.target;
  if (!target || target.type !== 'GOAL_AREA' || !['CENTER', 'LEFT', 'RIGHT'].includes(target.zone)) {
    return invalid(actorId, 'INVALID_TARGET', meta);
  }

  // 2) Geometry
  const goalX = goalXFor(matchCore, actor.teamId);
  const goal = { x: goalX, y: C.GOAL_CENTER_Y };
  const origin = posOf(actor);
  const geo = calculateShotGeometry(origin, goal);
  const intendedDestination = { x: goalX, y: clampPitch(C.GOAL_CENTER_Y + (C.TARGET_ZONE_Y[target.zone] ?? 0)) };

  // 3) Error / 4) Destination
  const finishing = abilityOf(actor, 'finishing');
  const technique = abilityOf(actor, 'technique');
  const pressure = resolveShotPressure(matchCore, origin, actorId);
  const riskLevel = actionInstance.riskIntent?.level ?? 'MEDIUM';
  const shotIntent = actionInstance.intent ?? 'GOAL';

  const scope = buildShotResolutionScope(matchCore, actorId, options.shotSequence ?? 0, options.seed ?? null, ruleVersion);
  const rng = createDecisionRng(scope);

  const shotError = calculateShotError({ distance: geo.distance, angleFactor: geo.angleFactor, pressure, finishing, technique, riskLevel, shotIntent, rng });
  const angle = rng.next() * Math.PI * 2;
  const push = C.RISK_DESTINATION_PUSH[riskLevel] ?? 0;
  const forward = goalX === 1 ? push : -push;
  const actualDestination = {
    x: clampPitch(intendedDestination.x + Math.cos(angle) * shotError + forward),
    y: clampPitch(intendedDestination.y + Math.sin(angle) * shotError),
  };

  const shotQuality = calculateShotQuality({ finishing, technique, distance: geo.distance, angleFactor: geo.angleFactor });

  // 5) Block exposure / 6) BLOCKED
  const block = calculateShotBlockExposure(matchCore, actorId, origin, actualDestination);
  const blockRisk = Math.min(C.BLOCK_MAX, clamp01(C.BLOCK_BASE_RISK * block.exposure));
  let outcome = null; let blockerId = null;
  if (block.exposure > 0 && rng.next() < blockRisk) {
    outcome = SHOT_OUTCOMES.BLOCKED; blockerId = block.blockerId;
  }

  // 7/8) on target / MISS
  const onTarget = outcome === null ? isOnTarget(actualDestination, goal.y) : null;
  if (outcome === null && !onTarget) outcome = SHOT_OUTCOMES.MISS;

  // 9/10) GK reaction → SAVE / GOAL
  const gk = players.find((p) => p.teamId !== actor.teamId && p.position === 'GK' && isUsable(p)) ?? null;
  const goalkeeping = gk ? abilityOf(gk, 'goalkeeping') : 0;
  const gkPosition = gk ? posOf(gk) : { x: goalX, y: C.GOAL_CENTER_Y };
  let saveExposure = 0; let saveProb = 0;
  if (outcome === null) {
    saveExposure = calculateSaveExposure({ goalkeeping, gkPosition, destination: actualDestination, shotQuality });
    saveProb = calculateSaveProb(saveExposure);
    const reaction = resolveGoalkeeperReaction(gk?.playerId ?? null, saveProb, rng);
    outcome = reaction === 'SAVE' ? SHOT_OUTCOMES.SAVE : SHOT_OUTCOMES.GOAL;
  }

  const duration = calculateShotTransitDuration(geo.distance);
  const startedAt = Number(matchCore?.clock?.simulationTime) || 0;
  const transit = {
    state: 'IN_TRANSIT', from: { ...origin }, to: { ...actualDestination },
    startedAt, duration, progress: 0, elapsed: 0,
    outcome, actorId, target: { ...target }, targetTeamId: actor.teamId,
    goalkeeperId: gk?.playerId ?? null, blockerId,
  };

  const result = {
    type: 'SHOT_RESOLUTION', ok: true,
    actorId,
    goalkeeperId: gk?.playerId ?? null,
    blockerId,
    intendedTarget: { ...target },
    intendedDestination: { ...intendedDestination },
    actualDestination: { ...actualDestination },
    outcome,
    onTarget: outcome === SHOT_OUTCOMES.MISS ? false : (outcome === SHOT_OUTCOMES.BLOCKED ? null : true),
    transit,
    riskProfile: { level: riskLevel },
    execution: {
      distance: geo.distance, angle: geo.angle, angleFactor: geo.angleFactor,
      pressure, finishing, technique, shotError, shotQuality,
      blockExposure: block.exposure, blockRisk, saveExposure, saveProb,
    },
    resolutionMeta: { ...meta, rngScope: scope, seed: options.seed ?? null },
    debug: null,
  };

  if (options.debug) {
    result.debug = {
      actorId, goalkeeperId: gk?.playerId ?? null, origin: { ...origin },
      intendedTarget: { ...target }, intendedDestination: { ...intendedDestination },
      actualDestination: { ...actualDestination }, distance: geo.distance, angle: geo.angle,
      pressure, riskIntent: riskLevel, shotIntent, finishing, technique, shotError,
      blockExposure: block.exposure, blockRisk, shotQuality,
      goalkeeperPosition: { ...gkPosition }, goalkeeping, saveExposure, saveProb,
      outcome, rngScope: scope, rejectionReason: null,
    };
  }
  return result;
}
