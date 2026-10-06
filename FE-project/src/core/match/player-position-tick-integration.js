/**
 * Player Position Tick Integration Boundary（Step 39F-M-C-44）。
 * 层级归属：Simulation Core / Match Orchestration。**纯函数、确定性、Immutable、无 Math.random、无墙钟**。
 *
 * 职责：把 C-43 已冻结的 Player Position Integration Boundary 落为**唯一生产入口**——
 *       将 simulation seconds 的 Tick dt 适配为既有 movement 模型所需单位，调用 `updateMovement`，
 *       使 `players[].positionOnPitch` 成为与 Ball Position 处于**同一 Tick / 同一 Simulation Time**
 *       的唯一 Player Position Truth。
 *
 * 冻结契约（C-43 → C-44，不得重释）：
 *   input : matchCore, deltaTime（simulation seconds）
 *   dt    : finite && > 0 ? deltaTime : 0           复用 C-08 / C-39 dt 语义（0 = 合法 no-op）
 *   write : players[].positionOnPitch（唯一 Player Position Truth）
 *   impl  : updateMovement(matchCore, dt / 60)       第二 → 分钟内部适配（既有 minute 模型）
 *   out   : new matchCore（immutable；含 movement transient）
 *
 * 红线（冻结）：
 * - **唯一 Position Writer**：只写 `players[].positionOnPitch` 与 transient `matchCore.movement`。
 * - **绝不触碰 Ball**：不写 `ball.position` / `ball.velocity` / `ball.transit` / `ball.state`，
 *   不调用 `advanceContinuousBallMovement` / `stepBallPhysics` / `applyBallMovementPositionUpdate` / `applyInstantBallPositionUpdate`。
 * - **绝不接入 Contact**：不向 Continuous Transit 传 `players`。
 * - **不建第二套 Truth / Clock**：不新增 `tickPosition` 等；时间只来自 Match Tick 的 `deltaTime`，不用 Date.now / performance.now。
 * - **不改 Movement 方程**：仅复用 `updateMovement`（C-43 冻结）。
 */

import { updateMovement } from './movement-update.js';

export const PLAYER_POSITION_TICK_SOURCE = 'PLAYER_POSITION_TICK';
export const PLAYER_POSITION_TICK_RULE_VERSION = 'player-position-tick-v1';

/** 边界结果原因（可观察；非 MatchCore schema）。 */
export const PLAYER_POSITION_TICK_REASON = Object.freeze({
  INVALID_MATCHCORE: 'INVALID_MATCHCORE',
  NO_PLAYERS: 'NO_PLAYERS',
  DT_ZERO: 'DT_ZERO',
  MOVED: 'MOVED',
});

const R = PLAYER_POSITION_TICK_REASON;

/**
 * 执行一个 Tick 的 Player Position 推进（唯一生产入口）。
 *
 * @param {object} matchCore 当前 MatchCore Truth（只读；不原地修改）
 * @param {number} deltaTime simulation seconds（来自 Match Tick；非有限 / <=0 视为 0 = no-op）
 * @returns {{
 *   ok:boolean, matchCore:object, applied:boolean, reason:string,
 *   deltaTime:number, source:string, ruleVersion:string
 * }}
 */
export function advancePlayerPositionTick(matchCore, deltaTime) {
  const meta = {
    source: PLAYER_POSITION_TICK_SOURCE,
    ruleVersion: PLAYER_POSITION_TICK_RULE_VERSION,
  };

  // 无 players 集合 → 结构性不可推进（非崩溃）。
  if (!matchCore || typeof matchCore !== 'object' || !Array.isArray(matchCore.players)) {
    return { ...meta, ok: false, matchCore, applied: false, reason: R.INVALID_MATCHCORE, deltaTime: 0 };
  }

  // dt 语义复用：finite && > 0，否则 0。
  const dtSeconds = Number.isFinite(Number(deltaTime)) && Number(deltaTime) > 0
    ? Number(deltaTime)
    : 0;

  // dt = 0：合法 no-op —— 位置、movement 状态均不推进（不得产生 drift）。
  if (dtSeconds === 0) {
    return { ...meta, ok: true, matchCore, applied: false, reason: R.DT_ZERO, deltaTime: 0 };
  }

  if (matchCore.players.length === 0) {
    return { ...meta, ok: true, matchCore, applied: false, reason: R.NO_PLAYERS, deltaTime: dtSeconds };
  }

  // 唯一内部换算：simulation seconds → simulation minutes（既有模型单位）。
  const dtMinutes = dtSeconds / 60;
  const next = updateMovement(matchCore, dtMinutes);

  return { ...meta, ok: true, matchCore: next, applied: true, reason: R.MOVED, deltaTime: dtSeconds };
}