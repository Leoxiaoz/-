/**
 * Match Result / Finalization Foundation（Step 39F-M-C-13）。
 * 层级归属：Simulation Core / Match Orchestration。**纯函数、只读、无副作用、无 Math.random、无墙钟**。
 *
 * 因果链（单向，冻结）：
 *   MatchClock(C-11) → MatchPhase(C-12) → REGULATION_COMPLETE → C-13 Finalization → FinalMatchResult
 *
 * FinalMatchResult 是 **Post-Match Snapshot**（纯 JSON 快照），不是 MatchCore Truth：
 * - 只读 MatchCore / MatchPhase / MatchClock；绝不原地修改它们。
 * - 不持有任何可变对象引用（深拷贝基本值）。
 * - 不反向参与比赛模拟；无 finalization counter / timestamp / random id。
 *
 * 复用 Truth（不新建）：
 * - 比分 Truth：`matchCore.score.{home,away}`
 * - 身份 Truth：`matchCore.teams.{home,away}` + `matchId / worldId / season`
 *
 * Deferred：Extra Time / Penalty / Added Time / 积分榜 / 赛季结算 / 球员统计 / Save·Load / Schema / Renderer。
 */

import {
  MATCH_RESULT_STATUS, MATCH_RESULT_RULE_VERSION,
  FINAL_MATCH_RESULT_FIELDS, FINAL_RESULT_SIDE_FIELDS, FINAL_PHASE,
} from './match-result-config.js';
import { MATCH_CLOCK_CONFIG } from './match-clock-config.js';
import { validateMatchClock } from './match-clock.js';
import { validateMatchPhase } from './match-phase.js';

const { REGULATION_DURATION_SECONDS } = MATCH_CLOCK_CONFIG;

/** 仅当阶段为 REGULATION_COMPLETE 时才允许 Finalization（唯一 Phase Truth = C-12）。 */
export function isMatchFinalizable(phaseState) {
  return phaseState?.phase === FINAL_PHASE;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** 从 matchCore 读取身份字段（复用已有 Truth；缺失 → null，不虚构）。 */
function readIdentity(matchCore) {
  const pick = (v) => (v === undefined ? null : v);
  return { matchId: pick(matchCore.matchId), worldId: pick(matchCore.worldId), season: pick(matchCore.season) };
}

/**
 * 创建 FinalMatchResult 快照（严格纯函数）。
 * 要求 phaseState 为 REGULATION_COMPLETE；否则抛出（由 finalizeMatch 负责非抛出的拒绝分支）。
 *
 * @param {object} matchCore 当前 MatchCore Truth（只读；不修改、不持有引用）
 * @param {object} phaseState 当前 Match Phase（只读）
 * @param {object} clockState 当前 Match Clock（C-11；唯一时间 Truth）
 * @returns {object} FinalMatchResult（纯 JSON）
 */
export function createFinalMatchResult(matchCore, phaseState, clockState) {
  if (!matchCore || typeof matchCore !== 'object') throw new TypeError('createFinalMatchResult: matchCore 必须为对象');
  const phaseCheck = validateMatchPhase(phaseState);
  if (!phaseCheck.valid) throw new TypeError(`createFinalMatchResult: 非法 Match Phase: ${phaseCheck.issues.join(',')}`);
  const clockCheck = validateMatchClock(clockState);
  if (!clockCheck.valid) throw new TypeError(`createFinalMatchResult: 非法 Match Clock: ${clockCheck.issues.join(',')}`);
  if (!isMatchFinalizable(phaseState)) {
    throw new TypeError(`createFinalMatchResult: 仅 REGULATION_COMPLETE 可终结，实际: ${phaseState.phase}`);
  }
  // 单一时间 Truth：读取 C-11 Clock；并要求其与终场一致（不得自造时间）。
  if (clockState.elapsedSeconds !== REGULATION_DURATION_SECONDS) {
    throw new TypeError(`createFinalMatchResult: 终场时间不一致: ${clockState.elapsedSeconds}`);
  }
  const score = matchCore.score;
  if (!score || typeof score !== 'object' || !isFiniteNumber(score.home) || !isFiniteNumber(score.away)) {
    throw new TypeError('createFinalMatchResult: matchCore.score 缺失或非法（不得新建 Score Truth）');
  }
  const teams = matchCore.teams ?? {};
  const identity = readIdentity(matchCore);

  // 构造新对象：仅复制基本值，不持有 matchCore / teams / score 引用。
  return {
    ok: true,
    status: MATCH_RESULT_STATUS.FINAL,
    phase: FINAL_PHASE,
    elapsedSeconds: clockState.elapsedSeconds,
    matchId: identity.matchId,
    worldId: identity.worldId,
    season: identity.season,
    home: { teamId: teams.home ?? null, score: score.home },
    away: { teamId: teams.away ?? null, score: score.away },
  };
}

/**
 * 校验 FinalMatchResult（纯函数，不抛异常）。
 * 严格：白名单字段 + 类型 + 取值范围；拒绝 NaN / Infinity / 非法 status / phase / score / elapsedSeconds。
 * @returns {{valid:boolean, issues:string[]}}
 */
export function validateFinalMatchResult(result) {
  const issues = [];
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { valid: false, issues: ['RESULT_NOT_OBJECT'] };
  }
  // 未知字段拒绝（严格 schema）。
  for (const key of Object.keys(result)) {
    if (!FINAL_MATCH_RESULT_FIELDS.includes(key)) issues.push(`UNKNOWN_FIELD:${key}`);
  }
  if (result.ok !== true) issues.push('INVALID_OK');
  if (result.status !== MATCH_RESULT_STATUS.FINAL) issues.push('INVALID_STATUS');
  if (result.phase !== FINAL_PHASE) issues.push('INVALID_PHASE');
  if (result.elapsedSeconds !== REGULATION_DURATION_SECONDS) issues.push('INVALID_ELAPSED_SECONDS');

  for (const side of ['home', 'away']) {
    const s = result[side];
    if (!s || typeof s !== 'object' || Array.isArray(s)) { issues.push(`INVALID_SIDE:${side}`); continue; }
    for (const key of Object.keys(s)) {
      if (!FINAL_RESULT_SIDE_FIELDS.includes(key)) issues.push(`UNKNOWN_SIDE_FIELD:${side}.${key}`);
    }
    if (!(s.teamId === null || typeof s.teamId === 'string')) issues.push(`INVALID_TEAM_ID:${side}`);
    if (!isFiniteNumber(s.score) || s.score < 0) issues.push(`INVALID_SCORE:${side}`);
  }
  return { valid: issues.length === 0, issues };
}

/**
 * 终结比赛：将 REGULATION_COMPLETE 转换为 FinalMatchResult（非抛出的编排入口）。
 * - 非终场 → 返回确定性 `{ ok:false, status:'NOT_FINALIZABLE', phase, reason }`（不抛异常）。
 * - 不修改 matchCore / phaseState / clockState。
 * - 重复调用结果确定性一致。
 *
 * @returns {object} FinalMatchResult 或 `{ ok:false, status, phase, reason }`
 */
export function finalizeMatch(matchCore, phaseState, clockState) {
  if (!matchCore || typeof matchCore !== 'object') throw new TypeError('finalizeMatch: matchCore 必须为对象');
  if (!isMatchFinalizable(phaseState)) {
    return {
      ok: false, status: 'NOT_FINALIZABLE', phase: phaseState?.phase ?? null, reason: 'MATCH_NOT_REGULATION_COMPLETE',
    };
  }
  return createFinalMatchResult(matchCore, phaseState, clockState);
}

/** 规则版本（metadata）。 */
export const MATCH_RESULT_CONFIG_VERSION = MATCH_RESULT_RULE_VERSION;