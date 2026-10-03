/**
 * 积分榜（Simulation Core）。
 * 对应 SIMULATION_SPEC §1 阶段 11（Post-match Processing 的积分部分）。
 * 纯函数：给定赛果集合，确定性地产出排名。
 */

import { TABLE_CONFIG } from './sim-config.js';

/**
 * 建立空积分榜。
 * @param {string[]} teamIds
 * @returns {Record<string, {played:number, won:number, drawn:number, lost:number, gf:number, ga:number, gd:number, points:number}>}
 */
export function createTable(teamIds) {
  const table = {};
  for (const id of teamIds) {
    table[id] = { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 };
  }
  return table;
}

/**
 * 把一场赛果计入积分榜（原地更新）。
 * @param {object} table
 * @param {string} homeId
 * @param {string} awayId
 * @param {number} homeGoals
 * @param {number} awayGoals
 */
export function applyResult(table, homeId, awayId, homeGoals, awayGoals) {
  const home = table[homeId];
  const away = table[awayId];
  if (!home || !away) return;

  home.played += 1;
  away.played += 1;
  home.gf += homeGoals;
  home.ga += awayGoals;
  away.gf += awayGoals;
  away.ga += homeGoals;

  if (homeGoals > awayGoals) {
    home.won += 1;
    away.lost += 1;
    home.points += TABLE_CONFIG.WIN;
    away.points += TABLE_CONFIG.LOSS;
  } else if (homeGoals < awayGoals) {
    away.won += 1;
    home.lost += 1;
    away.points += TABLE_CONFIG.WIN;
    home.points += TABLE_CONFIG.LOSS;
  } else {
    home.drawn += 1;
    away.drawn += 1;
    home.points += TABLE_CONFIG.DRAW;
    away.points += TABLE_CONFIG.DRAW;
  }

  home.gd = home.gf - home.ga;
  away.gd = away.gf - away.ga;
}

/**
 * 按 积分 → 净胜球 → 进球 → ID 的确定性顺序排序。
 * @returns {Array<{teamId: string} & object>}
 */
export function sortTable(table) {
  return Object.entries(table)
    .map(([teamId, row]) => ({ teamId, ...row }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.teamId < b.teamId ? -1 : 1;
    });
}