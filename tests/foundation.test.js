/**
 * Step 25 合同 / 财政地基测试。
 * 覆盖：合同创建/终止/归一化/不变量、free_agent 结构、退役合同清理、
 * 财政初始化/归一化/不变量/spendable、schema 9→10 迁移、save/load continuation、
 * 确定性（无 RNG）、比赛黄金指纹不变、长期稳定。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { createGameState, GAME_STATE_SCHEMA_VERSION } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { GameController } from '../src/controller/game-controller.js';
import { MemorySaveManager, serializeState, deserializeState } from '../src/save/save-manager.js';
import {
  getPlayerContract, isFreeAgent, createContract, terminateContract,
  normalizeContracts, assertContractInvariants, CONTRACT_STATUS,
} from '../src/core/contract.js';
import {
  getClubFinance, getSpendableCash, normalizeFinance, assertFinanceInvariants, financeTemplate,
} from '../src/core/finance.js';
import { getWorldPlayers, initializePlayerRuntime } from '../src/core/player-runtime.js';
import { getPlayerClub, removePlayerMembership, validateMembership } from '../src/core/membership.js';
import { GAME_STATE_SCHEMA_VERSION as SCHEMA } from '../src/core/game-state.js';
import { makeLeagueWorldFiles } from './fixtures.js';

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
function agedState(n, positions) {
  const files = makeLeagueWorldFiles(n);
  files.players = files.players.map((p) => (
    positions.includes(p.position) ? { ...p, birthDate: '1980-01-15' } : p
  ));
  return createGameState(parseWorld(files));
}
class StubLoader {
  async loadWorld() { return parseWorld(makeLeagueWorldFiles(8)); }
}
function activeIds(state) {
  return getWorldPlayers(state).map((p) => p.id).sort();
}

// ============ Contract ============

test('合同：createGameState 为所有 active 球员建立确定性 active 合同且与 membership 一致', () => {
  const state = leagueState(8);
  for (const p of getWorldPlayers(state)) {
    const c = getPlayerContract(state, p.id);
    assert(c, `${p.id} 应有合同`);
    assertEquals(c.status, CONTRACT_STATUS.ACTIVE);
    assertEquals(c.clubId, getPlayerClub(state, p.id));
    assert(Number.isInteger(c.startSeason) && Number.isInteger(c.endSeason));
    assert(c.endSeason >= c.startSeason);
    assert(Number.isFinite(c.wage) && c.wage >= 0);
  }
  assertEquals(Object.keys(state.runtime.contracts).length, activeIds(state).length);
  assertContractInvariants(state); // 不抛
});

test('合同：createContract 拒绝重复合同', () => {
  const state = leagueState(8);
  const id = getWorldPlayers(state)[0].id;
  const c = getPlayerContract(state, id);
  assertThrows(() => createContract(state, { ...c }), 'SimulationError');
});

test('合同：createContract 拒绝无效 club / membership 不一致', () => {
  const state = leagueState(8);
  const player = getWorldPlayers(state)[0];
  const club = getPlayerClub(state, player.id);
  const other = Object.keys(state.runtime.clubs).find((c) => c !== club);
  terminateContract(state, player.id);

  // 无效 club
  assertThrows(() => createContract(state, {
    playerId: player.id, clubId: 'clb_nope', startSeason: 1, endSeason: 3, wage: 10, status: 'active',
  }), 'SimulationError');

  // membership 不一致（用另一个有效 club）
  assertThrows(() => createContract(state, {
    playerId: player.id, clubId: other, startSeason: 1, endSeason: 3, wage: 10, status: 'active',
  }), 'SimulationError');

  // 数值非法
  assertThrows(() => createContract(state, {
    playerId: player.id, clubId: club, startSeason: 3, endSeason: 1, wage: 10, status: 'active',
  }), 'SimulationError');
  assertThrows(() => createContract(state, {
    playerId: player.id, clubId: club, startSeason: 1, endSeason: 3, wage: -1, status: 'active',
  }), 'SimulationError');
  assertThrows(() => createContract(state, {
    playerId: player.id, clubId: club, startSeason: 1, endSeason: 3, wage: 10, status: 'bogus',
  }), 'SimulationError');
});

test('合同：free_agent 结构合法且不变量通过；与 membership/clubId 冲突被拒', () => {
  const state = leagueState(8);
  const id = getWorldPlayers(state)[0].id;
  terminateContract(state, id);
  removePlayerMembership(state, id);

  const c = createContract(state, {
    playerId: id, clubId: null, startSeason: 1, endSeason: 2, wage: 0, status: 'free_agent',
  });
  assertEquals(c.clubId, null);
  assert(isFreeAgent(state, id));
  assertEquals(getPlayerClub(state, id), null);
  assertContractInvariants(state);

  // free_agent 带非 null clubId 被拒
  const id2 = getWorldPlayers(state)[1].id;
  terminateContract(state, id2);
  removePlayerMembership(state, id2);
  assertThrows(() => createContract(state, {
    playerId: id2, clubId: 'clb_001', startSeason: 1, endSeason: 2, wage: 0, status: 'free_agent',
  }), 'SimulationError');
});

test('合同：active 合同与 membership 不一致时 assertContractInvariants 报错', () => {
  const state = leagueState(8);
  const id = getWorldPlayers(state)[0].id;
  state.runtime.contracts[id].clubId = 'clb_002'; // 破坏一致性（membership 仍为其原 club）
  assertThrows(() => assertContractInvariants(state), 'SimulationError');
});

test('合同：退役球员不得保留 active contract（不变量 + 生命周期集成）', () => {
  // 不变量：手工标记退役但保留合同 → 报错
  const corrupt = leagueState(8);
  const id = getWorldPlayers(corrupt)[0].id;
  corrupt.runtime.retired[id] = { playerId: id, retiredSeason: 1 };
  assertThrows(() => assertContractInvariants(corrupt), 'SimulationError');

  // 生命周期集成：老球员在 rollover 退役 → 合同被终止 + 归档快照
  const state = agedState(8, ['FW']);
  new SimulationCore().advanceDays(state, 91); // 第 1 季结束并 rollover
  const retiredIds = Object.keys(state.runtime.retired);
  assert(retiredIds.length > 0, '应有球员退役');
  for (const rid of retiredIds) {
    assertEquals(getPlayerContract(state, rid), null, `退役者 ${rid} 不得保留合同`);
    assert('contract' in state.runtime.retired[rid], '归档应含 contract 快照字段');
  }
  assertContractInvariants(state);
});

test('合同：terminateContract 删除并返回快照副本；缺失时安全返回 null', () => {
  const state = leagueState(8);
  const id = getWorldPlayers(state)[0].id;
  const snap = terminateContract(state, id);
  assert(snap && snap.playerId === id);
  assertEquals(getPlayerContract(state, id), null);
  assertEquals(terminateContract(state, id), null); // 再次调用安全
});

test('合同：normalizeContracts 幂等、确定性、不创建 free agent、可重建缺失容器', () => {
  const state = leagueState(8);
  const snap1 = JSON.stringify(state.runtime.contracts);
  normalizeContracts(state);
  assertEquals(JSON.stringify(state.runtime.contracts), snap1, '已有合同不得被覆盖/改变');
  normalizeContracts(state);
  assertEquals(JSON.stringify(state.runtime.contracts), snap1, '幂等');

  delete state.runtime.contracts;
  normalizeContracts(state);
  assertEquals(JSON.stringify(state.runtime.contracts), snap1, '缺失容器可确定性重建');
  for (const c of Object.values(state.runtime.contracts)) {
    assertEquals(c.status, CONTRACT_STATUS.ACTIVE, '迁移阶段不得创建 free agent');
  }

  // 同世界两次完全一致
  const a = leagueState(8);
  const b = leagueState(8);
  assertEquals(JSON.stringify(a.runtime.contracts), JSON.stringify(b.runtime.contracts), '确定性');
});

// ============ Finance ============

test('财政：每个 club 有确定性 finance，且不变量通过', () => {
  const state = leagueState(8);
  for (const clubId of Object.keys(state.runtime.clubs)) {
    const f = getClubFinance(state, clubId);
    assert(f, `${clubId} 应有 finance`);
    for (const k of ['cash', 'wageBudget', 'transferBudget']) {
      assert(Number.isFinite(f[k]) && f[k] >= 0, `${clubId}.${k} 应有限非负`);
    }
  }
  assertFinanceInvariants(state);
  const a = leagueState(8);
  const b = leagueState(8);
  assertEquals(JSON.stringify(a.runtime.clubs.clb_001.finance), JSON.stringify(b.runtime.clubs.clb_001.finance));
});

test('财政：normalizeFinance 幂等并修正非法值，保留合法值', () => {
  const state = leagueState(8);
  const club = state.runtime.clubs.clb_001;
  club.finance.cash = 1234; // 合法：应保留
  club.finance.wageBudget = -5; // 非法
  club.finance.transferBudget = NaN; // 非法
  normalizeFinance(state);
  assertEquals(club.finance.cash, 1234, '合法值应保留');
  const tpl = financeTemplate();
  assertEquals(club.finance.wageBudget, tpl.wageBudget);
  assertEquals(club.finance.transferBudget, tpl.transferBudget);
  assertFinanceInvariants(state);

  const snap = JSON.stringify(state.runtime.clubs);
  normalizeFinance(state);
  assertEquals(JSON.stringify(state.runtime.clubs), snap, '幂等');
});

test('财政：spendable cash = min(cash, transferBudget)', () => {
  const state = leagueState(8);
  const f = state.runtime.clubs.clb_001.finance;
  assertEquals(getSpendableCash(state, 'clb_001'), Math.min(f.cash, f.transferBudget));
  f.cash = 100; f.transferBudget = 600;
  assertEquals(getSpendableCash(state, 'clb_001'), 100);
  f.cash = 900; f.transferBudget = 300;
  assertEquals(getSpendableCash(state, 'clb_001'), 300);
});

test('财政：assertFinanceInvariants 对非法值报错', () => {
  const state = leagueState(8);
  state.runtime.clubs.clb_001.finance.cash = -1;
  assertThrows(() => assertFinanceInvariants(state), 'SimulationError');
  state.runtime.clubs.clb_001.finance.cash = Infinity;
  assertThrows(() => assertFinanceInvariants(state), 'SimulationError');
});

// ============ Save / Migration ============

test('schema：版本为 10；9→10 旧档缺 contracts/finance 可确定性补齐并加载', () => {
  assertEquals(GAME_STATE_SCHEMA_VERSION, 10);
  assertEquals(SCHEMA, 10);

  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 40);
  const payload = JSON.parse(JSON.stringify(serializeState(state)));
  delete payload.runtime.contracts; // 模拟 schema 9
  for (const c of Object.values(payload.runtime.clubs)) delete c.finance;
  payload.stateSchemaVersion = 9;

  const p2 = deserializeState(payload);
  const loaded = createGameState(state.static, { date: p2.currentDate, season: p2.season });
  loaded.runtime = p2.runtime;
  initializePlayerRuntime(loaded);
  // 与 controller.load 同序的补齐 + 校验
  normalizeContracts(loaded);
  normalizeFinance(loaded);
  assertContractInvariants(loaded);
  assertFinanceInvariants(loaded);

  for (const p of getWorldPlayers(loaded)) {
    const c = getPlayerContract(loaded, p.id);
    assert(c && c.status === CONTRACT_STATUS.ACTIVE && c.clubId === getPlayerClub(loaded, p.id));
  }
  for (const clubId of Object.keys(loaded.runtime.clubs)) assert(getClubFinance(loaded, clubId));

  // 再次 normalize 状态不再变化
  const snap = JSON.stringify(loaded.runtime);
  normalizeContracts(loaded);
  normalizeFinance(loaded);
  assertEquals(JSON.stringify(loaded.runtime), snap, 'normalize 幂等');

  // 继续模拟一致（不崩溃）
  new SimulationCore().advanceDays(loaded, 30);
  assertContractInvariants(loaded);
  assertFinanceInvariants(loaded);
});

test('save/load：controller 往返后合同/财政稳定且继续模拟一致', async () => {
  const controller = new GameController({
    dataLoader: new StubLoader(), saveManager: new MemorySaveManager(), simulation: new SimulationCore(),
  });
  await controller.startNewGame('w');
  controller.setManagedClub('clb_001');
  new SimulationCore().advanceDays(controller.getState(), 40);
  const contractsBefore = JSON.stringify(controller.getState().runtime.contracts);
  const financeBefore = JSON.stringify(controller.getState().runtime.clubs.clb_001.finance);
  await controller.save('s');
  await controller.load('s');
  assertEquals(JSON.stringify(controller.getState().runtime.contracts), contractsBefore);
  assertEquals(JSON.stringify(controller.getState().runtime.clubs.clb_001.finance), financeBefore);
  new SimulationCore().advanceDays(controller.getState(), 40); // 不崩溃
  assertContractInvariants(controller.getState());
});

// ============ RNG / 黄金指纹 ============

test('RNG：引入合同/财政不改变比赛结果（整季黄金指纹）', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 90); // 赛季 1 内，无 rollover
  const comp = state.runtime.competitions.lg_a;
  const totalGoals = comp.fixtures.reduce((s, f) => s + (f.played ? f.homeGoals + f.awayGoals : 0), 0);
  const playerGoals = state.static.players.reduce((s, p) => s + state.runtime.players[p.id].stats.season.goals, 0);
  const playerApp = state.static.players.reduce((s, p) => s + state.runtime.players[p.id].stats.season.appearances, 0);
  assertEquals(state.season, 1);
  assertEquals(totalGoals, 143, '整季总进球不变');
  assertEquals(playerGoals, 143, '球员进球守恒不变');
  assertEquals(playerApp, 1141, '总出场不变');
});

// ============ 长期稳定 ============

test('长期 10/50/100 赛季：合同/财政不变量稳定，无 NaN，退役者无合同', () => {
  for (const seasons of [10, 50, 100]) {
    const state = leagueState(8);
    new SimulationCore().advanceDays(state, seasons * 125);
    assertContractInvariants(state);
    assertFinanceInvariants(state);
    assertEquals(getWorldPlayers(state).length, 112, `${seasons} 季后人口应为 112`);
    assertEquals(getWorldPlayers(state).filter((p) => p.position === 'GK').length, 8, `${seasons} 季后 GK 应为 8`);
    for (const [clubId, club] of Object.entries(state.runtime.clubs)) {
      for (const k of ['cash', 'wageBudget', 'transferBudget']) {
        assert(Number.isFinite(club.finance[k]) && club.finance[k] >= 0, `${clubId}.${k} 非法`);
      }
    }
    for (const rid of Object.keys(state.runtime.retired)) {
      assertEquals(getPlayerContract(state, rid), null, `退役者 ${rid} 不得有合同`);
    }
    assertEquals(validateMembership(state).fatal, [], `${seasons} 季 membership 应有致命问题`);
  }
});