/**
 * Step 39F-M-C-16 —— Ball Movement Segment / Tick Position Snapshot 测试。
 *
 * 覆盖：静止 / 水平 / 垂直 / 斜向 / 边界 / 非法 / 缺失 / 不可变 / 引用安全 /
 * 确定性 / 值快照 / state 快照 / 零与非零距离 / 校验 / guard / 架构 / 适配器。
 *
 * 红线：不实现 Ball Physics；不改 MatchCore Schema；不改 C-04~C-15；无 Math.random / 墙钟。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  deriveBallTickSegment, validateBallTickSegment, hasBallMovement, runMatchTickWithBallSegment,
  BALL_SEGMENT_REASON, BALL_SEGMENT_SOURCE, BALL_TICK_SEGMENT_RULE_VERSION,
} from '../src/core/match/ball-tick-segment.js';
import { INTERACTION_BALL_STATE as BS } from '../src/core/match/interaction-resolution-config.js';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const H = 'clb_h', A = 'clb_a';
const mk = (id, t) => ({
  playerId: id, teamId: t, position: 'MF', positionOnPitch: { x: 0.5, y: 0.5 },
  onPitch: true, injured: false, sentOff: false,
  attributes: { pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70 },
  fitness: 100, form: 50, morale: 50, matchLoad: 0,
});
const tac = () => ({ formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' });
function core(x, y, state = BS.IN_TRANSIT) {
  return {
    worldId: 'w_bs16', season: 1, matchId: 'm_bs16', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball: { position: { x, y }, control: null, possessingTeamId: H, velocity: { x: 0, y: 0 }, state },
    players: [mk('h_a', H), mk('a_a', A)],
    tactical: { [H]: tac(), [A]: tac() },
  };
}
const seg = (p0, p1, s0 = BS.IN_TRANSIT, s1 = BS.IN_TRANSIT) =>
  deriveBallTickSegment(core(p0[0], p0[1], s0), core(p1[0], p1[1], s1));
const EPS = 1e-9;
const near = (a, b) => Math.abs(a - b) < EPS;
const nearPoint = (p, x, y, msg) => assert(near(p.x, x) && near(p.y, y), msg ?? `点不符: ${JSON.stringify(p)} vs (${x},${y})`);

// ===========================================================================
// Case A / 1 / 14：静止
// ===========================================================================

test('BS-01. 静止球：moved=false, distance=0 (Case A / zero-distance)', () => {
  const s = seg([0.5, 0.5], [0.5, 0.5]);
  assertEquals(s.ok, true);
  assertEquals(s.moved, false);
  assertEquals(s.distance, 0);
  assertEquals(s.displacement, { x: 0, y: 0 });
  assertEquals(hasBallMovement(s), false);
});

// ===========================================================================
// Case B / 2 / 15：水平 / 非零距离
// ===========================================================================

test('BS-02. 水平移动：distance=0.2 (Case B / non-zero-distance)', () => {
  const s = seg([0.4, 0.5], [0.6, 0.5]);
  assertEquals(s.moved, true);
  assertEquals(near(s.distance, 0.2), true);
  nearPoint(s.displacement, 0.2, 0);
  assertEquals(hasBallMovement(s), true);
  assertEquals(validateBallTickSegment(s), { valid: true, issues: [] });
});

// ===========================================================================
// Case C / 3 / 4：垂直 / 斜向
// ===========================================================================

test('BS-03. 垂直移动', () => {
  const s = seg([0.5, 0.2], [0.5, 0.7]);
  nearPoint(s.displacement, 0, 0.5);
  assertEquals(near(s.distance, 0.5), true);
});

test('BS-04. 斜向移动（3-4-5）', () => {
  const s = seg([0.1, 0.1], [0.4, 0.5]);
  nearPoint(s.displacement, 0.3, 0.4);
  assertEquals(near(s.distance, 0.5), true);
});

// ===========================================================================
// Case D / 5：边界位置
// ===========================================================================

test('BS-05. 边界位置 x/y ∈ {0,1}', () => {
  for (const [a, b] of [[[0, 0], [1, 1]], [[0, 1], [1, 0]], [[0, 0.5], [1, 0.5]]]) {
    const s = seg(a, b);
    assertEquals(s.ok, true, `应接受边界 ${JSON.stringify([a, b])}`);
    assertEquals(validateBallTickSegment(s).valid, true);
  }
});

// ===========================================================================
// Case E / 6 / Case F / 7：非法 / 缺失
// ===========================================================================

test('BS-06. 非法坐标被拒绝（NaN / Infinity）', () => {
  assertEquals(deriveBallTickSegment(core(NaN, 0.5), core(0.6, 0.5)).reason, BALL_SEGMENT_REASON.INVALID_POSITION);
  assertEquals(deriveBallTickSegment(core(0.4, 0.5), core(Infinity, 0.5)).reason, BALL_SEGMENT_REASON.INVALID_POSITION);
  // 不得生成 ok:true。
  assertEquals(deriveBallTickSegment(core(0.4, 0.5), core(undefined, 0.5)).ok, false);
});

test('BS-07. Ball Position 缺失被拒绝', () => {
  const noPos = core(0.5, 0.5); delete noPos.ball.position;
  assertEquals(deriveBallTickSegment(noPos, core(0.5, 0.5)).reason, BALL_SEGMENT_REASON.MISSING_BALL_POSITION);
  assertEquals(deriveBallTickSegment(core(0.5, 0.5), noPos).reason, BALL_SEGMENT_REASON.MISSING_BALL_POSITION);
  const noBall = core(0.5, 0.5); delete noBall.ball;
  assertEquals(deriveBallTickSegment(noBall, core(0.5, 0.5)).reason, BALL_SEGMENT_REASON.MISSING_BALL_POSITION);
  assertEquals(deriveBallTickSegment(null, core(0.5, 0.5)).reason, BALL_SEGMENT_REASON.INVALID_START_MATCORE);
});

// ===========================================================================
// 8 / 11 / 12：不可变 + 值快照
// ===========================================================================

test('BS-08. 输入 MatchCore 不被修改', () => {
  const a = core(0.4, 0.5); const b = core(1.05, 0.5);
  const sa = JSON.stringify(a); const sb = JSON.stringify(b);
  deriveBallTickSegment(a, b);
  assertEquals(JSON.stringify(a), sa);
  assertEquals(JSON.stringify(b), sb);
});

test('BS-11/12. start / end 为值快照，不随原 MatchCore 改变', () => {
  const a = core(0.4, 0.5); const b = core(0.6, 0.5);
  const s = deriveBallTickSegment(a, b);
  a.ball.position.x = 9; b.ball.position.x = 9;   // 篡改来源
  assertEquals(s.start, { x: 0.4, y: 0.5 }, 'start 快照不得改变');
  assertEquals(s.end, { x: 0.6, y: 0.5 }, 'end 快照不得改变');
  nearPoint(s.displacement, 0.2, 0);
});

// ===========================================================================
// 9：引用安全
// ===========================================================================

test('BS-09. 无 Ball 对象引用泄漏', () => {
  const a = core(0.4, 0.5); const b = core(0.6, 0.5);
  const s = deriveBallTickSegment(a, b);
  assert(s.start !== a.ball.position, 'start 不得与 ball.position 共享引用');
  assert(s.end !== b.ball.position, 'end 不得与 ball.position 共享引用');
  assert(s.start !== b.ball.position && s.end !== a.ball.position);
  assert(s !== a.ball && typeof s.start === 'object');
});

// ===========================================================================
// 13：state 快照
// ===========================================================================

test('BS-13. ballStateAtStart / ballStateAtEnd 正确', () => {
  const s = seg([0.4, 0.5], [0.6, 0.5], BS.FREE, BS.IN_TRANSIT);
  assertEquals(s.ballStateAtStart, BS.FREE);
  assertEquals(s.ballStateAtEnd, BS.IN_TRANSIT);
  const s2 = deriveBallTickSegment(core(0.4, 0.5), core(0.6, 0.5));
  assertEquals(s2.ballStateAtStart, BS.IN_TRANSIT);
});

// ===========================================================================
// 10：确定性 + guard
// ===========================================================================

test('BS-10. 确定性输出', () => {
  const a = seg([0.2, 0.3], [0.7, 0.9]);
  const b = seg([0.2, 0.3], [0.7, 0.9]);
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

test('BS-16. 无 Math.random', () => {
  assert(!/Math\.random\s*\(/.test(readSrc('ball-tick-segment.js')));
});

test('BS-17. 无 wall clock', () => {
  const s = readSrc('ball-tick-segment.js');
  assert(!/Date\.now\s*\(/.test(s) && !/performance\.now\s*\(/.test(s) && !/new\s+Date\s*\(/.test(s));
});

// ===========================================================================
// 校验 / 架构 / 适配器
// ===========================================================================

test('BS-18. validateBallTickSegment 拒绝非法 Segment', () => {
  const good = seg([0.4, 0.5], [0.6, 0.5]);
  assertEquals(validateBallTickSegment(good), { valid: true, issues: [] });
  const bad = [
    { ...good, source: 'X' },
    { ...good, ruleVersion: 'x' },
    { ...good, distance: -1 },
    { ...good, displacement: { x: 9, y: 9 } },
    { ...good, moved: 'yes' },
    { ...good, extra: 1 },
    null,
  ];
  for (const r of bad) assertEquals(validateBallTickSegment(r).valid, false, `应拒绝: ${JSON.stringify(r)}`);
});

test('BS-19. 无 Ball Physics 实现', () => {
  // 去除注释后再扫描，仅检查实际实现。
  const code = readSrc('ball-tick-segment.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const banned of ['acceleration', 'gravity', 'friction', 'drag', 'bounce', 'spin', 'curve',
    'collision', 'ballRadius', 'integr', 'trajectory', 'interpolat']) {
    assert(!new RegExp(banned, 'i').test(code), `不得实现 ${banned}`);
  }
  // 不建第二套 Ball Position Truth。
  assert(!/previousBallPosition|lastBallPosition|ballPositionHistory|authoritativeBallPosition/.test(code));
  // 不修改 MatchCore Schema。
  assert(!/ball\.(previousPosition|tickStartPosition|segment)\s*=/.test(code));
});

test('BS-20. 集成：极薄适配器复用 C-08 runMatchTick（不重写 Tick 编排）', () => {
  const code = readSrc('ball-tick-segment.js');
  assert(/import\s*\{\s*runMatchTick\s*\}/.test(code), '必须复用 runMatchTick');
  assert(!/from '\.\/match-ticks\.js'/.test(code), '不得依赖 C-10 runMatchTicks');
  // 实际运行一次 Tick 边界适配。
  const mc = core(0.4, 0.5, BS.CONTROLLED);
  mc.ball.control = 'h_a';
  const out = runMatchTickWithBallSegment(mc, { tickIndex: 0 }, {});
  assertEquals(out.segment.ok, true);
  assertEquals(out.segment.tickIndex, 0);
  assertEquals(out.segment.source, BALL_SEGMENT_SOURCE);
  assertEquals(out.segment.ruleVersion, BALL_TICK_SEGMENT_RULE_VERSION);
  assertEquals(out.segment.start, { x: 0.4, y: 0.5 }, 'P0 = Tick 起始 ball.position');
  assert(out.segment.end.x >= 0 && out.segment.end.x <= 1, 'P1 取自 Tick 结束 ball.position');
  // 适配器不修改输入 MatchCore。
  assertEquals(mc.ball.position, { x: 0.4, y: 0.5 });
});

test('BS-21. hasBallMovement 语义', () => {
  assertEquals(hasBallMovement(seg([0.5, 0.5], [0.5, 0.5])), false);
  assertEquals(hasBallMovement(seg([0.5, 0.5], [0.5001, 0.5])), true);
  assertEquals(hasBallMovement({ ok: false }), false);
  assertEquals(hasBallMovement(null), false);
});