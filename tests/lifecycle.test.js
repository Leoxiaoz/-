/**
 * 球员生命周期测试（第 19 步，DECISIONS D-17 / SIMULATION_SPEC §23）。
 * 覆盖：退役（软区间/硬上限/确定性）、新生代生成（三路独立抖动/字段合法/首次成长时机）、
 * 人口补位（GK≥1/位置缺口/不无限增长）、访问器、退役归档、存档迁移（v4→v5）、
 * 序号防回退、ID 唯一不复用、小型世界、10/50/100/200 赛季长期稳定。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld, WORLD_FORMAT } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import {
  getPlayerRuntime,
  getEffectiveAttributes,
  getWorldPlayers,
  getTeamPlayers,
  getPlayerProfile,
  isRetired,
  initializePlayerRuntime,
  INJURY_STATUS,
} from '../src/core/player-runtime.js';
import { retireProbability, evaluatePopulationHealth, replenishPopulation, generatePlayer } from '../src/core/player-lifecycle.js';
import { developPlayers } from '../src/core/player-growth.js';
import { computeTeamStrength } from '../src/core/team-strength.js';
import { addPlayerMembership, validateMembership, getPlayerClub } from '../src/core/membership.js';
import { serializeState, deserializeState, MemorySaveManager } from '../src/save/save-manager.js';
import { RETIREMENT_CONFIG, GENERATION_CONFIG, ROSTER_CONFIG, WORLD_MIN_POPULATION } from '../src/core/sim-config.js';
import { makeLeagueWorldFiles } from './fixtures.js';

const ATTRS = ['pace', 'technique', 'passing', 'defending', 'finishing', 'goalkeeping'];
const VITALS = ['fitness', 'form', 'morale'];
const POSITIONS = ['GK', 'DF', 'MF', 'FW'];

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
function activePlayers(state) {
  return getWorldPlayers(state);
}

/** 构造含若干超龄球员的联赛（触发退役）。默认 8 队（赛季较长，便于精确取样）。 */
function agedLeagueFiles(n = 8, positions = ['FW']) {
  const files = makeLeagueWorldFiles(n);
  const counters = {};
  for (const p of files.players) {
    if (!positions.includes(p.position)) continue;
    counters[p.position] = (counters[p.position] ?? 0) + 1;
    if (counters[p.position] <= n) p.birthDate = '1986-06-15'; // 2026 年 40 岁 > hardCap
  }
  return files;
}
function agedState(n = 8, positions = ['FW']) {
  return createGameState(parseWorld(agedLeagueFiles(n, positions)));
}

/** 极小型世界：2 队，每队 3 人（GK/DF/FW）；阵型最低需求会驱动有限补位。 */
function smallWorldFiles() {
  const teams = [];
  const players = [];
  let seq = 1;
  const pad = (x) => String(x).padStart(3, '0');
  for (let i = 0; i < 2; i += 1) {
    const teamId = `clb_s${pad(i + 1)}`;
    teams.push({ id: teamId, name: `Small ${pad(i + 1)}`, leagueId: 'lg_a', formation: '4-4-2' });
    for (const position of ['GK', 'DF', 'FW']) {
      const id = `ply_s${pad(seq)}`;
      seq += 1;
      const attrs = { pace: 50, technique: 50, passing: 50, defending: 50, finishing: 50, goalkeeping: 50 };
      const potential = {};
      for (const a of ATTRS) potential[a] = 60;
      players.push({
        id, name: id, teamId, position, ...attrs,
        birthDate: '2000-05-01', potential,
        personality: { professionalism: 60, determination: 60, ambition: 60, consistency: 60, injuryProneness: 50 },
      });
    }
  }
  return {
    manifest: { id: 'w_small', name: 'Small World', version: '0.1.0', format: WORLD_FORMAT, startDate: '2026-07-01' },
    countries: [{ id: 'cty_a', name: 'Country A' }],
    leagues: [{ id: 'lg_a', name: 'League A', countryId: 'cty_a' }],
    teams,
    players,
  };
}

// ---------- 退役：概率与曲线 ----------
test('退役概率：软区间前为 0，硬上限为 1，区间内线性上升', () => {
  const c = { softStart: 32, hardCap: 37 };
  assertEquals(retireProbability(31, c), 0);
  assertEquals(retireProbability(37, c), 1);
  assertEquals(retireProbability(40, c), 1);
  const p32 = retireProbability(32, c);
  const p34 = retireProbability(34, c);
  assert(p32 > 0 && p34 > p32, `软区间内概率应上升（${p32} → ${p34}）`);
});

test('位置退役曲线：GK 晚于 FW（hardCap 更大）', () => {
  assert(RETIREMENT_CONFIG.CURVES.GK.hardCap > RETIREMENT_CONFIG.CURVES.FW.hardCap);
  assert(RETIREMENT_CONFIG.CURVES.GK.softStart > RETIREMENT_CONFIG.CURVES.FW.softStart);
  assertEquals(RETIREMENT_CONFIG.ENABLED, true);
});

// ---------- 退役：硬上限强制、不永久、归档 ----------
test('超硬上限强制退役，退役者移出 active 并写入归档（保留 career）', () => {
  const state = agedState(8, ['FW']);
  const forced = activePlayers(state).filter((p) => state.static.players.find((s) => s.id === p.id)?.birthDate === '1986-06-15');
  assert(forced.length > 0, '应有超龄球员');
  const forcedIds = forced.map((p) => p.id);

  new SimulationCore().advanceDays(state, 92); // 完成第 1 季并滚动

  for (const id of forcedIds) {
    assert(isRetired(state, id), `${id} 应因硬上限退役`);
    assert(state.runtime.retired[id].career, '退役归档应保留 career');
    assert(!activePlayers(state).some((p) => p.id === id), '退役者不应再出现在 active 世界');
    assert(getPlayerRuntime(state, id) == null, '退役者不应再有 active 运行时状态');
  }
});

test('退役判定确定性：同输入两次得到同一批退役者', () => {
  const a = agedState(8, ['FW', 'DF']);
  const b = agedState(8, ['FW', 'DF']);
  new SimulationCore().advanceDays(a, 92);
  new SimulationCore().advanceDays(b, 92);
  const ra = Object.keys(a.runtime.retired).sort();
  const rb = Object.keys(b.runtime.retired).sort();
  assertEquals(ra, rb);
  assert(ra.length > 0, '应有退役发生');
});

// ---------- 新生代：字段合法 ----------
test('新生代生成：年龄 17–19、base≤potential≤99、人格在范围、vitals 默认、健康', () => {
  const state = agedState(8, ['FW', 'GK']);
  new SimulationCore().advanceDays(state, 92);
  const genIds = Object.keys(state.runtime.generated);
  assert(genIds.length > 0, '退役造成缺口后应生成新生代');

  for (const id of genIds) {
    const g = state.runtime.generated[id];
    const age = Number(state.currentDate.slice(0, 4)) - Number(g.birthDate.slice(0, 4));
    assert(age >= GENERATION_CONFIG.AGE_MIN - 1 && age <= GENERATION_CONFIG.AGE_MAX + 1, `${id} 年龄异常 ${age}`);
    assert(POSITIONS.includes(g.position), `${id} 位置非法`);
    assert(g.teamId && state.runtime.clubs[g.teamId], `${id} teamId 非法`);
    for (const a of ATTRS) {
      assert(Number.isInteger(g.attributes[a]) && g.attributes[a] >= 1 && g.attributes[a] <= 99, `${id}.${a} base 越界`);
      assert(g.potential[a] >= g.attributes[a], `${id}.${a} potential < base`);
      assert(g.potential[a] <= 99, `${id}.${a} potential 超上限`);
    }
    for (const k of Object.keys(g.personality)) {
      assert(g.personality[k] >= 1 && g.personality[k] <= 99, `${id} 人格越界`);
    }
    const rt = getPlayerRuntime(state, id);
    assertEquals([rt.fitness, rt.form, rt.morale], [100, 50, 50]);
    assertEquals(rt.injury.status, INJURY_STATUS.FIT);
    assertEquals(rt.injuryHistory.recurrenceCount, 0);
    assert(rt.stats.career.appearances === 0, '新生代初始 career 应为 0');
  }
});

// ---------- 新生代：首次成长时机 ----------
test('新生代不在生成当次 rollover 成长；下一赛季结束后才首次成长', () => {
  const state = agedState(8, ['FW']);
  new SimulationCore().advanceDays(state, 92); // 第 1 季结束 → 生成属第 2 季的新生代
  const genId = Object.keys(state.runtime.generated)[0];
  assert(genId, '应有新生代');
  const rt = getPlayerRuntime(state, genId);
  // 生成时 = 属下一赛季（season=2），首次成长应发生在完整第 2 季结束后。
  assertEquals(rt.growth.lastEvaluatedSeason, 1, '生成时应标记为"已结算到刚结束的赛季(1)"');
  assertEquals(rt.stats.seasonNumber, state.season, 'seasonNumber 应为新赛季');

  // 再次结算刚结束的赛季（season=1）：不应产生成长（lastEvaluatedSeason=1 已幂等）
  const before = getEffectiveAttributes(state, genId);
  developPlayers(state, { seasonNumber: 1 });
  assertEquals(getPlayerRuntime(state, genId).growth.lastEvaluatedSeason, 1, '不应在生成当次被成长');
  assertEquals(getEffectiveAttributes(state, genId), before, '不应在生成当次被成长');

  // 完整第 2 季结束后（seasonNumber=2 > 1）才首次成长。
  new SimulationCore().advanceDays(state, 125); // 进入并完成第 2 季
  assertEquals(getPlayerRuntime(state, genId).growth.lastEvaluatedSeason >= 2, true, '第 2 季结束后应已成长');
});

// ---------- 人口（Step 26B：Boundary 语义，非 exact target）----------
test('人口补位：每队满足阵容边界与位置最低保障，且不无限增长', () => {
  const state = agedState(8, ['FW', 'GK', 'DF']);
  new SimulationCore().advanceDays(state, 8 * 125);
  for (const clubId of Object.keys(state.runtime.clubs)) {
    const roster = getTeamPlayers(state, clubId);
    const count = roster.length;
    const byPos = (p) => roster.filter((x) => x.position === p).length;
    assert(byPos('GK') >= ROSTER_CONFIG.MIN_GK, `${clubId} GK 低于最低保障`);
    assert(count >= ROSTER_CONFIG.MIN_PLAYERS, `${clubId} 低于人数下限（${count}）`);
    assert(count <= ROSTER_CONFIG.MAX_PLAYERS, `${clubId} 超过人数上限（${count}）`);
    assert(byPos('DF') >= ROSTER_CONFIG.MIN_BY_POSITION.DF, `${clubId} DF 低于最低保障`);
    assert(byPos('MF') >= ROSTER_CONFIG.MIN_BY_POSITION.MF, `${clubId} MF 低于最低保障`);
    assert(byPos('FW') >= ROSTER_CONFIG.MIN_BY_POSITION.FW, `${clubId} FW 低于最低保障`);
  }
});

test('长期人口稳定：人口在 [Σ俱乐部下限, 初始] 内波动，不机械恢复初始规模', () => {
  const state = agedState(8, ['FW']);
  const clubCount = Object.keys(state.runtime.clubs).length;
  const initialTotal = activePlayers(state).length; // 112
  new SimulationCore().advanceDays(state, 30 * 125);
  const total = activePlayers(state).length;
  assert(total >= clubCount * ROSTER_CONFIG.MIN_PLAYERS,
    `总活跃人数应不低于俱乐部下限总和（实际 ${total}）`);
  assert(total <= initialTotal, `总活跃人数不应超过初始规模（实际 ${total}>${initialTotal}）`);
  // 强制老龄化后人口应随退休自然下降——exact-112 恢复已被废弃。
  assert(total < initialTotal, `人口应随退休下降而非机械恢复初始规模（实际 ${total}）`);
});

// ---------- 小型世界 ----------
test('小型世界：按俱乐部边界补位（不按大库规模造人），人口稳定不爆炸', () => {
  const state = createGameState(parseWorld(smallWorldFiles()));
  new SimulationCore().advanceDays(state, 20 * 125);
  const perClub = Object.keys(state.runtime.clubs).map((c) => getTeamPlayers(state, c).length);
  // 每队被补到阵容下限（GK1+DF4+MF4+FW2=11 结构 + 1 缓冲 = MIN_PLAYERS=12），不会无限增长。
  for (const n of perClub) {
    assert(n >= ROSTER_CONFIG.MIN_PLAYERS && n <= ROSTER_CONFIG.MAX_PLAYERS,
      `小型世界阵容应在边界内，实际 ${n}`);
  }
  const after = activePlayers(state).length;
  new SimulationCore().advanceDays(state, 10 * 125);
  assertEquals(activePlayers(state).length, after, '小型世界人口应稳定');
});

// ---------- 访问器 ----------
test('访问器：getWorldPlayers/getTeamPlayers/getPlayerProfile 排除退役、包含新生代', () => {
  const state = agedState(8, ['FW']);
  new SimulationCore().advanceDays(state, 92);
  const retiredIds = Object.keys(state.runtime.retired);
  for (const id of retiredIds) {
    assert(getPlayerProfile(state, id) !== null, '归档仍可通过 profile 读取（静态库仍在）');
    assert(!getWorldPlayers(state).some((p) => p.id === id), '退役者不应在世界球员中');
  }
  const genId = Object.keys(state.runtime.generated)[0];
  assert(getPlayerProfile(state, genId) !== null, '新生代应可通过 profile 读取');
  assert(getWorldPlayers(state).some((p) => p.id === genId), '新生代应属于世界球员');
});

// ---------- 新生代参与既有系统 ----------
test('新生代自动进入比赛/统计/伤病系统', () => {
  const state = agedState(8, ['FW']);
  new SimulationCore().advanceDays(state, 92); // 生成新生代（属第 2 季）
  const genIds = Object.keys(state.runtime.generated);
  new SimulationCore().advanceDays(state, 90); // 第 2 季大部分赛程
  const participated = genIds.some((id) => getPlayerRuntime(state, id).stats.career.appearances > 0);
  assert(participated, '新生代应参与比赛并计入出场统计');
  // 球队实力在含新生代时仍合法
  for (const clubId of Object.keys(state.runtime.clubs)) {
    const s = computeTeamStrength(state, clubId);
    assert(POSITIONS.every(() => true));
    for (const k of ['attack', 'midfield', 'defence', 'goalkeeping']) {
      assert(Number.isFinite(s[k]) && s[k] >= 1, `${clubId}.${k} 非法`);
    }
  }
});

// ---------- 存档：v4→v5 迁移 / 序号防回退 ----------
test('旧档（缺 generated/retired/nextGeneratedSeq）normalize 为默认且可继续模拟', () => {
  const state = leagueState(4);
  new SimulationCore().advanceDays(state, 92);
  const payload = serializeState(state);
  delete payload.runtime.generated;
  delete payload.runtime.retired;
  delete payload.runtime.nextGeneratedSeq;
  delete payload.runtime.populationTarget;

  const p2 = deserializeState(JSON.parse(JSON.stringify(payload)));
  assertEquals(p2.runtime.generated, {});
  assertEquals(p2.runtime.retired, {});
  assertEquals(p2.runtime.nextGeneratedSeq, 0);

  const loaded = createGameState(state.static, { date: p2.currentDate, season: p2.season });
  loaded.runtime = p2.runtime;
  initializePlayerRuntime(loaded);
  assert(loaded.runtime.populationTarget && Object.keys(loaded.runtime.populationTarget).length > 0,
    '旧档应依据世界补齐 populationTarget');
  // 继续模拟不崩溃
  new SimulationCore().advanceDays(loaded, 30);
});

test('nextGeneratedSeq 永不回退（读档后取存档值与已生成最大序号的较大者）', () => {
  const state = agedState(8, ['FW']);
  new SimulationCore().advanceDays(state, 92);
  const seqBefore = state.runtime.nextGeneratedSeq;
  assert(seqBefore > 0, '应已生成新生代');
  const payload = serializeState(state);
  payload.runtime.nextGeneratedSeq = 0; // 模拟损坏/回退

  const p2 = deserializeState(JSON.parse(JSON.stringify(payload)));
  const loaded = createGameState(state.static, { date: p2.currentDate, season: p2.season });
  loaded.runtime = p2.runtime;
  initializePlayerRuntime(loaded);
  assert(loaded.runtime.nextGeneratedSeq >= seqBefore, `序号不得回退（${loaded.runtime.nextGeneratedSeq} < ${seqBefore}）`);
});

test('存档往返一致：generated/retired/nextGeneratedSeq/populationTarget 稳定', async () => {
  const mgr = new MemorySaveManager();
  const state = agedState(8, ['FW']);
  new SimulationCore().advanceDays(state, 92);
  await mgr.save('slot', state);
  const payload = await mgr.load('slot');
  const loaded = createGameState(state.static, { date: payload.currentDate, season: payload.season });
  loaded.runtime = payload.runtime;
  initializePlayerRuntime(loaded);

  assertEquals(loaded.runtime.nextGeneratedSeq, state.runtime.nextGeneratedSeq);
  assertEquals(JSON.stringify(loaded.runtime.generated), JSON.stringify(state.runtime.generated));
  assertEquals(JSON.stringify(loaded.runtime.retired), JSON.stringify(state.runtime.retired));
  assertEquals(JSON.stringify(loaded.runtime.populationTarget), JSON.stringify(state.runtime.populationTarget));
  assertEquals(JSON.stringify(loaded.runtime.players), JSON.stringify(state.runtime.players));
});

// ---------- ID 唯一 / 不复用 ----------
test('新生代 ID 唯一、不复用退役 ID、命名空间正确', () => {
  const state = agedState(8, ['FW', 'GK']);
  new SimulationCore().advanceDays(state, 30 * 125);
  const ids = Object.keys(state.runtime.generated);
  for (const id of ids) assert(id.startsWith(GENERATION_CONFIG.ID_PREFIX), `ID 命名空间错误 ${id}`);
  assertEquals(new Set(ids).size, ids.length, '新生代 ID 不应重复');
  const staticIds = new Set(state.static.players.map((p) => p.id));
  for (const id of ids) assert(!staticIds.has(id), `新生代 ID 不应与静态库冲突 ${id}`);
  const retiredIds = new Set(Object.keys(state.runtime.retired));
  for (const id of ids) assert(!retiredIds.has(id), `不得复用退役 ID ${id}`);
});

// ---------- 长期稳定（10/50/100/200） ----------
function assertWorldStable(state, label) {
  const seen = new Set();
  for (const p of activePlayers(state)) {
    assert(!seen.has(p.id), `${label} 出现重复 ID ${p.id}`);
    seen.add(p.id);
    for (const a of ATTRS) {
      const eff = getEffectiveAttributes(state, p.id)[a];
      assert(Number.isFinite(eff) && eff >= 1 && eff <= 99, `${label} ${p.id}.${a} 越界 ${eff}`);
      assert(eff <= p.potential[a], `${label} ${p.id}.${a} 超过 potential`);
    }
    const rt = getPlayerRuntime(state, p.id);
    for (const v of VITALS) assert(Number.isFinite(rt[v]) && rt[v] >= 0 && rt[v] <= 100, `${label} ${p.id}.${v} 越界`);
  }
  for (const clubId of Object.keys(state.runtime.clubs)) {
    assert(getTeamPlayers(state, clubId).some((p) => p.position === 'GK'), `${label} ${clubId} GK 真空`);
  }
}

function stats(state) {
  const w = activePlayers(state);
  const ages = w.map((p) => Number(state.currentDate.slice(0, 4)) - Number(p.birthDate.slice(0, 4)));
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  let base = 0;
  let pot = 0;
  for (const p of w) {
    for (const a of ATTRS) { base += p[a]; pot += p.potential[a]; }
  }
  return {
    total: w.length,
    avgAge: mean(ages),
    baseMean: base / (w.length * ATTRS.length),
    potMean: pot / (w.length * ATTRS.length),
  };
}

test('10 赛季：人口稳定、无越界、无 NaN、GK 不真空', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 10 * 125);
  assertWorldStable(state, '10季');
});

test('50 赛季：人口稳定、年龄结构合理、能力不坍缩不膨胀', () => {
  const state = leagueState(8);
  const s0 = stats(state);
  new SimulationCore().advanceDays(state, 50 * 125);
  assertWorldStable(state, '50季');
  const s50 = stats(state);
  assert(s50.total >= 8 * ROSTER_CONFIG.MIN_PLAYERS && s50.total <= s0.total,
    `50 赛季后总人口应在边界区间内（${s50.total}）`);
  assert(s50.avgAge > 20 && s50.avgAge < 33, `年龄均值应合理（${s50.avgAge.toFixed(1)}）`);
  assert(s50.baseMean >= s0.baseMean * 0.6 && s50.baseMean <= s0.baseMean * 1.4,
    `基础能力均值应稳定（${s0.baseMean.toFixed(2)}→${s50.baseMean.toFixed(2)}）`);
  assert(s50.potMean >= s0.potMean * 0.8 && s50.potMean <= s0.potMean * 1.2,
    `potential 均值不应持续退化/膨胀（${s0.potMean.toFixed(2)}→${s50.potMean.toFixed(2)}）`);
});

test('100 赛季：人口稳定、无坍缩（均值不低于初始 60%）', () => {
  const state = leagueState(8);
  const s0 = stats(state);
  new SimulationCore().advanceDays(state, 100 * 125);
  assertWorldStable(state, '100季');
  const s100 = stats(state);
  assert(s100.total >= 8 * ROSTER_CONFIG.MIN_PLAYERS && s100.total <= s0.total,
    `100 赛季后总人口应在边界区间内（${s100.total}）`);
  assert(s100.baseMean >= s0.baseMean * 0.6, `能力不应坍缩（${s0.baseMean.toFixed(2)}→${s100.baseMean.toFixed(2)}）`);
});

test('200 赛季：人口稳定、无坍缩/膨胀、无重复 ID、GK 不真空', () => {
  const state = leagueState(8);
  const s0 = stats(state);
  new SimulationCore().advanceDays(state, 200 * 125);
  assertWorldStable(state, '200季');
  const s200 = stats(state);
  assert(s200.total >= 8 * ROSTER_CONFIG.MIN_PLAYERS && s200.total <= s0.total,
    `200 赛季后总人口应在边界区间内（${s200.total}）`);
  assert(s200.baseMean >= s0.baseMean * 0.6 && s200.baseMean <= s0.baseMean * 1.4,
    `200 赛季基础能力均值应稳定（${s0.baseMean.toFixed(2)}→${s200.baseMean.toFixed(2)}）`);
  assert(s200.potMean <= s0.potMean * 1.2 + 1, `potential 均值不应持续膨胀（${s0.potMean.toFixed(2)}→${s200.potMean.toFixed(2)}）`);
});

// ========== Step 26B：Population Policy（World / Club 分离）行为测试 ==========

/** 把 src 队的前 count 名指定位置球员转入 dst 队（模拟 roster 变动，使用归属 API）。 */
function transferPlayers(state, srcClub, dstClub, position, count) {
  const ids = getTeamPlayers(state, srcClub).filter((p) => p.position === position).map((p) => p.id);
  for (let i = 0; i < count; i += 1) addPlayerMembership(state, ids[i], dstClub);
}
function rosterCount(state, clubId) {
  return getTeamPlayers(state, clubId).length;
}
function byPosition(state, clubId, position) {
  return getTeamPlayers(state, clubId).filter((p) => p.position === position).length;
}

test('A. 退役不再导致下一季精确恢复：14 → 13（边界内）不补人', () => {
  const files = makeLeagueWorldFiles(8);
  // 仅让 clb_001 的一名 FW 超龄退役（其余球员年龄 17–28，不达退役软区间）。
  files.players.find((p) => p.teamId === 'clb_001' && p.position === 'FW').birthDate = '1986-06-15';
  const state = createGameState(parseWorld(files));
  assertEquals(rosterCount(state, 'clb_001'), 14);
  new SimulationCore().advanceDays(state, 92); // 完成第 1 季并滚动
  assertEquals(rosterCount(state, 'clb_001'), 13, '13 仍在边界内（>= MIN_PLAYERS），不得补回 14');
  assertEquals(byPosition(state, 'clb_001', 'FW'), 2, 'FW 仍在位置最低保障内');
  assertEquals(Object.values(state.runtime.generated).filter((g) => g.teamId === 'clb_001').length, 0,
    '边界内不得因人口政策生成');
});

test('B. 转会兼容：卖方 13（>= MIN）不补人；买方 15（<= MAX）不裁员；跌破下限才补', () => {
  const state = leagueState(8);
  transferPlayers(state, 'clb_001', 'clb_002', 'MF', 1); // A:14→13，B:14→15
  assertEquals(rosterCount(state, 'clb_001'), 13);
  assertEquals(rosterCount(state, 'clb_002'), 15);
  const gen = replenishPopulation(state, { fromSeason: 1, toSeason: 2 });
  assertEquals(gen.length, 0, '边界内的 roster 变动不得触发人口生成');
  assertEquals(rosterCount(state, 'clb_001'), 13, '卖方不补回 14');
  assertEquals(rosterCount(state, 'clb_002'), 15, '买方不裁员');

  // 卖方跌破下限（11）才进入缺口并补位到下限。
  transferPlayers(state, 'clb_001', 'clb_002', 'DF', 2); // A:13→11
  assertEquals(rosterCount(state, 'clb_001'), 11);
  const gen2 = replenishPopulation(state, { fromSeason: 2, toSeason: 3 });
  assertEquals(gen2.length, 1, '跌破下限应补位');
  assertEquals(rosterCount(state, 'clb_001'), ROSTER_CONFIG.MIN_PLAYERS, '补到人数下限（非 preferred）');
});

test('C. 俱乐部位置缺口（0 GK）触发 GK 生成（非随机位置）', () => {
  const state = leagueState(8);
  transferPlayers(state, 'clb_001', 'clb_002', 'GK', 1); // A GK 1→0
  assertEquals(byPosition(state, 'clb_001', 'GK'), 0);
  const gen = replenishPopulation(state, { fromSeason: 1, toSeason: 2 });
  assertEquals(gen.length, 1, '应恰好生成 1 名 GK');
  const g = state.runtime.generated[gen[0]];
  assertEquals(g.position, 'GK', '生成位置应为缺失位置 GK');
  assertEquals(g.teamId, 'clb_001', '应生成给缺口俱乐部');
  assertEquals(byPosition(state, 'clb_001', 'GK'), 1);
});

test('D. 俱乐部总人数缺口（11，结构合法）触发人数补位', () => {
  const state = leagueState(8);
  transferPlayers(state, 'clb_001', 'clb_002', 'DF', 1);
  transferPlayers(state, 'clb_001', 'clb_002', 'MF', 1);
  transferPlayers(state, 'clb_001', 'clb_002', 'FW', 1);
  assertEquals(rosterCount(state, 'clb_001'), 11);
  // 结构仍合法（GK1 / DF4 / MF4 / FW2）。
  assert(byPosition(state, 'clb_001', 'GK') >= 1 && byPosition(state, 'clb_001', 'DF') >= 4
    && byPosition(state, 'clb_001', 'MF') >= 4 && byPosition(state, 'clb_001', 'FW') >= 2);
  const gen = replenishPopulation(state, { fromSeason: 1, toSeason: 2 });
  assertEquals(gen.length, 1, '总人数低于下限应补 1 人');
  assertEquals(rosterCount(state, 'clb_001'), ROSTER_CONFIG.MIN_PLAYERS);
});

test('E. 超员（> MAX）仅诊断，绝不自动裁员', () => {
  const state = leagueState(8);
  for (let i = 0; i < 11; i += 1) {
    generatePlayer(state, { position: 'MF', teamId: 'clb_001', season: 1, fromSeason: 0 });
  }
  assertEquals(rosterCount(state, 'clb_001'), 25);
  const health = evaluatePopulationHealth(state);
  assertEquals(health.clubs.clb_001.overCap, true, '25 > MAX 应产生 over-cap 诊断');
  assertEquals(health.clubs.clb_001.deficit, false, '超额不应视为缺口');
  const gen = replenishPopulation(state, { fromSeason: 1, toSeason: 2 });
  assertEquals(gen.length, 0, '超额不触发生成');
  assertEquals(rosterCount(state, 'clb_001'), 25, '绝不自动裁员');
});

test('F. PREFERRED_PLAYERS 不是硬目标：13 不因 preferred=14 而生成', () => {
  const state = leagueState(8);
  transferPlayers(state, 'clb_001', 'clb_002', 'MF', 1); // 13
  const gen = replenishPopulation(state, { fromSeason: 1, toSeason: 2 });
  assertEquals(gen.length, 0, '不得因 preferred 触发生成');
  assertEquals(rosterCount(state, 'clb_001'), 13, '不得补到 preferred(14)');
});

test('G. populationTarget 为 legacy：删除后人口评估与生成结果不变', () => {
  const withTarget = leagueState(8);
  const withoutTarget = leagueState(8);
  delete withoutTarget.runtime.populationTarget;
  for (const s of [withTarget, withoutTarget]) {
    transferPlayers(s, 'clb_001', 'clb_002', 'DF', 1);
    transferPlayers(s, 'clb_001', 'clb_002', 'MF', 1);
    transferPlayers(s, 'clb_001', 'clb_002', 'FW', 1);
  }
  assertEquals(
    JSON.stringify(evaluatePopulationHealth(withTarget).clubs.clb_001.needs),
    JSON.stringify(evaluatePopulationHealth(withoutTarget).clubs.clb_001.needs),
    '人口评估不得依赖 populationTarget',
  );
  const g1 = replenishPopulation(withTarget, { fromSeason: 1, toSeason: 2 });
  const g2 = replenishPopulation(withoutTarget, { fromSeason: 1, toSeason: 2 });
  assertEquals(g2.length, g1.length, '生成数量不得依赖 populationTarget');
  assert(g2.length >= 1, '缺失 legacy 字段仍应按缺口生成');
});

test('H. 人口补位后 membership invariant 成立：无无归属 active player', () => {
  const state = leagueState(8);
  transferPlayers(state, 'clb_001', 'clb_002', 'GK', 1);
  transferPlayers(state, 'clb_001', 'clb_002', 'DF', 2);
  replenishPopulation(state, { fromSeason: 1, toSeason: 2 });
  assertEquals(validateMembership(state).fatal, [], '不得产生致命 membership 问题');
  for (const p of getWorldPlayers(state)) {
    assert(getPlayerClub(state, p.id) != null, `${p.id} 必须归属某 club（不得生成无归属 active player）`);
  }
});

test('I. 人口评估与生成确定性：相同输入两次结果完全一致（不新增 RNG）', () => {
  const build = () => {
    const s = leagueState(8);
    transferPlayers(s, 'clb_001', 'clb_002', 'GK', 1);
    transferPlayers(s, 'clb_002', 'clb_003', 'MF', 2);
    return s;
  };
  const a = build();
  const b = build();
  assertEquals(
    JSON.stringify(evaluatePopulationHealth(a)),
    JSON.stringify(evaluatePopulationHealth(b)),
    '人口评估应确定性',
  );
  const ga = replenishPopulation(a, { fromSeason: 1, toSeason: 2 });
  const gb = replenishPopulation(b, { fromSeason: 1, toSeason: 2 });
  assertEquals(ga, gb, '生成序列应确定性');
  assertEquals(JSON.stringify(a.runtime.generated), JSON.stringify(b.runtime.generated));
  assertEquals(JSON.stringify(a.runtime.membership), JSON.stringify(b.runtime.membership));
});
