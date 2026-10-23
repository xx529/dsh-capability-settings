# AGENTS.md

本仓库是 **DeepSeek Harness（DSH）插件** `@chengdb/capability-panel` 的 fork：
上游 `chengdb/dsh-plugin-capability-panel`，本仓库 origin 为
`xx529/dsh-capability-settings`。作用是在 DSH 的 Web GUI 里浏览/管理项目级与全局
能力（Skills、MCP 服务器、快捷消息），并在输入框提供快捷弹层。

**不要改包名与插件 id**：`package.json` 的 `name`、`tsdown.config.ts` 的 `pluginId`、
`cordis.patch.yml` 的 `id: capability-panel` 是 profile patch 与客户端模块加载器
依赖的标识，改名会直接导致装不上/加载失败。

---

## 常用命令

```bash
pnpm install         # 依赖（Node 22.x，与 DSH 运行时一致）
pnpm typecheck       # tsc --noEmit
pnpm build           # = pnpm host (tsc -p tsconfig.json) + pnpm bundle (tsdown)
pnpm host            # 仅宿主侧 tsc 编译（产物 lib/**.js + lib/types/**.d.ts）
pnpm bundle          # 仅客户端 tsdown 打包（产物 lib/client.js + lib/client.map）
```

本地回归套件（**已 gitignore，不在版本库**）：`bash notes/verify/run-all.sh`。
它依赖 `notes/verify/tmp/` 里预装的 jsdom 与本地 MCP 测试服务器。**不要随手删
`notes/verify/tmp`**：删了会导致 bug1-e2e / composer-api-cache / probe-connectivity
报模块找不到（不是代码回归）。恢复方式：

```bash
bash notes/verify/setup.sh                     # 重建编译产物 + 本地 MCP 测试服务器
npm i --prefix notes/verify/tmp/env jsdom      # 重装 jsdom（harness 用绝对路径加载它）
```

---

## 架构地图（src/）

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 宿主插件入口：导出 `{ name, inject, apply }`，在 `ctx.capabilityPanel` 提供服务；装配 skills / mcp / quickMessages 三个域 + overrides / imports + MCP loader / usage |
| `src/channel.ts` | RPC 通道名唯一来源：`CHANNEL = "/capability-panel"`（两端 import，禁止硬编码） |
| `src/remote.ts` | 宿主 ⇄ 浏览器 RPC：在 `webServer` 挂 `CHANNEL` 前缀路由；endpoint 为 `skills.* / mcp.* / quick.* / overrides.*`（见文件头注释与路由表） |
| `src/client.ts` | 客户端插件入口：注入样式/语言包，注册 `sidebar.panellist` + `main`（面板）与 `conversation.input.*`（composer），构造面板 api 与**每会话** composer api |
| `src/client/*.tsx` | UI：`panel.tsx`（skills/quick 共用列表/详情）、`mcp-panel.tsx`、`quick-messages-panel.tsx`、`composer-*.tsx`、`composer-capability.tsx`（会话能力：hero 内联面板 + 顶部「能力」Tab 整页；Tab 打开时隐藏输入框）、`select.tsx`（自绘下拉）、`panel-entry.tsx`（主区域页面 + 侧栏图标）、`styles.ts` |
| `src/{skills,mcp,quick-messages,overrides,imports}/` | 各域宿主实现（配置读写、CRUD、挂载、探测、声明文件）；`skills/session.ts` = 会话级 Skills 开关（agent 作用域同名 runtime shadow，内存态） |
| `src/shared/` | 通用：原子写、文件锁、项目根探测、agents home、JSON 配置、skill 定位/来源 |

RPC 返回形状有硬约束（见 `src/remote.ts` 文件头）：传输层恒为 `{ ok: true, value }`；
业务失败必须包成 `value: { ok: false, errors: [...] }`，**不能**直接返回通道层失败信封，
否则连接服务的 zod 校验会把响应判为非法。

`src/client.ts` 的 `export const inject` 是**服务名**（`connection`/`slots`/`locale`/
`workspaces`），`package.json` 的 `dsh.client.inject` 是**包名**列表，两者语义不同，
改之前先看注释。

---

## 作用域与配置（数据落在哪）

- **agents home**：显式配置 → `DSH_AGENTS_HOME` → `~/.agents`（旧位置 `~/.dsh`、
  `~/.claude` 只读兼容）。见 `src/shared/agents-home.ts`。
- **项目根**：从 cwd 向上找第一个含 `.git` / `.dsh` / `.agents` / `.claude` / `dsh.json`
  的目录；用户主目录永不当作项目根；找不到则回退原 cwd。见 `src/shared/project-root.ts`。
- **配置文件**：全局 `~/.agents/mcp.json`、项目 `<项目根>/.mcp.json`；skills 目录；
  `quick-messages.json`；项目级声明 `capability-overrides.json`（MCP 的「默认关闭」
  列表也存这里）、`capability-imports.json`（导入/引用）。
- 写入必须走 `src/shared/atomic-write.ts` + `src/shared/file-lock.ts` 的既有封装，
  不要直接 `fs.writeFile`（并发写与半写文件会破坏配置）。

---

## MCP 关键模型（改这里之前必读 `mcp/loader.ts` 顶部注释）

1. **全局条目 = 全应用一份实例**：挂在**插件自己的 ctx**（`scopeOf(ctx)` 为空 ⇒
   serverName 按 `ctx.root` 预留）；**项目条目 = 每会话一份**：挂在 `agent.ctx`
   （按 agent scope 预留）。二者 owner 不同，互不冲突。
2. **必须用宿主那份 `@deepseek-ai/dsh-mcp-client`**（通过 `ctx.get("loader")` 取）。
   插件自带副本的 `@deepseek-ai/dsh-scope` 里 `kScope` 是普通 `Symbol`（非
   `Symbol.for`），读不到宿主打在 agent ctx 上的 scope tag ⇒ 恒回落 `ctx.root`，
   项目级每会话隔离失效。
3. **写路径不要 `await` 重挂**：`manager.reloadFor` 是 fire-and-forget。全局换代要
   逐条起进程 + MCP 握手（本机 npx/bunx 冷启动数秒），await 会把「删除/保存/启停」
   RPC 卡住数秒——这正是历史 bug「删除后列表不消失」的根因。挂载状态由
   `status().settling` + 面板静默轮询收敛。
4. **「默认关闭」= 项目级 overrides**：面板每行的「默认」开关写
   `.agents/capability-overrides.json` 的 mcp 列表；新建对话按它来。
   **「当前对话」开关 = 内存态**（`loader.sessionToggles`，键 `project:<key>` /
   `server:<serverName>`），不落盘、agent 销毁即失效；优先级：显式会话开关 >
   项目默认 > 配置里的 `disabled` 硬关闭。
5. **全局实例无法按项目卸载**，所以「关掉」一律用 `tools.restrict({ deny })` 按
   agent 作用域屏蔽 `mcp__<serverName>__*`。契约：空名单 / 未知名字 / scope-local
   名字会**失败** ⇒ 必须先用 `ctx.root.get("tools").schemas()` 取确切工具名，
   找不到就降级成 `skipped`，绝不调用空 filter。
6. **外部注入的 MCP**（其它插件/profile 运行时挂的 mcp-client，不在本插件配置文件里）：
   通过 cordis `ctx.registry` 的 `Plugin.Runtime.fibers` 发现（`Fiber.name` =
   最近具名祖先插件 = 注入方），或 cordis `loader.entries()`（profile `insert:` 条目）；
   工具/参数从全局工具注册表反推。按 agent 作用域注入的实例**无法** restrict
   （开关置灰），这是 `tools.restrict` 契约决定的上限。
7. **「使用记录」**：`tools.guard` 旁路记录 `mcp__*` 调用（同步、**永远返回
   `undefined` 放行**、记录异常一律吞掉），内存环形缓冲，**不落盘**；不要把它改成
   会拒绝执行或写文件的实现。
8. **会话标题只能客户端解析**：宿主 `SessionHeader` 只有 id/cwd 等、没有标题；
   使用记录只带 `sessionId`，由 `src/client.ts` 的 `sessionTitleOf`（客户端 sessions
   快照的 `displayTitle`）在适配器里投影。
9. 探测（「测试连接」/「查看工具与参数」）走 `src/mcp/probe.ts`：一次性 Client +
   transport、`finally` 关闭、不注册工具、不留子进程；不要用它挂载/缓存连接。

---

## 平台契约（UI / 外壳）

- **槽位必须成对**：`main` keyed 槽（`key: "capability-panel"`）与
  `sidebar.panellist` list 槽（`id: "capability-panel"`）必须同时注册——外壳对
  「选择未注册 main 的 id」会抛错。注册都要包在 `ctx.slots.inject(...)` 里，disposer
  收进 `disposers`。
- **composer 槽是 session 作用域**：`conversation.input.left` / `conversation.input.overlay`
  的 standardProps 直接提供 `sessionId`；composer 的 api 必须用
  `composerApiFor(props.sessionId)`（项目作用域只跟随所在会话，禁止掺入面板钉选或退回
  「工作区列表第一项」）。
- **外壳版本 ≥ 0.2.0-rc.2**：`sidebar.panellist` 在更早的 `0.1.2-alpha.2` 里不存在
  （那时只有 `sidebar.footer.action`），用它验证会把"注册没生效"误判成缺陷。
- **客户端 bundle 协议**：tsdown 输出 lazy-CJS（`window.__ModuleLoader__.load({ id, factory })`），
  `react` / `react-dom` / `react/jsx-runtime` 必须 external（`deps.neverBundle: true`）；
  打进第二份 React 会让 hooks 崩。改 `tsdown.config.ts` 前先读注释里的历史坑。
- **自绘 UI**：不引入外部 CSS/组件库；样式全部在 `src/client/styles.ts`（`SKP_CSS`
  字符串，由客户端插件注入 `<style>`），优先用宿主 CSS token。`select.tsx` 的下拉
  已做视口钳制/向上弹/内部滚动放行，别改回朴素的 `left/top` 锚定。

---

## Figma 原型（dsh-to-figma 本地桥）

- **设计源**：Figma 本地文档 **`dsh`**。**当前基线**：
  - `Capability Panel · 能力决策 v11`（page `56:7043`）：5 帧 `56:7046` / `56:7257` / `56:7468` /
    `56:7679` / `56:7890`，与代码「能力决策」实现对齐（默认关闭 + 双阈值 + 新密钥路径）；
  - `Capability Panel · 终稿 v8`（page `42:3373`）：面板列表/详情/手风琴终稿，可重导入 scene 保留。
  - 历史页面（按序保留，不要删）：`Capability Dock · 终稿 v5`（page `4:2`：画板 `4:3`、首屏 hero
    `4:7`、会话内「能力」Tab `4:223`）、`Capability Panel · 升级原型 v6`（`10:2`）、
    `Capability Panel · 交互原型 v7`（`21:2353`）、`Capability Panel · Jev 模型 v9`（`49:4455`）、
    `Capability Panel · 自主决策 v10`（`51:5711`）、`Capability Dock · 交互原型` v1–v4（page `1:2`）。
- **工具前提**：Figma 桌面打开该文件并运行伴生插件「DSH to Figma · Local」，保持窗口常开。
  先 `figma_status`；断连或多文档时 `figma_select_document <connectionId>` 显式重新绑定，
  然后才用 `use_figma` / `get_screenshot` / `import_scene` / `download_assets`。画布工具报
  `unknown tool` 时按「关闭并重开 Figma 伴生插件 → `figma_status`/`figma_select_document`
  重新绑定 → 仍不行则重启 DSH 会话」排查；连不上时不要拿旧截图冒充新设计。
- **可重导入的设计源在仓库**：`docs/figma/scenes/*.scene.json`（**目前仅 v5 与 v8**；`import_scene`
  契约，可直接 `import_scene({ nodes: scene.nodes })` 重建可编辑图层）+ `docs/figma/preview/*.png`
  （视觉对照）。**v9–v11 只有预览图 `preview/v9-*…v11-*` 与建稿脚本
  `docs/figma/prototype/v9|v10|v11/`，scene JSON 尚未导出**；重建按 `docs/figma/README.md` §3.1
  的脚本顺序在 Figma 内执行。重新导出用 `docs/figma/tools/export-scene.js`（`use_figma` 脚本，
  按 `TARGET_NODE_ID` 与 `SERIALIZE_RANGE` 分片）。完整流程与已知限制见 `docs/figma/README.md`。
- **已知限制**：scene 契约不含 VECTOR 图标（导入后图标为空）、只保留 SOLID 填充/描边与圆角/自动布局，
  渐变/阴影/图片不导出；文字字体为 `PingFang SC`。
- **变更纪律**：用户可见 UI/交互改动 → 先改代码并跑验证 → 同步 Figma 基线节点（v11；面板结构改动
  同时同步 v8）→ 重新导出预览图（v9–v11 暂无 scene JSON；v5/v8 变更时一并更新 scene JSON）→
  与代码一起提交（CHANGELOG 里注明设计变更）。

## 构建产物 `lib/`（重要）

- `lib/**` 是 `tsc` + `tsdown` 的产物，**不要手改**；评审 diff 时忽略它
  （用 `git diff -- src README.md CHANGELOG.md package.json` 之类）。
- 但 `package.json` 的 `files` 只有 `lib` 与 `cordis.patch.yml`，以 git 方式安装时
  用的就是仓库里的 `lib` ⇒ **改完 `src/` 必须 `pnpm build`，并把 `lib/**` 一起提交**，
  否则装进 profile 的行为与源码不符。
- tsdown 会覆盖 tsc 产出的 `lib/client.js`；`lib/client.map` 是刻意改的名字（规避
  旧 map 文件句柄冲突导致构建失败），不要改回默认名。

---

## 变更纪律

- **提交信息**：中文，`feat|fix|docs|chore(scope): 摘要`；正文写清根因/方案，并附
  **验证命令与真实输出**（本仓库历史提交都是这个风格）。
- **文档同步**：用户可见行为改动要同时更新 `README.md`（行为说明）与
  `CHANGELOG.md` 的 `[Unreleased]`（按 新增 / 修复 / 变更 / 内部 分节，写清语义边界
  与降级路径）。跨版本旧截图不覆盖新 UI 时，在 README 里注明。
- **提交前**：`pnpm typecheck` + `pnpm build` 必须过；有条件再跑
  `bash notes/verify/run-all.sh`。验证脚本放 `notes/`（已 gitignore），不要污染 `src/`。
- **不要重命名**包名/插件 id/槽位 id（见文首）。
- **不要动用户正在使用的 `~/.dsh` profile**（安装/卸载/改配置需用户明确同意）。
  需要真机验收时用独立环境：独立 `DSH_HOME`（如 `.verify-home/`）+ 独立端口 +
  与桌面应用同版本的外壳（本地 `npm i @deepseek-ai/dsh@0.2.0-rc.2`），
  profile bundles = `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + `link:<本仓库>`。
- **装到当前 profile 的官方通道**：`plugin_manager` 的
  `remove_bundle` + `install_bundle github:xx529/dsh-capability-settings#master`
  （desktop profile 是 `patchReload: live`：宿主热生效，客户端 UI 需刷新页面）。

---

## 本地目录（均已 gitignore，不进版本库）

| 目录 | 用途 |
|---|---|
| `notes/` | 本地验证脚本、报告、真机证据（`notes/verify/`、`notes/real-gui-evidence/` 等） |
| `.verify-home/` | 隔离验收用的独立 DSH_HOME（profile / 夹具 / 本地 dsh 外壳） |
| `.profile-backup/` | 改动用户 profile 依赖/patch 前留的备份 |
| `.mcp.json` / `.agents` / `.dsh` | 本机项目级配置（含本机路径） |
