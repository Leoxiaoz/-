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
  人格修正 0.1/0.05/0.05；随机幅度 0.15；超预期 5% × +2。
  长期伤病放缓成长（×0.85）的**触发与时长改由伤病系统负责**（写 `growth.injuryPenaltySeasons`，见 D-15），
  成长系统不再自行读取 `injury.daysRemaining` 推断。
- **模型**：成长以「距每属性潜力上限的余量 × 年龄速率 × 修正 × 有界随机」驱动（自然收益递减、绝不越上限）；
  过巅峰后按年龄线性衰退。**只写 `runtime.players[].ability.deltas`**，静态库只读（A3/规则第 6 条）。
- **运行时新增字段**：`players[].growth = { lastEvaluatedSeason, injuryPenaltySeasons }`；`GAME_STATE_SCHEMA_VERSION` 2→3（加法式，向后兼容）。
- **确定性**：种子 = `hash(worldId, playerId, season)`；同一赛季**幂等**。
- **接线**：`simulation.js` 赛季滚动时先 `developPlayers`（用该季统计与年龄）再 `resetSeasonStats`。
- 落地：[player-growth.js](file:///workspace/src/core/player-growth.js)、`tests/growth.test.js`、[SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §20。

---

## D-15 伤病生命周期（对应 SIMULATION_SPEC §21、SAVE_SPEC §3）

- **制定者已确认规则**（第 17 步）：
  - **来源**：比赛产生伤病——赛后对双方全队球员做最小判定（每方每场至多 1 人新增）；不重构比赛模拟，不做首发/换人/比赛内事件链。
  - **类型**：6–8 种，**配置驱动**（`INJURY_CONFIG.TYPES`：knock/muscle/hamstring/ankle/knee/concussion/ligament/illness），逻辑不硬编码类型。
  - **严重度**：仅 `minor / moderate / severe`；缺阵天数由「类型 + 严重度 + injuryProneness + 年龄/体能 + 有界随机」计算（severe 上限 240 天）。
  - **恢复**：`daysRemaining` 每日递减，归零自动恢复（`status → fit`）；伤病不允许永久存在，恢复过程确定性、不含随机。
  - **vitals**：伤病发生时 fitness/form/morale 立即下降；伤病期间 fitness 日降、form 冻结衰减、长期伤病 morale 适度下降；康复后 fitness 不立即满值（上限 80）、form 重新由比赛建立、morale 向基线温和恢复。**不修改球员基础属性/静态库。**
  - **成长惩罚解耦（修复第 16 步问题）**：伤病系统在发生伤病时按严重度**明确写入** `growth.injuryPenaltySeasons`（severe 写 1 季）；`player-growth.js` **只读取并消耗**该字段（每季 -1 至 0），**不再自行依据 `injury.daysRemaining >= 90` 推断**。惩罚有明确开始（伤病发生）与结束（消耗至 0）；同一伤病跨赛季**不重复施加**、**不永久触发**。
  - **injuryProneness**（静态人格）影响：受伤概率（+0.6 权重）、恢复天数轻微修正（+0.1）、复发风险；概率**有上限**（单场 ≤ 0.05）不失控。
  - **injuryHistory 有限**：仅定长对象 `{recurrenceCount, lastInjuryDate, lastInjuryType}`，不无限增长。
  - **确定性**：随机一律用项目 deterministic RNG，种子含 `worldId + fixtureId/date + playerId + 'injury'`；相同输入结果一致。
  - **AI 球队最小保证**：受伤球员不被当作可用（`isAvailable`）；实力计算无 NaN/负数（空阵容保护回退中性值）；伤病不导致崩溃。**不做**青训补位/紧急转会/医疗团队/医疗设施/复杂康复。
- **运行时新增字段**：`injury = {status, type, category, severity, daysRemaining, totalDays, since}`；
  `injuryHistory = {recurrenceCount, lastInjuryDate, lastInjuryType}`；`GAME_STATE_SCHEMA_VERSION` 3→4（加法式，向后兼容）。
- **接线**：`simulation.js` 每日推进 `tickInjuries`（递减→自动恢复→vitals）；`#playFixture` 赛后 `resolveMatchInjuries`；`#buildSide`/`computeTeamStrength` 过滤伤病球员。
- 落地：[player-injury.js](file:///workspace/src/core/player-injury.js)、`src/core/player-runtime.js`、`src/core/sim-config.js`（`INJURY_CONFIG`）、
  [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §21、`tests/injury.test.js`（21 项）。

---

## D-16 赛季级球员生态联调（对应 SIMULATION_SPEC §5/§20/§22、SAVE_SPEC §3）

- **背景（第 18 步）**：第 16/17 步后审计发现闭环存在三处断点：①实力读静态属性；②出场统计从未接入；③比赛不影响 vitals。本步**只打通已有系统**，不新增玩法系统。
- **已定规则**：
  - **实力口径改为有效属性**：`computeTeamStrength` / 进球者判分使用「静态基础 + `ability.deltas`，并按 `potential` 与 1–99 夹取」的有效属性。成长/衰退因此影响球队实力 → 比赛结果。
  - **出场集合**：无首发/替补/换人系统，出场球员 = **比赛模拟实际使用的球员**（`selectMatchSquad`：按阵型各线取有效评分最高者，GK×1）。该函数为**单一可替换点**，未来以正式首发/换人系统替换即可，统计层（`recordAppearance`）不必重写。
  - **赛后最小反馈**（`MATCH_LOAD_CONFIG`）：实际出场者记 90 分钟出场、按 `events[].scorerId` 记进球；体能耗 `FITNESS_COST`；form 向基线（50）按 `FORM_RECOVER_RATE` 逼近（有界，不会无限增长或永久停在 0）。不改任何基础属性。
  - **体能恢复改为分数式**（`INJURY_CONFIG.FITNESS.RECOVER_FRACTION_PER_DAY`）：健康球员按「缺口比例」回升，使比赛消耗后不每周回到满值；无比赛日自然回升、休赛期趋近满值。
- **已知范围（非本轮修复）**：无退役/新生代/青训 → 长期（约 50–100 赛季）世界均值与球队实力随老龄化**单调回落**（100 赛季趋近下限），比赛趋于 0-0。属既有成长/衰退规则的确定性后果，保留为后续独立步骤（退役 + 新生代 + 人口生态平衡）。
- **存档**：本轮为**接线**，运行时结构未新增字段 → `GAME_STATE_SCHEMA_VERSION` **保持 4**。
- 落地：`src/core/team-strength.js`、`src/core/simulation.js`、`src/core/sim-config.js`、`src/core/player-injury.js`；`tests/ecosystem.test.js`（17 项）。

---

## 仍属 TBD（未受影响）

- GAME_DESIGN：T1、T2、T3、T4、T5、T7–T13、T15、T16、T17
- DATABASE_SPEC：D1、D2、D3、D5、D8、D9、D11、D12
- SIMULATION_SPEC：S2–S11、S13（S12 口径已定，见 D-12）
- SAVE_SPEC：V1–V9、V11
- ROADMAP：R1（见 D-09 暂定）、R2、R4、R5、R6

详见各 SPEC 的 TBD 汇总表。