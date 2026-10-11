/**
 * Step 39F-M-C-22 —— Trajectory-Goal Match Tick Integration 测试。
 *
 * 覆盖 基础 / 无进球 / Home / Away / Multiple / Trajectory / Failure / Immutability /
 *      Architecture / Boundary / Trace。
 *
 * 红线：C-08 = Tick Authority；Movement Input 显式；Score 只经 C-21 → C-14；
 *       不建 Ball Movement / Velocity Truth；不写 matchCore.ball；不修改 C-14~C-21；无随机 / 墙钟。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  runTrajectoryGoalMatchTick, resolveTrajectoryGoalTick, validateTrajectoryGoalTickResult,
  TRAJECTORY_GOAL_MATCH_TICK_SOURCE, TRAJECTORY_GOAL_MATCH_TICK_RULE_VERSION,
  TRAJECTORY_GOAL_MATCH_TICK_REASON,
} from '../src/core/match/trajectory-goal-match-tick.js';
import { deriveGoalGeometry } from '../src/core/match/goal-geometry.js';
import { detectGoalsFromTrajectory } from '../src/core/match/trajectory-goal-detection.js';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/core/match/trajectory-goal-match-tick.js'), 'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const R = TRAJECTORY_GOAL_MATCH_TICK_REASON;
const H = 'clb_h';
const A = 'clb_a';

const geom = () => deriveGoalGeometry({ teams: { home: H, away: A } });

function core(sh = 0, sa = 0) {
  return {
    worldId: 'w22', season: 1, matchId: 'm22', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: sh, away: sa },
    ball: { position: { x: 0.5, y: 0.5 }, control: null, possessingTeamId: H, velocity: { x: 0, y: 0 }, state: 'IN_TRANSIT' },
    players: [],
    tactical: { [H]: {}, [A]: {} },
  };
}

/** 显式 Movement Input（复用 C-19 Input Schema）。 */
const mv = (p0, p1, extra = {}) => ({
  startPosition: { x: p0[0], y: p0[1] },
  endPosition: { x: p1[0], y: p1[1] },
  duration: 1,
  ...extra,
});

/** 手工合法 C-19 Trajectory（用于多次穿越 / 折返；结构合法，非 C-22 生成）。 */
function manual(pts, tickIndex = 0) {
  const n = pts.length;
  const samples = pts.map((p, i) => ({ t: i / (n - 1), x: p[0], y: p[1] }));
  return {
    ok: true, tickIndex, start: { x: pts[0][0], y: pts[0][1] }, end: { x: pts[n - 1][0], y: pts[n - 1][1] },
    samples, sampleCount: n, source: 'TICK_INTERNAL_TRAJECTORY', ruleVersion: 'ball-trajectory-v1',
  };
}

/** 合法几何但缺 scoringTeamId（用于强制 C-21 失败路径）。 */
const geomNoTeam = () => ({
  left: { side: 'LEFT', lineX: 0, yMin: 0.39, yMax: 0.61 },
  right: { side: 'RIGHT', lineX: 1, yMin: 0.39, yMax: 0.61 },
});

// ===========================================================================
// 基础：1-5
// ===========================================================================

test('C22-01/02/03/04/05. 正常 Tick + Movement Input → 全链路成功', () => {
  const r = runTrajectoryGoalMatchTick(core(), {
    ballMovement: mv([0.9, 0.5], [1.1, 0.5], { sampleCount: 2 }),
    geometry: geom(),
    tickInput: { tickIndex: 0 },
  });
  assertEquals(r.ok, true);
  assertEquals(r.matchTickResult.tick.status, 'COMPLETED'); // C-08
  assertEquals(r.trajectory.ok, true);                      // C-19
  assertEquals(r.detection.ok, true);                       // C-20
  assertEquals(r.resolution.ok, true);                      // C-21
});

test('C22-05b. source / ruleVersion / validate', () => {
  const r = runTrajectoryGoalMatchTick(core(), {
    ballMovement: mv([0.9, 0.5], [1.1, 0.5]),
    geometry: geom(),
  });
  assertEquals(r.source, TRAJECTORY_GOAL_MATCH_TICK_SOURCE);
  assertEquals(r.ruleVersion, TRAJECTORY_GOAL_MATCH_TICK_RULE_VERSION);
  const v = validateTrajectoryGoalTickResult(r);
  assertEquals(v.valid, true);
  assertEquals(v.issues, []);
});

test('C22-05c. tickIndex 保留一致（C-08 / C-19 / C-20 同一 tickIndex）', () => {
  const r = runTrajectoryGoalMatchTick(core(), {
    ballMovement: mv([0.4, 0.5], [0.6, 0.5], { tickIndex: 7 }),
    geometry: geom(),
    tickInput: { tickIndex: 7 },
  });
  assertEquals(r.tickIndex, 7);
  assertEquals(r.trajectory.tickIndex, 7);
  assertEquals(r.detection.trajectoryTickIndex, 7);
  assertEquals(r.matchTickResult.tick.tickIndex, 7);
});

// ===========================================================================
// 无进球：6-8
// ===========================================================================

test('C22-06/07/08. 无 crossing → 0 进球、score 不变、finalMatchCore = Tick MatchCore', () => {
  const r = runTrajectoryGoalMatchTick(core(), {
    ballMovement: mv([0.4, 0.5], [0.6, 0.5]),
    geometry: geom(),
  });
  assertEquals(r.ok, true);
  assertEquals(r.detection.goalCount, 0);
  assertEquals(r.resolution.goalCount, 0);
  assertEquals(r.finalMatchCore.score, { home: 0, away: 0 });
  assert(r.finalMatchCore === r.matchTickResult.matchCore, 'finalMatchCore 应等于 C-08 Tick 输出');
});

// ===========================================================================
// Home / Away：9-10
// ===========================================================================

test('C22-09. Home crossing → 1:0', () => {
  const r = runTrajectoryGoalMatchTick(core(), {
    ballMovement: mv([0.9, 0.5], [1.1, 0.5]),
    geometry: geom(),
  });
  assertEquals(r.detection.goalCount, 1);
  assertEquals(r.resolution.goalCount, 1);
  assertEquals(r.finalMatchCore.score, { home: 1, away: 0 });
  assert(r.finalMatchCore !== r.matchTickResult.matchCore, '有进球 → 应为 C-14 返回的新 MatchCore');
});

test('C22-10. Away crossing → 0:1', () => {
  const r = runTrajectoryGoalMatchTick(core(), {
    ballMovement: mv([0.1, 0.5], [-0.1, 0.5]),
    geometry: geom(),
  });
  assertEquals(r.detection.goalCount, 1);
  assertEquals(r.finalMatchCore.score, { home: 0, away: 1 });
});

// ===========================================================================
// Multiple crossing（经纯编排，显式 Trajectory）：11-12
// ===========================================================================

test('C22-11. Home → Away → 1:1', () => {
  const traj = manual([[0.9, 0.5], [1.1, 0.5], [-0.1, 0.5]]);
  const r = resolveTrajectoryGoalTick(core(), traj, geom());
  assertEquals(r.detection.goalCount, 2);
  assertEquals(r.resolution.goalCount, 2);
  assertEquals(r.finalMatchCore.score, { home: 1, away: 1 });
  assertEquals(JSON.stringify(r.resolution.resolutions.map((x) => x.goalResult.scoringSide)), JSON.stringify(['home', 'away']));
});

test('C22-12. Home → Home → 2:0', () => {
  const traj = manual([[0.9, 0.5], [1.1, 0.5], [0.9, 0.5], [1.1, 0.5]]);
  const r = resolveTrajectoryGoalTick(core(), traj, geom());
  assertEquals(r.detection.goalCount, 2);
  assertEquals(r.finalMatchCore.score, { home: 2, away: 0 });
});

test('C22-12b. Away → Away → 0:2', () => {
  const traj = manual([[0.1, 0.5], [-0.1, 0.5], [0.1, 0.5], [-0.1, 0.5]]);
  const r = resolveTrajectoryGoalTick(core(), traj, geom());
  assertEquals(r.finalMatchCore.score, { home: 0, away: 2 });
});

// ===========================================================================
// Trajectory 采样：13-16
// ===========================================================================

test('C22-13/14/15. sampleCount=2 / 5 / 16 → segmentCount 正确', () => {
  const seg = (n) => runTrajectoryGoalMatchTick(core(), {
    ballMovement: mv([0.4, 0.5], [0.6, 0.5], { sampleCount: n }),
    geometry: geom(),
  });
  assertEquals(seg(2).detection.segmentCount, 1);
  assertEquals(seg(5).detection.segmentCount, 4);
  assertEquals(seg(16).detection.segmentCount, 15);
});

test('C22-16. trajectory segmentCount = sampleCount - 1', () => {
  for (const n of [2, 3, 5, 9, 16]) {
    const r = runTrajectoryGoalMatchTick(core(), {
      ballMovement: mv([0.4, 0.5], [0.6, 0.5], { sampleCount: n }),
      geometry: geom(),
    });
    assertEquals(r.trajectory.sampleCount, n);
    assertEquals(r.detection.segmentCount, n - 1);
  }
});

// ===========================================================================
// Failure：17-23
// ===========================================================================

test('C22-17. 非法 MatchCore → INVALID_MATCH_CORE', () => {
  const opts = { ballMovement: mv([0.9, 0.5], [1.1, 0.5]), geometry: geom() };
  assertEquals(runTrajectoryGoalMatchTick(null, opts).reason, R.INVALID_MATCH_CORE);
  assertEquals(runTrajectoryGoalMatchTick({}, opts).reason, R.INVALID_MATCH_CORE);
  assertEquals(runTrajectoryGoalMatchTick({ teams: { home: H, away: A }, score: {} }, opts).reason, R.INVALID_MATCH_CORE);
});

test('C22-18. 缺失 Movement Input → MISSING_BALL_MOVEMENT_INPUT（不执行 Tick）', () => {
  assertEquals(runTrajectoryGoalMatchTick(core(), { geometry: geom() }).reason, R.MISSING_BALL_MOVEMENT_INPUT);
  assertEquals(runTrajectoryGoalMatchTick(core(), { ballMovement: null, geometry: geom() }).reason, R.MISSING_BALL_MOVEMENT_INPUT);
  assertEquals(runTrajectoryGoalMatchTick(core()).reason, R.MISSING_BALL_MOVEMENT_INPUT);
});

test('C22-19. 非法 Movement Input → INVALID_BALL_MOVEMENT_INPUT（不执行 Tick）', () => {
  // 缺 end / displacement
  assertEquals(runTrajectoryGoalMatchTick(core(), { ballMovement: { startPosition: { x: 0.9, y: 0.5 } }, geometry: geom() }).reason, R.INVALID_BALL_MOVEMENT_INPUT);
  // startPosition 非点
  assertEquals(runTrajectoryGoalMatchTick(core(), { ballMovement: { startPosition: { x: 'a' }, endPosition: { x: 1.1, y: 0.5 } }, geometry: geom() }).reason, R.INVALID_BALL_MOVEMENT_INPUT);
});

test('C22-19b. 缺失 / 非法 Geometry → MISSING_GEOMETRY', () => {
  assertEquals(runTrajectoryGoalMatchTick(core(), { ballMovement: mv([0.9, 0.5], [1.1, 0.5]) }).reason, R.MISSING_GEOMETRY);
  assertEquals(runTrajectoryGoalMatchTick(core(), { ballMovement: mv([0.9, 0.5], [1.1, 0.5]), geometry: {} }).reason, R.MISSING_GEOMETRY);
});

test('C22-20. C-08 Tick 失败 → TICK_FAILED（无 Trajectory）', () => {
  const bad = core();
  delete bad.ball; // 结构上仍满足 C-22 校验，但 C-08 判定 INVALID
  const r = runTrajectoryGoalMatchTick(bad, {
    ballMovement: mv([0.9, 0.5], [1.1, 0.5]),
    geometry: geom(),
  });
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.TICK_FAILED);
  assert(!('trajectory' in r), 'Tick 失败不得创建 Trajectory');
  assertEquals(r.matchTickResult.tick.status, 'INVALID');
});

test('C22-21. C-19 失败 → TRAJECTORY_FAILED（无 Detection / 不改 Score）', () => {
  const r1 = runTrajectoryGoalMatchTick(core(), {
    ballMovement: mv([0.9, 0.5], [1.1, 0.5], { sampleCount: 1 }), // C-19 拒绝
    geometry: geom(),
  });
  assertEquals(r1.ok, false);
  assertEquals(r1.reason, R.TRAJECTORY_FAILED);
  assert(!('detection' in r1));

  const r2 = runTrajectoryGoalMatchTick(core(), {
    ballMovement: mv([0.9, 0.5], [1.1, 0.5], { duration: 0 }),    // C-19 拒绝
    geometry: geom(),
  });
  assertEquals(r2.reason, R.TRAJECTORY_FAILED);
});

test('C22-22. C-20 结构性失败 → GOAL_DETECTION_FAILED（无 C-21）', () => {
  const r = resolveTrajectoryGoalTick(core(), { ok: false }, geom());
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.GOAL_DETECTION_FAILED);
  assertEquals(r.resolution, null);
  assertEquals(r.finalMatchCore.score, { home: 0, away: 0 });
});

test('C22-23. C-21 失败 → GOAL_RESOLUTION_FAILED（不伪造 Score）', () => {
  const traj = manual([[0.9, 0.5], [1.1, 0.5]]);
  const r = resolveTrajectoryGoalTick(core(1, 0), traj, geomNoTeam());
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.GOAL_RESOLUTION_FAILED);
  assertEquals(r.finalMatchCore.score, { home: 1, away: 0 }, '保留失败前状态，不自改 Score');
});

// ===========================================================================
// Immutability：24-27
// ===========================================================================

test('C22-24. input MatchCore 不被修改', () => {
  const mc = core();
  const snap = JSON.stringify(mc);
  runTrajectoryGoalMatchTick(mc, { ballMovement: mv([0.9, 0.5], [1.1, 0.5]), geometry: geom() });
  assertEquals(JSON.stringify(mc), snap);
});

test('C22-25. Movement Input / Geometry 不被修改', () => {
  const m = mv([0.9, 0.5], [1.1, 0.5]);
  const g = geom();
  const mSnap = JSON.stringify(m);
  const gSnap = JSON.stringify(g);
  runTrajectoryGoalMatchTick(core(), { ballMovement: m, geometry: g });
  assertEquals(JSON.stringify(m), mSnap);
  assertEquals(JSON.stringify(g), gSnap);
});

test('C22-26/27. C-20 / C-21 Result 不被修改（重复运行确定且互不影响）', () => {
  const traj = manual([[0.9, 0.5], [1.1, 0.5], [-0.1, 0.5]]);
  const g = geom();
  const r1 = resolveTrajectoryGoalTick(core(), traj, g);
  const detSnap = JSON.stringify(r1.detection);
  const resSnap = JSON.stringify(r1.resolution);
  const r2 = resolveTrajectoryGoalTick(core(), traj, g);
  assertEquals(JSON.stringify(r1.detection), detSnap, '第一次 detection 未被修改');
  assertEquals(JSON.stringify(r1.resolution), resSnap, '第一次 resolution 未被修改');
  assertEquals(JSON.stringify(r2.detection), detSnap, '同输入 → 确定一致');
  assertEquals(JSON.stringify(r2.resolution), resSnap, '同输入 → 确定一致');
});

test('C22-27b. 同输入 run 两次 → Score 不累积（幂等）', () => {
  const opts = () => ({ ballMovement: mv([0.9, 0.5], [1.1, 0.5]), geometry: geom() });
  const a = runTrajectoryGoalMatchTick(core(), opts());
  const b = runTrajectoryGoalMatchTick(core(), opts());
  assertEquals(a.finalMatchCore.score, { home: 1, away: 0 });
  assertEquals(b.finalMatchCore.score, { home: 1, away: 0 }, '同一输入不得累积为 2:0');
});

// ===========================================================================
// Architecture：28-39
// ===========================================================================

test('C22-28/29. 不 import / 不修改 C-17 / C-18', () => {
  assert(!/goal-aware-match-tick\.js/.test(SRC), '不得依赖 C-17');
  assert(!/goal-aware-match-ticks\.js/.test(SRC), '不得依赖 C-18');
});

test('C22-30/31. 不 import C-14 / C-15（经 C-20 / C-21 消费）', () => {
  assert(!/from '\.\/goal-resolution\.js'/.test(SRC), '不得直接依赖 C-14');
  assert(!/from '\.\/goal-geometry\.js'/.test(SRC), '不得直接依赖 C-15 / Goal Geometry');
});

test('C22-32. 复用 C-19（不重新实现公式）', () => {
  assert(/from '\.\/ball-trajectory\.js'/.test(SRC));
  assert(/deriveBallTrajectory/.test(SRC));
  assert(/from '\.\/trajectory-goal-detection\.js'/.test(SRC), '必须经 C-20');
  assert(/from '\.\/goal-crossing-resolution\.js'/.test(SRC), '必须经 C-21');
  assert(/from '\.\/match-tick\.js'/.test(SRC), 'Tick Authority = C-08');
});

test('C22-33/34. 不创建 Ball Movement Truth / Velocity Truth', () => {
  assert(!/ballMovementState|ballMovementTruth|movementTruth/i.test(SRC));
  assert(!/velocityTruth/i.test(SRC));
});

test('C22-35. 不直接写 Score（唯一经 C-21 → C-14）', () => {
  assert(!/score\.home\s*(\+\+|[-+*\/]?=)/.test(SRC));
  assert(!/score\.away\s*(\+\+|[-+*\/]?=)/.test(SRC));
  assert(!/\.score\s*=\s*\{/.test(SRC));
  assert(!/applyGoalScoreUpdate/.test(SRC), 'C-22 不直接调用 C-14 写入');
  assert(/resolveTrajectoryGoalCrossings/.test(SRC), '写比分必须经 C-21');
});

test('C22-36/37. 不创建 Goal Ledger / Goal Event', () => {
  assert(!/goalLedger|goalHistory|goalRegistry|goalStore/i.test(SRC));
  assert(!/goalEvent|GoalEvent|UUID|randomUUID/.test(SRC));
});

test('C22-38/39. 无随机 / 无墙钟', () => {
  assert(!/Math\.random\s*\(/.test(SRC));
  assert(!/Date\.now\s*\(/.test(SRC) && !/performance\.now\s*\(/.test(SRC) && !/new\s+Date\s*\(/.test(SRC));
});

test('C22-39b. 不修改 matchCore.ball（无隐式位移写回）', () => {
  assert(!/matchCore\.ball\.position\s*=/.test(SRC));
  assert(!/matchCore\.ball\.velocity\s*=/.test(SRC));
  assert(!/\.ball\.positionAtTickEnd|\.ball\.trajectory\s*=/.test(SRC));
});

test('C22-39c. 不创建 Clock / Phase，不依赖 C-10 Multi-Tick Driver', () => {
  assert(!/match-ticks\.js/.test(SRC), '不得依赖 C-10 runMatchTicks');
  assert(!/createClock|MatchClock\s*\(|MatchPhase\s*\(/.test(SRC));
});

// ===========================================================================
// Boundary：40-45
// ===========================================================================

test('C22-40. Goal line crossing 边界（Home）', () => {
  const r = runTrajectoryGoalMatchTick(core(), { ballMovement: mv([0.9, 0.5], [1.1, 0.5]), geometry: geom() });
  assertEquals(r.detection.crossings[0].scoringSide, 'RIGHT');
  assertEquals(r.detection.crossings[0].scoringTeamId, H);
});

test('C22-41. 无 crossing 边界', () => {
  const r = runTrajectoryGoalMatchTick(core(), { ballMovement: mv([0.4, 0.5], [0.6, 0.5]), geometry: geom() });
  assertEquals(r.detection.crossings.length, 0);
  assertEquals(r.detection.goalCount, 0);
});

test('C22-42. 多次 crossing 边界（Home → Away）', () => {
  const r = resolveTrajectoryGoalTick(core(), manual([[0.9, 0.5], [1.1, 0.5], [-0.1, 0.5]]), geom());
  assertEquals(r.detection.goalCount, 2);
  assertEquals(r.finalMatchCore.score, { home: 1, away: 1 });
});

test('C22-43. 折返 Trajectory 边界（retain 分段）', () => {
  const r = resolveTrajectoryGoalTick(core(), manual([[0.9, 0.5], [1.1, 0.5], [0.9, 0.5], [1.1, 0.5]]), geom());
  assertEquals(r.detection.segmentCount, 3);
  assertEquals(r.detection.goalCount, 2);
});

test('C22-44. x > 1 保留（不 clamp）', () => {
  const r = runTrajectoryGoalMatchTick(core(), { ballMovement: mv([0.9, 0.5], [1.1, 0.5]), geometry: geom() });
  assertEquals(r.trajectory.end, { x: 1.1, y: 0.5 });
  assertEquals(r.trajectory.samples[r.trajectory.samples.length - 1].x, 1.1);
  assert(r.trajectory.samples.every((s) => s.x <= 1.1));
});

test('C22-45. x < 0 保留（不 clamp）', () => {
  const r = runTrajectoryGoalMatchTick(core(), { ballMovement: mv([0.1, 0.5], [-0.1, 0.5]), geometry: geom() });
  assertEquals(r.trajectory.end, { x: -0.1, y: 0.5 });
  assertEquals(r.trajectory.samples[r.trajectory.samples.length - 1].x, -0.1);
});

// ===========================================================================
// Trace：46-47
// ===========================================================================

test('C22-46. transient trace 无历史链 / 不注入 ball 引用', () => {
  const r = runTrajectoryGoalMatchTick(core(), { ballMovement: mv([0.9, 0.5], [1.1, 0.5]), geometry: geom() });
  for (const k of ['matchCoreHistory', 'trajectoryHistory', 'goalHistory', 'ball', 'ballMovementState', 'velocityTruth']) {
    assert(!(k in r), `不得包含 ${k}`);
  }
});

test('C22-47. validateTrajectoryGoalTickResult 结构校验', () => {
  assertEquals(validateTrajectoryGoalTickResult(null).valid, false);
  assertEquals(validateTrajectoryGoalTickResult({ ok: false }).valid, false);
  assertEquals(validateTrajectoryGoalTickResult({ ok: true, source: 'X' }).valid, false);
  assertEquals(validateTrajectoryGoalTickResult({}).issues.includes('NOT_OK'), true);
});