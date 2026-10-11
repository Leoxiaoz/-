/**
 * 球员运行时状态测试（第 15 步）。
 * 覆盖：创建 / 读取 / 修改 / 保存加载往返；静态库不被运行时修改；
 * 有效属性派生；出场统计、本赛季/职业生涯分离；伤病、体能/状态/士气接口；
 * 向后兼容（旧档补齐且不覆盖已有值）。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { createGameState, GAME_STATE_SCHEMA_VERSION } from '../src/core/game-state.js';
import {
  createPlayerRuntime,
  initializePlayerRuntime,
  getPlayerRuntime,
  getEffectiveAttributes,
  recordAppearance,
  setVitals,
  applyInjury,
  recoverInjury,
  applyAbilityDelta,
  resetSeasonStats,
  INJURY_STATUS,
} from '../src/core/player-runtime.js';
import { SimulationCore } from '../src/core/simulation.js';
import { parseWorld } from '../src/data/data-loader.js';
import { serializeState, deserializeState, MemorySaveManager } from '../src/save/save-manager.js';
import { makeLeagueWorldFiles } from './fixtures.js';

const PLAYER = 'ply_001'; // 8 队夹具中的第一名球员

function newState() {
  return createGameState(parseWorld(makeLeagueWorldFiles(8)));
}

function deepFreeze(obj) {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}

test('createGameState 为全部静态球员建立运行时状态，且 schema 版本为 2', () => {
  const state = newState();
  assertEquals(state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
  assertEquals(Object.keys(state.runtime.players).length, state.static.players.length);
  const rt = getPlayerRuntime(state, PLAYER);
  assert(rt, '应存在球员运行时状态');
  assertEquals(rt.playerId, PLAYER);
  assertEquals(rt.stats.season, { appearances: 0, minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0, shots: 0, shotsOnTarget: 0, ratingSum: 0 });
  assertEquals(rt.injury.status, INJURY_STATUS.FIT);
});

test('createPlayerRuntime 需要非空 playerId', () => {
  assertThrows(() => createPlayerRuntime(''), 'SimulationError');
  assertThrows(() => createPlayerRuntime(null), 'SimulationError');
});

test('运行时状态不复制静态属性，只存增减结构', () => {
  const state = newState();
  const rt = getPlayerRuntime(state, PLAYER);
  assertEquals(rt.ability.deltas, {});
  assert(!('pace' in rt), '运行时不应冗余复制静态属性');
  assert(!('birthDate' in rt), '运行时不应持有静态信息');
});

test('getEffectiveAttributes 返回完整属性向量（非单一总评）', () => {
  const state = newState();
  const attrs = getEffectiveAttributes(state, PLAYER);
  for (const key of ['pace', 'technique', 'passing', 'defending', 'finishing', 'goalkeeping']) {
    assert(typeof attrs[key] === 'number', `应包含属性 ${key}`);
  }
});

test('applyAbilityDelta 影响有效属性但不改静态基础属性，且越界被潜力上限/下限夹取', () => {
  const state = newState();
  const player = state.static.players.find((p) => p.id === PLAYER);
  const before = player.pace;
  const cap = player.potential.pace; // 每属性潜力上限（A2）
  applyAbilityDelta(state, PLAYER, 'pace', 5);
  assertEquals(getEffectiveAttributes(state, PLAYER).pace, before + 5);
  assertEquals(state.static.players.find((p) => p.id === PLAYER).pace, before, '静态基础属性不得被修改');

  applyAbilityDelta(state, PLAYER, 'pace', 999); // 强推越界
  assertEquals(getEffectiveAttributes(state, PLAYER).pace, cap, '有效属性应夹取到该属性潜力上限');

  applyAbilityDelta(state, PLAYER, 'pace', -9999); // 再强推越下界（增减量累积存储）
  assertEquals(getEffectiveAttributes(state, PLAYER).pace, 1, '有效属性应夹取到下限 1');
});

test('applyAbilityDelta 拒绝非法属性名与非数值增减', () => {
  const state = newState();
  assertThrows(() => applyAbilityDelta(state, PLAYER, 'not_an_attr', 1), 'SimulationError');
  assertThrows(() => applyAbilityDelta(state, PLAYER, 'pace', 'x'), 'SimulationError');
});

test('recordAppearance 同时累加本赛季与职业生涯统计', () => {
  const state = newState();
  recordAppearance(state, PLAYER, { minutes: 90, goals: 2, assists: 1 });
  recordAppearance(state, PLAYER, { minutes: 45, goals: 0, assists: 1 });
  const rt = getPlayerRuntime(state, PLAYER);
  assertEquals(rt.stats.season, { appearances: 2, minutes: 135, goals: 2, assists: 2, yellow: 0, red: 0, shots: 0, shotsOnTarget: 0, ratingSum: 0 });
  assertEquals(rt.stats.career, { appearances: 2, minutes: 135, goals: 2, assists: 2, yellow: 0, red: 0, shots: 0, shotsOnTarget: 0, ratingSum: 0 });
});

test('recordAppearance 拒绝非法数值与超限分钟', () => {
  const state = newState();
  assertThrows(() => recordAppearance(state, PLAYER, { minutes: -1 }), 'SimulationError');
  assertThrows(() => recordAppearance(state, PLAYER, { goals: 1.5 }), 'SimulationError');
  assertThrows(() => recordAppearance(state, PLAYER, { minutes: 999 }), 'SimulationError');
});

test('setVitals 设置体能/状态/士气并夹取到 0–100', () => {
  const state = newState();
  setVitals(state, PLAYER, { fitness: 30, form: 80, morale: 70 });
  const rt = getPlayerRuntime(state, PLAYER);
  assertEquals([rt.fitness, rt.form, rt.morale], [30, 80, 70]);
  setVitals(state, PLAYER, { fitness: 500, morale: -50 });
  assertEquals(rt.fitness, 100);
  assertEquals(rt.morale, 0);
  assertEquals(rt.form, 80, '未提供的项不应被改动');
});

test('伤病接口：施加后可读取，恢复后归位', () => {
  const state = newState();
  applyInjury(state, PLAYER, { type: 'hamstring', daysRemaining: 21 });
  let rt = getPlayerRuntime(state, PLAYER);
  assertEquals(rt.injury.status, INJURY_STATUS.INJURED);
  assertEquals(rt.injury.daysRemaining, 21);
  assertEquals(rt.injury.since, state.currentDate);
  recoverInjury(state, PLAYER);
  rt = getPlayerRuntime(state, PLAYER);
  assertEquals(rt.injury.status, INJURY_STATUS.FIT);
  assertEquals(rt.injury.daysRemaining, 0);
});

test('resetSeasonStats 只清本赛季、保留职业生涯', () => {
  const state = newState();
  recordAppearance(state, PLAYER, { minutes: 90, goals: 1 });
  resetSeasonStats(state, 2);
  const rt = getPlayerRuntime(state, PLAYER);
  assertEquals(rt.stats.season, { appearances: 0, minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0, shots: 0, shotsOnTarget: 0, ratingSum: 0 });
  assertEquals(rt.stats.seasonNumber, 2);
  assertEquals(rt.stats.career.appearances, 1, '职业生涯统计应保留');
});

test('未找到运行时球员时抛 SimulationError（可定位）', () => {
  const state = newState();
  assertThrows(() => recordAppearance(state, 'ply_missing', { minutes: 1 }), 'SimulationError');
});

test('initializePlayerRuntime 幂等且保留已有值', () => {
  const state = newState();
  recordAppearance(state, PLAYER, { minutes: 60, goals: 1 });
  setVitals(state, PLAYER, { morale: 88 });
  initializePlayerRuntime(state); // 再次调用不应重置
  const rt = getPlayerRuntime(state, PLAYER);
  assertEquals(rt.stats.career.appearances, 1);
  assertEquals(rt.morale, 88);
});

test('initializePlayerRuntime 为旧档补齐缺失字段且不覆盖已有值（向后兼容 A5）', () => {
  const state = newState();
  // 模拟旧档：players 里只有一条不完整记录
  state.runtime.players = { [PLAYER]: { playerId: PLAYER, morale: 42 } };
  initializePlayerRuntime(state);
  const rt = getPlayerRuntime(state, PLAYER);
  assertEquals(rt.morale, 42, '已有值必须保留');
  assertEquals(rt.fitness, 100, '缺失字段应补默认');
  assertEquals(rt.stats.career.appearances, 0);
  // 其余球员也被补齐
  assertEquals(Object.keys(state.runtime.players).length, state.static.players.length);
});

test('静态数据库不会被运行时修改（深度冻结后仍可正常操作）', () => {
  const state = newState();
  const originalFinishing = state.static.players.find((p) => p.id === PLAYER).finishing;
  const staticSnapshot = JSON.stringify(state.static.players);
  deepFreeze(state.static); // 若运行时写入静态库，将抛 TypeError
  // 以下操作只会写 runtime，不应触碰 static
  applyAbilityDelta(state, PLAYER, 'finishing', 10);
  recordAppearance(state, PLAYER, { minutes: 90, goals: 3 });
  setVitals(state, PLAYER, { form: 60 });
  applyInjury(state, PLAYER, { daysRemaining: 5 });
  recoverInjury(state, PLAYER);
  const sim = new SimulationCore();
  sim.advanceDays(state, 92); // 完整赛季推进 + 滚动（含 resetSeasonStats）
  assertEquals(state.static.players.find((p) => p.id === PLAYER).finishing, originalFinishing);
  assertEquals(JSON.stringify(state.static.players), staticSnapshot, '整份静态球员数据应逐字节不变');
});

test('存档往返：球员运行时状态完整保留（保存→加载）', async () => {
  const mgr = new MemorySaveManager();
  const state = newState();
  applyAbilityDelta(state, PLAYER, 'passing', 7);
  recordAppearance(state, PLAYER, { minutes: 90, goals: 2, assists: 1 });
  setVitals(state, PLAYER, { fitness: 70, form: 65, morale: 55 });
  applyInjury(state, PLAYER, { type: 'knock', daysRemaining: 7 });

  await mgr.save('slot1', state);
  const payload = await mgr.load('slot1');
  const loaded = createGameState(state.static, { date: payload.currentDate, season: payload.season });
  loaded.runtime = payload.runtime;
  initializePlayerRuntime(loaded);

  const rt = getPlayerRuntime(loaded, PLAYER);
  assertEquals(rt.ability.deltas, { passing: 7 });
  assertEquals(rt.stats.career, { appearances: 1, minutes: 90, goals: 2, assists: 1, yellow: 0, red: 0, shots: 0, shotsOnTarget: 0, ratingSum: 0 });
  assertEquals([rt.fitness, rt.form, rt.morale], [70, 65, 55]);
  assertEquals(rt.injury.status, INJURY_STATUS.INJURED);
  assertEquals(rt.injury.daysRemaining, 7);
  assertEquals(getEffectiveAttributes(loaded, PLAYER).passing,
    getEffectiveAttributes(state, PLAYER).passing);
});

test('存档不含整份静态库，只含球员运行时增量', () => {
  const state = newState();
  const payload = serializeState(state);
  assert(!('static' in payload), '存档不得复制静态世界');
  assert(payload.runtime.players !== undefined, '存档应包含球员运行时增量');
  const one = payload.runtime.players[PLAYER];
  assert(!('pace' in one) && !('name' in one), '球员运行时不应复制静态字段');
});

test('赛季滚动时本赛季统计归零、职业生涯统计保留（多赛季）', () => {
  const sim = new SimulationCore();
  const state = newState();
  recordAppearance(state, PLAYER, { minutes: 90, goals: 1 });
  sim.advanceDays(state, 92); // 完成第 1 赛季并滚动
  const rt = getPlayerRuntime(state, PLAYER);
  assert(state.season >= 2, '应已滚动赛季');
  assertEquals(rt.stats.seasonNumber, state.season);
  assertEquals(rt.stats.season.appearances, 0, '本赛季统计应已重置');
  // 第 18 步起比赛自动记出场，故职业生涯统计为「种子值 + 本赛季真实出场」，只校验其被保留。
  assert(rt.stats.career.appearances >= 1, '职业生涯统计应保留');
});

test('deserializeState 兜底后不会误伤球员容器（向后兼容）', () => {
  const payload = deserializeState({
    saveFormatVersion: 1,
    worldId: 'w_league',
    currentDate: '2026-07-01',
  });
  assertEquals(payload.runtime.players, {});
  // 补齐流程在 controller 层；此处验证容器存在即可
  assert(payload.runtime.players !== undefined);
});