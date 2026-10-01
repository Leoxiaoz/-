# ROADMAP — 开发路线图

| 项 | 值 |
|---|---|
| 状态 | Draft v0.1（规划阶段，未进入实现） |
| 更新日期 | 2026-09-28 |
| 依据 | 制作流程第 10 步；项目规则「增量开发 / 测试必选 / 不擅自扩大范围」 |
| 关联文档 | GAME_DESIGN.md / DATABASE_SPEC.md / SIMULATION_SPEC.md / SAVE_SPEC.md |

---

> **决策更新（2026-09-28，第 14 步）**：部分 TBD 已裁决（详见 `DECISIONS.md`）。
> **R3** 稳定目标 = **50 赛季基础压力测试，保留更高赛季测试能力**（A8）。
> 其余 `[TBD]` 仍然有效。

## 0. 文档定位与边界

本文件回答一个问题：**先做什么，后做什么。**

- 本文件定义：五个阶段的**目标、范围、交付物、依赖关系、验收口径**。
- 本文件**不**重复各系统的设计细节（见对应 SPEC 文档）。
- 核心红线：
  - **不为了"看起来完整"而增加功能。**
  - 显著影响架构 / 数据结构 / 存档兼容 / 模拟的设计，**先标 TBD 并请制定者决策**。
  - 每阶段结束时系统必须**可测试**，不只"在 UI 里能跑一次"。
  - 不擅自引入多人在线 / 变现 / 3D / 社交 / 云账号等未获批准内容。

### 标记约定

- `[已定]` / `[TBD]` / `[建议]` 同前。

### 通用流程（每阶段内部）`[已定]`

1. 设计 → 2. 定数据结构 → 3. 实现核心逻辑 → 4. 写测试 → 5. 测边界 → 6. 接 UI → 7. 再测 → 8. 更新文档。

---

## 1. 第一阶段：最小可玩版本（MVP）

**目标**：验证"数据 → 世界 → 比赛 → 结果"这条最小闭环能跑通，且架构分层正确。

- 范围（候选，**需与制定者确认后再细化**）：
  - 引擎骨架与分层边界（核心逻辑 / 数据层 / UI 分离）`[已定原则]`。
  - 最小数据库加载（单一 `.fdb`，最少实体）。
  - 最小比赛模拟（已定 A2：时段制）。
  - 单联赛赛程、积分、单赛季推进。
  - 极简 UI：能看到球队、球员、赛程、结果。
  - 最小存档：能存/读当前日期与比赛结果。
- 依赖：`SIMULATION_SPEC` T6 已定（A2 时段制）；仍需决策 `DATABASE_SPEC` 实体最小集、`GAME_DESIGN` T1。
- 交付物：可运行的第一代客户端原型 + 对应单元测试 + 文档更新。
- 验收：同一（库+档+种子）比赛结果可复现；存读一致；无魔法数字散落。

### 1.1 已交付（2026-09-29，MVP 第一切片）

- 暂定范围（DECISIONS D-09）：**仅比赛闭环**，不含转会/合同/财政。
- 已实现：赛程生成、四维球队实力、时段制单场模拟、积分榜、单赛季推进与赛季滚动（归档上季积分榜）、存读一致。
- 已交付测试：RNG 确定性、赛程正确性（含奇数队轮空）、实力梯度、单场可复现、积分守恒、整赛季、多赛季滚动、存档往返、数据校验、比分分布校准护栏（共 46 项全通过）。
- 已交付数据：`data/worlds/mvp-league.fdb`（单联赛 8 队双循环，球员带属性），引擎不依赖该具体库。
- 已交付 UI：积分榜、上赛季最终排名、最近赛果、推进一天/一周、保存/读取。
- **比分分布（D-12）**：大样本实测场均总进球 ≈2.79，已在现实区间 → **S12 口径已定、无需调参**。
- `[TBD]` 待制定者覆盖：D-09/D-10/D-11/D-12 为**暂定默认值**。

---

## 2. 第二阶段：核心系统

**目标**：把 GAME_DESIGN 认定的"四个核心"中的基础部分立起来。

- 范围（候选）：
  - 球员成长（训练、比赛经验、年龄、职业素养…）→ 能力变化。
  - 转会（"需求+意愿+合同+身价+工资+声望+竞争+经纪人 → 谈判"的简化版）。
  - 合同（薪资、年限、到期、续约）。
  - 财政基础（收支与约束，防崩防通胀）。
  - 战术系统（T5 最小集合）。
  - 教练与工作人员（视 T11 决策）。
- 依赖：第一阶段架构与存档机制稳定后再扩展；数据结构变更需带迁移（`SAVE_SPEC` §5）。
- 交付物：核心系统模块 + 单元/集成测试。
- 验收：单赛季内核心系统闭环；存档跨版本仍可读写。
- `[TBD]` R2：四个核心（比赛/成长/转会/世界）在本阶段的完成度目标。

### 2.1 已交付（2026-09-29，第 15 步：球员运行时状态）

- 目标：在静态球员库之上建立**独立的 Player Runtime State**，为后续成长/伤病/合同/转会/战术**预留接口**。
- 已实现：`src/core/player-runtime.js`——创建/读取/修改接口；`getEffectiveAttributes`（完整属性向量，非单一总评）；
  `recordAppearance`（本赛季+职业生涯统计）、`setVitals`、`applyInjury/recoverInjury`、`applyAbilityDelta`、
  `resetSeasonStats`；`createGameState` 为全部球员建状态；赛季滚动重置本赛季统计；读档自动补齐（保留已有值）。
- **刻意未做**：成长算法、伤病生成/恢复算法、体能/状态/士气更新模型（均属 `[TBD]`，S2–S11/S13）。
- 已交付测试：`tests/player-runtime.test.js` 19 项（创建/读取/修改/存读往返/静态库冻结不变/向后兼容）。
  累计 **65/65 通过**。
- `[TBD]` 字段级口径（D-13 暂定）待制定者确认；`GAME_STATE_SCHEMA_VERSION` 1→2（加法式，向后兼容）。

### 2.2 已交付（2026-09-29，第 16 步：球员成长 / 衰退）

- 目标：按赛季结算的能力成长与年龄衰退，与比赛、年龄、潜力、伤病、状态/士气、人格兼容（D-14）。
- 已实现：`src/core/player-growth.js`；静态库新增 `birthDate/potential(每属性上限)/personality` 并**定为必填**；
  两个仓库内测试库已补齐；`simulation.js` 赛季滚动时先结算成长再重置赛季统计；`GAME_STATE_SCHEMA_VERSION` 2→3（加法式）。
- **刻意未做**：训练系统本体（仅预留修正接口）、退役/新生代/青训。
- 已交付测试：`tests/growth.test.js` 18 项；累计 **83/83 通过**。
- 长期护栏：真实库 50 赛季属性均值 51.6 → 9.0 **单调不升**；10/50/100 赛季无越界/NaN（D1/D2）。

### 2.3 已交付（2026-09-29，第 17 步：伤病生命周期）

- 目标：完善**伤病生命周期**（发生 → 每日递减 → 自动恢复 → vitals），并修复第 16 步的成长惩罚耦合问题（D-15）。
- 已实现：`src/core/player-injury.js`（赛后最小伤病判定、每日推进、vitals）；`sim-config.js` `INJURY_CONFIG`（8 类型、3 严重度，配置驱动）；
  `player-runtime.js` 扩展 `injury` 结构与定长 `injuryHistory`；`player-growth.js` **只消费** `growth.injuryPenaltySeasons`（不再自行推断）；
  `team-strength.js`/`simulation.js` 过滤伤病球员（空阵容保护）；`GAME_STATE_SCHEMA_VERSION` 3→4（加法式，向后兼容）。
- **刻意未做**：完整训练系统、首发/换人、青年队补位、紧急转会、医疗团队/设施、复杂康复、比赛内伤病事件链、无限伤病历史。
- 已交付测试：`tests/injury.test.js` 21 项（含整季 / 50 / 100 赛季压力）；累计 **104/104 通过**。

### 2.4 已交付（2026-09-29，第 18 步：赛季级球员生态联调）

- 目标：**打通已有系统闭环**（不新增玩法系统）——修复第 16/17 步审计发现的三处断点（D-16）。
- 已实现：`team-strength.js` 改用**有效属性**并新增 `selectMatchSquad`（出场集合，单一可替换点）；
  `simulation.js#playFixture` 接入出场/进球统计与赛后 fitness/form；`sim-config.js` 新增 `MATCH_LOAD_CONFIG`；
  健康体能改为**分数式**恢复。`GAME_STATE_SCHEMA_VERSION` **保持 4**（纯接线）。
- **刻意未做**：首发/替补/换人、训练本体、青年队、紧急转会、退役/新生代。
- 已交付测试：`tests/ecosystem.test.js` 16 项（含 10/50/100 赛季）；累计 **120/120 通过** + 浏览器冒烟通过。
- **已知范围**：无退役/新生代 → 长期世界均值与球队实力随老龄化单调回落（属既有成长/衰退规则）；退役 + 新生代 + 人口生态平衡保留为后续独立步骤。

### 2.5 已交付（2026-09-29，第 19 步：退役 + 新生代 + 世界人口生态平衡）

- 目标：为世界建立"退出/进入"通道，消除长期（50–100 赛季）世界均值坍缩（D-17）。
- 已实现：`src/core/player-lifecycle.js`（退役：年龄软区间线性概率 + 硬上限；新生代：同位置静态模板+三路独立抖动；人口补位）；
  `player-runtime.js` 新增**统一世界球员访问器**并把 4 模块 9 处直读 `static.players` 迁移；`game-state.js` 新增
  `generated/retired/nextGeneratedSeq/populationTarget` 且 `GAME_STATE_SCHEMA_VERSION` 4→5（加法式）。
- **刻意未做**：自由球员池、转会、合同、青训梯队、预备队、名人堂 UI、财政、教练、多联赛、完整伤病史、历史裁剪。
- 已交付测试：`tests/lifecycle.test.js` 19 项（含 10/50/100/200 赛季）；累计 **139/139 通过** + 浏览器冒烟通过。
- **长期护栏（实测 1/10/50/100/200 季）**：总人口恒 112、GK 恒 8、无重复 ID、均值不坍缩不膨胀、退役≈新生。

### 2.6 已交付（2026-09-29，第 20 步：玩家阵容 / 战术选择）

- 目标：建立「玩家管理球队 → 比赛 → 结果反馈」的**最小可玩闭环**（D-18）。
- 已实现：`src/core/player-lineup.js`（阵容槽位/校验/清洗/比赛修复/赛季自愈）；`team-strength.js` 新增
  `resolveMatchSquad`（玩家阵容 vs 自动选阵统一入口）、`buildAutoLineup`，`computeTeamStrength` 接收实际出场集合；
  `simulation.js#buildSide` 使用统一入口、赛季滚动调用 `repairManagedLineups`；`game-state.js` 新增
  `managedClubId`（默认 null）与 `clubs[].lineup`、`initializeClubRuntime`，`GAME_STATE_SCHEMA_VERSION` 5→6（加法式）；
  `game-controller.js` 新增阵容/战术 API 与快照；`app-view.js` + `main.css` 新增「我的球队」卡片。
- **刻意未做（out-of-scope）**：转会、合同、财政、工资、身价、球探、教练、青训、预备队、AI 转会市场、多联赛、
  升降级、杯赛、红黄牌、**换人引擎**、大规模比赛表现系统、名人堂、新闻系统。
- 已交付测试：`tests/lineup.test.js` 22 项（含 save/load、阵型/战术真实影响比赛、10/50 赛季）；累计 **159/159 通过** + 浏览器冒烟通过。

### 2.7 已交付（2026-09-29，G0：运行期成员关系层）

- 目标：把 player→club / club→league 从"主要依赖静态字段"升级为**统一、可变、可持久化的运行期唯一真相源**（D-19）。
  不新增玩法，仅为后续财政/转会/合同/AI/升降级/赛事扩展提供唯一基础。
- 已实现：`src/core/membership.js`（叶子模块）；`player-runtime.js` 访问器改经 membership（`getTeamPlayers`/`getPlayerProfile`
  归属、`computePopulationTarget`）；`game-state.js` 建世界时初始化 membership、`getTeamsByLeague` 经 membership；
  `player-lifecycle.js` 新生代入队 + 退役出队；`save-manager.js` 兜底；`game-controller.js` 读档校验 + 快照；
  `GAME_STATE_SCHEMA_VERSION` **6→7**（加法式）。
- **刻意未做（out-of-scope）**：转会、合同、自由球员、财政、工资、身价、AI 转会、升降级、多联赛、杯赛。
- 已交付测试：`tests/membership.test.js` 19 项（含 v6→v7 迁移、唯一真相源、顺序契约、10/50/100/200 赛季）；累计 **178/178 通过** + 浏览器冒烟通过。

### 2.8 已交付（2026-09-29，G1a：比赛球员参与结构）

- 目标：把"谁在 squadIds 里 = 出场 90 分钟"的隐式模型升级为统一的 `MatchResult.involvements`（D-20）。
  不新增玩法，不实现换人/评分/射门/控球/传球。
- 已实现：`match.js` 事件统一为 `actorId/assistId` + `buildInvolvements`；`simulation.js#applyPostMatch` 只消费 involvements；
  `player-runtime.js` 统计线新增 `yellow/red`，`recordAppearance` 消费 `minutes/goals/assists/yellow/red`；
  `GAME_STATE_SCHEMA_VERSION` **7→8**（加法式，唯一原因：统计线新增持久化 `yellow/red`）。
- **刻意未做（out-of-scope）**：换人/替补上场、临场战术、球员评分、射门/控球/传球、AI、转会、合同、财政、杯赛、多联赛、G1b。
- 已交付测试：`tests/involvement.test.js` 12 项（含黄金路径、确定性、save/load continuation）；累计 **190/190 通过** + 浏览器冒烟通过。

### 2.9 已交付（2026-09-29，G1b①：赛季日历 + 赛季边界驱动）

- 目标：把"某 competition `finished` → 推进 `state.season` → 执行全局副作用"的**隐式**约定，升级为显式的
  「SeasonCalendar + 赛季边界」模型；**单联赛下行为与改造前完全等价**（D-21）。仅改变"赛季边界的判断方式"与 rollover 编排。
- 已实现：新增叶子模块 `src/core/season.js`（`getSeasonCalendar` / `isSeasonBoundaryReached`，派生视图、不入档、无随机）；
  `simulation.js#rollFinishedSeasons` 改为**由边界驱动**（边界到达才归档/建新季/执行一次副作用；`advanceDay` 外部顺序不变）。
- **兼容红线**：`state.season` 字段名与持久化保留（单联赛 `state.season ≡ comp.season ≡ calendar.season`）；
  `SEASON_GAP_DAYS=30`、赛程轮转、fixture 日期、`deriveMatchSeed` 的 season 输入、growth/lifecycle RNG 全部不变。
- **存档**：`GAME_STATE_SCHEMA_VERSION` **保持 8**（派生视图，不新增持久化字段，无需迁移）。
- **刻意未做（out-of-scope，属 G1b②）**：多联赛、多 competition 并行、杯赛、淘汰赛、升降级、Competition Rules 数据化、
  多竞赛统一赛季边界、competition type dispatch、新 schedule 类型。
- 已交付测试：`tests/season.test.js` 11 项（SeasonCalendar 投影、边界 < / = / > / 空联赛、改造前基线指纹行为等价、
  副作用一次性与顺序、确定性、save/load 季中/边界前/边界日/新赛季后、10/50/100 赛季长期）；累计 **201/201 通过** + 浏览器冒烟通过。

### 2.10 已交付（2026-09-29，Step 21-A：球员比赛表现 MVP）

- 目标：在 G1a 统一 `involvements` 之上补齐**球员级比赛表现**（射门/射正/助攻/牌/评分），支撑赛后表现反馈与统计（D-22）。
- 已实现：`match.js#applyMatchPerformance`（**独立派生 RNG**，比分确定后生成，逐球员/逐进球独立流）；
  `sim-config.js` `MATCH_PERFORMANCE_CONFIG`（位置射门画像、助攻概率、牌概率、评分模型）；
  `player-runtime.js` 统计线新增 `shots/shotsOnTarget/ratingSum` 并支持 `recordAppearance` 消费；
  `simulation.js#applyPostMatch` 仅透传（不新增并行写入链）；`game-state.js` `GAME_STATE_SCHEMA_VERSION` **8→9**（加法式）。
- **红线（已证明）**：`rng.js`/`deriveMatchSeed`/比分算法**未改**；相同 seed 下 `homeGoals/awayGoals/goal events` 与实施前**逐值一致**；
  表现**不写回** form/morale/fitness/growth/retirement；守恒内建 `shots>=shotsOnTarget>=goals`、`Σassists<=Σgoals`。
- **刻意未做（out-of-scope）**：keyPasses、xG、possession、pass%、比赛报告、Man of the Match、UI 展示、
  表现影响 form/morale/growth/retirement、换人/替补、新能力属性/能力体系；转会/合同/工资/财务/AI 教练/多联赛/杯赛/升降级。
- 已交付测试：`tests/performance.test.js` 11 项（单场确定性、比分/射门守恒、助攻合法性、cards 有界、rating 边界与累计、
  season/career 累计与 reset、save/load 含 schema 8→9 与旧档补 0、RNG 隔离黄金指纹、10/50/100 赛季长期）；累计 **212/212 通过** + 浏览器冒烟通过。

### 2.11 已交付（2026-09-29，Step 21-B：球员表现数据消费层）

- 目标：把 21-A 已持久化的球员 `season/career` 表现接入 **controller 快照 → UI**（**仅消费层，方案 A**，D-23）。
- 已实现：`player-runtime.getPlayerStatsView`/`deriveAverageRating`（只读派生视图，安全规范化，返回新对象）；
  `game-controller#managedClubView` 球员条目新增 `stats`；`app-view` 新增紧凑可换行的**赛季统计行**；`styles/main.css` 适配。
- **展示**：管理球队阵容每名球员展示 `出场/进球/助攻/射门/射正/评分`（黄/红为次级）；`评分 = ratingSum/appearances/10`，
  无出场显示 `—`（无 NaN）；`ratingSum` **不外泄**，UI 不自行计算。
- **红线**：schema **保持 9**（无迁移）；无 match history / 逐场持久化 / 排行榜 / 球员详情页；UI 不直读 state；
  21-A 模型 / RNG / 评分公式 / 比分 / standings / 统计产生逻辑**均未改动**。
- 已交付测试：`tests/consumption.test.js` 10 项（season/career 读取、averageRating 与 `appearances=0`、ratingSum 不外泄、
  `shots>=shotsOnTarget`、旧字段 normalize、快照与 runtime 无引用共享、非管理球队不展示、lineup/injury 不受影响）；累计 **222/222 通过** + 浏览器冒烟通过。

### 2.12 设计冻结（2026-09-29，Step 23：Contract / Finance / Transfer 语义地基）

- **性质**：**纯设计冻结，无代码 / 无 schema / 无数据 / 无测试变更**（schema 仍为 **9**）。决策编号 **D1–D20**，详见
  [DECISIONS D-24](file:///workspace/docs/DECISIONS.md) 与 [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §30。
- **已冻结 `[已定]`（D1–D9、D11–D20）**：membership 为唯一业务真相；`runtime.contracts[playerId]`（单 active、整数赛季、每赛季工资、不自动续约）；
  允许 active free agent（**不得**形成三套并列真相）；`club.finance={cash,wageBudget,transferBudget}`（**仅 cash 为余额**）；
  俱乐部阵容上下限；确定性转会费模板；转会窗口永久开放；退役清合同；schema 9→10 迁移方案；
  **v1 工资不从 cash 扣除**；统一 domain operation 层；AI 复用同一 domain ops；**人口政策与世界/俱乐部保护分离**（废弃精确恢复 112）；
  读档不变量校验；**不新增随机源**。
- **仍待定 `[TBD]`（D10）**：生成球员的合同语义（入队+初始合同 / 先自由身 / 模板继承），须与青年队 / 自由球员市场 / AI 转会一并决定。
- **下一步（未开始）**：Contract + minimal Finance → Transfer → AI Management（依赖 [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §30）。

### 2.13 已交付（2026-09-29，Step 25：合同 / 财政地基）

- **目标**：按 Step 23 冻结的 D1–D20 落地 **Contract Foundation + Finance Foundation**（Transfer / Free Agent 生效 / Population 政策均**不含在内**）。
- **已实现**：新增 [contract.js](file:///workspace/src/core/contract.js)（`runtime.contracts[playerId]`、accessor、`createContract`/`terminateContract`、
  `normalizeContracts`、`assertContractInvariants`）与 [finance.js](file:///workspace/src/core/finance.js)（`clubs[].finance`、`getSpendableCash`、
  `normalizeFinance`、`assertFinanceInvariants`）；`game-state.js` 归一化+校验；`game-controller#load` 读档补齐+断言；
  `player-lifecycle#archiveRetired` 保存最终合同快照并终止合同；`sim-config.js` 新增 `CONTRACT_CONFIG`/`FINANCE_CONFIG`。
- **schema**：`GAME_STATE_SCHEMA_VERSION` **9→10**（加法式）；旧档经确定性 normalize 补齐；`SAVE_FORMAT_VERSION` 未改。
- **确定性**：合同/财政全为确定性模板（**无新增随机源**）；整季比赛黄金指纹（143/143/1141）不变。
- **明确未做**：Transfer、Free Agent **运行时生命周期**、release、roster bounds、Population 政策（D16）、工资现金扣除、
  生成球员合同最终语义（**D10 仍 TBD**）、AI、UI。
- 已交付测试：`tests/foundation.test.js` 16 项（合同/财政/迁移/不变量/确定性/长期）；累计 **238/238 通过** + 浏览器冒烟通过。

### 2.14 已交付（2026-09-30，Step 26B：Population Health + Club Roster Bounds）

- **目标**：落地 D16——**废弃「每赛季精确恢复到 112」**，将 **World Population（最低边界）** 与 **Club Roster（上下限 + 位置最低保障）** 分离。
- **已实现**：`sim-config.js` 新增 `ROSTER_CONFIG`（`MIN_PLAYERS=12 / MAX_PLAYERS=24 / PREFERRED_PLAYERS=14`（软偏好）/ `MIN_GK=1` /
  `MIN_BY_POSITION={DF:4,MF:4,FW:2}`）与 `WORLD_MIN_POPULATION=96`（有效世界下限 `min(96, clubCount×MIN_PLAYERS)`）；
  `player-lifecycle.js` 重写 `replenishPopulation`（边界驱动）并新增 `evaluatePopulationHealth`（World/Club 双职责）。
- **语义**：World 只判「是否缺人」；Club 只判「是否低于下限/位置保障」；**超 MAX 仅诊断、不裁员**；`PREFERRED_PLAYERS` 为软偏好非硬目标；
  `runtime.populationTarget` **退出人口业务逻辑**（legacy 快照保留）；生成**绝不创建无归属 active 球员**。
- **schema**：**保持 10**；`SAVE_FORMAT_VERSION` 保持 1。**确定性**：未新增 RNG；比赛/成长/伤病黄金指纹不变。
- **验证**：`247/247` 测试通过；10/50/100/200 赛季长跑通过（人口稳定于 96，非 exact-112，无坍缩/无膨胀）；Save/Load + 浏览器冒烟通过。
- 详见 [DECISIONS D-17 人口条目](file:///workspace/docs/DECISIONS.md)（Step 26B 更新）与 [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §23。

### 2.15 设计冻结（2026-09-30，Step 27A：Free Agent + Membership Integration）

- **性质**：**纯设计冻结，无代码 / 无 schema / 无数据 / 无测试变更**（schema 仍为 **10**，`SAVE_FORMAT_VERSION` 仍为 **1**）。
  决策编号 **D-26**，详见 [DECISIONS D-26](file:///workspace/docs/DECISIONS.md) 与 [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §32。
- **已冻结 `[已定]`**：Free Agent 真相 = `runtime.contracts[playerId]`（`status='free_agent'`、`clubId=null`、`wage=0`、`startSeason=endSeason=进入自由身的赛季`）；
  membership 以 **`players[id]=null`** 表示无俱乐部（**禁止 delete key**，避免 `initializeMembership` 依 `static.teamId` 重播种）；
  Active player 仅两态（Club-attached / Free Agent）；**Free Agent 计入 world population、不计入 club roster / team strength / lineup**；
  继续参与 lifecycle（growth/injury/retirement）；**release 不立即生成**（仅真实 deficit 才补位，优先复用 Free Agent）；
  `MAX_PLAYERS` 双重语义（Population 仅诊断 / Signing 硬上限，拒绝签约）；**不升级 schema**。
- **Deferred（非 Step 27 blocker）**：**D10**（生成球员合同语义）——`generatePlayer()` 维持「直接入 club、暂可能无 contract」，本阶段不冻结。
- **下一步（未开始）**：**Step 27 Implementation** —— `releasePlayerToFreeAgent()` / `signFreeAgent()`（未实现）；再进入 **Step 28 Transfer**。

### 2.16 已交付（2026-09-30，Step 27B：Free Agent + Membership Integration）

- **目标**：落地 D-26——实现 Free Agent 运行时（release / signing），保持 membership / contract / population / lifecycle / lineup / save-load 职责边界清晰。
- **已实现**：新增 [free-agent.js](file:///workspace/src/core/free-agent.js)（`releasePlayerToFreeAgent` / `signFreeAgent` / `getFreeAgents` /
  `selectFreeAgentForPosition` / `assertFreeAgentInvariants`）；[membership.js](file:///workspace/src/core/membership.js) 允许显式 `null`
  （`setFreeAgentMembership` / `isFreeAgentMembership`，`initializeMembership` 对已有 key 不重播种）；[contract.js](file:///workspace/src/core/contract.js)
  新增 `updateContract` / 导出 `validateContractShape` 并补 FA-INV-13/14；[player-lifecycle.js](file:///workspace/src/core/player-lifecycle.js)
  补位**优先复用现有 Free Agent**，不足才 generation；`controller.load` 追加 `assertFreeAgentInvariants`；快照/UI 增 `freeAgentsCount`。
- **Free Agent 表达**：`contract{status:'free_agent', clubId:null, wage:0, startSeason=endSeason=当前赛季}` + `membership.players[id]=null`（**无第三套容器**）。
- **语义**：Free Agent **计入 world population**、**不计入** club roster / team strength / lineup / match；继续参与 lifecycle；**release 不立即生成**。
- **schema**：**保持 10**；`SAVE_FORMAT_VERSION` 保持 1；未新增 RNG；比赛黄金指纹（143/143/1141）不变。
- **验证**：`tests/free-agent.test.js`（A–Z + 不变量 + Controller）；累计 **270/270 通过**；10/50/100/200 赛季长跑不变量全通过；Save/Load + 浏览器冒烟通过。
- **仍未实现（Step 28+）**：Transfer / 转会费 / Contract Expiry / 续约 / AI 转会 / 签约费 / 工资现金流 / **D10（Deferred）** / Free Agent 市场 UI。
- 详见 [DECISIONS D-26](file:///workspace/docs/DECISIONS.md) 与 [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §32。

### 2.17 设计冻结（2026-09-30，Step 28A：Transfer System v1）

- **性质**：**纯设计冻结，无代码 / 无 schema / 无数据 / 无测试变更**（schema 仍 **10**，`SAVE_FORMAT_VERSION` 仍 **1**）。
  决策编号 **T1–T30**，详见 [DECISIONS D-27](file:///workspace/docs/DECISIONS.md) 与 [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §33。
- **已冻结 `[已定]`**：Transfer = Club A→B 的**原子交易**（一次性改 Membership / Contract / Finance / Seller Lineup）；
  **确定性能力定价**（`Base × Ability × Age × Position`，纯函数、无 RNG、不读 cash/budget/squad）且 `MIN=0` / `MAX` 由 `sim-config` 定义；
  buyer `fee ≤ min(cash, transferBudget)`、buyer `cash & transferBudget -= fee`、seller `cash += fee`（budget 不增）；
  旧合同 terminate + 新 active 合同（模板条款）；**不建 contract/transfer history**；seller 允许暂 <MIN、**GK 硬保护**；buyer `≥24` 拒绝（`ROSTER_FULL`），无位置要求；
  受伤可转会（不重置状态）；generated 可转会（不改 D10 / registry）；Free Agent 禁入（走 `signFreeAgent`）；runtime `TRANSFER_COMPLETED` 事件；
  day-advance 之外执行、下一场生效；`validate→plan→commit→assert`；**保持 schema 10 / save 1**；**无 RNG**；不改 world population。
- **架构**：新模块 `src/core/transfer.js`（`transferPlayer` / `validateTransfer` / `buildTransferPlan` / `commitTransferPlan` / `assertTransferInvariants`），
  单向依赖 contract / membership / finance / player-lineup / player-runtime / sim-config / game-state，**禁止反向依赖**；与 `free-agent.js` 为 sibling。
- **Deferred / 未来**：**D10**（Deferred）；AI Transfer、Transfer Window、Contract Expiry / Renewal、Loan、Negotiation、Market Value UI、Transfer History、收入系统。
- **下一步**：**Step 28B Implementation**（已完成，见 §2.18）。

### 2.18 实现（2026-09-30，Step 28B：Transfer System v1）

- **已实现**：新增 [transfer.js](file:///workspace/src/core/transfer.js)（`transferPlayer` / `validateTransfer` / `buildTransferPlan` /
  `commitTransferPlan` / `assertTransferInvariants` / `computeTransferFee` / `clampTransferFee`）；[finance.js](file:///workspace/src/core/finance.js)
  新增 `applyCashDelta` / `applyTransferBudgetDelta` 纯状态变更原语；[player-lineup.js](file:///workspace/src/core/player-lineup.js) 下沉共享
  `removePlayerFromAllLineups`（`free-agent.js` 改为复用）；[sim-config.js](file:///workspace/src/core/sim-config.js) 新增 `TRANSFER_CONFIG`
  （`BASE_FEE` / `ABILITY_REFERENCE` / `AGE_FACTORS` / `POSITION_FACTOR` / `MIN_TRANSFER_FEE=0` / `MAX_TRANSFER_FEE`）；
  [game-controller.js](file:///workspace/src/controller/game-controller.js) 追加 `transferPlayer` 转发（`{success, code, issues}`，不含 Transfer UI）。
- **费用**：确定性纯函数 `Base × AbilityFactor × AgeFactor × PositionFactor`（**runtime 计算、不持久化**；不读 cash/budget/squad；不使用 Potential/Fitness/Form/Morale/Injury/Stats；无 RNG），clamp 到 `[0, MAX_TRANSFER_FEE]`。
- **原子性**：`validate → plan → commit → assert`；失败发生在 commit 之前，membership / contract / finance / lineup 均不产生半提交。
- **错误码**：`PLAYER_NOT_FOUND` / `PLAYER_RETIRED` / `PLAYER_NOT_IN_SELLER` / `PLAYER_HAS_NO_ACTIVE_CONTRACT` / `CONTRACT_MISMATCH` /
  `BUYER_CLUB_NOT_FOUND` / `SAME_CLUB` / `ROSTER_FULL` / `SELLER_LAST_GK` / `FREE_AGENT_NOT_TRANSFERABLE` / `INSUFFICIENT_CASH` /
  `INSUFFICIENT_TRANSFER_BUDGET` / `INVALID_TRANSFER_FEE`（复用项目既有 SimulationError code 风格）。
- **schema**：**保持 10**；`SAVE_FORMAT_VERSION` 保持 1；未新增 RNG；未新增持久容器；**D10 仍 Deferred**。
- **验证**：`tests/transfer.test.js`（A–O + Controller，失败原子性含全部前置拒绝）；累计 **286/286 通过**；
  10/50/100/200 赛季长跑不变量全通过；Save/Load 往返一致；比赛黄金指纹（143/143/1141）不变。
- **仍未实现（Step 29+）**：Transfer UI / AI Transfer / Contract Expiry / Renewal / Loan / Window / Negotiation / Market Value / Transfer History / 收入系统 / **D10**。
- 详见 [DECISIONS D-27](file:///workspace/docs/DECISIONS.md) 与 [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §33。

### 2.19 设计冻结 + 实现（2026-09-30，Step 30 / Step 31：AI Club Decision Framework v1）

- **Step 30 = Design Frozen**：冻结 **D-AI-01 ~ D-AI-25**（架构 Decision→Action→Domain→State；5 类决策；Hard/Soft Need；9 步 Candidate Filter；Suitability 非 OVR；FA 优先；确定性排序；仅 Season Boundary 触发；每步重读；ai_decision 事件；最小 Club Policy；不持久化；schema 10 / save 1；黄金回归不变）。详见 [DECISIONS D-28](file:///workspace/docs/DECISIONS.md)。
- **Step 31 = Implementation（已实现）**：新增 [src/core/ai/](file:///workspace/src/core/ai)（`ai-config` / `ai-club-policy` / `ai-need` / `ai-candidate` / `ai-suitability` / `ai-decide` / `ai-action`）；
  [simulation.js](file:///workspace/src/core/simulation.js) 新增 `enableAI`（缺省启用）并接入 `#rollFinishedSeasons`（Population Health 后、lineup repair 前，仅非 managed 俱乐部）。
- **执行层**：仅经 `transferPlayer` / `signFreeAgent` / `releasePlayerToFreeAgent` 与合法 lineup 能力；不直接改 membership / contract / finance / generated。
- **验证**：新增 `tests/ai.test.js`（A–O）；累计 **303/303 通过**；黄金回归（143/143/1141）不变；10/50/100/200 赛季长跑（AI 启用）不变量稳定；Save/Load 往返一致。
- **仍未实现（Step 32+）**：AI Manager personality / Board / Scout / Agent / Negotiation / Loan / Contract Renewal / Expiry / Transfer Window / Market Value / 多联赛 AI / **D10**。

### 2.20 设计冻结（2026-09-30，Step 32A 审计 / Step 33A 审计 / Step 33B：World Economy / Transfer Market v2）

- **Step 32A = Long-Term Ecosystem Audit（只读）**：确认 AI v1 长期**吸收态**（population 112→96、roster→12、FA→0、transfer≈0；`transferBudget` 单向衰减）。根因：release 下限钳制 + population 只补最低线 + budget 无再生。
- **Step 33A = Design Audit（只读）**：给出三循环模型与候选方案（Competitive Need / Active Selling / Holding Target / 有界 Population Surplus / budget regeneration / Policy v2）。
- **Step 33B = Decision Freeze（纯文档）**：正式冻结 **D-29 / D-33.1 ~ D-33.15**：
  - 三循环职责分离；Need 增 **COMPETITIVE**（独立档，reasonCode `COMPETITIVE_UPGRADE`）；
  - **AI Active Selling**（仅 `transferPlayer`，无 Listing/Window/Negotiation）；
  - **HOLDING_TARGET = 14**；**WORLD_MIN_POPULATION = 96（不变）**、**WORLD_SOFT_CAP = 112**（有界 surplus，非机械恢复）；
  - **transferBudget 赛季再生**（上限 `INITIAL_TRANSFER_BUDGET`，无 RNG，无收入系统）；**cash 不再生**；
  - **SELL + RELEASE exit cap = 2**（SELL 计入 seller exit cap）；
  - Season Boundary 顺序：`developPlayers → runPlayerLifecycle → bounded population → transferBudget regeneration → runSeasonAI → repairManagedLineups → resetSeasonStats`；
  - **Schema 10 / Save Format 1 不变**（全部为派生）。
  - 旧 Decision 关系：**D-16 Reopen/Extend**、**D-24 Extend**、**D-26 保持**、**D-27 Extend**、**D-28 Extend**（Original Rule + v2 Extension，不覆盖）。详见 [DECISIONS D-29](file:///workspace/docs/DECISIONS.md)。
- **Step 34 = Implementation（未开始）**：仅实现上文冻结范围 + 测试 + 10/50/100/200/500 long-run validation + 文档同步。
- **本阶段禁止**：Match Engine / Team Strength / OVR / Transfer UI / Negotiation / Transfer Window / Loan / Scout / Agent / Contract Renewal / Income System / Cash regeneration / Board / Manager Personality / 随机市场活动 / Schema bump。

### 2.21 微决策冻结（2026-09-30，Step 34A 审计 / Step 34B：World Economy v2 Micro Decisions）

- **Step 34A = Implementation Audit（只读）**：结果 **READY / 0 BLOCKER**；确认 v2 可在当前架构最小侵入实现（无需新 Domain API / 不改 Transfer·Match·TeamStrength / 无需 Schema bump）；只读长跑确认吸收态在 200/500 季持续。
- **Step 34B = Decision Freeze（纯文档）**：记录 **D-34.1 ~ D-34.3**（详见 [DECISIONS D-34](file:///workspace/docs/DECISIONS.md)）：
  - **D-34.1 Population Trigger Semantics**：`96=Hard Floor / 112=Soft Cap / 14=AI Holding Target / 12=Club Hard Min` **四者分离**；Population Generation **仅在** club 结构性缺口或 world `< 96` 时发生；**禁止**“每季补到 112 / 低于 112 自动生成 / 每 club 自动补到 14”。
  - **D-34.2 transferBudget Carry-over Regeneration**：`new = min(INITIAL_TRANSFER_BUDGET, current + REPLENISHMENT_AMOUNT)`；carry-over、有上限、不 reset、不影响 cash；**T6 不变**。
  - **D-34.3 Competitive > Soft Priority / Dedup**：优先级 `HARD > COMPETITIVE > SOFT > NONE`；COMPETITIVE 独立档（`COMPETITIVE_UPGRADE`）且仅在无 HARD 时考虑；与 SOFT `ATTRIBUTE_GAP` 同位置去重。
- **状态**：Schema 10 / Save Format 1 不变；D-33.1~D-33.15 未被改写。**Step 34 实现仍未开始**。

### 2.22 实现（2026-09-30，Step 34：World Economy / Transfer Market v2）

- **已实现**：Competitive Need（`COMPETITIVE_UPGRADE`）；`HOLDING_TARGET=14`（仅 AI 层）；Active SELL（`SELL_PLAYER`→`transferPlayer()`）；`SELL+RELEASE` 共享 exit cap（≤2）；`WORLD_SOFT_CAP=112`；`replenishTransferBudget()` carry-over 再生；Club Policy v2 参数；Season Boundary 顺序（regeneration 在 AI 前）。**Schema 10 / Save 1 不变**。
- **验证**：**312/312 测试通过**；黄金回归 `143/143/1141` 不变；浏览器冒烟通过；10/50/100/200/500 长跑不变量通过。
- **⚠ 未达成 D-33.1（长期生态）**：50/100/200/500 季仍收敛到 `population=96 / roster=12 / FA=0 / transfer=0` —— **吸收态未被打破**。根因：D-34.1 的 generation 只补结构性缺口、不提升 world stock，供给恒为 0；Competitive Need 与 budget 再生只解决 demand/capacity。
- **Decision 冲突登记**：**D-33.1 与 D-34.1 互斥**（详见 [DECISIONS D-29/D-34 实现状态](file:///workspace/docs/DECISIONS.md)）。**待 Step 35 Decision Freeze 裁定供给侧机制**；本步未擅自修改冻结规则。

### 2.23 Supply-Side Audit（2026-09-30，Step 35A：只读设计审计）

- **性质**：**READ-ONLY**。未改代码 / 数据 / 测试 / Schema / Save Format / 配置；**未冻结新规则**。结论见 [DECISIONS D-35A](file:///workspace/docs/DECISIONS.md)。
- **系统模型**：`Σ_c R_c + F = N`；transfer/release/sign 不改变 N；retirement `N-1`；generation `N+1`（恒分配入 club，不入 FA）。
- **吸收态证明**：`96/12/0` 为不动点（无结构缺口 → 不生成；`R_c≤12<14` → 不 RELEASE/SELL；任意 seller 违反 `sellerKeepsStructure`）。**恒为 0 的是 Seller Supply（伴 FA=0）**。
- **关键耦合**：`WORLD_MIN(96)=ClubCount(8)×CLUB_MIN(12)`，且 active player ≡ first-team roster（无 youth/reserve）→ Population Floor ≡ Market Supply Floor。
- **机制审查（A–H）**：A 补到14 → 新不动点 `112/14/0`（无 seller）；B 人口带 → 常数目标会形成新不动点；C 非均匀深度 → 可产 seller（需确定性轮换）；D Youth Domain → 可解耦但高成本；E 仅 retirement+generation → 不可能产 surplus；F generation→FA → 冲突 D-33.6/D-34.1；G 仅 Policy → 不足；H 市场驱动 → 循环依赖。**全部 [TBD]，未选择。**
- **禁止**：随机生成 FA 供货 / 按目标笔数强制交易。
- **Decision Questions（供 Step 35B）**：
  1. Population Floor 是否应 `> ClubCount × ClubMin`（解耦）？还是保留 floor 另加 Market Supply 机制？
  2. `HOLDING_TARGET` 是否应成为**向上深度目标**（补到 14），还是仅保留 release 阈值（>14）？前者是否引入 `112/14/0` 新不动点？
  3. 谁创造 roster surplus：非均匀 generation / policy 深度目标 / FA 缓冲 / youth 池？
  4. 是否需要"active but not first-team"概念（youth/reserve/FA buffer）？是否新增 Domain（schema 影响）？
  5. generation 是否可直接进入 FA（有界缓冲）？与 D-33.6/D-34.1 如何协调？
  6. Depth 分配是否 policy 驱动 + 确定性轮换（避免永久 supplier）？
  7. 用什么确定性机制保证既无 `96/12/0` 也无 `112/14/0` 吸收态、且人口不无限增长？
  8. Step 35 可实现范围 vs 延期（youth Domain 预计延期）？
- **原则（[建议]）**：仅改阈值/触发器不足；核心是引入一个**高于 Domain Min 的向上深度/供给机制**，并使其**状态相关 + 有界 + 确定性**。

### 2.24 Supply Mechanism Decision Audit（2026-09-30，Step 35B：只读方案审计）

- **性质**：只读；未改代码 / 数据 / 测试 / Schema / Save Format / 配置；**未冻结规则**。结论见 [DECISIONS D-35B](file:///workspace/docs/DECISIONS.md)。
- **数学结论**：`ΔN = Gen − Ret ≤ 0`（冻结 rule 4 + rule 8）⇒ N 单调收敛 96 ⇒ `96/12/0` 唯一不动点；**全部冻结规则不变时无可行供给机制**。
- **方案 A–G 审查**：A 固定14 → `112/14/0`；B 非均匀 → 可产 seller（需轮换）；C Policy 动态深度 → 同 B；D 纯状态 → 无注入源；E 生成→FA → 仅 FA 流动性、非 club seller；F Youth/Reserve Domain → 需新 Domain，DEFER；G 组合 → 最有希望、最复杂。
- **推荐候选（[建议]）**：① Dynamic Depth Target Intake（现有 Domain / schema 不变 / 需受控重开 D-34.1）；② Bounded Intake Pool（新 Domain / 建议 DEFER）。
- **待 Step 35C 决策（6 项）**：(1) 是否受控重开 rule 4（生成超出结构缺口）；(2) 是否采用动态 depth target 且是否限定 `[12,16]`；(3) 目标是否必须由状态（age/congestion/need/finance/recent transfer/development）共同决定；(4) 是否引入有界 intake（每季上限 + `N≤112`）；(5) 是否引入 youth/reserve Domain（默认 DEFER）；(6) 如何保证反永久身份与无新吸收态（`96/12/0` 与 `112/14/0` 均不可）。

### 2.25 Supply Mechanism Decision Freeze（2026-09-30，Step 35C：DOCS-ONLY 冻结）

- **性质**：纯文档冻结；**未改代码 / 数据 / 测试 / Schema / Save Format / 配置**；**未跑实现测试 / 长跑 / Browser Smoke**。详见 [DECISIONS D-35.1 ~ D-35.11](file:///workspace/docs/DECISIONS.md)。
- **路线 α 冻结**：Dynamic Depth Target Intake（**DDTI**），现有 Domain 内实现，**不引入新 Domain**。
- **路线 β DEFER**：Bounded Intake Pool / Youth·Reserve Pool（新 Domain / schema 风险）。
- **D-34.1 受控重开**：保留 A（结构缺口）+ B（`world<96`），**新增 C = Controlled Depth Intake**（状态驱动 / 有界 / 确定性 / 非机械 / 不同步 / 不保证 14·16·112 / 不制造交易 / `N≤112`）。
- **DDTI 语义**：`effectiveDepthTarget_c` = 状态驱动、可逆的 intake target；必须考虑 age / congestion / need / finance / recent transfer / development；禁止 OVR / 单一均值 / 随机 target。
- **Policy = bias, not identity**；**Target 必须有 hysteresis**；**必须存在硬上下限**（`≥12`、`≤DEPTH_CAP`）。
- **`112/14/0` 不得成为长期吸收态**（target 异质 / 状态驱动 / 可逆）；**禁止永久 supplier / buyer**。
- **Generation→FA DEFER**；**Transfer Domain / Match / Team Strength 不修改**；**Schema 10 / Save 1 保持**。
- **全部具体数值 `[TBD]`**：`DEPTH_CAP`（候选 14/15/16/17）、target function、hysteresis 阈值、per-club / world intake cap —— 留待 **Step 35D 参数实验**。
- **Step 35D 验收**：10/50/100/200/500 季；`N∈[96,112]`、`R_c∈[12,24]`、`FA≥0`、`cash/transferBudget≥0`、无 NaN/Infinity/负值/`>24`、deterministic、Golden `143/143/1141` 不变；新增生态指标 + **club role transition** + **per-club persistence**（不得只看均值）。

### 2.26 DDTI 实现 + 参数实验（2026-09-30，Step 35D）

- **已实现**：`src/core/ai/ai-depth-intake.js`（DDTI 纯评估/规划）；`sim-config.DDTI_CONFIG`；`player-lifecycle.runDepthIntake`（FA 优先→生成）；接入 `runPlayerLifecycle`（结构→depth）；`SimulationCore({ ddti })` 实验覆盖。**未改 Transfer/Match/TeamStrength/membership/contract/save**。
- **⚠ 根因修正**：长期市场冻结的真正原因是 **AI 候选资格要求 active 合同**、而 Domain（T9）**允许 generated 无合同**——generated 取代静态球员后 AI 无候选 → ~S50 冻结。已修 `ai-candidate.js`/`ai-decide.js`（与 Domain 对齐）。
- **长跑（纯 AI 世界，500 季）**：市场**持续活跃**（maxConsecZeroTransfer=0），`N∈[104,112]`、roster∈[12,15]、无永久 supplier/buyer、cash/budget≥0、Golden 不变。
- **残余限制（超出 DDTI）**：存在 **managed club** 时 cash 单向集中（D-33.8 cash 不再生 + managed 免 AI）→ 长期冻结；需后续 finance 决策。**待 Step 35E 冻结参数。**
- **测试**：**321/321 通过**（新增 `tests/ai-depth-intake.test.js`）；Browser Smoke clean。

### 2.27 DDTI 参数冻结 + 合同一致性冻结（2026-09-30，Step 35E）

- **性质**：冻结已验证参数 + 接受合同一致性修复；**未新增/修改任何 DDTI·Transfer·Finance·AI 机制**。详见 [DECISIONS D-35E](file:///workspace/docs/DECISIONS.md)。
- **基准参数 C1 正式冻结（`[已定]`）**：`DEPTH_CAP=14`、`PER_CLUB_INTAKE_CAP=1`、`WORLD_INTAKE_CAP=4`、`HYSTERESIS_UP=0.30`、`HYSTERESIS_DOWN=0.15`；`sim-config.DDTI_CONFIG` 已同步。**C2/C3 降为历史实验记录，不作为当前配置。**
- **合同一致性修复正式接受（`[已定]`）**：AI 候选/SELL eligibility = `activeOwned || (generated 且无 contract)`，与 Transfer Domain T9 一致；保留 `sellerKeepsStructure`/exit cap/`transferPlayer`/fee/finance/membership；**Transfer Domain 未改**。
- **Deferred Issue `DF-01`（→ Step 36）**：Managed Club Cash Concentration / World Finance Feedback（Finance 问题，非 DDTI/Transfer/Match）。
- **回归**：**321/321 通过**；Golden `143/143/1141` 不变；Schema **10** / Save Format **1**；determinism 不变。

### 2.28 DF-01 Decision Freeze：Managed Finance Feedback（2026-10-01，Step 36A 审计 / Step 36B 反事实实验 / Step 36C 冻结）

- **性质**：**DOCS-ONLY Decision Freeze** —— **未修改代码 / 配置 / 测试 / Schema / Save Format / DDTI / Transfer Domain / Match / Team Strength**，未运行生产实现，**未 commit**。详见 [DECISIONS D-36](file:///workspace/docs/DECISIONS.md) 与 [SIMULATION_SPEC §35](file:///workspace/docs/SIMULATION_SPEC.md)。
- **冻结机制（CF-E2）**：**threshold-triggered managed finance redistribution** —— 赛季边界 `managedShare > 35%` 时，**确定性再分配 20%** 的 managed **cash** 给 AI 俱乐部（AI cash 中位数 → 优先 `cash < median` → cash 升序 → clubId tie-break → 均分）；**只改 cash**；**world cash 严格守恒 = 8000**；无 RNG；无新持久化。**Schema 10 / Save Format 1 不变**。
- **D36.1~D36.6（`[已定]`）**：D36.1 Managed Finance Feedback（35%/20%、守恒、接收方规则）；D36.2 Managed Player Agency（AI 不得操作 managed 的 membership/contract/transfer/lineup）；D36.3 Determinism（无 RNG / cash 升序 / clubId tie-break / 均分）；D36.4「现金汇 ≠ 球员净卖出」（managed 长期球员净卖出允许）；D36.5 不重开 D-33.8 / 不引入收入系统；D36.6 DDTI C1 / fee 公式 / Schema·Save 冻结。
- **Step 36B 依据（摘要）**：CF-A 基线冻结（maxZero≈243）；**CF-B（sink）/ CF-D（world income）/ CF-F（decoupling）失败**；**CF-C / CF-E 通过**；**最终选择 CF-E2**。
- **保持不变**：D-33.8（cash 不再生）、DDTI C1、Transfer Domain、fee 公式、Match / Team Strength、Golden `143/143/1141`。
- **下一步**：**Step 36D = Finance Feedback Production Implementation + Validation**（生产实现 + 10/50/100/200/500 赛季长跑验证）。

### 2.29 Managed Finance Feedback 实现 + 验证（2026-10-01，Step 36D）

- **实现**：新增 [finance-feedback.js](file:///workspace/src/core/finance-feedback.js)（`calculateManagedFinanceFeedback` / `applyManagedFinanceFeedback` / `runManagedFinanceFeedback`，plan→apply，纯函数、无 RNG）；`sim-config.FINANCE_FEEDBACK_CONFIG`（`THRESHOLD=0.35` / `REDISTRIBUTION_RATE=0.20`）；接入 `simulation.#rollFinishedSeasons`（`replenishTransferBudget` 之后 / `runSeasonAI` 之前，**未改变既有顺序**）。**只改 `cash`**；**world cash 严格守恒**；Schema **10** / Save Format **1** 不变（无新持久化）。
- **测试**：新增 `tests/finance-feedback.test.js`（FF-01~FF-15，覆盖阈值/边界/接收方/均分/余数/守恒/不变式/确定性/无 OVR）。**全量 336/336 通过**（321 旧 + 15 新，0 失败）；Golden `143/143/1141` 不变。
- **长跑**：10/50/100/200/500 赛季；managed-normal / cash-high / heavy-sell / ~34% / ~50% / AI-cash-ultra-low / AI-cash-uneven / pure-AI 场景：`worldCash` 恒为初值、`managedShare` 稳定 ~0.28–0.35、AI cash median 健康、`maxConsecZeroTransfer ≤ 1`、threshold 仅异常时触发（约 500 季中 40 次量级）、**S\* absorbing state 消除**、无固定单一资金赢家。**DDTI C1 / Transfer Domain / fee 公式 / Match / Team Strength 均未改**。
- **Browser Smoke**：页面/世界加载正常、赛季推进正常、无 console error、无 JS/数据 404（仅既有 `favicon.ico` 404）。
- **下一步**：进入用户决策（Step 37 由用户指定），本步**不自行进入**。

### 2.30 Competition Structure Decision Freeze（2026-10-01，Step 38A 审计 / Step 38B 冻结）

- **性质**：**DOCS-ONLY Decision Freeze**；未修改代码 / 测试 / 配置 / .fdb / Schema / Save Format，未 commit。详见 [DECISIONS D-38](file:///workspace/docs/DECISIONS.md) 与 [SIMULATION_SPEC §36](file:///workspace/docs/SIMULATION_SPEC.md)。
- **冻结模型（Candidate B）**：`Country → Division(tier) → Club`；`Competition(format)` 引用 Division/参赛集合；`Competition Season` 为 Competition 的逻辑实例边界；**League ≡ Competition(format=RoundRobin)**。
- **已定（D38.1~D38.9）**：实体模型；Competition Season 逻辑独立（Phase 1 不强制持久实体）；membership 仅存当前归属（历史派生）+ 受控写入口；Promotion/Relegation 归 Country/World + 规则数据化 + **两阶段派生执行**（无新持久字段）；Rules 分层（Engine 固定 / World Data 入 `.fdb`）；**多赛事 Season Boundary 修复**（Phase 1 前置）；Schema **10** / Save **1** 加法式；一期**最小金字塔**（多层级 + 升降级 + membership 迁移，Playoff/Cup/Continental/Qualification 延后）。
- **不变**：DDTI C1、Finance Feedback、Transfer Domain、Match / Team Strength、Golden `143/143/1141`。
- **下一步**：Phase 1 决策已**最终冻结**（Step 38D，见 2.31）；实现阶段 = **Step 38E — Competition Structure Production Implementation**。

### 2.31 Competition Structure Phase 1 Decision Freeze（2026-10-01，Step 38C 实现审计 / Step 38D 最终冻结）

- **性质**：**DOCS-ONLY FINAL DECISION FREEZE**；未修改代码 / tests / `.fdb` / Schema 10 / Save Format 1，未 commit。详见 [DECISIONS D-38D](file:///workspace/docs/DECISIONS.md) 与 [SIMULATION_SPEC §37](file:///workspace/docs/SIMULATION_SPEC.md)。
- **已最终冻结（D38D.1~D38D.14，`[已定]`）**：
  - **同步世界赛季**（所有 League-format Competition 完成后统一 rollover；不支持异步 Competition Season）。
  - **Participants = 全部 League-format RoundRobin Competitions**（由 leagues 派生，deterministic 排序，不新增 `participatesInWorldSeason`）。
  - **Division/Competition 语义分离但存储复用 `leagues.json` + `runtime.competitions[leagueId]`**（概念层 `divisionId`/`competitionId` 一对一映射 `leagueId`）。
  - **Promotion/Relegation = 两阶段**（纯 planner 生成完整 `PromotionRelegationPlan` → 全局校验 → **一次性** atomic membership transition → validate → 生成下季 runtime/fixtures）；**禁止链式 per-Division apply**；含完整 invariants（单次移动/相邻 tier/top 不升·bottom 不降/无重复/确定性）。
  - **邻接 = `countryId + tier` 相邻 tier**；非法配置在 validation 明确拒绝。
  - **名额默认 `promotionPlaces=2` / `relegationPlaces=2`**，含 clamp/边界/非法拒绝规则；不实现 playoff/补偿/注册/财务/牌照移动。
  - **Ranking 保持 Engine 默认** `points→GD→GF→clubId`（不引入 DSL）。
  - **Rules 最小化**：`leagues.json` 可选 `rules{promotionPlaces?,relegationPlaces?}`（可选 `pointsFor*?`）。
  - **Membership API = 批量原子 `applyPromotionRelegationTransition`**（all-or-nothing）；`membership.clubs` 为当前归属唯一真相源。
  - **Rollover 最终顺序**（Promotion/Relegation 早于 `createLeagueRuntime`/fixtures，AI 在新 Division 生效后运行）。
  - **Fixture 可选 `competitionId`**（不重构旧 ID、不改 Match Engine、不升级 Save）。
  - **Schema 10 / Save Format 1 不升级**；Plan 为临时运行时对象（不持久）。
  - **失败语义**：Plan 非法 → 整个 transition 失败，禁止部分/随机修复/改 static。
  - **回归不变量**：Golden `143/143/1141`、测试基线 `336/336`；单 Division 与单联赛边界行为等价；DDTI C1 / Finance Feedback / Transfer / Match / Team Strength 不变。
- **Deferred**：Playoff / Domestic Cup / Continental / Qualification / Complex stages / Youth·Reserve / Staff / Scout / Reputation / Revenue·TV·Sponsor·Prize / Loan / Registration / licensing / FFP / promotion history entity / CompetitionSeason persistent entity。
- **下一步**：**Step 38E — Competition Structure Production Implementation**（生产实现 + 回归 + 多 Division 长跑验证）。本步**不自行进入**。

---

## 3. 第三阶段：完整足球世界

**目标**：让"没有玩家的球队也自己活着"，并保证长期稳定。

- 范围（候选）：
  - AI 球队决策（买卖、换帅、改战术、财政、青训提拔）→ 世界自主演化。
  - 青训系统与新生代生成；球员退役与衰退。
  - 新闻与事件（可解释的信息输出）。
  - 杯赛、多层级 / 多国联赛（视 T7 决策）。
  - 多赛季世界模拟与稳定性收敛。
- 依赖：`SIMULATION_SPEC` §14、§15 的模型决策（T12、T14）；**Contract / Finance / Transfer 语义地基见 §30（D-24，Step 23 冻结）**。
- **下一实施阶段（未开始）**：`Contract + minimal Finance → Transfer → AI Management`；其中 **D10（生成球员合同语义）须先确认**，
  且须遵循 D7/D16 的「世界人口健康边界 ⊥ 俱乐部阵容上下限」分离策略。
- 交付物：世界模拟引擎 + 长期模拟测试。
- 验收（项目规则第 17 条）：跨 1 / 5 / 10 / 50 赛季稳定（保留 100+ 能力）；无空阵容、无不可能年龄、无指数通胀、无腐坏。
- `[已定]` R3（A8）：稳定时长 = **50 赛季基础，保留更高**；世界规模仍待定（见 T7）。

---

## 4. 第四阶段：数据库 / Mod 系统

**目标**：让社区 / 玩家能提供与替换足球世界内容。

- 范围（候选）：
  - 完整 `.fdb` 规范落地（版本化、校验、诊断）。
  - 数据库导入 / 切换流程与存档兼容策略（`SAVE_SPEC` T-S/V10）。
  - 数据库校验与错误诊断工具。
  - Mod 支持形态（视 T17 决策）。
- 依赖：`DATABASE_SPEC` 全部 TBD 决策落定。
- 交付物：数据库工具链 + 文档。
- 验收：至少两个不同数据库可被同一引擎加载；换库不破坏既有存档。
- `[TBD]` R4：Mod 支持的正式形态与边界（资源版权见 `DATABASE_SPEC` §5 红线）。

---

## 5. 第五阶段：Android App 封装与发布

**目标**：把 HTML 客户端交付为可发布的 Android App（TapTap 方向）。

- 范围（候选）：
  - 封装方案选型（WebView 容器 / 混合方案等）`[TBD]` R5。
  - 移动端适配、性能与内存优化（项目规则第 20 条）。
  - 存档在移动端的存储与备份策略。
  - 打包、签名、发布准备。
- 依赖：前四阶段稳定；性能指标达标。
- 交付物：可安装的 Android 包 + 发布说明。
- 验收：目标机型可流畅运行；存档安全；无崩溃。
- `[TBD]` R5：封装技术方案；`[TBD]` R6：目标机型 / 性能基线（与 `GAME_DESIGN` 移动端定位绑定）。

---

## 6. 测试要求（贯穿全程）

依据项目规则第 18 条，随阶段推进**必须**覆盖：

- 数据库加载与校验
- 球员 / 球队创建
- 转会、合同
- 比赛模拟（含确定性复现）
- 联赛排程、积分、升降级
- 球员成长
- 存档 / 读档（含迁移与损坏档）
- 多赛季（1 / 5 / 10 / 50，并保留 100+ 测试能力）模拟

> 测试方案细节由 `testing-qa` Skill 在实现阶段补充；本文件只规定"必须标测试的节点"。

---

## 7. 阶段依赖总览

```
一阶段 MVP ──► 二阶段 核心系统 ──► 三阶段 完整世界 ──► 四阶段 数据库/Mod ──► 五阶段 Android 发布
     │                 │                   │                    │
   架构分层          存档迁移            AI/长期稳定性        .fdb 规范与换库
   + 最小闭环        数据扩展            版本兼容打磨         工具链
```

- 依赖红线：**不得**在架构 / 存档机制未稳定时大规模堆叠系统。
- 任一阶段的"重要设计影响项"必须先 TBD 决策再实现。

---

## 8. TBD 汇总（需制定者决策）

| 编号 | 位置 | 待决问题 | 影响面 |
|---|---|---|---|
| R1 | §1 | MVP 是否含转会/合同/财政 | 范围、工期 |
| R2 | §2 | 四大核心在本阶段的完成度目标 | 范围 |
| R3 ✅ | §3 | **已定（A8）**：50 赛季基础压力测试，保留更高 | — |
| R4 | §4 | Mod 支持正式形态 | 架构、版权 |
| R5 | §5 | Android 封装方案 | 技术栈、发布 |
| R6 | §5 | 目标机型与性能基线 | 性能、体验 |

---

## 9. 约束回顾（红线）

1. 不为了"看起来完整"而增加功能。
2. 影响架构 / 数据结构 / 存档兼容 / 模拟的设计先 TBD 决策。
3. 每阶段必须可测试，非"UI 能跑一次"。
4. 数据与逻辑分离；UI 与核心逻辑分离。
5. 不擅自扩大范围（无未批准的在线/变现/3D/社交等）。
6. **技术服务于设计**：不得为降低开发难度而擅自简化核心玩法；系统复杂时先提出简化方案供制定者选择，不得直接删除、弱化或替换核心设计。