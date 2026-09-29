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
 * 赛后负荷反馈参数（第 18 步；DECISIONS D-16）。
 * 说明：**最小闭环**——实际出场球员消耗体能、通过比赛建立状态；不做表现评分。
 * 数值为暂定校准值，可统一调参。form 以"向基线逼近"实现有界恢复（不会无限增长或永久停在 0）。
 */
export const MATCH_LOAD_CONFIG = Object.freeze({
  /** 每名实际出场球员的单场出场分钟（本步无首发/换人系统，视为打满）。 */
  MINUTES_PER_MATCH: 90,
  /** 每名实际出场球员的单场体能消耗（点）。 */
  FITNESS_COST: 12,
  /** 出场后 form 向基线（FORM_BASELINE）逼近的比例（0–1，有界）。 */
  FORM_RECOVER_RATE: 0.25,
  /** form 的赛后恢复基线。 */
  FORM_BASELINE: 50,
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
  /** 长期伤病放缓成长的幅度倍率（惩罚赛季数由**伤病系统**写入 `growth.injuryPenaltySeasons`）。 */
  INJURY_PENALTY: Object.freeze({ FACTOR: 0.85 }),
  /** 训练修正默认值（B1：预留接口，本期不实现训练本体）。 */
  DEFAULT_TRAINING_FACTOR: 1.0,
});

/**
 * 伤病系统参数（第 17 步；DECISIONS D-15）。
 * 说明：**配置驱动**，类型/严重度不硬编码到逻辑。数值为暂定校准值，可统一调参。
 */
export const INJURY_CONFIG = Object.freeze({
  /** 伤病类型表（数据驱动；逻辑不写死类型名）。 */
  TYPES: Object.freeze({
    knock: Object.freeze({ category: 'minor-blow', baseDays: 6, dayRange: 4 }),
    muscle: Object.freeze({ category: 'soft-tissue', baseDays: 14, dayRange: 8 }),
    hamstring: Object.freeze({ category: 'soft-tissue', baseDays: 21, dayRange: 10 }),
    ankle: Object.freeze({ category: 'joint', baseDays: 28, dayRange: 12 }),
    knee: Object.freeze({ category: 'joint', baseDays: 45, dayRange: 20 }),
    concussion: Object.freeze({ category: 'head', baseDays: 14, dayRange: 6 }),
    ligament: Object.freeze({ category: 'severe-structural', baseDays: 90, dayRange: 60 }),
    illness: Object.freeze({ category: 'illness', baseDays: 10, dayRange: 5 }),
  }),
  /** 严重度分档（按缺阵天数；本阶段只有三级）。 */
  SEVERITY_BANDS: Object.freeze([
    Object.freeze({ name: 'minor', maxDays: 14 }),
    Object.freeze({ name: 'moderate', maxDays: 45 }),
    Object.freeze({ name: 'severe', maxDays: Infinity }),
  ]),
  /** 出场发生伤病的每场基础概率（由球员因素与随机修正）。 */
  BASE_INJURY_CHANCE: 0.012,
  /** 单名球员单场受伤概率上限（防止失控）。 */
  MAX_INJURY_CHANCE: 0.05,
  /** 每场每方最多新增伤病人数（防一次爆量）。 */
  MAX_INJURIES_PER_MATCH_SIDE: 1,
  /** 严重度抽取基准权重（随体能/倾向/年龄调整）。 */
  SEVERITY_WEIGHTS: Object.freeze({ minor: 0.75, moderate: 0.21, severe: 0.04 }),
  /** 严重度 -5 上限保护（severe 天数封顶，防止极端值）。 */
  SEVERE_MAX_DAYS: 240,
  /** 伤病发生时的 vitals 立即下降（按严重度）。 */
  VITALS_DROP: Object.freeze({
    FITNESS: Object.freeze({ minor: 8, moderate: 20, severe: 40 }),
    FORM: Object.freeze({ minor: 5, moderate: 12, severe: 25 }),
    MORALE: Object.freeze({ minor: 2, moderate: 6, severe: 15 }),
  }),
  /** 高 injuryProneness 对概率/恢复/复发的修正强度（每偏离 50 的影响比例）。 */
  PRONENESS: Object.freeze({ CHANCE: 0.6, RECOVERY: 0.1, RECURRENCE: 0.2 }),
  /** 年龄与体能对概率/恢复的修正。 */
  AGE: Object.freeze({ CHANCE_START: 30, CHANCE_PER_YEAR: 0.02, RECOVERY_START: 30, RECOVERY_PER_YEAR: 0.01 }),
  /** 体能对概率的修正（fitness 每低 10 点 → 概率乘数）。 */
  FITNESS_CHANCE_STEP: 1.25,
  /**
   * 恢复期每日 fitness 变化。
   * 第 18 步：健康球员改为**分数式逼近满值**（按缺口比例回升），避免"比赛有消耗但每周仍回到满值"的失真；
   * 伤病期间 fitness 仍按**绝对点数**日降。
   */
  FITNESS: Object.freeze({ RECOVER_FRACTION_PER_DAY: 0.1, INJURED_DROP_PER_DAY: 0.6 }),
  /** 伤病期间 form 冻结目标（不随比赛建立），每日向 0 衰减。 */
  FORM_INJURED_TARGET: 0,
  /** 伤病期间 morale 日降（长期病尤甚，按剩余天数加权）。 */
  MORALE_DROP_PER_DAY: 0.15,
  /** 士气基线（康复后向其温和回归）。 */
  BASELINE_MORALE: 50,
  /** 康复后体能上限（不立即满值；伤病期间会继续跌）。 */
  RECOVERY_FITNESS_CAP: 80,
  /** 长期伤病（severity=severe）写入的成长放缓赛季数。 */
  GROWTH_PENALTY_SEASONS: 1,
  /** 康复后 morale 每日恢复至 50 的速度（分）。 */
  MORALE_RECOVER_PER_DAY: 0.5,
  /** 复发概率基数与加成上限（防止失控）。 */
  RECURRENCE: Object.freeze({ BASE_CHANCE: 0.08, PER_INCIDENT: 0.03, MAX_MULTIPLIER: 1.8 }),
});

/** 积分规则。 */
export const TABLE_CONFIG = Object.freeze({
  WIN: 3,
  DRAW: 1,
  LOSS: 0,
});

/**
 * 退役参数（第 19 步；DECISIONS D-17）。
 * 说明：**配置驱动**，年龄曲线按「成长 peak + 衰退速率 + 实测年龄分布」推导（见 SIMULATION_SPEC §23），
 * 非凭空取值。软区间内线性概率、hardCap 强制退役；MVP 不使用能力/伤病史作为退役条件。
 */
export const RETIREMENT_CONFIG = Object.freeze({
  /** 总开关：false 时完全跳过退役与新生代（结构不变，行为回到第 18 步）。 */
  ENABLED: true,
  /** 各位置退役曲线（softStart 起线性升概率，hardCap 强制）。 */
  CURVES: Object.freeze({
    FW: Object.freeze({ softStart: 32, hardCap: 37 }),
    DF: Object.freeze({ softStart: 33, hardCap: 38 }),
    MF: Object.freeze({ softStart: 33, hardCap: 38 }),
    GK: Object.freeze({ softStart: 35, hardCap: 40 }),
  }),
});

/**
 * 新生代生成参数（第 19 步；DECISIONS D-17）。
 * 说明：采用「同位置静态模板 + 三路独立有界抖动」，模板恒取自**不可变 static DB**，避免逐代累积漂移。
 */
export const GENERATION_CONFIG = Object.freeze({
  /** 入队年龄区间（含端点）。 */
  AGE_MIN: 17,
  AGE_MAX: 19,
  /** base 属性独立抖动幅度（±）。 */
  BASE_JITTER: 3,
  /** potential headroom 独立抖动幅度（±）。 */
  HEADROOM_JITTER: 2,
  /** personality 独立抖动幅度（±）。 */
  PERSONALITY_JITTER: 3,
  /** headroom 上限（对齐库经验上限，避免潜力虚高）。 */
  MAX_HEADROOM: 18,
  /** 新生代 ID 命名空间前缀（D-04）。 */
  ID_PREFIX: 'ply_g_',
  /** ID 序号补零位数。 */
  ID_PAD: 4,
});
