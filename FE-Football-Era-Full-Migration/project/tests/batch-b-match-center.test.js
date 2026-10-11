/**
 * Batch B 测试：比赛中心 / 文字直播 / 俯视球场演出 / 赛后报告。
 *
 * 覆盖验收标准 A–K 中可通过自动化验证的部分：
 * - 数据链：GameController.getMatchShow 只读消费已结算比赛的真实赛果与真实进球事件；
 * - 确定性：buildMatchShow 为纯函数，相同输入产出完全一致的演出模型；
 * - 一致性：演出/报告比分恒等于结算快照 homeGoals/awayGoals；
 * - 降级：缺失球员/助攻/种子/事件时不抛错、不伪造；
 * - 无副作用：反复观看/重播不再次结算，不改积分榜与球员统计；
 * - 播放状态机：在最小 DOM 桩上驱动真实 AppView，验证播放/暂停/重置/结束。
 *
 * 不依赖浏览器 / 第三方库：Node 下直接驱动 Controller + 最小 DOM 桩。
 */

import { test, assert, assertEquals } from './harness.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { GameController } from '../src/controller/game-controller.js';
import { buildMatchShow } from '../src/controller/match-show.js';
import { AppView } from '../src/ui/app-view.js';
import { getPlayerStatsView } from '../src/core/player-runtime.js';
import { MemorySaveManager } from '../src/save/save-manager.js';
import { makeLeagueWorldFiles } from './fixtures.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const N = 8;
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src');

class StubLoader {
  async loadWorld() { return parseWorld(makeLeagueWorldFiles(N)); }
}
function makeController() {
  return new GameController({
    dataLoader: new StubLoader(),
    saveManager: new MemorySaveManager(),
    simulation: new SimulationCore(),
  });
}
function compsOf(state) { return Object.values(state.runtime.competitions); }
function allFixtures(state) {
  const out = [];
  for (const comp of compsOf(state)) for (const f of comp.fixtures) out.push({ comp, f });
  return out;
}
function playedCount(state) { return allFixtures(state).filter((x) => x.f.played).length; }
function tableSignature(state) {
  return compsOf(state).map((c) => Object.values(c.table)
    .map((r) => `${r.teamId}:${r.played}:${r.points}`).sort().join(',')).join('|');
}

/** 建立控制器并推进到出现已结算比赛。 */
async function controllerWithPlayed() {
  const c = makeController();
  await c.startNewGame('w');
  c.setManagedClub(c.getSnapshot().clubs[0].id);
  c.advanceToNextRound();
  const played = allFixtures(c.getState()).find((x) => x.f.played);
  assert(played, '推进后应存在已结算比赛');
  return { c, fixtureId: played.f.id, raw: played.f };
}

// ---------------------------------------------------------------------------
// A. 比赛中心读取真实赛程与赛果
// ---------------------------------------------------------------------------
test('A. 比赛中心：已结算比赛带真实主客队/日期/轮次/比分', async () => {
  const { c } = await controllerWithPlayed();
  const snap = c.getSnapshot();
  const league = snap.leagues[0];
  assert(league.fixtures.length > 0, '应暴露完整赛程');
  const played = league.fixtures.filter((f) => f.played);
  assert(played.length > 0, '应有已结算比赛');
  for (const f of played) {
    assert(typeof f.id === 'string' && f.id.length > 0, '每场应有稳定 id');
    assert(Number.isInteger(f.homeGoals) && Number.isInteger(f.awayGoals), '比分应为真实整数');
    assert(typeof f.homeName === 'string' && typeof f.awayName === 'string', '应有真实队名');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(f.date), '应有赛程日期');
    assert(Number.isInteger(f.round) && f.round >= 1, '应有轮次');
  }
});

// ---------------------------------------------------------------------------
// B. 文字直播只消费真实事件，事件顺序稳定
// ---------------------------------------------------------------------------
test('B. 文字直播：只消费真实进球事件，按分钟稳定排序', async () => {
  const { c, fixtureId, raw } = await controllerWithPlayed();
  const show = c.getMatchShow(fixtureId);
  const realGoals = (raw.events ?? []).filter((e) => e.type === 'goal');
  const shownGoals = show.timeline.filter((e) => e.kind === 'goal');
  assertEquals(shownGoals.length, realGoals.length, '演出进球数应等于真实进球事件数');

  // 分钟非递减
  const minutes = shownGoals.map((g) => g.minute);
  assertEquals(minutes.slice().sort((a, b) => a - b), minutes, '事件应按分钟排序');
});

test('B2. 同一分钟多事件：稳定顺序 + 非进球事件被忽略', () => {
  const show = buildMatchShow({
    seed: 's', fixtureId: 'f', leagueId: 'l', season: 1, round: 1, date: '2026-07-01',
    home: { id: 'h', name: 'H' }, away: { id: 'a', name: 'A' },
    played: true, homeGoals: 3, awayGoals: 0,
    events: [
      { minute: 30, teamId: 'h', type: 'goal', actorId: 'p1' },
      { minute: 30, teamId: 'a', type: 'shot', actorId: 'p2' }, // 非进球：必须忽略
      { minute: 30, teamId: 'h', type: 'goal', actorId: 'p3' },
      { minute: 10, teamId: 'h', type: 'goal', actorId: 'p4' },
    ],
    resolveName: (id) => ({ p1: 'One', p3: 'Three', p4: 'Four' }[id] ?? null),
  });
  const goals = show.timeline.filter((e) => e.kind === 'goal');
  assertEquals(goals.map((g) => g.minute), [10, 30, 30], '应按分钟排序');
  assertEquals(goals.map((g) => g.scorerName), ['Four', 'One', 'Three'], '同分钟应保持原始顺序（稳定）');
});

// ---------------------------------------------------------------------------
// C. 报告最终比分与 simulateMatch 结算结果一致
// ---------------------------------------------------------------------------
test('C. 报告/演出最终比分与结算快照 homeGoals/awayGoals 一致', async () => {
  const { c, fixtureId, raw } = await controllerWithPlayed();
  const show = c.getMatchShow(fixtureId);
  assertEquals(show.score, { home: raw.homeGoals, away: raw.awayGoals }, '演出比分为结算权威比分');
  const fulltime = show.timeline.find((e) => e.kind === 'fulltime');
  assertEquals(fulltime.score, { home: raw.homeGoals, away: raw.awayGoals }, '终场比分为结算权威比分');
  assertEquals(show.played, true);
});

// ---------------------------------------------------------------------------
// D. 缺失球员/助攻/种子/事件时安全降级
// ---------------------------------------------------------------------------
test('D. 缺失 actorId/assistId/seed/events 时安全降级，不伪造', () => {
  const show = buildMatchShow({
    seed: undefined, fixtureId: 'f', leagueId: 'l', season: 1, round: 1, date: '2026-07-01',
    home: { id: 'h', name: 'H' }, away: { id: 'a', name: 'A' },
    played: true, homeGoals: 1, awayGoals: 0,
    events: [
      { minute: 20, teamId: 'h', type: 'goal', actorId: null, assistId: null },
      { minute: 55, teamId: 'x', type: 'goal', actorId: 'p9' }, // 未知球队
    ],
    resolveName: () => null,
  });
  const goals = show.timeline.filter((e) => e.kind === 'goal');
  assertEquals(goals.length, 2, '应保留两粒进球（未知来源降级，不伪造）');
  assertEquals(goals[0].scorerName, null, '缺失进球者应为 null，不得硬造');
  assertEquals(goals[0].assistName, null, '缺失助攻者应为 null');
  assertEquals(goals[1].side, null, '未知球队 side 应为 null');

  const empty = buildMatchShow({
    seed: undefined, fixtureId: 'f2', leagueId: 'l', season: 1, round: 1, date: '2026-07-01',
    home: { id: 'h', name: 'H' }, away: { id: 'a', name: 'A' },
    played: true, homeGoals: 0, awayGoals: 0, events: [],
  });
  assertEquals(empty.hasEvents, false, '无事件应标记 hasEvents=false');
  assertEquals(empty.timeline.map((e) => e.kind), ['kickoff', 'halftime', 'fulltime'], '无事件时应只有演出框架');
});

// ---------------------------------------------------------------------------
// E. 动画进球演出只对应真实进球事件
// ---------------------------------------------------------------------------
test('E. 俯视球场进球演出只对应真实进球事件', async () => {
  const { c, fixtureId, raw } = await controllerWithPlayed();
  const show = c.getMatchShow(fixtureId);
  const goalEntries = show.timeline.filter((e) => e.kind === 'goal');
  const realGoalTeams = (raw.events ?? []).filter((e) => e.type === 'goal').map((e) => e.teamId);
  assertEquals(goalEntries.length, realGoalTeams.length, '演示进球数应等于真实进球数');
  for (const g of goalEntries) {
    assert(g.side === 'home' || g.side === 'away', '进球演出应归属真实一方');
    // 球位为确定性派生（有界于球场内）
    assert(g.ball.x >= 0 && g.ball.x <= 1 && g.ball.y >= 0 && g.ball.y <= 1, '球位应在球场归一化范围内');
  }
});

// ---------------------------------------------------------------------------
// F. 相同输入确定性派生一致
// ---------------------------------------------------------------------------
test('F. 相同输入下演出模型完全一致（确定性）', async () => {
  const { c, fixtureId } = await controllerWithPlayed();
  const a = c.getMatchShow(fixtureId);
  const b = c.getMatchShow(fixtureId);
  assertEquals(JSON.stringify(a), JSON.stringify(b), '同一比赛两次构建应完全一致');
});

// ---------------------------------------------------------------------------
// G. 重播/查看历史不再次结算，不改积分榜与球员统计
// ---------------------------------------------------------------------------
test('G. 反复观看历史比赛不再次结算，不改积分榜/球员统计', async () => {
  const { c, fixtureId } = await controllerWithPlayed();
  const state = c.getState();
  const clubId = c.getManagedClubId();
  const beforeCount = playedCount(state);
  const beforeTable = tableSignature(state);
  const playerId = state.static.players.find((p) => p.teamId === clubId)?.id;
  const beforeStats = JSON.stringify(getPlayerStatsView(state, playerId));

  for (let i = 0; i < 5; i += 1) {
    const show = c.getMatchShow(fixtureId);
    assert(show.played, '应仍可构建演出模型');
  }

  assertEquals(playedCount(c.getState()), beforeCount, '观看不得结算新比赛');
  assertEquals(tableSignature(c.getState()), beforeTable, '观看不得改变积分榜');
  assertEquals(JSON.stringify(getPlayerStatsView(c.getState(), playerId)), beforeStats, '观看不得改变球员统计');
});

// ---------------------------------------------------------------------------
// I. 存档读取后仍可查看比赛报告，继续推进不重复结算
// ---------------------------------------------------------------------------
test('I. 存档读取后仍可查看历史比赛报告，继续推进不重复结算', async () => {
  const { c, fixtureId } = await controllerWithPlayed();
  const raw = allFixtures(c.getState()).find((x) => x.f.id === fixtureId).f;

  await c.save('slot');
  await c.load('slot');

  const show = c.getMatchShow(fixtureId);
  assert(show, '读档后应仍能构建演出模型');
  assertEquals(show.score, { home: raw.homeGoals, away: raw.awayGoals }, '读档后报告比分应保持');
  assert(show.timeline.some((e) => e.kind === 'goal') === ((raw.events ?? []).some((e) => e.type === 'goal')), '读档后事件保留状态一致');

  // 继续推进：旧场次比分不变，新场次结算
  const beforeCount = playedCount(c.getState());
  const beforeRound1 = allFixtures(c.getState()).filter((x) => x.f.round === 1).map((x) => `${x.f.id}:${x.f.homeGoals}-${x.f.awayGoals}`).join(',');
  c.advanceToNextRound();
  assert(playedCount(c.getState()) > beforeCount, '应能继续推进并结算新比赛');
  assertEquals(
    allFixtures(c.getState()).filter((x) => x.f.round === 1).map((x) => `${x.f.id}:${x.f.homeGoals}-${x.f.awayGoals}`).join(','),
    beforeRound1,
    '读档后旧赛果不得被改写',
  );
});

// ---------------------------------------------------------------------------
// H. 播放状态机：在最小 DOM 桩上驱动真实 AppView
// ---------------------------------------------------------------------------

/** 极简 DOM 桩：仅满足 AppView 的渲染与事件委托所需 API。 */
class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this._text = '';
    this.value = '';
    this.parentNode = null;
    this._listeners = {};
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k.startsWith('data-')) {
      const name = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[name] = String(v);
    }
  }
  getAttribute(k) { return this.attrs[k] ?? null; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  addEventListener(type, fn) { (this._listeners[type] ??= []).push(fn); }
  closest(sel) {
    let n = this;
    while (n) {
      if (sel === '[data-action]' && n.attrs['data-action'] != null) return n;
      if (sel === 'select[data-action]' && n.tagName === 'SELECT' && n.attrs['data-action'] != null) return n;
      n = n.parentNode;
    }
    return null;
  }
}
function makeDoc() {
  const registry = {};
  return {
    createElement: (t) => new FakeNode(t),
    createElementNS: (_ns, t) => new FakeNode(t),
    getElementById: (id) => (registry[id] ??= new FakeNode('div')),
  };
}
function walk(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children) walk(c, pred, out);
  return out;
}
function findAction(root, action) {
  return walk(root, (n) => n.dataset && n.dataset.action === action)[0] ?? null;
}
function click(root, node) {
  for (const fn of (root._listeners.click ?? [])) fn({ target: node });
}

test('H. 播放/暂停/重置/结束状态机正常（逐事件完整演出）', async () => {
  const prevDoc = globalThis.document;
  const prevSet = globalThis.setInterval;
  const prevClear = globalThis.clearInterval;
  let intervalFn = null;
  let seq = 1;
  globalThis.document = makeDoc();
  globalThis.setInterval = (fn) => { intervalFn = fn; return seq++; };
  globalThis.clearInterval = () => { intervalFn = null; };

  try {
    const root = new FakeNode('div');
    const controller = makeController();
    await controller.startNewGame('w');
    const view = new AppView({ root, controller });
    view.mount();

    // 开始生涯 → 进入主界面
    click(root, findAction(root, 'start-career'));

    // 结算一轮比赛
    controller.advanceToNextRound();
    const openBtn = findAction(root, 'open-match');
    assert(openBtn, '比赛中心应列出可观看的已结算比赛');
    const fixtureId = openBtn.dataset.fixture;
    const show = controller.getMatchShow(fixtureId);
    const total = show.timeline.length;
    assert(total >= 3, '演出时间轴应至少包含开场/半场/终场');

    // 打开比赛 → 演出视图
    click(root, findAction(root, 'open-match'));
    assert(/演出进度：第 1 \/ \d+ 步/.test(root.textContent), '应显示演出进度起始步');

    // 下一事件
    click(root, findAction(root, 'play-next'));
    assert(root.textContent.includes(`第 2 / ${total} 步`), '下一事件应推进到第 2 步');

    // 上一事件
    click(root, findAction(root, 'play-prev'));
    assert(root.textContent.includes(`第 1 / ${total} 步`), '上一事件应回到第 1 步');

    // 重置
    click(root, findAction(root, 'play-next'));
    click(root, findAction(root, 'play-reset'));
    assert(root.textContent.includes(`第 1 / ${total} 步`), '重置应回到第 1 步');

    // 播放（自动）→ 播放中
    click(root, findAction(root, 'play-toggle'));
    assert(root.textContent.includes('播放中'), '播放后应进入播放中状态');
    assert(intervalFn, '播放应注册演出计时器');

    // 手动驱动计时器直到结束
    let guard = 0;
    while (intervalFn && guard < total + 3) { intervalFn(); guard += 1; }
    assert(!root.textContent.includes('播放中'), '播放到结尾应停止（结束状态）');
    assert(root.textContent.includes(`第 ${total} / ${total} 步`), '应停在最后一步（终场）');

    // 结束后再次播放：从头重播
    click(root, findAction(root, 'play-toggle'));
    assert(root.textContent.includes('播放中'), '结束后再播放应从结尾重置并重播');

    // 返回主界面
    click(root, findAction(root, 'close-match'));
    assert(root.textContent.includes('比赛中心'), '应回到主界面（仍含比赛中心）');
  } finally {
    globalThis.document = prevDoc;
    globalThis.setInterval = prevSet;
    globalThis.clearInterval = prevClear;
  }
});

// ---------------------------------------------------------------------------
// 约束扫描：演出模型不重算比赛、不用墙钟/全局随机
// ---------------------------------------------------------------------------
test('约束：演出模型不调用 simulateMatch / Math.random / Date.now', () => {
  const src = readFileSync(join(SRC_DIR, 'controller/match-show.js'), 'utf8');
  assert(!/simulateMatch\s*\(/.test(src), 'match-show 不得调用 simulateMatch');
  assert(!/Math\.random\s*\(/.test(src), 'match-show 不得使用 Math.random');
  assert(!/Date\.now\s*\(/.test(src), 'match-show 不得使用 Date.now');
  const view = readFileSync(join(SRC_DIR, 'ui/app-view.js'), 'utf8');
  assert(!/from\s+'\.\.\/(core|save|data)\//.test(view), 'app-view 不得直接导入 core/save/data');
});