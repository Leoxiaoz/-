/**
 * Step 39F-M-C-10 —— Multi-Tick Driver Foundation 测试。
 *
 * 覆盖：
 * - MT-01 tickCount = 0；MT-02 单 Tick 等价；MT-03 2 Tick；MT-04 N Tick；
 * - MT-05 tickIndex 严格递增；MT-06/MT-07 状态连续传递 / 最终状态；
 * - MT-08 输入 MatchCore 不被 mutation；MT-09/10/11/12 失败 / 索引 / Trace / 异常；
 * - MT-13/14 确定性；MT-15/16 Math.random / wall-clock guard；
 * - MT-17 无隐藏 global state；MT-18/19 Calibration override 透传 / 不污染；
 * - MT-20/21 Trace 不进入 Truth / 无第二 Truth；MT-22/23 不递归 / 不绕过 C-08。
 *
 * 红线：不接 Production Loop / Renderer / Save·Schema；不改 C-04~C-09；不改 C-08 生命周期。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runMatchTicks, MATCH_TICKS_DRIVER_VERSION } from '../src/core/match/match-ticks.js';
import { runMatchTick } from '../src/core/match/match-tick.js';
import { INTERACTION_BALL_STATE as BS } from '../src/core/match/interaction-resolution-config.js';
import { DEFAULT_CALIBRATION_PROFILE } from '../src/core/match/resolution-calibration.js';

const H = 'clb_h', A = 'clb_a';
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const ATTRS = (o = {}) => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...o });
function mk(id, t, pos, x, y, attrs = {}, extra = {}) {
  return {
    playerId: id, teamId: t, position: pos, positionOnPitch: { x, y },
    onPitch: true, injured: false, sentOff: false, attributes: ATTRS(attrs),
    fitness: 100, form: 50, morale: 50, matchLoad: 0, ...extra,
  };
}
const tac = () => ({ formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' });

function coreOf(players, { ballPos = { x: 0.5, y: 0.5 }, state = BS.FREE, control = null, poss = null } = {}) {
  const ball = { position: { ...ballPos }, control, possessingTeamId: poss, velocity: { x: 0, y: 0 } };
  if (state) ball.state = state;
  return {
    worldId: 'w_mt10', season: 1, matchId: 'm_mt10', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball, players,
    tactical: { [H]: tac(), [A]: tac() },
  };
}

/** 空动作核心（用于纯编排测试；C-08 每 Tick 返回 COMPLETED 且状态不变）。 */
const idleCore = () => coreOf([mk('h_a', H, 'MF', 0.5, 0.5)], { state: BS.CONTROLLED, control: 'h_a', poss: H });

/** 全 99 且无挑战者 → DRIBBLE 成功概率 clamp 到 1 → 必定 COMPLETED。 */
function strongDribbleCore() {
  return coreOf([mk('h_a', H, 'MF', 0.40, 0.50, { technique: 99, pace: 99 })], { ballPos: { x: 0.40, y: 0.50 }, state: BS.CONTROLLED, control: 'h_a', poss: H });
}
const dribbleInst = () => ({ actionType: 'DRIBBLE', actorId: 'h_a', intent: 'FORWARD', target: { type: 'SPACE', x: 0.52, y: 0.50 }, riskIntent: { level: 'MEDIUM', value: 0.5 } });

function cloneProfile(mutate) {
  const p = JSON.parse(JSON.stringify(DEFAULT_CALIBRATION_PROFILE));
  if (mutate) mutate(p);
  return p;
}
const outcomeOf = (tickTrace) => tickTrace.events.find((e) => e.type === 'INTERACTION_RESOLVED')?.outcome ?? null;

// ===========================================================================
// MT-01 ~ MT-04：基础编排
// ===========================================================================

test('MT-01. tickCount = 0：不执行 Tick、不增加 tickIndex、初始即最终', () => {
  const core = idleCore();
  const before = JSON.stringify(core);
  const res = runMatchTicks(core, 0);
  assertEquals(res.ok, true);
  assertEquals(res.ticksExecuted, 0);
  assertEquals(res.ticks, []);
  assertEquals(res.events, []);
  assertEquals(res.initialTickIndex, 0);
  assertEquals(res.finalTickIndex, 0);
  assertEquals(res.nextTickIndex, 0);
  assert(res.matchCore === core, 'tickCount=0 必须返回同一 MatchCore 引用');
  assertEquals(JSON.stringify(core), before);
});

test('MT-02. 单 Tick 等价：runMatchTicks(core, 1) ≡ runMatchTick(core)', () => {
  const core = idleCore();
  const viaDriver = runMatchTicks(core, 1);
  const direct = runMatchTick(core, { tickIndex: 0 });
  assertEquals(viaDriver.ticksExecuted, 1);
  assertEquals(viaDriver.ticks[0].ok, true);
  assertEquals(JSON.stringify(viaDriver.matchCore), JSON.stringify(direct.matchCore));
  assertEquals(viaDriver.ticks[0].result.status, direct.tick.status);

  // 有动作时同样等价。
  const core2 = strongDribbleCore();
  const viaDriver2 = runMatchTicks(core2, 1, { actionInstance: dribbleInst(), seed: 's0' });
  const direct2 = runMatchTick(core2, { tickIndex: 0, actionInstance: dribbleInst(), seed: 's0' });
  assertEquals(JSON.stringify(viaDriver2.matchCore), JSON.stringify(direct2.matchCore));
});

test('MT-03. 2 Tick 连续执行（状态连续传递）', () => {
  const core = strongDribbleCore();
  const res = runMatchTicks(core, 2, { actionInstance: dribbleInst(), seed: 's0' });
  assertEquals(res.ok, true);
  assertEquals(res.ticksExecuted, 2);
  assertEquals(res.ticks.length, 2);
  assertEquals(res.ticks.map((t) => t.tickIndex), [0, 1]);
  assertEquals(res.ticks[0].result.status, 'COMPLETED');
  assertEquals(res.ticks[1].result.status, 'COMPLETED');
});

test('MT-04. N Tick 连续执行', () => {
  const core = idleCore();
  const N = 6;
  const res = runMatchTicks(core, N, { seed: 's0' });
  assertEquals(res.ok, true);
  assertEquals(res.ticksExecuted, N);
  assertEquals(res.ticks.length, N);
  assertEquals(res.finalTickIndex, N - 1);
  assertEquals(res.nextTickIndex, N);
});

// ===========================================================================
// MT-05 ~ MT-08：顺序 / 传递 / 不可变
// ===========================================================================

test('MT-05. tickIndex 严格递增（n+1 = n + 1），支持非 0 起始', () => {
  const core = idleCore();
  const res = runMatchTicks(core, 4, { startTickIndex: 7 });
  assertEquals(res.initialTickIndex, 7);
  assertEquals(res.ticks.map((t) => t.tickIndex), [7, 8, 9, 10]);
  for (let i = 1; i < res.ticks.length; i += 1) {
    assertEquals(res.ticks[i].tickIndex, res.ticks[i - 1].tickIndex + 1);
  }
  assertEquals(res.finalTickIndex, 10);
  assertEquals(res.nextTickIndex, 11);
});

test('MT-06. 前 Tick 输出 = 后 Tick 输入（引用级连续传递）', () => {
  const core = strongDribbleCore();
  const res = runMatchTicks(core, 3, { actionInstance: dribbleInst(), seed: 's0' });
  assertEquals(res.ticks[0].result.matchCore, res.ticks[1].inputMatchCore);
  assertEquals(res.ticks[1].result.matchCore, res.ticks[2].inputMatchCore);
  assertEquals(res.ticks[0].inputMatchCore, core);
  // 不得重新从初始 MatchCore 创建每个 Tick。
  assert(res.ticks[1].inputMatchCore !== core, '后续 Tick 不得重新使用初始 MatchCore');
});

test('MT-07. 最终 MatchCore = 最后 Tick MatchCore', () => {
  const res = runMatchTicks(strongDribbleCore(), 3, { actionInstance: dribbleInst(), seed: 's0' });
  assertEquals(res.matchCore, res.ticks[res.ticks.length - 1].result.matchCore);
});

test('MT-08. 输入 MatchCore 不被原地 mutation', () => {
  const core = strongDribbleCore();
  const initial = JSON.stringify(core);
  const res = runMatchTicks(core, 3, { actionInstance: dribbleInst(), seed: 's0' });
  assertEquals(JSON.stringify(core), initial, 'JSON.stringify(input) 必须 === JSON.stringify(initial)');
  assert(res.matchCore !== core, 'Driver 不得原地修改输入');
});

// ===========================================================================
// MT-09 ~ MT-12：失败 / 异常
// ===========================================================================

test('MT-09. 失败 Tick 后立即停止（fail-fast，不继续后续 Tick）', () => {
  const res = runMatchTicks(null, 5);
  assertEquals(res.ok, false);
  assertEquals(res.ticksExecuted, 0);
  assertEquals(res.ticks.length, 1, '不得继续执行后续 Tick');
  assertEquals(res.ticks[0].ok, false);
  assert(res.error && res.error.code === 'TICK_NOT_COMPLETED');
});

test('MT-10. 失败 Tick Index 正确（含非 0 起始）', () => {
  const res = runMatchTicks(null, 5, { startTickIndex: 5 });
  assertEquals(res.ok, false);
  assertEquals(res.failedTickIndex, 5);
  assertEquals(res.initialTickIndex, 5);
  assertEquals(res.nextTickIndex, 5, '未成功执行任何 Tick，下一步索引不变');
});

test('MT-11. 失败前 Trace 保留（含失败 Tick，标记 ok:false）', () => {
  // INVARIANT 失败：ball CONTROLLED 但 possessingTeamId 与控球球员球队不一致。
  const bad = coreOf([mk('h_a', H, 'MF', 0.5, 0.5)], { state: BS.CONTROLLED, control: 'h_a', poss: A });
  const res = runMatchTicks(bad, 3);
  assertEquals(res.ok, false);
  assertEquals(res.ticks.length, 1);
  assertEquals(res.ticks[0].ok, false);
  assert(res.ticks[0].invariantIssues.includes('CONTROL_TEAM_MISMATCH'));
  assertEquals(res.invariantIssues.includes('CONTROL_TEAM_MISMATCH'), true, '顶层必须保留不变量问题');
  assertEquals(res.ticksExecuted, 0);
  assert(res.error.code === 'TICK_INVARIANT_VIOLATION');
});

test('MT-12. 异常 Tick 停止并包装为明确失败（不重试 / 不 fallback）', () => {
  const evil = {};
  Object.defineProperty(evil, 'actionType', { enumerable: true, get() { throw new Error('boom'); } });
  const res = runMatchTicks(idleCore(), 3, { actionInstance: evil });
  assertEquals(res.ok, false);
  assertEquals(res.failedTickIndex, 0);
  assertEquals(res.ticksExecuted, 0);
  assertEquals(res.error.code, 'TICK_THREW');
  assert(res.error.message.includes('boom'), '不得吞掉原始错误信息');
});

test('MT-10b. tickCount 严格校验（负数 / 小数 / NaN / Infinity / 字符串 / null / undefined）', () => {
  for (const bad of [-1, 1.5, NaN, Infinity, -Infinity, '2', null, undefined]) {
    const res = runMatchTicks(idleCore(), bad);
    assertEquals(res.ok, false, `tickCount=${String(bad)} 应被拒绝`);
    assertEquals(res.ticksExecuted, 0);
    assertEquals(res.error.code, 'INVALID_TICK_COUNT');
  }
});

// ===========================================================================
// MT-13 ~ MT-14：确定性
// ===========================================================================

test('MT-13. 相同输入 + tickCount + seed → JSON 完全一致', () => {
  const core = idleCore();
  const a = runMatchTicks(core, 3, { seed: 'seedX' });
  const b = runMatchTicks(core, 3, { seed: 'seedX' });
  assertEquals(JSON.stringify(a), JSON.stringify(b));

  const c1 = runMatchTicks(strongDribbleCore(), 2, { actionInstance: dribbleInst(), seed: 'seedX' });
  const c2 = runMatchTicks(strongDribbleCore(), 2, { actionInstance: dribbleInst(), seed: 'seedX' });
  assertEquals(JSON.stringify(c1), JSON.stringify(c2));
});

test('MT-14. 不同 seed 可产生不同合法结果（不强制不同）', () => {
  const core = () => coreOf([mk('h_a', H, 'MF', 0.42, 0.50)], { ballPos: { x: 0.42, y: 0.50 }, state: BS.CONTROLLED, control: 'h_a', poss: H });
  const a = runMatchTicks(core(), 2, { playerId: 'h_a', seed: 'seed-a' });
  const b = runMatchTicks(core(), 2, { playerId: 'h_a', seed: 'seed-b' });
  assertEquals(a.ok, true);
  assertEquals(b.ok, true);
  // 各自确定。
  assertEquals(JSON.stringify(a), JSON.stringify(runMatchTicks(core(), 2, { playerId: 'h_a', seed: 'seed-a' })));
  assertEquals(JSON.stringify(b), JSON.stringify(runMatchTicks(core(), 2, { playerId: 'h_a', seed: 'seed-b' })));
});

// ===========================================================================
// MT-15 ~ MT-17：Source Guard
// ===========================================================================

test('MT-15. Math.random source scan（match-ticks 源码无调用）', () => {
  assert(!/Math\.random\s*\(/.test(readSrc('match-ticks.js')), 'match-ticks.js 出现 Math.random 调用');
});

test('MT-16. Wall-clock guard（无 Date.now / performance.now / new Date / setInterval / setTimeout）', () => {
  const src = readSrc('match-ticks.js');
  assert(!/Date\.now\s*\(/.test(src), '出现 Date.now');
  assert(!/performance\.now\s*\(/.test(src), '出现 performance.now');
  assert(!/new\s+Date\s*\(/.test(src), '出现 new Date');
  assert(!/setInterval\s*\(/.test(src), '出现 setInterval');
  assert(!/setTimeout\s*\(/.test(src), '出现 setTimeout');
});

test('MT-17. 无隐藏 global state（无 globalThis / 顶层可变 let·var）', () => {
  const src = readSrc('match-ticks.js');
  assert(!/globalThis/.test(src), '不得挂载全局');
  // 仅检测模块顶层（第 0 列）的 let / var；函数内的局部 let 允许。
  assert(!/(^|\n)(let|var)[ \t]/.test(src), '不得存在模块顶层可变变量');
});

// ===========================================================================
// MT-18 ~ MT-19：Calibration 透传
// ===========================================================================

test('MT-18. Calibration override 正确透传到 Resolution（经 C-08）', () => {
  const core = strongDribbleCore();
  const def = runMatchTicks(core, 1, { actionInstance: dribbleInst(), seed: 's0' });
  assertEquals(outcomeOf(def.ticks[0]), 'DRIBBLE_COMPLETED');

  const zero = cloneProfile((p) => {
    p.interaction.dribble.BASE_SUCCESS = 0;
    p.interaction.dribble.TECHNIQUE_WEIGHT = 0;
    p.interaction.dribble.PACE_WEIGHT = 0;
    p.interaction.dribble.FREE_SPACE_BONUS = 0;
  });
  const over = runMatchTicks(core, 1, { actionInstance: dribbleInst(), seed: 's0', calibrationProfile: zero });
  assertEquals(over.ok, true);
  assert(outcomeOf(over.ticks[0]) !== 'DRIBBLE_COMPLETED', 'override 应改变 Resolution 结果');
});

test('MT-19. Calibration override 不污染下一次默认运行', () => {
  const core = strongDribbleCore();
  const before = JSON.stringify(DEFAULT_CALIBRATION_PROFILE);

  const A1 = runMatchTicks(core, 1, { actionInstance: dribbleInst(), seed: 's0' });
  const zero = cloneProfile((p) => { p.interaction.dribble.BASE_SUCCESS = 0; });
  runMatchTicks(core, 1, { actionInstance: dribbleInst(), seed: 's0', calibrationProfile: zero });
  const A2 = runMatchTicks(core, 1, { actionInstance: dribbleInst(), seed: 's0' });

  assertEquals(JSON.stringify(A1), JSON.stringify(A2), 'override 不得污染 default');
  assertEquals(JSON.stringify(DEFAULT_CALIBRATION_PROFILE), before, 'override 不得修改默认 profile');
});

// ===========================================================================
// MT-20 ~ MT-23：Truth / 递归 / 绕过
// ===========================================================================

test('MT-20. Tick Trace 不进入 MatchCore Truth', () => {
  const res = runMatchTicks(strongDribbleCore(), 2, { actionInstance: dribbleInst(), seed: 's0' });
  const keys = Object.keys(res.matchCore);
  for (const forbidden of ['ticks', 'events', 'tickTrace', 'tickIndex', 'driverVersion', 'calibrationVersion', 'calibrationProfile', 'invariantIssues']) {
    assert(!keys.includes(forbidden), `MatchCore Truth 不得包含 ${forbidden}`);
  }
  assert(!JSON.stringify(res.matchCore).includes('calibrationVersion'));
});

test('MT-21. 不创建第二套 Ball / Possession / Calibration Truth', () => {
  const res = runMatchTicks(strongDribbleCore(), 2, { actionInstance: dribbleInst(), seed: 's0' });
  const keys = Object.keys(res.matchCore);
  for (const forbidden of ['secondBall', 'ballTruth', 'shadowBall', 'possessionTruth', 'geometryTruth', 'playerTruth', 'calibration']) {
    assert(!keys.includes(forbidden), `不得出现第二套 Truth: ${forbidden}`);
  }
});

test('MT-22. 不得递归调用 runMatchTicks（源码无自调用）', () => {
  const code = stripComments(readSrc('match-ticks.js'));
  const calls = (code.match(/runMatchTicks\s*\(/g) || []).length;
  assertEquals(calls, 1, 'runMatchTicks 只应有 1 处（函数定义），不得自调用');
});

test('MT-23. 不得绕过 runMatchTick（唯一执行入口）', () => {
  const code = stripComments(readSrc('match-ticks.js'));
  assert(/runMatchTick\s*\(/.test(code), '必须调用 runMatchTick');
  // 依赖白名单：只能依赖 C-08。
  const re = /from\s+['"]\.\/([a-z0-9-]+)\.js['"]/g;
  const deps = new Set();
  let m;
  while ((m = re.exec(code)) !== null) deps.add(m[1]);
  assertEquals([...deps], ['match-tick'], `match-ticks 只允许依赖 match-tick，实际: ${[...deps].join(',')}`);
  // 不得自行解析 / 集成 / 二点球。
  assert(!/\bresolveInteraction\s*\(/.test(code), '不得自行 resolveInteraction');
  assert(!/\bintegrateInteractionResolution\s*\(/.test(code), '不得自行 integrateInteractionResolution');
  assert(!/\bresolveSecondBall\s*\(/.test(code), '不得自行 resolveSecondBall');
  assert(!/\bdecidePlayerAction\s*\(/.test(code), '不得自行 decidePlayerAction');
});

test('MT-24. Driver 版本 metadata 存在', () => {
  const res = runMatchTicks(idleCore(), 1);
  assertEquals(res.driverVersion, MATCH_TICKS_DRIVER_VERSION);
  assertEquals(typeof MATCH_TICKS_DRIVER_VERSION, 'string');
});