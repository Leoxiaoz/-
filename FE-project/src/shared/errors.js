/**
 * 基础错误类型与统一上报。
 * 设计目标（对应 DATABASE_SPEC §6 / SAVE_SPEC §6 的错误可定位要求）：
 * 错误必须能说明「来源 / 实体 / 字段 / 问题」，而不是静默失败。
 */

/** 所有项目自定义错误的基类。 */
export class AppError extends Error {
  /**
   * @param {string} message 面向开发者的说明
   * @param {{code?: string, context?: object, cause?: Error}} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code ?? 'APP_ERROR';
    this.context = options.context ?? {};
  }

  /** 便于日志与 UI 展示的结构化描述。 */
  describe() {
    const ctx = Object.entries(this.context)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    return `${this.code}: ${this.message}${ctx ? ` (${ctx})` : ''}`;
  }
}

/** 数据层错误（加载 / 校验 / 兼容性）。 */
export class DataError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: 'DATA_ERROR', ...options });
  }
}

/** 存档层错误（读写 / 迁移 / 损坏）。 */
export class SaveError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: 'SAVE_ERROR', ...options });
  }
}

/** 模拟核心错误。 */
export class SimulationError extends AppError {
  constructor(message, options = {}) {
    super(message, { code: 'SIMULATION_ERROR', ...options });
  }
}

/**
 * 统一上报：将未知错误规整为 AppError，写入日志，并返回可展示文本。
 * @param {unknown} err
 * @param {{error: Function}} logger
 * @returns {string}
 */
export function reportError(err, logger) {
  const appErr = err instanceof AppError ? err : new AppError(String(err), { cause: err });
  logger?.error?.(appErr.describe());
  return appErr.describe();
}