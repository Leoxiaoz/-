/**
 * Step 39F-M-B-IMPLEMENTATION-01 —— Player Decision Foundation 测试。
 *
 * 覆盖：PlayerSituation / Action Registry / Availability / Candidate / Hard Constraint /
 * Validity / Preference / Top-K / Preference Band / Decision RNG / Selection /
 * DecisionResult / ActionInstance / Commitment / PRESS / GK 边界 / Debug / Determinism /
 * 无 Math.random / 无 MatchCore mutation / 无副作用 / 无死循环 / 无非法目标 / fallback。
 *
 * 红线：不触 Growth/Training/Development；不改 MatchCore；不改 Save/Schema。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import {
  decidePlayerAction,
} from '../src/core/match/decision-pipeline.js';
import { buildPlayerSituation, dist } from '../src/core/match/player-situation.js';
import { ACTION_TYPES, ACTION_NONE, DECISION_SELECTION_CONFIG } from '../src/core/match/decision-config.js';
import {
  ACTION_DEFINITIONS, TARGET_SEMANTICS,
} from '../src/core/match/action-definitions.js';
import {
  createActionRegistry, validateActionDefinition, DEFAULT_ACTION_REGISTRY,
} from '../src/core/match/action-registry.js';
import { generateCandidates, isTargetValid } from '../src/core/match/decision-candidates.js';
import { evaluateEligibility, selectAction, selectEligible } from '../src/core/match/decision-selection.js';
import { buildDecisionScope, createDecisionRng } from '../src/core/match/decision-rng.js';
import { REJECTION_REASONS } from '../src/core/match/decision-debug.js';

// ---------------------------------------------------------------------------
// Fixture：可控 MatchCore-like 状态
// ---------------------------------------------------------------------------

const ATTRS = (v) => ({ pace: v, technique: v, passing: v, defending: v, finishing: v, goalkeeping: v });

function player(playerId, teamId, position, x, y, extra = {}) {
  return {
    playerId, teamId, position, positionOnPitch: { x, y },
    onPitch: true, injured: false, sentOff: false,
    attributes: ATTRS(extra.attr ?? 70),
    fitness: extra.fitness ?? 100, form: extra.form ?? 50, morale: extra.morale ?? 50, matchLoad: extra.matchLoad ?? 0,
    ...extra.overrides,
  };
}

const H = 'clb_h', A = 'clb_a';

function basePlayers() {
  return [
    player('h_gk', H, 'GK', 0.05, 0.5),
    player('h_df1', H, 'DF', 0.20, 0.30),
    player('h_mf1', H, 'MF', 0.50, 0.50),
    player('h_fw1', H, 'FW', 0.65, 0.50),
    player('a_gk', A, 'GK', 0.95, 0.5),
    player('a_df1', A, 'DF', 0.75, 0.50),
    player('a_mf1', A, 'MF', 0.55, 0.50),
    player('a_fw1', A, 'FW', 0.35, 0.50),
  ];
}

function mkCore({ ballControl = 'h_mf1', possessingTeamId = H, players = basePlayers(), extra = {} } = {}) {
  const bp = players.find((p) => p.playerId === ballControl);
  const ballPos = bp ? { ...bp.positionOnPitch } : { x: 0.5, y: 0.5 };
  return {
    worldId: 'w_test', season: 1, matchId: 'm_1', ruleVersion: 'match-decision-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 0, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball: { position: ballPos, control: ballControl, possessingTeamId },
    players,
    tactical: {
      [H]: { formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' },
      [A]: { formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' },
    },
    ...extra,
  };
}

// ===========================================================================
// PlayerSituation
// ===========================================================================

test('MDB-01. buildPlayerSituation：未知球员返回 null', () => {
  assertEquals(buildPlayerSituation(mkCore(), 'nobody'), null);
});

test('MDB-02. PlayerSituation 为只读快照，不引用 MatchCore', () => {
  const core = mkCore();
  const s = buildPlayerSituation(core, 'h_mf1');
  assert(s !== null);
  assert(!('matchCore' in s), '不得暴露 matchCore 引用');
  assert(!('_state' in s), '不得暴露 _state 引用');
  assertEquals(s.ownState.hasBall, true);
  assertEquals(s.matchContext.phase, 'ATTACK');
  // 修改快照不得影响 core
  s.ballState.position.x = 999;
  assertEquals(core.ball.position.x, 0.50);
  assert(dist({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }) === 0);
});

test('MDB-03. PlayerSituation：无球时 hasBall=false 且 phase=DEFENSE', () => {
  const s = buildPlayerSituation(mkCore({ ballControl: 'a_mf1', possessingTeamId: A }), 'h_mf1');
  assertEquals(s.ownState.hasBall, false);
  assertEquals(s.matchContext.phase, 'DEFENSE');
});

// ===========================================================================
// Action Registry
// ===========================================================================

test('MDB-04. Registry：六个 MVP Action 已注册且可查询', () => {
  assertEquals(DEFAULT_ACTION_REGISTRY.list(), [...ACTION_TYPES].sort());
  for (const t of ACTION_TYPES) {
    const def = DEFAULT_ACTION_REGISTRY.get(t);
    assert(def !== null, `${t} 未注册`);
    assertEquals(def.type, t);
    assertEquals(def.resolutionHandler, null, '分辨率处理器本阶段必须是占位 null');
  }
});

test('MDB-05. Registry：ActionDefinition 字段完整', () => {
  for (const t of ACTION_TYPES) {
    assertEquals(validateActionDefinition(ACTION_DEFINITIONS[t]), []);
  }
  assert(validateActionDefinition({}).length > 0);
  assert(validateActionDefinition({ type: 'X' }).length > 0);
});

test('MDB-06. Registry：重复注册与非法定义被拒绝', () => {
  const r = createActionRegistry();
  r.register(ACTION_DEFINITIONS.MOVE);
  assertThrows(() => r.register(ACTION_DEFINITIONS.MOVE), undefined, '重复注册应抛错');
  assertThrows(() => createActionRegistry([{ type: 'BAD' }]), undefined, '非法定义应抛错');
});

test('MDB-07. Registry：targetSemantics 覆盖四类', () => {
  const got = new Set(ACTION_TYPES.map((t) => ACTION_DEFINITIONS[t].targetSemantics));
  for (const v of Object.values(TARGET_SEMANTICS)) assert(got.has(v), `缺少 targetSemantics ${v}`);
});

// ===========================================================================
// Availability / Candidate / Hard Constraint / Validity
// ===========================================================================

test('MDB-08. 有球：PASS/DRIBBLE/SHOT/MOVE 有候选；PRESS/TACKLE 被 ACTION_UNAVAILABLE 淘汰', () => {
  const s = buildPlayerSituation(mkCore(), 'h_mf1');
  const { candidates, rejected } = generateCandidates(s, DEFAULT_ACTION_REGISTRY);
  const types = new Set(candidates.map((c) => c.actionType));
  assert(types.has('PASS')); assert(types.has('DRIBBLE')); assert(types.has('SHOT')); assert(types.has('MOVE'));
  assert(!types.has('PRESS')); assert(!types.has('TACKLE'));
  for (const t of ['PRESS', 'TACKLE']) {
    assert(rejected.some((r) => r.actionType === t && r.reason === REJECTION_REASONS.ACTION_UNAVAILABLE), `${t} 应被淘汰`);
  }
});

test('MDB-09. 无球：PASS/DRIBBLE/SHOT 被 ACTION_UNAVAILABLE；PRESS/TACKLE/MOVE 有候选', () => {
  const s = buildPlayerSituation(mkCore({ ballControl: 'a_mf1', possessingTeamId: A }), 'h_mf1');
  const { candidates, rejected } = generateCandidates(s, DEFAULT_ACTION_REGISTRY);
  const types = new Set(candidates.map((c) => c.actionType));
  assert(types.has('PRESS')); assert(types.has('TACKLE')); assert(types.has('MOVE'));
  assert(!types.has('PASS')); assert(!types.has('DRIBBLE')); assert(!types.has('SHOT'));
  for (const t of ['PASS', 'DRIBBLE', 'SHOT']) {
    assert(rejected.some((r) => r.actionType === t && r.reason === REJECTION_REASONS.ACTION_UNAVAILABLE), `${t} 应被淘汰`);
  }
});

test('MDB-10. 无合法队友（超出传球距离）→ PASS 被 NO_TARGET 淘汰', () => {
  const players = basePlayers().map((p) => (p.teamId === H && p.playerId !== 'h_mf1'
    ? { ...p, positionOnPitch: { x: 0.0, y: 0.0 } } : p)); // 队友全部贴到 0,0（超出 0.6）
  const s = buildPlayerSituation(mkCore({ players }), 'h_mf1');
  const { candidates, rejected } = generateCandidates(s, DEFAULT_ACTION_REGISTRY);
  assert(!candidates.some((c) => c.actionType === 'PASS'));
  assert(rejected.some((r) => r.actionType === 'PASS' && r.reason === REJECTION_REASONS.NO_TARGET));
});

test('MDB-11. Target 语义正确：PASS→队友 / PRESS→对手 / SHOT→GOAL_AREA', () => {
  const onBall = buildPlayerSituation(mkCore(), 'h_mf1');
  const { candidates } = generateCandidates(onBall, DEFAULT_ACTION_REGISTRY);
  const pass = candidates.find((c) => c.actionType === 'PASS');
  assert(onBall.teammates.some((t) => t.playerId === pass.target.playerId));
  const shot = candidates.find((c) => c.actionType === 'SHOT');
  assertEquals(shot.target.type, 'GOAL_AREA');

  const offBall = buildPlayerSituation(mkCore({ ballControl: 'a_mf1', possessingTeamId: A }), 'h_mf1');
  const r2 = generateCandidates(offBall, DEFAULT_ACTION_REGISTRY);
  const press = r2.candidates.find((c) => c.actionType === 'PRESS');
  assert(offBall.opponents.some((o) => o.playerId === press.target.playerId));
});

test('MDB-12. Situation Validity：非法 target 判定为无效', () => {
  const s = buildPlayerSituation(mkCore(), 'h_mf1');
  assert(!isTargetValid({ actionType: 'PASS', target: { type: 'TEAMMATE', playerId: 'ghost' } }, s));
  assert(!isTargetValid({ actionType: 'PASS', target: { type: 'TEAMMATE', playerId: 'a_gk' } }, s), '对手不能作为传球目标');
  assert(!isTargetValid({ actionType: 'MOVE', target: { type: 'SPACE', x: 2, y: 0 } }, s));
  assert(isTargetValid({ actionType: 'PASS', target: { type: 'TEAMMATE', playerId: 'h_fw1' } }, s));
});

test('MDB-13. 候选数量受控（不超过上限）', () => {
  const s = buildPlayerSituation(mkCore(), 'h_mf1');
  const { candidates } = generateCandidates(s, DEFAULT_ACTION_REGISTRY);
  const count = {};
  for (const c of candidates) count[c.actionType] = (count[c.actionType] ?? 0) + 1;
  for (const [k, v] of Object.entries(count)) assert(v <= 5, `${k} 候选过多: ${v}`);
});

// ===========================================================================
// Preference
// ===========================================================================

test('MDB-14. Preference 为 [0,1]，且 no-NaN', () => {
  const { debug } = decidePlayerAction(mkCore(), 'h_mf1', { debug: true });
  assert(debug.candidates.length > 0);
  for (const c of debug.candidates) {
    assert(Number.isFinite(c.preference) && c.preference >= 0 && c.preference <= 1, `pref 越界: ${c.preference}`);
  }
});

test('MDB-15. Preference action-specific：不同动作偏好不同', () => {
  const { debug } = decidePlayerAction(mkCore(), 'h_mf1', { debug: true });
  const prefs = new Set(debug.candidates.map((c) => c.preference));
  assert(prefs.size >= 2, '不同动作应产生不同偏好');
});

// ===========================================================================
// Top-K / Preference Band / Eligibility
// ===========================================================================

test('MDB-16. Eligibility：Top-K 生效', () => {
  const cands = [
    { actionType: 'PASS', target: { type: 'SPACE', x: 0.1, y: 0.1 }, preference: 0.9 },
    { actionType: 'SHOT', target: { type: 'GOAL_AREA', zone: 'CENTER' }, preference: 0.8 },
    { actionType: 'MOVE', target: { type: 'SPACE', x: 0.2, y: 0.2 }, preference: 0.7 },
    { actionType: 'DRIBBLE', target: { type: 'SPACE', x: 0.3, y: 0.3 }, preference: 0.6 },
  ];
  const { eligible } = evaluateEligibility(cands, { TOP_K: 2, PREFERENCE_BAND: 1 });
  assert(eligible.every((c) => c.preference >= 0.8), '仅 Top-2 可进入');
});

test('MDB-17. Eligibility：Preference Band 生效', () => {
  const cands = [
    { actionType: 'PASS', target: { type: 'SPACE', x: 0.1, y: 0.1 }, preference: 0.90 },
    { actionType: 'MOVE', target: { type: 'SPACE', x: 0.2, y: 0.2 }, preference: 0.50 },
  ];
  const { eligible } = evaluateEligibility(cands, { TOP_K: 5, PREFERENCE_BAND: 0.2 });
  assertEquals(eligible.length, 1);
  assertEquals(eligible[0].preference, 0.90);
});

test('MDB-18. Eligibility：Top-K ∧ Band 为 AND（Top-K 内但超 Band 也淘汰；Band 内但非 Top-K 也淘汰）', () => {
  const cands = [
    { actionType: 'PASS', target: { type: 'SPACE', x: 0.1, y: 0.1 }, preference: 0.95 },
    { actionType: 'SHOT', target: { type: 'GOAL_AREA', zone: 'CENTER' }, preference: 0.80 },
    { actionType: 'MOVE', target: { type: 'SPACE', x: 0.2, y: 0.2 }, preference: 0.78 },
  ];
  const { annotated } = evaluateEligibility(cands, { TOP_K: 2, PREFERENCE_BAND: 0.10 });
  const shot = annotated.find((c) => c.actionType === 'SHOT');
  const move = annotated.find((c) => c.actionType === 'MOVE');
  // SHOT 在 Top-2 内，但 0.95-0.80=0.15 > 0.10 → 超 Band
  assert(shot.eligible === false && shot.rejectionReason === REJECTION_REASONS.OUTSIDE_PREFERENCE_BAND);
  // MOVE 在 Band 内(0.95-0.78=0.17>0.10 实际超) → 用非 Top-K 校验
  const cands2 = [
    { actionType: 'PASS', target: { type: 'SPACE', x: 0.1, y: 0.1 }, preference: 0.95 },
    { actionType: 'MOVE', target: { type: 'SPACE', x: 0.2, y: 0.2 }, preference: 0.90 },
    { actionType: 'SHOT', target: { type: 'GOAL_AREA', zone: 'CENTER' }, preference: 0.89 },
  ];
  const r2 = evaluateEligibility(cands2, { TOP_K: 2, PREFERENCE_BAND: 0.20 });
  const shot2 = r2.annotated.find((c) => c.actionType === 'SHOT');
  assert(shot2.eligible === false && shot2.rejectionReason === REJECTION_REASONS.OUTSIDE_TOP_K, '非 Top-K 即使 Band 内也淘汰');
  assert(move === move); // 占位引用，避免未使用告警
});

test('MDB-19. Best Candidate 永远可进入 Eligible Set', () => {
  const cands = [
    { actionType: 'PASS', target: { type: 'SPACE', x: 0.1, y: 0.1 }, preference: 0.4 },
    { actionType: 'MOVE', target: { type: 'SPACE', x: 0.2, y: 0.2 }, preference: 0.9 },
  ];
  const { eligible } = evaluateEligibility(cands, { TOP_K: 1, PREFERENCE_BAND: 0.01 });
  assertEquals(eligible.length, 1);
  assertEquals(eligible[0].preference, 0.9);
});

// ===========================================================================
// Decision RNG / Selection / Fallback
// ===========================================================================

test('MDB-20. Decision RNG：同 scope → 完全相同序列；不同 scope → 允许不同', () => {
  const core = mkCore();
  const sc1 = buildDecisionScope(core, 'h_mf1', 0, 'seedX');
  const sc2 = buildDecisionScope(core, 'h_mf1', 0, 'seedX');
  const sc3 = buildDecisionScope(core, 'h_mf1', 0, 'seedY');
  assertEquals(sc1, sc2);
  assert(sc1 !== sc3);
  const r1 = createDecisionRng(sc1); const r2 = createDecisionRng(sc2);
  for (let i = 0; i < 5; i += 1) assert(r1.next() === r2.next());
});

test('MDB-21. Selection：单 eligible → 与 seed 无关（不消费 RNG）', () => {
  const eligible = [{ actionType: 'PASS', target: { type: 'SPACE', x: 0.1, y: 0.1 }, preference: 0.5 }];
  assertEquals(selectEligible(eligible, { next: () => 0.0 }), eligible[0]);
  assertEquals(selectEligible(eligible, { next: () => 0.999 }), eligible[0]);
});

test('MDB-22. Selection：Eligible 空 → fallback 最高偏好；无候选 → NO_VALID_ACTION', () => {
  const rng = { next: () => 0.5 };
  const empty = selectAction([], rng);
  assertEquals(empty.selected, null);
  assertEquals(empty.selectionReason, 'NO_VALID_ACTION');
  // 只有一个候选（best 必 eligible）
  const one = selectAction([{ actionType: 'MOVE', target: { type: 'SPACE', x: 0.1, y: 0.1 }, preference: 0.3 }], rng);
  assertEquals(one.selected.actionType, 'MOVE');
});

// ===========================================================================
// DecisionResult / ActionInstance / Commitment
// ===========================================================================

test('MDB-23. DecisionResult 字段：无成功率/xG/teamStrength/overallRating', () => {
  const { decision } = decidePlayerAction(mkCore(), 'h_mf1');
  assert(ACTION_TYPES.includes(decision.actionType), '应为合法 actionType');
  for (const bad of ['successChance', 'goalProbability', 'xG', 'teamStrength', 'overallRating', 'playerPower']) {
    assert(!(bad in decision), `DecisionResult 不得包含 ${bad}`);
  }
  assert('riskIntent' in decision && 'commitment' in decision && 'target' in decision);
});

test('MDB-24. ActionInstance 与 DecisionResult 一致性；不越界到 Resolution', () => {
  const { decision, actionInstance } = decidePlayerAction(mkCore(), 'h_mf1');
  assertEquals(actionInstance.actionType, decision.actionType);
  assertEquals(actionInstance.actorId, decision.playerId);
  assertEquals(actionInstance.target, decision.target);
  for (const bad of ['result', 'event', 'outcome', 'success']) assert(!(bad in actionInstance));
});

test('MDB-25. Commitment 语义正确', () => {
  const pass = ACTION_DEFINITIONS.PASS.commitmentPolicy.type;
  const shot = ACTION_DEFINITIONS.SHOT.commitmentPolicy.type;
  const dribble = ACTION_DEFINITIONS.DRIBBLE.commitmentPolicy.type;
  const move = ACTION_DEFINITIONS.MOVE.commitmentPolicy.type;
  const press = ACTION_DEFINITIONS.PRESS.commitmentPolicy.type;
  const tackle = ACTION_DEFINITIONS.TACKLE.commitmentPolicy.type;
  assertEquals(pass, 'COMMITTED');
  assertEquals(shot, 'COMMITTED');
  assertEquals(dribble, 'COMMITTED_STEERABLE');
  assertEquals(move, 'CONTINUOUS_INTERRUPTIBLE');
  assertEquals(press, 'INTERRUPTIBLE_CONTINUOUS');
  assertEquals(tackle, 'COMMITTED');
  assertEquals(ACTION_DEFINITIONS.PRESS.commitmentPolicy.duration, null);
});

// ===========================================================================
// PRESS / GK 边界
// ===========================================================================

test('MDB-26. PRESS 语义：只产生 PRESS 候选，不产生 TACKLE/INTERCEPT/Event', () => {
  const s = buildPlayerSituation(mkCore({ ballControl: 'a_mf1', possessingTeamId: A }), 'h_mf1');
  const { candidates } = generateCandidates(s, DEFAULT_ACTION_REGISTRY);
  assert(candidates.some((c) => c.actionType === 'PRESS'));
  for (const c of candidates) {
    assert(ACTION_TYPES.includes(c.actionType), '候选只能是 6 个 MVP Action');
  }
  const { actionInstance } = decidePlayerAction(mkCore({ ballControl: 'a_mf1', possessingTeamId: A }), 'h_mf1');
  assert(ACTION_TYPES.includes(actionInstance.actionType));
  assert(!('intercept' in actionInstance) && !('event' in actionInstance));
});

test('MDB-27. GK 边界：无 SAVE Action Type，GK 复用通用 Decision', () => {
  assert(!ACTION_TYPES.includes('SAVE'));
  assert(!ACTION_TYPES.includes('INTERCEPT'));
  assert(!ACTION_TYPES.includes('BLOCK'));
  const { actionInstance } = decidePlayerAction(mkCore({ ballControl: 'h_gk', possessingTeamId: H }), 'h_gk');
  assert(ACTION_TYPES.includes(actionInstance.actionType), 'GK 应复用同一 Decision Framework');
});

// ===========================================================================
// Debug
// ===========================================================================

test('MDB-28. Debug 默认关闭；开启时提供候选与拒绝原因', () => {
  assertEquals(decidePlayerAction(mkCore(), 'h_mf1').debug, null);
  const { debug } = decidePlayerAction(mkCore(), 'h_mf1', { debug: true });
  assert(debug.situation !== null);
  assert(Array.isArray(debug.candidates) && debug.candidates.length > 0);
  assert(Array.isArray(debug.rejected));
  assert(debug.selected !== null);
  assert(typeof debug.selectionReason === 'string');
  // 拒绝原因必须是白名单
  const allowed = new Set(Object.values(REJECTION_REASONS));
  for (const r of debug.rejected) assert(allowed.has(r.reason), `非法 rejection reason: ${r.reason}`);
});

// ===========================================================================
// Determinism / No mutation / Fallback
// ===========================================================================

test('MDB-29. Determinism：同输入 → 完全相同 DecisionResult', () => {
  const core = mkCore();
  const a = decidePlayerAction(core, 'h_mf1');
  const b = decidePlayerAction(mkCore(), 'h_mf1');
  assertEquals(a.decision, b.decision);
  assertEquals(a.actionInstance, b.actionInstance);
});

test('MDB-30. 无 MatchCore mutation', () => {
  const core = mkCore();
  const before = JSON.stringify(core);
  decidePlayerAction(core, 'h_mf1', { debug: true });
  decidePlayerAction(core, 'h_gk');
  decidePlayerAction(core, 'a_mf1');
  assertEquals(JSON.stringify(core), before, 'MatchCore 被修改');
});

test('MDB-31. Fallback：不可用球员 → NONE / PLAYER_UNAVAILABLE', () => {
  const players = basePlayers().map((p) => (p.playerId === 'h_mf1' ? { ...p, injured: true } : p));
  const { decision, actionInstance } = decidePlayerAction(mkCore({ players }), 'h_mf1');
  assertEquals(decision.actionType, ACTION_NONE);
  assertEquals(actionInstance, null);
  const { decision: d2 } = decidePlayerAction(mkCore(), 'ghost');
  assertEquals(d2.actionType, ACTION_NONE);
});

test('MDB-32. 无死循环 / 一次决策即返回（含 debug 路径）', () => {
  for (const id of ['h_gk', 'h_df1', 'h_mf1', 'h_fw1', 'a_mf1']) {
    const r = decidePlayerAction(mkCore(), id, { debug: true });
    assert(r && r.decision, `${id} 未返回决策`);
  }
});

test('MDB-33. 候选目标全部有效（无非法 target 进入候选）', () => {
  const { debug } = decidePlayerAction(mkCore(), 'h_mf1', { debug: true });
  const s = buildPlayerSituation(mkCore(), 'h_mf1');
  for (const c of debug.candidates) {
    assert(isTargetValid(c, s), `非法 target 进入候选: ${JSON.stringify(c.target)}`);
  }
});

test('MDB-34. 只经 Registry 驱动：自定义 Registry 生效', () => {
  const only = createActionRegistry([ACTION_DEFINITIONS.MOVE]);
  const { debug } = decidePlayerAction(mkCore(), 'h_mf1', { debug: true, registry: only });
  assert(debug.candidates.every((c) => c.actionType === 'MOVE'));
  assertEquals(only.list(), ['MOVE']);
});

test('MDB-35. Selection 配置可确定性驱动（K/Band 生效于集成路径）', () => {
  const narrow = decidePlayerAction(mkCore(), 'h_mf1', { debug: true, selectionConfig: { TOP_K: 1, PREFERENCE_BAND: 0 } });
  assertEquals(narrow.debug.candidates.filter((c) => c.eligible).length, 1);
});
