/**
 * Step 39F-M-C —— Movement Intent / Target / Locomotion / Determinism 测试（类别 C/D/E/F + 行为方向性 §20）。
 * 红线：不接生产流程；不调用 Decision / PASS / SHOT；不使用 Math.random。
 */

import { test, assert, assertEquals } from './harness.js';
import { buildTacticalContext } from '../src/core/match/tactical-context.js';
import { getTacticalState } from '../src/core/match/tactical-state.js';
import { buildTeamShape } from '../src/core/match/team-shape.js';
import { selectMovementIntent } from '../src/core/match/movement-intent.js';
import { resolveMovementTarget } from '../src/core/match/movement-target.js';
import { computeMovementSpeed, stepLocomotion } from '../src/core/match/locomotion.js';
import { updateMovement, initMovementState, movementLevelFor } from '../src/core/match/movement-update.js';
import {
  MOVEMENT_INTENT as MI, TARGET_KIND, LOCOMOTION, MOVEMENT_LEVEL, POSSESSION_TENURE,
} from '../src/core/match/movement-config.js';
import { H, A, mkCore } from './movement-fixtures.js';

function playerOf(core, id) { return core.players.find((p) => p.playerId === id); }

function evalFor(core, id) {
  const player = playerOf(core, id);
  const tacticalState = getTacticalState(core, player.teamId);
  const ctx0 = buildTacticalContext(core, player.teamId);
  const shape = buildTeamShape(core, player.teamId, ctx0, tacticalState);
  const context = buildTacticalContext(core, player.teamId, { shapeAnchors: shape.anchors });
  const sel = selectMovementIntent({ matchCore: core, player, context, tacticalState });
  const target = resolveMovementTarget({ intent: sel.intent, player, shape, context, tacticalState, matchCore: core });
  return { player, tacticalState, context, shape, sel, target };
}

// ============================ C. Movement Intent ============================

test('Intent：球权球员 → HOLD_POSITION 且 isCarrier=true', () => {
  const c = mkCore({ ballControl: 'h_mf1' });
  assertEquals(evalFor(c, 'h_mf1').sel.intent, MI.HOLD_POSITION);
  assert(evalFor(c, 'h_mf1').sel.isCarrier === true);
});

test('Intent：直接长传反击（有球）→ 前锋 RUN_BEHIND', () => {
  const c = mkCore({ ballPos: { x: 0.3, y: 0.5 }, tacticalState: { [H]: { possessionStyle: 'direct', transitionStyle: 'counter' } } });
  assertEquals(evalFor(c, 'h_fw1').sel.intent, MI.RUN_BEHIND);
});

test('Intent：有球中场 → SUPPORT（保持结构）', () => {
  const c = mkCore({ ballPos: { x: 0.5, y: 0.5 } });
  assertEquals(evalFor(c, 'h_mf2').sel.intent, MI.SUPPORT);
});

test('Intent：高位压迫 + 球在附近 → PRESS_MOVE / CHASE', () => {
  const c = mkCore({ possessingTeamId: A, ballControl: 'a_mf1', ballPos: { x: 0.45, y: 0.40 }, tacticalState: { [H]: { pressingIntensity: 'high' } } });
  const it = evalFor(c, 'h_mf2').sel.intent;
  assert(it === MI.PRESS_MOVE || it === MI.CHASE, `期望压迫，实际 ${it}`);
});

test('Intent：低位防守 → 后卫 RECOVER_SHAPE', () => {
  const c = mkCore({ possessingTeamId: A, ballControl: 'a_fw1', ballPos: { x: 0.15, y: 0.5 }, tacticalState: { [H]: { defensiveLine: 'deep' } } });
  assertEquals(evalFor(c, 'h_df2').sel.intent, MI.RECOVER_SHAPE);
});

test('Intent：无效 / 缺失输入不抛错并返回合法 intent', () => {
  const bad = { ball: {}, players: [], teams: { home: H, away: A }, clock: {}, tactical: {} };
  const sel = selectMovementIntent({ matchCore: bad, player: { playerId: 'x', teamId: H, position: 'MF' }, context: { opponentTeamId: A, phase: 'IN_POSSESSION' }, tacticalState: getTacticalState(bad, H) });
  assert(typeof sel.intent === 'string' && Object.values(MI).includes(sel.intent));
});

test('Intent：确定性输出', () => {
  const c = mkCore({ ballPos: { x: 0.3, y: 0.4 } });
  assertEquals(evalFor(c, 'h_fw1').sel, evalFor(c, 'h_fw1').sel);
});

// ============================ D. Movement Target ============================

test('Target：HOLD_POSITION → ANCHOR（等于 shape 锚点）', () => {
  const e = evalFor(mkCore({ ballControl: 'h_mf1' }), 'h_mf1');
  assertEquals(e.target.kind, TARGET_KIND.ANCHOR);
  assertEquals(e.target.x, e.shape.anchors['h_mf1'].x);
  assertEquals(e.target.y, e.shape.anchors['h_mf1'].y);
});

test('Target：RUN_FORWARD → SPACE 且向前', () => {
  const e = evalFor(mkCore({ ballPos: { x: 0.3, y: 0.5 }, tacticalState: { [H]: { possessionStyle: 'balanced' } } }), 'h_fw1');
  assertEquals(e.target.kind, TARGET_KIND.SPACE);
  assert(e.target.x > e.shape.anchors['h_fw1'].x, `应向前：${e.target.x} vs ${e.shape.anchors['h_fw1'].x}`);
});

test('Target：SUPPORT → BALL_RELATIVE', () => {
  const e = evalFor(mkCore({ ballPos: { x: 0.5, y: 0.5 } }), 'h_mf2');
  assertEquals(e.target.kind, TARGET_KIND.BALL_RELATIVE);
});

test('Target：MARK → OPPONENT_RELATIVE', () => {
  const c = mkCore({ possessingTeamId: A, ballControl: 'a_mf1', ballPos: { x: 0.6, y: 0.6 } });
  const e = evalFor(c, 'h_fw1');
  // 若为盯人语义则应为对手相对
  if (e.sel.intent === MI.MARK) assertEquals(e.target.kind, TARGET_KIND.OPPONENT_RELATIVE);
  else assert([MI.COVER, MI.PRESS_MOVE, MI.CHASE].includes(e.sel.intent));
});

test('Target：PRESS_MOVE / CHASE → 指向球位', () => {
  const c = mkCore({ possessingTeamId: A, ballControl: 'a_mf1', ballPos: { x: 0.45, y: 0.40 }, tacticalState: { [H]: { pressingIntensity: 'high' } } });
  const e = evalFor(c, 'h_mf2');
  if (e.sel.intent === MI.PRESS_MOVE || e.sel.intent === MI.CHASE) {
    assertEquals(e.target.kind, TARGET_KIND.OPPONENT_RELATIVE);
    assert(Math.abs(e.target.x - 0.45) < 1e-9 && Math.abs(e.target.y - 0.40) < 1e-9);
  }
});

test('Target：全部 target 有界且有限', () => {
  const c = mkCore({ ballPos: { x: 0.02, y: 0.98 } });
  for (const p of c.players) {
    const e = evalFor(c, p.playerId);
    assert(Number.isFinite(e.target.x) && Number.isFinite(e.target.y), 'target 应有限');
    assert(e.target.x >= 0 && e.target.x <= 1 && e.target.y >= 0 && e.target.y <= 1, 'target 应越界');

  }
});

// ============================ E. Locomotion ============================

test('Locomotion：朝目标前进并缩短距离', () => {
  const r = stepLocomotion({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, 0.05, 1);
  assert(Math.abs(r.moved - 0.05) < 1e-9, `moved=${r.moved}`);
  assertEquals(r.position, { x: 0.25, y: 0.5 });
  assert(r.arrived === false);
});

test('Locomotion：到达目标时吸附并标记 arrived', () => {
  const r = stepLocomotion({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.5 }, 0.05, 1);
  assert(r.arrived === true);
  assertEquals(r.position, { x: 0.505, y: 0.5 });
});

test('Locomotion：dt=0 / 负 dt 不移动', () => {
  assertEquals(stepLocomotion({ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, 0.05, 0).moved, 0);
  assertEquals(stepLocomotion({ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, 0.05, -1).moved, 0);
});

test('Locomotion：零距离 → arrived，moved=0', () => {
  const r = stepLocomotion({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 0.05, 1);
  assert(r.arrived === true && r.moved === 0);
});

test('Locomotion：极端速度一次到达且不越界', () => {
  const r = stepLocomotion({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, 1e6, 10);
  assert(r.arrived === true);
  assertEquals(r.position, { x: 0.9, y: 0.5 });
});

test('Locomotion：NaN / Infinity 保护', () => {
  const a = stepLocomotion({ x: NaN, y: Infinity }, { x: 0.8, y: 0.5 }, 0.05, 1);
  assert(Number.isFinite(a.position.x) && Number.isFinite(a.position.y));
  const b = stepLocomotion({ x: 0.5, y: 0.5 }, { x: NaN, y: NaN }, NaN, NaN);
  assert(Number.isFinite(b.position.x) && Number.isFinite(b.position.y));
  assert(b.moved === 0);
});

test('Locomotion：computeMovementSpeed bounded，且 pace 影响有限', () => {
  const fast = computeMovementSpeed({ player: { attributes: { pace: 99 }, fitness: 100, positionOnPitch: { x: 0.5, y: 0.5 } }, intent: MI.RUN_BEHIND, matchCore: mkCore() });
  const slow = computeMovementSpeed({ player: { attributes: { pace: 1 }, fitness: 100, positionOnPitch: { x: 0.5, y: 0.5 } }, intent: MI.HOLD_POSITION, matchCore: mkCore() });
  for (const v of [fast, slow]) { assert(v >= LOCOMOTION.MIN_SPEED && v <= LOCOMOTION.MAX_SPEED, `speed 越界 ${v}`); }
  assert(fast > slow);
});

// ============================ F. Determinism ============================

test('Update：同一输入两次结果一致', () => {
  const c = mkCore();
  const r1 = updateMovement(c, 0.5);
  const r2 = updateMovement(c, 0.5);
  assertEquals(JSON.stringify(r1.players), JSON.stringify(r2.players));
  assertEquals(JSON.stringify(r1.movement), JSON.stringify(r2.movement));
});

test('Update：不修改输入 MatchCore（纯函数）', () => {
  const c = mkCore();
  const before = JSON.stringify(c);
  updateMovement(c, 0.5);
  assertEquals(JSON.stringify(c), before);
});

test('Update：连续多 tick 后位置仍有限且始终在 [0,1]', () => {
  let c = initMovementState(mkCore());
  for (let i = 0; i < 200; i += 1) c = updateMovement(c, 0.25);
  for (const p of c.players) {
    assert(Number.isFinite(p.positionOnPitch.x) && Number.isFinite(p.positionOnPitch.y));
    assert(p.positionOnPitch.x >= 0 && p.positionOnPitch.x <= 1 && p.positionOnPitch.y >= 0 && p.positionOnPitch.y <= 1);
  }
});

test('Update：确实产生球员位移（Movement 改变真实位置）', () => {
  const before = mkCore();
  let c = initMovementState(before);
  for (let i = 0; i < 20; i += 1) c = updateMovement(c, 0.5);
  let moved = 0;
  for (const p of c.players) {
    const o = before.players.find((q) => q.playerId === p.playerId);
    if (Math.hypot(p.positionOnPitch.x - o.positionOnPitch.x, p.positionOnPitch.y - o.positionOnPitch.y) > 0.005) moved += 1;
  }
  assert(moved > 0, '至少应有球员移动');
});

test('Update：MovementState 记录 intent / target / status', () => {
  const c = updateMovement(mkCore(), 0.5);
  assert(c.movement && c.movement.players['h_mf2']);
  const st = c.movement.players['h_mf2'];
  assert(typeof st.intent === 'string' && st.target && typeof st.status === 'string');
});

test('Update：层级判定 L0 / L1 / L2 存在', () => {
  assertEquals(movementLevelFor({ needsReeval: false }), MOVEMENT_LEVEL.L0);
  assertEquals(movementLevelFor({ needsReeval: true, possessionChanged: false, isCarrier: false }), MOVEMENT_LEVEL.L1);
  assertEquals(movementLevelFor({ needsReeval: true, possessionChanged: true, nearBall: true }), MOVEMENT_LEVEL.L2);
  assertEquals(movementLevelFor({ needsReeval: true, isCarrier: true }), MOVEMENT_LEVEL.L2);
});

// ==================== 行为方向性（§20，不做百分比断言） ====================

test('行为：高位压迫 vs 低位防守 —— Intent 分布显著不同', () => {
  const pressCore = mkCore({ possessingTeamId: A, ballControl: 'a_mf1', ballPos: { x: 0.5, y: 0.5 }, tacticalState: { [H]: { pressingIntensity: 'high', defensiveLine: 'high' } } });
  const lowCore = mkCore({ possessingTeamId: A, ballControl: 'a_mf1', ballPos: { x: 0.15, y: 0.5 }, tacticalState: { [H]: { pressingIntensity: 'low', defensiveLine: 'deep' } } });
  const pressIntents = collectIntents(pressCore);
  const lowIntents = collectIntents(lowCore);
  const pressCount = pressIntents.filter((i) => i === MI.PRESS_MOVE || i === MI.CHASE || i === MI.STEP_UP).length;
  const lowRecover = lowIntents.filter((i) => i === MI.RECOVER_SHAPE || i === MI.DROP).length;
  assert(pressCount > 0, '高压应产生压迫 / 上步意图');
  assert(lowRecover > 0, '低位应产生回撤 / 恢复结构意图');
});

test('行为：宽度 wide vs narrow 改变横向分布', () => {
  const wide = buildTeamShape(mkCore(), H, buildTacticalContext(mkCore({ tacticalState: { [H]: { width: 'wide' } } }), H), getTacticalState(mkCore({ tacticalState: { [H]: { width: 'wide' } } }), H));
  const narrow = buildTeamShape(mkCore(), H, buildTacticalContext(mkCore({ tacticalState: { [H]: { width: 'narrow' } } }), H), getTacticalState(mkCore({ tacticalState: { [H]: { width: 'narrow' } } }), H));
  assert(wide.width > narrow.width);
});

test('行为：counter 转换 JUST_WON → 前锋前插 / 纵深', () => {
  const c = mkCore({
    movement: { possession: { teamId: H, sinceTime: 9 } },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    tacticalState: { [H]: { transitionStyle: 'counter', possessionStyle: 'direct' } },
  });
  const e = evalFor(c, 'h_fw1');
  assertEquals(e.context.possessionTenure, POSSESSION_TENURE.JUST_WON);
  assert([MI.RUN_BEHIND, MI.RUN_FORWARD].includes(e.sel.intent), `期望前插，实际 ${e.sel.intent}`);
});

function collectIntents(core) {
  const out = [];
  for (const p of core.players) {
    if (p.teamId !== H) continue;
    out.push(evalFor(core, p.playerId).sel.intent);
  }
  return out;
}