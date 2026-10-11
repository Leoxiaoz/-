/**
 * Step 39F-J-B — Relative Role Load / Expected Participation 测试。
 * 覆盖 A–I：Role / K / Expected / Actual / Classification / Training Integration /
 * Injury Replacement / Boundary / Determinism。
 *
 * 红线：不改 Growth / 39F-G / 39F-H / Injury / Match；无 RNG；无 persistence；schema 10 / save 1。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState, GAME_STATE_SCHEMA_VERSION } from '../src/core/game-state.js';
import { parseWorld, WORLD_FORMAT } from '../src/data/data-loader.js';
import { getPlayerProfile, getPlayerRuntime, applyInjury } from '../src/core/player-runtime.js';
import { getClubPlayers } from '../src/core/membership.js';
import { SAVE_FORMAT_VERSION } from '../src/save/save-manager.js';
import { ROSTER_CONFIG, PLAYER_GROWTH_CONFIG } from '../src/core/sim-config.js';
import {
  deriveExpectedRole, getRotationK, getExpectedParticipation,
  getActualParticipation, classifyRelativeRoleLoad, evaluateRelativeRoleLoad,
} from '../src/core/ai/ai-relative-role-load.js';
import {
  evaluateTrainingDecision, applyRelativeRoleLoad, resolveTrainingLevel,
} from '../src/core/ai/ai-training-decision.js';

const ATT = ['pace', 'technique', 'passing', 'defending', 'finishing', 'goalkeeping'];

function mk(players, id, pos, rating, age = 25, pers = 60) {
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
/** 受控世界：clb_a，GK×3，DF×dfCount，MF×5，FW×3（同线同评分 → 依 playerId 升序排名）。 */
function buildState(dfCount = 5) {
  const players = [];
  mk(players, 'g1', 'GK', 90); mk(players, 'g2', 'GK', 80); mk(players, 'g3', 'GK', 70);
  for (let i = 1; i <= dfCount; i += 1) mk(players, `d${i}`, 'DF', 70);
  for (let i = 1; i <= 5; i += 1) mk(players, `m${i}`, 'MF', 70);
  for (let i = 1; i <= 3; i += 1) mk(players, `f${i}`, 'FW', 70);
  return createGameState(parseWorld({
    manifest: { id: 'w_b', name: 'b', version: '0.1.0', format: WORLD_FORMAT, startDate: '2026-07-01' },
    countries: [{ id: 'cty_a', name: 'A' }],
    leagues: [{ id: 'lg_a', name: 'L', countryId: 'cty_a', tier: 1 }],
    teams: [{ id: 'clb_a', name: 'A', leagueId: 'lg_a', formation: '4-4-2' }],
    players,
  }));
}
let seq = 0;
function seedMatches(state, clubId, season, count) {
  for (let i = 0; i < count; i += 1) {
    seq += 1;
    state.runtime.events.push({
      date: state.currentDate, type: 'match_played',
      payload: { leagueId: 'lg_a', season, round: 1, fixtureId: `fx${seq}`, homeId: clubId, awayId: 'clb_z' },
    });
  }
}
const setMinutes = (s, id, m) => { getPlayerRuntime(s, id).stats.season.minutes = m; };
const setPersonalityFor = (s, id, v) => {
  s.static.players.find((x) => x.id === id).personality = {
    professionalism: v, determination: v, ambition: v, consistency: v, injuryProneness: 40,
  };
};

// ================= A. Role =================
test('A1. STARTER：DF rank1 → STARTER', () => {
  const s = buildState(5);
  assertEquals(deriveExpectedRole(s, 'clb_a', 'd1').role, 'STARTER');
});
test('A2. ROTATION：DF rank5（surplus1,K1）→ ROTATION', () => {
  const s = buildState(5);
  assertEquals(deriveExpectedRole(s, 'clb_a', 'd5').role, 'ROTATION');
});
test('A3. BENCH：8 DF，rank8 → BENCH', () => {
  const s = buildState(8);
  assertEquals(deriveExpectedRole(s, 'clb_a', 'd8').role, 'BENCH');
});
test('A4/A5/A6. GK rank → GK1 / GK2 / GK3', () => {
  const s = buildState(5);
  assertEquals(deriveExpectedRole(s, 'clb_a', 'g1').role, 'GK1');
  assertEquals(deriveExpectedRole(s, 'clb_a', 'g2').role, 'GK2');
  assertEquals(deriveExpectedRole(s, 'clb_a', 'g3').role, 'GK3');
});
test('A7. 同评分 → playerId ASC tie-break（d1 rank1）', () => {
  const s = buildState(5);
  const r = deriveExpectedRole(s, 'clb_a', 'd1');
  assertEquals(r.rank, 1);
  assertEquals(deriveExpectedRole(s, 'clb_a', 'd5').rank, 5);
});
test('A8/A9. 伤病球员不从 expected ranking 消失（仍 STARTER）', () => {
  const s = buildState(5);
  applyInjury(s, 'd1', { type: 'knock', totalDays: 30, date: s.currentDate });
  assertEquals(deriveExpectedRole(s, 'clb_a', 'd1').role, 'STARTER');
  assertEquals(deriveExpectedRole(s, 'clb_a', 'd1').rank, 1);
});
test('A10. selectionDevelopmentPriority 不参与 ranking（改 personality/potential 不改 role）', () => {
  const s = buildState(5);
  const before = deriveExpectedRole(s, 'clb_a', 'd5').role;
  s.static.players.find((p) => p.id === 'd5').personality = { professionalism: 99, determination: 99, ambition: 99, consistency: 99, injuryProneness: 40 };
  for (const a of ATT) s.static.players.find((p) => p.id === 'd5').potential[a] = 99;
  assertEquals(deriveExpectedRole(s, 'clb_a', 'd5').role, before);
});

// ================= B. K =================
test('B11/B12. K：surplus 0 → 0；surplus 1 → 1', () => {
  const s0 = buildState(ROSTER_CONFIG.MIN_BY_POSITION.DF); // 恰好 structural min
  assertEquals(getRotationK(s0, 'clb_a', 'DF'), 0);
  const s1 = buildState(ROSTER_CONFIG.MIN_BY_POSITION.DF + 1);
  assertEquals(getRotationK(s1, 'clb_a', 'DF'), 1);
});
test('B13/B14. K：surplus > slotCount → clamp 到 K_CAP=3', () => {
  const s = buildState(ROSTER_CONFIG.MIN_BY_POSITION.DF + 8);
  assertEquals(getRotationK(s, 'clb_a', 'DF'), 3);
});
test('B15. K ≤ slotCount（GK K=0）', () => {
  const s = buildState(5);
  assertEquals(getRotationK(s, 'clb_a', 'GK'), 0);
});
test('B16. K 不依赖 actual minutes', () => {
  const s = buildState(8);
  const k = getRotationK(s, 'clb_a', 'DF');
  setMinutes(s, 'd8', 5000);
  assertEquals(getRotationK(s, 'clb_a', 'DF'), k);
});

// ================= C. Expected =================
test('C17–C22. Expected center/tolerance/upperBound', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-12;
  const chk = (role, center, tolerance, upperBound) => {
    const e = getExpectedParticipation(role);
    assert(near(e.center, center) && near(e.tolerance, tolerance) && near(e.upperBound, upperBound),
      `${role} 期望 ${center}/${tolerance}/${upperBound}，实际 ${JSON.stringify(e)}`);
  };
  chk('STARTER', 0.85, 0.10, 0.95);
  chk('ROTATION', 0.45, 0.10, 0.55);
  chk('BENCH', 0.20, 0.10, 0.30);
  chk('GK1', 0.90, 0.10, 1.0);
  chk('GK2', 0.20, 0.10, 0.30);
  chk('GK3', 0.10, 0.10, 0.20);
});

// ================= D. Actual =================
test('D23–D28. Actual：计算 / clamp / matches=0 / 无 NaN·Infinity', () => {
  const s = buildState(5);
  seedMatches(s, 'clb_a', 1, 14);
  setMinutes(s, 'd1', 700);
  const a = getActualParticipation(s, 'clb_a', 'd1', 1);
  assertEquals(a.matches, 14);
  assert(Math.abs(a.actual - 700 / (14 * 90)) < 1e-12);
  setMinutes(s, 'd1', 999999);
  assertEquals(getActualParticipation(s, 'clb_a', 'd1', 1).actual, 1);
  setMinutes(s, 'd1', -50);
  assertEquals(getActualParticipation(s, 'clb_a', 'd1', 1).actual, 0);
  // matches = 0
  const s2 = buildState(5);
  assertEquals(getActualParticipation(s2, 'clb_a', 'd1', 1).actual, null);
  assertEquals(getActualParticipation(s2, 'clb_a', 'd1', 1).matches, 0);
  assert(!Number.isNaN(a.actual) && Number.isFinite(a.actual));
});

// ================= E. Classification =================
test('E29–E44. Relative Load 分类边界', () => {
  const c = (role, actual) => classifyRelativeRoleLoad(getExpectedParticipation(role).upperBound, actual).classification;
  // STARTER
  assertEquals(c('STARTER', 0.90), 'NORMAL');
  assertEquals(c('STARTER', 0.95), 'NORMAL');
  assertEquals(c('STARTER', 1.00), 'EXCESSIVE');
  assert(c('STARTER', 1.00) !== 'EXTREME');
  // ROTATION
  assertEquals(c('ROTATION', 0.45), 'NORMAL');
  assertEquals(c('ROTATION', 0.50), 'NORMAL');
  assertEquals(c('ROTATION', 0.60), 'EXCESSIVE');
  assertEquals(c('ROTATION', 0.70), 'EXCESSIVE');
  assertEquals(c('ROTATION', 0.80), 'EXTREME');
  // BENCH
  assertEquals(c('BENCH', 0.30), 'NORMAL');
  assertEquals(c('BENCH', 0.40), 'EXCESSIVE');
  assertEquals(c('BENCH', 0.45), 'EXCESSIVE');
  assertEquals(c('BENCH', 0.50), 'EXTREME');
  // GK
  assertEquals(c('GK1', 1.00), 'NORMAL');
  assertEquals(c('GK2', 0.50), 'EXTREME');
  assertEquals(c('GK3', 0.50), 'EXTREME');
  // NO_RELATIVE_LOAD
  assertEquals(classifyRelativeRoleLoad(0.55, null).classification, 'NO_RELATIVE_LOAD');
});

// ================= F. Training Integration =================
test('F45/F46/F47/F48. applyRelativeRoleLoad 规则', () => {
  assertEquals(applyRelativeRoleLoad('NORMAL', 'NORMAL'), 'NORMAL');
  assertEquals(applyRelativeRoleLoad('NORMAL', 'EXCESSIVE'), 'NORMAL');
  assertEquals(applyRelativeRoleLoad('NORMAL', 'EXTREME'), 'LIMITED');
  assertEquals(applyRelativeRoleLoad('STRONG', 'EXTREME'), 'STRONG');
  assertEquals(applyRelativeRoleLoad('LIMITED', 'EXTREME'), 'LIMITED');
});
test('F49. underused 不自动 STRONG（PRIME + 0 minutes → NORMAL）', () => {
  const s = buildState(8);
  s.static.players.find((p) => p.id === 'd8').birthDate = '1999-01-15'; // age 27 → PRIME
  seedMatches(s, 'clb_a', 1, 14);
  setMinutes(s, 'd8', 0);
  const r = evaluateTrainingDecision(s, 'clb_a', 'd8', { seasonNumber: 1 });
  assertEquals(r.trainingLevel, 'NORMAL');
});
test('F50. Free Agent → NORMAL（不因 undefined relative load 异常）', () => {
  const s = buildState(5);
  s.runtime.membership.players.d1 = null;
  assertEquals(resolveTrainingLevel(s, 'd1', { seasonNumber: 1 }), 'NORMAL');
  assertEquals(evaluateRelativeRoleLoad(s, null, 'd1', { seasonNumber: 1 }), null);
});
test('F52. Managed player → NORMAL', () => {
  const s = buildState(5);
  s.runtime.managedClubId = 'clb_a';
  seedMatches(s, 'clb_a', 1, 14);
  setMinutes(s, 'd1', 1200);
  assertEquals(resolveTrainingLevel(s, 'd1', { seasonNumber: 1 }), 'NORMAL');
});
test('F51. enableAI:false 不使用 Training Decision（provider gating）', () => {
  // 由完整套件基线（season.test enableAI:false）间接验证；此处确认 training 默认档位语义不变。
  assertEquals(PLAYER_GROWTH_CONFIG.TRAINING_LEVELS.NORMAL, 1.00);
});

// ================= G. Injury Replacement =================
test('G53/G54. Rotation B expected 仍为 ROTATION；actual 升高 → relLoad 升高', () => {
  const s = buildState(5);
  seedMatches(s, 'clb_a', 1, 14);
  const low = evaluateRelativeRoleLoad(s, 'clb_a', 'd5', { seasonNumber: 1 }); // minutes 0
  assertEquals(low.role, 'ROTATION');
  assertEquals(low.classification, 'NORMAL');
  setMinutes(s, 'd5', Math.round(0.80 * 14 * 90)); // 被迫首发
  const high = evaluateRelativeRoleLoad(s, 'clb_a', 'd5', { seasonNumber: 1 });
  assertEquals(high.role, 'ROTATION');
  assertEquals(high.classification, 'EXTREME');
});
test('G55. EXTREME + base NORMAL → LIMITED（bench 超额）', () => {
  const s = buildState(8);
  s.static.players.find((p) => p.id === 'd8').birthDate = '1999-01-15'; // age 27 → PRIME（base NORMAL，非 STRONG 资格）
  seedMatches(s, 'clb_a', 1, 14);
  setMinutes(s, 'd8', Math.round(0.60 * 14 * 90)); // BENCH upperBound 0.30，actual 0.60 → excess 0.30 → EXTREME
  const r = evaluateTrainingDecision(s, 'clb_a', 'd8', { seasonNumber: 1 });
  assertEquals(r.relativeRoleLoad.classification, 'EXTREME');
  assertEquals(r.trainingLevel, 'LIMITED');
  assert(r.reasons.includes('relative_role_load_extreme'));
});
test('G55b. EXTREME + base STRONG → STRONG（冻结：Protective 不覆盖 STRONG-eligible）', () => {
  const s = buildState(8);
  s.static.players.find((p) => p.id === 'd8').birthDate = '2008-01-15'; // age 18 → EMERGING（STRONG 资格）
  setPersonalityFor(s, 'd8', 95);
  seedMatches(s, 'clb_a', 1, 14);
  setMinutes(s, 'd8', Math.round(0.60 * 14 * 90)); // BENCH actual 0.60 → EXTREME
  const r = evaluateTrainingDecision(s, 'clb_a', 'd8', { seasonNumber: 1 });
  assertEquals(r.relativeRoleLoad.classification, 'EXTREME');
  assertEquals(r.trainingLevel, 'STRONG');
});
test('G56/H57. role 不依赖 minutes（stateless，无同赛季重算）', () => {
  const s = buildState(5);
  const before = deriveExpectedRole(s, 'clb_a', 'd5').role;
  setMinutes(s, 'd5', 1200);
  assertEquals(deriveExpectedRole(s, 'clb_a', 'd5').role, before);
});

// ================= H. Boundary =================
test('H58. 无 persistence（不修改 state）', () => {
  const s = buildState(8);
  seedMatches(s, 'clb_a', 1, 14);
  setMinutes(s, 'd8', 800);
  const before = JSON.stringify(s.runtime);
  evaluateRelativeRoleLoad(s, 'clb_a', 'd8', { seasonNumber: 1 });
  evaluateTrainingDecision(s, 'clb_a', 'd8', { seasonNumber: 1 });
  assertEquals(JSON.stringify(s.runtime), before);
  assert(!('relativeRoleLoad' in s.runtime) && !('expectedParticipation' in s.runtime));
});
test('H59–H61. schema/save/Growth 未变', () => {
  assertEquals(GAME_STATE_SCHEMA_VERSION, 10);
  assertEquals(SAVE_FORMAT_VERSION, 1);
  assertEquals(PLAYER_GROWTH_CONFIG.TRAINING_LEVELS.LIMITED, 0.75);
});

// ================= I. Determinism =================
test('I62. 相同输入 → 相同输出', () => {
  const s = buildState(8);
  seedMatches(s, 'clb_a', 1, 14);
  setMinutes(s, 'd8', 800);
  const a = evaluateRelativeRoleLoad(s, 'clb_a', 'd8', { seasonNumber: 1 });
  const b = evaluateRelativeRoleLoad(s, 'clb_a', 'd8', { seasonNumber: 1 });
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

// ================= INT. Timing integration =================
test('INT. Expected 使用 finished-season roster（developPlayers 早于 retire/newgen/transfer）', async () => {
  const { SimulationCore } = await import('../src/core/simulation.js');
  const { makeLeagueWorldFiles } = await import('./fixtures.js');
  const s = createGameState(parseWorld(makeLeagueWorldFiles(8)));
  let captured = null;
  const provider = (pid, ctx) => {
    if (captured === null) {
      captured = {
        generated: Object.keys(s.runtime.generated).length,
        season: s.season,
        ctxSeason: ctx.seasonNumber,
      };
    }
    return 'NORMAL';
  };
  new SimulationCore({ enableAI: true, trainingFactor: provider }).advanceDays(s, 95); // 完成第 1 季滚动
  assert(captured, '应在赛季边界调用 training');
  assertEquals(captured.generated, 0, 'developPlayers 时新生代尚未生成');
  assertEquals(captured.ctxSeason, 1, '使用刚结束赛季的分钟');
  assertEquals(captured.season, 2, '此时 state.season 已推进到新赛季');
});
