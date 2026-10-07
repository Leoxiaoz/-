/**
 * Ball Boundary（Step 39F-M-C-03）。
 * 层级归属：Simulation Core / Match Ball Physics。**纯函数**，无副作用、无 RNG。
 *
 * 职责（§10）：处理球与归一化球场边界（x/y ∈ [PITCH_MIN, PITCH_MAX]）。
 * 语义：本 Gate **不实现**角球 / 界外球 / 球门球 / 任意球 / 进球。
 *       仅输出基础结果：IN_BOUNDS / BOUNDARY_CONTACT / OUT_OF_BOUNDS。
 */

import { BALL_BOUNDARY, BOUNDARY_BEHAVIOR } from './ball-physics-config.js';

function finiteOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 结算球位置 / 速度与边界。
 * @param {{x:number,y:number}} position
 * @param {{x:number,y:number}} velocity
 * @param {object} config BALL_PHYSICS_CONFIG
 * @returns {{position:{x,y}, velocity:{x,y}, boundary:{result:string, axes:string[]}}}
 */
export function resolveBallBoundary(position, velocity, config) {
  const min = finiteOr(config?.PITCH_MIN, 0);
  const max = finiteOr(config?.PITCH_MAX, 1);
  const behavior = config?.BOUNDARY_BEHAVIOR ?? BOUNDARY_BEHAVIOR.REFLECT;
  const rest = finiteOr(config?.BOUNDARY_RESTITUTION, 0.5);
  const minBounce = finiteOr(config?.BOUNDARY_MIN_BOUNCE, 0.01);

  let x = finiteOr(position?.x, 0.5);
  let y = finiteOr(position?.y, 0.5);
  let vx = finiteOr(velocity?.x, 0);
  let vy = finiteOr(velocity?.y, 0);
  const axes = [];

  const handleAxis = (axis) => {
    const lo = axis === 'x' ? x : y;
    const hi = axis === 'x' ? vx : vy;
    if (lo < min) {
      axes.push(`${axis}_min`);
      if (axis === 'x') { x = min; } else { y = min; }
      if (behavior === BOUNDARY_BEHAVIOR.REFLECT) {
        const nv = Math.abs(hi) * rest;
        if (axis === 'x') vx = nv < minBounce ? 0 : nv; else vy = nv < minBounce ? 0 : nv;
      } else if (behavior === BOUNDARY_BEHAVIOR.STOP) {
        if (axis === 'x') vx = 0; else vy = 0;
      }
    } else if (lo > max) {
      axes.push(`${axis}_max`);
      if (axis === 'x') { x = max; } else { y = max; }
      if (behavior === BOUNDARY_BEHAVIOR.REFLECT) {
        const nv = -Math.abs(hi) * rest;
        if (axis === 'x') vx = nv === 0 || Math.abs(nv) < minBounce ? 0 : nv; else vy = nv === 0 || Math.abs(nv) < minBounce ? 0 : nv;
      } else if (behavior === BOUNDARY_BEHAVIOR.STOP) {
        if (axis === 'x') vx = 0; else vy = 0;
      }
    }
  };

  handleAxis('x');
  handleAxis('y');

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