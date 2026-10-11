/**
 * Ball Boundary（Step 39F-M-C-03）。
 * 层级归属：Simulation Core / Match Ball Physics。**纯函数**，无副作用、无 RNG。
 *
 * 职责（§10）：处理球与归一化球场边界（x/y ∈ [PITCH_MIN, PITCH_MAX]）。
 * 语义：本 Gate **不实现**角球 / 界外球 / 球门球 / 任意球 / 进球。
 *       仅输出基础结果：IN_BOUNDS / BOUNDARY_CONTACT / OUT_OF_BOUNDS。
 *
 * 门区通道（Goal-Line Reachability 扩展）：
 * - 当且仅当调用方显式开启 `options.goalChannel`（球门方向飞行，即 IN_TRANSIT）**且**球位于
 *   球门开口 Y 范围内并越过门线时，允许球进入**有界**门后区域（深度上限 `GOAL_MAX_DEPTH`）。
 * - 达到深度上限即安全停止（X 速度归零，位置夹取到上限），**不无限延伸 / 不反射回场**。
 * - 门区几何复用 C-15 唯一权威（`clampToGoalAwareBounds`），本模块**不新增**第二套门区规则。
 * - Y 轴与门框外 X 轴仍执行既定边界行为；未开启通道时本函数行为与既有契约**完全一致**。
 */

import { BALL_BOUNDARY, BOUNDARY_BEHAVIOR } from './ball-physics-config.js';
import { clampToGoalAwareBounds } from './goal-geometry.js';
import { GOAL_MAX_DEPTH } from './goal-geometry-config.js';

function finiteOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 结算球位置 / 速度与边界。
 * @param {{x:number,y:number}} position
 * @param {{x:number,y:number}} velocity
 * @param {object} config BALL_PHYSICS_CONFIG
 * @param {{goalChannel?:boolean}} [options] 开启门区通道（仅球门方向飞行时由物理层传入）
 * @returns {{position:{x,y}, velocity:{x,y}, boundary:{result:string, axes:string[]}}}
 */
export function resolveBallBoundary(position, velocity, config, options = {}) {
  const min = finiteOr(config?.PITCH_MIN, 0);
  const max = finiteOr(config?.PITCH_MAX, 1);
  const behavior = config?.BOUNDARY_BEHAVIOR ?? BOUNDARY_BEHAVIOR.REFLECT;
  const rest = finiteOr(config?.BOUNDARY_RESTITUTION, 0.5);
  const minBounce = finiteOr(config?.BOUNDARY_MIN_BOUNCE, 0.01);
  const goalChannel = options?.goalChannel === true && behavior !== BOUNDARY_BEHAVIOR.ALLOW_OUT;

  let x = finiteOr(position?.x, 0.5);
  let y = finiteOr(position?.y, 0.5);
  let vx = finiteOr(velocity?.x, 0);
  let vy = finiteOr(velocity?.y, 0);
  const axes = [];

  // Y 轴：始终执行既定边界行为（垂直行为不因门区改造而改变）。
  if (y < min) {
    axes.push('y_min');
    y = min;
    if (behavior === BOUNDARY_BEHAVIOR.REFLECT) {
      const nv = Math.abs(vy) * rest;
      vy = nv < minBounce ? 0 : nv;
    } else if (behavior === BOUNDARY_BEHAVIOR.STOP) {
      vy = 0;
    }
  } else if (y > max) {
    axes.push('y_max');
    y = max;
    if (behavior === BOUNDARY_BEHAVIOR.REFLECT) {
      const nv = -Math.abs(vy) * rest;
      vy = nv === 0 || Math.abs(nv) < minBounce ? 0 : nv;
    } else if (behavior === BOUNDARY_BEHAVIOR.STOP) {
      vy = 0;
    }
  }

  // X 轴：门区通道（仅球门开口内越线）或既定边界行为。
  const goalAware = goalChannel ? clampToGoalAwareBounds({ x, y }, { pitchMin: min, pitchMax: max }) : null;
  if (goalAware && goalAware.goalBehind) {
    const atDepthLimit = goalAware.x !== x; // 已被夹取 ⇒ 已达门后深度上限
    const axis = goalAware.x > max ? 'x_goal_max' : 'x_goal_min';
    x = goalAware.x;
    axes.push(axis);
    // 门后区域有界：达到深度上限即安全停止（不反射回场，不无限延伸）。
    if (atDepthLimit) vx = 0;
  } else if (x < min) {
    axes.push('x_min');
    x = min;
    if (behavior === BOUNDARY_BEHAVIOR.REFLECT) {
      const nv = Math.abs(vx) * rest;
      vx = nv < minBounce ? 0 : nv;
    } else if (behavior === BOUNDARY_BEHAVIOR.STOP) {
      vx = 0;
    }
  } else if (x > max) {
    axes.push('x_max');
    x = max;
    if (behavior === BOUNDARY_BEHAVIOR.REFLECT) {
      const nv = -Math.abs(vx) * rest;
      vx = nv === 0 || Math.abs(nv) < minBounce ? 0 : nv;
    } else if (behavior === BOUNDARY_BEHAVIOR.STOP) {
      vx = 0;
    }
  }

  let result = BALL_BOUNDARY.IN_BOUNDS;
  if (axes.length > 0) {
    result = behavior === BOUNDARY_BEHAVIOR.ALLOW_OUT ? BALL_BOUNDARY.OUT_OF_BOUNDS : BALL_BOUNDARY.BOUNDARY_CONTACT;
    if (behavior === BOUNDARY_BEHAVIOR.ALLOW_OUT) {
      // 允许出界：不夹取位置
      x = finiteOr(position?.x, x); y = finiteOr(position?.y, y);
    }
  }
  return { position: { x, y }, velocity: { x: vx, y: vy }, boundary: { result, axes } };
}

/** 门后区域深度上限（重新导出，供边界相关消费方引用同一权威）。 */
export { GOAL_MAX_DEPTH };