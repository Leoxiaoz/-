/**
 * 确定性随机数（Simulation Core）。
 * 目的：同一（数据库 + 存档 + 比赛条件 + 种子）必须产出可复现结果（项目规则第 10 条）。
 *
 * 实现：mulberry32 —— 轻量、无依赖、跨平台一致（只使用整数位运算，规避浮点差异）。
 */

/**
 * 把任意字符串种子散列为 32 位无符号整数（FNV-1a）。
 * @param {string} str
 * @returns {number}
 */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 创建确定性随机源。
 * @param {number|string} seed
 * @returns {{next: () => number, int: (maxExclusive: number) => number, pick: <T>(arr: T[]) => T, seed: number}}
 */
export function createRng(seed) {
  const resolved = typeof seed === 'number' ? seed >>> 0 : hashSeed(String(seed));
  let a = resolved;

  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    seed: resolved,
    next,
    /** 返回 [0, maxExclusive) 的整数。 */
    int(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) return 0;
      return Math.floor(next() * maxExclusive);
    },
    /** 从数组中等概率取一元素（空数组返回 null）。 */
    pick(arr) {
      if (!Array.isArray(arr) || arr.length === 0) return null;
      return arr[Math.floor(next() * arr.length)];
    },
  };
}

/**
 * 派生一个稳定的比赛种子，确保"同一场比赛"在重算时得到同一随机序列。
 * @param {object} parts
 * @returns {string}
 */
export function deriveMatchSeed(parts) {
  return [
    'match',
    parts.worldId,
    parts.season,
    parts.round,
    parts.homeId,
    parts.awayId,
  ].join('|');
}