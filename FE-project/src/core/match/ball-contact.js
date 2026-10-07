/**
 * Ball Contact Geometry（Step 39F-M-C-03）。
 * 层级归属：Simulation Core / Match Ball Physics。**纯几何、纯函数、无 RNG、无副作用**。
 *
 * 职责（§6/§9）：提供球员↔球的接触几何 —— 离散接触 + swept（线段）接触，用于防 tunneling。
 * 语义：本层**只回答几何问题**（是否接触 / 距离 / 法向 / 相对位置），
 *       **不判定** 抢断 / 盘带 / 传球 / 射门 / 犯规 —— 那些属于未来足球语义 Resolution。
 */

import { pointSegmentDistance } from './player-situation.js';

function finiteOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

/** 取球员坐标（兼容 `position` / `positionOnPitch`）。 */
function posOf(player) {
  const src = player?.position ?? player?.positionOnPitch ?? player ?? {};
  return { x: finiteOr(src.x, 0.5), y: finiteOr(src.y, 0.5) };
}

/**
 * 离散接触几何：球当前位置 vs 球员。
 * @returns {{isContact:boolean, playerId:(string|null), distance:number, contactNormal:{x:number,y:number}}}
 */
export function computeBallContact(ballPos, player, radius) {
  const b = { x: finiteOr(ballPos?.x, 0.5), y: finiteOr(ballPos?.y, 0.5) };
  const p = posOf(player);
  const dx = b.x - p.x, dy = b.y - p.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const isContact = d <= finiteOr(radius, 0);
  let n = { x: 1, y: 0 };
  if (d > 1e-9) n = { x: dx / d, y: dy / d };
  return { isContact, playerId: player?.playerId ?? null, distance: d, contactNormal: n };
}

/**
 * Swept 接触几何：球从 `from` 移动到 `to` 的线段 vs 球员（防高速穿越 / tunneling）。
 * 返回线段上最近点对应的接触法向与参数 t∈[0,1]。
 * @returns {{isContact:boolean, playerId:(string|null), distance:number, contactNormal:{x:number,y:number}, t:number, point:{x:number,y:number}}}
 */
export function sweptBallContact(from, to, player, radius) {
  const fx = finiteOr(from?.x, 0.5), fy = finiteOr(from?.y, 0.5);
  const tx = finiteOr(to?.x, fx), ty = finiteOr(to?.y, fy);
  const p = posOf(player);
  const vx = tx - fx, vy = ty - fy;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 1e-12 ? ((p.x - fx) * vx + (p.y - fy) * vy) / len2 : 0;
  t = clamp01(t);
  const cx = fx + t * vx, cy = fy + t * vy;
  const dist = pointSegmentDistance(p, { x: fx, y: fy }, { x: tx, y: ty });
  const dx = cx - p.x, dy = cy - p.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const isContact = dist <= finiteOr(radius, 0);
  let n = { x: 1, y: 0 };
  if (d > 1e-9) n = { x: dx / d, y: dy / d };
  return { isContact, playerId: player?.playerId ?? null, distance: dist, contactNormal: n, t, point: { x: cx, y: cy } };
}