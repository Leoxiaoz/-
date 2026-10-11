# SIMULATION_SPEC — 模拟系统规范

| 项 | 值 |
|---|---|
| 状态 | Draft v0.1（规划阶段，未进入实现） |
| 更新日期 | 2026-09-28 |
| 依据 | 制作流程第 4、8 步；项目规则「模拟一致性 / 确定性测试 / 比赛模块化 / 球员多维 / 战术有后果 / AI 自主 / 世界持续演化」 |
| 关联文档 | GAME_DESIGN.md / DATABASE_SPEC.md / SAVE_SPEC.md / ROADMAP.md |

---

> **决策更新（2026-09-28，第 14 步）**：部分 TBD 已裁决（详见 `DECISIONS.md`）。
> **S1/T6** 比赛抽象层级 = **时段制**（A2；原 11 阶段引擎需据此重组，事件级能力下沉为可选）；
> **S14/T14** 稳定目标 = **50 赛季基础、保留更高**（A8）。
> 其余 `[TBD]` 仍然有效。
>
> **实现更新（2026-09-29，MVP 第一阶段）**：已落地「赛程生成 → 时段制单场模拟 → 积分榜 → 单赛季推进/滚动 → 存读一致」最小闭环，
> 对应暂定参数见 `DECISIONS.md` D-09~D-11 与 §18。比赛算法本身仍为 MVP 简化实现，待 S7/S12 细化。

## 0. 文档定位与边界

本文件回答一个问题：**比赛、球员、AI、成长怎么模拟。**

- 本文件定义：模拟的**结构与原则**、各输入的语义与相互关系、模块边界、可解释性与确定性要求。
- 本文件**不**给出最终数值公式（属实现阶段），也**不**定义字段结构（见 `DATABASE_SPEC.md`）或存档机制（见 `SAVE_SPEC.md`）。
- 核心红线：模拟结果必须**可解释**；随机性用于制造不确定性，**不得替代模拟逻辑**；不得为取悦/惩罚玩家而操纵结果。

### 标记约定

- `[已定]` / `[TBD]` / `[建议]` 同前。
- **公式与系数在本阶段一律留空**，仅确定变量与结构。

---

## 1. 比赛模拟基本原理

**目的**：把球队与球员的状态合成为一场可解释的比赛。

### 必备输入 `[已定]`（依据第 4 步）

```
球员能力 + 位置 + 战术 + 体能 + 状态 + 士气 + 对手 + 主客场 + 随机因素
        ↓
     比赛过程（事件流）
        ↓
     比赛结果（比分 / 数据 / 伤病 / 牌）
```

### 模块化要求 `[已定]`（项目规则第 13 条）

比赛引擎**必须可拆分为独立阶段**，且各阶段可单独替换而不重写整个引擎：

1. Match Setup（对阵、场地、规则、首发）
2. Team Strength Calculation（双方综合实力）
3. Tactical Effects（战术对实力的调制）
4. Player Interactions（对位、配合、克制）
5. Match Events（事件生成：进攻、射门、犯规、伤病…）
6. Goal Generation（进球判定）
7. Substitutions（换人）
8. Injuries（伤病）
9. Cards（牌）
10. Statistics（统计）
11. Post-match Processing（赛后：积分、成长、财政、新闻）

### 已定技术决策（A2）

- **T6（已定）：比赛抽象层级 = 时段制**
  - 按若干时段结算，兼顾真实度与移动端性能。
  - 离散事件流降为**未来可选**（性能允许时对玩家比赛升级）。
- **T6b（待定）：玩家临场干预**——是否允许比赛内换人 / 变阵；时段制下可行，细节待定。

### `[建议]` 确定性

- 模拟接受**可控随机种子**：同一（数据库 + 存档 + 比赛条件 + 种子）必须产出可复现结果（项目规则第 10 条）。

---

## 2. 球员能力

**目的**：为模拟提供多维度、可区分球员的输入。

- 原则：球员不能只用总体评分表示（项目规则第 14 条）。
- 维度方向 `[已定方向]`：技术 / 身体 / 精神属性、位置适性、战术特质、性格、潜力、稳定性、职业素养、野心、伤病倾向、士气、状态、体能、人际关系。
- `[TBD]` **T4/D2**：属性集合的最终粒度与取值范围（与 `DATABASE_SPEC.md` 共定）。
- `[TBD]` 综合评分（若有）与分项属性的关系：是派生值还是独立输入。
- 模拟读取点：比赛实力计算、对位判定、事件参与者选择、成长计算。

---

## 3. 位置

**目的**：决定球员在阵型中的落位与职责约束。

- 语义：一名球员对若干位置有**适性等级**（而非"能/不能"）。
- 与其他输入关系：位置适性调制该球员在阵型中的实际贡献；不适配会引入惩罚。
- `[TBD]` 位置体系划分（粗粒度如 GK/DF/MF/FW vs 细粒度如左后卫/内锋等）。
- `[TBD]` 适性如何与"角色"叠加（见 §4）。

---

## 4. 角色

**目的**：让同一位置在不同职责下有不同行为倾向。

- 语义：角色 = 位置 + 职责倾向（如拖后组织、边路突击、抢点）；角色与球员属性 / 特质匹配度影响表现。
- 与其他输入关系：角色是战术（§6）与球员（§2）之间的映射层。
- `[TBD]` **T5**：角色的最小集合；角色-属性匹配的判定方式（硬门槛 vs 连续贴合度）。

---

## 5. 球队实力

**目的**：把 11 名球员 + 战术 + 状态合成为一个可比较的整体实力。

- 结构 `[建议]`：按"进攻 / 中场 / 防守 / 门将"等维度分别聚合，而非单一数字。
- 聚合需考虑：球员能力、位置适性、角色适配、体能、状态、士气、阵容深度、阵容默契。
- `[已定]`（第 18 步，D-16）：聚合使用球员**当前有效属性**（静态基础 + `ability.deltas`，按 `potential` 与 1–99 夹取），
  而非静态基础属性——保证成长/衰退与伤病可用性能真正影响比赛；伤病球员不计入。
- `[TBD]` 聚合模型（加权求和 vs 非线性、是否含相互作用项）。
- `[TBD]` 替补 / 阵容深度对实力的影响方式（换人后重算）。

---

## 6. 战术

**目的**：让战术产生**真实的模拟后果**，而不是只改隐藏加成（项目规则第 15 条）。

- 方向 `[已定方向]`：阵型、防线高低、逼抢、节奏、宽度、传球风格、出球/推进、攻防转换、球员角色、防守职责、进攻套路。
- 要求：战术应影响**事件生成与对位结果**，而非仅一个全局系数。
- 与其他输入关系：战术 × 球员适配 → 实际执行力；战术 × 对手战术 → 克制/被克制。
- `[TBD]` **T5**：第一阶段战术指令最小集合。
- `[TBD]` 战术与对手战术的互动模型（是否存在显式克制矩阵）。

---

## 7. 状态（Form）

**目的**：表示球员近期的表现趋势，制造短期波动。

- 语义：随时间与比赛表现更新；影响比赛中的发挥。
- 与其他输入关系：与士气（§9）、体能（§8）独立但相互影响。
- `[TBD]` 更新规则（近期比赛权重、恢复速度）。

---

## 8. 体能（Fitness / Condition）

**目的**：制造轮换压力，让赛程密度有意义。

- 语义：随比赛消耗、随休息恢复；低体能降低表现并提高受伤风险。
- 与其他输入关系：受赛程密度、训练、队医影响。
- `[TBD]` 恢复模型与伤病风险与体能的耦合方式。

---

## 9. 士气（Morale）

**目的**：把更衣室氛围、成绩、出场时间等翻译成对表现的影响。

- 语义：受比赛结果、出场时间、合同、转会传闻、教练管理影响。
- 与其他输入关系：与状态、体能共同调制球员发挥。
- `[TBD]` `[建议]` 士气应可解释（项目规则第 22 条：玩家能理解"为什么某球员不开心"）。

---

## 10. 主客场

**目的**：体现主场优势这一真实因素。

- 语义：对主队实力的正向调制（可通过球迷、场地熟悉度、裁判尺度等解释）。
- 与其他输入关系：与其他实力调制项并列。
- `[TBD]` 强度与是否受球场规模 / 球迷情绪影响。

---

## 11. 随机性

**目的**：制造不确定性，而非替代模拟逻辑。

- 红线：随机性应作用在**已由模拟逻辑确定概率分布的结果**上，不得让结果脱离实力对比。
- 要求：**可控种子**，支持可复现（§1 确定性）。
- `[TBD]` 随机性的分布设计与强度上限（避免"爆冷泛滥"）。

---

## 12. 比赛事件

**目的**：把模拟过程表达为可读、可统计、可解释的事件流。

- 事件类型 `[建议]`：进攻组织、射门、扑救、进球、犯规、黄/红牌、伤病、换人、越位、角球等。
- 每个事件应携带：时间、参与球员、成因（用于解释）、结果。
- 与其他模块关系：事件由 §5–§11 的概率驱动；事件驱动 §13 进球逻辑与赛后处理。
- `[TBD]` 事件粒度取决于 §1 的抽象层级（T6）。

---

## 13. 进球逻辑

**目的**：比赛结果的最终产出环节。

- 结构 `[建议]`：机会创造 → 机会质量 → 转化为进球（含门将因素）。
- 与其他输入关系：机会创造受战术/中场控制影响；转化受前锋能力、门将能力、随机影响。
- `[TBD]` 机会与进球的分离方式；低概率高事件（远射/定位球）的建模。
- `[TBD]` 进球与整体比分分布的目标口径（用于校准合理性）。

---

## 14. AI 决策

**目的**：让世界（含无玩家的球队）自主运转；这是本项目的特色核心。

- 原则（项目规则第 16 条）：AI 决策基于**自身处境**，且**不得所有 AI 一致**。
- 决策输入方向 `[已定方向]`：俱乐部声望、财务状况、阵容需求、教练理念、联赛排名、董事会预期、青训、转会/工资预算、球员可得性、战术需求。
- AI 行为范围 `[已定]`：买/卖球员、续约、提拔青训、换教练、改战术、培养球员、管理财政、应对成绩与伤病、争夺荣誉。
- 每个重要 AI 决策应**可解释**（项目规则第 22 条：为什么某 AI 俱乐部做了这笔转会）。
- `[TBD]` **T12**：决策模型（效用函数 / 规则库 / 混合）。
- `[TBD]` AI 决策的**频率与计算预算**（移动端性能约束）。
- `[TBD]` AI 之间的差异化来源（性格 / 理念 / 财政 / 声望的权重分布）。

---

## 15. 多赛季世界演化

**目的**：保证世界在玩家不参与时也持续演化，并在数十赛季后仍稳定（项目规则第 11、17 条）。

- 演化闭环 `[已定方向]`：AI 球队 → 买卖 / 培养 / 换帅 / 改战术 / 财政变化 / 成绩变化 → 世界持续变化。
- 必须跨周期一致的系统：球员成长与衰退、教练更替、财政、合同到期、青训产出、球员退役与新生、赛事推进。
- 稳定性红线（不得出现）：财政崩坏、不可能年龄、重复/缺失球员、不可能转会、空阵容、联赛规模错误、赛程错误、指数通胀 / 属性通胀、损坏合同、数据腐坏。
- `[TBD]` **T14**：目标稳定时长（游戏内 N 年）与验收口径。
- `[TBD]` 长期数值的**收敛机制**（防止通胀/通胀反向）——属实现阶段，但需在规划中预留。

---

## 16. TBD 汇总（需制定者决策）

| 编号 | 位置 | 待决问题 | 影响面 |
|---|---|---|---|
| S1/T6 ✅ | §1 | **已定（A2）**：时段制（事件级降为可选/未来优化） | — |
| S2/T6b | §1 | 是否支持临场干预 | 模拟粒度、UI |
| S3 | §2 | 属性粒度与取值范围 | 数据结构、模拟 |
| S4 | §2 | 综合评分与分项的关系 | 模拟、UI |
| S5 | §3 | 位置体系粒度；适性与角色的叠加 | 模拟、数据库 |
| S6/T5 | §4,§6 | 角色最小集合与匹配判定；战术最小集合 | 模拟、UI |
| S7 | §5 | 实力聚合模型；深度/默契的建模 | 模拟 |
| S8 | §6 | 战术-战术克制模型 | 模拟 |
| S9 | §7,§8,§9 | 状态/体能/士气的更新与耦合模型 | 模拟、可解释性 |
| S10 | §10 | 主场优势强度与影响因素 | 模拟 |
| S11 | §11 | 随机分布与强度上限 | 平衡性 |
| S12 | §13 | 机会-进球模型（未来细化）；**比分分布目标口径已定（D-12，见 §18）** | 模拟校准 |
| S13/T12 | §14 | AI 决策模型、频率、性能预算、差异化来源 | AI、性能 |
| S14/T14 | §15 | 稳定时长目标与长期数值收敛机制 | 平衡、测试 |

---

## 17. 约束回顾（红线）

1. 随机性制造不确定性，不得替代模拟逻辑。
2. 重要结果必须可解释；不得做成黑箱。
3. 战术必须影响真实模拟行为，不得只是隐藏加成。
4. 模拟须支持可控种子与确定性复现。
5. 比赛引擎模块化，可替换单阶段而不重写引擎。
6. AI 基于自身处境决策，不得全体一致，不得操纵以服务玩家。
7. 长期模拟（多赛季）不得崩坏、不得通胀。
8. **技术服务于设计**：不得为降低开发难度而擅自简化模拟核心（如把战术降为隐藏系数、把转会降为"点击购买"）；实现复杂时先提简化方案供制定者选择。

---

## 18. 实现状态（MVP 第一阶段，2026-09-29）

> 本节描述**已实现**的最小比赛闭环，与代码一致；未列出的内容仍为 `[TBD]` 或未来阶段。

- **赛程生成**（`src/core/schedule.js`）：轮转法（circle method）生成单循环后镜像为双循环；奇数队自动轮空；开赛日起按固定间隔（暂定 7 天）排轮。赛程属**运行时**（DECISIONS D-01）。
- **球队实力**（`src/core/team-strength.js`）：按阵型各线人数取样，取该线评分最高者均值，输出 `attack / midfield / defence / goalkeeping` 四维（对应 §5 的"多维度聚合"方向；聚合模型 S7 仍待细化）。
- **单场模拟**（`src/core/match.js`，时段制）：90 分钟均分为 **6 个时段**（暂定），逐段按伯努利概率结算进球；期望进球由「进攻/防守比 × 门将因子 × 攻守倾向 × 中场控制 × 主场优势 × 随机波动」合成。阶段函数独立导出（期望进球 / 时段结算 / 进球者选择），便于单阶段替换。
- **战术的最小真实后果**（对应 §6）：`mentality`（defensive/balanced/attacking）真实改变进攻产出；`formation` 决定各线取样人数。均来自数据库/运行时，非隐藏全局系数。
- **随机与确定性**（对应 §11 与第 10 条）：mulberry32 + FNV-1a 种子；比赛种子由（worldId, season, round, 主客队）派生，同一条件必然复现；随机仅扰动目标期望，`NOISE_AMPLITUDE` 限制波动上限。
- **积分与排名**（`src/core/standings.js`）：胜 3 / 平 1 / 负 0；排序按 积分 → 净胜球 → 进球 → ID（确定性）。
- **赛季推进与滚动**（`src/core/simulation.js`）：按天推进，结算所有到期未赛的比赛；一个联赛全部赛完即归档本季最终积分榜（`comp.history`）并生成下一赛季赛程，`state.season` 随联赛滚动。
- **可解释性**（对应第 22 条）：每个进球事件携带时段与成因；已结束赛季的最终积分榜被归档保留，可供回看。
- **暂定参数**（`src/core/sim-config.js`）：基准期望进球 1.35、主场优势 1.18、时段数 6、随机波动上限 0.25。
- **比分分布校准（S12）**：大样本实测（MVP 测试世界 8 队，约 30 个完整赛季 ≈ 1690 场，确定性可复现）——
  场均总进球 **≈ 2.79**（主 1.48 / 客 1.32），主胜 **41%** / 平 **25%** / 客胜 **34%**，双方均进球占比 ≈ 58%。
  位于现实足球区间（顶级联赛大致 2.5–2.9），**无需再调参**。
  - 说明：早期文档曾记"≈ 3.2 偏高"，实为**单赛季（56 场）小样本噪声**——逐赛季场均波动于 2.63–3.13。
  - 已加**校准护栏测试**（`tests/match.test.js`，确定性大样本）：总进球落入 2.4–3.2、平局占比 15%–35%、主胜率高于客胜率；防止后续改动导致结构漂移。
- **明确未实现**：比赛内临场干预（S2/T6b）、换人/伤病/牌（§7–§9、§12）、球员状态与体能更新纳入比赛、AI 决策（§14）、成长与衰退（§15）。

---

## 19. 实现状态（第二阶段 · 第 15 步：球员运行时状态，2026-09-29）

> 本节描述**已实现的数据结构与接口**，与代码一致。**刻意不含任何模拟算法**：
> 成长（§2/§14）、体能/状态/士气更新（§7–§9）、伤病生成与恢复（§12）仍为 `[TBD]`，
> 待制定者决策后接入，故本节不对 `S2–S11、S13` 做任何裁定。

- **模块**：`src/core/player-runtime.js`（Simulation Core，纯逻辑，不依赖 DOM/存储/UI）。
- **职责边界**（决策 A3/D-13）：静态库只读（属性/位置/出生日期/潜力），运行时存增量（能力增减、体能、状态、士气、伤病、统计）；以稳定 `playerId` 关联。
- **创建与关联**：`createGameState` 为**每名静态球员**建立运行时状态；`initializePlayerRuntime` 幂等，用于读取旧档后补齐缺失字段（**保留已有值**，向后兼容 A5）。
- **读（只读派生）**：`getEffectiveAttributes` 返回**完整属性向量**（基础 + 增减，夹取 1–99），刻意**不返回单一"总体评分"**（项目规则第 14 条）。不修改任何输入。
- **写（数据结构级，无模型）**：
  - `recordAppearance(playerId, {minutes, goals, assists})` → 同时累加本赛季与职业生涯统计；校验非负整数与单场上限。
  - `setVitals({fitness, form, morale})` → 0–100 夹取。
  - `applyInjury / recoverInjury` → 伤病状态结构。
  - `applyAbilityDelta(attribute, delta)` → 累计增减（**仅数据结构，非成长算法**）。
  - `resetSeasonStats(seasonNumber)` → 赛季滚动时重置本赛季统计（`simulation.js` 在赛季滚动时调用；职业生涯统计已增量累加，不受影响）。
- **确定性**：以上均为纯数据操作，不含随机；同一输入序列必得同一结果。
- **预留接口**：成长、伤病、体能/状态/士气、合同/转会（合同为独立实体，见 DATABASE_SPEC §2，不在本状态内冗余持有）。
- **测试**：`tests/player-runtime.test.js`（19 项）——创建/读取/修改/保存加载往返、静态库不被修改（深度冻结验证）、有效属性派生与夹取、统计累加与赛季重置、向后兼容补齐。

---

## 20. 实现状态（第二阶段 · 第 16 步：球员成长 / 衰退，2026-09-29）

> 制定者已确认规则（见 `DECISIONS.md` D-14）。本节描述**已实现**的成长/衰退引擎，与代码一致。

- **模块**：`src/core/player-growth.js`（Simulation Core，纯逻辑，不依赖 DOM/存储/UI）。
- **静态依赖**（A1，见 `DATABASE_SPEC` §2/§4）：球员新增 `birthDate`（年龄由 `currentDate` 派生）、
  `potential`（**每属性上限**）、`personality`（5 维人格）。
- **模型**（每赛季结算一次，D-14）：
  - 成长期（年龄 < 该属性分组巅峰）：`delta = 距潜力上限的余量 × 年龄速率 × 修正 × 有界随机`（收益递减，绝不越上限）。
  - 衰退期（年龄 ≥ 巅峰）：`delta = -衰退速率 × 过峰年数 × 抗衰退修正 × 有界随机`。
  - 修正项：人格（职业素养/决心/野心）、状态与士气（温和）、比赛出场（年轻权重）、
    **训练（预留接口，默认 1.0）**、长期伤病（放缓后续成长）。
- **属性分组曲线**（B5/B6）：身体 `pace`（巅峰 27，最早衰退）、技术（30）、门将（32，最晚）。
- **确定性**（C1/C2）：种子 = `hash(worldId, playerId, season)`；随机仅**有界扰动**速率；同一赛季**幂等**。
- **超预期成长**（C3）：低概率加成，**绝不突破 `potential[attr]`**。
- **接线**：`simulation.js` 赛季滚动时**先** `developPlayers`（用已结束赛季的统计与年龄）**再** `resetSeasonStats`。
- **运行时字段**：`players[].growth = { lastEvaluatedSeason, injuryPenaltySeasons }`；`GAME_STATE_SCHEMA_VERSION` 2→3（加法式）。
- **长期护栏**（D1/D2）：实测（MVP 测试世界 8 队）属性均值 50 赛季 51.6 → 9.0 **单调不升**；10/50/100 赛季无越界/NaN。
  （第 18 步起，成长结果经**有效属性**进入球队实力与比赛，见 §5 / §22。）
- **暂定参数**：见 `sim-config.js` `PLAYER_GROWTH_CONFIG`（可统一调参，不改算法结构）。
- **明确未实现**：训练系统本体（B1 仅预留接口）、退役/新生代/青训（防膨胀 D1 不得借道未批准系统）。
- **测试**：`tests/growth.test.js`（18 项）——确定性、潜力上限、成长/衰退方向、出场/士气/人格/训练/伤病修正、
  幂等、静态库只读、字段校验、防膨胀（10/50/100）。

---

## 21. 实现状态（第二阶段 · 第 17 步：伤病生命周期，2026-09-29）

> 制定者已确认规则（见 `DECISIONS.md` D-15）。本节描述**已实现**的伤病引擎，与代码一致。

- **模块**：`src/core/player-injury.js`（Simulation Core，纯逻辑，不依赖 DOM/存储/UI）；配置在 `sim-config.js` `INJURY_CONFIG`。
- **来源（比赛产生）**：`simulation.js` `#playFixture` 赛后调用 `resolveMatchInjuries`——对双方**全队球员**逐一判定，
  每方每场至多新增 `MAX_INJURIES_PER_MATCH_SIDE`（=1）人。**当前无首发/换人系统，故以全队为参赛集合**（已知限制）。
- **类型 / 严重度（配置驱动）**：`TYPES` 8 种（含 category/baseDays/dayRange）；严重度 `minor(≤14d) / moderate(≤45d) / severe(>45d)`。
  逻辑**不硬编码**具体类型；天数由类型 + 严重度 + injuryProneness + 年龄/体能 + 有界随机计算，夹取进该档（severe 上限 240 天）。
- **恢复（确定性）**：`simulation.js` `advanceDay` 每日调用 `tickInjuries` → `decrementInjuryDays` 递减 `daysRemaining`，
  归零自动 `recoverInjury`（`status → fit`）。伤病**不允许永久存在**。
- **vitals（不改基础属性）**：发生即降 fitness/form/morale；伤病期间 fitness 日降、form 向 0 冻结衰减、长期伤病 morale 下降；
  康复后 fitness 上限 80（不立即满值）、form 由比赛重建、morale 向基线温和恢复。静态库只读（规则第 6 条）。
- **成长惩罚解耦**：`applyInjury` 在 severe 时写入 `growth.injuryPenaltySeasons`；成长系统**只消费**该字段（每季 -1）。
  两系统**不互相推断状态**（修复第 16 步的 `daysRemaining >= 90` 隐患）。
- **确定性**：种子 = `hash(worldId, fixtureId/date, playerId, 'injury')`；相同输入结果一致（`tests/injury.test.js` 验证）。
- **运行时字段**：`players[].injury = {status, type, category, severity, daysRemaining, totalDays, since}`；
  `players[].injuryHistory = {recurrenceCount, lastInjuryDate, lastInjuryType}`（定长，不无限增长）；`GAME_STATE_SCHEMA_VERSION` 3→4。
- **空阵容保护**：`computeTeamStrength` / `#buildSide` 过滤伤病球员（`isAvailable`）；某线不足用现有可用者，无候选回退中性值，无 NaN/负数。
- **明确未实现**：完整训练系统、首发/换人、青年队补位、紧急转会、医疗团队/设施、复杂康复、比赛内伤病事件链、无限伤病历史。
- **测试**：`tests/injury.test.js`（21 项）——配置驱动、严重度分档、比赛产伤（整季）、每日递减/自动恢复、vitals、
  injuryProneness 上限、复发信息定长、确定性、成长惩罚起止/不重复/不永久、旧档 normalize、空阵容保护、无 NaN/Infinity/负数（整季 / 50 / 100 赛季）。

---

## 22. 实现状态（第二阶段 · 第 18 步：赛季级球员生态联调，2026-09-29）

> 制定者已确认规则（见 `DECISIONS.md` D-16）。本节描述**已实现**的生态闭环，与代码一致。
> 核心目标：**打通已有系统之间的闭环**，不新增玩法系统。

- **闭环链路**：比赛 → 出场/进球统计 → fitness/form → 伤病 → 可用性 → 有效属性 → 球队实力 → 比赛结果 →
  赛季统计 → 成长/衰退 → 下一赛季。
- **修复的断点**：
  1. **实力改用有效属性**：`computeTeamStrength` / 进球者判分经 `getEffectiveAttributes`（基础 + deltas，夹取 potential 与 1–99），
     使成长/衰退真正进入比赛（原读静态基础属性，成长无效）。
  2. **出场统计接入**：`simulation.js#playFixture` 消费 `simulateMatch().events`，对**出场集合**调用 `recordAppearance`（90 分钟 + `scorerId` 进球）。
  3. **赛后 vitals 反馈**：出场者体能耗 `MATCH_LOAD_CONFIG.FITNESS_COST`；form 向基线（50）逼近（有界）。
- **出场集合**：`selectMatchSquad`（按阵型各线取**有效评分**最高者，GK×1，伤病剔除）——即「比赛模拟实际使用的球员」。
  为**单一可替换点**，未来以正式首发/换人系统替换即可；统计层（`recordAppearance`）无需重写。
- **体能恢复**：改为**分数式**（按缺口比例，`RECOVER_FRACTION_PER_DAY`），使健身球员在比赛消耗后不会每周回到满值；
  休赛期趋近满值；康复瞬间仍受 `RECOVERY_FITNESS_CAP` 约束。
- **确定性**：比赛种子不变；赛后统计/vitals 为确定性运算 → 同输入仍完全可复现。
- **参数**：`sim-config.js` `MATCH_LOAD_CONFIG`（分钟/体能消耗/form 恢复）；`INJURY_CONFIG.FITNESS`。
- **长期护栏（实测，MVP 测试世界 8 队）**：
  - 1/10/50/100 赛季：有效属性 ∈[1,99] 且 ≤ potential、vitals ∈[0,100]、球队实力有限且 ≥1、无 NaN/Infinity/负值；
  - 出场/进球统计真实累积、随赛季滚动重置 season、保留 career；
  - 世界均值 1→10 季约 55.6→57.9，随后随老龄化回落（50 季 15.6、100 季 1）。
- **已知范围（本轮不修复）**：无退役/新生代/青训 → 长期世界均值与实力单调回落至下限（100 季比赛趋于 0-0）。
  属既有成长/衰退规则的确定性后果，按制定者指示保留为后续独立步骤（退役 + 新生代 + 人口生态平衡）。
  **该项已由 §23（第 19 步）解决。**
- **明确未实现**：首发/替补/换人、训练系统本体、青年队、紧急转会、退役/新生代。
- **测试**：`tests/ecosystem.test.js`（16 项）——出场统计真值、进球与比分一致、deltas→有效属性→实力→比赛、
  form 恢复、fitness 消耗与恢复、伤病不永久、10/50/100 季稳定、存档往返一致、确定性、参数守卫。

---

## 23. 实现状态（第二阶段 · 第 19 步：退役 + 新生代 + 世界人口生态平衡，2026-09-29）

> 制定者已确认规则（见 `DECISIONS.md` D-17）。本节描述**已实现**的生命周期引擎，与代码一致。
> 目标：为世界建立"退出/进入"通道，消除长期（50–100 赛季）世界均值坍缩。

- **模块**：[player-lifecycle.js](file:///workspace/src/core/player-lifecycle.js)（退役/新生代/人口补位）；
  访问器与容器在 [player-runtime.js](file:///workspace/src/core/player-runtime.js)；配置在 `sim-config.js`（`RETIREMENT_CONFIG` / `GENERATION_CONFIG`）。
- **统一世界球员访问器**（唯一遍历入口，替代直读 `state.static.players`）：
  `getWorldPlayers(state)`（静态未退役 ∪ 生成未退役）、`getTeamPlayers(state, teamId)`、
  `getPlayerProfile(state, id)`（静态优先，其次 `runtime.generated`）、`isRetired(state, id)`。
  `team-strength` / `player-growth` / `player-injury` / `player-runtime` 已全部迁移。
- **退役**：软区间**线性概率** + 硬上限强制；曲线 FW 32/37、DF 33/38、MF 33/38、GK 35/40；
  RNG 种子 `hashSeed(worldId|retire|season|playerId)`（可复现）；不使用能力/伤病史；已退役者移入 `runtime.retired`（保留 career/终值快照），
  `playerId` 永久失效。
- **新生代**：每赛季批次；年龄 17–19；同位置**静态模板 + 三路独立有界抖动**（base ±3 / headroom ±2 / personality ±3）；
  `base ≤ potential ≤ 99`；默认 vitals（100/50/50）、健康、空伤病史；ID `ply_g_<seq>`（序号入档、永不回退）。
- **首次成长时机**：`growth.lastEvaluatedSeason = 生成时 prevSeason`（**非 0**）→ 生成当次不成长，**完整下一赛季结束后**首次成长。
- **人口补位（Step 26B 更新；落地 DECISIONS D-24 的 D16）**：**边界语义（boundary），不再是精确目标**。
  - **World**：`WORLD_MIN_POPULATION`（防坍缩最低线；MVP = 8 × `ROSTER_CONFIG.MIN_PLAYERS` = 96，且不高于「实际俱乐部数 × 阵容下限」，使小规模世界不被强制膨胀）。只回答「世界是否缺人」。
  - **Club**：`ROSTER_CONFIG` —— `MIN_PLAYERS` 12 / `MAX_PLAYERS` 24 / `PREFERRED_PLAYERS` 14（**软偏好，非硬目标**）/ `MIN_GK` 1 / `MIN_BY_POSITION` DF4·MF4·FW2（结构最低 11 + 1 缓冲 = 12）。位置缺口优先于人数缺口且驱动生成位置。
  - **绝不超过 MAX 自动裁员**（仅作 over-cap 诊断）；只生成不删除；**不设自由球员池**；生成**绝不创建无归属 active 球员**（World 安全网亦只在现有 Club 中确定性选承接目标）。
  - `runtime.populationTarget` **退出人口业务逻辑**（仅作 legacy 快照保留，`GAME_STATE_SCHEMA_VERSION` 仍为 10）。
- **赛季滚动顺序**（`simulation.js`）：结算上一赛季成长 → 退役+归档 → 计算缺口并生成（属下一赛季）→ 重置本赛季统计 → 进入下一赛季。
- **确定性**：退役/生成均为项目 deterministic RNG；同（库+档+种子）完全可复现。
- **开关**：`RETIREMENT_CONFIG.ENABLED`（默认 true）；false 时跳过退役与新生代，结构不变、行为回到 §22。
- **运行时常量**：`generated` / `retired` / `nextGeneratedSeq` / `populationTarget`；`GAME_STATE_SCHEMA_VERSION` 4→5（加法式，旧档兜底）。
- **长期护栏（实测，MVP 世界 8 队；10/50/100/200 赛季；Step 26B 边界语义后）**：人口稳定于 **96**（= 8 × `MIN_PLAYERS`，**非 exact-112**）、
  俱乐部 12–13 人、GK 恒 8、无重复 ID、**不坍缩也不膨胀**；`populationTarget` legacy 快照仍随档往返。
- **明确未实现**：自由球员池、转会、合同、青训梯队、预备队、名人堂 UI、财政、教练、多联赛、完整伤病史、
  fixture 级 `recordAppearance` 防重、历史存档裁剪（均属后续步骤）。
- **测试**：`tests/lifecycle.test.js`——退役概率/曲线/硬上限/确定性/归档、
  新生代字段/首次成长时机、人口边界（World/Club 分离，含 Step 26B 行为测试 A–I）、小型世界、访问器、退出/进入系统联动、
  v4→v5 迁移、序号防回退、存档往返、ID 唯一不复用、10/50/100/200 赛季稳定。

---

## 24. 实现状态（第二阶段 · 第 20 步：玩家阵容 / 战术选择，2026-09-29）

> 制定者已确认规则（见 `DECISIONS.md` D-18）。本节描述**已实现**的玩家阵容系统，与代码一致。
> 目标：建立「玩家管理球队 → 比赛 → 结果反馈」的**最小可玩闭环**——玩家选择阵容/阵型/战术，真正进入比赛模拟。

- **模块**：[player-lineup.js](file:///workspace/src/core/player-lineup.js)（阵容解析/校验/清洗/修复）；
  比赛接入在 [team-strength.js](file:///workspace/src/core/team-strength.js) `resolveMatchSquad` 与 [simulation.js](file:///workspace/src/core/simulation.js) `#buildSide`；
  配置在 `sim-config.js` `LINEUP_CONFIG`。
- **数据结构（进入 runtime，非 UI 状态）**：
  - `runtime.managedClubId: string|null`——玩家管理球队，**默认 null**（不自动选择首支球队；未选择时全部走自动选阵）。
  - `runtime.clubs[].lineup = { starters: string[], bench: string[] }`——首发/替补的 **playerId** 列表；**不自动创建**。
  - `runtime.clubs[].tactics = { formation, mentality }`——阵型取自 `FORMATIONS`，战术倾向取自 `MENTALITY`。
- **两种选择路径（统一入口 `resolveMatchSquad`）**：
  - **玩家路径**：`teamId === runtime.managedClubId` 且已保存首发 → `repairSquadForMatch` 按当前阵型**严格修复**玩家阵容；
    修复失败（某线无健康球员）→ 记录 `lineup_fallback` 事件并**回退自动选阵**（不静默使用错误数据）。
  - **AI 路径（未变）**：其余球队继续使用 `selectMatchSquad`（按阵型各线取有效评分最高者）。
- **阵容合法性规则**：
  - 首发严格匹配阵型：GK=1，DF/MF/FW 等于 `FORMATIONS` 各线人数（合计恒 11）；替补上限 `LINEUP_CONFIG.BENCH`（=7）。
  - 首发与替补**去重**；不存在 / 已退役 / 非本队 playerId **一律清洗剔除**。
  - **伤病球员不得进入实际首发**（比赛时以同位置健康球员顶替）；允许进入替补席；玩家选择被保留，康复后可再次首发。
  - 清洗 `cleanLineup` 保证结构合法；校验 `validateLineup` 返回**可解释问题列表**（UI 展示，不阻塞）。
- **替补席**：仅**存储与展示**，**本步骤不参与比赛、不参与换人**（UI 明确标注"本步骤暂不参与换人"；换人引擎属 out-of-scope）。
- **真实影响比赛**：比赛实力基于**本场实际出场集合**（`computeTeamStrength(state, teamId, tactics, squad)`），
  故阵型（各线取样人数）与阵容（具体球员）变化会改变实力，进而改变期望进球与结果；战术倾向经 `MENTALITY` 倍率影响期望。
  **不重写 `match.js` 的比分算法**——只把玩家阵容/战术作为输入喂入既有引擎。
- **自愈**：赛季滚动（退役/离队后）调用 `repairManagedLineups` 剔除失效引用；比赛时 `repairSquadForMatch` 按阵型回填。
- **存档**：`GAME_STATE_SCHEMA_VERSION` 5→6（**加法式**，向后兼容）；旧档经 `initializeClubRuntime` 兜底
  （`managedClubId → null`、`lineup → {starters:[],bench:[]}`、阵型/战术非法回退默认）。
- **Controller API**：`getManagedClubId` / `setManagedClub` / `setFormation` / `setMentality` / `setLineup` /
  `assignLineupPlayer` / `autoFillManagedLineup`；`getSnapshot()` 新增 `managedClubId / clubs / formations / mentalities / managedClub`。
- **UI**：`app-view.js`「我的球队」卡片——选择管理球队 → 阵型/战术下拉 → 自动填充/清空 → 首发/替补/其余球员分区与「首发/替补/移除」操作。
- **明确未实现（out-of-scope）**：转会、合同、财政、工资、身价、球探、教练、青训、预备队、AI 转会市场、
  多联赛、升降级、杯赛、红黄牌、换人引擎、大规模比赛表现系统、名人堂、新闻系统。
- **测试**：`tests/lineup.test.js`（22 项）——阵容保存读取、首发/替补人数、位置合法性、GK 约束、重复/伤病/退役/非本队/不存在引用、
  AI 自动选阵不受影响、玩家阵容真实出场、阵型与战术真实影响比赛、赛季滚动自愈、save/load 回归（v6 兜底）、10/50 赛季长期稳定。

---

## 25. 实现状态（第二阶段 · G0：运行期成员关系层，2026-09-29）

> 制定者已确认规则（见 `DECISIONS.md` D-19）。本节描述**已实现**的运行期成员关系层，与代码一致。
> 目标：把 player→club / club→league 从"主要依赖静态数据库字段"升级为**统一、可变、可持久化的运行期唯一真相源**，
> 为后续财政、转会、合同、AI、升降级与赛事扩展提供唯一基础（本阶段**不实现**这些玩法）。

- **模块**：[membership.js](file:///workspace/src/core/membership.js)（Simulation Core，**叶子模块**：不 import player-runtime / game-state，避免循环依赖）。
- **数据结构（唯一真相源）**：
  ```
  runtime.membership = {
    schema: 1,
    players: { [playerId]: clubId },   // active player → club
    clubs:   { [clubId]:  leagueId }   // club → league
  }
  ```
  - active 球员**必须**属于一个 club（不实现自由球员）；退役球员一律移出 active membership。
  - 全部初始化/迁移/修复**确定性**（无随机、无时间戳）。
- **单一真相源规则**：运行期**任何**归属判断只经 `membership`；`static.players[].teamId` / `static.teams[].leagueId` /
  `runtime.generated[].teamId` 降级为**初始化种子 / 兼容镜像**（`generated.teamId` 仍写入，但运行期不用于判断）。
- **API**：`getPlayerClub` / `getClubPlayers` / `getClubLeague` / `getLeagueClubs` / `isActiveMember` /
  `initializeMembership` / `addPlayerMembership` / `removePlayerMembership` / `validateMembership` / `assertMembershipValid`。
- **访问器改造（签名不变）**：`player-runtime.getTeamPlayers` 改由 `getClubPlayers` 驱动；`getPlayerProfile` 的 `teamId` 取自 membership；
  `getWorldPlayers` 顺序**保持不变**（静态库原序 → 新生代插入序）——**顺序契约**保证 Step 16–20 的确定性/行为等价。
  `game-state.getTeamsByLeague` 改经 `getLeagueClubs`；`computePopulationTarget(state)` 改经成员关系统计（初始化结果与 Step 19/20 一致）。
- **生命周期接入**：新生代 `generatePlayer` **同一次事件内**写入 `generated` 与 membership（兼容镜像 + 权威归属）；
  退役 `archiveRetired` 从 active membership **移除**（退役不复活）。
- **初始化顺序**：`createGameState` = 建 clubs → 建 players → **initializeMembership** → 计算 populationTarget → 建 competitions。
- **读档校验**：`controller.load` 在补齐运行时后执行 `initializeMembership` + `assertMembershipValid`；
  **致命问题明确报错**（缺归属 / 无效 league / 退役残留），非致命问题记为 diagnostics，**不静默继续模拟**。
- **存档**：`GAME_STATE_SCHEMA_VERSION` 6→7（**加法式**）；v6 旧档经 `initializeMembership` 从静态/新生代种子建立 membership。
- **明确未实现（out-of-scope）**：转会、合同、自由球员、财政、工资、身价、AI 转会、升降级、多联赛、杯赛。
- **测试**：`tests/membership.test.js`（19 项）——初始化、访问器等价与顺序契约、唯一真相源（篡改静态/镜像不改归属）、
  generated 同事件一致、退役出队、club→league、确定性、v6→v7 迁移、save/load 往返、校验器（致命/诊断）、
  managedClub/lineup 不受影响、10/50/100/200 赛季长期稳定。

---

## 26. 实现状态（第二阶段 · G1a：比赛球员参与结构，2026-09-29）

> 制定者已确认规则（见 `DECISIONS.md` D-20）。本节描述**已实现**的比赛参与模型，与代码一致。
> 目标：把"谁在 squadIds 里 = 出场 90 分钟"的**隐式**模型升级为统一的 `MatchResult.involvements`；
> **不新增玩法**，不实现换人、评分、射门/控球/传球。

- **模块**：[match.js](file:///workspace/src/core/match.js)（事件 + `buildInvolvements`）、
  [simulation.js](file:///workspace/src/core/simulation.js) `#applyPostMatch`（消费 involvements）、
  [player-runtime.js](file:///workspace/src/core/player-runtime.js)（统计线扩展）。
- **`MatchResult` 结构**：
  ```
  { matchSeed, homeGoals, awayGoals,
    events: [ { minute, teamId, type, actorId, assistId, segment, reason } ],
    involvements: { [playerId]: { side, role, position, minutes, goals, assists, yellow, red } } }
  ```
  - **当前固定模型**：`role='starter'`、`minutes=90`、**不产生 `sub`**；未出场球员**不写入** involvements。
  - 结构为未来 **D（换人/临场）** 预留 `role/minutes`，但本期不实现换人。
- **事件模型**：统一为 `actorId`（替代原 `scorerId`）；`assistId` 无可靠来源，恒为 `null`。
  **不新增随机源**、**不改比分算法**；`yellow/red/assist` 结构可表达但**当前恒为 0**（不制造随机牌/助攻）。
- **统计迁移**：`recordAppearance` 可消费 `minutes/goals/assists/yellow/red`；`createStatLine` 统计线新增
  `yellow` / `red`（当前恒 0）；`normalizeStatLine` 旧档补齐为 0。
- **兼容（红线条目）**：
  - Step 18：fitness 消耗 / form 更新口径**不变**（`FITNESS_COST` / `FORM_RECOVER_RATE`）。
  - Step 20：`resolveMatchSquad` / managed lineup / bench 存储 / 首发 11 人选择逻辑**不变**。
  - Step 17：`resolveMatchInjuries` **仍对全队**判定，**未**迁移到 involvements。
  - 比分算法 / 比赛种子 / 6 时段进球逻辑**不变**。
- **存档**：`GAME_STATE_SCHEMA_VERSION` 7→8（**加法式**）——唯一原因是统计线新增持久化字段 `yellow/red`；
  旧档经 `normalizeStatLine` 补齐为 0，`MatchResult.involvements` **不进入存档**（仅运行期产物）。
- **明确未实现（out-of-scope）**：换人 / 替补真正上场、临场战术、球员评分、射门/控球/传球系统、AI 决策、
  转会、合同、财政、杯赛、多联赛、赛季驱动重构（G1b）。
- **测试**：`tests/involvement.test.js`（12 项）——11 starter involvement、minutes=90、非出场不写入、
  goal→actorId 与多球累计、assists/yellow/red 恒 0、position 一致、只消费 involvements、
  season/career 聚合一致、fitness/form 一致、确定性、managed lineup 不受影响、save/load continuation。

---

## §27 赛季日历与赛季边界（G1b①）

- **模块**：[season.js](file:///workspace/src/core/season.js)（叶子模块：只读 state、无副作用、无随机、不入档）、
  [simulation.js](file:///workspace/src/core/simulation.js) `#rollFinishedSeasons`（由边界驱动）。
- **SeasonCalendar（派生视图）**：`getSeasonCalendar(state)` 返回
  `{ season, startDate, endDate, status }`，**当前仅从唯一联赛 competition 投影**：
  - `season = competition.season`；
  - `startDate = competition.seasonStart`；
  - `endDate = max(competition.fixtures[].date)`；无有效赛程时为 `null`；
  - `status`：有赛程时 = `competition.status`（`scheduled`/`in_progress`/`finished`）；
    无赛程时为 `finished`（若 comp 已 finished）否则 `empty`。
- **边界判定**：`isSeasonBoundaryReached(state)` =
  `endDate !== null && state.currentDate >= endDate && status === 'finished'`。
  用 `>=`（**非 `>`**）：确保最后一场比赛日**当天**完成 rollover，与改造前同一日触发。
- **rollover 编排**：`advanceDay` 外部顺序**不变**（`+1 天 → tickInjuries → playDueFixtures → rollover`）。
  边界到达时：归档当前赛季（`comp.history`）→ 创建下一赛季（`startDate = currentDate + SEASON_GAP_DAYS(30)`）→
  更新 `state.season`（= `comp.season`）→ **执行一次**全局副作用，顺序固定：
  `developPlayers(prevSeason)` → `runPlayerLifecycle({from: prevSeason, to: nextSeason})` →
  `repairManagedLineups(state)` → `resetSeasonStats(nextSeason)`。
- **空联赛**：无有效赛程 ⇒ `endDate=null`、`status='empty'` ⇒ **永不 rollover**，`state.season` 不变。
- **兼容（红线条目）**：`state.season` 字段名/持久化**保留**；单联赛下
  `state.season ≡ competition.season ≡ getSeasonCalendar(state).season`（初始化/迁移瞬间除外）；
  赛程轮转、`ROUND_INTERVAL_DAYS`、fixture 顺序与日期计算、`deriveMatchSeed` 的 season 输入、
  growth/lifecycle RNG、`SEASON_GAP_DAYS` **全部不变**。
- **存档**：`GAME_STATE_SCHEMA_VERSION` **保持 8**——SeasonCalendar 为派生视图，**不新增持久化对象**，无需迁移。
- **明确未实现（out-of-scope，属 G1b②）**：多联赛 / 多 competition 并行、杯赛、淘汰赛、升降级、
  Competition Rules 数据化、多竞赛统一赛季边界、competition type dispatch、新 schedule 类型。
- **测试**：`tests/season.test.js`——SeasonCalendar 投影、边界（< / = / > / 空联赛）、单联赛行为等价（改造前基线指纹）、
  副作用一次性与顺序、确定性、save/load（季中/边界前/边界日/新赛季后）、10/50/100 赛季长期回归。

---

## §28 球员比赛表现（Step 21-A）

- **模块**：[match.js](file:///workspace/src/core/match.js) `applyMatchPerformance`（独立表现流）、
  [sim-config.js](file:///workspace/src/core/sim-config.js) `MATCH_PERFORMANCE_CONFIG`、
  [player-runtime.js](file:///workspace/src/core/player-runtime.js)（统计线扩展）、[simulation.js](file:///workspace/src/core/simulation.js) `#applyPostMatch`（透传）。
- **字段**：`involvements[playerId]` 新增 `shots` / `shotsOnTarget` / `rating`（`assists`/`yellow`/`red` 由恒 0 变为实际生成）。
  `events` **契约不变**（仍只记录 `goal`，`assistId` 保持 `null`）。
- **RNG 隔离（核心）**：比分由 `simulateSegments` 的单一比分 RNG 决定（消费顺序**不变**）；
  表现由**独立派生 RNG**在**比分与 goal events 确定后**生成：
  - 逐球员：`hashSeed(`${matchSeed}|perf|${side}|${playerId}`)`（增减球员不改变他人流）；
  - 逐进球：`hashSeed(`${matchSeed}|assist|${side}|${minute}|${scorerId}`)`（每球至多 1 次助攻）。
  `rng.js` / `deriveMatchSeed` / 比分算法**均不修改**；不新增全局随机源。
- **守恒（内建）**：`shots >= shotsOnTarget >= goals`（进球计入射正）；`Σassists <= Σgoals`；
  助攻者同队、非进球者本人、必为出场球员；`yellow`/`red` 为非负整数且单场每人 ≤1。
- **rating**：确定性、可解释、固定上下界 `[4.0, 10.0]`（`MATCH_PERFORMANCE_CONFIG.RATING`）：
  `BASE + goals×GOAL + assists×ASSIST + shotsOnTarget×SOT − yellow×YC − red×RC + 胜负调整 + 位置加成`，再夹取。
  **不依赖 form/morale，不反向写入 vitals/growth**。
- **数据流（不变）**：`simulateMatch → MatchResult.involvements → #applyPostMatch → recordAppearance`（G1a 架构，仅透传新字段）。
- **存档**：`GAME_STATE_SCHEMA_VERSION` **8→9**（加法式）——统计线新增 `shots`/`shotsOnTarget`/`ratingSum`
  （`ratingSum = Σ round(rating×10)`，均值 = `ratingSum/appearances/10`）；旧档经 `normalizeStatLine` 补 0。
- **明确未实现（out-of-scope）**：keyPasses、xG、possession、pass%、比赛报告、Man of the Match、UI 展示、
  表现影响 form/morale/growth/retirement、换人/替补、新能力属性或能力体系。
- **测试**：`tests/performance.test.js`（11 项）——单场确定性、比分守恒、射门守恒、助攻合法性、cards 有界、
  rating 边界与 ratingSum 累计、season/career 累计与 reset、save/load（含 schema 8→9 与旧档补 0）、
  RNG 隔离（比分/events 黄金指纹）、10/50/100 赛季长期稳定。

---

## §29 球员表现数据消费层（Step 21-B）

- **目标**：把 21-A 已持久化的球员 `season/career` 表现正式接入 **controller 快照 → UI**，**仅消费层，无新 schema**。
- **模块**：
  - [player-runtime.js](file:///workspace/src/core/player-runtime.js) `getPlayerStatsView(state, playerId)` / `deriveAverageRating(ratingSum, appearances)`
    （只读派生视图，字段安全规范化，返回新对象、与 runtime 无引用共享）；
  - [game-controller.js](file:///workspace/src/controller/game-controller.js) `#managedClubView`（球员条目新增 `stats`）；
  - [app-view.js](file:///workspace/src/ui/app-view.js) `statsLine`（紧凑、可换行的赛季统计行）。
- **快照字段**：`managedClub.{starters,bench,squad}[].stats = { season, career }`，各项含
  `appearances / minutes / goals / assists / yellow / red / shots / shotsOnTarget / averageRating`。
- **averageRating**：`ratingSum / appearances / 10`（两位小数）；`appearances === 0` ⇒ `null`，UI 显示 `—`（无 NaN/Infinity）。
  **`ratingSum` 不外泄**，UI 不自行计算。
- **分层约束**：`runtime → core helper → controller snapshot → view`；UI **不直读** `state`/runtime。
- **存档**：schema **保持 9**，**不新增迁移**；旧档靠既有 `normalizeStatLine` + 视图层安全默认值兼容。
- **明确未实现**：match history、逐场持久化、逐场 events、比赛报告、进球者历史、全联盟排行榜、球员详情页、
  UI 直读 state、schema 升级；21-A 的 RNG/评分公式/比分模型**未改动**。
- **测试**：`tests/consumption.test.js`（10 项）——season/career 读取、averageRating 派生与 `appearances=0`、ratingSum 不外泄、
  `shots>=shotsOnTarget`、旧字段安全 normalize、快照与 runtime 无引用共享、非管理球队不被展示、lineup/injury/人口不受影响。

---

## §30 合同 / 财政 / 转会 语义地基（Step 23 冻结，未实现）

> **状态：设计冻结。** 本章**仅记录已确认语义**，**不改变 schema（仍为 9）、不落地任何代码**。
> 决策编号 D1–D20 见 [DECISIONS D-24](file:///workspace/docs/DECISIONS.md)。`[已定]` = 已冻结；`[TBD]` = 待定。

- **边界（D1/D2/D6/D14）**：
  - `membership` = 当前注册/所属俱乐部（**唯一业务真相**）；
  - `contract` = 球员与俱乐部的合同关系（`runtime.contracts[playerId]`，v1 每球员至多一个 active）；
  - `finance` = 俱乐部经济状态；
  - `transfer` = 改变上述三者的 **domain operation**（`plan → validate → commit → assert invariants`）。
- **Contract（D2/D4/D5）** `[已定]`：结构 `{ playerId, clubId, startSeason, endSeason, wage, status }`；
  **整数赛季**起止；`startSeason/endSeason` 以 `state.season` 为锚；**每赛季工资**（合同属性）；v1 **不自动续约**；不建合同历史。
- **Free Agent（D3）** `[已定]`：v1 允许 **active free agent**；不属任何 club（membership 不记 clubId），以 `contract.status='free_agent'` 表示；
  **禁止** membership / contracts / freeAgents **三套并列业务真相**（允许内部辅助机制，但不得成为第三套权威）。
- **Finance（D6/D13/D17）** `[已定]`：`club.finance = { cash, wageBudget, transferBudget }`；**仅 cash 为余额**，其余为约束；
  v1 **不建复杂收入**；**工资不从 cash 扣除**（wage 仅作合同属性 + wageBudget 约束）。
- **Transfer（D8/D9/D18）** `[已定]`：**永久开放**（无窗口）；费用用**确定性模板**（能力/年龄/位置），不建独立 value 系统；
  **允许伤病球员转会**且**不重置伤病**；**不新增随机源**。
- **Squad / Population（D7/D16）** `[已定]`：引入俱乐部阵容 **lower/upper bound**；
  **废弃**"精确恢复到 112"——**世界人口健康边界**与**俱乐部阵容上下限**分离；转会/释放/自由身**不被下季自动补充立即抵消**。
- **Retirement（D11）** `[已定]`：退役移除 active contract + 移出 membership，归档保存最终合同快照；退役者不进转会市场/active contract。
- **Season Boundary 集成（预留，D4/D16）** `[建议]`：合同过期判定置于 rollover 内、`processRetirements` 之后、补位之前；
  **不得**改变现有顺序 `developPlayers → lifecycle → repairManagedLineups → resetSeasonStats` 的既有部分。
- **Invariants（D19）** `[已定]`：读档后校验（确定性、无随机）— membership↔`contract.clubId` 一致、retired 无 active contract、
  无重复 active contract、无无效 clubId/playerId、finance 数值合法、roster/membership 无重复或悬空。
- **Save / Migration（D12）** `[已定]`：Contract/Finance 落地时再做 **schema 9→10**（加法式）；旧档 112 名 active 球员补**确定性初始合同**；
  迁移不破坏既有比赛/属性/成长/伤病/退役状态。
- **RNG（D20）** `[已定]`：Contract/Finance/Transfer v1 **不新增随机源**；不得影响既有比赛/成长/伤病 RNG 序列。
- **未决（D10）** `[TBD]`：生成球员的合同语义（入队+初始合同 / 先自由身 / 模板继承）留待与青年队 / 自由球员市场 / AI 转会一并决定。
- **本阶段未实现**：Contract、Finance、Transfer、AI Transfer、Free Agent 市场、UI、schema 变更。

---

## §31 合同 / 财政地基（Contract / Finance Foundation，Step 25 已实现）

- **状态**：已实现（**仅 Foundation**）。Transfer、Free Agent 运行时生命周期、Population 政策、AI 均**未实现**。
- **模块**：[contract.js](file:///workspace/src/core/contract.js)、[finance.js](file:///workspace/src/core/finance.js)、
  [game-state.js](file:///workspace/src/core/game-state.js)、[game-controller.js](file:///workspace/src/controller/game-controller.js)、
  [player-lifecycle.js](file:///workspace/src/core/player-lifecycle.js)。
- **Contract（D2/D4/D5）**：`runtime.contracts[playerId] = { playerId, clubId, startSeason, endSeason, wage, status }`；
  `status ∈ { 'active', 'free_agent' }`；期限为**整数赛季**；`wage` 为**每赛季工资**；v1 **不自动续约**。
  accessor：`getPlayerContract / isFreeAgent / isContracted`（纯读）；op：`createContract / terminateContract`。
- **Free Agent（D3）** `[结构已就绪，运行时未启用]`：`status='free_agent'` ⇒ `clubId=null` 且 membership 无归属；
  **migration 不创建 free agent**（Free Agent 生效属 Step 27）。**未引入第三套业务真相**（membership=归属真相，contract=合同真相）。
- **Finance（D6/D13/D17）**：`runtime.clubs[clubId].finance = { cash, wageBudget, transferBudget }`；
  **仅 cash 为余额**，其余为约束；`getSpendableCash = min(cash, transferBudget)`；v1 **不从 cash 扣工资**。
- **确定性（D20）**：`CONTRACT_CONFIG` / `FINANCE_CONFIG` 为确定性模板；`stableHash` 为**纯算术**（非 RNG）；
  不新增随机源，不影响 match/growth/injury RNG。
- **Retirement（D11）**：`archiveRetired` 保存**最终合同快照**（`retired[id].contract`，复制值）并 `terminateContract`；退役者不得持有合同。
- **归一化与不变量**：`normalizeContracts`（幂等、确定性、不覆盖已有、不创建 free agent）、`normalizeFinance`（幂等、修正非法值、保留合法值）；
  `assertContractInvariants` / `assertFinanceInvariants` 在 `createGameState` 与 `controller.load` 后执行（不静默）。
- **存档（D12）**：`GAME_STATE_SCHEMA_VERSION` **9→10**（加法式）；旧档经 normalize 确定性补齐；沿用 idempotent initialize/normalize 模式，**未改 `SAVE_FORMAT_VERSION`**。
- **明确未实现**：Transfer / release / transfer window / AI 转会 / roster bounds / Population 政策（D16）/ 工资现金扣除 /
  生成球员合同最终语义（**D10 仍 TBD**）/ UI。
- **测试**：`tests/foundation.test.js`（16 项）——合同创建/终止/归一化/不变量、free_agent 结构、退役清理、
  财政初始化/归一化/spendable、schema 9→10 迁移、save/load continuation、比赛黄金指纹不变、10/50/100 长期。

---

## §32 Free Agent + Membership Integration（Step 27A 设计冻结 · Step 27B 已实现）

- **状态**：**设计已冻结（Step 27A）；运行时已实现（Step 27B）**。**仍未实现**：Transfer、Contract Expiry、续约、AI 转会、签约费、工资现金流、**D10（Deferred）**、Free Agent 市场 UI。
  schema 仍为 **10**，`SAVE_FORMAT_VERSION` 仍为 **1**，未新增 RNG。决策编号见 [DECISIONS D-26](file:///workspace/docs/DECISIONS.md)。
- **模块**：domain operation 层 [free-agent.js](file:///workspace/src/core/free-agent.js)（`releasePlayerToFreeAgent` / `signFreeAgent` /
  `getFreeAgents` / `getFreeAgentCount` / `selectFreeAgentForPosition` / `assertFreeAgentInvariants`）；
  归属层 [membership.js](file:///workspace/src/core/membership.js)（`setFreeAgentMembership` / `isFreeAgentMembership`，`validateMembership` 允许 `null`）；
  合同层 [contract.js](file:///workspace/src/core/contract.js)（`updateContract` / `validateContractShape`）与人口层 [player-lifecycle.js](file:///workspace/src/core/player-lifecycle.js)。
- **Contract 是 Free Agent 真相**：`runtime.contracts[playerId] = { playerId, clubId:null, startSeason, endSeason, wage:0, status:'free_agent' }`。
  **不新增** `runtime.freeAgents` / `playersWithoutClub` / `marketPlayers`（不引入第三套业务真相）。
  Free Agent 的 `startSeason = endSeason = 进入自由身的当前赛季`；**不沿用旧合同结束赛季、不保留旧工资**。
- **`membership` null 是无俱乐部状态**：Free Agent 使用 `runtime.membership.players[playerId] = null`（key **存在**、value 显式 `null`）；
  **禁止 delete key**（否则 `initializeMembership` 会依 `static.teamId` / `generated.teamId` 重播种回原俱乐部）。
  `membership` 仍是 player→club 的**唯一运行期归属真相**；`membership.js` **不依赖** `contract.js`。
- **Active player 两态**（不得出现第三种）：Club-attached（active contract + membership=clubId）或 Free Agent（free_agent contract + membership=null）。
  Retired：无 membership、无 contract。
- **Free Agent 计入 world active population**：`getWorldPlayers()` 含非退役球员（与 club 无关）。
  例：112 active 释放 10 → world active **仍 112**、Free Agents=10、club roster 合计=102。
- **不计入 club roster**：`getTeamPlayers()` 以 membership 为 roster 真相，Free Agent（null）天然被排除。
- **不计入 team strength**：`computeTeamStrength` 基于出场集合 / `getTeamPlayers`，Free Agent 不参与。
- **不进入 lineup**：Free Agent 不得存在于任何 club lineup；release 操作须主动清除源 club 的 starters / bench；
  `cleanLineup` / `repairManagedLineups` / `resolveMatchSquad` 均以 `getTeamPlayers` 为准，残留引用会被清除、绝不进入比赛。
- **继续参与 lifecycle**：Free Agent 仍属 `getWorldPlayers()`，继续参与 growth / decline、injury tick / recovery、retirement、career stats；
  但因不参赛，**不产生比赛伤病、无出场加成**；未退役前不因无 club 而报错。
- **release 不立即生成**：`releasePlayerToFreeAgent()` **不触发 Generation**，不允许 `release → generate → 自动补回`；
  仅当**正常 Population Health evaluation** 发现**真实 roster deficit** 时才补位，且**优先检查现有 Free Agent 是否可补位，无可用 Free Agent 才允许 Generation**。
- **MAX_PLAYERS 双重语义**：Population 层「> 24 → 仅诊断、不裁员」（Step 26B）；Signing operation「>= 24 → 拒绝签约」。Transfer 是否突破 24 留 Step 28。
- **generated player / D10 暂不冻结**：`generatePlayer()` 维持「直接入 club、暂可能无 contract」；Step 27 不改 `generatePlayer()`、不为生成球员自动建合同；
  此「Club + 无 active contract」为**受控过渡状态**，**不能 release**。**D10 为 Deferred、非 Step 27 blocker**。
- **Schema**：**不升级**——现有结构已可表达 `membership.players[id]=null` 与 free_agent contract，无需新容器、无需迁移。
- **Domain Operations（Step 27 MVP）**：`releasePlayerToFreeAgent()` / `signFreeAgent()`（及 Free Agent 查询 accessor），统一 `plan → validate → commit → assert invariants`；
  UI / AI 不得直接写 membership / contract / finance。`transferPlayer()` 属 Step 28。
- **Finance**：Free Agent signing v1 **无 transfer fee、无复杂 signing fee、不从 cash 扣工资**（延续 D13/D17）。
- **不变量**：FA-INV-01 … FA-INV-12（见 [DECISIONS D-26.13](file:///workspace/docs/DECISIONS.md)）；实现补 FA-INV-13/14（free_agent `wage=0`、`startSeason=endSeason`）。
- **实现验证（Step 27B）**：`tests/free-agent.test.js`（release/sign 原子性、membership null、重播种防护、lineup 清理、
  team strength / match squad 排除、Population 优先复用 Free Agent、退休、save/load、确定性、无 RNG、失败不半提交、Controller）；
  10/50/100/200 赛季长跑不变量全通过；比赛黄金指纹（143/143/1141）不变；浏览器冒烟 0 error / 0 warning。

---

## §33 Transfer System v1（Step 28A 设计冻结 → Step 28B 已实现）

- **状态**：**设计已冻结（Step 28A）；运行时已实现（Step 28B）**。已实现 `transferPlayer` 领域操作（**不含 Transfer UI**）；**未实现** AI Transfer / Contract Expiry / Renewal / Loan / Window / Negotiation / Market Value UI。
  schema 仍为 **10**、`SAVE_FORMAT_VERSION` 仍为 **1**；**未新增 RNG**；**D10 仍 Deferred**。决策编号见 [DECISIONS D-27](file:///workspace/docs/DECISIONS.md)。
- **实现（Step 28B）**：[transfer.js](file:///workspace/src/core/transfer.js) 新增 `transferPlayer` / `validateTransfer` / `buildTransferPlan` /
  `commitTransferPlan` / `assertTransferInvariants` / `computeTransferFee` / `clampTransferFee`；[finance.js](file:///workspace/src/core/finance.js) 新增
  `applyCashDelta` / `applyTransferBudgetDelta` 纯原语；[player-lineup.js](file:///workspace/src/core/player-lineup.js) 下沉共享 `removePlayerFromAllLineups`
  （`free-agent.js` 改为复用）；[game-controller.js](file:///workspace/src/controller/game-controller.js) 追加 `transferPlayer` 转发（`{success, code, issues}`）。
  **验证**：`tests/transfer.test.js`（A–O + Controller）；累计 **286/286 通过**；10/50/100/200 赛季长跑不变量全通过；Save/Load 往返一致；比赛黄金指纹（143/143/1141）不变。
- **定义（T1）**：Club A → Club B 的**一次原子球员交易**；一次性完成 **Membership / Contract / Finance / Seller Lineup** 一致变更；
  **Team Strength / Match Squad 不直接修改**（经 Membership 派生）。
- **费用模型（T2/T3）**：**确定性能力定价** `Base × AbilityFactor × AgeFactor × PositionFactor`，纯函数、不存储、无 RNG；
  Ability 用**完整 effective attribute 向量**（非单一 OVR），Age 遵循 Growth/Decline 曲线，Position 仅轻微差异；
  **不使用** Potential/Fitness/Form/Morale/Injury/Stats，**不读取** cash/transferBudget/squad size 等（禁止「越有钱越贵」）；
  `MIN_TRANSFER_FEE=0`、`MAX_TRANSFER_FEE` 由 `sim-config.js` 定义，越界 clamp。
- **Finance（T4/T5/T6/T7/T8）**：buyer `fee ≤ cash` 且 `fee ≤ getSpendableCash=min(cash,transferBudget)`；
  buyer `cash -= fee` **且** `transferBudget -= fee`；seller `cash += fee`（transferBudget **不增**）；
  经 finance 层纯接口完成（**禁止** transfer 直接改 finance 结构）；错误码 `INSUFFICIENT_CASH`。
- **Contract（T9/T10）**：旧合同 **terminate** + 新 **active** 合同创建（`clubId=buyer`、`startSeason=当前赛季`、`endSeason/wage` 取自 `defaultContractTemplate`）；
  **不新增 Contract History**（保持单合同）。
- **Roster（T11/T12/T13/T14）**：seller **允许暂时 < MIN_PLAYERS**（population boundary 补位）；**GK 硬保护**（不得卖到最后 0 GK，`SELLER_LAST_GK`）；
  DF/MF/FW 允许暂时 deficit；buyer `>= MAX_PLAYERS → 拒绝`（`ROSTER_FULL`，不 auto-release/swap）；buyer **无位置要求**。
- **Injury（T15）**：允许受伤球员转会；**不重置** injury / fitness / form / morale。
- **Generated（T16）**：允许 generated player 转会；「Club + 无合同」可由 Transfer 直接建立新 active 合同；**不改 `generatePlayer` / 不改 D10**、**不改 generated registry**。
- **Free Agent（T17）**：**禁止**进入 `transferPlayer`（走 `signFreeAgent`）。
- **Event / History（T18/T19）**：记录 **runtime-only** `TRANSFER_COMPLETED`（playerId/seller/buyer/fee/season/date）；**不建持久 transfer history**。
- **Timing / Atomicity（T20/T21）**：day advancement **之外**执行，下一场生效；`validate → plan → commit → assert`，一次性提交、**不 rollback**。
- **Schema / RNG（T22/T23）**：保持 **10 / 1**；不新增容器；不新增 RNG。
- **Population（T24）**：不改 world population；只重分布 roster；deficit 等待 boundary。
- **架构（T28.1）**：新模块 `src/core/transfer.js`（`transferPlayer` / `validateTransfer` / `buildTransferPlan` / `commitTransferPlan` / `assertTransferInvariants`），
  单向依赖 contract / membership / finance / player-lineup / player-runtime / sim-config / game-state；**禁止反向依赖**；与 `free-agent.js` 为 sibling。
- **不变量**：见 [DECISIONS D-27 T28.2](file:///workspace/docs/DECISIONS.md)（19 条）。

---

## §34 World Economy / Transfer Market v2（Step 33B 设计冻结；Step 34 已实现）

- **状态**：**设计已冻结（Step 33B）；运行时实现完成（Step 34）**。依据 Step 32A 长期生态审计（确认吸收态：population 112→96、roster→12、FA→0、transfer≈0、transferBudget 单向衰减）。决策编号见 [DECISIONS D-29](file:///workspace/docs/DECISIONS.md)。**schema 保持 10 / save format 保持 1**。
- **Step 34 实现落地**：新增 `WORLD_SOFT_CAP=112` / `FINANCE_CONFIG.TRANSFER_BUDGET_REPLENISHMENT=420` / `AI_CONFIG.HOLDING_TARGET=14` 等配置；`player-lifecycle.replenishPopulation` 增加软上限保护；`finance.replenishTransferBudget` + Season Boundary 接入；`ai-need` COMPETITIVE 分支与去重；`ai-decide.decideSell` + `ai-action` SELL_PLAYER（经 `transferPlayer`）；`ai-candidate.sellerKeepsStructure` 保持 12 不变量。均为 derived / ephemeral，无 schema / save 变更。**已知目标级 BLOCKER**：在 8 队固定世界下，`WORLD_MIN_POPULATION(96) = 队数 × MIN_PLAYERS(12)`，长跑仍在 ~S27 收敛到 `population=96 / roster=12 / FA=0 / transfer=0`（供给侧无 surplus）。详见 [DECISIONS D-29 实现状态](file:///workspace/docs/DECISIONS.md)。
- **三循环分离（D-33.2）**：Population Cycle（retirement/generation/stock）、Transfer Cycle（Club↔Club / release / sign）、Finance Cycle（cash / transferBudget / capacity）**职责分离**；Population 不直接调用 Transfer、Transfer 不生成 Player、Finance 不直接决定 target；仅经现有 Domain API 连接。
- **Need 扩展（D-33.3）**：分类冻结 **HARD / SOFT / COMPETITIVE / NONE**（COMPETITIVE 独立，不并入 SOFT）；新增 reasonCode **`COMPETITIVE_UPGRADE`**；仍走 `Need → Candidate Filter → Suitability → Finance → Target Ranking → Domain Action`；允许 No Action；确定性、无 RNG、无 OVR。
- **AI Active Selling（D-33.4）**：允许 SELL intent，**仅经 `transferPlayer()`** 执行；不建 Listing / Window / Negotiation；保持全部 seller protection 与 transfer 原子性；AI 不直接写 state。
- **Holding Target（D-33.5）**：**`HOLDING_TARGET = 14`**（12=生存线 / 14=持有目标 / 24=上限）；`roster > 14` 且有结构性 surplus 方可进入 SELL/RELEASE 候选；**不得为达到 14 而强制出售**。
- **Population 有界 Surplus（D-33.6；D-16 扩展）**：`WORLD_MIN_POPULATION = 96`（不变）、`WORLD_SOFT_CAP = 112`（上限/目标带）；generation 为**有界补位**，**不无限生成**、**不随机生成 FA**、**不机械恢复到 112**；FA 仍属 world active population。
- **transferBudget 再生（D-33.7；D-27 T6 扩展）**：Season Boundary **确定性 top-up**，上限 = `INITIAL_TRANSFER_BUDGET`；单笔转会仍 buyer `-= fee`、seller `不增`（T6 继续成立）；无 RNG、无收入系统。**cash 不再生（D-33.8）**。
- **Action Cap（D-33.12）**：`MAX_EXITS_PER_SEASON = 2`（**SELL + RELEASE ≤ 2**，SELL 计入 seller exit cap）；买入/FA 签约上限独立沿用现有 AI action cap。
- **Club Policy（D-33.9）**：仍 3 档（Balanced/YouthFocus/Conservative），参数 `demandBias/buyBias/sellBias/reserveRatio`；deterministic、不持久化、不直接改 state。
- **Season Boundary 顺序（D-33.15）**：`developPlayers → runPlayerLifecycle → bounded population replenishment → transferBudget regeneration → runSeasonAI → repairManagedLineups → resetSeasonStats`。
- **不变量与验收**：见 [DECISIONS D-29](file:///workspace/docs/DECISIONS.md)（保留不变量列表 + 10/50/100/200/500 赛季验收 + 六项禁令）。**Golden Regression 143/143/1141 必须保持**；**不修改** `resolveMatchSquad` / `computeTeamStrength` / Match Engine（D-33.10）。
- **微决策冻结（D-34.1~D-34.3，见 [DECISIONS D-34](file:///workspace/docs/DECISIONS.md)）**：
  - **D-34.1 Population Trigger Semantics**：`96`=Hard World Floor、`112`=Soft Ecosystem Cap、`14`=AI Holding Target、`12`=Club Hard Minimum，**四者语义完全分离**；Population Generation **仅在** club 结构性缺口（`roster<12` / `GK<1` / `DF<4` / `MF<4` / `FW<2`）或 world `active < 96` 时发生；**禁止**“每季补到 112 / 低于 112 自动生成 / 每 club 自动补到 14”；Population 不制造 trading supply。
  - **D-34.2 transferBudget Carry-over Regeneration**：`new = min(INITIAL_TRANSFER_BUDGET, current + REPLENISHMENT_AMOUNT)`；carry-over、有上限、不 reset、不改 cash；**D-27 T6 单笔语义不变**。
  - **D-34.3 Competitive > Soft Priority / Dedup**：优先级 `HARD > COMPETITIVE > SOFT > NONE`；`COMPETITIVE` 独立档、仅在无 HARD 时考虑、reasonCode `COMPETITIVE_UPGRADE`、不使用 OVR/单一全队均值；与 SOFT `ATTRIBUTE_GAP` 同位置去重。
  - 状态：**Schema 10 / Save Format 1 不变**；**Step 34 实现完成**（测试 312 通过，Golden 143/143/1141 保持；长跑吸收态未破除，属目标级 BLOCKER，待后续决策供给侧机制）。
  - **Step 35A 供给审计（只读）**：确认 `96/12/0` 为**不动点**；`Σ_c R_c + F = N`（transfer/release/sign 不改 N）；**恒为 0 的约束 = Seller Supply**；`WORLD_MIN(96)=ClubCount(8)×CLUB_MIN(12)` 且 active ≡ first-team roster → **Population Floor ≡ Market Supply Floor**。候选机制 A–H 全部 **[TBD]**，未选择；禁止随机 FA 供货 / 强制交易。详见 [DECISIONS D-35A](file:///workspace/docs/DECISIONS.md) 与 [ROADMAP 2.23](file:///workspace/docs/ROADMAP.md)。
  - **Step 35B 供给机制决策审计（只读）**：证明冻结 rule 4 + rule 8 下 `ΔN = Gen − Ret ≤ 0` ⇒ N 收敛 96 ⇒ **无可行供给机制**；方案 A–G 全部 **[TBD]**。推荐候选（未冻结）：① Dynamic Depth Target Intake（现有 Domain / schema 不变 / 需受控重开 D-34.1）；② Bounded Intake Pool（新 Domain / 建议 DEFER）。**待 Step 35C 确认**。详见 [DECISIONS D-35B](file:///workspace/docs/DECISIONS.md) 与 [ROADMAP 2.24](file:///workspace/docs/ROADMAP.md)。
  - **Step 35C 供给机制冻结（DOCS-ONLY）**：冻结 **D-35.1 ~ D-35.11** —— 路线 **α = Dynamic Depth Target Intake（DDTI）**；**D-34.1 受控重开**新增 **C = Controlled Depth Intake**（状态驱动 / 有界 / 确定性 / 非机械 / 不同步 / 不保证 14·16·112 / 不制造交易 / `N≤112`）；`effectiveDepthTarget_c` 状态驱动 + 可逆 + 必含硬上下限（`≥12`、`≤DEPTH_CAP`）+ hysteresis；**Policy = bias, not identity**；**禁止永久 supplier / buyer**；`112/14/0` 不得成为长期吸收态。**BIP / Youth·Reserve / Generation→FA DEFER**。**Transfer Domain / Match / Team Strength 不修改；Schema 10 / Save 1 保持**。**所有具体数值（`DEPTH_CAP`、target function、hysteresis、intake caps）全部 `[TBD]`，留待 Step 35D 参数实验。** 详见 [DECISIONS D-35.1~D-35.11](file:///workspace/docs/DECISIONS.md) 与 [ROADMAP 2.25](file:///workspace/docs/ROADMAP.md)。
  - **Step 35D DDTI 实现 + 实验**：新增 `src/core/ai/ai-depth-intake.js`（`effectiveDepthTarget` / `evaluateDepthIntake` / `classifyMarketRole`；纯函数、无 RNG、无 OVR）；`DDTI_CONFIG`（`DEPTH_CAP` 等仍 `[TBD]`）；`runDepthIntake`（**结构补位在前、depth intake 在后**；FA 优先→生成）。**关键修正**：AI 候选/SELL 资格与 Domain（T9「generated 可无合同」）对齐（`ai-candidate.js` / `ai-decide.js`）——此前 generated 取代静态球员后 AI 无候选 → ~S50 冻结。**纯 AI 世界 500 季市场持续活跃**（maxConsecZeroTransfer=0，`N∈[104,112]`，无永久 supplier/buyer）。**剩余限制**：managed club 存在时 cash 单向集中（D-33.8）→ 长期冻结（finance 侧，超出 DDTI）。测试 **321/321**；Golden 不变。详见 [DECISIONS D-35D](file:///workspace/docs/DECISIONS.md) 与 [ROADMAP 2.26](file:///workspace/docs/ROADMAP.md)。
  - **Step 35E 参数冻结（`[已定]`）**：DDTI 基准参数 **C1** 冻结 —— `DEPTH_CAP=14`、`PER_CLUB_INTAKE_CAP=1`、`WORLD_INTAKE_CAP=4`、`HYSTERESIS_UP=0.30`、`HYSTERESIS_DOWN=0.15`（`sim-config.DDTI_CONFIG` 已同步；C2/C3 降为历史实验记录）。**合同一致性修复正式接受**：AI 候选/SELL eligibility = `activeOwned || (generated 且无 contract)`（与 Transfer Domain T9 一致；**Transfer Domain 未改**）。**Deferred Issue `DF-01`**（Managed Club Cash Concentration → Step 36）。**Schema 10 / Save 1 不变**；Golden `143/143/1141` 不变。详见 [DECISIONS D-35E](file:///workspace/docs/DECISIONS.md) 与 [ROADMAP 2.27](file:///workspace/docs/ROADMAP.md)。

---

## §35 Managed Finance Feedback（DF-01）—— Finance / AI / Transfer 集成（Step 36C 冻结；Step 36D 实现）

- **状态**：机制已冻结（Step 36C）；**生产实现已完成（Step 36D）**。决策来源见 [DECISIONS D-36](file:///workspace/docs/DECISIONS.md)（D36.1~D36.6）。
  - 实现：新增 [finance-feedback.js](file:///workspace/src/core/finance-feedback.js)（`calculateManagedFinanceFeedback`（只读→plan）/ `applyManagedFinanceFeedback`（应用 plan）/ `runManagedFinanceFeedback`；plan→apply）；配置 `FINANCE_FEEDBACK_CONFIG`（`THRESHOLD=0.35` / `REDISTRIBUTION_RATE=0.20`）。
- **问题（DF-01）**：存在 `managedClubId` 时，AI 可从 managed 买球员（`ai-candidate.filterCandidates` 的 TRANSFER 候选池未排除 managed），而 managed **不受 AI 控制**（`runSeasonAI` 跳过 managed、`findBuyerFor` 排除 managed 作 buyer）⇒ `cash` **单向**由 AI 流向 managed；因 `Σ club.cash` **严格守恒（≡8000）**，`AI aggregate cash → 0`，transfer market 进入 **absorbing state**（`maxConsecZeroTransfer ≈ 243`）。
- **冻结机制（CF-E2）**：**season-boundary process** —— 检查 `managedShare = cash_managed / WorldCash`；当 `> 35%` 时，**确定性再分配 20%** 的 managed **cash** 给 AI 俱乐部。
  - **接收方规则**：AI cash **中位数** → 优先 `cash < median` 的 AI clubs → **cash 升序**（同 cash 以 **clubId 升序** tie-break）→ 若无低于 median 者则**全部 AI** → 本轮资金**均分**（整数余数按确定性顺序依次 +1）。
  - **只改 `cash`**：不改 `transferBudget` / `wageBudget`；**不产生债务**；**不允许 `cash < 0`**；不改 transfer fee 公式；不改 Transfer Domain。
  - **world cash 严格守恒**（`Σ club.cash ≡ INITIAL_WORLD_CASH ≡ 8000`）：**不销毁、不生成**。
  - **无 RNG / 无 OVR / 无隐藏随机**；相同 `(world, managedClubId, season)` ⇒ 相同结果。
- **运行位置（Step 36D 已定）**：Finance Feedback 属 **season-boundary process**，插入于 `replenishTransferBudget` **之后**、`runSeasonAI` **之前**，使下一季 AI 决策看到反馈后的 `cash`；**未改变**任何既有步骤顺序（D-33.15 仍为 `developPlayers → runPlayerLifecycle → bounded population replenishment → transferBudget regeneration → **managed finance feedback** → runSeasonAI → repairManagedLineups → resetSeasonStats`）。每赛季边界**恰好一次**（由 `#rollFinishedSeasons` 的 `maxSeason > prevSeason` 单次触发保证）。
- **边界（D36.2 / D36.4）**：Finance Feedback **只**做 `managed cash → AI clubs cash`；**不**触碰 membership / contract / transfer / lineup；managed **仍属玩家控制**（AI 不得代玩家买卖/改阵容/改战术/改合同）；managed 长期为**球员净卖出方允许**（D36.1 只禁止**现金层面**的永久资金汇）。
- **不变**：Transfer Domain、Transfer Fee 公式、DDTI C1（`DEPTH_CAP=14 / PER_CLUB=1 / WORLD=4 / HU=0.30 / HD=0.15`）、Match / Team Strength、**Schema 10 / Save Format 1**；**不新增**任何 finance feedback 持久化字段（纯派生、无迁移）。
- **验证依据（Step 36B 摘要）**：CF-A 基线冻结（maxZero≈243）；**CF-B（sink）/ CF-D（world income）/ CF-F（decoupling）失败**；**CF-C / CF-E 通过**；**最终选择 CF-E2（threshold=35% / redistribution=20%）**。**Golden Regression 143/143/1141 必须保持**。
- **Step 36D 实现 + 验证**：`runManagedFinanceFeedback` 接入 `#rollFinishedSeasons`（`replenishTransferBudget` 之后 / `runSeasonAI` 之前）；新增 `tests/finance-feedback.test.js`（FF-01~FF-15）。**全量测试 336/336 通过**（321 旧 + 15 新，0 失败）；Golden `143/143/1141` 不变；10/50/100/200/500 赛季长跑（managed-normal / cash-high / heavy-sell / ~34% / ~50% / AI-ultra-low / AI-uneven / pure-AI）：`worldCash` 严格守恒、`managedShare` 稳定在 ~0.28–0.35、AI cash median 健康、`maxConsecZeroTransfer ≤ 1`、无新 absorbing state；browser smoke clean（仅既有 `favicon.ico` 404）。

---

## §36 Competition Structure（Step 38A 审计；Step 38B 决策冻结）

- **状态**：**实体模型与升降级机制已冻结（Step 38B，DOCS-ONLY）**；**实现待后续步骤**。决策来源见 [DECISIONS D-38](file:///workspace/docs/DECISIONS.md)（D38.1~D38.9）。
- **目标模型（Candidate B）**：`Country → Division(tier) → Club`；`Competition`（含 `format`）引用 `Division` 与参赛集合；`Competition Season` 为 Competition 的**逻辑实例边界**。**League ≡ Competition(format=RoundRobin)**；**Division = Country 下的层级**。
- **Club Membership**：`runtime.membership.clubs[clubId]` 仅存**当前归属**（D-19 唯一真相源，保持不变）；**历史归属由赛季归档派生**；升降级经**新增受控 Domain 写入口**，禁止绕过 membership 层。
- **Promotion / Relegation**：规则归 **Country / World 层**且**数据化**；**两阶段**执行（赛季末生成结果 → 下季初迁移 membership → 生成新赛程）；结果**纯派生**、确定性、**无新持久字段**。
- **Competition Rules 分层**：**Engine Rule**（Round-Robin/Knockout 算法、排名计算、确定性 tiebreak、赛程算法）固定；**World Data Rule**（`pointsForWin/Draw/Loss`、`promotionSpots/relegationSpots`、`playoff`、tiebreak 顺序、`tier`、赛程参数）入 `.fdb`。
- **Fixture**：共享**单一 Fixture Domain**；需补显式 `competitionId` / `competitionSeasonId`（当前靠存放位置 + id 字符串隐含）；`stage / leg / neutralVenue` 属扩展。
- **Standings**：挂 **Competition Season**（**非** Club）。
- **Season Boundary**：**必须泛化**以支持多 Competition（现有 `getSeasonCalendar` 取"首个 competition"的假设需替换）—— 多赛事一切扩展的前置条件。
- **现状事实（Step 38A）**：Competition 主键 ≡ League ID；Club→League 单值无写入口；`ai-need` 的联赛基线是唯一已有 league 依赖点（派生读取，**天然适配**升降级）。
- **不变**：DDTI C1（`DEPTH_CAP=14 / PER_CLUB=1 / WORLD=4 / HU=0.30 / HD=0.15`）、Finance Feedback、Transfer Domain、Match / Team Strength；**Schema 10 / Save Format 1 保持**（全加法 + normalize）。
- **Phase 1 范围**：多 Division + Promotion + Relegation + membership 迁移 + Competition Season（逻辑）+ Rules 数据化 + 多赛事 Season Boundary 修复；**Playoff / Cup / Continental / Qualification 延后**（保留接口）。**Golden `143/143/1141` 必须保持**。
- **下一步**：Phase 1 决策已**最终冻结**（Step 38D，见 §37）；**实现阶段 = Step 38E — Competition Structure Production Implementation**。

---

## §37 Competition Structure Phase 1 — Final Freeze（Step 38C 审计 / Step 38D 冻结）

- **状态**：**Phase 1 决策已最终冻结（Step 38D，DOCS-ONLY）**；**实现待 Step 38E**。决策见 [DECISIONS D-38D](file:///workspace/docs/DECISIONS.md)（D38D.1~D38D.14）。
- **World Season 语义（D38D.1）**：**同步世界赛季**。`World Season Boundary = 所有参与 World Season 的 League-format Competition 均完成当前赛季且满足 season calendar 完成条件`。**禁止**单个 Competition 单独触发 World rollover、禁止 A 先 rollover 再等 B、禁止 B 使用被 A 改过的 membership；Phase 1 **不支持**异步 Competition Season lifecycle（`state.season` 仍为 World-level scalar）。
- **Participants（D38D.2）**：Phase 1 = **当前 World 全部 League-format RoundRobin Competitions**（由 `leagues` 派生）；**不新增** `participatesInWorldSeason`；枚举 **deterministic**（按稳定 ID 排序，**不依赖未排序 `Object.keys()`**）；空 World/空集合行为须明确。
- **Division / Competition 语义分离（D38D.3）**：概念层区分 `divisionId` / `competitionId`；**存储层复用 `leagues.json` + `runtime.competitions[leagueId]`**（`league.id` 同时充当二者的兼容实现，当前一一对应）；**不新增** `divisions.json` / `competitions.json`；**不改 Save Format**；**不批量迁移** `membership.clubs` 的 `leagueId`；**不创建伪造独立 Division runtime entity**。
- **Promotion/Relegation planner（D38D.4）**：**两阶段**——Phase A **纯 planner**（读上赛季全部相关 Division 最终 standings + World Data Rules + tier/adjacency → `PromotionRelegationPlan`）；Phase B **统一 apply**（生成完整 Plan → 全局校验 → **一次性**改 membership → `validateMembership` → 生成下季 runtime/fixtures）。**禁止** per-Division 链式 apply。Invariants 见 D38D.4（单次移动、相邻 tier、top 不升 / bottom 不降、无重复、确定性等）。
- **邻接（D38D.5）**：仅相邻 tier；邻接由 `countryId + tier` 确定；非法配置（同 country 同 tier / tier 不连续）由 World Data validation **明确拒绝**。
- **名额（D38D.6）**：默认 `promotionPlaces = 2` / `relegationPlaces = 2`；top tier promotion 实际 0、bottom tier relegation 实际 0；名额 clamp 且不超 source club 数、不造成重复移动；invalid 配置拒绝/规范化；**不实现** playoff/补偿/注册/财务/牌照类移动。
- **Ranking/Tiebreak（D38D.7）**：Phase 1 保持 Engine 默认 `points → GD → GF → clubId`；**不引入复杂可编程排序 / DSL / 表达式**；新增字段 additive optional。
- **Rules 边界（D38D.8）**：`leagues.json` 可选 `rules = { promotionPlaces?, relegationPlaces? }`（可选 `pointsFor*?`）；**不加** playoff/cup/qualification/continental/registration/financial/reputation rules。
- **Membership API / source of truth（D38D.9）**：**`membership.clubs` 仍是运行期当前归属唯一真相源**；升降级用**批量原子** `applyPromotionRelegationTransition(state, plan)`（校验完整 Plan/source/唯一移动/from-to 合法/tier adjacency → 应用 → `validateMembership` → **失败即 all-or-nothing**）；主路径**不得**逐个 `applyClubDivisionMembership`；**禁止**以 `static teams[].leagueId` 覆盖 membership。
- **Season Rollover 顺序（D38D.10）**：`所有参与者完成 → 固化最终 standings → 生成 Plan → 全局校验 → atomic membership transition → validate membership → 创建下季 Competition runtime → 生成下季 fixtures → 归档 history → 推进 state.season → developPlayers → player lifecycle → replenishTransferBudget → Finance Feedback → runSeasonAI → repairManagedLineups → resetSeasonStats`。**红线**：Promotion/Relegation **必须早于** `createLeagueRuntime`/fixture 生成；**AI 必须在新 Division membership 生效后运行**。
- **Fixture（D38D.11）**：Phase 1 **可**加**可选** `competitionId`；旧 `fx_{leagueId}_s{season}_r{round}_{idx}` 继续有效；**不改 Match Engine**；不升级 Save Format；成本高于收益可延后。
- **Save 兼容（D38D.12）**：**Schema 10 / Save Format 1 不升级**；旧档以 membership 为准、保留 `leagueId` 兼容、Rules/optional 缺失用默认或 normalize；**不同步** `static teams[].leagueId` 与 membership；**不持久** Plan / transition history / 中间 rollover 状态（Plan 为临时运行时对象）。
- **失败语义（D38D.13）**：Plan 非法 → **整个 transition 失败**（无部分升降级 / 无部分写入 / 无随机修复 / 不改 standings / 不改 static）；非法 Division 配置在 validation 阶段**明确失败**，**禁止运行时静默猜测**。
- **回归不变量（D38D.14）**：Golden `143/143/1141`、测试基线 `336/336`；单 Division 与单联赛边界行为**等价**；**DDTI C1 / Finance Feedback / Transfer Domain / Match Engine / Team Strength / Schema 10 / Save Format 1 不变**。
- **Deferred**：Playoff / Domestic Cup / Continental / Qualification / Complex stages / Youth·Reserve / Staff / Scout / Reputation / Revenue·TV·Sponsor·Prize / Loan / Registration / licensing / FFP / promotion history entity / CompetitionSeason persistent entity。

---

## §38 Ball → Tactical Context → Player Situation → Decision 只读因果链（Step 39F-M-C-04）

- **状态**：**READ-ONLY CAUSALITY GATE 已实现并验证**。承接 39F-M-C-03（Ball Physics Foundation，COMPLETE）。
- **数据流（单向，禁止回流）**：`MatchCore.ball` → Ball Physics facts → Tactical Context → Player Situation → Decision（只读几何）。**Decision 不得反写 BallState；Physics / Context 不得反调 Decision。**
- **球事实派生层（新增）**：`src/core/match/ball-facts.js`——`deriveBallFacts(matchCore)` 由**唯一来源 `MatchCore.ball`** 派生只读快照（`position / velocity / speed / state / control / possessingTeamId / lastTouchPlayerId / inTransit`）；`deriveBallRelation(ballFacts, playerPos, playerVel)` 派生球员相对球几何（`relativePosition / distance / directionToBall / relativeVelocity / closingSpeed / movingTowardPlayer / movingAwayFromPlayer / timeToArrival`）；`playerVelocityFromMovement(matchCore, playerId)` 由 transient `movement` 派生球员速度。**不是第二套 Ball Truth**：每次调用重新派生、返回一次性快照、不含 `ball` 顶层副本、不写回 MatchCore。
- **Tactical Context 扩展**：`buildTacticalContext(matchCore, teamId, options?)` 新增 `ballFacts / ballSpeed / ballVelocity / ballState / lastTouchPlayerId`；可选 `options.playerId` 附带 `ballRelation`。既有 `phase / ballZone / ballChannel / blockHeight / buildUpPhase / shapeValidity` 语义不变。
- **Player Situation 扩展**：`buildPlayerSituation(matchCore, playerId)` 的 `ballState` 增补 `velocity / speed / state / lastTouchPlayerId`；`spatialContext.ballRelation` 增补球员相对球几何。既有字段与 Decision 行为不变。
- **Decision Geometry**：为**只读几何事实**，即 `PlayerSituation.ballState` + `spatialContext.ballRelation`（决策经 `decidePlayerAction` 只读消费）。**本 Gate 不新增独立 geometry 模块**（避免与既有 `action-definitions` 几何重复形成第二套口径）。
- **明确 Deferred**：DRIBBLE / TACKLE / PRESS / INTERCEPTION / SECOND_BALL Resolution、FOUL / OFFSIDE / GK Interaction / Set Piece、lofted / bounce / spin、正式 possession transfer、Production Loop、Renderer。
- **不变**：PASS / SHOT resolution 与 state-update、Save Format 1、Schema 10、Production Loop、Renderer 均**未修改**；无 Math.random；无第三方 physics engine。测试基线：既有 777 + 新增 28 = **805 通过 / 0 失败**。
- **Deferred**：Playoff / Domestic Cup / Continental / Qualification / Complex stages / Youth·Reserve / Staff / Scout / Reputation / Revenue·TV·Sponsor·Prize / Loan / Registration / licensing / FFP / promotion history entity / CompetitionSeason persistent entity。

---

## §39 Interaction Ball Position Ownership 解耦（Step 39F-M-C-32）

- **状态**：**OWNERSHIP DECOUPLING GATE 已实现并验证**。承接 39F-M-C-27（Interaction Movement Semantics = INSTANT）与 39F-M-C-31（SECOND_BALL = NO_POSITION_CHANGE）。**C-30 仍 BLOCKED / SEALED，本 Gate 未实现 / 未接入 C-30。**
- **问题**：此前 C-05 `applyInteractionStateUpdate()` **原子地同时**写 `ball.position` + `state / possession / control / lastTouch / velocity`，导致 **Ball Position Ownership 与 Interaction State Mutation 耦合**。
- **职责分离（冻结）**：
  - **Interaction State Mutation Boundary** = [interaction-state-update.js](file:///workspace/FE-project/src/core/match/interaction-state-update.js)（C-05，职责收窄）：只写 `Ball State / possession / control / lastTouch / velocity`；**不再写 `ball.position`**。
  - **Ball Position Ownership Boundary** = [interaction-ball-position-ownership.js](file:///workspace/FE-project/src/core/match/interaction-ball-position-ownership.js)（新增）：`applyInteractionBallPositionUpdate(matchCore, result)` 是 **Interaction Ball Position 的唯一写入归属边界**，内部**复用既有 C-29** [instant-ball-position-integration.js](file:///workspace/FE-project/src/core/match/instant-ball-position-integration.js) 的 `applyInstantBallPositionUpdate`（不重复实现 Position Validation，不建第二套 Instant Position Boundary）。
- **数据流（C-06 编排，单向）**：`Interaction Resolution Result` → **① Position Integration**（`applyInteractionBallPositionUpdate`，唯一写位置）→ **② State Mutation**（`applyInteractionStateUpdate`，不写位置）→ 新 MatchCore。调用顺序 **Position → State**（见 [interaction-integration.js](file:///workspace/FE-project/src/core/match/interaction-integration.js)）。
- **原子性**：State Mutation 为全函数（total）；Position Integration 可失败（`INVALID_POSITION` / `INVALID_INPUT`）。**先 Position 后 State**：Position 失败 → 返回 `ok:false` / `POSITION_INTEGRATION_FAILED`，**不进入 State Mutation**，输入 MatchCore 原样返回，**无半完成 Interaction 状态**。
- **Position 来源**：只消费上游 Resolution 已确定的 `result.ball.position`，**不重算** destination / scatter / contestPoint / carrierPos / interception / actor position。
- **唯一 Truth**：不创建第二个 Ball Position Truth，最终 Truth 仍是 `MatchCore.ball.position`；不创建 Movement State / Duration / Transit / Velocity Model / Trajectory / Physics / Collision。
- **SECOND_BALL（C-31 约束）**：SECOND_BALL = `NO_POSITION_CHANGE`，故 **不经过 Position Ownership 边界**；`integrateSecondBallResolution` 只走 State Mutation（C-05，不写 position）→ **SECOND_BALL Position Write Count = 0**，即使 State 变化球位也完全不变。**禁止** SECOND_BALL → C-29 / C-30。
- **不变（红线）**：未修改 **C-29 Contract**（API / validation / result contract / ruleVersion / immutable semantics）、**C-27**、**C-31** 语义；未实现 C-30；未改 Save Format 1 / Schema 10；未接 Production Loop / Renderer；无 `Math.random` / `Date.now` / 墙钟 / physics / collision / trajectory / duration / transit。
- **业务结果一致性**：合法 Interaction / SECOND_BALL 流程的 `Position / State / Possession / Control / LastTouch / Velocity` 与 C-32 之前**完全一致**（BEFORE === AFTER）；仅改变「谁负责写 Position」，不改变「Position 写成什么值」。
- **测试**：新增 [interaction-position-ownership.test.js](file:///workspace/FE-project/tests/interaction-position-ownership.test.js)（31 用例，覆盖所有权边界契约、12 类 Interaction outcome 回归、SECOND_BALL Position Write Count = 0、失败原子性、Immutability、Source Guard）。全量基线：既有 1419 + 新增 31 = **1450 通过 / 0 失败**。
- **Deferred**：Interaction 的正式生产接入（C-27 Semantic Gate + 全链验证）由后续独立 Gate **C-33** 完成（见 §40）；C-30 仍保持 BLOCKED / SEALED。

---

## §40 Interaction Instant Ball Position Integration 生产接入（Step 39F-M-C-33）

- **状态**：**PRODUCTION INTEGRATION GATE 已实现并验证**。承接 39F-M-C-32（Position Ownership 解耦）。**C-30 仍 BLOCKED / SEALED，本 Gate 未实现 / 未接入 C-30。**
- **目标**：将 Interaction Resolution 的 Ball Position **正式**经 `C-27 Semantic Gate → C-32 Position Ownership → C-29 Instant Position` 写入 `MatchCore.ball.position`，并证明 **生产链真正使用该路径**（而非仅"边界存在"）。
- **生产调用图（C-33 冻结）**：`C-08 Match Tick` → `Interaction Resolution` → `integrateInteractionResolution` → **C-27 Semantic Gate** → **C-32 `applyInteractionBallPositionUpdate`** → **C-29 `applyInstantBallPositionUpdate`** → `MatchCore.ball.position` → **C-05 State Mutation**。
- **C-27 Semantic Gate（新增）**：[interaction-instant-ball-position-integration.js](file:///workspace/FE-project/src/core/match/interaction-instant-ball-position-integration.js)——`resolveInteractionInstantBallPositionSemantics(result)`。只有 C-27 语义 = `INSTANT`（DRIBBLE / TACKLE / PRESS / INTERCEPTION）放行；未知 / 未审查 / 非 INSTANT → **明确失败** `INTERACTION_BALL_MOVEMENT_SEMANTICS_UNSUPPORTED`，**绝不静默视为 INSTANT**，不进入 C-32 / C-29。Gate **不硬编码** actionType 白名单，统一委托 C-27 `resolveInteractionBallMovementSemantics`（避免第二套 Semantic Contract）。
- **编排（C-06）**：[interaction-integration.js](file:///workspace/FE-project/src/core/match/interaction-integration.js) 在 Position Integration 前插入 Gate；失败即 `ok:false` / `POSITION_INTEGRATION_FAILED`（附 `positionReason`）。执行顺序 **Gate → Position → State**；Position / Gate 失败 → **不执行 State Mutation**，输入 MatchCore 原样返回（无半完成状态）。
- **唯一 Position Writer**：final Ball Position 必须等于 `interactionResult.ball.position`，且写入只能经 C-29（禁 `matchCore.ball.position = ...`）。C-05 **不写 position**。
- **SECOND_BALL（C-31 约束）**：**不经过** Semantic Gate / Position Ownership；`SECOND_BALL Position Integration = 0`，即使 State 变化球位亦不变。
- **生产链验证**：`runMatchTick` 中 Interaction（如 DRIBBLE_COMPLETED）最终 `matchCore.ball.position === interactionResult.ball.position`，`applied.interaction === true`，invariants 通过；未知 ActionInstance 不改球位。
- **不变（红线）**：未修改 **C-29 / C-27 / C-31**（API / ruleVersion / 语义）；未实现 C-30；未改 C-08 Tick Lifecycle；未改 Save Format 1 / Schema 10；未接 Renderer；无 `Math.random` / `Date.now` / 墙钟 / duration / Movement State / Transit / Trajectory / physics / collision。
- **测试**：新增 [interaction-instant-ball-position-integration.test.js](file:///workspace/FE-project/tests/interaction-instant-ball-position-integration.test.js)（23 用例，覆盖 Gate 放行 / 未知失败、四类 Interaction 生产接入、same-position / IN_TRANSIT 无虚假 Movement、失败原子性、Immutability、单写 Guard、SECOND_BALL = 0、真实 C-08 生产链、Source Guard）。全量基线：既有 1450 + 新增 23 = **1473 通过 / 0 失败**。
- **Deferred**：C-30（Interaction → C-29 的更广接入）仍 BLOCKED / SEALED；本 Gate 完成后 **STOP**，等待 Owner 验收。

---

## §41 Action Ball Movement State → Continuous Position Integration（Step 39F-M-C-34）

- **状态**：**BLOCKED（未实现）**。原因：`ACTION_CONTINUOUS_MOVEMENT_TICK_SEMANTICS_GAP`。**未修改任何生产代码 / 测试 / Contract。**
- **目标**：正式建立 `Action Resolution → C-24（Action → Ball Movement State）→ C-23（Continuous Position Integration）→ MatchCore.ball.position` 的生产接入边界，优先覆盖 PASS / SHOT。
- **BLOCKED 依据 1 — 无生产 Action Resolution 路径**：C-08 [match-tick.js](file:///workspace/FE-project/src/core/match/match-tick.js) 只编排 **Interaction**（C-05 / C-06 / C-07）；它**从不调用** `resolvePass` / `resolveShot`。[pass-resolution.js](file:///workspace/FE-project/src/core/match/pass-resolution.js) / [shot-resolution.js](file:///workspace/FE-project/src/core/match/shot-resolution.js) 及其 state-update 目前**仅被测试引用**，无任何 src 编排器接入。建立该路径须扩展 / 重设计 C-08 Lifecycle → 触发 BLOCKED 条件 #8。
- **BLOCKED 依据 2 — 连续运动 Tick 写入语义冲突（核心）**：现有权威连续运动是**多 Tick 的 transit 状态机**——[pass-state-update.js](file:///workspace/FE-project/src/core/match/pass-state-update.js) `applyPassStateUpdate`（球置 IN_TRANSIT、`position = transit.from`）→ `advancePassTransit(dt)`（`progress = elapsed/duration`，`progress ≥ 1` 时 `finalize` 到 `to`）；SHOT 对称（[shot-state-update.js](file:///workspace/FE-project/src/core/match/shot-state-update.js)）。该语义中 **`duration` 明确跨多个 Tick**。而 C-23 [ball-movement-integration.js](file:///workspace/FE-project/src/core/match/ball-movement-integration.js) `applyBallMovementPositionUpdate` 是**一次性写 `endPosition`**、无 tick / duration / progress 语义。将 C-23 作为 PASS/SHOT 的 Position Writer 会：(a) 在 Resolution 当 Tick 直接把球瞬移到 `to`，改变现有业务结果；或 (b) 需要把 `duration` 解释为多个 Tick / 外部推进 Movement——均为 §12 / §25 明令禁止 → 触发 BLOCKED 条件 #5。
- **已确认的可用前提（非阻塞项）**：① C-24 [action-ball-movement-state.js](file:///workspace/FE-project/src/core/match/action-ball-movement-state.js) 可读取权威 `transit{from,to,duration}` 并归一化为 Movement State；② PASS / SHOT 的 `transit.from = actor 位置（= 当前持球位）`、`to = actualDestination`、`duration = calculateTransit/ShotDuration(...) > 0`（authoritative，非重推）；③ C-23 的 Start Position 一致性 / `duration > 0` / immutable 契约均已就绪。**冲突点仅在"连续运动的 Tick 写入时刻"语义。**
- **不变（红线）**：未修改 C-23 / C-24 / C-29 / C-33 / C-27；未改 C-08 Tick Lifecycle；未创建 Movement Model / Duration Rule / Trajectory / Goal Detection / Physics / Multi-Tick Movement；未直接写 Ball Position；全量测试不受影响（1473 通过 / 0 失败）。
- **解除 BLOCKED 的前置条件（供后续独立 Gate）**：先明确并冻结「AI/Action 连续运动的 Tick 写入语义」——即 C-23 的 `endPosition` 写入是发生在 transit 完成 Tick（与现有 `finalize` 对齐），还是引入受控的 movement-driven tick 推进；并明确 C-08 是否扩展出 Action Resolution 阶段。在此之前不得接入 PASS/SHOT → C-24 → C-23。
- **Deferred**：Action（PASS / SHOT）连续运动的正式生产接入；本 Gate 完成后 **STOP**，等待 Owner 验收。

---

## §42 Continuous Ball Movement Tick Semantics Decision（Step 39F-M-C-35）

- **历史状态**：**BLOCKED（Decision Gate，未冻结语义）**（Step 39F-M-C-35 原始结论）。原因：`CONTINUOUS_BALL_POSITION_TRUTH_UNDEFINED`。原始工具内**未修改任何生产代码 / 测试 / Frozen Contract**（保留如下，供历史追溯）。
- **当前状态（后续追认）**：**已被 §43（C-36）/ §44（C-37）/ §45（C-38）/ §46（C-39）收口**——连续球位 Tick 语义**不再处于「完全未定义」**，已由后续决策与实现落地为 **OPTION_B 混合方案**。详见文末「### 状态追认（Owner Decision）」。**注意**：本追认**不影响 §41**（PASS/SHOT Action 连续运动路径仍 **BLOCKED**），也**不表示**已接入 Production Loop。

### Existing Fact（源码已明确）

- **PASS Transit Truth**：`MatchCore.ball.transit`（`IN_TRANSIT` 时挂在 `ball` 上）。`from = actor 位置`、`to = actualDestination`、`duration = authoritative`（[pass-resolution.js](file:///workspace/FE-project/src/core/match/pass-resolution.js#L199-L203)）；`elapsed/progress` 由推进函数派生（起点 0）；`startedAt = clock.simulationTime`。
- **SHOT Transit Truth**：同构（[shot-resolution.js](file:///workspace/FE-project/src/core/match/shot-resolution.js#L222-L229)）。
- **Transit 安装**：[applyPassStateUpdate](file:///workspace/FE-project/src/core/match/pass-state-update.js#L44) / [applyShotStateUpdate](file:///workspace/FE-project/src/core/match/shot-state-update.js#L31)——`ball.position := transit.from`、清 control / possession、置 `IN_TRANSIT`。
- **Transit 推进（机制 1）**：[advancePassTransit](file:///workspace/FE-project/src/core/match/pass-state-update.js#L78) / [advanceShotTransit](file:///workspace/FE-project/src/core/match/shot-state-update.js#L67)：`elapsed += dt`、`progress = clamp01(elapsed/duration)`；**中间 Tick 不修改 `ball.position`**（`position: { ...ball.position }`）；`progress ≥ 1`（完成 Tick）→ `finalize` 写入 `ball.position := transit.to` 并结算 possession。⇒ 语义 = **COMPLETION_TICK**。
- **Ball Physics（机制 2）**：[stepBallPhysics](file:///workspace/FE-project/src/core/match/ball-physics.js#L106) / [stepMatchBall](file:///workspace/FE-project/src/core/match/ball-physics.js#L285)（C-03）：`position += velocity * dt`，`IN_TRANSIT` 球由 [velocityFromTransit](file:///workspace/FE-project/src/core/match/ball-physics.js#L73)（`|to−from|/duration`）播种速度，**每 Tick 推进 `ball.position`**（含摩擦 / clamp [0,1]）。⇒ 语义 = **MOVEMENT_DRIVEN_TICK**。
- **生产 Tick 现状**：C-08 [runMatchTick](file:///workspace/FE-project/src/core/match/match-tick.js#L97) **既不推进 transit，也不跑 ball physics**；`ball.position` 仅经 **Interaction → C-33 → C-29**（瞬时）改变。`advance*Transit` / `stepMatchBall` 全仓**仅被测试 / Harness 引用**，无生产调用者。

### Architectural Gap（源码未定义）

- **核心冲突**：对「Transit 中间 Tick 是否更新 `ball.position`」这一问题，源码存在**两个互相矛盾**的既有机制——机制 1 回答 **否（COMPLETION_TICK）**，机制 2 回答 **是（MOVEMENT_DRIVEN_TICK）**。二者均为 Foundation、均未接入生产，**无更高层冻结规则裁决**。
- **无生产 Tick Integration Point**：没有任何生产 Tick 调用 transit 推进 / ball physics；连续运动的 Tick 写入时刻在生产层**未定义**；`dt` 无生产来源。
- **C-08 需求未定**：C-08 是否新增 `Action Resolution` / `Transit Advancement` 阶段 = **UNRESOLVED**。
- **C-23 映射**：C-23 一次性 `applyBallMovementPositionUpdate` 写入 `endPosition`，最接近机制 1 的 **完成 Tick** 节点；但它无法表达机制 2 的每 Tick 推进——映射尚未裁决。

### Decision

- **未冻结语义**。§19 触发：源码无法确定「Ball Position 在 Transit 中间 Tick 是否更新」→ `CONTINUOUS_BALL_POSITION_TRUTH_UNDEFINED`；§23 #1 / #3 同时成立（机制冲突 / 需 Owner 选择设计方案）。
- **不得自行裁定**：既不假设「现实飞行 ⇒ 每 Tick 移动」（禁止现实主义推断），也不把机制 1 的未接入行为当成生产权威。**C-34 维持 BLOCKED。**

### 解除 BLOCKED 的前置条件（供 Owner 决策 + 后续独立 Gate）

1. **Owner 冻结 `CONTINUOUS_BALL_MOVEMENT_TICK_SEMANTICS_V1`**：选定 `positionUpdateMode = COMPLETION_TICK`（对齐机制 1 / C-23）**或** `MOVEMENT_DRIVEN_TICK`（对齐机制 2 / C-03 Ball Physics）。
2. **裁决机制 1 与机制 2 的权威关系**（谁拥有 Transit 期间的 Ball Position Truth），并明确是否废弃 / 收敛另一套。
3. **明确 C-08 是否扩展 Action Resolution / Transit Advancement 阶段**（Tick Integration Point / `dt` 来源）。
4. 均**不在 C-35 内实施**。

- **不变（红线）**：未修改 C-23 / C-24 / C-29 / C-33 / C-27 / C-03 Ball Physics；未改 C-08 Lifecycle；未创建 Movement Model / Transit State / Physics / Velocity Model / Trajectory / Collision / Goal Detection；未直接写 Ball Position；未新增测试；全量测试不受影响（1473 通过 / 0 失败）。
- **Deferred**：连续运动 Tick 语义最终冻结 + 生产接入；本 Gate 完成后 **STOP**，等待 Owner 验收。

### 状态追认（Owner Decision；后续文档更新，纯文档）

> 本节为 **后续追认记录**，用于消除 §42 原始 BLOCKED 表述与 §43–§46 已落地决策 / 实现之间的矛盾。
> **不修改 §43–§46 已封存契约；不新增任何运行时能力；不接入任何新调用链；不属于新实现 / 新代码 Gate。**
> 对应 Owner 决策记录见 [DECISIONS D-46](file:///workspace/FE-project/docs/DECISIONS.md)。

- **Owner 决策（本次）**：
  1. **正式追认**现有 **C-38 / C-39 OPTION_B 混合方案**。
  2. **排除**纯 `COMPLETION_TICK` 作为当前架构方案。
  3. **排除**纯 `MOVEMENT_DRIVEN_TICK` 作为当前架构方案。
  4. 接受「**非完成 Tick 由 C-03 Physics 推进球位、完成 Tick 由 C-23 精确写入 `transit.to`**」的既有行为。
  5. **完成 Tick 位置可能跳变**为**已知行为**；本次**不新增跳变幅度上限**，也**不宣称**该行为在所有场景下已验证无风险。
  6. **保持现有 Contact 契约不变**，不重开完成 Tick 的 Contact 决策。
  7. **Goal-Line Detection 的最终输入权威**不在本次裁决范围内，保留为独立后续架构问题。
  8. §42 状态更正为「已被 §43–§46 覆盖」。
- **本追认不代表**批准任何新实现 / 代码改动 / Production Loop 接入。

#### A. 非完成 Tick（已追认语义）
- C-39 非完成分支调用 **C-03 Physics**（[continuous-ball-movement-integration.js#L169-L192](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L169-L192)）；球的中间位置由物理推进产生。
- 现有物理推进可能受**摩擦 / 停止阈值 / 边界处理**影响；**不保证**仅依靠 C-03 Physics 就能精确到达 `transit.to`（依据 §44 / C-37 `CONTINUOUS_TRANSIT_PHYSICS_INCOMPATIBLE`，[L1000-L1012](file:///workspace/FE-project/docs/SIMULATION_SPEC.md#L1000-L1012)）。

#### B. 完成 Tick（已追认语义）
- C-39 完成分支调用 **C-23 `applyBallMovementPositionUpdate`**（[#L148-L166](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L148-L166)）。
- **C-23 是 Transit 完成时的唯一终点位置写入边界**（[ball-movement-integration.js#L63-L87](file:///workspace/FE-project/src/core/match/ball-movement-integration.js#L63-L87)）。
- 终点位置按 `transit.to` **精确写入，不进行额外 clamp**。
- `finalizeTransitSettlement` 负责相应的状态结算（State / Control / Possession / Transit），**不重复写入球的位置**（[#L71-L106](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L71-L106)）。

#### C. 已知限制与未决事项（保持原状）
- **完成 Tick 可能产生位置跳变**：本次**不设置跳变幅度上限**，也未声称其无风险。
- **本次不更改 Contact 的完成 Tick 行为**（§53 / §54 契约维持不变）。
- **Goal-Line Detection** 尚未正式接入 C-08 完整链路，其**最终轨迹输入权威**仍待后续独立裁决。
- **§41 的 PASS/SHOT Action 连续运动路径保持原有 BLOCKED 状态**，不因 §42 追认而自动解除。
- 本次**不声称**连续引擎已具备完整、可玩的比赛闭环；**未接入 Production Loop**。

#### 依据（后续 Gate；不改其契约）
- §43（C-36 Owner 决策 A）、§44（C-37 `CONTINUOUS_TRANSIT_PHYSICS_INCOMPATIBLE`）、§45（C-38 **PASS / SEALED**，OPTION_B）、§46（C-39 **PASS / SEALED**，OPTION_B 生产实现）。

---

## §43 Continuous Ball Movement Authority & Tick Integration Decision（Step 39F-M-C-36）

- **状态**：**BLOCKED（一致性验证失败）**。Owner 决策 A/B 已收到，但**现有源码不足以支持该冻结架构**，且验证其成立需修改生产代码 / 新增规则（§12/§13 禁止）。**未修改任何生产代码 / 测试 / Frozen Contract。**

### Owner Decision（已接收）

- **A — positionUpdateMode = MOVEMENT_DRIVEN_TICK**：Transit 期间 `MatchCore.ball.position` 由 C-03 Ball Physics `position += velocity*dt` 每 Tick 推进。
- **B — 权威关系**：`Transit State`（定义 from/to/duration/elapsed/progress/IN_TRANSIT 生命周期）→ `Ball Physics`（连续 Position 推进）→ `MatchCore.ball.position`。Transit **不得**作为第二 Position Writer。

### Verification（对照源码）

- ✅ **Position Truth Owner** = `MatchCore.ball.position`；**Transit Truth Owner** = `MatchCore.ball.transit`（不含 current position）——符合决策。
- ✅ **Invariant A/C**：安装时 `ball.position := transit.from`；`progress < 1` 不 finalize——成立。
- ✅ **dt Source**：C-03 仅接受显式 `dt`（simulation seconds），无 `Date.now`/wall clock；C-11 `TICK_DURATION_SECONDS = 1` 可作来源——成立。
- ❌ **Invariant E（单一 Position Writer）失败**：`finalize()` **写 `ball.position := transit.to`**（[pass-state-update.js#L50-L70](file:///workspace/FE-project/src/core/match/pass-state-update.js#L50-L70) / [shot-state-update.js#L41-L61](file:///workspace/FE-project/src/core/match/shot-state-update.js#L41-L61)）。与 Ball Physics 的每 Tick Position 写入构成**两个独立 Position Writer**。解耦须修改 pass/shot-state-update（§12 禁止）→ **BLOCK #2 / #5**。
- ❌ **Invariant D（完成 Tick `ball.position === transit.to`）失败**：Ball Physics 由 [velocityFromTransit](file:///workspace/FE-project/src/core/match/ball-physics.js#L73) 播种速度 `|to−from|/duration`，但随后受 `FRICTION = 0.20` 衰减 + `STOP_THRESHOLD` 停止 + 边界 clamp，**不含**对 `to`/`duration` 的到达约束。**只读数值探针**：`from={0,0.5}`、`to={0.6,0.5}`、`duration=2`、`v0=0.3` → 累加 2s 后 `ball.position.x ≈ 0.222`（残速 0），**远未到 0.6**。→ **BLOCK #3 / #6**。
- ❌ **C-03 作为唯一连续 Position Writer 不成立**：因 finalize 亦写 position（见上）→ **BLOCK #1**。

### Decision

- **未 PASS**。要落地 Owner 决策，至少需要：(a) 从 `finalize()` 移除 Position 写入（改 pass/shot-state-update）；(b) 新增 Ball Physics「准确到达 `to`」规则（或 completion Tick 的 position 裁决）。二者均属 §12 禁止范围 / §13 #4/#6 触发 → **BLOCKED**。
- 决策 A/B 作为**设计意图**予以记录，但**尚不可由现有源码证明**。

### 解除 BLOCKED 的前置条件（供 Owner + 后续独立 Implementation Gate）

1. 决定 Position 完成写入口径：**physical arrival**（需给 Ball Physics 增加到达约束/终止规则）**或** physics 推进 + **唯一 completion writer**（须明确该 writer 是 finalize 还是 C-23，且仅一个）。
2. 明确 `advance*Transit` 的 finalize 是否**移除** Position 写入（涉及修改 pass/shot-state-update）——属独立 Gate，不在 C-36。
3. 冻结 C-08 生产 Integration Point（Action / Transit advancement / Ball Physics / finalize 顺序）与 dt 接线。

- **不变（红线）**：未修改 C-03 / C-08 / C-23 / C-24 / C-29 / C-33 / C-27 / PASS·SHOT Resolution；未新增 Physics / Transit / Velocity / Acceleration / Spin / Bounce 模型；未引入随机数 / wall clock；未新增测试；未直接写 Ball Position；全量测试不受影响（1473 通过 / 0 失败）。
- **Deferred**：连续运动权威架构的生产落地；本 Gate 完成后 **STOP**，等待 Owner 验收。

---

## §44 Continuous Transit / Ball Physics Endpoint Compatibility Decision（Step 39F-M-C-37）

- **状态**：**BLOCKED**。分类：**C — INCOMPATIBLE**，缺失/冲突标识：`CONTINUOUS_TRANSIT_PHYSICS_INCOMPATIBLE`。**未修改任何生产代码 / 测试 / Frozen Contract。**

### C-03 Physics 方程（源码事实）

- **Position 更新**：半隐式 Euler，逐子步：[ball-physics.js#L142-L227](file:///workspace/FE-project/src/core/match/ball-physics.js#L142-L227) —— ①摩擦 ②`pos += vel*sdt` ③边界反射 ④速度 clamp → 低于 `STOP_THRESHOLD` 归零。
- **Velocity 初始化**：[velocityFromTransit](file:///workspace/FE-project/src/core/match/ball-physics.js#L73) —— `speed = |to−from| / duration`，方向 `(to−from)/|to−from|`。**不含摩擦补偿。**
- **Friction**：**线性（库仑式）** `ns = |v| − FRICTION·sdt`，`FRICTION = 0.20`（[config#L60](file:///workspace/FE-project/src/core/match/ball-physics-config.js#L60)）。非指数衰减。
- **Stop Threshold**：`|v| ≤ 0.006 → v = 0`（[config#L62](file:///workspace/FE-project/src/core/match/ball-physics-config.js#L62)）。
- **无 acceleration / 无 time-to-target / 无 target 跟随**：模块头明确 `不做 targetPosition 路线跟随动画`（[#L12](file:///workspace/FE-project/src/core/match/ball-physics.js#L12)）。

### 数值探针（确定性，无 RNG；dt = TICK_DURATION_SECONDS = 1）

| Probe | from→to | duration | final x | target x | ERROR |
|---|---|---|---|---|---|
| A 单 Tick | (0,0.5)→(0.6,0.5) | 1 | 0.4875 | 0.6 | 0.1125 |
| B 多 Tick | (0,0.5)→(0.6,0.5) | 2 | **0.2059（残速 0，中途停止）** | 0.6 | 0.3941 |
| C partial-dt | (0,0.5)→(0.6,0.5) | 1.5 | 0.3589 | 0.6 | 0.2411 |
| D PASS-like | (0.2,0.5)→(0.8,0.5) | 1 | 0.6875 | 0.8 | 0.1125 |
| E SHOT-like | (0.5,0.5)→(0.95,0.5) | 1 | 0.8375 | 0.95 | 0.1125 |
| **对照 FRICTION=0** | (0,0.5)→(0.6,0.5) | 1 | **0.6** | 0.6 | **0.0000** |

- Case A（无摩擦）：`pos += (d/duration)·dt` 累加恰好 = `d` → **精确到达**（对照 Probe ERROR=0）。
- Case B（现 FRICTION）：连续近似欠达 `≈ ½·FRICTION·duration²`；离散更甚。
- Case C（STOP_THRESHOLD）：**Probe B 在 duration 内已静止**（残余 EXACT 0）→ **永远无法到达 `to`**。
- 误差是**结构性的**（速度模型忽略摩擦 + 摩擦 + 停止阈值），非浮点残差。

### 判定

- **分类 = C — INCOMPATIBLE**：现有 C-03 的**速度模型（`v=d/duration`）+ 线性摩擦 + STOP_THRESHOLD** 与 `transit.from → to → duration` 精确到达存在**结构性冲突**（§13C）。
- **无任何既有端点约束机制**：C-03 明确禁止 target 跟随；无 snap / arrival tolerance / remaining-distance / terminal correction（§6 搜索为空）。
- **并非仅缺一根端点规则**：即便加终末 snap，中间运动仍在中途静止（Probe B 62.5% 欠达）——须同时修正速度/摩擦口径 → 不止"补一条端点规则"。
- **PASS / SHOT 可统一**：两者共用 `velocityFromTransit`，无特殊规则 → **无** `PASS_SHOT_ENDPOINT_SEMANTICS_CONFLICT`。

### Owner Decision 建议（**不自行冻结**）

- **Current C-03 Physics：INCOMPATIBLE**（无法在 `from→to→duration` 下成为唯一精确连续 Position Writer）。
- **Required future architecture**（建议，待 Owner 裁决）：引入 **确定性 Transit Movement Solver**——(1) 摩擦补偿速度剖面使 `∫v dt = |to−from|`，或 (2) 明确放弃"物理到达"改由**唯一 completion writer** 在完成 Tick 落 `to`；(3) 保证**单一 Position Writer**（移除/迁移 `finalize` 的 position 写），(4) 冻结 C-08 生产 Integration Point + dt 接线。
- **Required new Gate**：`Transit Endpoint / Movement Solver Integration Gate`（或等价的 Owner Decision Gate）——**不得**在 C-37 内新增规则。
- **不得**自行把 `MOVEMENT_DRIVEN_TICK` 改回 `COMPLETION_TICK`。

- **不变（红线）**：未修改 C-03 / C-08 / C-23 / C-24 / C-29 / C-33 / C-27 / PASS·SHOT Resolution·State-Update；未新增端点规则 / 摩擦模型 / 速度求解器；未引入随机数 / wall clock；未直接写 Ball Position；未新增生产测试（仅只读探针）；全量测试不受影响（1473 通过 / 0 失败）。
- **Deferred**：Transit Endpoint 兼容性的最终裁决与生产落地；本 Gate 完成后 **STOP**，等待 Owner 验收。

---

## §45 Transit Endpoint Authority / Completion Writer Architecture Decision（Step 39F-M-C-38）

- **状态**：**PASS / SEALED**（架构调查完成，非实施）。**Recommended Architecture: OPTION_B — Completion Writer**。**未修改任何生产代码 / 测试 / Frozen Contract。**

### 前提复核

- C-36 冻结 `positionUpdateMode = MOVEMENT_DRIVEN_TICK`；C-37 证明 C-03 无法在 `from→to→duration` 下精确到达（`CONTINUOUS_TRANSIT_PHYSICS_INCOMPATIBLE`）。本 Gate 裁决：如何同时满足 **Continuous Movement + Exact Endpoint + Single Position Writer**。

### Option A — Transit Movement Solver（不推荐）

- 需新增组件求解「摩擦补偿速度剖面」使离散积分恰达 `to`。
- **BLOCK A**：产生新的、未冻结的 **Velocity / Movement Truth**。
- **BLOCK F**：须精确建模 C-03 的离散子步/线性摩擦/`STOP_THRESHOLD`（否则无法保证），实质是**新 Movement Model**（新速度/摩擦规则）。且 C-03 明令禁止 target 跟随（[#L12](file:///workspace/FE-project/src/core/match/ball-physics.js#L12)）。
- 结论：**不可成立**（若选它即触发 BLOCK A/F）。

### Option B — Completion Writer（推荐，可成立）

- 语义：`progress < 1` → Ball Physics 更新**中间** Position；`progress ≥ 1` → **唯一** Completion Position Boundary 写 `position = transit.to`。
- **不引入新运动模型**：仅「完成条件成立 → 唯一 Position Boundary → `position = to`」——§8 明确允许作为 Completion Integration 候选。
- **唯一 writer 蓝图（§5B）成立**：`Ball Physics → 中间 Position` + `Completion Boundary → 唯一最终 Correction`，**不存在**第三个生产 writer。

### Boundary 兼容性

- **C-23**（[ball-movement-integration.js#L63](file:///workspace/FE-project/src/core/match/ball-movement-integration.js#L63)）：一次性 `Movement State → endPosition`（要求 `start===ball.position`），**正是**完成点写入语义 → **可作唯一 Transit Completion Position Boundary**；与 C-36 §5「C-23 不得作为每 Tick 连续 writer」**一致**（C-23 = 完成，Physics = 每 Tick）。
- **C-29**（`applyInstantBallPositionUpdate`）：语义为 **INSTANT / Interaction** → **不可**作为 Transit Completion Boundary（§6；不将 Transit Completion 等同于 Interaction Instant）。
- **C-32**：Interaction Position Ownership → **不涉及**、不修改。
- **C-33**：Interaction Instant Position Integration → 与 Transit 完成路径**互斥分离**（INSTANT→C-29；CONTINUOUS→C-23 完成 + Physics 中间）。

### Finalize 职责拆解

- **PASS** `finalize`（[pass-state-update.js#L50-L70](file:///workspace/FE-project/src/core/match/pass-state-update.js#L50-L70)）：`position=to` + `state` + `control` + `possessingTeamId` + `transit=undefined`。
- **SHOT** `finalize`（[shot-state-update.js#L41-L61](file:///workspace/FE-project/src/core/match/shot-state-update.js#L41-L61)）：`position=to` + `state`（含 GOAL）+ `control` + `possessingTeamId` + `transit=undefined`。
- **结论**：Position Ownership **可分离**；剥离后 finalize 仍可独立承担 **state / control / possession / transit 清理**。

### Option A / B 对比

| 项 | Option A：Movement Solver | Option B：Completion Writer |
|---|---|---|
| 中间 Tick Position | Physics（需 Solver 保证） | Ball Physics（每 Tick） |
| 最终 Position | Solver→Physics 精确落 `to` | 唯一 Completion Boundary 落 `to` |
| 需新运动模型 | **是**（新速度/摩擦求解） | **否**（仅终端修正） |
| 需改 C-03 | 是（否则欠达/停止） | 否 |
| 需改 Transit | 间接 | 否（finalize 仅迁移 position 职责，属未来 Gate） |
| 唯一 Position Writer | 是（唯一=Physics）但需新 Truth | 是（Physics 中间 + 唯一 Completion） |
| 与 C-23 兼容 | 差 | **好**（C-23 = 完成边界） |
| 与 C-29 兼容 | 不适用 | 明确分离 |
| C-32/C-33 冲突 | 无 | 无 |
| PASS/SHOT 统一 | 是 | **是** |
| 复杂度 | 高 | 中 |
| 架构风险 | **高**（新 Truth / 离散脆弱） | 低 |

### 结论

- **Recommended Architecture：OPTION_B**（Completion Writer）。Completion Boundary 建议 = **C-23**；连续中间 writer = **C-03 Ball Physics**；`finalize` 未来**仅保留** state/possession（其 position 写迁至唯一 Completion Boundary）。
- **PASS / SEALED**：Option B 架构可成立；单一 Position Truth（`MatchCore.ball.position`）；PASS/SHOT 可统一；C-23/C-29/C-32/C-33 边界清晰；无需在本 Gate 改任何生产代码。
- **Required Future Gate**：`Transit Continuous Movement Integration Gate` —— (1) 落实 Physics 中间推进；(2) C-23 作为唯一 Completion Boundary；(3) finalize 迁出 position 职责；(4) C-08 生产 Integration Point + dt 接线（simulation Tick，`TICK_DURATION_SECONDS=1`）。
- **不自行冻结**：Recommendation 待 Owner 确认后方可进入实施 Gate。

- **不变（红线）**：未修改 C-03 / C-08 / C-23 / C-24 / C-29 / C-32 / C-33 / C-27 / PASS·SHOT Resolution·State-Update；未新增 Solver / Endpoint Correction / 速度规则；未直接写 Ball Position；全量测试不受影响（1473 通过 / 0 失败）。
- **Deferred**：Option B 的生产实施；本 Gate 完成后 **STOP**，等待 Owner 验收。

## §46 Transit Continuous Movement Integration（Step 39F-M-C-39 已实现）

- **状态**：**PASS / SEALED**（Implementation Gate）。落地 C-38 已冻结的 **OPTION_B — Completion Writer**。

### 生产连续运动链（冻结）

```
PASS / SHOT Transit（Transit Truth）
        ↓
C-08 runMatchTick  （CONTINUOUS_TRANSIT 阶段）
        ↓
Continuous Movement Integration  （continuous-ball-movement-integration.js）
        ↓
C-03 Ball Physics  →  中间 MatchCore.ball.position（非完成 Tick）
        ↓
Transit Completion Detection（elapsed >= duration - ε）
        ↓
C-23 applyBallMovementPositionUpdate  →  MatchCore.ball.position = transit.to（完成 Tick）
        ↓
finalizeTransitSettlement（State / Control / Possession / Transit 清理，**不写 Position**）
```

### Position Writer 协议（冻结）

- **非完成 Tick**（`elapsed < duration - ε`）：仅 **C-03 Physics** 推进**中间** `ball.position`；**不调用 C-23**。
- **完成 Tick**（`elapsed >= duration - ε`）：**不跑 Physics**；**C-23** 为唯一 Completion Boundary 写 `position = transit.to`；Finalize 只做状态/球权/Transit 清理。
- **无双写**：完成 Tick 上 Physics 不产生最终 Position；最终 Position 恒为 `transit.to`（精确 `===`，非 `≈`）。

### dt 来源（唯一时间 Truth）

- dt = 生产 Match Tick 注入的 **simulation seconds**：`tickInput.deltaTime ?? MATCH_CLOCK_CONFIG.TICK_DURATION_SECONDS`（= 1）。
- **不新增第二套 Clock / Tick / Time Truth**；不使用 `Date.now` / wall clock / `Math.random` / 渲染 FPS。
- `elapsed` / `progress` 属 **Transit Truth**：`progress = clamp01(elapsed / duration)`；**不由 Physics 实际距离反推**。
- **完成容差 ε = 1e-9**：仅用于判定「到达完成条件」，避免多 Tick 浮点累加（如 `0.3×3+0.1 < 1`）永远无法完成；不改变 `duration` / `elapsed` / `progress` 定义。

### PASS / SHOT 统一

- PASS / SHOT 共享同一 **Continuous Movement Integration Boundary**（`advanceContinuousBallMovement`）；
  `pass-state-update.js` / `shot-state-update.js` 的 `advance*Transit` 均委托之，无第二套 Position Integration。
- `finalize` 的 **Position Ownership 已迁出**；仅保留 State / Control / Possession / Transit 清理（PASS/SHOT 语义保持：`INACCURATE/MISS→FREE`、`SAVE/BLOCKED→CONTROLLED`、`GOAL→GOAL`）。

### 边界（红线）

- **不改 C-03 Physics**（摩擦 / STOP_THRESHOLD / substep / 边界反射 / `velocityFromTransit` 均冻结）；**不新增 Movement Solver**。
- Interaction **INSTANT** 路径（C-27 → C-32 → C-29）**不受影响**，与 CONTINUOUS 路径互斥分离。
- **不改 Goal / C-14 / C-15 / C-20 / C-21**；Goal 接线留给后续 Gate。
- **无 Transit 时 NO_OP**：不改 position / velocity，不创建 Transit。
- 无第二套 Match Tick / Clock / Time Truth。

### Files Modified

- `src/core/match/continuous-ball-movement-integration.js`（新增）：共享积分器 + 统一 Finalize。
- `src/core/match/match-tick.js`：新增 `CONTINUOUS_TRANSIT` 阶段 + dt 注入。
- `src/core/match/match-tick-config.js`：新增 stage / event 常量。
- `src/core/match/pass-state-update.js`、`shot-state-update.js`：委托共享积分器，移除 finalize 的 Position 写入。
- `tests/continuous-ball-movement-integration.test.js`（新增）、`tests/match-tick.test.js`（MT-16 依赖白名单加入合法新依赖）、`tests/run.js`（注册新测试）。

### 测试

- 新增 **22** 个用例（C39-A ~ C39-J、C39-11 ~ C39-22），覆盖：PASS/SHOT 多 Tick、Partial Tick（`0.4+0.4+0.2` / `0.3+0.3+0.3+0.1`）、Overshoot（`0.8+0.5`）、精确落点、完成 Tick 单写、Finalize 不写 Position、无 Transit NO_OP、失败传播、dt 语义、生产 `runMatchTick` 集成、共享边界、源码红线。
- **全量回归：1495 通过 / 0 失败**（before 1473 / after 1495，delta +22）。

- **Deferred**：Player↔Ball Contact 接线、Continuous Transit → Goal Detection / Resolution 接线、Physics Redesign。
- **本 Gate 完成后 STOP**，等待 Owner 验收；**不自行进入 C-40**。

## §47 Player-Ball Contact Boundary / Timing Decision（Step 39F-M-C-40）

**状态**：**BLOCKED / SEALED**（Decision / Foundation Gate；调查完成，结论为 BLOCKED）。未修改任何生产代码 / 测试 / Frozen Contract（仅本节文档 + 只读探针）。

> 结论先行：**Player Position Truth 存在但未接入 C-08 Tick，且与 Tick 的 dt 单位口径冲突（BLOCK A）**；
> **Contact 目前仅存在于 C-03 Physics 单元内部，生产 Tick 不产生 Contact**；
> **Contact 与 Interaction 无正式连接（Model 4），Contact 是否可中断 Transit 无任何现有规则**。
> 因此本 Gate 结论为 BLOCKED，需 Owner 冻结 Contact 边界后再进入下一 Gate。

---

### 39F-M-C-40 Gate Report

#### 1. C-39 Context Verification
`match-tick.js` 的 `CONTINUOUS_TRANSIT` 阶段调用 `advanceContinuousBallMovement(matchCore, deltaTime)`（[match-tick.js](file:///workspace/FE-project/src/core/match/match-tick.js#L135-L146)），**不传 players**；dt 来自 `TICK_DURATION_SECONDS`（simulation seconds）。C-39 已把 C-03 Physics（中间）/ C-23（完成）接入生产 Tick，但**只接入 Ball Position，未接入 Player。**

#### 2. Current Match Tick Order
`VALIDATE → SNAPSHOT → CONTINUOUS_TRANSIT → ACTION → INTERACTION_RESOLVE → INTERACTION_INTEGRATE → SECOND_BALL_RESOLVE/INTEGRATE（可选）→ INVARIANTS`（[match-tick.js](file:///workspace/FE-project/src/core/match/match-tick.js#L119-L242)）。
探针 P5 实测 stages = `["validate","snapshot","continuous_transit","action","invariants"]`（无动作时短路）。**Contact 不在该序列的任何显式阶段中**。

#### 3. Player Position Truth
存在且唯一：`players[].positionOnPitch`，唯一写入者是 `updateMovement`（C-movement，经 transient `matchCore.movement`，[movement-update.js](file:///workspace/FE-project/src/core/match/movement-update.js)）。
**但**：C-08 Tick **不调用** `updateMovement`，Tick 结果**无** `movement` 字段（探针 P5）；且 `updateMovement` dt 单位是 **simulation minute**，而 C-08 Tick dt 是 **simulation second**（`TICK_DURATION_SECONDS = 1`）——**单位口径不一致**。
→ **BLOCK A `PLAYER_POSITION_TRUTH_NOT_TICK_INTEGRATED`**：Contact 若接入生产 Tick，无法确定使用哪个 Player Position Truth。

#### 4. Ball Position Truth
唯一：`MatchCore.ball.position`。Contact 系统（C-03）只**读** `ball.position` 并写回同一字段；**未**产生第二套 Ball Position Truth。`ball.contacting[]` / `ball.lastTouchPlayerId` 是 transient 派生信息，非独立 Truth。

#### 5. Ball Transit Truth
唯一：`MatchCore.ball.transit`（`{ state, from, to, duration, progress, elapsed, outcome, ... }`），由 C-39 / C-23 管理。Contact **不触碰** `transit`（探针 P2 `transitKept=true`）。

#### 6. Existing Contact-like Logic
已存在，但**仅限 C-03 单元内部**：
- 几何：[ball-contact.js](file:///workspace/FE-project/src/core/match/ball-contact.js) 的 `computeBallContact`（离散）与 `sweptBallContact`（线段防 tunneling）。
- 物理：[ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js) 的 `stepBallPhysics` 在提供 `players` 时执行去穿透（改 position）、法向相对速度反射（改 velocity）、写 `lastTouchPlayerId` / `contacting[]`。
- `ball-contact.js` 的**唯一生产消费者**是 `ball-physics.js`；生产 Tick 未把 players 传入 Physics。

#### 7. Contact vs Interaction Relationship
**Model 4：二者目前完全没有正式连接。** Contact 属 C-03 Physics（几何，CONTINUOUS_TRANSIT 内）；Interaction（DRIBBLE/TACKLE/PRESS/INTERCEPTION）属 C-05（ACTION 阶段之后，概率性 disposition，C-27 冻结为 INSTANT）。二者**不共享状态机、无仲裁**。

#### 8. Contact Timing Analysis
选项判定（基于现有代码）：
- Option A（Snapshot→Contact→Movement）：**否**，Snapshot 无该逻辑。
- Option B（Continuous Movement→Contact）：**是**——Contact 内嵌于 C-03 Physics 的连续推进中，是「读取连续运动后的 Position」。
- Option C / D（独立阶段）：**否**，无独立 Contact 阶段。
即：**若接线，Contact 应落在 Continuous Movement 内（Option B）**；但**生产 Integration Point 缺失**（players 未传入）。

#### 9. Contact During Transit
- Case A（IN_TRANSIT）：几何上**可**接触（探针 P2 召回到 4 次 p1 接触，`vel 0.6→0.4`），但**无任何业务规则**规定其语义/结果。
- Case B（Transit Completion Tick）：完成 Tick **跳过 Physics**（探针 P1b，`lastTouch=null`）→ 永不产生 Contact。
- Case C（无 Transit）：CONTROLLED/FREE 球同理仅在 Physics 内可接触，未接线。
- Case D（Instant Interaction 后）：Interaction 写入位置并 `delete transit`、`velocity={0,0}`，随后球不在 Transit。
**读取口径**：C-03 使用**当前 Tick 内子步的离散 Position + `from→to` 线段（swept）**，而非仅 `ball.transit.from/to`；INTERCEPTION（C-05）另用 `closestPointOnSegment(actor, transit.from, transit.to)`。
→ **BLOCK C `CONTACT_IN_TRANSIT_RULE_ABSENT`**。

#### 10. Transit Interruption Analysis
**Contact 不能中断 Transit**：`stepBallPhysics` 不读、不清除、不重写 `transit`（探针 P2 `transitKept=true`）。
- Transit 清除权：**目前无**（仅 C-05 `applyInteractionStateUpdate` 会 `delete transit`，但那属 Interaction，非 Contact）。
- Contact 后 Ball Position / Velocity 写入权：C-03 物理层（去穿透 + 反射）。
- 新 Ball State / 立即进入 Interaction Resolution：**未定义**。
→ **BLOCK D `CONTACT_TRANSIT_INTERRUPTION_UNDEFINED`**。

#### 11. Contact Position Ownership
模型判定：当前代码实际支持 **A（Detection Only）+ C-03 已有的局部物理响应**，即几何检测 + 去穿透 position 修正（属 C-03 已冻结物理，非本 Gate 新增）。
不属 B（未产生 `targetPosition` 走 C-23）。**禁止**本 Gate 新增 C-03 Physics Collision。与 C-39 唯一中间 writer 一致（Contact 不创建第二套）。

#### 12. Contact Velocity Ownership
C-03 Physics **拥有**（法向反射 `CONTACT_RESTITUTION` + 切向保留 `CONTACT_TANGENT_RETENTION`）。但 C-05 `applyInteractionStateUpdate` **也写** `velocity`，二者**无仲裁**（见 §13 / BLOCK E）。

#### 13. Possession Ownership
Contact **无** possession / control / possessingTeamId / looseBall 写权限（C-03 明令只做几何物理）。这些字段的唯一 Interaction writer 是 `applyInteractionStateUpdate`（[interaction-state-update.js](file:///workspace/FE-project/src/core/match/interaction-state-update.js)）。
但 Contact 写 `lastTouchPlayerId` / `velocity`，与 Interaction 的写集**重叠且无仲裁**。
→ **BLOCK E `CONTACT_POSSESSION_WRITER_UNDEFINED`**（两个互相冲突的 State Writer，未连接）。

#### 14. Last Touch Ownership
`lastTouchPlayerId` 当前由 C-03 `stepBallPhysics`（接触）与 C-05 `applyInteractionStateUpdate`（Interstate）**两处**可写，无唯一 owner。Contact **不得**成为第二个 Last Touch Writer；未来若需改，必须经现有 Interaction / State Mutation Boundary。本 Gate 仅调查。

#### 15. Contact Geometry Availability
几何**已存在**：`CONTACT_RADIUS = 0.030`（探针 P3 确认）、`CONTACT_RESTITUTION` / `CONTACT_TANGENT_RETENTION` / `CONTACT_HYSTERESIS`，及 `computeBallContact` / `sweptBallContact`。
但**业务语义缺失**：无「抢断/盘带/解围/成功」的判定定义；几何只回答「是否相交」。
→ **`CONTACT_GEOMETRY_SCHEMA_GAP`（业务语义部分）**：几何充足，业务语义不足。

#### 16. Completion Tick Ordering
现有代码隐含顺序 = `Physics → Completion → C-23`：完成 Tick **不跑 Physics**（探针 P1b：玩家站在 `transit.to` 也 `lastTouch=null`，直接落到 `state=CONTROLLED / control=t`）。
候选 `Physics → Contact → Completion → C-23` 与现状**会产生不同的 Position/possession 结果**。
→ **BLOCK F `CONTACT_COMPLETION_ORDER_CONFLICT`**。

#### 17. Existing Tests / Hidden Contracts
- **存在隐式 C-03 Contact Contract（单元级）**：[match-ball-physics.test.js](file:///workspace/FE-project/tests/match-ball-physics.test.js#L85-L130) 的 F/G 段断言 `stepBallPhysics` 的接触距离、法向、`lastTouchPlayerId`、防 tunneling、确定性——**但仅测 Physics 单元，不测生产 Tick 接线**。
- 相关测试：`continuous-ball-movement-integration` / `match-ball-causality` / `interaction-position-ownership` / `match-interaction-resolution` / `match-interaction-integration` / `interaction-ball-movement-semantics` / `interaction-ball-transit` / `interaction-instant-ball-position-integration` 等。
- **未发现**把 players 传入生产 Tick 的 Contact 断言 → 生产无 Contract。

#### 18. Proposed Minimal Contact Boundary（仅建议，未落地）
- 若 Owner 冻结：将 Contact 定义为 **Continuous Movement（Option B）内**的只读检测 + C-03 既有几何/速度响应；**不**新增 `PLAYER_BALL_CONTACT` Tick 阶段，**不**新增 Contact Engine。
- 前置依赖：必须先解决 §3 的 Player Position Truth 接入与 dt 单位口径（BLOCK A）。
- Contact Result 建议形状（**不写入 Schema**）：`{ ok, playerId, contactType, ballPosition, detectionMeta }`；**禁止** `ball.contactPosition / collisionPosition / lastContactPosition / physicsPosition / transitPosition` 等第二套 Truth。
- 若 Contact 需改 possession / transit / lastTouch → **必须**经现有 Interaction / State Mutation Boundary，不得建立第二套 writer。

#### 19. Required Future Gate
`Player-Ball Contact Boundary Freeze Gate`（由 Owner 决策）：
1. Player Position Truth 接入 C-08 Tick 与 dt 单位口径（minute↔second）；
2. Contact 的 Tick 阶段与生产 Integration Point（players 传入）；
3. Contact 是否/如何中断 Transit（Transit 清除权归属）；
4. Contact 的 Position / Velocity / Possession / Last Touch 权威边界与与 Interaction 的仲裁；
5. Completion Tick 的 Contact 顺序。
**不得**在 C-40 内自行制定。

#### 20. Files Modified
- `docs/SIMULATION_SPEC.md`（仅新增/完善本节 §47）。
- 无任何 `src/**`、`tests/**`、Frozen Contract 改动。

#### 21. Tests / Probes
- 只读探针：`/tmp/c40-probe.mjs`（未进入仓库）。P1 生产非完成 Tick `contacting=[]/lastTouch=null`；P1b 完成 Tick 跳过 Physics；P2 `stepBallPhysics` + players → 4 次接触、`vel 0.6→0.4`、`transitKept=true`；P3 `CONTACT_RADIUS=0.03`；P4 `updateMovement(1)` 推进球员；P5 Tick 结果无 `movement`。
- 未新增仓库测试（本 Gate 无可冻结的新 Contract）。

#### 22. Full Regression
`node tests/run.js` → **1495 通过 / 0 失败（共 1495 用例）**，与 §46 基线一致（本次仅改文档，无代码路径变更）。

#### 23. Technical Debt
- **Player Position Truth 未接入 Tick + dt 单位不一致**（minute↔second）——Contact 生产接线的前置阻塞。
- **Contact 与 Interaction 双 writer 未仲裁**（`velocity` / `lastTouchPlayerId`）。
- **Contact 无 Transit 语义**（不可中断、无清除权、无接触后重新解析）。
- **Completion Tick 跳过 Physics**，最后一步永不产生 Contact。
- **Contact 缺业务语义层**（只有几何，无抢断/盘带等动作定义）。

#### 24. Final PASS / BLOCKED
**BLOCKED / SEALED**。命中 **BLOCK A（Player Position Truth 未接入 Tick）、BLOCK C（Transit 中 Contact 无规则）、BLOCK D（是否可中断 Transit 未定义）、BLOCK E（Contact 与 Interaction 双 writer 冲突）、BLOCK F（Completion Tick 顺序冲突）**。
未命中 BLOCK B（几何存在）/ G（无需改 C-03）/ H（无第二套 Ball Truth）/ I（未改 Frozen Contract）。

- **红线遵守**：未改 C-03 / C-08 / C-23 / C-29 / C-32 / C-33 / C-27 / Interaction / PASS·SHOT；未新增 Contact / Collision Engine、未改 Physics、未改 Schema、未新增 Ball / Player Truth；无 `Date.now` / `Math.random`。

**STOP — 等待 Owner 验收。不得自行进入 C-41。**

## §48 Player Position Tick Authority / Contact Arbitration Decision Foundation（Step 39F-M-C-41）

**状态**：**BLOCKED / SEALED**（Owner Decision Foundation Gate；调查完成，结论为 BLOCKED，Owner Decision Matrix 已就绪）。未修改任何生产代码 / 测试 / Frozen Contract（仅本节文档 + 只读探针）。

> 结论先行：C-41 的目标不是「做 Contact」，而是把 **Player Position 时间权威、Contact 时序、Transit 中断权、Position/Velocity/Possession/Last Touch 写入权、Completion 顺序**一次性调查清楚。
> 结果：多项**无法由现有 Frozen Contract 唯一推导**，属 Owner Architecture Decision → 全部标记 `OWNER_DECISION_REQUIRED`。
> 关键新发现：**C-39 集成器本就接受 `options.players`，唯一缺失的是生产 Tick 未传入**；且 `advanceContinuousBallMovement` 在非完成 Tick 会**强制保留 `state=IN_TRANSIT` 与 `transit`**，即现有 Frozen Contract **禁止** Contact 中断 Transit。

---

### 39F-M-C-41 Gate Report

#### 1. C-40 Context Verification
C-40 结论 **BLOCKED / SEALED**，命中 BLOCK A（Player Position 未接入 Tick）/ C（Transit 中 Contact 无规则）/ D（不可中断 Transit 未定义）/ E（Contact↔Interaction 双 writer 冲突）/ F（Completion Tick 顺序冲突）。本 Gate 在此基础上只做 Owner 决策调查，不实现 Contact（见 §47）。

#### 2. Player Position Current Truth
唯一：`players[].positionOnPitch`。唯一写入者是 `updateMovement`（[movement-update.js](file:///workspace/FE-project/src/core/match/movement-update.js#L71-L174)），经 transient `matchCore.movement`（`initMovementState` 建立，未持久化）。
**生产调用图证明**：`updateMovement` **在 `src/**` 中无任何调用点**（`runMatchTick` / `runMatchTicks` / `runMatchTickWithBallSegment` / `trajectory-goal-match-tick` 均不调用）。即 **Player Position 当前不是 C-08 Tick 的产出**。

#### 3. Player Position Time Unit
`updateMovement(matchCore, dt)` 的 `dt` 单位 = **simulation minutes**（[movement-update.js](file:///workspace/FE-project/src/core/match/movement-update.js#L71) 注释；`REEVAL.COMMIT_MAX_MINUTES` / `stepDt` 参与 `elapsed` 累加）。
而 MatchClock 与 Ball Physics 均为 **simulation seconds**：`TICK_DURATION_SECONDS = 1`（[match-clock-config.js](file:///workspace/FE-project/src/core/match/match-clock-config.js#L18-L23)）；`ball-physics-config.js` 明确注明「movement 用 minute，本层用 second，属既有口径差异」。
→ **同一 Simulation Clock，两种 dt 口径（minute vs second）**。

#### 4. Player / Ball Simulation Time Relationship
- Ball Position = **Tick-level simulation truth**（`position += velocity * dt`，dt = simulation seconds，[ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L106-L153)）。
- Player Position 若接入，必须共享**同一 Tick / 同一 dt / 同一 Simulation Time**，否则 Contact 会做「Player@minute 口径位置 vs Ball@second 口径位置」的**跨时间比较**。
- C-03 已提供**既有换算适配器** `playerMotionList(matchCore)`：位置读 `positionOnPitch`，速度由 `movement.players[id].speed / 60`（minute→second）派生（[ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L256-L277)，探针 P5：speed=60 → velocity=1）。
- 该适配器**已存在但仅被 `stepMatchBall`（Headless Harness）使用**，未接生产 Tick。
→ 时间关系**技术上可统一（seconds）**，但**口径切换属 Owner 决策**（不得用 wall clock）。

#### 5. Current Match Tick Order
`VALIDATE → SNAPSHOT → CONTINUOUS_TRANSIT → ACTION → INTERACTION_RESOLVE → INTERACTION_INTEGRATE → SECOND_BALL_*（可选）→ INVARIANTS`（[match-tick.js](file:///workspace/FE-project/src/core/match/match-tick.js#L119-L242)）。
`CONTINUOUS_TRANSIT` 调用 `advanceContinuousBallMovement(matchCore, deltaTime)`（**不传 options**）；`ACTION` 后 `resolveInteraction` → `integrateInteractionResolution`。

#### 6. Contact Integration Point Options
**关键发现**：`advanceContinuousBallMovement(matchCore, deltaTime, options)` **已支持 `options.players`**，并在非完成 Tick 把它透传给 `stepBallPhysics`（[continuous-ball-movement-integration.js](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L162-L165)）。探针 P1：传入 players → 立即产生接触（`lastTouch=p1`、`contacting=["p1"]`）。
- Option A（SNAPSHOT→CONTINUOUS_TRANSIT→CONTACT→ACTION）：**等于把 players 传入 CONTINUOUS_TRANSIT**，与现有 hook 一致。
- Option B（…→ACTION→CONTACT）：与现有调用图不符（Contact 不会在 Interaction 后）。
- Option C（CONTACT+INTERACTION 同阶段）：无现有支撑。
- Option D（独立 PLAYER_BALL_CONTACT 阶段）：**需改 C-08**，违反本 Gate 禁止项。
→ **唯一与现有调用图一致的是「CONTINUOUS_TRANSIT 内（Option A/B 之实）」，且集成点已存在**；但**是否正式接线属 Owner 决策**（`OWNER_DECISION_REQUIRED`）。

#### 7. Contact Detection / Resolution Boundary
现状：C-03 `stepBallPhysics` **把 Detection 与 Resolution 合并在 Physics 内部**（检测即直接改 position / velocity，[ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L156-L214)）。
`ball-contact.js` 只提供**纯几何 Detection**（`computeBallContact` / `sweptBallContact`），**不判定**抢断/盘带/犯规。
建议方向（仅建议，不重构 C-03）：未来分 `Detection → ContactResult → Resolution`，比 Physics 内直改更可解释。**本 Gate 不重构**，是否拆分属 Owner 决策。

#### 8. Transit Interruption Options
**现有 Frozen Contract 已事实上排除 Option B**：`advanceContinuousBallMovement` 非完成 Tick 在 `stepBallPhysics` 之后**强制覆写** `state = IN_TRANSIT` 并**重建 `transit`**（`elapsed`/`progress` 推进），即无论 Physics 接触与否，**Transit 不被中断**（[continuous-ball-movement-integration.js](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L166-L180)；探针 P1 `transitKept=true`）。
- Option A（Contact 不能中断，仅记录/等待）：**与现状一致**。
- Option B（Contact 可中断 → Cancel/Complete → Interaction）：**将违反 C-39 冻结写入协议**，需 Owner 决策。
→ `OWNER_DECISION_REQUIRED`；在 Owner 决策前，默认 **Option A**。

#### 9. Transit Clearing Authority
当前清除 `transit` 的两处：① C-39 完成 Tick `finalizeTransitSettlement`（`transit: undefined`）；② C-05 `applyInteractionStateUpdate`（`delete nextBall.transit`，仅 CONTROLLED/FREE 分支）。**Contact 无清除权**。
候选：Option A（Transit 自己完成）/ B（Contact 取消）/ C（Interaction 取消）/ D（独立 Integration 取消）。
→ 必须避免「Contact + Interaction + Transit 三系统都能 `transit = undefined`」。本 Gate 推荐 **A + C（现状）**，但**冻结归属属 Owner 决策** → `OWNER_DECISION_REQUIRED`。

#### 10. Ball Position Writer Analysis
现有 Position 写入路径（**按路径分离**）：
- 非完成 Transit 中间 Position：C-03 Physics（`stepBallPhysics`）。
- 完成 Transit 终态 Position：C-23 Completion Boundary（`applyBallMovementPositionUpdate` → `position = transit.to`）。
- Interaction INSTANT Position：C-32 → C-29（`applyInstantBallPositionUpdate`）。
Contact 若新增「targetPosition 路由」将引入**第 4 条 Position Write Path**（Option B）。
→ 推荐 **Option A：Contact 不引入新 Position Writer**；若需写，只能复用 C-03 既有物理（即 Contact 本就 = C-03）。**采纳与否属 Owner 决策**。

#### 11. Ball Velocity Writer Analysis
可写 `ball.velocity` 的位置：① C-03 `stepBallPhysics`（摩擦 / 反射）；② C-05 `applyInteractionStateUpdate`（CONTROLLED/FREE → `{0,0}`）；③ `velocityFromTransit`（IN_TRANSIT 缺速度时播种）。
**同 Tick 竞争分析**：`CONTINUOUS_TRANSIT`（C-03）先跑，`INTERACTION_INTEGRATE`（C-05）后跑；若二者同 Tick 都写 velocity，则 **Interaction 的 `{0,0}` 覆盖 C-03 的反射结果**（后写胜）。当前二者**路径互斥**（Interaction 需 CONTROLLED，Contact 属 Physics），但**无显式仲裁契约**。
→ **`CONTACT_VELOCITY_AUTHORITY_UNDEFINED`**：无法由 Frozen Contract 唯一推导 → `OWNER_DECISION_REQUIRED`。

#### 12. Possession Writer Analysis
`possession` / `control` / `possessingTeamId` / `looseBall` 的写入者：**唯一** `applyInteractionStateUpdate`（经 `integrateInteractionResolution`；`finalizeTransitSettlement` 亦在完成 Tick 写 control/possessingTeamId）。
Contact **无** possession 写权限（C-03 明令「不自动把 Contact 变成 possession transfer」）。
→ 推荐 **single authoritative mutation path = `applyInteractionStateUpdate`**；Contact 永不得写 possession。**是否确认属 Owner 决策**。

#### 13. Last Touch Writer Analysis
`lastTouchPlayerId` 当前可写两处：① C-03 `stepBallPhysics`（接触时 `lastTouch = playerId`）；② C-05 `applyInteractionStateUpdate`（CONTROLLED → toPlayerId；否则 actorId）。
候选 A（C-03 保留）/ B（Contact Resolution 成为 writer）/ C（Interaction 成为 writer）/ D（统一进 State Mutation Boundary）。
→ 推荐 **Option D（统一进 State Mutation Boundary）** 或至少明确唯一 owner；现状双写属技术债 → `OWNER_DECISION_REQUIRED`。

#### 14. contacting[] Lifecycle
- 存在于 **BallState**（`sanitizeBall` 保留并去重排序，[ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L48-L67)），**非持久化**（Schema 仍为 10）。
- 生命周期：`stepBallPhysics` 内以 `Set` 维护，末尾按 `radius × CONTACT_HYSTERESIS` 清理（脱离即移除）。
- **泄漏分析**（探针 P4）：接触后 `contacting=["p1"]`；**下一 Tick 若 players 为空 → 因找不到球员被删除为 `[]`**；若 players 持续传入，则按 hysteresis 保持。→ **Tick N 的结果会带入 Tick N+1 的输入 BallState**（同一 ball 对象链），属 **transient 派生，非正式 Truth**。
→ 不得自行改 Schema；其是否升级为正式 Contact Result 属 Owner 决策。

#### 15. Contact / Interaction Arbitration
现状 = **Model D（互相独立）**：Contact 属 C-03 Physics（几何、连续、无 RNG）；Interaction 属 C-05（概率 disposition、RNG、需 CONTROLLED 或 IN_TRANSIT）。探针 P6：TACKLE 在距离 0.001（远小于 `CONTACT_RADIUS=0.03`）时按**自身概率几何**判 `TACKLE_LOOSE`，**不读 `computeBallContact`**。
→ 因二者**写集重叠**（`velocity` / `lastTouchPlayerId`）且**无仲裁**，**不能推荐 Model D**（无法证明不冲突）→ 倾向 **Model A（Contact = Detection → Interaction Resolution）**。但**仲裁模型属 Owner 决策** → `OWNER_DECISION_REQUIRED`。

#### 16. Action / Contact Relationship
`PASS` / `SHOT`：产生 `transit`（Continuous，C-39 消费）。`DRIBBLE` / `TACKLE` / `PRESS`：需 `ball.control`，**概率 disposition**。`INTERCEPTION`：需 `ball.transit`，用 `closestPointOnSegment(actor, transit.from, transit.to)` + `progress` 判成功率（[interaction-resolution.js](file:///workspace/FE-project/src/core/match/interaction-resolution.js#L452-L520)）。
**结论**：TACKLE / PRESS / INTERCEPTION **并不隐含 C-03 几何 Contact**，而是各自动作的**概率语义**。架构依赖方向应为 **Action/Interaction 是决策层，Contact 是几何/物理层**；二者当前**无依赖关系**。谁依赖谁属 Owner 决策。

#### 17. Completion Tick Ordering
现状隐含顺序 = `Physics（跳过）→ Completion → C-23`：完成 Tick **不跑 Physics**，`finalizeTransitSettlement` 直接按 `transit.outcome` 落 control/state（探针 P3：传 players 也 `lastTouch=null`、`transit=undefined`）。
候选 A（Physics/Contact 在 C-23 前）/ B（C-23 后）/ C（同一 Resolution）。
若球恰在 `transit.to` 与球员接触，A 与现状会产生**不同**的 Position / Velocity / Transit / Possession / Last Touch。
→ 无法由现有 Frozen Contract 唯一推导 → **BLOCK E**，`OWNER_DECISION_REQUIRED`。

#### 18. Discrete / Swept Contact Status
`stepBallPhysics` 内部：球运动时用 `sweptBallContact(from, to, ...)`，静止球退化为 `computeBallContact`（[ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L156-L167)）。
即：**球路径 swept（子步内防 tunneling）；球员位置离散（Tick 内不更新）**。
→ 当前 **不是**跨 Tick 的 Player 连续扫掠。**禁止**本 Gate 自行升级为 Swept Player Collision；是否升级属 Owner 决策。

#### 19. Goal Boundary Verification
`ball-physics.js` / `ball-contact.js` **不引用** Goal / Score / Goal Geometry；`BALL_STATE.GOAL` 由 `finalizeTransitSettlement`（`SHOT_OUTCOMES.GOAL`）设置，Goal Detection 属独立轨迹系统。→ **Contact 不修改 Goal / Score / Goal Truth**；本 Gate **不连接** Contact → Goal。确认无越界。

#### 20. Owner Decision Matrix

| 决策项 | 推荐方案 | 原因 | 是否需要 Owner 确认 |
|---|---|---|---|
| Player Position Tick | **A：进入 C-08 Match Tick（每 Tick）** | Ball Position 是 Tick 级 Truth；否则跨时间比较 | **是** |
| Player dt | **simulation seconds（1 Tick=1s）** | 对齐 MatchClock / Ball Physics；既有 `playerMotionList` 已做 min→sec | **是** |
| Contact Integration Point | **A：CONTINUOUS_TRANSIT 内（复用 `options.players`）** | 集成点已存在；Option D 需改 C-08（禁止） | **是** |
| Contact Detection / Resolution | **分离（Detection=只读几何；Resolution=后续）** | 提升可解释性；不重构 C-03 | **是** |
| Transit 可否中断 | **暂定 A：不可中断（仅记录/等待）** | 现状 Frozen Contract 强制保留 transit；B 需改 C-39 | **是** |
| Transit 清除权 | **A + C（Transit 自完成 / Interaction 取消）；Contact 无清除权** | 避免三系统同时清除 | **是** |
| Ball Position Writer | **A：Contact 不引入新 Writer（仅复用 C-03）** | 防第 4 条 Position Path | **是** |
| Ball Velocity Writer | **单路径：Transit 路径=C-03；Interaction 路径=C-05；Contact=C-03** | 消除同 Tick 覆盖歧义 | **是** |
| Possession Writer | **唯一 = `applyInteractionStateUpdate`** | single authoritative mutation path | **是** |
| Last Touch Writer | **D：统一进 State Mutation Boundary** | 消除 C-03/C-05 双写 | **是** |
| Contact / Interaction Model | **A：Contact = Detection → Interaction Resolution** | 消除写集冲突（Model D 无法证明安全） | **是** |
| Completion Tick 顺序 | **A：Physics/Contact 先于 C-23**（否则最后一步永不接触） | 需 Owner 决定是否改 C-39 | **是** |
| Swept Contact | **保持现状（子步 swept + 球员离散）** | 不自行升级 Swept Player Collision | **是** |

> **全部 13 项均为 `OWNER_DECISION_REQUIRED`**；TRAE 不将任何 Recommendation 视为 Owner 最终决策。

#### 21. Required Future Implementation Gate
`Player-Ball Contact Boundary Freeze Gate`（由 Owner 决策上述 13 项）→ 再开 `Player-Ball Contact Production Integration Gate`（仅接线，不改规则）。
**不得**在 C-41 内自行冻结任何决策项。

#### 22. Files Modified
- `docs/SIMULATION_SPEC.md`（仅新增本节 §48）。
- 无任何 `src/**`、`tests/**`、Frozen Contract 改动（Production Code Changes = 0 / Test Changes = 0 / Frozen Contract Changes = 0）。

#### 23. Tests / Probes
- 只读探针：`/tmp/c41-probe.mjs`（未进入仓库）。P1 传入 players → 接触发生且 `transitKept=true`；P2 不传 players → 无接触；P3 完成 Tick 传 players 仍无接触；P4 `contacting[]` 跨 Tick 且 players 缺失时被清除；P5 `playerMotionList` 完成 min→sec；P6 TACKLE 用自身概率几何、不读 `CONTACT_RADIUS`；P7 clock=seconds。
- 未新增仓库测试（本 Gate 无可冻结的新 Contract）。

#### 24. Full Regression
`node tests/run.js` → **1495 通过 / 0 失败（共 1495 用例）**（本次仅改文档，无代码路径变更）。

#### 25. Technical Debt
- **Player Position 未接入 C-08 Tick + dt 口径 minute↔second 双轨**。
- **Contact 与 Interaction 写集重叠**（`velocity` / `lastTouchPlayerId`）**无仲裁**。
- **Transit 三潜在清除者无统一归属**。
- **Completion Tick 跳过 Physics** → `transit.to` 处永不接触。
- **Contact 缺业务语义层**（只有几何，无抢断/盘带等定义）。

#### 26. Final PASS / BLOCKED
**BLOCKED / SEALED**。命中 **BLOCK A（Player Position 时间单位无法与 Tick 建立唯一关系：minute↔second 双轨）、BLOCK B（Contact Integration Point 未由 Frozen Contract 唯一冻结）、BLOCK C（Transit 中断权无现有规则）、BLOCK D（Velocity / Last Touch 存在多个未仲裁 Writer）、BLOCK E（Completion Tick 顺序无法唯一确定）**。
未命中 BLOCK F（无需改 Frozen Contract 即可完成调查）/ G（无需实现 Contact）/ H（无需改 C-03 即可调查）。
Owner Decision Matrix（13 项）已就绪，全部标记 `OWNER_DECISION_REQUIRED`。

- **红线遵守**：未改 C-03 / C-08 / C-23 / C-29 / C-32 / C-33 / C-27 / Player Movement / Interaction · PASS · SHOT / Ball · Player · Possession Schema / Goal 系统；无 `Date.now` / `Math.random`。

**STOP — 等待 Owner 验收。不得自行进入 C-42。**

## §49 Player Position Tick Truth / Simulation-Time Authority Decision Foundation（Step 39F-M-C-42）

**状态**：**BLOCKED / SEALED**（Owner Decision Foundation Gate；调查完成，结论为 BLOCKED，Owner Decision Matrix 已就绪）。未修改任何生产代码 / 测试 / Frozen Contract（仅本节文档 + 只读探针）。

> 结论先行：**Player Position Truth 是唯一且确定的（`players[].positionOnPitch`，唯一 writer = `updateMovement`）**；
> **但它在 Tick 引擎中没有任何生产 writer 在跑**（`updateMovement` 无生产调用点），且其 **dt 口径为 minute**，与 Tick 的 **second** 不一致。
> `playerMotionList` 只是 **minute→second 的速度适配器**，**不等于** Player Movement 已具备 Tick semantics。
> Player Movement 与 Ball Movement 的 **Tick 先后顺序无法由现有 Frozen Contract 唯一确定** → **BLOCK H**，全部决策项 `OWNER_DECISION_REQUIRED`。

---

### 39F-M-C-42 Gate Report

#### 1. C-41 Context Verification
C-41 结论 **BLOCKED**（Gate 完成），Owner Decision Matrix（13 项）已就绪并指向本 Gate。C-40 / C-41 已确认：Ball Position = Tick-level truth；Player Position = `positionOnPitch`，未接入 C-08 Tick；C-03 已提供 `playerMotionList` 换算（见 §47 / §48）。
**补充事实（wiring）**：C-08 tick 引擎（`runMatchTick` / `runMatchTicks` / `runMatchClockDriver` / `runMatchPhaseDriver`）目前**无赛季级生产调用点**；赛季入口 `simulateMatch`（[match.js](file:///workspace/FE-project/src/core/match.js#L256)）仍为**时段制 MVP**，未使用 tick 引擎。二者尚未统一——本 Gate 在 C-08 tick 语义范围内作答，并如实记录该 wiring gap。

#### 2. Player Position Writer Map

| Writer | 文件 | 调用方 | 时间单位 | 是否生产调用 | 是否修改正式 Position |
|---|---|---|---|---|---|
| `updateMovement`（`stepLocomotion` 结果回写 `players[].positionOnPitch`） | [movement-update.js](file:///workspace/FE-project/src/core/match/movement-update.js#L138-L139) | 无（`src/**` 无调用点；仅 tests/harness） | **simulation minute** | **否** | 是（唯一正式 writer） |
| 静态播种（lineup / test fixture 构造 `players[].positionOnPitch`） | 测试与外部构造 | — | — | — | 初始值（非运行时 writer） |
| C-03 `stepBallPhysics` 接触 | [ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L156-L214) | `stepBallPhysics` / `advanceContinuousBallMovement` | second | 是（Ball 路径） | **否**（只写 Ball position / velocity，不写 Player position） |

→ **Player Position Writer 唯一**（`updateMovement`）。无 Writer A/B/C 竞争。→ **BLOCK A 不成立**（唯一 Truth 可确定）。

#### 3. Player Position Current Truth
唯一：`players[].positionOnPitch`，格式 `{x,y}`。`movement-update.js#L138-139` 是 `src/**` 中唯一运行时写入点。
**BUT**：因无生产调用，Tick 引擎运行期间 `positionOnPitch` **保持静态**（播种值）。→ 当前**不存在 Tick-level Player Position Truth**。

#### 4. updateMovement Time Model
- `dt` 参数 = **simulation minutes**（[movement-update.js](file:///workspace/FE-project/src/core/match/movement-update.js#L67-L74)）；`stepDt = dt>0 ? dt : 0`。
- `stepLocomotion`：`step = speed * dt`，`speed` 单位 = **归一化球场单位 / simulation minute**（[locomotion.js](file:///workspace/FE-project/src/core/match/locomotion.js#L58-L62)）。
- 累计状态：`movement.players[id].elapsed` **累加 `stepDt`（minute）**；但 `movement.lastUpdateTime` / `evalTime` 来自 `clock.simulationTime`（**second**）→ **同一 transient 状态内混用 minute 与 second（技术债）**。
- 重评条件：`targetInvalid || possessionChanged || tacticChanged || phase 变化 || ballMoved > 0.02 || elapsed >= COMMIT_MAX_MINUTES(8)`（[movement-update.js](file:///workspace/FE-project/src/core/match/movement-update.js#L118-L135)）。
- `dt=0`：`stepLocomotion` 返回原位（探针 P6：**无 Position Mutation**），但 movement 状态仍被初始化（首次调用会重评 target）。
- **确定性**：无 `Math.random` / 无墙钟（探针 P5：重复输入结果一致，`clock.simulationTime` 不变）。
- **可分解性**：`speed` 每次调用按**当前**位置（含 ball 邻近度）重算 → 路径依赖；探针 P2/P3/P8 在测试场景下结果一致（多因到达 `ARRIVE_RADIUS` 被 clamp），**但没有 dt-可分解性保证**（elapsed 重评阈值随 dt 粒度漂移）。→ 记入技术债。

#### 5. playerMotionList Time Model
`playerMotionList(matchCore)`（[ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L256-L277)）：
- 位置：取 `player.positionOnPitch`（归一化）。
- 速度：由 `matchCore.movement.players[id].speed / 60` 派生（**minute→second**），方向 = `normalize(target - position)`。
- 探针 P7：speed=60/min → velocity ≈ 0.949/s（方向归一化）。
- 唯一消费者：`stepMatchBall`（Headless Harness），**未接生产 Tick**。
→ 定位 = **C. Player Movement Adapter**（供 Ball Physics 消费的输入），**非 Player Movement Truth**。

#### 6. Minute→Second Adapter Analysis
适配**只转换速度**（`/60`），**不转换** `updateMovement` 的 dt 语义，也**不**为 Player Movement 提供 tick 级积分。
→ 「存在换算」**不等于**「Player dt = second」。是否将 Player Movement 改为 second-dt 积分，属 Owner 决策（§7）。→ BLOCK D 相关，`OWNER_DECISION_REQUIRED`。

#### 7. Player dt Analysis
现状 dt = **minute**；Tick dt = **second**；换算比 1:60 明确且唯一（探针 P1）。
→ **关系可建立（60:1）**，但**采用哪种 base unit 不唯一**：Option A（Player 改 second）、Option B（保留 minute 做换算）、Option C（独立 Movement Time）——**均与现状部分自洽** → `OWNER_DECISION_REQUIRED`。

#### 8. Match Tick dt Analysis
`MATCH_CLOCK_CONFIG.TICK_DURATION_SECONDS = 1`（second）；C-08 `CONTINUOUS_TRANSIT` 默认 `deltaTime = TICK_DURATION_SECONDS`（[match-tick.js](file:///workspace/FE-project/src/core/match/match-tick.js#L132-L146)）。
**不得假设 Tick 恒为 1s**：`tickInput.deltaTime` 可传入任意有限正数；但 Player Movement 是否支持任意 dt（0.5/1/2s）**未由 Frozen Contract 定义**（探针 P4 仅表明测试场景可跑通，非语义保证）→ 记入限制。

#### 9. Simulation Time Authority
唯一 Simulation Time = `matchCore.clock.simulationTime`（second），由 match-clock 推进。`updateMovement` **读取**它（`clockTime`）但不推进。
**无墙钟**：`src/core/match/**` 无任何 `Date.now` / `performance.now` / `new Date` 实际调用（grep 仅命中注释）；`updateMovement` 纯函数、确定性。→ **BLOCK C 不成立**；若未来 tick 化，时间只能来自 Match Tick。

#### 10. Player Position / Snapshot Relationship
C-08 `SNAPSHOT` **只保存 Ball facts**：`{ tickIndex, ballState, control, possessingTeamId, inTransit }`（[match-tick.js](file:///workspace/FE-project/src/core/match/match-tick.js#L122-L129)）——**不含任何 Player Position**。
→ 未来若 Contact 在 Tick N 读取 Player Position，必须由 Owner 定义其来源（Tick N-1 committed / Tick N movement / snapshot）→ `OWNER_DECISION_REQUIRED`。

#### 11. Player / Ball Update Ordering
候选 A（PLAYER_MOVEMENT → BALL_MOVEMENT → CONTACT）/ B（BALL → PLAYER → CONTACT）/ C（并列）/ D（Player 不推进）。
现有 Frozen Contract **只冻结 Ball 侧**（CONTINUOUS_TRANSIT），**完全未定义 Player Movement 阶段**；无任何调用图暗示先后。→ **BLOCK H**：`PLAYER_BALL_TIME_ORDER_UNDEFINED`。
（唯一硬约束：若要 Contact 读到同一 timestamp 的 Player/Ball，二者必须在同一 Tick 内推进且顺序明确——但**具体顺序不可由现状唯一推出**。）

#### 12. Player Position Integration Boundary Analysis
- Option A（复用现有 `updateMovement` writer）：**最小改动**，但 dt=minute 与 tick=second 冲突。
- Option B（新增 `player-position-tick-integration.js`）：引入**第二套 Player Position 写入路径**风险（违反「禁止第二套 Truth」，除非它是唯一 writer 且替换 A）。
- Option C（扩展 `playerMotionList` 为 Tick Boundary）：`playerMotionList` 现为**只读适配器**，扩为 writer 会改变其语义层级。
→ 三者均可行但需 Owner 取舍；**本 Gate 不创建文件**，`OWNER_DECISION_REQUIRED`。

#### 13. Coordinate System Analysis
- Player：`positionOnPitch` ∈ **[0,1]²**（`stepLocomotion` 全路径 `clamp01`；`PITCH_BOUNDS = {0,1}`；测试断言 [0,1]）。
- Ball：`matchCore.ball.position` ∈ **[0,1]²**（ball-physics clamp）。
→ **同一归一化坐标系，无需坐标转换**。→ **BLOCK E 不成立**。`CONTACT_RADIUS = 0.030` 亦为归一化单位，直接可比。

#### 14. C-03 Contact Input Compatibility
`stepBallPhysics(players)` 需要 `[{ playerId, position:{x,y}, velocity:{x,y} }]`（[ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L103)）；`ball-contact.js` 取位兼容 `player.position ?? player.positionOnPitch`（[ball-contact.js](file:///workspace/FE-project/src/core/match/ball-contact.js#L21-L23)）。
`playerMotionList` 恰好产出该形状（`positionOnPitch` + min→sec 速度）。
→ **完全兼容，无需 Player Schema 变更**。→ **BLOCK F 不成立**。

#### 15. Player Position Mutation Authority
C-03 `stepBallPhysics` 接触只改 **Ball** position / velocity，写 `lastTouchPlayerId` / `contacting[]`；**不修改 Player position**（[ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L156-L214)）。
→ **Player Position Writer（`updateMovement`）与 Ball Position Writer（C-03 / C-23 / C-29）完全分离**，无交叉 → 无 Conflict。C-03 **不是** Player Position Writer。

#### 16. C-39 Dependency Check
Player Position 的 tick 化（新增 PLAYER_MOVEMENT 阶段 / 传入 players）**不需要修改** C-39 的 Transit Contract（`from/to/duration/elapsed/progress/completion/state`）——只需在 C-08 侧插入 Player 阶段并（若 Owner 批准）向 `advanceContinuousBallMovement` 传 `options.players`。
→ **BLOCK G 不成立**（无 `C39_DEPENDENCY`）。本 Gate 亦**未**修改 C-39 / match-tick（§18 纪律）。

#### 17. Read-only Probe Results
`/tmp/c42-player-time-probe.mjs`（未进仓库）：
- **P1**：`TICK_DURATION_SECONDS=1`；1 minute = 60 s；speed 单位 = 归一化/min（`BASE_SPEED=0.055`）。
- **P2**：1 min（1×dt=1）vs 60×dt=1/60 → 位置一致到 ~1e-6（非 bitwise；本场景 ball 邻近度恒定，故近似相等）。
- **P3**：60 s vs 30×2 s → 一致到 ~1e-6。
- **P4**：dt=1s / 0.5s / 2s（总 60s）→ 一致到 ~1e-6（非 bitwise）。
- **P5**：确定性 = **true**；`clock.simulationTime` 未被 updateMovement 改变。
- **P6**：**dt=0 → 无 Position Mutation**（`(0.2,0.4)` 不变）。
- **P7**：`playerMotionList` 输出 `{playerId, position:{0.2,0.4}, velocity:≈(0.949,0.316)}`（60/min→/s）。
- **P8**：近球场景 1 min vs 60×1 s → 因到达 `ARRIVE_RADIUS` 被 clamp，结果一致（bitwise）。
→ 结论：`updateMovement` **确定性、无墙钟、dt=0 安全**；但**无 dt-可分解性保证**（速度路径依赖 / 重评阈值随粒度漂移）。

#### 18. Owner Decision Matrix

| 决策项 | 调查结果 | 推荐方案 | 是否可由 Frozen Contract 唯一确定 |
|---|---|---|---|
| Player Position Truth | `players[].positionOnPitch`，唯一 writer=`updateMovement` | 沿用 `positionOnPitch` 为唯一 Truth | **是**（Truth 唯一） |
| Player Position Writer | 唯一：`updateMovement` | 保持单一 writer | **是** |
| Player dt Unit | 现状 minute；Tick=second；比 1:60 | 统一为 **simulation seconds** | **否** → `OWNER_DECISION_REQUIRED` |
| Match Tick dt | `TICK_DURATION_SECONDS=1`，可传任意正数 | 保持 second；确认任意 dt 语义 | **否**（任意 dt 语义未冻结） |
| Minute→Second Adapter | `playerMotionList` 仅转速度，非 tick 积分 | 明确其仅为 C-03 输入适配器 | **否** → `OWNER_DECISION_REQUIRED` |
| Player Movement Tick Integration | 无生产阶段；`updateMovement` 无调用点 | 新增 PLAYER_MOVEMENT 阶段（Option A 写入路径） | **否** → `OWNER_DECISION_REQUIRED` |
| Player Position / Snapshot 时序 | Snapshot 仅含 Ball facts，无 Player | 由 Owner 定义 Contact 读取的 Player 来源 | **否** → `OWNER_DECISION_REQUIRED` |
| Player vs Ball Update Order | Frozen Contract 只冻结 Ball 侧 | 由 Owner 冻结先后（建议同一 Tick 内 Player 先于 Ball） | **否** → `OWNER_DECISION_REQUIRED`（BLOCK H） |
| Player Position Coordinate System | 与 Ball 同为 [0,1]²，无需转换 | 沿用归一化坐标系 | **是** |
| C-03 Contact Input Compatibility | `playerMotionList` 输出与 `stepBallPhysics` 输入兼容 | 复用，无 Schema 变更 | **是** |
| Player Position Mutation Authority | 与 Ball Position Writer 完全分离，C-03 不改 Player | 保持分离 | **是** |

> 关键 **`OWNER_DECISION_REQUIRED`** 项：Player dt Unit / Match Tick dt 语义 / Adapter 定位 / Tick Integration / Snapshot 时序 / **Player vs Ball 顺序（BLOCK H）**。

#### 19. Required Future Implementation Gate
`Player Position Tick Integration Boundary Freeze Gate`（Owner 冻结：① dt base unit（建议 seconds）；② Player Movement 在 Tick 中的阶段与顺序；③ 唯一 Player Position writer / Integration Boundary；④ Snapshot / Contact 读取来源）。
→ 之后再开 `Player-Ball Contact Production Integration Gate`。**不得**在 C-42 内自行冻结。

#### 20. Files Modified
- `docs/SIMULATION_SPEC.md`（仅新增本节 §49）。
- 无任何 `src/**`、`tests/**`、Frozen Contract 改动（Production = 0 / Test = 0 / Frozen Contract = 0）。

#### 21. Tests / Probes
- 只读探针：`/tmp/c42-player-time-probe.mjs`（未进仓库；P1–P8，见 §17）。
- 未新增仓库测试（本 Gate 无可冻结的新 Contract）。

#### 22. Full Regression
`node tests/run.js` → **1495 通过 / 0 失败（共 1495 用例）**（本次仅改文档，无代码路径变更）。

#### 23. Technical Debt
- **Player Position 无 Tick 生产 writer**；`updateMovement` 无调用点。
- **dt 口径双轨**：Player=minute，Tick/Ball=second；`movement` transient 内 `elapsed`(min) 与 `evalTime/lastUpdateTime`(sec) 混用。
- **`updateMovement` 无 dt-可分解性保证**（速度按当前位置重算；重评阈值随 dt 粒度漂移）。
- **无 Player/Ball Tick 顺序契约**（BLOCK H）。
- **C-08 tick 引擎与赛季级 `simulateMatch`（时段制）尚未统一**（wiring gap）。
- **Snapshot 不含 Player Position**，Contact 读取来源未定义。

#### 24. Final PASS / BLOCKED
**BLOCKED / SEALED**。命中 **BLOCK H（Player vs Ball Update Order 无法由 Frozen Contract 唯一确定）**；核心决策项（dt unit / Tick Integration / Snapshot 时序 / Order）标记 `OWNER_DECISION_REQUIRED`。
**最终架构状态判定 = C**：`Player Position 需要未来新的 Integration Gate`（Truth 唯一、坐标与 C-03 兼容、无 Schema 缺口，但缺 Tick 时间/顺序契约）。
未命中 BLOCK A（Truth 唯一）/ B（60:1 关系可建立）/ C（确定性成立）/ E（坐标兼容）/ F（无需改 Schema）/ G（无 C39 依赖）/ I（调查无需改 C-08）。
- **红线遵守**：Production Code Changes = 0 / Test Changes = 0 / Frozen Contract Changes = 0；未改 C-03/C-08/C-23/C-29/C-32/C-33/C-39/C-40/C-41 / Player Movement / Schema / Interaction / Contact / Transit / Goal / Possession；无 `Date.now` / `Math.random`。

**STOP — 等待 Owner 验收。不得自行进入 C-43。**

## §50 Player Position Tick Integration Boundary（Step 39F-M-C-43）

**状态**：**PASS / SEALED**（Integration Boundary Foundation Gate；架构契约已冻结，无需修改任何 Frozen Contract 即可确定边界）。生产代码 / 测试 / Frozen Contract 改动 = 0（仅本节文档 + 只读探针）。

> 结论先行：Player Position Tick Integration Boundary **可被唯一冻结**：
> **dt = simulation seconds（= `tickInput.deltaTime`，缺省回退 `TICK_DURATION_SECONDS`）；唯一 writer = Boundary 包裹既有 `updateMovement`；写入唯一 Truth `players[].positionOnPitch`；Tick 阶段 = `SNAPSHOT` 之后、`CONTINUOUS_TRANSIT` 之前（Option A）；Snapshot = Pre-Tick（仅 Ball facts，不变）；Contact 读取 = Tick N、Player Movement 之后的 Player Position 与同 Tick 的 Ball Position。**
> 未命中任何 BLOCK 条件（A–K）。**PASS 仅代表边界已冻结；本 Gate 不接入生产 Tick，后续由独立实现 Gate 落地。**

---

### 39F-M-C-43 Gate Report

#### 1. C-42 Context Verification
C-42 结论 **BLOCKED**（Gate 完成，判定 C = 需要未来 Integration Gate）。C-42 已冻结事实（不得重释）：`players[].positionOnPitch` = 唯一 Player Position Truth；唯一运行时 writer = `updateMovement`；生产 Tick 无 Player Position writer（Tick-level Truth = NOT INTEGRATED）；Player/Ball 坐标同为归一化 [0,1]²；`playerMotionList` = Adapter，非 Truth。本 Gate 在其上冻结生产边界。

#### 2. Player Position Truth
唯一：`players[].positionOnPitch` `{x,y}`（归一化 [0,1]²）。本 Gate **不新增**任何 `tickPosition` / `simulationPosition` / `runtimePosition` 等第二套 Truth。

#### 3. Player Movement Input Analysis
`updateMovement(matchCore, dt, options?)`（[movement-update.js](file:///workspace/FE-project/src/core/match/movement-update.js#L71)）所需最小输入：
- `matchCore.players[]`（`playerId / teamId / positionOnPitch / onPitch / injured / sentOff / attributes.pace / fitness`）
- `matchCore.movement`（transient；缺失由 `initMovementState` 建立）
- `matchCore.ball.position / control / possessingTeamId`（球邻近速度、carrier 判定）
- `matchCore.teams.home/away`、`matchCore.clock.simulationTime`（second；仅读取）
- `dt`（**simulation minute**；非有限 / ≤0 视为 0）
**无** `Date.now` / `performance.now` / wall clock / FPS / random（grep 确认无实际调用）。

#### 4. Player dt Unit
**冻结：Player Movement Tick dt = simulation seconds**（= Match Tick `deltaTime`）。
既有 `updateMovement` 内部为 minute 模型（`speed[归一化/min] * dt[min]`）；Boundary 的**对外时间单位 = second**，内部按 `dt_minute = deltaTime_second / 60` 适配（与 `playerMotionList` 的 min→sec 约定互为逆）。**不要求、也不在本 Gate 修改 Movement 方程或 base unit。**

#### 5. dt Source
**冻结：`playerDt = tickInput.deltaTime`**；缺失（非有限）时回退 **`MATCH_CLOCK_CONFIG.TICK_DURATION_SECONDS`**（=1）。
与既有 C-08 规则**完全一致**（[match-tick.js](file:///workspace/FE-project/src/core/match/match-tick.js#L135-L137)）。Player Movement **不得自行生成 dt**，**不得硬编码** `playerDt = 1`。

#### 6. Player Position Writer Map

| Writer | 是否保留 | 是否生产调用 | 是否唯一 | 时间单位 |
|---|---|---|---|---|
| `updateMovement` | 保留（作为 Boundary 内部实现） | 否（当前）→ 由 Boundary 调用 | 是（唯一 Position writer） | minute（内部）/ second（Boundary 对外） |
| 新 Integration Boundary | 新增（**下一实现 Gate**；本 Gate 不创建） | 将接管（唯一入口） | 是（对外唯一） | simulation second |
| C-03 Contact | 保留 | 是（Ball 路径） | 否（**不写 Player Position**） | second |
| 其他 Writer | 无 | — | — | — |

→ **Exactly One Production Player Position Writer**（Boundary）。C-03 不改 Player Position（§15）。

#### 7. Player Movement Tick Stage Analysis
**冻结：Option A** ——
```
VALIDATE → SNAPSHOT → PLAYER_MOVEMENT → CONTINUOUS_TRANSIT → ACTION
        → INTERACTION_RESOLVE → INTERACTION_INTEGRATE → SECOND_BALL(可选) → INVARIANTS
```
依据（代码结构，非足球经验）：
1. C-39 `advanceContinuousBallMovement(matchCore, dt, { players })` **已接受 `options.players` 并透传 `stepBallPhysics`**（[continuous-ball-movement-integration.js](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L110-L165)）→ 未来 Contact 的**宿主就是 CONTINUOUS_TRANSIT**；因此 Player Position 必须**先**更新，Contact 才能读到 Tick-N 的球员位置。
2. `SNAPSHOT` 为 **pre-tick、仅 Ball facts**（§8），必须保持既有语义不变 → PLAYER_MOVEMENT 只能在其**之后**。
3. PLAYER_MOVEMENT 只写 Player Position，**不触碰 Ball**（探针 P6）→ 与 C-39 语义正交，不改变 Transit。
**本 Gate 不修改 C-08**（阶段落地属下一实现 Gate）。

#### 8. Snapshot Timestamp
**冻结：Snapshot = Pre-Tick**（Tick N **开始时**的状态）。既有 Snapshot 仅含 Ball facts `{ tickIndex, ballState, control, possessingTeamId, inTransit }`（[match-tick.js](file:///workspace/FE-project/src/core/match/match-tick.js#L122-L129)），**不含 Player Position**，且**本 Gate 不改变其语义**（不向其注入 Player Position）。
- 用途冻结：Snapshot 用于 **previous-state comparison / debug / determinism 观测**；**不**是 Contact 的读取来源。
- Player Position 的「Tick 入口值」= Tick N-1 committed 的 `players[].positionOnPitch`（即 Tick N 尚未推进前的值）。

#### 9. Contact Read Timestamp
**冻结 `CONTACT_POSITION_TIMESTAMP`**：Contact（未来）在 **Tick N** 读取
- Player Position = **Tick N、PLAYER_MOVEMENT 之后**的 `players[].positionOnPitch`（Tick 内常量）；
- Ball Position = **Tick N** 的 Ball 状态（CONTINUOUS_TRANSIT 内 contact 瞬时）。
禁止出现 `Player(T-1) + Ball(T)` 的跨 Tick 混用。Contact 只**读取**该 Truth，**不得**创建 Contact Position 第二套 Truth（本 Gate 不实现 Contact）。

#### 10. Player/Ball Timestamp Alignment
**冻结：同属 Tick N**。Player = Tick-N post-movement（Tick 内静止常量，供 Physics 作为障碍位置）；Ball = Tick-N 连续 Transit 状态。二者时间戳在 **Tick 粒度对齐**。

#### 11. Movement State Authority
**冻结：`matchCore.movement` = transient / derived（movement intent / target / speed / elapsed 等），不是 Position Truth，也不是 Simulation Clock。**
`elapsed` = **derived** 重评计数器（单位 minute），**非**权威累计时间（探针 P7：`elapsed=1/60` 而 `lastUpdateTime=0`(sec)）。
→ Player Movement **不得建立第二 Simulation Clock**；**Match Clock（`matchCore.clock.simulationTime`，second）是唯一时间推进来源**。

#### 12. dt Validation
**冻结：复用既有规则，不创建第二套 validation。**
- C-08：`Number.isFinite(tickInput.deltaTime) ? deltaTime : TICK_DURATION_SECONDS`。
- C-39 内部：`dt = isNum(deltaTime) && deltaTime > 0 ? deltaTime : 0`（非有限 / ≤0 → 0 = 合法 NO-OP）。
- Boundary 采用同一 `finite && > 0 else 0`；**允许 0**（探针 P5：`dt=0` 无 Position Mutation）。

#### 13. dt Decomposition Probe
`/tmp/c43-player-position-boundary-probe.mjs`：
- **P2** `update(2s)` vs `update(1s)+update(1s)` → 差 `9.0e-7`（非 bitwise）。
- **P3** `update(60s)` vs `60×update(1s)` → 差 `1.6e-3`（显著非零）。
**原因**（已记录，非阻断）：① `computeMovementSpeed` 每次按**当前位置**（ball 邻近度）重算 → 路径依赖；② 重评阈值基于**累计 `elapsed`**（`COMMIT_MAX_MINUTES=8`），随 dt 粒度漂移。
→ 冻结为**合法的 Tick decomposition 语义 = 「给定固定 dt 序列则确定性；不保证不同 dt 序列精确等价」**。**不修改 Movement Model**（§J 未命中）。

#### 14. Replay Determinism Probe
**P1**：两个独立 Run，10 Tick 的 Player Position 序列**逐帧完全一致** = `true`。（无 wall clock / random / 环境依赖 → BLOCK C 未命中。）

#### 15. C-03 Contact Compatibility
`playerMotionList` 位取 `positionOnPitch`、速度 = `movement.speed / 60`（min→sec），输出 `{playerId, position, velocity}` —— 与 `stepBallPhysics(players)` 输入形状**完全一致**（[ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L256-L277)）。
**探针 P8**：以 `positionOnPitch` 派生列表调用 `stepBallPhysics` → `contacts=['a1']`，`lastTouch='a1'` → **CONTACT_INPUT_COMPATIBLE**。**无需 Player Schema 变更**（BLOCK G 未命中）。

#### 16. C-39 Compatibility
**探针 P6**：Boundary 执行后 `ball` **逐字节不变**、`transit` 保留 → 不改变 Ball Position / Velocity / Transit。PLAYER_MOVEMENT 与 CONTINUOUS_TRANSIT **正交** → **不修改 C-39**（BLOCK H 未命中）；不受影响 C-39 的 `from/to/duration/elapsed/progress/completion/state`。

#### 17. Owner Decision Matrix

| 决策项 | 调查结果 | 推荐方案 | Frozen Contract 是否已足够 |
|---|---|---|---|
| Player dt Unit | 现状 minute；Tick=second | **seconds** | 是（Tick 为 second；比 1:60） |
| dt Source | C-08 已有规则 | `tickInput.deltaTime` ?? `TICK_DURATION_SECONDS` | 是（既有 C-08 规则） |
| Position Writer | 唯一 `updateMovement` | 单一 Boundary 包裹 | 是 |
| Player Movement Stage | C-08 未含 Player 阶段 | **Option A**（SNAPSHOT 后 / CONTINUOUS_TRANSIT 前） | 是（由 C-39 `players` 选项 + Snapshot 语义推出） |
| Snapshot Timestamp | 仅 Ball facts，pre-tick | **Pre-Tick（不变）** | 是 |
| Contact Read Timestamp | 无 | **Tick N、Player Movement 后** | 是 |
| Player/Ball Timestamp Alignment | 无 | **均 Tick N** | 是 |
| Movement State Authority | transient derived | **derived（非 Truth/非 Clock）** | 是 |
| dt Validation | C-08 / C-39 已有 | **复用（finite && >0；0 = no-op）** | 是 |
| dt Decomposition Semantics | 非严格可分解 | **记录限制，不要求精确等价** | 是（限制已记录） |
| Replay Determinism | 可复现 | 保持 | 是 |

→ 全部 `是`；**无 `OWNER_DECISION_REQUIRED`**。→ **PASS / SEALED 成立**。

#### 18. Future Implementation Gate
`Player Position Tick Integration Implementation Gate`（唯一职责）：
- 新增 **PLAYER_MOVEMENT** 阶段（Option A）+ 唯一 **Player Position Integration Boundary**；
- Boundary 契约（冻结）：
  ```
  input : matchCore, deltaTime (simulation seconds)
  dt    : finite && >0 ? deltaTime : 0            // 复用 C-08/C-39 规则
  write : players[].positionOnPitch               // 唯一 Player Position Truth
  impl  : updateMovement(matchCore, dt / 60)      // second → minute 适配（内部）
  out   : new matchCore（immutable；含 movement transient）
  ```
**不得顺带**：Contact / Collision / Tackle / Press / Interception / Transit Interruption / Possession Arbitration / 传入 players 到 `advanceContinuousBallMovement`。

#### 19. Files Modified
- `docs/SIMULATION_SPEC.md`（仅新增本节 §50）。
- **无** `src/**` / `tests/**` / Frozen Contract 改动（Production = 0 / Test = 0 / Frozen Contract = 0）。

#### 20. Tests / Probes
- 只读探针：`/tmp/c43-player-position-boundary-probe.mjs`（未进仓库；P1–P8，见 §13/§14/§15/§16）。
- 未新增仓库测试（本 Gate 无可运行的新 Contract；实现落地在下一 Gate）。

#### 21. Full Regression
`node tests/run.js` → **1495 通过 / 0 失败（共 1495 用例）**（仅改文档，无代码路径变更）。

#### 22. Technical Debt
- **dt 口径双轨**：Boundary 对外 second，`updateMovement` 内部 minute；`movement` transient 内 `elapsed`(min) 与 `lastUpdateTime/evalTime`(sec) 混用。
- **`updateMovement` 无 dt-可分解性保证**（路径依赖速度 + 累计 elapsed 重评阈值）。
- **C-08 tick 引擎与赛季级 `simulateMatch`（时段制）尚未统一**（wiring gap，C-42 已记）。
- **Snapshot 不含 Player Position**（本 Gate 有意保持；Contact 读取来源已冻结为 Tick-N post-movement）。
- Contact / Interaction 双 writer 仲裁仍由后续 Contact Gate 处理（不在本 Gate 范围）。

#### 23. Final PASS / BLOCKED
**PASS / SEALED**。Player Position Tick Integration Boundary **已唯一冻结**：dt unit / dt source / writer / tick stage / snapshot timestamp / contact read timestamp / player-ball alignment / movement state authority / dt validation / decomposition 语义 / replay determinism **全部明确**，且**无需修改任何 Frozen Contract**。
**未命中 BLOCK A–K**（唯一 writer 可确定；dt 统一 seconds；无需第二 Clock；Snapshot/Contact timestamp 可确定；Player/Ball 可对齐；无需改 Player Schema / C-39 / Interaction；无需改 Movement Model；Tick order 可经分析确定）。
- **红线遵守**：Production Code Changes = 0 / Test Changes = 0 / Frozen Contract Changes = 0；未改 C-03 / C-05 / C-06 / C-08 / C-14 / C-15 / C-19 / C-20 / C-21 / C-22 / C-23 / C-24 / C-27 / C-29 / C-32 / C-33 / C-39 / Player·Ball·Interaction·Goal Schema；无 `Date.now` / `Math.random`。

**STOP — 等待 Owner 验收。不得自行进入 C-44。**

## §51 Player Position Tick Integration Implementation（Step 39F-M-C-44）

**状态**：**PASS / SEALED**（Player Position Tick Integration Implementation Gate）。C-43 冻结的 Player Position Integration Boundary 已正式接入 C-08 Match Tick，新增 `PLAYER_MOVEMENT` 阶段。全量回归 **1510 通过 / 0 失败**。未接入 Contact、未修改 C-39 / Interaction / Movement 方程 / Schema。

> 结论先行：C-08 顺序现为 **`VALIDATE → SNAPSHOT → PLAYER_MOVEMENT → CONTINUOUS_TRANSIT → ACTION → INTERACTION_RESOLVE → INTERACTION_INTEGRATE → SECOND_BALL(可选) → INVARIANTS`**。
> `players[].positionOnPitch` 由**唯一生产 writer（新 Boundary）**推进，与 Ball Position 处于同一 Tick；`PLAYER_MOVEMENT` **只写 Player Position，不触碰 Ball / Transit**；**未向 `advanceContinuousBallMovement` 传 `players`**（Contact 保持未接入）。

---

### 39F-M-C-44 Gate Report

#### 1. C-43 Context Verification
C-43 = PASS / SEALED，已冻结 Player Position Tick Integration Boundary：`playerDt = tickInput.deltaTime`（缺省 `TICK_DURATION_SECONDS`）；唯一 writer（Boundary → `updateMovement`）→ `players[].positionOnPitch`；顺序 `SNAPSHOT → PLAYER_MOVEMENT → CONTINUOUS_TRANSIT`；Snapshot = Pre-Tick；Contact 读取 = Tick N post-movement。本 Gate 原样落地，不重释。

#### 2. Player Movement Integration Boundary
新增 [player-position-tick-integration.js](file:///workspace/FE-project/src/core/match/player-position-tick-integration.js)：`advancePlayerPositionTick(matchCore, deltaTime)` → `{ ok, matchCore, applied, reason, deltaTime, source, ruleVersion }`。
- 唯一内部换算：`updateMovement(matchCore, dtSeconds / 60)`（second → minute，镜像 `playerMotionList` 的 min→sec 约定）。
- `dt=0` → 返回**输入 core 原样**（`applied:false`，无 movement 状态推进，严格 no-op）。
- 仅调用 `movement-update.js`；**不 import** 任何 Ball / Contact / Interaction 模块。

#### 3. Player dt Source
`deltaTime` 由 C-08 计算：`Number.isFinite(tickInput.deltaTime) ? tickInput.deltaTime : MATCH_CLOCK_CONFIG.TICK_DURATION_SECONDS`（=1）。Boundary 复用同值。**无** `Date.now` / `performance.now` / `setTimeout` / FPS（PPT-15 源码守卫）。

#### 4. dt Validation
复用既有语义：Boundary 内 `Number.isFinite(n) && n > 0 ? n : 0`（与 C-39 内部一致）；非法（负数 / NaN / undefined）→ 0 = 合法 no-op（PPT-13）。

#### 5. C-08 Tick Order
冻结顺序（[match-tick.js](file:///workspace/FE-project/src/core/match/match-tick.js#L131-L166)）：
`VALIDATE → SNAPSHOT → PLAYER_MOVEMENT → CONTINUOUS_TRANSIT → ACTION → INTERACTION_RESOLVE → INTERACTION_INTEGRATE → SECOND_BALL(可选) → INVARIANTS`。
`deltaTime` 计算上移到 `PLAYER_MOVEMENT` 之前；`CONTINUOUS_TRANSIT` 现以 `current`（= PLAYER_MOVEMENT 输出）为输入（Ball 未变 → 语义等价）；**C-39 调用签名不变、不传 players**。

#### 6. Player Position Writer Audit
全仓 `src/**`：`positionOnPitch` 赋值仍**唯一**位于 [movement-update.js](file:///workspace/FE-project/src/core/match/movement-update.js#L139)（Boundary 委托）。Boundary 自身**不**出现 `positionOnPitch:` 赋值（PPT-11）。→ **Exactly One Production Player Position Writer**；无冲突。

#### 7. updateMovement Integration
仅经 Boundary 复用；未改 [movement-update.js](file:///workspace/FE-project/src/core/match/movement-update.js)（速度/加速度/重评阈值/路径/边界/状态全未改）。

#### 8. playerMotionList Usage
**未修改**；`playerMotionList` 仍为 min→sec 速度适配器（供 C-03 输入），本 Gate 不接 Contact，故 A 侧不使用它。C-43 的「second→minute」由 Boundary 的 `/60` 承担。

#### 9. Multi-Player Deterministic Order
`updateMovement` 按 `matchCore.players` **数组顺序**迭代（稳定、可复现，无对象遍历偶然性 / wall clock / random）；单球员 target 由 shape/context 决定，**无 player-to-player 依赖**（PPT-14 断言 order-stable + 可复现）。

#### 10. Player Runtime Fields Written（PLAYER_MOVEMENT_WRITES）
- `players[].positionOnPitch`（唯一 Position Truth）。
- `matchCore.movement`（**transient / derived**；含 intent/target/speed/elapsed/evalTime/level 等）。
- **不写** fitness / stamina / form / morale / attributes / ball / score / goal。

#### 11. Ball State Isolation
PPT-06：`PLAYER_MOVEMENT` 前后 `ball.position / velocity / state / transit` **完全一致**；Boundary 单独调用亦不改 Ball。

#### 12. Transit Isolation
PPT-07：`ball.transit`（from/to/duration/elapsed/progress）逐字节保持，**不提前完成**。

#### 13. Snapshot Isolation
PPT-08：Snapshot 仍在 `PLAYER_MOVEMENT` 之前，字段仍为 `{ tickIndex, ballState, control, possessingTeamId, inTransit }`，**未注入 Player Position**（C-08 Snapshot Contract 未改）。

#### 14. Contact Isolation
PPT-10：球员与球完全重合 + dt=1 → `ball.lastTouchPlayerId` 保持 `null`、`contacting` 为空、无 CONTACT/COLLISION 事件。**未传 players 给 `advanceContinuousBallMovement`**（PPT-11 源码守卫）。

#### 15. Interaction Isolation
未修改 `resolveInteraction` / `integrateInteractionResolution` / `interaction-state-update` / TACKLE·PRESS·INTERCEPTION·DRIBBLE·PASS·SHOT。C-05/C-06/C-24/C-27/C-33 保持 Frozen。

#### 16. P1–P10 Test Results
新增 [player-position-tick-integration.test.js](file:///workspace/FE-project/tests/player-position-tick-integration.test.js)（PPT-01~15，**15/15 通过**）：
- PPT-01 (P1) 阶段执行 + position 推进 + 输入不被原地改；
- PPT-02 (P2) 无 Movement 输入 → 不变；PPT-03 (P3) dt=0 → 不变且无 movement 推进；
- PPT-04/05 (P4) dt 来源（显式 / 缺省回退）；
- PPT-06 (P5) Ball 隔离；PPT-07 (P6) Transit 隔离；PPT-08 (P7) Snapshot 隔离；
- PPT-09 (P8) 确定性与 5-Tick 序列可复现；PPT-10 (P9) Contact 隔离；
- PPT-11 (P10) Writer Audit / Source Guard；PPT-12 顺序冻结；PPT-13 原因码；PPT-14 顺序稳定；PPT-15 墙钟/RNG 守卫。

#### 17. Full Regression
`node tests/run.js` → **1510 通过 / 0 失败（共 1510 个用例）**。

#### 18. Files Modified
- **新增**：`src/core/match/player-position-tick-integration.js`（Boundary）。
- **修改**：`src/core/match/match-tick.js`（接入 `PLAYER_MOVEMENT`；`deltaTime` 上移；`applied.playerMovement`；文档注释）；`src/core/match/match-tick-config.js`（`TICK_STAGES.PLAYER_MOVEMENT`、`TICK_EVENT_TYPES.PLAYER_MOVEMENT_APPLIED/SKIPPED`）。
- **新增**：`tests/player-position-tick-integration.test.js`；`tests/run.js`（注册）。
- **修改**：`tests/match-tick.test.js`（MT-16 依赖白名单新增 `player-position-tick-integration`；MT-12 收敛为 Ball/applied 幂等，因 C-44 起 PLAYER_MOVEMENT 每 Tick 合法推进球员）；`tests/interaction-instant-ball-position-integration.test.js`（C33-21 收敛为 Ball 不变，理由同上）。
- **文档**：本节 §51。

#### 19. Frozen Contract Impact
- **未修改**：C-03 / C-05 / C-06 / C-14 / C-15 / C-19 / C-20 / C-21 / C-23 / C-24 / C-27 / C-29 / C-32 / C-33 / C-39 / Player·Ball·Interaction·Goal Schema。
- **按授权修改的接线层**：C-08 Match Tick 编排（新增阶段与 event）——C-44 §25 明确允许「修改 C-08 Match Tick 接线」；C-08 的既有阶段语义（SNAPSHOT / CONTINUOUS_TRANSIT / ACTION / INTERACTION_* / SECOND_BALL / INVARIANTS）未改。
- 两处既有测试因「每 Tick 新增合法 Player 推进」而收敛断言（非契约破坏，见 §18）。

#### 20. Technical Debt
- **Movement 时间基数仍为 minute**：Boundary 以 `/60` 适配；未把 Movement 模型本身改为 second（C-43 已决定不要求）。
- **`movement` transient 内单位混用**：`elapsed`(min) vs `evalTime/lastUpdateTime`(sec)（C-42 记录，未在本 Gate 修）。
- **`updateMovement` 无 dt-可分解性保证**（路径依赖速度 + 累计 elapsed 重评阈值，C-43 记录）。
- **C-08 tick 引擎与赛季级 `simulateMatch`（时段制）尚未统一**（wiring gap，C-42 记录）。
- `PLAYER_MOVEMENT` 现为**无条件阶段**；无 players 时 Boundary 安全 no-op（`INVALID_MATCHCORE` / `NO_PLAYERS`）。

#### 21. Future Gate Recommendation
`Player-Ball Contact Production Integration Gate`（独立；职责仅为把 `players` 接入 `advanceContinuousBallMovement` 并落地 C-40/C-41 的 Contact 边界/Transit 中断/Writer 仲裁）。**本 Gate 不做**。

#### 22. Final PASS / BLOCKED
**PASS / SEALED**。满足 §28 全部条件：`PLAYER_MOVEMENT` 已进入 C-08 且顺序正确；Player Position 成功推进；`players[].positionOnPitch` 仍为唯一 Truth；Ball / Transit 未被修改；Contact 未接入；Interaction 无语义变化；**Regression = 0**。
**未命中 BLOCK A–K**（无 Writer 冲突 / 无 dt 语义破坏 / 无顺序破坏 / 无 Ball·Transit 变异 / 无 Contact·Interaction scope creep / 无需 C-39·Schema·Snapshot 变更 / 无回归失败）。
- **纪律遵守**：只接线不扩权；未向 Continuous Transit 传 `players`；无 `Date.now` / `performance.now` / `Math.random` / 新 Player Physics / 第二套 Truth。

**STOP — 等待 Owner 验收。不得自行进入 C-45。**

## §52 Player-Ball Contact Production Integration Decision（Step 39F-M-C-45）

**状态**：**PASS / SEALED（调查完整）**；**架构结论 = BLOCKED**（Contact 尚不满足进入生产 Tick 的 Truth / 时机 / 写入权前置条件）。本 Gate **只调查、不实现**；生产代码与正式测试**未改动**；全量回归 **1510 通过 / 0 失败**。

> 唯一原则：**先决定 Contact 的 Truth、时机与写入权，再允许 Contact 进入生产 Tick。**
> 事实（Read-Only Probe）：现有 C-03 已有 Contact 机制（几何 + 去穿透 + 速度反射 + `contacting[]` + `lastTouchPlayerId`），但**生产 Match Tick 未把 `players` 传入 `advanceContinuousBallMovement`**（C-44 明确禁止），故**生产 Tick 当前不产生任何 Contact**。

**Probe**：`/tmp/c45-contact-probe.mjs`（read-only；import / construct / run / print，未写 `src/**`、`tests/**`）。

---

### 39F-M-C-45 Gate Report

#### 1. C-40/C-41 Context Verification
C-40（§47）= PASS / SEALED，结论 **BLOCKED**：Contact 仅存在于 C-03 Physics 单元内，生产 Tick 无 Contact；Contact↔Interaction 无连接（Model 4）；Contact 无 Transit 语义。C-41（§48）= PASS / SEALED，结论 **BLOCKED**：发现 C-39 本已接受 `options.players`（仅生产 Tick 未传），且 `advanceContinuousBallMovement` 非完成 Tick **强制保留 `IN_TRANSIT` + `transit`**（即现契约**禁止** Contact 中断 Transit）。本 Gate 在 C-44 之后**用当前代码**重新验证。

#### 2. C-43/C-44 Context Verification
C-43 = PASS / SEALED：Player Position Tick Integration Boundary 冻结。C-44 = PASS / SEALED：`PLAYER_MOVEMENT` 已进入 C-08，`players[].positionOnPitch` 为唯一 Player Position Truth（Tick N、PLAYER_MOVEMENT 之后更新）。本 Gate 仅调查 `PLAYER_MOVEMENT` / `CONTINUOUS_TRANSIT` 与 Contact 的关系，**未修改 Tick 顺序**。

#### 3. Existing Contact Mechanism Audit
`stepBallPhysics(ball, dt, options)`（[ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L106-L249)）当前同时承担：
- **Position Integration**（#L217 `pos = to`；#L240 clamp）
- **Velocity Integration**（#L146 friction；#L241 clamp；#L245 stop threshold）
- **Boundary Handling**（#L218 `resolveBallBoundary`）
- **Contact Detection**（#L158-L167：moving → `sweptBallContact`，静止 → `computeBallContact`）
- **Contact Resolution**（#L175-L193：去穿透 `pos = player ± normal*radius` + 法向相对速度反射 + 切向保留）
- **Contact Metadata**（#L181-L182 `contacting.add` / `lastTouch`；#L242 输出 `contacting`；#L243 `lastTouchPlayerId`）

几何层 [ball-contact.js](file:///workspace/FE-project/src/core/match/ball-contact.js)：`computeBallContact`（离散）、`sweptBallContact`（线段防 tunneling）。常量 [ball-physics-config.js](file:///workspace/FE-project/src/core/match/ball-physics-config.js#L66-L84)：`CONTACT_RADIUS=0.030`、`CONTACT_RESTITUTION=0.55`、`CONTACT_TANGENT_RETENTION=0.85`、`CONTACT_HYSTERESIS=1.15`、`MAX_SUBSTEPS=8`。
→ **现有机制 ≠ 已冻结 Production Contact Contract**。

#### 4. Contact Stage Candidates
- **Option A**（PLAYER_MOVEMENT → CONTACT → CONTINUOUS_TRANSIT）：无支撑——Contact 需要一个「已积分的球位置 / 运动线段」，A 阶段尚无。若强行插入需复制 Physics → 不可行。
- **Option B**（PLAYER_MOVEMENT → CONTINUOUS_TRANSIT {└─ Contact}）：**唯一被现有代码支撑**的路径——Contact 内嵌于 C-39 **非完成 Tick** 的 C-03 Physics（探针 P2/P4/P5）。但需 C-08 向 `advanceContinuousBallMovement` 传 `players`（C-44 明确禁止 → 需 Owner 新授权）。
- **Option C**（CONTINUOUS_TRANSIT → CONTACT → ACTION）：无支撑——Transit 已结算，独立 Contact 阶段需二次物理/接触 pass，且完成 Tick 位置已 = `transit.to`。
→ **CONTACT_STAGE_UNDEFINED（BLOCK）**。

#### 5. Player Position Timestamp
探针 **P1**：`advancePlayerPositionTick(core,1)` 推进 `positionOnPitch`（0.2,0.2 → ≈0.2006,0.2009）；`playerMotionList(core)` 的 `position` **===** `positionOnPitch`；stale（Tick N-1）与最新位置不同。→ **Contact 若经 `playerMotionList` 接入，读取的是 Tick N、PLAYER_MOVEMENT 之后的 Player Position Truth。** 但该接线**不存在** → 属「可从 C-44 + C-03 签名推得、但非已冻结生产契约」→ 需 Owner 确认。

#### 6. Ball Position Timestamp
Contact 检测发生在**物理子步内**：以子步 `from`（当前球位）为起点构造线段 → swept/离散检测 → 命中则以去穿透位置**取代**该子步的自由积分 `to`。即 **Contact Read Position = During Physics Substep（before that substep's integration）**；Contact Position Write 发生在子步内、**先于**后续子步/边界结算。**非冻结契约**。

#### 7. Non-Completion Contact Timing
探针 **P2/P4/P5**（`transit {0.2→0.8, duration 10, elapsed 0}`，`dt=1`，`FRICTION=0`，球员 @0.28）：非完成 Tick → `completed=false, progress=0.1`；**contact 命中**；`ball.position` 0.2 → **0.25**（= 0.28 − `CONTACT_RADIUS` 去穿透，而非自由积分终点 0.26）；`velocity` → **(−0.033,0)**（法向反射）。

#### 8. Completion Tick Contact Timing
探针 **P3**（`transit {0.2→0.8, duration 1, elapsed 0.5}`，`dt=1`，球员 @中点 0.5）：完成 Tick → `completed=true`；**跳过 Physics → 无 Contact**（`lastTouch=null`）；`position = transit.to (0.8,0.5)`；`transit` 清除；`state=FREE`。
→ 现状：**Contact 永远不被写入 Transit 的最后一 Tick**（C-39 完成 Tick 不跑 Physics）。是否应改写 → **COMPLETION_CONTACT_ORDER_UNDEFINED（BLOCK）**。

#### 9. Contact Position Writer
探针 **P4**：Contact **会写 `ball.position`**（去穿透）。与 C-23 Completion Writer（[ball-movement-integration.js#L79](file:///workspace/FE-project/src/core/match/ball-movement-integration.js#L79)）、C-29 Instant Writer（[instant-ball-position-integration.js#L80](file:///workspace/FE-project/src/core/match/instant-ball-position-integration.js#L80)）**分属不同 Tick 分支**（C-39 非完成 vs 完成互斥；Interaction 在 ACTION 之后）——**未观察到同 Tick 双写**，但**无仲裁规则** → **CONTACT_POSITION_WRITER_CONFLICT（BLOCK）**。

#### 10. Contact Velocity Writer
探针 **P5**：Contact **会写 `ball.velocity`**（反射）。Velocity Writer 至少包括：C-03（friction/contact/boundary/clamp）、C-39 播种 `velocityFromTransit`（[#L160](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L160)）、C-05 `applyInteractionStateUpdate`（置 0，[#L61](file:///workspace/FE-project/src/core/match/interaction-state-update.js#L61)）。→ 与 Interaction **无仲裁** → **CONTACT_VELOCITY_WRITER_CONFLICT（BLOCK）**。

#### 11. Transit Mutation Audit
探针 **P6**：`stepBallPhysics` **不触碰** `transit`（`stepBallPhysics_touches_transit=false`）；C-39 保留 `from/to/duration`，仅更新 `elapsed/progress`。探针 **P3**：完成 Tick 由 C-39 finalize 清除 `transit`。→ 现状 **Contact 不能中断 / 修改 Transit**（与 C-39 冻结契约一致）。

#### 12. Last Touch Writer Audit
- 语义 writer 1：C-03 `stepBallPhysics`（[#L182](file:///workspace/FE-project/src/core/match/ball-physics.js#L182)、[#L243](file:///workspace/FE-project/src/core/match/ball-physics.js#L243)）——探针 **P7** 实测 `lastTouchPlayerId` 被 Contact 写为 `p1`。
- 语义 writer 2：C-05 `applyInteractionStateUpdate`（[#L65](file:///workspace/FE-project/src/core/match/interaction-state-update.js#L65)）。
- `sanitizeBall`（#L62）仅复制保留，非语义写入。
→ **LAST_TOUCH_WRITER_UNARBITRATED（BLOCK）**。

#### 13. Possession Writer Audit
探针 **P8**：Contact 前后 `control` / `possessingTeamId` **不变**（`stepBallPhysics` 不写 possession）。Possession 生产 writer：C-05 `applyInteractionStateUpdate`（#L63-64）、C-39 `finalizeTransitSettlement`（[#L74-88](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L74-L88)）、SECOND_BALL 集成。→ Contact **不是** Possession Writer；C-05 vs C-39 由 Tick 阶段顺序（CONTINUOUS_TRANSIT 先于 ACTION/INTERACTION）**已序**，未引入新冲突。

#### 14. Contacting[] Lifecycle
探针 **P11**：Tick 1 `contacting=['p1']`；Tick 2 球员远离 → `contacting=[]`。→ `ball.contacting` 为 **transient / derived**（每 Tick 在 C-03 内重算 + hysteresis 清理），**非永久 Truth**；仅存在于 BallState 字段，不应升级为独立 Truth。

#### 15. Contact / Interaction Relation
探针 **P9**（40 个 seed，DRIBBLE）：`contacting=[]` 与 `contacting=['h_a']`、`lastTouch` null vs 'h_a' → **outcome / ball 结果逐字节一致**；源码层面 `interaction-resolution.js` 不引用 `contacting` / `lastTouchPlayerId`（仅读 `ball.position` / `ball.transit`）。→ **CONTACT_INTERACTION_ARBITRATION_UNDEFINED（BLOCK）**：二者无正式数据依赖、不予仲裁（同一个 Tick 若同时发生，谁写 Position/Velocity/LastTouch 无规则）。

#### 16. Swept Contact Probe
探针 **P10**：`from=(0,0.5)`、`to=(1,0.5)`、球员 @(0.5,0.5)、`CONTACT_RADIUS=0.03` → 离散起点/终点**均不接触**，但 `sweptBallContact.isContact=true`（t=0.5），且 `stepBallPhysics` **检测到**接触（8 子步，无 tunneling）。→ C-03 **已内置子步 swept 防穿越**，未观察到明显的离散中间穿越漏检。但**跨 Tick / Player-swept**（球员自身移动造成的穿越）未覆盖 → **SWEPT_CONTACT_REQUIREMENT_UNDEFINED（BLOCK）**。

#### 17. P1–P12 Probe Results
| Probe | 结论 |
|---|---|
| P1 | Contact 输入位置 = Tick N post-PLAYER_MOVEMENT 的 `positionOnPitch`（经 `playerMotionList`） |
| P2 | 非完成 Tick Contact 发生（内嵌 C-03 Physics） |
| P3 | 完成 Tick 跳过 Physics → **无 Contact**，`position=transit.to`，`transit` 清除 |
| P4 | Contact **写** Ball Position（去穿透 0.25） |
| P5 | Contact **写** Ball Velocity（反射 −0.033） |
| P6 | `stepBallPhysics` 不触碰 transit；C-39 保留 from/to/duration，更新 elapsed/progress |
| P7 | Contact **写** `lastTouchPlayerId` |
| P8 | Contact **不写** possession |
| P9 | Contact 与 Interaction **无数据依赖**（40 seed 结果不变） |
| P10 | 子步 swept 生效，无 tunneling；跨 Tick/Player-swept 未覆盖 |
| P11 | `contacting[]` transient，每 Tick 重算 |
| P12 | 非完成 Tick + players 变更字段：`position/velocity/lastTouchPlayerId/contacting/transit` |

#### 18. Writer Matrix
| 字段 | 生产 Writer | Contact 参与 | 仲裁 |
|---|---|---|---|
| Ball Position | C-03（中间/去穿透）、C-23（完成）、C-29（Instant） | **是**（C-03） | **未裁决** |
| Ball Velocity | C-03（摩擦/接触/边界）、C-39（播种）、C-05（置0） | **是**（C-03） | **未裁决** |
| Ball Transit | C-39（elapsed/progress、finalize 清除）、C-05（delete）、PASS/SHOT 创建 | 否 | C-39 已冻结（不中断） |
| lastTouchPlayerId | C-03、C-05 | **是**（C-03） | **未裁决** |
| possession/control | C-05、C-39 finalize、SECOND_BALL | 否 | 阶段已序 |
| contacting[] | C-03 | **是**（C-03） | 单一 owner |

#### 19. Owner Decision Matrix
| Decision | Current Answer | Frozen? |
|---|---|---|
| Contact Tick Stage | 生产无阶段；候选 = CONTINUOUS_TRANSIT 非完成 Tick 内（Option B） | **否 → OWNER** |
| Player Position Timestamp | Tick N post-PLAYER_MOVEMENT `positionOnPitch`（经 `playerMotionList`） | 可推得，**未冻结 → OWNER** |
| Ball Position Timestamp | During Physics Substep（子步 `from`） | 机制事实，**未冻结** |
| Contact Before/After Physics | 子步内检测，去穿透取代该子步自由积分 | **否 → OWNER** |
| Completion Tick Contact | 现状**跳过**（C-39 完成 Tick 不跑 Physics） | C-39 跳过 Physics 冻结；**是否应 Contact → OWNER** |
| Contact Position Write | 是（去穿透） | **否 → OWNER** |
| Contact Velocity Write | 是（反射） | **否 → OWNER** |
| Contact Transit Interrupt | 否（不触碰 transit） | C-39 冻结为「不中断」；**是否应中断 → OWNER** |
| Contact Possession | 否 | C-03 无 possession 语义 |
| Contact Last Touch | 是 | **否（与 C-05 未仲裁）→ OWNER** |
| Contacting[] Nature | Transient / derived / 每 Tick 重算 | 事实明确 |
| Contact / Interaction Relation | 无连接（Model 4） | **否 → OWNER** |
| Swept Contact | 子步 swept 已内置；跨 Tick/Player-swept 未覆盖 | **否 → OWNER** |
| Contact Result Schema | 无正式 ContactResult | **否 → OWNER / 下一 Gate** |
| Position Writer Arbitration | C-03 vs C-23/C-29 无同 Tick 仲裁规则 | **否 → OWNER** |
| Velocity Writer Arbitration | C-03 vs C-05 未裁决 | **否 → OWNER** |
| Last Touch Writer Arbitration | C-03 vs C-05 未裁决 | **否 → OWNER** |
| Possession Writer Arbitration | C-05 vs C-39 阶段已序（Contact 不参与） | 是（无新冲突） |

#### 20. Regression Result
`node tests/run.js` → **1510 通过 / 0 失败（共 1510 个用例）**。生产代码 / 正式测试**未改动**（仅新增 `/tmp` 探针与本 §52 文档）。

#### 21. Files Modified
- **新增（仓库外，read-only）**：`/tmp/c45-contact-probe.mjs`。
- **文档**：本节 §52。
- **未修改**：`src/**`、`tests/**`（遵守 §31 / §32）。

#### 22. Frozen Contract Impact
- **未修改**任何 Frozen Contract：C-03 / C-08 / C-23 / C-29 / C-32 / C-33 / C-39 / C-44 及 Schema。
- C-44 的「禁止向 `advanceContinuousBallMovement` 传 `players`」**保持有效**；本 Gate 未接线 Contact。

#### 23. Technical Debt
- **Contact 机制与生产契约断裂**：C-03 已有 Contact，但无生产 Integration Point / 语义层 / 结果对象。
- **双 writer 未仲裁**：`position` / `velocity` / `lastTouchPlayerId`（C-03 vs C-23/C-29/C-05）。
- **Completion Tick 跳过 Physics**：Transit 最后一步永不 Contact。
- **Transit 中断权空缺**：Contact 无清除/改写 transit 权。
- **Swept 覆盖不全**：子步内有 swept；跨 Tick / Player-swept 未覆盖。
- **Player-situation 层**：`playerMotionList` 的球员速度依赖 transient `movement`（Contact 需速度才反射）。

#### 24. Recommended Next Gate
`Player-Ball Contact Boundary Freeze Gate`（Owner 决策 Gate；**非实现**）：冻结 ① Contact Tick 阶段（Option B 或其它）+ 生产 Integration Point（是否允许 C-08 传 `players`）；② Player/Ball Position Timestamp；③ Completion Tick 的 Contact 顺序；④ Contact 对 Position / Velocity / Transit / Last Touch / Possession 的写入权与与 Interaction 的仲裁；⑤ Swept / Contact Result Schema。

#### 25. Final PASS / BLOCKED
- **本 Gate（调查）**：**PASS / SEALED**（§3–§17 全部由现有代码 + Read-Only Probe 证明；未越权实现）。
- **架构结论**：**BLOCKED**。命中：`CONTACT_STAGE_UNDEFINED`、`CONTACT_TIMESTAMP_UNDEFINED`、`COMPLETION_CONTACT_ORDER_UNDEFINED`、`CONTACT_POSITION_WRITER_CONFLICT`、`CONTACT_VELOCITY_WRITER_CONFLICT`、`CONTACT_TRANSIT_INTERRUPTION_UNDEFINED`、`CONTACT_INTERACTION_ARBITRATION_UNDEFINED`、`LAST_TOUCH_WRITER_UNARBITRATED`、`SWEPT_CONTACT_REQUIREMENT_UNDEFINED`、`CONTACT_SCHEMA_UNDEFINED`。
- **纪律遵守**：只调查不实现；未接入 `players`；未实现 Contact / Transit Interruption / Possession·Last Touch Arbitration / Swept Contact；未改 C-03/C-39/C-44 方程；未新增 Schema；无 `Date.now` / `Math.random`。

**STOP — 等待 Owner 根据 Owner Decision Matrix 决定下一步。不得自行进入 C-46，不得自行实现 Contact。**

## §53 Player-Ball Contact Contract Freeze（Step 39F-M-C-46）

**Gate Result = PASS / SEALED。Architecture Conclusion = FROZEN。**
本 Gate 为**架构冻结 Gate**（非实现）。在「不得修改任何已 SEALED 契约（C-03 / C-05 / C-06 / C-08 / C-23 / C-29 / C-39 / C-44 / Schema）」的硬约束下，Contact Contract 的设计空间被唯一收窄；下表即为**唯一自洽解**。生产代码 / 测试**未改动**；Regression **1510 通过 / 0 失败**。

> **One Production Contact Boundary**：`C-08 CONTINUOUS_TRANSIT → advanceContinuousBallMovement → C-39 非完成 Tick → stepBallPhysics → C-03 Contact`。

### 一、Frozen Decisions

| # | Decision | Frozen Decision |
|---|---|---|
| 1 | **Contact Stage** | **Option B**：Contact **内嵌于 C-03 Ball Physics**，仅在 C-39 **非完成 Tick** 执行；无独立 `CONTACT` Stage；C-08 顺序不变。 |
| 2 | **Player Position Timestamp** | Tick N **post-`PLAYER_MOVEMENT`** 的 `players[].positionOnPitch`，经 `playerMotionList(matchCore)` 只读快照。 |
| 3 | **Ball Position Timestamp** | **Physics Substep `from`**（C-03 子步内；C-39 已先播种 transit velocity）。 |
| 4 | **Before/After Physics** | Detection+Resolution 均在 **Physics Substep 内（B）**；motion → swept，静止 → 离散；去穿透位置**取代**该子步自由积分。 |
| 5 | **Completion Tick Contact** | **D — 不执行 Contact**（完成 Tick 走 C-23、跳过 C-03 Physics）。 |
| 6 | **Contact Position Write** | **有**，但**仅作为 C-03 Physics 内部 Resolution**，非独立 Writer。 |
| 7 | **Contact Velocity Write** | **有**，同为 C-03 内部（法向反射 + 切向保留）。 |
| 8 | **Contact Transit Interrupt** | **A — 不影响 Transit**（不得改 / 清 / 完成 / 暂停）。 |
| 9 | **Contact Possession** | **Contact ≠ Possession**（不写 `control` / `possessingTeamId`）。 |
| 10 | **Contact Last Touch** | **有**（写 `lastTouchPlayerId`）。 |
| 11 | **contacting[] Nature** | **C — Tick-Transient Derived Data**（每 Tick 重算 + hysteresis 清理）。 |
| 12 | **Contact / Interaction Relation** | **D — 无直接依赖**；Contact 不改 Interaction 输入，Interaction 不读 Contact Result。 |
| 13 | **Swept Contact** | **子步 Ball-swept = 必需**（C-03 已实现，禁止纯离散）；**跨 Tick / Player-swept 不在本契约内**（记录为限制）。 |
| 14 | **Contact Result Schema** | **不存在**；Contact 仅以既有 BallState 字段表达，**不新增 Schema**。 |
| 15 | **Position Writer Arbitration** | 唯一 Truth = `MatchCore.ball.position`；Tick 内按 Stage 顺序：C-03（含 Contact）→ C-23（与 C-03 互斥）→ C-29。无同优先级 Writer。 |
| 16 | **Velocity Writer Arbitration** | 分层：C-03（Physics+Contact）→ C-39（缺省播种）→ C-05/C-29（Interaction，后阶段可覆盖）。 |
| 17 | **Last Touch Writer Arbitration** | 唯一 Truth = `ball.lastTouchPlayerId`；C-03（CONTINUOUS_TRANSIT）→ C-05（INTERACTION，后阶段优先）。 |
| 18 | **Possession Writer Arbitration** | Contact 不参与；C-05 / C-39 finalize / SECOND_BALL 由 Stage 顺序已序。 |
| 19 | **Unique Production Integration Point** | 见下「二」。 |

### 二、Unique Production Integration Boundary
- **唯一链**：`C-08 [runMatchTick] CONTINUOUS_TRANSIT → advanceContinuousBallMovement(matchCore, dt, { players: playerMotionList(matchCore) }) → C-39 非完成 Tick → stepBallPhysics(stepping, dt, { players }) → C-03 Contact`。
- 当前 **C-08 未传 players**（探针 P1/P2：生产 Tick `lastTouch=null`、`contacting=[]`）；未来接线属**独立实现 Gate**，本 Gate 不接线。
- **禁止重复边界**：C-39 不得二次 Contact；C-03 不得脱离 Physics 自行 Contact；Interaction 不得调用 Contact。
- **潜在重复入口（必须留作非生产）**：`stepMatchBall`（Harness-only，硬编码 `playerMotionList`，全仓 0 生产调用者）、`advancePassTransit` / `advanceShotTransit`（透传 `options`，仅测试 / Harness）。

### 三、Writer Matrix（生产）

| 字段 | Writer（Stage 顺序） | Contact 权限 | 仲裁 |
|---|---|---|---|
| `ball.position` | C-03（CONTINUOUS_TRANSIT，含去穿透）→ C-23（完成，与 C-03 互斥）→ C-29（INTERACTION） | 是（C-03 内部） | Stage 顺序，已冻结 |
| `ball.velocity` | C-03（CONTINUOUS_TRANSIT）→ C-39（缺省播种）→ C-05/C-29（INTERACTION） | 是（C-03 内部） | Stage 顺序，已冻结 |
| `ball.transit` | C-39（elapsed/progress、finalize 清除）/ C-05 / PASS·SHOT 创建 | **否** | C-39 冻结（不中断） |
| `ball.lastTouchPlayerId` | C-03（CONTINUOUS_TRANSIT）→ C-05（INTERACTION） | 是 | Stage 顺序，已冻结 |
| `ball.control` / `possessingTeamId` | C-05 / C-39 finalize / SECOND_BALL | **否** | 无新冲突 |
| `ball.contacting[]` | C-03 | 是 | 单一 owner（transient） |

### 四、Owner Decision Matrix（Frozen / Not Frozen）

| # | Decision | Current Finding | Proposed Frozen Decision | Evidence | Frozen | Risk |
|---|---|---|---|---|---|---|
| 1 | Contact Stage | 无生产 Stage；候选 B | **Option B**（内嵌 C-03 Physics，非完成 Tick） | call graph：`stepBallPhysics` 仅被 C-39 import；仅 C-39 非完成分支带 players | **Frozen** | 与 C-39 强耦合 |
| 2 | Player Pos Timestamp | post-PLAYER_MOVEMENT | **post-`PLAYER_MOVEMENT` `positionOnPitch`** | C-45 P1；C-44 冻结；`playerMotionList` 读 `positionOnPitch` | **Frozen** | 依赖 `movement` transient 速度 |
| 3 | Ball Pos Timestamp | 子步 `from` | **Physics Substep `from`** | C-03 #L158-L167 | **Frozen** | — |
| 4 | Before/After Physics | 子步内 | **B（Substep 内，去穿透取代自由积分）** | C-03 #L175-L193 | **Frozen** | — |
| 5 | Completion Tick Contact | 跳过 | **D — 不执行** | C-39 完成分支走 C-23，不跑 Physics；探针 P5 | **Frozen** | Transit 末 Tick 永不 Contact |
| 6 | Contact Pos Write | 是 | **C-03 内部 Writer** | 探针 P4/P6；C-03 #L175-L178 | **Frozen** | 与 C-29 同 Tick 时后者覆盖 |
| 7 | Contact Vel Write | 是 | **C-03 内部 Writer** | 探针 P5/P6；C-03 #L190-L193 | **Frozen** | 与 C-05 同 Tick 时后者覆盖 |
| 8 | Transit Interrupt | 否 | **A — 不影响** | 探针 P6；C-39 #L166-L176 | **Frozen** | — |
| 9 | Contact Possession | 否 | **不写 Possession** | 探针 P6；C-03 无 possession | **Frozen** | — |
| 10 | Contact Last Touch | 是 | **有写权，Stage 顺序仲裁** | C-03 #L182/#L243；C-05 #L65 | **Frozen** | Interaction 后阶段可覆盖 |
| 11 | contacting[] Nature | transient | **Tick-Transient Derived** | C-45 P11；C-03 #L234-L242 | **Frozen** | 不得升格为 Truth |
| 12 | Contact/Interaction | 无依赖 | **D — 无直接依赖** | C-45 P9（40 seed 不变）；`interaction-resolution` 不引用 contacting | **Frozen** | 未来若需联动须新 Gate |
| 13 | Swept Contact | 子步 swept | **子步必需；跨 Tick/Player-swept 不在契约** | C-45 P10；C-03 #L160-L161 | **Frozen** | 跨 Tick/球员穿越未覆盖 |
| 14 | Contact Result Schema | 无 | **不新增** | C-03 仅输出 BallState | **Frozen** | 未来或需独立 Result |
| 15 | Position Writer Arbitration | 无规则 | **Stage 顺序（C-03→C-23→C-29）** | C-08 顺序；C-39 分支互斥 | **Frozen** | — |
| 16 | Velocity Writer Arbitration | 无规则 | **Stage 顺序（C-03→C-39→C-05/C-29）** | C-08 顺序 | **Frozen** | — |
| 17 | Last Touch Arbitration | 无规则 | **Stage 顺序（C-03→C-05）** | C-08 顺序 | **Frozen** | — |
| 18 | Possession Arbitration | 已序 | **C-05/C-39/SECOND_BALL，Contact 不参与** | C-08 顺序 | **Frozen** | — |
| 19 | Unique Integration Point | C-08 未接线 | **C-08→C-39→stepBallPhysics（单一）** | 探针 P2；call graph | **Frozen** | 潜在入口 stepMatchBall / pass·shot adapters |

**结论：核心项全部 Frozen，无 `OWNER_DECISION_REQUIRED` 残留 → Architecture Conclusion = FROZEN。**

### 五、Residual Risks（不阻断）
1. **Completion Tick 永不 Contact**（C-39 冻结所致）。
2. **跨 Tick / Player-swept 未覆盖**（C-03 仅子步 Ball-swept）。
3. **无正式 ContactResult Schema**；仅 BallState 字段。
4. **同 Tick 覆盖**：C-29 / C-05 在 Interaction 阶段可覆盖 Contact 的 Position / Velocity / LastTouch（由 Stage 顺序确定，非冲突）。
5. **潜在重复 Contact 入口**：`stepMatchBall`、`advancePassTransit`、`advanceShotTransit` 必须保持非生产。

### 六、Recommended Next Gate
`Player-Ball Contact Production Wiring Implementation Gate`（实现 Gate，需 Owner 授权变更 C-44 的「不传 players」范围）：在 C-08 `CONTINUOUS_TRANSI` 向 `advanceContinuousBallMovement` 传入 `{ players: playerMotionList(matchCore) }`，并按本 §53 Frozen Contract 加回归 / Probe；**不得**修改 C-03 / C-39 / C-23 / C-29 / C-05 / C-06。

**STOP — 不得自行进入 C-47，不得自行实现 Contact，不得修改 C-03 / C-39 / C-44 / Interaction。**

## §54 Player-Ball Contact Production Integration（Step 39F-M-C-47）

**Gate Result = PASS / SEALED。** 按 C-46 §53 Frozen Contact Contract，将既有 C-03 Contact 正式接入生产 Match Tick。**唯一改动**：C-08 `CONTINUOUS_TRANSIT` 向 C-39 传入当前 Tick 的 Player Position 输入；Contact 仍内嵌于 C-03 Physics。

### 一、Production Call Chain（唯一）
```
C-08 MATCH TICK
  → SNAPSHOT
  → PLAYER_MOVEMENT            （C-44：players[].positionOnPitch）
  → CONTINUOUS_TRANSIT         （C-39）
      advanceContinuousBallMovement(current, deltaTime, { players: playerMotionList(current) })
        → 非完成 Tick：stepBallPhysics(stepping, dt, { players })   （C-03）
            → Ball Position Integration → Contact Detection(swept) → Contact Resolution
        → 完成 Tick：C-23 applyBallMovementPositionUpdate（不跑 Physics → 无 Contact）
```
- 新增 import：`playerMotionList`（来自 `ball-physics.js`），复用既有适配器（未改其数学语义）。
- **单一 Production Contact Boundary**：`advanceContinuousBallMovement(` 在 C-08 仅 1 处；`stepBallPhysics(` 在 C-39 仅 1 处（CP-13 源码守卫）。

### 二、Tick Stage Order（未改）
`VALIDATE → SNAPSHOT → PLAYER_MOVEMENT → CONTINUOUS_TRANSIT → ACTION → INTERACTION_RESOLVE → INTERACTION_INTEGRATE → [SECOND_BALL] → INVARIANTS`。**无独立 `CONTACT` Stage**（Contact 隐藏于 CONTINUOUS_TRANSIT → C-03）。

### 三、Contact Trigger Evidence（CP-02/03/04）
- 场景：transit `from 0.2 → to 0.8`，`duration=3`，`dt=1`（非完成 Tick），H 队 MF `p1@0.30`。
- 结果：`lastTouchPlayerId='p1'`、`contacting=['p1']`、Ball Position 被去穿透、Velocity 按 C-03 改写。
- **Player Position Timestamp**：Contact 使用 **post-PLAYER_MOVEMENT** 的 `positionOnPitch`；落点满足 `|ball − playerAfter| == CONTACT_RADIUS(0.03)`（CP-03）。
- **Ball Position Timestamp**：C-03 Physics Substep（`from`）。

### 四、Completion Tick（CP-05）
`duration=1, dt=1` → 完成 Tick：**不跑 Physics → 无 Contact**；`lastTouch=null`、`contacting=[]`、`position===transit.to {0.8,0.5}`、`state=CONTROLLED`、`transit=undefined`（C-23 唯一完成边界）。

### 五、写入验证
- **Position**：Contact 按既有 C-03 去穿透规则改写 Ball Position（CP-06）；仍在 C-03 Physics 内部，非独立 Writer。
- **Velocity**：Contact 按既有 C-03 法向反射改写（CP-07：逼近 +x → 反射 −x；无 Contact 对照保持 +x）。
- **Last Touch**：Contact 写 `lastTouchPlayerId`；无 Contact 不产生（CP-08）。
- **Transit**：`from / to / duration` 保持；`elapsed=1`、`progress=1/3` 正常推进；不中断 / 不强制完成（CP-10）。
- **Possession**：Contact 不写 `control` / `possessingTeamId`（CP-09）。

### 六、隔离与确定性
- **Interaction Isolation**（CP-15）：`interaction-resolution.js` 不引用 Contact 几何 / `contacting` / `lastTouch`；无 Transit 的 DRIBBLE Tick 正常 resolve + integrate。
- **Determinism**（CP-12）：相同 MatchCore + Tick Inputs → MatchCore / events / stages 完全一致。
- **contacting[]**：Tick-Transient Derived（每 Tick 重算、排序唯一、无第二 Contact Truth）（CP-11）。
- **Swept**：子步 Ball-swept 维持 C-03 既有机制（未新增跨 Tick / Player-swept）。

### 七、Tests
新增 `tests/player-ball-contact-production-integration.test.js`：**CP-01 ~ CP-15 全部通过（15/15）**。
既有测试最小期望修正（均属 §18-A：旧测试假设 Contact 永不接线）：
- `match-tick.test.js` MT-16：依赖白名单新增 `ball-physics`（C-47 授权依赖）。
- `player-position-tick-integration.test.js` PPT-11：将「C-08 不得传 players」更新为「C-08 经 `playerMotionList(current)` 传入（唯一 Contact 接线）」。

### 八、Regression
`node tests/run.js` → **1525 通过 / 0 失败（共 1525）**。

### 九、Files Modified
- `src/core/match/match-tick.js`（+1 import；C-39 调用传 `players: playerMotionList(current)`）。
- `tests/player-ball-contact-production-integration.test.js`（新增）；`tests/run.js`（注册）；`tests/match-tick.test.js` / `tests/player-position-tick-integration.test.js`（最小期望修正）。
- 本 §54。

### 十、Contract Changes
**无**。C-03 / C-05 / C-06 / C-23 / C-29 / C-39 / C-44 方程与 Schema 均未改。

### 十一、Architecture Audit
C-03 未改 · C-05 未改 · C-06 未改 · C-08 仅 +players 输入、无 CONTACT Stage · C-23 未改 · C-29 未改 · C-39 Transit Contract 未改 · C-44 Player Movement Contract 未改 · 无第二 Ball/Player Position Truth · 无第二 Contact Detector / Resolver · 无 ContactResult Schema · 无 Contact Possession 自动化 · 无 Transit Interruption · 无 wall clock / random。

### 十二、Remaining Risks
1. Completion Tick 永不 Contact（C-39 冻结所致，同 §53）。
2. 跨 Tick / Player-swept 未覆盖（契约外）。
3. Contact 与 C-29/C-05 同 Tick 时后者（后阶段）可覆盖 Position / Velocity / LastTouch（由 Stage 顺序确定）。
4. 潜在重复 Contact 入口 `stepMatchBall` / `advancePassTransit` / `advanceShotTransit` 须持续保持非生产。

**STOP — 不得自行进入 C-48，不得扩展 Contact 机制，不得修改 C-46 Frozen Contract。等待 Owner 验收。**

## §55 Player-Ball Contact / Interaction Semantic Boundary Audit（Step 39F-M-C-48）

**Gate Result = PASS / SEALED。Architecture Conclusion = CONSISTENT（无 Block Condition）。** 本 Gate **不实现新功能**；仅审计 C-47 生产 Contact 接入后，Player-Ball Contact 与 Interaction / Possession / Last Touch / Ball Control 之间是否存在隐藏语义冲突。**src/** = 0 modifications，**tests/** = 0 modifications**；唯一改动 = 本 §55。Regression **1525 通过 / 0 失败**。

### 一、Production Tick Semantic Audit（Stage → Reads → Writes → Semantic Role）

| Stage | Reads | Writes | Semantic Role |
| --- | --- | --- | --- |
| VALIDATE | `matchCore.ball` 存在性 | — | 输入校验 |
| SNAPSHOT | `deriveBallFacts`（state/control/poss/transit） | —（transient snapshot） | 只读快照 |
| PLAYER_MOVEMENT（C-44） | players / `movement` | `players[].positionOnPitch` | **唯一球员位置写入**；不触碰 Ball |
| CONTINUOUS_TRANSIT（C-39→C-03/C-23） | `ball.transit`、players（post-PLAYER_MOVEMENT） | 非完成：`ball.position`/`velocity`/`contacting`/`lastTouch`（C-03 Contact）；完成：`ball.position`（C-23）+ state/control/poss/transit（finalize） | **物理层 / 连续运动** |
| ACTION（C-04） | matchCore | —（产出 `ActionInstance`） | 决策 |
| INTERACTION_RESOLVE（C-05） | `ball.control`、`ball.transit`、`ball.position`、players、transit 几何 | —（纯 Result） | **比赛语义决策** |
| INTERACTION_INTEGRATE（C-06） | `InteractionResolutionResult` | `ball.position`（C-32→C-29；IN_TRANSIT 跳过）、state/control/poss/lastTouch/velocity、`transit` 清除 | **状态提交（唯一 mutation 层）** |
| SECOND_BALL（C-07，可选） | `ball-facts` / 球员几何 | control/poss/lastTouch/velocity（**不写 position**） | **二点球语义** |
| INVARIANTS | matchCore | — | 校验 |

**无独立 `CONTACT` Stage**：Contact 隐藏于 `CONTINUOUS_TRANSIT → C-39 非完成 → stepBallPhysics`（C-46 §53 / C-47 §54 冻结）。

### 二、Contact Output Audit
生产实测（探针 A/A2，transit `0.2→0.8`、`duration=3`、`dt=1`）：
- **产生**：`ball.position`（去穿透）、`ball.velocity`（A2：无 Contact `+0.96` → 有 Contact `−0.51675`）、`ball.lastTouchPlayerId='p1'`、`contacting=['p1']`。
- **不产生**：`state`（保持 IN_TRANSIT）、`control`、`possessingTeamId`、`transit`、`score`、`goal`。
- Contact 输出进入后续 Interaction 时：Interaction Resolution **只读 `ball.position`**（INTERCEPTION 路径），**不读** `lastTouchPlayerId` / `contacting` / `ball.velocity`（源码扫描 F + grep 确认）。

### 三、Interaction Input Audit（是否读取 Contact 输出）
| Interaction | 是否读 Contact 输出 | 独立判定证据 |
| --- | --- | --- |
| DRIBBLE | 否 | 仅读 `ball.control`（`BALL_NOT_CONTROLLED_BY_ACTOR` 取消） |
| TACKLE | 否 | 独立 `dist(actor,carrier)` + `TACKLE_RANGE` 几何 + 属性；**Contact 不自动=抢断成功** |
| PRESS | 否 | 独立距离 / 几何 + `PRESS_OUTCOMES` |
| INTERCEPTION | **读 `ball.position`（物理输入）** | 成功概率由 transit 线段 `closestPointOnSegment` + 属性决定；`ball.position` 仅用于 FAILED 分支 carry-forward，该分支 IN_TRANSIT → **Position Ownership 边界跳过 → 无 Position 权威影响**（分类：物理输入、无权威耦合） |
| PASS / SHOT | 否 | Interaction 不支持 → `INTERACTION_UNSUPPORTED`（由 C-39/PASS·SHOT 路径处理） |
| SECOND_BALL | 否 | 经 `deriveBallFacts`/`deriveBallRelation` 读 position/velocity；**不读** `contacting`/`lastTouch` |

**结论**：Physical Contact 与 Interaction Outcome 属两个层级；Contact **不**自动等于 Tackle / Interception / Press 成功。

### 四、Contact + Interaction Probe（确定性）
- **Contact + DRIBBLE**：`DRIBBLE_CANCELLED`（`BALL_NOT_CONTROLLED_BY_ACTOR`）；Contact 已发生（`lastTouch='p1'`、`contacting=['p1']`）。
- **Contact + TACKLE / PRESS**：`*_CANCELLED`（`TARGET_NOT_CARRIER`，transit 球无 carrier）。
- **Contact + INTERCEPTION**：`INTERCEPTION_SUCCESS`；Interaction 后阶段覆盖 → `control='a_d'`、`poss='A'`、`lastTouch='a_d'`、`state=CONTROLLED`、`transit` 清除。**证明 Stage 顺序仲裁**。
- **Contact + PASS / SHOT**：`INTERACTION_UNSUPPORTED`；transit 保持（无 duplicate / overwrite / clear）。
- **受控球对照（C）**：`CONTROLLED`（无 transit）→ **Contact 不可能发生**；`TACKLE_LOOSE`/`PRESS_FAILED`/`DRIBBLE_COMPLETED` 正常 resolve。证明物理层与语义层**互斥分离**。
- **Contact + SECOND_BALL（D）**：扫描确定性 seed `sb9` → `INTERCEPTION_DEFLECTED` → `second_ball_resolve`/`second_ball_integrate` → `SECOND_BALL_WON`。**同 Tick 三系统共存**。

### 五、LastTouch Arbitration
Contact（CONTINUOUS_TRANSIT）写 `lastTouchPlayerId`；Interaction（INTERACTION_INTEGRATE）为**后阶段**，`applyInteractionStateUpdate` 写 `lastTouchPlayerId`（CONTROLLED→`possession.toPlayerId`；FREE→`result.actorId`）。**Stage Order 足以定义最终值**：Interaction 合法写时覆盖 Contact（探针 B/INTERCEPTION：`p1`→`a_d`）。IN_TRANSIT 未拦截时保留 Contact 值。**未发明新 Last Touch Priority**。→ 非 `LAST_TOUCH_SEMANTICS_UNDEFINED`。

### 六、Position Arbitration
同 Tick 两名 Position Writer 顺序存在：`C-03`（CONTINUOUS_TRANSIT 非完成，写中间位置）→ `C-29`（INTERACTION_INTEGRATE，经 C-32 边界写 Interaction Target；**IN_TRANSIT 跳过**）。二者写**同一字段** `MatchCore.ball.position`，属 **Frozen Stage Order 下的合法后续覆盖**，非双 Position Truth。C-29 仍只服务 Interaction Instant Position（未改）。→ 非 `POSITION_STAGE_CONFLICT`。

### 七、Velocity Arbitration
Writer 链 = `C-03`（Physics+Contact）→ `C-39`（缺省播种）→ `C-05`（Interaction：CONTROLLED/FREE 置 `{0,0}`，后阶段覆盖）。探针 B/INTERCEPTION：Contact 后最终 `velocity={0,0}`。**Stage 顺序足以仲裁**，未新增 Velocity Priority。→ 非 `VELOCITY_STAGE_CONFLICT`。

### 八、Possession Audit
Contact **不写** `control` / `possessingTeamId`（探针 A：`writesPossession=false`）。Possession 仅由 Interaction `applyInteractionStateUpdate` / SECOND_BALL（同一 mutation 层）产生。同 Tick Contact 不偷改 possession。→ 非 `POSSESSION_CONTACT_LEAK`。

### 九、Transit Audit
Contact `writesTransit=false`（不中断、不强制完成；C-39 冻结）。Contact+PASS/SHOT：Interaction 不支持 → 无 duplicate / overwrite / clear / target mismatch；`transit` 原样保持。→ 非 `TRANSIT_CONTACT_LEAK`。

### 十、SECOND_BALL Audit
- 不读 `contacting[]`（`ball-facts` 不含该字段）。
- 读 `ball.position`/`velocity`（经 C-04 几何派生；Contact 可写 velocity = 物理输入）。
- **不覆盖 Position**（C-31 冻结 NO_POSITION_CHANGE；不经 Position Ownership 边界）。
- 可覆盖 control/poss/lastTouch（经 C-05 mutation 层）。
- 产生 Possession 由自身 Frozen Contract 决定，非 Contact 自动产生。→ 非 `SECOND_BALL_CONTACT_CONFLICT`。

### 十一、contacting[] Audit
`contacting[]` 全仓仅出现在 `src/core/match/ball-physics.js`（C-03）；**未被 Interaction / SECOND_BALL / Save 读取**。语义 = **纯 Contact Diagnostic / Tick-Transient Derived Output**。**未升格为 Truth**（不进 `ball-facts`、不持久化）。观察：Interaction / SECOND_BALL 集成后 `contacting` 可携带 Contact 时的残留值进入 CONTROLLED 球（探针 final `contacting=['p1']`），但**无任何语义层读取**，故不构成冲突。→ 非 `CONTACTING_TRUTH_PROMOTION`。

### 十二、Semantic Matrix（以真实代码为准）
| 层 | 负责 | 不负责 |
| --- | --- | --- |
| C-03 Contact | 物理接触（position/velocity/lastTouch/contacting） | Possession / Interaction Outcome |
| C-05 Interaction State | 状态提交（state/control/poss/lastTouch/velocity） | Contact Detection |
| C-06 Interaction Resolution | 比赛交互结果（DRIBBLE/TACKLE/PRESS/INTERCEPTION） | Contact Physics |
| C-39 Transit | Continuous Transit | Possession |
| SECOND_BALL | 二点球竞争语义 | Contact Detection |

### 十三、Writer Matrix（生产；无新 Truth）
| 字段 | Writer | Stage | 条件 | Contact 参与 | 最终 Authority |
| --- | --- | --- | --- | --- | --- |
| `ball.position` | C-03 / C-29 | CONTINUOUS_TRANSIT / INTERACTION_INTEGRATE | 非完成 vs Interaction Target（IN_TRANSIT 跳过） | **是**（C-03） | 后阶段 Stage Order |
| `ball.velocity` | C-03 / C-39 / C-05 | 同上 | Physics·Contact / 播种 / Interaction 置零 | **是** | 后阶段 Stage Order |
| `ball.transit` | C-39 / C-05 | CONTINUOUS_TRANSIT / INTERACTION_INTEGRATE | 推进 / finalize 清除 | 否 | C-39 冻结 |
| `ball.lastTouchPlayerId` | C-03 / C-05 | 同上 | Contact / Interaction 结果 | **是** | Interaction（后阶段） |
| `ball.control` | C-05 | INTERACTION_INTEGRATE | CONTROLLED/FREE | 否 | C-05 / SECOND_BALL |
| `ball.possessingTeamId` | C-05 | INTERACTION_INTEGRATE | CONTROLLED/FREE | 否 | C-05 / SECOND_BALL |
| `ball.contacting` | C-03 | CONTINUOUS_TRANSIT | 接触窗口 | **是** | 纯 Diagnostic（无消费者） |

### 十四、Determinism
探针 E：相同 MatchCore + Tick Input + Simulation Time 重复运行 → `matchCore` 逐值一致（`identical=true`）。无 `Math.random` / `Date.now` / 墙钟 / 非确定性排序。→ 非 `NONDETERMINISTIC_CONTACT_INTERACTION`。

### 十五、Probe / Regression
- 仓库外 read-only 探针：`/tmp/c48-contact-interaction-probe.mjs`（未被生产代码引用）。
- `node tests/run.js` → **1525 通过 / 0 失败（共 1525）**。

### 十六、Files Changed
- 仅 `docs/SIMULATION_SPEC.md`（追加本 §55）。**src/** = 0，**tests/** = 0。

### 十七、Contract Changes
**无**。C-03 / C-05 / C-06 / C-08 / C-29 / C-39 / C-44 / C-46 / Possession / Last Touch 语义均未改；未新增 Contact→Possession / Contact→Interaction 规则，未新增 Tackle / Press / Interception 概率，未新增 `ContactResult` / Ball Control Truth / Ownership Truth。

### 十八、Remaining Risks（不阻断）
1. `contacting[]` 在 Interaction / SECOND_BALL 集成后**不被清除**（可残留至 CONTROLLED 球）；当前无消费者，若未来某系统读取须先经新 Gate 定义清理时机。
2. INTERCEPTION RESOLVE 读 `ball.position` 仅用于 FAILED 分支 carry-forward（无权威影响）；若未来改为影响成功概率，须新 Gate。
3. Completion Tick 永不 Contact（C-39 冻结，同 §53/§54）。

**STOP — 不得自行进入 C-49，不得修改任何已 SEALED Contract，不得因发现语义问题自行实现新规则。等待 Owner 验收。**

## §56 Post-Contact Ball State Lifecycle / Cross-Tick Consistency Audit（Step 39F-M-C-49）

**Gate Result = PASS / SEALED。Architecture Conclusion = BLOCKED / SEALED**（唯一 Block Condition = `CONTACTING_LIFECYCLE_LEAK`，**惰性 / 无消费者**）。**src/** = 0 modifications，**tests/** = 0 modifications**；唯一改动 = 本 §56。Regression **1525 通过 / 0 失败**。全部为 read-only Probe `/tmp/c49-post-contact-lifecycle-probe.mjs`。

### 一、Ball Lifecycle Model（Truth / Derived / Transient / Metadata）
| 字段 | 分类 | 说明 |
| --- | --- | --- |
| `ball.position` | **Truth（单字段）** | Writer：C-03（中间）、C-23（完成）、C-29（Instant Interaction） |
| `ball.velocity` | **Truth（物理）** | C-03 反射；C-39 仅在 `!velocity` 时 seed |
| `ball.state` | **Truth（枚举）** | CONTROLLED / IN_TRANSIT / FREE / GOAL —— **无 CONTACT state** |
| `ball.transit` | **Derived / Truth（完成调度）** | from / to / duration / elapsed / progress |
| `ball.control` / `possessingTeamId` | **Truth（Possession）** | 仅 Interaction / SECOND_BALL（C-05 mutation 层）写 |
| `ball.lastTouchPlayerId` | **Metadata（Last Touch Truth）** | C-03 首次接触写；Interaction 后阶段可覆盖 |
| `ball.contacting` | **Transient Derived（Diagnostic）** | 仅 C-03 产生；**无消费者** |

### 二、Contact Tick State（场景 A/B，transit `0.2→0.8`、`duration=4`、`dt=1`）
| | position | velocity | state | transit | lastTouch | contacting | control/poss |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A 无 Contact | `0.24688` | `{0,0}` | IN_TRANSIT | 保留(elapsed1) | null | `[]` | null/null |
| B 有 Contact | `0.205` | `{0,0}` | IN_TRANSIT | 保留(elapsed1) | `p1` | `['p1']` | null/null |
Contact 只写 position/velocity/lastTouch/contacting；state/transit/control/poss 不变。

### 三、Next Tick State（Contact 后多 Tick）
- **V/T**：Contact 后 ball 停在 `0.2043`，velocity `{0,0}`，ticks2-4 位置冻结；transit `elapsed 1→4`、`progress .1667→.6667`、`to` 不变；state 恒 IN_TRANSIT。
- **D（方向发散）**：pos 恒 `0.2057`（ticks1-4 冻结），tick5 完成时 **snap 到 `to=0.8`**、state→CONTROLLED、transit 清除。
- Tick N 的 Contact **不会**在 Tick N+1 自动重复（除非球员仍在窗口内）。

### 四、Velocity Lifecycle
- C-39 非完成 Tick：`if (!stepping.velocity) seed`（[continuous-ball-movement-integration.js L158-161](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L158-L161)）。任意物理 Tick 后 velocity 恒为对象（truthy）→ **不再被 transit 重新 seed**。
- **V2 直接证明**：球 vel `0.6` → Contact 反射 `−0.32225` → tick2 `−0.31225` → tick3 `−0.30225`（仅摩擦衰减；`velocityFromTransit` 应为 `+0.03`，未被采用）。
- 分类：**C-03 Physics Truth**（非 Transit Seed、非 Interaction Override、非 Transient）。→ 非 `VELOCITY_LIFECYCLE_CONFLICT`。

### 五、Transit Lifecycle
Contact **不改** transit 任何字段（`from`/`to`/`duration`/`elapsed`/`progress`）；积分器每 Tick 原样保留 `from`/`to` 并推进 `elapsed`/`progress`。非完成 Tick [L166-176](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L166-L176) 强制 `state=IN_TRANSIT`。→ 非 `TRANSIT_CONTACT_LIFECYCLE_CONFLICT`。

### 六、State Lifecycle
Contact 后 velocity 可与 transit 方向相反，而 state 仍 IN_TRANSIT —— **设计允许**：C-39 冻结「`progress=clamp01(elapsed/duration)`，不由 Physics 距离反推」[L18-19](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L18-L19)。即 **Transit Completion Truth ≠ Physics Velocity Direction**。

### 七、Contact / Transit Direction Probe（重点）
Contact 反射后：C-39 继续以 `from/to/duration` **按时间**推进 completion，同时 C-03 以 Contact 后 velocity 运动。二者可长期分歧（探针 D：pos `0.2057` vs `to=0.8`，4 Tick）。**单一 Position 字段**，完成时 C-23 写 `to` 收敛。→ **Frozen 架构正式允许，非 `CONTINUOUS_MOVEMENT_DUAL_TRUTH`**。

### 八、Completion Lifecycle
完成 Tick：跳过 Physics（[L136-155](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L136-L155)），C-23 写 `position=transit.to`，`finalizeTransitSettlement` 只结算 state/control/poss 并清 transit。**观察**：finalize **不写 velocity** → Contact 残余 velocity 在完成后仍保留（探针 C：`{8.8e-6,−0.01158}` 于 CONTROLLED 球）；`contacting`/`lastTouch` 亦保留。

### 九、Contact + Interaction + Next Tick
| 组合 | Tick N 结果 | Tick N+1（无 Action） |
| --- | --- | --- |
| Contact→TACKLE / PRESS | `*_CANCELLED`；state IN_TRANSIT、transit 推进 | 正常消费 |
| Contact→INTERCEPTION | `INTERCEPTION_SUCCESS`；CONTROLLED（control a_d、poss A、lastTouch a_d、transit 清除） | 稳定保持 |
| Contact→SECOND_BALL（seed sb17） | `INTERCEPTION_DEFLECTED → SECOND_BALL_WON` | 稳定保持 |
Interaction 最终状态可被下一 Tick 正常消费。

### 十、contacting[] Lifecycle（专项）
| 场景 | Tick N | Tick N+1 | 结论 |
| --- | --- | --- | --- |
| Contact 后 physics 仍运行（IN_TRANSIT，无球员） | `['p1']` | `[]`（C-03 窗口清理） | **正确 Tick-Transient** |
| Contact→Interaction→CONTROLLED | `['p1']` | `['p1']`（N+1、N+2 均不变） | **残留 = `CONTACTING_LIFECYCLE_LEAK`** |
根因：球转 CONTROLLED / 无 transit 后 C-39 跳过 Physics（`CONTINUOUS_TRANSIT_SKIPPED`），C-03 不再运行，`contacting` 窗口清理逻辑不执行。**该字段无任何语义消费者**（C-48 确认），故为**惰性泄漏**。

### 十一、lastTouch Lifecycle
Contact `lastTouch=p1`；下一 Tick 无 Contact 仍 `p1`（**正确**：Metadata 保持，不得随 contacting 清空而清除）。Contract 定义。→ 非 `LAST_TOUCH_LIFECYCLE_UNDEFINED`。

### 十二、Possession Lifecycle
Interaction/SECOND_BALL 在 Tick N 产生 `control`/`poss`；Tick N+1 稳定保持；Contact 不清除/不夺取/不修改。→ 非 `POSSESSION_LIFECYCLE_CONFLICT`。

### 十三、State / Transit / Control Matrix
| state | transit | control/poss | Contact | 说明 |
| --- | --- | --- | --- | --- |
| IN_TRANSIT | 有 | null | 可发生 | 唯一可 Contact 状态 |
| CONTROLLED | 无 | 有 | 不可能 | Physics 早退 |
| FREE | 无 | null | 不可能 | 无 transit → 不跑 Physics |
| GOAL | 无 | null | 不可能 | 死球 |
**不存在未定义的 “Contact State”**；Contact 不产生新 Ball State。

### 十四、Physics / Transit Truth Audit
Position Truth = `MatchCore.ball.position`（单字段）。Transit Truth = 完成调度 + 最终目标（`to`）。C-03 Physics 为中间位置；Contact 仅改 position/velocity（物理量）。**非两套 Position Truth**。Velocity 与 transit 方向可长期分歧 —— C-39 冻结已明确允许（时间型 completion）。

### 十五、Determinism
Contact Tick / Contact→Next Tick / Contact→Interaction→Next Tick / Contact→Completion 重复运行 → **4/4 identical=true**。无 `Math.random` / `Date.now` / 墙钟 / 非确定性排序。

### 十六、Probe / Regression
- `/tmp/c49-post-contact-lifecycle-probe.mjs`（read-only，未被生产代码引用）。
- `node tests/run.js` → **1525 通过 / 0 失败（共 1525）**。

### 十七、Files Changed
- 仅 `docs/SIMULATION_SPEC.md`（追加本 §56）。**src/** = 0，**tests/** = 0。

### 十八、Contract Changes
**无**。C-03 / C-39 / C-44 / C-46 / C-47 / C-48 / Ball State Schema / Contact Geometry / Friction / Reflection / Transit Completion / Possession / Last Touch 均未改；未新增 Contact Lifecycle API / ContactResult / Ball·Velocity·Contact Truth。

### 十九、Remaining Risks（含 Block）
1. **`CONTACTING_LIFECYCLE_LEAK`（Block，惰性）**：球转 CONTROLLED / 离开 transit 后 `contacting[]` 不再清空，跨 Tick 残留旧接触者；当前无消费者。需 Owner 决策：(a) 接受为惰性诊断，或 (b) 未来 Gate 定义“离开物理域即清空”。
2. Contact 残余 velocity 在 Completion 后**未被清除**（CONTROLLED 球可带非零 velocity），与 Interaction 产生的 CONTROLLED（velocity `{0,0}`）语义不一致。
3. CONTINUING 接触下球被**钉在接触面**（位置每子步重设至 surface，velocity 仅衰减不驱动位移），反射 velocity 不必然转化为运动。
4. 完成 Tick 的 `position` 从物理中间位置**跳变**到 `transit.to`（时间型 completion 的既定行为）。

**STOP — 不得进入 C-50，不得修复上述问题，不得修改 C-46 / C-47 / C-48。等待 Owner 验收。**

## §57 Contact Transient Metadata Lifecycle Decision（Step 39F-M-C-50）

**Gate Result = PASS / SEALED。Architecture Conclusion = PASS / SEALED（Option B Frozen）。** src/** = 0，tests/** = 0；唯一改动 = 本 §57。Regression **1525 通过 / 0 失败**。Probe：`/tmp/c50-contacting-lifecycle-probe.mjs`（read-only，未被生产代码引用）。

### 一、Current Classification
- C-46 冻结：`contacting[]` = **D — Tick-Transient Derived**（不得升格为 Truth）。
- 实测（C-49/C-50）：**仅在 C-03 Physics 执行时重算**；离开 Physics Domain 后保留旧值 → 字面 “每 Tick 清空” 并不成立。
- 提出并冻结：**E — Physics-Window Derived Diagnostic**（见 §57 十）。

### 二、Consumer Audit（全仓 grep `contacting`，6 文件）
| 位置 | 读取/写入 | 类别 |
| --- | --- | --- |
| `src/core/match/ball-physics.js` | 唯一 **Writer** + 唯一 src Reader | **C-03 单一 owner** |
| `tests/match-ball-physics.test.js` | 断言 sanitize 去重排序 | Diagnostic/Test |
| `tests/ball-physics-fixtures.js` | fixture 初值 `[]` | Test |
| `tests/player-position-tick-integration.test.js` | 断言 `contacting.length===0` | Test |
| `tests/player-ball-contact-production-integration.test.js` | CP-04/CP-11/CP-13 行为断言 | Test |
| `docs/SIMULATION_SPEC.md` | 文档 | Doc |
- **未出现**于：Save / Match Result / `ball-facts.js` / `interaction-resolution.js` / `interaction-integration.js` / `second-ball-resolution.js` / Transit / Score / Goal。
- **生产语义消费者 = 无**（除 C-03 自身）。→ 不存在 Consumer 冲突，**不 BLOCK**。

### 三、Option A — Strict Tick-Transient（评估后**否决**）
“任何 Tick 结束后若不在 Contact/Physics Domain 则 `contacting=[]`” 需要新的 Clear 边界。按 §57 九，以下均被冻结禁止：A2（C-03 末尾，无法覆盖 CONTROLLED）／A3（C-39 完成时，新增 Interaction/Transit 写 Contact 字段，违反 C-46 单一 owner）／A4（Tick 末尾统一清理，新增 Writer，需改 C-08）／A5（状态离开 IN_TRANSIT 时清理，需新 Hook / Writer）。→ **需要新增 Writer / Stage，与 Frozen Contract 冲突 → 否决（若强行采用则为 BLOCKED）**。

### 四、Option B — Physics-Window Transient（**采纳**）
`contacting[]` 不是严格每 Tick 清空，而是**Physics-Window Derived Diagnostic**：仅在下一次 C-03 `stepBallPhysics` 执行时重算（含 `sanitizeBall` 去重排序 + L229-236 窗口清理）；离开 Physics Domain 后允许旧值保留。
- 不需要新增清理机制；完全贴合当前实现；零额外生产写入；保持 C-03 单一 owner；不新增 Writer / Stage / API。

### 五、State Transition Audit（read-only Probe）
| 转换 | Tick N | Tick N End | Tick N+1 | 说明 |
| --- | --- | --- | --- | --- |
| IN_TRANSIT → IN_TRANSIT（球员仍在窗口） | `['p1']` | `['p1']` | `['p1']` | 仍在接触窗口，正确 |
| IN_TRANSIT → IN_TRANSIT（球员移除） | `['p1']` | `['p1']` | `[]` | C-03 窗口清理（唯一自然清除） |
| IN_TRANSIT → INTERCEPTION_SUCCESS → CONTROLLED | `['p1']` | `['p1']` | `['p1']` | 离开 Physics Domain → 保留 |
| IN_TRANSIT → FREE（Contact 后完成 INACCURATE） | `['p1']` | `['p1']` | `['p1']` | 完成 Tick 跳过 Physics → 保留 |
| IN_TRANSIT → GOAL（Contact 后完成 GOAL） | `['p1']` | `['p1']` | `['p1']` | 同上 |
| IN_TRANSIT → SECOND_BALL（seed sb25） | `['p1']` | `['p1']` | `['p1']` | 同上 |
| 完成 Tick（`duration=1`，无 Contact） | `[]` | `[]` | — | 完成 Tick 不跑 Physics（CP-04） |
**权威时间点 = 最近一次 C-03 Physics 执行内的 Tick N End**；一旦离开 Physics Domain，其值为**非权威快照**。

### 六、Validity Window
自产生它的那次 C-03 `stepBallPhysics` 起，有效至**下一次 C-03 执行**（若此后不再执行 Physics，则维持不变）。窗口内反映 “radius × hysteresis 内的接触球员集合”。

### 七、Clear Boundary
**唯一清除边界内嵌于 C-03**：[ball-physics.js L229-236](file:///workspace/FE-project/src/core/match/ball-physics.js#L229-L236) 窗口清理 + `sanitizeBall` 去重排序（[L53-54](file:///workspace/FE-project/src/core/match/ball-physics.js#L53-L54)）。**无状态离开清理**。本 Gate **不新增**任何 Writer / Stage / API。

### 八、Interaction Responsibility Audit
Interaction（C-05/C-06）**不得**承担 Contact Metadata Cleanup：C-46 冻结 Contact 属 C-03 Physics，与 Interaction 无数据依赖（CP-15 源码守卫）。**本 Gate 不提出** “让 C-05/C-06 清除 contacting”。→ 无需 `OWNER_DECISION_REQUIRED`。

### 九、Stage Architecture Audit
**不新增** `CONTACT` / `CONTACT_CLEANUP` Stage（CP-13 守卫：`TICK_STAGES` 不得含 `contact`）。生命周期规则完全嵌入现有 Stage（C-03 于 CONTINUOUS_TRANSIT 内）。

### 十、Final Frozen Definition
- **Contacting Definition**：`ball.contacting[] = Physics-Window Derived Contact Diagnostic`（C-46 的 “Tick-Transient Derived” 的**操作定义澄清**：tick-scoped 于 C-03 Physics 执行，而非 “每 Tick 强制清空”）。
- **Validity Window**：见 §57 六。
- **Clear Boundary**：见 §57 七（唯一，内嵌 C-03）。
- **Consumer Rule**：**生产代码禁止**将 `contacting` 作为 Truth 读取；C-03 为唯一 owner；仅测试/诊断可读。
- **Persistence Rule**：**不得**进入 Save / Match Result / Ball Facts / Interaction Result / 长期状态（实测已满足，保持现状）。
- **Invariants**：`contacting ≠ Contact Truth / Position Truth / Possession Truth / LastTouch Truth / Interaction Result`。

### 十一、Determinism
Contact→Next Tick、Contact→Interaction→Next Tick 重复运行 → **identical=true**；无 `Math.random` / `Date.now` / 墙钟 / 非确定性排序。

### 十二、Regression / Files Changed / Contract Changes
- `node tests/run.js` → **1525 通过 / 0 失败（共 1525）**。
- Files Changed：仅 `docs/SIMULATION_SPEC.md`（追加本 §57）；**src/** = 0，**tests/** = 0。
- Contract Changes：**无 red-line 变更**。C-46/C-47/C-48/C-49 的红线（不作为 Truth、不持久化、C-03 单一 owner、无新 Stage）**全部保持不变**；本 Gate 仅**澄清** “Tick-Transient” 的操作定义。**须 Owner 追认该澄清不构成 C-46 修改**。

### 十三、Out of Scope
**Post-Contact Velocity Lifecycle**（C-49 §20 Risk #2：Contact 残余 velocity 可进入 CONTROLLED）。本 Gate **不分析、不决策、不修复**。

### 十四、Remaining Risks
1. CONTROLLED / FREE / GOAL 球可携带上一次 Physics 的 `contacting` 快照 —— 由 Option B 定义**正式允许**；因无生产消费者，不影响语义权威。
2. 若未来有系统读取 `contacting`，须先经新 Gate 定义读取语义（当前禁止）。
3. “Tick-Transient” 术语仍可能与 “每 Tick 清空” 字面混淆 —— 以本 §57 十的 Physics-Window 定义为准。

**STOP — 不得进入 C-51，不得实现任何清理方案，不得处理 Velocity，不得修改 C-46/C-47/C-48/C-49。等待 Owner 验收。**

## §58 Post-Contact Velocity Lifecycle / Controlled-State Semantics Decision Foundation（Step 39F-M-C-51）

**Gate Result = BLOCKED / SEALED。Architecture Conclusion = BLOCKED / SEALED（`CONTROLLED_VELOCITY_SEMANTICS_UNDEFINED` → OWNER_DECISION_REQUIRED）。** **src/** = 0，**tests/** = 0；唯一改动 = 本 §58。Regression **1525 通过 / 0 失败**。全部为 read-only Probe `/tmp/c51-velocity-lifecycle-probe.mjs`（未被生产代码引用）。

> 承接 C-49 §20 Risk #2 / C-50 §十三 Out of Scope。本 Gate **只调查** Contact 后 `ball.velocity` 的生命周期；**不修复、不清零、不新增 Writer / API / Stage**。

### 一、Gate 目标与专属问题
确定：Player-Ball Contact 产生的 `ball.velocity`，在 Transit 完成进入 CONTROLLED 后**是否应继续保留**；即 `CONTROLLED + 非零 velocity` 是**正式语义**还是 **`POST_CONTACT_CONTROLLED_VELOCITY_CONFLICT`**。

### 二、Velocity Writer Matrix（生产 Writer 全仓审计）
| # | Writer | 文件 / Stage | 条件 | 是否 Truth | 可被后续覆盖 |
| --- | --- | --- | --- | --- | --- |
| W1 | `sanitizeBall` 归一化 | [ball-physics.js L56-58](file:///workspace/FE-project/src/core/match/ball-physics.js#L56-L58) / C-03 | 任意 `stepBallPhysics` 入口 | 结构归一（非语义） | — |
| W2 | **C-03 Physics 积分**（摩擦 / 位移 / 边界 / 反射） | [ball-physics.js L142-245](file:///workspace/FE-project/src/core/match/ball-physics.js#L142-L245) / CONTINUOUS_TRANSIT（非完成 Tick） | state ∉ {CONTROLLED,GOAL} | **Physics Truth** | 是（Interaction 阶段后写） |
| W3 | **C-03 Contact Reflection** | [ball-physics.js L183-193](file:///workspace/FE-project/src/core/match/ball-physics.js#L183-L193) / 同上 | `vRelN < 0`（首次接触） | **Physics Truth** | 是 |
| W4 | **C-03 CONTROLLED/GOAL 早退置零** | [ball-physics.js L114-115](file:///workspace/FE-project/src/core/match/ball-physics.js#L114-L115) / C-03 | state ∈ {CONTROLLED,GOAL} | **Physics 侧不变量快照（{0,0}）** | — |
| W5 | **C-39 Transit Velocity Seed** | [continuous-ball-movement-integration.js L158-161](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L158-L161) / CONTINUOUS_TRANSIT | **仅 `!stepping.velocity`** | **Transit Derived Seed（非每 Tick Truth）** | 是 |
| W6 | **C-05 Interaction State Mutation** | [interaction-state-update.js L59-68](file:///workspace/FE-project/src/core/match/interaction-state-update.js#L59-L68) / INTERACTION_INTEGRATE | CONTROLLED/FREE → 置 `{0,0}`；IN_TRANSIT → **保留** | **Interaction State Writer** | 否（阶段最后） |
| W7 | PASS / SHOT `apply*StateUpdate` | [pass-state-update.js L15-24](file:///workspace/FE-project/src/core/match/pass-state-update.js#L15-L24) / ACTION | 进入 IN_TRANSIT | **清除**（新 ball 不含 `velocity`） | 是 |
| W8 | `seedBallVelocity` / `stepMatchBall` | [ball-physics.js L87-90 / L285-294](file:///workspace/FE-project/src/core/match/ball-physics.js#L285-L294) / Utility | Harness 专用 | 非生产 Tick 路径 | — |
- **结论**：生产路径 Writer 为 W1–W7；**本 Gate 未新增任何 Writer**。W5 证明 **Transit Velocity Seed ≠ 每 Tick Velocity Truth**（只在球无 velocity 时播种；任意物理 Tick 后恒 truthy，不再被 transit 重播）。
- **Reader**：唯一生产读取点 = [`deriveBallFacts`](file:///workspace/FE-project/src/core/match/ball-facts.js#L21-L38)（`velocity` / `speed`）；下游 `tactical-context`、`player-situation`、`second-ball-resolution`。`ball-trajectory.js` 的 `velocity` 为**自派生值**，不读 `ball.velocity`。

### 三、Velocity Truth Classification
**A — C-03 Physics Truth**（IN_TRANSIT 域内）。非纯 Transit Derived（W5 仅 seed）；非 Action State；Interaction 写入（W6）属**独立 mutation 层**，可覆盖 Physics（阶段序）。**但 CONTROLLED 域内不存在活跃 Physics Writer**，故 CONTROLLED 的 velocity 无单一 Truth owner（见 §七）。

### 四、Contact Reflection Probe（确定性场景）
Transit `A{0.2,0.5} → B{0.8,0.5}`、`dt=0.05`、玩家位于球路径（`p1@0.235`，contact radius 0.03）：
| | velocity | position | contacting |
| --- | --- | --- | --- |
| Tick N 前 | `{0.6,0}` | `0.2` | `[]` |
| Contact 后 | **`{-0.32225,0}`** | `0.205` | `['p1']` |
→ 确认 Contact Resolution **真实修改 `ball.velocity` 并进入 `MatchCore.ball`**（`stepBallPhysics` 输出即 Truth）。

### 五、Completion Probe（`duration=2`）
| 时点 | position | velocity | state | transit | control |
| --- | --- | --- | --- | --- | --- |
| Completion 前（Tick1 末） | `0.21356` | `{0.0025798,-0.0175509}` | IN_TRANSIT | 有(elapsed=1) | null |
| Completion 后（Tick2） | **`{0.8,0.5}`（=transit.to）** | **`{0.0025798,-0.0175509}`（保留）** | **CONTROLLED** | **无** | `h_t` |
- events：`CONTINUOUS_TRANSIT_COMPLETED`。
- **确认 C-23 只写 position**；[`finalizeTransitSettlement`](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L70-L94) **不写 velocity**（`base = {...ball, transit:undefined}` 原样保留速度）；**CONTROLLED 携带 Contact 残余 velocity**。

### 六、Controlled Velocity Semantics（≥4 种 CONTROLLED 来源）
| 来源 | outcome | state | velocity | control |
| --- | --- | --- | --- | --- |
| A Transit Completion（Contact 后） | `COMPLETED` | CONTROLLED | **`{0.0025798,-0.0175509}`（≠0）** | `h_t` |
| B INTERCEPTION_SUCCESS | `INTERCEPTION_SUCCESS` | CONTROLLED | **`{0,0}`** | `a_d` |
| C DRIBBLE_COMPLETED | `DRIBBLE_COMPLETED` | CONTROLLED | **`{0,0}`** | `h_a` |
| D SECOND_BALL_WON | `SECOND_BALL_WON` | CONTROLLED | **`{0,0}`** | `a_d` |
- **合法差异还是冲突？** A 与 B/C/D 的差异**无法由任何 Frozen Contract 唯一解释**：C-05（W6）显式规定 Interaction 产生的 CONTROLLED **速度置零**；C-39 finalize（§五）**对 velocity 沉默**。两条生产路径互相矛盾 → 状态语义不一致。

### 七、Next Tick Consumption（CONTROLLED + 非零 velocity）
| | state | velocity | position | transit | stages / events |
| --- | --- | --- | --- | --- | --- |
| 进入（完成 Tick） | CONTROLLED | `{0.0025798,-0.0175509}` | `{0.8,0.5}` | 无 | — |
| Tick+1 | CONTROLLED | **不变** | **不变** | 无 | stages 含 `continuous_transit`；event `CONTINUOUS_TRANSIT_SKIPPED` |
- `posChanged = false`，`velChanged = false`。
- C-39 因 `NO_TRANSIT` **跳过 Physics**；C-03 不在 CONTROLLED 下运行 → **velocity 不驱动 position**。
- **是否仍有生产消费者？** 仅 [`deriveBallFacts`](file:///workspace/FE-project/src/core/match/ball-facts.js#L21-L38) 将其投影为快照 `velocity/speed`；下游 `tactical-context.ballSpeed/ballVelocity/ballRelation`、`player-situation.ballRelation` **均无行为分支**消费之（`ctx.ballSpeed/ballVelocity/ballRelation` 在 src 内无读取者；`second-ball-resolution` 仅在 **FREE** 时读 `closingSpeed`）。→ CONTROLLED 残余 velocity 为 **dormant（无行为消费者）**，仅具诊断性投影面。

### 八、Ball State / Velocity Matrix（现有语义）
| state | transit | velocity | position 驱动 | Physics 运行 |
| --- | --- | --- | --- | --- |
| IN_TRANSIT | 有 | 可非零（Physics Truth） | 是（C-03 / C-23） | 是（非完成 Tick） |
| CONTROLLED | 无 | **残留可非零（未定义）/ Interaction 来源 `{0,0}`** | 否 | 否（跳过） |
| FREE | 无 | Interaction 来源 `{0,0}`；**完成 Tick（INACCURATE/MISS）残留可非零** | 否 | 否 |
| GOAL | 无 | 完成 Tick 残留 / Physics 早退 `{0,0}` | 否 | 否 |
- 现有 **Ball Invariant 契约**（[`checkBallInvariants`](file:///workspace/FE-project/src/core/match/interaction-integration.js#L80-L97)、`checkMatchInvariants`）**只约束 control / possessingTeamId**，**完全不约束 velocity**。→ CONTROLLED+非零 velocity **不违反**形式化 Invariant（排除结论 C）。

### 九、Contact + Interaction Arbitration（Stage Order）
| 组合 | outcome | state | velocity（最终） |
| --- | --- | --- | --- |
| Contact + TACKLE | `TACKLE_CANCELLED` | IN_TRANSIT | `{0,0}` |
| Contact + PRESS | `PRESS_CANCELLED` | IN_TRANSIT | `{0,0}` |
| Contact + INTERCEPTION | `INTERCEPTION_SUCCESS` | CONTROLLED | `{0,0}`（C-05 覆盖 Contact 残余） |
| Contact + SECOND_BALL | `SECOND_BALL_WON` | CONTROLLED | `{0,0}` |
- **冻结 Stage 序**（CONTINUOUS_TRANSIT → ACTION → INTERACTION_RESOLVE → INTERACTION_INTEGRATE）**已足以仲裁**：Interaction（后阶段 W6）覆盖 Contact Physics（前阶段 W2/W3）。**无需新增 Arbitration API**。

### 十、Contact + No Interaction → Completion（核心场景）
| | velocity | state | control | transit |
| --- | --- | --- | --- | --- |
| Tick1（Contact，无 Action） | `{0.0025798,-0.0175509}` | IN_TRANSIT | null | 有 |
| Tick2（Completion） | **`{0.0025798,-0.0175509}`** | CONTROLLED | `h_t` | 无 |
- `velocityRetained = true` → **Contact velocity 在无 Interaction 时完整穿越完成边界进入 CONTROLLED**。

### 十一、Post-Completion Velocity Consumer Audit（全仓）
| 读取路径 | 是否读 `ball.velocity` | 对 CONTROLLED 是否有行为影响 |
| --- | --- | --- |
| `ball-facts.js deriveBallFacts` | **是（唯一生产读点）** | 否（仅投影快照） |
| `tactical-context`（ballSpeed/ballVelocity/ballRelation） | 经 ball-facts | 否（下游无读取） |
| `player-situation`（ballRelation） | 经 ball-facts | 否（无行为分支） |
| `second-ball-resolution`（closingSpeed） | 经 ball-facts | **仅 FREE**（非 CONTROLLED） |
| Match Tick / Possession / Action / Save / Result / Goal / UI / Debug | 否 | 否 |
- **结论**：CONTROLLED 残余 velocity **无生产行为消费者**；不驱动 position；不进入 Save / Match Result。属**休眠的 Physics 残留（dormant stale Physics metadata）**，但**不得由本 Gate 自行清除**。

### 十二、Final Architecture Decision
现有 Frozen Contract **无法唯一解释** `CONTROLLED + 非零 velocity`：
1. C-05（W6）明确 CONTROLLED ⇒ velocity `{0,0}`；C-03 CONTROLLED 早退（W4）亦返回 `{0,0}`；而 C-39 finalize **对 velocity 沉默**，使完成 Tick 的 CONTROLLED 保留 Contact 残余。
2. 两条生产 CONTROLLED 路径**语义不一致**，且无契约裁决。
3. Ball Invariant **不约束 velocity** → 不构成形式化违约（排除结论 C）。
4. 无法证明 CONTROLLED 仍消费 velocity（排除结论 A 的“Truth 必须保留”）。

→ **结论 B：`CONTROLLED_VELOCITY_SEMANTICS_UNDEFINED`**。**BLOCKED / OWNER_DECISION_REQUIRED。** 本 Gate 调查已完成，**不得自行修复、不得自行清零、不得新增 Velocity Cleanup / ContactResult / Ball Velocity Truth / Completion 修改**。

### 十三、Determinism
Contact→Completion、Contact→Completion→Next Tick、Contact→Interaction→Completion、Contact→SECOND_BALL→Next Tick 重复运行 → **4/4 identical=true**。无 `Math.random` / `Date.now` / 墙钟 / 非确定性排序。

### 十四、Regression / Files Changed / Contract Changes
- `node tests/run.js` → **1525 通过 / 0 失败（共 1525）**。
- Files Changed：仅 `docs/SIMULATION_SPEC.md`（追加本 §58）；**src/** = 0，**tests/** = 0。
- Contract Changes：**无**。C-03 / C-05 / C-06 / C-08 / C-23 / C-29 / C-39 / C-44 / C-46 / C-47 / C-48 / C-50 与 Velocity Equation / Friction / Reflection / Transit Completion / CONTROLLED State 均未改；未新增 Velocity Cleanup API / Contact Cleanup Stage / ContactResult / Ball Velocity Truth / Arbitration API。

### 十五、Out of Scope
`contacting[]`（C-50）、Contact Geometry / Swept Contact / Transit Endpoint / Player Movement / Possession / LastTouch / Goal Resolution / Interaction Success Probability / Friction / Velocity Equation / NewGen / Match Result —— 均未触碰。本 Gate 只研究 **Post-Contact Velocity Lifecycle**。

### 十六、Remaining Risks（含 Block）
1. **`CONTROLLED_VELOCITY_SEMANTICS_UNDEFINED`（Block）**：Transit 完成产生的 CONTROLLED 可携带 Contact 残余 velocity，与 Interaction 产生的 CONTROLLED（`{0,0}`）语义不一致，且无契约裁决。需 Owner 决策：(a) 接受“Physics 残留、无行为消费者、dormant 诊断”；或 (b) 未来 Gate 定义“完成即清零 velocity（合法 Owner 授权）”。**本 Gate 不自决**。
2. 相同不一致亦存在于 **FREE**（完成 Tick 的 INACCURATE/MISS 保留残余，Interaction 的 FREE 置零）——FREE 下 `closingSpeed` 有实际读取（second-ball），语义影响面更大，建议未来单独 Gate 评估。
3. Stage Order 已足够仲裁 Contact↔Interaction velocity 覆盖，**无需**新增 Arbitration API（记录，非风险）。

**STOP — 不得进入 C-52，不得自行清零 Velocity，不得修改 C-03/C-05/C-06/C-39/C-46/C-47/C-48/C-50。等待 Owner 验收。**

## §59 Terminal Ball Velocity Semantics / FREE & CONTROLLED Decision Foundation（Step 39F-M-C-52）

**Gate Result = BLOCKED / SEALED。Architecture Conclusion = BLOCKED / SEALED（`TERMINAL_VELOCITY_SEMANTICS_UNDEFINED` → OWNER_DECISION_REQUIRED）。** **src/** = 0，**tests/** = 0；唯一改动 = 本 §59。Regression **1525 通过 / 0 失败**。全部为 read-only Probe `/tmp/c52-terminal-velocity-probe.mjs`（未被生产代码引用）。

> 承接 C-51（`CONTROLLED_VELOCITY_SEMANTICS_UNDEFINED`）。本 Gate **只冻结语义**，**不清零、不新增 Writer / Boundary / API**。

### 一、Gate 目标
确定球离开 IN_TRANSIT 后，`velocity` 在 **FREE / CONTROLLED / GOAL** 中的正式语义，并回答「哪些终态允许非零 velocity」「FREE 的 closingSpeed 需要何种 velocity」「Completion 与 Interaction 是否必须一致」「是否需要未来单独的 Velocity Completion Boundary」。

### 二、Velocity State Domain（Ball State 枚举恰为 4）
`BALL_STATE = {CONTROLLED, IN_TRANSIT, FREE, GOAL}`（[ball-physics-config.js L22-27](file:///workspace/FE-project/src/core/match/ball-physics-config.js#L22-L27)），**无其他状态**。
| Domain | Velocity 是否 Truth | 是否行为输入 | 是否需保留 | 是否必须为零 | Writer | Reader | 生命周期终点 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A IN_TRANSIT | **是（Physics Truth）** | 是（驱动 position / 决策几何） | 是 | 否 | W2/W3（Physics）、W5（seed）、W7 | C-03、ball-facts | 本次 Transit 完成 / Interaction |
| B CONTROLLED | **未定义**（无活跃 Physics Writer） | **否（无行为消费者）** | — | **未定义** | W4/W6 写 {0,0}；**W-finalize 不写（保留残留）** | 仅 ball-facts（诊断投影） | 无（dormant） |
| C FREE | **未定义**（完成保留 / Interaction 置零） | **是**（`closingSpeed`） | 是（若作行为输入） | **未定义** | W6 写 {0,0}；**W-finalize 不写** | ball-facts → second-ball `closingSpeed` | 被 SECOND_BALL 消费 / 下一 Interaction |
| D GOAL | **未定义**（完成保留残留） | **否（无消费者）** | — | **未定义** | W4 写 {0,0}（若被调用）；**W-finalize 不写** | 无 | 死球（无清理） |

### 三、CONTROLLED Audit（4 来源）
| 来源 | outcome | state | velocity | transit | control | poss |
| --- | --- | --- | --- | --- | --- | --- |
| A Transit Completion | `COMPLETED` | CONTROLLED | **`{0.0025798,-0.0175509}`（≠0）** | 无 | `h_t` | `H` |
| B INTERCEPTION_SUCCESS | `INTERCEPTION_SUCCESS` | CONTROLLED | **`{0,0}`** | 无 | `a_d` | `A` |
| C DRIBBLE_COMPLETED | `DRIBBLE_COMPLETED` | CONTROLLED | **`{0,0}`** | 无 | `h_a` | `H` |
| D SECOND_BALL_WON | `SECOND_BALL_WON` | CONTROLLED | **`{0,0}`** | 无 | `a_d` | `A` |
→ A 与 B/C/D 的差异**无法唯一归类**为「正式允许的不同来源语义」：无任何 Frozen Contract 声明「完成来源保留 / Interaction 来源置零」。→ **维持 `CONTROLLED_VELOCITY_SEMANTICS_UNDEFINED`，BLOCKED。**

### 四、FREE Audit（完成 vs Interaction）
| 来源 | state | velocity | control/poss |
| --- | --- | --- | --- |
| A Transit Completion（INACCURATE / INTERCEPTED-无 interceptor / MISS） | FREE | **保留残留 `{0.0025798,-0.0175509}`** | null/null |
| B Interaction → FREE（Deflection 等） | FREE | **`{0,0}`（W6）** | null/null |
- **两个 FREE 来源 velocity 不一致**（同 CONTROLLED 问题）。
- FREE **不是**「只是非 IN_TRANSIT 的另一状态」：其 velocity 与 CONTROLLED 语义**必须分开判断**（见 §六）。

### 五、GOAL Audit
`SHOT.GOAL` 完成 → state GOAL、**velocity 保留残留 `{0.0025798,-0.0175509}`**、无 transit、control null。
- 全仓确认：`velocity` **不进入** Goal Resolution / Goal Geometry / Goal Crossing / Match Result / Save / UI（`*goal*.js`、`*match-result*.js`、`*save*.js` 均 0 匹配）。
- 结论：GOAL 残余 velocity 为 **Dormant State Metadata（无消费者）**；**本 Gate 不清除**。

### 六、closingSpeed 专项
1. **Producer**：[`deriveBallRelation`](file:///workspace/FE-project/src/core/match/ball-facts.js#L60-L88)（`closingSpeed = -(relVel · dirToBall)`）。
2. **Input**：`relVel = ball.velocity − playerVelocity`；`dirToBall`（几何）。
3. **Reader**：`deriveSecondBallCandidates` → `computeCompetitionScore`（[second-ball-resolution.js L171-178](file:///workspace/FE-project/src/core/match/second-ball-resolution.js#L171-L178)，`CLOSING_WEIGHT * closing`）→ 排序 → winner。
4. **Reader Stage / State 条件**：Action 阶段的 SECOND_BALL follow-up；**仅 eligible（`isBallFree` ⇒ state=FREE ∧ control=null ∧ poss=null ∧ !transit）**候选参与打分（[L217](file:///workspace/FE-project/src/core/match/second-ball-resolution.js#L217)）。
5. 是否只用 FREE：**是**（非 FREE 候选 `eligibility=BALL_NOT_FREE`，不计分）。
6. 依赖 Ball Velocity：**是**（探针 `dependsOnBallVelocity=true`，velocity 0.3 → closingSpeed 0.3，velocity 0 → 0）。
7. 依赖 Player Velocity：**是**（`dependsOnPlayerVelocity=true`）。
8. 依赖相对速度：**是**。
- **关键判定**：FREE 完成产生的**旧 velocity 会直接改变 `closingSpeed`**（探针 `free_from_completion.differs=true`：同一批候选，残余 velocity 下 closingSpeed `[-0.00248,0.00371,...]`，置零后 `[-0.000054,0.00113,...]`）。→ **FREE 残余 velocity 不是纯 Diagnostic Metadata，而是潜在 Behavioral Input。**（本 Gate 的探针中 winner 未翻转，但 `closingSpeed` 分量确已改变；胜负是否翻转取决于数值，不得据此排除风险。）

### 七、Velocity Reader Matrix
| Reader | State | Input | Behavior | Truth 需求 |
| --- | --- | --- | --- | --- |
| C-03 Ball Physics | IN_TRANSIT（∉{CONTROLLED,GOAL}） | ball.velocity | **Behavioral**（position 积分 / 反射 / 摩擦） | **Truth** |
| C-39 完成路径 | 完成 Tick | **不读** velocity | — | — |
| C-05 Interaction | 任意 | 覆写（非读） | Behavioral（终态置零） | — |
| SECOND_BALL（closingSpeed） | **仅 FREE** | ball.velocity + playerVel | **Behavioral**（winner 打分） | **Truth（若消费）** |
| tactical-context（ballSpeed/ballVelocity/ballRelation） | 任意 | ball.velocity | **Diagnostic Projection**（src 内无读取者） | 无 |
| player-situation（ballRelation） | 任意 | ball.velocity | Diagnostic Projection（无行为分支） | 无 |
| ball-facts（deriveBallFacts） | 任意 | ball.velocity | 派生投影 | — |
| Match Result / Goal / Save / UI / Controller | 任意 | **不读** | — | — |
- **Behavioral Consumer（仅 1 个）= SECOND_BALL `closingSpeed`，且仅 FREE**。其余均为 Diagnostic Projection。

### 八、Velocity Writer Matrix（沿用 C-51，全仓复核无新增）
W1 `sanitizeBall`｜W2 C-03 Physics 积分｜W3 C-03 Contact Reflection｜W4 C-03 CONTROLLED/GOAL 早退（{0,0}）｜W5 C-39 Transit Velocity Seed（仅 `!velocity`）｜W6 C-05 Interaction State Mutation（CONTROLLED/FREE→{0,0}）｜W7 PASS/SHOT `apply*StateUpdate`（进 IN_TRANSIT 清除 velocity）。
**终态关键缺失**：**不存在 Terminal/Completion Velocity Writer** —— `finalizeTransitSettlement`（[L70-94](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L70-L94)）只改 state/control/poss 并清 transit，**对 velocity 完全沉默**，故 CONTROLLED / FREE / GOAL 保留最后一次 Physics 快照。**本 Gate 未新增任何 Writer。**

### 九、Terminal Velocity Options（三方案评估）
| 方案 | 定义 | 与当前代码事实 | 评估 |
| --- | --- | --- | --- |
| A 所有终态清零 | CONTROLLED/FREE/GOAL = {0,0} | **冲突**：需要新增 Completion Velocity Writer（违反本 Gate 禁令）；且 FREE 会丢失 `closingSpeed` 的物理信息 | **否决**（需新增 Writer / 改 Frozen） |
| B 终态保留 Physics Velocity | 完成不清零，velocity 为最后 Physics Snapshot | **最贴合代码事实**；需明确「是否允许行为读取」——CONTROLLED/GOAL 无消费者（dormant），FREE 有 `closingSpeed` 消费者 | **部分成立**，但无法解释 Completion↔Interaction 的 FREE/CONTROLLED 不一致 |
| C State-Specific | IN_TRANSIT=Truth；FREE=Truth（供 closingSpeed）；CONTROLLED=必须为零；GOAL=dormant | 「CONTROLLED 必须为零」**与代码冲突**（完成 CONTROLLED 带残留） | **与事实冲突**（除非把完成 CONTROLLED 判为缺陷，需 Owner 决策） |
→ 三方案**均无法唯一匹配当前代码事实**：B 贴合事实但遗留不一致；C 语义自洽但与事实冲突；A 需新增 Writer。→ **语义未定义**。

### 十、Completion / Interaction 一致性
同一目标 State 下：
| 路径 | state | velocity |
| --- | --- | --- |
| Transit Completion | CONTROLLED | `{0.0025798,-0.0175509}` |
| Interaction（INTERCEPTION_SUCCESS） | CONTROLLED | `{0,0}` |
- `sameState = true`，`velocityEqual = false`。
- **判定**：无法归类为「合法不同来源」——无 Frozen Contract 定义该差异。**属 State Contract 缺口（未定义）。** 若 Owner 判定为违规，则未来需要一个统一的 **Terminal Velocity Boundary**；**本 Gate 不实现**。

### 十一、State Velocity Contract（尝试冻结 → 部分未定义）
| State | Truth / Derived / Dormant | Behavioral Consumer | Legal Value | Writer | Reader | Lifecycle |
| --- | --- | --- | --- | --- | --- | --- |
| IN_TRANSIT | **Truth（Physics）** | 有（Physics / 决策几何） | 任意有限（clamp） | W2/W3/W5/W7 | C-03、ball-facts | Transit 完成 / Interaction 取代 |
| CONTROLLED | **未定义（Dormant 候选）** | **无** | **未定义**（完成→残留；Interaction→{0,0}） | W4/W6 / 无终态 Writer | ball-facts（诊断） | 无 |
| FREE | **未定义（Potential Behavioral）** | **有（closingSpeed，仅 FREE）** | **未定义**（完成→残留；Interaction→{0,0}） | W6 / 无终态 Writer | ball-facts→second-ball | 被 SECOND_BALL 消费 / 下一 Interaction |
| GOAL | **未定义（Dormant）** | 无 | **未定义** | 无终态 Writer | 无 | 死球 |
→ **CONTROLLED / FREE / GOAL 的 Legal Value 均无法唯一冻结** → `TERMINAL_VELOCITY_SEMANTICS_UNDEFINED`。

### 十二、Invariant Audit
现有 Ball Invariant（[`checkBallInvariants`](file:///workspace/FE-project/src/core/match/interaction-integration.js#L80-L97) / `checkMatchInvariants` / `checkTickInvariants`）：
- FREE ⇒ `control=null ∧ poss=null`；IN_TRANSIT ⇒ `control=null ∧ poss=null`；CONTROLLED ⇒ `control≠null ∧ poss≠null`。
- **不存在** `CONTROLLED ⇒ velocity==0`、`FREE ⇒ velocity==0`、`GOAL ⇒ velocity==0` 任何约束。
- **本 Gate 不新增任何 Invariant。** → CONTROLLED+非零 velocity **不违反形式化 Invariant**（排除「明确违约」）。

### 十三、Determinism
Transit→CONTROLLED、Transit→FREE、Transit→GOAL、FREE→closingSpeed、Contact→Completion→CONTROLLED、Contact→Completion→FREE 重复运行 → **6/6 identical=true**。无 `Math.random` / `Date.now` / 墙钟 / 非确定性排序。

### 十四、Regression / Files Changed / Contract Changes
- `node tests/run.js` → **1525 通过 / 0 失败（共 1525）**。
- Files Changed：仅 `docs/SIMULATION_SPEC.md`（追加本 §59）；**src/** = 0，**tests/** = 0。
- Contract Changes：**无**。C-03 / C-05 / C-06 / C-08 / C-23 / C-29 / C-39 / C-44 / C-46 / C-47 / C-48 / C-50 / C-51 与 Physics Equation / Friction / Contact Reflection / Transit Completion / Ball State Schema / closingSpeed 算法 / Possession 均未改；未新增 Velocity Writer / Velocity Cleanup API / Completion Velocity API / Terminal Velocity Boundary。

### 十五、Out of Scope
`contacting[]`、Contact Geometry、Swept Contact、Transit Endpoint、Player Movement、Possession、LastTouch、Goal Resolution、Interaction Success Probability、Friction、Velocity Equation、NewGen、Match Result 的**生产修改**。本 Gate 只做**终态 velocity 语义冻结**（且冻结失败 → BLOCK）；**不实现任何清零 / 边界**。

### 十六、Remaining Risks
1. **`TERMINAL_VELOCITY_SEMANTICS_UNDEFINED`（Block）**：CONTROLLED / FREE / GOAL 三终态的 velocity Legal Value 均无 Frozen Contract。需 Owner 决策：
   (a) **Terminal Preserve + Dormant**：接受完成保留 Physics Snapshot，且**禁止** CONTROLLED/GOAL 作行为读取，**仅** FREE 的 closingSpeed 可合法读取（须补 FREE 专属消费窗口定义）；
   (b) **Terminal Zero with authorized Writer**：授权未来 Gate 新增统一 Terminal Velocity Boundary（需 Owner 明确授权，突破本 Gate 禁令）。
2. **Completion ↔ Interaction 不一致**：同一 CONTROLLED/FREE 由两条生产路径产生不同 velocity（完成=残留、Interaction={0,0}）。若 Owner 判定为违规，需未来统一 Terminal Velocity Boundary。
3. **FREE 的 closingSpeed 已具备 Behavioral 依赖**：完成产生的 FREE 残旧 velocity **会改变** `closingSpeed`；虽当前生产 Tick 中 SECOND_BALL 恒在 Interaction（W6 置零）之后触发，使残留被覆盖，但该**语义依赖真实存在**，未来任何绕过 W6 的 FREE 读取路径都将受影响。→ 建议 FREE 语义优先收敛。
4. **GOAL / CONTROLLED 残余 velocity 为 Dormant**：无消费者、不进 Save / Result，但**不得由本 Gate 清除**。

**STOP — 不得进入 C-53，不得实现 Velocity Cleanup，不得统一清零，不得修改 C-03/C-05/C-06/C-23/C-39。等待 Owner 验收。**

## §60 FREE Ball Velocity / Closing Speed Semantic Decision Gate（Step 39F-M-C-53）

**Gate Result = BLOCKED / SEALED。Architecture Conclusion = BLOCKED / SEALED（`FREE_VELOCITY_SEMANTICS_UNDEFINED` + `CLOSING_SPEED_CONSUMPTION_WINDOW_UNDEFINED` → OWNER_DECISION_REQUIRED）。** **src/** = 0，**tests/** = 0；唯一改动 = 本 §60。Regression **1525 通过 / 0 失败**。全部为 read-only Probe `/tmp/c53-free-velocity-probe.mjs`（未被生产代码引用）。

> 承接 C-52（`TERMINAL_VELOCITY_SEMANTICS_UNDEFINED`）。本 Gate **只做语义决策与冻结尝试**，**不清零、不实现、不新增 Boundary / Writer / API**。

### 一、Gate 目标
确定 FREE 状态下 `ball.velocity` 与 `closingSpeed` 的正式语义：分类（Truth/Derived/Dormant/Undefined）、合法值、行为消费者、消费窗口、以及 Completion ↔ Interaction 是否能统一。

### 二、FREE Velocity 三候选定义评估
| Option | 定义 | 与代码事实 | 评估 |
| --- | --- | --- | --- |
| A Dormant Snapshot | FREE 保存最后 Physics Velocity，但**不得作为行为输入** | **贴近生产事实**（探针：completion-FREE 残余**不可达** SECOND_BALL）；但 `closingSpeed` 公式**确实读取** `ball.velocity`，需额外说明「唯一进入 second-ball 的 FREE 恒为 W6 置零值」 | **部分成立**，但「禁止行为读取」无契约/无强制，且未解释公式依赖 |
| B Behavioral Physics Truth | FREE velocity 属正式 Physics Truth，允许 `closingSpeed` 读取 | 则 completion 残余为**合法行为输入**——但生产从不路由它，且 Interaction-FREE 被 W6 置零 | **与 W6 及生产路由冲突** |
| C Terminal / Zero | 进入 FREE 即 `{0,0}` | **当前无统一清零 Writer**（C-39 finalize 沉默）；需未来 Implementation Gate；且会丢失 loose-ball 物理速度 | **需新增 Writer**（本 Gate 禁止） |
→ 三候选**均无法由现有 Frozen Contract 唯一推出** → 语义未定义。

### 三、Transit Completion → FREE 生命周期（含 Contact）
`PASS.INACCURATE`、`duration=2`、经 Contact 路径：
| 阶段 | state | velocity | control/poss | lastTouch | transit |
| --- | --- | --- | --- | --- | --- |
| 最后 Physics Tick（Tick1） | IN_TRANSIT | `{0.0025798189,-0.0175509341}` | null/null | `p1` | 有 |
| Completion（Tick2） | **FREE** | **同一 velocity（保留）** | null/null | `p1` | 无 |
| Completion 后第一 Tick（Tick3） | FREE | **同一 velocity（不变）** | null/null | `p1` | 无 |
- `velocityRetained = true`；Tick3 events = `[TICK_STARTED, PLAYER_MOVEMENT_APPLIED, CONTINUOUS_TRANSIT_SKIPPED, NO_ACTION, TICK_ENDED]`。
- **最后合法来源 = 最后一次 IN_TRANSIT Physics Snapshot（C-03 W2/W3）**；C-23/finalize **对 velocity 沉默**。
- 判定：保留的 velocity 是 **(C) 当前 Contract 无法判断**——既非明文宣告的 FREE Physics Truth，也非明文规定的必须清除项；它只是 finalize 不写 velocity 的**残留**。

### 四、Interaction → FREE 路径审计
所有 Interaction→FREE 均经 `setBall(result, …, BS.FREE)` → **C-05（W6）统一写 `velocity={0,0}`**：
| 路径 | 触发 | 结果 state | velocity | 后续 |
| --- | --- | --- | --- | --- |
| DRIBBLE_KNOCKED_LOOSE | [interaction-resolution.js L251-264](file:///workspace/FE-project/src/core/match/interaction-resolution.js#L251-L264) | FREE →（同 Tick SECOND_BALL 消费）→ CONTROLLED | **`{0,0}`** | `h_a` 夺回控制 |
| TACKLE_LOOSE | [L334-346](file:///workspace/FE-project/src/core/match/interaction-resolution.js#L334-L346) | FREE | **`{0,0}`**（W6） | markFollowUp |
| PRESS_SUCCESS | [L414-424](file:///workspace/FE-project/src/core/match/interaction-resolution.js#L414-L424) | FREE | **`{0,0}`**（W6） | markFollowUp |
| INTERCEPTION_DEFLECTED | [L509-511](file:///workspace/FE-project/src/core/match/interaction-resolution.js#L509-L511) | FREE →（同 Tick SECOND_BALL 消费）→ CONTROLLED | **`{0,0}`** | `a_d` 夺球 |
- **判定**：W6 的 `{0,0}` 无物理依据（deflection 明确「scatter」却速度归零），因此它是 **(2) 当前 interaction mutation 层的实现副作用**，**不是**被明文定义的 FREE Velocity 语义。→ 与 §三 的 completion 保留构成**不一致**。

### 五、closingSpeed 正式定义（冻结）
| 项 | 内容 |
| --- | --- |
| Producer | [`deriveBallRelation`](file:///workspace/FE-project/src/core/match/ball-facts.js#L60-L88) |
| Input | `relVel = ball.velocity − playerVelocity`；`dirToBall`（几何） |
| 公式 | `closingSpeed = -(relVel · dirToBall)` |
| Eligibility | **仅 `isBallFree`（state=FREE ∧ control=null ∧ poss=null ∧ !transit）** 候选进入打分（[second-ball-resolution.js L217](file:///workspace/FE-project/src/core/match/second-ball-resolution.js#L217)） |
| Consumer | `deriveSecondBallCandidates` → `computeCompetitionScore`（`CLOSING_WEIGHT * closing`） |
| Behavioral Effect | **仅 SECOND_BALL（loose-ball 争抢 winner 打分）**；Possession/Match Result/Goal/Save **无其他消费者**（全仓确认） |
- `closingSpeed` **≠** `ball.velocity`：后者为物理状态，前者为 `ball.velocity + playerVelocity` 派生的**行为指标**。即便 FREE Velocity 被冻结为 Truth，`closingSpeed` 本身也不成为 Truth（职责分离，§十）。

### 六、closingSpeed 消费窗口
探针：
- FREE 候选 `a_d`：ball.velocity `{0.3,0}` → closingSpeed **`0.3`**；velocity `{0,0}` → closingSpeed **`0`**；`differs=true`。
- 该配置下 SECOND_BALL winner 未翻转（均 `a_d`），但 closingSpeed **分量确已改变**，胜负是否翻转取决于数值，不得据此排除风险。
- **生产可达性**：`SECOND_BALL` 仅在「当 Tick 有 ActionInstance ∧ `requiresFollowUp` ∧ `followUpKind=SECOND_BALL` ∧ integration 后 ball=FREE」时触发（[match-tick.js L232-261](file:///workspace/FE-project/src/core/match/match-tick.js#L232-L261)）。探针 `production_reach`：completion-FREE（残余 velocity）下一 Tick 对 FREE 球发起 PRESS → `PRESS_CANCELLED` → `secondBall=null` → `residualReachedSecondBall=false`；残余 velocity 保持 **dormant**。
- **判定（消费窗口）**：**当前无法唯一冻结**。选项 A（仅 FREE+SECOND_BALL）、B（FREE 全阶段）、C（其他 State 亦可）均不能由契约排除：公式对 velocity 有真实依赖，但生产路由使 completion-FREE 残余恰好不可达；此「恰好」未被任何契约约束 → **`CLOSING_SPEED_CONSUMPTION_WINDOW_UNDEFINED`**。

### 七、Velocity Reader / Writer Matrix
**Writer**：W1 `sanitizeBall`｜W2 Physics 积分｜W3 Contact Reflection｜W4 CONTROLLED/GOAL 早退（{0,0}）｜W5 Transit Seed（仅 `!velocity`）｜W6 Interaction State Mutation（CONTROLLED/FREE→{0,0}）｜W7 PASS/SHOT 清除。**无 FREE 专属 / Completion 专属 Writer**（本 Gate 未新增）。
**Reader**：
| Reader | State | 类型 |
| --- | --- | --- |
| C-03 Ball Physics | IN_TRANSIT | **Behavioral** |
| `deriveBallRelation`→`closingSpeed`→`computeCompetitionScore` | **仅 FREE（eligible）** | **Behavioral** |
| ball-facts（deriveBallFacts） | 任意 | Diagnostic Projection |
| tactical-context（ballSpeed/ballVelocity/ballRelation） | 任意 | Diagnostic Projection（src 内无读取者） |
| player-situation（ballRelation） | 任意 | Diagnostic Projection（无行为分支） |
| Match Result / Goal / Save / UI / Controller | 任意 | **不读** |
→ FREE 的 **Behavioral Consumer 唯一 = SECOND_BALL closingSpeed**；其余为 Diagnostic。

### 八、Completion / Interaction 一致性
同一 FREE State：
| 路径 | velocity |
| --- | --- |
| Transit Completion → FREE | **保留最后一次 Physics Snapshot（可非零）** |
| Interaction → FREE | **`{0,0}`（W6）** |
- 判定：**不是 (A) 合法 Source-Specific Semantics**——无任何契约声明该差异；实为 **(C) Contract 缺失**，且从物理看构成 **(B) Inconsistency**（同为 loose ball，一则散逸保速、一则强制归零）。
- 因此**需要未来统一的 Terminal Velocity Boundary**（若 Owner 选择统一语义）；**本 Gate 不实现**。

### 九、FREE State Contract（冻结尝试 → 部分未定义）
| 项 | 冻结结果 |
| --- | --- |
| State | `FREE`（定义明确：control=null ∧ poss=null ∧ !transit，Invariant 已强制） |
| Velocity Classification | **Undefined**（Dormant 候选 A / Behavioral 候选 B 均无法唯一推出） |
| Legal Value | **Undefined**（`{0,0}` / Non-zero / Both 均有生产路径产生） |
| Behavioral Consumer | **唯一 = `closingSpeed`（SECOND_BALL）** |
| 合法读取 | **Undefined**（公式依赖真实，但消费窗口未定义） |
| Velocity 来源 | **Multiple**：C-03 Physics（completion 保留）/ C-05（interaction 置零） |
| Lifecycle | 起：最后一次 Physics Snapshot 或 Interaction 置零；终：未定义（无消费者则在 FALSE 状态休眠；被 SECOND_BALL 消费则于该 Tick 结束）；**无负责任何结束的 Writer** |
→ **FREE Velocity 语义无法唯一冻结** → `FREE_VELOCITY_SEMANTICS_UNDEFINED`。

### 十、职责分离
- `ball.velocity` = 物理状态（可能残留）。
- `closingSpeed` = `ball.velocity + playerVelocity` 派生的行为指标（仅 FREE eligible 参与 SECOND_BALL 打分）。
- 二者**不得等同**；即便 FREE Velocity 未来被冻结为 Truth，`closingSpeed` 仍为 Derived，不成为第二套 Truth。

### 十一、Determinism
Transit→FREE、Transit→FREE→closingSpeed、Contact→Completion→FREE、Interaction→FREE、FREE→SECOND_BALL 重复运行 → **identical=true（探针 3/3 组 + 既有 C-51/C-52 组）**；无 `Math.random` / `Date.now` / 墙钟 / 非确定性排序。

### 十二、Regression / Files Changed / Contract Changes
- `node tests/run.js` → **1525 通过 / 0 失败（共 1525）**。
- Files Changed：仅 `docs/SIMULATION_SPEC.md`（追加本 §60）；**src/** = 0，**tests/** = 0。
- Contract Changes：**无**。C-03 / C-05 / C-23 / C-39 与 Physics Equation / Friction / Contact Reflection / Transit Integration / Completion Position / Interaction State Mutation / SECOND_BALL 算法 / closingSpeed 公式 / Competition Score 公式 / Ball State Schema / Player Movement / Possession / LastTouch / Contact / CONTROLLED 语义 / GOAL 语义 均未改；未新增 Velocity Writer / Cleanup API / Terminal Velocity Boundary。

### 十三、Out of Scope
FREE Velocity 的**实现修改**、closingSpeed Reader 修改、任何清零 / Boundary 实现、`contacting[]` 及 C-52 §十五 所列项。本 Gate 只做**语义决策**；**BLOCKED，未实现任何方案**。

### 十四、Remaining Risks
1. **`FREE_VELOCITY_SEMANTICS_UNDEFINED`（Block）**：FREE velocity Legal Value / Classification / 合法读取均未定义。需 Owner 决策 A/B/C（见 §二）；若选 C 或统一路径，需未来 **Implementation Gate**（新增 Terminal Velocity Boundary / Completion Velocity Writer）。
2. **`CLOSING_SPEED_CONSUMPTION_WINDOW_UNDEFINED`（Block）**：公式对 `ball.velocity` 有真实依赖，但消费窗口（仅 FREE+SECOND_BALL / FREE 全阶段 / 更广）无契约定义；生产当前「恰好」使 completion 残余不可达，属**未受约束的巧合**。
3. **Completion ↔ Interaction 不一致**：同为 FREE，一条保留、一条归零；若判为违规需统一 Boundary。
4. **W6 `{0,0}` 属实现副作用**：无物理依据，未来若统一 FREE 语义须一并重新定义。
5. **CONTROLLED / GOAL** 仍延续 C-51 / C-52 的 Undefined（本 Gate 未触碰其语义）。

**STOP — 不得进入 C-54，不得实现 Velocity Cleanup，不得修改 FREE Velocity 或 closingSpeed。等待 Owner 验收。**

## §61 Terminal Ball Velocity Semantics Owner Decision / Contract Freeze（Step 39F-M-C-54）

**Gate Result = PASS / SEALED（Owner Decision 已作出）。** **src/** = 0，**tests/** = 0；唯一改动 = 本 §61。Regression **1525 通过 / 0 失败**。

> 本 Gate 结束 C-51 `CONTROLLED_VELOCITY_SEMANTICS_UNDEFINED`、C-52 `TERMINAL_VELOCITY_SEMANTICS_UNDEFINED`、C-53 `FREE_VELOCITY_SEMANTICS_UNDEFINED` + `CLOSING_SPEED_CONSUMPTION_WINDOW_UNDEFINED`。
> **本 Gate 只冻结语义，不实现。** CONTROLLED / GOAL 的归零属 **CONTRACT_FROZEN / IMPLEMENTATION_PENDING**（未来 Implementation Gate 实现），**当前代码尚未实现该归零**（明确标注为未实现，非既成事实）。

### 一、Owner Decision（正式选择）
**选择 Candidate C — State-Specific Velocity Contract**，并吸纳 Candidate A 对 CONTROLLED / GOAL 的处理：
- **IN_TRANSIT = Physics Truth**（沿用 C-52，不改）。
- **FREE = Physics Truth**（Loose-Ball Physics Velocity）——唯一仍具**真实物理行为意义**的非 IN_TRANSIT 状态。
- **CONTROLLED = Normalized Zero `{0,0}`**（不具 Physics 意义；无行为消费者）。
- **GOAL = Normalized Zero `{0,0}`**（Dormant；无消费者）。

判定依据（**非**“代码恰好如此”）：
- **Principle 1**：Physics Velocity 仅在拥有真实 Physics 行为意义的生命周期内为 Truth → 仅 IN_TRANSIT 与 FREE。
- **Principle 2/3**：CONTROLLED 由持球者驱动、GOAL 已越过门线，二者**均不再由 Ball Physics 驱动**，其“自身速度”无物理意义 → 归零。
- **Principle 4**：FREE 保留 Physics Velocity，因为唯一行为消费者 `closingSpeed`（SECOND_BALL）需要它表达**球与球员之间的真实接近/远离速度**。
- **未**以“Interaction 现写 `{0,0}`”反推 FREE 必须为零（Principle 5）；**未**以“Completion 残留非零”反推必须保留（Principle 6）。

### 二、Ball Velocity State Contract（冻结）
| State | Classification | Legal Value | Behavioral Read | Consumer |
| --- | --- | --- | --- | --- |
| IN_TRANSIT | Physics Truth | 任意有限向量 | **Yes** | C-03 Ball Physics（驱动 position） |
| FREE | Physics Truth（Loose-Ball） | **任意有限向量（含 `{0,0}`）** | **Yes（受限）** | `closingSpeed` → SECOND_BALL |
| CONTROLLED | Normalized Zero（Dormant/Ignored） | **`{0,0}`** | **No** | 无 |
| GOAL | Normalized Zero（Dormant/Ignored） | **`{0,0}`** | **No** | 无 |

### 三、FREE Velocity Contract
- **Classification**：Physics Truth（Loose-Ball Physics Velocity）。
- **Legal Value**：**任意有限向量**（`{0,0}` 亦合法——FREE 契约即“承载当前球物理速度，无论其值”）。
- **来源**：C-03 Physics Snapshot（Transit Completion 保留）或 C-05 Interaction（当前置 `{0,0}`）——二者**均为合法 FREE 值**，不构成冲突。
- **Behavioral Read**：**授权**，但**仅限** `closingSpeed`（见 §四 / §五）。
- **无归零边界需求**：FREE 不需要 Terminal Velocity Boundary。

### 四、FREE closingSpeed Contract（冻结）
| 项 | 内容 |
| --- | --- |
| Input | `relVel = ball.velocity − playerVelocity`；`dirToBall`（几何） |
| Producer | [`deriveBallRelation`](file:///workspace/FE-project/src/core/match/ball-facts.js#L60-L88) |
| Legal State | **仅 FREE**（eligible：state=FREE ∧ control=null ∧ poss=null ∧ !transit） |
| Consumer | `deriveSecondBallCandidates` → `computeCompetitionScore`（`CLOSING_WEIGHT * closing`） |
| Consumption Window | **Window A**：仅在 SECOND_BALL Resolution 期间读取（`requiresFollowUp` 成立且球为 FREE） |
| Behavioral Effect | **仅**影响 **SECOND_BALL winner**；**不得**扩展至 Goal / Match Result / Save / Possession 之外 / Tactical Context / UI |

- **§四 情况 A 成立**：FREE + closingSpeed **合法**；合法消费窗口 = **Window A（仅 SECOND_BALL Resolution）**。
- 明确声明：**不是“当前代码碰巧读到”，而是 Contract 授权**。当前生产路由（Interaction-FREE 由 W6 置零、Completion-FREE 对 FREE 球发起 Action 常被 CANCELLED）使非零 FREE velocity 很少进入 SECOND_BALL，但**契约已授权**其在 FREE + SECOND_BALL 窗口被读取。

### 五、CONTROLLED Velocity Contract
- **Classification**：Normalized Zero（Dormant / Ignored）。
- **Legal Value**：**`{0,0}`**。
- **Behavioral Read**：**No**（不存在 Physics Movement；不存在 `closingSpeed` 消费；velocity 不作为 CONTROLLED 行为输入）。
- **Writer Boundary**：**CONTRACT_FROZEN / IMPLEMENTATION_PENDING**——进入 CONTROLLED 时未来必须拥有**明确的归零边界**（由未来 Implementation Gate 实现）。**当前代码未实现此归零**：Transit Completion → CONTROLLED 会残留最后 Physics Snapshot；此残留为**未实现的契约偏差（deviation）**，非合法状态。
- 理由：CONTROLLED 由持球者驱动，球“自身速度”无物理/行为意义 → 归零（Principle 2）。

### 六、GOAL Velocity Contract
- **Classification**：Normalized Zero（Dormant / Ignored）。
- **Legal Value**：**`{0,0}`**。
- **Behavioral Read**：**No**。不得参与 Goal Resolution / Match Result / Save / UI 行为，亦不进入后续 Physics。
- **Writer Boundary**：**CONTRACT_FROZEN / IMPLEMENTATION_PENDING**（同 CONTROLLED）；当前 Completion → GOAL 残留为**未实现的契约偏差**。

### 七、Completion / Interaction 一致性（正式解释）
| 目标 State | Transit Completion | Interaction（W6） | 判定 |
| --- | --- | --- | --- |
| **FREE** | 保留 Physics Snapshot（可非零） | `{0,0}` | **二者均 CONTRACT-CONFORMANT**（FREE Legal = 任意有限向量）→ 无需统一 Boundary |
| **CONTROLLED** | 残留 Snapshot（可能非零） | `{0,0}` | Interaction **合规**；Completion **偏差（待实现归零边界）** |
| **GOAL** | 残留 Snapshot（可能非零） | —（无 Interaction 路径） | Completion **偏差（待实现归零边界）** |
- 选择 **方案 2（同一 State 统一 Contract）**用于 CONTROLLED / GOAL：契约一律 `{0,0}`，未来需统一 **Terminal Velocity Boundary**（本 Gate 不实现）。
- 选择 **“Legal = Both”**用于 FREE：`{0,0}` 与非零皆合法，**来源差异被正式解释**，**不**需要 Boundary。

### 八、SECOND_BALL Relation（冻结）
`closingSpeed` = **【FREE Ball Physics Velocity 与 Player Velocity 的相对运动指标】**，**不是**普通 Ball Velocity Snapshot。仅参与 `computeCompetitionScore`，最终影响 **SECOND_BALL winner**。**不得**扩展至 Goal / Match Result / Save / Possession 之外 / Tactical Context / UI（除非未来另有 Gate）。

### 九、Implementation Boundary
本 Gate **未改动任何生产代码**：未实现 Terminal Velocity Boundary，未修改 velocity / closingSpeed / C-03 / C-05 / C-23 / C-39。CONTROLLED / GOAL 归零边界列为本契约的 **IMPLEMENTATION_PENDING**，由**下一 Implementation Gate** 单独完成。

### 十、Determinism / Regression / Files / Contract Changes
- 本次 Contract Freeze **未触及生产行为**（src=0 / tests=0），确定性不受影响。
- `node tests/run.js` → **1525 通过 / 0 失败（共 1525）**。
- Files Changed：仅 `docs/SIMULATION_SPEC.md`（追加本 §61）。
- Contract Changes：**新增 §61 Ball Velocity State Contract**（IN_TRANSIT/FREE/CONTROLLED/GOAL + FREE closingSpeed Contract）；未修改既有 C-03 / C-05 / C-06 / C-08 / C-23 / C-29 / C-39 / C-44 / C-46 / C-47 / C-48 / C-50 / C-51 / C-52 / C-53 生产契约。

### 十一、Out of Scope
Terminal Velocity Boundary 的实现、velocity 清零、closingSpeed 公式修改、SECOND_BALL 算法修改、以及 C-51 / C-52 / C-53 已列 Out of Scope 项。

### 十二、Remaining Risks
1. **CONTROLLED / GOAL 归零边界未实现**：当前 Transit Completion 会在 CONTROLLED / GOAL 残留非零 velocity，属**未实现的契约偏差**。无行为消费者（C-51~C-53 审计确认），故**不产生游戏影响**；但需未来 Implementation Gate 落地归零边界以消除偏差。
2. **FREE 非零 velocity 生产可达性低**：W6 置零与 SECOND_BALL 触发条件使 FREE 残旧值很少被 `closingSpeed` 读取；契约已授权，属**可接受的前向契约**，非缺陷。
3. **FREE “Legal = Both”依赖语义而非实现强制**：无 Boundary 强制 FREE 值来源一致；当前语义自洽，若未来引入绕过 C-05 的 FREE 写入路径需重新评估。

**STOP — 不得进入 C-55，不得实现 Terminal Velocity Boundary，不得修改 Velocity 或 closingSpeed。等待 Owner 验收。**

## §62 Terminal Velocity Normalization Implementation（Step 39F-M-C-55）

**Gate Result = PASS / SEALED。** 实现 C-54 §61 冻结契约：**CONTROLLED / GOAL → `velocity = {0,0}`**；**FREE / IN_TRANSIT 保留**。Regression **1540 通过 / 0 失败**（1525 既有 + 15 新增）。

### 一、Terminal Velocity Normalization Boundary（唯一实现）
- 新增模块 [terminal-ball-velocity.js](file:///workspace/FE-project/src/core/match/terminal-ball-velocity.js)：
  - `normalizeTerminalBallVelocity(ball)`：**CONTROLLED / GOAL** → `velocity={x:0,y:0}`（已是 `{0,0}` 则原样返回，引用稳定）；**FREE / IN_TRANSIT / 未知** → **原样返回（preserve）**。
  - `isTerminalVelocityState(state)` / `TERMINAL_VELOCITY_STATES = ['CONTROLLED','GOAL']` / `TERMINAL_ZERO_VELOCITY`。
  - `TERMINAL_VELOCITY_NORMALIZATION_SOURCE='TERMINAL_VELOCITY_NORMALIZATION'`，`ruleVersion='terminal-velocity-normalization-v1'`。
- **只写 velocity**：不改 position / transit / control / possession / lastTouch / state / score / contact。

### 二、接入点（两个官方 State Transition 边界，**单一 Boundary 复用**）
| 边界 | 文件 | 覆盖 |
| --- | --- | --- |
| Transit Completion Finalize | [continuous-ball-movement-integration.js `finalizeTransitSettlement`](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L70-L105) | Transit → CONTROLLED / FREE / GOAL |
| Interaction State Mutation | [interaction-state-update.js `applyInteractionStateUpdate`](file:///workspace/FE-project/src/core/match/interaction-state-update.js#L48-L71) | Interaction / SECOND_BALL → CONTROLLED / FREE |
- **C-23 Position Contract 不变**：Boundary 置于 C-23 之外，`finalize` 仍**只结算 State，不写 Position**。
- **无独立 Tick Stage**，未改 C-08 Stage Order（VALIDATE → SNAPSHOT → PLAYER_MOVEMENT → CONTINUOUS_TRANSIT → ACTION → INTERACTION_RESOLVE → INTERACTION_INTEGRATE → SECOND_BALL → INVARIANTS）。
- C-05 既有 `velocity:{0,0}` 保留为上游 mutation；Terminal Boundary 作为**最终 Contract Enforcement**（重复写入无冲突、无第二 Truth、无额外行为变化）。

### 三、State Guard（FREE 保护，最高优先级）
| State | 行为 |
| --- | --- |
| CONTROLLED | **normalize → `{0,0}`** |
| GOAL | **normalize → `{0,0}`** |
| FREE | **preserve**（`{0.3,0}` / `{-0.2,0.1}` / `{0,0}` 均保持） |
| IN_TRANSIT | **preserve**（Physics Velocity 不受影响） |

### 四、Velocity Writer Matrix（更新）
W1 `sanitizeBall`｜W2 Physics 积分｜W3 Contact Reflection｜W4 Physics 早退（CONTROLLED/GOAL → {0,0}）｜W5 Transit Velocity Seed｜W6 Interaction State Mutation｜W7 PASS/SHOT State Update｜**W8 Terminal Velocity Normalization Boundary（新增，仅 CONTROLLED/GOAL；不覆盖 FREE）**。**W8 未成为「所有非 IN_TRANSIT 状态的 Velocity Writer」——严格限于 CONTROLLED / GOAL。**

### 五、Transit Completion / Contact 验证
- **Transit → CONTROLLED**：`position=transit.to`，`state=CONTROLLED`，`velocity={0,0}`，`transit=undefined`。
- **Transit → FREE**：保留最后 Physics Velocity（**不被清零**）。
- **Contact Reflection → Completion → CONTROLLED**：反射产生的非零残留 velocity 最终归零。
- **Transit → GOAL**：`state=GOAL`，`velocity={0,0}`。

### 六、Interaction / closingSpeed 保持
- INTERCEPTION_SUCCESS / DRIBBLE_COMPLETED / SECOND_BALL_WON → CONTROLLED `{0,0}`。
- TACKLE_LOOSE / PRESS_SUCCESS / INTERCEPTION_DEFLECTED → FREE `{0,0}`（现有 Interaction 路径产生，**非 FREE Contract 强制**；FREE Legal Value 仍为任意有限向量）。
- `closingSpeed`（FREE → SECOND_BALL）**行为不变**：FREE 非零 velocity 仍参与 `deriveBallRelation` 与 `computeCompetitionScore`；候选集合与资格不变。

### 七、Tests（新增 15 个用例：TV-01 .. TV-14b）
TV-01 CONTROLLED normalization｜TV-02 GOAL normalization｜TV-03 FREE non-zero preservation｜TV-04 FREE zero preservation｜TV-05 IN_TRANSIT preservation｜TV-06 Transit→CONTROLLED｜TV-07 Transit→FREE｜TV-08 Contact→Completion→CONTROLLED｜TV-09 Transit→GOAL｜TV-10 INTERCEPTION_SUCCESS｜TV-11 DRIBBLE_COMPLETED｜TV-12 SECOND_BALL_WON｜TV-13 FREE→closingSpeed｜TV-14 Writer ownership / 无重复 Terminal Writer｜TV-14b Determinism。**15/15 通过。**
- Determinism：Boundary / Completion 重复运行 `identical=true`；无 `Math.random` / `Date.now` / 墙钟。

### 八、Files Changed / Contract Changes
- **新增**：`src/core/match/terminal-ball-velocity.js`、`tests/terminal-ball-velocity.test.js`。
- **修改**：`src/core/match/continuous-ball-movement-integration.js`（finalize 委托 Boundary，switch 改为赋值后统一 normalize）、`src/core/match/interaction-state-update.js`（State Mutation 后委托 Boundary）、`tests/run.js`（注册新测试）、`docs/SIMULATION_SPEC.md`（本 §62）。
- **Contract Changes**：实现 C-54 §61 冻结契约（CONTROLLED/GOAL 归零）；**未修改** C-54 语义本身，未修改 C-03/C-05 Stage 语义/C-06/C-08/C-23/C-29/C-39/C-44/C-46/C-47/C-48/C-50/C-51/C-52/C-53 生产契约，未改 Physics Equation / Friction / Contact Geometry / Goal Geometry / Transit semantics / closingSpeed 公式 / SECOND_BALL 算法 / Ball State Schema / Possession / LastTouch。
- **Invariant**：**未新增** Ball State Invariant（C-54 为 Semantic Contract，本 Gate 仅 Enforcement）。

### 九、Out of Scope
FREE Velocity 修改、closingSpeed 公式修改、SECOND_BALL 算法修改、Physics Equation / Friction / Contact 修改、新增独立 Tick Stage、C-54 Contract 修改。

### 十、Remaining Risks
1. **C-05 与 Boundary 双写 CONTROLLED 速度**：C-05 上游置 `{0,0}` 与 W8 Enforcement 重复但无冲突（`normalize` 幂等、引用稳定）；保留以**最小改动**满足「保持现有行为 + 统一 Boundary」。
2. **C-05 对 FREE 仍写 `{0,0}`**：属既有 Interaction 语义（C-54 §十六 明确保留）；**非** FREE Contract 强制，FREE Legal Value 不变。
3. **GOAL 仅有 Transit Completion 一条生产入口**：已覆盖；未来若新增 GOAL State Writer，须复用同一 Boundary（W8）。

**STOP — 不得进入 C-56，不得自行处理新的 Velocity 问题，不得修改 FREE / closingSpeed。等待 Owner 验收。**

## §63 Terminal Velocity Post-Implementation Architecture Audit（Step 39F-M-C-56）

**Gate Result = PASS / SEALED（只读审计）。** **src/** = 0，**tests/** = 0；唯一改动 = 本 §63。Regression **1540 通过 / 0 失败**。审计确认 C-55 的 **W8**（CONTROLLED / GOAL → `velocity={0,0}`）**无任何隐藏副作用**。

### 一、W8 唯一职责（只写 velocity）
[terminal-ball-velocity.js `normalizeTerminalBallVelocity`](file:///workspace/FE-project/src/core/match/terminal-ball-velocity.js#L46-L52) 唯一 mutation = `{ ...ball, velocity:{x:0,y:0} }`。**不修改** position / state / transit / control / possessingTeamId / lastTouchPlayerId / contacting / score / goal / possession / player data / movement。纯函数、Immutable、无 RNG / 墙钟。

### 二、State Guard
| State | W8 行为 |
| --- | --- |
| CONTROLLED | normalize → `{0,0}` |
| GOAL | normalize → `{0,0}` |
| FREE | **preserve**（不进入 W8 变更路径） |
| IN_TRANSIT | **preserve** |

`isTerminalVelocityState` 仅对 `CONTROLLED` / `GOAL` 返回 true → **FREE / IN_TRANSIT 永不被 normalize**。

### 三、Transit 隔离
W8 不触碰 `transit.from / to / duration / elapsed / progress` / completion / Transit Seed / Physics Integration；C-23 仍唯一 Completion Position Boundary。
- **T1** IN_TRANSIT：非零 velocity，W8 **不执行**（preserve）。
- **T2** Completion → CONTROLLED：`position=transit.to`、`velocity={0,0}`、`transit=undefined`（W8 执行）。
- **T3** Completion → FREE：W8 **不执行**，velocity 保留。

### 四、Physics 隔离
W8 为独立纯函数：**不调用** `stepBallPhysics` / `velocityFromTransit` / Contact Resolution / Friction / Boundary Reflection / Swept Contact。**不是 Physics Step**（Physics 仅在 CONTINUOUS_TRANSIT 阶段跑；W8 只在 State Transition 边界执行）。

### 五、Position 隔离
W8 **不写 `ball.position`**；仅写 velocity。Transit Completion 的 Position 仍由 C-23（经 `applyBallMovementPositionUpdate`）唯一写入。

### 六、Contact 隔离
IN_TRANSIT 阶段 Contact Reflection 后的 `velocity ≠ {0,0}` 仍成立；仅到 **Completion → CONTROLLED** 才由 W8 清零。W8 **不触发 Contact、不清除 `contacting`、不写 lastTouch、不改 Contact Geometry**；`contacting[]` 仍遵守 C-50（Physics-Window Derived Diagnostic）。

### 七、Interaction 隔离
C-05 CONTROLLED / FREE 的既有 State Mutation 语义**未改写**。CONTROLLED：C-05 写 `{0,0}` + W8 写 `{0,0}` → **幂等、无行为差异、无第二 Velocity Truth**。FREE：C-05 既有 `{0,0}` 仅为**既有 Interaction 行为**；W8 **未将 FREE=zero 升级为 Contract**（FREE Legal Value 仍为任意有限向量）。

### 八、SECOND_BALL 隔离
W8 不改 `closingSpeed` / `computeCompetitionScore` / winner。
- **SB1** FREE + 非零 velocity → closingSpeed 正常（TV-13）。
- **SB2** FREE + `{0,0}` → closingSpeed 正常为对应值。
- **SB3** CONTROLLED → 无 SECOND_BALL（C-05/SECOND_BALL 仅 FREE）。
- **SB4** GOAL → 无 SECOND_BALL。

### 九、GOAL 隔离
GOAL → `velocity={0,0}`；Goal Geometry / Crossing / Resolution / Score / Match Result **不变**。W8 **不参与 Goal 判定**，只在 GOAL State 成立后做 Velocity Normalization。

### 十、State Transition 矩阵（全仓唯一写入点）
| State | Entry Path | W8 | Velocity Result |
| --- | --- | --- | --- |
| CONTROLLED | `finalizeTransitSettlement`（PASS/SHOT Completion） | ✅ | `{0,0}` |
| CONTROLLED | `applyInteractionStateUpdate`（Interaction / SECOND_BALL WON） | ✅ | `{0,0}` |
| GOAL | `finalizeTransitSettlement`（SHOT GOAL） | ✅ | `{0,0}` |
| FREE | `finalizeTransitSettlement`（INACCURATE / MISS / no-id） | —（preserve） | 最后 Physics Velocity |
| FREE | `applyInteractionStateUpdate`（loose / deflect） | ✅ 入口但 **preserve** | `{0,0}`（既有 Interaction 语义） |
| IN_TRANSIT | `pass-resolution` / `shot-state-update` / 非完成 Tick | — | Physics Velocity |
- **每条 CONTROLLED / GOAL 生产入口最终均经 W8**（`second-ball-resolution` 只产 `state`，其 Result 经 C-05 落地 → W8）。**无绕过 W8 的 CONTROLLED / GOAL 入口。**

### 十一、Velocity Writer Matrix
W1 `sanitizeBall`｜W2 Physics 积分｜W3 Contact Reflection｜W4 Physics 早退（CONTROLLED/GOAL → {0,0}）｜W5 Transit Seed｜W6 Interaction State Mutation｜W7 PASS/SHOT State Update｜**W8 Terminal Velocity Normalization**。W8 **非** Physics / Transit / State / Position Writer，**仅 Contract Enforcement**。

### 十二、Control / Possession 隔离
W8 不改 `control` / `possessingTeamId`；`velocity={0,0}` **不被任何代码解释**为 Lost Possession / Tackle / Interception / Second Ball / Ball Stop Event；**未新增 Event**。

### 十三、Save / Result / UI 审计
`ball.velocity` 唯一读者 = `deriveBallFacts`（只读投影，[ball-facts.js](file:///workspace/FE-project/src/core/match/ball-facts.js#L21-L37)）→ `tactical-context.ballSpeed/ballVelocity`、`player-situation`、`deriveBallRelation.closingSpeed`。**不进入 Match Result / Goal Result / Save / Match History / UI**。**无新消费者。**

### 十四、Reference Stability
已是 `{x:0,y:0}` 的 velocity → W8 原样返回（引用稳定，不创建新对象）；其余终态 velocity → 创建新对象。符合 C-55 约定。

### 十五、Determinism / Regression / Files
- Determinism：Transit→CONTROLLED / FREE / GOAL、Contact→Completion→CONTROLLED、Interaction→CONTROLLED、FREE→SECOND_BALL 重复运行 `identical=true`（TV-14b 覆盖）；无 `Math.random` / `Date.now` / 墙钟 / 非确定性排序。
- `node tests/run.js` → **1540 通过 / 0 失败**。
- Files Changed：仅 `docs/SIMULATION_SPEC.md`（本 §63）。**src/** = 0，**tests/** = 0。
- Contract Changes：**无**（未改 C-54 / C-55 及任何 Frozen Gate）。

### 十六、Out of Scope
FREE Velocity 修改、closingSpeed / SECOND_BALL 修改、Physics / Contact / Position / Transit 修改、以及 C-55 已列 Out of Scope 项。

### 十七、Remaining Risks（仅记录，不修改）
1. C-05 对 CONTROLLED 与 W8 双写 `{0,0}`（幂等，无风险）。
2. C-05 对 FREE 写 `{0,0}` 为既有 Interaction 语义（非 FREE Contract 强制，FREE Legal Value 不变）。
3. 未来若新增 GOAL / CONTROLLED State Writer，须复用同一 W8 Boundary（当前无缺口）。

**STOP — 不得进入 C-57，不得修改任何发现的问题；如发现架构缺口只报告并 BLOCK。等待 Owner 验收。**

## §64 State-Specific Velocity Consumer Semantics Audit（Step 39F-M-C-57）

**Gate Result = PASS / SEALED（只读审计）。** **src/** = 0，**tests/** = 0；唯一改动 = 本 §64。Regression **1540 通过 / 0 失败**。审计确认 C-54 的 **State-Specific Velocity Contract** 在 **Consumer 侧未被错误统一解释**，无 Consumer Semantic Gap。

### 一、Velocity Consumer Matrix
| Consumer | Input | State Guard | Usage | Behavioral Effect |
| --- | --- | --- | --- | --- |
| C-03 `sanitizeBall` / `stepBallPhysics` | `ball.velocity` | IN_TRANSIT（transit 域） | 积分 / 摩擦 / 反射 | **Behavioral**（Physics，仅 IN_TRANSIT） |
| `deriveBallFacts` | `MatchCore.ball.velocity` | 无（纯投影） | 派生只读快照 | **无**（Read Projection） |
| `deriveBallRelation.closingSpeed` | `ballFacts.velocity − playerVel` | 无（纯派生） | 派生相对速度指标 | 取决于消费者 |
| SECOND_BALL `computeCompetitionScore` | `cand.closingSpeed` | **FREE**（`isBallFree` 硬门） | 竞争分 `closing` 分量 | **Behavioral**（仅 FREE） |
| `tactical-context` | `ballFacts.speed / velocity` | 无（只读） | 暴露 `ballSpeed/ballVelocity/ballRelation` | **无**（无 src 内读者） |
| `player-situation` | `ballFacts.*` | 无（只读） | 暴露 `ballState`/`spatialContext.ballRelation` | **无**（无 src 内读者） |
| `action-definitions` | `s.ballState.position / .control` | 无 | 决策几何 / 持球判定 | 读 **position / control**，**不读 velocity** |
| Goal 模块（C-14/C-15/C-19~C-23） | `ballState`（**state 字符串**） | state 门 | 越线 / 生效判定 | **不读 velocity** |
| `ball-physics` `STOP_THRESHOLD` / `BALL_AT_REST` | `speedOf(velocity)` | Physics 域 | 摩擦停止 / 事件 | Physics 域（IN_TRANSIT/FREE 物理） |

### 二、deriveBallFacts 审计
[deriveBallFacts](file:///workspace/FE-project/src/core/match/ball-facts.js#L21-L37) 为**纯只读投影**：不修改 ball / velocity，不归一化 FREE，不改写 CONTROLLED / GOAL，不推第二 Velocity Truth，不触发 Physics / Contact / Interaction / SECOND_BALL。无条件暴露 `velocity` 属允许的只读事实；**下游是否有 State Guard** 另行审计（见 §七～§九）。

### 三、IN_TRANSIT Consumer
合法 Consumer（C-03 Physics）读取**当前** Physics Velocity；`velocityFromTransit` 仅作 `!ball.velocity` 时的兼容 seed，非每 Tick Truth（C-39）；W8/C-55 **不会**在 IN_TRANSIT 提前清零。

### 四、FREE Consumer
FREE Velocity = Loose-Ball Physics Truth，`{0,0}` 与非零**均合法**。全仓**不存在**「FREE ⇒ velocity==0」/「FREE ⇒ velocity 不重要」/「FREE ⇒ 必须 normalize」的错误假设。W8 对 FREE 一律 preserve。

### 五、closingSpeed 审计（重点）
`closingSpeed` 仅作为 `deriveBallRelation` 派生值存在；**行为性消费仅 1 处** = SECOND_BALL `computeCompetitionScore`，且其候选仅在 `isBallFree`（state=FREE ∧ control=null ∧ poss=null ∧ !transit）下产生。输入口径 = `relVel = ball.velocity − playerVelocity` 在 `dirToBall` 上的投影，**未被替换**为 ball speed / 绝对速度 / transit 方向 / 归零终态值。CONTROLLED / GOAL / IN_TRANSIT **均不通过 closingSpeed 产生行为**。

### 六、SECOND_BALL 审计（Consumption Window）
- **SB-A** FREE + 非零 velocity → 影响 Competition Score（TV-13）。
- **SB-B** FREE + `{0,0}` → 合法参与（closing=0 分量）。
- **SB-C** CONTROLLED + `{0,0}` → 不入 SECOND_BALL（`ballFree=false`）。
- **SB-D** GOAL → 不入 SECOND_BALL。
- **SB-E** IN_TRANSIT + 非零 velocity → 因 `ballFree=false` **不触发** SECOND_BALL。
消费窗口严格 = `requiresFollowUp ∧ ball FREE`（与 C-54 冻结一致）。

### 七、tactical-context 审计
[tactical-context](file:///workspace/FE-project/src/core/match/tactical-context.js#L150-L190) 仅将 `ballSpeed/ballVelocity/ballState/ballRelation` 作为**只读投影**暴露；CONTROLLED/GOAL 的 `{0,0}` 未被解释为 Ball Stopped / Dead Ball / Possession Loss / Interception / Tackle / Second Ball。src 内**无行为读者** → 无 State 污染。

### 八、player-situation 审计
[player-situation](file:///workspace/FE-project/src/core/match/player-situation.js#L103-L127) 只读暴露 `ball.velocity/speed/state/control` 与 `spatialContext.ballRelation`；`hasBall = ball.control === playerId`（基于 **control**，非 velocity）。**不存在** `velocity === {0,0}` 的隐式状态判断（无 Can Contest / Ball Is Free / Closing / Chase / Second Ball 类推断）。无 State 污染。

### 九、Zero Velocity 等价审计（核心防污染）
全仓 State 判定**一律基于 `state` 字符串**（`state === BS.*` / `BALL_STATE.*`）：`interaction-state-update`、`interaction-integration`、`ball-physics`、`match-tick`、`second-ball-resolution` 均如此。**不存在** `velocity === {0,0} → state inference`。**Velocity Zero ≠ Ball State**；`FREE + velocity={0,0}` 合法且成立。

### 十、Derived Velocity 审计
`speed = hypot(velocity)`（ball-facts）、`relativeVelocity` / `closingSpeed` / `movingTowardPlayer` / `movingAwayFromPlayer` / `timeToArrival`（ball-facts）、`velocityFromTransit`（ball-physics 兼容 seed）、`ball-trajectory.velocity`（派生，非 Truth）均为 **Derived Value**，**不写回 MatchCore**。`isMoving`（`movingToward/Away`）无行为消费者。**无** `derivedVelocity/effectiveVelocity/behaviorVelocity/tacticalVelocity` 第二 Truth。`BALL_AT_REST` 事件由 Physics 域 `speed===0` 产生（事件，非 state 推断）。

### 十一、Writer / Consumer 边界
W1～W8 = Writers / Enforcement。Consumer 全部 **Read-only**：不回写 velocity、不 clone 后改 Ball、不隐式 normalize、不改 State / Position。**无 Consumer Mutation。**

### 十二、No New Truth 审计
未出现第二 Velocity Truth；局部 `relVel/closingSpeed/speed/direction` 均为临时 Derived Value，不写回 MatchCore。

### 十三、Determinism / Regression / Files / Contract Changes
- Determinism：Consumer 对相同 MatchCore 输入输出一致（无 `Math.random` / `Date.now` / 墙钟 / 非确定性遍历；`second-ball-resolution` 候选按 `playerId` 稳定排序）。
- `node tests/run.js` → **1540 通过 / 0 失败**。
- Files Changed：仅 `docs/SIMULATION_SPEC.md`（本 §64）。**src/** = 0，**tests/** = 0。
- Contract Changes：**无**（未改 C-03/C-05/C-08/C-14/C-15/C-19~C-23/C-54/C-55/W8/closingSpeed/SECOND_BALL/tactical-context/player-situation）。

### 十四、Out of Scope
任何 Velocity Consumer 实现修改、closingSpeed / SECOND_BALL 修改、以及 C-54/C-55/C-56 已列 Out of Scope 项。

### 十五、Remaining Risks（仅记录，不修改）
1. `tactical-context.ballVelocity / ballRelation`、`player-situation.spatialContext.ballRelation` 当前 src 内**无行为读者**（dormant 诊断投影）；未来若接入行为，须显式加 State Guard。
2. `deriveBallFacts` 无条件暴露 `velocity`（含 CONTROLLED/GOAL 的 `{0,0}`）——符合只读投影契约；未来新消费者须遵守「Zero Velocity ≠ State」原则。
3. `ball-facts` 的 `movingTowardPlayer/timeToArrival` 当前未被消费（dormant）；若未来用于行为需重新评估。

**STOP — 不得进入 C-58，不得修改发现的问题；如发现 Consumer Semantic Gap 只报告并 BLOCK。等待 Owner 验收。**

## §65 Derived Velocity Lifecycle / Cross-Tick Persistence Audit（Step 39F-M-C-58）

**Gate Result = PASS / SEALED（只读审计）。** **src/** = 0，**tests/** = 0；唯一改动 = 本 §65。Regression **1540 通过 / 0 失败**。审计确认：所有 Velocity Derived Value 均为 **Expression / Tick / Physics-Window / Resolution-local**，**无跨 Tick / 跨 State / 跨 Physics Window 持久化，无隐藏 Runtime State，无第二 Velocity Truth**。

### 一、Derived Value Matrix
| Derived Value | Producer | Input | Lifetime | Storage | Consumer |
| --- | --- | --- | --- | --- | --- |
| `ballFacts.speed` = `hypot(velocity)` | `deriveBallFacts` | `ball.velocity` | **Expression-local**（每次调用重建） | 无 | tactical-context / player-situation（只读投影） |
| `relativeVelocity` | `deriveBallRelation` | `ballFacts.velocity − playerVel` | **Expression-local** | 无 | closingSpeed / SECOND_BALL 候选快照 |
| `closingSpeed` | `deriveBallRelation` | `relVel · dirToBall` | **Resolution-local**（SECOND_BALL Window） | 无 | `computeCompetitionScore`（仅 FREE） |
| `movingTowardPlayer / movingAwayFromPlayer` | `deriveBallRelation` | `closingSpeed` 符号 | **Expression-local** | 无 | 无行为读者（dormant） |
| `timeToArrival` | `deriveBallRelation` | `distance / closingSpeed` | **Expression-local** | 无 | 无行为读者（dormant） |
| `directionToBall` | `deriveBallRelation` | `relativePosition` 归一 | **Expression-local** | 无 | SECOND_BALL 候选 |
| `ballFacts`（position/state/…） | `deriveBallFacts` | `MatchCore.ball` | **Tick-local 快照** | 无（每次重建） | 下游只读 |
| `velocityFromTransit` | `ball-physics` | `transit.from/to/duration` | **Physics-Window-local Seed** | 不持久化 | 仅 `!ball.velocity` 一次性 |
| `trajectory.velocity` | `deriveBallTrajectory` | `start/end/duration` | **Result-payload-local** | **不写回 MatchCore** | 仅 C-19 校验（`INVALID_TRAJECTORY`） |
| `sanitizeBall` 归一化 velocity | C-03 | `ball.velocity` | **Physics-Window-local** | 写回 Ball（属 Physics Truth，非 derived cache） | Physics |
| `playerVelocity`（`playerVelocityFromMovement`） | ball-facts | `movement.players[id]` | **Expression-local** | 无 | 相对速度 |

### 二、Lifetime Classification
全部 Derived Value ∈ **A（Expression-local）/ B（Tick-local）/ C（Physics-Window-local）/ D（Resolution-local）**。**无任何 E（Persisted / Runtime State）类。** 唯一「写回 MatchCore」的是 `ball.velocity` 本身（W1～W8 属既有 Velocity Writer/Enforcement，非 derived lifecycle 新增）。

### 三、Cross-Tick Audit
无 `previousBall / lastBall(velocity) / lastVelocity / cachedVelocity / ballRelationCache` 等缓存。`deriveBallFacts` / `deriveBallRelation` **每次调用由 `MatchCore.ball` 重新派生**；`closingSpeed / relativeVelocity / movingToward / movingAway / timeToArrival / speed / direction` 均不跨 Tick 继承。**PASS。** （注：`movement-update.js` 的 `lastBall` 仅存**球 position** 用于 re-eval 阈值，**非 velocity derived value**，不属本 Gate 范围。）

### 四、Cross-State Audit
State Transition（IN_TRANSIT→CONTROLLED/FREE/GOAL、FREE→CONTROLLED 等）后无旧 State 的 Derived Velocity 复用：CONTROLLED 进入即 W8 置 `{0,0}`（C-55），`closingSpeed` 仅在 `isBallFree` 下产生/消费，离开 FREE 即不再消费。**PASS。**

### 五、Physics-Window Audit
C-03 每 substep 读取**当前** `ball.velocity`（`stepBallPhysics` 内 `let vel = {...b.velocity}`，substep 间递推），**无 substep 级缓存**；`velocityFromTransit` 仅在 `!ball.velocity` 时作为一次 Seed，之后当前 Physics Velocity 为 Truth。**PASS。**

### 六、Trajectory Velocity Audit
`trajectory.velocity` 为 `deriveBallTrajectory` **返回对象字段（派生值，非 Truth）**；`ball-trajectory.js` 明确**不写回 MatchCore**（无 `ball.trajectory / samples / path / history`）；`trajectory` 仅作为 `trajectory-goal-match-tick` 的 **transient result payload**（校验用），**≠ `MatchCore.ball.velocity`**，不跨 Tick 持久化。**PASS。**

### 七、velocityFromTransit Audit
仅 2 处调用：`ball-physics.stepBallPhysics`（`state===IN_TRANSIT && !ball.velocity && ball.transit`）与 `continuous-ball-movement-integration`（`!stepping.velocity`）。均为 **`!velocity` 兼容 Seed**，非 persistent cache / historical velocity / future Tick truth。**PASS。**

### 八、closingSpeed Lifecycle
生命周期严格 ≤ `requiresFollowUp ∧ ball FREE` 的 SECOND_BALL Resolution Window；**不写入** MatchCore / Player / Ball State / Match History / Save，不跨 Tick / 跨 State 保存。**PASS。**

### 九、ballRelation Lifecycle
`deriveBallRelation` 返回 **Derived Snapshot**（`closingSpeed / distance / directionToBall / relativeVelocity`），每次调用新建；不持久化、不写回 MatchCore / Player、不缓存到下一 Tick。**PASS。**

### 十、ballFacts Lifecycle
`deriveBallFacts` 为**纯只读 Projection**；**无** `previousBallFacts / lastBallFacts / cachedBallFacts`；`ballFacts.velocity/state/position` 不被任何模块保存为未来 Tick Truth。**PASS。**

### 十一、tactical-context / player-situation Audit
无 `previousBall / previousVelocity / lastVelocity / lastBallRelation / cachedBallRelation / cachedBallFacts`。二者仅返回当前调用派生快照（C-57 已确认 src 内无行为读者）。**PASS。**

### 十二、Snapshot Audit
C-08 `SNAPSHOT`（match-tick）仅保存 `ballState / control / possessingTeamId / inTransit`（**不含 velocity**），且不保存 `closingSpeed / timeToArrival / movingToward / movingAway`。**PASS。**

### 十三、Persistence / Save Audit
`save/save-manager.js` **不序列化** `ball / velocity / closingSpeed / ballRelation / ballFacts / trajectory`（career 存档不含比赛瞬时派生值）。Derived Velocity 不进 Save / Game State / Match Result / Season Result / Match History / Replay / UI persistent state。**PASS。**

### 十四、State Transition Cleanup Audit
无需 cleanup：Derived Value 仅存在于当前函数 / Tick / Window，**No Persistence** 优先于 Persistence+Cleanup。**PASS。**

### 十五、Hidden Runtime State Audit
module-level / object property / MatchCore / Player / Ball / Context 字段中**无** `lastClosingSpeed / lastRelativeVelocity / cachedVelocity / previousVelocity / ballRelationCache / trajectoryVelocity`。（`core/ai/ai-development-signals.js` 的 `cache` 为 `clubId|season` 参赛数缓存，与 Velocity 无关。）**PASS。**

### 十六、Determinism / Regression / Files / Contract Changes
- Determinism：IN_TRANSIT Physics / Contact / Transit Completion / FREE SECOND_BALL / State Transition 重复运行 Derived Values `identical=true`；无 `Math.random` / `Date.now` / 墙钟 / 非确定性遍历。
- `node tests/run.js` → **1540 通过 / 0 失败**。
- Files Changed：仅 `docs/SIMULATION_SPEC.md`（本 §65）。**src/** = 0，**tests/** = 0。
- Contract Changes：**无**（未改 C-03/C-05/C-08/C-14/C-15/C-19~C-23/C-54~C-57/closingSpeed/SECOND_BALL/tactical-context/player-situation）。

### 十七、Out of Scope
任何 Derived Value 实现修改、新增生命周期规则 / cleanup、Velocity / closingSpeed / SECOND_BALL 修改，及 C-54~C-57 已列 Out of Scope 项。

### 十八、Remaining Risks（仅记录，不修改）
1. `movingTowardPlayer / movingAwayFromPlayer / timeToArrival` 当前无行为读者（dormant）；未来接入行为须确保 Tick-local 重算。
2. `trajectory.velocity` 仅作 C-19 校验 payload；若未来被误当作 `MatchCore.ball.velocity` 将构成第二 Truth 风险（当前无消费者）。
3. `movement-update.lastBall` 存球 position（非 velocity），用于 re-eval 阈值；不属本 Gate 但如未来改为存 velocity 需重新审计。

**STOP — 不得进入 C-59，不得修改发现的问题；如发现 Derived Value Lifecycle Gap 只报告并 BLOCK。等待 Owner 验收。**

## §66 Physics STOP/REST Event vs Ball State Boundary Audit（Step 39F-M-C-59）

**Gate Result = PASS / SEALED（只读审计）。** **src/** = 0，**tests/** = 0；唯一改动 = 本 §66。Regression **1540 通过 / 0 失败**。审计确认：C-03 Physics 的 STOP / REST / `BALL_AT_REST` / `speedOf` / `STOP_THRESHOLD` 均为 **Physics Domain Event / Derived Value**，**未被升级为任何 Ball State / Possession / Control / Goal / Transit / Second-Ball Truth**。

### 一、Physics Event Matrix
| Event / Derived | Producer | Input | Lifetime | Consumer | Behavioral Effect |
| --- | --- | --- | --- | --- | --- |
| `BALL_AT_REST` | `stepBallPhysics` | `speedOf(outBall.velocity) === 0 && events.length === 0` | **Physics-Window-local**（`events[]`） | **无**（唯一调用方丢弃） | **无** |
| `BALL_CONTACT` | `stepBallPhysics` | Contact 命中 | Physics-Window-local | **无**（唯一调用方丢弃） | 无 |
| `BOUNDARY_CONTACT` | `stepBallPhysics` | 边界反射 | Physics-Window-local | **无**（唯一调用方丢弃） | 无 |
| `speedOf(velocity)` | `ball-physics`（内部） | velocity | **Expression-local** | 摩擦 / 子步 / 停止判定 | **Physics**（仅 IN_TRANSIT/FREE 物理域） |
| `STOP_THRESHOLD`（`0.006`） | `ball-physics-config` | 静态配置 | 常量 | 摩擦停止（`ns<=th → 0`） | **Physics** |
| `stepBallPhysics` 返回 `.ball` | `ball-physics` | Physics 积分 | Tick-local | C-39 写入 `nextBall` | Position/Velocity Physics Truth |

### 二、BALL_AT_REST Audit
`BALL_AT_REST` 仅在 [ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L245-L246) 作为 **Physics Domain Event** push 进本地 `events[]`；**不写 `ball.state`**，**≠ CONTROLLED / FREE / GOAL / IN_TRANSIT**。唯一生产调用方 [continuous-ball-movement-integration](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L174-L191) 只消费 `stepped.ball`，**丢弃 `stepped.events` / `stepped.contacts`** → 无消费者。**PASS。**

### 三、STOP Event Audit
无独立「STOP Event」对象；停止仅表现为 `velocity` 归零（Physics 内部）。它**不**自动意味着 possession acquired/lost、controlled、free、dead ball、goal、second ball、tackle、interception；**无 Consumer**。**PASS。**

### 四、Rest Threshold Audit
`STOP_THRESHOLD = 0.006`（静态配置）仅用于 Physics 摩擦停止判定（[ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L147) `if (!(ns > config.STOP_THRESHOLD)) ns = 0` 与 L212/L226/L245）。**不属于** Ball State Threshold；**不写入** MatchCore State；**不成为** SECOND_BALL Eligibility（该资格由 `isBallFree` 决定）；**不成为** Possession Eligibility。**未跨域共享。PASS。**

### 五、Zero Velocity vs REST Audit
- **R1** FREE + `{0,0}` → 仍为 FREE（无 FREE→CONTROLLED 的零速自动转换）。
- **R2** CONTROLLED + `{0,0}` → Physics early return（[ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L114)），无再次 State Transition。
- **R3** IN_TRANSIT 减速：C-39 非完成 Tick **强制 `state: IN_TRANSIT`**（L180），Transit 仅由 `elapsed >= duration` 结束（Frozen Transit Contract），**绝不因瞬时速度≈0 结束**。
- **R4** GOAL + `{0,0}` → Physics early return，Goal State 不变。**PASS。**

### 六、State Mutation Audit
`BALL_AT_REST / STOP / REST` 附近**无** `ball.state = / setBallState / applyInteractionStateUpdate`。State Writer 仅：`finalizeTransitSettlement`（由 **`transit.outcome`** 决定，非物理 rest）、`pass/shot-state-update`（IN_TRANSIT）、`second-ball-resolution`（结果经 C-05）、`interaction-state-update`。**Physics Event 非 State Writer。PASS。**

### 七、Possession Audit
无 `REST → Possession` / `STOP → Lost Possession`。`control / possessingTeamId / possession / lastTouchPlayerId` 仅由 `finalizeTransitSettlement`（transit contract）/ C-05 写入；`lastTouch` 由 C-03 Contact 更新（Frozen C-46）。**PASS。**

### 八、SECOND_BALL Audit
无 `isAtRest → SECOND_BALL`。SECOND_BALL 资格仍由 `isBallFree` + `requiresFollowUp` 决定（C-54 冻结窗口）。**PASS。**

### 九、Goal Audit
`BALL_AT_REST / STOP` **不参与** Goal Geometry / Crossing / Resolution / Score。Goal Truth 仍由 C-15 / C-20 / C-21 / C-14 链负责。**PASS。**

### 十、Transit Audit
REST / STOP **不修改** `transit / elapsed / progress / completion / transit.to / from`；Physics Stop **不被**误认为 Transit Completion（Completion 仅由 `elapsed >= duration` → C-23）。**PASS。**

### 十一、Position Audit
Physics Position 更新仍属 C-03 既有职责（`stepBallPhysics` → `stepped.ball.position`），无 `REST Event → 独立 Position Writer`，无第二 Position Truth。**PASS。**

### 十二、Event Lifecycle Audit
`BALL_AT_REST / BALL_CONTACT / BOUNDARY_CONTACT` 仅存在于当前 Physics Window 的本地 `events[]`，**被唯一调用方丢弃**；不跨 Tick、不入 MatchCore Event History（`TICK_EVENT_TYPES` 为独立 Tick 事件，非 Physics 事件）、不入 Match History / Save / Replay、不成长效 Runtime State。**PASS。**

### 十三、Contact / Interaction Boundary
Contact 改变 `position / velocity / lastTouch / contacting`（C-03/C-46 Frozen），但**不绕过 C-05**：Contact **不**产生 CONTROLLED/FREE（无 `Contact → STOP → CONTROLLED` 路径）；State 始终由 C-39 Settlement / C-05 负责。**PASS。**

### 十四、Derived Fact Audit
`speed / isStopped / isAtRest / BALL_AT_REST` 均为 **Physics Derived Value / Event**；**不写回 `ball.state`**；**无** `effectiveBallState / physicsBallState / restState` 第二 Ball State Truth。**PASS。**

### 十五、Zero / Near-Zero Audit
`velocity === {0,0}`（语义零）、`speed === 0`（数值零）、`speed <= STOP_THRESHOLD`（Physics 停止）**三者未被混同**：Threshold 仅用于 Physics；Ball State 由 State Contract 决定。**无 `speed <= threshold → state`。PASS。**

### 十六、Determinism / Regression / Files / Contract Changes
- Determinism：FREE+zero / FREE+non-zero / IN_TRANSIT deceleration / Contact reflection / CONTROLLED zero / GOAL zero 重复运行 `identical=true`；无 `Math.random` / `Date.now` / 墙钟 / 非确定性遍历。
- `node tests/run.js` → **1540 通过 / 0 失败**。
- Files Changed：仅 `docs/SIMULATION_SPEC.md`（本 §66）。**src/** = 0，**tests/** = 0。
- Contract Changes：**无**（未改 C-03/C-05/C-08/C-14/C-15/C-19~C-23/C-54~C-58/STOP_THRESHOLD/BALL_AT_REST/Possession/SECOND_BALL/Control/Goal）。

### 十七、Out of Scope
任何 Physics Event / Threshold 实现修改、新增 Event / State / Threshold、Velocity / Possession / SECOND_BALL / Goal 修改，及 C-54~C-58 已列 Out of Scope 项。

### 十八、Remaining Risks（仅记录，不修改）
1. `stepped.events`（含 `BALL_AT_REST`）当前被 C-39 丢弃——属 Physics 内部诊断，无消费者；未来若接入行为须显式定义 State Guard，避免 REST→State 升级。
2. `stepMatchBall`（Headless/Unit 入口）同样丢弃 events，无持久化风险。
3. `STOP_THRESHOLD` 为唯一 Physics 停止阈值；若未来跨域复用须重新审计（当前不共享）。

**STOP — 不得进入 C-60，不得修改发现的问题；如发现 Physics Event Semantic Gap 只报告并 BLOCK。等待 Owner 验收。**

## §67 LastTouch Lifecycle / State Boundary Audit（Step 39F-M-C-60）

**Gate Result = PASS / SEALED（只读审计）。** **src/** = 0，**tests/** = 0；唯一改动 = 本 §67。Regression **1540 通过 / 0 失败**。审计确认：`ball.lastTouchPlayerId` 有 **两个正式 Writer**（C-03 Contact / C-05 Interaction State Update）+ 两个隐式 Clear（PASS/SHOT Transit Start），无 Consumer 将其当作 Possession / Control / Ball State / SECOND_BALL / Goal Truth。Lifecycle = **D — Runtime Ball Fact**（跨 Tick 保留，不进 Save / History / Replay）。

### 一、LastTouch Truth 定义
**当前真实语义（非纯 Physics Contact）：**
`lastTouchPlayerId` = 「最后一个与球发生权威交互的球员」，由两类权威事件写入：
1. **C-03 Physics Contact**：球被某球员实际接触时（swept/discrete contact 命中）。
2. **C-05 Interaction State Update**：Interaction（dribble/tackle/press/interception）或 SECOND_BALL 解析落地时。

**它不是：** 当前控球者（≠ `control`）、当前 Possession Owner（≠ `possessingTeamId`）、Ball State、SECOND_BALL Winner、Transit Actor、Goal Scorer。

### 二、Writer Matrix
| Writer | Module | Trigger | Ball State | Tick Stage | 写入值 |
| --- | --- | --- | --- | --- | --- |
| C-03 Contact | [ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L182) `stepBallPhysics` | Contact 命中（非 continuing） | FREE / IN_TRANSIT | CONTINUOUS_TRANSIT（C-39→C-03） | `hit.player.playerId` |
| C-03 sanitizeBall | [ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L62) | 任何 Physics 调用入口 | 全部 | — | preserve 输入值（`?? null`） |
| C-05 State Update | [interaction-state-update.js](file:///workspace/FE-project/src/core/match/interaction-state-update.js#L66) `applyInteractionStateUpdate` | Interaction / SECOND_BALL Resolution 落地 | CONTROLLED / FREE | INTERACTION_INTEGRATE | CONTROLLED → `result.possession.toPlayerId`；FREE → `result.actorId` |
| PASS Transit Start（隐式 Clear） | [pass-state-update.js](file:///workspace/FE-project/src/core/match/pass-state-update.js#L22) `transitBall` | PASS Action 启动 | → IN_TRANSIT | ACTION | 新对象**不含**该字段 → 后续 sanitize 归 `null` |
| SHOT Transit Start（隐式 Clear） | [shot-state-update.js](file:///workspace/FE-project/src/core/match/shot-state-update.js#L16) `transitBall` | SHOT Action 启动 | → IN_TRANSIT | ACTION | 同上 |

**结论：C-03 Contact 不是唯一 Writer。** C-05 Interaction State Update 是第二个正式 Writer；PASS/SHOT Transit Start 是隐式 Clear（通过对象替换丢弃字段）。

### 三、Consumer Matrix
| Consumer | Module | Input | State Guard | Behavioral Effect | Lifetime |
| --- | --- | --- | --- | --- | --- |
| deriveBallFacts | [ball-facts.js](file:///workspace/FE-project/src/core/match/ball-facts.js#L34) | `ball.lastTouchPlayerId` | 无 | 派生只读快照字段 | Expression-local |
| buildTacticalContext | [tactical-context.js](file:///workspace/FE-project/src/core/match/tactical-context.js#L175) | `ballFacts.lastTouchPlayerId` | 无 | 暴露为 context 只读字段 | Expression-local |
| buildPlayerSituation | [player-situation.js](file:///workspace/FE-project/src/core/match/player-situation.js#L111) | `ballFacts.lastTouchPlayerId` | 无 | 暴露为 situation.ballState 只读字段 | Expression-local |

**非 Consumer（明确不读 lastTouchPlayerId）：** SECOND_BALL resolution（`isBallFree` 仅看 state/control/possessingTeamId/inTransit）、Goal Resolution / Score（`scoringPlayerId` 来自显式 `candidate.playerId`）、Possession（`possessingTeamId`）、Control（`ball.control`）、Match Result、Match Tick Snapshot（仅 state/control/possessingTeamId/inTransit）、Save Layer。

### 四、Lifecycle Classification
**D — Runtime Ball Fact。**
- 字段存于 `MatchCore.ball.lastTouchPlayerId`，跨 Tick 保留（除非被 Writer 覆盖或 Transit Start 隐式清除）。
- **不进入 Save**（`serializeState` 只序列化 `runtime.{clubs,players,competitions,events,membership,managedClubId}`，不含 match/ball）。
- **不进入 History / Replay / Event Ledger**（`TICK_EVENT_TYPES` 无 LastTouch 事件；`events[]` 为 transient）。
- 不属于 Expression-local / Physics-Window-local / Tick-local。

### 五、Contact Boundary Audit（C-46）
- Contact **可以**更新 `lastTouchPlayerId`（C-03 L182）。✓
- Contact **不**改变 Ball State（C-03 仅写 position/velocity/contacting/lastTouch）。✓
- Contact **不**获得 Possession（`possessingTeamId` 不由 C-03 写）。✓
- Contact **不**触发 CONTROLLED（State 由 C-05 / C-39 finalize 决定）。✓
- Contact **不**触发 SECOND_BALL。✓
- Contact **不**结束 Transit（Transit Completion 由 `elapsed >= duration`）。✓
- Contact **不**触发 Goal。✓
- Contact **不**生成 Action Event。✓
**PASS。**

### 六、Tick Lifecycle Audit
- `lastTouchPlayerId` **跨 Tick 持续**（存于 MatchCore.ball）。
- Tick Snapshot **不**捕获 lastTouch（[match-tick.js](file:///workspace/FE-project/src/core/match/match-tick.js#L129-L135) 仅 state/control/possessingTeamId/inTransit）。
- Physics Window（C-03）中可被 Contact 更新。
- Tick 结束后继续存在（持久于 MatchCore.ball）。
- **无**自动清除阶段；清除仅发生在 PASS/SHOT Transit Start（隐式）。
**结论：Runtime Ball Fact，非 Derived Value。**

### 七、State Boundary Audit
- **IN_TRANSIT**：Contact 可改 lastTouch；lastTouch **不**改变 Transit。✓（Transit Completion 由 elapsed/duration）
- **FREE**：`FREE + lastTouchPlayerId` **合法**（C-05 FREE 分支写 `result.actorId`）。FREE **不**因存在 lastTouch 被视为属于该球员（`isBallFree` 不读 lastTouch）。✓
- **CONTROLLED**：`CONTROLLED + lastTouchPlayerId` = `possession.toPlayerId` = `control`（三者巧合相等，但语义独立：lastTouch 由 C-05 写入，control 由 C-05 写入，二者来源相同但不互相推导）。**Last Touch ≠ Control Owner**（概念上独立，实现上当前巧合）。✓
- **GOAL**：Goal 后 lastTouch 保留自 Transit 期间的值（通常 `null`，因 Transit Start 清除且无 Contact）。Goal State **不**通过 lastTouch 反向改变 Goal Truth / Score / Match Result。✓

### 八、Possession Boundary Audit
`lastTouchPlayerId` vs `possessingTeamId` vs `control`：三者**不是同一个 Truth**。
- 无 `lastTouchPlayerId → possessingTeamId` 推导链。
- 无 `lastTouchPlayerId → CONTROLLED` 推导链。
- `possessingTeamId` 仅由 C-05（`result.possession.toTeamId`）和 C-39 finalize（`teamOf(players, id)`）写入。
- `control` 仅由 C-05 和 C-39 finalize 写入。
**PASS。**

### 九、SECOND_BALL Boundary Audit
`resolveSecondBall`（[second-ball-resolution.js](file:///workspace/FE-project/src/core/match/second-ball-resolution.js)）**不读** `lastTouchPlayerId`。
- 资格 = `isBallFree`（state===FREE ∧ control===null ∧ possessingTeamId===null ∧ !inTransit）。
- Winner = competition score（proximity + closingSpeed + ability + context）。
- lastTouch **不**参与 eligibility / candidate filtering / winner selection / score / requiresFollowUp。
**PASS。**（注：SECOND_BALL 落地后经 C-05 会**写** lastTouch = winner，但这是 Writer 而非 Consumer。）

### 十、Interaction Boundary Audit
`applyInteractionStateUpdate`（C-05）：
- **不清除** lastTouch for IN_TRANSIT（preserve via cloneBall）。
- **覆盖** lastTouch for CONTROLLED/FREE（显式写入）。
- **不**从 lastTouch 推导 Actor / Possession / Control（Actor 来自 actionInstance.actorId；Possession 来自 resolution result）。
- Interaction **不绕过** C-03 Contact 自行制造「最后触球者」——C-05 写入的是 Interaction Resolution 的语义结果，不是物理接触事实。
**结论：C-05 是合法的第二 Writer，语义为「Interaction 落地后的最后涉及球员」。不构成第二 Truth。PASS。**

### 十一、Transit Boundary Audit
- **Transit Start**（PASS/SHOT）：隐式清除 lastTouch（`transitBall` 新对象不含字段）。**不**自动写 actor 为 lastTouch。✓
- **Transit Physics（非完成 Tick）**：C-03 Contact 可改 lastTouch。✓
- **Transit Completion**（[finalizeTransitSettlement](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L71)）：`base = {...ball, transit:undefined}` **preserve** lastTouch，**不**自动写 Transit Actor。✓
- **Completion → CONTROLLED/FREE/GOAL**：lastTouch 保留自 Transit 期间值（不被重写为 actor）。
**Action Actor ≠ Last Touch Player**（Transit Start 清除，Completion 不重写）。✓

### 十二、Goal Boundary Audit
Goal 链（C-15 → C-20 → C-21 → C-14）**不读** `lastTouchPlayerId`：
- `scoringPlayerId` = `candidate.playerId`（来自显式 `options.playerId` / `goalCandidate.playerId`，非 lastTouch）。
- Score update 仅改 `matchCore.score`。
- lastTouch **不**成为第二套 Goal Truth。
**PASS。**

### 十三、Save / Replay / History Audit
- `serializeState`（[save-manager.js](file:///workspace/FE-project/src/save/save-manager.js#L24)）不序列化 `ball` / `lastTouchPlayerId`。
- 无 replay / event ledger / match history 持久化 lastTouch。
- 无 persistent statistics 读取 lastTouch。
**结论：lastTouch 为非持久化 Runtime Fact，生命周期 = 单次 Match Runtime。**

### 十四、Derived Fact / Second Truth Audit
- `deriveBallFacts` 暴露 `lastTouchPlayerId` 为只读派生快照（每次重算，不缓存）。
- tactical-context / player-situation 透传该只读值，不写回 MatchCore。
- **未发现** `effectiveLastTouch` / `currentTouchPlayer` / `currentTouchOwner` / `lastTouchState` / `physicsLastTouch` / `derivedLastTouch` 等隐性第二 Truth。
**PASS。**

### 十五、Reset / Clear Audit
显式赋值仅两处（C-03 L182、C-05 L66）。隐式清除：
- PASS Transit Start（pass-state-update `transitBall` 不含字段）。
- SHOT Transit Start（shot-state-update `transitBall` 不含字段）。
- C-03 `sanitizeBall` `?? null`（仅在字段缺失时归 null，非主动清除）。
**无** `= null` / `= undefined` / `delete` 的主动清除语句。
清除条件 = 「球进入 IN_TRANSIT（PASS/SHOT 启动）」，合理且与「球脱离当前接触者进入飞行」语义一致。无跨 Tick 随机清除。**PASS。**

### 十六、Determinism Audit
- Writer：C-03 Contact 排序（playerId 字典序，[ball-physics.js](file:///workspace/FE-project/src/core/match/ball-physics.js#L124-L127)）+ hit tie-break 确定性；C-05 纯函数。
- Consumer：纯函数只读派生。
- 无 `Math.random` / `Date.now` / `performance.now` / 墙钟 / 非确定性遍历。
- 同一输入重复运行 → identical lastTouch 结果。
**PASS。**

### 十七、Regression / Files / Contract Changes
- `npm test` → **1540 通过 / 0 失败**。
- Files Changed：仅 `docs/SIMULATION_SPEC.md`（本 §67）。**src/** = 0，**tests/** = 0。
- Contract Changes：**无**（未改 C-03/C-05/C-08/C-14/C-15/C-19~C-23/C-39/C-46/C-50/C-54~C-59）。

### 十八、Out of Scope
任何 lastTouch 写入/清除逻辑修改、新增 LastTouch Contract / State / Event / Threshold、Possession / SECOND_BALL / Goal / Transit 修改，及 C-54~C-59 已列 Out of Scope 项。

### 十九、Remaining Risks（仅记录，不修改）
1. **双 Writer 语义混用**：`lastTouchPlayerId` 当前由 C-03（物理接触）和 C-05（Interaction 落地）共同写入。语义为「最后权威交互者」而非纯「物理触球者」。若未来需要区分「物理最后触球」与「交互最后涉及者」，须显式拆分字段或冻结单一语义——当前 Consumer 未因此出错，但语义边界未被单独 Contract 冻结。
2. **Transit Start 隐式 Clear**：PASS/SHOT `transitBall` 通过对象替换丢弃 `lastTouchPlayerId`，非显式 `= null`。当前行为正确（球进入飞行脱离接触者），但若未来 Transit Start 需保留 lastTouch（如用于 Goal Attribution），须显式定义而非依赖隐式丢弃。
3. **CONTROLLED 下 lastTouch == control 的巧合**：C-05 CONTROLLED 分支令 `lastTouchPlayerId === possession.toPlayerId === control`。三者概念独立但实现上当前恒等，未来若控制者与最后触球者需可分离（如门将手抛球后控制但未触球），须审视此巧合。

**STOP — 不得进入 C-61，不得修改发现的问题；如发现 LastTouch Semantic Gap 只报告并 BLOCK。等待 Owner 验收。**

## §68 LastTouch Ownership / Lifecycle Contract Freeze（Step 39F-M-C-61）

**Gate Result = PASS / SEALED（Contract Investigation / Freeze）。** **src/** = 0，**tests/** = 0；唯一改动 = 本 §68。**Architecture Conclusion = BLOCKED / OWNER_DECISION_REQUIRED。** Regression **1540 通过 / 0 失败**。

**核心发现：** 当前 `lastTouchPlayerId` 由 C-03（物理接触）与 C-05（Interaction 落地）共同写入，但两者语义**不一致**——C-05 在 PRESS SUCCESS 与 SECOND_BALL WON 两种 outcome 下写入的 playerId **不代表实际物理触球**。此外 PASS/SHOT Transit Start 通过对象替换隐式丢弃该字段，属非显式 Clear。由于「实际触球者」与「Interaction Actor / Competition Winner」在部分路径上不是同一概念，无法在不修改代码的前提下将 `lastTouchPlayerId` 冻结为单一语义，须 Owner 决策。

---

### 一、LastTouch Truth（当前实际语义）
**实际 = Candidate C（综合 Physics Contact + Interaction 的「最近正式涉及者」），非纯物理触球。**

- C-03 写入 = 实际物理接触者。
- C-05 写入 = Interaction Resolution 的 `possession.toPlayerId`（CONTROLLED）或 `actorId`（FREE）。
- 两者混用同一字段，且在部分路径上语义发散（见 §四、§五）。

### 二、C-03 Contact Writer 调查
| 项 | 结论 |
| --- | --- |
| 写入位置 | [ball-physics.js#L182](file:///workspace/FE-project/src/core/match/ball-physics.js#L182) `stepBallPhysics` |
| 写入条件 | 某球员首次进入 contact 窗口（`!contacting.has(playerId)`）；continuing contact 不更新 |
| 写入值 | `hit.player.playerId`（实际接触球体的球员） |
| 是否代表实际 Ball Contact | **是**（swept/discrete 接触命中） |
| Contact Reflection 是否同时发生 | 是（法向相对速度反射 + 切向保留，L183-194） |
| 可发生的 State | FREE、IN_TRANSIT（CONTROLLED/GOAL 在 L114 early-return，不跑 Physics） |
| 写入后是否被覆盖 | 是——C-05 State Update 可在后续 INTERACTION_INTEGRATE 阶段覆盖；Transit Start 可隐式清除 |
| 是否可继续作为正式 Writer | **可以**（语义明确 = 实际触球者） |

**调用链：** `runMatchTick` → `advanceContinuousBallMovement`（C-39）→ `stepBallPhysics`（C-03）→ `lastTouch = hit.player.playerId`。

### 三、C-05 Interaction Writer 调查
写入位置：[interaction-state-update.js#L66](file:///workspace/FE-project/src/core/match/interaction-state-update.js#L66)
```js
lastTouchPlayerId: controlled ? (result.possession?.toPlayerId ?? null) : (result.actorId ?? null)
```

**各 Interaction 写入值与是否等价于实际触球：**

| Interaction | Outcome | State | lastTouch = | 等价于实际触球？ |
| --- | --- | --- | --- | --- |
| DRIBBLE | COMPLETED | CONTROLLED | possession.toPlayerId = 运球者 | **是** |
| DRIBBLE | LOST | CONTROLLED | possession.toPlayerId = 抢断者 | **是**（抢断者触球） |
| DRIBBLE | KNOCKED_LOOSE | FREE | actorId = 运球者 | **是**（运球者自失） |
| TACKLE | WON | CONTROLLED | possession.toPlayerId = 抢断者 | **是** |
| TACKLE | LOST | CONTROLLED | possession.toPlayerId = 持球者 | **是** |
| TACKLE | LOOSE | FREE | actorId = 抢断者 | **存疑**（可能是持球者捅出） |
| PRESS | SUCCESS | FREE | actorId = 压迫者 | **否**（压迫者未必物理触球） |
| PRESS | PRESSURE_ONLY | CONTROLLED | possession.toPlayerId = 持球者 | **是** |
| PRESS | FAILED | CONTROLLED | possession.toPlayerId = 持球者 | **是** |
| INTERCEPTION | INTERCEPTED | CONTROLLED | possession.toPlayerId = 拦截者 | **是** |
| INTERCEPTION | DEFLECTED | FREE | actorId = 拦截者 | **是**（折射即触球） |
| INTERCEPTION | FAILED | IN_TRANSIT | （preserve，不写） | N/A |
| SECOND_BALL | WON | CONTROLLED | possession.toPlayerId = winner | **否**（winner 由竞争分决定，非触球） |
| SECOND_BALL | NO_WINNER | FREE | actorId = null → **清除为 null** | N/A（隐式 Clear） |

**关键结论：**
- PRESS SUCCESS 与 SECOND_BALL WON 下，C-05 写入的 **不是实际物理触球者**，而是 Interaction Actor / Competition Winner。
- 因此 C-05 Writer 的语义 = 「Interaction 正式确认的最后涉及球员」，**≠** 「实际触球者」。
- 这是正式语义还是历史副作用？从代码看，`applyInteractionStateUpdate` 的注释（L6）明确把 `lastTouch` 列为 State Mutation 的一部分，且 `actorId` 是 Interaction 的固有概念，**不是偶然写入**——但它未声明「lastTouch = 实际触球」的契约。

### 四、PASS / SHOT Transit Start Hidden Clear 调查
| 项 | 结论 |
| --- | --- |
| 对象创建路径 | [pass-state-update.js#L22](file:///workspace/FE-project/src/core/match/pass-state-update.js#L22) `transitBall`、[shot-state-update.js#L16](file:///workspace/FE-project/src/core/match/shot-state-update.js#L16) `transitBall` |
| 机制 | 构造**全新** ball 对象（仅含 position/control/possessingTeamId/state/transit），**不含** `lastTouchPlayerId` 字段 |
| 性质 | **无意副作用**（非有意 Clear，无注释、无 `= null`、无专门清除逻辑） |
| PASS/SHOT Start 是否需要 Clear | **语义上不需要**：Action Actor ≠ Last Touch ≠ Current Possession。传球者最后触球的事实在 Transit 期间仍成立 |
| 是否与 C-03/C-05 语义一致 | **不一致**：清除丢失了「传球者最后触球」的合法历史事实 |
| 其他类似 Object Replacement | 经全量搜索，仅 PASS/SHOT `transitBall` 两处会丢弃 lastTouch；其余 ball 写入（ball-movement-integration、instant-ball-position-integration、ball-physics、finalizeTransitSettlement）均通过 `{...ball, ...}` spread 保留 |

### 五、Transit Completion 调查
| 项 | 结论 |
| --- | --- |
| 实现 | [finalizeTransitSettlement](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L71)：`base = {...ball, transit: undefined}`，preserve lastTouch |
| 是否自动重写 | **否**，不把 Transit Actor 写成 lastTouch |
| 是否符合推荐 | **符合**（仅当发生新的正式 Touch/Contact/Interaction Touch 时才更新） |
| Implementation Gap | 无 |

### 六、State-Specific Contract
| State | lastTouchPlayerId 约束 | 结论 |
| --- | --- | --- |
| IN_TRANSIT | 允许非 null（历史触球事实）；Transit Start 当前隐式清除为 null | **Gap**：Transit Start 不应清除 |
| FREE | 允许 `FREE + lastTouchPlayerId`；不代表球归该球员 | **合法**（C-60 已确认） |
| CONTROLLED | 允许；`lastTouch ≠ control`（概念独立，实现上当前巧合相等） | **合法但巧合** |
| GOAL | 当前保留 Transit 期间值（通常 null，除非中途有 Contact） | **保留，不自动 Clear**（推荐） |

### 七、Clear Authority 调查
| 清除路径 | 机制 | 显式？ | 合法？ |
| --- | --- | --- | --- |
| PASS Transit Start | 对象替换丢弃字段 | **隐式** | **不合法**（无意副作用） |
| SHOT Transit Start | 对象替换丢弃字段 | **隐式** | **不合法**（无意副作用） |
| SECOND_BALL NO_WINNER | C-05 FREE 分支 `actorId=null` → 写 null | 半显式 | **存疑**（无 Clear 契约） |
| C-03 sanitizeBall `?? null` | 字段缺失时归 null | 防御性 | 合法（非主动清除） |

**当前无任何模块拥有显式、契约化的 Clear Authority。** 所有清除均为隐式或副作用。

### 八、Possession / Control / SECOND_BALL / Goal Relationship（冻结）
- LastTouch **≠** Possession（`possessingTeamId` 由 C-05/C-39 独立写入）
- LastTouch **≠** Control（`control` 由 C-05/C-39 独立写入）
- LastTouch **≠** Ball State（无 `lastTouch → state` 推导）
- LastTouch **≠** SECOND_BALL（`isBallFree` 不读 lastTouch）
- LastTouch **≠** Goal Truth（`scoringPlayerId` 来自显式 candidate，非 lastTouch）
以上均 **PASS**（C-60 已确认，本次未变）。

### 九、Lifecycle（冻结 C-60 结论）
**D — Runtime Ball Fact。** 跨 Tick 保留；不进 Save / History / Replay；不作为 Derived Cache；无第二 Truth。

### 十、Consumer Contract（冻结 C-60 结论）
ball-facts / tactical-context / player-situation 均为 Read-only Projection，不得修改/缓存/推导 Possession/Control/State/SECOND_BALL/Goal。

### 十一、Determinism
所有 Writer/Consumer 纯函数；C-03 用 playerId 字典序 + 确定性 tie-break；无 `Math.random`/墙钟/非确定性遍历。**PASS。**

---

### 十二、Decision Matrix
| Decision | Frozen Result |
| --- | --- |
| LastTouch Truth | **BLOCKED**：当前实际 = Candidate C（综合），但 C-05 在 PRESS SUCCESS / SECOND_BALL WON 下不代表实际触球，语义发散。需 Owner 选择冻结为 A（纯物理触球）还是 C（综合涉及者） |
| C-03 Contact Writer | **保留**，语义 = 实际物理触球者，明确无歧义 |
| C-05 Interaction Writer | **BLOCKED**：写入「Interaction Actor / Possession Winner」，对 PRESS SUCCESS / SECOND_BALL WON 不代表实际触球。需 Owner 决定：(a) 保留并冻结语义为「最后涉及者」；(b) 移除该 Writer（未来 Gate 改代码）；(c) 限定仅在确有触球的 outcome 写入 |
| PASS/SHOT Clear | **Implementation Gap**：隐式对象替换清除，无意且语义不合理（传球者最后触球事实应保留）。需 Owner 决定是否未来修复 |
| Transit Completion | **冻结**：不自动重写 lastTouch，仅 preserve |
| FREE | `FREE + lastTouchPlayerId` 合法，不代表球权 |
| CONTROLLED | 合法；`lastTouch ≠ control`（概念独立，实现巧合） |
| IN_TRANSIT | 允许非 null；Transit Start 隐式清除为 Gap |
| GOAL | 保留，不自动 Clear |
| Possession Relationship | LastTouch ≠ Possession |
| Control Relationship | LastTouch ≠ Control |
| SECOND_BALL Relationship | LastTouch ≠ SECOND_BALL eligibility |
| Goal Relationship | LastTouch ≠ Goal Truth |
| Save / History | 不持久化 |
| Lifecycle | D — Runtime Ball Fact |
| Clear Authority | **BLOCKED**：当前无显式 Clear Authority，所有清除均为隐式/副作用。需 Owner 定义谁有权 Clear |

### 十三、Implementation Gaps（仅记录，不在 C-61 修复）
1. **C-05 语义发散**：PRESS SUCCESS / SECOND_BALL WON 写入非实际触球者。
2. **PASS/SHOT Transit Start 隐式 Clear**：对象替换丢弃 `lastTouchPlayerId`，丢失传球者最后触球事实。
3. **SECOND_BALL NO_WINNER 隐式 Clear**：C-05 FREE 分支将 lastTouch 写为 null，无 Clear 契约。
4. **无显式 Clear Authority**：清除逻辑分散且隐式。

### 十四、需要 Owner 决策的最小问题集合
1. **LastTouch Truth 语义**：冻结为 Candidate A（纯物理触球者）还是 Candidate C（综合最后涉及者）？
2. **C-05 Writer 去留**：若选 A，是否移除 C-05 对 lastTouch 的写入（未来 Gate 实现）？若选 C，是否显式冻结 C-05 语义为「最后涉及者」并接受与物理触球的发散？
3. **PASS/SHOT Transit Start Clear**：是否修复为保留 lastTouch（即传球者仍为最后触球者）？
4. **Clear Authority**：是否定义显式 Clear 规则？哪些 State Transition 允许 Clear？

### 十五、Regression / Files / Contract Changes
- `npm test` → **1540 通过 / 0 失败**。
- Files Changed：仅 `docs/SIMULATION_SPEC.md`（本 §68）。**src/** = 0，**tests/** = 0。
- Contract Changes：**无**（本 Gate 为 Investigation / Freeze，未改任何已 SEALED Contract；因语义发散未冻结新 Contract）。

### 十六、Out of Scope
任何代码修改、C-05 Writer 移除/调整、PASS/SHOT Clear 修复、新增显式 Clear 逻辑、新增字段、重开 C-03/C-05/C-46/C-60。

### 十七、Remaining Risks
1. 在 Owner 决策前，`lastTouchPlayerId` 语义保持发散状态（C-03 物理触球 vs C-05 涉及者），任何新增 Consumer 若误读为「实际触球者」将引入语义错误。
2. PASS/SHOT Transit Start 隐式清除可能导致 Goal Attribution（若未来依赖 lastTouch）丢失传球者信息。
3. SECOND_BALL NO_WINNER 隐式清除可能丢失上一次触球者事实。

**STOP — 不得进入 C-62，不得修改发现的问题；如发现 LastTouch Contract Gap 只报告并 BLOCK。等待 Owner 验收与决策。**

## §69 LastTouch Semantic Separation / Writer Correction（Step 39F-M-C-62）

**Gate Result = PASS / SEALED（Implementation）。** Architecture Conclusion = **PASS**。

**Owner Decision（C-61 FROZEN）：LastTouch Truth = Candidate A** — `lastTouchPlayerId` 唯一语义 = 最近一次被系统正式确认实际触碰 Ball 的球员。≠ Interaction Actor / Possession Winner / Pressing Player / SECOND_BALL Winner / Control Player / Possession Owner / Transit Owner。

### 一、Writer Changes
| Writer | Before | After |
| --- | --- | --- |
| C-03 Contact | 写 actual contacting player | **保留**（不变） |
| C-05 Interaction（DRIBBLE/TACKLE/INTERCEPTION） | 写 possession.toPlayerId / actorId（均为实际触球） | **保留**（不变，这些 outcome 代表实际触球） |
| C-05 PRESS SUCCESS | 写 pressingPlayerId（actorId） | **改为 preserve**：压迫者未必物理触球 |
| C-05 SECOND_BALL WON | 写 competitionWinnerId | **改为 preserve**：winner 由竞争分决定，非触球 |
| C-05 SECOND_BALL NO_WINNER | 写 null（隐式 Clear） | **改为 preserve**：不得因无赢家而清除 |
| PASS Transit Start | 新对象丢弃字段（隐式 Clear） | **保留** `lastTouchPlayerId` 自原 ball |
| SHOT Transit Start | 新对象丢弃字段（隐式 Clear） | **保留** `lastTouchPlayerId` 自原 ball |
| Transit Completion | preserve（不重写） | **不变** |

### 二、Frozen Contract
- **LastTouch Truth** = 最近一次实际触球者。
- **唯一正式 Writer**：C-03 Contact（物理触球）；C-05 仅在 DRIBBLE/TACKLE/INTERCEPTION 这类确有实际触球的 outcome 写入。
- **PRESS SUCCESS**：不写 pressingPlayer 到 lastTouch。
- **SECOND_BALL WON**：不写 winner 到 lastTouch。
- **SECOND_BALL NO_WINNER**：不 Clear lastTouch。
- **PASS/SHOT Transit Start**：不 Clear lastTouch（传球者/射门者仍为最近触球者）。
- **Transit Completion**：不重写、不 Clear lastTouch。
- **GOAL / FREE / CONTROLLED / IN_TRANSIT**：均不自动 Clear lastTouch。
- **Lifecycle** = D — Runtime Ball Fact（不进 Save/History/Replay）。
- **Consumer** = ball-facts / tactical-context / player-situation（Read-only Projection）。
- **Determinism**：所有 Writer/Consumer 纯函数，无随机源。

### 三、Implementation Details
- [interaction-state-update.js](file:///workspace/FE-project/src/core/match/interaction-state-update.js#L66-L72)：新增 `preservesLastTouch` 判断（`actionType === 'SECOND_BALL'` 或 `PRESS && !controlled`），命中则保留 `current.lastTouchPlayerId`。
- [pass-state-update.js](file:///workspace/FE-project/src/core/match/pass-state-update.js#L25-L46)：`transitBall` 接受 `lastTouchPlayerId` 参数并写入。
- [shot-state-update.js](file:///workspace/FE-project/src/core/match/shot-state-update.js#L19-L41)：同上。

### 四、Tests
新增 [tests/last-touch-contract.test.js](file:///workspace/FE-project/tests/last-touch-contract.test.js)，覆盖 LT-01～LT-12（C-03 触球、PASS/SHOT 保留、Transit 完成不重写、PRESS SUCCESS 不写、SECOND_BALL WON/NO_WINNER 保留、FREE/CONTROLLED/GOAL 不清除、新触球覆盖、确定性）。
更新 [interaction-position-ownership.test.js](file:///workspace/FE-project/tests/interaction-position-ownership.test.js#L152-L177) `legacyC05` 基线以对齐 C-62 契约。

### 五、Regression / Files / Contract
- `npm test` → **1552 通过，0 失败**（基线 1540 + 新增 12）。
- Files Changed：`src/core/match/interaction-state-update.js`、`src/core/match/pass-state-update.js`、`src/core/match/shot-state-update.js`、`tests/last-touch-contract.test.js`、`tests/interaction-position-ownership.test.js`、`tests/run.js`、`docs/SIMULATION_SPEC.md`。
- Contract Changes：LastTouch Truth 冻结为 Candidate A；C-05 PRESS/SECOND_BALL Writer 移除；PASS/SHOT Transit Start Clear 移除。未改 C-03/C-46/C-54~C-61 任何其他冻结结论。

### 六、Out of Scope
C-03 Physics / Contact / Interaction / Possession / SECOND_BALL / Transit / Goal 重构；新增字段/Event/State；C-54~C-60 已冻结语义。

### 七、Remaining Risks
1. Goal Attribution 当前不依赖 lastTouch；若未来引入 scorer/assister 推导，须另行审计。
2. DRIBBLE/TACKLE/INTERCEPTION 的 lastTouch 写入依赖「Interaction outcome 等价于实际触球」的假设，未来若新增 Interaction 类型须逐个审计。

**STOP — 不得进入 C-63，不得重开 C-61/C-60，不得顺便重构 Interaction/SECOND_BALL/Goal/Possession/Velocity。等待 Owner 验收。**

## §70 LastTouch Post-Implementation Architecture Audit（Step 39F-M-C-63）

**Gate Result = PASS / SEALED（Read-Only Audit）。** Architecture Conclusion = **PASS**。

C-62 实施后，`lastTouchPlayerId` 已确认为语义单一、生命周期稳定、消费者隔离、无第二 Truth 的 Runtime Ball Fact。

### 一、Writer Audit（当前完整清单）
| Writer | 位置 | 分类 |
| --- | --- | --- |
| C-03 Contact | [ball-physics.js#L182](file:///workspace/FE-project/src/core/match/ball-physics.js#L182) | ACTUAL_TOUCH |
| C-03 sanitizeBall | [ball-physics.js#L62](file:///workspace/FE-project/src/core/match/ball-physics.js#L62) | PRESERVE |
| C-05 CONTROLLED（DRIBBLE/TACKLE/INTERCEPTION/PRESS retained） | [interaction-state-update.js#L70-L72](file:///workspace/FE-project/src/core/match/interaction-state-update.js#L70-L72) | ACTUAL_TOUCH |
| C-05 FREE（DRIBBLE KNOCKED_LOOSE / TACKLE LOOSE / INTERCEPTION DEFLECTED） | 同上 | ACTUAL_TOUCH |
| C-05 PRESS SUCCESS / SECOND_BALL | 同上 | PRESERVE（C-62） |
| PASS Transit Start | [pass-state-update.js#L31](file:///workspace/FE-project/src/core/match/pass-state-update.js#L31) | PRESERVE（C-62） |
| SHOT Transit Start | [shot-state-update.js#L25](file:///workspace/FE-project/src/core/match/shot-state-update.js#L25) | PRESERVE（C-62） |
| Transit Completion | [continuous-ball-movement-integration.js#L71-L106](file:///workspace/FE-project/src/core/match/continuous-ball-movement-integration.js#L71-L106) | PRESERVE |

无 NON_TOUCH Writer，无 implicit CLEAR，无 UNKNOWN。

### 二、关键审计结论
- **C-03 Contact**：代表实际物理触球，仍为唯一物理 Writer；`contacting[]` 与 `lastTouchPlayerId` 语义分离（前者为接触窗口防粘球，后者为跨窗口事实）。
- **C-05 语义证明**：DRIBBLE（COMPLETED→运球者；LOST→夺球者；KNOCKED_LOOSE→运球者失误）/ TACKLE（WON→抢断者；LOST→持球者；LOOSE→抢断者触球）/ INTERCEPTION（INTERCEPTED→拦截者；DEFLECTED→拦截者触球）各 outcome 对应「实际作用于球」的球员，构成 ACTUAL_TOUCH 证据链；INTERCEPTION FAILED 走 IN_TRANSIT 早返回，不写。
- **PRESS SUCCESS**：不写 pressingPlayer（压迫仅迫使持球者失误，非直接触球）。
- **SECOND_BALL**：WON 不写 winner；NO_WINNER 不 Clear。
- **Transit**：Start/Completion 均 preserve。
- **State**：IN_TRANSIT/FREE/CONTROLLED/GOAL 均不自动 Clear；`lastTouch ≠ control`。
- **Possession**：无 `lastTouch → 球权` 或 `winner → lastTouch` 推导链。
- **Goal**：`scoringPlayerId` 来自显式 candidate（[goal-resolution.js#L119](file:///workspace/FE-project/src/core/match/goal-resolution.js#L119)），不读/写/Clear lastTouch；无 scorer/assister 推导。
- **Persistence**：`serializeState` 不序列化 ball；无 replay/history 持久化。
- **Derived/Cache**：无 derivedLastTouch / cachedLastTouch / lastKnownTouch / previousTouchOwner；仅存在局部变量 `lastTouch`（ball-physics，不跨 Tick）。
- **Clear**：全局无 `delete lastTouchPlayerId`；除 C-03/C-05 ACTUAL_TOUCH 赋值外无显式 Clear。
- **Determinism**：Writer/Consumer 纯函数，无随机源。

### 三、Test / Regression
- [tests/last-touch-contract.test.js](file:///workspace/FE-project/tests/last-touch-contract.test.js) LT-01～LT-12 全部存在并执行（12 用例）。
- `npm test` → **1552 通过，0 失败**，与 C-62 基线一致（C-63 只读，未新增测试）。

### 四、Files Changed
仅本文件（§70 追加）。**src/ = 0，tests/ = 0。**

### 五、Contract Changes
**无**（未改任何已冻结 Contract）。

### 六、Remaining Risks
1. PRESS SUCCESS 与 TACKLE LOOSE 结构相似（均产 FREE loose ball），前者 PRESERVE、后者 ACTUAL_TOUCH——差异依据「压迫不直接触球 / 抢断为直接触球」的建模区分，属已冻结语义，未来若调整须独立 Gate。
2. Goal Attribution 未来若引入 assister 推导可能希望读取 lastTouch；届时须独立定义 Contract，不得隐式依赖。

**STOP — 不得进入 C-64，不得修复发现的问题，不得扩展 LastTouch / Goal Attribution / Scorer / Assister，不得重构 Interaction / Possession / SECOND_BALL。等待 Owner 验收。**

## §71 Goal Attribution / Scorer Truth Boundary Audit（Step 39F-M-C-64）

**Gate Result = PASS / SEALED（Read-Only Audit）。** Architecture Conclusion = **PASS / SEALED + ARCHITECTURE NOTE**。

### 一、"scoringPlayerId" Writer / Reader
| 角色 | 位置 | 说明 |
| --- | --- | --- |
| Writer（唯一） | [goal-resolution.js#L119](file:///workspace/FE-project/src/core/match/goal-resolution.js#L119) | `scoringPlayerId: candidate.playerId ?? null` |
| noGoal 占位 | [goal-resolution.js#L98](file:///workspace/FE-project/src/core/match/goal-resolution.js#L98) | 失败路径返回 null |
| 校验 | [goal-resolution.js#L175](file:///workspace/FE-project/src/core/match/goal-resolution.js#L175) | 类型校验 |
| Reader（生产） | 无 | 仅测试 [goal-resolution.test.js#L87](file:///workspace/FE-project/tests/goal-resolution.test.js#L87) |
| Persistence | 无 | 不写 MatchCore / Save / Stats |

**唯一正式 Writer = `resolveGoal`，输入 = 显式 `candidate.playerId`。**

### 二、Goal Resolution Data Flow
`detectGoalLineCrossing`(C-15) → `createGoalCandidateFromCrossing`(C-15) → `resolveGoal`(C-14) → `applyGoalScoreUpdate`(C-14 唯一 Score Write)。

`candidate.playerId` 仅来自 `options.playerId`（调用方显式传入，[goal-geometry.js#L133](file:///workspace/FE-project/src/core/match/goal-geometry.js#L133) / [goal-crossing-resolution.js#L67](file:///workspace/FE-project/src/core/match/goal-crossing-resolution.js#L67)），**不推断**（C-21 明示「缺则保持 null，不推断」）。

三个层面 Truth 明确区分：Goal Geometry Truth（C-15）、Score Truth（C-14）、Scorer Attribution Truth（`candidate.playerId`，非独立模块）。

### 三、边界审计结论
| 边界 | 结论 |
| --- | --- |
| Goal Geometry (C-15/C-20) | 只提供 crossing/geometry，不携带也不推断 Scorer。**PASS** |
| LastTouch | Goal Resolution 不读/写/Clear lastTouch；`scoringPlayerId` 非 lastTouch。**PASS** |
| Possession | 不参与 scorer。**PASS** |
| Interaction Actor | 不参与 scorer。**PASS** |
| Transit / Shot Actor | 不自动成为 scorer（无 `actorId → scoringPlayerId` 链）。**PASS** |
| Own Goal / Deflection / Rebound | 均**不存在**。**PASS（未实现）** |
| Assister（Simulation Core） | **完全不存在**（无 assister/assistPlayerId/passer/creator 字段或推导）。**PASS（未实现）** |
| Goal Event / Ledger | 无 goal ledger/history；`goalId` 为调用方透传（可 null），无 dedup ledger（C-21 明示依赖 nextScore 幂等）。**PASS** |
| Score Authority | 仍为 C-14 `applyGoalScoreUpdate`。**PASS** |
| Persistence | `scoringPlayerId` 为 transient envelope 字段，不入 Save/History/Replay。**PASS** |
| Career Stats | Goal Resolution 不读 appearances/careerStats/seasonStats，不写统计。**PASS** |
| Second Truth | 无 goalScorer/shotPlayerId/shooterId/finisherId/goalPlayerId 等竞争字段。**PASS** |
| Determinism | 无随机源；scorer 由调用方输入决定。**PASS** |

### 四、ARCHITECTURE NOTE — 独立 Season 模拟模块
`src/core/match.js`（season 赛果聚合模拟，非 Simulation Core）拥有**独立的** scorer/assist 派生：
- `selectScorer`（[match.js#L56-L73](file:///workspace/FE-project/src/core/match.js#L56-L73)）按位置/能力权重 + RNG 选进球者 → 事件 `actorId`。
- 事件 `assistId` 恒为 null（[match.js#L99](file:///workspace/FE-project/src/core/match.js#L99)，注释「无可靠助攻来源」），但 `applyMatchPerformance` 用**独立 RNG** 派生 assists 统计（[match.js#L217-L227](file:///workspace/FE-project/src/core/match.js#L217-L227)）。
- involvements → 生态反馈 → 球员 stats/career（[simulation.js#L142-L149](file:///workspace/FE-project/src/core/simulation.js#L142-L149)）。

该模块**不属于** C-14/C-15/C-20/C-21 契约范围，与 `lastTouchPlayerId` **无任何耦合**（不含 ball physics/lastTouch），因此**不构成 `scoringPlayerId` 的第二 Truth**，也不构成 LastTouch→Scorer 隐式链。但其 scorer/assist 语义未以 Contract 形式文档化，与事件字段 `assistId`（恒 null）和统计级 assists（RNG 派生）之间存在表述不一致。

**建议**：若 Owner 需要统一 scorer/assist attribution 语义，未来另立独立 Gate；本 Gate 不新增、不修改。

### 五、Files Changed
仅本文件（§71 追加）。**src/ = 0，tests/ = 0。**

### 六、Regression
`npm test` → **1552 通过，0 失败**，与基线一致（C-64 只读，测试数不变）。

### 七、Contract Changes
**无。**

### 八、Remaining Risks
1. `src/core/match.js` 的 scorer/assist 派生尚无 Contract 记录，且 `assistId`（恒 null）与统计级 assists（RNG）表述不一致——属独立模块，不影响 Simulation Core truth，但建议未来独立 Gate。
2. Simulation Core 的 `scoringPlayerId` 完全依赖调用方传入 `options.playerId`；若调用方缺失则 scorer 恒为 null（无 fallback），此为 C-21 冻结行为。

**STOP — 不得进入 C-65，不得实现 Scorer / Assister / Own Goal / Deflection / Rebound，不得修改 LastTouch / Goal Resolution / C-14 / C-15 / C-20 / C-21，不得重开 C-63。等待 Owner 验收。**

## §72 Season Match Simulation / Goal Attribution Boundary Audit（Step 39F-M-C-65）

**Gate Result = PASS / SEALED（Read-Only Audit）。** Architecture Conclusion = **PASS / SEALED + ARCHITECTURE NOTE**。

### 一、Module Identity — `src/core/match.js`
| 项 | 结论 |
| --- | --- |
| 职责 | **Season / Aggregate Match Simulation**（时段制，90 分钟分段结算赛果 + 球员统计），非球级实时 Simulation Core |
| 输入 | `{ home:{strength,players,tactics,teamId,minutesByPlayer}, away:…, context:{worldId,season,round,homeId,awayId}, seed? }` |
| 输出 | `{ matchSeed, homeGoals, awayGoals, events[], involvements{} }` |
| 是否操作 MatchCore | **否** |
| 是否操作 MatchCore.ball | **否** |
| 是否操作 lastTouchPlayerId | **否** |
| 是否触碰 C-14 Score Authority | **否** |
| 是否触碰 C-15 / C-20 / C-21 | **否** |
| 层级 | Season / Aggregate Simulation |

**注意**：文件头注释自称 "Simulation Core"，实为 **Season Aggregate Simulation**；球级 Simulation Core 位于 `src/core/match/`（C-03/C-14/C-15/C-20/C-21）。命名重叠，语义独立。

### 二、Simulation Core Boundary（依赖审计）
`src/core/match.js` 仅 2 个 import：`./sim-config.js`、`./rng.js`。对 MatchCore / ball / lastTouchPlayerId / goal-resolution / goal-geometry / goal-crossing-resolution / applyGoalScoreUpdate / resolveGoal / transit / possession / second-ball / interaction 全部为 **NO DEPENDENCY**。**无任何写入 Simulation Core 的通道。**

### 三、Scorer Truth
`selectScorer`（[match.js#L56-L73](file:///workspace/FE-project/src/core/match.js#L56-L73)）→ 事件 `actorId` = **Aggregate Match Event Scorer**（赛季赛果统计层），**非** Simulation Core `scoringPlayerId`（显式 candidate）。**两者不同 Truth，不予统一。**

### 四、RNG Scorer Audit
- RNG 来源：`createRng(matchSeed)`，`matchSeed = deriveMatchSeed({worldId,season,round,homeId,awayId})`（[match.js#L257-L264](file:///workspace/FE-project/src/core/match.js#L257-L264)）。
- 可复现：**是**（同 seed 同结果）。
- 无 `Math.random / Date.now / performance.now / wall clock`（[rng.js](file:///workspace/FE-project/src/core/rng.js) 为 hash 派生 LCG）。
- 候选：本方球员，按位置/能力平方加权（FW finishing / MF technique / DF defending）。
- 输出：`playerId` 或 **null**（无合适球员时，[L65](file:///workspace/FE-project/src/core/match.js#L65)）。
- 不产生非法 playerId / fallback player。

### 五、Determinism Classification
**Deterministic RNG**（有 seed、可重复）。Simulation Core determinism 独立，未被此 RNG 影响。**PASS**。

### 六、Assist Truth
| 字段 | 所属 | 语义 | 生命周期 | 分类 |
| --- | --- | --- | --- | --- |
| `events[].assistId` | match.js 事件 | 恒 null（保留字段，无可靠来源） | transient | EVENT ID（未使用） |
| `involvements[].assists` | match.js / player-runtime | 统计计数（RNG 派生） | persisted（season/career） | STAT COUNT |

**非同一 Truth**：`assistId` 为未使用的保留事件字段；`assists` 为统计计数。无第三 Assister Truth。

### 七、Assist ID / Assist Count Relationship
`assistId`（恒 null）**不参与** `assists` 计算；`assists` 由 `applyMatchPerformance` 用**独立 RNG**（[match.js#L217-L227](file:///workspace/FE-project/src/core/match.js#L217-L227)）在同队非进球者中加权抽取。说明：事件层未产生 assist 事实，统计层独立派生——**表述层次不一致但非同一字段冲突**。

### 八、Involvement Audit
Writer：`buildInvolvements`（[L120-L152](file:///workspace/FE-project/src/core/match.js#L120-L152)）+ `mergePerformance`（[L317-L329](file:///workspace/FE-project/src/core/match.js#L317-L329)）。
Consumer：`simulation.js #applyPostMatch` → `recordAppearance`（[simulation.js#L141-L162](file:///workspace/FE-project/src/core/simulation.js#L141-L162)）。
语义：**per-match player involvement / stat line**（出场/分钟/进球/助攻/牌/射门/评分），非 scorer/assister truth。可被反向解释为「本场进球者统计」，但不含归属决策。**记录风险：不修改。**

### 九、Stats Boundary
`involvements` → `recordAppearance` → `rt.stats.season` 与 `rt.stats.career`（appearances/minutes/goals/assists/…，[player-runtime.js#L526-L536](file:///workspace/FE-project/src/core/player-runtime.js#L526-L536)）。属 **Season Aggregate Stats**，与 C-14 Score Truth 不同层面。Season Match Simulation 的职责即生成这些聚合统计。**不重构。**

### 十、Player Identity
scorer ∈ 本方 `players`（`selectScorer` 只遍历传入的该队 players）；assist provider ∈ 同队非进球者。**可能 null**（无候选）。无不存在的 playerId，无 fallback player。**PASS + 记录 null 风险。**

### 十一、Team Boundary
`selectScorer(players,...)` 使用该方 players；assist candidates = `players.filter(p => p.id !== scorerId)`（同队）。**scorer 不可能属于非进攻方球队。PASS。**

### 十二、Goal Count Boundary
`homeGoals/awayGoals` 由 `simulateSegments` 本地累计，写入 `fixture.homeGoals/awayGoals`（season 赛果，[simulation.js#L107-L109](file:///workspace/FE-project/src/core/simulation.js#L107-L109)），**从不写 MatchCore.score**。**不构成 C-14 第二 Score Writer。PASS。**

### 十三、Goal Event Boundary
Season events = **Independent Aggregate Event**（`{minute,teamId,type,actorId,assistId,segment,reason}`），与 C-21 Goal Event / Resolution 无关联；无 goalId / ledger / replay。**PASS。**

### 十四、LastTouch Boundary
`src/core/match.js` **不读取** `lastTouchPlayerId`（亦不读取任何 ball 字段）。**PASS** — 无 LastTouch→scorer/assist 推导。

### 十五、Goal Resolution Boundary
**不调用** `resolveGoal` / `applyGoalScoreUpdate`；自行按期望值累计进球数（赛季赛果层），不写 Simulation Core Score。**PASS** — 非法球级 Resolution 入口未被使用。

### 十六、Persistence Boundary
- Season/Career Stats（含 RNG 派生 assists）→ persisted（player runtime stats，随 Save 的 runtime 持久化）。
- Overall：`scoringPlayerId`（Core）不持久化；`assists/career`（Season）持久化。**两者不同 Truth，边界明确。PASS。**

### 十七、Second Truth Audit
| 字段 | 模块 | 语义 | 生命周期 | 最终 Truth？ |
| --- | --- | --- | --- | --- |
| `scoringPlayerId` | Simulation Core | 显式 candidate | transient | 是（Core Scorer） |
| `events[].actorId` | Season Sim | 聚合事件进球者 | transient→stats | 否（Aggregate Scorer） |
| `events[].assistId` | Season Sim | 恒 null 保留字段 | transient | 否 |
| `involvements[].assists` | Season Sim | 统计计数 | persisted | 否（Stat Count） |

**无跨模块字段同时声称 Core Scorer Truth。** 不构成 SECOND_TRUTH_RISK。

### 十八、Contract Status
`Scorer`（Season）= **UNFROZEN**；`Assister`（Season）= **UNFROZEN**；`Involvement` = **UNFROZEN**；`Season Aggregate Goal` = **UNFROZEN**。本 Gate 不新增 Contract。

### 十九、Documentation Audit
记录：**Season Match Simulation 与 Ball Simulation Core 的 Goal / LastTouch Truth 独立。** `ASSIST_CONTRACT_STATUS = UNFROZEN`（事件 `assistId` 恒 null；统计级 `assists` 由 RNG 派生，未以 Contract 冻结）。未把 Season RNG scorer/assist 误写为 Core scoringPlayerId。

### 二十、Files Changed
仅本文件（§72 追加）。**src/ = 0，tests/ = 0。**

### 二十一、Contract Changes
**无。**

### 二十二、Remaining Risks
1. `src/core/match.js` 文件头自称 "Simulation Core"，与其实际层级（Season Aggregate Simulation）不符——命名重叠，建议未来文档澄清（本 Gate 不改）。
2. Season scorer/assist/involvement 四项均 UNFROZEN；`assistId`（恒 null）与 `assists`（RNG）层次不一致——若 Owner 需统一 attribution 语义，另立独立 Gate。
3. Season Sim 的 assists（RNG 派生）会持久化进 season/career stats；属既有行为，非缺陷。

**STOP — 不得进入 C-66，不得修复 assistId / RNG / Assister / Scorer / Season Stats / Career Stats，不得修改 Simulation Core / LastTouch / Goal Resolution / C-14 / C-15 / C-20 / C-21。等待 Owner 验收。**

## §73 Season Scorer / Assister / Involvement Attribution Audit（Step 39F-M-C-66）

**Gate Result = PASS / SEALED（Read-Only Audit）。** Architecture Conclusion = **PASS / SEALED + ARCHITECTURE NOTE**。

### 一、Attribution Vocabulary（以实际 Writer/Consumer 为准）
| 名称 | 实际来源 | 实际含义 | 生命周期 | Consumer |
| --- | --- | --- | --- | --- |
| `selectScorer` | match.js L56 | 时段进球者加权抽取（本方，位置/能力²） | 调用内 | `simulateSegments` |
| `events[].actorId` | L92/L98 | **Event-local Actor**；`type='goal'` 时=进球者 | event | `buildInvolvements` L144、`applyMatchPerformance` L206/L220 |
| `events[].assistId` | L99 | **恒 null 保留字段**（无写入路径、无 Reader） | event | 无 |
| `involvements[].assists` | L226（`applyMatchPerformance`） | **同队非进球者的 RNG 表现统计** | match → stats | `mergePerformance` → `recordAppearance` |
| `involvements` | L120/L317 | **比赛表现统计容器** | match | `simulation.js #applyPostMatch` |
| `recordAppearance` | player-runtime L490 | season/career 统计累加 | persisted | 统计层 |

### 二、Season Scorer Audit
- 输入候选：传入该方 `players` 中 `position ∈ {FW,MF,DF}`（门将排除）。
- 权重：`finishing/technique/defending` 的**平方**。
- RNG：`seedRng.next()`（命中段后随即调用）。
- 输出：`playerId` 或 **null**（`buckets.length===0`，[L65](file:///workspace/FE-project/src/core/match.js#L65)）。
- 每次命中段必生成 1 个 `goal` event；`actorId` 恒代表进球者。
- **唯一 Scorer Writer**，后续无覆盖。**Season 只有一个 Scorer Truth（event-local）。PASS。**

### 三、Goal Event Audit
`events[]` 当前**只有一种 type：`'goal'`**（[L97](file:///workspace/FE-project/src/core/match.js#L97)），字段 `{minute,teamId,type,actorId,assistId,segment,reason}`。属 **统计模拟事件**（非 Core 球级 Goal Event）。**PASS。**

### 四、Event Actor Semantics
| Event Type | `actorId` 语义 |
| --- | --- |
| `goal` | 进球者（Scorer） |
| （预留 `assist`/`yellow`/`red`） | 其他 Actor（`buildInvolvements` L147-L149 预留分支，**当前不产生**） |

故 `actorId` = **EVENT-LOCAL ACTOR**，非全局 Scorer Truth。**PASS。**

### 五、Assist ID Audit
`events[].assistId`：唯一写入 = 字面量 `null`（[L99](file:///workspace/FE-project/src/core/match.js#L99)）；**无任何 Reader**（grep 仅 L78 注释/L99 写入）；不参与 `assists` 计算；无隐式 Assister。判定 = **UNUSED / RESERVED FIELD**（不删除）。

### 六、Assist Count Audit
`involvements[].assists`：初值 0（`buildInvolvements`）→ 被 `mergePerformance` 用 `applyMatchPerformance` 的值覆盖（[L324](file:///workspace/FE-project/src/core/match.js#L324)）。语义 = **Match Performance Statistic**（RNG 派生统计量），**非** Goal Assist 归属记录（无 per-goal 绑定）。

### 七、Assist Generation Audit
- RNG 来源：`createRng(hashSeed(`${matchSeed}|assist|${side}|${ev.minute}|${scorerId}`))`（[L223](file:///workspace/FE-project/src/core/match.js#L223)），**逐进球独立流**。
- Seed：`matchSeed` 派生，可复现。
- 候选：**同队** `players.filter(p => p.id !== scorerId)`（[L221](file:///workspace/FE-project/src/core/match.js#L221)），排除进球者本人。
- 场次 assists 上限：每 goal event 最多 1（L226），故 `Σassists ≤ Σgoals`。
- 与 Goal Event 关系：**按 goalEvents 循环**，故不产生"无进球事件的助攻"；但**不记录具体对应哪个进球**（无 assistId 回填）。
- 可能 0 助攻的进球（`arng.next() >= ASSIST_CHANCE` 跳过）；不会一个进球对多个助攻；不会 assists > goals。

### 八、Scorer / Assist Relationship
`assistId`（恒 null，无 Reader）与 `assists`（独立 RNG 统计）**无数据关系**。判定：**ASSIST_ID_AND_ASSIST_COUNT_SEMANTICALLY_DISCONNECTED**。

### 九、Goal / Assist Cardinality
1 Goal → **0 或 1** assist（至多 1，源码注释 L184/L226）。**无 one-to-many / many-to-one 约束**；assists 与具体进球**不一一对应**（无 per-goal 归属）。

### 十、Involvement Semantics
`involvements[playerId] = { side, role, position, minutes, goals, assists, yellow, red, shots, shotsOnTarget, rating }`。逐字段：`goals`=进球计数；`assists`=助攻统计；`shots/shotsOnTarget/rating`=General Performance；`minutes/role/position/side`=Appearance；`yellow/red`=Other。
**结论：involvements = 比赛表现统计容器，不是 Goal Attribution 容器**；不能作为 Scorer / Assister Truth。

### 十一、Stats Mapping
`involvements → recordAppearance → rt.stats.season` 与 `rt.stats.career` 的字段：appearances/minutes/goals/assists/yellow/red/shots/shotsOnTarget/ratingSum（[player-runtime.js#L526-L536](file:///workspace/FE-project/src/core/player-runtime.js#L526-L536)）。**Season 的 Goal/Assist 数据只作为统计输入，不是 Simulation Core Truth。PASS。**

### 十二、Stats Accumulation
`recordAppearance` 对 season/career **各自独立累加（+=）**，非 career-from-season 派生。`#playFixture` 有 `fixture.played` 守卫（[simulation.js#L85-L107](file:///workspace/FE-project/src/core/simulation.js#L85-L107)），每场只结算一次 → involvement 只消费一次，不重复计入。**唯一 Stats Writer = `recordAppearance`。PASS。**

### 十三、Null Semantics
| 值 | 含义 |
| --- | --- |
| `scorer = null` | 该段无合适球员候选（数据不足），未指派进球者（`actorId=null`） |
| `assistId = null` | **字段尚未实现/保留**（恒 null，与"是否发生助攻"无关） |
| `assists = 0` | 该球员本场**未被 RNG 记录助攻**（统计计数为 0） |

三者语义互不相同，不得混淆。

### 十四、RNG Independence
assist 流 key = `|assist|{side}|{minute}|{scorerId}`；perf 流 key = `|perf|{side}|{playerId}`；比分流 = `matchSeed` 主流。**三者相互独立**：改动其一不改变其余结果。判定 **RNG independent**。**PASS。**

### 十五、Determinism
全链路 hash-seeded；**无** `Math.random / Date.now / performance.now / wall clock`（`rng.js` 为 hash 派生 LCG）。相同 world/season/round/home/away/players/context → 相同 events / assists / involvements / stats。**PASS。**

### 十六、Cross-Match Contamination
所有状态均在 `simulateMatch` 局部构造（events/involvements/out 均为局部对象）；**无模块级缓存、无 shared array、无 persistent RNG**。**PASS。**

### 十七、Core Truth Separation
Season `assistId` / `assists` **不**成为 Core `lastTouchPlayerId` / Ball Truth / Goal Geometry / Score Authority；`src/core/match.js` 对 Core 零依赖（C-65 已确认）。**PASS。**

### 十八、Contract Status
`Season Scorer Contract`（event-local）= **UNFROZEN**；`Season Assister Contract` = **UNFROZEN**；`Season Assist Count Contract` = **UNFROZEN**；`Season Involvement Contract` = **UNFROZEN**；`Season Goal Event Contract` = **UNFROZEN**。本 Gate 不冻结任何 Contract。

### 十九、Documentation Audit
明确记录：`events[].assistId` = UNUSED / RESERVED FIELD；`involvements[].assists` = RNG 派生 Match Performance Statistic；`ASSIST_ID_AND_ASSIST_COUNT_SEMANTICALLY_DISCONNECTED`。**未**把当前 RNG assists / involvements 描述成 Core Truth 或正式 Assister Contract。

### 二十、Files Changed
仅本文件（§73 追加）。**src/ = 0，tests/ = 0。**

### 二十一、Contract Changes
**无。**

### 二十二、Remaining Risks
1. `events[].assistId` 为恒 null 保留字段，`buildInvolvements` 的 `type='assist'` 分支为死代码（无事件产生）——属预留设计，非缺陷。
2. `involvements[].assists` 为 RNG 统计量，与具体进球无归属绑定；若未来需要「每球助攻者」Truth，须另立 Contract（本 Gate 不新增）。
3. Season Scorer（event-local）/ Assister / Involvement 均 UNFROZEN，文档已如实标记。

**STOP — 不得进入 C-67，不得冻结 Season Scorer / Assister / Assist Count / Involvement / Goal Event，不得修复 assistId / assists / RNG / involvements / stats / career stats，不得修改 Simulation Core / LastTouch / Goal Resolution / C-14 / C-15 / C-20 / C-21。等待 Owner 验收。**

## §74 Season / Career Statistics Writer & Accumulation Boundary Audit（Step 39F-M-C-67）

**Gate Result = PASS / SEALED（Read-Only Audit）。** Architecture Conclusion = **PASS / SEALED**。

### 一、Statistics Vocabulary
| 字段 | Writer | Consumer | 生命周期 | 持久化 | 最终 Truth |
| --- | --- | --- | --- | --- | --- |
| `rt.stats.season`（statLine） | `recordAppearance`（累加）/ `resetSeasonStats`（重置） | `derivePlayerStats` → UI/快照 | 当前赛季 | 是（runtime） | 是（本季） |
| `rt.stats.career`（statLine） | `recordAppearance`（累加） | 退役归档（player-lifecycle L157）、快照 | 生涯 | 是（runtime） | 是（生涯） |
| `involvements` | `buildInvolvements`/`applyMatchPerformance` | `#applyPostMatch` | 单场 | 否（transient） | 否（输入） |
| `ratingSum` | `recordAppearance`（Σ round(rating×10)） | `deriveAverageRating` | 赛季/生涯 | 是 | 是 |
| `averageRating` | `deriveAverageRating`（**派生，不存储**） | 快照/UI/ai-potential-estimate | 派生 | 否 | 派生 |

### 二、Unique Stats Writer
**`recordAppearance`（[player-runtime.js#L490](file:///workspace/FE-project/src/core/player-runtime.js#L490)）为唯一累计 Writer。** 其它对 `stats.season/career` 的写操作均为非累计：`createPlayerRuntime`（初始化 [L233-L237](file:///workspace/FE-project/src/core/player-runtime.js#L233-L237)）、`normalizePlayerRuntime`（载入补齐 [L258-L264](file:///workspace/FE-project/src/core/player-runtime.js#L258-L264)）、`resetSeasonStats`（仅重置 season [L648-L653](file:///workspace/FE-project/src/core/player-runtime.js#L648-L653)）。**无 `applyStats/mergeStats/updateStats/incrementStats` 等第二 Writer。PASS。**

### 三、recordAppearance Contract
- Input：`{minutes?,goals?,assists?,yellow?,red?,shots?,shotsOnTarget?,rating?}`（缺省 0）。
- Mutation：对 `rt.stats.season` 与 `rt.stats.career` **各自 `+=`**（appearances+1、minutes/goals/assists/yellow/red/shots/shotsOnTarget/ratingSum）。
- Output：返回 `rt`。
- Side Effects：仅改该球员 runtime stats；**不改** MatchCore / World / Save / 其它统计。**PASS。**

### 四、Season / Career Ownership
赛季与生涯均被同一输入**直接 `+=`** → **INDEPENDENT ACCUMULATION**（非 career-from-season 派生）。**PASS。**

### 五、Season Reset
`resetSeasonStats`：唯一 Writer；仅重置 `stats.season = createStatLine()` + `seasonNumber`；**不动 career / runtime 其它字段**；调用点唯一 = [simulation.js#L251](file:///workspace/FE-project/src/core/simulation.js#L251)，**仅在 `maxSeason > prevSeason`（赛季推进）时执行一次**，不在比赛中调用。**新赛季清 Season、保 Career。PASS。**

### 六、Career Lifetime
`career` 跨比赛、跨赛季持续累加；不随 `resetSeasonStats` 清零；退役时以**只读快照**复制进归档（[player-lifecycle.js#L157](file:///workspace/FE-project/src/core/player-lifecycle.js#L157)）随后移除 runtime（L164）——归档为退役者快照，非第二活动 Truth。**正常赛季切换不丢失。PASS。**

### 七、Match → Stats Mapping
| Match Simulation | Runtime Stats |
| --- | --- |
| `involvements[].goals` | `goals +=` |
| `involvements[].assists` | `assists +=` |
| （每次调用） | `appearances += 1` |
| `involvements[].minutes` | `minutes +=` |
| `involvements[].yellow/red` | `yellow/red +=` |
| `involvements[].shots/shotsOnTarget` | `shots/shotsOnTarget +=` |
| `involvements[].rating`（单场） | `ratingSum += round(rating×10)` |
无字段丢失、无一对多映射。**PASS。**

### 八、Goals Boundary
球员 `goals` 唯一路径：`goalEvents`(actorId match) → `applyMatchPerformance.goals` → `involvements.goals` → `recordAppearance`。比分 `fixture.homeGoals/awayGoals` 走 `applyResult` → 积分表，**不转成球员 goals**。`buildInvolvements` 的 `rec.goals += 1` 随后被 `mergePerformance` **覆盖为同值**（非叠加），无重复计数。**PASS。**

### 九、Assists Boundary
`assists` 由 `applyMatchPerformance` RNG 生成 → `involvements.assists` → `recordAppearance`。属 **Match Performance Statistic（非 per-goal 归属）**；本 Gate 未将其升级为 Assister/Goal Attribution。**PASS。**

### 十、Appearance Boundary
`appearances += 1` 每次 `recordAppearance` 一次；调用方 `#applyPostMatch` 每 involvement 一次；`#playFixture` 有 `fixture.played` 守卫 → **每场每球员最多记一次**。**PASS。**

### 十一、Minutes Boundary
来源：`buildInvolvements`（minutesMap 或 90）。`recordAppearance` 校验为非负整数；`minutes > MAX_MINUTES_PER_MATCH` 抛 `SimulationError`。不可超单场上限、不可重复（appearance 守卫）。**PASS。**

### 十二、Card / Shooting Stats
`yellow/red/shots/shotsOnTarget`：Writer 唯一 = `recordAppearance`；来源 `involvements`（`applyMatchPerformance` RNG）；无第二 Writer、无重复计数。**现状如此，未新增约束。PASS。**

### 十三、Rating Boundary
`rating` = **单场**输入（clamp [MIN,MAX]）；`ratingSum` = Σ round(rating×10) 纯累加；`averageRating` 由 `deriveAverageRating(ratingSum, appearances)` **派生、不存储**。无第二 Rating Truth、无语义混淆。**PASS。**

### 十四、Numeric Safety
`recordAppearance` 对 minutes/goals/assists/yellow/red/shots/shotsOnTarget：**reject** 非整数/负数（抛 `SimulationError` L503-L508）；minutes 上限校验；rating 非有限值 **reject**、合法值 **clamp**；rating 缺省跳过（ratingSum=0）。**非法输入不会污染 stats。PASS。**

### 十五、Negative / Overflow Boundary
负数统计被 Writer 拒绝（抛错），Normalize 在载入时 `floor` 且 `>0 else 0` 夹取。`ratingSum` 因单场 rating 已 clamp 而有界。**PASS。**

### 十六、Persistence Boundary
`stats.season/career` 属 `state.runtime`（[game-state.js#L7](file:///workspace/FE-project/src/core/game-state.js#L7)）；存档只持久化 runtime 增量（[save-manager.js#L24-L34](file:///workspace/FE-project/src/save/save-manager.js#L24-L34)）。唯一 Persistence Writer = `serializeState`。**PASS。**

### 十七、Save / Load Round Trip
`serializeState` → `{worldId,currentDate,season,runtime}`；`deserializeState` → `normalizePlayerRuntime`（补缺、夹取）保留 season/career。**无字段丢失、无第二 Stats、无重复累计。PASS。**

### 十八、New Season Lifecycle
`Season End → developPlayers → runPlayerLifecycle → … → resetSeasonStats → Season N+1`。**Career 保留、Season 清零。** 符合预期，无架构冲突。**PASS。**

### 十九、Runtime vs Aggregate Boundary
`simulateMatch` 产出的 **involvements = Aggregate Match Statistic Input**；`rt.stats` 为 **Player Runtime Statistical State**；二者非同一对象。**PASS。**

### 二十、Simulation Core Boundary
Stats Writer 不写 `MatchCore.score / scoringPlayerId / lastTouchPlayerId / possession / control / second-ball`。Stats 为旁路统计，**不反向影响球级 Simulation Truth**。**PASS。**

### 二十一、Second Stats Truth Audit
活动球员统计唯一对象 = `state.runtime.players[].stats`（含 season/career）。`retired` 为退役快照（非活动 Truth）；`involvements` 为 transient 输入。**无第二套可写 Season/Career Stats。PASS。**

### 二十二、Determinism
Stats 写入不使用 `Date.now / performance.now / wall clock`（`recordAppearance` 无 RNG/时间）。同输入 → 同 mutation。**PASS。**

### 二十三、Contract Status
`Career Stats` / `Appearance` / `Minutes` / `Goals Stats` / `Assists Stats` / `Cards` / `Shooting Stats` / `Rating` = 均 **UNFROZEN**（本 Gate 不冻结）。

### 二十四、Files Changed
仅本文件（§74 追加）。**src/ = 0，tests/ = 0。**

### 二十五、Contract Changes
**无。**

### 二十六、Remaining Risks
1. `recordAppearance` 在 `frame` 校验上采取「抛错」策略；若未来新增调用方传入非法整数会中断 simulation（现有调用方均合规）。
2. `rating` 单场与 `ratingSum` 累计并存，语义清晰但未以 Contract 文档化；若引入赛事级评分重算须另立 Gate。
3. Season/Career 统计字段均为 UNFROZEN，文档已如实标记。

**STOP — 不得进入 C-68，不得修改 Stats / recordAppearance / resetSeasonStats / Season Simulation / Career Stats / Save，不得冻结 Stats Contract，不得修改 Scorer / Assister / Involvement / Simulation Core / LastTouch / Goal Resolution / C-14 / C-15 / C-20 / C-21。等待 Owner 验收。**

## §75 Player Runtime / Retirement Snapshot Boundary Audit（Step 39F-M-C-68）

**Gate Result = PASS / SEALED（Read-Only Audit）。** Architecture Conclusion = **PASS / SEALED + ARCHITECTURE NOTE**。

### 一、Active Runtime Stats Truth
**唯一 Active Stats Truth = `state.runtime.players[playerId].stats`（含 `season` / `career`）。**
- 创建：`createPlayerRuntime`（[player-runtime.js#L233-L237](file:///workspace/FE-project/src/core/player-runtime.js#L233-L237)）
- 累加：`recordAppearance`（唯一累计 Writer）
- 重置：`resetSeasonStats`（仅 season）
- 删除：`archiveRetired`（[player-lifecycle.js#L164](file:///workspace/FE-project/src/core/player-lifecycle.js#L164)）
- 持久化/恢复：`serializeState` / `normalizePlayerRuntime`
- 无竞争的第二个 active stats object。**PASS。**

### 二、Retirement Flow
`runPlayerLifecycle` → `processRetirements`（[player-lifecycle.js#L180-L196](file:///workspace/FE-project/src/core/player-lifecycle.js#L180-L196)）→ 遍历 `getWorldPlayers` 计算退役概率 → `archiveRetired`。**确定性**：`createRng(hashSeed(worldId|retire|season|playerId))`；`ageOn(birthDate, state.currentDate)`（非 wall clock）。**PASS。**

### 三、Archived Snapshot Flow
`archiveRetired`（[player-lifecycle.js#L139-L174](file:///workspace/FE-project/src/core/player-lifecycle.js#L139-L174)）顺序：
1. 取 `rt`、终值合同快照（复制，不共享引用）；
2. **写入** `state.runtime.retired[playerId] = { playerId, retiredSeason, lastTeamId, generated, profile{name,position,birthDate,attributes,potential,personality}, career:{...rt.stats.career}, finalDeltas:{...deltas}, contract }`；
3. `terminateContract` → **`delete state.runtime.players[playerId]`** → `delete runtime.generated[id]` → `removePlayerMembership` → `recordEvent('player_retired')`。

**Career 为 `{...}` 浅拷贝（不与 rt 共享引用）。Archive 不持有 season stats / vitals / injury / growth / seasonNumber。**

### 四、Stats Writer / Reader Audit
| 角色 | 文件·函数 | 对象 | 唯一 | 第二 Truth |
| --- | --- | --- | --- | --- |
| Active Stats Writer | [player-runtime.js `recordAppearance`](file:///workspace/FE-project/src/core/player-runtime.js#L490) | `rt.stats.season/career` | 是 | 否 |
| Active Stats Reader | `derivePlayerStats` / 快照 / `ai-potential-estimate` | `rt.stats`（只读） | — | 否 |
| Retirement Writer | [player-lifecycle.js `archiveRetired`](file:///workspace/FE-project/src/core/player-lifecycle.js#L139) | `runtime.retired[id]` + 删 `runtime.players[id]` | 是 | 否 |
| Archive Writer | 同上（唯一写入点） | `runtime.retired[id]` | 是 | 否 |
| Archive Reader | `isRetired`/`free-agent`/`contract`/`membership`/`transfer` | 仅 `Boolean(retired[id])` **存在性** | — | 否 |
| Archive Mutator | **无** | — | — | 否 |
| Persistence Writer | [save-manager.js `serializeState`](file:///workspace/FE-project/src/save/save-manager.js#L24) | `runtime`（含 retired） | 是 | 否 |
| Persistence Reader | `deserializeState`/`initializePlayerRuntime` | `runtime` | 是 | 否 |
| Reset Writer | `resetSeasonStats` | `rt.stats.season` | 是 | 否 |
| Delete/Removal Authority | `archiveRetired`（删 players[id]）+ `initializePlayerRuntime`（读档剔除已退役） | `runtime.players` | — | 否 |

### 五、Career Stats Lifecycle
retirement 前完整存在于 `runtime.players[id].stats.career` → 退役时 **A. 被完整复制（浅拷贝）到 archive.career**（非引用/移动/重算/重累计/部分丢失）→ active rt **随后删除**。**无 career 丢失、无重复累计。PASS。**

### 六、Season Stats Lifecycle
退役时 `stats.season` **未归档**（archive 只含 career）→ 随 `rt` 删除而消失。属既有语义（本 Gate 不修改）。**记录：SEASON STATS NOT ARCHIVED（UNFROZEN）。**

### 七、Save / Load Boundary
`serializeState` → `{worldId,currentDate,season,runtime}`（含 `runtime.retired`）。`deserializeState`：`retired ??= {}`（**不 normalize archive**）；`initializePlayerRuntime`（[player-runtime.js#L303-L321](file:///workspace/FE-project/src/core/player-runtime.js#L303-L321)）对静态/新生代中**已退役者删除 `runtime.players[id]`**（不复活）。load 后**不产生 active+archive 双份可写 Stats**；archive 不被 normalize 成 active runtime。**PASS。**

### 八、Database vs Runtime Boundary
`players.json` 记录字段仅 id/teamId/position/attributes/birthDate/potential/personality/name（[data-loader.js](file:///workspace/FE-project/src/data/data-loader.js)），**无 career/appearances/goals/assists/season/rating**（全局代码仅文档出现 `careerStats`）。→ **DATABASE INITIAL DATA ≠ RUNTIME STATISTICS，无竞争 Truth。PASS。**

### 九、Involvements Boundary
`involvements`（transient）→ `recordAppearance` → `rt.stats`，**生命周期在写入 stats 后结束**；不进入 archive、不成为长期 Truth。**PASS。**

### 十、Second Truth Audit
1. active runtime stats 唯一 Active Truth？**是**
2. careerStats 存在第二份长期 Truth？**否**（archive.career 为只读快照）
3. retired archive 仅为 Snapshot？**是**
4. archive 可变？**否**（无 Mutator）
5. archive 重新参与 Stats Writer？**否**
6. database 与 runtime 竞争？**否**
7. involvements 成为长期 Truth？**否**
8. save data 独立 Stats Truth？**否**（同一对象序列化）
9. load 后重复 Stats Object？**否**
10. 隐藏 Stats Writer？**无**

**结论：PASS / SEALED + ARCHITECTURE NOTE。**

### 十一、Retirement Semantics
Retirement = **C. Both（Runtime Removal + Archive Creation）**。
- 退役者**不在** `runtime.players[]`（已 delete）。
- archive 持**完整 career stats（浅拷贝）**；**不持 season stats**；持属性终值（profile.attributes/potential/personality + finalDeltas）；**不持** vitals/injury/growth。
- archive **不可继续模拟、不可再次 `recordAppearance`**（rt 已删；`requirePlayerRuntime` 抛 `SimulationError`；`getWorldPlayers` 过滤退役者；per-tournament 入口亦排除）。
- **UNFROZEN / UNDEFINED**：archive.career 当前**无 Reader 消费其内容**（仅存在性检查）——即当前**写而不用**的历史快照。

### 十二、Determinism Audit
retirement 路径无 `Math.random / Date.now / performance.now`；使用 `hashSeed(worldId|retire|season|playerId)` 独立流与 `state.currentDate`。**PASS。**

### 十三、Tests
`npm test` → **1552 通过，0 失败（共 1552 个用例）**。

### 十四、Files Changed
仅本文件（§75 追加）。**src/ = 0，tests/ = 0。**

### 十五、Contract Changes
**无。**（未冻结 Career/Season Stats Contract、Retirement Contract、Archive Schema Contract。）

### 十六、Implementation Gaps
1. **archive.career 写而不用**：无 Consumer 读取归档 career 内容（仅判定退役存在性）。→ 记录为 GAP，不实现。
2. **season stats 不归档**：退役时 season stats 丢弃。→ 语义未定义（UNFROZEN），不补实现。
3. **archive 不 normalize**：load 后 archive 内容不做字段补齐/夹取。→ UNFROZEN。

### 十七、Remaining Risks
1. 若未来新增读取 `runtime.retired[].career` 的展示/统计模块，需先定义 Archive Read Contract，否则可能与 active stats 语义混淆。
2. `retired` 归档永久驻留 `runtime`（随存档增长）；无 GC/压缩策略。
3. Career/Season/Retirement/Archive 均 UNFROZEN，文档已如实标记。

**STOP — 不得进入 C-69，不得实现 Retirement / Archive，不得冻结 Stats / Retirement / Archive Contract，不得修改 recordAppearance / resetSeasonStats / Save / Player Runtime Schema / Simulation Core / Goal Attribution / LastTouch。等待 Owner 明确指令「继续」。**

## §76 Player Statistics Semantic Contract Audit（Step 39F-M-C-69）

**Gate Result = PASS / SEALED（Read-Only Semantic Audit）。** Architecture Conclusion = **PASS / SEALED**（无第二 Truth、无统计口径冲突）。

### 一、Statistics Truth Map
| 字段 | Writer | Reader | 生命周期 | 语义 |
| --- | --- | --- | --- | --- |
| `appearances` | `recordAppearance` | `getPlayerStatsView` / `deriveAverageRating` / ai-potential-estimate | season+career | 上场次数（>0 分钟） |
| `minutes` | 同上 | 统计视图/拆分 | season+career | 上场分钟 |
| `goals` | 同上（源自 `goalEvents`） | 统计视图/评分/能力信号 | season+career | 进球数 |
| `assists` | 同上（RNG 表现） | 统计视图/评分 | season+career | 表现统计量（非 per-goal 归属） |
| `yellow`/`red` | 同上（RNG 表现） | 统计视图 | season+career | 牌数 |
| `shots`/`shotsOnTarget` | 同上（RNG 表现） | 统计视图/评分 | season+career | 射门/射正 |
| `ratingSum` | 同上（Σ round(rating×10)） | `deriveAverageRating`/ai-potential-estimate | season+career | 评分累计（存储） |
| `averageRating` | `deriveAverageRating`（**派生不存储**） | UI 快照/能力信号 | 派生 | 平均评分 |

唯一 Stats 对象 = `state.runtime.players[].stats.{season,career}`（statLine 8 字段 + ratingSum）。

### 二、Appearance Audit
Writer：`recordAppearance`（appearances += 1）；Reader：`getPlayerStatsView`、`deriveAverageRating`、`ai-potential-estimate`。增长时机：`#applyPostMatch` 对每个 involvement 一次，`#playFixture` 有 `fixture.played` 守卫 → **每场每人最多 +1**。involvements 只为 `minutes>0` 的球员构建（[simulation.js#L173-L174](file:///workspace/FE-project/src/core/simulation.js#L173-L174)）→ **appearance = 获得 >0 分钟上场**（非"列入名单"）。Season/Career 独立。退役后不可再写。**CURRENT SEMANTICS IDENTIFIED。**

### 三、Minutes Audit
Writer 同上；读取：领队/拆分。来源：`plan.minutesByPlayer`（默认 `MINUTES_PER_MATCH`=90）；**整数**；范围 [0, MAX_MINUTES_PER_MATCH]，超出抛错（[player-runtime.js#L509-L513](file:///workspace/FE-project/src/core/player-runtime.js#L509-L513)）。未出场无 minutes（involvements 已过滤）。Season/Career 各自累计。无第二 Minutes Truth。**CURRENT SEMANTICS IDENTIFIED。**

### 四、Goals Audit
**唯一来源 = `goalEvents`**：`applyMatchPerformance.goals = goalEvents.filter(actorId===p.id)`（[match.js#L206](file:///workspace/FE-project/src/core/match.js#L206)）→ `involvements.goals` → `recordAppearance`。`buildInvolvements` 的 `rec.goals += 1`（事件遍历）随后被 `mergePerformance` **等值覆盖**（非叠加）。`selectScorer` 仅决定 `actorId`（Season 层）。Simulation Core `scoringPlayerId` 属**不同系统**（C-64）。**无重复累计。CURRENT SEMANTICS IDENTIFIED。**

### 五、Assists Audit
1. `assists` = **每场（逐球员）RNG 表现统计量**，非真实 per-goal 助攻归属。
2. 是"每场比赛表现统计"。
3. **不等价于真实助攻**（无具体进球绑定）。
4. **不与具体进球绑定**（`assistId` 恒 null 且无 Reader）。
5. **无第二 Assists Truth**（`events[].assistId` 未参与任何 Stats Writer）。
6. **不可能无进球产生 assist**（循环 `goalEvents`）；每球至多 1（`Σassists ≤ Σgoals`）。
7. `assistId` 对现有 Stats Writer **无任何影响**。
8. **当前保持 `<assistId>` 与 `<assists>` 分离**（C-66 结论不变）。

`assists` 语义已识别且无冲突；「是否将 `assists` 升级为真实助攻归属」属 **OWNER_DECISION_CANDIDATE**（本 Gate 不统一、不冻结）。

### 六、Cards Audit
`yellow`/`red`：Writer = `recordAppearance`（源自 `applyMatchPerformance` 逐球员独立 RNG 流，`yellow∈{0,1}`、`red∈{0,1}`）；Reader = 统计视图。Season/Career 独立。无 Match Card Event Truth（`type='yellow'/'red'` 分支无事件产生）；无重复写入。**CURRENT SEMANTICS IDENTIFIED。**

### 七、Shooting Audit
`shots`/`shotsOnTarget`：来源 = `applyMatchPerformance` RNG；Writer 唯一；Reader = 统计视图/评分。守恒 **`shots ≥ shotsOnTarget ≥ goals`**（[match.js#L207-L208](file:///workspace/FE-project/src/core/match.js#L207-L208)）。**与 MatchCore Shot / Goal Resolution 无直接 Truth 关系**（不同模块，边界保持）。无重复统计。**CURRENT SEMANTICS IDENTIFIED。**

### 八、Rating Audit
链路唯一：`single-match rating`（[match.js#L231-L241](file:///workspace/FE-project/src/core/match.js#L231-L241)，确定性、无 RNG、不依赖 vitals）→ `ratingSum += round(rating×10)` → `averageRating = deriveAverageRating`（**derived value，不持久化**，[player-runtime.js#L61-L66](file:///workspace/FE-project/src/core/player-runtime.js#L61-L66)）。season/career **都有** ratingSum。无第二 Rating Truth。
**边界记录**：`averageRating`（派生）被 [ai-potential-estimate.js#L100](file:///workspace/FE-project/src/core/ai/ai-potential-estimate.js#L100) 作为**只读信号**参与能力潜力估计（Rating → 能力信号，读取路径，非写回 rating）；**不反向影响 MatchCore**。**CURRENT SEMANTICS IDENTIFIED。**

### 九、Season / Career Boundary
season/career 由 `recordAppearance` **各自独立 `+=`**（INDEPENDENT ACCUMULATION）；`resetSeasonStats` 只清 season；新赛季保 career；Save/Load 保留两者；退役时 career 复制进 archive（C-68）。**从不从 season 重算 career。PASS。**

### 十、Writer / Reader Matrix
| 对象 | Writer | Reader | 唯一 | Second Truth |
| --- | --- | --- | --- | --- |
| season/career statLine | `recordAppearance` | `getPlayerStatsView` / AI 信号 / 快照 | 是 | 否 |
| season reset | `resetSeasonStats` | — | 是 | 否 |
| ratingSum | `recordAppearance` | `deriveAverageRating` | 是 | 否 |
| averageRating | `deriveAverageRating`（派生） | UI / AI | 是 | 否 |
| involvements | `buildInvolvements`/`applyMatchPerformance` | `#applyPostMatch` | 是 | 否（transient） |

### 十一、Second Truth Audit
| 对象 | 边界 |
| --- | --- |
| `goalEvents` | B. transient input |
| `match events` | B. transient aggregate |
| `score`(homeGoals/awayGoals) | D. unrelated aggregate（赛季积分） |
| `scoringPlayerId` | D. unrelated（Core 系统） |
| `involvements` | B. transient input |
| `careerStats` | A. Stats Truth（career 线） |
| `seasonStats` | A. Stats Truth（season 线） |
| `ratingSum` | A. Stats Truth（存储累加） |
| `averageRating` | C. derived value |
| `player database stats` | 不存在 |
| `retired archive` | 只读历史快照（非活动 Truth，C-68） |

无竞争对象。**PASS。**

### 十二、Persistence Audit
`serializeState → save → load → normalizeStatLine`（[player-runtime.js#L147-L164](file:///workspace/FE-project/src/core/player-runtime.js#L147-L164)）保持 8 字段 + ratingSum。**无字段丢失、无重复、无重算改值**；`averageRating` 不入库（派生）。load 后无第二 Stats Truth。**PASS。**

### 十三、Determinism Audit
表现字段 RNG 来源：`hashSeed(matchSeed|perf|side|playerId)`（射门/牌）与 `hashSeed(matchSeed|assist|side|minute|scorerId)`（助攻），**逐球员/逐进球独立流**，绝不进入比分 RNG；评分**无 RNG**。Seed 源自 `deriveMatchSeed(worldId|season|round|home|away)`。**无 `Math.random/Date.now/performance.now`。PASS。**

### 十四、Contract Status
- Appearance / Minutes / Goals / Cards / Shooting / Rating = **CURRENT SEMANTICS IDENTIFIED**（RECOMMENDED FREEZE CANDIDATE，待 Owner 决定）。
- Assists = **CURRENT SEMANTICS IDENTIFIED**；「是否把 `assists` 提升为真实助攻归属」= **OWNER_DECISION_CANDIDATE**（保持现状分离）。
- 本 Gate **不宣布任何 Owner Freeze**。

### 十五、Implementation Gaps（仅记录）
1. `events[].assistId` 恒 null 且无 Reader（保留字段）。
2. `buildInvolvements` 的 `type='assist'/'yellow'/'red'` 分支为死代码（无对应事件）。
3. `averageRating` 伴随 `ratingSum` 无独立契约文档（本 Gate 已记录链路）。

### 十六、Remaining Risks
1. `averageRating` 已被 AI 潜力估计读取，构成 Rating→能力信号链；若未来调整需同步评估。
2. `assists`（RNG 表现）语义未 Contract 化；若引入真实助攻归属须另立 Gate。
3. 各统计字段 CONTRACT 均未冻结，文档已如实标记。

### 十七、Files Changed
仅本文件（§76 追加）。**src/ = 0，tests/ = 0。**

### 十八、Tests
`npm test` → **1552 通过，0 失败（共 1552 个用例）**。

### 十九、Contract Changes
**无。**

**STOP — 不得进入 C-70，不得 Freeze Stats Contract，不得修改 Assist / Rating / Goals / Cards / Shooting / Career / Season / Retirement / Archive。等待 Owner 明确指令「继续」。**

## §77 Player Statistics Contract Freeze（Step 39F-M-C-70）

**Gate Result = PASS / SEALED（Owner Contract Freeze / Documentation-Only）。** 本 Gate 不修改任何**生产逻辑**。src/ = 0，tests/ = 0，docs/ = 1。

### 一、Frozen Stats Truth
Active Player Statistics 的**唯一 Runtime Truth = `runtime.players[].stats`**，分 `season` / `career` **两套独立累计对象**。
禁止建立第三套（`matchStats` / `databaseStats` / `aggregateStats` / writable `archiveStats` / score-derived player stats）作为 Active Stats Truth。

### 二、CONTRACT TABLE
| Field | Status |
| --- | --- |
| appearances | **FROZEN** |
| minutes | **FROZEN** |
| goals | **FROZEN** |
| yellowCards | **FROZEN** |
| redCards | **FROZEN** |
| shots | **FROZEN** |
| shotsOnTarget | **FROZEN** |
| ratingSum | **FROZEN** |
| averageRating | **FROZEN / DERIVED** |
| assists | **UNFROZEN** |

「FROZEN」= 当前语义成为后续架构的正式 Contract，**非"永不改变"**；未来修改须经新 Gate。

### 三、Appearances Contract（FROZEN）
`appearances` = 该球员在该场获得 **> 0 分钟**的实际出场次数（`minutes > 0 → appearances += 1`）。
- 每名球员每场最多 +1；`fixture.played` 防重复消费；
- Season / Career 独立累计；
- 无分钟不得产生 Appearance；
- **≠**"进入比赛名单"，**≠**"选入阵容但未上场"。
- 唯一累计 Writer = `recordAppearance`（不得新增其他 Appearance Writer）。

### 四、Minutes Contract（FROZEN）
`minutes` = 该球员本场实际获得的比赛分钟数。来源 `plan.minutesByPlayer`。
- 非负整数；不超过 `MAX_MINUTES_PER_MATCH`；未出场 = 0；
- Season / Career 独立累计；不由 Appearance / Match Score 反推。
- 唯一 Stats Writer = `recordAppearance`。

### 五、Goals Contract（FROZEN）
Season/Career Player Goals 来源链：`goalEvents → applyMatchPerformance → involvements.goals → recordAppearance`。
- `goalEvents` 为 Player Goals 的 **transient source**；
- 持久化 Truth = `runtime.players[].stats.{season,career}.goals`；
- **禁止** `teamScore → playerGoals`；**禁止** `scoringPlayerId → 再次累计 Player Goals`；
- Simulation Core `scoringPlayerId` 与 Season Aggregate `involvements.goals` 属**不同 Simulation Layer**，未经新 Gate 授权不得直接连接。

### 六、Cards Contract（FROZEN）
`yellow` / `red` = Season Aggregate Match Performance 的球员牌面统计，来源**独立 RNG Performance Streams**。
- 单场当前各最多 1；Season / Career 独立累计；唯一 Stats Writer = `recordAppearance`；
- 当前**不存在**独立 Match Card Event Truth；不得自行新增 Card Event System。
- 注：冻结的是**当前统计语义**，非声明未来永无 Card Event System——若未来建立真实 Match Card Event，须另开 Gate 审计其与 Stats 关系。

### 七、Shooting Contract（FROZEN）
`shots` / `shotsOnTarget` = Season Aggregate Match Performance 的球员射门表现统计（RNG），约束 `shots ≥ shotsOnTarget ≥ goals`。
- **不属于** MatchCore Shot Truth，**不属于** Goal Resolution Truth；
- 禁止未经新 Gate 将 `MatchCore Shot` / `Goal Resolution` / `shots` / `shotsOnTarget` 合并为单一 Truth；
- Player Stats 只消费 Aggregate Match Performance 当前提供的统计输入。

### 八、Rating Contract（FROZEN）
链路：`single-match rating`（单场 Performance Rating，当前无 RNG）→ `ratingSum`（累计总和）→ `averageRating`（派生）。
- 唯一 Stats Writer = `recordAppearance`；Season / Career 独立累计；
- `averageRating = ratingSum / appearances / 10`（派生统计）；
- `averageRating` **不持久化、不作为独立 Writer、不作为独立 Truth、不参与 Stats 累计**。

### 九、Rating → AI Signal Boundary（FROZEN）
当前存在**只读消费**关系：`Stats → averageRating → ai-potential-estimate`。
- **允许**：AI Potential Estimate 读取 `averageRating`；
- **禁止**：AI Potential Estimate 反向修改 `rating` / `ratingSum` / `averageRating` / `goals` / `abilities` / MatchCore；
- 本 Gate 不修改该链路；未来若修改 Rating 公式，**必须重新审计 AI Potential Estimate**。

### 十、Season / Career Contract（FROZEN）
Season Stats 与 Career Stats 为**两个独立累计生命周期**。
- Match：`recordAppearance → season += 且 career +=`（各自独立）；
- Season End：`resetSeasonStats()` **只清 Season**；**不得** `career = season` 或 `career = Σseason snapshots`；Career 不允许由 Season 重算；
- Retirement：Career 可被**复制**进 Archive Snapshot；Active Runtime Stats 删除后 `runtime.players[playerId]` 不再存在；**Archive 不是 Active Stats Truth**。

### 十一、Persistence Contract（FROZEN）
Save/Load 必须保持 season stats、career stats、ratingSum 及其他已存在 Stats 字段；`averageRating` **不持久化**。
流程：`runtime.stats → serializeState → save → load → normalize → runtime.stats`。
**禁止**：load 后随机重算 Stats；load 后由 Match Score 推导 Player Stats；load 后从 Archive 反向恢复 Active Stats；建立第二套 writable Stats object。

### 十二、Assist Non-Freeze Declaration
**`assists` 不进入 Frozen Contract**（保持 **UNFROZEN / PERFORMANCE-STAT SEMANTICS IDENTIFIED**）。
- `involvements.assists` = Aggregate Match Performance Statistic，**不定义为真实逐球助攻**；
- `events[].assistId` 保持 **RESERVED / UNUSED**；
- **不得**：删除 `assistId` / 实现 `assistId` / 合并 `assists` 与 `assistId` / 修改 `assists` 算法 / 新增助攻 Attribution。
- 未来若需真实助攻，须独立 Gate，至少重新审计：Goal Event / Pass / Shot / Scorer / Assister / Deflection / Own Goal / Rebound / LastTouch。

### 十三、Second Truth Boundary（FROZEN）
| 层 | 对象 |
| --- | --- |
| Stats Truth | `runtime.players[].stats` |
| Transient Input | `involvements` |
| Goal Attribution Input | `goalEvents` / `scoringPlayerId` |
| Derived | `averageRating` |
| Unrelated Aggregate | `team score` / `MatchCore score` |
| Archive（非 Active Truth） | `runtime.retired[].career` |

### 十四、Implementation Gaps（仅记录）
1. `events[].assistId` 恒 null 且无 Reader（RESERVED）。
2. `buildInvolvements` 的 assist/yellow/red 分支为死代码。
（本 Gate 不实现，不修复。）

### 十五、Remaining Risks
1. `averageRating` 已构成 Rating→AI 能力信号链；修改 Rating 公式须同步审计 ai-potential-estimate。
2. `assists` 仍 UNFROZEN；引入真实助攻归属须另立 Gate。
3. 冻结的是当前语义；未来任何修改须经新 Gate。

### 十六、Files Changed
仅本文件（§77 追加）。**src/ = 0，tests/ = 0。**

### 十七、Tests
`npm test` → **1552 通过，0 失败（共 1552 个用例）**。

### 十八、Contract Changes
新增 **Player Statistics Contract Freeze**：appearances / minutes / goals / yellow / red / shots / shotsOnTarget / ratingSum / averageRating = **FROZEN**；assists = **UNFROZEN**。未修改任何既有 Frozen Contract。

**STOP — 不得进入 C-71，不得实现 Assist Attribution，不得修改 Rating / Goals / Shooting / Cards / Appearance / Minutes / AI Potential / Retirement / Archive。等待 Owner 明确指令「继续」。**

## §78 Player Retirement / Career Archive Contract Audit（Step 39F-M-C-71）

**Gate Result = PASS / SEALED（Read-Only Lifecycle Contract Audit）。** Architecture Conclusion = **PASS / SEALED + ARCHITECTURE NOTE**（Season Archive 语义待 Owner 决策，不构成第二 Truth）。

### 一、Retirement Semantics（CURRENT SEMANTICS IDENTIFIED）
触发生效路径：`runPlayerLifecycle → processRetirements → archiveRetired`（[player-lifecycle.js#L139-L196](file:///workspace/FE-project/src/core/player-lifecycle.js#L139-L196)）。
1. 触发条件：`retireProbability(age, curve)` 曲线；`age < curve.hardCap` 时以 `createRng(hashSeed(worldId|retire|season|playerId))` 二次门槛，`age ≥ hardCap` 必退。
2. **deterministic**（逐球员独立 seed）。
3. **立即生效**（同一次生命周期事务内完成移除）。
4. 退役后**不可**继续参赛（`getWorldPlayers` 过滤）。
5. 从 `runtime.players` 删除（L164）。
6. 从世界/球队成员移除（`removePlayerMembership`，L167）。
7. 终止合同（`terminateContract`，L163）。
8. 删除 `runtime.generated[id]`（若为新生代，L165）。
9. 产生 `player_retired` 事件（L168）。
10. **无第二 Retirement Truth**（`retired` 唯一写入点 = `archiveRetired`）。

### 二、Retirement Truth
= **C（A + B）**：`Retirement = Active Runtime Removal + Archive Snapshot Creation`。
- `runtime.players[id]` 不存在（A）；
- `runtime.retired[id]` 存在（B）。
- **无任何位置**把 `runtime.retired[id]` 当作 Active Player Runtime（所有引用仅 `Boolean(retired[id])` 存在性判定）。

### 三、Career Archive Audit
`runtime.retired[id].career = rt ? { ...rt.stats.career } : {appearances:0,...}`（[L157](file:///workspace/FE-project/src/core/player-lifecycle.js#L157)）。
- 来源：退役瞬间的 `rt.stats.career`；Writer = `archiveRetired`（唯一）；
- Reader = **无 Content Reader**（见 §十一）；
- **shallow copy**（一次性 Snapshot），**非** shared reference / derived / independently writable；
- 与 Active Career 共存：Active 对象随后 `delete`。
**结论：`Active stats.career → retirement → archive.career` 为一次性 Snapshot；`Archive Career ≠ Active Career Stats`。**

### 四、Season Stats Retirement Audit
1. 退役时 `stats.season` 仍存在于 `rt`（即刻）；`rt` 随后被 `delete`。
2. 删除 `runtime.players[id]` 后 Season Stats **不可恢复**。
3. **不存在其他 Season Stats Copy**（无 matchStats/aggregate 持久副本）。
4. 无任何比赛/统计模块保存退休球员 Season Stats。
5. Archive **不保存退役赛季数据**（archive 只含 `career`）。
6. 当前 Schema **不具备** season-archive 字段。
7. **不自补 Schema**。→ 标记 **OWNER_DECISION_REQUIRED**（是否归档退役赛季 Season Stats），**不 BLOCK**（非第二 Truth，仅缺口）。

### 五、Career Statistics Relationship
退役前 Active Truth = `runtime.players[id].stats.career`；退役时复制为 `runtime.retired[id].career`（最终 Career Snapshot）。
复制字段（浅拷贝全量）：`appearances / minutes / goals / assists / yellow / red / shots / shotsOnTarget / ratingSum` **全部复制**。
`averageRating` **不归档**（派生、不持久化，符合 C-70）——archive **只含 `ratingSum`**。

### 六、Final Attribute Snapshot
`archive.profile = { name, position, birthDate, attributes: pickAttributes(player), potential:{...}, personality:{...} }`（[L149-L156](file:///workspace/FE-project/src/core/player-lifecycle.js#L149-L156)）；`archive.finalDeltas = rt ? {...rt.ability.deltas} : {}`。
- 完整保存最终能力增减（deltas）与基础 Profile（attributes/potential/personality）；
- **无第二 Attributes Truth**（均复制）；
- Archive Attribute **不可写**（无 Mutator）；
- **不会反向修改 World Player**。

### 七、Contract Snapshot
`archive.contract = contract ? {...contract} : null`（快照于 `terminateContract` **之前**，[L143/L160/L163](file:///workspace/FE-project/src/core/player-lifecycle.js#L143-L163)）。
- 来源：退役瞬间的 `getPlayerContract`；Writer = `archiveRetired`；
- 为**最终状态副本**；`terminateContract` 随后 `delete runtime.contracts[id]`（[contract.js#L238](file:///workspace/FE-project/src/core/contract.js#L238)）→ **不再被 Simulation 使用**；
- **不可修改**（无 Mutator）；与球队 Active Contract Truth **不重复**（已删除）。

### 八、Generated Player Retirement
退役时 `delete runtime.generated[id]`（L165）；`archive.generated = Boolean(player.generated)`（[L148](file:///workspace/FE-project/src/core/player-lifecycle.js#L148)）保留新生代标记。
- Archive 保留 `generated` 布尔标记 + `playerId` + `profile`（name/attributes…）；
- `runtime.generated[id]` 条目删除 → 不再作为可生成世界实体；**历史身份经 archive.profile 保留**；
- **无第二个 Generated Player Truth**。
（本 Gate 不设计 NewGen。）

### 九、Archive Reader Boundary
全部 `runtime.retired` 引用（[grep 结果]）：
| 位置 | 读取方式 |
| --- | --- |
| free-agent.js / contract.js / membership.js / transfer.js / player-runtime.js `isRetired` | 仅 `Boolean(retired[id])` |
| membership.js#L267 | fatal 校验 `retired player 仍在 active membership` |
| game-state.js#L78 | 容器初始化 |
| player-lifecycle.js#L144 | 唯一 Writer |

**Career Reader / Stats Reader / Profile Reader / Contract Reader / FinalAttribute Reader = 全部不存在。**
**结论：ARCHIVE CAREER = WRITE-ONLY SNAPSHOT**（写而不用）。**PASS（本 Gate 不新增 Reader）。**

### 十、Save / Load Boundary
`serializeState` 含 `runtime.retired` → `deserializeState` 仅 `retired ??= {}`（[save-manager.js#L108](file:///workspace/FE-project/src/save/save-manager.js#L108)）；`initializePlayerRuntime` 剔除已退役者的 `runtime.players`（不复活）。
- **保留** retired entries / career / profile / finalDeltas / contract；
- archive **不 normalize**（按存档原样保留）；
- **无字段丢失**（整体持久化）；
- **无 resurrection**（runtime.players 显式删除，读档再剔除）；
- **无 Active/Archive 双写**（archive 无 Mutator）。
**Archive Load 后仍是 Snapshot，而非 Runtime Player。PASS。**

### 十一、Active / Retired Separation
退役后：
- 否 — `getWorldPlayers` 返回（[player-runtime.js#L410-L421](file:///workspace/FE-project/src/core/player-runtime.js#L410-L421) 过滤）；
- 否 — 参加比赛（不在 squad）；
- 否 — `recordAppearance`（rt 已删 → `requirePlayerRuntime` 抛错）；
- 否 — 生命周期再次处理（不在 world players）；
- 否 — 作为 Active Player 查找（`getPlayerRuntime` 返回 null）。
**无例外 → `Retired Player = Non-Simulatable Archive Entity`。PASS。**

### 十二、Second Truth Audit
| 对象 | 分类 |
| --- | --- |
| `runtime.players[].stats.{season,career}` | **Truth**（Active） |
| `runtime.retired[].career` | **Snapshot**（只读、非 Active Truth） |
| `database career` | **不存在** |
| `season stats` | **Truth**（active，退役即消失） |
| `historical stats` | **不存在** |
| `involvements` | **Transient** |
| `aggregate stats` | **Unrelated** |
Archive 可保存数据但**不成为 Active Runtime Truth**。无 Second Truth。**PASS。**

### 十三、Determinism Audit
退役决策：`hashSeed(worldId|retire|season|playerId)` + `ageOn(birthDate, state.currentDate)`；无 `Math.random/Date.now/performance.now`。**PASS。**

### 十四、Contract Status
| 类别 | 状态 |
| --- | --- |
| Retirement Semantics | **RECOMMENDED FREEZE CANDIDATE**（CURRENT SEMANTICS IDENTIFIED） |
| Career Archive | **RECOMMENDED FREEZE CANDIDATE**（CURRENT SEMANTICS IDENTIFIED；write-only snapshot） |
| Season Archive | **OWNER_DECISION_REQUIRED / UNFROZEN**（当前不归档） |
| Final Attribute Snapshot | **CURRENT SEMANTICS IDENTIFIED / UNFROZEN** |
| Contract Snapshot | **CURRENT SEMANTICS IDENTIFIED / UNFROZEN** |
本 Gate **不自动 Freeze**。

### 十五、Implementation Gaps（仅记录）
1. Archive 无 Content Reader（write-only）。
2. Season Stats 退役不归档（schema 不支撑）。
3. Archive 读档不 normalize。
4. 无 Archive UI / 历史统计访问入口。

### 十六、Remaining Risks
1. Season Stats 退役即丢失，若未来需"退役赛季战绩"须先定义 Season Archive Schema（独立 Gate）。
2. `retired` 永久驻留 runtime（随存档增长，无 GC）。
3. Archive 若被将来读取须先定义 Archive Read Contract。

### 十七、Files Changed
仅本文件（§78 追加）。**src/ = 0，tests/ = 0。**

### 十八、Tests
`npm test` → **1552 通过，0 失败（共 1552 个用例）**。

**STOP — 不得进入 C-72，不得 Freeze Retirement / Archive，不得 Archive Season Stats，不得新增 Archive Reader，不得修改 Archive Schema / Retirement RNG / Player Lifecycle / Career Stats / Season Stats / NewGen。等待 Owner 明确指令「继续」。**

## §79 Retirement Season Statistics Archive Decision Audit（Step 39F-M-C-72）

**Gate Result = PASS / SEALED（Owner Decision / Architecture Investigation）。** Architecture Conclusion = **PASS / SEALED + OWNER_DECISION_REQUIRED**。本 Gate 不改任何代码。

### 一、Current Season Stats Lifecycle
- Active：`runtime.players[id].stats.season`（赛季累计，`recordAppearance` +1）。
- Career：`runtime.players[id].stats.career`（跨赛季累计）。
- Retirement：`archiveRetired` 只复制 `career` → `retired[id].career`，随后 `delete runtime.players[id]`。
**Season Stats → 当前不进入 Archive → runtime Player 删除后消失。**
确认**不存在** hidden/fixture/history/database/archive/historical 任何 Season Stats Copy（全局无第二副本）。

### 二、Data Loss Audit（逐字段）
退役时随 `rt` 删除而丢失的**该球员最后赛季** Season Stats 字段：
| 字段 | 退役丢失 |
| --- | --- |
| appearances | 是（仅 season 线） |
| minutes | 是 |
| goals | 是 |
| assists | 是 |
| yellow | 是 |
| red | 是 |
| shots | 是 |
| shotsOnTarget | 是 |
| ratingSum | 是 |
`averageRating`：不持久化（派生），**不需要也不得归档为独立字段**；若将来存在 Season Snapshot，只能由 `ratingSum + appearances` 重新派生。

### 三、Semantic Analysis（§六选项代码事实）
- A（赛季实时统计，退役后无需存在）：与 C-70「season=当前赛季累计」一致——season 定位为**当下赛季**，非历史载体。**当前实现符合 A。**
- B（职业历史一部分，应入 Career Archive）：当前实现**不符合**（season 不并入 career）。
- C（退休最后赛季 Snapshot 作为 Career Archive 附加）：**当前未实现**，需新 Schema。
- D（无法判断）：不成立——代码事实清晰。
**代码事实支持 A 为"当前语义"；B/C 属未来扩展。**

### 四、Career / Season Boundary
career = 跨赛季累计；season = 当前赛季累计。退休时 `career` = 最终生涯累计（**已含最后赛季**，因 career 在赛季中同步累加），`season` = 最后（已完成）赛季统计。
**若保存 Season Snapshot：不改变 Career Truth；禁止 `archive.season → career` 反向重算。**

### 五、Retirement Timing
调用序（[simulation.js#L235-L252](file:///workspace/FE-project/src/core/simulation.js#L235-L252)）：`developPlayers → runPlayerLifecycle(=processRetirements→archiveRetired) → … → resetSeasonStats`。
- 退役发生在**赛季边界**（rollover 内），**早于** `resetSeasonStats`；
- 退役时 `rt.stats.season` = **刚结束赛季的完整统计**（非新赛季 0 数据）；
- 不存在"退役时 season 已被 reset"的边界（reset 在其后）；
- `state.currentDate` 已推进到新赛季日期，但 `processRetirements(state, fromSeason)` 使用 `fromSeason` 标签。
**结论：若归档 Season Snapshot，其内容为"最后完成赛季"统计，语义干净。**

### 六、Archive Schema Impact
| 方案 | 语义清晰度 | 与 C-70 一致性 | Save/Load | Reader | Second Truth 风险 | 复杂度 | 体积 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 方案1 `retired[id].season` | 中（易与 career 混淆） | 需明确为 snapshot | 随 runtime 自动持久化 | 需新 Contract | 中（须标注非 Active Truth） | 低 | 小 |
| 方案2 `retired[id].finalSeasonStats` | 高（名称自描述） | 高 | 同上 | 需新 Contract | 低 | 低 | 小 |
| 方案3 复用现有结构 | 低（无合适容器） | 低 | — | — | 高 | — | — |
**仅分析，不选择、不实现。**

### 七、Average Rating Handling
C-70 冻结 `averageRating = derived`。故 Archive **不得**保存 `season.averageRating`；若未来有 Season Snapshot，仅存 `ratingSum + appearances`，平均分由派生计算。**本 Gate 不实现 Reader。**

### 八、Assist Handling
若未来保存 Season Snapshot，`assists` 仍为 **Aggregate Match Performance Statistic**；**不得**因归档被重新解释为真实逐球助攻；**不得**提前冻结 Assist Attribution（C-70 保持 UNFROZEN）。

### 九、Second Truth Audit（若未来存在 `archive.season`）
| 对象 | 分类 |
| --- | --- |
| Active Season Stats | **Active Stats Truth**（`runtime.players[].stats.season`） |
| Career Stats | **Active Stats Truth**（career 线） |
| Archive Season Snapshot | **SNAPSHOT**（只读历史） |
| Archive Career Snapshot | **SNAPSHOT**（只读历史，C-71） |
| Involvements | **Transient** |
| Historical Stats | **不存在** |
**约束：`archive.season` 必须是 SNAPSHOT，非 Active Truth；禁止 Archive ↔ Active Stats 双向同步。**

### 十、Reader Requirement
C-71 已确认无 `retired[id].career` Content Reader。若增加 Season Snapshot：**可先作为 Write-only Snapshot 存在**，Reader 非立即必需（与 career 现状一致）；或后续独立 Gate 定义 Reader Contract。**本 Gate 不创建 Reader。**

### 十一、Persistence Impact（若增加 Season Snapshot）
- 属 `runtime.retired[id]` 子字段 → 随 `serializeState` 自动持久化；
- `deserializeState` 现行 `retired ??= {}`（容器级兜底）→ **旧存档天然兼容**（旧归档无该字段 = undefined，不报错，不需 migration）；
- 是否需要 normalize：**不必须**（与现有 archive 一致，读档不 normalize）；
- 是否需 schema version：**不必**（向后兼容的增量字段）；
- Save 体积：每退役球员 +1 条 statLine（~9 数字），**增量极小**；
- **不会导致旧存档 load 失败**。

### 十二、Long-Term Value
Season Archive 对以下有潜在价值：球员历史页 / 退役档案 / 历史赛季统计 / 名人记录 / 生涯回顾 / 世界演化追溯。
**仅判断"是否值得保留数据"：最后赛季表现是生涯回顾的自然组成部分，具保留价值。**（本 Gate 不设计 UI / 历史数据库。）

### 十三、Storage / Performance（定性）
- Save Size：每退役球员 +~9 数值字段 → 增量可忽略；
- Load：随 `runtime` 整体反序列化 → 影响可忽略；
- Runtime Memory：归档本就常驻 `runtime.retired`（C-71 已记录），增量微小；
- 长期世界模拟：随时间累积退役条目 → 线性增长，但当前 `retired` 已无 GC，新增 1 字段不改变该性质。

### 十四、Owner Decision Matrix
**Option A — 不归档 Season Stats**
- 含义：Retirement → Career Snapshot only → Season Stats discarded。
- 优：Schema 最简单 / Archive 最小 / **当前实现无需改动**。
- 缺：退役球员无法查看最后赛季完整表现。

**Option B — 归档最后赛季 Season Stats**
- 含义：Retirement → Career Snapshot → Final Season Snapshot。
- 优：保留完整最后赛季表现 / 适合历史球员档案。
- 缺：需新增 Archive Schema 字段 / 未来需 Reader Contract / Save Size 略增。

**Option C — 建立完整 Historical Season Stats**
- 含义：Retirement → Historical Seasons → Career。
- 说明：**远超当前 Gate 范围**；若选择须明确 `NEW INDEPENDENT SYSTEM / FUTURE GATE`，本 Gate 不实现。

### 十五、Recommended Option（Architecture Recommendation，非 Owner Freeze）
**RECOMMENDED：Option B（归档最后赛季 Season Stats，字段建议 `retired[id].finalSeasonStats`）**。
理由：语义自描述、与 C-70 一致、向后兼容、Save 体积增量极小、对生涯回顾有明显长期价值；且可先 Write-only。**但此为建议，Owner Decision 未做前不得 Freeze、不得改 Schema、不得实现。**

### 十六、Contract Status
- Retirement Season Archive = **OWNER_DECISION_REQUIRED / UNFROZEN**。
- （C-71 的 Retirement Semantics / Career Archive 仍为 RECOMMENDED FREEZE CANDIDATE，本 Gate 不改。）
**本 Gate 不自动 Freeze。**

### 十七、Implementation Gaps（仅记录）
1. Season Stats 退役不归档（缺 Schema 与 Reader）。
2. Archive 无 Content Reader（career 亦无）。
3. Archive 读档不 normalize。
**均仅记录，不实现。**

### 十八、Remaining Risks
1. 当前退役即永久丢失最后赛季数据（Option A 后果）。
2. `retired` 无 GC，长期增长（与本 Gate 无直接关系）。
3. 若选 B/C 需先定义 Reader / 派生规则（averageRating 必须派生不得存储）。

### 十九、Files Changed
仅本文件（§79 追加）。**src/ = 0，tests/ = 0。**

### 二十、Tests
`npm test` → **1552 通过，0 失败（共 1552 个用例）**。

### 二十一、OWNER DECISION RECORD（Step 39F-M-C-72）
**Owner Decision = Option B — 归档退役球员最后赛季 Season Stats。**
- 含义：Retirement → Career Snapshot + **Final Season Snapshot**。
- 建议字段：`retired[id].finalSeasonStats`（建议值，待实现 Gate 确认）。
- 约束（继承 C-70）：
  1. `finalSeasonStats` 为 **SNAPSHOT**，非 Active Stats Truth；
  2. **不得**保存 `averageRating`（派生，仅存 `ratingSum + appearances`）；
  3. **不得** `finalSeasonStats → career` 反向重算；
  4. `assists` 仍为 Aggregate Performance Statistic，不解释为真实助攻；
  5. 归档内容为"最后完成赛季"统计（退役早于 `resetSeasonStats`）。
- 状态：**OWNER DECISION 已记录**；**已实现（见 §80）**。
- 本 Gate **未**实现任何代码（src/ = 0，tests/ = 0）。

**STOP — 不得进入 C-73，不得实现 Season Archive，不得修改 Archive Schema / Retirement / Player Stats，不得新增 Reader，不得修改 Save Schema，不得 Freeze Season Archive。等待 Owner 明确实现指令（新 Gate 规格）。**

## §80 Retirement Final Season Snapshot Implementation（Step 39F-M-C-73）

**Gate Result = PASS / SEALED（Implementation：Owner Option B）。** 实施 C-72 的 Owner Decision（Option B）。

### 一、Change
`archiveRetired`（[player-lifecycle.js#L157-L160](file:///workspace/FE-project/src/core/player-lifecycle.js#L157-L160)）新增归档字段：
```js
finalSeasonStats: rt ? { ...rt.stats.season } : null,
```
- 内容 = 退役瞬间的 `rt.stats.season`（**最后完成赛季**；退役早于 `resetSeasonStats`，C-72 §五）；
- **浅拷贝快照**（`{...}`），与 active season 无引用共享；
- **SNAPSHOT，非 Active Stats Truth**；
- **不含** `averageRating`（派生；按 C-70 由 `ratingSum + appearances` 派生）；
- `assists` 仍为 Aggregate Performance Statistic（不解释为真实助攻）。

### 二、Contract（= C-72 Option B）
- 归档 = Career Snapshot（C-71）**+** Final Season Snapshot（本次新增）；
- `finalSeasonStats` 与 `career` 为**独立对象**；禁止 `finalSeasonStats → career` 反向重算；
- 退役后 archive 仍只读、不可再 `recordAppearance`；
- Save/Load：随 `runtime.retired` 自动持久化，`retired ??= {}` 兜底 → **旧存档天然兼容**（缺字段 = undefined，不报错，无 migration）。

### 三、Reader
维持 **Write-only Snapshot**（无新增 Reader；与 `career` 现状一致，符合 C-72 §十）。

### 四、Tests
新增 [lifecycle.test.js#L121-L150](file:///workspace/FE-project/tests/lifecycle.test.js#L121-L150)：验证 finalSeasonStats 结构完整（9 字段）、无 `averageRating`、与 career 独立、`season ≤ career` 守恒、存档往返保持。既有归档一致性测试（`JSON.stringify(loaded.runtime.retired)`）继续通过。

### 五、Regression
`npm test` → **1553 通过，0 失败（共 1553 个用例）**（基线 1552 + 新增 1）。

### 六、Files Changed
- [src/core/player-lifecycle.js](file:///workspace/FE-project/src/core/player-lifecycle.js#L158-L160)
- [tests/lifecycle.test.js](file:///workspace/FE-project/tests/lifecycle.test.js#L121-L150)
- [docs/SIMULATION_SPEC.md](file:///workspace/FE-project/docs/SIMULATION_SPEC.md#L4670)（§80）

### 七、Contract Changes
新增 **Retirement Final Season Snapshot**（`retired[id].finalSeasonStats`）——Owner Option B 落地。未修改 C-70 Stats Contract 及任何既有 Frozen Contract。

### 八、Remaining Risks
1. `finalSeasonStats` 为 Write-only（无 Reader）；未来读取须先定义 Archive Read Contract。
2. `averageRating` 若需展示必须派生，不得存储。
3. `retired` 无 GC，长期增长（既有性质）。

**STOP — 不得进入 C-74，不得新增 Archive Reader / UI，不得修改 Stats Contract / Retirement 概率 / Save Schema。等待 Owner 明确指令「继续」。**

## §81 Retirement Final Season Snapshot Read Contract（Step 39F-M-C-74）

**Gate Result = PASS / SEALED（Owner Contract Freeze / Documentation-Only）。** 冻结 `runtime.retired[id].finalSeasonStats` 的**读取语义**，防止未来 Reader 将其误当作新的 Stats Truth。**本 Gate 不实现 Reader / UI。**

### 一、Snapshot Meaning（FROZEN）
`retired[id].finalSeasonStats` = 该球员退役时**最近一个已完成赛季**的 Player Runtime Season Statistics Snapshot。它是 **Retired Archive Snapshot / Read-only / Historical Snapshot**；**非** Active Runtime Truth、**非** Career Stats、**非** Stats Writer。
不代表：整个生涯 / 所有历史赛季 / 当前赛季 / 退役后统计 / MatchCore Goal Truth / Goal Attribution Truth。

### 二、Field Boundary（FROZEN，与 C-70 一致）
允许读取字段：`appearances / minutes / goals / assists / yellowCards / redCards / shots / shotsOnTarget / ratingSum`。**不得新增统计字段。**

### 三、averageRating Boundary（FROZEN，DERIVED）
`averageRating` **不属于** Snapshot Storage。展示层须经 `deriveAverageRating(ratingSum, appearances)` 派生（[player-runtime.js#L61](file:///workspace/FE-project/src/core/player-runtime.js#L61)）。**禁止** `retired[id].finalSeasonStats.averageRating` 作为持久化 Truth。

### 四、assists Boundary（FROZEN）
`finalSeasonStats.assists` 继续遵守 C-70：**Aggregate Match Performance Statistic**；不是真实逐球助攻 / `assistId` / Goal Attribution / Passer→Scorer 关系。

### 五、Career Boundary（FROZEN）
`finalSeasonStats` 与 `retired[id].career` **完全独立**。**禁止** `career ← finalSeasonStats`、`career = Σ(finalSeasonStats…)`；Reader 只能读取既有 Snapshot，**不得**由 Snapshot 重构 Career Truth。

### 六、Active Runtime Boundary（FROZEN）
退役后 `runtime.players[id]` 不存在。Reader **不得**创建 Active Runtime / 恢复 Player / 写 `runtime.players` / 触发 `recordAppearance` / 进入比赛模拟 / 参与 Player Lifecycle。

### 七、Read-only Rule（FROZEN）
`Archive Snapshot → READ → Presentation/History/Analysis`；**禁止** `Archive Snapshot → MUTATION → Runtime/Career/MatchCore`。Reader 不得修改 `finalSeasonStats` / `career` / `runtime.players` / MatchCore / Season/Career Stats / Score / LastTouch / Possession / Goal Attribution。

### 八、Legacy Save / Null Semantics（FROZEN）
- 字段缺失 = **Snapshot unavailable**（旧档无该字段）；`finalSeasonStats: null` = **No final-season snapshot available**。
- **禁止**：回填全 0 / 从 Career 推算 / 自动补造 / 复制 Career / 生成当前 Season 数据 / 任何 fallback 重建。
- 不修改 Save/Load Schema（C-73 已确认随 `runtime.retired` 持久化，原样保留）。

### 九、Snapshot Immutability（FROZEN）
一次性历史快照；读取后不得反向更新 / 与 Active Stats 同步 / 随未来模拟变化 / 重算覆盖 / 由 Career 更新。

### 十、Second Truth Boundary（FROZEN）
`Active(runtime.players[id].stats)` --retirement snapshot--> `retired[id].finalSeasonStats` --READ ONLY--> History/Presentation。Archive Snapshot 是历史快照，**非** Active Stats 的竞争 Writer。

### 十一、Reader API Decision（FROZEN）
**本 Gate 不创建** Reader API（不实现 `getRetiredPlayerStats()`/`getFinalSeasonStats()`/`getArchiveStats()` 等）。真正实现 Reader 须进入独立后续 Gate。

### 十二、Writer / Reader Audit（当前事实）
- **Writer（唯一）**：`archiveRetired`（[player-lifecycle.js#L160](file:///workspace/FE-project/src/core/player-lifecycle.js#L160)）。无其他 Writer。
- **Reader**：无生产 Reader（Write-only Snapshot）；仅测试引用。
- 无 `finalSeasonStats → career` 反向写；无 Snapshot → Active Runtime 恢复；无 `averageRating` 持久化/竞争 Truth；无 Snapshot → MatchCore/Goal/LastTouch/Possession 反向依赖；无第二可写 Retirement Stats Truth。

### 十三、Determinism
纯读取语义；无 `Math.random` / `Date.now` / `performance.now` / wall-clock。

### 十四、Tests
新增 [lifecycle.test.js#L152-L173](file:///workspace/FE-project/tests/lifecycle.test.js#L152-L173)：旧档缺失字段不回填 / 不恢复 Active Runtime / 不动 Career；配合既有 C-73 契约测试（字段完整、无 averageRating、与 career 独立、Save/Load 保持）。

### 十五、Contract Changes
新增 **Retirement Final Season Snapshot Read Contract**。未修改任何既有 Frozen Contract（C-70 / C-71 / C-72 / C-73）。

### 十六、Future Gates（仅记录，不实现）
- Archive Reader API（独立 Gate）。
- 退役球员档案 / 历史页面 / 统计展示（独立 Gate）。
- 完整 Historical Seasons（NEW INDEPENDENT SYSTEM）。

### 十七、Remaining Risks
1. Snapshot 仍为 Write-only，读取需求须经独立 Gate 定义。
2. `retired` 无 GC，长期增长（既有性质）。
3. `averageRating` 展示必须派生，不得存储。

### 十八、Files Changed
- [tests/lifecycle.test.js](file:///workspace/FE-project/tests/lifecycle.test.js#L152-L173)
- [docs/SIMULATION_SPEC.md](file:///workspace/FE-project/docs/SIMULATION_SPEC.md#L4717)（§81）

**STOP — 不得进入 C-75，不得实现 Archive Reader / UI，不得增加历史赛季系统。等待 Owner 明确指令「继续」。**

## §82 Retirement Final Season Snapshot Reader Implementation（Step 39F-M-C-75）

**Gate Result = PASS / SEALED（Implementation：C-74 Read Contract）。** 实现最小纯只读 Reader。

### 一、Reader Location
`getRetiredFinalSeasonStats(state, playerId)` — 位于 [player-runtime.js#L116-L130](file:///workspace/FE-project/src/core/player-runtime.js#L116-L130)，与既有只读访问器（`getPlayerStatsView` / `isRetired`）同模块。（入参沿用项目 `state` 约定，读取 `state.runtime.retired[id].finalSeasonStats`。）

### 二、Return Contract
- 存在合法 Snapshot → 返回**全新对象**（防御性复制），仅含 C-70 冻结的 9 字段：`appearances / minutes / goals / assists / yellow / red / shots / shotsOnTarget / ratingSum`。
- 归档缺失 / Snapshot 为 `undefined` / 为 `null` → 返回 `null`（"unavailable"）。
- **不**回填 0 / **不**自动生成 / **不**从 career 或 active stats / 数据库 fallback。
- **不含** `averageRating`（派生）。
- `assists` 原样读取，语义维持 C-70 `Aggregate Match Performance Statistic`。

### 三、字段命名澄清
存储实际字段名为 `yellow` / `red`（与 C-70 `createStatLine` 一致）；本 Gate 文本中的 "yellowCards / redCards" 即指这两个字段，无新增/改名。

### 四、Read-Only / 无副作用
纯读取：不修改 `runtime.retired` / `finalSeasonStats` / `career` / `runtime.players` / Season / Career Stats / MatchCore / Score / LastTouch / Possession / Goal Attribution；不创建 Active Runtime、不恢复球员、不 normalize / migrate Archive。无 `Math.random` / `Date.now` / wall-clock。

### 五、Writer Audit
`finalSeasonStats` 仍**仅**由 `archiveRetired` 写入；新增 Reader 不改变 Writer 数量。Truth 链保持 `Active Stats → Retirement Snapshot → Read-only Reader`（**非**双向同步）。

### 六、Tests
新增 [lifecycle.test.js#L176-L254](file:///workspace/FE-project/tests/lifecycle.test.js#L176-L254)：RT-01…RT-10（存在返回 9 字段 / 防御性复制 / 缺 snapshot→null / null→null / 缺归档→null / 无 career fallback / 不改 players / 不改 retired / 无 averageRating / 字段边界）。

### 七、Contract Changes
无新增 Contract；落实 C-74 Read Contract。未修改 C-70/C-71/C-72/C-73/C-74。

### 八、Files Changed
- [src/core/player-runtime.js](file:///workspace/FE-project/src/core/player-runtime.js#L116-L130)
- [tests/lifecycle.test.js](file:///workspace/FE-project/tests/lifecycle.test.js#L176-L254)
- [docs/SIMULATION_SPEC.md](file:///workspace/FE-project/docs/SIMULATION_SPEC.md#L4787)

### 九、Remaining Risks
1. Reader 一旦被 UI / 历史页消费，须受 C-74 Read-only Rule 约束（消费方不得回写）。
2. `retired` 无 GC，长期增长（既有）。
3. 完整历史赛季系统仍属未来独立 Gate。

**STOP — 不得进入 C-76，不得实现 UI / 历史页面，不得增加完整历史赛季系统，不得修改 Stats Contract。等待 Owner 明确指令「继续」。**

## §83 Retirement Archive Reader Post-Implementation Architecture Audit（Step 39F-M-C-76）

**Gate Result = PASS / SEALED（Read-Only Architecture Audit）。** 对 C-75 Reader 的实现后审计，未改任何生产/测试代码。

### 一、Reader Implementation Audit（已验证事实）
`getRetiredFinalSeasonStats`（[player-runtime.js#L116-L130](file:///workspace/FE-project/src/core/player-runtime.js#L116-L130)）：
1. 唯一数据源 = `state?.runtime?.retired?.[playerId]?.finalSeasonStats`（可选链，无其他来源）；
2. **显式字段投影**返回**独立对象**（`{...}` 逐字段），非引用共享；
3. 返回对象严格只有 C-70 冻结 9 字段（RT-10 验证）；
4. 无内部引用泄漏（RT-02 验证）；
5. 无缓存 / 惰性写入 / getter 副作用 / 隐藏 Mutation（纯同步构造）；
6. 无 `Math.random` / `Date.now` / `performance.now` / wall-clock；
7. 异常输入：`!snap || typeof snap !== 'object'` → `null`；`state` 缺省经可选链安全；
8. 与 `getPlayerStatsView`（返回 `{season,career}` + 派生 averageRating）/ `isRetired`（返回 boolean）职责不混淆。

### 二、Consumer Audit
全仓搜索 `getRetiredFinalSeasonStats`：**唯一引用 = 测试**（[lifecycle.test.js](file:///workspace/FE-project/tests/lifecycle.test.js) RT-01…RT-10 + 导入）。**NO PRODUCTION CONSUMER — READER REMAINS UNUSED BY PRODUCTION。** 无调用方回写 Runtime / Career / Archive / MatchCore。

### 三、Writer Audit
`finalSeasonStats` 全仓出现位置：
- **生产 Writer（唯一）**：[player-lifecycle.js#L160](file:///workspace/FE-project/src/core/player-lifecycle.js#L160) `archiveRetired`。
- **生产 Reader**：[player-runtime.js#L116](file:///workspace/FE-project/src/core/player-runtime.js#L116)。
- **测试引用**：`tests/lifecycle.test.js`（C-73 快照测试 + C-75 RT-01…RT-10）。
未新增 Writer；无同步更新机制；无 `career ↔ finalSeasonStats` 双向写。

### 四、Stats Truth Boundary（已验证）
Active Truth = `runtime.players[id].stats`；Career Snapshot = `retired[id].career`；Final Season Snapshot = `retired[id].finalSeasonStats`；`averageRating` = Derived；`assists` = C-70 Aggregate Match Performance Statistic。三者**独立**，无合并、无双向同步。

### 五、Retirement Lifecycle Boundary（已验证）
Reader 不创建 Active Runtime / 不恢复合同 / 成员 / generated；不调用 `recordAppearance`；不参与退役概率；不修改 `runtime.retired`；不改变"退役球员不可参赛"规则。

### 六、Persistence Boundary（已验证）
`finalSeasonStats` 随现有 `runtime.retired` 持久化（C-73/C-74）；Reader 未改 Save/Load 行为；旧档缺字段 / `null` 均返回 `null`；无隐式迁移 / 补字段 / 回填。

### 七、Cross-System Isolation（全仓搜索证据）
`getRetiredFinalSeasonStats` 无 MatchCore / Score / `scoringPlayerId` / `lastTouchPlayerId` / Possession / Second Ball / Goal Attribution / Season Match Simulation / Player Lifecycle / AI 潜力评估 的任何引用。**无跨系统依赖泄漏。**

### 八、Tests
`npm test` → **1564 通过，0 失败（共 1564 个用例）**，退出码 0；RT-01…RT-10 正常执行，无跳过 / 未注册。

### 九、未发现的问题 / 尚未实现的功能
- 未发现问题。Reader 符合 C-74。
- 尚未实现（Future Gate）：生产 Consumer / UI / 历史页面 / 完整历史赛季系统 / Archive GC。

### 十、Contract Changes
无。未修改 C-70…C-75 任何 Contract 定义。

### 十一、Files Changed
仅 [docs/SIMULATION_SPEC.md](file:///workspace/FE-project/docs/SIMULATION_SPEC.md#L4832)（§83）。**src/ = 0，tests/ = 0。**

### 十二、Remaining Risks
1. Reader 无生产 Consumer（未使用）；未来接入须受 C-74 Read-only Rule 约束。
2. `retired` 无 GC，长期增长（既有）。
3. 完整历史赛季系统仍属未来独立 Gate。

**STOP — 不得进入 C-77，不得新增生产功能 / UI / 历史页面 / 历史赛季系统。等待 Owner 明确指令「继续」。**

## §84 Retirement Career Stats Archive Read Contract Audit（Step 39F-M-C-77）

**Gate Result = PASS / SEALED + OWNER_DECISION_REQUIRED（Read-Only Audit）。** 未改任何生产/测试代码。

### 一、Career Snapshot Writer Audit（已验证事实）
**唯一生产 Writer = `archiveRetired`**（[player-lifecycle.js#L157](file:///workspace/FE-project/src/core/player-lifecycle.js#L157)）：
- `career: rt ? { ...rt.stats.career } : { appearances:0, minutes:0, goals:0, assists:0 }`；
- 值来自退役瞬间 `rt.stats.career`，**浅拷贝独立快照**（不与 Active Stats 共享引用）；
- 创建后无其他更新路径；**无** `finalSeasonStats → career` 回写；**无** Career Snapshot → Active Runtime Stats 回写。
- 观察（非 BLOCK）：`rt` 为 null 时的兜底默认仅 4 字段（`appearances/minutes/goals/assists`）；生产路径 `rt` 恒存在，兜底不触发。

### 二、Career Snapshot Reader Audit（已验证事实）
全仓搜索 `retired[].career`：**生产代码无任何 `.career` 内容读取**。对 `runtime.retired[id]` 的生产引用**全部为存在性判定**（返回 boolean，不含内容读取）：
- `isRetired`（[player-runtime.js#L396](file:///workspace/FE-project/src/core/player-runtime.js#L396)）
- `membership.js#L48` / `contract.js#L32` / `free-agent.js#L48` / `transfer.js#L60`（均为 `Boolean(retired[id])` 有效性守卫）。

**NO PRODUCTION CONTENT READER — CAREER ARCHIVE REMAINS WRITE-ONLY。** 测试引用见 `lifecycle.test.js`（L116/L133/L162/L167 等）；其余为存在性 mock。**未新增 Consumer。**

### 三、Field Contract Audit（代码证据）
Career Snapshot = `{...createStatLine()}`（[player-runtime.js#L131-L144](file:///workspace/FE-project/src/core/player-runtime.js#L131-L144)），实含 C-70 冻结 9 字段：`appearances / minutes / goals / assists / yellow / red / shots / shotsOnTarget / ratingSum`。**无 `averageRating`**（Derived，未存储）。字段名为 `yellow`/`red`（本 Gate 文本 "yellowCards/redCards" 即指这两字段）。**与 Final Season Snapshot 结构一致，无冲突。**

### 四、Career / Final Season Boundary（已验证）
- `runtime.players[id].stats.career`：Active Career Truth（退役前）。
- `runtime.retired[id].career`：退役时一次性 Career Snapshot（跨赛季累计终值）。
- `runtime.retired[id].finalSeasonStats`：仅最后完成赛季。
- 三者**独立复制**；**无双向同步**；**无** Final Season → Career 重算；**无** Career 冒充最终赛季 data 的 fallback。

### 五、Retirement Lifecycle Boundary（已验证）
顺序（[player-lifecycle.js#L144-L170](file:///workspace/FE-project/src/core/player-lifecycle.js#L144-L170)）：构造归档对象（含 career 快照）→ `terminateContract` → `delete runtime.players[id]` → `delete runtime.generated[id]` → `removePlayerMembership`。退役者不可再被模拟；Career Snapshot 此后不变；**无** Reader 恢复 Active Runtime 路径。

### 六、Persistence Boundary（已验证）
随现有 `runtime.retired` 持久化（`serializeState` 含 `runtime.retired`）；`deserializeState` 仅 `retired ??= {}`（[save-manager.js#L108](file:///workspace/FE-project/src/save/save-manager.js#L108)）。存档往返保留 Career Snapshot（`JSON.stringify(loaded.runtime.retired)` 一致性测试通过）。旧档缺 `retired[id]` 时容器兜底为 `{}`（存在性判定安全）；**无**隐式重建 / 补默认 / migration；**无**第二份可写 Career Truth。

### 七、Truth & Cross-System Isolation（全仓搜索证据）
Career Archive Snapshot **无**对 Active Career Stats / Season Stats / MatchCore / Score / `scoringPlayerId` / `lastTouchPlayerId` / Possession / Second Ball / Goal Attribution / Season Match Simulation / AI 潜力评估 / Player Lifecycle 的依赖或写入。**无核心系统 Truth 泄漏。**

### 八、Determinism
`archiveRetired` 不新增 `Math.random` / `Date.now` / `performance.now` / wall-clock；沿用既有 `state.currentDate`。纯复制拷贝。

### 九、Tests
`npm test` → **1564 通过，0 失败（共 1564 个用例）**，退出码 0。Career Snapshot 相关测试：`lifecycle.test.js`（L116 归档保留 career、L162-173 快照独立/Career 不被回写）、`foundation.test.js`（归档字段）、`membership.test.js`（`JSON.stringify` 往返）。无跳过/未注册。

### 十、Contract Changes
无。未修改 C-70…C-76 任何 Contract。

### 十一、Files Changed
仅 [docs/SIMULATION_SPEC.md](file:///workspace/FE-project/docs/SIMULATION_SPEC.md#L4886)（§84）。**src/ = 0，tests/ = 0。**

### 十二、Remaining Risks
1. Career Archive 仍 Write-only（无内容 Reader）。
2. `retired` 无 GC，长期增长（既有）。
3. 兜底默认仅 4 字段（生产路径不触发）。

### 十三、Owner Decisions Required
**Career Archive Read Contract 是否冻结？** 当前事实（§三/§四）已足够建立与 C-74 同构的只读 Read Contract；是否执行须 Owner 决策。未冻结项：Career Archive Read Contract = **UNFROZEN / OWNER_DECISION_REQUIRED**。

**STOP — 不得进入 C-78，不得实现 Career Archive Reader / UI / 历史页面 / 完整历史赛季系统。等待 Owner 明确指令「继续」。**