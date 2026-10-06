/**
 * Step 39F-M-C-08 —— Match Tick Orchestration Foundation 测试。
 *
 * 覆盖：
 * - MT-01 最小 Tick 成功执行；
 * - MT-02 复用现有 ActionInstance（含 C-04 Decision 路径）；
 * - MT-03 Interaction Resolution 接入；
 * - MT-04 Interaction Integration 后 MatchCore 正确更新；
 * - MT-05/06/07 SECOND_BALL follow-up（WON / NO_WINNER）；
 * - MT-08 不满足条件时不调用 Second-Ball；
 * - MT-09 一个 Tick 最多一次 SECOND_BALL；
 * - MT-10 不递归 Tick；
 * - MT-11 确定性；MT-12 幂等；
 * - MT-13 Invariant；
 * - MT-14 Math.random guard；MT-15 wall-clock guard；
 * - MT-16/17/18 Production Loop / Renderer / PASS·SHOT 未被修改。
 *
 * 红线：不接 Production Loop / Renderer；不改 C-04/C-05/C-06/C-07 Truth；不改 Save/Schema。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runMatchTick, checkTickInvariants } from '../src/core/match/match-tick.js';
import { MATCH_TICK_CONFIG, TICK_EVENT_TYPES } from '../src/core/match/match-tick-config.js';
import { resolveInteraction } from '../src/core/match/interaction-resolution.js';
import { INTERACTION_BALL_STATE as BS } from '../src/core/match/interaction-resolution-config.js';

const H = 'clb_h', A = 'clb_a';
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');
/** 去除注释后再做源码扫描（避免文档红线文字造成误报）。 */
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
    worldId: 'w_mt8', season: 1, matchId: 'm_mt8', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball, players,
    tactical: { [H]: tac(), [A]: tac() },
  };
}

const dribbleInst = (actorId, x, y) => ({ actionType: 'DRIBBLE', actorId, intent: 'FORWARD', target: { type: 'SPACE', x, y }, riskIntent: { level: 'MEDIUM', value: 0.5 } });

/** 持球 DRIBBLE 场景（无挑战者 / 可带挑战者）。 */
function dribbleCore({ challenger = null, actorAttrs = {} } = {}) {
  const players = [mk('h_a', H, 'MF', 0.40, 0.50, actorAttrs)];
  if (challenger) players.push(mk('a_d', A, 'DF', challenger.x, challenger.y, { defending: 99, pace: 99 }));
  return coreOf(players, { ballPos: { x: 0.40, y: 0.50 }, state: BS.CONTROLLED, control: 'h_a', poss: H });
}

/** 搜索满足 predicate 的确定性 seed（sequence 必须与 Tick 一致，否则 RNG scope 不同）。 */
function findSeed(inst, core, pred, { sequence = 0, limit = 3000 } = {}) {
  for (let s = 0; s < limit; s += 1) {
    const r = resolveInteraction(inst, core, { seed: `s${s}`, sequence });
    if (pred(r)) return { seed: `s${s}`, result: r };
  }
  return null;
}

/** 带挑战者的 loose 场景：actor 能力低、防守者能力高 → 二点球必胜。 */
function looseSetup() {
  const core = dribbleCore({
    challenger: { x: 0.455, y: 0.50 },
    actorAttrs: { technique: 1, pace: 1, defending: 1 },
  });
  const inst = dribbleInst('h_a', 0.44, 0.50);
  const found = findSeed(inst, core, (r) => r.ok && r.outcome === 'DRIBBLE_KNOCKED_LOOSE', { sequence: 0 });
  return { core, inst, ...found };
}

// ===========================================================================
// MT-01 ~ MT-04：基础编排
// ===========================================================================

test('MT-01. 最小 Tick 成功执行（Action → Interaction → Integration）', () => {
  const core = dribbleCore();
  const inst = dribbleInst('h_a', 0.45, 0.50);
  const found = findSeed(inst, core, (r) => r.ok && r.outcome === 'DRIBBLE_COMPLETED', { sequence: 0 });
  assert(found, '应存在 DRIBBLE_COMPLETED 的确定性 seed');
  const res = runMatchTick(core, { tickIndex: 1, actionInstance: inst, seed: found.seed, interactionSequence: 0 });
  assertEquals(res.tick.status, 'COMPLETED');
  assertEquals(res.invariantIssues, []);
  assert(res.tick.stages.includes('action'));
  assert(res.tick.stages.includes('interaction_resolve'));
  assert(res.tick.stages.includes('interaction_integrate'));
  assertEquals(res.matchCore.ball.state, BS.CONTROLLED);
  assertEquals(res.matchCore.ball.control, 'h_a');
});

test('MT-02. Tick 复用现有 ActionInstance（不重算 Decision；输入不可变）', () => {
  const core = dribbleCore();
  const inst = dribbleInst('h_a', 0.45, 0.50);
  const before = JSON.stringify(inst);
  const res = runMatchTick(core, { tickIndex: 2, actionInstance: inst, seed: 's0', interactionSequence: 0 });
  assertEquals(res.actionInstance.actionType, 'DRIBBLE');
  assertEquals(res.actionInstance.actorId, 'h_a');
  assertEquals(JSON.stringify(inst), before, '输入 ActionInstance 不得被修改');
  assertEquals(res.actionInstance.constructor, Object);
});

test('MT-02b. 未提供 ActionInstance 时走 C-04 Decision 接入', () => {
  const core = dribbleCore();
  const res = runMatchTick(core, { tickIndex: 3, playerId: 'h_a', seed: 's1', interactionSequence: 0 });
  assertEquals(res.tick.status, 'COMPLETED');
  if (res.actionInstance) assertEquals(res.actionInstance.actorId, 'h_a');
  assertEquals(res.invariantIssues, []);
});

test('MT-03. Tick 正确调用 Interaction Resolution（携带 tick metadata）', () => {
  const core = dribbleCore();
  const inst = dribbleInst('h_a', 0.45, 0.50);
  const found = findSeed(inst, core, (r) => r.ok, { sequence: 7 });
  const res = runMatchTick(core, { tickIndex: 7, actionInstance: inst, seed: found.seed, interactionSequence: 7 });
  assertEquals(res.interactionResult.type, 'INTERACTION_RESOLUTION');
  assertEquals(res.interactionResult.actionType, 'DRIBBLE');
  assertEquals(res.interactionResult.resolutionMeta.sequence, 7);
  assert(typeof res.interactionResult.outcome === 'string');
});

test('MT-04. Interaction Integration 后 MatchCore 正确更新', () => {
  const core = dribbleCore();
  const inst = dribbleInst('h_a', 0.45, 0.50);
  const found = findSeed(inst, core, (r) => r.ok && r.outcome === 'DRIBBLE_COMPLETED', { sequence: 0 });
  const beforeBall = JSON.stringify(core.ball);
  const res = runMatchTick(core, { tickIndex: 4, actionInstance: inst, seed: found.seed, interactionSequence: 0 });
  assertEquals(res.applied.interaction, true);
  assert(JSON.stringify(res.matchCore.ball) !== beforeBall, 'MatchCore.ball 应被更新');
  assertEquals(JSON.stringify(core.ball), beforeBall, '输入 MatchCore 不得被原地修改');
  assert(res.matchCore !== core);
});

// ===========================================================================
// MT-05 ~ MT-07：SECOND_BALL follow-up
// ===========================================================================

test('MT-05. requiresFollowUp=SECOND_BALL 时进入 Second-Ball Resolution', () => {
  const { core, inst, seed } = looseSetup();
  const res = runMatchTick(core, { tickIndex: 5, actionInstance: inst, seed, interactionSequence: 0 });
  assertEquals(res.interactionResult.requiresFollowUp, true);
  assertEquals(res.interactionResult.followUpKind, 'SECOND_BALL');
  assert(res.secondBallResult !== null, '应执行 Second-Ball Resolution');
  assertEquals(res.secondBallResult.type, 'SECOND_BALL_RESOLUTION');
  assert(res.tick.stages.includes('second_ball_resolve'));
  assert(res.tick.stages.includes('second_ball_integrate'));
});

test('MT-06. SECOND_BALL_WON：FREE → CONTROLLED', () => {
  const { core, inst, seed } = looseSetup();
  const res = runMatchTick(core, { tickIndex: 6, actionInstance: inst, seed, interactionSequence: 0 });
  assertEquals(res.secondBallResult.outcome, 'SECOND_BALL_WON');
  assertEquals(res.secondBallResult.winner.playerId, 'a_d');
  assertEquals(res.matchCore.ball.state, BS.CONTROLLED);
  assertEquals(res.matchCore.ball.control, 'a_d');
  assertEquals(res.matchCore.ball.possessingTeamId, A);
  assertEquals(res.applied.secondBall, true);
  assertEquals(res.invariantIssues, []);
});

test('MT-07. SECOND_BALL_NO_WINNER：FREE → FREE', () => {
  const { core, inst, seed } = looseSetup();
  // 收缩二点球争抢半径 → 无合法竞争者 → NO_WINNER（编排层可选参数，TBD-CAL）。
  const res = runMatchTick(core, { tickIndex: 6, actionInstance: inst, seed, interactionSequence: 0 }, { secondBallRange: 0.001 });
  assertEquals(res.secondBallResult.outcome, 'SECOND_BALL_NO_WINNER');
  assertEquals(res.matchCore.ball.state, BS.FREE);
  assertEquals(res.matchCore.ball.control, null);
  assertEquals(res.matchCore.ball.possessingTeamId, null);
  assertEquals(res.invariantIssues, []);
});

test('MT-08. 不满足 SECOND_BALL 条件时不调用 Second-Ball Resolution', () => {
  // (a) 未支持动作类型 → Interaction 未产生 follow-up。
  const core = coreOf([mk('h_a', H, 'MF', 0.5, 0.5)], { state: BS.CONTROLLED, control: 'h_a', poss: H });
  const move = { actionType: 'MOVE', actorId: 'h_a', target: { type: 'SPACE', x: 0.6, y: 0.5 } };
  const r1 = runMatchTick(core, { tickIndex: 8, actionInstance: move, seed: 's0', interactionSequence: 0 });
  assertEquals(r1.secondBallResult, null);
  assert(r1.events.some((e) => e.type === TICK_EVENT_TYPES.SECOND_BALL_SKIPPED && e.reason === 'NO_FOLLOW_UP'));

  // (b) DRIBBLE_COMPLETED（CONTROLLED，无 follow-up）→ 不进入 Second-Ball。
  const core2 = dribbleCore();
  const inst = dribbleInst('h_a', 0.45, 0.50);
  const found = findSeed(inst, core2, (r) => r.ok && r.outcome === 'DRIBBLE_COMPLETED', { sequence: 0 });
  const r2 = runMatchTick(core2, { tickIndex: 8, actionInstance: inst, seed: found.seed, interactionSequence: 0 });
  assertEquals(r2.interactionResult.requiresFollowUp, false);
  assertEquals(r2.secondBallResult, null);
});

test('MT-09. 一个 Tick 最多执行一次 SECOND_BALL', () => {
  const { core, inst, seed } = looseSetup();
  const res = runMatchTick(core, { tickIndex: 9, actionInstance: inst, seed, interactionSequence: 0 });
  assertEquals(MATCH_TICK_CONFIG.MAX_SECOND_BALL_PER_TICK, 1);
  assertEquals(res.tick.stages.filter((s) => s === 'second_ball_resolve').length, 1);
  assertEquals(res.events.filter((e) => e.type === TICK_EVENT_TYPES.SECOND_BALL_RESOLVED).length, 1);
});

test('MT-10. Tick 不递归产生新的 Tick', () => {
  const { core, inst, seed } = looseSetup();
  const res = runMatchTick(core, { tickIndex: 10, actionInstance: inst, seed, interactionSequence: 0 });
  assertEquals(res.events.filter((e) => e.type === TICK_EVENT_TYPES.TICK_STARTED).length, 1);
  assertEquals(res.events.filter((e) => e.type === TICK_EVENT_TYPES.TICK_ENDED).length, 1);
  assert(!('nextTick' in res) && !('subTick' in res), 'Tick 不得返回嵌套 Tick');
});

// ===========================================================================
// MT-11 ~ MT-13：确定性 / 幂等 / 不变量
// ===========================================================================

test('MT-11. 重复执行同一输入具有确定性（JSON 完全一致）', () => {
  const { core, inst, seed } = looseSetup();
  const r1 = runMatchTick(core, { tickIndex: 11, actionInstance: inst, seed, interactionSequence: 0 });
  const r2 = runMatchTick(core, { tickIndex: 11, actionInstance: inst, seed, interactionSequence: 0 });
  assertEquals(JSON.stringify(r1), JSON.stringify(r2));
  assertEquals(JSON.stringify(r1.matchCore), JSON.stringify(r2.matchCore));
});

test('MT-12. 重复消费保持既有 idempotency（无二次转移 / 漂移）', () => {
  const core = dribbleCore();
  const inst = dribbleInst('h_a', 0.45, 0.50);
  const found = findSeed(inst, core, (r) => r.ok && r.outcome === 'DRIBBLE_COMPLETED', { sequence: 0 });
  const r1 = runMatchTick(core, { tickIndex: 12, actionInstance: inst, seed: found.seed, interactionSequence: 0 });
  // 在已更新的 MatchCore 上重复消费同一 ActionInstance → ALREADY_APPLIED，无漂移。
  const r2 = runMatchTick(r1.matchCore, { tickIndex: 13, actionInstance: inst, seed: found.seed, interactionSequence: 0 });
  assertEquals(r2.applied.interaction, false);
  assertEquals(JSON.stringify(r2.matchCore), JSON.stringify(r1.matchCore));
});

test('MT-13. Invariant 检查（Tick 级 INV-01~07）', () => {
  const { core, inst, seed } = looseSetup();
  const won = runMatchTick(core, { tickIndex: 13, actionInstance: inst, seed, interactionSequence: 0 });
  assertEquals(checkTickInvariants(won.matchCore, { secondBallResult: won.secondBallResult }), []);

  const noWinner = runMatchTick(core, { tickIndex: 13, actionInstance: inst, seed, interactionSequence: 0 }, { secondBallRange: 0.001 });
  assertEquals(noWinner.matchCore.ball.state, BS.FREE); // INV-05
  assertEquals(checkTickInvariants(noWinner.matchCore, { secondBallResult: noWinner.secondBallResult }), []);

  // INV-07：注入伪第二套 ball truth → 必须被检出。
  const tampered = { ...won.matchCore, secondBall: { state: BS.FREE } };
  assert(checkTickInvariants(tampered).includes('INV-07_SECOND_BALL_TRUTH_PRESENT'));
});

// ===========================================================================
// MT-14 ~ MT-15：Source Guard
// ===========================================================================

test('MT-14. Math.random source scan（match-tick 源码无调用）', () => {
  for (const f of ['match-tick.js', 'match-tick-config.js']) {
    assert(!/Math\.random\s*\(/.test(readSrc(f)), `${f} 出现 Math.random 调用`);
  }
});

test('MT-15. Wall-clock guard（无 Date.now / performance.now / new Date）', () => {
  for (const f of ['match-tick.js', 'match-tick-config.js']) {
    const src = readSrc(f);
    assert(!/Date\.now\s*\(/.test(src), `${f} 依赖 Date.now`);
    assert(!/performance\.now\s*\(/.test(src), `${f} 依赖 performance.now`);
    assert(!/new\s+Date\s*\(/.test(src), `${f} 依赖 new Date`);
  }
});

// ===========================================================================
// MT-16 ~ MT-18：外部系统未被修改
// ===========================================================================

test('MT-16. Production Loop 未被修改（match-tick 仅编排既有能力）', () => {
  const code = stripComments(readSrc('match-tick.js'));
  const importsOf = (text) => {
    const re = /from\s+['"]\.\/([a-z0-9-]+)\.js['"]/g;
    const found = new Set();
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1]);
    return found;
  };
  const allowed = new Set([
    'decision-pipeline', 'interaction-resolution', 'second-ball-resolution',
    'interaction-integration', 'ball-facts', 'interaction-resolution-config', 'match-tick-config',
    // C-39：Continuous Transit Integration（Match Tick 生产接入；OPTION_B Completion Writer）
    'continuous-ball-movement-integration', 'match-clock-config',
  ]);
  for (const dep of importsOf(code)) assert(allowed.has(dep), `match-tick 依赖越界模块：${dep}`);
  assert(!/productionLoop|matchLoop|match-loop|production-loop/i.test(code));
});

test('MT-17. Renderer 未被修改（无 UI / 渲染依赖）', () => {
  for (const f of ['match-tick.js', 'match-tick-config.js']) {
    const code = stripComments(readSrc(f));
    assert(!/renderer|requestAnimationFrame|document\.|window\./i.test(code), `${f} 出现渲染/UI 依赖`);
  }
});

test('MT-18. PASS / SHOT 未被修改', () => {
  for (const f of ['pass-resolution.js', 'shot-resolution.js', 'pass-state-update.js', 'shot-state-update.js']) {
    assert(!readSrc(f).includes('match-tick'), `${f} 不应引用 match-tick 模块`);
  }
});