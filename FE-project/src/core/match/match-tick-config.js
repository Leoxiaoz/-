/**
 * Match Tick Orchestration 配置（Step 39F-M-C-08）。
 * 层级归属：Simulation Core / Match Orchestration。纯数据，无副作用、无 RNG、无墙钟。
 *
 * 范围：定义「离散 Match Tick」的编排常量。Tick 只决定 **调用顺序 + 输入快照 + 下一状态**，
 * 不是新的游戏规则层，也不是完整 Match Loop。
 *
 * ⚠ 数值为 **TBD-CAL**（MVP 默认值）；集中存放，禁止散落 magic numbers。
 *
 * 红线：不接 Production Loop / Renderer / UI / Save / Schema；无 Math.random；
 * 不依赖 wall-clock；不建立第二套 MatchCore / Ball / Possession / Geometry Truth。
 */

/** Match Tick 规则版本（写入 Tick Result meta；非 schema 字段）。 */
export const MATCH_TICK_RULE_VERSION = 'match-tick-v1';

export const MATCH_TICK_CONFIG = Object.freeze({
  /**
   * 一个 Tick 内允许的最大 SECOND_BALL 解析次数。
   * = 1：Action → Interaction → 最多一次 SECOND_BALL → Tick End（禁止递归）。
   */
  MAX_SECOND_BALL_PER_TICK: 1,
});

/** Tick 阶段名（用于 Tick Result.tick.stages，便于可观察）。 */
export const TICK_STAGES = Object.freeze({
  VALIDATE: 'validate',
  SNAPSHOT: 'snapshot',
  CONTINUOUS_TRANSIT: 'continuous_transit',
  ACTION: 'action',
  INTERACTION_RESOLVE: 'interaction_resolve',
  INTERACTION_INTEGRATE: 'interaction_integrate',
  SECOND_BALL_RESOLVE: 'second_ball_resolve',
  SECOND_BALL_INTEGRATE: 'second_ball_integrate',
  INVARIANTS: 'invariants',
});

/** transient event 类型（**仅 trace，不是比赛 Truth**）。 */
export const TICK_EVENT_TYPES = Object.freeze({
  TICK_INVALID: 'TICK_INVALID',
  TICK_STARTED: 'TICK_STARTED',
  CONTINUOUS_TRANSIT_ADVANCED: 'CONTINUOUS_TRANSIT_ADVANCED',
  CONTINUOUS_TRANSIT_COMPLETED: 'CONTINUOUS_TRANSIT_COMPLETED',
  CONTINUOUS_TRANSIT_SKIPPED: 'CONTINUOUS_TRANSIT_SKIPPED',
  CONTINUOUS_TRANSIT_FAILED: 'CONTINUOUS_TRANSIT_FAILED',
  ACTION_CREATED: 'ACTION_CREATED',
  NO_ACTION: 'NO_ACTION',
  INTERACTION_RESOLVED: 'INTERACTION_RESOLVED',
  INTERACTION_INTEGRATED: 'INTERACTION_INTEGRATED',
  SECOND_BALL_RESOLVED: 'SECOND_BALL_RESOLVED',
  SECOND_BALL_SKIPPED: 'SECOND_BALL_SKIPPED',
  TICK_ENDED: 'TICK_ENDED',
});