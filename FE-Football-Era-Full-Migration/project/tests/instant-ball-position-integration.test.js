/**
 * Step 39F-M-C-29 —— Instant Ball Position Integration Boundary 测试。
 *
 * 覆盖：正常写入 / zero displacement / MatchCore 与 Target 不可变 / 非法输入 /
 * 越界不 clamp / 只改 position / 确定性 / Source Guard（不调 C-23·C-24·C-25·C-19~C-22，
 * 不产生 Movement State·Transit·Duration·Velocity·Trajectory·Physics）。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyInstantBallPositionUpdate,
  INSTANT_BALL_POSITION_INTEGRATION_SOURCE,
  INSTANT_BALL_POSITION_INTEGRATION_RULE_VERSION,
  INSTANT_BALL_POSITION_INTEGRATION_REASON,
} from '../src/core/match/instant-ball-position-integration.js';

const R = INSTANT_BALL_POSITION_INTEGRATION_REASON;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '../src/core/match/instant-ball-position-integration.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const coreOf = (x = 0.4, y = 0.5, extra = {}) => ({
  ball: { position: { x, y }, state: 'CONTROLLED', control: 'p1', possessingTeamId: 'clb_h', velocity: { x: 0, y: 0 }, spin: null, ...extra },
  players: [], clock: { simulationTime: 5 },
});

// ===========================================================================
// 1. 正常 Position Update
// ===========================================================================

test('C29-01. 正常写入：newMatchCore.ball.position === target', () => {
  const mc = coreOf(0.4, 0.5);
  const r = applyInstantBallPositionUpdate(mc, { x: 0.7, y: 0.5 });
  assertEquals(r.ok, true);
  assertEquals(r.matchCore.ball.position, { x: 0.7, y: 0.5 });
  assertEquals(r.source, INSTANT_BALL_POSITION_INTEGRATION_SOURCE);
  assertEquals(r.ruleVersion, INSTANT_BALL_POSITION_INTEGRATION_RULE_VERSION);
});

test('C29-02. 只改 position：其余 Ball 字段原样保留', () => {
  const mc = coreOf(0.4, 0.5);
  const r = applyInstantBallPositionUpdate(mc, { x: 0.7, y: 0.6 });
  assertEquals(r.matchCore.ball.state, 'CONTROLLED');
  assertEquals(r.matchCore.ball.control, 'p1');
  assertEquals(r.matchCore.ball.possessingTeamId, 'clb_h');
  assertEquals(r.matchCore.ball.velocity, { x: 0, y: 0 });
  assertEquals(r.matchCore.ball.spin, null);
});

test('C29-03. 输出契约：不含 movementState / transit / duration / velocity 新字段', () => {
  const r = applyInstantBallPositionUpdate(coreOf(), { x: 0.7, y: 0.5 });
  assertEquals(r.movementState, undefined);
  assertEquals(r.transit, undefined);
  assertEquals(r.duration, undefined);
  assertEquals(r.velocity, undefined);
  assertEquals(r.trajectory, undefined);
});

// ===========================================================================
// 2. 相同 Position（zero displacement）
// ===========================================================================

test('C29-04. target === current → 合法成功；不产生 duration / Movement State / Transit / Velocity', () => {
  const mc = coreOf(0.5, 0.5);
  const r = applyInstantBallPositionUpdate(mc, { x: 0.5, y: 0.5 });
  assertEquals(r.ok, true);
  assertEquals(r.matchCore.ball.position, { x: 0.5, y: 0.5 });
  assertEquals(r.duration, undefined);
  assertEquals(r.movementState, undefined);
  assertEquals(r.transit, undefined);
  assertEquals(r.velocity, undefined);
  // Instant ≠ "duration = 0"
  assertEquals(r.matchCore.ball.position.x - mc.ball.position.x, 0);
});

// ===========================================================================
// 3-4. 不可变性
// ===========================================================================

test('C29-05. MatchCore 不可变：input !== output，且 input.ball.position 不变', () => {
  const mc = coreOf(0.4, 0.5);
  const snap = JSON.stringify(mc);
  const r = applyInstantBallPositionUpdate(mc, { x: 0.9, y: 0.1 });
  assert(r.matchCore !== mc);
  assert(r.matchCore.ball !== mc.ball);
  assertEquals(mc.ball.position, { x: 0.4, y: 0.5 });
  assertEquals(JSON.stringify(mc), snap);
});

test('C29-06. Target Position 对象不被修改；输出 position 为副本', () => {
  const target = { x: 0.8, y: 0.3 };
  const targetSnap = JSON.stringify(target);
  const r = applyInstantBallPositionUpdate(coreOf(), target);
  assertEquals(JSON.stringify(target), targetSnap);
  assert(r.matchCore.ball.position !== target);
  assertEquals(r.matchCore.ball.position, { x: 0.8, y: 0.3 });
});

// ===========================================================================
// 5. 非法输入
// ===========================================================================

test('C29-07. 非法 MatchCore → INVALID_MATCH_CORE', () => {
  for (const mc of [null, undefined, 'x', [], {}, { ball: null }, { ball: { position: null } }, { ball: { position: { x: NaN, y: 0 } } }]) {
    const r = applyInstantBallPositionUpdate(mc, { x: 0.5, y: 0.5 });
    assertEquals(r.ok, false);
    assertEquals(r.reason, R.INVALID_MATCH_CORE);
  }
});

test('C29-08. 非法输入结构 → INVALID_INPUT', () => {
  const mc = coreOf();
  for (const p of [null, undefined, 'x', 5, []]) {
    assertEquals(applyInstantBallPositionUpdate(mc, p).reason, R.INVALID_INPUT);
  }
});

test('C29-09. 非法 Position 值（x/y 非 number、NaN、Infinity）→ INVALID_POSITION', () => {
  const mc = coreOf();
  for (const p of [{ x: 'a', y: 0.5 }, { x: 0.5, y: 'b' }, { x: NaN, y: 0.5 }, { x: 0.5, y: NaN }, { x: Infinity, y: 0.5 }, { x: 0.5, y: -Infinity }, { x: 0.5 }, { y: 0.5 }]) {
    assertEquals(applyInstantBallPositionUpdate(mc, p).reason, R.INVALID_POSITION);
  }
});

// ===========================================================================
// 6. 越界：不 clamp
// ===========================================================================

test('C29-10. 越界 Position 不被 C-29 擅自 clamp（忠实写入）', () => {
  const cases = [{ x: 1.2, y: 0.5 }, { x: -0.3, y: 0.5 }, { x: 0.5, y: 1.4 }, { x: 0.5, y: -0.2 }];
  for (const p of cases) {
    const r = applyInstantBallPositionUpdate(coreOf(), p);
    assertEquals(r.ok, true);
    assertEquals(r.matchCore.ball.position, { x: p.x, y: p.y });
  }
});

// ===========================================================================
// 7. 确定性
// ===========================================================================

test('C29-11. 同输入 → 同输出（确定性）', () => {
  const a = applyInstantBallPositionUpdate(coreOf(0.2, 0.3), { x: 0.6, y: 0.7 });
  const b = applyInstantBallPositionUpdate(coreOf(0.2, 0.3), { x: 0.6, y: 0.7 });
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

// ===========================================================================
// Source Guard
// ===========================================================================

test('C29-12. 不调用 C-23 / C-24 / C-25 / C-19~C-22', () => {
  assert(!/from '\.\/ball-movement-integration\.js'/.test(SRC));
  assert(!/from '\.\/ball-movement-state\.js'/.test(SRC));
  assert(!/from '\.\/action-ball-movement-state\.js'/.test(SRC));
  assert(!/from '\.\/interaction-ball-transit\.js'/.test(SRC));
  assert(!/from '\.\/interaction-ball-movement-semantics\.js'/.test(SRC));
  assert(!/applyBallMovementPositionUpdate|createBallMovementState|validateBallMovementState/.test(SRC));
  assert(!/deriveInteractionBallTransit|deriveBallMovementStateFromAction/.test(SRC));
  assert(!/from '\.\/goal-resolution\.js'|from '\.\/ball-trajectory\.js'|from '\.\/goal-crossing-resolution\.js'/.test(SRC));
});

test('C29-13. 不产生 Movement State / Transit / Duration / Velocity / Physics；无 random·wall clock', () => {
  assert(!/createBallMovementState|MovementState\s*[:=]/.test(SRC));
  assert(!/transit\s*[:=]/.test(SRC));
  assert(!/duration\s*[:=]/.test(SRC));
  assert(!/velocity\s*[:=]/i.test(SRC));
  assert(!/trajectory|physics|collision|acceleration|spin|curve|gravity|bounce/i.test(SRC));
  assert(!/Math\.random\s*\(/.test(SRC));
  assert(!/Date\.now\s*\(/.test(SRC) && !/new\s+Date\s*\(/.test(SRC) && !/performance\.now\s*\(/.test(SRC));
});

test('C29-14. 不原地修改 MatchCore / 不直接赋值 ball.position', () => {
  assert(!/matchCore\.ball\.position\s*=/.test(SRC));
  assert(!/matchCore\.ball\.position\.x\s*=/.test(SRC) && !/matchCore\.ball\.position\.y\s*=/.test(SRC));
  assert(!/position\s*:\s*position\b/.test(SRC)); // 不共享 target 引用（须复制）
});