/**
 * 球员成长 / 衰退引擎（Simulation Core）。
 * 层级归属：Simulation Core。纯逻辑，**不依赖 DOM / 存储 / UI**。
 *
 * 规范来源：DECISIONS D-14、SIMULATION_SPEC §20（第 16 步）。
 * 核心模型（每赛季结算一次，按赛季滚动触发）：
 *   成长期（年龄 < 该属性分组巅峰）：delta = 距潜力上限的余量 × 年龄速率 × 修正 × 有界随机
 *   衰退期（年龄 ≥ 巅峰）：        delta = -衰退速率 × 过峰年数 × 抗衰退修正 × 有界随机
 * 修正项：人格（职业素养/决心/野心）、状态与士气（温和）、比赛出场（年轻权重）、
 *        训练（预留接口，本期默认 1.0）、长期伤病（放缓后续成长）。
 *
 * 红线：
 * - **只写 runtime deltas**，绝不修改 `state.static`（项目规则第 6 条 / A3）。
 * - 结果**绝不突破** `potential[attr]`（A2/C3），且始终在 1–99 内。
 * - **确定性**：种子 = hash(worldId, playerId, season)，同一（库+档+种子）必复现（第 10 条）。
 * - 随机仅**有界扰动**速率，不替代逻辑（第 9、11 条）；同一赛季**幂等**（不重复结算）。
 * - 可解释：每条成长可归因于年龄阶段、潜力余量、出场、士气、人格、伤病（第 22 条）。
 */

import { PLAYER_ATTRIBUTES, ATTRIBUTE_RANGE } from '../shared/football-schema.js';
import { SimulationError } from '../shared/errors.js';
import { PLAYER_GROWTH_CONFIG } from './sim-config.js';
import { createRng, hashSeed } from './rng.js';
import { ageOn } from './date-utils.js';
import { getEffectiveAttributes, getPlayerRuntime, applyAbilityDelta } from './player-runtime.js';

const C = PLAYER_GROWTH_CONFIG;

/** 归一化人格/士气值到约 -1..1（以 50 为中性）。 */
function norm(value) {
  return (Number(value) - 50) / 50;
}

/** 年龄对应的成长速率（吸收潜力余量的比例）；达到/超过巅峰返回 0。 */
function growthRateForAge(age) {
  for (const band of C.GROWTH_RATE_BY_AGE) {
    if (age <= band.maxAge) return band.rate;
  }
  return 0;
}

/** 成长人格修正（>1 更快）。 */
function personalityGrowthFactor(personality) {
  const P = C.PERSONALITY;
  return (
    (1 + P.PROFESSIONALISM * norm(personality?.professionalism)) *
    (1 + P.DETERMINATION * norm(personality?.determination)) *
    (1 + P.AMBITION * norm(personality?.ambition))
  );
}

/** 抗衰退修正（>1 更慢衰退）。仅采用职业素养与决心（更可解释）。 */
function declineResistanceFactor(personality) {
  const P = C.PERSONALITY;
  return (
    (1 + P.PROFESSIONALISM * norm(personality?.professionalism)) *
    (1 + P.DETERMINATION * norm(personality?.determination))
  );
}

/** 状态/士气温和修正（约 0.8–1.2）。 */
function vitalsFactor(rt) {
  const s = C.VITALS_SENSITIVITY;
  return 1 + s * norm(rt.morale) + s * norm(rt.form);
}

/** 出场加成（仅成长期；年轻权重随年龄递减到 0）。 */
function appearanceFactor(rt, age) {
  const A = C.APPEARANCE;
  const minutes = rt.stats?.season?.minutes ?? 0;
  let youth = 1;
  if (age > A.YOUNG_AGE) {
    youth = Math.max(0, (A.FADE_AGE - age) / (A.FADE_AGE - A.YOUNG_AGE));
  }
  return 1 + A.MAX_BONUS * Math.min(1, minutes / A.FULL_MINUTES) * youth;
}

/** 稳定性对随机波动的影响：高稳定 → 更小波动（约 0.8–1.2）。 */
function noiseScale(personality) {
  const c = Number(personality?.consistency);
  const v = Number.isFinite(c) ? c : 50;
  return 1.2 - 0.4 * (v / ATTRIBUTE_RANGE.MAX);
}

/**
 * 结算一名球员一个赛季的成长/衰退（内部）。
 * @returns {{ applied: boolean }}
 */
function developPlayer(state, playerId, seasonNumber, trainingFactor, date) {
  const player = state.static.players.find((p) => p.id === playerId);
  const rt = getPlayerRuntime(state, playerId);
  if (!player || !rt) return { applied: false };
  if (rt.growth.lastEvaluatedSeason >= seasonNumber) return { applied: false }; // 幂等
  if (!player.birthDate) return { applied: false }; // 无生日不做成长（正式库校验应保证存在）

  const age = ageOn(player.birthDate, date);
  const effective = getEffectiveAttributes(state, playerId);
  const personality = player.personality ?? {};
  const rng = createRng(hashSeed(`${state.worldId}|growth|${playerId}|${seasonNumber}`));

  // 长期伤病：本期判定，放缓后续若干赛季的成长（B7）。
  if ((rt.injury?.daysRemaining ?? 0) >= C.LONG_INJURY_DAYS) {
    rt.growth.injuryPenaltySeasons = Math.max(rt.growth.injuryPenaltySeasons, C.INJURY_PENALTY.SEASONS);
  }
  const penaltyFactor = rt.growth.injuryPenaltySeasons > 0 ? C.INJURY_PENALTY.FACTOR : 1;

  const growthModifier =
    personalityGrowthFactor(personality) *
    vitalsFactor(rt) *
    appearanceFactor(rt, age) *
    trainingFactor *
    penaltyFactor;
  const declineModifier = 1 / declineResistanceFactor(personality);
  const nScale = noiseScale(personality);

  // 超预期成长（C3）：本球员-本赛季小概率触发，随机挑一个属性加成（仍受潜力上限约束）。
  const breakoutAttr = rng.next() < C.BREAKOUT.CHANCE
    ? PLAYER_ATTRIBUTES[Math.floor(rng.next() * PLAYER_ATTRIBUTES.length)]
    : null;

  for (const attr of PLAYER_ATTRIBUTES) {
    const potRaw = Number(player.potential?.[attr]);
    const cap = Number.isFinite(potRaw)
      ? Math.min(ATTRIBUTE_RANGE.MAX, Math.max(ATTRIBUTE_RANGE.MIN, potRaw))
      : ATTRIBUTE_RANGE.MAX;
    const current = effective[attr];
    const group = C.GROUPS[attr] ?? 'technical';
    const peak = C.PEAK_AGE[group];
    const noise = 1 + C.NOISE_AMPLITUDE * nScale * (rng.next() * 2 - 1);

    let expected;
    if (age < peak) {
      const headroom = Math.max(0, cap - current);
      expected = headroom * growthRateForAge(age) * growthModifier * noise;
      if (breakoutAttr === attr) expected += C.BREAKOUT.BONUS * growthModifier;
    } else {
      const yearsPast = age - peak + 1;
      expected = -C.DECLINE_RATE[group] * yearsPast * declineModifier * noise;
    }

    let delta = Math.round(expected);
    if (current + delta > cap) delta = cap - current;          // 绝不突破潜力上限
    if (current + delta < ATTRIBUTE_RANGE.MIN) delta = ATTRIBUTE_RANGE.MIN - current;
    if (delta !== 0) applyAbilityDelta(state, playerId, attr, delta);
  }

  if (rt.growth.injuryPenaltySeasons > 0) rt.growth.injuryPenaltySeasons -= 1;
  rt.growth.lastEvaluatedSeason = seasonNumber;
  return { applied: true };
}

/**
 * 结算全部球员一个赛季的成长/衰退（赛季滚动时调用；幂等）。
 * @param {object} state
 * @param {{seasonNumber?: number, training?: (playerId: string, ctx: object) => number}} [options]
 *   training：**训练修正预留接口**（B1）。返回倍率；缺省 1.0，本期不实现训练本体。
 * @returns {object} state（原地）
 */
export function developPlayers(state, options = {}) {
  if (!state || !state.static || !state.runtime) {
    throw new SimulationError('developPlayers 需要包含 static 与 runtime 的状态', {
      context: { received: typeof state },
    });
  }
  const seasonNumber = options.seasonNumber ?? state.season ?? 1;
  const training = typeof options.training === 'function'
    ? options.training
    : () => C.DEFAULT_TRAINING_FACTOR;
  const date = state.currentDate;

  state.runtime.players ??= {};
  for (const player of state.static.players) {
    const rt = getPlayerRuntime(state, player.id);
    if (!rt) continue;
    const factor = Number(training(player.id, { seasonNumber, date }));
    const trainingFactor = Number.isFinite(factor) ? factor : C.DEFAULT_TRAINING_FACTOR;
    developPlayer(state, player.id, seasonNumber, trainingFactor, date);
  }
  return state;
}