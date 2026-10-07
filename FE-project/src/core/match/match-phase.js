/**
 * Match Phase Lifecycle Foundation（Step 39F-M-C-12）。
 * 层级归属：Simulation Core / Match Orchestration。**纯状态转换、无副作用、无 Math.random、无墙钟**。
 *
 * 职责（唯一 Match Phase Truth；不复制时间）：
 *   MatchClock(C-11) → Phase Lifecycle → Phase Driver → C-11 Clock Driver → C-10 Multi-Tick Driver → MatchCore
 *
 * 生命周期：
 *   NOT_STARTED → FIRST_HALF → HALFTIME → SECOND_HALF → REGULATION_COMPLETE
 *   - HALFTIME 是**显式暂停态**（不能由 elapsedSeconds>=2700 永久推导）。
 *   - 进入 HALFTIME 后**不自动**进入 SECOND_HALF；必须显式 startSecondHalf()。
 *   - Phase 只控制比赛生命周期，不参与 Decision / Interaction / Ball Physics / Possession / Tactical / Player。
 *
 * 关键边界（冻结）：
 * - **单一时间 Truth**：Phase 不产生第二套 elapsedSeconds 来源；读取 C-11 MatchClock。
 * - **纯状态转换**：不修改输入对象；返回新对象。
 * - **不自动越界**：批量 Tick 在 2700 / 5400 边界停止，不跳过 HALFTIME。
 * - **不复制 C-10/C-11**：Phase Driver 仅做「是否允许 Tick + 边界截断」，实际 Tick 仍走 C-11 → C-10。
 *
 * Deferred：Extra Time / Added Time / Penalty Shootout / Full Match Result /
 * 中场恢复体力·换人·战术调整（Manager 行为）。
 */

import {
  HALF_DURATION_SECONDS, LEGAL_PHASE_TRANSITIONS, MATCH_LIFECYCLE_PHASES, MATCH_PHASE_RULE_VERSION,
} from './match-phase-config.js';
import { MATCH_CLOCK_CONFIG } from './match-clock-config.js';
import { validateMatchClock, runMatchClockDriver } from './match-clock.js';

const P = MATCH_LIFECYCLE_PHASES;
const { REGULATION_DURATION_SECONDS } = MATCH_CLOCK_CONFIG;
const PHASE_VALUES = new Set(Object.values(P));

/** 阶段 → 期望的 half / isBreak / isFinished 组合。 */
const PHASE_SHAPE = Object.freeze({
  [P.NOT_STARTED]: { half: 0, isBreak: false, isFinished: false },
  [P.FIRST_HALF]: { half: 1, isBreak: false, isFinished: false },
  [P.HALFTIME]: { half: 1, isBreak: true, isFinished: false },
  [P.SECOND_HALF]: { half: 2, isBreak: false, isFinished: false },
  [P.REGULATION_COMPLETE]: { half: 2, isBreak: false, isFinished: true },
});

/** 创建初始 Match Phase（NOT_STARTED）。 */
export function createInitialMatchPhase() {
  return { phase: P.NOT_STARTED, elapsedSeconds: 0, half: 0, isBreak: false, isFinished: false };
}

/** Phase 是否处于终态（常规时间结束）。 */
export function isMatchPhaseTerminal(phaseState) {
  return phaseState?.phase === P.REGULATION_COMPLETE;
}

/** Phase 是否为「暂停 / 不可 Tick」态（NOT_STARTED / HALFTIME / REGULATION_COMPLETE）。 */
export function isMatchPhasePaused(phaseState) {
  const ph = phaseState?.phase;
  return ph === P.NOT_STARTED || ph === P.HALFTIME || ph === P.REGULATION_COMPLETE;
}

/** 校验 Match Phase 状态（纯函数，不抛异常）。 */
export function validateMatchPhase(phaseState) {
  const issues = [];
  if (!phaseState || typeof phaseState !== 'object') return { valid: false, issues: ['PHASE_NOT_OBJECT'] };
  const { phase, elapsedSeconds, half, isBreak, isFinished } = phaseState;
  if (typeof phase !== 'string' || !PHASE_VALUES.has(phase)) {
    return { valid: false, issues: ['INVALID_PHASE'] };
  }
  if (typeof elapsedSeconds !== 'number' || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds > REGULATION_DURATION_SECONDS) {
    issues.push('INVALID_ELAPSED_SECONDS');
  }
  const shape = PHASE_SHAPE[phase];
  if (half !== shape.half) issues.push('HALF_MISMATCH');
  if (isBreak !== shape.isBreak) issues.push('IS_BREAK_MISMATCH');
  if (isFinished !== shape.isFinished) issues.push('IS_FINISHED_MISMATCH');
  // 阶段与时间的边界一致性。
  if (phase === P.NOT_STARTED && elapsedSeconds !== 0) issues.push('NOT_STARTED_REQUIRES_ZERO');
  // FIRST_HALF 允许 elapsedSeconds === 0（刚 startMatch、尚未执行首个 Tick）。
  if (phase === P.FIRST_HALF && !(elapsedSeconds >= 0 && elapsedSeconds < HALF_DURATION_SECONDS)) issues.push('FIRST_HALF_OUT_OF_RANGE');
  if (phase === P.HALFTIME && elapsedSeconds !== HALF_DURATION_SECONDS) issues.push('HALFTIME_REQUIRES_2700');
  if (phase === P.SECOND_HALF && !(elapsedSeconds >= HALF_DURATION_SECONDS && elapsedSeconds < REGULATION_DURATION_SECONDS)) issues.push('SECOND_HALF_OUT_OF_RANGE');
  if (phase === P.REGULATION_COMPLETE && elapsedSeconds !== REGULATION_DURATION_SECONDS) issues.push('REGULATION_COMPLETE_REQUIRES_5400');
  return { valid: issues.length === 0, issues };
}

function assertValidPhase(phaseState) {
  const check = validateMatchPhase(phaseState);
  if (!check.valid) throw new TypeError(`非法 Match Phase 状态: ${check.issues.join(',')}`);
}

/** 是否允许从 from 单步转换到 to（禁止跳跃 / 回退；允许同相读取）。 */
export function isLegalPhaseTransition(from, to) {
  if (from === to) return true;
  return (LEGAL_PHASE_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * startMatch：NOT_STARTED → FIRST_HALF（不推进时间）。
 * @throws {TypeError} 输入非法 / 非 NOT_STARTED
 */
export function startMatch(phaseState) {
  assertValidPhase(phaseState);
  if (phaseState.phase !== P.NOT_STARTED) {
    throw new TypeError(`startMatch 仅允许 NOT_STARTED → FIRST_HALF，实际: ${phaseState.phase}`);
  }
  return { phase: P.FIRST_HALF, elapsedSeconds: 0, half: 1, isBreak: false, isFinished: false };
}

/**
 * startSecondHalf：HALFTIME → SECOND_HALF（不推进时间；仅改变 Phase）。
 * @throws {TypeError} 输入非法 / 非 HALFTIME
 */
export function startSecondHalf(phaseState) {
  assertValidPhase(phaseState);
  if (phaseState.phase !== P.HALFTIME) {
    throw new TypeError(`startSecondHalf 仅允许 HALFTIME → SECOND_HALF，实际: ${phaseState.phase}`);
  }
  return { phase: P.SECOND_HALF, elapsedSeconds: phaseState.elapsedSeconds, half: 2, isBreak: false, isFinished: false };
}

/**
 * 依据 C-11 MatchClock 前进一步推进 Phase 生命周期（纯函数；不自动越过 HALFTIME）。
 * 每次最多前进一个生命周期步骤；HALFTIME 只能由 startSecondHalf 离开。
 *
 * @param {{phase:string, elapsedSeconds:number, half:number, isBreak:boolean, isFinished:boolean}} phaseState
 * @param {{elapsedSeconds:number, phase:string, isFinished:boolean}} matchClock C-11 时钟（唯一时间 Truth）
 * @returns {object} 新 Phase 状态
 */
export function advanceMatchPhase(phaseState, matchClock) {
  assertValidPhase(phaseState);
  const clockCheck = validateMatchClock(matchClock);
  if (!clockCheck.valid) throw new TypeError(`非法 Match Clock: ${clockCheck.issues.join(',')}`);
  const elapsed = Math.min(REGULATION_DURATION_SECONDS, Math.max(0, matchClock.elapsedSeconds));

  switch (phaseState.phase) {
    case P.NOT_STARTED:
      if (elapsed > 0) return { phase: P.FIRST_HALF, elapsedSeconds: elapsed, half: 1, isBreak: false, isFinished: false };
      return createInitialMatchPhase();
    case P.FIRST_HALF:
      if (elapsed >= HALF_DURATION_SECONDS) {
        return { phase: P.HALFTIME, elapsedSeconds: HALF_DURATION_SECONDS, half: 1, isBreak: true, isFinished: false };
      }
      return { phase: P.FIRST_HALF, elapsedSeconds: elapsed, half: 1, isBreak: false, isFinished: false };
    case P.HALFTIME:
      // 显式暂停态：不自动离开；仅同步报告时间（应恒为 2700）。
      return { phase: P.HALFTIME, elapsedSeconds: HALF_DURATION_SECONDS, half: 1, isBreak: true, isFinished: false };
    case P.SECOND_HALF:
      if (elapsed >= REGULATION_DURATION_SECONDS) {
        return { phase: P.REGULATION_COMPLETE, elapsedSeconds: REGULATION_DURATION_SECONDS, half: 2, isBreak: false, isFinished: true };
      }
      return { phase: P.SECOND_HALF, elapsedSeconds: elapsed, half: 2, isBreak: false, isFinished: false };
    case P.REGULATION_COMPLETE:
    default:
      return { phase: P.REGULATION_COMPLETE, elapsedSeconds: REGULATION_DURATION_SECONDS, half: 2, isBreak: false, isFinished: true };
  }
}

/** 当前阶段在到达下一个边界前允许执行的 Tick 数（0 = 当前不可 Tick）。 */
export function ticksAllowedInPhase(phaseState, clockState) {
  const elapsed = clockState.elapsedSeconds;
  switch (phaseState.phase) {
    case P.FIRST_HALF:
      return Math.max(0, HALF_DURATION_SECONDS - elapsed);
    case P.SECOND_HALF:
      return Math.max(0, REGULATION_DURATION_SECONDS - elapsed);
    default:
      return 0; // NOT_STARTED / HALFTIME / REGULATION_COMPLETE
  }
}

/**
 * Phase Driver：生命周期门控 + 边界截断 + 委托 C-11 Clock Driver（→ C-10）。
 * 不复制 C-10 / C-11 的职责。
 *
 * 规则：
 * - NOT_STARTED / HALFTIME / REGULATION_COMPLETE → 不执行任何 Tick（返回生命周期原因）。
 * - FIRST_HALF 批量 Tick 在 2700 秒停止 → HALFTIME（不自动进入 SECOND_HALF）。
 * - SECOND_HALF 批量 Tick 在 5400 秒停止 → REGULATION_COMPLETE。
 *
 * @param {object} matchCore 当前 MatchCore Truth（只读）
 * @param {object} phaseState 当前 Phase（只读）
 * @param {object} clockState 当前 C-11 Match Clock（只读）
 * @param {number} tickCount 期望 Tick 数（非负整数）
 * @param {object} [options] 透传 C-10 的选项（seed / calibrationProfile / …）
 * @returns {{ok:boolean, lifecycle:string, matchCore:object, phase:object, clock:object,
 *   requestedTickCount:number, ticksExecuted:number, ticksAllowed:number, ticks:object[],
 *   events:object[], invariantIssues:string[], matchFinished:boolean,
 *   failedTickIndex?:number, error?:object}}
 */
export function runMatchPhaseDriver(matchCore, phaseState, clockState, tickCount, options = {}) {
  assertValidPhase(phaseState);
  const clockCheck = validateMatchClock(clockState);
  if (!clockCheck.valid) throw new TypeError(`非法 Match Clock: ${clockCheck.issues.join(',')}`);
  if (typeof tickCount !== 'number' || !Number.isInteger(tickCount) || tickCount < 0) {
    throw new RangeError(`tickCount 必须是非负整数，实际: ${String(tickCount)}`);
  }

  const allowed = ticksAllowedInPhase(phaseState, clockState);
  const effective = Math.min(tickCount, allowed);
  const paused = phaseState.phase !== P.FIRST_HALF && phaseState.phase !== P.SECOND_HALF;

  // 不可 Tick（暂停 / 终态）或已到当前阶段边界 → 不调用 C-10；由正常返回值表达，不用异常。
  if (paused || effective === 0) {
    const phase = advanceMatchPhase(phaseState, clockState);
    return {
      ok: true,
      lifecycle: isMatchPhaseTerminal(phaseState) ? 'MATCH_FINISHED' : (paused ? `PAUSED_${phaseState.phase}` : 'AT_PHASE_BOUNDARY'),
      matchCore,
      phase,
      clock: { elapsedSeconds: clockState.elapsedSeconds, phase: clockState.phase, isFinished: clockState.isFinished },
      requestedTickCount: tickCount,
      ticksExecuted: 0,
      ticksAllowed: allowed,
      ticks: [],
      events: [],
      invariantIssues: [],
      matchFinished: phase.isFinished,
    };
  }

  // 委托 C-11 Clock Driver（其内部再委托 C-10）；Phase 不触碰 Tick 生命周期。
  const clockResult = runMatchClockDriver(matchCore, clockState, effective, options);
  const phase = advanceMatchPhase(phaseState, clockResult.clock);

  const result = {
    ok: clockResult.ok,
    lifecycle: 'TICKED',
    matchCore: clockResult.matchCore,
    phase,
    clock: clockResult.clock,
    requestedTickCount: tickCount,
    ticksExecuted: clockResult.ticksExecuted,
    ticksAllowed: allowed,
    ticks: clockResult.ticks,
    events: clockResult.events,
    invariantIssues: clockResult.invariantIssues,
    matchFinished: phase.isFinished,
  };
  if (clockResult.ok === false) {
    result.failedTickIndex = clockResult.failedTickIndex;
    result.error = clockResult.error;
  }
  return result;
}

/** 规则版本（metadata）。 */
export const MATCH_PHASE_CONFIG_VERSION = MATCH_PHASE_RULE_VERSION;