# MIGRATION_MANIFEST — FE Football Era 完整迁移包

生成日期：2026-10-11（UTC）
来源：云端原始工作区（只读采集，未修改原项目）

## 1. 包结构

```
FE-Football-Era-Full-Migration/
├── project/                         # 游戏项目完整工作区快照（= FE-project 内容，231 文件）
│   ├── index.html
│   ├── package.json
│   ├── README.md
│   ├── src/                         # core / core/match / core/ai / controller / ui / data / save / shared
│   ├── data/                        # worlds: mvp-league.fdb, test-world.fdb
│   ├── docs/                        # 设计 / 决策 / 规格文档
│   ├── styles/                      # main.css
│   └── tests/                       # 全部测试 + 入口 run.js + fixtures/harness
├── metadata/
│   ├── MIGRATION_MANIFEST.md        # 本文件
│   ├── SOURCE_STATE.md              # 原始工作区状态（分支/HEAD/7891170 核实结论）
│   ├── FILE_INVENTORY.txt           # 载荷文件清单（大小 + 相对路径）
│   ├── CHECKSUMS.txt                # SHA-256 校验清单
│   ├── VALIDATION_REPORT.md         # 打包后完整性验证报告
│   └── development-rules/           # 项目开发相关的规则 / Skills（原样导出）
│       ├── WORKSPACE_README.md      # 原 /workspace/README.md
│       └── skills/                  # 原 /workspace/.trae/skills（7 个 SKILL.md）
└── repository/
    ├── repo.git/                    # 原始仓库 .git 元数据的完整副本（浅克隆，可直接 clone）
    └── RESTORE_GIT.md               # Git 历史恢复说明 + 浅克隆限制说明
```

## 2. 各目录用途

| 路径 | 内容 | 用途 |
|---|---|---|
| `project/` | `FE-project/` 的完整文件快照（231 文件，无隐藏文件、无 node_modules） | 直接用于本地继续开发；等价于 HEAD `9db0710` 的工作区 |
| `metadata/` | 清单、状态、校验、验证报告、开发规则/Skills | 可追溯与完整性核对 |
| `repository/` | 仓库元数据副本 + 恢复说明 | 恢复提交历史（分支 / HEAD / origin refs） |
| `repository/repo.git/` | 5 个 refs、28 提交、完整 `.git` 元数据（浅克隆） | `git clone repo.git` 即可恢复仓库 |

## 3. 项目根与 Git 根的映射（重要）

- 原始 **Git 仓库根 = `/workspace`**，其中 `FE-project/` 是子目录；仓库同时纳管 `.trae/`、`README.md`、`.uploads/`。
- 本包把**游戏本体**放在 `project/`（相当于原 `FE-project/` 的内容）。
- Git Bundle 内的路径前缀是 **`FE-project/…`**（而非 `project/…`）。恢复 Git 历史后，仓库内目录名为 `FE-project/`。
- 因此：**沿用 Git 历史时，目录名应为 `FE-project/`**；若仅用 `project/` 快照，可自行重命名为 `FE-project/` 以保持一致。

## 4. 恢复方式（简述）

- 仅恢复项目文件：解压后把 `project/` 作为项目根使用即可（`npm test` 可运行，无需安装依赖）。
- 恢复完整 Git 历史：见 `repository/RESTORE_GIT.md`。

## 5. 完整性保障

- 载荷文件共 **277** 个（`project/` 231 + `metadata/development-rules/` 8 + `repository/` 38[含 `repo.git` 与 `RESTORE_GIT.md`]）。
- 全部载荷文件的 SHA-256 见 `metadata/CHECKSUMS.txt`。
- 验证过程与结果见 `metadata/VALIDATION_REPORT.md`。
- **已知限制**：原始仓库为浅克隆，`<99f934b` 的更早历史不可迁移；`7891170` 不可确认。