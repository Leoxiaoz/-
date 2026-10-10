/**
 * Action → Transit Boundary（Action→Transit Boundary Implementation Gate）测试。
 *
 * 覆盖：PASS 安装 / SHOT 安装 / Tick N 安装→Tick N+1 推进→完成 Tick 精确终点 /
 * 不应安装的各情况 / 不变量门 / 非 PASS·SHOT 回归 / 确定性 / 无共享状态泄漏 /
 * C-08 既有字段保留。
 *
 * 红线：不接生产 Match Loop / 门线 / 赛季；不改封存模块；不伪造终点。
 */

import { test, assert, assertEquals } from './harness.js';
import {
  runMatchTickWithActions, ACTION_INSTALL_STATUS, ACTION_INSTALL_REASON,
} from '../src/core/match/action-transit-boundary.js';
import { runMatchTick, checkTickInvariants } from '../src/core/match/match-tick.js';

const H = 'clb_h'; const A = 'clb_a';
const ATTRS = (o = {}) => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...o });
function mk(id, t, pos, x, y, attrs = {}, extra = {}) {
  return {
    playerId: id, teamId: t, position: pos, positionOnPitch: { x, y }, onPitch: true,
    injured: false, sentOff: false, attributes: ATTRS(attrs), fitness: 100, form: 50, morale: 50, matchLoad: 0, ...extra,
  };
}
function coreOf(players, ballControl, poss, extra = {}) {
  const bp = players.find((p) => p.playerId === ballControl);
  return {
    worldId: 'w_bnd', season: 1, matchId: 'm_bnd', ruleVersion: 'action-transit-boundary-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball: { position: { ...(bp?.positionOnPitch ?? { x: 0.5, y: 0.5 }) }, control: ballControl, possessingTeamId: poss, state: 'CONTROLLED' },
    players,
    ...extra,
  };
}
const passInst = (actorId, targetId) => ({
  actionType: 'PASS', actorId, target: { type: 'TEAMMATE', playerId: targetId }, intent: 'SHORT',
  riskIntent: { level: 'MEDIUM', value: 0.5 }, commitment: { type: 'COMMITTED', duration: null },
});
const shotInst = (actorId) => ({
  actionType: 'SHOT', actorId, target: { type: 'GOAL_AREA', zone: 'CENTER' }, intent: 'GOAL',
  riskIntent: { level: 'MEDIUM', value: 0.5 },
});

// 受控 PASS 场景（actor 控球，短传高能力 → 合法）
function passCore() {
  return coreOf([
    mk('h_a', H, 'MF', 0.40, 0.50, { passing: 95 }), mk('h_t', H, 'MF', 0.45, 0.50),
    mk('a_gk', A, 'GK', 0.95, 0.50),
  ], 'h_a', H);
}
// 受控 SHOT 场景
function shotCore() {
  return coreOf([
    mk('h_a', H, 'FW', 0.65, 0.50, { finishing: 80, technique: 80 }),
    mk('a_gk', A, 'GK', 0.95, 0.50),
  ], 'h_a', H);
}
const actorPosOf = (core, id) => core.players.find((p) => p.playerId === id).positionOnPitch;

// ===========================================================================
// A. PASS 成功
// ===========================================================================

test('ATB-01. PASS：合法受控球 → 安装 TRANSIT（状态 / 球权 / transit 合法）', () => {
  const res = runMatchTickWithActions(passCore(), { actionInstance: passInst('h_a', 'h_t') }, { seed: 'seed-pass' });
  assertEquals(res.actionInstall.status, ACTION_INSTALL_STATUS.INSTALLED);
  assertEquals(res.actionInstall.reason, ACTION_INSTALL_REASON.APPLIED);
  assertEquals(res.actionInstall.applied, true);
  const ball = res.matchCore.ball;
  assertEquals(ball.state, 'IN_TRANSIT');
  assertEquals(ball.control, null);
  assertEquals(ball.possessingTeamId, null);
  assert(!!ball.transit, 'ball.transit 应存在');
  // transit.from = 发起球员在当前 MatchCore 中的真实位置（C-08 PLAYER_MOVEMENT 后的位置）。
  assertEquals(ball.transit.from, actorPosOf(res.matchCore, 'h_a'));
  assert(Number.isFinite(ball.transit.to.x) && Number.isFinite(ball.transit.to.y), 'transit.to 应为有限坐标');
  assert(Number.isFinite(ball.transit.duration) && ball.transit.duration > 0, 'duration 应 > 0');
  // 安装后不变量通过
  assertEquals(checkTickInvariants(res.matchCore), []);
});

test('ATB-02. PASS：安装时球位置 = transit.from（本层未移动球）', () => {
  const res = runMatchTickWithActions(passCore(), { actionInstance: passInst('h_a', 'h_t') }, { seed: 'seed-pass' });
  assertEquals(res.matchCore.ball.position, res.matchCore.ball.transit.from);
  assertEquals(res.matchCore.ball.transit.elapsed, 0);
  assertEquals(res.matchCore.ball.transit.progress, 0);
});

test('ATB-03. PASS：actionResolution 为真实 PASS_RESOLUTION（非伪造）', () => {
  const res = runMatchTickWithActions(passCore(), { actionInstance: passInst('h_a', 'h_t') }, { seed: 'seed-pass' });
  assertEquals(res.actionResolution.type, 'PASS_RESOLUTION');
  assertEquals(res.actionResolution.ok, true);
});

// ===========================================================================
// B. SHOT 成功
// ===========================================================================

test('ATB-04. SHOT：安装 TRANSIT 且解析结果为 SHOT_RESOLUTION（不复用 PASS）', () => {
  const res = runMatchTickWithActions(shotCore(), { actionInstance: shotInst('h_a') }, { seed: 'seed-shot' });
  assertEquals(res.actionInstall.status, ACTION_INSTALL_STATUS.INSTALLED);
  assertEquals(res.actionResolution.type, 'SHOT_RESOLUTION');
  const ball = res.matchCore.ball;
  assertEquals(ball.state, 'IN_TRANSIT');
  assertEquals(ball.control, null);
  assertEquals(ball.possessingTeamId, null);
  assert(!!ball.transit && Number.isFinite(ball.transit.duration) && ball.transit.duration > 0, 'shot transit 合法');
  assertEquals(checkTickInvariants(res.matchCore), []);
});

// ===========================================================================
// C. 下一 Tick 运动（Tick N 安装 → N+1 推进 → 完成 Tick 精确终点）
// ===========================================================================

test('ATB-05. Tick N 安装后未移动；Tick N+1 由 C-39 推进；完成 Tick 由 C-23 写精确终点', () => {
  const installed = runMatchTickWithActions(passCore(), { actionInstance: passInst('h_a', 'h_t') }, { seed: 'seed-pass' });
  const coreN = installed.matchCore;
  const from = { ...coreN.ball.transit.from };
  const to = { ...coreN.ball.transit.to };
  const duration = coreN.ball.transit.duration;

  // Tick N：安装后球未运动（位置仍在 from）。
  assertEquals(coreN.ball.position, from);

  // Tick N+1：既有 C-08 CONTINUOUS_TRANSIT 推进（无 action）。
  const tickN1 = runMatchTick(coreN, { deltaTime: duration / 2 });
  assert(tickN1.matchCore.ball.transit.progress > 0, 'N+1 应推进 progress');
  assert(JSON.stringify(tickN1.matchCore.ball.position) !== JSON.stringify(from), 'N+1 应移动球位');
  assertEquals(tickN1.matchCore.ball.transit.to, to);

  // 完成 Tick：C-39 完成分支 → C-23 写精确 transit.to；transit 已清理。
  const tickDone = runMatchTick(coreN, { deltaTime: duration });
  assertEquals(tickDone.matchCore.ball.position, to);
  assert(tickDone.matchCore.ball.transit == null, '完成 Tick 后 transit 应被清理');
  assert(tickDone.matchCore.ball.state !== 'IN_TRANSIT', '完成后球不应仍为 IN_TRANSIT');
});

// ===========================================================================
// D. 不应安装的情况
// ===========================================================================

test('ATB-06. 无 ActionInstance → 不安装（NOT_ATTEMPTED / NO_ACTION）', () => {
  const core = passCore();
  const res = runMatchTickWithActions(core, {}, {});
  assertEquals(res.actionInstall.status, ACTION_INSTALL_STATUS.NOT_ATTEMPTED);
  assertEquals(res.actionInstall.reason, ACTION_INSTALL_REASON.NO_ACTION);
  assert(res.matchCore.ball.transit == null, '不应产生 transit');
});

test('ATB-07. 非 PASS / SHOT 动作 → 原样透传（NOT_APPLICABLE），matchCore 不变', () => {
  const core = passCore();
  const ai = { actionType: 'CLEARANCE', actorId: 'h_a' };
  const adapter = runMatchTickWithActions(core, { actionInstance: ai }, {});
  const plain = runMatchTick(core, { actionInstance: ai }, {});
  assertEquals(adapter.actionInstall.status, ACTION_INSTALL_STATUS.NOT_APPLICABLE);
  assertEquals(adapter.actionInstall.reason, ACTION_INSTALL_REASON.NON_TRANSIT_ACTION);
  assertEquals(adapter.matchCore, plain.matchCore);
});

test('ATB-08. PASS 解析失败（球未被发起者控制）→ FAILED_RESOLUTION，无状态写入', () => {
  // 球 FREE（无控制者），PASS 解析会取消。
  const core = coreOf([
    mk('h_a', H, 'MF', 0.40, 0.50), mk('h_t', H, 'MF', 0.45, 0.50),
  ], null, null, {});
  const res = runMatchTickWithActions(core, { actionInstance: passInst('h_a', 'h_t') }, { seed: 'x' });
  assertEquals(res.actionInstall.status, ACTION_INSTALL_STATUS.FAILED_RESOLUTION);
  assertEquals(res.actionResolution.ok, false);
  assert(res.matchCore.ball.transit == null, '不应安装 transit');
  assertEquals(res.matchCore.ball.state, 'CONTROLLED');
});

test('ATB-09. 球已 IN_TRANSIT → 不再次安装；既有 transit 保持不变', () => {
  const existingTransit = {
    state: 'IN_TRANSIT', from: { x: 0.2, y: 0.5 }, to: { x: 0.6, y: 0.5 }, duration: 3,
    elapsed: 1, progress: 0.33, outcome: 'PASS_COMPLETED', targetTeamId: H,
  };
  const core = coreOf([
    mk('h_a', H, 'MF', 0.40, 0.50), mk('h_t', H, 'MF', 0.45, 0.50),
  ], null, null, {
    ball: { position: { x: 0.3, y: 0.5 }, control: null, possessingTeamId: null, state: 'IN_TRANSIT', transit: existingTransit },
  });
  const res = runMatchTickWithActions(core, { actionInstance: passInst('h_a', 'h_t') }, { seed: 'x' });
  assertEquals(res.actionInstall.status, ACTION_INSTALL_STATUS.FAILED_RESOLUTION);
  assertEquals(res.actionResolution.ok, false);
  // 适配层未安装“新的” transit：进展中的既有 transit 身份字段不变
  // （注：C-08 的 CONTINUOUS_TRANSIT 会合法推进既有 transit 的 elapsed/progress，本层不改其身份/终点）。
  const t = res.matchCore.ball.transit;
  assertEquals(t.from, existingTransit.from);
  assertEquals(t.to, existingTransit.to);
  assertEquals(t.duration, existingTransit.duration);
  assertEquals(t.outcome, existingTransit.outcome);
  assertEquals(t.targetTeamId, existingTransit.targetTeamId);
  assertEquals(res.matchCore.ball.state, 'IN_TRANSIT');
});

test('ATB-10. C-08 非正常完成（非法 MatchCore）→ 不安装（TICK_NOT_COMPLETED）', () => {
  const res = runMatchTickWithActions({}, { actionInstance: passInst('h_a', 'h_t') }, {});
  assertEquals(res.actionInstall.status, ACTION_INSTALL_STATUS.NOT_ATTEMPTED);
  assertEquals(res.actionInstall.reason, ACTION_INSTALL_REASON.TICK_NOT_COMPLETED);
});

// ===========================================================================
// E. 不变量门（合法候选通过；非法候选无法在无注入前提下手动构造）
// ===========================================================================

test('ATB-11. 安装结果始终通过 checkTickInvariants（不变量门生效）', () => {
  const res = runMatchTickWithActions(passCore(), { actionInstance: passInst('h_a', 'h_t') }, { seed: 'seed-pass' });
  assertEquals(res.actionInstall.status, ACTION_INSTALL_STATUS.INSTALLED);
  // 适配层只在候选通过不变量检查后才返回，故最终状态必不含不变量问题。
  assertEquals(checkTickInvariants(res.matchCore), []);
  assertEquals(res.invariantIssues, []);
});

// ===========================================================================
// F. 回归 / 确定性 / 无共享状态泄漏 / C-08 字段保留
// ===========================================================================

test('ATB-12. 保留 C-08 既有 TickResult 字段', () => {
  const res = runMatchTickWithActions(passCore(), { actionInstance: passInst('h_a', 'h_t') }, { seed: 'seed-pass' });
  assertEquals(res.tick.status, 'COMPLETED');
  assert(Array.isArray(res.events) && res.events.length > 0, 'events 应保留');
  assert(res.applied && typeof res.applied === 'object', 'applied 应保留');
  assert(Array.isArray(res.invariantIssues), 'invariantIssues 应保留');
  assert('actionResolution' in res && 'actionInstall' in res, '应新增诊断字段');
});

test('ATB-13. 确定性：相同输入与 seed → 相同结果', () => {
  const r1 = runMatchTickWithActions(passCore(), { actionInstance: passInst('h_a', 'h_t') }, { seed: 'same' });
  const r2 = runMatchTickWithActions(passCore(), { actionInstance: passInst('h_a', 'h_t') }, { seed: 'same' });
  assertEquals(r1.matchCore.ball, r2.matchCore.ball);
  assertEquals(r1.actionResolution, r2.actionResolution);
});

test('ATB-14. 无共享状态泄漏：对 A 的安装不影响独立的 B', () => {
  const coreA = passCore();
  const coreB = passCore();
  const beforeB = JSON.stringify(coreB.ball);
  const resA = runMatchTickWithActions(coreA, { actionInstance: passInst('h_a', 'h_t') }, { seed: 'seed-pass' });
  assertEquals(resA.actionInstall.status, ACTION_INSTALL_STATUS.INSTALLED);
  assertEquals(JSON.stringify(coreB.ball), beforeB);
});

test('ATB-15. 非 PASS / SHOT 路径与原始 C-08 完全一致（回归）', () => {
  const core = passCore();
  const plain = runMatchTick(core, {}, {});
  const adapter = runMatchTickWithActions(core, {}, {});
  assertEquals(adapter.matchCore, plain.matchCore);
  assertEquals(adapter.tick, plain.tick);
});