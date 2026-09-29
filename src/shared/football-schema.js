/**
 * 足球领域数据模式常量（共享层）。
 * 被 Data Layer（数据库校验）与 Simulation Core（模拟读取）共同引用，
 * 避免两侧各自硬编码导致漂移。
 *
 * 状态：MVP 暂定最小集（DECISIONS D-11 / DATABASE_SPEC D2 / SIMULATION_SPEC S3）；
 * 扩展时须同步 DATABASE_SPEC 并带存档迁移。
 */

/** 位置枚举（MVP 粗粒度）。 */
export const POSITIONS = Object.freeze(['GK', 'DF', 'MF', 'FW']);

/** 球员属性集（MVP）。 */
export const PLAYER_ATTRIBUTES = Object.freeze([
  'pace',
  'technique',
  'passing',
  'defending',
  'finishing',
  'goalkeeping',
]);

/** 属性取值范围。 */
export const ATTRIBUTE_RANGE = Object.freeze({ MIN: 1, MAX: 99 });

/** 属性缺省值：数据库未提供该属性时使用的中立值。 */
export const ATTRIBUTE_DEFAULT = 50;

/** 攻守倾向枚举。 */
export const MENTALITIES = Object.freeze(['defensive', 'balanced', 'attacking']);

/**
 * 球员人格维度（静态，初始值；DECISIONS D-14 / 第 16 步 B4）。
 * 作用：professionalism/determination/ambition 影响成长与衰退；consistency 影响波动；
 * injuryProneness 供未来伤病系统使用（本期仅存储）。
 */
export const PLAYER_PERSONALITY_KEYS = Object.freeze([
  'professionalism',
  'determination',
  'ambition',
  'consistency',
  'injuryProneness',
]);

/** 人格取值量程（与属性同量程 1–99）。 */
export const PERSONALITY_RANGE = Object.freeze({ MIN: 1, MAX: 99 });

/** 出生日期合法年份区间（用于加载校验；仅为合理性护栏，不含真实数据）。 */
export const BIRTH_YEAR_RANGE = Object.freeze({ MIN: 1900, MAX: 2100 });