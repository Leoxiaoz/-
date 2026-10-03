/**
 * Movement Target 动态解析（Step 39F-M-C）。
 * 层级归属：Simulation Core / Match Movement。**纯函数**，无副作用、无 RNG、无 MatchCore 写入。
 *
 * 语义红线（§10）：
 * - **禁止** 重新引入 `PlayerMatchState.currentTarget`；**禁止** 保存永久绝对坐标 target。
 * - Movement Target 是 **transient / derived** 的解析结果，随 Context / Shape / Intent 变化重算。
 */

import { clamp01, dist } from './player-situation.js';
import { attackDirection, ownProgress } from './tactical-context.js';
import { MOVEMENT_INTENT as MI, TARGET_KIND, INTENT_TARGET } from './movement-config.js';

/** 取锚点（缺失则回退球员当前位置，再回退中场）。 */
function anchorOf(player, shape) {
  const a = shape?.anchors?.[player?.playerId];
  if (a && Number.isFinite(a.x) && Number.isFinite(a.y)) return { x: a.x, y: a.y };
  const px = Number(player?.positionOnPitch?.x), py = Number(player?.positionOnPitch?.y);
  if (Number.isFinite(px) && Number.isFinite(py)) return { x: px, y: py };
  return { x: 0.5, y: 0.5 };
}

/** 在「己方视角 progress」上施加纵向偏移，再转回实际 x。 */
function forward(matchCore, teamId, anchorX, deltaProgress, y) {
  const dir = attackDirection(matchCore, teamId);
  const progress = clamp01(ownProgress(matchCore, teamId, anchorX) + deltaProgress);
  const x = clamp01(dir === 1 ? progress : 1 - progress);
  return { x, y: clamp01(y) };
}

/** 场上最近对手位置（无则返回球位）。 */
function nearestOpponentPos(matchCore, player, oppTeamId) {
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];
  const px = Number(player?.positionOnPitch?.x), py = Number(player?.positionOnPitch?.y);
  let best = null; let bestD = Infinity;
  for (const o of players) {
    if (o.teamId !== oppTeamId) continue;
    if (o.onPitch === false || o.injured || o.sentOff) continue;
    const ox = Number(o?.positionOnPitch?.x), oy = Number(o?.positionOnPitch?.y);
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
    const d = (Number.isFinite(px) && Number.isFinite(py)) ? dist({ x: px, y: py }, { x: ox, y: oy }) : 1;
    if (d < bestD) { bestD = d; best = { x: ox, y: oy }; }
  }
  return best;
}

/**
 * 解析某球员当前 Movement Intent 对应的 Movement Target。
 * @param {{intent:string, player:object, shape:object, context:object, tacticalState:object, matchCore:object}} args
 * @returns {{kind:string, x:number, y:number}}
 */
export function resolveMovementTarget({ intent, player, shape, context, tacticalState, matchCore }) {
  const teamId = context.teamId;
  const dir = attackDirection(matchCore, teamId);
  const a = anchorOf(player, shape);
  const ballX = Number(matchCore?.ball?.position?.x), ballY = Number(matchCore?.ball?.position?.y);
  const ball = { x: Number.isFinite(ballX) ? ballX : 0.5, y: Number.isFinite(ballY) ? ballY : 0.5 };
  const round = (p) => ({ ...p, x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 });

  switch (intent) {
    case MI.SUPPORT:
      return round({ kind: TARGET_KIND.BALL_RELATIVE, x: a.x + (ball.x - a.x) * INTENT_TARGET.SUPPORT_PULL, y: a.y + (ball.y - a.y) * INTENT_TARGET.SUPPORT_PULL });
    case MI.OFFER:
      return round({ kind: TARGET_KIND.BALL_RELATIVE, x: a.x + (ball.x - a.x) * INTENT_TARGET.OFFER_PULL, y: a.y + (ball.y - a.y) * INTENT_TARGET.OFFER_PULL });
    case MI.RUN_FORWARD:
      return round({ kind: TARGET_KIND.SPACE, ...forward(matchCore, teamId, a.x, INTENT_TARGET.ADVANCE, a.y) });
    case MI.RUN_BEHIND:
      return round({ kind: TARGET_KIND.SPACE, ...forward(matchCore, teamId, a.x, INTENT_TARGET.RUN_BEHIND, a.y) });
    case MI.ATTACK_SPACE:
      return round({ kind: TARGET_KIND.SPACE, ...forward(matchCore, teamId, a.x, INTENT_TARGET.ADVANCE, a.y) });
    case MI.CREATE_SPACE: {
      const away = a.y >= ball.y ? 1 : -1;
      return round({ kind: TARGET_KIND.SPACE, ...forward(matchCore, teamId, a.x, INTENT_TARGET.ADVANCE * 0.5, clamp01(a.y + away * INTENT_TARGET.WIDEN)) });
    }
    case MI.WIDEN: {
      const outward = a.y >= 0.5 ? 1 : -1;
      return round({ kind: TARGET_KIND.SPACE, x: a.x, y: clamp01(a.y + outward * INTENT_TARGET.WIDEN) });
    }
    case MI.NARROW:
      return round({ kind: TARGET_KIND.SPACE, x: a.x, y: clamp01(a.y + (0.5 - a.y) * (INTENT_TARGET.NARROW / Math.max(0.06, Math.abs(a.y - 0.5) || 0.06))) });
    case MI.DROP:
      return round({ kind: TARGET_KIND.SPACE, ...forward(matchCore, teamId, a.x, -INTENT_TARGET.DROP, a.y) });
    case MI.STEP_UP:
      return round({ kind: TARGET_KIND.SPACE, ...forward(matchCore, teamId, a.x, INTENT_TARGET.STEP_UP, a.y) });
    case MI.MARK: {
      const opp = nearestOpponentPos(matchCore, player, context.opponentTeamId);
      if (!opp) return round({ kind: TARGET_KIND.ANCHOR, ...a });
      return round({ kind: TARGET_KIND.OPPONENT_RELATIVE, x: clamp01(opp.x + dir * INTENT_TARGET.MARK_GAP), y: clamp01(opp.y) });
    }
    case MI.PRESS_MOVE:
    case MI.CHASE:
      return round({ kind: TARGET_KIND.OPPONENT_RELATIVE, x: ball.x, y: ball.y });
    case MI.HOLD_POSITION:
    case MI.COVER:
    case MI.RECOVER_SHAPE:
    default:
      return round({ kind: TARGET_KIND.ANCHOR, ...a });
  }
}