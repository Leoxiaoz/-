/**
 * Resolution Calibration Profile —— 默认校准数据集**纯数据**（Step 39F-M-C-09）。
 * 层级归属：Simulation Core / Match Resolution。纯数据，无副作用、无 RNG、无墙钟。
 *
 * **单一 Calibration Truth**：本文件是 Resolution 平衡参数（probability / weight / ratio /
 * range / normalizer / score-threshold）的**唯一权威来源**。`interaction-resolution-config.js`
 * 与 `second-ball-resolution-config.js` 的数值均由此派生，禁止在别处再维护第二份。
 *
 * ⚠ 全部参数 status = **TBD_CAL**：合法、确定、可运行的默认值；**非最终真实足球概率**，
 * 未来由校准时替换 / 覆盖，不改核心算法。
 *
 * 红线：不改 Save / Schema；不接 Renderer / Production Loop；无 Math.random；无 wall-clock；
 * 不建立第二套 Ball / Possession / Geometry / Player Truth。
 */

/** Calibration Profile 版本（写入 Resolution metadata；**不进入 MatchCore Truth**）。 */
export const RESOLUTION_CALIBRATION_VERSION = 'C09-v1';

/**
 * 默认 Calibration Profile（C09-v1）。
 * 结构与 Resolution Config 分层对应：calibration.interaction.<discipline>.<param> / .secondBall.<param>。
 */
export const DEFAULT_CALIBRATION_PROFILE = Object.freeze({
  calibrationVersion: RESOLUTION_CALIBRATION_VERSION,

  interaction: Object.freeze({
    dribble: Object.freeze({
      BASE_SUCCESS: 0.60,
      TECHNIQUE_WEIGHT: 0.22,
      PACE_WEIGHT: 0.12,
      PRESSURE_PENALTY: 0.35,
      FREE_SPACE_BONUS: 0.15,
      LOOSE_RATIO: 0.55,
    }),
    tackle: Object.freeze({
      BASE_SUCCESS: 0.42,
      DEFENDING_WEIGHT: 0.28,
      CLOSENESS_WEIGHT: 0.12,
      CARRIER_TECHNIQUE_PENALTY: 0.30,
      CARRIER_PACE_PENALTY: 0.10,
      LOOSE_RATIO: 0.50,
    }),
    press: Object.freeze({
      BASE_SUCCESS: 0.26,
      DEFENDING_WEIGHT: 0.18,
      CLOSENESS_WEIGHT: 0.12,
      TEAM_PRESSING_WEIGHT: 0.14,
      CARRIER_COMPOSURE_PENALTY: 0.24,
      PRESSURE_ONLY_RATIO: 0.55,
    }),
    interception: Object.freeze({
      BASE_SUCCESS: 0.42,
      DEFENDING_WEIGHT: 0.30,
      REACH_WEIGHT: 0.20,
      PROGRESS_PENALTY: 0.25,
      DEFLECT_RATIO: 0.40,
    }),
  }),

  secondBall: Object.freeze({
    RANGE: 0.20,
    MIN_SCORE: 0.02,
    PROXIMITY_WEIGHT: 0.45,
    CLOSING_WEIGHT: 0.15,
    CLOSING_SPEED_NORM: 5,
    ABILITY_DEFENDING_WEIGHT: 0.20,
    ABILITY_PACE_WEIGHT: 0.12,
    CONTEXT_WEIGHT: 0.08,
  }),
});