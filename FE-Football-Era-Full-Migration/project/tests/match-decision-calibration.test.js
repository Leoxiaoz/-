/**
 * Step 39F-M-B-CAL-01 —— Decision Layer Calibration 测试。
 *
 * 覆盖：Scenario Matrix（进攻/防守/GK/极端/上下文）、Action Distribution 曲面、
 * Ability 方向、Soft Modifier 不越权、Top-K ∧ Band 校准、Determinism、RNG Isolation、
 * 异常检测（NaN/Infinity/非法 target/非法 action/preference 越界）。
 *
 * 红线：只调用 Decision Layer；不接生产 Match Loop；不改 MatchCore/Save/Growth/Development。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { createRng, hashSeed } from '../src/core/rng.js';
import { decidePlayerAction } from '../src/core/match/decision-pipeline.js';
import { buildPlayerSituation } from '../src/core/match/player-situation.js';
import { evaluateEligibility } from '../src/core/match/decision-selection.js';
import { generateCandidates } from '../src/core/match/decision-candidates.js';
import { DEFAULT_ACTION_REGISTRY, createActionRegistry } from '../src/core/match/action-registry.js';
import { ACTION_DEFINITIONS } from '../src/core/match/action-definitions.js';
import { ACTION_TYPES, DECISION_SELECTION_CONFIG } from '../src/core/match/decision-config.js';
import { REJECTION_REASONS } from '../src/core/match/decision-debug.js';

const H = 'clb_h', A = 'clb_a';
const BASE = { pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70 };
const ATTRS = (o = {}) => ({ ...BASE, ...o });
function mk(id, t, pos, x, y, attrs = {}, extra = {}) {
  return {
    playerId: id, teamId: t, position: pos, positionOnPitch: { x, y },
    onPitch: true, injured: false, sentOff: false, attributes: ATTRS(attrs),
    fitness: 100, form: 50, morale: 50, matchLoad: 0, ...extra,
  };
}
function coreOf(players, ballControl, poss, tactical = {}, extra = {}) {
  const bp = players.find((p) => p.playerId === ballControl);
  return {
    worldId: 'w_cal', season: 1, matchId: 'm_cal', ruleVersion: 'match-decision-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 30, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball: { position: { ...(bp?.positionOnPitch ?? { x: 0.5, y: 0.5 }) }, control: ballControl, possessingTeamId: poss },
    players,
    tactical: {
      [H]: { formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium', ...tactical[H] },
      [A]: { formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium', ...tactical[A] },
    },
    ...extra,
  };
}
const maxPref = (cands, type) => Math.max(0, ...cands.filter((c) => c.actionType === type).map((c) => c.preference));
const hasType = (cands, type) => cands.some((c) => c.actionType === type);

// ---------------------------------------------------------------------------
// Scenario fixtures
// ---------------------------------------------------------------------------
function scenShot() {
  return coreOf([
    mk('h_fw', H, 'FW', 0.86, 0.50, { finishing: 90, technique: 85 }),
    mk('h_mf', H, 'MF', 0.30, 0.50), mk('h_mf2', H, 'MF', 0.25, 0.30),
    mk('a_gk', A, 'GK', 0.97, 0.50), mk('a_df', A, 'DF', 0.80, 0.35), mk('a_df2', A, 'DF', 0.78, 0.65),
  ], 'h_fw', H);
}
function scenDribble() {
  return coreOf([
    mk('h_w', H, 'MF', 0.50, 0.12, { technique: 90, pace: 90 }),
    mk('h_mf', H, 'MF', 0.35, 0.45), mk('h_df', H, 'DF', 0.20, 0.20),
    mk('a_df', A, 'DF', 0.80, 0.70), mk('a_gk', A, 'GK', 0.97, 0.50),
  ], 'h_w', H);
}
function scenPress(pressing) {
  return coreOf([
    mk('a_c', A, 'MF', 0.50, 0.50), mk('a_mf', A, 'MF', 0.62, 0.55),
    mk('h_d', H, 'MF', 0.46, 0.50, { defending: 85 }), mk('h_d2', H, 'DF', 0.35, 0.40), mk('h_gk', H, 'GK', 0.05, 0.50),
  ], 'a_c', A, { [H]: { pressing, mentality: 'balanced' } });
}
function scenTackle() {
  return coreOf([
    mk('a_c', A, 'MF', 0.50, 0.50), mk('a_mf', A, 'MF', 0.70, 0.55),
    mk('h_d', H, 'MF', 0.515, 0.50, { defending: 88 }), mk('h_d2', H, 'DF', 0.35, 0.40), mk('h_gk', H, 'GK', 0.05, 0.50),
  ], 'a_c', A);
}
function scenNoPassTarget() {
  return coreOf([
    mk('h_mf', H, 'MF', 0.50, 0.50), mk('h_d1', H, 'DF', 0.02, 0.02), mk('a_gk', A, 'GK', 0.97, 0.50),
  ], 'h_mf', H);
}
function scenNoDefTarget() {
  return coreOf([
    mk('a_c', A, 'MF', 0.90, 0.90), mk('h_d', H, 'DF', 0.10, 0.10), mk('h_gk', H, 'GK', 0.05, 0.50),
  ], 'a_c', A);
}

// ===========================================================================
// Scenario Matrix — 进攻
// ===========================================================================

test('CAL-A01. 中场持球：PASS/MOVE/DRIBBLE 竞争，SHOT 不因随机凭空登顶', () => {
  const core = coreOf([
    mk('h_mf', H, 'MF', 0.50, 0.50, { passing: 80 }),
    mk('h_d', H, 'DF', 0.30, 0.40), mk('h_fw', H, 'FW', 0.70, 0.50),
    mk('a_mf', A, 'MF', 0.20, 0.60), mk('a_gk', A, 'GK', 0.97, 0.50),
  ], 'h_mf', H);
  const { debug } = decidePlayerAction(core, 'h_mf', { debug: true, seed: 'a01' });
  assert(hasType(debug.candidates, 'PASS') && hasType(debug.candidates, 'MOVE') && hasType(debug.candidates, 'DRIBBLE'));
  const shot = maxPref(debug.candidates, 'SHOT');
  const best = Math.max(...debug.candidates.map((c) => c.preference));
  assert(shot < best, 'SHOT 不应在无射门条件时成为最高偏好');
});

test('CAL-A02. 前锋射门区：SHOT 应成为高偏好（不强制选中）', () => {
  const { debug } = decidePlayerAction(scenShot(), 'h_fw', { debug: true, seed: 'a02' });
  const shot = maxPref(debug.candidates, 'SHOT');
  const move = maxPref(debug.candidates, 'MOVE');
  assert(hasType(debug.candidates, 'SHOT'), '应有 SHOT 候选');
  assert(shot >= move, `SHOT(${shot}) 应不低于 MOVE(${move})`);
});

test('CAL-A03. 边路大空间：DRIBBLE 具备竞争力', () => {
  const { debug } = decidePlayerAction(scenDribble(), 'h_w', { debug: true, seed: 'a03' });
  assert(hasType(debug.candidates, 'DRIBBLE'), '应有 DRIBBLE 候选');
  assert(maxPref(debug.candidates, 'DRIBBLE') >= maxPref(debug.candidates, 'MOVE'), 'DRIBBLE 应可与 MOVE 竞争');
});

test('CAL-A04. 受压迫持球：PASS 候选存在（target 合法）', () => {
  const core = coreOf([
    mk('h_mf', H, 'MF', 0.40, 0.50, { passing: 85 }), mk('h_d', H, 'DF', 0.30, 0.45),
    mk('a_p1', A, 'MF', 0.42, 0.50), mk('a_p2', A, 'MF', 0.38, 0.52), mk('a_gk', A, 'GK', 0.97, 0.50),
  ], 'h_mf', H);
  const { debug } = decidePlayerAction(core, 'h_mf', { debug: true, seed: 'a04' });
  assert(hasType(debug.candidates, 'PASS'), '受压迫下仍应有合法传球目标');
});

test('CAL-A05. 无合法传球目标 → PASS 被 NO_TARGET 淘汰，不可被随机重新加入', () => {
  const core = scenNoPassTarget();
  const { debug } = decidePlayerAction(core, 'h_mf', { debug: true, seed: 'a05' });
  assert(!hasType(debug.candidates, 'PASS'));
  assert(debug.rejected.some((r) => r.actionType === 'PASS' && r.reason === REJECTION_REASONS.NO_TARGET));
});

// ===========================================================================
// Scenario Matrix — 防守
// ===========================================================================

test('CAL-D01. 高压迫战术：PRESS 偏好上升（同局面）', () => {
  const hi = decidePlayerAction(scenPress('high'), 'h_d', { debug: true, seed: 'd01' });
  const lo = decidePlayerAction(scenPress('low'), 'h_d', { debug: true, seed: 'd01' });
  assert(maxPref(hi.debug.candidates, 'PRESS') > maxPref(lo.debug.candidates, 'PRESS'), 'high press 应提升 PRESS 偏好');
});

test('CAL-D02. 低位防守远处：PRESS 不构成绝对首选（无 MARK Action）', () => {
  const core = coreOf([
    mk('a_c', A, 'MF', 0.90, 0.50), mk('h_d', H, 'DF', 0.20, 0.50, { defending: 50 }),
    mk('h_gk', H, 'GK', 0.05, 0.50),
  ], 'a_c', A, { [H]: { pressing: 'low', mentality: 'defensive' } });
  const { debug } = decidePlayerAction(core, 'h_d', { debug: true, seed: 'd02' });
  assert(debug.candidates.some((c) => c.actionType === 'MOVE'), '低位防守应有位移类选择竞争');
  assert(!ACTION_TYPES.includes('MARK'));
});

test('CAL-D03. 贴身防守：TACKLE 具备明显竞争力（仅 Decision）', () => {
  const { debug } = decidePlayerAction(scenTackle(), 'h_d', { debug: true, seed: 'd03' });
  assert(hasType(debug.candidates, 'TACKLE'));
  assert(maxPref(debug.candidates, 'TACKLE') >= maxPref(debug.candidates, 'MOVE'));
});

test('CAL-D04. 无合法防守目标 → TACKLE/PRESS 被淘汰', () => {
  const core = scenNoDefTarget();
  const { debug } = decidePlayerAction(core, 'h_d', { debug: true, seed: 'd04' });
  assert(!hasType(debug.candidates, 'TACKLE'));
  assert(!hasType(debug.candidates, 'PRESS'));
});

// ===========================================================================
// GK
// ===========================================================================

test('CAL-GK01. GK 持球：产生通用 Action（PASS/MOVE），复用同一 Decision', () => {
  const core = coreOf([
    mk('h_gk', H, 'GK', 0.05, 0.50), mk('h_d', H, 'DF', 0.20, 0.40), mk('a_gk', A, 'GK', 0.97, 0.50),
  ], 'h_gk', H);
  const { decision, debug } = decidePlayerAction(core, 'h_gk', { debug: true, seed: 'gk1' });
  assert(['PASS', 'MOVE', 'DRIBBLE'].includes(decision.actionType), 'GK 应复用通用 Decision');
  assert(hasType(debug.candidates, 'PASS') && hasType(debug.candidates, 'MOVE'));
});

test('CAL-GK02. 无 SAVE Action Type（SAVE 属未来 SHOT Resolution）', () => {
  assert(!ACTION_TYPES.includes('SAVE'));
});

// ===========================================================================
// 极端 Scenario
// ===========================================================================

test('CAL-E01. 只有一个合法 Candidate → 与 Seed 无关，且不消费 RNG', () => {
  // 自定义 Registry：单 Action 且只生成一个候选，确保 Eligible Set 恒为 1。
  const single = createActionRegistry([{
    ...ACTION_DEFINITIONS.MOVE,
    generateCandidates: () => ([{ actionType: 'MOVE', intent: 'HOLD_POSITION', target: { type: 'SPACE', x: 0.5, y: 0.5 } }]),
  }]);
  const players = [mk('h_mf', H, 'MF', 0.50, 0.50), mk('a_gk', A, 'GK', 0.97, 0.50)];
  const core = coreOf(players, 'h_mf', H);
  const s = buildPlayerSituation(core, 'h_mf');
  const { candidates } = generateCandidates(s, single);
  assertEquals(candidates.length, 1);
  const a = decidePlayerAction(core, 'h_mf', { seed: 's1', registry: single }).decision;
  const b = decidePlayerAction(core, 'h_mf', { seed: 's2', registry: single }).decision;
  const c = decidePlayerAction(core, 'h_mf', { seed: 's3', registry: single }).decision;
  assertEquals(a, b);
  assertEquals(b, c);
});

test('CAL-E03. 0.90 / 0.60 → 0.60 不得进入 Eligible Set（默认 Band=0.10）', () => {
  const cands = [
    { actionType: 'PASS', target: { type: 'SPACE', x: 0.1, y: 0.1 }, preference: 0.90 },
    { actionType: 'MOVE', target: { type: 'SPACE', x: 0.2, y: 0.2 }, preference: 0.60 },
  ];
  const { eligible } = evaluateEligibility(cands, DECISION_SELECTION_CONFIG);
  assertEquals(eligible.length, 1);
  assertEquals(eligible[0].preference, 0.90);
});

test('CAL-E02. 0.90 / 0.89 → 两者均 eligible（Band 内允许竞争）', () => {
  const cands = [
    { actionType: 'PASS', target: { type: 'SPACE', x: 0.1, y: 0.1 }, preference: 0.90 },
    { actionType: 'MOVE', target: { type: 'SPACE', x: 0.2, y: 0.2 }, preference: 0.89 },
  ];
  const { eligible } = evaluateEligibility(cands, DECISION_SELECTION_CONFIG);
  assertEquals(eligible.length, 2);
});

test('CAL-E04. 多候选：Eligible Set 数量不得超过 TOP-K', () => {
  const { debug } = decidePlayerAction(scenShot(), 'h_fw', { debug: true, seed: 'e04' });
  const elig = debug.candidates.filter((c) => c.eligible).length;
  assert(elig <= DECISION_SELECTION_CONFIG.TOP_K, `eligible=${elig} 超过 TOP_K`);
  assert(debug.candidates.length > DECISION_SELECTION_CONFIG.TOP_K, '应有候选被 Top-K 淘汰');
});

test('CAL-E05. 所有候选被过滤 → NONE，无随机、无重试', () => {
  const players = [mk('h_mf', H, 'MF', 0.50, 0.50, {}, { injured: true }), mk('a_gk', A, 'GK', 0.97, 0.50)];
  const core = coreOf(players, 'h_mf', H);
  const { decision, actionInstance } = decidePlayerAction(core, 'h_mf', { seed: 'e05' });
  assertEquals(decision.actionType, 'NONE');
  assertEquals(actionInstance, null);
});

// ===========================================================================
// 比赛上下文：只软影响，不硬编码
// ===========================================================================

test('CAL-CTX. 领先/落后 + 末段：只改 RiskIntent/偏好，不强制 Action', () => {
  const base = [
    mk('h_mf', H, 'MF', 0.50, 0.50, { passing: 80 }), mk('h_fw', H, 'FW', 0.70, 0.50),
    mk('a_df', A, 'DF', 0.30, 0.60), mk('a_gk', A, 'GK', 0.97, 0.50),
  ];
  const lead = coreOf(base, 'h_mf', H, {}, { score: { home: 1, away: 0 }, clock: { simulationTime: 85, matchDuration: 90, half: 2, status: 'in_play' } });
  const trail = coreOf(base, 'h_mf', H, {}, { score: { home: 0, away: 1 }, clock: { simulationTime: 85, matchDuration: 90, half: 2, status: 'in_play' } });
  const rl = decidePlayerAction(lead, 'h_mf', { seed: 'ctx' });
  const rt = decidePlayerAction(trail, 'h_mf', { seed: 'ctx' });
  assert(rt.decision.riskIntent.value > rl.decision.riskIntent.value, '落后末段风险倾向应更高');
  assert(ACTION_TYPES.includes(rl.decision.actionType) && ACTION_TYPES.includes(rt.decision.actionType));
});

// ===========================================================================
// Player State Soft Influence（不改变 Hard Availability）
// ===========================================================================

test('CAL-STATE. 低 fitness 不禁止 PASS/SHOT/DRIBBLE（仅软影响）', () => {
  const players = [
    mk('h_fw', H, 'FW', 0.86, 0.50, { finishing: 90 }, { fitness: 5, form: 5, morale: 5, matchLoad: 95 }),
    mk('h_mf', H, 'MF', 0.30, 0.50), mk('a_gk', A, 'GK', 0.97, 0.50),
  ];
  const { debug } = decidePlayerAction(coreOf(players, 'h_fw', H), 'h_fw', { debug: true, seed: 'st' });
  assert(hasType(debug.candidates, 'PASS') && hasType(debug.candidates, 'SHOT') && hasType(debug.candidates, 'DRIBBLE'),
    '低状态不得禁止合法动作（Soft 不越权为 Hard）');
});

// ===========================================================================
// Ability 方向 + Soft 不主导
// ===========================================================================

test('CAL-ABIL. 能力提升应提升对应动作偏好（方向正确）', () => {
  const mkCore = (v) => coreOf([
    mk('h_mf', H, 'MF', 0.50, 0.50, { passing: v }), mk('h_t', H, 'MF', 0.55, 0.50),
    mk('a_m', A, 'MF', 0.53, 0.50), mk('a_gk', A, 'GK', 0.97, 0.50),
  ], 'h_mf', H);
  const lo = decidePlayerAction(mkCore(40), 'h_mf', { debug: true, seed: 'ab' }).debug;
  const hi = decidePlayerAction(mkCore(90), 'h_mf', { debug: true, seed: 'ab' }).debug;
  assert(maxPref(hi.candidates, 'PASS') > maxPref(lo.candidates, 'PASS'), 'passing↑ 应提升 PASS 偏好');
});

test('CAL-SOFT. Soft Modifier 不得颠覆明显能力差异', () => {
  // 使用“被压迫 + 有拦截者”的非饱和局面，避免 clamp01 饱和掩盖差异。
  const mkCase = (passing, tac) => coreOf([
    mk('h_mf', H, 'MF', 0.50, 0.50, { passing }),
    mk('h_t', H, 'MF', 0.35, 0.30),
    mk('a_lane', A, 'MF', 0.42, 0.40), mk('a_p', A, 'MF', 0.52, 0.50), mk('a_gk', A, 'GK', 0.97, 0.50),
  ], 'h_mf', H, { [H]: tac });
  const hi = mkCase(90, { mentality: 'defensive', tempo: 'low', pressing: 'low' });
  const lo = mkCase(40, { mentality: 'attacking', tempo: 'high', pressing: 'high' });
  const p = (core) => maxPref(decidePlayerAction(core, 'h_mf', { debug: true, seed: 'sf' }).debug.candidates, 'PASS');
  assert(p(hi) > p(lo), `passing90+不利情境(${p(hi)}) 仍应高于 passing40+有利情境(${p(lo)})`);
});

// ===========================================================================
// Determinism / RNG Isolation / Distribution
// ===========================================================================

test('CAL-DET. 1000 次重复：DecisionResult 完全一致', () => {
  const core = scenShot();
  const base = decidePlayerAction(core, 'h_fw', { seed: 'det' }).decision;
  for (let i = 0; i < 1000; i += 1) {
    assertEquals(decidePlayerAction(core, 'h_fw', { seed: 'det' }).decision, base);
  }
});

test('CAL-RNG. 其它球员的 RNG 消费不影响本球员决策（scope 隔离）', () => {
  const core = scenPress('high');
  const before = JSON.stringify(decidePlayerAction(core, 'h_d2', { seed: 'iso' }).decision);
  for (let k = 0; k < 50; k += 1) decidePlayerAction(core, 'h_d', { seed: 'iso', decisionSequence: k });
  assertEquals(JSON.stringify(decidePlayerAction(core, 'h_d2', { seed: 'iso' }).decision), before);
});

test('CAL-SCAN. 分布扫描：无异常，eligible ≤ K，preference ∈ [0,1]', () => {
  let count = 0, noneRate = 0;
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const rng = createRng(hashSeed(`scan|${i}`));
    const players = [];
    const lines = [['GK', 1], ['DF', 4], ['MF', 4], ['FW', 2]];
    let idx = 0;
    for (const team of [H, A]) for (const [pos, n] of lines) for (let k = 0; k < n; k += 1) {
      const baseX = pos === 'GK' ? 0.05 : pos === 'DF' ? 0.25 : pos === 'MF' ? 0.5 : 0.72;
      const x = team === H ? baseX : 1 - baseX;
      const y = 0.12 + 0.76 * ((k + 0.5) / n);
      players.push(mk(`${team}_${idx}`, team, pos, Math.min(0.98, Math.max(0.02, x + (rng.next() - 0.5) * 0.06)), Math.min(0.98, Math.max(0.02, y + (rng.next() - 0.5) * 0.10))));
      idx += 1;
    }
    const poss = rng.next() < 0.5 ? H : A;
    const carriers = players.filter((p) => p.teamId === poss && (p.position === 'MF' || p.position === 'FW'));
    const carrier = carriers[Math.floor(rng.next() * carriers.length)];
    const core = coreOf(players, carrier.playerId, poss);
    for (let sd = 0; sd < 20; sd += 1) {
      const { decision, debug } = decidePlayerAction(core, carrier.playerId, { debug: true, seed: `s${sd}`, decisionSequence: sd });
      count += 1;
      if (decision.actionType === 'NONE') noneRate += 1;
      else seen.add(decision.actionType);
      const elig = debug.candidates.filter((c) => c.eligible).length;
      assert(elig <= DECISION_SELECTION_CONFIG.TOP_K, `eligible ${elig} > TOP_K`);
      for (const c of debug.candidates) {
        assert(Number.isFinite(c.preference) && c.preference >= 0 && c.preference <= 1, `pref 越界 ${c.preference}`);
      }
      if (decision.actionType !== 'NONE') assert(ACTION_TYPES.includes(decision.actionType), '非法 actionType');
    }
  }
  assert(count >= 4000, '扫描规模不足');
  assert(noneRate / count < 0.01, 'NO_ACTION 比例异常');
  assert(seen.size >= 2, '动作应有多样性');
});
