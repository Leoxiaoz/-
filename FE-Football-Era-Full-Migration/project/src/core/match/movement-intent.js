/**
 * Movement Intent（Step 39F-M-C）。
 * 层级归属：Simulation Core / Match Movement。**纯函数**，无副作用、无 RNG、无 MatchCore 写入。
 *
 * 语义红线（§7/§8）：
 * - **Movement Intent ≠ MOVE Action**。Movement Intent 是 22 人持续行为的独立层；
 *   MOVE Action 仍是 Decision 系统中的一个 Action。本模块不触碰 Action Registry / Decision Pipeline。
 * - Intent 来自 Tactical Context + Team Shape + Role/Position Context + Ball Context + Player Situation，
 *   不随机决定。
 * - 本层只影响「移动意图 / 移动倾向」，**不参与 PASS / SHOT Resolution 成功率**。
 */

import { dist } from './player-situation.js';
import {
  MOVEMENT_INTENT as MI, INTENT_URGENCY, TACTICAL_PHASE, POSSESSION_TENURE,
  BLOCK_HEIGHT, PRESS_RANGE, MARK_RANGE,
} from './movement-config.js';

const LINE_ORDER = ['GK', 'DF', 'MF', 'FW'];

/** 归一化位置组。 */
function groupOf(position) {
  return LINE_ORDER.includes(position) ? position : 'MF';
}

/** 最近的对手距离（无对手返回 Infinity）。 */
function nearestOpponentDistance(matchCore, player, oppTeamId) {
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];
  const px = Number(player?.positionOnPitch?.x), py = Number(player?.positionOnPitch?.y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return Infinity;
  let best = Infinity;
  for (const o of players) {
    if (o.teamId !== oppTeamId) continue;
    if (o.onPitch === false || o.injured || o.sentOff) continue;
    const ox = Number(o?.positionOnPitch?.x), oy = Number(o?.positionOnPitch?.y);
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
    const d = dist({ x: px, y: py }, { x: ox, y: oy });
    if (d < best) best = d;
  }
  return best;
}

function make(intent, reason) {
  return { intent, urgency: INTENT_URGENCY[intent] ?? 0.5, reason };
}

/** 有球方 Intent。 */
function inPossessionIntent({ group, distBall, context, tacticalState, y }) {
  const wide = Math.abs(y - 0.5) > 0.3;
  const { possessionStyle, transitionStyle, width } = tacticalState;
  if (group === 'GK') return make(MI.HOLD_POSITION, 'gk-hold');
  if (group === 'FW') {
    if (possessionStyle === 'direct' && transitionStyle === 'counter' && context.buildUpPhase !== 'FINAL_THIRD') {
      return make(MI.RUN_BEHIND, 'direct-counter-striker-depth');
    }
    if (context.buildUpPhase === 'FINAL_THIRD') return make(MI.ATTACK_SPACE, 'final-third-attack-space');
    return make(MI.RUN_FORWARD, 'fw-forward');
  }
  if (group === 'MF') {
    if (wide && width === 'wide') return make(MI.WIDEN, 'mf-wide-by-width');
    if (context.buildUpPhase === 'BUILD_UP') return make(MI.OFFER, 'mf-offer-build-up');
    if (distBall <= PRESS_RANGE) return make(MI.SUPPORT, 'mf-support-near-ball');
    return make(MI.SUPPORT, 'mf-sustain-structure');
  }
  // DF
  if (context.buildUpPhase === 'BUILD_UP') return make(MI.SUPPORT, 'df-build-up-support');
  if (wide && width === 'wide') return make(MI.WIDEN, 'df-wide-by-width');
  return make(MI.HOLD_POSITION, 'df-hold');
}

/** 无球方 Intent。 */
function outOfPossessionIntent({ group, distBall, nearestOpp, context, tacticalState }) {
  const press = tacticalState.pressingIntensity === 'high' || tacticalState.transitionStyle === 'press';
  const low = context.blockHeight === BLOCK_HEIGHT.LOW_BLOCK;
  const high = context.blockHeight === BLOCK_HEIGHT.HIGH_BLOCK;
  if (group === 'GK') return make(MI.HOLD_POSITION, 'gk-hold');
  if (press && distBall <= PRESS_RANGE) {
    return make(distBall <= PRESS_RANGE * 0.5 ? MI.CHASE : MI.PRESS_MOVE, 'press-engage');
  }
  if (group === 'FW') {
    if (low) return make(MI.DROP, 'fw-drop-low-block');
    if (high) return make(MI.PRESS_MOVE, 'fw-press-high-block');
    return nearestOpp <= MARK_RANGE ? make(MI.MARK, 'fw-mark') : make(MI.COVER, 'fw-cover');
  }
  if (group === 'MF') {
    if (low) return make(MI.RECOVER_SHAPE, 'mf-recover-low-block');
    if (high) return make(MI.STEP_UP, 'mf-step-up-high-block');
    return nearestOpp <= MARK_RANGE ? make(MI.MARK, 'mf-mark') : make(MI.COVER, 'mf-cover');
  }
  // DF
  if (high) return make(MI.STEP_UP, 'df-step-up-high-line');
  if (low) return make(MI.RECOVER_SHAPE, 'df-recover-low-block');
  return nearestOpp <= MARK_RANGE ? make(MI.MARK, 'df-mark') : make(MI.COVER, 'df-cover');
}

/** 转换 Intent。 */
function transitionIntent({ group, distBall, nearestOpp, context, tacticalState }) {
  const counter = tacticalState.transitionStyle === 'counter';
  const press = tacticalState.pressingIntensity === 'high' || tacticalState.transitionStyle === 'press';
  if (group === 'GK') return make(MI.HOLD_POSITION, 'gk-hold');
  if (context.possessionTenure === POSSESSION_TENURE.JUST_WON) {
    if (group === 'FW') return make(counter ? MI.RUN_BEHIND : MI.RUN_FORWARD, 'just-won-fw-forward');
    if (group === 'MF') return make(press ? MI.PRESS_MOVE : MI.SUPPORT, 'just-won-mf');
    return make(MI.SUPPORT, 'just-won-df-support');
  }
  // JUST_LOST / NONE
  if (group === 'FW' && press && distBall <= PRESS_RANGE) return make(MI.PRESS_MOVE, 'just-lost-fw-counterpress');
  if (group === 'DF') return make(MI.RECOVER_SHAPE, 'just-lost-df-recover');
  if (group === 'MF') {
    if (press && distBall <= PRESS_RANGE) return make(MI.PRESS_MOVE, 'just-lost-mf-counterpress');
    return nearestOpp <= MARK_RANGE ? make(MI.MARK, 'just-lost-mf-mark') : make(MI.RECOVER_SHAPE, 'just-lost-mf-recover');
  }
  return make(MI.RECOVER_SHAPE, 'fw-recover');
}

/**
 * 选择某球员的 Movement Intent。
 * @param {{matchCore:object, player:object, context:object, tacticalState:object}} args
 * @returns {{intent:string, urgency:number, reason:string, isCarrier:boolean}}
 */
export function selectMovementIntent({ matchCore, player, context, tacticalState }) {
  const isCarrier = matchCore?.ball?.control === player?.playerId;
  if (isCarrier) return { ...make(MI.HOLD_POSITION, 'ball-carrier-hold'), isCarrier: true };

  const group = groupOf(player?.position);
  const y = Number.isFinite(Number(player?.positionOnPitch?.y)) ? Number(player.positionOnPitch.y) : 0.5;
  const px = Number(player?.positionOnPitch?.x), py = Number(player?.positionOnPitch?.y);
  const bx = Number(matchCore?.ball?.position?.x), by = Number(matchCore?.ball?.position?.y);
  const distBall = (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(bx) && Number.isFinite(by))
    ? dist({ x: px, y: py }, { x: bx, y: by }) : Infinity;
  const nearestOpp = nearestOpponentDistance(matchCore, player, context.opponentTeamId);

  let result;
  if (context.phase === TACTICAL_PHASE.IN_POSSESSION) {
    result = inPossessionIntent({ group, distBall, context, tacticalState, y });
  } else if (context.phase === TACTICAL_PHASE.OUT_OF_POSSESSION) {
    result = outOfPossessionIntent({ group, distBall, nearestOpp, context, tacticalState });
  } else {
    result = transitionIntent({ group, distBall, nearestOpp, context, tacticalState });
  }
  return { ...result, isCarrier: false };
}