/**
 * Interaction Resolution 配置（Step 39F-M-C-05）。
 * 层级归属：Simulation Core / Match Resolution。纯数据，无副作用、无 RNG。
 *
 * 范围：球员-球基础互动（DRIBBLE / TACKLE / PRESS / INTERCEPTION）的结果语义。
 * ⚠ 数值为 **TBD-CAL**（MVP 可运行默认值），未来由 Resolution 校准阶段调整。
 * 集中存放，禁止散落 magic numbers。
 *
 * 红线：不改 Save / Schema；不接 Renderer / Production Loop；无 Math.random。
 *
 * Step 39F-M-C-09：本文件的**平衡参数**（probability / weight / ratio）已改为由
 * `resolution-calibration-config.js` 的 Calibration Profile **派生**（单一 Calibration Truth）；
 * 结构性常量（pitch 边界 / range / normalizer / RNG 无关阈值）仍在此声明，不进入 Calibration。
 */

import { DEFAULT_CALIBRATION_PROFILE } from './resolution-calibration-config.js';

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

/**
 * 结构性常量（**非 Calibration**）：坐标 invariant / 几何半径 / 归一化基准。
 * 理由：这些是几何 / 物理 / 口径常量，不属于 Resolution balancing parameter，
 * 不随校准集变化，故不进入 Calibration Profile。
 */
const INTERACTION_STRUCTURAL_CONSTANTS = Object.freeze({
  PITCH_MIN: 0,
  PITCH_MAX: 1,
  PRESSURE_RANGE: 0.15,
  PRESSURE_NORM: 3,
  SCATTER_MAX: 0.05,
  DRIBBLE_CHALLENGE_RANGE: 0.06,
  TACKLE_RANGE: 0.10,
  PRESS_RANGE: 0.12,
  INTERCEPTION_RANGE: 0.10,
});

/**
 * 由 Calibration Profile 派生 Interaction Resolution Config（参数注入，不改公式结构）。
 * 平衡参数取值自 `profile.interaction.<discipline>`；结构常量来自本文件。
 * @param {object} profile Calibration Profile
 * @returns {object} 冻结的 interaction 生效配置
 */
export function buildInteractionResolutionConfig(profile) {
  const c = profile.interaction;
  return Object.freeze({
    ...INTERACTION_STRUCTURAL_CONSTANTS,

    /** DRIBBLE。 */
    DRIBBLE_BASE_SUCCESS: c.dribble.BASE_SUCCESS,
    DRIBBLE_TECHNIQUE_WEIGHT: c.dribble.TECHNIQUE_WEIGHT,
    DRIBBLE_PACE_WEIGHT: c.dribble.PACE_WEIGHT,
    DRIBBLE_PRESSURE_PENALTY: c.dribble.PRESSURE_PENALTY,
    DRIBBLE_FREE_SPACE_BONUS: c.dribble.FREE_SPACE_BONUS,
    DRIBBLE_LOOSE_RATIO: c.dribble.LOOSE_RATIO,

    /** TACKLE。 */
    TACKLE_BASE_SUCCESS: c.tackle.BASE_SUCCESS,
    TACKLE_DEFENDING_WEIGHT: c.tackle.DEFENDING_WEIGHT,
    TACKLE_CLOSENESS_WEIGHT: c.tackle.CLOSENESS_WEIGHT,
    TACKLE_CARRIER_TECHNIQUE_PENALTY: c.tackle.CARRIER_TECHNIQUE_PENALTY,
    TACKLE_CARRIER_PACE_PENALTY: c.tackle.CARRIER_PACE_PENALTY,
    TACKLE_LOOSE_RATIO: c.tackle.LOOSE_RATIO,

    /** PRESS。 */
    PRESS_BASE_SUCCESS: c.press.BASE_SUCCESS,
    PRESS_DEFENDING_WEIGHT: c.press.DEFENDING_WEIGHT,
    PRESS_CLOSENESS_WEIGHT: c.press.CLOSENESS_WEIGHT,
    PRESS_TEAM_PRESSING_WEIGHT: c.press.TEAM_PRESSING_WEIGHT,
    PRESS_CARRIER_COMPOSURE_PENALTY: c.press.CARRIER_COMPOSURE_PENALTY,
    PRESS_PRESSURE_ONLY_RATIO: c.press.PRESSURE_ONLY_RATIO,

    /** INTERCEPTION。 */
    INTERCEPTION_BASE_SUCCESS: c.interception.BASE_SUCCESS,
    INTERCEPTION_DEFENDING_WEIGHT: c.interception.DEFENDING_WEIGHT,
    INTERCEPTION_REACH_WEIGHT: c.interception.REACH_WEIGHT,
    INTERCEPTION_PROGRESS_PENALTY: c.interception.PROGRESS_PENALTY,
    INTERCEPTION_DEFLECT_RATIO: c.interception.DEFLECT_RATIO,
  });
}

/** 默认生效配置（C09-v1 默认 profile 派生）。 */
export const INTERACTION_RESOLUTION_CONFIG = buildInteractionResolutionConfig(DEFAULT_CALIBRATION_PROFILE);