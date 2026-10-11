/**
 * Continuous Match Loop Harness 测试（Test only）。
 * 验证：比赛阶段 / 时钟按既有契约从开赛推进到终场，并生成合法 FinalMatchResult。
 *
 * 覆盖边界：HALFTIME 边界、换边、REGULATION_COMPLETE、终场前置、失败退出、防死循环、
 *          无进展分类、非整除 Chunk、确定性、无共享状态。
 *
 * 说明：本测试仅证明「阶段 / 时钟闭环」，**不证明** PASS/SHOT、进球、球员行为完整性或完整比赛模拟成功。
 */

import { test, describe, assert, assertEquals, assertThrows } from './harness.js';
import {
  buildMinimalMatchCore, runMinimalMatchLoop, classifyDriverProgress,
  MATCH_LOOP_DEFAULTS, HALF_ELAPSED_SECONDS, REGULATION_ELAPSED_SECONDS,
} from './match-loop-harness.js';
import {
  createInitialMatchPhase, startMatch, startSecondHalf, runMatchPhaseDriver, validateMatchPhase,
} from '../src/core/match/match-phase.js';
import { createInitialMatchClock, validateMatchClock } from '../src/core/match/match-clock.js';
import { runMatchTick } from '../src/core/match/match-tick.js';
import { validateFinalMatchResult } from '../src/core/match/match-result.js';

/** 驱动直到 C-12 阶段满足 predicate（测试内通用推进器，不导出）。 */
function driveUntil(core, phase, clock, predicate, { chunk, seed, guardMax = 5000 } = {}) {
  let c = core; let p = phase; let k = clock; let guard = 0;
  while (!predicate(p)) {
    const res = runMatchPhaseDriver(c, p, k, chunk, { seed });
    assert(res.ok === true, `驱动应成功: ${JSON.stringify(res.error)}`);
    assertEquals(res.invariantIssues, [], '驱动不应产生不变量违规');
    c = res.matchCore; p = res.phase; k = res.clock;
    guard += 1;
    assert(guard < guardMax, 'driveUntil 超出保护上限');
  }
  return { core: c, phase: p, clock: k };
}

const SEED = MATCH_LOOP_DEFAULTS.seed;

describe('match-loop-harness', () => {
  test('1. 最小 MatchCore 与初始 Phase/Clock 合法', () => {
    const core = buildMinimalMatchCore();
    const tick = runMatchTick(core, {}, {});
    assertEquals(tick.tick.status, 'COMPLETED', 'tick 应为 COMPLETED');
    assertEquals(tick.invariantIssues, [], 'tick 不应有不变量违规');
    const phase = createInitialMatchPhase();
    const clock = createInitialMatchClock();
    assert(validateMatchPhase(phase).valid, '初始 MatchPhase 应合法');
    assert(validateMatchClock(clock).valid, '初始 MatchClock 应合法');
  });

  test('2 & 3. 上半场自然推进至 HALFTIME，elapsed 与契约一致', () => {
    const { phase, clock } = driveUntil(
      buildMinimalMatchCore(), startMatch(createInitialMatchPhase()), createInitialMatchClock(),
      (p) => p.phase === 'HALFTIME', { chunk: 137, seed: SEED },
    );
    assertEquals(phase.phase, 'HALFTIME');
    assertEquals(phase.elapsedSeconds, HALF_ELAPSED_SECONDS);
    assertEquals(phase.isBreak, true);
    assertEquals(clock.elapsedSeconds, HALF_ELAPSED_SECONDS);
  });

  test('4. startSecondHalf 合法边界成功；非法阶段失败', () => {
    const half = { phase: 'HALFTIME', elapsedSeconds: HALF_ELAPSED_SECONDS, half: 1, isBreak: true, isFinished: false };
    const second = startSecondHalf(half);
    assertEquals(second.phase, 'SECOND_HALF');
    assertEquals(second.elapsedSeconds, HALF_ELAPSED_SECONDS);
    // 非法阶段（FIRST_HALF）→ 抛 TypeError
    assertThrows(() => startSecondHalf(startMatch(createInitialMatchPhase())), 'TypeError');
  });

  test('5 & 6. 下半场推进至 REGULATION_COMPLETE 且终场前置满足', () => {
    const h = driveUntil(
      buildMinimalMatchCore(), startMatch(createInitialMatchPhase()), createInitialMatchClock(),
      (p) => p.phase === 'HALFTIME', { chunk: 137, seed: SEED },
    );
    const second = startSecondHalf(h.phase);
    const t = driveUntil(
      h.core, second, h.clock, (p) => p.phase === 'REGULATION_COMPLETE', { chunk: 137, seed: SEED },
    );
    assertEquals(t.phase.phase, 'REGULATION_COMPLETE');
    assertEquals(t.phase.isFinished, true);
    assertEquals(t.clock.elapsedSeconds, REGULATION_ELAPSED_SECONDS);
    assertEquals(t.clock.isFinished, true);
  });

  test('7 & 8. finalizeMatch 返回合法 FinalMatchResult 且校验通过', () => {
    const { result, phase, clock, secondHalfStarted } = runMinimalMatchLoop();
    assert(secondHalfStarted === true, '应显式开启下半场');
    assertEquals(phase.phase, 'REGULATION_COMPLETE');
    assertEquals(clock.elapsedSeconds, REGULATION_ELAPSED_SECONDS);
    assertEquals(result.ok, true);
    assertEquals(result.status, 'FINAL');
    assertEquals(result.phase, 'REGULATION_COMPLETE');
    assertEquals(result.elapsedSeconds, REGULATION_ELAPSED_SECONDS);
    assertEquals(result.home, { teamId: 'HOME', score: 0 });
    assertEquals(result.away, { teamId: 'AWAY', score: 0 });
    assertEquals(validateFinalMatchResult(result), { valid: true, issues: [] });
  });

  test('9. Harness 不通过手动修改阶段/时间/比分制造成功', () => {
    const caller = { matchId: 'caller-owned' };
    const callerSnapshot = JSON.stringify(caller);
    const out = runMinimalMatchLoop({ coreOverrides: caller });
    // 调用者传入对象未被修改。
    assertEquals(JSON.stringify(caller), callerSnapshot);
    // 时间只能经真实 Tick 推进：诊断中 ticksExecuted 累计 === 5400。
    const totalTicks = out.diagnostics.reduce((a, d) => a + (d.ticksExecuted ?? 0), 0);
    assertEquals(totalTicks, REGULATION_ELAPSED_SECONDS);
    // 无进球写入路径 → 比分保持 0:0。
    assertEquals(out.matchCore.score, { home: 0, away: 0 });
  });

  test('10. 非法驱动 / invariantIssues / 终场校验失败能够明确报错', () => {
    // (a) MatchCore 非法（ball 缺失）→ Tick INVALID → 驱动失败
    assertThrows(() => runMinimalMatchLoop({ coreOverrides: { ball: null } }), 'Error');
    // (b) 不变量违规（CONTROLLED 但 control 不在 players）
    const badBall = {
      position: { x: 0.5, y: 0.5 }, state: 'CONTROLLED', control: 'ghost',
      possessingTeamId: 'HOME', lastTouchPlayerId: null, velocity: { x: 0, y: 0 },
    };
    assertThrows(() => runMinimalMatchLoop({ coreOverrides: { ball: badBall } }), 'Error');
    // (c) 终场结果生成失败（非法 score → finalizeMatch 抛错）
    assertThrows(() => runMinimalMatchLoop({ coreOverrides: { score: { home: NaN, away: 0 } } }), 'TypeError');
  });

  test('11. 最大迭代次数能阻止无限循环', () => {
    let caught = null;
    try {
      runMinimalMatchLoop({ chunk: 1, maxIterations: 5 });
    } catch (e) { caught = e; }
    assert(caught instanceof Error, '应抛出错误而非静默退出');
    assert(Array.isArray(caught.diagnostics), '错误应携带诊断信息');
    assert(caught.diagnostics.length > 0, '诊断应非空');
  });

  test('12. 无进展检测区分合法边界、暂停、真正停滞与失败', () => {
    const resBase = { phase: { phase: 'FIRST_HALF' }, clock: { elapsedSeconds: 100 }, ticksExecuted: 0 };
    assertEquals(classifyDriverProgress({ phase: 'FIRST_HALF', elapsedSeconds: 100 }, { ...resBase, ok: true, lifecycle: 'TICKED' }), 'STALL');
    assertEquals(classifyDriverProgress({ phase: 'FIRST_HALF', elapsedSeconds: 100 }, { ...resBase, ok: true, lifecycle: 'AT_PHASE_BOUNDARY' }), 'BOUNDARY');
    assertEquals(classifyDriverProgress({ phase: 'HALFTIME', elapsedSeconds: 2700 }, { ok: true, lifecycle: 'PAUSED_HALFTIME', phase: { phase: 'HALFTIME' }, clock: { elapsedSeconds: 2700 }, ticksExecuted: 0 }), 'PAUSED');
    assertEquals(classifyDriverProgress({ phase: 'FIRST_HALF', elapsedSeconds: 0 }, { ok: true, lifecycle: 'TICKED', phase: { phase: 'FIRST_HALF' }, clock: { elapsedSeconds: 300 }, ticksExecuted: 300 }), 'PROGRESS');
    assertEquals(classifyDriverProgress({ phase: 'FIRST_HALF', elapsedSeconds: 100 }, { ok: false }), 'FAILED');
  });

  test('13. 不同（含非整除）Chunk 都能到达终场', () => {
    for (const chunk of [1, 7, 137, 300, 2700]) {
      const out = runMinimalMatchLoop({ chunk, maxIterations: 20000 });
      assertEquals(out.phase.phase, 'REGULATION_COMPLETE', `chunk=${chunk} 应达终场`);
      assertEquals(out.clock.elapsedSeconds, REGULATION_ELAPSED_SECONDS, `chunk=${chunk} 时间应为 5400`);
    }
  });

  test('14. 相同初始状态 / Seed / 配置重复运行结果一致', () => {
    const a = runMinimalMatchLoop({ seed: 's1', chunk: 137 });
    const b = runMinimalMatchLoop({ seed: 's1', chunk: 137 });
    assertEquals(JSON.stringify(a.result), JSON.stringify(b.result));
    assertEquals(a.iterations, b.iterations);
    assertEquals(a.secondHalfStarted, b.secondHalfStarted);
  });

  test('15. 两次运行之间不存在共享可变状态', () => {
    const a = runMinimalMatchLoop();
    const b = runMinimalMatchLoop();
    assert(a.matchCore !== b.matchCore, 'matchCore 不应共享引用');
    assert(a.matchCore.ball !== b.matchCore.ball, 'ball 不应共享引用');
    assert(a.phase !== b.phase, 'phase 不应共享引用');
    a.result.home.score = 999;
    assertEquals(b.result.home.score, 0, '修改 a 不应影响 b');
  });
});