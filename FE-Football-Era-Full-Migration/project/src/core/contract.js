/**
 * 合同地基（Contract Foundation）—— Step 25。
 * 层级归属：Simulation Core。纯逻辑，**不依赖 DOM / 存储 / UI**。
 *
 * 规范来源：DECISIONS D-24（Step 23 冻结）、SIMULATION_SPEC §31。
 * 边界（D1/D2）：
 * - `membership` = player→club 的**唯一业务归属真相**（本模块**不改 membership**）。
 * - `contract` = 球员与俱乐部的**合同真相**：`runtime.contracts[playerId]`。
 * - v1：每名球员**至多一个 active contract**；不建完整合同历史（D2）。
 * - 合同期限为**整数赛季**（D4）；`wage` 为**每赛季工资**（D5）；v1 **不自动续约**。
 *
 * 红线：
 * - **不产生随机**（D20）：期限/工资全为确定性模板，同输入恒同结果。
 * - **不改 `state.static`**；不写 membership（归属由 membership 负责，二者以 invariant 关联）。
 * - `free_agent` 的**数据结构与校验**在本模块；Free Agent 的**运行时生命周期（release / sign）**由 domain operation
 *   `src/core/free-agent.js` 编排（Step 27B / D-26）；`normalizeContracts` 仍**不创建** free agent。
 */

import { SimulationError } from '../shared/errors.js';
import { CONTRACT_CONFIG } from './sim-config.js';
import { PLAYER_ATTRIBUTES } from '../shared/football-schema.js';
import { getPlayerClub } from './membership.js';
import { getPlayerProfile, getWorldPlayers } from './player-runtime.js';

/** 合同状态（v1 仅两态）。 */
export const CONTRACT_STATUS = Object.freeze({ ACTIVE: 'active', FREE_AGENT: 'free_agent' });

const C = CONTRACT_CONFIG;

/** 是否已退役（本地判定，避免额外依赖）。 */
function isRetired(state, playerId) {
  return Boolean(state?.runtime?.retired?.[playerId]);
}

/** 确定性字符串散列（**纯算术，非 RNG**）：用于期限档位，保证同 playerId 恒同结果。 */
function stableHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 球员平均能力（静态基础属性均值；缺省回退 50）。 */
function avgAbility(player) {
  let sum = 0;
  let n = 0;
  for (const attr of PLAYER_ATTRIBUTES) {
    const v = Number(player?.[attr]);
    sum += Number.isFinite(v) ? v : 50;
    n += 1;
  }
  return n > 0 ? sum / n : 50;
}

/**
 * 只读：取球员合同（不存在返回 null）。**纯读，不改状态**。
 * @returns {object|null}
 */
export function getPlayerContract(state, playerId) {
  return state?.runtime?.contracts?.[playerId] ?? null;
}

/** 只读：是否自由球员（`contract.status === 'free_agent'`）。 */
export function isFreeAgent(state, playerId) {
  return getPlayerContract(state, playerId)?.status === CONTRACT_STATUS.FREE_AGENT;
}

/**
 * 只读：球员是否**属于指定俱乐部**的有效 active contract。
 * 必须以 membership 归属为准（contract.clubId === clubId 且 membership 归属一致）。
 */
export function isContracted(state, playerId, clubId) {
  const c = getPlayerContract(state, playerId);
  return Boolean(c)
    && c.status === CONTRACT_STATUS.ACTIVE
    && c.clubId === clubId
    && getPlayerClub(state, playerId) === clubId;
}

/** 确定性工资模板（每赛季工资；按位置基数 + 平均能力）。 */
export function wageFor(player) {
  const base = C.WAGE_POSITION_BASE[player?.position] ?? C.WAGE_POSITION_BASE.MF;
  const wage = Math.round(base + C.WAGE_PER_ABILITY * avgAbility(player));
  return Math.max(C.WAGE_MIN, wage);
}

/** 确定性期限档位（赛季数）。 */
function durationFor(playerId) {
  const span = C.MAX_DURATION_SEASONS - C.MIN_DURATION_SEASONS + 1;
  return C.MIN_DURATION_SEASONS + (stableHash(playerId) % span);
}

/**
 * 由球员档案 + 俱乐部生成**确定性 active 合同模板**（无随机、同输入恒同结果）。
 * @param {object} state
 * @param {object} player 球员档案（含 id/position/属性）
 * @param {string} clubId
 * @returns {object}
 */
export function defaultContractTemplate(state, player, clubId) {
  const startSeason = Number.isInteger(state?.season) ? state.season : 1;
  return {
    playerId: player.id,
    clubId,
    startSeason,
    endSeason: startSeason + durationFor(player.id),
    wage: wageFor(player),
    status: CONTRACT_STATUS.ACTIVE,
  };
}

/**
 * 校验合同**数值/结构**字段（纯函数，抛 SimulationError）。Step 27B 起对外导出，供 domain operation 复用。
 * 注意：本函数**不校验**与 membership / club 的一致性（那属 `createContract` / `updateContract`）。
 */
export function validateContractShape(contract) {
  const { playerId, clubId, startSeason, endSeason, wage, status } = contract || {};
  if (typeof playerId !== 'string' || playerId.length === 0) {
    throw new SimulationError('合同需要非空 playerId', { context: { playerId } });
  }
  if (status !== CONTRACT_STATUS.ACTIVE && status !== CONTRACT_STATUS.FREE_AGENT) {
    throw new SimulationError('合同 status 非法', {
      context: { playerId, status, allowed: Object.values(CONTRACT_STATUS) },
    });
  }
  if (!Number.isInteger(startSeason) || startSeason < 1) {
    throw new SimulationError('合同 startSeason 需为 >=1 的整数', { context: { playerId, startSeason } });
  }
  if (!Number.isInteger(endSeason) || endSeason < startSeason) {
    throw new SimulationError('合同 endSeason 需为 >= startSeason 的整数', { context: { playerId, endSeason, startSeason } });
  }
  if (!Number.isFinite(wage) || wage < 0) {
    throw new SimulationError('合同 wage 需为非负有限数', { context: { playerId, wage } });
  }
  if (status === CONTRACT_STATUS.FREE_AGENT && clubId !== null) {
    throw new SimulationError('free_agent 合同 clubId 必须为 null', { context: { playerId, clubId } });
  }
}

/**
 * 原子更新一份**已存在**合同的字段（Step 27B 内部接口；由 domain operation 编排 release/sign）。
 * 校验先行（结构 + 与 membership/club 一致性），全部通过后才**一次性覆盖**；失败不产生任何变更。
 * 本函数不触碰 lineup / finance / runtime——那是调用方（domain operation）的职责。
 * @param {object} state
 * @param {string} playerId
 * @param {{status?: string, clubId?: string|null, startSeason?: number, endSeason?: number, wage?: number}} patch
 * @returns {object|null} 更新后合同副本（不存在返回 null）
 */
export function updateContract(state, playerId, patch = {}) {
  const existing = getPlayerContract(state, playerId);
  if (!existing) return null;
  const next = {
    playerId,
    clubId: patch.clubId !== undefined ? patch.clubId : existing.clubId,
    startSeason: patch.startSeason !== undefined ? patch.startSeason : existing.startSeason,
    endSeason: patch.endSeason !== undefined ? patch.endSeason : existing.endSeason,
    wage: patch.wage !== undefined ? patch.wage : existing.wage,
    status: patch.status !== undefined ? patch.status : existing.status,
  };
  // 1) 结构校验（先验）。
  validateContractShape(next);
  // 2) 一致性校验（先验，全部通过才 commit）。
  if (next.status === CONTRACT_STATUS.ACTIVE) {
    if (typeof next.clubId !== 'string' || !state.runtime.clubs?.[next.clubId]) {
      throw new SimulationError('active 合同需要有效 clubId', { context: { playerId, clubId: next.clubId } });
    }
    if (getPlayerClub(state, playerId) !== next.clubId) {
      throw new SimulationError('active 合同必须与 membership 归属一致', {
        context: { playerId, contractClub: next.clubId, membershipClub: getPlayerClub(state, playerId) },
      });
    }
  } else if (getPlayerClub(state, playerId) != null) {
    throw new SimulationError('free_agent 合同不得与 membership 归属并存', {
      context: { playerId, membershipClub: getPlayerClub(state, playerId) },
    });
  }
  // 3) 一次性提交。
  state.runtime.contracts[playerId] = next;
  return { ...state.runtime.contracts[playerId] };
}

/**
 * 创建一份合同（Foundation operation；**不实现 transfer/sign/release**）。
 * - active：clubId 必须为有效 club，且 `membership.players[playerId] === clubId`（一致性）；退役者禁止。
 * - free_agent：clubId=null，且 membership 不得有 club 归属（Step 25 不主动创建，仅校验结构）。
 * @returns {object} 新建合同（副本）
 */
export function createContract(state, contract) {
  if (!state?.runtime) {
    throw new SimulationError('createContract 需要包含 runtime 的状态');
  }
  state.runtime.contracts ??= {};
  validateContractShape(contract);
  const { playerId, clubId, status } = contract;

  if (getPlayerContract(state, playerId)) {
    throw new SimulationError('该球员已存在合同（v1 每球员至多一个 active contract）', { context: { playerId } });
  }
  if (isRetired(state, playerId)) {
    throw new SimulationError('退役球员不得拥有合同', { context: { playerId } });
  }
  if (status === CONTRACT_STATUS.ACTIVE) {
    if (typeof clubId !== 'string' || !state.runtime.clubs?.[clubId]) {
      throw new SimulationError('active 合同需要有效 clubId', { context: { playerId, clubId } });
    }
    if (getPlayerClub(state, playerId) !== clubId) {
      throw new SimulationError('active 合同必须与 membership 归属一致', {
        context: { playerId, contractClub: clubId, membershipClub: getPlayerClub(state, playerId) },
      });
    }
  } else if (getPlayerClub(state, playerId) != null) {
    throw new SimulationError('free_agent 合同不得与 membership 归属并存', {
      context: { playerId, membershipClub: getPlayerClub(state, playerId) },
    });
  }

  state.runtime.contracts[playerId] = {
    playerId,
    clubId,
    startSeason: contract.startSeason,
    endSeason: contract.endSeason,
    wage: contract.wage,
    status: contract.status,
  };
  return { ...state.runtime.contracts[playerId] };
}

/**
 * 终止合同：删除 `runtime.contracts[playerId]`（不存在时安全返回 null）。
 * **不**改 membership、**不**做 transfer/release/population。
 * @returns {object|null} 被删除合同的**副本**（供调用方归档），或 null
 */
export function terminateContract(state, playerId) {
  const existing = getPlayerContract(state, playerId);
  if (!existing) return null;
  delete state.runtime.contracts[playerId];
  return { ...existing };
}

/**
 * 归一化合同容器（幂等、确定性、**无随机**）：
 * - 确保 `runtime.contracts` 存在；
 * - 为**每个 active 且属于某 club**的球员补齐确定性 active 合同（旧档迁移）；**不覆盖已有合同**；
 * - **不创建 free agent**（Step 25）；**不改 membership**。
 * @returns {object} state（原地）
 */
export function normalizeContracts(state) {
  if (!state?.runtime) return state;
  state.runtime.contracts ??= {};
  for (const player of getWorldPlayers(state)) {
    const clubId = getPlayerClub(state, player.id);
    if (typeof clubId !== 'string' || !state.runtime.clubs?.[clubId]) continue;
    if (getPlayerContract(state, player.id)) continue; // 保留已有合同
    const tpl = defaultContractTemplate(state, player, clubId);
    state.runtime.contracts[player.id] = tpl;
  }
  return state;
}

/**
 * 校验合同不变量（只读；发现问题抛 SimulationError，不静默）。
 * 规则（D2/D3/D11）：playerId 与 key 一致；status 合法；active↔membership 一致且 club 有效；
 * free_agent↔clubId=null 且 membership 无归属；退役者不得持有任何合同；赛季/wage 合法。
 * @returns {{stats: object}}
 */
export function assertContractInvariants(state) {
  const contracts = state?.runtime?.contracts ?? {};
  const clubs = state?.runtime?.clubs ?? {};
  const fatal = [];
  for (const [key, c] of Object.entries(contracts)) {
    if (!c || typeof c !== 'object') {
      fatal.push(`合同 ${key} 结构非法`);
      continue;
    }
    const id = c.playerId;
    if (id !== key) fatal.push(`合同 key(${key}) 与 playerId(${id}) 不一致`);
    if (isRetired(state, key)) fatal.push(`退役球员 ${key} 不得持有合同`);
    if (c.status !== CONTRACT_STATUS.ACTIVE && c.status !== CONTRACT_STATUS.FREE_AGENT) {
      fatal.push(`合同 ${key} status 非法：${c.status}`);
      continue;
    }
    if (!Number.isInteger(c.startSeason) || c.startSeason < 1
      || !Number.isInteger(c.endSeason) || c.endSeason < c.startSeason) {
      fatal.push(`合同 ${key} 赛季区间非法`);
    }
    if (!Number.isFinite(c.wage) || c.wage < 0) fatal.push(`合同 ${key} wage 非法`);
    if (c.status === CONTRACT_STATUS.ACTIVE) {
      if (typeof c.clubId !== 'string' || !clubs[c.clubId]) {
        fatal.push(`active 合同 ${key} clubId 无效：${c.clubId}`);
      } else if (getPlayerClub(state, key) !== c.clubId) {
        fatal.push(`active 合同 ${key} 与 membership 归属不一致`);
      }
    } else {
      if (c.clubId !== null) fatal.push(`free_agent 合同 ${key} clubId 必须为 null`);
      if (getPlayerClub(state, key) != null) fatal.push(`free_agent ${key} 不得有 membership 归属`);
      // FA-INV-13 / FA-INV-14（Step 27B / D-26.4）：Free Agent 无有效工资合同；赛季锚点为单季。
      if (c.wage !== 0) fatal.push(`free_agent 合同 ${key} wage 必须为 0`);
      if (c.startSeason !== c.endSeason) fatal.push(`free_agent 合同 ${key} startSeason 必须等于 endSeason`);
    }
  }
  if (fatal.length > 0) {
    throw new SimulationError('合同不变量校验失败（不静默）', {
      context: { issues: fatal, count: Object.keys(contracts).length },
    });
  }
  return { stats: { contracts: Object.keys(contracts).length } };
}