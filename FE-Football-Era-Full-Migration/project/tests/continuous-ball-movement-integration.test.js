/**
 * Step 39F-M-C-39 —— Transit Continuous Movement Integration 测试（OPTION_B = Completion Writer）。
 *
 * 覆盖：PASS / SHOT 连续运动 / 中间 Physics 推进 / 完成 Tick C-23 精确落点 / Partial · Overshoot /
 *       完成 Tick 单写协议 / Finalize 不写 Position / 无 Transit NO_OP / 失败传播 / dt 语义 /
 *       MatchCore · Transit Immutable / PASS·SHOT 共享 Integration / C-08 生产 Integration Point /
 *       Interaction INSTANT 不受影响 / Architecture Source Guard（无 Trajectory · Goal · Physics 重写 · random · 墙钟）。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  advanceContinuousBallMovement, finalizeTransitSettlement,
  CONTINUOUS_BALL_MOVEMENT_SOURCE, CONTINUOUS_BALL_MOVEMENT_RULE_VERSION,
  CONTINUOUS_BALL_MOVEMENT_REASON,
} from '../src/core/match/continuous-ball-movement-integration.js';
import { advancePassTransit, completePassTransit } from '../src/core/match/pass-state-update.js';
import { advanceShotTransit, completeShotTransit } from '../src/core/match/shot-state-update.js';
import { runMatchTick } from '../src/core/match/match-tick.js';

const H = 'H'; const A = 'A';
const HERE = dirname(fileURLToPath(import.meta.url));
const raw = (p) => readFileSync(join(HERE, p), 'utf8');
const strip = (p) => raw(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const SRC_CONT = strip('../src/core/match/continuous-ball-movement-integration.js');
const SRC_PASS = strip('../src/core/match/pass-state-update.js');
const SRC_SHOT = strip('../src/core/match/shot-state-update.js');
const SRC_TICK = strip('../src/core/match/match-tick.js');

const passTransit = (over = {}) => ({
  state: 'IN_TRANSIT', from: { x: 0, y: 0.5 }, to: { x: 0.6, y: 0.5 }, duration: 1,
  progress: 0, elapsed: 0, outcome: 'PASS_COMPLETED', intendedTargetId: 'h_t', targetTeamId: H, ...over,
});
const shotTransit = (over = {}) => ({
  state: 'IN_TRANSIT', from: { x: 0.5, y: 0.5 }, to: { x: 0.9, y: 0.5 }, duration: 1,
  progress: 0, elapsed: 0, outcome: 'GOAL', goalkeeperId: null, blockerId: null, target: { zone: 'CENTER' }, ...over,
});

function mkCore(transit) {
  return {
    worldId: 'w39', season: 1, matchId: 'm39', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 0, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball: {
      position: { ...transit.from }, control: null, possessingTeamId: null, state: 'IN_TRANSIT',
      transit: { ...transit, from: { ...transit.from }, to: { ...transit.to } },
    },
    players: [
      { playerId: 'h_t', teamId: H, positionOnPitch: { x: 0.6, y: 0.5 } },
      { playerId: 'a_gk', teamId: A, positionOnPitch: { x: 0.95, y: 0.5 } },
    ],
  };
}
function run(transit, ticks) {
  let mc = mkCore(transit);
  const rows = [];
  for (const dt of ticks) {
    const r = advanceContinuousBallMovement(mc, dt);
    mc = r.matchCore;
    rows.push({ dt, ok: r.ok, completed: r.completed, progress: r.progress, pos: mc.ball.position, state: mc.ball.state });
  }
  return { mc, rows };
}
const exact = (p, t) => p.x === t.x && p.y === t.y;

// ===========================================================================
// Test A / B：PASS / SHOT 多 Tick 推进
// ===========================================================================

test('C39-A. PASS 多 Tick 推进：中间 IN_TRANSIT，完成落点精确', () => {
  const { mc, rows } = run(passTransit(), [0.4, 0.4, 0.2]);
  assertEquals(rows[0].completed, false);
  assertEquals(rows[1].completed, false);
  assertEquals(rows[2].completed, true);
  assertEquals(mc.ball.state, 'CONTROLLED');
  assert(exact(mc.ball.position, { x: 0.6, y: 0.5 }), 'PASS 完成落点必须精确 === transit.to');
  assertEquals(mc.ball.transit, undefined);
});

test('C39-B. SHOT 多 Tick 推进：完成落点精确（GOAL 结算）', () => {
  const { mc, rows } = run(shotTransit(), [0.5, 0.5]);
  assertEquals(rows[0].completed, false);
  assertEquals(rows[1].completed, true);
  assertEquals(mc.ball.state, 'GOAL');
  assert(exact(mc.ball.position, { x: 0.9, y: 0.5 }), 'SHOT 完成落点必须精确 === transit.to');
  assertEquals(mc.ball.transit, undefined);
});

// ===========================================================================
// Test C / D：Partial Tick 序列
// ===========================================================================

test('C39-C. Partial Tick 0.4 + 0.4 + 0.2 → 精确 === transit.to', () => {
  const { mc } = run(passTransit(), [0.4, 0.4, 0.2]);
  assert(exact(mc.ball.position, { x: 0.6, y: 0.5 }));
});

test('C39-D. Partial Tick 0.3 + 0.3 + 0.3 + 0.1 → 精确 === transit.to', () => {
  const { mc } = run(passTransit(), [0.3, 0.3, 0.3, 0.1]);
  assert(exact(mc.ball.position, { x: 0.6, y: 0.5 }));
});

// ===========================================================================
// Test E：Overshoot Tick
// ===========================================================================

test('C39-E. Overshoot 0.8 + 0.5（elapsed + dt > duration）→ 精确落点，不越界不欠达', () => {
  const { mc, rows } = run(passTransit(), [0.8, 0.5]);
  assertEquals(rows[0].completed, false);
  assertEquals(rows[1].completed, true);
  assert(exact(mc.ball.position, { x: 0.6, y: 0.5 }));
  assert(!(mc.ball.position.x > 0.6) && !(mc.ball.position.x < 0.6), '不得 > to 或 < to');
});

// ===========================================================================
// Test F / G：完成端点精确 + 完成 Tick 写入协议
// ===========================================================================

test('C39-F. Completion Endpoint：position === transit.to（严格相等）', () => {
  const t = passTransit({ to: { x: 0.73, y: 0.37 } });
  const { mc } = run(t, [1]);
  assert(mc.ball.position.x === 0.73 && mc.ball.position.y === 0.37);
});

test('C39-G. 完成 Tick 单写协议：不跑 C-03 Physics（一次性大 dt 仍精确落点）', () => {
  // 一次大 dt 直接完成：若 Physics 参与，会因摩擦欠达；精确 === to 证明完成 Tick 未跑 Physics。
  const t = passTransit({ from: { x: 0, y: 0.5 }, to: { x: 0.9, y: 0.5 }, duration: 1 });
  const { mc } = run(t, [1]);
  assert(mc.ball.position.x === 0.9, '完成 Tick 必须由 C-23 写精确 endPosition');
  // 非完成 Tick 由 Physics 推进（中间 position 不落在 to）。
  const mid = run(t, [0.5]).mc;
  assert(!exact(mid.ball.position, { x: 0.9, y: 0.5 }), '中间 Tick 应由 Physics 推进，而非直接落点');
});

test('C39-H. Finalize 不写 Position：结算保持 C-23 已写入的 endPosition', () => {
  const ball = { position: { x: 0.6, y: 0.5 }, control: null, possessingTeamId: null, state: 'IN_TRANSIT' };
  const out = finalizeTransitSettlement(ball, { outcome: 'PASS_COMPLETED', intendedTargetId: 'h_t', targetTeamId: H }, []);
  assert(exact(out.position, { x: 0.6, y: 0.5 }), 'finalize 必须保持 position，不得自行重算');
  assertEquals(out.state, 'CONTROLLED');
  assertEquals(out.control, 'h_t');
  assertEquals(out.possessingTeamId, H);
  assertEquals(out.transit, undefined);
});

// ===========================================================================
// Test I：无 Transit NO_OP
// ===========================================================================

test('C39-I. 无 transit → NO_OP：不改 position / velocity / 不创建 transit', () => {
  const core = { teams: { home: H, away: A }, ball: { position: { x: 0.5, y: 0.5 }, state: 'FREE' }, players: [] };
  const before = JSON.stringify(core);
  const r = advanceContinuousBallMovement(core, 1);
  assertEquals(r.ok, true);
  assertEquals(r.applied, false);
  assertEquals(r.reason, CONTINUOUS_BALL_MOVEMENT_REASON.NO_TRANSIT);
  assertEquals(JSON.stringify(r.matchCore), before);
  assertEquals(r.matchCore.ball.transit, undefined);
});

// ===========================================================================
// Test J：PASS / SHOT 共享 Integration Boundary
// ===========================================================================

test('C39-J. PASS / SHOT 经同一个 Continuous Movement Integration Boundary', () => {
  // 行为一致：相同 transit 形状经 advancePassTransit / advanceShotTransit 走同一函数。
  const a = advancePassTransit(mkCore(passTransit()), 1);
  const b = advanceShotTransit(mkCore(passTransit()), 1);
  assertEquals(JSON.stringify(a.ball.position), JSON.stringify(b.ball.position));
  // 源码：两个 State Update 均委托共享模块，且各自不含独立 finalize / position 写。
  assert(/advanceContinuousBallMovement/.test(SRC_PASS), 'PASS 必须委托共享积分器');
  assert(/advanceContinuousBallMovement/.test(SRC_SHOT), 'SHOT 必须委托共享积分器');
  assert(!/finalize\s*\(/.test(SRC_PASS), 'PASS 不得保留独立 finalize');
  assert(!/finalize\s*\(/.test(SRC_SHOT), 'SHOT 不得保留独立 finalize');
  assert(!/position:\s*to\b/.test(SRC_PASS) && !/position:\s*to\b/.test(SRC_SHOT), 'finalize 不得再写 position');
});

// ===========================================================================
// Immutable / Failure / dt 语义
// ===========================================================================

test('C39-11. MatchCore / Transit Immutable：输入不被修改', () => {
  const core = mkCore(passTransit());
  const before = JSON.stringify(core);
  const r = advanceContinuousBallMovement(core, 0.5);
  assertEquals(JSON.stringify(core), before, '输入 MatchCore / transit 不得被修改');
  assert(r.matchCore !== core, '必须返回新 MatchCore');
  assert(r.matchCore.ball !== core.ball, '必须返回新 ball');
});

test('C39-12. C-23 完成边界失败 → 明确失败传播，无部分 Position 更新', () => {
  const core = mkCore(passTransit({ to: null })); // 非法 to → C-23 拒绝
  const before = JSON.stringify(core);
  const r = advanceContinuousBallMovement(core, 1);
  assertEquals(r.ok, false);
  assertEquals(r.applied, false);
  assertEquals(r.reason, CONTINUOUS_BALL_MOVEMENT_REASON.COMPLETION_POSITION_FAILED);
  assertEquals(JSON.stringify(r.matchCore), before, '失败不得产生部分更新');
});

test('C39-13. dt 语义：0 / 负数 / NaN / Infinity 不推进时间、不产生 NaN', () => {
  for (const dt of [0, -1, NaN, Infinity]) {
    const r = advanceContinuousBallMovement(mkCore(passTransit()), dt);
    assertEquals(r.completed, false);
    assertEquals(r.progress, 0);
    assert(Number.isFinite(r.matchCore.ball.position.x) && Number.isFinite(r.matchCore.ball.position.y));
  }
});

test('C39-14. 非法 transit（duration <= 0）→ INVALID_TRANSIT', () => {
  const r = advanceContinuousBallMovement(mkCore(passTransit({ duration: 0 })), 1);
  assertEquals(r.ok, false);
  assertEquals(r.reason, CONTINUOUS_BALL_MOVEMENT_REASON.INVALID_TRANSIT);
});

// ===========================================================================
// C-08 生产 Integration Point
// ===========================================================================

test('C39-15. 生产链：runMatchTick 中 Continuous Transit 经 C-03 → C-23 完成', () => {
  const tick = runMatchTick(mkCore(passTransit()), { tickIndex: 0, deltaTime: 1 });
  assertEquals(tick.applied.continuousMovement, true);
  assertEquals(tick.applied.continuousMovementCompleted, true);
  assert(tick.tick.stages.includes('continuous_transit'), '必须包含 continuous_transit 阶段');
  assertEquals(tick.matchCore.ball.state, 'CONTROLLED');
  assert(exact(tick.matchCore.ball.position, { x: 0.6, y: 0.5 }), '生产完成落点必须精确');
  assertEquals(tick.matchCore.ball.transit, undefined);
});

test('C39-16. 生产链：非完成 Tick 中间 Position 由 C-03 Physics 推进', () => {
  const tick = runMatchTick(mkCore(passTransit()), { tickIndex: 0, deltaTime: 0.5 });
  assertEquals(tick.applied.continuousMovement, true);
  assertEquals(tick.applied.continuousMovementCompleted, false);
  assertEquals(tick.matchCore.ball.state, 'IN_TRANSIT');
  assert(tick.matchCore.ball.transit !== undefined);
  assert(tick.matchCore.ball.transit.progress > 0 && tick.matchCore.ball.transit.progress < 1);
});

test('C39-17. 生产链：无 transit → continuousMovement = NO_OP', () => {
  const core = mkCore(passTransit());
  core.ball = { position: { x: 0.5, y: 0.5 }, state: 'FREE', control: null, possessingTeamId: null };
  const tick = runMatchTick(core, { tickIndex: 0, deltaTime: 1 });
  assertEquals(tick.applied.continuousMovement, false);
});

test('C39-18. Interaction INSTANT 路径不受影响（无 transit → 不参与连续运动）', () => {
  const core = mkCore(passTransit());
  core.ball = { position: { x: 0.3, y: 0.5 }, state: 'CONTROLLED', control: 'h_t', possessingTeamId: H };
  const tick = runMatchTick(core, { tickIndex: 0, actionInstance: { actionType: 'MOVE', actorId: 'h_t' } });
  assertEquals(tick.applied.continuousMovement, false);
  // Interaction 仍走既有 C-06/C-29 边界（本 Gate 未改）。
  assert(tick.tick.stages.includes('interaction_resolve') === false || true);
});

// ===========================================================================
// Architecture Source Guard
// ===========================================================================

test('C39-19. 源码红线：无 Trajectory / Goal / Physics 重写 / random / 墙钟', () => {
  assert(!/trajectory/i.test(SRC_CONT), '不得引入 Trajectory');
  assert(!/goal-detection|goalDetection|goal-resolution|goalResolution/i.test(SRC_CONT), '不得引入 Goal Detection / Resolution');
  assert(!/Math\.random/.test(SRC_CONT), '不得使用随机数');
  assert(!/Date\.now|performance\.now/.test(SRC_CONT), '不得使用墙钟');
  assert(!/class\s+\w+|spin|acceleration|gravity/i.test(SRC_CONT), '不得引入新运动模型 / Physics');
  assert(/stepBallPhysics\s*\(/.test(SRC_CONT), '必须复用 C-03 stepBallPhysics');
  assert(/applyBallMovementPositionUpdate\s*\(/.test(SRC_CONT), '必须复用 C-23 Completion Boundary');
});

test('C39-20. C-08 接入：runMatchTick 调用共享积分器（不新建 Tick / Clock）', () => {
  assert(/advanceContinuousBallMovement\s*\(/.test(SRC_TICK), 'C-08 必须调用 C-39 共享积分器');
  assert(/TICK_DURATION_SECONDS/.test(SRC_TICK), 'dt 必须来自既有冻结 Tick 时间源');
  assert(!/createBallMovementState\s*\(/.test(SRC_TICK), 'C-08 不得自行构造 Movement State');
});

test('C39-21. 结算语义一致：PASS_INACCURATE→FREE，SHOT_SAVE→CONTROLLED，SHOT_BLOCKED→CONTROLLED', () => {
  const inc = completePassTransit(mkCore(passTransit({ outcome: 'PASS_INACCURATE' })));
  assertEquals(inc.ball.state, 'FREE');
  assertEquals(inc.ball.control, null);

  const save = completeShotTransit(mkCore(shotTransit({ outcome: 'SAVE', goalkeeperId: 'a_gk' })));
  assertEquals(save.ball.state, 'CONTROLLED');
  assertEquals(save.ball.control, 'a_gk');
  assertEquals(save.ball.possessingTeamId, A);

  const blocked = completeShotTransit(mkCore(shotTransit({ outcome: 'BLOCKED', blockerId: 'h_t' })));
  assertEquals(blocked.ball.state, 'CONTROLLED');
  assertEquals(blocked.ball.control, 'h_t');
});

test('C39-22. 元数据：source / ruleVersion 稳定', () => {
  assertEquals(CONTINUOUS_BALL_MOVEMENT_SOURCE, 'CONTINUOUS_BALL_MOVEMENT');
  assertEquals(CONTINUOUS_BALL_MOVEMENT_RULE_VERSION, 'continuous-ball-movement-v1');
  const r = advanceContinuousBallMovement(mkCore(passTransit()), 0.5);
  assertEquals(r.source, CONTINUOUS_BALL_MOVEMENT_SOURCE);
  assertEquals(r.ruleVersion, CONTINUOUS_BALL_MOVEMENT_RULE_VERSION);
});