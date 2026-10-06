/**
 * Match Tick Orchestration Foundation（Step 39F-M-C-08）。
 * 层级归属：Simulation Core / Match Orchestration。**纯函数、无副作用、无 Math.random、无墙钟**。
 *
 * 职责：把已有的 C-05 Interaction Resolution、C-06 Integration、C-07 SECOND_BALL Resolution
 * 组织成一个 **离散、确定性、可测试** 的 Tick 编排层。Tick 只负责：
 *   «确定调用顺序 + 输入快照 + 输出下一状态»，不是新的游戏规则层，也不是完整 Match Loop。
 *
 * 数据流（单向、每 Tick 单次）：
 *   Tick Input → Snapshot → Player Movement（C-43 Boundary / C-44）
 *     → Continuous Transit（C-39）→ ActionInstance（C-04 Decision 或外部传入）
 *     → Interaction Resolution（C-05）→ Integration（C-06）
 *     → 若 FREE 且 requiresFollowUp=SECOND_BALL → SECOND_BALL（C-07）→ Integration
 *     → Tick Result → Next MatchCore
 *
 * 冻结顺序：VALIDATE → SNAPSHOT → PLAYER_MOVEMENT → CONTINUOUS_TRANSIT → ACTION
 *   → INTERACTION_RESOLVE → INTERACTION_INTEGRATE → SECOND_BALL(可选) → INVARIANTS。
 *
 * 关键边界（冻结）：
 * - **单一 MatchCore Truth**：输入 → 计算 → 新 MatchCore（immutable return）；不原地修改、不建第二套。
 * - **Tick ≠ 规则层**：不重算 Interaction / Second-Ball / Geometry；只编排已有能力。
 * - **不递归**：Action → Interaction → 最多一次 SECOND_BALL → Tick End（`MAX_SECOND_BALL_PER_TICK = 1`）。
 * - **Tick ≠ Production Loop / Renderer**：无比赛时钟 / 半场 / 赛季 / UI / 渲染。
 * - **events 仅 transient trace**，不构成 Ball / Possession / MatchCore 的第二数据源。
 * - **时间语义**：仅使用确定性 `tickIndex`；不使用 Date.now / performance.now / 真实时间。
 *
 * Deferred：完整比赛循环 / 90 分钟时钟 / 半场 / 赛季推进 / Renderer / Save·Schema /
 * Ball Physics（bounce·spin·lofted·gravity·drag）/ 完整防守 AI / FOUL·OFFSIDE·GK·Set Piece。
 */

import { decidePlayerAction } from './decision-pipeline.js';
import { resolveInteraction } from './interaction-resolution.js';
import { resolveSecondBall } from './second-ball-resolution.js';
import {
  integrateInteractionResolution, integrateSecondBallResolution, checkMatchInvariants,
} from './interaction-integration.js';
import { deriveBallFacts } from './ball-facts.js';
import { INTERACTION_BALL_STATE as BS, FOLLOW_UP_KIND } from './interaction-resolution-config.js';
import { advanceContinuousBallMovement } from './continuous-ball-movement-integration.js';
import { playerMotionList } from './ball-physics.js';
import { advancePlayerPositionTick } from './player-position-tick-integration.js';
import { MATCH_CLOCK_CONFIG } from './match-clock-config.js';
import {
  MATCH_TICK_RULE_VERSION, MATCH_TICK_CONFIG, TICK_STAGES, TICK_EVENT_TYPES,
} from './match-tick-config.js';

/** 深拷贝 JSON-safe 数据（避免与输入共享引用；确定性）。 */
function cloneJson(x) {
  return JSON.parse(JSON.stringify(x));
}

/**
 * Tick 级一致性检查（复用 C-06 MatchCore 不变量 + Tick 专属不变量）。
 *
 * - INV-01/02：CONTROLLED 的 control 与 possessingTeamId 必须与球员球队一致（来自 checkMatchInvariants）。
 * - INV-03：FREE / IN_TRANSIT 不得携带 possession（来自 checkMatchInvariants）。
 * - INV-04：IN_TRANSIT 不得产生 possession（来自 checkMatchInvariants）。
 * - INV-05：SECOND_BALL_NO_WINNER 必须保持 FREE。
 * - INV-06：一个 Tick 不得产生多个最终 possession owner。
 * - INV-07：不得产生第二套 Ball Truth（结构性；此处确保 ball 为单一对象、无并行 ball 字段）。
 *
 * @returns {string[]} 问题列表（空 = 通过）
 */
export function checkTickInvariants(matchCore, tickInfo = {}) {
  const issues = checkMatchInvariants(matchCore);
  const ball = matchCore?.ball;
  const sb = tickInfo?.secondBallResult;
  if (sb && sb.ok && sb.outcome === 'SECOND_BALL_NO_WINNER' && ball?.state !== BS.FREE) {
    issues.push('INV-05_SECOND_BALL_NO_WINNER_NOT_FREE');
  }
  // INV-06：最终球权所有者至多一个。
  const owners = [];
  if (ball?.control != null) owners.push(ball.control);
  if (owners.length > 1) issues.push('INV-06_MULTIPLE_POSSESSION_OWNERS');
  // INV-07：不得出现并行的第二套 ball 字段。
  if (matchCore && typeof matchCore === 'object' && ('ballTruth' in matchCore || 'shadowBall' in matchCore || 'secondBall' in matchCore)) {
    issues.push('INV-07_SECOND_BALL_TRUTH_PRESENT');
  }
  return issues;
}

/**
 * 执行一个离散 Match Tick。
 *
 * @param {object} matchCore 当前 MatchCore Truth（只读；不原地修改）
 * @param {{
 *   tickIndex?:number,
 *   playerId?:string,             // 未提供 actionInstance 时用于 C-04 Decision
 *   actionInstance?:object,       // 优先复用外部 ActionInstance
 *   seed?:string,                 // 确定性随机种子（Decision / Interaction）
 *   decisionSequence?:number,
 *   interactionSequence?:number,
 *   deltaTime?:number,            // C-39：Continuous Transit 推进的 simulation seconds（默认 TICK_DURATION_SECONDS）
 * }} [tickInput]
 * @param {{
 *   ruleVersion?:string, decisionRuleVersion?:string, interactionRuleVersion?:string,
 *   secondBallRuleVersion?:string, secondBallRange?:number,
 * }} [options]
 * @returns {{
 *   matchCore:object, tick:object, actionInstance:object|null,
 *   interactionResult:object|null, secondBallResult:object|null,
 *   events:object[], applied:{interaction:boolean, secondBall:boolean, playerMovement:boolean, continuousMovement:boolean, continuousMovementCompleted:boolean},
 *   invariantIssues:string[], debug:null
 * }}
 */
export function runMatchTick(matchCore, tickInput = {}, options = {}) {
  const ruleVersion = options.ruleVersion ?? MATCH_TICK_RULE_VERSION;
  const events = [];
  const tickIndex = Number.isInteger(tickInput?.tickIndex)
    ? tickInput.tickIndex
    : (Number.isInteger(matchCore?.tickIndex) ? matchCore.tickIndex : 0);

  // 1. Validate Input
  if (!matchCore || typeof matchCore !== 'object' || !matchCore.ball) {
    events.push({ type: TICK_EVENT_TYPES.TICK_INVALID, tickIndex, reason: 'INVALID_MATCHCORE' });
    return {
      matchCore, tick: { tickIndex, ruleVersion, stages: [TICK_STAGES.VALIDATE], status: 'INVALID', snapshot: null },
      actionInstance: null, interactionResult: null, secondBallResult: null,
      events, applied: { interaction: false, secondBall: false, playerMovement: false, continuousMovement: false, continuousMovementCompleted: false },
      invariantIssues: matchCore ? checkMatchInvariants(matchCore) : ['NO_MATCHCORE'], debug: null,
    };
  }

  events.push({ type: TICK_EVENT_TYPES.TICK_STARTED, tickIndex });
  const stages = [TICK_STAGES.VALIDATE];

  // 2. Create Tick Snapshot / Context（transient / derived；非 Truth）
  const ballBefore = deriveBallFacts(matchCore);
  const snapshot = {
    tickIndex,
    ballState: ballBefore.state,
    control: ballBefore.control,
    possessingTeamId: ballBefore.possessingTeamId,
    inTransit: ballBefore.inTransit,
  };
  stages.push(TICK_STAGES.SNAPSHOT);

  // 2.25 Player Position Movement Integration（C-44；C-43 Boundary）
  //      顺序冻结：SNAPSHOT → PLAYER_MOVEMENT → CONTINUOUS_TRANSIT。
  //      唯一写入 players[].positionOnPitch；只读 Ball（不触碰 ball.position / velocity / transit / state）。
  //      dt 来源 = 生产 Match Tick 的 simulation seconds（默认 TICK_DURATION_SECONDS）；不使用墙钟。
  const deltaTime = Number.isFinite(tickInput?.deltaTime)
    ? tickInput.deltaTime
    : MATCH_CLOCK_CONFIG.TICK_DURATION_SECONDS;
  const playerMoveRes = advancePlayerPositionTick(matchCore, deltaTime);
  let current = playerMoveRes.matchCore;
  const applied = {
    interaction: false,
    secondBall: false,
    playerMovement: playerMoveRes.applied === true,
    continuousMovement: false,
    continuousMovementCompleted: false,
  };
  stages.push(TICK_STAGES.PLAYER_MOVEMENT);
  events.push({
    type: playerMoveRes.applied
      ? TICK_EVENT_TYPES.PLAYER_MOVEMENT_APPLIED
      : TICK_EVENT_TYPES.PLAYER_MOVEMENT_SKIPPED,
    tickIndex, reason: playerMoveRes.reason,
  });

  // 2.5 Continuous Ball Movement Integration（C-39 / OPTION_B）
  //     检测当前是否存在 Continuous Transit → 注入确定性 Tick dt → C-03 Physics（中间）/ C-23（完成）。
  //     dt 来源 = 生产 Match Tick 的 simulation seconds（默认 1 Tick = TICK_DURATION_SECONDS）；不使用墙钟。
  //     C-47：向 C-39 传入当前 Tick（post-PLAYER_MOVEMENT）的 Player Position 输入 →
  //           C-39 非完成 Tick 转发 players 给 C-03 stepBallPhysics → 既有 C-03 Contact 正式进入生产。
  //           唯一 Player Position Truth = players[].positionOnPitch；Contact 仍内嵌于 C-03 Physics（无独立 Stage）。
  const contRes = advanceContinuousBallMovement(current, deltaTime, { players: playerMotionList(current) });
  current = contRes.matchCore;
  applied.continuousMovement = contRes.applied === true;
  applied.continuousMovementCompleted = contRes.completed === true;
  stages.push(TICK_STAGES.CONTINUOUS_TRANSIT);
  if (!contRes.ok) {
    events.push({ type: TICK_EVENT_TYPES.CONTINUOUS_TRANSIT_FAILED, tickIndex, reason: contRes.reason });
  } else if (contRes.applied) {
    events.push({
      type: contRes.completed ? TICK_EVENT_TYPES.CONTINUOUS_TRANSIT_COMPLETED : TICK_EVENT_TYPES.CONTINUOUS_TRANSIT_ADVANCED,
      tickIndex, progress: contRes.progress,
    });
  } else {
    events.push({ type: TICK_EVENT_TYPES.CONTINUOUS_TRANSIT_SKIPPED, tickIndex, reason: contRes.reason });
  }

  // 3. Produce ActionInstance（优先复用外部；否则走 C-04 Decision）
  let actionInstance = null;
  if (tickInput.actionInstance && typeof tickInput.actionInstance === 'object') {
    actionInstance = cloneJson(tickInput.actionInstance);
  } else if (typeof tickInput.playerId === 'string' && tickInput.playerId.length > 0) {
    const decision = decidePlayerAction(matchCore, tickInput.playerId, {
      seed: tickInput.seed ?? null,
      decisionSequence: tickInput.decisionSequence ?? tickIndex,
      ruleVersion: options.decisionRuleVersion,
      debug: false,
    });
    actionInstance = decision.actionInstance ? cloneJson(decision.actionInstance) : null;
  }
  stages.push(TICK_STAGES.ACTION);

  let interactionResult = null;
  let secondBallResult = null;

  if (actionInstance) {
    events.push({
      type: TICK_EVENT_TYPES.ACTION_CREATED, tickIndex,
      actionType: actionInstance.actionType ?? null, actorId: actionInstance.actorId ?? null,
    });

    // 4. Resolve Interaction（复用 C-05；不重算 Geometry）
    interactionResult = resolveInteraction(actionInstance, current, {
      seed: tickInput.seed ?? null,
      sequence: tickInput.interactionSequence ?? tickIndex,
      ruleVersion: options.interactionRuleVersion,
      calibrationProfile: options.calibrationProfile, // C-09：Calibration 透传（纯参数注入，不改生命周期）
    });
    stages.push(TICK_STAGES.INTERACTION_RESOLVE);
    events.push({
      type: TICK_EVENT_TYPES.INTERACTION_RESOLVED, tickIndex,
      actionType: interactionResult.actionType ?? null,
      outcome: interactionResult.outcome ?? null, ok: interactionResult.ok === true,
    });

    // 5. Integrate Interaction（复用 C-06 唯一 mutation 层）
    const intEnv = integrateInteractionResolution(current, interactionResult);
    current = intEnv.matchCore;
    applied.interaction = intEnv.applied;
    stages.push(TICK_STAGES.INTERACTION_INTEGRATE);
    events.push({
      type: TICK_EVENT_TYPES.INTERACTION_INTEGRATED, tickIndex,
      applied: intEnv.applied, reason: intEnv.reason, applicationKey: intEnv.applicationKey,
    });

    // 6. 判断是否产生 SECOND_BALL follow-up
    const ballNow = deriveBallFacts(current);
    const wantsSecondBall = interactionResult.requiresFollowUp === true
      && interactionResult.followUpKind === FOLLOW_UP_KIND.SECOND_BALL
      && ballNow.state === BS.FREE;

    // 7–8. 最多一次 SECOND_BALL（防递归；不强制创建）
    if (wantsSecondBall && MATCH_TICK_CONFIG.MAX_SECOND_BALL_PER_TICK >= 1) {
      secondBallResult = resolveSecondBall(current, {
        range: options.secondBallRange,
        sequence: tickIndex,
        ruleVersion: options.secondBallRuleVersion,
        calibrationProfile: options.calibrationProfile, // C-09：Calibration 透传（纯参数注入，不改生命周期）
      });
      const sbEnv = integrateSecondBallResolution(current, secondBallResult);
      current = sbEnv.matchCore;
      applied.secondBall = sbEnv.applied;
      stages.push(TICK_STAGES.SECOND_BALL_RESOLVE, TICK_STAGES.SECOND_BALL_INTEGRATE);
      events.push({
        type: TICK_EVENT_TYPES.SECOND_BALL_RESOLVED, tickIndex,
        outcome: secondBallResult.outcome ?? null,
        winnerId: secondBallResult.winner?.playerId ?? null,
        applied: sbEnv.applied, reason: sbEnv.reason,
      });
    } else {
      events.push({
        type: TICK_EVENT_TYPES.SECOND_BALL_SKIPPED, tickIndex,
        reason: wantsSecondBall ? 'CONFIG_LIMIT' : 'NO_FOLLOW_UP',
      });
    }
  } else {
    events.push({ type: TICK_EVENT_TYPES.NO_ACTION, tickIndex });
  }

  // 9. Validate Invariants
  const invariantIssues = checkTickInvariants(current, { secondBallResult });
  stages.push(TICK_STAGES.INVARIANTS);
  events.push({ type: TICK_EVENT_TYPES.TICK_ENDED, tickIndex });

  // 10. Return Tick Result（JSON-safe；不含函数；不暴露 authoritative 内部对象引用）
  return {
    matchCore: current,
    tick: { tickIndex, ruleVersion, stages, status: 'COMPLETED', snapshot },
    actionInstance,
    interactionResult,
    secondBallResult,
    events,
    applied,
    invariantIssues,
    debug: null,
  };
}