/**
 * Step 39F-M-C-21 —— Goal Crossing → Goal Resolution / Score Integration 测试。
 *
 * 覆盖 基础 / Score / NO_GOAL / Candidate / Immutability / 多 crossing / Idempotency / Invalid / Architecture。
 * 红线：Score 只经 C-14；不复制 Geometry / Resolution Rule；无 Dedup Ledger；无随机 / 墙钟。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  resolveTrajectoryGoalCrossings, createGoalCandidateFromTrajectoryCrossing,
  validateTrajectoryGoalResolutionResult,
  GOAL_CROSSING_RESOLUTION_SOURCE, GOAL_CROSSING_RESOLUTION_REASON,
} from '../src/core/match/goal-crossing-resolution.js';
import { detectGoalsFromTrajectory } from '../src/core/match/trajectory-goal-detection.js';
import { deriveGoalGeometry } from '../src/core/match/goal-geometry.js';
import { applyGoalScoreUpdate } from '../src/core/match/goal-resolution.js';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/core/match/goal-crossing-resolution.js'), 'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const H = 'clb_h', A = 'clb_a';
const geom = () => deriveGoalGeometry({ teams: { home: H, away: A } });

function core(sh = 0, sa = 0) {
  return {
    worldId: 'w21', season: 1, matchId: 'm21', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: sh, away: sa },
    ball: { position: { x: 0.5, y: 0.5 }, control: null, possessingTeamId: H, velocity: { x: 0, y: 0 }, state: 'IN_TRANSIT' },
    players: [],
    tactical: { [H]: {}, [A]: {} },
  };
}

function manual(pts) {
  const n = pts.length;
  const samples = pts.map((p, i) => ({ t: i / (n - 1), x: p[0], y: p[1] }));
  return {
    ok: true, tickIndex: 0, start: { x: pts[0][0], y: pts[0][1] }, end: { x: pts[n - 1][0], y: pts[n - 1][1] },
    samples, sampleCount: n, source: 'TICK_INTERNAL_TRAJECTORY', ruleVersion: 'ball-trajectory-v1',
  };
}
const det = (pts) => detectGoalsFromTrajectory(manual(pts), geom());
/** 0 crossing 的非法 detection（用于失败路径构造）。 */
const HOME1 = det([[0.9, 0.5], [1.1, 0.5]]);          // 1 home crossing
const AWAY1 = det([[0.1, 0.5], [-0.1, 0.5]]);          // 1 away crossing
const HOME2 = det([[0.9, 0.5], [1.1, 0.5], [0.9, 0.5], [1.1, 0.5]]); // 2 home
const AWAY2 = det([[0.1, 0.5], [-0.1, 0.5], [0.1, 0.5], [-0.1, 0.5]]); // 2 away
const HOME_AWAY = det([[0.9, 0.5], [1.1, 0.5], [-0.1, 0.5]]); // home 后 away
const NONE = det([[0.4, 0.5], [0.6, 0.5]]);            // 0 crossing

// ===========================================================================
// 基础：1-5
// ===========================================================================

test('GR-01. 0 crossings → ok, goalCount 0, 同引用', () => {
  const mc = core();
  const r = resolveTrajectoryGoalCrossings(mc, NONE);
  assertEquals(r.ok, true);
  assertEquals(r.goalCount, 0);
  assertEquals(r.finalMatchCore, mc, '无进球允许保持相同引用');
});

test('GR-02/03/04. 1 / 2 / N crossings 处理', () => {
  assertEquals(resolveTrajectoryGoalCrossings(core(), HOME1).goalCount, 1);
  assertEquals(resolveTrajectoryGoalCrossings(core(), HOME2).goalCount, 2);
  assertEquals(resolveTrajectoryGoalCrossings(core(), det([[0.9, 0.5], [1.1, 0.5], [0.9, 0.5], [1.1, 0.5], [0.9, 0.5], [1.1, 0.5]])).goalCount, 3);
});

test('GR-05. 顺序处理（crossingIndex 升序）', () => {
  const r = resolveTrajectoryGoalCrossings(core(), HOME2);
  assertEquals(JSON.stringify(r.resolutions.map((x) => x.crossingIndex)), JSON.stringify([0, 1]));
});

// ===========================================================================
// Score：6-10
// ===========================================================================

test('GR-06. Home → 1:0', () => {
  assertEquals(resolveTrajectoryGoalCrossings(core(), HOME1).finalMatchCore.score, { home: 1, away: 0 });
});
test('GR-07. Away → 0:1', () => {
  assertEquals(resolveTrajectoryGoalCrossings(core(), AWAY1).finalMatchCore.score, { home: 0, away: 1 });
});
test('GR-08. Home → Away → 1:1', () => {
  assertEquals(resolveTrajectoryGoalCrossings(core(), HOME_AWAY).finalMatchCore.score, { home: 1, away: 1 });
});
test('GR-09. Home → Home → 2:0', () => {
  assertEquals(resolveTrajectoryGoalCrossings(core(), HOME2).finalMatchCore.score, { home: 2, away: 0 });
});
test('GR-10. Away → Away → 0:2', () => {
  assertEquals(resolveTrajectoryGoalCrossings(core(), AWAY2).finalMatchCore.score, { home: 0, away: 2 });
});

// ===========================================================================
// NO_GOAL：11-13
// ===========================================================================

test('GR-11/12. NO_GOAL 不写 Score，且后续 crossing 继续处理', () => {
  // 构造：第三个 crossing 因 candidate 非法被拒绝 → 但 NO_GOAL 路径走 C-14（未知球队）。
  const mc = core();
  // 未知球队 crossing（scoringTeamId 不在 teams）→ resolveGoal 返回 NO_GOAL，C-21 继续。
  const bad = { ...HOME1, crossings: [{ ...HOME1.crossings[0], scoringTeamId: 'clb_unknown' }] };
  const r = resolveTrajectoryGoalCrossings(mc, bad);
  assertEquals(r.ok, true);
  assertEquals(r.goalCount, 0);
  assertEquals(r.finalMatchCore, mc);
  assertEquals(r.resolutions[0].applied, false);
});

test('GR-12b. 混合：NO_GOAL 后仍处理合法 crossing', () => {
  const mixed = {
    ...det([[0.9, 0.5], [1.1, 0.5], [0.9, 0.5], [1.1, 0.5]]),
  };
  // 把第 0 条改为未知球队（NO_GOAL），第 1 条保持合法。
  mixed.crossings = [ { ...mixed.crossings[0], scoringTeamId: 'clb_unknown' }, mixed.crossings[1] ];
  const r = resolveTrajectoryGoalCrossings(core(), mixed);
  assertEquals(r.ok, true);
  assertEquals(r.goalCount, 1, '合法的第 2 条仍被处理');
  assertEquals(r.finalMatchCore.score, { home: 1, away: 0 });
});

test('GR-13. REGULATION_COMPLETE 阻止进球（复用 C-14）', () => {
  const mc = core(3, 2);
  const r = resolveTrajectoryGoalCrossings(mc, HOME1, { phase: 'REGULATION_COMPLETE' });
  assertEquals(r.ok, true);
  assertEquals(r.goalCount, 0);
  assertEquals(r.finalMatchCore.score, { home: 3, away: 2 }, '终场后不得进球');
});

// ===========================================================================
// Candidate：14-18
// ===========================================================================

test('GR-14/15/16/17/18. Crossing → Candidate 字段正确', () => {
  const r = resolveTrajectoryGoalCrossings(core(), HOME1);
  const c = r.resolutions[0].candidate;
  assertEquals(c.ok, true);
  assertEquals(c.source, 'GOAL_LINE_CROSSING');
  assertEquals(c.teamId, H);
  assertEquals(c.playerId, null, '缺失射手不推断');
  assertEquals(c.goalId, null, '缺失 goalId 不生成');
});

test('GR-18b. Adapter 直接函数：非法 crossing → INVALID_GOAL_CANDIDATE', () => {
  assertEquals(createGoalCandidateFromTrajectoryCrossing(null).ok, false);
  assertEquals(createGoalCandidateFromTrajectoryCrossing({}).reason, GOAL_CROSSING_RESOLUTION_REASON.INVALID_GOAL_CANDIDATE);
});

// ===========================================================================
// Immutability：19-21
// ===========================================================================

test('GR-19. 输入 MatchCore 不被修改', () => {
  const mc = core(0, 0);
  const snap = JSON.stringify(mc);
  resolveTrajectoryGoalCrossings(mc, HOME1);
  assertEquals(JSON.stringify(mc), snap);
});

test('GR-20. 输入 Detection Result 不被修改', () => {
  const d = HOME1;
  const snap = JSON.stringify(d);
  resolveTrajectoryGoalCrossings(core(), d);
  assertEquals(JSON.stringify(d), snap);
});

test('GR-21. Score 更新来自 C-14（返回新 MatchCore）', () => {
  const mc = core();
  const r = resolveTrajectoryGoalCrossings(mc, HOME1);
  assert(r.finalMatchCore !== mc, '应为 C-14 返回的新对象');
  assertEquals(r.finalMatchCore.teams, mc.teams, '非 score 字段保持引用');
});

// ===========================================================================
// Multiple crossings：22-25
// ===========================================================================

test('GR-22/23/24/25. 每 crossing 使用前一个结果 + 顺序 + goalCount + resolutions', () => {
  const r = resolveTrajectoryGoalCrossings(core(), HOME_AWAY);
  assertEquals(r.goalCount, 2);
  assertEquals(r.crossingsProcessed, 2);
  assertEquals(r.resolutions.length, 2);
  assertEquals(JSON.stringify(r.resolutions.map((x) => x.goalResult.scoringSide)), JSON.stringify(['home', 'away']));
  assertEquals(r.resolutions[1].goalResult.nextScore, { home: 1, away: 1 }, '第二个基于第一个结果');
  assertEquals(validateTrajectoryGoalResolutionResult(r).valid, true);
});

// ===========================================================================
// Idempotency：26-28
// ===========================================================================

test('GR-26. 幂等依赖 C-14 收敛（同输入重复运行确定 / 同结果重复应用不累加）', () => {
  const mc = core();
  const r1 = resolveTrajectoryGoalCrossings(mc, HOME1);
  assertEquals(r1.finalMatchCore.score, { home: 1, away: 0 });

  // (a) 相同输入重复运行 → 完全一致的确定性结果（不累积）。
  const again = resolveTrajectoryGoalCrossings(mc, HOME1);
  assertEquals(again.finalMatchCore.score, { home: 1, away: 0 }, '同一输入不得累积为 2:0');

  // (b) 同一 GoalResolutionResult 再次应用 → C-14 目标状态收敛，不重复加分。
  const reapplied = applyGoalScoreUpdate(r1.finalMatchCore, r1.resolutions[0].goalResult);
  assertEquals(reapplied.score, { home: 1, away: 0 }, 'C-14 收敛：同一结果不重复加分');
});

test('GR-27/28. 无 Ledger / 无 Dedup ID', () => {
  assert(!/ledger|glcHistory|scoreHistory|matchCoreHistory/i.test(SRC));
  assert(!/processedGoalIds|processedCrossings|processedTrajectory|new Set\(|new Map\(/.test(SRC));
});

// ===========================================================================
// Invalid：29-33
// ===========================================================================

test('GR-29. null / 非法 MatchCore → INVALID_MATCH_CORE', () => {
  assertEquals(resolveTrajectoryGoalCrossings(null, HOME1).reason, GOAL_CROSSING_RESOLUTION_REASON.INVALID_MATCH_CORE);
  assertEquals(resolveTrajectoryGoalCrossings({ teams: {} }, HOME1).reason, GOAL_CROSSING_RESOLUTION_REASON.INVALID_MATCH_CORE);
});

test('GR-30. 非法 Detection Result → INVALID_DETECTION_RESULT', () => {
  assertEquals(resolveTrajectoryGoalCrossings(core(), null).reason, GOAL_CROSSING_RESOLUTION_REASON.INVALID_DETECTION_RESULT);
  assertEquals(resolveTrajectoryGoalCrossings(core(), { ok: false }).reason, GOAL_CROSSING_RESOLUTION_REASON.INVALID_DETECTION_RESULT);
});

test('GR-31. Malformed crossing → INVALID_GOAL_CANDIDATE + failedCrossingIndex（fail-fast）', () => {
  const bad = { ...HOME1, crossings: [{ segmentIndex: 0 }] };
  const r = resolveTrajectoryGoalCrossings(core(), bad);
  assertEquals(r.ok, false);
  assertEquals(r.reason, GOAL_CROSSING_RESOLUTION_REASON.INVALID_GOAL_CANDIDATE);
  assertEquals(r.failedCrossingIndex, 0);
});

test('GR-32/33. Threw / ScoreUpdate 失败分支存在（防御性）', () => {
  assertEquals(GOAL_CROSSING_RESOLUTION_REASON.GOAL_RESOLUTION_THREW, 'GOAL_RESOLUTION_THREW');
  assertEquals(GOAL_CROSSING_RESOLUTION_REASON.SCORE_UPDATE_FAILED, 'SCORE_UPDATE_FAILED');
  assert(/GOAL_RESOLUTION_THREW/.test(SRC) && /SCORE_UPDATE_FAILED/.test(SRC));
});

// ===========================================================================
// Architecture：34-41
// ===========================================================================

test('GR-34/35. 不直接写 Score / 不修改 MatchCore', () => {
  assert(!/score\.home\s*(\+\+|[-+*\/]?=)|score\.away\s*(\+\+|[-+*\/]?=)/.test(SRC));
  assert(!/\.score\s*=\s*\{/.test(SRC));
  assert(/applyGoalScoreUpdate/.test(SRC), '写比分必须经 C-14');
});

test('GR-36/37. 不复制 Geometry / Resolution Rule', () => {
  assert(!/GOAL_CENTER_Y|GOAL_HALF_WIDTH|GOAL_LINE_LEFT_X|GOAL_LINE_RIGHT_X|GOAL_MOUTH_Y/.test(SRC));
  assert(!/nextScore\s*[:=]|scoringSide\s*[:=]|home:\s*score\.home\s*\+/.test(SRC));
});

test('GR-38/39. 不创建 Goal Truth / Event Ledger', () => {
  assert(!/goalHistory|goalEvent|goalStore|EventSourcing/i.test(SRC));
  assert(!/UUID|Date\.now|randomUUID/.test(SRC));
});

test('GR-40/41. 无随机 / 无墙钟', () => {
  assert(!/Math\.random\s*\(/.test(SRC));
  assert(!/Date\.now\s*\(/.test(SRC) && !/performance\.now\s*\(/.test(SRC) && !/new\s+Date\s*\(/.test(SRC));
});

test('GR-42. 不依赖 C-17/C-18/Match Tick（单向 C-19→C-20→C-21→C-14）', () => {
  assert(!/goal-aware|match-tick|ball-tick-segment/.test(SRC));
  assert(/from '\.\/goal-resolution\.js'/.test(SRC), '必须复用 C-14');
  assert(/from '\.\/trajectory-goal-detection\.js'/.test(SRC), '必须复用 C-20');
});

test('GR-43. 结果 source / ruleVersion 正确', () => {
  const r = resolveTrajectoryGoalCrossings(core(), HOME1);
  assertEquals(r.source, GOAL_CROSSING_RESOLUTION_SOURCE);
  assertEquals(r.ruleVersion, 'goal-crossing-resolution-v1');
});