/** 比赛闭环测试：RNG / 赛程 / 实力 / 单场 / 积分 / 整赛季 / 多赛季 / 存读一致。 */

import { test, assert, assertEquals } from './harness.js';
import { createRng } from '../src/core/rng.js';
import { generateDoubleRoundRobin } from '../src/core/schedule.js';
import { computeTeamStrength } from '../src/core/team-strength.js';
import { simulateMatch } from '../src/core/match.js';
import { createTable, applyResult, sortTable } from '../src/core/standings.js';
import { createGameState, getCompetitionRuntime } from '../src/core/game-state.js';
import { SimulationCore } from '../src/core/simulation.js';
import { parseWorld } from '../src/data/data-loader.js';
import { serializeState, deserializeState } from '../src/save/save-manager.js';
import { makeLeagueWorldFiles } from './fixtures.js';

const LEAGUE_ID = 'lg_a';

function leagueWorld(n = 8) {
  return parseWorld(makeLeagueWorldFiles(n));
}

function newLeagueState(n = 8) {
  return createGameState(leagueWorld(n));
}

function playFullSeason(sim, state) {
  // 8 队 14 轮，第 14 轮在第 91 天；推进 91 天恰好完成第 1 赛季并触发滚动
  sim.advanceDays(state, 91);
}

test('createRng：同种子产出同一序列，不同种子不同（可复现 A8/第10条）', () => {
  const a = createRng('seed-1');
  const b = createRng('seed-1');
  const c = createRng('seed-2');
  const seqA = [a.next(), a.next(), a.next()];
  const seqB = [b.next(), b.next(), b.next()];
  const seqC = [c.next(), c.next(), c.next()];
  assertEquals(seqA, seqB);
  assert(JSON.stringify(seqA) !== JSON.stringify(seqC), '不同种子应产出不同序列');
});

test('generateDoubleRoundRobin：每对球队各主客一次，轮数为 2(n-1)', () => {
  const teams = ['a', 'b', 'c', 'd'];
  const rounds = generateDoubleRoundRobin(teams, { startDate: '2026-07-01', intervalDays: 7 });
  assertEquals(rounds.length, 6);
  const seen = new Map();
  for (const r of rounds) {
    for (const m of r.matches) seen.set(`${m.homeId}>${m.awayId}`, (seen.get(`${m.homeId}>${m.awayId}`) ?? 0) + 1);
  }
  for (const h of teams) {
    for (const a of teams) {
      if (h === a) continue;
      assertEquals(seen.get(`${h}>${a}`), 1, `${h} 主场对 ${a} 应恰好一次`);
    }
  }
});

test('generateDoubleRoundRobin：奇数队自动轮空', () => {
  const teams = ['a', 'b', 'c', 'd', 'e'];
  const rounds = generateDoubleRoundRobin(teams, { startDate: '2026-07-01', intervalDays: 7 });
  assertEquals(rounds.length, 10); // 2*(n-1)，n=6（5 队 + 轮空）
  // 每轮最多 floor(n/2)=2 场（一队轮空）
  for (const r of rounds) assert(r.matches.length === 2, '5 队每轮应有 2 场');
  const counts = {};
  for (const r of rounds) for (const m of r.matches) {
    counts[m.homeId] = (counts[m.homeId] ?? 0) + 1;
    counts[m.awayId] = (counts[m.awayId] ?? 0) + 1;
  }
  for (const t of teams) assertEquals(counts[t], 8, `${t} 应各赛 8 场`);
});

test('computeTeamStrength：实力梯度方向正确', () => {
  const state = newLeagueState(4);
  const strong = computeTeamStrength(state, 'clb_001');
  const weak = computeTeamStrength(state, 'clb_004');
  assert(strong.attack > weak.attack, '强队进攻应更高');
  assert(strong.defence > weak.defence, '强队防守应更高');
});

test('simulateMatch：同条件+种子完全可复现', () => {
  const state = newLeagueState(4);
  const side = (id) => ({ teamId: id, tactics: {}, strength: computeTeamStrength(state, id), players: state.static.players.filter((p) => p.teamId === id) });
  const ctx = { worldId: 'w_league', season: 1, round: 1, homeId: 'clb_001', awayId: 'clb_002' };
  const r1 = simulateMatch({ home: side('clb_001'), away: side('clb_002'), context: ctx });
  const r2 = simulateMatch({ home: side('clb_001'), away: side('clb_002'), context: ctx });
  assertEquals(r1.homeGoals, r2.homeGoals);
  assertEquals(r1.awayGoals, r2.awayGoals);
  assertEquals(r1.events, r2.events);
  assert(Number.isInteger(r1.homeGoals) && r1.homeGoals >= 0, '进球应为非负整数');
});

test('standings：积分/净胜球统计正确且排序确定', () => {
  const table = createTable(['a', 'b', 'c']);
  applyResult(table, 'a', 'b', 2, 0);
  applyResult(table, 'b', 'c', 1, 1);
  assertEquals(table.a.points, 3);
  assertEquals(table.a.gd, 2);
  assertEquals(table.b.points, 1);
  assertEquals(table.c.points, 1);
  const sorted = sortTable(table);
  assertEquals(sorted[0].teamId, 'a');
  // b、c 同分：c 净胜球 0 > b -2，故 c 在前（确定性排序）
  assertEquals(sorted.map((r) => r.teamId), ['a', 'c', 'b']);
});

test('整赛季：全部赛程完成、积分与场次守恒', () => {
  const sim = new SimulationCore();
  const state = newLeagueState(8);
  const comp0 = getCompetitionRuntime(state, LEAGUE_ID);
  const seasonOneFixtures = comp0.fixtures.length; // 14 轮 * 4 场 = 56
  assertEquals(seasonOneFixtures, 56);

  playFullSeason(sim, state);

  // 赛季已滚动：当前联赛运行时属于第 2 赛季
  const comp = getCompetitionRuntime(state, LEAGUE_ID);
  assertEquals(comp.season, 2);
  assert(comp.fixtures.every((f) => !f.played), '新赛季赛程应全部未进行');

  // 用第 1 赛季的事件核对守恒（事件是运行时可观测记录）
  const played = state.runtime.events.filter((e) => e.type === 'match_played' && e.payload.season === 1);
  assertEquals(played.length, seasonOneFixtures);
});

test('多赛季：连续推进仍稳定且赛季递增（长期稳定性要求 17）', () => {
  const sim = new SimulationCore();
  const state = newLeagueState(8);
  sim.advanceDays(state, 600); // ≈ 5 个赛季
  assert(state.season >= 4, `赛季应持续滚动，实际 ${state.season}`);
  const comp = getCompetitionRuntime(state, LEAGUE_ID);
  // 每支球队赛程完整：14 轮 * 4 场
  assertEquals(comp.fixtures.length, 56);
  assert(comp.table && Object.keys(comp.table).length === 8, '积分榜应含全部球队');
});

test('强队赛季末排名应高于弱队（可解释的实力后果）', () => {
  const sim = new SimulationCore();
  const state = newLeagueState(8);
  // 只推进到第 1 赛季结束（不滚动）后读取积分榜不可得，故读取事件汇总
  sim.advanceDays(state, 91); // 覆盖到最后一轮比赛日
  const played = state.runtime.events.filter((e) => e.type === 'match_played' && e.payload.season === 1);
  assertEquals(played.length, 56);
  // 依据事件重算积分榜，验证实力与结果正相关
  const table = createTable(state.static.teams.map((t) => t.id));
  for (const e of played) {
    const [hg, ag] = e.payload.score.split('-').map(Number);
    applyResult(table, e.payload.homeId, e.payload.awayId, hg, ag);
  }
  assert(table.clb_001.points > table.clb_008.points, '实力梯度应体现在积分上');
});

test('赛季滚动归档上赛季最终积分榜（可回看/可解释，第 22 条）', () => {
  const sim = new SimulationCore();
  const state = newLeagueState(8);
  sim.advanceDays(state, 91);
  const comp = getCompetitionRuntime(state, LEAGUE_ID);
  assertEquals(comp.season, 2);
  assertEquals(comp.history.length, 1);
  assertEquals(comp.history[0].season, 1);
  assert(comp.history[0].table.clb_001.points > 0, '归档积分榜应保留实际积分');
});

test('比分分布：大样本场均总进球与主客场比例落入现实区间（S12 校准护栏，确定性）', () => {
  const sim = new SimulationCore();
  const state = newLeagueState(8);
  // 约 30 个完整赛季（每季 91 天 + 30 天间歇），大样本消除单季采样噪声。
  sim.advanceDays(state, 40 * 91);

  const played = state.runtime.events.filter((e) => e.type === 'match_played');
  assert(played.length > 1000, `样本应足够大，实际 ${played.length}`);

  let homeGoals = 0;
  let awayGoals = 0;
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  for (const e of played) {
    const [h, a] = e.payload.score.split('-').map(Number);
    homeGoals += h;
    awayGoals += a;
    if (h > a) homeWins += 1;
    else if (h === a) draws += 1;
    else awayWins += 1;
  }
  const avg = (homeGoals + awayGoals) / played.length;
  const homeWinRate = homeWins / played.length;
  const drawRate = draws / played.length;
  const awayWinRate = awayWins / played.length;

  // 现实足球区间（顶级联赛大致 2.5–2.9）：留出合理带宽，防止结构漂移或误调。
  assert(avg >= 2.4 && avg <= 3.2, `场均总进球应落在现实区间，实际 ${avg.toFixed(2)}`);
  assert(drawRate >= 0.15 && drawRate <= 0.35, `平局占比应合理，实际 ${(drawRate * 100).toFixed(1)}%`);
  assert(homeWinRate > awayWinRate, '主场优势应体现为主胜率高于客胜率');
});

test('存读一致：序列化/反序列化保留赛程与赛果', () => {
  const sim = new SimulationCore();
  const state = newLeagueState(8);
  sim.advanceDays(state, 30); // 完成前若干轮

  const payload = deserializeState(serializeState(state));
  const comp = payload.runtime.competitions[LEAGUE_ID];
  const original = getCompetitionRuntime(state, LEAGUE_ID);
  assertEquals(comp.fixtures, original.fixtures);
  assertEquals(comp.table, original.table);
  assertEquals(payload.currentDate, state.currentDate);
});