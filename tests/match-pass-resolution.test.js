/**
 * Step 39F-M-B-RESOLUTION-PASS —— PASS Resolution 测试。
 *
 * 覆盖：输入合法性 / 几何 / 误差模型 / Risk / Lane / Interception / 结果分类 /
 * Transit / Simultion Time / State Update / BallState Invariant / Possession /
 * RNG 隔离 / Determinism / 边界 / 极端 / 性质扫描 / 无 NaN·Infinity / 无副作用。
 *
 * 红线：不接生产 Match Loop；不改 MatchCore（除显式 State Update）；不写 stats/Growth/Development/Save。
 */

import { test, assert, assertEquals } from './harness.js';
import {
  resolvePass, calculatePassDifficulty, calculateTransitDuration, buildPassResolutionScope,
} from '../src/core/match/pass-resolution.js';
import {
  applyPassStateUpdate, advancePassTransit, completePassTransit,
} from '../src/core/match/pass-state-update.js';
import {
  PASS_RESOLUTION_CONFIG as C, PASS_OUTCOMES,
} from '../src/core/match/pass-resolution-config.js';
import { decidePlayerAction } from '../src/core/match/decision-pipeline.js';
import { dist } from '../src/core/match/player-situation.js';

const H = 'clb_h', A = 'clb_a';
const ATTRS = (o = {}) => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...o });
function mk(id, t, pos, x, y, attrs = {}, extra = {}) {
  return { playerId: id, teamId: t, position: pos, positionOnPitch: { x, y }, onPitch: true, injured: false, sentOff: false, attributes: ATTRS(attrs), fitness: 100, form: 50, morale: 50, matchLoad: 0, ...extra };
}
function coreOf(players, ballControl, poss, extra = {}) {
  const bp = players.find((p) => p.playerId === ballControl);
  return {
    worldId: 'w_res', season: 1, matchId: 'm_res', ruleVersion: 'match-pass-resolution-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 12, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball: { position: { ...(bp?.positionOnPitch ?? { x: 0.5, y: 0.5 }) }, control: ballControl, possessingTeamId: poss },
    players,
    tactical: { [H]: { formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' }, [A]: { formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' } },
    ...extra,
  };
}
const inst = (actorId, targetId, { intent = 'SHORT', risk = 'MEDIUM' } = {}) => ({
  actionType: 'PASS', actorId, target: { type: 'TEAMMATE', playerId: targetId }, intent,
  riskIntent: { level: risk, value: 0.5 }, commitment: { type: 'COMMITTED', duration: null },
});

// 可控场景
function safeCore() {
  return coreOf([
    mk('h_a', H, 'MF', 0.40, 0.50, { passing: 95 }), mk('h_t', H, 'MF', 0.45, 0.50),
    mk('a_gk', A, 'GK', 0.95, 0.50),
  ], 'h_a', H);
}
function badCore() {
  return coreOf([
    mk('h_a', H, 'MF', 0.20, 0.50, { passing: 5 }), mk('h_t', H, 'MF', 0.78, 0.50),
    mk('a_p1', A, 'MF', 0.20, 0.45), mk('a_p2', A, 'MF', 0.20, 0.55), mk('a_gk', A, 'GK', 0.97, 0.50),
  ], 'h_a', H);
}
function interceptCore() {
  return coreOf([
    mk('h_a', H, 'MF', 0.30, 0.50, { passing: 60 }), mk('h_t', H, 'MF', 0.60, 0.50),
    mk('a_i', A, 'MF', 0.45, 0.50, { defending: 70 }), mk('a_gk', A, 'GK', 0.97, 0.50),
  ], 'h_a', H);
}
function blockCore() {
  return coreOf([
    mk('h_a', H, 'MF', 0.40, 0.50, { passing: 85 }), mk('h_t', H, 'MF', 0.50, 0.50),
    mk('a_b', A, 'MF', 0.50, 0.47, { defending: 40 }), mk('a_gk', A, 'GK', 0.97, 0.50),
  ], 'h_a', H);
}
const findSeed = (core, i, pred) => {
  for (let s = 0; s < 500; s += 1) {
    const r = resolvePass(i, core, { seed: `s${s}` });
    if (pred(r)) return { seed: `s${s}`, r };
  }
  return null;
};

// ===========================================================================
// 输入合法性
// ===========================================================================

test('PR-01. 合法 PASS ActionInstance 被接受', () => {
  const r = resolvePass(inst('h_a', 'h_t'), safeCore(), { seed: 'a' });
  assertEquals(r.ok, true);
  assertEquals(r.type, 'PASS_RESOLUTION');
});

test('PR-02. 非 PASS ActionInstance 被拒绝', () => {
  const r = resolvePass({ actionType: 'SHOT', actorId: 'h_a', target: { type: 'GOAL_AREA', zone: 'CENTER' } }, safeCore(), { seed: 'a' });
  assertEquals(r.ok, false);
  assertEquals(r.outcome, PASS_OUTCOMES.CANCELLED);
  assertEquals(r.reason, 'NOT_PASS_ACTION');
});

test('PR-03. 无效 actor 被拒绝', () => {
  const r = resolvePass(inst('ghost', 'h_t'), safeCore(), { seed: 'a' });
  assertEquals(r.outcome, PASS_OUTCOMES.CANCELLED);
  assertEquals(r.reason, 'INVALID_ACTOR');
});

test('PR-04/05. 目标不存在 / 非法 target 被拒绝', () => {
  const r = resolvePass(inst('h_a', 'ghost'), safeCore(), { seed: 'a' });
  assertEquals(r.reason, 'INVALID_TARGET');
  // 对手不能作为传球目标
  const r2 = resolvePass(inst('h_a', 'a_gk'), safeCore(), { seed: 'a' });
  assertEquals(r2.reason, 'INVALID_TARGET');
});

test('PR-05b. 球员不可用 / 球未在 actor 控制 → 拒绝', () => {
  const injured = safeCore(); injured.players[0].injured = true;
  assertEquals(resolvePass(inst('h_a', 'h_t'), injured, { seed: 'a' }).reason, 'INVALID_ACTOR');
  const noBall = safeCore(); noBall.ball.control = 'h_t';
  assertEquals(resolvePass(inst('h_a', 'h_t'), noBall, { seed: 'a' }).reason, 'BALL_NOT_CONTROLLED_BY_ACTOR');
  const targetUnavail = safeCore(); targetUnavail.players[1].injured = true;
  assertEquals(resolvePass(inst('h_a', 'h_t'), targetUnavail, { seed: 'a' }).reason, 'INVALID_TARGET');
});

// ===========================================================================
// 几何 / 误差 / 边界
// ===========================================================================

test('PR-06/07/08/09. origin / intendedDestination / actualDestination / distance 正确', () => {
  const core = safeCore();
  const r = resolvePass(inst('h_a', 'h_t'), core, { seed: 'a', debug: true });
  assertEquals(r.debug.origin, { x: 0.40, y: 0.50 });
  assertEquals(r.intendedDestination, { x: 0.45, y: 0.50 });
  assert(r.actualDestination.x >= 0 && r.actualDestination.x <= 1);
  assert(r.actualDestination.y >= 0 && r.actualDestination.y <= 1);
  assert(Math.abs(r.execution.distance - dist({ x: 0.40, y: 0.50 }, { x: 0.45, y: 0.50 })) < 1e-9);
});

test('PR-10/39/40. errorMagnitude 有界，无 NaN / Infinity', () => {
  for (const s of ['a', 'b', 'c', 'd', 'e']) {
    const r = resolvePass(inst('h_a', 'h_t'), badCore(), { seed: s });
    assert(Number.isFinite(r.execution.errorMagnitude));
    assert(r.execution.errorMagnitude >= C.MIN_ERROR && r.execution.errorMagnitude <= C.MAX_ERROR);
    assert(Number.isFinite(r.execution.distance) && Number.isFinite(r.execution.pressure) && Number.isFinite(r.execution.interceptionRisk));
  }
});

test('PR-11. PASS_COMPLETED 可达（近距离，高 capability，无防守）', () => {
  const r = resolvePass(inst('h_a', 'h_t'), safeCore(), { seed: 'ok1' });
  assertEquals(r.outcome, PASS_OUTCOMES.COMPLETED);
});

test('PR-12. PASS_INACCURATE 可达（低能力，远距离，高压力，无线路拦截）', () => {
  const r = resolvePass(inst('h_a', 'h_t', { intent: 'LONG' }), badCore(), { seed: 'bad1' });
  assertEquals(r.outcome, PASS_OUTCOMES.INACCURATE);
});

test('PR-13. PASS_INTERCEPTED 可达（对手位于传球线路）', () => {
  const found = findSeed(interceptCore(), inst('h_a', 'h_t'), (r) => r.outcome === PASS_OUTCOMES.INTERCEPTED);
  assert(found !== null, '应存在产生 PASS_INTERCEPTED 的 seed');
  assert(found.r.execution.interceptionRisk > 0);
});

test('PR-14. PASS_BLOCKED 可达（落点附近防守球员）', () => {
  const found = findSeed(blockCore(), inst('h_a', 'h_t'), (r) => r.outcome === PASS_OUTCOMES.BLOCKED);
  assert(found !== null, '应存在产生 PASS_BLOCKED 的 seed');
});

test('PR-25. 高 passing → 误差更小（同 seed / 同局面）', () => {
  const hi = coreOf([mk('h_a', H, 'MF', 0.30, 0.50, { passing: 90 }), mk('h_t', H, 'MF', 0.60, 0.50), mk('a_gk', A, 'GK', 0.97, 0.5)], 'h_a', H);
  const lo = coreOf([mk('h_a', H, 'MF', 0.30, 0.50, { passing: 20 }), mk('h_t', H, 'MF', 0.60, 0.50), mk('a_gk', A, 'GK', 0.97, 0.5)], 'h_a', H);
  const rh = resolvePass(inst('h_a', 'h_t', { intent: 'LONG' }), hi, { seed: 'ab' });
  const rl = resolvePass(inst('h_a', 'h_t', { intent: 'LONG' }), lo, { seed: 'ab' });
  assert(rh.execution.errorMagnitude < rl.execution.errorMagnitude);
});

test('PR-26. 远距离 → 误差更大（同 actor / seed）', () => {
  const near = coreOf([mk('h_a', H, 'MF', 0.30, 0.50, { passing: 60 }), mk('h_t', H, 'MF', 0.35, 0.50), mk('a_gk', A, 'GK', 0.97, 0.5)], 'h_a', H);
  const far = coreOf([mk('h_a', H, 'MF', 0.15, 0.50, { passing: 60 }), mk('h_t', H, 'MF', 0.75, 0.50), mk('a_gk', A, 'GK', 0.97, 0.5)], 'h_a', H);
  assert(resolvePass(inst('h_a', 'h_t', { intent: 'LONG' }), far, { seed: 'd' }).execution.errorMagnitude
    > resolvePass(inst('h_a', 'h_t', { intent: 'SHORT' }), near, { seed: 'd' }).execution.errorMagnitude);
});

test('PR-27. 高压力 → 误差更大（同 seed，线路外对手）', () => {
  const low = coreOf([mk('h_a', H, 'MF', 0.30, 0.50, { passing: 60 }), mk('h_t', H, 'MF', 0.70, 0.50), mk('a_gk', A, 'GK', 0.97, 0.5)], 'h_a', H);
  const high = coreOf([
    mk('h_a', H, 'MF', 0.30, 0.50, { passing: 60 }), mk('h_t', H, 'MF', 0.70, 0.50),
    mk('a_p1', A, 'MF', 0.30, 0.45), mk('a_p2', A, 'MF', 0.30, 0.55), mk('a_gk', A, 'GK', 0.97, 0.5),
  ], 'h_a', H);
  assert(resolvePass(inst('h_a', 'h_t', { intent: 'LONG' }), high, { seed: 'p' }).execution.errorMagnitude
    > resolvePass(inst('h_a', 'h_t', { intent: 'LONG' }), low, { seed: 'p' }).execution.errorMagnitude);
});

test('PR-29. Interception exposure：线路对手 → >0；无线路对手 → 0', () => {
  const ri = resolvePass(inst('h_a', 'h_t'), interceptCore(), { seed: 'x' });
  assert(ri.execution.laneExposure > 0);
  const rs = resolvePass(inst('h_a', 'h_t'), safeCore(), { seed: 'x' });
  assertEquals(rs.execution.laneExposure, 0);
});

// ===========================================================================
// RiskIntent：只影响 execution profile
// ===========================================================================

test('PR-28. RiskIntent 影响 execution profile，而非直接 success bonus', () => {
  const core = coreOf([mk('h_a', H, 'MF', 0.30, 0.50, { passing: 60 }), mk('h_t', H, 'MF', 0.70, 0.50), mk('a_gk', A, 'GK', 0.97, 0.5)], 'h_a', H);
  const lo = resolvePass(inst('h_a', 'h_t', { risk: 'LOW', intent: 'LONG' }), core, { seed: 'r' });
  const hi = resolvePass(inst('h_a', 'h_t', { risk: 'HIGH', intent: 'LONG' }), core, { seed: 'r' });
  assert(hi.execution.errorMagnitude >= lo.execution.errorMagnitude, 'HIGH 应有更大 error exposure');
  // 不存在直接的 success 字段（不是 success bonus）
  assert(!('success' in hi) && !('successChance' in hi));
});

// ===========================================================================
// Transit / Simulation Time / 时长
// ===========================================================================

test('PR-15/16/17. Transit 字段完整；duration 有界；使用 simulationTime', () => {
  const r = resolvePass(inst('h_a', 'h_t'), safeCore(), { seed: 't' });
  const t = r.transit;
  assertEquals(t.state, 'IN_TRANSIT');
  assertEquals(t.startedAt, 12);
  assertEquals(t.progress, 0);
  assert(t.duration >= C.MIN_PASS_DURATION && t.duration <= C.MAX_PASS_DURATION);
  assert(t.from && t.to && t.intendedTargetId === 'h_t');
  assert(calculateTransitDuration(0.05, 'SHORT') >= C.MIN_PASS_DURATION);
  assert(calculateTransitDuration(0.9, 'LONG') <= C.MAX_PASS_DURATION);
});

// ===========================================================================
// State Update / BallState / Possession
// ===========================================================================

test('PR-18/19. applyPassStateUpdate：球进入 IN_TRANSIT 且清除控制者', () => {
  const core = safeCore();
  const r = resolvePass(inst('h_a', 'h_t'), core, { seed: 'u' });
  const next = applyPassStateUpdate(core, r);
  assertEquals(next.ball.state, 'IN_TRANSIT');
  assertEquals(next.ball.control, null);
  assertEquals(next.ball.possessingTeamId, null);
  assert(next.ball.transit !== undefined);
  // invariant：IN_TRANSIT 不得同时有 controlledBy
  assert(!(next.ball.state === 'IN_TRANSIT' && next.ball.control !== null));
  // 未 mutate 输入
  assertEquals(core.ball.state, undefined);
});

test('PR-20. possession transition：COMPLETED→目标控球；INACCURATE→FREE', () => {
  const done = completePassTransit(applyPassStateUpdate(safeCore(), resolvePass(inst('h_a', 'h_t'), safeCore(), { seed: 'c1' })));
  assertEquals(done.ball.state, 'CONTROLLED');
  assertEquals(done.ball.control, 'h_t');
  assertEquals(done.ball.possessingTeamId, H);
  assertEquals(done.ball.transit, undefined);

  const bad = badCore();
  const rb = resolvePass(inst('h_a', 'h_t', { intent: 'LONG' }), bad, { seed: 'c2' });
  assertEquals(rb.outcome, PASS_OUTCOMES.INACCURATE);
  const badNext = completePassTransit(applyPassStateUpdate(bad, rb));
  assertEquals(badNext.ball.state, 'FREE');
  assertEquals(badNext.ball.control, null);
  assertEquals(badNext.ball.possessingTeamId, null);
});

test('PR-20b. INTERCEPTED→拦截者控球（若已知）', () => {
  const found = findSeed(interceptCore(), inst('h_a', 'h_t'), (r) => r.outcome === PASS_OUTCOMES.INTERCEPTED && r.interceptorId);
  assert(found !== null);
  const next = completePassTransit(applyPassStateUpdate(interceptCore(), found.r));
  assertEquals(next.ball.state, 'CONTROLLED');
  assertEquals(next.ball.control, found.r.interceptorId);
  assertEquals(next.ball.possessingTeamId, A);
});

test('PR-Invariant. transit progress ∈ [0,1]；完成即 progress=1 语义', () => {
  const core = applyPassStateUpdate(safeCore(), resolvePass(inst('h_a', 'h_t'), safeCore(), { seed: 'pr' }));
  const mid = advancePassTransit(core, core.ball.transit.duration / 2);
  assert(mid.ball.transit.progress > 0 && mid.ball.transit.progress < 1);
  const end = advancePassTransit(core, core.ball.transit.duration + 10);
  assert(!end.ball.transit);
});

// ===========================================================================
// RNG 隔离 / Determinism / 变化
// ===========================================================================

test('PR-21. Decision RNG 与 Resolution RNG 隔离', () => {
  const core = safeCore();
  const pass = inst('h_a', 'h_t');
  const before = JSON.stringify(resolvePass(pass, core, { seed: 'iso' }));
  for (let k = 0; k < 50; k += 1) decidePlayerAction(core, 'h_a', { seed: 'iso', decisionSequence: k });
  const after = JSON.stringify(resolvePass(pass, core, { seed: 'iso' }));
  assertEquals(after, before);
});

test('PR-21b. 不同 passSequence / 不同球员互不污染', () => {
  const core = interceptCore();
  const a0 = JSON.stringify(resolvePass(inst('h_a', 'h_t'), core, { seed: 'x', passSequence: 0 }));
  resolvePass(inst('h_a', 'h_t'), core, { seed: 'x', passSequence: 1 });
  const a0b = JSON.stringify(resolvePass(inst('h_a', 'h_t'), core, { seed: 'x', passSequence: 0 }));
  assertEquals(a0b, a0);
});

test('PR-22/23. Resolution Determinism：1000 次重复一致', () => {
  const core = interceptCore();
  const base = JSON.stringify(resolvePass(inst('h_a', 'h_t'), core, { seed: 'det' }));
  let same = 0;
  for (let k = 0; k < 1000; k += 1) {
    if (JSON.stringify(resolvePass(inst('h_a', 'h_t'), core, { seed: 'det' })) === base) same += 1;
  }
  assertEquals(same, 1000);
});

test('PR-24. 不同 Seed 可产生合理变化（仍合法）', () => {
  const outcomes = new Set(); const errors = new Set();
  for (let s = 0; s < 300; s += 1) {
    const r = resolvePass(inst('h_a', 'h_t'), interceptCore(), { seed: `v${s}` });
    outcomes.add(r.outcome); errors.add(r.execution.errorMagnitude);
    assert(r.actualDestination.x >= 0 && r.actualDestination.x <= 1);
  }
  assert(outcomes.size >= 2, '不同 seed 应产生不同 outcome');
  assert(errors.size > 1, '不同 seed 应产生不同误差');
});

// ===========================================================================
// 不重新 Decision / 不产生 Event / 无副作用
// ===========================================================================

test('PR-30/31. Resolution 不重新决策、不产生 Event', () => {
  const core = blockCore(); // 局面本会偏好其它动作，但 Resolution 必须执行 PASS
  const r = resolvePass(inst('h_a', 'h_t'), core, { seed: 'nd' });
  assertEquals(r.type, 'PASS_RESOLUTION');
  assert(!('event' in r) && !('events' in r) && !('decision' in r) && !('candidate' in r));
  assert(!('actionType' in r) || r.type === 'PASS_RESOLUTION');
});

test('PR-32..37. 不写 stats/Growth/Training/Development/Save/Match Result；不改 MatchCore', () => {
  const core = safeCore();
  const before = JSON.stringify(core);
  const r = resolvePass(inst('h_a', 'h_t'), core, { seed: 'pure' });
  assertEquals(JSON.stringify(core), before, 'resolvePass 不得修改 MatchCore');
  for (const bad of ['stats', 'growth', 'training', 'development', 'save', 'score', 'goals', 'standings', 'fixture']) {
    assert(!(bad in r), `Resolution 不得包含 ${bad}`);
  }
});

// ===========================================================================
// 边界 / 极端
// ===========================================================================

test('PR-Boundary. 距离 0 / 极端坐标 / 能力极值 / risk 全档 / 无 NaN', () => {
  const zero = coreOf([mk('h_a', H, 'MF', 0.50, 0.50, { passing: 70 }), mk('h_t', H, 'MF', 0.50, 0.50), mk('a_gk', A, 'GK', 0.97, 0.5)], 'h_a', H);
  const r0 = resolvePass(inst('h_a', 'h_t'), zero, { seed: 'z' });
  assertEquals(r0.ok, true);
  assert(Number.isFinite(r0.execution.errorMagnitude));

  for (const passing of [1, 99]) {
    for (const risk of ['LOW', 'MEDIUM', 'HIGH']) {
      const core = coreOf([mk('h_a', H, 'MF', 0.10, 0.10, { passing }), mk('h_t', H, 'MF', 0.90, 0.90), mk('a_gk', A, 'GK', 0.97, 0.5)], 'h_a', H);
      const r = resolvePass(inst('h_a', 'h_t', { risk, intent: 'LONG' }), core, { seed: `${passing}${risk}` });
      assert(r.ok, '边界应返回 ok');
      assert(Number.isFinite(r.execution.errorMagnitude) && Number.isFinite(r.transit.duration));
      assert(r.actualDestination.x >= 0 && r.actualDestination.x <= 1 && r.actualDestination.y >= 0 && r.actualDestination.y <= 1);
    }
  }
});

test('PR-Property. 性质扫描：1000 输入全部合法、无异常', () => {
  const outcomes = new Set();
  for (let s = 0; s < 1000; s += 1) {
    const r = resolvePass(inst('h_a', 'h_t'), interceptCore(), { seed: `prop${s}`, debug: true });
    outcomes.add(r.outcome);
    assert(r.ok);
    assert([PASS_OUTCOMES.COMPLETED, PASS_OUTCOMES.INACCURATE, PASS_OUTCOMES.INTERCEPTED, PASS_OUTCOMES.BLOCKED].includes(r.outcome));
    for (const v of [r.execution.distance, r.execution.pressure, r.execution.errorMagnitude, r.execution.interceptionRisk, r.transit.duration]) {
      assert(Number.isFinite(v), '出现 NaN/Infinity');
    }
    assert(buildPassResolutionScope(interceptCore(), 'h_a', 'h_t', s, `prop${s}`).length > 0);
  }
  assert(outcomes.size >= 2);
});
