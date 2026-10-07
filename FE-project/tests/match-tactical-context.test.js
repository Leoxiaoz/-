/**
 * Step 39F-M-C —— Tactical Context 测试（类别 A）。
 * 覆盖：phase / possession transition / ball zone / ball channel / block height /
 * build-up phase / shape validity / 只读性 / 确定性。
 * 红线：不写 MatchCore；不使用 RNG；不接生产流程。
 */

import { test, assert, assertEquals } from './harness.js';
import {
  buildTacticalContext, ballZoneOf, ballChannelOf, ownProgress,
  deriveBlockHeight, attackDirection, opponentTeamId,
} from '../src/core/match/tactical-context.js';
import {
  TACTICAL_PHASE, POSSESSION_TENURE, BALL_ZONE, BALL_CHANNEL, BLOCK_HEIGHT, BUILD_UP_PHASE, TRANSITION,
} from '../src/core/match/movement-config.js';
import { H, A, mkCore } from './movement-fixtures.js';

test('TacticalContext：己方控球 → IN_POSSESSION / SETTLED', () => {
  const c = mkCore({ clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' } });
  const ctxH = buildTacticalContext(c, H);
  const ctxA = buildTacticalContext(c, A);
  assertEquals(ctxH.phase, TACTICAL_PHASE.IN_POSSESSION);
  assertEquals(ctxH.possessionTenure, POSSESSION_TENURE.SETTLED);
  assertEquals(ctxA.phase, TACTICAL_PHASE.OUT_OF_POSSESSION);
});

test('TacticalContext：刚刚赢得球权 → TRANSITION / JUST_WON（对手视角 JUST_LOST）', () => {
  const c = mkCore({
    movement: { possession: { teamId: H, sinceTime: 9 } },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
  });
  const ctxH = buildTacticalContext(c, H);
  const ctxA = buildTacticalContext(c, A);
  assertEquals(ctxH.phase, TACTICAL_PHASE.TRANSITION);
  assertEquals(ctxH.possessionTenure, POSSESSION_TENURE.JUST_WON);
  assertEquals(ctxA.possessionTenure, POSSESSION_TENURE.JUST_LOST);
});

test('TacticalContext：Transition 非永久 —— 超出窗口回到 IN_POSSESSION', () => {
  const c = mkCore({
    movement: { possession: { teamId: H, sinceTime: 10 - TRANSITION.WINDOW - 0.5 } },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
  });
  assertEquals(buildTacticalContext(c, H).phase, TACTICAL_PHASE.IN_POSSESSION);
});

test('TacticalContext：球在飞行 / 松球 → TRANSITION', () => {
  const inFlight = mkCore({ extra: { ball: { position: { x: 0.5, y: 0.5 }, control: null, possessingTeamId: null, transit: { from: { x: 0.4, y: 0.5 }, to: { x: 0.6, y: 0.5 } } } } });
  assertEquals(buildTacticalContext(inFlight, H).phase, TACTICAL_PHASE.TRANSITION);
  const loose = mkCore({ possessingTeamId: null, ballControl: null });
  assertEquals(buildTacticalContext(loose, H).phase, TACTICAL_PHASE.TRANSITION);
});

test('TacticalContext：ball zone 为「己方视角」', () => {
  const c = mkCore({ ballPos: { x: 0.2, y: 0.5 } });
  assertEquals(buildTacticalContext(c, H).ballZone, BALL_ZONE.DEFENSIVE_THIRD); // H 己方球门在 x=0
  assertEquals(buildTacticalContext(c, A).ballZone, BALL_ZONE.FINAL_THIRD);     // A 己方球门在 x=1
  assertEquals(ballZoneOf(0.5), BALL_ZONE.MIDDLE_THIRD);
  assertEquals(ballZoneOf(0.9), BALL_ZONE.FINAL_THIRD);
});

test('TacticalContext：ball channel 分档', () => {
  assertEquals(ballChannelOf(0.1), BALL_CHANNEL.LEFT);
  assertEquals(ballChannelOf(0.3), BALL_CHANNEL.LEFT_HALF_SPACE);
  assertEquals(ballChannelOf(0.5), BALL_CHANNEL.CENTRAL);
  assertEquals(ballChannelOf(0.7), BALL_CHANNEL.RIGHT_HALF_SPACE);
  assertEquals(ballChannelOf(0.9), BALL_CHANNEL.RIGHT);
});

test('TacticalContext：build-up phase 分档', () => {
  assertEquals(buildTacticalContext(mkCore({ ballPos: { x: 0.2, y: 0.5 } }), H).buildUpPhase, BUILD_UP_PHASE.BUILD_UP);
  assertEquals(buildTacticalContext(mkCore({ ballPos: { x: 0.5, y: 0.5 } }), H).buildUpPhase, BUILD_UP_PHASE.PROGRESSION);
  assertEquals(buildTacticalContext(mkCore({ ballPos: { x: 0.85, y: 0.5 } }), H).buildUpPhase, BUILD_UP_PHASE.FINAL_THIRD);
});

test('TacticalContext：block height 由 defensiveLine + 球区派生', () => {
  const deep = mkCore({ possessingTeamId: A, ballControl: 'a_mf1', ballPos: { x: 0.2, y: 0.5 }, tacticalState: { [H]: { defensiveLine: 'deep' } } });
  assertEquals(buildTacticalContext(deep, H).blockHeight, BLOCK_HEIGHT.LOW_BLOCK);
  const high = mkCore({ tacticalState: { [H]: { defensiveLine: 'high' } } });
  assertEquals(buildTacticalContext(high, H).blockHeight, BLOCK_HEIGHT.HIGH_BLOCK);
  assertEquals(deriveBlockHeight({ defensiveLine: 'medium', phase: TACTICAL_PHASE.IN_POSSESSION, ballZone: BALL_ZONE.MIDDLE_THIRD }), BLOCK_HEIGHT.MID_BLOCK);
});

test('TacticalContext：ownProgress / 方向 / 对手 解析正确', () => {
  const c = mkCore();
  assertEquals(attackDirection(c, H), 1);
  assertEquals(attackDirection(c, A), -1);
  assertEquals(opponentTeamId(c, H), A);
  assertEquals(ownProgress(c, H, 0.2), 0.2);
  assertEquals(ownProgress(c, A, 0.2), 0.8);
});

test('TacticalContext：只读 —— 不修改 MatchCore，不复制原始事实到 context 顶层', () => {
  const c = mkCore();
  const before = JSON.stringify(c);
  const ctx = buildTacticalContext(c, H);
  assertEquals(JSON.stringify(c), before, 'MatchCore 不应被修改');
  assert(!('players' in ctx) && !('ball' in ctx), 'context 不应复制 MatchCore 原始事实');
});

test('TacticalContext：shape validity 随 anchors 偏离下降', () => {
  const c = mkCore();
  const exact = {};
  for (const p of c.players) if (p.teamId === H) exact[p.playerId] = { ...p.positionOnPitch };
  const v1 = buildTacticalContext(c, H, { shapeAnchors: exact }).shapeValidity;
  const far = {};
  for (const id of Object.keys(exact)) far[id] = { x: 0.99, y: 0.01 };
  const v2 = buildTacticalContext(c, H, { shapeAnchors: far }).shapeValidity;
  assert(v1 > v2, `validity 应下降：${v1} vs ${v2}`);
  assert(v2 >= 0 && v1 <= 1);
});

test('TacticalContext：确定性输出', () => {
  const c = mkCore({ movement: { possession: { teamId: H, sinceTime: 9 } } });
  assertEquals(buildTacticalContext(c, H), buildTacticalContext(c, H));
});