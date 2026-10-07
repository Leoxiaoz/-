/**
 * Step 39F-M-C-15 —— Goal-Line / Goal Geometry Foundation 测试。
 *
 * 覆盖 GL-01…GL-21 + 链路闭合：穿越检测 / 方向约束 / 门框范围 / 边界与容差 /
 * 纯几何 / 候选生成 / C-14 消费 / 不可变 / guard / Architecture。
 *
 * 红线：不实现 Ball Physics / GK / Shot；不改 C-04~C-14；无 Math.random / 墙钟。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  deriveGoalGeometry, detectGoalLineCrossing, intersectSegmentWithVerticalLine,
  isPointInsideGoalMouth, createGoalCandidateFromCrossing,
} from '../src/core/match/goal-geometry.js';
import {
  GOAL_CROSSING_REASON, GOAL_MOUTH_Y_MIN, GOAL_MOUTH_Y_MAX, GEOMETRY_EPSILON,
} from '../src/core/match/goal-geometry-config.js';
import { isGoalCandidate, resolveGoal, applyGoalScoreUpdate } from '../src/core/match/goal-resolution.js';
import { finalizeMatch } from '../src/core/match/match-result.js';
import { createInitialMatchClock, advanceMatchClock } from '../src/core/match/match-clock.js';
import { MATCH_CLOCK_CONFIG } from '../src/core/match/match-clock-config.js';
import { INTERACTION_BALL_STATE as BS } from '../src/core/match/interaction-resolution-config.js';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');
const REG = MATCH_CLOCK_CONFIG.REGULATION_DURATION_SECONDS;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const H = 'clb_h', A = 'clb_a';
const CY = 0.5; // 门中心（复用 shot 几何）
function core(ballState = BS.IN_TRANSIT, scoreHome = 0, scoreAway = 0) {
  return {
    worldId: 'w_gg15', season: 1, matchId: 'm_gg15', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 20, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: scoreHome, away: scoreAway },
    ball: { position: { x: 0.9, y: 0.5 }, control: null, possessingTeamId: H, velocity: { x: 0.05, y: 0 }, state: ballState, lastTouchPlayerId: 'h_a' },
    players: [{ playerId: 'h_a', teamId: H, position: 'FW', positionOnPitch: { x: 0.9, y: 0.5 }, onPitch: true, injured: false, sentOff: false, attributes: {}, fitness: 100, form: 50, morale: 50, matchLoad: 0 }],
    tactical: { [H]: {}, [A]: {} },
  };
}
const GEO = () => deriveGoalGeometry(core());
const leftCross = () => detectGoalLineCrossing({ x: 0.2, y: CY }, { x: -0.05, y: CY }, GEO());
const rightCross = () => detectGoalLineCrossing({ x: 0.8, y: CY }, { x: 1.05, y: CY }, GEO());
const completePhase = () => ({ phase: 'REGULATION_COMPLETE', elapsedSeconds: 5400, half: 2, isBreak: false, isFinished: true });
const completeClock = () => advanceMatchClock(createInitialMatchClock(), REG);

// ===========================================================================
// GL-01 / GL-02 / GL-03：有效穿越
// ===========================================================================

test('GL-01. 有效左门穿越', () => {
  const r = leftCross();
  assertEquals(r.ok, true);
  assertEquals(r.crossed, true);
  assertEquals(r.goalSide, 'LEFT');
  assertEquals(r.scoringTeamId, A, '左门(x=0)由 away 得分');
  assertEquals(r.defendingTeamId, H);
  assertEquals(r.reason, GOAL_CROSSING_REASON.GOAL_LINE_CROSSED);
});

test('GL-02. 有效右门穿越', () => {
  const r = rightCross();
  assertEquals(r.crossed, true);
  assertEquals(r.goalSide, 'RIGHT');
  assertEquals(r.scoringTeamId, H, '右门(x=1)由 home 得分');
  assertEquals(r.defendingTeamId, A);
});

test('GL-03. 门框范围内穿越 → crossed=true', () => {
  const r = detectGoalLineCrossing({ x: 0.5, y: 0.45 }, { x: 1.1, y: 0.55 }, GEO());
  assertEquals(r.crossed, true);
  assert(r.crossingPoint.y >= GOAL_MOUTH_Y_MIN && r.crossingPoint.y <= GOAL_MOUTH_Y_MAX);
});

test('GL-04. 门框范围外穿越 → crossed=false', () => {
  const r = detectGoalLineCrossing({ x: 0.1, y: 0.1 }, { x: -0.05, y: 0.1 }, GEO());
  assertEquals(r.ok, true);
  assertEquals(r.crossed, false);
  assertEquals(r.reason, GOAL_CROSSING_REASON.NO_GOAL_LINE_CROSSING);
});

// ===========================================================================
// GL-05 / GL-06 / GL-07 / GL-08：方向与退化
// ===========================================================================

test('GL-05. 场内 → 球门外 → 可以形成 Crossing', () => {
  assertEquals(detectGoalLineCrossing({ x: 0.3, y: CY }, { x: -0.1, y: CY }, GEO()).crossed, true);
  assertEquals(detectGoalLineCrossing({ x: 0.7, y: CY }, { x: 1.1, y: CY }, GEO()).crossed, true);
});

test('GL-06. 球门外 → 场内 → 不形成 Goal（反向不算）', () => {
  assertEquals(detectGoalLineCrossing({ x: -0.1, y: CY }, { x: 0.3, y: CY }, GEO()).crossed, false);
  assertEquals(detectGoalLineCrossing({ x: 1.1, y: CY }, { x: 0.7, y: CY }, GEO()).crossed, false);
});

test('GL-07. 平行门线 → false', () => {
  assertEquals(detectGoalLineCrossing({ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.8 }, GEO()).crossed, false);
});

test('GL-08. P0 === P1 → false', () => {
  assertEquals(detectGoalLineCrossing({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, GEO()).crossed, false);
});

// ===========================================================================
// GL-09 / GL-10 / GL-11：非法 / 边界 / 交点
// ===========================================================================

test('GL-09. 非有限坐标 → reject', () => {
  for (const [a, b] of [[{ x: NaN, y: 0.5 }, { x: -0.1, y: 0.5 }], [{ x: 0.1, y: Infinity }, { x: -0.1, y: 0.5 }], [{ x: 0.1, y: 0.5 }, null]]) {
    const r = detectGoalLineCrossing(a, b, GEO());
    assertEquals(r.ok, false);
    assertEquals(r.reason, GOAL_CROSSING_REASON.INVALID_INPUT);
  }
});

test('GL-10. 门柱边界行为确定（inclusive）', () => {
  // 交点 y 恰为 yMin → 门内（inclusive）。
  const onPost = detectGoalLineCrossing({ x: 0.2, y: GOAL_MOUTH_Y_MIN }, { x: -0.2, y: GOAL_MOUTH_Y_MIN }, GEO());
  assertEquals(onPost.crossed, true, 'yMin 应视为门内（inclusive）');
  const onPostMax = detectGoalLineCrossing({ x: 0.2, y: GOAL_MOUTH_Y_MAX }, { x: -0.2, y: GOAL_MOUTH_Y_MAX }, GEO());
  assertEquals(onPostMax.crossed, true);
  // 明确超出（远超 epsilon）→ 门内判定为 false。
  const outside = detectGoalLineCrossing({ x: 0.2, y: GOAL_MOUTH_Y_MIN - 0.01 }, { x: -0.2, y: GOAL_MOUTH_Y_MIN - 0.01 }, GEO());
  assertEquals(outside.crossed, false);
  // isPointInsideGoalMouth 直接验证。
  assertEquals(isPointInsideGoalMouth({ x: 0, y: GOAL_MOUTH_Y_MIN }, { yMin: GOAL_MOUTH_Y_MIN, yMax: GOAL_MOUTH_Y_MAX }), true);
});

test('GL-11. crossingPoint 正确（与门线求交，非端点）', () => {
  // 对称：t=0.5 → y=0.5, x=0。
  const r = detectGoalLineCrossing({ x: 0.2, y: 0.5 }, { x: -0.2, y: 0.5 }, GEO());
  assertEquals(r.crossingPoint, { x: 0, y: 0.5 });
  // 斜线：t=0.75 → y=0.525。
  const s = detectGoalLineCrossing({ x: 0.3, y: 0.45 }, { x: -0.1, y: 0.55 }, GEO());
  const expT = (0 - 0.3) / (-0.1 - 0.3);
  assertEquals(s.crossingPoint.x, 0);
  assertEquals(Math.abs(s.crossingPoint.y - (0.45 + expT * 0.1)) < 1e-12, true);
  assert(s.crossingPoint.y !== -0.1, 'crossingPoint 不得等于端点 x');
  // 求交纯函数直接验证。
  assertEquals(intersectSegmentWithVerticalLine({ x: 0, y: 0 }, { x: 1, y: 1 }, 0.5), { x: 0.5, y: 0.5, t: 0.5 });
  assertEquals(intersectSegmentWithVerticalLine({ x: 0, y: 0 }, { x: 0, y: 1 }, 0), null); // 平行
});

// ===========================================================================
// GL-12 / GL-13：候选
// ===========================================================================

test('GL-12. Goal Candidate 正确生成', () => {
  const c = createGoalCandidateFromCrossing(rightCross(), core(BS.IN_TRANSIT), { playerId: 'h_a', goalId: 'g1' });
  assertEquals(c.ok, true);
  assertEquals(c.teamId, H);
  assertEquals(c.playerId, 'h_a');
  assertEquals(c.goalId, 'g1');
  assertEquals(c.source, 'GOAL_LINE_CROSSING');
  assertEquals(isGoalCandidate(c), true, '必须是 C-14 合法 Candidate');
  // 无穿越 → 无候选。
  assertEquals(createGoalCandidateFromCrossing(detectGoalLineCrossing({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, GEO()), core()).ok, false);
});

test('GL-12b. Ball State 约束：CONTROLLED 不可产生候选（Deferred）', () => {
  const c = createGoalCandidateFromCrossing(rightCross(), core(BS.CONTROLLED));
  assertEquals(c.ok, false);
  assertEquals(c.reason, GOAL_CROSSING_REASON.BALL_STATE_NOT_ELIGIBLE);
  // FREE / IN_TRANSIT 允许。
  assertEquals(createGoalCandidateFromCrossing(rightCross(), core(BS.FREE)).ok, true);
});

test('GL-13. Candidate 可以被 C-14 消费', () => {
  const c = createGoalCandidateFromCrossing(leftCross(), core(BS.FREE));
  const r = resolveGoal(c, core(BS.FREE), { phase: 'FIRST_HALF' });
  assertEquals(r.ok, true);
  assertEquals(r.outcome, 'GOAL_CONFIRMED');
  assertEquals(r.scoringSide, 'away');
});

// ===========================================================================
// GL-14 ~ GL-17：隔离 / 不可变
// ===========================================================================

test('GL-14. C-15 不直接修改 score', () => {
  const code = readSrc('goal-geometry.js');
  assert(!/\.score\s*(\+\+|[-+]?=|\.\w+\s*[-+]?=)/.test(code), 'C-15 不得写 score');
  assert(!/applyGoalScoreUpdate|home\s*\+=\s*1|away\s*\+=\s*1/.test(code), 'C-15 不得执行比分写入');
});

test('GL-15. C-15 不修改 Ball Truth', () => {
  const mc = core();
  const snap = JSON.stringify(mc.ball);
  const g = deriveGoalGeometry(mc);
  const r = detectGoalLineCrossing({ x: 0.8, y: 0.5 }, { x: 1.05, y: 0.5 }, g);
  createGoalCandidateFromCrossing(r, mc);
  assertEquals(JSON.stringify(mc.ball), snap);
});

test('GL-16/17. C-15 不修改 Clock / Phase（且不依赖其模块）', () => {
  const mc = core();
  const clkSnap = JSON.stringify(mc.clock);
  const phase = { phase: 'FIRST_HALF', elapsedSeconds: 10, half: 1, isBreak: false, isFinished: false };
  const pSnap = JSON.stringify(phase);
  const g = deriveGoalGeometry(mc);
  createGoalCandidateFromCrossing(detectGoalLineCrossing({ x: 0.8, y: 0.5 }, { x: 1.05, y: 0.5 }, g), mc);
  assertEquals(JSON.stringify(mc.clock), clkSnap);
  assertEquals(JSON.stringify(phase), pSnap);
  const code = readSrc('goal-geometry.js');
  assert(!/\.\/match-clock|\.\/match-phase/.test(code), 'C-15 不得依赖 Clock / Phase 模块');
});

// ===========================================================================
// GL-18 ~ GL-21：确定性 / guard / 架构
// ===========================================================================

test('GL-18. Determinism', () => {
  const a = detectGoalLineCrossing({ x: 0.8, y: 0.48 }, { x: 1.1, y: 0.52 }, GEO());
  const b = detectGoalLineCrossing({ x: 0.8, y: 0.48 }, { x: 1.1, y: 0.52 }, GEO());
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

test('GL-19. 无 Math.random', () => {
  for (const f of ['goal-geometry.js', 'goal-geometry-config.js']) {
    assert(!/Math\.random\s*\(/.test(readSrc(f)), `${f} 出现 Math.random`);
  }
});

test('GL-20. 无 wall clock', () => {
  for (const f of ['goal-geometry.js', 'goal-geometry-config.js']) {
    const s = readSrc(f);
    assert(!/Date\.now\s*\(/.test(s) && !/performance\.now\s*\(/.test(s) && !/new\s+Date\s*\(/.test(s), `${f} 依赖墙钟`);
  }
});

test('GL-21. Architecture / Truth audit', () => {
  const cfg = readSrc('goal-geometry-config.js');
  // 复用既有球门嘴几何与 Pitch，不新建第二套。
  assert(/shot-resolution-config/.test(cfg), '必须复用 shot 球门几何（不复制）');
  assert(/GOAL_CENTER_Y|GOAL_HALF_WIDTH/.test(cfg), '必须复用 GOAL_CENTER_Y/GOAL_HALF_WIDTH');
  const code = readSrc('goal-geometry.js');
  // 不实现球门物理 / GK / Shot。
  for (const banned of ['gravity', 'spin', 'bounce', 'friction', 'goalkeeper']) {
    assert(!new RegExp(banned, 'i').test(code), `不得实现 ${banned}`);
  }
  // 不建第二套 Ball / geometry truth 字段名。
  assert(!/goalBall|goalPhysicsBall|detectBall|secondGoalGeometry/.test(code));
  // 不新增永久 Schema 字段。
  assert(!/matchCore\.previousPosition\s*=/.test(code));
});

// ===========================================================================
// §26 链路闭合
// ===========================================================================

test('GL-22. 链路闭合：P0→P1→Crossing→Candidate→C-14 resolve→apply→score→C-13 Final', () => {
  const mc0 = core(BS.IN_TRANSIT, 0, 0);
  const geo = deriveGoalGeometry(mc0);
  const crossing = detectGoalLineCrossing({ x: 0.9, y: 0.5 }, { x: 1.06, y: 0.5 }, geo); // home 右门
  assertEquals(crossing.crossed, true);
  const candidate = createGoalCandidateFromCrossing(crossing, mc0, { playerId: 'h_a' });
  const resolution = resolveGoal(candidate, mc0, { phase: 'FIRST_HALF' });
  const updated = applyGoalScoreUpdate(mc0, resolution);
  assertEquals(updated.score, { home: 1, away: 0 });
  const final = finalizeMatch(updated, completePhase(), completeClock());
  assertEquals(final.ok, true);
  assertEquals(final.home, { teamId: H, score: 1 });
  assertEquals(final.away, { teamId: A, score: 0 });
});

test('GL-23. 客队通过左门得分并闭合', () => {
  const mc0 = core(BS.FREE, 0, 0);
  const crossing = detectGoalLineCrossing({ x: 0.1, y: 0.5 }, { x: -0.05, y: 0.5 }, deriveGoalGeometry(mc0)); // away 左门
  assertEquals(crossing.scoringTeamId, A);
  const updated = applyGoalScoreUpdate(mc0, resolveGoal(createGoalCandidateFromCrossing(crossing, mc0), mc0, {}));
  assertEquals(updated.score, { home: 0, away: 1 });
});