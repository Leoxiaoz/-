/**
 * Relative Role Load —— Step 39F-J-B（D-39FJ-B CAL-FREEZE 实现）。
 * 层级归属：Simulation Core / AI。**纯派生、只读、无副作用、无 RNG、不持久化**。
 *
 * 语义：回答「该球员本赛季承担的实际比赛暴露，相对赛季开始时由阵容结构推导出的
 * 角色暴露，是否明显超额？」
 *   Expected Participation（season-boundary，由阵容结构派生）
 *   Actual Participation（完赛赛季 minutes / 球队完赛比赛分钟）
 *   Relative Load = max(0, actual − upperBound)（R5 range-excess）
 *
 * 红线：
 * - **不读取** actual minutes / appearances / 上一季数据来推导 expected。
 * - **不读取** selectionDevelopmentPriority / Training output / Growth output。
 * - 不读取 fitness / form / morale。不新增 persistence / save / schema 字段。
 * - 不修改 Growth / 39F-G / 39F-H / Injury / Match；不改 formation/tactics。
 * - 只读「完赛赛季名册」（season boundary 时 lifecycle / transfer / newgen 之前）。
 */

import { getPlayerProfile, getPlayerRuntime } from '../player-runtime.js';
import { getClubPlayers } from '../membership.js';
import { formationSlots } from '../player-lineup.js';
import {
  playerLineRating,
  surplusAtPosition,
  getTeamAvailableMatches,
} from './ai-development-signals.js';
import { AI_RELATIVE_ROLE_LOAD_CONFIG as C } from './ai-config.js';

const CLS = C.CLASSIFICATION;

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** 阵型某线首发 slot 数（GK 恒 1）。 */
function lineSlotCount(state, clubId, position) {
  if (position === 'GK') return 1;
  const club = state?.runtime?.clubs?.[clubId];
  const slots = formationSlots(club?.tactics?.formation);
  return slots.find((s) => s.position === position)?.count ?? 0;
}

/**
 * Rotation 名额 K（FROZEN）：`clamp(min(surplusAtPosition, slotCount), 0, K_CAP)`。
 * `surplusAtPosition` = 结构性 headcount surplus（非 rotationCount / 非 minutes）。
 * @returns {number} 0–3
 */
export function getRotationK(state, clubId, position) {
  if (position === 'GK') return 0;
  const slotCount = lineSlotCount(state, clubId, position);
  const surplus = surplusAtPosition(state, clubId, position);
  return Math.max(0, Math.min(C.K_CAP, Math.min(surplus, slotCount)));
}

/**
 * 运行期派生 Expected Role（不持久化）。
 * 同位置线使用**完整名册**（不因伤病/停赛过滤），按纯 line rating 降序（`playerId ASC` tie-break）。
 * @returns {{role:string, rank:number, position:string, slotCount:number, K:number}|null}
 *   role ∈ STARTER | ROTATION | BENCH | GK1 | GK2 | GK3
 */
export function deriveExpectedRole(state, clubId, playerId) {
  const profile = getPlayerProfile(state, playerId);
  if (!profile || !clubId) return null;
  const position = profile.position;

  const mates = getClubPlayers(state, clubId)
    .map((id) => getPlayerProfile(state, id))
    .filter((p) => p && p.position === position);
  const ranked = mates
    .map((p) => ({ id: p.id, r: Number(playerLineRating(state, p.id)) || 0 }))
    .sort((a, b) => b.r - a.r || a.id.localeCompare(b.id));
  const rank = ranked.findIndex((x) => x.id === playerId) + 1;
  if (rank <= 0) return null;

  if (position === 'GK') {
    const role = rank === 1 ? 'GK1' : (rank === 2 ? 'GK2' : 'GK3');
    return { role, rank, position, slotCount: 1, K: 0 };
  }
  const slotCount = lineSlotCount(state, clubId, position);
  const K = getRotationK(state, clubId, position);
  let role = 'BENCH';
  if (rank <= slotCount) role = 'STARTER';
  else if (rank <= slotCount + K) role = 'ROTATION';
  return { role, rank, position, slotCount, K };
}

/** 某 role 的 Expected Participation 区间（center/tolerance/upperBound）。 */
export function getExpectedParticipation(role) {
  const p = C.ROLES[role] ?? C.ROLES.BENCH;
  return { center: p.center, tolerance: p.tolerance, upperBound: Math.min(1, p.center + p.tolerance) };
}

/**
 * Actual Participation（完赛赛季）。
 * `clamp01(seasonMinutes / (teamAvailableMatches × 90))`；`teamAvailableMatches ≤ 0` → `actual = null`。
 * @returns {{actual: number|null, matches: number}}
 */
export function getActualParticipation(state, clubId, playerId, seasonNumber, cache = null) {
  const rt = getPlayerRuntime(state, playerId);
  const minutes = Math.max(0, Math.floor(Number(rt?.stats?.season?.minutes) || 0));
  const matches = getTeamAvailableMatches(state, clubId, seasonNumber, cache);
  if (!(matches > 0)) return { actual: null, matches: 0 };
  return { actual: clamp01(minutes / (matches * 90)), matches };
}

/**
 * Relative Load 分类（R5 range-excess）。
 * @returns {{classification:string, excess:number|null}}
 */
export function classifyRelativeRoleLoad(upperBound, actual) {
  if (actual == null) return { classification: CLS.NO_RELATIVE_LOAD, excess: null };
  const excess = Math.max(0, clamp01(actual) - upperBound);
  const classification = excess <= 0
    ? CLS.NORMAL
    : (excess <= C.EXCESSIVE_BAND ? CLS.EXCESSIVE : CLS.EXTREME);
  return { classification, excess };
}

/**
 * 综合评估某球员的 Relative Role Load（纯派生）。
 * @returns {{role:string, rank:number, position:string, slotCount:number, K:number,
 *            center:number, tolerance:number, upperBound:number,
 *            actual:number|null, excess:number|null, matches:number, classification:string}|null}
 */
export function evaluateRelativeRoleLoad(state, clubId, playerId, options = {}) {
  if (!clubId) return null;
  const derived = deriveExpectedRole(state, clubId, playerId);
  if (!derived) return null;
  const expected = getExpectedParticipation(derived.role);
  const seasonId = Number.isFinite(Number(options.seasonNumber)) ? Number(options.seasonNumber) : state.season;
  const { actual, matches } = getActualParticipation(state, clubId, playerId, seasonId, options.availabilityCache ?? null);
  const { classification, excess } = classifyRelativeRoleLoad(expected.upperBound, actual);
  return {
    role: derived.role,
    rank: derived.rank,
    position: derived.position,
    slotCount: derived.slotCount,
    K: derived.K,
    center: expected.center,
    tolerance: expected.tolerance,
    upperBound: expected.upperBound,
    actual,
    excess,
    matches,
    classification,
  };
}
