/**
 * Player Situation Builder（Step 39F-M-B-IMPLEMENTATION-01）。
 * 层级归属：Simulation Core / Match Decision。**只读、纯函数、无副作用、无 RNG**。
 *
 * 职责：从 `MatchCoreState`（契约见下）+ playerId 构造 **只读决策快照** `PlayerSituation`。
 * 语义：PlayerSituation **不是** MatchCoreState；只包含当前决策需要的信息；**不通过引用泄漏 MatchCore**。
 *
 * MatchCoreState 契约（本阶段为**输入契约**，非持久化结构；真实引擎落地前由调用方提供）：
 * {
 *   worldId, season, matchId, ruleVersion,
 *   teams:  { home: teamId, away: teamId },
 *   clock:  { simulationTime, matchDuration, half, status },
 *   score:  { home, away },
 *   ball:   { position:{x,y}, control:playerId|null, possessingTeamId },
 *   players: [{ playerId, teamId, position, positionOnPitch:{x,y}, onPitch, injured, sentOff,
 *               attributes:{pace,technique,passing,defending,finishing,goalkeeping},
 *               fitness, form, morale, matchLoad }],
 *   tactical: { [teamId]: { formation, mentality, tempo, pressing } }
 * }
 *
 * 红线：不读 Growth/Training/Development；不读 Team Strength；不改 MatchCore；无 Math.random。
 */

import { DECISION_RANGES, GOAL } from './decision-config.js';

/** 夹取到 [0,1]；非有限值回退 0。 */
export function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** 欧氏距离（缺坐标回退 0）。 */
export function dist(a, b) {
  const ax = Number(a?.x) || 0, ay = Number(a?.y) || 0;
  const bx = Number(b?.x) || 0, by = Number(b?.y) || 0;
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** 点到线段距离（用于传球路线评估）。 */
export function pointSegmentDistance(p, a, b) {
  const px = Number(p?.x) || 0, py = Number(p?.y) || 0;
  const ax = Number(a?.x) || 0, ay = Number(a?.y) || 0;
  const bx = Number(b?.x) || 0, by = Number(b?.y) || 0;
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 <= 1e-12) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  let t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * vx, cy = ay + t * vy;
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

/** 球员本场是否可参与（在场上、未伤、未罚下）。 */
export function isAvailable(p) {
  return !!p && p.onPitch !== false && !p.injured && !p.sentOff;
}

/** 中立坐标（缺失回退球场中心）。 */
function posOf(p) {
  const x = Number(p?.positionOnPitch?.x);
  const y = Number(p?.positionOnPitch?.y);
  return { x: Number.isFinite(x) ? x : 0.5, y: Number.isFinite(y) ? y : 0.5 };
}

/** 取中立属性值（缺失回退 50）。 */
function attrOf(p, key) {
  const v = Number(p?.attributes?.[key]);
  return Number.isFinite(v) ? v : 50;
}

/** 己方视角的对方 teamId。 */
function opponentTeamId(matchCore, teamId) {
  const h = matchCore?.teams?.home, a = matchCore?.teams?.away;
  return teamId === h ? a : h;
}

/**
 * 构造某球员的只读决策快照。
 * @param {object} matchCore
 * @param {string} playerId
 * @returns {object|null} 玩家不存在时返回 null
 */
export function buildPlayerSituation(matchCore, playerId) {
  const players = Array.isArray(matchCore?.players) ? matchCore.players : [];
  const self = players.find((p) => p.playerId === playerId);
  if (!self) return null;

  const teamId = self.teamId;
  const oppTeamId = opponentTeamId(matchCore, teamId);
  const selfPos = posOf(self);

  const teammates = players
    .filter((p) => p.teamId === teamId && p.playerId !== playerId)
    .map((p) => snapshotPlayer(p, selfPos));
  const opponents = players
    .filter((p) => p.teamId === oppTeamId)
    .map((p) => snapshotPlayer(p, selfPos));

  const ball = {
    position: {
      x: Number(matchCore?.ball?.position?.x) || 0,
      y: Number(matchCore?.ball?.position?.y) || 0,
    },
    control: matchCore?.ball?.control ?? null,
    possessingTeamId: matchCore?.ball?.possessingTeamId ?? null,
  };
  const hasBall = ball.control === playerId;
  const teamInPossession = ball.possessingTeamId == null ? null : ball.possessingTeamId === teamId;

  const tacticalState = normalizeTactical(matchCore?.tactical?.[teamId]);
  const matchContext = buildMatchContext(matchCore, self, teamId, oppTeamId, teamInPossession);
  const pressure = pressureOn(selfPos, opponents);
  const spatialContext = {
    distanceToGoal: dist(selfPos, GOAL),
    spaceAhead: spaceAhead(selfPos, opponents),
    pressure,
    nearestOpponentDistance: nearestDistance(selfPos, opponents),
  };

  return {
    playerId,
    teamId,
    ownState: {
      playerId,
      teamId,
      position: self.position ?? 'MF',
      coordinates: { x: selfPos.x, y: selfPos.y },
      hasBall,
      attributes: {
        pace: attrOf(self, 'pace'),
        technique: attrOf(self, 'technique'),
        passing: attrOf(self, 'passing'),
        defending: attrOf(self, 'defending'),
        finishing: attrOf(self, 'finishing'),
        goalkeeping: attrOf(self, 'goalkeeping'),
      },
      availability: { onPitch: self.onPitch !== false, injured: !!self.injured, sentOff: !!self.sentOff },
      // Soft State（只允许软影响，禁止用作 Hard Availability）
      soft: {
        fitness: finSoft(self.fitness, 100),
        form: finSoft(self.form, 50),
        morale: finSoft(self.morale, 50),
        matchLoad: finSoft(self.matchLoad, 0),
      },
    },
    ballState: ball,
    teammates,
    opponents,
    tacticalState,
    positionContext: { position: self.position ?? 'MF' },
    matchContext,
    spatialContext,
  };
}

/** 生成球员只读快照（新对象，不引用 MatchCore）。 */
function snapshotPlayer(p, selfPos) {
  const pos = posOf(p);
  return {
    playerId: p.playerId,
    teamId: p.teamId,
    position: p.position ?? 'MF',
    coordinates: { x: pos.x, y: pos.y },
    available: isAvailable(p),
    distanceToSelf: dist(pos, selfPos),
  };
}

/** 允许的 soft 值（0..100 归一化到 0..1；非法回退 fallback/100）。 */
function finSoft(v, fallback) {
  const n = Number(v);
  const base = Number.isFinite(n) ? n : fallback;
  return Math.min(100, Math.max(0, base)) / 100;
}

/** 战术状态规范化（缺省 balanced/medium）。 */
function normalizeTactical(t) {
  return {
    formation: t?.formation ?? '4-4-2',
    mentality: ['defensive', 'balanced', 'attacking'].includes(t?.mentality) ? t.mentality : 'balanced',
    tempo: t?.tempo ?? 'medium',
    pressing: t?.pressing ?? 'medium',
  };
}

/** 比赛上下文（派生 phase：单一来源，不新增 phase truth）。 */
function buildMatchContext(matchCore, self, teamId, oppTeamId, teamInPossession) {
  const clock = matchCore?.clock ?? {};
  const duration = Number(clock.matchDuration) || 90;
  const time = Number(clock.simulationTime) || 0;
  const scoreHome = Number(matchCore?.score?.home) || 0;
  const scoreAway = Number(matchCore?.score?.away) || 0;
  const isHome = teamId === matchCore?.teams?.home;
  const ownScore = isHome ? scoreHome : scoreAway;
  const oppScore = isHome ? scoreAway : scoreHome;
  // 派生 phase（仅基于球权；M-A-CAL：Phase = Derived）
  const phase = teamInPossession == null ? 'NEUTRAL' : (teamInPossession ? 'ATTACK' : 'DEFENSE');
  return {
    simulationTime: time,
    matchDuration: duration,
    half: Number(clock.half) || 1,
    status: clock.status ?? 'in_play',
    timeFraction: clamp01(duration > 0 ? time / duration : 0),
    score: { own: ownScore, opponent: oppScore, diff: ownScore - oppScore },
    phase,
  };
}

/** 自身受到的压迫（附近对手数 / 3，clamp01）。 */
function pressureOn(selfPos, opponents) {
  let n = 0;
  for (const o of opponents) {
    if (!o.available) continue;
    if (dist(selfPos, o.coordinates) <= DECISION_RANGES.PRESSURE_RANGE) n += 1;
  }
  return clamp01(n / 3);
}

/** 前方空间（前方区域内对手越少越大）。 */
function spaceAhead(selfPos, opponents) {
  let n = 0;
  for (const o of opponents) {
    if (!o.available) continue;
    const ahead = o.coordinates.x > selfPos.x + 0.02;
    if (ahead && Math.abs(o.coordinates.y - selfPos.y) <= 0.12) n += 1;
  }
  return clamp01(1 - n / 3);
}

/** 最近对手距离（无对手回退 1）。 */
function nearestDistance(selfPos, opponents) {
  let best = Infinity;
  for (const o of opponents) {
    if (!o.available) continue;
    const d = dist(selfPos, o.coordinates);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : 1;
}
