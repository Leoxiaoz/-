/**
 * Interaction Resolution 配置（Step 39F-M-C-05）。
 * 层级归属：Simulation Core / Match Resolution。纯数据，无副作用、无 RNG。
 *
 * 范围：球员-球基础互动（DRIBBLE / TACKLE / PRESS / INTERCEPTION）的结果语义。
 * ⚠ 数值为 **TBD-CAL**（MVP 可运行默认值），未来由 Resolution 校准阶段调整。
 * 集中存放，禁止散落 magic numbers。
 *
 * 红线：不改 Save / Schema；不接 Renderer / Production Loop；无 Math.random。
 */

/** Resolution 规则版本（用于 RNG scope；非 schema 字段）。 */
export const INTERACTION_RESOLUTION_RULE_VERSION = 'match-interaction-resolution-v1';

/** DRIBBLE 结果枚举（成功 / 保持控制 / 失控 / 被断）。 */
export const DRIBBLE_OUTCOMES = Object.freeze({
  COMPLETED: 'DRIBBLE_COMPLETED',         // 成功：盘带者继续控球，球推进到目标点
  LOST: 'DRIBBLE_LOST',                   // 失败：球被挑战对手夺得控制
  KNOCKED_LOOSE: 'DRIBBLE_KNOCKED_LOOSE', // 失败：球脱离控制，成为 loose ball
  CANCELLED: 'DRIBBLE_CANCELLED',         // 非法输入 / 未控球 / 目标失效
});

/** TACKLE 结果枚举（夺得 / 未夺得 / 争抢成 loose ball）。 */
export const TACKLE_OUTCOMES = Object.freeze({
  WON: 'TACKLE_WON',           // 成功：抢断者夺得控制，possession 转移
  LOST: 'TACKLE_LOST',         // 失败：原持球人保持控制
  LOOSE: 'TACKLE_LOOSE',       // 争抢：球脱离原控制者，成为 loose ball
  CANCELLED: 'TACKLE_CANCELLED',
});

/** PRESS 结果枚举（≠ TACKLE：压迫不直接夺球入控，只迫使失控 / 施压）。 */
export const PRESS_OUTCOMES = Object.freeze({
  SUCCESS: 'PRESS_SUCCESS',              // 压迫成功：迫使持球人失控（球脱离控制）
  PRESSURE_ONLY: 'PRESS_PRESSURE_ONLY',  // 施压：持球人保留控制但处于压力下
  FAILED: 'PRESS_FAILED',                // 压迫无实质效果
  CANCELLED: 'PRESS_CANCELLED',
});

/** INTERCEPTION 结果枚举（针对 in-transit 球的拦截语义）。 */
export const INTERCEPTION_OUTCOMES = Object.freeze({
  INTERCEPTED: 'INTERCEPTION_SUCCESS',    // 成功：拦截者夺得控制，transit 结束
  DEFLECTED: 'INTERCEPTION_DEFLECTED',    // 触球但未控住：球成为 loose ball，transit 结束
  FAILED: 'INTERCEPTION_FAILED',          // 未拦截：球继续处于 transit
  CANCELLED: 'INTERCEPTION_CANCELLED',
});

/** Result 中描述的球终态（供 state-update 消费；非第二套 Ball Truth）。 */
export const INTERACTION_BALL_STATE = Object.freeze({
  CONTROLLED: 'CONTROLLED',
  FREE: 'FREE',
  IN_TRANSIT: 'IN_TRANSIT',
});

/** 互动后续可解析状态类型（本 Gate 只标记，不实现；SECOND_BALL 属 Deferred）。 */
export const FOLLOW_UP_KIND = Object.freeze({
  SECOND_BALL: 'SECOND_BALL',
});

export const INTERACTION_RESOLUTION_CONFIG = Object.freeze({
  /** pitch 边界（坐标 invariant）。 */
  PITCH_MIN: 0,
  PITCH_MAX: 1,

  /** 压力派生：附近对手半径与归一化。 */
  PRESSURE_RANGE: 0.15,
  PRESSURE_NORM: 3,

  /** loose ball 散布半径（确定性；bounce/spin 属 Deferred）。 */
  SCATTER_MAX: 0.05,

  /** DRIBBLE。 */
  DRIBBLE_BASE_SUCCESS: 0.60,
  DRIBBLE_TECHNIQUE_WEIGHT: 0.22,
  DRIBBLE_PACE_WEIGHT: 0.12,
  DRIBBLE_PRESSURE_PENALTY: 0.35,
  DRIBBLE_FREE_SPACE_BONUS: 0.15,   // 挑战半径内无对手时的加成
  DRIBBLE_CHALLENGE_RANGE: 0.06,    // 对手可发起挑战的距离
  DRIBBLE_LOOSE_RATIO: 0.55,        // 失败中转为 loose（否则被夺得）

  /** TACKLE。 */
  TACKLE_BASE_SUCCESS: 0.42,
  TACKLE_DEFENDING_WEIGHT: 0.28,
  TACKLE_CLOSENESS_WEIGHT: 0.12,
  TACKLE_CARRIER_TECHNIQUE_PENALTY: 0.30,
  TACKLE_CARRIER_PACE_PENALTY: 0.10,
  TACKLE_RANGE: 0.10,
  TACKLE_LOOSE_RATIO: 0.50,         // 失败中转为 loose（否则原持球人保持）

  /** PRESS。 */
  PRESS_BASE_SUCCESS: 0.26,
  PRESS_DEFENDING_WEIGHT: 0.18,
  PRESS_CLOSENESS_WEIGHT: 0.12,
  PRESS_TEAM_PRESSING_WEIGHT: 0.14,
  PRESS_CARRIER_COMPOSURE_PENALTY: 0.24,
  PRESS_RANGE: 0.12,
  PRESS_PRESSURE_ONLY_RATIO: 0.55,  // 未成功时转为「施压」的比例（否则完全失败）

  /** INTERCEPTION。 */
  INTERCEPTION_BASE_SUCCESS: 0.42,
  INTERCEPTION_DEFENDING_WEIGHT: 0.30,
  INTERCEPTION_REACH_WEIGHT: 0.20,
  INTERCEPTION_PROGRESS_PENALTY: 0.25,
  INTERCEPTION_RANGE: 0.10,
  INTERCEPTION_DEFLECT_RATIO: 0.40, // 未成功时转为「触球脱手」的比例（否则完全失败）
});