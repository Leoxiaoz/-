/**
 * Node 测试入口。
 * 用法：node tests/run.js  （或 npm test）
 */

import { runTests } from './harness.js';

// 导入即注册用例
import './world.test.js';
import './core.test.js';
import './save.test.js';

const { passed, failed, results } = await runTests((r) => {
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${r.name}${r.ok ? '' : `\n         ${r.error}`}`);
});

console.log(`\n合计：${passed} 通过，${failed} 失败（共 ${results.length} 个用例）`);
process.exit(failed > 0 ? 1 : 0);