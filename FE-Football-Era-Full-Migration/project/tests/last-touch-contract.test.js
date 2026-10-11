/**
 * Step 39F-M-C-62 —— LastTouch Semantic Separation / Writer Correction 直接回归测试。
 *
 * 核心契约（Candidate A）：
 *   lastTouchPlayerId = 最近一次被系统正式确认实际触碰 Ball 的球员。
 *
 * 本文件直接测试各个边界函数，验证：
 *   - 只有实际 Touch 才改变 LastTouch；
 *   - 非触球 Interaction（PRESS SUCCESS / SECOND_BALL）不写 LastTouch；
 *   - PASS / SHOT Transit Start 不隐式 Clear；
 *   - Transit Completion 不重写；
 *   - GOAL / FREE / CONTROLLED 不自动 Clear；
 *   - Determinism。
 */

import { test, assert, assertEquals } from './harness.js';
import { stepBallPhysics } from '../src/core/match/ball-physics.js';
import { applyInteractionStateUpdate } from '../src/core/match/interaction-state-update.js';
import { applyPassStateUpdate } from '../src/core/match/pass-state-update.js';
import { applyShotStateUpdate } from '../src/core/match/shot-state-update.js';
import { finalizeTransitSettlement } from '../src/core/match/continuous-ball-movement-integration.js';
import { BALL_STATE } from '../src/core/match/ball-physics-config.js';

const player = (id, x, y) => ({ playerId: id, positionOnPitch: { x, y }, teamId: 't1' });

const mkBall = (overrides = {}) => ({
  position: { x: 0.5, y: 0.5 },
  velocity: { x: 0, y: 0 },
  state: BALL_STATE.FREE,
  control: null,
  possessingTeamId: null,
  lastTouchPlayerId: null,
  ...overrides,
});

const mkCore = (ballOverrides = {}) => ({
  matchId: 'm_lt',
  ball: mkBall(ballOverrides),
  players: [player('p_A', 0.5, 0.5), player('p_B', 0.6, 0.5)],
});

// ---- LT-01: C-03 actual contact updates LastTouch ----
test('LT-01 C-03 actual contact writes lastTouchPlayerId to contacting player', () => {
  const ball = mkBall({ state: BALL_STATE.FREE, lastTouchPlayerId: null });
  const p = player('p_A', 0.5, 0.5);
  const res = stepBallPhysics(ball, 0.1, { players: [p] });
  assertEquals(res.ball.lastTouchPlayerId, 'p_A', 'actual contact must set lastTouch to the contacting player');
});

// ---- LT-02: PASS Transit Start preserves LastTouch ----
test('LT-02 PASS transit start preserves lastTouchPlayerId (no implicit clear)', () => {
  const core = mkCore({ lastTouchPlayerId: 'p_A' });
  const result = {
    ok: true,
    transit: { from: { x: 0.5, y: 0.5 }, to: { x: 0.8, y: 0.5 }, duration: 1, outcome: 'COMPLETED', intendedTargetId: 'p_B', targetTeamId: 't1' },
  };
  const next = applyPassStateUpdate(core, result);
  assertEquals(next.ball.lastTouchPlayerId, 'p_A', 'PASS start must not clear lastTouch');
  assertEquals(next.ball.state, 'IN_TRANSIT', 'ball must enter IN_TRANSIT');
});

// ---- LT-03: SHOT Transit Start preserves LastTouch ----
test('LT-03 SHOT transit start preserves lastTouchPlayerId (no implicit clear)', () => {
  const core = mkCore({ lastTouchPlayerId: 'p_A' });
  const result = {
    ok: true,
    transit: { from: { x: 0.5, y: 0.5 }, to: { x: 0.9, y: 0.5 }, duration: 1, outcome: 'GOAL', target: { x: 0.9, y: 0.5 } },
  };
  const next = applyShotStateUpdate(core, result);
  assertEquals(next.ball.lastTouchPlayerId, 'p_A', 'SHOT start must not clear lastTouch');
  assertEquals(next.ball.state, 'IN_TRANSIT', 'ball must enter IN_TRANSIT');
});

// ---- LT-04: Transit Completion does not rewrite LastTouch ----
test('LT-04 transit completion preserves lastTouchPlayerId (no rewrite)', () => {
  const ball = mkBall({ state: BALL_STATE.IN_TRANSIT, lastTouchPlayerId: 'p_A', transit: { outcome: 'PASS_COMPLETED', intendedTargetId: 'p_B', targetTeamId: 't1' } });
  const settled = finalizeTransitSettlement(ball, ball.transit, [player('p_B', 0.8, 0.5)]);
  assertEquals(settled.lastTouchPlayerId, 'p_A', 'completion must not rewrite lastTouch to transit target');
  assertEquals(settled.state, BALL_STATE.CONTROLLED, 'state should be CONTROLLED');
});

// ---- LT-05: PRESS SUCCESS does not write pressing player to LastTouch ----
test('LT-05 PRESS SUCCESS does not write pressing player to lastTouchPlayerId', () => {
  const core = mkCore({ lastTouchPlayerId: 'p_A', state: BALL_STATE.CONTROLLED, control: 'p_C', possessingTeamId: 't1' });
  const result = {
    ok: true,
    actionType: 'PRESS',
    actorId: 'p_B',
    ball: { state: BALL_STATE.FREE },
    possession: null,
  };
  const next = applyInteractionStateUpdate(core, result);
  assertEquals(next.ball.lastTouchPlayerId, 'p_A', 'PRESS SUCCESS must not write pressing player as lastTouch');
  assertEquals(next.ball.state, BALL_STATE.FREE, 'state should be FREE');
});

// ---- LT-06: SECOND_BALL WON does not write winner to LastTouch ----
test('LT-06 SECOND_BALL WON does not write competition winner to lastTouchPlayerId', () => {
  const core = mkCore({ lastTouchPlayerId: 'p_A', state: BALL_STATE.FREE });
  const result = {
    ok: true,
    actionType: 'SECOND_BALL',
    actorId: 'p_B',
    ball: { state: BALL_STATE.CONTROLLED },
    possession: { toPlayerId: 'p_B', toTeamId: 't2' },
  };
  const next = applyInteractionStateUpdate(core, result);
  assertEquals(next.ball.lastTouchPlayerId, 'p_A', 'SECOND_BALL WON must not write winner as lastTouch');
  assertEquals(next.ball.control, 'p_B', 'control should be the winner');
  assert(next.ball.lastTouchPlayerId !== next.ball.control, 'lastTouch must differ from control owner');
});

// ---- LT-07: SECOND_BALL NO_WINNER does not clear LastTouch ----
test('LT-07 SECOND_BALL NO_WINNER does not clear lastTouchPlayerId', () => {
  const core = mkCore({ lastTouchPlayerId: 'p_A', state: BALL_STATE.FREE });
  const result = {
    ok: true,
    actionType: 'SECOND_BALL',
    actorId: null,
    ball: { state: BALL_STATE.FREE },
    possession: null,
  };
  const next = applyInteractionStateUpdate(core, result);
  assertEquals(next.ball.lastTouchPlayerId, 'p_A', 'SECOND_BALL NO_WINNER must not clear lastTouch');
});

// ---- LT-08: FREE state keeps LastTouch ----
test('LT-08 FREE state keeps lastTouchPlayerId', () => {
  const ball = mkBall({ state: BALL_STATE.FREE, lastTouchPlayerId: 'p_A' });
  const res = stepBallPhysics(ball, 0.1, { players: [] });
  assertEquals(res.ball.lastTouchPlayerId, 'p_A', 'FREE state must keep lastTouch without contact');
});

// ---- LT-09: CONTROLLED state keeps LastTouch (and differs from control) ----
test('LT-09 CONTROLLED state keeps lastTouchPlayerId and does not imply control', () => {
  const ball = mkBall({ state: BALL_STATE.CONTROLLED, control: 'p_C', lastTouchPlayerId: 'p_A' });
  const res = stepBallPhysics(ball, 0.1, { players: [] });
  assertEquals(res.ball.lastTouchPlayerId, 'p_A', 'CONTROLLED must keep lastTouch');
  assertEquals(res.ball.control, 'p_C', 'control is independent of lastTouch');
  assert(res.ball.lastTouchPlayerId !== res.ball.control, 'lastTouch != control (semantic separation)');
});

// ---- LT-10: GOAL state keeps LastTouch ----
test('LT-10 GOAL state keeps lastTouchPlayerId (no auto clear on goal)', () => {
  const ball = mkBall({ state: BALL_STATE.IN_TRANSIT, lastTouchPlayerId: 'p_A', transit: { outcome: 'GOAL' } });
  const settled = finalizeTransitSettlement(ball, ball.transit, []);
  assertEquals(settled.state, BALL_STATE.GOAL, 'state should be GOAL');
  assertEquals(settled.lastTouchPlayerId, 'p_A', 'GOAL must not clear lastTouch');
});

// ---- LT-11: New actual contact overrides previous LastTouch ----
test('LT-11 new actual contact by B overrides previous lastTouch A', () => {
  const ball = mkBall({ state: BALL_STATE.FREE, lastTouchPlayerId: 'p_A' });
  const pB = player('p_B', 0.5, 0.5);
  const res = stepBallPhysics(ball, 0.1, { players: [pB] });
  assertEquals(res.ball.lastTouchPlayerId, 'p_B', 'new actual contact must override lastTouch');
});

// ---- LT-12: Determinism — same input produces identical LastTouch ----
test('LT-12 determinism: repeated identical input yields identical lastTouchPlayerId', () => {
  const ball = mkBall({ state: BALL_STATE.FREE, lastTouchPlayerId: 'p_A' });
  const pB = player('p_B', 0.5, 0.5);
  const run1 = stepBallPhysics(ball, 0.1, { players: [pB] });
  const run2 = stepBallPhysics(ball, 0.1, { players: [pB] });
  assertEquals(run1.ball.lastTouchPlayerId, run2.ball.lastTouchPlayerId, 'deterministic lastTouch');
  // NON_TOUCH interaction determinism
  const core = mkCore({ lastTouchPlayerId: 'p_A', state: BALL_STATE.FREE });
  const result = { ok: true, actionType: 'SECOND_BALL', actorId: null, ball: { state: BALL_STATE.FREE }, possession: null };
  const n1 = applyInteractionStateUpdate(core, result);
  const n2 = applyInteractionStateUpdate(core, result);
  assertEquals(n1.ball.lastTouchPlayerId, n2.ball.lastTouchPlayerId, 'deterministic non-touch interaction');
});
