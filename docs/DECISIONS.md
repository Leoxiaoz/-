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
- **已知范围（非本轮修复）**：无退役/新生代/青训 → 长期（约 50–100 赛季）世界均值与球队实力随老龄化**单调回落**（100 赛季趋近下限），比赛趋于 0-0。属既有成长/衰退规则的确定性后果，保留为后续独立步骤（退役 + 新生代 + 人口生态平衡）。**该项已由 D-17（第 19 步）解决。**
- **存档**：本轮为**接线**，运行时结构未新增字段 → `GAME_STATE_SCHEMA_VERSION` **保持 4**。
- 落地：`src/core/team-strength.js`、`src/core/simulation.js`、`src/core/sim-config.js`、`src/core/player-injury.js`；`tests/ecosystem.test.js`（16 项）。

---

## D-17 球员生命周期：退役 + 新生代 + 人口平衡（对应 SIMULATION_SPEC §23、SAVE_SPEC §3、DATABASE_SPEC §3）

- **背景（第 19 步）**：第 16–18 步闭环打通后，世界仍无"退出/进入"通道 → 长期（50–100 赛季）世界均值随老龄化坍缩至下限。
- **已定规则**：
  - **退役**：年龄软区间**线性概率** + **硬上限强制**；曲线按「成长 peak/decline + 实测年龄分布」推导：
    FW 32/37、DF 33/38、MF 33/38、GK 35/40；RNG 种子 `worldId|retire|season|playerId`（可复现）；
    **MVP 不使用能力/伤病史**作为退役条件；不允许永久不退、不允许超上限存在。
  - **新生代**：**每赛季固定批次**（非"退一补一"）；属**下一赛季**；年龄 17–19；来源为**同位置静态模板 + 三路独立有界抖动**
    （base ±3、potential headroom ±2、personality ±3）；保证 `base ≤ potential ≤ 99`；personality 取自库经验分布；
    fitness 100 / form 50 / morale 50 / 健康 / injuryHistory 归零；**首个完整赛季后可正常参与 growth/injury/match**。
  - **首次成长时机**：新生代 `growth.lastEvaluatedSeason = 生成时的 prevSeason`（= 所属新赛季号 − 1，**不使用 0**），
    故生成当次不成长，首次成长发生在**完整下一赛季结束**的那次 rollover。
  - **人口（Step 26B 更新，落地 D-24 的 D16）**：**废弃**"每赛季精确恢复到初始人数"的旧政策；
    改为**边界语义**——World 用 `WORLD_MIN_POPULATION`（防坍缩最低线，非 exact target），Club 用 `ROSTER_CONFIG`
    （`MIN_PLAYERS`/`MAX_PLAYERS` + 位置最低保障，`PREFERRED_PLAYERS` 仅为软偏好）；`runtime.populationTarget` **退出人口业务逻辑**
    （仅作 legacy 快照保留）；只生成不删除；超过上限**仅诊断不裁员**；**不引入自由球员池**；不无控增长。
  - **架构**：保持 `static.players` 只读；新生代落 `runtime.generated`（含 `teamId`）；退役落 `runtime.retired`（保留 career/终值快照）；
    引入**统一世界球员访问器**（`getWorldPlayers` / `getTeamPlayers` / `getPlayerProfile` / `isRetired`），
    既有 4 模块 9 处直读 `state.static.players` 全部迁移到访问器。
  - **ID**：新生代用独立命名空间 `ply_g_<全局递增序号>`；退役 playerId **永久失效、永不复用**；禁用显示名作主键。
  - **开关**：`RETIREMENT_CONFIG.ENABLED`（默认 true）；false 时完全跳过退役与新生代，**结构不变**，行为回到第 18 步。
- **运行时新增字段**：`generated`、`retired`、`nextGeneratedSeq`、`populationTarget`；`GAME_STATE_SCHEMA_VERSION` 4→5（加法式）。
- **接线**：`simulation.js` 赛季滚动顺序 = 结算成长 → 退役+归档 → 计算缺口并生成 → 重置赛季统计 → 进入下一赛季。
- **实测（MVP 世界 8 队，10/50/100/200 赛季；Step 26B 边界语义后）**：人口稳定于 **96**（= 8 × `ROSTER_CONFIG.MIN_PLAYERS`，**非 exact-112**）、
  俱乐部 12–13 人、GK 恒 8、无重复 ID、**不坍缩也不膨胀**（每队均满足位置最低保障）。
- 落地：[player-lifecycle.js](file:///workspace/src/core/player-lifecycle.js)、`player-runtime.js`、`game-state.js`、`sim-config.js`、
  [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §23、`tests/lifecycle.test.js`（19 项）。

---

## D-18 玩家阵容 / 战术选择（对应 SIMULATION_SPEC §24、SAVE_SPEC §3、GAME_DESIGN §4/§6）

- **背景（第 20 步）**：第 16–19 步世界已能自主运转（成长/伤病/退役/新生代），但玩家始终是旁观者。
  本步建立「玩家管理球队 → 比赛 → 结果反馈」的**最小可玩闭环**：玩家选择阵容/阵型/战术，**真正进入比赛模拟**。
- **已定规则（制定者确认）**：
  - **玩家阵容进入 runtime，而非 UI 状态**：`runtime.managedClubId`（**默认 null**，玩家主动选择后才进入玩家模式）+
    `runtime.clubs[].lineup = { starters: string[], bench: string[] }`（**playerId** 列表，**不自动创建**）。
  - **两套选阵路径（统一入口 `resolveMatchSquad`）**：玩家管理球队用**已保存阵容**（`repairSquadForMatch` 按阵型严格修复）；
    其余球队（AI / 未选择）继续使用 `selectMatchSquad`（自动选阵，**行为与第 16–19 步一致**）。
  - **首发严格匹配阵型**：GK=1，DF/MF/FW 等于 `FORMATIONS` 各线人数（合计恒 11）；无法修复（某线无健康球员）→
    记录 `lineup_fallback` 事件并**回退自动阵容**（不静默使用错误数据）。
  - **替补席**：允许保存与展示，**本步骤不参与比赛、不参与换人**（UI 明确标注；换人引擎属 out-of-scope）。
  - **伤病**：不得进入实际首发（比赛时以同位置健康球员顶替）；**允许进入替补席**；玩家选择被保留，康复后可再次首发。
  - **清洗规则**：不存在 / 已退役 / 非本队 / 重复 playerId 一律剔除；首发与替补去重。
- **比赛接入（不重写比分算法）**：`computeTeamStrength(state, teamId, tactics, squad)` 接受**本场实际出场集合**，
  阵型（各线取样人数）与阵容（具体球员）变化改变实力 → 改变期望进球与结果；战术倾向经 `MENTALITY` 倍率影响期望。
  `match.js` 核心比分算法**不改动**。
- **自愈**：赛季滚动（退役/离队后）调用 `repairManagedLineups`；比赛时 `repairSquadForMatch` 按阵型回填。
- **运行时新增字段**：`managedClubId`、`clubs[].lineup`；`GAME_STATE_SCHEMA_VERSION` 5→6（加法式，旧档经 `initializeClubRuntime` 兜底）。
- **UI/Controller**：Controller 提供 `getManagedClubId/setManagedClub/setFormation/setMentality/setLineup/assignLineupPlayer/autoFillManagedLineup`
  与扩展快照；UI 只在「我的球队」卡片内呈现，规则全部在 Core/Controller。
- **明确未做**：转会、合同、财政、工资、身价、球探、教练、青训、预备队、AI 转会市场、多联赛、升降级、杯赛、
  红黄牌、换人引擎、大规模比赛表现系统、名人堂、新闻系统。
- 落地：[player-lineup.js](file:///workspace/src/core/player-lineup.js)、`team-strength.js`、`simulation.js`、`game-state.js`、
  `game-controller.js`、`app-view.js`、`sim-config.js`、[SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §24、`tests/lineup.test.js`（22 项）。

---

## D-19 运行期成员关系层（G0）（对应 SIMULATION_SPEC §25、SAVE_SPEC §3、DATABASE_SPEC §3/§4）

- **背景（G0）**：审计发现 player→club 存在**两个真相源**（基础球员读 `static.players[].teamId`，新生代读 `runtime.generated[].teamId`），
  club→league 只读 `static.teams[].leagueId`；导致转会、升降级、AI 建队、财政等无法实现。本步**只**建立统一的运行期成员关系层。
- **已定规则（制定者确认）**：
  - **唯一真相源**：`runtime.membership = { schema: 1, players: {playerId→clubId}, clubs: {clubId→leagueId} }`。
  - **静态字段**保留为**数据库种子 + 加载期引用完整性校验**；运行期归属判断**不得**再直接依赖。
  - **`runtime.generated[].teamId` 保留为 denormalized 兼容镜像**；除初始化/迁移/兼容场景外，不用于判断当前归属。
  - **实体字段名**继续对外暴露 `teamId`（内部 registry 用 `clubId`）。
  - **自由球员**本阶段不实现：active 球员必须属于一个 club，不引入 null club。
  - **顺序契约**：`getClubPlayers()` 返回顺序必须与「`getWorldPlayers()` 过滤」一致（静态库原序 → 新生代插入序），
    **不做 playerId 排序**，以保住 Step 16–20 的确定性与行为等价。
  - **`validateMembership`**：致命问题（缺归属 / 无效 league / 退役残留）**明确报错**、不静默继续；非致命记 diagnostics。
  - **`computePopulationTarget`** 改经 membership；初始化结果与 Step 19/20 完全一致。
  - **Controller 快照** club→league 统一经 membership；对外 API 行为兼容。
- **生命周期接入**：新生代生成在同一事件内写 generated + membership（镜像 + 权威一致）；退役从 active membership 移除。
- **存档**：`GAME_STATE_SCHEMA_VERSION` 6→7（**加法式**）；v6 旧档经 `initializeMembership` 从静态/新生代种子建立；迁移前遵循备份规则。
- **架构**：`membership.js` 为**叶子模块**（不 import player-runtime / game-state），避免循环依赖。
- **明确未做**：转会、合同、自由球员、财政、工资、身价、AI 转会、升降级、多联赛、杯赛；
  不改 `match.js` 比分算法、不改 Step 20 lineup 存储、不改 Step 16–19 核心规则、不改 AI 自动选阵。
- 落地：[membership.js](file:///workspace/src/core/membership.js)、`player-runtime.js`、`game-state.js`、`player-lifecycle.js`、
  `save-manager.js`、`game-controller.js`、[SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §25、`tests/membership.test.js`（19 项）。

---

## D-20 比赛球员参与结构（G1a）（对应 SIMULATION_SPEC §26、SAVE_SPEC §3）

- **背景（G1a）**：比赛对"球员参与"的表达是**隐式**的（谁在 `squadIds` 里 = 出场 90 分钟），
  `simulation.js` 分别扫描阵容与事件推导统计，`assists/cards/sub` 无处表达；A（表现）与 D（换人）缺共同结构。
- **已定规则（制定者确认）**：
  - **统一结构**：`MatchResult.involvements = { [playerId]: { side, role, position, minutes, goals, assists, yellow, red } }`，
    由「本场实际出场阵容 + 事件流」**确定性**派生（`buildInvolvements`）。未出场球员**不写入**。
  - **事件统一**：`actorId`（替代 `scorerId`）+ `assistId`；当前仅 `goal` 有来源，`assistId` 恒 `null`；
    **不新增随机源**、**不改比分算法**、**不制造随机黄/红牌与助攻**。
  - **当前固定模型**：`role='starter'`、`minutes=90`、**不产生 sub**（为 D 预留 `role/minutes`，本期不实现换人）。
  - **赛后消费**：`simulation.js#applyPostMatch` 改**只消费 involvements**（不再扫描 squadIds / 事件推导统计）。
  - **统计迁移**：`recordAppearance` 消费 `minutes/goals/assists/yellow/red`；统计线新增 `yellow/red`。
- **兼容红线**：Step 18 fitness/form 口径不变；Step 20 `resolveMatchSquad`/lineup/bench 不变；
  Step 17 `resolveMatchInjuries` **仍对全队**判定（不迁移）；比分/种子/6 时段逻辑不变。
- **存档**：`GAME_STATE_SCHEMA_VERSION` 7→8（**加法式**）——唯一原因：统计线新增持久化 `yellow/red`（旧档补齐为 0）；
  `MatchResult.involvements` 为运行期产物，**不入档**。
- **明确未做**：换人/替补上场、临场战术、球员评分、射门/控球/传球、AI、转会、合同、财政、杯赛、多联赛、G1b。
- 落地：[match.js](file:///workspace/src/core/match.js)、`simulation.js`、`player-runtime.js`、`game-state.js`、
  [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §26、`tests/involvement.test.js`（12 项）。

---

## D-21 赛季日历与赛季边界（G1b①）（对应 SIMULATION_SPEC §27、SAVE_SPEC §3）

- **背景（G1b①）**：赛季推进此前是**隐式**约定——"某 competition `finished` → 推进 `state.season` → 执行全局副作用"，
  赛季"边界"没有显式概念，无法自然扩展为多竞赛/多赛季。
- **已定规则（制定者确认）**：
  - **派生型 SeasonCalendar**：新增叶子模块 `src/core/season.js`，`getSeasonCalendar(state)` 从**当前唯一联赛** competition
    确定性投影出 `{ season, startDate, endDate, status }`；**只读、不改状态、不入档**。
  - **投影规则**（单联赛）：`season = comp.season`；`startDate = comp.seasonStart`；`endDate = max(fixtures[].date)`（无有效赛程为 `null`）；
    `status`：有赛程时 = `comp.status`（`scheduled`/`in_progress`/`finished`）；无赛程时 = `finished`（若 comp 已 finished）否则 `empty`。
  - **边界判据**：`isSeasonBoundaryReached(state)` = `endDate !== null && currentDate >= endDate && status === 'finished'`。
    **不用 `>`**，避免边界晚一天：最后一场比赛日当天即完成 rollover。
  - **空联赛**：无有效 fixture ⇒ `endDate=null`、`status='empty'` ⇒ **永不 rollover**，`state.season` 不变。
  - **rollover 编排**：`simulation.js#rollFinishedSeasons` 改为**由边界驱动**——边界到达时归档当前赛季 → 创建下一赛季 →
    更新 `state.season` → **执行一次**全局副作用（顺序固定不变：`developPlayers → runPlayerLifecycle → repairManagedLineups → resetSeasonStats`）。
- **兼容红线（行为等价）**：`state.season` **保留**字段名与持久化；单联赛下 `state.season ≡ competition.season ≡ calendar.season`；
  `advanceDay` 外部顺序不变（+1 天 → `tickInjuries` → `playDueFixtures` → rollover）；`SEASON_GAP_DAYS=30`、赛程轮转、
  fixture 日期、`deriveMatchSeed` 的 season 输入、growth/lifecycle RNG **全部不变**。
- **存档**：`GAME_STATE_SCHEMA_VERSION` **保持 8**——SeasonCalendar 为派生视图，**不新增持久化字段**，无需迁移。
- **明确未做（属 G1b②）**：多联赛、多 competition 并行、杯赛、淘汰赛、升降级、Competition Rules 数据化、
  多竞赛统一赛季边界、competition type dispatch、新 schedule 类型。当前 SeasonCalendar **只处理唯一联赛**。
- 落地：[season.js](file:///workspace/src/core/season.js)、`simulation.js`、[SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §27、`tests/season.test.js`。

---

## D-22 球员比赛表现系统（Step 21-A）（对应 SIMULATION_SPEC §28、SAVE_SPEC §3）

- **背景（Step 21-A）**：G1a 的统一 `involvements` 已能表达"谁出场"，但除进球外无球员级表现
  （无射门/射正/助攻/牌/评分），`assists/yellow/red` 恒为 0，无法支撑赛后表现反馈与统计。
- **已定规则（制定者确认）**：
  - **RNG 隔离**：比分由 `simulateSegments` 的**单一比分 RNG** 决定（消费顺序**禁止改动**）；
    球员表现由**独立派生 RNG**在**比分与 goal events 确定之后**生成——逐球员流
    `hashSeed(`${matchSeed}|perf|${side}|${playerId}`)`、逐进球流 `hashSeed(`${matchSeed}|assist|${side}|${minute}|${scorerId}`)`。
    因此增减球员不改变他人流、不污染比分 RNG、不新增全局随机源；`rng.js`、`deriveMatchSeed`、比分算法**均不改**。
  - **events 契约不扩展**：`events` 仍只记录 `goal`（`assistId` 保持 `null`）；射门/助攻/牌**不进事件流**，
    仅经 `involvements` 传递。
  - **MVP 字段**：`shots` / `shotsOnTarget` / `assists` / `yellow` / `red` / `rating`。
    `keyPasses`、xG、possession、pass%、比赛报告、Man of the Match、UI 展示**暂缓**。
  - **守恒（内建）**：`shots >= shotsOnTarget >= goals`；`Σassists <= Σgoals`；助攻者同队、非进球者本人、必为出场球员；
    牌为非负整数、单场有界（每人 ≤1 黄、≤1 红）。
  - **rating**：单场确定性、可解释、固定上下界 `[4.0, 10.0]`，**不依赖 form/morale**；
    长期以整数 `ratingSum = Σ round(rating×10)` 保存，均值 = `ratingSum / appearances / 10`。
  - **不做反向写入**：表现**不写回** form / morale / fitness / growth / retirement（避免经 `vitalsFactor` 反馈破坏长期平衡）。
- **数据流（不变）**：`simulateMatch → MatchResult.involvements → #applyPostMatch → recordAppearance`（G1a 架构，仅透传新字段）。
- **存档**：`GAME_STATE_SCHEMA_VERSION` **8→9**（**加法式**）——统计线新增 `shots`/`shotsOnTarget`/`ratingSum`；
  旧档经 `normalizeStatLine` 补齐为 0，`MatchResult.involvements` 与表现字段**不单独入档**（经统计线持久化）。
- **明确未做**：转会、合同、工资、财务、AI 教练、多联赛、杯赛、升降级、替补、换人、keyPasses、xG、
  possession、pass%、新能力属性/能力体系、表现影响 growth/retirement、比赛报告 UI。
- 落地：[match.js](file:///workspace/src/core/match.js) `applyMatchPerformance`、`sim-config.js` `MATCH_PERFORMANCE_CONFIG`、
  `player-runtime.js`、`simulation.js`、`game-state.js`、[SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §28、`tests/performance.test.js`。

---

## D-23 球员表现数据消费层（Step 21-B）（对应 SIMULATION_SPEC §29）

- **背景（Step 21-B）**：Step 21-A 已生成并持久化球员 `season/career` 表现（含 `shots/shotsOnTarget/ratingSum`），
  但**零消费**——controller 快照与 UI 均未暴露任何球员统计。
- **已定规则（制定者确认，仅消费层，无新 schema）**：
  - **只读派生视图**：`player-runtime.getPlayerStatsView(state, playerId)` 返回 `{ season, career }` 汇总
    （`appearances/minutes/goals/assists/yellow/red/shots/shotsOnTarget/averageRating`），
    经安全规范化（缺字段→0），**返回新对象、与 runtime 无引用共享**。
  - **averageRating 派生**：`ratingSum / appearances / 10`（两位小数）；`appearances <= 0` ⇒ **`null`**（UI 显示 `—`，绝不出现 NaN/Infinity）。
    `ratingSum` **不暴露给 UI**，UI **不得**自行计算。
  - **分层**：`runtime → core helper → controller snapshot → view`。UI **不得**直读 `state`/runtime。
  - **展示范围**：仅**玩家当前管理球队**的阵容（`#managedClubView`），紧凑两行布局（姓名/位置/伤病/阵容操作 + 赛季统计行），
    统计行 `flex-wrap`，移动端无横向溢出。
  - **旧存档兼容**：schema **保持 9**，**不新增迁移**；依赖既有 `normalizeStatLine` 与视图层安全默认值。
- **明确未做**：match history、逐场 `involvements` 持久化、逐场 events、比赛报告、进球者历史、
  全联盟排行榜、球员详情页、UI 直读 state、schema 升级、21-A 模型/RNG/评分公式/比分模型的任何改动。
- 落地：[player-runtime.js](file:///workspace/src/core/player-runtime.js) `getPlayerStatsView`/`deriveAverageRating`、
  [game-controller.js](file:///workspace/src/controller/game-controller.js) `#managedClubView`、
  [app-view.js](file:///workspace/src/ui/app-view.js) `statsLine`、`styles/main.css`、
  [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §29、`tests/consumption.test.js`。

---

## D-24 合同 / 财政 / 转会 语义地基（Step 23 冻结）（对应 SIMULATION_SPEC §30）

> 本条使用 **Step 23 决策编号 D1–D20**（与项目 `D-xx` 编号属不同命名空间）。均为**设计冻结**：
> 不落地代码、不改 schema（**仍为 9**），供后续 Contract / Finance / Transfer 实施阶段遵循。

- **D1 Membership Truth** `[已定]`：`runtime.membership` 继续作为 player→club 的**唯一业务真相**；
  `static.teamId` / `generated.teamId` 仅作**镜像 / 初始化来源**，不作为运行时转会后的权威状态。
- **D2 Contract Model** `[已定]`：`runtime.contracts[playerId]` 为合同业务真相；v1 每人**至多一个 active contract**；暂不建完整合同历史系统。
- **D3 Free Agent** `[已定]`：v1 **允许 active free agent**；自由球员不属于任何 club，membership 不记 clubId，以 `contract.status='free_agent'` 表示。
  **不得**出现 membership / contracts / freeAgents **三套并列业务真相**；如需阻止 `initializeMembership` 重播种，可加**内部辅助机制**，但不得构成第三套权威状态。
  （**Step 27A 落地形式见 D-26.2**：以 `membership.players[id]=null` 表示，不新增第三套结构。）
- **D4 Contract Duration** `[已定]`：期限用**整数赛季**；v1 **不做自动续约**。
- **D5 Wage Unit** `[已定]`：工资以**每赛季工资**记录，且属**合同属性**。
- **D6 Finance** `[已定]`：`club.finance = { cash, wageBudget, transferBudget }`；**只有 cash 是实际货币余额**，
  wageBudget / transferBudget 为**约束**，**不作为额外现金余额**。
- **D7 Squad Size** `[已定]`：引入俱乐部阵容人数 **lower/upper bound**；转会 / 释放 / 生成球员均须遵守；
  **不允许**人口补充系统因一次转会/释放就立即恢复到固定 112。
- **D8 Transfer Fee** `[已定]`：v1 使用**确定性转会费模板**（依能力/年龄/位置等已有数据）；暂不建独立 player value / market value 系统；**不新增随机数源**。（**Step 28A 具体化为 D-27 T2/T3**。）
- **D9 Transfer Window** `[已定]`：v1 **转会窗口永久开放**；暂不实现夏窗/冬窗限制。（**Step 28A 保持：D-27 T26**。）
- **D10 Generated Player Contract** `[TBD → Deferred]`：**暂不锁定**（原因见下）；**Step 27A 明确为 Deferred、不阻塞 Step 27**（见 D-26.9）。
- **D11 Retirement** `[已定]`：退役必须**移除 active contract** + **移出 active membership**；retired archive 保存**最终合同快照**等必要历史；
  退役者不得再出现在转会市场或 active contract 中。
- **D12 Save Migration** `[已定]`：Contract/Finance 真正落地时再做 **schema 9→10** 迁移；旧档现有 112 名 active 球员须获得**确定性初始合同**；
  迁移**不得**破坏旧档既有比赛/球员属性/成长/伤病/退役等状态。
- **D13 Money Model** `[已定]`：v1 不建复杂收入系统；俱乐部间转会费可转移 **cash**；**不周期性从 cash 扣工资**——
  即 **v1 工资不形成 cash 的持续消耗**，以避免"只有支出、没有收入"导致长期经济必然崩溃。
- **D14 Domain Transaction Layer** `[已定]`：Transfer / Contract / Finance 必须经**统一领域操作层**完成；UI 与未来 AI 调用**相同** domain operations；
  禁止直接改 `membership` / `contracts` / `finance` 底层状态；流程 `plan → validate → commit → assert invariants`（先验证、后一次性提交）。
- **D15 AI Dependency** `[已定]`：AI 未来必须使用与玩家**相同**的 domain operations；Step 23 **不实现 AI 转会**；AI 转会依赖 Contract + Finance + Transfer domain layer 完成后再做。
- **D16 Population Policy** `[已定]`：**废弃**"每赛季精确恢复到初始 112 人"的长期人口政策；
  **世界人口保护**与**俱乐部阵容保护**必须**分离**：world population 用 **minimum / health boundary**（非 exact target），club roster 用 **lower / upper bounds**；
  转会 / 释放 / 自由球员**不得被下一赛季自动补充立即抵消**；新球员生成只用于**真正的人口健康/阵容缺口**，不用于机械恢复到 112。
  - **已落地（Step 26B）**：`WORLD_MIN_POPULATION`（World 最低边界）+ `ROSTER_CONFIG`（Club 阵容边界 + 位置最低保障）；
    `runtime.populationTarget` 退出人口业务逻辑（legacy 快照）；`replenishPopulation` 改为边界驱动；生成由缺口位置驱动、确定性、不创建无归属 active player。
- **D17 Economic Closure** `[已定]`：**v1 不扣除工资现金**；wage 仅作合同属性与 wageBudget 约束；
  若未来要让工资真正影响 cash，**必须同时**设计收入/奖金/运营收入等**完整经济闭环**；闭环建立前**不得**擅自增加工资现金流。
- **D18 Injury + Transfer** `[已定]`：**允许受伤球员转会**；injury 状态**不**作为转会禁止条件；转会后**保持**其 injury runtime 状态，**不重置伤病**。
- **D19 Load-time Invariants** `[已定]`：存档加载后必须检查并（确定性）修复/拒绝明显非法状态，包括但不限于：
  active player 的 membership 与 active `contract.clubId` 一致；retired 不得拥有 active contract；不得存在重复 active contract；
  不得出现无效 clubId / playerId；finance 数值合法；roster / membership 不得有重复或悬空引用。修复策略须**确定性**、**不得引入随机数**。
- **D20 RNG** `[已定]`：Contract / Finance / Transfer v1 **不新增随机数源**；相同输入必须得到相同结果；
  转会费、工资模板、合同迁移等**全部使用确定性规则**；**不得**影响现有比赛 / 成长 / 伤病 RNG 的结果序列。

**D10 为何仍保持 `[TBD]`**：生成球员的合同语义与"青年队 / 自由球员市场 / AI 转会"强耦合
（直接入队并附初始合同？先入自由身？继承模板合同？）。一旦定错会**反噬** D7（阵容上下限）与 D16（人口政策），
故留待与这些系统一并决定，本步骤不替其拍板。

**验证**：本条目为**纯文档冻结**——未修改代码 / `.fdb` / 测试 / UI；**schema 仍为 9**；未实现 Contract/Finance/Transfer/Free Agent/AI。

---

## D-25 合同 / 财政地基落地（Step 25）（对应 SIMULATION_SPEC §31、SAVE_SPEC §3）

- **背景**：Step 23 冻结了 Contract / Finance / Transfer 语义（D-24）；Step 24 审计确认 Contract/Finance 可低风险独立落地，Free Agent 生效与 Population 政策拆分延后。
- **已实现（仅 Foundation，无 Transfer / 无 Free Agent 生效）**：
  - 新增 `src/core/contract.js`：`runtime.contracts[playerId] = { playerId, clubId, startSeason, endSeason, wage, status }`；
    `status ∈ { active, free_agent }`；accessor `getPlayerContract / isFreeAgent / isContracted`（纯读）；
    op `createContract / terminateContract`；`normalizeContracts`（确定性补齐、**不创建 free agent**）；`assertContractInvariants`。
  - 新增 `src/core/finance.js`：`runtime.clubs[clubId].finance = { cash, wageBudget, transferBudget }`；
    **仅 cash 为余额**，其余为约束；`getSpendableCash = min(cash, transferBudget)`；`normalizeFinance`；`assertFinanceInvariants`。
  - `game-state.js`：`GAME_STATE_SCHEMA_VERSION` **9→10**（加法式）；`createGameState` 归一化 + 校验。
  - `game-controller.js#load`：读档后 `normalizeContracts / normalizeFinance` + 不变量断言（不静默）。
  - `player-lifecycle.js#archiveRetired`：退役时**保存最终合同快照**并 `terminateContract`（无合同安全）。
- **确定性（D20）**：合同期限/工资、财政初值全为**确定性模板**（`CONTRACT_CONFIG` / `FINANCE_CONFIG`），**不新增随机源**，
  不影响 match / growth / injury RNG；整季比赛黄金指纹（总进球 143 / 球员进球 143 / 总出场 1141）不变。
- **边界保持**：`membership` 仍为归属唯一真相；contract 做合同真相；二者以 invariant 关联（active ⇔ membership.clubId === contract.clubId）。
- **明确未做**：Transfer、Free Agent **运行时生命周期**、release、transfer window、AI 转会、roster bounds、
  Population 政策（D16）、工资现金扣除（D13/D17）、生成球员合同最终语义（**D10 仍 TBD**）、UI。
- 落地：[contract.js](file:///workspace/src/core/contract.js)、[finance.js](file:///workspace/src/core/finance.js)、
  `game-state.js`、`game-controller.js`、`player-lifecycle.js`、`sim-config.js`、
  [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §31、`tests/foundation.test.js`（16 项）。

---

## D-26 Free Agent + Membership Integration（Step 27A 设计冻结 · Step 27B 已实现）（对应 SIMULATION_SPEC §32、SAVE_SPEC §3）

- **性质**：Step 27A 为**纯设计冻结**；**Step 27B 已实现**。schema 仍为 **10**、`SAVE_FORMAT_VERSION` 仍为 **1**；**未新增 RNG**。
  **仍未实现**：Transfer / 转会费 / Contract Expiry / 续约 / AI 转会 / 签约费 / 工资现金流 / **D10（Deferred）**。
- **背景**：Step 25 落地 Contract / Finance Foundation（D-25），Step 26B 落地 Population Health + Club Roster Bounds（D16 落地）。
  Step 27 只读审计确认唯一硬阻塞是 `initializeMembership` 的**重播种**行为。本决策即冻结 Free Agent 语义，供 Step 27 Implementation 遵循。

### D-26.1 Free Agent 数据模型 `[已定]`
- Free Agent 的**唯一业务真相**是 `runtime.contracts[playerId]`：
  `{ playerId, clubId: null, startSeason, endSeason, wage: 0, status: "free_agent" }`。
- **不新增** `runtime.freeAgents` / `runtime.playersWithoutClub` / `runtime.marketPlayers`（禁止三套并列业务真相，延续 D3）。

### D-26.2 Membership 语义 `[已定]`
- Free Agent 使用 **`runtime.membership.players[playerId] = null`**（key **存在**、value 显式为 `null`）。
- **禁止**用 `delete membership.players[playerId]` 表示 Free Agent——否则 `initializeMembership()` 会依 `static.teamId` / `generated.teamId` **重播种回原俱乐部**。
- 这是 D3 所述「阻止重播种的内部辅助机制」的**正式落地形式**，且**未引入第三套真相**（仍是同一张 membership 表）。
- `membership` 仍为「球员是否属于某俱乐部、属于哪个俱乐部」的**唯一运行期归属真相**；**`membership.js` 不得依赖 `contract.js`**（保持叶子模块；契约一致性校验属更高层 invariant）。

### D-26.3 Active Player 语义 `[已定]`
- Active player = **未退役**球员。仅两种合法状态，不得出现第三种：
  - **A. Club-attached**：`contract.status="active"` + `contract.clubId=clubId` + `membership.players[id]=clubId`；
  - **B. Free Agent**：`contract.status="free_agent"` + `contract.clubId=null` + `membership.players[id]=null`。
- Retired：无 membership、无 contract，进入 retired archive。

### D-26.4 Free Agent 合同字段语义（原 TBD-1，已冻结）`[已定]`
- `status="free_agent"`、`clubId=null`、`wage=0`。
- `startSeason = endSeason = 进入 Free Agent 的**当前赛季**`（作为「进入自由身状态的赛季锚点」）。
- **不沿用旧合同**的结束赛季、**不保留旧工资**；Free Agent 不被视为仍在履行旧合同。
- 未来重新签约（free_agent → active）时写入**全新的** `clubId / startSeason / endSeason / wage`（签约属 Step 27 Implementation，本步不实现）。

### D-26.5 MAX_PLAYERS 语义（原 TBD-2，已冻结）`[已定]`
- `ROSTER_CONFIG.MAX_PLAYERS = 24` 具有**两重、须区分**的语义：
  - **Population 层**：`当前人数 > 24` → **仅诊断，不自动裁员**（延续 Step 26B）；
  - **Signing Domain Operation**：`当前人数 >= 24` → **拒绝签约**（写入侧硬上限，禁止主动制造第 25 名俱乐部球员）。
- 两者不得混淆：Population 不因超过 24 而裁员；Signing 不允许把球队写超上限。
- **Transfer 是否允许突破 24 留给 Step 28 决定**。

### D-26.6 Release 语义（原 TBD-3 的一部分，已冻结）`[已定]`
- 未来领域操作 `releasePlayerToFreeAgent()` 必须**原子**完成：
  1. `contract.status`：active → free_agent；2. `contract.clubId`：clubId → null；
  3. `contract.startSeason = 当前赛季`；4. `contract.endSeason = 当前赛季`；5. `contract.wage = 0`；
  6. `membership.players[id]`：clubId → **null**；7. 源俱乐部 **persistent lineup** 清除该 playerId（starters 与 bench）。
- Release **不直接改变**：world active population、player runtime existence、generated registry、retired archive。
- **Release 后球员仍是 active player**（Free Agent）。
- **前置条件（Step 27 MVP）**：仅当球员 `非 retired` + `当前属于 club` + `存在 active contract` 时可 release。
  「Club player + 无 active contract」（如 Step 27 阶段的 generated player，见 D-26.9）**必须拒绝**，错误原因明确（如 `PLAYER_HAS_NO_ACTIVE_CONTRACT`）。

### D-26.7 Release 与 Population / 补位关系 `[已定]`
- **Release 不立即触发 Generation**，也不允许形成 `release → generate → 自动补回`。
- 若 release 后俱乐部仍满足 `MIN_PLAYERS` / `MIN_GK` / `MIN_BY_POSITION`，则**不生成新人**。
- 仅当**正常 Population Health evaluation** 发现**真实 roster deficit** 时才允许补位。
- 补位**最小语义方向**：`Club roster deficit → Population Health evaluation → 优先检查现有 Free Agent 是否可补位 → 若无可用 Free Agent 才允许 Generation`。
  （具体的候选选择 / 位置匹配 / 确定性排序 / 合同条款由 Step 27 Implementation 实现，本步不实现。）

### D-26.8 Free Agent 与 World Population `[已定]`
- Free Agent **仍属于 world active population**（`getWorldPlayers()` 含非退役球员，与 club 归属无关）。
- 例：112 active 释放 10 → **world active 仍为 112**、Free Agents = 10、club roster 合计 = 102。
  **不得**因 Free Agent 无 club 而减少 world population（否则会误导 Population Controller 生成新人）。
- Free Agent **参与**：growth / decline、injury tick / recovery、retirement、career stats 生命周期。
- Free Agent **不参与**：club roster、team strength、lineup、match squad。

### D-26.9 Generated Player / D10（原 TBD-4，Deferred）`[已延期，不阻塞 Step 27]`
- **本阶段不冻结 D10**，保持当前行为：`generatePlayer()` **直接加入 club membership**，**暂可能没有 contract**（已知 contract asymmetry）。
- Step 27 **不得**为消除该不对称而修改 `generatePlayer()`，**不得**自动为生成球员创建合同。
- 因此 Step 27 阶段「`Club + 无 active contract`」是**受控的过渡状态**；此类球员**不能执行 `releasePlayerToFreeAgent()`**（无 active contract）。
- D10 留待后续**独立决策**，**明确为 Deferred、非 Step 27 blocker**。

### D-26.10 Schema（原 TBD-5，已冻结）`[已定]`
- **不升级 schema**：`GAME_STATE_SCHEMA_VERSION` 保持 **10**；`SAVE_FORMAT_VERSION` 保持 **1**。
- 原因：现有结构已可表达 `membership.players[id]=null` 与 `contract.status="free_agent"`/`clubId=null`，且**不新增 runtime container**，故无需新容器、无需版本迁移。

### D-26.11 Domain Operation 边界 `[已定]`
- **Step 27 MVP**：`releasePlayerToFreeAgent()`、`signFreeAgent()`（及必要的 Free Agent 查询 accessor）。
- 所有操作遵循 `plan → validate → commit → assert invariants`；UI / AI **不得**直接写 `membership` / `contract` / `finance`。
- **Step 28**：`transferPlayer()` 属 Transfer 阶段，本步不设计完整 Transfer transaction。

### D-26.12 Finance 语义 `[已定]`
- Free Agent signing v1：**不产生 transfer fee**、**不新增复杂 signing fee**、**不从 cash 扣除工资**（延续 D13/D17）。
- `cash` 仍为唯一真实余额；`wageBudget` / `transferBudget` 继续存在；签约工资由 signing contract terms 决定。Finance 复杂化留给后续。

### D-26.13 核心不变量 `[已定]`
- **FA-INV-01** retired → 无 membership、无 contract。
- **FA-INV-02** `contract.status==="active"` → membership 存在且 `=== contract.clubId` 且 club 有效。
- **FA-INV-03** `contract.status==="free_agent"` → `membership.players[id]===null` 且 `contract.clubId===null`。
- **FA-INV-04** Free Agent 不在任何 club roster。　**FA-INV-05** Free Agent 不在 lineup。
- **FA-INV-06** Free Agent 不计入 team strength。　**FA-INV-07** Free Agent 仍在 world active population。
- **FA-INV-08** active player 恰好属于 {active contract + club membership} 或 {free_agent contract + null membership} 之一。
- **FA-INV-09** membership value 为 string clubId 或显式 null；active player **不得为 undefined**。
- **FA-INV-10** 每球员至多一条 contract 记录。
- **FA-INV-11** release 不直接生成替代球员。　**FA-INV-12** signing 不得主动制造 roster > `MAX_PLAYERS`。

### D-26.14 Save / Load 语义 `[已定]`
- 旧档（无 Free Agent）**继续正常加载**；新档 Free Agent（`contract.status=free_agent` + `clubId=null` + `membership.players[id]=null`）必须 **save → load 状态完全一致**。
- `initializeMembership()` **不得**把 `null` membership 的 Free Agent 依 `static.teamId` 拉回原俱乐部（依赖 D-26.2 的「key 存在」表示法）。
- 本步**不升级** `GAME_STATE_SCHEMA_VERSION` / `SAVE_FORMAT_VERSION`。

### D-26.15 状态 `[已实现（Step 27B）]`
- **已实现落地**（[free-agent.js](file:///workspace/src/core/free-agent.js)）：`getFreeAgents` / `getFreeAgentCount` / `selectFreeAgentForPosition` /
  `releasePlayerToFreeAgent` / `signFreeAgent` / `assertFreeAgentInvariants`；
  membership 新增 `setFreeAgentMembership` / `isFreeAgentMembership`（[membership.js](file:///workspace/src/core/membership.js)），
  `validateMembership` 允许显式 `null`；contract 新增 `updateContract` / 导出 `validateContractShape`
  并补 FA-INV-13/14（[contract.js](file:///workspace/src/core/contract.js)）。
- **Population 集成**：`replenishPopulation` 俱乐部缺口**优先复用现有 Free Agent**（`selectFreeAgentForPosition` → `signFreeAgent`），
  无可用 Free Agent 才 `generatePlayer`（[player-lifecycle.js](file:///workspace/src/core/player-lifecycle.js)）。
- **读档不变量**：`controller.load` 追加 `assertFreeAgentInvariants`（不静默）。
- **仍未实现**：Transfer、Contract Expiry、续约、AI 转会、签约费、工资现金流、**D10（Deferred）**、Free Agent 市场 UI。
- 落地测试：`tests/free-agent.test.js`（A–Z + 不变量 + Controller）。

---

## D-27 Transfer System v1（Step 28A 设计冻结）（对应 SIMULATION_SPEC §33、SAVE_SPEC §3）

> 本条使用 **Step 28 决策编号 T1–T30**（与项目 `D-xx` 编号属不同命名空间）。本步骤**纯设计冻结**：
> **不修改代码 / 测试 / `.fdb` / schema（仍 10）/ `SAVE_FORMAT_VERSION`（仍 1）**；**未实现** Transfer / UI / AI / Expiry / Renewal / Loan / Window / Negotiation；
> **未改 D10**；**未新增 RNG**。Transfer **运行时实现属 Step 28B**。

### T1 Transfer 定义 `[已定]`
- Transfer = **Club A → Club B 的一次原子球员交易**；**不是**「改 `player.clubId`」，也**不是** Release + sign、Free Agent signing、临时 ownership 或 Loan。
- 一次性完成 **Membership / Contract / Finance / Seller Lineup** 四域的一致变更；**Team Strength / Match Squad 不直接修改**（继续经 Membership 派生）。

### T2 Transfer Fee 模型 `[已定]`
- 采用**确定性能力定价模型**；v1 **不维护独立 `marketValue` 字段**；Fee **由当前球员状态计算，不存储**。
- 模型：`Fee = Base × AbilityFactor × AgeFactor × PositionFactor`：
  - AbilityFactor：基于 **effective attributes 的完整属性向量**（不使用单一 OVR）；
  - AgeFactor：基于出生/年龄，**遵循现有 Growth/Decline 年龄曲线**（年轻溢价、巅峰正常、高龄贬值）；
  - PositionFactor：仅允许**轻微**位置差异，不造成极端位置通胀。
- **不进入 Fee 的因素**：Potential、Fitness、Form、Morale、Injury、Match Rating、Season/Career Stats（避免与短期状态过度耦合；Potential 仍只作成长上限）。
- **纯函数**：同 state + player + seller + buyer → 同 Fee；**禁止** `Math.random()` / 新 RNG / 随机市场波动。`stableHash` 可作确定性档位微调，但**不得形成不可解释的随机价格**。
- **费用输入禁止**：当前 cash / buyer cash / seller cash / transferBudget / squad size / 随机市场事件（尤其禁止「买方越有钱越贵」）。

### T3 Fee Bounds `[已定]`
- `MIN_TRANSFER_FEE = 0`；`MAX_TRANSFER_FEE` **由 `sim-config.js` 定义**。
- Fee 必须 finite、非 NaN、可重复；越界则 **clamp** 到合法区间。MAX 用于防止长期成长导致经济数值无限膨胀（不引入复杂经济平衡）。

### T4 Buyer Cash 约束 `[已定]`
- 必须 `fee <= buyer.finance.cash`，否则拒绝；**不允许 cash < 0**（cash 是唯一真实 money）。错误码 **`INSUFFICIENT_CASH`**。

### T5 Transfer Budget 约束 `[已定]`
- 必须同时 `fee <= getSpendableCash(state, buyerClubId)`，即 `min(cash, transferBudget)` → **fee ≤ cash 且 fee ≤ transferBudget** 两者都满足。

### T6 Transfer Budget 消耗 `[已定]`
- Buyer：`cash -= fee` **且** `transferBudget -= fee`；Seller：`cash += fee`，**transferBudget 不增加**。
- 转会费是**实际现金流**；transferBudget 是**买方可用支出额度**，非卖方收入来源。v1 不实现：自动增预算 / Board 调整 / 预算与现金重分配 / FFP / 负 transferBudget / 收入系统。

### T7 Seller Cash `[已定]` / T8 Buyer Cash `[已定]`
- `seller.cash += fee`；`buyer.cash -= fee`。**必须经 finance 层的纯状态变更接口**完成（建议 `applyCashDelta(state, clubId, delta)`，具体命名由架构决定）；**禁止 `transfer.js` 直接深入改 finance 结构**。validation 全部完成后再 commit，commit 阶段不得再有可失败的业务判断。

### T9 新合同 `[已定]`
- Club→Club 完成时：**旧合同终止 + 新 active 合同创建**。新合同：`playerId`、`clubId=buyer`、`status=active`、`startSeason=当前赛季`、`endSeason/wage` 取自现有 `defaultContractTemplate`。
- v1 **不允许调用方传入复杂 contract terms**；不实现 Negotiation / Signing bonus / Release clause / Agent fee / Performance bonus / Extension / Salary negotiation。Transfer 自身生成基础合同。

### T10 Contract History `[已定]`
- v1 **不新增 Contract History 容器**；继续 `runtime.contracts[playerId] = 单条 current contract`（旧 terminate + 新 create）。未来 Player Career / Transfer History / Contract History 另设独立模型，本步禁止提前增加。

### T11 Seller MIN Roster `[已定]`
- **允许** Transfer 后 seller roster **暂时低于** `ROSTER_CONFIG.MIN_PLAYERS`。Transfer **不立即** generate / sign FA / 自动补人；此为合法中间状态；下一次 **population boundary** 优先 Free Agent，不足再 generation。

### T12 Position Protection `[已定]`
- **GK 硬保护**：若 seller 只有 1 个 GK，则该 GK **不允许 Transfer**（不得使 seller GK = 0）；错误码建议 **`SELLER_LAST_GK`**。
- **DF/MF/FW 允许暂时低于位置最低人数**（由 Population Health 边界补位）。v1 不实现自动换人/自动补 GK/自动 swap/位置交换交易。

### T13 Buyer MAX `[已定]`
- 若 `buyer roster >= ROSTER_CONFIG.MAX_PLAYERS` → **拒绝**；**不得** auto-release / auto-retire / swap / kick / 自动清理。错误码 **`ROSTER_FULL`**。

### T14 Buyer Position `[已定]`
- Buyer **无 Transfer Position Requirement**：任何合法球员均可签入；不要求 buyer 缺该位置 / 满足 position minimum / 有空位。Transfer 是玩家明确操作；位置最低保障由 Population Health 负责，**不作为交易限制**。

### T15 Injured Player `[已定]`
- 受伤球员**允许** Transfer（injury ≠ ownership restriction）。Transfer **不清除/不重置** injury，**不改** fitness / form / morale；只改 Membership / Contract / Finance / Lineup。（与 D-24 D18 一致。）

### T16 Generated Player Transfer `[已定]`
- **允许** generated player 进行 Club→Club Transfer，`runtime.generated[playerId]` 的存在**不阻止** Transfer。
- 若 generated player 当前「Club + 无 active contract」，Transfer **可直接建立**新的 active contract（Transfer 本身就是建立新 Club Contract 的 domain operation）。
- **这不是修改 D10**：`generatePlayer()` 是否自动建合同**不变**；`D10` 仍 **Deferred**。Transfer **不得修改 generated registry**。

### T17 Free Agent Transfer `[已定]`
- Free Agent **不允许**进入 `transferPlayer`（须走 `signFreeAgent`）。二者是两个不同 domain operation。

### T18 Transfer Event `[已定]`
- 完成后记录 **`TRANSFER_COMPLETED`** runtime event，至少含 `playerId / sellerClubId / buyerClubId / transferFee / season / date`；复用现有 `recordEvent`；**runtime-only**，不建新的持久历史容器。

### T19 Transfer History `[已定]`
- v1 **不新增** `runtime.transferHistory` / `save.transferHistory`；**不改 `SAVE_FORMAT_VERSION`**。当前只保留 `TRANSFER_COMPLETED` runtime event。

### T20 Timing `[已定]`
- Transfer domain operation **在 day advancement 之外执行**；**不允许**在比赛 resolve 过程中修改 ownership；Transfer 完成后**下一场比赛即可使用**新 Membership。不实现 Transfer Window / Mid-match Transfer / Match-day lock / Negotiation period。

### T21 Atomic Transfer `[已定]`
- 采用 `validate → plan → commit → assert`。Validate 只读；Plan 计算所有 before/after；Commit **一次性写入**（seller membership、buyer membership、旧合同终止、新合同创建、buyer cash、seller cash、buyer transferBudget、seller lineup 清理、event）；**commit 阶段不得再执行可能失败的业务验证**。
- 最终必须通过：`assertMembershipValid` / `assertContractInvariants` / `assertFinanceInvariants` / `assertFreeAgentInvariants` / `assertTransferInvariants`。**禁止**「先改一半再 rollback」。

### T22 Schema `[已定]`
- **保持 `GAME_STATE_SCHEMA_VERSION = 10`、`SAVE_FORMAT_VERSION = 1`**；Transfer 不新增持久化容器（只改已有 `membership` / `contracts` / `clubs.finance` / `lineup`）。

### T23 RNG `[已定]`
- **不新增 RNG**；不得 `Math.random()`；不得改变 growth / injury / retirement / generation / match seed；Fee 必须 deterministic。

### T24 Population Interaction `[已定]`
- Transfer **不改变 world active population**；不 generate / 不 retire / 不 create FA；只 `seller roster -1`、`buyer roster +1`。seller deficit 等待 population boundary。

### T25 AI Transfer `[已定]` / T26 Transfer Window `[已定]` / T27 Contract Expiry `[已定]` / T28 Wage Cash Flow `[已定]` / T29 Loan `[已定]` / T30 Transfer UI `[已定]`
- 均**不实现**。Transfer 永久开放（D-24 D9）；工资实时扣现金不实现（D-24 D13/D17）；Step 28B **不实现 Transfer UI**，仅 Domain API + Controller forwarding + Tests。

### T28.1 Transfer v1 架构冻结（Step 28B 遵循）`[已定]`
- 新模块 `src/core/transfer.js`；API：`transferPlayer(state, playerId, buyerClubId)`；内部 `validateTransfer` / `buildTransferPlan` / `commitTransferPlan` / `assertTransferInvariants`。
- 依赖（单向，无环）：`transfer.js → contract.js / membership.js / finance.js / player-lineup.js / player-runtime.js / sim-config.js / game-state.js`。
- **禁止** `contract.js / membership.js / finance.js / player-lineup.js / game-state.js → transfer.js`。`free-agent.js` 与 `transfer.js` 为 **sibling domain modules**；共同能力下沉到低层 primitive（如 lineup 清理提取为共享 `removePlayerFromAllLineups`）。

### T28.2 Transfer 完成后必须满足的不变量 `[已定]`
1 球员只有一个 membership；2 Club Player membership ≠ null；3 `contract.clubId === membership.clubId`；4 无 seller ownership 残留；5 buyer ownership 存在；6 不同时属于两个 club；7 不成为 Free Agent；8 不入 retired archive；9 `cash ≥ 0`；10 `transferBudget ≥ 0`；11 `buyer roster ≤ 24`；12 seller 不失去最后 GK；13 lineup 不保留 seller 中的 playerId；14 runtime player identity 不变；15 world population 不变；16 generated registry 不变；17 injury/fitness/form/morale 不被重置；18 不产生 RNG；19 Save/Load 后一致。

---

## D-28 AI Club Decision Framework v1（Step 30 设计冻结 · Step 31 已实现）（对应 SIMULATION_SPEC §33 之后、ROADMAP §2.19）

> 本条使用 **Step 30 决策编号 D-AI-01 ~ D-AI-25**（与项目 `D-xx` 编号属不同命名空间）。
> Step 30 为**纯设计冻结**；Step 31 **已实现**。**未修改** Schema（仍 **10**）、`SAVE_FORMAT_VERSION`（仍 **1**）、Transfer v1、Free Agent v1、Population Policy、Player Growth / Injury、Match Engine、Team Strength 语义、UI、Controller、HTML、CSS。
> **未新增 RNG**；**未持久化 AI 状态**；**未引入 OVR**；**未引入复杂 Manager Personality**。

### D-AI-01 ~ D-AI-06 架构与范围 `[已定]`
- 分层：`AI Decision Layer → AI Action Layer → Existing Domain APIs → Game State`。
- Decision Layer **纯函数**（只读 state，输出 ephemeral Intent，绝不写 state）；Action Layer 只把 Intent 映射到现有 Domain API；**禁止** AI → Controller → Domain；**禁止** AI → Game State 直接写入。
- AI 与玩家共享同一 Domain 执行层；`Transfer v1 / Free Agent v1` 为执行基础，**不新增第二套规则**。
- v1 决策范围（5 类）：Squad Need（纯分析）/ Sign Free Agent / Buy Player / Sell（买方驱动转会的卖方侧）/ Release / Squad Lineup。
- 实现文件：`src/core/ai/{ai-config,ai-club-policy,ai-need,ai-candidate,ai-suitability,ai-decide,ai-action}.js`。

### D-AI-06 ~ D-AI-10 Need / Candidate / Suitability / Potential / Age `[已定]`
- Squad Need 区分 **Hard（GK<1 / DF<4 / MF<4 / FW<2 / roster<12 / 可用球员不足以排阵）** 与 **Soft（能力缺口 / 青年储备 / 年龄结构）**；Hard 优先。
- Candidate Filter：9 步短路顺序；**只筛不排**；输出 **playerId 升序**。
- Suitability：使用完整 effective attribute vector + position profile；**内部 score 仅当前决策排序**，不持久化、不写入 player、不替代 effective attributes、不改变 transfer fee / team strength / match engine；**无 OVR**。
- Potential = `potential[attr] - effective[attr]`；Age 仅作 modifier（分档 U21/21–24/25–28/29–32/33+）；不新增结构、不改 Growth。

### D-AI-11 ~ D-AI-14 Finance / FA / Transfer / Sell-Release `[已定]`
- 财政：必须同时满足 `fee ≤ cash` **且** `fee ≤ availableTransferBudget`；`availableTransferBudget = max(0, transferBudget - max(RESERVE_ABS, RESERVE_RATIO × transferBudget))`（**保留安全储备**）。唯一变更入口为 `transferPlayer / signFreeAgent / releasePlayerToFreeAgent`。
- Free Agent **优先**：存在满足需求且零成本的 FA → 优先 FA，无合适 FA 才付费转会。
- Transfer 目标排序：需求相关 → suitability → 年龄/潜力上下文 → **playerId 升序**（确定性 tie-break，禁用 `Math.random()`）。
- Sell 无独立挂牌/listing/intent/market；仅作为买方驱动转会的卖方侧。Release 约束：**不释放最后 GK**、释放后 **roster ≥ 12**、**DF/MF/FW 最低线保持**、仅冗余（低 suitability / 高龄）。
- 每俱乐部每赛季：**买入 ≤ 2**（含 FA 签约）、**卖出 + Release ≤ 2**。

### D-AI-15 ~ D-AI-19 Decision / Determinism / Timing / Ordering / Explainability `[已定]`
- Decision Object：`{decisionId, clubId, season, date, type, playerId, targetClubId, position, reasonCode, priority, estimatedCost, confidence, context}`；**ephemeral**，不持久化；`decisionId` 确定性（非 UUID）。
- **不使用 RNG**（v1 deterministic-first）；保留未来独立命名空间 `worldId|ai|...`。
- Trigger：**仅 Season Boundary**，冻结顺序 `developPlayers → runPlayerLifecycle → AI → repairManagedLineups → resetSeasonStats`；**仅非 managed 俱乐部**执行。
- Action Ordering：每俱乐部 `Need → Release → FA → Buy → Lineup`；**每步后重读最新 state**；俱乐部按 `clubId` 升序。
- Explainability：`recordEvent(state,'ai_decision',{clubId,season,date,type,playerId,targetClubId,position,reasonCode,estimatedCost})`；reasonCode 白名单 8 项；无自然语言推理。

### D-AI-20 ~ D-AI-25 Personality / Persistence / Stability / Anti-Convergence / OVR `[已定]`
- 最小 Club Policy（≤3 档：Balanced / YouthFocus / Conservative），由 `hashSeed(clubId|'ai-policy') % 3` **派生**，**不持久化、不给 clubs 增加字段**；**禁止**复杂人格系统。
- **v1 完全派生，不持久化 AI 状态**；唯一持久痕迹为 `runtime.events` 中的 `ai_decision`。
- Schema **保持 10**；`SAVE_FORMAT_VERSION` **保持 1**；**无 migration**；**无新容器**。
- 长期稳定：10/50/100/200 赛季不变量 + 黄金回归（`143/143/1141`）必须保持。
- 反趋同：顺序执行 + 每步重读 + 差异化需求 + 动作上限 + 预算储备 + 最小 Policy + 确定性 tie-break。
- **禁止单一 OVR**；内部 score 仅为上下文 Suitability Score。

### D-28 实现验证（Step 31）`[已实现]`
- `SimulationCore` 新增 `enableAI` 构造选项（**缺省启用**）；接入 `#rollFinishedSeasons`（Population Health 之后、lineup repair 之前），**仅非 managed 俱乐部**。
- 新增 `tests/ai.test.js`（A–O）并接入 `tests/run.js`；累计 **303/303 通过**。
- 4 个既有测试（`season` 指纹基线 / `lifecycle` A / `membership` v6 与长跑成员纯净）显式 `{enableAI:false}` 以隔离非 AI 子系统——其原有断言与基线**未做任何数值调整**。
- 黄金回归 `totalGoals=143 / playerGoals=143 / playerApp=1141` **不变**。
- 长跑（AI 启用）：population 稳定于边界区间 [96,112]，无 NaN / 负值 / 超员 / 最后 GK 破坏 / membership 致命问题。

**仍 Deferred（不属 v1）**：AI Manager personality / reputation / Board / Club Vision、Scout、Agent、Negotiation、Loan、Contract Renewal / Expiry、Wage negotiation、Transfer Window、Multi-league / Cup / International AI、AI tactical deep simulation、AI coaching / training planning、AI youth academy planning、Market Value、**D10**。

---

## D-29 World Economy / Transfer Market v2（Step 33A Audit · Step 33B Decision Freeze）（对应 SIMULATION_SPEC §34、ROADMAP §2.20）

> 本条使用 **Step 33 决策编号 D-33.1 ~ D-33.15**（与项目 `D-xx` 编号属不同命名空间）。
> Step 33A 为**只读生态审计**；Step 33B 为**纯文档 Decision Freeze**。**未修改**代码 / 数据 / 测试 / Schema / Save Format；**未实现任何 v2 功能**（实现属 **Step 34**）。
> 依据：Step 32A 审计确认的**长期吸收态**（population 112→96、roster→12、FA→0、transfer≈0、transferBudget 单向衰减）。
> 记录方式：**Original Rule + v2 Extension**，不删除、不覆盖旧 Decision。

### D-33.1 长期生态目标 `[已定]`
- **不接受** 50~200 季后永久 `population=96 / roster=12 / FA=0 / transfer≈0` 的吸收态。
- 允许**某季完全没有交易**；**禁止**为制造活跃度强制每年交易；**禁止**通过降低所有阈值制造垃圾交易流。
- 目标：当世界确实存在**真实需求 + 真实供给 + 真实资金能力**时，Transfer Cycle 能**长期重新启动**。

### D-33.2 Population / Transfer / Finance 三循环 `[已定]`
- Population Cycle：retirement / generation / world player stock；Transfer Cycle：Club↔Club transfer、Club→FA release、FA→Club signing；Finance Cycle：cash / transferBudget / transfer capacity。
- 职责分离：**Population 不直接调用 Transfer**；**Transfer 不生成 Player**；**Finance 不直接决定 Transfer target**。
- 三者只经**明确数据流 + 现有 Domain API** 连接。

### D-33.3 Competitive Need `[已定]`
- Need 分类冻结为 **HARD / SOFT / COMPETITIVE / NONE**；**COMPETITIVE 是独立 Need Class，不并入 SOFT**。
  - HARD = 生存/结构问题；SOFT = 阵容改善问题；COMPETITIVE = 长期竞争力建设问题；NONE = 无合理需求。
- Competitive Need **不代表必须交易**；完整链路保持 `Need → Candidate Filter → Suitability → Finance → Target Ranking → Domain Action`；**允许 No Action**。
- 新增 reasonCode：**`COMPETITIVE_UPGRADE`**（并入 D-28 reasonCode 白名单）。
- 必须**确定性计算**；**禁止 RNG**；**禁止 OVR**。

### D-33.4 AI Active Selling `[已定]`
- 允许 AI 主动产生 **SELL intent**；**不实现** Listing UI / Transfer Window / Negotiation / Agent / Scout / Transfer Market UI。
- SELL **最终必须调用 `transferPlayer()`**；**不得**创建第二套 Club→Club Transfer。
- SELL 必须满足：seller roster 不低于 **Holding Target**；seller 位置结构合法；不得出售**最后 GK**；不得破坏 position minimum；player 非 retired；player 非 FA；membership/contract 合法；buyer 合法；buyer roster `< MAX24`；buyer finance 合法；**transfer 原子性保持**。
- 链路仍为 `Decision Layer → Action Layer → Domain API → Game State`；AI **不得直接写 state**。

### D-33.5 Holding Target `[已定]`
- **`HOLDING_TARGET = 14`**。语义：`12 = 生存最低线`，`14 = AI 正常持有目标`，`24 = 最大 roster`。
- 当 `roster > 14` 且存在**结构性 surplus** 时，多余球员可进入 **SELL / RELEASE 候选池**。
- **AI 不得为了达到 14 而强制出售**；14 是 holding target，不是强制 roster size。

### D-33.6 Population 有界 Surplus（D-16 扩展）`[已定]`
- **批准 D-16 有界 surplus 扩展**：Population 不再只有 `club < MIN → generation`，而增加**有限目标带**。
- 世界参数：**`WORLD_MIN_POPULATION = 96`**（生存底线，**保持不变**）；**`WORLD_SOFT_CAP = 112`**（有界生态库存上限）。8 clubs 下：`MIN = 8×12 = 96`，`SOFT TARGET = 8×14 = 112`。
- Generation 约束（1–9）：① 不低于 `WORLD_MIN_POPULATION`；② 需要时可向 club **holding target** 方向补位；③ world active population **不得超过 `WORLD_SOFT_CAP`**；④ **不得无限生成**；⑤ **不得随机生成 FA 以制造市场**；⑥ retirement 是人口减少来源之一；⑦ generation 是**有界补位**；⑧ Population **不直接执行 transfer**；⑨ FA 仍属 world active population。
- **`WORLD_SOFT_CAP=112` 不意味每次机械恢复到 112**：它是**上限/目标带边界**；必须避免“每次退休都立即补回 112”的机械恢复行为（保持 D-16 精神，最小修改）。

### D-33.7 transferBudget regeneration（D-27 T6 扩展）`[已定]`
- **批准方案 A**：**Season Boundary 对 `transferBudget` 做确定性再生/top-up**，目标使其**不再永久单向衰减**。
- 原则：无 RNG；**有上限**（默认上限 = `INITIAL_TRANSFER_BUDGET`）；**不引入收入系统**；**不引入 cash regeneration**；不让强队无限购买；不让弱队永久失去购买能力。
- **保持单笔 Transfer 原语义**：buyer `transferBudget -= fee`；seller `transferBudget` **不因该笔交易增加**（**D-27 T6 继续成立**）。
- 改变的是 **「赛季边界 budget replenishment」**，**不是**「卖球员立即增加 transferBudget」。→ **D-27 T6 标记为【扩展】，非推翻**。

### D-33.8 Cash regeneration `[已定]`
- **Cash 不再生**。保持 buyer `cash -= fee`、seller `cash += fee`；Cash 是真实余额；fee 在俱乐部之间循环。
- 本版**不引入**：TV / Ticket / Sponsor / Prize money、Wage cash flow、Board injection。Finance Economy v2 以后单独设计。

### D-33.9 Club Policy `[已定]`
- 仍只有 **Balanced / YouthFocus / Conservative**；**不增加第四种**。
- Policy 可影响：`demandBias` / `buyBias` / `sellBias` / `reserveRatio`（**参数语义冻结**；具体数值为最小、可解释的配置表，属 Step 34）。
- 所有参数必须：deterministic；no RNG；**不持久化**；**不直接修改 state**；不产生无限经济优势；不造成所有球队最终完全一致。

### D-33.10 AI Lineup / Match `[已定]`
- Step 33 **不处理** AI lineup 对 Match Engine 的影响；**不得修改** `resolveMatchSquad()` / `computeTeamStrength()` / Match Engine。
- **Golden Regression 必须继续保持**：`143` goals / `143` player goals / `1141` player appearances。

### D-33.11 Schema / Save `[已定]`
- **Schema 10**；**Save Format 1**；v2 **不增加持久化 AI 状态**。
- 以下均为**派生**：Competitive Need、Holding Target、Policy、Suitability、AI Decision、Population target calculations、Budget replenishment calculation → **不进行 Schema bump**。
- 仅当未来真正需要持久化**长期 AI 计划 / Market State / Budget History** 时，才另开 Decision Freeze。

### D-33.12 Action Cap `[已定]`
- 每 Club 每赛季主动**退出**动作总数：**`MAX_EXITS_PER_SEASON = 2`**，其中 **SELL + RELEASE 合计 ≤ 2**。
- **BUY / FA SIGNING** 的购买动作上限继续独立遵循当前 AI action cap。
- **SELL 不再视为“纯对手侧动作”**；v2 允许 AI 主动 SELL intent → **SELL 正式计入 seller Club 的 exit cap**。

### D-33.13 Generated Player → Free Agent `[已定]`
- **暂不允许**通过 Population Generation 主动把 generated player 放入 Free Agent pool；保持 **D-26**（Generation → Club membership）。
- Free Agent 仍来自现有生命周期/释放机制；**不得为制造 Transfer Market 而随机制造 FA**。

### D-33.14 WORLD_MIN_POPULATION `[已定]`
- **`WORLD_MIN_POPULATION` 保持 96**；**不得**因为 `H=14` 而改为 112。三者职责不同：
  - `WORLD_MIN_POPULATION = 96` = 生存底线；
  - `WORLD_SOFT_CAP = 112` = 有界生态库存上限；
  - `HOLDING_TARGET = 14` = 单 Club AI 持有目标。

### D-33.15 Season Boundary 顺序 `[已定]`
冻结顺序：
```
1. developPlayers
2. runPlayerLifecycle
3. Population Health / bounded population replenishment
4. transferBudget regeneration
5. runSeasonAI
6. repairManagedLineups
7. resetSeasonStats / new season state
```
理由：Population 必须先稳定；Finance capacity 必须在 AI 决策前更新；AI 必须基于**本赛季最新 population + finance** 决策；AI 不应看到尚未补充的 budget。

### D-29 必须保留的不变量 `[已定]`
`roster ≥ 12`；`roster ≤ 24`；GK minimum；DF/MF/FW minimum；last GK protection；no duplicate ownership；retired player has no membership；valid contracts；no NaN / Infinity；`cash ≥ 0`；`transferBudget ≥ 0`；static player data immutable；no OVR；no `Math.random`；deterministic AI；AI 只用 Domain API；**managed club 不受 AI 影响**；Schema 10；Save Format 1。

### D-29 长期生态验收 `[已定]`
Step 34 实现后必须测试 **10 / 50 / 100 / 200 / 500** 赛季，至少检查：population、FA count、roster distribution、position distribution、transfer count、release count、FA signing count、cash distribution、transferBudget distribution、age distribution、policy distribution。
必须同时满足：① 不永久停摆；② 不强制每年交易；③ 不无限交易；④ 不无限生成人口；⑤ 不无限膨胀资金；⑥ 不收敛成完全同质化球队。“每赛季都有交易”**不是**目标，允许自然低交易年份。

### D-29 旧 Decision 关系（Original Rule + v2 Extension）`[已定]`
- **D-16**：**REOPEN / EXTEND** —— 加入 bounded population surplus（保持“非精确 112”“最小修改”精神）。
- **D-24**：**EXTEND** —— 增加 `transferBudget` season replenishment（D6/D13 扩展；仍无收入系统、无工资现金流）。
- **D-26**：**保持**（Generated→FA 仍不开放，见 D-33.13）。
- **D-27**：**EXTEND** —— AI Active Selling + seasonal budget regeneration（**T6 扩展**；T11/T12/T21/T22/T23/T24 保持；**T25 重开→v2 实施**）。
- **D-28**：**EXTEND** —— Competitive Need + Active Selling + Holding Target（D-AI-05/11/14 扩展；D-AI-16/19/20/21/22/25 保持）。
- **不删除、不覆盖旧规则**；以 **Original Rule + v2 Extension** 方式保持历史可追踪。

### D-29 Step 34 实现边界 `[已定]`
**允许实现**：Competitive Need；Holding Target=14；Active SELL intent；SELL+RELEASE exit cap=2；bounded population surplus；`WORLD_SOFT_CAP=112`；transferBudget seasonal replenishment；Club Policy v2 参数；Season Boundary 顺序调整；相关测试；10/50/100/200/500 long-run validation；文档同步。
**禁止**：Match Engine / Team Strength / OVR / Transfer UI / Negotiation / Transfer Window / Loan / Scout / Agent / Contract Renewal / Income System / Cash regeneration / Board / Manager Personality / Random market activity。

---

## D-34 World Economy / Transfer Market v2 Micro Decisions（Step 34A Audit · Step 34B Decision Freeze）（对应 SIMULATION_SPEC §34、ROADMAP §2.21）

> 本条使用 **Step 34 决策编号 D-34.1 ~ D-34.3**（与项目 `D-xx` 编号属不同命名空间）。
> 性质：**纯文档 Decision Freeze**——仅记录 Step 34A 审计明确的三项**实现微决策**；**未修改**代码 / 数据 / 测试 / Schema / Save Format；**未实现**任何 Step 34 功能。
> 依赖：Step 33B **D-29 / D-33.1 ~ D-33.15**（本步**不改写、不冲突**）；Step 34A = READY / 0 BLOCKER。

### D-34.1 Population Trigger Semantics `[已定]`
- 参数语义**四者完全分离**：
  - `WORLD_MIN_POPULATION = 96` = **Hard World Floor**（生存底线）
  - `WORLD_SOFT_CAP = 112` = **Soft Ecosystem Cap**（有界生态库存上限，**非自动补人口目标**）
  - `HOLDING_TARGET = 14` = **AI Holding Target**（**非 Population Generation 的自动补满目标**）
  - `MIN_PLAYERS = 12` = **Club Hard Minimum**
- **Population Generation 仅在以下两种情况下发生**：
  1. Club 出现**结构性 roster 缺口**：`roster < 12` / `GK < 1` / `DF < 4` / `MF < 4` / `FW < 2`；
  2. World active population `< WORLD_MIN_POPULATION`。
- 发生时：**优先使用现有 Free Agent**；FA 不足才 `generatePlayer`；**保持现有确定性 position fill 顺序**。
- **明确禁止**（均视为违反 D-33.6）：① 不通过 generation 机械恢复到 112；② 不因 `roster=12` 自动生成到 14；③ 不因 `population<112` 自动生成到 112；④ **不得新增**“每季补到 112”“低于 112 自动生成”“每俱乐部自动补到 14”之类逻辑。
- **Population System 不负责制造 AI trading supply**；AI surplus supply 来自**自然形成的** `roster > 14` / Competitive·squad context / AI Active SELL·RELEASE。

### D-34.2 transferBudget Carry-over Regeneration `[已定]`
- Season Boundary 每季执行 transferBudget regeneration，使用 **carry-over 语义**：
  ```
  newTransferBudget = min(INITIAL_TRANSFER_BUDGET, currentTransferBudget + REPLENISHMENT_AMOUNT)
  ```
  - `INITIAL_TRANSFER_BUDGET` = 现有配置中的初始转会预算上限；
  - `REPLENISHMENT_AMOUNT` = **Step 34 实现阶段配置常量**（本步不重新设计数值）。
- 必须保持：未使用的 transferBudget **可保留**；每季**可恢复一部分**；**最高不超过** `INITIAL_TRANSFER_BUDGET`；**不直接 reset** 到 `INITIAL_TRANSFER_BUDGET`；**不因卖人**增加 seller transferBudget。
- **D-27 T6 保持不变**：单笔 Transfer 仍 `buyer transferBudget -= fee`、`seller transferBudget 不增加`。
- 示例：`current=180,+420→600`；`current=500,+420→600`；`current=80,+420→500`。
- **不得**通过 budget regeneration 修改 `cash`；**cash regeneration 仍然禁止**（D-33.8）。

### D-34.3 Competitive > Soft Priority / Deduplication `[已定]`
- Need 优先级冻结为：**HARD > COMPETITIVE > SOFT > NONE**。
- **HARD**（结构性生存问题）：`GK < 1` / `DF < 4` / `MF < 4` / `FW < 2` / `roster < 12` / 无法满足当前 formation 的**可用球员**要求。
- **COMPETITIVE**（**仅在无 HARD 时考虑**）：最低人数虽满足，但该位置**竞技质量明显不足**。优先使用：starter quality / bench quality / position-specific effective attributes / league position baseline / squad competitive context；**不得**使用单一 OVR、单一全队平均值，或**简单复制 ATTRIBUTE_GAP**。reasonCode = **`COMPETITIVE_UPGRADE`**。
- **SOFT**（非生存、非核心竞争缺口）：`ATTRIBUTE_GAP` / `YOUTH_DEVELOPMENT` / `SQUAD_BALANCE`；**继续受 `policy.softNeedEnabled` 控制**。
- **去重规则**：① 存在 HARD → 不产生 COMPETITIVE / SOFT 替代需求；② 无 HARD → 先检查 COMPETITIVE；③ 某位置已产生 COMPETITIVE → 同位置**不得**再因相同竞技质量缺口产生 SOFT `ATTRIBUTE_GAP`；④ SOFT 仍可在**其他维度**产生 `YOUTH_DEVELOPMENT` / `SQUAD_BALANCE`；⑤ 不允许同一原因重复命中产生两个相同 Need。
- 最终优先级 **HARD → COMPETITIVE → SOFT → NONE**；**保持确定性**；**不得使用 RNG**；**不得使用 OVR**。

### D-34 附：其余确认（与 D-33 一致，不改写）`[已定]`
- **Holding Target 语义**：`HOLDING_TARGET=14` **只属 AI Decision Layer**；`roster ≤ 14` → AI 不主动制造 surplus exit；`roster > 14` → 可**评估** surplus player，但 `roster > 14 ≠ 必须 SELL/RELEASE`，仍须走 `Need → Candidate → Suitability → Finance → Buyer → Domain validation`。**Domain Transfer 不引入 HOLDING_TARGET**，继续使用既有 12/24 硬约束。
- **Exit Cap**：`MAX_EXITS_PER_SEASON = 2`，**SELL + RELEASE 共享同一 exit counter**（禁止 `2 SELL + 2 RELEASE`）；BUY / FA SIGNING 沿用独立 signing cap；counter **ephemeral，不持久化**。
- **Active SELL**：必须调用 **`transferPlayer()`**，**不得**新增第二套 Transfer Domain；流程 `Surplus Player → Buyer Search → Buyer Need → Candidate Filter → Suitability → Finance → transferPlayer()`；Buyer 须满足匹配 Need / 合法球员 / `roster < 24` / `cash` 足够 / `transferBudget` 足够 / 现有 Domain 约束；Seller 须满足 Holding Target 保护 / 不违反 GK·Domain 硬约束 / 不违反 exit cap；**同一 AI cycle 同一 player 最多 SELL 一次**，成功后加入本 cycle **moved-player set**，之后本 cycle 不得再次转手。
- **Club Policy v2**：保持 Balanced / YouthFocus / Conservative；继续经**现有 deterministic `hashSeed` 派生**，**不得改变 hashSeed 映射**；新增 `demandBias / buyBias / sellBias / reserveRatio`，保留 `potentialWeight / softNeedEnabled`；全部 derived / non-persistent / deterministic；**不得写入 save**。
- **Season Boundary 顺序**：`developPlayers → runPlayerLifecycle → bounded population health → transferBudget regeneration → runSeasonAI → repairManagedLineups → resetSeasonStats`；每季恰好一次；AI **不会**在 budget regeneration 前运行；无重复 regeneration / 无重复 population generation。

### D-29 / D-34 Step 34 实现状态 `[已实现；目标级 BLOCKED]`
- **已实现**：Competitive Need（`COMPETITIVE_UPGRADE`，独立档 + 去重）；`HOLDING_TARGET=14`（仅 AI 层，Domain 仍 12/24）；Active SELL（`SELL_PLAYER` → `transferPlayer()`，moved-set 防重复）；`SELL + RELEASE` 共享 exit cap（≤2）；`WORLD_SOFT_CAP=112` 上限保护；transferBudget **carry-over** 再生（`replenishTransferBudget`，上限 `INITIAL_TRANSFER_BUDGET`，不改 cash）；Club Policy v2 参数（`demandBias/buyBias/sellBias` 等）；Season Boundary 顺序（regeneration 在 `runSeasonAI` 之前）。**Schema 10 / Save Format 1 不变**（全部派生）。
- **验证**：测试 **312/312 通过**；黄金回归 `143/143/1141` 不变；浏览器冒烟通过；10/50/100/200/500 长跑不变量（membership/contract/finance）全部通过。
- **未达成 D-33.1（长期生态目标）**：长跑 **50/100/200/500** 季仍收敛到 `population=96 / roster=12 / FA=0 / transfer=0`（与实现前一致）→ **吸收态未被打破**。
- **根因（bottleneck = Supply）**：`D-34.1` 的 generation 触发条件（仅 club 结构性缺口 / `world<96`）**不会提升 world stock**；retirement 使 world 单调降到 96；`Σ=96 ∧ 每 club ≥ 12 ⇒ 每 club 恰为 12` ⇒ 卖方 surplus 恒为 0 ⇒ 无候选。`Competitive Need`（demand）与 `transferBudget 再生`（capacity）均**不能**产生供给。
- **Decision 冲突登记**：**D-33.1（不接受吸收态）与 D-34.1（generation 仅补缺口）在当前参数下互斥**；D-33.6 ②"可向 holding target 补位" 与 D-34.1 措辞亦冲突。**待后续 Decision Freeze（Step 35 候选）裁定**：是否允许“有界 population 维持 / 向 holding target 补位”，或引入其它供给侧机制。**本步未擅自修改任何冻结规则**。

### D-35A Supply-Side / Population Cycle Audit（Step 35A）`[审计；不冻结规则]`
> 性质：**只读设计审计**。未修改代码 / 数据 / 测试 / Schema / Save Format / 配置；**未冻结任何新规则**。凡涉及新机制一律 **[TBD]**；复用既有冻结规则者标 **[已定]**。

- **系统模型（守恒）**：`Σ_c R_c(t) + F(t) = N(t)`。`transferPlayer`（club↔club）、`release`（club→FA）、`signFreeAgent`（FA→club）**均不改变 N**；retirement `N-1`；generation `N+1`，且 generation **恒分配给某 club**（`teamId`），**不直接进入 FA**。`transferPlayer` 亦不改 `generated`/`retired`（D-27 T24）。
- **当前吸收态（已证明）**：`N=96, R_c=12 ∀c, F=0` 是**不动点**——(1) 每 club 满足 GK≥1/DF≥4/MF≥4/FW≥2 且 `roster=12` → 无结构性缺口 → generation=0；(2) `worldMin=min(96,8×12)=96` → 世界安全网不触发；(3) 无 club `R_c>HOLDING_TARGET(14)` → RELEASE/SELL 不触发；(4) 任意 seller 会让 `R_c-1=11<12` → `sellerKeepsStructure` 否决全部 Club↔Club 候选。唯一存活动作 = retirement + 1:1 结构补位 → 回到同一状态。**长期单调收敛**（起始 112 经 retirement 降至 96 后锁定）。
- **供给三问**：Population Supply = generation（当前净零，仅抵消 retirement）；Club Surplus Supply = **当前无任何机制**；Transfer Liquidity = 需 `R_c>14` 的 seller（恒 0）。**最终恒为 0 的项 = Seller Supply（伴随 FA=0）**。
- **关键耦合**：`WORLD_MIN_POPULATION(96) = ClubCount(8) × CLUB_MIN(12)`，且 active player **等价于** first-team roster（membership 仅 `clubId | null`，**无** youth/reserve/development squad 维度）→ **Population Floor ≡ Market Supply Floor**。
- **候选机制审查（全部 [TBD]，未选择）**：A 补到14 → 新不动点 `112/14/0`，仍不产生 seller；B 人口带 → 常数目标必然形成新不动点，须状态相关触发；C 非均匀深度 → 可产生 seller，需确定性轮换避免永久 supplier；D Youth/Reserve Domain → 可解耦 N 与 ΣR，但属新 Domain / 高成本；E 仅 retirement+generation → 数学上不可能产生 surplus；F generation→FA → 可造 FA 缓冲，但**与 D-33.6/D-34.1 冲突**且需上限防膨胀；G 仅靠 Policy → 现 policy 无 roster-size 目标，**不足**；H 市场驱动 surplus → 数据齐备但依赖先有深度积累（循环依赖）。
- **禁止解法**：随机生成 FA 供货；按目标笔数强制交易（违背 deterministic-first 与因果）。
- **核心待裁问题**：是否让 `Population Floor > ClubCount × ClubMin`（解耦）或保留 floor 另加 Market Supply 机制。**Decision Questions 见 [ROADMAP 2.23](file:///workspace/docs/ROADMAP.md)**。

### D-35B Supply Mechanism Decision Audit（Step 35B）`[审计；不冻结规则]`
> 只读；未修改代码 / 数据 / 测试 / Schema / Save Format / 运行时配置。以下**全部 `[TBD]`**，供 **Step 35C** 裁定。

- **数学结论（事实）**：在 rule 4（生成仅补结构缺口 / `world<96`）与 rule 8（AI 卖人不使 `roster<12`，由 `sellerKeepsStructure` 强制）不变时，`ΔN = Gen − Ret ≤ 0`（超出 12 的缓冲吸收退役，不触发生成）⇒ **N 单调非增、收敛到 96** ⇒ `96/12/0` 是**唯一**不动点。**在全部冻结规则不变的前提下，不存在可持续供给机制。**
- **解法必要性**：要产生可持续 surplus，必须容许 `Gen > Ret`（生成**超出**结构缺口）**或**新增注入 Domain。前者需**受控重开 D-34.1**。
- **方案审查（A–G）**：A 补到14 → 新不动点 `112/14/0`（无 seller）；B 非均匀深度 → 可产 seller（需确定性轮换）；C Policy 动态深度 → 同 B（policy 仅偏好、非身份）；D 纯状态驱动 → **无注入源、不能自举**；E 生成→FA → 仅解决 FA 流动性、**不解决 club↔club seller supply**，需上限；F Youth/Reserve Domain → 可解耦 `N` 与 `ΣR`，但属新 Domain（schema 风险），**建议 DEFER**；G 组合（B/C + D + 保留）→ 最有希望，复杂度最高。
- **推荐候选（`[建议]`，未冻结）**：① **Dynamic Depth Target Intake（DDTI）**——现有 Domain、schema 不变、需受控重开 D-34.1；② **Bounded Intake Pool（BIP）**——独立池，新 Domain，**建议 DEFER**。
- **三概念分离**：Population Supply（注入通道）／Squad Depth Supply（某 club 为何 >12）／Market Supply（某球员为何可卖）——**不可混同**；"人口增加 ≠ market supply 增加"。
- **反永久身份**：任何方案必须使 club 随自身状态在 `surplus→neutral→deficit` 之间迁移；**Policy 仅是偏好，不是永久市场身份**。
- **待 Step 35C 决策**：见 [ROADMAP 2.24](file:///workspace/docs/ROADMAP.md)。

---

## D-35 World Economy v2 Supply Mechanism Decision Freeze（Step 35C）（对应 SIMULATION_SPEC §34、ROADMAP §2.25）

> 本条使用 **Step 35 决策编号 D-35.1 ~ D-35.11**（与项目 `D-xx` 编号属不同命名空间）。
> 性质：**纯文档 Decision Freeze**——**未修改**代码 / 数据 / 测试 / Schema / Save Format / 运行时配置；**未运行**实现测试 / 长跑 / Browser Smoke。
> 依赖：Step 35A（只读审计）与 Step 35B（只读方案审计）；不重写、不冲突 D-29 / D-33 / D-34。**所有未经模拟验证的具体数值一律 `[TBD]`，留待 Step 35D。**

### D-35.1 Supply Route = α / DDTI `[已定]`
- **冻结选择路线 α：Dynamic Depth Target Intake（DDTI）**。在现有 Domain 内实现，**不引入新 Domain**。
- **路线 β（Bounded Intake Pool / Youth·Reserve Pool）本阶段 DEFER**。理由：当前系统仅有 Club Membership / Free Agent / First-team roster，**无** Youth / Reserve / Development Pool；BIP 会引入 active-but-not-first-team 语义，很可能需要新 state / membership 语义 / schema·save migration。当前问题可在不引入新 Domain 的前提下由受控 Population Intake 解决。Youth/Reserve Pool 应作为未来 Youth Academy / Reserve Squad 的**独立架构扩展**，**不作为 Transfer Market v2 的必要依赖**。

### D-35.2 D-34.1 受控重开：Controlled Depth Intake `[已定]`
- **正式承认数学前提（`[已定]` 事实）**：原规则下 `Gen` 仅在 (A) club structural deficit 或 (B) `N<96` 时发生且不超缺口 ⇒ `Gen ≤ Ret` ⇒ `ΔN = Gen − Ret ≤ 0` ⇒ `N→96` ⇒ `96/12/0` 固定点。**打破该固定点必须允许 `Gen > Ret`**（生成可在"结构缺口之外"产生有限 surplus）；这是本系统**必须接受的数学前提**，非实现细节。
- **D-34.1 受控扩展**：**保留** A（structural deficit generation）与 B（`world < 96` generation）；**新增** C（**Controlled Depth Intake**）。
- **C 必须同时满足**：① 状态驱动；② 有界；③ 确定性；④ 非机械；⑤ 非全俱乐部同步；⑥ 非固定年度补人；⑦ 不保证达到 14；⑧ 不保证达到 16；⑨ 不保证达到 112；⑩ 不制造强制交易；⑪ 不改变 Transfer Domain；⑫ 不改变 Match / Team Strength；⑬ 不产生随机 FA flood；⑭ **不允许 `N > 112`**。

### D-35.3 State-driven effectiveDepthTarget `[已定]`
- **定义**：`effectiveDepthTarget_c` = "当前赛季、当前状态下，该俱乐部合理希望维持的第一队阵容深度"。
- **它不是**：固定 Club Policy / 固定人口配额 / 固定生成数量 / 固定卖人数量 / 市场身份 / 永久 supplier·buyer 标签。
- **它是**：状态变量驱动的、**可逆的** AI Population Intake Target。
- **必须至少考虑（`[已定]`）**：① squad age structure；② positional congestion；③ HARD / COMPETITIVE / SOFT need；④ finance / reserve pressure；⑤ recent transfer activity；⑥ player development context。**允许未来扩展更多状态变量。**
- **禁止**：单一 OVR；单一 squad average；固定 Policy → 固定 target；**随机 target**；每季随机改变 target。
- **上下限（`[已定]` 存在性；`[TBD]` 具体值）**：target **必须**存在硬上下限——最低 `target ≥ CLUB_MIN = 12`，最高 `target ≤ DEPTH_CAP`。**DEPTH_CAP 具体值不在本步冻结**（候选 14 / 15 / 16 / 17），留待 **Step 35D 参数实验**。

### D-35.4 Policy is bias, not identity `[已定]`
- Club Policy（`demandBias / buyBias / sellBias / reserveRatio` 等）**只允许作为 target 的偏置因素**。
- Policy **不得**直接决定"该俱乐部永远是卖家/买家"。同一 Club 必须能随状态经历 `deficit → neutral → surplus → neutral → deficit`。
- **Policy 是 bias，不是 identity。**

### D-35.5 Target hysteresis `[已定]`
- target **必须具备 hysteresis / hysteresis window**，避免 `12 → 13 → 12 → 13` 每季抖动。
- 概念上区分**进入**条件（`target_up_condition`）与**退出**条件（`target_down_condition`），且退出条件应更严格/不同。
- **阈值已由 Step 35E 冻结：`HYSTERESIS_UP = 0.30`、`HYSTERESIS_DOWN = 0.15`（C1）。**

### D-35.6 Hard depth cap = `DEPTH_CAP` `[已定]`
- 存在性：`target ≤ DEPTH_CAP`，且 `DEPTH_CAP ≥ HOLDING_TARGET(14)`。
- **数值已由 Step 35E 冻结：`DEPTH_CAP = 14`（C1 基准参数）。**（Step 35D 实验候选 14/15/16/17 记录见 D-35D。）

### D-35.7 Intake caps `[已定]`
- Controlled Depth Intake **不是**"`roster < target` 就一定生成"，而是"`roster < target` **且当前状态允许 intake** 时才允许生成"。
- 存在性：① 每 Club 每季 intake cap；② World 每季 intake cap；③ `N ≤ 112` hard constraint。
- **数值已由 Step 35E 冻结：`PER_CLUB_INTAKE_CAP = 1`、`WORLD_INTAKE_CAP = 4`（C1）。**

### D-35.8 No permanent supplier / buyer `[已定]`
- **禁止**任何 Permanent Supplier Club / Permanent Buyer Club。Club market role 必须是动态状态 `SURPLUS / NEUTRAL / DEFICIT` 且可互相转换。
- Policy **不得**直接生成永久身份。
- **`112/14/0` 不得成为长期吸收态**：必须满足 target 异质、状态驱动、可逆、不由 Policy 固定决定、不保证所有 Club 同时达到 14、Controlled Intake 不同步对所有 Club 运行，且系统必须存在 `target < 14` 与 `target > 14` 的状态。
- **注意**：本步**不**直接冻结 `Σtarget < 112`，而是冻结**结果要求**——"`112/14/0` 不得成为长期吸收态"；**具体实现方式 `[TBD]`**，交由 Step 35D 模拟验证。

### D-35.9 BIP / Youth / Reserve deferred `[已定]`
- **DEFER**。未来若增加 Youth Squad / Reserve Squad / Academy / Development Pool，**必须重新设计**：membership semantics、active population accounting、promotion / demotion、retirement、injury、save format、schema migration、AI decision layer、transfer eligibility。**本阶段不实现。**

### D-35.10 Generation → Free Agent deferred `[已定]`
- **不作为当前主供给机制**。理由：Generation → FA 主要增加 **FA liquidity**，**不能直接创造 Club → Club seller supply**。当前 **DEFER**。
- 如未来需要，**独立设计 bounded FA pool**；**不得通过随机生成 FA 解决 Club seller shortage**。

### D-35.11 Step 35D validation gate `[已定]`
- Step 35D 才负责**参数实验 + 长期模拟验证**（**路线 α 已冻结，不重新讨论路线**）。
- **重点验证**：① `DEPTH_CAP`；② target function；③ hysteresis；④ per-club intake cap；⑤ world intake cap；⑥ `N=112` behavior；⑦ target heterogeneity；⑧ club role transition；⑨ seller diversity；⑩ buyer diversity；⑪ transfer activity；⑫ release activity；⑬ FA stability；⑭ population stability。
- **必须验证的固定点**：`S-A (96/12/0)` 与 `S-B (112/14/0)` **均不得成为长期吸收态**；`S-C (96~112 / mixed roster / mixed FA)` 允许为动态状态但**不得证明为"固定不动"**；`S-D / S-E` **不得形成永久 supplier / buyer 分裂**；`S-F` 允许**短期/阶段性** 0 transfer（若无真实 Need），但**不得因机制错误长期冻结市场**。
- **验收边界**：运行 **10 / 50 / 100 / 200 / 500** season；检查 `N ∈ [96,112]`、`R_c ∈ [12,24]`、`FA ≥ 0`、`transferBudget ≥ 0`、`cash ≥ 0`、无 NaN / Infinity / 负 roster / `>24`；**deterministic**；**Golden Regression `143 / 143 / 1141` 必须不变**。
- **新增生态指标**：population range / mean roster / roster distribution / FA distribution / transfer·SELL·RELEASE·FA-signing counts / buyer·seller distribution / **club role transition count** / max consecutive seasons with zero transfer / zero seller / zero buyer / max single-club market participation / target distribution / target transition count。
- **不得只看平均值**：必须检查 distribution 与 **per-club persistence**（如 Club A 100 季卖 20 次、Club B 0 次，即使全局平均正常，也视为存在潜在永久身份问题）。**市场健康 = Global Metrics + Club-level Persistence。**

### D-35E DDTI Final Parameter Freeze + Contract Consistency Freeze（Step 35E）`[已定]`
> 正式冻结 Step 35D 已验证的 DDTI 基准参数 **C1**，并正式接受 AI 候选/SELL 与 Transfer Domain T9 的合同资格一致性修复。**未新增/修改任何 DDTI·Transfer·Finance·AI 机制**。

- **D-35.6 / D-35.7 / D-35.5 数值冻结（`[TBD]` → `[已定]`）**：`DEPTH_CAP = 14`、`PER_CLUB_INTAKE_CAP = 1`、`WORLD_INTAKE_CAP = 4`、`HYSTERESIS_UP = 0.30`、`HYSTERESIS_DOWN = 0.15`。**C1 为正式基准参数**；`sim-config.DDTI_CONFIG` 已同步为 C1。C2/C3 仅作 Step 35D 历史实验记录，**不作为当前运行配置**。
- **合同一致性修复正式接受（`[已定]`）**：AI transfer candidate / SELL eligibility = `activeOwned` **OR**（`generated` 且**无 contract**），与 `validateTransfer`（T9）一致。**不恢复**"必须有 active contract"旧限制。保留 `sellerKeepsStructure` / exit cap / `transferPlayer` Domain validation / fee 公式 / finance 规则 / membership 规则。**Transfer Domain 本身未修改**。
- **DDTI 机制冻结确认（`[已定]`）**：state-driven、bounded、deterministic；无 RNG、无 OVR、无单一全队均值；六维压力（age / congestion / need / finance / recent activity / development）；Policy 仅 bounded bias（非身份）；Need 与 Depth Target 分离；**结构缺口优先于 depth intake**；**FA 优先于 generatePlayer**；`roster < 24`；`N ≤ 112`；不强制交易 / 不强制每 club=14 / 不强制人口=112 / 不制造随机 FA 洪水；**不修改 Transfer / Match / Team Strength**。
- **Step 35D 验证结论（正式记录）**：① `96/12/0` 与 ② `112/14/0` **均不再形成长期吸收态**；③ 混合人口/阵容可长期存在；④ **无永久 supplier/buyer**；⑤ 允许阶段性低活跃，但**纯 AI 世界 500 季 `maxConsecZeroTransfer = 0`**；⑥ Population 长期在 **104–112** 动态区间；⑦ Roster 长期主要 **12–15**；⑧ FA 偶发存在（非长期 0、非爆炸）；⑨ **无随机 supply**；⑩ determinism 通过；⑪ Golden `143/143/1141` 保持；⑫ Schema = **10**；⑬ Save Format = **1**；⑭ Browser Smoke clean；⑮ Match / Team Strength 未修改。
- **Deferred Issue（登记，Step 36 处理）**：见下方 `Deferred Issues`。

### D-35D DDTI Implementation + Experiment（Step 35D）`[已实现；参数已由 Step 35E 冻结]`
> 依 D-35.1~D-35.11 实现 **DDTI** 并做参数实验 + 长跑验证。**未冻结任何新数值**；`DEPTH_CAP` 等仍 `[TBD]`。Schema **10** / Save Format **1** 不变。

- **实现**：新增 `src/core/ai/ai-depth-intake.js`（`evaluateDepthPressure` / `effectiveDepthTarget` / `evaluateDepthIntake` / `classifyMarketRole`，纯函数、无 RNG、无 OVR）；`sim-config.DDTI_CONFIG`（参数集中）；`player-lifecycle.runDepthIntake`（应用层，FA 优先 → `generatePlayer`）+ 接入 `runPlayerLifecycle`（**结构补位在前、depth intake 在后**）；`SimulationCore({ ddti })` 参数覆盖（实验用）。**未改** Transfer / Match / Team Strength / membership / contract / save。
- **⚠ 关键发现（真正的长期冻结根因，非 supply）**：AI 候选过滤器 `filterCandidates` / `decideSell` **要求 active 合同**，而 Domain `validateTransfer`（T9）**明确允许 generated 球员无合同**。随着赛季推进，阵容被 generated 球员（**无合同**）取代后，AI **无法产生任何 Club↔Club 候选** → 市场在 ~S50 冻结为 `112/14/0`。**修复**：`ai-candidate.js` / `ai-decide.js` 的资格判定与 Domain 对齐（`activeOwned || (generated && 无合同)`）；`sellerKeepsStructure` / exit cap / transferPlayer **未动**。
- **实验（8 队，排除 managed 现金汇；**无 managed club** 的纯 AI 世界）**：修复后 500 季市场**持续活跃** —— `C1(cap14/pc1/wc4)` tail20=246、`C2(cap15/pc1/wc6)` tail20=157、`C3(cap16/pc1/wc6)` tail20=267；**maxConsecZeroTransfer=0**；pop∈[104,112]；roster∈[12,15]；FA 偶现；role transition 521~666；maxSellShare≈0.17~0.20（**无永久 supplier/buyer**）；cash/transferBudget ≥0；roster≤24；无 NaN。
- **参数筛选（50 季）**：`DEPTH_CAP` 14/15/16/17 均可产生活跃市场；**per-club cap ≥2 有害**（cap16/pc2 曾出现 10 季 0 交易）；hysteresis low≈med（0.20/0.30 阈值常不约束），high 略降活跃。world cap 4~6 较优。
- **⚠ 残余限制（finance 侧，超出 DDTI 范围）**：若存在 **managed（非 AI）俱乐部**，AI 会把现金净付给该俱乐部（AI 只买/卖、managed 不支出），**cash 单向集中**至 managed（如 500 季后 8000 中 7961 集中于 managed），其余 AI 俱乐部 cash→0 而无法购买 → 市场长期冻结。根因：**D-33.8（cash 不再生）** + managed 免于 AI。**非 DDTI 缺陷**，需后续 finance 决策。
- **建议候选（`[建议]`，未冻结）**：`C1 = cap14 / per-club 1 / world 4`（pop 最富弹性 104–112、tail20 最高之一、maxSellShare 最低 0.17）；备选 `C3 = cap16 / 1 / 6`（活跃最高）。**最终数值留待 Step 35E。**
- **验证**：测试 **321/321 通过**（新增 `tests/ai-depth-intake.test.js` A1–9）；Golden `143/143/1141` 不变；determinism（同 world/seed/config 结果一致）；Browser Smoke clean。

### D-35 附：保持不变（不改写）`[已定]`
- **Transfer Domain 不修改**：仍 `Club A → Club B`，经 `transferPlayer()`；buyer `cash -= fee` 且 `transferBudget -= fee`；seller `cash += fee`，seller `transferBudget` **不自动增加**；Population Supply **不得强迫 Transfer**。
- **AI 链不变**：`Need → Candidate → Suitability → Finance → Action`；`HARD > COMPETITIVE > SOFT > NONE`。
- **HOLDING_TARGET = 14 保持**：14 仍是 AI squad holding / surplus 判断参考线，**不是 generation target**；`R=15` 或 `R=16` **不代表必须卖人**；SELL 仍须满足 surplus context / candidate suitability / buyer exists / finance valid / seller structure valid / exit cap / Domain transfer validity。
- **第一次 surplus 的定义**：系统**不需要从 0 重新制造第一批 surplus**——初始 `N=112 / R_c=14` 已提供初始 depth inventory；DDTI 主要职责是**防止 `112 → retirement → 108 → 104 → 100 → 96 → permanent lock`**，即**维持有限 depth elasticity**，而非最大化人口。
- **三者分离**：Population Supply（谁创造新 active player）/ Squad Depth Supply（为何某 Club 有 13/14/15/16 人）/ Market Supply（为何某具体 player 成为 surplus / SELL candidate）——**不得混同**；`Population ↑ ≠ Market Supply ↑`。
- **Schema 10 / Save Format 1 保持**；**Match / Team Strength 不修改**。

---

## D-36 Managed Finance Feedback（DF-01：Step 36A 审计 / Step 36B 反事实实验 / Step 36C 决策冻结）

> 本步（Step 36C）为 **DOCS-ONLY Decision Freeze**：**未修改任何生产代码 / 配置 / 测试 / Schema / Save Format / DDTI / Transfer Domain / Match / Team Strength**，**未运行生产实现**，**未 commit**。
> 依据：Step 36A 只读审计（`Σ club.cash ≡ 8000` 严格守恒；managed cash 单向集中；AI aggregate cash → 0；市场冻结，`maxConsecZeroTransfer ≈ 243`）+ Step 36B 只读反事实实验（CF-A ~ CF-F）。
> **冻结机制 = CF-E2（threshold-triggered managed finance redistribution）。**

### D36.1 Managed Finance Feedback `[已定]`
- **目的**：防止 managed club 成为**长期现金汇（永久资金黑洞）**，从而避免 `AI aggregate cash → 0` 与 transfer market **absorbing state**。
- **机制（CF-E2 冻结）**：
  1. 每个 **赛季边界**检查 `managedShare = cash_managed / WorldCash`。
  2. 当 `managedShare > 35%` 时触发 Finance Feedback。
  3. 从 managed **cash** 中**确定性再分配 20%**。
  4. 资金**不销毁、不生成**：`Σ club.cash ≡ WorldCash ≡ 8000`（严格守恒）。
  5. 接收方为 **AI 俱乐部**（**不含** managed）。
- **接收方确定性规则（冻结）**：计算所有 AI 俱乐部 cash 的**中位数** → 优先选择 `cash < AI median` 的 AI clubs → 按 **cash 升序**（同 cash 以 **clubId 升序** 作 tie-break）→ 若无低于 median 的 AI club 则**全部 AI** 作为接收方 → 本轮资金在接收方之间**均分**（整数余数按该确定性顺序依次 +1）。**不使用** RNG / OVR / 隐藏随机 / 不可复现排序。
- **只改 cash**：不改 `transferBudget`、不改 `wageBudget`、不产生债务、不允许 `cash < 0`、不改 transfer fee 公式、不改 Transfer Domain。

### D36.2 Managed Player Agency `[已定]`
- managed club **始终属于玩家控制范围**。
- AI **不得**因 Finance Feedback：强制玩家买球员 / 卖球员 / 修改玩家阵容 / 修改玩家战术 / 修改玩家合同 / 修改玩家转会决定 / 代玩家执行转会。
- Finance Feedback **只允许**执行 `managed cash → AI clubs cash` 的确定性资金再分配；**不**触碰 player membership / contract / transfer / lineup。

### D36.3 Finance Feedback Determinism `[已定]`
- **无 RNG**、无 OVR、无隐藏随机、无可复现性问题。
- 排序 = **cash 升序**，tie-break = **clubId 升序**，分配 = **确定性均分**。
- 相同 `(world state, managedClubId, season)` ⇒ **相同** Finance Feedback 结果。

### D36.4 D36.1 的精确含义：现金汇 ≠ 球员净卖出 `[已定]`
- D36.1 禁止的是**"现金层面的永久资金汇"**，**不要求**：managed 成为球员净买入方 / 保持 buy·sell 平衡 / AI 必须向 managed 买或卖。
- **允许**：AI 从 managed 买球员；managed 长期为球员净卖出方；managed 在玩家操作下大量出售；AI 与 managed 之间形成正常转会关系。
- **禁止**：managed cash 长期单调吸收世界现金；AI aggregate cash 长期趋近 0；transfer market 因 AI cash 枯竭进入 absorbing state。
- **解释原则**：「球员流」与「现金流」是两个不同层次；玩家俱乐部成为球员净卖出方属正常足球经营结果，成为世界现金的**永久资金黑洞**才是当前简化 Finance 模型中的结构性问题。

### D36.5 不重开 D-33.8 / 不引入收入系统 `[已定]`
- `D-33.8`（cash 不自动 regeneration）**保持不变**。
- 本决策**不引入**：世界收入 / TV revenue / sponsorship / prize money / ticket income / operating expense / wage expense / debt / negative cash / financial injection（属未来完整 Finance 系统，非本次 DF-01 修复）。
- 依据：Step 36B 证明 **CF-B（managed 支出→世界 sink，销毁现金）**、**CF-D（world income）**、**CF-F（cash/budget 解耦）** 均破坏 world cash 有界性；**仅"守恒再分配"通过**。

### D36.6 冻结不变式 / Schema / Save `[已定]`
- **D36.7 DDTI C1 完全冻结**：`DEPTH_CAP=14`、`PER_CLUB_INTAKE_CAP=1`、`WORLD_INTAKE_CAP=4`、`HYSTERESIS_UP=0.30`、`HYSTERESIS_DOWN=0.15`（本决策**不得修改**）。
- **D36.8 Transfer Fee Formula 完全冻结**；**D36.9 不得通过强制交易维持市场活跃**。
- **D36.10 Finance Feedback 必须**：deterministic / bounded / state-driven / explainable / reproducible。
- **Schema = 10 / Save Format = 1 保持**：Finance Feedback 为 **season-boundary 纯派生行为**，**不新增** `finance feedback state / redistribution history / last redistribution season / threshold state / cooldown state`，**无需迁移**。
- **Transfer Domain / Match / Team Strength 不修改**。

### D36 验证依据（Step 36B 摘要）`[已定]`
- **CF-A baseline**：managed cash concentration、AI cash collapse、market freeze、`maxConsecZeroTransfer ≈ 243`。
- **CF-B（sink）**：world cash 下降、market freeze 未解决 → **不采用**。
- **CF-D（world income）**：cash expansion、world cash 无界增长 → **不采用**。
- **CF-F（cash/budget decoupling）**：隐式第二货币 / money creation → **不采用**。
- **CF-C（conservation redistribution）**：通过。
- **CF-E（threshold + redistribution）**：通过。
- **最终选择 = CF-E2：`threshold = 35%` / `redistribution = 20%`。**

### D36 实现状态（Step 36D）`[已实现]`
- 新增 `src/core/finance-feedback.js`（`calculateManagedFinanceFeedback` → plan / `applyManagedFinanceFeedback` → apply / `runManagedFinanceFeedback`，**纯函数、无 RNG**）；`sim-config.FINANCE_FEEDBACK_CONFIG`（`THRESHOLD=0.35` / `REDISTRIBUTION_RATE=0.20`）。
- **接入位置（已定）**：`simulation.#rollFinishedSeasons` 中 `replenishTransferBudget` **之后**、`runSeasonAI` **之前**；**未改变**任何既有步骤顺序；每赛季边界**恰好一次**（`maxSeason > prevSeason` 单次触发保证，无需防重复持久化字段）。
- **只改 `cash`**；`Σ club.cash` 严格守恒；**Schema 10 / Save Format 1 不变**；无新持久化字段。
- **验证**：全量测试 **336/336 通过**（321 旧 + 15 新 `tests/finance-feedback.test.js`，0 失败）；Golden `143/143/1141` 不变；determinism 通过；10/50/100/200/500 赛季长跑通过（`managedShare` 稳定 ~0.28–0.35、AI cash median 健康、`maxConsecZeroTransfer ≤ 1`、无新 absorbing state）；browser smoke clean。

---

## D-38 Competition Structure（Step 38A 审计 / Step 38B 决策冻结）

> 本步（Step 38B）为 **DOCS-ONLY Decision Freeze**：**未修改任何代码 / 测试 / 配置 / .fdb / Schema / Save Format**，**未 commit**。
> 依据：Step 38A 只读审计（Current Competition Model = **League ≡ Competition ≡ Division**；Club→League 单值、无历史、无写入口；**H2：赛季边界判定取"首个 competition"**）。
> **冻结取向 = Candidate B（Competition 与 Division 分离）+ Country/World 规则数据化 + 两阶段派生执行 + 一期最小金字塔。**

### D38.1 Competition Domain 实体模型 `[已定]`
- **实体**：`Country → Division → Club`；`Competition`（含 `format`）引用 `Division` 与参赛集合；`Competition Season` 为 Competition 的**逻辑实例边界**。
- **League 与 Competition 合并**：`format = RoundRobin` 即"联赛"，**不再保留独立 League 实体**；**Division = Country 下的层级（tier）**。
- **约束**：一个 Club **同一赛季同一国内层级只属于一个 Division**；**可**同时参加国内联赛 + 杯赛 + 洲际赛（多赛事 = 多个 Competition，靠显式 `competitionId` 关联）。

### D38.2 Competition Season `[已定]`
- **逻辑独立**：赛季是 Competition 的**实例边界**；Standings / Fixtures / History / Champions / Promotion-Relegation / Qualification 均以**赛季实例**为自然键。
- **Phase 1 持久化**：`Competition Season` **不强制**为独立顶层持久实体（可先作为 Competition runtime 的子结构 + 归档）；**实体化属增强，延后**。
- **世界级 `state.season`**：保持"推进标量"语义（可由各 Competition Season 派生，保留现有 `maxSeason` 行为）。

### D38.3 Club Membership 语义 `[已定]`
- `runtime.membership.clubs[clubId]` 保持为**当前归属的唯一真相源**（不破坏 D-19）。
- **历史归属不写入 membership**；由 **Competition Season 最终排名 + 升降级结果** 归档**派生**。
- 升降级迁移必须经**新增的受控 Domain 写入口**；**禁止**绕过 membership 层直接改写归属。

### D38.4 Promotion / Relegation 归属与执行 `[已定]`
- **规则归属 = Country / World 层**；规则**数据化**（见 D38.5）。
- **执行时机 = 两阶段**：① 赛季结束 → 生成 Promotion/Relegation 结果；② 下一赛季开始 → 迁移 membership → 生成新赛程。
- **结果纯派生**：可由「上季各 Division 最终排名 + 规则」**确定性重算** ⇒ **不新增持久 transition 字段**（降低 Save 风险）。
- **确定性**：无 RNG / 时间 / 未排序遍历依赖；同 `(World + Save + Season + Input)` 必得同结果。

### D38.5 Competition Rules 数据驱动 `[已定]`
- **Engine Rule（固定，写代码）**：Round-Robin / Knockout 算法、排名计算、确定性 tiebreak 机制、赛程生成算法。
- **World Data Rule（写 `.fdb`）**：`pointsForWin/Draw/Loss`、`promotionSpots`、`relegationSpots`、`playoff`、tiebreak 顺序、`tier`、赛程参数。
- **目标**：年度 `.fdb`（2027/2028/…）可改变真实赛事规则而**不重写模拟引擎**。

### D38.6 多赛事 Season Boundary `[已定（架构约束）]`
- 现有"取 id 升序首个 competition"判定赛季边界（Step 38A **H2**）**必须泛化**：赛季滚动须支持**多个 Competition 的独立完成判定 + 世界级推进**。
- 本步**仅冻结约束**；实现属后续步骤。

### D38.7 Save / Schema `[已定]`
- **Schema 10 / Save Format 1 保持**；新增 Competition / Division / Season 结构一律**加法式 + 读档 normalize**。
- **不新增**升降级 transition 持久字段（结果纯派生）。
- Competition 主键**向后兼容**（保留 `leagueId` 兼容键，避免旧档失效）。

### D38.8 Phase 1 最小金字塔范围 `[已定]`
- **纳入**：多 Division（多层级）、Promotion、Relegation、membership 迁移、Competition Season（逻辑）、Competition Rules 数据化、多赛事 Season Boundary 修复。
- **不纳入（Deferred / 扩展）**：Playoff、Domestic Cup、Continental、Qualification（保留接口，不在 Phase 1 实现）。

### D38.9 不破坏冻结系统 `[已定]`
- **DDTI C1 不变**（多 Division 不改变世界人口 `96–112` 与 DDTI 机制；DDTI 不引入 league 维度）。
- **Finance Feedback 不变**；**Transfer Domain 不变**；**Match / Team Strength 不变**。
- **Golden `143/143/1141` 必须保持**；现有 **336** 测试不得回退。

### D38 附：Step 38A 已确认的关键事实（供实现参考）
- Competition 主键 ≡ League ID（`runtime.competitions[league.id]`）；Club→League **单值、无写入口**；Fixture/Standings 内嵌于 competition（靠 id 字符串 / 存放位置隐式关联）；`getSeasonCalendar` 取**首个** competition（H2）；唯一已有 league 依赖点为 `ai-need` 的联赛基线（**派生读取，天然适配升降级**）。

---

## D-38D Competition Structure Phase 1 Final Freeze（Step 38C 实现审计 / Step 38D 最终冻结）

> 本步（Step 38D）为 **DOCS-ONLY FINAL DECISION FREEZE**：**未修改任何 `src/` 代码 / `tests/` / `.fdb` 世界数据 / Schema 10 / Save Format 1**，**未 commit**。
> 依据：Step 38B 冻结的 D38.1–D38.9 + Step 38C READ-ONLY IMPLEMENTATION AUDIT。本步**不重开** D38.1–D38.9。

### D38D.1 World Season 采用「同步世界赛季」`[已定]`
- **Phase 1 World Season 同步推进**。**World Season Boundary = 所有参与 World Season 的 League-format Competition 均完成当前赛季，且满足现有 season calendar 的完成条件。**
- **禁止**：① 某一个 Competition 单独触发 World rollover；② Competition A rollover 后等待 Competition B；③ Competition B 使用已被 A 修改过的 membership 再决定自身 Promotion/Relegation。
- **Phase 1 暂不支持独立异步 Competition Season lifecycle**。原因：`state.season` 仍为 World-level scalar，且尚无真正独立的 Competition Calendar / Competition Season lifecycle。
- 未来引入 Cup / Continental / 跨赛季赛事时，再单独设计 **Competition-level lifecycle**。

### D38D.2 World Season Participants `[已定]`
- **Phase 1：World Season Participants = 当前 World 中全部 League-format RoundRobin Competitions**（由现有 `leagues` 数据派生）。
- **不新增** `participatesInWorldSeason` 之类独立 `.fdb` 标记（Phase 1 无 Cup / Continental / 独立 Competition Calendar，提前增加属过度建模）。
- 参与者枚举必须 **deterministic**：**不依赖 `Object.keys()` 未排序结果**；按**稳定 ID 排序**后处理；**空 World / 空 Competition 集合行为必须明确**。
- 未来 Competition 类型真正扩展时，再设计 **Competition Calendar Participation**。

### D38D.3 Division 与 Competition 的 Phase 1 数据边界 `[已定]`
- **Phase 1 不新增** `divisions.json` / `competitions.json`；**继续复用 `leagues.json`**。
- 语义定义：**`leagues.json` entry = 逻辑 Division + Phase 1 对应的 League Competition 定义**。
- `league.id` 在 Phase 1 **同时承担** `divisionId` 的兼容实现与 `competitionId` 的兼容实现。
- **概念层**：`divisionId` / `competitionId` **语义须明确区分**；**存储层**：`leagueId`；**当前二者一一对应**。
- **不因语义分离而修改 Save Format**；**不批量迁移**旧 `membership.clubs` 的 `leagueId` 值；**不创建伪造的独立 Division runtime entity**。
- 未来进入 Cup / Continental / 多 Competition 同层并存时，再考虑 `divisions.json` / `competitions.json` 或其他显式实体化方案。

### D38D.4 Promotion/Relegation Planner 必须全局计算 `[已定]`
- **两阶段模型**：**Phase A 纯 planner**（输入：上赛季所有相关 Division 的最终 standings + World Data Rules + tier/adjacent 信息 → 输出 `PromotionRelegationPlan`）；**Phase B 统一 apply**（顺序：① planner 生成完整 Plan → ② 全局校验 Plan → ③ **一次性**修改 membership → ④ `validateMembership` → ⑤ 生成下一赛季 Competition runtime / fixtures）。
- **禁止**：`D1 planner → apply D1 → D2 planner → apply D2 → …` 的链式顺序依赖；**必须**"所有 Division 读取旧赛季最终状态 → 生成完整 Plan → 一次性 Apply"。
- **Invariants（冻结）**：
  - 一个 club 在一次 transition 中**最多移动一次**；
  - 不允许 `fromDivisionId === toDivisionId`；
  - 不允许不存在的 `clubId` / `fromDivisionId` / `toDivisionId`；
  - Apply 前必须验证 source membership 与 Plan 一致；
  - Apply 后必须验证 membership 全局合法；
  - 同一 club 不得同时 promotion + relegation；
  - 不得出现重复 movement；
  - 不得产生非法 tier；
  - **top tier 不得 promotion**；
  - **bottom tier 不得 relegation**；
  - **只允许相邻 Division 迁移**；
  - 不允许跨两级直接跳 tier；
  - 所有 movement 必须 **deterministic**。

### D38D.5 Division 邻接规则 `[已定]`
- Phase 1 **只允许相邻 tier**（`Tier 1 ↔ Tier 2`、`Tier 2 ↔ Tier 3`）；**禁止** `Tier 1 → Tier 3` / `Tier 3 → Tier 1`。
- 相邻关系优先由 **`countryId + tier`** 确定；**Phase 1 不强制新增 `parentDivisionId`**。
- 若同一 Country 内出现**相同 tier / 非连续 tier**，必须由 **World Data validation 明确拒绝**非法配置，**不得运行时猜测**。

### D38D.6 Promotion / Relegation 名额 `[已定]`
- 每个相邻 Division pair 使用确定性的 `promotionPlaces` / `relegationPlaces` 规则。
- **Phase 1 不实现**：playoff / playoff promotion / playoff relegation / best-loser compensation / special survival / registration-based movement / financial eligibility / license-based movement。
- **Engine 默认值**（未提供配置时）：`promotionPlaces = 2`、`relegationPlaces = 2`。且必须满足：
  1. top tier 的 `promotionPlaces` **实际效果为 0**；
  2. bottom tier 的 `relegationPlaces` **实际效果为 0**；
  3. 名额**不能超过** source Division 实际参赛 Club 数；
  4. 名额**不能造成重复移动**；
  5. 名额不足时 **deterministic clamp**；
  6. invalid（负数 / NaN / 非整数）配置必须**被拒绝或规范化为安全默认值**；
  7. **不允许通过补人机制人为制造额外 Promotion/Relegation**。
- 本规则**只定义 Phase 1 自动升降级**，不扩展到 Playoff。

### D38D.7 Ranking / Tiebreak `[已定]`
- Phase 1 **不**把完整 tiebreak 做成复杂 World Data DSL；继续保持当前 **Engine 确定性基础**：① `points` ② `goalDifference` ③ `goalsScored` ④ `clubId` deterministic tie-break。
- World Data 未来可覆盖排序规则，**Phase 1 不实现复杂可编程排序**。若在 `.fdb` 增加字段，必须 **additive optional**，缺失时使用上述 Engine 默认。
- **不得**引入脚本化规则 / 表达式语言 / 任意排序函数。

### D38D.8 Rules 字段 `[已定]`
- Phase 1 允许 `leagues.json` 增加**可选** `rules`，**最小允许范围**：`{ promotionPlaces?, relegationPlaces? }`；**可选保留**：`pointsForWin? / pointsForDraw? / pointsForLoss?`（仅当实现确需时才写）。
- **暂不加入**：`playoffRules` / `cupRules` / `qualificationRules` / `continentalRules` / `registrationRules` / `financialRules` / `reputationRules`。
- 原则：**Rules 只描述 Phase 1 当前真正需要的数据**。

### D38D.9 Membership API `[已定]`
- Promotion/Relegation **优先使用批量原子 transition API**：概念名 `applyPromotionRelegationTransition(state, plan)`，职责：① 校验完整 Plan；② 校验 source membership；③ 校验 club 唯一移动；④ 校验 from/to Division 合法；⑤ 校验 tier adjacency；⑥ 应用全部 membership changes；⑦ 执行 `validateMembership`；⑧ **任意校验失败则不得产生部分修改**。
- **不推荐**在 Promotion/Relegation 主流程中逐个直接调用 `applyClubDivisionMembership(...)`；单条 API 可存在供未来其他受控 Domain 使用，**主路径必须用 batch atomic API**。
- 命名若在实现阶段调整，可保持同一语义，但 **atomic / deterministic / all-or-nothing** 要求**不得改变**。

### D38D.10 Season Rollover 最终顺序 `[已定]`
```
每日：advance date → tick injuries → play due fixtures for all competitions → update competition status
World Season Boundary：
  → 确认所有 World Season Participants 已完成
  → 固化所有相关 Competition 最终 standings
  → 生成完整 Promotion/Relegation Plan
  → 全局校验 Plan
  → atomic membership transition
  → validate membership
  → 创建下一赛季 Competition runtime
  → 生成下一赛季 fixtures
  → archive / update season history
  → 推进 state.season
  → developPlayers → player lifecycle → replenishTransferBudget → Finance Feedback
    → runSeasonAI → repairManagedLineups → resetSeasonStats
```
- **红线**：Promotion/Relegation **必须发生在 `createLeagueRuntime` / fixture generation 之前**；**AI 必须在新 Division membership 生效之后运行**；DDTI / Finance / Transfer **不因 Division transition 改变其规则**。

### D38D.11 Fixture `competitionId` `[已定]`
- Phase 1 **可以**为 fixture 增加**可选** `competitionId`（作为显式语义归属），但**不得强制重构现有 fixture ID**。
- 兼容：旧 `fx_{leagueId}_s{season}_r{round}_{idx}` **继续有效**。
- **不改变 Match Engine**；**不要求**重新设计 fixture ID；**不升级 Save Format**；**不强制**把旧 fixture 迁移为新 ID。
- 若实现阶段发现增加 `competitionId` 的成本明显高于收益，**可暂缓**到 Cup/Continental 引入阶段。

### D38D.12 Save / Migration `[已定]`
- **Schema = 10；Save Format = 1；不升级。**
- 旧 Save 必须：保持 **membership 为当前归属真相源**；保留旧 **`leagueId` 兼容**；新 Rules 缺失时**使用默认**；新 optional 字段缺失时 **normalize**；**不尝试**让 `static teams[].leagueId` 与 runtime membership 自动同步；**不生成** transition history 持久对象；**不保存** Promotion/Relegation Plan；**不保存**中间 rollover 状态。
- **Transition Plan 是临时运行时对象**。

### D38D.13 失败与边界语义 `[已定]`
- 若 Promotion/Relegation Plan 非法：**整个 transition 失败**。**不得**：部分升降级 / 部分写入 membership / 自动随机修复 / 随机选择替代 Club / 修改 standings / 修改 static world data。**错误应可诊断**。
- 若 World Data 存在非法 Division 配置（同 country 同 tier 重复 / tier 不连续 / promotion·relegation 配置非法 / club membership 不属于有效 Division）：应在 **world validation / transition validation** 阶段**明确失败**。**禁止运行时静默猜测**。

### D38D.14 Golden / 回归不变量 `[已定]`
- **Golden `143/143/1141`**；**测试基线 `336/336`**。
- 实现阶段必须保持：单 Division 行为与当前版本**等价**；单联赛 Season Boundary 行为**等价**；**DDTI C1 / Finance Feedback / Transfer Domain / Match Engine / Team Strength / Schema 10 / Save Format 1 不变**。
- 实现后**必须新增**测试：Two Division promotion、Two Division relegation、Multi Division chain、Top tier boundary、Bottom tier boundary、deterministic transition、atomicity、duplicate movement rejection、multi-competition season boundary、old save migration、membership invariant regression、long-run multi-division simulation。

### D38D — Deferred（明确不在 Phase 1）`[Deferred]`
- Playoff、Domestic Cup、Continental、Qualification、Complex competition stages、Youth/Reserve、Staff、Scout、Reputation、Revenue/Sponsor/TV/Prize、Loan、Registration Rules、Club licensing、Financial fair play、promotion history entity、CompetitionSeason persistent entity。
- 未来真正需要时，重新设计（含 Competition-level lifecycle / Competition Calendar Participation / 显式 division·competition 实体化）。

---

## Deferred Issues（登记；不在本步骤处理）

### DF-01 Managed Club Cash Concentration / World Finance Feedback `[Resolved → Step 36C 冻结]`
- **现象**：存在 `managedClubId` 时，AI clubs 可持续购买 managed club 球员，而 managed club 不参与 AI spending；**cash 长期单向集中**到 managed club，最终使 AI clubs `cash → 0` 并**冻结市场**。（Step 35D 实测：500 季后 8000 总现金中 7961 集中于 managed club。）
- **已确认归属**：Finance / managed-club feedback 问题。**不是** DDTI supply 问题、**不是** Transfer Domain validation 问题、**不是** SELL 资格问题、**不是** Match / Team Strength 问题。
- **当前处理**：**DEFER 到 Step 36**（Step 36 单独进行 read-only audit + decision freeze）。
- **本步骤（35E）不得修改**：D-33.8（cash 不再生）、finance cash regeneration、transfer fee formula、managed club AI exemption、AI club spending、league revenue、wages、transfer budget。
- **备注**：纯 AI 世界（无 managed club）不出现该问题（Step 35D 500 季 `maxConsecZeroTransfer = 0`），进一步佐证其为 managed-club 财政反馈问题。
- **冻结结论（Step 36C）**：已通过 [D-36 Managed Finance Feedback](file:///workspace/docs/DECISIONS.md) 正式冻结解决方案（**CF-E2：threshold = 35% / redistribution = 20% 的守恒再分配**）。机制为 **DOCS-ONLY 冻结**；**生产实现待 Step 36D**。

---

## 仍属 TBD（未受影响）

- GAME_DESIGN：T1、T2、T3、T4、T5、T7–T13、T15、T16、T17
- DATABASE_SPEC：D1、D2、D3、D5、D8、D9、D11、D12
- SIMULATION_SPEC：S2–S11、S13（S12 口径已定，见 D-12）
- SAVE_SPEC：V1–V9、V11
- ROADMAP：R1（见 D-09 暂定）、R2、R4、R5、R6

详见各 SPEC 的 TBD 汇总表。