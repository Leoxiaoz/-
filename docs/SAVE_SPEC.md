# SAVE_SPEC — 存档系统规范

| 项 | 值 |
|---|---|
| 状态 | Draft v0.1（规划阶段，未进入实现） |
| 更新日期 | 2026-09-28 |
| 依据 | 制作流程第 7 步；项目规则「存档与数据库分离 / 存档兼容 / 错误处理 / 长期模拟」 |
| 关联文档 | GAME_DESIGN.md / DATABASE_SPEC.md / SIMULATION_SPEC.md / ROADMAP.md |

---

> **决策更新（2026-09-28，第 14 步）**：部分 TBD 已裁决（详见 `DECISIONS.md`）。
> **V10** 换库策略 = **隔离**（A5）；**存储介质** = **IndexedDB**（A7）；版本策略 = **向后兼容**（A5）。
> 其余 `[TBD]` 仍然有效。
>
> **实现更新（2026-09-29，第 15 步）**：`players`（球员运行时状态）由占位改为**已定义结构**——
> 存档以 `playerId` 为键保存**增量**（能力增减、体能/状态/士气、伤病、本赛季与职业生涯统计），
> **不含**静态属性/姓名/出生日期。旧档读取时经 `initializePlayerRuntime` 补齐且**保留已有值**（A5 向后兼容）。
> 详见 `DECISIONS.md` D-13 与 [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §19；
> 字段级口径仍属**暂定**，待制定者确认（DATABASE_SPEC §4）。
>
> **实现更新（2026-09-29，第 16 步 · 成长/衰退）**：`birthDate / potential / personality` 属**静态数据库**
> （见 `DATABASE_SPEC` §2/§4），**不进存档**；成长/衰退结果仅追加 `ability.deltas` 与 `players[].growth`
> 元数据（仍是引用 + 增量）。旧档读取经 `initializePlayerRuntime` 补齐 `growth`（保留已有值）。详见 `DECISIONS.md` D-14。
>
> **实现更新（2026-09-29，第 17 步 · 伤病生命周期）**：伤病为**运行时状态**，存档保存 `players[].injury`
> （`status/type/category/severity/daysRemaining/totalDays/since`）与 `players[].injuryHistory`
> （`recurrenceCount/lastInjuryDate/lastInjuryType`，定长）；`GAME_STATE_SCHEMA_VERSION` 3→4（加法式，向后兼容）。
> 旧档经 `initializePlayerRuntime` 补齐新字段（保留已有值、按 `daysRemaining` 派生严重度）。详见 `DECISIONS.md` D-15。
>
> **实现更新（2026-09-29，第 18 步 · 生态联调）**：出场/进球统计自本步起**真实产生并持久化**（`stats.season` / `stats.career`）；
> 赛季滚动重置 `season`、累计 `career`。本轮为**接线**，运行时结构未新增字段 → `GAME_STATE_SCHEMA_VERSION` **保持 4**。
> 存档往返一致性（含统计/伤病/vitals/成长）由 `tests/ecosystem.test.js` 验证。详见 `DECISIONS.md` D-16。
>
> **实现更新（2026-09-29，第 19 步 · 球员生命周期）**：新增运行时容器 `generated`（新生代档案，含 `teamId`）、
> `retired`（退役归档，保留 career/终值快照）、`nextGeneratedSeq`（生成序号，**永不回退**）、
> `populationTarget`（各队人口目标快照）；`GAME_STATE_SCHEMA_VERSION` **4→5**（加法式，向后兼容）。
> 旧档缺这些字段时经 `deserializeState` / `initializePlayerRuntime` 兜底补齐（保留已有值）；退役球员读档时**不再被复活**。
> 详见 `DECISIONS.md` D-17 与 [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §23。
>
> **实现更新（第 20 步 · 玩家阵容）**：运行时新增 `managedClubId`（默认 null）与 `clubs[].lineup`
> （`{starters:[],bench:[]}`，仅存 playerId）；`GAME_STATE_SCHEMA_VERSION` **5→6**（加法式，向后兼容）。
> 旧档经 `initializeClubRuntime` / `deserializeState` 兜底补齐。详见 `DECISIONS.md` D-18 与 [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §24。
>
> **实现更新（G0 · 运行期成员关系层）**：运行时新增 `membership`（`{schema, players:{playerId→clubId}, clubs:{clubId→leagueId}}`），
> 作为 player→club / club→league 的**运行期唯一真相源**；`GAME_STATE_SCHEMA_VERSION` **6→7**（加法式，向后兼容）。
> v6 旧档经 `deserializeState` 补齐空容器 + `initializeMembership` 从静态/新生代种子建立，退役者不复活；
> 读档后执行 `assertMembershipValid`，致命问题**明确报错**不静默。既有字段（`managedClubId/lineup/tactics/generated/retired/nextGeneratedSeq`）
> 行为不变。详见 `DECISIONS.md` D-19 与 [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §25。
>
> **实现更新（G1a · 比赛球员参与结构）**：`players[].stats.{season,career}` 统计线新增 `yellow` / `red`
> （黄/红牌聚合，当前恒为 0）；`GAME_STATE_SCHEMA_VERSION` **7→8**（加法式，向后兼容）。
> 旧档经 `normalizeStatLine` 补齐为 0。`MatchResult.involvements` 为**运行期产物**，不进入存档。
> 详见 `DECISIONS.md` D-20 与 [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §26。
>
> **实现更新（G1b① · 赛季日历与赛季边界）**：**无存档结构变更**——SeasonCalendar 为**派生视图**
> （由唯一联赛 competition 确定性投影，含 `{season,startDate,endDate,status}`），**不新增任何持久化字段/对象**。
> `state.season` 字段名与持久化**保持**，单联赛下 `state.season ≡ competition.season`。
> `GAME_STATE_SCHEMA_VERSION` **保持 8**，**无需迁移**。详见 `DECISIONS.md` D-21 与
> [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §27。
>
> **实现更新（Step 21-A · 球员比赛表现）**：`players[].stats.{season,career}` 统计线新增
> `shots` / `shotsOnTarget` / `ratingSum`（`ratingSum = Σ round(rating×10)`）。`GAME_STATE_SCHEMA_VERSION`
> **8→9**（**加法式**，向后兼容）：旧档经 `normalizeStatLine` 将缺失字段补齐为 0，加载后可继续模拟。
> `MatchResult.involvements` 与单场 `rating` 数值为**运行期产物**，**不单独入档**（经统计线持久化）。
> 详见 `DECISIONS.md` D-22 与 [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §28。
>
> **实现更新（Step 25 · 合同 / 财政地基）**：新增 `runtime.contracts`（`playerId → {playerId,clubId,startSeason,endSeason,wage,status}`）
> 与 `runtime.clubs[].finance`（`{cash,wageBudget,transferBudget}`）。`GAME_STATE_SCHEMA_VERSION` **9→10**（**加法式**，向后兼容）：
> 旧档经 `normalizeContracts`（**确定性**、**不创建 free agent**）与 `normalizeFinance`（确定性模板）补齐，不再改 `SAVE_FORMAT_VERSION`；
> 读档后执行 `assertContractInvariants` / `assertFinanceInvariants`（不静默）。退役归档新增 `retired[].contract` 快照。
> 详见 `DECISIONS.md` D-25 与 [SIMULATION_SPEC](file:///workspace/docs/SIMULATION_SPEC.md) §31。

## 0. 文档定位与边界

本文件回答一个问题：**存档怎么工作。**

- 本文件定义：存档的定位、结构原则、与数据库的关系、版本兼容、校验、损坏处理、换库兼容策略。
- 本文件**不**定义：数据库格式（见 `DATABASE_SPEC.md`）、模拟规则（见 `SIMULATION_SPEC.md`）。
- 核心红线：**数据库 ≠ 存档**；**导入/更换数据库不得自动覆盖存档**；存档必须能支撑玩家玩到 2040 年而不崩。

### 标记约定

- `[已定]` / `[TBD]` / `[建议]` 同前。
- 字段级结构在本阶段不写死，只确定**必须持久化的范围**与**机制原则**。

---

## 1. 存档定位 `[已定]`

- 数据库 = 足球世界的**初始配置**。
- 存档 = 一个**正在运行中的足球世界**。
- 关系示意（依据第 7 步）：

```
2026 数据库 → 创建新世界 → 2028 → 2032 → … → 玩家存档
```

- 二者**不得混为一谈**；存档是玩家多年职业生涯的唯一真相来源。

---

## 2. 存档必须保存的范围 `[已定]`

依据第 7 步，存档至少要能恢复以下运行时状态：

| 类别 | 内容 |
|---|---|
| 时间 | 当前日期 / 赛季 |
| 球员 | 球员状态、球员成长（能力变化） |
| 流动 | 转会、合同 |
| 资源 | 财政 |
| 竞赛 | 联赛排名、比赛结果 |
| 世界 | AI 球队变化、世界事件 |

补充要求（项目规则第 8 条）：球员发展、伤病、AI 决策、其他运行时变更也都必须可持久化。

- **红线**：必须保证上述状态在"创建 → 存档 → 读取 → 跨赛季推进"后**一致**；缺省字段必须有兜底。

---

## 3. 存档结构（原则，字段后置）

- `[已定]` 原则：存档保存**相对于数据库的引用 + 增量**，而非整库复制。
  - 引用：用稳定 ID 指代数据库实体（见 `DATABASE_SPEC.md` §3）。
  - 增量：运行时变化的字段（能力、状态、财政、排名、结果…）。
- `[建议]` 存档分层：

```
SaveSlot
├── meta            （存档元信息：版本、创建时间、当前日期、所用数据库标识）
├── world           （世界级状态：日期、赛季、赛事进度、世界事件）
├── clubs           （各俱乐部运行时状态：财政、名单、战术、AI 状态）
├── players         （球员运行时状态：能力变化、状态、体能、士气、伤病、合同）
├── competitions    （排名、赛程进度、结果、晋级）
├── transfers       （转会历史与进行中的谈判）
└── history         （历史记录：历届冠军、纪录等，按需）
```

- `[TBD]` 存档物理形态（单文件 / 多文件 / 分层压缩）；移动端体积与加载速度权衡。
- `[TBD]` 是否保存"完整历史"还是"可重算的历史"（影响体积与长期存档大小）。
- `[TBD]` 存档槽机制：槽数量、自动存档、快速存档（受移动端 UI 影响）。
- `[TBD]` 写入时机与策略（即时 / 关键节点 / 周期），必须避免关键节点丢进度（项目规则第 20 条：避免不必要后台处理）。

---

## 4. 存档与数据库的关系

- 存档**记录其所基于的数据库标识**（名称 + 版本/哈希），以便：
  - 检测玩家是否更换了数据库；
  - 在换库时判断能否继续、需迁移、或需拒绝。
- **红线**：加载存档**不得**隐含地修改数据库；导入数据库**不得**自动覆盖存档。
- `[TBD]` 存档与数据库的一致性校验粒度（仅版本？还是哈希/实体计数？）。
- `[TBD]` 若玩家删除了存档所依赖的数据库，行为如何（拒绝加载并提示 / 允许降级续玩）。

---

## 5. 版本兼容

- 存档**必须**带自己的版本号（独立于数据库版本）。
- 规则（项目规则第 8 条）：
  - 数据结构变更必须携带**版本号 + 迁移策略**。
  - 旧档必须可正常读写、不崩溃。
- `[TBD]` 迁移函数机制（逐版本链式迁移 vs 目标版本适配）。
- `[TBD]` 前向兼容（新存档在旧引擎打开）——建议**明确拒绝并提示**，而不是尝试解析。
- `[TBD]` 迁移失败的回退策略（保留原档备份、报错而非静默损坏）。

---

## 6. 数据校验

- 读取时必须校验（项目规则第 19 条：不静默忽略重要错误）。
- 校验方向 `[建议]`：
  - 完整性：必填字段是否存在、结构是否匹配版本。
  - 引用完整性：存档引用的数据库实体 ID 是否还存在（悬空引用）。
  - 范围合法性：日期、年龄、财政、排名等是否越界。
- 错误分级 `[建议]`：
  - **致命**：无法安全继续 → 中止加载并给出诊断。
  - **可修复**：字段缺失可兜底 → 修复并记录警告。
- 诊断信息应包含：存档文件、实体、ID、字段、问题、建议修正（对齐项目规则第 19 条）。
- `[TBD]` 校验时机（仅读档时 / 存档时也校验）。

---

## 7. 存档损坏处理

- 原则：损坏/不完整存档应能**兜底恢复**，不卡死、不崩溃、不静默覆盖。
- 策略方向 `[建议]`：
  - 保留上一份可用存档（滚动备份）以便回退。
  - 加载失败 → 提示 + 提供回退 / 修复选项，而非直接删除原档。
- `[TBD]` 回退槽数量与占用空间（移动端约束）。
- `[TBD]` 是否提供"部分恢复"（忽略个别损坏实体继续运行）。
- **红线**：任何自动修复都必须**先备份原档**，不得不可逆地破坏玩家数据。

---

## 8. 新数据库导入后的兼容策略

场景：玩家在既有存档下导入 / 更换数据库（如 2026-27 → 2012-13，或自制库）。

- 原则 `[已定]`：**不得自动覆盖存档**；数据库不改变已运行的世界，除非玩家显式选择新开世界。
- 候选策略 `[建议]`（需制定者选定，属重要决策）：
  - A. **隔离**：旧存档继续使用原数据库；新数据库仅用于新建世界。
  - B. **引用修复**：允许换库，运行时尽量按 ID 映射，映射失败则报错/占位。
  - C. **只读警告**：检测到不匹配时仅警告，玩家自担风险。
- `[TBD]` **T-S**：正式采用的兼容策略（直接影响存档结构、`DATABASE_SPEC` 的 ID 稳定性设计）。
- `[TBD]` 部分实体消失（球队降级/联赛不存在）时的处理。
- `[TBD]` 换库后 UI 如何向玩家解释影响（可解释性红线）。

---

## 9. TBD 汇总（需制定者决策）

| 编号 | 位置 | 待决问题 | 影响面 |
|---|---|---|---|
| V1 | §3 | 存档物理形态与分层压缩（**介质已定 A7：IndexedDB**；形态仍待定） | 体积、性能 |
| V2 | §3 | 保存完整历史 vs 可重算历史 | 体积、长期存档 |
| V3 | §3 | 存档槽 / 自动存档 / 快速存档机制 | UI、体验 |
| V4 | §3 | 写入时机与频率 | 数据安全、性能 |
| V5 | §4 | 一致性校验粒度（版本/哈希/计数） | 兼容性 |
| V6 | §4 | 依赖数据库缺失时的行为 | 体验、容错 |
| V7 | §5 | 迁移机制与前向兼容策略 | 兼容性 |
| V8 | §6 | 校验时机与错误分级口径 | 数据完整性 |
| V9 | §7 | 回退/部分恢复策略与空间预算 | 容错、性能 |
| V10 ✅ | §8 | **已定（A5）**：隔离——旧档继续用原库，新库仅用于新建世界 | — |
| V11 | §8 | 实体消失时的处理 | 容错、模拟 |

---

## 10. 约束回顾（红线）

1. 数据库 ≠ 存档；导入/更换数据库不得自动覆盖存档。
2. 存档必须支撑长期（到 2040 年量级）运行而不崩。
3. 关键状态在创建/存档/读取/跨赛季推进后必须一致；缺省字段有兜底。
4. 结构变更必须带版本号与迁移策略；旧档可正常读写、不崩溃。
5. 数据错误必须显式报错并给出定位与修正建议，不得静默。
6. 任何自动修复必须先备份原档，不得不可逆破坏玩家数据。
7. 写入时机明确，避免关键节点丢失进度；避免不必要的高频落盘。