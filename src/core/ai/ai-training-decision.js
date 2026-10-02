/**
 * AI Training Decision —— Step 39F-J（D-39FJ 冻结设计；本步骤实现）。
 * 层级归属：Simulation Core / AI。**纯派生、只读、无副作用、无 RNG、不持久化**。
 *
 * 职责：在**赛季边界**为每名球员决定训练投入强度 `LIMITED | NORMAL | STRONG`，
 * 作为既有 `developPlayers(training)` 的 training input 来源。它**只决定投入**，
 * 不决定成长数值 / 属性 / 选择 / 分钟 / 转会 / 阵容规划。
 *
 * 数据流（单向）：
 *   Production Signals → evaluateTrainingDecision → LIMITED/NORMAL/STRONG
 *     → existing developPlayers(training) → existing Growth Engine → ability delta
 *
 * Step 39F-J-C：`seasonMatchLoad`（= Match Participation / Playing Exposure）**不再**作为本决策的
 * Absolute Match Load Gate；`HIGH_MATCH_LOAD` / `VERY_HIGH_MATCH_LOAD` 不再影响 Training Decision。
 * 比赛暴露保护唯一经 Relative Role Load（39F-J-B）承担。
 *
 * 红线：
 * - **不修改** Growth Engine / 39F-G / 39F-H / Injury / Match。
 * - **不读取** True Potential（只用 AI-observable `estimateHeadroomScore`）。
 * - 不新增 runtime / schema / save 字段；不写 persistent state。
 * - 比赛经验已由 Growth 的 `matchExperienceInput` 消费（独立通道）。
 * - 禁止 `Training → Selection`、`Training → Minutes` 反向边。
 */

import { getPlayerProfile, getPlayerRuntime, INJURY_STATUS } from '../player-runtime.js';
import { getPlayerClub } from '../membership.js';
import { ageOn } from '../date-utils.js';
import { getDevelopmentPhase, DEVELOPMENT_PHASES } from './ai-development-phase.js';
import { estimateHeadroomScore } from './ai-potential-estimate.js';
import { evaluateDevelopmentEnvironment } from './ai-development-environment.js';
import { evaluateRelativeRoleLoad } from './ai-relative-role-load.js';
import { AI_TRAINING_DECISION_CONFIG as C } from './ai-config.js';

const LEVEL = C.LEVELS;
const STRONG_PHASES = Object.freeze(new Set([
  DEVELOPMENT_PHASES.EMERGING,
  DEVELOPMENT_PHASES.DEVELOPING,
  DEVELOPMENT_PHASES.ESTABLISHING,
]));
const PERSONALITY_KEYS = Object.freeze(['professionalism', 'determination', 'ambition']);

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function uniq(list) {
  return [...new Set(list)];
}

/** 人格归一化（三项均值 1–99 → [0,1]）；缺失回退中性 0.5。 */
function personalityNormalized(profile) {
  let sum = 0;
  for (const key of PERSONALITY_KEYS) {
    const n = Number(profile?.personality?.[key]);
    sum += Number.isFinite(n) ? Math.min(99, Math.max(1, n)) : 50;
  }
  const avg = sum / PERSONALITY_KEYS.length;
  return clamp01((avg - 1) / 98);
}

/**
 * 赛季负荷率 → 档位（纯函数）。
 * `LOW < LOW_MAX`；`< NORMAL_MAX` → NORMAL；`< HIGH_MAX` → HIGH；否则 VERY_HIGH。
 *
 * Step 39F-J-C：本函数已**不再被 Training Decision 消费**（Absolute Match Load Gate 已移除）。
 * 保留为 Match Participation / Playing Exposure 的 **derived classification**（legacy / 未来
 * Participation / Workload 相关步骤可复用）；无持久化、无 RNG。
 * @returns {'LOW'|'NORMAL'|'HIGH'|'VERY_HIGH'}
 */
export function classifySeasonLoad(loadRate) {
  const x = Number(loadRate);
  if (!Number.isFinite(x) || x < C.LOAD.LOW_MAX) return 'LOW';
  if (x < C.LOAD.NORMAL_MAX) return 'NORMAL';
  if (x < C.LOAD.HIGH_MAX) return 'HIGH';
  return 'VERY_HIGH';
}

/**
 * 决定一名球员本赛季的训练投入档位（纯函数，不改 state，无 RNG）。
 *
 * 决策顺序（Step 39F-J-C）：读输入 → 缺失处理（MISSING_AGE → NORMAL）→ Development Phase
 * → Hard Gates（INJURED → LIMITED；INJURY_RECOVERY / VETERAN_PHASE → 封顶 NORMAL）
 * → base Training Level（phase + headroom + environment + bounded personality）
 * → Relative Role Load（在 evaluateTrainingDecision 中叠加）→ 最终档位。
 *
 * 注意：`seasonMatchLoad` / Match Participation **不再**参与本决策（无 Absolute Match Load Gate）。
 *
 * @param {object} state
 * @param {string} clubId
 * @param {string} playerId
 * @param {{seasonNumber?: number, availabilityCache?: Map<string, number>|null}} [options]
 * @returns {{trainingLevel: 'LIMITED'|'NORMAL'|'STRONG', reasons: string[], limitingFactors: string[]}}
 */
export function evaluateTrainingDecision(state, clubId, playerId, options = {}) {
  const base = computeBaseTrainingLevel(state, clubId, playerId);
  // Step 39F-J-B：Relative Role Load（**保护性叠加**；只允许 base NORMAL → LIMITED）。
  const relativeRoleLoad = clubId
    ? evaluateRelativeRoleLoad(state, clubId, playerId, {
      seasonNumber: options.seasonNumber,
      availabilityCache: options.availabilityCache ?? null,
    })
    : null;
  const level = applyRelativeRoleLoad(base.level, relativeRoleLoad?.classification ?? null);
  const reasons = [...base.reasons];
  if (level !== base.level) reasons.push('relative_role_load_extreme');
  else if (relativeRoleLoad?.classification === 'EXTREME') reasons.push('relative_role_load_extreme_suppressed');
  return {
    trainingLevel: level,
    reasons,
    limitingFactors: base.limitingFactors,
    relativeRoleLoad,
  };
}

/**
 * Relative Role Load 对 Training Decision 的**唯一**影响（纯函数，D-39FJ-B §十一）：
 * `EXTREME` 且 base = NORMAL → LIMITED；其余（含 base=STRONG / LIMITED）不变。
 * @returns {'LIMITED'|'NORMAL'|'STRONG'}
 */
export function applyRelativeRoleLoad(baseLevel, classification) {
  if (classification === 'EXTREME' && baseLevel === LEVEL.NORMAL) return LEVEL.LIMITED;
  return baseLevel;
}

/** 计算 base Training Level（不含 Relative Role Load；Step 39F-J-C 后不读取 Match Participation）。 */
function computeBaseTrainingLevel(state, clubId, playerId) {
  const reasons = [];
  const limitingFactors = [];

  const profile = getPlayerProfile(state, playerId);
  const rt = getPlayerRuntime(state, playerId);
  if (!profile || !rt) {
    return { level: LEVEL.NORMAL, reasons: ['no_player_data'], limitingFactors: [] };
  }
  // STEP 2：缺失年龄 → 保守回退 NORMAL。
  if (!profile.birthDate) {
    return { level: LEVEL.NORMAL, reasons: ['missing_age'], limitingFactors: ['MISSING_AGE'] };
  }
  const age = ageOn(profile.birthDate, state.currentDate);
  if (!Number.isFinite(age)) {
    return { level: LEVEL.NORMAL, reasons: ['missing_age'], limitingFactors: ['MISSING_AGE'] };
  }
  const phase = getDevelopmentPhase(age);

  // STEP 6：Hard Gates（优先级最高）。
  if (rt.injury?.status === INJURY_STATUS.INJURED) {
    return { level: LEVEL.LIMITED, reasons: ['injured'], limitingFactors: ['INJURED'] };
  }

  let allowedMax = LEVEL.STRONG; // 允许的最高档
  if (Number(rt.growth?.injuryPenaltySeasons) > 0) {
    allowedMax = LEVEL.NORMAL;
    limitingFactors.push('INJURY_RECOVERY');
    reasons.push('injury_recovery');
  }
  if (phase === DEVELOPMENT_PHASES.VETERAN) {
    if (allowedMax === LEVEL.STRONG) limitingFactors.push('VETERAN_PHASE');
    allowedMax = LEVEL.NORMAL;
    reasons.push('veteran_phase');
  }

  // Step 39F-J-C：`seasonMatchLoad`（Match Participation / Playing Exposure）已从本决策移除，
  // 不再作为 Absolute Match Load Gate（HIGH / VERY_HIGH 不再影响 Training Decision）。
  // 比赛暴露保护唯一经 Relative Role Load（evaluateTrainingDecision 中叠加）承担。

  // Hard caps（injury recovery / veteran）：封顶 NORMAL。
  if (allowedMax !== LEVEL.STRONG) {
    return { level: LEVEL.NORMAL, reasons, limitingFactors: uniq(limitingFactors) };
  }

  // STEP 7：STRONG 资格（phase gate）。
  if (!STRONG_PHASES.has(phase)) {
    reasons.push('phase_restricted');
    return { level: LEVEL.NORMAL, reasons, limitingFactors: uniq(limitingFactors) };
  }

  // STEP 8/9/10：bounded soft signals。
  const headroomNorm = clamp01(estimateHeadroomScore(state, clubId, playerId) / 100);
  const env = evaluateDevelopmentEnvironment(state, clubId, playerId);
  const envNorm = env ? clamp01(env.environmentInput) : 0;
  const persNorm = personalityNormalized(profile);

  const blockers = [];
  if (headroomNorm < C.HEADROOM_STRONG_MIN) blockers.push('LOW_DEVELOPMENT_HEADROOM');
  if (envNorm < C.ENVIRONMENT_STRONG_MIN) blockers.push('POOR_DEVELOPMENT_ENVIRONMENT');
  if (persNorm < C.PERSONALITY_STRONG_MIN) reasons.push('low_personality_signal');

  const strongScore = C.STRONG_WEIGHTS.HEADROOM * headroomNorm
    + C.STRONG_WEIGHTS.ENVIRONMENT * envNorm
    + C.STRONG_WEIGHTS.PERSONALITY * persNorm;

  reasons.push(`headroom_${headroomNorm.toFixed(3)}`, `environment_${envNorm.toFixed(3)}`, `personality_${persNorm.toFixed(3)}`);

  if (blockers.length > 0 || persNorm < C.PERSONALITY_STRONG_MIN || strongScore < C.STRONG_SCORE_MIN) {
    return { level: LEVEL.NORMAL, reasons, limitingFactors: uniq([...limitingFactors, ...blockers]) };
  }
  return { level: LEVEL.STRONG, reasons: [...reasons, 'strong_eligible'], limitingFactors: uniq(limitingFactors) };
}

/**
 * `developPlayers(training)` 适配器：解析某球员本季训练档位。
 * - 无俱乐部（Free Agent）→ NORMAL。
 * - **Managed Club → NORMAL**（保持既有默认训练行为，不受 AI Training Decision 影响）。
 * - AI Club → `evaluateTrainingDecision(...)`。
 * @returns {'LIMITED'|'NORMAL'|'STRONG'}
 */
export function resolveTrainingLevel(state, playerId, ctx = {}, availabilityCache = null) {
  const clubId = getPlayerClub(state, playerId);
  if (!clubId) return LEVEL.NORMAL;
  if (clubId === (state?.runtime?.managedClubId ?? null)) return LEVEL.NORMAL;
  return evaluateTrainingDecision(state, clubId, playerId, {
    seasonNumber: ctx.seasonNumber,
    availabilityCache,
  }).trainingLevel;
}

/**
 * 建立 `developPlayers` 用的 training provider（每次赛季边界一个实例；内部缓存团队比赛数）。
 * @param {object} state
 * @returns {(playerId: string, ctx?: object) => string}
 */
export function createTrainingProvider(state) {
  const availabilityCache = new Map();
  return (playerId, ctx = {}) => resolveTrainingLevel(state, playerId, ctx, availabilityCache);
}
