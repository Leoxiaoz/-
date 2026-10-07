/**
 * Step 36D — Managed Finance Feedback（DF-01）测试。
 * 覆盖 D36.1–D36.6：threshold / rate / recipient selection / 守恒 / 只改 cash / 不变式 / 确定性。
 *
 * 红线：不改 DDTI / Transfer / Match / population；不新增 RNG；Schema 10 / Save 1 不变。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { getClubFinance, assertFinanceInvariants } from '../src/core/finance.js';
import { getClubPlayers, validateMembership } from '../src/core/membership.js';
import { getWorldPlayers } from '../src/core/player-runtime.js';
import { assertContractInvariants } from '../src/core/contract.js';
import { FINANCE_FEEDBACK_CONFIG, DDTI_CONFIG, FINANCE_CONFIG } from '../src/core/sim-config.js';
import {
  calculateManagedFinanceFeedback,
  applyManagedFinanceFeedback,
  runManagedFinanceFeedback,
} from '../src/core/finance-feedback.js';
import { makeLeagueWorldFiles } from './fixtures.js';

const CLUBS = ['clb_001', 'clb_002', 'clb_003', 'clb_004', 'clb_005', 'clb_006', 'clb_007', 'clb_008'];
const MANAGED = 'clb_008';
const CFG = { ENABLED: true, THRESHOLD: 0.35, REDISTRIBUTION_RATE: 0.20 };

function leagueState() {
  return createGameState(parseWorld(makeLeagueWorldFiles(8)));
}
/** 最小财政状态（仅计算所需）。 */
function cashState(entries, managedClubId) {
  const clubs = {};
  for (const [id, cash] of entries) {
    clubs[id] = { finance: { cash, wageBudget: 400, transferBudget: 600 } };
  }
  return { runtime: { clubs, managedClubId } };
}
function worldCash(state) {
  const clubs = state.runtime.clubs;
  return Object.keys(clubs).reduce((s, id) => s + clubs[id].finance.cash, 0);
}
function sumAmounts(plan) {
  return plan.recipients.reduce((s, r) => s + r.amount, 0);
}
/** 全量运行时快照（用于不变式）。 */
function snapshot(state) {
  return {
    players: JSON.stringify(state.runtime.players),
    contracts: JSON.stringify(state.runtime.contracts),
    membership: JSON.stringify(state.runtime.membership),
    generated: JSON.stringify(state.runtime.generated),
    retired: JSON.stringify(state.runtime.retired),
    nextGeneratedSeq: state.runtime.nextGeneratedSeq,
    budgets: CLUBS.map((c) => getClubFinance(state, c).transferBudget),
    wageBudgets: CLUBS.map((c) => getClubFinance(state, c).wageBudget),
  };
}

// ---------------------------------------------------------------------------
test('FF-01. config 冻结：THRESHOLD=0.35 / RATE=0.20 / DDTI C1 不变 / INITIAL_CASH 不变', () => {
  assertEquals(FINANCE_FEEDBACK_CONFIG.THRESHOLD, 0.35);
  assertEquals(FINANCE_FEEDBACK_CONFIG.REDISTRIBUTION_RATE, 0.20);
  assertEquals(FINANCE_CONFIG.INITIAL_CASH, 1000);
  assertEquals(DDTI_CONFIG.DEPTH_CAP, 14);
  assertEquals(DDTI_CONFIG.PER_CLUB_INTAKE_CAP, 1);
  assertEquals(DDTI_CONFIG.WORLD_INTAKE_CAP, 4);
  assertEquals(DDTI_CONFIG.HYSTERESIS_UP, 0.30);
  assertEquals(DDTI_CONFIG.HYSTERESIS_DOWN, 0.15);
});

test('FF-02. share <= 35% → 不触发（返回 null）', () => {
  const state = cashState(CLUBS.map((c) => [c, 1000]), MANAGED); // share = 0.125
  assertEquals(calculateManagedFinanceFeedback(state), null);
  assertEquals(runManagedFinanceFeedback(state).applied, false);
});

test('FF-03. share > 35% → 触发：amount = floor(managedCash * 20%)', () => {
  // managed=2600, AI=[100,200,300,400,900,1000,1100]；world=6600；share≈0.394
  const entries = [['clb_001', 100], ['clb_002', 200], ['clb_003', 300], ['clb_004', 400],
    ['clb_005', 900], ['clb_006', 1000], ['clb_007', 1100], [MANAGED, 2600]];
  const plan = calculateManagedFinanceFeedback(cashState(entries, MANAGED));
  assert(plan, '应触发');
  assertEquals(plan.amount, 520); // floor(2600*0.2)
});

test('FF-04. threshold 边界：恰好 35.0% 不触发；>35% 触发', () => {
  const at = cashState([['clb_a', 650], [MANAGED, 350]], MANAGED); // share = 0.35 恰好
  assertEquals(calculateManagedFinanceFeedback(at), null, '35.0% 不得触发');
  const above = cashState([['clb_a', 649], [MANAGED, 351]], MANAGED); // 0.351
  const plan = calculateManagedFinanceFeedback(above);
  assert(plan, '>35% 应触发');
  assertEquals(plan.amount, 70); // floor(351*0.2)=70
});

test('FF-05. 接收方选择：仅 cash < AI median；cash 升序；余数 +1；managed 不在接收方', () => {
  const entries = [['clb_001', 100], ['clb_002', 200], ['clb_003', 300], ['clb_004', 400],
    ['clb_005', 900], ['clb_006', 1000], ['clb_007', 1100], [MANAGED, 2600]];
  const plan = calculateManagedFinanceFeedback(cashState(entries, MANAGED));
  // AI sorted=[100,200,300,400,900,1000,1100]，median=400 → 接收方 = 100/200/300
  assertEquals(plan.recipients.map((r) => r.clubId), ['clb_001', 'clb_002', 'clb_003']);
  // amount=520；base=173；rem=1 → 首个 +1
  assertEquals(plan.recipients.map((r) => r.amount), [174, 173, 173]);
  assertEquals(sumAmounts(plan), plan.amount);
  assert(!plan.recipients.some((r) => r.clubId === MANAGED), 'managed 不得为接收方');
});

test('FF-06. 无 AI club 低于 median → 使用全部 AI clubs；cash 相同时 clubId 升序 tie-break', () => {
  const entries = CLUBS.filter((c) => c !== MANAGED).map((c) => [c, 500]);
  entries.push([MANAGED, 4000]); // world=7500，share≈0.533
  const plan = calculateManagedFinanceFeedback(cashState(entries, MANAGED));
  assertEquals(plan.recipients.length, 7, '应使用全部 AI');
  assertEquals(plan.recipients.map((r) => r.clubId), CLUBS.filter((c) => c !== MANAGED), 'clubId 升序');
  assertEquals(plan.amount, 800); // floor(4000*0.2)
  // base=114, rem=2 → 前两个 +1
  assertEquals(plan.recipients.map((r) => r.amount), [115, 115, 114, 114, 114, 114, 114]);
  assertEquals(sumAmounts(plan), 800);
});

test('FF-07. equal split + remainder 分配：3 接收方 / amount=520', () => {
  const entries = [['clb_001', 100], ['clb_002', 100], ['clb_003', 100], ['clb_004', 900],
    ['clb_005', 900], ['clb_006', 900], ['clb_007', 900], [MANAGED, 2600]];
  // world=6500，share=0.4；AI sorted=[100,100,100,900,900,900,900]，median=900 → 接收方 = 三个 100
  const plan = calculateManagedFinanceFeedback(cashState(entries, MANAGED));
  assertEquals(plan.recipients.map((r) => r.clubId), ['clb_001', 'clb_002', 'clb_003']);
  assertEquals(plan.amount, 520); // floor(2600*0.2)
  assertEquals(plan.recipients.map((r) => r.amount), [174, 173, 173]);
  assertEquals(sumAmounts(plan), 520);
});

test('FF-08. 单一 AI club；边界附近 managed', () => {
  const entries = [['clb_a', 200], [MANAGED, 9800]]; // world=10000 share 0.98
  const plan = calculateManagedFinanceFeedback(cashState(entries, MANAGED));
  assertEquals(plan.recipients.map((r) => r.clubId), ['clb_a']);
  assertEquals(plan.amount, 1960); // floor(9800*0.2)
  assertEquals(plan.recipients[0].amount, 1960);
});

test('FF-09. 零 / 边界 cash：worldCash=0、managed=0、无 managed → 不触发', () => {
  assertEquals(calculateManagedFinanceFeedback(cashState([['clb_a', 0], [MANAGED, 0]], MANAGED)), null);
  assertEquals(calculateManagedFinanceFeedback(cashState([['clb_a', 8000], [MANAGED, 0]], MANAGED)), null);
  // 无 managed club
  const noManaged = cashState([['clb_a', 5000], ['clb_b', 5000]], null);
  assertEquals(calculateManagedFinanceFeedback(noManaged), null);
});

test('FF-10. 应用后：world cash 守恒、cash 均 >= 0、只改 cash（budget/wage 不变）', () => {
  const entries = [['clb_001', 100], ['clb_002', 200], ['clb_003', 300], ['clb_004', 400],
    ['clb_005', 900], ['clb_006', 1000], ['clb_007', 1100], [MANAGED, 2600]];
  const state = cashState(entries, MANAGED);
  const before = worldCash(state);
  const budgetsBefore = Object.keys(state.runtime.clubs).map((id) => state.runtime.clubs[id].finance.transferBudget);
  const wagesBefore = Object.keys(state.runtime.clubs).map((id) => state.runtime.clubs[id].finance.wageBudget);
  const plan = calculateManagedFinanceFeedback(state);
  const r = applyManagedFinanceFeedback(state, plan);
  assertEquals(r.applied, true);
  assertEquals(worldCash(state), before, 'world cash 必须守恒');
  for (const id of Object.keys(state.runtime.clubs)) {
    assert(state.runtime.clubs[id].finance.cash >= 0, `${id} cash 不得为负`);
  }
  assertEquals(Object.keys(state.runtime.clubs).map((id) => state.runtime.clubs[id].finance.transferBudget), budgetsBefore);
  assertEquals(Object.keys(state.runtime.clubs).map((id) => state.runtime.clubs[id].finance.wageBudget), wagesBefore);
});

test('FF-11. 确定性：同输入 → 同 plan；重复 apply 两个克隆 → 同结果', () => {
  const entries = [['clb_001', 100], ['clb_002', 200], ['clb_003', 300], ['clb_004', 400],
    ['clb_005', 900], ['clb_006', 1000], ['clb_007', 1100], [MANAGED, 2600]];
  const a = cashState(entries, MANAGED);
  const b = cashState(entries, MANAGED);
  assertEquals(calculateManagedFinanceFeedback(a), calculateManagedFinanceFeedback(b));
  applyManagedFinanceFeedback(a, calculateManagedFinanceFeedback(a));
  applyManagedFinanceFeedback(b, calculateManagedFinanceFeedback(b));
  for (const id of Object.keys(a.runtime.clubs)) {
    assertEquals(a.runtime.clubs[id].finance.cash, b.runtime.clubs[id].finance.cash, `${id} 应一致`);
  }
});

test('FF-12. 无 OVR / 无隐藏字段：plan 只含冻结字段', () => {
  const entries = CLUBS.filter((c) => c !== MANAGED).map((c) => [c, 500]);
  entries.push([MANAGED, 4000]);
  const plan = calculateManagedFinanceFeedback(cashState(entries, MANAGED));
  assert(plan);
  assert(!('overall' in plan) && !('ovr' in plan));
  assertEquals(Object.keys(plan).sort(),
    ['amount', 'managedCash', 'managedClubId', 'rate', 'recipients', 'share', 'threshold', 'worldCash']);
});

// ---------------------------------------------------------------------------
test('FF-13. 全量状态：Feedback 不改变 players/contracts/membership/generated/DDTI 痕迹，仅改 cash', () => {
  const state = leagueState();
  state.runtime.managedClubId = MANAGED;
  new SimulationCore().advanceDays(state, 30 * 125); // 建立真实玩家/合同/成员状态
  // 人为抬高 managed cash 以超过阈值（仅测试制造触发条件）
  getClubFinance(state, MANAGED).cash = Math.floor(worldCash(state) * 0.6);
  const before = snapshot(state);
  const worldBefore = worldCash(state);
  const cashBefore = CLUBS.map((c) => getClubFinance(state, c).cash);

  const r = runManagedFinanceFeedback(state);

  assert(r.applied, '人为失衡后应触发');
  assertEquals(snapshot(state), before, 'players/contracts/membership/generated/budget 必须不变');
  assertEquals(worldCash(state), worldBefore, 'world cash 必须守恒');
  const cashAfter = CLUBS.map((c) => getClubFinance(state, c).cash);
  assert(JSON.stringify(cashAfter) !== JSON.stringify(cashBefore), 'cash 应发生变化');
  assertFinanceInvariants(state);
});

test('FF-14. 全量状态：正常长跑后仍满足不变量，world cash 恒为 8000', () => {
  const state = leagueState();
  state.runtime.managedClubId = MANAGED;
  const sim = new SimulationCore();
  for (let s = 0; s < 60; s += 1) {
    sim.advanceDays(state, 125);
    assertEquals(worldCash(state), 8 * FINANCE_CONFIG.INITIAL_CASH, `${s + 1} 季 world cash 应为 8000`);
  }
  assertEquals(validateMembership(state).fatal, []);
  assertContractInvariants(state);
  assertFinanceInvariants(state);
  const f = getClubFinance(state, MANAGED);
  assert(f.cash >= 0 && f.cash / worldCash(state) < 0.9999, 'managed share 不应趋近 1');
});

test('FF-15. 无 managed club 时 Feedback 为 no-op（纯 AI 世界不受影响）', () => {
  const state = leagueState();
  const before = snapshot(state);
  const r = runManagedFinanceFeedback(state);
  assertEquals(r.applied, false);
  assertEquals(snapshot(state), before);
});
