/**
 * 伤病生命周期引擎（Simulation Core）。
 * 层级归属：Simulation Core。纯逻辑，**不依赖 DOM / 存储 / UI**。
 *
 * 规范来源：DECISIONS D-15、SIMULATION_SPEC §21（第 17 步）。
 * 职责（**伤病生命周期由本模块负责**）：
 *   1) 比赛后最小伤病判定（`resolveMatchInjuries`）
 *   2) 每日推进伤病（递减 → 自动恢复）（`tickInjuries`）
 *   3) 伤病期间 / 康复后的 vitals 温和变化
 *   4) 长期伤病 → 成长放缓：**由本模块经 `applyInjury` 明确写入** `growth.injuryPenaltySeasons`
 *
 * 红线：
 * - 类型/严重度/数值**全部配置驱动**（`INJURY_CONFIG`），逻辑不写死具体类型。
 * - 随机一律使用项目 deterministic RNG；种子含 worldId + fixtureId/date + playerId + 'injury'（可复现）。
 * - **不修改 `state.static`**；不改球员基础属性（伤病只影响状态与缺阵）。
 * - 伤病**不允许永久存在**：daysRemaining 每日递减到 0 即自动恢复。
 */

import { SimulationError } from '../shared/errors.js';
import { INJURY_CONFIG } from './sim-config.js';
import { createRng, hashSeed } from './rng.js';
import { ageOn } from './date-utils.js';
import {
  INJURY_STATUS,
  getPlayerRuntime,
  applyInjury,
  decrementInjuryDays,
  severityForDays,
} from './player-runtime.js';
import { recordEvent } from './game-state.js';

const C = INJURY_CONFIG;

/** 归一化到约 -1..1（以 50 为中性）。 */
function norm(v) {
  return (Number(v) - 50) / 50;
}

/** 严重度对应的天数下/上界（用于把计算结果夹取进该档）。 */
function bandBounds(severity) {
  const order = C.SEVERITY_BANDS;
  const idx = order.findIndex((b) => b.name === severity);
  const min = idx === 0 ? 1 : order[idx - 1].maxDays + 1;
  const maxRaw = order[idx].maxDays;
  const max = Number.isFinite(maxRaw) ? maxRaw : C.SEVERE_MAX_DAYS;
  return { min, max };
}

/** 抽取伤病类型（配置驱动，均匀）。 */
function pickType(rng) {
  const types = Object.keys(C.TYPES);
  return types[Math.floor(rng.next() * types.length)];
}

/** 抽取严重度（权重受体能/倾向/年龄影响）。 */
function pickSeverity(rng, { proneness, age, fitness }) {
  const w = { ...C.SEVERITY_WEIGHTS };
  const shift = Math.max(0, norm(proneness))
    + Math.max(0, (age - C.AGE.CHANCE_START) / 10) * 0.5
    + (1 - Math.min(100, Math.max(0, fitness)) / 100);
  w.moderate *= (1 + 0.5 * shift);
  w.severe *= (1 + 1.0 * shift);
  const total = w.minor + w.moderate + w.severe;
  let r = rng.next() * total;
  r -= w.minor;
  if (r <= 0) return 'minor';
  r -= w.moderate;
  if (r <= 0) return 'moderate';
  return 'severe';
}

/** 计算缺阵天数：类型 + 严重度 + injuryProneness + 年龄/体能 + 有界随机。 */
function computeDays(type, severity, { proneness, age, fitness, rng }) {
  const t = C.TYPES[type];
  const factor = (1 + C.PRONENESS.RECOVERY * norm(proneness))
    * (1 + C.AGE.RECOVERY_PER_YEAR * Math.max(0, age - C.AGE.RECOVERY_START))
    * (1 + 0.2 * (1 - Math.min(100, Math.max(0, fitness)) / 100));
  const weight = severity === 'severe' ? 1.5 : severity === 'moderate' ? 1 : 0.5;
  const jitter = (rng.next() * 2 - 1) * (t.dayRange / 2) * weight;
  const raw = Math.round(t.baseDays * factor + jitter);
  const { min, max } = bandBounds(severity);
  return Math.min(max, Math.max(min, raw));
}

/** 计算单名球员单场受伤概率（有界）。 */
function injuryChance({ proneness, age, fitness, recurrenceCount }) {
  const recurrenceMultiplier = Math.min(
    C.RECURRENCE.MAX_MULTIPLIER,
    1 + C.RECURRENCE.PER_INCIDENT * (recurrenceCount ?? 0),
  );
  const p = C.BASE_INJURY_CHANCE
    * (1 + C.PRONENESS.CHANCE * norm(proneness))
    * Math.pow(C.FITNESS_CHANCE_STEP, (100 - Math.min(100, Math.max(0, fitness))) / 10)
    * (1 + C.AGE.CHANCE_PER_YEAR * Math.max(0, age - C.AGE.CHANCE_START))
    * recurrenceMultiplier;
  return Math.min(C.MAX_INJURY_CHANCE, Math.max(0, p));
}

/** 伤病发生时的 vitals 立即变化（不改基础属性）。 */
function applyVitalsDrop(rt, severity) {
  rt.fitness = Math.max(0, rt.fitness - (C.VITALS_DROP.FITNESS[severity] ?? 0));
  rt.form = Math.max(0, rt.form - (C.VITALS_DROP.FORM[severity] ?? 0));
  rt.morale = Math.max(0, rt.morale - (C.VITALS_DROP.MORALE[severity] ?? 0));
}

/**
 * 对一名球员做一次伤病判定并（若触发）施加伤病。
 * @returns {object|null} 新伤病描述或 null
 */
export function rollPlayerInjury(state, playerId, ctx) {
  const player = state.static.players.find((p) => p.id === playerId);
  const rt = getPlayerRuntime(state, playerId);
  if (!player || !rt) return null;
  if (rt.injury.status === INJURY_STATUS.INJURED) return null; // 已在伤停，不重复判定

  const rng = createRng(hashSeed(`${state.worldId}|injury|${ctx.ref}|${playerId}`));
  const age = player.birthDate ? ageOn(player.birthDate, state.currentDate) : 30;
  const proneness = player.personality?.injuryProneness;
  const chance = injuryChance({
    proneness,
    age,
    fitness: rt.fitness,
    recurrenceCount: rt.injuryHistory?.recurrenceCount ?? 0,
  });
  // 第一抽：是否受伤
  if (rng.next() >= chance) return null;

  const type = pickType(rng);
  const severity = pickSeverity(rng, { proneness, age, fitness: rt.fitness });
  const days = computeDays(type, severity, { proneness, age, fitness: rt.fitness, rng });

  applyInjury(state, playerId, {
    type,
    severity,
    daysRemaining: days,
    category: C.TYPES[type].category,
    date: state.currentDate,
  });
  applyVitalsDrop(rt, severity);
  recordEvent(state, 'injury', { playerId, type, severity, days, teamId: player.teamId });
  return { playerId, type, severity, days };
}

/**
 * 赛后最小伤病判定：对双方参赛球员逐一判定（每方至多新增 `MAX_INJURIES_PER_MATCH_SIDE` 人）。
 * 说明：当前无首发/换人系统，故以**全队球员**为参赛集合（已知限制，见 SIMULATION_SPEC §21）。
 * @param {object} state
 * @param {{fixtureId: string, season: number, round: number, homeId: string, awayId: string}} ctx
 * @returns {object[]} 新增伤病列表
 */
export function resolveMatchInjuries(state, ctx) {
  const ref = ctx.fixtureId;
  const out = [];
  for (const teamId of [ctx.homeId, ctx.awayId]) {
    const squad = state.static.players.filter((p) => p.teamId === teamId);
    let count = 0;
    for (const player of squad) {
      if (count >= C.MAX_INJURIES_PER_MATCH_SIDE) break;
      const injured = rollPlayerInjury(state, player.id, { ...ctx, ref });
      if (injured) {
        count += 1;
        out.push(injured);
      }
    }
  }
  return out;
}

/**
 * 每日推进伤病：剩余天数递减 → 归零自动恢复；并做伤病期间 / 康复后的 vitals 温和变化。
 * 确定性：不含随机。
 * @param {object} state
 * @returns {{recovered: string[]}}
 */
export function tickInjuries(state) {
  if (!state?.runtime?.players) {
    throw new SimulationError('tickInjuries 需要包含 runtime.players 的状态', { context: { received: typeof state } });
  }
  const recovered = [];
  for (const player of state.static.players) {
    const rt = getPlayerRuntime(state, player.id);
    if (!rt) continue;
    if (rt.injury.status === INJURY_STATUS.INJURED) {
      // 伤病期间：体能日降、状态冻结（不因比赛累积）。morale 适度下降（长期病更明显）。
      rt.fitness = Math.max(0, rt.fitness - C.FITNESS.INJURED_DROP_PER_DAY);
      if ((rt.injury.daysRemaining ?? 0) > C.SEVERITY_BANDS[0].maxDays) {
        rt.morale = Math.max(0, rt.morale - C.MORALE_DROP_PER_DAY);
      }
      // 状态冻结：向 0 温和衰减（不随比赛建立）。
      if (rt.form > C.FORM_INJURED_TARGET) rt.form = Math.max(C.FORM_INJURED_TARGET, rt.form - 1);
      if (decrementInjuryDays(state, player.id)) {
        recovered.push(player.id);
        recordEvent(state, 'injury_recovered', { playerId: player.id, teamId: player.teamId });
      }
    } else {
      // 健康：体能温和回升至满、士气向基线温和回归（最小实现，非训练模型）。
      if (rt.fitness < 100) rt.fitness = Math.min(100, rt.fitness + C.FITNESS.RECOVER_PER_DAY);
      if (rt.morale < C.BASELINE_MORALE) rt.morale = Math.min(C.BASELINE_MORALE, rt.morale + C.MORALE_RECOVER_PER_DAY);
    }
  }
  return { recovered };
}

/** 是否可用（未伤病）——供阵容/实力计算使用。 */
export function isAvailable(state, playerId) {
  const rt = getPlayerRuntime(state, playerId);
  return !rt || rt.injury.status !== INJURY_STATUS.INJURED;
}

/**
 * 计算某球员当前的受伤概率（只读、确定性；供测试与可解释性使用）。
 * @returns {number} 0..MAX_INJURY_CHANCE
 */
export function injuryChanceFor(state, playerId) {
  const player = state.static.players.find((p) => p.id === playerId);
  const rt = getPlayerRuntime(state, playerId);
  if (!player || !rt) return 0;
  const age = player.birthDate ? ageOn(player.birthDate, state.currentDate) : 30;
  return injuryChance({
    proneness: player.personality?.injuryProneness,
    age,
    fitness: rt.fitness,
    recurrenceCount: rt.injuryHistory?.recurrenceCount ?? 0,
  });
}

export { severityForDays };