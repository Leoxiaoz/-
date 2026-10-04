/**
 * Second-Ball Resolution Foundation（Step 39F-M-C-07）。
 * 层级归属：Simulation Core / Match Resolution。**纯函数、无副作用、无 Math.random**。
 *
 * 职责：当球进入 **FREE / loose-ball** 状态后，以确定性、可测试、可解释的方式解析
 * 「附近球员对二点球的竞争结果」，产出纯数据 `SecondBallResolutionResult`。
 * 状态变更由既有 `applyInteractionStateUpdate`（唯一 authoritative mutation 层）承担。
 *
 * 数据流（单向）：
 *   MatchCore.ball(FREE) → deriveSecondBallCandidates（复用 C-04 几何派生）
 *     → resolveSecondBall → SecondBallResolutionResult
 *     → interaction-integration（integration helper）→ state-update → MatchCore Truth
 *
 * 红线（冻结）：
 * - **单一 Ball Truth**：只读 `MatchCore.ball`（经 ball-facts 派生），无第二套球 / possession truth。
 * - **不建立第二套几何系统**：复用 `deriveBallFacts / deriveBallRelation / playerVelocityFromMovement`
 *   与 `dist / clamp01 / isAvailable`；不重算 distance / direction / velocity / arrival time 口径。
 * - **Resolution ≠ State Mutation**：本模块不修改 MatchCore；候选快照均为 transient / derived / read-only。
 * - **无随机**：竞争模型为封闭确定性公式；不做 `Math.random`，无隐式时间因素。
 * - **≠ Match Loop / 完整防守 AI**：只解析「自由球产生后谁赢得二点球」这一离散竞争。
 * - 不产生 Event / 不写 stats / 不碰 Growth·Training·Development / 不持久化 / 不改 Save·Schema。
 *
 * Deferred：FOUL / OFFSIDE / GK Interaction / Set Piece / lofted / bounce / spin /
 * 完整防守 AI / 最终数值校准 —— 本 Gate 不实现。
 */

import { clamp01, isAvailable } from './player-situation.js';
import { deriveBallFacts, deriveBallRelation, playerVelocityFromMovement } from './ball-facts.js';
import { INTERACTION_BALL_STATE as BS, FOLLOW_UP_KIND } from './interaction-resolution-config.js';
import {
  SECOND_BALL_RESOLUTION_CONFIG as C,
  SECOND_BALL_RESOLUTION_RULE_VERSION,
  SECOND_BALL_OUTCOMES,
  SECOND_BALL_ELIGIBILITY,
} from './second-ball-resolution-config.js';

/** 取球员坐标（缺失回退球场中心）。 */
function posOf(p) {
  const x = Number(p?.positionOnPitch?.x);
  const y = Number(p?.positionOnPitch?.y);
  return { x: Number.isFinite(x) ? x : 0.5, y: Number.isFinite(y) ? y : 0.5 };
}

/** 属性归一化 [0,1]（缺失回退中值 50）。 */
function abilityNorm(p, key) {
  const v = Number(p?.attributes?.[key]);
  return clamp01((Number.isFinite(v) ? v : 50) / 99);
}

/** soft state 归一化 [0,1]（缺失回退 fallback/100）。 */
function softNorm(v, fallback) {
  const n = Number(v);
  const base = Number.isFinite(n) ? n : fallback;
  return clamp01(base / 100);
}

/** playerId 是否合法（稳定主键，禁止空）。 */
function isPlayerIdValid(id) {
  return typeof id === 'string' && id.length > 0;
}

/** 球队是否属于当前 MatchCore 的有效球队。 */
function isTeamValid(matchCore, teamId) {
  return teamId != null && (teamId === matchCore?.teams?.home || teamId === matchCore?.teams?.away);
}

/** 稳定字符串比较（用于确定性排序；不依赖对象迭代顺序）。 */
function cmpId(a, b) {
  const sa = String(a), sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

/** 球是否处于可争抢的 FREE / loose-ball 状态（单一 truth 派生）。 */
function isBallFree(ballFacts) {
  return ballFacts.state === BS.FREE
    && ballFacts.control === null
    && ballFacts.possessingTeamId === null
    && !ballFacts.inTransit;
}

// ===========================================================================
// Candidate Discovery（transient / derived / read-only）
// ===========================================================================

/**
 * 派生二点球候选人快照。
 *
 * 复用 C-04 几何派生（ball-facts），**不重建** distance / direction / velocity 口径。
 * 返回对象为一次性快照：修改它不影响 MatchCore（不构成第二套 Ball Truth）。
 *
 * @param {object} matchCore 只读
 * @param {{range?:number}} [options]
 * @returns {{ballFree:boolean, ballPosition:{x:number,y:number}, range:number, candidates:object[]}}
 */
export function deriveSecondBallCandidates(matchCore, options = {}) {
  const range = Number.isFinite(Number(options.range)) ? Number(options.range) : C.RANGE;
  const ballFacts = deriveBallFacts(matchCore);
  const ballFree = isBallFree(ballFacts);
  const ballPosition = { x: ballFacts.position.x, y: ballFacts.position.y };
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];

  const candidates = [];
  for (const p of players) {
    if (!p || typeof p !== 'object') continue;
    const playerId = p.playerId;
    const playerPos = posOf(p);
    const playerVel = playerVelocityFromMovement(matchCore, playerId);
    const relation = deriveBallRelation(ballFacts, playerPos, playerVel);

    let eligibility = SECOND_BALL_ELIGIBILITY.OK;
    if (!isPlayerIdValid(playerId)) eligibility = SECOND_BALL_ELIGIBILITY.INVALID_PLAYER_ID;
    else if (!isTeamValid(matchCore, p.teamId)) eligibility = SECOND_BALL_ELIGIBILITY.INVALID_TEAM;
    else if (!isAvailable(p)) eligibility = SECOND_BALL_ELIGIBILITY.NOT_AVAILABLE;
    else if (!ballFree) eligibility = SECOND_BALL_ELIGIBILITY.BALL_NOT_FREE;
    else if (relation.distance > range) eligibility = SECOND_BALL_ELIGIBILITY.OUT_OF_RANGE;

    candidates.push({
      playerId: playerId ?? null,
      teamId: p.teamId ?? null,
      // 复用 C-04 球-球员几何事实（read-only）
      distanceToBall: relation.distance,
      directionToBall: { x: relation.directionToBall.x, y: relation.directionToBall.y },
      relativeVelocity: { x: relation.relativeVelocity.x, y: relation.relativeVelocity.y },
      closingSpeed: relation.closingSpeed,
      // 竞争模型所需最小数据
      attributes: { defending: abilityNorm(p, 'defending'), pace: abilityNorm(p, 'pace') },
      soft: {
        fitness: softNorm(p.fitness, 100),
        form: softNorm(p.form, 50),
        morale: softNorm(p.morale, 50),
      },
      eligibility,
      eligible: eligibility === SECOND_BALL_ELIGIBILITY.OK,
    });
  }

  // 稳定排序（不依赖 players 迭代顺序）：playerId 升序。
  candidates.sort((a, b) => cmpId(a.playerId, b.playerId));
  return { ballFree, ballPosition, range, candidates };
}

// ===========================================================================
// Competition Model（确定性、封闭、可解释）
// ===========================================================================

/**
 * 计算单个候选人的竞争分数及其可解释分量。
 * score = arrivalAdvantage(proximity + closing) + relevantAbility + contextModifier
 * @returns {{proximity:number, closing:number, ability:number, context:number, score:number}}
 */
function computeCompetitionScore(cand, range) {
  const proximity = clamp01(1 - cand.distanceToBall / Math.max(1e-9, range));
  const closing = clamp01(cand.closingSpeed / C.CLOSING_SPEED_NORM);
  const ability = C.ABILITY_DEFENDING_WEIGHT * cand.attributes.defending
    + C.ABILITY_PACE_WEIGHT * cand.attributes.pace;
  const context = C.CONTEXT_WEIGHT * ((cand.soft.fitness + cand.soft.form + cand.soft.morale) / 3);
  const score = C.PROXIMITY_WEIGHT * proximity + C.CLOSING_WEIGHT * closing + ability + context;
  return { proximity, closing, ability, context, score };
}

/** 确定性排序：分数降序 → 距离升序 → playerId 升序（tie-break）。 */
function compareRanked(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.distanceToBall !== b.distanceToBall) return a.distanceToBall - b.distanceToBall;
  return cmpId(a.playerId, b.playerId);
}

// ===========================================================================
// Result 构造（纯数据）
// ===========================================================================

/** 统一结果骨架（纯数据；不持有 authoritative state）。 */
function makeResult({ ok, outcome, reason, ball, winner, control, possession, candidates, meta, requiresFollowUp, followUpKind }) {
  return {
    type: 'SECOND_BALL_RESOLUTION',
    actionType: 'SECOND_BALL',
    ok,
    outcome,
    reason,
    ball,
    winner,
    control,
    possession,
    candidates,
    actorId: winner?.playerId ?? null,
    targetId: null,
    requiresFollowUp,
    followUpKind,
    resolutionMeta: meta,
    debug: null,
  };
}

/** 把候选（含分数）整理为 Result.candidates（稳定序，纯数据）。 */
function toResultCandidates(discovery) {
  return discovery.candidates.map((c) => {
    const scored = c.eligible ? computeCompetitionScore(c, discovery.range) : null;
    return {
      playerId: c.playerId,
      teamId: c.teamId,
      distanceToBall: c.distanceToBall,
      directionToBall: { ...c.directionToBall },
      closingSpeed: c.closingSpeed,
      eligibility: c.eligibility,
      score: scored ? scored.score : null,
      components: scored,
    };
  });
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * 执行一次 Second-Ball Resolution。
 *
 * @param {object} matchCore MatchCore-like 状态（只读）
 * @param {{range?:number, sequence?:number, ruleVersion?:string, debug?:boolean}} [options]
 * @returns {object} SecondBallResolutionResult
 */
export function resolveSecondBall(matchCore, options = {}) {
  const ruleVersion = options.ruleVersion ?? SECOND_BALL_RESOLUTION_RULE_VERSION;
  const meta = { ruleVersion, sequence: options.sequence ?? 0 };

  if (!matchCore || typeof matchCore !== 'object') {
    return makeResult({
      ok: false, outcome: SECOND_BALL_OUTCOMES.INVALID, reason: 'INVALID_INPUT',
      ball: { position: { x: 0.5, y: 0.5 }, state: null, inTransit: false },
      winner: null, control: null,
      possession: { changed: false, retained: false, loose: false, fromPlayerId: null, fromTeamId: null, toPlayerId: null, toTeamId: null },
      candidates: [], meta, requiresFollowUp: false, followUpKind: null,
    });
  }

  const ballFacts = deriveBallFacts(matchCore);
  const discovery = deriveSecondBallCandidates(matchCore, { range: options.range });
  const resultCandidates = toResultCandidates(discovery);
  const ballPosition = { x: discovery.ballPosition.x, y: discovery.ballPosition.y };

  // 非 FREE / loose-ball → 不启动 Second-Ball Resolution，不改状态。
  if (!discovery.ballFree) {
    return makeResult({
      ok: false, outcome: SECOND_BALL_OUTCOMES.INVALID, reason: 'BALL_NOT_FREE',
      ball: { position: ballPosition, state: null, inTransit: ballFacts.inTransit },
      winner: null, control: null,
      possession: { changed: false, retained: false, loose: false, fromPlayerId: ballFacts.control, fromTeamId: ballFacts.possessingTeamId, toPlayerId: null, toTeamId: null },
      candidates: resultCandidates, meta, requiresFollowUp: false, followUpKind: null,
    });
  }

  // 竞争者排名（确定性）。
  const ranked = resultCandidates
    .filter((c) => c.score !== null)
    .map((c) => ({ ...c, score: c.score, components: c.components }))
    .sort(compareRanked);

  const best = ranked.length > 0 && ranked[0].score >= C.MIN_SCORE ? ranked[0] : null;

  // 无人获胜：无候选人 / 全部无资格 / 竞争无法形成合法 winner。
  if (!best) {
    return makeResult({
      ok: true, outcome: SECOND_BALL_OUTCOMES.NO_WINNER, reason: 'NO_ELIGIBLE_WINNER',
      ball: { position: ballPosition, state: BS.FREE, inTransit: false },
      winner: null, control: null,
      possession: { changed: false, retained: false, loose: true, fromPlayerId: null, fromTeamId: null, toPlayerId: null, toTeamId: null },
      candidates: resultCandidates, meta,
      requiresFollowUp: true, followUpKind: FOLLOW_UP_KIND.SECOND_BALL,
    });
  }

  // 获胜：建立 control / possession 语义（由 state-update 落地）。
  return makeResult({
    ok: true, outcome: SECOND_BALL_OUTCOMES.WON, reason: 'WINNER_RESOLVED',
    ball: { position: ballPosition, state: BS.CONTROLLED, inTransit: false },
    winner: { playerId: best.playerId, teamId: best.teamId, score: best.score },
    control: best.playerId,
    possession: {
      changed: true, retained: false, loose: false,
      fromPlayerId: ballFacts.control, fromTeamId: ballFacts.possessingTeamId,
      toPlayerId: best.playerId, toTeamId: best.teamId,
    },
    candidates: resultCandidates, meta,
    requiresFollowUp: false, followUpKind: null,
  });
}