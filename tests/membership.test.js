/**
 * 运行期成员关系层测试（G0，DECISIONS D-19 / SIMULATION_SPEC §25）。
 * 覆盖：初始化、访问器等价与顺序契约、唯一真相源、club→league、generated 同事件一致、
 * 退役出队、确定性、v6→v7 迁移、save/load 往返、校验器（致命/诊断）、
 * managedClub/lineup 不受影响、10/50/100/200 赛季长期稳定。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { GameController } from '../src/controller/game-controller.js';
import {
  initializeMembership,
  getPlayerClub,
  getClubPlayers,
  getClubLeague,
  getLeagueClubs,
  addPlayerMembership,
  removePlayerMembership,
  validateMembership,
  assertMembershipValid,
  MEMBERSHIP_SCHEMA_VERSION,
} from '../src/core/membership.js';
import {
  getWorldPlayers,
  getTeamPlayers,
  getPlayerProfile,
  initializePlayerRuntime,
} from '../src/core/player-runtime.js';
import { generatePlayer } from '../src/core/player-lifecycle.js';
import { computeTeamStrength, buildAutoLineup } from '../src/core/team-strength.js';
import { serializeState, deserializeState, MemorySaveManager } from '../src/save/save-manager.js';
import { makeLeagueWorldFiles } from './fixtures.js';

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
/** 成员的规范化快照（键排序，便于比较忽略插入顺序）。 */
function snapshot(m) {
  const players = Object.entries(m.players).sort(([a], [b]) => a.localeCompare(b));
  const clubs = Object.entries(m.clubs).sort(([a], [b]) => a.localeCompare(b));
  return { schema: m.schema, players, clubs };
}
function activeIds(state) {
  return getWorldPlayers(state).map((p) => p.id).sort();
}
class StubLoader {
  async loadWorld() {
    return parseWorld(makeLeagueWorldFiles(8));
  }
}

// ---------- 1. 初始化 ----------
test('createGameState 建立 membership：覆盖全部 active 球员与俱乐部', () => {
  const state = leagueState(8);
  assertEquals(state.runtime.membership.schema, MEMBERSHIP_SCHEMA_VERSION);
  const v = validateMembership(state);
  assertEquals(v.fatal, [], `不应有致命问题：${v.fatal}`);
  // 每个 active 球员恰好 1 个有效 club
  const clubIds = new Set(Object.keys(state.runtime.clubs));
  for (const id of activeIds(state)) {
    const clubId = getPlayerClub(state, id);
    assert(clubIds.has(clubId), `${id} 应归属有效 club（实际 ${clubId}）`);
  }
  // 每个 runtime club 有合法 league
  for (const clubId of clubIds) {
    assert(getClubLeague(state, clubId), `${clubId} 应有 league`);
  }
  // 与静态种子一致
  for (const p of state.static.players) {
    assertEquals(getPlayerClub(state, p.id), p.teamId, `${p.id} 初始归属应等于静态种子`);
  }
});

// ---------- 2. 访问器等价 + 顺序契约 ----------
test('getTeamPlayers 与 getWorldPlayers 过滤结果一致（含顺序，含新生代）', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 130); // 触发退役+新生代
  for (const clubId of Object.keys(state.runtime.clubs)) {
    const expected = getWorldPlayers(state).filter((p) => p.teamId === clubId).map((p) => p.id);
    assertEquals(getClubPlayers(state, clubId), expected, `${clubId} getClubPlayers 顺序应与过滤一致`);
    assertEquals(getTeamPlayers(state, clubId).map((p) => p.id), expected, `${clubId} getTeamPlayers 顺序应与过滤一致`);
  }
});

// ---------- 3 + 4. 唯一真相源 ----------
test('篡改静态 teamId 不影响运行期归属（证明不再直读静态）', () => {
  const state = leagueState(4);
  const victim = state.static.players.find((p) => p.teamId === 'clb_001').id;
  state.static.players.find((p) => p.id === victim).teamId = 'clb_002'; // 测试性篡改
  assertEquals(getPlayerClub(state, victim), 'clb_001', '运行期归属不应随静态字段改变');
  assert(getTeamPlayers(state, 'clb_001').some((p) => p.id === victim), '仍应在原 club');
  assert(!getTeamPlayers(state, 'clb_002').some((p) => p.id === victim), '不应出现在新 club');
});

test('篡改 generated.teamId 不影响运行期归属（membership 为权威）', () => {
  const state = leagueState(4);
  const gid = generatePlayer(state, { position: 'FW', teamId: 'clb_001', season: 1, fromSeason: 1 });
  assertEquals(getPlayerClub(state, gid), 'clb_001');
  state.runtime.generated[gid].teamId = 'clb_003'; // 篡改兼容镜像
  assertEquals(getPlayerClub(state, gid), 'clb_001', '归属应只认 membership');
  assert(getTeamPlayers(state, 'clb_001').some((p) => p.id === gid));
  assert(!getTeamPlayers(state, 'clb_003').some((p) => p.id === gid));
});

// ---------- 5. generated 与 membership 同事件一致 ----------
test('generatePlayer：generated 档案与 membership 在同一次生命周期事件内一致', () => {
  const state = leagueState(4);
  const gid = generatePlayer(state, { position: 'GK', teamId: 'clb_002', season: 1, fromSeason: 1 });
  assertEquals(state.runtime.generated[gid].teamId, 'clb_002', '兼容镜像应写入');
  assertEquals(getPlayerClub(state, gid), 'clb_002', 'membership 应写入且一致');
  assertEquals(validateMembership(state).fatal, []);
});

// ---------- 6. 退役出队 ----------
test('退役球员移出 active membership，且不复活（读档后亦然）', () => {
  const state = leagueState(8);
  const victim = Object.keys(state.runtime.clubs).length && state.static.players.find((p) => p.teamId === 'clb_001').id;
  assert(getPlayerClub(state, victim) != null);
  state.runtime.retired[victim] = { playerId: victim, retiredSeason: 1 };
  initializeMembership(state); // 幂等补齐 + 清理退役
  assertEquals(getPlayerClub(state, victim), null, '退役者应移出 membership');
  assert(!getWorldPlayers(state).some((p) => p.id === victim));
  assertEquals(validateMembership(state).fatal, []);
});

// ---------- 7. club → league ----------
test('club→league 经 membership；getTeamsByLeague 行为兼容', () => {
  const state = leagueState(4);
  assertEquals(getClubLeague(state, 'clb_001'), 'lg_a');
  assertEquals(getLeagueClubs(state, 'lg_a'), ['clb_001', 'clb_002', 'clb_003', 'clb_004']);
  assertEquals(getLeagueClubs(state, 'lg_missing'), []);
  // 篡改静态 leagueId 不影响运行期联赛归属
  state.static.teams.find((t) => t.id === 'clb_001').leagueId = 'lg_other';
  assertEquals(getClubLeague(state, 'clb_001'), 'lg_a', '运行期联赛归属不应随静态字段改变');
});

// ---------- 8. 确定性 ----------
test('membership 初始化确定性：同世界两次结果完全一致；推进结果一致', () => {
  const a = leagueState(8);
  const b = leagueState(8);
  assertEquals(snapshot(a.runtime.membership), snapshot(b.runtime.membership));
  new SimulationCore().advanceDays(a, 92);
  new SimulationCore().advanceDays(b, 92);
  assertEquals(snapshot(a.runtime.membership), snapshot(b.runtime.membership));
  assertEquals(JSON.stringify(a.runtime.players), JSON.stringify(b.runtime.players));
});

// ---------- 9. v6 → v7 迁移 ----------
test('v6 旧档（无 membership）读档后自动建立且与原始一致', () => {
  const state = leagueState(8);
  // v6 迁移语义：从静态种子重建 membership。AI Club Decision（Step 31）会合法改写 membership，此处隔离。
  new SimulationCore({ enableAI: false }).advanceDays(state, 130); // 含退役/新生代
  const payload = JSON.parse(JSON.stringify(serializeState(state)));
  delete payload.runtime.membership; // 模拟 v6

  const p2 = deserializeState(payload);
  assertEquals(p2.runtime.membership.players, {}, 'deserialize 应先给空容器');
  const loaded = createGameState(state.static, { date: p2.currentDate, season: p2.season });
  loaded.runtime = p2.runtime;
  initializePlayerRuntime(loaded); // 内部 initializeMembership 建立

  assertEquals(validateMembership(loaded).fatal, []);
  assertEquals(snapshot(loaded.runtime.membership), snapshot(state.runtime.membership));
  // 旧档字段完整保留
  assertEquals(loaded.runtime.nextGeneratedSeq, state.runtime.nextGeneratedSeq);
  assertEquals(JSON.stringify(loaded.runtime.retired), JSON.stringify(state.runtime.retired));
});

// ---------- 10. v7 save/load 往返 ----------
test('v7 save/load：membership / managedClubId / lineup / tactics 全部稳定', async () => {
  const controller = new GameController({
    dataLoader: new StubLoader(),
    saveManager: new MemorySaveManager(),
    simulation: new SimulationCore(),
  });
  await controller.startNewGame('w');
  controller.setManagedClub('clb_001');
  controller.autoFillManagedLineup();
  new SimulationCore().advanceDays(controller.getState(), 40);

  const before = snapshot(controller.getState().runtime.membership);
  const lineupBefore = JSON.parse(JSON.stringify(controller.getState().runtime.clubs.clb_001.lineup));
  await controller.save('slot');
  await controller.load('slot'); // load 内含 assertMembershipValid

  assertEquals(snapshot(controller.getState().runtime.membership), before);
  assertEquals(controller.getManagedClubId(), 'clb_001');
  assertEquals(controller.getState().runtime.clubs.clb_001.lineup, lineupBefore);
  assertEquals(controller.getState().runtime.clubs.clb_001.tactics.formation, '4-4-2');
});

// ---------- 11. 校验器 ----------
test('validateMembership：致命问题不被静默（缺归属 / 无效 league / 退役残留）', () => {
  const state = leagueState(4);
  // 缺少 active 归属
  const id = state.static.players[0].id;
  delete state.runtime.membership.players[id];
  let v = validateMembership(state);
  assert(v.fatal.some((s) => s.includes(id)), '应报出缺归属');
  assertThrows(() => assertMembershipValid(state), 'SimulationError');

  // 无效 league
  const state2 = leagueState(4);
  state2.runtime.membership.clubs['clb_001'] = 'lg_nope';
  v = validateMembership(state2);
  assert(v.fatal.some((s) => s.includes('clb_001')), '应报出无效 league');

  // 退役残留
  const state3 = leagueState(4);
  const retired = state3.static.players[1].id;
  state3.runtime.retired[retired] = { playerId: retired, retiredSeason: 1 };
  v = validateMembership(state3);
  assert(v.fatal.some((s) => s.includes(retired)), '应报出退役残留');
});

test('validateMembership：可诊断问题记为 warnings（未知 player）', () => {
  const state = leagueState(4);
  state.runtime.membership.players['ply_ghost'] = 'clb_001';
  const v = validateMembership(state);
  assertEquals(v.fatal, []);
  assert(v.warnings.some((s) => s.includes('ply_ghost')), '未知 player 应记为 warning');
});

test('addPlayerMembership 拒绝非法参数', () => {
  const state = leagueState(4);
  assertThrows(() => addPlayerMembership(state, '', 'clb_001'), 'SimulationError');
  assertThrows(() => addPlayerMembership(state, 'ply_x', ''), 'SimulationError');
});

test('removePlayerMembership 幂等', () => {
  const state = leagueState(4);
  const id = state.static.players[0].id;
  removePlayerMembership(state, id);
  removePlayerMembership(state, id); // 再次调用不抛错
  assertEquals(getPlayerClub(state, id), null);
});

// ---------- 12. 默认路径不变（Step 20 兼容） ----------
test('managedClubId=null 时自动选阵路径不变（Step 16–20 行为等价）', () => {
  const state = leagueState(8);
  assertEquals(state.runtime.managedClubId, null);
  const before = getTeamPlayers(state, 'clb_001').map((p) => p.id);
  // 重建一个等价状态，membership 应给出同一 roster
  const fresh = leagueState(8);
  assertEquals(getTeamPlayers(fresh, 'clb_001').map((p) => p.id), before);
});

// ---------- 长期稳定（10 / 50 / 100 / 200 赛季） ----------
function assertMembershipHealthy(state, label) {
  const v = validateMembership(state);
  assertEquals(v.fatal, [], `${label} 致命问题：${v.fatal}`);

  const actives = activeIds(state);
  // 无重复 playerId
  assertEquals(new Set(actives).size, actives.length, `${label} active 重复 id`);
  // orphan / ghost：membership 键集合 == active 集合
  assertEquals(Object.keys(state.runtime.membership.players).sort(), actives, `${label} orphan/ghost`);
  // 每 active 恰好 1 club 且有效
  const clubIds = new Set(Object.keys(state.runtime.clubs));
  for (const id of actives) assert(clubIds.has(getPlayerClub(state, id)), `${label} ${id} 归属非法`);
  // 退役不在 membership
  for (const id of Object.keys(state.runtime.retired)) {
    assertEquals(getPlayerClub(state, id), null, `${label} 退役者 ${id} 仍在 membership`);
  }
  // 每 club 合法 league
  for (const clubId of clubIds) assert(getClubLeague(state, clubId), `${label} ${clubId} 无有效 league`);
  // 实力有限
  for (const clubId of clubIds) {
    const s = computeTeamStrength(state, clubId);
    for (const k of ['attack', 'midfield', 'defence', 'goalkeeping']) {
      assert(Number.isFinite(s[k]) && s[k] >= 1, `${label} ${clubId}.${k} 非法 ${s[k]}`);
    }
  }
  // Step 20 managed lineup 正常
  const managed = state.runtime.managedClubId;
  if (managed) {
    const lineup = state.runtime.clubs[managed].lineup;
    for (const id of [...lineup.starters, ...lineup.bench]) {
      assert(getPlayerProfile(state, id) && getPlayerClub(state, id) === managed, `${label} lineup 引用无效 ${id}`);
    }
    assert(buildAutoLineup(state, managed, state.runtime.clubs[managed].tactics).starters.length > 0);
  }
}

for (const seasons of [10, 50, 100, 200]) {
  test(`${seasons} 赛季长期：成员关系纯净、无 orphan/ghost、无 NaN、Step19/20 正常`, () => {
    const state = leagueState(8);
    state.runtime.managedClubId = 'clb_001';
    state.runtime.clubs.clb_001.lineup = buildAutoLineup(state, 'clb_001', { formation: '4-4-2' });
    // 本测试度量成员关系纯净度（不产生 Free Agent）；AI Club Decision（Step 31）会引入 Free Agent，此处隔离。
    new SimulationCore({ enableAI: false }).advanceDays(state, seasons * 125);
    assertMembershipHealthy(state, `${seasons}季`);
  });
}