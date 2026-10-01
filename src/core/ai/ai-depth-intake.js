/**
 * DDTI —— Dynamic Depth Target Intake（Step 35D；D-35.1~D-35.11）。
 * 层级归属：Simulation Core / AI / Population。**纯评估 + 规划，不修改 state，无 RNG**。
 *
 * 职责：在 **结构缺口补位之后**，为世界提供**有界、状态驱动、确定性**的 squad depth elasticity，
 * 使市场存在潜在 surplus（防止 `96/12/0` 永久吸收）。**三层分离（D-35 附）**：
 *   - Population Supply：本模块只**规划**是否是「FA 复用 / 生成」；实际写入由 `player-lifecycle` 执行。
 *   - Squad Depth Supply：`effectiveDepthTarget` 解释「为何该 Club 值得更深阵容」。
 *   - Market Supply：本模块**不**产生 SELL；surplus 判定仍归 AI Decision Layer。
 *
 * 约束（D-35.2 C 分支）：① 状态驱动；② 有界；③ 确定性；④ 非机械；⑤ 不同步；⑥ 非固定年度补人；
 * ⑦⑧⑨ 不保证 14 / 16 / 112；⑩ 不制造强制交易；⑪⑫ 不改 Transfer / Match / Team Strength；
 * ⑬ 不随机生成 FA；⑭ `N ≤ 112`。
 *
 * 说明：`target` **禁止**只依赖 `rosterSize`（D-35）；必须来自六维状态（age / congestion / need /
 * finance / recent activity / development），Policy 仅作**有界 bias**（D-35.4，非身份）。
 */

import { DDTI_CONFIG, ROSTER_CONFIG, FINANCE_CONFIG } from '../sim-config.js';
import { getClubPlayers } from '../membership.js';
import { getPlayerProfile, getWorldPlayers } from '../player-runtime.js';
import { getClubFinance } from '../finance.js';
import { getFreeAgents } from '../free-agent.js';
import { evaluateSquadNeed } from './ai-need.js';
import { getAIClubPolicy } from './ai-club-policy.js';
import { AI_CONFIG } from './ai-config.js';
import { ageOn } from '../date-utils.js';
import { estimatePotentialHeadroom } from './ai-potential-estimate.js';

const D = DDTI_CONFIG;
const POSITION_ORDER = Object.freeze(['GK', 'DF', 'MF', 'FW']);
const STRUCTURAL_MIN = Object.freeze({ GK: ROSTER_CONFIG.MIN_GK, DF: 4, MF: 4, FW: 2 });

/** 合并实验参数覆盖（不改冻结配置；仅实验/测试用）。 */
function cfgOf(overrides) {
  return { ...D, ...(overrides ?? {}) };
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/** 位置结构最低线。 */
function structuralMin(position) {
  return STRUCTURAL_MIN[position] ?? 0;
}

/** 派生：某 Club 最近 window 赛季内的动作计数（**来自 runtime.events，不持久化**）。 */
function recentActivity(state, clubId, season, window) {
  const from = season - window;
  let intake = 0;
  let outflow = 0;
  let lastIntakeSeason = null;
  for (const e of state?.runtime?.events ?? []) {
    const p = e?.payload ?? {};
    const s = Number.isFinite(Number(p.season)) ? Number(p.season) : null;
    if (s == null || s < from || s > season) continue;
    switch (e.type) {
      case 'player_generated':
        if (p.teamId === clubId) { intake += 1; lastIntakeSeason = Math.max(lastIntakeSeason ?? -Infinity, s); }
        break;
      case 'free_agent_signed':
        if (p.clubId === clubId) { intake += 1; lastIntakeSeason = Math.max(lastIntakeSeason ?? -Infinity, s); }
        break;
      case 'player_released':
        if (p.fromClubId === clubId) outflow += 1;
        break;
      case 'player_retired':
        if (p.teamId === clubId) outflow += 1;
        break;
      case 'TRANSFER_COMPLETED':
        if (p.sellerClubId === clubId) outflow += 1;
        else if (p.buyerClubId === clubId) intake += 1;
        break;
      default:
        break;
    }
  }
  return { intake, outflow, lastIntakeSeason };
}

/** 年龄结构分量（年轻/高龄都偏深阵容）。 */
function ageComponent(profiles, state) {
  if (profiles.length === 0) return 0;
  let young = 0;
  let veteran = 0;
  for (const p of profiles) {
    const a = p.birthDate ? ageOn(p.birthDate, state.currentDate) : 26;
    if (a <= 21) young += 1;
    else if (a >= 31) veteran += 1;
  }
  return clamp01((young / profiles.length) * 1.2 + (veteran / profiles.length) * 1.0);
}

/** 位置拥堵分量：某线超出结构最低线的程度（已有深度 → 值得持有）。 */
function congestionComponent(profiles) {
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const p of profiles) if (counts[p.position] != null) counts[p.position] += 1;
  let maxSurplus = 0;
  for (const pos of POSITION_ORDER) maxSurplus = Math.max(maxSurplus, counts[pos] - structuralMin(pos));
  return clamp01(maxSurplus / 3);
}

/** 需求分量：HARD / COMPETITIVE / SOFT。 */
function needComponent(state, clubId) {
  const need = evaluateSquadNeed(state, clubId);
  if (need.needs.some((n) => n.needClass === 'HARD')) return 1;
  if (need.needs.some((n) => n.needClass === 'COMPETITIVE')) return 0.6;
  if (need.needs.some((n) => n.needClass === 'SOFT')) return 0.3;
  return 0;
}

/** 财政分量：转会预算相对初值（健康预算 → 可维持更深阵容）。 */
function financeComponent(state, clubId) {
  const f = getClubFinance(state, clubId);
  if (!f) return 0;
  const ref = FINANCE_CONFIG.INITIAL_TRANSFER_BUDGET || 1;
  return clamp01(Number(f.transferBudget) / ref);
}

/** 近期动作分量：净流出 → 升（需回补）；净流入 → 降（冷却）。 */
function recentComponent(activity) {
  return clamp01((activity.outflow - activity.intake + 2) / 4);
}

/** 发展分量：年轻球员的**估计**潜力余量（development context）。D39C-03：必须经 estimator，不读 True Potential。 */
function developmentComponent(state, clubId, profiles) {
  if (profiles.length === 0) return 0;
  let sum = 0;
  let n = 0;
  for (const p of profiles) {
    sum += clamp01(estimatePotentialHeadroom(state, clubId, p.id) / 10);
    n += 1;
  }
  return n > 0 ? clamp01(sum / n) : 0;
}

/**
 * 计算某 Club 的 depthPressure ∈ [0,1]（确定性、无 RNG、无 OVR）。
 * @returns {{pressure:number, components:object}}
 */
export function evaluateDepthPressure(state, clubId) {
  const ids = getClubPlayers(state, clubId);
  const profiles = ids.map((id) => getPlayerProfile(state, id)).filter(Boolean);
  const activity = recentActivity(state, clubId, state.season ?? 1, D.RECENT_WINDOW);
  const w = D.STATE_WEIGHTS;
  const components = {
    age: ageComponent(profiles, state),
    congestion: congestionComponent(profiles),
    need: needComponent(state, clubId),
    finance: financeComponent(state, clubId),
    recent: recentComponent(activity),
    development: developmentComponent(state, clubId, profiles),
  };
  const totalW = w.AGE + w.CONGESTION + w.NEED + w.FINANCE + w.RECENT + w.DEVELOPMENT || 1;
  const raw = (
    w.AGE * components.age
    + w.CONGESTION * components.congestion
    + w.NEED * components.need
    + w.FINANCE * components.finance
    + w.RECENT * components.recent
    + w.DEVELOPMENT * components.development
  ) / totalW;
  // Policy 仅作**有界 bias**（D-35.4）；不决定身份，不产生永久 supplier/buyer。
  const policy = getAIClubPolicy(clubId);
  const bounded = Math.min(
    D.POLICY_BIAS_BOUNDS.MAX,
    Math.max(D.POLICY_BIAS_BOUNDS.MIN, policy.demandBias ?? 1),
  );
  return { pressure: clamp01(raw * bounded), components, activity, policy };
}

/**
 * `effectiveDepthTarget_c` —— 状态驱动、可逆、有硬上下限（D-35.3）。
 * `MIN_TARGET ≤ target ≤ DEPTH_CAP`；**不是** Policy 常量，**不是** rosterSize 的函数。
 * @returns {number}
 */
export function effectiveDepthTarget(state, clubId, overrides) {
  const cfg = cfgOf(overrides);
  const { pressure } = evaluateDepthPressure(state, clubId);
  const span = Math.max(0, cfg.DEPTH_CAP - cfg.MIN_TARGET);
  const target = cfg.MIN_TARGET + Math.round(pressure * span);
  return Math.min(cfg.DEPTH_CAP, Math.max(cfg.MIN_TARGET, target));
}

/** 选取 intake 位置：优先 Need 位置；否则加深既有最深线（制造异质深度）；确定性 tie-break。 */
function pickIntakePosition(state, clubId) {
  const ids = getClubPlayers(state, clubId);
  const profiles = ids.map((id) => getPlayerProfile(state, id)).filter(Boolean);
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const p of profiles) if (counts[p.position] != null) counts[p.position] += 1;

  const need = evaluateSquadNeed(state, clubId);
  if (need.needs.length > 0) {
    const ordered = need.needs.slice().sort((a, b) => (
      b.priority - a.priority || POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position)
    ));
    return ordered[0].position;
  }
  // 无 Need：加深当前最深线（保持异质 roster，不摊平）。
  let best = POSITION_ORDER[0];
  for (const pos of POSITION_ORDER) {
    if (counts[pos] > counts[best]) best = pos;
  }
  return best;
}

/**
 * DDTI 规划（**纯函数**，不改 state，无 RNG）：按 clubId 升序，产出**有界**的 intake 计划。
 * 结构缺口优先（由 `player-lifecycle` 先跑结构补位保证）；此处只做 depth intake。
 *
 * @param {object} state
 * @param {{season?:number, overrides?:object}} [opts]
 * @returns {{plans: object[], worldUsed:number, worldCap:number}}
 */
export function evaluateDepthIntake(state, opts = {}) {
  const cfg = cfgOf(opts.overrides);
  const plans = [];
  if (!cfg.ENABLED) return { plans, worldUsed: 0, worldCap: cfg.WORLD_INTAKE_CAP };
  const season = Number.isFinite(opts.season) ? opts.season : (state.season ?? 1);
  const clubIds = Object.keys(state?.runtime?.clubs ?? {}).sort();
  // 世界已用量：本季已发生的 DDTI 派生生成（player_generated）——用于 world cap 的跨 club 一致性。
  let worldUsed = 0;

  for (const clubId of clubIds) {
    if (worldUsed >= cfg.WORLD_INTAKE_CAP) break;
    const roster = getClubPlayers(state, clubId).length;
    const target = effectiveDepthTarget(state, clubId, opts.overrides);
    const { pressure, activity } = evaluateDepthPressure(state, clubId);

    // Hysteresis（D-35.5）：进入需 UP 阈值；已有近期 intake → 冷却期需回到 UP 阈值；已深度 → DOWN 阈值即可维持。
    const cooldown = activity.lastIntakeSeason != null && activity.lastIntakeSeason >= season - 1;
    const holdingDeep = activity.lastIntakeSeason != null && activity.lastIntakeSeason >= season - cfg.RECENT_WINDOW;
    const threshold = cooldown ? cfg.HYSTERESIS_UP : (holdingDeep ? cfg.HYSTERESIS_DOWN : cfg.HYSTERESIS_UP);

    if (roster >= target) continue; // 已达 target：无 intake 需求
    if (pressure < threshold) continue; // 状态不允许 intake（非机械、状态驱动）

    const slots = Math.min(cfg.PER_CLUB_INTAKE_CAP, target - roster, cfg.WORLD_INTAKE_CAP - worldUsed);
    if (slots <= 0) continue;

    const position = pickIntakePosition(state, clubId);
    const picks = [];
    for (let i = 0; i < slots; i += 1) {
      const fa = getFreeAgents(state).find((id) => getPlayerProfile(state, id)?.position === position) ?? null;
      picks.push(fa
        ? { position, source: 'FREE_AGENT', freeAgentId: fa }
        : { position, source: 'GENERATE' });
    }
    plans.push({ clubId, target, pressure, rosterBefore: roster, slots, position, picks });
    worldUsed += slots;
  }
  return { plans, worldUsed, worldCap: cfg.WORLD_INTAKE_CAP };
}

/**
 * 只读市场角色诊断（derived，**不持久化**）：`SURPLUS / NEUTRAL / DEFICIT`。
 * 分类与现有 AI Need / Candidate 语义一致（D-35.18）。
 * - SURPLUS：`roster > HOLDING_TARGET` 且存在超出 target 的深度（潜在可卖）。
 * - DEFICIT：存在 HARD / COMPETITIVE Need 或 `roster < MIN_TARGET`。
 * - NEUTRAL：其余。
 * @returns {'SURPLUS'|'NEUTRAL'|'DEFICIT'}
 */
export function classifyMarketRole(state, clubId) {
  const roster = getClubPlayers(state, clubId).length;
  const need = evaluateSquadNeed(state, clubId);
  const hasDeficit = roster < ROSTER_CONFIG.MIN_PLAYERS
    || need.needs.some((n) => n.needClass === 'HARD' || n.needClass === 'COMPETITIVE');
  if (hasDeficit) return 'DEFICIT';
  if (roster > AI_CONFIG.HOLDING_TARGET) {
    const target = effectiveDepthTarget(state, clubId);
    if (roster > target) return 'SURPLUS';
  }
  return 'NEUTRAL';
}