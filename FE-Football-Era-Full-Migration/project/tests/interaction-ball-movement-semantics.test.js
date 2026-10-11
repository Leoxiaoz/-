/**
 * Step 39F-M-C-27 —— Interaction Ball Movement Semantics 测试。
 *
 * 覆盖：四类 Interaction 显式语义 / 未知类型不静默归类 / 枚举区分 /
 * 不产生 duration·velocity·physics·movement state / 不调用 C-23·C-24·C-25 /
 * 无 random·wall clock / 只读性与不可变性 / 架构 Source Guard。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BALL_MOVEMENT_SEMANTICS,
  INTERACTION_BALL_MOVEMENT_SEMANTICS,
  INTERACTION_BALL_MOVEMENT_SEMANTICS_REASON,
  INTERACTION_BALL_MOVEMENT_SEMANTICS_SOURCE,
  INTERACTION_BALL_MOVEMENT_SEMANTICS_RULE_VERSION,
  resolveInteractionBallMovementSemantics,
  getAllInteractionBallMovementSemantics,
} from '../src/core/match/interaction-ball-movement-semantics.js';

const S = BALL_MOVEMENT_SEMANTICS;
const R = INTERACTION_BALL_MOVEMENT_SEMANTICS_REASON;
const TYPES = ['DRIBBLE', 'TACKLE', 'PRESS', 'INTERCEPTION'];

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '../src/core/match/interaction-ball-movement-semantics.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ===========================================================================
// 显式语义（每个已审查类型都有明确枚举结果）
// ===========================================================================

test('C27-01. DRIBBLE 语义显式冻结为 INSTANT', () => {
  const r = resolveInteractionBallMovementSemantics('DRIBBLE');
  assertEquals(r.ok, true);
  assertEquals(r.semantics, S.INSTANT);
  assertEquals(r.reason, null);
});

test('C27-02. TACKLE 语义显式冻结为 INSTANT', () => {
  assertEquals(resolveInteractionBallMovementSemantics('TACKLE').semantics, S.INSTANT);
});

test('C27-03. PRESS 语义显式冻结为 INSTANT', () => {
  assertEquals(resolveInteractionBallMovementSemantics('PRESS').semantics, S.INSTANT);
});

test('C27-04. INTERCEPTION 语义显式冻结为 INSTANT', () => {
  assertEquals(resolveInteractionBallMovementSemantics('INTERCEPTION').semantics, S.INSTANT);
});

test('C27-05. 四类 Interaction 在冻结映射中均有明确枚举结果', () => {
  for (const t of TYPES) {
    const r = resolveInteractionBallMovementSemantics(t);
    assertEquals(r.ok, true, `期望 ${t} 有显式语义`);
    assert(r.semantics === S.INSTANT || r.semantics === S.CONTINUOUS || r.semantics === S.BLOCKED);
  }
  assertEquals(Object.keys(getAllInteractionBallMovementSemantics()).sort(), [...TYPES].sort());
});

// ===========================================================================
// 未知 / 非法输入：不静默归类
// ===========================================================================

test('C27-06. 未审查 Interaction 类型 → BLOCKED + UNDEFINED（绝不静默归为 INSTANT）', () => {
  for (const t of ['MOVE', 'PASS', 'SHOT', 'FOUL', 'SECOND_BALL', 'UNKNOWN']) {
    const r = resolveInteractionBallMovementSemantics(t);
    assertEquals(r.ok, false);
    assertEquals(r.semantics, S.BLOCKED);
    assertEquals(r.reason, R.INTERACTION_BALL_MOVEMENT_SEMANTICS_UNDEFINED);
  }
});

test('C27-07. 非法输入（null/undefined/number/空串）→ BLOCKED + INVALID_ACTION_TYPE', () => {
  for (const t of [null, undefined, 0, 123, '', {}]) {
    const r = resolveInteractionBallMovementSemantics(t);
    assertEquals(r.ok, false);
    assertEquals(r.semantics, S.BLOCKED);
    assertEquals(r.reason, R.INVALID_ACTION_TYPE);
  }
});

// ===========================================================================
// 枚举区分：INSTANT 与 CONTINUOUS 不混淆
// ===========================================================================

test('C27-08. INSTANT / CONTINUOUS / BLOCKED 三个枚举值互不相等', () => {
  assertEquals(S.INSTANT === S.CONTINUOUS, false);
  assertEquals(S.INSTANT === S.BLOCKED, false);
  assertEquals(S.CONTINUOUS === S.BLOCKED, false);
  assertEquals([S.INSTANT, S.CONTINUOUS, S.BLOCKED].sort(), ['BLOCKED', 'CONTINUOUS', 'INSTANT']);
});

test('C27-09. 本 Gate 决策：无任何 Interaction 被判定为 CONTINUOUS', () => {
  const m = getAllInteractionBallMovementSemantics();
  for (const t of TYPES) assertEquals(m[t], S.INSTANT);
  assertEquals(Object.values(m).includes(S.CONTINUOUS), false);
});

test('C27-10. provenance 恒定（source / ruleVersion）', () => {
  const r = resolveInteractionBallMovementSemantics('DRIBBLE');
  assertEquals(r.source, INTERACTION_BALL_MOVEMENT_SEMANTICS_SOURCE);
  assertEquals(r.ruleVersion, INTERACTION_BALL_MOVEMENT_SEMANTICS_RULE_VERSION);
  assertEquals(r.source, 'INTERACTION_BALL_MOVEMENT_SEMANTICS');
  assertEquals(r.ruleVersion, 'interaction-ball-movement-semantics-v1');
});

// ===========================================================================
// 不产生 duration / velocity / physics / movement state
// ===========================================================================

test('C27-11. 返回值不含 duration / velocity / physics / movementState 字段', () => {
  for (const t of TYPES) {
    const r = resolveInteractionBallMovementSemantics(t);
    assertEquals(r.duration, undefined);
    assertEquals(r.velocity, undefined);
    assertEquals(r.physics, undefined);
    assertEquals(r.movementState, undefined);
    assertEquals(r.transit, undefined);
  }
});

test('C27-12. 冻结映射只含字符串枚举，不含数值 duration', () => {
  for (const [k, v] of Object.entries(INTERACTION_BALL_MOVEMENT_SEMANTICS)) {
    assertEquals(typeof v, 'string', `${k} 语义必须为字符串枚举`);
    assertEquals(typeof v === 'number', false);
  }
});

// ===========================================================================
// 只读性 / 不可变性
// ===========================================================================

test('C27-13. 冻结映射不可被外部篡改；getAll 返回副本', () => {
  const snapshot = { ...INTERACTION_BALL_MOVEMENT_SEMANTICS };
  try { INTERACTION_BALL_MOVEMENT_SEMANTICS.DRIBBLE = 'CONTINUOUS'; } catch { /* frozen 会抛 */ }
  assertEquals(INTERACTION_BALL_MOVEMENT_SEMANTICS.DRIBBLE, snapshot.DRIBBLE);

  const copy = getAllInteractionBallMovementSemantics();
  copy.DRIBBLE = 'CONTINUOUS';
  assertEquals(INTERACTION_BALL_MOVEMENT_SEMANTICS.DRIBBLE, snapshot.DRIBBLE);
  assertEquals(resolveInteractionBallMovementSemantics('DRIBBLE').semantics, snapshot.DRIBBLE);
});

// ===========================================================================
// 架构 Source Guard
// ===========================================================================

test('C27-14. 无 duration 赋值 / 无 velocity·physics·collision·integration', () => {
  assert(!/duration\s*[:=]/.test(SRC));
  assert(!/velocity\s*[:=]/i.test(SRC));
  assert(!/physics|collision|acceleration|spin|curve|gravity|bounce/i.test(SRC));
  assert(!/createBallMovementState|MovementState\s*=/i.test(SRC));
});

test('C27-15. 不调用 C-23 / C-24 / C-25，不写 MatchCore / Ball Position', () => {
  assert(!/from '\.\/interaction-ball-transit\.js'/.test(SRC));
  assert(!/from '\.\/action-ball-movement-state\.js'/.test(SRC));
  assert(!/from '\.\/ball-movement-state\.js'/.test(SRC));
  assert(!/from '\.\/ball-movement-integration\.js'/.test(SRC));
  assert(!/applyBallMovementPositionUpdate|deriveInteractionBallTransit|deriveBallMovementStateFromAction/.test(SRC));
  assert(!/matchCore|\.ball\.position\s*=/.test(SRC));
});

test('C27-16. 无 random / wall clock', () => {
  assert(!/Math\.random\s*\(/.test(SRC));
  assert(!/Date\.now\s*\(/.test(SRC) && !/new\s+Date\s*\(/.test(SRC) && !/performance\.now\s*\(/.test(SRC));
});