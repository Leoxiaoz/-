/**
 * PASS Resolution 配置（Step 39F-M-B-RESOLUTION-PASS）。
 * 层级归属：Simulation Core / Match Resolution。纯数据，无副作用、无 RNG。
 *
 * ⚠ 数值为 **TBD-CAL**（MVP 可运行默认值），未来由 Resolution 校准阶段调整。
 * 集中存放，禁止散落 magic numbers。
 */

/** Resolution 规则版本（用于 RNG scope；非 schema 字段）。 */
export const PASS_RESOLUTION_RULE_VERSION = 'match-pass-resolution-v1';

/** PASS 结果枚举（最小清晰语义；禁止把所有失败笼统称 PASS_FAILED）。 */
export const PASS_OUTCOMES = Object.freeze({
  COMPLETED: 'PASS_COMPLETED',
  INACCURATE: 'PASS_INACCURATE',
  INTERCEPTED: 'PASS_INTERCEPTED',
  BLOCKED: 'PASS_BLOCKED',
  CANCELLED: 'PASS_CANCELLED', // 非法输入 / 目标失效 / 未控球
});

/** Transit 状态枚举。 */
export const BALL_TRANSIT_STATE = Object.freeze({
  IN_TRANSIT: 'IN_TRANSIT',
  CONTROLLED: 'CONTROLLED',
  FREE: 'FREE',
});

export const PASS_RESOLUTION_CONFIG = Object.freeze({
  /** 目标控制半径：actualDestination 落在 intendedDestination 该半径内才算“到位”。 */
  CONTROL_RADIUS: 0.06,
  /** 距离归一化参考（与 Decision 的 PASS_MAX_DISTANCE 一致）。 */
  DISTANCE_REF: 0.60,

  /** 误差模型。 */
  BASE_ERROR: 0.03,
  DISTANCE_ERROR_SCALE: 0.45,
  PRESSURE_ERROR_SCALE: 0.55,
  ABILITY_ERROR_SCALE: 0.70,   // (1-ability) 放大误差
  ERROR_RNG_FACTOR: 0.40,      // 有界抖动占比 [1-f, 1+f]
  MIN_ERROR: 0.0,
  MAX_ERROR: 0.18,

  /** RiskIntent → execution profile（**不是** success bonus）。 */
  RISK_ERROR_MOD: Object.freeze({ LOW: 0.85, MEDIUM: 1.0, HIGH: 1.20 }),
  RISK_DESTINATION_PUSH: Object.freeze({ LOW: 0.0, MEDIUM: 0.0, HIGH: 0.02 }), // HIGH 允许更激进落点前推

  /** Intent → execution profile。 */
  INTENT_ERROR_MOD: Object.freeze({ SHORT: 0.90, LONG: 1.15, PROGRESSIVE: 1.0, BACK: 0.90, CLEAR: 1.10, CROSS: 1.20 }),
  INTENT_DURATION_MOD: Object.freeze({ SHORT: 0.90, LONG: 1.20, PROGRESSIVE: 1.0, BACK: 0.95, CLEAR: 1.15, CROSS: 1.10 }),

  /** 传球线路 / 拦截。 */
  INTERCEPTION_CORRIDOR: 0.045,
  INTERCEPTION_BASE: 0.55,
  INTERCEPTION_MAX: 0.90,
  DEFENDING_INTERCEPT_SCALE: 0.55, // defenderFactor = (1-s) + s*defending

  /** 封堵（落点到对手极近时）。 */
  BLOCK_RADIUS: 0.035,
  BLOCK_BASE: 0.35,

  /** 压力派生：附近对手半径与归一化。 */
  PRESSURE_RANGE: 0.15,
  PRESSURE_NORM: 3,

  /** 飞行时间（simulation seconds；不是真实物理）。 */
  MIN_PASS_DURATION: 0.40,
  MAX_PASS_DURATION: 4.00,
  PASS_SPEED: 0.35, // 每秒推进的归一化距离

  /** pitch 边界（坐标 invariant）。 */
  PITCH_MIN: 0,
  PITCH_MAX: 1,
});
