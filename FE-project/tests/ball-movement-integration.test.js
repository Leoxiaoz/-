/**
 * Step 39F-M-C-23 —— Ball Movement State → Ball Position Integration 测试。
 *
 * 覆盖：正常写入 / start mismatch / x>1 / x<0 / y 超界 / zero movement / Immutable /
 *       Ball 其他字段保持 / Score·Possession 不变 / 失败语义 / 重复应用阻断 /
 *       Architecture Source Guard（不依赖 C-14~C-22，无 Velocity / Physics / Collision / Ledger / random / wall clock）。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  applyBallMovementPositionUpdate,
  BALL_MOVEMENT_INTEGRATION_SOURCE, BALL_MOVEMENT_INTEGRATION_RULE_VERSION,
  BALL_MOVEMENT_INTEGRATION_REASON,
} from '../src/core/match/ball-movement-integration.js';
import { createBallMovementState, BALL_MOVEMENT_STATE_REASON } from '../src/core/match/ball-movement-state.js';

const R = BALL_MOVEMENT_INTEGRATION_REASON;
const H = 'clb_h';
const A = 'clb_a';

const HERE = dirname(fileURLToPath(import.meta.url));
const strip = (p) => readFileSync(join(HERE, p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const SRC_STATE = strip('../src/core/match/ball-movement-state.js');
const SRC_INT = strip('../src/core/match/ball-movement-integration.js');

function core(px = 0.4, py = 0.5) {
  return {
    worldId: 'w23', season: 1, matchId: 'm23', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball: {
      position: { x: px, y: py }, velocity: { x: 0.1, y: -0.2 }, state: 'IN_TRANSIT',
      control: null, possessingTeamId: H, inTransit: true,
    },
    players: [],
  };
}

const state = (p0, p1, extra = {}) => createBallMovementState({
  startPosition: { x: p0[0], y: p0[1] }, endPosition: { x: p1[0], y: p1[1] }, duration: 1, ...extra,
});

// ===========================================================================
// Integration：9-19
// ===========================================================================

test('INT-9/16. 正常 Position Update → ball.position = endPosition', () => {
  const mc = core(0.4, 0.5);
  const r = applyBallMovementPositionUpdate(mc, state([0.4, 0.5], [0.6, 0.5]));
  assertEquals(r.ok, true);
  assertEquals(r.matchCore.ball.position, { x: 0.6, y: 0.5 });
  assertEquals(r.source, BALL_MOVEMENT_INTEGRATION_SOURCE);
  assertEquals(r.ruleVersion, BALL_MOVEMENT_INTEGRATION_RULE_VERSION);
});

test('INT-10. start position mismatch → MOVEMENT_START_POSITION_MISMATCH（不自动修正）', () => {
  const mc = core(0.4, 0.5);
  const r = applyBallMovementPositionUpdate(mc, state([0.6, 0.5], [0.8, 0.5]));
  assertEquals(r.ok, false);
  assertEquals(r.reason, R.MOVEMENT_START_POSITION_MISMATCH);
  assertEquals(mc.ball.position, { x: 0.4, y: 0.5 });
});

test('INT-11. x > 1 正常写入（不 clamp）', () => {
  const r = applyBallMovementPositionUpdate(core(0.9, 0.5), state([0.9, 0.5], [1.1, 0.5]));
  assertEquals(r.ok, true);
  assertEquals(r.matchCore.ball.position, { x: 1.1, y: 0.5 });
});

test('INT-12. x < 0 正常写入（不 clamp）', () => {
  const r = applyBallMovementPositionUpdate(core(0.1, 0.5), state([0.1, 0.5], [-0.1, 0.5]));
  assertEquals(r.ok, true);
  assertEquals(r.matchCore.ball.position, { x: -0.1, y: 0.5 });
});

test('INT-13. y 超界正常写入（y > 1 / y < 0）', () => {
  const up = applyBallMovementPositionUpdate(core(0.5, 0.9), state([0.5, 0.9], [0.5, 1.2]));
  assertEquals(up.matchCore.ball.position, { x: 0.5, y: 1.2 });
  const down = applyBallMovementPositionUpdate(core(0.5, 0.1), state([0.5, 0.1], [0.5, -0.2]));
  assertEquals(down.matchCore.ball.position, { x: 0.5, y: -0.2 });
});

test('INT-14. zero movement → position 不变，但返回新 immutable MatchCore', () => {
  const mc = core(0.5, 0.5);
  const r = applyBallMovementPositionUpdate(mc, state([0.5, 0.5], [0.5, 0.5]));
  assertEquals(r.ok, true);
  assertEquals(r.matchCore.ball.position, { x: 0.5, y: 0.5 });
  assert(r.matchCore !== mc, '必须产生新 MatchCore');
  assert(r.matchCore.ball !== mc.ball, 'ball 必须是新对象');
  assert(r.matchCore.ball.position !== mc.ball.position, 'position 必须是新对象');
});

test('INT-15. MatchCore Immutable（输入不修改，输出为副本）', () => {
  const mc = core(0.4, 0.5);
  const snap = JSON.stringify(mc);
  const r = applyBallMovementPositionUpdate(mc, state([0.4, 0.5], [0.6, 0.5]));
  assertEquals(JSON.stringify(mc), snap);
  assert(r.matchCore !== mc);
  assertEquals(r.matchCore.score, { home: 0, away: 0 });
});

test('INT-17. Ball 其他字段保持（velocity/state/control/possessingTeamId/inTransit）', () => {
  const mc = core(0.4, 0.5);
  const r = applyBallMovementPositionUpdate(mc, state([0.4, 0.5], [0.6, 0.5]));
  assertEquals(r.matchCore.ball.velocity, { x: 0.1, y: -0.2 });
  assertEquals(r.matchCore.ball.state, 'IN_TRANSIT');
  assertEquals(r.matchCore.ball.control, null);
  assertEquals(r.matchCore.ball.possessingTeamId, H);
  assertEquals(r.matchCore.ball.inTransit, true);
});

test('INT-18/19. Score / Possession 不变化', () => {
  const mc = core(0.4, 0.5);
  const r = applyBallMovementPositionUpdate(mc, state([0.4, 0.5], [0.6, 0.5]));
  assertEquals(r.matchCore.score, mc.score);
  assertEquals(r.matchCore.ball.possessingTeamId, mc.ball.possessingTeamId);
  assertEquals(r.matchCore.ball.control, mc.ball.control);
});

// ===========================================================================
// Failure：20-21
// ===========================================================================

test('INT-20. 非法 MatchCore → INVALID_MATCH_CORE', () => {
  const s = state([0.4, 0.5], [0.6, 0.5]);
  assertEquals(applyBallMovementPositionUpdate(null, s).reason, R.INVALID_MATCH_CORE);
  assertEquals(applyBallMovementPositionUpdate({}, s).reason, R.INVALID_MATCH_CORE);
  assertEquals(applyBallMovementPositionUpdate({ ball: {} }, s).reason, R.INVALID_MATCH_CORE);
  assertEquals(applyBallMovementPositionUpdate({ ball: { position: { x: NaN, y: 0 } } }, s).reason, R.INVALID_MATCH_CORE);
});

test('INT-21. 非法 Movement State → INVALID_MOVEMENT_STATE / 具体原因', () => {
  const mc = core(0.4, 0.5);
  assertEquals(applyBallMovementPositionUpdate(mc, null).reason, R.INVALID_MOVEMENT_STATE);
  assertEquals(applyBallMovementPositionUpdate(mc, { ok: false }).reason, R.INVALID_MOVEMENT_STATE);
  const badDuration = { ...state([0.4, 0.5], [0.6, 0.5]), duration: -1 };
  assertEquals(applyBallMovementPositionUpdate(mc, badDuration).reason, BALL_MOVEMENT_STATE_REASON.INVALID_DURATION);
});

// ===========================================================================
// 重复应用阻断 / 无第二 Truth：22-25
// ===========================================================================

test('INT-22. 重复应用同一 Movement State → 第二次 MOVEMENT_START_POSITION_MISMATCH', () => {
  const mc = core(0.4, 0.5);
  const s = state([0.4, 0.5], [0.6, 0.5]);
  const r1 = applyBallMovementPositionUpdate(mc, s);
  assertEquals(r1.ok, true);
  const r2 = applyBallMovementPositionUpdate(r1.matchCore, s);
  assertEquals(r2.ok, false);
  assertEquals(r2.reason, R.MOVEMENT_START_POSITION_MISMATCH);
});

test('INT-23. 不创建第二 Ball Position Truth（无新字段）', () => {
  const mc = core(0.4, 0.5);
  const r = applyBallMovementPositionUpdate(mc, state([0.4, 0.5], [0.6, 0.5]));
  assertEquals(Object.keys(r.matchCore).sort(), Object.keys(mc).sort());
  for (const k of ['ballMovement', 'movementState', 'positionTruth', 'currentPosition', 'velocityTruth']) {
    assert(!(k in r.matchCore), `MatchCore 不得新增 ${k}`);
    assert(!(k in r.matchCore.ball), `ball 不得新增 ${k}`);
  }
});

test('INT-25. Movement State 输入在 Integration 中不被修改', () => {
  const mc = core(0.4, 0.5);
  const s = state([0.4, 0.5], [0.6, 0.5]);
  const snap = JSON.stringify(s);
  applyBallMovementPositionUpdate(mc, s);
  assertEquals(JSON.stringify(s), snap);
});

// ===========================================================================
// Architecture Source Guard：20-32
// ===========================================================================

const ABSENT_IMPORTS = [
  ['C-14', /from '\.\/goal-resolution\.js'/],
  ['C-15', /from '\.\/goal-geometry\.js'/],
  ['C-20', /from '\.\/trajectory-goal-detection\.js'/],
  ['C-21', /from '\.\/goal-crossing-resolution\.js'/],
  ['C-22', /from '\.\/trajectory-goal-match-tick\.js'/],
  ['C-17', /goal-aware-match-tick\.js/],
  ['C-18', /goal-aware-match-ticks\.js/],
  ['C-19', /from '\.\/ball-trajectory\.js'/],
];

test('ARCH-20~26. C-23 不依赖 C-14 / C-15 / C-17 / C-18 / C-19 / C-20 / C-21 / C-22', () => {
  for (const src of [SRC_STATE, SRC_INT]) {
    for (const [name, re] of ABSENT_IMPORTS) assert(!re.test(src), `不得依赖 ${name}`);
  }
});

test('ARCH-27~30. 无 Velocity Truth / Physics / Collision / Movement Ledger', () => {
  for (const src of [SRC_STATE, SRC_INT]) {
    assert(!/velocityTruth|ballVelocityTruth/i.test(src));
    assert(!/ballPhysics|physicsEngine/i.test(src));
    assert(!/collision/i.test(src));
    assert(!/movementLedger|movementHistory|movementId\b/i.test(src));
  }
});

test('ARCH-31/32 & Source Guard. 无 random / wall clock / 直接写 Score / Goal Truth', () => {
  for (const src of [SRC_STATE, SRC_INT]) {
    assert(!/Math\.random\s*\(/.test(src));
    assert(!/Date\.now\s*\(/.test(src) && !/new\s+Date\s*\(/.test(src) && !/performance\.now\s*\(/.test(src));
    assert(!/score\.home\s*(\+\+|[-+*\/]?=)/.test(src));
    assert(!/score\.away\s*(\+\+|[-+*\/]?=)/.test(src));
    assert(!/goal\s*=\s*true/.test(src));
    assert(!/velocity\s*=/.test(src) && !/acceleration\s*=/.test(src) && !/force\s*=/.test(src));
    assert(!/if\s*\([^)]*\.x\s*>\s*1/.test(src), '禁止用 x>1 判断进球');
  }
});