/**
 * Continuous Ball Movement Integration Foundation（Step 39F-M-C-39）。
 * 层级归属：Simulation Core / Match Orchestration。**纯函数、确定性、Immutable、无 Math.random、无墙钟**。
 *
 * 职责（C-38 OPTION_B = Completion Writer 的生产落地）：
 *   把 PASS / SHOT Continuous Transit 正式接入生产 Match Tick，并建立**唯一、确定性**的
 *   中间 Position / Completion Position 写入协议：
 *     Transit（Transit Truth） ─▶ 本积分器 ─▶ C-03 Ball Physics（中间 Position Writer）
 *                                          └▶ C-23 Completion Position Boundary（最终 position = transit.to）
 *                                          └▶ 统一 Finalize（State / Control / Possession / Transit 清理，**不写 Position**）
 *
 * 写入协议（冻结）：
 * - **非完成 Tick**（progress < 1）：C-03 Physics 推进**中间** Position；**不调用 C-23**。
 * - **完成 Tick**（progress >= 1）：**不跑 Physics**；唯一 Completion Boundary（C-23）写 `position = transit.to`；
 *   Finalize 只做 State / Control / Possession / Transit 清理，**不再写 Position**。
 *
 * 边界（冻结）：
 * - Transit Truth = `ball.transit`（from / to / duration / elapsed / progress）；Position Truth = `MatchCore.ball.position`。
 * - `progress = clamp01(elapsed / duration)`（既有确定性规则）；**不由 Physics 实际距离反推 progress**。
 * - **不改 C-03 Physics**；不新增 Physics / Velocity / Acceleration / Spin / Curve / Bounce / Collision / Trajectory / Goal。
 * - 不建立第二套 Tick / Clock / Time Truth；dt 由调用方（生产 Match Tick）注入（simulation seconds）。
 * - Interaction INSTANT 路径（C-27 → C-32 → C-29）与本路径**互斥分离**；本模块不触碰 C-29 / C-32 / C-33 / C-27。
 *
 * Deferred：Player↔Ball Contact 接线、Goal Detection / Resolution（C-14/C-15/C-20/C-21/C-22）、Physics Redesign。
 */

import { clamp01 } from './player-situation.js';
import { velocityFromTransit, stepBallPhysics } from './ball-physics.js';
import { BALL_STATE } from './ball-physics-config.js';
import { createBallMovementState } from './ball-movement-state.js';
import { applyBallMovementPositionUpdate } from './ball-movement-integration.js';
import { PASS_OUTCOMES } from './pass-resolution-config.js';
import { SHOT_OUTCOMES } from './shot-resolution-config.js';

export const CONTINUOUS_BALL_MOVEMENT_SOURCE = 'CONTINUOUS_BALL_MOVEMENT';
export const CONTINUOUS_BALL_MOVEMENT_RULE_VERSION = 'continuous-ball-movement-v1';

export const CONTINUOUS_BALL_MOVEMENT_REASON = Object.freeze({
  INVALID_MATCH_CORE: 'INVALID_MATCH_CORE',
  NO_TRANSIT: 'NO_TRANSIT',
  INVALID_TRANSIT: 'INVALID_TRANSIT',
  COMPLETION_POSITION_FAILED: 'COMPLETION_POSITION_FAILED',
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 完成判定的数值容差（**不改变 Transit 语义**）。
 * 多 Tick 累加 `elapsed` 会产生浮点误差（如 0.3×3+0.1 = 0.9999999999999999 < 1），
 * 若无容差则永远差一个 ULP 而无法完成。容差仅用于判定「到达完成条件」，
 * `duration` / `elapsed` / `progress` 的定义与既有确定性规则不变。
 */
const COMPLETION_EPSILON = 1e-9;

/** 球员 → 球队（用于 finalize 结算）。 */
function teamOf(players, id) {
  return players.find((p) => p.playerId === id)?.teamId ?? null;
}

/**
 * **统一 PASS / SHOT Transit 结算（不写 Position）**。
 * 只负责 State / Control / Possession / Transit 清理；Position 由 C-23 Completion Boundary 写入。
 * 覆盖 PASS_OUTCOMES 与 SHOT_OUTCOMES（`BLOCKED` 两者行为一致）。
 *
 * @param {object} ball 已由 C-23 写入最终 position 的 BallState（只读）
 * @param {object} transit 完成前捕获的 transit（只读；**在清理前调用**）
 * @param {Array} [players]
 * @returns {object} 新 BallState（position 保持 C-23 写入值；transit = undefined）
 */
export function finalizeTransitSettlement(ball, transit, players) {
  const arr = Array.isArray(players) ? players : [];
  const t = transit ?? {};
  const base = { ...ball, transit: undefined };
  const controlled = (id, teamId) => ({ ...base, state: BALL_STATE.CONTROLLED, control: id, possessingTeamId: teamId });
  const free = { ...base, state: BALL_STATE.FREE, control: null, possessingTeamId: null };

  switch (t.outcome) {
    case PASS_OUTCOMES.COMPLETED:
      return controlled(t.intendedTargetId ?? null, t.targetTeamId ?? null);
    case PASS_OUTCOMES.INTERCEPTED:
      return t.interceptorId ? controlled(t.interceptorId, teamOf(arr, t.interceptorId)) : free;
    case PASS_OUTCOMES.BLOCKED:
    case SHOT_OUTCOMES.BLOCKED:
      return t.blockerId ? controlled(t.blockerId, teamOf(arr, t.blockerId)) : free;
    case SHOT_OUTCOMES.SAVE:
      return t.goalkeeperId ? controlled(t.goalkeeperId, teamOf(arr, t.goalkeeperId)) : free;
    case SHOT_OUTCOMES.GOAL:
      return { ...base, state: BALL_STATE.GOAL, control: null, possessingTeamId: null };
    case PASS_OUTCOMES.INACCURATE:
    case SHOT_OUTCOMES.MISS:
    default:
      return free;
  }
}

/**
 * 推进一个 Continuous Transit Tick（共享 PASS / SHOT 边界）。
 *
 * @param {object} matchCore 输入 MatchCore（只读；不原地修改）
 * @param {number} deltaTime 本 Tick 推进的 simulation seconds（非有限 / <=0 视为 0）
 * @param {{ players?:Array, config?:object }} [options]
 * @returns {{
 *   ok:boolean, reason?:(string|null), applied:boolean, completed:boolean, moved:boolean,
 *   progress:(number|null), elapsed:(number|null), matchCore:object,
 *   source:string, ruleVersion:string
 * }}
 *  - 无 transit → `applied:false, reason:'NO_TRANSIT'`（合法 NO_OP，不改任何字段）。
 *  - C-23 完成边界失败 → `ok:false, reason`（不产生部分 Position 更新）。
 */
export function advanceContinuousBallMovement(matchCore, deltaTime, options = {}) {
  const provenance = { source: CONTINUOUS_BALL_MOVEMENT_SOURCE, ruleVersion: CONTINUOUS_BALL_MOVEMENT_RULE_VERSION };
  const R = CONTINUOUS_BALL_MOVEMENT_REASON;
  const ball = matchCore?.ball;

  if (!matchCore || typeof matchCore !== 'object' || Array.isArray(matchCore) || !ball || typeof ball !== 'object') {
    return { ok: false, reason: R.INVALID_MATCH_CORE, applied: false, completed: false, moved: false, progress: null, elapsed: null, matchCore, ...provenance };
  }

  const transit = ball.transit;
  if (!transit || typeof transit !== 'object') {
    return { ok: true, reason: R.NO_TRANSIT, applied: false, completed: false, moved: false, progress: null, elapsed: null, matchCore, ...provenance };
  }

  const duration = Number(transit.duration);
  if (!isNum(duration) || duration <= 0) {
    return { ok: false, reason: R.INVALID_TRANSIT, applied: false, completed: false, moved: false, progress: null, elapsed: null, matchCore, ...provenance };
  }

  const dt = isNum(deltaTime) && deltaTime > 0 ? deltaTime : 0;
  const elapsed = (Number(transit.elapsed) || 0) + dt;
  const isComplete = elapsed >= duration - COMPLETION_EPSILON;
  const progress = isComplete ? 1 : clamp01(elapsed / duration);
  const players = Array.isArray(matchCore.players) ? matchCore.players : [];

  // ── 完成 Tick：不跑 Physics；唯一 Completion Boundary（C-23）写 transit.to；finalize 只结算 ──
  if (isComplete) {
    const movementState = createBallMovementState({
      startPosition: ball.position,
      endPosition: transit.to,
      duration,
    });
    if (!movementState.ok) {
      return { ok: false, reason: R.COMPLETION_POSITION_FAILED, applied: false, completed: false, moved: false, progress, elapsed, matchCore, ...provenance };
    }
    const posRes = applyBallMovementPositionUpdate(matchCore, movementState);
    if (!posRes.ok) {
      // 明确失败传播：不产生部分 Position 更新（返回原 MatchCore）。
      return { ok: false, reason: posRes.reason ?? R.COMPLETION_POSITION_FAILED, applied: false, completed: false, moved: false, progress, elapsed, matchCore, ...provenance };
    }
    const finalizedBall = finalizeTransitSettlement(posRes.matchCore.ball, transit, players);
    return {
      ok: true, reason: null, applied: true, completed: true, moved: true, progress: 1, elapsed,
      matchCore: { ...posRes.matchCore, ball: finalizedBall }, ...provenance,
    };
  }

  // ── 非完成 Tick：C-03 Physics 推进中间 Position（不调用 C-23）──
  let stepping = ball;
  if (!stepping.velocity) {
    stepping = { ...stepping, velocity: velocityFromTransit(transit, options.config) };
  }
  const stepped = stepBallPhysics(stepping, dt, {
    players: Array.isArray(options.players) ? options.players : [],
    config: options.config,
  });
  const nextBall = {
    ...stepped.ball,
    state: BALL_STATE.IN_TRANSIT,
    transit: {
      ...transit,
      from: { ...transit.from },
      to: { ...transit.to },
      elapsed,
      progress,
    },
  };
  return {
    ok: true, reason: null, applied: true, completed: false, moved: true, progress, elapsed,
    matchCore: { ...matchCore, ball: nextBall }, ...provenance,
  };
}

/** 规则版本（metadata）。 */
export const CONTINUOUS_BALL_MOVEMENT_CONFIG_VERSION = CONTINUOUS_BALL_MOVEMENT_RULE_VERSION;