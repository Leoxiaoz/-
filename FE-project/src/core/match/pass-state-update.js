/**
 * PASS State Update（Step 39F-M-B-RESOLUTION-PASS）。
 * 层级归属：Simulation Core / Match Resolution。**纯函数**（返回新状态，不原地 mutate 输入）。
 *
 * 职责：
 *  - `applyPassStateUpdate(matchCore, result)`：根据 PassResolutionResult 把球置为 IN_TRANSIT。
 *  - `advancePassTransit(matchCore, deltaTime)`：推进飞行（委托 C-39 Continuous Movement Integration）。
 *  - `completePassTransit(matchCore)`：一次性算完整个飞行（测试 / 快模）。
 *
 * 边界（C-39 起）：
 *  - Passive Transit 推进委托给 C-39 `advanceContinuousBallMovement`：中间 Tick 由 C-03 Physics 推进 Position，
 *    完成 Tick 由 C-23 Completion Boundary 写 `transit.to`。**Finalize 不再写 Position**（只做 State / Control / Possession / Transit 清理）。
 *
 * 红线：只影响 BallState（及必要的最小球权字段）；**不写 stats / Growth / Training / Development /
 * Save / Match Result**；不产生 Event；不调用 Decision。
 */

import { BALL_TRANSIT_STATE as TS } from './pass-resolution-config.js';
import { advanceContinuousBallMovement } from './continuous-ball-movement-integration.js';

/** 构造“球在飞行中”的 BallState（清除控制者，满足 invariant）。 */
function transitBall(result) {
  return {
    position: { ...result.transit.from },
    control: null,
    possessingTeamId: null,
    state: TS.IN_TRANSIT,
    transit: {
      ...result.transit,
      from: { ...result.transit.from },
      to: { ...result.transit.to },
    },
  };
}

/**
 * 根据 PassResolutionResult 更新 MatchCore：球进入 IN_TRANSIT。
 * @returns {object} 新的 matchCore（浅拷贝 + 新 ball）
 */
export function applyPassStateUpdate(matchCore, result) {
  if (!matchCore || !result || !result.ok || !result.transit) return matchCore;
  return { ...matchCore, ball: transitBall(result) };
}

/**
 * 推进 PASS 飞行（simulation time；纯函数）。
 * **委托 C-39**：中间 Tick → C-03 Physics；完成 Tick → C-23 Completion Boundary + Finalize（不写 Position）。
 * @param {object} matchCore
 * @param {number} deltaTime 推进的模拟时间（>=0；非有限值视为 0）
 * @param {object} [options] { players?, config? }
 * @returns {object} 新的 matchCore（失败时返回原 matchCore，不产生部分更新）
 */
export function advancePassTransit(matchCore, deltaTime, options = {}) {
  const res = advanceContinuousBallMovement(matchCore, deltaTime, options);
  return res.ok ? res.matchCore : matchCore;
}

/** 便捷：一次性算完整个飞行（用于测试 / 快模）。 */
export function completePassTransit(matchCore) {
  const t = matchCore?.ball?.transit;
  if (!t) return matchCore;
  return advancePassTransit(matchCore, Math.max(1e-6, Number(t.duration) || 0));
}