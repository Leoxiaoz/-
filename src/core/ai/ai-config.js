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
  ]),

  /**
   * 最小 Club Policy（≤3 档；由 clubId 派生，不持久化；D-AI-20）。
   * 仅影响少量参数（potential 权重、预算储备比例、是否启用 Soft Need），非人格系统。
   */
  POLICIES: Object.freeze([
    Object.freeze({ id: 'Balanced', potentialWeight: 0.35, reserveRatio: 0.25, softNeedEnabled: true }),
    Object.freeze({ id: 'YouthFocus', potentialWeight: 0.55, reserveRatio: 0.25, softNeedEnabled: true }),
    Object.freeze({ id: 'Conservative', potentialWeight: 0.35, reserveRatio: 0.40, softNeedEnabled: false }),
  ]),
});
