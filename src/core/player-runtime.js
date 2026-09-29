/**
 * 球员运行时状态（Player Runtime State）。
 * 层级归属：Simulation Core。纯数据 + 纯函数，**不依赖 DOM / 存储 / UI**。
 *
 * 边界（决策 A3 / DATABASE_SPEC §4 / DECISIONS D-13）：
 * - 静态库（只读，禁止回写）负责：基础属性、位置、出生日期、潜力等**不随时间变化**的信息。
 * - 运行时状态（进存档）负责：能力增减、体能、状态、士气、伤病、出场/比赛统计、
 *   本赛季统计、职业生涯统计。
 * - 两者以**稳定 playerId** 关联（决策 A4）。本模块从不写入 `state.static`。
 *
 * 范围（第 15 步）：只建立**可靠的数据结构与接口**；**不实现**成长 / 伤病生成 / 体能恢复
 * 等**算法**——这些属 SIMULATION_SPEC §7–§9、§13–§15 的 `[TBD]` 模型，须待制定者决策。
 * 本模块提供的写入接口均为**数据结构级**操作（创建 / 读取 / 记录 / 设值 / 夹取），
 * 不含任何模拟模型或隐藏系数。
 *
 * 预留扩展点（字段已就位，算法后续接入）：
 * - 成长：`ability.deltas` + `applyAbilityDelta()`（SIMULATION_SPEC §2/§14）。
 * - 伤病：`injury` + `applyInjury()` / `recoverInjury()`（§12）。
 * - 体能 / 状态 / 士气：`fitness` / `form` / `morale` + `setVitals()`（§7–§9）。
 * - 比赛统计：`stats` + `recordAppearance()`（§1 阶段 11；待比赛引擎产出首发/换人后接入）。
 * - 合同 / 转会：属独立实体（DATABASE_SPEC §2），不在本状态内冗余持有（决策 A6）。
 */

import { SimulationError } from '../shared/errors.js';
import { PLAYER_ATTRIBUTES, ATTRIBUTE_DEFAULT, ATTRIBUTE_RANGE } from '../shared/football-schema.js';
import { PLAYER_RUNTIME_CONFIG, INJURY_CONFIG } from './sim-config.js';

/** 伤病状态枚举。 */
export const INJURY_STATUS = Object.freeze({ FIT: 'fit', INJURED: 'injured' });

const { VITALS, MAX_MINUTES_PER_MATCH } = PLAYER_RUNTIME_CONFIG;

/** 按缺阵天数归类严重度（配置驱动；第 17 步）。 */
export function severityForDays(days) {
  const d = Number(days) || 0;
  for (const band of INJURY_CONFIG.SEVERITY_BANDS) {
    if (d <= band.maxDays) return band.name;
  }
  return INJURY_CONFIG.SEVERITY_BANDS[INJURY_CONFIG.SEVERITY_BANDS.length - 1].name;
}

/** 把数值夹取到 [min, max]；非有限值回退到 fallback。 */
function clamp(value, min, max, fallback) {
  const v = Number(value);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/** 建立一条空统计线（出场 / 分钟 / 进球 / 助攻）。 */
export function createStatLine() {
  return { appearances: 0, minutes: 0, goals: 0, assists: 0 };
}

/** 规范化统计线：缺字段补 0，非法值夹取为非负整数。 */
function normalizeStatLine(line) {
  const src = line && typeof line === 'object' ? line : {};
  const safe = (v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    appearances: safe(src.appearances),
    minutes: safe(src.minutes),
    goals: safe(src.goals),
    assists: safe(src.assists),
  };
}

/** 建立默认伤病状态（健康）。 */
function createInjury() {
  return {
    status: INJURY_STATUS.FIT,
    type: null,
    category: null,
    severity: null,
    daysRemaining: 0,
    totalDays: 0,
    since: null,
  };
}

/** 规范化伤病状态（向后兼容：旧档缺字段时兜底为健康；第 17 步新增字段可缺省）。 */
function normalizeInjury(injury) {
  if (!injury || typeof injury !== 'object') return createInjury();
  const status = injury.status === INJURY_STATUS.INJURED ? INJURY_STATUS.INJURED : INJURY_STATUS.FIT;
  const daysRemaining = Math.max(0, Math.floor(Number(injury.daysRemaining) || 0));
  const totalDays = Math.max(0, Math.floor(Number(injury.totalDays) || daysRemaining));
  return {
    status,
    type: status === INJURY_STATUS.INJURED ? (injury.type ?? null) : null,
    category: status === INJURY_STATUS.INJURED ? (injury.category ?? null) : null,
    severity: status === INJURY_STATUS.INJURED
      ? (injury.severity ?? severityForDays(totalDays || daysRemaining))
      : null,
    daysRemaining,
    totalDays: status === INJURY_STATUS.INJURED ? totalDays : 0,
    since: status === INJURY_STATUS.INJURED ? (injury.since ?? null) : null,
  };
}

/** 建立默认伤病历史（定长、有界；第 17 步）。 */
function createInjuryHistory() {
  return { recurrenceCount: 0, lastInjuryDate: null, lastInjuryType: null };
}
/** 规范化伤病历史（旧档缺省兜底）。 */
function normalizeInjuryHistory(history) {
  if (!history || typeof history !== 'object') return createInjuryHistory();
  return {
    recurrenceCount: Math.max(0, Math.floor(Number(history.recurrenceCount) || 0)),
    lastInjuryDate: history.lastInjuryDate ?? null,
    lastInjuryType: history.lastInjuryType ?? null,
  };
}

/**
 * 创建一名球员的运行时状态（不从静态库复制属性，只存增减与状态）。
 * @param {string} playerId 稳定球员 ID（关联静态库，A4）
 * @param {{seasonNumber?: number}} [options]
 */
export function createPlayerRuntime(playerId, options = {}) {
  if (typeof playerId !== 'string' || playerId.length === 0) {
    throw new SimulationError('createPlayerRuntime 需要非空 playerId', {
      context: { received: typeof playerId },
    });
  }
  return {
    playerId,
    // 当前能力 = 静态基础属性 + 本增减（成长算法属 TBD，MVP 保持为空）。
    ability: { deltas: {} },
    // 体能 / 状态 / 士气（0–100，与属性 1–99 为不同量表）。
    fitness: VITALS.INITIAL_FITNESS,
    form: VITALS.INITIAL_FORM,
    morale: VITALS.INITIAL_MORALE,
    injury: createInjury(),
    injuryHistory: createInjuryHistory(),
    stats: {
      seasonNumber: Number.isInteger(options.seasonNumber) ? options.seasonNumber : 1,
      season: createStatLine(),
      career: createStatLine(),
    },
    // 成长结算元数据（第 16 步）：上次结算赛季 + 长期伤病导致的成长放缓剩余赛季数。
    growth: { lastEvaluatedSeason: 0, injuryPenaltySeasons: 0 },
  };
}

/** 在保留已有运行时值的前提下，补齐缺失字段（向后兼容 A5；不得覆盖已有值）。 */
function normalizePlayerRuntime(existing, playerId, seasonNumber) {
  const base = createPlayerRuntime(playerId, { seasonNumber });
  if (!existing || typeof existing !== 'object') return base;
  const deltas = existing.ability?.deltas;
  return {
    playerId,
    ability: {
      deltas: deltas && typeof deltas === 'object' ? { ...deltas } : {},
    },
    fitness: clamp(existing.fitness, VITALS.MIN, VITALS.MAX, base.fitness),
    form: clamp(existing.form, VITALS.MIN, VITALS.MAX, base.form),
    morale: clamp(existing.morale, VITALS.MIN, VITALS.MAX, base.morale),
    injury: normalizeInjury(existing.injury),
    injuryHistory: normalizeInjuryHistory(existing.injuryHistory),
    stats: {
      seasonNumber: Number.isInteger(existing.stats?.seasonNumber)
        ? existing.stats.seasonNumber
        : base.stats.seasonNumber,
      season: normalizeStatLine(existing.stats?.season),
      career: normalizeStatLine(existing.stats?.career),
    },
    growth: {
      lastEvaluatedSeason: Math.max(0, Math.floor(Number(existing.growth?.lastEvaluatedSeason) || 0)),
      injuryPenaltySeasons: Math.max(0, Math.floor(Number(existing.growth?.injuryPenaltySeasons) || 0)),
    },
  };
}

/**
 * 为世界中的所有静态球员建立运行时状态（幂等）。
 * - 缺失的球员：按静态 ID 新建；
 * - 已存在的球员：**保留其值**，仅补齐缺失字段（读取旧档后调用即完成兼容）。
 * 不修改 `state.static`（红线：静态库只读）。
 * @param {object} state 运行时状态
 * @returns {object} state（原地）
 */
export function initializePlayerRuntime(state) {
  if (!state || !state.static || !Array.isArray(state.static.players) || !state.runtime) {
    throw new SimulationError('initializePlayerRuntime 需要包含 static.players 与 runtime 的状态', {
      context: { received: typeof state },
    });
  }
  state.runtime.players ??= {};
  state.runtime.generated ??= {};
  state.runtime.retired ??= {};
  // 生成序号：不得回退（取存档值与已生成记录最大序号中的较大者）。
  const maxSeq = maxGeneratedSequence(state.runtime.generated);
  const savedSeq = Number(state.runtime.nextGeneratedSeq);
  state.runtime.nextGeneratedSeq = Math.max(
    Number.isInteger(savedSeq) && savedSeq >= 0 ? savedSeq : 0,
    maxSeq,
  );
  // 人口目标快照：旧档缺失时依据世界补齐（第 19 步）。
  if (!state.runtime.populationTarget || typeof state.runtime.populationTarget !== 'object') {
    state.runtime.populationTarget = computePopulationTarget(state.static);
  }
  const seasonNumber = state.season ?? 1;
  // 静态球员：**跳过已退役者**（避免读档时把退役球员"复活"）。
  for (const player of state.static.players) {
    if (isRetired(state, player.id)) {
      delete state.runtime.players[player.id];
      continue;
    }
    state.runtime.players[player.id] = normalizePlayerRuntime(
      state.runtime.players[player.id],
      player.id,
      seasonNumber,
    );
  }
  // 新生代（active）：补齐运行时状态。
  for (const g of Object.values(state.runtime.generated)) {
    if (!g || typeof g.playerId !== 'string') continue;
    if (isRetired(state, g.playerId)) {
      delete state.runtime.players[g.playerId];
      continue;
    }
    state.runtime.players[g.playerId] = normalizePlayerRuntime(
      state.runtime.players[g.playerId],
      g.playerId,
      seasonNumber,
    );
  }
  return state;
}

/**
 * 依世界初始静态球员，按球队推导「人口目标快照」（第 19 步）。
 * `target(club) = 该队世界创建时的初始球员数`（含按位置明细）；数据驱动，不硬编码规模。
 * @param {{teams: any[], players: any[]}} world
 * @returns {Record<string, {total: number, byPosition: Record<string, number>}>}
 */
export function computePopulationTarget(world) {
  const target = {};
  for (const team of world.teams) {
    const byPosition = { GK: 0, DF: 0, MF: 0, FW: 0 };
    for (const player of world.players) {
      if (player.teamId === team.id && byPosition[player.position] != null) {
        byPosition[player.position] += 1;
      }
    }
    target[team.id] = {
      total: byPosition.GK + byPosition.DF + byPosition.MF + byPosition.FW,
      byPosition,
    };
  }
  return target;
}

/** 从已生成记录推导"下一个可用序号"（用于生成序号防回退）。 */
function maxGeneratedSequence(generated) {
  let next = 0;
  for (const id of Object.keys(generated ?? {})) {
    const m = /(\d+)$/.exec(id);
    if (m) next = Math.max(next, Number(m[1]) + 1);
  }
  return next;
}

/** 是否已退役（退役 playerId 永久失效）。 */
export function isRetired(state, playerId) {
  return Boolean(state?.runtime?.retired?.[playerId]);
}

/** 静态球员 → 统一球员实体（基础属性展平，供访问器使用）。 */
function staticEntity(player) {
  const entity = {
    id: player.id,
    name: player.name,
    teamId: player.teamId ?? null,
    position: player.position,
    birthDate: player.birthDate,
    potential: player.potential,
    personality: player.personality,
    generated: false,
  };
  for (const attr of PLAYER_ATTRIBUTES) entity[attr] = player[attr];
  return entity;
}

/** 新生代档案 → 统一球员实体（teamId 取自运行时档案）。 */
function generatedEntity(g) {
  return {
    id: g.playerId,
    name: g.name,
    teamId: g.teamId ?? null,
    position: g.position,
    birthDate: g.birthDate,
    potential: g.potential,
    personality: g.personality,
    generated: true,
    ...(g.attributes ?? {}),
  };
}

/** 统一球员档案：优先静态库，其次运行时新生代；未找到返回 null。 */
export function getPlayerProfile(state, playerId) {
  const staticPlayer = getStaticPlayer(state, playerId);
  if (staticPlayer) return staticEntity(staticPlayer);
  const g = state?.runtime?.generated?.[playerId];
  if (g && typeof g.playerId === 'string') return generatedEntity(g);
  return null;
}

/** 世界全部**活跃**球员（静态未退役 ∪ 新生代未退役）——所有遍历/模拟的唯一入口。 */
export function getWorldPlayers(state) {
  const out = [];
  for (const player of state.static.players) {
    if (!isRetired(state, player.id)) out.push(staticEntity(player));
  }
  for (const g of Object.values(state.runtime?.generated ?? {})) {
    if (g && typeof g.playerId === 'string' && !isRetired(state, g.playerId)) {
      out.push(generatedEntity(g));
    }
  }
  return out;
}

/** 某队全部活跃球员。 */
export function getTeamPlayers(state, teamId) {
  return getWorldPlayers(state).filter((p) => p.teamId === teamId);
}

/** 读取球员运行时状态（不存在返回 null）。 */
export function getPlayerRuntime(state, playerId) {
  return state?.runtime?.players?.[playerId] ?? null;
}

/** 取静态球员（内部用）。 */
function getStaticPlayer(state, playerId) {
  return state?.static?.players?.find((p) => p.id === playerId) ?? null;
}

function requirePlayerRuntime(state, playerId) {
  const rt = getPlayerRuntime(state, playerId);
  if (!rt) {
    throw new SimulationError('未找到球员运行时状态', {
      context: { playerId, hint: '请确认 playerId 存在于当前世界，或已调用 initializePlayerRuntime' },
    });
  }
  return rt;
}

/**
 * 读取球员的**有效属性**（只读派生值）= 静态基础属性 + 运行时增减，
 * 夹取到 `[1, min(99, 该属性潜力上限)]`（第 16 步：潜力为每属性上限，A2）。
 * 刻意返回**完整属性向量**而非"总体评分"（项目规则第 14 条）。
 * 不修改任何输入。
 * @returns {Record<string, number>|null} 静态球员不存在时返回 null
 */
export function getEffectiveAttributes(state, playerId) {
  const player = getPlayerProfile(state, playerId);
  if (!player) return null;
  const rt = getPlayerRuntime(state, playerId);
  const deltas = rt?.ability?.deltas ?? {};
  const potential = player.potential ?? {};
  const out = {};
  for (const attr of PLAYER_ATTRIBUTES) {
    const baseValue = Number(player[attr]);
    const base = Number.isFinite(baseValue) ? baseValue : ATTRIBUTE_DEFAULT;
    const delta = Number(deltas[attr]);
    const value = base + (Number.isFinite(delta) ? delta : 0);
    const pot = Number(potential[attr]);
    const cap = Number.isFinite(pot)
      ? Math.min(ATTRIBUTE_RANGE.MAX, pot)
      : ATTRIBUTE_RANGE.MAX;
    out[attr] = clamp(value, ATTRIBUTE_RANGE.MIN, cap, base);
  }
  return out;
}

/**
 * 记录一次出场（累加到本赛季与职业生涯；供未来比赛流程的赛后处理调用）。
 * @param {object} state
 * @param {string} playerId
 * @param {{minutes?: number, goals?: number, assists?: number}} [line]
 */
export function recordAppearance(state, playerId, line = {}) {
  const rt = requirePlayerRuntime(state, playerId);
  const minutes = line.minutes ?? 0;
  const goals = line.goals ?? 0;
  const assists = line.assists ?? 0;
  for (const [name, v] of [['minutes', minutes], ['goals', goals], ['assists', assists]]) {
    if (!Number.isInteger(v) || v < 0) {
      throw new SimulationError(`recordAppearance 的 ${name} 需为非负整数`, {
        context: { playerId, field: name, value: v },
      });
    }
  }
  if (minutes > MAX_MINUTES_PER_MATCH) {
    throw new SimulationError('recordAppearance 的 minutes 超出单场上限', {
      context: { playerId, value: minutes, max: MAX_MINUTES_PER_MATCH },
    });
  }
  for (const statLine of [rt.stats.season, rt.stats.career]) {
    statLine.appearances += 1;
    statLine.minutes += minutes;
    statLine.goals += goals;
    statLine.assists += assists;
  }
  return rt;
}

/**
 * 设置体能 / 状态 / 士气（0–100，越界夹取）。仅设置被提供的项。
 * 数据结构级接口；具体更新/耦合模型属 `[TBD]`（SIMULATION_SPEC §7–§9）。
 */
export function setVitals(state, playerId, vitals = {}) {
  const rt = requirePlayerRuntime(state, playerId);
  if ('fitness' in vitals) rt.fitness = clamp(vitals.fitness, VITALS.MIN, VITALS.MAX, rt.fitness);
  if ('form' in vitals) rt.form = clamp(vitals.form, VITALS.MIN, VITALS.MAX, rt.form);
  if ('morale' in vitals) rt.morale = clamp(vitals.morale, VITALS.MIN, VITALS.MAX, rt.morale);
  return rt;
}

/**
 * 施加伤病（数据结构层；与伤病引擎共同构成生命周期）。
 * 第 17 步：记录 `type/category/severity/totalDays/daysRemaining/since`，更新有限伤病历史，
 * 并在 **severity=severe** 时向成长系统**明确写入** `growth.injuryPenaltySeasons`（成长系统只消费该字段）。
 * @param {{type?: string, category?: string, severity?: string, daysRemaining?: number, totalDays?: number, date?: string}} [info]
 */
export function applyInjury(state, playerId, info = {}) {
  const rt = requirePlayerRuntime(state, playerId);
  const totalDays = Math.floor(Number(info.totalDays ?? info.daysRemaining ?? 0));
  if (!Number.isFinite(totalDays) || totalDays < 1) {
    throw new SimulationError('applyInjury 需要正整数缺阵天数', {
      context: { playerId, value: info.totalDays ?? info.daysRemaining },
    });
  }
  const type = info.type ?? null;
  const severity = info.severity ?? severityForDays(totalDays);
  const category = info.category ?? INJURY_CONFIG.TYPES[type]?.category ?? null;
  const since = info.date ?? state.currentDate ?? null;

  rt.injury = {
    status: INJURY_STATUS.INJURED,
    type,
    category,
    severity,
    daysRemaining: totalDays,
    totalDays,
    since,
  };
  // 有限伤病历史（定长，不无限增长；第 17 步）。
  rt.injuryHistory.recurrenceCount += 1;
  rt.injuryHistory.lastInjuryDate = since;
  rt.injuryHistory.lastInjuryType = type;

  // 长期伤病 → 成长放缓：由伤病系统在**伤病发生时**写入，成长系统只消费（D-15）。
  if (severity === 'severe') {
    rt.growth.injuryPenaltySeasons = Math.max(
      rt.growth.injuryPenaltySeasons,
      INJURY_CONFIG.GROWTH_PENALTY_SEASONS,
    );
  }
  return rt;
}

/**
 * 解除伤病（恢复健康）。第 17 步：康复后体能**不立即满值**（受 RECOVERY_FITNESS_CAP 约束）。
 */
export function recoverInjury(state, playerId) {
  const rt = requirePlayerRuntime(state, playerId);
  rt.injury = createInjury();
  rt.fitness = Math.min(rt.fitness, INJURY_CONFIG.RECOVERY_FITNESS_CAP);
  return rt;
}

/**
 * 每日递减伤病剩余天数；归零即自动恢复（确定性，不允许永久伤病）。
 * 由伤病引擎在每日推进时调用（本函数为数据层实现，不含概率）。
 * @returns {boolean} 是否在本日恢复
 */
export function decrementInjuryDays(state, playerId) {
  const rt = requirePlayerRuntime(state, playerId);
  if (rt.injury.status !== INJURY_STATUS.INJURED) return false;
  rt.injury.daysRemaining -= 1;
  if (rt.injury.daysRemaining <= 0) {
    recoverInjury(state, playerId);
    return true;
  }
  return false;
}

/**
 * 施加能力增减（成长接口的数据结构层；**成长算法属 `[TBD]`**）。
 * 增减量按属性名存储，读取时经 `getEffectiveAttributes()` 夹取到 1–99；
 * 不修改静态基础属性（项目规则第 6 条）。
 */
export function applyAbilityDelta(state, playerId, attribute, delta) {
  if (!PLAYER_ATTRIBUTES.includes(attribute)) {
    throw new SimulationError('applyAbilityDelta 的属性名不在允许集合内', {
      context: { playerId, attribute, allowed: PLAYER_ATTRIBUTES },
    });
  }
  if (!Number.isFinite(Number(delta))) {
    throw new SimulationError('applyAbilityDelta 的增减量需为有限数值', {
      context: { playerId, attribute, delta },
    });
  }
  const rt = requirePlayerRuntime(state, playerId);
  const prev = Number(rt.ability.deltas[attribute]) || 0;
  rt.ability.deltas[attribute] = prev + Number(delta);
  return rt;
}

/**
 * 赛季滚动时重置「本赛季统计」（职业生涯统计保持不变，因为已增量累加）。
 * @param {object} state
 * @param {number} seasonNumber 新赛季号
 */
export function resetSeasonStats(state, seasonNumber) {
  for (const rt of Object.values(state.runtime.players ?? {})) {
    rt.stats.season = createStatLine();
    rt.stats.seasonNumber = seasonNumber;
  }
  return state;
}
