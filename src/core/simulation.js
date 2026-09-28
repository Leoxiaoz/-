/**
 * Simulation Core（模拟核心门面）。
 * 层级归属：Simulation Core 层。纯逻辑，**不依赖 DOM / 存储 / UI**。
 *
 * 本阶段范围（第 13 步）：只提供「时间推进」这一最小真实行为。
 * 明确不实现：比赛模拟、训练、成长、转会、财政、AI、新闻等（未来阶段）。
 *
 * 预留接口说明：未来比赛模拟将按 SIMULATION_SPEC §1 拆为多个可独立替换的阶段，
 * 由本类编排；比赛抽象层级（SIMULATION_SPEC S1/T6）**尚未决定**，故此处不作任何假设。
 */

import { SimulationError } from '../shared/errors.js';

export class SimulationCore {
  /** @param {{logger?: object}} [deps] */
  constructor(deps = {}) {
    this.logger = deps.logger ?? null;
  }

  /**
   * 推进一个模拟日。
   * 注意：时间推进粒度（按天/周/比赛日）见 GAME_DESIGN T1，**尚未决定**；
   * 当前以「天」为单位仅为骨架实现，不代表最终粒度。
   * @param {object} state 运行时状态
   * @returns {object} 同一个 state（原地更新）
   */
  advanceDay(state) {
    if (!state || typeof state.currentDate !== 'string') {
      throw new SimulationError('advanceDay 需要包含 currentDate 的运行时状态', {
        context: { received: typeof state },
      });
    }
    state.currentDate = addDays(state.currentDate, 1);
    // TODO(未来阶段)：在此编排比赛日 / 训练 / 成长 / AI 决策等阶段；本阶段不实现。
    return state;
  }

  /** 推进多个模拟日。 */
  advanceDays(state, days) {
    if (!Number.isInteger(days) || days < 0) {
      throw new SimulationError('advanceDays 需要非负整数天数', { context: { days } });
    }
    for (let i = 0; i < days; i += 1) this.advanceDay(state);
    return state;
  }
}

/**
 * ISO 日期（YYYY-MM-DD）加天数。使用 UTC，避免时区漂移导致的可复现性问题。
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