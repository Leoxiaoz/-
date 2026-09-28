/** Save Layer 测试：序列化契约与存档槽读写。 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { createGameState, recordEvent } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import {
  serializeState,
  deserializeState,
  MemorySaveManager,
  SAVE_FORMAT_VERSION,
} from '../src/save/save-manager.js';
import { makeWorldFiles } from './fixtures.js';

function newState() {
  return createGameState(parseWorld(makeWorldFiles()));
}

test('serializeState 只包含引用 + 增量，不含整份数据库', () => {
  const payload = serializeState(newState());
  assertEquals(payload.worldId, 'w_test');
  assertEquals(payload.saveFormatVersion, SAVE_FORMAT_VERSION);
  assert(!('static' in payload), '存档不应复制静态世界');
  assert(!('teams' in payload), '存档不应包含数据库实体数组');
});

test('serialize/deserialize 往返一致', () => {
  const state = newState();
  recordEvent(state, 'test', { n: 1 });
  const payload = deserializeState(serializeState(state));
  assertEquals(payload.currentDate, state.currentDate);
  assertEquals(payload.runtime.events.length, 1);
});

test('deserializeState 拒绝不兼容的存档版本', () => {
  const payload = { ...serializeState(newState()), saveFormatVersion: 999 };
  assertThrows(() => deserializeState(payload), 'SaveError');
});

test('deserializeState 拒绝损坏的 JSON', () => {
  assertThrows(() => deserializeState('{ not json'), 'SaveError');
});

test('MemorySaveManager 可保存、读取、列出与删除', async () => {
  const mgr = new MemorySaveManager();
  const state = newState();
  await mgr.save('slot1', state);
  const list = await mgr.list();
  assertEquals(list, ['slot1']);
  const payload = await mgr.load('slot1');
  assertEquals(payload.worldId, 'w_test');
  await mgr.remove('slot1');
  assertEquals(await mgr.list(), []);
});

test('MemorySaveManager 读取不存在的槽会抛 SaveError', async () => {
  const mgr = new MemorySaveManager();
  let threw = false;
  try {
    await mgr.load('nope');
  } catch (err) {
    threw = err.name === 'SaveError';
  }
  assert(threw, '应抛出 SaveError');
});