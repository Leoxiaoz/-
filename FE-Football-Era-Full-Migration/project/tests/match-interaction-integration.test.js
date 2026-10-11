/**
 * Step 39F-M-C-06 —— Interaction Resolution Integration & Possession Transfer Foundation 测试。
 *
 * 覆盖：
 * - Integration：Result → state-update（唯一 mutation 层）；Integration 不直接改 MatchCore；
 *   输入 Result / ActionInstance 不可变；
 * - Possession：transfer / control / team ownership / loose ball / transit；
 * - Invariants 1–5；
 * - Idempotency（重复消费不产生二次转移 / 漂移）；
 * - Deterministic；
 * - 架构红线：无第二套 Ball/Possession Truth、无 Math.random、无循环依赖、不重算 Resolution。
 *
 * 红线：不接 Production Loop / Renderer；不改 PASS / SHOT；不改 Save / Schema；不修改 C-05 语义。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  integrateInteractionResolution, resolveAndIntegrateInteraction,
  checkBallInvariants, checkMatchInvariants, deriveApplicationKey, INTEGRATION_REASONS,
} from '../src/core/match/interaction-integration.js';
import {
  resolveDribble, resolveTackle, resolvePress, resolveInterception,
} from '../src/core/match/interaction-resolution.js';
import {
  DRIBBLE_OUTCOMES, TACKLE_OUTCOMES, PRESS_OUTCOMES, INTERCEPTION_OUTCOMES,
  INTERACTION_BALL_STATE as BS,
} from '../src/core/match/interaction-resolution-config.js';

const H = 'clb_h', A = 'clb_a';
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');

const ATTRS = (o = {}) => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...o });
function mk(id, t, pos, x, y, attrs = {}) {
  return {
    playerId: id, teamId: t, position: pos, positionOnPitch: { x, y },
    onPitch: true, injured: false, sentOff: false, attributes: ATTRS(attrs),
    fitness: 100, form: 50, morale: 50, matchLoad: 0,
  };
}
const tac = () => ({ formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' });

function coreOf(players, { control = null, poss = null, ballPos = null, transit = null, state = null } = {}) {
  const carrier = players.find((p) => p.playerId === control);
  const bp = ballPos ?? (carrier?.positionOnPitch ?? { x: 0.5, y: 0.5 });
  const ball = { position: { ...bp }, control, possessingTeamId: poss };
  if (state) ball.state = state;
  if (transit) ball.transit = transit;
  return {
    worldId: 'w_int6', season: 1, matchId: 'm_int6', ruleVersion: 'match-interaction-resolution-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball, players,
    tactical: { [H]: tac(), [A]: tac() },
  };
}

const dribbleInst = (actorId, x = 0.52, y = 0.50) => ({ actionType: 'DRIBBLE', actorId, intent: 'FORWARD', target: { type: 'SPACE', x, y }, riskIntent: { level: 'MEDIUM', value: 0.5 } });
const tackleInst = (actorId, targetId) => ({ actionType: 'TACKLE', actorId, intent: 'CHALLENGE', target: { type: 'OPPONENT', playerId: targetId }, riskIntent: { level: 'MEDIUM', value: 0.5 } });
const pressInst = (actorId, targetId) => ({ actionType: 'PRESS', actorId, intent: 'CHASE', target: { type: 'OPPONENT', playerId: targetId }, riskIntent: { level: 'MEDIUM', value: 0.5 } });
const interceptInst = (actorId) => ({ actionType: 'INTERCEPTION', actorId, target: { type: 'BALL' }, riskIntent: { level: 'MEDIUM', value: 0.5 } });

function findSeed(resolveFn, inst, core, pred) {
  for (let s = 0; s < 800; s += 1) {
    const r = resolveFn(inst, core, { seed: `s${s}` });
    if (pred(r)) return r;
  }
  return null;
}

// —— 场景夹具 ——
const dribbleCore = ({ challenger = null, attrs = { technique: 99, pace: 99 } } = {}) => {
  const players = [mk('h_a', H, 'MF', 0.40, 0.50, attrs)];
  if (challenger) players.push(mk('a_d', A, 'DF', challenger.x, challenger.y, { defending: 70 }));
  return coreOf(players, { control: 'h_a', poss: H, state: BS.CONTROLLED });
};
function challengeCore({ actorAttrs = {}, carrierAttrs = {}, actorPos = { x: 0.44, y: 0.50 }, carrierPos = { x: 0.47, y: 0.50 }, pressing = 'medium' } = {}) {
  const players = [mk('a_c', A, 'MF', carrierPos.x, carrierPos.y, carrierAttrs), mk('h_d', H, 'DF', actorPos.x, actorPos.y, actorAttrs)];
  const core = coreOf(players, { control: 'a_c', poss: A, state: BS.CONTROLLED });
  core.tactical[H] = { ...tac(), pressing };
  return core;
}
function interceptionCore({ actorPos = { x: 0.50, y: 0.50 }, actorAttrs = {} } = {}) {
  const players = [mk('h_a', H, 'MF', 0.30, 0.50), mk('h_t', H, 'MF', 0.70, 0.50), mk('a_i', A, 'DF', actorPos.x, actorPos.y, actorAttrs)];
  return coreOf(players, {
    control: null, poss: null, ballPos: { x: 0.30, y: 0.50 }, state: BS.IN_TRANSIT,
    transit: { from: { x: 0.30, y: 0.50 }, to: { x: 0.70, y: 0.50 }, progress: 0.1, elapsed: 0.1, duration: 1, intendedTargetId: 'h_t', targetTeamId: H, actorId: 'h_a' },
  });
}

// —— 12 个 outcome → (core, result) ——
const CASE_DEFS = [
  { key: 'DRIBBLE_COMPLETED', core: () => dribbleCore(), inst: () => dribbleInst('h_a'), resolve: resolveDribble, pred: (r) => r.outcome === DRIBBLE_OUTCOMES.COMPLETED },
  { key: 'DRIBBLE_LOST', core: () => dribbleCore({ challenger: { x: 0.41, y: 0.50 }, attrs: { technique: 5, pace: 5 } }), inst: () => dribbleInst('h_a'), resolve: resolveDribble, pred: (r) => r.outcome === DRIBBLE_OUTCOMES.LOST },
  { key: 'DRIBBLE_KNOCKED_LOOSE', core: () => dribbleCore({ challenger: { x: 0.41, y: 0.50 }, attrs: { technique: 5, pace: 5 } }), inst: () => dribbleInst('h_a'), resolve: resolveDribble, pred: (r) => r.outcome === DRIBBLE_OUTCOMES.KNOCKED_LOOSE },
  { key: 'TACKLE_WON', core: () => challengeCore({ actorAttrs: { defending: 99 }, carrierAttrs: { technique: 5, pace: 5 }, actorPos: { x: 0.465, y: 0.50 } }), inst: () => tackleInst('h_d', 'a_c'), resolve: resolveTackle, pred: (r) => r.outcome === TACKLE_OUTCOMES.WON },
  { key: 'TACKLE_LOST', core: () => challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99, pace: 99 } }), inst: () => tackleInst('h_d', 'a_c'), resolve: resolveTackle, pred: (r) => r.outcome === TACKLE_OUTCOMES.LOST },
  { key: 'TACKLE_LOOSE', core: () => challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99, pace: 99 } }), inst: () => tackleInst('h_d', 'a_c'), resolve: resolveTackle, pred: (r) => r.outcome === TACKLE_OUTCOMES.LOOSE },
  { key: 'PRESS_SUCCESS', core: () => challengeCore({ actorAttrs: { defending: 99 }, carrierAttrs: { technique: 5 }, pressing: 'high' }), inst: () => pressInst('h_d', 'a_c'), resolve: resolvePress, pred: (r) => r.outcome === PRESS_OUTCOMES.SUCCESS },
  { key: 'PRESS_PRESSURE_ONLY', core: () => challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99 }, pressing: 'low' }), inst: () => pressInst('h_d', 'a_c'), resolve: resolvePress, pred: (r) => r.outcome === PRESS_OUTCOMES.PRESSURE_ONLY },
  { key: 'PRESS_FAILED', core: () => challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99 }, pressing: 'low' }), inst: () => pressInst('h_d', 'a_c'), resolve: resolvePress, pred: (r) => r.outcome === PRESS_OUTCOMES.FAILED },
  { key: 'INTERCEPTION_SUCCESS', core: () => interceptionCore({ actorPos: { x: 0.50, y: 0.50 }, actorAttrs: { defending: 99 } }), inst: () => interceptInst('a_i'), resolve: resolveInterception, pred: (r) => r.outcome === INTERCEPTION_OUTCOMES.INTERCEPTED },
  { key: 'INTERCEPTION_FAILED', core: () => interceptionCore({ actorPos: { x: 0.50, y: 0.90 }, actorAttrs: { defending: 5 } }), inst: () => interceptInst('a_i'), resolve: resolveInterception, pred: (r) => r.outcome === INTERCEPTION_OUTCOMES.FAILED },
  { key: 'INTERCEPTION_DEFLECTED', core: () => interceptionCore({ actorPos: { x: 0.50, y: 0.62 }, actorAttrs: { defending: 5 } }), inst: () => interceptInst('a_i'), resolve: resolveInterception, pred: (r) => r.outcome === INTERCEPTION_OUTCOMES.DEFLECTED },
];

/** 取得某个 outcome 的 (core, result)；失败返回 null。 */
function caseOf(key) {
  const def = CASE_DEFS.find((c) => c.key === key);
  const core = def.core();
  const result = findSeed(def.resolve, def.inst(), core, def.pred);
  return result ? { core, result } : null;
}

// ===========================================================================
// A. Integration 基础
// ===========================================================================

test('II-01. Result 正确进入 state-update（TACKLE_WON → 控制落地）', () => {
  const { core, result } = caseOf('TACKLE_WON');
  const e = integrateInteractionResolution(core, result);
  assertEquals(e.applied, true);
  assertEquals(e.reason, INTEGRATION_REASONS.APPLIED);
  assertEquals(e.invariantIssues, []);
  assertEquals(e.matchCore.ball.control, 'h_d');
  assertEquals(e.matchCore.ball.possessingTeamId, H);
  assertEquals(e.matchCore.ball.state, BS.CONTROLLED);
});

test('II-02. state-update 是唯一 mutation 层（Resolution 本身不改 MatchCore）', () => {
  const { core, result } = caseOf('TACKLE_WON');
  const before = JSON.stringify(core);
  const e = integrateInteractionResolution(core, result);
  assertEquals(JSON.stringify(core), before, '输入 matchCore 不应被直接修改');
  assert(e.matchCore !== core && e.matchCore.ball !== core.ball, '应返回新 matchCore / ball');
});

test('II-03. Integration 不直接修改 MatchCore（输入不变 + 新对象）', () => {
  const { core, result } = caseOf('DRIBBLE_COMPLETED');
  const before = JSON.stringify(core);
  const e = integrateInteractionResolution(core, result);
  assertEquals(JSON.stringify(core), before);
  assertEquals(Object.keys(e.matchCore).sort(), Object.keys(core).sort(), '不得新增顶层键（无第二套 truth）');
});

test('II-04. 输入 InteractionResolutionResult 不被修改', () => {
  const { core, result } = caseOf('PRESS_SUCCESS');
  const snapshot = JSON.stringify(result);
  integrateInteractionResolution(core, result);
  assertEquals(JSON.stringify(result), snapshot, 'Result 不应被 Integration 修改');
});

test('II-05. ActionInstance 不被修改（resolveAndIntegrateInteraction）', () => {
  const core = dribbleCore();
  const inst = dribbleInst('h_a');
  const snapshot = JSON.stringify(inst);
  const e = resolveAndIntegrateInteraction(inst, core);
  assertEquals(JSON.stringify(inst), snapshot, 'ActionInstance 不应被修改');
  assertEquals(e.applied, true);
  assertEquals(e.result.type, 'INTERACTION_RESOLUTION');
});

// ===========================================================================
// B. Possession Transfer 语义
// ===========================================================================

test('II-06. TACKLE_WON：possession transfer（原控制清除 / 新控制建立 / team 同步）', () => {
  const { core, result } = caseOf('TACKLE_WON');
  assertEquals(core.ball.control, 'a_c');
  const e = integrateInteractionResolution(core, result);
  assertEquals(e.matchCore.ball.control, 'h_d');
  assert(e.matchCore.ball.control !== 'a_c', '原控制者必须被清除');
  assertEquals(e.matchCore.ball.possessingTeamId, H);
});

test('II-07. DRIBBLE_LOST：possession transfer 到挑战对手', () => {
  const { core, result } = caseOf('DRIBBLE_LOST');
  const e = integrateInteractionResolution(core, result);
  assertEquals(e.matchCore.ball.control, 'a_d');
  assertEquals(e.matchCore.ball.possessingTeamId, A);
  assertEquals(e.matchCore.ball.state, BS.CONTROLLED);
});

test('II-08. loose ball：control / possessing team 全部清除', () => {
  const { core, result } = caseOf('DRIBBLE_KNOCKED_LOOSE');
  const e = integrateInteractionResolution(core, result);
  assertEquals(e.matchCore.ball.state, BS.FREE);
  assertEquals(e.matchCore.ball.control, null);
  assertEquals(e.matchCore.ball.possessingTeamId, null);
});

test('II-09. transit：INTERCEPTION_FAILED 保持 transit，不产生 possession', () => {
  const { core, result } = caseOf('INTERCEPTION_FAILED');
  const e = integrateInteractionResolution(core, result);
  assertEquals(e.applied, false);
  assertEquals(e.matchCore, core, '未拦截不应产生新状态');
  assertEquals(e.matchCore.ball.state, BS.IN_TRANSIT);
  assertEquals(e.matchCore.ball.control, null);
  assertEquals(e.matchCore.ball.possessingTeamId, null);
});

// ===========================================================================
// C. Invariants
// ===========================================================================

test('II-10. Invariant 1：control 与 possessingTeamId 所属球队一致', () => {
  const { core, result } = caseOf('TACKLE_WON');
  const e = integrateInteractionResolution(core, result);
  const p = e.matchCore.players.find((x) => x.playerId === e.matchCore.ball.control);
  assertEquals(e.matchCore.ball.possessingTeamId, p.teamId);
  assertEquals(checkMatchInvariants(e.matchCore), []);
});

test('II-11. Invariant 2：FREE 不得存在有效 control / possessing player', () => {
  const { core, result } = caseOf('PRESS_SUCCESS');
  const e = integrateInteractionResolution(core, result);
  assertEquals(e.matchCore.ball.state, BS.FREE);
  assertEquals(e.matchCore.ball.control, null);
  assertEquals(e.matchCore.ball.possessingTeamId, null);
  assertEquals(checkMatchInvariants(e.matchCore), []);
});

test('II-12. Invariant 3：IN_TRANSIT 不得错误产生新 possession', () => {
  const { core, result } = caseOf('INTERCEPTION_FAILED');
  const e = integrateInteractionResolution(core, result);
  assertEquals(checkBallInvariants(e.matchCore.ball), []);
  assertEquals(checkMatchInvariants(e.matchCore), []);
});

test('II-13. Invariant 4：A → B possession 转移（A 解除 / B 建立 / team 同步）', () => {
  const { core, result } = caseOf('TACKLE_WON');
  const from = core.ball.control;
  const to = result.possession.toPlayerId;
  const e = integrateInteractionResolution(core, result);
  assert(from === 'a_c' && to === 'h_d', '前置：A → B');
  assertEquals(e.matchCore.ball.control, to);
  assert(e.matchCore.ball.control !== from, 'A 的控制必须解除');
  assertEquals(e.matchCore.ball.possessingTeamId, e.matchCore.players.find((p) => p.playerId === to).teamId);
});

test('II-14. Invariant 5：PRESS_SUCCESS ≠ TACKLE_WON（不自动 transfer 给压迫者）', () => {
  const { core, result } = caseOf('PRESS_SUCCESS');
  const e = integrateInteractionResolution(core, result);
  assertEquals(e.matchCore.ball.control, null, 'PRESS_SUCCESS 不得把球交给 press actor');
  assertEquals(result.possession.toPlayerId, null);
  assertEquals(e.matchCore.ball.state, BS.FREE);
});

test('II-15. Invariant checker 能检出违规状态（负向验证）', () => {
  assert(checkBallInvariants({ state: BS.FREE, control: 'x', possessingTeamId: 't' }).includes('FREE_HAS_CONTROL'));
  assert(checkBallInvariants({ state: BS.CONTROLLED, control: null, possessingTeamId: null }).includes('CONTROLLED_WITHOUT_CONTROL'));
  assert(checkBallInvariants({ state: BS.IN_TRANSIT, control: 'x', possessingTeamId: 't' }).includes('IN_TRANSIT_HAS_CONTROL'));
  const core = challengeCore();
  core.ball = { position: { x: 0.5, y: 0.5 }, control: 'a_c', possessingTeamId: H, state: BS.CONTROLLED };
  assert(checkMatchInvariants(core).includes('CONTROL_TEAM_MISMATCH'));
});

// ===========================================================================
// D. Idempotency
// ===========================================================================

test('II-16. 同一 Result 重复消费不产生二次转移（TACKLE_WON）', () => {
  const { core, result } = caseOf('TACKLE_WON');
  const e1 = integrateInteractionResolution(core, result);
  const e2 = integrateInteractionResolution(e1.matchCore, result);
  assertEquals(e1.applied, true);
  assertEquals(e2.applied, false);
  assertEquals(e2.reason, INTEGRATION_REASONS.ALREADY_APPLIED);
  assertEquals(JSON.stringify(e2.matchCore), JSON.stringify(e1.matchCore), '不得发生状态漂移');
  assertEquals(e2.matchCore.ball.control, 'h_d');
});

test('II-17. 幂等性覆盖全部 12 个 outcome', () => {
  for (const def of CASE_DEFS) {
    const c = caseOf(def.key);
    assert(c, `${def.key} 场景应可构造`);
    const e1 = integrateInteractionResolution(c.core, c.result);
    const e2 = integrateInteractionResolution(e1.matchCore, c.result);
    assertEquals(e2.applied, false, `${def.key} 第二次消费应为 no-op`);
    assertEquals(JSON.stringify(e2.matchCore), JSON.stringify(e1.matchCore), `${def.key} 不得漂移`);
  }
});

test('II-18. 幂等性不依赖存储 ledger：不向 MatchCore 注入 application 状态', () => {
  const { core, result } = caseOf('TACKLE_WON');
  const e = integrateInteractionResolution(core, result);
  assert(!('appliedResolutions' in e.matchCore) && !('integration' in e.matchCore), '不得注入持久化应用账本');
  assert(!('possession' in e.matchCore), '不得注入第二套 possession truth');
});

test('II-19. applicationKey 为确定性派生值且不改动 MatchCore', () => {
  const { core, result } = caseOf('TACKLE_WON');
  const before = JSON.stringify(core);
  const k1 = deriveApplicationKey(core, result);
  const k2 = deriveApplicationKey(core, result);
  assertEquals(k1, k2);
  assert(typeof k1 === 'string' && k1.includes('TACKLE') && k1.includes('TACKLE_WON'));
  assertEquals(JSON.stringify(core), before);
});

// ===========================================================================
// E. Deterministic
// ===========================================================================

test('II-20. 相同 MatchCore + Result → 完全一致的 next MatchCore', () => {
  const { core, result } = caseOf('DRIBBLE_LOST');
  const a = integrateInteractionResolution(core, result);
  const b = integrateInteractionResolution(core, result);
  assertEquals(JSON.stringify(a.matchCore), JSON.stringify(b.matchCore));
  assertEquals(a.applied, b.applied);
  assertEquals(a.reason, b.reason);
});

test('II-21. resolveAndIntegrateInteraction 确定性：两次调用结果完全一致', () => {
  const core = dribbleCore({ challenger: { x: 0.41, y: 0.50 }, attrs: { technique: 5, pace: 5 } });
  const inst = dribbleInst('h_a');
  const a = resolveAndIntegrateInteraction(inst, core, { seed: 'fixed' });
  const b = resolveAndIntegrateInteraction(inst, core, { seed: 'fixed' });
  assertEquals(JSON.stringify(a.result), JSON.stringify(b.result));
  assertEquals(JSON.stringify(a.matchCore), JSON.stringify(b.matchCore));
});

// ===========================================================================
// F. 四类 Interaction 全覆（control / possession / ball state / transit）
// ===========================================================================

test('II-22. DRIBBLE 三态：COMPLETED / LOST / KNOCKED_LOOSE', () => {
  const done = integrateInteractionResolution(caseOf('DRIBBLE_COMPLETED').core, caseOf('DRIBBLE_COMPLETED').result);
  assertEquals(done.matchCore.ball.state, BS.CONTROLLED);
  assertEquals(done.matchCore.ball.control, 'h_a');
  const lost = integrateInteractionResolution(caseOf('DRIBBLE_LOST').core, caseOf('DRIBBLE_LOST').result);
  assertEquals(lost.matchCore.ball.control, 'a_d');
  assertEquals(lost.matchCore.ball.possessingTeamId, A);
  const loose = integrateInteractionResolution(caseOf('DRIBBLE_KNOCKED_LOOSE').core, caseOf('DRIBBLE_KNOCKED_LOOSE').result);
  assertEquals(loose.matchCore.ball.state, BS.FREE);
  assertEquals(loose.matchCore.ball.control, null);
});

test('II-23. TACKLE 三态：WON / LOST / LOOSE（重点 possession transfer）', () => {
  const won = integrateInteractionResolution(caseOf('TACKLE_WON').core, caseOf('TACKLE_WON').result);
  assertEquals(won.matchCore.ball.control, 'h_d');
  assertEquals(won.matchCore.ball.possessingTeamId, H);
  const lost = integrateInteractionResolution(caseOf('TACKLE_LOST').core, caseOf('TACKLE_LOST').result);
  assertEquals(lost.matchCore.ball.control, 'a_c', 'LOST → 原持球人保持');
  const loose = integrateInteractionResolution(caseOf('TACKLE_LOOSE').core, caseOf('TACKLE_LOOSE').result);
  assertEquals(loose.matchCore.ball.state, BS.FREE);
  assertEquals(loose.matchCore.ball.control, null);
});

test('II-24. PRESS 三态：SUCCESS / PRESSURE_ONLY / FAILED（SUCCESS ≠ transfer）', () => {
  const success = integrateInteractionResolution(caseOf('PRESS_SUCCESS').core, caseOf('PRESS_SUCCESS').result);
  assertEquals(success.matchCore.ball.state, BS.FREE);
  assertEquals(success.matchCore.ball.control, null);
  const pressure = integrateInteractionResolution(caseOf('PRESS_PRESSURE_ONLY').core, caseOf('PRESS_PRESSURE_ONLY').result);
  assertEquals(pressure.matchCore.ball.control, 'a_c', 'PRESSURE_ONLY → 持球人保留');
  const failed = integrateInteractionResolution(caseOf('PRESS_FAILED').core, caseOf('PRESS_FAILED').result);
  assertEquals(failed.matchCore.ball.control, 'a_c');
  assertEquals(failed.matchCore.ball.state, BS.CONTROLLED);
});

test('II-25. INTERCEPTION 三态：SUCCESS / FAILED / DEFLECTED（transit 转换）', () => {
  const success = integrateInteractionResolution(caseOf('INTERCEPTION_SUCCESS').core, caseOf('INTERCEPTION_SUCCESS').result);
  assertEquals(success.matchCore.ball.state, BS.CONTROLLED);
  assertEquals(success.matchCore.ball.control, 'a_i');
  assertEquals('transit' in success.matchCore.ball, false, '拦截成功 → transit 结束');
  const failed = integrateInteractionResolution(caseOf('INTERCEPTION_FAILED').core, caseOf('INTERCEPTION_FAILED').result);
  assertEquals(failed.matchCore.ball.state, BS.IN_TRANSIT, '未拦截 → 保持 transit');
  const deflected = integrateInteractionResolution(caseOf('INTERCEPTION_DEFLECTED').core, caseOf('INTERCEPTION_DEFLECTED').result);
  assertEquals(deflected.matchCore.ball.state, BS.FREE, '脱手 → loose，transit 结束');
  assertEquals(deflected.matchCore.ball.control, null);
});

// ===========================================================================
// G. 架构红线
// ===========================================================================

test('II-26. Integration 不使用 Math.random', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Integration 不应调用 Math.random'); };
  try {
    const { core, result } = caseOf('TACKLE_WON');
    integrateInteractionResolution(core, result);
    resolveAndIntegrateInteraction(tackleInst('h_d', 'a_c'), challengeCore(), { seed: 'x' });
  } finally {
    Math.random = original;
  }
});

test('II-27. Integration 源码无 Math.random 调用', () => {
  assert(!/Math\.random\s*\(/.test(readSrc('interaction-integration.js')), 'interaction-integration.js 出现 Math.random 调用');
});

test('II-28. 无第二套 Ball / Possession Truth（不依赖 ball-physics / ball-facts）', () => {
  const importsOf = (name) => {
    const re = /from\s+['"]\.\/([a-z0-9-]+)\.js['"]/g;
    const found = new Set();
    let m;
    while ((m = re.exec(readSrc(name))) !== null) found.add(m[1]);
    return found;
  };
  const imps = importsOf('interaction-integration.js');
  for (const bad of ['ball-physics', 'ball-facts', 'decision-pipeline', 'decision-candidates']) {
    assert(!imps.has(bad), `integration 不应依赖 ${bad}`);
  }
});

test('II-29. Integration 不重算 Resolution（源码无概率 / RNG 常量）', () => {
  const src = readSrc('interaction-integration.js');
  for (const token of ['successProb', 'createDecisionRng', 'INTERACTION_RESOLUTION_CONFIG', 'rng.next']) {
    assert(!src.includes(token), `integration 不应重算 Resolution（出现 ${token}）`);
  }
});

test('II-30. 无循环依赖（Integration 导入图无环）', () => {
  const importsOf = (name) => {
    const re = /from\s+['"]\.\/([a-z0-9-]+)\.js['"]/g;
    const found = new Set();
    let m;
    while ((m = re.exec(readSrc(name))) !== null) found.add(m[1]);
    return found;
  };
  const graph = {
    'interaction-integration.js': importsOf('interaction-integration.js'),
    'interaction-state-update.js': importsOf('interaction-state-update.js'),
    'interaction-resolution.js': importsOf('interaction-resolution.js'),
    'player-situation.js': importsOf('player-situation.js'),
    'decision-rng.js': importsOf('decision-rng.js'),
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

test('II-31. 非法 / 不适用 Result → 不改状态', () => {
  const core = challengeCore();
  const before = JSON.stringify(core);
  assertEquals(integrateInteractionResolution(core, null).applied, false);
  assertEquals(integrateInteractionResolution(core, { ok: false, type: 'INTERACTION_RESOLUTION' }).applied, false);
  assertEquals(integrateInteractionResolution(core, { ok: true, type: 'OTHER', ball: { state: 'CONTROLLED' } }).applied, false);
  assertEquals(JSON.stringify(core), before);
});

test('II-32. PASS / SHOT Resolution 未被修改', () => {
  for (const f of ['pass-resolution.js', 'shot-resolution.js', 'pass-state-update.js', 'shot-state-update.js']) {
    assert(!readSrc(f).includes('interaction-integration'), `${f} 不应引用 integration 模块`);
  }
});