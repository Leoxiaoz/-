/**
 * Step 39F-M-C-11 —— Match Clock Foundation 测试。
 *
 * 覆盖 MC-01…MC-21：初始状态 / 推进 / 累加 / 结束 / clamp / 阶段边界 /
 * tickCount 校验 / 输入不可变 / 确定性 / wall-clock·Math.random guard /
 * Clock+C-10 Driver 一致性 / 已结束不推进。
 *
 * 红线：不接 Production Loop / Renderer / Save·Schema；不改 C-04~C-10；无 Math.random / 墙钟。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createInitialMatchClock, advanceMatchClock, deriveMatchPhase, validateMatchClock,
  remainingTicks, runMatchClockDriver,
} from '../src/core/match/match-clock.js';
import { MATCH_CLOCK_CONFIG, MATCH_PHASES } from '../src/core/match/match-clock-config.js';
import { INTERACTION_BALL_STATE as BS } from '../src/core/match/interaction-resolution-config.js';
import { runMatchTicks } from '../src/core/match/match-ticks.js';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');

const REG = MATCH_CLOCK_CONFIG.REGULATION_DURATION_SECONDS;

// ===========================================================================
// MC-01 ~ MC-03：初始 / 推进 / 累加
// ===========================================================================

test('MC-01. 初始 Clock 正确（0 / NOT_STARTED / 未结束）', () => {
  const c = createInitialMatchClock();
  assertEquals(c, { elapsedSeconds: 0, phase: MATCH_PHASES.NOT_STARTED, isFinished: false });
  assertEquals(validateMatchClock(c), { valid: true, issues: [] });
});

test('MC-02. 1 Tick 推进 1 比赛秒并进入 FIRST_HALF', () => {
  const c1 = advanceMatchClock(createInitialMatchClock(), 1);
  assertEquals(c1.elapsedSeconds, MATCH_CLOCK_CONFIG.TICK_DURATION_SECONDS);
  assertEquals(c1.phase, MATCH_PHASES.FIRST_HALF);
  assertEquals(c1.isFinished, false);
});

test('MC-03. 连续 Tick 正确累加', () => {
  let c = createInitialMatchClock();
  for (let i = 1; i <= 10; i += 1) c = advanceMatchClock(c, 1);
  assertEquals(c.elapsedSeconds, 10);
  const c2 = advanceMatchClock(c, 90);
  assertEquals(c2.elapsedSeconds, 100);
});

// ===========================================================================
// MC-04 ~ MC-06：结束 / clamp / 不回退
// ===========================================================================

test('MC-04. 达到 5400 秒进入 REGULATION_COMPLETE / isFinished', () => {
  const c = advanceMatchClock(createInitialMatchClock(), REG);
  assertEquals(c.elapsedSeconds, REG);
  assertEquals(c.phase, MATCH_PHASES.REGULATION_COMPLETE);
  assertEquals(c.isFinished, true);
});

test('MC-05. 结束后继续推进不超过 5400（clamp）', () => {
  const done = advanceMatchClock(createInitialMatchClock(), REG);
  const more = advanceMatchClock(done, 500);
  assertEquals(more.elapsedSeconds, REG, '不得产生 5401 / 5402 …');
  assertEquals(more.phase, MATCH_PHASES.REGULATION_COMPLETE);
  const zero = advanceMatchClock(done, 0);
  assertEquals(zero.elapsedSeconds, REG);
  assertEquals(zero.isFinished, true);
});

test('MC-06. 结束状态不会重新回到 FIRST_HALF', () => {
  let c = advanceMatchClock(createInitialMatchClock(), REG);
  assert(c.phase === MATCH_PHASES.REGULATION_COMPLETE);
  c = advanceMatchClock(c, 1);
  c = advanceMatchClock(c, 100000);
  assertEquals(c.phase, MATCH_PHASES.REGULATION_COMPLETE);
  assertEquals(c.isFinished, true);
  assertEquals(c.elapsedSeconds, REG);
});

// ===========================================================================
// MC-07 ~ MC-11：tickCount 校验 / 输入不可变
// ===========================================================================

test('MC-07. tickCount = 0 不改变状态（返回新对象，值相同）', () => {
  const base = advanceMatchClock(createInitialMatchClock(), 25);
  const same = advanceMatchClock(base, 0);
  assertEquals(same, base);
  assert(same !== base, '必须返回新对象，不得原地修改');
});

test('MC-08. 负数 Tick 被拒绝', () => {
  assertThrows(() => advanceMatchClock(createInitialMatchClock(), -1), 'RangeError');
});

test('MC-09. 非整数 Tick 被拒绝', () => {
  assertThrows(() => advanceMatchClock(createInitialMatchClock(), 1.5), 'RangeError');
});

test('MC-10. NaN / Infinity 被拒绝', () => {
  assertThrows(() => advanceMatchClock(createInitialMatchClock(), NaN), 'RangeError');
  assertThrows(() => advanceMatchClock(createInitialMatchClock(), Infinity), 'RangeError');
  assertThrows(() => advanceMatchClock(createInitialMatchClock(), -Infinity), 'RangeError');
  assertThrows(() => advanceMatchClock(createInitialMatchClock(), '3'), 'RangeError');
  assertThrows(() => advanceMatchClock(createInitialMatchClock(), null), 'RangeError');
});

test('MC-11. 输入对象不被 mutation', () => {
  const base = advanceMatchClock(createInitialMatchClock(), 30);
  const snapshot = JSON.stringify(base);
  advanceMatchClock(base, 5);
  advanceMatchClock(base, 0);
  assertEquals(JSON.stringify(base), snapshot);

  const bad = { elapsedSeconds: 10, phase: 'NOPE', isFinished: false };
  const badSnapshot = JSON.stringify(bad);
  assertThrows(() => advanceMatchClock(bad, 1), 'TypeError');
  assertEquals(JSON.stringify(bad), badSnapshot);
});

// ===========================================================================
// MC-12 ~ MC-14：确定性 / guard
// ===========================================================================

test('MC-12. 重复相同输入得到 JSON 完全一致结果', () => {
  const base = advanceMatchClock(createInitialMatchClock(), 1234);
  const a = advanceMatchClock(base, 77);
  const b = advanceMatchClock(base, 77);
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

test('MC-13. 不存在 wall-clock dependency', () => {
  for (const f of ['match-clock.js', 'match-clock-config.js']) {
    const src = readSrc(f);
    assert(!/Date\.now\s*\(/.test(src), `${f} 依赖 Date.now`);
    assert(!/performance\.now\s*\(/.test(src), `${f} 依赖 performance.now`);
    assert(!/new\s+Date\s*\(/.test(src), `${f} 依赖 new Date`);
    assert(!/setInterval\s*\(/.test(src) && !/setTimeout\s*\(/.test(src), `${f} 依赖定时器`);
  }
});

test('MC-14. 不存在 Math.random dependency', () => {
  for (const f of ['match-clock.js', 'match-clock-config.js']) {
    assert(!/Math\.random\s*\(/.test(readSrc(f)), `${f} 出现 Math.random`);
  }
});

// ===========================================================================
// MC-15 ~ MC-16：阶段边界 / clamp
// ===========================================================================

test('MC-15. 阶段转换边界测试', () => {
  assertEquals(deriveMatchPhase(0), MATCH_PHASES.NOT_STARTED);
  assertEquals(deriveMatchPhase(1), MATCH_PHASES.FIRST_HALF);
  assertEquals(deriveMatchPhase(REG - 1), MATCH_PHASES.FIRST_HALF);
  assertEquals(deriveMatchPhase(REG), MATCH_PHASES.REGULATION_COMPLETE);
  assertEquals(deriveMatchPhase(REG + 100), MATCH_PHASES.REGULATION_COMPLETE);

  // 5400 恰好边界：REG-1 → 推进 1 → 完成。
  const near = advanceMatchClock(createInitialMatchClock(), REG - 1);
  assertEquals(near.phase, MATCH_PHASES.FIRST_HALF);
  assertEquals(advanceMatchClock(near, 1).phase, MATCH_PHASES.REGULATION_COMPLETE);
});

test('MC-16. 超过 regulationDuration 的输入被正确 clamp', () => {
  const c = advanceMatchClock(createInitialMatchClock(), REG + 9999);
  assertEquals(c.elapsedSeconds, REG);
  assertEquals(c.isFinished, true);
  assertEquals(remainingTicks(c), 0);
});

// ===========================================================================
// MC-17 ~ MC-21：Clock + C-10 Driver
// ===========================================================================

const H = 'clb_h', A = 'clb_a';
const ATTRS = (o = {}) => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...o });
const mk = (id, t, pos, x, y, attrs = {}) => ({
  playerId: id, teamId: t, position: pos, positionOnPitch: { x, y },
  onPitch: true, injured: false, sentOff: false, attributes: ATTRS(attrs), fitness: 100, form: 50, morale: 50, matchLoad: 0,
});
const tac = () => ({ formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' });
function idleCore() {
  return {
    worldId: 'w_mc11', season: 1, matchId: 'm_mc11', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball: { position: { x: 0.5, y: 0.5 }, control: 'h_a', possessingTeamId: H, velocity: { x: 0, y: 0 }, state: BS.CONTROLLED },
    players: [mk('h_a', H, 'MF', 0.5, 0.5)],
    tactical: { [H]: tac(), [A]: tac() },
  };
}

test('MC-17. Clock 推进与 C-10 Tick 数一致', () => {
  const res = runMatchClockDriver(idleCore(), createInitialMatchClock(), 4, { seed: 's0' });
  assertEquals(res.ok, true);
  assertEquals(res.ticksExecuted, 4);
  assertEquals(res.clock.elapsedSeconds, 4);
  assertEquals(res.clock.phase, MATCH_PHASES.FIRST_HALF);
});

test('MC-18. Clock 不改变 C-10 的 Tick Result', () => {
  const core = idleCore();
  const viaDriver = runMatchClockDriver(core, createInitialMatchClock(), 3, { seed: 's0' });
  // 直接运行 C-10 作为对照。
  const direct = runMatchTicks(core, 3, { seed: 's0' });
  assertEquals(JSON.stringify(viaDriver.ticks), JSON.stringify(direct.ticks));
  assertEquals(JSON.stringify(viaDriver.matchCore), JSON.stringify(direct.matchCore));
});

test('MC-19. C-10 返回的 MatchCore 可继续用于下一次 Clock Driver', () => {
  let core = idleCore();
  let clock = createInitialMatchClock();
  const r1 = runMatchClockDriver(core, clock, 2, { seed: 's0' });
  core = r1.matchCore; clock = r1.clock;
  const r2 = runMatchClockDriver(core, clock, 2, { seed: 's0' });
  assertEquals(r2.ok, true);
  assertEquals(r2.clock.elapsedSeconds, 4);
  assertEquals(r2.ticks[0].tickIndex, 2, '第二次调用应从 tickIndex=2 继续');
});

test('MC-20. 相同 MatchCore + 相同 Clock + 相同 tickCount 确定性一致', () => {
  const clock = advanceMatchClock(createInitialMatchClock(), 10);
  const a = runMatchClockDriver(idleCore(), clock, 5, { seed: 'sZ' });
  const b = runMatchClockDriver(idleCore(), clock, 5, { seed: 'sZ' });
  assertEquals(JSON.stringify(a), JSON.stringify(b));
  assertEquals(a.clock.elapsedSeconds, 15);
});

test('MC-21. Match 已结束时不得继续执行新的 Match Tick', () => {
  const finished = advanceMatchClock(createInitialMatchClock(), REG);
  const core = idleCore();
  const res = runMatchClockDriver(core, finished, 3, { seed: 's0' });
  assertEquals(res.ok, true);
  assertEquals(res.ticksExecuted, 0);
  assertEquals(res.ticks, []);
  assertEquals(res.clock.elapsedSeconds, REG);
  assert(res.matchCore === core, '已结束不得触碰 MatchCore');
});

test('MC-21b. 批量 Tick 按剩余容量截断（不越过 5400）', () => {
  const near = advanceMatchClock(createInitialMatchClock(), REG - 2);
  const res = runMatchClockDriver(idleCore(), near, 10, { seed: 's0' });
  assertEquals(res.requestedTickCount, 10);
  assertEquals(res.ticksExecuted, 2, '只应执行剩余 2 个 Tick');
  assertEquals(res.clock.elapsedSeconds, REG);
  assertEquals(res.clock.isFinished, true);
});

test('MC-22. Driver 中文档化未知字段：Driver 不建立新 Truth / 不依赖业务层', () => {
  // Clock 源码不得反向依赖 Decision / Interaction / Ball Physics。
  const code = readSrc('match-clock.js');
  for (const dep of ['decision-pipeline', 'interaction-resolution', 'second-ball-resolution', 'ball-physics', 'interaction-integration']) {
    assert(!code.includes(`'./${dep}.js'`), `match-clock 不得依赖 ${dep}`);
  }
});