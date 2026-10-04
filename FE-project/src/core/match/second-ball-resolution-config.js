/**
 * Second-Ball Resolution 配置（Step 39F-M-C-07）。
 * 层级归属：Simulation Core / Match Resolution。纯数据，无副作用、无 RNG。
 *
 * 范围：当球因 DRIBBLE_KNOCKED_LOOSE / TACKLE_LOOSE / PRESS_SUCCESS /
 * INTERCEPTION_DEFLECTED 等结果进入 **FREE / loose-ball** 状态后，
 * 「谁以确定性基础规则赢得二点球」的结果语义与竞争参数。
 *
 * ⚠ 数值为 **TBD-CAL**（MVP 可运行默认值），未来由 Resolution 校准阶段调整。
 * 集中存放，禁止散落 magic numbers。
 *
 * 红线：不改 Save / Schema；不接 Renderer / Production Loop；无 Math.random；
 * 不建立第二套 Ball / Possession / Geometry Truth。
 */

/** Second-Ball Resolution 规则版本（用于 Result meta；非 schema 字段）。 */
export const SECOND_BALL_RESOLUTION_RULE_VERSION = 'match-second-ball-resolution-v1';

/** Second-Ball 结果枚举。 */
export const SECOND_BALL_OUTCOMES = Object.freeze({
  WON: 'SECOND_BALL_WON',              // 某球员以确定性竞争模型赢得二点球，建立控制
  NO_WINNER: 'SECOND_BALL_NO_WINNER',  // 无合法竞争者 / 竞争无法形成合法 winner → 球保持 FREE
  INVALID: 'SECOND_BALL_INVALID',      // 输入非法 / 球不处于可争抢的 FREE 状态 → 不改状态
});

/** 候选人资格判定枚举（用于可解释性；资格 ≠ 最终是否获胜）。 */
export const SECOND_BALL_ELIGIBILITY = Object.freeze({
  OK: 'OK',
  INVALID_PLAYER_ID: 'INVALID_PLAYER_ID', // playerId 缺失 / 非法
  INVALID_TEAM: 'INVALID_TEAM',           // 不属于当前 MatchCore 的有效球队
  NOT_AVAILABLE: 'NOT_AVAILABLE',         // 不在场 / 受伤 / 罚下
  BALL_NOT_FREE: 'BALL_NOT_FREE',         // 球不处于 FREE / loose-ball
  OUT_OF_RANGE: 'OUT_OF_RANGE',           // 与球不存在有效空间关系（超出争抢半径）
});

export const SECOND_BALL_RESOLUTION_CONFIG = Object.freeze({
  /** pitch 边界（坐标 invariant）。 */
  PITCH_MIN: 0,
  PITCH_MAX: 1,

  /** 争抢半径：球员到球的距离上限。超出即无资格（复用 ballRelation.distance 口径）。 */
  RANGE: 0.20,

  /** 最低获胜分数：低于此值视为「竞争无法形成合法 winner」→ NO_WINNER。 */
  MIN_SCORE: 0.02,

  /** 竞争模型权重（arrivalAdvantage + positioning + relevantAbility + contextModifier）。 */
  PROXIMITY_WEIGHT: 0.45,        // 到达优势：越近越大
  CLOSING_WEIGHT: 0.15,          // 到达优势：接近速度（closingSpeed）越大越大
  CLOSING_SPEED_NORM: 5,         // 接近速度归一化基准（TBD-CAL）
  ABILITY_DEFENDING_WEIGHT: 0.20, // relevantAbility：防守能力
  ABILITY_PACE_WEIGHT: 0.12,      // relevantAbility：速度
  CONTEXT_WEIGHT: 0.08,           // contextModifier：soft state（fitness/form/morale）
});