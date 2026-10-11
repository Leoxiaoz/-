/**
 * Step 39F-M-C-18 —— Goal-Aware Multi-Tick Driver 测试。
 *
 * 覆盖 Driver / Score Continuity / MatchCore Continuity / Goal Pipeline / Immutability / Failure /
 * Determinism / Calibration / Architecture。
 *
 * 说明：真实 C-08 Tick 的球位移极小、无法稳定越线，因此「进球累积」类用例通过注入
 * C-17 兼容的 scripted tickDriver（内部仍调用 C-17 导出的 resolveGoalFromSegment）来
 * 确定性驱动；NO_GOAL / 链路 / 架构用例走真实 C-17 默认路径。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runGoalAwareMatchTicks } from '../src/core/match/goal-aware-match-ticks.js';
import { runGoalAwareMatchTick, resolveGoalFromSegment } from '../src/core/match/goal-aware-match-tick.js';
import { deriveBallTickSegment } from '../src/core/match/ball-tick-segment.js';
import { runMatchTicks } from '../src/core/match/match-ticks.js';
import { INTERACTION_BALL_STATE as BS } from '../src/core/match/interaction-resolution-config.js';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const codeOnly = () => readFileSync(join(SRC_DIR, 'goal-aware-match-ticks.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

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
    worldId: 'w_ga18', season: 1, matchId: 'm_ga18', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: sh, away: sa },
    ball: { position: { x, y }, control: null, possessingTeamId: H, velocity: { x: 0, y: 0 }, state },
    players: [mk('h_a', H), mk('a_a', A)],
    tactical: { [H]: tac(), [A]: tac() },
  };
}

/**
 * Scripted C-17 兼容 tickDriver：按脚本产生 home/away/none 进球。
 * 内部走 C-17 的 resolveGoalFromSegment（复用 C-15 + C-14），不复制 Goal 规则。
 */
function scriptedDriver(script) {
  let i = 0;
  return (matchCore, options) => {
    const step = script[i] ?? 'none'; i += 1;
    let p0, p1;
    if (step === 'home') { p0 = [0.9, 0.5]; p1 = [1.06, 0.5]; }
    else if (step === 'away') { p0 = [0.1, 0.5]; p1 = [-0.06, 0.5]; }
    else { p0 = [0.4, 0.5]; p1 = [0.6, 0.5]; }
    const startCore = { ...matchCore, ball: { ...matchCore.ball, position: { x: p0[0], y: p0[1] }, state: BS.IN_TRANSIT } };
    const endCore = { ...startCore, ball: { ...startCore.ball, position: { x: p1[0], y: p1[1] }, state: BS.IN_TRANSIT } };
    const segment = deriveBallTickSegment(startCore, endCore);
    const { goal, matchCore: out } = resolveGoalFromSegment(endCore, segment, { phase: options.phase });
    return { ok: true, matchCore: out, tickResult: { tick: { status: 'COMPLETED' }, events: [], invariantIssues: [] }, ballSegment: segment, goal, ruleVersion: 'scripted' };
  };
}

// ===========================================================================
// Driver：1-6
// ===========================================================================

test('GAT-01. tickCount = 0：不执行任何 Tick，返回输入逻辑等价', () => {
  const mc = core(0.5, 0.5);
  const out = runGoalAwareMatchTicks(mc, 0);
  assertEquals(out.ok, true);
  assertEquals(out.ticksExecuted, 0);
  assertEquals(out.ticks.length, 0);
  assert(out.matchCore === mc, 'tickCount=0 应返回同一 MatchCore');
});

test('GAT-02. tickCount = 1：只执行一次（真实 C-17 路径）', () => {
  const mc = core(0.5, 0.5, BS.CONTROLLED);
  mc.ball.control = 'h_a';
  const out = runGoalAwareMatchTicks(mc, 1, { tickInput: { tickIndex: 0 } });
  assertEquals(out.ok, true);
  assertEquals(out.ticksExecuted, 1);
  assertEquals(out.ticks.length, 1);
  assertEquals(out.matchCore.score, { home: 0, away: 0 });
});

test('GAT-03/04/05/06. tickCount = N：精确执行 N 次', () => {
  const mc = core(0.4, 0.5, BS.CONTROLLED); mc.ball.control = 'h_a';
  for (const n of [0, 1, 2, 5]) {
    const out = runGoalAwareMatchTicks(mc, n, { tickInput: { tickIndex: 0 } });
    assertEquals(out.ticksExecuted, n, `N=${n} 应执行 ${n} 次`);
    assertEquals(out.ticks.length, n);
  }
});

// ===========================================================================
// Score Continuity：7-12
// ===========================================================================

test('GAT-07. 0:0 → 1:0（Home Goal）', () => {
  const out = runGoalAwareMatchTicks(core(0.5, 0.5), 1, { tickDriver: scriptedDriver(['home']) });
  assertEquals(out.matchCore.score, { home: 1, away: 0 });
});

test('GAT-08. 1:0 → 1:1（Home 后 Away）', () => {
  const out = runGoalAwareMatchTicks(core(0.5, 0.5), 2, { tickDriver: scriptedDriver(['home', 'away']) });
  assertEquals(out.matchCore.score, { home: 1, away: 1 });
});

test('GAT-09. 连续 Home Goals：0:0 → 2:0', () => {
  const out = runGoalAwareMatchTicks(core(0.5, 0.5), 2, { tickDriver: scriptedDriver(['home', 'home']) });
  assertEquals(out.matchCore.score, { home: 2, away: 0 });
});

test('GAT-10. 连续 Away Goals：0:0 → 0:2', () => {
  const out = runGoalAwareMatchTicks(core(0.5, 0.5), 2, { tickDriver: scriptedDriver(['away', 'away']) });
  assertEquals(out.matchCore.score, { home: 0, away: 2 });
});

test('GAT-11. 交替进球：0:0→1:0→1:1→2:1→2:2', () => {
  const out = runGoalAwareMatchTicks(core(0.5, 0.5), 4, { tickDriver: scriptedDriver(['home', 'away', 'home', 'away']) });
  assertEquals(out.matchCore.score, { home: 2, away: 2 });
  const seq = out.ticks.map((t) => t.matchCore.score);
  assertEquals(JSON.stringify(seq), JSON.stringify([
    { home: 1, away: 0 }, { home: 1, away: 1 }, { home: 2, away: 1 }, { home: 2, away: 2 },
  ]));
});

test('GAT-12. NO_GOAL 保持 Score：1:0 → 1:0 → 1:0 → 1:1', () => {
  const out = runGoalAwareMatchTicks(core(0.5, 0.5), 4, { tickDriver: scriptedDriver(['home', 'none', 'none', 'away']) });
  assertEquals(out.matchCore.score, { home: 1, away: 1 });
  assertEquals(out.ticks[1].matchCore.score, { home: 1, away: 0 });
  assertEquals(out.ticks[2].matchCore.score, { home: 1, away: 0 });
});

// ===========================================================================
// MatchCore Continuity：13-17
// ===========================================================================

test('GAT-13. Tick N output → Tick N+1 input（逻辑连续）', () => {
  const out = runGoalAwareMatchTicks(core(0.5, 0.5), 3, { tickDriver: scriptedDriver(['home', 'away', 'home']) });
  for (let i = 0; i + 1 < out.ticks.length; i += 1) {
    assert(out.ticks[i].matchCore === out.ticks[i + 1].inputMatchCore, `tick${i}→tick${i + 1} 应连续`);
  }
});

test('GAT-14/15/16/17. Ball / Score / Clock 连续性', () => {
  const out = runGoalAwareMatchTicks(core(0.5, 0.5), 2, { tickDriver: scriptedDriver(['home', 'away']) });
  // Ball：每 Tick 的 ball 来自上一 Tick 输出（引用级连续）。
  assert(out.ticks[1].inputMatchCore === out.ticks[0].matchCore);
  assertEquals(out.ticks[1].inputMatchCore.score, { home: 1, away: 0 }, 'Score 连续');
  assertEquals(out.ticks[1].inputMatchCore.clock, out.ticks[0].matchCore.clock, 'Clock 保持');
});

// ===========================================================================
// Goal Pipeline：18-22
// ===========================================================================

test('GAT-18/19. C-17 被调用；C-17 负责 Goal Detection', () => {
  const mc = core(0.4, 0.5, BS.CONTROLLED); mc.ball.control = 'h_a';
  const out = runGoalAwareMatchTicks(mc, 1, { tickInput: { tickIndex: 0 } });
  assert('goal' in out.ticks[0], 'trace 应含 C-17 goal');
  assert('ballSegment' in out.ticks[0], 'trace 应含 C-16 segment');
});

test('GAT-20/21/22. C-18 不直接调用 C-14 / C-15，不复制 Goal Logic', () => {
  const code = codeOnly();
  assert(!/from '\.\/goal-resolution\.js'/.test(code), '不得直接依赖 C-14');
  assert(!/from '\.\/goal-geometry\.js'/.test(code), '不得直接依赖 C-15');
  assert(!/resolveGoal|applyGoalScoreUpdate|detectGoalLineCrossing|createGoalCandidate/.test(code), '不得直接调用 C-14/C-15');
  assert(/from '\.\/goal-aware-match-tick\.js'/.test(code), '必须依赖 C-17');
});

// ===========================================================================
// Immutability：23-25
// ===========================================================================

test('GAT-23. Input MatchCore 不变', () => {
  const mc = core(0.5, 0.5);
  const snap = JSON.stringify(mc);
  runGoalAwareMatchTicks(mc, 3, { tickDriver: scriptedDriver(['home', 'away', 'home']) });
  assertEquals(JSON.stringify(mc), snap);
});

test('GAT-24. Tick 结果不被下一 Tick 原地修改', () => {
  const out = runGoalAwareMatchTicks(core(0.5, 0.5), 2, { tickDriver: scriptedDriver(['home', 'away']) });
  assertEquals(out.ticks[0].matchCore.score, { home: 1, away: 0 }, 'tick0 结果不被 tick1 覆盖');
});

test('GAT-25. Score 不被 Driver 直接原地修改', () => {
  const code = codeOnly();
  assert(!/score\.home\s*\+\+|score\.away\s*\+\+/.test(code));
  assert(!/\.score\s*[-+]?=/.test(code), '不得直接写 score');
});

// ===========================================================================
// Failure：26-28
// ===========================================================================

test('GAT-26/27/28. Tick 失败立即停止 + failedAtTick + 不执行剩余', () => {
  let calls = 0;
  const failDriver = (matchCore) => {
    calls += 1;
    if (calls === 2) return { ok: true, matchCore, tickResult: { tick: { status: 'INVALID' }, events: [{ type: 'TICK_INVALID', reason: 'X' }], invariantIssues: [] }, ballSegment: { ok: true, moved: false }, goal: { status: 'NO_GOAL' } };
    return { ok: true, matchCore, tickResult: { tick: { status: 'COMPLETED' }, events: [], invariantIssues: [] }, ballSegment: { ok: true, moved: false }, goal: { status: 'NO_GOAL' } };
  };
  const out = runGoalAwareMatchTicks(core(0.5, 0.5), 5, { tickDriver: failDriver });
  assertEquals(out.ok, false);
  assertEquals(out.failedTickIndex, 1);
  assertEquals(out.ticksExecuted, 1);
  assertEquals(calls, 2, '失败后不得继续执行剩余 Tick');
  assertEquals(out.error.code, 'TICK_NOT_COMPLETED');
});

test('GAT-26b. 异常被包装并停止（TICK_THREW）', () => {
  let calls = 0;
  const throwDriver = (matchCore) => { calls += 1; if (calls === 1) throw new Error('boom'); return { ok: true, matchCore, tickResult: { tick: { status: 'COMPLETED' }, events: [], invariantIssues: [] }, ballSegment: { ok: true, moved: false }, goal: { status: 'NO_GOAL' } }; };
  const out = runGoalAwareMatchTicks(core(0.5, 0.5), 3, { tickDriver: throwDriver });
  assertEquals(out.ok, false);
  assertEquals(out.error.code, 'TICK_THREW');
  assertEquals(out.failedTickIndex, 0);
  assertEquals(calls, 1);
});

// ===========================================================================
// Determinism：29-31
// ===========================================================================

test('GAT-29. 相同输入 → 相同输出', () => {
  const run = () => runGoalAwareMatchTicks(core(0.5, 0.5), 4, { tickDriver: scriptedDriver(['home', 'away', 'home', 'away']) });
  assertEquals(JSON.stringify(run()), JSON.stringify(run()));
});

test('GAT-30/31. 无 Math.random / wall clock', () => {
  const code = codeOnly();
  assert(!/Math\.random\s*\(/.test(code));
  assert(!/Date\.now\s*\(/.test(code) && !/performance\.now\s*\(/.test(code) && !/new\s+Date\s*\(/.test(code));
});

// ===========================================================================
// Calibration：32-33
// ===========================================================================

test('GAT-32/33. Calibration 原样透传，每 Tick 不意外改变', () => {
  const seen = [];
  const spyDriver = (matchCore, options) => {
    seen.push(options.calibrationProfile);
    return { ok: true, matchCore, tickResult: { tick: { status: 'COMPLETED' }, events: [], invariantIssues: [] }, ballSegment: { ok: true, moved: false }, goal: { status: 'NO_GOAL' } };
  };
  const profile = { calibrationVersion: 'C09-v1', discipline: 'interaction' };
  runGoalAwareMatchTicks(core(0.5, 0.5), 3, { tickDriver: spyDriver, calibrationProfile: profile });
  assertEquals(seen.length, 3);
  for (const p of seen) assert(p === profile, 'Calibration 应逐 Tick 原样透传同一引用');
});

// ===========================================================================
// Architecture：34-38
// ===========================================================================

test('GAT-34. 不产生第二套 Ball Truth', () => {
  const code = codeOnly();
  assert(!/previousBallPosition|ballHistory|trajectory|ballTruth/.test(code));
});

test('GAT-35. 不产生第二套 Score Truth', () => {
  const code = codeOnly();
  assert(!/goalScore|tickScore|derivedScore|temporaryScoreTruth/.test(code));
});

test('GAT-36/37. 无 Goal Ledger / 无 MatchCore Goal History', () => {
  const code = codeOnly();
  assert(!/ledger|goalHistory|goalIdRegistry|goalEventDatabase/i.test(code));
  assert(!/matchCore\.goals|matchCore\.events/.test(code));
});

test('GAT-38. 不产生新的 Tick Counter（复用 startTickIndex 语义）', () => {
  const mc = core(0.5, 0.5); mc.tickIndex = 7;
  const idx = [];
  const spy = (m, o) => { idx.push(o.tickInput.tickIndex); return { ok: true, matchCore: m, tickResult: { tick: { status: 'COMPLETED' }, events: [], invariantIssues: [] }, ballSegment: { ok: true, moved: false }, goal: { status: 'NO_GOAL' } }; };
  runGoalAwareMatchTicks(mc, 3, { tickDriver: spy });
  assertEquals(JSON.stringify(idx), JSON.stringify([7, 8, 9]), '应从 matchCore.tickIndex 连续递增');
});

test('GAT-39. C-10 未被修改：普通 runMatchTicks 不产生 Goal 语义', () => {
  const mc = core(0.5, 0.5, BS.CONTROLLED); mc.ball.control = 'h_a';
  const out = runMatchTicks(mc, 2, { tickInput: { tickIndex: 0 } });
  assertEquals(out.ok, true);
  assertEquals(out.matchCore.score, { home: 0, away: 0 });
  assert(!('goal' in out), 'C-10 不应有 goal 字段');
});

test('GAT-40. 非法 tickCount 拒绝', () => {
  for (const bad of [-1, 1.5, NaN, Infinity, '2', null, undefined]) {
    const out = runGoalAwareMatchTicks(core(0.5, 0.5), bad);
    assertEquals(out.ok, false, `tickCount=${String(bad)} 应拒绝`);
    assertEquals(out.ticksExecuted, 0);
  }
});

test('GAT-41. 确定性信封：真实 C-17 路径 NO_GOAL', () => {
  const mk2 = () => { const m = core(0.5, 0.5, BS.CONTROLLED); m.ball.control = 'h_a'; return m; };
  const a = runGoalAwareMatchTicks(mk2(), 2, { tickInput: { tickIndex: 0 } });
  const b = runGoalAwareMatchTicks(mk2(), 2, { tickInput: { tickIndex: 0 } });
  assertEquals(a.ok, true);
  assertEquals(a.matchCore.score, { home: 0, away: 0 });
  assertEquals(JSON.stringify(a.ticks.map((t) => t.goal)), JSON.stringify(b.ticks.map((t) => t.goal)));
});