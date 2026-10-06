/**
 * Step 39F-M-C-44 —— Player Position Tick Integration Implementation 测试。
 *
 * 覆盖（P1–P10 + 附加边界）：
 * - PPT-01 (P1)  PLAYER_MOVEMENT 阶段执行（position 推进）；
 * - PPT-02 (P2)  无 Movement 输入 → position 不变；
 * - PPT-03 (P3)  dt = 0 → position 不变且 movement 状态不推进；
 * - PPT-04 (P4)  dt 来源（显式 deltaTime 被采用）；
 * - PPT-05 (P4)  dt 缺省 = TICK_DURATION_SECONDS；
 * - PPT-06 (P5)  Ball State Isolation；
 * - PPT-07 (P6)  Transit Isolation；
 * - PPT-08 (P7)  Snapshot Isolation（Pre-Tick / 仅 Ball facts）；
 * - PPT-09 (P8)  Determinism（重复运行逐帧一致）；
 * - PPT-10 (P9)  Contact Isolation（lastTouchPlayerId 不变）；
 * - PPT-11 (P10) Writer Audit / Source Guard；
 * - PPT-12       Tick 顺序冻结（SNAPSHOT → PLAYER_MOVEMENT → CONTINUOUS_TRANSIT）；
 * - PPT-13       Boundary 原因码（INVALID / NO_PLAYERS / DT_ZERO / MOVED）；
 * - PPT-14       多 Player 稳定顺序（order-stable / 可复现）。
 *
 * 红线：不接 Contact；不改 C-39；不改 Movement 方程；不改 Schema。
 */

import { test, assert, assertEquals } from './harness.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runMatchTick } from '../src/core/match/match-tick.js';
import {
  advancePlayerPositionTick, PLAYER_POSITION_TICK_REASON as R,
} from '../src/core/match/player-position-tick-integration.js';
import { MATCH_CLOCK_CONFIG } from '../src/core/match/match-clock-config.js';

const H = 'clb_h', A = 'clb_a';
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/core/match');
const readSrc = (name) => readFileSync(join(SRC_DIR, name), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const ATTRS = () => ({ pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70 });
function mk(id, t, pos, x, y, extra = {}) {
  return {
    playerId: id, teamId: t, position: pos, positionOnPitch: { x, y },
    onPitch: true, injured: false, sentOff: false, attributes: ATTRS(),
    fitness: 100, form: 50, morale: 50, matchLoad: 0, ...extra,
  };
}
const tac = () => ({ formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium' });

function mkCore({ players = [], ball = {}, clockSim = 0 } = {}) {
  return {
    worldId: 'w', season: 1, matchId: 'm', ruleVersion: 'match-tick-v1',
    teams: { home: H, away: A },
    clock: { simulationTime: clockSim, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    tactical: { [H]: tac(), [A]: tac() },
    ball: {
      position: { x: 0.5, y: 0.5 }, velocity: { x: 0, y: 0 }, state: 'FREE',
      control: null, possessingTeamId: null, contacting: [], lastTouchPlayerId: null, ...ball,
    },
    players,
  };
}
/** 用于「可移动」场景：远离阵型锚点。 */
const movers = () => [
  mk('h1', H, 'MF', 0.10, 0.10),
  mk('h2', H, 'FW', 0.90, 0.90),
  mk('a1', A, 'DF', 0.80, 0.20),
];
const positions = (core) => core.players.map((p) => `${p.playerId}:${p.positionOnPitch.x},${p.positionOnPitch.y}`).join('|');
const posEq = (a, b) => positions(a) === positions(b);

// ===========================================================================
// P1–P3：阶段执行 / 无输入 / dt=0
// ===========================================================================

test('PPT-01 (P1). PLAYER_MOVEMENT 阶段执行并推进 positionOnPitch', () => {
  const core = mkCore({ players: movers() });
  const before = positions(core);
  const t = runMatchTick(core, { tickIndex: 0, deltaTime: 1 });
  assert(t.tick.stages.includes('player_movement'), '必须包含 player_movement 阶段');
  assertEquals(t.applied.playerMovement, true);
  assert(t.events.some((e) => e.type === 'PLAYER_MOVEMENT_APPLIED'), '必须有 PLAYER_MOVEMENT_APPLIED 事件');
  assert(positions(t.matchCore) !== before, '存在有效 Movement 输入时 position 必须推进');
  // 输入 MatchCore 不被原地修改
  assertEquals(positions(core), before);
});

test('PPT-02 (P2). 无 Movement 输入 → position 不变', () => {
  // 全部球员不可上场（onPitch=false）→ 无移动。
  const core = mkCore({ players: movers().map((p) => ({ ...p, onPitch: false })) });
  const t = runMatchTick(core, { tickIndex: 0, deltaTime: 1 });
  assert(posEq(t.matchCore, core), '无 Movement 输入时 position 必须不变');
});

test('PPT-03 (P3). dt = 0 → position 不变且 movement 状态不推进', () => {
  const core = mkCore({ players: movers() });
  const t = runMatchTick(core, { tickIndex: 0, deltaTime: 0 });
  assert(posEq(t.matchCore, core), 'dt=0 不得产生 Position drift');
  assertEquals(t.applied.playerMovement, false);
  assertEquals(t.matchCore.movement, undefined, 'dt=0 不得推进 movement 状态');
  // 直接调用 Boundary 同样 no-op。
  const direct = advancePlayerPositionTick(core, 0);
  assertEquals(direct.reason, R.DT_ZERO);
  assertEquals(direct.applied, false);
  assert(posEq(direct.matchCore, core));
});

// ===========================================================================
// P4：dt 来源
// ===========================================================================

test('PPT-04 (P4). dt 来源 = 显式 deltaTime（simulation seconds）', () => {
  const core = mkCore({ players: movers() });
  const res = advancePlayerPositionTick(core, 0.5);
  assertEquals(res.deltaTime, 0.5);
  assertEquals(res.applied, true);
  // 不同 dt → 不同推进幅度（非 0）。
  const p1 = positions(advancePlayerPositionTick(core, 0.5).matchCore);
  const p2 = positions(advancePlayerPositionTick(core, 1).matchCore);
  assert(p1 !== p2, '不同 dt 应产生不同位置（dt 被正确采用）');
});

test('PPT-05 (P4). deltaTime 缺省 → 使用 TICK_DURATION_SECONDS', () => {
  const core = mkCore({ players: movers() });
  const omitted = runMatchTick(core, { tickIndex: 0 });
  const explicit = runMatchTick(core, { tickIndex: 0, deltaTime: MATCH_CLOCK_CONFIG.TICK_DURATION_SECONDS });
  assertEquals(JSON.stringify(omitted.matchCore), JSON.stringify(explicit.matchCore));
});

// ===========================================================================
// P5–P7：Ball / Transit / Snapshot 隔离
// ===========================================================================

test('PPT-06 (P5). Ball State Isolation：Player Movement 不改 Ball', () => {
  const core = mkCore({ players: movers(), ball: { position: { x: 0.5, y: 0.5 }, velocity: { x: 0.3, y: -0.2 }, state: 'FREE' } });
  const ballBefore = JSON.stringify(core.ball);
  const t = runMatchTick(core, { tickIndex: 0, deltaTime: 1 });
  assertEquals(JSON.stringify(t.matchCore.ball), ballBefore, 'ball.position/velocity/state/transit 必须完全一致');
  // Boundary 单独调用亦不得触碰 Ball。
  assertEquals(JSON.stringify(advancePlayerPositionTick(core, 1).matchCore.ball), ballBefore);
});

test('PPT-07 (P6). Transit Isolation：已有 transit 不得被修改', () => {
  const transit = { from: { x: 0.3, y: 0.5 }, to: { x: 0.7, y: 0.5 }, duration: 2, elapsed: 0.3, progress: 0.15, outcome: 'PASS' };
  const core = mkCore({ players: movers(), ball: { position: { x: 0.36, y: 0.5 }, state: 'IN_TRANSIT', transit } });
  const tBefore = JSON.stringify(core.ball.transit);
  const res = advancePlayerPositionTick(core, 1);
  assertEquals(JSON.stringify(res.matchCore.ball.transit), tBefore, 'PLAYER_MOVEMENT 不得修改/提前完成 transit');
});

test('PPT-08 (P7). Snapshot Isolation：Snapshot 仍为 Pre-Tick 且仅含 Ball facts', () => {
  const core = mkCore({ players: movers(), ball: { position: { x: 0.4, y: 0.5 }, state: 'FREE' } });
  const t = runMatchTick(core, { tickIndex: 5, deltaTime: 1 });
  const snap = t.tick.snapshot;
  assertEquals(Object.keys(snap).sort(), ['ballState', 'control', 'inTransit', 'possessingTeamId', 'tickIndex'].sort());
  assertEquals(snap.tickIndex, 5);
  assertEquals(snap.ballState, 'FREE');
  assert(!('players' in snap) && !('positionOnPitch' in snap), 'Snapshot 不得注入 Player Position');
  // 顺序：snapshot 先于 player_movement。
  const s = t.tick.stages;
  assert(s.indexOf('snapshot') < s.indexOf('player_movement'));
});

// ===========================================================================
// P8：确定性
// ===========================================================================

test('PPT-09 (P8). Determinism：相同输入逐帧一致', () => {
  const core = mkCore({ players: movers() });
  const r1 = runMatchTick(core, { tickIndex: 0, deltaTime: 1 });
  const r2 = runMatchTick(core, { tickIndex: 0, deltaTime: 1 });
  assertEquals(JSON.stringify(r1.matchCore), JSON.stringify(r2.matchCore));

  // 多 Tick 序列
  const runSeq = () => {
    let c = mkCore({ players: movers() });
    const frames = [];
    for (let i = 0; i < 5; i += 1) { c = runMatchTick(c, { tickIndex: i, deltaTime: 1 }).matchCore; frames.push(positions(c)); }
    return frames.join('#');
  };
  assertEquals(runSeq(), runSeq());
});

// ===========================================================================
// P9：Contact 隔离
// ===========================================================================

test('PPT-10 (P9). Contact Isolation：存在 Player Position 也不自动产生 Contact', () => {
  // 球员与球完全重合（若传 players 会触发 C-03 Contact）。
  const core = mkCore({ players: [mk('h1', H, 'MF', 0.50, 0.50), mk('a1', A, 'DF', 0.50, 0.50)], ball: { position: { x: 0.5, y: 0.5 }, state: 'FREE' } });
  const t = runMatchTick(core, { tickIndex: 0, deltaTime: 1 });
  assertEquals(t.matchCore.ball.lastTouchPlayerId, null, 'PLAYER_MOVEMENT 不得产生 Contact / lastTouch');
  assertEquals((t.matchCore.ball.contacting ?? []).length, 0);
  assert(!t.events.some((e) => /CONTACT|COLLISION/.test(e.type)), '不得出现 Contact 事件');
});

// ===========================================================================
// P10：Writer Audit / Source Guard
// ===========================================================================

test('PPT-11 (P10). Writer Audit：唯一 Position Truth / 不触碰 Ball / 不接 Contact', () => {
  const boundary = stripComments(readSrc('player-position-tick-integration.js'));
  const tick = stripComments(readSrc('match-tick.js'));

  // Boundary 仅依赖 movement-update（不依赖 Ball / Contact / Interaction 模块）。
  assert(/from\s+['"]\.\/movement-update\.js['"]/.test(boundary), 'Boundary 必须复用 updateMovement');
  assert(!/ball-physics|continuous-ball-movement|ball-contact|interaction-/.test(boundary), 'Boundary 不得依赖 Ball / Contact / Interaction 模块');
  // Boundary 不得写任何 Ball 字段 / 不得赋值 positionOnPitch（只经 updateMovement）。
  assert(!/ball\.(position|velocity|transit|state)\s*=/.test(boundary), 'Boundary 不得写 Ball');
  assert(!/positionOnPitch\s*:/.test(boundary), 'Boundary 不得自建 Position 对象（委托 updateMovement）');
  // 不得第二套 Player Position Truth。
  assert(!/tickPosition|simulationPosition|runtimePosition|nextPosition\s*:/.test(boundary), '不得新增第二套 Player Position Truth');

  // C-08 不得向 Continuous Transit 传 players（禁止 Contact 接线）。
  assert(!/advanceContinuousBallMovement\([^)]*players/.test(tick), 'C-08 不得向 Continuous Transit 传 players');
  // C-08 不再直接持有 Ball 提取逻辑（仅编排）。
  assert(/advancePlayerPositionTick/.test(tick), 'C-08 必须调用 Player Position Boundary');
});

test('PPT-12. Tick 顺序冻结：SNAPSHOT → PLAYER_MOVEMENT → CONTINUOUS_TRANSIT', () => {
  const t = runMatchTick(mkCore({ players: movers() }), { tickIndex: 0, deltaTime: 1 });
  const s = t.tick.stages;
  assert(s.indexOf('snapshot') < s.indexOf('player_movement'));
  assert(s.indexOf('player_movement') < s.indexOf('continuous_transit'));
  // 不得在 CONTINUOUS_TRANSIT 之后。
  assert(s.indexOf('player_movement') < s.indexOf('action') || !s.includes('action'));
});

test('PPT-13. Boundary 原因码（INVALID_MATCHCORE / NO_PLAYERS / DT_ZERO / MOVED）', () => {
  assertEquals(advancePlayerPositionTick(null, 1).reason, R.INVALID_MATCHCORE);
  assertEquals(advancePlayerPositionTick({}, 1).reason, R.INVALID_MATCHCORE);
  assertEquals(advancePlayerPositionTick({ players: [] }, 1).reason, R.NO_PLAYERS);
  const core = mkCore({ players: movers() });
  assertEquals(advancePlayerPositionTick(core, 0).reason, R.DT_ZERO);
  assertEquals(advancePlayerPositionTick(core, 1).reason, R.MOVED);
  // 非法 dt（负数 / 非有限 / 非数字）→ 归一化为 0。
  assertEquals(advancePlayerPositionTick(core, -1).reason, R.DT_ZERO);
  assertEquals(advancePlayerPositionTick(core, Number.NaN).reason, R.DT_ZERO);
  assertEquals(advancePlayerPositionTick(core, undefined).reason, R.DT_ZERO);
});

test('PPT-14. 多 Player 稳定顺序（order-stable / 可复现）', () => {
  const core = mkCore({ players: movers() });
  const res = advancePlayerPositionTick(core, 1);
  assertEquals(res.matchCore.players.map((p) => p.playerId), core.players.map((p) => p.playerId), 'Player 顺序必须稳定');
  assertEquals(positions(res.matchCore), positions(advancePlayerPositionTick(core, 1).matchCore), '相同输入必须可复现');
});

test('PPT-15. Wall-clock / RNG guard（Boundary 与 match-tick）', () => {
  for (const f of ['player-position-tick-integration.js', 'match-tick.js', 'match-tick-config.js']) {
    const src = stripComments(readSrc(f));
    assert(!/Date\.now\s*\(|performance\.now\s*\(|new\s+Date\s*\(|Math\.random\s*\(/.test(src), `${f} 出现墙钟 / RNG 依赖`);
  }
});