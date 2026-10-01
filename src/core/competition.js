/**
 * Competition Domain —— Phase 1 语义 helper（Step 38E；D38.1–D38.3 / D38D.1–D38D.3）。
 * 层级归属：Simulation Core。**纯逻辑、只读、无副作用、无 RNG**，不依赖 DOM / 存储 / UI。
 *
 * Phase 1 语义（D38D.3）：
 * - `leagues.json` entry = **逻辑 Division** + Phase 1 对应的 **League Competition 定义**；
 * - **概念层**区分 `divisionId` / `competitionId`，**存储层复用 `leagueId`**（当前一一对应）；
 * - **不新增** `divisions.json` / `competitions.json`，**不创建**独立 Division runtime entity。
 *
 * 本模块提供只读 helper（World Season Participants 枚举、Division/Competition 读取、Rules 读取），
 * 供 season boundary / promotion-relegation planner / controller 复用；**不修改任何 state**。
 */

import { COMPETITION_RULES_DEFAULTS } from './sim-config.js';

const D = COMPETITION_RULES_DEFAULTS;

/** 确定性字符串比较（不依赖 locale / 遍历顺序）。 */
export function compareId(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * World Season Participants（D38D.2）。
 * Phase 1：当前 World 中**全部 League-format RoundRobin Competitions**（= `runtime.competitions` ∩ `static.leagues`）。
 * **顺序契约**：按竞争 ID **升序**（deterministic，不依赖 `Object.keys()` 顺序）；空集合 → `[]`。
 * @returns {string[]} competitionId（Phase 1 = leagueId）升序列表
 */
export function getWorldSeasonParticipants(state) {
  const comps = state?.runtime?.competitions ?? {};
  const leagues = state?.static?.leagues ?? [];
  const leagueIds = new Set(leagues.map((l) => l.id));
  return Object.keys(comps)
    .filter((id) => leagueIds.has(id))
    .sort(compareId);
}

/** 取逻辑 Division（Phase 1：静态 `leagues.json` entry；概念层 divisionId = 存储层 leagueId）。 */
export function getDivision(state, divisionId) {
  return (state?.static?.leagues ?? []).find((l) => l.id === divisionId) ?? null;
}

/** Division 层级（缺省 → Engine 默认）。 */
export function getDivisionTier(state, divisionId) {
  const division = getDivision(state, divisionId);
  return Number.isInteger(division?.tier) ? division.tier : D.TIER;
}

/**
 * 取 Competition 视图（Phase 1：与 Division 一一对应，`format = ROUND_ROBIN`）。
 * @returns {object|null}
 */
export function getCompetition(state, competitionId) {
  const division = getDivision(state, competitionId);
  if (!division) return null;
  return {
    competitionId,
    divisionId: division.id,
    countryId: division.countryId ?? null,
    tier: getDivisionTier(state, competitionId),
    format: 'ROUND_ROBIN',
    rules: getCompetitionRules(state, competitionId),
  };
}

/**
 * 俱乐部所属 Competition 上下文（只读）。
 * Phase 1：`divisionId === competitionId === leagueId`（来自 membership，当前归属唯一真相源）。
 * @returns {{divisionId:string|null, competitionId:string|null, countryId:string|null, tier:number|null}}
 */
export function getCompetitionContext(state, clubId) {
  const divisionId = state?.runtime?.membership?.clubs?.[clubId];
  if (typeof divisionId !== 'string') {
    return { divisionId: null, competitionId: null, countryId: null, tier: null };
  }
  const division = getDivision(state, divisionId);
  return {
    divisionId,
    competitionId: divisionId,
    countryId: division?.countryId ?? null,
    tier: Number.isInteger(division?.tier) ? division.tier : D.TIER,
  };
}

/**
 * 取某 League Competition 的 Phase 1 rules（World Data Rules，D38D.8）。
 * 缺失 → Engine 默认；非法值由 **world validation（加载阶段）** 明确拒绝，此处仅安全读取。
 * @returns {{promotionPlaces:number, relegationPlaces:number}}
 */
export function getCompetitionRules(state, leagueId) {
  const league = getDivision(state, leagueId);
  const rules = league?.rules ?? {};
  const pick = (v, fallback) => (Number.isInteger(v) && v >= 0 ? v : fallback);
  return {
    promotionPlaces: pick(rules.promotionPlaces, D.PROMOTION_PLACES),
    relegationPlaces: pick(rules.relegationPlaces, D.RELEGATION_PLACES),
  };
}
