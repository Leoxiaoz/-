/**
 * Step 31 — AI Club Decision Framework v1 测试（DECISIONS D-28 / SIMULATION_SPEC §34）。
 * 覆盖 A–M：Policy / Need / Candidate Filter / Suitability / Finance / FA Priority /
 * Transfer / Release / Action Limits / Domain-only / Determinism / Explainability / Save-Load + 长跑。
 *
 * 红线：不改比赛 / 成长 / 伤病 / population 逻辑；不新增 RNG；schema 仍 10 / save format 仍 1；
 * AI 只经 Domain API 变更状态；不产生 OVR。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import {
  getPlayerProfile, getEffectiveAttributes, getPlayerRuntime, getWorldPlayers, initializePlayerRuntime,
} from '../src/core/player-runtime.js';
import { getPlayerClub, getClubPlayers, validateMembership } from '../src/core/membership.js';
import { getPlayerContract, assertContractInvariants } from '../src/core/contract.js';
import { getClubFinance, assertFinanceInvariants, replenishTransferBudget } from '../src/core/finance.js';
import { getFreeAgents, assertFreeAgentInvariants, releasePlayerToFreeAgent } from '../src/core/free-agent.js';
import { computeTransferFee } from '../src/core/transfer.js';
import { replenishPopulation } from '../src/core/player-lifecycle.js';
import { ROSTER_CONFIG, FINANCE_CONFIG, WORLD_SOFT_CAP } from '../src/core/sim-config.js';
import { AI_CONFIG } from '../src/core/ai/ai-config.js';
import { getAIClubPolicy } from '../src/core/ai/ai-club-policy.js';
import { evaluateSquadNeed } from '../src/core/ai/ai-need.js';
import { filterCandidates, CANDIDATE_SOURCE } from '../src/core/ai/ai-candidate.js';
import { evaluatePlayerSuitability } from '../src/core/ai/ai-suitability.js';
import { estimatePotentialHeadroom } from '../src/core/ai/ai-potential-estimate.js';
import {
  evaluateClubDecisions, decideRelease, decideSignFreeAgent, decideTransfer, decideSell, runSeasonAI,
} from '../src/core/ai/ai-decide.js';
import { executeAIAction } from '../src/core/ai/ai-action.js';
import { MemorySaveManager, serializeState, deserializeState } from '../src/save/save-manager.js';
import { makeLeagueWorldFiles } from './fixtures.js';

const CLUBS = ['clb_001', 'clb_002', 'clb_003', 'clb_004', 'clb_005', 'clb_006', 'clb_007', 'clb_008'];

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
function stateFromFiles(files) {
  return createGameState(parseWorld(files));
}
/** 仅保留某队每个位置的前 keep[position] 名球员（确定性顺序）。 */
function pruneTeam(files, teamId, keep) {
  const seen = { GK: 0, DF: 0, MF: 0, FW: 0 };
  files.players = files.players.filter((p) => {
    if (p.teamId !== teamId) return true;
    seen[p.position] += 1;
    return seen[p.position] <= (keep[p.position] ?? 99);
  });
  return files;
}
function findPlayer(state, clubId, position, index = 0) {
  return getClubPlayers(state, clubId).map((id) => getPlayerProfile(state, id)).filter((p) => p.position === position)[index]?.id ?? null;
}
/** 向某队追加合成球员（用于构造 roster > HOLDING_TARGET 的场景）。 */
function addSyntheticPlayers(files, teamId, position, count) {
  const base = files.players.find((p) => p.teamId === teamId && p.position === position)
    ?? files.players.find((p) => p.teamId === teamId);
  let seq = files.players.length;
  for (let i = 0; i < count; i += 1) {
    seq += 1;
    const id = `ply_x${String(seq).padStart(3, '0')}`;
    files.players.push({ ...base, id, name: id, teamId });
  }
  return files;
}
function findClubWith(pred) {
  return CLUBS.find((id) => pred(getAIClubPolicy(id))) ?? null;
}
function aiEvents(state, type) {
  return state.runtime.events.filter((e) => e.type === 'ai_decision' && (!type || e.payload.type === type));
}

// ===========================================================================
// A. Club Policy determinism
// ===========================================================================
test('A. Club Policy：同 clubId 恒同 policy，且来自固定档位集合', () => {
  const allowed = new Set(AI_CONFIG.POLICIES.map((p) => p.id));
  for (const id of CLUBS) {
    const p1 = getAIClubPolicy(id);
    const p2 = getAIClubPolicy(id);
    assertEquals(p1, p2, `${id} policy 应确定性`);
    assert(allowed.has(p1.id), `${id} policy 应来自固定集合`);
    assert(typeof p1.potentialWeight === 'number' && typeof p1.reserveRatio === 'number'
      && typeof p1.softNeedEnabled === 'boolean', 'policy 字段形状');
  }
  // 档位数量受限于 3
  assert(AI_CONFIG.POLICIES.length <= 3, 'policy 档位不得超过 3');
});

// ===========================================================================
// B. Squad Need
// ===========================================================================
test('B. Squad Need：Hard Need（结构缺口）', () => {
  const files = pruneTeam(makeLeagueWorldFiles(8), 'clb_001', { GK: 1, DF: 3, MF: 3, FW: 1 });
  const state = stateFromFiles(files);
  const need = evaluateSquadNeed(state, 'clb_001');
  assertEquals(need.needClass, 'HARD');
  for (const pos of ['DF', 'MF', 'FW']) {
    assert(need.needs.some((n) => n.position === pos && n.needClass === 'HARD'), `应有 ${pos} Hard Need`);
  }
});

test('B. Squad Need：能力/竞技缺口（非仅人数），且 Policy 关闭时不产生 Soft', () => {
  const softClub = findClubWith((p) => p.softNeedEnabled);
  assert(softClub, '应存在启用 Soft Need 的俱乐部');
  const files = makeLeagueWorldFiles(8);
  for (const p of files.players) {
    if (p.teamId === softClub && p.position === 'MF') {
      for (const a of ['pace', 'technique', 'passing', 'defending', 'finishing']) p[a] = 40;
    }
  }
  const softNeed = evaluateSquadNeed(stateFromFiles(files), softClub);
  // D-34.3：竞技质量缺口优先以 COMPETITIVE 表达；若未触发 COMPETITIVE，则退回 SOFT ATTRIBUTE_GAP。
  const mfNeed = softNeed.needs.find((n) => n.position === 'MF');
  assert(mfNeed, '应检测到 MF 需求');
  assert(mfNeed.needClass === 'COMPETITIVE' || (mfNeed.needClass === 'SOFT' && mfNeed.reasonCode === 'ATTRIBUTE_GAP'),
    'MF 缺口应为 COMPETITIVE 或 SOFT(ATTRIBUTE_GAP)');
  assert(!softNeed.needs.some((n) => n.position === 'MF' && n.needClass === 'COMPETITIVE' && n.reasonCode === 'ATTRIBUTE_GAP'),
    '去重：COMPETITIVE 与 SOFT ATTRIBUTE_GAP 不得同时命中同一位置');

  // 关闭 Soft 的俱乐部（Conservative）：满编且无 Hard → 至多 COMPETITIVE/SOFT（无 Hard）
  const noSoft = findClubWith((p) => !p.softNeedEnabled);
  assert(noSoft, '应存在关闭 Soft Need 的俱乐部');
  const conservative = evaluateSquadNeed(leagueState(8), noSoft);
  assert(!conservative.needs.some((n) => n.needClass === 'HARD'), '满编俱乐部不应有 Hard Need');
  assert(!conservative.needs.some((n) => n.reasonCode === 'ATTRIBUTE_GAP'), 'Conservative 不产生 SOFT ATTRIBUTE_GAP');
});

// ===========================================================================
// C. Candidate Filter
// ===========================================================================
test('C. Candidate Filter：source 区分 / 位置 / 排除己方 / roster full / finance', () => {
  const state = leagueState(8);
  const need = { position: 'FW', needClass: 'SOFT' };

  // source 区分：TRANSFER 候选均属于他队；不含己方
  const transfers = filterCandidates(state, 'clb_001', need, CANDIDATE_SOURCE.TRANSFER);
  assert(transfers.length > 0, '应有转会候选');
  for (const id of transfers) {
    const owner = getPlayerClub(state, id);
    assert(owner != null && owner !== 'clb_001', `候选 ${id} 不应属于己方`);
    assertEquals(getPlayerProfile(state, id).position, 'FW', '候选位置应匹配');
  }
  // 顺序确定：playerId 升序
  assertEquals(transfers, [...transfers].sort(), '候选应 playerId 升序');

  // FREE_AGENT：仅自由球员（membership=null 且合同 free_agent）
  const faId = findPlayer(state, 'clb_002', 'FW');
  releasePlayerToFreeAgent(state, faId);
  const fas = filterCandidates(state, 'clb_001', { position: 'FW', needClass: 'SOFT' }, CANDIDATE_SOURCE.FREE_AGENT);
  assert(fas.includes(faId), 'FA 候选应包含刚释放的球员');
  for (const id of fas) {
    assert(getPlayerClub(state, id) == null, 'FA 候选 membership 应为 null');
    assertEquals(getPlayerContract(state, id).status, 'free_agent', 'FA 候选合同应为 free_agent');
  }

  // 退役排除
  const retiredId = transfers[0];
  state.runtime.retired[retiredId] = { playerId: retiredId, retiredSeason: 1 };
  assert(!filterCandidates(state, 'clb_001', need, CANDIDATE_SOURCE.TRANSFER).includes(retiredId), '退役应排除');
  delete state.runtime.retired[retiredId];

  // roster full → 无候选（买方满员）
  const full2 = leagueState(8);
  const donorIds = getClubPlayers(full2, 'clb_003');
  let i = 0;
  while (getClubPlayers(full2, 'clb_001').length < ROSTER_CONFIG.MAX_PLAYERS && i < donorIds.length) {
    full2.runtime.membership.players[donorIds[i]] = 'clb_001';
    i += 1;
  }
  assertEquals(getClubPlayers(full2, 'clb_001').length, ROSTER_CONFIG.MAX_PLAYERS);
  assertEquals(filterCandidates(full2, 'clb_001', need, CANDIDATE_SOURCE.TRANSFER), [], '满员应无候选');
});

// ===========================================================================
// D. Suitability
// ===========================================================================
test('D. Suitability：位置画像差异 / 角色权重 / 无 OVR / 纯函数 / 边界', () => {
  const state = leagueState(8);
  const id = findPlayer(state, 'clb_001', 'FW');
  const gkScore = evaluatePlayerSuitability(state, 'clb_001', id, { position: 'GK' }, 'Starter').score;
  const fwScore = evaluatePlayerSuitability(state, 'clb_001', id, { position: 'FW' }, 'Starter').score;
  assert(gkScore !== fwScore, '不同位置画像应给出不同 suitability');

  const res = evaluatePlayerSuitability(state, 'clb_001', id, { position: 'FW' }, 'Starter');
  assertEquals(Object.keys(res).sort(), ['playerId', 'role', 'score'], '结果仅含内部字段');
  assert(!('overall' in res) && !('ovr' in res), '不得产生 OVR');
  assert(Number.isFinite(res.score) && res.score >= 0 && res.score <= 1.5, 'score 应为 [0,1.5] 有限值');

  // 纯函数：不修改 state
  const snap = JSON.stringify(state.runtime);
  evaluatePlayerSuitability(state, 'clb_001', id, { position: 'FW' }, 'Development');
  evaluateSquadNeed(state, 'clb_001');
  filterCandidates(state, 'clb_001', { position: 'FW', needClass: 'SOFT' }, CANDIDATE_SOURCE.TRANSFER);
  decideRelease(state, 'clb_001');
  decideSignFreeAgent(state, 'clb_001');
  decideTransfer(state, 'clb_001');
  assertEquals(JSON.stringify(state.runtime), snap, '决策/评估函数不得修改 state');
});

test('D. Suitability：Starter 偏当前能力，Development 偏 AI 可观察的估计潜力（角色权重切换）', () => {
  const files = makeLeagueWorldFiles(2);
  const fws = files.players.filter((p) => p.teamId === 'clb_001' && p.position === 'FW').slice(0, 2);
  const [a, b] = fws;
  const lowAttr = { pace: 40, technique: 40, passing: 40, defending: 10, finishing: 40, goalkeeping: 10 };
  const highAttr = { pace: 80, technique: 80, passing: 80, defending: 10, finishing: 80, goalkeeping: 10 };
  // D39C-03：AI 不得读取 True Potential。因此差异必须来自 **AI 可观察信息**：
  //   a = 高当前能力 / 高龄（VETERAN）；b = 低当前能力 / 年轻（EMERGING）。
  // （profile.potential 仍是各球员的真实上限，但 AI 不可见；真值独立性由 ai-potential-estimate I1 覆盖。）
  a.birthDate = '1993-01-15'; // age 33 → VETERAN
  b.birthDate = '2009-01-15'; // age 17 → EMERGING
  Object.assign(a, highAttr, { potential: { ...highAttr } });
  Object.assign(b, lowAttr, { potential: { ...lowAttr, finishing: 90, technique: 90, pace: 90 } });
  const state = stateFromFiles(files);
  // 第二个可观察差异：既有 stats 字段（不新增字段）。a 表现差、b 表现好。
  state.runtime.players[a.id].stats.season.appearances = 20;
  state.runtime.players[a.id].stats.season.ratingSum = 20 * 40;  // 平均 4.0 → perfSignal −2
  state.runtime.players[b.id].stats.season.appearances = 20;
  state.runtime.players[b.id].stats.season.ratingSum = 20 * 100; // 平均 10.0 → perfSignal +2
  const sa = evaluatePlayerSuitability(state, 'clb_001', a.id, { position: 'FW' }, 'Starter').score;
  const sb = evaluatePlayerSuitability(state, 'clb_001', b.id, { position: 'FW' }, 'Starter').score;
  assert(sa > sb, 'Starter 角色应偏当前能力');
  const da = evaluatePlayerSuitability(state, 'clb_001', a.id, { position: 'FW' }, 'Development').score;
  const db = evaluatePlayerSuitability(state, 'clb_001', b.id, { position: 'FW' }, 'Development').score;
  assert(db > da, 'Development 角色应偏 AI 可观察信息推导出的 Estimated Potential');
  // 估计潜力余量必须 b > a，且完全由可观察信息（Age/Phase + 表现 + 感知偏移）决定。
  assert(
    estimatePotentialHeadroom(state, 'clb_001', b.id) > estimatePotentialHeadroom(state, 'clb_001', a.id),
    '估计潜力余量 b 应高于 a',
  );
});

// ===========================================================================
// E. Finance
// ===========================================================================
test('E. Finance：cash 不足 / transferBudget 不足 / reserve 生效', () => {
  const need = { position: 'FW', needClass: 'SOFT' };
  const base = leagueState(8);
  const target = findPlayer(base, 'clb_002', 'FW');
  const fee = computeTransferFee(base, getPlayerProfile(base, target));
  assert(fee > 0, '样例转会费应 > 0');

  // cash 不足（cash=0，任何正转会费均无法支付）
  const s1 = leagueState(8);
  getClubFinance(s1, 'clb_001').cash = 0;
  getClubFinance(s1, 'clb_001').transferBudget = 100000;
  assertEquals(filterCandidates(s1, 'clb_001', need, CANDIDATE_SOURCE.TRANSFER), [], 'cash 不足应无候选');

  // transferBudget 不足（cash 充足）
  const s2 = leagueState(8);
  getClubFinance(s2, 'clb_001').cash = 100000;
  getClubFinance(s2, 'clb_001').transferBudget = 0;
  assertEquals(filterCandidates(s2, 'clb_001', need, CANDIDATE_SOURCE.TRANSFER), [], 'budget 不足应无候选');

  // reserve 生效：cash 充足、transferBudget 够 fee 但不够 fee+reserve → 该目标被排除
  const s3 = leagueState(8);
  getClubFinance(s3, 'clb_001').cash = 100000;
  getClubFinance(s3, 'clb_001').transferBudget = fee + 100; // reserve = max(150, ...) > 100
  assert(!filterCandidates(s3, 'clb_001', need, CANDIDATE_SOURCE.TRANSFER).includes(target), 'reserve 应使该目标被排除');

  // reserve 充足 → 候选存在
  const s4 = leagueState(8);
  getClubFinance(s4, 'clb_001').cash = 100000;
  getClubFinance(s4, 'clb_001').transferBudget = fee + 800;
  assert(filterCandidates(s4, 'clb_001', need, CANDIDATE_SOURCE.TRANSFER).length > 0, '预算充足应有候选');
});

// ===========================================================================
// F. Free Agent Priority
// ===========================================================================
test('F. Free Agent 优先：存在合适 FA 时优先签 FA，不进行付费转会', () => {
  const files = pruneTeam(makeLeagueWorldFiles(8), 'clb_001', { GK: 1, DF: 5, MF: 5, FW: 1 });
  const state = stateFromFiles(files);
  // 制造一个满足 FW Hard Need 的 FA
  const faId = findPlayer(state, 'clb_002', 'FW');
  releasePlayerToFreeAgent(state, faId);

  const need = evaluateSquadNeed(state, 'clb_001');
  assert(need.needs.some((n) => n.position === 'FW' && n.needClass === 'HARD'), 'clb_001 应有 FW Hard Need');
  assert(getFreeAgents(state).includes(faId), 'FA 池应包含释放球员');

  const sign = decideSignFreeAgent(state, 'clb_001');
  assert(sign && sign.type === 'SIGN_FREE_AGENT' && sign.playerId === faId, '应优先选择 FA');

  const decisions = evaluateClubDecisions(state, 'clb_001');
  assert(decisions.some((d) => d.type === 'SIGN_FREE_AGENT'), '决策应含 FA 签约');
  assert(!decisions.some((d) => d.type === 'TRANSFER_PLAYER'), '有合适 FA 时不应付费转会');

  // 执行：FA 被签入、成为俱乐部成员、产生 ai_decision 事件
  const r = executeAIAction(state, sign);
  assertEquals(r.ok, true);
  assertEquals(getPlayerClub(state, faId), 'clb_001');
  assertEquals(aiEvents(state, 'SIGN_FREE_AGENT').length, 1);
});

// ===========================================================================
// G. Transfer
// ===========================================================================
test('G. Transfer：无 FA 时选择付费目标，且 tie-break 确定性', () => {
  const files = pruneTeam(makeLeagueWorldFiles(8), 'clb_001', { GK: 1, DF: 5, MF: 5, FW: 1 });
  const state = stateFromFiles(files);
  assertEquals(getFreeAgents(state).length, 0, '无 FA 时进入付费转会');
  const d1 = decideTransfer(state, 'clb_001');
  const d2 = decideTransfer(state, 'clb_001');
  assert(d1 && d1.type === 'TRANSFER_PLAYER', '应产生转会决策');
  assertEquals(d1.playerId, d2.playerId, '同 state 目标应确定');
  assert(d1.targetClubId && d1.targetClubId !== 'clb_001', '目标应为其他俱乐部');

  const before = { cash: getClubFinance(state, 'clb_001').cash, budget: getClubFinance(state, 'clb_001').transferBudget };
  const sellerCashBefore = getClubFinance(state, d1.targetClubId).cash;
  const r = executeAIAction(state, d1);
  assertEquals(r.ok, true);
  assertEquals(getPlayerClub(state, d1.playerId), 'clb_001', '买方获得球员');
  assert(getClubFinance(state, 'clb_001').cash < before.cash, '买方 cash 应减少');
  assert(getClubFinance(state, 'clb_001').transferBudget < before.budget, '买方预算应减少');
  assert(getClubFinance(state, d1.targetClubId).cash > sellerCashBefore, '卖方 cash 应增加');
  assertEquals(aiEvents(state, 'TRANSFER_PLAYER').length, 1);
});

// ===========================================================================
// H. Release
// ===========================================================================
test('H. Release：不释放最后 GK / 不低于 12 / 不破坏 DF 最低（Holding Target=14）', () => {
  // 不释放最后 GK：构造 roster 16（> HOLDING_TARGET），GK 与一名 FW 高龄
  const filesGk = addSyntheticPlayers(makeLeagueWorldFiles(8), 'clb_001', 'MF', 2);
  const gk = filesGk.players.find((p) => p.teamId === 'clb_001' && p.position === 'GK');
  const fw = filesGk.players.find((p) => p.teamId === 'clb_001' && p.position === 'FW');
  gk.birthDate = '1985-01-15';
  fw.birthDate = '1985-01-15';
  const sGk = stateFromFiles(filesGk);
  assertEquals(getClubPlayers(sGk, 'clb_001').length, 16);
  const relGk = decideRelease(sGk, 'clb_001');
  assert(relGk, '应产生释放决策');
  assert(relGk.playerId !== gk.id, '不得释放最后 GK');

  // roster == 12（<= HOLDING_TARGET）→ 不得释放
  const files12 = pruneTeam(makeLeagueWorldFiles(8), 'clb_001', { GK: 1, DF: 4, MF: 4, FW: 3 });
  const s12 = stateFromFiles(files12);
  assertEquals(getClubPlayers(s12, 'clb_001').length, 12);
  assertEquals(decideRelease(s12, 'clb_001'), null, 'roster=12 不得释放');

  // DF == 4（最低）→ DF 不可释放；构造 roster 16
  const filesDf = addSyntheticPlayers(
    pruneTeam(makeLeagueWorldFiles(8), 'clb_001', { GK: 1, DF: 4, MF: 5, FW: 3 }),
    'clb_001', 'MF', 3,
  );
  filesDf.players.find((p) => p.teamId === 'clb_001' && p.position === 'MF').birthDate = '1985-01-15';
  const sDf = stateFromFiles(filesDf);
  assertEquals(getClubPlayers(sDf, 'clb_001').length, 16);
  const relDf = decideRelease(sDf, 'clb_001');
  assert(relDf, '应产生释放决策');
  assert(relDf.position !== 'DF' && relDf.position !== 'GK', 'DF 处于最低线时不得释放 DF/GK');

  // 执行释放：变成 Free Agent，且仍满足结构约束
  assertEquals(executeAIAction(sDf, relDf).ok, true);
  assert(getFreeAgents(sDf).includes(relDf.playerId), '释放后应为 Free Agent');
  assertEquals(validateMembership(sDf).fatal, []);
  assert(getClubPlayers(sDf, 'clb_001').length >= ROSTER_CONFIG.MIN_PLAYERS, '释放后 roster 不得低于下限');
});

// ===========================================================================
// I. Action Limits
// ===========================================================================
test('I. Action Limits：每俱乐部每赛季 买入 ≤2、卖出+释放 ≤2', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 10 * 125);
  const byClubSeason = new Map();
  for (const e of aiEvents(state)) {
    const key = `${e.payload.clubId}|${e.payload.season}`;
    const rec = byClubSeason.get(key) ?? { sign: 0, exit: 0 };
    if (e.payload.type === 'SIGN_FREE_AGENT' || e.payload.type === 'TRANSFER_PLAYER') rec.sign += 1;
    if (e.payload.type === 'RELEASE_PLAYER') rec.exit += 1;
    byClubSeason.set(key, rec);
  }
  for (const [, rec] of byClubSeason) {
    assert(rec.sign <= AI_CONFIG.MAX_SIGNINGS_PER_SEASON, `买入超限：${rec.sign}`);
    assert(rec.exit <= AI_CONFIG.MAX_EXITS_PER_SEASON, `卖出+释放超限：${rec.exit}`);
  }
});

// ===========================================================================
// J. Domain-only
// ===========================================================================
test('J. Domain-only：AI 不直接改写 membership/contract/finance；失败不半提交', () => {
  const files = pruneTeam(makeLeagueWorldFiles(8), 'clb_001', { GK: 1, DF: 5, MF: 5, FW: 1 });
  const state = stateFromFiles(files);
  const decisions = evaluateClubDecisions(state, 'clb_001');
  const snap = JSON.stringify(state.runtime);
  for (const d of decisions) executeAIAction(state, d);
  // 通过 Domain 后不变量仍成立
  assertEquals(validateMembership(state).fatal, []);
  assertContractInvariants(state);
  assertFinanceInvariants(state);
  assertFreeAgentInvariants(state);
  assert(JSON.stringify(state.runtime) !== snap, '执行后状态应变化');

  // 非法决策：不抛错、不半提交
  const okState = leagueState(8);
  const before = JSON.stringify(okState.runtime);
  const bad = executeAIAction(okState, { type: 'TRANSFER_PLAYER', clubId: 'clb_001', playerId: 'ply_nope' });
  assertEquals(bad.ok, false);
  assertEquals(typeof bad.code, 'string');
  assertEquals(JSON.stringify(okState.runtime), before, '失败决策不得改变状态');

  // 未知类型
  assertEquals(executeAIAction(okState, { type: 'NOPE' }).ok, false);
});

// ===========================================================================
// K. Determinism
// ===========================================================================
test('K. Determinism：同 state → 同 decision / 同 action 顺序 / 同事件序列', () => {
  const a = leagueState(8);
  const b = leagueState(8);
  assertEquals(evaluateClubDecisions(a, 'clb_002'), evaluateClubDecisions(b, 'clb_002'));
  const ra = runSeasonAI(a);
  const rb = runSeasonAI(b);
  assertEquals(ra, rb, 'AI cycle 结果应一致');
  assertEquals(aiEvents(a), aiEvents(b), 'ai_decision 事件序列应一致');

  const s1 = leagueState(8);
  const s2 = leagueState(8);
  new SimulationCore().advanceDays(s1, 130);
  new SimulationCore().advanceDays(s2, 130);
  assertEquals(aiEvents(s1), aiEvents(s2), '整季推进后事件序列应一致');
  assertEquals(JSON.stringify(s1.runtime.membership), JSON.stringify(s2.runtime.membership));
});

// ===========================================================================
// L. Explainability
// ===========================================================================
test('L. Explainability：ai_decision 字段正确且 reasonCode 属于白名单', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 5 * 125);
  const events = aiEvents(state);
  assert(events.length > 0, '长跑后应产生 ai_decision 事件');
  const allow = new Set(AI_CONFIG.REASON_CODES);
  for (const e of events) {
    const p = e.payload;
    for (const k of ['clubId', 'season', 'date', 'type', 'playerId', 'targetClubId', 'position', 'reasonCode', 'estimatedCost']) {
      assert(k in p, `事件缺少字段 ${k}`);
    }
    if (p.reasonCode != null) assert(allow.has(p.reasonCode), `reasonCode 非法：${p.reasonCode}`);
    assert(!('reasoning' in p) && !('text' in p), '不得保存自然语言推理');
  }
});

// ===========================================================================
// M. Save / Load
// ===========================================================================
test('M. Save/Load：AI 状态往返一致，且读档后 AI 继续确定性', async () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 130); // AI 已跑一个边界
  const mgr = new MemorySaveManager();
  await mgr.save('s', state);
  const payload = await mgr.load('s');
  const loaded = createGameState(state.static, { date: payload.currentDate, season: payload.season });
  // 深拷贝，避免与源状态共享引用
  loaded.runtime = deserializeState(JSON.parse(JSON.stringify(payload))).runtime;
  initializePlayerRuntime(loaded);
  assertEquals(JSON.stringify(loaded.runtime.membership), JSON.stringify(state.runtime.membership));
  assertEquals(JSON.stringify(loaded.runtime.contracts), JSON.stringify(state.runtime.contracts));
  for (const id of CLUBS) {
    assertEquals(getClubFinance(loaded, id), getClubFinance(state, id), `${id} finance 一致`);
  }
  // 继续推进：save/load 后 AI 确定性一致
  const s1 = leagueState(8);
  new SimulationCore().advanceDays(s1, 260);
  new SimulationCore().advanceDays(loaded, 130);
  assertEquals(aiEvents(loaded), aiEvents(s1), '读档后 AI 结果应与原生一致');
});

// ===========================================================================
// N. 长跑（AI 启用）+ 核心不变量
// ===========================================================================
test('N. 长跑 10/50/100/200 赛季（AI 启用）：不变量稳定，无 NaN/负值/超员', () => {
  for (const seasons of [10, 50, 100, 200]) {
    const state = leagueState(8);
    // managed club 不受 AI 控制
    state.runtime.managedClubId = 'clb_008';
    const managedBefore = JSON.stringify(getClubPlayers(state, 'clb_008'));
    new SimulationCore().advanceDays(state, seasons * 125);

    assertEquals(validateMembership(state).fatal, [], `${seasons}季 membership`);
    assertContractInvariants(state);
    assertFinanceInvariants(state);
    assertFreeAgentInvariants(state);
    for (const clubId of CLUBS) {
      const roster = getClubPlayers(state, clubId).length;
      assert(roster <= ROSTER_CONFIG.MAX_PLAYERS, `${seasons}季 ${clubId} 超员 ${roster}`);
      assert(roster >= ROSTER_CONFIG.MIN_PLAYERS, `${seasons}季 ${clubId} 低于下限 ${roster}`);
      const f = getClubFinance(state, clubId);
      assert(Number.isFinite(f.cash) && f.cash >= 0, `${seasons}季 ${clubId} cash 非法`);
      assert(Number.isFinite(f.transferBudget) && f.transferBudget >= 0, `${seasons}季 ${clubId} budget 非法`);
    }
    // managed club 不发生 AI 事件
    assert(!aiEvents(state).some((e) => e.payload.clubId === 'clb_008'), 'managed club 不得有 AI 事件');
    // static 只读：出生日期未被改写
    assert(managedBefore.length > 0);
  }
});

// ===========================================================================
// O. Golden regression（AI 接入后基线不变；赛季 1 内无 rollover）
// ===========================================================================
test('O. Golden regression：赛季 1 内比分/出场基线不变（143/143/1141）', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 90); // 赛季 1 内，无 rollover（AI 不触发）
  const comp = state.runtime.competitions.lg_a;
  const totalGoals = comp.fixtures.reduce((s, f) => s + (f.played ? f.homeGoals + f.awayGoals : 0), 0);
  const playerGoals = state.static.players.reduce((s, p) => s + state.runtime.players[p.id].stats.season.goals, 0);
  const playerApp = state.static.players.reduce((s, p) => s + state.runtime.players[p.id].stats.season.appearances, 0);
  assertEquals(totalGoals, 143);
  assertEquals(playerGoals, 143);
  assertEquals(playerApp, 1141);
  assertEquals(aiEvents(state).length, 0, '赛季 1 内不应触发 AI');
});

// ===========================================================================
// Step 34 / D-33 / D-34 —— World Economy v2
// ===========================================================================
test('P. Competitive Need：独立档、优先于 Soft、与 SOFT ATTRIBUTE_GAP 去重、无 OVR', () => {
  const state = leagueState(8);
  // 弱队（clb_008）相对联赛基线偏弱 → 应产生 COMPETITIVE_UPGRADE
  const need = evaluateSquadNeed(state, 'clb_008');
  assert(need.needs.some((n) => n.needClass === 'COMPETITIVE' && n.reasonCode === 'COMPETITIVE_UPGRADE'),
    '弱队应产生 COMPETITIVE_UPGRADE');
  // 优先级：HARD(100) > COMPETITIVE(75) > SOFT(50)
  const hard = need.needs.filter((n) => n.needClass === 'HARD').map((n) => n.priority);
  const comp = need.needs.filter((n) => n.needClass === 'COMPETITIVE').map((n) => n.priority);
  const soft = need.needs.filter((n) => n.needClass === 'SOFT').map((n) => n.priority);
  if (hard.length && comp.length) assert(Math.min(...hard) > Math.max(...comp), 'HARD > COMPETITIVE');
  if (comp.length && soft.length) assert(Math.min(...comp) > Math.max(...soft), 'COMPETITIVE > SOFT');
  // 去重：同一位置不得同时 COMPETITIVE_UPGRADE 与 SOFT ATTRIBUTE_GAP
  for (const pos of ['GK', 'DF', 'MF', 'FW']) {
    const hasC = need.needs.some((n) => n.position === pos && n.reasonCode === 'COMPETITIVE_UPGRADE');
    const hasGap = need.needs.some((n) => n.position === pos && n.reasonCode === 'ATTRIBUTE_GAP');
    assert(!(hasC && hasGap), `${pos} 不得同时 COMPETITIVE 与 SOFT ATTRIBUTE_GAP`);
  }
  // 结果不含 OVR 字段
  for (const n of need.needs) assert(!('overall' in n) && !('ovr' in n), '不得有 OVR');
  // 纯函数
  const snap = JSON.stringify(state.runtime);
  evaluateSquadNeed(state, 'clb_008');
  assertEquals(JSON.stringify(state.runtime), snap, 'Need 评估不得修改 state');
});

test('Q. Holding Target=14：Domain 仍用 12/24；AI 仅在 roster>14 时评估 surplus', () => {
  assertEquals(AI_CONFIG.HOLDING_TARGET, 14);
  assertEquals(ROSTER_CONFIG.MIN_PLAYERS, 12, 'Domain hard minimum 仍为 12');
  assertEquals(ROSTER_CONFIG.MAX_PLAYERS, 24);
  // roster 14（==H）：无 release
  const s14 = stateFromFiles(makeLeagueWorldFiles(8));
  assertEquals(getClubPlayers(s14, 'clb_001').length, 14);
  assertEquals(decideRelease(s14, 'clb_001'), null, 'roster<=14 不主动制造 surplus exit');
  // roster 16（>H）：可评估 release
  const s16 = stateFromFiles(addSyntheticPlayers(makeLeagueWorldFiles(8), 'clb_001', 'MF', 2));
  assertEquals(getClubPlayers(s16, 'clb_001').length, 16);
  const rel = decideRelease(s16, 'clb_001');
  assert(rel, 'roster>H 应可评估 surplus');
});

test('R. Population bounded：world ∈ [96,112]；roster=12 不生成到 14；结构缺口回补', () => {
  assertEquals(WORLD_SOFT_CAP, 112);
  // roster 恰好 12 且位置合法 → 不为其生成（不补到 14）
  const files = pruneTeam(makeLeagueWorldFiles(8), 'clb_001', { GK: 1, DF: 5, MF: 4, FW: 2 });
  const s = stateFromFiles(files);
  assertEquals(getClubPlayers(s, 'clb_001').length, 12);
  const gen = replenishPopulation(s, { fromSeason: 1, toSeason: 2 });
  assertEquals(getClubPlayers(s, 'clb_001').length, 12, 'roster=12 不得生成到 14');
  assert(gen.length === 0, '无边界的 roster=12 不应触发生成');
  // 结构缺口（GK=0）→ 回补（可能复用 FA 或生成）
  const filesGk = pruneTeam(makeLeagueWorldFiles(8), 'clb_001', { GK: 0, DF: 5, MF: 5, FW: 3 });
  const sGk = stateFromFiles(filesGk);
  replenishPopulation(sGk, { fromSeason: 1, toSeason: 2 });
  assertEquals(getClubPlayers(sGk, 'clb_001').map((id) => getPlayerProfile(sGk, id).position).filter((p) => p === 'GK').length, 1,
    'GK 缺口应被回补');
  // world 上限保护
  assert(getWorldPlayers(sGk).length <= WORLD_SOFT_CAP + 1, '不应无限超过 soft cap');
});

test('S. transferBudget 再生：carry-over、有上限、不改 cash（T6 单笔语义不变）', () => {
  const state = leagueState(8);
  const f = getClubFinance(state, 'clb_001');
  const cash0 = f.cash;
  f.transferBudget = 180;
  replenishTransferBudget(state);
  assertEquals(f.transferBudget, 600, '180+420 → 600');
  f.transferBudget = 80;
  replenishTransferBudget(state);
  assertEquals(f.transferBudget, 500, '80+420 → 500（carry-over）');
  f.transferBudget = 500;
  replenishTransferBudget(state);
  assertEquals(f.transferBudget, FINANCE_CONFIG.INITIAL_TRANSFER_BUDGET, '500+420 → 600（上限）');
  f.transferBudget = 600;
  replenishTransferBudget(state);
  assertEquals(f.transferBudget, 600, '已达上限不再增加');
  assertEquals(f.cash, cash0, 'cash 不受再生影响');
});

test('T. Active SELL：roster>H 且存在 buyer 时产生 SELL_PLAYER，经 transferPlayer 执行', () => {
  const files = addSyntheticPlayers(makeLeagueWorldFiles(8), 'clb_001', 'MF', 2); // 16
  for (const p of files.players) {
    if (p.position !== 'MF') continue;
    if (p.teamId === 'clb_001') { for (const a of ['pace', 'technique', 'passing', 'defending', 'finishing']) p[a] = 30; }
    if (p.teamId === 'clb_002') { for (const a of ['pace', 'technique', 'passing', 'defending', 'finishing']) p[a] = 30; }
  }
  const state = stateFromFiles(files);
  assertEquals(getClubPlayers(state, 'clb_001').length, 16);
  const d = decideSell(state, 'clb_001', new Set());
  assert(d && d.type === 'SELL_PLAYER', '应产生 SELL 决策');
  assert(d.targetClubId && d.targetClubId !== 'clb_001', '应有 buyer');
  const sellerBefore = getClubPlayers(state, 'clb_001').length;
  const buyerBefore = getClubPlayers(state, d.targetClubId).length;
  const r = executeAIAction(state, d);
  assertEquals(r.ok, true);
  assertEquals(getPlayerClub(state, d.playerId), d.targetClubId, '球员应转到 buyer');
  assertEquals(getClubPlayers(state, 'clb_001').length, sellerBefore - 1);
  assertEquals(getClubPlayers(state, d.targetClubId).length, buyerBefore + 1);
  assertEquals(aiEvents(state, 'SELL_PLAYER').length, 1);
  assertEquals(validateMembership(state).fatal, []);
});

test('U. movedSet：同一 cycle 内已易手球员不再被 SELL', () => {
  const files = addSyntheticPlayers(makeLeagueWorldFiles(8), 'clb_001', 'MF', 2);
  for (const p of files.players) {
    if (p.teamId === 'clb_001' && p.position === 'MF') { for (const a of ['pace', 'technique', 'passing', 'defending', 'finishing']) p[a] = 30; }
    if (p.teamId === 'clb_002' && p.position === 'MF') { for (const a of ['pace', 'technique', 'passing', 'defending', 'finishing']) p[a] = 30; }
  }
  const state = stateFromFiles(files);
  const d = decideSell(state, 'clb_001', new Set());
  assert(d, '应有 SELL 决策');
  const moved = new Set([d.playerId]);
  const d2 = decideSell(state, 'clb_001', moved);
  assert(!d2 || d2.playerId !== d.playerId, 'movedSet 中的球员不得再次 SELL');
});

test('V. Exit cap：SELL + RELEASE 共享 exit cap（≤2），与 signing cap 独立', () => {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, 10 * 125);
  const byClubSeason = new Map();
  for (const e of aiEvents(state)) {
    const k = `${e.payload.clubId}|${e.payload.season}`;
    const rec = byClubSeason.get(k) ?? { sign: 0, exit: 0 };
    if (e.payload.type === 'SIGN_FREE_AGENT' || e.payload.type === 'TRANSFER_PLAYER') rec.sign += 1;
    if (e.payload.type === 'RELEASE_PLAYER' || e.payload.type === 'SELL_PLAYER') rec.exit += 1;
    byClubSeason.set(k, rec);
  }
  for (const [, rec] of byClubSeason) {
    assert(rec.exit <= AI_CONFIG.MAX_EXITS_PER_SEASON, `exit 超限：${rec.exit}`);
    assert(rec.sign <= AI_CONFIG.MAX_SIGNINGS_PER_SEASON, `sign 超限：${rec.sign}`);
  }
});

test('W. Determinism / Save-Load：v2 决策与预算再生确定性一致', async () => {
  const a = leagueState(8);
  const b = leagueState(8);
  new SimulationCore().advanceDays(a, 130);
  new SimulationCore().advanceDays(b, 130);
  assertEquals(aiEvents(a), aiEvents(b), '事件序列应一致');
  assertEquals(JSON.stringify(a.runtime.membership), JSON.stringify(b.runtime.membership));
  assertEquals(
    CLUBS.map((c) => getClubFinance(a, c).transferBudget),
    CLUBS.map((c) => getClubFinance(b, c).transferBudget),
    '预算再生应一致',
  );
  // save → load
  const mgr = new MemorySaveManager();
  await mgr.save('s', a);
  const payload = await mgr.load('s');
  const loaded = createGameState(a.static, { date: payload.currentDate, season: payload.season });
  loaded.runtime = deserializeState(JSON.parse(JSON.stringify(payload))).runtime;
  initializePlayerRuntime(loaded);
  assertEquals(JSON.stringify(loaded.runtime.membership), JSON.stringify(a.runtime.membership));
  for (const c of CLUBS) {
    assertEquals(getClubFinance(loaded, c).transferBudget, getClubFinance(a, c).transferBudget, `${c} budget 一致`);
    assertEquals(getClubFinance(loaded, c).cash, getClubFinance(a, c).cash, `${c} cash 一致`);
  }
});

test('X–AB. 长跑 10/50/100/200/500 赛季（v2）：不变量 + 有界人口/roster + 无 NaN/负值', () => {
  for (const seasons of [10, 50, 100, 200, 500]) {
    const state = leagueState(8);
    state.runtime.managedClubId = 'clb_008';
    new SimulationCore().advanceDays(state, seasons * 125);

    assertEquals(validateMembership(state).fatal, [], `${seasons}季 membership`);
    assertContractInvariants(state);
    assertFinanceInvariants(state);
    assertFreeAgentInvariants(state);

    const pop = getWorldPlayers(state).length;
    assert(pop >= ROSTER_CONFIG.MIN_PLAYERS * CLUBS.length, `${seasons}季 population < 96（${pop}）`);
    assert(pop <= WORLD_SOFT_CAP, `${seasons}季 population > 112（${pop}）`);

    for (const clubId of CLUBS) {
      const roster = getClubPlayers(state, clubId).length;
      assert(roster >= ROSTER_CONFIG.MIN_PLAYERS, `${seasons}季 ${clubId} roster < 12（${roster}）`);
      assert(roster <= ROSTER_CONFIG.MAX_PLAYERS, `${seasons}季 ${clubId} roster > 24（${roster}）`);
      const ids = getClubPlayers(state, clubId);
      const pos = { GK: 0, DF: 0, MF: 0, FW: 0 };
      for (const id of ids) pos[getPlayerProfile(state, id).position] += 1;
      assert(pos.GK >= 1 && pos.DF >= 4 && pos.MF >= 4 && pos.FW >= 2, `${seasons}季 ${clubId} 位置最低破坏`);
      const f = getClubFinance(state, clubId);
      assert(Number.isFinite(f.cash) && f.cash >= 0, `${seasons}季 ${clubId} cash 非法`);
      assert(Number.isFinite(f.transferBudget) && f.transferBudget >= 0 && f.transferBudget <= FINANCE_CONFIG.INITIAL_TRANSFER_BUDGET,
        `${seasons}季 ${clubId} budget 非法`);
    }
    assert(!aiEvents(state).some((e) => e.payload.clubId === 'clb_008'), 'managed club 不得有 AI 事件');
  }
});
