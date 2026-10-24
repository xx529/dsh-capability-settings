# 插件市场收录（Awesome DSH Plugin）

市场 <https://awesome-dsh-plugin.com/> 的目录数据来自 GitHub 仓库
[`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)：
**一个插件一个文件**，放在 `data/plugins/<owner>__<repo>.yml`；README 与站点由该仓库
自动生成，**不要手改**。收录即一个 PR 加一个文件。

本仓库对应条目：

| 项 | 值 |
|---|---|
| 线上文件 | `data/plugins/xx529__dsh-capability-settings.yml` |
| 本地副本 | 本目录 `awesome-dsh-plugin.yml`（与线上一致，改描述时两处同步） |
| 分类 | `ui`（Web GUI 面板；同类基础项目也在此类） |
| 详情页（合并后） | <https://awesome-dsh-plugin.com/p/xx529/dsh-capability-settings/> |

## 收录门槛（上游 `contributing.md`）

1. `package.json` 声明 `dsh.bundle`（本仓库 `dsh.bundle.patch = ./cordis.patch.yml`，
   且 `lib/` 已提交，源码安装无需构建）；
2. 仓库带 `dsh-plugin` topic（GitHub 仓库设置 → Topics）；
3. 仓库创建满 1 天、有真实可用代码、未被归档；
4. `description.en` 必填、单行、不加营销词，**描述必须与代码一致**（评审会逐条核对）；
5. 一个 PR 最多加 3 条；文件名必须是 `<owner>__<repo>.yml`，`url` / `name` 与仓库一致；
6. 描述里出现 `: `（冒号+空格）必须给 YAML 值加引号。

可选项：`icon:`（GitHub 托管的 png/jpg/webp）、`tarball:`（GitHub Release 的 `.tgz`），
以及放在**本仓库**根目录的 `screenshots.json`（1–8 张，路径相对该文件）。
本项目当前未声明这些：README 里的截图会被市场回退抓取；有正式发布 tarball 后再加。

## 提交流程（已在 2026-10-24 走过一次）

前置：`gh auth status` 已登录（需要 `repo` scope）。

```bash
# 1) 同步已有 fork（fork 落后上游会让 PR 变成"删条目"，CI 的 stale-fork guard 会拦）
gh repo sync xx529/awesome-dsh-plugin --source awesome-dsh-plugin/awesome-dsh-plugin

# 2) 从上游 main 开分支，写条目文件（内容 = 本目录的 awesome-dsh-plugin.yml）
BASE=$(gh api repos/awesome-dsh-plugin/awesome-dsh-plugin/git/ref/heads/main --jq .object.sha)
gh api -X POST repos/xx529/awesome-dsh-plugin/git/refs \
  -f ref=refs/heads/add/xx529-dsh-capability-settings -f sha="$BASE"

gh api -X PUT \
  repos/xx529/awesome-dsh-plugin/contents/data/plugins/xx529__dsh-capability-settings.yml \
  -f branch=add/xx529-dsh-capability-settings \
  -f message="add xx529/dsh-capability-settings" \
  -f content="$(base64 -i docs/marketplace/awesome-dsh-plugin.yml)"

# 3) 开 PR（正文用英文，附门槛对照表；见下方模板）
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --base main --head xx529:add/xx529-dsh-capability-settings \
  --title "add xx529/dsh-capability-settings" --body-file /tmp/pr-body.md
```

PR 正文模板（此前 `xx529/dsh-task-gantt` 的写法，评审读得最快）：

```markdown
## What this adds
<一段话：插件做什么、装在哪、数据落在哪>

## Why it qualifies
| Requirement | Evidence |
|---|---|
| `dsh.bundle` declared | `package.json` → `dsh.bundle.patch`；`lib/` 已提交 |
| Real, usable code | 宿主 + 客户端产物路径与体积；真机验证结论 |
| Repository ≥ 1 day old | created `<ISO 时间>` |
| Public, not archived, not DSH itself | ✅ |
| Topic `dsh-plugin` | ✅ |
| Lineage / relationship to existing entries | 与 `pure-craft/dsh-capability-panel` 的差异（如实写） |

## Notes
- 中文描述已填；
- 未发 npm / tarball 的原因（可选）。
```

CI 依次检查：条目数量 → `dsh.bundle` → 仓库年龄 → `awesome-lint` + 站点构建
（另含 README 生成一致性、stale-fork guard）。失败时**在同一分支推修复**即可，
不用重开 PR；合并后站点自动重建。

## 后续维护

- 插件能力/描述变化 → 先改本仓库 `docs/marketplace/awesome-dsh-plugin.yml`，
  再对线上条目提一个只改该文件的 PR（不要顺手改别的条目）。
- 不要往上游 `data/screenshots.json` 加新键（已弃用）；截图请放本仓库的
  `screenshots.json`。
- 当前提交：PR <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/9197>
  （2026-10-24 提交，分支 `xx529:add/xx529-dsh-capability-settings`）。
- 注意：该 fork 默认分支落后上游，`gh repo sync` 会因 token 缺 `workflow` scope 被拒；
  本次分支基于旧 `main`（PR 只新增一个文件，CI 用 merge ref 构建，不影响检查）。
  若之后仍被要求同步，用 GitHub 网页的 “Sync fork” 或 `gh auth refresh -s workflow` 后重试。

## 上传 / 本地校验命令备注

- macOS 的 `base64 -i <file>` = Linux 的 `base64 -w0 <file>`（提交内容不要带换行）。
- 提交前可在本仓库本地按上游规则自检：解析 `docs/marketplace/awesome-dsh-plugin.yml`
  并检查 key 集合、`category` 取值、文件名 slug、`description` 单行与 `en` 必填。
