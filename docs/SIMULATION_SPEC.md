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

- **状态**：**机制已冻结（Step 36C，DOCS-ONLY）；生产实现待 Step 36D**。决策来源见 [DECISIONS D-36](file:///workspace/docs/DECISIONS.md)（D36.1~D36.6）。
- **问题（DF-01）**：存在 `managedClubId` 时，AI 可从 managed 买球员（`ai-candidate.filterCandidates` 的 TRANSFER 候选池未排除 managed），而 managed **不受 AI 控制**（`runSeasonAI` 跳过 managed、`findBuyerFor` 排除 managed 作 buyer）⇒ `cash` **单向**由 AI 流向 managed；因 `Σ club.cash` **严格守恒（≡8000）**，`AI aggregate cash → 0`，transfer market 进入 **absorbing state**（`maxConsecZeroTransfer ≈ 243`）。
- **冻结机制（CF-E2）**：**season-boundary process** —— 检查 `managedShare = cash_managed / WorldCash`；当 `> 35%` 时，**确定性再分配 20%** 的 managed **cash** 给 AI 俱乐部。
  - **接收方规则**：AI cash **中位数** → 优先 `cash < median` 的 AI clubs → **cash 升序**（同 cash 以 **clubId 升序** tie-break）→ 若无低于 median 者则**全部 AI** → 本轮资金**均分**（整数余数按确定性顺序依次 +1）。
  - **只改 `cash`**：不改 `transferBudget` / `wageBudget`；**不产生债务**；**不允许 `cash < 0`**；不改 transfer fee 公式；不改 Transfer Domain。
  - **world cash 严格守恒**（`Σ club.cash ≡ INITIAL_WORLD_CASH ≡ 8000`）：**不销毁、不生成**。
  - **无 RNG / 无 OVR / 无隐藏随机**；相同 `(world, managedClubId, season)` ⇒ 相同结果。
- **运行位置 `[待 Step 36D]`**：Finance Feedback 属 **season-boundary process**。**本步不修改**现有 season 顺序（D-33.15：`developPlayers → runPlayerLifecycle → bounded population replenishment → transferBudget regeneration → runSeasonAI → repairManagedLineups → resetSeasonStats`）；**生产接入位置留待 Step 36D 决定**（候选：`replenishTransferBudget` 之后 / `runSeasonAI` 之前，或 `runSeasonAI` 之后；须保证**每季恰好一次**、deterministic、且 AI 决策所见的 finance 一致）。
- **边界（D36.2 / D36.4）**：Finance Feedback **只**做 `managed cash → AI clubs cash`；**不**触碰 membership / contract / transfer / lineup；managed **仍属玩家控制**（AI 不得代玩家买卖/改阵容/改战术/改合同）；managed 长期为**球员净卖出方允许**（D36.1 只禁止**现金层面**的永久资金汇）。
- **不变**：Transfer Domain、Transfer Fee 公式、DDTI C1（`DEPTH_CAP=14 / PER_CLUB=1 / WORLD=4 / HU=0.30 / HD=0.15`）、Match / Team Strength、**Schema 10 / Save Format 1**；**不新增**任何 finance feedback 持久化字段（纯派生、无迁移）。
- **验证依据（Step 36B 摘要）**：CF-A 基线冻结（maxZero≈243）；**CF-B（sink）/ CF-D（world income）/ CF-F（decoupling）失败**；**CF-C / CF-E 通过**；**最终选择 CF-E2（threshold=35% / redistribution=20%）**。**Golden Regression 143/143/1141 必须保持**。
- **下一步**：**Step 36D = Finance Feedback Production Implementation + Validation**。