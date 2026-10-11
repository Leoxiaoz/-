/**
 * Step 39F-M-C-04 —— Ball → Tactical Context → Player Situation → Decision 只读因果性测试。
 *
 * 覆盖（§7/§8/§9/§12）：
 * - Tactical Context / Player Situation / Decision 对 BallState 只读；
 * - ball position / velocity / speed / state / lastTouch 的因果传导；
 * - 球员位置变化对「球员相对球几何」的因果；
 * - deterministic；无 Math.random；
 * - 无第二套 Ball Truth；无反向依赖；无循环依赖；无 Decision→Physics / Physics→Decision；
 * - PASS / SHOT transit 只读兼容。
 *
 * 红线：本测试不修改任何生产行为；不接 Production Loop / Renderer；不实现任何 Resolution。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildTacticalContext } from '../src/core/match/tactical-context.js';
import { buildPlayerSituation, dist } from '../src/core/match/player-situation.js';
import {
  deriveBallFacts, deriveBallRelation, playerVelocityFromMovement,
} from '../src/core/match/ball-facts.js';
import { decidePlayerAction } from '../src/core/match/decision-pipeline.js';
import { BALL_STATE } from '../src/core/match/ball-physics-config.js';
import { mkCore, H, A } from './movement-fixtures.js';

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');

/** 相对导入的原模块名集合。 */
function importsOf(name) {
  const re = /from\s+['"]\.\/([a-z0-9-]+)\.js['"]/g;
  const found = new Set();
  let m;
  while ((m = re.exec(readSrc(name))) !== null) found.add(m[1]);
  return found;
}

/** 在 base core 上覆写 ball 字段（保留其余）。 */
function withBall(core, overrides) {
  return { ...core, ball: { ...core.ball, ...overrides } };
}

/** 覆盖指定球员坐标（返回新 core）。 */
function movePlayer(core, playerId, x, y) {
  return {
    ...core,
    players: core.players.map((p) => (p.playerId === playerId
      ? { ...p, positionOnPitch: { x, y } } : p)),
  };
}

// ===========================================================================
// A. Tactical Context —— read-only / ball 事实一致
// ===========================================================================

test('BC-01. Tactical Context 只读：不修改 MatchCore', () => {
  const core = withBall(mkCore(), { velocity: { x: 0.1, y: -0.05 }, state: BALL_STATE.FREE, lastTouchPlayerId: 'h_mf1' });
  const before = JSON.stringify(core);
  buildTacticalContext(core, H, { playerId: 'h_mf1' });
  assertEquals(JSON.stringify(core), before, 'MatchCore 不应被 Context 修改');
});

test('BC-02. Context ball position/velocity 与 MatchCore.ball 完全一致', () => {
  const core = withBall(mkCore(), { velocity: { x: 0.2, y: 0.1 }, state: BALL_STATE.IN_TRANSIT });
  const ctx = buildTacticalContext(core, H);
  assertEquals(ctx.ballFacts.position, core.ball.position);
  assertEquals(ctx.ballFacts.velocity, core.ball.velocity);
  assertEquals(ctx.ballVelocity, core.ball.velocity);
  assertEquals(ctx.ballSpeed, Math.hypot(0.2, 0.1));
  assertEquals(ctx.ballState, BALL_STATE.IN_TRANSIT);
});

test('BC-03. Context 不拥有 authoritative ball state（无 ball 键 / 快照非引用）', () => {
  const core = withBall(mkCore(), { velocity: { x: 0.1, y: 0 } });
  const ctx = buildTacticalContext(core, H);
  assert(!('ball' in ctx), 'Context 不得暴露 ball 原始对象');
  assert(ctx.ballFacts !== core.ball, 'ballFacts 必须为派生快照，非 MatchCore.ball 引用');
  const saved = core.ball.position.x;
  ctx.ballFacts.position.x = -999;
  assertEquals(core.ball.position.x, saved, '修改快照不得回写 MatchCore');
});

test('BC-04. Context 确定性：同一 MatchCore 两次生成 JSON 完全一致', () => {
  const core = withBall(mkCore({ movement: { possession: { teamId: H, sinceTime: 9 } } }), { velocity: { x: 0.3, y: -0.1 }, state: BALL_STATE.FREE });
  assertEquals(
    JSON.stringify(buildTacticalContext(core, H, { playerId: 'h_mf1' })),
    JSON.stringify(buildTacticalContext(core, H, { playerId: 'h_mf1' })),
  );
});

test('BC-05. Context 球员相对球几何（playerId）：distance 正确', () => {
  const core = withBall(mkCore(), { velocity: { x: 0, y: 0 } });
  const ctx = buildTacticalContext(core, H, { playerId: 'h_mf1' });
  const p = core.players.find((x) => x.playerId === 'h_mf1');
  assert(ctx.ballRelation, '提供 playerId 时应派生 ballRelation');
  assertEquals(ctx.ballRelation.distance, dist(p.positionOnPitch, core.ball.position));
});

// ===========================================================================
// B. Player Situation —— read-only / 消费球事实
// ===========================================================================

test('BC-06. Player Situation 只读：不修改 MatchCore', () => {
  const core = withBall(mkCore(), { velocity: { x: 0.15, y: 0.05 }, state: BALL_STATE.FREE, lastTouchPlayerId: 'a_mf1' });
  const before = JSON.stringify(core);
  buildPlayerSituation(core, 'h_mf1');
  assertEquals(JSON.stringify(core), before, 'MatchCore 不应被 Situation 修改');
});

test('BC-07. Situation 消费球事实：position/velocity/speed/state/lastTouch 与 MatchCore.ball 一致', () => {
  const core = withBall(mkCore(), { velocity: { x: 0.25, y: -0.15 }, state: BALL_STATE.FREE, lastTouchPlayerId: 'a_mf1' });
  const s = buildPlayerSituation(core, 'h_mf1');
  assertEquals(s.ballState.position, core.ball.position);
  assertEquals(s.ballState.velocity, core.ball.velocity);
  assertEquals(s.ballState.speed, Math.hypot(0.25, -0.15));
  assertEquals(s.ballState.state, BALL_STATE.FREE);
  assertEquals(s.ballState.lastTouchPlayerId, 'a_mf1');
});

test('BC-08. Situation 不拥有 authoritative ball state（快照非引用 / 无 matchCore 泄漏）', () => {
  const core = withBall(mkCore(), { velocity: { x: 0.1, y: 0 } });
  const s = buildPlayerSituation(core, 'h_mf1');
  assert(!('matchCore' in s) && !('_state' in s), '不得暴露 MatchCore 引用');
  assert(s.ballState !== core.ball, 'ballState 必须为派生快照');
  const saved = core.ball.position.y;
  s.ballState.position.y = -999;
  assertEquals(core.ball.position.y, saved, '修改快照不得回写 MatchCore');
});

test('BC-09. Situation 确定性：相同 BallState + PlayerState 两次生成 JSON 完全一致', () => {
  const core = withBall(mkCore(), { velocity: { x: 0.2, y: 0.1 }, state: BALL_STATE.FREE });
  assertEquals(
    JSON.stringify(buildPlayerSituation(core, 'h_mf1')),
    JSON.stringify(buildPlayerSituation(core, 'h_mf1')),
  );
});

test('BC-10. Situation 暴露球员相对球几何事实', () => {
  const core = withBall(mkCore(), { velocity: { x: 0.3, y: 0 } });
  const s = buildPlayerSituation(core, 'h_mf1');
  const rel = s.spatialContext.ballRelation;
  assert(rel, 'spatialContext.ballRelation 必须存在');
  const p = core.players.find((x) => x.playerId === 'h_mf1');
  assertEquals(rel.relativePosition, {
    x: core.ball.position.x - p.positionOnPitch.x,
    y: core.ball.position.y - p.positionOnPitch.y,
  });
  assertEquals(rel.distance, dist(p.positionOnPitch, core.ball.position));
  assert(typeof rel.movingTowardPlayer === 'boolean');
});

// ===========================================================================
// C. Decision —— 只读消费（Decision Geometry 事实来自 Situation）
// ===========================================================================

test('BC-11. Decision 只读：decidePlayerAction 不修改 MatchCore / 不写 BallState', () => {
  const core = withBall(mkCore(), { velocity: { x: 0.1, y: 0 }, state: BALL_STATE.FREE });
  const before = JSON.stringify(core);
  decidePlayerAction(core, 'h_mf1', { seed: 'causality', decisionSequence: 1 });
  assertEquals(JSON.stringify(core), before, 'Decision 不应修改 MatchCore.ball');
});

test('BC-12. Decision 确定性：相同输入两次 decision 完全一致', () => {
  const core = withBall(mkCore(), { velocity: { x: 0.1, y: 0 }, state: BALL_STATE.FREE });
  const a = decidePlayerAction(core, 'h_mf1', { seed: 'causality', decisionSequence: 1 });
  const b = decidePlayerAction(core, 'h_mf1', { seed: 'causality', decisionSequence: 1 });
  assertEquals(a.decision, b.decision);
  assertEquals(a.actionInstance, b.actionInstance);
});

// ===========================================================================
// D. Causality（§8 Case 1–6）
// ===========================================================================

test('BC-C1. 球位置改变 → Context position 改变 → Situation relative position 改变 → 几何改变', () => {
  const base = mkCore();
  const near = withBall(base, { position: { x: 0.45, y: 0.18 } });
  const far = withBall(base, { position: { x: 0.90, y: 0.18 } });

  const cN = buildTacticalContext(near, H, { playerId: 'h_mf1' });
  const cF = buildTacticalContext(far, H, { playerId: 'h_mf1' });
  assert(cN.ballFacts.position.x !== cF.ballFacts.position.x, 'Context position 应随球位置改变');

  const sN = buildPlayerSituation(near, 'h_mf1');
  const sF = buildPlayerSituation(far, 'h_mf1');
  assert(
    sN.spatialContext.ballRelation.distance < sF.spatialContext.ballRelation.distance,
    '球更近 → 相对距离应更小',
  );
  assertEquals(sN.spatialContext.ballRelation.relativePosition.x, 0.45 - 0.42);
  assertEquals(sF.spatialContext.ballRelation.relativePosition.x, 0.90 - 0.42);
});

test('BC-C2. 球速度改变 → Context speed 改变 → Situation speed / relativeVelocity 改变', () => {
  const base = mkCore();
  const slow = withBall(base, { velocity: { x: 0.05, y: 0 } });
  const fast = withBall(base, { velocity: { x: 0.40, y: 0 } });

  assert(buildTacticalContext(fast, H).ballSpeed > buildTacticalContext(slow, H).ballSpeed, 'Context ballSpeed 应随速度改变');

  const sSlow = buildPlayerSituation(slow, 'h_mf1');
  const sFast = buildPlayerSituation(fast, 'h_mf1');
  assert(sFast.ballState.speed > sSlow.ballState.speed, 'Situation ball speed 应改变');
  assert(
    sFast.spatialContext.ballRelation.relativeVelocity.x > sSlow.spatialContext.ballRelation.relativeVelocity.x,
    'relative velocity 应随球速度改变',
  );
});

test('BC-C3. 球状态 IN_TRANSIT → FREE → Context / Situation 可见新状态', () => {
  const base = mkCore();
  const transit = withBall(base, { state: BALL_STATE.IN_TRANSIT });
  const free = withBall(base, { state: BALL_STATE.FREE });
  assertEquals(buildTacticalContext(transit, H).ballState, BALL_STATE.IN_TRANSIT);
  assertEquals(buildTacticalContext(free, H).ballState, BALL_STATE.FREE);
  assertEquals(buildPlayerSituation(transit, 'h_mf1').ballState.state, BALL_STATE.IN_TRANSIT);
  assertEquals(buildPlayerSituation(free, 'h_mf1').ballState.state, BALL_STATE.FREE);
});

test('BC-C4. lastTouchPlayerId 改变 → Context / Situation 可读取', () => {
  const base = mkCore();
  const byH = withBall(base, { lastTouchPlayerId: 'h_fw1' });
  const byA = withBall(base, { lastTouchPlayerId: 'a_df1' });
  assertEquals(buildTacticalContext(byH, H).lastTouchPlayerId, 'h_fw1');
  assertEquals(buildTacticalContext(byA, H).lastTouchPlayerId, 'a_df1');
  assertEquals(buildPlayerSituation(byH, 'h_mf1').ballState.lastTouchPlayerId, 'h_fw1');
  assertEquals(buildPlayerSituation(byA, 'h_mf1').ballState.lastTouchPlayerId, 'a_df1');
});

test('BC-C5. 球员位置改变但 BallState 不变 → ballPosition 不变 / 相对几何改变', () => {
  const base = mkCore();
  const moved = movePlayer(base, 'h_mf1', 0.60, 0.50);
  const s1 = buildPlayerSituation(base, 'h_mf1');
  const s2 = buildPlayerSituation(moved, 'h_mf1');
  assertEquals(s1.ballState.position, s2.ballState.position, '球位置不应随球员变化');
  assert(
    s1.spatialContext.ballRelation.distance !== s2.spatialContext.ballRelation.distance,
    '球员相对球几何应随球员位置改变',
  );
});

test('BC-C6. BallState 不变 → Context / Situation / 几何 完全 deterministic', () => {
  const core = withBall(mkCore(), { velocity: { x: 0.2, y: -0.1 }, state: BALL_STATE.FREE, lastTouchPlayerId: 'h_mf1' });
  assertEquals(
    JSON.stringify(buildTacticalContext(core, H, { playerId: 'h_mf1' })),
    JSON.stringify(buildTacticalContext(core, H, { playerId: 'h_mf1' })),
  );
  assertEquals(
    JSON.stringify(buildPlayerSituation(core, 'h_mf1')),
    JSON.stringify(buildPlayerSituation(core, 'h_mf1')),
  );
});

test('BC-C7. deriveBallFacts 纯派生：两次派生结果一致且与 MatchCore.ball 对齐', () => {
  const core = withBall(mkCore(), { velocity: { x: 0.1, y: 0.2 }, state: BALL_STATE.FREE });
  const a = deriveBallFacts(core);
  const b = deriveBallFacts(core);
  assertEquals(a, b);
  assertEquals(a.position, core.ball.position);
  assertEquals(a.velocity, core.ball.velocity);
});

// ===========================================================================
// E. Architecture Guard（§7 K–O / §9）
// ===========================================================================

test('BC-13. Context / Situation / Decision 路径不使用 Math.random', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Causality 路径不应调用 Math.random'); };
  try {
    const core = withBall(mkCore(), { velocity: { x: 0.1, y: 0 }, state: BALL_STATE.FREE });
    deriveBallFacts(core);
    deriveBallRelation(deriveBallFacts(core), { x: 0.4, y: 0.5 });
    playerVelocityFromMovement(core, 'h_mf1');
    buildTacticalContext(core, H, { playerId: 'h_mf1' });
    buildPlayerSituation(core, 'h_mf1');
    decidePlayerAction(core, 'h_mf1', { seed: 'x', decisionSequence: 1 });
  } finally {
    Math.random = original;
  }
});

test('BC-14. 无反向依赖：Context / Situation / Decision 不直接调用 Ball Physics', () => {
  for (const f of ['tactical-context.js', 'player-situation.js', 'ball-facts.js', 'decision-pipeline.js', 'decision-candidates.js', 'action-definitions.js']) {
    assert(!importsOf(f).has('ball-physics'), `${f} 不得依赖 ball-physics`);
  }
});

test('BC-15. 无 Physics → Decision 反向调用', () => {
  for (const f of ['ball-physics.js', 'ball-contact.js', 'ball-boundary.js']) {
    const imps = importsOf(f);
    assert(!imps.has('decision-pipeline') && !imps.has('decision-candidates') && !imps.has('action-definitions'), `${f} 不得反向调用 Decision`);
  }
});

test('BC-16. 无循环依赖（causality 相关模块导入图无环）', () => {
  const graph = {
    'ball-facts.js': importsOf('ball-facts.js'),
    'ball-contact.js': importsOf('ball-contact.js'),
    'tactical-context.js': importsOf('tactical-context.js'),
    'player-situation.js': importsOf('player-situation.js'),
    'ball-physics.js': importsOf('ball-physics.js'),
    'decision-pipeline.js': importsOf('decision-pipeline.js'),
  };
  const seen = new Set();
  const stack = new Set();
  const visit = (node) => {
    if (stack.has(node)) throw new Error(`检测到循环依赖：${node}`);
    if (seen.has(node)) return;
    stack.add(node);
    for (const dep of graph[node] ?? []) {
      if (dep in graph) visit(dep);
    }
    stack.delete(node);
    seen.add(node);
  };
  for (const n of Object.keys(graph)) visit(n);
});

test('BC-17. 无 Math.random 源码调用（causality 模块）', () => {
  for (const f of ['ball-facts.js', 'tactical-context.js', 'player-situation.js', 'decision-pipeline.js', 'decision-candidates.js', 'action-definitions.js']) {
    // 匹配真实调用 Math.random(...)，不匹配文档注释中的字面词。
    assert(!/Math\.random\s*\(/.test(readSrc(f)), `${f} 出现 Math.random 调用`);
  }
});

test('BC-18. Context / Situation 不复制为长期 authoritatives（无顶层 ball 副本）', () => {
  const core = withBall(mkCore(), { velocity: { x: 0.1, y: 0 } });
  const ctx = buildTacticalContext(core, H);
  const s = buildPlayerSituation(core, 'h_mf1');
  assert(!('ball' in ctx), 'Context 无 ball 顶层副本');
  assert(!('matchCore' in s) && !('_state' in s), 'Situation 无 MatchCore 泄漏');
  assert(s.ballState === s.ballState && typeof s.ballState === 'object', 'ballState 仅为快照');
});

// ===========================================================================
// F. PASS / SHOT 兼容（transit 只读消费）
// ===========================================================================

test('BC-19. transit metadata 只读消费：不修改 MatchCore，inTransit 正确', () => {
  const core = withBall(mkCore(), {
    state: BALL_STATE.IN_TRANSIT,
    transit: { from: { x: 0.4, y: 0.5 }, to: { x: 0.6, y: 0.5 }, duration: 0.5 },
  });
  const before = JSON.stringify(core);
  const facts = deriveBallFacts(core);
  assertEquals(facts.inTransit, true);
  assertEquals(facts.state, BALL_STATE.IN_TRANSIT);
  assertEquals(JSON.stringify(core), before, 'transit 消费不得修改 MatchCore');
  // Context 仍据此判定 TRANSITION（既有语义不变）
  assertEquals(buildTacticalContext(core, H).phase, 'TRANSITION');
});

test('BC-20. PASS / SHOT 模块未与 ball-facts 耦合（避免改变既有行为）', () => {
  for (const f of ['pass-resolution.js', 'shot-resolution.js', 'pass-state-update.js', 'shot-state-update.js']) {
    const imps = importsOf(f);
    assert(!imps.has('ball-facts') && !imps.has('ball-physics'), `${f} 不应耦合 ball-facts / ball-physics`);
  }
});

test('BC-21. A 队视角同样只读且因果（对称性）', () => {
  const base = mkCore({ ballControl: 'a_mf3', possessingTeamId: A });
  const c = withBall(base, { velocity: { x: -0.2, y: 0 } });
  const before = JSON.stringify(c);
  const ctx = buildTacticalContext(c, A, { playerId: 'a_mf3' });
  const s = buildPlayerSituation(c, 'a_mf3');
  assertEquals(JSON.stringify(c), before);
  assertEquals(ctx.ballFacts.velocity, c.ball.velocity);
  assertEquals(s.ballState.velocity, c.ball.velocity);
});