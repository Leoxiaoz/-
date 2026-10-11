/**
 * Movement Update / 编排（Step 39F-M-C）。
 * 层级归属：Simulation Core / Match Movement。**纯函数**（返回新 MatchCore，不原地 mutate 输入）。
 *
 * 职责（§15/§16/§18）：
 * - 维护 **transient MovementState**（`matchCore.movement`）：possession since-time、每人 intent/target/speed/elapsed。
 * - **PositionOnPitch 唯一写入路径**（本模块）。
 * - L0（每 tick 22 人 Locomotion）/ L1（事件驱动 Intent+Target 重评）/ L2（完整 Decision 仅保留 hook）。
 *
 * 红线：
 * - 不写 Score / Stats / Event / Growth / Training / Save；不接 Production Loop；不调用 Decision / PASS / SHOT。
 * - 不引入 velocity / acceleration / orientation / height / collision。
 * - 不改 Schema；`matchCore.movement` 为 transient，**不持久化**。
 */

import { dist } from './player-situation.js';
import { getTacticalState } from './tactical-state.js';
import { buildTacticalContext } from './tactical-context.js';
import { buildTeamShape } from './team-shape.js';
import { selectMovementIntent } from './movement-intent.js';
import { resolveMovementTarget } from './movement-target.js';
import { computeMovementSpeed, stepLocomotion } from './locomotion.js';
import { REEVAL, MOVEMENT_LEVEL, PRESS_RANGE } from './movement-config.js';

/** 新建空的 transient MovementState（不持久化）。 */
export function createMovementState(matchCore) {
  return {
    possession: { teamId: matchCore?.ball?.possessingTeamId ?? null, sinceTime: Number(matchCore?.clock?.simulationTime) || 0 },
    players: {},
    lastBall: null,
    lastPhase: {},
    lastTactical: {},
    anchors: {},
    lastUpdateTime: Number(matchCore?.clock?.simulationTime) || 0,
  };
}

/** 确保 MatchCore 具备 MovementState（缺失则以 MatchCore 初始状态建立）。 */
export function initMovementState(matchCore) {
  if (!matchCore || typeof matchCore !== 'object') return matchCore;
  if (matchCore.movement && typeof matchCore.movement === 'object') return matchCore;
  return { ...matchCore, movement: createMovementState(matchCore) };
}

/**
 * L0/L1/L2 层级判定（§16）。
 * - L0：仅 Locomotion（无重评）。
 * - L1：事件驱动 Intent / Target 重评（不进入完整 Decision）。
 * - L2：需要完整 Decision 的极少数球员 —— 仅球权球员，或球权变更时紧邻球的球员。
 */
export function movementLevelFor({ needsReeval, possessionChanged, isCarrier, nearBall }) {
  if (!needsReeval) return MOVEMENT_LEVEL.L0;
  if (isCarrier || (possessionChanged && nearBall)) return MOVEMENT_LEVEL.L2;
  return MOVEMENT_LEVEL.L1;
}

/** 球是否在可用位置。 */
function ballPos(matchCore) {
  const x = Number(matchCore?.ball?.position?.x);
  const y = Number(matchCore?.ball?.position?.y);
  return { x: Number.isFinite(x) ? x : 0.5, y: Number.isFinite(y) ? y : 0.5 };
}

/**
 * 推进一个 simulation tick 的 Movement。
 * @param {object} matchCore
 * @param {number} dt simulation minutes（非有限 / <=0 视为 0，只做零位移评估）
 * @param {object} [options] { onFullDecision?: (playerId, context) => void } —— L2 hook，本 Gate 不接 Decision Pipeline
 * @returns {object} 新的 MatchCore（仅 players[].positionOnPitch 与 movement 变化）
 */
export function updateMovement(matchCore, dt, options = {}) {
  if (!matchCore || !Array.isArray(matchCore.players)) return matchCore;
  const clockTime = Number(matchCore?.clock?.simulationTime) || 0;
  const stepDt = Number.isFinite(Number(dt)) && Number(dt) > 0 ? Number(dt) : 0;
  const prev = initMovementState(matchCore).movement;

  const possessing = matchCore?.ball?.possessingTeamId ?? null;
  const possessionChanged = prev.possession.teamId !== possessing;
  const possession = possessionChanged ? { teamId: possessing, sinceTime: clockTime } : { ...prev.possession };

  const b = ballPos(matchCore);
  const ballMoved = prev.lastBall ? dist(prev.lastBall, b) > REEVAL.BALL_MOVE_THRESHOLD : false;

  const teams = [matchCore?.teams?.home, matchCore?.teams?.away].filter(Boolean);
  const teamCtx = {};
  const teamShape = {};
  const teamTactical = {};
  const tacticChanged = {};
  const lastPhase = {};
  const anchors = {};
  for (const t of teams) {
    const tac = getTacticalState(matchCore, t);
    teamTactical[t] = tac;
    tacticChanged[t] = prev.lastTactical?.[t]
      ? JSON.stringify(prev.lastTactical[t]) !== JSON.stringify(tac)
      : false;
    const ctx0 = buildTacticalContext(matchCore, t);
    const shape = buildTeamShape(matchCore, t, ctx0, tac);
    teamShape[t] = shape;
    teamCtx[t] = buildTacticalContext(matchCore, t, { shapeAnchors: shape.anchors });
    lastPhase[t] = teamCtx[t].phase;
    Object.assign(anchors, shape.anchors);
  }

  const nextPlayers = [];
  const nextPlayerState = {};
  for (const p of matchCore.players) {
    const available = p.onPitch !== false && !p.injured && !p.sentOff;
    const t = p.teamId;
    if (!available || !teamCtx[t]) { nextPlayers.push(p); continue; }

    const ctx = teamCtx[t];
    const shape = teamShape[t];
    const tac = teamTactical[t];
    const st = prev.players[p.playerId];
    const isCarrier = matchCore?.ball?.control === p.playerId;

    const targetInvalid = !st || !st.target
      || !Number.isFinite(Number(st.target.x)) || !Number.isFinite(Number(st.target.y));
    const expired = st ? (Number(st.elapsed) || 0) >= REEVAL.COMMIT_MAX_MINUTES : false;
    const needsReeval = targetInvalid || possessionChanged || tacticChanged[t] || prev.lastPhase?.[t] !== ctx.phase || ballMoved || expired;

    let intent = st?.intent;
    let target = st?.target;
    let kind = st?.kind;
    let elapsed = Number(st?.elapsed) || 0;

    if (needsReeval) {
      const sel = selectMovementIntent({ matchCore, player: p, context: ctx, tacticalState: tac });
      const tgt = resolveMovementTarget({ intent: sel.intent, player: p, shape, context: ctx, tacticalState: tac, matchCore });
      intent = sel.intent;
      target = { x: tgt.x, y: tgt.y };
      kind = tgt.kind;
      elapsed = 0;
    }

    const speed = computeMovementSpeed({ player: p, intent, matchCore });
    const res = stepLocomotion(p.positionOnPitch, target, speed, stepDt);
    nextPlayers.push({ ...p, positionOnPitch: res.position });

    const level = movementLevelFor({
      needsReeval,
      possessionChanged,
      isCarrier,
      nearBall: dist(p.positionOnPitch, b) <= PRESS_RANGE,
    });
    if (level === MOVEMENT_LEVEL.L2 && typeof options.onFullDecision === 'function') {
      options.onFullDecision(p.playerId, ctx);
    }
    nextPlayerState[p.playerId] = {
      intent,
      kind,
      target,
      speed,
      elapsed: elapsed + stepDt,
      status: res.arrived ? 'ARRIVED' : 'MOVING',
      evalTime: needsReeval ? clockTime : (Number(st?.evalTime) || clockTime),
      level,
    };
  }

  return {
    ...matchCore,
    players: nextPlayers,
    movement: {
      possession,
      players: nextPlayerState,
      lastBall: { ...b },
      lastPhase,
      lastTactical: teamTactical,
      anchors,
      lastUpdateTime: clockTime,
    },
  };
}