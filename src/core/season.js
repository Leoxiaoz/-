/**
 * 赛季日历与赛季边界（Season Calendar）—— G1b①。
 * 层级归属：Simulation Core。**叶子模块**：只读 state，不修改任何状态、不依赖 DOM/存储/UI、无随机。
 *
 * 目标：把"某竞赛 finished → 推进 state.season → 执行全局赛季副作用"的**隐式**约定，
 * 升级为显式的「赛季日历 + 赛季边界」概念；**当前仅支持单联赛**（唯一 competition 投影）。
 *
 * 约束（G1b① / Step 38E D38D.1–D38D.2）：
 * - `SeasonCalendar` 是**派生视图**，**不写入存档**（由竞赛运行时确定性投影）。
 * - 不改 `state.season` 字段名/持久化；单联赛下 `state.season ≡ competition.season ≡ calendar.season`。
 * - **World Season = 同步世界赛季**：边界判据基于**全部 World Season Participants**（`getWorldSeasonParticipants`），
 *   只有当**所有参与者**都完成当前赛季时才构成 World 边界（不再取"首个 competition"）。
 * - 边界判据：`endDate !== null && currentDate >= endDate && status === 'finished'`（不得用 `>`，避免晚一天）。
 * - 多联赛 / 杯赛 / 淘汰赛属后续阶段，本模块暂不处理非 League-format 赛事。
 */

import { getWorldSeasonParticipants } from './competition.js';

/**
 * 单个 Competition 的日历投影（内部）。
 * @returns {{season:number, startDate:string|null, endDate:string|null, status:string}}
 */
function competitionCalendar(comp, fallbackSeason) {
  const fixtures = Array.isArray(comp?.fixtures) ? comp.fixtures : [];
  let endDate = null;
  for (const f of fixtures) {
    if (f && typeof f.date === 'string' && (endDate === null || f.date > endDate)) endDate = f.date;
  }
  let status;
  if (endDate === null) {
    status = comp?.status === 'finished' ? 'finished' : 'empty';
  } else {
    status = comp?.status ?? 'scheduled';
  }
  return {
    season: Number.isInteger(comp?.season) ? comp.season : fallbackSeason,
    startDate: typeof comp?.seasonStart === 'string' ? comp.seasonStart : null,
    endDate,
    status,
  };
}

/**
 * 取当前 World Season 日历（**跨全部 World Season Participants 聚合**；D38D.1）。
 * 规则：
 * - participants = `getWorldSeasonParticipants(state)`（升序；空集合 → `status='empty'`）；
 * - `season`  = 参与者 season 的最大值（缺省回退 `state.season`）；
 * - `startDate` = 参与者 startDate 的**最早**值（无 → null）；
 * - `endDate` = 参与者 endDate 的**最晚**值（无 → null）；
 * - `status`  = 无有效赛程 → `empty`；全部参与者 finished → `finished`；
 *               否则有任一 in_progress → `in_progress`，否则 `scheduled`。
 * 单 Competition 时与改造前**行为等价**。
 * @param {object} state
 * @returns {{season: number, startDate: string|null, endDate: string|null, status: string}}
 */
export function getSeasonCalendar(state) {
  const fallbackSeason = Number.isInteger(state?.season) ? state.season : 1;
  const competitions = state?.runtime?.competitions ?? {};
  const participants = getWorldSeasonParticipants(state);
  if (participants.length === 0) {
    return { season: fallbackSeason, startDate: null, endDate: null, status: 'empty' };
  }
  const perComp = participants.map((id) => competitionCalendar(competitions[id], fallbackSeason));

  let season = fallbackSeason;
  for (const c of perComp) if (c.season > season) season = c.season;

  let startDate = null;
  for (const c of perComp) {
    if (c.startDate !== null && (startDate === null || c.startDate < startDate)) startDate = c.startDate;
  }

  const withFixtures = perComp.filter((c) => c.endDate !== null);
  let endDate = null;
  for (const c of withFixtures) if (endDate === null || c.endDate > endDate) endDate = c.endDate;

  let status;
  if (withFixtures.length === 0) status = 'empty';
  else if (withFixtures.every((c) => c.status === 'finished')) status = 'finished';
  else if (withFixtures.some((c) => c.status === 'in_progress')) status = 'in_progress';
  else status = 'scheduled';

  return { season, startDate, endDate, status };
}

/**
 * 当前赛季是否到达**赛季边界**（单联赛：最后一轮比赛日 + 全部赛完）。
 * 判据：`endDate !== null && state.currentDate >= endDate && status === 'finished'`。
 * 空赛季（无赛程）永不触发；`currentDate < endDate` 不触发。
 * @param {object} state
 * @returns {boolean}
 */
export function isSeasonBoundaryReached(state) {
  const calendar = getSeasonCalendar(state);
  if (calendar.endDate === null) return false;
  if (typeof state?.currentDate !== 'string' || state.currentDate < calendar.endDate) return false;
  return calendar.status === 'finished';
}