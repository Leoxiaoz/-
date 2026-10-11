/**
 * Step 39F-M-C-07 —— SECOND_BALL Resolution Foundation 测试。
 *
 * 覆盖：
 * - Candidate Discovery / Eligibility（FREE 前置、无候选人、非法 id/team、不在场、超范围）；
 * - Competition（单/多候选、距离、到达优势、能力差异、deterministic winner、tie-break）；
 * - Result（SECOND_BALL_WON / NO_WINNER / INVALID）；
 * - State（FREE→CONTROLLED / FREE→FREE）；
 * - Possession（null→winner / null→null）；
 * - Integration（复用 C-06 唯一 mutation 层）；
 * - Idempotency / Deterministic；
 * - Math.random guard（runtime + source scan）；
 * - 架构红线：无第二套 Ball/Possession/Geometry Truth、无循环依赖、不改 PASS/SHOT。
 *
 * 红线：不接 Production Loop / Renderer；不改 C-05 Resolution 语义；不改 Save / Schema。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  resolveSecondBall, deriveSecondBallCandidates,
} from '../src/core/match/second-ball-resolution.js';
import {
  SECOND_BALL_OUTCOMES, SECOND_BALL_ELIGIBILITY,
} from '../src/core/match/second-ball-resolution-config.js';
import {
  integrateSecondBallResolution, resolveAndIntegrateSecondBall,
  checkMatchInvariants, INTEGRATION_REASONS,
} from '../src/core/match/interaction-integration.js';
import { applyInteractionStateUpdate } from '../src/core/match/interaction-state-update.js';
import { INTERACTION_BALL_STATE as BS } from '../src/core/match/interaction-resolution-config.js';

const H = 'clb_h', A = 'clb_a';
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');

const ATTRS = (o = {}) => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...o });
function mk(id, t, pos, x, y, attrs = {}, extra = {}) {
  return {
    playerId: id, teamId: t, position: pos, positionOnPitch: { x, y },
    onPitch: true, injured: false, sentOff: false, attributes: ATTRS(attrs),
    fitness: 100, form: 50, morale: 50, matchLoad: 0, ...extra,
  };
}
const tac = () => ({ formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' });

function coreOf(players, { ballPos = { x: 0.5, y: 0.5 }, state = BS.FREE, control = null, poss = null, movement = null } = {}) {
  const ball = { position: { ...ballPos }, control, possessingTeamId: poss };
  if (state) ball.state = state;
  const core = {
    worldId: 'w_sb7', season: 1, matchId: 'm_sb7', ruleVersion: 'match-second-ball-resolution-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball, players,
    tactical: { [H]: tac(), [A]: tac() },
  };
  if (movement) core.movement = movement;
  return core;
}

/** 默认单个合法候选人的 FREE 球场景。 */
const freeCore = (players = [mk('h_a', H, 'MF', 0.45, 0.5)]) => coreOf(players, { state: BS.FREE });

// ===========================================================================
// A. Candidate Discovery / Eligibility
// ===========================================================================

test('SB-01. FREE 球可产生 candidates（复用 ballRelation 几何口径）', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.45, 0.5), mk('a_a', A, 'DF', 0.55, 0.5)]);
  const d = deriveSecondBallCandidates(core);
  assertEquals(d.ballFree, true);
  assertEquals(d.candidates.length, 2);
  const c = d.candidates.find((x) => x.playerId === 'h_a');
  assert(Math.abs(c.distanceToBall - 0.05) < 1e-9, 'distanceToBall 应复用球-球员几何派生');
  assertEquals(typeof c.directionToBall.x, 'number');
  assertEquals(typeof c.closingSpeed, 'number');
  assertEquals(c.eligible, true);
});

test('SB-02. 非 FREE 球不启动 Second-Ball Resolution（INVALID + 候选 BALL_NOT_FREE）', () => {
  const core = coreOf([mk('h_a', H, 'MF', 0.45, 0.5)], { state: BS.CONTROLLED, control: 'h_a', poss: H });
  const d = deriveSecondBallCandidates(core);
  assertEquals(d.ballFree, false);
  assertEquals(d.candidates[0].eligibility, SECOND_BALL_ELIGIBILITY.BALL_NOT_FREE);
  const r = resolveSecondBall(core);
  assertEquals(r.ok, false);
  assertEquals(r.outcome, SECOND_BALL_OUTCOMES.INVALID);
  assertEquals(r.reason, 'BALL_NOT_FREE');
});

test('SB-03. 无候选人 → NO_WINNER，不凭空产生 possession', () => {
  const core = freeCore([]);
  const r = resolveSecondBall(core);
  assertEquals(r.outcome, SECOND_BALL_OUTCOMES.NO_WINNER);
  assertEquals(r.winner, null);
  assertEquals(r.control, null);
  assertEquals(r.possession.toPlayerId, null);
});

test('SB-04. 超出争抢半径 → 无资格（OUT_OF_RANGE）', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.10, 0.5)]); // 距离 0.40 > RANGE
  const d = deriveSecondBallCandidates(core);
  assertEquals(d.candidates[0].eligibility, SECOND_BALL_ELIGIBILITY.OUT_OF_RANGE);
  const r = resolveSecondBall(core);
  assertEquals(r.outcome, SECOND_BALL_OUTCOMES.NO_WINNER);
});

test('SB-05. 不在场球员 → NOT_AVAILABLE', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.45, 0.5, {}, { onPitch: false })]);
  const d = deriveSecondBallCandidates(core);
  assertEquals(d.candidates[0].eligibility, SECOND_BALL_ELIGIBILITY.NOT_AVAILABLE);
  assertEquals(resolveSecondBall(core).outcome, SECOND_BALL_OUTCOMES.NO_WINNER);
});

test('SB-06. 受伤 / 罚下球员 → NOT_AVAILABLE', () => {
  const injured = freeCore([mk('h_a', H, 'MF', 0.45, 0.5, {}, { injured: true })]);
  assertEquals(deriveSecondBallCandidates(injured).candidates[0].eligibility, SECOND_BALL_ELIGIBILITY.NOT_AVAILABLE);
  const sentOff = freeCore([mk('h_a', H, 'MF', 0.45, 0.5, {}, { sentOff: true })]);
  assertEquals(deriveSecondBallCandidates(sentOff).candidates[0].eligibility, SECOND_BALL_ELIGIBILITY.NOT_AVAILABLE);
});

test('SB-07. 非法球队 → INVALID_TEAM', () => {
  const core = freeCore([mk('h_a', 'clb_unknown', 'MF', 0.45, 0.5)]);
  assertEquals(deriveSecondBallCandidates(core).candidates[0].eligibility, SECOND_BALL_ELIGIBILITY.INVALID_TEAM);
  assertEquals(resolveSecondBall(core).outcome, SECOND_BALL_OUTCOMES.NO_WINNER);
});

test('SB-08. 非法 playerId → INVALID_PLAYER_ID', () => {
  const core = freeCore([mk(undefined, H, 'MF', 0.45, 0.5)]);
  assertEquals(deriveSecondBallCandidates(core).candidates[0].eligibility, SECOND_BALL_ELIGIBILITY.INVALID_PLAYER_ID);
});

test('SB-09. Candidate Discovery 只读且确定性（不修改 MatchCore）', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.45, 0.5)]);
  const before = JSON.stringify(core);
  const d1 = deriveSecondBallCandidates(core);
  const d2 = deriveSecondBallCandidates(core);
  assertEquals(JSON.stringify(d1), JSON.stringify(d2));
  assertEquals(JSON.stringify(core), before, 'Discovery 不得修改 MatchCore');
});

// ===========================================================================
// B. Competition
// ===========================================================================

test('SB-10. 单候选人 → SECOND_BALL_WON', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]);
  const r = resolveSecondBall(core);
  assertEquals(r.outcome, SECOND_BALL_OUTCOMES.WON);
  assertEquals(r.winner.playerId, 'h_a');
  assertEquals(r.winner.teamId, H);
  assert(r.winner.score > 0);
});

test('SB-11. 多候选人：距离更近者胜', () => {
  const core = freeCore([
    mk('h_a', H, 'MF', 0.48, 0.5),  // 距离 0.02
    mk('b_far', A, 'DF', 0.35, 0.5), // 距离 0.15（同能力）
  ]);
  const r = resolveSecondBall(core);
  assertEquals(r.outcome, SECOND_BALL_OUTCOMES.WON);
  assertEquals(r.winner.playerId, 'h_a');
});

test('SB-12. 能力差异（同距离）：relevantAbility 更高者胜', () => {
  const core = freeCore([
    mk('h_a', H, 'MF', 0.45, 0.5, { defending: 99, pace: 99 }),
    mk('a_a', A, 'DF', 0.45, 0.5, { defending: 10, pace: 10 }),
  ]);
  const r = resolveSecondBall(core);
  assertEquals(r.winner.playerId, 'h_a');
});

test('SB-13. 到达优势（closingSpeed）：向球移动者胜', () => {
  const core = freeCore([
    mk('h_a', H, 'MF', 0.45, 0.5),
    mk('a_a', A, 'DF', 0.45, 0.5),
  ]);
  // h_a 向球移动 → closingSpeed > 0；a_a 静止。
  core.movement = { players: { h_a: { target: { x: 0.5, y: 0.5 }, speed: 300 } } };
  const r = resolveSecondBall(core);
  assertEquals(r.winner.playerId, 'h_a');
  const cand = r.candidates.find((c) => c.playerId === 'h_a');
  assert(cand.components.closing > 0, 'closing 分量应 > 0');
});

test('SB-14. deterministic winner：相同输入两次结果一致', () => {
  const players = [mk('h_a', H, 'MF', 0.46, 0.5), mk('a_a', A, 'DF', 0.44, 0.5)];
  const r1 = resolveSecondBall(freeCore(players));
  const r2 = resolveSecondBall(freeCore(players));
  assertEquals(r1.winner.playerId, r2.winner.playerId);
  assertEquals(JSON.stringify(r1), JSON.stringify(r2));
});

test('SB-15. tie-break：同分同距 → playerId 升序（稳定键）', () => {
  const core = freeCore([
    mk('h_b', H, 'MF', 0.45, 0.5),
    mk('h_a', H, 'MF', 0.45, 0.5),
  ]);
  const r = resolveSecondBall(core);
  assertEquals(r.winner.playerId, 'h_a');
});

test('SB-16. 排序不依赖 players 数组迭代顺序', () => {
  const p1 = mk('h_a', H, 'MF', 0.45, 0.5);
  const p2 = mk('h_b', H, 'MF', 0.45, 0.5);
  const a = resolveSecondBall(freeCore([p1, p2]));
  const b = resolveSecondBall(freeCore([p2, p1]));
  assertEquals(a.winner.playerId, b.winner.playerId);
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

// ===========================================================================
// C. Result
// ===========================================================================

test('SB-17. SECOND_BALL_WON：winner / ball / possession 语义完整', () => {
  const r = resolveSecondBall(freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]));
  assertEquals(r.type, 'SECOND_BALL_RESOLUTION');
  assertEquals(r.ok, true);
  assertEquals(r.outcome, SECOND_BALL_OUTCOMES.WON);
  assertEquals(r.ball.state, BS.CONTROLLED);
  assertEquals(r.ball.inTransit, false);
  assertEquals(r.control, 'h_a');
  assertEquals(r.possession.changed, true);
  assertEquals(r.possession.toPlayerId, 'h_a');
  assertEquals(r.possession.toTeamId, H);
});

test('SB-18. SECOND_BALL_NO_WINNER：球保持 FREE，无 possession', () => {
  const r = resolveSecondBall(freeCore([]));
  assertEquals(r.type, 'SECOND_BALL_RESOLUTION');
  assertEquals(r.ok, true);
  assertEquals(r.outcome, SECOND_BALL_OUTCOMES.NO_WINNER);
  assertEquals(r.ball.state, BS.FREE);
  assertEquals(r.winner, null);
  assertEquals(r.control, null);
  assertEquals(r.requiresFollowUp, true);
  assertEquals(r.followUpKind, 'SECOND_BALL');
});

test('SB-19. SECOND_BALL_INVALID：非法输入 → 无球终态', () => {
  const r = resolveSecondBall(null);
  assertEquals(r.ok, false);
  assertEquals(r.outcome, SECOND_BALL_OUTCOMES.INVALID);
  assertEquals(r.ball.state, null);
  assertEquals(r.possession.toPlayerId, null);
});

test('SB-20. Result API 字段完整（纯数据、可序列化、可逐值比较）', () => {
  const r = resolveSecondBall(freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]));
  for (const k of ['type', 'actionType', 'ok', 'outcome', 'reason', 'ball', 'winner', 'control', 'possession', 'candidates', 'resolutionMeta']) {
    assert(k in r, `Result 缺少字段 ${k}`);
  }
  assert(!('matchCore' in r), 'Result 不得持有 authoritative MatchCore');
  assertEquals(JSON.parse(JSON.stringify(r)).outcome, r.outcome, '可序列化');
});

test('SB-21. candidate score 可解释（components.score === score）', () => {
  const r = resolveSecondBall(freeCore([mk('h_a', H, 'MF', 0.45, 0.5)]));
  const c = r.candidates[0];
  assertEquals(c.score, c.components.score);
  for (const k of ['proximity', 'closing', 'ability', 'context']) {
    assert(typeof c.components[k] === 'number', `缺少可解释分量 ${k}`);
  }
});

// ===========================================================================
// D. State（Integration 是唯一 mutation 层）
// ===========================================================================

test('SB-22. FREE → CONTROLLED：获胜者建立 control / team', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]);
  const r = resolveSecondBall(core);
  const e = integrateSecondBallResolution(core, r);
  assertEquals(e.applied, true);
  assertEquals(e.reason, INTEGRATION_REASONS.APPLIED);
  assertEquals(e.matchCore.ball.state, BS.CONTROLLED);
  assertEquals(e.matchCore.ball.control, 'h_a');
  assertEquals(e.matchCore.ball.possessingTeamId, H);
  assertEquals(e.invariantIssues, []);
  assertEquals(checkMatchInvariants(e.matchCore), []);
});

test('SB-23. FREE → FREE：NO_WINNER 不产生 control', () => {
  const core = freeCore([]);
  const r = resolveSecondBall(core);
  const e = integrateSecondBallResolution(core, r);
  assertEquals(e.matchCore.ball.state, BS.FREE);
  assertEquals(e.matchCore.ball.control, null);
  assertEquals(e.matchCore.ball.possessingTeamId, null);
  assertEquals(e.invariantIssues, []);
  assertEquals(checkMatchInvariants(e.matchCore), []);
});

test('SB-24. Resolution 不直接修改 MatchCore；Integration 返回新对象', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]);
  const before = JSON.stringify(core);
  const r = resolveSecondBall(core);
  assertEquals(JSON.stringify(core), before, 'Resolution 不得修改 MatchCore');
  const e = integrateSecondBallResolution(core, r);
  assertEquals(JSON.stringify(core), before, 'Integration 不得原地修改输入');
  assert(e.matchCore !== core && e.matchCore.ball !== core.ball, '应返回新对象');
});

test('SB-25. 输入 Result / MatchCore 不可变', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]);
  const r = resolveSecondBall(core);
  const rBefore = JSON.stringify(r);
  const cBefore = JSON.stringify(core);
  integrateSecondBallResolution(core, r);
  assertEquals(JSON.stringify(r), rBefore);
  assertEquals(JSON.stringify(core), cBefore);
});

test('SB-26. 不注入第二套 Truth（顶层键不变）', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]);
  const e = integrateSecondBallResolution(core, resolveSecondBall(core));
  assertEquals(Object.keys(e.matchCore).sort(), Object.keys(core).sort());
  assert(!('secondBall' in e.matchCore) && !('possession' in e.matchCore), '不得注入独立 possession/second-ball truth');
});

// ===========================================================================
// E. Possession
// ===========================================================================

test('SB-27. 获胜：null → winner（possession 建立）', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]);
  assertEquals(core.ball.control, null);
  const e = integrateSecondBallResolution(core, resolveSecondBall(core));
  assertEquals(e.matchCore.ball.control, 'h_a');
  assertEquals(e.matchCore.ball.possessingTeamId, H);
});

test('SB-28. 无人获胜：null → null（possession 不产生）', () => {
  const core = freeCore([]);
  const e = integrateSecondBallResolution(core, resolveSecondBall(core));
  assertEquals(e.matchCore.ball.control, null);
  assertEquals(e.matchCore.ball.possessingTeamId, null);
});

// ===========================================================================
// F. Idempotency
// ===========================================================================

test('SB-29. 同一 WON Result 重复消费不产生二次转移 / 漂移', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]);
  const r = resolveSecondBall(core);
  const e1 = integrateSecondBallResolution(core, r);
  const e2 = integrateSecondBallResolution(e1.matchCore, r);
  assertEquals(e1.applied, true);
  assertEquals(e2.applied, false);
  assertEquals(e2.reason, INTEGRATION_REASONS.ALREADY_APPLIED);
  assertEquals(JSON.stringify(e2.matchCore), JSON.stringify(e1.matchCore));
  assertEquals(e2.matchCore.ball.control, 'h_a');
});

test('SB-30. 同一 NO_WINNER Result 重复消费不漂移', () => {
  const core = freeCore([]);
  const r = resolveSecondBall(core);
  const e1 = integrateSecondBallResolution(core, r);
  const e2 = integrateSecondBallResolution(e1.matchCore, r);
  assertEquals(e2.applied, false);
  assertEquals(JSON.stringify(e2.matchCore), JSON.stringify(e1.matchCore));
  assertEquals(e2.matchCore.ball.state, BS.FREE);
});

// ===========================================================================
// G. Deterministic
// ===========================================================================

test('SB-31. 相同输入两次 → JSON(result1) === JSON(result2)', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.46, 0.5), mk('a_a', A, 'DF', 0.44, 0.5)]);
  assertEquals(JSON.stringify(resolveSecondBall(core)), JSON.stringify(resolveSecondBall(core)));
});

test('SB-32. 相同输入经 Integration → JSON(core1) === JSON(core2)', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]);
  const a = integrateSecondBallResolution(core, resolveSecondBall(core));
  const b = integrateSecondBallResolution(core, resolveSecondBall(core));
  assertEquals(JSON.stringify(a.matchCore), JSON.stringify(b.matchCore));
});

test('SB-33. resolveAndIntegrateSecondBall 编排确定性', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]);
  const a = resolveAndIntegrateSecondBall(core);
  const b = resolveAndIntegrateSecondBall(core);
  assertEquals(JSON.stringify(a.result), JSON.stringify(b.result));
  assertEquals(JSON.stringify(a.matchCore), JSON.stringify(b.matchCore));
  assertEquals(a.result.type, 'SECOND_BALL_RESOLUTION');
});

// ===========================================================================
// H. Math.random Guard
// ===========================================================================

test('SB-34. runtime guard：Resolution / Integration 不调用 Math.random', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Second-Ball 不应调用 Math.random'); };
  try {
    const core = freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]);
    resolveSecondBall(core);
    integrateSecondBallResolution(core, resolveSecondBall(core));
    resolveAndIntegrateSecondBall(core);
  } finally {
    Math.random = original;
  }
});

test('SB-35. source scan：C-07 源码无 Math.random 调用', () => {
  for (const f of ['second-ball-resolution.js', 'second-ball-resolution-config.js']) {
    assert(!/Math\.random\s*\(/.test(readSrc(f)), `${f} 出现 Math.random 调用`);
  }
});

// ===========================================================================
// I. Architecture Audit
// ===========================================================================

test('SB-36. 无第二套 Ball / Possession Truth（Result 不写入状态）', () => {
  const core = freeCore([mk('h_a', H, 'MF', 0.47, 0.5)]);
  const r = resolveSecondBall(core);
  assert(!('ball' in core && core.ball !== undefined && r.ball === core.ball), 'Result.ball 不得是 MatchCore.ball 的引用');
  const e = integrateSecondBallResolution(core, r);
  assert(!('secondBallResolution' in e.matchCore), '不得保存 Resolution 结果');
});

test('SB-37. 不建立第二套 Geometry（复用 ball-facts；不依赖 physics/decision）', () => {
  const importsOf = (name) => {
    const re = /from\s+['"]\.\/([a-z0-9-]+)\.js['"]/g;
    const found = new Set();
    let m;
    while ((m = re.exec(readSrc(name))) !== null) found.add(m[1]);
    return found;
  };
  const imps = importsOf('second-ball-resolution.js');
  assert(imps.has('ball-facts'), '应复用 ball-facts 几何派生');
  for (const bad of ['ball-physics', 'decision-pipeline', 'decision-candidates', 'interaction-integration', 'interaction-state-update']) {
    assert(!imps.has(bad), `second-ball-resolution 不应依赖 ${bad}`);
  }
});

test('SB-38. 无循环依赖（C-07 导入图无环）', () => {
  const importsOf = (name) => {
    const re = /from\s+['"]\.\/([a-z0-9-]+)\.js['"]/g;
    const found = new Set();
    let m;
    while ((m = re.exec(readSrc(name))) !== null) found.add(m[1]);
    return found;
  };
  const graph = {
    'second-ball-resolution.js': importsOf('second-ball-resolution.js'),
    'second-ball-resolution-config.js': importsOf('second-ball-resolution-config.js'),
    'ball-facts.js': importsOf('ball-facts.js'),
    'player-situation.js': importsOf('player-situation.js'),
    'interaction-integration.js': importsOf('interaction-integration.js'),
    'interaction-state-update.js': importsOf('interaction-state-update.js'),
    'interaction-resolution.js': importsOf('interaction-resolution.js'),
  };
  const seen = new Set();
  const stack = new Set();
  const visit = (node) => {
    if (stack.has(node)) throw new Error(`检测到循环依赖：${node}`);
    if (seen.has(node)) return;
    stack.add(node);
    for (const dep of graph[node] ?? []) if (dep in graph) visit(dep);
    stack.delete(node);
    seen.add(node);
  };
  for (const n of Object.keys(graph)) visit(n);
});

test('SB-39. PASS / SHOT Resolution 未被修改', () => {
  for (const f of ['pass-resolution.js', 'shot-resolution.js', 'pass-state-update.js', 'shot-state-update.js']) {
    assert(!readSrc(f).includes('second-ball'), `${f} 不应引用 second-ball 模块`);
  }
});

test('SB-40. Resolution 与 State Mutation 分离（resolution 不 import / 不调用 mutation 层）', () => {
  const src = readSrc('second-ball-resolution.js');
  const importsOf = (text) => {
    const re = /from\s+['"]\.\/([a-z0-9-]+)\.js['"]/g;
    const found = new Set();
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1]);
    return found;
  };
  assert(!importsOf(src).has('interaction-state-update'), 'Resolution 不得 import state-update');
  assert(!/applyInteractionStateUpdate\s*\(/.test(src), 'Resolution 不得调用 mutation 层');
});

// ===========================================================================
// J. C-05 followUp 语义衔接
// ===========================================================================

test('SB-41. 兼容 C-05 followUp：loose 球 → FREE → Second-Ball 可消费', () => {
  // 构造 C-05 loose 终态语义（PRESS_SUCCESS）→ 经同一个 state-update mutation 层落地为 FREE。
  const core = coreOf([mk('a_c', A, 'MF', 0.47, 0.5), mk('h_d', H, 'DF', 0.44, 0.5)],
    { state: BS.CONTROLLED, control: 'a_c', poss: A });
  const looseResult = {
    type: 'INTERACTION_RESOLUTION', actionType: 'PRESS', ok: true, outcome: 'PRESS_SUCCESS', reason: 'x',
    actorId: 'h_d', targetId: 'a_c',
    ball: { position: { x: 0.47, y: 0.5 }, state: BS.FREE, inTransit: false },
    possession: { changed: true, retained: false, loose: true, fromPlayerId: 'a_c', fromTeamId: A, toPlayerId: null, toTeamId: null },
    looseBall: true, requiresFollowUp: true, followUpKind: 'SECOND_BALL',
  };
  const free = applyInteractionStateUpdate(core, looseResult);
  assertEquals(free.ball.state, BS.FREE);
  assertEquals(free.ball.control, null);
  // FREE 球 → 二点球解析（C-07 消费 C-05 的 followUp 语义）。
  const r = resolveSecondBall(free);
  assertEquals(r.ok, true);
  assert(r.outcome === SECOND_BALL_OUTCOMES.WON || r.outcome === SECOND_BALL_OUTCOMES.NO_WINNER);
});