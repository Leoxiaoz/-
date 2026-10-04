/**
 * Interaction Integration / Orchestration（Step 39F-M-C-06）。
 * 层级归属：Simulation Core / Match Resolution。**纯函数、无副作用、无 Math.random**。
 *
 * 职责：把 C-05 产出的 `InteractionResolutionResult` 以确定性、单向、可测试的方式交给
 * `applyInteractionStateUpdate`，形成一致的基础 possession / control / transit 写回语义。
 *
 * 数据流（单向）：
 *   ActionInstance → Interaction Resolution → InteractionResolutionResult
 *     → Integration / Orchestration → State Update → MatchCore Truth
 *
 * 关键边界（冻结）：
 * - **Resolution ≠ State Mutation**：本层不直接修改 MatchCore；唯一的 mutation 层是 state-update。
 * - **Integration ≠ Production Loop**：不接 match tick / minute sim / renderer / UI。
 * - **不重算 Resolution**：只消费 Result（不判断成功概率 / 不调用 RNG）。
 * - **单一 Ball Truth**：不保存第二份 ball state / 不维护第二份 possession truth；
 *   本层数据均为 transient / derived / read-only。
 * - **Input immutable**：不修改 Result / ActionInstance / 输入 MatchCore。
 *
 * 幂等：同一 Result 重复消费通过「确定性目标状态收敛」实现——不引入持久化 ledger，
 * 不改 Save Format / Schema。第二次消费检测到球已处于目标状态即返回 `ALREADY_APPLIED`。
 */

import { applyInteractionStateUpdate } from './interaction-state-update.js';
import { resolveInteraction } from './interaction-resolution.js';
import { INTERACTION_BALL_STATE as BS } from './interaction-resolution-config.js';

/** 集成结果原因枚举。 */
export const INTEGRATION_REASONS = Object.freeze({
  APPLIED: 'APPLIED',                         // 首次消费并写入新状态
  ALREADY_APPLIED: 'ALREADY_APPLIED',         // 球已处于该 Result 的目标状态（幂等）
  RESULT_NOT_APPLICABLE: 'RESULT_NOT_APPLICABLE', // ok:false / 类型不符 → 不改状态
  INVALID_RESULT: 'INVALID_RESULT',           // 入参非法
});

/** 序列化 ball（比较用；null → 'null'）。 */
function ballJson(ball) {
  return JSON.stringify(ball ?? null);
}

/**
 * 派生 application key（确定性、transient；**不写入 MatchCore**）。
 * 仅用于追踪 / 可解释性；幂等判定依赖目标状态收敛，不依赖此 key。
 */
export function deriveApplicationKey(matchCore, result) {
  return [
    matchCore?.worldId ?? '', matchCore?.season ?? '', matchCore?.matchId ?? '',
    result?.actionType ?? '', result?.outcome ?? '',
    result?.actorId ?? '', result?.targetId ?? '',
    result?.resolutionMeta?.sequence ?? 0,
    result?.resolutionMeta?.rngScope ?? '',
  ].join('|');
}

// ===========================================================================
// Ball / Possession 一致性检查（纯函数；只读，不修状态）
// ===========================================================================

/**
 * 检查 ball 自身一致性（不含球员表）：
 * - FREE → 不得有 control / possessingTeamId。
 * - IN_TRANSIT → 不得有 control / possessingTeamId。
 * - CONTROLLED → 必须有 control 与 possessingTeamId。
 * @returns {string[]} 问题列表（空 = 通过）
 */
export function checkBallInvariants(ball) {
  if (!ball || typeof ball !== 'object') return ['NO_BALL'];
  const issues = [];
  const state = ball.state;
  const control = ball.control ?? null;
  const team = ball.possessingTeamId ?? null;
  if (state === BS.FREE) {
    if (control !== null) issues.push('FREE_HAS_CONTROL');
    if (team !== null) issues.push('FREE_HAS_POSSESSING_TEAM');
  } else if (state === BS.IN_TRANSIT) {
    if (control !== null) issues.push('IN_TRANSIT_HAS_CONTROL');
    if (team !== null) issues.push('IN_TRANSIT_HAS_POSSESSING_TEAM');
  } else if (state === BS.CONTROLLED) {
    if (control === null) issues.push('CONTROLLED_WITHOUT_CONTROL');
    if (team === null) issues.push('CONTROLLED_WITHOUT_POSSESSING_TEAM');
  }
  return issues;
}

/**
 * 检查 MatchCore 级一致性（含球员→球队映射；Invariant 1）。
 * @returns {string[]} 问题列表（空 = 通过）
 */
export function checkMatchInvariants(matchCore) {
  const ball = matchCore?.ball;
  if (!ball || typeof ball !== 'object') return ['NO_BALL'];
  const issues = checkBallInvariants(ball);
  const control = ball.control ?? null;
  if (control !== null) {
    const p = (Array.isArray(matchCore?.players) ? matchCore.players : []).find((x) => x.playerId === control);
    if (!p) issues.push('CONTROL_PLAYER_NOT_FOUND');
    else if (ball.possessingTeamId !== p.teamId) issues.push('CONTROL_TEAM_MISMATCH');
  }
  if (ball.state === BS.FREE || ball.state === BS.IN_TRANSIT) {
    if (control !== null || (ball.possessingTeamId ?? null) !== null) issues.push('NON_CONTROLLED_LEAKS_POSSESSION');
  }
  return issues;
}

// ===========================================================================
// Integration
// ===========================================================================

/**
 * 将 `InteractionResolutionResult` 集成进 MatchCore。
 *
 * 语义：
 * - 唯一 mutation 路径 = `applyInteractionStateUpdate`（本函数不自行拼 ball）。
 * - 若结果非法 / 不适用 → 原样返回输入 matchCore，`applied:false`。
 * - 若球已处于该 Result 的确定性目标状态 → `applied:false`（`ALREADY_APPLIED`，幂等）。
 * - 否则返回 state-update 产出的新 matchCore（`applied:true`）。
 *
 * @param {object} matchCore 当前 MatchCore Truth（只读）
 * @param {object} result InteractionResolutionResult（只读）
 * @param {{}} [options] 预留；本层不使用（保持确定性）
 * @returns {{matchCore:object, applied:boolean, reason:string, applicationKey:string|null, invariantIssues:string[]}}
 */
export function integrateInteractionResolution(matchCore, result, options = {}) { // eslint-disable-line no-unused-vars
  if (!matchCore || !result || typeof result !== 'object') {
    return {
      matchCore, applied: false, reason: INTEGRATION_REASONS.INVALID_RESULT,
      applicationKey: null, invariantIssues: matchCore ? checkMatchInvariants(matchCore) : [],
    };
  }
  const applicationKey = deriveApplicationKey(matchCore, result);

  if (result.type !== 'INTERACTION_RESOLUTION' || !result.ok || !result.ball || !result.ball.state) {
    return {
      matchCore, applied: false, reason: INTEGRATION_REASONS.RESULT_NOT_APPLICABLE,
      applicationKey, invariantIssues: checkMatchInvariants(matchCore),
    };
  }

  // 唯一 authoritative mutation 层。
  const candidate = applyInteractionStateUpdate(matchCore, result);
  const changed = ballJson(candidate?.ball) !== ballJson(matchCore.ball);
  const next = changed ? candidate : matchCore;
  return {
    matchCore: next,
    applied: changed,
    reason: changed ? INTEGRATION_REASONS.APPLIED : INTEGRATION_REASONS.ALREADY_APPLIED,
    applicationKey,
    invariantIssues: checkMatchInvariants(next),
  };
}

/**
 * 编排入口：ActionInstance → Resolution → Integration → State Update。
 * 仅组合 C-05 `resolveInteraction` 与上面的集成函数；**不新增任何 Resolution 规则**。
 *
 * @param {object} actionInstance
 * @param {object} matchCore
 * @param {{seed?:string, sequence?:number, ruleVersion?:string, debug?:boolean}} [options]
 * @returns {{matchCore:object, applied:boolean, reason:string, applicationKey:string|null, invariantIssues:string[], result:object}}
 */
export function resolveAndIntegrateInteraction(actionInstance, matchCore, options = {}) {
  const result = resolveInteraction(actionInstance, matchCore, options);
  const envelope = integrateInteractionResolution(matchCore, result);
  return { ...envelope, result };
}