/**
 * Match Show（比赛演出模型，Controller 层）。
 *
 * 定位：把**已结算比赛的真实数据**（比分 + 真实进球事件 + 比赛种子）转换为供 UI 渲染的
 * 「演出模型」——时间轴、球路关键帧、俯视球场阵型点位。**纯函数，无副作用，不修改任何状态。**
 *
 * 红线（Batch B）：
 * - 比分与事件以已结算比赛为唯一权威；本模块**不**重算比赛、不调用 simulateMatch、不产出第二套比分。
 * - 事件仅来自持久化的真实进球事件；缺失时优雅降级（无事件即只显示开场/结束），不伪造事件/球员。
 * - 球员点位为**展示层派生**的阵型标记（不含真实球员身份），不得宣称来自连续 Tick 物理模拟。
 * - 球路关键帧由**确定性算法**（项目既有 `mulberry32` + FNV-1a 种子散列）派生，不使用墙钟/全局随机。
 */

import { createRng, hashSeed } from '../core/rng.js';

/** 归一化俯视球场阵型点位（4-4-2，10 名场上球员按线分布；不含门将以简化演出）。 */
function formationLayout(mirror) {
  const rows = [
    { x: 0.06, n: 1 }, // GK
    { x: 0.24, n: 4 }, // DF
    { x: 0.48, n: 4 }, // MF
    { x: 0.72, n: 2 }, // FW
  ];
  const pts = [];
  for (const row of rows) {
    for (let i = 0; i < row.n; i += 1) {
      const y = (i + 1) / (row.n + 1);
      pts.push({ x: mirror ? 1 - row.x : row.x, y });
    }
  }
  return pts;
}

/** 中圈球位。 */
function centerBall() {
  return { x: 0.5, y: 0.5 };
}

/** 进球球位（确定性微扰 y，射向对应球门）。 */
function goalBall(seed, step, side) {
  const rng = createRng(hashSeed(`${seed}|ball|${step}`));
  const y = 0.4 + rng.next() * 0.2;
  return { x: side === 'home' ? 0.97 : 0.03, y };
}

/**
 * 构建比赛演出模型。
 * @param {object} input
 * @param {string} input.seed 比赛种子（持久化的 matchSeed，或由 fixture 派生的兜底种子）
 * @param {string} input.fixtureId
 * @param {string} input.leagueId
 * @param {number} input.season
 * @param {number} input.round
 * @param {string} input.date
 * @param {{id:string,name:string}} input.home
 * @param {{id:string,name:string}} input.away
 * @param {boolean} input.played
 * @param {number|null} input.homeGoals
 * @param {number|null} input.awayGoals
 * @param {object[]} [input.events] 真实进球事件（{minute, teamId, type, actorId, assistId}）
 * @param {(actorId:string)=>(string|null)} [input.resolveName] playerId → 姓名
 * @returns {object} 演出模型
 */
export function buildMatchShow(input) {
  const {
    seed, fixtureId, leagueId, season, round, date,
    home, away, played, homeGoals, awayGoals,
    events = [], resolveName = () => null,
  } = input;

  const timeline = [];
  let h = 0;
  let a = 0;

  timeline.push({ kind: 'kickoff', minute: 0, label: '比赛开始', score: { home: 0, away: 0 }, ball: centerBall() });

  // 事件排序：先按分钟，再按原始顺序（稳定），正确处理同一分钟内的多个事件。
  const ordered = events
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.type === 'goal')
    .sort((x, y) => x.e.minute - y.e.minute || x.i - y.i)
    .map((x) => x.e);

  let halftimeInserted = false;
  ordered.forEach((ev, idx) => {
    const side = ev.teamId === home.id ? 'home' : ev.teamId === away.id ? 'away' : null;
    const minute = Number.isFinite(ev.minute) ? ev.minute : 0;
    if (!halftimeInserted && minute > 45) {
      timeline.push({ kind: 'halftime', minute: 45, label: '半场结束', score: { home: h, away: a }, ball: centerBall() });
      halftimeInserted = true;
    }
    if (side === 'home') h += 1;
    else if (side === 'away') a += 1;
    timeline.push({
      kind: 'goal',
      minute,
      side,
      teamName: side === 'home' ? home.name : side === 'away' ? away.name : null,
      scorerName: ev.actorId ? resolveName(ev.actorId) : null,
      assistName: ev.assistId ? resolveName(ev.assistId) : null,
      label: `第 ${minute} 分钟 · ${side === 'home' ? home.name : side === 'away' ? away.name : '未知球队'}进球`,
      score: { home: h, away: a },
      ball: goalBall(seed, idx + 1, side),
    });
  });

  if (!halftimeInserted) {
    timeline.push({ kind: 'halftime', minute: 45, label: '半场结束', score: { home: h, away: a }, ball: centerBall() });
  }
  timeline.push({
    kind: 'fulltime',
    minute: 90,
    label: '比赛结束',
    score: { home: homeGoals ?? h, away: awayGoals ?? a },
    ball: centerBall(),
  });

  return {
    fixtureId,
    leagueId,
    season,
    round,
    date,
    home: { id: home.id, name: home.name },
    away: { id: away.id, name: away.name },
    score: { home: homeGoals, away: awayGoals },
    played: !!played,
    hasEvents: ordered.length > 0,
    seed,
    formation: { home: formationLayout(false), away: formationLayout(true) },
    timeline,
  };
}