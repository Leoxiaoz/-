/**
 * Terminal Ball Velocity Normalization Boundary（Step 39F-M-C-55）。
 * 层级归属：Simulation Core / Match。**纯函数、确定性、Immutable、无 Math.random、无墙钟**。
 *
 * 职责（C-54 §61 冻结契约的唯一实现）：
 *   当 Ball 正式进入 **终态** `CONTROLLED` 或 `GOAL` 时，把 `ball.velocity` 规范化为 `{x:0,y:0}`。
 *
 * 冻结语义（C-54 Ball Velocity State Contract）：
 *   - IN_TRANSIT：Physics Truth —— **本 Boundary 不清零**（原样返回）。
 *   - FREE      ：Physics Truth（Loose-Ball，Legal Value = 任意有限向量，含 {0,0}）—— **本 Boundary 不清零**（原样返回）。
 *   - CONTROLLED：Normalized Zero —— 唯一合法值 `{0,0}`。
 *   - GOAL      ：Normalized Zero —— 唯一合法值 `{0,0}`。
 *
 * 边界（冻结）：
 * - **只写 velocity**：不改 position / transit / control / possession / lastTouch / state / score / contact。
 * - **仅覆盖 CONTROLLED / GOAL**：FREE 与 IN_TRANSIT 一律 preserve（明确 State Guard）。
 * - 不是新的 Ball Position / Transit / Possession Writer；不新增 Ball State Invariant。
 * - 由官方 State Transition 边界调用（Transit Completion Finalize、Interaction State Mutation），
 *   **不新增独立 Tick Stage**，不改 C-08 Stage Order。
 */

import { BALL_STATE } from './ball-physics-config.js';

export const TERMINAL_VELOCITY_NORMALIZATION_SOURCE = 'TERMINAL_VELOCITY_NORMALIZATION';
export const TERMINAL_VELOCITY_RULE_VERSION = 'terminal-velocity-normalization-v1';

/** 归一化目标值（只读）。 */
export const TERMINAL_ZERO_VELOCITY = Object.freeze({ x: 0, y: 0 });

/** 需要 Velocity 归一化的终态集合（**仅** CONTROLLED / GOAL）。 */
export const TERMINAL_VELOCITY_STATES = Object.freeze([BALL_STATE.CONTROLLED, BALL_STATE.GOAL]);

/** 该 Ball State 是否属于「终态 Velocity 必须为 {0,0}」的域。 */
export function isTerminalVelocityState(state) {
  return state === BALL_STATE.CONTROLLED || state === BALL_STATE.GOAL;
}

/**
 * Terminal Velocity Normalization（唯一实现）。
 * - CONTROLLED / GOAL → `velocity = {x:0,y:0}`（若已是 {0,0} 则原样返回，保持引用稳定）。
 * - FREE / IN_TRANSIT / 未知 / 非法输入 → **原样返回（preserve）**。
 *
 * @param {object} ball BallState（只读；不原地修改）
 * @returns {object} 新的 BallState（未变更时返回输入引用）
 */
export function normalizeTerminalBallVelocity(ball) {
  if (!ball || typeof ball !== 'object') return ball;
  if (!isTerminalVelocityState(ball.state)) return ball;
  const v = ball.velocity;
  if (v && v.x === 0 && v.y === 0) return ball;
  return { ...ball, velocity: { x: 0, y: 0 } };
}

/** 规则版本（metadata）。 */
export const TERMINAL_VELOCITY_CONFIG_VERSION = TERMINAL_VELOCITY_RULE_VERSION;