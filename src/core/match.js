/**
 * 单场比赛模拟（Simulation Core）。
 * 层级归属：Simulation Core，纯逻辑，不依赖 DOM / 存储。
 *
 * 抽象层级：**时段制**（DECISIONS D-02 / SIMULATION_SPEC S1/T6）——
 * 把 90 分钟均分为若干时段逐段结算，兼顾真实度与移动端性能。
 *
 * 模块化（SIMULATION_SPEC §1）：本文件按可独立替换的阶段拆分导出：
 *   1) 期望进球（实力/战术调制）
 *   2) 时段结算（事件生成）
 *   3) 进球者选择
 *   4) 统计汇总
 * 编排入口为 `simulateMatch`。
 *
 * 红线：随机只扰动由实力决定的目标期望，不得让结果脱离实力对比（SIMULATION_SPEC §11）；
 * 同一（比赛条件 + 种子）必须可复现（项目规则第 10 条）。
 */

import { MATCH_CONFIG, MENTALITY, MATCH_LOAD_CONFIG } from './sim-config.js';
import { createRng, deriveMatchSeed } from './rng.js';

/** 攻守倾向倍率（未知倾向回退 balanced）。 */
function mentalityFactor(mentality) {
  return MENTALITY[mentality] ?? MENTALITY.balanced;
}

/**
 * 阶段 1：计算一方在本场的期望进球。
 * 输入：己方进攻、己方中场、对方防守、对方门将、战术倾向、是否主场。
 * @returns {number}
 */
export function expectedGoals(input) {
  const { attack, midfield, opponentMidfield, opponentDefence, opponentGoalkeeping, mentality, isHome } = input;
  const floor = MATCH_CONFIG.STRENGTH_FLOOR;
  const control = midfield / (midfield + opponentMidfield); // 0..1
  const attackFactor = attack / Math.max(floor, opponentDefence);
  const gkFactor = 1 - (opponentGoalkeeping - 50) / 200; // 门将越强，越少
  const homeFactor = isHome ? MATCH_CONFIG.HOME_ADVANTAGE : 1;
  return (
    MATCH_CONFIG.BASE_EXPECTED_GOALS *
    attackFactor *
    gkFactor *
    mentalityFactor(mentality) *
    (0.6 + 0.8 * control) *
    homeFactor
  );
}

/**
 * 阶段 3：按位置与能力加权选出进球者。
 * 优先前锋（射术），其次中场（组织），再次后卫；门将不进球。
 */
export function selectScorer(players, rng) {
  const weights = { FW: 'finishing', MF: 'technique', DF: 'defending' };
  const buckets = [];
  for (const [position, attr] of Object.entries(weights)) {
    for (const p of players.filter((pl) => pl.position === position)) {
      const v = Number(p[attr]);
      buckets.push({ id: p.id, weight: (Number.isFinite(v) ? v : 50) ** 2 });
    }
  }
  if (buckets.length === 0) return null; // 无合适球员（数据不足），不指派进球者
  const total = buckets.reduce((s, b) => s + b.weight, 0);
  let r = rng.next() * total;
  for (const b of buckets) {
    r -= b.weight;
    if (r <= 0) return b.id;
  }
  return buckets[buckets.length - 1].id;
}

/**
 * 阶段 2：逐时段结算进球事件。
 * 事件统一结构：`{ minute, teamId, type, actorId, assistId, segment, reason }`（G1a）。
 * 本阶段仍只有 `goal` 事件；`assistId` 无可靠来源，恒为 null（不新增随机源）。
 * @returns {{events: object[], goals: number}}
 */
export function simulateSegments({ teamId, players, expected, seedRng }) {
  const { SEGMENTS, NOISE_AMPLITUDE } = MATCH_CONFIG;
  const events = [];
  let goals = 0;
  for (let i = 0; i < SEGMENTS; i += 1) {
    const perSegment = expected / SEGMENTS;
    const noise = 1 + NOISE_AMPLITUDE * (seedRng.next() * 2 - 1);
    const p = Math.max(0, perSegment * noise);
    if (seedRng.next() < p) {
      const minuteRange = 90 / SEGMENTS;
      const minute = Math.min(90, Math.floor(i * minuteRange + seedRng.next() * minuteRange) + 1);
      const actorId = selectScorer(players, seedRng);
      goals += 1;
      events.push({
        minute,
        teamId,
        type: 'goal',
        actorId,
        assistId: null, // 当前无可靠助攻来源，保持 null（不制造随机助攻）
        segment: i + 1,
        reason: `第 ${i + 1} 时段：实力与战术综合期望触发进球`,
      });
    }
  }
  return { events, goals };
}

/**
 * 阶段 4b（G1a）：由「本场实际出场阵容 + 事件流」**确定性**派生每名球员的参与记录。
 * - 当前模型：每名出场球员 role='starter'、minutes=MATCH_LOAD_CONFIG.MINUTES_PER_MATCH（90）。
 * - 未出场球员**不写入** involvements。
 * - goals/assists/yellow/red 由事件流累计；当前仅 goal 有来源，assist/yellow/red 恒为 0。
 * - 结构为未来 D（换人：role='sub' + 可变 minutes）预留，但**本阶段不产生 sub**。
 * @param {object[]} players 本场实际使用的球员（含 id/position）
 * @param {'home'|'away'} side
 * @param {object[]} events 该方的事件
 * @returns {Record<string, object>} playerId → involvement
 */
export function buildInvolvements(players, side, events) {
  const involvements = {};
  for (const p of players) {
    involvements[p.id] = {
      side,
      role: 'starter',
      position: p.position,
      minutes: MATCH_LOAD_CONFIG.MINUTES_PER_MATCH,
      goals: 0,
      assists: 0,
      yellow: 0,
      red: 0,
    };
  }
  for (const ev of events) {
    const rec = ev.actorId ? involvements[ev.actorId] : null;
    if (!rec) continue;
    if (ev.type === 'goal') rec.goals += 1;
    else if (ev.type === 'assist') rec.assists += 1;
    else if (ev.type === 'yellow') rec.yellow += 1;
    else if (ev.type === 'red') rec.red += 1;
  }
  return involvements;
}

/**
 * 编排入口：模拟一场比赛。
 * @param {object} params
 * @param {object} params.home 主队 { strength, players, tactics, teamId }
 * @param {object} params.away 客队 同上
 * @param {object} params.context { worldId, season, round, homeId, awayId }
 * @param {string|number} [params.seed] 覆盖默认派生种子（默认由 context 派生，保证可复现）
 * @returns {{matchSeed, homeGoals, awayGoals, events, involvements}}
 */
export function simulateMatch({ home, away, context, seed }) {
  const matchSeed = seed ?? deriveMatchSeed({
    worldId: context?.worldId ?? '',
    season: context?.season ?? 1,
    round: context?.round ?? 0,
    homeId: home.teamId,
    awayId: away.teamId,
  });
  const rng = createRng(matchSeed);

  const homeExpected = expectedGoals({
    attack: home.strength.attack,
    midfield: home.strength.midfield,
    opponentMidfield: away.strength.midfield,
    opponentDefence: away.strength.defence,
    opponentGoalkeeping: away.strength.goalkeeping,
    mentality: home.tactics?.mentality,
    isHome: true,
  });
  const awayExpected = expectedGoals({
    attack: away.strength.attack,
    midfield: away.strength.midfield,
    opponentMidfield: home.strength.midfield,
    opponentDefence: home.strength.defence,
    opponentGoalkeeping: home.strength.goalkeeping,
    mentality: away.tactics?.mentality,
    isHome: false,
  });

  const homeSeg = simulateSegments({ teamId: home.teamId, players: home.players, expected: homeExpected, seedRng: rng });
  const awaySeg = simulateSegments({ teamId: away.teamId, players: away.players, expected: awayExpected, seedRng: rng });

  const events = [...homeSeg.events, ...awaySeg.events].sort((a, b) => a.minute - b.minute);

  // G1a：统一比赛参与结构（后处理由 involvements 驱动，不再分别扫描阵容/事件推导统计）。
  const involvements = {
    ...buildInvolvements(home.players, 'home', homeSeg.events),
    ...buildInvolvements(away.players, 'away', awaySeg.events),
  };

  return {
    matchSeed,
    homeGoals: homeSeg.goals,
    awayGoals: awaySeg.goals,
    events,
    involvements,
  };
}