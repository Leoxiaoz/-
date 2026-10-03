/**
 * Match Tactical + Movement —— 集中配置常量（Step 39F-M-C）。
 * 层级归属：Simulation Core / Match Movement。**纯数据**，无副作用、无 RNG、无 state 读取。
 *
 * 规范来源：39F-M-C Tactical + Movement Implementation Gate 01（§3/§4/§5/§10/§11/§12/§16/§17）。
 *
 * 红线：
 * - 本层**不得**参与 PASS / SHOT Resolution 成功率计算（战术不是结果修正器）。
 * - 数值集中于此，**禁止散落 magic number**。
 * - 本层为 **transient / derived / 不持久化**；不进入 Save / Schema（Schema 仍为 10）。
 */

/** Movement 规则版本（用于 RNG scope；非 schema 字段）。 */
export const MOVEMENT_RULE_VERSION = 'match-movement-v1';

/** 归一化球场边界。 */
export const PITCH_BOUNDS = Object.freeze({ MIN: 0, MAX: 1 });

/**
 * Tactical State 量程默认值（§3 冻结字段集合）。
 * 全部为 **optional**：缺失 / 非法时回退默认；不回写 MatchCore、不改 Schema。
 * `pressingIntensity` 优先读取，缺省兼容既有 `pressing` 字段（复用现状）。
 */
export const TACTICAL_DEFAULTS = Object.freeze({
  formation: '4-4-2',
  mentality: 'balanced',
  possessionStyle: 'balanced',   // direct | balanced | short
  pressingIntensity: 'medium',   // low | medium | high
  defensiveLine: 'medium',       // deep | medium | high
  width: 'medium',               // narrow | medium | wide
  tempo: 'medium',               // low | medium | high
  transitionStyle: 'balanced',   // counter | press | balanced
});

/** 各字段合法枚举（用于规范化与测试）。 */
export const TACTICAL_ENUMS = Object.freeze({
  mentality: Object.freeze(['defensive', 'balanced', 'attacking']),
  possessionStyle: Object.freeze(['direct', 'balanced', 'short']),
  pressingIntensity: Object.freeze(['low', 'medium', 'high']),
  defensiveLine: Object.freeze(['deep', 'medium', 'high']),
  width: Object.freeze(['narrow', 'medium', 'wide']),
  tempo: Object.freeze(['low', 'medium', 'high']),
  transitionStyle: Object.freeze(['counter', 'press', 'balanced']),
});

/** Tactical Phase（§4 冻结）。SET_PIECE 仅保留 placeholder。 */
export const TACTICAL_PHASE = Object.freeze({
  IN_POSSESSION: 'IN_POSSESSION',
  OUT_OF_POSSESSION: 'OUT_OF_POSSESSION',
  TRANSITION: 'TRANSITION',
  SET_PIECE: 'SET_PIECE', // placeholder：本 Gate 不实现 Set Piece Engine
});

/** Possession Tenure（§4 语义：JUST_WON / JUST_LOST → TRANSITION → settled）。 */
export const POSSESSION_TENURE = Object.freeze({
  JUST_WON: 'JUST_WON',
  JUST_LOST: 'JUST_LOST',
  SETTLED: 'SETTLED',
  NONE: 'NONE',
});

/** Ball Zone（纵向，按控球队视角）。 */
export const BALL_ZONE = Object.freeze({
  DEFENSIVE_THIRD: 'DEFENSIVE_THIRD',
  MIDDLE_THIRD: 'MIDDLE_THIRD',
  FINAL_THIRD: 'FINAL_THIRD',
});

/** Ball Channel（横向）。 */
export const BALL_CHANNEL = Object.freeze({
  LEFT: 'LEFT',
  LEFT_HALF_SPACE: 'LEFT_HALF_SPACE',
  CENTRAL: 'CENTRAL',
  RIGHT_HALF_SPACE: 'RIGHT_HALF_SPACE',
  RIGHT: 'RIGHT',
});

/** Block Height（由 Shape + defensiveLine + 情境派生）。 */
export const BLOCK_HEIGHT = Object.freeze({
  HIGH_BLOCK: 'HIGH_BLOCK',
  MID_BLOCK: 'MID_BLOCK',
  LOW_BLOCK: 'LOW_BLOCK',
});

/** Build-up Phase（有球方）。 */
export const BUILD_UP_PHASE = Object.freeze({
  BUILD_UP: 'BUILD_UP',
  PROGRESSION: 'PROGRESSION',
  FINAL_THIRD: 'FINAL_THIRD',
});

/** Team Shape 类别。 */
export const SHAPE_KIND = Object.freeze({
  IN_POSSESSION: 'IN_POSSESSION',
  OUT_OF_POSSESSION: 'OUT_OF_POSSESSION',
});

/** Movement Intent（§8；本 Gate MVP 集合）。 */
export const MOVEMENT_INTENT = Object.freeze({
  // 有球 / 进攻
  HOLD_POSITION: 'HOLD_POSITION',
  SUPPORT: 'SUPPORT',
  OFFER: 'OFFER',
  RUN_FORWARD: 'RUN_FORWARD',
  RUN_BEHIND: 'RUN_BEHIND',
  DROP: 'DROP',
  WIDEN: 'WIDEN',
  NARROW: 'NARROW',
  CREATE_SPACE: 'CREATE_SPACE',
  ATTACK_SPACE: 'ATTACK_SPACE',
  RECOVER_SHAPE: 'RECOVER_SHAPE',
  // 无球 / 防守
  MARK: 'MARK',
  COVER: 'COVER',
  STEP_UP: 'STEP_UP',
  PRESS_MOVE: 'PRESS_MOVE',
  CHASE: 'CHASE',
});

/** Movement Target 语义类型（§10）。 */
export const TARGET_KIND = Object.freeze({
  ANCHOR: 'ANCHOR',
  SPACE: 'SPACE',
  RELATIVE: 'RELATIVE',
  OPPONENT_RELATIVE: 'OPPONENT_RELATIVE',
  BALL_RELATIVE: 'BALL_RELATIVE',
});

/**
 * Locomotion MVP 参数（§11/§12）。dt 以 **simulation minute** 为单位，坐标为归一化单位。
 * speed 单位为「归一化球场单位 / simulation minute」。
 */
export const LOCOMOTION = Object.freeze({
  /** 到达半径：distance <= ARRIVE_RADIUS 视为到达。 */
  ARRIVE_RADIUS: 0.012,
  /** 基准速度。 */
  BASE_SPEED: 0.055,
  /** 速度下 / 上限（bounded；任何单一因素不得完全支配）。 */
  MIN_SPEED: 0.018,
  MAX_SPEED: 0.125,
  /** pace 参考中值。 */
  PACE_REFERENCE: 70,
  /** 速度权重（Σ=1）。 */
  WEIGHTS: Object.freeze({ PACE: 0.45, URGENCY: 0.30, BALL_PROXIMITY: 0.10, FITNESS: 0.15 }),
  /** pace 相对参考的归一化跨度。 */
  PACE_SPAN: 0.5,
  /** 球邻近度计算半径。 */
  BALL_PROXIMITY_RANGE: 0.25,
});

/** Movement Intent 紧迫度（0..1；仅影响移动速度 / 倾向，不影响 Resolution）。 */
export const INTENT_URGENCY = Object.freeze({
  HOLD_POSITION: 0.20,
  SUPPORT: 0.50,
  OFFER: 0.60,
  RUN_FORWARD: 0.90,
  RUN_BEHIND: 0.95,
  DROP: 0.60,
  WIDEN: 0.50,
  NARROW: 0.50,
  CREATE_SPACE: 0.70,
  ATTACK_SPACE: 0.85,
  RECOVER_SHAPE: 0.70,
  MARK: 0.80,
  COVER: 0.80,
  STEP_UP: 0.75,
  PRESS_MOVE: 0.95,
  CHASE: 1.00,
});

/**
 * Team Shape 参数（§6）。
 * 所有偏移 **必须 bounded**（防全队追球 / 结构崩塌）。
 */
export const SHAPE = Object.freeze({
  /** 各线 x（己方视角 progress：己方球门 0 → 对方球门 1）。 */
  LINE_X: Object.freeze({ GK: 0.04, DF: 0.20, MF: 0.44, FW: 0.70 }),
  /** 同一线内的横向留边。 */
  Y_MARGIN: 0.04,
  /** In-Possession 形态：更宽 / 更深 / 整体前移。 */
  IP: Object.freeze({ WIDTH: 1.18, DEPTH: 1.10, ADVANCE: 0.05 }),
  /** Out-of-Possession 形态：更紧凑 / 更短 / 略后撤。 */
  OOP: Object.freeze({ WIDTH: 0.86, DEPTH: 0.88, ADVANCE: -0.03 }),
  /** defensiveLine 对防线高度的偏移（己方视角 progress）。 */
  DEF_LINE: Object.freeze({ deep: -0.07, medium: 0.0, high: 0.07 }),
  /** width 对横向展开的倍率。 */
  WIDTH_SCALE: Object.freeze({ narrow: 0.78, medium: 1.0, wide: 1.22 }),
  /** Ball-relative shift（有界）：纵向 / 横向比例与上限。 */
  BALL_SHIFT: Object.freeze({ X: 0.22, Y: 0.16, MAX_X: 0.10, MAX_Y: 0.09, FAR_FACTOR: 0.35 }),
  /** 结构有效性参考距离（shape validity = 1 - clamp(avgDist / 本值)）。 */
  VALIDITY_REF: 0.30,
  /** 锚点纵向夹取留边。 */
  X_MARGIN: 0.03,
});

/** Movement Intent → Target 偏移量（§5/§10；全部有界）。 */
export const INTENT_TARGET = Object.freeze({
  /** 前插 / 攻击空间的纵向推进（己方视角 progress）。 */
  ADVANCE: 0.14,
  /** RUN_BEHIND 的反越位纵深。 */
  RUN_BEHIND: 0.22,
  /** 回撤纵深。 */
  DROP: 0.12,
  /** 前压 / 上步纵深。 */
  STEP_UP: 0.10,
  /** 拉边 / 收窄横向幅度。 */
  WIDEN: 0.12,
  NARROW: 0.12,
  /** SUPPORT / OFFER 向球靠拢的比例。 */
  SUPPORT_PULL: 0.35,
  OFFER_PULL: 0.50,
  /** 盯人时相对对手的偏移幅度（朝己方球门一侧）。 */
  MARK_GAP: 0.05,
});

/** 球区 / 通道分界（归一化）。 */
export const ZONE_BOUNDS = Object.freeze({
  THIRD_1: 1 / 3,
  THIRD_2: 2 / 3,
  CHANNEL: Object.freeze([0.2, 0.4, 0.6, 0.8]),
});

/** Transition 窗口（simulation minutes；§4：Transition 不得成为永久状态）。 */
export const TRANSITION = Object.freeze({
  /** JUST_WON / JUST_LOST 在此时长内视为 TRANSITION。 */
  WINDOW: 4,
  /** 球在空中（transit）也视为 TRANSITION。 */
  INCLUDE_BALL_TRANSIT: true,
});

/** Re-evaluation 阈值（§16/§18）。 */
export const REEVAL = Object.freeze({
  BALL_MOVE_THRESHOLD: 0.02,
  OPPONENT_MOVE_THRESHOLD: 0.02,
  TEAMMATE_MOVE_THRESHOLD: 0.02,
  /** 位移小于此值视为「到达后稳定」，不重算目标。 */
  STABLE_EPSILON: 0.004,
  /** Movement Intent 承诺上限（simulation minutes）；超时强制重评，防无限存活。 */
  COMMIT_MAX_MINUTES: 8,
});

/** Movement 更新层级（§16）。 */
export const MOVEMENT_LEVEL = Object.freeze({
  L0: 'L0', // 每 tick 轻量 Locomotion（22 人）
  L1: 'L1', // 事件驱动 Intent / Target 重评（命中子集）
  L2: 'L2', // 完整 Decision（极少球员；本 Gate 只保留 hook，不接 Decision Pipeline）
});

/** 压迫半径（复用 Decision 既有量程，避免重复定义）。 */
export const PRESS_RANGE = 0.30;
/** 盯人 / 覆盖邻近半径。 */
export const MARK_RANGE = 0.22;