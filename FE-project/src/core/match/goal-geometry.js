/**
 * Goal-Line / Goal Geometry Foundation（Step 39F-M-C-15）。
 * 层级归属：Simulation Core / Match Geometry。**纯函数、确定性、无 Math.random、无墙钟**。
 *
 * 因果链（单向，冻结）：
 *   Ball Truth(matchCore.ball) → Goal Geometry → Goal-Line Crossing Detection → Goal Candidate → C-14
 *
 * 边界：
 * - 只**读取** `matchCore.ball`；不建第二套 Ball Truth。
 * - 不实现 Ball Physics / GK / Shot / Post / Net；只消费调用方提供的 P0 → P1。
 * - 不执行比分写入（score.home++ 属 C-14）；本模块只产出 Crossing Result / Goal Candidate。
 * - 不修改 MatchCore / Ball / Geometry / Teams、不原地修改输入点。
 *
 * Deferred：带球过线语义、GK 扑救、门柱/横梁碰撞、球门网物理、Own Goal 归属。
 */

import {
  ALLOWED_CROSSING_BALL_STATES, GEOMETRY_EPSILON, GOAL_CROSSING_REASON, GOAL_CROSSING_SOURCE,
  GOAL_LINE_CROSSING_RULE_VERSION, GOAL_LINE_LEFT_X, GOAL_LINE_RIGHT_X, GOAL_MOUTH_Y_MIN, GOAL_MOUTH_Y_MAX,
} from './goal-geometry-config.js';

const EPS = GEOMETRY_EPSILON;

const isFinite2 = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * 从 MatchCore 派生 Goal Geometry（显式绑定 teamId 与球门方向；**不猜测**）。
 * 复用场地朝向 Truth：home attacks +x ⇒ 右门(x=1) 由 away 防守 / home 得分；左门(x=0) 反之。
 *
 * @param {object} matchCore
 * @returns {{left:object, right:object}}
 */
export function deriveGoalGeometry(matchCore) {
  const teams = matchCore?.teams;
  if (!teams || typeof teams.home !== 'string' || typeof teams.away !== 'string') {
    throw new TypeError('deriveGoalGeometry: matchCore.teams.home/away 必须为字符串');
  }
  const mouth = { yMin: GOAL_MOUTH_Y_MIN, yMax: GOAL_MOUTH_Y_MAX };
  return {
    left: { side: 'LEFT', lineX: GOAL_LINE_LEFT_X, scoringTeamId: teams.away, defendingTeamId: teams.home, ...mouth },
    right: { side: 'RIGHT', lineX: GOAL_LINE_RIGHT_X, scoringTeamId: teams.home, defendingTeamId: teams.away, ...mouth },
  };
}

/** 判断点是否落在门框范围内（inclusive + epsilon）。 */
export function isPointInsideGoalMouth(point, sideGeometry) {
  if (!isFinite2(point) || !sideGeometry) return false;
  return point.y >= sideGeometry.yMin - EPS && point.y <= sideGeometry.yMax + EPS;
}

/**
 * 线段 P0→P1 与竖直线 x=lineX 求交（纯几何）。
 * @returns {{x:number, y:number, t:number} | null} t∈[0,1] 且非平行时返回交点；否则 null。
 */
export function intersectSegmentWithVerticalLine(p0, p1, lineX) {
  if (!isFinite2(p0) || !isFinite2(p1) || !Number.isFinite(lineX)) return null;
  const dx = p1.x - p0.x;
  if (Math.abs(dx) < EPS) return null;             // 平行（含 P0===P1）：不与竖直线相交。
  const t = (lineX - p0.x) / dx;
  if (t < -EPS || t > 1 + EPS) return null;        // 交点不在线段范围内。
  const y = p0.y + t * (p1.y - p0.y);
  return { x: lineX, y, t };
}

/**
 * Goal-Line Crossing 检测（纯几何）。
 * 必须：场内侧 → 门外侧的**方向**穿越，且交点 y 位于门框范围。
 *
 * @param {{x,y}} p0 上一球位置（调用方显式提供；来自合法 Ball 轨迹）
 * @param {{x,y}} p1 当前球位置
 * @param {object} geometry deriveGoalGeometry 的输出
 * @param {object} [options] { epsilon? }（保留扩展；默认使用配置 epsilon）
 * @returns {object} GoalLineCrossingResult（纯 JSON）
 */
export function detectGoalLineCrossing(p0, p1, geometry, options = {}) { // eslint-disable-line no-unused-vars
  if (!isFinite2(p0) || !isFinite2(p1)) {
    return { ok: false, crossed: false, reason: GOAL_CROSSING_REASON.INVALID_INPUT, ruleVersion: GOAL_LINE_CROSSING_RULE_VERSION };
  }
  if (!geometry || !geometry.left || !geometry.right) {
    return { ok: false, crossed: false, reason: GOAL_CROSSING_REASON.INVALID_INPUT, ruleVersion: GOAL_LINE_CROSSING_RULE_VERSION };
  }
  // P0 === P1（无位移）→ 不产生穿越。
  if (Math.abs(p1.x - p0.x) < EPS && Math.abs(p1.y - p0.y) < EPS) {
    return { ok: true, crossed: false, reason: GOAL_CROSSING_REASON.NO_GOAL_LINE_CROSSING, ruleVersion: GOAL_LINE_CROSSING_RULE_VERSION };
  }

  for (const side of [geometry.left, geometry.right]) {
    const lineX = side.lineX;
    // 方向约束：必须从场内侧穿越到门外侧（field → goal），反向（外→内）不算。
    const fromInside = side.side === 'LEFT' ? p0.x > lineX : p0.x < lineX;
    const toOutside = side.side === 'LEFT' ? p1.x < lineX : p1.x > lineX;
    if (!fromInside || !toOutside) continue;

    const hit = intersectSegmentWithVerticalLine(p0, p1, lineX);
    if (!hit) continue;                            // 平行 / 无交点。
    if (!isPointInsideGoalMouth(hit, side)) continue; // 穿越点在门框外 → 非进球。

    return {
      ok: true,
      crossed: true,
      goalSide: side.side,
      crossingPoint: { x: hit.x, y: hit.y },
      scoringTeamId: side.scoringTeamId,
      defendingTeamId: side.defendingTeamId,
      reason: GOAL_CROSSING_REASON.GOAL_LINE_CROSSED,
      ruleVersion: GOAL_LINE_CROSSING_RULE_VERSION,
    };
  }

  return { ok: true, crossed: false, reason: GOAL_CROSSING_REASON.NO_GOAL_LINE_CROSSING, ruleVersion: GOAL_LINE_CROSSING_RULE_VERSION };
}

/**
 * 从 Crossing Result 构造可被 C-14 直接消费的 Goal Candidate（纯函数，不改 MatchCore）。
 * 仅当 Ball State 属于「运动轨迹」类（FREE / IN_TRANSIT）时才允许。
 *
 * @param {object} crossing detectGoalLineCrossing 的输出
 * @param {object} matchCore 只读（读取 ball.state 以做 eligibility）
 * @param {object} [options] { ballState?, playerId?, goalId? }
 * @returns {object} C-14 可消费的 Goal Candidate 或 { ok:false, reason }
 */
export function createGoalCandidateFromCrossing(crossing, matchCore, options = {}) {
  if (!crossing || crossing.ok !== true || crossing.crossed !== true) {
    return { ok: false, reason: GOAL_CROSSING_REASON.NO_CROSSING };
  }
  const ballState = options.ballState ?? matchCore?.ball?.state ?? null;
  if (!ALLOWED_CROSSING_BALL_STATES.includes(ballState)) {
    return { ok: false, reason: GOAL_CROSSING_REASON.BALL_STATE_NOT_ELIGIBLE, ballState };
  }
  return {
    ok: true,
    teamId: crossing.scoringTeamId,
    playerId: typeof options.playerId === 'string' ? options.playerId : null,
    ballState,
    goalId: typeof options.goalId === 'string' ? options.goalId : null,
    source: GOAL_CROSSING_SOURCE,
    reason: GOAL_CROSSING_REASON.GOAL_LINE_CROSSED,
  };
}

/** 规则版本（metadata）。 */
export const GOAL_GEOMETRY_CONFIG_VERSION = GOAL_LINE_CROSSING_RULE_VERSION;