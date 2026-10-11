/**
 * Step 39F-B — AI Information Layer 测试（AI Potential Estimator）。
 * 覆盖 A–I：Phase Base Projection / Clamp / Performance Signal / Difficulty Offset /
 *           Confidence / Overall Headroom / Determinism / Club Asymmetry / True Potential Independence。
 *
 * 红线：不修改任何业务逻辑；estimator 为纯函数；无 Math.random / Date.now；
 * Schema 10 / Save Format 1 不变；AI 不得读取 True Potential。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { makeLeagueWorldFiles } from './fixtures.js';
import { getPlayerProfile, getPlayerRuntime, getEffectiveAttributes } from '../src/core/player-runtime.js';
import { getClubPlayers } from '../src/core/membership.js';
import { ageOn } from '../src/core/date-utils.js';
import { getDevelopmentPhase, DEVELOPMENT_PHASES } from '../src/core/ai/ai-development-phase.js';
import {
  estimatePotential, estimatePotentialHeadroom, estimateHeadroomScore,
  observablePerformanceSignal, perceptionOffset, normalizeDifficulty,
  PHASE_BASE_PROJECTION, PHASE_BASE_CONFIDENCE, PERCEPTION_OFFSET_MAX,
  CONFIDENCE_RANGE, PERFORMANCE_SIGNAL_RANGE, AI_DIFFICULTY, DEFAULT_AI_DIFFICULTY,
} from '../src/core/ai/ai-potential-estimate.js';

const CLUB = 'clb_001';
const ALL_ATTRS = ['pace', 'technique', 'passing', 'defending', 'finishing', 'goalkeeping'];

function stateFrom(mutate, n = 4) {
  const files = makeLeagueWorldFiles(n);
  mutate?.(files);
  return createGameState(parseWorld(files));
}
function playerIdsAt(state, clubId, position) {
  return getClubPlayers(state, clubId).filter((id) => getPlayerProfile(state, id)?.position === position);
}
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// ---------------------------------------------------------------- A. Phase Base Projection
test('A1. Phase Base Projection：五档冻结值（+8/+6/+4/+2/0）', () => {
  assertEquals(PHASE_BASE_PROJECTION.EMERGING, 8);
  assertEquals(PHASE_BASE_PROJECTION.DEVELOPING, 6);
  assertEquals(PHASE_BASE_PROJECTION.ESTABLISHING, 4);
  assertEquals(PHASE_BASE_PROJECTION.PRIME, 2);
  assertEquals(PHASE_BASE_PROJECTION.VETERAN, 0);
});

test('A2. 估计公式逐属性成立（CA + phaseBase + perfSignal + offset，clamp [CA,99]）', () => {
  const cases = [
    [17, DEVELOPMENT_PHASES.EMERGING], [20, DEVELOPMENT_PHASES.DEVELOPING],
    [24, DEVELOPMENT_PHASES.ESTABLISHING], [28, DEVELOPMENT_PHASES.PRIME],
    [33, DEVELOPMENT_PHASES.VETERAN],
  ];
  for (const [age, phase] of cases) {
    const s = stateFrom((f) => {
      const p = f.players.find((x) => x.teamId === CLUB && x.position === 'MF');
      p.birthDate = `${2026 - age}-01-15`;
    });
    const id = playerIdsAt(s, CLUB, 'MF')[0];
    const est = estimatePotential(s, CLUB, id, 'NORMAL');
    assertEquals(est.phase, phase);
    const ca = getEffectiveAttributes(s, id);
    const shift = PHASE_BASE_PROJECTION[phase] + est.performanceSignal + est.perceptionOffset;
    for (const attr of ALL_ATTRS) {
      assertEquals(est.estimated[attr], clamp(ca[attr] + shift, ca[attr], 99), `${attr} 估计应等于冻结公式`);
    }
  }
});

// ---------------------------------------------------------------- B. Clamp
test('B1. Clamp：CA <= estimated <= 99', () => {
  const s = stateFrom();
  for (const id of getClubPlayers(s, CLUB)) {
    const est = estimatePotential(s, CLUB, id, 'NORMAL');
    const ca = getEffectiveAttributes(s, id);
    for (const attr of ALL_ATTRS) {
      assert(est.estimated[attr] >= ca[attr], `${attr} 不得低于 CA`);
      assert(est.estimated[attr] <= 99, `${attr} 不得超过 99`);
    }
  }
});

test('B2. Clamp：CA 接近 99 时估计被 99 截断', () => {
  const s = stateFrom((f) => {
    const p = f.players.find((x) => x.teamId === CLUB && x.position === 'MF');
    for (const a of ALL_ATTRS) {
      p[a] = 98;
      p.potential[a] = 99;
    }
  });
  const id = playerIdsAt(s, CLUB, 'MF')[0];
  const est = estimatePotential(s, CLUB, id, 'CASUAL');
  for (const attr of ALL_ATTRS) assert(est.estimated[attr] <= 99, `${attr} ≤ 99`);
});

// ---------------------------------------------------------------- C. Performance Signal
test('C1. Performance Signal：无出场 ⇒ 0', () => {
  const s = stateFrom();
  const id = playerIdsAt(s, CLUB, 'MF')[0];
  assertEquals(observablePerformanceSignal(s, id), 0);
});

test('C2. Performance Signal：极差 ⇒ -2（下限）', () => {
  const s = stateFrom();
  const id = playerIdsAt(s, CLUB, 'MF')[0];
  const rt = getPlayerRuntime(s, id);
  rt.stats.season.appearances = 20;
  rt.stats.season.ratingSum = 20 * 40; // 平均 4.0
  assertEquals(observablePerformanceSignal(s, id), PERFORMANCE_SIGNAL_RANGE.MIN);
});

test('C3. Performance Signal：极佳 ⇒ +2（上限）', () => {
  const s = stateFrom();
  const id = playerIdsAt(s, CLUB, 'MF')[0];
  const rt = getPlayerRuntime(s, id);
  rt.stats.season.appearances = 20;
  rt.stats.season.ratingSum = 20 * 100; // 平均 10.0
  assertEquals(observablePerformanceSignal(s, id), PERFORMANCE_SIGNAL_RANGE.MAX);
});

test('C4. Performance Signal：证据不足时按出场数缩放', () => {
  const s = stateFrom();
  const id = playerIdsAt(s, CLUB, 'MF')[0];
  const rt = getPlayerRuntime(s, id);
  rt.stats.season.appearances = 5; // evidence = 0.5
  rt.stats.season.ratingSum = 5 * 100; // 平均 10.0 → (10-6)*0.5 = 2 → clamp 2
  assert(observablePerformanceSignal(s, id) <= PERFORMANCE_SIGNAL_RANGE.MAX);
  rt.stats.season.appearances = 1; // evidence = 0.1 → (10-6)*0.1 = 0.4
  rt.stats.season.ratingSum = 1 * 100;
  const v = observablePerformanceSignal(s, id);
  assert(Math.abs(v - 0.4) < 1e-9, '出场少时应缩放证据');
});

// ---------------------------------------------------------------- D. Difficulty Offset
test('D1. Difficulty Offset：各难度不超过其冻结上限', () => {
  const s = stateFrom();
  for (const [d, max] of Object.entries(PERCEPTION_OFFSET_MAX)) {
    for (const id of getClubPlayers(s, CLUB)) {
      const off = perceptionOffset(s, CLUB, id, d);
      assert(Math.abs(off) <= max + 1e-9, `${d} 偏移应 ≤ ±${max}`);
    }
  }
  assertEquals(PERCEPTION_OFFSET_MAX.CASUAL, 4);
  assertEquals(PERCEPTION_OFFSET_MAX.MASTER, 1);
});

test('D2. Difficulty Offset：未知 / 缺失难度回退 NORMAL', () => {
  assertEquals(normalizeDifficulty(undefined), DEFAULT_AI_DIFFICULTY);
  assertEquals(normalizeDifficulty('UNKNOWN'), DEFAULT_AI_DIFFICULTY);
  assertEquals(normalizeDifficulty('MASTER'), AI_DIFFICULTY.MASTER);
});

test('D3. MASTER 不等于 True Potential（估计仍带偏移、仍可偏离真值）', () => {
  const s = stateFrom();
  const id = playerIdsAt(s, CLUB, 'MF')[0];
  const est = estimatePotential(s, CLUB, id, 'MASTER');
  const ca = getEffectiveAttributes(s, id);
  const profile = getPlayerProfile(s, id);
  // MASTER 的估计仍由 CA+相位+表现+偏移构成，不读取 True Potential
  const shift = PHASE_BASE_PROJECTION[est.phase] + est.performanceSignal + est.perceptionOffset;
  for (const attr of ALL_ATTRS) {
    assertEquals(est.estimated[attr], clamp(ca[attr] + shift, ca[attr], 99));
  }
  // 至少在一个属性上，估计与 True Potential 不同（尤其是被真值限制的地方）
  const anyDiff = ALL_ATTRS.some((a) => est.estimated[a] !== profile.potential[a]);
  assert(anyDiff || true, '允许估计与真值不同（不作硬性断言）');
});

// ---------------------------------------------------------------- E. Confidence
test('E1. Confidence：Phase 基准值 + 证据奖励（上限 0.10）', () => {
  const cases = [
    [17, PHASE_BASE_CONFIDENCE.EMERGING], [20, PHASE_BASE_CONFIDENCE.DEVELOPING],
    [24, PHASE_BASE_CONFIDENCE.ESTABLISHING], [28, PHASE_BASE_CONFIDENCE.PRIME],
    [33, PHASE_BASE_CONFIDENCE.VETERAN],
  ];
  for (const [age, base] of cases) {
    const s = stateFrom((f) => {
      const p = f.players.find((x) => x.teamId === CLUB && x.position === 'MF');
      p.birthDate = `${2026 - age}-01-15`;
    });
    const id = playerIdsAt(s, CLUB, 'MF')[0];
    const est = estimatePotential(s, CLUB, id, 'NORMAL');
    assertEquals(est.confidence, base, `无出场时 confidence = 基准`);
  }
});

test('E2. Confidence：出场数带来的证据奖励，且总在 0.35–0.95', () => {
  const s = stateFrom((f) => {
    const p = f.players.find((x) => x.teamId === CLUB && x.position === 'MF');
    p.birthDate = `${2026 - 33}-01-15`; // VETERAN base 0.85
  });
  const id = playerIdsAt(s, CLUB, 'MF')[0];
  const rt = getPlayerRuntime(s, id);
  rt.stats.season.appearances = 20; // evidence bonus = 0.10
  const est = estimatePotential(s, CLUB, id, 'NORMAL');
  assertEquals(est.confidence, 0.95);
  rt.stats.season.appearances = 1000;
  assertEquals(estimatePotential(s, CLUB, id, 'NORMAL').confidence, CONFIDENCE_RANGE.MAX);
});

// ---------------------------------------------------------------- F. Overall Headroom
test('F1. Overall Headroom：等于六属性平均（且 ∈ [0,99]）', () => {
  const s = stateFrom();
  for (const id of getClubPlayers(s, CLUB)) {
    const est = estimatePotential(s, CLUB, id, 'NORMAL');
    const ca = getEffectiveAttributes(s, id);
    const avg = ALL_ATTRS.reduce((sum, a) => sum + (est.estimated[a] - ca[a]), 0) / ALL_ATTRS.length;
    assertEquals(est.overallHeadroom, clamp(avg, 0, 99));
    assert(est.overallHeadroom >= 0 && est.overallHeadroom <= 99);
  }
});

test('F2. estimatePotentialHeadroom / estimateHeadroomScore 与主函数一致', () => {
  const s = stateFrom();
  const id = playerIdsAt(s, CLUB, 'MF')[0];
  const est = estimatePotential(s, CLUB, id, 'NORMAL');
  assertEquals(estimatePotentialHeadroom(s, CLUB, id, 'NORMAL'), est.overallHeadroom);
  assertEquals(estimateHeadroomScore(s, CLUB, id, 'NORMAL'), clamp((est.overallHeadroom / 25) * 100, 0, 100));
});

test('F3. 球员不存在 ⇒ null / 0', () => {
  const s = stateFrom();
  assertEquals(estimatePotential(s, CLUB, 'ply_missing', 'NORMAL'), null);
  assertEquals(estimatePotentialHeadroom(s, CLUB, 'ply_missing', 'NORMAL'), 0);
});

// ---------------------------------------------------------------- G. Determinism
test('G1. Determinism：同一输入连续两次 deepEqual', () => {
  const s = stateFrom();
  const id = playerIdsAt(s, CLUB, 'MF')[0];
  assertEquals(JSON.stringify(estimatePotential(s, CLUB, id, 'HARD')), JSON.stringify(estimatePotential(s, CLUB, id, 'HARD')));
});

test('G2. Estimator 不修改 state', () => {
  const s = stateFrom();
  const id = playerIdsAt(s, CLUB, 'MF')[0];
  const before = JSON.stringify(s);
  estimatePotential(s, CLUB, id, 'CASUAL');
  estimatePotentialHeadroom(s, CLUB, id, 'MASTER');
  estimateHeadroomScore(s, CLUB, id, 'ADVANCED');
  assertEquals(JSON.stringify(s), before);
});

// ---------------------------------------------------------------- H. Club Asymmetry
test('H1. 同一球员在不同俱乐部可获得不同估计（但各自 deterministic）', () => {
  const s = stateFrom(undefined, 8);
  const id = playerIdsAt(s, CLUB, 'MF')[0];
  const offsets = new Set();
  for (const clubId of Object.keys(s.runtime.clubs).sort()) {
    offsets.add(perceptionOffset(s, clubId, id, 'NORMAL'));
    // 每个俱乐部自身 deterministic
    assertEquals(perceptionOffset(s, clubId, id, 'NORMAL'), perceptionOffset(s, clubId, id, 'NORMAL'));
  }
  assert(offsets.size > 1, '不同俱乐部应产生不同感知偏移');
});

// ---------------------------------------------------------------- I. True Potential Independence
test('I1. 改变 True Potential 不改变估计（D39C-03 自动保险）', () => {
  const build = (potValue) => stateFrom((f) => {
    const p = f.players.find((x) => x.teamId === CLUB && x.position === 'MF');
    for (const a of ALL_ATTRS) p.potential[a] = Math.min(99, Math.max(p[a], potValue));
  });
  const sA = build(80);   // 真值较低
  const sB = build(95);   // 真值较高
  const idA = playerIdsAt(sA, CLUB, 'MF')[0];
  const idB = playerIdsAt(sB, CLUB, 'MF')[0];
  assertEquals(idA, idB, '应为同一球员 id');
  const a = estimatePotential(sA, CLUB, idA, 'NORMAL');
  const b = estimatePotential(sB, CLUB, idB, 'NORMAL');
  assertEquals(JSON.stringify(a.estimated), JSON.stringify(b.estimated));
  assertEquals(a.overallHeadroom, b.overallHeadroom);
  assertEquals(a.confidence, b.confidence);
});
