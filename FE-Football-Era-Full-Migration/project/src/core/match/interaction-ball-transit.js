/**
 * Interaction Resolution → Ball Transit Boundary Foundation（Step 39F-M-C-25）。
 * 层级归属：Simulation Core / Match Movement。**纯函数、确定性、Immutable、无 Math.random、无墙钟**。
 *
 * 职责：消费**已存在的** Interaction Resolution Result，在**其确实携带权威运动边界**时，
 *       归一化为 C-24 可消费的 `transit { from, to, duration }`。
 *
 * 因果链（单向，冻结）：
 *   Interaction Resolution Result ─▶ C-25 Adapter ─▶ transit{from,to,duration} ─▶ C-24 ─▶ C-23 Movement State
 *
 * 边界（冻结）：
 * - **不伪造 Movement**：若结果缺少权威 `from` / `to` / `duration`，则如实报告 Schema Gap，**不猜测、不用默认值**。
 * - `to` 只取 Resolution 已确定的 Ball 终态（`result.ball.position` / `result.transit.to` / 显式 `result.to`）。
 * - `from` 只取权威来源（`result.transit.from` / 显式 `result.from` / `result.ball.from` / `context.matchCore.ball.position`）。
 * - `duration` 只取结果已明确提供的值（`result.transit.duration` / `result.duration` / `result.interactionDuration`）。
 *   **绝不** `duration = 1` 或按动作类型推算。
 * - 不修改 Interaction Resolution / C-24 / C-23 / C-22 / C-19~C-21 / C-14 / C-15。
 * - 不写 `MatchCore.ball.position`；不调用 C-23 Position Integration；不判断进球。
 * - 不建立 Velocity Truth / Physics / Collision / Acceleration / Spin / Curve / Gravity / Bounce / Movement Ledger / Event ID。
 *
 * ⚠ 现状（本 Gate 审计结论）：当前 Interaction Resolution（DRIBBLE / TACKLE / PRESS / INTERCEPTION）
 *   结果**只暴露终态 `ball.position`，不暴露 `from`，也不暴露任何 `duration`**（`interaction-state-update`
 *   为瞬时写入并 `delete ball.transit`）。因此对现有真实结果，本 Adapter 会返回
 *   `INTERACTION_MOVEMENT_DURATION_SCHEMA_GAP` —— 即 **C-25 Capability BLOCKED**（需要未来 Gate 在
 *   Interaction Resolution 内引入权威 duration 规则），本 Gate 不发明该规则。
 */

export const INTERACTION_BALL_TRANSIT_SOURCE = 'INTERACTION_BALL_TRANSIT';
export const INTERACTION_BALL_TRANSIT_RULE_VERSION = 'interaction-ball-transit-v1';

export const INTERACTION_BALL_TRANSIT_REASON = Object.freeze({
  INVALID_INTERACTION_RESULT: 'INVALID_INTERACTION_RESULT',
  BALL_MOVEMENT_NOT_SPECIFIED: 'BALL_MOVEMENT_NOT_SPECIFIED',
  INVALID_POSITION: 'INVALID_POSITION',
  INVALID_DURATION: 'INVALID_DURATION',
  MOVEMENT_START_POSITION_MISMATCH: 'MOVEMENT_START_POSITION_MISMATCH',
  INTERACTION_MOVEMENT_START_SCHEMA_GAP: 'INTERACTION_MOVEMENT_START_SCHEMA_GAP',
  INTERACTION_MOVEMENT_DURATION_SCHEMA_GAP: 'INTERACTION_MOVEMENT_DURATION_SCHEMA_GAP',
});

const R = INTERACTION_BALL_TRANSIT_REASON;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isPoint = (p) => isObj(p) && typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y);
const mkPoint = (p) => ({ x: p.x, y: p.y });

/** 结果是否以任何形式涉及球（用于区分「无球运动」与「有球但边界不全」）。 */
function involvesBall(result) {
  return isObj(result.transit) || isObj(result.ball) || isObj(result.movement)
    || result.to !== undefined || result.from !== undefined || result.ballPosition !== undefined;
}

/**
 * 由 Interaction Resolution Result 派生 Ball Transit 边界。
 * **只读取已有权威信息**：缺 `from`/`to`/`duration` 时如实报 Gap，不猜测、不默认。
 *
 * @param {object} interactionResult 已存在的 Interaction Resolution Result（只读）
 * @param {object} [context] { matchCore? } —— 提供 Interaction 开始时的权威 Ball Position 作为 `from` 来源
 * @returns {object} 成功 `{ ok:true, movementApplied:true, transit:{from,to,duration}, source, ruleVersion }`；
 *                   无球运动 `{ ok:true, movementApplied:false, transit:null, reason:BALL_MOVEMENT_NOT_SPECIFIED, ... }`；
 *                   Schema Gap / 失败 `{ ok:false, reason, source, ruleVersion }`
 */
export function deriveInteractionBallTransit(interactionResult, context = {}) {
  const out = (extra) => ({ source: INTERACTION_BALL_TRANSIT_SOURCE, ruleVersion: INTERACTION_BALL_TRANSIT_RULE_VERSION, ...extra });

  if (!isObj(interactionResult) || interactionResult.ok === false) {
    return out({ ok: false, reason: R.INVALID_INTERACTION_RESULT });
  }

  // 无任何球信息 → 该 Interaction 没有 Ball Movement（业务正常，非崩溃）。
  if (!involvesBall(interactionResult)) {
    return out({ ok: true, movementApplied: false, transit: null, reason: R.BALL_MOVEMENT_NOT_SPECIFIED });
  }

  // 球继续处于 transit（未被该 Interaction 改变运动）→ 无新的 Movement 边界。
  const transitBlock = isObj(interactionResult.transit) ? interactionResult.transit : null;
  const ballBlock = isObj(interactionResult.ball) ? interactionResult.ball : null;
  const ballState = ballBlock?.state ?? null;
  if (!transitBlock && ballState === 'IN_TRANSIT') {
    return out({ ok: true, movementApplied: false, transit: null, reason: R.BALL_MOVEMENT_NOT_SPECIFIED });
  }

  // ---- to：Interaction Resolution 已确定的 Ball 终态 ----
  const toRaw = transitBlock?.to ?? interactionResult.to ?? ballBlock?.position ?? null;
  if (toRaw === null) {
    return out({ ok: false, reason: R.INVALID_POSITION });
  }
  if (!isPoint(toRaw)) return out({ ok: false, reason: R.INVALID_POSITION });

  // ---- from：权威起始 Ball Position（结果内 or 显式 Ball Position Context）----
  const fromExplicitRaw = transitBlock?.from ?? interactionResult.from ?? ballBlock?.from ?? null;
  const ctxBall = context?.matchCore?.ball?.position;
  if (fromExplicitRaw !== null && !isPoint(fromExplicitRaw)) return out({ ok: false, reason: R.INVALID_POSITION });
  const fromRaw = fromExplicitRaw ?? (isPoint(ctxBall) ? ctxBall : null);
  if (fromRaw === null) {
    // 结果本身不携带 from，且无权威 Ball Position Context → 起始边界 Schema Gap。
    return out({ ok: false, reason: R.INTERACTION_MOVEMENT_START_SCHEMA_GAP });
  }
  if (!isPoint(fromRaw)) return out({ ok: false, reason: R.INVALID_POSITION });

  // Start 一致性：结果显式提供的 from 必须与 Ball Position Context 一致（不自动选择其一）。
  if (fromExplicitRaw !== null && isPoint(ctxBall)
    && (fromRaw.x !== ctxBall.x || fromRaw.y !== ctxBall.y)) {
    return out({ ok: false, reason: R.MOVEMENT_START_POSITION_MISMATCH });
  }

  // ---- duration：必须来自结果已明确的权威值（绝不默认 / 绝不按动作类型推算）----
  const duration = transitBlock?.duration ?? interactionResult.duration ?? interactionResult.interactionDuration ?? ballBlock?.duration;
  if (duration === undefined || duration === null) {
    return out({ ok: false, reason: R.INTERACTION_MOVEMENT_DURATION_SCHEMA_GAP });
  }
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return out({ ok: false, reason: R.INVALID_DURATION });
  }

  return out({
    ok: true,
    movementApplied: true,
    transit: { from: mkPoint(fromRaw), to: mkPoint(toRaw), duration },
  });
}

/** 规则版本（metadata）。 */
export const INTERACTION_BALL_TRANSIT_CONFIG_VERSION = INTERACTION_BALL_TRANSIT_RULE_VERSION;