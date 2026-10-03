/**
 * Ball Physics 测试夹具（Step 39F-M-C-03）。
 * 仅测试 / Harness 使用；不进入生产代码，不接 Production Loop。
 * 复用 movement-fixtures 的 22 人阵型，避免重复定义。
 */

import { H, A, basePlayers, tactical } from './movement-fixtures.js';

/** 构造 BallState（缺省静止 FREE）。 */
export function mkBall({ x = 0.5, y = 0.5, vx = 0, vy = 0, state = 'FREE', control = null, possessingTeamId = null, transit = undefined } = {}) {
  const b = {
    position: { x, y },
    velocity: { x: vx, y: vy },
    state,
    control,
    possessingTeamId,
    lastTouchPlayerId: null,
    contacting: [],
  };
  if (transit !== undefined) b.transit = transit;
  return b;
}

/** 构造球员运动条目（position + velocity，供 Ball Physics 只读消费）。 */
export function mkMover(playerId, x, y, vx = 0, vy = 0) {
  return { playerId, position: { x, y }, velocity: { x: vx, y: vy } };
}

/**
 * 22 人最小 MatchCore（可含球速），供 MatchCore 级 Harness 使用。
 * 球权默认在 h_mf1；movement 状态由 updateMovement 首次运行建立。
 */
export function mkBallCore({ ball = mkBall(), tacticalState = {}, clock = { simulationTime: 0, matchDuration: 90, half: 1, status: 'in_play' }, ballControl = 'h_mf1', possessingTeamId = H } = {}) {
  const players = basePlayers().map((p) => ({ ...p, positionOnPitch: { ...p.positionOnPitch } }));
  return {
    worldId: 'w_ball', season: 1, matchId: 'm_ball', ruleVersion: 'match-ball-physics-v1',
    teams: { home: H, away: A },
    clock: { ...clock },
    score: { home: 0, away: 0 },
    ball: { ...ball, position: { ...ball.position }, velocity: { ...ball.velocity } },
    players,
    tactical: { [H]: tactical(tacticalState[H]), [A]: tactical(tacticalState[A]) },
  };
}

/** 确定性「驱动」方向表（Harness 压力用；非随机，仅用于制造运动/边界/接触事件）。 */
export const LAUNCH_DIRECTIONS = Object.freeze([
  { x: 0.9, y: 0.2 }, { x: -0.8, y: 0.5 }, { x: 0.3, y: -0.95 }, { x: -0.4, y: -0.9 },
  { x: 0.95, y: -0.3 }, { x: -0.95, y: -0.2 }, { x: 0.2, y: 0.98 }, { x: -0.3, y: 0.95 },
]);