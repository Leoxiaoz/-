/**
 * Step 38E — Competition Structure Phase 1 测试。
 * 覆盖：World Season Boundary 多赛事（Phase 0）、Division/Competition helper（Phase 1）、
 * membership 受控迁移 API（Phase 2）、Promotion/Relegation planner（Phase 3）、rollover 集成（Phase 4）。
 *
 * 红线：不改 DDTI C1 / Finance Feedback / Transfer / Match / Team Strength / Schema 10 / Save Format 1；
 * 静态 `teams[].leagueId` 永不因升降级改变。
 */

import { test, assert, assertEquals } from './harness.js';
import { createGameState } from '../src/core/game-state.js';
import { parseWorld, WORLD_FORMAT } from '../src/data/data-loader.js';
import { SimulationCore } from '../src/core/simulation.js';
import { getSeasonCalendar, isSeasonBoundaryReached } from '../src/core/season.js';
import {
  getWorldSeasonParticipants, getDivision, getCompetition, getCompetitionContext, getCompetitionRules,
} from '../src/core/competition.js';
import {
  planPromotionRelegation, validatePromotionRelegationPlan, applyPromotionRelegationTransition,
} from '../src/core/competition-transition.js';
import { getClubLeague, validateMembership, getLeagueClubs } from '../src/core/membership.js';
import { assertFinanceInvariants } from '../src/core/finance.js';
import { assertContractInvariants } from '../src/core/contract.js';
import { DDTI_CONFIG } from '../src/core/sim-config.js';

// ---------------------------------------------------------------------------
// 测试世界构造：多 Division 金字塔（总俱乐部数 = 8，保持 world population = 112，尊重 WORLD_SOFT_CAP）
// ---------------------------------------------------------------------------
const SHAPE = [['GK', 1], ['DF', 5], ['MF', 5], ['FW', 3]];
function pyramidFiles(divisions, countries = [{ id: 'cty_a', name: 'Country A' }]) {
  const teams = [];
  const players = [];
  let seq = 1;
  let tn = 1;
  const pad = (x) => String(x).padStart(3, '0');
  for (const d of divisions) {
    for (let i = 0; i < d.teamCount; i += 1) {
      const teamId = `clb_${pad(tn)}`;
      tn += 1;
      teams.push({ id: teamId, name: `Club ${pad(tn - 1)}`, leagueId: d.id, formation: '4-4-2', mentality: 'balanced' });
      for (const [pos, cnt] of SHAPE) {
        for (let k = 0; k < cnt; k += 1) {
          const id = `ply_${pad(seq)}`;
          seq += 1;
          const base = 70;
          const attrs = {
            pace: base, technique: base, passing: base,
            defending: pos === 'FW' ? base - 20 : base,
            finishing: pos === 'DF' ? base - 20 : base,
            goalkeeping: pos === 'GK' ? base : 10,
          };
          const potential = {};
          for (const a of Object.keys(attrs)) potential[a] = Math.min(99, attrs[a] + 8);
          players.push({
            id, name: `Player ${pad(seq - 1)}`, teamId, position: pos, ...attrs,
            birthDate: '2000-01-15',
            potential,
            personality: { professionalism: 60, determination: 60, ambition: 60, consistency: 60, injuryProneness: 40 },
          });
        }
      }
    }
  }
  return {
    manifest: { id: 'w_pyr', name: 'Pyramid World', version: '0.1.0', format: WORLD_FORMAT, startDate: '2026-07-01' },
    countries,
    leagues: divisions.map((d) => ({
      id: d.id, name: d.name ?? d.id, countryId: d.countryId, tier: d.tier,
      ...(d.rules ? { rules: d.rules } : {}),
    })),
    teams, players,
  };
}
function pyramidState(divisions, countries) {
  return createGameState(parseWorld(pyramidFiles(divisions, countries)));
}
/** 合成 planner 输入状态（无球员，仅 leagues/competitions/membership/clubs）。 */
function plannerState(leagues, tables) {
  const clubs = {};
  const memberClubs = {};
  const competitions = {};
  for (const l of leagues) {
    const t = {};
    (tables[l.id] ?? []).forEach((c, idx) => {
      clubs[c] = { finance: { cash: 1000, wageBudget: 400, transferBudget: 600 } };
      memberClubs[c] = l.id;
      t[c] = { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: (tables[l.id].length - idx) };
    });
    competitions[l.id] = { leagueId: l.id, season: 1, seasonStart: '2026-07-01', fixtures: [], table: t, history: [], status: 'finished' };
  }
  return {
    static: { leagues, teams: Object.keys(clubs).map((id) => ({ id, leagueId: memberClubs[id] })) },
    runtime: { clubs, membership: { schema: 1, players: {}, clubs: memberClubs }, competitions, events: [], managedClubId: null },
  };
}

// ===========================================================================
// Phase 0 — Season Boundary
// ===========================================================================
const D2 = [{ id: 'lg_d1', countryId: 'cty_a', tier: 1, teamCount: 4 }, { id: 'lg_d2', countryId: 'cty_a', tier: 2, teamCount: 4 }];

test('CS-B1. getWorldSeasonParticipants：升序、确定性、空集合为空', () => {
  const s = pyramidState(D2);
  assertEquals(getWorldSeasonParticipants(s), ['lg_d1', 'lg_d2']);
  const empty = { static: { leagues: [] }, runtime: { competitions: {} } };
  assertEquals(getWorldSeasonParticipants(empty), []);
});

test('CS-B2. 单 Competition 边界行为与旧版等价（未开赛→false；过边界→rollover 推进 season）', () => {
  const s = pyramidState([{ id: 'lg_only', countryId: 'cty_a', tier: 1, teamCount: 4 }]);
  assert(!isSeasonBoundaryReached(s), '未开赛不应触发');
  assertEquals(getSeasonCalendar(s).status, 'scheduled');
  new SimulationCore().advanceDays(s, 40); // 越过首个赛季边界（4 队双循环末轮 ~ day35）
  assertEquals(s.season, 2, '单 Competition 边界应触发一次 rollover');
  assertEquals(getSeasonCalendar(s).status, 'scheduled', 'rollover 后为下一季（scheduled）');
});

test('CS-B3. 多 Competition：A finished / B unfinished → 不构成 World 边界', () => {
  const mk = (statusA, statusB) => ({
    currentDate: '2026-12-31', season: 1,
    static: { leagues: [{ id: 'l1', countryId: 'c', tier: 1 }, { id: 'l2', countryId: 'c', tier: 2 }] },
    runtime: {
      clubs: {}, membership: { clubs: {}, players: {} },
      competitions: {
        l1: { season: 1, seasonStart: '2026-07-01', status: statusA, fixtures: [{ date: '2026-09-01', played: true }] },
        l2: { season: 1, seasonStart: '2026-09-01', status: statusB, fixtures: [{ date: '2026-11-01', played: true }] },
      },
    },
  });
  assert(!isSeasonBoundaryReached(mk('finished', 'in_progress')), 'A 完成 B 未完成 → false');
  assert(!isSeasonBoundaryReached(mk('in_progress', 'finished')), 'A 未完成 B 完成 → false');
  assert(isSeasonBoundaryReached(mk('finished', 'finished')), '均完成且越过最晚 endDate → true');
});

test('CS-B4. 空 participants → 边界 false、calendar status empty', () => {
  const s = { currentDate: '2026-12-31', season: 1, static: { leagues: [] }, runtime: { competitions: {}, clubs: {}, membership: { clubs: {}, players: {} } } };
  assert(!isSeasonBoundaryReached(s));
  assertEquals(getSeasonCalendar(s).status, 'empty');
});

test('CS-B5. getSeasonCalendar 多赛事聚合：season=max、endDate=max、status=全部 finished', () => {
  const s = {
    currentDate: '2026-12-31', season: 2,
    static: { leagues: [{ id: 'l1', countryId: 'c', tier: 1 }, { id: 'l2', countryId: 'c', tier: 2 }] },
    runtime: {
      clubs: {}, membership: { clubs: {}, players: {} },
      competitions: {
        l1: { season: 2, seasonStart: '2026-07-01', status: 'finished', fixtures: [{ date: '2026-09-01', played: true }] },
        l2: { season: 2, seasonStart: '2026-08-01', status: 'finished', fixtures: [{ date: '2026-10-15', played: true }] },
      },
    },
  };
  const cal = getSeasonCalendar(s);
  assertEquals(cal.season, 2);
  assertEquals(cal.startDate, '2026-07-01');
  assertEquals(cal.endDate, '2026-10-15');
  assertEquals(cal.status, 'finished');
});

// ===========================================================================
// Phase 1 — Division / Competition helpers + Rules
// ===========================================================================
test('CS-P1. helpers：divisionId === competitionId === leagueId（Phase 1）；context 正确', () => {
  const s = pyramidState(D2);
  assertEquals(getDivision(s, 'lg_d1').tier, 1);
  assertEquals(getCompetition(s, 'lg_d1').format, 'ROUND_ROBIN');
  assertEquals(getCompetition(s, 'lg_d1').divisionId, 'lg_d1');
  assertEquals(getCompetitionContext(s, 'clb_001').divisionId, 'lg_d1');
  assertEquals(getCompetitionContext(s, 'clb_001').countryId, 'cty_a');
});

test('CS-P2. Rules 默认（缺省）→ 2/2；提供则使用；非法值由 world validation 拒绝', () => {
  const s = pyramidState(D2);
  assertEquals(getCompetitionRules(s, 'lg_d1'), { promotionPlaces: 2, relegationPlaces: 2 });
  const s2 = pyramidState([{ id: 'lg_a', countryId: 'cty_a', tier: 1, teamCount: 4, rules: { promotionPlaces: 0, relegationPlaces: 1 } }]);
  assertEquals(getCompetitionRules(s2, 'lg_a'), { promotionPlaces: 0, relegationPlaces: 1 });
  // 非法 rules → parseWorld 抛错
  let threw = false;
  try { parseWorld({ manifest: { id: 'x', name: 'x', format: WORLD_FORMAT }, countries: [{ id: 'c', name: 'C' }], leagues: [{ id: 'l', name: 'L', countryId: 'c', tier: 1, rules: { promotionPlaces: -1 } }], teams: [], players: [] }); } catch { threw = true; }
  assert(threw, 'promotionPlaces=-1 应被拒绝');
});

test('CS-P3. World validation：同一国家重复 tier / 非连续 tier 明确拒绝', () => {
  const mk = (leagues) => ({ manifest: { id: 'x', name: 'x', format: WORLD_FORMAT }, countries: [{ id: 'c', name: 'C' }], leagues, teams: [], players: [] });
  let dup = false, gap = false;
  try { parseWorld(mk([{ id: 'a', name: 'A', countryId: 'c', tier: 1 }, { id: 'b', name: 'B', countryId: 'c', tier: 1 }])); } catch { dup = true; }
  try { parseWorld(mk([{ id: 'a', name: 'A', countryId: 'c', tier: 1 }, { id: 'b', name: 'B', countryId: 'c', tier: 3 }])); } catch { gap = true; }
  assert(dup, '重复 tier 应拒绝');
  assert(gap, '非连续 tier 应拒绝');
  // 单 Division 无 tier 仍合法（向后兼容）
  parseWorld(mk([{ id: 'a', name: 'A', countryId: 'c' }]));
});

// ===========================================================================
// Phase 3 — Planner（纯函数）
// ===========================================================================
test('CS-PLN1. 2 Division：D2 前 2 升级、D1 后 2 降级；top 不升、bottom 不降', () => {
  const leagues = [{ id: 'D1', countryId: 'c', tier: 1 }, { id: 'D2', countryId: 'c', tier: 2 }];
  const s = plannerState(leagues, { D1: ['a', 'b', 'c', 'd'], D2: ['e', 'f', 'g', 'h'] });
  const plan = planPromotionRelegation(s);
  const up = plan.movements.filter((m) => m.kind === 'promotion').map((m) => m.clubId).sort();
  const down = plan.movements.filter((m) => m.kind === 'relegation').map((m) => m.clubId).sort();
  assertEquals(up, ['e', 'f'], 'D2 前 2 升级');
  assertEquals(down, ['c', 'd'], 'D1 后 2 降级');
  assertEquals(plan.movements.length, 4);
  // top tier（D1）无 promotion；bottom tier（D2）无 relegation
  assert(!plan.movements.some((m) => m.kind === 'promotion' && m.fromDivisionId === 'D1'));
  assert(!plan.movements.some((m) => m.kind === 'relegation' && m.fromDivisionId === 'D2'));
});

test('CS-PLN2. 3 Division chain：一次调用生成完整 Plan；D2 同时升降', () => {
  const leagues = [{ id: 'D1', countryId: 'c', tier: 1 }, { id: 'D2', countryId: 'c', tier: 2 }, { id: 'D3', countryId: 'c', tier: 3 }];
  const s = plannerState(leagues, { D1: ['a', 'b', 'c', 'd'], D2: ['e', 'f', 'g', 'h'], D3: ['i', 'j', 'k', 'l'] });
  const plan = planPromotionRelegation(s);
  // D1: c,d 降级到 D2；D2: e,f 升 D1、g,h 降 D3；D3: i,j 升 D2
  assertEquals(plan.movements.filter((m) => m.kind === 'promotion').map((m) => m.clubId).sort(), ['e', 'f', 'i', 'j']);
  assertEquals(plan.movements.filter((m) => m.kind === 'relegation').map((m) => m.clubId).sort(), ['c', 'd', 'g', 'h']);
  // 无 club 重复移动
  const seen = new Set();
  for (const m of plan.movements) { assert(!seen.has(m.clubId), `重复 ${m.clubId}`); seen.add(m.clubId); }
});

test('CS-PLN3. clamp：名额 > size 时收敛；promotion+relegation 不重叠', () => {
  const leagues = [{ id: 'D1', countryId: 'c', tier: 1, rules: { promotionPlaces: 9, relegationPlaces: 9 } }, { id: 'D2', countryId: 'c', tier: 2, rules: { promotionPlaces: 9, relegationPlaces: 9 } }];
  const s = plannerState(leagues, { D1: ['a', 'b', 'c'], D2: ['d', 'e', 'f'] });
  const plan = planPromotionRelegation(s);
  // D1 (top): relegation=min(9,3)=3 → 全部降级；D2 (bottom): promotion=min(9,3)=3 → 全部升级
  // 但两者是不同俱乐部分布 → 每 club 恰好移动一次
  const ids = plan.movements.map((m) => m.clubId);
  assertEquals(new Set(ids).size, ids.length, '不得重复移动');
  assert(plan.movements.every((m) => m.fromDivisionId !== m.toDivisionId));
});

test('CS-PLN4. 多国家隔离：不同国家互不迁移', () => {
  const leagues = [
    { id: 'A1', countryId: 'ca', tier: 1 }, { id: 'A2', countryId: 'ca', tier: 2 },
    { id: 'B1', countryId: 'cb', tier: 1 }, { id: 'B2', countryId: 'cb', tier: 2 },
  ];
  const s = plannerState(leagues, { A1: ['a1', 'a2', 'a3', 'a4'], A2: ['a5', 'a6', 'a7', 'a8'], B1: ['b1', 'b2', 'b3', 'b4'], B2: ['b5', 'b6', 'b7', 'b8'] });
  const plan = planPromotionRelegation(s);
  for (const m of plan.movements) {
    const from = leagues.find((l) => l.id === m.fromDivisionId).countryId;
    const to = leagues.find((l) => l.id === m.toDivisionId).countryId;
    assertEquals(from, to, '不得跨国迁移');
  }
});

test('CS-PLN5. 确定性：同输入两次调用结果一致', () => {
  const leagues = [{ id: 'D1', countryId: 'c', tier: 1 }, { id: 'D2', countryId: 'c', tier: 2 }];
  const s = plannerState(leagues, { D1: ['a', 'b', 'c', 'd'], D2: ['e', 'f', 'g', 'h'] });
  assertEquals(planPromotionRelegation(s), planPromotionRelegation(s));
});

test('CS-PLN6. 单 Division：无 movement', () => {
  const s = plannerState([{ id: 'D1', countryId: 'c', tier: 1 }], { D1: ['a', 'b', 'c', 'd'] });
  assertEquals(planPromotionRelegation(s).movements, []);
});

// ===========================================================================
// Phase 2 — Transition API（atomic / all-or-nothing / 校验）
// ===========================================================================
function twoDivState() {
  return plannerState([{ id: 'D1', countryId: 'c', tier: 1 }, { id: 'D2', countryId: 'c', tier: 2 }],
    { D1: ['a', 'b', 'c', 'd'], D2: ['e', 'f', 'g', 'h'] });
}

test('CS-T1. 合法 apply：membership 迁移 + 全局校验通过；static teams 不变', () => {
  const s = twoDivState();
  const beforeStatic = JSON.stringify(s.static.teams);
  const plan = planPromotionRelegation(s);
  const r = applyPromotionRelegationTransition(s, plan);
  assertEquals(r.applied, true);
  assertEquals(r.moved, 4);
  assertEquals(getClubLeague(s, 'e'), 'D1');
  assertEquals(getClubLeague(s, 'c'), 'D2');
  assertEquals(validateMembership(s).fatal, []);
  assertEquals(JSON.stringify(s.static.teams), beforeStatic, 'static teams 不得改变');
});

test('CS-T2. 空 plan → no-op', () => {
  const s = twoDivState();
  const r = applyPromotionRelegationTransition(s, { movements: [] });
  assertEquals(r, { applied: false, moved: 0 });
});

test('CS-T3. 校验拒绝：重复移动 / source 不一致 / 不存在 club / 不存在 target / from===to', () => {
  const s = twoDivState();
  const bad = (movements) => { let e = null; try { validatePromotionRelegationPlan(s, { movements }); } catch (err) { e = err; } return e; };
  assert(bad([{ clubId: 'a', fromDivisionId: 'D1', toDivisionId: 'D2', kind: 'relegation' }, { clubId: 'a', fromDivisionId: 'D1', toDivisionId: 'D2', kind: 'relegation' }]), '重复移动应拒绝');
  assert(bad([{ clubId: 'a', fromDivisionId: 'D2', toDivisionId: 'D1', kind: 'promotion' }]), 'source 不一致应拒绝');
  assert(bad([{ clubId: 'zzz', fromDivisionId: 'D1', toDivisionId: 'D2', kind: 'relegation' }]), '不存在 club 应拒绝');
  assert(bad([{ clubId: 'a', fromDivisionId: 'D1', toDivisionId: 'D9', kind: 'relegation' }]), '不存在 target 应拒绝');
  assert(bad([{ clubId: 'a', fromDivisionId: 'D1', toDivisionId: 'D1', kind: 'relegation' }]), 'from===to 应拒绝');
});

test('CS-T4. 非相邻 tier 拒绝', () => {
  const s = plannerState([{ id: 'D1', countryId: 'c', tier: 1 }, { id: 'D3', countryId: 'c', tier: 3 }], { D1: ['a', 'b'], D3: ['c', 'd'] });
  let threw = false;
  try { validatePromotionRelegationPlan(s, { movements: [{ clubId: 'c', fromDivisionId: 'D3', toDivisionId: 'D1', kind: 'promotion' }] }); } catch { threw = true; }
  assert(threw, '跨级应拒绝');
});

test('CS-T5. atomic all-or-nothing：含非法项时 membership 完全不变', () => {
  const s = twoDivState();
  const before = JSON.stringify(s.runtime.membership.clubs);
  const badPlan = { movements: [
    { clubId: 'e', fromDivisionId: 'D2', toDivisionId: 'D1', kind: 'promotion' },
    { clubId: 'zzz', fromDivisionId: 'D2', toDivisionId: 'D1', kind: 'promotion' }, // 非法
  ] };
  let threw = false;
  try { applyPromotionRelegationTransition(s, badPlan); } catch { threw = true; }
  assert(threw);
  assertEquals(JSON.stringify(s.runtime.membership.clubs), before, '失败时不得部分修改');
});

test('CS-T6. 确定性：同状态 apply 两次结果一致', () => {
  const a = twoDivState(); const b = twoDivState();
  applyPromotionRelegationTransition(a, planPromotionRelegation(a));
  applyPromotionRelegationTransition(b, planPromotionRelegation(b));
  assertEquals(a.runtime.membership.clubs, b.runtime.membership.clubs);
});

// ===========================================================================
// Phase 4 — Rollover 集成（完整 SimulationCore）
// ===========================================================================
test('CS-INT1. 2 Division 世界：过边界后 membership 合法、每 club 恰属一个 Division、season 推进', () => {
  const s = pyramidState(D2);
  const before = JSON.stringify(s.runtime.membership.clubs);
  new SimulationCore().advanceDays(s, 40); // 越过一个赛季边界
  assertEquals(validateMembership(s).fatal, []);
  for (const c of Object.keys(s.runtime.clubs)) {
    assert(['lg_d1', 'lg_d2'].includes(getClubLeague(s, c)), `${c} 归属非法`);
  }
  assert(s.season >= 2, 'season 应推进');
  assert(JSON.stringify(s.runtime.membership.clubs) !== before, '应发生升降级（组成变化）');
  assertFinanceInvariants(s);
});

test('CS-INT2. 下一季 fixture 必须依据迁移后 membership 生成', () => {
  const s = pyramidState(D2);
  new SimulationCore().advanceDays(s, 40);
  for (const leagueId of ['lg_d1', 'lg_d2']) {
    const comp = s.runtime.competitions[leagueId];
    for (const f of comp.fixtures) {
      assertEquals(getClubLeague(s, f.homeId), leagueId, `${f.homeId} 不应出现在 ${leagueId} 赛程`);
      assertEquals(getClubLeague(s, f.awayId), leagueId, `${f.awayId} 不应出现在 ${leagueId} 赛程`);
    }
  }
});

test('CS-INT3. 确定性：同一初始状态两次运行 membership 完全一致', () => {
  const a = pyramidState(D2); const b = pyramidState(D2);
  new SimulationCore().advanceDays(a, 130);
  new SimulationCore().advanceDays(b, 130);
  assertEquals(a.runtime.membership.clubs, b.runtime.membership.clubs);
  assertEquals(a.season, b.season);
});

test('CS-INT4. static teams[].leagueId 永不因升降级改变', () => {
  const s = pyramidState(D2);
  const before = s.static.teams.map((t) => `${t.id}:${t.leagueId}`).join(',');
  new SimulationCore().advanceDays(s, 130);
  const after = s.static.teams.map((t) => `${t.id}:${t.leagueId}`).join(',');
  assertEquals(after, before, '静态库只读');
});

test('CS-INT5. 单 Division 世界：无升降级，行为等价（membership 不变）', () => {
  const s = pyramidState([{ id: 'lg_only', countryId: 'cty_a', tier: 1, teamCount: 8 }]);
  const before = JSON.stringify(s.runtime.membership.clubs);
  new SimulationCore().advanceDays(s, 130);
  assertEquals(JSON.stringify(s.runtime.membership.clubs), before, '单 Division 不应有任何迁移');
  assertEquals(validateMembership(s).fatal, []);
});

test('CS-INT6. 不破坏冻结系统：DDTI C1 常量、contracts/finance 不变量在长跑后保持', () => {
  assertEquals(DDTI_CONFIG.DEPTH_CAP, 14);
  assertEquals(DDTI_CONFIG.PER_CLUB_INTAKE_CAP, 1);
  assertEquals(DDTI_CONFIG.WORLD_INTAKE_CAP, 4);
  const s = pyramidState(D2);
  new SimulationCore().advanceDays(s, 50 * 125);
  assertEquals(validateMembership(s).fatal, []);
  assertContractInvariants(s);
  assertFinanceInvariants(s);
  for (const c of Object.keys(s.runtime.clubs)) {
    assert(getLeagueClubs(s, getClubLeague(s, c)).includes(c), `${c} 应在其当前 Division`);
  }
});
