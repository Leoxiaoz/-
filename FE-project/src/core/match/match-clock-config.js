/**
 * Match Clock 配置（Step 39F-M-C-11）。
 * 层级归属：Simulation Core / Match Orchestration。纯数据，无副作用、无 RNG、无墙钟。
 *
 * 范围：定义「离散 Tick → 比赛时间推进 → 比赛阶段判定 → 比赛结束判定」的时间常量与阶段枚举。
 * MatchClock 是唯一 Match Time Truth；不建立 Ball / Possession / Player / Tactical / Resolution Truth。
 *
 * 冻结时间模型（离散、确定性）：
 *   1 Tick = TICK_DURATION_SECONDS 比赛秒；常规比赛 = REGULATION_DURATION_SECONDS 秒。
 *
 * 红线：不使用 Date.now / new Date / performance.now / 真实经过时间；
 * 不接 Production Loop / Renderer / Save·Schema；不实现 Halftime / Second Half / Extra Time。
 */

/** Match Clock 规则版本（仅 metadata；非 schema 字段）。 */
export const MATCH_CLOCK_RULE_VERSION = 'match-clock-v1';

export const MATCH_CLOCK_CONFIG = Object.freeze({
  /** 一个 Tick 推进的比赛秒数（1 Tick = 1 比赛秒）。 */
  TICK_DURATION_SECONDS: 1,
  /** 常规比赛总时长（秒）：90 分钟 = 5400 秒。 */
  REGULATION_DURATION_SECONDS: 5400,
});

/**
 * 比赛阶段枚举（本 Gate 最小集合）。
 * Deferred：HALFTIME / SECOND_HALF / EXTRA_TIME / PENALTY_SHOOTOUT（属后续 Gate）。
 */
export const MATCH_PHASES = Object.freeze({
  NOT_STARTED: 'NOT_STARTED',                 // elapsedSeconds === 0
  FIRST_HALF: 'FIRST_HALF',                   // 0 < elapsedSeconds < REGULATION_DURATION_SECONDS
  REGULATION_COMPLETE: 'REGULATION_COMPLETE', // elapsedSeconds >= REGULATION_DURATION_SECONDS
});