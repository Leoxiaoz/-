/**
 * Data Layer（数据库加载与校验）。
 * 层级归属：Data Layer。只负责把 `.fdb` 世界读入并校验，**不含游戏逻辑**，
 * **不依赖 Simulation Core / Save / UI**。
 *
 * 格式说明：下列文件名与字段为**骨架占位**，正式 `.fdb` 规范见
 * DATABASE_SPEC §5（物理形态 D8）与 §6（版本/兼容 D10）——两者尚未决定。
 *
 * ID 约定（决策 A4）：类型前缀字符串，库内唯一即可，跨库不强制相同。
 * 前缀建议：cty_ / lg_ / clb_ / ply_ / mgr_ / std_ / ctr_ / trf_ / cmp_ / mat_；
 * 新生代使用独立命名空间（如 ply_g_<seq>）。可选 externalRef 供 Mod / 合并映射。
 */

import { DataError } from '../shared/errors.js';

/** 占位格式标识；正式值待 DATABASE_SPEC 决策后替换。 */
export const WORLD_FORMAT = 'fdb-json-0';

/** 骨架阶段要求存在的世界文件（不含可选文件与 assets/）。 */
export const REQUIRED_FILES = ['manifest', 'countries', 'leagues', 'teams', 'players'];

/**
 * 把已读取的各文件内容解析为世界对象，并做完整性 / 引用校验。
 * 纯函数，便于在测试中直接注入 fixture（无需网络或文件系统）。
 * @param {{manifest: object, countries: any[], leagues: any[], teams: any[], players: any[]}} files
 * @returns {object} world
 */
export function parseWorld(files) {
  const world = {
    manifest: files.manifest,
    countries: files.countries ?? [],
    leagues: files.leagues ?? [],
    teams: files.teams ?? [],
    players: files.players ?? [],
  };
  validateWorld(world);
  return world;
}

/**
 * 校验世界数据的完整性、唯一 ID 与引用完整性。
 * 错误信息包含：文件 / 实体 / ID / 字段 / 问题（对应 DATABASE_SPEC §6 红线）。
 * @param {object} world
 */
export function validateWorld(world) {
  const { manifest } = world;
  if (!manifest || typeof manifest !== 'object') {
    throw new DataError('缺少 manifest', { context: { file: 'manifest.json', field: 'manifest' } });
  }
  for (const field of ['id', 'name', 'format']) {
    if (!manifest[field]) {
      throw new DataError(`manifest 缺少必填字段 ${field}`, {
        context: { file: 'manifest.json', entity: 'manifest', field },
      });
    }
  }
  if (manifest.format !== WORLD_FORMAT) {
    throw new DataError(`世界格式不受支持：${manifest.format}`, {
      context: { file: 'manifest.json', field: 'format' },
    });
  }

  assertUniqueIds(world.countries, 'countries.json', 'country');
  assertUniqueIds(world.leagues, 'leagues.json', 'league');
  assertUniqueIds(world.teams, 'teams.json', 'team');
  assertUniqueIds(world.players, 'players.json', 'player');

  const countryIds = new Set(world.countries.map((c) => c.id));
  const leagueIds = new Set(world.leagues.map((l) => l.id));
  const teamIds = new Set(world.teams.map((t) => t.id));

  for (const league of world.leagues) {
    if (!countryIds.has(league.countryId)) {
      throw new DataError('联赛引用了不存在的国家', {
        context: { file: 'leagues.json', entity: 'league', id: league.id, field: 'countryId', value: league.countryId },
      });
    }
  }
  for (const team of world.teams) {
    if (!leagueIds.has(team.leagueId)) {
      throw new DataError('球队引用了不存在的联赛', {
        context: { file: 'teams.json', entity: 'team', id: team.id, field: 'leagueId', value: team.leagueId },
      });
    }
  }
  for (const player of world.players) {
    if (player.teamId != null && !teamIds.has(player.teamId)) {
      throw new DataError('球员引用了不存在的球队', {
        context: { file: 'players.json', entity: 'player', id: player.id, field: 'teamId', value: player.teamId },
      });
    }
  }
}

function assertUniqueIds(list, file, entity) {
  if (!Array.isArray(list)) {
    throw new DataError(`${file} 应为数组`, { context: { file } });
  }
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item.id !== 'string' || item.id.length === 0) {
      throw new DataError(`${file} 中存在缺少 id 的条目`, { context: { file, entity, field: 'id' } });
    }
    if (seen.has(item.id)) {
      throw new DataError(`${file} 中存在重复 id`, { context: { file, entity, id: item.id, field: 'id' } });
    }
    seen.add(item.id);
  }
}

/**
 * 从目录加载世界（浏览器环境使用 fetch；测试可注入 fetchImpl）。
 * @param {{basePath?: string, fetchImpl?: Function}} [config]
 */
export class DataLoader {
  constructor(config = {}) {
    this.basePath = config.basePath ?? '';
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  }

  /**
   * @param {string} worldDir 相对于 basePath 的世界目录（如 "data/worlds/test-world.fdb"）
   * @returns {Promise<object>} 校验通过的世界对象
   */
  async loadWorld(worldDir) {
    if (typeof this.fetchImpl !== 'function') {
      throw new DataError('当前环境没有可用的 fetch，无法加载世界数据', { context: { worldDir } });
    }
    const files = {};
    for (const name of REQUIRED_FILES) {
      const url = `${this.basePath}${worldDir}/${name}.json`;
      files[name] = await this.#fetchJson(url);
    }
    return parseWorld(files);
  }

  async #fetchJson(url) {
    let res;
    try {
      res = await this.fetchImpl(url);
    } catch (cause) {
      throw new DataError(`无法读取数据文件`, { context: { file: url }, cause });
    }
    if (!res || !res.ok) {
      throw new DataError('数据文件请求失败', { context: { file: url, status: res?.status } });
    }
    try {
      return await res.json();
    } catch (cause) {
      throw new DataError('数据文件不是合法 JSON', { context: { file: url }, cause });
    }
  }
}