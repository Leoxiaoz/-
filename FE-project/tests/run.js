/**
 * Node 测试入口。
 * 用法：node tests/run.js  （或 npm test）
 */

import { runTests } from './harness.js';

// 导入即注册用例
import './world.test.js';
import './core.test.js';
import './match.test.js';
import './involvement.test.js';
import './season.test.js';
import './performance.test.js';
import './consumption.test.js';
import './foundation.test.js';
import './player-runtime.test.js';
import './growth.test.js';
import './growth-engine.test.js';
import './injury.test.js';
import './ecosystem.test.js';
import './lifecycle.test.js';
import './membership.test.js';
import './free-agent.test.js';
import './transfer.test.js';
import './ai.test.js';
import './ai-depth-intake.test.js';
import './ai-potential-estimate.test.js';
import './ai-selection-development.test.js';
import './ai-minute-allocation.test.js';
import './ai-training-decision.test.js';
import './ai-relative-role-load.test.js';
import './ai-development-plan.test.js';
import './ai-development-philosophy.test.js';
import './match-decision.test.js';
import './match-decision-calibration.test.js';
import './match-pass-resolution.test.js';
import './match-shot-resolution.test.js';
import './match-tactical-context.test.js';
import './match-team-shape.test.js';
import './match-movement.test.js';
import './match-movement-architecture.test.js';
import './match-movement-harness.test.js';
import './match-ball-physics.test.js';
import './match-ball-causality.test.js';
import './match-interaction-resolution.test.js';
import './match-interaction-integration.test.js';
import './match-second-ball-resolution.test.js';
import './match-resolution-calibration.test.js';
import './match-tick.test.js';
import './match-ticks.test.js';
import './match-clock.test.js';
import './match-phase.test.js';
import './match-result.test.js';
import './goal-resolution.test.js';
import './goal-geometry.test.js';
import './ball-tick-segment.test.js';
import './goal-aware-match-tick.test.js';
import './goal-aware-match-ticks.test.js';
import './ball-trajectory.test.js';
import './trajectory-goal-detection.test.js';
import './goal-crossing-resolution.test.js';
import './trajectory-goal-match-tick.test.js';
import './ball-movement-state.test.js';
import './ball-movement-integration.test.js';
import './action-ball-movement-state.test.js';
import './development-derived.test.js';
import './finance-feedback.test.js';
import './competition.test.js';
import './lineup.test.js';
import './save.test.js';
import './indexeddb.test.js';

const { passed, failed, results } = await runTests((r) => {
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${r.name}${r.ok ? '' : `\n         ${r.error}`}`);
});

console.log(`\n合计：${passed} 通过，${failed} 失败（共 ${results.length} 个用例）`);
process.exit(failed > 0 ? 1 : 0);