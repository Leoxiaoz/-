/**
 * Step 39F-M-C-19 —— Ball Trajectory / Tick-Internal Movement 测试。
 *
 * 覆盖 基础 / Geometry / Formula / Boundary / Invalid / Immutability / Determinism / Architecture。
 * 红线：无真实 Ball Physics；不建 Ball Position / Velocity Truth；不改 MatchCore；不依赖 Goal 层。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  deriveBallTrajectory, sampleTrajectory, validateBallTrajectory,
  DEFAULT_SAMPLE_COUNT, MAX_SAMPLE_COUNT, TRAJECTORY_SOURCE, TRAJECTORY_REASON,
} from '../src/core/match/ball-trajectory.js';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/core/match/ball-trajectory.js'), 'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const P0 = { x: 0.2, y: 0.5 };
const P1 = { x: 1.1, y: 0.5 };
const traj = (over = {}, opts = {}) => deriveBallTrajectory({ startPosition: P0, endPosition: P1, ...over }, opts);

// ===========================================================================
// 基础：1-6
// ===========================================================================

test('BT-01. sampleCount = 2（默认）', () => {
  const r = traj();
  assertEquals(r.ok, true);
  assertEquals(r.sampleCount, DEFAULT_SAMPLE_COUNT);
  assertEquals(r.samples.length, 2);
});

test('BT-02/03. sampleCount = 3 / 5', () => {
  assertEquals(traj({ sampleCount: 3 }).samples.length, 3);
  assertEquals(traj({ sampleCount: 5 }).samples.length, 5);
});

test('BT-04. sampleCount = MAX_SAMPLE_COUNT', () => {
  const r = traj({ sampleCount: MAX_SAMPLE_COUNT });
  assertEquals(r.ok, true);
  assertEquals(r.sampleCount, MAX_SAMPLE_COUNT);
});

test('BT-05/06. start sample t=0，end sample t=1', () => {
  const r = traj({ sampleCount: 5 });
  assertEquals(r.samples[0].t, 0);
  assertEquals(r.samples[4].t, 1);
});

// ===========================================================================
// Geometry：7-10
// ===========================================================================

test('BT-07. 水平运动', () => {
  const r = traj({ startPosition: { x: 0.2, y: 0.5 }, endPosition: { x: 0.8, y: 0.5 }, sampleCount: 4 });
  assertEquals(JSON.stringify(r.samples.map((s) => s.x)), JSON.stringify([0.2, 0.4, 0.6000000000000001, 0.8]));
  assertEquals(new Set(r.samples.map((s) => s.y)).size, 1);
});

test('BT-08. 垂直运动', () => {
  const r = traj({ startPosition: { x: 0.5, y: 0.2 }, endPosition: { x: 0.5, y: 0.8 }, sampleCount: 2 });
  assertEquals(r.samples[1], { t: 1, x: 0.5, y: 0.8 });
  assertEquals(r.samples[0], { t: 0, x: 0.5, y: 0.2 });
});

test('BT-09. 斜向运动 dx/dy', () => {
  const r = traj({ startPosition: { x: 0, y: 0 }, endPosition: { x: 0.6, y: 0.8 }, sampleCount: 2 });
  assertEquals(r.displacement, { x: 0.6, y: 0.8 });
  assertEquals(r.distance, 1);
});

test('BT-10. 零位移', () => {
  const r = traj({ startPosition: { x: 0.5, y: 0.5 }, endPosition: { x: 0.5, y: 0.5 }, sampleCount: 4 });
  assertEquals(r.distance, 0);
  assert(r.samples.every((s) => s.x === 0.5 && s.y === 0.5));
});

// ===========================================================================
// Formula：11-15
// ===========================================================================

test('BT-11. t_i = i/(N-1)', () => {
  const r = traj({ sampleCount: 4 });
  assertEquals(JSON.stringify(r.samples.map((s) => s.t)), JSON.stringify([0, 1 / 3, 2 / 3, 1]));
});

test('BT-12/13. x_i / y_i 正确', () => {
  const r = traj({ startPosition: { x: 0.2, y: 0.5 }, endPosition: { x: 1.1, y: 0.5 }, sampleCount: 4 });
  assertEquals(r.samples[1].x, 0.2 + 0.9 * (1 / 3));
  assertEquals(r.samples[2].x, 0.2 + 0.9 * (2 / 3));
  assert(r.samples.every((s) => s.y === 0.5));
});

test('BT-14/15. first 精确 = P0，last 精确 = P1（无浮点漂移）', () => {
  const r = traj({ startPosition: { x: 0.2, y: 0.5 }, endPosition: { x: 1.1, y: 0.5 }, sampleCount: 7 });
  assertEquals(r.samples[0], { t: 0, x: 0.2, y: 0.5 });
  assertEquals(r.samples[6], { t: 1, x: 1.1, y: 0.5 });
});

// ===========================================================================
// Boundary：16-20
// ===========================================================================

test('BT-16/17/18/19. x=0 / x=1 / y=0 / y=1 边界端点保留', () => {
  assertEquals(traj({ startPosition: { x: 0, y: 0.5 }, endPosition: { x: 1, y: 0.5 } }).start, { x: 0, y: 0.5 });
  assertEquals(traj({ startPosition: { x: 0.5, y: 1 }, endPosition: { x: 0.5, y: 0 } }).end, { x: 0.5, y: 0 });
});

test('BT-20. 越界位置不被 clamp（0.9 → 1.1 保留）', () => {
  const r = traj({ startPosition: { x: 0.9, y: 0.5 }, endPosition: { x: 1.1, y: 0.5 } });
  assertEquals(r.end, { x: 1.1, y: 0.5 });
  assertEquals(r.samples[1].x, 1.1);
});

// ===========================================================================
// Invalid：21-28
// ===========================================================================

test('BT-21/22. missing / invalid start & end', () => {
  assertEquals(deriveBallTrajectory({ endPosition: P1 }).reason, TRAJECTORY_REASON.MISSING_START);
  assertEquals(deriveBallTrajectory({ startPosition: P0 }).reason, TRAJECTORY_REASON.MISSING_END);
  assertEquals(deriveBallTrajectory({ startPosition: P0, endPosition: { x: NaN, y: 0 } }).reason, TRAJECTORY_REASON.MISSING_END);
});

test('BT-23/24. NaN / Infinity 坐标拒绝', () => {
  assertEquals(deriveBallTrajectory({ startPosition: { x: NaN, y: 0 }, endPosition: P1 }).ok, false);
  assertEquals(deriveBallTrajectory({ startPosition: P0, endPosition: { x: Infinity, y: 0 } }).ok, false);
  assertEquals(deriveBallTrajectory(null).ok, false);
});

test('BT-25/26/27. sampleCount < 2 / 非整数 / > MAX 拒绝', () => {
  assertEquals(traj({ sampleCount: 1 }).reason, TRAJECTORY_REASON.SAMPLE_COUNT_OUT_OF_RANGE);
  assertEquals(traj({ sampleCount: 3.5 }).reason, TRAJECTORY_REASON.SAMPLE_COUNT_OUT_OF_RANGE);
  assertEquals(traj({ sampleCount: MAX_SAMPLE_COUNT + 1 }).reason, TRAJECTORY_REASON.SAMPLE_COUNT_OUT_OF_RANGE);
  assertEquals(traj({ sampleCount: 1e8 }).ok, false);
});

test('BT-28. invalid / negative duration 拒绝', () => {
  assertEquals(traj({ duration: 0 }).reason, TRAJECTORY_REASON.INVALID_DURATION);
  assertEquals(traj({ duration: -1 }).reason, TRAJECTORY_REASON.INVALID_DURATION);
  assertEquals(traj({ duration: NaN }).reason, TRAJECTORY_REASON.INVALID_DURATION);
});

// ===========================================================================
// Immutability：29-31
// ===========================================================================

test('BT-29. input 不变', () => {
  const input = { startPosition: { x: 0.2, y: 0.5 }, endPosition: { x: 1.1, y: 0.5 }, sampleCount: 4 };
  const snap = JSON.stringify(input);
  deriveBallTrajectory(input);
  assertEquals(JSON.stringify(input), snap);
});

test('BT-30. start / end 无引用泄漏', () => {
  const input = { startPosition: { x: 0.2, y: 0.5 }, endPosition: { x: 1.1, y: 0.5 } };
  const r = deriveBallTrajectory(input);
  assert(r.start !== input.startPosition && r.end !== input.endPosition, '应为值快照');
  input.startPosition.x = 9;
  assertEquals(r.start.x, 0.2, '快照不受原对象影响');
});

test('BT-31. samples 不共享同一 Position Object', () => {
  const r = traj({ sampleCount: 5 });
  assert(r.samples[0] !== r.samples[1] && r.samples[1] !== r.samples[2]);
  assert(r.samples[0] !== r.start && r.samples[4] !== r.end);
});

// ===========================================================================
// Determinism：32-34
// ===========================================================================

test('BT-32. identical input → identical output', () => {
  const run = () => deriveBallTrajectory({ startPosition: P0, endPosition: P1, sampleCount: 6, tickIndex: 3 });
  assertEquals(JSON.stringify(run()), JSON.stringify(run()));
});

test('BT-33/34. 无 Math.random / wall clock', () => {
  assert(!/Math\.random\s*\(/.test(SRC));
  assert(!/Date\.now\s*\(/.test(SRC) && !/performance\.now\s*\(/.test(SRC) && !/new\s+Date\s*\(/.test(SRC));
});

// ===========================================================================
// Architecture：35-42
// ===========================================================================

test('BT-35/36/37/38. 不修改 MatchCore / 不建 Position·Velocity·History Truth', () => {
  assert(!/matchCore/.test(SRC), '不得引用 MatchCore');
  assert(!/previousPosition|ballHistory|ballHistory|\.history\b|ball\.path|ball\.samples|ball\.trajectory/.test(SRC));
  assert(!/VelocityTruth|ballVelocityTruth/i.test(SRC), '不得建 Velocity Truth');
});

test('BT-39/40/41/42. 不依赖 / 不修改 Goal 层与 C-16~C-18', () => {
  assert(!/goal-resolution|goal-geometry|goal-aware/.test(SRC), '不得依赖 Goal 层');
  assert(!/ball-tick-segment|match-tick|match-ticks/.test(SRC), '不得依赖 C-08/C-16/C-17/C-18');
});

test('BT-43. 无真实 Ball Physics', () => {
  for (const banned of ['acceleration', 'gravity', 'friction', 'drag', 'bounce', 'spin', 'curve',
    'collision', 'radius', 'integr', 'magnus', 'impulse']) {
    assert(!new RegExp(banned, 'i').test(SRC), `不得包含 ${banned}`);
  }
});

test('BT-44. 校验：合法 Trajectory 通过 / 非法拒绝', () => {
  const good = traj({ sampleCount: 4 });
  assertEquals(validateBallTrajectory(good).valid, true);
  assertEquals(validateBallTrajectory({ ok: false }).valid, false);
  const tampered = { ...good, samples: [...good.samples.slice(0, -1), { t: 1, x: 99, y: 0.5 }] };
  assert(validateBallTrajectory(tampered).issues.includes('LAST_NOT_END'));
});

test('BT-45. source 常量与派生 velocity', () => {
  const r = traj({ duration: 1 });
  assertEquals(r.source, TRAJECTORY_SOURCE);
  assertEquals(r.duration, 1);
  assertEquals(r.velocity.x, 1.1 - 0.2);
  assertEquals(r.velocity.y, 0);
  assertEquals(traj().velocity, null, '无 duration 时 velocity 为 null');
});

test('BT-46. sampleTrajectory 独立纯函数', () => {
  const r = sampleTrajectory({ x: 0, y: 0 }, { x: 1, y: 1 }, 3);
  assertEquals(r.samples[1], { t: 0.5, x: 0.5, y: 0.5 });
  assertEquals(sampleTrajectory({ x: 0, y: 0 }, { x: 1, y: 0 }, 1).ok, false);
});