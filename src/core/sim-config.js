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

/** 积分规则。 */
export const TABLE_CONFIG = Object.freeze({
  WIN: 3,
  DRAW: 1,
  LOSS: 0,
});