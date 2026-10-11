/**
 * Interaction Ball Movement Semantics Decision Foundation（Step 39F-M-C-27）。
 * 层级归属：Simulation Core / Match Semantics。**纯数据 + 纯函数**；无副作用、无 RNG、无墙钟。
 *
 * 职责：冻结「Interaction 导致 Ball Position 改变」这一变化究竟是
 *       **INSTANT（离散 Resolution 时刻直接确定新位置）** 还是
 *       **CONTINUOUS（具有模拟持续时间的 Ball Movement）** 的语义方向。
 *
 * 冻结语义（由既有事实推导，非现实足球经验）：
 *   DRIBBLE      → INSTANT
 *   TACKLE       → INSTANT
 *   PRESS        → INSTANT
 *   INTERCEPTION → INSTANT
 *
 * 源码依据（优先级：② Resolution Contract ③ Ball State 语义 ④ Tick 时间语义）：
 * - `interaction-resolution.js` 的 `makeResult` 结果只暴露**终态** `ball.position` + `state`，
 *   不含 `from` / `to` / `duration` / `transit`；Resolution 为**同步单次**计算，无时间参数。
 * - `interaction-state-update.js` 直接写入位置并 `delete nextBall.transit`、`velocity = {0,0}`
 *   —— 即「离散 Resolution 时刻直接确定新位置」。
 * - `INTERACTION_BALL_STATE` 只有 CONTROLLED / FREE（离散控制态）与 IN_TRANSIT（仅失败拦截时保留，
 *   且不属于该 Interaction 自身的运动）。
 * - `INTERACTION_RESOLUTION_CONFIG` 与 `action-definitions` 对 DRIBBLE/TACKLE/PRESS 均无 duration
 *   （`commitmentPolicy.duration: null` 是**动作承诺**语义，按规则六**不得**替代 Ball Movement Duration）。
 *
 * 红线（冻结）：
 * - **INSTANT ≠ duration = 0**：本模块只冻结「离散状态迁移」语义，**不产生 duration**，不建立
 *   「duration = 0」的等价关系（那需要未来独立冻结）。
 * - **不修改 C-25**：INSTANT Interaction 不要求 transit，**不得**为适配 C-25 伪造 Transit / 放宽 C-25。
 * - 不产生 duration 数值 / velocity / physics / collision / acceleration / spin / trajectory / integration。
 * - 不改 MatchCore / Ball Position / Score / Save；不产生 Movement State；不调用 C-23 / C-24 / C-25。
 * - 未知 Interaction **绝不静默归类**：返回 BLOCKED + 原因。
 */

/** Provenance。 */
export const INTERACTION_BALL_MOVEMENT_SEMANTICS_SOURCE = 'INTERACTION_BALL_MOVEMENT_SEMANTICS';
export const INTERACTION_BALL_MOVEMENT_SEMANTICS_RULE_VERSION = 'interaction-ball-movement-semantics-v1';

/** Ball Movement 语义枚举（冻结）。 */
export const BALL_MOVEMENT_SEMANTICS = Object.freeze({
  INSTANT: 'INSTANT',
  CONTINUOUS: 'CONTINUOUS',
  BLOCKED: 'BLOCKED',
});

/** 无法判定 / 输入非法的原因码。 */
export const INTERACTION_BALL_MOVEMENT_SEMANTICS_REASON = Object.freeze({
  INVALID_ACTION_TYPE: 'INVALID_ACTION_TYPE',
  INTERACTION_BALL_MOVEMENT_SEMANTICS_UNDEFINED: 'INTERACTION_BALL_MOVEMENT_SEMANTICS_UNDEFINED',
});

const S = BALL_MOVEMENT_SEMANTICS;
const R = INTERACTION_BALL_MOVEMENT_SEMANTICS_REASON;

/**
 * 冻结的 Interaction Ball Movement 语义映射（C-27）。
 * 仅包含**已审查**的 Interaction 类型；未知类型不在此表中。
 */
export const INTERACTION_BALL_MOVEMENT_SEMANTICS = Object.freeze({
  DRIBBLE: S.INSTANT,
  TACKLE: S.INSTANT,
  PRESS: S.INSTANT,
  INTERCEPTION: S.INSTANT,
});

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * 查询某 Interaction 类型的 Ball Movement 语义。
 * **不静默归类**：非法输入 / 未审查类型 → BLOCKED + 原因。
 *
 * @param {string} actionType 'DRIBBLE' | 'TACKLE' | 'PRESS' | 'INTERCEPTION'
 * @returns {{ ok:boolean, semantics:string, reason:(string|null), source:string, ruleVersion:string }}
 */
export function resolveInteractionBallMovementSemantics(actionType) {
  const out = (extra) => ({
    source: INTERACTION_BALL_MOVEMENT_SEMANTICS_SOURCE,
    ruleVersion: INTERACTION_BALL_MOVEMENT_SEMANTICS_RULE_VERSION,
    ...extra,
  });

  if (typeof actionType !== 'string' || actionType.length === 0) {
    return out({ ok: false, semantics: S.BLOCKED, reason: R.INVALID_ACTION_TYPE });
  }
  if (!has(INTERACTION_BALL_MOVEMENT_SEMANTICS, actionType)) {
    return out({ ok: false, semantics: S.BLOCKED, reason: R.INTERACTION_BALL_MOVEMENT_SEMANTICS_UNDEFINED });
  }
  return out({ ok: true, semantics: INTERACTION_BALL_MOVEMENT_SEMANTICS[actionType], reason: null });
}

/** 返回冻结语义映射的只读副本（防外部误改）。 */
export function getAllInteractionBallMovementSemantics() {
  return { ...INTERACTION_BALL_MOVEMENT_SEMANTICS };
}