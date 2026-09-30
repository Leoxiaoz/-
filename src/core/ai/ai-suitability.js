/**
 * Player Suitability Evaluator（内部决策工具，非球员真相）—— Step 31 / D-AI-08/09/10/25。
 * 层级归属：Simulation Core / AI。纯函数，**不依赖 DOM / 存储 / UI**，**无 RNG**。
 *
 * 红线（D-AI-25）：
 * - **不创建 / 不返回 OVR**；score 仅为**当前决策上下文**的排序工具。
 * - **不持久化**、**不写入 player**、**不改变 transfer fee / team strength / match engine**。
 * - 必须基于**完整 effective attribute vector**（按位置 profile 取子集）。
 */

import { AI_CONFIG } from './ai-config.js';
import { getAIClubPolicy } from './ai-club-policy.js';
import { getEffectiveAttributes, getPlayerProfile, getPlayerRuntime, INJURY_STATUS } from '../player-runtime.js';
import { injuryChanceFor } from '../player-injury.js';
import { ageOn } from '../date-utils.js';
import { ATTRIBUTE_DEFAULT } from '../../shared/football-schema.js';

const C = AI_CONFIG;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
function clamp01(v) {
  return clamp(v, 0, 1);
}
function finite(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 位置属性画像（未知位置回退 MF）。 */
export function attributeProfile(position) {
  return C.ATTRIBUTE_PROFILES[position] ?? C.ATTRIBUTE_PROFILES.MF;
}

/** 年龄档位下标。 */
function ageBandIndex(age) {
  const bands = C.AGE_BANDS;
  for (let i = 0; i < bands.length; i += 1) {
    if (age >= bands[i].min && age <= bands[i].max) return i;
  }
  return bands.length - 1;
}

/**
 * 评估一名球员在当前需求 / 角色下的 suitability（内部 score，0..1.5）。
 * @param {object} state
 * @param {string} clubId
 * @param {string} playerId
 * @param {{position?: string}} need
 * @param {'Starter'|'Rotation'|'Backup'|'Development'} [role]
 * @returns {{playerId: string, role: string, score: number}}
 */
export function evaluatePlayerSuitability(state, clubId, playerId, need, role = 'Starter') {
  const profile = getPlayerProfile(state, playerId);
  const resolvedRole = C.ROLE_WEIGHTS[role] ? role : 'Starter';
  if (!profile) return { playerId, role: resolvedRole, score: 0 };

  const position = need?.position ?? profile.position;
  const attrs = attributeProfile(position);
  const eff = getEffectiveAttributes(state, playerId) ?? {};

  let attrSum = 0;
  let headroomSum = 0;
  for (const attr of attrs) {
    const current = finite(eff[attr], ATTRIBUTE_DEFAULT);
    attrSum += current;
    const pot = finite(profile.potential?.[attr], current);
    headroomSum += Math.max(0, pot - current);
  }
  const attrScore = clamp01((attrSum / attrs.length) / 99);
  const potScore = clamp01((headroomSum / attrs.length) / 30);

  const w = C.ROLE_WEIGHTS[resolvedRole];
  const policy = getAIClubPolicy(clubId);
  const potScale = policy.potentialWeight / C.POTENTIAL_WEIGHT_BASE;
  let score = w.current * attrScore + w.potential * potScore * potScale;

  // 生理 / 状态（有界）
  const rt = getPlayerRuntime(state, playerId);
  const fit = clamp01(finite(rt?.fitness, 100) / 100);
  const frm = clamp01(finite(rt?.form, 50) / 50);
  const mor = clamp01(finite(rt?.morale, 50) / 50);
  const vitals = 0.6 + 0.4 * (0.5 * fit + 0.3 * frm + 0.2 * mor);

  // 伤病 / 伤病风险（有界）
  let injury = 1;
  if (rt?.injury?.status === INJURY_STATUS.INJURED) {
    injury = 0.5;
  } else {
    const chance = clamp01(finite(injuryChanceFor(state, playerId), 0) / 0.05);
    injury = clamp(1 - 0.3 * chance, 0.7, 1);
  }

  // 年龄（仅 modifier，不实现成长曲线）
  const age = profile.birthDate ? finite(ageOn(profile.birthDate, state.currentDate), 26) : 26;
  const band = ageBandIndex(age);
  const preferred = C.ROLE_PREFERRED_AGE_BAND[resolvedRole] ?? 2;
  const ageFactor = clamp(1 - 0.12 * Math.abs(band - preferred), 0.6, 1);

  score = clamp(score * vitals * injury * ageFactor, 0, 1.5);
  return { playerId, role: resolvedRole, score: Math.round(score * 1000) / 1000 };
}

/** 只读：球员发展潜力余量均值（供排序上下文使用；不暴露为球员字段）。 */
export function potentialHeadroom(profile) {
  if (!profile) return 0;
  const attrs = attributeProfile(profile.position);
  let sum = 0;
  for (const attr of attrs) {
    const base = finite(profile[attr], ATTRIBUTE_DEFAULT);
    const pot = finite(profile.potential?.[attr], base);
    sum += Math.max(0, pot - base);
  }
  return Math.round((sum / attrs.length) * 1000) / 1000;
}
