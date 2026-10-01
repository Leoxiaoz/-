/**
 * Development Derived Signals —— 共享派生原语（D39 Phase 1 / Step 39F-A）。
 * 层级归属：Simulation Core / AI。纯派生、只读、无 RNG。
 *
 * 职责：为 Playing Opportunity / Development Environment / Development Value 提供
 * **共享的 "Fit" 原语与事实读取**，避免三处重复实现同一派生逻辑。
 *
 * 红线（D39C / D39E / D39E-R）：
 * - **不读取 True Potential**：本模块不 import 任何 `potential` 访问（AI Information Boundary）。
 * - 无 `Math.random()` / `Date.now()`。
 * - 不修改 state；不写 Player Runtime；不持久化。
 * - **不新建 OVR**；线评分复用既有 `ratePlayerByLine`（player-lineup），不重写 Team Strength 四维聚合。
 *
 * 说明：Phase 1 的若干 "Fit" 组件（Position Competition / Squad Depth / Ability Gap /
 * Development Phase / Squad Structure）在 D39 冻结文本中给出了**权重**但未逐个定义公式；
 * 本模块给出**最小、可解释、仅依赖既有事实**的 Phase 1 近似定义（见每个函数注释）。
 */

import { ROSTER_CONFIG } from '../sim-config.js';
import { getClubPlayers, getClubLeague } from '../membership.js';
import { getPlayerProfile, getPlayerRuntime, INJURY_STATUS } from '../player-runtime.js';
import { ratePlayerByLine } from '../player-lineup.js';
import { ageOn } from '../date-utils.js';
import { getDevelopmentPhase, DEVELOPMENT_PHASE_SCORE } from './ai-development-phase.js';

/** 位置结构最低线（与 ROSTER_CONFIG 一致；GK 单列）。 */
const STRUCTURAL_MIN = Object.freeze({
  GK: ROSTER_CONFIG.MIN_GK,
  DF: ROSTER_CONFIG.MIN_BY_POSITION.DF,
  MF: ROSTER_CONFIG.MIN_BY_POSITION.MF,
  FW: ROSTER_CONFIG.MIN_BY_POSITION.FW,
});

/** 夹取到 [0,1]；非有限值回退 0。 */
export function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** 夹取到 [0,100]；非有限值回退 0。 */
export function clamp0100(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/** 球员周岁（无 birthDate 返回 null；确定性）。 */
export function getPlayerAge(state, playerId) {
  const profile = getPlayerProfile(state, playerId);
  if (!profile?.birthDate) return null;
  return ageOn(profile.birthDate, state.currentDate);
}

/** 某俱乐部所属联赛在本世界赛季中**已完成**的正式比赛数（由 Competition Runtime 派生，不新增字段）。 */
export function getClubCompletedMatches(state, clubId) {
  const leagueId = getClubLeague(state, clubId);
  if (!leagueId) return 0;
  const comp = state?.runtime?.competitions?.[leagueId];
  if (!comp || !Array.isArray(comp.fixtures)) return 0;
  let n = 0;
  for (const f of comp.fixtures) {
    if (f?.played && (f.homeId === clubId || f.awayId === clubId)) n += 1;
  }
  return n;
}

/**
 * Actual Minutes Score（Owner §6.2 冻结）：`clamp(seasonMinutes / max(90, completedMatches × 90), 0, 1)`。
 * 表示「截至当前赛季进度的实际出场比例」，**不预测**整季最终分钟。
 * @returns {number} 0–1
 */
export function actualMinutesScore(state, clubId, playerId) {
  const rt = getPlayerRuntime(state, playerId);
  const minutes = Number(rt?.stats?.season?.minutes) || 0;
  const completed = getClubCompletedMatches(state, clubId);
  const expected = Math.max(90, completed * 90);
  return clamp01(minutes / expected);
}

/** Availability Score（0–100）：伤病 → 0；否则取当前 fitness（既有事实）。 */
export function availabilityScore(state, playerId) {
  const rt = getPlayerRuntime(state, playerId);
  if (!rt) return 0;
  if (rt.injury?.status === INJURY_STATUS.INJURED) return 0;
  return clamp0100(Number(rt.fitness) || 0);
}

/** 某俱乐部某位置的活跃球员档案列表（确定性顺序由 getClubPlayers 保证）。 */
export function positionPlayers(state, clubId, position) {
  const out = [];
  for (const id of getClubPlayers(state, clubId)) {
    const p = getPlayerProfile(state, id);
    if (p && p.position === position) out.push(p);
  }
  return out;
}

/** 某位置的「超过结构最低线」人数（surplus）。 */
export function surplusAtPosition(state, clubId, position) {
  const count = positionPlayers(state, clubId, position).length;
  const min = STRUCTURAL_MIN[position] ?? 0;
  return Math.max(0, count - min);
}

/** 某俱乐部某位置的最佳「线评分」（排除可选 playerId）；无法计算返回 null。 */
export function bestLineRatingAtPosition(state, clubId, position, excludePlayerId = null) {
  let best = null;
  for (const p of positionPlayers(state, clubId, position)) {
    if (excludePlayerId && p.id === excludePlayerId) continue;
    const r = ratePlayerByLine(state, p, position);
    if (Number.isFinite(r) && (best === null || r > best)) best = r;
  }
  return best;
}

/** 某球员在其位置上的「线评分」（复用既有 ratePlayerByLine，不新建 OVR）。 */
export function playerLineRating(state, playerId) {
  const profile = getPlayerProfile(state, playerId);
  if (!profile) return null;
  return ratePlayerByLine(state, profile, profile.position);
}

/**
 * Position Competition Fit（Phase 1 近似，Owner 未逐个定义公式）：位置冗余越少 → 越有利于发展。
 * `clamp01(1 − surplus / 4)`（surplus 0 → 1，4+ → 0）。
 */
export function positionCompetitionFit(state, clubId, position) {
  return clamp01(1 - surplusAtPosition(state, clubId, position) / 4);
}

/**
 * Squad Depth Fit（Phase 1 近似）：阵容越深 → 俱乐部越有能力维持/培养球员。
 * `clamp01(rosterSize / MAX_PLAYERS)`。
 */
export function squadDepthFit(state, clubId) {
  return clamp01(getClubPlayers(state, clubId).length / ROSTER_CONFIG.MAX_PLAYERS);
}

/**
 * Ability Gap Fit（Phase 1 近似）：球员相对本队该位置「现有标准」的差距越大 → 成长空间越大。
 * `gap = bestLineRating(club, position, exclude self) − playerLineRating`；`clamp01(gap / 15)`。
 */
export function abilityGapFit(state, clubId, playerId) {
  const profile = getPlayerProfile(state, playerId);
  if (!profile) return 0;
  const mine = ratePlayerByLine(state, profile, profile.position);
  const best = bestLineRatingAtPosition(state, clubId, profile.position, playerId);
  const ref = Number.isFinite(best) ? best : mine;
  const gap = Math.max(0, ref - mine);
  return clamp01(gap / 15);
}

/** Development Phase Fit（Phase 1 近似）：Phase Score / 100。 */
export function developmentPhaseFit(state, playerId) {
  const age = getPlayerAge(state, playerId);
  if (age == null) return 0;
  const phase = getDevelopmentPhase(age);
  return clamp01((DEVELOPMENT_PHASE_SCORE[phase] ?? 0) / 100);
}

/**
 * Squad Structure Fit（Phase 1 近似）：位置人数越接近结构最低线 → 结构越健康。
 * `clamp01(1 − |count − structuralMin| / max(1, structuralMin))`。
 */
export function squadStructureFit(state, clubId, position) {
  const count = positionPlayers(state, clubId, position).length;
  const min = STRUCTURAL_MIN[position] ?? 1;
  return clamp01(1 - Math.abs(count - min) / Math.max(1, min));
}

/**
 * Position Need Fit（Phase 1 近似）：与 Ability Gap Fit 同源——球员低于本队该位置标准时，
 * 该位置「需要更好的人」，从而对该球员存在发展路径。复用既有能力事实，不新增 need 算法。
 */
export function positionNeedFit(state, clubId, playerId) {
  return abilityGapFit(state, clubId, playerId);
}
