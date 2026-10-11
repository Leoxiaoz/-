/**
 * AI Club Policy（最小、确定性、无持久化）—— Step 31 / D-AI-20。
 * 层级归属：Simulation Core / AI。纯函数，**不依赖 DOM / 存储 / UI**，**无 RNG**。
 *
 * 语义：用 `hashSeed(clubId | 'ai-policy')` 在固定档位间**确定性派生** club policy。
 * - **不持久化**、**不给 clubs 增加字段**、**不污染** match/growth/injury/retire/gen RNG 命名空间。
 * - 同一 clubId 永远返回同一 policy（纯函数）。
 * - 仅影响少量 AI 参数（potential 权重 / 预算储备比例 / 是否启用 Soft Need），**不是人格系统**。
 */

import { hashSeed } from '../rng.js';
import { AI_CONFIG } from './ai-config.js';

/**
 * @param {string} clubId
 * @returns {{id: string, potentialWeight: number, reserveRatio: number, softNeedEnabled: boolean}}
 */
export function getAIClubPolicy(clubId) {
  const list = AI_CONFIG.POLICIES;
  const idx = hashSeed(`${clubId}|ai-policy`) % list.length;
  return list[idx];
}
