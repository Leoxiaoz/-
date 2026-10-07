/**
 * SHOT Resolution 配置（Step 39F-M-B-RESOLUTION-SHOT）。
 * 层级归属：Simulation Core / Match Resolution。纯数据，无副作用、无 RNG。
 *
 * ⚠ 数值为 **TBD-CAL**（MVP 可运行默认值）；集中存放，禁止散落 magic numbers。
 */

export const SHOT_RESOLUTION_RULE_VERSION = 'match-shot-resolution-v1';

/** SHOT 结果（四类 + 无效）。 */
export const SHOT_OUTCOMES = Object.freeze({
  GOAL: 'GOAL',
  SAVE: 'SAVE',
  MISS: 'MISS',
  BLOCKED: 'BLOCKED',
  INVALID_SHOT: 'INVALID_SHOT',
});

export const SHOT_RESOLUTION_CONFIG = Object.freeze({
  /** 球门（2D，无高度/物理）。home attacks +x ⇒ home 射 x=1；away 射 x=0。 */
  GOAL_CENTER_Y: 0.5,
  GOAL_HALF_WIDTH: 0.11,
  /** 目标区域 Y（相对球门中心）。 */
  TARGET_ZONE_Y: Object.freeze({ CENTER: 0.0, LEFT: -0.07, RIGHT: 0.07 }),

  /** 距离归一化参考。 */
  DISTANCE_REF: 0.50,

  /** 误差模型（有界）。 */
  BASE_SHOT_ERROR: 0.030,
  DISTANCE_ERROR_SCALE: 0.60,
  ANGLE_ERROR_SCALE: 0.50,
  PRESSURE_ERROR_SCALE: 0.50,
  ABILITY_ERROR_SCALE: 0.70,   // (1-finishing)
  TECHNIQUE_ERROR_SCALE: 0.20, // (1-technique)
  ERROR_RNG_FACTOR: 0.40,
  MIN_SHOT_ERROR: 0.0,
  MAX_SHOT_ERROR: 0.160,

  /** RiskIntent → execution profile（非 success bonus）。 */
  RISK_ERROR_MOD: Object.freeze({ LOW: 0.90, MEDIUM: 1.0, HIGH: 1.15 }),
  RISK_DESTINATION_PUSH: Object.freeze({ LOW: 0.0, MEDIUM: 0.0, HIGH: 0.010 }),

  /** Shot Intent → execution profile（当前 Decision 仅产出 GOAL）。 */
  INTENT_MODIFIERS: Object.freeze({ GOAL: 1.0 }),

  /** 压力派生。 */
  PRESSURE_RANGE: 0.15,
  PRESSURE_NORM: 3,

  /** 封堵（射门线路走廊内的场上防守球员；不含门将）。 */
  BLOCK_CORRIDOR: 0.040,
  BLOCK_BASE_RISK: 0.50,
  BLOCK_MAX: 0.85,

  /** 门将反应。 */
  GK_REACTION_BASE: 0.55,
  GK_REACTION_MAX: 0.92,
  GK_ABILITY_WEIGHT: 0.60,
  GK_POSITION_WEIGHT: 0.40,
  GK_POSITION_REF: 0.12,   // GK 到落点距离衰减参考
  QUALITY_SAVE_DISCOUNT: 0.30,

  /** Shot Quality 权重（内部临时值，不持久化）。 */
  QUALITY_WEIGHTS: Object.freeze({ FINISHING: 0.40, TECHNIQUE: 0.20, DISTANCE: 0.20, ANGLE: 0.20 }),

  /** Shot 飞行时长（simulation seconds）。 */
  MIN_SHOT_DURATION: 0.15,
  MAX_SHOT_DURATION: 1.20,
  SHOT_SPEED: 0.60,

  /** pitch 边界。 */
  PITCH_MIN: 0,
  PITCH_MAX: 1,
});
