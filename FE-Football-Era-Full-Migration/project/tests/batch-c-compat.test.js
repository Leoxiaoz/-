/**
 * Batch C 回归测试：旧存档 / 缺失可选展示字段的兼容性。
 *
 * 目标（对应 Batch C 需求 D）：
 * - 旧档的已结算赛程缺少 `matchSeed` / `events` 时，比赛中心仍可用且安全降级；
 * - 缺失进球事件的 `actorId` / `assistId` 时，报告不伪造球员；
 * - 读取这种「降级后的运行时」后继续推进，不重复结算、不改写旧赛果；
 * - 赛季边界前后存档恢复一致，赛季副作用不重复计入。
 *
 * 使用受控测试夹具（推进后主动剥离可选字段模拟旧档），**不触碰任何真实用户存档**。
 */

import { test, assert, assertEquals } from './harness.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { GameController } from '../src/controller/game-controller.js';
import { deriveMatchSeed } from '../src/core/rng.js';
import { MemorySaveManager } from '../src/save/save-manager.js';
import { makeLeagueWorldFiles } from './fixtures.js';

const N = 8;

class StubLoader {
  async loadWorld() { return parseWorld(makeLeagueWorldFiles(N)); }
}
function makeController() {
  return new GameController({
    dataLoader: new StubLoader(),
    saveManager: new MemorySaveManager(),
    simulation: new SimulationCore(),
  });
}
function comps(state) { return Object.values(state.runtime.competitions); }
function allFixtures(state) {
  const out = [];
  for (const c of comps(state)) for (const f of c.fixtures) out.push({ comp: c, f });
  return out;
}
function playedCount(state) { return allFixtures(state).filter((x) => x.f.played).length; }
function tableSignature(state) {
  return comps(state).map((c) => Object.values(c.table)
    .map((r) => `${r.teamId}:${r.played}:${r.points}`).sort().join(',')).join('|');
}
async function playedSetup() {
  const c = makeController();
  await c.startNewGame('w');
  c.setManagedClub(c.getSnapshot().clubs[0].id);
  c.advanceToNextRound();
  return c;
}

// ---------------------------------------------------------------------------
// 1. 旧档：已结算赛程缺 matchSeed / events → 比赛中心安全降级
// ---------------------------------------------------------------------------
test('C1. 旧档缺 matchSeed/events：getMatchShow 安全降级，比分为结算权威', async () => {
  const c = await playedSetup();
  // 模拟 Batch B 之前的旧档：剥离所有已结算赛程的可选演出字段。
  const played = allFixtures(c.getState()).filter((x) => x.f.played);
  assert(played.length > 0, '应有已结算比赛');
  for (const { f } of played) { delete f.matchSeed; delete f.events; }

  const target = played[0].f;
  const show = c.getMatchShow(target.id);
  assert(show, '缺失可选字段时仍应构建演出模型');
  assertEquals(show.played, true);
  assertEquals(show.score, { home: target.homeGoals, away: target.awayGoals }, '比分仍为结算权威');
  assertEquals(show.hasEvents, false, '缺事件应标记 hasEvents=false');
  assertEquals(show.timeline.filter((e) => e.kind === 'goal').length, 0, '缺事件不应虚构进球');
  // 兜底种子必须与引擎的 deriveMatchSeed 一致（确定性、可复现）
  const expectedSeed = deriveMatchSeed({
    worldId: c.getState().worldId,
    season: played[0].comp.season,
    round: target.round,
    homeId: target.homeId,
    awayId: target.awayId,
  });
  assertEquals(show.seed, expectedSeed, '缺 matchSeed 时应以 fixture 身份确定性派生种子');
});

// ---------------------------------------------------------------------------
// 2. 缺 actorId / assistId：报告不伪造球员
// ---------------------------------------------------------------------------
test('C2. 进球事件缺 actorId/assistId：报告降级为未知，不伪造', async () => {
  const c = await playedSetup();
  const target = allFixtures(c.getState()).find((x) => x.f.played).f;
  // 受控夹具：注入一条缺少 actorId/assistId 的真实进球事件（比分与事件数保持一致）。
  target.events = [{ minute: 33, teamId: target.homeId, type: 'goal', actorId: null, assistId: null }];
  target.homeGoals = 1; target.awayGoals = 0;

  const show = c.getMatchShow(target.id);
  const goals = show.timeline.filter((e) => e.kind === 'goal');
  assertEquals(goals.length, 1);
  assertEquals(goals[0].scorerName, null, '缺 actorId 应为 null（不硬造球员）');
  assertEquals(goals[0].assistName, null, '缺 assistId 应为 null');
  assertEquals(show.score, { home: 1, away: 0 });
});

// ---------------------------------------------------------------------------
// 3. 旧档读入后继续推进：不重复结算，旧赛果不变
// ---------------------------------------------------------------------------
test('C3. 旧档（缺可选字段）读取后继续推进：不重复结算、旧赛果不变', async () => {
  const c = await playedSetup();
  const played = allFixtures(c.getState()).filter((x) => x.f.played);
  for (const { f } of played) { delete f.matchSeed; delete f.events; }

  await c.save('legacy');
  await c.load('legacy');

  const beforeCount = playedCount(c.getState());
  // 仅记录「读取时已结算」场次的比分；推进后这些场次必须保持原值。
  const beforePlayed = new Map(
    allFixtures(c.getState()).filter((x) => x.f.played).map((x) => [x.f.id, `${x.f.homeGoals}-${x.f.awayGoals}`]),
  );
  const beforeTable = tableSignature(c.getState());

  // 读档后仍可查看旧比赛（安全降级）
  const show = c.getMatchShow(played[0].f.id);
  assert(show && show.played, '读档后旧比赛仍可打开');

  c.advanceToNextRound();
  assert(playedCount(c.getState()) > beforeCount, '应能继续推进并结算新比赛');
  for (const { f } of allFixtures(c.getState())) {
    if (!beforePlayed.has(f.id)) continue;
    assertEquals(`${f.homeGoals}-${f.awayGoals}`, beforePlayed.get(f.id), `旧场次 ${f.id} 赛果不得被改写`);
  }
  assert(tableSignature(c.getState()) !== beforeTable, '积分榜应因新比赛而更新（非重复计入旧场次）');
});

// ---------------------------------------------------------------------------
// 4. 赛季边界：存档恢复一致，赛季副作用不重复计入
// ---------------------------------------------------------------------------
test('C4. 赛季边界前后存档恢复：赛季仅滚动一次，上季归档不重复也不丢失', async () => {
  const c = await makeController();
  await c.startNewGame('w');
  c.setManagedClub(c.getSnapshot().clubs[0].id);
  const startSeason = c.getState().season;

  // 推进到赛季边界之前（完成倒数第二轮，留最后一轮作为边界触发）
  let guard = 0;
  while (c.getSnapshot().leagues[0].fixtures.filter((f) => !f.played).length > N / 2 && guard < 40) {
    c.advanceToNextRound();
    guard += 1;
  }
  assertEquals(c.getState().season, startSeason, '此时应仍在同一赛季');

  await c.save('mid');
  await c.load('mid');
  const seasonAtLoad = c.getState().season;

  // 越过边界
  guard = 0;
  while (c.getState().season === seasonAtLoad && guard < 40) {
    c.advanceToNextRound();
    guard += 1;
  }
  assertEquals(c.getState().season, startSeason + 1, '应恰好滚动一个赛季');

  const snap = c.getSnapshot();
  const league = snap.leagues[0];
  assertEquals(league.competitionSeason, startSeason + 1, '应进入下一赛季');
  assertEquals(league.lastSeason.table.length, N, '上季归档应完整');
  assert(league.lastSeason.table.every((r) => r.played === 2 * (N - 1)), '上季每队应打满双循环（不重复计数）');
  assert(league.fixtures.every((f) => f.played === false), '新赛季赛程应全部未结算');

  // 边界后再存档/读档：赛季号与归档保持不变（幂等）
  await c.save('after');
  await c.load('after');
  const after = c.getSnapshot();
  assertEquals(after.season, startSeason + 1, '边界后存档恢复赛季号一致');
  assertEquals(after.leagues[0].lastSeason.table.length, N, '归档表不丢失');
  assertEquals(playedCount(c.getState()), 0, '新赛季不应残留已结算标记');
});