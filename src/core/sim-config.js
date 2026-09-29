/**
 * 模拟常量（集中存放，禁止散落的魔法数字）。
 * 层级归属：Simulation Core。纯数据，无副作用。
 *
 * 说明：下列数值为**MVP 暂定校准值**（DECISIONS D-11 / SIMULATION_SPEC S12 待细化），
 * 集中于此以便后续按比分分布目标统一调参，而不改动算法结构。
 *
 * 领域枚举（位置 / 属性 / 倾向）见 shared/football-schema.js，此处不重复定义。
 */

/** 攻守倾向（战术最小集，DECISIONS D-11）。数值为进攻产出倍率。 */
export const MENTALITY = Object.freeze({
  defensive: 0.85,
  balanced: 1.0,
  attacking: 1.15,
});

/** 默认阵型与其各线人数（DF / MF / FW）；用于决定球队实力计算时各线取样人数。 */
export const DEFAULT_FORMATION = '4-4-2';

export const FORMATIONS = Object.freeze({
  '4-4-2': Object.freeze({ DF: 4, MF: 4, FW: 2 }),
  '4-3-3': Object.freeze({ DF: 4, MF: 3, FW: 3 }),
  '4-5-1': Object.freeze({ DF: 4, MF: 5, FW: 1 }),
  '3-5-2': Object.freeze({ DF: 3, MF: 5, FW: 2 }),
  '5-3-2': Object.freeze({ DF: 5, MF: 3, FW: 2 }),
});

/** 比赛模拟参数（时段制，DECISIONS D-02）。 */
export const MATCH_CONFIG = Object.freeze({
  /** 一场比赛的时段数（90 分钟按此均分）。 */
  SEGMENTS: 6,
  /** 基准期望进球（双方实力相等、中立场地、balanced 时的每队期望）。 */
  BASE_EXPECTED_GOALS: 1.35,
  /** 主场优势倍率（作用于主队进攻产出）。 */
  HOME_ADVANTAGE: 1.18,
  /** 实力比值的平滑地板，避免除以 0 或极端比值。 */
  STRENGTH_FLOOR: 20,
  /** 随机波动强度上限（±比例），随机只扰动概率，不脱离实力对比（SIMULATION_SPEC §11）。 */
  NOISE_AMPLITUDE: 0.25,
});

/** 赛程参数。 */
export const SCHEDULE_CONFIG = Object.freeze({
  /** 相邻两轮间隔天数。 */
  ROUND_INTERVAL_DAYS: 7,
  /** 赛季结束到新赛季开始的间隔天数（赛季滚动时使用）。 */
  SEASON_GAP_DAYS: 30,
});

/**
 * 球员运行时状态参数（第 15 步）。
 * 说明：此处仅为**数据结构默认值与合法量程**（非模型系数）；成长 / 伤病 / 恢复等算法
 * 仍属 `[TBD]`（SIMULATION_SPEC §7–§9、§13–§15），待制定者决策后再接入。
 */
export const PLAYER_RUNTIME_CONFIG = Object.freeze({
  /** 体能 / 状态 / 士气量程（0–100，与属性 1–99 为不同量表）。 */
  VITALS: Object.freeze({
    MIN: 0,
    MAX: 100,
    INITIAL_FITNESS: 100,
    INITIAL_FORM: 50,
    INITIAL_MORALE: 50,
  }),
  /** 单场比赛分钟上限（用于出场统计校验）。 */
  MAX_MINUTES_PER_MATCH: 120,
});

/**
 * 球员成长 / 衰退参数（第 16 步；DECISIONS D-14）。
 * 说明：下列为**暂定校准值**（制定者已确认按建议默认值落地，可后续统一调参），
 * 集中于此以便调整结构而不改算法。全部为**确定性模型参数**，随机仅作有界扰动。
 *
 * 核心设计：成长以「距每属性潜力上限的余量 × 年龄速率」驱动（自然收益递减、绝不越上限）；
 * 过巅峰后按年龄线性衰退，身体属性优先。
 */
export const PLAYER_GROWTH_CONFIG = Object.freeze({
  /** 属性分组（不同年龄曲线；B5）。 */
  GROUPS: Object.freeze({
    pace: 'physical',
    technique: 'technical',
    passing: 'technical',
    defending: 'technical',
    finishing: 'technical',
    goalkeeping: 'goalkeeping',
  }),
  /** 各分组巅峰年龄（超过即开始衰退；B6：身体最早、门将最晚）。 */
  PEAK_AGE: Object.freeze({ physical: 27, technical: 30, goalkeeping: 32 }),
  /** 成长速率：每赛季吸收「剩余潜力余量」的比例，按年龄段递减。 */
  GROWTH_RATE_BY_AGE: Object.freeze([
    Object.freeze({ maxAge: 20, rate: 0.25 }),
    Object.freeze({ maxAge: 24, rate: 0.15 }),
    Object.freeze({ maxAge: 28, rate: 0.06 }),
  ]),
  /** 衰退速率：过巅峰后每多一岁的每赛季衰退点数（按分组；B6）。 */
  DECLINE_RATE: Object.freeze({ physical: 0.7, technical: 0.4, goalkeeping: 0.3 }),
  /** 出场加成：赛季满勤(1800 分钟)时的最大成长加成倍率与「年轻权重」年龄窗（B2）。 */
  APPEARANCE: Object.freeze({ MAX_BONUS: 0.2, FULL_MINUTES: 1800, YOUNG_AGE: 21, FADE_AGE: 27 }),
  /** 状态/士气温和影响幅度（B3）：各自 ±该比例，合计约 0.8–1.2。 */
  VITALS_SENSITIVITY: 0.1,
  /** 人格对成长/衰退的修正强度（B4；每 50 点偏离带来该比例变化）。 */
  PERSONALITY: Object.freeze({
    PROFESSIONALISM: 0.1,
    DETERMINATION: 0.05,
    AMBITION: 0.05,
  }),
  /** 随机波动幅度（±比例，有界；C2）。 */
  NOISE_AMPLITUDE: 0.15,
  /** 超预期成长（C3）：触发概率与额外点数（不突破潜力上限）。 */
  BREAKOUT: Object.freeze({ CHANCE: 0.05, BONUS: 2 }),
  /** 长期伤病（B7）：单次伤病剩余天数达到该阈值即触发「后续成长放缓」。 */
  LONG_INJURY_DAYS: 90,
  /** 长期伤病惩罚：成长倍率与持续赛季数。 */
  INJURY_PENALTY: Object.freeze({ FACTOR: 0.85, SEASONS: 1 }),
  /** 训练修正默认值（B1：预留接口，本期不实现训练本体）。 */
  DEFAULT_TRAINING_FACTOR: 1.0,
});

/** 积分规则。 */
export const TABLE_CONFIG = Object.freeze({
  WIN: 3,
  DRAW: 1,
  LOSS: 0,
});