/**
 * Step 39F-M-C —— Team Shape 测试（类别 B）。
 * 覆盖：IP / OOP Shape / ball-relative shift / bounded shift / shape validity / no shape collapse / 确定性。
 */

import { test, assert, assertEquals } from './harness.js';
import { buildTacticalContext } from '../src/core/match/tactical-context.js';
import { getTacticalState } from '../src/core/match/tactical-state.js';
import { buildTeamShape } from '../src/core/match/team-shape.js';
import { SHAPE_KIND, SHAPE } from '../src/core/match/movement-config.js';
import { H, A, mkCore } from './movement-fixtures.js';

function shapeOf(core, teamId) {
  const tac = getTacticalState(core, teamId);
  const ctx = buildTacticalContext(core, teamId);
  return buildTeamShape(core, teamId, ctx, tac);
}

function mean(arr, f) { return arr.reduce((s, v) => s + f(v), 0) / arr.length; }

test('TeamShape：有球 → IN_POSSESSION；无球 → OUT_OF_POSSESSION', () => {
  assertEquals(shapeOf(mkCore({ possessingTeamId: H }), H).kind, SHAPE_KIND.IN_POSSESSION);
  assertEquals(shapeOf(mkCore({ possessingTeamId: A, ballControl: 'a_mf1' }), H).kind, SHAPE_KIND.OUT_OF_POSSESSION);
});

test('TeamShape：覆盖全部可用球员，位置均有界', () => {
  const s = shapeOf(mkCore(), H);
  assertEquals(Object.keys(s.anchors).length, 11);
  for (const a of Object.values(s.anchors)) {
    assert(a.x >= 0 && a.x <= 1, `x 越界 ${a.x}`);
    assert(a.y >= 0 && a.y <= 1, `y 越界 ${a.y}`);
  }
});

test('TeamShape：width=wide 的横向展开大于 narrow', () => {
  const wide = shapeOf(mkCore({ tacticalState: { [H]: { width: 'wide' } } }), H);
  const narrow = shapeOf(mkCore({ tacticalState: { [H]: { width: 'narrow' } } }), H);
  assert(wide.width > narrow.width, `wide(${wide.width}) 应 > narrow(${narrow.width})`);
});

test('TeamShape：OOP 比 IP 更紧凑（spread 更小）', () => {
  const ip = shapeOf(mkCore({ possessingTeamId: H }), H);
  const oop = shapeOf(mkCore({ possessingTeamId: A, ballControl: 'a_mf1' }), H);
  assert(oop.spread < ip.spread, `OOP spread(${oop.spread}) 应 < IP spread(${ip.spread})`);
});

test('TeamShape：Ball-relative shift 有界（不追球 / 不崩塌）', () => {
  const neutral = shapeOf(mkCore({ ballPos: { x: 0.5, y: 0.5 } }), H);
  const extreme = shapeOf(mkCore({ ballPos: { x: 0.02, y: 0.02 } }), H);
  let maxMove = 0;
  for (const id of Object.keys(neutral.anchors)) {
    const a = neutral.anchors[id], b = extreme.anchors[id];
    maxMove = Math.max(maxMove, Math.hypot(a.x - b.x, a.y - b.y));
  }
  assert(maxMove <= 0.2, `位移应 bounded，实际 ${maxMove}`);
  // 结构未崩塌：仍有明显展开与纵深
  assert(extreme.spread > 0.1, `spread 过小 ${extreme.spread}`);
  assert(extreme.depth > 0.2, `depth 过小 ${extreme.depth}`);
});

test('TeamShape：整块随球纵移（球更靠前 → 平均位置更靠前）', () => {
  const back = shapeOf(mkCore({ ballPos: { x: 0.15, y: 0.5 } }), H);
  const front = shapeOf(mkCore({ ballPos: { x: 0.85, y: 0.5 } }), H);
  const mb = mean(Object.values(back.anchors), (a) => a.x);
  const mf = mean(Object.values(front.anchors), (a) => a.x);
  assert(mf > mb, `整块应随球前移：${mf} vs ${mb}`);
});

test('TeamShape：defensiveLine deep 的防线更靠后', () => {
  const deep = shapeOf(mkCore({ possessingTeamId: A, ballControl: 'a_mf1', tacticalState: { [H]: { defensiveLine: 'deep' } } }), H);
  const high = shapeOf(mkCore({ possessingTeamId: A, ballControl: 'a_mf1', tacticalState: { [H]: { defensiveLine: 'high' } } }), H);
  const dfMean = (s) => mean(Object.entries(s.anchors).filter(([id]) => id.startsWith('h_df')).map(([, a]) => a), (a) => a.x);
  assert(dfMean(deep) < dfMean(high), `deep 防线应更靠后：${dfMean(deep)} vs ${dfMean(high)}`);
});

test('TeamShape：标量均在 [0,1] 且非退化', () => {
  const s = shapeOf(mkCore(), H);
  for (const k of ['width', 'depth', 'compactness', 'lineHeight']) {
    assert(s[k] >= 0 && s[k] <= 1, `${k}=${s[k]} 越界`);
  }
  assert(s.compactness < 1, '不应为完全退化结构');
  void SHAPE;
});

test('TeamShape：确定性输出', () => {
  const c = mkCore();
  assertEquals(shapeOf(c, H), shapeOf(c, H));
});