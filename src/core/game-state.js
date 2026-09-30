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
import { createPlayerRuntime, computePopulationTarget } from './player-runtime.js';
import { createMembership, initializeMembership, getLeagueClubs } from './membership.js';
import { normalizeContracts, assertContractInvariants } from './contract.js';
import { normalizeFinance, assertFinanceInvariants } from './finance.js';
import {
  DEFAULT_FORMATION,
  FORMATIONS,
  MENTALITY,
  SCHEDULE_CONFIG,
} from './sim-config.js';

/**
 * 运行时状态结构的版本号（与存档格式、数据库格式相互独立）。
 * v2（第 15 步）：`runtime.players` 由占位改为**已定义的球员运行时状态**结构（player-runtime.js）。
 * v3（第 16 步）：球员运行时新增 `growth`（成长结算元数据）。
 * v4（第 17 步）：`injury` 增 `category/severity/totalDays`，新增 `injuryHistory`（定长有界）。
 * v5（第 19 步）：新增 `generated`（新生代档案）、`retired`（退役归档）、`nextGeneratedSeq`（生成序号）、
 *   `populationTarget`（各队人口目标快照）。均为**加法式**变更，旧档经兜底自动补齐，非破坏性。
 * v6（第 20 步）：新增 `managedClubId`（玩家管理球队，默认 null）与 `clubs[].lineup`（首发/替补，默认空）。
 *   均为**加法式**变更，旧档经 `initializeClubRuntime` 兜底补齐，非破坏性。
 * v7（G0）：新增 `membership`（运行期成员关系层：player→club / club→league，唯一真相源）。
 *   为**加法式**变更，旧档经 `initializeMembership` 从静态/新生代种子建立，非破坏性。
 * v8（G1a）：`players[].stats.{season,career}` 统计线新增 `yellow` / `red`（黄/红牌聚合，当前恒为 0）。
 *   为**加法式**变更，旧档经 `normalizeStatLine` 补齐为 0，非破坏性。
 * v9（Step 21-A）：`players[].stats.{season,career}` 统计线新增 `shots` / `shotsOnTarget` / `ratingSum`（球员比赛表现）。
 *   为**加法式**变更，旧档经 `normalizeStatLine` 补齐为 0，非破坏性。
 * v10（Step 25）：新增 `contracts`（合同地基：playerId→合同）与 `clubs[].finance`（财政地基：cash/wageBudget/transferBudget）。
 *   为**加法式**变更，旧档经 `normalizeContracts` / `normalizeFinance` 确定性补齐，非破坏性。
 */
export const GAME_STATE_SCHEMA_VERSION = 10;

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
      clubs: {},        // clubId -> 运行时俱乐部状态（战术/阵容等；财政/成长属未来阶段）
      players: {},      // playerId -> 球员运行时状态（第 15 步，见 player-runtime.js）
      competitions: {}, // competitionId -> { 赛程/结果/积分 }（决策 A1：结果与赛程归存档）
      events: [],       // 世界事件/日志（最小占位，非新闻系统）
      // 玩家管理球队（第 20 步）：默认 null（不自动选择首支球队；未选择时走自动选阵）。
      managedClubId: null,
      // 运行期成员关系层（G0）：player→club / club→league 的唯一真相源。
      membership: createMembership(),
      // 球员生命周期（第 19 步）
      generated: {},    // playerId -> 新生代档案（引擎生成；teamId 为兼容镜像，非归属真相源）
      retired: {},      // playerId -> 退役归档（永久保留 career/终值快照）
      nextGeneratedSeq: 0,
      populationTarget: {}, // 各队人口目标快照（成员关系建立后计算，见下）
      // 合同地基（Step 25）：playerId -> 合同（业务真相；membership 仍为归属真相）。
      contracts: {},
      // 财政地基（Step 25）置于 clubs[].finance（见 initialize/normalize）。
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

  // 兜底补齐俱乐部运行时字段（阵型/战术/空阵容容器）；不自动创建玩家阵容。
  initializeClubRuntime(state);

  // 初始化球员运行时状态（只建增量结构，不复制静态属性；第 15 步）。
  for (const player of world.players) {
    state.runtime.players[player.id] = createPlayerRuntime(player.id, { seasonNumber: season });
  }

  // 建立运行期成员关系（G0）：静态/新生代种子 → membership；随后据此计算人口目标快照。
  initializeMembership(state);
  state.runtime.populationTarget = computePopulationTarget(state);

  // 合同 / 财政地基（Step 25）：确定性补齐（无随机），并校验不变量（不静默）。
  normalizeContracts(state);
  normalizeFinance(state);
  assertContractInvariants(state);
  assertFinanceInvariants(state);

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

/**
 * 兜底补齐所有俱乐部的运行时字段（第 20 步；向后兼容，不覆盖已有值）：
 * - `tactics.formation`（非法/缺失回退默认阵型）、`tactics.mentality`（非法/缺失回退 balanced）；
 * - `lineup = { starters: [], bench: [] }`（缺失补齐；**不自动生成玩家阵容**）；
 * - `managedClubId`（缺失补齐为 null；指向不存在的俱乐部时重置为 null）。
 * 读取旧档后调用即完成兼容。不修改 `state.static`。
 * @returns {object} state（原地）
 */
export function initializeClubRuntime(state) {
  if (!state?.runtime?.clubs) return state;
  state.runtime.managedClubId ??= null;
  if (state.runtime.managedClubId && !state.runtime.clubs[state.runtime.managedClubId]) {
    state.runtime.managedClubId = null;
  }
  for (const club of Object.values(state.runtime.clubs)) {
    if (!club || typeof club !== 'object') continue;
    club.tactics ??= {};
    if (!club.tactics.formation || !FORMATIONS[club.tactics.formation]) {
      club.tactics.formation = DEFAULT_FORMATION;
    }
    if (!club.tactics.mentality || !(club.tactics.mentality in MENTALITY)) {
      club.tactics.mentality = 'balanced';
    }
    if (!club.lineup || typeof club.lineup !== 'object') {
      club.lineup = { starters: [], bench: [] };
    } else {
      if (!Array.isArray(club.lineup.starters)) club.lineup.starters = [];
      if (!Array.isArray(club.lineup.bench)) club.lineup.bench = [];
    }
  }
  return state;
}

/** 按 id 取静态球队。 */
export function getTeam(state, teamId) {
  return state.static.teams.find((t) => t.id === teamId) ?? null;
}

/** 按 id 取静态联赛。 */
export function getLeague(state, leagueId) {
  return state.static.leagues.find((l) => l.id === leagueId) ?? null;
}

/**
 * 取某联赛下的球队（**经运行期成员关系层**；G0 起不再直读静态 leagueId）。
 * 返回静态球队实体对象数组（实体字段来自只读静态库；**归属判定**来自 membership）。
 */
export function getTeamsByLeague(state, leagueId) {
  return getLeagueClubs(state, leagueId)
    .map((clubId) => getTeam(state, clubId))
    .filter((t) => t != null);
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