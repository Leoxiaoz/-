/**
 * Transfer 领域操作（Transfer System v1）—— Step 28B。
 * 层级归属：Simulation Core。纯逻辑，**不依赖 DOM / 存储 / UI**。**不产生随机**（D-27 T23）。
 *
 * 规范来源：DECISIONS **D-27**（Step 28A 设计冻结 T1–T30）、SIMULATION_SPEC §33。
 *
 * 语义（T1）：Transfer = **Club A → Club B 的一次原子球员交易**，**不是**「改 player.clubId」，
 * 也不是 release + sign。一次性完成 **Membership / Contract / Finance / Seller Lineup** 四域的一致变更；
 * Team Strength / Match Squad **不直接修改**（经 Membership 派生）。
 *
 * 结构（T21）：`validateTransfer → buildTransferPlan → commitTransferPlan → assertTransferInvariants`。
 * - validate 只读；plan 不改 state；commit 在所有校验通过后一次性写入；commit 阶段不再做可失败的业务判断。
 *
 * 依赖（单向，无环，T28.1）：contract / membership / finance / player-lineup / player-runtime / sim-config / game-state。
 * 与 `free-agent.js` 为 **sibling domain modules**（本模块可单向复用其不变量断言，反之禁止）。
 *
 * 明确未实现（D-27）：AI Transfer、Transfer Window、Contract Expiry / Renewal、Loan、Negotiation、
 * Transfer History、Market Value 持久化、FFP、收入系统、工资现金流、**D10**。
 */

import { SimulationError } from '../shared/errors.js';
import { TRANSFER_CONFIG, ROSTER_CONFIG } from './sim-config.js';
import { PLAYER_ATTRIBUTES, ATTRIBUTE_DEFAULT } from '../shared/football-schema.js';
import { ageOn } from './date-utils.js';
import {
  getPlayerClub,
  getClubPlayers,
  addPlayerMembership,
  isFreeAgentMembership,
  assertMembershipValid,
} from './membership.js';
import {
  getPlayerContract,
  terminateContract,
  createContract,
  defaultContractTemplate,
  assertContractInvariants,
  CONTRACT_STATUS,
} from './contract.js';
import {
  getClubFinance,
  applyCashDelta,
  applyTransferBudgetDelta,
  assertFinanceInvariants,
} from './finance.js';
import { getPlayerProfile, getEffectiveAttributes, getTeamPlayers } from './player-runtime.js';
import { removePlayerFromAllLineups } from './player-lineup.js';
import { assertFreeAgentInvariants } from './free-agent.js';
import { recordEvent } from './game-state.js';

const T = TRANSFER_CONFIG;

/** 抛出带稳定错误码的 SimulationError。 */
function fail(code, message, context) {
  throw new SimulationError(message, { code, context });
}

/** 是否已退役（本地判定，避免额外依赖）。 */
function isRetired(state, playerId) {
  return Boolean(state?.runtime?.retired?.[playerId]);
}

/** 年龄系数（遵循 Growth/Decline 年龄曲线；取第一个 `age <= maxAge` 的档位）。 */
function ageFactorFor(age) {
  for (const band of T.AGE_FACTORS) {
    if (age <= band.maxAge) return band.factor;
  }
  return T.AGE_FACTORS[T.AGE_FACTORS.length - 1].factor;
}

/** clamp 到 `[MIN_TRANSFER_FEE, MAX_TRANSFER_FEE]`，取整；非有限值回退 MIN。 */
export function clampTransferFee(raw) {
  const v = Number(raw);
  const base = Number.isFinite(v) ? Math.round(v) : T.MIN_TRANSFER_FEE;
  return Math.min(T.MAX_TRANSFER_FEE, Math.max(T.MIN_TRANSFER_FEE, base));
}

/**
 * 确定性纯函数：转会费 = `BASE × AbilityFactor × AgeFactor × PositionFactor`（T2/T3）。
 * - AbilityFactor 基于**完整 effective attribute 向量**均值（非单一 OVR）；
 * - AgeFactor 基于出生日期/当前日期；PositionFactor 仅轻微差异；
 * - **不读取** cash / transferBudget / squad size；**不使用** Potential/Fitness/Form/Morale/Injury/Stats；**无随机**。
 * @param {object} state
 * @param {object} player 球员档案（含 id/position/birthDate）
 * @returns {number} 有限整数，位于 [MIN_TRANSFER_FEE, MAX_TRANSFER_FEE]
 */
export function computeTransferFee(state, player) {
  const eff = getEffectiveAttributes(state, player?.id) ?? {};
  let sum = 0;
  let n = 0;
  for (const attr of PLAYER_ATTRIBUTES) {
    const v = Number(eff[attr]);
    sum += Number.isFinite(v) ? v : ATTRIBUTE_DEFAULT;
    n += 1;
  }
  const avg = n > 0 ? sum / n : ATTRIBUTE_DEFAULT;
  const abilityFactor = Math.max(T.ABILITY_MIN, avg / T.ABILITY_REFERENCE);
  const age = player?.birthDate ? ageOn(player.birthDate, state?.currentDate) : T.AGE_REFERENCE;
  const ageFactor = ageFactorFor(age);
  const positionFactor = T.POSITION_FACTOR[player?.position] ?? 1.0;
  return clampTransferFee(T.BASE_FEE * abilityFactor * ageFactor * positionFactor);
}

/**
 * 只读校验（T4–T14）。全部通过返回校验上下文；任一失败抛带稳定错误码的 SimulationError。**不修改 state**。
 * @returns {{player: object, sellerClubId: string, buyerClubId: string, transferFee: number, oldContract: object|null}}
 */
export function validateTransfer(state, ctx = {}) {
  if (!state?.runtime) fail('INVALID_STATE', 'transferPlayer 需要包含 runtime 的状态', {});
  const { playerId, buyerClubId } = ctx;

  const player = getPlayerProfile(state, playerId);
  if (!player) fail('PLAYER_NOT_FOUND', `球员不存在：${playerId}`, { playerId });
  if (isRetired(state, playerId)) fail('PLAYER_RETIRED', `退役球员不可转会：${playerId}`, { playerId });

  // seller 由 membership 派生（T1：transfer 不接收 seller 参数）
  const sellerClubId = getPlayerClub(state, playerId);
  if (sellerClubId == null) {
    if (isFreeAgentMembership(state, playerId)) {
      fail('FREE_AGENT_NOT_TRANSFERABLE', `Free Agent 不可转会（请用 signFreeAgent）：${playerId}`, { playerId });
    }
    fail('PLAYER_NOT_IN_SELLER', `球员不属于任何俱乐部：${playerId}`, { playerId });
  }
  if (!state.runtime.clubs[sellerClubId]) {
    fail('PLAYER_NOT_IN_SELLER', `球员所属俱乐部不存在：${sellerClubId}`, { playerId, sellerClubId });
  }
  if (typeof buyerClubId !== 'string' || !state.runtime.clubs[buyerClubId]) {
    fail('BUYER_CLUB_NOT_FOUND', `买方俱乐部不存在：${buyerClubId}`, { playerId, buyerClubId });
  }
  if (sellerClubId === buyerClubId) fail('SAME_CLUB', `买卖双方为同一俱乐部：${sellerClubId}`, { playerId, sellerClubId });

  // 合同（T9 / T16）：generated 球员允许「Club + 无 active contract」；其余必须有 active 合同。
  const oldContract = getPlayerContract(state, playerId);
  const hasActive = Boolean(oldContract) && oldContract.status === CONTRACT_STATUS.ACTIVE;
  if (hasActive) {
    if (oldContract.clubId !== sellerClubId) {
      fail('CONTRACT_MISMATCH', `合同 clubId 与 membership 归属不一致：${playerId}`, {
        playerId, sellerClubId, contractClubId: oldContract.clubId,
      });
    }
  } else if (!player.generated) {
    if (oldContract && oldContract.status === CONTRACT_STATUS.FREE_AGENT) {
      fail('FREE_AGENT_NOT_TRANSFERABLE', `Free Agent 合同不可转会：${playerId}`, { playerId });
    }
    fail('PLAYER_HAS_NO_ACTIVE_CONTRACT', `球员没有 active 合同（不可转会）：${playerId}`, { playerId });
  }

  // buyer MAX roster（T13）
  const buyerRosterCount = getClubPlayers(state, buyerClubId).length;
  if (buyerRosterCount >= ROSTER_CONFIG.MAX_PLAYERS) {
    fail('ROSTER_FULL', `买方俱乐部已达人数上限（${ROSTER_CONFIG.MAX_PLAYERS}）`, {
      buyerClubId, rosterCount: buyerRosterCount, max: ROSTER_CONFIG.MAX_PLAYERS,
    });
  }

  // seller GK 硬保护（T12）：不得使 seller GK = 0
  if (player.position === 'GK') {
    const sellerGK = getTeamPlayers(state, sellerClubId).filter((p) => p.position === 'GK').length;
    if (sellerGK <= 1) {
      fail('SELLER_LAST_GK', `卖方仅剩 1 名 GK，不可转会：${playerId}`, { playerId, sellerClubId, sellerGK });
    }
  }

  // 转会费（T2/T3）
  const transferFee = computeTransferFee(state, player);
  if (!Number.isFinite(transferFee) || transferFee < T.MIN_TRANSFER_FEE || transferFee > T.MAX_TRANSFER_FEE) {
    fail('INVALID_TRANSFER_FEE', `转会费非法：${transferFee}`, { playerId, transferFee });
  }

  // Finance（T4/T5）：cash 与 transferBudget 都必须充足，且错误原因可区分
  const buyerFinance = getClubFinance(state, buyerClubId);
  if (!buyerFinance) fail('BUYER_CLUB_NOT_FOUND', `买方俱乐部财政缺失：${buyerClubId}`, { buyerClubId });
  if (transferFee > buyerFinance.cash) {
    fail('INSUFFICIENT_CASH', `买方现金不足：fee=${transferFee} cash=${buyerFinance.cash}`, {
      buyerClubId, transferFee, cash: buyerFinance.cash,
    });
  }
  if (transferFee > buyerFinance.transferBudget) {
    fail('INSUFFICIENT_TRANSFER_BUDGET', `买方转会预算不足：fee=${transferFee} budget=${buyerFinance.transferBudget}`, {
      buyerClubId, transferFee, budget: buyerFinance.transferBudget,
    });
  }

  return { player, sellerClubId, buyerClubId, transferFee, oldContract: hasActive ? { ...oldContract } : null };
}

/**
 * 构建 TransferPlan（**不修改 state**）。先执行 `validateTransfer`。
 * @returns {object} 含 before/after 的不可变计划
 */
export function buildTransferPlan(state, ctx = {}) {
  const v = validateTransfer(state, ctx);
  const { player, sellerClubId, buyerClubId, transferFee, oldContract } = v;
  const sellerFinance = getClubFinance(state, sellerClubId);
  const buyerFinance = getClubFinance(state, buyerClubId);
  const season = Number.isInteger(state.season) ? state.season : 1;

  const newContract = defaultContractTemplate(state, player, buyerClubId);
  newContract.startSeason = season; // T9：新合同 startSeason = 当前赛季

  return {
    playerId: ctx.playerId,
    sellerClubId,
    buyerClubId,
    transferFee,
    oldContract,
    newContract: { ...newContract },
    sellerCashBefore: sellerFinance.cash,
    sellerCashAfter: sellerFinance.cash + transferFee,
    buyerCashBefore: buyerFinance.cash,
    buyerCashAfter: buyerFinance.cash - transferFee,
    buyerTransferBudgetBefore: buyerFinance.transferBudget,
    buyerTransferBudgetAfter: buyerFinance.transferBudget - transferFee,
    season,
    date: state.currentDate,
  };
}

/**
 * 一次性提交 TransferPlan（**commit 阶段无业务判断**）。顺序遵循 D-27 T21。
 * @returns {object} { playerId, sellerClubId, buyerClubId, transferFee }
 */
export function commitTransferPlan(state, plan) {
  const { playerId, sellerClubId, buyerClubId, transferFee } = plan;

  // 1) membership：seller → buyer（**直接覆盖**，不经 free agent 的 null 中间态，T14）
  addPlayerMembership(state, playerId, buyerClubId);
  // 2) 终止旧合同（若存在）
  if (plan.oldContract) terminateContract(state, playerId);
  // 3) 创建新 active 合同（此时 membership 已指向 buyer，校验通过）
  createContract(state, plan.newContract);
  // 4) buyer cash -= fee
  applyCashDelta(state, buyerClubId, -transferFee);
  // 5) seller cash += fee
  applyCashDelta(state, sellerClubId, transferFee);
  // 6) buyer transferBudget -= fee（seller 预算不增，T6）
  applyTransferBudgetDelta(state, buyerClubId, -transferFee);
  // 7) 清理 seller lineups（starters + bench + 所有容器；buyer 不自动加入，T15）
  removePlayerFromAllLineups(state, playerId);
  // 8) 记录 runtime-only 事件（T18）
  recordEvent(state, 'TRANSFER_COMPLETED', {
    playerId,
    sellerClubId,
    buyerClubId,
    transferFee,
    season: plan.season,
    date: plan.date,
  });

  return { playerId, sellerClubId, buyerClubId, transferFee };
}

/**
 * Transfer 完成后不变量校验（只读；发现致命问题抛错，不静默）。复用既有不变量层（T21 / T28.2）。
 * @returns {{stats: object}}
 */
export function assertTransferInvariants(state) {
  assertMembershipValid(state);
  assertContractInvariants(state);
  assertFinanceInvariants(state);
  assertFreeAgentInvariants(state);

  const fatal = [];
  for (const [clubId, club] of Object.entries(state.runtime?.clubs ?? {})) {
    const rosterCount = getClubPlayers(state, clubId).length;
    if (rosterCount > ROSTER_CONFIG.MAX_PLAYERS) fatal.push(`club ${clubId} roster ${rosterCount} > MAX`);
    const f = club?.finance;
    if (f) {
      if (!(Number.isFinite(f.cash) && f.cash >= 0)) fatal.push(`club ${clubId} cash 非法：${f.cash}`);
      if (!(Number.isFinite(f.transferBudget) && f.transferBudget >= 0)) fatal.push(`club ${clubId} transferBudget 非法：${f.transferBudget}`);
    }
  }
  // Free Agent 不得进入 club roster（membership 已保证；此处再确认无 active 无归属球员）
  for (const playerId of Object.keys(state.runtime?.membership?.players ?? {})) {
    if (isRetired(state, playerId)) continue;
    const clubId = getPlayerClub(state, playerId);
    if (clubId != null && !state.runtime.clubs[clubId]) fatal.push(`player ${playerId} 归属无效 club ${clubId}`);
  }
  if (fatal.length > 0) {
    throw new SimulationError('Transfer 不变量校验失败（不静默）', {
      code: 'TRANSFER_INVARIANT',
      context: { issues: fatal },
    });
  }
  return { stats: { clubs: Object.keys(state.runtime?.clubs ?? {}).length } };
}

/**
 * 领域操作：把球员从 seller club 转会给 buyer club（Club → Club，T1）。
 * 流程：plan（含 validate）→ commit → assert。**失败发生在 commit 之前**，不产生任何半提交。
 * @param {object} state
 * @param {string} playerId
 * @param {string} buyerClubId
 * @returns {{playerId, sellerClubId, buyerClubId, transferFee, contract}}
 */
export function transferPlayer(state, playerId, buyerClubId) {
  const plan = buildTransferPlan(state, { playerId, buyerClubId });
  commitTransferPlan(state, plan);
  assertTransferInvariants(state);
  return {
    playerId,
    sellerClubId: plan.sellerClubId,
    buyerClubId,
    transferFee: plan.transferFee,
    contract: getPlayerContract(state, playerId),
  };
}
