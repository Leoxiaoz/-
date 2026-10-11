/**
 * Goal-Aware Multi-Tick Driver（Step 39F-M-C-18）。
 * 层级归属：Simulation Core / Match Orchestration。**纯编排、确定性、无 Math.random、无墙钟**。
 *
 * 职责：把 C-10 式的「连续多个 Tick 顺序执行」与 C-17「Goal-Aware Tick」连接起来：
 *   Initial MatchCore → [C-17 Goal-Aware Tick] × tickCount → Final MatchCore
 * 每个 Tick 的最终 MatchCore 成为下一 Tick 的输入（逻辑连续；不重新从初始 MatchCore 创建）。
 *
 * 依赖（单向，冻结）：C-18 → C-17 → C-16 / C-15 / C-14 → C-08。
 *
 * 关键边界（冻结）：
 * - **不复制** Tick 生命周期 / Goal Detection / Goal Resolution / Goal Geometry。
 * - 只调用 C-17 `runGoalAwareMatchTick`；**不直接**调用 C-15 / C-14。
 * - **不写比分**：Score 唯一写入口为 C-14 `applyGoalScoreUpdate`（经 C-17）。
 * - 每 Tick 的 Ball Segment 由 C-16 重新派生（不复用旧 Segment）。
 * - 不建第二套 Ball / Score / Calibration / Tick Counter Truth；不建 goal ledger / history。
 * - goal / trace 为 **transient result**，不写入 MatchCore。
 * - 不修改 C-10 `runMatchTicks`（普通 Multi-Tick 保持无 Goal 语义）。
 * - 不调用 C-13 FinalMatchResult；不新增 Clock / Phase 逻辑。
 *
 * Deferred：Ball Physics / Trajectory / Multi-Crossing / GK / Shot / Set Pieces / Offside / Foul /
 * Cards / VAR / Goal Event Persistence / Match Result Finalization / League / Season。
 */

import { runGoalAwareMatchTick } from './goal-aware-match-tick.js';

/** Driver 规则版本（仅 transient metadata）。 */
export const GOAL_AWARE_MATCH_TICKS_VERSION = 'goal-aware-match-ticks-v1';

function validateTickCount(tickCount) {
  if (typeof tickCount !== 'number' || !Number.isInteger(tickCount) || tickCount < 0) {
    return { valid: false, code: 'INVALID_TICK_COUNT', message: `tickCount 必须是非负整数，实际: ${String(tickCount)}` };
  }
  return { valid: true };
}

/** 复刻 C-08/C-10 约束：显式 startTickIndex 优先，其次 matchCore.tickIndex，否则 0。 */
function resolveStartTickIndex(matchCore, options) {
  if (Number.isInteger(options?.startTickIndex) && options.startTickIndex >= 0) return options.startTickIndex;
  if (Number.isInteger(matchCore?.tickIndex) && matchCore.tickIndex >= 0) return matchCore.tickIndex;
  return 0;
}

/** 单个 ActionInstance 仅作为 Tick 0 输入；后续 Tick 由 C-08 默认 Decision 路径生成。 */
function buildTickInput(i, tickIndex, options) {
  const tickInput = { tickIndex };
  if (options.seed !== undefined) tickInput.seed = options.seed;
  if (typeof options.playerId === 'string' && options.playerId.length > 0) tickInput.playerId = options.playerId;
  if (i === 0 && options.actionInstance && typeof options.actionInstance === 'object') {
    tickInput.actionInstance = options.actionInstance;
  }
  return tickInput;
}

/** 透传给 C-17 的 options（Calibration 等原样转发；不引入新语义）。 */
function buildTickOptions(options) {
  return {
    phase: options.phase,
    tickIndex: undefined,
    playerId: options.playerId,
    goalId: options.goalId,
    ruleVersion: options.ruleVersion,
    decisionRuleVersion: options.decisionRuleVersion,
    interactionRuleVersion: options.interactionRuleVersion,
    secondBallRuleVersion: options.secondBallRuleVersion,
    secondBallRange: options.secondBallRange,
    calibrationProfile: options.calibrationProfile, // C-09 透传（不复制 / 不修改）
  };
}

/** 依据基础 Tick 状态判定失败（与 C-10 一致）。 */
function detectTickFailure(tickResult) {
  const status = tickResult?.tick?.status;
  if (status !== 'COMPLETED') {
    const reason = tickResult?.events?.find?.((e) => e.type === 'TICK_INVALID')?.reason ?? 'UNKNOWN';
    return { code: 'TICK_NOT_COMPLETED', message: `tick.status=${String(status)} reason=${reason}` };
  }
  const issues = Array.isArray(tickResult?.invariantIssues) ? tickResult.invariantIssues : [];
  if (issues.length > 0) return { code: 'TICK_INVARIANT_VIOLATION', message: issues.join(',') };
  return null;
}

function failResult(base, tickIndex, error) {
  return {
    ok: false,
    driverVersion: GOAL_AWARE_MATCH_TICKS_VERSION,
    initialTickIndex: base.initialTickIndex,
    finalTickIndex: base.finalTickIndex,
    nextTickIndex: base.nextTickIndex,
    ticksExecuted: base.ticksExecuted,
    failedTickIndex: tickIndex,
    matchCore: base.matchCore,
    ticks: base.ticks,
    events: base.events,
    invariantIssues: base.invariantIssues,
    error,
  };
}

/**
 * 顺序执行 `tickCount` 次 Goal-Aware Tick。
 *
 * @param {object} matchCore 初始 MatchCore（只读；不原地修改）
 * @param {number} tickCount 非负整数（0 = 不执行任何 Tick）
 * @param {object} [options] C-10 风格 options + { phase?, goalId? }
 * @returns {object} Goal-Aware Multi-Tick 信封（纯 JSON；goal / ticks 为 transient）
 */
export function runGoalAwareMatchTicks(matchCore, tickCount, options = {}) {
  const startIndex = resolveStartTickIndex(matchCore, options);

  const countCheck = validateTickCount(tickCount);
  if (!countCheck.valid) {
    return {
      ok: false, driverVersion: GOAL_AWARE_MATCH_TICKS_VERSION,
      initialTickIndex: startIndex, finalTickIndex: startIndex, nextTickIndex: startIndex,
      ticksExecuted: 0, failedTickIndex: null, matchCore, ticks: [], events: [], invariantIssues: [],
      error: { code: countCheck.code, message: countCheck.message },
    };
  }

  if (tickCount === 0) {
    return {
      ok: true, driverVersion: GOAL_AWARE_MATCH_TICKS_VERSION,
      initialTickIndex: startIndex, finalTickIndex: startIndex, nextTickIndex: startIndex,
      ticksExecuted: 0, matchCore, ticks: [], events: [], invariantIssues: [],
    };
  }

  const tickOptions = buildTickOptions(options);
  // 默认（生产路径）必须为 C-17 `runGoalAwareMatchTick`；`tickDriver` 仅作为测试 / 扩展注入的接缝。
  const tickFn = typeof options.tickDriver === 'function' ? options.tickDriver : runGoalAwareMatchTick;
  const ticks = [];
  const events = [];
  const invariantIssues = [];
  let current = matchCore;
  let succeeded = 0;

  for (let i = 0; i < tickCount; i += 1) {
    const tickIndex = startIndex + i;
    const tickInput = buildTickInput(i, tickIndex, options);

    let res;
    try {
      res = tickFn(current, { ...tickOptions, tickInput }); // C-17（默认）
    } catch (err) {
      const base = {
        initialTickIndex: startIndex, finalTickIndex: startIndex + succeeded - 1,
        nextTickIndex: startIndex + succeeded, ticksExecuted: succeeded,
        matchCore: current, ticks, events, invariantIssues,
      };
      return failResult(base, tickIndex, { code: 'TICK_THREW', message: String(err?.message ?? err) });
    }

    const failure = detectTickFailure(res.tickResult);
    const tickEvents = Array.isArray(res.tickResult?.events) ? res.tickResult.events : [];
    const tickIssues = Array.isArray(res.tickResult?.invariantIssues) ? res.tickResult.invariantIssues : [];

    // Trace 为 transient：引用级记录该 Tick 的 Segment / Goal（不写入 MatchCore）。
    ticks.push({
      tickIndex,
      ok: failure === null,
      inputMatchCore: current,
      matchCore: res.matchCore,
      ballSegment: res.ballSegment,
      goal: res.goal,
      status: res.tickResult?.tick?.status ?? 'UNKNOWN',
      invariantIssues: tickIssues,
    });
    for (const e of tickEvents) events.push(e);
    for (const issue of tickIssues) invariantIssues.push(issue);

    if (failure) {
      const base = {
        initialTickIndex: startIndex, finalTickIndex: startIndex + succeeded - 1,
        nextTickIndex: startIndex + succeeded, ticksExecuted: succeeded,
        matchCore: current, // 保留最后一次成功状态（失败 Tick 的状态不采纳）
        ticks, events, invariantIssues,
      };
      return failResult(base, tickIndex, failure);
    }

    // 状态连续传递：本 Tick 最终 MatchCore（含已更新比分）作为下一 Tick 输入。
    current = res.matchCore;
    succeeded += 1;
  }

  return {
    ok: true, driverVersion: GOAL_AWARE_MATCH_TICKS_VERSION,
    initialTickIndex: startIndex, finalTickIndex: startIndex + succeeded - 1, nextTickIndex: startIndex + succeeded,
    ticksExecuted: succeeded, matchCore: current, ticks, events, invariantIssues,
  };
}