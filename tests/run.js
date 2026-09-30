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
import './injury.test.js';
import './ecosystem.test.js';
import './lifecycle.test.js';
import './membership.test.js';
import './lineup.test.js';
import './save.test.js';
import './indexeddb.test.js';

const { passed, failed, results } = await runTests((r) => {
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${r.name}${r.ok ? '' : `\n         ${r.error}`}`);
});

console.log(`\n合计：${passed} 通过，${failed} 失败（共 ${results.length} 个用例）`);
process.exit(failed > 0 ? 1 : 0);