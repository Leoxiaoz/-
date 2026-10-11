/**
 * Decision RNG（Step 39F-M-B-IMPLEMENTATION-01）。
 * 层级归属：Simulation Core / Match Decision。纯函数，无副作用。
 *
 * 语义：Decision RNG 与 Resolution RNG / Event RNG **隔离**。Decision 的随机消费
 * **不得**影响其他 scope 的随机序列。scope 由稳定标识派生，确定性、可复现。
 *
 * 红线：禁止 Math.random / 禁止全局共享 stream；复用 rng.js 的 hashSeed + createRng。
 */

import { createRng, hashSeed } from '../rng.js';
import { DECISION_RULE_VERSION } from './decision-config.js';

/**
 * 构造 Decision RNG scope 字符串（稳定、确定性）。
 * @param {object} matchCore
 * @param {string} playerId
 * @param {number} decisionSequence 同一球员同一场比赛内的决策序号（默认 0）
 * @param {string} seed 比赛种子（默认取 matchCore.matchId）
 * @param {string} ruleVersion
 * @returns {string}
 */
export function buildDecisionScope(matchCore, playerId, decisionSequence = 0, seed = null, ruleVersion = DECISION_RULE_VERSION) {
  const worldId = matchCore?.worldId ?? '';
  const season = matchCore?.season ?? 1;
  const matchId = matchCore?.matchId ?? '';
  const resolvedSeed = seed ?? matchId;
  const seq = Number.isFinite(Number(decisionSequence)) ? Number(decisionSequence) : 0;
  return [
    'match-decision', ruleVersion, worldId, season, matchId, String(resolvedSeed), playerId, seq,
  ].join('|');
}

/**
 * 由 scope 创建确定性 Decision RNG。
 * @param {string} scope
 * @returns {ReturnType<typeof createRng>}
 */
export function createDecisionRng(scope) {
  return createRng(hashSeed(String(scope)));
}
