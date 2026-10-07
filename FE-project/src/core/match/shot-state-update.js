/**
 * SHOT State Update（Step 39F-M-B-RESOLUTION-SHOT）。
 * 层级归属：Simulation Core / Match Resolution。**纯函数**（返回新状态，不原地 mutate 输入）。
 *
 * 职责：`applyShotStateUpdate`（球进入 IN_TRANSIT）、`advanceShotTransit` / `completeShotTransit`（结算球权）。
 *
 * 边界（C-39 起）：
 *  - Transit 推进委托给 C-39 `advanceContinuousBallMovement`：中间 Tick 由 C-03 Physics 推进 Position，
 *    完成 Tick 由 C-23 Completion Boundary 写 `transit.to`。**Finalize 不再写 Position**（只做 State / Control / Possession / Transit 清理）。
 *
 * 红线：只影响 BallState；**不改 Score / Standings / Stats / Growth / Save / Match Result**；不产生 Event。
 */

import { advanceContinuousBallMovement } from './continuous-ball-movement-integration.js';

/**
 * C-62：Transit Start 不得自动 Clear LastTouch——保留射门者作为最近一次实际触球者。
 */
function transitBall(result, lastTouchPlayerId) {
  return {
    position: { ...result.transit.from },
    control: null,
    possessingTeamId: null,
    state: 'IN_TRANSIT',
    lastTouchPlayerId: lastTouchPlayerId ?? null,
    transit: {
      ...result.transit,
      from: { ...result.transit.from },
      to: { ...result.transit.to },
      target: { ...result.transit.target },
    },
  };
}

/**
 * 根据 ShotResolutionResult 更新 MatchCore：球进入 IN_TRANSIT。
 * @returns {object} 新的 matchCore
 */
export function applyShotStateUpdate(matchCore, result) {
  if (!matchCore || !result || !result.ok || !result.transit) return matchCore;
  return { ...matchCore, ball: transitBall(result, matchCore?.ball?.lastTouchPlayerId ?? null) };
}

/**
 * 推进 SHOT 飞行（simulation time；纯函数）。
 * **委托 C-39**：中间 Tick → C-03 Physics；完成 Tick → C-23 Completion Boundary + Finalize（不写 Position）。
 * @returns {object} 新的 matchCore（失败时返回原 matchCore，不产生部分更新）
 */
export function advanceShotTransit(matchCore, deltaTime, options = {}) {
  const res = advanceContinuousBallMovement(matchCore, deltaTime, options);
  return res.ok ? res.matchCore : matchCore;
}

/** 便捷：一次性算完整个飞行（测试 / 快模）。 */
export function completeShotTransit(matchCore) {
  const t = matchCore?.ball?.transit;
  if (!t) return matchCore;
  return advanceShotTransit(matchCore, Math.max(1e-6, Number(t.duration) || 0));
}