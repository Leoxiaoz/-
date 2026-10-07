/**
 * Movement 测试共享夹具（Step 39F-M-C）。
 * 仅测试使用；不进入生产代码，不改动正式比赛流程。
 * MatchCore 形态与 match-pass-resolution.test.js / match-decision.test.js 保持一致。
 */

export const H = 'clb_h';
export const A = 'clb_a';

export function mk(id, teamId, position, x, y, extra = {}) {
  return {
    playerId: id,
    teamId,
    position,
    positionOnPitch: { x, y },
    onPitch: true,
    injured: false,
    sentOff: false,
    attributes: { pace: 70, technique: 70, passing: 70, defending: 70, finishing: 70, goalkeeping: 70, ...(extra.attributes ?? {}) },
    fitness: extra.fitness ?? 100,
    form: extra.form ?? 50,
    morale: extra.morale ?? 50,
    matchLoad: extra.matchLoad ?? 0,
    ...(extra.overrides ?? {}),
  };
}

/** 4-4-2 双队 11 人阵型（home 向左攻为 +x 方向）。 */
export function basePlayers() {
  return [
    mk('h_gk', H, 'GK', 0.05, 0.50),
    mk('h_df1', H, 'DF', 0.18, 0.20), mk('h_df2', H, 'DF', 0.18, 0.38), mk('h_df3', H, 'DF', 0.18, 0.62), mk('h_df4', H, 'DF', 0.18, 0.80),
    mk('h_mf1', H, 'MF', 0.42, 0.18), mk('h_mf2', H, 'MF', 0.42, 0.40), mk('h_mf3', H, 'MF', 0.42, 0.60), mk('h_mf4', H, 'MF', 0.42, 0.82),
    mk('h_fw1', H, 'FW', 0.68, 0.38), mk('h_fw2', H, 'FW', 0.68, 0.62),
    mk('a_gk', A, 'GK', 0.95, 0.50),
    mk('a_df1', A, 'DF', 0.82, 0.20), mk('a_df2', A, 'DF', 0.82, 0.38), mk('a_df3', A, 'DF', 0.82, 0.62), mk('a_df4', A, 'DF', 0.82, 0.80),
    mk('a_mf1', A, 'MF', 0.58, 0.18), mk('a_mf2', A, 'MF', 0.58, 0.40), mk('a_mf3', A, 'MF', 0.58, 0.60), mk('a_mf4', A, 'MF', 0.58, 0.82),
    mk('a_fw1', A, 'FW', 0.32, 0.38), mk('a_fw2', A, 'FW', 0.32, 0.62),
  ];
}

export function tactical(overrides = {}) {
  return { formation: '4-4-2', mentality: 'balanced', tempo: 'medium', pressing: 'medium', ...overrides };
}

export function mkCore({
  ballControl = 'h_mf1', possessingTeamId = H, players = basePlayers(),
  tacticalState = {}, clock = { simulationTime: 10, matchDuration: 90, half: 1, status: 'in_play' },
  ballPos = null, movement = undefined, extra = {},
} = {}) {
  const carrier = players.find((p) => p.playerId === ballControl);
  const bp = ballPos ?? (carrier ? { ...carrier.positionOnPitch } : { x: 0.5, y: 0.5 });
  const core = {
    worldId: 'w_mov', season: 1, matchId: 'm_mov', ruleVersion: 'match-movement-v1',
    teams: { home: H, away: A },
    clock: { ...clock },
    score: { home: 0, away: 0 },
    ball: { position: { ...bp }, control: ballControl, possessingTeamId },
    players,
    tactical: { [H]: tactical(tacticalState[H]), [A]: tactical(tacticalState[A]) },
    ...extra,
  };
  if (movement) core.movement = movement;
  return core;
}