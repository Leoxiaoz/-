# SOURCE_STATE — FE Football Era 云端原始状态记录

> 本文件记录打包时对**云端原始工作区**的只读观测结果。原始工作区在打包过程中未被修改。

## 1. 路径与仓库

- 原始仓库根目录（Git toplevel）：`/workspace`
- 游戏项目目录：`/workspace/FE-project`
- 该仓库同时纳管：`FE-project/`（游戏）、`.trae/skills/`（工作区级 Skills）、`README.md`（Skills 仓库说明）、`.uploads/`（历史上传件）
- 远端：`origin = https://github.com/Leoxiaoz/-`

## 2. 分支 / HEAD / 历史

- 当前分支：`trae/agent-dSNPbh`
- HEAD 提交哈希：`9db0710f2634b0f1401d2f12c21fe64d864059e8`
- HEAD 提交说明：`feat: update workspace`
- HEAD 作者：`Leoxiaoz <Leoxiaoz@users.noreply.github.com>`，时间 `Sun Oct 11 09:51:40 2026 +0000`
- 可达提交总数（`git rev-list --count HEAD`）：`28`
- 标签：无
- 分支列表：
  - `refs/heads/main` → `99f934ba247c6d40fabe0f45b0018c1960804519`（`feat: 新增 Performance Skill 占位框架`）
  - `refs/heads/trae/agent-dSNPbh` → `9db0710f2634b0f1401d2f12c21fe64d864059e8`
  - `refs/remotes/origin/HEAD`、`refs/remotes/origin/main` → `99f934ba…`
  - `refs/remotes/origin/trae/agent-dSNPbh` → `9db0710f…`
- 结论：Git 存在，本地可达历史可读；但仓库为**浅克隆**（见 §5），边界之前的更早历史对象在云端不存在。

## 3. 工作区状态

- `git status --short`：**空（干净）**
- 已修改文件：**无**
- 未跟踪文件：**无**（`git ls-files --others --exclude-standard` 为空）
- 被忽略文件：**无**（仓库内无 `.gitignore`，`git status --ignored --short` 为空）
- 依赖目录：**无** `node_modules/`，无锁文件（`package.json` 无 dependencies）
- 结论：本次交付的**工作区快照 == HEAD 提交内容**，不存在需要单独保留的未提交修改。

## 4. 关于封存提交 `7891170`

- **结论：无法在当前云端原始仓库中确认 `7891170`。**
- 依据：
  - `git cat-file -t 7891170` → `fatal: Not a valid object name`。
  - 遍历仓库全部对象（`git cat-file --batch-all-objects --batch-check` 过滤 commit，共 28 个）后，**不存在**以 `7891170` 开头的提交对象。
  - `git reflog` 仅显示 `clone` 与一次 `checkout`，`7891170` 不在任何可达或悬空引用中。
- 说明：`7891170` 曾是一次**本地 `--amend` 产生的提交哈希**，但该 amend 未被推送，且当前云端 HEAD 已回到与远端一致的 `9db0710`，因此该哈希在当前仓库中不可确认。
- **重要**：虽然 `7891170` 哈希不可确认，但**其对应的工作内容（Batch C 的三处改动：`src/ui/app-view.js`、`tests/run.js`、`tests/batch-c-compat.test.js`）确实存在于当前 HEAD `9db0710` 中**（提交 `9db0710` 的文件清单恰为这三个文件）。即：**内容在位，封存哈希不在位。**
- 本迁移包**不伪造**该提交，也不修改历史以使其存在。

## 5. Git 迁移产物与工作区快照的关系

- **本仓库是浅克隆**：`.git/shallow` = `99f934ba247c6d40fabe0f45b0018c1960804519`，其父提交对象在云端不存在。
- 打包时先试 `git bundle create --all`：`git bundle verify` 报 “complete history”，但**克隆实测失败**（缺父对象）。故改用任务允许的替代路径——**完整复制 `.git` 元数据**，产物为 `repository/repo.git/`。
- `repository/repo.git/` **已实测可克隆**：`git clone repo.git` → HEAD `9db0710`、28 提交、refs 齐全。它保留云端**实际存在**的全部对象与引用（含 `shallow` 文件本身）。
- 由于工作区干净，**Git 迁移产物与 `project/` 工作区快照在内容上等价**（都对应 HEAD `9db0710`）；不存在“Git 未携带的工作区内容”。
- `repo.git` 对象库**含** `.uploads/`（历史上传的旧 zip，见 `VALIDATION_REPORT.md` 排除项说明）；`project/` 快照**不包含**该旧 zip（原因见排除项）。
- **未声称**保留浅克隆边界之前的历史（该历史在云端不存在，见 `repository/RESTORE_GIT.md` §5）。

## 6. 项目文件与资源概况（打包时）

- `FE-project/` 文件数：`231`（目录 `17`）
- 文件类型分布：`.js` 210、`.json` 11、`.md` 7、`.html` 2、`.css` 1
- 关键目录齐备：`src/`（含 `src/core/`、`src/core/match/`、`src/core/ai/`、`controller/`、`ui/`、`data/`、`save/`、`shared/`）、`tests/`、`data/worlds/*.fdb`、`docs/`、`styles/`
- 根文件：`index.html`、`package.json`、`README.md`

## 7. 项目级规则 / Skills / 开发配置位置

- 工作区级 Skills：`/workspace/.trae/skills/<name>/SKILL.md`（共 7 个：game-architecture、game-systems-logic、database-data-modeling、testing-qa、save-system、mobile-ui-ux、performance）
- 工作区说明：`/workspace/README.md`
- 项目内未发现独立的 `.trae/` 或全局规则文件；`FE-project/` 内无隐藏配置文件。
- 处理方式：以上工作区级 Skills 与 README 属**项目开发直接相关**，已**原样（未改写作用域）**导出到 `metadata/development-rules/`，以便本地继续开发时参考。**未**复制任何 `FE-project/` 之外的私人配置。

## 8. 迁移限制与未确认事项

- 无未提交工作、无特殊文件阻塞迁移。
- `7891170` 不可确认（见 §4）。
- **浅克隆限制**：云端仓库为 shallow，`<99f934b` 的更早历史在云端不存在，**不可迁移**（见 §5 与 `repository/RESTORE_GIT.md`）。
- 无依赖安装需求（项目为纯 Node ESM，无第三方依赖）。
- 未执行任何可能改变原始工作区的命令（无 reset/clean/checkout/stash/commit/rebase）。