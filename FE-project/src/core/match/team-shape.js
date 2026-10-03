/**
 * Team Shape（Step 39F-M-C）。
 * 层级归属：Simulation Core / Match Tactical。**纯函数**，无副作用、无 RNG、无 MatchCore 写入。
 *
 * 链：Formation → Base Anchors → IP / OOP Shape → Ball-relative Shift → 供 Movement Intent 使用。
 * 语义（§6）：
 * - Team Shape 是 Movement 的 **上层约束**（个体目标是 anchor ± 有界偏移）。
 * - 同一球员不因 Formation 写死而钉死一点；锚点随球区 / 阶段 / 形态移动。
 * - **所有偏移有界**：不得全队追球 / 无限前压 / 无限回撤 / 结构崩塌。
 *
 * 输出为 **derived**；不写 MatchCore、不改 Schema。
 */

import { clamp01 } from './player-situation.js';
import { attackDirection } from './tactical-context.js';
import { SHAPE, SHAPE_KIND, TACTICAL_PHASE } from './movement-config.js';

const LINE_ORDER = ['GK', 'DF', 'MF', 'FW'];

/** 归一化位置组（只认 GK/DF/MF/FW；其他归 MF）。 */
function groupOf(position) {
  return LINE_ORDER.includes(position) ? position : 'MF';
}

/** 己方视角 progress → 实际 x。 */
function progressToX(dir, progress) {
  return dir === 1 ? progress : 1 - progress;
}

/** 取某队可用球员（onPitch 且未伤停）。 */
function availablePlayers(matchCore, teamId) {
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];
  return players
    .filter((p) => p.teamId === teamId && p.onPitch !== false && !p.injured && !p.sentOff)
    .sort((a, b) => String(a.playerId).localeCompare(String(b.playerId)));
}

/** Formation → 基础锚点（己方视角 progress，尚未随球偏移）。 */
function baseAnchorsByProgress(matchCore, teamId, tacticalState) {
  const dir = attackDirection(matchCore, teamId);
  const rosters = { GK: [], DF: [], MF: [], FW: [] };
  for (const p of availablePlayers(matchCore, teamId)) rosters[groupOf(p.position)].push(p);
  const margin = SHAPE.Y_MARGIN;
  const out = {};
  for (const line of LINE_ORDER) {
    const group = rosters[line];
    const n = group.length;
    if (n === 0) continue;
    for (let i = 0; i < n; i += 1) {
      const y = n === 1 ? 0.5 : margin + ((i + 1) / (n + 1)) * (1 - 2 * margin);
      out[group[i].playerId] = {
        progress: SHAPE.LINE_X[line],
        line,
        y,
        x: progressToX(dir, SHAPE.LINE_X[line]),
      };
    }
  }
  return out;
}

/**
 * 应用 IP/OOP 形态 + 宽度 / 纵深 / 防线高度。
 * @returns {{[playerId]:{progress:number,x:number,y:number,line:string}}}
 */
function applyShapeVariant(anchors, kind, tacticalState) {
  const variant = kind === SHAPE_KIND.IN_POSSESSION ? SHAPE.IP : SHAPE.OOP;
  const widthScale = SHAPE.WIDTH_SCALE[tacticalState.width] ?? 1;
  const defShift = SHAPE.DEF_LINE[tacticalState.defensiveLine] ?? 0;
  const gkLine = SHAPE.LINE_X.GK;
  const out = {};
  for (const [id, a] of Object.entries(anchors)) {
    // 宽度：围绕中线缩放。
    let y = 0.5 + (a.y - 0.5) * variant.WIDTH * widthScale;
    // 纵深：围绕 GK 线缩放后整体前移。
    let progress = gkLine + (a.progress - gkLine) * variant.DEPTH + variant.ADVANCE;
    // 防线高度：主要影响 DF，其次 MF。
    if (a.line === 'DF') progress += defShift;
    else if (a.line === 'MF') progress += defShift * 0.5;
    progress = clamp01(progress);
    y = clamp01(y);
    out[id] = { progress, x: a.x, y, line: a.line };
  }
  return out;
}

/**
 * Ball-relative shift（有界）：整体随球纵移；横向依距离有限靠近，远侧收窄（防全队追球）。
 */
function applyBallShift(matchCore, teamId, anchors, kind, context) {
  const dir = attackDirection(matchCore, teamId);
  const ballY = Number.isFinite(Number(matchCore?.ball?.position?.y)) ? Number(matchCore.ball.position.y) : 0.5;
  const ballOwnProgress = Number.isFinite(Number(context?.ballOwnProgress)) ? Number(context.ballOwnProgress) : 0.5;
  const ids = Object.keys(anchors);
  const meanProgress = ids.length
    ? ids.reduce((s, id) => s + anchors[id].progress, 0) / ids.length
    : 0.5;
  const rawDx = (ballOwnProgress - meanProgress) * SHAPE.BALL_SHIFT.X;
  const dx = Math.max(-SHAPE.BALL_SHIFT.MAX_X, Math.min(SHAPE.BALL_SHIFT.MAX_X, rawDx));
  const out = {};
  for (const id of ids) {
    const a = anchors[id];
    let progress = clamp01(a.progress + dx);
    let y = a.y;
    // 横向：越远越少动；远侧在 OOP 时向中路收窄。
    const dyRaw = (ballY - y) * SHAPE.BALL_SHIFT.Y * (1 - clamp01(Math.abs(ballY - y) / 0.5));
    const dy = Math.max(-SHAPE.BALL_SHIFT.MAX_Y, Math.min(SHAPE.BALL_SHIFT.MAX_Y, dyRaw));
    y += dy;
    if (kind === SHAPE_KIND.OUT_OF_POSSESSION && Math.abs(ballY - y) > 0.25) {
      y += (0.5 - y) * 0.06;
    }
    out[id] = {
      x: clamp01(progressToX(dir, progress)),
      y: Math.max(0.02, Math.min(0.98, y)),
      progress,
      line: a.line,
    };
  }
  return out;
}

/** 结构标量（供行为方向性测试：宽度 / 纵深 / 紧凑度 / 防线高度）。 */
function shapeMetrics(anchors) {
  const list = Object.values(anchors);
  if (list.length === 0) return { width: 0, depth: 0, compactness: 1, lineHeight: 0.5, spread: 0 };
  const width = list.reduce((s, a) => s + Math.abs(a.y - 0.5) * 2, 0) / list.length;
  const progresses = list.map((a) => a.progress);
  const depth = Math.max(...progresses) - Math.min(...progresses);
  const cx = list.reduce((s, a) => s + a.x, 0) / list.length;
  const cy = list.reduce((s, a) => s + a.y, 0) / list.length;
  const spread = list.reduce((s, a) => s + Math.hypot(a.x - cx, a.y - cy), 0) / list.length;
  const compactness = clamp01(1 - spread / 0.5);
  const lineHeight = progresses.reduce((s, v) => s + v, 0) / progresses.length;
  return {
    width: r(width), depth: r(depth), compactness: r(compactness), lineHeight: r(lineHeight), spread: r(spread),
  };
}

function r(v) { return Math.round(clamp01(v) * 1000) / 1000; }

/**
 * 构造某队 Team Shape。
 * @param {object} matchCore
 * @param {string} teamId
 * @param {object} context 该队 Tactical Context
 * @param {object} tacticalState 规范化 Tactical State
 * @returns {{teamId, kind, formation, anchors, baseAnchors, width, depth, compactness, lineHeight}}
 */
export function buildTeamShape(matchCore, teamId, context, tacticalState) {
  const kind = context?.phase === TACTICAL_PHASE.IN_POSSESSION ? SHAPE_KIND.IN_POSSESSION : SHAPE_KIND.OUT_OF_POSSESSION;
  const base = baseAnchorsByProgress(matchCore, teamId, tacticalState);
  const variant = applyShapeVariant(base, kind, tacticalState);
  const shifted = applyBallShift(matchCore, teamId, variant, kind, context);
  const anchors = {};
  const baseAnchors = {};
  for (const [id, a] of Object.entries(shifted)) {
    anchors[id] = { x: r(a.x), y: r(a.y) };
  }
  for (const [id, a] of Object.entries(base)) {
    baseAnchors[id] = { x: r(a.x), y: r(a.y) };
  }
  const metrics = shapeMetrics(shifted);
  return {
    teamId,
    kind,
    formation: tacticalState.formation,
    anchors,
    baseAnchors,
    ...metrics,
  };
}

/** 便捷：只取 anchors（供 Tactical Context 计算 shape validity）。 */
export function shapeAnchorsFor(matchCore, teamId, context, tacticalState) {
  return buildTeamShape(matchCore, teamId, context, tacticalState).anchors;
}