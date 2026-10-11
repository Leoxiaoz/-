/**
 * Step 39F-M-C-09 —— Resolution Calibration Foundation 测试。
 *
 * 覆盖：
 * - Calibration Profile 合法性（概率 / ratio / weight / range / minScore / NaN·Infinity / unknown）；
 * - 单一 Calibration Truth（config 由 profile 派生；参数语义规格与 profile 完全对应）；
 * - deterministic（相同输入 + profile = 相同结果；CAL-DET-01）；
 * - Override（default / override 互不污染；CAL-OVERRIDE-01）；
 * - Behavior Lock（迁移前后默认行为一致；CAL-LOCK-01..06）；
 * - Calibration metadata 不进入 MatchCore Truth；
 * - TBD-CAL profile 仍可运行；
 * - Math.random / wall-clock / 隐藏 mutable state 源码守卫。
 *
 * 红线：不接 Production Loop / Renderer；不改 Save / Schema；不改 Resolution 公式结构。
 */

import { test, assert, assertEquals, assertThrows } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DEFAULT_CALIBRATION_PROFILE, RESOLUTION_CALIBRATION_VERSION,
  assertValidCalibrationConfig, resolveCalibrationProfile,
  CALIBRATION_PARAM_SPECS, CALIBRATION_STATUS,
} from '../src/core/match/resolution-calibration.js';
import {
  INTERACTION_RESOLUTION_CONFIG, buildInteractionResolutionConfig,
  DRIBBLE_OUTCOMES, TACKLE_OUTCOMES, PRESS_OUTCOMES, INTERCEPTION_OUTCOMES,
  INTERACTION_BALL_STATE as BS,
} from '../src/core/match/interaction-resolution-config.js';
import {
  SECOND_BALL_RESOLUTION_CONFIG, buildSecondBallResolutionConfig,
  SECOND_BALL_OUTCOMES,
} from '../src/core/match/second-ball-resolution-config.js';
import {
  resolveDribble, resolveTackle, resolvePress, resolveInterception,
} from '../src/core/match/interaction-resolution.js';
import { resolveSecondBall } from '../src/core/match/second-ball-resolution.js';
import { applyInteractionStateUpdate } from '../src/core/match/interaction-state-update.js';

const H = 'clb_h', A = 'clb_a';
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');

const CAL_FILES = [
  'resolution-calibration-config.js',
  'resolution-calibration.js',
  'interaction-resolution-config.js',
  'second-ball-resolution-config.js',
  'interaction-resolution.js',
  'second-ball-resolution.js',
];

/** 深拷贝默认 profile 并应用变更（生成 override；不改默认）。 */
function cloneProfile(mutate) {
  const p = JSON.parse(JSON.stringify(DEFAULT_CALIBRATION_PROFILE));
  if (mutate) mutate(p);
  return p;
}

// —— 夹具 ——
const ATTRS = (o = {}) => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...o });
function mk(id, t, pos, x, y, attrs = {}, extra = {}) {
  return {
    playerId: id, teamId: t, position: pos, positionOnPitch: { x, y },
    onPitch: true, injured: false, sentOff: false, attributes: ATTRS(attrs),
    fitness: 100, form: 50, morale: 50, matchLoad: 0, ...extra,
  };
}
const tac = () => ({ formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' });

function coreOf(players, { control = null, poss = null, ballPos = null, transit = null, state = null } = {}) {
  const carrier = players.find((p) => p.playerId === control);
  const bp = ballPos ?? (carrier?.positionOnPitch ?? { x: 0.5, y: 0.5 });
  const ball = { position: { ...bp }, control, possessingTeamId: poss };
  if (state) ball.state = state;
  if (transit) ball.transit = transit;
  return {
    worldId: 'w_cal', season: 1, matchId: 'm_cal', ruleVersion: 'match-interaction-resolution-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball, players,
    tactical: { [H]: tac(), [A]: tac() },
  };
}

const dribbleCore = () => coreOf([mk('h_a', H, 'MF', 0.40, 0.50, { technique: 99, pace: 99 })], { control: 'h_a', poss: H });
const dribbleInst = () => ({ actionType: 'DRIBBLE', actorId: 'h_a', intent: 'FORWARD', target: { type: 'SPACE', x: 0.52, y: 0.50 } });
const challengeCore = () => coreOf([
  mk('a_c', A, 'MF', 0.47, 0.50), mk('h_d', H, 'DF', 0.44, 0.50),
], { control: 'a_c', poss: A });
const tackleInst = () => ({ actionType: 'TACKLE', actorId: 'h_d', target: { type: 'OPPONENT', playerId: 'a_c' } });
const pressInst = () => ({ actionType: 'PRESS', actorId: 'h_d', target: { type: 'OPPONENT', playerId: 'a_c' } });
const interceptionCore = () => coreOf([
  mk('h_a', H, 'MF', 0.30, 0.50), mk('h_t', H, 'MF', 0.70, 0.50), mk('a_i', A, 'DF', 0.50, 0.50),
], {
  control: null, poss: null, ballPos: { x: 0.30, y: 0.50 },
  transit: { from: { x: 0.30, y: 0.50 }, to: { x: 0.70, y: 0.50 }, progress: 0.1, elapsed: 0.1, duration: 1, intendedTargetId: 'h_t', targetTeamId: H, actorId: 'h_a' },
});
const interceptInst = () => ({ actionType: 'INTERCEPTION', actorId: 'a_i', target: { type: 'BALL' } });

const freeCore = (players = [mk('h_a', H, 'MF', 0.48, 0.5)]) => coreOf(players, { state: BS.FREE });

// ===========================================================================
// Validation
// ===========================================================================

test('CAL-01. 默认 Calibration Config 合法', () => {
  assertValidCalibrationConfig(DEFAULT_CALIBRATION_PROFILE);
  assertEquals(resolveCalibrationProfile(null), DEFAULT_CALIBRATION_PROFILE);
  assertEquals(resolveCalibrationProfile(undefined), DEFAULT_CALIBRATION_PROFILE);
});

test('CAL-02. 概率范围验证：0 ≤ p ≤ 1（越界拒绝）', () => {
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { p.interaction.dribble.BASE_SUCCESS = 1.2; })));
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { p.interaction.dribble.BASE_SUCCESS = -0.1; })));
  assertValidCalibrationConfig(cloneProfile((p) => { p.interaction.dribble.BASE_SUCCESS = 1; }));
  assertValidCalibrationConfig(cloneProfile((p) => { p.interaction.dribble.BASE_SUCCESS = 0; }));
});

test('CAL-03. weight 验证：不得为负、0 允许、不要求归一化', () => {
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { p.interaction.dribble.TECHNIQUE_WEIGHT = -0.01; })));
  assertValidCalibrationConfig(cloneProfile((p) => { p.interaction.dribble.TECHNIQUE_WEIGHT = 0; }));
  // 权重和不为 1 也合法（明确不要求归一化）。
  assertValidCalibrationConfig(cloneProfile((p) => { p.secondBall.PROXIMITY_WEIGHT = 0.9; p.secondBall.CLOSING_WEIGHT = 0.9; }));
});

test('CAL-04. range 验证：必须 > 0', () => {
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { p.secondBall.RANGE = 0; })));
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { p.secondBall.RANGE = -0.1; })));
  assertValidCalibrationConfig(cloneProfile((p) => { p.secondBall.RANGE = 0.5; }));
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { p.secondBall.CLOSING_SPEED_NORM = 0; })));
});

test('CAL-05. NaN / Infinity 一律拒绝', () => {
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { p.interaction.press.BASE_SUCCESS = NaN; })));
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { p.secondBall.MIN_SCORE = Infinity; })));
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { p.secondBall.CLOSING_SPEED_NORM = -Infinity; })));
});

test('CAL-06. unknown parameter / 缺失 / 未知 discipline 拒绝', () => {
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { p.interaction.dribble.UNKNOWN_PARAM = 0.5; })));
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { delete p.interaction.tackle.LOOSE_RATIO; })));
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { p.interaction.foul = {}; })));
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { p.extraTop = 1; })));
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { delete p.secondBall.CONTEXT_WEIGHT; })));
});

test('CAL-07. Calibration Version 存在且合法', () => {
  assert(typeof RESOLUTION_CALIBRATION_VERSION === 'string' && RESOLUTION_CALIBRATION_VERSION.length > 0);
  assertEquals(DEFAULT_CALIBRATION_PROFILE.calibrationVersion, RESOLUTION_CALIBRATION_VERSION);
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { p.calibrationVersion = ''; })));
  assertThrows(() => assertValidCalibrationConfig(cloneProfile((p) => { delete p.calibrationVersion; })));
});

test('CAL-SEM-01. 参数语义规格与默认 profile 完全对应（单一语义来源）', () => {
  // interaction
  for (const d of Object.keys(CALIBRATION_PARAM_SPECS.interaction)) {
    const specKeys = Object.keys(CALIBRATION_PARAM_SPECS.interaction[d]).sort();
    const profKeys = Object.keys(DEFAULT_CALIBRATION_PROFILE.interaction[d]).sort();
    assertEquals(profKeys, specKeys, `interaction.${d} 规格与 profile 不一致`);
    for (const k of specKeys) {
      assert(CALIBRATION_PARAM_SPECS.interaction[d][k].kind, `${d}.${k} 缺少 kind`);
      assert(CALIBRATION_PARAM_SPECS.interaction[d][k].note, `${d}.${k} 缺少语义说明`);
    }
  }
  // secondBall
  assertEquals(Object.keys(DEFAULT_CALIBRATION_PROFILE.secondBall).sort(), Object.keys(CALIBRATION_PARAM_SPECS.secondBall).sort());
});

// ===========================================================================
// Deterministic
// ===========================================================================

test('CAL-DET-01. 相同输入 + profile → 相同 Interaction 结果（JSON 完全一致）', () => {
  const a = resolveDribble(dribbleInst(), dribbleCore(), { seed: 'cal' });
  const b = resolveDribble(dribbleInst(), dribbleCore(), { seed: 'cal' });
  assert(JSON.stringify(a) === JSON.stringify(b), 'CAL-DET-01 要求 JSON.stringify(result1) === JSON.stringify(result2)');
});

test('CAL-08. 默认 profile deterministic（Interaction + Second-Ball + Config）', () => {
  const i1 = resolveTackle(tackleInst(), challengeCore(), { seed: 's' });
  const i2 = resolveTackle(tackleInst(), challengeCore(), { seed: 's' });
  assertEquals(JSON.stringify(i1), JSON.stringify(i2));
  const s1 = resolveSecondBall(freeCore());
  const s2 = resolveSecondBall(freeCore());
  assertEquals(JSON.stringify(s1), JSON.stringify(s2));
  assertEquals(JSON.stringify(DEFAULT_CALIBRATION_PROFILE), JSON.stringify(DEFAULT_CALIBRATION_PROFILE));
});

// ===========================================================================
// Override
// ===========================================================================

test('CAL-09 / CAL-OVERRIDE-01. Override 可改变结果但不污染 default', () => {
  const inst = dribbleInst();
  const core = dribbleCore();
  const before = JSON.stringify(DEFAULT_CALIBRATION_PROFILE);
  const cfgBefore = JSON.stringify(INTERACTION_RESOLUTION_CONFIG);

  const A1 = resolveDribble(inst, core, { seed: 'x' });
  // override：成功概率强制 0 → 一定不 COMPLETED。
  const zero = cloneProfile((p) => { p.interaction.dribble.BASE_SUCCESS = 0; p.interaction.dribble.TECHNIQUE_WEIGHT = 0; p.interaction.dribble.PACE_WEIGHT = 0; p.interaction.dribble.FREE_SPACE_BONUS = 0; });
  const B = resolveDribble(inst, core, { seed: 'x', calibrationProfile: zero });
  const A2 = resolveDribble(inst, core, { seed: 'x' });

  assert(A1.outcome === DRIBBLE_OUTCOMES.COMPLETED, '默认 profile 该夹具应为成功');
  assert(B.outcome !== DRIBBLE_OUTCOMES.COMPLETED, 'override BASE_SUCCESS=0 应改变结果');
  assertEquals(JSON.stringify(A1), JSON.stringify(A2), 'override 不得污染 default（首尾 A 必须一致）');
  assertEquals(JSON.stringify(DEFAULT_CALIBRATION_PROFILE), before, 'override 不得修改默认 profile');
  assertEquals(JSON.stringify(INTERACTION_RESOLUTION_CONFIG), cfgBefore, 'override 不得修改派生默认 config');
  assertEquals(A1.resolutionMeta.calibrationVersion, RESOLUTION_CALIBRATION_VERSION);
  assertEquals(B.resolutionMeta.calibrationVersion, zero.calibrationVersion);
});

// ===========================================================================
// Behavior Lock（迁移前后默认行为一致）
// ===========================================================================

// 迁移前 C-05/C-07 的 TBD-CAL 基线值（原分散配置的权威数值）。
const BASELINE_INTERACTION = Object.freeze({
  DRIBBLE_BASE_SUCCESS: 0.60, DRIBBLE_TECHNIQUE_WEIGHT: 0.22, DRIBBLE_PACE_WEIGHT: 0.12,
  DRIBBLE_PRESSURE_PENALTY: 0.35, DRIBBLE_FREE_SPACE_BONUS: 0.15, DRIBBLE_LOOSE_RATIO: 0.55,
  TACKLE_BASE_SUCCESS: 0.42, TACKLE_DEFENDING_WEIGHT: 0.28, TACKLE_CLOSENESS_WEIGHT: 0.12,
  TACKLE_CARRIER_TECHNIQUE_PENALTY: 0.30, TACKLE_CARRIER_PACE_PENALTY: 0.10, TACKLE_LOOSE_RATIO: 0.50,
  PRESS_BASE_SUCCESS: 0.26, PRESS_DEFENDING_WEIGHT: 0.18, PRESS_CLOSENESS_WEIGHT: 0.12,
  PRESS_TEAM_PRESSING_WEIGHT: 0.14, PRESS_CARRIER_COMPOSURE_PENALTY: 0.24, PRESS_PRESSURE_ONLY_RATIO: 0.55,
  INTERCEPTION_BASE_SUCCESS: 0.42, INTERCEPTION_DEFENDING_WEIGHT: 0.30, INTERCEPTION_REACH_WEIGHT: 0.20,
  INTERCEPTION_PROGRESS_PENALTY: 0.25, INTERCEPTION_DEFLECT_RATIO: 0.40,
});
const BASELINE_SECOND_BALL = Object.freeze({
  RANGE: 0.20, MIN_SCORE: 0.02, PROXIMITY_WEIGHT: 0.45, CLOSING_WEIGHT: 0.15,
  CLOSING_SPEED_NORM: 5, ABILITY_DEFENDING_WEIGHT: 0.20, ABILITY_PACE_WEIGHT: 0.12, CONTEXT_WEIGHT: 0.08,
});

test('CAL-10 / CAL-LOCK-01. DRIBBLE 默认行为锁定（config 值 = 迁移前基线）', () => {
  for (const [k, v] of Object.entries(BASELINE_INTERACTION)) {
    if (k.startsWith('DRIBBLE_')) assertEquals(INTERACTION_RESOLUTION_CONFIG[k], v, `${k} 偏离基线`);
  }
  const core = coreOf([mk('h_a', H, 'MF', 0.40, 0.50, { technique: 99, pace: 99 }), mk('a_d', A, 'DF', 0.41, 0.50)], { control: 'h_a', poss: H });
  const inst = dribbleInst();
  const def = resolveDribble(inst, core, { seed: 'lock' });
  const viaClone = resolveDribble(inst, core, { seed: 'lock', calibrationProfile: cloneProfile() });
  assertEquals(JSON.stringify(def), JSON.stringify(viaClone), '默认派生应与基线克隆 profile 结果一致');
  assertEquals(def.ok, true);
});

test('CAL-LOCK-02. TACKLE 默认行为锁定', () => {
  for (const [k, v] of Object.entries(BASELINE_INTERACTION)) {
    if (k.startsWith('TACKLE_')) assertEquals(INTERACTION_RESOLUTION_CONFIG[k], v, `${k} 偏离基线`);
  }
  const def = resolveTackle(tackleInst(), challengeCore(), { seed: 'lock' });
  const viaClone = resolveTackle(tackleInst(), challengeCore(), { seed: 'lock', calibrationProfile: cloneProfile() });
  assertEquals(JSON.stringify(def), JSON.stringify(viaClone));
  assertEquals(def.ok, true);
});

test('CAL-LOCK-03. PRESS 默认行为锁定', () => {
  for (const [k, v] of Object.entries(BASELINE_INTERACTION)) {
    if (k.startsWith('PRESS_')) assertEquals(INTERACTION_RESOLUTION_CONFIG[k], v, `${k} 偏离基线`);
  }
  const def = resolvePress(pressInst(), challengeCore(), { seed: 'lock' });
  const viaClone = resolvePress(pressInst(), challengeCore(), { seed: 'lock', calibrationProfile: cloneProfile() });
  assertEquals(JSON.stringify(def), JSON.stringify(viaClone));
  assertEquals(def.ok, true);
});

test('CAL-LOCK-04. INTERCEPTION 默认行为锁定', () => {
  for (const [k, v] of Object.entries(BASELINE_INTERACTION)) {
    if (k.startsWith('INTERCEPTION_')) assertEquals(INTERACTION_RESOLUTION_CONFIG[k], v, `${k} 偏离基线`);
  }
  const def = resolveInterception(interceptInst(), interceptionCore(), { seed: 'lock' });
  const viaClone = resolveInterception(interceptInst(), interceptionCore(), { seed: 'lock', calibrationProfile: cloneProfile() });
  assertEquals(JSON.stringify(def), JSON.stringify(viaClone));
  assertEquals(def.ok, true);
});

test('CAL-11 / CAL-LOCK-05. SECOND_BALL_WON 默认行为锁定', () => {
  for (const [k, v] of Object.entries(BASELINE_SECOND_BALL)) {
    assertEquals(SECOND_BALL_RESOLUTION_CONFIG[k], v, `${k} 偏离基线`);
  }
  const core = freeCore([mk('h_a', H, 'MF', 0.48, 0.5)]);
  const def = resolveSecondBall(core);
  const viaClone = resolveSecondBall(core, { calibrationProfile: cloneProfile() });
  assertEquals(def.outcome, SECOND_BALL_OUTCOMES.WON);
  assertEquals(JSON.stringify(def), JSON.stringify(viaClone));
});

test('CAL-LOCK-06. SECOND_BALL_NO_WINNER 默认行为锁定', () => {
  const core = freeCore([]);
  const def = resolveSecondBall(core);
  const viaClone = resolveSecondBall(core, { calibrationProfile: cloneProfile() });
  assertEquals(def.outcome, SECOND_BALL_OUTCOMES.NO_WINNER);
  assertEquals(def.winner, null);
  assertEquals(JSON.stringify(def), JSON.stringify(viaClone));
});

// ===========================================================================
// Metadata / TBD-CAL / Hidden state
// ===========================================================================

test('CAL-12. Calibration metadata 记录在 resolutionMeta 且不进入 MatchCore Truth', () => {
  const core = dribbleCore();
  const r = resolveDribble(dribbleInst(), core, { seed: 'x' });
  assertEquals(r.resolutionMeta.calibrationVersion, RESOLUTION_CALIBRATION_VERSION);
  const next = applyInteractionStateUpdate(core, r);
  assert(!('calibrationVersion' in next.ball), 'Calibration Version 不得写入 Ball Truth');
  assert(!JSON.stringify(next).includes('calibrationVersion'), 'MatchCore Truth 不得包含 Calibration metadata');
});

test('CAL-13. TBD-CAL profile 仍合法、确定、可运行', () => {
  // 所有 spec 均为 TBD_CAL（MVP 默认）。
  for (const d of Object.keys(CALIBRATION_PARAM_SPECS.interaction)) {
    for (const k of Object.keys(CALIBRATION_PARAM_SPECS.interaction[d])) {
      assertEquals(CALIBRATION_PARAM_SPECS.interaction[d][k].status, CALIBRATION_STATUS.TBD_CAL);
    }
  }
  for (const k of Object.keys(CALIBRATION_PARAM_SPECS.secondBall)) {
    assertEquals(CALIBRATION_PARAM_SPECS.secondBall[k].status, CALIBRATION_STATUS.TBD_CAL);
  }
  // 仍然可运行且产出合法结果。
  assertEquals(resolveDribble(dribbleInst(), dribbleCore(), { seed: 'x' }).ok, true);
  assertEquals(resolveSecondBall(freeCore()).ok, true);
});

test('CAL-16. 无隐藏 mutable calibration state', () => {
  // 默认 profile 与派生 config 深度冻结。
  assert(Object.isFrozen(DEFAULT_CALIBRATION_PROFILE));
  assert(Object.isFrozen(DEFAULT_CALIBRATION_PROFILE.interaction));
  assert(Object.isFrozen(DEFAULT_CALIBRATION_PROFILE.interaction.dribble));
  assert(Object.isFrozen(DEFAULT_CALIBRATION_PROFILE.secondBall));
  assert(Object.isFrozen(INTERACTION_RESOLUTION_CONFIG));
  assert(Object.isFrozen(SECOND_BALL_RESOLUTION_CONFIG));
  assert(Object.isFrozen(buildInteractionResolutionConfig(DEFAULT_CALIBRATION_PROFILE)));
  assert(Object.isFrozen(buildSecondBallResolutionConfig(DEFAULT_CALIBRATION_PROFILE)));

  // 校验函数不修改传入 config。
  const override = cloneProfile((p) => { p.interaction.press.BASE_SUCCESS = 0.5; });
  const snapshot = JSON.stringify(override);
  assertValidCalibrationConfig(override);
  assertEquals(JSON.stringify(override), snapshot, '校验不得修改 override');

  // 连续运行 override 不改变默认来源。
  const before = JSON.stringify(DEFAULT_CALIBRATION_PROFILE);
  resolvePress(pressInst(), challengeCore(), { seed: 'x', calibrationProfile: override });
  resolveSecondBall(freeCore(), { calibrationProfile: override });
  assertEquals(JSON.stringify(DEFAULT_CALIBRATION_PROFILE), before);

  // 源码守卫：模块顶层无 mutable 校准全局。
  for (const f of CAL_FILES) {
    const src = readSrc(f);
    assert(!/globalThis\.\w*calibration/i.test(src), `${f} 不得挂载全局 calibration`);
    assert(!/(^|\n)\s*let\s+\w*calibration\w*/i.test(src), `${f} 不得存在可变 calibration 全局`);
  }
});

// ===========================================================================
// Source guards
// ===========================================================================

test('CAL-14. Math.random source scan（Calibration / Resolution 文件）', () => {
  for (const f of CAL_FILES) {
    assert(!/Math\.random\s*\(/.test(readSrc(f)), `${f} 出现 Math.random 调用`);
  }
});

test('CAL-15. wall-clock source scan（无 Date.now / performance.now / new Date）', () => {
  for (const f of CAL_FILES) {
    const src = readSrc(f);
    assert(!/Date\.now\s*\(/.test(src), `${f} 出现 Date.now`);
    assert(!/performance\.now\s*\(/.test(src), `${f} 出现 performance.now`);
    assert(!/new\s+Date\s*\(/.test(src), `${f} 出现 new Date`);
  }
});