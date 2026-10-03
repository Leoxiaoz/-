/**
 * Step 39F-L-C0 — AI Development Philosophy 测试（Family C / D-45）。
 *
 * 覆盖：三档固定映射、复用 Club Identity、determinism、无副作用、无 jitter、
 * 非仿射约束、值域、未知 clubId 行为、无第二套 identity hash。
 *
 * 红线：只读、纯函数、无 RNG、无持久化、NO CONSUMER；schema 10 / save 1 未变。
 */

import { test, assert, assertEquals } from './harness.js';
import {
  evaluateDevelopmentPhilosophy,
  DEVELOPMENT_PHILOSOPHY_FAMILY_C as FAMILY_C,
} from '../src/core/ai/ai-development-philosophy.js';
import { getAIClubPolicy } from '../src/core/ai/ai-club-policy.js';
import { AI_CONFIG } from '../src/core/ai/ai-config.js';

// 当前真实 test-world.fdb 的 club ID（经 getAIClubPolicy 校验覆盖三档）。
const CLUBS = ['clb_a1', 'clb_a2', 'clb_b1', 'clb_b2'];

const expectedFor = (clubId) => FAMILY_C[getAIClubPolicy(clubId).id];

// ================= 三档映射 =================

test('C0-01. Conservative 映射：commitment=0.30 / opportunity=0.30', () => {
  // clb_b1 经 Club Identity 判定为 Conservative。
  assertEquals(getAIClubPolicy('clb_b1').id, 'Conservative', 'clb_b1 应为 Conservative');
  const r = evaluateDevelopmentPhilosophy('clb_b1');
  assertEquals(r, { developmentCommitment: 0.30, youthOpportunityPreference: 0.30 });
});

test('C0-02. Balanced 映射：commitment=0.50 / opportunity=0.50', () => {
  assertEquals(getAIClubPolicy('clb_a2').id, 'Balanced', 'clb_a2 应为 Balanced');
  const r = evaluateDevelopmentPhilosophy('clb_a2');
  assertEquals(r, { developmentCommitment: 0.50, youthOpportunityPreference: 0.50 });
});

test('C0-03. YouthFocus 映射：commitment=0.70 / opportunity=0.60', () => {
  assertEquals(getAIClubPolicy('clb_a1').id, 'YouthFocus', 'clb_a1 应为 YouthFocus');
  const r = evaluateDevelopmentPhilosophy('clb_a1');
  assertEquals(r, { developmentCommitment: 0.70, youthOpportunityPreference: 0.60 });
});

// ================= 复用 Club Identity =================

test('C0-05. 多个真实 clubId 均遵循 getAIClubPolicy 的 Identity', () => {
  for (const id of CLUBS) {
    const r = evaluateDevelopmentPhilosophy(id);
    const e = expectedFor(id);
    assert(r.developmentCommitment === e.developmentCommitment, `${id} commitment 漂移`);
    assert(r.youthOpportunityPreference === e.youthOpportunityPreference, `${id} opportunity 漂移`);
  }
  // 至少覆盖到三种 archetype（保证测试世界仍具代表性）。
  const archs = new Set(CLUBS.map((id) => getAIClubPolicy(id).id));
  assertEquals(archs.size, 3, 'test-world 应覆盖三档 archetype');
});

// ================= determinism / 无随机 =================

test('C0-04. 同一 clubId 重复调用结果完全一致', () => {
  for (const id of CLUBS) {
    const a = evaluateDevelopmentPhilosophy(id);
    const b = evaluateDevelopmentPhilosophy(id);
    const c = evaluateDevelopmentPhilosophy(id);
    assertEquals(a, b, `${id} 第 1/2 次不一致`);
    assertEquals(b, c, `${id} 第 2/3 次不一致`);
  }
});

test('C0-07. 无随机性：多次运行结果恒定，且与 Identity 派生一致', () => {
  for (let i = 0; i < 200; i += 1) {
    const id = CLUBS[i % CLUBS.length];
    const r = evaluateDevelopmentPhilosophy(id);
    const e = expectedFor(id);
    assert(r.developmentCommitment === e.developmentCommitment, `iter ${i} commitment 漂移`);
    assert(r.youthOpportunityPreference === e.youthOpportunityPreference, `iter ${i} opportunity 漂移`);
  }
});

// ================= 无 jitter / 无第二套 identity =================

test('C0-10. 无 jitter / 无第二套 identity：同 archetype 的不同 club 结果完全相同', () => {
  // clb_a2 与 clb_b2 均为 Balanced → 必须得到完全相同的两轴（排除 per-club hash）。
  assertEquals(getAIClubPolicy('clb_a2').id, 'Balanced');
  assertEquals(getAIClubPolicy('clb_b2').id, 'Balanced');
  assertEquals(evaluateDevelopmentPhilosophy('clb_a2'), evaluateDevelopmentPhilosophy('clb_b2'));
});

test('C0-12. 三档映射与 D-45 冻结常量逐值一致', () => {
  assertEquals(FAMILY_C.Conservative, { developmentCommitment: 0.30, youthOpportunityPreference: 0.30 });
  assertEquals(FAMILY_C.Balanced, { developmentCommitment: 0.50, youthOpportunityPreference: 0.50 });
  assertEquals(FAMILY_C.YouthFocus, { developmentCommitment: 0.70, youthOpportunityPreference: 0.60 });
});

// ================= 无副作用 / 返回对象安全 =================

test('C0-06. 纯函数：不修改 Club Policy 配置，且返回新对象（无共享单例）', () => {
  const before = JSON.stringify(AI_CONFIG.POLICIES);
  const r1 = evaluateDevelopmentPhilosophy('clb_a1');
  const r2 = evaluateDevelopmentPhilosophy('clb_a1');
  assert(r1 !== r2, '每次应返回新的 plain object');
  r1.developmentCommitment = -1; // 污染返回值
  const r3 = evaluateDevelopmentPhilosophy('clb_a1');
  assert(r3.developmentCommitment === 0.70, '外部修改不得污染后续调用');
  assertEquals(JSON.stringify(AI_CONFIG.POLICIES), before, 'AI_CONFIG.POLICIES 被修改');
});

// ================= 值域 / 非仿射 =================

test('C0-08. 所有输出值均在 [0,1]', () => {
  for (const id of CLUBS) {
    const r = evaluateDevelopmentPhilosophy(id);
    for (const [k, v] of Object.entries(r)) {
      assert(Number.isFinite(v) && v >= 0 && v <= 1, `${id}.${k}=${v} 越界`);
    }
  }
});

test('C0-09. Family C 三点非共线（不存在 O = a·C + b）', () => {
  const pts = [
    FAMILY_C.Conservative, FAMILY_C.Balanced, FAMILY_C.YouthFocus,
  ].map((e) => [e.developmentCommitment, e.youthOpportunityPreference]);
  const [[x1, y1], [x2, y2], [x3, y3]] = pts;
  const slope12 = (y2 - y1) / (x2 - x1);
  const slope23 = (y3 - y2) / (x3 - x2);
  assert(slope12 !== slope23, `三点共线（slope12=${slope12}, slope23=${slope23}）`);
  // 叉积/面积法：det != 0。
  const det = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
  assert(Math.abs(det) > 1e-9, `行列式为 0（共线），det=${det}`);
});

// ================= 边界：未知 clubId =================

test('C0-11. 未知 clubId 遵循既有 getAIClubPolicy 行为（不新增 fallback identity）', () => {
  for (const id of ['clb_unknown_xyz', '', 'FreeAgent-ish', 'clb_9999']) {
    const r = evaluateDevelopmentPhilosophy(id);
    const e = expectedFor(id);
    assertEquals(r, e, `未知 id "${id}" 未遵循 getAIClubPolicy 行为`);
  }
});
