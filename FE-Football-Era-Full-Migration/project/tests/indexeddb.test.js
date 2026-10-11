/**
 * IndexedDB 存档实现测试（决策 A7）。
 * Node 无 IndexedDB，故本文件内置一个最小 fake IndexedDB 用于验证契约。
 * 说明：fake 只实现本实现用到的最小 API（open / transaction / objectStore / put|get|delete|getAllKeys）。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { IndexedDbSaveManager, deserializeState } from '../src/save/save-manager.js';
import { makeWorldFiles } from './fixtures.js';

/** 最小 fake：仅实现被测代码调用的同步部分 + 事务完成回调。 */
function makeFakeIndexedDB() {
  const data = new Map();
  function makeStore() {
    return {
      put: (value, key) => { data.set(key, value); return { result: key }; },
      get: (key) => ({ result: data.has(key) ? data.get(key) : undefined }),
      delete: (key) => { data.delete(key); return { result: undefined }; },
      getAllKeys: () => ({ result: [...data.keys()] }),
    };
  }
  return {
    open() {
      const req = { result: {}, error: null };
      const db = {
        objectStoreNames: { contains: () => false },
        createObjectStore() {},
        transaction: () => {
          const store = makeStore();
          const tx = { error: null, oncomplete: null, onerror: null, objectStore: () => store };
          // 模拟异步事务完成
          queueMicrotask(() => tx.oncomplete?.());
          return tx;
        },
      };
      req.result = db;
      queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    },
  };
}

function mgr() {
  return new IndexedDbSaveManager({ indexedDB: makeFakeIndexedDB(), dbName: 'test', storeName: 'saves' });
}

function newState() {
  return createGameState(parseWorld(makeWorldFiles()));
}

test('IndexedDbSaveManager 保存后可读取并往返一致', async () => {
  const m = mgr();
  const state = newState();
  await m.save('slot1', state);
  const payload = await m.load('slot1');
  assertEquals(payload.worldId, 'w_test');
  assertEquals(payload.currentDate, state.currentDate);
});

test('IndexedDbSaveManager 列出与删除存档槽', async () => {
  const m = mgr();
  await m.save('a', newState());
  await m.save('b', newState());
  const list = (await m.list()).sort();
  assertEquals(list, ['a', 'b']);
  await m.remove('a');
  assertEquals(await m.list(), ['b']);
});

test('IndexedDbSaveManager 读取不存在槽抛 SaveError', async () => {
  const m = mgr();
  let threw = false;
  try {
    await m.load('missing');
  } catch (err) {
    threw = err.name === 'SaveError';
  }
  assert(threw, '应抛出 SaveError');
});

test('IndexedDbSaveManager 在无 IndexedDB 环境构造失败', () => {
  let threw = false;
  try {
    // eslint-disable-next-line no-new
    new IndexedDbSaveManager({ indexedDB: undefined });
  } catch (err) {
    threw = err.name === 'SaveError';
  }
  assert(threw, '应抛出 SaveError');
});

test('IndexedDb 存的是引用+增量，不含静态世界', async () => {
  const m = mgr();
  await m.save('s', newState());
  const payload = await m.load('s');
  const keys = Object.keys(deserializeState(payload));
  assert(!keys.includes('static'), '不得持久化 static');
  assert(!keys.includes('teams'), '不得持久化数据库实体数组');
});