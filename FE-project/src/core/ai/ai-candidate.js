/**
 * AI Candidate Filter —— Step 31 / D-AI-07。
 * 层级归属：Simulation Core / AI。纯函数，**只筛选、不排序**，**不修改 state**，**无 RNG**。
 *
 * 严格按照 D-AI-07 的短路顺序过滤候选（1 exists / 2 not retired / 3 source valid / 4 position matches /
 * 5 not own club / 6 eligibility / 7 buyer roster < MAX / 8 finance affordable / 9 no known Domain hard block）。
 * 输出候选集合，**顺序 = playerId 升序**（确定性，不依赖对象枚举顺序）。
 */

import { AI_CONFIG } from './ai-config.js';
import { getAIClubPolicy } from './ai-club-policy.js';
import { ROSTER_CONFIG } from '../sim-config.js';
import {
  getPlayerClub,
  getClubPlayers,
  isFreeAgentMembership,
} from '../membership.js';
import { getPlayerContract, CONTRACT_STATUS } from '../contract.js';
import { getClubFinance } from '../finance.js';
import { getFreeAgents } from '../free-agent.js';
import { getPlayerProfile, getWorldPlayers, isRetired } from '../player-runtime.js';
import { computeTransferFee } from '../transfer.js';

/** 候选来源。 */
export const CANDIDATE_SOURCE = Object.freeze({ FREE_AGENT: 'FREE_AGENT', TRANSFER: 'TRANSFER' });

/**
 * seller 在失去该球员后是否仍满足结构约束（AI 侧保守护栏）。
 * - 保持 `roster ≥ MIN_PLAYERS(12)`（D-33 不变量）+ 最后 GK + 位置最低；
 * - 不改变 D-27 T11 的 Domain 语义（Domain 仍允许 seller 暂时低于 12，但 **AI 不主动制造** 该状态，
 *   以保证 `roster ≥ 12` 不变量与 world 有界）。
 * @returns {boolean}
 */
export function sellerKeepsStructure(state, sellerClubId, playerId, profile) {
  const sellerIds = getClubPlayers(state, sellerClubId);
  if (sellerIds.length - 1 < ROSTER_CONFIG.MIN_PLAYERS) return false;
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const id of sellerIds) {
    if (id === playerId) continue;
    const pos = getPlayerProfile(state, id)?.position;
    if (counts[pos] != null) counts[pos] += 1;
  }
  if (profile.position === 'GK' && counts.GK < ROSTER_CONFIG.MIN_GK) return false;
  for (const pos of ['DF', 'MF', 'FW']) {
    if (counts[pos] < (ROSTER_CONFIG.MIN_BY_POSITION[pos] ?? 0)) return false;
  }
  return true;
}

/**
 * @param {object} state
 * @param {string} clubId 买方俱乐部
 * @param {{position?: string, needClass?: string}} need
 * @param {'FREE_AGENT'|'TRANSFER'} source
 * @returns {string[]} 候选 playerId（playerId 升序）
 */
export function filterCandidates(state, clubId, need, source) {
  if (!need || !need.position || need.needClass === 'NONE') return [];
  const position = need.position;

  // 7) buyer roster（买方满员直接无候选）
  if (getClubPlayers(state, clubId).length >= ROSTER_CONFIG.MAX_PLAYERS) return [];

  const buyerFinance = getClubFinance(state, clubId);
  if (!buyerFinance) return [];

  // 8) 买方可用转会预算（保留安全储备；D-AI-11）
  const policy = getAIClubPolicy(clubId);
  const reserveRatio = policy.reserveRatio ?? AI_CONFIG.RESERVE_RATIO;
  const reserve = Math.max(AI_CONFIG.RESERVE_ABS, reserveRatio * buyerFinance.transferBudget);
  const availableBudget = Math.max(0, buyerFinance.transferBudget - reserve);

  // 3) source 合法 → 候选池
  let pool;
  if (source === CANDIDATE_SOURCE.FREE_AGENT) {
    pool = getFreeAgents(state);
  } else if (source === CANDIDATE_SOURCE.TRANSFER) {
    pool = getWorldPlayers(state)
      .map((p) => p.id)
      .filter((id) => {
        const owner = getPlayerClub(state, id);
        return owner != null && owner !== clubId;
      });
  } else {
    return [];
  }

  const out = [];
  for (const playerId of [...pool].sort()) {
    // 1) exists
    const profile = getPlayerProfile(state, playerId);
    if (!profile) continue;
    // 2) not retired
    if (isRetired(state, playerId)) continue;
    // 4) position matches
    if (profile.position !== position) continue;
    // 5) not already own
    if (getPlayerClub(state, playerId) === clubId) continue;

    if (source === CANDIDATE_SOURCE.FREE_AGENT) {
      // 6) Free Agent eligibility
      if (!isFreeAgentMembership(state, playerId)) continue;
      const contract = getPlayerContract(state, playerId);
      if (!contract || contract.status !== CONTRACT_STATUS.FREE_AGENT || contract.clubId !== null) continue;
      // fee = 0 → 8) finance 恒满足
      out.push(playerId);
    } else {
      // 6) transfer eligibility（与 Domain `validateTransfer` 一致：T9 允许 generated 球员无 active 合同）
      const sellerClubId = getPlayerClub(state, playerId);
      if (sellerClubId == null) continue;
      const contract = getPlayerContract(state, playerId);
      const activeOwned = Boolean(contract)
        && contract.status === CONTRACT_STATUS.ACTIVE
        && contract.clubId === sellerClubId;
      const generatedUncontracted = Boolean(profile.generated) && !contract;
      if (!activeOwned && !generatedUncontracted) continue;
      // 9) no known Domain hard block（seller 结构护栏）
      if (!sellerKeepsStructure(state, sellerClubId, playerId, profile)) continue;
      // 8) finance affordable（fee ≤ cash 且 fee ≤ availableBudget）
      const fee = computeTransferFee(state, profile);
      if (!Number.isFinite(fee)) continue;
      if (fee > buyerFinance.cash) continue;
      if (fee > availableBudget) continue;
      out.push(playerId);
    }
  }
  return out;
}
