/**
 * Movement RNG（Step 39F-M-C）。
 * 层级归属：Simulation Core / Match Movement。**纯函数**，无副作用。
 *
 * 语义（§17）：
 * - Movement 使用 **独立 RNG scope**，与 Decision / Resolution / Event RNG 逻辑隔离，互不污染。
 * - **禁止 Math.random()**。
 * - 默认尽量确定性计算；仅在必要时使用极小的 deterministic jitter / reaction delay。
 * - 同一 `seed + world + season + match + player + sequence` 必须可复现。
 */

import { createRng } from '../rng.js';
import { MOVEMENT_RULE_VERSION } from './movement-config.js';

/**
 * 构造稳定 Movement RNG scope。
 * 格式：match-movement|<ruleVersion>|<worldId>|<season>|<matchId>|<seed>|<playerId>|<sequence>
 */
export function buildMovementScope(matchCore, playerId, sequence = 0, opts = {}) {
  const ruleVersion = opts.ruleVersion ?? matchCore?.ruleVersion ?? MOVEMENT_RULE_VERSION;
  return [
    'match-movement',
    ruleVersion,
    matchCore?.worldId ?? 'w',
    matchCore?.season ?? 0,
    matchCore?.matchId ?? 'm',
    opts.seed ?? 'seed',
    playerId,
    sequence,
  ].join('|');
}

/** 由 scope 创建隔离的 Movement RNG。 */
export function createMovementRng(matchCore, playerId, sequence = 0, opts = {}) {
  return createRng(buildMovementScope(matchCore, playerId, sequence, opts));
}