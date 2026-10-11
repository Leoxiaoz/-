/**
 * Match Clock Foundation（Step 39F-M-C-11）。
 * 层级归属：Simulation Core / Match Orchestration。**纯状态转换、无副作用、无 Math.random、无墙钟**。
 *
 * 职责（唯一 Match Time Truth）：
 *   tickIndex / tickCount → tickDuration → elapsedSeconds → phase → isFinished
 *
 * 它不是：Ball Truth / Possession Truth / Player State / Tactical State /
 * MatchCore Mutation Engine / Event Engine / Renderer Clock。
 *
 * 数据流（单向）：
 *   clockState → advanceMatchClock(clockState, tickCount) → 新 clockState（纯 JSON）
 *
 * 关键边界（冻结）：
 * - **纯状态转换**：不原地修改输入；返回新对象。
 * - **离散时间**：1 Tick = TICK_DURATION_SECONDS；时间只由输入状态与 Tick 数决定。
 * - **不越界**：elapsedSeconds clamp 到 REGULATION_DURATION_SECONDS（不产生 5401…）。
 * - **不自动推进阶段**：到 5400 秒即 REGULATION_COMPLETE + isFinished，停在原地；
 *   不实现 Halftime / Second Half / Extra Time（属后续 Gate）。
 * - **无反向业务依赖**：不依赖 Decision / Interaction Resolution / Ball Physics。
 *
 * Deferred：完整比赛循环 / 半场切换 / 90 分钟自动进入第二半场 / 加时 / 点球 / 赛季推进。
 */

import {
  MATCH_CLOCK_CONFIG, MATCH_CLOCK_RULE_VERSION, MATCH_PHASES,
} from './match-clock-config.js';
import { runMatchTicks } from './match-ticks.js';

const { TICK_DURATION_SECONDS, REGULATION_DURATION_SECONDS } = MATCH_CLOCK_CONFIG;

const PHASE_VALUES = new Set(Object.values(MATCH_PHASES));

/** 创建初始 Match Clock（elapsedSeconds=0 / NOT_STARTED / 未结束）。 */
export function createInitialMatchClock() {
  return { elapsedSeconds: 0, phase: MATCH_PHASES.NOT_STARTED, isFinished: false };
}

/**
 * 由 elapsedSeconds 确定性派生比赛阶段（纯函数）。
 * @param {number} elapsedSeconds 已推进的比赛秒数（>= 0）
 * @returns {string} MATCH_PHASES 之一
 */
export function deriveMatchPhase(elapsedSeconds) {
  if (elapsedSeconds <= 0) return MATCH_PHASES.NOT_STARTED;
  if (elapsedSeconds < REGULATION_DURATION_SECONDS) return MATCH_PHASES.FIRST_HALF;
  return MATCH_PHASES.REGULATION_COMPLETE;
}

/**
 * 校验 Match Clock 状态（纯函数，不抛异常）。
 * @returns {{valid:boolean, issues:string[]}}
 */
export function validateMatchClock(clockState) {
  const issues = [];
  if (!clockState || typeof clockState !== 'object') {
    return { valid: false, issues: ['CLOCK_NOT_OBJECT'] };
  }
  const { elapsedSeconds, phase, isFinished } = clockState;
  if (typeof elapsedSeconds !== 'number' || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    issues.push('INVALID_ELAPSED_SECONDS');
  }
  if (typeof phase !== 'string' || !PHASE_VALUES.has(phase)) {
    issues.push('INVALID_PHASE');
  }
  if (typeof isFinished !== 'boolean') {
    issues.push('INVALID_IS_FINISHED');
  }
  return { valid: issues.length === 0, issues };
}

/** 严格校验 tickCount：非负整数（拒绝负数 / 小数 / NaN / Infinity / 字符串 / null）。 */
function assertTickCount(tickCount) {
  if (typeof tickCount !== 'number' || !Number.isInteger(tickCount) || tickCount < 0) {
    throw new RangeError(`tickCount 必须是非负整数，实际: ${String(tickCount)}`);
  }
}

/**
 * 推进 Match Clock（纯状态转换，返回新对象）。
 *
 * @param {{elapsedSeconds:number, phase:string, isFinished:boolean}} clockState 当前时钟（只读）
 * @param {number} [tickCount=1] 推进的 Tick 数（非负整数）
 * @returns {{elapsedSeconds:number, phase:string, isFinished:boolean}} 新时钟
 * @throws {TypeError} clockState 非法
 * @throws {RangeError} tickCount 非法
 */
export function advanceMatchClock(clockState, tickCount = 1) {
  const check = validateMatchClock(clockState);
  if (!check.valid) throw new TypeError(`非法 Match Clock 状态: ${check.issues.join(',')}`);
  assertTickCount(tickCount);

  const advanced = clockState.elapsedSeconds + tickCount * TICK_DURATION_SECONDS;
  const elapsedSeconds = Math.min(REGULATION_DURATION_SECONDS, Math.max(0, advanced));
  const phase = deriveMatchPhase(elapsedSeconds);
  return { elapsedSeconds, phase, isFinished: phase === MATCH_PHASES.REGULATION_COMPLETE };
}

/** 到结束前还剩多少 Tick（基于 REGULATION_DURATION_SECONDS）。 */
export function remainingTicks(clockState) {
  const check = validateMatchClock(clockState);
  if (!check.valid) throw new TypeError(`非法 Match Clock 状态: ${check.issues.join(',')}`);
  const remainingSeconds = Math.max(0, REGULATION_DURATION_SECONDS - clockState.elapsedSeconds);
  return Math.ceil(remainingSeconds / TICK_DURATION_SECONDS);
}

/**
 * 薄 Match Clock Driver：先推进时钟，再运行 C-10 Tick（不复制 / 不修改 C-08/C-10 生命周期）。
 *
 * 规则：
 * - 比赛已结束（isFinished）→ 不执行任何 Tick。
 * - 批量 Tick 数按剩余容量限制（elapsedSeconds 不会越过 5400）。
 * - Clock 推进量 = C-10 实际执行的 Tick 数（ticksExecuted）。
 * - Clock 不改变 C-10 的 Tick Result；C-10 的 MatchCore 可继续用于下一次调用。
 *
 * @param {object} matchCore 当前 MatchCore Truth（只读）
 * @param {object} clockState 当前 Match Clock（只读）
 * @param {number} tickCount 期望推进的 Tick 数（非负整数）
 * @param {object} [options] 透传给 runMatchTicks 的选项（seed / calibrationProfile / …）
 * @returns {{ok:boolean, clock:object, matchCore:object, requestedTickCount:number,
 *   ticksExecuted:number, remainingTicksBefore:number, ticks:object[], events:object[],
 *   invariantIssues:string[], matchFinished:boolean, failedTickIndex?:number, error?:object}}
 */
export function runMatchClockDriver(matchCore, clockState, tickCount, options = {}) {
  const check = validateMatchClock(clockState);
  if (!check.valid) throw new TypeError(`非法 Match Clock 状态: ${check.issues.join(',')}`);
  assertTickCount(tickCount);

  const remainingBefore = remainingTicks(clockState);
  const effectiveTickCount = Math.min(tickCount, remainingBefore);

  // 已结束 / 无剩余容量 → 不执行 Tick，clock 不变（返回新对象，不改输入）。
  if (effectiveTickCount === 0) {
    return {
      ok: true,
      clock: { elapsedSeconds: clockState.elapsedSeconds, phase: clockState.phase, isFinished: clockState.isFinished },
      matchCore,
      requestedTickCount: tickCount,
      ticksExecuted: 0,
      remainingTicksBefore: remainingBefore,
      ticks: [],
      events: [],
      invariantIssues: [],
      matchFinished: clockState.isFinished,
    };
  }

  // 复用 C-10（唯一 Tick Driver）；Clock 不触碰其 Tick 生命周期。
  // Clock 是唯一时间 Truth：tickIndex 由 elapsedSeconds 派生（1 Tick = TICK_DURATION_SECONDS）。
  const startTickIndex = Math.round(clockState.elapsedSeconds / TICK_DURATION_SECONDS);
  const tickResult = runMatchTicks(matchCore, effectiveTickCount, { ...options, startTickIndex });
  const clock = advanceMatchClock(clockState, tickResult.ticksExecuted);

  const result = {
    ok: tickResult.ok,
    clock,
    matchCore: tickResult.matchCore,
    requestedTickCount: tickCount,
    ticksExecuted: tickResult.ticksExecuted,
    remainingTicksBefore: remainingBefore,
    ticks: tickResult.ticks,
    events: tickResult.events,
    invariantIssues: tickResult.invariantIssues,
    matchFinished: clock.isFinished,
  };
  if (tickResult.ok === false) {
    result.failedTickIndex = tickResult.failedTickIndex;
    result.error = tickResult.error;
  }
  return result;
}

/** 规则版本（metadata）。 */
export const MATCH_CLOCK_CONFIG_VERSION = MATCH_CLOCK_RULE_VERSION;