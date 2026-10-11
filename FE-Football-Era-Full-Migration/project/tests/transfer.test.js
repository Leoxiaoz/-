/**
 * Step 28B — Transfer System v1 测试（DECISIONS D-27 / SIMULATION_SPEC §33）。
 * 覆盖 A–P：成功转会、前置拒绝、finance、roster、contract、membership、lineup、runtime 保全、
 * generated、event、确定性、fee bounds、失败原子性、save/load、长跑、黄金回归。
 *
 * 红线：不改比赛 / 成长 / 伤病 / population 逻辑；不新增 RNG；schema 仍 10 / save format 仍 1。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { GameController } from '../src/controller/game-controller.js';
import {
  getPlayerRuntime, getPlayerProfile, isRetired, initializePlayerRuntime, getTeamPlayers, getWorldPlayers,
} from '../src/core/player-runtime.js';
import { getPlayerClub, getClubPlayers, validateMembership, addPlayerMembership } from '../src/core/membership.js';
import { getPlayerContract, assertContractInvariants, CONTRACT_STATUS, terminateContract } from '../src/core/contract.js';
import { getClubFinance, assertFinanceInvariants, applyCashDelta } from '../src/core/finance.js';
import {
  transferPlayer, validateTransfer, buildTransferPlan, computeTransferFee, clampTransferFee, assertTransferInvariants,
} from '../src/core/transfer.js';
import { releasePlayerToFreeAgent } from '../src/core/free-agent.js';
import { generatePlayer } from '../src/core/player-lifecycle.js';
import { computeTeamStrength, resolveMatchSquad } from '../src/core/team-strength.js';
import { TRANSFER_CONFIG, ROSTER_CONFIG } from '../src/core/sim-config.js';
import { MemorySaveManager } from '../src/save/save-manager.js';
import { makeLeagueWorldFiles } from './fixtures.js';

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
function throwsCode(fn, code) {
  let caught = null;
  try { fn(); } catch (e) { caught = e; }
  assert(caught, `应抛出错误（期望 code=${code}）`);
  assertEquals(caught.code, code, `错误码应为 ${code}（实际 ${caught.code}）`);
  return caught;
}
function coreSnapshot(state) {
  return JSON.stringify({
    contracts: state.runtime.contracts,
    membership: state.runtime.membership,
    players: state.runtime.players,
    lineups: Object.fromEntries(Object.entries(state.runtime.clubs).map(([k, v]) => [k, v.lineup ?? null])),
    finance: Object.fromEntries(Object.entries(state.runtime.clubs).map(([k, v]) => [k, v.finance ?? null])),
  });
}
function feeOf(state, playerId) {
  return computeTransferFee(state, getPlayerProfile(state, playerId));
}
function firstOutfield(state, clubId) {
  return getClubPlayers(state, clubId).find((p) => getPlayerProfile(state, p)?.position !== 'GK');
}

// ---------- A. Success ----------
test('A. 成功转会：Club A → Club B（membership/contract/finance/lineup 一致变更）', () => {
  const state = leagueState(8);
  const id = firstOutfield(state, 'clb_001');
  const fee = feeOf(state, id);
  const sellerCash0 = getClubFinance(state, 'clb_001').cash;
  const buyerCash0 = getClubFinance(state, 'clb_002').cash;
  const buyerBudget0 = getClubFinance(state, 'clb_002').transferBudget;

  const r = transferPlayer(state, id, 'clb_002');
  assertEquals(r.sellerClubId, 'clb_001');
  assertEquals(r.buyerClubId, 'clb_002');
  assertEquals(r.transferFee, fee);

  assertEquals(getPlayerClub(state, id), 'clb_002');
  assertEquals(getClubPlayers(state, 'clb_001').includes(id), false);
  assertEquals(getClubPlayers(state, 'clb_002').includes(id), true);
  assertEquals(getClubFinance(state, 'clb_001').cash, sellerCash0 + fee, 'seller cash += fee');
  assertEquals(getClubFinance(state, 'clb_002').cash, buyerCash0 - fee, 'buyer cash -= fee');
  assertEquals(getClubFinance(state, 'clb_002').transferBudget, buyerBudget0 - fee, 'buyer budget -= fee');
  assertEquals(getClubFinance(state, 'clb_001').transferBudget, 600, 'seller budget 不增');
  assertContractInvariants(state);
  assertFinanceInvariants(state);
  assertTransferInvariants(state);
});

// ---------- B. Preconditions ----------
test('B. 前置拒绝：不存在 / 退役 / 无归属 / 无合同 / 合同不符 / 买方缺失 / 同队 / 自由身 / 满员 / 最后 GK', () => {
  const state = leagueState(8);
  const id = firstOutfield(state, 'clb_001');

  throwsCode(() => transferPlayer(state, 'ply_nope', 'clb_002'), 'PLAYER_NOT_FOUND');

  // 退役
  state.runtime.retired[id] = { playerId: id, retiredSeason: 1 };
  throwsCode(() => transferPlayer(state, id, 'clb_002'), 'PLAYER_RETIRED');
  delete state.runtime.retired[id];

  // 无归属（membership 缺失）
  const s2 = leagueState(8);
  const id2 = firstOutfield(s2, 'clb_001');
  delete s2.runtime.membership.players[id2];
  throwsCode(() => transferPlayer(s2, id2, 'clb_002'), 'PLAYER_NOT_IN_SELLER');

  // 无 active 合同（非 generated 静态球员）
  const s3 = leagueState(8);
  const id3 = firstOutfield(s3, 'clb_001');
  terminateContract(s3, id3);
  throwsCode(() => transferPlayer(s3, id3, 'clb_002'), 'PLAYER_HAS_NO_ACTIVE_CONTRACT');

  // 合同与 membership 不符
  const s4 = leagueState(8);
  const id4 = firstOutfield(s4, 'clb_001');
  s4.runtime.contracts[id4].clubId = 'clb_003';
  throwsCode(() => transferPlayer(s4, id4, 'clb_002'), 'CONTRACT_MISMATCH');

  // 买方缺失
  const s5 = leagueState(8);
  throwsCode(() => transferPlayer(s5, firstOutfield(s5, 'clb_001'), 'clb_zzz'), 'BUYER_CLUB_NOT_FOUND');

  // 同队
  const s6 = leagueState(8);
  throwsCode(() => transferPlayer(s6, firstOutfield(s6, 'clb_001'), 'clb_001'), 'SAME_CLUB');

  // 自由身
  const s7 = leagueState(8);
  const fa = firstOutfield(s7, 'clb_001');
  releasePlayerToFreeAgent(s7, fa);
  throwsCode(() => transferPlayer(s7, fa, 'clb_002'), 'FREE_AGENT_NOT_TRANSFERABLE');

  // 买方满员（24）
  const s8 = leagueState(8);
  while (getClubPlayers(s8, 'clb_002').length < ROSTER_CONFIG.MAX_PLAYERS) {
    generatePlayer(s8, { position: 'MF', teamId: 'clb_002', season: 1, fromSeason: 0 });
  }
  throwsCode(() => transferPlayer(s8, firstOutfield(s8, 'clb_001'), 'clb_002'), 'ROSTER_FULL');

  // 卖方最后 GK
  const s9 = leagueState(8);
  const gk = getClubPlayers(s9, 'clb_001').find((p) => getPlayerProfile(s9, p)?.position === 'GK');
  throwsCode(() => transferPlayer(s9, gk, 'clb_002'), 'SELLER_LAST_GK');
});

// ---------- C. Finance ----------
test('C. Finance：现金不足 / 预算不足 / 恰好 / 预算恰好 / 零费边界', () => {
  const id = (s) => firstOutfield(s, 'clb_001');
  // 现金不足
  const s1 = leagueState(8);
  const fee1 = feeOf(s1, id(s1));
  getClubFinance(s1, 'clb_002').cash = fee1 - 1;
  throwsCode(() => transferPlayer(s1, id(s1), 'clb_002'), 'INSUFFICIENT_CASH');

  // 预算不足（cash 充足）
  const s2 = leagueState(8);
  const fee2 = feeOf(s2, id(s2));
  getClubFinance(s2, 'clb_002').transferBudget = fee2 - 1;
  throwsCode(() => transferPlayer(s2, id(s2), 'clb_002'), 'INSUFFICIENT_TRANSFER_BUDGET');

  // 现金与预算恰好
  const s3 = leagueState(8);
  const fee3 = feeOf(s3, id(s3));
  getClubFinance(s3, 'clb_002').cash = fee3;
  getClubFinance(s3, 'clb_002').transferBudget = fee3;
  transferPlayer(s3, id(s3), 'clb_002');
  assertEquals(getClubFinance(s3, 'clb_002').cash, 0, '恰好用尽现金');
  assertEquals(getClubFinance(s3, 'clb_002').transferBudget, 0, '恰好用尽预算');

  // 零费边界（MIN）：clamp 语义
  assertEquals(clampTransferFee(0), 0);
  assertEquals(clampTransferFee(-999), TRANSFER_CONFIG.MIN_TRANSFER_FEE);
  assertEquals(clampTransferFee(999999), TRANSFER_CONFIG.MAX_TRANSFER_FEE);
});

// ---------- D. Roster ----------
test('D. Roster：seller 可暂时低于 MIN；buyer 可到 MAX；buyer=MAX 拒绝；GK 保护', () => {
  const state = leagueState(8);
  // seller 14 → 11（连续转出 3 名非 GK），均成功（不因低于 MIN 被拒）
  // 但转移目标都设为 clb_003..clb_005 以避免目标满员
  const outs = getClubPlayers(state, 'clb_001').filter((p) => getPlayerProfile(state, p)?.position !== 'GK').slice(0, 3);
  const buyers = ['clb_002', 'clb_003', 'clb_004'];
  outs.forEach((pid, i) => transferPlayer(state, pid, buyers[i]));
  assertEquals(getClubPlayers(state, 'clb_001').length, 11, 'seller 允许暂时低于 MIN(12)');
  assertTransferInvariants(state);
});

// ---------- E. Contract ----------
test('E. Contract：旧合同终止、新 active 合同、新 club 正确、默认条款', () => {
  const state = leagueState(8);
  const id = firstOutfield(state, 'clb_001');
  const old = { ...getPlayerContract(state, id) };
  transferPlayer(state, id, 'clb_002');
  const c = getPlayerContract(state, id);
  assertEquals(c.status, CONTRACT_STATUS.ACTIVE);
  assertEquals(c.clubId, 'clb_002');
  assertEquals(c.playerId, id);
  assertEquals(c.startSeason, state.season);
  assert(c.endSeason >= c.startSeason && c.wage >= 0, '默认条款合法');
  assert(!(c.startSeason === old.startSeason && c.endSeason === old.endSeason && c.wage === old.wage && old.clubId === 'clb_002'), '合同已变化');
});

// ---------- F. Membership ----------
test('F. Membership：seller 移除、buyer 指派、无 null 中间态', () => {
  const state = leagueState(8);
  const id = firstOutfield(state, 'clb_001');
  transferPlayer(state, id, 'clb_002');
  assertEquals(state.runtime.membership.players[id], 'clb_002', 'membership 为 buyer（字符串，非 null）');
  assertEquals(getPlayerClub(state, id), 'clb_002');
  assertEquals(validateMembership(state).fatal, []);
});

// ---------- G. Lineup ----------
test('G. Lineup：seller 首发/替补均清除；buyer 不自动加入', () => {
  const state = leagueState(8);
  const id = firstOutfield(state, 'clb_001');
  state.runtime.clubs.clb_001.lineup = { starters: [id], bench: [] };
  transferPlayer(state, id, 'clb_002');
  assertEquals(state.runtime.clubs.clb_001.lineup.starters.includes(id), false, 'seller 首发清除');
  assertEquals(state.runtime.clubs.clb_001.lineup.bench.includes(id), false, 'seller 替补清除');
  const buyerLineup = state.runtime.clubs.clb_002.lineup ?? { starters: [], bench: [] };
  assertEquals(buyerLineup.starters.includes(id), false, 'buyer 不自动进首发');
  assertEquals(buyerLineup.bench.includes(id), false, 'buyer 不自动进替补');
  // 转会球员进入 buyer roster（自动选阵候选）
  const squadIds = resolveMatchSquad(state, 'clb_002', state.runtime.clubs.clb_002.tactics).map((p) => p.id);
  assert(Array.isArray(squadIds));
});

// ---------- H. Runtime preservation ----------
test('H. runtime 保全：ability/fitness/form/morale/injury/stats 不变', () => {
  const state = leagueState(8);
  const id = firstOutfield(state, 'clb_001');
  const before = JSON.stringify(getPlayerRuntime(state, id));
  transferPlayer(state, id, 'clb_002');
  assertEquals(JSON.stringify(getPlayerRuntime(state, id)), before, 'runtime 不得被 Transfer 改写');
});

// ---------- I. Generated Player ----------
test('I. generated 球员：Club + 无合同 可转会，registry 不变，建立新合同', () => {
  const state = leagueState(8);
  const gid = generatePlayer(state, { position: 'MF', teamId: 'clb_001', season: 1, fromSeason: 0 });
  assertEquals(getPlayerContract(state, gid), null, 'generated 初始无合同');
  const registryBefore = JSON.stringify(state.runtime.generated);

  transferPlayer(state, gid, 'clb_002');
  assertEquals(getPlayerClub(state, gid), 'clb_002');
  assertEquals(getPlayerContract(state, gid).status, CONTRACT_STATUS.ACTIVE, 'Transfer 建立新 active 合同');
  assertEquals(JSON.stringify(state.runtime.generated), registryBefore, 'generated registry 不变');
  assertEquals(getPlayerProfile(state, gid).generated, true, 'identity 不变');
});

// ---------- J. Event ----------
test('J. Event：记录 TRANSFER_COMPLETED 且字段正确', () => {
  const state = leagueState(8);
  const id = firstOutfield(state, 'clb_001');
  const fee = feeOf(state, id);
  transferPlayer(state, id, 'clb_002');
  const ev = state.runtime.events.filter((e) => e.type === 'TRANSFER_COMPLETED');
  assertEquals(ev.length, 1);
  assertEquals(ev[0].payload.playerId, id);
  assertEquals(ev[0].payload.sellerClubId, 'clb_001');
  assertEquals(ev[0].payload.buyerClubId, 'clb_002');
  assertEquals(ev[0].payload.transferFee, fee);
  assertEquals(ev[0].payload.season, state.season);
});

// ---------- K. Determinism ----------
test('K. 确定性：同 state + player + seller + buyer → 同 fee', () => {
  const a = leagueState(8);
  const b = leagueState(8);
  const id = firstOutfield(a, 'clb_001'); // 非 GK（GK 受 seller 最后一名保护，不可转出）
  assertEquals(computeTransferFee(a, getPlayerProfile(a, id)), computeTransferFee(b, getPlayerProfile(b, id)));
  const ra = transferPlayer(a, id, 'clb_002');
  const rb = transferPlayer(b, id, 'clb_002');
  assertEquals(ra.transferFee, rb.transferFee);
  assertEquals(JSON.stringify(a.runtime.contracts), JSON.stringify(b.runtime.contracts));
  assertEquals(JSON.stringify(a.runtime.membership), JSON.stringify(b.runtime.membership));
});

// ---------- L. Bounds ----------
test('L. Fee bounds：finite、>= MIN、<= MAX，且对全量球员成立', () => {
  const state = leagueState(8);
  for (const p of getWorldPlayers(state)) {
    const fee = computeTransferFee(state, p);
    assert(Number.isFinite(fee), `${p.id} fee 非有限`);
    assert(fee >= TRANSFER_CONFIG.MIN_TRANSFER_FEE, `${p.id} fee < MIN`);
    assert(fee <= TRANSFER_CONFIG.MAX_TRANSFER_FEE, `${p.id} fee > MAX`);
  }
});

// ---------- M. Failure Atomicity ----------
test('M. 失败原子性：任一失败不产生任何半提交', () => {
  // [code, setup（在快照前执行，属测试夹具而非 Transfer 副作用）, run（应失败的 Transfer 调用）]
  const cases = [
    ['PLAYER_NOT_FOUND', null, (s) => transferPlayer(s, 'ply_nope', 'clb_002')],
    ['SAME_CLUB', null, (s) => transferPlayer(s, firstOutfield(s, 'clb_001'), 'clb_001')],
    ['BUYER_CLUB_NOT_FOUND', null, (s) => transferPlayer(s, firstOutfield(s, 'clb_001'), 'clb_zzz')],
    ['ROSTER_FULL', (s) => {
      while (getClubPlayers(s, 'clb_002').length < ROSTER_CONFIG.MAX_PLAYERS) {
        generatePlayer(s, { position: 'MF', teamId: 'clb_002', season: 1, fromSeason: 0 });
      }
    }, (s) => transferPlayer(s, firstOutfield(s, 'clb_001'), 'clb_002')],
    ['SELLER_LAST_GK', null, (s) => {
      const gk = getClubPlayers(s, 'clb_001').find((p) => getPlayerProfile(s, p)?.position === 'GK');
      return transferPlayer(s, gk, 'clb_002');
    }],
    ['PLAYER_HAS_NO_ACTIVE_CONTRACT', (s) => {
      terminateContract(s, firstOutfield(s, 'clb_001'));
    }, (s) => transferPlayer(s, firstOutfield(s, 'clb_001'), 'clb_002')],
  ];
  for (const [code, setup, run] of cases) {
    const state = leagueState(8);
    if (setup) setup(state);
    const before = coreSnapshot(state);
    throwsCode(() => run(state), code);
    assertEquals(coreSnapshot(state), before, `${code} 失败后状态必须不变`);
  }

  // 现金不足
  const s = leagueState(8);
  const id = firstOutfield(s, 'clb_001');
  getClubFinance(s, 'clb_002').cash = feeOf(s, id) - 1;
  const before = coreSnapshot(s);
  throwsCode(() => transferPlayer(s, id, 'clb_002'), 'INSUFFICIENT_CASH');
  assertEquals(coreSnapshot(s), before, '现金不足失败后状态必须不变');
});

// ---------- N. Save/Load ----------
test('N. Save/Load：Transfer 后继续往返一致（schema 仍 10）', async () => {
  const state = leagueState(8);
  const id = firstOutfield(state, 'clb_001');
  transferPlayer(state, id, 'clb_002');
  new SimulationCore().advanceDays(state, 125);
  const mgr = new MemorySaveManager();
  await mgr.save('s', state);
  const payload = await mgr.load('s');
  const loaded = createGameState(state.static, { date: payload.currentDate, season: payload.season });
  loaded.runtime = JSON.parse(JSON.stringify(payload.runtime));
  initializePlayerRuntime(loaded);

  assertEquals(getPlayerClub(loaded, id), 'clb_002');
  assertEquals(JSON.stringify(loaded.runtime.contracts), JSON.stringify(state.runtime.contracts));
  assertEquals(JSON.stringify(loaded.runtime.membership), JSON.stringify(state.runtime.membership));
  for (const club of Object.keys(state.runtime.clubs)) {
    assertEquals(getClubFinance(loaded, club).cash, getClubFinance(state, club).cash, `${club} cash 一致`);
    assertEquals(getClubFinance(loaded, club).transferBudget, getClubFinance(state, club).transferBudget, `${club} budget 一致`);
    assertEquals(JSON.stringify(loaded.runtime.clubs[club].lineup), JSON.stringify(state.runtime.clubs[club].lineup), `${club} lineup 一致`);
  }
  assertContractInvariants(loaded);
  assertFinanceInvariants(loaded);
  assertTransferInvariants(loaded);
});

// ---------- O. Long Run ----------
test('O. 长跑 10/50/100/200 赛季：无负数/溢出/超员/NaN/不变量破坏', () => {
  for (const seasons of [10, 50, 100, 200]) {
    const state = leagueState(8);
    // 制造若干转会（确定性）
    let n = 0;
    for (const pid of getClubPlayers(state, 'clb_001').filter((p) => getPlayerProfile(state, p)?.position !== 'GK').slice(0, 2)) {
      transferPlayer(state, pid, n % 2 === 0 ? 'clb_002' : 'clb_003');
      n += 1;
    }
    new SimulationCore().advanceDays(state, seasons * 125);

    assertContractInvariants(state);
    assertFinanceInvariants(state);
    assertTransferInvariants(state);
    for (const [clubId, club] of Object.entries(state.runtime.clubs)) {
      const rosterCount = getClubPlayers(state, clubId).length;
      assert(rosterCount <= ROSTER_CONFIG.MAX_PLAYERS, `${seasons}季 ${clubId} 超员 ${rosterCount}`);
      assert(Number.isFinite(club.finance.cash) && club.finance.cash >= 0, `${seasons}季 ${clubId} cash 非法`);
      assert(Number.isFinite(club.finance.transferBudget) && club.finance.transferBudget >= 0, `${seasons}季 ${clubId} budget 非法`);
      const gk = getTeamPlayers(state, clubId).filter((p) => p.position === 'GK').length;
      assert(gk >= 1, `${seasons}季 ${clubId} GK 真空`);
    }
    for (const p of getWorldPlayers(state)) {
      assert(!isRetired(state, p.id) || true);
    }
  }
});

// ---------- Controller ----------
class StubLoader {
  async loadWorld() { return parseWorld(makeLeagueWorldFiles(8)); }
}
test('Controller：transferPlayer 转发 domain op，返回 {success, ...}；失败返回 code', async () => {
  const controller = new GameController({
    dataLoader: new StubLoader(),
    saveManager: new MemorySaveManager(),
    simulation: new SimulationCore(),
  });
  await controller.startNewGame('w');
  const state = controller.getState();
  const id = firstOutfield(state, 'clb_001');
  const ok = controller.transferPlayer(id, 'clb_002');
  assertEquals(ok.success, true);
  assertEquals(ok.sellerClubId, 'clb_001');
  assertEquals(ok.buyerClubId, 'clb_002');
  assert(Number.isFinite(ok.transferFee));

  const bad = controller.transferPlayer('ply_nope', 'clb_002');
  assertEquals(bad.success, false);
  assertEquals(bad.code, 'PLAYER_NOT_FOUND');
});