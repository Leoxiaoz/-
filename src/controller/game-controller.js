/**
 * Game Controller（游戏控制器）。
 * 层级归属：Controller 层，是 UI 与核心之间的**唯一协调者**（组合根使用）。
 *
 * 职责：
 * - 编排 Data Layer（加载世界）、Simulation Core（推进）、Save Layer（读写）；
 * - 持有当前 Game State；
 * - 向 UI 提供只读快照与订阅通知。
 *
 * 约束（对应 game-architecture Skill）：
 * - 不实现任何模拟规则（规则在 Simulation Core）；
 * - 不直接操作 DOM；
 * - UI 不得绕过本控制器直接访问 Core / Data / Save。
 */

import { createGameState, initializeClubRuntime } from '../core/game-state.js';
import { sortTable } from '../core/standings.js';
import { initializePlayerRuntime, getTeamPlayers, getPlayerProfile, getPlayerRuntime, INJURY_STATUS } from '../core/player-runtime.js';
import { initializeMembership, assertMembershipValid, getClubLeague, getLeagueClubs } from '../core/membership.js';
import { buildAutoLineup } from '../core/team-strength.js';
import { cleanLineup, validateLineup, LINEUP_LIMITS } from '../core/player-lineup.js';
import { FORMATIONS, MENTALITY, DEFAULT_FORMATION } from '../core/sim-config.js';
import { AppError } from '../shared/errors.js';

/** 战术倾向的展示名（仅 UI 文案；键与 `MENTALITY` 一致）。 */
const MENTALITY_LABELS = Object.freeze({ defensive: '防守', balanced: '均衡', attacking: '进攻' });

export class GameController {
  /**
   * @param {{dataLoader: object, saveManager: object, simulation: object, logger?: object}} deps
   */
  constructor(deps) {
    if (!deps?.dataLoader || !deps?.saveManager || !deps?.simulation) {
      throw new AppError('GameController 需要 dataLoader / saveManager / simulation 依赖', {
        context: { has: Object.keys(deps ?? {}) },
      });
    }
    this.dataLoader = deps.dataLoader;
    this.saveManager = deps.saveManager;
    this.simulation = deps.simulation;
    this.logger = deps.logger ?? null;

    /** @type {object|null} 当前运行时状态 */
    this.state = null;
    /** @type {object|null} 已加载的静态世界 */
    this.world = null;
    this.worldDir = null;
    this.listeners = new Set();
  }

  /** 订阅状态变化；返回取消订阅函数。 */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit() {
    for (const listener of this.listeners) listener(this.getSnapshot());
  }

  /** @returns {object|null} */
  getState() {
    return this.state;
  }

  /** 面向 UI 的只读快照（UI 不直接接触内部结构）。 */
  getSnapshot() {
    if (!this.state) return null;
    const { static: world, runtime } = this.state;
    const teamName = (id) => world.teams.find((t) => t.id === id)?.name ?? id;
    return {
      worldId: this.state.worldId,
      worldName: world.manifest.name,
      currentDate: this.state.currentDate,
      season: this.state.season,
      teamsCount: world.teams.length,
      playersCount: world.players.length,
      eventsCount: runtime.events.length,
      // 玩家阵容 / 战术（第 20 步）
      managedClubId: runtime.managedClubId ?? null,
      clubs: world.teams.map((t) => ({ id: t.id, name: t.name, leagueId: getClubLeague(this.state, t.id) })),
      formations: Object.keys(FORMATIONS),
      mentalities: Object.keys(MENTALITY).map((k) => ({ value: k, label: MENTALITY_LABELS[k] ?? k })),
      managedClub: this.#managedClubView(),
      leagues: world.leagues.map((l) => {
        const comp = runtime.competitions[l.id];
        return {
          id: l.id,
          name: l.name,
          teamsCount: getLeagueClubs(this.state, l.id).length,
          status: comp?.status ?? 'empty',
          competitionSeason: comp?.season ?? this.state.season,
          matchesPerRound: comp ? comp.fixtures.filter((f) => f.round === 1).length : 0,
          totalRounds: comp ? Math.max(0, ...comp.fixtures.map((f) => f.round)) : 0,
          table: comp
            ? sortTable(comp.table).map((row) => ({ ...row, teamName: teamName(row.teamId) }))
            : [],
          // 上赛季最终排名（若已滚动过赛季）
          lastSeason: (() => {
            const history = comp?.history ?? [];
            if (history.length === 0) return null;
            const last = history[history.length - 1];
            const ranked = sortTable(last.table).map((row) => ({ ...row, teamName: teamName(row.teamId) }));
            return { season: last.season, champion: ranked[0]?.teamName ?? null, table: ranked };
          })(),
          // 最近赛果（按轮次倒序取 6 场，便于移动端呈现）
          recentResults: comp
            ? comp.fixtures
              .filter((f) => f.played)
              .slice(-6)
              .reverse()
              .map((f) => ({
                round: f.round,
                date: f.date,
                homeName: teamName(f.homeId),
                awayName: teamName(f.awayId),
                homeGoals: f.homeGoals,
                awayGoals: f.awayGoals,
              }))
            : [],
        };
      }),
    };
  }

  /**
   * 构造玩家管理球队的只读视图（供 UI 呈现）。未选择管理球队时返回 null。
   * 仅做数据整形，不含模拟规则。
   */
  #managedClubView() {
    const clubId = this.state?.runtime?.managedClubId;
    if (!clubId) return null;
    const club = this.state.runtime.clubs[clubId];
    const team = this.state.static.teams.find((t) => t.id === clubId);
    if (!club || !team) return null;

    const info = (playerId) => {
      const profile = getPlayerProfile(this.state, playerId);
      const rt = getPlayerRuntime(this.state, playerId);
      return {
        playerId,
        name: profile?.name ?? playerId,
        position: profile?.position ?? '?',
        injured: rt?.injury?.status === INJURY_STATUS.INJURED,
      };
    };
    const lineup = cleanLineup(this.state, clubId, club.lineup ?? { starters: [], bench: [] });
    const starters = lineup.starters.map(info);
    const bench = lineup.bench.map(info);
    const starterIds = new Set(lineup.starters);
    const benchIds = new Set(lineup.bench);
    const squad = getTeamPlayers(this.state, clubId)
      .map((p) => ({ ...info(p.id), zone: starterIds.has(p.id) ? 'starters' : benchIds.has(p.id) ? 'bench' : 'none' }))
      .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));

    return {
      id: clubId,
      name: team.name,
      formation: club.tactics?.formation ?? DEFAULT_FORMATION,
      mentality: club.tactics?.mentality ?? 'balanced',
      starters,
      bench,
      squad,
      limits: { starters: LINEUP_LIMITS.STARTERS, bench: LINEUP_LIMITS.BENCH },
      issues: validateLineup(this.state, clubId, lineup),
    };
  }

  /**
   * 开新档：加载世界 → 建立运行时状态。
   * @param {string} worldDir
   * @param {{date?: string, season?: number}} [options]
   */
  async startNewGame(worldDir, options = {}) {
    this.world = await this.dataLoader.loadWorld(worldDir);
    this.worldDir = worldDir;
    this.state = createGameState(this.world, options);
    this.logger?.info?.(`新世界已建立：${this.state.worldId} @ ${this.state.currentDate}`);
    this.#emit();
    return this.state;
  }

  /** 推进模拟时间（规则由 Simulation Core 负责）。 */
  tick() {
    this.#requireRunning();
    this.simulation.advanceDay(this.state);
    this.#emit();
    return this.state;
  }

  /** 推进 N 天（用于快速跳过无比赛日）。 */
  advanceDays(days) {
    this.#requireRunning();
    this.simulation.advanceDays(this.state, days);
    this.#emit();
    return this.state;
  }

  /**
   * 保存到存档槽。
   * @param {string} [slot]
   */
  async save(slot = 'slot1') {
    this.#requireRunning();
    await this.saveManager.save(slot, this.state);
    this.logger?.info?.(`已保存到存档槽 ${slot}`);
    return slot;
  }

  /**
   * 从存档槽读取。存档只含「引用 + 增量」，因此需要当前世界重新构建运行时状态，
   * 再叠加增量（对应 SAVE_SPEC §3）。这里**不**更换数据库，也不覆盖世界。
   * @param {string} [slot]
   */
  async load(slot = 'slot1') {
    const payload = await this.saveManager.load(slot);
    if (!this.world) {
      throw new AppError('读取存档前需要先加载一个世界', { context: { slot } });
    }
    if (payload.worldId !== this.world.manifest.id) {
      throw new AppError('存档所属世界与当前世界不一致', {
        context: { saveWorld: payload.worldId, currentWorld: this.world.manifest.id },
      });
    }
    this.state = createGameState(this.world, {
      date: payload.currentDate,
      season: payload.season,
    });
    this.state.runtime = payload.runtime ?? this.state.runtime;
    // 补齐/兼容球员运行时状态：保留旧档已有值，仅补缺失字段（第 15 步；不覆盖静态库）。
    // 内部会调用 initializeMembership 从静态/新生代种子建立运行期成员关系（G0）。
    initializePlayerRuntime(this.state);
    // 补齐/兼容俱乐部运行时（阵型/战术/阵容容器/managedClubId；第 20 步）。
    initializeClubRuntime(this.state);
    // 读档后显式校验运行期成员关系（G0）：致命问题必须报错，不静默继续模拟。
    initializeMembership(this.state);
    assertMembershipValid(this.state);
    this.logger?.info?.(`已读取存档槽 ${slot}`);
    this.#emit();
    return this.state;
  }

  async listSaves() {
    return this.saveManager.list();
  }

  // ---------------------------------------------------------------------------
  // 玩家阵容 / 战术（第 20 步）。均只操作 runtime，不触碰比赛算法。
  // ---------------------------------------------------------------------------

  /** 返回当前玩家管理球队 id（未选择时为 null）。 */
  getManagedClubId() {
    return this.state?.runtime?.managedClubId ?? null;
  }

  /**
   * 选择/取消管理球队（玩家主动选择后才进入玩家阵容模式）。
   * @param {string|null} clubId 传 null/'' 表示取消管理
   * @returns {{success: boolean, issues?: string[]}}
   */
  setManagedClub(clubId) {
    this.#requireRunning();
    if (clubId == null || clubId === '') {
      this.state.runtime.managedClubId = null;
      this.#emit();
      return { success: true };
    }
    if (!this.state.runtime.clubs[clubId]) {
      return { success: false, issues: ['球队不存在'] };
    }
    this.state.runtime.managedClubId = clubId;
    this.#emit();
    return { success: true };
  }

  /**
   * 设置阵型（仅管理球队）。变更后已保存首发保持；比赛时按新阵型严格修复。
   * @returns {{success: boolean, issues?: string[]}}
   */
  setFormation(clubId, formation) {
    this.#requireRunning();
    if (!FORMATIONS[formation]) return { success: false, issues: ['未知阵型'] };
    const club = this.state.runtime.clubs[clubId];
    if (!club) return { success: false, issues: ['球队不存在'] };
    club.tactics ??= {};
    club.tactics.formation = formation;
    this.#emit();
    return { success: true };
  }

  /**
   * 设置战术倾向（仅管理球队）。
   * @returns {{success: boolean, issues?: string[]}}
   */
  setMentality(clubId, mentality) {
    this.#requireRunning();
    if (!(mentality in MENTALITY)) return { success: false, issues: ['未知战术倾向'] };
    const club = this.state.runtime.clubs[clubId];
    if (!club) return { success: false, issues: ['球队不存在'] };
    club.tactics ??= {};
    club.tactics.mentality = mentality;
    this.#emit();
    return { success: true };
  }

  /**
   * 保存一份玩家阵容（先清洗引用，再返回可解释的问题列表）。
   * 清洗：剔除不存在/退役/非本队/重复引用，去重首发与替补，截断容量。
   * @param {string} clubId
   * @param {{starters?: string[], bench?: string[]}} lineup
   * @returns {{success: boolean, issues: string[]}}
   */
  setLineup(clubId, lineup = {}) {
    this.#requireRunning();
    const club = this.state.runtime.clubs[clubId];
    if (!club) return { success: false, issues: ['球队不存在'] };
    const cleaned = cleanLineup(this.state, clubId, lineup);
    const issues = validateLineup(this.state, clubId, cleaned);
    club.lineup = cleaned;
    this.#emit();
    return { success: true, issues };
  }

  /**
   * 把一名球员加入首发/替补，或移出阵容（zone = 'starters' | 'bench' | 'none'）。
   * @returns {{success: boolean, issues: string[]}}
   */
  assignLineupPlayer(clubId, playerId, zone) {
    this.#requireRunning();
    const club = this.state.runtime.clubs[clubId];
    if (!club) return { success: false, issues: ['球队不存在'] };
    const rosterIds = new Set(getTeamPlayers(this.state, clubId).map((p) => p.id));
    if (!rosterIds.has(playerId)) return { success: false, issues: ['球员不在该队或已不可用'] };

    const current = cleanLineup(this.state, clubId, club.lineup ?? { starters: [], bench: [] });
    const starters = current.starters.filter((id) => id !== playerId);
    const bench = current.bench.filter((id) => id !== playerId);
    if (zone === 'starters') {
      if (starters.length >= LINEUP_LIMITS.STARTERS) return { success: false, issues: ['首发已满'] };
      starters.push(playerId);
    } else if (zone === 'bench') {
      if (bench.length >= LINEUP_LIMITS.BENCH) return { success: false, issues: ['替补席已满'] };
      bench.push(playerId);
    }
    return this.setLineup(clubId, { starters, bench });
  }

  /**
   * 以当前阵型自动填充管理球队阵容（首发 = 自动选阵；替补 = 剩余球员综合评分前 N）。
   * @returns {{success: boolean, issues: string[]}}
   */
  autoFillManagedLineup() {
    this.#requireRunning();
    const clubId = this.state.runtime.managedClubId;
    if (!clubId) return { success: false, issues: ['尚未选择管理球队'] };
    const club = this.state.runtime.clubs[clubId];
    const lineup = buildAutoLineup(this.state, clubId, club?.tactics ?? {});
    return this.setLineup(clubId, lineup);
  }

  #requireRunning() {
    if (!this.state) {
      throw new AppError('当前没有运行中的世界，请先开始新游戏');
    }
  }
}