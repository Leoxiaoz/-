/**
 * Step 27B — Free Agent + Membership Integration 测试。
 * 覆盖：release / sign 原子性、membership null 语义、initializeMembership 不重播种、
 * lineup 清理、team strength / match squad 排除、Population 优先复用 Free Agent、
 * 退休、save/load、不变量、确定性、无 RNG、失败不半提交。
 *
 * 红线：不改比赛 / 成长 / 伤病模型；不新增 RNG；不升级 schema / SAVE_FORMAT_VERSION。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { GameController } from '../src/controller/game-controller.js';
import {
  getWorldPlayers, getPlayerProfile, getPlayerRuntime, isRetired, initializePlayerRuntime,
} from '../src/core/player-runtime.js';
import { getPlayerClub, getClubPlayers, validateMembership, initializeMembership, addPlayerMembership } from '../src/core/membership.js';
import { getPlayerContract, assertContractInvariants, CONTRACT_STATUS, updateContract } from '../src/core/contract.js';
import { assertFinanceInvariants } from '../src/core/finance.js';
import {
  releasePlayerToFreeAgent, signFreeAgent, getFreeAgents, getFreeAgentCount,
  selectFreeAgentForPosition, assertFreeAgentInvariants,
} from '../src/core/free-agent.js';
import { computeTeamStrength, resolveMatchSquad } from '../src/core/team-strength.js';
import { cleanLineup, repairManagedLineups } from '../src/core/player-lineup.js';
import { evaluatePopulationHealth, replenishPopulation, generatePlayer } from '../src/core/player-lifecycle.js';
import { ROSTER_CONFIG } from '../src/core/sim-config.js';
import { MemorySaveManager } from '../src/save/save-manager.js';
import { makeLeagueWorldFiles } from './fixtures.js';

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
function hasMemberKey(state, id) {
  return Object.prototype.hasOwnProperty.call(state.runtime.membership.players, id);
}
/** 断言 fn 抛出且错误码匹配；返回捕获的错误。 */
function throwsCode(fn, code) {
  let caught = null;
  try { fn(); } catch (e) { caught = e; }
  assert(caught, `应抛出错误（期望 code=${code}）`);
  assertEquals(caught.code, code, `错误码应为 ${code}（实际 ${caught.code}）`);
  return caught;
}
/** 运行时四处关键状态的深拷贝快照（用于原子性断言）。 */
function coreSnapshot(state) {
  return JSON.stringify({
    contracts: state.runtime.contracts,
    membership: state.runtime.membership,
    players: state.runtime.players,
    lineups: Object.fromEntries(Object.entries(state.runtime.clubs).map(([k, v]) => [k, v.lineup ?? null])),
    finance: Object.fromEntries(Object.entries(state.runtime.clubs).map(([k, v]) => [k, v.finance ?? null])),
  });
}

// ---------- A/B/C: release 基本 + contract + membership ----------
test('A/B/C. release：membership → null（key 保留），contract → free_agent 单季锚点 wage=0', () => {
  const state = leagueState(8);
  const id = getClubPlayers(state, 'clb_001')[0];
  assertEquals(getPlayerClub(state, id), 'clb_001');

  const r = releasePlayerToFreeAgent(state, id);
  assertEquals(r.fromClubId, 'clb_001');
  assertEquals(r.status, CONTRACT_STATUS.FREE_AGENT);

  // C: membership 显式 null 且 key 保留
  assertEquals(state.runtime.membership.players[id], null);
  assert(hasMemberKey(state, id), 'key 必须保留（不得 delete）');
  assertEquals(getPlayerClub(state, id), null);

  // B: contract mutation
  const c = getPlayerContract(state, id);
  assertEquals(c.status, CONTRACT_STATUS.FREE_AGENT);
  assertEquals(c.clubId, null);
  assertEquals(c.wage, 0);
  assertEquals(c.startSeason, state.season);
  assertEquals(c.endSeason, state.season);

  assertEquals(getFreeAgents(state).includes(id), true);
  assertEquals(getFreeAgentCount(state), 1);
  assertEquals(validateMembership(state).fatal, []);
  assertContractInvariants(state);
  assertFreeAgentInvariants(state);
});

// ---------- D: lineup cleanup ----------
test('D. release 清除该球员在所有 club lineup（starters + bench）中的引用', () => {
  const state = leagueState(8);
  const src = 'clb_001';
  const [a, b] = getClubPlayers(state, src);
  state.runtime.clubs[src].lineup = { starters: [a], bench: [b] };
  state.runtime.clubs.clb_002.lineup = { starters: [a], bench: [] }; // 人为跨队残留

  releasePlayerToFreeAgent(state, a);
  assertEquals(state.runtime.clubs[src].lineup.starters.includes(a), false);
  assertEquals(state.runtime.clubs.clb_002.lineup.starters.includes(a), false);
  assertFreeAgentInvariants(state);
});

// ---------- E/F/G/H: release 前置拒绝 ----------
test('E. release 不存在的球员 → PLAYER_NOT_FOUND', () => {
  const state = leagueState(8);
  throwsCode(() => releasePlayerToFreeAgent(state, 'ply_nope'), 'PLAYER_NOT_FOUND');
});

test('F. release 退役球员 → PLAYER_RETIRED', () => {
  const state = leagueState(8);
  const id = getClubPlayers(state, 'clb_001')[0];
  state.runtime.retired[id] = { playerId: id, retiredSeason: 1 };
  throwsCode(() => releasePlayerToFreeAgent(state, id), 'PLAYER_RETIRED');
});

test('G. release 无 active 合同（generated 球员）→ PLAYER_HAS_NO_ACTIVE_CONTRACT', () => {
  const state = leagueState(8);
  const gid = generatePlayer(state, { position: 'MF', teamId: 'clb_001', season: 1, fromSeason: 0 });
  assertEquals(getPlayerContract(state, gid), null, '新生代（D10 未决）不应有合同');
  throwsCode(() => releasePlayerToFreeAgent(state, gid), 'PLAYER_HAS_NO_ACTIVE_CONTRACT');
});

test('H. release 已是 Free Agent → PLAYER_ALREADY_FREE_AGENT', () => {
  const state = leagueState(8);
  const id = getClubPlayers(state, 'clb_001')[0];
  releasePlayerToFreeAgent(state, id);
  throwsCode(() => releasePlayerToFreeAgent(state, id), 'PLAYER_ALREADY_FREE_AGENT');
});

// ---------- I/J/K: sign 基本 + contract + membership ----------
test('I/J/K. sign：membership → clubId，contract → active（新条款，非沿用 free_agent 的 0/锚点）', () => {
  const state = leagueState(8);
  const id = getClubPlayers(state, 'clb_001')[0];
  releasePlayerToFreeAgent(state, id);

  const before = getPlayerRuntime(state, id);
  const r = signFreeAgent(state, id, 'clb_002');
  assertEquals(r.clubId, 'clb_002');

  assertEquals(getPlayerClub(state, id), 'clb_002');
  const c = getPlayerContract(state, id);
  assertEquals(c.status, CONTRACT_STATUS.ACTIVE);
  assertEquals(c.clubId, 'clb_002');
  assert(c.startSeason >= 1 && c.endSeason >= c.startSeason, '条款合法');
  assert(c.wage >= 0, 'wage 合法');
  assert(!(c.startSeason === c.endSeason && c.wage === 0), '不应沿用 free_agent 的锚点/零工资');
  assertEquals(getFreeAgents(state).includes(id), false);
  assertEquals(validateMembership(state).fatal, []);
  assertContractInvariants(state);
  assertFreeAgentInvariants(state);
  assertEquals(JSON.stringify(getPlayerRuntime(state, id)), JSON.stringify(before), '签约不得改 runtime');
});

// ---------- L/M/N/O/P: sign 前置拒绝 ----------
test('L. sign 目标俱乐部 roster >= MAX_PLAYERS → ROSTER_MAX_REACHED（不裁员）', () => {
  const state = leagueState(8);
  for (let i = 0; i < 10; i += 1) {
    generatePlayer(state, { position: 'MF', teamId: 'clb_002', season: 1, fromSeason: 0 });
  }
  assertEquals(getClubPlayers(state, 'clb_002').length, ROSTER_CONFIG.MAX_PLAYERS);
  const id = getClubPlayers(state, 'clb_001')[0];
  releasePlayerToFreeAgent(state, id);
  throwsCode(() => signFreeAgent(state, id, 'clb_002'), 'ROSTER_MAX_REACHED');
  assertEquals(getClubPlayers(state, 'clb_002').length, ROSTER_CONFIG.MAX_PLAYERS, '不得裁员');
  assertEquals(getPlayerClub(state, id), null, '失败后仍为 Free Agent');
});

test('M. sign 非法条款 → INVALID_CONTRACT_TERMS', () => {
  const state = leagueState(8);
  const id = getClubPlayers(state, 'clb_001')[0];
  releasePlayerToFreeAgent(state, id);
  throwsCode(() => signFreeAgent(state, id, 'clb_002', { terms: { startSeason: 2, endSeason: 1 } }), 'INVALID_CONTRACT_TERMS');
  throwsCode(() => signFreeAgent(state, id, 'clb_002', { terms: { wage: -1 } }), 'INVALID_CONTRACT_TERMS');
});

test('N. sign 退役球员 → PLAYER_RETIRED', () => {
  const state = leagueState(8);
  const id = getClubPlayers(state, 'clb_001')[0];
  releasePlayerToFreeAgent(state, id);
  state.runtime.retired[id] = { playerId: id, retiredSeason: 1 };
  throwsCode(() => signFreeAgent(state, id, 'clb_002'), 'PLAYER_RETIRED');
});

test('O. sign 非 Free Agent（在队球员）→ PLAYER_NOT_FREE_AGENT', () => {
  const state = leagueState(8);
  const id = getClubPlayers(state, 'clb_001')[0];
  throwsCode(() => signFreeAgent(state, id, 'clb_002'), 'PLAYER_NOT_FREE_AGENT');
});

test('P. sign 目标俱乐部不存在 → CLUB_NOT_FOUND', () => {
  const state = leagueState(8);
  const id = getClubPlayers(state, 'clb_001')[0];
  releasePlayerToFreeAgent(state, id);
  throwsCode(() => signFreeAgent(state, id, 'clb_zzz'), 'CLUB_NOT_FOUND');
});

// ---------- Q/R: save/load + initializeMembership 不重播种 ----------
test('R. initializeMembership 不把 null membership 的 Free Agent 重播种回原俱乐部', () => {
  const state = leagueState(8);
  const id = getClubPlayers(state, 'clb_001')[0];
  releasePlayerToFreeAgent(state, id);
  initializeMembership(state);
  assertEquals(state.runtime.membership.players[id], null, 'null 应保留');
  assertEquals(getPlayerClub(state, id), null);
  assertEquals(validateMembership(state).fatal, []);
});

test('Q. save → load：Free Agent 状态完全一致且不被重播种', async () => {
  const state = leagueState(8);
  const id = getClubPlayers(state, 'clb_001')[0];
  releasePlayerToFreeAgent(state, id);
  const mgr = new MemorySaveManager();
  await mgr.save('s', state);
  const payload = await mgr.load('s');
  const loaded = createGameState(state.static, { date: payload.currentDate, season: payload.season });
  loaded.runtime = JSON.parse(JSON.stringify(payload.runtime));
  initializePlayerRuntime(loaded);

  assertEquals(loaded.runtime.membership.players[id], null, 'load 后仍为 null（未被 seed 回原队）');
  assertEquals(getPlayerClub(loaded, id), null);
  assertEquals(getPlayerContract(loaded, id).status, CONTRACT_STATUS.FREE_AGENT);
  assertEquals(getFreeAgents(loaded).includes(id), true);
  assertEquals(validateMembership(loaded).fatal, []);
  assertContractInvariants(loaded);
  assertFinanceInvariants(loaded);
  assertFreeAgentInvariants(loaded);
});

// ---------- S: Free Agent 退休 ----------
test('S. Free Agent 可正常退休：移除 membership / 终止合同 / 归档保存 free_agent 快照', () => {
  const files = makeLeagueWorldFiles(8);
  const old = files.players.find((p) => p.teamId === 'clb_001' && p.position === 'FW');
  old.birthDate = '1986-06-15';
  const state = createGameState(parseWorld(files));
  const id = old.id;

  releasePlayerToFreeAgent(state, id);
  assertEquals(getFreeAgents(state).includes(id), true);

  new SimulationCore().advanceDays(state, 92); // 完成第 1 季并滚动

  assert(isRetired(state, id), '应退役');
  assertEquals(hasMemberKey(state, id), false, '退役者不留在 membership');
  assertEquals(getPlayerContract(state, id), null, '退役者不持有合同');
  assertEquals(state.runtime.retired[id].contract.status, CONTRACT_STATUS.FREE_AGENT, '归档保存 free_agent 快照');
  assertContractInvariants(state);
  assertFreeAgentInvariants(state);
});

// ---------- T/U: 不进入 team strength / match squad / lineup ----------
test('T/U. Free Agent 不进入 match squad / team strength；repair 清除残留 lineup 引用', () => {
  const state = leagueState(8);
  const id = getClubPlayers(state, 'clb_001')[2]; // 非 GK
  releasePlayerToFreeAgent(state, id);

  const squadIds = resolveMatchSquad(state, 'clb_001', state.runtime.clubs.clb_001.tactics).map((p) => p.id);
  assertEquals(squadIds.includes(id), false, 'Free Agent 不得进入出场集合');
  const strength = computeTeamStrength(state, 'clb_001');
  for (const k of ['attack', 'midfield', 'defence', 'goalkeeping']) {
    assert(Number.isFinite(strength[k]), `${k} 应有限`);
  }

  // 人为注入残留引用 → clean / repair 应清除
  state.runtime.clubs.clb_001.lineup = { starters: [id], bench: [] };
  const cleaned = cleanLineup(state, 'clb_001', state.runtime.clubs.clb_001.lineup);
  assertEquals(cleaned.starters.includes(id), false, 'cleanLineup 应剔除 Free Agent');
  repairManagedLineups(state);
  assertEquals(state.runtime.clubs.clb_001.lineup.starters.includes(id), false, 'repair 应剔除 Free Agent');
  assertFreeAgentInvariants(state);
});

/** 以一致方式把球员转到另一俱乐部（membership + active 合同同步；测试脚手架，非生产 transfer）。 */
function moveToClub(state, playerId, clubId) {
  addPlayerMembership(state, playerId, clubId);
  updateContract(state, playerId, { clubId });
}

// ---------- V/W: Population 优先 Free Agent，不足才 generation ----------
test('V. Population 缺口优先复用现有 Free Agent（不生成新人，world population 不变）', () => {
  const state = leagueState(8);
  // clb_001: 14 → 11（结构仍合法：GK1/DF4/MF4/FW2），转出球员保持合同一致
  for (const pos of ['DF', 'MF', 'FW']) {
    const pid = getClubPlayers(state, 'clb_001').find((p) => getPlayerProfile(state, p)?.position === pos);
    moveToClub(state, pid, 'clb_003');
  }
  assertEquals(getClubPlayers(state, 'clb_001').length, 11);
  // clb_002 释放一名 DF → Free Agent（clb_002 DF 5→4，结构仍合法）
  const faId = getClubPlayers(state, 'clb_002').find((p) => getPlayerProfile(state, p)?.position === 'DF');
  releasePlayerToFreeAgent(state, faId);
  const worldBefore = getWorldPlayers(state).length;

  const generated = replenishPopulation(state, { fromSeason: 1, toSeason: 2 });
  assertEquals(generated.length, 0, '有可用 Free Agent 时不得生成新人');
  assertEquals(getPlayerClub(state, faId), 'clb_001', 'Free Agent 应被签入缺口俱乐部');
  assertEquals(getClubPlayers(state, 'clb_001').length, ROSTER_CONFIG.MIN_PLAYERS);
  assertEquals(getWorldPlayers(state).length, worldBefore, 'world population 不变');
  assertFreeAgentInvariants(state);
  assertContractInvariants(state);
});

test('W. Free Agent 不足时回退 Generation（保持 Step 26B 行为）', () => {
  const state = leagueState(8);
  for (const pos of ['DF', 'MF', 'FW']) {
    const pid = getClubPlayers(state, 'clb_001').find((p) => getPlayerProfile(state, p)?.position === pos);
    moveToClub(state, pid, 'clb_003');
  }
  const generated = replenishPopulation(state, { fromSeason: 1, toSeason: 2 });
  assertEquals(generated.length, 1, '无 Free Agent 时应生成 1 人');
  assertEquals(getClubPlayers(state, 'clb_001').length, ROSTER_CONFIG.MIN_PLAYERS);
  // 生成球员保持「Club + 无合同」（D10 未决，不自动建合同）
  assertEquals(getPlayerContract(state, generated[0]), null);
  assertContractInvariants(state);
});

// ---------- X: 候选排序确定性 ----------
test('X. Free Agent 候选顺序确定性（playerId 升序），同输入同结果', () => {
  const build = () => {
    const s = leagueState(8);
    const a = getClubPlayers(s, 'clb_002').find((p) => getPlayerProfile(s, p)?.position === 'DF');
    const b = getClubPlayers(s, 'clb_003').find((p) => getPlayerProfile(s, p)?.position === 'DF');
    releasePlayerToFreeAgent(s, b); // 先释放较大的 id
    releasePlayerToFreeAgent(s, a);
    return s;
  };
  const s1 = build();
  const s2 = build();
  const list1 = getFreeAgents(s1);
  assertEquals(list1.slice().sort((x, y) => x.localeCompare(y)), list1, '顺序应为 playerId 升序');
  assertEquals(selectFreeAgentForPosition(s1, 'DF'), list1[0], '应选升序首个位置吻合者');
  assertEquals(selectFreeAgentForPosition(s1, 'DF'), selectFreeAgentForPosition(s2, 'DF'));
});

// ---------- Y: 无 RNG / 不改 runtime ----------
test('Y. release / sign 不消耗 RNG、不改 runtime：相同输入 → 相同结果', () => {
  const a = leagueState(8);
  const b = leagueState(8);
  const id = getClubPlayers(a, 'clb_001')[0];
  const rosterA = JSON.stringify(a.runtime.players);
  const rosterB = JSON.stringify(b.runtime.players);

  releasePlayerToFreeAgent(a, id);
  releasePlayerToFreeAgent(b, id);
  assertEquals(JSON.stringify(a.runtime.contracts[id]), JSON.stringify(b.runtime.contracts[id]));
  signFreeAgent(a, id, 'clb_002');
  signFreeAgent(b, id, 'clb_002');
  assertEquals(JSON.stringify(a.runtime.contracts), JSON.stringify(b.runtime.contracts));
  assertEquals(JSON.stringify(a.runtime.membership), JSON.stringify(b.runtime.membership));
  assertEquals(JSON.stringify(a.runtime.players), rosterA, 'release 不得改 runtime');
  assertEquals(JSON.stringify(b.runtime.players), rosterB);
});

// ---------- Z: 失败不半提交（原子性） ----------
test('Z. 失败的 release / sign 不得产生任何半提交', () => {
  // release 失败（不存在球员）
  const s1 = leagueState(8);
  const before1 = coreSnapshot(s1);
  throwsCode(() => releasePlayerToFreeAgent(s1, 'ply_nope'), 'PLAYER_NOT_FOUND');
  assertEquals(coreSnapshot(s1), before1, 'release 失败不得改状态');

  // sign 失败（非法条款）
  const s2 = leagueState(8);
  const id = getClubPlayers(s2, 'clb_001')[0];
  releasePlayerToFreeAgent(s2, id);
  const before2 = coreSnapshot(s2);
  throwsCode(() => signFreeAgent(s2, id, 'clb_002', { terms: { wage: -5 } }), 'INVALID_CONTRACT_TERMS');
  assertEquals(coreSnapshot(s2), before2, 'sign 失败不得改状态');

  // sign 失败（roster 满）
  const s3 = leagueState(8);
  for (let i = 0; i < 10; i += 1) generatePlayer(s3, { position: 'MF', teamId: 'clb_002', season: 1, fromSeason: 0 });
  const id3 = getClubPlayers(s3, 'clb_001')[0];
  releasePlayerToFreeAgent(s3, id3);
  const before3 = coreSnapshot(s3);
  throwsCode(() => signFreeAgent(s3, id3, 'clb_002'), 'ROSTER_MAX_REACHED');
  assertEquals(coreSnapshot(s3), before3, 'sign 失败不得改状态');
});

// ---------- 不变量：assertFreeAgentInvariants 检出 lineup 泄漏 ----------
test('INV. assertFreeAgentInvariants 检出 free agent 泄漏进 lineup', () => {
  const state = leagueState(8);
  const id = getClubPlayers(state, 'clb_001')[0];
  releasePlayerToFreeAgent(state, id);
  assertFreeAgentInvariants(state); // 正常通过
  state.runtime.clubs.clb_002.lineup = { starters: [id], bench: [] }; // 人为泄漏
  throwsCode(() => assertFreeAgentInvariants(state), 'FREE_AGENT_INVARIANT');
});

// ---------- Controller 转发（最小 API） ----------
class StubLoader {
  async loadWorld() { return parseWorld(makeLeagueWorldFiles(8)); }
}
test('Controller：releasePlayer / signFreeAgent 转发 domain op，快照含 freeAgentsCount', async () => {
  const controller = new GameController({
    dataLoader: new StubLoader(),
    saveManager: new MemorySaveManager(),
    simulation: new SimulationCore(),
  });
  await controller.startNewGame('w');
  const state = controller.getState();
  const id = getClubPlayers(state, 'clb_001')[0];

  const rel = controller.releasePlayer(id);
  assertEquals(rel.success, true);
  assertEquals(controller.getSnapshot().freeAgentsCount, 1);

  const sig = controller.signFreeAgent(id, 'clb_002');
  assertEquals(sig.success, true);
  assertEquals(controller.getSnapshot().freeAgentsCount, 0);

  // 失败返回 {success:false, code}（不抛）
  const bad = controller.releasePlayer('ply_nope');
  assertEquals(bad.success, false);
  assertEquals(bad.code, 'PLAYER_NOT_FOUND');
});