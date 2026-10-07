/**
 * Step 39F-M-C-47 —— Player-Ball Contact Production Integration 测试。
 *
 * 目标：证明 C-46 已冻结的 Contact Contract 已正式接入生产 Match Tick：
 *  - 生产 C-08 CONTINUOUS_TRANSIT 向 C-39 传入 `playerMotionList(matchCore)`（post-PLAYER_MOVEMENT 的 Player Position）；
 *  - C-39 非完成 Tick 将其转发给 C-03 stepBallPhysics → 既有 C-03 Contact 正式进入生产；
 *  - Contact 仍内嵌于 C-03 Physics（无独立 CONTACT Stage；无第二 Contact Detector / Resolver / Schema）；
 *  - Contact 可改 Ball Position / Velocity / lastTouchPlayerId，但**不**改 Transit、**不**产生 Possession；
 *  - Contact Tick 使用 post-PLAYER_MOVEMENT 的 Player Position；
 *  - Completion Tick 不执行 Physics → 不 Contact（C-23 完成落点）；
 *  - contacting[] 为 Tick-Transient Derived；生产确定性；Interaction 语义不变。
 *
 * 红线：不改 C-03 / C-39 / C-23 / C-29 / C-05 / C-06 方程；不新增 CONTACT Stage / ContactResult / 第二 Truth；
 *       不引入 wall clock / Math.random。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runMatchTick } from '../src/core/match/match-tick.js';
import { TICK_STAGES } from '../src/core/match/match-tick-config.js';
import { INTERACTION_BALL_STATE as BS } from '../src/core/match/interaction-resolution-config.js';
import { BALL_PHYSICS_CONFIG } from '../src/core/match/ball-physics-config.js';

const H = 'H', A = 'A';
const RADIUS = BALL_PHYSICS_CONFIG.CONTACT_RADIUS;
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const TICK_SRC = strip(readSrc('match-tick.js'));
const C39_SRC = strip(readSrc('continuous-ball-movement-integration.js'));
const INTERACTION_SRC = strip(readSrc('interaction-resolution.js'));

const ATTRS = (o = {}) => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...o });
const mk = (id, t, pos, x, y, extra = {}) => ({
  playerId: id, teamId: t, position: pos, positionOnPitch: { x, y },
  onPitch: true, injured: false, sentOff: false, attributes: ATTRS(), fitness: 100, form: 50, morale: 50, matchLoad: 0, ...extra,
});
const tac = () => ({ formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' });

/** 生产 Transit 场景：球从 0.2→0.8，时长 duration；玩家（默认 H 队 MF）位于 playerX。 */
function transitCore({ playerX = 0.30, playerY = 0.50, duration = 3, elapsed = 0 } = {}) {
  const transit = { from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, duration, elapsed, outcome: 'PASS_COMPLETED', actorId: 'h_a' };
  return {
    worldId: 'w_cp47', season: 1, matchId: 'm_cp47', ruleVersion: 'v',
    teams: { home: H, away: A },
    clock: { simulationTime: 0, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    tactical: { [H]: tac(), [A]: tac() },
    ball: {
      position: { ...transit.from }, velocity: undefined, control: null, possessingTeamId: null,
      state: BS.IN_TRANSIT, contacting: [], lastTouchPlayerId: null,
      transit: { ...transit, from: { ...transit.from }, to: { ...transit.to } },
    },
    players: [mk('p1', H, 'MF', playerX, playerY)],
  };
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const tick = (core, input = { tickIndex: 0, deltaTime: 1 }) => runMatchTick(core, input);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** 非完成 Tick 且必然 Contact 的基准场景：duration=3, dt=1, player@0.30。 */
function contactTick() { return tick(transitCore({ playerX: 0.30, duration: 3 }), { tickIndex: 0, deltaTime: 1 }); }

// ===========================================================================
// CP-01 Production Contact Wiring（源码 + 行为）
// ===========================================================================
test('CP-01. Production Contact Wiring：C-08 向 C-39 传 players；生产 Tick 可触发 Contact', () => {
  // 源码：唯一接线 —— C-08 CONTINUOUS_TRANSIT 传 `playerMotionList(current)`，且 import 该适配器。
  assert(/advanceContinuousBallMovement\(\s*current\s*,\s*deltaTime\s*,\s*\{\s*players:\s*playerMotionList\(current\)\s*\}\)/.test(TICK_SRC),
    'C-08 必须以 { players: playerMotionList(current) } 调用 C-39');
  assert(/import\s*\{\s*playerMotionList\s*\}\s*from\s*'\.\/ball-physics\.js'/.test(readSrc('match-tick.js')),
    'C-08 必须复用既有 playerMotionList 适配器');
  // 行为：生产 Tick 触发 Contact。
  const t = contactTick();
  assertEquals(t.matchCore.ball.lastTouchPlayerId, 'p1');
  assert(t.matchCore.ball.contacting.includes('p1'), 'contacting 必须包含接触球员');
});

// ===========================================================================
// CP-02 Contact Actually Fires
// ===========================================================================
test('CP-02. Contact Actually Fires：满足既有 C-03 接触条件时生产 Tick 发生 Contact', () => {
  const t = contactTick();
  const before = transitCore({ playerX: 0.30, duration: 3 });
  // 球位被去穿透（相对自由积分）→ 证明 Contact Resolution 已执行。
  assert(dist(t.matchCore.ball.position, before.ball.position) > 1e-6, 'Contact 必须改变 Ball Position');
  assertEquals(t.matchCore.ball.lastTouchPlayerId, 'p1', 'Contact 必须写 lastTouchPlayerId');
  assert(t.matchCore.ball.contacting.length >= 1, 'Contact 必须更新 contacting[]');
});

// ===========================================================================
// CP-03 Player Position Timestamp（post-PLAYER_MOVEMENT）
// ===========================================================================
test('CP-03. Player Position Timestamp：Contact 使用 PLAYER_MOVEMENT 后的 positionOnPitch', () => {
  const t = contactTick();
  const playerAfter = t.matchCore.players.find((p) => p.playerId === 'p1').positionOnPitch;
  // PLAYER_MOVEMENT 确实推进了球员（证明位置是 Tick N 的最新值，而非 Tick N-1）。
  assert(playerAfter.x !== 0.30, 'PLAYER_MOVEMENT 必须推进 Player Position');
  // 去穿透落点 = 球员（post-movement）位置 ± CONTACT_RADIUS。
  assert(Math.abs(dist(t.matchCore.ball.position, playerAfter) - RADIUS) < 1e-9,
    `Contact 落点必须基于 post-PLAYER_MOVEMENT 位置（|ball-player| == CONTACT_RADIUS=${RADIUS}）`);
});

// ===========================================================================
// CP-04 Non-Completion Contact
// ===========================================================================
test('CP-04. Non-Completion Contact：非完成 Tick 执行 Physics → Contact 可发生', () => {
  const t = contactTick();
  assertEquals(t.applied.continuousMovement, true);
  assertEquals(t.applied.continuousMovementCompleted, false, '必须为非完成 Tick');
  assert(t.matchCore.ball.lastTouchPlayerId === 'p1', '非完成 Tick 必须可 Contact');
  assert(t.tick.stages.includes(TICK_STAGES.CONTINUOUS_TRANSIT));
});

// ===========================================================================
// CP-05 Completion No Contact
// ===========================================================================
test('CP-05. Completion No Contact：完成 Tick 不执行 Physics → 不 Contact，C-23 完成落点', () => {
  const t = tick(transitCore({ playerX: 0.30, duration: 1 }), { tickIndex: 0, deltaTime: 1 });
  assertEquals(t.applied.continuousMovementCompleted, true, '必须为完成 Tick');
  assertEquals(t.matchCore.ball.lastTouchPlayerId, null, '完成 Tick 不得产生 Last Touch');
  assertEquals(t.matchCore.ball.contacting, [], '完成 Tick 不得产生 contacting[]');
  assertEquals(t.matchCore.ball.position, { x: 0.8, y: 0.5 }, '完成落点必须 === transit.to（C-23）');
  assertEquals(t.matchCore.ball.state, BS.CONTROLLED);
  assertEquals(t.matchCore.ball.transit, undefined, 'Transit 必须正常完成');
});

// ===========================================================================
// CP-06 Position Resolution
// ===========================================================================
test('CP-06. Position Resolution：Contact 按既有 C-03 规则改写 Ball Position', () => {
  const t = contactTick();
  const playerAfter = t.matchCore.players.find((p) => p.playerId === 'p1').positionOnPitch;
  const p = t.matchCore.ball.position;
  // 去穿透到交互半径处：|ball - player| == RADIUS，且球在球员左侧（法向 −x）。
  assert(Math.abs(dist(p, playerAfter) - RADIUS) < 1e-9);
  assert(p.x < playerAfter.x, '既有 C-03 去穿透：球被推出到球员左侧半径处');
  assert(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, 'Ball Position 必须在场地内');
});

// ===========================================================================
// CP-07 Velocity Resolution
// ===========================================================================
test('CP-07. Velocity Resolution：Contact 按既有 C-03 规则改写 Ball Velocity', () => {
  // 慢速非完成 Tick（duration=2, dt=0.5）：逼近 +x 的球撞到球员 → 法向反射为 −x。
  const hit = tick(transitCore({ playerX: 0.34, duration: 2 }), { tickIndex: 0, deltaTime: 0.5 });
  assert(hit.matchCore.ball.lastTouchPlayerId === 'p1', '该场景必须发生 Contact');
  assert(hit.matchCore.ball.velocity.x < 0, '既有 C-03 法向反射：速度必须反向');
  assert(Number.isFinite(hit.matchCore.ball.velocity.x) && Number.isFinite(hit.matchCore.ball.velocity.y));
  // 对照：球员远离球路（无 Contact）→ 速度保持 +x。
  const miss = tick(transitCore({ playerX: 0.95, duration: 2 }), { tickIndex: 0, deltaTime: 0.5 });
  assertEquals(miss.matchCore.ball.lastTouchPlayerId, null);
  assert(miss.matchCore.ball.velocity.x > 0, '无 Contact 时速度保持 +x（证明反射由 Contact 触发）');
});

// ===========================================================================
// CP-08 Last Touch
// ===========================================================================
test('CP-08. Last Touch：Contact 写 lastTouchPlayerId；无 Contact 不得凭空产生', () => {
  assertEquals(contactTick().matchCore.ball.lastTouchPlayerId, 'p1');
  const miss = tick(transitCore({ playerX: 0.95, duration: 2 }), { tickIndex: 0, deltaTime: 0.5 });
  assertEquals(miss.matchCore.ball.lastTouchPlayerId, null, '无 Contact 不得产生 Last Touch');
});

// ===========================================================================
// CP-09 No Possession
// ===========================================================================
test('CP-09. No Possession：Contact 本身不得产生 Possession / control', () => {
  const t = contactTick();
  assertEquals(t.matchCore.ball.control, null, 'Contact 不得写 control');
  assertEquals(t.matchCore.ball.possessingTeamId, null, 'Contact 不得写 possessingTeamId');
  assertEquals(t.matchCore.ball.state, BS.IN_TRANSIT);
});

// ===========================================================================
// CP-10 Transit Preserved
// ===========================================================================
test('CP-10. Transit Preserved：Contact 前后 Transit Truth 保持正确（不被中断 / 修改）', () => {
  const t = contactTick();
  const tr = t.matchCore.ball.transit;
  assertEquals(tr.from, { x: 0.2, y: 0.5 }, 'from 必须保持');
  assertEquals(tr.to, { x: 0.8, y: 0.5 }, 'to 必须保持');
  assertEquals(tr.duration, 3, 'duration 必须保持');
  assertEquals(tr.elapsed, 1, 'elapsed 必须正常推进');
  assertEquals(tr.progress, 1 / 3, 'progress 必须正常推进');
  assertEquals(t.matchCore.ball.state, BS.IN_TRANSIT, 'Contact 不得中断 Transit');
  assertEquals(t.applied.continuousMovementCompleted, false, 'Contact 不得强制完成 Transit');
});

// ===========================================================================
// CP-11 Contacting Lifecycle
// ===========================================================================
test('CP-11. Contacting Lifecycle：contacting[] 为 Tick-Transient Derived（不升格为 Truth）', () => {
  const hit = contactTick().matchCore.ball;
  assert(Array.isArray(hit.contacting) && hit.contacting.includes('p1'));
  // 唯一性 / 排序（C-03 行为）。
  assertEquals(hit.contacting, Array.from(new Set(hit.contacting)).sort());
  // Tick-Transient：不同 Tick / 无接触 Core 重新计算，不残留。
  const miss = tick(transitCore({ playerX: 0.95, duration: 2 }), { tickIndex: 0, deltaTime: 0.5 }).matchCore.ball;
  assertEquals(miss.contacting, [], 'contacting[] 必须每 Tick 重算（transient）');
  // 不得新增第二 Contact Truth 字段。
  for (const k of ['contactTruth', 'contactResult', 'contacts']) {
    assert(!(k in hit), `不得新增第二 Contact Truth：${k}`);
  }
  // 无 ContactResult Schema 落地（生产源码守卫）。
  assert(!/ContactResult/.test(TICK_SRC) && !/ContactResult/.test(C39_SRC), '不得新增 ContactResult Schema');
});

// ===========================================================================
// CP-12 Determinism
// ===========================================================================
test('CP-12. Determinism：相同 MatchCore + Tick Inputs → 结果完全一致', () => {
  const r1 = contactTick();
  const r2 = contactTick();
  assertEquals(JSON.stringify(r1.matchCore), JSON.stringify(r2.matchCore));
  assertEquals(JSON.stringify(r1.events), JSON.stringify(r2.events));
  assertEquals(JSON.stringify(r1.tick.stages), JSON.stringify(r2.tick.stages));
});

// ===========================================================================
// CP-13 No Contact Duplicate
// ===========================================================================
test('CP-13. No Contact Duplicate：单一 Production Contact 边界（无第二份 Contact）', () => {
  // C-08 只调用一次 C-39；C-39 只调用一次 stepBallPhysics。
  const tickCalls = TICK_SRC.match(/advanceContinuousBallMovement\(/g) || [];
  assertEquals(tickCalls.length, 1, 'C-08 必须只有一个 CONTINUOUS_TRANSIT → C-39 调用点');
  const physCalls = C39_SRC.match(/stepBallPhysics\(/g) || [];
  assertEquals(physCalls.length, 1, 'C-39 必须只有一个 stepBallPhysics 调用点');
  // 无独立 CONTACT Stage。
  assert(!Object.values(TICK_STAGES).includes('contact'), '不得新增 CONTACT Stage');
  // 行为：单球员单次接触（contacting 唯一）。
  const ball = contactTick().matchCore.ball;
  assertEquals(ball.contacting, ['p1']);
});

// ===========================================================================
// CP-14 Stage Order
// ===========================================================================
test('CP-14. Stage Order：PLAYER_MOVEMENT 先于 CONTINUOUS_TRANSIT', () => {
  const t = contactTick();
  const stages = t.tick.stages;
  assert(stages.indexOf(TICK_STAGES.PLAYER_MOVEMENT) >= 0, '必须存在 PLAYER_MOVEMENT Stage');
  assert(stages.indexOf(TICK_STAGES.PLAYER_MOVEMENT) < stages.indexOf(TICK_STAGES.CONTINUOUS_TRANSIT),
    'PLAYER_MOVEMENT 必须先于 CONTINUOUS_TRANSIT');
});

// ===========================================================================
// CP-15 Interaction Isolation
// ===========================================================================
test('CP-15. Interaction Isolation：Contact 接线不改变既有 Interaction Contract', () => {
  // 源码：Interaction Resolution 不引用 Contact 几何 / contacting / lastTouch。
  assert(!/ball-contact|contacting|lastTouchPlayerId|computeBallContact/.test(INTERACTION_SRC),
    'Interaction Resolution 不得新增 Contact 依赖');
  // 行为：无 Transit 的 DRIBBLE Tick 与 Contact 接线无关，Interaction 正常。
  const core = {
    worldId: 'w_cp47', season: 1, matchId: 'm_cp47b', ruleVersion: 'v',
    teams: { home: H, away: A },
    clock: { simulationTime: 0, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    tactical: { [H]: tac(), [A]: tac() },
    ball: { position: { x: 0.4, y: 0.5 }, control: 'h_a', possessingTeamId: H, state: BS.CONTROLLED, contacting: [], lastTouchPlayerId: null },
    players: [mk('h_a', H, 'MF', 0.4, 0.5)],
  };
  const inst = { actionType: 'DRIBBLE', actorId: 'h_a', intent: 'FORWARD', target: { type: 'SPACE', x: 0.45, y: 0.50 }, riskIntent: { level: 'MEDIUM', value: 0.5 } };
  const t = runMatchTick(core, { tickIndex: 0, actionInstance: inst, seed: 's0', interactionSequence: 0 });
  assert(t.interactionResult && t.interactionResult.ok === true, 'Interaction 必须正常 resolve');
  assertEquals(t.applied.interaction, true, 'Interaction 必须正常 integrate');
});