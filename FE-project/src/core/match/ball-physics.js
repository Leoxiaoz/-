/**
 * Ball Physics / Step（Step 39F-M-C-03）。
 * 层级归属：Simulation Core / Match Ball Physics。**纯函数核心**（不原地 mutate 输入）。
 *
 * 职责（§4/§5/§7/§8/§9/§11/§16）：
 * - 球作为**独立连续运动实体**：`position += velocity * dt`，由摩擦 / 边界 / 接触推进。
 * - 摩擦减速、停止阈值、速度 clamp、finite 保护、边界处理、子步 + swept 防 tunneling。
 * - 球员↔球接触：**真实改变球运动状态**（法向相对速度反射 + 切向保留），而非仅改 owner。
 * - 接触窗口（contacting）：防止同一接触每 tick 无限叠加 impulse / 粘球。
 *
 * 反面（明确禁止）：
 * - 不做 `targetPosition` 路线跟随动画；
 * - 不自动把 Contact 变成正式 possession transfer；
 * - 不判定抢断 / 盘带 / 传球 / 射门 / 犯规（属未来 Resolution）；
 * - 不写 Score / Stats / Event / Growth / Training / Save；不接 Production Loop / Decision。
 *
 * 时间单位：`simulation seconds`（见 ball-physics-config.js）。**禁止 Math.random**。
 */

import {
  BALL_PHYSICS_CONFIG, BALL_STATE, BALL_BOUNDARY, CONTACT_TYPE,
} from './ball-physics-config.js';
import { computeBallContact, sweptBallContact } from './ball-contact.js';
import { resolveBallBoundary } from './ball-boundary.js';

function finiteOr(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampNum(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function speedOf(v) {
  return Math.hypot(finiteOr(v?.x, 0), finiteOr(v?.y, 0));
}

function clampVelocity(v, config) {
  const s = speedOf(v);
  const max = finiteOr(config?.MAX_SPEED, 1.2);
  if (s <= max || s <= 1e-12) return { x: finiteOr(v?.x, 0), y: finiteOr(v?.y, 0) };
  const k = max / s;
  return { x: finiteOr(v?.x, 0) * k, y: finiteOr(v?.y, 0) * k };
}

/** 规范化 BallState：保证 finite、边界内、状态合法、contacting 为有序唯一数组。不 mutate 输入。 */
export function sanitizeBall(ball, config = BALL_PHYSICS_CONFIG) {
  const min = finiteOr(config?.PITCH_MIN, 0);
  const max = finiteOr(config?.PITCH_MAX, 1);
  const p = { x: finiteOr(ball?.position?.x, 0.5), y: finiteOr(ball?.position?.y, 0.5) };
  const state = Object.values(BALL_STATE).includes(ball?.state) ? ball.state : BALL_STATE.FREE;
  const contacting = Array.isArray(ball?.contacting)
    ? Array.from(new Set(ball.contacting.filter((id) => typeof id === 'string'))).sort()
    : [];
  const out = {
    position: { x: clampNum(p.x, min, max), y: clampNum(p.y, min, max) },
    velocity: clampVelocity(ball?.velocity, config),
    state,
    control: ball?.control ?? null,
    possessingTeamId: ball?.possessingTeamId ?? null,
    lastTouchPlayerId: ball?.lastTouchPlayerId ?? null,
    contacting,
  };
  if (ball && 'transit' in ball) out.transit = ball.transit;
  return out;
}

/**
 * 由既有 PASS / SHOT transit metadata 派生初始速度（**兼容消费**，不重写 Resolution）。
 * speed = |to-from| / duration；方向 = (to-from)/|to-from|。
 */
export function velocityFromTransit(transit, config = BALL_PHYSICS_CONFIG) {
  void config;
  const from = transit?.from, to = transit?.to;
  const duration = finiteOr(transit?.duration, 0);
  if (!from || !to || !(duration > 0)) return { x: 0, y: 0 };
  const dx = finiteOr(to.x, from.x) - finiteOr(from.x, 0);
  const dy = finiteOr(to.y, from.y) - finiteOr(from.y, 0);
  const d = Math.hypot(dx, dy);
  if (d <= 1e-9) return { x: 0, y: 0 };
  const s = d / duration;
  return { x: (dx / d) * s, y: (dy / d) * s };
}

/** 以给定速度播种球（返回新 BallState，不 mutate 输入）。 */
export function seedBallVelocity(ball, velocity, config = BALL_PHYSICS_CONFIG) {
  const b = sanitizeBall(ball, config);
  return { ...b, velocity: clampVelocity(velocity, config) };
}

/** 相对速度沿法向的符号分类（仅用于解释性 contactType）。 */
function classifyContact(normal, playerVel) {
  const approach = finiteOr(playerVel?.x, 0) * normal.x + finiteOr(playerVel?.y, 0) * normal.y;
  return approach > 0 ? CONTACT_TYPE.PLAYER_TO_BALL : CONTACT_TYPE.BALL_TO_PLAYER;
}

/**
 * 推进一个物理 tick。
 * @param {object} ball BallState（含 position/velocity/state/contacting/...）
 * @param {number} dt simulation seconds（非有限 / <=0 视为 0）
 * @param {{players?:Array, config?:object}} [options]
 *        players: [{ playerId, position:{x,y}, velocity:{x,y} }]
 * @returns {{ball:object, contacts:Array, boundary:object, events:Array, substeps:number}}
 */
export function stepBallPhysics(ball, dt, options = {}) {
  const config = options.config ?? BALL_PHYSICS_CONFIG;
  const players = Array.isArray(options.players) ? options.players : [];
  const b = sanitizeBall(ball, config);
  const events = [];
  const noBoundary = { result: BALL_BOUNDARY.IN_BOUNDS, axes: [] };

  // CONTROLLED / GOAL：球被持有或已死球 —— 物理不推进（避免与未来 Dribble 争夺 Position Truth）。
  if (b.state === BALL_STATE.CONTROLLED || b.state === BALL_STATE.GOAL) {
    return { ball: { ...b, velocity: { x: 0, y: 0 } }, contacts: [], boundary: noBoundary, events, substeps: 0 };
  }

  const stepDt = finiteOr(dt, 0);
  if (!(stepDt > 0)) {
    return { ball: b, contacts: [], boundary: noBoundary, events, substeps: 0 };
  }

  const radius = finiteOr(config.CONTACT_RADIUS, 0.03);
  const orderedPlayers = players
    .filter((p) => p && typeof p.playerId === 'string')
    .slice()
    .sort((a, z) => (a.playerId < z.playerId ? -1 : a.playerId > z.playerId ? 1 : 0));

  // 子步数：按当前速度与允许子步位移计算，clamp 到 [1, MAX_SUBSTEPS]。
  const maxTravel = Math.max(1e-9, radius * finiteOr(config.SUBSTEP_TRAVEL_RATIO, 0.5));
  const rawSub = Math.ceil((speedOf(b.velocity) * stepDt) / maxTravel);
  const substeps = clampNum(Number.isFinite(rawSub) ? rawSub : 1, 1, finiteOr(config.MAX_SUBSTEPS, 8));
  const sdt = stepDt / substeps;

  let pos = { ...b.position };
  let vel = { ...b.velocity };
  const contacting = new Set(b.contacting);
  let lastTouch = b.lastTouchPlayerId ?? null;
  const contacts = [];
  let boundary = noBoundary;

  for (let step = 0; step < substeps; step += 1) {
    // 1) 摩擦（半隐式：先更新速度再积分）
    const sp = speedOf(vel);
    if (sp > 0) {
      let ns = sp - finiteOr(config.FRICTION, 0) * sdt;
      if (!(ns > config.STOP_THRESHOLD)) ns = 0;
      const k = ns > 0 ? ns / sp : 0;
      vel = { x: vel.x * k, y: vel.y * k };
    }

    const from = { ...pos };
    const to = { x: pos.x + vel.x * sdt, y: pos.y + vel.y * sdt };
    const moving = speedOf(vel) > 0;

    // 2) 找最早接触（swept 防 tunneling；静止球退化为离散检测）
    let hit = null;
    for (const pl of orderedPlayers) {
      const c = moving
        ? sweptBallContact(from, to, pl, radius)
        : computeBallContact(from, pl, radius);
      if (!c.isContact) continue;
      const t = moving ? c.t : 0;
      if (!hit || t < hit.t - 1e-12 || (Math.abs(t - hit.t) <= 1e-12 && c.playerId < hit.playerId)) {
        hit = { t, contact: c, player: pl };
      }
    }

    if (hit) {
      const c = hit.contact;
      const n = c.contactNormal;
      const pv = { x: finiteOr(hit.player.velocity?.x, 0), y: finiteOr(hit.player.velocity?.y, 0) };
      const pp = hit.player.position ?? hit.player.positionOnPitch ?? { x: 0.5, y: 0.5 };
      // 位置：落在接触点并去穿透到交互半径处
      pos = {
        x: finiteOr(pp.x, 0.5) + n.x * radius,
        y: finiteOr(pp.y, 0.5) + n.y * radius,
      };
      const already = contacting.has(hit.player.playerId);
      if (!already) {
        contacting.add(hit.player.playerId);
        lastTouch = hit.player.playerId;
        const vRel = { x: vel.x - pv.x, y: vel.y - pv.y };
        const vRelN = vRel.x * n.x + vRel.y * n.y;
        if (vRelN < 0) {
          // 逼近：反射法向相对速度 + 保留切向（地面摩擦式）
          const vRelT = { x: vRel.x - vRelN * n.x, y: vRel.y - vRelN * n.y };
          const newN = -finiteOr(config.CONTACT_RESTITUTION, 0.55) * vRelN;
          const retain = finiteOr(config.CONTACT_TANGENT_RETENTION, 0.85);
          vel = {
            x: pv.x + n.x * newN + vRelT.x * retain,
            y: pv.y + n.y * newN + vRelT.y * retain,
          };
        }
        contacts.push({
          playerId: hit.player.playerId,
          distance: c.distance,
          contactNormal: n,
          contactType: classifyContact(n, pv),
        });
        events.push({ type: 'BALL_CONTACT', playerId: hit.player.playerId, contactType: classifyContact(n, pv) });
      } else {
        contacts.push({
          playerId: hit.player.playerId,
          distance: c.distance,
          contactNormal: n,
          contactType: CONTACT_TYPE.CONTINUING,
        });
      }
      pos = { x: clampNum(pos.x, config.PITCH_MIN, config.PITCH_MAX), y: clampNum(pos.y, config.PITCH_MIN, config.PITCH_MAX) };
      vel = clampVelocity(vel, config);
      if (speedOf(vel) <= config.STOP_THRESHOLD) vel = { x: 0, y: 0 };
      continue; // 本子步已因接触提前终止
    }

    // 3) 无接触：推进并按边界结算
    pos = to;
    const br = resolveBallBoundary(pos, vel, config);
    pos = br.position;
    vel = br.velocity;
    if (br.boundary.result !== BALL_BOUNDARY.IN_BOUNDS) {
      boundary = br.boundary;
      events.push({ type: 'BOUNDARY_CONTACT', axes: br.boundary.axes });
    }
    vel = clampVelocity(vel, config);
    if (speedOf(vel) <= config.STOP_THRESHOLD) vel = { x: 0, y: 0 };
  }

  // 4) 交互窗口清理：已脱离（> radius × hysteresis）的球员移出窗口
  const keep = radius * finiteOr(config.CONTACT_HYSTERESIS, 1.15);
  for (const id of Array.from(contacting)) {
    const pl = orderedPlayers.find((p) => p.playerId === id);
    if (!pl) { contacting.delete(id); continue; }
    const d = computeBallContact(pos, pl, keep).distance;
    if (d > keep) contacting.delete(id);
  }

  const outBall = {
    ...b,
    position: { x: clampNum(pos.x, config.PITCH_MIN, config.PITCH_MAX), y: clampNum(pos.y, config.PITCH_MIN, config.PITCH_MAX) },
    velocity: clampVelocity(vel, config),
    contacting: Array.from(contacting).sort(),
    lastTouchPlayerId: lastTouch,
  };
  if (speedOf(outBall.velocity) <= config.STOP_THRESHOLD) outBall.velocity = { x: 0, y: 0 };
  if (speedOf(outBall.velocity) === 0 && events.length === 0) events.push({ type: 'BALL_AT_REST', playerId: null });

  return { ball: outBall, contacts, boundary, events, substeps };
}

/**
 * 从 MatchCore 提取球员运动列表（只读）。
 * 球员速度由 transient `matchCore.movement.players[id]`（intent target + speed）派生；
 * movement 时间单位为 simulation minute，此处换算为 second（÷60）。缺失则速度 0。
 */
export function playerMotionList(matchCore) {
  const mov = matchCore?.movement?.players ?? {};
  const out = [];
  for (const p of (matchCore?.players ?? [])) {
    const st = mov[p.playerId];
    const px = finiteOr(p?.positionOnPitch?.x, 0.5);
    const py = finiteOr(p?.positionOnPitch?.y, 0.5);
    let vx = 0, vy = 0;
    if (st && st.target) {
      const dx = finiteOr(st.target.x, px) - px;
      const dy = finiteOr(st.target.y, py) - py;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) {
        const sp = finiteOr(st.speed, 0) / 60; // minute → second
        vx = (dx / d) * sp;
        vy = (dy / d) * sp;
      }
    }
    out.push({ playerId: p.playerId, position: { x: px, y: py }, velocity: { x: vx, y: vy } });
  }
  return out;
}

/**
 * MatchCore 级 Ball Physics 编排：**只改 `ball`**，其余顶层字段不变。
 * - 若球为 IN_TRANSIT 且尚无 velocity，则从既有 transit metadata 派生初始速度（兼容消费）。
 * - 本函数**不接 Production Loop**；仅供 Headless Harness / Unit Test 使用。
 * @returns {object} 新的 matchCore
 */
export function stepMatchBall(matchCore, dt, options = {}) {
  if (!matchCore || !matchCore.ball) return matchCore;
  let ball = matchCore.ball;
  if (ball.state === BALL_STATE.IN_TRANSIT && !ball.velocity && ball.transit) {
    ball = { ...ball, velocity: velocityFromTransit(ball.transit, options.config) };
  }
  const players = options.players ?? playerMotionList(matchCore);
  const res = stepBallPhysics(ball, dt, { ...options, players });
  return { ...matchCore, ball: res.ball };
}