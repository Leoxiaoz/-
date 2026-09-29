/**
 * 赛程生成（Simulation Core）。
 * 层级归属：Simulation Core，纯逻辑，不依赖 DOM / 存储。
 *
 * 规则来源：DECISIONS D-01（赛程属运行时，由规则生成）、D-10（偶数队双循环）。
 * 算法：轮转法（circle method）生成单循环，再镜像为双循环（主客互换）。
 * 奇数队自动插入轮空（bye）。
 */

import { SimulationError } from '../shared/errors.js';
import { addDays } from './date-utils.js';

/**
 * 生成双循环赛程。
 * @param {string[]} teamIds 参赛队 ID（顺序决定赛程，须先做确定性排序由调用方保证）
 * @param {{startDate: string, intervalDays: number}} config
 * @returns {Array<{round: number, date: string, matches: Array<{homeId: string, awayId: string}>}>}
 */
export function generateDoubleRoundRobin(teamIds, config) {
  if (!Array.isArray(teamIds) || teamIds.length < 2) {
    throw new SimulationError('生成赛程至少需要 2 支球队', {
      context: { teams: Array.isArray(teamIds) ? teamIds.length : typeof teamIds },
    });
  }
  const { startDate, intervalDays } = config ?? {};
  if (typeof startDate !== 'string' || !Number.isInteger(intervalDays) || intervalDays <= 0) {
    throw new SimulationError('生成赛程需要 startDate 与非正的 intervalDays', {
      context: { startDate, intervalDays },
    });
  }

  const needsBye = teamIds.length % 2 === 1;
  const n = needsBye ? teamIds.length + 1 : teamIds.length;
  const slots = needsBye ? [...teamIds, null] : [...teamIds];

  const firstHalf = [];
  const fixed = slots[0];
  let rot = slots.slice(1);

  for (let r = 0; r < n - 1; r += 1) {
    const lineup = [fixed, ...rot];
    const matches = [];
    for (let i = 0; i < n / 2; i += 1) {
      const a = lineup[i];
      const b = lineup[n - 1 - i];
      if (a === null || b === null) continue; // 轮空
      // 交替主客，避免同一队总在主场
      const aAtHome = (r + i) % 2 === 0;
      matches.push(aAtHome ? { homeId: a, awayId: b } : { homeId: b, awayId: a });
    }
    firstHalf.push(matches);
    rot = [rot[rot.length - 1], ...rot.slice(0, rot.length - 1)];
  }

  const secondHalf = firstHalf.map((matches) =>
    matches.map((m) => ({ homeId: m.awayId, awayId: m.homeId })),
  );

  return [...firstHalf, ...secondHalf].map((matches, idx) => ({
    round: idx + 1,
    date: addDays(startDate, idx * intervalDays),
    matches,
  }));
}