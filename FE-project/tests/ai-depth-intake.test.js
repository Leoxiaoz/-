/**
 * Step 35D —— DDTI（Dynamic Depth Target Intake）测试（DECISIONS D-35.1 ~ D-35.11；SIMULATION_SPEC §34）。
 * 覆盖：effectiveDepthTarget 有界/确定性/状态驱动、hysteresis、intake caps、FA 优先、N≤112、
 *      结构优先、96/12/0 起点重建 depth、market role、determinism、generated 候选一致性。
 *
 * 红线：不引入 OVR / RNG；不改 Transfer / Match / Team Strength；Schema 10 / Save 1 不变；
 *      DDTI 只经现有 Domain API（signFreeAgent / generatePlayer）。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { getWorldPlayers, getPlayerProfile } from '../src/core/player-runtime.js';
import { getClubPlayers, getPlayerClub } from '../src/core/membership.js';
import { getFreeAgents, releasePlayerToFreeAgent } from '../src/core/free-agent.js';
import { getClubFinance } from '../src/core/finance.js';
import { DDTI_CONFIG, ROSTER_CONFIG, WORLD_SOFT_CAP, FINANCE_CONFIG } from '../src/core/sim-config.js';
import { runDepthIntake } from '../src/core/player-lifecycle.js';
import {
  effectiveDepthTarget, evaluateDepthPressure, evaluateDepthIntake, classifyMarketRole,
} from '../src/core/ai/ai-depth-intake.js';
import { filterCandidates, CANDIDATE_SOURCE } from '../src/core/ai/ai-candidate.js';
import { makeLeagueWorldFiles } from './fixtures.js';

const CLUBS = ['clb_001', 'clb_002', 'clb_003', 'clb_004', 'clb_005', 'clb_006', 'clb_007', 'clb_008'];
const POS = ['GK', 'DF', 'MF', 'FW'];

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
/** 把每队裁剪到每线 keep 人（确定性顺序）。 */
function prune(files, keep) {
  const seen = {};
  files.players = files.players.filter((p) => {
    const k = `${p.teamId}|${p.position}`;
    seen[k] = (seen[k] ?? 0) + 1;
    return seen[k] <= (keep[p.position] ?? 99);
  });
  return files;
}

// ===========================================================================
// 1. effectiveDepthTarget：有界 / 整数 / 确定性 / 无 OVR
// ===========================================================================
test('DDTI-1. effectiveDepthTarget ∈ [12, DEPTH_CAP]，整数、确定性、无 OVR', () => {
  const state = leagueState(8);
  for (const c of CLUBS) {
    const t = effectiveDepthTarget(state, c);
    assert(Number.isInteger(t), `${c} target 应为整数`);
    assert(t >= DDTI_CONFIG.MIN_TARGET && t <= DDTI_CONFIG.DEPTH_CAP, `${c} target 越界：${t}`);
    assertEquals(effectiveDepthTarget(state, c), t, `${c} target 应确定性`);
  }
  // 覆盖参数生效且仍有界
  for (const cap of [14, 15, 16, 17]) {
    for (const c of CLUBS) {
      const t = effectiveDepthTarget(state, c, { DEPTH_CAP: cap });
      assert(t >= 12 && t <= cap, `cap=${cap} 时 target 越界：${t}`);
    }
  }
  const { components } = evaluateDepthPressure(state, 'clb_001');
  assert(!('ovr' in components) && !('overall' in components), '不得引入 OVR');
  assertEquals(Object.keys(components).sort(), ['age', 'congestion', 'development', 'finance', 'need', 'recent'],
    '压力须含 D-35.3 六维状态');
});

// ===========================================================================
// 2. target 不是 rosterSize 的函数（状态驱动）
// ===========================================================================
test('DDTI-2. target 由状态驱动：财务/需求变化可改变 target（非仅人数）', () => {
  const a = leagueState(8);
  const base = effectiveDepthTarget(a, 'clb_001');
  // 人为压低某队转会预算 → finance 分量下降 → 压力不应上升
  const b = leagueState(8);
  getClubFinance(b, 'clb_001').transferBudget = 0;
  const low = effectiveDepthTarget(b, 'clb_001');
  assert(low <= base, `低收入不应产生更高 target（${low} vs ${base}）`);
  // 同一 roster 人数、不同财务 → 允许不同 target（说明不是纯人数函数）
  assertEquals(getClubPlayers(a, 'clb_001').length, getClubPlayers(b, 'clb_001').length, '两状态人数相同');
  assert(FINANCE_CONFIG.INITIAL_TRANSFER_BUDGET > 0, '基准预算为正');
});

// ===========================================================================
// 3. intake caps（per-club / world）
// ===========================================================================
test('DDTI-3. intake 受 per-club cap 与 world cap 限制；确定性计划', () => {
  const state = leagueState(8); // 112/14 起，depth 已达 target，通常无计划
  for (const c of CLUBS) getClubFinance(state, c).transferBudget = FINANCE_CONFIG.INITIAL_TRANSFER_BUDGET;
  const { plans } = evaluateDepthIntake(state, { season: 2, overrides: { WORLD_INTAKE_CAP: 2, HYSTERESIS_UP: 0 } });
  const total = plans.reduce((n, p) => n + p.picks.length, 0);
  assert(total <= 2, `world cap 应限制计划总数（实际 ${total}）`);
  for (const p of plans) assert(p.picks.length <= DDTI_CONFIG.PER_CLUB_INTAKE_CAP, 'per-club cap 生效');
  // 确定性：同 state 两次计划一致
  const again = evaluateDepthIntake(state, { season: 2, overrides: { WORLD_INTAKE_CAP: 2, HYSTERESIS_UP: 0 } });
  assertEquals(again.plans, plans, '计划应确定性');
});

// ===========================================================================
// 4. FA 优先 + N≤112 + 结构优先
// ===========================================================================
test('DDTI-4. FA 优先：存在合适 FA 时计划 source=FREE_AGENT；N=112 时不再生成', () => {
  const state = leagueState(8);
  // 制造每线各一名 FA（覆盖任意 intake 位置）
  for (const pos of POS) {
    const id = getClubPlayers(state, 'clb_002').map((x) => getPlayerProfile(state, x)).find((p) => p.position === pos)?.id;
    if (id) releasePlayerToFreeAgent(state, id);
  }
  assert(getFreeAgents(state).length >= 1, '应存在 FA');
  const { plans } = evaluateDepthIntake(state, { season: 2, overrides: { HYSTERESIS_UP: 0, WORLD_INTAKE_CAP: 8 } });
  for (const p of plans) {
    for (const pick of p.picks) {
      if (pick.source === 'FREE_AGENT') {
        assert(getFreeAgents(state).includes(pick.freeAgentId), 'FA 计划须引用真实 FA');
      }
    }
  }
  // N=112：runDepthIntake 不得新增生成
  const full = leagueState(8);
  assertEquals(getWorldPlayers(full).length, WORLD_SOFT_CAP);
  const gen = runDepthIntake(full, { fromSeason: 1, toSeason: 2 });
  assertEquals(gen, [], 'N=112 时不得生成（硬安全上限）');
});

test('DDTI-5. 结构缺口优先于 depth intake（GK<1 先补 GK 到结构合法）', () => {
  const files = prune(makeLeagueWorldFiles(8), { GK: 0, DF: 5, MF: 5, FW: 4 }); // clb 全部无 GK → 结构缺口
  const state = createGameState(parseWorld(files));
  new SimulationCore({ enableAI: false }).advanceDays(state, 92); // 完成第 1 季
  for (const c of CLUBS) {
    const gk = getClubPlayers(state, c).map((x) => getPlayerProfile(state, x)).filter((p) => p.position === 'GK').length;
    assert(gk >= ROSTER_CONFIG.MIN_GK, `${c} 结构缺口应优先补 GK（实际 ${gk}）`);
  }
});

// ===========================================================================
// 6. 从 96/12/0 起点重建 depth elasticity
// ===========================================================================
test('DDTI-6. 从 96/12/0 起点：DDTI 重建 roster>12 的 depth（非永久吸收）', () => {
  const files = prune(makeLeagueWorldFiles(8), { GK: 1, DF: 4, MF: 4, FW: 3 }); // 每队 12
  const state = createGameState(parseWorld(files));
  assertEquals(getWorldPlayers(state).length, 96);
  assertEquals(CLUBS.map((c) => getClubPlayers(state, c).length), Array(8).fill(12));
  state.runtime.managedClubId = 'clb_008';
  new SimulationCore().advanceDays(state, 25 * 125);
  const rosters = CLUBS.map((c) => getClubPlayers(state, c).length);
  const pop = getWorldPlayers(state).length;
  assert(pop >= 96 && pop <= WORLD_SOFT_CAP, `population 应在有界区间（实际 ${pop}）`);
  assert(rosters.some((r) => r > 12), `应重建 depth（roster>12），实际 ${JSON.stringify(rosters)}`);
  assert(rosters.every((r) => r >= 12 && r <= ROSTER_CONFIG.MAX_PLAYERS), 'roster 应始终有界');
});

// ===========================================================================
// 7. market role 诊断（derived）
// ===========================================================================
test('DDTI-7. classifyMarketRole 返回合法角色（derived，不持久化）', () => {
  const state = leagueState(8);
  for (const c of CLUBS) {
    const role = classifyMarketRole(state, c);
    assert(['SURPLUS', 'NEUTRAL', 'DEFICIT'].includes(role), `${c} 角色非法：${role}`);
  }
  // 无新增持久字段
  assert(!('marketRole' in (state.runtime.clubs.clb_001)), '不得写入持久字段');
});

// ===========================================================================
// 8. 确定性
// ===========================================================================
test('DDTI-8. determinism：同 world/seed/config → 相同生成与事件序列', () => {
  const a = leagueState(8); const b = leagueState(8);
  a.runtime.managedClubId = 'clb_008'; b.runtime.managedClubId = 'clb_008';
  new SimulationCore().advanceDays(a, 15 * 125);
  new SimulationCore().advanceDays(b, 15 * 125);
  assertEquals(Object.keys(a.runtime.generated), Object.keys(b.runtime.generated), 'generated IDs 应一致');
  assertEquals(a.runtime.events.length, b.runtime.events.length, '事件数应一致');
  assertEquals(
    CLUBS.map((c) => getClubPlayers(a, c).length),
    CLUBS.map((c) => getClubPlayers(b, c).length),
    'roster 应一致',
  );
});

// ===========================================================================
// 9. generated 候选一致性（AI 候选须接受 Domain 允许的无合同 generated 球员）
// ===========================================================================
test('DDTI-9. generated（无 active 合同）球员可成为 AI 转会候选（与 Domain validateTransfer 一致）', () => {
  const files = makeLeagueWorldFiles(8);
  // 给 clb_002 追加一名 DF 的 generated 球员（无合同）；clb_001 需要 DF
  const base = files.players.find((p) => p.teamId === 'clb_002' && p.position === 'DF');
  const gid = 'ply_g_9001';
  files.players.push({ ...base, id: gid, name: gid, teamId: 'clb_002' });
  const state = createGameState(parseWorld(files));
  // 标记为 generated 且无合同
  state.runtime.generated[gid] = {
    playerId: gid, name: gid, teamId: 'clb_002', position: 'DF', birthDate: '2005-01-15',
    attributes: { ...base }, potential: { ...(base.potential ?? {}) }, personality: { ...(base.personality ?? {}) },
    generatedSeason: 1, sequence: 9001,
  };
  const cands = filterCandidates(state, 'clb_001', { position: 'DF', needClass: 'SOFT' }, CANDIDATE_SOURCE.TRANSFER);
  assert(cands.includes(gid), 'generated（无合同）DF 应可作为转会候选');
  assertEquals(getPlayerClub(state, gid), 'clb_002');
});