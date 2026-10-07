/**
 * Step 39F-M-C-55 —— Terminal Velocity Normalization 测试（TV-01 .. TV-14）。
 *
 * 覆盖：CONTROLLED / GOAL → velocity {0,0}；FREE / IN_TRANSIT preserve；Transit Completion（CONTROLLED/FREE/GOAL）；
 *       Contact Reflection 后的残留归零；Interaction（INTERCEPTION_SUCCESS / DRIBBLE_COMPLETED / SECOND_BALL_WON）；
 *       closingSpeed 行为不变；单一 Terminal Writer（无重复实现）；Determinism。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  normalizeTerminalBallVelocity, isTerminalVelocityState,
  TERMINAL_VELOCITY_STATES, TERMINAL_ZERO_VELOCITY,
  TERMINAL_VELOCITY_NORMALIZATION_SOURCE, TERMINAL_VELOCITY_RULE_VERSION,
} from '../src/core/match/terminal-ball-velocity.js';
import { advanceContinuousBallMovement, finalizeTransitSettlement } from '../src/core/match/continuous-ball-movement-integration.js';
import { BALL_STATE } from '../src/core/match/ball-physics-config.js';
import { runMatchTick } from '../src/core/match/match-tick.js';
import { resolveInteraction } from '../src/core/match/interaction-resolution.js';
import { deriveSecondBallCandidates } from '../src/core/match/second-ball-resolution.js';
import { INTERACTION_BALL_STATE as BS } from '../src/core/match/interaction-resolution-config.js';
import { PASS_OUTCOMES } from '../src/core/match/pass-resolution-config.js';
import { SHOT_OUTCOMES } from '../src/core/match/shot-resolution-config.js';

const H = 'H'; const A = 'A';
const HERE = dirname(fileURLToPath(import.meta.url));
const strip = (p) => readFileSync(join(HERE, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const ZERO = { x: 0, y: 0 };

// ── MatchCore / Player 构造 ──
const ATTRS = (o = {}) => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...o });
const mk = (id, t, x, y) => ({ playerId: id, teamId: t, position: 'MF', positionOnPitch: { x, y }, onPitch: true, injured: false, sentOff: false, attributes: ATTRS(), fitness: 100, form: 50, morale: 50, matchLoad: 0 });
const tac = () => ({ formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' });

function core({ from = { x: 0.2, y: 0.5 }, to = { x: 0.8, y: 0.5 }, duration = 4, outcome = PASS_OUTCOMES.COMPLETED, vel, ballState = BS.IN_TRANSIT, control = null, poss = null, players } = {}) {
  const ball = { position: { ...from }, velocity: vel, control, possessingTeamId: poss, state: ballState, contacting: [], lastTouchPlayerId: control ?? null };
  if (duration != null) ball.transit = { from: { ...from }, to: { ...to }, duration, elapsed: 0, outcome, actorId: 'h_a', targetTeamId: H, intendedTargetId: 'h_t' };
  return {
    worldId: 'w_tv', season: 1, matchId: 'm_tv', ruleVersion: 'v', teams: { home: H, away: A },
    clock: { simulationTime: 0, matchDuration: 90, half: 1, status: 'in_play' }, score: { home: 0, away: 0 },
    tactical: { [H]: tac(), [A]: tac() }, ball,
    players: players ?? [mk('p1', H, 0.235, 0.5), mk('h_a', H, 0.30, 0.5), mk('a_d', A, 0.55, 0.5), mk('h_t', H, 0.80, 0.5), mk('gk', A, 0.90, 0.5)],
  };
}
const V = (b) => b.velocity;
const eqv = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ===========================================================================
// TV-01 .. TV-05：Boundary 单元语义
// ===========================================================================

test('TV-01. CONTROLLED normalization：velocity → {0,0}', () => {
  const b = { state: BALL_STATE.CONTROLLED, position: { x: 0.3, y: 0.4 }, control: 'h_a', velocity: { x: 0.5, y: -0.2 } };
  assertEquals(normalizeTerminalBallVelocity(b).velocity, ZERO);
  assert(isTerminalVelocityState(BALL_STATE.CONTROLLED), 'CONTROLLED 属终态域');
});

test('TV-02. GOAL normalization：velocity → {0,0}', () => {
  const b = { state: BALL_STATE.GOAL, position: { x: 1, y: 0.5 }, velocity: { x: 0.9, y: 0.3 } };
  assertEquals(normalizeTerminalBallVelocity(b).velocity, ZERO);
  assert(isTerminalVelocityState(BALL_STATE.GOAL), 'GOAL 属终态域');
});

test('TV-03. FREE non-zero preservation：{0.3,0} 保持', () => {
  const b = { state: BALL_STATE.FREE, position: { x: 0.5, y: 0.5 }, velocity: { x: 0.3, y: 0 } };
  assertEquals(normalizeTerminalBallVelocity(b).velocity, { x: 0.3, y: 0 });
  const b2 = { ...b, velocity: { x: -0.2, y: 0.1 } };
  assertEquals(normalizeTerminalBallVelocity(b2).velocity, { x: -0.2, y: 0.1 });
});

test('TV-04. FREE zero preservation：{0,0} 保持且引用稳定', () => {
  const b = { state: BALL_STATE.FREE, position: { x: 0.5, y: 0.5 }, velocity: { x: 0, y: 0 } };
  assert(normalizeTerminalBallVelocity(b) === b, 'FREE 不变更时应原样返回');
});

test('TV-05. IN_TRANSIT preservation：非零 velocity 不受影响', () => {
  const b = { state: BALL_STATE.IN_TRANSIT, position: { x: 0.5, y: 0.5 }, velocity: { x: 0.4, y: 0.1 }, transit: { from: { x: 0.5, y: 0.5 }, to: { x: 0.8, y: 0.5 }, duration: 1, elapsed: 0 } };
  assertEquals(normalizeTerminalBallVelocity(b).velocity, { x: 0.4, y: 0.1 });
  assert(normalizeTerminalBallVelocity(b) === b, 'IN_TRANSIT 不变更时应原样返回');
});

// ===========================================================================
// TV-06 .. TV-09：Transit / Contact / GOAL 完成边界
// ===========================================================================

test('TV-06. Transit → CONTROLLED：velocity {0,0}，position=transit.to，transit 清除', () => {
  let mc = core({ duration: 1, vel: { x: 0.5, y: 0 } });
  const r = advanceContinuousBallMovement(mc, 1);
  mc = r.matchCore;
  assertEquals(mc.ball.state, 'CONTROLLED');
  assertEquals(V(mc.ball), ZERO);
  assertEquals(mc.ball.position, { x: 0.8, y: 0.5 });
  assertEquals(mc.ball.transit, undefined);
});

test('TV-07. Transit → FREE：保留最后 Physics Velocity（不被清零）', () => {
  let mc = core({ duration: 1, outcome: PASS_OUTCOMES.INACCURATE, vel: { x: 0.5, y: 0 } });
  const mid = advanceContinuousBallMovement(mc, 0.4); mc = mid.matchCore;
  const midVel = JSON.parse(JSON.stringify(V(mc.ball)));
  assert(!(midVel.x === 0 && midVel.y === 0), '中间 Tick 应产生非零 Physics Velocity');
  const done = advanceContinuousBallMovement(mc, 0.6); mc = done.matchCore;
  assertEquals(mc.ball.state, 'FREE');
  assertEquals(V(mc.ball), midVel, 'Completion 不得清零 FREE velocity');
});

test('TV-08. Contact Reflection → Transit Completion → CONTROLLED：残留 velocity 归零', () => {
  // duration 短、球速大 → 小 dt 内发生 Contact 反射
  let mc = core({ from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, duration: 0.1, vel: { x: 0.6, y: 0 } });
  const mid = advanceContinuousBallMovement(mc, 0.05, { players: mc.players }); mc = mid.matchCore;
  const midVel = JSON.parse(JSON.stringify(V(mc.ball)));
  assert(!(midVel.x === 0 && midVel.y === 0), 'Contact Tick 应保留反射后的非零 velocity');
  const done = advanceContinuousBallMovement(mc, 1, { players: mc.players }); mc = done.matchCore;
  assertEquals(mc.ball.state, 'CONTROLLED');
  assertEquals(V(mc.ball), ZERO, 'CONTROLLED 终态必须归零');
});

test('TV-09. Transit → GOAL：velocity {0,0}', () => {
  let mc = core({ from: { x: 0.5, y: 0.5 }, to: { x: 1, y: 0.5 }, duration: 1, outcome: SHOT_OUTCOMES.GOAL, vel: { x: 0.8, y: 0 } });
  const r = advanceContinuousBallMovement(mc, 1); mc = r.matchCore;
  assertEquals(mc.ball.state, 'GOAL');
  assertEquals(V(mc.ball), ZERO);
});

// ===========================================================================
// TV-10 .. TV-12：Interaction 路径
// ===========================================================================

function findSeed(setup, action, wantOutcome, n = 800) {
  for (let i = 0; i < n; i += 1) {
    const s = `s${i}`;
    if (resolveInteraction(action, setup, { seed: s, sequence: 0 })?.outcome === wantOutcome) return s;
  }
  return null;
}

test('TV-10. INTERCEPTION_SUCCESS → CONTROLLED：velocity {0,0}', () => {
  const setup = core({ duration: 8 });
  const seed = findSeed(setup, { actionType: 'INTERCEPTION', actorId: 'a_d', target: { type: 'BALL' } }, 'INTERCEPTION_SUCCESS');
  assert(seed !== null, '应存在 INTERCEPTION_SUCCESS seed');
  const t = runMatchTick(setup, { tickIndex: 1, deltaTime: 1, actionInstance: { actionType: 'INTERCEPTION', actorId: 'a_d', target: { type: 'BALL' } }, seed, interactionSequence: 0 });
  assertEquals(t.matchCore.ball.state, 'CONTROLLED');
  assertEquals(V(t.matchCore.ball), ZERO);
});

test('TV-11. DRIBBLE_COMPLETED → CONTROLLED：velocity {0,0}', () => {
  const act = { actionType: 'DRIBBLE', actorId: 'h_a', target: { type: 'SPACE', x: 0.35, y: 0.5 } };
  const setup = core({ duration: null, ballState: BS.CONTROLLED, control: 'h_a', poss: H, from: { x: 0.30, y: 0.5 }, vel: { x: 0.3, y: 0 } });
  const seed = findSeed(setup, act, 'DRIBBLE_COMPLETED');
  assert(seed !== null, '应存在 DRIBBLE_COMPLETED seed');
  const t = runMatchTick(setup, { tickIndex: 1, deltaTime: 1, actionInstance: act, seed, interactionSequence: 0 });
  assertEquals(t.matchCore.ball.state, 'CONTROLLED');
  assertEquals(V(t.matchCore.ball), ZERO);
});

test('TV-12. SECOND_BALL_WON → CONTROLLED：velocity {0,0}', () => {
  const setup = core({ duration: 8 });
  const seed = findSeed(setup, { actionType: 'INTERCEPTION', actorId: 'a_d', target: { type: 'BALL' } }, 'INTERCEPTION_DEFLECTED');
  assert(seed !== null, '应存在 INTERCEPTION_DEFLECTED seed');
  const t = runMatchTick(setup, { tickIndex: 1, deltaTime: 1, actionInstance: { actionType: 'INTERCEPTION', actorId: 'a_d', target: { type: 'BALL' } }, seed, interactionSequence: 0 });
  assertEquals(t.secondBallResult?.outcome, 'SECOND_BALL_WON');
  assertEquals(t.matchCore.ball.state, 'CONTROLLED');
  assertEquals(V(t.matchCore.ball), ZERO);
});

// ===========================================================================
// TV-13：closingSpeed 行为不变
// ===========================================================================

test('TV-13. FREE → closingSpeed：非零 velocity 参与且行为不变', () => {
  const freeCore = (v) => core({ duration: null, ballState: BS.FREE, control: null, poss: null, vel: v, from: { x: 0.5, y: 0.5 } });
  const cands = (v) => deriveSecondBallCandidates(freeCore(v)).candidates;
  const c1 = cands({ x: 0.3, y: 0 });
  const c0 = cands({ x: 0, y: 0 });
  assert(c1.length > 0, '应有 SECOND_BALL candidates');
  assert(c1.some((c, i) => c.closingSpeed !== c0[i].closingSpeed), 'FREE velocity 必须影响 closingSpeed（行为契约锁定）');
  assertEquals(c1.map((c) => c.playerId), c0.map((c) => c.playerId), '候选集合与资格不变');
});

// ===========================================================================
// TV-14：单一 Terminal Writer / FREE 保护 / Determinism
// ===========================================================================

test('TV-14. Writer ownership：唯一 Terminal Writer，无重复清零实现', () => {
  const SRC_TERM = strip('../src/core/match/terminal-ball-velocity.js');
  const SRC_CONT = strip('../src/core/match/continuous-ball-movement-integration.js');
  const SRC_ISTATE = strip('../src/core/match/interaction-state-update.js');
  // 唯一实现：归零逻辑只存在于 terminal-ball-velocity.js
  assert(/export function normalizeTerminalBallVelocity/.test(SRC_TERM), 'Boundary 必须导出唯一 normalize 函数');
  // 两个官方 State Transition 边界均消费同一 Boundary，而非各自实现
  assert(/from '\.\/terminal-ball-velocity\.js'/.test(SRC_CONT), 'Transit Completion 必须复用 Terminal Boundary');
  assert(/from '\.\/terminal-ball-velocity\.js'/.test(SRC_ISTATE), 'Interaction State Mutation 必须复用 Terminal Boundary');
  // finalize 不再自行拼 velocity（GOAL/CONTROLLED 分支无 velocity 字面量）
  assert(!/state:\s*BALL_STATE\.GOAL,[^}]*velocity/.test(SRC_CONT), 'finalize 不得自行写 GOAL velocity');
  // 元数据正确
  assertEquals(TERMINAL_VELOCITY_NORMALIZATION_SOURCE, 'TERMINAL_VELOCITY_NORMALIZATION');
  assertEquals(TERMINAL_VELOCITY_RULE_VERSION, 'terminal-velocity-normalization-v1');
  assertEquals(TERMINAL_VELOCITY_STATES, ['CONTROLLED', 'GOAL']);
  assertEquals(TERMINAL_ZERO_VELOCITY, ZERO);
  // FREE 明确不在终态域
  assert(!isTerminalVelocityState(BALL_STATE.FREE), 'FREE 不属终态域');
  assert(!isTerminalVelocityState(BALL_STATE.IN_TRANSIT), 'IN_TRANSIT 不属终态域');
});

test('TV-14b. Determinism：Boundary / Completion 重复运行 identical', () => {
  const n = () => JSON.stringify(normalizeTerminalBallVelocity({ state: BALL_STATE.CONTROLLED, velocity: { x: 0.5, y: 0.1 } }));
  assert(n() === n(), 'CONTROLLED normalization 必须确定');
  const g = () => JSON.stringify(normalizeTerminalBallVelocity({ state: BALL_STATE.GOAL, velocity: { x: 0.9, y: 0 } }));
  assert(g() === g(), 'GOAL normalization 必须确定');
  const f = () => JSON.stringify(normalizeTerminalBallVelocity({ state: BALL_STATE.FREE, velocity: { x: 0.3, y: 0 } }));
  assert(f() === f(), 'FREE preservation 必须确定');
  const complete = () => { const r = advanceContinuousBallMovement(core({ duration: 1, vel: { x: 0.5, y: 0 } }), 1); return JSON.stringify(r.matchCore.ball); };
  assert(complete() === complete(), 'Completion 结果必须确定');
});