/**
 * AI Development Philosophy — Club-level（Step 39F-L-C0-IMPLEMENTATION；D-45 / OD-39FL）。
 * 层级归属：Simulation Core / AI。纯派生、只读、无副作用、无 RNG、不持久化。
 *
 * 语义（唯一数据流）：
 *   clubId
 *     → getAIClubPolicy(clubId)            （复用现有 Club Identity，不建第二套）
 *     → policy.id                          （Balanced / YouthFocus / Conservative）
 *     → Family C 固定映射
 *     → { developmentCommitment, youthOpportunityPreference }
 *     → STOP                               （NO CONSUMER）
 *
 * 红线：
 * - **复用 Club Identity**：只读 `getAIClubPolicy(clubId).id`；不重算 `hashSeed`、
 *   不新建 `|ai-dev-philosophy` identity hash、不复制 `AI_CONFIG.POLICIES`。
 * - **非仿射（D-45）**：两轴独立 mapping，三点 `(C,O)` 不得共线
 *   （不存在 `O = a·C + b` 同时满足三档）。
 * - **J0**：无 jitter；同一 Archetype 恒得同一对值，无 club/season/player 偏移。
 * - **不读** Club Strength / finance / squad / standings / manager / results。
 * - **NO CONSUMER**：仅返回两个数值；不改 state / 不写 save / 不写 runtime / 不接任何下游。
 */

import { getAIClubPolicy } from './ai-club-policy.js';

/**
 * Family C 固定映射（D-45 冻结；**固定表**，禁止改为公式重新计算）。
 *
 * 非仿射性（D-45 正式约束）：三点
 *   Conservative = (0.30, 0.30)
 *   Balanced     = (0.50, 0.50)
 *   YouthFocus   = (0.70, 0.60)
 * 两段斜率分别为 (0.50-0.30)/(0.50-0.30)=1.0 与 (0.60-0.50)/(0.70-0.50)=0.5，
 * 不相等 ⇒ 不共线 ⇒ 不存在使三档同时成立的 `O = a·C + b`。
 */
export const DEVELOPMENT_PHILOSOPHY_FAMILY_C = Object.freeze({
  Conservative: Object.freeze({ developmentCommitment: 0.30, youthOpportunityPreference: 0.30 }),
  Balanced: Object.freeze({ developmentCommitment: 0.50, youthOpportunityPreference: 0.50 }),
  YouthFocus: Object.freeze({ developmentCommitment: 0.70, youthOpportunityPreference: 0.60 }),
});

/**
 * 由 Club Identity 的 policy id 解析两轴（内部 helper）。
 * 每次返回**新的 plain object**（不泄露 frozen 单例，避免调用方污染后续调用）。
 * @param {string} policyId
 * @returns {{developmentCommitment:number, youthOpportunityPreference:number}}
 */
function resolveDevelopmentPhilosophy(policyId) {
  const entry = DEVELOPMENT_PHILOSOPHY_FAMILY_C[policyId];
  return {
    developmentCommitment: entry.developmentCommitment,
    youthOpportunityPreference: entry.youthOpportunityPreference,
  };
}

/**
 * 评估某俱乐部的 Development Philosophy（MVP 唯一 public API）。
 * 纯函数：同一 `clubId` 在任何时间调用都返回**完全相同**的结果。
 * @param {string} clubId
 * @returns {{developmentCommitment:number, youthOpportunityPreference:number}}
 */
export function evaluateDevelopmentPhilosophy(clubId) {
  return resolveDevelopmentPhilosophy(getAIClubPolicy(clubId).id);
}
