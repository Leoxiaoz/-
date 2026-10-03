/**
 * 玩家阵容 / 战术测试（第 20 步，DECISIONS D-18 / SIMULATION_SPEC §24）。
 * 覆盖：阵容保存读取、首发/替补人数、位置合法性、GK 约束、重复引用、伤病、退役、非本队、
 * 不存在 playerId、AI 自动选阵不受影响、玩家阵容真实进入比赛、阵型/战术真实影响比赛、
 * 赛季滚动自动修复、玩家阵容未选择时行为与第 16–19 步一致、10/50 赛季长期稳定。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { GameController } from '../src/controller/game-controller.js';
import {
  applyAbilityDelta,
  applyInjury,
  getEffectiveAttributes,
  getPlayerRuntime,
  getPlayerProfile,
  getWorldPlayers,
  initializePlayerRuntime,
  INJURY_STATUS,
} from '../src/core/player-runtime.js';
import {
  resolveMatchSquad,
  selectMatchSquad,
  computeTeamStrength,
  buildAutoLineup,
} from '../src/core/team-strength.js';
import {
  cleanLineup,
  validateLineup,
  repairSquadForMatch,
  formationSlots,
  repairManagedLineups,
  LINEUP_LIMITS,
} from '../src/core/player-lineup.js';
import { simulateMatch } from '../src/core/match.js';
import { MemorySaveManager } from '../src/save/save-manager.js';
import { makeLeagueWorldFiles } from './fixtures.js';

const ATTRS = ['pace', 'technique', 'passing', 'defending', 'finishing', 'goalkeeping'];

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
function teamPlayerIds(state, teamId, position) {
  return state.static.players
    .filter((p) => p.teamId === teamId && (!position || p.position === position))
    .map((p) => p.id);
}
/** 模拟 #buildSide 的等价构造（用公开 API 组装比赛输入）。 */
function side(state, teamId, tactics) {
  const squad = resolveMatchSquad(state, teamId, tactics);
  return {
    teamId,
    tactics,
    strength: computeTeamStrength(state, teamId, tactics, squad),
    players: squad.map((p) => ({ id: p.id, position: p.position, ...getEffectiveAttributes(state, p.id) })),
    squadIds: squad.map((p) => p.id),
  };
}

class StubLoader {
  async loadWorld() {
    return parseWorld(makeLeagueWorldFiles(8));
  }
}
function makeController() {
  return new GameController({
    dataLoader: new StubLoader(),
    saveManager: new MemorySaveManager(),
    simulation: new SimulationCore(),
  });
}

// ---------- 1. 阵容保存 / 读取后一致 ----------
test('玩家阵容 save/load 后保持一致（含 managedClubId / 阵型 / 战术）', async () => {
  const controller = makeController();
  await controller.startNewGame('w');
  controller.setManagedClub('clb_001');
  controller.setFormation('clb_001', '4-3-3');
  controller.setMentality('clb_001', 'attacking');
  controller.autoFillManagedLineup();
  const before = JSON.parse(JSON.stringify(controller.getState().runtime.clubs.clb_001.lineup));

  await controller.save('slot');
  await controller.load('slot');

  assertEquals(controller.getManagedClubId(), 'clb_001');
  assertEquals(controller.getState().runtime.clubs.clb_001.tactics.formation, '4-3-3');
  assertEquals(controller.getState().runtime.clubs.clb_001.tactics.mentality, 'attacking');
  assertEquals(controller.getState().runtime.clubs.clb_001.lineup, before);
  assert(before.starters.length === LINEUP_LIMITS.STARTERS, '自动填充应得到完整首发');
});

// ---------- 2. 首发人数 ----------
test('首发人数：超出容量被截断，不足则给出可解释问题', () => {
  const state = leagueState(4);
  state.runtime.managedClubId = 'clb_001';
  const all = teamPlayerIds(state, 'clb_001');
  const many = cleanLineup(state, 'clb_001', { starters: all.slice(0, 13), bench: [] });
  assert(many.starters.length <= LINEUP_LIMITS.STARTERS, `首发应被截断到 ${LINEUP_LIMITS.STARTERS}`);
  const few = cleanLineup(state, 'clb_001', { starters: all.slice(0, 5), bench: [] });
  const issues = validateLineup(state, 'clb_001', few);
  assert(issues.some((s) => s.includes('首发人数')), `应提示首发人数不足：${issues}`);
});

// ---------- 3. 替补人数 ----------
test('替补人数：容量上限为 BENCH，超出被截断', () => {
  const state = leagueState(4);
  const bench = cleanLineup(state, 'clb_001', { starters: [], bench: teamPlayerIds(state, 'clb_001') });
  assert(bench.bench.length <= LINEUP_LIMITS.BENCH, `替补应被截断到 ${LINEUP_LIMITS.BENCH}`);
});

// ---------- 4. 位置合法性 + 5. GK 约束 ----------
test('首发位置构成严格匹配阵型（含 GK=1）', () => {
  const state = leagueState(4);
  state.runtime.managedClubId = 'clb_001';
  // 取 11 名非门将球员当首发 → GK 缺失。
  const outfield = teamPlayerIds(state, 'clb_001').filter((id) => getPlayerProfile(state, id).position !== 'GK');
  const lineup = cleanLineup(state, 'clb_001', { starters: outfield.slice(0, 11), bench: [] });
  const issues = validateLineup(state, 'clb_001', lineup);
  assert(issues.some((s) => s.includes('GK')), `应提示 GK 人数不符：${issues}`);
  for (const slot of formationSlots('4-4-2')) {
    assert(slot.count > 0, '槽位构成应非空');
  }
});

test('repairSquadForMatch：位置严格匹配，且恰好产出阵型所需人数', () => {
  const state = leagueState(4);
  state.runtime.managedClubId = 'clb_001';
  const slots = formationSlots('4-4-2');
  const need = slots.reduce((s, x) => s + x.count, 0);
  // 故意给一份位置混乱的首发（全是 DF）。
  const dfs = teamPlayerIds(state, 'clb_001', 'DF');
  const squad = repairSquadForMatch(state, 'clb_001', { starters: dfs }, '4-4-2', () => 50);
  assert(squad && squad.length === need, '应能修复为完整阵容');
  for (const slot of slots) {
    const n = squad.filter((p) => p.position === slot.position).length;
    assert(n === slot.count, `${slot.position} 应恰好 ${slot.count} 人，实际 ${n}`);
  }
});

// ---------- 6. 重复 playerId ----------
test('重复 playerId：首发/替补去重，且不得同时出现在首发与替补', () => {
  const state = leagueState(4);
  const ids = teamPlayerIds(state, 'clb_001');
  const dup = cleanLineup(state, 'clb_001', { starters: [ids[0], ids[0], ids[1]], bench: [ids[1], ids[2]] });
  assertEquals(new Set(dup.starters).size, dup.starters.length, '首发应去重');
  assertEquals(new Set(dup.bench).size, dup.bench.length, '替补应去重');
  assert(!dup.bench.some((id) => dup.starters.includes(id)), '首发与替补不得重复');
});

// ---------- 7. 伤病球员 ----------
test('伤病球员不得进入实际首发（自动顶替），但允许进入替补席', () => {
  const state = leagueState(4);
  state.runtime.managedClubId = 'clb_001';
  const lineup = buildAutoLineup(state, 'clb_001', { formation: '4-4-2' });
  // 取一名非门将首发（门将无替补时修复会正确回退，见下一个用例）。
  const injuredStarter = lineup.starters.find((id) => getPlayerProfile(state, id).position === 'DF');
  applyInjury(state, injuredStarter, { type: 'knock', daysRemaining: 10 });

  // 清洗保留（玩家选择不被抹除），校验提示伤病首发。
  const cleaned = cleanLineup(state, 'clb_001', lineup);
  assert(cleaned.starters.includes(injuredStarter), '清洗不应抹除玩家选择');
  assert(validateLineup(state, 'clb_001', cleaned).some((s) => s.includes('伤病')), '应提示首发含伤病球员');

  // 比赛修复：实际首发不得包含伤病球员，同位置健康球员顶替，人数不减。
  const squad = repairSquadForMatch(state, 'clb_001', cleaned, '4-4-2', () => 50);
  assert(squad, '应能修复');
  assert(!squad.some((p) => p.id === injuredStarter), '实际首发不得包含伤病球员');
  assertEquals(squad.length, LINEUP_LIMITS.STARTERS, '修复后首发人数不变');
  assertEquals(squad.filter((p) => p.position === 'DF').length, 4, '同位置人数应保持不变');

  // 伤病球员允许进入替补席（不与首发重复）。
  const benchOnly = cleanLineup(state, 'clb_001', {
    starters: cleaned.starters.filter((id) => id !== injuredStarter),
    bench: [injuredStarter],
  });
  assert(benchOnly.bench.includes(injuredStarter), '伤病球员应允许进入替补席');
  assertEquals(validateLineup(state, 'clb_001', benchOnly).some((s) => s.includes('替补人数')), false);
});

test('首发门将受伤且无替补门将时：修复失败 → 回退自动阵容（不静默使用错误数据）', () => {
  const state = leagueState(4);
  state.runtime.managedClubId = 'clb_001';
  const lineup = buildAutoLineup(state, 'clb_001', { formation: '4-4-2' });
  state.runtime.clubs.clb_001.lineup = cleanLineup(state, 'clb_001', lineup);
  const gk = state.runtime.clubs.clb_001.lineup.starters.find((id) => getPlayerProfile(state, id).position === 'GK');
  applyInjury(state, gk, { type: 'knee', daysRemaining: 30 });
  // 该队仅 1 名门将 → 无法修复。
  const repaired = repairSquadForMatch(state, 'clb_001', state.runtime.clubs.clb_001.lineup, '4-4-2', () => 50);
  assertEquals(repaired, null, '无健康门将时修复应返回 null');
  // resolveMatchSquad 回退自动选阵（并记录 lineup_fallback 事件）。
  const squad = resolveMatchSquad(state, 'clb_001', { formation: '4-4-2' });
  assert(Array.isArray(squad), '应回退为可用阵容（不抛错）');
  assert(state.runtime.events.some((e) => e.type === 'lineup_fallback'), '应记录回退事件以便解释');
});

// ---------- 8. 退役球员 ----------
test('退役球员：被清洗剔除，不得留在阵容', () => {
  const state = leagueState(4);
  const id = teamPlayerIds(state, 'clb_001')[0];
  state.runtime.retired[id] = { playerId: id, retiredSeason: 1 };
  const cleaned = cleanLineup(state, 'clb_001', { starters: [id], bench: [id] });
  assert(!cleaned.starters.includes(id) && !cleaned.bench.includes(id), '退役球员应被剔除');
});

// ---------- 9. 非本队球员 ----------
test('非本队球员：被清洗剔除', () => {
  const state = leagueState(4);
  const foreign = teamPlayerIds(state, 'clb_002')[0];
  const cleaned = cleanLineup(state, 'clb_001', { starters: [foreign], bench: [foreign] });
  assert(cleaned.starters.length === 0 && cleaned.bench.length === 0, '非本队球员应被剔除');
});

// ---------- 10. 不存在 playerId ----------
test('不存在的 playerId：被自动剔除且不抛错', () => {
  const state = leagueState(4);
  const cleaned = cleanLineup(state, 'clb_001', { starters: ['ply_none', 'ply_9999'], bench: ['ply_x'] });
  assertEquals(cleaned.starters, []);
  assertEquals(cleaned.bench, []);
});

// ---------- 11. AI 球队仍正常自动选阵 ----------
test('未选择管理球队时：全队仍走自动选阵（与第 16–19 步一致）', () => {
  const state = leagueState(8);
  assertEquals(state.runtime.managedClubId, null, '默认 managedClubId 应为 null');
  for (const clubId of Object.keys(state.runtime.clubs)) {
    const a = resolveMatchSquad(state, clubId, state.runtime.clubs[clubId].tactics);
    const b = selectMatchSquad(state, clubId, state.runtime.clubs[clubId].tactics);
    assertEquals(a.map((p) => p.id), b.map((p) => p.id), '未管理球队应完全回退自动选阵');
  }
});

// ---------- 12. 玩家球队使用保存阵容 ----------
test('玩家管理球队的比赛出场集合来自已保存阵容', () => {
  const state = leagueState(4);
  state.runtime.managedClubId = 'clb_001';
  // 构造一份"弱门将首发"的合法阵容：把首发 GK 换成评分最低的门将。
  const gks = teamPlayerIds(state, 'clb_001', 'GK');
  const base = buildAutoLineup(state, 'clb_001', { formation: '4-4-2' });
  const worstGk = gks[gks.length - 1];
  const starters = base.starters.filter((id) => id !== base.starters.find((s) => getPlayerProfile(state, s).position === 'GK'));
  starters.unshift(worstGk);
  state.runtime.clubs.clb_001.lineup = { starters, bench: base.bench };

  const squad = resolveMatchSquad(state, 'clb_001', { formation: '4-4-2' });
  assert(squad.some((p) => p.id === worstGk), '玩家选择的门将应实际出场');
  assertEquals(squad.length, LINEUP_LIMITS.STARTERS);
});

// ---------- 13. 阵型改变实际影响比赛 ----------
test('阵型改变会改变实际出场集合与球队实力（真实影响比赛输入）', () => {
  const state = leagueState(4);
  // 大幅削弱第 3 名前锋：4-3-3（用 3 名 FW）与 4-4-2（只用最好的 2 名）应产生不同实力。
  const fw = teamPlayerIds(state, 'clb_001', 'FW');
  for (const a of ['finishing', 'technique', 'pace']) applyAbilityDelta(state, fw[2], a, -50);

  const t442 = { formation: '4-4-2', mentality: 'balanced' };
  const t433 = { formation: '4-3-3', mentality: 'balanced' };
  const atk442 = computeTeamStrength(state, 'clb_001', t442).attack;
  const atk433 = computeTeamStrength(state, 'clb_001', t433).attack;
  assert(atk433 < atk442, `4-3-3 含弱前锋应更低（${atk433} vs ${atk442}）`);
  // 实际出场人数随阵型变化。
  assertEquals(resolveMatchSquad(state, 'clb_001', t442).length, 11);
  assertEquals(resolveMatchSquad(state, 'clb_001', t433).length, 11);
  assertEquals(resolveMatchSquad(state, 'clb_001', t433).filter((p) => p.position === 'FW').length, 3);
});

// ---------- 14. 战术改变实际影响比赛 ----------
test('战术倾向改变实际影响比赛结果（进攻期望高于防守）', () => {
  const state = leagueState(4);
  const opponent = { formation: '4-4-2', mentality: 'balanced' };
  let attacking = 0;
  let defensive = 0;
  for (let i = 0; i < 60; i += 1) {
    const home = { formation: '4-4-2', mentality: 'attacking' };
    const away = { formation: '4-4-2', mentality: 'defensive' };
    const hAtk = side(state, 'clb_001', home);
    const hDef = { ...hAtk, tactics: away };
    const opp = side(state, 'clb_002', opponent);
    const seed = `seed_${i}`;
    attacking += simulateMatch({ home: hAtk, away: opp, context: { worldId: 'w', season: 1, round: i, homeId: 'clb_001', awayId: 'clb_002' }, seed }).homeGoals;
    defensive += simulateMatch({ home: hDef, away: opp, context: { worldId: 'w', season: 1, round: i, homeId: 'clb_001', awayId: 'clb_002' }, seed }).homeGoals;
  }
  assert(attacking > defensive, `进攻战术进球应更多（${attacking} vs ${defensive}）`);
});

// ---------- 15. 赛季滚动后阵容自动修复 ----------
test('赛季滚动后玩家阵容自动修复：剔除退役/离队引用', () => {
  const state = leagueState(8);
  state.runtime.managedClubId = 'clb_001';
  state.runtime.clubs.clb_001.lineup = buildAutoLineup(state, 'clb_001', { formation: '4-4-2' });
  const victim = state.runtime.clubs.clb_001.lineup.starters[0];
  // 制造"该球员已退役"的局面。
  getWorldPlayers(state);
  state.runtime.retired[victim] = { playerId: victim, retiredSeason: 1 };
  repairManagedLineups(state);
  assert(!state.runtime.clubs.clb_001.lineup.starters.includes(victim), '失效引用应被剔除');
  for (const id of [...state.runtime.clubs.clb_001.lineup.starters, ...state.runtime.clubs.clb_001.lineup.bench]) {
    assert(getPlayerProfile(state, id) && !state.runtime.retired[id], `阵容不得含无效引用 ${id}`);
  }
});

test('整季推进后玩家阵容仍合法可打（自动修复 + 比赛不崩溃）', () => {
  const state = leagueState(8);
  state.runtime.managedClubId = 'clb_001';
  state.runtime.clubs.clb_001.lineup = buildAutoLineup(state, 'clb_001', { formation: '4-4-2' });
  new SimulationCore().advanceDays(state, 125); // 完成一个赛季并滚动
  const squad = resolveMatchSquad(state, 'clb_001', { formation: '4-4-2' });
  assert(squad.length > 0, '比赛出场集合不得为空');
  for (const id of [...state.runtime.clubs.clb_001.lineup.starters, ...state.runtime.clubs.clb_001.lineup.bench]) {
    const p = getPlayerProfile(state, id);
    assert(p && p.teamId === 'clb_001' && !state.runtime.retired[id], `阵容引用应有效：${id}`);
  }
});

// ---------- 17. save/load 回归（核心层，含 schema v6） ----------
test('save/load 核心层回归：lineup / managedClubId 稳定且旧档兜底为 null/空', async () => {
  const mgr = new MemorySaveManager();
  const state = leagueState(8);
  state.runtime.managedClubId = 'clb_001';
  state.runtime.clubs.clb_001.lineup = buildAutoLineup(state, 'clb_001', { formation: '4-4-2' });
  new SimulationCore().advanceDays(state, 30);
  await mgr.save('s', state);
  const payload = await mgr.load('s');
  const loaded = createGameState(state.static, { date: payload.currentDate, season: payload.season });
  loaded.runtime = payload.runtime;
  initializePlayerRuntime(loaded);
  assertEquals(loaded.runtime.managedClubId, 'clb_001');
  assertEquals(loaded.runtime.clubs.clb_001.lineup, state.runtime.clubs.clb_001.lineup);

  // 旧档：删除 v6 新增字段 → 兜底。
  const old = JSON.parse(JSON.stringify(payload));
  delete old.runtime.managedClubId;
  for (const c of Object.values(old.runtime.clubs)) delete c.lineup;
  const { deserializeState } = await import('../src/save/save-manager.js');
  const legacy = deserializeState(old);
  assertEquals(legacy.runtime.managedClubId, null, '旧档应兜底为 null');
});

// ---------- 长期稳定（10 / 50 赛季，含玩家球队） ----------
function assertLineupSane(state, label) {
  const clubId = state.runtime.managedClubId;
  const lineup = state.runtime.clubs[clubId].lineup;
  for (const id of [...lineup.starters, ...lineup.bench]) {
    const p = getPlayerProfile(state, id);
    assert(p && p.teamId === clubId, `${label} 阵容含无效 playerId ${id}`);
    assert(!state.runtime.retired[id], `${label} 阵容含退役 playerId ${id}`);
  }
  assert(lineup.starters.length <= LINEUP_LIMITS.STARTERS, `${label} 首发越界`);
  assert(lineup.bench.length <= LINEUP_LIMITS.BENCH, `${label} 替补越界`);
  const squad = resolveMatchSquad(state, clubId, { formation: state.runtime.clubs[clubId].tactics.formation });
  assert(squad.length > 0, `${label} 出场集合为空`);
  for (const k of ['attack', 'midfield', 'defence', 'goalkeeping']) {
    const v = computeTeamStrength(state, clubId)[k];
    assert(Number.isFinite(v) && v >= 1 && v <= 99, `${label} 实力非法 ${k}=${v}`);
  }
}

test('10 赛季长期：玩家阵容无无效引用、无空阵容、实力有限', () => {
  const state = leagueState(8);
  state.runtime.managedClubId = 'clb_001';
  state.runtime.clubs.clb_001.lineup = buildAutoLineup(state, 'clb_001', { formation: '4-4-2' });
  new SimulationCore().advanceDays(state, 10 * 125);
  assertLineupSane(state, '10季');
});

test('50 赛季长期：玩家阵容无无效引用、无空阵容、实力有限', () => {
  const state = leagueState(8);
  state.runtime.managedClubId = 'clb_001';
  state.runtime.clubs.clb_001.lineup = buildAutoLineup(state, 'clb_001', { formation: '4-3-3' });
  new SimulationCore().advanceDays(state, 50 * 125);
  assertLineupSane(state, '50季');
});