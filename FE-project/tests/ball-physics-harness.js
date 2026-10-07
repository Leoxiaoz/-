/**
 * Ball Physics Headless Harness（Step 39F-M-C-03）。
 * 层级归属：**Test / Harness only**。不进入生产代码，不接 Season / Schedule / Competition / Save / UI / Production Loop。
 *
 * 提供：stationary / rolling / moving / player-contact / moving-player-contact / boundary / tunneling /
 *       deterministic replay 场景，以及 22 人 + 1 球长稳驱动与不变量采集。
 * 红线：不产生正式比赛结果；不写 Score / Stats / Growth / Training / Save / Schema；不使用 Math.random。
 */

import { stepBallPhysics, seedBallVelocity } from '../src/core/match/ball-physics.js';
import { BALL_PHYSICS_CONFIG } from '../src/core/match/ball-physics-config.js';
import { updateMovement } from '../src/core/match/movement-update.js';
import { LAUNCH_DIRECTIONS } from './ball-physics-fixtures.js';

const CFG = BALL_PHYSICS_CONFIG;
const EPS = 1e-9;

function speedOf(v) { return Math.hypot(Number(v?.x) || 0, Number(v?.y) || 0); }

function finiteVec(v) { return v && Number.isFinite(v.x) && Number.isFinite(v.y); }

/** 单 tick 不变量检查。 */
export function checkBallInvariants(ball, prevPos, dt, violations, tick, config = CFG) {
  if (!finiteVec(ball?.position)) violations.push({ tick, type: 'position-nonfinite' });
  else if (ball.position.x < config.PITCH_MIN - EPS || ball.position.x > config.PITCH_MAX + EPS
    || ball.position.y < config.PITCH_MIN - EPS || ball.position.y > config.PITCH_MAX + EPS) {
    violations.push({ tick, type: 'position-out-of-bounds', pos: ball.position });
  }
  if (!finiteVec(ball?.velocity)) violations.push({ tick, type: 'velocity-nonfinite' });
  else if (speedOf(ball.velocity) > config.MAX_SPEED + 1e-6) {
    violations.push({ tick, type: 'speed-over-max', speed: speedOf(ball.velocity) });
  }
  if (prevPos) {
    const moved = Math.hypot(ball.position.x - prevPos.x, ball.position.y - prevPos.y);
    const bound = config.MAX_SPEED * dt + config.CONTACT_RADIUS * 2 + 1e-6;
    if (moved > bound) violations.push({ tick, type: 'teleport', moved, bound });
  }
}

/**
 * 纯物理运行器（无 MatchCore）。
 * @returns {{finalBall:object, stats:object, violations:Array, history:object|null}}
 */
export function runPhysics(ball, { dt = 0.1, ticks = 100, players = [], config = CFG, record = false } = {}) {
  const violations = [];
  const stats = { ticks: 0, substeps: 0, contacts: 0, boundary: 0, wallMs: 0, maxTickMs: 0, avgTickMs: 0 };
  const history = record ? { positions: [], velocities: [] } : null;
  let cur = ball;
  let prev = { ...ball.position };
  const t0 = Date.now();
  for (let i = 0; i < ticks; i += 1) {
    const s = Date.now();
    const res = stepBallPhysics(cur, dt, { players, config });
    cur = res.ball;
    checkBallInvariants(cur, prev, dt, violations, i, config);
    stats.ticks += 1;
    stats.substeps += res.substeps;
    stats.contacts += res.contacts.length;
    if (res.boundary.result !== 'IN_BOUNDS') stats.boundary += 1;
    prev = { ...cur.position };
    if (record) { history.positions.push({ ...cur.position }); history.velocities.push({ ...cur.velocity }); }
    const ms = Date.now() - s;
    if (ms > stats.maxTickMs) stats.maxTickMs = ms;
  }
  stats.wallMs = Date.now() - t0;
  stats.avgTickMs = stats.ticks ? stats.wallMs / stats.ticks : 0;
  return { finalBall: cur, stats, violations, history };
}

/**
 * MatchCore 级 Harness：22 人移动 + 1 球物理，连续长稳。
 * 每 tick：updateMovement(dtSeconds/60 分钟) → stepMatchBall(dtSeconds 秒)。
 * `relaunch`：球静止时用**确定性方向表**重新驱动（Harness 压力用；非随机），制造边界 / 接触事件。
 */
export function runMatchHarness(core, { dtSeconds = 1, ticks = 5400, relaunch = true, record = false } = {}) {
  const violations = [];
  const stats = {
    ticks: 0, substeps: 0, contacts: 0, boundary: 0, relaunches: 0,
    wallMs: 0, maxTickMs: 0, avgTickMs: 0, playerTicks: 0,
  };
  const history = record ? { ball: [], players: [] } : null;
  let cur = core;
  let prevBall = { ...core.ball.position };
  let launch = 0;
  const movementDt = dtSeconds / 60; // seconds → minutes
  const t0 = Date.now();

  for (let i = 0; i < ticks; i += 1) {
    const s = Date.now();
    cur = updateMovement(cur, movementDt, {});
    if (relaunch && speedOf(cur.ball.velocity) <= CFG.STOP_THRESHOLD && cur.ball.state === 'FREE') {
      const dir = LAUNCH_DIRECTIONS[launch % LAUNCH_DIRECTIONS.length];
      launch += 1;
      stats.relaunches += 1;
      cur = { ...cur, ball: seedBallVelocity(cur.ball, { x: dir.x * 0.55, y: dir.y * 0.55 }, CFG) };
    }
    const res = stepBallPhysics(cur.ball, dtSeconds, { players: playersOf(cur), config: CFG });
    cur = { ...cur, ball: res.ball };
    checkBallInvariants(cur.ball, prevBall, dtSeconds, violations, i, CFG);
    stats.ticks += 1;
    stats.substeps += res.substeps;
    stats.contacts += res.contacts.length;
    if (res.boundary.result !== 'IN_BOUNDS') stats.boundary += 1;
    stats.playerTicks += cur.players.length;
    prevBall = { ...cur.ball.position };
    // 推进 harness 时钟（分钟），仅用于可解释时间线
    const t = Math.min(90, (Number(cur.clock?.simulationTime) || 0) + movementDt);
    cur = { ...cur, clock: { ...cur.clock, simulationTime: t, half: t >= 45 ? 2 : 1 } };
    if (record) {
      history.ball.push({ ...cur.ball.position, speed: speedOf(cur.ball.velocity) });
      if (i % 10 === 0) history.players.push(cur.players.map((p) => ({ playerId: p.playerId, x: p.positionOnPitch.x, y: p.positionOnPitch.y })));
    }
    const ms = Date.now() - s;
    if (ms > stats.maxTickMs) stats.maxTickMs = ms;
  }
  stats.wallMs = Date.now() - t0;
  stats.avgTickMs = stats.ticks ? stats.wallMs / stats.ticks : 0;
  return { finalCore: cur, stats, violations, history };
}

/** 从 MatchCore 派生球员运动列表（复用生产 helper，保持一致）。 */
function playersOf(core) {
  // 延迟 import 避免循环；直接内联等价逻辑
  const mov = core?.movement?.players ?? {};
  return (core?.players ?? []).map((p) => {
    const st = mov[p.playerId];
    let vx = 0, vy = 0;
    if (st && st.target) {
      const dx = (Number(st.target.x) || 0) - p.positionOnPitch.x;
      const dy = (Number(st.target.y) || 0) - p.positionOnPitch.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) { const sp = (Number(st.speed) || 0) / 60; vx = (dx / d) * sp; vy = (dy / d) * sp; }
    }
    return { playerId: p.playerId, position: { ...p.positionOnPitch }, velocity: { x: vx, y: vy } };
  });
}