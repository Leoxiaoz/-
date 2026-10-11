/**
 * Batch A 测试：生涯开场与球队选择、赛程推进、完整赛季闭环、存档恢复。
 *
 * 覆盖验收标准 A–J 中可通过自动化验证的部分（Controller + Simulation Core 层）。
 * 不依赖浏览器 / DOM：直接驱动 GameController 与 SimulationCore（UI 只转发到这两者）。
 */

import { test, assert, assertEquals } from './harness.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { GameController } from '../src/controller/game-controller.js';
import { generateDoubleRoundRobin } from '../src/core/schedule.js';
import { SCHEDULE_CONFIG } from '../src/core/sim-config.js';
import { MemorySaveManager } from '../src/save/save-manager.js';
import { makeLeagueWorldFiles } from './fixtures.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const N = 8;
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src');

class StubLoader {
  async loadWorld() {
    return parseWorld(makeLeagueWorldFiles(N));
  }
}
function makeController() {
  return new GameController({
    dataLoader: new StubLoader(),
    saveManager: new MemorySaveManager(),
    simulation: new SimulationCore(),
  });
}
function leagueOf(state) {
  return Object.values(state.runtime.competitions)[0];
}
function playedCount(state) {
  let n = 0;
  for (const comp of Object.values(state.runtime.competitions)) {
    for (const f of comp.fixtures) if (f.played) n += 1;
  }
  return n;
}
/** 积分榜 played 之和应恒等于「已结算场次 × 2」（每场为双方各记一场）。 */
function tablePlayedSum(state) {
  let n = 0;
  for (const comp of Object.values(state.runtime.competitions)) {
    for (const row of Object.values(comp.table)) n += row.played;
  }
  return n;
}
function scoreKey(f) {
  return f.played ? `${f.homeGoals}-${f.awayGoals}` : '-';
}

// ---------- A. 新建生涯：球队列表来自数据库 + 初始化 ----------
test('A. 新建生涯：球队来自数据库，赛季/日期/赛程/积分榜已初始化', async () => {
  const controller = makeController();
  await controller.startNewGame('w');
  const snap = controller.getSnapshot();

  const worldTeamIds = parseWorld(makeLeagueWorldFiles(N)).teams.map((t) => t.id).sort();
  assertEquals(snap.clubs.map((c) => c.id).sort(), worldTeamIds, '球队列表应来自数据库');
  assertEquals(snap.managedClubId, null, '新建生涯默认未选择管理球队');
  assertEquals(snap.season, 1);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(snap.currentDate), '应有有效初始日期');

  const league = snap.leagues[0];
  assertEquals(league.totalRounds, 2 * (N - 1), '应为双循环轮次');
  assertEquals(league.table.length, N, '积分榜应覆盖全部球队');
  assertEquals(league.fixtures.length, 2 * (N - 1) * (N / 2), '赛程总场次应完整');
  assert(league.table.every((r) => r.played === 0), '新建生涯积分榜应清零');
  assert(league.fixtures.every((f) => f.played === false), '新建生涯赛程应全部未结算');
});

// ---------- B. 选择管理球队：主界面显示 + 阵容/阵型/战术可用 ----------
test('B. 选择管理球队：主界面显示正确球队，阵容/阵型/战术可用', async () => {
  const controller = makeController();
  await controller.startNewGame('w');
  const clubId = controller.getSnapshot().clubs[0].id;

  assert(controller.setManagedClub(clubId).success, '应能选择管理球队');
  const snap = controller.getSnapshot();
  assertEquals(snap.managedClubId, clubId);
  assertEquals(snap.managedClub.id, clubId);

  assert(controller.setFormation(clubId, '4-3-3').success, '应能设置阵型');
  assert(controller.setMentality(clubId, 'attacking').success, '应能设置战术');
  const filled = controller.autoFillManagedLineup();
  assert(filled.success, `自动填充应成功：${JSON.stringify(filled.issues)}`);
  assertEquals(controller.getSnapshot().managedClub.starters.length, 11, '应得到完整首发');
  assertEquals(controller.getSnapshot().managedClub.formation, '4-3-3');
});

// ---------- C. 赛程来自数据库并符合生成器 ----------
test('C. 赛程按双循环生成器排布（轮次、日期、主客场一致）', async () => {
  const controller = makeController();
  await controller.startNewGame('w');
  const state = controller.getState();
  const comp = leagueOf(state);
  const teams = Object.keys(comp.table).sort();
  const expected = generateDoubleRoundRobin(teams, {
    startDate: state.currentDate,
    intervalDays: SCHEDULE_CONFIG.ROUND_INTERVAL_DAYS,
  });

  const key = (m) => `${m.homeId}>${m.awayId}`;
  assertEquals(
    comp.fixtures.length,
    expected.reduce((s, r) => s + r.matches.length, 0),
    '赛程总场次应与生成器一致',
  );
  for (const round of expected) {
    const actual = comp.fixtures.filter((f) => f.round === round.round);
    assertEquals(actual.length, round.matches.length, `第 ${round.round} 轮场次不符`);
    assert(actual.every((f) => f.date === round.date), `第 ${round.round} 轮日期不符`);
    assertEquals(actual.map(key).sort(), round.matches.map(key).sort(), `第 ${round.round} 轮对阵不符`);
  }
});

// ---------- D/E. 推进到下一场：调用生产模拟器 + 积分榜一致 + 不重复结算 ----------
test('D/E. 推进到下一场：结算比赛、积分榜一致、已结算不重复', async () => {
  const controller = makeController();
  await controller.startNewGame('w');
  const clubId = controller.getSnapshot().clubs[0].id;
  controller.setManagedClub(clubId);

  const summary = controller.advanceToNextMatch();
  assert(summary.daysAdvanced > 0, '应推进了时间');
  assertEquals(summary.stopReason, 'condition', '应因比赛结算而停止');

  const state = controller.getState();
  assert(playedCount(state) > 0, '应结算了比赛');
  const comp = leagueOf(state);
  assert(
    comp.fixtures.filter((f) => f.homeId === clubId || f.awayId === clubId).some((f) => f.played),
    '我的球队应有比赛被结算',
  );
  // 积分榜与比赛结果一致（守恒）
  assertEquals(tablePlayedSum(state), 2 * playedCount(state), '积分榜场次与赛果应守恒');
  // 赛果来自真实模拟（非占位 null）
  assert(comp.fixtures.filter((f) => f.played).every((f) => Number.isInteger(f.homeGoals) && Number.isInteger(f.awayGoals)));

  // 再次推进：已结算比赛不得被重复结算或改动
  const round1Scores = comp.fixtures.filter((f) => f.round === 1).map(scoreKey).join(',');
  controller.advanceToNextMatch();
  const comp2 = leagueOf(controller.getState());
  assertEquals(
    comp2.fixtures.filter((f) => f.round === 1).map(scoreKey).join(','),
    round1Scores,
    '已结算比赛不得被重复结算',
  );
  assertEquals(tablePlayedSum(controller.getState()), 2 * playedCount(controller.getState()));
});

test('D2. 未管理球队时推进到下一场以任意比赛为判据', async () => {
  const controller = makeController();
  await controller.startNewGame('w');
  const summary = controller.advanceToNextMatch();
  assertEquals(summary.stopReason, 'condition');
  assert(playedCount(controller.getState()) > 0, '全自动模式下也应推进比赛');
});

// ---------- 确定性 ----------
test('确定性：同一起点相同推进产生完全一致的赛果', async () => {
  async function run() {
    const c = makeController();
    await c.startNewGame('w');
    c.setManagedClub(c.getSnapshot().clubs[0].id);
    c.advanceToNextRound();
    c.advanceToNextRound();
    const comp = leagueOf(c.getState());
    return comp.fixtures.map((f) => `${f.round}:${f.homeId}-${f.awayId}:${scoreKey(f)}`).join('|');
  }
  assertEquals(await run(), await run(), '相同输入应可复现');
});

// ---------- F. 通过 UI 级推进完成完整赛季并滚动 ----------
test('F. 通过 UI 级推进完成完整赛季并滚动到下一赛季', async () => {
  const controller = makeController();
  await controller.startNewGame('w');
  controller.setManagedClub(controller.getSnapshot().clubs[0].id);
  const startSeason = controller.getState().season;

  let guard = 0;
  while (controller.getState().season === startSeason && guard < 40) {
    controller.advanceToNextRound();
    guard += 1;
  }
  assert(controller.getState().season > startSeason, '应推进到赛季结束并滚动');

  const snap = controller.getSnapshot();
  assertEquals(snap.leagues[0].competitionSeason, startSeason + 1, '应进入下一赛季');
  assert(snap.leagues[0].lastSeason, '应归档上赛季最终排名');
  assertEquals(snap.leagues[0].lastSeason.table.length, N);
  assert(
    snap.leagues[0].lastSeason.table.every((r) => r.played === 2 * (N - 1)),
    '上赛季每队应打满双循环',
  );
  // 新赛季赛程已重建且未结算
  assert(snap.leagues[0].fixtures.every((f) => f.played === false), '新赛季赛程应全部未结算');
});

// ---------- G/H. 存档恢复 + 继续推进不重复结算 ----------
test('G/H. 存档恢复：状态一致，继续推进不重复结算', async () => {
  const controller = makeController();
  await controller.startNewGame('w');
  const clubId = controller.getSnapshot().clubs[0].id;
  controller.setManagedClub(clubId);
  controller.setFormation(clubId, '4-3-3');
  controller.setMentality(clubId, 'defensive');
  controller.autoFillManagedLineup();
  controller.advanceToNextRound();
  controller.advanceToNextRound();

  const before = controller.getSnapshot();
  const beforeFixtures = leagueOf(controller.getState()).fixtures
    .map((f) => `${f.id}:${scoreKey(f)}`).join('|');

  await controller.save('slot');
  await controller.load('slot');
  const after = controller.getSnapshot();

  assertEquals(after.currentDate, before.currentDate, '日期应恢复');
  assertEquals(after.season, before.season, '赛季应恢复');
  assertEquals(after.managedClubId, clubId, '管理球队应恢复');
  assertEquals(after.managedClub.formation, '4-3-3', '阵型应恢复');
  assertEquals(after.managedClub.mentality, 'defensive', '战术应恢复');
  assertEquals(after.managedClub.starters.length, 11, '阵容应恢复');
  assertEquals(
    leagueOf(controller.getState()).fixtures.map((f) => `${f.id}:${scoreKey(f)}`).join('|'),
    beforeFixtures,
    '赛程与已结算标记应恢复',
  );
  assertEquals(tablePlayedSum(controller.getState()), 2 * playedCount(controller.getState()));

  // 读档后继续推进：只结算新比赛，旧赛果不变
  const round1Before = leagueOf(controller.getState()).fixtures.filter((f) => f.round === 1).map(scoreKey).join(',');
  const playedBefore = playedCount(controller.getState());
  controller.advanceToNextRound();
  assert(playedCount(controller.getState()) > playedBefore, '应能继续推进');
  assertEquals(
    leagueOf(controller.getState()).fixtures.filter((f) => f.round === 1).map(scoreKey).join(','),
    round1Before,
    '读档后旧赛果不得被改写',
  );
});

// ---------- 新建生涯重置 ----------
test('新建生涯：丢弃当前进度并回到球队选择起点', async () => {
  const controller = makeController();
  await controller.startNewGame('w');
  controller.setManagedClub(controller.getSnapshot().clubs[0].id);
  controller.advanceToNextRound();
  const progressedDate = controller.getState().currentDate;

  controller.newCareer();
  const snap = controller.getSnapshot();
  assertEquals(snap.managedClubId, null, '新建生涯应清除管理球队');
  assertEquals(snap.season, 1);
  assertEquals(playedCount(controller.getState()), 0, '新建生涯应清空赛果');
  assert(snap.currentDate < progressedDate, '日期应回到赛季初');
});

// ---------- 约束扫描：UI 分层与核心确定性 ----------
test('约束：UI 不直连 Core/Data/Save；核心推进无墙钟/随机源', () => {
  const view = readFileSync(join(SRC_DIR, 'ui/app-view.js'), 'utf8');
  assert(!/from\s+'\.\.\/(core|save|data)\//.test(view), 'app-view 不得直接导入 core/save/data');
  const sim = readFileSync(join(SRC_DIR, 'core/simulation.js'), 'utf8');
  assert(!/Math\.random\s*\(/.test(sim), 'simulation 不得使用 Math.random');
  assert(!/Date\.now\s*\(/.test(sim), 'simulation 不得使用 Date.now');
});