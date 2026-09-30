/**
 * Squad Need Evaluator —— Step 31 / D-AI-06。
 * 层级归属：Simulation Core / AI。纯函数，**不修改 state**，**无 RNG**，**确定性**。
 *
 * 回答「这个俱乐部现在缺什么？」。区分 Hard / Soft / NONE（D-AI-06）：
 * - Hard：GK<1 / DF<4 / MF<4 / FW<2 / roster<12 / 可用（非伤）球员不足以排阵。
 * - Soft：位置能力缺口 / 青年储备不足 / 年龄结构失衡（**不只按人数判断**）。
 * - NONE：无显著需求。
 *
 * 输出：`{ clubId, needClass, needs: NeedObject[] }`；NeedObject = `{ clubId, position, needClass, reasonCode, priority }`。
 * Hard 优先于 Soft（priority 数值更大）。
 */

import { AI_CONFIG } from './ai-config.js';
import { getAIClubPolicy } from './ai-club-policy.js';
import { ROSTER_CONFIG, FORMATIONS, DEFAULT_FORMATION } from '../sim-config.js';
import { getClubPlayers } from '../membership.js';
import { getPlayerProfile, getPlayerRuntime, INJURY_STATUS } from '../player-runtime.js';
import { ATTRIBUTE_DEFAULT } from '../../shared/football-schema.js';

const C = AI_CONFIG;
const POSITION_ORDER = Object.freeze(['GK', 'DF', 'MF', 'FW']);

function profileAttrs(position) {
  return C.ATTRIBUTE_PROFILES[position] ?? C.ATTRIBUTE_PROFILES.MF;
}
function mean(values) {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    const x = Number(v);
    if (Number.isFinite(x)) { sum += x; n += 1; }
  }
  return n > 0 ? sum / n : ATTRIBUTE_DEFAULT;
}
function ageBandIndex(age) {
  const bands = C.AGE_BANDS;
  for (let i = 0; i < bands.length; i += 1) {
    if (age >= bands[i].min && age <= bands[i].max) return i;
  }
  return bands.length - 1;
}

/** 位置最低结构要求（GK 单列）。 */
function positionMinimums(formationCounts) {
  return {
    GK: ROSTER_CONFIG.MIN_GK,
    DF: ROSTER_CONFIG.MIN_BY_POSITION.DF,
    MF: ROSTER_CONFIG.MIN_BY_POSITION.MF,
    FW: ROSTER_CONFIG.MIN_BY_POSITION.FW,
    _formation: formationCounts,
  };
}

/** roster 低于下限时，选择缺口最大的位置（确定性 tie-break = 位置顺序）。 */
function pickBufferPosition(counts, mins) {
  let best = 'MF';
  let bestDeficit = -Infinity;
  for (const pos of POSITION_ORDER) {
    const deficit = (mins[pos] ?? 0) - (counts[pos] ?? 0);
    if (deficit > bestDeficit) { bestDeficit = deficit; best = pos; }
  }
  return best;
}

/**
 * 评估某俱乐部的 squad need（只读）。
 * @returns {{clubId: string, needClass: 'HARD'|'SOFT'|'NONE', needs: object[]}}
 */
export function evaluateSquadNeed(state, clubId) {
  const club = state?.runtime?.clubs?.[clubId];
  const ids = getClubPlayers(state, clubId);
  const players = ids.map((id) => getPlayerProfile(state, id)).filter(Boolean);

  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  const avail = { GK: 0, DF: 0, MF: 0, FW: 0 };
  const groups = { GK: [], DF: [], MF: [], FW: [] };
  for (const p of players) {
    if (counts[p.position] == null) continue;
    counts[p.position] += 1;
    groups[p.position].push(p);
    const rt = getPlayerRuntime(state, p.id);
    if (rt?.injury?.status !== INJURY_STATUS.INJURED) avail[p.position] += 1;
  }
  const total = players.length;
  const formation = club?.tactics?.formation ?? DEFAULT_FORMATION;
  const formationCounts = FORMATIONS[formation] ?? FORMATIONS[DEFAULT_FORMATION];
  const mins = positionMinimums(formationCounts);

  const needs = [];
  const hasHard = (position) => needs.some((n) => n.position === position && n.needClass === 'HARD');
  const push = (position, needClass, reasonCode) => {
    needs.push({
      clubId,
      position,
      needClass,
      reasonCode,
      priority: needClass === 'HARD' ? 100 : 50,
    });
  };

  // ---- Hard Need ----
  if (counts.GK < ROSTER_CONFIG.MIN_GK) push('GK', 'HARD', 'POSITION_DEPTH');
  for (const pos of ['DF', 'MF', 'FW']) {
    if (counts[pos] < (ROSTER_CONFIG.MIN_BY_POSITION[pos] ?? 0)) push(pos, 'HARD', 'POSITION_DEPTH');
  }
  if (total < ROSTER_CONFIG.MIN_PLAYERS) {
    const pos = pickBufferPosition(counts, mins);
    if (!hasHard(pos)) push(pos, 'HARD', 'POSITION_DEPTH');
  }
  // 可用（非伤）球员不足以满足阵型 → 短期覆盖需求
  if (avail.GK < 1) push('GK', 'HARD', 'INJURY_COVER');
  for (const pos of ['DF', 'MF', 'FW']) {
    if (avail[pos] < (formationCounts[pos] ?? 0) && !hasHard(pos)) push(pos, 'HARD', 'INJURY_COVER');
  }

  // ---- Soft Need（仅当该位置无 Hard 且 Policy 启用）----
  const policy = getAIClubPolicy(clubId);
  if (policy.softNeedEnabled) {
    for (const pos of POSITION_ORDER) {
      if (hasHard(pos)) continue;
      const group = groups[pos];
      if (group.length === 0) continue;
      const attrs = profileAttrs(pos);
      const avgAttr = mean(group.map((p) => mean(attrs.map((a) => p[a]))));
      if (avgAttr < C.SOFT_NEED_ATTRIBUTE_FLOOR) { push(pos, 'SOFT', 'ATTRIBUTE_GAP'); continue; }

      const ages = group
        .map((p) => (p.birthDate ? Number(String(p.birthDate).slice(0, 4)) : null))
        .filter((y) => Number.isFinite(y));
      const hasYouth = group.some((p) => {
        const year = p.birthDate ? Number(String(p.birthDate).slice(0, 4)) : NaN;
        const currentYear = Number(String(state.currentDate).slice(0, 4));
        return Number.isFinite(year) && Number.isFinite(currentYear) && (currentYear - year) <= 24;
      });
      if (!hasYouth && group.length >= 2) { push(pos, 'SOFT', 'YOUTH_DEVELOPMENT'); continue; }

      // 年龄结构失衡：全部集中在同一档位且该档为 29+ / 33+
      const bands = new Set(group.map((p) => {
        const year = p.birthDate ? Number(String(p.birthDate).slice(0, 4)) : NaN;
        const currentYear = Number(String(state.currentDate).slice(0, 4));
        return Number.isFinite(year) ? ageBandIndex(currentYear - year) : -1;
      }));
      if (group.length >= 3 && bands.size === 1 && ages.length > 0) { push(pos, 'SOFT', 'SQUAD_BALANCE'); }
    }
  }

  needs.sort((a, b) => (
    b.priority - a.priority
    || POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position)
  ));
  const needClass = needs.length === 0 ? 'NONE' : (needs.some((n) => n.needClass === 'HARD') ? 'HARD' : 'SOFT');
  return { clubId, needClass, needs };
}
