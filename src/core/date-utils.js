/**
 * 日期工具（Simulation Core）。
 * 统一使用 UTC，避免时区漂移导致的可复现性问题（项目规则第 10 条）。
 * 独立成模块，供 schedule / match / simulation 复用，避免模块循环依赖。
 */

import { SimulationError } from '../shared/errors.js';

/**
 * ISO 日期（YYYY-MM-DD）加天数。
 * @param {string} isoDate
 * @param {number} days
 * @returns {string}
 */
export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) {
    throw new SimulationError('日期格式需为 YYYY-MM-DD', { context: { isoDate } });
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * 比较两个 ISO 日期（仅按 YYYY-MM-DD 字典序即可，格式固定）。
 * @returns {number} a<b 返回 -1，相等 0，a>b 返回 1
 */
export function compareDates(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * 计算某人在给定日期时的**周岁**年龄（UTC，确定性）。
 * 年龄不入存档，始终由静态 birthDate 与运行时 currentDate 派生，避免漂移（第 16 步）。
 * @param {string} birthDate YYYY-MM-DD
 * @param {string} onDate YYYY-MM-DD
 * @returns {number} 周岁（未满生日则减 1）
 */
export function ageOn(birthDate, onDate) {
  const [by, bm, bd] = String(birthDate).split('-').map(Number);
  const [oy, om, od] = String(onDate).split('-').map(Number);
  if (!by || !bm || !bd || !oy || !om || !od) {
    throw new SimulationError('年龄计算需要合法日期（YYYY-MM-DD）', {
      context: { birthDate, onDate },
    });
  }
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return age;
}