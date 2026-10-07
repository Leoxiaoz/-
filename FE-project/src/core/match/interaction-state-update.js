/**
 * Interaction State Update（Step 39F-M-C-05；Step 39F-M-C-32 职责收窄）。
 * 层级归属：Simulation Core / Match Resolution。**纯函数**（返回新状态，不原地 mutate 输入）。
 *
 * 职责：消费 `InteractionResolutionResult`，把 **Interaction State** 写回 `MatchCore.ball`：
 * Ball State / possession / control / lastTouch / velocity。
 *
 * ⚠ C-32 起：**Ball Position Ownership 已与本层解耦**。
 * - 本层 **不再写入 `ball.position`**（保留当前 position，不重算 / 不覆盖 `result.ball.position`）。
 * - Interaction 的 Ball Position 由专用边界
 *   `interaction-ball-position-ownership.js` → C-29 `applyInstantBallPositionUpdate` 负责，
 *   且 **先于**本层执行（见 C-06 `integrateInteractionResolution`）。
 * - 这是职责分离，**不改变业务结果**：合法流程中最终 ball.position 与此前完全一致。
 *
 * 红线：只影响 BallState（含 state/possession/control/lastTouch/velocity）；**不修改 Score /
 * Standings / Stats / Growth / Training / Development / Save / Match Result**；不产生 Event；
 * 不调用 Decision；无 Math.random；不写 Ball Position。
 *
 * Deferred：bounce / spin / lofted / GK Interaction 的球物理属未来阶段；本模块只做
 * 控制关系的确定性落地（速度置零）。
 */

import { INTERACTION_BALL_STATE as BS } from './interaction-resolution-config.js';
import { normalizeTerminalBallVelocity } from './terminal-ball-velocity.js';

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

  if (result.ball.state === BS.IN_TRANSIT) {
    // 未拦截：球仍在飞行，权威状态不变（保留 transit 与速度）。
    return { ...matchCore, ball: cloneBall(current) };
  }

  const controlled = result.ball.state === BS.CONTROLLED;
  // C-62：LastTouch Truth = 最近一次实际触球者。
  // 仅当 Interaction 确实代表一次已确认的实际 Ball Touch 时才写入 lastTouchPlayerId。
  // 以下路径不代表实际触球，必须保留既有 lastTouch：
  //   - PRESS SUCCESS（FREE）：压迫者未必物理触球；
  //   - SECOND_BALL（WON / NO_WINNER）：winner 由竞争分决定，非触球事实。
  // 其余 Interaction（DRIBBLE / TACKLE / INTERCEPTION）的 possession.toPlayerId / actorId
  // 均对应一次正式确认的实际触球，保留原有写入。
  const preservesLastTouch =
    result.actionType === 'SECOND_BALL' ||
    (result.actionType === 'PRESS' && !controlled);
  const currentLastTouch = current.lastTouchPlayerId ?? null;
  const lastTouchPlayerId = preservesLastTouch
    ? currentLastTouch
    : (controlled ? (result.possession?.toPlayerId ?? null) : (result.actorId ?? null));
  // C-32：不写 `position`（保留当前球位；Position 由 interaction-ball-position-ownership 边界负责）。
  const nextBall = {
    ...cloneBall(current),
    velocity: { x: 0, y: 0 },
    state: result.ball.state,
    control: controlled ? (result.possession?.toPlayerId ?? null) : null,
    possessingTeamId: controlled ? (result.possession?.toTeamId ?? null) : null,
    lastTouchPlayerId,
  };
  delete nextBall.transit;
  // Terminal Velocity Normalization Boundary（C-55）：CONTROLLED / GOAL → velocity {0,0}；FREE 保留（本层既有语义）。
  return { ...matchCore, ball: normalizeTerminalBallVelocity(nextBall) };
}