/**
 * AI Club Decision Framework v1 —— 配置常量（集中存放，禁止散落魔法数字）。
 * 层级归属：Simulation Core / AI（纯数据，无副作用）。
 *
 * 规范来源：DECISIONS **D-28**（Step 30 设计冻结 D-AI-01 ~ D-AI-25）。
 * 语义约束：
 * - v1 **不使用 RNG**（D-AI-16）；本配置仅提供确定性阈值与权重。
 * - 不引入 OVR（D-AI-25）；仅提供 attribute profile（按位置取属性子集）。
 * - 不新增 player / club / runtime 字段；Policy 由 clubId 派生（D-AI-20）。
 *
 * 说明：`RESERVE_ABS` 基于现有财政尺度（`FINANCE_CONFIG.INITIAL_TRANSFER_BUDGET = 600`）取保守值，
 * 不扩大费用尺度。
 */

export const AI_CONFIG = Object.freeze({
  /** 转会预算安全储备比例（D-AI-11：方案 B「保留安全储备」）。 */
  RESERVE_RATIO: 0.25,
  /** 转会预算安全储备绝对下限（与 cash / transferBudget 同尺度，保守）。 */
  RESERVE_ABS: 150,

  /** 每俱乐部每赛季买入上限（含 Free Agent 签约；D-AI-11）。 */
  MAX_SIGNINGS_PER_SEASON: 2,
  /** 每俱乐部每赛季卖出 + 释放上限（D-AI-11 / D-AI-14）。 */
  MAX_EXITS_PER_SEASON: 2,

  /** Free Agent 最低可接受 suitability（低于此值不签；D-AI-12）。 */
  FREE_AGENT_MIN_SUITABILITY: 0.42,
  /** Soft Need「能力缺口」判定：位置 profile 平均属性低于此值。 */
  SOFT_NEED_ATTRIBUTE_FLOOR: 58,
  /** 释放冗余球员的 suitability 上限（低于此值视为无买家价值；D-AI-14）。 */
  SURPLUS_SUITABILITY_FLOOR: 0.45,
  /** 释放冗余球员的高龄阈值（>= 此年龄视为无未来价值；D-AI-14）。 */
  SURPLUS_AGE: 33,
  /** 单次目标排序参与计算的最大候选数（性能护栏，仅截断不影响确定性）。 */
  MAX_CANDIDATES: 8,

  /**
   * AI Holding Target（Step 34 / D-33.5、D-34：HOLDING_TARGET = 14）。
   * **仅 AI Decision Layer 使用**：`roster > HOLDING_TARGET` 才允许评估 surplus（RELEASE / SELL）；
   * `roster <= 14` 时 AI 不主动制造 surplus exit。**不改 Domain**（Domain 仍用 12/24）。
   */
  HOLDING_TARGET: 14,

  /** Competitive Need 判定（Step 34 / D-33.3、D-34.3）：位置主力质量相对联赛基线的允许差距。 */
  COMPETITIVE_UPGRADE_MARGIN: 5,
  /** Competitive Need 绝对下限：位置主力评分低于此值即视为竞技质量明显不足。 */
  COMPETITIVE_ABSOLUTE_FLOOR: 52,
  /** Competitive Need：首发-替补质量断层阈值。 */
  COMPETITIVE_BENCH_GAP: 12,

  /** AI 主动出售（D-33.4 / D-34）最小可接受 fee：低于此值不值得占用 exit cap（保留 0 = 不设限）。 */
  SELL_MIN_FEE: 0,

  /** 年龄分档（仅消费 age；不复制成长曲线；D-AI-10）。 */
  AGE_BANDS: Object.freeze([
    Object.freeze({ name: 'U21', min: 0, max: 20 }),
    Object.freeze({ name: '21-24', min: 21, max: 24 }),
    Object.freeze({ name: '25-28', min: 25, max: 28 }),
    Object.freeze({ name: '29-32', min: 29, max: 32 }),
    Object.freeze({ name: '33+', min: 33, max: Infinity }),
  ]),

  /** 位置属性画像（D-AI-08：按位置使用属性子集，非 OVR）。 */
  ATTRIBUTE_PROFILES: Object.freeze({
    GK: Object.freeze(['goalkeeping']),
    DF: Object.freeze(['defending', 'pace']),
    MF: Object.freeze(['passing', 'technique']),
    FW: Object.freeze(['finishing', 'pace', 'technique']),
  }),

  /** 队内角色权重（current = 当前能力，potential = 发展潜力；D-AI-08/09）。 */
  ROLE_WEIGHTS: Object.freeze({
    Starter: Object.freeze({ current: 0.8, potential: 0.2 }),
    Rotation: Object.freeze({ current: 0.6, potential: 0.4 }),
    Backup: Object.freeze({ current: 0.35, potential: 0.65 }),
    Development: Object.freeze({ current: 0.25, potential: 0.75 }),
  }),
  /** 各角色偏好的年龄档位（`AGE_BANDS` 下标；仅作 suitability modifier；D-AI-10）。 */
  ROLE_PREFERRED_AGE_BAND: Object.freeze({ Starter: 2, Rotation: 1, Backup: 1, Development: 0 }),

  /** suitability 中 potential 权重的基准（用于 Club Policy 缩放）。 */
  POTENTIAL_WEIGHT_BASE: 0.35,

  /** reasonCode 白名单（D-AI-19；不得使用白名单之外的 code）。 */
  REASON_CODES: Object.freeze([
    'POSITION_DEPTH',
    'INJURY_COVER',
    'ATTRIBUTE_GAP',
    'YOUTH_DEVELOPMENT',
    'SQUAD_BALANCE',
    'FINANCE_LIMIT',
    'SURPLUS_SQUAD',
    'FREE_AGENT_VALUE',
    'COMPETITIVE_UPGRADE', // Step 34 / D-33.3：Competitive Need 专属
  ]),

  /**
   * 最小 Club Policy（≤3 档；由 clubId 派生，不持久化；D-AI-20、D-33.9）。
   * 参数：potentialWeight / reserveRatio / softNeedEnabled + demandBias / buyBias / sellBias（Step 34）。
   * 数值为最小、可解释的配置；全部 derived / deterministic / non-persistent，仅改阈值与权重，不绕过 Domain invariant。
   */
  POLICIES: Object.freeze([
    Object.freeze({ id: 'Balanced', potentialWeight: 0.35, reserveRatio: 0.25, softNeedEnabled: true, demandBias: 1.0, buyBias: 1.0, sellBias: 1.0 }),
    Object.freeze({ id: 'YouthFocus', potentialWeight: 0.55, reserveRatio: 0.25, softNeedEnabled: true, demandBias: 1.1, buyBias: 1.0, sellBias: 0.9 }),
    Object.freeze({ id: 'Conservative', potentialWeight: 0.35, reserveRatio: 0.40, softNeedEnabled: false, demandBias: 0.8, buyBias: 0.8, sellBias: 1.1 }),
  ]),
});

/**
 * AI Match Selection — Development-aware Soft Priority（Step 39F-G 实现；D-42 / OD-39FG-DECISION-2）。
 * 层级归属：Simulation Core / AI（纯配置，无副作用）。
 *
 * 语义：AI 俱乐部在 `selectMatchSquad` 中，对**同一 position line 内**的候选人应用
 *   B2 = Marginal Starter Cutoff（benchmark） + C2 = Bounded Effective Competitive Score（comparator）：
 *     competitiveGap      = marginalStarterCutoff − rating（≤0 视为 0）
 *     proximity           = max(0, 1 − gap / DISTANCE_SCALE)         ∈ [0,1]
 *     priority            = selectionDevelopmentPriority(...)         ∈ [0,1]
 *     boundedInfluence    = clamp(priority × proximity × CAP, 0, CAP)
 *     effectiveScore      = rating + boundedInfluence
 *
 * 红线：
 * - 仅影响 **AI club** 的 `selectMatchSquad`；**不得**影响 managed club / `repairSquadForMatch`。
 * - 不读 True Potential；不修改 Growth / Schema / Save；无 RNG。
 * - CAP 直接界定“最多可翻转的 rating gap”上限（cap=2 ⇒ 无法推翻 >2 点差距）。
 *
 * ⚠ 以下数值为 **temporary implementation / calibration defaults**，**不是冻结设计参数**；
 *   最终取值仍为 [TBD]。集中于此，禁止散落 magic number。
 */
export const AI_SELECTION_DEVELOPMENT_CONFIG = Object.freeze({
  /** 是否启用 development-aware selection。 */
  ENABLED: true,
  /** Development influence 上限（rating 尺度）。temporary calibration default; NOT frozen. */
  CAP: 2,
  /** proximity = max(0, 1 − gap/distanceScale)。temporary calibration default; NOT frozen. */
  DISTANCE_SCALE: 6,
  /** Phase 门控（越年轻发展权重越高）。temporary calibration default; NOT frozen. */
  PHASE_GATE: Object.freeze({
    EMERGING: 1.0,
    DEVELOPING: 0.8,
    ESTABLISHING: 0.5,
    PRIME: 0.25,
    VETERAN: 0.1,
  }),
  /** Personality modifier（professionalism/determination/ambition 归一后映射）。
   *  `mod = FLOOR + RANGE × persNorm`。temporary calibration default; NOT frozen. */
  PERSONALITY_FLOOR: 0.8,
  PERSONALITY_RANGE: 0.2,

  // ---- Step 39F-H：Rotation / Actual Match Minutes（temporary calibration defaults; NOT frozen）----
  /** 是否启用 AI Club 的 minute allocation（Managed Club 永不启用）。 */
  ROTATION_ENABLED: true,
  /** 主力最低分钟保护：rotation 不得把主力压到该值以下。 */
  STARTER_MIN_MINUTES: 45,
  /** 轮换强度(strength=priority×proximity) → 离散分钟模板（降序匹配第一个 strength ≥ min）。 */
  ROTATION_TEMPLATES: Object.freeze([
    Object.freeze({ min: 0.50, minutes: 45 }),
    Object.freeze({ min: 0.35, minutes: 30 }),
    Object.freeze({ min: 0.20, minutes: 20 }),
    Object.freeze({ min: 0.10, minutes: 15 }),
  ]),
});

/**
 * AI Training Decision —— Step 39F-J（D-39FJ 冻结设计；实现）。
 * 层级归属：Simulation Core / AI（纯配置，无副作用）。
 *
 * 语义：AI 在赛季边界为**每名 AI club 球员**决定训练投入强度
 *   `LIMITED / NORMAL / STRONG`，作为既有 `developPlayers(training)` 的 training input 来源。
 * - 只决定「投入多少」；不决定成长数值 / 属性 / 选择 / 分钟 / 转会。
 * - 不改 Growth 公式；无 RNG（deterministic）；不持久化。
 *
 * ⚠ 以下数值为 **TEMPORARY / 39F-J calibration defaults**，**不是冻结设计参数**；集中于此，禁止散落。
 */
export const AI_TRAINING_DECISION_CONFIG = Object.freeze({
  /** 训练档位（与 `PLAYER_GROWTH_CONFIG.TRAINING_LEVELS` 的键一致）。 */
  LEVELS: Object.freeze({ LIMITED: 'LIMITED', NORMAL: 'NORMAL', STRONG: 'STRONG' }),
  /**
   * 赛季负荷率分档阈值（供 `classifySeasonLoad` 使用）。
   * `load < LOW_MAX` → LOW；`< NORMAL_MAX` → NORMAL；`< HIGH_MAX` → HIGH；否则 VERY_HIGH。
   *
   * Step 39F-J-C：**已不再被 Training Decision 消费**（Absolute Match Load Gate 移除）。
   * 保留为 Match Participation / Playing Exposure 的 derived classification（legacy），
   * 供未来 Participation / Workload 相关步骤复用；无持久化、无 RNG。
   */
  LOAD: Object.freeze({ LOW_MAX: 0.30, NORMAL_MAX: 0.60, HIGH_MAX: 0.80 }),
  /** STRONG 所需 estimatedHeadroom（0–1）下限，低于视为低 headroom（TEMPORARY）。 */
  HEADROOM_STRONG_MIN: 0.02,
  /** environmentInput 下限，低于视为差环境并关闭 STRONG（TEMPORARY）。 */
  ENVIRONMENT_STRONG_MIN: 0.30,
  /** personality 归一化均值下限，低于视为明显负向并关闭 STRONG（TEMPORARY）。 */
  PERSONALITY_STRONG_MIN: 0.20,
  /** STRONG 综合分权重（bounded signal；TEMPORARY）。 */
  STRONG_WEIGHTS: Object.freeze({ HEADROOM: 0.40, ENVIRONMENT: 0.30, PERSONALITY: 0.30 }),
  /** STRONG 综合分阈值（TEMPORARY）。 */
  STRONG_SCORE_MIN: 0.35,
});

/**
 * Relative Role Load —— Step 39F-J-B（D-39FJ-B CAL-FREEZE；**参数 FROZEN**）。
 * 层级归属：Simulation Core / AI（纯配置，无副作用）。
 *
 * 语义：在 Training Decision 之上叠加**保护性**角色超额检测：
 *   Expected Participation（season-boundary，由阵容结构派生） vs Actual Participation（完赛赛季分钟）。
 *   仅当 `EXTREME` 且 base Training Level = NORMAL 时，`NORMAL → LIMITED`。
 * - R5 range-excess（R4 normalized-excess 已否决：高 expected 饱和）。
 * - 不读取 actual minutes 反推 expected；不读取 selectionDevelopmentPriority；无 RNG；不持久化。
 */
export const AI_RELATIVE_ROLE_LOAD_CONFIG = Object.freeze({
  /** 各 role 的 Expected Participation 区间（center ± tolerance；FROZEN）。 */
  ROLES: Object.freeze({
    STARTER: Object.freeze({ center: 0.85, tolerance: 0.10 }),
    ROTATION: Object.freeze({ center: 0.45, tolerance: 0.10 }),
    BENCH: Object.freeze({ center: 0.20, tolerance: 0.10 }),
    GK1: Object.freeze({ center: 0.90, tolerance: 0.10 }),
    GK2: Object.freeze({ center: 0.20, tolerance: 0.10 }),
    GK3: Object.freeze({ center: 0.10, tolerance: 0.10 }),
  }),
  /** excessive 上限：`0 < excess ≤ BAND` → EXCESSIVE；`> BAND` → EXTREME（FROZEN）。 */
  EXCESSIVE_BAND: 0.15,
  /** Rotation 名额上限（FROZEN）。 */
  K_CAP: 3,
  /** 分类枚举。 */
  CLASSIFICATION: Object.freeze({
    NORMAL: 'NORMAL',
    EXCESSIVE: 'EXCESSIVE',
    EXTREME: 'EXTREME',
    NO_RELATIVE_LOAD: 'NO_RELATIVE_LOAD',
  }),
});
