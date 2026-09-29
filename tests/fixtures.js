/**
 * 测试夹具：最小世界数据（不依赖网络或文件系统，便于确定性测试）。
 * 名称均为占位，不含真实球队/球员信息。
 */

import { WORLD_FORMAT } from '../src/data/data-loader.js';

/** 一个合法的最小世界文件集合。 */
export function makeWorldFiles() {
  return {
    manifest: { id: 'w_test', name: 'Test World', version: '0.1.0', format: WORLD_FORMAT, startDate: '2026-07-01' },
    countries: [{ id: 'cty_a', name: 'Country A' }],
    leagues: [{ id: 'lg_a', name: 'League A', countryId: 'cty_a' }],
    teams: [{ id: 'clb_a', name: 'Team A', leagueId: 'lg_a' }],
    players: [{
      id: 'ply_a',
      name: 'Player A',
      teamId: 'clb_a',
      position: 'GK',
      birthDate: '2000-01-15',
      potential: { pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 80 },
      personality: { professionalism: 60, determination: 60, ambition: 60, consistency: 60, injuryProneness: 40 },
    }],
  };
}

/** 每队位置构成（1 GK / 5 DF / 5 MF / 3 FW）。 */
const SQUAD_SHAPE = [['GK', 1], ['DF', 5], ['MF', 5], ['FW', 3]];

/** 确定性种子（同 fixture 保证同结果，避免测试不稳定）。 */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function rnd(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * 生成一个可用于完整赛季模拟的最小联赛世界：单联赛、n 队、每队满编且带属性。
 * 名称与数值均为占位；属性按队伍基准强弱生成，保证比赛结果有可解释的实力差异。
 * @param {number} n 球队数
 */
export function makeLeagueWorldFiles(n = 8) {
  const teams = [];
  const players = [];
  let seq = 1;
  const pad = (x) => String(x).padStart(3, '0');

  for (let i = 0; i < n; i += 1) {
    const teamId = `clb_${pad(i + 1)}`;
    const base = Math.max(40, 80 - i * 3); // 递减基准，制造可解释的实力梯度
    teams.push({
      id: teamId,
      name: `Club ${pad(i + 1)}`,
      leagueId: 'lg_a',
      formation: '4-4-2',
      mentality: i % 4 === 0 ? 'attacking' : 'balanced',
    });
    for (const [position, count] of SQUAD_SHAPE) {
      for (let k = 0; k < count; k += 1) {
        const id = `ply_${pad(seq)}`;
        seq += 1;
        const attrs = {
          pace: base - 5,
          technique: base - 5,
          passing: base - 5,
          defending: position === 'FW' ? base - 25 : base - 5,
          finishing: position === 'DF' ? base - 25 : base - 5,
          goalkeeping: position === 'GK' ? base : 10,
        };
        // 成长/衰退字段（第 16 步）：确定性生成，potential ≥ 各属性基础值。
        const r = rnd(hash(id));
        const age = 17 + Math.floor(r() * 12); // 17..28
        const birthDate = `${2026 - age}-0${1 + Math.floor(r() * 6)}-1${Math.floor(r() % 9)}`;
        const potential = {};
        for (const a of Object.keys(attrs)) potential[a] = Math.min(99, attrs[a] + 8);
        const personality = {
          professionalism: 40 + Math.floor(r() * 50),
          determination: 40 + Math.floor(r() * 50),
          ambition: 40 + Math.floor(r() * 50),
          consistency: 40 + Math.floor(r() * 50),
          injuryProneness: 30 + Math.floor(r() * 50),
        };
        players.push({ id, name: `Player ${pad(seq - 1)}`, teamId, position, ...attrs, birthDate, potential, personality });
      }
    }
  }

  return {
    manifest: { id: 'w_league', name: 'League World', version: '0.1.0', format: WORLD_FORMAT, startDate: '2026-07-01' },
    countries: [{ id: 'cty_a', name: 'Country A' }],
    leagues: [{ id: 'lg_a', name: 'League A', countryId: 'cty_a', tier: 1 }],
    teams,
    players,
  };
}