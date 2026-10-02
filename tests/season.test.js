/**
 * G1b① 赛季日历与边界驱动测试。
 * 覆盖：SeasonCalendar 投影、边界判定（<,=,>,空联赛）、单联赛行为等价（hash 基线）、
 * 副作用顺序与一次性、确定性、save/load（季中/边界前/边界日/新赛季后）。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { getSeasonCalendar, isSeasonBoundaryReached } from '../src/core/season.js';
import { initializePlayerRuntime } from '../src/core/player-runtime.js';
import { ROSTER_CONFIG } from '../src/core/sim-config.js';
import { MemorySaveManager, deserializeState } from '../src/save/save-manager.js';
import { makeLeagueWorldFiles } from './fixtures.js';

function leagueState(n = 8) {
  return createGameState(parseWorld(makeLeagueWorldFiles(n)));
}
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
}
/**
 * 完整运行时指纹（用于单联赛确定性与行为基线对比）。
 * 投影为**跨 Step 21-A 稳定**的字段子集：显式选取 Step 21-A **未新增/未改变**的字段
 * （vitals/injury/ability/growth + 统计线中 Step 21-A 之前的 appearances/minutes/goals），
 * 排除 Step 21-A 新增的 shots/shotsOnTarget/assists/yellow/red/ratingSum，从而让本测试
 * 始终度量「赛季边界 + 成长引擎」的确定性行为，而不受后续表现系统结构变化干扰。
 */
function fingerprint(state) {
  const comp = state.runtime.competitions.lg_a;
  const players = {};
  for (const id of Object.keys(state.runtime.players).sort()) {
    const rt = state.runtime.players[id];
    players[id] = {
      fitness: rt.fitness,
      form: rt.form,
      morale: rt.morale,
      injury: rt.injury,
      ability: rt.ability,
      growth: rt.growth,
      season: { appearances: rt.stats.season.appearances, minutes: rt.stats.season.minutes, goals: rt.stats.season.goals },
      career: { appearances: rt.stats.career.appearances, minutes: rt.stats.career.minutes, goals: rt.stats.career.goals },
    };
  }
  const proj = {
    season: state.season,
    comp: {
      season: comp.season,
      seasonStart: comp.seasonStart,
      status: comp.status,
      n: comp.fixtures.length,
      first: comp.fixtures[0].date,
      last: comp.fixtures[comp.fixtures.length - 1].date,
      table: comp.table,
      historySeasons: comp.history.map((h) => h.season),
    },
    players,
    retired: Object.keys(state.runtime.retired).sort(),
    generated: state.runtime.generated,
    membership: state.runtime.membership,
    events: state.runtime.events.map((e) => `${e.type}@${e.date}`),
  };
  return fnv(JSON.stringify(proj));
}
/**
 * 行为基线指纹（deterministic regression baseline）。
 * 语义：固定输入（同一 .fdb 世界 + 同一推进天数 + `enableAI:false`）下，多个时间点必须产生
 * **稳定、可重复**的运行时指纹；本基线已按 **Step 39F-G（D-42 B2+C2 development-aware selection）
 * 的实测输出**重新冻结（非人工填写），取代 39F-C 基线。
 * 说明：39F-G 使 AI 选择在同 rating 球员间使用 bounded development priority 重排（influence < 1，
 * 不跨越整数 rating 差）⇒ 比分不变但出场分布/事件顺序改变，故全部时点指纹按新实测值重冻结（明确行为变更）。
 */
const BASELINE = {
  1: 'aafa4bb8', 91: 'c1e97259', 92: '345e2bad', 121: '245ce209',
  200: 'f83551f9', 400: 'c2752aff', 800: 'c5e76e30',
};

// ---------- A. SeasonCalendar ----------
test('SeasonCalendar：单联赛投影返回正确 season/startDate/endDate/status', () => {
  const state = leagueState(8);
  const cal = getSeasonCalendar(state);
  assertEquals(cal.season, 1);
  assertEquals(cal.startDate, '2026-07-01');
  const comp = state.runtime.competitions.lg_a;
  const last = comp.fixtures.reduce((m, f) => (f.date > m ? f.date : m), comp.fixtures[0].date);
  assertEquals(cal.endDate, last, 'endDate 应等于最后一场 fixture 日期');
  assertEquals(cal.endDate, '2026-09-30', '8 队双循环最后一场应为开赛 +91 天');
  assertEquals(cal.status, 'scheduled');
  // state.season ≡ comp.season ≡ calendar.season
  assertEquals(state.season, comp.season);
  assertEquals(state.season, cal.season);
});

// ---------- B. 边界判定 ----------
test('边界：currentDate < endDate 不触发（赛季不滚动）', () => {
  const state = leagueState(8);
  const sim = new SimulationCore();
  // 第 90 天：最后一轮尚未到（endDate=2026-09-30）
  sim.advanceDays(state, 90);
  assertEquals(state.currentDate, '2026-09-29');
  assertEquals(isSeasonBoundaryReached(state), false, '< endDate 不应触发');
  assertEquals(getSeasonCalendar(state).status, 'in_progress', '赛程进行中');
  assertEquals(state.season, 1, '不应滚动');
});

test('边界：currentDate === endDate 且 finished → 该日完成 rollover', () => {
  const state = leagueState(8);
  const sim = new SimulationCore();
  sim.advanceDays(state, 91); // 2026-09-30 = endDate
  assertEquals(state.currentDate, '2026-09-30');
  assertEquals(state.season, 2, '边界日应滚动');
  // 滚动后日历已投影到新赛季（旧赛季已归档、新赛程尚未开赛）
  const cal = getSeasonCalendar(state);
  assertEquals(cal.season, 2);
  assertEquals(cal.status, 'scheduled');
  // 旧赛季被归档进 history
  assertEquals(state.runtime.competitions.lg_a.history.map((h) => h.season), [1]);
});

test('边界：谓词对 === / > 且 finished 为真，< endDate 为假（构造态）', () => {
  // 直接构造「全部赛完 + finished」的竞赛，精确验证判据不含 off-by-one。
  const makeFinished = (currentDate) => {
    const state = leagueState(8);
    const comp = state.runtime.competitions.lg_a;
    for (const f of comp.fixtures) f.played = true;
    comp.status = 'finished';
    state.currentDate = currentDate;
    return state;
  };
  const end = getSeasonCalendar(leagueState(8)).endDate; // '2026-09-30'
  assertEquals(isSeasonBoundaryReached(makeFinished('2026-09-29')), false, '前一天不触发');
  assertEquals(isSeasonBoundaryReached(makeFinished(end)), true, '边界日（===）触发');
  assertEquals(isSeasonBoundaryReached(makeFinished('2026-10-01')), true, '越界（>）触发');
});

test('边界：已越过 endDate 且 finished 仍触发（> case）', () => {
  const state = leagueState(8);
  // 一次性跳到 endDate 之后：最后一轮仍会被补赛 → finished → 触发
  new SimulationCore().advanceDays(state, 95);
  assert(state.currentDate > '2026-09-30');
  assertEquals(state.season, 2, '越过边界仍应滚动');
});

test('边界：空联赛（无赛程）永不触发，season 不变', () => {
  const files = makeLeagueWorldFiles(8);
  files.teams = files.teams.slice(0, 1); // 单队 → 无可生成赛程
  files.players = files.players.filter((p) => p.teamId === files.teams[0].id);
  const state = createGameState(parseWorld(files));
  const cal = getSeasonCalendar(state);
  assertEquals(cal.endDate, null);
  assertEquals(cal.status, 'empty');
  new SimulationCore().advanceDays(state, 200);
  assertEquals(isSeasonBoundaryReached(state), false);
  assertEquals(state.season, 1, '空联赛不应滚动');
});

// ---------- C. 单联赛确定性行为基线（hash 指纹回归） ----------
test('单联赛确定性基线：多时点运行时指纹与 39F-C 冻结基线完全一致', () => {
  for (const days of [1, 91, 92, 121, 200, 400, 800]) {
    const state = leagueState(8);
    // 本测试度量确定性模拟的行为稳定性；AI Club Decision（Step 31）为独立子系统，此处隔离以保持基线语义。
    new SimulationCore({ enableAI: false }).advanceDays(state, days);
    assertEquals(fingerprint(state), BASELINE[days], `第 ${days} 天指纹应与 39F-C 基线一致`);
  }
});

// ---------- D. 副作用顺序 / 一次性 ----------
test('赛季副作用每季恰好一次，且顺序为 growth → lifecycle → lineup → reset', () => {
  const state = leagueState(8);
  const sim = new SimulationCore();
  sim.advanceDays(state, 91); // 完成第 1 季并滚动
  assertEquals(state.season, 2);
  // growth：全体 active 球员 lastEvaluatedSeason 应已结算到 1
  for (const p of Object.values(state.runtime.players)) {
    assert(p.growth.lastEvaluatedSeason >= 1, '成长应已结算第 1 季');
  }
  // stats reset：本赛季统计归零、seasonNumber = 2
  const any = Object.values(state.runtime.players)[0];
  assertEquals(any.stats.season.appearances, 0, '赛季统计应已重置');
  assertEquals(any.stats.seasonNumber, 2, 'seasonNumber 应为新赛季');
  // 再推进同赛季（未到下一边界），副作用不应重复
  const before = Object.values(state.runtime.players).map((p) => p.growth.lastEvaluatedSeason);
  sim.advanceDays(state, 30);
  const after = Object.values(state.runtime.players).map((p) => p.growth.lastEvaluatedSeason);
  assertEquals(after, before, '同赛季内不应重复结算成长');
});

// ---------- E. 确定性 ----------
test('确定性：同世界两次连续推进结果一致', () => {
  const a = leagueState(8);
  const b = leagueState(8);
  new SimulationCore().advanceDays(a, 400);
  new SimulationCore().advanceDays(b, 400);
  assertEquals(fingerprint(a), fingerprint(b));
});

// ---------- F. save/load（季中 / 边界前 / 边界日 / 新赛季后） ----------
async function roundTrip(days) {
  const mgr = new MemorySaveManager();
  const state = leagueState(8);
  new SimulationCore().advanceDays(state, days);
  await mgr.save('s', state);
  // MemorySaveManager 保留活引用，需深拷贝后再反序列化，才能得到独立运行时
  // （与 IndexedDB / 真实持久化路径的 JSON 克隆语义一致）。
  const payload = deserializeState(JSON.parse(JSON.stringify(await mgr.load('s'))));
  assert(payload.runtime !== state.runtime, '读档运行时必须与源状态相互独立');
  const loaded = createGameState(state.static, { date: payload.currentDate, season: payload.season });
  loaded.runtime = payload.runtime;
  initializePlayerRuntime(loaded);
  return { state, loaded };
}
test('save/load 在季中 / 边界前 / 边界日 / 新赛季后：继续模拟结果一致', async () => {
  for (const days of [40, 90, 91, 121]) {
    const { state, loaded } = await roundTrip(days);
    // 读档后日历与 season 一致
    assertEquals(getSeasonCalendar(loaded).season, state.season);
    assertEquals(getSeasonCalendar(loaded).season, loaded.runtime.competitions.lg_a.season);
    // 继续推进结果一致
    new SimulationCore().advanceDays(state, 100);
    new SimulationCore().advanceDays(loaded, 100);
    assertEquals(fingerprint(loaded), fingerprint(state), `第 ${days} 天读档后继续应一致`);
  }
});

// ---------- G. 长期回归（10/50/100 赛季） ----------
test('10/50/100 赛季：人口/统计/成员关系稳定，season 与 comp.season 同步', () => {
  for (const seasons of [10, 50, 100]) {
    const state = leagueState(8);
    new SimulationCore().advanceDays(state, seasons * 125);
    const comp = state.runtime.competitions.lg_a;
    assertEquals(state.season, comp.season, `${seasons}季 state.season 应与 comp.season 同步`);
    assertEquals(getSeasonCalendar(state).season, comp.season);
    const active = Object.values(state.runtime.players).length;
    // Step 26B：人口改为**边界语义**——允许在 [Σ俱乐部下限, 初始人口] 区间自然波动，
    // 不再机械恢复到 112（exact-112 已退出业务逻辑）。
    assert(active >= 8 * ROSTER_CONFIG.MIN_PLAYERS,
      `${seasons}季后活跃人口应不低于俱乐部下限总和（实际 ${active}）`);
    assert(active <= 112, `${seasons}季后活跃人口不应超过初始规模（实际 ${active}）`);
    for (const [id, rt] of Object.entries(state.runtime.players)) {
      assert(Number.isFinite(rt.fitness) && rt.fitness >= 0 && rt.fitness <= 100, `${id} fitness 非法`);
      assert(Number.isFinite(rt.stats.career.appearances), `${id} 统计非法`);
    }
    // populationTarget 仅作 legacy 快照保留（不再参与人口业务逻辑，仍随世界初始化建立）。
    assertEquals(Object.keys(state.runtime.populationTarget).length, 8);
  }
});