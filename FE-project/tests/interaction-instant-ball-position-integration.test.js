/**
 * Step 39F-M-C-33 —— Interaction Instant Ball Position Integration 生产接入测试。
 *
 * 目标：证明 Interaction Resolution 的 Ball Position 已 **正式经 C-27 Semantic Gate → C-32 Ownership
 * → C-29 Instant Position** 写入 `MatchCore.ball.position`（而非仅"边界存在"），且：
 * - 四类 Interaction（DRIBBLE / TACKLE / PRESS / INTERCEPTION）语义 = INSTANT 放行；
 * - 未知 / 非 INSTANT 类型 → 明确失败（`INTERACTION_BALL_MOVEMENT_SEMANTICS_UNSUPPORTED`），
 *   绝不静默视为 INSTANT，不进入 C-32 / C-29；
 * - final Ball Position === `interactionResult.ball.position`；IN_TRANSIT / same-position 不制造虚假 Movement；
 * - C-05 不写 position；C-29 是唯一最终 Position Writer；
 * - SECOND_BALL Position Integration = 0（C-31）；
 * - Position Failure → State Mutation 不执行（原子性）；MatchCore / Result immutable；
 * - 真实生产链验证：C-08 Match Tick → Resolution → Gate → C-32 → C-29 → C-05；
 * - 未修改 C-29 / C-27 / C-31；未接入 C-30；无 duration / Movement State / Transit / Trajectory。
 *
 * 红线：不接 Renderer；不改 Save / Schema；不改 C-08 Tick Lifecycle；不实现 C-30。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  resolveInteractionInstantBallPositionSemantics,
  INTERACTION_INSTANT_BALL_POSITION_INTEGRATION_SOURCE,
  INTERACTION_INSTANT_BALL_POSITION_INTEGRATION_RULE_VERSION,
  INTERACTION_INSTANT_BALL_POSITION_INTEGRATION_REASON,
} from '../src/core/match/interaction-instant-ball-position-integration.js';
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
import { runMatchTick } from '../src/core/match/match-tick.js';
import {
  INSTANT_BALL_POSITION_INTEGRATION_RULE_VERSION,
} from '../src/core/match/instant-ball-position-integration.js';
import {
  BALL_MOVEMENT_SEMANTICS, INTERACTION_BALL_MOVEMENT_SEMANTICS_RULE_VERSION,
} from '../src/core/match/interaction-ball-movement-semantics.js';

const H = 'clb_h', A = 'clb_a';
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const GATE = stripComments(readSrc('interaction-instant-ball-position-integration.js'));
const INTEGRATION = stripComments(readSrc('interaction-integration.js'));
const STATE_UPDATE = stripComments(readSrc('interaction-state-update.js'));
const R = INTERACTION_INSTANT_BALL_POSITION_INTEGRATION_REASON;

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
    worldId: 'w_c33', season: 1, matchId: 'm_c33', ruleVersion: 'match-interaction-resolution-v1',
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
    if (pred(r)) return { seed: `s${s}`, result: r };
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
  { key: 'DRIBBLE_COMPLETED', type: 'DRIBBLE', core: () => dribbleCore(), inst: () => dribbleInst('h_a'), resolve: resolveDribble, pred: (r) => r.outcome === DRIBBLE_OUTCOMES.COMPLETED },
  { key: 'DRIBBLE_LOST', type: 'DRIBBLE', core: () => dribbleCore({ challenger: { x: 0.41, y: 0.50 }, attrs: { technique: 5, pace: 5 } }), inst: () => dribbleInst('h_a'), resolve: resolveDribble, pred: (r) => r.outcome === DRIBBLE_OUTCOMES.LOST },
  { key: 'DRIBBLE_KNOCKED_LOOSE', type: 'DRIBBLE', core: () => dribbleCore({ challenger: { x: 0.41, y: 0.50 }, attrs: { technique: 5, pace: 5 } }), inst: () => dribbleInst('h_a'), resolve: resolveDribble, pred: (r) => r.outcome === DRIBBLE_OUTCOMES.KNOCKED_LOOSE },
  { key: 'TACKLE_WON', type: 'TACKLE', core: () => challengeCore({ actorAttrs: { defending: 99 }, carrierAttrs: { technique: 5, pace: 5 }, actorPos: { x: 0.465, y: 0.50 } }), inst: () => tackleInst('h_d', 'a_c'), resolve: resolveTackle, pred: (r) => r.outcome === TACKLE_OUTCOMES.WON },
  { key: 'TACKLE_LOST', type: 'TACKLE', core: () => challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99, pace: 99 } }), inst: () => tackleInst('h_d', 'a_c'), resolve: resolveTackle, pred: (r) => r.outcome === TACKLE_OUTCOMES.LOST },
  { key: 'TACKLE_LOOSE', type: 'TACKLE', core: () => challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99, pace: 99 } }), inst: () => tackleInst('h_d', 'a_c'), resolve: resolveTackle, pred: (r) => r.outcome === TACKLE_OUTCOMES.LOOSE },
  { key: 'PRESS_SUCCESS', type: 'PRESS', core: () => challengeCore({ actorAttrs: { defending: 99 }, carrierAttrs: { technique: 5 }, pressing: 'high' }), inst: () => pressInst('h_d', 'a_c'), resolve: resolvePress, pred: (r) => r.outcome === PRESS_OUTCOMES.SUCCESS },
  { key: 'PRESS_PRESSURE_ONLY', type: 'PRESS', core: () => challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99 }, pressing: 'low' }), inst: () => pressInst('h_d', 'a_c'), resolve: resolvePress, pred: (r) => r.outcome === PRESS_OUTCOMES.PRESSURE_ONLY },
  { key: 'PRESS_FAILED', type: 'PRESS', core: () => challengeCore({ actorAttrs: { defending: 5 }, carrierAttrs: { technique: 99 }, pressing: 'low' }), inst: () => pressInst('h_d', 'a_c'), resolve: resolvePress, pred: (r) => r.outcome === PRESS_OUTCOMES.FAILED },
  { key: 'INTERCEPTION_SUCCESS', type: 'INTERCEPTION', core: () => interceptionCore({ actorPos: { x: 0.50, y: 0.50 }, actorAttrs: { defending: 99 } }), inst: () => interceptInst('a_i'), resolve: resolveInterception, pred: (r) => r.outcome === INTERCEPTION_OUTCOMES.INTERCEPTED },
  { key: 'INTERCEPTION_FAILED', type: 'INTERCEPTION', core: () => interceptionCore({ actorPos: { x: 0.50, y: 0.90 }, actorAttrs: { defending: 5 } }), inst: () => interceptInst('a_i'), resolve: resolveInterception, pred: (r) => r.outcome === INTERCEPTION_OUTCOMES.FAILED },
  { key: 'INTERCEPTION_DEFLECTED', type: 'INTERCEPTION', core: () => interceptionCore({ actorPos: { x: 0.50, y: 0.62 }, actorAttrs: { defending: 5 } }), inst: () => interceptInst('a_i'), resolve: resolveInterception, pred: (r) => r.outcome === INTERCEPTION_OUTCOMES.DEFLECTED },
];

function caseOf(key) {
  const def = CASE_DEFS.find((c) => c.key === key);
  const found = findSeed(def.resolve, def.inst(), def.core(), def.pred);
  return found ? { core: def.core(), result: found.result } : null;
}

const craftedResult = (actionType, position, state = BS.CONTROLLED) => ({
  type: 'INTERACTION_RESOLUTION', actionType, ok: true, outcome: `${actionType}_X`,
  actorId: 'x', targetId: null,
  ball: { position: { ...position }, state, inTransit: false },
  possession: { changed: false, retained: true, loose: false, fromPlayerId: 'x', fromTeamId: H, toPlayerId: 'x', toTeamId: H },
});

// ===========================================================================
// A. C-27 Semantic Gate
// ===========================================================================

test('C33-01. 四类 Interaction 语义 = INSTANT → Gate 放行', () => {
  for (const t of ['DRIBBLE', 'TACKLE', 'PRESS', 'INTERCEPTION']) {
    const g = resolveInteractionInstantBallPositionSemantics(craftedResult(t, { x: 0.6, y: 0.6 }));
    assertEquals(g.ok, true, `${t} 应放行`);
    assertEquals(g.instant, true);
    assertEquals(g.semantics, BALL_MOVEMENT_SEMANTICS.INSTANT);
    assertEquals(g.actionType, t);
    assertEquals(g.source, INTERACTION_INSTANT_BALL_POSITION_INTEGRATION_SOURCE);
    assertEquals(g.ruleVersion, INTERACTION_INSTANT_BALL_POSITION_INTEGRATION_RULE_VERSION);
  }
});

test('C33-02. 未知 / 非 Interaction 类型 → 明确失败（不静默视为 INSTANT）', () => {
  for (const t of ['MOVE', 'PASS', 'SHOT', 'FOUL', 'UNKNOWN', undefined, '', 123]) {
    const g = resolveInteractionInstantBallPositionSemantics(craftedResult(t, { x: 0.6, y: 0.6 }));
    assertEquals(g.ok, false, `${t} 不得放行`);
    assertEquals(g.instant, false);
    assertEquals(g.reason, R.SEMANTICS_UNSUPPORTED);
  }
});

test('C33-03. 非 InteractionResult → NOT_APPLICABLE（不进入 Position）', () => {
  for (const bad of [null, { type: 'SECOND_BALL_RESOLUTION', ok: true, ball: { state: BS.FREE } }, { type: 'INTERACTION_RESOLUTION', ok: false, ball: { state: BS.FREE } }, { type: 'INTERACTION_RESOLUTION', ok: true }]) {
    const g = resolveInteractionInstantBallPositionSemantics(bad);
    assertEquals(g.ok, false);
    assertEquals(g.instant, false);
    assertEquals(g.reason, R.NOT_INTERACTION_RESULT);
  }
});

test('C33-04. Gate 使用 C-27 Semantic Contract（不硬编码 actionType 白名单）', () => {
  assert(/resolveInteractionBallMovementSemantics/.test(GATE), 'Gate 必须委托 C-27');
  assert(!/actionType\s*===\s*['"]DRIBBLE['"]/.test(GATE), 'Gate 不得硬编码 DRIBBLE');
  assert(!/actionType\s*===\s*['"]TACKLE['"]/.test(GATE), 'Gate 不得硬编码 TACKLE');
  assertEquals(INTERACTION_BALL_MOVEMENT_SEMANTICS_RULE_VERSION, 'interaction-ball-movement-semantics-v1');
});

// ===========================================================================
// B. 四类 Interaction → C-29 生产接入（final Position）
// ===========================================================================

test('C33-05. DRIBBLE：final Position === interactionResult.ball.position（destination / scatter）', () => {
  const done = caseOf('DRIBBLE_COMPLETED');
  const e = integrateInteractionResolution(done.core, done.result);
  assertEquals(e.ok, true);
  assertEquals(e.matchCore.ball.position, done.result.ball.position, 'COMPLETED → 目标点');

  const loose = caseOf('DRIBBLE_KNOCKED_LOOSE');
  const e2 = integrateInteractionResolution(loose.core, loose.result);
  assertEquals(e2.matchCore.ball.position, loose.result.ball.position, 'KNOCKED_LOOSE → scatter');
});

test('C33-06. TACKLE：final Position === interactionResult.ball.position（contestPoint / carrierPos / scatter）', () => {
  const won = caseOf('TACKLE_WON');
  const e1 = integrateInteractionResolution(won.core, won.result);
  assertEquals(e1.matchCore.ball.position, won.result.ball.position, 'WON → contestPoint');
  assertEquals(e1.matchCore.ball.position, won.result.execution.contestPoint, 'WON position = contestPoint');

  const lost = caseOf('TACKLE_LOST');
  const e2 = integrateInteractionResolution(lost.core, lost.result);
  assertEquals(e2.matchCore.ball.position, lost.result.ball.position, 'LOST → carrierPos');

  const loose = caseOf('TACKLE_LOOSE');
  const e3 = integrateInteractionResolution(loose.core, loose.result);
  assertEquals(e3.matchCore.ball.position, loose.result.ball.position, 'LOOSE → scatter');
});

test('C33-07. PRESS：final Position === interactionResult.ball.position（change / unchanged）', () => {
  for (const key of ['PRESS_SUCCESS', 'PRESS_PRESSURE_ONLY', 'PRESS_FAILED']) {
    const c = caseOf(key);
    const e = integrateInteractionResolution(c.core, c.result);
    assertEquals(e.matchCore.ball.position, c.result.ball.position, `${key}: position 必须等于 Resolution 目标`);
  }
});

test('C33-08. INTERCEPTION：SUCCESS / DEFLECTED / FAILED 的 Position 语义', () => {
  const su = caseOf('INTERCEPTION_SUCCESS');
  const e1 = integrateInteractionResolution(su.core, su.result);
  assertEquals(e1.matchCore.ball.position, su.result.ball.position, 'SUCCESS → interceptPoint');

  const de = caseOf('INTERCEPTION_DEFLECTED');
  const e2 = integrateInteractionResolution(de.core, de.result);
  assertEquals(e2.matchCore.ball.position, de.result.ball.position, 'DEFLECTED → scatter');

  const fa = caseOf('INTERCEPTION_FAILED');
  assertEquals(fa.result.ball.state, BS.IN_TRANSIT);
  const e3 = integrateInteractionResolution(fa.core, fa.result);
  assertEquals(e3.matchCore.ball.position, fa.core.ball.position, 'FAILED → 保持当前球位（无虚假 Movement）');
  assertEquals(e3.applied, false);
  assertEquals(e3.matchCore, fa.core);
});

test('C33-09. same-position（TACKLE_LOST）→ 合法零位移，不制造 Movement / duration', () => {
  const c = caseOf('TACKLE_LOST');
  assertEquals(c.result.ball.position, c.core.ball.position, '前置：目标点 == 当前球位');
  const e = integrateInteractionResolution(c.core, c.result);
  assertEquals(e.matchCore.ball.position, c.core.ball.position, '零位移保持球位');
  assert(!('duration' in e.matchCore.ball) && !('movementState' in e.matchCore) && !('transit' in e.matchCore.ball), '不得产生 duration / Movement / transit');
});

// ===========================================================================
// C. 失败语义 / 原子性
// ===========================================================================

test('C33-10. 未知类型进入 Integration → ok:false，MatchCore 不变（不进入 C-32 / C-29）', () => {
  const core = challengeCore();
  const before = JSON.stringify(core);
  const bad = craftedResult('MOVE', { x: 0.9, y: 0.9 });
  const e = integrateInteractionResolution(core, bad);
  assertEquals(e.ok, false);
  assertEquals(e.applied, false);
  assertEquals(e.reason, INTEGRATION_REASONS.POSITION_INTEGRATION_FAILED);
  assertEquals(e.positionReason, R.SEMANTICS_UNSUPPORTED);
  assertEquals(e.matchCore, core, '输入 MatchCore 原样返回');
  assertEquals(JSON.stringify(core), before);
});

test('C33-11. C-29 失败（非法 position）→ ok:false，Position 未写入', () => {
  const core = challengeCore();
  const bad = craftedResult('PRESS', { x: NaN, y: 0 });
  const e = integrateInteractionResolution(core, bad);
  assertEquals(e.ok, false);
  assertEquals(e.applied, false);
  assertEquals(e.reason, INTEGRATION_REASONS.POSITION_INTEGRATION_FAILED);
  assertEquals(e.matchCore, core);
});

test('C33-12. C-29 失败 → C-05 State Mutation 不执行（State 无泄漏）', () => {
  const c = caseOf('TACKLE_WON');
  const bad = { ...c.result, ball: { ...c.result.ball, position: { x: NaN, y: 0 } } };
  const before = JSON.stringify(c.core);
  const e = integrateInteractionResolution(c.core, bad);
  assertEquals(e.ok, false);
  assertEquals(e.matchCore, c.core, '无半完成状态');
  assertEquals(e.matchCore.ball.control, c.core.ball.control, 'State 未被写入（原持球人不变）');
  assertEquals(e.matchCore.ball.state, c.core.ball.state, 'State 未被写入');
  assertEquals(JSON.stringify(c.core), before);
});

test('C33-13. C-05 State Mutation 为全函数（total）：任意输入集成层均返回结果对象', () => {
  const core = challengeCore();
  for (const r of [null, {}, { ok: false }, { ok: true, ball: { state: BS.CONTROLLED } }, { ok: true, ball: { state: BS.FREE }, possession: {} }]) {
    const out = integrateInteractionResolution(core, r);
    assert(out && typeof out === 'object', '集成层必须返回结果对象（无异常路径）');
    assertEquals(out.matchCore, core, '非法 / 不适用 → 原样返回输入 MatchCore');
  }
});

// ===========================================================================
// D. Immutability
// ===========================================================================

test('C33-14. 输入 MatchCore 不被原地修改（原始球位保持）', () => {
  for (const def of CASE_DEFS) {
    const c = caseOf(def.key);
    const before = JSON.stringify(c.core);
    const origPos = JSON.stringify(c.core.ball.position);
    integrateInteractionResolution(c.core, c.result);
    assertEquals(JSON.stringify(c.core), before, `${def.key}: 输入不变`);
    assertEquals(JSON.stringify(c.core.ball.position), origPos, `${def.key}: 原始球位不变`);
  }
});

test('C33-15. 输入 Interaction Result 不被修改（含 position）', () => {
  for (const def of CASE_DEFS) {
    const c = caseOf(def.key);
    const snap = JSON.stringify(c.result);
    integrateInteractionResolution(c.core, c.result);
    resolveInteractionInstantBallPositionSemantics(c.result);
    assertEquals(JSON.stringify(c.result), snap, `${def.key}: Result 不可变`);
  }
});

test('C33-16. 输出为全新对象：matchCore !== input，ball !== input.ball', () => {
  const c = caseOf('TACKLE_WON');
  const e = integrateInteractionResolution(c.core, c.result);
  assert(e.matchCore !== c.core);
  assert(e.matchCore.ball !== c.core.ball);
});

// ===========================================================================
// E. Position Write Count Guard（Interaction = 1；SECOND_BALL = 0）
// ===========================================================================

test('C33-17. Position 单写：C-06 恰好一处 C-32 调用；C-05 不写 position；Gate 不直写', () => {
  const calls = INTEGRATION.match(/applyInteractionBallPositionUpdate\s*\(/g) ?? [];
  assertEquals(calls.length, 1, 'C-06 恰好一处 Position Ownership 调用（单写）');
  assert(/resolveInteractionInstantBallPositionSemantics/.test(INTEGRATION), 'C-06 必须经过 C-27 Gate');
  assert(!/result\.ball\.position/.test(STATE_UPDATE), 'C-05 不得读 / 写 result.ball.position');
  assert(!/ball\.position\s*=/.test(STATE_UPDATE), 'C-05 不得直接写 ball.position');
  assert(!/applyInstantBallPositionUpdate|applyInteractionBallPositionUpdate/.test(GATE), 'Gate 不得自行写 Position（委托 C-32/C-29）');
  assert(!/matchCore\.ball\.position\s*=/.test(GATE), 'Gate 不得直写 MatchCore.ball.position');
});

test('C33-18. Gate 不重复实现 C-29 / 不产生第二 Position Boundary', () => {
  assert(!/from '\.\/instant-ball-position-integration\.js'/.test(GATE), 'Gate 不得直接依赖 C-29');
  assert(!/ball\s*:\s*\{/.test(GATE), 'Gate 不得自造 ball 状态');
  assertEquals(Object.keys(resolveInteractionInstantBallPositionSemantics(caseOf('TACKLE_WON').result)).sort(),
    ['actionType', 'instant', 'ok', 'reason', 'ruleVersion', 'semantics', 'source'].sort(), 'Gate 只返回语义判定，不含任何 Position Truth');
});

test('C33-19. SECOND_BALL Position Integration = 0（C-31）', () => {
  const mkFree = (players) => coreOf(players, { state: BS.FREE });
  const won = mkFree([mk('h_a', H, 'MF', 0.47, 0.5)]);
  const wonR = resolveSecondBall(won);
  assertEquals(wonR.outcome, SECOND_BALL_OUTCOMES.WON);
  const wonE = integrateSecondBallResolution(won, wonR);
  assertEquals(wonE.matchCore.ball.position, won.ball.position, 'WON 球位不变');
  assertEquals(wonE.matchCore.ball.state, BS.CONTROLLED, 'WON 仍发生 State Mutation');

  const nw = mkFree([]);
  const nwE = integrateSecondBallResolution(nw, resolveSecondBall(nw));
  assertEquals(nwE.matchCore.ball.position, nw.ball.position, 'NO_WINNER 球位不变');

  const inv = coreOf([mk('h_a', H, 'MF', 0.45, 0.5)], { state: BS.CONTROLLED, control: 'h_a', poss: H });
  const invE = integrateSecondBallResolution(inv, resolveSecondBall(inv));
  assertEquals(invE.matchCore.ball.position, inv.ball.position, 'INVALID 球位不变');

  const body = INTEGRATION.slice(INTEGRATION.indexOf('export function integrateSecondBallResolution'));
  assert(!/applyInteractionBallPositionUpdate|resolveInteractionInstantBallPositionSemantics/.test(body), 'SECOND_BALL 集成不得经过 Position Gate / Ownership');
});

// ===========================================================================
// F. 真实生产链验证（C-08 Match Tick → Resolution → Gate → C-32 → C-29 → C-05）
// ===========================================================================

test('C33-20. 生产链：runMatchTick 中 Interaction 经 C-29 写入最终球位', () => {
  const core = dribbleCore();
  const before = JSON.stringify(core);
  const found = findSeed(resolveDribble, dribbleInst('h_a'), core, (r) => r.outcome === DRIBBLE_OUTCOMES.COMPLETED);
  assert(found, '应能找到 COMPLETED 种子');
  const tick = runMatchTick(core, { tickIndex: 0, interactionSequence: 0, actionInstance: dribbleInst('h_a'), seed: found.seed });
  assertEquals(tick.interactionResult.actionType, 'DRIBBLE');
  assertEquals(tick.interactionResult.outcome, DRIBBLE_OUTCOMES.COMPLETED);
  assertEquals(tick.applied.interaction, true);
  assertEquals(tick.matchCore.ball.position, tick.interactionResult.ball.position, '生产链 final position = Resolution 目标');
  assertEquals(tick.invariantIssues, []);
  assertEquals(JSON.stringify(core), before, '输入 MatchCore 未被原地修改');
});

test('C33-21. 生产链：未知 ActionInstance 不写 Position（resolve 为 unsupported，不改球位）', () => {
  const core = dribbleCore();
  const before = JSON.stringify(core.ball.position);
  const tick = runMatchTick(core, { tickIndex: 0, actionInstance: { actionType: 'MOVE', actorId: 'h_a' } });
  assertEquals(tick.applied.interaction, false);
  assertEquals(JSON.stringify(tick.matchCore.ball.position), before, '未知动作不得移动球');
  assertEquals(tick.matchCore, core);
});

// ===========================================================================
// G. Source Guard
// ===========================================================================

test('C33-22. 新增 / 修改代码无 Math.random / Date.now / 墙钟 / physics', () => {
  for (const src of [GATE, INTEGRATION, STATE_UPDATE]) {
    assert(!/Math\.random\s*\(/.test(src));
    assert(!/Date\.now\s*\(/.test(src));
    assert(!/new\s+Date\s*\(/.test(src));
    assert(!/performance\.now\s*\(/.test(src));
  }
  for (const bad of ['physics', 'collision', 'trajectory', 'acceleration', 'gravity', 'bounce', 'spin']) {
    assert(!new RegExp(bad, 'i').test(GATE), `Gate 不得引入 ${bad}`);
  }
  assert(!/duration\s*[:=]/.test(GATE) && !/transit\s*[:=]/.test(GATE) && !/velocity\s*[:=]/i.test(GATE));
});

test('C33-23. 未修改 C-29 / C-27 / C-31；未接入 C-30', () => {
  assertEquals(INSTANT_BALL_POSITION_INTEGRATION_RULE_VERSION, 'instant-ball-position-integration-v1');
  assertEquals(INTERACTION_BALL_MOVEMENT_SEMANTICS_RULE_VERSION, 'interaction-ball-movement-semantics-v1');
  assertEquals(BALL_MOVEMENT_SEMANTICS.INSTANT, 'INSTANT');
  for (const f of ['interaction-instant-ball-position-integration.js', 'interaction-integration.js']) {
    const src = stripComments(readSrc(f));
    const imports = [...src.matchAll(/from\s+['"]\.\/([a-z0-9-]+)\.js['"]/g)].map((m) => m[1]);
    assert(!imports.some((n) => /30/.test(n)), `${f} 不得 import C-30`);
    assert(!/\b(apply|integrate|resolve)C30\b/.test(src), `${f} 不得调用 C-30`);
  }
  const c29 = stripComments(readSrc('instant-ball-position-integration.js'));
  assert(!/interaction-/.test(c29), 'C-29 不得反向依赖 Interaction 模块');
});