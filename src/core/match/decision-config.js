/**
 * Match Player Decision —— 集中配置（Step 39F-M-B-IMPLEMENTATION-01）。
 * 层级归属：Simulation Core / Match Decision。纯数据，无副作用。
 *
 * 规范来源：39F-M-B / 39F-M-B-CAL / 39F-M-B-FREEZE。
 * 语义：本文件只承载 **MVP 运行所需的集中常量**；**数值全部为 TBD-CAL**，
 * 未来由 39F-M-B-CAL / Resolution 阶段校准，**不得视为冻结参数**。
 *
 * 红线：无 RNG / 无 state 读取 / 不持久化 / 不进入 Save / 不新增玩家属性。
 */

/** 决策规则版本（用于 RNG scope；非 schema 字段）。 */
export const DECISION_RULE_VERSION = 'match-decision-v1';

/** 空决策（无任何合法候选）语义。 */
export const ACTION_NONE = 'NONE';

/** 六个 MVP Action Type（冻结）。 */
export const ACTION_TYPES = Object.freeze(['MOVE', 'PASS', 'DRIBBLE', 'SHOT', 'PRESS', 'TACKLE']);

/**
 * Candidate Eligibility 配置（冻结机制：Top-K ∧ Relative Preference Band）。
 * ⚠ `TOP_K` / `PREFERENCE_BAND` 为 **TBD-CAL**，仅提供可运行的 MVP 默认值。
 */
export const DECISION_SELECTION_CONFIG = Object.freeze({
  TOP_K: 3,             // [TBD-CAL]
  PREFERENCE_BAND: 0.25, // [TBD-CAL]
});

/** 单动作候选数量上限（防止候选爆炸）。 */
export const CANDIDATE_LIMITS = Object.freeze({
  PASS: 5, DRIBBLE: 3, SHOT: 3, PRESS: 3, TACKLE: 3, MOVE: 3,
});

/** 空间/距离量程（归一化坐标 [0,1]；己方球门 x=0，对方球门 x=1）。 */
export const DECISION_RANGES = Object.freeze({
  PASS_MAX_DISTANCE: 0.60,
  SHOT_MAX_DISTANCE: 0.60,
  PRESS_RANGE: 0.30,
  TACKLE_RANGE: 0.10,
  MOVE_DISTANCE: 0.15,
  DRIBBLE_DISTANCE: 0.12,
  PRESSURE_RANGE: 0.15,
  LANE_WIDTH: 0.06,
});

/** 对方球门参考点。 */
export const GOAL = Object.freeze({ x: 1, y: 0.5 });

/** Soft Influence 允许倍率区间（保证 soft 不越界成 hard）。 */
export const SOFT_MODIFIER_BOUNDS = Object.freeze({ MIN: 0.85, MAX: 1.15 });

/** Action-specific 基础偏好权重（Σ=1；**TBD-CAL**）。 */
export const PREF_WEIGHTS = Object.freeze({
  PASS: Object.freeze({ ABILITY: 0.25, PROXIMITY: 0.15, LANE: 0.25, AVAILABILITY: 0.15, PRESSURE: 0.20 }),
  DRIBBLE: Object.freeze({ TECHNIQUE: 0.30, PACE: 0.20, SPACE: 0.30, PRESSURE: 0.20 }),
  SHOT: Object.freeze({ FINISHING: 0.35, PROXIMITY: 0.25, ANGLE: 0.20, PRESSURE: 0.20 }),
  PRESS: Object.freeze({ DEFENDING: 0.30, CLOSENESS: 0.30, TEAM_PRESSING: 0.25, PHASE: 0.15 }),
  TACKLE: Object.freeze({ DEFENDING: 0.40, CLOSENESS: 0.35, CARRIER: 0.25 }),
  MOVE: Object.freeze({ PACE: 0.25, SPACE: 0.40, INTENT: 0.35 }),
});

/** Position Context 软修正（Position ≠ Role；仅 GK/DF/MF/FW）。 */
export const POSITION_MODIFIERS = Object.freeze({
  GK: Object.freeze({ MOVE: 0.90, PASS: 1.05, DRIBBLE: 0.70, SHOT: 0.50, PRESS: 0.30, TACKLE: 0.30 }),
  DF: Object.freeze({ MOVE: 1.00, PASS: 1.00, DRIBBLE: 0.95, SHOT: 0.90, PRESS: 1.05, TACKLE: 1.08 }),
  MF: Object.freeze({ MOVE: 1.05, PASS: 1.05, DRIBBLE: 1.05, SHOT: 0.98, PRESS: 1.00, TACKLE: 1.00 }),
  FW: Object.freeze({ MOVE: 1.00, PASS: 0.98, DRIBBLE: 1.06, SHOT: 1.12, PRESS: 0.95, TACKLE: 0.92 }),
});

/** 渐进传球阈值（x 前进量）。 */
export const PASS_PROGRESSIVE_DX = 0.08;
/** 回传阈值（x 后退量）。 */
export const PASS_BACK_DX = 0.05;
/** 长传距离阈值。 */
export const PASS_LONG_DISTANCE = 0.35;
