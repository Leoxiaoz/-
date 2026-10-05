/**
 * Goal Resolution 配置（Step 39F-M-C-14）。
 * 层级归属：Simulation Core / Match Orchestration。纯数据，无副作用、无 RNG、无墙钟。
 *
 * 范围：定义「Goal Candidate → Goal Resolution → Score State Update → matchCore.score」链路常量。
 *
 * 关键事实（冻结，来自实现前审计）：
 * - 官方 Score Truth = `matchCore.score: { home, away }`（唯一；C-13 已确认）。C-14 只写入它。
 * - 当前工程 **没有** 官方「球门线 / 球门区域 / 球越过球门线」Truth：
 *   `GOAL = { x:1, y:0.5 }` 仅是射门目标点；Ball State 仅为 CONTROLLED/FREE/IN_TRANSIT；
 *   PITCH_MIN/MAX = 0/1 仅为坐标 invariant，不是球门几何。
 * - 因此 C-14 **不实现** 球门物理；Goal Candidate 由合法上游显式提供
 *   （未来 Ball Physics / Goal-Line Crossing Gate），C-14 只负责候选→确认→写比分。
 *
 * 红线：不新建第二套 Score Truth；不新增 MatchCore 永久字段；不建 Event Bus / Ledger；
 * 不实现 GK / VAR / Offside / Own Goal 归属 / 球员统计；无 Math.random / 墙钟。
 */

/** Goal Resolution 规则版本（仅 metadata）。 */
export const GOAL_RESOLUTION_RULE_VERSION = 'goal-resolution-v1';

/** 解析结果枚举。 */
export const GOAL_OUTCOME = Object.freeze({
  GOAL_CONFIRMED: 'GOAL_CONFIRMED',
  NO_GOAL: 'NO_GOAL',
});

/** 拒绝 / 确认原因枚举（确定性 reason）。 */
export const GOAL_REASON = Object.freeze({
  VALID_GOAL: 'VALID_GOAL',
  INVALID_CANDIDATE: 'INVALID_CANDIDATE',
  NO_CANDIDATE_SOURCE: 'NO_CANDIDATE_SOURCE',
  UNKNOWN_TEAM: 'UNKNOWN_TEAM',
  PHASE_TERMINAL: 'PHASE_TERMINAL',           // 比赛已 REGULATION_COMPLETE → 不允许进球
  NOT_A_GOAL: 'NOT_A_GOAL',
});

/** Goal Candidate 允许字段（纯数据白名单；不含函数 / MatchCore 引用）。 */
export const GOAL_CANDIDATE_FIELDS = Object.freeze([
  'ok', 'teamId', 'playerId', 'ballState', 'reason', 'source', 'goalId',
]);

/** GoalResolutionResult 允许字段（确认分支）。 */
export const GOAL_RESULT_FIELDS = Object.freeze([
  'ok', 'outcome', 'reason', 'ruleVersion',
  'scoringTeamId', 'scoringPlayerId', 'scoringSide', 'goalId', 'nextScore',
]);

/** 进球被禁止的比赛阶段（唯一 Match Phase Truth = C-12）。 */
export const GOAL_FORBIDDEN_PHASE = 'REGULATION_COMPLETE';