/**
 * Continuous Match Loop Harness（Test / Harness only）。
 * 层级归属：**Test only**。不进入生产代码；不接 Season / Schedule / Competition / Save / UI / Production Loop。
 *
 * 目标：基于已封存的 C-08 / C-10 / C-11 / C-12 / C-13，验证比赛阶段与时钟可以按既有契约
 *      从开赛（startMatch）连续推进到终场（REGULATION_COMPLETE），并生成合法 FinalMatchResult。
 *
 * 权威（复用，不新建）：
 * - 时间 Truth = C-11 `MatchClock.elapsedSeconds`。
 * - 阶段 Truth = C-12 `MatchPhase.phase`（**不使用** C-11 的粗粒度 phase 字段做生命周期判定）。
 * - 比分 Truth = `matchCore.score`（C-14 唯一写入权威；本 Harness 无进球写入路径）。
 * - 终场结果 = C-13 `finalizeMatch` / `validateFinalMatchResult`（**不自行构造**）。
 *
 * 关键边界（冻结）：
 * - **不修改任何 src/**：本模块只消费已封存的公开 API。
 * - **本 Harness 不含进球 / 传球 / 射门 / Transit / Player Decision**：比分保持初始值。
 * - 确定性：无 Math.random / Date.now；seed 透传给驱动。
 * - 仅构造「测试用最小 MatchCore」；不导出生产初始化 API。
 *
 * 说明：本 Harness 仅验证「阶段 / 时钟闭环」，**不代表完整足球比赛模拟成功**。
 */

import {
  createInitialMatchPhase, startMatch, startSecondHalf, runMatchPhaseDriver,
  validateMatchPhase,
} from '../src/core/match/match-phase.js';
import { createInitialMatchClock, validateMatchClock } from '../src/core/match/match-clock.js';
import { finalizeMatch, validateFinalMatchResult } from '../src/core/match/match-result.js';
import { checkMatchInvariants } from '../src/core/match/interaction-integration.js';

/** Harness 默认配置（集中定义；测试显式使用）。 */
export const MATCH_LOOP_DEFAULTS = Object.freeze({
  seed: 'match-loop-harness-seed-v1',
  chunk: 300, // 每批 Tick 数；**不假设**恰好命中 2700 / 5400 边界
  maxIterations: 20000, // 防死循环上限
});

/** 终场契约常量（对齐 C-11 config；此处仅作断言靶，不新造 Truth）。 */
export const HALF_ELAPSED_SECONDS = 2700;
export const REGULATION_ELAPSED_SECONDS = 5400;

/**
 * 构造测试用最小、显式、可重复的 MatchCore。
 *
 * 字段依据（真实消费者 / invariant）：
 * - `ball`：C-08 `runMatchTick` 硬前置（缺失 → status INVALID）。
 * - `ball.state='FREE'`：`checkBallInvariants` 下 FREE 无 possession 一致性约束。
 * - `ball.control/possessingTeamId/lastTouchPlayerId=null`：FREE 合法值（不依赖现有 players）。
 * - `players:[]`：C-44 对空数组安全（applied=false），C-06 invariants 无球员要求。
 * - `score`：C-13 `createFinalMatchResult` 终场必需（有限数）。
 * - `teams`：C-13 身份复用（缺失 → teamId=null）。
 *
 * @param {object} [overrides] 顶层字段覆盖（用于测试层构造非法 / 边界输入）
 * @returns {object} 新的 MatchCore（每次调用独立，无共享引用）
 */
export function buildMinimalMatchCore(overrides = {}) {
  return {
    matchId: 'harness-match-0001',
    worldId: 'harness-world',
    season: 1,
    teams: { home: 'HOME', away: 'AWAY' },
    score: { home: 0, away: 0 },
    ball: {
      position: { x: 0.5, y: 0.5 },
      state: 'FREE',
      control: null,
      possessingTeamId: null,
      lastTouchPlayerId: null,
      velocity: { x: 0, y: 0 },
    },
    players: [],
    ...overrides,
  };
}

/**
 * 基于真实返回结果分类「本驱动调用是否推进 / 是否合法边界 / 是否真正停滞」。
 * 纯函数；供 Loop 防死循环与测试区分合法边界与异常停滞。
 *
 * @param {{phase:string, elapsedSeconds:number}} prev 调用前状态
 * @param {object} res `runMatchPhaseDriver` 返回结果
 * @returns {'PROGRESS'|'BOUNDARY'|'PAUSED'|'FAILED'|'STALL'}
 */
export function classifyDriverProgress(prev, res) {
  if (!res || res.ok === false) return 'FAILED';
  const phaseTurned = res.phase?.phase !== prev.phase;
  const elapsedAdvanced = res.clock?.elapsedSeconds !== prev.elapsedSeconds;
  const ticked = (res.ticksExecuted ?? 0) > 0;
  if (phaseTurned || elapsedAdvanced || ticked) return 'PROGRESS';
  if (res.lifecycle === 'AT_PHASE_BOUNDARY') return 'BOUNDARY';
  if (typeof res.lifecycle === 'string' && res.lifecycle.startsWith('PAUSED_')) return 'PAUSED';
  return 'STALL';
}

/** 构造带诊断信息的错误（不吞掉上下文）。 */
function loopError(message, diagnostics) {
  const err = new Error(message);
  err.diagnostics = diagnostics;
  return err;
}

/** 校验 Phase / Clock 是否满足既有契约（违反即失败）。 */
function assertValidPhaseClock(phase, clock) {
  const pv = validateMatchPhase(phase);
  if (!pv.valid) throw loopError(`非法 MatchPhase: ${pv.issues.join(',')}`, { phase });
  const cv = validateMatchClock(clock);
  if (!cv.valid) throw loopError(`非法 MatchClock: ${cv.issues.join(',')}`, { clock });
}

/**
 * 运行最小连续比赛循环：MatchCore 初始化 → startMatch → 分批 Tick 驱动 → HALFTIME 显式换边
 * → REGULATION_COMPLETE → 终场前置检查 → finalizeMatch → 校验 FinalMatchResult。
 *
 * 所有中间状态均来自上一轮真实返回；**不手工构造终态、不改 elapsedSeconds / phase / score**。
 *
 * @param {{
 *   seed?:string, chunk?:number, maxIterations?:number,
 *   coreOverrides?:object,
 * }} [options]
 * @returns {{
 *   result:object, matchCore:object, phase:object, clock:object,
 *   iterations:number, secondHalfStarted:boolean, diagnostics:object[]
 * }}
 */
export function runMinimalMatchLoop(options = {}) {
  const seed = options.seed ?? MATCH_LOOP_DEFAULTS.seed;
  const chunk = options.chunk ?? MATCH_LOOP_DEFAULTS.chunk;
  const maxIterations = options.maxIterations ?? MATCH_LOOP_DEFAULTS.maxIterations;
  if (!Number.isInteger(chunk) || chunk < 0) throw loopError(`chunk 必须是非负整数: ${String(chunk)}`, {});
  if (!Number.isInteger(maxIterations) || maxIterations < 1) throw loopError(`maxIterations 必须是正整数: ${String(maxIterations)}`, {});

  // 步骤 1：构造最小合法 MatchCore（Harness 内部）。
  let core = buildMinimalMatchCore(options.coreOverrides ?? {});

  // 步骤 2：创建初始 Phase / Clock。
  let phase = createInitialMatchPhase();
  let clock = createInitialMatchClock();
  assertValidPhaseClock(phase, clock);

  // 步骤 3：startMatch（NOT_STARTED → FIRST_HALF，不推进时间）。
  phase = startMatch(phase);

  let secondHalfStarted = false;
  let iterations = 0;
  const diagnostics = [];

  // 步骤 4~6：分批驱动，直到 C-12 终态。
  for (;;) {
    if (phase.phase === 'REGULATION_COMPLETE') break;

    if (iterations >= maxIterations) {
      throw loopError(
        `达到最大循环次数 ${maxIterations} 仍未终场（phase=${phase.phase}, elapsed=${clock.elapsedSeconds}）`,
        diagnostics,
      );
    }

    const prev = { phase: phase.phase, elapsedSeconds: clock.elapsedSeconds };
    const res = runMatchPhaseDriver(core, phase, clock, chunk, { seed });
    iterations += 1;

    diagnostics.push({
      iteration: iterations,
      lifecycle: res.lifecycle,
      phase: res.phase?.phase ?? null,
      clockPhase: res.clock?.phase ?? null,
      elapsedSeconds: res.clock?.elapsedSeconds ?? null,
      ticksExecuted: res.ticksExecuted ?? null,
      ok: res.ok,
      invariantIssues: res.invariantIssues ?? [],
    });

    // 步骤 9：硬失败立即停止。
    if (res.ok === false) {
      throw loopError(
        `驱动失败 @tick ${res.failedTickIndex}: ${JSON.stringify(res.error)}`,
        diagnostics,
      );
    }
    if (Array.isArray(res.invariantIssues) && res.invariantIssues.length > 0) {
      throw loopError(`Tick 不变量违规: ${res.invariantIssues.join(',')}`, diagnostics);
    }

    const progress = classifyDriverProgress(prev, res);
    if (progress === 'STALL') {
      throw loopError(`检测到异常停滞（无阶段 / 时间 / Tick 进展）@phase=${prev.phase}`, diagnostics);
    }

    // 状态连续传递（不重新初始化中间状态）。
    core = res.matchCore;
    phase = res.phase;
    clock = res.clock;
    assertValidPhaseClock(phase, clock);

    // 步骤 7：在 HALFTIME 显式换边（只能一次）。
    if (phase.phase === 'HALFTIME') {
      if (secondHalfStarted) {
        throw loopError('重复进入 HALFTIME（second half 已开启）', diagnostics);
      }
      phase = startSecondHalf(phase);
      secondHalfStarted = true;
    }
  }

  // 步骤 8：终场前置检查（C-12 终态 + C-11 5400 秒 + isFinished）。
  if (phase.phase !== 'REGULATION_COMPLETE') {
    throw loopError(`未达 REGULATION_COMPLETE，实际: ${phase.phase}`, diagnostics);
  }
  if (clock.elapsedSeconds !== REGULATION_ELAPSED_SECONDS) {
    throw loopError(`终场时间不一致: ${clock.elapsedSeconds}`, diagnostics);
  }
  if (clock.isFinished !== true) {
    throw loopError('终场时钟 isFinished 非 true', diagnostics);
  }
  const coreIssues = checkMatchInvariants(core);
  if (coreIssues.length > 0) {
    throw loopError(`终场 MatchCore 不变量违规: ${coreIssues.join(',')}`, diagnostics);
  }
  if (!secondHalfStarted) {
    throw loopError('未显式开启下半场即到达终场', diagnostics);
  }

  // 步骤 9：finalizeMatch + 校验（不自行构造结果）。
  const result = finalizeMatch(core, phase, clock);
  if (result.ok !== true) {
    throw loopError(`finalizeMatch 失败: ${result.reason ?? result.status}`, diagnostics);
  }
  const validation = validateFinalMatchResult(result);
  if (!validation.valid) {
    throw loopError(`FinalMatchResult 校验失败: ${validation.issues.join(',')}`, diagnostics);
  }

  return { result, matchCore: core, phase, clock, iterations, secondHalfStarted, diagnostics };
}