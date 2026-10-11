/**
 * Match Result 配置（Step 39F-M-C-13）。
 * 层级归属：Simulation Core / Match Orchestration。纯数据，无副作用、无 RNG、无墙钟。
 *
 * 范围：定义「Post-Match Snapshot」（FinalMatchResult）的状态常量与字段白名单。
 *
 * 关键原则（冻结）：
 * - FinalMatchResult 是 **只读快照**，不是 MatchCore Truth，不反向参与模拟。
 * - **复用**已有 Truth：比分 Truth = `matchCore.score`（`{ home, away }`）；
 *   身份 Truth = `matchCore.teams`（`{ home, away }`）+ `matchId / worldId / season`。
 * - 不新建第二套 Score / Identity Truth；不新增比赛生命周期阶段（终态仅由 C-12 决定）。
 *
 * 红线：不使用 Date.now / new Date / performance.now / Math.random；
 * 不实现赛后系统（积分榜 / 赛季结算 / 球员统计 / Save·Load / Schema / Renderer）。
 */

/** Match Result 规则版本（仅 metadata；非 schema 字段）。 */
export const MATCH_RESULT_RULE_VERSION = 'match-result-v1';

/** FinalMatchResult 状态枚举（仅 FINAL；不引入 FINALIZING / SETTLED / ARCHIVED 等新阶段）。 */
export const MATCH_RESULT_STATUS = Object.freeze({
  FINAL: 'FINAL',
});

/**
 * FinalMatchResult 顶层允许字段（严格白名单，服从项目既有严格校验风格）。
 * 说明：均为 snapshot 副本字段；不含任何 Truth 引用。
 */
export const FINAL_MATCH_RESULT_FIELDS = Object.freeze([
  'ok', 'status', 'phase', 'elapsedSeconds', 'matchId', 'worldId', 'season', 'home', 'away',
]);

/** home / away 子结构允许字段。 */
export const FINAL_RESULT_SIDE_FIELDS = Object.freeze(['teamId', 'score']);

/** 终场要求的阶段（唯一 Match Phase Truth = C-12 MatchPhase）。 */
export const FINAL_PHASE = 'REGULATION_COMPLETE';