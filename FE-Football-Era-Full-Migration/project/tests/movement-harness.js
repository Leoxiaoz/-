/**
 * Headless Movement Match Loop Harness（Step 39F-M-C-02）。
 * 层级归属：**Test / Harness only**。不进入生产代码，不接 Season / Schedule / Competition / Save / UI。
 *
 * 目标：驱动 `updateMovement` 跑完整 90 分钟 × 22 人，采集不变量、层级统计、性能与振荡数据。
 * 红线：不产生正式比赛结果；不改 Score / Stats / Growth / Training / Save / Schema；不使用 Math.random。
 */

import { buildTacticalContext } from '../src/core/match/tactical-context.js';
import { buildTeamShape } from '../src/core/match/team-shape.js';
import { updateMovement } from '../src/core/match/movement-update.js';
import { LOCOMOTION, MOVEMENT_LEVEL, PITCH_BOUNDS } from '../src/core/match/movement-config.js';
import { basePlayers, tactical, H, A } from './movement-fixtures.js';

const MAX_STEP = LOCOMOTION.MAX_SPEED;
const EPS = 1e-9;

/** 构造一个完整但最小化的 22 人 MatchCoreState。 */
export function buildHarnessCore({ seed = 's1', ballPos = { x: 0.5, y: 0.5 }, ballControl = 'h_mf1', possessingTeamId = H, tacticalState = {} } = {}) {
  const players = basePlayers().map((p) => ({ ...p, positionOnPitch: { ...p.positionOnPitch } }));
  return {
    worldId: 'w_harness',
    season: 1,
    matchId: `m_${seed}`,
    ruleVersion: 'match-movement-v1',
    seed, // 记录用；Movement 当前不消费 RNG
    teams: { home: H, away: A },
    clock: { simulationTime: 0, matchDuration: 90, half: 1, status: 'in_play' },
    score: { home: 0, away: 0 },
    ball: { position: { ...ballPos }, control: ballControl, possessingTeamId },
    players,
    tactical: { [H]: tactical(tacticalState[H]), [A]: tactical(tacticalState[A]) },
  };
}

function isFinitePos(pos) {
  return pos && Number.isFinite(pos.x) && Number.isFinite(pos.y);
}

function inBounds(pos) {
  return pos.x >= PITCH_BOUNDS.MIN - EPS && pos.x <= PITCH_BOUNDS.MAX + EPS
    && pos.y >= PITCH_BOUNDS.MIN - EPS && pos.y <= PITCH_BOUNDS.MAX + EPS;
}

/** 每队 Shape 摘要（用于确定性比较）。 */
function shapeSig(core, teamId) {
  const tac = core.tactical?.[teamId] ?? {};
  const ctx = buildTacticalContext(core, teamId);
  const shape = buildTeamShape(core, teamId, ctx, {
    formation: tac.formation ?? '4-4-2', mentality: tac.mentality ?? 'balanced',
    possessionStyle: tac.possessionStyle ?? 'balanced', pressingIntensity: tac.pressingIntensity ?? tac.pressing ?? 'medium',
    defensiveLine: tac.defensiveLine ?? 'medium', width: tac.width ?? 'medium', tempo: tac.tempo ?? 'medium', transitionStyle: tac.transitionStyle ?? 'balanced',
  });
  return { kind: shape.kind, width: shape.width, depth: shape.depth, compactness: shape.compactness, lineHeight: shape.lineHeight };
}

function ctxSig(core, teamId) {
  const c = buildTacticalContext(core, teamId);
  return { phase: c.phase, tenure: c.possessionTenure, zone: c.ballZone, channel: c.ballChannel, block: c.blockHeight, buildUp: c.buildUpPhase };
}

/**
 * 运行 Headless Movement Match Loop。
 * @param {object} core 初始 MatchCoreState
 * @param {{dt?:number, durationMinutes?:number, record?:boolean}} [options]
 * @returns {object} { finalCore, stats, violations, history }
 */
export function runHarness(core, options = {}) {
  const dt = Number.isFinite(options.dt) && options.dt > 0 ? options.dt : 0.5;
  const duration = Number.isFinite(options.durationMinutes) && options.durationMinutes > 0 ? options.durationMinutes : 90;
  const record = !!options.record;
  const ticks = Math.round(duration / dt);

  const violations = [];
  const stats = {
    ticks: 0, simulationMinutes: 0, locomotionUpdates: 0,
    L0: 0, L1: 0, L2: 0, targetResolves: 0, intentSelections: 0,
    wallMs: 0, maxTickMs: 0, playerTicks: 0,
  };
  const history = record ? { positions: [], intents: [], targets: [], ctx: [], shape: [] } : null;

  let current = core;
  let prevPos = new Map(current.players.map((p) => [p.playerId, { ...p.positionOnPitch }]));
  const t0 = Date.now();

  for (let i = 0; i < ticks; i += 1) {
    const tickStart = Date.now();
    const beforeLevels = current.movement?.players ?? {};
    let next = updateMovement(current, dt, {});

    // 统计层级（按 tick 后 movement.players 的 level 聚合）
    const mov = next.movement?.players ?? {};
    for (const id of Object.keys(mov)) {
      const lv = mov[id].level;
      if (lv === MOVEMENT_LEVEL.L0) stats.L0 += 1;
      else if (lv === MOVEMENT_LEVEL.L1) { stats.L1 += 1; stats.intentSelections += 1; stats.targetResolves += 1; }
      else if (lv === MOVEMENT_LEVEL.L2) { stats.L2 += 1; stats.intentSelections += 1; stats.targetResolves += 1; }
    }
    void beforeLevels;

    // 不变量 + 位移
    const posRow = [];
    const intentRow = {};
    const targetRow = {};
    for (const p of next.players) {
      const pos = p.positionOnPitch;
      if (!isFinitePos(pos)) violations.push({ tick: i, type: 'position-nonfinite', playerId: p.playerId, pos });
      else if (!inBounds(pos)) violations.push({ tick: i, type: 'position-out-of-bounds', playerId: p.playerId, pos });

      const st = mov[p.playerId];
      if (st) {
        if (!Number.isFinite(st.speed)) violations.push({ tick: i, type: 'speed-nonfinite', playerId: p.playerId });
        else if (st.speed < LOCOMOTION.MIN_SPEED - EPS || st.speed > LOCOMOTION.MAX_SPEED + EPS) {
          violations.push({ tick: i, type: 'speed-out-of-range', playerId: p.playerId, speed: st.speed });
        }
        const prev = prevPos.get(p.playerId);
        const moved = Math.hypot(pos.x - prev.x, pos.y - prev.y);
        const bound = MAX_STEP * dt + LOCOMOTION.ARRIVE_RADIUS + 1e-6;
        if (moved > bound) violations.push({ tick: i, type: 'teleport', playerId: p.playerId, moved, bound });
        intentRow[p.playerId] = st.intent;
        targetRow[p.playerId] = { x: st.target?.x, y: st.target?.y };
      }
      posRow.push({ playerId: p.playerId, x: pos.x, y: pos.y });
      prevPos.set(p.playerId, { x: pos.x, y: pos.y });
      stats.playerTicks += 1;
    }

    // 时间推进（模拟时钟，仅 harness；克隆 clock 以免污染输入引用）
    const nextTime = Math.min(90, (Number(next.clock.simulationTime) || 0) + dt);
    const nextHalf = nextTime >= 45 ? 2 : 1;
    next = { ...next, clock: { ...next.clock, simulationTime: nextTime, half: nextHalf } };

    current = next;
    stats.ticks += 1;
    stats.simulationMinutes = current.clock.simulationTime;
    stats.locomotionUpdates += next.players.length;

    if (record) {
      history.positions.push(posRow);
      history.intents.push(intentRow);
      history.targets.push(targetRow);
      history.ctx.push({ home: ctxSig(current, H), away: ctxSig(current, A) });
      history.shape.push({ home: shapeSig(current, H), away: shapeSig(current, A) });
    }

    const tickMs = Date.now() - tickStart;
    if (tickMs > stats.maxTickMs) stats.maxTickMs = tickMs;
  }

  stats.wallMs = Date.now() - t0;
  return { finalCore: current, stats, violations, history };
}

/** 意图 / 目标振荡分析。 */
export function analyzeStability(history) {
  const players = Object.keys(history.intents[0] ?? {});
  const out = { intentSwitches: 0, targetSwitches: 0, alternations: 0, perPlayerIntentSwitches: {}, perPlayerTargetSwitches: {} };
  for (const pid of players) {
    let lastIntent = null; let lastTarget = null;
    const tSeq = [];
    for (let i = 0; i < history.intents.length; i += 1) {
      const it = history.intents[i][pid];
      if (it !== lastIntent) {
        if (lastIntent !== null) out.intentSwitches += 1;
        lastIntent = it;
        out.perPlayerIntentSwitches[pid] = (out.perPlayerIntentSwitches[pid] ?? 0) + 1;
      }
      const tg = history.targets[i][pid];
      const key = `${tg?.x},${tg?.y}`;
      if (key !== lastTarget) {
        if (lastTarget !== null) out.targetSwitches += 1;
        tSeq.push(key);
        lastTarget = key;
      }
    }
    out.perPlayerTargetSwitches[pid] = tSeq.length;
    // 交替检测：连续 4 次出现 A→B→A→B
    for (let i = 3; i < tSeq.length; i += 1) {
      if (tSeq[i] === tSeq[i - 2] && tSeq[i - 1] === tSeq[i - 3] && tSeq[i] !== tSeq[i - 1]) out.alternations += 1;
    }
  }
  return out;
}

/** Shape 长稳分析：每队每 tick 的 mean-x 与 spread。 */
export function analyzeShape(history, teamFilter = H) {
  const meanX = []; const spread = [];
  for (const row of history.positions) {
    const pts = row.filter((p) => p.playerId.startsWith(teamFilter === H ? 'h_' : 'a_'));
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const sp = pts.reduce((s, p) => s + Math.hypot(p.x - mx, p.y - my), 0) / pts.length;
    meanX.push(mx); spread.push(sp);
  }
  const n = meanX.length;
  const tail = Math.floor(n * 0.5);
  const tailMeanX = meanX.slice(tail);
  const tailSpread = spread.slice(tail);
  return {
    firstMeanX: meanX[0], lastMeanX: meanX[n - 1], minMeanX: Math.min(...meanX), maxMeanX: Math.max(...meanX),
    minSpread: Math.min(...spread), maxSpread: Math.max(...spread),
    tailMeanXRange: Math.max(...tailMeanX) - Math.min(...tailMeanX),
    tailSpreadRange: Math.max(...tailSpread) - Math.min(...tailSpread),
    tailMinSpread: Math.min(...tailSpread),
  };
}

/** 全队到球平均距离（检测「全部聚到球」）。 */
export function meanDistToBall(history, ballPos, teamFilter = H) {
  const out = [];
  for (const row of history.positions) {
    const pts = row.filter((p) => p.playerId.startsWith(teamFilter === H ? 'h_' : 'a_'));
    out.push(pts.reduce((s, p) => s + Math.hypot(p.x - ballPos.x, p.y - ballPos.y), 0) / pts.length);
  }
  return out;
}