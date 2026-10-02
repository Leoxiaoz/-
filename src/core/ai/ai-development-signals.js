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
import { estimateHeadroomScore } from './ai-potential-estimate.js';
import { AI_SELECTION_DEVELOPMENT_CONFIG } from './ai-config.js';

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

// =====================================================================================
// Step 39F-G — AI Selection: B2 Marginal Starter Cutoff + C2 Bounded Effective Score
// （D-42 / OD-39FG-DECISION-2 已冻结结构；参数为 temporary calibration defaults）
// =====================================================================================

/** 通用数值夹取（非有限值回退 min）。 */
function clampRange(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * B2 — Marginal Starter Cutoff（[已定 结构]）。
 * 输入 **降序** 的 line rating 列表与该 position 的 slot 数；
 * 返回第 `slotCount` 名（0-based: index slotCount−1）的 rating 作为“首发竞争线”；
 * 若候选人数 ≤ slotCount（所有人都是首发候选）→ 返回 `null`（此后 gap 恒为 0）。
 * @returns {number|null}
 */
export function marginalStarterCutoff(sortedRatingsDesc, slotCount) {
  const slot = Math.max(1, Math.floor(Number(slotCount) || 1));
  if (!Array.isArray(sortedRatingsDesc) || sortedRatingsDesc.length <= slot) return null;
  const value = Number(sortedRatingsDesc[slot - 1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Development Proximity（[已定 结构]）：`max(0, 1 − gap / scale)`，clamp 到 [0,1]。
 * gap ≤ 0 → 1；gap ≥ scale → 0。
 * @returns {number} 0–1
 */
export function developmentProximity(competitiveGap, distanceScale) {
  const gap = Number(competitiveGap);
  if (!Number.isFinite(gap) || gap <= 0) return 1;
  const scale = Number(distanceScale);
  if (!Number.isFinite(scale) || scale <= 0) return 0;
  return clamp01(1 - gap / scale);
}

/**
 * Bounded Development Influence（[已定 结构]）：`clamp(priority × proximity × cap, 0, cap)`。
 * priority 或 proximity 为 0 ⇒ influence = 0。cap 直接界定最大可翻转 rating gap。
 * @returns {number} 0–cap
 */
export function boundedDevelopmentInfluence(priority, proximity, cap) {
  const p = clamp01(priority);
  const q = clamp01(proximity);
  const c = Math.max(0, Number(cap) || 0);
  return clampRange(Math.min(c, p * q * c), 0, c);
}

/**
 * C2 — Effective Competitive Score（[已定 结构]）：`currentRating + boundedInfluence`。
 * @returns {number}
 */
export function effectiveCompetitiveScore(currentRating, boundedInfluence) {
  const r = Number(currentRating) || 0;
  return r + Math.max(0, Number(boundedInfluence) || 0);
}

/**
 * Selection-oriented Development Priority（[PROPOSED] 派生；forward-looking，不读 True Potential）。
 * `priority = clamp01( phaseGate(age) × headroom(estimated) × personalityMod )`。
 * - headroom 来自 AI Potential Estimator（Estimated Potential，非 True Potential）。
 * - **不使用** retrospective minutes / Playing Opportunity（避免自我强化）。
 * - 纯派生、无 RNG、deterministic。
 * @returns {number} 0–1
 */
export function selectionDevelopmentPriority(state, clubId, playerId) {
  const cfg = AI_SELECTION_DEVELOPMENT_CONFIG;
  if (!cfg.ENABLED) return 0;
  const profile = getPlayerProfile(state, playerId);
  if (!profile) return 0;
  const age = getPlayerAge(state, playerId);
  const phase = getDevelopmentPhase(age);
  const gate = Number(cfg.PHASE_GATE[phase]);
  if (!Number.isFinite(gate) || gate <= 0) return 0;
  const headroom = clamp01(estimateHeadroomScore(state, clubId, playerId) / 100);
  const pers = profile.personality ?? {};
  let sum = 0;
  let n = 0;
  for (const key of ['professionalism', 'determination', 'ambition']) {
    const v = Number(pers[key]);
    sum += Number.isFinite(v) ? clampRange(v, 1, 99) : 50;
    n += 1;
  }
  const persNorm = clamp01((sum / n - 1) / 98);
  const mod = cfg.PERSONALITY_FLOOR + cfg.PERSONALITY_RANGE * persNorm;
  return clamp01(gate * headroom * mod);
}

/**
 * 对**同一 position line** 的候选做 development-aware 排序（纯函数）。
 * 输入候选：`{ playerId, rating, priority ∈[0,1] }`。
 * 输出按 `effectiveCompetitiveScore DESC → rating DESC → playerId ASC` 排序的评分明细。
 * 保证：priority 全 0 ⇒ 退化为 `rating DESC, playerId ASC`（regression anchor）。
 * @returns {Array<{playerId:string, rating:number, gap:number, proximity:number,
 *                  priority:number, influence:number, effective:number}>}
 */
export function rankLineCandidates(candidates, options = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const slotCount = options.slotCount;
  const distanceScale = options.distanceScale;
  const cap = options.cap;
  const sorted = list.map((c) => Number(c.rating) || 0).sort((a, b) => b - a);
  const cutoff = marginalStarterCutoff(sorted, slotCount);
  const scored = list.map((c) => {
    const rating = Number(c.rating) || 0;
    const gap = cutoff == null ? 0 : Math.max(0, cutoff - rating);
    const proximity = developmentProximity(gap, distanceScale);
    const priority = clamp01(c.priority);
    const influence = boundedDevelopmentInfluence(priority, proximity, cap);
    return { playerId: c.playerId, rating, gap, proximity, priority, influence, effective: effectiveCompetitiveScore(rating, influence) };
  });
  scored.sort((a, b) => (
    b.effective - a.effective
    || b.rating - a.rating
    || a.playerId.localeCompare(b.playerId)
  ));
  return scored;
}
