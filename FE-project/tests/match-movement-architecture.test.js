/**
 * Step 39F-M-C —— Architecture 测试（类别 G）。
 * 覆盖：Movement 不写 Score / Stats / Growth / Training / Save；不移动球；不使用 Math.random；
 * 纯函数（不改输入）；PositionOnPitch 是 MatchCore truth；L0/L1/L2；位置不变量。
 */

import { test, assert, assertEquals } from './harness.js';
import { updateMovement, initMovementState } from '../src/core/match/movement-update.js';
import { H, mkCore } from './movement-fixtures.js';

const TOP_LEVEL_ALLOWED = new Set([
  'worldId', 'season', 'matchId', 'ruleVersion', 'teams', 'clock', 'score', 'ball', 'players', 'tactical', 'movement',
]);

test('Architecture：updateMovement 只改 players 与 movement，其余顶层字段不变', () => {
  const core = mkCore();
  const after = updateMovement(core, 0.5);
  assertEquals(after.score, core.score);
  assertEquals(after.clock, core.clock);
  assertEquals(after.ball, core.ball, 'Movement 不应移动球');
  assertEquals(after.tactical, core.tactical);
  for (const k of Object.keys(after)) assert(TOP_LEVEL_ALLOWED.has(k), `出现非预期顶层字段 ${k}`);
});

test('Architecture：不写 Growth / Training / Save / Stats 字段', () => {
  const after = updateMovement(mkCore(), 0.5);
  for (const k of ['growth', 'training', 'save', 'stats', 'development', 'events']) {
    assert(!(k in after), `不应写入 ${k}`);
  }
});

test('Architecture：纯函数，不修改输入 MatchCore', () => {
  const core = mkCore();
  const before = JSON.stringify(core);
  updateMovement(core, 1);
  assertEquals(JSON.stringify(core), before);
});

test('Architecture：不使用 Math.random（运行时守卫）', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Movement 不应调用 Math.random'); };
  try {
    let c = initMovementState(mkCore());
    for (let i = 0; i < 10; i += 1) c = updateMovement(c, 0.5);
    assert(true);
  } finally {
    Math.random = original;
  }
});

test('Architecture：PositionOnPitch 是 MatchCore truth，Movement 后仍合法', () => {
  let c = initMovementState(mkCore());
  for (let i = 0; i < 120; i += 1) c = updateMovement(c, 0.3);
  for (const p of c.players) {
    if (p.teamId !== H) continue;
    assert(p.positionOnPitch && Number.isFinite(p.positionOnPitch.x) && Number.isFinite(p.positionOnPitch.y));
    assert(p.positionOnPitch.x >= 0 && p.positionOnPitch.x <= 1);
    assert(p.positionOnPitch.y >= 0 && p.positionOnPitch.y <= 1);
  }
});

test('Architecture：L2（完整 Decision hook）只对极少数球员触发', () => {
  const core = mkCore();
  const collected = [];
  updateMovement(core, 0.5, { onFullDecision: (id) => collected.push(id) });
  assert(collected.length <= 3, `L2 触发过多：${collected.length}`);
});

test('Architecture：未初始化 MovementState 也能安全更新', () => {
  const core = mkCore();
  assert(!core.movement);
  const after = updateMovement(core, 0.5);
  assert(after.movement && after.movement.players);
});