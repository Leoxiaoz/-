/**
 * Development Phase（D39 Phase 1 / Step 39F-A）。
 * 层级归属：Simulation Core / AI（纯派生）。**不依赖 DOM / 存储 / UI**，纯函数、无 RNG。
 *
 * 规范来源：D39-D（Step 39C 冻结）/ D39E-R（Step 39E-R 冻结）。
 * 语义：`Development Phase` 是**语义层**，只描述球员处于发展的哪一阶段；
 * - **不修改** Player Ability / Potential / Growth；
 * - **不写入** Player Runtime / Save；
 * - **不得**作为固定 Growth Multiplier。
 */

/** 稳定枚举。 */
export const DEVELOPMENT_PHASES = Object.freeze({
  EMERGING: 'EMERGING',
  DEVELOPING: 'DEVELOPING',
  ESTABLISHING: 'ESTABLISHING',
  PRIME: 'PRIME',
  VETERAN: 'VETERAN',
});

/**
 * Phase → AI Decision Score（D39E-R §八.3 冻结）。
 * 仅为 AI Decision Signal，**不是** Growth Multiplier。
 */
export const DEVELOPMENT_PHASE_SCORE = Object.freeze({
  EMERGING: 100,
  DEVELOPING: 85,
  ESTABLISHING: 65,
  PRIME: 35,
  VETERAN: 10,
});

/**
 * 由年龄派生 Development Phase（确定性、纯函数）。
 * 边界（冻结）：`≤17 EMERGING / 18–21 DEVELOPING / 22–25 ESTABLISHING / 26–30 PRIME / ≥31 VETERAN`。
 * 非法 / 非有限年龄按最保守的 `VETERAN` 处理（不抛错，保持派生层纯粹）。
 * @param {number} age
 * @returns {'EMERGING'|'DEVELOPING'|'ESTABLISHING'|'PRIME'|'VETERAN'}
 */
export function getDevelopmentPhase(age) {
  const a = Number(age);
  if (!Number.isFinite(a)) return DEVELOPMENT_PHASES.VETERAN;
  if (a <= 17) return DEVELOPMENT_PHASES.EMERGING;
  if (a <= 21) return DEVELOPMENT_PHASES.DEVELOPING;
  if (a <= 25) return DEVELOPMENT_PHASES.ESTABLISHING;
  if (a <= 30) return DEVELOPMENT_PHASES.PRIME;
  return DEVELOPMENT_PHASES.VETERAN;
}
