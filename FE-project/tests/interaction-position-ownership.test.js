/**
 * Step 39F-M-C-32 —— Interaction Ball Position Ownership Decoupling 测试。
 *
 * 目标：证明 C-05 `applyInteractionStateUpdate` 的 Ball Position 写入职责已被
 * 独立到 `interaction-ball-position-ownership.js`（委托 C-29），且：
 * - Interaction 业务结果（Position / State / Possession / Control / LastTouch / Velocity）与
 *   C-32 之前 **完全一致**（BEFORE === AFTER，用旧 C-05 的忠实重建作基线）；
 * - SECOND_BALL 不经过 Position 边界（Position Write Count = 0，C-31 = NO_POSITION_CHANGE）；
 * - 单次 Interaction 只有一个 Position Integration 边界（架构：C-06 恰好一处调用）；
 * - 失败原子性：Position 失败 → 无任何 State 落地；
 * - Immutability：输入 MatchCore / Interaction Result 均不被修改；
 * - 未修改 C-29 / C-27 / C-31；未实现 C-30；无第二 Ball Position Truth；
 * - Source Guard：无 Math.random / Date.now / 墙钟 / physics / collision / trajectory /
 *   duration / transit。
 *
 * 红线：不接 Production Loop / Renderer；不改 Save / Schema；不改 PASS / SHOT；不实现 C-30。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyInteractionBallPositionUpdate,
  INTERACTION_BALL_POSITION_OWNERSHIP_SOURCE,
  INTERACTION_BALL_POSITION_OWNERSHIP_RULE_VERSION,
  INTERACTION_BALL_POSITION_OWNERSHIP_REASON,
} from '../src/core/match/interaction-ball-position-ownership.js';
import { applyInteractionStateUpdate } from '../src/core/match/interaction-state-update.js';
import {
  integrateInteractionResolution, integrateSecondBallResolution, INTEGRATION_REASONS,
} from '../src/core/match/interaction-integration.js';
import {
  resolveDribble, resolveTackle, resolvePress, resolveInterception,
} from '../src/core/match/interaction-resolution.js';
import {
  DRIBBLE_OUTCOMES, TACKLE_OUTCOMES, PRESS_OUTCOMES, INTERCEPTION_OUTCOMES,
  INTERACTION_BALL_STATE as BS,
} from '../src/core/match/interaction-resolution-config.js';
import { resolveSecondBall } from '../src/core/match/second-ball-resolution.js';
import { SECOND_BALL_OUTCOMES } from '../src/core/match/second-ball-resolution-config.js';
import { INSTANT_BALL_POSITION_INTEGRATION_RULE_VERSION } from '../src/core/match/instant-ball-position-integration.js';
import { resolveInteractionBallMovementSemantics, BALL_MOVEMENT_SEMANTICS } from '../src/core/match/interaction-ball-movement-semantics.js';
import {
  getSecondBallBallMovementSemantics, SECOND_BALL_POSITION_SEMANTICS,
} from '../src/core/match/second-ball-ball-movement-semantics.js';

const H = 'clb_h', A = 'clb_a';
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const OWNERSHIP = stripComments(readSrc('interaction-ball-position-ownership.js'));
const STATE_UPDATE = stripComments(readSrc('interaction-state-update.js'));
const INTEGRATION = stripComments(readSrc('interaction-integration.js'));
const REASON = INTERACTION_BALL_POSITION_OWNERSHIP_REASON;

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
    worldId: 'w_c32', season: 1, matchId: 'm_c32', ruleVersion: 'match-interaction-resolution-v1',
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

// ---------------------------------------------------------------------------
// BEFORE / BASELINE：C-32 之前 C-05 的忠实重建（原子写 position + state）。
// 仅用于证明 AFTER === BEFORE；不参与生产路径。
// ---------------------------------------------------------------------------
function cloneBall(ball) {
  return {
    ...ball,
    position: { ...(ball?.position ?? { x: 0.5, y: 0.5 }) },
    transit: ball?.transit
      ? { ...ball.transit, from: { ...ball.transit.from }, to: { ...ball.transit.to } }
      : ball?.transit,
  };
}
function legacyC05(matchCore, result) {
  if (!matchCore || !result || !result.ok || !result.ball || !result.ball.state) return matchCore;
  const current = matchCore.ball ?? {};
  const position = { x: Number(result.ball.position?.x) || 0, y: Number(result.ball.position?.y) || 0 };
  if (result.ball.state === BS.IN_TRANSIT) return { ...matchCore, ball: cloneBall(current) };
  const controlled = result.ball.state === BS.CONTROLLED;
  const nextBall = {
    ...cloneBall(current),
    position,
    velocity: { x: 0, y: 0 },
    state: result.ball.state,
    control: controlled ? (result.possession?.toPlayerId ?? null) : null,
    possessingTeamId: controlled ? (result.possession?.toTeamId ?? null) : null,
    lastTouchPlayerId: controlled ? (result.possession?.toPlayerId ?? null) : (result.actorId ?? null),
  };
  delete nextBall.transit;
  return { ...matchCore, ball: nextBall };
}
/** C-32 之前的完整 Integration 结果（含目标状态收敛幂等）。 */
function legacyIntegrate(matchCore, result) {
  const candidate = legacyC05(matchCore, result);
  const changed = JSON.stringify(candidate?.ball ?? null) !== JSON.stringify(matchCore.ball ?? null);
  return changed ? candidate : matchCore;
}

// ===========================================================================
// A. Position Ownership Boundary（直接契约）
// ===========================================================================

test('C32-01. 写入成功：boundary → new MatchCore.ball.position === result.ball.position', () => {
  const { core, result } = caseOf('TACKLE_WON');
  const r = applyInteractionBallPositionUpdate(core, result);
  assertEquals(r.ok, true);
  assertEquals(r.integrated, true);
  assertEquals(r.matchCore.ball.position, result.ball.position);
  assertEquals(r.source, INTERACTION_BALL_POSITION_OWNERSHIP_SOURCE);
  assertEquals(r.ruleVersion, INTERACTION_BALL_POSITION_OWNERSHIP_RULE_VERSION);
});

test('C32-02. boundary 只改 position：state / control / possession / velocity 原样保留', () => {
  const { core, result } = caseOf('TACKLE_WON');
  const r = applyInteractionBallPositionUpdate(core, result);
  assertEquals(r.matchCore.ball.state, core.ball.state);
  assertEquals(r.matchCore.ball.control, core.ball.control);
  assertEquals(r.matchCore.ball.possessingTeamId, core.ball.possessingTeamId);
  assertEquals(r.matchCore.ball.velocity, core.ball.velocity);
});

test('C32-03. IN_TRANSIT → 不写 Position（NO_POSITION_CHANGE，integrated:false）', () => {
  const { core, result } = caseOf('INTERCEPTION_FAILED');
  assertEquals(result.ball.state, BS.IN_TRANSIT);
  const r = applyInteractionBallPositionUpdate(core, result);
  assertEquals(r.ok, true);
  assertEquals(r.integrated, false);
  assertEquals(r.reason, REASON.NO_POSITION_CHANGE);
  assertEquals(r.matchCore, core, '不集成时返回输入本身（不分配）');
});

test('C32-04. 非 Interaction / 非 ok / 无 ball → 不写 Position（NOT_APPLICABLE）', () => {
  const core = challengeCore();
  for (const bad of [null, { type: 'SECOND_BALL_RESOLUTION', ok: true, ball: { state: BS.FREE } }, { type: 'INTERACTION_RESOLUTION', ok: false, ball: { state: BS.FREE } }, { type: 'INTERACTION_RESOLUTION', ok: true }]) {
    const r = applyInteractionBallPositionUpdate(core, bad);
    assertEquals(r.ok, true);
    assertEquals(r.integrated, false);
    assertEquals(r.reason, REASON.NOT_APPLICABLE);
    assertEquals(r.matchCore, core);
  }
});

test('C32-05. Position 非法（NaN / 缺失）→ ok:false，无新 MatchCore', () => {
  const core = challengeCore();
  const r = applyInteractionBallPositionUpdate(core, { type: 'INTERACTION_RESOLUTION', ok: true, ball: { state: BS.CONTROLLED, position: { x: NaN, y: 0 } } });
  assertEquals(r.ok, false);
  assertEquals(r.integrated, false);
  assertEquals(r.reason, 'INVALID_POSITION');
  assert(!('matchCore' in r), '失败不得产出新 MatchCore');
});

test('C32-06. boundary 不可变：输入 MatchCore / Target Position 均不被修改', () => {
  const { core, result } = caseOf('DRIBBLE_COMPLETED');
  const coreSnap = JSON.stringify(core);
  const targetSnap = JSON.stringify(result.ball.position);
  const r = applyInteractionBallPositionUpdate(core, result);
  assertEquals(JSON.stringify(core), coreSnap);
  assertEquals(JSON.stringify(result.ball.position), targetSnap);
  assert(r.matchCore !== core && r.matchCore.ball !== core.ball);
  assert(r.matchCore.ball.position !== result.ball.position, 'position 必须为新对象（不共享 target 引用）');
});

// ===========================================================================
// B. Interaction Regression：AFTER === BEFORE（12 outcomes）
// ===========================================================================

test('C32-07. 全部 12 outcome：新流水线 ball 与旧 C-05 基线逐字节一致', () => {
  for (const def of CASE_DEFS) {
    const c = caseOf(def.key);
    assert(c, `${def.key} 场景应可构造`);
    const before = legacyIntegrate(c.core, c.result);
    const after = integrateInteractionResolution(c.core, c.result).matchCore;
    assertEquals(JSON.stringify(after), JSON.stringify(before), `${def.key}: AFTER 必须等于 BEFORE`);
  }
});

test('C32-08. Position：非 IN_TRANSIT → result.ball.position；IN_TRANSIT → 保持初始球位', () => {
  for (const def of CASE_DEFS) {
    const c = caseOf(def.key);
    const after = integrateInteractionResolution(c.core, c.result).matchCore;
    if (c.result.ball.state === BS.IN_TRANSIT) {
      assertEquals(after.ball.position, c.core.ball.position, `${def.key}: transit 球位不变`);
    } else {
      assertEquals(after.ball.position, c.result.ball.position, `${def.key}: 球位等于 Resolution 目标`);
    }
  }
});

test('C32-09. State / Possession / Control / LastTouch / Velocity 与旧基线一致', () => {
  for (const def of CASE_DEFS) {
    const c = caseOf(def.key);
    const before = legacyIntegrate(c.core, c.result).ball;
    const after = integrateInteractionResolution(c.core, c.result).matchCore.ball;
    assertEquals(after.state, before.state, `${def.key}: state`);
    assertEquals(after.control, before.control, `${def.key}: control`);
    assertEquals(after.possessingTeamId, before.possessingTeamId, `${def.key}: possessingTeamId`);
    assertEquals(after.lastTouchPlayerId, before.lastTouchPlayerId, `${def.key}: lastTouchPlayerId`);
    assertEquals(after.velocity, before.velocity, `${def.key}: velocity`);
  }
});

test('C32-10. 四类 Interaction（DRIBBLE / TACKLE / PRESS / INTERCEPTION）各 outcome 覆盖', () => {
  for (const def of CASE_DEFS) {
    const c = caseOf(def.key);
    assert(c, `${def.key} 应可构造`);
    const e = integrateInteractionResolution(c.core, c.result);
    assertEquals(e.ok, true);
    assertEquals(JSON.stringify(e.matchCore), JSON.stringify(legacyIntegrate(c.core, c.result)));
  }
});

// ===========================================================================
// C. Position Write Count Guard（架构：Interaction 恰好一处 Position Integration）
// ===========================================================================

test('C32-11. C-06 源码恰好一处 Position Integration 调用点（单次 Interaction ≤ 1 次写入）', () => {
  const matches = INTEGRATION.match(/applyInteractionBallPositionUpdate\s*\(/g) ?? [];
  assertEquals(matches.length, 1, 'Interaction 集成路径必须恰好一处 Position 写入边界调用');
});

test('C32-12. State Mutation（C-05）源码不含 result 派生的 position 写入（无第二次写入）', () => {
  assert(!/result\.ball\.position/.test(STATE_UPDATE), 'C-05 不得再读取 / 写入 result.ball.position');
  assert(!/ball\.position\s*=/.test(STATE_UPDATE), 'C-05 不得直接写 ball.position');
});

test('C32-13. Position Write Count：位置改变型 Interaction 记为 1 次集成', () => {
  for (const key of ['DRIBBLE_COMPLETED', 'TACKLE_WON', 'PRESS_SUCCESS', 'INTERCEPTION_DEFLECTED']) {
    const c = caseOf(key);
    const r = applyInteractionBallPositionUpdate(c.core, c.result);
    assertEquals(r.integrated, true, `${key} 应发生一次 Position Integration`);
  }
});

test('C32-14. Boundary 不产生第二 Ball Position Truth / 不引入 Movement 数据', () => {
  const { core, result } = caseOf('TACKLE_WON');
  const r = applyInteractionBallPositionUpdate(core, result);
  for (const k of ['movementState', 'transit', 'duration', 'velocity', 'trajectory', 'physics']) {
    assert(!(k in r), `boundary 结果不得含 ${k}`);
  }
  assertEquals(Object.keys(r.matchCore).sort(), Object.keys(core).sort(), '不得新增顶层键（无第二套 truth）');
});

// ===========================================================================
// D. SECOND_BALL Position Write Guard（Count = 0）
// ===========================================================================

const freeCore = (players = [mk('h_a', H, 'MF', 0.45, 0.5)]) => coreOf(players, { state: BS.FREE });

test('C32-15. SECOND_BALL 集成路径不引用 Position Ownership 边界', () => {
  const body = INTEGRATION.slice(INTEGRATION.indexOf('export function integrateSecondBallResolution'));
  assert(!/applyInteractionBallPositionUpdate/.test(body), 'SECOND_BALL 集成不得经过 Position Ownership');
});

test('C32-16. SECOND_BALL Position Write Count = 0：三类 outcome 球位完全不变', () => {
  // WON
  const wonCore = freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]);
  const wonR = resolveSecondBall(wonCore);
  assertEquals(wonR.outcome, SECOND_BALL_OUTCOMES.WON);
  const wonE = integrateSecondBallResolution(wonCore, wonR);
  assertEquals(wonE.matchCore.ball.position, wonCore.ball.position, 'WON 球位不变');
  assertEquals(wonE.matchCore.ball.state, BS.CONTROLLED, 'WON 仍发生 State Mutation');

  // NO_WINNER
  const nwCore = freeCore([]);
  const nwR = resolveSecondBall(nwCore);
  assertEquals(nwR.outcome, SECOND_BALL_OUTCOMES.NO_WINNER);
  const nwE = integrateSecondBallResolution(nwCore, nwR);
  assertEquals(nwE.matchCore.ball.position, nwCore.ball.position, 'NO_WINNER 球位不变');

  // INVALID（非 FREE 球）
  const invCore = coreOf([mk('h_a', H, 'MF', 0.45, 0.5)], { state: BS.CONTROLLED, control: 'h_a', poss: H });
  const invR = resolveSecondBall(invCore);
  assertEquals(invR.outcome, SECOND_BALL_OUTCOMES.INVALID);
  const invE = integrateSecondBallResolution(invCore, invR);
  assertEquals(invE.matchCore.ball.position, invCore.ball.position, 'INVALID 球位不变');
});

test('C32-17. SECOND_BALL 即使 State 变化，Position 仍完全不变（C-31 = NO_POSITION_CHANGE）', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]);
  const e = integrateSecondBallResolution(core, resolveSecondBall(core));
  assertEquals(e.applied, true, 'WON 应产生 State 变化');
  assertEquals(JSON.stringify(e.matchCore.ball.position), JSON.stringify(core.ball.position));
});

// ===========================================================================
// E. Failure Atomicity
// ===========================================================================

test('C32-18. Position 失败 → 整体 ok:false，无任何 State 落地（原子性）', () => {
  const { core, result } = caseOf('TACKLE_WON');
  const bad = { ...result, ball: { ...result.ball, position: { x: NaN, y: 0 } } };
  const before = JSON.stringify(core);
  const e = integrateInteractionResolution(core, bad);
  assertEquals(e.ok, false);
  assertEquals(e.applied, false);
  assertEquals(e.reason, INTEGRATION_REASONS.POSITION_INTEGRATION_FAILED);
  assertEquals(e.matchCore, core, '输入 MatchCore 必须原样返回（无半完成状态）');
  assertEquals(JSON.stringify(core), before);
  assertEquals(e.matchCore.ball.control, 'a_c', 'State 不得被写入（原持球人不变）');
});

test('C32-19. Position 失败（position 缺失）→ INVALID_INPUT，无 State 落地', () => {
  const { core, result } = caseOf('PRESS_SUCCESS');
  const bad = { ...result, ball: { ...result.ball } };
  delete bad.ball.position;
  const e = integrateInteractionResolution(core, bad);
  assertEquals(e.ok, false);
  assertEquals(e.applied, false);
  assertEquals(e.matchCore, core);
  assertEquals(e.matchCore.ball.state, core.ball.state, 'State 不得被写入');
});

test('C32-20. State Mutation 为全函数（total）：任意输入均返回 MatchCore，不抛错', () => {
  const core = challengeCore();
  for (const r of [null, {}, { ok: false }, { ok: true, ball: { state: BS.CONTROLLED } }, { ok: true, ball: { state: BS.FREE }, possession: {} }]) {
    const out = applyInteractionStateUpdate(core, r);
    assert(out && typeof out === 'object', 'C-05 必须返回 MatchCore（无失败路径）');
  }
  assertEquals(applyInteractionStateUpdate(core, null), core, 'ok:false → 恒等返回原对象（不产生半状态）');
});

// ===========================================================================
// F. Immutability
// ===========================================================================

test('C32-21. 输入 MatchCore 不被原地修改（旧位置保持）', () => {
  for (const def of CASE_DEFS) {
    const c = caseOf(def.key);
    const before = JSON.stringify(c.core);
    const origPos = JSON.stringify(c.core.ball.position);
    integrateInteractionResolution(c.core, c.result);
    assertEquals(JSON.stringify(c.core), before, `${def.key}: 输入 MatchCore 必须不变`);
    assertEquals(JSON.stringify(c.core.ball.position), origPos);
  }
});

test('C32-22. 输入 Interaction Resolution Result 不被修改（含 position 对象）', () => {
  for (const def of CASE_DEFS) {
    const c = caseOf(def.key);
    const snap = JSON.stringify(c.result);
    integrateInteractionResolution(c.core, c.result);
    applyInteractionBallPositionUpdate(c.core, c.result);
    assertEquals(JSON.stringify(c.result), snap, `${def.key}: Result 必须不可变`);
  }
});

test('C32-23. 输出为全新对象：matchCore !== input，ball !== input.ball', () => {
  const c = caseOf('TACKLE_WON');
  const e = integrateInteractionResolution(c.core, c.result);
  assert(e.matchCore !== c.core);
  assert(e.matchCore.ball !== c.core.ball);
});

// ===========================================================================
// G. 未修改 C-29 / C-27 / C-31；未实现 C-30
// ===========================================================================

test('C32-24. C-29 Contract 未修改（ruleVersion 稳定；boundary 复用 C-29）', () => {
  assertEquals(INSTANT_BALL_POSITION_INTEGRATION_RULE_VERSION, 'instant-ball-position-integration-v1');
  assert(/from '\.\/instant-ball-position-integration\.js'/.test(OWNERSHIP), 'boundary 必须复用 C-29');
  const c29 = stripComments(readSrc('instant-ball-position-integration.js'));
  assert(!/interaction-/.test(c29), 'C-29 不得 import Interaction 模块（未被反向耦合）');
});

test('C32-25. C-27 语义未修改（DRIBBLE/TACKLE/PRESS/INTERCEPTION = INSTANT）', () => {
  for (const t of ['DRIBBLE', 'TACKLE', 'PRESS', 'INTERCEPTION']) {
    const r = resolveInteractionBallMovementSemantics(t);
    assertEquals(r.ok, true);
    assertEquals(r.semantics, BALL_MOVEMENT_SEMANTICS.INSTANT);
  }
});

test('C32-26. C-31 语义未修改（SECOND_BALL = NO_POSITION_CHANGE）', () => {
  for (const o of [SECOND_BALL_OUTCOMES.WON, SECOND_BALL_OUTCOMES.NO_WINNER, SECOND_BALL_OUTCOMES.INVALID]) {
    const r = getSecondBallBallMovementSemantics(o);
    assertEquals(r.ok, true);
    assertEquals(r.semantics, SECOND_BALL_POSITION_SEMANTICS.NO_POSITION_CHANGE);
  }
});

test('C32-27. 未实现 / 未接入 C-30（无 C-30 模块 import / 调用）', () => {
  for (const f of ['interaction-integration.js', 'interaction-ball-position-ownership.js', 'interaction-state-update.js']) {
    const src = stripComments(readSrc(f));
    const imports = [...src.matchAll(/from\s+['"]\.\/([a-z0-9-]+)\.js['"]/g)].map((m) => m[1]);
    assert(!imports.some((n) => /30/.test(n)), `${f} 不得 import C-30 模块`);
    assert(!/\b(apply|integrate|resolve)C30\b/.test(src), `${f} 不得调用 C-30`);
  }
});

// ===========================================================================
// H. Source Guard（红线）
// ===========================================================================

test('C32-28. 新增 / 修改代码无 Math.random / Date.now / new Date / 墙钟', () => {
  for (const src of [OWNERSHIP, STATE_UPDATE]) {
    assert(!/Math\.random\s*\(/.test(src));
    assert(!/Date\.now\s*\(/.test(src));
    assert(!/new\s+Date\s*\(/.test(src));
    assert(!/performance\.now\s*\(/.test(src));
  }
});

test('C32-29. 不引入 physics / collision / trajectory / duration / transit 模型', () => {
  assert(!/physics|collision|trajectory|acceleration|gravity|bounce|spin/i.test(OWNERSHIP));
  assert(!/duration\s*[:=]/.test(OWNERSHIP));
  assert(!/transit\s*[:=]/.test(OWNERSHIP));
  assert(!/velocity\s*[:=]/i.test(OWNERSHIP));
});

test('C32-30. boundary 不直接写 MatchCore.ball.position（委托 C-29）', () => {
  assert(!/matchCore\.ball\.position\s*=/.test(OWNERSHIP));
  assert(!/\.ball\.position\s*=\s*\{/.test(OWNERSHIP));
});

test('C32-31. 无第二套 Ball Position Truth（不依赖 ball-facts / ball-physics / decision）', () => {
  for (const bad of ['ball-physics', 'ball-facts', 'decision-pipeline', 'decision-candidates']) {
    assert(!new RegExp(`from '\\./${bad}\\.js'`).test(OWNERSHIP), `boundary 不应依赖 ${bad}`);
  }
});