/**
 * Ball Facts 派生层（Step 39F-M-C-04）。
 * 层级归属：Simulation Core / Match。**只读、纯函数**，无副作用、无 RNG、无 MatchCore 写入。
 *
 * 职责（§3/§4/§5）：由 **唯一事实来源 `MatchCore.ball`** 派生 read-only / transient 的球事实，
 * 供 Tactical Context / Player Situation / Decision Geometry 只读消费。
 *
 * 语义红线：
 * - **不保存**任何球状态；每次调用都由 MatchCore.ball 重新派生（不构成第二套 Ball Truth）。
 * - **不复制**为长期状态；返回对象为一次性快照（修改快照不影响 MatchCore）。
 * - **不调用** Ball Physics；Physics 只负责先产生事实。
 * - 无 Math.random；无对 Decision 的反向依赖。
 */

function finiteOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 由 MatchCore.ball 派生只读球事实快照。 */
export function deriveBallFacts(matchCore) {
  const b = matchCore?.ball ?? {};
  const px = finiteOr(b?.position?.x, 0.5);
  const py = finiteOr(b?.position?.y, 0.5);
  const vx = finiteOr(b?.velocity?.x, 0);
  const vy = finiteOr(b?.velocity?.y, 0);
  return {
    position: { x: px, y: py },
    velocity: { x: vx, y: vy },
    speed: Math.hypot(vx, vy),
    state: b?.state ?? null,
    control: b?.control ?? null,
    possessingTeamId: b?.possessingTeamId ?? null,
    lastTouchPlayerId: b?.lastTouchPlayerId ?? null,
    inTransit: !!b?.transit,
  };
}

/** 球员速度（只读）：由 transient `matchCore.movement.players[id]` 派生（minute → second，÷60）。 */
export function playerVelocityFromMovement(matchCore, playerId) {
  const st = matchCore?.movement?.players?.[playerId];
  const p = (matchCore?.players ?? []).find((x) => x.playerId === playerId);
  if (!st || !st.target || !p) return { x: 0, y: 0 };
  const px = finiteOr(p?.positionOnPitch?.x, 0.5);
  const py = finiteOr(p?.positionOnPitch?.y, 0.5);
  const dx = finiteOr(st.target.x, px) - px;
  const dy = finiteOr(st.target.y, py) - py;
  const d = Math.hypot(dx, dy);
  if (d <= 1e-6) return { x: 0, y: 0 };
  const sp = finiteOr(st.speed, 0) / 60;
  return { x: (dx / d) * sp, y: (dy / d) * sp };
}

/**
 * 球相对某球员的只读几何事实。
 * @param {object} ballFacts deriveBallFacts 结果
 * @param {{x:number,y:number}} playerPos
 * @param {{x:number,y:number}} [playerVel]
 */
export function deriveBallRelation(ballFacts, playerPos, playerVel = { x: 0, y: 0 }) {
  const bx = finiteOr(ballFacts?.position?.x, 0.5);
  const by = finiteOr(ballFacts?.position?.y, 0.5);
  const px = finiteOr(playerPos?.x, 0.5);
  const py = finiteOr(playerPos?.y, 0.5);
  const relativePosition = { x: bx - px, y: by - py };
  const distance = Math.hypot(relativePosition.x, relativePosition.y);
  const directionToBall = distance > 1e-9
    ? { x: relativePosition.x / distance, y: relativePosition.y / distance }
    : { x: 0, y: 0 };
  const relativeVelocity = {
    x: finiteOr(ballFacts?.velocity?.x, 0) - finiteOr(playerVel?.x, 0),
    y: finiteOr(ballFacts?.velocity?.y, 0) - finiteOr(playerVel?.y, 0),
  };
  // 接近速度为「间隙收缩率」：relVel 在 directionToBall 上的投影取负。
  const closingSpeed = -(relativeVelocity.x * directionToBall.x + relativeVelocity.y * directionToBall.y);
  return {
    relativePosition,
    distance,
    directionToBall,
    relativeVelocity,
    closingSpeed,
    movingTowardPlayer: closingSpeed > 0,
    movingAwayFromPlayer: closingSpeed < 0,
    timeToArrival: closingSpeed > 1e-9 ? distance / closingSpeed : null,
  };
}