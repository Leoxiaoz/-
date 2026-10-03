/**
 * SHOT State Update（Step 39F-M-B-RESOLUTION-SHOT）。
 * 层级归属：Simulation Core / Match Resolution。**纯函数**（返回新状态，不 mutate 输入）。
 *
 * 职责：`applyShotStateUpdate`（球进入 IN_TRANSIT）、`advanceShotTransit` / `completeShotTransit`（结算球权）。
 * 红线：只影响 BallState；**不改 Score / Standings / Stats / Growth / Save / Match Result**；不产生 Event。
 */

import { clamp01 } from './player-situation.js';
import { SHOT_OUTCOMES } from './shot-resolution-config.js';

function transitBall(result) {
  return {
    position: { ...result.transit.from },
    control: null,
    possessingTeamId: null,
    state: 'IN_TRANSIT',
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
  return { ...matchCore, ball: transitBall(result) };
}

function teamOf(players, id) {
  return players.find((p) => p.playerId === id)?.teamId ?? null;
}

/** 结算：GOAL / SAVE / BLOCKED / MISS。 */
function finalize(ball, transit, players) {
  const to = { ...transit.to };
  switch (transit.outcome) {
    case SHOT_OUTCOMES.SAVE:
      if (transit.goalkeeperId) {
        return { ...ball, position: to, state: 'CONTROLLED', control: transit.goalkeeperId, possessingTeamId: teamOf(players, transit.goalkeeperId), transit: undefined };
      }
      return { ...ball, position: to, state: 'FREE', control: null, possessingTeamId: null, transit: undefined };
    case SHOT_OUTCOMES.BLOCKED:
      if (transit.blockerId) {
        return { ...ball, position: to, state: 'CONTROLLED', control: transit.blockerId, possessingTeamId: teamOf(players, transit.blockerId), transit: undefined };
      }
      return { ...ball, position: to, state: 'FREE', control: null, possessingTeamId: null, transit: undefined };
    case SHOT_OUTCOMES.GOAL:
      // 注意：**不修改 Score**（Score/Event/Stats 属未来 Integration）。
      return { ...ball, position: to, state: 'GOAL', control: null, possessingTeamId: null, transit: undefined };
    case SHOT_OUTCOMES.MISS:
    default:
      return { ...ball, position: to, state: 'FREE', control: null, possessingTeamId: null, transit: undefined };
  }
}

/**
 * 推进 SHOT 飞行（simulation time；纯函数）。
 * @returns {object} 新的 matchCore
 */
export function advanceShotTransit(matchCore, deltaTime) {
  const ball = matchCore?.ball;
  const transit = ball?.transit;
  if (!ball || !transit) return matchCore;
  const dt = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0;
  const elapsed = (Number(transit.elapsed) || 0) + dt;
  const duration = Math.max(1e-6, Number(transit.duration) || 0);
  const progress = clamp01(elapsed / duration);
  const players = Array.isArray(matchCore.players) ? matchCore.players : [];
  if (progress >= 1) {
    return { ...matchCore, ball: finalize(ball, transit, players) };
  }
  const nextTransit = { ...transit, from: { ...transit.from }, to: { ...transit.to }, elapsed, progress };
  return { ...matchCore, ball: { ...ball, position: { ...ball.position }, transit: nextTransit } };
}

/** 便捷：一次性算完整个飞行（测试 / 快模）。 */
export function completeShotTransit(matchCore) {
  const t = matchCore?.ball?.transit;
  if (!t) return matchCore;
  return advanceShotTransit(matchCore, Math.max(1e-6, Number(t.duration) || 0));
}
