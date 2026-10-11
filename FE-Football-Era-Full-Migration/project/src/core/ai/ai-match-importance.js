/**
 * Match Importance（D39 Phase 1 / Step 39F-A）。
 * 层级归属：Simulation Core / AI。纯派生、只读、无 RNG、不持久化。
 *
 * 规范来源：D39-P（Step 39C 冻结）/ Step 39E-R §三 尾部。
 * Phase 1：League Match Importance **固定 NORMAL**。
 *
 * 明确 Deferred（本阶段不得加入）：Rivalry、Ranking、Title Race、Relegation Race、
 * Season Phase、Points Gap、Objective Zone、Remaining Matches。
 *
 * 说明：本模块只**建立 Phase 4/5 所需接口**；Phase 1 **不改变任何比赛行为**
 * （不修改 Match Engine、不改 resolveMatchSquad / selectMatchSquad）。
 */

/** Match Importance 枚举。 */
export const MATCH_IMPORTANCE = Object.freeze({
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

/**
 * 取某场比赛的 Match Importance。Phase 1 恒为 `NORMAL`（确定性、无副作用）。
 * @returns {'NORMAL'}
 */
export function getMatchImportance(/* state, context */) {
  return MATCH_IMPORTANCE.NORMAL;
}
