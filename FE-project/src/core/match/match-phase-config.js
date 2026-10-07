/**
 * Match Phase 配置（Step 39F-M-C-12）。
 * 层级归属：Simulation Core / Match Orchestration。纯数据，无副作用、无 RNG、无墙钟。
 *
 * 范围：定义常规比赛的阶段生命周期枚举与半场边界常量。
 * - Match Time Truth：C-11 MatchClock（唯一）。
 * - Match Phase Truth：C-12 MatchPhase（唯一；不复制时间）。
 *
 * 冻结时间模型（承接 C-11，离散、确定性）：
 *   0 秒            → NOT_STARTED
 *   1 ～ 2699 秒    → FIRST_HALF
 *   2700 秒          → HALFTIME（显式生命周期暂停态，非纯时间区间）
 *   2701 ～ 5399 秒 → SECOND_HALF（必须由 startSecondHalf 显式开启）
 *   5400 秒          → REGULATION_COMPLETE
 *
 * 红线：不使用 Date.now / new Date / performance.now / setTimeout / setInterval；
 * 不实现加时 / 补时 / 点球 / 中场恢复体力·换人·战术调整（全部 Deferred）。
 */

/** Match Phase 规则版本（仅 metadata；非 schema 字段）。 */
export const MATCH_PHASE_RULE_VERSION = 'match-phase-v1';

/** 半场时长（秒）：2700 秒 = 45 分钟 = REGULATION_DURATION_SECONDS / 2。 */
export const HALF_DURATION_SECONDS = 2700;

/** 阶段枚举（C-12 常规比赛生命周期，含显式 HALFTIME）。 */
export const MATCH_LIFECYCLE_PHASES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',                 // 未开始（elapsedSeconds === 0）
  FIRST_HALF: 'FIRST_HALF',                   // 上半场进行中（0 < elapsedSeconds < 2700）
  HALFTIME: 'HALFTIME',                       // 上半场结束、下半场未开始的显式暂停态（elapsedSeconds === 2700）
  SECOND_HALF: 'SECOND_HALF',                 // 下半场进行中（2700 <= elapsedSeconds < 5400）
  REGULATION_COMPLETE: 'REGULATION_COMPLETE', // 常规时间结束（elapsedSeconds === 5400）
});

/** 合法的单步阶段转换（其余一律非法，禁止跳跃 / 回退）。 */
export const LEGAL_PHASE_TRANSITIONS = Object.freeze({
  NOT_STARTED: Object.freeze(['FIRST_HALF']),
  FIRST_HALF: Object.freeze(['HALFTIME']),
  HALFTIME: Object.freeze(['SECOND_HALF']),
  SECOND_HALF: Object.freeze(['REGULATION_COMPLETE']),
  REGULATION_COMPLETE: Object.freeze([]),
});