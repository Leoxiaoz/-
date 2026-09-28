/**
 * Game State（运行时世界状态模型）。
 * 层级归属：Simulation Core 层。纯数据与纯函数，**不依赖 DOM**、不读写存储。
 *
 * 分离原则（决策 A3 / DATABASE_SPEC §4）：
 * - `static` 只**引用**已加载的数据库世界（只读），不复制，避免与数据库真相漂移；
 * - `runtime` 只保存**相对数据库的增量**，是存档需要持久化的部分。
 *   判据：不随时间变化 → 库；随时间变化 → 档。
 */

import { SimulationError } from '../shared/errors.js';

/** 运行时状态结构的版本号（与存档格式、数据库格式相互独立）。 */
export const GAME_STATE_SCHEMA_VERSION = 1;

/**
 * 基于已加载的静态世界，创建一个最小运行时状态。
 * @param {object} world 由 data 层加载并校验通过的世界数据
 * @param {{date?: string, season?: number}} [options]
 */
export function createGameState(world, options = {}) {
  if (!world || !world.manifest || !Array.isArray(world.teams)) {
    throw new SimulationError('createGameState 需要一个已加载并校验的世界数据对象', {
      context: { received: typeof world },
    });
  }

  const date = options.date ?? world.manifest.startDate ?? '2026-07-01';
  const season = options.season ?? 1;

  return {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    worldId: world.manifest.id,
    currentDate: date,
    season,
    static: world,
    runtime: {
      // 仅保存相对数据库的增量；本阶段为空壳，待相应系统设计完成后再填充
      clubs: {},        // clubId -> { ... } 运行时俱乐部状态（财政/战术等）
      players: {},      // playerId -> { ... } 运行时球员状态（能力/状态/伤病等）
      competitions: {}, // competitionId -> { 赛程/结果/进度 }（决策 A1：结果与赛程归存档）
      events: [],       // 世界事件/日志（最小占位，非新闻系统）
    },
  };
}

/** 按 id 取静态球队。 */
export function getTeam(state, teamId) {
  return state.static.teams.find((t) => t.id === teamId) ?? null;
}

/** 按 id 取静态联赛。 */
export function getLeague(state, leagueId) {
  return state.static.leagues.find((l) => l.id === leagueId) ?? null;
}

/** 取某联赛下的球队（基于静态数据）。 */
export function getTeamsByLeague(state, leagueId) {
  return state.static.teams.filter((t) => t.leagueId === leagueId);
}

/** 追加一条运行时事件（最小日志用途，不是新闻系统）。 */
export function recordEvent(state, type, payload = {}) {
  state.runtime.events.push({ date: state.currentDate, type, payload });
}