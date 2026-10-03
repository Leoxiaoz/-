/**
 * Tactical Context 派生层（Step 39F-M-C）。
 * 层级归属：Simulation Core / Match Tactical。**只读、纯函数**，无副作用、无 RNG、无 MatchCore 写入。
 *
 * 职责：由 `MatchCore + Tactical State` 派生 **read-only / transient** 的 Tactical Context。
 * 语义红线（§5）：
 * - 不修改 MatchCore；不复制 MatchCore 已有事实；不把 derived data 写回 PlayerMatchState。
 * - 不保存可由当前状态重算的数据（唯一例外：possession since-time 属不可重算的 transient，
 *   存放于 `matchCore.movement.possession`，**非** PlayerMatchState）。
 */

import { clamp01, dist } from './player-situation.js';
import { getTacticalState } from './tactical-state.js';
import {
  TACTICAL_PHASE, POSSESSION_TENURE, BALL_ZONE, BALL_CHANNEL, BLOCK_HEIGHT, BUILD_UP_PHASE,
  ZONE_BOUNDS, TRANSITION, SHAPE,
} from './movement-config.js';

/** 己方进攻方向：home 攻击 +x，away 攻击 -x。 */
export function attackDirection(matchCore, teamId) {
  return teamId === matchCore?.teams?.home ? 1 : -1;
}

/** 对手 teamId。 */
export function opponentTeamId(matchCore, teamId) {
  const h = matchCore?.teams?.home, a = matchCore?.teams?.away;
  return teamId === h ? a : h;
}

/** 己方视角纵向进度：0 = 己方球门，1 = 对方球门。 */
export function ownProgress(matchCore, teamId, x) {
  const xa = Number(x);
  if (!Number.isFinite(xa)) return 0.5;
  const dir = attackDirection(matchCore, teamId);
  return clamp01(dir === 1 ? xa : 1 - xa);
}

/** 由己方视角进度派生 Ball Zone。 */
export function ballZoneOf(progress) {
  if (progress < ZONE_BOUNDS.THIRD_1) return BALL_ZONE.DEFENSIVE_THIRD;
  if (progress < ZONE_BOUNDS.THIRD_2) return BALL_ZONE.MIDDLE_THIRD;
  return BALL_ZONE.FINAL_THIRD;
}

/** 由归一化 y 派生 Ball Channel。 */
export function ballChannelOf(y) {
  const yy = Number.isFinite(Number(y)) ? Number(y) : 0.5;
  const [a, b, c, d] = ZONE_BOUNDS.CHANNEL;
  if (yy < a) return BALL_CHANNEL.LEFT;
  if (yy < b) return BALL_CHANNEL.LEFT_HALF_SPACE;
  if (yy < c) return BALL_CHANNEL.CENTRAL;
  if (yy < d) return BALL_CHANNEL.RIGHT_HALF_SPACE;
  return BALL_CHANNEL.RIGHT;
}

/** defensiveLine → 高度分值（-1 / 0 / +1）。 */
function lineScore(defensiveLine) {
  if (defensiveLine === 'deep') return -1;
  if (defensiveLine === 'high') return 1;
  return 0;
}

/**
 * Block Height 派生：defensiveLine 为主，叠加球所在区域（对手压得深 → 低位）。
 * 仅为 **derived 类别**，不写 MatchCore。
 */
export function deriveBlockHeight({ defensiveLine, phase, ballZone }) {
  let score = lineScore(defensiveLine);
  // 无球方：球越靠近己方球门 → 越低；越靠近对方球门 → 越高。
  if (phase === TACTICAL_PHASE.OUT_OF_POSSESSION || phase === TACTICAL_PHASE.TRANSITION) {
    if (ballZone === BALL_ZONE.DEFENSIVE_THIRD) score -= 1;
    else if (ballZone === BALL_ZONE.FINAL_THIRD) score += 1;
  }
  if (score <= -1) return BLOCK_HEIGHT.LOW_BLOCK;
  if (score >= 1) return BLOCK_HEIGHT.HIGH_BLOCK;
  return BLOCK_HEIGHT.MID_BLOCK;
}

/** 由己方视角进度派生 Build-up Phase。 */
function buildUpOf(progress) {
  if (progress < ZONE_BOUNDS.THIRD_1) return BUILD_UP_PHASE.BUILD_UP;
  if (progress < ZONE_BOUNDS.THIRD_2) return BUILD_UP_PHASE.PROGRESSION;
  return BUILD_UP_PHASE.FINAL_THIRD;
}

/** Shape Validity：球队实际位置与 anchors 的平均偏离（1 = 完全贴合）。 */
function shapeValidityFor(matchCore, teamId, shapeAnchors) {
  if (!shapeAnchors || typeof shapeAnchors !== 'object') return null;
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];
  let n = 0; let sum = 0;
  for (const p of players) {
    if (p.teamId !== teamId) continue;
    if (p.onPitch === false || p.injured || p.sentOff) continue;
    const a = shapeAnchors[p.playerId];
    if (!a) continue;
    const x = Number(p?.positionOnPitch?.x), y = Number(p?.positionOnPitch?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sum += dist({ x, y }, a);
    n += 1;
  }
  if (n === 0) return null;
  return Math.round((1 - clamp01((sum / n) / SHAPE.VALIDITY_REF)) * 1000) / 1000;
}

/** 派生 phase + possession tenure（§4）。 */
function derivePhaseAndTenure(matchCore, teamId, oppTeamId) {
  const clockTime = Number(matchCore?.clock?.simulationTime) || 0;
  const possessingTeamId = matchCore?.ball?.possessingTeamId ?? null;
  const tracking = matchCore?.movement?.possession ?? null;
  const inFlight = TRANSITION.INCLUDE_BALL_TRANSIT && !!matchCore?.ball?.transit;

  if (possessingTeamId == null || inFlight) {
    // 松球 / 球在飞行：过渡态；tenure 依 tracking 判断归属。
    let tenure = POSSESSION_TENURE.NONE;
    if (tracking && Number.isFinite(Number(tracking.sinceTime)) && clockTime - Number(tracking.sinceTime) <= TRANSITION.WINDOW) {
      tenure = tracking.teamId === teamId ? POSSESSION_TENURE.JUST_WON : POSSESSION_TENURE.JUST_LOST;
    }
    return { phase: TACTICAL_PHASE.TRANSITION, tenure };
  }

  const justChanged = tracking
    && tracking.teamId === possessingTeamId
    && Number.isFinite(Number(tracking.sinceTime))
    && (clockTime - Number(tracking.sinceTime)) <= TRANSITION.WINDOW;

  if (justChanged) {
    return {
      phase: TACTICAL_PHASE.TRANSITION,
      tenure: possessingTeamId === teamId ? POSSESSION_TENURE.JUST_WON : POSSESSION_TENURE.JUST_LOST,
    };
  }
  if (possessingTeamId === teamId) {
    return { phase: TACTICAL_PHASE.IN_POSSESSION, tenure: POSSESSION_TENURE.SETTLED };
  }
  return { phase: TACTICAL_PHASE.OUT_OF_POSSESSION, tenure: POSSESSION_TENURE.SETTLED };
}

/**
 * 构造某队的只读 Tactical Context。
 * @param {object} matchCore
 * @param {string} teamId
 * @param {{shapeAnchors?:object}} [options]
 * @returns {object}
 */
export function buildTacticalContext(matchCore, teamId, options = {}) {
  const opp = opponentTeamId(matchCore, teamId);
  const tacticalState = getTacticalState(matchCore, teamId);
  const ballX = Number(matchCore?.ball?.position?.x);
  const ballY = Number(matchCore?.ball?.position?.y);
  const progress = ownProgress(matchCore, teamId, Number.isFinite(ballX) ? ballX : 0.5);
  const zone = ballZoneOf(progress);
  const { phase, tenure } = derivePhaseAndTenure(matchCore, teamId, opp);

  return {
    teamId,
    opponentTeamId: opp,
    phase,
    possessionTenure: tenure,
    ballZone: zone,
    ballChannel: ballChannelOf(ballY),
    blockHeight: deriveBlockHeight({ defensiveLine: tacticalState.defensiveLine, phase, ballZone: zone }),
    buildUpPhase: buildUpOf(progress),
    shapeValidity: shapeValidityFor(matchCore, teamId, options.shapeAnchors),
    ballOwnProgress: Math.round(progress * 1000) / 1000,
    simulationTime: Number(matchCore?.clock?.simulationTime) || 0,
    tacticalState,
  };
}