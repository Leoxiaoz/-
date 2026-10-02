/**
 * Step 21-A 球员比赛表现 MVP 测试。
 * 覆盖：单场确定性、比分/射门守恒、助攻合法性、cards 有界、rating 边界与 ratingSum 累计、
 * season/career 累计与 reset、save/load（含 schema 8→9 与旧档补 0）、RNG 隔离（黄金指纹）、
 * 长期 10/50/100 赛季稳定性。
 *
 * 红线：新增表现 RNG 不得改变 homeGoals / awayGoals / goal events / 积分榜 / 赛季边界。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState, GAME_STATE_SCHEMA_VERSION } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { simulateMatch, applyMatchPerformance } from '../src/core/match.js';
import { resolveMatchSquad, computeTeamStrength } from '../src/core/team-strength.js';
import {
  getEffectiveAttributes, getPlayerRuntime, getWorldPlayers, initializePlayerRuntime, recordAppearance,
} from '../src/core/player-runtime.js';
import { MATCH_PERFORMANCE_CONFIG, ROSTER_CONFIG } from '../src/core/sim-config.js';
import { serializeState, deserializeState, MemorySaveManager } from '../src/save/save-manager.js';
import { makeLeagueWorldFiles } from './fixtures.js';

const R = MATCH_PERFORMANCE_CONFIG.RATING;

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
function side(state, teamId, tactics = {}) {
  const squad = resolveMatchSquad(state, teamId, tactics);
  return {
    teamId, tactics,
    strength: computeTeamStrength(state, teamId, tactics, squad),
    players: squad.map((p) => ({ id: p.id, position: p.position, ...getEffectiveAttributes(state, p.id) })),
  };
}
function playOnce(state, round = 1, homeId = 'clb_001', awayId = 'clb_002') {
  return simulateMatch({
    home: side(state, homeId), away: side(state, awayId),
    context: { worldId: state.worldId, season: 1, round, homeId, awayId },
  });
}
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}

// ---------- 1. 单场确定性 ----------
test('单场确定性：同 matchSeed 两次运行 events 与 involvements 逐值相同', () => {
  const state = leagueState(8);
  const a = playOnce(state, 3);
  const b = playOnce(state, 3);
  assertEquals(a.matchSeed, b.matchSeed);
  assertEquals(JSON.stringify(a.events), JSON.stringify(b.events));
  assertEquals(JSON.stringify(a.involvements), JSON.stringify(b.involvements));
});

// ---------- 2. 比分守恒 ----------
test('比分守恒：Σplayer.goals == homeGoals + awayGoals', () => {
  const state = leagueState(8);
  for (let round = 1; round <= 20; round += 1) {
    const r = playOnce(state, round);
    const sum = Object.values(r.involvements).reduce((s, v) => s + v.goals, 0);
    assertEquals(sum, r.homeGoals + r.awayGoals, `第 ${round} 轮进球守恒`);
  }
});

// ---------- 3. 射门守恒：shots >= shotsOnTarget >= goals ----------
test('射门守恒：每球员 shots >= shotsOnTarget >= goals，且均为非负整数', () => {
  const state = leagueState(8);
  for (let round = 1; round <= 20; round += 1) {
    const r = playOnce(state, round);
    for (const [id, v] of Object.entries(r.involvements)) {
      assert(Number.isInteger(v.shots) && v.shots >= 0, `${id} shots 非负整数`);
      assert(Number.isInteger(v.shotsOnTarget) && v.shotsOnTarget >= 0, `${id} shotsOnTarget 非负整数`);
      assert(v.shotsOnTarget >= v.goals, `${id} shotsOnTarget >= goals`);
      assert(v.shots >= v.shotsOnTarget, `${id} shots >= shotsOnTarget`);
    }
  }
});

// ---------- 4. 助攻合法性（纯函数，直接断言来源） ----------
test('助攻合法性：同队、非进球者本人、Σassists <= Σgoals', () => {
  const players = [
    { id: 'p1', position: 'FW', finishing: 90, technique: 80, passing: 70 },
    { id: 'p2', position: 'MF', finishing: 60, technique: 75, passing: 88 },
    { id: 'p3', position: 'MF', finishing: 55, technique: 70, passing: 80 },
    { id: 'p4', position: 'DF', finishing: 40, technique: 60, passing: 65 },
  ];
  let sawAssist = false;
  for (let seed = 0; seed < 80; seed += 1) {
    const goalEvents = [{ minute: 12, actorId: 'p1', type: 'goal' }];
    const perf = applyMatchPerformance({
      matchSeed: `s|${seed}`, side: 'home', players, goalsFor: 1, goalsAgainst: 0, goalEvents,
    });
    const totalAssists = Object.values(perf).reduce((s, v) => s + v.assists, 0);
    assert(totalAssists <= 1, '每次进球至多一次助攻');
    assert(Number.isInteger(perf.p1.assists) && perf.p1.assists >= 0, '进球者本人不获得该球助攻');
    assertEquals(perf.p1.assists, 0, '助攻者不能是进球者本人');
    for (const id of ['p1', 'p2', 'p3', 'p4']) {
      assert(perf[id] != null, '助攻只能落在本队出场球员');
      if (perf[id].assists > 0) sawAssist = true;
    }
  }
  assert(sawAssist, '应能观察到至少一次助攻（否则断言空转）');

  // 集成：整轮 Σassists <= Σgoals
  const state = leagueState(8);
  for (let round = 1; round <= 20; round += 1) {
    const r = playOnce(state, round);
    const goals = Object.values(r.involvements).reduce((s, v) => s + v.goals, 0);
    const assists = Object.values(r.involvements).reduce((s, v) => s + v.assists, 0);
    assert(assists <= goals, `第 ${round} 轮 Σassists <= Σgoals`);
  }
});

// ---------- 5. cards 合法性 ----------
test('cards 合法性：非负整数、仅记录在出场球员、单场有界 [0,1]', () => {
  const state = leagueState(8);
  for (let round = 1; round <= 30; round += 1) {
    const r = playOnce(state, round);
    for (const [id, v] of Object.entries(r.involvements)) {
      assert(Number.isInteger(v.yellow) && v.yellow >= 0 && v.yellow <= 1, `${id} yellow 有界`);
      assert(Number.isInteger(v.red) && v.red >= 0 && v.red <= 1, `${id} red 有界`);
    }
  }
});

// ---------- 6. rating ----------
test('rating：所有位置合法、无 NaN、在配置上下界内；ratingSum 正确累计', () => {
  const state = leagueState(8);
  const positionsSeen = new Set();
  for (let round = 1; round <= 20; round += 1) {
    const r = playOnce(state, round);
    for (const v of Object.values(r.involvements)) {
      positionsSeen.add(v.position);
      assert(Number.isFinite(v.rating) && !Number.isNaN(v.rating), 'rating 必须为有限数');
      assert(v.rating >= R.MIN && v.rating <= R.MAX, `rating 在 [${R.MIN}, ${R.MAX}]`);
    }
  }
  for (const pos of ['GK', 'DF', 'MF', 'FW']) assert(positionsSeen.has(pos), `应覆盖位置 ${pos}`);

  // ratingSum 累计：一次出场后 season.ratingSum == round(rating×10)
  const s = leagueState(8);
  recordAppearance(s, 'ply_001', { minutes: 90, rating: 6.44 });
  const rt = getPlayerRuntime(s, 'ply_001');
  assertEquals(rt.stats.season.ratingSum, 64);
  assertEquals(rt.stats.career.ratingSum, 64);
  assertEquals(rt.stats.season.appearances, 1);
  // 均值口径：ratingSum / appearances / 10
  assertEquals(rt.stats.season.ratingSum / rt.stats.season.appearances / 10, 6.4);
});

// ---------- 7. season/career 累计与 reset ----------
test('season/career：新字段累计；赛季滚动后 season 清零、career 保留', () => {
  // 直接累计
  const s = leagueState(8);
  recordAppearance(s, 'ply_001', { minutes: 90, shots: 3, shotsOnTarget: 2, rating: 7.1 });
  recordAppearance(s, 'ply_001', { minutes: 90, shots: 2, shotsOnTarget: 1, rating: 6.3 });
  let rt = getPlayerRuntime(s, 'ply_001');
  assertEquals(rt.stats.season.shots, 5);
  assertEquals(rt.stats.season.shotsOnTarget, 3);
  assertEquals(rt.stats.season.ratingSum, Math.round(7.1 * 10) + Math.round(6.3 * 10));
  assertEquals(rt.stats.career.shots, 5);

  // 完整赛季推进 → 滚动 → season 清零、career 保留
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 91); // 第 1 季结束并滚动
  assertEquals(state.season, 2);
  const anyId = Object.keys(state.runtime.players)[0];
  const p = getPlayerRuntime(state, anyId);
  assertEquals(p.stats.season.appearances, 0, '新赛季出场清零');
  assertEquals(p.stats.season.shots, 0, '新赛季射门清零');
  assertEquals(p.stats.season.shotsOnTarget, 0);
  assertEquals(p.stats.season.ratingSum, 0, '新赛季评分累计清零');
  assert(p.stats.career.appearances >= 0, 'career 保留');
});

// ---------- 8. save/load + schema 8→9 ----------
test('save/load：新字段完整保存/读取，读取后继续模拟一致', async () => {
  assert(GAME_STATE_SCHEMA_VERSION === 10, 'schema 应为 10（Step 25 合同/财政地基）');
  const mgr = new MemorySaveManager();
  const a = leagueState(8);
  new SimulationCore().advanceDays(a, 40);
  await mgr.save('s', a);
  const payload = deserializeState(JSON.parse(JSON.stringify(await mgr.load('s'))));
  const b = createGameState(a.static, { date: payload.currentDate, season: payload.season });
  b.runtime = payload.runtime;
  initializePlayerRuntime(b);
  assertEquals(JSON.stringify(b.runtime.players), JSON.stringify(a.runtime.players), '读档后球员运行时一致');
  new SimulationCore().advanceDays(a, 60);
  new SimulationCore().advanceDays(b, 60);
  assertEquals(JSON.stringify(a.runtime.players), JSON.stringify(b.runtime.players), '继续模拟一致');
});

test('schema 8→9 迁移：旧档缺表现字段时补 0 且可继续模拟', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 5);
  const payload = JSON.parse(JSON.stringify(serializeState(state)));
  payload.stateSchemaVersion = 8;
  // 模拟 v8 旧档：删除 Step 21-A 新增字段
  for (const id of Object.keys(payload.runtime.players)) {
    for (const scope of ['season', 'career']) {
      delete payload.runtime.players[id].stats[scope].shots;
      delete payload.runtime.players[id].stats[scope].shotsOnTarget;
      delete payload.runtime.players[id].stats[scope].ratingSum;
    }
  }
  const p2 = deserializeState(payload);
  const loaded = createGameState(state.static, { date: p2.currentDate, season: p2.season });
  loaded.runtime = p2.runtime;
  initializePlayerRuntime(loaded);
  for (const id of Object.keys(loaded.runtime.players)) {
    const st = loaded.runtime.players[id].stats;
    assertEquals(st.season.shots, 0);
    assertEquals(st.season.shotsOnTarget, 0);
    assertEquals(st.season.ratingSum, 0);
    assertEquals(st.career.shots, 0);
    assertEquals(st.career.ratingSum, 0);
  }
  // 继续模拟不崩溃，且新字段开始累计
  new SimulationCore().advanceDays(loaded, 10);
  const someShots = Object.values(loaded.runtime.players).some((p) => p.stats.season.shots > 0);
  assert(someShots, '旧档读入后新字段应可正常累计');
});

// ---------- 9. RNG 隔离：比分/events 黄金指纹（Step 21-A 前后完全一致） ----------
test('RNG 隔离：homeGoals/awayGoals/goal events 与 Step 21-A 前黄金基线完全一致', () => {
  // 黄金基线：Step 21-A 实施前实测（新增表现流不得改变比分/事件）。
  // Step 39F-G（D-42 B2+C2）后重新冻结：AI 选择变为 development-aware，仅会重排**同 rating** 球员
  //   （influence < 1 ⇒ 不跨越整数 rating 差），故 homeGoals/awayGoals 完全不变；
  //   但同分球员互换会改变 goal events 的 actorId ⇒ 事件哈希需按新实测值重新冻结（明确行为变更）。
  const GOLDEN = {
    1: { g: 2, ga: 1, h: '9242dcff' },
    2: { g: 2, ga: 2, h: '5c2b2242' },
    3: { g: 1, ga: 1, h: 'a046b4a4' },
    4: { g: 3, ga: 4, h: '4aa74bc7' },
    5: { g: 1, ga: 0, h: '61eaff8f' },
    6: { g: 1, ga: 1, h: 'c5690857' },
  };
  for (let round = 1; round <= 6; round += 1) {
    const r = playOnce(leagueState(8), round);
    assertEquals(r.homeGoals, GOLDEN[round].g, `第 ${round} 轮主队进球不变`);
    assertEquals(r.awayGoals, GOLDEN[round].ga, `第 ${round} 轮客队进球不变`);
    assertEquals(fnv(JSON.stringify(r.events)), GOLDEN[round].h, `第 ${round} 轮 goal events 不变`);
  }
  // 整季赛果/积分/出场/进球与实施前一致（第 90 天，赛季 1 内）
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 90);
  const comp = state.runtime.competitions.lg_a;
  const totalGoals = comp.fixtures.reduce((s, f) => s + (f.played ? f.homeGoals + f.awayGoals : 0), 0);
  const playerGoals = state.static.players.reduce((s, p) => s + state.runtime.players[p.id].stats.season.goals, 0);
  const playerApp = state.static.players.reduce((s, p) => s + state.runtime.players[p.id].stats.season.appearances, 0);
  assertEquals(state.season, 1);
  assertEquals(totalGoals, 143, '整季总进球不变');
  assertEquals(playerGoals, 143, '球员进球守恒不变');
  assertEquals(playerApp, 1141, '总出场不变');
});

// ---------- 10. 长期 10/50/100 赛季 ----------
test('长期 10/50/100 赛季：人口/GK/数值/评分/统计无异常漂移', () => {
  for (const seasons of [10, 50, 100]) {
    const state = leagueState(8);
    new SimulationCore().advanceDays(state, seasons * 125);
    const world = getWorldPlayers(state);
    // Step 26B：人口为边界语义，允许在 [Σ俱乐部下限, 初始人口] 区间波动（不再精确恢复 112）。
    assert(world.length >= 8 * ROSTER_CONFIG.MIN_PLAYERS && world.length <= 112,
      `${seasons} 季后活跃人口应在边界区间内（实际 ${world.length}）`);
    assert(world.filter((p) => p.position === 'GK').length >= 8,
      `${seasons} 季后 GK 应不少于每队 1（实际 ${world.filter((p) => p.position === 'GK').length}）`);
    for (const p of world) {
      const rt = getPlayerRuntime(state, p.id);
      assert(rt, `应有 ${p.id} 运行时`);
      for (const scope of ['season', 'career']) {
        const st = rt.stats[scope];
        for (const k of ['appearances', 'minutes', 'goals', 'assists', 'yellow', 'red', 'shots', 'shotsOnTarget', 'ratingSum']) {
          assert(Number.isInteger(st[k]) && st[k] >= 0, `${p.id}.${scope}.${k} 应为非负整数，实为 ${st[k]}`);
        }
        assert(st.shots >= st.shotsOnTarget, `${p.id}.${scope} shots >= shotsOnTarget`);
        assert(st.shotsOnTarget >= st.goals, `${p.id}.${scope} shotsOnTarget >= goals`);
        if (st.appearances > 0) {
          assert(st.ratingSum <= R.MAX * 10 * st.appearances, `${p.id}.${scope} ratingSum 不超过上限`);
          assert(st.ratingSum >= R.MIN * 10 * st.appearances, `${p.id}.${scope} ratingSum 不低于下限`);
        }
      }
      assert(rt.stats.career.appearances >= rt.stats.season.appearances, `${p.id} career >= season 出场`);
    }
    assertEquals(state.season, state.runtime.competitions.lg_a.season, `${seasons} 季 season 同步`);
  }
});