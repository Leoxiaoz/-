/**
 * Interaction State Update（Step 39F-M-C-05）。
 * 层级归属：Simulation Core / Match Resolution。**纯函数**（返回新状态，不原地 mutate 输入）。
 *
 * 职责：消费 `InteractionResolutionResult`，把结果写回 **唯一 authoritative Ball Truth**
 * （`MatchCore.ball`）。Resolution 只描述结果；**只有本模块负责 authoritative state mutation**。
 *
 * 红线：只影响 BallState；**不修改 Score / Standings / Stats / Growth / Training /
 * Development / Save / Match Result**；不产生 Event；不调用 Decision；无 Math.random。
 *
 * Deferred：bounce / spin / lofted / GK Interaction 的球物理属未来阶段；本模块只做
 * 控制关系与基本位置的确定性落地（速度置零）。
 */

import { INTERACTION_BALL_STATE as BS } from './interaction-resolution-config.js';

/** 深拷贝 ball（避免与输入共享引用）。 */
function cloneBall(ball) {
  return {
    ...ball,
    position: { ...(ball?.position ?? { x: 0.5, y: 0.5 }) },
    transit: ball?.transit
      ? { ...ball.transit, from: { ...ball.transit.from }, to: { ...ball.transit.to } }
      : ball?.transit,
  };
}

/**
 * 根据 InteractionResolutionResult 更新 MatchCore.ball。
 *
 * 语义映射：
 * - `ball.state === CONTROLLED`：control = possession.toPlayerId；possessingTeamId = possession.toTeamId。
 * - `ball.state === FREE`：control / possessingTeamId 清空（loose ball）。
 * - `ball.state === IN_TRANSIT`（未拦截）：保持当前 transit，不改动权威球状态。
 *
 * @param {object} matchCore
 * @param {object} result InteractionResolutionResult
 * @returns {object} 新的 matchCore（浅拷贝 + 新 ball）
 */
export function applyInteractionStateUpdate(matchCore, result) {
  if (!matchCore || !result || !result.ok || !result.ball || !result.ball.state) return matchCore;
  const current = matchCore.ball ?? {};
  const position = { x: Number(result.ball.position?.x) || 0, y: Number(result.ball.position?.y) || 0 };

  if (result.ball.state === BS.IN_TRANSIT) {
    // 未拦截：球仍在飞行，权威状态不变（保留 transit 与速度）。
    return { ...matchCore, ball: cloneBall(current) };
  }

  const controlled = result.ball.state === BS.CONTROLLED;
  const nextBall = {
    ...cloneBall(current),
    position,
    velocity: { x: 0, y: 0 },
    state: result.ball.state,
    control: controlled ? (result.possession?.toPlayerId ?? null) : null,
    possessingTeamId: controlled ? (result.possession?.toTeamId ?? null) : null,
    lastTouchPlayerId: controlled ? (result.possession?.toPlayerId ?? null) : (result.actorId ?? null),
  };
  delete nextBall.transit;
  return { ...matchCore, ball: nextBall };
}