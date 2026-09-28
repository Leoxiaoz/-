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

## 仍属 TBD（未受影响）

- GAME_DESIGN：T1、T2、T3、T4、T5、T7–T13、T15、T16、T17
- DATABASE_SPEC：D1、D2、D3、D5、D8、D9、D11、D12
- SIMULATION_SPEC：S2–S13
- SAVE_SPEC：V1–V9、V11
- ROADMAP：R1、R2、R4、R5、R6

详见各 SPEC 的 TBD 汇总表。