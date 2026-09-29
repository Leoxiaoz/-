# Football Manager Sim

单机、移动端优先、文字 / 数据驱动的足球经理 · 足球世界模拟游戏（第一代客户端：HTML5 + CSS3 + JS）。

## 当前状态（MVP 第一切片，2026-09-29）

已完成「数据 → 世界 → 比赛 → 结果」最小闭环：

- 数据库加载与校验（`.fdb` 目录包：引用完整性 + 位置 / 属性 / 倾向校验）
- 赛程生成（轮转法，偶数双循环 / 奇数轮空，确定性）
- 四维球队实力 + 时段制单场模拟（6 时段、可控种子、可复现）
- 积分榜、单赛季推进、赛季滚动（归档上赛季最终排名）
- 比分分布校准护栏（大样本确定性：场均总进球 ≈2.79，处于现实区间）
- 球员运行时状态（能力增减/体能/状态/士气/伤病/出场与生涯统计；静态库只读、以 playerId 关联）
- 存档（IndexedDB 主介质）与读取（引用 + 增量、版本向后兼容）
- 极简移动端 UI：积分榜 / 上赛季排名 / 最近赛果 / 推进 / 存读

```bash
npm test      # 65 项测试（Node，零依赖）
npm run serve # 启动本地服务，浏览器打开 index.html
```

## 目录结构

```
src/
  core/        # Simulation Core：rng / date-utils / schedule / team-strength / match / standings / player-runtime / game-state / simulation
  data/        # Data Layer：.fdb 加载与校验
  save/        # Save Layer：serialize/deserialize + IndexedDB / localStorage / 内存实现
  controller/  # Game Controller：UI 与核心的唯一协调者
  ui/          # UI Layer：纯呈现 + 事件转发
  shared/      # 共享：错误 / 日志 / 足球领域 schema
data/worlds/   # 数据库包（test-world / mvp-league）
docs/          # GAME_DESIGN / DATABASE_SPEC / SIMULATION_SPEC / SAVE_SPEC / ROADMAP / DECISIONS
tests/         # 零依赖测试框架 + 各层测试
```

## 文档

- [游戏设计](docs/GAME_DESIGN.md) · [数据库规范](docs/DATABASE_SPEC.md) · [模拟规范](docs/SIMULATION_SPEC.md) · [存档规范](docs/SAVE_SPEC.md) · [路线图](docs/ROADMAP.md) · [架构决策](docs/DECISIONS.md)

## 项目 Skills（`.trae/skills/`）

- game-architecture · game-systems-logic · database-data-modeling · testing-qa · save-system · mobile-ui-ux · documentation · performance

## 项目红线（摘要）

数据与逻辑分离；数据库 ≠ 存档；显示名不作主键；模拟确定性可复现；随机不替代模拟逻辑；不擅自扩大范围；技术服务于设计。