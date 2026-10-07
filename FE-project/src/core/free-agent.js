/**
 * Free Agent 领域操作（Free Agent + Membership Integration）—— Step 27B。
 * 层级归属：Simulation Core。纯逻辑，**不依赖 DOM / 存储 / UI**。**不产生随机**（D20）。
 *
 * 规范来源：DECISIONS **D-26**（Step 27A 设计冻结）、SIMULATION_SPEC §32。
 *
 * 语义（唯一业务真相，**不新增第三套容器**）：
 * - 合同真相：`runtime.contracts[playerId]`（Free Agent：`status='free_agent'`、`clubId=null`、`wage=0`、
 *   `startSeason=endSeason=进入自由身的当前赛季`）。
 * - 归属真相：`runtime.membership.players[playerId]`（Free Agent：**显式 `null`**，key 保留，禁止 delete）。
 *
 * 职责边界：
 * - 本模块是 **domain operation 层**：编排 contract + membership + lineup 的原子变更；
 *   校验先行（plan → validate），全部通过后才一次性提交（commit），避免半完成状态。
 * - UI / Controller / AI **不得**直接改写 membership / contracts / lineup，必须经本层。
 * - **不触碰** player runtime（ability/stats/vitals/injury）、generated、retired、world population。
 *
 * 明确未实现（Step 28+）：Transfer、转会费、合同到期/续约、AI 转会、签约费、工资现金流、D10。
 */

import { SimulationError } from '../shared/errors.js';
import { ROSTER_CONFIG } from './sim-config.js';
import {
  getPlayerClub,
  getClubPlayers,
  addPlayerMembership,
  setFreeAgentMembership,
  isFreeAgentMembership,
} from './membership.js';
import {
  getPlayerContract,
  updateContract,
  validateContractShape,
  defaultContractTemplate,
  CONTRACT_STATUS,
} from './contract.js';
import { getPlayerProfile, getWorldPlayers } from './player-runtime.js';
import { removePlayerFromAllLineups } from './player-lineup.js';
import { recordEvent } from './game-state.js';

/** 抛出带稳定错误码的 SimulationError。 */
function fail(code, message, context) {
  throw new SimulationError(message, { code, context });
}

/** 是否已退役（本地判定）。 */
function isRetired(state, playerId) {
  return Boolean(state?.runtime?.retired?.[playerId]);
}

/**
 * 只读：全部 Free Agent 的 playerId（**确定性顺序：playerId 升序**）。
 * 判定 = active 未退役 且 membership 显式 null 且 contract.status==='free_agent'。
 * @returns {string[]}
 */
export function getFreeAgents(state) {
  const out = [];
  for (const player of getWorldPlayers(state)) {
    if (isRetired(state, player.id)) continue;
    if (!isFreeAgentMembership(state, player.id)) continue;
    const contract = getPlayerContract(state, player.id);
    if (contract && contract.status === CONTRACT_STATUS.FREE_AGENT && contract.clubId === null) out.push(player.id);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** 只读：Free Agent 数量。 */
export function getFreeAgentCount(state) {
  return getFreeAgents(state).length;
}

/**
 * 只读：按位置选取一个 Free Agent 候选（**确定性**：playerId 升序的首个位置吻合者）。
 * 供 Population 补位优先复用现有 Free Agent（Step 27B / D-26.7）。
 * @returns {string|null}
 */
export function selectFreeAgentForPosition(state, position) {
  for (const playerId of getFreeAgents(state)) {
    if (getPlayerProfile(state, playerId)?.position === position) return playerId;
  }
  return null;
}

/**
 * 领域操作：把球员从所属俱乐部释放为 Free Agent（Club Player → Free Agent）。
 * 原子修改：contract（active→free_agent、clubId→null、赛季锚点=当前赛季、wage=0）+ membership（clubId→null）+ 源/所有 lineup 清除该球员。
 * 不改变：world population、player runtime、generated、retired。
 * @returns {{playerId: string, fromClubId: string, status: string}}
 */
export function releasePlayerToFreeAgent(state, playerId) {
  if (!state?.runtime) fail('INVALID_STATE', 'releasePlayerToFreeAgent 需要包含 runtime 的状态', {});
  const profile = getPlayerProfile(state, playerId);
  if (!profile) fail('PLAYER_NOT_FOUND', `球员不存在：${playerId}`, { playerId });
  if (isRetired(state, playerId)) fail('PLAYER_RETIRED', `退役球员不可 release：${playerId}`, { playerId });

  const clubId = getPlayerClub(state, playerId);
  if (clubId == null) {
    if (isFreeAgentMembership(state, playerId)) {
      fail('PLAYER_ALREADY_FREE_AGENT', `球员已是 Free Agent：${playerId}`, { playerId });
    }
    fail('PLAYER_NOT_FOUND', `球员不属于任何俱乐部：${playerId}`, { playerId });
  }
  if (!state.runtime.clubs[clubId]) fail('CLUB_NOT_FOUND', `源俱乐部不存在：${clubId}`, { playerId, clubId });

  const contract = getPlayerContract(state, playerId);
  if (!contract || contract.status !== CONTRACT_STATUS.ACTIVE) {
    fail('PLAYER_HAS_NO_ACTIVE_CONTRACT', `球员没有 active 合同（不可 release）：${playerId}`, { playerId, clubId });
  }
  if (contract.clubId !== clubId) {
    fail('CONTRACT_MEMBERSHIP_MISMATCH', `合同 clubId 与 membership 归属不一致：${playerId}`, {
      playerId, clubId, contractClubId: contract.clubId,
    });
  }

  // ---- commit（校验已全部通过；以下为不可失败的写入）----
  const season = Number.isInteger(state.season) ? state.season : 1;
  setFreeAgentMembership(state, playerId); // membership: clubId → null（key 保留）
  updateContract(state, playerId, {
    status: CONTRACT_STATUS.FREE_AGENT,
    clubId: null,
    startSeason: season,
    endSeason: season,
    wage: 0,
  });
  removePlayerFromAllLineups(state, playerId);
  recordEvent(state, 'player_released', { playerId, fromClubId: clubId, season });
  return { playerId, fromClubId: clubId, status: CONTRACT_STATUS.FREE_AGENT };
}

/**
 * 领域操作：把 Free Agent 签约到目标俱乐部（Free Agent → Club Player）。
 * 原子修改：membership（null→clubId）+ contract（free_agent→active，写入新条款）。
 * 前置：球员是 Free Agent；目标 club 存在且 roster < MAX_PLAYERS；条款合法。
 * **不**自动把球员塞入首发/替补（lineup 由现有阵容系统决定）；不触碰 finance（无转会费/签约费）。
 * @param {object} state
 * @param {string} playerId
 * @param {string} clubId
 * @param {{terms?: {startSeason?: number, endSeason?: number, wage?: number}}} [options]
 * @returns {{playerId: string, clubId: string, contract: object|null}}
 */
export function signFreeAgent(state, playerId, clubId, options = {}) {
  if (!state?.runtime) fail('INVALID_STATE', 'signFreeAgent 需要包含 runtime 的状态', {});
  const profile = getPlayerProfile(state, playerId);
  if (!profile) fail('PLAYER_NOT_FOUND', `球员不存在：${playerId}`, { playerId });
  if (isRetired(state, playerId)) fail('PLAYER_RETIRED', `退役球员不可签约：${playerId}`, { playerId });

  const contract = getPlayerContract(state, playerId);
  const isFreeAgent = isFreeAgentMembership(state, playerId)
    && Boolean(contract)
    && contract.status === CONTRACT_STATUS.FREE_AGENT
    && contract.clubId === null;
  if (!isFreeAgent) fail('PLAYER_NOT_FREE_AGENT', `球员不是 Free Agent：${playerId}`, { playerId });

  if (!state.runtime.clubs[clubId]) fail('CLUB_NOT_FOUND', `目标俱乐部不存在：${clubId}`, { playerId, clubId });
  const rosterCount = getClubPlayers(state, clubId).length;
  if (rosterCount >= ROSTER_CONFIG.MAX_PLAYERS) {
    fail('ROSTER_MAX_REACHED', `目标俱乐部已达人数上限（${ROSTER_CONFIG.MAX_PLAYERS}）`, {
      clubId, rosterCount, max: ROSTER_CONFIG.MAX_PLAYERS,
    });
  }

  // 条款：默认取**确定性模板**（无随机），可按 terms 覆盖；先验通过后才提交。
  const base = defaultContractTemplate(state, profile, clubId);
  const terms = {
    playerId,
    clubId,
    status: CONTRACT_STATUS.ACTIVE,
    startSeason: options.terms?.startSeason ?? base.startSeason,
    endSeason: options.terms?.endSeason ?? base.endSeason,
    wage: options.terms?.wage ?? base.wage,
  };
  try {
    validateContractShape(terms);
  } catch (err) {
    fail('INVALID_CONTRACT_TERMS', `签约条款非法：${err?.message ?? err}`, { playerId, clubId, terms });
  }

  // ---- commit（校验已全部通过；以下为不可失败的写入）----
  addPlayerMembership(state, playerId, clubId); // membership: null → clubId
  updateContract(state, playerId, {
    status: CONTRACT_STATUS.ACTIVE,
    clubId,
    startSeason: terms.startSeason,
    endSeason: terms.endSeason,
    wage: terms.wage,
  });
  recordEvent(state, 'free_agent_signed', { playerId, clubId, season: terms.startSeason });
  return { playerId, clubId, contract: getPlayerContract(state, playerId) };
}

/**
 * 校验 Free Agent 不变量（只读；发现问题抛 SimulationError，不静默）。
 * 覆盖 FA-INV-04 / FA-INV-05（不在 club roster / lineup）；FA-INV-01/02/03/13/14/15 由
 * `assertContractInvariants` 覆盖；FA-INV-08/09 由 `validateMembership` 覆盖。
 * 接入既有不变量层（`controller.load`），不新建第二套系统。
 * @returns {{stats: object}}
 */
export function assertFreeAgentInvariants(state) {
  const fatal = [];
  for (const playerId of getFreeAgents(state)) {
    if (getPlayerClub(state, playerId) != null) fatal.push(`free agent ${playerId} 仍有 club 归属`);
    for (const [clubId, club] of Object.entries(state.runtime?.clubs ?? {})) {
      const lineup = club?.lineup;
      if (!lineup) continue;
      if ((lineup.starters ?? []).includes(playerId) || (lineup.bench ?? []).includes(playerId)) {
        fatal.push(`free agent ${playerId} 出现在 ${clubId} lineup`);
      }
    }
  }
  if (fatal.length > 0) {
    throw new SimulationError('Free Agent 不变量校验失败（不静默）', {
      code: 'FREE_AGENT_INVARIANT',
      context: { issues: fatal },
    });
  }
  return { stats: { freeAgents: getFreeAgents(state).length } };
}