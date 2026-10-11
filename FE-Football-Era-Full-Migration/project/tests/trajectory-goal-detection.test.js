/**
 * Step 39F-M-C-20 —— Trajectory-Aware Goal-Line Detection 测试。
 *
 * 覆盖 基础 / 无进球 / Home / Away / 多段 / 折返 / Boundary / Invalid / Architecture。
 * 红线：复用 C-15；不调用 C-14；不写 Score；不改 MatchCore；无随机 / 墙钟 / 物理。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  detectGoalsFromTrajectory, validateTrajectoryGoalDetectionResult,
  TRAJECTORY_GOAL_DETECTION_SOURCE, TRAJECTORY_GOAL_REASON,
} from '../src/core/match/trajectory-goal-detection.js';
import { deriveGoalGeometry } from '../src/core/match/goal-geometry.js';
import { GOAL_MOUTH_Y_MIN, GOAL_MOUTH_Y_MAX } from '../src/core/match/goal-geometry-config.js';
import { deriveBallTrajectory } from '../src/core/match/ball-trajectory.js';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/core/match/trajectory-goal-detection.js'), 'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const H = 'clb_h', A = 'clb_a';
const geom = () => deriveGoalGeometry({ teams: { home: H, away: A } });

/** 走真实 C-19 派生的线性 Trajectory。 */
const lin = (p0, p1, n = 2, tickIndex = 0) =>
  deriveBallTrajectory({ startPosition: { x: p0[0], y: p0[1] }, endPosition: { x: p1[0], y: p1[1] }, sampleCount: n, tickIndex });

/** 手工 Trajectory（用于折返 / 多次穿越；仍为合法 C-19 结构）。 */
function manual(pts, tickIndex = 0) {
  const n = pts.length;
  const samples = pts.map((p, i) => ({ t: i / (n - 1), x: p[0], y: p[1] }));
  return {
    ok: true, tickIndex, start: { x: pts[0][0], y: pts[0][1] }, end: { x: pts[n - 1][0], y: pts[n - 1][1] },
    samples, sampleCount: n, source: 'TICK_INTERNAL_TRAJECTORY', ruleVersion: 'ball-trajectory-v1',
  };
}

// ===========================================================================
// 基础：1-5
// ===========================================================================

test('TG-01/02/03. samples → segments = N-1', () => {
  assertEquals(detectGoalsFromTrajectory(lin([0.4, 0.5], [0.6, 0.5], 2), geom()).segmentCount, 1);
  assertEquals(detectGoalsFromTrajectory(lin([0.4, 0.5], [0.6, 0.5], 3), geom()).segmentCount, 2);
  assertEquals(detectGoalsFromTrajectory(lin([0.4, 0.5], [0.6, 0.5], 5), geom()).segmentCount, 4);
});

test('TG-04/05. sample 顺序保持 + segmentIndex 正确（升序）', () => {
  const r = detectGoalsFromTrajectory(manual([[0.9, 0.5], [1.1, 0.5], [0.9, 0.5], [1.1, 0.5]]), geom());
  assertEquals(JSON.stringify(r.crossings.map((c) => c.segmentIndex)), JSON.stringify([0, 2]));
});

// ===========================================================================
// 无进球：6-10
// ===========================================================================

test('TG-06/07/08. 完全场内 / 完全场外 / 不经过门线 → 0 crossing', () => {
  for (const t of [lin([0.4, 0.5], [0.8, 0.5]), lin([1.2, 0.5], [1.4, 0.5]), lin([0.9, 0.2], [0.9, 0.8])]) {
    const r = detectGoalsFromTrajectory(t, geom());
    assertEquals(r.goalCount, 0);
    assertEquals(r.crossings.length, 0);
  }
});

test('TG-09. 零位移段 → NO_CROSSING 且不失败', () => {
  const r = detectGoalsFromTrajectory(manual([[0.5, 0.5], [0.5, 0.5], [0.7, 0.5]]), geom());
  assertEquals(r.ok, true);
  assertEquals(r.goalCount, 0, '零位移段被跳过，后续段亦未越线');
});

test('TG-10. 平行于 Goal Line（dx=0）→ 无 crossing', () => {
  const r = detectGoalsFromTrajectory(lin([0.5, 0.1], [0.5, 0.9], 3), geom());
  assertEquals(r.goalCount, 0);
});

// ===========================================================================
// Home Goal（+x 右侧）：11-13
// ===========================================================================

test('TG-11/12. +x 穿越右门线，mouth 内 → home crossing', () => {
  const r = detectGoalsFromTrajectory(lin([0.9, 0.5], [1.1, 0.5], 2), geom());
  assertEquals(r.goalCount, 1);
  assertEquals(r.crossings[0].scoringSide, 'RIGHT');
  assertEquals(r.crossings[0].scoringTeamId, H);
  assertEquals(r.crossings[0].crossingPoint, { x: 1, y: 0.5 });
});

test('TG-13. mouth 外（y 偏低）→ 无 crossing', () => {
  const r = detectGoalsFromTrajectory(lin([0.9, 0.2], [1.1, 0.2], 2), geom());
  assertEquals(r.goalCount, 0);
});

// ===========================================================================
// Away Goal（-x 左侧）：14-16
// ===========================================================================

test('TG-14/15. -x 穿越左门线，mouth 内 → away crossing', () => {
  const r = detectGoalsFromTrajectory(lin([0.1, 0.5], [-0.1, 0.5], 2), geom());
  assertEquals(r.goalCount, 1);
  assertEquals(r.crossings[0].scoringSide, 'LEFT');
  assertEquals(r.crossings[0].scoringTeamId, A);
});

test('TG-16. mouth 外 → 无 crossing', () => {
  assertEquals(detectGoalsFromTrajectory(lin([0.1, 0.9], [-0.1, 0.9], 2), geom()).goalCount, 0);
});

// ===========================================================================
// 多段：17-20
// ===========================================================================

test('TG-17/18/19. 一个 / 两个 / 多个 crossing', () => {
  const one = detectGoalsFromTrajectory(manual([[0.4, 0.5], [0.6, 0.5], [1.1, 0.5]]), geom());
  assertEquals(one.goalCount, 1);
  const two = detectGoalsFromTrajectory(manual([[0.9, 0.5], [1.1, 0.5], [0.9, 0.5], [1.1, 0.5]]), geom());
  assertEquals(two.goalCount, 2);
  const many = detectGoalsFromTrajectory(manual([[0.9, 0.5], [1.1, 0.5], [0.9, 0.5], [1.1, 0.5], [0.9, 0.5], [1.1, 0.5]]), geom());
  assertEquals(many.goalCount, 3);
});

test('TG-20. crossing 顺序严格按 Trajectory（segmentIndex / crossingT 升序）', () => {
  const r = detectGoalsFromTrajectory(manual([[0.9, 0.5], [1.1, 0.5], [0.9, 0.5], [1.1, 0.5]]), geom());
  assert(r.crossings[0].segmentIndex < r.crossings[1].segmentIndex);
  assert(r.crossings[0].crossingT <= r.crossings[1].crossingT);
});

// ===========================================================================
// 折返：21-23
// ===========================================================================

test('TG-21/22/23. field→goal→field→goal：多次穿越全部保留（无 Dedup）', () => {
  const r = detectGoalsFromTrajectory(manual([[0.9, 0.5], [1.1, 0.5], [0.9, 0.5], [1.1, 0.5]]), geom());
  assertEquals(r.goalCount, 2, '不得因已检测过而忽略后续');
  // 同一门的两侧穿越都如实报告。
  assert(r.crossings.every((c) => c.scoringSide === 'RIGHT'));
});

test('TG-23b. 跨两侧球门（Home 后 Away）', () => {
  const r = detectGoalsFromTrajectory(manual([[0.9, 0.5], [1.1, 0.5], [-0.1, 0.5]]), geom());
  assertEquals(JSON.stringify(r.crossings.map((c) => c.scoringSide)), JSON.stringify(['RIGHT', 'LEFT']));
});

// ===========================================================================
// Boundary：24-28
// ===========================================================================

test('TG-24. Goal Mouth 边界（inclusive，复用 C-15）', () => {
  assertEquals(detectGoalsFromTrajectory(lin([0.9, GOAL_MOUTH_Y_MIN], [1.1, GOAL_MOUTH_Y_MIN], 2), geom()).goalCount, 1);
  assertEquals(detectGoalsFromTrajectory(lin([0.9, GOAL_MOUTH_Y_MAX], [1.1, GOAL_MOUTH_Y_MAX], 2), geom()).goalCount, 1);
  assertEquals(detectGoalsFromTrajectory(lin([0.9, GOAL_MOUTH_Y_MIN - 0.05], [1.1, GOAL_MOUTH_Y_MIN - 0.05], 2), geom()).goalCount, 0);
});

test('TG-25/26. 起点正好在门线上(x=0 / x=1) → 不算 field→goal', () => {
  assertEquals(detectGoalsFromTrajectory(manual([[0, 0.5], [-0.1, 0.5]]), geom()).goalCount, 0);
  assertEquals(detectGoalsFromTrajectory(manual([[1, 0.5], [1.1, 0.5]]), geom()).goalCount, 0);
});

test('TG-27. 外部 → 内部方向不误判', () => {
  assertEquals(detectGoalsFromTrajectory(manual([[-0.1, 0.5], [0.1, 0.5]]), geom()).goalCount, 0);
  assertEquals(detectGoalsFromTrajectory(manual([[1.1, 0.5], [0.9, 0.5]]), geom()).goalCount, 0);
});

test('TG-28. 端点情况：采样点正好落在门线上（strict 方向语义）', () => {
  // 中间 sample 恰在 x=1.0：两侧段均非严格 field→goal（C-15 语义）→ 无 crossing。
  assertEquals(detectGoalsFromTrajectory(manual([[0.9, 0.5], [1.0, 0.5], [1.1, 0.5]]), geom()).goalCount, 0);
  // 无中间点、直接跨越则成立。
  assertEquals(detectGoalsFromTrajectory(manual([[0.9, 0.5], [1.1, 0.5]]), geom()).goalCount, 1);
});

// ===========================================================================
// Invalid：29-35
// ===========================================================================

test('TG-29/30/31. null / malformed samples / sampleCount 不匹配 → INVALID_TRAJECTORY', () => {
  assertEquals(detectGoalsFromTrajectory(null, geom()).reason, TRAJECTORY_GOAL_REASON.INVALID_TRAJECTORY);
  const bad = manual([[0.4, 0.5], [0.6, 0.5]]); delete bad.samples[1].t;
  assertEquals(detectGoalsFromTrajectory(bad, geom()).reason, TRAJECTORY_GOAL_REASON.INVALID_TRAJECTORY);
  const mismatch = manual([[0.4, 0.5], [0.6, 0.5], [0.8, 0.5]]); mismatch.sampleCount = 5;
  assertEquals(detectGoalsFromTrajectory(mismatch, geom()).reason, TRAJECTORY_GOAL_REASON.INVALID_TRAJECTORY);
});

test('TG-32/33. invalid t / invalid position → INVALID_TRAJECTORY', () => {
  const badT = manual([[0.4, 0.5], [1.1, 0.5]]); badT.samples[0].t = 0.2; // first.t !== 0
  assertEquals(detectGoalsFromTrajectory(badT, geom()).reason, TRAJECTORY_GOAL_REASON.INVALID_TRAJECTORY);
  const badPos = manual([[0.4, 0.5], [1.1, 0.5]]); badPos.samples[1].x = NaN;
  assertEquals(detectGoalsFromTrajectory(badPos, geom()).reason, TRAJECTORY_GOAL_REASON.INVALID_TRAJECTORY);
});

test('TG-34. invalid geometry → INVALID_GEOMETRY', () => {
  assertEquals(detectGoalsFromTrajectory(lin([0.4, 0.5], [0.6, 0.5]), null).reason, TRAJECTORY_GOAL_REASON.INVALID_GEOMETRY);
  assertEquals(detectGoalsFromTrajectory(lin([0.4, 0.5], [0.6, 0.5]), { left: {} }).reason, TRAJECTORY_GOAL_REASON.INVALID_GEOMETRY);
});

test('TG-35. INVALID_SEGMENT 分支存在（防御性）', () => {
  assertEquals(TRAJECTORY_GOAL_REASON.INVALID_SEGMENT, 'INVALID_SEGMENT');
  assert(/INVALID_SEGMENT/.test(SRC), '源码须含 INVALID_SEGMENT 分支');
});

// ===========================================================================
// 校验 / Determinism
// ===========================================================================

test('TG-36. 结果可校验 / 确定性', () => {
  const run = () => detectGoalsFromTrajectory(manual([[0.9, 0.5], [1.1, 0.5], [0.9, 0.5], [1.1, 0.5]]), geom());
  assertEquals(validateTrajectoryGoalDetectionResult(run()).valid, true);
  assertEquals(JSON.stringify(run()), JSON.stringify(run()));
});

test('TG-37. 无 crossing 时 ok:true（非失败）', () => {
  const r = detectGoalsFromTrajectory(lin([0.4, 0.5], [0.6, 0.5]), geom());
  assertEquals(r.ok, true);
  assertEquals(r.goalCount, 0);
  assertEquals(r.source, TRAJECTORY_GOAL_DETECTION_SOURCE);
});

test('TG-38. tickIndex 保留（不重生成；空则 null）', () => {
  assertEquals(detectGoalsFromTrajectory(lin([0.9, 0.5], [1.1, 0.5], 2, 7), geom()).trajectoryTickIndex, 7);
  const t = lin([0.9, 0.5], [1.1, 0.5]); t.tickIndex = null;
  assertEquals(detectGoalsFromTrajectory(t, geom()).trajectoryTickIndex, null);
});

test('TG-39. 不重采样：消费全部 samples', () => {
  const r = detectGoalsFromTrajectory(lin([0.4, 0.5], [0.6, 0.5], 16), geom());
  assertEquals(r.segmentCount, 15);
});

// ===========================================================================
// Architecture：40-47
// ===========================================================================

test('TG-40/41. 不修改 MatchCore / 无 Score 写入', () => {
  assert(!/matchCore/.test(SRC), '不得引用 MatchCore');
  assert(!/score\.home|score\.away|applyGoalScoreUpdate|score\s*=|Score\b/.test(SRC));
});

test('TG-42/43. 不调用 C-14 / 不建立 Goal Truth / 无 Ledger', () => {
  assert(!/goal-resolution|resolveGoal/.test(SRC), '不得依赖 C-14');
  assert(!/ledger|goalHistory|goalIdRegistry/i.test(SRC));
  assert(/from '\.\/goal-geometry\.js'/.test(SRC), '必须复用 C-15');
});

test('TG-44/45. 无第二套 Geometry 常量 / 无新增 epsilon', () => {
  assert(!/goalCenter|goalHalfWidth|goalLineX|goalMouth|GOAL_HALF_WIDTH|GOAL_CENTER_Y/.test(SRC));
  assert(!/EPSILON\s*=|0\.0000|1e-/.test(SRC), '不得新增几何 epsilon');
});

test('TG-46/47. 无随机 / 无墙钟 / 无物理', () => {
  assert(!/Math\.random\s*\(/.test(SRC));
  assert(!/Date\.now\s*\(/.test(SRC) && !/performance\.now\s*\(/.test(SRC) && !/new\s+Date\s*\(/.test(SRC));
  for (const b of ['gravity', 'acceleration', 'friction', 'bounce', 'collision', 'radius']) {
    assert(!new RegExp(b, 'i').test(SRC), `不得含 ${b}`);
  }
});

test('TG-48. 不依赖 C-16/C-17/C-18（单向：C-19 → C-20 → C-15）', () => {
  assert(!/ball-tick-segment|goal-aware|match-tick/.test(SRC));
});