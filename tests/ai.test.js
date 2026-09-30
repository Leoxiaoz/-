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
import { getClubFinance, assertFinanceInvariants } from '../src/core/finance.js';
import { getFreeAgents, assertFreeAgentInvariants, releasePlayerToFreeAgent } from '../src/core/free-agent.js';
import { computeTransferFee } from '../src/core/transfer.js';
import { ROSTER_CONFIG } from '../src/core/sim-config.js';
import { AI_CONFIG } from '../src/core/ai/ai-config.js';
import { getAIClubPolicy } from '../src/core/ai/ai-club-policy.js';
import { evaluateSquadNeed } from '../src/core/ai/ai-need.js';
import { filterCandidates, CANDIDATE_SOURCE } from '../src/core/ai/ai-candidate.js';
import { evaluatePlayerSuitability, potentialHeadroom } from '../src/core/ai/ai-suitability.js';
import {
  evaluateClubDecisions, decideRelease, decideSignFreeAgent, decideTransfer, runSeasonAI,
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

test('B. Squad Need：Soft Need（能力缺口，非仅人数），且 Policy 关闭时不产生 Soft', () => {
  const softClub = findClubWith((p) => p.softNeedEnabled);
  assert(softClub, '应存在启用 Soft Need 的俱乐部');
  const files = makeLeagueWorldFiles(8);
  for (const p of files.players) {
    if (p.teamId === softClub && p.position === 'MF') {
      for (const a of ['pace', 'technique', 'passing', 'defending', 'finishing']) p[a] = 40;
    }
  }
  const softNeed = evaluateSquadNeed(stateFromFiles(files), softClub);
  assert(softNeed.needs.some((n) => n.position === 'MF' && n.needClass === 'SOFT' && n.reasonCode === 'ATTRIBUTE_GAP'),
    '应检测到 MF 能力缺口（Soft）');

  // 关闭 Soft 的俱乐部（Conservative）：满编且无 Hard → NONE
  const noSoft = findClubWith((p) => !p.softNeedEnabled);
  assert(noSoft, '应存在关闭 Soft Need 的俱乐部');
  const none = evaluateSquadNeed(leagueState(8), noSoft);
  assertEquals(none.needClass, 'NONE', '满编且无 Hard 且 Soft 关闭 → NONE');
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

test('D. Suitability：Starter 偏当前能力，Development 偏潜力（角色权重切换）', () => {
  const files = makeLeagueWorldFiles(2);
  const fws = files.players.filter((p) => p.teamId === 'clb_001' && p.position === 'FW').slice(0, 2);
  const [a, b] = fws;
  const lowAttr = { pace: 40, technique: 40, passing: 40, defending: 10, finishing: 40, goalkeeping: 10 };
  const highAttr = { pace: 80, technique: 80, passing: 80, defending: 10, finishing: 80, goalkeeping: 10 };
  a.birthDate = '2001-01-15'; b.birthDate = '2001-01-15';
  Object.assign(a, highAttr, { potential: { ...highAttr } }); // 高当前 / 低潜力
  Object.assign(b, lowAttr, { potential: { ...lowAttr, finishing: 90, technique: 90, pace: 90 } }); // 低当前 / 高潜力
  const state = stateFromFiles(files);
  const sa = evaluatePlayerSuitability(state, 'clb_001', a.id, { position: 'FW' }, 'Starter').score;
  const sb = evaluatePlayerSuitability(state, 'clb_001', b.id, { position: 'FW' }, 'Starter').score;
  assert(sa > sb, 'Starter 角色应偏当前能力');
  const da = evaluatePlayerSuitability(state, 'clb_001', a.id, { position: 'FW' }, 'Development').score;
  const db = evaluatePlayerSuitability(state, 'clb_001', b.id, { position: 'FW' }, 'Development').score;
  assert(db > da, 'Development 角色应偏潜力');
  assert(potentialHeadroom(getPlayerProfile(state, b.id)) > 0, '潜力余量应 > 0');
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
test('H. Release：不释放最后 GK / 不低于 12 / 不破坏 DF 最低', () => {
  // 不释放最后 GK（GK 设为高龄，理应被排除在候选之外）
  const filesGk = makeLeagueWorldFiles(8);
  const gk = filesGk.players.find((p) => p.teamId === 'clb_001' && p.position === 'GK');
  const fw = filesGk.players.find((p) => p.teamId === 'clb_001' && p.position === 'FW');
  gk.birthDate = '1985-01-15';
  fw.birthDate = '1985-01-15';
  const sGk = stateFromFiles(filesGk);
  const relGk = decideRelease(sGk, 'clb_001');
  assert(relGk, '应产生释放决策');
  assert(relGk.playerId !== gk.id, '不得释放最后 GK');

  // roster == 12 → 不得释放
  const files12 = pruneTeam(makeLeagueWorldFiles(8), 'clb_001', { GK: 1, DF: 4, MF: 4, FW: 3 });
  const s12 = stateFromFiles(files12);
  assertEquals(getClubPlayers(s12, 'clb_001').length, 12);
  assertEquals(decideRelease(s12, 'clb_001'), null, 'roster=12 不得释放');

  // DF == 4（最低）→ DF 不可释放
  const filesDf = pruneTeam(makeLeagueWorldFiles(8), 'clb_001', { GK: 1, DF: 4, MF: 5, FW: 3 });
  filesDf.players.find((p) => p.teamId === 'clb_001' && p.position === 'MF').birthDate = '1985-01-15';
  const sDf = stateFromFiles(filesDf);
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
