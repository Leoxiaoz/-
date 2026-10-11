# RESTORE_GIT — 恢复 Git 历史（完整仓库元数据副本）

本包提供 `repo.git/`——云端原始仓库 `.git` 元数据的**完整副本**，可直接被 `git clone` 使用。

> ⚠️ 重要限制：云端原始仓库本身是**浅克隆（shallow clone）**。
> `.git/shallow` 指向 `99f934ba…`，该提交之前的更早父提交对象在云端**并不存在**。
> 因此**任何**工具（包括 Git Bundle）都无法重建边界之前的完整历史。本包如实地保留了
> 云端**实际存在**的全部对象与引用，未伪造、未改写。

## 1. 为什么不是 Bundle？

- 打包时先尝试了 `git bundle create --all`。`git bundle verify` 报告 “complete history”，
  但**实际克隆失败**：`Could not read <parent> … Failed to traverse parents of 99f934b`。
- 原因：Git 2.43 的 `git bundle create` 从浅仓库生成时**未写入 `shallow` 头**，
  导致 bundle 缺少父对象且不自洽，无法独立克隆。
- 因此改用任务允许的替代路径：“不修改原始仓库的前提下复制完整 `.git` 元数据”，并**实际验证可克隆**。

## 2. 内含引用（打包时实测）

```
99f934ba247c6d40fabe0f45b0018c1960804519 refs/heads/main
9db0710f2634b0f1401d2f12c21fe64d864059e8 refs/heads/trae/agent-dSNPbh
99f934ba247c6d40fabe0f45b0018c1960804519 refs/remotes/origin/HEAD
99f934ba247c6d40fabe0f45b0018c1960804519 refs/remotes/origin/main
9db0710f2634b0f1401d2f12c21fe64d864059e8 refs/remotes/origin/trae/agent-dSNPbh
```

- HEAD = `9db0710f2634b0f1401d2f12c21fe64d864059e8`
- 可达提交数 = 28；标签：无
- 原始 **Git 根 = 工作区根**（包含 `FE-project/` 子目录）

## 3. 恢复方式 A：克隆（推荐，已实测通过）

```bash
git clone repo.git FE-Football-Era-repo
cd FE-Football-Era-repo
git log --oneline -5          # HEAD 应为 9db0710 feat: update workspace
git branch -a                 # 应含 trae/agent-dSNPbh 与 origin/main
```

游戏位于 `FE-Football-Era-repo/FE-project/`。

## 4. 恢复方式 B：就地恢复（把元数据放回工作区）

1. 取本包 `project/` 目录，重命名为 `FE-project/`，放进一个父目录 `<root>/`。
2. 把 `repo.git/` 复制为 `<root>/.git/`。
3. 在 `<root>/` 下执行：

```bash
git status --short     # 期望为空（干净）
git log --oneline -5   # 期望 HEAD = 9db0710
```

## 5. 关于更早历史（浅克隆边界）

- 边界提交：`99f934ba247c6d40fabe0f45b0018c1960804519`（`main` 的当前 tip，也是本仓库最老可达提交）。
- 其父提交（例如 `8cac8ce4…`）在云端**缺失**，故 `<99f934b` 的历史**无法**迁移。
- 如需补全：在具备网络的环境下，从原始远端 `origin` 执行 `git fetch --unshallow` 拉取深层历史。
  本包**不包含**远端深层对象，也**不声称**已保留完整历史。

## 6. 关于 `7891170`

该哈希在本仓库中**不可确认**（`git cat-file -t 7891170` 失败；28 个 commit 对象中不存在），
详见 `metadata/SOURCE_STATE.md` §4。当前 HEAD 为 `9db0710`，其工作内容已包含 Demo v1 Batch C 改动。

## 7. 恢复后核对

```bash
git rev-parse HEAD         # 期望 9db0710f2634b0f1401d2f12c21fe64d864059e8
git status --short         # 期望为空
git rev-list --count HEAD  # 期望 28
git for-each-ref --format='%(objectname) %(refname)'   # 期望 5 个 refs（见 §2）
```