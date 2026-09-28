/**
 * Game Controller（游戏控制器）。
 * 层级归属：Controller 层，是 UI 与核心之间的**唯一协调者**（组合根使用）。
 *
 * 职责：
 * - 编排 Data Layer（加载世界）、Simulation Core（推进）、Save Layer（读写）；
 * - 持有当前 Game State；
 * - 向 UI 提供只读快照与订阅通知。
 *
 * 约束（对应 game-architecture Skill）：
 * - 不实现任何模拟规则（规则在 Simulation Core）；
 * - 不直接操作 DOM；
 * - UI 不得绕过本控制器直接访问 Core / Data / Save。
 */

import { createGameState } from '../core/game-state.js';
import { AppError } from '../shared/errors.js';

export class GameController {
  /**
   * @param {{dataLoader: object, saveManager: object, simulation: object, logger?: object}} deps
   */
  constructor(deps) {
    if (!deps?.dataLoader || !deps?.saveManager || !deps?.simulation) {
      throw new AppError('GameController 需要 dataLoader / saveManager / simulation 依赖', {
        context: { has: Object.keys(deps ?? {}) },
      });
    }
    this.dataLoader = deps.dataLoader;
    this.saveManager = deps.saveManager;
    this.simulation = deps.simulation;
    this.logger = deps.logger ?? null;

    /** @type {object|null} 当前运行时状态 */
    this.state = null;
    /** @type {object|null} 已加载的静态世界 */
    this.world = null;
    this.worldDir = null;
    this.listeners = new Set();
  }

  /** 订阅状态变化；返回取消订阅函数。 */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit() {
    for (const listener of this.listeners) listener(this.getSnapshot());
  }

  /** @returns {object|null} */
  getState() {
    return this.state;
  }

  /** 面向 UI 的只读快照（UI 不直接接触内部结构）。 */
  getSnapshot() {
    if (!this.state) return null;
    const { static: world, runtime } = this.state;
    return {
      worldId: this.state.worldId,
      worldName: world.manifest.name,
      currentDate: this.state.currentDate,
      season: this.state.season,
      teamsCount: world.teams.length,
      playersCount: world.players.length,
      eventsCount: runtime.events.length,
      leagues: world.leagues.map((l) => ({
        id: l.id,
        name: l.name,
        teamsCount: world.teams.filter((t) => t.leagueId === l.id).length,
      })),
    };
  }

  /**
   * 开新档：加载世界 → 建立运行时状态。
   * @param {string} worldDir
   * @param {{date?: string, season?: number}} [options]
   */
  async startNewGame(worldDir, options = {}) {
    this.world = await this.dataLoader.loadWorld(worldDir);
    this.worldDir = worldDir;
    this.state = createGameState(this.world, options);
    this.logger?.info?.(`新世界已建立：${this.state.worldId} @ ${this.state.currentDate}`);
    this.#emit();
    return this.state;
  }

  /** 推进模拟时间（规则由 Simulation Core 负责）。 */
  tick() {
    this.#requireRunning();
    this.simulation.advanceDay(this.state);
    this.#emit();
    return this.state;
  }

  /**
   * 保存到存档槽。
   * @param {string} [slot]
   */
  async save(slot = 'slot1') {
    this.#requireRunning();
    await this.saveManager.save(slot, this.state);
    this.logger?.info?.(`已保存到存档槽 ${slot}`);
    return slot;
  }

  /**
   * 从存档槽读取。存档只含「引用 + 增量」，因此需要当前世界重新构建运行时状态，
   * 再叠加增量（对应 SAVE_SPEC §3）。这里**不**更换数据库，也不覆盖世界。
   * @param {string} [slot]
   */
  async load(slot = 'slot1') {
    const payload = await this.saveManager.load(slot);
    if (!this.world) {
      throw new AppError('读取存档前需要先加载一个世界', { context: { slot } });
    }
    if (payload.worldId !== this.world.manifest.id) {
      throw new AppError('存档所属世界与当前世界不一致', {
        context: { saveWorld: payload.worldId, currentWorld: this.world.manifest.id },
      });
    }
    this.state = createGameState(this.world, {
      date: payload.currentDate,
      season: payload.season,
    });
    this.state.runtime = payload.runtime ?? this.state.runtime;
    this.logger?.info?.(`已读取存档槽 ${slot}`);
    this.#emit();
    return this.state;
  }

  async listSaves() {
    return this.saveManager.list();
  }

  #requireRunning() {
    if (!this.state) {
      throw new AppError('当前没有运行中的世界，请先开始新游戏');
    }
  }
}