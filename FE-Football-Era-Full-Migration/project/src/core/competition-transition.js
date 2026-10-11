/**
 * Competition Transition —— Promotion/Relegation Phase 1（Step 38E；D38D.4–D38D.6、D38D.9、D38D.13）。
 * 层级归属：Simulation Core。**纯函数 planner + 受控原子 apply**，不依赖 DOM / 存储 / UI，无 RNG。
 *
 * 两阶段（D38D.4）：
 * - **Phase A**：`planPromotionRelegation(state)` —— **只读**，基于"迁移前"的完整世界状态（各 Division 最终
 *   standings + World Data Rules + tier 邻接）生成完整 `PromotionRelegationPlan`。
 * - **Phase B**：`applyPromotionRelegationTransition(state, plan)` —— 先**完整校验**，再**一次性**经
 *   `membership.setClubLeagueMembership` 写入，随后 `assertMembershipValid`；**任意失败 all-or-nothing**（回滚）。
 *
 * 冻结约束：
 * - 只允许**相邻 tier**（D38D.5）；top tier 不升级、bottom tier 不降级（D38D.6）；
 * - 一个 club 每次 transition **最多移动一次**（D38D.4）；
 * - 确定性与稳定排序（不依赖 `Object.keys()` 顺序，无 `Math.random` / `Date.now`）；
 * - Plan 是**临时运行时对象**，不持久化（D38D.12）。
 */

import { SimulationError } from '../shared/errors.js';
import { sortTable } from './standings.js';
import {
  getCompetitionRules,
  getDivisionTier,
  compareId,
} from './competition.js';
import { setClubLeagueMembership, assertMembershipValid } from './membership.js';

/** 抛出带稳定错误码的 plan/transition 错误。 */
function fail(code, message, context) {
  throw new SimulationError(message, { code, context });
}

/** 按 country 分组（无 countryId 的 league 各自成组，避免跨组错配；确定性）。 */
function groupDivisionsByCountry(state) {
  const groups = new Map();
  for (const league of state?.static?.leagues ?? []) {
    const key = typeof league.countryId === 'string' ? league.countryId : `__solo__:${league.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(league.id);
  }
  return groups;
}

/**
 * Phase A：纯 planner（只读，不修改 state）。
 * 对每个 Country：按 tier 升序取相邻 Division，依据各自最终 standings 与 rules 生成 movement：
 * - **升级**：某 Division 排名**前 `promotionPlaces`** 者升入**上一层**（top tier 无上一层 → 0）；
 * - **降级**：某 Division 排名**后 `relegationPlaces`** 者降入**下一层**（bottom tier 无下一层 → 0）。
 * 名额经 clamp，且保证同 Division 内"升级集"与"降级集"不重叠（必要时缩减降级名额，确定性）。
 * @returns {{movements: Array<{clubId:string, fromDivisionId:string, toDivisionId:string, kind:'promotion'|'relegation'}>}}
 */
export function planPromotionRelegation(state) {
  const comps = state?.runtime?.competitions ?? {};
  const movements = [];
  const groups = groupDivisionsByCountry(state);
  const groupKeys = [...groups.keys()].sort(compareId);

  for (const key of groupKeys) {
    const divisions = groups.get(key)
      .map((id) => ({ id, tier: getDivisionTier(state, id) }))
      .sort((a, b) => (a.tier - b.tier) || compareId(a.id, b.id));
    const n = divisions.length;
    if (n < 2) continue; // 单 Division：无升降级

    for (let i = 0; i < n; i += 1) {
      const d = divisions[i];
      const comp = comps[d.id];
      if (!comp) continue;
      const ranked = sortTable(comp.table ?? {}); // 确定性：points → GD → GF → teamId
      const size = ranked.length;
      if (size === 0) continue;

      const rules = getCompetitionRules(state, d.id);
      let promotion = i === 0 ? 0 : rules.promotionPlaces; // 升入 division[i-1]
      let relegation = i === n - 1 ? 0 : rules.relegationPlaces; // 降入 division[i+1]
      promotion = Math.max(0, Math.min(promotion, size));
      relegation = Math.max(0, Math.min(relegation, size));
      if (promotion + relegation > size) relegation = Math.max(0, size - promotion); // 上下不重叠

      const upTarget = i > 0 ? divisions[i - 1].id : null;
      const downTarget = i < n - 1 ? divisions[i + 1].id : null;
      for (let k = 0; k < promotion; k += 1) {
        movements.push({ clubId: ranked[k].teamId, fromDivisionId: d.id, toDivisionId: upTarget, kind: 'promotion' });
      }
      for (let k = 0; k < relegation; k += 1) {
        movements.push({ clubId: ranked[size - 1 - k].teamId, fromDivisionId: d.id, toDivisionId: downTarget, kind: 'relegation' });
      }
    }
  }

  movements.sort((a, b) => compareId(a.clubId, b.clubId));
  return { movements };
}

/**
 * 校验一个 Promotion/Relegation Plan（只读；发现问题**明确报错**，不静默、不猜测）。
 * @param {object} state
 * @param {{movements:Array}} plan
 */
export function validatePromotionRelegationPlan(state, plan) {
  const movements = plan?.movements;
  if (!Array.isArray(movements)) {
    fail('INVALID_PLAN', 'plan.movements 必须是数组', { received: typeof movements });
  }
  const clubs = state?.runtime?.clubs ?? {};
  const membership = state?.runtime?.membership?.clubs ?? {};
  const validLeagues = new Set((state?.static?.leagues ?? []).map((l) => l.id));
  const seen = new Set();

  for (const mv of movements) {
    if (!mv || typeof mv.clubId !== 'string') fail('INVALID_PLAN', 'movement.clubId 非法', { mv });
    if (!clubs[mv.clubId]) fail('INVALID_PLAN', `club 不存在：${mv.clubId}`, { clubId: mv.clubId });
    if (seen.has(mv.clubId)) fail('DUPLICATE_MOVEMENT', `club 重复移动：${mv.clubId}`, { clubId: mv.clubId });
    seen.add(mv.clubId);

    if (typeof mv.fromDivisionId !== 'string' || !validLeagues.has(mv.fromDivisionId)) {
      fail('INVALID_PLAN', `fromDivision 不存在：${mv.fromDivisionId}`, { mv });
    }
    if (typeof mv.toDivisionId !== 'string' || !validLeagues.has(mv.toDivisionId)) {
      fail('INVALID_PLAN', `toDivision 不存在：${mv.toDivisionId}`, { mv });
    }
    if (mv.fromDivisionId === mv.toDivisionId) {
      fail('INVALID_PLAN', `from === to：${mv.clubId}`, { mv });
    }
    if (membership[mv.clubId] !== mv.fromDivisionId) {
      fail('SOURCE_MISMATCH', `source membership 与 plan.from 不一致：${mv.clubId}`, {
        clubId: mv.clubId, membership: membership[mv.clubId], planFrom: mv.fromDivisionId,
      });
    }
    const from = state.static.leagues.find((l) => l.id === mv.fromDivisionId);
    const to = state.static.leagues.find((l) => l.id === mv.toDivisionId);
    const fromCountry = from?.countryId ?? null;
    const toCountry = to?.countryId ?? null;
    if (fromCountry !== toCountry) {
      fail('COUNTRY_MISMATCH', `跨国家迁移不允许：${mv.clubId}`, { fromCountry, toCountry });
    }
    const fromTier = getDivisionTier(state, mv.fromDivisionId);
    const toTier = getDivisionTier(state, mv.toDivisionId);
    if (Math.abs(fromTier - toTier) !== 1) {
      fail('NON_ADJACENT_TIER', `只允许相邻 tier：${mv.clubId}`, { fromTier, toTier });
    }
    if (mv.kind === 'promotion' && toTier !== fromTier - 1) {
      fail('INVALID_MOVEMENT_KIND', `promotion 必须升一级：${mv.clubId}`, { fromTier, toTier });
    }
    if (mv.kind === 'relegation' && toTier !== fromTier + 1) {
      fail('INVALID_MOVEMENT_KIND', `relegation 必须降一级：${mv.clubId}`, { fromTier, toTier });
    }
  }
  return { movements: movements.length };
}

/**
 * Phase B：原子应用 Plan（先完整校验 → 一次性写入 → 全局校验；失败 all-or-nothing 回滚）。
 * 空 plan 为安全 no-op。
 * @param {object} state
 * @param {{movements:Array}} plan
 * @returns {{applied:boolean, moved:number}}
 */
export function applyPromotionRelegationTransition(state, plan) {
  const movements = plan?.movements ?? [];
  if (movements.length === 0) return { applied: false, moved: 0 };
  validatePromotionRelegationPlan(state, plan);

  const m = state.runtime.membership;
  const snapshot = { ...m.clubs };
  try {
    for (const mv of movements) setClubLeagueMembership(state, mv.clubId, mv.toDivisionId);
    assertMembershipValid(state); // apply 后全局校验；失败则回滚（all-or-nothing）
  } catch (err) {
    m.clubs = snapshot;
    throw err;
  }
  return { applied: true, moved: movements.length };
}
