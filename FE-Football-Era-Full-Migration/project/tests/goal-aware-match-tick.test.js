/**
 * Step 39F-M-C-17 —— Goal Detection Tick Integration 测试。
 *
 * 覆盖 基础 / Geometry / Ball State / Boundary / Score / Idempotency / Immutability / Architecture。
 *
 * 红线：不复制 Tick / Geometry / Resolution；不新增 Score Truth；不改 C-04~C-16；无 Math.random / 墙钟 / Ball Physics。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  runGoalAwareMatchTick, resolveGoalFromSegment, GOAL_AWARE_STATUS, GOAL_AWARE_REASON,
} from '../src/core/match/goal-aware-match-tick.js';
import { deriveBallTickSegment } from '../src/core/match/ball-tick-segment.js';
import { applyGoalScoreUpdate } from '../src/core/match/goal-resolution.js';
import { INTERACTION_BALL_STATE as BS } from '../src/core/match/interaction-resolution-config.js';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');
const codeOnly = (name) => readSrc(name).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

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
function core(x, y, state = BS.IN_TRANSIT, sh = 0, sa = 0) {
  return {
    worldId: 'w_ga17', season: 1, matchId: 'm_ga17', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: sh, away: sa },
    ball: { position: { x, y }, control: null, possessingTeamId: H, velocity: { x: 0, y: 0 }, state },
    players: [mk('h_a', H), mk('a_a', A)],
    tactical: { [H]: tac(), [A]: tac() },
  };
}
/** 从 P0→P1 构造 C-16 Segment（走真实 C-16 派生）。 */
const seg = (p0, p1, s0 = BS.IN_TRANSIT, s1 = BS.IN_TRANSIT) =>
  deriveBallTickSegment(core(p0[0], p0[1], s0), core(p1[0], p1[1], s1));
/** 用结束 MatchCore + Segment 走 C-15/C-14 解析。 */
const resolve = (endCore, segment, opts = {}) => resolveGoalFromSegment(endCore, segment, opts);

// ===========================================================================
// 基础：1-6
// ===========================================================================

test('GA-01. NO_GOAL Tick（无穿越）', () => {
  const end = core(0.6, 0.5);
  const { goal, matchCore } = resolve(end, seg([0.4, 0.5], [0.6, 0.5]));
  assertEquals(goal.status, GOAL_AWARE_STATUS.NO_GOAL);
  assertEquals(goal.reason, GOAL_AWARE_REASON.NO_CROSSING);
  assertEquals(matchCore.score, { home: 0, away: 0 });
});

test('GA-02. Home Goal（inside → x=1）', () => {
  const end = core(1.06, 0.5);
  const { goal, matchCore } = resolve(end, seg([0.9, 0.5], [1.06, 0.5]), { phase: 'FIRST_HALF' });
  assertEquals(goal.status, GOAL_AWARE_STATUS.GOAL_CONFIRMED);
  assertEquals(matchCore.score, { home: 1, away: 0 });
});

test('GA-03. Away Goal（inside → x=0）', () => {
  const end = core(-0.06, 0.5);
  const { goal, matchCore } = resolve(end, seg([0.1, 0.5], [-0.06, 0.5]), { phase: 'FIRST_HALF' });
  assertEquals(goal.status, GOAL_AWARE_STATUS.GOAL_CONFIRMED);
  assertEquals(matchCore.score, { home: 0, away: 1 });
});

test('GA-04. Goal Candidate 生成（复用 C-15，source=GOAL_LINE_CROSSING）', () => {
  const { goal } = resolve(core(1.06, 0.5), seg([0.9, 0.5], [1.06, 0.5]));
  assertEquals(goal.candidate.ok, true);
  assertEquals(goal.candidate.source, 'GOAL_LINE_CROSSING');
  assertEquals(goal.candidate.teamId, H);
});

test('GA-05. Goal Resolution 成功（复用 C-14）', () => {
  const { goal } = resolve(core(1.06, 0.5), seg([0.9, 0.5], [1.06, 0.5]));
  assertEquals(goal.resolution.outcome, 'GOAL_CONFIRMED');
  assertEquals(goal.resolution.scoringSide, 'home');
  assertEquals(goal.resolution.nextScore, { home: 1, away: 0 });
});

test('GA-06. Score 正确更新', () => {
  const { matchCore } = resolve(core(1.06, 0.5, BS.IN_TRANSIT, 2, 1), seg([0.9, 0.5], [1.06, 0.5]));
  assertEquals(matchCore.score, { home: 3, away: 1 });
});

// ===========================================================================
// Geometry：7-12
// ===========================================================================

test('GA-07. Goal Mouth 内 crossing → 进球', () => {
  const { goal } = resolve(core(1.06, 0.45), seg([0.9, 0.45], [1.06, 0.45]));
  assertEquals(goal.status, GOAL_AWARE_STATUS.GOAL_CONFIRMED);
});

test('GA-08. Goal Mouth 外 crossing → 无进球', () => {
  const { goal } = resolve(core(1.06, 0.1), seg([0.9, 0.1], [1.06, 0.1]));
  assertEquals(goal.status, GOAL_AWARE_STATUS.NO_GOAL);
  assertEquals(goal.reason, GOAL_AWARE_REASON.NO_CROSSING);
});

test('GA-09. Field → Goal（场内侧穿到门外侧）', () => {
  assertEquals(resolve(core(1.06, 0.5), seg([0.9, 0.5], [1.06, 0.5])).goal.status, GOAL_AWARE_STATUS.GOAL_CONFIRMED);
});

test('GA-10. Goal → Field（外→内，不算进球）', () => {
  const { goal } = resolve(core(0.9, 0.5), seg([1.06, 0.5], [0.9, 0.5]));
  assertEquals(goal.status, GOAL_AWARE_STATUS.NO_GOAL);
});

test('GA-11/12. 左侧 / 右侧 Goal Line', () => {
  assertEquals(resolve(core(-0.06, 0.5), seg([0.1, 0.5], [-0.06, 0.5])).goal.status, GOAL_AWARE_STATUS.GOAL_CONFIRMED);
  assertEquals(resolve(core(1.06, 0.5), seg([0.9, 0.5], [1.06, 0.5])).goal.status, GOAL_AWARE_STATUS.GOAL_CONFIRMED);
});

// ===========================================================================
// Ball State：13-15
// ===========================================================================

test('GA-13. CONTROLLED → 不得产生进球（C-15 eligibility）', () => {
  const { goal } = resolve(core(1.06, 0.5, BS.CONTROLLED), seg([0.9, 0.5], [1.06, 0.5], BS.CONTROLLED, BS.CONTROLLED));
  assertEquals(goal.status, GOAL_AWARE_STATUS.NO_GOAL);
  assertEquals(goal.reason, GOAL_AWARE_REASON.CANDIDATE_REJECTED);
});

test('GA-14/15. FREE / IN_TRANSIT → 进球', () => {
  assertEquals(resolve(core(1.06, 0.5, BS.FREE), seg([0.9, 0.5], [1.06, 0.5], BS.FREE, BS.FREE)).goal.status, GOAL_AWARE_STATUS.GOAL_CONFIRMED);
  assertEquals(resolve(core(1.06, 0.5, BS.IN_TRANSIT), seg([0.9, 0.5], [1.06, 0.5])).goal.status, GOAL_AWARE_STATUS.GOAL_CONFIRMED);
});

// ===========================================================================
// Boundary：16-20
// ===========================================================================

test('GA-16. P0 = P1 → NO_GOAL（无移动）', () => {
  const { goal } = resolve(core(0.5, 0.5), seg([0.5, 0.5], [0.5, 0.5]));
  assertEquals(goal.status, GOAL_AWARE_STATUS.NO_GOAL);
  assertEquals(goal.reason, GOAL_AWARE_REASON.NO_MOVEMENT);
});

test('GA-17/18. 起点正好在门线上(x=0 / x=1) → 不算 field→goal', () => {
  assertEquals(resolve(core(-0.1, 0.5), seg([0, 0.5], [-0.1, 0.5])).goal.status, GOAL_AWARE_STATUS.NO_GOAL);
  assertEquals(resolve(core(1.1, 0.5), seg([1, 0.5], [1.1, 0.5])).goal.status, GOAL_AWARE_STATUS.NO_GOAL);
});

test('GA-19/20. y=0 / y=1 边界穿越 → 门框外，无进球', () => {
  assertEquals(resolve(core(1.06, 0), seg([0.9, 0], [1.06, 0])).goal.status, GOAL_AWARE_STATUS.NO_GOAL);
  assertEquals(resolve(core(1.06, 1), seg([0.9, 1], [1.06, 1])).goal.status, GOAL_AWARE_STATUS.NO_GOAL);
});

// ===========================================================================
// Score：21-24
// ===========================================================================

test('GA-21. Home score +1', () => {
  assertEquals(resolve(core(1.06, 0.5, BS.IN_TRANSIT, 0, 0), seg([0.9, 0.5], [1.06, 0.5])).matchCore.score, { home: 1, away: 0 });
});

test('GA-22. Away score +1', () => {
  assertEquals(resolve(core(-0.06, 0.5, BS.IN_TRANSIT, 0, 0), seg([0.1, 0.5], [-0.06, 0.5])).matchCore.score, { home: 0, away: 1 });
});

test('GA-23/24. 仅得分侧变化，另一侧保留', () => {
  const home = resolve(core(1.06, 0.5, BS.IN_TRANSIT, 1, 2), seg([0.9, 0.5], [1.06, 0.5]));
  assertEquals(home.matchCore.score, { home: 2, away: 2 }, 'home +1, away 保持');
  const away = resolve(core(-0.06, 0.5, BS.IN_TRANSIT, 3, 1), seg([0.1, 0.5], [-0.06, 0.5]));
  assertEquals(away.matchCore.score, { home: 3, away: 2 }, 'away +1, home 保持');
});

// ===========================================================================
// Idempotency：25-26
// ===========================================================================

test('GA-25. 重复应用同一 Goal Result 不重复加分', () => {
  const end = core(1.06, 0.5);
  const { goal, matchCore } = resolve(end, seg([0.9, 0.5], [1.06, 0.5]));
  const again = applyGoalScoreUpdate(matchCore, goal.resolution);
  assertEquals(again.score, { home: 1, away: 0 }, '不得变为 2-0');
  assert(again === matchCore, '已收敛时应返回同一对象');
});

test('GA-26. 旧 Goal Result 不回滚更高比分', () => {
  const r1 = resolve(core(1.06, 0.5), seg([0.9, 0.5], [1.06, 0.5])).goal.resolution;   // 1-0
  const c1 = applyGoalScoreUpdate(core(1.06, 0.5), r1);
  const r2 = resolve(core(1.06, 0.5, BS.IN_TRANSIT, 1, 0), seg([0.9, 0.5], [1.06, 0.5])).goal.resolution; // 2-0
  const c2 = applyGoalScoreUpdate(c1, r2);
  assertEquals(c2.score, { home: 2, away: 0 });
  const late = applyGoalScoreUpdate(c2, r1);
  assertEquals(late.score, { home: 2, away: 0 }, '旧结果(1-0)不得回滚 2-0');
});

// ===========================================================================
// Immutability：27-29
// ===========================================================================

test('GA-27. Input MatchCore 不变', () => {
  const end = core(1.06, 0.5);
  const snap = JSON.stringify(end);
  resolve(end, seg([0.9, 0.5], [1.06, 0.5]));
  assertEquals(JSON.stringify(end), snap);
});

test('GA-28. 基础 Tick MatchCore 不被原地修改（Driver 集成）', () => {
  const mc = core(0.5, 0.5, BS.CONTROLLED);
  mc.ball.control = 'h_a';
  const snap = JSON.stringify(mc);
  const out = runGoalAwareMatchTick(mc, { tickInput: { tickIndex: 0 } });
  assertEquals(JSON.stringify(mc), snap, '输入 MatchCore 不得被修改');
  assertEquals(out.ok, true);
  assertEquals(out.ballSegment.ok, true);
  assertEquals(out.goal.status, GOAL_AWARE_STATUS.NO_GOAL);
});

test('GA-29. Score Update 返回新 MatchCore', () => {
  const end = core(1.06, 0.5);
  const { matchCore } = resolve(end, seg([0.9, 0.5], [1.06, 0.5]));
  assert(matchCore !== end, '应为新对象');
  assertEquals(matchCore.teams, end.teams, '非 score 字段保持引用');
});

// ===========================================================================
// Architecture：30-37
// ===========================================================================

test('GA-30/31. 不修改 C-15 / C-14（源码守卫：仅复用，不复制规则）', () => {
  const code = codeOnly('goal-aware-match-tick.js');
  assert(/from '\.\/goal-geometry\.js'/.test(code), '必须复用 C-15');
  assert(/from '\.\/goal-resolution\.js'/.test(code), '必须复用 C-14');
  assert(/from '\.\/ball-tick-segment\.js'/.test(code), '必须复用 C-16');
});

test('GA-32/33. 不复制 Goal Geometry / Resolution 规则', () => {
  const code = codeOnly('goal-aware-match-tick.js');
  // 不得重判球门宽度 / x=0|x=1 / 攻防方向 / goal mouth / scoringSide / nextScore。
  assert(!/GOAL_HALF_WIDTH|GOAL_MOUTH|goalMouth|0\.39|0\.61/.test(code), '不得复制球门几何');
  assert(!/x\s*[<>]=?\s*1|x\s*[<>]=?\s*0/.test(code), '不得重判门线位置');
  assert(!/scoringSide\s*[:=]|nextScore\s*[:=]|scoringTeamId\s*[:=]/.test(code), '不得复制 Resolution 规则');
  assert(!/GOAL_CENTER_Y|GOAL_LINE_LEFT_X|GOAL_LINE_RIGHT_X/.test(code), '不得复制几何常量');
});

test('GA-34. 不新增 Score Truth / 无直接 score 写入', () => {
  const code = codeOnly('goal-aware-match-tick.js');
  assert(!/\.score\s*(\+\+|[-+]?=)/.test(code), '不得直接写 score');
  assert(!/score\.home\s*\+\+|score\.away\s*\+\+/.test(code));
  assert(!/goalScore|tickScore|derivedScore|temporaryScoreTruth/.test(code), '不得新增 Score Truth');
  assert(/applyGoalScoreUpdate/.test(code), '写比分必须经 C-14');
});

test('GA-35/36. 无 Math.random / wall clock', () => {
  const code = codeOnly('goal-aware-match-tick.js');
  assert(!/Math\.random\s*\(/.test(code));
  assert(!/Date\.now\s*\(/.test(code) && !/performance\.now\s*\(/.test(code) && !/new\s+Date\s*\(/.test(code));
});

test('GA-37. 无 Ball Physics', () => {
  const code = codeOnly('goal-aware-match-tick.js');
  for (const banned of ['acceleration', 'gravity', 'friction', 'drag', 'bounce', 'spin', 'curve',
    'collision', 'radius', 'integr', 'trajectory', 'interpolat', 'continuous']) {
    assert(!new RegExp(banned, 'i').test(code), `不得实现 ${banned}`);
  }
  // 不建 ledger / history / registry。
  assert(!/ledger|goalHistory|goalIdRegistry|goalEventDatabase/i.test(code));
  // 不调用 C-13 FinalMatchResult。
  assert(!/finalizeMatch|match-result/.test(code));
});

test('GA-38. 不复制 Tick 生命周期（不依赖 C-10 / 不重写 runMatchTick）', () => {
  const code = codeOnly('goal-aware-match-tick.js');
  assert(!/match-ticks\.js/.test(code), '不得依赖 C-10');
  assert(!/function\s+runMatchTick\b/.test(code), '不得重写 runMatchTick');
  assert(/runMatchTickWithBallSegment/.test(code), '必须经 C-16 适配器调用 C-08');
});

test('GA-39. 非法输入拒绝 / 信封形状', () => {
  assertThrows(() => runGoalAwareMatchTick(null), 'TypeError');
  const out = runGoalAwareMatchTick(core(0.5, 0.5, BS.CONTROLLED));
  for (const k of ['ok', 'matchCore', 'tickResult', 'ballSegment', 'goal', 'ruleVersion']) {
    assert(k in out, `信封缺少字段 ${k}`);
  }
  assertEquals(out.ruleVersion, 'goal-aware-match-tick-v1');
});

test('GA-40. 确定性：相同输入 → 相同信封', () => {
  const a = resolve(core(1.06, 0.5, BS.IN_TRANSIT, 0, 0), seg([0.9, 0.5], [1.06, 0.5]));
  const b = resolve(core(1.06, 0.5, BS.IN_TRANSIT, 0, 0), seg([0.9, 0.5], [1.06, 0.5]));
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

test('GA-41. REGULATION_COMPLETE 守卫（复用 C-14）', () => {
  const { goal, matchCore } = resolve(core(1.06, 0.5, BS.IN_TRANSIT, 4, 3), seg([0.9, 0.5], [1.06, 0.5]), { phase: 'REGULATION_COMPLETE' });
  assertEquals(goal.status, GOAL_AWARE_STATUS.NO_GOAL);
  assertEquals(goal.reason, GOAL_AWARE_REASON.RESOLUTION_NO_GOAL);
  assertEquals(matchCore.score, { home: 4, away: 3 });
});