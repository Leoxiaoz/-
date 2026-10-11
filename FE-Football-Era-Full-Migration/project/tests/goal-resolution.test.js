/**
 * Step 39F-M-C-14 —— Goal / Score Resolution Foundation 测试。
 *
 * 覆盖 GOAL-01…GOAL-18：候选归一化 / 确认·拒绝 / 主客队加减分 / 不可变 /
 * Clock·Phase·Teams 隔离 / 幂等 / 终场禁止 / 纯 JSON / 确定性 / guard / C-13 闭合。
 *
 * 红线：不实现球门物理；不改 C-04~C-13；无 Math.random / 墙钟；不建 Event Bus / Ledger。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  deriveGoalCandidate, resolveGoal, applyGoalScoreUpdate, isGoalCandidate, validateGoalResolutionResult,
} from '../src/core/match/goal-resolution.js';
import { GOAL_OUTCOME, GOAL_REASON, GOAL_RESOLUTION_RULE_VERSION } from '../src/core/match/goal-resolution-config.js';
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
const ATTRS = () => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70 });
const mk = (id, t) => ({
  playerId: id, teamId: t, position: 'MF', positionOnPitch: { x: 0.5, y: 0.5 },
  onPitch: true, injured: false, sentOff: false, attributes: ATTRS(), fitness: 100, form: 50, morale: 50, matchLoad: 0,
});
const tac = () => ({ formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' });
function core(scoreHome = 0, scoreAway = 0) {
  return {
    worldId: 'w_go14', season: 2, matchId: 'm_go14', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 30, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: scoreHome, away: scoreAway },
    ball: { position: { x: 0.5, y: 0.5 }, control: 'h_a', possessingTeamId: H, velocity: { x: 0, y: 0 }, state: BS.CONTROLLED },
    players: [mk('h_a', H), mk('a_a', A)],
    tactical: { [H]: tac(), [A]: tac() },
  };
}
const cand = (teamId, playerId = null, extra = {}) => deriveGoalCandidate(core(), { goalCandidate: { teamId, playerId, ...extra } });
const completePhase = () => ({ phase: 'REGULATION_COMPLETE', elapsedSeconds: 5400, half: 2, isBreak: false, isFinished: true });
const completeClock = () => advanceMatchClock(createInitialMatchClock(), REG);

// ===========================================================================
// GOAL-01 / GOAL-02：候选
// ===========================================================================

test('GOAL-01. 合法 Goal Candidate 可以生成（纯数据，无引用）', () => {
  const c = deriveGoalCandidate(core(), { goalCandidate: { teamId: H, playerId: 'h_a', ballState: BS.CONTROLLED, goalId: 'g1' } });
  assertEquals(c.ok, true);
  assertEquals(c.teamId, H);
  assertEquals(c.playerId, 'h_a');
  assertEquals(c.goalId, 'g1');
  assertEquals(isGoalCandidate(c), true);
  // 纯数据：无函数 / 无 MatchCore 引用。
  assert(Object.values(c).every((v) => typeof v !== 'function' && typeof v !== 'object'));
});

test('GOAL-02. 非法 Candidate 被拒绝', () => {
  assertEquals(deriveGoalCandidate(core(), {}), { ok: false, reason: GOAL_REASON.NO_CANDIDATE_SOURCE });
  assertEquals(deriveGoalCandidate(core(), { goalCandidate: { playerId: 'x' } }).reason, GOAL_REASON.INVALID_CANDIDATE);
  assertEquals(deriveGoalCandidate(core(), { goalCandidate: { teamId: 'nope' } }).reason, GOAL_REASON.UNKNOWN_TEAM);
  assertEquals(isGoalCandidate({}), false);
  assertEquals(isGoalCandidate(null), false);
  assertThrows(() => deriveGoalCandidate(null, {}), 'TypeError');
});

// ===========================================================================
// GOAL-03 / GOAL-04：确认 / 非进球
// ===========================================================================

test('GOAL-03. 合法进球得到 GOAL_CONFIRMED', () => {
  const r = resolveGoal(cand(H, 'h_a'), core());
  assertEquals(r.ok, true);
  assertEquals(r.outcome, GOAL_OUTCOME.GOAL_CONFIRMED);
  assertEquals(r.scoringSide, 'home');
  assertEquals(r.scoringTeamId, H);
  assertEquals(r.scoringPlayerId, 'h_a');
  assertEquals(r.nextScore, { home: 1, away: 0 });
  assertEquals(validateGoalResolutionResult(r), { valid: true, issues: [] });
});

test('GOAL-04. 非进球得到 NO_GOAL', () => {
  const r = resolveGoal({ ok: false, reason: 'X' }, core());
  assertEquals(r.ok, false);
  assertEquals(r.outcome, GOAL_OUTCOME.NO_GOAL);
  assertEquals(r.reason, GOAL_REASON.INVALID_CANDIDATE);
  assertEquals(r.nextScore, null);
  assertEquals(validateGoalResolutionResult(r), { valid: true, issues: [] });
});

// ===========================================================================
// GOAL-05 ~ GOAL-08：比分更新
// ===========================================================================

test('GOAL-05. 主队进球 0-0 → 1-0', () => {
  const updated = applyGoalScoreUpdate(core(0, 0), resolveGoal(cand(H), core(0, 0)));
  assertEquals(updated.score, { home: 1, away: 0 });
});

test('GOAL-06. 客队进球 0-0 → 0-1', () => {
  const updated = applyGoalScoreUpdate(core(0, 0), resolveGoal(cand(A), core(0, 0)));
  assertEquals(updated.score, { home: 0, away: 1 });
});

test('GOAL-07. 连续主队进球 1-0 → 2-0', () => {
  const c1 = core(1, 0);
  const updated = applyGoalScoreUpdate(c1, resolveGoal(cand(H), c1));
  assertEquals(updated.score, { home: 2, away: 0 });
});

test('GOAL-08. 双方进球 1-0 → 1-1', () => {
  const c1 = core(1, 0);
  const updated = applyGoalScoreUpdate(c1, resolveGoal(cand(A), c1));
  assertEquals(updated.score, { home: 1, away: 1 });
});

// ===========================================================================
// GOAL-09 ~ GOAL-12：不可变 / 隔离
// ===========================================================================

test('GOAL-09. 输入 MatchCore 不被原地修改', () => {
  const c = core(1, 1);
  const snap = JSON.stringify(c);
  const r = resolveGoal(cand(H), c);
  applyGoalScoreUpdate(c, r);
  assertEquals(JSON.stringify(c), snap);
});

test('GOAL-10. Clock 不被修改（且不依赖 MatchClock / advanceMatchClock）', () => {
  const c = core(0, 0);
  const clkSnap = JSON.stringify(c.clock);
  applyGoalScoreUpdate(c, resolveGoal(cand(H), c));
  assertEquals(JSON.stringify(c.clock), clkSnap);
  const code = readSrc('goal-resolution.js');
  assert(!code.includes('advanceMatchClock'), 'Goal Resolution 不得推进 MatchClock');
  assert(!/['"]\.\/match-clock/.test(code), 'Goal Resolution 不得依赖 MatchClock');
});

test('GOAL-11. Phase 不被修改（且不依赖 MatchPhase 模块）', () => {
  const phase = { phase: 'FIRST_HALF', elapsedSeconds: 100, half: 1, isBreak: false, isFinished: false };
  const snap = JSON.stringify(phase);
  resolveGoal(cand(H), core(), { phase: phase.phase });
  assertEquals(JSON.stringify(phase), snap, 'Phase 对象不得被修改');
  const code = readSrc('goal-resolution.js');
  assert(!/['"]\.\/match-phase/.test(code), 'Goal Resolution 不得依赖 MatchPhase 模块（仅消费 phase 字符串）');
});

test('GOAL-12. Teams 不被修改', () => {
  const c = core(0, 0);
  const updated = applyGoalScoreUpdate(c, resolveGoal(cand(H), c));
  assertEquals(updated.teams, c.teams);
  assertEquals(updated.teams, { home: H, away: A });
});

// ===========================================================================
// GOAL-13 / GOAL-14：幂等 / 终场
// ===========================================================================

test('GOAL-13. 重复应用同一 Goal Result 不重复增加比分（纯状态收敛）', () => {
  const c0 = core(0, 0);
  const r = resolveGoal(cand(H), c0);          // nextScore = { home:1, away:0 }
  const once = applyGoalScoreUpdate(c0, r);
  const twice = applyGoalScoreUpdate(once, r);
  const thrice = applyGoalScoreUpdate(twice, r);
  assertEquals(once.score, { home: 1, away: 0 });
  assertEquals(twice.score, { home: 1, away: 0 }, '重复应用不得变为 2-0');
  assertEquals(thrice.score, { home: 1, away: 0 });
  assert(thrice === twice, '已收敛时应返回同一对象（无变化）');
});

test('GOAL-13b. 收敛单调：乱序应用不倒退', () => {
  const c0 = core(0, 0);
  const r1 = resolveGoal(cand(H), c0);                 // 1-0
  const c1 = applyGoalScoreUpdate(c0, r1);
  const r2 = resolveGoal(cand(H), c1);                 // 2-0
  const c2 = applyGoalScoreUpdate(c1, r2);
  const late = applyGoalScoreUpdate(c2, r1);           // 再应用旧结果
  assertEquals(late.score, { home: 2, away: 0 }, '旧结果不得把比分降回 1-0');
});

test('GOAL-14. Finalization 后不得继续进球', () => {
  const c = core(2, 1);
  const r = resolveGoal(cand(H), c, { phase: 'REGULATION_COMPLETE' });
  assertEquals(r.ok, false);
  assertEquals(r.outcome, GOAL_OUTCOME.NO_GOAL);
  assertEquals(r.reason, GOAL_REASON.PHASE_TERMINAL);
  // 应用该 NO_GOAL 结果不改比分。
  assertEquals(applyGoalScoreUpdate(c, r).score, { home: 2, away: 1 });
});

// ===========================================================================
// GOAL-15 ~ GOAL-18：纯 JSON / 确定性 / guard
// ===========================================================================

test('GOAL-15. Result 是纯 JSON 数据', () => {
  const r = resolveGoal(cand(H, 'h_a'), core());
  assertEquals(JSON.parse(JSON.stringify(r)), r);
  assert(Object.values(r).every((v) => typeof v !== 'function'));
  const ng = resolveGoal({ ok: false }, core());
  assertEquals(JSON.parse(JSON.stringify(ng)), ng);
});

test('GOAL-16. 确定性检查', () => {
  const a = resolveGoal(cand(H, 'h_a'), core(1, 1));
  const b = resolveGoal(cand(H, 'h_a'), core(1, 1));
  assertEquals(JSON.stringify(a), JSON.stringify(b));
  const c = applyGoalScoreUpdate(core(1, 1), a);
  const d = applyGoalScoreUpdate(core(1, 1), b);
  assertEquals(JSON.stringify(c), JSON.stringify(d));
});

test('GOAL-17. 无 Math.random', () => {
  for (const f of ['goal-resolution.js', 'goal-resolution-config.js']) {
    assert(!/Math\.random\s*\(/.test(readSrc(f)), `${f} 出现 Math.random`);
  }
});

test('GOAL-18. 无 wall clock', () => {
  for (const f of ['goal-resolution.js', 'goal-resolution-config.js']) {
    const s = readSrc(f);
    assert(!/Date\.now\s*\(/.test(s), `${f} 依赖 Date.now`);
    assert(!/performance\.now\s*\(/.test(s), `${f} 依赖 performance.now`);
    assert(!/new\s+Date\s*\(/.test(s), `${f} 依赖 new Date`);
  }
});

// ===========================================================================
// 附加：校验 / 链路闭合 / 架构
// ===========================================================================

test('GOAL-19. 非法 GoalResolutionResult 被拒绝', () => {
  const good = resolveGoal(cand(H), core());
  const bad = [
    { ...good, outcome: 'MAYBE' },
    { ...good, ruleVersion: 'x' },
    { ...good, scoringSide: 'middle' },
    { ...good, nextScore: { home: NaN, away: 0 } },
    { ...good, nextScore: { home: -1, away: 0 } },
    { ...good, extra: 1 },
    null,
  ];
  for (const r of bad) assertEquals(validateGoalResolutionResult(r).valid, false, `应拒绝: ${JSON.stringify(r)}`);
  assertEquals(validateGoalResolutionResult(good).valid, true);
});

test('GOAL-20. 链路闭合：Goal → Score Update → matchCore.score → C-13 FinalMatchResult', () => {
  const c = core(0, 0);
  const r = resolveGoal(cand(H, 'h_a'), c);
  const updated = applyGoalScoreUpdate(c, r);
  assertEquals(updated.score, { home: 1, away: 0 });
  // C-13 直接读取更新后的 Score Truth。
  const final = finalizeMatch(updated, completePhase(), completeClock());
  assertEquals(final.ok, true);
  assertEquals(final.home, { teamId: H, score: 1 });
  assertEquals(final.away, { teamId: A, score: 0 });
});

test('GOAL-21. Architecture：Score Truth 唯一，无第二套比分字段', () => {
  const code = readSrc('goal-resolution.js');
  assert(/matchCore\.score|\.score/.test(code), '必须写入既有 matchCore.score');
  // 仅禁止「新增第二套比分字段（声明 / 赋值）」，不禁止函数名（如 applyGoalScoreUpdate）。
  assert(!/\b(homeScore|awayScore|goalScore|finalScore|scoreboardScore)\b\s*[:=]/i.test(code), '不得新建第二套比分字段');
  // 不建 Event Bus / Ledger（检查实际实现，而非注释说明）。
  assert(!/class\s+\w*(EventBus|EventStore|Ledger)\b|EventSourcing|\bGoalEventBus\b/.test(code));
  // 主客队身份取自 teams，不新建身份 Truth。
  assert(/matchCore\?\.teams|teams\.home|teams\.away/.test(code));
});