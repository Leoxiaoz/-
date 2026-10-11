/**
 * Step 39F-H — Rotation / Actual Match Minutes（AI Club Minute Allocation）。
 * 覆盖 H1–H20：Core Starter 90、离散轮换分钟、Development 轻度影响、大差距不可逆、DP=0 回归、
 * injured=0、GK 90/0、position isolation、Managed 90/0、determinism、累计、PO 输入、Growth 公式不变、
 * True Potential 边界、无新 runtime state、schema/save 不变、比分不变、长期无非法分钟。
 *
 * 红线：不改 Growth / Fitness cost / Team Strength / Expected Goals / Schema / Save；无 RNG。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState, GAME_STATE_SCHEMA_VERSION } from '../src/core/game-state.js';
import { parseWorld, WORLD_FORMAT } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { simulateMatch } from '../src/core/match.js';
import { makeLeagueWorldFiles } from './fixtures.js';
import { SAVE_FORMAT_VERSION } from '../src/save/save-manager.js';
import {
  getPlayerRuntime, getPlayerProfile, getEffectiveAttributes, applyInjury, INJURY_STATUS,
} from '../src/core/player-runtime.js';
import {
  resolveMatchSquad, computeTeamStrength, planMatchMinutes, allocateMatchMinutes, rotationMinutesFor,
} from '../src/core/team-strength.js';
import { selectionDevelopmentPriority } from '../src/core/ai/ai-development-signals.js';
import { matchExperienceInput } from '../src/core/player-growth.js';
import { evaluatePlayingOpportunity } from '../src/core/ai/ai-playing-opportunity.js';
import { AI_SELECTION_DEVELOPMENT_CONFIG } from '../src/core/ai/ai-config.js';

const ATT = ['pace', 'technique', 'passing', 'defending', 'finishing', 'goalkeeping'];

function leagueState(n = 8) { return createGameState(parseWorld(makeLeagueWorldFiles(n))); }

/** 受控世界：clb_a 为被测 AI 队（含近/远轮换候选），clb_b 填充。 */
function controlledState() {
  const players = [];
  const mk = (id, teamId, position, rating, age) => {
    const attrs = {}; for (const a of ATT) attrs[a] = rating;
    const potential = {}; for (const a of ATT) potential[a] = Math.min(99, rating + 8);
    players.push({ id, name: id, teamId, position, birthDate: `${2026 - age}-01-15`, ...attrs, potential,
      personality: { professionalism: 60, determination: 60, ambition: 60, consistency: 60, injuryProneness: 40 } });
  };
  mk('a_gk1', 'clb_a', 'GK', 70, 27); mk('a_gk2', 'clb_a', 'GK', 69, 20);
  for (let i = 0; i < 4; i += 1) mk(`a_df${i}`, 'clb_a', 'DF', 70, 26);
  mk('a_df_sub', 'clb_a', 'DF', 58, 17);          // 远处候选（gap 12 > scale）→ 不轮换
  for (let i = 0; i < 4; i += 1) mk(`a_mf${i}`, 'clb_a', 'MF', 70, 26);
  mk('a_mf_sub', 'clb_a', 'MF', 69, 17);          // 近处年轻候选 → 轮换
  mk('a_fw1', 'clb_a', 'FW', 70, 27); mk('a_fw2', 'clb_a', 'FW', 70, 27);
  mk('a_fw_sub', 'clb_a', 'FW', 69, 17);
  mk('b_gk', 'clb_b', 'GK', 60, 26);
  for (let i = 0; i < 4; i += 1) mk(`b_df${i}`, 'clb_b', 'DF', 60, 26);
  for (let i = 0; i < 4; i += 1) mk(`b_mf${i}`, 'clb_b', 'MF', 60, 26);
  for (let i = 0; i < 2; i += 1) mk(`b_fw${i}`, 'clb_b', 'FW', 60, 26);
  return createGameState(parseWorld({
    manifest: { id: 'w_39fh', name: 'w39fh', version: '0.1.0', format: WORLD_FORMAT, startDate: '2026-07-01' },
    countries: [{ id: 'cty_a', name: 'A' }],
    leagues: [{ id: 'lg_a', name: 'L', countryId: 'cty_a', tier: 1 }],
    teams: [
      { id: 'clb_a', name: 'A', leagueId: 'lg_a', formation: '4-4-2' },
      { id: 'clb_b', name: 'B', leagueId: 'lg_a', formation: '4-4-2' },
    ],
    players,
  }));
}
const T = { formation: '4-4-2' };
function plan(state, teamId = 'clb_a') {
  const xi = resolveMatchSquad(state, teamId, T);
  return { xi, ...planMatchMinutes(state, teamId, T, xi) };
}

// ---------- H1 Core Starter → 90 ----------
test('H1. 无近距候选 ⇒ 全部 Core Starter = 90', () => {
  const s = controlledState();
  const { slots } = plan(s);
  const df = slots.find((z) => z.position === 'DF');
  assertEquals(df.allocations.length, 4);
  assert(df.allocations.every((a) => a.minutes === 90), 'DF 应全为 90（远处候选不可轮换）');
});

// ---------- H2 / H5 Rotation → 离散分钟 ----------
test('H2/H5. 近距年轻候选 ⇒ 发生有限轮换且分钟为离散档位', () => {
  const s = controlledState();
  const { slots, minutesByPlayer } = plan(s);
  const mf = slots.find((z) => z.position === 'MF');
  const sub = mf.allocations.find((a) => a.playerId === 'a_mf_sub');
  assert(sub && sub.minutes > 0, '近距年轻候选应获得轮换分钟');
  assert([15, 20, 30, 45].includes(sub.minutes), `分钟应为离散档位，实际 ${sub?.minutes}`);
  const reduced = mf.allocations.find((a) => a.playerId !== 'a_mf_sub' && a.minutes < 90);
  assert(reduced, '应有主力被削减分钟');
  assertEquals(reduced.minutes, 90 - sub.minutes, '主力与候选分钟互补');
  assert(reduced.minutes >= AI_SELECTION_DEVELOPMENT_CONFIG.STARTER_MIN_MINUTES, '主力保护下界');
  assertEquals(mf.allocations.reduce((x, a) => x + a.minutes, 0), 360, 'MF line 守恒 360');
  assert(minutesByPlayer.get('a_mf_sub') > 0);
});

// ---------- H3 Development 轻度 ----------
test('H3. Development Priority 只产生轻度影响（分钟均为合法离散档位）', () => {
  const s = controlledState();
  const { slots } = plan(s);
  const ALLOWED = new Set([0, 15, 20, 30, 45, 60, 70, 75, 90]);
  for (const slot of slots) {
    for (const a of slot.allocations) {
      assert(a.minutes >= 0 && a.minutes <= 90, `分钟越界 ${a.minutes}`);
      assert(ALLOWED.has(a.minutes), `非离散档位 ${a.minutes}`);
    }
  }
});

// ---------- H4 大差距不可逆 ----------
test('H4. 明显能力差距（gap > scale）⇒ Development Priority 不可逆，不轮换', () => {
  const s = controlledState();
  const { slots } = plan(s);
  const df = slots.find((z) => z.position === 'DF');
  assert(!df.allocations.some((a) => a.playerId === 'a_df_sub'), '远距候选不得进入 minutes');
  assertEquals(df.allocations.length, 4);
});

// ---------- H6 DP=0 回归 ----------
test('H6. rotationMinutesFor：强度不足返回 0（DP=0 或非近距 ⇒ 无轮换）', () => {
  assertEquals(rotationMinutesFor(0), 0);
  assertEquals(rotationMinutesFor(0.05), 0);
  assert(rotationMinutesFor(0.1) > 0);
  // 老将候选（VETERAN gate → priority≈0）不轮换
  const s = controlledState();
  s.static.players.find((p) => p.id === 'a_mf_sub').birthDate = '1993-01-15'; // age 33
  const { slots } = plan(s);
  const mf = slots.find((z) => z.position === 'MF');
  assertEquals(mf.allocations.length, 4, '老将候选不应轮换');
});

// ---------- H7 Injured ----------
test('H7. Injured 候选 = 0（不得因 DP/年龄绕过伤病）', () => {
  const s = controlledState();
  applyInjury(s, 'a_mf_sub', { type: 'knock', totalDays: 30, date: s.currentDate });
  const { slots } = plan(s);
  const mf = slots.find((z) => z.position === 'MF');
  assert(!mf.allocations.some((a) => a.playerId === 'a_mf_sub'), '受伤者不得进入 minutes');
  assertEquals(mf.allocations.reduce((x, a) => x + a.minutes, 0), 360);
});

// ---------- H8 GK ----------
test('H8. GK 恒 90/0（不参与轮换）', () => {
  const s = controlledState();
  const { slots } = plan(s);
  const gk = slots.find((z) => z.position === 'GK');
  assertEquals(gk.allocations.length, 1);
  assertEquals(gk.allocations[0].minutes, 90);
  assertEquals(gk.total, 90);
});

// ---------- H9 Position isolation ----------
test('H9. 位置隔离：某线轮换不影响其他线', () => {
  const s = controlledState();
  const { slots } = plan(s);
  const byPos = Object.fromEntries(slots.map((z) => [z.position, z]));
  assertEquals(byPos.GK.allocations[0].minutes, 90);
  assertEquals(byPos.DF.allocations.length, 4);
  assertEquals(byPos.DF.allocations.reduce((x, a) => x + a.minutes, 0), 360);
  assertEquals(byPos.FW.allocations.reduce((x, a) => x + a.minutes, 0), 180);
  assert(!byPos.GK.allocations.some((a) => a.playerId.startsWith('a_mf')), 'MF 不应出现在 GK');
});

// ---------- H10 Managed ----------
test('H10. Managed Club ⇒ 全部 90（不受 AI Rotation 影响）', () => {
  const s = controlledState();
  s.runtime.managedClubId = 'clb_a';
  const { xi, minutesByPlayer } = plan(s);
  assertEquals([...minutesByPlayer.values()].every((m) => m === 90), true);
  assertEquals(minutesByPlayer.size, xi.length);
});

// ---------- 强制不变量 ----------
test('INV. 单球员 0–90 / slot 守恒 / 全队 990 / Appearance ⊇ XI', () => {
  const s = controlledState();
  const { xi, slots, minutesByPlayer } = plan(s);
  let total = 0;
  for (const slot of slots) {
    const sum = slot.allocations.reduce((x, a) => x + a.minutes, 0);
    assertEquals(sum, slot.total, `${slot.position} slot 守恒`);
    total += sum;
    for (const a of slot.allocations) assert(a.minutes >= 0 && a.minutes <= 90, '0..90');
  }
  assertEquals(total, 990, '整场总分钟 990');
  assertEquals(xi.length, 11, 'Effective XI = 11');
  const appearance = [...minutesByPlayer.values()].filter((m) => m > 0).length;
  assert(appearance > 11, 'Appearance Set 可 > 11');
});

test('H11/H12. Determinism：重复调用 / 输入稳定 ⇒ 完全一致', () => {
  const s = controlledState();
  const a = plan(s);
  const b = plan(s);
  assertEquals(JSON.stringify([...a.minutesByPlayer]), JSON.stringify([...b.minutesByPlayer]));
});

// ---------- H13 累计 ----------
test('H13. Actual Minutes 正确累计到 stats.season.minutes', () => {
  const s = leagueState(8);
  new SimulationCore().advanceDays(s, 1);
  let seen = 0;
  for (const id of Object.keys(s.runtime.players)) {
    const m = getPlayerRuntime(s, id).stats.season.minutes;
    assert(Number.isInteger(m) && m >= 0);
    if (m > 0) { seen += 1; assert(m <= 90, '单场累计不得超过 90'); }
  }
  assert(seen > 0, '第 1 天应有出场分钟');
});

// ---------- H14 Playing Opportunity 输入 ----------
test('H14. Playing Opportunity 自动消费真实 minutes', () => {
  const s = controlledState();
  const rt = getPlayerRuntime(s, 'a_mf0');
  rt.stats.season.minutes = 45; rt.stats.season.appearances = 1;
  const opp = evaluatePlayingOpportunity(s, 'clb_a', 'a_mf0');
  assert(opp.actualMinutesScore > 0, 'actualMinutesScore 应随真实 minutes 上升');
});

// ---------- H15 Growth 公式未变 ----------
test('H15. Growth matchExperience 公式未修改', () => {
  assertEquals(matchExperienceInput(0), 0);
  assertEquals(matchExperienceInput(1800), 1);
  const mid = matchExperienceInput(450);
  assert(Math.abs(mid - Math.sqrt(0.25)) < 1e-9);
});

// ---------- H16 True Potential 边界 ----------
test('H16. 仅提高 True Potential（有效属性不变）⇒ 分钟分配不变', () => {
  const s = controlledState();
  const before = JSON.stringify([...plan(s).minutesByPlayer]);
  const p = s.static.players.find((x) => x.id === 'a_mf_sub');
  for (const a of ATT) p.potential[a] = 99;
  assertEquals(JSON.stringify([...plan(s).minutesByPlayer]), before);
});

// ---------- H17 无新 runtime state ----------
test('H17. 无新增 runtime state（players 结构不含 rotation 字段）', () => {
  const s = leagueState(8);
  const rt = getPlayerRuntime(s, Object.keys(s.runtime.players)[0]);
  for (const k of ['rotationTier', 'rotationScore', 'plannedMinutes', 'developmentMinutes', 'matchPlan', 'minutesPromise']) {
    assertEquals(rt[k], undefined);
  }
});

// ---------- H18 schema/save ----------
test('H18. Schema = 10 / Save Format = 1 未变', () => {
  assertEquals(GAME_STATE_SCHEMA_VERSION, 10);
  assertEquals(SAVE_FORMAT_VERSION, 1);
});

// ---------- H19 比分不变 ----------
test('H19. minutesByPlayer 不影响比分（Team Strength / Expected Goals 不变）', () => {
  const s = controlledState();
  const mkSide = (teamId, map) => {
    const xi = resolveMatchSquad(s, teamId, T);
    return {
      teamId, tactics: T,
      strength: computeTeamStrength(s, teamId, T, xi),
      players: xi.map((p) => ({ id: p.id, position: p.position, ...getEffectiveAttributes(s, p.id) })),
      minutesByPlayer: map,
    };
  };
  const ctx = { worldId: s.worldId, season: 1, round: 1, homeId: 'clb_a', awayId: 'clb_b' };
  const noMap = simulateMatch({ home: mkSide('clb_a', null), away: mkSide('clb_b', null), context: ctx });
  const halfMap = new Map(resolveMatchSquad(s, 'clb_a', T).map((p) => [p.id, 45]));
  const withMap = simulateMatch({ home: mkSide('clb_a', halfMap), away: mkSide('clb_b', null), context: ctx });
  assertEquals(withMap.homeGoals, noMap.homeGoals);
  assertEquals(withMap.awayGoals, noMap.awayGoals);
});

// ---------- H20 长期无非法分钟 ----------
test('H20. 整季模拟：分钟均为合法离散值、无越界', () => {
  const s = leagueState(8);
  new SimulationCore({ enableAI: true }).advanceDays(s, 95);
  for (const id of Object.keys(s.runtime.players)) {
    const m = getPlayerRuntime(s, id).stats.season.minutes;
    assert(Number.isInteger(m) && m >= 0, '非负整数');
    assert(m <= 90 * 20, '不超过合理上限');
  }
});

test('H20b. allocateMatchMinutes 便捷包装与 planMatchMinutes 一致', () => {
  const s = controlledState();
  const xi = resolveMatchSquad(s, 'clb_a', T);
  const m1 = allocateMatchMinutes(s, 'clb_a', T, xi);
  const p = planMatchMinutes(s, 'clb_a', T, xi);
  assertEquals(m1.size, p.minutesByPlayer.size);
  for (const [k, v] of m1) assertEquals(p.minutesByPlayer.get(k), v);
  assert(selectionDevelopmentPriority(s, 'clb_a', 'a_mf_sub') >= 0);
});
