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
  - **人口**：`target(club) = 世界创建时该队初始球员数`（快照于 `runtime.populationTarget`，含按位置明细）；
    生效目标 = `max(初始位置数, 阵型最低需求)`，且 **GK ≥ 1/队**；只生成不删除；**不引入自由球员池**；不无控增长。
  - **架构**：保持 `static.players` 只读；新生代落 `runtime.generated`（含 `teamId`）；退役落 `runtime.retired`（保留 career/终值快照）；
    引入**统一世界球员访问器**（`getWorldPlayers` / `getTeamPlayers` / `getPlayerProfile` / `isRetired`），
    既有 4 模块 9 处直读 `state.static.players` 全部迁移到访问器。
  - **ID**：新生代用独立命名空间 `ply_g_<全局递增序号>`；退役 playerId **永久失效、永不复用**；禁用显示名作主键。
  - **开关**：`RETIREMENT_CONFIG.ENABLED`（默认 true）；false 时完全跳过退役与新生代，**结构不变**，行为回到第 18 步。
- **运行时新增字段**：`generated`、`retired`、`nextGeneratedSeq`、`populationTarget`；`GAME_STATE_SCHEMA_VERSION` 4→5（加法式）。
- **接线**：`simulation.js` 赛季滚动顺序 = 结算成长 → 退役+归档 → 计算缺口并生成 → 重置赛季统计 → 进入下一赛季。
- **实测（MVP 世界 8 队，10/50/100/200 赛季）**：总人口恒 112、GK 恒 8、无重复 ID、年龄均值 22–27、
  base 均值 54.2→54.6/53.8/54.1、potential 均值 62.2→62.5/61.9/62.1（**不坍缩、不膨胀**）、退役≈新生（108/108、221/221、454/454）。
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
- **D4 Contract Duration** `[已定]`：期限用**整数赛季**；v1 **不做自动续约**。
- **D5 Wage Unit** `[已定]`：工资以**每赛季工资**记录，且属**合同属性**。
- **D6 Finance** `[已定]`：`club.finance = { cash, wageBudget, transferBudget }`；**只有 cash 是实际货币余额**，
  wageBudget / transferBudget 为**约束**，**不作为额外现金余额**。
- **D7 Squad Size** `[已定]`：引入俱乐部阵容人数 **lower/upper bound**；转会 / 释放 / 生成球员均须遵守；
  **不允许**人口补充系统因一次转会/释放就立即恢复到固定 112。
- **D8 Transfer Fee** `[已定]`：v1 使用**确定性转会费模板**（依能力/年龄/位置等已有数据）；暂不建独立 player value / market value 系统；**不新增随机数源**。
- **D9 Transfer Window** `[已定]`：v1 **转会窗口永久开放**；暂不实现夏窗/冬窗限制。
- **D10 Generated Player Contract** `[TBD]`：**暂不锁定**（原因见下）。
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

## 仍属 TBD（未受影响）

- GAME_DESIGN：T1、T2、T3、T4、T5、T7–T13、T15、T16、T17
- DATABASE_SPEC：D1、D2、D3、D5、D8、D9、D11、D12
- SIMULATION_SPEC：S2–S11、S13（S12 口径已定，见 D-12）
- SAVE_SPEC：V1–V9、V11
- ROADMAP：R1（见 D-09 暂定）、R2、R4、R5、R6

详见各 SPEC 的 TBD 汇总表。