/**
 * Multi-Tick Driver Foundation（Step 39F-M-C-10）。
 * 层级归属：Simulation Core / Match Orchestration。**纯函数、无副作用、无 Math.random、无墙钟**。
 *
 * 职责：在已封存的 C-08 `runMatchTick` 之上，建立「连续多个离散 Match Tick 顺序执行」的最小 Driver。
 * Driver 只负责：
 *   1. 接收初始 MatchCore（只读；不原地修改）
 *   2. 按顺序调用 `runMatchTick`
 *   3. 把上一 Tick 的输出作为下一 Tick 的输入（**引用级连续传递**）
 *   4. 管理确定性 `tickIndex`（`tickIndex(n+1) = tickIndex(n) + 1`）
 *   5. 收集 transient Tick Trace / Events
 *   6. 指定 Tick 数完成后返回最终状态
 *   7. 任一 Tick 失败时立即停止并报告失败位置（fail-fast）
 *
 * 数据流（单向）：
 *   runMatchTicks
 *     → runMatchTick（C-08，唯一 Tick 执行入口）
 *       → C-04 Decision → C-05 Interaction → C-06 Integration → C-07 Second-Ball
 *         → C-09 Calibration（经 C-08 透传）
 *     → Next MatchCore
 *
 * 关键边界（冻结）：
 * - **唯一执行入口**：只调用 `runMatchTick`；不自己 resolveInteraction / integrateInteraction /
 *   resolveSecondBall；不复制 C-08 生命周期；不修改 MatchCore Truth。
 * - **单一 MatchCore Truth**：不建第二套 Ball / Possession / Geometry / Player / Calibration / Event Truth。
 * - **tickIndex 仅 orchestration metadata**：不写入 MatchCore；不使用真实时间。
 * - **events / ticks 仅 transient trace**：不构成下一 Tick 的状态来源，不反向修改 MatchCore。
 * - **不递归**：本 Driver 不调用 runMatchTicks；Tick 数量由参数一次性给定。
 *
 * Deferred：完整 90 分钟比赛循环 / 半场 / 中场 / 加时 / 赛季推进 / 联赛积分 / 球员成长 /
 * 伤病系统扩展 / Renderer / Save·Schema / PASS·SHOT·Ball Physics 重构 / TD-01·TD-02 修复。
 */

import { runMatchTick } from './match-tick.js';

/** Driver 规则版本（仅 transient metadata；非 schema 字段）。 */
export const MATCH_TICKS_DRIVER_VERSION = 'match-ticks-v1';

/** 严格校验 tickCount：仅允许非负整数（拒绝负数 / 小数 / NaN / Infinity / 字符串 / null / undefined）。 */
function validateTickCount(tickCount) {
  if (typeof tickCount !== 'number' || !Number.isInteger(tickCount) || tickCount < 0) {
    return { valid: false, code: 'INVALID_TICK_COUNT', message: `tickCount 必须是非负整数，实际: ${String(tickCount)}` };
  }
  return { valid: true };
}

/** 解析起始 tickIndex（复刻 C-08 约束：显式 startTickIndex 优先，其次 matchCore.tickIndex，否则 0）。 */
function resolveStartTickIndex(matchCore, options) {
  if (Number.isInteger(options?.startTickIndex) && options.startTickIndex >= 0) return options.startTickIndex;
  if (Number.isInteger(matchCore?.tickIndex) && matchCore.tickIndex >= 0) return matchCore.tickIndex;
  return 0;
}

/** 组装单个 Tick 的 tickInput（tickIndex / seed / playerId / 仅 Tick 0 复用外部 ActionInstance）。 */
function buildTickInput(i, tickIndex, options) {
  const tickInput = { tickIndex };
  if (options.seed !== undefined) tickInput.seed = options.seed;
  if (typeof options.playerId === 'string' && options.playerId.length > 0) tickInput.playerId = options.playerId;
  // 单个 ActionInstance 仅作为 Tick 0 的输入；后续 Tick 由 C-08 默认 Decision 路径生成。
  if (i === 0 && options.actionInstance && typeof options.actionInstance === 'object') {
    tickInput.actionInstance = options.actionInstance;
  }
  return tickInput;
}

/** 组装传给 C-08 的 options（最小透传；不为本 Driver 引入新语义）。 */
function buildTickOptions(options) {
  return {
    ruleVersion: options.ruleVersion,
    decisionRuleVersion: options.decisionRuleVersion,
    interactionRuleVersion: options.interactionRuleVersion,
    secondBallRuleVersion: options.secondBallRuleVersion,
    secondBallRange: options.secondBallRange,
    calibrationProfile: options.calibrationProfile, // C-09：Calibration 透传（不复制 / 不修改）
  };
}

/**
 * C-08 无 `ok` 字段；本 Driver 将 Tick 失败映射为：
 * - `tick.status !== 'COMPLETED'`（如 INVALID）→ TICK_NOT_COMPLETED；
 * - `invariantIssues` 非空 → TICK_INVARIANT_VIOLATION。
 * @returns {{code:string,message:string}|null}
 */
function detectTickFailure(tickResult) {
  const status = tickResult?.tick?.status;
  if (status !== 'COMPLETED') {
    const reason = tickResult?.events?.find?.((e) => e.type === 'TICK_INVALID')?.reason ?? 'UNKNOWN';
    return { code: 'TICK_NOT_COMPLETED', message: `tick.status=${String(status)} reason=${reason}` };
  }
  const issues = Array.isArray(tickResult?.invariantIssues) ? tickResult.invariantIssues : [];
  if (issues.length > 0) {
    return { code: 'TICK_INVARIANT_VIOLATION', message: issues.join(',') };
  }
  return null;
}

/** 构造失败返回包（保留已执行 Trace；fail-fast）。 */
function failResult(base, tickIndex, error) {
  return {
    ok: false,
    driverVersion: MATCH_TICKS_DRIVER_VERSION,
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
 * 顺序执行 `tickCount` 个离散 Match Tick。
 *
 * @param {object} matchCore 初始 MatchCore Truth（只读；不原地修改）
 * @param {number} tickCount 非负整数（0 = 不执行任何 Tick）
 * @param {{
 *   startTickIndex?:number, playerId?:string, actionInstance?:object, seed?:string,
 *   ruleVersion?:string, decisionRuleVersion?:string, interactionRuleVersion?:string,
 *   secondBallRuleVersion?:string, secondBallRange?:number, calibrationProfile?:object,
 * }} [options]
 * @returns {{
 *   ok:boolean, driverVersion:string, initialTickIndex:number, finalTickIndex:number,
 *   nextTickIndex:number, ticksExecuted:number, matchCore:object,
 *   ticks:object[], events:object[], invariantIssues:string[],
 *   failedTickIndex?:number, error?:{code:string,message:string}
 * }}
 */
export function runMatchTicks(matchCore, tickCount, options = {}) {
  const startIndex = resolveStartTickIndex(matchCore, options);

  const countCheck = validateTickCount(tickCount);
  if (!countCheck.valid) {
    return {
      ok: false,
      driverVersion: MATCH_TICKS_DRIVER_VERSION,
      initialTickIndex: startIndex,
      finalTickIndex: startIndex,
      nextTickIndex: startIndex,
      ticksExecuted: 0,
      failedTickIndex: null,
      matchCore,
      ticks: [],
      events: [],
      invariantIssues: [],
      error: { code: countCheck.code, message: countCheck.message },
    };
  }

  // tickCount = 0：不执行任何 Tick，不人为增加 tickIndex，初始即最终（同一引用）。
  if (tickCount === 0) {
    return {
      ok: true,
      driverVersion: MATCH_TICKS_DRIVER_VERSION,
      initialTickIndex: startIndex,
      finalTickIndex: startIndex,
      nextTickIndex: startIndex,
      ticksExecuted: 0,
      matchCore,
      ticks: [],
      events: [],
      invariantIssues: [],
    };
  }

  const tickOptions = buildTickOptions(options);
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
      res = runMatchTick(current, tickInput, tickOptions);
    } catch (err) {
      const error = { code: 'TICK_THREW', message: String(err?.message ?? err) };
      const base = {
        initialTickIndex: startIndex,
        finalTickIndex: startIndex + succeeded - 1,
        nextTickIndex: startIndex + succeeded,
        ticksExecuted: succeeded,
        matchCore: current,
        ticks,
        events,
        invariantIssues,
      };
      return failResult(base, tickIndex, error);
    }

    const failure = detectTickFailure(res);
    const tickEvents = Array.isArray(res.events) ? res.events : [];
    const tickIssues = Array.isArray(res.invariantIssues) ? res.invariantIssues : [];

    // Trace 为 transient：引用级记录 inputMatchCore / result.matchCore（= 下一 Tick 的输入）。
    ticks.push({
      tickIndex,
      ok: failure === null,
      stages: res?.tick?.stages ?? [],
      events: tickEvents,
      invariantIssues: tickIssues,
      inputMatchCore: current,
      result: { matchCore: res?.matchCore ?? current, status: res?.tick?.status ?? 'UNKNOWN', applied: res?.applied ?? { interaction: false, secondBall: false } },
    });
    for (const e of tickEvents) events.push(e);
    for (const issue of tickIssues) invariantIssues.push(issue);

    if (failure) {
      const base = {
        initialTickIndex: startIndex,
        finalTickIndex: startIndex + succeeded - 1,
        nextTickIndex: startIndex + succeeded,
        ticksExecuted: succeeded,
        matchCore: current, // 保留最后一次成功状态（失败 Tick 的状态不采纳）
        ticks,
        events,
        invariantIssues,
      };
      return failResult(base, tickIndex, failure);
    }

    // 状态连续传递：上一 Tick 的输出作为下一 Tick 的输入（引用级，不重新从初始 MatchCore 创建）。
    current = res.matchCore;
    succeeded += 1;
  }

  return {
    ok: true,
    driverVersion: MATCH_TICKS_DRIVER_VERSION,
    initialTickIndex: startIndex,
    finalTickIndex: startIndex + succeeded - 1,
    nextTickIndex: startIndex + succeeded,
    ticksExecuted: succeeded,
    matchCore: current,
    ticks,
    events,
    invariantIssues,
  };
}