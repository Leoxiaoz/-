/**
 * 运行期成员关系层（Runtime Membership Layer）—— G0。
 * 层级归属：Simulation Core。**叶子模块**：不 import player-runtime / game-state，避免循环依赖。
 *
 * 规范来源：DECISIONS D-19、SIMULATION_SPEC §25。核心约定（唯一真相源）：
 *   runtime.membership = {
 *     schema: 1,
 *     players: { [playerId]: clubId },  // active player → club
 *     clubs:   { [clubId]:  leagueId }  // club → league
 *   }
 * - 运行期**任何**归属判断只经本模块；静态字段（static.players[].teamId / static.teams[].leagueId）与
 *   runtime.generated[].teamId 仅作为**初始化种子 / 兼容镜像**，运行期不得据此判断归属。
 * - active 球员归属为 **string clubId（属于某 club）或显式 null（Free Agent，Step 27B / D-26.2）**；两者均为合法。
 *   key 存在即「已有归属」，即使 value 为 null 也不得由静态/新生代种子重播种。
 * - 退役球员一律移出 active membership。
 * - 全部初始化/迁移/修复**确定性**（无随机、无时间戳）。
 *
 * 顺序契约：`getClubPlayers` 的返回顺序必须与「`getWorldPlayers` 过滤」完全一致
 * （静态库原序 → 新生代插入序），以保持 Step 16–20 的确定性与行为等价。
 */

import { SimulationError } from '../shared/errors.js';

/** 成员关系层自身版本（独立于 GAME_STATE_SCHEMA_VERSION，便于日后扩展）。 */
export const MEMBERSHIP_SCHEMA_VERSION = 1;

/** 建立空的成员关系容器。 */
export function createMembership() {
  return { schema: MEMBERSHIP_SCHEMA_VERSION, players: {}, clubs: {} };
}

/** 兜底补齐 membership 容器与子映射（不覆盖已有值）。 */
function ensureContainer(state) {
  if (!state?.runtime) return null;
  const m = state.runtime.membership;
  if (!m || typeof m !== 'object') {
    state.runtime.membership = createMembership();
  } else {
    if (typeof m.schema !== 'number') m.schema = MEMBERSHIP_SCHEMA_VERSION;
    if (!m.players || typeof m.players !== 'object') m.players = {};
    if (!m.clubs || typeof m.clubs !== 'object') m.clubs = {};
  }
  return state.runtime.membership;
}

/** 是否已退役（本地实现，避免依赖 player-runtime）。 */
function isRetiredLocal(state, playerId) {
  return Boolean(state?.runtime?.retired?.[playerId]);
}

/** 世界全部 active 球员 id（静态未退役 ∪ 新生代未退役），顺序与 getWorldPlayers 一致。 */
function activePlayerIds(state) {
  const out = [];
  for (const p of state.static?.players ?? []) {
    if (!isRetiredLocal(state, p.id)) out.push(p.id);
  }
  for (const g of Object.values(state.runtime?.generated ?? {})) {
    if (g && typeof g.playerId === 'string' && !isRetiredLocal(state, g.playerId)) {
      out.push(g.playerId);
    }
  }
  return out;
}

/**
 * 建立/补齐成员关系（幂等、确定性）。
 * - 已有且有效的归属**保留**（存档值优先，不用静态种子覆盖）；
 *   **key 存在即视为已有归属**：`value===null`（Free Agent）也必须保留、**不得重播种**（Step 27B / D-26.2）；
 * - 缺失的 club→league 用静态种子补齐；缺失 key 的 active player→club 用静态/新生代种子补齐；
 * - 退役球员一律移出 active membership；
 * - 否则不删除已有条目（未知条目交由 `validateMembership` 诊断）。
 * @returns {object} state（原地）
 */
export function initializeMembership(state) {
  const m = ensureContainer(state);
  if (!m) return state;
  const hasKey = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

  // club → league：从静态种子补齐缺失项。
  for (const team of state.static?.teams ?? []) {
    if (team && typeof team.id === 'string' && !hasKey(m.clubs, team.id)) {
      m.clubs[team.id] = typeof team.leagueId === 'string' ? team.leagueId : null;
    }
  }
  // active player → club：静态球员（仅缺失 key 才播种；显式 null = Free Agent，保留不重播种）。
  for (const p of state.static?.players ?? []) {
    if (isRetiredLocal(state, p.id)) continue;
    if (!hasKey(m.players, p.id) && typeof p.teamId === 'string') {
      m.players[p.id] = p.teamId;
    }
  }
  // active player → club：新生代（迁移期允许读一次 generated.teamId 作为种子）。
  for (const g of Object.values(state.runtime?.generated ?? {})) {
    if (!g || typeof g.playerId !== 'string') continue;
    if (isRetiredLocal(state, g.playerId)) continue;
    if (!hasKey(m.players, g.playerId) && typeof g.teamId === 'string') {
      m.players[g.playerId] = g.teamId;
    }
  }
  // 退役者一律移出 active membership。
  for (const id of Object.keys(m.players)) {
    if (isRetiredLocal(state, id)) delete m.players[id];
  }
  return state;
}

/**
 * 读取球员当前归属 club（active 且存在归属；退役/未知/无归属返回 null）。
 * @returns {string|null}
 */
export function getPlayerClub(state, playerId) {
  if (isRetiredLocal(state, playerId)) return null;
  const v = state?.runtime?.membership?.players?.[playerId];
  return typeof v === 'string' ? v : null;
}

/**
 * 某俱乐部的 active 球员 id 列表。
 * **顺序契约**：与 `getWorldPlayers` 过滤顺序完全一致（静态库原序 → 新生代插入序）。
 * @returns {string[]}
 */
export function getClubPlayers(state, clubId) {
  const m = state?.runtime?.membership;
  if (!m) return [];
  const out = [];
  for (const p of state.static?.players ?? []) {
    if (isRetiredLocal(state, p.id)) continue;
    if (m.players[p.id] === clubId) out.push(p.id);
  }
  for (const g of Object.values(state.runtime?.generated ?? {})) {
    if (!g || typeof g.playerId !== 'string') continue;
    if (isRetiredLocal(state, g.playerId)) continue;
    if (m.players[g.playerId] === clubId) out.push(g.playerId);
  }
  return out;
}

/** 读取俱乐部所属联赛（未知返回 null）。 */
export function getClubLeague(state, clubId) {
  const v = state?.runtime?.membership?.clubs?.[clubId];
  return typeof v === 'string' ? v : null;
}

/** 某联赛下的俱乐部 id 列表（确定性排序：clubId 升序）。 */
export function getLeagueClubs(state, leagueId) {
  const m = state?.runtime?.membership;
  if (!m) return [];
  return Object.keys(m.clubs).filter((c) => m.clubs[c] === leagueId).sort();
}

/** active 成员判定（存在有效 club 归属且未退役）。 */
export function isActiveMember(state, playerId) {
  return getPlayerClub(state, playerId) != null;
}

/**
 * 加入 active membership（新生代入队；也为未来转会预留）。
 * @returns {object} state（原地）
 */
export function addPlayerMembership(state, playerId, clubId) {
  const m = ensureContainer(state);
  if (!m) {
    throw new SimulationError('addPlayerMembership 需要包含 runtime 的状态', { context: { playerId } });
  }
  if (typeof playerId !== 'string' || playerId.length === 0 || typeof clubId !== 'string' || clubId.length === 0) {
    throw new SimulationError('addPlayerMembership 需要非空字符串 playerId / clubId', {
      context: { playerId, clubId },
    });
  }
  m.players[playerId] = clubId;
  return state;
}

/** 移出 active membership（退役出队）。不存在时静默（幂等）。 */
export function removePlayerMembership(state, playerId) {
  const m = state?.runtime?.membership;
  if (m?.players) delete m.players[playerId];
  return state;
}

/**
 * 标记为「无俱乐部」（Free Agent，Step 27B / D-26.2）：`players[playerId] = null`。
 * **key 必须保留**（value 显式 null）——若用 delete 删 key，`initializeMembership` 会依静态/新生代种子重播种回原俱乐部。
 * @returns {object} state（原地）
 */
export function setFreeAgentMembership(state, playerId) {
  const m = ensureContainer(state);
  if (!m) {
    throw new SimulationError('setFreeAgentMembership 需要包含 runtime 的状态', { context: { playerId } });
  }
  if (typeof playerId !== 'string' || playerId.length === 0) {
    throw new SimulationError('setFreeAgentMembership 需要非空字符串 playerId', { context: { playerId } });
  }
  m.players[playerId] = null;
  return state;
}

/** 是否为显式「无俱乐部」成员（key 存在且值 === null）。 */
export function isFreeAgentMembership(state, playerId) {
  const players = state?.runtime?.membership?.players;
  return Boolean(players)
    && Object.prototype.hasOwnProperty.call(players, playerId)
    && players[playerId] === null;
}

/**
 * 校验成员关系（不修改任何状态）。区分致命问题与可诊断问题。
 * active 球员的归属值合法为：**string clubId**（属于某俱乐部）或**显式 null**（Free Agent，Step 27B / D-26.2）。
 * 致命：active 球员**缺失归属记录** / 归属值非法（非 string 且非 null）/ 归属无效 club；
 *       club 缺归属 / 归属无效 league；退役者仍在 active membership。
 * 诊断：membership 含未知 player / 未知 club。
 * 说明：本模块**不依赖 contract**——Free Agent 与合同状态的一致性由更高层 invariant 负责。
 * @returns {{fatal: string[], warnings: string[], stats: object}}
 */
export function validateMembership(state) {
  const m = state?.runtime?.membership;
  if (!m) return { fatal: ['membership 容器缺失'], warnings: [], stats: { players: 0, clubs: 0, active: 0 } };

  const fatal = [];
  const warnings = [];
  const validClubIds = new Set(Object.keys(state.runtime?.clubs ?? {}));
  const validLeagueIds = new Set((state.static?.leagues ?? []).map((l) => l.id));
  const actives = activePlayerIds(state);
  const activeSet = new Set(actives);
  const hasKey = (key) => Object.prototype.hasOwnProperty.call(m.players, key);

  for (const id of actives) {
    if (!hasKey(id)) { fatal.push(`active player ${id} 缺少归属记录`); continue; }
    const clubId = m.players[id];
    if (clubId === null) continue; // Free Agent：合法（无俱乐部）
    if (typeof clubId !== 'string') { fatal.push(`active player ${id} membership 值非法：${JSON.stringify(clubId)}`); continue; }
    if (!validClubIds.has(clubId)) fatal.push(`player ${id} 归属无效 club ${clubId}`);
  }
  for (const [id, clubId] of Object.entries(m.players)) {
    if (isRetiredLocal(state, id)) {
      fatal.push(`retired player ${id} 仍在 active membership`);
      continue;
    }
    if (!activeSet.has(id)) warnings.push(`membership 含未知/已移除 player ${id}`);
    if (clubId === null) continue; // Free Agent：合法
    if (typeof clubId !== 'string') { fatal.push(`player ${id} membership 值非法：${JSON.stringify(clubId)}`); continue; }
    if (!validClubIds.has(clubId)) fatal.push(`player ${id} 归属无效 club ${clubId}`);
  }
  for (const [clubId, leagueId] of Object.entries(m.clubs)) {
    if (!validClubIds.has(clubId)) {
      warnings.push(`membership 含未知 club ${clubId}`);
      continue;
    }
    if (leagueId == null) fatal.push(`club ${clubId} 缺少 league 归属`);
    else if (!validLeagueIds.has(leagueId)) fatal.push(`club ${clubId} 归属无效 league ${leagueId}`);
  }
  for (const clubId of validClubIds) {
    if (!(clubId in m.clubs)) fatal.push(`club ${clubId} 缺少 league 归属`);
  }
  return {
    fatal,
    warnings,
    stats: { players: Object.keys(m.players).length, clubs: Object.keys(m.clubs).length, active: actives.length },
  };
}

/**
 * 断言成员关系合法：存在致命问题时**明确报错**（不静默、不继续模拟）；否则返回诊断信息。
 * @returns {{warnings: string[], stats: object}}
 */
export function assertMembershipValid(state) {
  const { fatal, warnings, stats } = validateMembership(state);
  if (fatal.length > 0) {
    throw new SimulationError('运行期成员关系校验失败（不静默）', {
      context: { issues: fatal, stats },
    });
  }
  return { warnings, stats };
}