/**
 * Squad Need Evaluator —— Step 31 / D-AI-06。
 * 层级归属：Simulation Core / AI。纯函数，**不修改 state**，**无 RNG**，**确定性**。
 *
 * 回答「这个俱乐部现在缺什么？」。区分 Hard / Competitive / Soft / NONE（D-AI-06、D-33.3、D-34.3）：
 * - Hard：GK<1 / DF<4 / MF<4 / FW<2 / roster<12 / 可用（非伤）球员不足以排阵。
 * - Competitive：**仅当该位置无 Hard**；竞技质量明显不足（对联赛基线偏弱 / 绝对偏弱 / 首发-替补断层）。
 * - Soft：位置能力缺口 / 青年储备不足 / 年龄结构失衡（**不只按人数判断**）。
 * - NONE：无显著需求。
 *
 * 输出：`{ clubId, needClass, needs: NeedObject[] }`；NeedObject = `{ clubId, position, needClass, reasonCode, priority }`。
 * 优先级：HARD(100) > COMPETITIVE(75) > SOFT(50) > NONE。
 */

import { AI_CONFIG } from './ai-config.js';
import { getAIClubPolicy } from './ai-club-policy.js';
import { ROSTER_CONFIG, FORMATIONS, DEFAULT_FORMATION } from '../sim-config.js';
import { getClubPlayers, getClubLeague, getLeagueClubs } from '../membership.js';
import { getPlayerProfile, getPlayerRuntime, getEffectiveAttributes, INJURY_STATUS } from '../player-runtime.js';
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

/** 位置「主力」人数（结构最低线：GK 1 / DF 4 / MF 4 / FW 2）。 */
function positionLineCount(position) {
  return position === 'GK' ? ROSTER_CONFIG.MIN_GK : (ROSTER_CONFIG.MIN_BY_POSITION[position] ?? 0);
}

/** 某球员在某位置 profile 上的有效属性评分（不使用 OVR，仅 profile 子集均值）。 */
function profileRating(state, playerId, position) {
  const attrs = profileAttrs(position);
  const eff = getEffectiveAttributes(state, playerId) ?? {};
  return mean(attrs.map((a) => (Number.isFinite(Number(eff[a])) ? Number(eff[a]) : ATTRIBUTE_DEFAULT)));
}

/** 某俱乐部某位置的 starter / bench 评分（按评分降序取前 N 为主力）。 */
function starterBenchRating(state, clubId, position) {
  const ids = getClubPlayers(state, clubId)
    .filter((id) => getPlayerProfile(state, id)?.position === position);
  if (ids.length === 0) return null;
  const rated = ids
    .map((id) => ({ id, r: profileRating(state, id, position) }))
    .sort((a, b) => b.r - a.r || a.id.localeCompare(b.id));
  const n = positionLineCount(position);
  const starters = rated.slice(0, Math.max(1, n));
  const bench = rated.slice(Math.max(1, n));
  return {
    starter: mean(starters.map((x) => x.r)),
    bench: bench.length > 0 ? mean(bench.map((x) => x.r)) : null,
  };
}

/** 联赛某位置主力评分基线（各俱乐部 starter 评分的中位数；确定性）。 */
function leaguePositionBaseline(state, clubId, position) {
  const leagueId = getClubLeague(state, clubId);
  if (!leagueId) return null;
  const clubs = getLeagueClubs(state, leagueId).slice().sort();
  const values = [];
  for (const cid of clubs) {
    const sb = starterBenchRating(state, cid, position);
    if (sb) values.push(sb.starter);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
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
    const priority = needClass === 'HARD' ? 100 : (needClass === 'COMPETITIVE' ? 75 : 50);
    needs.push({
      clubId,
      position,
      needClass,
      reasonCode,
      priority,
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

  // ---- Club Policy（供 Competitive / Soft 共享；派生、无状态）----
  const policy = getAIClubPolicy(clubId);

  // ---- Competitive Need（仅当该位置无 HARD；D-33.3 / D-34.3；确定性、无 OVR）----
  const competitivePositions = new Set();
  for (const pos of POSITION_ORDER) {
    if (hasHard(pos)) continue;
    if (groups[pos].length === 0) continue;
    const sb = starterBenchRating(state, clubId, pos);
    if (!sb) continue;
    const baseline = leaguePositionBaseline(state, clubId, pos);
    const margin = C.COMPETITIVE_UPGRADE_MARGIN / Math.max(0.1, policy.demandBias ?? 1);
    const weakVsLeague = baseline != null && sb.starter < baseline - margin;
    const weakAbsolute = sb.starter < C.COMPETITIVE_ABSOLUTE_FLOOR;
    const benchCliff = sb.bench != null && (sb.starter - sb.bench) > C.COMPETITIVE_BENCH_GAP;
    if (weakVsLeague || weakAbsolute || benchCliff) {
      push(pos, 'COMPETITIVE', 'COMPETITIVE_UPGRADE');
      competitivePositions.add(pos);
    }
  }

  // ---- Soft Need（仅当该位置无 Hard 且 Policy 启用；与 Competitive 去重）----
  if (policy.softNeedEnabled) {
    for (const pos of POSITION_ORDER) {
      if (hasHard(pos)) continue;
      const group = groups[pos];
      if (group.length === 0) continue;
      const attrs = profileAttrs(pos);
      const avgAttr = mean(group.map((p) => mean(attrs.map((a) => p[a]))));
      if (avgAttr < C.SOFT_NEED_ATTRIBUTE_FLOOR) {
        // D-34.3 去重：该位置已产生 COMPETITIVE_UPGRADE 时，不再因相同质量缺口产生 ATTRIBUTE_GAP。
        if (!competitivePositions.has(pos)) push(pos, 'SOFT', 'ATTRIBUTE_GAP');
        continue;
      }

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
  const needClass = needs.length === 0
    ? 'NONE'
    : (needs.some((n) => n.needClass === 'HARD')
      ? 'HARD'
      : (needs.some((n) => n.needClass === 'COMPETITIVE') ? 'COMPETITIVE' : 'SOFT'));
  return { clubId, needClass, needs };
}
