/**
 * Action Definitions —— 六个 MVP Action（Step 39F-M-B-IMPLEMENTATION-01）。
 * 层级归属：Simulation Core / Match Decision。纯函数，无副作用、无 RNG。
 *
 * 冻结：MVP Action Types = MOVE / PASS / DRIBBLE / SHOT / PRESS / TACKLE。
 * `CROSS/CLEAR` = PASS Intent；`RUN/SUPPORT/COVER/MARK/CREATE_SPACE` = MOVE Intent；
 * `INTERCEPT/BLOCK` = Resolution Result；`SAVE` = SHOT 的 GK Resolution；`HEADER` 暂缓。
 *
 * ActionDefinition = { type, targetSemantics, commitmentPolicy, availability,
 *                      generateCandidates, preference, resolutionHandler }。
 * ⚠ `resolutionHandler` 本阶段仅为**占位（null）**，不实现任何 Resolution。
 * ⚠ 偏好权重为 TBD-CAL，集中于 decision-config.js。
 */

import {
  CANDIDATE_LIMITS, DECISION_RANGES, GOAL, PREF_WEIGHTS,
  PASS_PROGRESSIVE_DX, PASS_BACK_DX, PASS_LONG_DISTANCE,
} from './decision-config.js';
import { clamp01, dist } from './player-situation.js';

/** Target 语义类型。 */
export const TARGET_SEMANTICS = Object.freeze({
  SPACE: 'SPACE', TEAMMATE: 'TEAMMATE', OPPONENT: 'OPPONENT', GOAL_AREA: 'GOAL_AREA',
});

/** 属性归一化（0..1）。 */
function attr(situation, key) {
  return clamp01((Number(situation?.ownState?.attributes?.[key]) || 0) / 99);
}

/** 球员基础可参与性（Hard）。 */
function canAct(situation) {
  const a = situation?.ownState?.availability;
  return !!a && a.onPitch && !a.injured && !a.sentOff;
}

function hasBall(situation) {
  return !!situation?.ownState?.hasBall;
}

/** 传球路线开阔度：线段附近对手越少越开阔。 */
function laneOpen(situation, from, to) {
  let n = 0;
  for (const o of situation.opponents) {
    if (!o.available) continue;
    if (segmentDistance(o.coordinates, from, to) <= DECISION_RANGES.LANE_WIDTH) n += 1;
  }
  return clamp01(1 - n / 3);
}

/** 点到线段距离（本地实现，避免额外依赖面）。 */
function segmentDistance(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** 传球意图（确定性）。 */
function passIntent(situation, target) {
  const self = situation.ownState.coordinates;
  const dx = target.coordinates.x - self.x;
  const d = dist(self, target.coordinates);
  if (dx >= PASS_PROGRESSIVE_DX) return d >= PASS_LONG_DISTANCE ? 'LONG' : 'PROGRESSIVE';
  if (dx <= -PASS_BACK_DX) return 'BACK';
  return d >= PASS_LONG_DISTANCE ? 'LONG' : 'SHORT';
}

/** 战术压迫强度 → 特征。 */
function pressingFeature(situation) {
  const p = situation?.tacticalState?.pressing;
  if (p === 'high') return 1;
  if (p === 'low') return 0.3;
  return 0.6;
}

// =====================================================================================
// 六个 Action Definition
// =====================================================================================

const MOVE = {
  type: 'MOVE',
  targetSemantics: TARGET_SEMANTICS.SPACE,
  commitmentPolicy: Object.freeze({ type: 'CONTINUOUS_INTERRUPTIBLE', duration: null }),
  resolutionHandler: null,
  availability: (s) => canAct(s),
  generateCandidates: (s) => {
    const self = s.ownState.coordinates;
    const ball = s.ballState.position;
    const out = [];
    out.push({ actionType: 'MOVE', intent: 'HOLD_POSITION', target: { type: 'SPACE', x: self.x, y: self.y } });
    out.push({
      actionType: 'MOVE', intent: 'SUPPORT',
      target: { type: 'SPACE', x: clamp01(self.x + 0.5 * (ball.x - self.x)), y: clamp01(self.y + 0.5 * (ball.y - self.y)) },
    });
    out.push({
      actionType: 'MOVE', intent: 'RUN_INTO_SPACE',
      target: { type: 'SPACE', x: clamp01(self.x + DECISION_RANGES.MOVE_DISTANCE), y: self.y },
    });
    return out.slice(0, CANDIDATE_LIMITS.MOVE);
  },
  preference: (s, c) => {
    const w = PREF_WEIGHTS.MOVE;
    const pace = attr(s, 'pace');
    const space = s.spatialContext.spaceAhead;
    const intentFeature = c.intent === 'RUN_INTO_SPACE' ? 1 : c.intent === 'SUPPORT' ? 0.8 : 0.4;
    return clamp01(w.PACE * pace + w.SPACE * space + w.INTENT * intentFeature);
  },
};

const PASS = {
  type: 'PASS',
  targetSemantics: TARGET_SEMANTICS.TEAMMATE,
  commitmentPolicy: Object.freeze({ type: 'COMMITTED', duration: null }),
  resolutionHandler: null,
  availability: (s) => canAct(s) && hasBall(s),
  generateCandidates: (s) => {
    const self = s.ownState.coordinates;
    return s.teammates
      .filter((t) => t.available && dist(self, t.coordinates) <= DECISION_RANGES.PASS_MAX_DISTANCE)
      .sort((a, b) => dist(self, a.coordinates) - dist(self, b.coordinates) || a.playerId.localeCompare(b.playerId))
      .slice(0, CANDIDATE_LIMITS.PASS)
      .map((t) => ({ actionType: 'PASS', intent: passIntent(s, t), target: { type: 'TEAMMATE', playerId: t.playerId } }));
  },
  preference: (s, c) => {
    const w = PREF_WEIGHTS.PASS;
    const self = s.ownState.coordinates;
    const target = s.teammates.find((t) => t.playerId === c.target.playerId);
    if (!target) return 0;
    const d = dist(self, target.coordinates);
    return clamp01(
      w.ABILITY * attr(s, 'passing')
      + w.PROXIMITY * clamp01(1 - d / DECISION_RANGES.PASS_MAX_DISTANCE)
      + w.LANE * laneOpen(s, self, target.coordinates)
      + w.AVAILABILITY * (target.available ? 1 : 0)
      + w.PRESSURE * (1 - s.spatialContext.pressure),
    );
  },
};

const DRIBBLE = {
  type: 'DRIBBLE',
  targetSemantics: TARGET_SEMANTICS.SPACE,
  commitmentPolicy: Object.freeze({ type: 'COMMITTED_STEERABLE', duration: null }),
  resolutionHandler: null,
  availability: (s) => canAct(s) && hasBall(s),
  generateCandidates: (s) => {
    const self = s.ownState.coordinates;
    const d = DECISION_RANGES.DRIBBLE_DISTANCE;
    return [
      { actionType: 'DRIBBLE', intent: 'FORWARD', target: { type: 'SPACE', x: clamp01(self.x + d), y: self.y } },
      { actionType: 'DRIBBLE', intent: 'LEFT', target: { type: 'SPACE', x: clamp01(self.x + d * 0.7), y: clamp01(self.y - 0.08) } },
      { actionType: 'DRIBBLE', intent: 'RIGHT', target: { type: 'SPACE', x: clamp01(self.x + d * 0.7), y: clamp01(self.y + 0.08) } },
    ].slice(0, CANDIDATE_LIMITS.DRIBBLE);
  },
  preference: (s, c) => {
    const w = PREF_WEIGHTS.DRIBBLE;
    return clamp01(
      w.TECHNIQUE * attr(s, 'technique')
      + w.PACE * attr(s, 'pace')
      + w.SPACE * s.spatialContext.spaceAhead
      + w.PRESSURE * (1 - s.spatialContext.pressure),
    );
  },
};

const SHOT = {
  type: 'SHOT',
  targetSemantics: TARGET_SEMANTICS.GOAL_AREA,
  commitmentPolicy: Object.freeze({ type: 'COMMITTED', duration: null }),
  resolutionHandler: null,
  availability: (s) => canAct(s) && hasBall(s),
  generateCandidates: (s) => {
    if (s.spatialContext.distanceToGoal > DECISION_RANGES.SHOT_MAX_DISTANCE) return [];
    return [
      { actionType: 'SHOT', intent: 'GOAL', target: { type: 'GOAL_AREA', zone: 'CENTER' } },
      { actionType: 'SHOT', intent: 'GOAL', target: { type: 'GOAL_AREA', zone: 'LEFT' } },
      { actionType: 'SHOT', intent: 'GOAL', target: { type: 'GOAL_AREA', zone: 'RIGHT' } },
    ].slice(0, CANDIDATE_LIMITS.SHOT);
  },
  preference: (s) => {
    const w = PREF_WEIGHTS.SHOT;
    const self = s.ownState.coordinates;
    const proximity = clamp01(1 - s.spatialContext.distanceToGoal / DECISION_RANGES.SHOT_MAX_DISTANCE);
    const angle = clamp01(1 - Math.abs(self.y - GOAL.y) / 0.5);
    return clamp01(
      w.FINISHING * attr(s, 'finishing')
      + w.PROXIMITY * proximity
      + w.ANGLE * angle
      + w.PRESSURE * (1 - s.spatialContext.pressure),
    );
  },
};

const PRESS = {
  type: 'PRESS',
  targetSemantics: TARGET_SEMANTICS.OPPONENT,
  commitmentPolicy: Object.freeze({ type: 'INTERRUPTIBLE_CONTINUOUS', duration: null }),
  resolutionHandler: null,
  availability: (s) => canAct(s) && !hasBall(s),
  generateCandidates: (s) => {
    const self = s.ownState.coordinates;
    return s.opponents
      .filter((o) => o.available && dist(self, o.coordinates) <= DECISION_RANGES.PRESS_RANGE)
      .sort((a, b) => dist(self, a.coordinates) - dist(self, b.coordinates) || a.playerId.localeCompare(b.playerId))
      .slice(0, CANDIDATE_LIMITS.PRESS)
      .map((o) => ({ actionType: 'PRESS', intent: 'CHASE', target: { type: 'OPPONENT', playerId: o.playerId } }));
  },
  preference: (s, c) => {
    const w = PREF_WEIGHTS.PRESS;
    const self = s.ownState.coordinates;
    const target = s.opponents.find((o) => o.playerId === c.target.playerId);
    if (!target) return 0;
    const closeness = clamp01(1 - dist(self, target.coordinates) / DECISION_RANGES.PRESS_RANGE);
    const phase = s.matchContext.phase === 'DEFENSE' ? 1 : 0.5;
    return clamp01(
      w.DEFENDING * attr(s, 'defending')
      + w.CLOSENESS * closeness
      + w.TEAM_PRESSING * pressingFeature(s)
      + w.PHASE * phase,
    );
  },
};

const TACKLE = {
  type: 'TACKLE',
  targetSemantics: TARGET_SEMANTICS.OPPONENT,
  commitmentPolicy: Object.freeze({ type: 'COMMITTED', duration: null }),
  resolutionHandler: null,
  availability: (s) => canAct(s) && !hasBall(s),
  generateCandidates: (s) => {
    const self = s.ownState.coordinates;
    const carrier = s.ballState.control;
    return s.opponents
      .filter((o) => o.available && dist(self, o.coordinates) <= DECISION_RANGES.TACKLE_RANGE)
      .sort((a, b) => {
        const ca = a.playerId === carrier ? 0 : 1, cb = b.playerId === carrier ? 0 : 1;
        return ca - cb || dist(self, a.coordinates) - dist(self, b.coordinates) || a.playerId.localeCompare(b.playerId);
      })
      .slice(0, CANDIDATE_LIMITS.TACKLE)
      .map((o) => ({ actionType: 'TACKLE', intent: 'CHALLENGE', target: { type: 'OPPONENT', playerId: o.playerId } }));
  },
  preference: (s, c) => {
    const w = PREF_WEIGHTS.TACKLE;
    const self = s.ownState.coordinates;
    const target = s.opponents.find((o) => o.playerId === c.target.playerId);
    if (!target) return 0;
    const closeness = clamp01(1 - dist(self, target.coordinates) / DECISION_RANGES.TACKLE_RANGE);
    const carrier = s.ballState.control === target.playerId ? 1 : 0.3;
    return clamp01(w.DEFENDING * attr(s, 'defending') + w.CLOSENESS * closeness + w.CARRIER * carrier);
  },
};

/** 六个 MVP Action Definition（冻结集合）。 */
export const ACTION_DEFINITIONS = Object.freeze({
  MOVE: Object.freeze(MOVE),
  PASS: Object.freeze(PASS),
  DRIBBLE: Object.freeze(DRIBBLE),
  SHOT: Object.freeze(SHOT),
  PRESS: Object.freeze(PRESS),
  TACKLE: Object.freeze(TACKLE),
});
