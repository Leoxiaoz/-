/**
 * Simulation Core（模拟核心门面）。
 * 层级归属：Simulation Core 层。纯逻辑，**不依赖 DOM / 存储 / UI**。
 *
 * 本阶段范围（MVP，DECISIONS D-09）：编排「时间推进 → 比赛日结算 → 赛季滚动」这条最小闭环。
 * 明确不实现：训练、成长、转会、财政、AI 决策、新闻等（后续阶段）。
 *
 * 比赛引擎按 SIMULATION_SPEC §1 拆为可独立替换的阶段（见 match.js / team-strength.js /
 * standings.js / schedule.js），本类只做编排，不含比赛算法本身。
 */

import { SimulationError } from '../shared/errors.js';
import { addDays } from './date-utils.js';
import { computeTeamStrength } from './team-strength.js';
import { simulateMatch } from './match.js';
import { applyResult } from './standings.js';
import { createLeagueRuntime, getClubRuntime, recordEvent } from './game-state.js';
import { resetSeasonStats } from './player-runtime.js';
import { SCHEDULE_CONFIG } from './sim-config.js';

export class SimulationCore {
  /** @param {{logger?: object}} [deps] */
  constructor(deps = {}) {
    this.logger = deps.logger ?? null;
  }

  /**
   * 推进一个模拟日：推进日期 → 结算当日到期的比赛 → 必要时滚动赛季。
   * @param {object} state 运行时状态
   * @returns {object} 同一个 state（原地更新）
   */
  advanceDay(state) {
    if (!state || typeof state.currentDate !== 'string') {
      throw new SimulationError('advanceDay 需要包含 currentDate 的运行时状态', {
        context: { received: typeof state },
      });
    }
    state.currentDate = addDays(state.currentDate, 1);
    this.playDueFixtures(state);
    this.#rollFinishedSeasons(state);
    return state;
  }

  /** 推进多个模拟日。 */
  advanceDays(state, days) {
    if (!Number.isInteger(days) || days < 0) {
      throw new SimulationError('advanceDays 需要非负整数天数', { context: { days } });
    }
    for (let i = 0; i < days; i += 1) this.advanceDay(state);
    return state;
  }

  /**
   * 结算所有「已到期且未进行」的比赛（日期 <= 当前日期）。
   * 用 `<=` 而非 `==`，保证不会因某天未推进而漏赛。
   */
  playDueFixtures(state) {
    for (const comp of Object.values(state.runtime.competitions)) {
      for (const fixture of comp.fixtures) {
        if (fixture.played || fixture.date > state.currentDate) continue;
        this.#playFixture(state, comp, fixture);
      }
      this.#updateStatus(comp);
    }
  }

  #playFixture(state, comp, fixture) {
    const home = this.#buildSide(state, fixture.homeId);
    const away = this.#buildSide(state, fixture.awayId);
    const result = simulateMatch({
      home,
      away,
      context: {
        worldId: state.worldId,
        season: comp.season,
        round: fixture.round,
        homeId: fixture.homeId,
        awayId: fixture.awayId,
      },
    });

    fixture.played = true;
    fixture.homeGoals = result.homeGoals;
    fixture.awayGoals = result.awayGoals;
    applyResult(comp.table, fixture.homeId, fixture.awayId, result.homeGoals, result.awayGoals);

    recordEvent(state, 'match_played', {
      leagueId: comp.leagueId,
      season: comp.season,
      round: fixture.round,
      fixtureId: fixture.id,
      homeId: fixture.homeId,
      awayId: fixture.awayId,
      score: `${result.homeGoals}-${result.awayGoals}`,
    });
  }

  #buildSide(state, teamId) {
    const club = getClubRuntime(state, teamId);
    const tactics = club?.tactics ?? {};
    return {
      teamId,
      tactics,
      strength: computeTeamStrength(state, teamId, tactics),
      players: state.static.players.filter((p) => p.teamId === teamId),
    };
  }

  #updateStatus(comp) {
    const allPlayed = comp.fixtures.length > 0 && comp.fixtures.every((f) => f.played);
    if (allPlayed) {
      comp.status = 'finished';
    } else if (comp.fixtures.some((f) => f.played)) {
      comp.status = 'in_progress';
    }
  }

  /** 赛季滚动：某联赛全部赛完则归档本季积分榜并生成下一赛季赛程（运行时，确定性）。 */
  #rollFinishedSeasons(state) {
    const prevSeason = state.season;
    let maxSeason = state.season;
    for (const comp of Object.values(state.runtime.competitions)) {
      if (comp.status !== 'finished') continue;
      const nextSeason = comp.season + 1;
      const startDate = addDays(state.currentDate, SCHEDULE_CONFIG.SEASON_GAP_DAYS);
      const next = createLeagueRuntime(state, comp.leagueId, {
        season: nextSeason,
        startDate,
      });
      // 归档本季最终积分榜，保留回看能力（可解释性，第 22 条）。
      next.history = [
        ...(comp.history ?? []),
        { season: comp.season, table: comp.table },
      ];
      state.runtime.competitions[comp.leagueId] = next;
      recordEvent(state, 'season_started', { leagueId: comp.leagueId, season: nextSeason, startDate });
      if (nextSeason > maxSeason) maxSeason = nextSeason;
    }
    state.season = maxSeason;
    // 赛季推进时重置「本赛季统计」（职业生涯统计已增量累加，不受影响；第 15 步）。
    if (maxSeason > prevSeason) resetSeasonStats(state, maxSeason);
  }
}