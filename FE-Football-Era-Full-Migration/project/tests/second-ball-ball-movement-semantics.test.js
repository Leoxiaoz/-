/**
 * Step 39F-M-C-31 —— SECOND_BALL Ball Movement Semantics 测试。
 *
 * 覆盖：每个实际 outcome 的语义、unknown 不静默归类、不含 duration/velocity/transit、
 * 确定性、只读不可变、Source Guard（不调 C-05/C-06/C-07 Resolution/C-08/C-23/C-29/C-30）。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  getSecondBallBallMovementSemantics,
  SECOND_BALL_POSITION_SEMANTICS,
  SECOND_BALL_OUTCOME_POSITION_SEMANTICS,
  SECOND_BALL_BALL_MOVEMENT_SEMANTICS_SOURCE,
  SECOND_BALL_BALL_MOVEMENT_SEMANTICS_RULE_VERSION,
} from '../src/core/match/second-ball-ball-movement-semantics.js';
import { SECOND_BALL_OUTCOMES } from '../src/core/match/second-ball-resolution-config.js';

const SEM = SECOND_BALL_POSITION_SEMANTICS;
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '../src/core/match/second-ball-ball-movement-semantics.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ===========================================================================
// 1. 每个实际 outcome 的语义
// ===========================================================================

test('C31-01. WON → NO_POSITION_CHANGE', () => {
  const r = getSecondBallBallMovementSemantics(SECOND_BALL_OUTCOMES.WON);
  assertEquals(r.ok, true);
  assertEquals(r.actionType, 'SECOND_BALL');
  assertEquals(r.semantics, SEM.NO_POSITION_CHANGE);
  assertEquals(r.source, SECOND_BALL_BALL_MOVEMENT_SEMANTICS_SOURCE);
  assertEquals(r.ruleVersion, SECOND_BALL_BALL_MOVEMENT_SEMANTICS_RULE_VERSION);
});

test('C31-02. NO_WINNER → NO_POSITION_CHANGE', () => {
  assertEquals(getSecondBallBallMovementSemantics(SECOND_BALL_OUTCOMES.NO_WINNER).semantics, SEM.NO_POSITION_CHANGE);
});

test('C31-03. INVALID → NO_POSITION_CHANGE', () => {
  assertEquals(getSecondBallBallMovementSemantics(SECOND_BALL_OUTCOMES.INVALID).semantics, SEM.NO_POSITION_CHANGE);
});

test('C31-04. 所有实际 outcome 均有明确结论（无遗漏）', () => {
  const all = Object.values(SECOND_BALL_OUTCOMES);
  assert(all.length >= 3, 'SECOND_BALL_OUTCOMES 非空');
  for (const o of all) {
    const r = getSecondBallBallMovementSemantics(o);
    assertEquals(r.ok, true, `${o} 应有明确语义`);
    assertEquals(r.semantics, SEM.NO_POSITION_CHANGE);
  }
  assertEquals(Object.keys(SECOND_BALL_OUTCOME_POSITION_SEMANTICS).sort(), [...all].sort());
});

// ===========================================================================
// 2. Unknown outcome 不得静默归类
// ===========================================================================

test('C31-05. 未知 outcome → UNDEFINED（不得默认 NO_POSITION_CHANGE / INSTANT）', () => {
  for (const o of ['SECOND_BALL_UNKNOWN', 'FOO', 'INSTANT', 'WON']) {
    const r = getSecondBallBallMovementSemantics(o);
    assertEquals(r.ok, false, `${o} 不应被识别`);
    assertEquals(r.reason, SEM.UNDEFINED);
    assertEquals(r.semantics, undefined);
  }
});

test('C31-06. 非字符串 / null / undefined → UNDEFINED', () => {
  for (const o of [null, undefined, 42, {}, [], true]) {
    const r = getSecondBallBallMovementSemantics(o);
    assertEquals(r.ok, false);
    assertEquals(r.reason, SEM.UNDEFINED);
  }
});

// ===========================================================================
// 3. 语义值本身不得是 INSTANT / CONTINUOUS / duration
// ===========================================================================

test('C31-07. 语义不是 INSTANT / CONTINUOUS，且不含 duration 概念', () => {
  for (const o of Object.values(SECOND_BALL_OUTCOMES)) {
    const s = getSecondBallBallMovementSemantics(o).semantics;
    assert(s !== 'INSTANT' && s !== 'CONTINUOUS', `${o} 不应是 INSTANT/CONTINUOUS`);
    assert(s === 'NO_POSITION_CHANGE');
  }
});

// ===========================================================================
// 4. 输出契约 / 确定性 / 不可变
// ===========================================================================

test('C31-08. 输出不含 position / duration / velocity / transit / movementState', () => {
  const r = getSecondBallBallMovementSemantics(SECOND_BALL_OUTCOMES.WON);
  for (const k of ['position', 'duration', 'velocity', 'transit', 'trajectory', 'movementState', 'physics']) {
    assertEquals(r[k], undefined, `输出不应含 ${k}`);
  }
});

test('C31-09. 确定性：相同输入 → 相同输出', () => {
  const a = JSON.stringify(getSecondBallBallMovementSemantics(SECOND_BALL_OUTCOMES.WON));
  const b = JSON.stringify(getSecondBallBallMovementSemantics(SECOND_BALL_OUTCOMES.WON));
  assertEquals(a, b);
});

test('C31-10. 不修改全局映射（只读）', () => {
  const snap = JSON.stringify(SECOND_BALL_OUTCOME_POSITION_SEMANTICS);
  getSecondBallBallMovementSemantics(SECOND_BALL_OUTCOMES.WON);
  getSecondBallBallMovementSemantics('UNKNOWN');
  assertEquals(JSON.stringify(SECOND_BALL_OUTCOME_POSITION_SEMANTICS), snap);
  assert(Object.isFrozen(SECOND_BALL_OUTCOME_POSITION_SEMANTICS));
  assert(Object.isFrozen(SECOND_BALL_POSITION_SEMANTICS));
});

// ===========================================================================
// 5. Source Guard
// ===========================================================================

test('C31-11. 不调用 C-05 / C-06 / C-07 Resolution / C-08 / C-23 / C-29 / C-30', () => {
  assert(!/from '\.\/second-ball-resolution\.js'/.test(SRC), '不得依赖 C-07 Resolution');
  assert(!/from '\.\/interaction-state-update\.js'/.test(SRC), '不得依赖 C-05 Mutation');
  assert(!/from '\.\/interaction-integration\.js'/.test(SRC), '不得依赖 C-06 Integration');
  assert(!/from '\.\/match-tick\.js'/.test(SRC), '不得依赖 C-08 Tick');
  assert(!/from '\.\/ball-movement-integration\.js'|from '\.\/ball-movement-state\.js'/.test(SRC));
  assert(!/from '\.\/instant-ball-position-integration\.js'/.test(SRC), '不得依赖 C-29');
  assert(!/from '\.\/interaction-ball-transit\.js'|from '\.\/action-ball-movement-state\.js'/.test(SRC));
  assert(!/resolveSecondBall|applyInteractionStateUpdate|integrateInteractionResolution/.test(SRC));
  assert(!/applyInstantBallPositionUpdate|applyBallMovementPositionUpdate/.test(SRC));
});

test('C31-12. 不产生 Movement State / Transit / Duration / Velocity / Physics；无 random·wall clock', () => {
  assert(!/duration\s*[:=]/.test(SRC));
  assert(!/transit\s*[:=]/.test(SRC));
  assert(!/velocity\s*[:=]/i.test(SRC));
  assert(!/trajectory|physics|collision|acceleration|spin|curve|gravity|bounce/i.test(SRC));
  assert(!/Math\.random\s*\(/.test(SRC));
  assert(!/Date\.now\s*\(/.test(SRC) && !/new\s+Date\s*\(/.test(SRC) && !/performance\.now\s*\(/.test(SRC));
});