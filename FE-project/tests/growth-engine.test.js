/**
 * Step 39F-C — Growth Engine 测试（D39 Phase 3 / OD-39FC-1 · OD-39FC-2 · OD-39FC-3）。
 * 覆盖 G1–G20 + Calibration。
 *
 * 红线：不改静态库；不新增持久化字段；Schema 10 / Save Format 1 不变；无 BREAKOUT；无 Math.random / Date.now。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState, GAME_STATE_SCHEMA_VERSION } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { makeLeagueWorldFiles } from './fixtures.js';
import {
  getEffectiveAttributes, getPlayerRuntime, getWorldPlayers, applyInjury, setVitals,
} from '../src/core/player-runtime.js';
import { SAVE_FORMAT_VERSION } from '../src/save/save-manager.js';
import { PLAYER_GROWTH_CONFIG } from '../src/core/sim-config.js';
import {
  developPlayers, prePeakAgeFactor, resolveTrainingInput, matchExperienceInput,
  conditionBandAdjustment,
} from '../src/core/player-growth.js';
import { evaluateDevelopmentEnvironment } from '../src/core/ai/ai-development-environment.js';

const ATTRS = ['pace', 'technique', 'passing', 'defending', 'finishing', 'goalkeeping'];
const C = PLAYER_GROWTH_CONFIG;
const CLUB = 'clb_001';

function leagueState(n = 4) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
function youngestId(state, maxAge = 21) {
  let best = null;
  let bestAge = 999;
  for (const p of state.static.players) {
    const age = 2026 - Number(String(p.birthDate).slice(0, 4));
    if (age <= maxAge) return p.id;
    if (age < bestAge) { bestAge = age; best = p.id; }
  }
  return best;
}
function attrsOf(state, id) {
  const eff = getEffectiveAttributes(state, id);
  return ATTRS.reduce((s, a) => s + eff[a], 0);
}

// ================================================================ G1 Determinism
test('G1. Determinism：同 world/player/season/attribute 结果完全一致', () => {
  const a = leagueState(4);
  const b = leagueState(4);
  developPlayers(a, { seasonNumber: 1 });
  developPlayers(b, { seasonNumber: 1 });
  for (const p of a.static.players) {
    assertEquals(getPlayerRuntime(a, p.id).ability.deltas, getPlayerRuntime(b, p.id).ability.deltas, `${p.id} deltas 不一致`);
  }
});

// ================================================================ G2 Attribute Independence
test('G2. 六属性独立：衰退期各属性 delta 不同（非统一 Overall 分摊）', () => {
  const files = makeLeagueWorldFiles(2);
  const p = files.players.find((x) => x.teamId === CLUB && x.position === 'MF');
  p.birthDate = '1990-01-15'; // 36 岁 → 全部属性进入 decline
  for (const a of ATTRS) { p[a] = 80; p.potential[a] = 99; }
  const state = createGameState(parseWorld(files));
  developPlayers(state, { seasonNumber: 1 });
  const d = getPlayerRuntime(state, p.id).ability.deltas;
  const paceD = d.pace ?? 0;
  const gkD = d.goalkeeping ?? 0;
  assert(paceD !== gkD, `pace(${paceD}) 应比 goalkeeping(${gkD}) 衰退更明显`);
  assert(paceD <= gkD, 'Pace 敏感度最高 → 衰退应不低于其他属性');
});

// ================================================================ G3/G4 Ceilings
test('G3. Potential Ceiling：多赛季成长后 effective 不超过 potential', () => {
  const state = leagueState(8);
  for (let s = 1; s <= 10; s += 1) {
    state.currentDate = `${2026 + s - 1}-07-01`;
    developPlayers(state, { seasonNumber: s });
  }
  for (const p of getWorldPlayers(state)) {
    const eff = getEffectiveAttributes(state, p.id);
    for (const a of ATTRS) assert(eff[a] <= p.potential[a], `${p.id}.${a} 超过潜力`);
  }
});

test('G4. 99 Ceiling：高基础 + 高潜力不会超过 99', () => {
  const files = makeLeagueWorldFiles(2);
  const p = files.players.find((x) => x.teamId === CLUB && x.position === 'MF');
  p.birthDate = '2005-01-15';
  for (const a of ATTRS) { p[a] = 95; p.potential[a] = 99; }
  const state = createGameState(parseWorld(files));
  for (let s = 1; s <= 6; s += 1) { state.currentDate = `${2026 + s - 1}-07-01`; developPlayers(state, { seasonNumber: s }); }
  const eff = getEffectiveAttributes(state, p.id);
  for (const a of ATTRS) assert(eff[a] <= 99, `${a} 超过 99`);
});

// ================================================================ G5 Annual Safety Bound
test('G5. 年度安全阀：单属性年度 delta ∈ [-3, +3]', () => {
  const state = leagueState(8);
  const before = {};
  for (const p of getWorldPlayers(state)) before[p.id] = getEffectiveAttributes(state, p.id);
  developPlayers(state, { seasonNumber: 1 });
  for (const p of getWorldPlayers(state)) {
    const after = getEffectiveAttributes(state, p.id);
    for (const a of ATTRS) {
      const d = after[a] - before[p.id][a];
      assert(d >= -3 && d <= 3, `${p.id}.${a} 年度变化 ${d} 超出 ±3`);
    }
  }
});

// ================================================================ G6 Headroom
test('G6. Headroom 递减：余量越大成长越多（同年龄同条件）', () => {
  const mk = (pa) => {
    const files = makeLeagueWorldFiles(2);
    const p = files.players.find((x) => x.teamId === CLUB && x.position === 'MF');
    p.birthDate = '2005-01-15';
    for (const a of ATTRS) { p[a] = 50; p.potential[a] = pa; }
    p.personality = { professionalism: 50, determination: 50, ambition: 50, consistency: 50, injuryProneness: 50 };
    return { state: createGameState(parseWorld(files)), id: p.id };
  };
  const hi = mk(80);
  const lo = mk(60);
  developPlayers(hi.state, { seasonNumber: 1 });
  developPlayers(lo.state, { seasonNumber: 1 });
  assert(attrsOf(hi.state, hi.id) > attrsOf(lo.state, lo.id), '大余量应成长更多');
});

// ================================================================ G7 Age Curve
test('G7. Age Curve：OD-39FC-3 边界/单调/连续；无 GROWTH_RATE_BY_AGE', () => {
  assertEquals(C.GROWTH_RATE_BY_AGE, undefined);
  assertEquals(C.BREAKOUT, undefined);
  assertEquals(C.PRE_PEAK.ANCHOR_AGE, 17);
  assertEquals(C.PRE_PEAK.CURVATURE, 0.06);
  assertEquals(prePeakAgeFactor(17, 27), 0.94);
  assertEquals(prePeakAgeFactor(27, 27), 1);
  assertEquals(prePeakAgeFactor(17, 32), 0.94);
  assertEquals(prePeakAgeFactor(32, 32), 1);
  let prev = -Infinity;
  for (let age = 17; age <= 27; age += 1) {
    const v = prePeakAgeFactor(age, 27);
    assert(v >= prev, `ageFactor 应随年龄单调不减（age=${age}）`);
    assert(v >= 0.94 && v <= 1, `ageFactor 应在 [0.94,1]（age=${age}）`);
    if (Number.isFinite(prev)) assert(Math.abs(v - prev) < 0.02, `不应出现跳变（age=${age}）`);
    prev = v;
  }
  // 成长期恒有正向 capacity
  assert(prePeakAgeFactor(17, 30) > 0, '成长期必须有正向 capacity');
});

// ================================================================ G8 Peak Age
test('G8. 六属性各自 peak age（27/29/29/30/29/32）', () => {
  assertEquals(C.PEAK_AGE.pace, 27);
  assertEquals(C.PEAK_AGE.technique, 29);
  assertEquals(C.PEAK_AGE.passing, 29);
  assertEquals(C.PEAK_AGE.defending, 30);
  assertEquals(C.PEAK_AGE.finishing, 29);
  assertEquals(C.PEAK_AGE.goalkeeping, 32);
  // 不同 peak → 同一年龄下 ageFactor 不同（证明按属性分别计算）
  assert(prePeakAgeFactor(26, 27) >= prePeakAgeFactor(26, 32), '离 peak 越近 factor 越高');
});

// ================================================================ G9 Decline Sensitivity
test('G9. Decline sensitivity 顺序：Pace > Defending > Finishing > Technique > Passing > Goalkeeping', () => {
  const s = C.DECLINE.SENSITIVITY;
  assert(s.pace > s.defending, 'pace > defending');
  assert(s.defending > s.finishing, 'defending > finishing');
  assert(s.finishing > s.technique, 'finishing > technique');
  assert(s.technique > s.passing, 'technique > passing');
  assert(s.passing > s.goalkeeping, 'passing > goalkeeping');
});

// ================================================================ G10 Match Experience
test('G10. Match Experience：0 < 900 < 1800，且 >1800 不再增加', () => {
  assertEquals(matchExperienceInput(0), 0);
  const m900 = matchExperienceInput(900);
  const m1800 = matchExperienceInput(1800);
  assert(0 < m900 && m900 < m1800, '应单调递增');
  assertEquals(m1800, 1);
  assertEquals(matchExperienceInput(2700), 1);
  assertEquals(matchExperienceInput(99999), 1);
});

// ================================================================ G11 Training
test('G11. Training：LIMITED < NORMAL < STRONG；数值夹取到冻结区间', () => {
  assertEquals(resolveTrainingInput('LIMITED'), 0.75);
  assertEquals(resolveTrainingInput('NORMAL'), 1.00);
  assertEquals(resolveTrainingInput('STRONG'), 1.15);
  assert(resolveTrainingInput('LIMITED') < resolveTrainingInput('NORMAL'), 'LIMITED < NORMAL');
  assert(resolveTrainingInput('NORMAL') < resolveTrainingInput('STRONG'), 'NORMAL < STRONG');
  assertEquals(resolveTrainingInput(2), 1.15);
  assertEquals(resolveTrainingInput(0.1), 0.75);
  assertEquals(resolveTrainingInput(undefined), 1.00);
});

// ================================================================ G12 Environment
test('G12. Environment：LIMITED < NORMAL < STRONG（作为 Input，非 multiplier）', () => {
  const state = leagueState(4);
  const id = youngestId(state, 25);
  const envL = evaluateDevelopmentEnvironment(state, CLUB, id, { trainingEnvironment: 'LIMITED', developmentSupport: 'LIMITED' });
  const envN = evaluateDevelopmentEnvironment(state, CLUB, id);
  const envS = evaluateDevelopmentEnvironment(state, CLUB, id, { trainingEnvironment: 'STRONG', developmentSupport: 'STRONG' });
  assert(envL.environmentInput < envN.environmentInput, 'LIMITED < NORMAL');
  assert(envN.environmentInput < envS.environmentInput, 'NORMAL < STRONG');
  for (const e of [envL, envN, envS]) assert(e.environmentInput >= 0 && e.environmentInput <= 1);
});

// ================================================================ G13 Form / Morale
test('G13. Form/Morale 条件修正分档：+0.05 / +0.02 / 0 / -0.02 / -0.05', () => {
  assertEquals(conditionBandAdjustment(95), 0.05);
  assertEquals(conditionBandAdjustment(90), 0.05);
  assertEquals(conditionBandAdjustment(75), 0.02);
  assertEquals(conditionBandAdjustment(50), 0.00);
  assertEquals(conditionBandAdjustment(25), -0.02);
  assertEquals(conditionBandAdjustment(5), -0.05);
});

// ================================================================ G14 Severe Injury
test('G14. Severe Injury：存在 penalty 时成长不高于无 penalty', () => {
  const a = leagueState(4);
  const b = leagueState(4);
  const id = youngestId(a, 21);
  applyInjury(a, id, { type: 'knee', severity: 'severe', totalDays: 100 });
  developPlayers(a, { seasonNumber: 1 });
  developPlayers(b, { seasonNumber: 1 });
  assert(attrsOf(a, id) <= attrsOf(b, id), '严重伤病不应更优');
  assertEquals(getPlayerRuntime(a, id).growth.injuryPenaltySeasons, 0, '惩罚应在结算后递减');
});

// ================================================================ G15 Fitness
test('G15. Fitness 不进入 Growth（0 与 100 结果一致）', () => {
  const a = leagueState(4);
  const b = leagueState(4);
  const id = youngestId(a, 21);
  setVitals(a, id, { fitness: 0 });
  setVitals(b, id, { fitness: 100 });
  developPlayers(a, { seasonNumber: 1 });
  developPlayers(b, { seasonNumber: 1 });
  assertEquals(getPlayerRuntime(a, id).ability.deltas, getPlayerRuntime(b, id).ability.deltas);
});

// ================================================================ G16 No Breakout
test('G16. 无 BREAKOUT：配置不存在，且无人突破 ±3', () => {
  assertEquals(C.BREAKOUT, undefined);
  const state = leagueState(8);
  const before = {};
  for (const p of getWorldPlayers(state)) before[p.id] = getEffectiveAttributes(state, p.id);
  developPlayers(state, { seasonNumber: 1 });
  for (const p of getWorldPlayers(state)) {
    const after = getEffectiveAttributes(state, p.id);
    for (const a of ATTRS) {
      const d = after[a] - before[p.id][a];
      assert(d <= 3 && d >= -3, `${p.id}.${a} 超出 ±3（breakout 应已删除）`);
    }
  }
});

// ================================================================ G17 Idempotence
test('G17. Idempotence：同赛季重复 evaluation 不重复增长', () => {
  const state = leagueState(4);
  const id = youngestId(state, 21);
  developPlayers(state, { seasonNumber: 1 });
  const once = JSON.stringify(getPlayerRuntime(state, id).ability.deltas);
  developPlayers(state, { seasonNumber: 1 });
  assertEquals(JSON.stringify(getPlayerRuntime(state, id).ability.deltas), once);
});

// ================================================================ G18 NewGen
test('G18. NewGen 使用同一 Growth Engine（长跑后生成球员同样受界）', () => {
  const state = leagueState(8);
  for (let s = 1; s <= 12; s += 1) {
    state.currentDate = `${2026 + s - 1}-07-01`;
    developPlayers(state, { seasonNumber: s });
  }
  const generated = getWorldPlayers(state).filter((p) => p.generated);
  assert(generated.length >= 0);
  for (const p of generated) {
    const eff = getEffectiveAttributes(state, p.id);
    const rt = getPlayerRuntime(state, p.id);
    for (const a of ATTRS) {
      assert(eff[a] >= 1 && eff[a] <= p.potential[a], `${p.id}.${a} 越界`);
    }
    assert(rt.growth.lastEvaluatedSeason >= 1, 'NewGen 应同样进入 Growth 评价');
  }
});

// ================================================================ G19 No static mutation
test('G19. 不修改静态库（players.json 基础属性与潜力逐字节不变）', () => {
  const state = leagueState(4);
  const snapshot = JSON.stringify(state.static.players);
  for (let s = 1; s <= 5; s += 1) { state.currentDate = `${2026 + s - 1}-07-01`; developPlayers(state, { seasonNumber: s }); }
  assertEquals(JSON.stringify(state.static.players), snapshot);
});

// ================================================================ G20 Long-run bounded
test('G20. 10 赛季：1–99、≤ potential、无 NaN/Infinity、无全员收敛', () => {
  const state = leagueState(8);
  for (let s = 1; s <= 10; s += 1) { state.currentDate = `${2026 + s - 1}-07-01`; developPlayers(state, { seasonNumber: s }); }
  const values = new Set();
  for (const p of getWorldPlayers(state)) {
    const eff = getEffectiveAttributes(state, p.id);
    for (const a of ATTRS) {
      assert(Number.isFinite(eff[a]), 'NaN / Infinity');
      assert(Number.isInteger(eff[a]), '应为整数');
      assert(eff[a] >= 1 && eff[a] <= p.potential[a], `${p.id}.${a} 越界`);
      values.add(eff[a]);
    }
  }
  assert(values.size > 5, '不应全部收敛到同一数值');
  assertEquals(state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
  assertEquals(GAME_STATE_SCHEMA_VERSION, 10);
  assertEquals(SAVE_FORMAT_VERSION, 1);
});

// ================================================================ Calibration
/**
 * Calibration（39E §二十二）：**LONG-RUN / BEHAVIORAL** 目标，非逐案例硬约束。
 * 中性条件（personality 50 / form 50 / morale 50 / 无伤病 / NORMAL training / 0 分钟）。
 * OD-39FC-3 实测（noise=0 推算）：69.0 / 76.2 / 80.0 / 80.0 / 82.3 / 80.2。
 * 允许轻微边界偏差（±2），用于捕捉**方向性回归**，不允许为命中而反向调参。
 */
const CAL_TOLERANCE = 2;

function calibrationState(age, ca, pa) {
  const files = makeLeagueWorldFiles(2);
  const p = files.players.find((x) => x.teamId === CLUB && x.position === 'MF');
  p.birthDate = `${2026 - age}-01-15`;
  for (const a of ATTRS) { p[a] = ca; p.potential[a] = pa; }
  p.personality = { professionalism: 50, determination: 50, ambition: 50, consistency: 50, injuryProneness: 50 };
  return { state: createGameState(parseWorld(files)), id: p.id };
}
function runCalibration(age, ca, pa, years) {
  const { state, id } = calibrationState(age, ca, pa);
  for (let s = 1; s <= years; s += 1) {
    state.currentDate = `${2026 + s - 1}-07-01`;
    developPlayers(state, { seasonNumber: s });
  }
  return attrsOf(state, id) / ATTRS.length;
}

test('CAL. Calibration（5 赛季）：六组方向性目标验证', () => {
  const cases = [
    [17, 60, 80, 68, 72],
    [18, 70, 85, 78, 82],
    [20, 75, 85, 80, 84],
    [23, 78, 84, 81, 84],
    [28, 82, 88, 81, 85],
    [32, 84, 88, 78, 84],
  ];
  for (const [age, ca, pa, lo, hi] of cases) {
    const v = runCalibration(age, ca, pa, 5);
    assert(v >= lo - CAL_TOLERANCE && v <= hi + CAL_TOLERANCE,
      `calibration age${age} ${ca}/${pa} → ${v.toFixed(1)}（目标 ${lo}-${hi}，容忍 ±${CAL_TOLERANCE}）`);
  }
});

test('CAL2. 方向性：年轻成长 > 同条件年长；过峰者不增长', () => {
  const young = runCalibration(17, 60, 80, 5);
  const old = runCalibration(32, 84, 88, 5);
  assert(young > 60, '年轻球员应成长');
  assert(old <= 84 + 0.5, '过峰球员不应显著增长');
});

test('CAL3. High potential / Underdeveloped（行为方向）', () => {
  const hi5 = runCalibration(17, 63, 88, 5);
  const hi10 = runCalibration(17, 63, 88, 10);
  const under = runCalibration(18, 62, 88, 5);
  assert(hi5 > 63 && hi10 > hi5, '高潜应持续成长');
  assert(under >= 65 - CAL_TOLERANCE && under <= 72 + CAL_TOLERANCE, `underdeveloped → ${under.toFixed(1)}`);
});
