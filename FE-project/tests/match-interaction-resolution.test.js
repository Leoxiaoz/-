/**
 * Step 39F-M-C-05 —— Ball Interaction Resolution Foundation 测试。
 *
 * 覆盖：
 * - DRIBBLE / TACKLE / PRESS / INTERCEPTION 的成功 / 失败 / 球权 / 控制关系 / transit；
 * - deterministic（同输入 = 同结果）；
 * - 架构红线：Resolution 不改 MatchCore、不修改 ActionInstance、Result 为纯数据、
 *   无第二套 Ball Truth、无 Math.random、无循环依赖、state-update 才做 authoritative mutation。
 *
 * 红线：不接 Production Loop / Renderer；不改 Save / Schema；不修改 PASS / SHOT Resolution。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  resolveInteraction, resolveDribble, resolveTackle, resolvePress, resolveInterception,
  buildInteractionResolutionScope, resolveInteractionPressure,
} from '../src/core/match/interaction-resolution.js';
import { applyInteractionStateUpdate } from '../src/core/match/interaction-state-update.js';
import {
  DRIBBLE_OUTCOMES, TACKLE_OUTCOMES, PRESS_OUTCOMES, INTERCEPTION_OUTCOMES,
  INTERACTION_BALL_STATE as BS,
} from '../src/core/match/interaction-resolution-config.js';

const H = 'clb_h', A = 'clb_a';
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');

const ATTRS = (o = {}) => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...o });
function mk(id, t, pos, x, y, attrs = {}, extra = {}) {
  return {
    playerId: id, teamId: t, position: pos, positionOnPitch: { x, y },
    onPitch: true, injured: false, sentOff: false, attributes: ATTRS(attrs),
    fitness: 100, form: 50, morale: 50, matchLoad: 0, ...extra,
  };
}
const tac = () => ({ formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' });

function coreOf(players, { control = null, poss = null, ballPos = null, transit = null } = {}) {
  const carrier = players.find((p) => p.playerId === control);
  const bp = ballPos ?? (carrier?.positionOnPitch ?? { x: 0.5, y: 0.5 });
  const ball = { position: { ...bp }, control, possessingTeamId: poss };
  if (transit) ball.transit = transit;
  return {
    worldId: 'w_int', season: 1, matchId: 'm_int', ruleVersion: 'match-interaction-resolution-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball, players,
    tactical: { [H]: tac(), [A]: tac() },
  };
}

// —— ActionInstance 构造 ——
const dribbleInst = (actorId, x = 0.52, y = 0.50) => ({
  actionType: 'DRIBBLE', actorId, intent: 'FORWARD', target: { type: 'SPACE', x, y },
  riskIntent: { level: 'MEDIUM', value: 0.5 }, commitment: { type: 'COMMITTED_STEERABLE', duration: null },
});
const tackleInst = (actorId, targetId) => ({
  actionType: 'TACKLE', actorId, intent: 'CHALLENGE', target: { type: 'OPPONENT', playerId: targetId },
  riskIntent: { level: 'MEDIUM', value: 0.5 }, commitment: { type: 'COMMITTED', duration: null },
});
const pressInst = (actorId, targetId) => ({
  actionType: 'PRESS', actorId, intent: 'CHASE', target: { type: 'OPPONENT', playerId: targetId },
  riskIntent: { level: 'MEDIUM', value: 0.5 }, commitment: { type: 'INTERRUPTIBLE_CONTINUOUS', duration: null },
});
const interceptInst = (actorId) => ({
  actionType: 'INTERCEPTION', actorId, target: { type: 'BALL' },
  riskIntent: { level: 'MEDIUM', value: 0.5 }, commitment: { type: 'COMMITTED', duration: null },
});

/** 搜索一个能产生期望结果的 seed（不依赖概率假设；保持确定性）。 */
function findSeed(resolveFn, inst, core, pred) {
  for (let s = 0; s < 800; s += 1) {
    const r = resolveFn(inst, core, { seed: `s${s}` });
    if (pred(r)) return { seed: `s${s}`, r };
  }
  return null;
}

// ===========================================================================
// 场景夹具
// ===========================================================================

// DRIBBLE：actor 控球。
const dribbleMk = (attrs = { technique: 99, pace: 99 }) => mk('h_a', H, 'MF', 0.40, 0.50, attrs);
function dribbleCore({ challenger = null, attrs } = {}) {
  const players = [dribbleMk(attrs ?? { technique: 99, pace: 99 })];
  if (challenger) players.push(mk('a_d', A, 'DF', challenger.x, challenger.y, { defending: 70 }));
  return coreOf(players, { control: 'h_a', poss: H });
}

// TACKLE / PRESS：carrier a_c 控球，actor h_d 无球。
function challengeCore({ actorAttrs = {}, carrierAttrs = {}, actorPos = { x: 0.44, y: 0.50 }, carrierPos = { x: 0.47, y: 0.50 }, pressing = 'medium' } = {}) {
  const players = [
    mk('a_c', A, 'MF', carrierPos.x, carrierPos.y, carrierAttrs),
    mk('h_d', H, 'DF', actorPos.x, actorPos.y, actorAttrs),
  ];
  const core = coreOf(players, { control: 'a_c', poss: A });
  core.tactical[H] = { ...tac(), pressing };
  return core;
}

// INTERCEPTION：球在 transit（h_a → h_t）。
function interceptionCore({ actorPos = { x: 0.50, y: 0.50 }, actorAttrs = {} } = {}) {
  const players = [
    mk('h_a', H, 'MF', 0.30, 0.50), mk('h_t', H, 'MF', 0.70, 0.50),
    mk('a_i', A, 'DF', actorPos.x, actorPos.y, actorAttrs),
  ];
  return coreOf(players, {
    control: null, poss: null, ballPos: { x: 0.30, y: 0.50 },
    transit: { from: { x: 0.30, y: 0.50 }, to: { x: 0.70, y: 0.50 }, progress: 0.1, elapsed: 0.1, duration: 1, intendedTargetId: 'h_t', targetTeamId: H, actorId: 'h_a' },
  });
}

// ===========================================================================
// A. DRIBBLE
// ===========================================================================

test('IR-DR-01. 合法 DRIBBLE 被接受', () => {
  const r = resolveDribble(dribbleInst('h_a'), dribbleCore(), { seed: 'a' });
  assertEquals(r.ok, true);
  assertEquals(r.type, 'INTERACTION_RESOLUTION');
  assertEquals(r.actionType, 'DRIBBLE');
});

test('IR-DR-02. 非 DRIBBLE ActionInstance 被拒绝', () => {
  const r = resolveDribble(tackleInst('h_a', 'a_c'), dribbleCore(), { seed: 'a' });
  assertEquals(r.ok, false);
  assertEquals(r.outcome, DRIBBLE_OUTCOMES.CANCELLED);
  assertEquals(r.reason, 'NOT_DRIBBLE_ACTION');
});

test('IR-DR-03. 未控球的 DRIBBLE 被拒绝（BALL_NOT_CONTROLLED_BY_ACTOR）', () => {
  const core = coreOf([mk('h_a', H, 'MF', 0.40, 0.50)], { control: null, poss: null });
  const r = resolveDribble(dribbleInst('h_a'), core, { seed: 'a' });
  assertEquals(r.ok, false);
  assertEquals(r.reason, 'BALL_NOT_CONTROLLED_BY_ACTOR');
});

test('IR-DR-04. DRIBBLE 成功：保持控制 + 球推进到目标点', () => {
  const inst = dribbleInst('h_a', 0.52, 0.50);
  const r = resolveDribble(inst, dribbleCore(), { seed: 'a' });
  assertEquals(r.outcome, DRIBBLE_OUTCOMES.COMPLETED);
  assertEquals(r.ball.state, BS.CONTROLLED);
  assertEquals(r.ball.position, { x: 0.52, y: 0.50 });
  assertEquals(r.possession.changed, false);
  assertEquals(r.possession.retained, true);
  assertEquals(r.possession.toPlayerId, 'h_a');
  assertEquals(r.looseBall, false);
});

test('IR-DR-05. DRIBBLE 失败 → LOST：球权转移到挑战对手', () => {
  const core = dribbleCore({ challenger: { x: 0.41, y: 0.50 }, attrs: { technique: 5, pace: 5 } });
  const found = findSeed(resolveDribble, dribbleInst('h_a'), core, (r) => r.outcome === DRIBBLE_OUTCOMES.LOST);
  assert(found, '应能构造出 DRIBBLE_LOST');
  assertEquals(found.r.possession.changed, true);
  assertEquals(found.r.possession.toPlayerId, 'a_d');
  assertEquals(found.r.possession.toTeamId, A);
  assertEquals(found.r.ball.state, BS.CONTROLLED);
});

test('IR-DR-06. DRIBBLE 失败 → KNOCKED_LOOSE：loose ball + 后续解析标记', () => {
  const core = dribbleCore({ challenger: { x: 0.41, y: 0.50 }, attrs: { technique: 5, pace: 5 } });
  const found = findSeed(resolveDribble, dribbleInst('h_a'), core, (r) => r.outcome === DRIBBLE_OUTCOMES.KNOCKED_LOOSE);
  assert(found, '应能构造出 DRIBBLE_KNOCKED_LOOSE');
  assertEquals(found.r.ball.state, BS.FREE);
  assertEquals(found.r.looseBall, true);
  assertEquals(found.r.requiresFollowUp, true);
  assertEquals(found.r.followUpKind, 'SECOND_BALL');
  assertEquals(found.r.possession.changed, true);
});

test('IR-DR-07. DRIBBLE deterministic：相同输入 → 完全一致结果', () => {
  const core = dribbleCore({ challenger: { x: 0.41, y: 0.50 }, attrs: { technique: 5, pace: 5 } });
  const a = resolveDribble(dribbleInst('h_a'), core, { seed: 'fixed' });
  const b = resolveDribble(dribbleInst('h_a'), core, { seed: 'fixed' });
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

// ===========================================================================
// B. TACKLE
// ===========================================================================

test('IR-TK-01. 合法 TACKLE 被接受', () => {
  const r = resolveTackle(tackleInst('h_d', 'a_c'), challengeCore(), { seed: 'a' });
  assertEquals(r.ok, true);
  assertEquals(r.actionType, 'TACKLE');
});

test('IR-TK-02. 非 TACKLE ActionInstance 被拒绝', () => {
  const r = resolveTackle(pressInst('h_d', 'a_c'), challengeCore(), { seed: 'a' });
  assertEquals(r.ok, false);
  assertEquals(r.reason, 'NOT_TACKLE_ACTION');
});

test('IR-TK-03. 目标非持球人（TARGET_NOT_CARRIER）被拒绝', () => {
  const core = challengeCore();
  core.ball.control = 'a_other';
  const r = resolveTackle(tackleInst('h_d', 'a_c'), core, { seed: 'a' });
  assertEquals(r.ok, false);
  assertEquals(r.reason, 'TARGET_NOT_CARRIER');
});

test('IR-TK-04. TACKLE 成功 → WON：抢断者夺得控制', () => {
  const core = challengeCore({ actorAttrs: { defending: 99 }, carrierAttrs: { technique: 5, pace: 5 }, actorPos: { x: 0.465, y: 0.50 } });
  const found = findSeed(resolveTackle, tackleInst('h_d', 'a_c'), core, (r) => r.outcome === TACKLE_OUTCOMES.WON);
  assert(found, '应能构造出 TACKLE_WON');
  assertEquals(found.r.possession.changed, true);
  assertEquals(found.r.possession.toPlayerId, 'h_d');
  assertEquals(found.r.possession.toTeamId, H);
  assertEquals(found.r.ball.state, BS.CONTROLLED);
});

test('IR-TK-05. TACKLE 失败 → LOST：原持球人保持控制', () => {
  const core = challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99, pace: 99 } });
  const found = findSeed(resolveTackle, tackleInst('h_d', 'a_c'), core, (r) => r.outcome === TACKLE_OUTCOMES.LOST);
  assert(found, '应能构造出 TACKLE_LOST');
  assertEquals(found.r.possession.changed, false);
  assertEquals(found.r.possession.retained, true);
  assertEquals(found.r.possession.toPlayerId, 'a_c');
  assertEquals(found.r.ball.state, BS.CONTROLLED);
});

test('IR-TK-06. TACKLE 争抢 → LOOSE：球脱离原控制者（loose ball）', () => {
  const core = challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99, pace: 99 } });
  const found = findSeed(resolveTackle, tackleInst('h_d', 'a_c'), core, (r) => r.outcome === TACKLE_OUTCOMES.LOOSE);
  assert(found, '应能构造出 TACKLE_LOOSE');
  assertEquals(found.r.ball.state, BS.FREE);
  assertEquals(found.r.looseBall, true);
  assertEquals(found.r.requiresFollowUp, true);
  assertEquals(found.r.possession.changed, true);
});

test('IR-TK-07. TACKLE deterministic：相同输入 → 完全一致结果', () => {
  const core = challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99, pace: 99 } });
  const a = resolveTackle(tackleInst('h_d', 'a_c'), core, { seed: 'fixed' });
  const b = resolveTackle(tackleInst('h_d', 'a_c'), core, { seed: 'fixed' });
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

// ===========================================================================
// C. PRESS
// ===========================================================================

test('IR-PR-01. 合法 PRESS 被接受', () => {
  const r = resolvePress(pressInst('h_d', 'a_c'), challengeCore(), { seed: 'a' });
  assertEquals(r.ok, true);
  assertEquals(r.actionType, 'PRESS');
});

test('IR-PR-02. 非 PRESS ActionInstance 被拒绝', () => {
  const r = resolvePress(tackleInst('h_d', 'a_c'), challengeCore(), { seed: 'a' });
  assertEquals(r.ok, false);
  assertEquals(r.reason, 'NOT_PRESS_ACTION');
});

test('IR-PR-03. PRESS 成功：迫使持球人失控，但不直接夺球入控（≠ TACKLE）', () => {
  const core = challengeCore({ actorAttrs: { defending: 99 }, carrierAttrs: { technique: 5 }, pressing: 'high' });
  const found = findSeed(resolvePress, pressInst('h_d', 'a_c'), core, (r) => r.outcome === PRESS_OUTCOMES.SUCCESS);
  assert(found, '应能构造出 PRESS_SUCCESS');
  assertEquals(found.r.ball.state, BS.FREE);
  assertEquals(found.r.looseBall, true);
  assertEquals(found.r.requiresFollowUp, true);
  assertEquals(found.r.possession.changed, true);
  assertEquals(found.r.possession.toPlayerId, null, 'PRESS 成功不直接把球交给压迫者');
});

test('IR-PR-04. PRESS 施压：持球人保留控制但处于压力下', () => {
  const core = challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99 }, pressing: 'low' });
  const found = findSeed(resolvePress, pressInst('h_d', 'a_c'), core, (r) => r.outcome === PRESS_OUTCOMES.PRESSURE_ONLY);
  assert(found, '应能构造出 PRESS_PRESSURE_ONLY');
  assertEquals(found.r.possession.changed, false);
  assertEquals(found.r.possession.retained, true);
  assertEquals(found.r.ball.state, BS.CONTROLLED);
  assertEquals(found.r.possession.toPlayerId, 'a_c');
  assertEquals(found.r.execution.pressureApplied, true);
  assertEquals(found.r.execution.carrierRetainedControl, true);
});

test('IR-PR-05. PRESS 完全失败：无控制关系变化', () => {
  const core = challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99 }, pressing: 'low' });
  const found = findSeed(resolvePress, pressInst('h_d', 'a_c'), core, (r) => r.outcome === PRESS_OUTCOMES.FAILED);
  assert(found, '应能构造出 PRESS_FAILED');
  assertEquals(found.r.possession.changed, false);
  assertEquals(found.r.execution.pressureApplied, false);
});

test('IR-PR-06. PRESS deterministic：相同输入 → 完全一致结果', () => {
  const core = challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99 }, pressing: 'low' });
  const a = resolvePress(pressInst('h_d', 'a_c'), core, { seed: 'fixed' });
  const b = resolvePress(pressInst('h_d', 'a_c'), core, { seed: 'fixed' });
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

// ===========================================================================
// D. INTERCEPTION
// ===========================================================================

test('IR-IN-01. 合法 INTERCEPTION（球在 transit）被接受', () => {
  const r = resolveInterception(interceptInst('a_i'), interceptionCore(), { seed: 'a' });
  assertEquals(r.ok, true);
  assertEquals(r.actionType, 'INTERCEPTION');
});

test('IR-IN-02. 非 INTERCEPTION ActionInstance 被拒绝', () => {
  const r = resolveInterception(pressInst('a_i', 'a_c'), interceptionCore(), { seed: 'a' });
  assertEquals(r.ok, false);
  assertEquals(r.reason, 'NOT_INTERCEPTION_ACTION');
});

test('IR-IN-03. 球不在 transit → 被拒绝（BALL_NOT_IN_TRANSIT）', () => {
  const core = coreOf([mk('a_i', A, 'DF', 0.50, 0.50)], { control: null, poss: null });
  const r = resolveInterception(interceptInst('a_i'), core, { seed: 'a' });
  assertEquals(r.ok, false);
  assertEquals(r.reason, 'BALL_NOT_IN_TRANSIT');
});

test('IR-IN-04. INTERCEPTION 成功：拦截者夺得控制，transit 结束', () => {
  const core = interceptionCore({ actorPos: { x: 0.50, y: 0.50 }, actorAttrs: { defending: 99 } });
  const found = findSeed(resolveInterception, interceptInst('a_i'), core, (r) => r.outcome === INTERCEPTION_OUTCOMES.INTERCEPTED);
  assert(found, '应能构造出 INTERCEPTION_SUCCESS');
  assertEquals(found.r.possession.changed, true);
  assertEquals(found.r.possession.toPlayerId, 'a_i');
  assertEquals(found.r.possession.toTeamId, A);
  assertEquals(found.r.ball.state, BS.CONTROLLED);
  assertEquals(found.r.ball.inTransit, false);
});

test('IR-IN-05. INTERCEPTION 失败：球继续处于 transit，球权不变', () => {
  const core = interceptionCore({ actorPos: { x: 0.50, y: 0.90 }, actorAttrs: { defending: 5 } });
  const found = findSeed(resolveInterception, interceptInst('a_i'), core, (r) => r.outcome === INTERCEPTION_OUTCOMES.FAILED);
  assert(found, '应能构造出 INTERCEPTION_FAILED');
  assertEquals(found.r.ball.state, BS.IN_TRANSIT);
  assertEquals(found.r.ball.inTransit, true);
  assertEquals(found.r.possession.changed, false);
});

test('IR-IN-06. INTERCEPTION 触球脱手 → DEFLECTED：loose ball，transit 结束', () => {
  const core = interceptionCore({ actorPos: { x: 0.50, y: 0.62 }, actorAttrs: { defending: 5 } });
  const found = findSeed(resolveInterception, interceptInst('a_i'), core, (r) => r.outcome === INTERCEPTION_OUTCOMES.DEFLECTED);
  assert(found, '应能构造出 INTERCEPTION_DEFLECTED');
  assertEquals(found.r.ball.state, BS.FREE);
  assertEquals(found.r.ball.inTransit, false);
  assertEquals(found.r.looseBall, true);
  assertEquals(found.r.possession.changed, true);
});

test('IR-IN-07. INTERCEPTION deterministic：相同输入 → 完全一致结果', () => {
  const core = interceptionCore({ actorPos: { x: 0.50, y: 0.62 }, actorAttrs: { defending: 5 } });
  const a = resolveInterception(interceptInst('a_i'), core, { seed: 'fixed' });
  const b = resolveInterception(interceptInst('a_i'), core, { seed: 'fixed' });
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

// ===========================================================================
// E. State Update（authoritative mutation）
// ===========================================================================

test('IR-SU-01. applyInteractionStateUpdate 不改动输入 matchCore（返回新对象）', () => {
  const core = dribbleCore();
  const r = resolveDribble(dribbleInst('h_a'), core, { seed: 'a' });
  const before = JSON.stringify(core);
  const next = applyInteractionStateUpdate(core, r);
  assertEquals(JSON.stringify(core), before, '输入 matchCore 不应被 mutate');
  assert(next !== core && next.ball !== core.ball, '应返回新的 matchCore / ball');
});

test('IR-SU-02. CONTROLLED 结果 → control / possessingTeamId 落地，transit 清除', () => {
  const core = challengeCore({ actorAttrs: { defending: 99 }, carrierAttrs: { technique: 5, pace: 5 }, actorPos: { x: 0.465, y: 0.50 } });
  const found = findSeed(resolveTackle, tackleInst('h_d', 'a_c'), core, (r) => r.outcome === TACKLE_OUTCOMES.WON);
  const next = applyInteractionStateUpdate(core, found.r);
  assertEquals(next.ball.control, 'h_d');
  assertEquals(next.ball.possessingTeamId, H);
  assertEquals(next.ball.state, BS.CONTROLLED);
  assertEquals('transit' in next.ball, false);
});

test('IR-SU-03. FREE 结果 → control / possessingTeamId 清空', () => {
  const core = challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99, pace: 99 } });
  const found = findSeed(resolveTackle, tackleInst('h_d', 'a_c'), core, (r) => r.outcome === TACKLE_OUTCOMES.LOOSE);
  const next = applyInteractionStateUpdate(core, found.r);
  assertEquals(next.ball.control, null);
  assertEquals(next.ball.possessingTeamId, null);
  assertEquals(next.ball.state, BS.FREE);
});

test('IR-SU-04. 非法结果（ok:false）→ 状态不变', () => {
  const core = dribbleCore();
  const bad = resolveDribble(tackleInst('h_a', 'a_c'), core, { seed: 'a' });
  const next = applyInteractionStateUpdate(core, bad);
  assertEquals(next, core);
});

test('IR-SU-05. INTERCEPTION 失败 → 球保持 transit（权威状态不变）', () => {
  const core = interceptionCore({ actorPos: { x: 0.50, y: 0.90 }, actorAttrs: { defending: 5 } });
  const found = findSeed(resolveInterception, interceptInst('a_i'), core, (r) => r.outcome === INTERCEPTION_OUTCOMES.FAILED);
  const before = JSON.stringify(core);
  const next = applyInteractionStateUpdate(core, found.r);
  assertEquals(JSON.stringify(next), before, '未拦截不应改变权威球状态');
});

test('IR-SU-06. Resolution 路径不修改 MatchCore；仅 state-update 修改', () => {
  const core = dribbleCore();
  const before = JSON.stringify(core);
  const r = resolveDribble(dribbleInst('h_a'), core, { seed: 'a' });
  assertEquals(JSON.stringify(core), before, 'Resolution 阶段不得修改 MatchCore');
  const next = applyInteractionStateUpdate(core, r);
  assert(JSON.stringify(next) !== before, 'state-update 阶段应写入结果');
});

// ===========================================================================
// F. 架构红线
// ===========================================================================

test('IR-AR-01. resolveInteraction 不使用 Math.random', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Interaction Resolution 不应调用 Math.random'); };
  try {
    const core = dribbleCore();
    resolveInteraction(dribbleInst('h_a'), core, { seed: 'x' });
    resolveInteraction(tackleInst('h_d', 'a_c'), challengeCore(), { seed: 'x' });
    resolveInteraction(pressInst('h_d', 'a_c'), challengeCore(), { seed: 'x' });
    resolveInteraction(interceptInst('a_i'), interceptionCore(), { seed: 'x' });
  } finally {
    Math.random = original;
  }
});

test('IR-AR-02. Interaction 模块源码无 Math.random 调用', () => {
  for (const f of ['interaction-resolution.js', 'interaction-state-update.js', 'interaction-resolution-config.js']) {
    assert(!/Math\.random\s*\(/.test(readSrc(f)), `${f} 出现 Math.random 调用`);
  }
});

test('IR-AR-03. ActionInstance 输入不被修改', () => {
  const inst = dribbleInst('h_a');
  const snapshot = JSON.stringify(inst);
  resolveDribble(inst, dribbleCore(), { seed: 'a' });
  assertEquals(JSON.stringify(inst), snapshot, 'ActionInstance 不应被 Resolution 修改');
});

test('IR-AR-04. ResolutionResult 为纯数据（可序列化、无函数、无 authoritative 引用）', () => {
  const core = dribbleCore();
  const r = resolveDribble(dribbleInst('h_a'), core, { seed: 'a' });
  assert(typeof r === 'object' && r !== null);
  const hasFn = (obj) => Object.values(obj).some((v) => typeof v === 'function');
  assert(!hasFn(r), 'Result 不应含函数');
  assertEquals(JSON.parse(JSON.stringify(r)), r, 'Result 应可 JSON 往返');
  assert(r.ball !== core.ball, 'Result 不持有 MatchCore.ball 引用');
});

test('IR-AR-05. 无第二套 Ball Truth：Interaction 模块不依赖 ball-physics / ball-facts', () => {
  const imports = (name) => {
    const re = /from\s+['"]\.\/([a-z0-9-]+)\.js['"]/g;
    const found = new Set();
    let m;
    while ((m = re.exec(readSrc(name))) !== null) found.add(m[1]);
    return found;
  };
  for (const f of ['interaction-resolution.js', 'interaction-state-update.js', 'interaction-resolution-config.js']) {
    const imps = imports(f);
    assert(!imps.has('ball-physics') && !imps.has('ball-facts'), `${f} 不应耦合 ball-physics / ball-facts`);
    assert(!imps.has('decision-pipeline'), `${f} 不得调用 Decision`);
  }
});

test('IR-AR-06. 无循环依赖（Interaction 模块导入图无环）', () => {
  const imports = (name) => {
    const re = /from\s+['"]\.\/([a-z0-9-]+)\.js['"]/g;
    const found = new Set();
    let m;
    while ((m = re.exec(readSrc(name))) !== null) found.add(m[1]);
    return found;
  };
  const graph = {
    'interaction-resolution.js': imports('interaction-resolution.js'),
    'interaction-state-update.js': imports('interaction-state-update.js'),
    'player-situation.js': imports('player-situation.js'),
    'decision-rng.js': imports('decision-rng.js'),
  };
  const seen = new Set();
  const stack = new Set();
  const visit = (node) => {
    if (stack.has(node)) throw new Error(`检测到循环依赖：${node}`);
    if (seen.has(node)) return;
    stack.add(node);
    for (const dep of graph[node] ?? []) if (dep in graph) visit(dep);
    stack.delete(node);
    seen.add(node);
  };
  for (const n of Object.keys(graph)) visit(n);
});

test('IR-AR-07. 未支持的 actionType → 确定性 unsupported 结果，不抛错', () => {
  const r = resolveInteraction({ actionType: 'MOVE', actorId: 'h_a' }, dribbleCore(), { seed: 'x' });
  assertEquals(r.ok, false);
  assertEquals(r.reason, 'UNSUPPORTED_ACTION_TYPE');
});

test('IR-AR-08. PASS / SHOT Resolution 未被修改（仍可独立解析）', () => {
  // 仅验证接口未因 C-05 而改变：PASS / SHOT 模块未引用 Interaction 模块。
  for (const f of ['pass-resolution.js', 'shot-resolution.js']) {
    assert(!readSrc(f).includes('interaction-resolution'), `${f} 不应引用 interaction 模块`);
  }
});

test('IR-AR-09. RNG scope 隔离：不同 actionType → 不同 scope', () => {
  const core = dribbleCore();
  const s1 = buildInteractionResolutionScope(core, 'DRIBBLE', 'h_a', 0, 'seed');
  const s2 = buildInteractionResolutionScope(core, 'PRESS', 'h_a', 0, 'seed');
  assert(s1 !== s2, '不同 actionType 的 scope 必须不同');
  assert(s1.includes('|interaction|DRIBBLE'));
});

test('IR-AR-10. resolveInteractionPressure 为只读纯函数', () => {
  const core = challengeCore();
  const before = JSON.stringify(core);
  const p1 = resolveInteractionPressure(core, { x: 0.44, y: 0.50 }, 'h_d');
  const p2 = resolveInteractionPressure(core, { x: 0.44, y: 0.50 }, 'h_d');
  assertEquals(p1, p2);
  assert(p1 >= 0 && p1 <= 1);
  assertEquals(JSON.stringify(core), before);
});