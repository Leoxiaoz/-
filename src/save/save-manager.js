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

/**
 * 反序列化存档载荷。仅做结构校验，应用（合并到运行时状态）由上层完成。
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
  if (payload.saveFormatVersion !== SAVE_FORMAT_VERSION) {
    throw new SaveError('存档格式版本不兼容', {
      context: { found: payload.saveFormatVersion, expected: SAVE_FORMAT_VERSION },
    });
  }
  if (typeof payload.worldId !== 'string' || typeof payload.currentDate !== 'string') {
    throw new SaveError('存档缺少必要字段', { context: { fields: 'worldId, currentDate' } });
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

/** localStorage 实现：骨架运行用（占位，介质未决）。 */
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