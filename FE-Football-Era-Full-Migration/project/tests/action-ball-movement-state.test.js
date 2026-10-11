/**
 * Step 39F-M-C-24 —— Action / Interaction → Ball Movement State Adapter 测试。
 *
 * 覆盖：PASS transit 边界 / 显式字段归一化 / 无 Movement 业务语义 / 失败分类 /
 *       Architecture Source Guard / C-23 Integration Compatibility / 真实 PASS Resolution 接入。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  deriveBallMovementStateFromAction,
  ACTION_BALL_MOVEMENT_SOURCE, ACTION_BALL_MOVEMENT_RULE_VERSION, ACTION_BALL_MOVEMENT_REASON,
} from '../src/core/match/action-ball-movement-state.js';
import { BALL_MOVEMENT_STATE_SOURCE } from '../src/core/match/ball-movement-state.js';
import { applyBallMovementPositionUpdate } from '../src/core/match/ball-movement-integration.js';
import { resolvePass } from '../src/core/match/pass-resolution.js';

const R = ACTION_BALL_MOVEMENT_REASON;
const H = 'clb_h'; const A = 'clb_a';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '../src/core/match/action-ball-movement-state.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** 最小 MatchCore（ball.position 为唯一 Ball Position Truth）。 */
function core(px = 0.25, py = 0.5) {
  return {
    worldId: 'w24', season: 1, matchId: 'm24', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 12, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball: { position: { x: px, y: py }, state: 'CONTROLLED', control: 'h_a', possessingTeamId: H, inTransit: false },
    players: [],
  };
}

/** 与 PASS Resolution 实际输出同形状的 transit 结果（from/to/duration 为已确定边界）。 */
const passLike = (from, to, duration) => ({
  type: 'PASS_RESOLUTION', ok: true, actorId: 'h_a', targetId: 'h_t', outcome: 'COMPLETED',
  actualDestination: { ...to }, ballDestination: { ...to },
  transit: {
    state: 'IN_TRANSIT', from: { ...from }, to: { ...to }, duration,
    intendedTargetId: 'h_t', startedAt: 12, progress: 0, elapsed: 0,
    outcome: 'COMPLETED', interceptorId: null, blockerId: null, targetTeamId: H,
  },
});

// ===========================================================================
// 基础：1-7
// ===========================================================================

test('C24-1/2. PASS transit（完整 Movement）→ 正常生成 Movement State', () => {
  const mc = core(0.25, 0.5);
  const r = deriveBallMovementStateFromAction(passLike({ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, 1), { matchCore: mc });
  assertEquals(r.ok, true);
  assertEquals(r.movementApplied, true);
  assert(r.movementState && typeof r.movementState === 'object', 'movementState 必须存在');
});

test('C24-3/4/5. start / end / displacement / duration 正确', () => {
  const mc = core(0.25, 0.5);
  const r = deriveBallMovementStateFromAction(passLike({ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, 2), { matchCore: mc });
  assertEquals(r.movementState.startPosition, { x: 0.25, y: 0.5 });
  assertEquals(r.movementState.endPosition, { x: 0.75, y: 0.5 });
  assertEquals(r.movementState.displacement, { x: 0.5, y: 0 });
  assertEquals(r.movementState.duration, 2);
});

test('C24-6/7. source / ruleVersion 正确（信封 provenance + C-23 canonical state）', () => {
  const r = deriveBallMovementStateFromAction(passLike({ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, 1), { matchCore: core(0.25, 0.5) });
  assertEquals(r.source, ACTION_BALL_MOVEMENT_SOURCE);
  assertEquals(r.ruleVersion, ACTION_BALL_MOVEMENT_RULE_VERSION);
  assertEquals(r.movementState.source, BALL_MOVEMENT_STATE_SOURCE);
});

// ===========================================================================
// 归一化：8-11
// ===========================================================================

test('C24-8. start + end → Movement State', () => {
  const r = deriveBallMovementStateFromAction({ ok: true, startPosition: { x: 0.25, y: 0.5 }, endPosition: { x: 0.75, y: 0.5 }, duration: 1 });
  assertEquals(r.ok, true);
  assertEquals(r.movementState.endPosition, { x: 0.75, y: 0.5 });
});

test('C24-9. start + displacement → end = start + displacement', () => {
  const r = deriveBallMovementStateFromAction({ ok: true, startPosition: { x: 0.25, y: 0.5 }, displacement: { x: 0.25, y: 0 }, duration: 1 });
  assertEquals(r.ok, true);
  assertEquals(r.movementState.endPosition, { x: 0.5, y: 0.5 });
  assertEquals(r.movementState.displacement, { x: 0.25, y: 0 });
});

test('C24-10. end + displacement 一致 → ok', () => {
  const r = deriveBallMovementStateFromAction({ ok: true, startPosition: { x: 0.25, y: 0.5 }, endPosition: { x: 0.5, y: 0.5 }, displacement: { x: 0.25, y: 0 }, duration: 1 });
  assertEquals(r.ok, true);
});

test('C24-11/20. end + displacement 不一致 / displacement 非点 → INVALID_DISPLACEMENT', () => {
  const a = deriveBallMovementStateFromAction({ ok: true, startPosition: { x: 0.25, y: 0.5 }, endPosition: { x: 0.5, y: 0.5 }, displacement: { x: 0.1, y: 0 }, duration: 1 });
  assertEquals(a.ok, false); assertEquals(a.reason, R.INVALID_DISPLACEMENT);
  const b = deriveBallMovementStateFromAction({ ok: true, startPosition: { x: 0.25, y: 0.5 }, displacement: { x: 'a', y: 0 }, duration: 1 });
  assertEquals(b.ok, false); assertEquals(b.reason, R.INVALID_DISPLACEMENT);
});

// ===========================================================================
// 无 Movement（业务正常）：12-14
// ===========================================================================

test('C24-12/14. Action 成功但无 Ball Movement → ok:true / movementApplied:false（非崩溃）', () => {
  const r = deriveBallMovementStateFromAction({ type: 'ACTION_RESULT', ok: true, actionType: 'PRESS' }, { matchCore: core() });
  assertEquals(r.ok, true);
  assertEquals(r.movementApplied, false);
  assertEquals(r.movementState, null);
  assertEquals(r.reason, R.BALL_MOVEMENT_NOT_SPECIFIED);
});

test('C24-13. Interaction 成功但无 Movement 边界 → movementApplied:false（Schema Gap 记录）', () => {
  // Interaction Resolution Result 只暴露终态 result.ball.position，不暴露 movement boundary（无 start/duration）。
  const interaction = {
    type: 'INTERACTION_RESOLUTION', actionType: 'PRESS', ok: true, outcome: 'PRESSURE_ONLY',
    actorId: 'a_p1', targetId: 'h_a',
    ball: { position: { x: 0.25, y: 0.5 }, state: 'CONTROLLED', inTransit: false },
    possession: { changed: false, retained: true, loose: false, fromPlayerId: 'h_a', fromTeamId: H, toPlayerId: 'h_a', toTeamId: H },
  };
  const r = deriveBallMovementStateFromAction(interaction, { matchCore: core() });
  assertEquals(r.ok, true);
  assertEquals(r.movementApplied, false);
  assertEquals(r.movementState, null);
  assertEquals(r.reason, R.BALL_MOVEMENT_NOT_SPECIFIED);
});

// ===========================================================================
// 错误：15-19
// ===========================================================================

test('C24-15. 非法 Action Result → INVALID_ACTION_RESULT', () => {
  assertEquals(deriveBallMovementStateFromAction(null).reason, R.INVALID_ACTION_RESULT);
  assertEquals(deriveBallMovementStateFromAction('x').reason, R.INVALID_ACTION_RESULT);
  assertEquals(deriveBallMovementStateFromAction([]).reason, R.INVALID_ACTION_RESULT);
  assertEquals(deriveBallMovementStateFromAction({ ok: false }).reason, R.INVALID_ACTION_RESULT);
});

test('C24-16. 非法 Position → INVALID_POSITION', () => {
  assertEquals(deriveBallMovementStateFromAction({ ok: true, startPosition: { x: 'a', y: 0.5 }, endPosition: { x: 0.6, y: 0.5 }, duration: 1 }).reason, R.INVALID_POSITION);
  assertEquals(deriveBallMovementStateFromAction({ ok: true, startPosition: { x: 0.4, y: 0.5 }, endPosition: { x: NaN, y: 0.5 }, duration: 1 }).reason, R.INVALID_POSITION);
  // 无 start 且无 Context
  assertEquals(deriveBallMovementStateFromAction({ ok: true, endPosition: { x: 0.6, y: 0.5 }, duration: 1 }).reason, R.INVALID_POSITION);
});

test('C24-17. 缺 Duration → MOVEMENT_DURATION_NOT_SPECIFIED（不自行创造时间）', () => {
  const r = deriveBallMovementStateFromAction({ ok: true, startPosition: { x: 0.4, y: 0.5 }, endPosition: { x: 0.6, y: 0.5 } });
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.MOVEMENT_DURATION_NOT_SPECIFIED);
});

test('C24-18. 非法 Duration → INVALID_DURATION', () => {
  const mk = (d) => deriveBallMovementStateFromAction({ ok: true, startPosition: { x: 0.4, y: 0.5 }, endPosition: { x: 0.6, y: 0.5 }, duration: d });
  assertEquals(mk(0).reason, R.INVALID_DURATION);
  assertEquals(mk(-1).reason, R.INVALID_DURATION);
  assertEquals(mk('x').reason, R.INVALID_DURATION);
});

test('C24-19. Start mismatch（Result start ≠ Ball Position Context）→ MOVEMENT_START_POSITION_MISMATCH', () => {
  const r = deriveBallMovementStateFromAction(passLike({ x: 0.75, y: 0.5 }, { x: 1.0, y: 0.5 }, 1), { matchCore: core(0.25, 0.5) });
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.MOVEMENT_START_POSITION_MISMATCH);
});

// ===========================================================================
// Architecture Source Guard：21-34
// ===========================================================================

test('C24-21/22. 不修改 MatchCore / 不写 Ball Position', () => {
  const mc = core(0.25, 0.5);
  const snap = JSON.stringify(mc);
  deriveBallMovementStateFromAction(passLike({ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, 1), { matchCore: mc });
  assertEquals(JSON.stringify(mc), snap);
  assert(!/matchCore\.ball\.position\s*=/.test(SRC), '禁止写 matchCore.ball.position');
  assert(!/score\.home\s*(\+\+|[-+*\/]?=)/.test(SRC) && !/score\.away\s*(\+\+|[-+*\/]?=)/.test(SRC));
});

test('C24-23~26. 不调用 C-14 / C-15 / C-20 / C-21', () => {
  assert(!/from '\.\/goal-resolution\.js'/.test(SRC));
  assert(!/from '\.\/goal-geometry\.js'/.test(SRC));
  assert(!/from '\.\/trajectory-goal-detection\.js'/.test(SRC));
  assert(!/from '\.\/goal-crossing-resolution\.js'/.test(SRC));
});

test('C24-27/28. 不修改 C-23 / 不修改 C-22（无写入、无 Tick Integration）', () => {
  assert(!/from '\.\/ball-movement-integration\.js'/.test(SRC), 'C-24 不得调用 C-23 Integration（Derivation 而非 Orchestration）');
  assert(!/applyBallMovementPositionUpdate/.test(SRC));
  assert(!/from '\.\/trajectory-goal-match-tick\.js'/.test(SRC));
  assert(!/from '\.\/ball-trajectory\.js'/.test(SRC));
  assert(!/goal-aware-match-tick/.test(SRC));
});

test('C24-29~32. 无 Velocity Truth / Physics / Collision / Movement Ledger', () => {
  assert(!/velocityTruth|ballVelocityTruth/i.test(SRC));
  assert(!/ballPhysics|physicsEngine/i.test(SRC));
  assert(!/collision/i.test(SRC));
  assert(!/movementLedger|movementHistory|movementId\b|movementEventId/i.test(SRC));
});

test('C24-33/34. 无 random / wall clock / 进球判断', () => {
  assert(!/Math\.random\s*\(/.test(SRC));
  assert(!/Date\.now\s*\(/.test(SRC) && !/new\s+Date\s*\(/.test(SRC) && !/performance\.now\s*\(/.test(SRC));
  assert(!/goal\s*=\s*true/.test(SRC));
  assert(!/if\s*\([^)]*\.x\s*>\s*1/.test(SRC));
  assert(!/velocity\s*=/.test(SRC) && !/acceleration\s*=/.test(SRC) && !/force\s*=/.test(SRC) && !/spin\s*=/.test(SRC));
});

// ===========================================================================
// Integration Compatibility：35-38 + 真实 PASS
// ===========================================================================

test('C24-35/36. C-24 输出可被 C-23 消费，且正确写入 C-24 的 End Position', () => {
  const mc = core(0.25, 0.5);
  const r = deriveBallMovementStateFromAction(passLike({ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, 1), { matchCore: mc });
  const out = applyBallMovementPositionUpdate(mc, r.movementState);
  assertEquals(out.ok, true);
  assertEquals(out.matchCore.ball.position, { x: 0.75, y: 0.5 });
});

test('C24-37. Integration 中输入 MatchCore 保持不变', () => {
  const mc = core(0.25, 0.5);
  const snap = JSON.stringify(mc);
  const r = deriveBallMovementStateFromAction(passLike({ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, 1), { matchCore: mc });
  applyBallMovementPositionUpdate(mc, r.movementState);
  assertEquals(JSON.stringify(mc), snap);
});

test('C24-38. Movement State 引用安全（不与上游共享可变引用）', () => {
  const src = passLike({ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }, 1);
  const r = deriveBallMovementStateFromAction(src, { matchCore: core(0.25, 0.5) });
  assert(r.movementState.startPosition !== src.transit.from, 'start 不得共享引用');
  assert(r.movementState.endPosition !== src.transit.to, 'end 不得共享引用');
  r.movementState.endPosition.x = 999;
  assertEquals(src.transit.to, { x: 0.75, y: 0.5 });
});

test('C24-REAL. 真实 PASS Resolution 的 transit 边界 → Movement State', () => {
  const ATTRS = (o = {}) => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...o });
  const mk = (id, t, pos, x, y, attrs = {}) => ({ playerId: id, teamId: t, position: pos, positionOnPitch: { x, y }, onPitch: true, injured: false, sentOff: false, attributes: ATTRS(attrs), fitness: 100, form: 50, morale: 50, matchLoad: 0 });
  const players = [mk('h_a', H, 'MF', 0.40, 0.50, { passing: 95 }), mk('h_t', H, 'MF', 0.45, 0.50), mk('a_gk', A, 'GK', 0.95, 0.50)];
  const mc = {
    worldId: 'w24', season: 1, matchId: 'm24', ruleVersion: 'match-pass-resolution-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 12, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball: { position: { x: 0.40, y: 0.50 }, control: 'h_a', possessingTeamId: H },
    players,
    tactical: { [H]: { formation: '4-4-2', pressing: 'medium' }, [A]: { formation: '4-4-2', pressing: 'medium' } },
  };
  const action = {
    actionType: 'PASS', actorId: 'h_a', target: { type: 'TEAMMATE', playerId: 'h_t' }, intent: 'SHORT',
    riskIntent: { level: 'MEDIUM', value: 0.5 }, commitment: { type: 'COMMITTED', duration: null },
  };
  const pass = resolvePass(action, mc, { seed: 'a' });
  assertEquals(pass.ok, true);
  assertEquals(typeof pass.transit?.from?.x, 'number');

  const r = deriveBallMovementStateFromAction(pass, { matchCore: mc });
  assertEquals(r.ok, true);
  assertEquals(r.movementApplied, true);
  assertEquals(r.movementState.startPosition, { x: pass.transit.from.x, y: pass.transit.from.y });
  assertEquals(r.movementState.endPosition, { x: pass.transit.to.x, y: pass.transit.to.y });
  assertEquals(r.movementState.duration, pass.transit.duration);
});