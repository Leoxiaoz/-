/**
 * 伤病生命周期测试（第 17 步，DECISIONS D-15 / SIMULATION_SPEC §21）。
 * 覆盖：类型配置驱动、严重度分档、缺阵天数、每日递减、自动恢复、vitals 影响、
 * injuryProneness、复发信息、确定性 RNG、成长惩罚正确起止、不重复/不永久、
 * 旧档 normalize、空阵容保护、无 NaN/Infinity/负数（整季 / 50 / 100 赛季）。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import {
  getPlayerRuntime,
  applyInjury,
  recoverInjury,
  initializePlayerRuntime,
  INJURY_STATUS,
  severityForDays,
} from '../src/core/player-runtime.js';
import {
  rollPlayerInjury,
  tickInjuries,
  isAvailable,
  injuryChanceFor,
} from '../src/core/player-injury.js';
import { developPlayers } from '../src/core/player-growth.js';
import { computeTeamStrength } from '../src/core/team-strength.js';
import { simulateMatch } from '../src/core/match.js';
import { SimulationCore } from '../src/core/simulation.js';
import { parseWorld } from '../src/data/data-loader.js';
import { INJURY_CONFIG } from '../src/core/sim-config.js';
import { makeLeagueWorldFiles, makeWorldFiles } from './fixtures.js';

const ATTRS = ['pace', 'technique', 'passing', 'defending', 'finishing', 'goalkeeping'];
const VITALS = ['fitness', 'form', 'morale'];

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
function firstPlayerId(state) {
  return state.static.players[0].id;
}

// ---------- 配置驱动 ----------
test('伤病类型为配置驱动，6–8 种且字段完整（逻辑不硬编码类型）', () => {
  const types = Object.keys(INJURY_CONFIG.TYPES);
  assert(types.length >= 6 && types.length <= 8, `类型数应在 6–8，实际 ${types.length}`);
  for (const t of types) {
    const def = INJURY_CONFIG.TYPES[t];
    assert(typeof def.category === 'string' && def.category.length > 0, `${t} 缺 category`);
    assert(Number.isFinite(def.baseDays) && def.baseDays > 0, `${t} baseDays 非法`);
    assert(Number.isFinite(def.dayRange) && def.dayRange >= 0, `${t} dayRange 非法`);
  }
});

test('严重度分档：按缺阵天数分为 minor / moderate / severe', () => {
  assertEquals(severityForDays(5), 'minor');
  assertEquals(severityForDays(14), 'minor');
  assertEquals(severityForDays(15), 'moderate');
  assertEquals(severityForDays(45), 'moderate');
  assertEquals(severityForDays(46), 'severe');
  assertEquals(severityForDays(200), 'severe');
});

// ---------- 比赛产生伤病（整季） ----------
test('整季推进由比赛产生伤病，且类型/严重度/天数均合法', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 92);
  const injuries = state.runtime.events.filter((e) => e.type === 'injury');
  assert(injuries.length > 0, '一个赛季应产生伤病');
  assert(injuries.length <= 112, `伤病人数不应失控，实际 ${injuries.length}`);
  for (const e of injuries) {
    const { type, severity, days } = e.payload;
    assert(Object.keys(INJURY_CONFIG.TYPES).includes(type), `非配置内类型 ${type}`);
    assert(['minor', 'moderate', 'severe'].includes(severity), `非法严重度 ${severity}`);
    assert(Number.isInteger(days) && days >= 1 && days <= INJURY_CONFIG.SEVERE_MAX_DAYS, `天数非法 ${days}`);
  }
});

// ---------- 每日递减 + 自动恢复 ----------
test('伤停天数每日递减，归零自动恢复（不允许永久伤病）', () => {
  const state = leagueState(4);
  const id = firstPlayerId(state);
  applyInjury(state, id, { type: 'hamstring', daysRemaining: 10 });
  assertEquals(getPlayerRuntime(state, id).injury.daysRemaining, 10);

  const sim = new SimulationCore();
  sim.advanceDays(state, 1);
  assertEquals(getPlayerRuntime(state, id).injury.daysRemaining, 9);
  sim.advanceDays(state, 8);
  assertEquals(getPlayerRuntime(state, id).injury.daysRemaining, 1);
  sim.advanceDays(state, 1); // 归零 → 恢复
  const rt = getPlayerRuntime(state, id);
  assertEquals(rt.injury.status, INJURY_STATUS.FIT);
  assertEquals(rt.injury.daysRemaining, 0);
  assertEquals(rt.injury.type, null);
});

test('tickInjuries 对健康球员不做伤病改动（幂等安全）', () => {
  const state = leagueState(2);
  const id = firstPlayerId(state);
  const before = getPlayerRuntime(state, id).injury.status;
  tickInjuries(state);
  assertEquals(getPlayerRuntime(state, id).injury.status, before);
});

// ---------- vitals 影响 ----------
test('伤病期间 fitness/form 下降，康复后 fitness 不立即满值', () => {
  const state = leagueState(4);
  const id = firstPlayerId(state);
  const rt = getPlayerRuntime(state, id);
  const fitBefore = rt.fitness;
  const formBefore = rt.form;
  applyInjury(state, id, { type: 'ligament', daysRemaining: 60 }); // severe，天数长
  const sim = new SimulationCore();
  sim.advanceDays(state, 10);
  assert(rt.fitness < fitBefore, `体能应下降（${fitBefore}→${rt.fitness}）`);
  assert(rt.form <= formBefore, '状态不应增长（冻结/衰减）');
  sim.advanceDays(state, 60); // 康复
  assertEquals(rt.injury.status, INJURY_STATUS.FIT);
  // 第 18 步起体能改为**分数式**恢复（避免健康球员长期恒定满值），故此处校验"未立即满值"。
  // 康复瞬间的上限（RECOVERY_FITNESS_CAP）由 ecosystem.test.js 直接单测。
  assert(rt.fitness < 100, '康复后体能不应立即满值');
});

test('长期伤病适度降低 morale；康复后向基线温和恢复', () => {
  const state = leagueState(4);
  const id = firstPlayerId(state);
  const rt = getPlayerRuntime(state, id);
  applyInjury(state, id, { type: 'knee', daysRemaining: 100 }); // moderate/severe 长期
  const sim = new SimulationCore();
  sim.advanceDays(state, 20);
  assert(rt.morale < 50, `长期伤病 morale 应下降（实际 ${rt.morale}）`);
  sim.advanceDays(state, 100); // 康复 + 恢复期
  assert(rt.morale <= 50 + 1e-9 && rt.morale >= 0, 'morale 应有界');
});

// ---------- injuryProneness ----------
test('高 injuryProneness 提高受伤概率，且有上限（不失控）', () => {
  const mk = (proneness) => {
    const files = makeLeagueWorldFiles(2);
    for (const p of files.players) p.personality = { professionalism: 50, determination: 50, ambition: 50, consistency: 50, injuryProneness: proneness };
    return createGameState(parseWorld(files));
  };
  const hi = mk(99);
  const lo = mk(1);
  const id = firstPlayerId(hi);
  const pHi = injuryChanceFor(hi, id);
  const pLo = injuryChanceFor(lo, id);
  assert(pHi > pLo, `高倾向概率应更高（${pHi} vs ${pLo}）`);
  assert(pHi <= INJURY_CONFIG.MAX_INJURY_CHANCE, '概率必须有上限');
});

// ---------- 复发信息（有限、不无限增长） ----------
test('伤病历史为定长对象：记录复发次数与最近伤病，不无限增长', () => {
  const state = leagueState(2);
  const id = firstPlayerId(state);
  applyInjury(state, id, { type: 'ankle', daysRemaining: 20 });
  const h = getPlayerRuntime(state, id).injuryHistory;
  assertEquals(Object.keys(h).sort(), ['lastInjuryDate', 'lastInjuryType', 'recurrenceCount']);
  assertEquals(h.recurrenceCount, 1);
  assertEquals(h.lastInjuryType, 'ankle');
  assertEquals(h.lastInjuryDate, state.currentDate);
  recoverInjury(state, id);
  applyInjury(state, id, { type: 'knock', daysRemaining: 5 });
  assertEquals(getPlayerRuntime(state, id).injuryHistory.recurrenceCount, 2);
  assertEquals(getPlayerRuntime(state, id).injuryHistory.lastInjuryType, 'knock');
});

// ---------- 确定性 ----------
test('伤病随机可复现：同（库+档+种子）两次推进得到完全一致的伤病序列', () => {
  const a = leagueState(8);
  const b = leagueState(8);
  new SimulationCore().advanceDays(a, 92);
  new SimulationCore().advanceDays(b, 92);
  const sa = JSON.stringify(a.runtime.events.filter((e) => e.type === 'injury'));
  const sb = JSON.stringify(b.runtime.events.filter((e) => e.type === 'injury'));
  assertEquals(sa, sb, '伤病序列必须一致');
  assert(JSON.parse(sa).length > 0, '应有伤病产生以验证复现');
});

test('rollPlayerInjury 使用确定性种子（重复判定结果一致）', () => {
  const a = leagueState(2);
  const b = leagueState(2);
  const id = firstPlayerId(a);
  const ctx = { fixtureId: 'fx_test', season: 1, round: 1 };
  const ra = rollPlayerInjury(a, id, ctx);
  const rb = rollPlayerInjury(b, id, ctx);
  assertEquals(ra, rb);
});

// ---------- 成长惩罚：正确开始 ----------
test('严重伤病向成长系统写入 growthPenaltySeasons（明确开始）', () => {
  const state = leagueState(2);
  const id = firstPlayerId(state);
  applyInjury(state, id, { type: 'ligament', daysRemaining: 90 }); // severe
  assertEquals(
    getPlayerRuntime(state, id).growth.injuryPenaltySeasons,
    INJURY_CONFIG.GROWTH_PENALTY_SEASONS,
  );
});

test('非严重伤病不写成长惩罚', () => {
  const state = leagueState(2);
  const id = firstPlayerId(state);
  applyInjury(state, id, { type: 'knock', daysRemaining: 5 }); // minor
  assertEquals(getPlayerRuntime(state, id).growth.injuryPenaltySeasons, 0);
});

// ---------- 成长惩罚：正确结束 + 不重复 + 不永久 ----------
test('成长惩罚被成长系统消费至 0；伤病期跨赛季也不重复施加（有明确结束）', () => {
  const state = leagueState(2);
  const id = firstPlayerId(state);
  applyInjury(state, id, { type: 'knee', daysRemaining: 120 }); // severe
  const rt = getPlayerRuntime(state, id);
  assertEquals(rt.growth.injuryPenaltySeasons, INJURY_CONFIG.GROWTH_PENALTY_SEASONS);

  developPlayers(state, { seasonNumber: 1 });
  assertEquals(rt.growth.injuryPenaltySeasons, 0, '第 1 季应被消费');

  // 仍是同一伤病（未康复），第 2 季不应重新写回永久惩罚
  assertEquals(rt.injury.status, INJURY_STATUS.INJURED);
  developPlayers(state, { seasonNumber: 2 });
  assertEquals(rt.growth.injuryPenaltySeasons, 0, '不重复施加 / 不永久');
});

test('player-growth 不再依据 injury.daysRemaining 自行推断（源码级约束）', async () => {
  // 通过行为验证：无 penalty 字段时，即便处于长期伤病也不生效
  const state = leagueState(2);
  const id = firstPlayerId(state);
  applyInjury(state, id, { type: 'miss-cfg', daysRemaining: 200, severity: 'minor' }); // 显式非 severe
  assertEquals(getPlayerRuntime(state, id).injury.daysRemaining, 200);
  assertEquals(getPlayerRuntime(state, id).growth.injuryPenaltySeasons, 0, '不得因天数自行推断');
});

// ---------- 旧档 normalize ----------
test('旧存档 injury 缺少新字段时 normalize 兜底并派生严重度', () => {
  const state = leagueState(2);
  const id = firstPlayerId(state);
  state.runtime.players[id] = {
    playerId: id,
    morale: 60,
    injury: { status: 'injured', type: 'knee', daysRemaining: 40 }, // 旧结构：无 category/severity/totalDays
  };
  initializePlayerRuntime(state);
  const rt = getPlayerRuntime(state, id);
  assertEquals(rt.injury.severity, 'moderate');
  assertEquals(rt.injury.totalDays, 40);
  assertEquals(rt.injury.category, null);
  assertEquals(rt.morale, 60, '已有值应保留');
  assertEquals(rt.injuryHistory.recurrenceCount, 0, '缺失历史应兜底');
});

test('旧档无 injury 字段时兜底为健康', () => {
  const state = leagueState(2);
  const id = firstPlayerId(state);
  state.runtime.players[id] = { playerId: id };
  initializePlayerRuntime(state);
  const rt = getPlayerRuntime(state, id);
  assertEquals(rt.injury.status, INJURY_STATUS.FIT);
  assertEquals(rt.injury.daysRemaining, 0);
});

// ---------- 空阵容保护 ----------
test('全队伤病时不产生 NaN/负数，比赛仍可模拟', () => {
  const state = leagueState(4);
  for (const p of state.static.players.filter((x) => x.teamId === 'clb_001')) {
    applyInjury(state, p.id, { type: 'knock', daysRemaining: 5 });
  }
  const strength = computeTeamStrength(state, 'clb_001');
  for (const k of ['attack', 'midfield', 'defence', 'goalkeeping']) {
    assert(Number.isFinite(strength[k]) && strength[k] >= 1, `实力 ${k} 非法: ${strength[k]}`);
  }
  const home = {
    teamId: 'clb_001',
    tactics: {},
    strength,
    players: state.static.players.filter((p) => p.teamId === 'clb_001' && isAvailable(state, p.id)),
  };
  const awayId = 'clb_002';
  const away = {
    teamId: awayId,
    tactics: {},
    strength: computeTeamStrength(state, awayId),
    players: state.static.players.filter((p) => p.teamId === awayId),
  };
  const res = simulateMatch({ home, away, context: { worldId: state.worldId, season: 1, round: 1, homeId: 'clb_001', awayId } });
  assert(Number.isInteger(res.homeGoals) && res.homeGoals >= 0, '主队进球应为非负整数');
  assert(Number.isInteger(res.awayGoals) && res.awayGoals >= 0, '客队进球应为非负整数');
});

// ---------- 长期稳定性（无 NaN/Infinity/负数） ----------
function assertVitalsAndInjuryConsistent(state) {
  for (const p of state.static.players) {
    const rt = getPlayerRuntime(state, p.id);
    for (const v of VITALS) {
      assert(Number.isFinite(rt[v]) && rt[v] >= 0 && rt[v] <= 100, `${p.id}.${v} 越界: ${rt[v]}`);
    }
    assert(Number.isInteger(rt.injury.daysRemaining) && rt.injury.daysRemaining >= 0, `${p.id} 天数非法`);
    assert(rt.injury.daysRemaining <= INJURY_CONFIG.SEVERE_MAX_DAYS, `${p.id} 天数超上限`);
    if (rt.injury.status === INJURY_STATUS.FIT) {
      assertEquals(rt.injury.daysRemaining, 0, '健康球员剩余天数应为 0');
    }
    for (const a of ATTRS) {
      const eff = getPlayerRuntime(state, p.id);
      assert(Number.isFinite(eff.ability.deltas[a] ?? 0), 'deltas 不应为 NaN');
    }
  }
}

test('整季无 NaN/Infinity/负数，vitals 有界', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 92);
  assertVitalsAndInjuryConsistent(state);
});

test('50 赛季伤病系统稳定：无 NaN、无永久伤病、伤病总量有界', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 50 * 125);
  assertVitalsAndInjuryConsistent(state);
  const injuries = state.runtime.events.filter((e) => e.type === 'injury');
  const recovered = state.runtime.events.filter((e) => e.type === 'injury_recovered');
  assert(injuries.length > 0 && recovered.length > 0, '应有伤病与康复事件');
  assert(recovered.length <= injuries.length, '康复数不应超过伤病数');
});

test('100 赛季伤病系统稳定：无越界、无 NaN、伤病不无限累积', () => {
  const state = leagueState(8);
  const sim = new SimulationCore();
  sim.advanceDays(state, 100 * 125);
  assertVitalsAndInjuryConsistent(state);
  // 事件数随时间线性增长而非爆炸（每季约数十条）
  assert(state.runtime.events.length < 100 * 200, '事件数不应爆炸');
});