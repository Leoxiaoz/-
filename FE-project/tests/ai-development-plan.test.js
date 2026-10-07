/**
 * Step 39F-J-LAYER-B（SIGNAL-IMPLEMENTATION）—— AI Development Plan 测试。
 * 覆盖 Need / Gap / Priority / Training Intent / Playing Opportunity Intent / Plan。
 *
 * 红线：只读、无 RNG、无持久化、不接 Training Decision / Selection / Rotation / Minutes / Growth；
 * 不读 True Potential；schema 10 / save 1 未变。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState, GAME_STATE_SCHEMA_VERSION } from '../src/core/game-state.js';
import { parseWorld, WORLD_FORMAT } from '../src/data/data-loader.js';
import { getPlayerRuntime, applyInjury } from '../src/core/player-runtime.js';
import { SAVE_FORMAT_VERSION } from '../src/save/save-manager.js';
import {
  evaluateDevelopmentNeed, evaluateDevelopmentGap, evaluateDevelopmentPriority,
  resolveTrainingIntent, resolvePlayingOpportunityIntent, evaluateDevelopmentPlan,
} from '../src/core/ai/ai-development-plan.js';
import { AI_DEVELOPMENT_PLAN_CONFIG as C } from '../src/core/ai/ai-config.js';

const ATT = ['pace', 'technique', 'passing', 'defending', 'finishing', 'goalkeeping'];
const near = (a, b) => Math.abs(a - b) < 1e-9;

function mk(players, id, pos, rating, age, pers = 60) {
  const a = {};
  for (const x of ATT) a[x] = (x === 'goalkeeping') ? (pos === 'GK' ? rating : 10) : rating;
  const pot = {};
  for (const x of ATT) pot[x] = Math.min(99, a[x] + 10);
  players.push({
    id, name: id, teamId: 'clb_a', position: pos, birthDate: `${2026 - age}-01-15`,
    ...a, potential: pot,
    personality: { professionalism: pers, determination: pers, ambition: pers, consistency: pers, injuryProneness: 40 },
  });
}
function buildState(players) {
  return createGameState(parseWorld({
    manifest: { id: 'w_plan', name: 'plan', version: '0.1.0', format: WORLD_FORMAT, startDate: '2026-07-01' },
    countries: [{ id: 'cty_a', name: 'A' }],
    leagues: [{ id: 'lg_a', name: 'L', countryId: 'cty_a', tier: 1 }],
    teams: [{ id: 'clb_a', name: 'A', leagueId: 'lg_a', formation: '4-4-2' }],
    players,
  }));
}
/** 标准世界：GK×3（g1 90 / g2 80 / g3 70），DF×(dfCount) 全 70，MF×5 全 70，FW×3 全 70，age 默认 25。 */
function standard(dfCount = 5, age = 25) {
  const players = [];
  mk(players, 'g1', 'GK', 90, age); mk(players, 'g2', 'GK', 80, age); mk(players, 'g3', 'GK', 70, age);
  for (let i = 1; i <= dfCount; i += 1) mk(players, `d${i}`, 'DF', 70, age);
  for (let i = 1; i <= 5; i += 1) mk(players, `m${i}`, 'MF', 70, age);
  for (let i = 1; i <= 3; i += 1) mk(players, `f${i}`, 'FW', 70, age);
  return buildState(players);
}

// ================= Need =================
test('NEED1. EMERGING 有 Need（>0），公式自洽', () => {
  const s = standard(5, 17);
  const r = evaluateDevelopmentNeed(s, 'clb_a', 'm1');
  assert(r.need > 0, 'EMERGING 应有 Need');
  assertEquals(r.eligible, true);
  assert(near(r.need, Math.min(1, Math.max(0,
    C.NEED_WEIGHTS.HEADROOM * r.headroomNorm + C.NEED_WEIGHTS.PHASE * r.phaseScore + C.NEED_WEIGHTS.ABILITY_GAP * r.abilityGapFit))));
});
test('NEED2. DEVELOPING / ESTABLISHING 有 Need', () => {
  for (const age of [19, 23]) {
    const s = standard(5, age);
    const r = evaluateDevelopmentNeed(s, 'clb_a', 'm1');
    assertEquals(r.eligible, true);
    assert(r.need > 0);
  }
});
test('NEED3. VETERAN → Need = 0（不参与 growth-oriented Need）', () => {
  const s = standard(5, 33);
  const r = evaluateDevelopmentNeed(s, 'clb_a', 'm1');
  assertEquals(r.phase, 'VETERAN');
  assertEquals(r.eligible, false);
  assertEquals(r.need, 0);
});
test('NEED4. PRIME：Need>0 ⇔ headroomNorm >= PRIME_H_MIN', () => {
  const s = standard(8, 27);
  for (const id of ['d1', 'm1', 'f1', 'g1']) {
    const r = evaluateDevelopmentNeed(s, 'clb_a', id);
    assertEquals(r.phase, 'PRIME');
    assertEquals(r.need > 0, r.headroomNorm >= C.PRIME_H_MIN, `${id} PRIME gate`);
  }
});
test('NEED5. 缺 age → Need 0 + missing_age', () => {
  const s = standard(5, 25);
  s.static.players.find((p) => p.id === 'm1').birthDate = '';
  const r = evaluateDevelopmentNeed(s, 'clb_a', 'm1');
  assertEquals(r.need, 0);
  assertEquals(r.reason, 'missing_age');
});
test('NEED6. 无俱乐部 → null', () => {
  const s = standard(5, 20);
  assertEquals(evaluateDevelopmentNeed(s, null, 'm1'), null);
});

// ================= Headroom / AbilityGapFit =================
test('HR1. HeadroomNorm ∈ [0,1]，高余量球员 > 低余量球员', () => {
  const hi = standard(5, 17);
  const lo = standard(5, 30); // PRIME
  const a = evaluateDevelopmentNeed(hi, 'clb_a', 'm1').headroomNorm;
  const b = evaluateDevelopmentNeed(lo, 'clb_a', 'm1').headroomNorm;
  assert(a >= 0 && a <= 1 && b >= 0 && b <= 1);
  assert(a > b, `EMERGING H(${a}) 应大于 PRIME H(${b})`);
});
test('HR2. abilityGapFit ∈ [0,1]（低能力球员更高）', () => {
  const players = [];
  mk(players, 'g1', 'GK', 90, 20); mk(players, 'g2', 'GK', 80, 20); mk(players, 'g3', 'GK', 70, 20);
  for (let i = 1; i <= 5; i += 1) mk(players, `d${i}`, 'DF', 70, 20);
  for (let i = 1; i <= 5; i += 1) mk(players, `m${i}`, 'MF', 70, 20);
  for (let i = 1; i <= 3; i += 1) mk(players, `f${i}`, 'FW', 70, 20);
  mk(players, 'w1', 'MF', 40, 20); // 低能力 → 高 abilityGapFit
  const s = buildState(players);
  const weak = evaluateDevelopmentNeed(s, 'clb_a', 'w1').abilityGapFit;
  const strong = evaluateDevelopmentNeed(s, 'clb_a', 'm1').abilityGapFit;
  assert(weak >= 0 && weak <= 1 && strong >= 0 && strong <= 1);
  assert(weak > strong);
});

// ================= Gap =================
test('GAP1. Need <= Supply → Gap = 0（STARTER / GK1）', () => {
  const s = standard(5, 17);
  const gapD = evaluateDevelopmentGap(s, 'clb_a', 'd1'); // STARTER supply .95
  const gapG = evaluateDevelopmentGap(s, 'clb_a', 'g1'); // GK1 supply 1.00
  assert(gapD.gap === 0, 'STARTER Gap 应为 0');
  assert(gapG.gap === 0, 'GK1 Gap 应为 0');
  assert(near(gapD.supply, 0.95) && near(gapG.supply, 1.0));
});
test('GAP2. Gap = clamp01(max(0, Need − Supply))，连续且 ∈[0,1]', () => {
  const s = standard(8, 17);
  for (const id of ['d8', 'g3', 'm1', 'd5']) {
    const r = evaluateDevelopmentGap(s, 'clb_a', id);
    assert(near(r.gap, Math.min(1, Math.max(0, r.need - r.supply))), `${id}`);
    assert(r.gap >= 0 && r.gap <= 1);
  }
});
test('GAP3. 低 Supply 角色（BENCH supply .30）可产生正 Gap', () => {
  const s = standard(8, 17);
  const r = evaluateDevelopmentGap(s, 'clb_a', 'd8'); // BENCH
  assert(near(r.supply, 0.30), `BENCH supply=${r.supply}`);
  if (r.need > 0.30) assert(r.gap > 0);
});

// ================= Priority =================
test('PRI1. Priority ∈ [0,1] 且公式自洽（含 environmentModifier）', () => {
  const s = standard(5, 20);
  const r = evaluateDevelopmentPriority(s, 'clb_a', 'm1');
  const raw = C.PRIORITY_WEIGHTS.NEED * r.need + C.PRIORITY_WEIGHTS.GAP * r.gap + C.PRIORITY_WEIGHTS.CONTEXT * r.context;
  assert(near(r.priority, Math.min(1, Math.max(0, raw * r.injuryAttenuation * r.environmentModifier))));
  assert(r.priority >= 0 && r.priority <= 1);
  assert(r.environmentModifier >= C.ENV_FLOOR && r.environmentModifier <= 1);
});
test('PRI2. INJURED → Priority = 0，injuryAttenuation = 0', () => {
  const s = standard(5, 20);
  applyInjury(s, 'm1', { type: 'knock', totalDays: 30, date: s.currentDate });
  const r = evaluateDevelopmentPriority(s, 'clb_a', 'm1');
  assertEquals(r.injured, true);
  assertEquals(r.injuryAttenuation, 0);
  assertEquals(r.priority, 0);
});
test('PRI3. RECOVERY → Need 保留，Priority 经 REC_MIN 有界衰减', () => {
  const s = standard(5, 20);
  const before = evaluateDevelopmentPriority(s, 'clb_a', 'm1');
  const rt = getPlayerRuntime(s, 'm1');
  rt.growth.injuryPenaltySeasons = 1;
  const after = evaluateDevelopmentPriority(s, 'clb_a', 'm1');
  assertEquals(after.recovery, true);
  assertEquals(after.injuryAttenuation, C.REC_MIN);
  assertEquals(after.need, before.need, 'Need 不应因 recovery 改变');
  assert(after.priority <= before.priority + 1e-9, 'recovery 不应提高 Priority');
});
test('PRI4. VETERAN → Need 0 → Priority 由 Gap/Context 决定但不含 growth Need', () => {
  const s = standard(8, 33);
  const r = evaluateDevelopmentPriority(s, 'clb_a', 'd8');
  assertEquals(r.need, 0);
  const raw = C.PRIORITY_WEIGHTS.GAP * r.gap + C.PRIORITY_WEIGHTS.CONTEXT * r.context;
  assert(near(r.priority, Math.min(1, Math.max(0, raw * r.injuryAttenuation * r.environmentModifier))));
});

// ================= Training Intent =================
test('TI1. Training Intent 阈值边界', () => {
  assertEquals(resolveTrainingIntent(0), 'NONE');
  assertEquals(resolveTrainingIntent(0.24), 'NONE');
  assertEquals(resolveTrainingIntent(0.25), 'DEVELOP');
  assertEquals(resolveTrainingIntent(0.49), 'DEVELOP');
  assertEquals(resolveTrainingIntent(0.50), 'ACCELERATE');
  assertEquals(resolveTrainingIntent(1), 'ACCELERATE');
  assertEquals(resolveTrainingIntent(NaN), 'NONE');
});

// ================= Playing Opportunity Intent =================
test('POI1. Playing Opportunity Intent 阈值与 Supply 规则', () => {
  assertEquals(resolvePlayingOpportunityIntent(0.34, 0.30), 'NORMAL');
  assertEquals(resolvePlayingOpportunityIntent(0.35, 0.30), 'NEEDS_MORE_OPPORTUNITY');
  assertEquals(resolvePlayingOpportunityIntent(0.50, 0.20), 'NEEDS_MORE_OPPORTUNITY');
  assertEquals(resolvePlayingOpportunityIntent(0.35, 0.35), 'NEEDS_MORE_OPPORTUNITY');
  assertEquals(resolvePlayingOpportunityIntent(0.35, 0.36), 'NORMAL');
  assertEquals(resolvePlayingOpportunityIntent(0.80, 0.95), 'NORMAL'); // 高 Supply 不触发
  assertEquals(resolvePlayingOpportunityIntent(0.0, 0.10), 'NORMAL');  // 低 Need 不伪造
});

// ================= Plan =================
test('PLAN1. Plan 仅输出两个意图字段', () => {
  const s = standard(8, 20);
  const r = evaluateDevelopmentPlan(s, 'clb_a', 'd8');
  assert(r !== null);
  assertEquals(Object.keys(r).sort(), ['playingOpportunityIntent', 'trainingIntent']);
  assert(['NONE', 'DEVELOP', 'ACCELERATE'].includes(r.trainingIntent));
  assert(['NORMAL', 'NEEDS_MORE_OPPORTUNITY'].includes(r.playingOpportunityIntent));
});
test('PLAN2. VETERAN → NONE + NORMAL', () => {
  const s = standard(8, 33);
  const r = evaluateDevelopmentPlan(s, 'clb_a', 'd8');
  assertEquals(r.trainingIntent, 'NONE');
  assertEquals(r.playingOpportunityIntent, 'NORMAL');
});
test('PLAN3. 无俱乐部（Free Agent）→ null', () => {
  const s = standard(5, 20);
  assertEquals(evaluateDevelopmentPlan(s, null, 'm1'), null);
});

// ================= determinism / invariants / no mutation =================
test('DET1. 相同输入 → 完全相同输出', () => {
  const s = standard(8, 20);
  const a = evaluateDevelopmentPlan(s, 'clb_a', 'm1');
  const b = evaluateDevelopmentPlan(s, 'clb_a', 'm1');
  assertEquals(JSON.stringify(a), JSON.stringify(b));
  const a2 = evaluateDevelopmentPriority(s, 'clb_a', 'd8');
  const b2 = evaluateDevelopmentPriority(s, 'clb_a', 'd8');
  assertEquals(JSON.stringify(a2), JSON.stringify(b2));
});
test('INV1. Need/Gap/Priority ∈ [0,1]，无 NaN / Infinity', () => {
  const s = standard(8, 20);
  for (const p of s.static.players) {
    const n = evaluateDevelopmentNeed(s, 'clb_a', p.id);
    const g = evaluateDevelopmentGap(s, 'clb_a', p.id);
    const pr = evaluateDevelopmentPriority(s, 'clb_a', p.id);
    for (const [k, v] of [['need', n.need], ['gap', g.gap], ['priority', pr.priority]]) {
      assert(Number.isFinite(v), `${p.id}.${k} 非有限`);
      assert(v >= 0 && v <= 1, `${p.id}.${k} 越界`);
    }
  }
});
test('INV2. 不修改 state（无隐藏 mutation）', () => {
  const s = standard(8, 20);
  const before = JSON.stringify(s.runtime);
  for (const p of s.static.players) evaluateDevelopmentPlan(s, 'clb_a', p.id);
  assertEquals(JSON.stringify(s.runtime), before);
});
test('INV3. Schema = 10 / Save = 1 未变', () => {
  assertEquals(GAME_STATE_SCHEMA_VERSION, 10);
  assertEquals(SAVE_FORMAT_VERSION, 1);
});
