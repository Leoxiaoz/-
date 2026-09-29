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
import { generateDoubleRoundRobin } from './schedule.js';
import { createTable } from './standings.js';
import { createPlayerRuntime } from './player-runtime.js';
import { DEFAULT_FORMATION, SCHEDULE_CONFIG } from './sim-config.js';

/**
 * 运行时状态结构的版本号（与存档格式、数据库格式相互独立）。
 * v2（第 15 步）：`runtime.players` 由占位改为**已定义的球员运行时状态**结构（player-runtime.js）。
 * v3（第 16 步）：球员运行时新增 `growth`（成长结算元数据）。均为**加法式**变更，
 * 旧档经 `initializePlayerRuntime` 自动补齐，非破坏性。
 */
export const GAME_STATE_SCHEMA_VERSION = 3;

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

  const state = {
    schemaVersion: GAME_STATE_SCHEMA_VERSION,
    worldId: world.manifest.id,
    currentDate: date,
    season,
    static: world,
    runtime: {
      // 仅保存相对数据库的增量
      clubs: {},        // clubId -> 运行时俱乐部状态（战术等；财政/成长属未来阶段）
      players: {},      // playerId -> 球员运行时状态（第 15 步，见 player-runtime.js）
      competitions: {}, // competitionId -> { 赛程/结果/积分 }（决策 A1：结果与赛程归存档）
      events: [],       // 世界事件/日志（最小占位，非新闻系统）
    },
  };

  // 初始化球队运行时（战术取自静态数据，缺省用默认；两者都可有真实模拟后果）。
  for (const team of world.teams) {
    state.runtime.clubs[team.id] = {
      tactics: {
        formation: team.formation ?? DEFAULT_FORMATION,
        mentality: team.mentality ?? 'balanced',
      },
    };
  }

  // 初始化球员运行时状态（只建增量结构，不复制静态属性；第 15 步）。
  for (const player of world.players) {
    state.runtime.players[player.id] = createPlayerRuntime(player.id, { seasonNumber: season });
  }

  // 初始化各联赛赛程与积分（决策 A1：赛程由规则生成、结果归运行时）。
  for (const league of world.leagues) {
    state.runtime.competitions[league.id] = createLeagueRuntime(state, league.id);
  }

  return state;
}

/**
 * 为一个联赛建立赛季运行时（赛程 + 空积分榜）。
 * @param {object} state
 * @param {string} leagueId
 * @param {{season?: number, startDate?: string}} [options]
 */
export function createLeagueRuntime(state, leagueId, options = {}) {
  const teams = getTeamsByLeague(state, leagueId)
    .map((t) => t.id)
    .sort(); // 确定性排序，保证赛程可复现
  const season = options.season ?? state.season;
  const startDate = options.startDate ?? state.currentDate;

  const rounds = teams.length >= 2
    ? generateDoubleRoundRobin(teams, {
      startDate,
      intervalDays: SCHEDULE_CONFIG.ROUND_INTERVAL_DAYS,
    })
    : [];

  const fixtures = [];
  for (const round of rounds) {
    round.matches.forEach((m, idx) => {
      fixtures.push({
        id: `fx_${leagueId}_s${season}_r${round.round}_${idx}`,
        round: round.round,
        date: round.date,
        homeId: m.homeId,
        awayId: m.awayId,
        played: false,
        homeGoals: null,
        awayGoals: null,
      });
    });
  }

  return {
    leagueId,
    season,
    seasonStart: startDate,
    fixtures,
    table: createTable(teams),
    // 已结束赛季的快照（最终积分榜），保留以便玩家回看与解释（第 22 条）。
    history: [],
    // 'empty'：参赛队不足 2 支，无可生成赛程；不参与赛季滚动。
    status: fixtures.length === 0 ? 'empty' : 'scheduled',
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

/** 取某球队的运行时状态（不存在则返回 null）。 */
export function getClubRuntime(state, clubId) {
  return state.runtime.clubs[clubId] ?? null;
}

/** 取某联赛的运行时状态（不存在则返回 null）。 */
export function getCompetitionRuntime(state, leagueId) {
  return state.runtime.competitions[leagueId] ?? null;
}

/** 追加一条运行时事件（最小日志用途，不是新闻系统）。 */
export function recordEvent(state, type, payload = {}) {
  state.runtime.events.push({ date: state.currentDate, type, payload });
}