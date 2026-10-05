/**
 * Goal-Line / Goal Geometry 配置（Step 39F-M-C-15）。
 * 层级归属：Simulation Core / Match Geometry。纯数据，无副作用、无 RNG、无墙钟。
 *
 * **复用现有 Truth（不复制）**：
 * - Pitch 坐标：`x ∈ [0,1]`，`y ∈ [0,1]`（见 interaction-resolution-config PITCH_MIN/MAX）。
 * - 球门嘴几何：复用 shot-resolution-config `GOAL_CENTER_Y` / `GOAL_HALF_WIDTH`
 *   ⇒ y ∈ [0.39, 0.61]（**不是**新造几何）。
 * - 场地朝向：复用现有约定「home attacks +x」（见 shot-resolution `goalXFor`）
 *   ⇒ home 进攻 x=1（右门），away 进攻 x=0（左门）。
 *
 * 说明：`GOAL = { x:1, y:0.5 }`（decision-config）仅为**射门目标点**，**不是**球门几何，C-15 不使用它做判定。
 *
 * 红线：不建第二套 Ball / Pitch / Goal / Score Truth；不实现 Ball Physics / GK / Shot；
 * 不修改 MatchCore Schema；无 Math.random / 墙钟。
 */

import { SHOT_RESOLUTION_CONFIG } from './shot-resolution-config.js';
import { INTERACTION_BALL_STATE } from './interaction-resolution-config.js';

export const GOAL_LINE_CROSSING_RULE_VERSION = 'goal-line-crossing-v1';

/** Pitch 门线 X（复用 PITCH 约定：左 0 / 右 1）。 */
export const GOAL_LINE_LEFT_X = 0;
export const GOAL_LINE_RIGHT_X = 1;

/** 球门嘴 Y 范围：**复用** shot 几何（中心 ± 半宽），非新造。 */
const CY = SHOT_RESOLUTION_CONFIG.GOAL_CENTER_Y;
const HW = SHOT_RESOLUTION_CONFIG.GOAL_HALF_WIDTH;
export const GOAL_MOUTH_Y_MIN = CY - HW; // 0.39
export const GOAL_MOUTH_Y_MAX = CY + HW; // 0.61

/** 纯几何数值容差（本 Gate 范围内；不修改全局物理规则）。 */
export const GEOMETRY_EPSILON = 1e-9;

/** 门柱边界口径：**inclusive**（yMin/yMax 视为门内），由 epsilon 容差判定。 */
export const GOAL_MOUTH_BOUNDARY_INCLUSIVE = true;

/** Goal-Line Crossing 结果 reason 枚举。 */
export const GOAL_CROSSING_REASON = Object.freeze({
  GOAL_LINE_CROSSED: 'GOAL_LINE_CROSSED',
  NO_GOAL_LINE_CROSSING: 'NO_GOAL_LINE_CROSSING',
  INVALID_INPUT: 'INVALID_INPUT',
  NO_CROSSING: 'NO_CROSSING',
  BALL_STATE_NOT_ELIGIBLE: 'BALL_STATE_NOT_ELIGIBLE',
});

/** Goal Candidate 来源标识（供 C-14 消费）。 */
export const GOAL_CROSSING_SOURCE = 'GOAL_LINE_CROSSING';

/**
 * 允许产生 Goal-Line Crossing 的 Ball State。
 * 仅「代表球运动轨迹」的状态：FREE（自由运动）/ IN_TRANSIT（飞行 / 传递中）。
 * CONTROLLED（球员控球）是否算「带球过线」属 Deferred，不在本 Gate 自行发明语义。
 */
export const ALLOWED_CROSSING_BALL_STATES = Object.freeze([
  INTERACTION_BALL_STATE.FREE,
  INTERACTION_BALL_STATE.IN_TRANSIT,
]);