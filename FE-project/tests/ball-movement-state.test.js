/**
 * Step 39F-M-C-23 —— Ball Movement State 测试。
 *
 * 覆盖：合法 start/end、displacement、zero movement、duration、非法 position / duration /
 *       displacement、start+displacement 归一化、输入不可变、结构校验、无 Velocity 字段。
 */

import { test, assert, assertEquals } from './harness.js';
import {
  createBallMovementState, validateBallMovementState, isBallMovementState,
  BALL_MOVEMENT_STATE_SOURCE, BALL_MOVEMENT_STATE_RULE_VERSION, BALL_MOVEMENT_STATE_REASON,
} from '../src/core/match/ball-movement-state.js';

const R = BALL_MOVEMENT_STATE_REASON;
const build = (o) => createBallMovementState(o);

test('MS-1. 合法 start/end → ok 且 start/end 正确', () => {
  const s = build({ startPosition: { x: 0.4, y: 0.5 }, endPosition: { x: 0.6, y: 0.5 }, duration: 1 });
  assertEquals(s.ok, true);
  assertEquals(s.startPosition, { x: 0.4, y: 0.5 });
  assertEquals(s.endPosition, { x: 0.6, y: 0.5 });
  assertEquals(s.source, BALL_MOVEMENT_STATE_SOURCE);
  assertEquals(s.ruleVersion, BALL_MOVEMENT_STATE_RULE_VERSION);
  assertEquals(validateBallMovementState(s).valid, true);
  assertEquals(isBallMovementState(s), true);
});

test('MS-2. displacement = endPosition - startPosition', () => {
  const s = build({ startPosition: { x: 0.75, y: 0.5 }, endPosition: { x: 1.0, y: 0.5 }, duration: 1 });
  assertEquals(s.displacement, { x: 0.25, y: 0 });
  const s2 = build({ startPosition: { x: 0.5, y: 0.75 }, endPosition: { x: 0.25, y: 0.25 }, duration: 2 });
  assertEquals(s2.displacement, { x: -0.25, y: -0.5 });
});

test('MS-3. zero movement（start === end）合法', () => {
  const s = build({ startPosition: { x: 0.5, y: 0.5 }, endPosition: { x: 0.5, y: 0.5 }, duration: 1 });
  assertEquals(s.ok, true);
  assertEquals(s.displacement, { x: 0, y: 0 });
  assertEquals(validateBallMovementState(s).valid, true);
});

test('MS-4. duration 合法（保留原值）', () => {
  const s = build({ startPosition: { x: 0.4, y: 0.5 }, endPosition: { x: 0.6, y: 0.5 }, duration: 0.25 });
  assertEquals(s.duration, 0.25);
});

test('MS-5. 非法 position → INVALID_POSITION', () => {
  assertEquals(build({ endPosition: { x: 0.6, y: 0.5 }, duration: 1 }).reason, R.INVALID_POSITION);
  assertEquals(build({ startPosition: { x: 'a', y: 0.5 }, endPosition: { x: 0.6, y: 0.5 }, duration: 1 }).reason, R.INVALID_POSITION);
  assertEquals(build({ startPosition: { x: 0.4, y: 0.5 }, endPosition: { x: NaN, y: 0.5 }, duration: 1 }).reason, R.INVALID_POSITION);
  assertEquals(build({ startPosition: { x: 0.4, y: 0.5 }, duration: 1 }).reason, R.INVALID_POSITION);
});

test('MS-6. 非法 duration → INVALID_DURATION', () => {
  const p0 = { x: 0.4, y: 0.5 }; const p1 = { x: 0.6, y: 0.5 };
  assertEquals(build({ startPosition: p0, endPosition: p1 }).reason, R.INVALID_DURATION);
  assertEquals(build({ startPosition: p0, endPosition: p1, duration: 0 }).reason, R.INVALID_DURATION);
  assertEquals(build({ startPosition: p0, endPosition: p1, duration: -1 }).reason, R.INVALID_DURATION);
  assertEquals(build({ startPosition: p0, endPosition: p1, duration: 'x' }).reason, R.INVALID_DURATION);
});

test('MS-7. displacement 与 start/end 不一致 → INVALID_DISPLACEMENT', () => {
  const r = build({
    startPosition: { x: 0.4, y: 0.5 }, endPosition: { x: 0.6, y: 0.5 },
    displacement: { x: 0.1, y: 0 }, duration: 1,
  });
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.INVALID_DISPLACEMENT);
});

test('MS-7b. start + displacement 归一化为 start/end/displacement', () => {
  const s = build({ startPosition: { x: 0.25, y: 0.5 }, displacement: { x: 0.25, y: 0 }, duration: 1 });
  assertEquals(s.ok, true);
  assertEquals(s.endPosition, { x: 0.5, y: 0.5 });
  assertEquals(s.displacement, { x: 0.25, y: 0 });
  // displacement 非点
  assertEquals(build({ startPosition: { x: 0.4, y: 0.5 }, displacement: { x: 'a', y: 0 }, duration: 1 }).reason, R.INVALID_DISPLACEMENT);
});

test('MS-8. 输入不可变', () => {
  const input = { startPosition: { x: 0.4, y: 0.5 }, endPosition: { x: 0.6, y: 0.5 }, duration: 1 };
  const snap = JSON.stringify(input);
  build(input);
  assertEquals(JSON.stringify(input), snap);
});

test('MS-9/10. validate：合法通过；未知字段（如 velocity）被拒', () => {
  const s = build({ startPosition: { x: 0.4, y: 0.5 }, endPosition: { x: 0.6, y: 0.5 }, duration: 1 });
  assertEquals(validateBallMovementState(s).valid, true);

  const withVel = { ...s, velocity: { x: 0.2, y: 0 } };
  const v = validateBallMovementState(withVel);
  assertEquals(v.valid, false);
  assert(v.issues.includes('UNKNOWN_FIELD:velocity'));
  assertEquals(v.reason, R.INVALID_MOVEMENT_STATE);
});

test('MS-11. validate：displacement 自洽性校验', () => {
  const s = build({ startPosition: { x: 0.4, y: 0.5 }, endPosition: { x: 0.6, y: 0.5 }, duration: 1 });
  const bad = { ...s, displacement: { x: 9, y: 9 } };
  const v = validateBallMovementState(bad);
  assertEquals(v.valid, false);
  assertEquals(v.reason, R.INVALID_DISPLACEMENT);
});

test('MS-12. State Schema 不含 velocity / acceleration / spin / force / collision', () => {
  const s = build({ startPosition: { x: 0.4, y: 0.5 }, endPosition: { x: 0.6, y: 0.5 }, duration: 1 });
  for (const k of ['velocity', 'acceleration', 'spin', 'curve', 'force', 'collision']) {
    assert(!(k in s), `State 不得含 ${k}`);
  }
});