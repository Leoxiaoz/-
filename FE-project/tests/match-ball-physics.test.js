/**
 * Step 39F-M-C-03 —— Ball Physics / Ball Interaction Foundation 测试（A–O + 架构 + 配置 + 兼容）。
 * 红线：不接 Season/Schedule/Competition/Production Loop；不改 Score/Stats/Growth/Training/Save/Schema；
 *       不改 PASS/SHOT；不使用 Math.random。
 */

import { test, assert, assertEquals } from './harness.js';
import {
  stepBallPhysics, stepMatchBall, seedBallVelocity, sanitizeBall, velocityFromTransit,
} from '../src/core/match/ball-physics.js';
import { BALL_PHYSICS_CONFIG, BALL_STATE, BALL_BOUNDARY, CONTACT_TYPE, assertValidBallPhysicsConfig } from '../src/core/match/ball-physics-config.js';
import { computeBallContact, sweptBallContact } from '../src/core/match/ball-contact.js';
import { resolveBallBoundary } from '../src/core/match/ball-boundary.js';
import { runPhysics, runMatchHarness } from './ball-physics-harness.js';
import { mkBall, mkMover, mkBallCore } from './ball-physics-fixtures.js';
import { updateMovement } from '../src/core/match/movement-update.js';

const CFG = BALL_PHYSICS_CONFIG;
const speedOf = (v) => Math.hypot(v.x, v.y);

// ---------------------------------------------------------------- A stationary
test('A：静止球 Physics Step 不产生无原因位移', () => {
  const ball = mkBall({ x: 0.5, y: 0.5 });
  const r = runPhysics(ball, { dt: 0.5, ticks: 50 });
  assertEquals(r.finalBall.position, { x: 0.5, y: 0.5 });
  assertEquals(r.finalBall.velocity, { x: 0, y: 0 });
  assertEquals(r.violations, []);
});

// ---------------------------------------------------------------- B moving deterministic
test('B：移动球轨迹 deterministic（两次运行逐 tick 一致）', () => {
  const ball = mkBall({ x: 0.5, y: 0.5, vx: 0.3, vy: 0.2 });
  const a = runPhysics(ball, { dt: 0.1, ticks: 60, record: true });
  const b = runPhysics(ball, { dt: 0.1, ticks: 60, record: true });
  assertEquals(JSON.stringify(a.history), JSON.stringify(b.history));
  assert(speedOf(a.finalBall.velocity) < speedOf(ball.velocity), '摩擦应使速度下降');
});

// ---------------------------------------------------------------- C friction
test('C：摩擦使速度单调下降并进入 stop threshold', () => {
  const ball = mkBall({ x: 0.5, y: 0.5, vx: 0.5, vy: 0 });
  const r = runPhysics(ball, { dt: 0.1, ticks: 200, record: true });
  let prev = Infinity;
  for (const v of r.history.velocities) {
    const s = speedOf(v);
    assert(s <= prev + 1e-9, `速度应非增：${s} > ${prev}`);
    prev = s;
  }
  assertEquals(speedOf(r.finalBall.velocity), 0);
  assert(r.finalBall.position.x > 0.5, '球应先向前滚动');
});

// ---------------------------------------------------------------- D max speed
test('D：超高速输入被 clamp，无 Infinity / 异常值', () => {
  const ball = mkBall({ x: 0.5, y: 0.5, vx: 1e6, vy: -1e6 });
  const r = runPhysics(ball, { dt: 0.5, ticks: 20 });
  assert(Number.isFinite(r.finalBall.position.x) && Number.isFinite(r.finalBall.position.y), 'position 必须 finite');
  assert(Number.isFinite(r.finalBall.velocity.x) && Number.isFinite(r.finalBall.velocity.y), 'velocity 必须 finite');
  assert(speedOf(r.finalBall.velocity) <= CFG.MAX_SPEED + 1e-6, 'speed 必须 <= MAX_SPEED');
  assertEquals(r.violations, []);
});

// ---------------------------------------------------------------- E boundary
test('E：边界行为确定且不越界（反射）', () => {
  const ball = mkBall({ x: 0.98, y: 0.5, vx: 0.5, vy: 0 });
  const a = runPhysics(ball, { dt: 1, ticks: 1 });
  const b = runPhysics(ball, { dt: 1, ticks: 1 });
  assertEquals(JSON.stringify(a.finalBall), JSON.stringify(b.finalBall));
  assert(a.finalBall.position.x <= CFG.PITCH_MAX + 1e-9, '不应越界');
  assert(a.stats.boundary >= 1, '应记录边界接触');
  assert(a.finalBall.velocity.x <= 0, 'x 方向应反射为负');
  // 四边都不越界
  const r = runPhysics(mkBall({ x: 0.5, y: 0.5, vx: 0.9, vy: 0.9 }), { dt: 1, ticks: 200 });
  assertEquals(r.violations, []);
});

test('E：resolveBallBoundary 输出 IN_BOUNDS / BOUNDARY_CONTACT', () => {
  const inside = resolveBallBoundary({ x: 0.5, y: 0.5 }, { x: 0.1, y: 0 }, CFG);
  assertEquals(inside.boundary.result, BALL_BOUNDARY.IN_BOUNDS);
  const out = resolveBallBoundary({ x: 1.2, y: 0.5 }, { x: 0.3, y: 0 }, CFG);
  assertEquals(out.boundary.result, BALL_BOUNDARY.BOUNDARY_CONTACT);
  assert(out.position.x === 1);
});

// ---------------------------------------------------------------- F player-ball contact
test('F：球撞向静止球员 —— 发生接触且速度可解释变化', () => {
  const ball = mkBall({ x: 0.5, y: 0.5, vx: 0.3, vy: 0 });
  const players = [mkMover('p1', 0.54, 0.5, 0, 0)];
  const r = runPhysics(ball, { dt: 0.1, ticks: 1, players });
  assert(r.stats.contacts >= 1, '应发生接触');
  const res = stepBallPhysics(ball, 0.1, { players });
  assertEquals(res.contacts[0].playerId, 'p1');
  assert(res.contacts[0].distance <= CFG.CONTACT_RADIUS + 1e-9, '接触距离应在半径内');
  assert(Math.abs(res.contacts[0].contactNormal.x + 1) < 1e-6, '法向应指向 -x');
  assert(res.ball.velocity.x < 0, '球应被弹回（速度改变）');
  assertEquals(res.ball.lastTouchPlayerId, 'p1');
});

// ---------------------------------------------------------------- G moving player contact
test('G：运动球员接触 —— relative velocity 被考虑，结果不同于静止球员', () => {
  const ball = mkBall({ x: 0.5, y: 0.5, vx: 0.3, vy: 0 });
  const still = stepBallPhysics(ball, 0.1, { players: [mkMover('p1', 0.54, 0.5, 0, 0)] });
  const moving = stepBallPhysics(ball, 0.1, { players: [mkMover('p1', 0.54, 0.5, -0.2, 0)] });
  assert(moving.ball.velocity.x < still.ball.velocity.x, `运动球员应给球更大反向速度：${moving.ball.velocity.x} vs ${still.ball.velocity.x}`);
  assertEquals(moving.contacts[0].contactType, CONTACT_TYPE.PLAYER_TO_BALL);
});

// ---------------------------------------------------------------- H no sticky
test('H：无粘球 —— 同一交互窗口内不每 tick 叠加 impulse', () => {
  const players = [mkMover('p1', 0.5, 0.5, 0.1, 0)];
  let ball = mkBall({ x: 0.515, y: 0.5, vx: 0, vy: 0 });
  let impulses = 0; let maxSpeed = 0;
  for (let i = 0; i < 60; i += 1) {
    const res = stepBallPhysics(ball, 0.1, { players });
    ball = res.ball;
    for (const c of res.contacts) if (c.contactType !== CONTACT_TYPE.CONTINUING) impulses += 1;
    maxSpeed = Math.max(maxSpeed, speedOf(ball.velocity));
  }
  assert(impulses <= 3, `impulse 次数应极少（窗口生效），实际 ${impulses}`);
  assert(maxSpeed <= CFG.MAX_SPEED + 1e-6, `速度不应爆增，实际 ${maxSpeed}`);
  assert(Number.isFinite(ball.position.x), '位置必须 finite');
});

// ---------------------------------------------------------------- I tunneling
test('I：高速球跨越球员 —— swept 不得完全穿过', () => {
  const ball = mkBall({ x: 0.2, y: 0.5, vx: 1.2, vy: 0 });
  const players = [mkMover('p1', 0.5, 0.5, 0, 0)];
  const res = stepBallPhysics(ball, 0.5, { players });
  assert(res.contacts.length >= 1, '高速穿越必须检测到接触（防 tunneling）');
  assert(res.contacts.some((c) => c.playerId === 'p1'));
  // swept 几何直接验证
  const sc = sweptBallContact({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, { playerId: 'p1', position: { x: 0.5, y: 0.5 } }, CFG.CONTACT_RADIUS);
  assert(sc.isContact, '线段应命中球员');
});

// ---------------------------------------------------------------- J deterministic
test('J：deterministic —— 同输入两次 JSON 完全一致', () => {
  const ball = mkBall({ x: 0.3, y: 0.4, vx: 0.4, vy: 0.25 });
  const players = [mkMover('a', 0.5, 0.5, 0.05, 0.02), mkMover('b', 0.7, 0.3, -0.03, 0.01)];
  const a = runPhysics(ball, { dt: 0.1, ticks: 80, players, record: true });
  const b = runPhysics(ball, { dt: 0.1, ticks: 80, players, record: true });
  assertEquals(JSON.stringify(a.finalBall), JSON.stringify(b.finalBall));
  assertEquals(JSON.stringify(a.history), JSON.stringify(b.history));
});

// ---------------------------------------------------------------- K Math.random guard
test('K：Ball Physics 路径不调用 Math.random', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Ball Physics 不应调用 Math.random'); };
  try {
    runPhysics(mkBall({ x: 0.4, y: 0.4, vx: 0.5, vy: 0.3 }), { dt: 0.1, ticks: 40, players: [mkMover('p', 0.6, 0.5, 0.1, 0)] });
    runMatchHarness(mkBallCore({ ball: mkBall({ vx: 0.4, vy: 0.2 }) }), { dtSeconds: 5, ticks: 30 });
    assert(true);
  } finally {
    Math.random = original;
  }
});

// ---------------------------------------------------------------- L pure function
test('L：纯函数 —— 不修改输入 BallState', () => {
  const ball = mkBall({ x: 0.5, y: 0.5, vx: 0.3, vy: 0.1 });
  const before = JSON.stringify(ball);
  stepBallPhysics(ball, 0.2, { players: [mkMover('p', 0.55, 0.5, 0, 0)] });
  assertEquals(JSON.stringify(ball), before, '输入 BallState 不应被修改');
});

// ---------------------------------------------------------------- M/N long run finite + bounds
test('M/N：90 分钟 × 22 人 + 1 球长稳 —— position/velocity finite 且有界', () => {
  const r = runMatchHarness(mkBallCore({ ball: mkBall({ x: 0.5, y: 0.5, vx: 0.55, vy: 0.3 }) }), { dtSeconds: 1, ticks: 5400, relaunch: true });
  assertEquals(r.violations, [], `不应有不变量违规：${JSON.stringify(r.violations.slice(0, 3))}`);
  assert(Number.isFinite(r.finalCore.ball.position.x) && Number.isFinite(r.finalCore.ball.position.y));
  assert(speedOf(r.finalCore.ball.velocity) <= CFG.MAX_SPEED + 1e-6);
  assertEquals(r.stats.ticks, 5400);
  assertEquals(r.stats.playerTicks, 22 * 5400);
});

// ---------------------------------------------------------------- O dt stability
test('O：dt 稳定性（0.25 / 0.5 / 1）—— 无 NaN / Infinity / 爆速', () => {
  for (const dt of [0.25, 0.5, 1]) {
    const r = runPhysics(mkBall({ x: 0.5, y: 0.5, vx: 0.8, vy: 0.5 }), { dt, ticks: 300, players: [mkMover('p', 0.7, 0.6, 0.02, 0)] });
    assertEquals(r.violations, [], `dt=${dt} 出现违规`);
    assert(Number.isFinite(r.finalBall.position.x) && Number.isFinite(r.finalBall.velocity.x), `dt=${dt} 必须 finite`);
  }
});

// ---------------------------------------------------------------- config
test('配置：assertValidBallPhysicsConfig 通过且非法配置抛错', () => {
  assert(assertValidBallPhysicsConfig(CFG));
  let threw = false;
  try { assertValidBallPhysicsConfig({ ...CFG, FRICTION: NaN }); } catch { threw = true; }
  assert(threw, 'NaN 配置应抛错');
  threw = false;
  try { assertValidBallPhysicsConfig({ ...CFG, CONTACT_RESTITUTION: 2 }); } catch { threw = true; }
  assert(threw, '越界 restitution 应抛错');
});

// ---------------------------------------------------------------- PASS/SHOT 兼容消费
test('兼容：velocityFromTransit 消费既有 transit metadata（不重写 Resolution）', () => {
  const v = velocityFromTransit({ from: { x: 0, y: 0 }, to: { x: 0.6, y: 0 }, duration: 2 });
  assertEquals(v, { x: 0.3, y: 0 });
  assertEquals(velocityFromTransit({ duration: 0 }), { x: 0, y: 0 });
});

test('兼容：IN_TRANSIT 球缺 velocity 时由 transit 播种（stepMatchBall）', () => {
  const core = mkBallCore({
    ball: { position: { x: 0, y: 0.5 }, velocity: undefined, state: BALL_STATE.IN_TRANSIT, control: null, possessingTeamId: null, transit: { from: { x: 0, y: 0.5 }, to: { x: 0.6, y: 0.5 }, duration: 2, elapsed: 0, progress: 0 } },
  });
  core.ball.velocity = undefined;
  const after = stepMatchBall(core, 0.5);
  assert(after.ball.position.x > 0, '球应沿 transit 速度推进');
  assert(Number.isFinite(after.ball.position.x));
  assert(!!after.ball.transit, 'transit metadata 应被保留');
});

// ---------------------------------------------------------------- Architecture
test('Architecture：stepMatchBall 只改 ball，顶层其余字段与 players 引用不变', () => {
  const core = mkBallCore({ ball: mkBall({ x: 0.4, y: 0.4, vx: 0.3, vy: 0.2 }) });
  const moved = updateMovement(core, 0.5);
  const after = stepMatchBall(moved, 1);
  assertEquals(after.score, moved.score);
  assertEquals(after.clock, moved.clock);
  assertEquals(after.tactical, moved.tactical);
  assert(after.players === moved.players, 'Ball Physics 不应改写球员位置（无第二 Position Truth）');
  assert(after.teams === moved.teams);
  const allowed = ['worldId', 'season', 'matchId', 'ruleVersion', 'teams', 'clock', 'score', 'ball', 'players', 'tactical', 'movement'];
  for (const k of Object.keys(after)) assert(allowed.includes(k), `出现非预期顶层字段 ${k}`);
});

test('Architecture：sanitizeBall 清理非法输入（NaN / 越界 / 非法 state）', () => {
  const s = sanitizeBall({ position: { x: NaN, y: 5 }, velocity: { x: Infinity, y: 0 }, state: 'WAT', contacting: ['b', 'a', 'a', 3] });
  assert(Number.isFinite(s.position.x) && s.position.y <= CFG.PITCH_MAX);
  assert(Number.isFinite(s.velocity.x) && Number.isFinite(s.velocity.y));
  assertEquals(s.state, BALL_STATE.FREE);
  assertEquals(s.contacting, ['a', 'b']);
});

test('Architecture：CONTROLLED 球不被物理推进（避免与未来 Dribble 争 Position Truth）', () => {
  const ball = mkBall({ x: 0.4, y: 0.5, vx: 0.5, vy: 0, state: 'CONTROLLED', control: 'p1', possessingTeamId: 't' });
  const res = stepBallPhysics(ball, 1, { players: [mkMover('p1', 0.42, 0.5, 0, 0)] });
  assertEquals(res.ball.position, { x: 0.4, y: 0.5 });
  assertEquals(res.ball.velocity, { x: 0, y: 0 });
  assertEquals(res.substeps, 0);
});

test('Architecture：computeBallContact 几何正确（半径边界）', () => {
  const near = computeBallContact({ x: 0.5, y: 0.5 }, { playerId: 'p', position: { x: 0.52, y: 0.5 } }, 0.03);
  assert(near.isContact && Math.abs(near.distance - 0.02) < 1e-9);
  const far = computeBallContact({ x: 0.5, y: 0.5 }, { playerId: 'p', position: { x: 0.6, y: 0.5 } }, 0.03);
  assert(!far.isContact);
});

test('Architecture：seedBallVelocity 返回新对象且 clamp', () => {
  const ball = mkBall({ x: 0.5, y: 0.5 });
  const seeded = seedBallVelocity(ball, { x: 99, y: 0 });
  assert(seeded !== ball);
  assert(speedOf(seeded.velocity) <= CFG.MAX_SPEED + 1e-6);
  assertEquals(ball.velocity, { x: 0, y: 0 }, '原对象不应被改');
});