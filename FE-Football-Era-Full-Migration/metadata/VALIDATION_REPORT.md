# VALIDATION_REPORT — FE Football Era 完整迁移包验证

验证时间：2026-10-11（UTC）
验证对象：`FE-Football-Era-Full-Migration-20261011.zip`
验证环境：`git version 2.43.0`；Node ESM（无第三方依赖）；压缩/校验使用系统 `zip` 与 `sha256sum`。
原则：原始工作区**全程只读**，未执行任何改变其状态的命令。

## A. 压缩包检查

| 项 | 结果 |
|---|---|
| 文件名 | `FE-Football-Era-Full-Migration-20261011.zip` |
| 大小 | 约 3.06 MB（最终压缩包实测值见交付说明；本报告嵌入后字节数有极小自增） |
| 压缩包条目（文件+目录） | 331 |
| 载荷文件（project + repository + development-rules） | **277** |
| 是否可读取 | 是（`unzip -l` 正常列出，无告警） |
| 是否包含自身 | 否 |

## B. 关键内容覆盖

- `project/index.html`、`project/package.json`、`project/README.md`：**存在**
- `project/src/`：完整（`core/`、`core/match/`、`core/ai/`、`controller/`、`ui/`、`data/`、`save/`、`shared/`）
- `project/data/worlds/`：`mvp-league.fdb`、`test-world.fdb`（各 5 个 json）**存在**
- `project/docs/`：7 篇（DATABASE_SPEC / DECISIONS / GAME_DESIGN / ROADMAP / SAVE_SPEC / SIMULATION_SPEC 等）
- `project/styles/main.css`：**存在**
- `project/tests/`：全部测试 + `run.js` + fixtures/harness（含 batch-a/b/c）**存在**
- `metadata/development-rules/`：工作区 `README.md` + `.trae/skills` 7 个 SKILL.md **存在**
- `repository/repo.git/`：HEAD、objects、refs、packed-refs、shallow **存在**
- 结论：**关键文件齐备，无遗漏。**

## C. SHA-256 校验

- 校验清单：`metadata/CHECKSUMS.txt`，覆盖 `project/`、`repository/`、`metadata/development-rules/`（共 **277** 条）。
- 在**独立临时目录**解压后执行 `sha256sum -c metadata/CHECKSUMS.txt`：
  - 结果：**277 条全部 `OK`，0 条 `FAILED`**。
- 校验值对应**打包时的实际工作区快照**（工作区干净，== HEAD `9db0710`）。

## D. Git 校验

- 产物：`repository/repo.git/`（原始 `.git` 元数据的完整副本，浅克隆）。
- `git --git-dir=repo.git rev-parse HEAD` → `9db0710f2634b0f1401d2f12c21fe64d864059e8` ✅
- `git --git-dir=repo.git rev-list --count HEAD` → `28` ✅
- refs（5 个，与原始一致）：
  - `refs/heads/main` → `99f934b…`
  - `refs/heads/trae/agent-dSNPbh` → `9db0710…`
  - `refs/remotes/origin/{HEAD,main}` → `99f934b…`
  - `refs/remotes/origin/trae/agent-dSNPbh` → `9db0710…`
- **独立克隆验证**：`git clone repo.git /tmp/pkgclone` → 成功；克隆出 HEAD `9db0710`、28 提交、分支齐全 ✅
- **`7891170` 验证**：`git cat-file -t 7891170` → 失败；全对象扫描（28 个 commit）**不存在**该提交。→ 标记为**不可确认**，本包未伪造。
- **历史完整性**：仓库为浅克隆（`.git/shallow`=`99f934b…`），`<99f934b` 的更早父提交对象在云端不存在 → 该段历史**未验证且不可迁移**（如实标记，未虚报）。

## E. 项目恢复验证（独立临时目录）

1. 解压到 `/tmp/migverify/…`：**成功**。
2. 关键文件与目录：**完整**（见 §B）。
3. `package.json` 与运行配置：**存在**（`"test": "node tests/run.js"`）。
4. 执行原有只读测试命令 `npm test`：**通过**。
   - 结果：`1633 通过，0 失败（共 1633 个用例）`，退出码 `0`。
   - 说明：测试为只读模拟（不写用户存档）；未安装任何依赖（项目无第三方依赖），未修改任何源码。

## F. 排除项

| 类别 | 路径 | 排除原因 | 恢复影响 |
|---|---|---|---|
| 历史上传件 | `.uploads/ff728b51-…_FE-project.zip`（933 KB） | 非项目源码；是早期导出 zip，与本包 `project/` 内容重复；避免“包中包”误用 | 无。源码在 `project/` 完整；且该文件仍在 `repo.git` 对象库/历史中 |
| 依赖目录 | `node_modules/` | 可重装 | 无（项目无第三方依赖，不存在该目录） |
| 缓存/日志/构建产物 | （无） | 未发现 | 无 |
| 密钥/令牌/凭证/认证缓存 | （未发现） | 不打包 | 无 |
| 全局用户配置目录 | 用户级全局配置 | 与 FE 无直接关系，禁止无差别复制 | 无；仅导出 `metadata/development-rules/`（.trae/skills + 工作区 README） |
| 包自身 | 生成的 zip | 不得再次打包 | 无 |

## G. 未执行 / 未验证事项

- **未** `git fetch --unshallow`：需网络且可能改动环境/refs，故跳过 → 浅克隆边界前历史**未验证、未迁移**。
- **未** 覆盖/删除/重置原始工作区任何文件。
- **未** 安装依赖、升级工具或修改源码。
- `7891170` **未验证成功**（原仓库中不存在）→ 标记不可确认。

## H. 结论

**PASS WITH WARNINGS**

- 迁移包已生成且可完整恢复项目与可克隆的 Git 仓库；277 个载荷文件全部通过 SHA-256 校验；独立解压后 `npm test` 实测 **1633 / 0 / exit 0**。
- 警告（限制，非失败）：
  1. 原始云端仓库为**浅克隆**，`99f934b` 之前的更早历史在云端不存在，**不可迁移**（未虚报）。
  2. 封存提交 **`7891170` 不可确认**（当前 HEAD 为 `9db0710`，其工作内容已含 Batch C 改动；内容在位、哈希不在位）。