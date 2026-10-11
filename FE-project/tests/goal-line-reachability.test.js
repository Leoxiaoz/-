/**
 * Goal-Line Reachability & Detection Contract —— 端到端集成测试。
 *
 * 覆盖：真实球路可达门区（PASS/SHOT → Transit → 球运动/完成 → Segment → C-15 → C-14）、
 * 门区几何 / 门后深度上限 / 左右对称、普通边界不变、状态时序、重复计分、终态守卫、确定性。
 *
 * 红线：不焊接生产赛季引擎；不新增第二套门区几何/比分权威；不手工伪造坐标/速度/Transit/候选；
 *       不使用 Math.random / 墙钟；纯函数测试仅为补充，端到端必须经真实生产函数组合。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';

import { resolveShot } from '../src/core/match/shot-resolution.js';
import { resolvePass } from '../src/core/match/pass-resolution.js';
import { applyShotStateUpdate, advanceShotTransit } from '../src/core/match/shot-state-update.js';
import { applyPassStateUpdate, advancePassTransit } from '../src/core/match/pass-state-update.js';
import { deriveBallTickSegment } from '../src/core/match/ball-tick-segment.js';
import { resolveGoalFromSegment, GOAL_AWARE_STATUS, GOAL_AWARE_REASON } from '../src/core/match/goal-aware-match-tick.js';
import { resolveBallBoundary } from '../src/core/match/ball-boundary.js';
import { stepBallPhysics } from '../src/core/match/ball-physics.js';
import { BALL_PHYSICS_CONFIG as CFG } from '../src/core/match/ball-physics-config.js';
import {
  clampToGoalAwareBounds, resolveCrossingBallState, detectGoalLineCrossing,
  deriveGoalGeometry, createGoalCandidateFromCrossing,
} from '../src/core/match/goal-geometry.js';
import {
  GOAL_MAX_DEPTH, GOAL_MOUTH_Y_MIN, GOAL_MOUTH_Y_MAX, assertValidGoalGeometryConfig,
} from '../src/core/match/goal-geometry-config.js';
import { INTERACTION_BALL_STATE as BS } from '../src/core/match/interaction-resolution-config.js';

const EPS = 1e-9;
const H = 'clb_h', A = 'clb_a';
const inMouth = (y) => y >= GOAL_MOUTH_Y_MIN - EPS && y <= GOAL_MOUTH_Y_MAX + EPS;

const mk = (id, t, pos, x, y, attrs = {}) => ({
  playerId: id, teamId: t, position: pos, positionOnPitch: { x, y },
  onPitch: true, injured: false, sentOff: false,
  attributes: { pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...attrs },
  fitness: 100, form: 50, morale: 50, matchLoad: 0,
});
const tac = () => ({ formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' });
function coreOf(players, control, poss, ballState = BS.CONTROLLED, extra = {}) {
  const bp = players.find((p) => p.playerId === control);
  return {
    worldId: 'w_glr', season: 1, matchId: 'm_glr', ruleVersion: 'x',
    teams: { home: H, away: A },
    clock: { simulationTime: 20, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball: { position: { ...bp.positionOnPitch }, control, possessingTeamId: poss, state: ballState },
    players, tactical: { [H]: tac(), [A]: tac() }, ...extra,
  };
}
const shotInst = (actorId) => ({
  actionType: 'SHOT', actorId, target: { type: 'GOAL_AREA', zone: 'CENTER' }, intent: 'GOAL',
  riskIntent: { level: 'MEDIUM', value: 0.5 }, commitment: { type: 'COMMITTED', duration: null },
});
const passInst = (actorId, targetId, risk = 'MEDIUM') => ({
  actionType: 'PASS', actorId, target: { type: 'TEAMMATE', playerId: targetId }, intent: 'SHORT',
  riskIntent: { level: risk, value: 0.5 }, commitment: { type: 'COMMITTED', duration: null },
});

/** 无门将 / 无干扰射门局面（保证 on-target 即 GOAL；门将缺失 → NO_SAVE）。 */
function homeShotCore() {
  return coreOf([mk('h_fw', H, 'FW', 0.85, 0.50, { finishing: 90, technique: 85 }), mk('a_df', A, 'DF', 0.20, 0.10)], 'h_fw', H);
}
function awayShotCore() {
  return coreOf([mk('a_fw', A, 'FW', 0.15, 0.50, { finishing: 90, technique: 85 }), mk('h_df', H, 'DF', 0.80, 0.10)], 'a_fw', A);
}
function passToLineCore() {
  return coreOf([
    mk('h_a', H, 'MF', 0.50, 0.50, { passing: 1 }), mk('h_t', H, 'MF', 0.97, 0.50), mk('a_gk', A, 'GK', 0.99, 0.50),
  ], 'h_a', H);
}

/** 在真实 Resolution 输出中搜索「球路终点位于门后区域且方向合法」的确定性 seed。 */
function findGoalTransit(inst, core, pred, max = 800) {
  for (let s = 0; s < max; s += 1) {
    const r = inst.actionType === 'SHOT'
      ? resolveShot(inst, core, { seed: `s${s}` })
      : resolvePass(inst, core, { seed: `s${s}` });
    if (r.ok && pred(r)) return { seed: `s${s}`, result: r };
  }
  return null;
}

/**
 * 真实端到端链：Resolution → 安装 Transit → 逐 Tick 球运动/完成 → Segment → C-15 → C-14。
 * 每个 Tick 用真实派生 Segment 做门线判定；进球仅经 C-14 写比分。
 */
function runTransitChain(core, resolution, applyFn, advanceFn, { dt, phase = 'FIRST_HALF', maxTicks = 64 } = {}) {
  let cur = applyFn(core, resolution);
  const installPos = { ...cur.ball.position };
  const origin = { ...resolution.transit.from };
  let prev = cur;
  let scored = 0; let ticks = 0; const crossings = [];
  while (prev.ball.transit && ticks < maxTicks) {
    ticks += 1;
    const next = advanceFn(prev, dt);
    const segment = deriveBallTickSegment(prev, next);
    const { goal, matchCore } = resolveGoalFromSegment(next, segment, { phase });
    if (goal.status === GOAL_AWARE_STATUS.GOAL_CONFIRMED) { scored += 1; crossings.push(goal.crossing); cur = matchCore; } else { cur = next; }
    prev = cur;
  }
  return { finalCore: cur, installPos, origin, scored, ticks, crossings };
}

// ===========================================================================
// 配置 / 门区几何纯函数
// ===========================================================================

test('GLR-01. GOAL_MAX_DEPTH 显式、有界、正；非法配置抛错', () => {
  assert(Number.isFinite(GOAL_MAX_DEPTH) && GOAL_MAX_DEPTH > 0);
  assert(assertValidGoalGeometryConfig());
  assertThrows(() => assertValidGoalGeometryConfig({ maxDepth: 0 }));
  assertThrows(() => assertValidGoalGeometryConfig({ maxDepth: -1 }));
  assertThrows(() => assertValidGoalGeometryConfig({ maxDepth: NaN }));
});

test('GLR-02. clampToGoalAwareBounds：门嘴内越线可达门后（左右对称、有界）；门框外/场内不变', () => {
  const right = clampToGoalAwareBounds({ x: 1.20, y: 0.50 });
  assertEquals(right.goalBehind, true);
  assert(right.x === 1 + GOAL_MAX_DEPTH, `x 应被夹取到深度上限，实际 ${right.x}`);
  const left = clampToGoalAwareBounds({ x: -0.20, y: 0.50 });
  assertEquals(left.goalBehind, true);
  assert(left.x === -GOAL_MAX_DEPTH, `左侧应对称夹取，实际 ${left.x}`);
  // 门框外越线 → 普通边界（不进后区）
  assertEquals(clampToGoalAwareBounds({ x: 1.20, y: 0.10 }).goalBehind, false);
  assert(clampToGoalAwareBounds({ x: 1.20, y: 0.10 }).x === 1);
  // 场内普通落点 → 不变
  const inside = clampToGoalAwareBounds({ x: 0.42, y: 0.77 });
  assertEquals(inside.goalBehind, false);
  assertEquals(inside, { x: 0.42, y: 0.77, goalBehind: false });
});

test('GLR-03. resolveCrossingBallState：以穿越时状态为准，GOAL/CONTROLLED 结算态不作几何证据', () => {
  assertEquals(resolveCrossingBallState(BS.IN_TRANSIT, 'GOAL'), BS.IN_TRANSIT);
  assertEquals(resolveCrossingBallState(BS.FREE, 'GOAL'), BS.FREE);
  assertEquals(resolveCrossingBallState('GOAL', BS.IN_TRANSIT), BS.IN_TRANSIT); // 起始不合规时退回合规结束态
  assertEquals(resolveCrossingBallState('GOAL', 'GOAL'), 'GOAL');               // 无合规态 → 原样返回（将被 C-15 拒绝）
});

// ===========================================================================
// 边界：门区通道 / 普通边界不变 / 深度上限 / 上下边界
// ===========================================================================

test('GLR-04. resolveBallBoundary：默认（未开门区）普通边界行为不变（反射 x=1）', () => {
  const out = resolveBallBoundary({ x: 1.2, y: 0.5 }, { x: 0.3, y: 0 }, CFG);
  assertEquals(out.boundary.result, 'BOUNDARY_CONTACT');
  assert(out.position.x === 1, '门区通道未开启时必须夹取到 x=1');
  assert(out.velocity.x <= 0, '应反射为负');
});

test('GLR-05. resolveBallBoundary：门区通道开启时门嘴内可达门后（有界），门框外仍反射', () => {
  const inMouthOut = resolveBallBoundary({ x: 1.2, y: 0.5 }, { x: 0.3, y: 0 }, CFG, { goalChannel: true });
  assertEquals(inMouthOut.boundary.result, 'BOUNDARY_CONTACT');
  assert(inMouthOut.position.x <= 1 + GOAL_MAX_DEPTH + EPS, '不得超过门后深度上限');
  assert(inMouthOut.position.x > 1, '应进入门后区域');
  const outMouth = resolveBallBoundary({ x: 1.2, y: 0.1 }, { x: 0.3, y: 0 }, CFG, { goalChannel: true });
  assert(outMouth.position.x === 1, '门框外不得进入门后区域');
  assert(outMouth.velocity.x <= 0);
  // 左侧对称
  const left = resolveBallBoundary({ x: -0.2, y: 0.5 }, { x: -0.3, y: 0 }, CFG, { goalChannel: true });
  assert(left.position.x >= -GOAL_MAX_DEPTH - EPS && left.position.x < 0);
});

test('GLR-06. resolveBallBoundary：上下普通边界行为不因门区改造而改变', () => {
  const top = resolveBallBoundary({ x: 0.5, y: 1.2 }, { x: 0, y: 0.3 }, CFG, { goalChannel: true });
  assert(top.position.y === 1 && top.velocity.y <= 0, 'y=1 仍反射');
  const bottom = resolveBallBoundary({ x: 0.5, y: -0.2 }, { x: 0, y: -0.3 }, CFG, { goalChannel: true });
  assert(bottom.position.y === 0 && bottom.velocity.y >= 0, 'y=0 仍反射');
});

test('GLR-07. stepBallPhysics：IN_TRANSIT 门区飞行可达门后且深度有界（速度归零停止）', () => {
  const ball = { position: { x: 0.99, y: 0.5 }, velocity: { x: 0.5, y: 0 }, state: BS.IN_TRANSIT, control: null, possessingTeamId: null, contacting: [] };
  const res = stepBallPhysics(ball, 1, { players: [] });
  assert(res.ball.position.x > 1, '应越过门线');
  assert(res.ball.position.x <= 1 + GOAL_MAX_DEPTH + EPS, '不得超过门后深度上限');
  assert(res.ball.velocity.x === 0, '达到深度上限应安全停止，不无限延伸');
});

test('GLR-08. stepBallPhysics：FREE 球仍遵守普通边界（门区通道仅对球门方向飞行开放）', () => {
  for (const y of [0.5, 0.1]) {
    const ball = { position: { x: 0.99, y }, velocity: { x: 0.5, y: 0 }, state: BS.FREE, control: null, possessingTeamId: null, contacting: [] };
    const res = stepBallPhysics(ball, 1, { players: [] });
    assert(res.ball.position.x <= 1 + EPS, `FREE 球不得越界（y=${y}），实际 ${res.ball.position.x}`);
    assert(res.ball.velocity.x <= 0, '应反射');
  }
});

// ===========================================================================
// 端到端：真实球路 → 门线 → C-14 比分
// ===========================================================================

test('GLR-09. 右侧合法进球球路（Home SHOT）端到端：可达门线、C-23 精确写入、唯一计分', () => {
  const core = homeShotCore();
  const found = findGoalTransit(shotInst('h_fw'), core, (r) => r.outcome === 'GOAL' && r.transit.to.x > 1 && inMouth(r.transit.to.y));
  assert(found, '应存在合法右侧进球球路');
  const { result } = found;
  const chain = runTransitChain(core, result, applyShotStateUpdate, advanceShotTransit, { dt: Math.max(1e-6, result.transit.duration / 4) });

  // Tick N 安装 Transit 时不提前移动球
  assertEquals(chain.installPos, result.transit.from, '安装 Transit 不得移动球');
  assert(chain.ticks >= 1, 'Tick N+1 起才推进球路');
  // 门线判定来自真实 Segment（唯一权威 C-15），且仅计分一次（同一物理事件）
  assertEquals(chain.scored, 1, '同一物理事件不得重复计分');
  assertEquals(chain.crossings[0].goalSide, 'RIGHT');
  assertEquals(chain.finalCore.score, { home: 1, away: 0 });
  // C-23 完成时精确写入 transit.to；SHOT GOAL 结算态
  assertEquals(chain.finalCore.ball.position, result.transit.to, 'C-23 应精确写入 transit.to');
  assertEquals(chain.finalCore.ball.state, 'GOAL');
});

test('GLR-10. 左侧合法进球球路（Away SHOT）端到端：左右对称', () => {
  const core = awayShotCore();
  const found = findGoalTransit(shotInst('a_fw'), core, (r) => r.outcome === 'GOAL' && r.transit.to.x < 0 && inMouth(r.transit.to.y));
  assert(found, '应存在合法左侧进球球路');
  const { result } = found;
  const chain = runTransitChain(core, result, applyShotStateUpdate, advanceShotTransit, { dt: Math.max(1e-6, result.transit.duration / 4) });
  assertEquals(chain.scored, 1);
  assertEquals(chain.crossings[0].goalSide, 'LEFT');
  assertEquals(chain.finalCore.score, { home: 0, away: 1 });
  assertEquals(chain.finalCore.ball.position, result.transit.to);
});

test('GLR-11. PASS 球路可达门区并合法进球（真实 PASS → Transit → 门线 → C-14）', () => {
  const core = passToLineCore();
  const found = findGoalTransit(passInst('h_a', 'h_t'), core, (r) => r.transit.to.x > 1 && inMouth(r.transit.to.y));
  assert(found, '应存在合法 PASS 门区球路');
  const { result } = found;
  const chain = runTransitChain(core, result, applyPassStateUpdate, advancePassTransit, { dt: Math.max(1e-6, result.transit.duration / 4) });
  assertEquals(chain.installPos, result.transit.from, '安装 Transit 不得移动球');
  assertEquals(chain.scored, 1);
  assertEquals(chain.finalCore.score, { home: 1, away: 0 });
  assertEquals(chain.finalCore.ball.position, result.transit.to);
});

test('GLR-12. 门框外球路不得进球（真实 C-16 Segment，y 在门嘴外）', () => {
  const mkCore = (x, y) => coreOf([mk('h_a', H, 'MF', x, y)], 'h_a', H, BS.IN_TRANSIT);
  const seg = deriveBallTickSegment(mkCore(0.9, 0.10), mkCore(1.06, 0.10));
  const { goal, matchCore } = resolveGoalFromSegment(mkCore(1.06, 0.10), seg, { phase: 'FIRST_HALF' });
  assertEquals(goal.status, GOAL_AWARE_STATUS.NO_GOAL);
  assertEquals(goal.reason, GOAL_AWARE_REASON.NO_CROSSING);
  assertEquals(matchCore.score, { home: 0, away: 0 });
});

test('GLR-13. SHOT 完成后的 GOAL 状态不会单独触发进球（GOAL/CONTROLLED 非几何证据）', () => {
  const geometry = deriveGoalGeometry(coreOf([mk('h_a', H, 'MF', 0.5, 0.5)], 'h_a', H));
  const crossing = detectGoalLineCrossing({ x: 0.9, y: 0.5 }, { x: 1.06, y: 0.5 }, geometry);
  assertEquals(crossing.crossed, true);
  const withGoal = createGoalCandidateFromCrossing(crossing, {}, { ballState: 'GOAL' });
  assertEquals(withGoal.ok, false, 'GOAL 结算态不得作为几何证据');
  const withControlled = createGoalCandidateFromCrossing(crossing, {}, { ballState: BS.CONTROLLED });
  assertEquals(withControlled.ok, false, 'CONTROLLED 不得作为几何证据');
  const withTransit = createGoalCandidateFromCrossing(crossing, {}, { ballState: BS.IN_TRANSIT });
  assertEquals(withTransit.ok, true);
});

test('GLR-14. 终态比赛（REGULATION_COMPLETE）不能继续得分', () => {
  const core = homeShotCore();
  const found = findGoalTransit(shotInst('h_fw'), core, (r) => r.outcome === 'GOAL' && r.transit.to.x > 1 && inMouth(r.transit.to.y));
  assert(found);
  const { result } = found;
  const chain = runTransitChain(core, result, applyShotStateUpdate, advanceShotTransit, { dt: Math.max(1e-6, result.transit.duration / 4), phase: 'REGULATION_COMPLETE' });
  assertEquals(chain.scored, 0, '终态不得进球');
  assertEquals(chain.finalCore.score, { home: 0, away: 0 });
});

test('GLR-15. 确定性：相同初始状态与输入 → 相同结果', () => {
  const core = homeShotCore();
  const seed = findGoalTransit(shotInst('h_fw'), core, (r) => r.outcome === 'GOAL' && r.transit.to.x > 1 && inMouth(r.transit.to.y)).seed;
  const run = () => {
    const r = resolveShot(shotInst('h_fw'), core, { seed });
    const chain = runTransitChain(core, r, applyShotStateUpdate, advanceShotTransit, { dt: Math.max(1e-6, r.transit.duration / 4) });
    return JSON.stringify({ scored: chain.scored, score: chain.finalCore.score, pos: chain.finalCore.ball.position, state: chain.finalCore.ball.state, ticks: chain.ticks });
  };
  assertEquals(run(), run());
});

test('GLR-16. 安装后球已在门后时不再重复计分（结算 Tick 后无第二次穿越）', () => {
  const core = homeShotCore();
  const found = findGoalTransit(shotInst('h_fw'), core, (r) => r.outcome === 'GOAL' && r.transit.to.x > 1 && inMouth(r.transit.to.y));
  const { result } = found;
  const chain = runTransitChain(core, result, applyShotStateUpdate, advanceShotTransit, { dt: Math.max(1e-6, result.transit.duration / 4) });
  // 结算后继续推进若干 Tick，比分不得再变
  let cur = chain.finalCore;
  for (let i = 0; i < 5; i += 1) cur = advanceShotTransit(cur, 0.25);
  assertEquals(cur.score, { home: 1, away: 0 }, '终态后不得再计分');
  assertEquals(cur.ball.position, result.transit.to);
  assertEquals(cur.ball.state, 'GOAL');
});