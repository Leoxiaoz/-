/**
 * Step 39F-M-C-13 —— Match Result / Finalization Foundation 测试。
 *
 * 覆盖 FR-01…FR-22：终场门控 / 时间·阶段·状态 / 不可变 / 快照解耦 /
 * 重复终结一致性 / 校验 / guard / Score Truth 复用 / Architecture。
 *
 * 红线：不改 C-04~C-12；不接 Renderer / Save·Schema / 赛后系统；无 Math.random / 墙钟。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createFinalMatchResult, validateFinalMatchResult, isMatchFinalizable, finalizeMatch,
} from '../src/core/match/match-result.js';
import { MATCH_RESULT_STATUS } from '../src/core/match/match-result-config.js';
import { createInitialMatchPhase } from '../src/core/match/match-phase.js';
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
    worldId: 'w_mr13', season: 3, matchId: 'm_mr13', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 90, matchDuration: 90, half: 2, status: 'complete' },
    score: { home: scoreHome, away: scoreAway },
    ball: { position: { x: 0.5, y: 0.5 }, control: 'h_a', possessingTeamId: H, velocity: { x: 0, y: 0 }, state: BS.CONTROLLED },
    players: [mk('h_a', H)],
    tactical: { [H]: tac(), [A]: tac() },
  };
}
const PH = (phase, elapsedSeconds, half, isBreak, isFinished) => ({ phase, elapsedSeconds, half, isBreak, isFinished });
const pNotStarted = () => createInitialMatchPhase();
const pFirstHalf = () => PH('FIRST_HALF', 100, 1, false, false);
const pHalftime = () => PH('HALFTIME', 2700, 1, true, false);
const pSecondHalf = () => PH('SECOND_HALF', 3000, 2, false, false);
const pComplete = () => PH('REGULATION_COMPLETE', 5400, 2, false, true);
const cComplete = () => advanceMatchClock(createInitialMatchClock(), REG);

// ===========================================================================
// FR-01 ~ FR-05：终场门控
// ===========================================================================

test('FR-01. 初始 / 未开始比赛不能 Finalize', () => {
  assertEquals(isMatchFinalizable(pNotStarted()), false);
  const res = finalizeMatch(core(), pNotStarted(), createInitialMatchClock());
  assertEquals(res.ok, false);
  assertEquals(res.status, 'NOT_FINALIZABLE');
  assertEquals(res.phase, 'NOT_STARTED');
  assertEquals(res.reason, 'MATCH_NOT_REGULATION_COMPLETE');
});

test('FR-02. FIRST_HALF 不能 Finalize', () => {
  assertEquals(isMatchFinalizable(pFirstHalf()), false);
  assertEquals(finalizeMatch(core(), pFirstHalf(), advanceMatchClock(createInitialMatchClock(), 100)).ok, false);
});

test('FR-03. HALFTIME 不能 Finalize', () => {
  assertEquals(isMatchFinalizable(pHalftime()), false);
  assertEquals(finalizeMatch(core(), pHalftime(), advanceMatchClock(createInitialMatchClock(), 2700)).ok, false);
});

test('FR-04. SECOND_HALF 不能 Finalize', () => {
  assertEquals(isMatchFinalizable(pSecondHalf()), false);
  assertEquals(finalizeMatch(core(), pSecondHalf(), advanceMatchClock(createInitialMatchClock(), 3000)).ok, false);
});

test('FR-05. REGULATION_COMPLETE 可以 Finalize', () => {
  assertEquals(isMatchFinalizable(pComplete()), true);
  const res = finalizeMatch(core(2, 1), pComplete(), cComplete());
  assertEquals(res.ok, true);
});

// ===========================================================================
// FR-06 ~ FR-08：时间 / 阶段 / 状态
// ===========================================================================

test('FR-06/07/08. 最终时间 5400 / phase REGULATION_COMPLETE / status FINAL', () => {
  const res = finalizeMatch(core(3, 0), pComplete(), cComplete());
  assertEquals(res.elapsedSeconds, REG);
  assertEquals(res.elapsedSeconds, 5400);
  assertEquals(res.phase, 'REGULATION_COMPLETE');
  assertEquals(res.status, MATCH_RESULT_STATUS.FINAL);
  assertEquals(res.status, 'FINAL');
});

// ===========================================================================
// FR-09 ~ FR-11：不可变
// ===========================================================================

test('FR-09/10/11. Finalization 不修改 MatchCore / Phase / Clock', () => {
  const mc = core(1, 2);
  const ph = pComplete();
  const clk = cComplete();
  const s = [JSON.stringify(mc), JSON.stringify(ph), JSON.stringify(clk)];
  finalizeMatch(mc, ph, clk);
  finalizeMatch(mc, ph, clk);
  assertEquals(JSON.stringify(mc), s[0]);
  assertEquals(JSON.stringify(ph), s[1]);
  assertEquals(JSON.stringify(clk), s[2]);
});

// ===========================================================================
// FR-12 ~ FR-14：重复一致性 / 解耦 / 可序列化
// ===========================================================================

test('FR-12. 重复 Finalization 结果完全一致', () => {
  const a = finalizeMatch(core(2, 2), pComplete(), cComplete());
  const b = finalizeMatch(core(2, 2), pComplete(), cComplete());
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

test('FR-13. 结果不持有可变 MatchCore / Phase / Clock 引用', () => {
  const mc = core(1, 0);
  const res = finalizeMatch(mc, pComplete(), cComplete());
  assert(res.home !== mc.score, 'home 不得引用 score Truth');
  assert(res.away !== mc.score, 'away 不得引用 score Truth');
  assert(res.home !== mc.teams, 'home 不得引用 teams Truth');
  assert(res !== mc, '结果不得是 MatchCore');
  // 修改结果不应影响来源。
  res.home.score = 99;
  res.away.score = 99;
  assertEquals(mc.score, { home: 1, away: 0 });
});

test('FR-14. 结果 JSON 可稳定序列化', () => {
  const res = finalizeMatch(core(1, 1), pComplete(), cComplete());
  const json = JSON.stringify(res);
  assertEquals(JSON.parse(json), res);
  assert(Object.keys(res).every((k) => typeof res[k] !== 'function'));
});

// ===========================================================================
// FR-15：校验
// ===========================================================================

test('FR-15. 非法 FinalMatchResult 能被拒绝', () => {
  const good = finalizeMatch(core(1, 0), pComplete(), cComplete());
  assertEquals(validateFinalMatchResult(good), { valid: true, issues: [] });

  const bad = [
    { ...good, status: 'DRAFT' },
    { ...good, phase: 'FIRST_HALF' },
    { ...good, elapsedSeconds: 2700 },
    { ...good, elapsedSeconds: NaN },
    { ...good, elapsedSeconds: Infinity },
    { ...good, home: { teamId: H, score: NaN } },
    { ...good, away: { teamId: A, score: -1 } },
    { ...good, home: null },
    { ...good, extraField: 1 },
    { ...good, home: { teamId: H, score: 0, extra: 1 } },
    null,
  ];
  for (const r of bad) assertEquals(validateFinalMatchResult(r).valid, false, `应拒绝: ${JSON.stringify(r)}`);
});

// ===========================================================================
// FR-16 ~ FR-18：guard / architecture
// ===========================================================================

test('FR-16. 无 Math.random', () => {
  for (const f of ['match-result.js', 'match-result-config.js']) {
    assert(!/Math\.random\s*\(/.test(readSrc(f)), `${f} 出现 Math.random`);
  }
});

test('FR-17. 无 Wall Clock', () => {
  for (const f of ['match-result.js', 'match-result-config.js']) {
    const s = readSrc(f);
    assert(!/Date\.now\s*\(/.test(s), `${f} 依赖 Date.now`);
    assert(!/performance\.now\s*\(/.test(s), `${f} 依赖 performance.now`);
    assert(!/new\s+Date\s*\(/.test(s), `${f} 依赖 new Date`);
  }
});

test('FR-18. Architecture / Truth 检查', () => {
  // 不新增比赛生命周期阶段。
  const cfg = readSrc('match-result-config.js');
  for (const banned of ['FINALIZING', 'FINALIZED', 'SETTLED', 'ARCHIVED']) {
    // 仅禁止作为「枚举值 / 字段」引入，不禁止注释说明。
    assert(!new RegExp(`['"]${banned}['"]`).test(cfg), `不得引入新阶段 ${banned}`);
    assert(!new RegExp(`\\b${banned}\\s*:`).test(cfg), `不得引入新阶段字段 ${banned}`);
  }
  // Finalization 不得反向依赖 Decision / Interaction / Ball Physics。
  const code = readSrc('match-result.js');
  for (const dep of ['decision-pipeline', 'interaction-resolution', 'second-ball-resolution', 'ball-physics', 'interaction-integration']) {
    assert(!code.includes(`'./${dep}.js'`), `match-result 不得依赖 ${dep}`);
  }
  // 仅读取既有 Truth：出现 score 时必须取自 matchCore.score，不得自建比分字段。
  assert(/matchCore\.score/.test(code), '必须读取既有 matchCore.score');
  assert(!/homeScore|awayScore/.test(code), '不得新建 homeScore/awayScore');
});

// ===========================================================================
// FR-19 ~ FR-22：Score Truth 复用
// ===========================================================================

test('FR-19. 最终比分正确复制官方 Score Truth', () => {
  const mc = core(4, 3);
  const res = finalizeMatch(mc, pComplete(), cComplete());
  assertEquals(res.home, { teamId: H, score: 4 });
  assertEquals(res.away, { teamId: A, score: 3 });
});

test('FR-20. 不得创建第二套 Score Truth', () => {
  const mc = core(1, 1);
  const res = finalizeMatch(mc, pComplete(), cComplete());
  // 结果中的比分来自 matchCore.score，二者在值上一致（非独立 truth）。
  assertEquals(res.home.score, mc.score.home);
  assertEquals(res.away.score, mc.score.away);
  // 结果顶层不出现独立比分字段。
  assert(!('homeScore' in res) && !('awayScore' in res));
});

test('FR-21. 改变输入 Score 后，结果正确反映新的官方 Score', () => {
  const a = finalizeMatch(core(0, 0), pComplete(), cComplete());
  const b = finalizeMatch(core(5, 1), pComplete(), cComplete());
  assertEquals([a.home.score, a.away.score], [0, 0]);
  assertEquals([b.home.score, b.away.score], [5, 1]);
});

test('FR-22. FinalMatchResult 是比分 Snapshot，而不是 Score Truth', () => {
  const mc = core(2, 1);
  const res = finalizeMatch(mc, pComplete(), cComplete());
  res.home.score = 100; // 篡改快照
  assertEquals(mc.score, { home: 2, away: 1 }, '官方 Score Truth 不受快照篡改影响');
});

test('FR-23. 非终场拒绝信息确定性一致', () => {
  const a = finalizeMatch(core(), pSecondHalf(), advanceMatchClock(createInitialMatchClock(), 3000));
  const b = finalizeMatch(core(), pSecondHalf(), advanceMatchClock(createInitialMatchClock(), 3000));
  assertEquals(JSON.stringify(a), JSON.stringify(b));
  assertEquals(validateFinalMatchResult(a).valid, false, '拒绝信封不是 FinalMatchResult');
});

test('FR-24. createFinalMatchResult 严格：非终场 / 时间不一致抛出', () => {
  assertThrows(() => createFinalMatchResult(core(), pSecondHalf(), advanceMatchClock(createInitialMatchClock(), 3000)), 'TypeError');
  assertThrows(() => createFinalMatchResult(core(), pComplete(), advanceMatchClock(createInitialMatchClock(), 4000)), 'TypeError');
  // 终场阶段 + 正确时间 → 成功。
  assertEquals(createFinalMatchResult(core(), pComplete(), cComplete()).ok, true);
});