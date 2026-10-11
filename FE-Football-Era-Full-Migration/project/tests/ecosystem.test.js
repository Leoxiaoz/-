/**
 * 赛季级球员生态联调测试（第 18 步，DECISIONS D-16 / SIMULATION_SPEC §22）。
 * 覆盖闭环：比赛 → 出场/进球 → fitness/form → 伤病 → 可用性 → 有效属性 → 球队实力 → 比赛 →
 * 赛季统计 → 成长/衰退 → 下一赛季；以及长期（10/50/100 赛季）稳定性与存档/确定性。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import {
  getPlayerRuntime,
  getEffectiveAttributes,
  getWorldPlayers,
  applyAbilityDelta,
  setVitals,
  applyInjury,
  recoverInjury,
  initializePlayerRuntime,
  INJURY_STATUS,
} from '../src/core/player-runtime.js';
import { computeTeamStrength, resolveMatchSquad, planMatchMinutes } from '../src/core/team-strength.js';
import { expectedGoals } from '../src/core/match.js';
import { MemorySaveManager } from '../src/save/save-manager.js';
import { INJURY_CONFIG, MATCH_LOAD_CONFIG } from '../src/core/sim-config.js';
import { makeLeagueWorldFiles } from './fixtures.js';

const ATTRS = ['pace', 'technique', 'passing', 'defending', 'finishing', 'goalkeeping'];
const VITALS = ['fitness', 'form', 'morale'];

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
function squadOf(state, teamId) {
  return state.static.players.filter((p) => p.teamId === teamId);
}

// ---------- 1. 出场统计真正生效 ----------
test('比赛后出场统计真正产生 season/career 数据', () => {
  const state = leagueState(8);
  // 第 1 轮每队各出场一次：期望出场数 = 开赛前各队 **Appearance Set** 人数之和
  // （Step 39F-H：AI club 分钟分配使 Appearance Set ⊇ Effective XI；用未受伤的干净状态计算）。
  const pristine = leagueState(8);
  const expected = Object.keys(pristine.runtime.clubs)
    .reduce((sum, id) => {
      const tactics = pristine.runtime.clubs[id].tactics ?? {};
      const xi = resolveMatchSquad(pristine, id, tactics);
      return sum + planMatchMinutes(pristine, id, tactics, xi).minutesByPlayer.size;
    }, 0);

  new SimulationCore().advanceDays(state, 1); // 第 1 轮即有比赛
  let seasonApp = 0;
  let careerMin = 0;
  for (const p of state.static.players) {
    const rt = getPlayerRuntime(state, p.id);
    seasonApp += rt.stats.season.appearances;
    careerMin += rt.stats.career.minutes;
  }
  assert(seasonApp > 0, `本赛季应有出场记录（实际 ${seasonApp}）`);
  assert(careerMin > 0, `职业生涯应有出场分钟（实际 ${careerMin}）`);
  assertEquals(seasonApp, expected, '出场次数应精确等于双方出场集合人数');
});

// ---------- 2. 进球统计与比分一致 ----------
test('match events 正确记录进球者，且球员进球总数等于比分总进球', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 90); // 打到赛季末轮之前
  const comp = state.runtime.competitions.lg_a;
  const fixtureGoals = comp.fixtures
    .filter((f) => f.played)
    .reduce((s, f) => s + f.homeGoals + f.awayGoals, 0);
  const playerGoals = state.static.players
    .reduce((s, p) => s + getPlayerRuntime(state, p.id).stats.career.goals, 0);
  assert(fixtureGoals > 0, '本赛季应有进球');
  assertEquals(playerGoals, fixtureGoals, '球员进球总数应等于比分总进球');
});

// ---------- 3. growth deltas 影响有效属性 ----------
test('growth deltas 能影响 effective attributes，且受 potential 上限约束', () => {
  const state = leagueState(2);
  const player = state.static.players[0];
  const before = getEffectiveAttributes(state, player.id).pace;
  applyAbilityDelta(state, player.id, 'pace', 4);
  assertEquals(getEffectiveAttributes(state, player.id).pace, before + 4);
  // 施加超大增量不得突破 potential（或属性上限 99）
  applyAbilityDelta(state, player.id, 'pace', 1000);
  const cap = Math.min(99, player.potential.pace);
  assertEquals(getEffectiveAttributes(state, player.id).pace, cap);
});

// ---------- 4. 有效属性影响球队实力 ----------
test('effective attributes 能影响 team strength', () => {
  const base = computeTeamStrength(leagueState(4), 'clb_001').attack;
  const boostedState = leagueState(4);
  for (const p of squadOf(boostedState, 'clb_001').filter((x) => x.position === 'FW')) {
    for (const a of ['finishing', 'technique', 'pace']) applyAbilityDelta(boostedState, p.id, a, 6);
  }
  const boosted = computeTeamStrength(boostedState, 'clb_001').attack;
  assert(boosted > base, `有效属性提升后实力应上升（${base}→${boosted}）`);
});

// ---------- 5. 球队实力影响比赛（期望进球） ----------
test('team strength 能继续影响比赛结果（期望进球随实力上升）', () => {
  const strong = expectedGoals({
    attack: 80, midfield: 80, opponentMidfield: 40, opponentDefence: 40, opponentGoalkeeping: 40, mentality: 'balanced', isHome: true,
  });
  const weak = expectedGoals({
    attack: 40, midfield: 40, opponentMidfield: 80, opponentDefence: 80, opponentGoalkeeping: 80, mentality: 'balanced', isHome: true,
  });
  assert(strong > weak, `强队期望进球应更高（${strong.toFixed(2)} vs ${weak.toFixed(2)}）`);
});

test('长期球队实力保持稳定（第 19 步退役+新生代修复了坍缩）', () => {
  const state = leagueState(8);
  const start = computeTeamStrength(state, 'clb_001').attack;
  new SimulationCore().advanceDays(state, 100 * 125);
  const late = computeTeamStrength(state, 'clb_001').attack;
  assert(Number.isFinite(late) && late >= 1, `实力应为有限正数（${late}）`);
  // 有退役+新生代后，实力不应坍缩到下限（旧系统会跌到 1）。
  assert(late >= start * 0.5, `长期实力不应坍缩（${start.toFixed(1)}→${late.toFixed(1)}）`);
});

// ---------- 6 + 7. form 通过比赛恢复；fitness 消耗并随时间恢复 ----------
test('form 能通过比赛恢复（不再永久停在 0）', () => {
  const state = leagueState(4);
  for (const p of squadOf(state, 'clb_001')) setVitals(state, p.id, { form: 0, fitness: 100 });
  new SimulationCore().advanceDays(state, 1); // 第 1 轮
  const played = squadOf(state, 'clb_001')
    .map((p) => getPlayerRuntime(state, p.id))
    .filter((rt) => rt.stats.season.appearances > 0);
  assert(played.length > 0, 'clb_001 应有球员出场');
  assert(played.some((rt) => rt.form > 0), '出场后 form 应被建立（>0）');
});

test('fitness 因比赛消耗，并在无比赛日按缺口比例恢复（非常量满值）', () => {
  const state = leagueState(4);
  const sim = new SimulationCore();
  sim.advanceDays(state, 1); // 第 1 轮
  const playing = state.static.players
    .map((p) => ({ p, rt: getPlayerRuntime(state, p.id) }))
    .find(({ rt }) => rt.stats.season.appearances > 0 && rt.injury.status === INJURY_STATUS.FIT);
  assert(playing, '应有一名健康出场球员');
  const afterMatch = playing.rt.fitness;
  assert(afterMatch < 100, `比赛后体能应被消耗（实际 ${afterMatch}）`);
  sim.advanceDays(state, 3); // 距下一轮（+7 天）尚无比赛
  assert(playing.rt.fitness > afterMatch, '无比赛日体能应回升');
  assert(playing.rt.fitness < 100, '回升亦不应瞬间满值（分数式恢复）');
});

test('康复瞬间的体能有上限（RECOVERY_FITNESS_CAP）', () => {
  const state = leagueState(2);
  const id = state.static.players[0].id;
  applyInjury(state, id, { type: 'knee', daysRemaining: 30 });
  setVitals(state, id, { fitness: 95 });
  recoverInjury(state, id);
  assertEquals(getPlayerRuntime(state, id).fitness, INJURY_CONFIG.RECOVERY_FITNESS_CAP);
});

// ---------- 8. 伤病与状态不产生永久异常 ----------
test('整季后伤病均会恢复（受伤不永久、天数有界）', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 300); // 多个赛季
  for (const p of state.static.players) {
    const rt = getPlayerRuntime(state, p.id);
    assert(Number.isInteger(rt.injury.daysRemaining) && rt.injury.daysRemaining >= 0, `${p.id} 天数非法`);
    assert(rt.injury.daysRemaining <= INJURY_CONFIG.SEVERE_MAX_DAYS, `${p.id} 天数超上限`);
    if (rt.injury.status === INJURY_STATUS.FIT) assertEquals(rt.injury.daysRemaining, 0);
  }
  const inj = state.runtime.events.filter((e) => e.type === 'injury').length;
  const rec = state.runtime.events.filter((e) => e.type === 'injury_recovered').length;
  assert(inj > 0 && rec > 0, '应有伤病与康复事件');
  assert(rec <= inj, '康复数不应超过伤病数');
});

// ---------- 9. 长期稳定性 ----------
function assertWorldSane(state, label) {
  for (const p of state.static.players) {
    const rt = getPlayerRuntime(state, p.id);
    if (!rt) continue; // 已退役球员不再有 active 运行时状态（第 19 步）
    for (const v of VITALS) {
      assert(Number.isFinite(rt[v]) && rt[v] >= 0 && rt[v] <= 100, `${label} ${p.id}.${v} 越界: ${rt[v]}`);
    }
    const eff = getEffectiveAttributes(state, p.id);
    for (const a of ATTRS) {
      assert(Number.isFinite(eff[a]) && eff[a] >= 1 && eff[a] <= 99, `${label} ${p.id}.${a} 越界: ${eff[a]}`);
      const cap = Math.min(99, Math.min(99, p.potential[a]));
      assert(eff[a] <= cap + 1e-9, `${label} ${p.id}.${a} 超过 potential: ${eff[a]} > ${cap}`);
      assert(Number.isFinite(Number(rt.ability.deltas[a] ?? 0)), `${label} ${p.id}.${a} delta NaN`);
    }
  }
  for (const teamId of Object.keys(state.runtime.clubs)) {
    const s = computeTeamStrength(state, teamId);
    for (const k of ['attack', 'midfield', 'defence', 'goalkeeping']) {
      assert(Number.isFinite(s[k]) && s[k] >= 1, `${label} ${teamId}.${k} 非法: ${s[k]}`);
    }
  }
}

test('10 赛季生态稳定：无 NaN/Infinity/负值、无越界、无超潜力', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 10 * 125);
  assertWorldSane(state, '10季');
});

test('50 赛季生态稳定：无 NaN/Infinity/负值、无越界、无超潜力', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 50 * 125);
  assertWorldSane(state, '50季');
});

test('100 赛季生态稳定：无坍缩、无膨胀、无永久异常', () => {
  const state = leagueState(8);
  const mean0 = worldMean(state);
  new SimulationCore().advanceDays(state, 100 * 125);
  assertWorldSane(state, '100季');
  const mean100 = worldMean(state);
  assert(Number.isFinite(mean100) && mean100 >= 1, '世界均值应为有限正数');
  // 第 19 步起有退役+新生代 → 均值应长期稳定（既不坍缩也不膨胀）。
  assert(mean100 >= mean0 * 0.6 && mean100 <= mean0 * 1.4,
    `100 赛季均值应在稳定区间：${mean0.toFixed(2)}→${mean100.toFixed(2)}`);
});

function worldMean(state) {
  let sum = 0;
  let n = 0;
  for (const p of getWorldPlayers(state)) { // 活跃世界球员（排除退役、含新生代）
    const eff = getEffectiveAttributes(state, p.id);
    for (const a of ATTRS) { sum += eff[a]; n += 1; }
  }
  return sum / n;
}

// ---------- 10. 存档往返一致（含统计与伤病） ----------
test('save/load 后运行时状态（统计/伤病/vitals/成长）保持一致', async () => {
  const mgr = new MemorySaveManager();
  const state = leagueState(4);
  new SimulationCore().advanceDays(state, 40);
  await mgr.save('slot', state);
  const payload = await mgr.load('slot');
  const loaded = createGameState(state.static, { date: payload.currentDate, season: payload.season });
  loaded.runtime = payload.runtime;
  initializePlayerRuntime(loaded);

  assertEquals(JSON.stringify(loaded.runtime.players), JSON.stringify(state.runtime.players));
  // 抽样校验统计非空（证明统计确实进了存档）
  const anyStats = Object.values(loaded.runtime.players).some((rt) => rt.stats.career.appearances > 0);
  assert(anyStats, '存档应包含真实出场统计');
});

// ---------- 11. 确定性 ----------
test('deterministic seed：同输入两次推进得到一致运行时', () => {
  const a = leagueState(8);
  const b = leagueState(8);
  new SimulationCore().advanceDays(a, 92);
  new SimulationCore().advanceDays(b, 92);
  assertEquals(JSON.stringify(a.runtime.players), JSON.stringify(b.runtime.players), '球员运行时必须一致');
  assertEquals(
    JSON.stringify(a.runtime.competitions.lg_a.table),
    JSON.stringify(b.runtime.competitions.lg_a.table),
    '积分榜必须一致',
  );
});

// ---------- 参数守卫 ----------
test('MATCH_LOAD_CONFIG 合法（分钟不超单场上限、消耗与恢复为正）', () => {
  assert(MATCH_LOAD_CONFIG.MINUTES_PER_MATCH > 0 && MATCH_LOAD_CONFIG.MINUTES_PER_MATCH <= 120);
  assert(MATCH_LOAD_CONFIG.FITNESS_COST > 0);
  assert(MATCH_LOAD_CONFIG.FORM_RECOVER_RATE > 0 && MATCH_LOAD_CONFIG.FORM_RECOVER_RATE <= 1);
  assert(MATCH_LOAD_CONFIG.FORM_BASELINE >= 0 && MATCH_LOAD_CONFIG.FORM_BASELINE <= 100);
});
