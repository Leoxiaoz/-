/**
 * Instant Ball Position Integration Boundary Foundation（Step 39F-M-C-29）。
 * 层级归属：Simulation Core / Match Movement。**纯函数、确定性、Immutable、无 Math.random、无墙钟**。
 *
 * 职责：建立与 C-23（Continuous Ball Movement Integration）**并列**的
 *       「Instant Ball Position Target → 新 MatchCore.ball.position」写入边界。
 *
 * 架构（双路径，同一 Ball Position Truth）：
 *   CONTINUOUS: Ball Movement State(+duration>0) ─▶ C-23 ─┐
 *                                                         ├─▶ MatchCore.ball.position（唯一 Ball Position Truth）
 *   INSTANT:    Instant Position Target          ─▶ C-29 ─┘
 *
 * 语义（冻结）：
 * - 「在一个已确定的离散 Resolution 时刻，把 Ball Position 从当前 Truth 更新到指定 Target Position」。
 * - **不是** Movement State / Transit / Trajectory / Physics；**不产生 duration**。
 * - Instant ≠ "duration = 0"：本模块不建立该等价，也不调用 C-23。
 *
 * 边界（冻结）：
 * - **只改 `ball.position`**；不修改 state / possession / control / looseBall / inTransit / velocity / clock / phase。
 * - **不 clamp**（与 C-23 一致，忠实写入 Target；几何合法性由其他层负责）。
 * - Position 基础合法性**复用项目既有口径**（与 C-23 `readBallPosition` 相同的有限数检查）；
 *   **不新增** [0,1] 等新 Geometry Rule。
 * - `inputMatchCore` 不得原地修改（`inputMatchCore !== outputMatchCore`）；Target Position 对象不得被修改。
 * - 不产生 Movement State / Transit / Duration / Velocity / Trajectory / Physics / Collision / Movement Ledger。
 * - 不调用 C-23 / C-24 / C-25 / C-19 / C-20 / C-21 / C-22；不接入 Interaction / Possession / Tick。
 */

export const INSTANT_BALL_POSITION_INTEGRATION_SOURCE = 'INSTANT_BALL_POSITION_INTEGRATION';
export const INSTANT_BALL_POSITION_INTEGRATION_RULE_VERSION = 'instant-ball-position-integration-v1';

export const INSTANT_BALL_POSITION_INTEGRATION_REASON = Object.freeze({
  INVALID_MATCH_CORE: 'INVALID_MATCH_CORE',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_POSITION: 'INVALID_POSITION',
});

const R = INSTANT_BALL_POSITION_INTEGRATION_REASON;
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 读取并校验 matchCore.ball.position（唯一 Ball Position Truth 的来源）。
 * **口径与 C-23 `readBallPosition` 一致**（既有基础合法性；不新增 Geometry Rule）。
 */
function readBallPosition(matchCore) {
  if (!matchCore || typeof matchCore !== 'object' || Array.isArray(matchCore)) {
    return { ok: false, reason: R.INVALID_MATCH_CORE };
  }
  const pos = matchCore.ball?.position;
  if (!pos || typeof pos !== 'object' || Array.isArray(pos) || !isFiniteNum(pos.x) || !isFiniteNum(pos.y)) {
    return { ok: false, reason: R.INVALID_MATCH_CORE };
  }
  return { ok: true, position: { x: pos.x, y: pos.y } };
}

/**
 * Instant Position Integration：把已确定的上游 Resolution Target Position 写入
 * `MatchCore.ball.position`（唯一 Ball Position Truth）。
 *
 * - 成功 → `{ ok:true, matchCore, source, ruleVersion }`（**新** MatchCore；`inputMatchCore` 不变）。
 * - 失败 → `{ ok:false, reason }`（不产生新 MatchCore，不自动修正，不 clamp）。
 * - `position === matchCore.ball.position`（zero displacement）**合法成功**；不产生 duration / Movement State / Transit / Velocity。
 *
 * @param {object} matchCore 输入 MatchCore（只读；`ball.position` 为唯一 Ball Position Truth）
 * @param {{x:number,y:number}} position 上游 Resolution 已确定的 Target Position（只读，不被修改）
 * @returns {object}
 */
export function applyInstantBallPositionUpdate(matchCore, position) {
  const current = readBallPosition(matchCore);
  if (!current.ok) return { ok: false, reason: current.reason };

  if (position === null || position === undefined || typeof position !== 'object' || Array.isArray(position)) {
    return { ok: false, reason: R.INVALID_INPUT };
  }
  if (!isFiniteNum(position.x) || !isFiniteNum(position.y)) {
    return { ok: false, reason: R.INVALID_POSITION };
  }

  // 复制 + 忠实写入（不 clamp）；其余 Ball 字段保持不变。
  const target = { x: position.x, y: position.y };
  const nextBall = { ...matchCore.ball, position: target };

  return {
    ok: true,
    matchCore: { ...matchCore, ball: nextBall },
    source: INSTANT_BALL_POSITION_INTEGRATION_SOURCE,
    ruleVersion: INSTANT_BALL_POSITION_INTEGRATION_RULE_VERSION,
  };
}

/** 规则版本（metadata）。 */
export const INSTANT_BALL_POSITION_INTEGRATION_CONFIG_VERSION = INSTANT_BALL_POSITION_INTEGRATION_RULE_VERSION;