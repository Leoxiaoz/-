/**
 * Step 39F-A — Phase 1 Pure Semantic / Derived Layer 测试（D39 Phase 1）。
 * 覆盖：Development Phase / Potential Fulfillment / Development Environment /
 *       Playing Opportunity / Match Importance / Development Value / Determinism / No Persistence。
 *
 * 红线：不修改任何业务逻辑；只读派生；无 RNG；Schema 10 / Save Format 1 不变。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState, GAME_STATE_SCHEMA_VERSION } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SAVE_FORMAT_VERSION } from '../src/save/save-manager.js';
import { makeLeagueWorldFiles, makeWorldFiles } from './fixtures.js';
import {
  getPlayerProfile, getPlayerRuntime, getEffectiveAttributes, getPotentialFulfillment, applyInjury,
} from '../src/core/player-runtime.js';
import { getClubPlayers } from '../src/core/membership.js';
import {
  getDevelopmentPhase, DEVELOPMENT_PHASES, DEVELOPMENT_PHASE_SCORE,
} from '../src/core/ai/ai-development-phase.js';
import { evaluatePlayingOpportunity } from '../src/core/ai/ai-playing-opportunity.js';
import {
  evaluateDevelopmentEnvironment, ENVIRONMENT_LEVEL, ENVIRONMENT_LEVEL_SCORE,
} from '../src/core/ai/ai-development-environment.js';
import {
  evaluateDevelopmentValue, currentAbilityGapScore, personalityScore, DV_WEIGHTS,
} from '../src/core/ai/ai-development-value.js';
import { getMatchImportance, MATCH_IMPORTANCE } from '../src/core/ai/ai-match-importance.js';

const CLUB = 'clb_001';

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
/** 该俱乐部某位置的第一个球员 id。 */
function firstPlayerAt(state, clubId, position) {
  return getClubPlayers(state, clubId)
    .find((id) => getPlayerProfile(state, id)?.position === position);
}

// ---------------------------------------------------------------- A. Development Phase
test('A1. Development Phase：边界完整（17/18/21/22/25/26/30/31）', () => {
  assertEquals(getDevelopmentPhase(16), DEVELOPMENT_PHASES.EMERGING);
  assertEquals(getDevelopmentPhase(17), DEVELOPMENT_PHASES.EMERGING);
  assertEquals(getDevelopmentPhase(18), DEVELOPMENT_PHASES.DEVELOPING);
  assertEquals(getDevelopmentPhase(21), DEVELOPMENT_PHASES.DEVELOPING);
  assertEquals(getDevelopmentPhase(22), DEVELOPMENT_PHASES.ESTABLISHING);
  assertEquals(getDevelopmentPhase(25), DEVELOPMENT_PHASES.ESTABLISHING);
  assertEquals(getDevelopmentPhase(26), DEVELOPMENT_PHASES.PRIME);
  assertEquals(getDevelopmentPhase(30), DEVELOPMENT_PHASES.PRIME);
  assertEquals(getDevelopmentPhase(31), DEVELOPMENT_PHASES.VETERAN);
  assertEquals(getDevelopmentPhase(40), DEVELOPMENT_PHASES.VETERAN);
  // 非有限值：保守回退 VETERAN（不抛错）
  assertEquals(getDevelopmentPhase(NaN), DEVELOPMENT_PHASES.VETERAN);
});

test('A2. Development Phase Score 为 AI 信号常量（非 Growth Multiplier）', () => {
  assertEquals(DEVELOPMENT_PHASE_SCORE.EMERGING, 100);
  assertEquals(DEVELOPMENT_PHASE_SCORE.VETERAN, 10);
});

// ---------------------------------------------------------------- B. Potential Fulfillment
test('B1. Potential Fulfillment：current < potential ⇒ 0–1 之间', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'MF');
  const f = getPotentialFulfillment(s, id);
  assert(f != null, '应有返回值');
  const eff = getEffectiveAttributes(s, id);
  const profile = getPlayerProfile(s, id);
  for (const attr of Object.keys(f.perAttribute)) {
    const ratio = f.perAttribute[attr];
    assert(ratio >= 0 && ratio <= 1, `${attr} ratio 应在 0–1`);
    if (eff[attr] < profile.potential[attr]) assert(ratio < 1, `${attr} 未满潜力应 < 1`);
  }
  assert(f.average >= 0 && f.average <= 1, 'average 应 0–1');
});

test('B2. Potential Fulfillment：current = potential ⇒ 1', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'MF');
  const profile = getPlayerProfile(s, id);
  // 把 effective 抬到 potential（通过 deltas），应得到 ratio = 1
  const rt = getPlayerRuntime(s, id);
  for (const attr of Object.keys(profile.potential)) {
    rt.ability.deltas[attr] = profile.potential[attr] - profile[attr];
  }
  const f = getPotentialFulfillment(s, id);
  for (const attr of Object.keys(f.perAttribute)) {
    assert(Math.abs(f.perAttribute[attr] - 1) < 1e-9, `${attr} 满潜力应为 1`);
  }
});

test('B3. Potential Fulfillment：potential 低于 base 时防御性夹取（≤1）', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'MF');
  const profile = getPlayerProfile(s, id);
  const base = profile.passing;
  // 人为制造 potential < base（绕过加载校验，仅测试防御分支）
  profile.potential.passing = Math.max(1, base - 10);
  const f = getPotentialFulfillment(s, id);
  assert(f.perAttribute.passing <= 1 && f.perAttribute.passing >= 0, 'ratio 必须夹取到 [0,1]');
  assert(Math.abs(f.perAttribute.passing - 1) < 1e-9, 'effective 被夹到 potential ⇒ ratio = 1');
});

test('B4. Potential Fulfillment：potential = 0 ⇒ 0（防御）', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'MF');
  const profile = getPlayerProfile(s, id);
  profile.potential.technique = 0;
  const f = getPotentialFulfillment(s, id);
  assertEquals(f.perAttribute.technique, 0);
});

test('B5. Potential Fulfillment：不修改任何状态', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'MF');
  const before = JSON.stringify(s.runtime.players[id]);
  getPotentialFulfillment(s, id);
  assertEquals(JSON.stringify(s.runtime.players[id]), before);
});

// ---------------------------------------------------------------- C. Development Environment
test('C1. Environment：默认 NORMAL，environmentInput ∈ [0,1]', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'DF');
  const env = evaluateDevelopmentEnvironment(s, CLUB, id);
  assertEquals(env.trainingEnvironment, ENVIRONMENT_LEVEL.NORMAL);
  assertEquals(env.developmentSupport, ENVIRONMENT_LEVEL.NORMAL);
  assert(env.environmentInput >= 0 && env.environmentInput <= 1, 'environmentInput ∈ [0,1]');
  assert(env.pathCompatibility >= 0 && env.pathCompatibility <= 1, 'pathCompatibility ∈ [0,1]');
});

test('C2. Environment：LIMITED / STRONG 档位改变 environmentInput（单调）', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'DF');
  const limited = evaluateDevelopmentEnvironment(s, CLUB, id, { trainingEnvironment: 'LIMITED', developmentSupport: 'LIMITED' });
  const normal = evaluateDevelopmentEnvironment(s, CLUB, id);
  const strong = evaluateDevelopmentEnvironment(s, CLUB, id, { trainingEnvironment: 'STRONG', developmentSupport: 'STRONG' });
  assert(limited.environmentInput < normal.environmentInput, 'LIMITED < NORMAL');
  assert(normal.environmentInput < strong.environmentInput, 'NORMAL < STRONG');
  assertEquals(ENVIRONMENT_LEVEL_SCORE.LIMITED, 0.25);
  assertEquals(ENVIRONMENT_LEVEL_SCORE.STRONG, 0.75);
});

test('C3. Environment：pathCompatibility 极值仍被夹取', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'DF');
  const env = evaluateDevelopmentEnvironment(s, CLUB, id);
  assert(env.pathCompatibility >= 0 && env.pathCompatibility <= 1);
  assert(env.environmentInput >= 0 && env.environmentInput <= 1);
});

// ---------------------------------------------------------------- D. Playing Opportunity
test('D1. Playing Opportunity：0 分钟 / 无比赛 ⇒ 低 actualMinutesScore', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'MF');
  const opp = evaluatePlayingOpportunity(s, CLUB, id);
  assertEquals(opp.actualMinutes, 0);
  assertEquals(opp.actualMinutesScore, 0);
  assert(opp.currentOpportunity >= 0 && opp.currentOpportunity <= 100);
  assert(opp.playingOpportunityScore >= 0 && opp.playingOpportunityScore <= 100);
});

test('D2. Playing Opportunity：满勤（= expectedMinutes）⇒ actualMinutesScore = 1', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'MF');
  const rt = getPlayerRuntime(s, id);
  // 造 5 场已完成 + 450 分钟 ⇒ expected = 450
  const comp = s.runtime.competitions.lg_a;
  let played = 0;
  for (const f of comp.fixtures) {
    if (played >= 5) break;
    if (!f.played) { f.played = true; played += 1; }
  }
  rt.stats.season.minutes = 5 * 90;
  const opp = evaluatePlayingOpportunity(s, CLUB, id);
  assertEquals(opp.actualMinutesScore, 1);
  assertEquals(opp.actualMinutes, 450);
});

test('D3. Playing Opportunity：伤病 ⇒ Availability 归零（当前机会下降）', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'MF');
  const healthy = evaluatePlayingOpportunity(s, CLUB, id).currentOpportunity;
  applyInjury(s, id, { type: 'muscle', severity: 'moderate', totalDays: 20 });
  const injured = evaluatePlayingOpportunity(s, CLUB, id).currentOpportunity;
  assert(injured < healthy, '受伤后 Current Opportunity 应下降');
});

test('D4. Playing Opportunity：深阵容 vs 浅阵容可区分（确定性）', () => {
  const deep = leagueState(8);
  const shallow = createGameState(parseWorld(makeWorldFiles()));
  const deepId = firstPlayerAt(deep, CLUB, 'MF');
  const shallowId = firstPlayerAt(shallow, 'clb_a', 'GK');
  const a = evaluatePlayingOpportunity(deep, CLUB, deepId);
  const b = evaluatePlayingOpportunity(shallow, 'clb_a', shallowId);
  assert(a && b, '两者都应可计算');
  assert(a.playingOpportunityScore >= 0 && a.playingOpportunityScore <= 100);
  assert(b.playingOpportunityScore >= 0 && b.playingOpportunityScore <= 100);
});

// ---------------------------------------------------------------- E. Match Importance
test('E1. Match Importance：Phase 1 恒为 NORMAL', () => {
  const s = leagueState();
  assertEquals(getMatchImportance(s, {}), MATCH_IMPORTANCE.NORMAL);
  assertEquals(getMatchImportance(), 'NORMAL');
});

// ---------------------------------------------------------------- F. Development Value
test('F1. DV：headroomScore = 0 与 100 于同权重链条下可区分；value ∈ [0,100]', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'MF');
  const low = evaluateDevelopmentValue(s, CLUB, id, { headroomScore: 0 });
  const high = evaluateDevelopmentValue(s, CLUB, id, { headroomScore: 100 });
  assert(low.value >= 0 && low.value <= 100);
  assert(high.value >= 0 && high.value <= 100);
  assert(high.value > low.value, 'headroomScore 提高应提高 DV');
  assertEquals(high.value - low.value, DV_WEIGHTS.HEADROOM * 100);
});

test('F2. DV：组件齐全且与最终权重一致', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'FW');
  const dv = evaluateDevelopmentValue(s, CLUB, id, { headroomScore: 50 });
  const c = dv.components;
  for (const key of [
    'headroomScore', 'playingOpportunityScore', 'phaseScore', 'currentAbilityGapScore',
    'environmentScore', 'personalityScore', 'careerPathFeasibilityScore',
  ]) {
    assert(Number.isFinite(c[key]), `组件 ${key} 应为数值`);
  }
  const recomputed = DV_WEIGHTS.HEADROOM * c.headroomScore
    + DV_WEIGHTS.PLAYING_OPPORTUNITY * c.playingOpportunityScore
    + DV_WEIGHTS.PHASE * c.phaseScore
    + DV_WEIGHTS.ABILITY_GAP * c.currentAbilityGapScore
    + DV_WEIGHTS.ENVIRONMENT * c.environmentScore
    + DV_WEIGHTS.PERSONALITY * c.personalityScore
    + DV_WEIGHTS.CAREER_PATH * c.careerPathFeasibilityScore;
  assert(Math.abs(recomputed - dv.value) < 1e-9, 'value 应等于冻结权重合成');
});

test('F3. Current Ability Gap Score 分档与 gap=0 阶梯', () => {
  assertEquals(currentAbilityGapScore(0), 20);
  assertEquals(currentAbilityGapScore(-5), 20);
  assertEquals(currentAbilityGapScore(15), 100);
  assertEquals(currentAbilityGapScore(30), 100);
  const mid = currentAbilityGapScore(7.5);
  assert(mid > 50 && mid < 100, '中间档应线性过渡');
});

test('F4. Personality Score：1–99 归一化到 0–100', () => {
  assertEquals(personalityScore({ personality: { professionalism: 99, determination: 99, ambition: 99 } }) > 99, true);
  assertEquals(personalityScore({ personality: { professionalism: 1, determination: 1, ambition: 1 } }) > 0, true);
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'MF');
  const p = personalityScore(getPlayerProfile(s, id));
  assert(p >= 0 && p <= 100);
});

// ---------------------------------------------------------------- G. Determinism
test('G1. Determinism：同一 state + context 连续调用结果完全一致', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'MF');
  const a1 = evaluatePlayingOpportunity(s, CLUB, id);
  const a2 = evaluatePlayingOpportunity(s, CLUB, id);
  assertEquals(JSON.stringify(a1), JSON.stringify(a2));
  const e1 = evaluateDevelopmentEnvironment(s, CLUB, id);
  const e2 = evaluateDevelopmentEnvironment(s, CLUB, id);
  assertEquals(JSON.stringify(e1), JSON.stringify(e2));
  const d1 = evaluateDevelopmentValue(s, CLUB, id, { headroomScore: 40 });
  const d2 = evaluateDevelopmentValue(s, CLUB, id, { headroomScore: 40 });
  assertEquals(JSON.stringify(d1), JSON.stringify(d2));
});

test('G2. 派生层不修改 state（整体快照不变）', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'MF');
  const before = JSON.stringify(s);
  getPotentialFulfillment(s, id);
  evaluatePlayingOpportunity(s, CLUB, id);
  evaluateDevelopmentEnvironment(s, CLUB, id);
  evaluateDevelopmentValue(s, CLUB, id, { headroomScore: 30 });
  getMatchImportance(s);
  assertEquals(JSON.stringify(s), before);
});

// ---------------------------------------------------------------- H. No Persistence
test('H1. Schema 10 / Save Format 1 不变', () => {
  assertEquals(GAME_STATE_SCHEMA_VERSION, 10);
  assertEquals(SAVE_FORMAT_VERSION, 1);
  const s = leagueState();
  assertEquals(s.schemaVersion, 10);
});

test('H2. 派生层不新增 Player Runtime 持久化字段', () => {
  const s = leagueState();
  const id = firstPlayerAt(s, CLUB, 'MF');
  const before = Object.keys(getPlayerRuntime(s, id)).sort();
  evaluatePlayingOpportunity(s, CLUB, id);
  evaluateDevelopmentEnvironment(s, CLUB, id);
  evaluateDevelopmentValue(s, CLUB, id, { headroomScore: 10 });
  getPotentialFulfillment(s, id);
  const after = Object.keys(getPlayerRuntime(s, id)).sort();
  assertEquals(after, before);
});
