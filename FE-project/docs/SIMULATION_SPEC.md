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

- **状态**：**BLOCKED（Decision Gate，未冻结语义）**。原因：`CONTINUOUS_BALL_POSITION_TRUTH_UNDEFINED`。**未修改任何生产代码 / 测试 / Frozen Contract。**

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