/**
 * Save Layer（存档读写）。
 * 层级归属：Save Layer。只负责运行时状态的持久化，**不含游戏逻辑**，**不依赖 UI**。
 *
 * 与数据库的关系（SAVE_SPEC §3/§4）：
 * - 存档只保存**引用（worldId）+ 增量（runtime）**，不复制整份数据库；
 * - 更换数据库不得自动覆盖存档（此处仅保存 worldId 供上层比对，不在此处做策略）。
 *
 * 存储介质说明：localStorage vs IndexedDB 属**未决项**（Architecture Review A7），
 * 故此处同时提供内存实现（测试用）与 localStorage 实现（骨架运行用，占位）。
 */

import { SaveError } from '../shared/errors.js';
import { createMembership } from '../core/membership.js';

/** 存档格式版本（独立于数据库格式与运行时 schema）。 */
export const SAVE_FORMAT_VERSION = 1;

/**
 * 把运行时状态序列化为可持久化的存档载荷（引用 + 增量）。
 * @param {object} state
 * @returns {object}
 */
export function serializeState(state) {
  if (!state || typeof state.worldId !== 'string') {
    throw new SaveError('serializeState 需要包含 worldId 的运行时状态');
  }
  return {
    saveFormatVersion: SAVE_FORMAT_VERSION,
    stateSchemaVersion: state.schemaVersion,
    worldId: state.worldId,
    currentDate: state.currentDate,
    season: state.season,
    runtime: state.runtime,
  };
}

/** 迁移函数表：把版本 N 的存档升级到 N+1（当前仅 v1，故为空）。 */
const MIGRATIONS = {
  // 0: (payload) => ({ ...payload, saveFormatVersion: 1 }),
};

/**
 * 反序列化存档载荷。仅做结构校验与缺省兜底；应用到运行时状态由上层完成。
 * 版本策略（决策 A5）：向后兼容——低版本可迁移，高版本拒绝。
 * @param {object|string} raw
 * @returns {object} 存档载荷
 */
export function deserializeState(raw) {
  let payload = raw;
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw);
    } catch (cause) {
      throw new SaveError('存档不是合法 JSON', { cause });
    }
  }
  if (!payload || typeof payload !== 'object') {
    throw new SaveError('存档内容为空或格式错误');
  }

  let version = payload.saveFormatVersion;
  if (typeof version !== 'number') {
    throw new SaveError('存档缺少格式版本', { context: { field: 'saveFormatVersion' } });
  }
  if (version > SAVE_FORMAT_VERSION) {
    throw new SaveError('存档来自更新的版本，当前引擎无法读取', {
      context: { found: version, supported: SAVE_FORMAT_VERSION },
    });
  }
  while (version < SAVE_FORMAT_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      throw new SaveError('缺少存档迁移函数', { context: { from: version, to: SAVE_FORMAT_VERSION } });
    }
    payload = migrate(payload);
    version = payload.saveFormatVersion;
  }

  if (typeof payload.worldId !== 'string' || typeof payload.currentDate !== 'string') {
    throw new SaveError('存档缺少必要字段', { context: { fields: 'worldId, currentDate' } });
  }

  // 缺省兜底（SAVE_SPEC §3：缺省字段必须有兜底）
  if (typeof payload.season !== 'number') payload.season = 1;
  if (!payload.runtime || typeof payload.runtime !== 'object') {
    payload.runtime = { clubs: {}, players: {}, competitions: {}, events: [] };
  } else {
    payload.runtime.clubs ??= {};
    payload.runtime.players ??= {};
    payload.runtime.competitions ??= {};
    payload.runtime.events ??= [];
    // 玩家管理球队（第 20 步；旧档兜底为 null，clubs[].lineup 由 initializeClubRuntime 补齐）。
    payload.runtime.managedClubId ??= null;
    // 运行期成员关系层（G0；旧档兜底为空容器，实际内容由 initializeMembership 从静态/新生代种子建立）。
    if (!payload.runtime.membership || typeof payload.runtime.membership !== 'object') {
      payload.runtime.membership = createMembership();
    } else {
      if (!payload.runtime.membership.players || typeof payload.runtime.membership.players !== 'object') {
        payload.runtime.membership.players = {};
      }
      if (!payload.runtime.membership.clubs || typeof payload.runtime.membership.clubs !== 'object') {
        payload.runtime.membership.clubs = {};
      }
    }
    // 球员生命周期容器（第 19 步；旧档兜底为空/零，populationTarget 由 initializePlayerRuntime 依据世界补齐）
    payload.runtime.generated ??= {};
    payload.runtime.retired ??= {};
    if (!Number.isInteger(payload.runtime.nextGeneratedSeq) || payload.runtime.nextGeneratedSeq < 0) {
      payload.runtime.nextGeneratedSeq = 0;
    }
  }
  return payload;
}

/** 存档管理器接口（未来 IndexedDB / 云端实现应遵循同一契约）。 */
export class SaveManager {
  /** @param {string} _slot @param {object} _state */
  async save(_slot, _state) {
    throw new SaveError('SaveManager.save 未实现');
  }
  /** @param {string} _slot */
  async load(_slot) {
    throw new SaveError('SaveManager.load 未实现');
  }
  /** @returns {Promise<string[]>} */
  async list() {
    return [];
  }
  /** @param {string} _slot */
  async remove(_slot) {}
}

/** 内存实现：用于测试与临时运行。 */
export class MemorySaveManager extends SaveManager {
  constructor() {
    super();
    this.slots = new Map();
  }
  async save(slot, state) {
    this.slots.set(slot, serializeState(state));
  }
  async load(slot) {
    if (!this.slots.has(slot)) throw new SaveError('存档槽不存在', { context: { slot } });
    return deserializeState(this.slots.get(slot));
  }
  async list() {
    return [...this.slots.keys()];
  }
  async remove(slot) {
    this.slots.delete(slot);
  }
}

/** localStorage 实现：轻量回退（A7 决策下仅作降级备用）。 */
export class LocalStorageSaveManager extends SaveManager {
  /** @param {{storage?: Storage, prefix?: string}} [config] */
  constructor(config = {}) {
    super();
    this.storage = config.storage ?? globalThis.localStorage;
    this.prefix = config.prefix ?? 'fms:save:';
    if (!this.storage) {
      throw new SaveError('当前环境没有可用的 localStorage');
    }
  }
  async save(slot, state) {
    this.storage.setItem(this.prefix + slot, JSON.stringify(serializeState(state)));
  }
  async load(slot) {
    const raw = this.storage.getItem(this.prefix + slot);
    if (raw == null) throw new SaveError('存档槽不存在', { context: { slot } });
    return deserializeState(raw);
  }
  async list() {
    const slots = [];
    for (let i = 0; i < this.storage.length; i += 1) {
      const key = this.storage.key(i);
      if (key && key.startsWith(this.prefix)) slots.push(key.slice(this.prefix.length));
    }
    return slots;
  }
  async remove(slot) {
    this.storage.removeItem(this.prefix + slot);
  }
}

/**
 * IndexedDB 实现（决策 A7：存档主介质）。
 * 适配多槽、长存档与移动端容量需求；通过注入 `indexedDB` 便于在测试中替换。
 */
export class IndexedDbSaveManager extends SaveManager {
  /**
   * @param {{indexedDB?: IDBFactory, dbName?: string, storeName?: string, version?: number}} [config]
   */
  constructor(config = {}) {
    super();
    this.idb = config.indexedDB ?? globalThis.indexedDB;
    this.dbName = config.dbName ?? 'fms';
    this.storeName = config.storeName ?? 'saves';
    this.version = config.version ?? 1;
    if (!this.idb) {
      throw new SaveError('当前环境没有可用的 IndexedDB');
    }
    this.#dbPromise = null;
  }

  #dbPromise;

  #open() {
    if (!this.#dbPromise) {
      this.#dbPromise = new Promise((resolve, reject) => {
        const req = this.idb.open(this.dbName, this.version);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new SaveError('打开 IndexedDB 失败', { cause: req.error }));
      });
    }
    return this.#dbPromise;
  }

  async #tx(mode, fn) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, mode);
      const store = tx.objectStore(this.storeName);
      let result;
      try {
        result = fn(store);
      } catch (cause) {
        reject(new SaveError('存档事务执行失败', { cause }));
        return;
      }
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(new SaveError('存档事务失败', { cause: tx.error }));
    });
  }

  async save(slot, state) {
    const payload = serializeState(state);
    await this.#tx('readwrite', (store) => store.put(payload, slot));
  }

  async load(slot) {
    const payload = await this.#tx('readonly', (store) => store.get(slot));
    if (payload == null) throw new SaveError('存档槽不存在', { context: { slot } });
    return deserializeState(payload);
  }

  async list() {
    const keys = await this.#tx('readonly', (store) => store.getAllKeys());
    return (keys ?? []).map(String);
  }

  async remove(slot) {
    await this.#tx('readwrite', (store) => store.delete(slot));
  }
}