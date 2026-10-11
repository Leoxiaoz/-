/**
 * Step 39F-M-C-02 —— Headless Movement Match Loop Harness 测试（A–N）。
 * 目标：验证 Movement 链在 90 分钟 × 22 人下长稳 / 确定 / 有界 / 不振荡 / 因果可读。
 * 红线：不接 Season/Schedule/Competition/Production Loop；不改 Score/Stats/Growth/Training/Save/Schema；
 *       不改 PASS/SHOT；不使用 Math.random。
 */

import { test, assert, assertEquals } from './harness.js';
import {
  buildHarnessCore, runHarness, analyzeStability, analyzeShape, meanDistToBall,
} from './movement-harness.js';
import { buildPlayerSituation } from '../src/core/match/player-situation.js';
import { LOCOMOTION } from '../src/core/match/movement-config.js';
import { H } from './movement-fixtures.js';

const DT = 0.5;
const MINUTES = 90;

function noViolations(violations, type) {
  const hit = violations.filter((v) => !type || v.type === type);
  assert(hit.length === 0, `发现违规 ${type ?? 'any'}：${JSON.stringify(hit.slice(0, 3))}`);
}

// ---------------------------------------------------------------- A + B + D + E + F + G
test('A/B/D/E/F/G：90 分钟 × 22 人长稳 —— 无 NaN/越界/瞬移', () => {
  const run = runHarness(buildHarnessCore(), { dt: DT, durationMinutes: MINUTES });
  noViolations(run.violations);
  assertEquals(run.stats.ticks, 180);
  assertEquals(run.stats.playerTicks, 22 * 180);
  assertEquals(run.finalCore.clock.simulationTime, 90);
  assertEquals(run.finalCore.players.length, 22);
});

test('E：速度始终有限且在配置范围内', () => {
  const run = runHarness(buildHarnessCore(), { dt: DT, durationMinutes: MINUTES });
  noViolations(run.violations, 'speed-nonfinite');
  noViolations(run.violations, 'speed-out-of-range');
  for (const st of Object.values(run.finalCore.movement.players)) {
    assert(st.speed >= LOCOMOTION.MIN_SPEED && st.speed <= LOCOMOTION.MAX_SPEED);
  }
});

test('G：位移约束 speed×dt（含到达半径吸附）', () => {
  const run = runHarness(buildHarnessCore(), { dt: DT, durationMinutes: MINUTES });
  noViolations(run.violations, 'teleport');
});

// ---------------------------------------------------------------- C determinism
test('C：同一输入两次运行 —— 位置 / Intent / Target / Context / Shape 完全一致', () => {
  const a = runHarness(buildHarnessCore({ seed: 's1' }), { dt: DT, durationMinutes: MINUTES, record: true });
  const b = runHarness(buildHarnessCore({ seed: 's1' }), { dt: DT, durationMinutes: MINUTES, record: true });
  assertEquals(JSON.stringify(a.history), JSON.stringify(b.history));
  assertEquals(a.stats.ticks, b.stats.ticks);
});

test('C：不同 seed —— Movement 不消费 RNG，因此结果一致（记录该事实）', () => {
  const a = runHarness(buildHarnessCore({ seed: 's1' }), { dt: DT, durationMinutes: MINUTES, record: true });
  const b = runHarness(buildHarnessCore({ seed: 's9' }), { dt: DT, durationMinutes: MINUTES, record: true });
  assertEquals(JSON.stringify(a.history.positions), JSON.stringify(b.history.positions));
});

// ---------------------------------------------------------------- H shape stability
test('H：Shape 长稳 —— 不聚球 / 不无限前压后撤 / 不崩溃', () => {
  const ballPos = { x: 0.5, y: 0.5 };
  const run = runHarness(buildHarnessCore({ ballPos }), { dt: DT, durationMinutes: MINUTES, record: true });
  const sH = analyzeShape(run.history, H);
  assert(sH.tailSpreadRange < 0.05, `后半段 spread 抖动过大 ${sH.tailSpreadRange}`);
  assert(sH.tailMeanXRange < 0.08, `后半段整体位置漂移过大 ${sH.tailMeanXRange}`);
  assert(sH.minSpread > 0.1, `结构塌陷 spread=${sH.minSpread}`);
  assert(sH.maxMeanX < 0.9 && sH.minMeanX > 0.1, `整体越界 ${sH.minMeanX}~${sH.maxMeanX}`);
  const d = meanDistToBall(run.history, ballPos, H).slice(90);
  assert(Math.min(...d) > 0.05, `球员过度聚集到球附近 min=${Math.min(...d)}`);
});

// ---------------------------------------------------------------- I + J oscillation
test('I：无 Target 振荡（无 A→B→A→B 交替）', () => {
  const run = runHarness(buildHarnessCore(), { dt: DT, durationMinutes: MINUTES, record: true });
  const st = analyzeStability(run.history);
  assertEquals(st.alternations, 0);
  for (const [, n] of Object.entries(st.perPlayerTargetSwitches)) assert(n <= 20, `target 切换过多 ${n}`);
});

test('J：无 Intent 振荡（切换次数有界）', () => {
  const run = runHarness(buildHarnessCore(), { dt: DT, durationMinutes: MINUTES, record: true });
  const st = analyzeStability(run.history);
  assert(st.intentSwitches < 22 * 15, `intent 切换过多 ${st.intentSwitches}`);
});

// ---------------------------------------------------------------- K L0/L1 cadence
test('K：L0/L1 节拍 —— 重评次数显著低于 22×tick', () => {
  const run = runHarness(buildHarnessCore(), { dt: DT, durationMinutes: MINUTES });
  const reeval = run.stats.L1 + run.stats.L2;
  assert(reeval < run.stats.playerTicks * 0.25, `重评比例过高 ${reeval}/${run.stats.playerTicks}`);
  assert(run.stats.L0 > run.stats.L1, 'L0 应占主导');
});

// ---------------------------------------------------------------- L performance
test('L：性能冒烟 —— 90 分钟运行 wall-clock 在合理范围', () => {
  const run = runHarness(buildHarnessCore(), { dt: DT, durationMinutes: MINUTES });
  const avg = run.stats.wallMs / run.stats.ticks;
  assert(run.stats.wallMs < 8000, `总耗时过高 ${run.stats.wallMs}ms`);
  assert(avg < 50, `平均 tick 过高 ${avg}ms`);
  assert(run.stats.locomotionUpdates === 22 * run.stats.ticks);
  void run.stats.targetResolves;
  void run.stats.intentSelections;
});

// ---------------------------------------------------------------- multi fixture
test('多场 fixture：5 场 / 10 场连续 90 分钟稳定', () => {
  for (const seed of ['f1', 'f2', 'f3', 'f4', 'f5']) {
    const r = runHarness(buildHarnessCore({ seed }), { dt: DT, durationMinutes: MINUTES });
    noViolations(r.violations);
  }
  for (let i = 0; i < 10; i += 1) {
    const r = runHarness(buildHarnessCore({ seed: `g${i}` }), { dt: DT, durationMinutes: MINUTES });
    noViolations(r.violations);
  }
});

test('长度规模：dt=1（90 tick）与 dt=0.25（360 tick）均稳定', () => {
  for (const dt of [1, 0.25]) {
    const r = runHarness(buildHarnessCore(), { dt, durationMinutes: MINUTES });
    noViolations(r.violations);
    assertEquals(r.finalCore.clock.simulationTime, 90);
  }
});

// ---------------------------------------------------------------- M causality
test('M：Movement → Position → PlayerSituation 只读因果', () => {
  const c0 = buildHarnessCore();
  const run = runHarness(c0, { dt: DT, durationMinutes: MINUTES });
  const final = run.finalCore;

  const sitFinal = buildPlayerSituation(final, 'h_fw1');
  const posFinal = final.players.find((p) => p.playerId === 'h_fw1').positionOnPitch;
  assertEquals(sitFinal.ownState.coordinates, { x: posFinal.x, y: posFinal.y });

  // 同一球员在两种人工位置下，PlayerSituation 读取到不同几何
  const mkAt = (x, y) => {
    const core = buildHarnessCore();
    core.players = core.players.map((p) => (p.playerId === 'h_fw1' ? { ...p, positionOnPitch: { x, y } } : p));
    return buildPlayerSituation(core, 'h_fw1');
  };
  const atBack = mkAt(0.1, 0.1);
  const atFront = mkAt(0.9, 0.1);
  assert(Math.abs(atBack.spatialContext.distanceToGoal - atFront.spatialContext.distanceToGoal) > 0.1, 'distanceToGoal 应随位置变化');
  assert(!(atBack.ownState.coordinates.x === atFront.ownState.coordinates.x));
});

// ---------------------------------------------------------------- N no mutation
test('N：运行不修改输入 MatchCore，且仅 players/movement 变化', () => {
  const core = buildHarnessCore();
  const before = JSON.stringify(core);
  const run = runHarness(core, { dt: DT, durationMinutes: 10 });
  assertEquals(JSON.stringify(core), before, '输入 MatchCore 不应被修改');
  assertEquals(run.finalCore.score, core.score);
  assertEquals(run.finalCore.ball, core.ball, 'Movement 不应移动球');
  assertEquals(run.finalCore.tactical, core.tactical);
  for (const k of Object.keys(run.finalCore)) {
    assert(['worldId', 'season', 'matchId', 'ruleVersion', 'seed', 'teams', 'clock', 'score', 'ball', 'players', 'tactical', 'movement'].includes(k), `出现非预期字段 ${k}`);
  }
});

test('N：Math.random 未被使用（90 分钟运行守卫）', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Movement 不应调用 Math.random'); };
  try {
    runHarness(buildHarnessCore(), { dt: DT, durationMinutes: MINUTES });
    assert(true);
  } finally {
    Math.random = original;
  }
});