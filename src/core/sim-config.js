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

/**
 * 阵容参数（第 20 步）。
 * 说明：首发人数与阵型各线人数强绑定（`FORMATIONS` 之和恒为 STARTERS）；替补仅**存储与展示**，
 * **本步骤不参与比赛、不参与换人**（换人引擎属 out-of-scope）。
 */
export const LINEUP_CONFIG = Object.freeze({
  /** 首发总人数（= GK 1 + 阵型 DF/MF/FW 之和）。 */
  STARTERS: 11,
  /** 替补席容量（仅存储/展示，暂不参与换人）。 */
  BENCH: 7,
});

/**
 * 俱乐部阵容边界（Step 26B；DECISIONS D-24 的 D7 / D16）。
 * 语义：**边界（boundary）而非精确目标**——只判定「是否低于下限 / 高于上限」，不追求恢复到固定人数。
 * - `MIN_PLAYERS`：阵容人数下限。低于即 roster deficit（应视为真实缺口）。
 * - `MAX_PLAYERS`：阵容人数上限。**超过仅作诊断（over-cap），绝不自动裁员**。
 * - `PREFERRED_PLAYERS`：**软偏好点**，仅供解释/展示，**不是硬目标**
 *   （禁止 `current < 14 → 补到 14`，禁止 `15 → 裁到 14`；合法区间为 [MIN, MAX]）。
 * - 位置最低保障：`MIN_GK` 单列（GK 不重复计入 `MIN_BY_POSITION`）；
 *   结构最低 = GK 1 + DF 4 + MF 4 + FW 2 = 11，而 `MIN_PLAYERS = 12` 额外保留 1 名阵容缓冲。
 * 说明：位置最低线为**可排阵/可运行**的结构性保障（不随阵型变化），供人口评估使用。
 */
export const ROSTER_CONFIG = Object.freeze({
  MIN_PLAYERS: 12,
  MAX_PLAYERS: 24,
  PREFERRED_PLAYERS: 14,
  MIN_GK: 1,
  MIN_BY_POSITION: Object.freeze({ DF: 4, MF: 4, FW: 2 }),
});

/**
 * 世界人口最低边界（Step 26B；DECISIONS D-24 的 D16）。
 * 语义：世界人口的**防坍缩安全线**（boundary，非 exact target）。
 * - 只回答「整个世界是否缺人（active world population < 本值）」，**不指定位置、不恢复某队到固定人数、不裁人、不建自由球员**。
 * - MVP 标准世界取 `8 队 × ROSTER_CONFIG.MIN_PLAYERS(12) = 96`；**禁止设为 112**（会重造 exact-112 隐性语义）。
 * - 有效世界下限另按「实际俱乐部数 × MIN_PLAYERS」派生并与本值取较小者（见 player-lifecycle：小规模自定义世界不被强制膨胀）。
 * - 正常生命周期中，俱乐部层补位后世界人口恒 ≥ Σ俱乐部下限，故本安全网通常**不会独立触发**，仅作兜底。
 */
export const WORLD_MIN_POPULATION = 96;

/**
 * 世界人口「有界生态库存上限」（Step 34 / D-33.6、D-34.1）。
 * 语义：**上限保护**，非自动补人口目标 —— 任何 `generatePlayer` 前必须满足 `worldActive < WORLD_SOFT_CAP`；
 * 严禁“低于 112 自动生成到 112”“每季补到 112”。与 `WORLD_MIN_POPULATION`（生存底线）职责分离。
 */
export const WORLD_SOFT_CAP = 112;

/**
 * 各线评分参考属性（MVP 最小集，DECISIONS D-11）。
 * 供 `team-strength`（选阵/实力/比赛修复）与 `player-lineup`（赛季自愈回填）共用，避免重复定义。
 */
export const LINE_ATTRIBUTES = Object.freeze({
  GK: ['goalkeeping'],
  DF: ['defending', 'pace'],
  MF: ['passing', 'technique'],
  FW: ['finishing', 'technique', 'pace'],
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
 * 球员比赛表现参数（Step 21-A；DECISIONS D-22）。
 * 说明：由**独立派生 RNG**在比分确定**之后**生成，配置驱动、有界；**不改比分算法、不进比分 RNG 流**。
 * 所有球员表现仅写入 `involvements` 与长期统计，**不写回 form/morale/fitness/growth**（红线）。
 */
export const MATCH_PERFORMANCE_CONFIG = Object.freeze({
  /** 位置射门画像：期望（非进球）射门次数、射正比例、能力参考属性。 */
  POSITION_SHOTS: Object.freeze({
    GK: Object.freeze({ attempts: 0.02, onTarget: 0.30, attr: 'goalkeeping' }),
    DF: Object.freeze({ attempts: 0.45, onTarget: 0.35, attr: 'technique' }),
    MF: Object.freeze({ attempts: 1.15, onTarget: 0.42, attr: 'technique' }),
    FW: Object.freeze({ attempts: 2.20, onTarget: 0.52, attr: 'finishing' }),
  }),
  /** 位置画像缺省（未知位置）回退。 */
  DEFAULT_POSITION: 'MF',
  /** 射门期望的随机波动（±比例，有界）。 */
  ATTEMPT_NOISE: 0.35,
  /** 单名球员单场射门数上限（防止失控）。 */
  MAX_ATTEMPTS: 6,
  /** 能力对射门期望/射正比例的加权（属性归一化后线性系数）。 */
  ABILITY: Object.freeze({ ATTEMPTS: 0.8, ON_TARGET: 0.4 }),
  /** 每次进球转化为助攻的概率（<=1，保证 Σassists <= Σgoals）。 */
  ASSIST_CHANCE: 0.62,
  /** 助攻者权重参考属性（组织/技术）。 */
  ASSIST_WEIGHT_ATTR: 'passing',
  /** 黄/红牌基础概率与位置倍率（单场每球员 <=1 张黄、<=1 张红，有界）。 */
  YELLOW_CHANCE: 0.06,
  RED_CHANCE: 0.004,
  CARD_POSITION_MULTIPLIER: Object.freeze({ GK: 0.4, DF: 1.3, MF: 1.1, FW: 0.9 }),
  /** 评分模型（确定性、可解释、固定上下界；不依赖 vitals）。 */
  RATING: Object.freeze({
    BASE: 6.0,
    GOAL: 1.0,
    ASSIST: 0.5,
    SHOTS_ON_TARGET: 0.1,
    YELLOW: -0.3,
    RED: -1.5,
    WIN: 0.3,
    LOSS: -0.3,
    POSITION_BONUS: Object.freeze({ GK: 0.2, DF: 0.1, MF: 0.0, FW: 0.0 }),
    MIN: 4.0,
    MAX: 10.0,
  }),
});

/**
 * 合同地基参数（Step 25；DECISIONS D-24 / SIMULATION_SPEC §31）。
 * 说明：v1 **确定性模板**——同一 playerId 恒得同一期限/工资，**不使用任何随机**（D20）。
 * 合同期限为**整数赛季**（D4）；工资为**每赛季工资**（D5）；v1 不自动续约。
 */
export const CONTRACT_CONFIG = Object.freeze({
  /** 合同最短 / 最长赛季数（endSeason = startSeason + 区间内确定性档位）。 */
  MIN_DURATION_SEASONS: 2,
  MAX_DURATION_SEASONS: 4,
  /** 每赛季工资档位基数（按位置）。 */
  WAGE_POSITION_BASE: Object.freeze({ GK: 30, DF: 32, MF: 36, FW: 40 }),
  /** 每点平均能力对应的每赛季工资增量。 */
  WAGE_PER_ABILITY: 0.8,
  /** 每赛季工资下限。 */
  WAGE_MIN: 10,
});

/**
 * 财政地基参数（Step 25；DECISIONS D-24 / SIMULATION_SPEC §31）。
 * 说明：v1 **确定性模板**（同一 clubId 恒得同一初始值，**不使用随机**，D20）。
 * - `INITIAL_CASH` = 唯一真实货币余额的初值；
 * - `INITIAL_WAGE_BUDGET` / `INITIAL_TRANSFER_BUDGET` = **约束上限**（非额外余额）；
 * - v1 **不从 cash 扣除工资**（D13/D17）。
 */
export const FINANCE_CONFIG = Object.freeze({
  INITIAL_CASH: 1000,
  INITIAL_WAGE_BUDGET: 400,
  INITIAL_TRANSFER_BUDGET: 600,
  /**
   * 赛季边界 transferBudget 再生量（Step 34 / D-33.7、D-34.2）。
   * carry-over 语义：`new = min(INITIAL_TRANSFER_BUDGET, current + REPLENISHMENT_AMOUNT)`；
   * 无 RNG、有上限、不 reset、不改 cash。
   */
  TRANSFER_BUDGET_REPLENISHMENT: 420,
});

/**
 * 转会费参数（Step 28B；DECISIONS D-27 T2/T3）。
 * 说明：**确定性能力定价模型**——`Fee = BASE × AbilityFactor × AgeFactor × PositionFactor`。
 * - 纯函数、无随机（D-27 T23）；**不存储** marketValue；**不读取** cash / transferBudget / squad size（禁止「越有钱越贵」）。
 * - AbilityFactor 基于**完整 effective attribute 向量**的均值（非单一 OVR）；AgeFactor 遵循 Growth/Decline 年龄曲线；
 *   PositionFactor 仅**轻微**差异。Potential / Fitness / Form / Morale / Injury / Stats **不参与定价**。
 * - Fee 越界 clamp 到 `[MIN_TRANSFER_FEE, MAX_TRANSFER_FEE]`（T3），防止长期成长导致经济数值无限膨胀。
 */
export const TRANSFER_CONFIG = Object.freeze({
  /** 基准费（能力中性、年龄巅峰、位置中性时的费用）。 */
  BASE_FEE: 100,
  /** 能力参考值（effective attribute 均值的中性点；比值 = avg / ABILITY_REFERENCE）。 */
  ABILITY_REFERENCE: 50,
  /** AbilityFactor 下限（避免极低能力导致费趋近 0 或负）。 */
  ABILITY_MIN: 0.2,
  /** 年龄缺省值（无 birthDate 时回退；视为巅峰）。 */
  AGE_REFERENCE: 26,
  /** 年龄系数分档（升序 maxAge；取第一个 `age <= maxAge` 的 factor）。 */
  AGE_FACTORS: Object.freeze([
    Object.freeze({ maxAge: 20, factor: 1.15 }), // 年轻溢价
    Object.freeze({ maxAge: 27, factor: 1.0 }),  // 巅峰
    Object.freeze({ maxAge: 30, factor: 0.85 }),
    Object.freeze({ maxAge: 33, factor: 0.65 }),
    Object.freeze({ maxAge: Infinity, factor: 0.45 }), // 高龄贬值
  ]),
  /** 位置系数（仅轻微差异，避免极端位置通胀）。 */
  POSITION_FACTOR: Object.freeze({ GK: 0.95, DF: 1.0, MF: 1.05, FW: 1.1 }),
  /** 转会费上下限（T3）。 */
  MIN_TRANSFER_FEE: 0,
  MAX_TRANSFER_FEE: 10000,
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
