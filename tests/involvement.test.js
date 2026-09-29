/**
 * G1a 比赛球员参与结构测试（Match Involvement Model）。
 * 覆盖：involvements 生成、role/minutes、非出场不写入、goal→actorId 映射、多球累计、
 * assists/yellow/red 由表现系统生成（合法有界）、position 一致、simulation 仅消费 involvements、
 * season/career 聚合与 fitness/form 行为一致、确定性、save/load continuation。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { simulateMatch } from '../src/core/match.js';
import { resolveMatchSquad, computeTeamStrength } from '../src/core/team-strength.js';
import { getEffectiveAttributes, getPlayerRuntime, getPlayerProfile, initializePlayerRuntime } from '../src/core/player-runtime.js';
import { MATCH_LOAD_CONFIG } from '../src/core/sim-config.js';
import { serializeState, deserializeState, MemorySaveManager } from '../src/save/save-manager.js';
import { GameController } from '../src/controller/game-controller.js';
import { buildAutoLineup } from '../src/core/team-strength.js';
import { makeLeagueWorldFiles } from './fixtures.js';

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
/** 等价 #buildSide：用公开 API 组装比赛输入（11 人首发，自动选阵）。 */
function side(state, teamId, tactics = {}) {
  const squad = resolveMatchSquad(state, teamId, tactics);
  return {
    teamId,
    tactics,
    strength: computeTeamStrength(state, teamId, tactics, squad),
    players: squad.map((p) => ({ id: p.id, position: p.position, ...getEffectiveAttributes(state, p.id) })),
  };
}
function playOnce(state, homeId = 'clb_001', awayId = 'clb_002', round = 1) {
  const home = side(state, homeId);
  const away = side(state, awayId);
  return simulateMatch({
    home,
    away,
    context: { worldId: state.worldId, season: 1, round, homeId, awayId },
  });
}
class StubLoader {
  async loadWorld() {
    return parseWorld(makeLeagueWorldFiles(8));
  }
}

// ---------- 1 + 2. 11 starter involvements，minutes=90 ----------
test('固定比赛产出 11 starter involvement/队，且 minutes=90', () => {
  const state = leagueState(8);
  const r = playOnce(state);
  const invs = Object.entries(r.involvements);
  assertEquals(invs.length, 22, '双方各 11 名出场球员');
  const homes = invs.filter(([, v]) => v.side === 'home');
  const aways = invs.filter(([, v]) => v.side === 'away');
  assertEquals(homes.length, 11);
  assertEquals(aways.length, 11);
  for (const [, v] of invs) {
    assertEquals(v.role, 'starter');
    assertEquals(v.minutes, MATCH_LOAD_CONFIG.MINUTES_PER_MATCH);
    assertEquals(v.minutes, 90);
  }
});

// ---------- 3. 非出场不写入 ----------
test('未出场球员不写入 involvements', () => {
  const state = leagueState(8);
  const homeSquad = new Set(resolveMatchSquad(state, 'clb_001', {}).map((p) => p.id));
  const r = playOnce(state);
  const keys = new Set(Object.keys(r.involvements));
  // 同队全部球员中，未入选者不得出现
  for (const p of state.static.players.filter((x) => x.teamId === 'clb_001')) {
    if (!homeSquad.has(p.id)) assert(!keys.has(p.id), `未出场球员 ${p.id} 不应出现在 involvements`);
  }
});

// ---------- 4 + 5. goal → actorId 映射与多球累计 ----------
test('goal 事件映射到 actorId，且 involvements 进球总数等于比分总进球', () => {
  const state = leagueState(8);
  for (let round = 1; round <= 20; round += 1) {
    const r = playOnce(state, 'clb_001', 'clb_002', round);
    // 事件：goal 必有 actorId
    for (const ev of r.events) {
      if (ev.type !== 'goal') continue;
      assert(typeof ev.actorId === 'string' && ev.actorId.length > 0, 'goal 应有 actorId');
      assert(ev.assistId === null, 'goal 的 assistId 当前应为 null');
      assert(r.involvements[ev.actorId] != null, 'actorId 必须是被写入参与记录的球员');
    }
    const invGoals = Object.values(r.involvements).reduce((s, v) => s + v.goals, 0);
    assertEquals(invGoals, r.homeGoals + r.awayGoals, '参与记录进球总数应等于比分');
    for (const v of Object.values(r.involvements)) assert(Number.isInteger(v.assists) && v.assists >= 0, 'assists 应为非负整数');
  }
});

// ---------- 6 + 7. assists / yellow / red（Step 21-A 起由表现系统生成，合法有界）；events 仍仅 goal ----------
test('assists / yellow / red 由表现系统生成：合法有界；events 仍仅记录 goal', () => {
  const state = leagueState(8);
  const r = playOnce(state);
  let goals = 0;
  let assists = 0;
  for (const v of Object.values(r.involvements)) {
    assert(Number.isInteger(v.assists) && v.assists >= 0, 'assists 应为非负整数');
    assert(Number.isInteger(v.yellow) && v.yellow >= 0 && v.yellow <= 1, 'yellow 有界 [0,1]');
    assert(Number.isInteger(v.red) && v.red >= 0 && v.red <= 1, 'red 有界 [0,1]');
    goals += v.goals;
    assists += v.assists;
  }
  assert(assists <= goals, '每球至多一次助攻：Σassists <= Σgoals');
  // 事件层契约未扩展：仍不含 yellow/red/assist 类型
  for (const ev of r.events) assert(['goal'].includes(ev.type), `当前不应有其他事件类型：${ev.type}`);
});

// ---------- 8. position 一致 ----------
test('involvement.position 与实际阵容一致', () => {
  const state = leagueState(8);
  const r = playOnce(state);
  for (const [id, v] of Object.entries(r.involvements)) {
    assertEquals(v.position, getPlayerProfile(state, id).position, `${id} 位置应一致`);
  }
});

// ---------- 9. simulation 只消费 involvements ----------
test('simulation 赛后只消费 involvements：出场集合不再单独维护 squadIds', () => {
  const state = leagueState(8);
  // 侧对象（等价 #buildSide）不含 squadIds
  const s = side(state, 'clb_001');
  assert(!('squadIds' in s), '不再单独维护 squadIds');
  // 真实推进一场：出场统计应等于双方出场集合人数（用干净状态计算期望，避免赛后伤病干扰）
  const pristine = leagueState(8);
  const expected = Object.keys(pristine.runtime.clubs)
    .reduce((sum, id) => sum + resolveMatchSquad(pristine, id, pristine.runtime.clubs[id].tactics).length, 0);
  new SimulationCore().advanceDays(state, 1); // 第 1 轮
  const seasonApp = state.static.players.reduce(
    (s2, p) => s2 + getPlayerRuntime(state, p.id).stats.season.appearances, 0,
  );
  assertEquals(seasonApp, expected, '总出场数应等于双方 involvements 人数');
});

// ---------- 10. season/career 聚合一致 ----------
test('involvements 驱动 season/career 聚合：11 首发各 +1 出场 +90 分钟', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 1);
  const comp = state.runtime.competitions.lg_a;
  const playedCount = comp.fixtures.filter((f) => f.played).length; // 第 1 轮 4 场
  assertEquals(playedCount, 4);
  for (const p of state.static.players) {
    const rt = getPlayerRuntime(state, p.id);
    const app = rt.stats.season.appearances;
    if (app > 0) {
      assertEquals(app, rt.stats.career.appearances);
      assertEquals(rt.stats.season.minutes, app * 90);
    } else {
      assertEquals(rt.stats.season.minutes, 0);
    }
  }
  // 球员进球总数 == 比分总进球（原有意义不变）
  const fixtureGoals = comp.fixtures.filter((f) => f.played).reduce((s, f) => s + f.homeGoals + f.awayGoals, 0);
  const playerGoals = state.static.players.reduce((s, p) => s + getPlayerRuntime(state, p.id).stats.season.goals, 0);
  assertEquals(playerGoals, fixtureGoals);
});

// ---------- 11. fitness/form 行为一致 ----------
test('赛后 fitness/form 行为保持原口径（消耗 FITNESS_COST，form 向基线）', () => {
  const state = leagueState(8);
  const sim = new SimulationCore();
  // 找一名第 1 轮健康出场球员
  sim.advanceDays(state, 1);
  const played = state.static.players
    .map((p) => ({ p, rt: getPlayerRuntime(state, p.id) }))
    .find(({ rt }) => rt.stats.season.appearances > 0);
  assert(played, '应有出场球员');
  // 初始 fitness=100、form=50 → 赛后应为 100-12=88；form 仍 50（基线）
  assertEquals(played.rt.fitness, 100 - MATCH_LOAD_CONFIG.FITNESS_COST);
  assertEquals(played.rt.form, MATCH_LOAD_CONFIG.FORM_BASELINE);
});

// ---------- 12. 确定性 / matchSeed 一致 ----------
test('同条件同种子完全可复现（events 与 involvements 逐值相等）', () => {
  const state = leagueState(8);
  const r1 = playOnce(state);
  const r2 = playOnce(state);
  assertEquals(r1.matchSeed, r2.matchSeed);
  assertEquals(r1.homeGoals, r2.homeGoals);
  assertEquals(r1.awayGoals, r2.awayGoals);
  assertEquals(JSON.stringify(r1.events), JSON.stringify(r2.events));
  assertEquals(JSON.stringify(r1.involvements), JSON.stringify(r2.involvements));
});

// ---------- 13. managed lineup 不受影响 ----------
test('managed lineup / resolveMatchSquad 行为不受 G1a 影响', () => {
  const state = leagueState(8);
  state.runtime.managedClubId = 'clb_001';
  state.runtime.clubs.clb_001.lineup = buildAutoLineup(state, 'clb_001', { formation: '4-4-2' });
  const chosen = resolveMatchSquad(state, 'clb_001', { formation: '4-4-2' }).map((p) => p.id);
  assertEquals(chosen, state.runtime.clubs.clb_001.lineup.starters, '玩家阵容仍被使用');
  new SimulationCore().advanceDays(state, 1);
  // lineup 未被改动（仅可能因伤病修复，但首轮前无伤病）
  assertEquals(state.runtime.clubs.clb_001.lineup.starters.length, 11);
});

// ---------- 14. save/load continuation ----------
test('save/load 后继续模拟结果一致（含 involvements 聚合的统计）', async () => {
  const mgr = new MemorySaveManager();
  const a = leagueState(8);
  new SimulationCore().advanceDays(a, 40);
  await mgr.save('s', a);
  const payload = await mgr.load('s');
  const b = createGameState(a.static, { date: payload.currentDate, season: payload.season });
  b.runtime = payload.runtime;
  initializePlayerRuntime(b);
  new SimulationCore().advanceDays(a, 60);
  new SimulationCore().advanceDays(b, 60);
  assertEquals(JSON.stringify(a.runtime.players), JSON.stringify(b.runtime.players));
  assertEquals(
    JSON.stringify(a.runtime.competitions.lg_a.table),
    JSON.stringify(b.runtime.competitions.lg_a.table),
  );
});

// ---------- 15. 控制器读档回归（含 managed lineup） ----------
test('控制器 save/load 后 managed lineup 与统计保持一致', async () => {
  const controller = new GameController({
    dataLoader: new StubLoader(),
    saveManager: new MemorySaveManager(),
    simulation: new SimulationCore(),
  });
  await controller.startNewGame('w');
  controller.setManagedClub('clb_001');
  controller.autoFillManagedLineup();
  new SimulationCore().advanceDays(controller.getState(), 30);
  const lineup = JSON.parse(JSON.stringify(controller.getState().runtime.clubs.clb_001.lineup));
  await controller.save('s');
  await controller.load('s');
  assertEquals(controller.getState().runtime.clubs.clb_001.lineup, lineup);
});