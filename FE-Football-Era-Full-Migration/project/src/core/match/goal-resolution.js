/**
 * Goal / Score Resolution Foundation（Step 39F-M-C-14）。
 * 层级归属：Simulation Core / Match Orchestration。**纯函数、确定性、无 Math.random、无墙钟**。
 *
 * 因果链（单向，冻结）：
 *   Goal Candidate（由合法上游提供）→ resolveGoal → GoalResolutionResult → applyGoalScoreUpdate → matchCore.score（唯一 Score Truth）
 *
 * 重要范围声明（见 config 审计）：
 * - 当前工程没有官方「球门线 / 球越过球门线」Truth；C-14 **不实现球门物理**。
 * - `deriveGoalCandidate` 仅对**显式提供的候选描述**做归一化 / 校验；候选来源（Goal-Line Crossing）属上游 / Deferred。
 *
 * 关键边界：
 * - **第二套 Score Truth 禁止**：只写 `matchCore.score`；`GOAL_SCORE_*` 等一律不建。
 * - **写入唯一入口**：仅 `applyGoalScoreUpdate` 改比分；Resolution 本身不改 MatchCore。
 * - **幂等（纯状态收敛）**：GoResolutionResult 携带 `nextScore` 目标快照，写入层按「单调收敛（取 max）」应用，
 *   同一结果重复应用不重复加分；**不向 MatchCore 增加任何永久字段，不建 Ledger**。
 * - **隔离**：不改 Ball / Possession / Player / Clock / Phase / Teams / Tactics。
 *
 * Deferred：Goal-Line Crossing / Ball Physics / GK / VAR / Offside / Own Goal 归属 / 球员统计 / Event Bus。
 */

import {
  GOAL_CANDIDATE_FIELDS, GOAL_FORBIDDEN_PHASE, GOAL_OUTCOME, GOAL_REASON,
  GOAL_RESOLUTION_RULE_VERSION, GOAL_RESULT_FIELDS,
} from './goal-resolution-config.js';

/** 结构判断：是否为（归一化后的）纯数据 Goal Candidate。 */
export function isGoalCandidate(candidate) {
  return !!candidate && typeof candidate === 'object' && candidate.ok === true
    && typeof candidate.teamId === 'string';
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** 读取并校验当前官方 Score Truth（唯一）。 */
function readScore(matchCore) {
  const s = matchCore?.score;
  if (!s || typeof s !== 'object' || !isFiniteNumber(s.home) || !isFiniteNumber(s.away)) {
    throw new TypeError('goal-resolution: matchCore.score 缺失或非法（不得新建 Score Truth）');
  }
  return { home: s.home, away: s.away };
}

/** 判定进球方（home/away）。 */
function scoringSideOf(teamId, matchCore) {
  const teams = matchCore?.teams ?? {};
  if (teams.home != null && teamId === teams.home) return 'home';
  if (teams.away != null && teamId === teams.away) return 'away';
  return null;
}

/**
 * 归一化外部显式提供的 Goal Candidate 描述为纯数据 Goal Candidate。
 * **不做球门物理**：候选来源（球越过球门线）必须由合法上游判定并提供（Deferred）。
 *
 * @param {object} matchCore 当前 MatchCore（只读）
 * @param {object} [options] { goalCandidate: { teamId, playerId?, ballState?, reason?, goalId? }, source? }
 * @returns {{ok:true, teamId, playerId, ballState, reason, source, goalId} | {ok:false, reason}}
 */
export function deriveGoalCandidate(matchCore, options = {}) {
  if (!matchCore || typeof matchCore !== 'object') throw new TypeError('deriveGoalCandidate: matchCore 必须为对象');
  const raw = options.goalCandidate;
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: GOAL_REASON.NO_CANDIDATE_SOURCE };
  }
  if (typeof raw.teamId !== 'string' || raw.teamId.length === 0) {
    return { ok: false, reason: GOAL_REASON.INVALID_CANDIDATE };
  }
  if (scoringSideOf(raw.teamId, matchCore) === null) {
    return { ok: false, reason: GOAL_REASON.UNKNOWN_TEAM };
  }
  return {
    ok: true,
    teamId: raw.teamId,
    playerId: typeof raw.playerId === 'string' ? raw.playerId : null,
    ballState: typeof raw.ballState === 'string' ? raw.ballState : null,
    reason: typeof raw.reason === 'string' ? raw.reason : 'GOAL_CANDIDATE',
    source: typeof raw.source === 'string' ? raw.source : (options.source ?? 'EXPLICIT_UPSTREAM'),
    goalId: typeof raw.goalId === 'string' ? raw.goalId : null,
  };
}

/**
 * 判定 Candidate 是否构成正式进球（纯函数；**不修改 MatchCore**）。
 *
 * @param {object} candidate 归一化 Goal Candidate
 * @param {object} matchCore 当前 MatchCore（只读）
 * @param {object} [options] { phase?: string } C-12 Phase（终态禁止进球）
 * @returns {{ok:true, outcome:'GOAL_CONFIRMED', ...} | {ok:false, outcome:'NO_GOAL', reason}}
 */
export function resolveGoal(candidate, matchCore, options = {}) {
  if (!matchCore || typeof matchCore !== 'object') throw new TypeError('resolveGoal: matchCore 必须为对象');

  const noGoal = (reason) => ({
    ok: false, outcome: GOAL_OUTCOME.NO_GOAL, reason, ruleVersion: GOAL_RESOLUTION_RULE_VERSION,
    scoringTeamId: null, scoringPlayerId: null, scoringSide: null, goalId: null, nextScore: null,
  });

  if (!isGoalCandidate(candidate)) return noGoal(GOAL_REASON.INVALID_CANDIDATE);

  // 比赛阶段隔离：REGULATION_COMPLETE 不得用进球重新打开比赛。
  const phase = options.phase ?? null;
  if (phase === GOAL_FORBIDDEN_PHASE) return noGoal(GOAL_REASON.PHASE_TERMINAL);

  const side = scoringSideOf(candidate.teamId, matchCore);
  if (side === null) return noGoal(GOAL_REASON.UNKNOWN_TEAM);

  const score = readScore(matchCore);
  const nextScore = { home: score.home + (side === 'home' ? 1 : 0), away: score.away + (side === 'away' ? 1 : 0) };

  return {
    ok: true,
    outcome: GOAL_OUTCOME.GOAL_CONFIRMED,
    reason: GOAL_REASON.VALID_GOAL,
    ruleVersion: GOAL_RESOLUTION_RULE_VERSION,
    scoringTeamId: candidate.teamId,
    scoringPlayerId: candidate.playerId ?? null,
    scoringSide: side,
    goalId: candidate.goalId ?? null,
    nextScore,
  };
}

/**
 * Score State Update：把确认的进球写入唯一 Score Truth。
 * **纯函数**：返回新 MatchCore，不原地修改输入；**只改 score**，其余字段（ball/players/teams/tactical/clock）保持不变。
 * **幂等（单调收敛）**：按 nextScore 逐侧取 max；同一结果重复应用不重复加分。
 *
 * @param {object} matchCore 当前 MatchCore（只读）
 * @param {object} goalResult GoalResolutionResult
 * @returns {object} 新 MatchCore（或未进球时原样返回）
 */
export function applyGoalScoreUpdate(matchCore, goalResult) {
  if (!matchCore || typeof matchCore !== 'object') throw new TypeError('applyGoalScoreUpdate: matchCore 必须为对象');
  if (!goalResult || goalResult.ok !== true || goalResult.outcome !== GOAL_OUTCOME.GOAL_CONFIRMED) {
    return matchCore; // 未确认进球 → 无操作（不修改任何状态）。
  }
  const current = readScore(matchCore);
  const target = goalResult.nextScore;
  if (!target || !isFiniteNumber(target.home) || !isFiniteNumber(target.away)) {
    throw new TypeError('applyGoalScoreUpdate: goalResult.nextScore 非法');
  }
  if (current.home === target.home && current.away === target.away) {
    return matchCore; // 已收敛 → 幂等，无变化。
  }
  // 单调收敛：永不减少；相同输入重复应用结果一致。
  const score = { home: Math.max(current.home, target.home), away: Math.max(current.away, target.away) };
  return { ...matchCore, score };
}

/**
 * 校验 GoalResolutionResult（纯函数，不抛异常）。严格白名单。
 * @returns {{valid:boolean, issues:string[]}}
 */
export function validateGoalResolutionResult(result) {
  const issues = [];
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { valid: false, issues: ['RESULT_NOT_OBJECT'] };
  }
  for (const key of Object.keys(result)) {
    if (!GOAL_RESULT_FIELDS.includes(key)) issues.push(`UNKNOWN_FIELD:${key}`);
  }
  if (typeof result.ok !== 'boolean') issues.push('INVALID_OK');
  if (result.outcome !== GOAL_OUTCOME.GOAL_CONFIRMED && result.outcome !== GOAL_OUTCOME.NO_GOAL) {
    issues.push('INVALID_OUTCOME');
  }
  if (typeof result.reason !== 'string') issues.push('INVALID_REASON');
  if (result.ruleVersion !== GOAL_RESOLUTION_RULE_VERSION) issues.push('INVALID_RULE_VERSION');

  if (result.outcome === GOAL_OUTCOME.GOAL_CONFIRMED) {
    if (result.ok !== true) issues.push('CONFIRMED_REQUIRES_OK');
    if (typeof result.scoringTeamId !== 'string') issues.push('INVALID_SCORING_TEAM');
    if (!(result.scoringPlayerId === null || typeof result.scoringPlayerId === 'string')) issues.push('INVALID_SCORING_PLAYER');
    if (result.scoringSide !== 'home' && result.scoringSide !== 'away') issues.push('INVALID_SCORING_SIDE');
    if (!(result.goalId === null || typeof result.goalId === 'string')) issues.push('INVALID_GOAL_ID');
    const ns = result.nextScore;
    if (!ns || typeof ns !== 'object' || !isFiniteNumber(ns.home) || !isFiniteNumber(ns.away)) {
      issues.push('INVALID_NEXT_SCORE');
    }
  } else {
    if (result.ok !== false) issues.push('NO_GOAL_REQUIRES_NOT_OK');
    if (result.nextScore !== null) issues.push('NO_GOAL_REQUIRES_NULL_NEXT_SCORE');
  }
  return { valid: issues.length === 0, issues };
}

/** 规则版本（metadata）。 */
export const GOAL_RESOLUTION_CONFIG_VERSION = GOAL_RESOLUTION_RULE_VERSION;