/** Simulation Core 测试：运行时状态与时间推进。 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { createGameState, getTeamsByLeague, GAME_STATE_SCHEMA_VERSION } from '../src/core/game-state.js';
import { SimulationCore, addDays } from '../src/core/simulation.js';
import { parseWorld } from '../src/data/data-loader.js';
import { makeWorldFiles } from './fixtures.js';

function world() {
  return parseWorld(makeWorldFiles());
}

test('createGameState 从世界建立运行时状态', () => {
  const state = createGameState(world());
  assertEquals(state.schemaVersion, GAME_STATE_SCHEMA_VERSION);
  assertEquals(state.worldId, 'w_test');
  assertEquals(state.currentDate, '2026-07-01');
  assertEquals(state.season, 1);
  assertEquals(state.runtime.events.length, 0);
});

test('createGameState 接受自定义日期与赛季', () => {
  const state = createGameState(world(), { date: '2027-01-01', season: 2 });
  assertEquals(state.currentDate, '2027-01-01');
  assertEquals(state.season, 2);
});

test('createGameState 在非法世界输入时抛 SimulationError', () => {
  assertThrows(() => createGameState(null), 'SimulationError');
});

test('addDays 跨月正确推进', () => {
  assertEquals(addDays('2026-07-31', 1), '2026-08-01');
  assertEquals(addDays('2026-12-31', 1), '2027-01-01');
  assertEquals(addDays('2026-07-01', 0), '2026-07-01');
});

test('addDays 拒绝非法日期格式', () => {
  assertThrows(() => addDays('not-a-date', 1), 'SimulationError');
});

test('SimulationCore.advanceDay 推进一天', () => {
  const sim = new SimulationCore();
  const state = createGameState(world());
  sim.advanceDay(state);
  assertEquals(state.currentDate, '2026-07-02');
});

test('SimulationCore.advanceDays 连续推进且可复现', () => {
  const sim = new SimulationCore();
  const a = createGameState(world());
  const b = createGameState(world());
  sim.advanceDays(a, 40);
  sim.advanceDays(b, 40);
  assertEquals(a.currentDate, b.currentDate);
  assertEquals(a.currentDate, '2026-08-10');
});

test('advanceDay 在缺少状态时抛 SimulationError', () => {
  const sim = new SimulationCore();
  assertThrows(() => sim.advanceDay(null), 'SimulationError');
});

test('getTeamsByLeague 依据静态数据过滤', () => {
  const state = createGameState(world());
  assertEquals(getTeamsByLeague(state, 'lg_a').length, 1);
  assertEquals(getTeamsByLeague(state, 'lg_missing').length, 0);
});