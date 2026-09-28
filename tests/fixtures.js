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
    players: [{ id: 'ply_a', name: 'Player A', teamId: 'clb_a', position: 'GK' }],
  };
}