/**
 * Action Registry（Step 39F-M-B-IMPLEMENTATION-01）。
 * 层级归属：Simulation Core / Match Decision。纯数据 + 纯函数，无副作用、无 RNG。
 *
 * 职责：注册 / 查询 / 校验 Action Definition。
 * 语义：核心 Decision Pipeline **只经 Registry 驱动**，不写死 `if action === PASS/...`。
 * 红线：不修改 MatchCore / 不持久化 / 无 Math.random。
 */

import { ACTION_TYPES } from './decision-config.js';
import { ACTION_DEFINITIONS, TARGET_SEMANTICS } from './action-definitions.js';

const REQUIRED_FIELDS = ['type', 'targetSemantics', 'commitmentPolicy', 'availability', 'generateCandidates', 'preference', 'resolutionHandler'];

/** 校验 Action Definition 结构；返回问题列表（空数组 = 合法）。 */
export function validateActionDefinition(def) {
  const issues = [];
  if (!def || typeof def !== 'object') return ['definition 必须是对象'];
  for (const f of REQUIRED_FIELDS) {
    if (!(f in def)) issues.push(`缺少字段 ${f}`);
  }
  if (typeof def.type !== 'string' || def.type.length === 0) issues.push('type 必须是非空字符串');
  if (!Object.values(TARGET_SEMANTICS).includes(def.targetSemantics)) issues.push('targetSemantics 非法');
  if (typeof def.availability !== 'function') issues.push('availability 必须是函数');
  if (typeof def.generateCandidates !== 'function') issues.push('generateCandidates 必须是函数');
  if (typeof def.preference !== 'function') issues.push('preference 必须是函数');
  if (!def.commitmentPolicy || typeof def.commitmentPolicy.type !== 'string') issues.push('commitmentPolicy.type 非法');
  // resolutionHandler 允许为 null（占位），但字段必须存在
  return issues;
}

/** 创建 Action Registry。 */
export function createActionRegistry(initial = []) {
  const map = new Map();
  const registry = {
    /** 注册一个 ActionDefinition；重复注册或非法定义会抛错。 */
    register(def) {
      const issues = validateActionDefinition(def);
      if (issues.length > 0) {
        throw new Error(`非法 ActionDefinition: ${issues.join(', ')}`);
      }
      if (map.has(def.type)) {
        throw new Error(`重复注册 Action: ${def.type}`);
      }
      map.set(def.type, def);
      return registry;
    },
    get(type) { return map.get(type) ?? null; },
    has(type) { return map.has(type); },
    /** 已注册类型（确定性升序）。 */
    list() { return [...map.keys()].sort(); },
    all() { return registry.list().map((t) => map.get(t)); },
  };
  for (const def of initial) registry.register(def);
  return registry;
}

/** 默认 Registry：预载六个 MVP Action。 */
export const DEFAULT_ACTION_REGISTRY = createActionRegistry(ACTION_TYPES.map((t) => ACTION_DEFINITIONS[t]));
