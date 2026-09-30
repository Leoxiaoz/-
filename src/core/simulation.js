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
import { computeTeamStrength, resolveMatchSquad } from './team-strength.js';
import { repairManagedLineups } from './player-lineup.js';
import { simulateMatch } from './match.js';
import { applyResult } from './standings.js';
import { createLeagueRuntime, getClubRuntime, recordEvent } from './game-state.js';
import { isSeasonBoundaryReached } from './season.js';
import {
  resetSeasonStats,
  recordAppearance,
  getPlayerRuntime,
  getEffectiveAttributes,
  setVitals,
} from './player-runtime.js';
import { developPlayers } from './player-growth.js';
import { runPlayerLifecycle } from './player-lifecycle.js';
import { replenishTransferBudget } from './finance.js';
import { runSeasonAI } from './ai/ai-decide.js';
import { tickInjuries, resolveMatchInjuries } from './player-injury.js';
import { SCHEDULE_CONFIG, MATCH_LOAD_CONFIG } from './sim-config.js';

export class SimulationCore {
  /** @param {{logger?: object, trainingFactor?: Function, enableAI?: boolean}} [deps] */
  constructor(deps = {}) {
    this.logger = deps.logger ?? null;
    /** 训练修正预留接口（B1）；缺省由 player-growth 使用 1.0。 */
    this.trainingFactor = deps.trainingFactor ?? null;
    /** AI Club Decision Framework v1（Step 31）：缺省启用；置 false 可在测试中隔离非 AI 子系统。 */
    this.enableAI = deps.enableAI !== false;
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
    // 伤病生命周期：每日递减 → 自动恢复（第 17 步，确定性）。
    tickInjuries(state);
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

    // 赛后生态反馈（G1a）：统一消费 MatchResult.involvements（不再扫描 squadIds / 事件推导统计）。
    this.#applyPostMatch(state, result);

    // 赛后最小伤病判定（第 17 步；不重构比赛模拟，不用首发/换人）。
    resolveMatchInjuries(state, {
      fixtureId: fixture.id,
      season: comp.season,
      round: fixture.round,
      homeId: fixture.homeId,
      awayId: fixture.awayId,
    });
  }

  /**
   * 赛后生态反馈（G1a，统一入口）：消费比赛产出的 `MatchResult.involvements`，
   * 为每名参与球员记录出场（分钟/进球/助攻/牌）并施加体能消耗与状态建立。
   * 未出场球员不写入 involvements，因而天然不会被记为出场。
   * 球员选择仍由 `resolveMatchSquad` 决定（Step 20，不变）；本层不再解析阵容或扫描事件。
   */
  #applyPostMatch(state, result) {
    for (const [playerId, inv] of Object.entries(result.involvements ?? {})) {
      recordAppearance(state, playerId, {
        minutes: inv.minutes,
        goals: inv.goals,
        assists: inv.assists,
        yellow: inv.yellow,
        red: inv.red,
        // Step 21-A：表现字段（射门/射正/评分），仅经 involvements 传递，不新增并行写入链。
        shots: inv.shots,
        shotsOnTarget: inv.shotsOnTarget,
        rating: inv.rating,
      });
      const rt = getPlayerRuntime(state, playerId);
      if (!rt) continue;
      setVitals(state, playerId, {
        fitness: rt.fitness - MATCH_LOAD_CONFIG.FITNESS_COST,
        form: rt.form
          + (MATCH_LOAD_CONFIG.FORM_BASELINE - rt.form) * MATCH_LOAD_CONFIG.FORM_RECOVER_RATE,
      });
    }
  }

  #buildSide(state, teamId) {
    const club = getClubRuntime(state, teamId);
    const tactics = club?.tactics ?? {};
    // 出场集合 = 比赛模拟实际使用的球员（第 20 步统一入口：玩家管理球队用已保存阵容，其余自动选阵）。
    const squad = resolveMatchSquad(state, teamId, tactics);
    return {
      teamId,
      tactics,
      // 实力必须基于**本场实际出场集合**，玩家阵容/阵型变化才能真实影响比赛。
      strength: computeTeamStrength(state, teamId, tactics, squad),
      // 传给比赛引擎的球员带**有效属性**（基础 + deltas，已夹取潜力上限），
      // 使 `selectScorer` 按球员当前能力（而非静态基础）判分；
      // 参与统计改由 match 产出 `involvements`（G1a），本层不再单独维护 squadIds。
      players: squad.map((p) => ({
        id: p.id,
        position: p.position,
        ...getEffectiveAttributes(state, p.id),
      })),
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

  /**
   * 赛季滚动（G1b①）：由**显式赛季边界**驱动（`season.js` 的派生日历）。
   * 单联赛下：日历到达边界（最后一轮比赛日 + 全部赛完）⇒ 归档当前赛季 → 创建下一赛季 →
   * 更新 `state.season` → 执行**一次**全局赛季副作用（顺序不变）。
   * 行为与改造前等价（同一日触发；prevSeason/nextSeason 数值不变）。
   */
  #rollFinishedSeasons(state) {
    if (!isSeasonBoundaryReached(state)) return;
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
    // 赛季推进顺序（第 15/16/19 步；顺序不可交换）：
    //   1) 结算上一赛季成长 → 2) 退役+归档 → 3) 计算缺口并生成属于下一赛季的新生代
    //   → 4) AI Club Decision（Step 31；仅非 managed 俱乐部）→ 5) 修复玩家阵容 → 6) 重置本赛季统计。
    if (maxSeason > prevSeason) {
      developPlayers(state, {
        seasonNumber: prevSeason,
        training: this.trainingFactor ?? undefined,
      });
      runPlayerLifecycle(state, { fromSeason: prevSeason, toSeason: maxSeason });
      // Step 34 / D-33.15：transferBudget 再生（Population 稳定后、AI 决策前；每赛季边界恰好一次）。
      replenishTransferBudget(state);
      // AI Club Decision Framework v1（Step 31 / D-28）：Population Health 完成后、lineup repair 前。
      if (this.enableAI) runSeasonAI(state);
      // 退役/离队后修复玩家阵容：剔除失效引用、去重、保持容量（第 20 步）。
      repairManagedLineups(state);
      resetSeasonStats(state, maxSeason);
    }
  }
}