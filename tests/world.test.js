/** Data Layer 测试：世界解析与校验。 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { parseWorld, validateWorld, WORLD_FORMAT } from '../src/data/data-loader.js';
import { makeWorldFiles } from './fixtures.js';

test('parseWorld 接受合法数据并保留各实体', () => {
  const world = parseWorld(makeWorldFiles());
  assertEquals(world.manifest.id, 'w_test');
  assertEquals(world.teams.length, 1);
  assertEquals(world.players.length, 1);
});

test('parseWorld 在缺少 manifest 时抛 DataError', () => {
  assertThrows(() => parseWorld({ ...makeWorldFiles(), manifest: null }), 'DataError');
});

test('validateWorld 拒绝不支持的格式', () => {
  const files = makeWorldFiles();
  files.manifest.format = 'unknown-format';
  assertThrows(() => parseWorld(files), 'DataError');
});

test('validateWorld 拒绝重复 id', () => {
  const files = makeWorldFiles();
  files.teams.push({ id: 'clb_a', name: 'Duplicate', leagueId: 'lg_a' });
  assertThrows(() => parseWorld(files), 'DataError');
});

test('validateWorld 拒绝悬空的联赛引用（countryId）', () => {
  const files = makeWorldFiles();
  files.leagues[0].countryId = 'cty_missing';
  assertThrows(() => parseWorld(files), 'DataError');
});

test('validateWorld 拒绝悬空的球员引用（teamId）', () => {
  const files = makeWorldFiles();
  files.players[0].teamId = 'clb_missing';
  assertThrows(() => parseWorld(files), 'DataError');
});

test('validateWorld 的错误信息包含定位上下文', () => {
  const files = makeWorldFiles();
  files.managers = undefined;
  files.leagues[0].countryId = 'cty_missing';
  let error = null;
  try {
    parseWorld(files);
  } catch (err) {
    error = err;
  }
  assert(error, '应抛出错误');
  assert(typeof error.context?.file === 'string', '错误应包含 file 定位');
  assertEquals(error.context.file, 'leagues.json');
});

test('WORLD_FORMAT 为占位格式标识', () => {
  assertEquals(WORLD_FORMAT, 'fdb-json-0');
});