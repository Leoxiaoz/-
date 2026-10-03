/**
 * PASS State Update（Step 39F-M-B-RESOLUTION-PASS）。
 * 层级归属：Simulation Core / Match Resolution。**纯函数**（返回新状态，不原地 mutate 输入）。
 *
 * 职责：
 *  - `applyPassStateUpdate(matchCore, result)`：根据 PassResolutionResult 把球置为 IN_TRANSIT。
 *  - `advancePassTransit(matchCore, deltaTime)`：推进飞行进度；完成时结算球权（CONTROLLED / FREE）。
 *
 * 红线：只影响 BallState（及必要的最小球权字段）；**不写 stats / Growth / Training / Development /
 * Save / Match Result**；不产生 Event；不调用 Decision。
 */

import { clamp01 } from './player-situation.js';
import { PASS_OUTCOMES, BALL_TRANSIT_STATE as TS } from './pass-resolution-config.js';

/** 深拷贝 ball（避免与输入共享引用）。 */
function cloneBall(ball) {
  return {
    ...ball,
    position: { ...(ball?.position ?? { x: 0, y: 0 }) },
    transit: ball?.transit ? { ...ball.transit, from: { ...ball.transit.from }, to: { ...ball.transit.to } } : (ball?.transit ?? undefined),
  };
}

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

/** 完成飞行时的球权结算。 */
function finalize(ball, transit, players) {
  const teamOf = (id) => players.find((p) => p.playerId === id)?.teamId ?? null;
  const to = { ...transit.to };
  switch (transit.outcome) {
    case PASS_OUTCOMES.COMPLETED:
      return { ...ball, position: to, state: TS.CONTROLLED, control: transit.intendedTargetId, possessingTeamId: transit.targetTeamId, transit: undefined };
    case PASS_OUTCOMES.INTERCEPTED:
      if (transit.interceptorId) {
        return { ...ball, position: to, state: TS.CONTROLLED, control: transit.interceptorId, possessingTeamId: teamOf(transit.interceptorId), transit: undefined };
      }
      return { ...ball, position: to, state: TS.FREE, control: null, possessingTeamId: null, transit: undefined };
    case PASS_OUTCOMES.BLOCKED:
      if (transit.blockerId) {
        return { ...ball, position: to, state: TS.CONTROLLED, control: transit.blockerId, possessingTeamId: teamOf(transit.blockerId), transit: undefined };
      }
      return { ...ball, position: to, state: TS.FREE, control: null, possessingTeamId: null, transit: undefined };
    case PASS_OUTCOMES.INACCURATE:
    default:
      return { ...ball, position: to, state: TS.FREE, control: null, possessingTeamId: null, transit: undefined };
  }
}

/**
 * 推进 PASS 飞行（simulation time；纯函数）。
 * @param {object} matchCore
 * @param {number} deltaTime 推进的模拟时间（>=0；非有限值视为 0）
 * @returns {object} 新的 matchCore
 */
export function advancePassTransit(matchCore, deltaTime) {
  const ball = matchCore?.ball;
  const transit = ball?.transit;
  if (!ball || !transit) return matchCore;
  const dt = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0;
  const elapsed = (Number(transit.elapsed) || 0) + dt;
  const duration = Math.max(1e-6, Number(transit.duration) || 0);
  const progress = clamp01(elapsed / duration);
  const players = Array.isArray(matchCore.players) ? matchCore.players : [];
  if (progress >= 1) {
    const nextBall = finalize(cloneBall(ball), transit, players);
    return { ...matchCore, ball: nextBall };
  }
  const nextTransit = { ...transit, from: { ...transit.from }, to: { ...transit.to }, elapsed, progress };
  return { ...matchCore, ball: { ...ball, position: { ...ball.position }, transit: nextTransit } };
}

/** 便捷：一次性算完整个飞行（用于测试 / 快模）。 */
export function completePassTransit(matchCore) {
  const t = matchCore?.ball?.transit;
  if (!t) return matchCore;
  return advancePassTransit(matchCore, Math.max(1e-6, Number(t.duration) || 0));
}
