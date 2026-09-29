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