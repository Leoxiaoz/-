/**
 * Managed Finance Feedback（DF-01）—— Step 36D 生产实现。
 * 层级归属：Simulation Core / Finance。纯逻辑，**不依赖 DOM / 存储 / UI**，**不产生随机**。
 *
 * 规范来源：DECISIONS **D-36**（Step 36C 冻结 D36.1–D36.6）。
 *
 * 语义（CF-E2 冻结）：
 * - **season-boundary** 检查 `managedShare = cash_managed / worldCash`；`> THRESHOLD(0.35)` 触发；
 * - 触发后从 managed `cash` 中**确定性再分配** `REDISTRIBUTION_RATE(0.20)` 给 AI 俱乐部；
 * - **只改 `cash`**：不改 transferBudget / wageBudget；不生成/不销毁/不产生债务；不允许 `cash < 0`；
 *   `Σ club.cash` 严格守恒；
 * - 接收方 = AI clubs（不含 managed）：AI cash **中位数** → 优先 `cash < median` → **cash 升序**
 *   （同 cash 以 **clubId 升序** tie-break）→ 无低于 median 者则全部 AI → **均分**（余数按确定性顺序 +1）；
 * - **无 RNG / 无 OVR / 无新持久化字段**（season-boundary 纯派生、可重复）。
 *
 * 结构：`calculateManagedFinanceFeedback`（只读 → plan）→ `applyManagedFinanceFeedback`（应用 plan）。
 * 依赖方向：Simulation → Finance Feedback；本模块只依赖 finance（`getClubFinance` / `applyCashDelta`）。
 */

import { FINANCE_FEEDBACK_CONFIG } from './sim-config.js';
import { getClubFinance, applyCashDelta } from './finance.js';

const C = FINANCE_FEEDBACK_CONFIG;

/** 确定性 clubId 比较（不依赖 locale；等价于升序）。 */
function compareClubId(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 数值升序（确定性）。 */
function compareNumeric(a, b) {
  return a - b;
}

/**
 * 只读：计算本赛季边界的 Managed Finance Feedback 计划（**不修改 state**）。
 * 未触发（无 managed / worldCash ≤ 0 / share ≤ threshold / amount ≤ 0 / 无 AI 接收方）返回 `null`。
 * @param {object} state
 * @param {{config?: object}} [options] config 覆盖仅用于测试（缺省 = FINANCE_FEEDBACK_CONFIG）
 * @returns {null | {
 *   managedClubId: string, worldCash: number, managedCash: number, share: number,
 *   threshold: number, rate: number, amount: number,
 *   recipients: Array<{ clubId: string, amount: number }>
 * }}
 */
export function calculateManagedFinanceFeedback(state, options = {}) {
  const cfg = options.config ?? C;
  const clubs = state?.runtime?.clubs ?? null;
  const managedClubId = state?.runtime?.managedClubId ?? null;
  if (!clubs || !managedClubId || !clubs[managedClubId]) return null;

  const clubIds = Object.keys(clubs).sort(compareClubId);
  let worldCash = 0;
  for (const clubId of clubIds) {
    const f = getClubFinance(state, clubId);
    if (f) worldCash += f.cash;
  }
  if (!(worldCash > 0)) return null;

  const managedFinance = getClubFinance(state, managedClubId);
  const managedCash = managedFinance ? managedFinance.cash : 0;
  const share = managedCash / worldCash;
  if (share <= cfg.THRESHOLD) return null;

  const amount = Math.floor(managedCash * cfg.REDISTRIBUTION_RATE);
  if (amount <= 0) return null;

  const aiIds = clubIds.filter((id) => id !== managedClubId);
  if (aiIds.length === 0) return null;

  const aiCash = aiIds.map((id) => ({ id, cash: getClubFinance(state, id).cash }));
  const sortedCash = aiCash.map((x) => x.cash).sort(compareNumeric);
  const mid = sortedCash.length >> 1;
  const median = (sortedCash.length % 2 === 1)
    ? sortedCash[mid]
    : (sortedCash[mid - 1] + sortedCash[mid]) / 2;

  let receivers = aiCash.filter((x) => x.cash < median);
  if (receivers.length === 0) receivers = aiCash.slice();
  receivers.sort((a, b) => compareNumeric(a.cash, b.cash) || compareClubId(a.id, b.id));

  const n = receivers.length;
  const base = Math.floor(amount / n);
  let remainder = amount - base * n;
  const recipients = receivers.map((r) => {
    const add = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    return { clubId: r.id, amount: add };
  });

  return {
    managedClubId,
    worldCash,
    managedCash,
    share,
    threshold: cfg.THRESHOLD,
    rate: cfg.REDISTRIBUTION_RATE,
    amount,
    recipients,
  };
}

/**
 * 应用一个 Feedback plan（**唯一写入点：`club.finance.cash`**）。
 * 纯守恒转移：managed `-= amount`；各 recipient `+= amount_i`（Σ amount_i = amount）。
 * @param {object} state
 * @param {object|null} plan
 * @returns {{applied: boolean, amount: number, recipients: number}}
 */
export function applyManagedFinanceFeedback(state, plan) {
  if (!plan || plan.amount <= 0 || !Array.isArray(plan.recipients) || plan.recipients.length === 0) {
    return { applied: false, amount: 0, recipients: 0 };
  }
  applyCashDelta(state, plan.managedClubId, -plan.amount);
  for (const r of plan.recipients) {
    if (r.amount > 0) applyCashDelta(state, r.clubId, r.amount);
  }
  return { applied: true, amount: plan.amount, recipients: plan.recipients.length };
}

/**
 * 便捷入口：计算 + 应用（season boundary 调用一次）。未触发时为 no-op。
 * @param {object} state
 * @param {{config?: object}} [options]
 * @returns {{applied: boolean, amount: number, recipients: number, plan: object|null}}
 */
export function runManagedFinanceFeedback(state, options = {}) {
  const cfg = options.config ?? C;
  if (!cfg.ENABLED && !(options.config && options.config.ENABLED)) {
    return { applied: false, amount: 0, recipients: 0, plan: null };
  }
  const plan = calculateManagedFinanceFeedback(state, options);
  const result = applyManagedFinanceFeedback(state, plan);
  return { ...result, plan };
}
