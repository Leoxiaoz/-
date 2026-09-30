/**
 * 财政地基（Finance Foundation）—— Step 25。
 * 层级归属：Simulation Core。纯逻辑，**不依赖 DOM / 存储 / UI**。
 *
 * 规范来源：DECISIONS D-24（Step 23 冻结）、SIMULATION_SPEC §31。
 * 语义（D6/D13/D17）：
 * - `runtime.clubs[clubId].finance = { cash, wageBudget, transferBudget }`；
 * - **只有 `cash` 是实际货币余额**；`wageBudget` / `transferBudget` 是**约束上限**（非额外余额）；
 * - v1 **不建复杂收入系统**，且 **工资不从 cash 扣除**（工资仅作合同属性 + wageBudget 约束）。
 *
 * 红线：**不产生随机**（D20），同一 clubId 恒得同一初始值；不改 `state.static`；不改 membership/contract。
 */

import { SimulationError } from '../shared/errors.js';
import { FINANCE_CONFIG } from './sim-config.js';

/** 确定性财政模板（同一 clubId 恒同值；无随机）。 */
export function financeTemplate() {
  return {
    cash: FINANCE_CONFIG.INITIAL_CASH,
    wageBudget: FINANCE_CONFIG.INITIAL_WAGE_BUDGET,
    transferBudget: FINANCE_CONFIG.INITIAL_TRANSFER_BUDGET,
  };
}

/** 只读：取俱乐部财政（不存在返回 null）。 */
export function getClubFinance(state, clubId) {
  return state?.runtime?.clubs?.[clubId]?.finance ?? null;
}

/**
 * 只读：可支配现金 = `min(cash, transferBudget)`。
 * `cash` 仍是真实余额，`transferBudget` 只是支出上限（D6）。
 */
export function getSpendableCash(state, clubId) {
  const f = getClubFinance(state, clubId);
  if (!f) return 0;
  return Math.min(f.cash, f.transferBudget);
}

/** 是否为合法数值（有限且 >= 0）。 */
function isNonNegativeNumber(v) {
  return Number.isFinite(Number(v)) && Number(v) >= 0;
}

/**
 * 归一化俱乐部财政（幂等、确定性、**无随机**）：
 * - 每个 active club 缺失 `finance` 则补确定性模板；
 * - 已有 `finance` 的**合法字段保留**；非法字段（非有限 / 负数）回退模板值；
 * - **不新建独立 `runtime.finance`**（避免与 clubs[] 重复真相）。
 * @returns {object} state（原地）
 */
export function normalizeFinance(state) {
  if (!state?.runtime?.clubs) return state;
  const tpl = financeTemplate();
  for (const club of Object.values(state.runtime.clubs)) {
    if (!club || typeof club !== 'object') continue;
    if (!club.finance || typeof club.finance !== 'object') {
      club.finance = { ...tpl };
      continue;
    }
    for (const key of ['cash', 'wageBudget', 'transferBudget']) {
      if (!isNonNegativeNumber(club.finance[key])) club.finance[key] = tpl[key];
      else club.finance[key] = Number(club.finance[key]);
    }
  }
  return state;
}

/**
 * 校验财政不变量（只读；发现问题抛 SimulationError，不静默）。
 * 规则：cash / wageBudget / transferBudget 均为**有限且 >= 0** 的数值。
 * @returns {{stats: object}}
 */
export function assertFinanceInvariants(state) {
  const clubs = state?.runtime?.clubs ?? {};
  const fatal = [];
  for (const [clubId, club] of Object.entries(clubs)) {
    const f = club?.finance;
    if (!f || typeof f !== 'object') {
      fatal.push(`俱乐部 ${clubId} 缺少 finance`);
      continue;
    }
    for (const key of ['cash', 'wageBudget', 'transferBudget']) {
      if (!isNonNegativeNumber(f[key])) fatal.push(`俱乐部 ${clubId} finance.${key} 非法：${f[key]}`);
    }
  }
  if (fatal.length > 0) {
    throw new SimulationError('财政不变量校验失败（不静默）', {
      context: { issues: fatal, clubs: Object.keys(clubs).length },
    });
  }
  return { stats: { clubs: Object.keys(clubs).length } };
}