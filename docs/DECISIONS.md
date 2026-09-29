# DECISIONS — 架构决策记录（ADR）

| 项 | 值 |
|---|---|
| 状态 | **生效中** |
| 更新日期 | 2026-09-28（第 14 步） |
| 关联 | GAME_DESIGN / DATABASE_SPEC / SIMULATION_SPEC / SAVE_SPEC / ROADMAP 及各 Skill |

**约定**：本文件中的"已定"决策具最高优先级。若任一 SPEC 中的 `[TBD]` 标记与本文件冲突，**以本文件为准**；SPEC 会逐步同步。

---

## D-01 比赛结果与赛程的归属（对应 A1）

- **决策**：**归存档（运行时）**。
- 含义：数据库只存**赛事规则与参赛队**；赛程由规则生成；比赛结果与赛事进度属运行时，进存档。
- 落地：[DATABASE_SPEC](file:///workspace/docs/DATABASE_SPEC.md) D4、[SAVE_SPEC](file:///workspace/docs/SAVE_SPEC.md) §2。

## D-02 比赛模拟抽象层级（对应 A2）

- **决策**：**时段制**（按若干时段结算，兼顾真实度与移动端性能）。
- 含义：原 SIMULATION §1 的 11 阶段按"时段"重组；**事件级**能力降为可选 / 未来优化路径（玩家比赛可后续升级）。
- 落地：[SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) S1/T6、[GAME_DESIGN](file:///workspace/docs/GAME_DESIGN.md) T6。

## D-03 静态库 / 运行时档 边界（对应 A3）

- **决策**：**库 = 不随时间变化的数据；档 = 随时间变化的数据**。
- 库可提供"初始值"（如初始财政），但**必须标注为初始值、非权威**。
- 落地：[DATABASE_SPEC](file:///workspace/docs/DATABASE_SPEC.md) D7。

## D-04 ID 方案（对应 A4）

- **决策**：**稳定唯一 ID + 降级兼容**。
  - 形态：**类型前缀字符串**（`cty_ / lg_ / clb_ / ply_ / mgr_ / std_ / ctr_ / trf_ / cmp_ / mat_`）。
  - 唯一性：**库内唯一**即可；跨库相同**不强制**；另设**可选 `externalRef`** 供 Mod / 合并映射。
  - 新生代：引擎分配**独立命名空间**（如 `ply_g_<seq>`），不与库 ID 冲突。
  - **降级兼容**：读到无法识别的实体引用时**不崩溃**，标记为"缺失引用"并可诊断定位。
- 落地：[DATABASE_SPEC](file:///workspace/docs/DATABASE_SPEC.md) D6。

## D-05 版本与换库策略（对应 A5）

- **决策**：**向后兼容**。
  - 存档：低于当前版本可读并迁移；高于当前版本**拒绝并诊断**。
  - 数据库版本：不兼容时拒绝加载并给可定位错误；迁移机制后续按 SPEC 补。
  - 换库：**隔离** —— 旧档继续用原库，新库仅用于新建世界。
- 落地：[SAVE_SPEC](file:///workspace/docs/SAVE_SPEC.md) V10/V7、[DATABASE_SPEC](file:///workspace/docs/DATABASE_SPEC.md) D10。

## D-06 聚合数据 / 所有权（对应 A6）

- **决策**：**聚合根 + 单向持有**。
  - `Country → League → Club → Contract`（Contract 绑定 Player 与 Club）。
  - `Transfer` / `Match` 为**关系 / 事件实体**，单向外键引用，**不反向持有**。
  - 存档仅按 ID 存增量，不持有数据库对象。
- 落地：[DATABASE_SPEC](file:///workspace/docs/DATABASE_SPEC.md) §2、[SAVE_SPEC](file:///workspace/docs/SAVE_SPEC.md) §3。

## D-07 存储介质（对应 A7）

- **决策**：**IndexedDB** 为存档主介质（多槽、长存档、移动端容量需求）。
- 落地：[SAVE_SPEC](file:///workspace/docs/SAVE_SPEC.md)、代码 `IndexedDbSaveManager`。

## D-08 压力测试目标（对应 A8）

- **决策**：**50 赛季为基础压力测试**，并**保留更高赛季（100+）测试能力**；Core 必须可 **headless** 批量跑赛季。
- 落地：[ROADMAP](file:///workspace/docs/ROADMAP.md) §3/§6、[SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) S14/T14、`testing-qa` Skill。

---

## D-09 第一阶段（MVP）范围（对应 R1）

- **决策（暂定）**：MVP = **仅比赛闭环** —— 单联赛赛程生成 + 时段制单场模拟 + 积分榜 + 单赛季推进 + 存读一致。
- **不含**：转会、合同、财政、成长、AI 决策（属第二阶段）。
- 说明：本项为**暂定默认值**，制定者可在开工前按 R1 覆盖为更高档；覆盖仅影响范围，不改动本阶段架构。

## D-10 MVP 联赛规模（对应 ROADMAP §1）

- **决策（暂定）**：MVP 测试世界 = **单联赛 8 队双循环**（14 轮）。
- 引擎按**任意偶数队**（奇数队自动轮空）实现，规模写入数据库而非硬编码；8 队仅为测试库取值。

## D-11 MVP 模拟粒度（对应 SIMULATION S3/S5/S6）

- **决策（暂定）**：**粗粒度最小集**。
  - 位置：`GK / DF / MF / FW`。
  - 球员属性（MVP 集，1–99）：`pace, technique, passing, defending, finishing, goalkeeping`。
  - 战术：仅 `formation`（4-4-2 等，决定各线人数）+ `mentality`（defensive/balanced/attacking，真实影响进攻倾向）。
- 说明：属性集为**暂定最小集**，后续按 D2/T4 扩展时须带存档迁移（SAVE_SPEC §5）。

---

## D-12 比分分布目标口径（对应 SIMULATION S12）

- **决策（暂定）**：以**现实足球区间**为校准口径，不追求"高进球"或"戏剧化"。
  - 目标（大样本、单联赛同质强度）：场均总进球 **2.4–3.2**（实体目标 ≈2.8）；平局占比 **15%–35%**；**主胜率 > 客胜率**。
- **现状**：MVP 实测场均总进球 ≈2.79，已在目标区间内，**无需再调参**。
- **护栏**：`tests/match.test.js` 增加确定性大样本校准测试；任何调参不得使分布越出上述区间。
- 说明：本项为**暂定默认值**，制定者可在进入第二阶段前按口味覆盖目标区间；覆盖只需改 `sim-config.js` 常数并同步护栏区间，不改动算法结构。
- 落地：[SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §18、`src/core/sim-config.js`。

---

## D-13 球员运行时状态结构（对应 DATABASE_SPEC §4 / SIMULATION §2·§7–§9 / SAVE §3）

- **背景**：第 15 步实现「球员运行时状态」，需把 `runtime.players` 由占位改为**已定义结构**。
- **已定原则**（A3/D3 的延伸）：
  - 静态库负责**不随时间变**：基础属性、位置、出生日期、潜力等；运行时**只读**，禁止回写。
  - 运行时负责**随时间变**：能力增减、体能、状态、士气、伤病、出场/比赛统计、本赛季统计、职业生涯统计。
  - 以**稳定 `playerId`** 关联（A4）。
- **暂定结构（待制定者确认，字段级按 DATABASE_SPEC §4 需逐项裁定）**：
  - `ability.deltas`：按属性名累计的增减（有效属性 = 静态基础 + 增减，夹取 1–99）。**成长算法属 TBD。**
  - `fitness / form / morale`：0–100，初始 100 / 50 / 50。**更新与耦合模型属 TBD（S9）。**
  - `injury`：`{status, type, daysRemaining, since}`，枚举 `fit/injured`。**生成与恢复算法属 TBD（§12）。**
  - `stats`：`{seasonNumber, season, career}`，统计线为 `{appearances, minutes, goals, assists}`。
    赛季滚动时**重置 season、累计 career**。
- **版本**：`GAME_STATE_SCHEMA_VERSION` 1→2，属**加法式**变更；旧档经 `initializePlayerRuntime` 补齐，**保留已有值**，向后兼容。
- **不变式**：本结构**不含**任何模拟模型/隐藏系数；所有写入接口为数据结构级操作（创建/读取/记录/设值/夹取）。
- 落地：[player-runtime.js](file:///workspace/src/core/player-runtime.js)、`tests/player-runtime.test.js`、
  [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §19、[SAVE_SPEC](file:///workspace/docs/SAVE_SPEC.md) §3、[DATABASE_SPEC](file:///workspace/docs/DATABASE_SPEC.md) §4。

---

## D-14 球员成长 / 衰退系统（对应 DATABASE_SPEC §2/§4、SIMULATION_SPEC §2/§12/§20、SAVE_SPEC §3）

- **制定者已确认规则**（第 16 步）：
  - **A1** 静态库新增 `birthDate` / `potential` / `personality`；**A2** 潜力为**每属性上限**（非单一总评）；**A3** 正式库不得用默认年龄替代，测试库已补齐。
  - **B1** 本期不实现训练本体，仅**预留训练修正接口**（默认 1.0）；**B2** 出场影响成长（年轻更明显、有上限）；**B3** form/morale 温和影响；**B4** 人格字段 `professionalism/determination/ambition/consistency/injuryProneness`（静态）；**B5** 属性分组年龄曲线（身体早熟早衰、技术持久、门将晚熟）；**B6** 约 28/29 岁起衰退、身体优先；**B7** 严重长期伤病主要**降低后续成长速度**，不直接大幅降潜力。
  - **C1** 按**赛季**结算；**C2** 确定性种子 + **有界**随机；**C3** 允许少量超预期成长但**不突破潜力上限**。
  - **D1** 长期不得全世界属性均值持续膨胀；**D2** 至少覆盖 10/50/100 赛季。
- **落地的暂定默认参数**（`src/core/sim-config.js` `PLAYER_GROWTH_CONFIG`，可后续统一调参）：
  分组巅峰 `pace 27 / technical 30 / goalkeeping 32`；成长速率按年龄 0.25/0.15/0.06（吸收潜力余量）；
  衰退速率 `0.7/0.4/0.3`；出场加成上限 0.2（1800 分钟、21→27 岁窗口）；士气/状态 ±0.1；
  人格修正 0.1/0.05/0.05；随机幅度 0.15；超预期 5% × +2；长期伤病阈值 90 天、成长 ×0.85 一季。
- **模型**：成长以「距每属性潜力上限的余量 × 年龄速率 × 修正 × 有界随机」驱动（自然收益递减、绝不越上限）；
  过巅峰后按年龄线性衰退。**只写 `runtime.players[].ability.deltas`**，静态库只读（A3/规则第 6 条）。
- **运行时新增字段**：`players[].growth = { lastEvaluatedSeason, injuryPenaltySeasons }`；`GAME_STATE_SCHEMA_VERSION` 2→3（加法式，向后兼容）。
- **确定性**：种子 = `hash(worldId, playerId, season)`；同一赛季**幂等**。
- **接线**：`simulation.js` 赛季滚动时先 `developPlayers`（用该季统计与年龄）再 `resetSeasonStats`。
- 落地：[player-growth.js](file:///workspace/src/core/player-growth.js)、`tests/growth.test.js`、[SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §20。

---

## 仍属 TBD（未受影响）

- GAME_DESIGN：T1、T2、T3、T4、T5、T7–T13、T15、T16、T17
- DATABASE_SPEC：D1、D2、D3、D5、D8、D9、D11、D12
- SIMULATION_SPEC：S2–S11、S13（S12 口径已定，见 D-12）
- SAVE_SPEC：V1–V9、V11
- ROADMAP：R1（见 D-09 暂定）、R2、R4、R5、R6

详见各 SPEC 的 TBD 汇总表。