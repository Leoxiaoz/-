/**
 * 极简测试框架（零依赖）。
 * 目标：满足第 13 步「测试框架可以运行」，同时可在 Node 与浏览器中复用。
 * 说明：这不是要长期绑定某个测试库；未来如需替换，替换本文件的实现即可。
 */

const registry = [];

/** 注册一个测试用例。 */
export function test(name, fn) {
  registry.push({ name, fn });
}

/** 注册一组用例。 */
export function describe(suiteName, defineFn) {
  const before = registry.length;
  defineFn();
  for (let i = before; i < registry.length; i += 1) {
    registry[i].name = `${suiteName} › ${registry[i].name}`;
  }
}

/** 断言为真。 */
export function assert(condition, message = '断言失败') {
  if (!condition) throw new Error(message);
}

/** 断言相等（对象按 JSON 比较）。 */
export function assertEquals(actual, expected, message = '值不相等') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  实际: ${a}\n  期望: ${b}`);
}

/** 断言抛出错误；可选校验错误名。 */
export function assertThrows(fn, expectedName, message = '期望抛出错误') {
  let threw = null;
  try {
    fn();
  } catch (err) {
    threw = err;
  }
  if (!threw) throw new Error(message);
  if (expectedName && threw.name !== expectedName) {
    throw new Error(`${message}\n  实际错误: ${threw.name}\n  期望错误: ${expectedName}`);
  }
}

/** 提供已注册用例的只读视图。 */
export function getRegistry() {
  return registry.slice();
}

/**
 * 运行全部已注册用例。
 * @param {(result: object) => void} [onResult] 每个用例结束时回调
 * @returns {Promise<{passed: number, failed: number, results: object[]}>}
 */
export async function runTests(onResult) {
  const results = [];
  let passed = 0;
  let failed = 0;

  for (const { name, fn } of registry) {
    try {
      await fn();
      passed += 1;
      const result = { name, ok: true };
      results.push(result);
      onResult?.(result);
    } catch (err) {
      failed += 1;
      const result = { name, ok: false, error: err?.message ?? String(err) };
      results.push(result);
      onResult?.(result);
    }
  }

  return { passed, failed, results };
}