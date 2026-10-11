/**
 * Step 21-B 球员表现消费层测试。
 * 覆盖：controller 只读球员统计快照、season/career aggregate、averageRating 派生与 appearances=0 处理、
 * ratingSum 不外泄、射门守恒、旧字段安全 normalize、快照与 runtime 无引用共享、
 * 非管理球队不被展示、lineup/injury 不受影响。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { GameController } from '../src/controller/game-controller.js';
import { MemorySaveManager } from '../src/save/save-manager.js';
import {
  getPlayerStatsView, deriveAverageRating, recordAppearance, getPlayerRuntime, getTeamPlayers,
} from '../src/core/player-runtime.js';
import { makeLeagueWorldFiles } from './fixtures.js';

class StubLoader {
  async loadWorld() {
    return parseWorld(makeLeagueWorldFiles(8));
  }
}
function leagueState() {
  return createGameState(parseWorld(makeLeagueWorldFiles(8)));
}
async function newController() {
  const controller = new GameController({
    dataLoader: new StubLoader(),
    saveManager: new MemorySaveManager(),
    simulation: new SimulationCore(),
  });
  await controller.startNewGame('w');
  return controller;
}
/** 推进 1 天（第 1 轮：8 队全部出场）并选择管理球队，返回快照。 */
async function playedSnapshot(clubId = 'clb_001') {
  const controller = await newController();
  controller.advanceDays(1);
  controller.setManagedClub(clubId);
  return { controller, snapshot: controller.getSnapshot() };
}

// ---------- 1. 有正常出场的球员能获得 season stats ----------
test('消费层：有出场的球员在快照中获得 season stats', async () => {
  const { snapshot } = await playedSnapshot();
  const played = snapshot.managedClub.squad.find((p) => p.stats.season.appearances > 0);
  assert(played, '应存在本赛季出场球员');
  assertEquals(played.stats.season.appearances, 1);
  assertEquals(played.stats.season.minutes, 90);
  assert(Number.isFinite(played.stats.season.averageRating), 'averageRating 应为有限数');
});

// ---------- 2. career stats 正确读取 ----------
test('消费层：career stats 正确读取', async () => {
  const { snapshot } = await playedSnapshot();
  const played = snapshot.managedClub.squad.find((p) => p.stats.season.appearances > 0);
  assertEquals(played.stats.career.appearances, played.stats.season.appearances);
  assertEquals(played.stats.career.minutes, played.stats.season.minutes);
  assertEquals(played.stats.career.goals, played.stats.season.goals);
});

// ---------- 3. averageRating 正确计算 ----------
test('消费层：averageRating = ratingSum / appearances / 10（两位小数）', () => {
  const state = leagueState();
  recordAppearance(state, 'ply_001', { minutes: 90, rating: 7.5 });
  recordAppearance(state, 'ply_001', { minutes: 90, rating: 6.3 });
  const v = getPlayerStatsView(state, 'ply_001');
  // ratingSum = 75 + 63 = 138；138 / 2 / 10 = 6.9
  assertEquals(v.season.appearances, 2);
  assertEquals(v.season.averageRating, 6.9);
  // 两位小数能力
  assertEquals(deriveAverageRating(1484, 20), 7.42);
});

// ---------- 4. appearances = 0 时 averageRating === null ----------
test('消费层：appearances = 0 时 averageRating 为 null（不产生 NaN）', () => {
  const state = leagueState();
  const v = getPlayerStatsView(state, 'ply_001');
  assertEquals(v.season.appearances, 0);
  assertEquals(v.season.averageRating, null);
  assertEquals(v.career.averageRating, null);
  assertEquals(deriveAverageRating(0, 0), null);
  assert(!Number.isNaN(v.season.averageRating), 'must not be NaN');
});

// ---------- 5. ratingSum 不直接暴露 ----------
test('消费层：快照/视图不暴露 ratingSum（只暴露派生 averageRating）', async () => {
  const { snapshot } = await playedSnapshot();
  for (const p of snapshot.managedClub.squad) {
    assert(!('ratingSum' in p.stats.season), 'season 不应暴露 ratingSum');
    assert(!('ratingSum' in p.stats.career), 'career 不应暴露 ratingSum');
    assert('averageRating' in p.stats.season, '应暴露 averageRating');
  }
  const state = leagueState();
  recordAppearance(state, 'ply_001', { minutes: 90, rating: 6.0 });
  const v = getPlayerStatsView(state, 'ply_001');
  assert(!('ratingSum' in v.season));
  assertEquals(v.season.averageRating, 6);
});

// ---------- 6. shots >= shotsOnTarget ----------
test('消费层：shots >= shotsOnTarget（season 与 career 均是）', async () => {
  const { snapshot } = await playedSnapshot();
  for (const p of snapshot.managedClub.squad) {
    assert(p.stats.season.shots >= p.stats.season.shotsOnTarget, 'season shots >= shotsOnTarget');
    assert(p.stats.career.shots >= p.stats.career.shotsOnTarget, 'career shots >= shotsOnTarget');
  }
});

// ---------- 7. 旧 stats 缺字段可安全 normalize ----------
test('消费层：旧 stats 缺 21-A 字段时安全补 0，且不产生 NaN', () => {
  const state = leagueState();
  const rt = getPlayerRuntime(state, 'ply_001');
  for (const scope of ['season', 'career']) {
    delete rt.stats[scope].shots;
    delete rt.stats[scope].shotsOnTarget;
    delete rt.stats[scope].ratingSum;
    delete rt.stats[scope].yellow;
    delete rt.stats[scope].red;
  }
  const v = getPlayerStatsView(state, 'ply_001');
  assertEquals(v.season.shots, 0);
  assertEquals(v.season.shotsOnTarget, 0);
  assertEquals(v.season.yellow, 0);
  assertEquals(v.season.red, 0);
  assertEquals(v.season.averageRating, null);
  for (const k of Object.keys(v.season)) assert(!Number.isNaN(v.season[k]), `season.${k} 不应为 NaN`);
});

// ---------- 8. 快照不直接暴露 runtime 引用 ----------
test('消费层：快照 stats 与 runtime 无引用共享，改写快照不影响运行时', async () => {
  const { controller, snapshot } = await playedSnapshot();
  const p = snapshot.managedClub.squad[0];
  const rtLine = controller.getState().runtime.players[p.playerId].stats.season;
  assert(p.stats.season !== rtLine, 'stats 视图必须是独立对象');
  p.stats.season.goals = 999;
  assertEquals(rtLine.goals !== 999, true, '改写快照不得影响 runtime');
});

// ---------- 9. 非管理球队不被展示 ----------
test('消费层：未选择管理球队时无 managedClub；选择后名单只含该队球员', async () => {
  const controller = await newController();
  assertEquals(controller.getSnapshot().managedClub, null, '未选择时不应有 managedClub');
  controller.advanceDays(1);
  controller.setManagedClub('clb_001');
  const snap = controller.getSnapshot();
  const ids = snap.managedClub.squad.map((p) => p.playerId).sort();
  const expected = getTeamPlayers(controller.getState(), 'clb_001').map((p) => p.id).sort();
  assertEquals(ids, expected, '名单应恰好是该队球员');
});

// ---------- 10. lineup / injury / 人口不受影响 ----------
test('消费层：lineup / injury 展示与人口不受 Step 21-B 影响', async () => {
  const controller = await newController();
  controller.setManagedClub('clb_001');
  controller.autoFillManagedLineup();
  controller.advanceDays(1);
  const snap = controller.getSnapshot();
  assertEquals(snap.managedClub.starters.length, 11, '首发仍为 11 人');
  assertEquals(snap.playersCount, 112, '人口不变');
  for (const p of snap.managedClub.squad) {
    assertEquals(typeof p.injured, 'boolean', 'injury 标记仍存在');
  }
  // 阵容引用仍合法（均为本队球员）
  const roster = new Set(getTeamPlayers(controller.getState(), 'clb_001').map((p) => p.id));
  for (const p of snap.managedClub.starters) assert(roster.has(p.playerId), '首发应为本队球员');
});