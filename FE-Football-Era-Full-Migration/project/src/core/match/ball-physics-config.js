/**
 * Ball Physics 配置（Step 39F-M-C-03）。
 * 层级归属：Simulation Core / Match Ball Physics。**纯数据**，无副作用、无 RNG、无 state 读取。
 *
 * 规范来源：39F-M-C-03 Ball Physics / Ball Interaction Foundation Gate（§3–§11/§18）。
 *
 * 时间单位：`simulation seconds`（与既有 PASS / SHOT transit metadata 的 "simulation seconds" 口径一致）。
 * 速度单位：归一化球场单位 / simulation second。
 * ⚠ 现有 `movement` 层使用 `simulation minute`（见 movement-config.js）。两者为既有口径差异，
 *   本 Gate **不修改 movement**，仅在 MatchCore 适配层做 min↔sec 的单位换算（见 ball-physics.js）。
 *
 * 红线：
 * - 本层不参与战术 / Resolution 成功率计算；不写 Score / Stats / Growth / Training / Save。
 * - 数值集中于此，**禁止散落 magic number**。
 * - 全部 transient / derived，不持久化；Schema 仍为 10。
 */

/** Ball Physics 规则版本（用于 RNG scope / 可追溯；非 schema 字段）。 */
export const BALL_PHYSICS_RULE_VERSION = 'match-ball-physics-v1';

/** Ball 状态枚举（与既有 PASS/SHOT `BALL_TRANSIT_STATE` 兼容：CONTROLLED / IN_TRANSIT / FREE，+ GOAL）。 */
export const BALL_STATE = Object.freeze({
  CONTROLLED: 'CONTROLLED',
  IN_TRANSIT: 'IN_TRANSIT',
  FREE: 'FREE',
  GOAL: 'GOAL',
});

/** Boundary 结果（本 Gate 只输出基础结果，不实现出界重开）。 */
export const BALL_BOUNDARY = Object.freeze({
  IN_BOUNDS: 'IN_BOUNDS',
  BOUNDARY_CONTACT: 'BOUNDARY_CONTACT',
  OUT_OF_BOUNDS: 'OUT_OF_BOUNDS',
});

/** Boundary 行为（默认反射；STOP / ALLOW_OUT 为未来扩展预留）。 */
export const BOUNDARY_BEHAVIOR = Object.freeze({
  REFLECT: 'REFLECT',
  STOP: 'STOP',
  ALLOW_OUT: 'ALLOW_OUT',
});

/** Contact 类型（几何基础层；不做成功/犯规判定）。 */
export const CONTACT_TYPE = Object.freeze({
  NONE: 'NONE',
  BALL_TO_PLAYER: 'BALL_TO_PLAYER', // 球主动撞向球员（relative normal approaching）
  PLAYER_TO_BALL: 'PLAYER_TO_BALL', // 球员主动将球推离
  CONTINUING: 'CONTINUING',         // 同一交互窗口内的持续接触（不叠加 impulse）
});

/**
 * 轻量足球物理参数。所有值必须 finite；范围由 `assertValidBallPhysicsConfig` 校验。
 */
export const BALL_PHYSICS_CONFIG = Object.freeze({
  /** 归一化球场边界。 */
  PITCH_MIN: 0,
  PITCH_MAX: 1,

  /** 地面滚动摩擦（速度衰减率，单位/秒²）。 */
  FRICTION: 0.20,
  /** 停止阈值：速度低于此值视为静止（避免无限微小移动 / 抖动）。 */
  STOP_THRESHOLD: 0.006,
  /** 速度上限（clamp；防爆速 / Infinity）。 */
  MAX_SPEED: 1.20,

  /** 球员↔球交互半径（归一化）。 */
  CONTACT_RADIUS: 0.030,
  /** 接触恢复系数（法向相对速度反射比例）。 */
  CONTACT_RESTITUTION: 0.55,
  /** 切向速度保留比例（地面摩擦式）。 */
  CONTACT_TANGENT_RETENTION: 0.85,
  /** 交互窗口滞后系数：距离 > RADIUS × 该值才认为脱离接触（防每 tick 叠加 impulse）。 */
  CONTACT_HYSTERESIS: 1.15,

  /** 边界行为与反射。 */
  BOUNDARY_BEHAVIOR: BOUNDARY_BEHAVIOR.REFLECT,
  BOUNDARY_RESTITUTION: 0.50,
  /** 反射后速度低于此值 → 该轴速度归零（贴边停球，不再抖动）。 */
  BOUNDARY_MIN_BOUNCE: 0.01,

  /** 子步防 tunneling / 边界精度。swept 检测保证即使子步被截断也不会穿透。 */
  MAX_SUBSTEPS: 8,
  /** 单个子步最大位移 = SUBSTEP_TRAVEL_RATIO × CONTACT_RADIUS。 */
  SUBSTEP_TRAVEL_RATIO: 0.5,
});

/** 校验配置合法性（finite、范围）；非法即抛错，不静默降级。 */
export function assertValidBallPhysicsConfig(cfg = BALL_PHYSICS_CONFIG) {
  const finite = ['PITCH_MIN', 'PITCH_MAX', 'FRICTION', 'STOP_THRESHOLD', 'MAX_SPEED',
    'CONTACT_RADIUS', 'CONTACT_RESTITUTION', 'CONTACT_TANGENT_RETENTION', 'CONTACT_HYSTERESIS',
    'BOUNDARY_RESTITUTION', 'BOUNDARY_MIN_BOUNCE', 'MAX_SUBSTEPS', 'SUBSTEP_TRAVEL_RATIO'];
  for (const k of finite) {
    const n = Number(cfg?.[k]);
    if (!Number.isFinite(n)) throw new Error(`BallPhysicsConfig 非法：${k} 必须 finite，实际 ${cfg?.[k]}`);
  }
  if (!(cfg.PITCH_MIN < cfg.PITCH_MAX)) throw new Error('BallPhysicsConfig 非法：PITCH_MIN 必须 < PITCH_MAX');
  if (!(cfg.FRICTION >= 0)) throw new Error('BallPhysicsConfig 非法：FRICTION 必须 >= 0');
  if (!(cfg.STOP_THRESHOLD >= 0)) throw new Error('BallPhysicsConfig 非法：STOP_THRESHOLD 必须 >= 0');
  if (!(cfg.MAX_SPEED > 0)) throw new Error('BallPhysicsConfig 非法：MAX_SPEED 必须 > 0');
  if (!(cfg.CONTACT_RADIUS > 0)) throw new Error('BallPhysicsConfig 非法：CONTACT_RADIUS 必须 > 0');
  if (!(cfg.CONTACT_RESTITUTION >= 0 && cfg.CONTACT_RESTITUTION <= 1)) throw new Error('BallPhysicsConfig 非法：CONTACT_RESTITUTION 必须 ∈ [0,1]');
  if (!(cfg.CONTACT_TANGENT_RETENTION >= 0 && cfg.CONTACT_TANGENT_RETENTION <= 1)) throw new Error('BallPhysicsConfig 非法：CONTACT_TANGENT_RETENTION 必须 ∈ [0,1]');
  if (!(cfg.CONTACT_HYSTERESIS >= 1)) throw new Error('BallPhysicsConfig 非法：CONTACT_HYSTERESIS 必须 >= 1');
  if (!(cfg.BOUNDARY_RESTITUTION >= 0 && cfg.BOUNDARY_RESTITUTION <= 1)) throw new Error('BallPhysicsConfig 非法：BOUNDARY_RESTITUTION 必须 ∈ [0,1]');
  if (!(cfg.MAX_SUBSTEPS >= 1)) throw new Error('BallPhysicsConfig 非法：MAX_SUBSTEPS 必须 >= 1');
  if (!(cfg.SUBSTEP_TRAVEL_RATIO > 0)) throw new Error('BallPhysicsConfig 非法：SUBSTEP_TRAVEL_RATIO 必须 > 0');
  if (!Object.values(BOUNDARY_BEHAVIOR).includes(cfg.BOUNDARY_BEHAVIOR)) throw new Error(`BallPhysicsConfig 非法：BOUNDARY_BEHAVIOR=${cfg.BOUNDARY_BEHAVIOR}`);
  return true;
}