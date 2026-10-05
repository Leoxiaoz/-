/**
 * Step 39F-M-C-12 —— Match Phase Lifecycle Foundation 测试。
 *
 * 覆盖 MP-01…MP-27：初始 / 开始 / 上半场 / 2700 中场 / 下半场显式开始 /
 * 5400 结束 / clamp / 非法跳转 / 不可变 / 确定性 / guard / 边界批量停止 / C-10·C-11 回归。
 *
 * 红线：不接 Production Loop / Renderer / Save·Schema；不改 C-04~C-11；无 Math.random / 墙钟。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createInitialMatchPhase, startMatch, startSecondHalf, advanceMatchPhase,
  validateMatchPhase, isMatchPhaseTerminal, isMatchPhasePaused, isLegalPhaseTransition,
  ticksAllowedInPhase, runMatchPhaseDriver,
} from '../src/core/match/match-phase.js';
import {
  MATCH_LIFECYCLE_PHASES as P, HALF_DURATION_SECONDS,
} from '../src/core/match/match-phase-config.js';
import {
  createInitialMatchClock, advanceMatchClock, runMatchClockDriver,
} from '../src/core/match/match-clock.js';
import { MATCH_CLOCK_CONFIG } from '../src/core/match/match-clock-config.js';
import { runMatchTicks } from '../src/core/match/match-ticks.js';
import { INTERACTION_BALL_STATE as BS } from '../src/core/match/interaction-resolution-config.js';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');
const REG = MATCH_CLOCK_CONFIG.REGULATION_DURATION_SECONDS;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const H = 'clb_h', A = 'clb_a';
const ATTRS = (o = {}) => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...o });
const mk = (id, t, pos, x, y) => ({
  playerId: id, teamId: t, position: pos, positionOnPitch: { x, y },
  onPitch: true, injured: false, sentOff: false, attributes: ATTRS(), fitness: 100, form: 50, morale: 50, matchLoad: 0,
});
const tac = () => ({ formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' });
function idleCore() {
  return {
    worldId: 'w_mp12', season: 1, matchId: 'm_mp12', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball: { position: { x: 0.5, y: 0.5 }, control: 'h_a', possessingTeamId: H, velocity: { x: 0, y: 0 }, state: BS.CONTROLLED },
    players: [mk('h_a', H, 'MF', 0.5, 0.5)],
    tactical: { [H]: tac(), [A]: tac() },
  };
}
const clockAt = (sec) => advanceMatchClock(createInitialMatchClock(), sec);

// ===========================================================================
// MP-01 ~ MP-03：初始 / 开始
// ===========================================================================

test('MP-01. 初始状态正确（NOT_STARTED / 0 / half 0）', () => {
  const ph = createInitialMatchPhase();
  assertEquals(ph, { phase: P.NOT_STARTED, elapsedSeconds: 0, half: 0, isBreak: false, isFinished: false });
  assertEquals(validateMatchPhase(ph), { valid: true, issues: [] });
  assertEquals(isMatchPhaseTerminal(ph), false);
});

test('MP-02. NOT_STARTED → FIRST_HALF（startMatch）', () => {
  const ph = startMatch(createInitialMatchPhase());
  assertEquals(ph, { phase: P.FIRST_HALF, elapsedSeconds: 0, half: 1, isBreak: false, isFinished: false });
  assertEquals(validateMatchPhase(ph), { valid: true, issues: [] });
});

test('MP-03. 开始比赛不推进时间；未开始不得执行 Tick', () => {
  const ph = startMatch(createInitialMatchPhase());
  assertEquals(ph.elapsedSeconds, 0);
  // NOT_STARTED 状态直接请求 Tick → 不执行。
  const res = runMatchPhaseDriver(idleCore(), createInitialMatchPhase(), createInitialMatchClock(), 5);
  assertEquals(res.ticksExecuted, 0);
  assertEquals(res.ticks, []);
  assertEquals(res.lifecycle, 'PAUSED_NOT_STARTED');
});

// ===========================================================================
// MP-04 ~ MP-09：上半场 / 中场 / 下半场开始
// ===========================================================================

test('MP-04. FIRST_HALF Tick 正常推进', () => {
  const ph = startMatch(createInitialMatchPhase());
  const res = runMatchPhaseDriver(idleCore(), ph, createInitialMatchClock(), 3, { seed: 's0' });
  assertEquals(res.ok, true);
  assertEquals(res.lifecycle, 'TICKED');
  assertEquals(res.ticksExecuted, 3);
  assertEquals(res.clock.elapsedSeconds, 3);
  assertEquals(res.phase.phase, P.FIRST_HALF);
  assertEquals(res.phase.half, 1);
});

test('MP-05. 2700 秒进入 HALFTIME（显式暂停态）', () => {
  const ph = { phase: P.FIRST_HALF, elapsedSeconds: 2699, half: 1, isBreak: false, isFinished: false };
  const res = runMatchPhaseDriver(idleCore(), ph, clockAt(2699), 1, { seed: 's0' });
  assertEquals(res.clock.elapsedSeconds, 2700);
  assertEquals(res.phase, { phase: P.HALFTIME, elapsedSeconds: 2700, half: 1, isBreak: true, isFinished: false });
  assertEquals(res.phase.isBreak, true);
  assertEquals(res.phase.isFinished, false);
});

test('MP-06. HALFTIME 不执行比赛 Tick（无 Decision / Interaction / SECOND_BALL）', () => {
  const ph = { phase: P.HALFTIME, elapsedSeconds: 2700, half: 1, isBreak: true, isFinished: false };
  const res = runMatchPhaseDriver(idleCore(), ph, clockAt(2700), 5, { seed: 's0' });
  assertEquals(res.ticksExecuted, 0);
  assertEquals(res.ticks, []);
  assertEquals(res.events, [], 'HALFTIME 不得产生任何 Tick 事件');
  assertEquals(res.lifecycle, 'PAUSED_HALFTIME');
  assertEquals(isMatchPhasePaused(ph), true);
});

test('MP-07. HALFTIME 状态保持 elapsedSeconds = 2700', () => {
  const ph = { phase: P.HALFTIME, elapsedSeconds: 2700, half: 1, isBreak: true, isFinished: false };
  const res = runMatchPhaseDriver(idleCore(), ph, clockAt(2700), 50, { seed: 's0' });
  assertEquals(res.clock.elapsedSeconds, 2700);
  assertEquals(res.phase.elapsedSeconds, 2700);
});

test('MP-08. HALFTIME → SECOND_HALF（显式 startSecondHalf）', () => {
  const half = { phase: P.HALFTIME, elapsedSeconds: 2700, half: 1, isBreak: true, isFinished: false };
  const ph = startSecondHalf(half);
  assertEquals(ph, { phase: P.SECOND_HALF, elapsedSeconds: 2700, half: 2, isBreak: false, isFinished: false });
  assertEquals(validateMatchPhase(ph), { valid: true, issues: [] });
});

test('MP-09. 开始下半场不推进时间', () => {
  const half = { phase: P.HALFTIME, elapsedSeconds: 2700, half: 1, isBreak: true, isFinished: false };
  const ph = startSecondHalf(half);
  assertEquals(ph.elapsedSeconds, 2700);
});

// ===========================================================================
// MP-10 ~ MP-13：下半场 / 结束 / clamp / 终态
// ===========================================================================

test('MP-10. SECOND_HALF Tick 正常推进', () => {
  const ph = { phase: P.SECOND_HALF, elapsedSeconds: 2700, half: 2, isBreak: false, isFinished: false };
  const res = runMatchPhaseDriver(idleCore(), ph, clockAt(2700), 3, { seed: 's0' });
  assertEquals(res.ticksExecuted, 3);
  assertEquals(res.clock.elapsedSeconds, 2703);
  assertEquals(res.phase.phase, P.SECOND_HALF);
  assertEquals(res.phase.half, 2);
});

test('MP-11. 5400 秒进入 REGULATION_COMPLETE', () => {
  const ph = { phase: P.SECOND_HALF, elapsedSeconds: 5399, half: 2, isBreak: false, isFinished: false };
  const res = runMatchPhaseDriver(idleCore(), ph, clockAt(5399), 1, { seed: 's0' });
  assertEquals(res.clock.elapsedSeconds, 5400);
  assertEquals(res.phase, { phase: P.REGULATION_COMPLETE, elapsedSeconds: 5400, half: 2, isBreak: false, isFinished: true });
  assertEquals(res.matchFinished, true);
});

test('MP-12. 结束时间 clamp（不产生 5401…）', () => {
  const ph = { phase: P.SECOND_HALF, elapsedSeconds: 5399, half: 2, isBreak: false, isFinished: false };
  const res = runMatchPhaseDriver(idleCore(), ph, clockAt(5399), 100, { seed: 's0' });
  assertEquals(res.ticksExecuted, 1, '只应执行到 5400');
  assertEquals(res.clock.elapsedSeconds, 5400);
  assert(res.clock.elapsedSeconds <= REG, '不得超过 5400');
});

test('MP-13. REGULATION_COMPLETE 不再执行 Tick（MATCH_FINISHED，非异常）', () => {
  const ph = { phase: P.REGULATION_COMPLETE, elapsedSeconds: 5400, half: 2, isBreak: false, isFinished: true };
  const res = runMatchPhaseDriver(idleCore(), ph, clockAt(5400), 5, { seed: 's0' });
  assertEquals(res.ok, true);
  assertEquals(res.ticksExecuted, 0);
  assertEquals(res.ticks, []);
  assertEquals(res.lifecycle, 'MATCH_FINISHED');
  assertEquals(isMatchPhaseTerminal(ph), true);
});

// ===========================================================================
// MP-14 ~ MP-16：非法跳转 / 不可变 / 确定性
// ===========================================================================

test('MP-14. 非法阶段跳转被拒绝', () => {
  assertThrows(() => startMatch({ phase: P.FIRST_HALF, elapsedSeconds: 5, half: 1, isBreak: false, isFinished: false }), 'TypeError');
  assertThrows(() => startSecondHalf({ phase: P.FIRST_HALF, elapsedSeconds: 5, half: 1, isBreak: false, isFinished: false }), 'TypeError');
  assertThrows(() => startSecondHalf({ phase: P.NOT_STARTED, elapsedSeconds: 0, half: 0, isBreak: false, isFinished: false }), 'TypeError');

  // 合法性矩阵。
  assertEquals(isLegalPhaseTransition(P.NOT_STARTED, P.FIRST_HALF), true);
  assertEquals(isLegalPhaseTransition(P.NOT_STARTED, P.SECOND_HALF), false);
  assertEquals(isLegalPhaseTransition(P.NOT_STARTED, P.HALFTIME), false);
  assertEquals(isLegalPhaseTransition(P.FIRST_HALF, P.SECOND_HALF), false);
  assertEquals(isLegalPhaseTransition(P.FIRST_HALF, P.REGULATION_COMPLETE), false);
  assertEquals(isLegalPhaseTransition(P.HALFTIME, P.FIRST_HALF), false);
  assertEquals(isLegalPhaseTransition(P.SECOND_HALF, P.FIRST_HALF), false);
  assertEquals(isLegalPhaseTransition(P.REGULATION_COMPLETE, P.SECOND_HALF), false);
  assertEquals(isLegalPhaseTransition(P.HALFTIME, P.SECOND_HALF), true);
  assertEquals(isLegalPhaseTransition(P.FIRST_HALF, P.FIRST_HALF), true);

  // advanceMatchPhase 不跳跃：FIRST_HALF + 时钟 5400 → 只到 HALFTIME。
  const jumped = advanceMatchPhase(
    { phase: P.FIRST_HALF, elapsedSeconds: 10, half: 1, isBreak: false, isFinished: false },
    clockAt(REG),
  );
  assertEquals(jumped.phase, P.HALFTIME, 'FIRST_HALF 不得直接跳到终态');
});

test('MP-15. 输入状态不可变（Phase 与 Clock 均不被修改）', () => {
  const ph = { phase: P.FIRST_HALF, elapsedSeconds: 100, half: 1, isBreak: false, isFinished: false };
  const clock = clockAt(100);
  const phSnap = JSON.stringify(ph);
  const clockSnap = JSON.stringify(clock);
  const core = idleCore();
  const coreSnap = JSON.stringify(core);
  runMatchPhaseDriver(core, ph, clock, 3, { seed: 's0' });
  assertEquals(JSON.stringify(ph), phSnap);
  assertEquals(JSON.stringify(clock), clockSnap);
  assertEquals(JSON.stringify(core), coreSnap);
});

test('MP-16. 相同输入确定性一致', () => {
  const ph = { phase: P.FIRST_HALF, elapsedSeconds: 200, half: 1, isBreak: false, isFinished: false };
  const a = runMatchPhaseDriver(idleCore(), ph, clockAt(200), 4, { seed: 'sD' });
  const b = runMatchPhaseDriver(idleCore(), ph, clockAt(200), 4, { seed: 'sD' });
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

// ===========================================================================
// MP-17 ~ MP-19：guard / 单一时间 Truth
// ===========================================================================

test('MP-17. 无 Math.random', () => {
  for (const f of ['match-phase.js', 'match-phase-config.js']) {
    assert(!/Math\.random\s*\(/.test(readSrc(f)), `${f} 出现 Math.random`);
  }
});

test('MP-18. 无 wall-clock', () => {
  for (const f of ['match-phase.js', 'match-phase-config.js']) {
    const s = readSrc(f);
    assert(!/Date\.now\s*\(/.test(s), `${f} 依赖 Date.now`);
    assert(!/performance\.now\s*\(/.test(s), `${f} 依赖 performance.now`);
    assert(!/new\s+Date\s*\(/.test(s), `${f} 依赖 new Date`);
    assert(!/setTimeout\s*\(/.test(s) && !/setInterval\s*\(/.test(s), `${f} 依赖定时器`);
  }
});

test('MP-19. Phase 不产生第二 Match Time Truth（读取 C-11 Clock）', () => {
  const ph = { phase: P.FIRST_HALF, elapsedSeconds: 500, half: 1, isBreak: false, isFinished: false };
  const clock = clockAt(500);
  const res = runMatchPhaseDriver(idleCore(), ph, clock, 7, { seed: 's0' });
  assertEquals(res.phase.elapsedSeconds, res.clock.elapsedSeconds, 'Phase 时间必须镜像 C-11 Clock');
  // 半场常量与 C-11 规则一致。
  assertEquals(HALF_DURATION_SECONDS, REG / 2);
  // Phase 源码不得自持时间累加常量（只读 Clock）。
  assert(!/TICK_DURATION_SECONDS/.test(readSrc('match-phase.js')), 'Phase 不得复制 tick 时长');
});

// ===========================================================================
// MP-20 ~ MP-25：生命周期隔离 / 边界批量停止
// ===========================================================================

test('MP-20/21/22. HALFTIME 不触发 Decision / Interaction / SECOND_BALL', () => {
  const ph = { phase: P.HALFTIME, elapsedSeconds: 2700, half: 1, isBreak: true, isFinished: false };
  const res = runMatchPhaseDriver(idleCore(), ph, clockAt(2700), 10, { seed: 's0' });
  assertEquals(res.ticksExecuted, 0);
  const types = res.events.map((e) => e.type);
  for (const forbidden of ['TICK_START', 'INTERACTION_RESOLVED', 'INTERACTION_INTEGRATED', 'SECOND_BALL_RESOLVED', 'ACTION_SELECTED']) {
    assert(!types.includes(forbidden), `HALFTIME 不得产生 ${forbidden}`);
  }
});

test('MP-23. HALFTIME → SECOND_HALF 后 Tick 连续', () => {
  const half = { phase: P.HALFTIME, elapsedSeconds: 2700, half: 1, isBreak: true, isFinished: false };
  const second = startSecondHalf(half);
  const res = runMatchPhaseDriver(idleCore(), second, clockAt(2700), 1, { seed: 's0' });
  assertEquals(res.clock.elapsedSeconds, 2701);
  assertEquals(res.ticks[0].tickIndex, 2700, '下半场首个 Tick 索引应为 2700');
  assertEquals(res.phase.phase, P.SECOND_HALF);
});

test('MP-24. 跨 2700 秒批量 Tick 正确停止（不跳过 HALFTIME）', () => {
  const ph = { phase: P.FIRST_HALF, elapsedSeconds: 2699, half: 1, isBreak: false, isFinished: false };
  const res = runMatchPhaseDriver(idleCore(), ph, clockAt(2699), 10, { seed: 's0' });
  assertEquals(res.requestedTickCount, 10);
  assertEquals(res.ticksExecuted, 1, '只应执行到 2700');
  assertEquals(res.clock.elapsedSeconds, 2700);
  assertEquals(res.phase.phase, P.HALFTIME, '停在 HALFTIME，不自动进入下半场');
  // 未自动进入 SECOND_HALF。
  assert(res.phase.phase !== P.SECOND_HALF);
});

test('MP-25. 跨 5400 秒批量 Tick 正确停止', () => {
  const ph = { phase: P.SECOND_HALF, elapsedSeconds: 5399, half: 2, isBreak: false, isFinished: false };
  const res = runMatchPhaseDriver(idleCore(), ph, clockAt(5399), 10, { seed: 's0' });
  assertEquals(res.ticksExecuted, 1);
  assertEquals(res.clock.elapsedSeconds, 5400);
  assertEquals(res.phase.phase, P.REGULATION_COMPLETE);
});

// ===========================================================================
// MP-26 ~ MP-27：C-10 / C-11 回归
// ===========================================================================

test('MP-26. C-10 回归：runMatchTicks 仍可用且与 Phase Driver 一致', () => {
  const core = idleCore();
  const direct = runMatchTicks(core, 3, { seed: 's0' });
  const viaPhase = runMatchPhaseDriver(core, startMatch(createInitialMatchPhase()), createInitialMatchClock(), 3, { seed: 's0' });
  assertEquals(JSON.stringify(viaPhase.ticks), JSON.stringify(direct.ticks));
  assertEquals(JSON.stringify(viaPhase.matchCore), JSON.stringify(direct.matchCore));
  assertEquals(direct.ok, true);
});

test('MP-27. C-11 回归：runMatchClockDriver 仍可用', () => {
  const res = runMatchClockDriver(idleCore(), createInitialMatchClock(), 2, { seed: 's0' });
  assertEquals(res.ok, true);
  assertEquals(res.clock.elapsedSeconds, 2);
  assertEquals(res.ticksExecuted, 2);
});

test('MP-28. 阶段边界 Tick 余量（ticksAllowedInPhase）', () => {
  assertEquals(ticksAllowedInPhase({ phase: P.FIRST_HALF }, clockAt(2690)), 10);
  assertEquals(ticksAllowedInPhase({ phase: P.SECOND_HALF }, clockAt(5390)), 10);
  assertEquals(ticksAllowedInPhase({ phase: P.HALFTIME }, clockAt(2700)), 0);
  assertEquals(ticksAllowedInPhase({ phase: P.NOT_STARTED }, clockAt(0)), 0);
  assertEquals(ticksAllowedInPhase({ phase: P.REGULATION_COMPLETE }, clockAt(5400)), 0);
});