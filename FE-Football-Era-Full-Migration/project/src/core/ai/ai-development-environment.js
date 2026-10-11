/**
 * Development Environment（D39 Phase 1 / Step 39F-A）。
 * 层级归属：Simulation Core / AI。纯派生、只读、无 RNG、不持久化。
 *
 * 规范来源：D39-I（Step 39C 冻结）/ Step 39E-R §三（R-3 冻结）。
 * 语义：Development Environment 是 **Condition / Input**，**不是** Growth Multiplier。
 *
 * 红线：
 * - 禁止 Club Strength / Club Reputation / Transfer Budget / Cash 直接变成 Growth Bonus。
 * - 不使用 True / Estimated Potential。
 * - Phase 1 无 Staff / Facilities / Youth Academy 数据 ⇒ `trainingEnvironment` / `developmentSupport` 默认 NORMAL。
 * - 不写 Player Runtime / Save；不改 Growth。
 */

import { getPlayerProfile } from '../player-runtime.js';
import { clamp01, positionCompetitionFit, squadDepthFit, abilityGapFit, developmentPhaseFit, squadStructureFit } from './ai-development-signals.js';

/** 环境档位枚举。 */
export const ENVIRONMENT_LEVEL = Object.freeze({ LIMITED: 'LIMITED', NORMAL: 'NORMAL', STRONG: 'STRONG' });

/** 档位 → 归一化信号（Owner §三 / §5.1–5.2 冻结：LIMITED 0.25 / NORMAL 0.50 / STRONG 0.75）。 */
export const ENVIRONMENT_LEVEL_SCORE = Object.freeze({
  LIMITED: 0.25,
  NORMAL: 0.50,
  STRONG: 0.75,
});

/** 解析档位（未知 / 缺失 → NORMAL）。 */
function levelScore(level) {
  const v = ENVIRONMENT_LEVEL_SCORE[level];
  return Number.isFinite(v) ? v : ENVIRONMENT_LEVEL_SCORE.NORMAL;
}

/**
 * 评估某球员的 Development Environment（Phase 1）。
 * @returns {{trainingEnvironment: string, developmentSupport: string,
 *            pathCompatibility: number, environmentInput: number}|null} 全部 ∈ [0,1]（除档位字符串）
 */
export function evaluateDevelopmentEnvironment(state, clubId, playerId, context = {}) {
  const trainingEnvironment = context.trainingEnvironment ?? ENVIRONMENT_LEVEL.NORMAL;
  const developmentSupport = context.developmentSupport ?? ENVIRONMENT_LEVEL.NORMAL;

  const trainingEnvironmentScore = levelScore(trainingEnvironment);
  const developmentSupportScore = levelScore(developmentSupport);

  const profile = getPlayerProfile(state, playerId);
  if (!profile) return null;
  const position = context.position ?? profile.position;

  // pathCompatibility = 0.30×PositionCompetitionFit + 0.25×SquadDepthFit + 0.20×AbilityGapFit
  //                   + 0.15×DevelopmentPhaseFit + 0.10×SquadStructureFit   （Owner §三 权重冻结）
  const pathCompatibility = clamp01(
    0.30 * positionCompetitionFit(state, clubId, position)
    + 0.25 * squadDepthFit(state, clubId)
    + 0.20 * abilityGapFit(state, clubId, playerId)
    + 0.15 * developmentPhaseFit(state, playerId)
    + 0.10 * squadStructureFit(state, clubId, position),
  );

  // environmentInput = 0.40×trainingEnvironmentScore + 0.30×developmentSupportScore + 0.30×pathCompatibility
  const environmentInput = clamp01(
    0.40 * trainingEnvironmentScore
    + 0.30 * developmentSupportScore
    + 0.30 * pathCompatibility,
  );

  return { trainingEnvironment, developmentSupport, pathCompatibility, environmentInput };
}
