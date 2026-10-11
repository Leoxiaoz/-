/**
 * 球员成长/衰退系统测试（第 16 步，DECISIONS D-14 / SIMULATION_SPEC §20）。
 * 覆盖：确定性、潜力上限、年轻成长/年老衰退、出场/士气/人格/训练/伤病修正、
 * 幂等、静态库只读、字段校验、防膨胀（10/100 赛季）。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import {
  getEffectiveAttributes,
  getPlayerRuntime,
  getWorldPlayers,
  recordAppearance,
  setVitals,
  applyInjury,
} from '../src/core/player-runtime.js';
import { developPlayers } from '../src/core/player-growth.js';
import { ageOn } from '../src/core/date-utils.js';
import { SimulationCore } from '../src/core/simulation.js';
import { parseWorld } from '../src/data/data-loader.js';
import { makeWorldFiles, makeLeagueWorldFiles } from './fixtures.js';

const ATTRS = ['pace', 'technique', 'passing', 'defending', 'finishing', 'goalkeeping'];

function leagueState(n = 4) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}

function deepFreeze(obj) {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}

/** 找一个指定年龄上限的球员 id；若无则回退到全队最年轻者（保证测试稳定）。 */
function findYoungerThan(state, maxAge) {
  let best = null;
  let bestAge = 999;
  for (const p of state.static.players) {
    const age = ageOn(p.birthDate, state.currentDate);
    if (age <= maxAge) return p.id;
    if (age < bestAge) { bestAge = age; best = p.id; }
  }
  return best;
}

// ---------- 基础工具 ----------
test('ageOn 计算周岁（生日未到则减 1）', () => {
  assertEquals(ageOn('2000-01-15', '2026-07-01'), 26);
  assertEquals(ageOn('2000-12-31', '2026-07-01'), 25);
  assertEquals(ageOn('2000-07-02', '2026-07-01'), 25);
});

// ---------- 确定性 ----------
test('成长确定性：同（库+档+种子）两次推进得到完全一致的有效属性', () => {
  const a = leagueState(8);
  const b = leagueState(8);
  developPlayers(a, { seasonNumber: 1 });
  developPlayers(b, { seasonNumber: 1 });
  for (const p of a.static.players) {
    assertEquals(getEffectiveAttributes(a, p.id), getEffectiveAttributes(b, p.id), `${p.id} 不一致`);
  }
});

// ---------- 幂等 ----------
test('同一赛季重复结算不会重复变化（幂等）', () => {
  const state = leagueState(4);
  const id = findYoungerThan(state, 21);
  developPlayers(state, { seasonNumber: 1 });
  const once = getEffectiveAttributes(state, id);
  developPlayers(state, { seasonNumber: 1 });
  assertEquals(getEffectiveAttributes(state, id), once);
});

// ---------- 成长与潜力上限 ----------
test('年轻球员能力向潜力增长，且绝不突破每属性潜力上限', () => {
  const state = leagueState(8);
  const id = findYoungerThan(state, 20);
  assert(id, '夹具中应有年轻球员');
  const before = getEffectiveAttributes(state, id);
  for (let s = 1; s <= 8; s += 1) {
    state.currentDate = `${2026 + s}-07-01`;
    developPlayers(state, { seasonNumber: s });
    const eff = getEffectiveAttributes(state, id);
    const pot = state.static.players.find((p) => p.id === id).potential;
    for (const a of ATTRS) {
      assert(eff[a] <= pot[a], `赛季 ${s} 属性 ${a}=${eff[a]} 超过潜力 ${pot[a]}`);
      assert(eff[a] >= 1 && Number.isInteger(eff[a]), '属性应为 1–99 整数');
    }
  }
  const after = getEffectiveAttributes(state, id);
  const grew = ATTRS.some((a) => after[a] > before[a]);
  assert(grew, '年轻球员应至少有一项属性增长');
});

test('潜力已达上限的属性不再增长（收益归零）', () => {
  const files = makeLeagueWorldFiles(2);
  const target = files.players[0];
  target.birthDate = '2010-01-01'; // 确保处于成长期，排除衰退干扰
  // 让该球员所有属性基础值 = 潜力（无余量）
  for (const a of ATTRS) target.potential[a] = target[a];
  const state = createGameState(parseWorld(files));
  const before = getEffectiveAttributes(state, target.id);
  developPlayers(state, { seasonNumber: 1 });
  assertEquals(getEffectiveAttributes(state, target.id), before, '无余量则不应增长');
});

// ---------- 衰退 ----------
test('年长球员（过巅峰）身体属性优先衰退', () => {
  const files = makeWorldFiles();
  const p = files.players[0];
  p.birthDate = '1988-01-01'; // 约 38 岁，远超所有分组巅峰
  for (const a of ATTRS) p.potential[a] = 99;
  const state = createGameState(parseWorld(files));
  const before = getEffectiveAttributes(state, p.id);
  developPlayers(state, { seasonNumber: 1 });
  const after = getEffectiveAttributes(state, p.id);
  assert(after.pace < before.pace, `身体属性应衰退（pace ${before.pace}→${after.pace}）`);
  assert(after.goalkeeping <= before.goalkeeping, '门将属性不应增长');
});

// ---------- 出场影响（B2） ----------
test('比赛出场提升年轻球员的成长幅度（B2）', () => {
  const filesA = makeLeagueWorldFiles(4);
  const filesB = makeLeagueWorldFiles(4);
  const a = createGameState(parseWorld(filesA));
  const b = createGameState(parseWorld(filesB));
  const id = findYoungerThan(a, 21);
  for (let i = 0; i < 30; i += 1) recordAppearance(a, id, { minutes: 90 }); // 赛季满勤（30×90=2700）
  developPlayers(a, { seasonNumber: 1 });
  developPlayers(b, { seasonNumber: 1 });
  const ea = getEffectiveAttributes(a, id);
  const eb = getEffectiveAttributes(b, id);
  const sumA = ATTRS.reduce((s, k) => s + ea[k], 0);
  const sumB = ATTRS.reduce((s, k) => s + eb[k], 0);
  assert(sumA >= sumB, `出场应不劣于无出场（${sumA} vs ${sumB}）`);
});

// ---------- 状态/士气影响（B3） ----------
test('高士气/状态不劣于低士气/状态的成长（B3，温和）', () => {
  const a = createGameState(parseWorld(makeLeagueWorldFiles(4)));
  const b = createGameState(parseWorld(makeLeagueWorldFiles(4)));
  const id = findYoungerThan(a, 22);
  setVitals(a, id, { morale: 100, form: 100 });
  setVitals(b, id, { morale: 0, form: 0 });
  developPlayers(a, { seasonNumber: 1 });
  developPlayers(b, { seasonNumber: 1 });
  const sumA = ATTRS.reduce((s, k) => s + getEffectiveAttributes(a, id)[k], 0);
  const sumB = ATTRS.reduce((s, k) => s + getEffectiveAttributes(b, id)[k], 0);
  assert(sumA >= sumB, `高士气成长应不劣于低士气（${sumA} vs ${sumB}）`);
});

// ---------- 人格影响（B4） ----------
test('高职业素养/决心不劣于低者的成长（B4）', () => {
  const mk = (prof, det) => {
    const files = makeLeagueWorldFiles(4);
    const target = files.players.find((p) => p.id === findTargetId(files));
    target.personality = { professionalism: prof, determination: det, ambition: 60, consistency: 60, injuryProneness: 30 };
    return { state: createGameState(parseWorld(files)), id: target.id };
  };
  const hi = mk(99, 99);
  const lo = mk(1, 1);
  developPlayers(hi.state, { seasonNumber: 1 });
  developPlayers(lo.state, { seasonNumber: 1 });
  const sumHi = ATTRS.reduce((s, k) => s + getEffectiveAttributes(hi.state, hi.id)[k], 0);
  const sumLo = ATTRS.reduce((s, k) => s + getEffectiveAttributes(lo.state, lo.id)[k], 0);
  assert(sumHi >= sumLo, `高职业素养应不劣于低者（${sumHi} vs ${sumLo}）`);
});

/** 取 files 中最年轻球员 id（用于人格对照）。 */
function findTargetId(files) {
  let best = null;
  let bestAge = 999;
  for (const p of files.players) {
    const age = 2026 - Number(String(p.birthDate).slice(0, 4));
    if (age < bestAge) { bestAge = age; best = p.id; }
  }
  return best;
}

// ---------- 训练接口（Step 39F-C：Training = Development Input 档位） ----------
test('训练档位接口可放大成长（STRONG > LIMITED）', () => {
  const files = makeLeagueWorldFiles(4);
  const id = findTargetId(files);
  const a = createGameState(parseWorld(files));
  const b = createGameState(parseWorld(makeLeagueWorldFiles(4)));
  developPlayers(a, { seasonNumber: 1, training: () => 'STRONG' }); // 强化训练档位
  developPlayers(b, { seasonNumber: 1, training: () => 'LIMITED' }); // 弱训练档位
  const sumA = ATTRS.reduce((s, k) => s + getEffectiveAttributes(a, id)[k], 0);
  const sumB = ATTRS.reduce((s, k) => s + getEffectiveAttributes(b, id)[k], 0);
  assert(sumA >= sumB, `训练加成应不劣于默认（${sumA} vs ${sumB}）`);
});

// ---------- 长期伤病（B7） ----------
test('严重长期伤病放缓后续成长（B7）', () => {
  const a = createGameState(parseWorld(makeLeagueWorldFiles(4)));
  const b = createGameState(parseWorld(makeLeagueWorldFiles(4)));
  const id = findYoungerThan(a, 21);
  applyInjury(a, id, { type: 'acl', daysRemaining: 200 }); // 严重长期伤病
  developPlayers(a, { seasonNumber: 1 });
  developPlayers(b, { seasonNumber: 1 });
  const sumA = ATTRS.reduce((s, k) => s + getEffectiveAttributes(a, id)[k], 0);
  const sumB = ATTRS.reduce((s, k) => s + getEffectiveAttributes(b, id)[k], 0);
  assert(sumA <= sumB, `长期伤病应不优于健康（${sumA} vs ${sumB}）`);
  assertEquals(getPlayerRuntime(a, id).growth.injuryPenaltySeasons, 0, '惩罚应在结算后递减');
});

// ---------- 静态库只读 ----------
test('成长结算不修改静态数据库（深度冻结验证）', () => {
  const state = leagueState(4);
  const snapshot = JSON.stringify(state.static.players);
  deepFreeze(state.static);
  const sim = new SimulationCore();
  sim.advanceDays(state, 92); // 触发赛季滚动 → 成长结算
  assertEquals(JSON.stringify(state.static.players), snapshot, '静态球员数据应逐字节不变');
});

// ---------- 接线：赛季滚动触发结算 ----------
test('赛季滚动后球员有效属性发生变化（成长已接入赛季结算）', () => {
  const state = leagueState(8);
  const id = findYoungerThan(state, 20);
  const before = getEffectiveAttributes(state, id);
  new SimulationCore().advanceDays(state, 92);
  const after = getEffectiveAttributes(state, id);
  assert(JSON.stringify(before) !== JSON.stringify(after), '赛季滚动应已结算成长');
  assert(getPlayerRuntime(state, id).growth.lastEvaluatedSeason >= 1);
});

// ---------- 字段校验 ----------
test('加载校验拒绝缺失出生日期的球员', () => {
  const files = makeWorldFiles();
  delete files.players[0].birthDate;
  assertThrows(() => parseWorld(files), 'DataError');
});

test('加载校验拒绝缺失潜力的球员', () => {
  const files = makeWorldFiles();
  delete files.players[0].potential;
  assertThrows(() => parseWorld(files), 'DataError');
});

test('加载校验拒绝潜力低于基础属性', () => {
  const files = makeWorldFiles();
  files.players[0].potential.pace = 10; // 低于基础/默认值
  assertThrows(() => parseWorld(files), 'DataError');
});

test('加载校验拒绝缺失人格的球员', () => {
  const files = makeWorldFiles();
  delete files.players[0].personality;
  assertThrows(() => parseWorld(files), 'DataError');
});

// ---------- 长期稳定（D1/D2） ----------
test('长期稳定：50/100 赛季后世界属性均值既不坍缩也不膨胀（第 19 步含退役+新生代）', () => {
  const mean0 = worldMean(leagueState(8));
  // 短中期（10 季）：允许成长推高均值，仅校验边界与整数
  checkAllWithinPotential(seasonState(10), 10);
  // 中长期（50/100 季）：第 19 步起有退役+新生代，世界均值应长期稳定（不坍缩、不无限膨胀）
  const mean50 = worldMean(seasonState(50));
  const mean100 = worldMean(seasonState(100));
  assert(Number.isFinite(mean50) && Number.isFinite(mean100), '属性均值应为有限值');
  assert(mean50 >= mean0 * 0.6 && mean50 <= mean0 * 1.4,
    `50 赛季均值应在稳定区间（${mean50.toFixed(2)} vs 初始 ${mean0.toFixed(2)}）`);
  assert(mean100 >= mean0 * 0.6 && mean100 <= mean0 * 1.4,
    `100 赛季均值应在稳定区间（${mean100.toFixed(2)} vs 初始 ${mean0.toFixed(2)}）`);
  checkAllWithinPotential(seasonState(50), 50);
  checkAllWithinPotential(seasonState(100), 100);
});

function seasonState(seasons) {
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, seasons * 125);
  return state;
}

function worldMean(state) {
  let sum = 0;
  let n = 0;
  for (const p of getWorldPlayers(state)) { // 活跃世界球员（排除退役、含新生代）
    const eff = getEffectiveAttributes(state, p.id);
    for (const a of ATTRS) { sum += eff[a]; n += 1; }
  }
  return sum / n;
}

function checkAllWithinPotential(state, seasons) {
  for (const p of getWorldPlayers(state)) {
    const eff = getEffectiveAttributes(state, p.id);
    for (const a of ATTRS) {
      assert(Number.isInteger(eff[a]), `${seasons} 赛季 ${p.id}.${a} 应为整数`);
      assert(eff[a] >= 1 && eff[a] <= p.potential[a], `${seasons} 赛季 ${p.id}.${a} 越界`);
    }
  }
}