/**
 * Locomotion MVP（Step 39F-M-C）。
 * 层级归属：Simulation Core / Match Movement。**纯函数**，无副作用、无 RNG、无 MatchCore 写入。
 *
 * 语义（§11/§12）：
 * - 最小模型：`position + movementIntent + movementTarget + speed + elapsedTime`。
 * - 暂不引入 velocity / acceleration / orientation / height / collision。
 * - 不瞬移、不抖动、不越界、无 NaN / Infinity。
 * - speed 为 **bounded**：pace / urgency / 球邻近 / fitness 只影响移动能力，**不影响 Resolution**。
 */

import { clamp01, dist } from './player-situation.js';
import { LOCOMOTION, INTENT_URGENCY, PITCH_BOUNDS } from './movement-config.js';

/** 有限数保护。 */
function finiteOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 计算 bounded 移动速度（归一化单位 / simulation minute）。
 * @param {{player:object, intent:string, matchCore:object}} args
 * @returns {number}
 */
export function computeMovementSpeed({ player, intent, matchCore }) {
  const pace = finiteOr(player?.attributes?.pace, LOCOMOTION.PACE_REFERENCE);
  const paceFactor = Math.max(-1, Math.min(1, (pace - LOCOMOTION.PACE_REFERENCE) / (LOCOMOTION.PACE_REFERENCE * LOCOMOTION.PACE_SPAN)));
  const urgency = INTENT_URGENCY[intent] ?? 0.5;
  const fitness = finiteOr(player?.fitness, 100);
  const fitnessFactor = clamp01(fitness / 100) * 2 - 1; // [-1,1]
  const bx = Number(matchCore?.ball?.position?.x), by = Number(matchCore?.ball?.position?.y);
  const px = Number(player?.positionOnPitch?.x), py = Number(player?.positionOnPitch?.y);
  let prox = 0.5;
  if (Number.isFinite(bx) && Number.isFinite(by) && Number.isFinite(px) && Number.isFinite(py)) {
    prox = 1 - clamp01(dist({ x: px, y: py }, { x: bx, y: by }) / LOCOMOTION.BALL_PROXIMITY_RANGE);
  } else {
    prox = 0.5;
  }
  const w = LOCOMOTION.WEIGHTS;
  const multiplier = 1
    + w.PACE * paceFactor
    + w.URGENCY * (urgency * 2 - 1)
    + w.BALL_PROXIMITY * (prox * 2 - 1)
    + w.FITNESS * fitnessFactor;
  const raw = LOCOMOTION.BASE_SPEED * Math.max(0.1, multiplier);
  return Math.max(LOCOMOTION.MIN_SPEED, Math.min(LOCOMOTION.MAX_SPEED, raw));
}

/**
 * 朝 target 前进一个 dt。
 * @param {{x:number,y:number}} position
 * @param {{x:number,y:number}} target
 * @param {number} speed 归一化单位 / minute
 * @param {number} dt simulation minutes
 * @returns {{position:{x:number,y:number}, distance:number, moved:number, arrived:boolean}}
 */
export function stepLocomotion(position, target, speed, dt) {
  const px = finiteOr(position?.x, 0.5), py = finiteOr(position?.y, 0.5);
  const tx = finiteOr(target?.x, px), ty = finiteOr(target?.y, py);
  const sp = Math.max(0, finiteOr(speed, 0));
  const step = sp * Math.max(0, finiteOr(dt, 0));
  const dx = tx - px, dy = ty - py;
  const total = Math.hypot(dx, dy);

  if (total <= LOCOMOTION.ARRIVE_RADIUS) {
    return {
      position: { x: clamp01(tx), y: clamp01(ty) },
      distance: 0,
      moved: total,
      arrived: true,
    };
  }
  if (!(step > 0)) {
    return { position: { x: clamp01(px), y: clamp01(py) }, distance: total, moved: 0, arrived: false };
  }
  const travel = Math.min(step, total);
  const ratio = travel / total;
  const nx = px + dx * ratio;
  const ny = py + dy * ratio;
  const arrived = total - travel <= LOCOMOTION.ARRIVE_RADIUS;
  return {
    position: {
      x: clamp01(arrived ? tx : nx),
      y: clamp01(arrived ? ty : ny),
    },
    distance: Math.max(0, total - travel),
    moved: travel,
    arrived,
  };
}