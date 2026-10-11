/**
 * 基础日志机制。
 * 分层：shared 层通用能力，不含任何游戏规则。
 * 说明：游戏核心不得依赖浏览器控制台 API 之外的宿主环境；本模块仅使用最通用的 console。
 */

export const LOG_LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
});

/**
 * 创建一个带作用域标签的 logger。
 * @param {string} scope 作用域标签（如 "controller"、"simulation"）
 * @param {{level?: string, sink?: Function}} [options]
 */
export function createLogger(scope = 'app', options = {}) {
  let threshold = LOG_LEVELS[options.level] ?? LOG_LEVELS.info;
  // 允许注入输出目标，便于测试或未来替换（默认 console）
  const sink = options.sink ?? defaultSink;

  function log(levelName, args) {
    if (LOG_LEVELS[levelName] < threshold) return;
    sink(levelName, `[${scope}]`, ...args);
  }

  return {
    debug: (...args) => log('debug', args),
    info: (...args) => log('info', args),
    warn: (...args) => log('warn', args),
    error: (...args) => log('error', args),
    setLevel(name) {
      if (!(name in LOG_LEVELS)) return;
      threshold = LOG_LEVELS[name];
    },
    getLevel() {
      return Object.keys(LOG_LEVELS).find((k) => LOG_LEVELS[k] === threshold) ?? 'info';
    },
  };
}

function defaultSink(level, prefix, ...args) {
  const fn = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
  // eslint-disable-next-line no-console
  console[fn]?.(prefix, ...args);
}