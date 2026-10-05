/**
 * Step 39F-M-C-25 —— Interaction Resolution → Ball Transit Boundary 测试。
 *
 * 核心结论（本 Gate 审计）：当前 Interaction Resolution 结果**不携带 duration**（也不携带 from），
 * 因此对 DRIBBLE / TACKLE / PRESS / INTERCEPTION 的真实结果，C-25 只能如实返回
 * `INTERACTION_MOVEMENT_DURATION_SCHEMA_GAP`（Capability BLOCKED）—— 不伪造、不默认、不按动作类型推算。
 *
 * 另含：边界 / 无球运动 / C-24 兼容（未来 Schema 携带 duration 时）/ 不变量 / Source Guard。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  deriveInteractionBallTransit,
  INTERACTION_BALL_TRANSIT_SOURCE, INTERACTION_BALL_TRANSIT_RULE_VERSION, INTERACTION_BALL_TRANSIT_REASON,
} from '../src/core/match/interaction-ball-transit.js';
import { resolveInteraction } from '../src/core/match/interaction-resolution.js';
import { deriveBallMovementStateFromAction } from '../src/core/match/action-ball-movement-state.js';
import { applyBallMovementPositionUpdate } from '../src/core/match/ball-movement-integration.js';

const R = INTERACTION_BALL_TRANSIT_REASON;
const H = 'clb_h'; const A = 'clb_a';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '../src/core/match/interaction-ball-transit.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const mk = (id, t, x, y) => ({
  playerId: id, teamId: t, position: 'MF', positionOnPitch: { x, y }, onPitch: true, injured: false, sentOff: false,
  attributes: { pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70 },
  fitness: 100, form: 50, morale: 50, matchLoad: 0,
});
function coreOf(players, control, poss, transit = undefined) {
  const carrier = players.find((p) => p.playerId === control);
  return {
    teams: { home: H, away: A }, clock: { simulationTime: 5 }, score: { home: 0, away: 0 },
    ball: { position: { ...(carrier?.positionOnPitch ?? { x: 0.5, y: 0.5 }) }, control, possessingTeamId: poss, transit },
    players,
  };
}

// ===========================================================================
// 真实 Schema：四类 Interaction → duration Schema Gap（Capability BLOCKED）
// ===========================================================================

test('C25-DRIBBLE. 真实 DRIBBLE → 缺 duration → INTERACTION_MOVEMENT_DURATION_SCHEMA_GAP', () => {
  const mc = coreOf([mk('h_a', H, 0.40, 0.50)], 'h_a', H);
  const res = resolveInteraction({ actionType: 'DRIBBLE', actorId: 'h_a', target: { type: 'SPACE', x: 0.60, y: 0.50 } }, mc, { seed: 'd0' });
  assertEquals(res.ok, true);
  const r = deriveInteractionBallTransit(res, { matchCore: mc });
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.INTERACTION_MOVEMENT_DURATION_SCHEMA_GAP);
});

test('C25-TACKLE. 真实 TACKLE → 缺 duration → Schema Gap', () => {
  const mc = coreOf([mk('h_a', H, 0.50, 0.50), mk('a_x', A, 0.45, 0.50)], 'h_a', H);
  const res = resolveInteraction({ actionType: 'TACKLE', actorId: 'a_x', target: { type: 'OPPONENT', playerId: 'h_a' } }, mc, { seed: 't0' });
  assertEquals(res.ok, true);
  const r = deriveInteractionBallTransit(res, { matchCore: mc });
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.INTERACTION_MOVEMENT_DURATION_SCHEMA_GAP);
});

test('C25-PRESS. 真实 PRESS → 缺 duration → Schema Gap', () => {
  const mc = coreOf([mk('h_a', H, 0.50, 0.50), mk('a_x', A, 0.46, 0.50)], 'h_a', H);
  const res = resolveInteraction({ actionType: 'PRESS', actorId: 'a_x', target: { type: 'OPPONENT', playerId: 'h_a' } }, mc, { seed: 'p0' });
  assertEquals(res.ok, true);
  const r = deriveInteractionBallTransit(res, { matchCore: mc });
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.INTERACTION_MOVEMENT_DURATION_SCHEMA_GAP);
});

test('C25-INTERCEPTION. 真实 INTERCEPTION（改变了球）→ 缺 duration → Schema Gap', () => {
  const mc = coreOf([mk('a_x', A, 0.50, 0.50)], null, null, { from: { x: 0.20, y: 0.50 }, to: { x: 0.80, y: 0.50 }, intendedTargetId: 'h_t', targetTeamId: H, progress: 0 });
  mc.ball.position = { x: 0.20, y: 0.50 };
  let changed = null;
  for (let s = 0; s < 200 && !changed; s += 1) {
    const res = resolveInteraction({ actionType: 'INTERCEPTION', actorId: 'a_x', target: { type: 'BALL' } }, mc, { seed: `i${s}` });
    if (res.ok && res.ball?.state !== 'IN_TRANSIT') changed = res;
  }
  assert(changed, '应能找到改变球状态的 INTERCEPTION 结果');
  const r = deriveInteractionBallTransit(changed, { matchCore: mc });
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.INTERACTION_MOVEMENT_DURATION_SCHEMA_GAP);
});

test('C25-INTERCEPTION-FAILED. 未拦截（球继续 transit）→ 无 Movement 边界', () => {
  const mc = coreOf([mk('a_x', A, 0.50, 0.50)], null, null, { from: { x: 0.20, y: 0.50 }, to: { x: 0.80, y: 0.50 }, intendedTargetId: 'h_t', targetTeamId: H, progress: 0 });
  mc.ball.position = { x: 0.20, y: 0.50 };
  let failed = null;
  for (let s = 0; s < 200 && !failed; s += 1) {
    const res = resolveInteraction({ actionType: 'INTERCEPTION', actorId: 'a_x', target: { type: 'BALL' } }, mc, { seed: `i${s}` });
    if (res.ok && res.ball?.state === 'IN_TRANSIT') failed = res;
  }
  assert(failed, '应能找到未拦截（IN_TRANSIT）的 INTERCEPTION 结果');
  const r = deriveInteractionBallTransit(failed, { matchCore: mc });
  assertEquals(r.ok, true);
  assertEquals(r.movementApplied, false);
  assertEquals(r.transit, null);
});

// ===========================================================================
// 无球运动
// ===========================================================================

test('C25-NOMOVE. 无球信息 → BALL_MOVEMENT_NOT_SPECIFIED（非崩溃）', () => {
  const r = deriveInteractionBallTransit({ type: 'INTERACTION_RESOLUTION', actionType: 'PRESS', ok: true });
  assertEquals(r.ok, true);
  assertEquals(r.movementApplied, false);
  assertEquals(r.transit, null);
  assertEquals(r.reason, R.BALL_MOVEMENT_NOT_SPECIFIED);
  assertEquals(r.source, INTERACTION_BALL_TRANSIT_SOURCE);
  assertEquals(r.ruleVersion, INTERACTION_BALL_TRANSIT_RULE_VERSION);
});

// ===========================================================================
// 边界
// ===========================================================================

test('C25-15. 非法 Interaction Result → INVALID_INTERACTION_RESULT', () => {
  assertEquals(deriveInteractionBallTransit(null).reason, R.INVALID_INTERACTION_RESULT);
  assertEquals(deriveInteractionBallTransit('x').reason, R.INVALID_INTERACTION_RESULT);
  assertEquals(deriveInteractionBallTransit([]).reason, R.INVALID_INTERACTION_RESULT);
  assertEquals(deriveInteractionBallTransit({ ok: false }).reason, R.INVALID_INTERACTION_RESULT);
});

test('C25-16. 缺 "from"（结果无 from 且无 Context）→ START SCHEMA GAP', () => {
  const r = deriveInteractionBallTransit({ ok: true, ball: { position: { x: 0.6, y: 0.5 }, state: 'CONTROLLED' }, duration: 0.5 });
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.INTERACTION_MOVEMENT_START_SCHEMA_GAP);
});

test('C25-17. 缺 "to" → INVALID_POSITION', () => {
  const r = deriveInteractionBallTransit({ ok: true, from: { x: 0.4, y: 0.5 }, duration: 0.5 });
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.INVALID_POSITION);
});

test('C25-18. 缺 "duration" → DURATION SCHEMA GAP（不默认 duration=1）', () => {
  const r = deriveInteractionBallTransit({ ok: true, from: { x: 0.4, y: 0.5 }, ball: { position: { x: 0.6, y: 0.5 }, state: 'CONTROLLED' } });
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.INTERACTION_MOVEMENT_DURATION_SCHEMA_GAP);
});

test('C25-19. duration 非法 → INVALID_DURATION', () => {
  const mc = coreOf([mk('h_a', H, 0.40, 0.50)], 'h_a', H);
  const mkRes = (d) => deriveInteractionBallTransit({ ok: true, ball: { position: { x: 0.6, y: 0.5 }, state: 'CONTROLLED' }, duration: d }, { matchCore: mc });
  assertEquals(mkRes(0).reason, R.INVALID_DURATION);
  assertEquals(mkRes(-1).reason, R.INVALID_DURATION);
  assertEquals(mkRes('x').reason, R.INVALID_DURATION);
});

test('C25-20. from 非法 / to 非法 → INVALID_POSITION', () => {
  assertEquals(deriveInteractionBallTransit({ ok: true, from: { x: 'a', y: 0.5 }, ball: { position: { x: 0.6, y: 0.5 }, state: 'CONTROLLED' }, duration: 0.5 }).reason, R.INVALID_POSITION);
  assertEquals(deriveInteractionBallTransit({ ok: true, ball: { position: { x: 'a', y: 0.5 }, state: 'CONTROLLED' }, duration: 0.5 }, { matchCore: coreOf([mk('h_a', H, 0.4, 0.5)], 'h_a', H) }).reason, R.INVALID_POSITION);
});

test('C25-21. from 与 Context Ball Position 不一致 → MOVEMENT_START_POSITION_MISMATCH', () => {
  const mc = coreOf([mk('h_a', H, 0.25, 0.5)], 'h_a', H);
  const r = deriveInteractionBallTransit({ ok: true, from: { x: 0.4, y: 0.5 }, ball: { position: { x: 0.6, y: 0.5 }, state: 'CONTROLLED' }, duration: 0.5 }, { matchCore: mc });
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.MOVEMENT_START_POSITION_MISMATCH);
});

test('C25-22. zero displacement（from === to）→ 合法（duration 存在时）', () => {
  const mc = coreOf([mk('h_a', H, 0.5, 0.5)], 'h_a', H);
  const r = deriveInteractionBallTransit({ ok: true, ball: { position: { x: 0.5, y: 0.5 }, state: 'CONTROLLED' }, duration: 0.5 }, { matchCore: mc });
  assertEquals(r.ok, true);
  assertEquals(r.transit, { from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.5 }, duration: 0.5 });
});

// ===========================================================================
// C-24 兼容（未来 Schema 携带权威 duration 时的目标链路）
// ===========================================================================

test('C25-23. C-25 transit → C-24 → C-23：displacement = to − from 不变量', () => {
  const mc = coreOf([mk('h_a', H, 0.25, 0.5)], 'h_a', H);
  // 未来 Schema：Interaction 结果显式携带 duration（当前真实 Schema 没有）。
  const futureResult = { ok: true, actionType: 'DRIBBLE', ball: { position: { x: 0.75, y: 0.5 }, state: 'CONTROLLED', inTransit: false }, duration: 0.5 };
  const c25 = deriveInteractionBallTransit(futureResult, { matchCore: mc });
  assertEquals(c25.ok, true);
  assertEquals(c25.transit, { from: { x: 0.25, y: 0.5 }, to: { x: 0.75, y: 0.5 }, duration: 0.5 });

  const c24 = deriveBallMovementStateFromAction(c25, { matchCore: mc });
  assertEquals(c24.ok, true);
  assertEquals(c24.movementState.startPosition, { x: 0.25, y: 0.5 });
  assertEquals(c24.movementState.endPosition, { x: 0.75, y: 0.5 });
  assertEquals(c24.movementState.displacement, { x: 0.5, y: 0 });
  assertEquals(c24.movementState.duration, 0.5);

  const applied = applyBallMovementPositionUpdate(mc, c24.movementState);
  assertEquals(applied.ok, true);
  assertEquals(applied.matchCore.ball.position, { x: 0.75, y: 0.5 });
});

// ===========================================================================
// 不变量 / Architecture Source Guard
// ===========================================================================

test('C25-24. 原始 Interaction Result 与 MatchCore 不被修改', () => {
  const mc = coreOf([mk('h_a', H, 0.40, 0.50)], 'h_a', H);
  const res = resolveInteraction({ actionType: 'DRIBBLE', actorId: 'h_a', target: { type: 'SPACE', x: 0.60, y: 0.50 } }, mc, { seed: 'd0' });
  const resSnap = JSON.stringify(res); const mcSnap = JSON.stringify(mc);
  deriveInteractionBallTransit(res, { matchCore: mc });
  assertEquals(JSON.stringify(res), resSnap);
  assertEquals(JSON.stringify(mc), mcSnap);
});

test('C25-25. 不写 MatchCore / 不调用 C-23 Integration / 不调用 C-14·C-15·C-20·C-21 / 不修改 C-22·C-24', () => {
  assert(!/matchCore\.ball\.position\s*=/.test(SRC));
  assert(!/score\.home\s*(\+\+|[-+*\/]?=)/.test(SRC) && !/score\.away\s*(\+\+|[-+*\/]?=)/.test(SRC));
  assert(!/applyBallMovementPositionUpdate/.test(SRC));
  assert(!/from '\.\/ball-movement-integration\.js'/.test(SRC));
  assert(!/from '\.\/ball-movement-state\.js'/.test(SRC));
  assert(!/from '\.\/action-ball-movement-state\.js'/.test(SRC));
  assert(!/from '\.\/goal-resolution\.js'/.test(SRC));
  assert(!/from '\.\/goal-geometry\.js'/.test(SRC));
  assert(!/from '\.\/trajectory-goal-detection\.js'/.test(SRC));
  assert(!/from '\.\/goal-crossing-resolution\.js'/.test(SRC));
  assert(!/from '\.\/trajectory-goal-match-tick\.js'/.test(SRC));
});

test('C25-26. 无 random / wall clock / Velocity / Physics / Collision / Ledger / 进球判断', () => {
  assert(!/Math\.random\s*\(/.test(SRC));
  assert(!/Date\.now\s*\(/.test(SRC) && !/new\s+Date\s*\(/.test(SRC) && !/performance\.now\s*\(/.test(SRC));
  assert(!/velocityTruth|ballPhysics|physicsEngine/i.test(SRC) && !/collision/i.test(SRC));
  assert(!/movementLedger|movementHistory|movementEventId|goalEventId/i.test(SRC));
  assert(!/goal\s*=\s*true/.test(SRC));
  assert(!/if\s*\([^)]*\.x\s*>\s*1/.test(SRC));
  assert(!/velocity\s*=/.test(SRC) && !/acceleration\s*=/.test(SRC) && !/spin\s*=/.test(SRC));
});