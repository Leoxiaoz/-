/**
 * Step 39F-M-B-RESOLUTION-SHOT —— SHOT Resolution 测试。
 *
 * 覆盖：输入合法性 / 几何 / 误差 / 压力 / Risk / 落点 / 封堵 / 门将反应 /
 * 四类结果 / Transit / State Update / BallState / Possession / RNG 隔离 /
 * Determinism / 边界 / 方向性 / 性质 / 长跑 / 无副作用。
 */

import { test, assert, assertEquals } from './harness.js';
import {
  resolveShot, calculateShotGeometry, calculateSaveExposure, calculateSaveProb,
  buildShotResolutionScope,
} from '../src/core/match/shot-resolution.js';
import {
  applyShotStateUpdate, advanceShotTransit, completeShotTransit,
} from '../src/core/match/shot-state-update.js';
import { SHOT_RESOLUTION_CONFIG as C, SHOT_OUTCOMES } from '../src/core/match/shot-resolution-config.js';
import { decidePlayerAction } from '../src/core/match/decision-pipeline.js';
import { resolvePass } from '../src/core/match/pass-resolution.js';

const H = 'clb_h', A = 'clb_a';
const ATTRS = (o = {}) => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...o });
function mk(id, t, pos, x, y, attrs = {}, extra = {}) {
  return { playerId: id, teamId: t, position: pos, positionOnPitch: { x, y }, onPitch: true, injured: false, sentOff: false, attributes: ATTRS(attrs), fitness: 100, form: 50, morale: 50, matchLoad: 0, ...extra };
}
function coreOf(players, ballControl, poss, extra = {}) {
  const bp = players.find((p) => p.playerId === ballControl);
  return {
    worldId: 'w_shot', season: 1, matchId: 'm_shot', ruleVersion: 'match-shot-resolution-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 20, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball: { position: { ...(bp?.positionOnPitch ?? { x: 0.5, y: 0.5 }) }, control: ballControl, possessingTeamId: poss },
    players,
    tactical: { [H]: { formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' }, [A]: { formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' } },
    ...extra,
  };
}
const shot = (actorId, zone = 'CENTER', { intent = 'GOAL', risk = 'MEDIUM' } = {}) => ({
  actionType: 'SHOT', actorId, target: { type: 'GOAL_AREA', zone }, intent,
  riskIntent: { level: risk, value: 0.5 }, commitment: { type: 'COMMITTED', duration: null },
});

function weakGkCore() {
  return coreOf([
    mk('h_fw', H, 'FW', 0.85, 0.50, { finishing: 90, technique: 85 }),
    mk('a_gk', A, 'GK', 0.99, 0.50, { goalkeeping: 10 }), mk('a_df', A, 'DF', 0.60, 0.30),
  ], 'h_fw', H);
}
function strongGkCore() {
  return coreOf([
    mk('h_fw', H, 'FW', 0.85, 0.50, { finishing: 70, technique: 70 }),
    mk('a_gk', A, 'GK', 0.99, 0.50, { goalkeeping: 99 }), mk('a_df', A, 'DF', 0.30, 0.80),
  ], 'h_fw', H);
}
function blockCore() {
  return coreOf([
    mk('h_fw', H, 'FW', 0.60, 0.50, { finishing: 80 }), mk('a_df', A, 'DF', 0.78, 0.50, { defending: 70 }),
    mk('a_gk', A, 'GK', 0.99, 0.50, { goalkeeping: 70 }),
  ], 'h_fw', H);
}
function missCore() {
  return coreOf([
    mk('h_fw', H, 'FW', 0.45, 0.04, { finishing: 20, technique: 20 }),
    mk('a_gk', A, 'GK', 0.99, 0.50, { goalkeeping: 70 }), mk('a_df', A, 'DF', 0.20, 0.90),
  ], 'h_fw', H);
}
function findSeed(core, i, pred) {
  for (let s = 0; s < 800; s += 1) {
    const r = resolveShot(i, core, { seed: `s${s}` });
    if (pred(r)) return { seed: `s${s}`, r };
  }
  return null;
}

// ===========================================================================
// 输入合法性
// ===========================================================================

test('SR-01. 合法 SHOT 被接受', () => {
  const r = resolveShot(shot('h_fw'), weakGkCore(), { seed: 'a' });
  assertEquals(r.ok, true);
  assertEquals(r.type, 'SHOT_RESOLUTION');
});

test('SR-02. 非 SHOT ActionInstance 被拒绝', () => {
  const r = resolveShot({ actionType: 'PASS', actorId: 'h_fw', target: { type: 'TEAMMATE', playerId: 'x' } }, weakGkCore(), { seed: 'a' });
  assertEquals(r.ok, false);
  assertEquals(r.outcome, SHOT_OUTCOMES.INVALID_SHOT);
  assertEquals(r.reason, 'NOT_SHOT_ACTION');
});

test('SR-03/04. 无效 actor / actor 不可用被拒绝', () => {
  assertEquals(resolveShot(shot('ghost'), weakGkCore(), { seed: 'a' }).reason, 'INVALID_ACTOR');
  const c = weakGkCore(); c.players[0].injured = true;
  assertEquals(resolveShot(shot('h_fw'), c, { seed: 'a' }).reason, 'INVALID_ACTOR');
});

test('SR-05. 非法 target 被拒绝（非 GOAL_AREA / 非法 zone）', () => {
  const r1 = resolveShot({ actionType: 'SHOT', actorId: 'h_fw', target: { type: 'TEAMMATE', playerId: 'x' } }, weakGkCore(), { seed: 'a' });
  assertEquals(r1.reason, 'INVALID_TARGET');
  const r2 = resolveShot({ actionType: 'SHOT', actorId: 'h_fw', target: { type: 'GOAL_AREA', zone: 'SIDE' } }, weakGkCore(), { seed: 'a' });
  assertEquals(r2.reason, 'INVALID_TARGET');
});

test('SR-06. 球未在 actor 控制被拒绝', () => {
  const c = weakGkCore(); c.ball.control = 'a_gk';
  assertEquals(resolveShot(shot('h_fw'), c, { seed: 'a' }).reason, 'BALL_NOT_CONTROLLED_BY_ACTOR');
});

test('SR-07/08/09/10. 几何：goal area / origin / distance / angle 正确', () => {
  const r = resolveShot(shot('h_fw'), weakGkCore(), { seed: 'a', debug: true });
  assertEquals(r.intendedTarget.type, 'GOAL_AREA');
  assertEquals(r.debug.origin, { x: 0.85, y: 0.50 });
  const geo = calculateShotGeometry({ x: 0.85, y: 0.50 }, { x: 1, y: 0.5 });
  assert(Math.abs(r.execution.distance - geo.distance) < 1e-9);
  assert(r.execution.angle >= 0);
  assert(r.execution.angleFactor >= 0 && r.execution.angleFactor <= 1);
});

// ===========================================================================
// 误差 / 落点 / 方向性
// ===========================================================================

test('SR-11/12. shotError 有界；actualDestination 在 pitch bounds；无 NaN', () => {
  for (const s of ['a', 'b', 'c']) {
    const r = resolveShot(shot('h_fw'), weakGkCore(), { seed: s });
    assert(Number.isFinite(r.execution.shotError) && r.execution.shotError >= 0 && r.execution.shotError <= C.MAX_SHOT_ERROR);
    assert(r.actualDestination.x >= 0 && r.actualDestination.x <= 1 && r.actualDestination.y >= 0 && r.actualDestination.y <= 1);
  }
});

test('SR-33. finishing↑ → shotError↓（同 seed / 同局面）', () => {
  const mkC = (fin) => coreOf([mk('h_fw', H, 'FW', 0.6, 0.5, { finishing: fin }), mk('a_gk', A, 'GK', 0.99, 0.5, { goalkeeping: 50 })], 'h_fw', H);
  assert(resolveShot(shot('h_fw'), mkC(90), { seed: 'd' }).execution.shotError
    < resolveShot(shot('h_fw'), mkC(20), { seed: 'd' }).execution.shotError);
});

test('SR-34. distance↑ → shotError↑', () => {
  const near = coreOf([mk('h_fw', H, 'FW', 0.9, 0.5, { finishing: 60 }), mk('a_gk', A, 'GK', 0.99, 0.5, { goalkeeping: 50 })], 'h_fw', H);
  const far = coreOf([mk('h_fw', H, 'FW', 0.35, 0.5, { finishing: 60 }), mk('a_gk', A, 'GK', 0.99, 0.5, { goalkeeping: 50 })], 'h_fw', H);
  assert(resolveShot(shot('h_fw'), far, { seed: 'd' }).execution.shotError
    > resolveShot(shot('h_fw'), near, { seed: 'd' }).execution.shotError);
});

test('SR-35. angle 变差 → angleFactor↑ → shotError↑', () => {
  const central = coreOf([mk('h_fw', H, 'FW', 0.85, 0.50, { finishing: 60 }), mk('a_gk', A, 'GK', 0.99, 0.5, { goalkeeping: 50 })], 'h_fw', H);
  const wide = coreOf([mk('h_fw', H, 'FW', 0.85, 0.12, { finishing: 60 }), mk('a_gk', A, 'GK', 0.99, 0.5, { goalkeeping: 50 })], 'h_fw', H);
  const rc = resolveShot(shot('h_fw'), central, { seed: 'd' });
  const rw = resolveShot(shot('h_fw'), wide, { seed: 'd' });
  assert(rw.execution.angleFactor > rc.execution.angleFactor);
  assert(rw.execution.shotError > rc.execution.shotError);
});

test('SR-36. pressure↑ → shotError↑（线路外对手）', () => {
  const low = coreOf([mk('h_fw', H, 'FW', 0.5, 0.5, { finishing: 60 }), mk('a_gk', A, 'GK', 0.99, 0.5, { goalkeeping: 50 })], 'h_fw', H);
  const high = coreOf([
    mk('h_fw', H, 'FW', 0.5, 0.5, { finishing: 60 }),
    mk('a_p1', A, 'MF', 0.5, 0.45), mk('a_p2', A, 'MF', 0.5, 0.55),
    mk('a_gk', A, 'GK', 0.99, 0.5, { goalkeeping: 50 }),
  ], 'h_fw', H);
  assert(resolveShot(shot('h_fw'), high, { seed: 'p' }).execution.shotError
    > resolveShot(shot('h_fw'), low, { seed: 'p' }).execution.shotError);
});

test('SR-37. goalkeeping↑ → saveExposure↑（同 shot）', () => {
  const weak = coreOf([mk('h_fw', H, 'FW', 0.85, 0.5, { finishing: 70 }), mk('a_gk', A, 'GK', 0.99, 0.5, { goalkeeping: 10 })], 'h_fw', H);
  const strong = coreOf([mk('h_fw', H, 'FW', 0.85, 0.5, { finishing: 70 }), mk('a_gk', A, 'GK', 0.99, 0.5, { goalkeeping: 99 })], 'h_fw', H);
  assert(resolveShot(shot('h_fw'), strong, { seed: 'g' }).execution.saveExposure
    > resolveShot(shot('h_fw'), weak, { seed: 'g' }).execution.saveExposure);
});

test('SR-GKPos. GK 更接近落点 → saveExposure 更高', () => {
  const dest = { x: 1, y: 0.5 };
  const near = calculateSaveExposure({ goalkeeping: 70, gkPosition: { x: 0.99, y: 0.5 }, destination: dest, shotQuality: 0.5 });
  const far = calculateSaveExposure({ goalkeeping: 70, gkPosition: { x: 0.99, y: 0.9 }, destination: dest, shotQuality: 0.5 });
  assert(near > far);
});

test('SR-38. HIGH risk → error/variance ≥ LOW risk（非直接 success bonus）', () => {
  const c = weakGkCore();
  const lo = resolveShot(shot('h_fw', 'CENTER', { risk: 'LOW' }), c, { seed: 'r' });
  const hi = resolveShot(shot('h_fw', 'CENTER', { risk: 'HIGH' }), c, { seed: 'r' });
  assert(hi.execution.shotError >= lo.execution.shotError);
  assert(!('success' in hi) && !('successChance' in hi) && !('goalProbability' in hi));
});

// ===========================================================================
// 封堵 / MISS / 门将 / 四类结果
// ===========================================================================

test('SR-13/14. block exposure；BLOCKED 可达', () => {
  const r0 = resolveShot(shot('h_fw'), blockCore(), { seed: 'x' });
  assert(r0.execution.blockExposure > 0);
  const found = findSeed(blockCore(), shot('h_fw'), (r) => r.outcome === SHOT_OUTCOMES.BLOCKED);
  assert(found !== null, '应存在产生 BLOCKED 的 seed');
});

test('SR-15. MISS 可达且落点在门框外', () => {
  const found = findSeed(missCore(), shot('h_fw'), (r) => r.outcome === SHOT_OUTCOMES.MISS);
  assert(found !== null, '应存在 MISS');
  assert(Math.abs(found.r.actualDestination.y - 0.5) > C.GOAL_HALF_WIDTH, 'MISS 落点应在门框外');
});

test('SR-16/17. SAVE 可达（强门将）', () => {
  const found = findSeed(strongGkCore(), shot('h_fw'), (r) => r.outcome === SHOT_OUTCOMES.SAVE);
  assert(found !== null, '应存在 SAVE');
  assert(found.r.execution.saveProb >= 0 && found.r.execution.saveProb <= C.GK_REACTION_MAX);
});

test('SR-18. GOAL 可达（弱门将，无封堵）', () => {
  const found = findSeed(weakGkCore(), shot('h_fw'), (r) => r.outcome === SHOT_OUTCOMES.GOAL);
  assert(found !== null, '应存在 GOAL');
});

test('SR-19. 四类结果互斥且合法', () => {
  const all = new Set([SHOT_OUTCOMES.GOAL, SHOT_OUTCOMES.SAVE, SHOT_OUTCOMES.MISS, SHOT_OUTCOMES.BLOCKED]);
  for (const s of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const r = resolveShot(shot('h_fw'), blockCore(), { seed: s });
    assert(all.has(r.outcome));
  }
});

test('SR-SAVE≠BLOCK. 门将不会被当作 blocker；SAVE/BLOCKED 分离', () => {
  const r = resolveShot(shot('h_fw'), weakGkCore(), { seed: 'sep' });
  if (r.outcome === SHOT_OUTCOMES.BLOCKED) assert(r.blockerId !== r.goalkeeperId);
});

// ===========================================================================
// Transit / State Update / BallState / Possession
// ===========================================================================

test('SR-20/21. Shot Transit 字段完整；使用 simulationTime', () => {
  const r = resolveShot(shot('h_fw'), weakGkCore(), { seed: 't' });
  assertEquals(r.transit.state, 'IN_TRANSIT');
  assertEquals(r.transit.startedAt, 20);
  assertEquals(r.transit.progress, 0);
  assert(r.transit.duration >= C.MIN_SHOT_DURATION && r.transit.duration <= C.MAX_SHOT_DURATION);
  assert(r.transit.from && r.transit.to);
});

test('SR-22/23. applyShotStateUpdate：IN_TRANSIT 且清除控制者', () => {
  const core = weakGkCore();
  const r = resolveShot(shot('h_fw'), core, { seed: 'u' });
  const next = applyShotStateUpdate(core, r);
  assertEquals(next.ball.state, 'IN_TRANSIT');
  assertEquals(next.ball.control, null);
  assertEquals(next.ball.possessingTeamId, null);
  assert(next.ball.transit !== undefined);
  assertEquals(core.ball.state, undefined); // 未 mutate 输入
});

test('SR-24/25/26/27. 结算：SAVE/BLOCKED/MISS/GOAL 的 BallState（GOAL 不改 Score）', () => {
  const saveR = findSeed(strongGkCore(), shot('h_fw'), (r) => r.outcome === SHOT_OUTCOMES.SAVE);
  const sv = completeShotTransit(applyShotStateUpdate(strongGkCore(), saveR.r));
  assertEquals(sv.ball.state, 'CONTROLLED');
  assertEquals(sv.ball.control, saveR.r.goalkeeperId);
  assertEquals(sv.ball.possessingTeamId, A);

  const blockR = findSeed(blockCore(), shot('h_fw'), (r) => r.outcome === SHOT_OUTCOMES.BLOCKED && r.blockerId);
  const bl = completeShotTransit(applyShotStateUpdate(blockCore(), blockR.r));
  assertEquals(bl.ball.state, 'CONTROLLED');
  assertEquals(bl.ball.control, blockR.r.blockerId);

  const mr = findSeed(missCore(), shot('h_fw'), (r) => r.outcome === SHOT_OUTCOMES.MISS);
  assert(mr !== null);
  const ms = completeShotTransit(applyShotStateUpdate(missCore(), mr.r));
  assertEquals(ms.ball.state, 'FREE');
  assertEquals(ms.ball.control, null);
  assertEquals(ms.ball.possessingTeamId, null);

  const gr = findSeed(weakGkCore(), shot('h_fw'), (r) => r.outcome === SHOT_OUTCOMES.GOAL);
  const gcore = weakGkCore();
  const beforeScore = JSON.stringify(gcore.score);
  const g = completeShotTransit(applyShotStateUpdate(gcore, gr.r));
  assertEquals(g.ball.state, 'GOAL');
  assertEquals(JSON.stringify(g.score), beforeScore, 'SHOT State Update 不得修改 Score');
});

test('SR-Transit. progress ∈ [0,1]；完成即清除 transit', () => {
  const core = applyShotStateUpdate(weakGkCore(), resolveShot(shot('h_fw'), weakGkCore(), { seed: 'pr' }));
  const mid = advanceShotTransit(core, core.ball.transit.duration / 2);
  assert(mid.ball.transit.progress > 0 && mid.ball.transit.progress < 1);
  const end = advanceShotTransit(core, core.ball.transit.duration + 10);
  assert(!end.ball.transit);
});

// ===========================================================================
// RNG 隔离 / Determinism / 变化
// ===========================================================================

test('SR-28/29/30. RNG 隔离：Decision / PASS / shotSequence 互不污染', () => {
  const core = weakGkCore();
  const i = shot('h_fw');
  const before = JSON.stringify(resolveShot(i, core, { seed: 'iso' }));
  for (let k = 0; k < 30; k += 1) decidePlayerAction(core, 'h_fw', { seed: 'iso', decisionSequence: k });
  resolvePass({ actionType: 'PASS', actorId: 'h_fw', target: { type: 'TEAMMATE', playerId: 'h_fw' } }, core, { seed: 'iso' });
  const after = JSON.stringify(resolveShot(i, core, { seed: 'iso' }));
  assertEquals(after, before);
  // shotSequence 隔离
  const a0 = JSON.stringify(resolveShot(i, core, { seed: 'x', shotSequence: 0 }));
  resolveShot(i, core, { seed: 'x', shotSequence: 1 });
  assertEquals(JSON.stringify(resolveShot(i, core, { seed: 'x', shotSequence: 0 })), a0);
});

test('SR-31. Determinism：1000 次重复一致', () => {
  const core = blockCore();
  const base = JSON.stringify(resolveShot(shot('h_fw'), core, { seed: 'det' }));
  let same = 0;
  for (let k = 0; k < 1000; k += 1) if (JSON.stringify(resolveShot(shot('h_fw'), core, { seed: 'det' })) === base) same += 1;
  assertEquals(same, 1000);
});

test('SR-32. 不同 Seed 产生合法变化', () => {
  const outcomes = new Set(); const errors = new Set();
  for (let s = 0; s < 300; s += 1) {
    const r = resolveShot(shot('h_fw'), blockCore(), { seed: `v${s}` });
    outcomes.add(r.outcome); errors.add(r.execution.shotError);
    assert(r.actualDestination.x >= 0 && r.actualDestination.x <= 1);
  }
  assert(outcomes.size >= 2 && errors.size > 1);
});

// ===========================================================================
// 无副作用
// ===========================================================================

test('SR-39..45. 不产生 Event / 不写 Stats·Growth·Training·Development·Save·Match Result；不改 MatchCore', () => {
  const core = weakGkCore();
  const before = JSON.stringify(core);
  const r = resolveShot(shot('h_fw'), core, { seed: 'pure' });
  assertEquals(JSON.stringify(core), before, 'resolveShot 不得修改 MatchCore');
  for (const bad of ['event', 'events', 'stats', 'growth', 'training', 'development', 'save', 'score', 'standings', 'fixture', 'assists']) {
    assert(!(bad in r), `Shot result 不得包含 ${bad}`);
  }
  for (const bad of ['actionType', 'decision', 'candidate']) assert(!(bad in r), `Shot result 不得包含 ${bad}`);
});

test('SR-49. 无无限循环（调用即返回，含 debug 路径）', () => {
  const r = resolveShot(shot('h_fw'), weakGkCore(), { seed: 'loop', debug: true });
  assert(r && r.outcome);
});

// ===========================================================================
// 边界 / 性质 / 长跑
// ===========================================================================

test('SR-Boundary. 极值输入：距离/角度/能力/门将/风险/目标区，全部合法无 NaN', () => {
  for (const fin of [1, 99]) {
    for (const gkAbl of [1, 99]) {
      for (const zone of ['CENTER', 'LEFT', 'RIGHT']) {
        for (const risk of ['LOW', 'MEDIUM', 'HIGH']) {
          const core = coreOf([
            mk('h_fw', H, 'FW', 0.10, 0.90, { finishing: fin, technique: fin }),
            mk('a_gk', A, 'GK', 0.99, 0.50, { goalkeeping: gkAbl }),
          ], 'h_fw', H);
          const r = resolveShot(shot('h_fw', zone, { risk }), core, { seed: `${fin}${gkAbl}${zone}${risk}` });
          assert(r.ok);
          assert(Number.isFinite(r.execution.shotError) && Number.isFinite(r.execution.saveProb) && Number.isFinite(r.transit.duration));
          assert(r.actualDestination.x >= 0 && r.actualDestination.x <= 1 && r.actualDestination.y >= 0 && r.actualDestination.y <= 1);
        }
      }
    }
  }
  // 距离 0（origin == goal center）
  const z = coreOf([mk('h_fw', H, 'FW', 1.0, 0.50, { finishing: 70 }), mk('a_gk', A, 'GK', 0.99, 0.50, { goalkeeping: 70 })], 'h_fw', H);
  const r0 = resolveShot(shot('h_fw'), z, { seed: 'z' });
  assert(r0.ok && Number.isFinite(r0.execution.shotError));
});

test('SR-Property. 1000 合法输入 → 四类结果之一，全部有限', () => {
  const legal = new Set([SHOT_OUTCOMES.GOAL, SHOT_OUTCOMES.SAVE, SHOT_OUTCOMES.MISS, SHOT_OUTCOMES.BLOCKED]);
  for (let s = 0; s < 1000; s += 1) {
    const r = resolveShot(shot('h_fw'), blockCore(), { seed: `prop${s}`, debug: true });
    assert(r.ok && legal.has(r.outcome), `非法 outcome: ${r.outcome}`);
    for (const v of [r.execution.distance, r.execution.angle, r.execution.shotError, r.execution.saveProb, r.transit.duration]) {
      assert(Number.isFinite(v), 'NaN/Infinity');
    }
    assert(buildShotResolutionScope(blockCore(), 'h_fw', s, `prop${s}`).length > 0);
  }
});

test('SR-LongRun. 10000 Shot 分布；无 NaN/Infinity/非法坐标/非法 BallState', () => {
  const dist = { GOAL: 0, SAVE: 0, MISS: 0, BLOCKED: 0 };
  let bad = 0;
  for (let s = 0; s < 10000; s += 1) {
    const r = resolveShot(shot('h_fw'), blockCore(), { seed: `L${s}` });
    if (!r.ok || !(r.outcome in dist)) { bad += 1; continue; }
    dist[r.outcome] += 1;
    if (!Number.isFinite(r.execution.shotError)) bad += 1;
    if (r.actualDestination.x < 0 || r.actualDestination.x > 1 || r.actualDestination.y < 0 || r.actualDestination.y > 1) bad += 1;
    const next = applyShotStateUpdate(blockCore(), r);
    if (!(next.ball.state === 'IN_TRANSIT' && next.ball.control === null)) bad += 1;
  }
  assertEquals(bad, 0);
  assert(dist.GOAL + dist.SAVE + dist.MISS + dist.BLOCKED === 10000);
  // 记录分布（不作为 PASS/FAIL 依据）
  assert(true, `dist ${JSON.stringify(dist)}`);
});


// ===========================================================================
// 回归：PASS 未受影响
// ===========================================================================

test('SR-PASS-Regression. PASS Resolution 仍可用', () => {
  const core = coreOf([mk('h_a', H, 'MF', 0.40, 0.50, { passing: 95 }), mk('h_t', H, 'MF', 0.45, 0.50), mk('a_gk', A, 'GK', 0.95, 0.5)], 'h_a', H);
  const r = resolvePass({ actionType: 'PASS', actorId: 'h_a', target: { type: 'TEAMMATE', playerId: 'h_t' }, intent: 'SHORT', riskIntent: { level: 'MEDIUM' } }, core, { seed: 'x' });
  assertEquals(r.ok, true);
});
