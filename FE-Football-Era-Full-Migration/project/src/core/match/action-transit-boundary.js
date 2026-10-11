/**
 * Action → Transit Boundary（Action→Transit Boundary Implementation Gate）。
 * 层级归属：Simulation Core / Match Orchestration。**薄适配层**、确定性、无 Math.random、无墙钟。
 *
 * 职责：在 **C-08 `runMatchTick` 正常完成后**接管 PASS / SHOT —— 复用既有纯解析器
 * （`resolvePass` / `resolveShot`）与既有状态更新器（`applyPassStateUpdate` / `applyShotStateUpdate`），
 * 把球合法安装为 `IN_TRANSIT`（含 `ball.transit`）。
 *
 * 冻结语义（Owner 批准，方案 B）：
 * - **不复制、不重写** C-08 Tick 流程：先调用 `runMatchTick`，本层只做「解析 + 安装」。
 * - **不修改 C-08 冻结顺序**：本层运行于 C-08 **之后**。
 * - **Tick N 安装 → Tick N+1 推进**：新安装的 transit 最早在下一 Tick 的 CONTINUOUS_TRANSIT（C-39）推进。
 * - **C-05 保持原样**：PASS / SHOT 在交互解析阶段仍返回 `INTERACTION_UNSUPPORTED`（非致命）；本层接管。
 * - **唯一安装入口**：只经 `applyPassStateUpdate` / `applyShotStateUpdate` 写 ball；本层**不自行拼装 ball**、
 *   **不写 score**、**不移动球**、**不伪造 transit 完成**。
 * - **候选 + 回滚**：安装走候选状态，经 `checkTickInvariants` 校验；不合法则放弃候选、保留 C-08 结果。
 *
 * 红线：不修改 MatchCore 的 Score / Stats / Growth / Save / Match Result；不产生 Event；
 * 不调用 Decision；无第二套 Ball / Transit Truth。
 *
 * Deferred：Goal-Line / Ball Physics 扩展 / 生产 Match Loop / 赛季接入 / §42–§46 门线权威。
 */

import { runMatchTick, checkTickInvariants } from './match-tick.js';
import { resolvePass } from './pass-resolution.js';
import { resolveShot } from './shot-resolution.js';
import { applyPassStateUpdate } from './pass-state-update.js';
import { applyShotStateUpdate } from './shot-state-update.js';

export const ACTION_TRANSIT_BOUNDARY_VERSION = 'action-transit-boundary-v1';

/** 安装状态（明确区分未尝试 / 不适用 / 解析失败 / 不变量失败 / 成功）。 */
export const ACTION_INSTALL_STATUS = Object.freeze({
  NOT_ATTEMPTED: 'NOT_ATTEMPTED',         // 无动作 或 C-08 未正常完成
  NOT_APPLICABLE: 'NOT_APPLICABLE',       // 非 PASS / SHOT（原样透传）
  FAILED_RESOLUTION: 'FAILED_RESOLUTION', // 解析失败 / 取消 / 结果无可安装 transit
  FAILED_INVARIANT: 'FAILED_INVARIANT',   // 候选状态不合法 → 放弃候选（保留 C-08 结果）
  INSTALLED: 'INSTALLED',                 // 成功安装
});

/** 安装原因（可诊断）。 */
export const ACTION_INSTALL_REASON = Object.freeze({
  NO_ACTION: 'NO_ACTION',
  TICK_NOT_COMPLETED: 'TICK_NOT_COMPLETED',
  NON_TRANSIT_ACTION: 'NON_TRANSIT_ACTION',
  RESOLUTION_FAILED: 'RESOLUTION_FAILED',
  NO_TRANSIT_IN_RESULT: 'NO_TRANSIT_IN_RESULT',
  CANDIDATE_UNCHANGED: 'CANDIDATE_UNCHANGED',
  INVARIANT_VIOLATION: 'INVARIANT_VIOLATION',
  APPLIED: 'APPLIED',
});

/** 构造 actionInstall 结构（统一字段）。 */
function install(status, reason, actionType, extra = {}) {
  return {
    status,
    applied: status === ACTION_INSTALL_STATUS.INSTALLED,
    reason,
    actionType: actionType ?? null,
    ...extra,
  };
}

/**
 * 在 C-08 Tick 完成后，按真实 ActionInstance 接管 PASS / SHOT 的 Transit 安装。
 *
 * @param {object} matchCore 当前 MatchCore Truth
 * @param {object} [tickInput] 原样透传给 C-08 的 tickInput（含 actionInstance / playerId / seed / deltaTime）
 * @param {object} [options] 原样透传给 C-08 的 options；本层额外读取：
 *   seed?, passSequence?, shotSequence?, passRuleVersion?, shotRuleVersion?
 * @returns {object} C-08 TickResult 的**全部既有字段** + `actionResolution` + `actionInstall`
 */
export function runMatchTickWithActions(matchCore, tickInput = {}, options = {}) {
  const tick = runMatchTick(matchCore, tickInput, options);

  // C-08 非正常完成：原样保留，不安装。
  if (!tick || !tick.tick || tick.tick.status !== 'COMPLETED') {
    return {
      ...tick,
      actionResolution: null,
      actionInstall: install(
        ACTION_INSTALL_STATUS.NOT_ATTEMPTED,
        ACTION_INSTALL_REASON.TICK_NOT_COMPLETED,
        tick?.actionInstance?.actionType ?? null,
      ),
    };
  }

  const ai = tick.actionInstance;
  // 无动作：不安装。
  if (!ai || typeof ai !== 'object') {
    return {
      ...tick,
      actionResolution: null,
      actionInstall: install(ACTION_INSTALL_STATUS.NOT_ATTEMPTED, ACTION_INSTALL_REASON.NO_ACTION, null),
    };
  }

  const actionType = ai.actionType;
  // 非 PASS / SHOT：原样透传（不调用解析器 / 更新器）。
  if (actionType !== 'PASS' && actionType !== 'SHOT') {
    return {
      ...tick,
      actionResolution: null,
      actionInstall: install(ACTION_INSTALL_STATUS.NOT_APPLICABLE, ACTION_INSTALL_REASON.NON_TRANSIT_ACTION, actionType),
    };
  }

  // 依据真实 ActionInstance 路由解析器（复用既有纯解析器；seed / sequence 复用既有语义）。
  const seed = options.seed ?? tickInput?.seed ?? null;
  const res = actionType === 'PASS'
    ? resolvePass(ai, tick.matchCore, {
      seed,
      passSequence: options.passSequence ?? 0,
      ruleVersion: options.passRuleVersion,
    })
    : resolveShot(ai, tick.matchCore, {
      seed,
      shotSequence: options.shotSequence ?? 0,
      ruleVersion: options.shotRuleVersion,
    });

  // 解析失败 / 取消：不安装，不改 matchCore。
  if (!res || res.ok !== true) {
    return {
      ...tick,
      actionResolution: res ?? null,
      actionInstall: install(
        ACTION_INSTALL_STATUS.FAILED_RESOLUTION,
        ACTION_INSTALL_REASON.RESOLUTION_FAILED,
        actionType,
        { resolutionReason: res?.reason ?? null, outcome: res?.outcome ?? null },
      ),
    };
  }
  // 结果无可安装 transit：不安装，不改 matchCore。
  if (!res.transit) {
    return {
      ...tick,
      actionResolution: res,
      actionInstall: install(ACTION_INSTALL_STATUS.FAILED_RESOLUTION, ACTION_INSTALL_REASON.NO_TRANSIT_IN_RESULT, actionType),
    };
  }

  // 复用对应状态更新器产生候选状态（唯一安装入口；本层不自行拼装 ball）。
  const candidate = actionType === 'PASS'
    ? applyPassStateUpdate(tick.matchCore, res)
    : applyShotStateUpdate(tick.matchCore, res);

  if (!candidate || candidate === tick.matchCore) {
    return {
      ...tick,
      actionResolution: res,
      actionInstall: install(ACTION_INSTALL_STATUS.FAILED_RESOLUTION, ACTION_INSTALL_REASON.CANDIDATE_UNCHANGED, actionType),
    };
  }

  // 候选状态必须通过既有不变量检查，方可作为最终状态。
  const issues = checkTickInvariants(candidate);
  if (issues.length > 0) {
    return {
      ...tick,
      actionResolution: res,
      actionInstall: install(
        ACTION_INSTALL_STATUS.FAILED_INVARIANT,
        ACTION_INSTALL_REASON.INVARIANT_VIOLATION,
        actionType,
        { invariantIssues: issues },
      ),
    };
  }

  // 安装成功：返回 C-08 全部字段 + 候选 MatchCore + 诊断。
  return {
    ...tick,
    matchCore: candidate,
    actionResolution: res,
    actionInstall: install(ACTION_INSTALL_STATUS.INSTALLED, ACTION_INSTALL_REASON.APPLIED, actionType),
  };
}