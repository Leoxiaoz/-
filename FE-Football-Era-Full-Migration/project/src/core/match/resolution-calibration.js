/**
 * Resolution Calibration —— 校验 / 解析层（Step 39F-M-C-09）。
 * 层级归属：Simulation Core / Match Resolution。**纯函数、无副作用、无 RNG、无墙钟**。
 *
 * 职责：
 * 1. 为 Calibration Profile 提供**单一语义规格**（`CALIBRATION_PARAM_SPECS`）：每个参数回答
 *    「控制什么 / kind / 合法范围 / 状态（TBD_CAL）」；
 * 2. 提供确定性校验 `assertValidCalibrationConfig`（拒绝 NaN / Infinity / 未知参数 / 越界）；
 * 3. 提供解析入口 `resolveCalibrationProfile`（无 override → 默认 profile；有 → 校验后使用）。
 *
 * **单一 Calibration Truth**：本文件不定义任何数值，只描述 / 校验；数值唯一来源是
 * `resolution-calibration-config.js` 的 `DEFAULT_CALIBRATION_PROFILE`。
 *
 * 语义约定（明确，不含糊）：
 * - `probability`：0 ≤ p ≤ 1。
 * - `ratio`：0 ≤ r ≤ 1（离散分支的比例）。
 * - `weight`：有限数字，**不得为负**（0 允许）；**不要求归一化**（权重之和无需为 1）。
 * - `range`：有限数字，必须 > 0。
 * - `normalizer`：有限数字，必须 > 0。
 * - `minScore`：有限数字，0 ≤ s ≤ 1（竞争分数的合法阈值语义）。
 *
 * Override：`resolveCalibrationProfile(profile)` 只读校验，**不修改**传入对象、不产生全局状态。
 */

import {
  DEFAULT_CALIBRATION_PROFILE,
  RESOLUTION_CALIBRATION_VERSION,
} from './resolution-calibration-config.js';

export { DEFAULT_CALIBRATION_PROFILE, RESOLUTION_CALIBRATION_VERSION };

/** 参数 kind 枚举。 */
export const CALIBRATION_KIND = Object.freeze({
  PROBABILITY: 'probability',
  RATIO: 'ratio',
  WEIGHT: 'weight',
  RANGE: 'range',
  NORMALIZER: 'normalizer',
  MIN_SCORE: 'minScore',
});

/** 参数状态枚举（本 Gate 全部为 TBD_CAL：合法、确定、可运行的默认值，非最终平衡）。 */
export const CALIBRATION_STATUS = Object.freeze({
  TBD_CAL: 'TBD_CAL',
  CALIBRATED: 'CALIBRATED',
});

const { PROBABILITY, RATIO, WEIGHT, RANGE, NORMALIZER, MIN_SCORE } = CALIBRATION_KIND;

/**
 * 单一参数语义规格（唯一描述来源；供校验与文档消费）。
 * 结构：interaction.<discipline>.<PARAM> / secondBall.<PARAM>。
 */
export const CALIBRATION_PARAM_SPECS = Object.freeze({
  interaction: Object.freeze({
    dribble: Object.freeze({
      BASE_SUCCESS: { kind: PROBABILITY, status: CALIBRATION_STATUS.TBD_CAL, note: 'DRIBBLE 基础成功概率' },
      TECHNIQUE_WEIGHT: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '技术属性对成功率的加成权重' },
      PACE_WEIGHT: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '速度属性对成功率的加成权重' },
      PRESSURE_PENALTY: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '对手压迫对成功率的扣减权重' },
      FREE_SPACE_BONUS: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '挑战半径内无对手时的加成权重' },
      LOOSE_RATIO: { kind: RATIO, status: CALIBRATION_STATUS.TBD_CAL, note: '失败时转为 loose ball 的比例' },
    }),
    tackle: Object.freeze({
      BASE_SUCCESS: { kind: PROBABILITY, status: CALIBRATION_STATUS.TBD_CAL, note: 'TACKLE 基础成功概率' },
      DEFENDING_WEIGHT: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '抢断者防守属性的加成权重' },
      CLOSENESS_WEIGHT: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '接近程度的加成权重' },
      CARRIER_TECHNIQUE_PENALTY: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '持球人技术的扣减权重' },
      CARRIER_PACE_PENALTY: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '持球人速度的扣减权重' },
      LOOSE_RATIO: { kind: RATIO, status: CALIBRATION_STATUS.TBD_CAL, note: '失败时转为 loose ball 的比例' },
    }),
    press: Object.freeze({
      BASE_SUCCESS: { kind: PROBABILITY, status: CALIBRATION_STATUS.TBD_CAL, note: 'PRESS 基础成功概率' },
      DEFENDING_WEIGHT: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '压迫者防守属性的加成权重' },
      CLOSENESS_WEIGHT: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '接近程度的加成权重' },
      TEAM_PRESSING_WEIGHT: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '球队整体压迫战术的加成权重' },
      CARRIER_COMPOSURE_PENALTY: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '持球人技术/冷静的扣减权重' },
      PRESSURE_ONLY_RATIO: { kind: RATIO, status: CALIBRATION_STATUS.TBD_CAL, note: '未成功时转为「施压」的比例' },
    }),
    interception: Object.freeze({
      BASE_SUCCESS: { kind: PROBABILITY, status: CALIBRATION_STATUS.TBD_CAL, note: 'INTERCEPTION 基础成功概率' },
      DEFENDING_WEIGHT: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '拦截者防守属性的加成权重' },
      REACH_WEIGHT: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '到球轨迹可达程度的加成权重' },
      PROGRESS_PENALTY: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '传球进度对拦截的扣减权重' },
      DEFLECT_RATIO: { kind: RATIO, status: CALIBRATION_STATUS.TBD_CAL, note: '未成功时转为触球脱手的比例' },
    }),
  }),
  secondBall: Object.freeze({
    RANGE: { kind: RANGE, status: CALIBRATION_STATUS.TBD_CAL, note: '二点球争抢半径（球员到球距离上限）' },
    MIN_SCORE: { kind: MIN_SCORE, status: CALIBRATION_STATUS.TBD_CAL, note: '最低获胜分数阈值（低于视为无法形成合法 winner）' },
    PROXIMITY_WEIGHT: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '到达优势（距离接近度）权重' },
    CLOSING_WEIGHT: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '到达优势（接近速度）权重' },
    CLOSING_SPEED_NORM: { kind: NORMALIZER, status: CALIBRATION_STATUS.TBD_CAL, note: '接近速度归一化基准' },
    ABILITY_DEFENDING_WEIGHT: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '相关能力（防守）权重' },
    ABILITY_PACE_WEIGHT: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: '相关能力（速度）权重' },
    CONTEXT_WEIGHT: { kind: WEIGHT, status: CALIBRATION_STATUS.TBD_CAL, note: 'soft state（fitness/form/morale）权重' },
  }),
});

const TOP_LEVEL_KEYS = Object.freeze(['calibrationVersion', 'interaction', 'secondBall']);

function fail(message) {
  throw new Error(`[Calibration] ${message}`);
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 校验单个数值合法性（按 kind）；NaN / Infinity 一律拒绝。 */
function checkNumber(value, path, kind) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${path} 必须是有限数字（拒绝 NaN / Infinity / 非数字），实际: ${String(value)}`);
  }
  if (kind === PROBABILITY || kind === RATIO || kind === MIN_SCORE) {
    if (value < 0 || value > 1) fail(`${path} 必须满足 0 ≤ value ≤ 1（kind=${kind}），实际: ${value}`);
  } else if (kind === WEIGHT) {
    if (value < 0) fail(`${path} 作为 weight 不得为负（0 允许；不要求归一化），实际: ${value}`);
  } else if (kind === RANGE || kind === NORMALIZER) {
    if (value <= 0) fail(`${path} 必须 > 0（kind=${kind}），实际: ${value}`);
  } else {
    fail(`${path} 未知 kind: ${kind}`);
  }
}

/** 校验一个扁平参数段（拒绝未知参数 / 缺失参数）。 */
function checkFlatSection(section, specs, path) {
  if (!isPlainObject(section)) fail(`${path} 必须是对象`);
  for (const key of Object.keys(section)) {
    if (!Object.prototype.hasOwnProperty.call(specs, key)) fail(`${path}.${key} 是未知参数（禁止 unknown parameter）`);
  }
  for (const key of Object.keys(specs)) {
    if (!Object.prototype.hasOwnProperty.call(section, key)) fail(`${path}.${key} 缺失（override profile 必须完整）`);
    checkNumber(section[key], `${path}.${key}`, specs[key].kind);
  }
}

/**
 * 断言 Calibration Profile 合法。
 *
 * 检查项：
 * - 顶层仅允许 calibrationVersion / interaction / secondBall；
 * - calibrationVersion 必须为非空字符串；
 * - interaction 必须精确包含 dribble / tackle / press / interception 四个 discipline；
 * - 每个 discipline 与 secondBall 的参数集必须精确匹配规格（拒绝未知 / 缺失）；
 * - 概率 / ratio / minScore ∈ [0,1]；weight ≥ 0；range / normalizer > 0；拒绝 NaN / Infinity。
 *
 * 不修改 config；校验通过返回原对象（便于链式使用）。
 * @param {object} config
 * @returns {object} 同一 config
 */
export function assertValidCalibrationConfig(config) {
  if (!isPlainObject(config)) fail('config 必须是对象');
  for (const key of Object.keys(config)) {
    if (!TOP_LEVEL_KEYS.includes(key)) fail(`未知顶层字段: ${key}`);
  }
  if (typeof config.calibrationVersion !== 'string' || config.calibrationVersion.length === 0) {
    fail('calibrationVersion 必须是非空字符串');
  }

  const disciplineSpecs = CALIBRATION_PARAM_SPECS.interaction;
  if (!isPlainObject(config.interaction)) fail('interaction 必须是对象');
  for (const d of Object.keys(config.interaction)) {
    if (!Object.prototype.hasOwnProperty.call(disciplineSpecs, d)) fail(`interaction.${d} 是未知 discipline`);
  }
  for (const d of Object.keys(disciplineSpecs)) {
    if (!Object.prototype.hasOwnProperty.call(config.interaction, d)) fail(`interaction.${d} 缺失`);
    checkFlatSection(config.interaction[d], disciplineSpecs[d], `interaction.${d}`);
  }

  checkFlatSection(config.secondBall, CALIBRATION_PARAM_SPECS.secondBall, 'secondBall');
  return config;
}

/**
 * 解析生效的 Calibration Profile。
 * - 无 override（null / undefined）→ 返回默认 profile（单一 truth）。
 * - 有 override → 校验后返回（不修改传入对象；不建立全局状态）。
 *
 * @param {object|null|undefined} profile
 * @returns {object} 生效 profile（默认或校验通过的 override）
 */
export function resolveCalibrationProfile(profile) {
  if (profile == null) return DEFAULT_CALIBRATION_PROFILE;
  return assertValidCalibrationConfig(profile);
}

/** 判断是否使用默认 profile（用于复用冻结的派生 config，避免每次分配）。 */
export function isDefaultCalibrationProfile(profile) {
  return profile === DEFAULT_CALIBRATION_PROFILE;
}