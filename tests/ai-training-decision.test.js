/**
 * Step 39F-J — AI Training Decision 测试。
 * 覆盖 T1–T27：NORMAL 默认、Hard Gates（INJURED / INJURY_RECOVERY / VETERAN / load）、
 * phase 规则、headroom/environment/personality bounded、determinism、teamAvailableMatches、
 * 无 mutation、不改 Growth / selection / minutes / save。
 *
 * 红线：不改 Growth / 39F-G / 39F-H / Injury / Match；无 RNG；schema 10 / save 1。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState, GAME_STATE_SCHEMA_VERSION } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { makeLeagueWorldFiles } from './fixtures.js';
import { SAVE_FORMAT_VERSION } from '../src/save/save-manager.js';
import {
  getPlayerProfile, getPlayerRuntime, applyInjury, INJURY_STATUS,
} from '../src/core/player-runtime.js';
import { getClubPlayers } from '../src/core/membership.js';
import { resolveMatchSquad } from '../src/core/team-strength.js';
import { matchExperienceInput, resolveTrainingInput } from '../src/core/player-growth.js';
import { PLAYER_GROWTH_CONFIG, MATCH_LOAD_CONFIG } from '../src/core/sim-config.js';
import { getTeamAvailableMatches, getClubCompletedMatches } from '../src/core/ai/ai-development-signals.js';
import {
  evaluateTrainingDecision, resolveTrainingLevel, createTrainingProvider, classifySeasonLoad,
} from '../src/core/ai/ai-training-decision.js';
import { AI_TRAINING_DECISION_CONFIG } from '../src/core/ai/ai-config.js';

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
function findPlayer(state, clubId, position) {
  return getClubPlayers(state, clubId)
    .map((id) => getPlayerProfile(state, id))
    .find((p) => p && p.position === position) ?? null;
}
function setAge(state, playerId, age) {
  state.static.players.find((p) => p.id === playerId).birthDate = `${2026 - age}-01-15`;
}
function setPersonality(state, playerId, value) {
  const p = state.static.players.find((x) => x.id === playerId);
  p.personality = {
    professionalism: value, determination: value, ambition: value, consistency: value, injuryProneness: value,
  };
}
function setMinutes(state, playerId, minutes) {
  getPlayerRuntime(state, playerId).stats.season.minutes = minutes;
}
let fxSeq = 0;
/** 为某 club/season 注入 count 场 match_played 事件。 */
function seedMatches(state, clubId, season, count) {
  for (let i = 0; i < count; i += 1) {
    fxSeq += 1;
    state.runtime.events.push({
      date: state.currentDate,
      type: 'match_played',
      payload: {
        leagueId: 'lg_a', season, round: 1, fixtureId: `fx_${season}_${clubId}_${fxSeq}`,
        homeId: clubId, awayId: 'clb_002', score: '1-0',
      },
    });
  }
}
/** 一个可用于决策测试的球员（clb_001, MF）。 */
function target(state) {
  return findPlayer(state, 'clb_001', 'MF');
}

// ---------- T1 NORMAL default ----------
test('T1. PRIME 普通球员无 caps ⇒ NORMAL（默认 baseline）', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 27);
  setPersonality(s, p.id, 60);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 700); // load 0.556 → NORMAL band
  const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(r.trainingLevel, 'NORMAL');
});

// ---------- T2 INJURED → LIMITED ----------
test('T2. INJURED ⇒ LIMITED / INJURED', () => {
  const s = leagueState(8);
  const p = target(s);
  applyInjury(s, p.id, { type: 'knock', totalDays: 30, date: s.currentDate });
  const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(r.trainingLevel, 'LIMITED');
  assert(r.limitingFactors.includes('INJURED'));
});

// ---------- T3 INJURY_RECOVERY → not STRONG ----------
test('T3. injuryPenaltySeasons>0 ⇒ 最大 NORMAL / INJURY_RECOVERY', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 18);
  setPersonality(s, p.id, 99);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 100);
  getPlayerRuntime(s, p.id).growth.injuryPenaltySeasons = 1;
  const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(r.trainingLevel, 'NORMAL');
  assert(r.limitingFactors.includes('INJURY_RECOVERY'));
});

// ---------- T4 / T12 VETERAN → not STRONG ----------
test('T4/T12. VETERAN ⇒ 禁止 STRONG / VETERAN_PHASE', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 33);
  setPersonality(s, p.id, 99);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 100);
  const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(r.trainingLevel, 'NORMAL');
  assert(r.limitingFactors.includes('VETERAN_PHASE'));
});

// ---------- T5 (39F-J-C) HIGH participation 不自动限制 ----------
test('T5. HIGH match participation 不自动限制（年轻 STRONG-eligible 仍 STRONG）', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 18);
  setPersonality(s, p.id, 99);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, Math.round(14 * 90 * 0.65)); // participation 0.65（旧语义 HIGH）
  const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(r.trainingLevel, 'STRONG');
  assert(!r.limitingFactors.includes('HIGH_MATCH_LOAD'));
});

// ---------- T6 (39F-J-C) VERY_HIGH participation 不导致 LIMITED ----------
test('T6. VERY_HIGH match participation 本身不产生 LIMITED', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 18);
  setPersonality(s, p.id, 99);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, Math.round(14 * 90 * 0.85)); // participation 0.85（旧语义 VERY_HIGH）
  const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(r.trainingLevel, 'STRONG');
  assert(r.trainingLevel !== 'LIMITED');
  assert(!r.limitingFactors.includes('VERY_HIGH_MATCH_LOAD'));
});

// ---------- C1 (39F-J-C) participation 扫描：超高暴露不压低 STRONG ----------
test('C1. 年轻 STRONG-eligible：participation 20%–100% 均不产生 LIMITED', () => {
  for (const rate of [0.20, 0.40, 0.60, 0.80, 0.90, 1.00]) {
    const s = leagueState(8);
    const p = target(s);
    setAge(s, p.id, 18);
    setPersonality(s, p.id, 99);
    seedMatches(s, 'clb_001', 1, 14);
    setMinutes(s, p.id, Math.round(14 * 90 * rate));
    const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
    assertEquals(r.trainingLevel, 'STRONG', `participation ${rate} 不应压低 STRONG`);
  }
});

// ---------- T7 LOW load does not create bonus ----------
test('T7. 低分钟不产生训练奖励（PRIME 低 load 仍 NORMAL）', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 28);
  setPersonality(s, p.id, 99);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 0); // load 0 → LOW
  const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(r.trainingLevel, 'NORMAL');
  assertEquals(classifySeasonLoad(0), 'LOW');
});

// ---------- T8 / T9 / T10 STRONG phases ----------
test('T8. EMERGING + strong signals ⇒ STRONG', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 17);
  setPersonality(s, p.id, 90);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 200);
  const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(r.trainingLevel, 'STRONG');
});

test('T9. DEVELOPING + strong signals ⇒ STRONG', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 19);
  setPersonality(s, p.id, 95);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 200);
  const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(r.trainingLevel, 'STRONG');
});

test('T10. ESTABLISHING + strong signals ⇒ STRONG', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 23);
  setPersonality(s, p.id, 95);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 200);
  const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(r.trainingLevel, 'STRONG');
});

// ---------- T11 PRIME does not STRONG ----------
test('T11. PRIME ⇒ 不 STRONG', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 27);
  setPersonality(s, p.id, 99);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 200);
  const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(r.trainingLevel, 'NORMAL');
});

// ---------- T13 high headroom does not force STRONG ----------
test('T13. 高 headroom 不自动 STRONG（低 personality 阻断）', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 17); // 高 headroom
  setPersonality(s, p.id, 1); // 明显负向
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 200);
  const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(r.trainingLevel, 'NORMAL');
});

// ---------- T14 (39F-J-C) 差环境不产生 LIMITED（LIMITED 仅来自 Hard Gate / Relative Role Load） ----------
test('T14. 差环境不产生 LIMITED（C 后无 Absolute Match Load Gate）', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 24);
  setPersonality(s, p.id, 60);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 300);
  const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assert(r.trainingLevel !== 'LIMITED');
});

// ---------- T15 personality cannot bypass hard gates ----------
test('T15. personality 不能突破 Hard Gate（INJURED/VETERAN）', () => {
  const s = leagueState(8);
  const p = target(s);
  setPersonality(s, p.id, 99);
  const rt = getPlayerRuntime(s, p.id);
  applyInjury(s, p.id, { type: 'knock', totalDays: 20, date: s.currentDate });
  assertEquals(evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 }).trainingLevel, 'LIMITED');
  rt.injury = { ...rt.injury, status: INJURY_STATUS.FIT, daysRemaining: 0, totalDays: 0 };
  setAge(s, p.id, 34);
  assertEquals(evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 }).trainingLevel, 'NORMAL');
});

// ---------- T16 missing age → NORMAL + MISSING_AGE ----------
test('T16. 缺 birthDate ⇒ NORMAL + MISSING_AGE', () => {
  const s = leagueState(8);
  const p = target(s);
  s.static.players.find((x) => x.id === p.id).birthDate = '';
  const r = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(r.trainingLevel, 'NORMAL');
  assert(r.limitingFactors.includes('MISSING_AGE'));
});

// ---------- T17 determinism ----------
test('T17. 相同输入 ⇒ 相同输出（deterministic）', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 18);
  setPersonality(s, p.id, 90);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 200);
  const a = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  const b = evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(a.trainingLevel, b.trainingLevel);
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

// ---------- T18 teamAvailableMatches counts full-season fixtures ----------
test('T18. teamAvailableMatches = 完整赛季规模（8 队双循环 = 14）', () => {
  const s = leagueState(8);
  new SimulationCore({ enableAI: false }).advanceDays(s, 95); // 完成第 1 季并滚动
  assertEquals(getTeamAvailableMatches(s, 'clb_001', 1), 14);
});

// ---------- T19 completed matches not used as denominator ----------
test('T19. 赛季边界上不用 current-comp completed（此时为 0）', () => {
  const s = leagueState(8);
  new SimulationCore({ enableAI: false }).advanceDays(s, 95);
  // 边界后 competitions 已是下一季（未赛）⇒ getClubCompletedMatches == 0
  assertEquals(getClubCompletedMatches(s, 'clb_001'), 0);
  // 但仍能取到完赛赛季（season 1）的完整规模
  assertEquals(getTeamAvailableMatches(s, 'clb_001', 1), 14);
});

// ---------- T20 multiple competitions counted ----------
test('T20. 多 competition 正确合并计数', () => {
  const s = leagueState(8);
  s.runtime.events.length = 0;
  seedMatches(s, 'clb_001', 5, 3); // leagueId lg_a
  for (let i = 0; i < 2; i += 1) {
    fxSeq += 1;
    s.runtime.events.push({
      date: s.currentDate, type: 'match_played',
      payload: { leagueId: 'cup_x', season: 5, round: 1, fixtureId: `cup_${fxSeq}`, homeId: 'clb_001', awayId: 'clb_003' },
    });
  }
  assertEquals(getTeamAvailableMatches(s, 'clb_001', 5), 5);
});

// ---------- T21 duplicate fixture counted once ----------
test('T21. 重复 fixture 只计一次', () => {
  const s = leagueState(8);
  s.runtime.events.length = 0;
  const payload = { leagueId: 'lg_a', season: 6, round: 1, fixtureId: 'dup_1', homeId: 'clb_001', awayId: 'clb_002' };
  s.runtime.events.push({ date: s.currentDate, type: 'match_played', payload });
  s.runtime.events.push({ date: s.currentDate, type: 'match_played', payload: { ...payload } });
  assertEquals(getTeamAvailableMatches(s, 'clb_001', 6), 1);
});

// ---------- T22 cross-season excluded ----------
test('T22. 跨赛季 fixture 不计入当前赛季', () => {
  const s = leagueState(8);
  s.runtime.events.length = 0;
  seedMatches(s, 'clb_001', 1, 3);
  seedMatches(s, 'clb_001', 2, 4);
  assertEquals(getTeamAvailableMatches(s, 'clb_001', 1), 3);
  assertEquals(getTeamAvailableMatches(s, 'clb_001', 2), 4);
});

// ---------- T23 load boundaries ----------
test('T23. 负荷率分档边界', () => {
  assertEquals(classifySeasonLoad(0.29), 'LOW');
  assertEquals(classifySeasonLoad(0.30), 'NORMAL');
  assertEquals(classifySeasonLoad(0.59), 'NORMAL');
  assertEquals(classifySeasonLoad(0.60), 'HIGH');
  assertEquals(classifySeasonLoad(0.79), 'HIGH');
  assertEquals(classifySeasonLoad(0.80), 'VERY_HIGH');
});

// ---------- T24 no mutation ----------
test('T24. Training Decision 不修改 state', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 18);
  setPersonality(s, p.id, 90);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 200);
  const before = JSON.stringify(s.runtime);
  evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(JSON.stringify(s.runtime), before);
});

// ---------- T25 does not modify Growth formula ----------
test('T25. 不改 Growth 公式/参数（training 值不变）', () => {
  assertEquals(PLAYER_GROWTH_CONFIG.TRAINING_LEVELS.LIMITED, 0.75);
  assertEquals(PLAYER_GROWTH_CONFIG.TRAINING_LEVELS.NORMAL, 1.00);
  assertEquals(PLAYER_GROWTH_CONFIG.TRAINING_LEVELS.STRONG, 1.15);
  assertEquals(resolveTrainingInput('STRONG'), 1.15);
  assertEquals(matchExperienceInput(1800), 1);
  assertEquals(matchExperienceInput(0), 0);
});

// ---------- T26 / T27 no selection / minutes mutation ----------
test('T26/T27. 不改 selection / minutes', () => {
  const s = leagueState(8);
  const p = target(s);
  setAge(s, p.id, 19);
  setPersonality(s, p.id, 90);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 200);
  const xiBefore = JSON.stringify(resolveMatchSquad(s, 'clb_001', {}).map((x) => x.id));
  const minBefore = getPlayerRuntime(s, p.id).stats.season.minutes;
  evaluateTrainingDecision(s, 'clb_001', p.id, { seasonNumber: 1 });
  assertEquals(JSON.stringify(resolveMatchSquad(s, 'clb_001', {}).map((x) => x.id)), xiBefore);
  assertEquals(getPlayerRuntime(s, p.id).stats.season.minutes, minBefore);
});

// ---------- MANAGED / AI boundary ----------
test('B1. Managed Club player ⇒ 始终 NORMAL（不受 Training Decision 影响）', () => {
  const s = leagueState(8);
  s.runtime.managedClubId = 'clb_001';
  const p = target(s);
  setAge(s, p.id, 18);
  setPersonality(s, p.id, 99);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 100);
  assertEquals(resolveTrainingLevel(s, p.id, { seasonNumber: 1 }), 'NORMAL');
});

test('B2. AI Club player ⇒ 经过 Training Decision（EMERGING 可 STRONG）', () => {
  const s = leagueState(8);
  s.runtime.managedClubId = 'clb_008';
  const p = target(s);
  setAge(s, p.id, 18);
  setPersonality(s, p.id, 95);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 100);
  assertEquals(resolveTrainingLevel(s, p.id, { seasonNumber: 1 }), 'STRONG');
});

test('B3. Free agent（无 club）⇒ NORMAL', () => {
  const s = leagueState(8);
  const p = target(s);
  s.runtime.membership.players[p.id] = null;
  assertEquals(resolveTrainingLevel(s, p.id, { seasonNumber: 1 }), 'NORMAL');
});

test('B4. createTrainingProvider 返回合法档位', () => {
  const s = leagueState(8);
  const provider = createTrainingProvider(s);
  const p = target(s);
  setAge(s, p.id, 18);
  setPersonality(s, p.id, 90);
  seedMatches(s, 'clb_001', 1, 14);
  setMinutes(s, p.id, 100);
  const lvl = provider(p.id, { seasonNumber: 1 });
  assert(['LIMITED', 'NORMAL', 'STRONG'].includes(lvl));
});

// ---------- T: schema unchanged ----------
test('T: Schema = 10 / Save = 1 未变', () => {
  assertEquals(GAME_STATE_SCHEMA_VERSION, 10);
  assertEquals(SAVE_FORMAT_VERSION, 1);
});

// ---------- 生态 smoke：多赛季 + determinism ----------
test('ECO. 多赛季：档位不全 STRONG / 不全 LIMITED，且 deterministic', () => {
  const levels = new Map();
  function run() {
    const s = leagueState(8);
    new SimulationCore({ enableAI: true }).advanceDays(s, 400); // 多赛季
    return s;
  }
  const a = run();
  const b = run();
  // determinism：两次结果一致
  const digest = (s) => JSON.stringify(Object.keys(s.runtime.players).sort().map((id) => {
    const d = s.runtime.players[id].ability.deltas;
    return `${id}:${JSON.stringify(d)}:${s.runtime.players[id].stats.season.minutes}`;
  }));
  assertEquals(digest(a), digest(b));

  for (const id of Object.keys(a.runtime.players)) {
    const club = a.runtime.membership.players[id];
    if (!club || club === a.runtime.managedClubId) continue;
    const r = evaluateTrainingDecision(a, club, id, { seasonNumber: a.season });
    levels.set(r.trainingLevel, (levels.get(r.trainingLevel) || 0) + 1);
  }
  const total = [...levels.values()].reduce((x, y) => x + y, 0);
  assert(total > 0, '应有可评估球员');
  assert((levels.get('STRONG') || 0) < total, '不应全部 STRONG');
  assert((levels.get('LIMITED') || 0) < total, '不应全部 LIMITED');
  assert((levels.get('NORMAL') || 0) > 0, '应有 NORMAL');
  assert(!Number.isNaN(total));
});
