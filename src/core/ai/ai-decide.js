/**
 * AI Decision Layer（纯决策）—— Step 31 / D-AI-02、D-AI-08~14、D-AI-17/18/19。
 * 层级归属：Simulation Core / AI。纯函数（**不修改 state**、**不执行 Domain operation**），**无 RNG**。
 *
 * 输出 Decision Object（ephemeral，不持久化，不写入 player / club）：
 *   { decisionId, clubId, season, date, type, playerId, targetClubId, position, reasonCode, priority, estimatedCost, confidence, context }
 *
 * 决策链路（D-AI-13）：Need → Position → Candidate Filter → Suitability → Finance → Ranking → Decision。
 * Ranking：1 需求相关（位置已匹配）→ 2 suitability desc → 3 年龄/潜力上下文 → 4 playerId 升序。
 */

import { AI_CONFIG } from './ai-config.js';
import { evaluateSquadNeed } from './ai-need.js';
import { filterCandidates, CANDIDATE_SOURCE } from './ai-candidate.js';
import { evaluatePlayerSuitability, potentialHeadroom } from './ai-suitability.js';
import { ROSTER_CONFIG } from '../sim-config.js';
import { getPlayerClub, getClubPlayers } from '../membership.js';
import { getPlayerContract, CONTRACT_STATUS } from '../contract.js';
import { getPlayerProfile } from '../player-runtime.js';
import { ageOn } from '../date-utils.js';
import { buildAutoLineup } from '../team-strength.js';
import { cleanLineup } from '../player-lineup.js';
import { executeAIAction } from './ai-action.js';

const C = AI_CONFIG;

/** 构造 Decision Object（decisionId 确定性，非 UUID）。 */
function makeDecision(clubId, state, type, extra) {
  const season = Number.isInteger(state?.season) ? state.season : 1;
  const date = state?.currentDate ?? null;
  const playerId = extra.playerId ?? null;
  const targetClubId = extra.targetClubId ?? null;
  return {
    decisionId: `${clubId}|${season}|${date}|${type}|${playerId ?? ''}|${targetClubId ?? ''}`,
    clubId,
    season,
    date,
    type,
    playerId,
    targetClubId,
    position: extra.position ?? null,
    reasonCode: extra.reasonCode ?? null,
    priority: extra.priority ?? 0,
    estimatedCost: extra.estimatedCost ?? 0,
    confidence: extra.confidence ?? null,
    context: extra.context ?? {},
  };
}

/** 释放后本俱乐部是否仍满足结构约束（GK≥1、DF/MF/FW 最低、roster≥MIN）。 */
function releaseKeepsStructure(state, clubId, playerId) {
  const ids = getClubPlayers(state, clubId);
  if (ids.length - 1 < ROSTER_CONFIG.MIN_PLAYERS) return false;
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const id of ids) {
    if (id === playerId) continue;
    const pos = getPlayerProfile(state, id)?.position;
    if (counts[pos] != null) counts[pos] += 1;
  }
  if (counts.GK < ROSTER_CONFIG.MIN_GK) return false;
  for (const pos of ['DF', 'MF', 'FW']) {
    if (counts[pos] < (ROSTER_CONFIG.MIN_BY_POSITION[pos] ?? 0)) return false;
  }
  return true;
}

/**
 * 冗余释放决策（D-AI-14）。仅在无 Hard Need、roster > MIN、且球员为「无买家价值」时释放。
 * 排序：高年龄 → 低 suitability → 低潜力 → playerId 升序。
 * @returns {object|null}
 */
export function decideRelease(state, clubId) {
  const need = evaluateSquadNeed(state, clubId);
  if (need.needs.some((n) => n.needClass === 'HARD')) return null;
  const ids = getClubPlayers(state, clubId);
  if (ids.length <= ROSTER_CONFIG.MIN_PLAYERS) return null;

  const candidates = [];
  for (const playerId of ids) {
    const profile = getPlayerProfile(state, playerId);
    if (!profile) continue;
    const contract = getPlayerContract(state, playerId);
    if (!contract || contract.status !== CONTRACT_STATUS.ACTIVE || contract.clubId !== clubId) continue;
    if (!releaseKeepsStructure(state, clubId, playerId)) continue;
    const age = profile.birthDate ? ageOn(profile.birthDate, state.currentDate) : 26;
    const suit = evaluatePlayerSuitability(state, clubId, playerId, { position: profile.position }, 'Backup').score;
    candidates.push({ id: playerId, age, suit, pot: potentialHeadroom(profile), position: profile.position });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (
    b.age - a.age
    || a.suit - b.suit
    || a.pot - b.pot
    || a.id.localeCompare(b.id)
  ));
  const pick = candidates[0];
  const qualifies = pick.suit < C.SURPLUS_SUITABILITY_FLOOR || pick.age >= C.SURPLUS_AGE;
  if (!qualifies) return null;
  return makeDecision(clubId, state, 'RELEASE_PLAYER', {
    playerId: pick.id,
    position: pick.position,
    reasonCode: 'SURPLUS_SQUAD',
    priority: 40,
    estimatedCost: 0,
    confidence: pick.suit,
  });
}

/**
 * Free Agent 签约决策（D-AI-12：存在满足需求且零成本的 FA → 优先）。
 * @returns {object|null}
 */
export function decideSignFreeAgent(state, clubId) {
  const need = evaluateSquadNeed(state, clubId);
  for (const n of need.needs) {
    const candidates = filterCandidates(state, clubId, n, CANDIDATE_SOURCE.FREE_AGENT);
    if (candidates.length === 0) continue;
    const role = n.needClass === 'HARD' ? 'Starter' : 'Rotation';
    const scored = candidates
      .map((id) => ({ id, score: evaluatePlayerSuitability(state, clubId, id, n, role).score }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const best = scored[0];
    if (best.score < C.FREE_AGENT_MIN_SUITABILITY) continue;
    return makeDecision(clubId, state, 'SIGN_FREE_AGENT', {
      playerId: best.id,
      position: n.position,
      reasonCode: n.reasonCode === 'ATTRIBUTE_GAP' || n.reasonCode === 'YOUTH_DEVELOPMENT'
        ? n.reasonCode
        : 'FREE_AGENT_VALUE',
      priority: n.priority,
      estimatedCost: 0,
      confidence: best.score,
    });
  }
  return null;
}

/**
 * 付费转会决策（D-AI-13）。仅在没有合适 Free Agent 时调用。
 * @returns {object|null}
 */
export function decideTransfer(state, clubId) {
  const need = evaluateSquadNeed(state, clubId);
  for (const n of need.needs) {
    const candidates = filterCandidates(state, clubId, n, CANDIDATE_SOURCE.TRANSFER);
    if (candidates.length === 0) continue;
    const role = n.needClass === 'HARD' ? 'Starter' : 'Rotation';
    const scored = candidates.map((id) => {
      const profile = getPlayerProfile(state, id);
      const age = profile?.birthDate ? ageOn(profile.birthDate, state.currentDate) : 26;
      return {
        id,
        score: evaluatePlayerSuitability(state, clubId, id, n, role).score,
        age,
        pot: potentialHeadroom(profile),
      };
    });
    scored.sort((a, b) => (
      b.score - a.score
      || a.age - b.age
      || b.pot - a.pot
      || a.id.localeCompare(b.id)
    ));
    const best = scored[0];
    return makeDecision(clubId, state, 'TRANSFER_PLAYER', {
      playerId: best.id,
      targetClubId: getPlayerClub(state, best.id),
      position: n.position,
      reasonCode: n.reasonCode,
      priority: n.priority,
      estimatedCost: 0, // 成本由 Action 层经 Domain 权威计算；此处仅作 Intent 占位
      confidence: best.score,
    });
  }
  return null;
}

/** 阵容更新决策（使用现有合法 lineup 能力；仅在需要变化时产出）。 */
export function decideLineup(state, clubId) {
  const club = state?.runtime?.clubs?.[clubId];
  if (!club) return null;
  const proposed = cleanLineup(state, clubId, buildAutoLineup(state, clubId, club.tactics ?? {}));
  const current = cleanLineup(state, clubId, club.lineup ?? { starters: [], bench: [] });
  if (JSON.stringify(proposed) === JSON.stringify(current)) return null;
  return makeDecision(clubId, state, 'UPDATE_LINEUP', {
    reasonCode: 'SQUAD_BALANCE',
    priority: 10,
  });
}

/**
 * 纯决策入口（D-AI-17）：返回按动作优先级排序的 Decision 列表（不执行、不改 state）。
 * 顺序：Release → Free Agent → Buy（FA 优先）→ Lineup。
 * @returns {object[]}
 */
export function evaluateClubDecisions(state, clubId) {
  const out = [];
  const release = decideRelease(state, clubId);
  if (release) out.push(release);
  const sign = decideSignFreeAgent(state, clubId);
  if (sign) out.push(sign);
  else {
    const transfer = decideTransfer(state, clubId);
    if (transfer) out.push(transfer);
  }
  const lineup = decideLineup(state, clubId);
  if (lineup) out.push(lineup);
  return out;
}

/** 单个 club 的 AI cycle（每步后重读最新 state；ephemeral counter 限制每赛季动作数）。 */
export function runAIForClub(state, clubId, counters = { sign: 0, exit: 0 }) {
  // 1) 释放（≤ MAX_EXITS）
  while (counters.exit < C.MAX_EXITS_PER_SEASON) {
    const decision = decideRelease(state, clubId);
    if (!decision) break;
    const result = executeAIAction(state, decision);
    if (!result.ok) break;
    counters.exit += 1;
  }
  // 2) Free Agent 优先，其次付费转会（合计 ≤ MAX_SIGNINGS）
  while (counters.sign < C.MAX_SIGNINGS_PER_SEASON) {
    const decision = decideSignFreeAgent(state, clubId) || decideTransfer(state, clubId);
    if (!decision) break;
    const result = executeAIAction(state, decision);
    if (!result.ok) break;
    counters.sign += 1;
  }
  // 3) 阵容更新
  const lineup = decideLineup(state, clubId);
  if (lineup) executeAIAction(state, lineup);
  return counters;
}

/**
 * 赛季边界 AI 入口（D-AI-17）：按 clubId 升序，对**非 managed**俱乐部执行 AI cycle。
 * 只读 + 经 Domain API 变更；确定性；无 RNG。
 * @returns {{clubs: Array<{clubId: string, sign: number, exit: number}>}}
 */
export function runSeasonAI(state) {
  const results = [];
  if (!state?.runtime?.clubs) return { clubs: results };
  const managed = state.runtime.managedClubId ?? null;
  const clubIds = Object.keys(state.runtime.clubs).sort();
  for (const clubId of clubIds) {
    if (clubId === managed) continue; // 玩家球队不受 AI 控制
    const counters = { sign: 0, exit: 0 };
    runAIForClub(state, clubId, counters);
    results.push({ clubId, sign: counters.sign, exit: counters.exit });
  }
  return { clubs: results };
}
