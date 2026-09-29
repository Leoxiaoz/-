/**
 * 赛季日历与赛季边界（Season Calendar）—— G1b①。
 * 层级归属：Simulation Core。**叶子模块**：只读 state，不修改任何状态、不依赖 DOM/存储/UI、无随机。
 *
 * 目标：把"某竞赛 finished → 推进 state.season → 执行全局赛季副作用"的**隐式**约定，
 * 升级为显式的「赛季日历 + 赛季边界」概念；**当前仅支持单联赛**（唯一 competition 投影）。
 *
 * 约束（G1b①）：
 * - `SeasonCalendar` 是**派生视图**，**不写入存档**（由竞赛运行时确定性投影）。
 * - 不改 `state.season` 字段名/持久化；单联赛下 `state.season ≡ competition.season ≡ calendar.season`。
 * - 边界判据：`endDate !== null && currentDate >= endDate && status === 'finished'`（不得用 `>`，避免晚一天）。
 * - 多联赛 / 杯赛 / 淘汰赛属 G1b②，本模块暂不处理。
 */

/**
 * 取当前赛季日历（单联赛投影）。
 * 规则：
 * - `season`   = competition.season
 * - `startDate`= competition.seasonStart
 * - `endDate`  = max(competition.fixtures[].date)；无有效赛程时为 null
 * - `status`   = 有赛程时与 competition 状态一致（scheduled/in_progress/finished）；
 *                无赛程时为 'finished'（若 comp 已 finished）否则 'empty'
 * @param {object} state
 * @returns {{season: number, startDate: string|null, endDate: string|null, status: string}}
 */
export function getSeasonCalendar(state) {
  const fallbackSeason = Number.isInteger(state?.season) ? state.season : 1;
  const competitions = state?.runtime?.competitions ?? {};
  const ids = Object.keys(competitions).sort(); // 确定性：多竞赛时取 id 升序首个
  if (ids.length === 0) {
    return { season: fallbackSeason, startDate: null, endDate: null, status: 'empty' };
  }
  const comp = competitions[ids[0]];
  const season = Number.isInteger(comp?.season) ? comp.season : fallbackSeason;
  const startDate = typeof comp?.seasonStart === 'string' ? comp.seasonStart : null;
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