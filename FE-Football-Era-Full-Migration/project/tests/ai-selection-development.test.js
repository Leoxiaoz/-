/**
 * Step 39F-G — AI Selection: B2 Marginal Starter Cutoff + C2 Bounded Effective Competitive Score。
 * （D-42 / OD-39FG-DECISION-2 已冻结结构；cap/scale 为 temporary calibration defaults）
 *
 * 覆盖 G1–G16：DP=0 回归、接近能力反转、巨大差距不反转、tie-break、proximity/priority=0、
 * injured 排除、formation slot 保持、GK、managed club 不变、True Potential 边界、确定性、输入乱序稳定。
 *
 * 红线：不读 True Potential；不修改 Growth / Schema / Save；无 RNG。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { makeLeagueWorldFiles } from './fixtures.js';
import { getClubPlayers } from '../src/core/membership.js';
import {
  getPlayerProfile,
  getPlayerRuntime,
  getEffectiveAttributes,
  applyInjury,
  INJURY_STATUS,
} from '../src/core/player-runtime.js';
import { selectMatchSquad } from '../src/core/team-strength.js';
import { playerLineRating } from '../src/core/ai/ai-development-signals.js';
import {
  marginalStarterCutoff,
  developmentProximity,
  boundedDevelopmentInfluence,
  effectiveCompetitiveScore,
  rankLineCandidates,
  selectionDevelopmentPriority,
} from '../src/core/ai/ai-development-signals.js';
import { AI_SELECTION_DEVELOPMENT_CONFIG } from '../src/core/ai/ai-config.js';
import { FORMATIONS, DEFAULT_FORMATION, LINE_ATTRIBUTES } from '../src/core/sim-config.js';

const CFG = AI_SELECTION_DEVELOPMENT_CONFIG;
const OPTS = { distanceScale: CFG.DISTANCE_SCALE, cap: CFG.CAP };

function leagueState(n = 8) { return createGameState(parseWorld(makeLeagueWorldFiles(n))); }
function cand(id, rating, priority) { return { playerId: id, rating, priority }; }
/** rankLineCandidates → playerId 顺序。 */
function rank(list, slotCount = 1) {
  return rankLineCandidates(list, { ...OPTS, slotCount }).map((x) => x.playerId);
}

// ---------- G1 DP=0 回归：等价于 rating DESC + playerId ASC ----------
test('G1. DP=0 ⇒ 退化为 Current Ability DESC + playerId ASC', () => {
  assertEquals(rank([cand('b', 70, 0), cand('a', 70, 0)]), ['a', 'b'], '同分按 playerId 升序');
  assertEquals(rank([cand('a', 69, 0), cand('b', 70, 0)]), ['b', 'a'], '高分在前');
  assertEquals(rank([cand('c', 70, 0), cand('a', 72, 0), cand('b', 71, 0)]), ['a', 'b', 'c']);
});

// ---------- G2/G3/G4 接近能力允许反转 ----------
test('G2. 69 vs 68：高 DP 允许反转', () => {
  assertEquals(rank([cand('hi', 69, 0), cand('lo', 68, 1)]), ['lo', 'hi']);
});
test('G3. 66 vs 65：高 DP 允许反转', () => {
  assertEquals(rank([cand('hi', 66, 0), cand('lo', 65, 1)]), ['lo', 'hi']);
});
test('G4. 84 vs 83：高 DP 允许反转', () => {
  assertEquals(rank([cand('hi', 84, 0), cand('lo', 83, 1)]), ['lo', 'hi']);
});
test('G4b. 72 vs 68（gap=4）在 cap=2 下不可反转', () => {
  assertEquals(rank([cand('hi', 72, 0), cand('lo', 68, 1)]), ['hi', 'lo']);
});

// ---------- G5 巨大差距不可反转 ----------
test('G5. 84 vs 65：任何 DP 都不能反转', () => {
  for (const dp of [0, 0.25, 0.5, 0.75, 1]) {
    assertEquals(rank([cand('hi', 84, 0), cand('lo', 65, dp)]), ['hi', 'lo'], `dp=${dp}`);
  }
});

// ---------- G6/G7 同分 ----------
test('G6. 84 vs 84：DP 决定结果', () => {
  assertEquals(rank([cand('a', 84, 0), cand('b', 84, 1)]), ['b', 'a']);
});
test('G7. 84 vs 84 + DP 相同 ⇒ playerId ASC', () => {
  assertEquals(rank([cand('z', 84, 0.5), cand('a', 84, 0.5)]), ['a', 'z']);
});

// ---------- G8/G9 influence 归零 ----------
test('G8. proximity = 0 ⇒ influence = 0', () => {
  assertEquals(developmentProximity(CFG.DISTANCE_SCALE, CFG.DISTANCE_SCALE), 0);
  assertEquals(developmentProximity(999, CFG.DISTANCE_SCALE), 0);
  assertEquals(boundedDevelopmentInfluence(1, 0, CFG.CAP), 0);
  // gap >= scale ⇒ 低能力高 DP 也不改变结果
  assertEquals(rank([cand('hi', 70, 0), cand('lo', 64, 1)]), ['hi', 'lo']);
});
test('G9. priority = 0 ⇒ influence = 0；proximity=1 当 gap<=0', () => {
  assertEquals(boundedDevelopmentInfluence(0, 1, CFG.CAP), 0);
  assertEquals(developmentProximity(0, CFG.DISTANCE_SCALE), 1);
  assertEquals(developmentProximity(-3, CFG.DISTANCE_SCALE), 1);
});

test('G-extra. cap 直接界定最大可翻转 rating gap（cap=2 ⇒ 不能推翻 >2）', () => {
  assertEquals(effectiveCompetitiveScore(65, boundedDevelopmentInfluence(1, 1, 2)), 67);
});

test('G-extra2. marginalStarterCutoff：候选 ≤ slot 时为 null（gap 恒 0）', () => {
  assertEquals(marginalStarterCutoff([70, 68], 3), null);
  assertEquals(marginalStarterCutoff([72, 70, 68, 66, 60], 3), 68);
  assertEquals(marginalStarterCutoff([72, 70, 68, 66, 60], 1), 72);
});

// ---------- Integration ----------
function availableSorted(state, clubId, position) {
  return getClubPlayers(state, clubId)
    .map((id) => ({ id, p: getPlayerProfile(state, id), rt: getPlayerRuntime(state, id) }))
    .filter((x) => x.p && x.p.position === position && x.rt?.injury?.status !== INJURY_STATUS.INJURED)
    .map((x) => ({ id: x.id, r: playerLineRating(state, x.id) }))
    .sort((a, b) => b.r - a.r || a.id.localeCompare(b.id));
}
function firstLine(state, clubId, position) {
  return getClubPlayers(state, clubId).map((id) => getPlayerProfile(state, id)).find((p) => p && p.position === position);
}

test('G10. injured player 永远不能被 DP 拉回 selection', () => {
  const state = leagueState(8);
  const club = 'clb_001';
  const top = availableSorted(state, club, 'FW')[0];
  assert(top, '应有 FW');
  applyInjury(state, top.id, { type: 'knock', totalDays: 30, date: state.currentDate });
  const squad = selectMatchSquad(state, club, { formation: DEFAULT_FORMATION });
  assert(!squad.some((p) => p.id === top.id), '受伤球员不得入选');
});

test('G11. formation slot 数量严格保持', () => {
  const state = leagueState(8);
  const F = FORMATIONS[DEFAULT_FORMATION];
  const squad = selectMatchSquad(state, 'clb_001', { formation: DEFAULT_FORMATION });
  const count = (pos) => squad.filter((p) => p.position === pos).length;
  assertEquals(count('GK'), 1);
  assertEquals(count('DF'), F.DF);
  assertEquals(count('MF'), F.MF);
  assertEquals(count('FW'), F.FW);
});

test('G12. GK：每队仅 1 GK ⇒ 不得制造第二个 GK slot', () => {
  const state = leagueState(8);
  for (const clubId of Object.keys(state.runtime.clubs).sort()) {
    const squad = selectMatchSquad(state, clubId, { formation: DEFAULT_FORMATION });
    assertEquals(squad.filter((p) => p.position === 'GK').length, 1, `${clubId} 应恰有 1 GK`);
    const gkIds = getClubPlayers(state, clubId).map((id) => getPlayerProfile(state, id)).filter((p) => p && p.position === 'GK');
    assertEquals(gkIds.length, 1, `${clubId} 只有 1 名 GK`);
  }
});

test('G13. Managed Club：selectMatchSquad 行为保持 rating-only', () => {
  const state = leagueState(8);
  state.runtime.managedClubId = 'clb_001';
  const F = FORMATIONS[DEFAULT_FORMATION];
  const slot = { GK: 1, DF: F.DF, MF: F.MF, FW: F.FW };
  const squad = selectMatchSquad(state, 'clb_001', { formation: DEFAULT_FORMATION });
  for (const pos of ['GK', 'DF', 'MF', 'FW']) {
    const want = availableSorted(state, 'clb_001', pos).slice(0, slot[pos]).map((x) => x.id).sort();
    const got = squad.filter((p) => p.position === pos).map((p) => p.id).sort();
    assertEquals(got, want, `managed ${pos} 应为 rating-only`);
  }
});

test('G14. True Potential 边界：仅提高 True Potential（不改变有效属性）⇒ priority 不变', () => {
  const state = leagueState(8);
  const player = state.static.players.find((p) => p.potential && p.pace < p.potential.pace);
  assert(player, '需要一个 base < potential 的球员');
  const clubId = 'clb_001';
  const before = selectionDevelopmentPriority(state, clubId, player.id);
  const effBefore = getEffectiveAttributes(state, player.id);
  for (const attr of Object.keys(player.potential)) player.potential[attr] = 99;
  const after = selectionDevelopmentPriority(state, clubId, player.id);
  const effAfter = getEffectiveAttributes(state, player.id);
  assertEquals(after, before, 'priority 不得因 True Potential 改变');
  assertEquals(effAfter.pace, effBefore.pace, '有效属性不应改变（base ≤ potential）');
});

test('G15. Determinism：相同 state 连续两次 selectMatchSquad 结果完全相同', () => {
  const state = leagueState(8);
  const a = selectMatchSquad(state, 'clb_002', { formation: DEFAULT_FORMATION }).map((p) => p.id);
  const b = selectMatchSquad(state, 'clb_002', { formation: DEFAULT_FORMATION }).map((p) => p.id);
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

test('G16. 输入乱序 ⇒ 结果一致（playerId deterministic tie-break）', () => {
  const base = [cand('c', 70, 0), cand('a', 70, 0), cand('b', 69, 1), cand('d', 68, 0)];
  const shuffled = [base[3], base[1], base[0], base[2]];
  assertEquals(
    JSON.stringify(rank(base, 2)),
    JSON.stringify(rank(shuffled, 2)),
  );
});
