# MCP「关闭」后的残留：资源服务器清单与资源工具（跟踪记录）

| 项 | 值 |
|---|---|
| 状态 | **已知限制**：插件侧已缓解（提示词清单不再露出名字）；工具层仍待上游 |
| 记录基线 | v1.7.2，2026-10-30 |
| 宿主基线 | DSH **0.2.1-rc.3**（桌面应用 `app.asar` 内 `dsh-system-prompt` / `dsh-mcp-client` / `dsh-mcp-resources` / `dsh-scope`） |
| 上游跟踪 | <https://github.com/deepseek-ai/deepseek-harness/discussions/11562>（该仓库 issues 关闭，discussions 开启） |
| 相关提交 | `99edb6c`（1.7.1 指令段遮蔽）、`2557489`（1.7.2 资源清单名字过滤）、发布 `7624385`（v1.7.2） |
| 代码位置（以 v1.7.2 为准） | `src/mcp/loader.ts:245`（段名前缀）、`:269`（资源清单段名）、`:278`（名单正则）、`:762` `applyPromptShadows`、`:849` `filterResourceListNames`、`:884` `installResourceListFilter` |

---

## 1. 问题

能力面板「当前对话 / 本项目」关掉一个**全局或外部注入**的 MCP server 时，语义上应该是“这个会话看不到它”。但宿主把 MCP 能力暴露成**四条相互独立的通道**，关闭动作必须逐条覆盖，否则会漏：

| # | 通道 | 宿主所有者 | 本插件处理 | 状态 |
|---|---|---|---|---|
| 1 | 工具表 `mcp__<server>__*` | `dsh-tools` + `dsh-mcp-client` | 对话作用域 `tools.restrict({ deny })` | ✅ 1.7.0 起 |
| 2 | 服务器指令系统提示词段 `mcp:<serverName>` | `dsh-mcp-client` 的 `registerServerContext()` | 对话作用域注册**同名空文本 scoped 段**遮蔽 | ✅ 1.7.1 起 |
| 3 | 资源服务器名清单段 `mcp-resource-servers` | `dsh-mcp-resources` | 对话作用域 `system-prompt/assemble` 钩子做**最小文本剔除** | ✅ 1.7.2 起（残留耦合见 §4） |
| 4 | 三个资源工具（`list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource`） | `dsh-mcp-resources` | **未处理** | ⚠️ 宿主无 API，待上游 |

用户可见表现：关掉 server 后，模型不再看到其工具与 `### MCP server: …` 指令块，**但仍能**
- 在系统提示词里看到 `## MCP resource servers` 名字清单（1.7.2 起已从名单中剔除该名字）；
- 通过资源工具列出/读取该 server 的 resources（**仍未处理**）。

## 2. 宿主源码依据（0.2.1-rc.3，`app.asar` 实读）

解包路径（本地验证者脚本可复现）：`app.asar` → `node_modules/@deepseek-ai/*`。

- **清单段是“现算”的**：`dsh-mcp-resources/lib/index.js:120-127`
  ```js
  inner.systemPrompt.section({
    name: "mcp-resource-servers",
    order: inner.systemPrompt.getSectionOrder("MCP_SERVERS"),
    interpolate: false,
    text: ({ scope }) => {
      const names = [...this.layers.merge(scope, (layer) => layer.servers).keys()].sort();
      return names.length === 0 ? "" : `## MCP resource servers\n\nUse list_mcp_resources, … server argument: ${JSON.stringify(names)}.`;
    }
  });
  ```
- **provider 注册在挂载作用域**：`dsh-mcp-client/lib/index.js:731-743`（`registerServerContext`）→
  `mcpResources.register(serverName, connection.resources)`；全局实例挂在插件 ctx ⇒ 注册进**全局层**。
- **资源请求按 agent 作用域并集解析**：`dsh-mcp-resources/lib/index.js:175`
  ```js
  const provider = this.layers.merge(exec.agent, (layer) => layer.servers).get(server);
  ```
- **并集没有“删除”语义**：`dsh-scope/lib/index.js:162-181`（`chainLayers` / `merge`：全局先、
  scoped 后，同名覆盖；**没有 subtraction/suppress**）。因此：
  - scoped 再注册同名 provider 只会“覆盖”，名字仍在清单里；
  - 无法只为一个作用域移除全局 provider；
  - 整段 shadow `mcp-resource-servers` 会连**保留的** server 名字一起抹掉，不可接受；
  - 唯一不碰宿主内部结构的办法是在装配结果上做文本剔除（本插件 v1.7.2 的做法）。

另：宿主 system-prompt 的段覆盖契约见 `dsh-system-prompt/lib/index.js:247`（“section shadows a
global section with the same name”）与 `:117-118`（空文本段在 `renderPrompt` 阶段被丢弃）——
这是通道 #2 的实现依据。

## 3. 插件当前做法（v1.7.2）

均按**会话（agent 作用域）** 生效，重新开启/换代即恢复，不改全局配置文件。

1. **指令段遮蔽**（`applyPromptShadows`）：按 `restrictTargets` 在
   `agent.ctx.get("systemPrompt")` 注册 `{ name: \`mcp:<serverName>\`, order: MCP_SERVERS, text: "" }`；
   增量维护（已生效跳过、失效释放、失败静默重试且同一失败只告警一次）；本代已挂载的项目层
   同名 server 跳过（同作用域重复注册会抛错、可能拖垮挂载）；只对“确定挂在 root 侧”的
   server 注册（`globalMounts` 或全局工具表证据）。
2. **资源清单剔除**（`installResourceListFilter` + `filterResourceListNames`）：
   - 每会话在 `agent.ctx.on("system-prompt/assemble", …)` 注册**恰好一个**装配钩子；
   - 只处理 `name === "mcp-resource-servers"` 的段：用正则解析段尾
     `server argument: [...]` 的 JSON 名单，剔除 `resourceListHidden` 中的字符串名字
     （非字符串项原样保留），用原前后缀 `JSON.stringify` 拼回，顺序不变；
   - 全部剔除 → 保留段、名单写 `[]`；**不整段删除**；
   - **fail-open**：正则/JSON/数组/文本类型不符时返回原 assembly（宿主改文案只退化为
     “名单不隐藏”，不影响装配）；
   - 宿主 `ctx.on` 不可用或注册抛错 → 一次性 warning + 降级，不拖垮会话挂载。

隐藏名单 `resourceListHidden` = `restrictTargets` 去掉本代本会话已挂载的 serverName，由
`applyPromptShadows` 在 `remount` 完成后 / `remountGlobal` 完成后 / `tools/change` 时重算，
钩子只读该集合，因此开关是动态生效的。

## 4. 残留与代价（必须知道）

- **功能残留（待上游）**：三个资源工具仍能列出/读取被关 server 的 resources——`request()`
  用 `layers.merge(exec.agent)` 解析 provider，工具层没有“只删单个 provider 资源能力”的接口。
  如果“关闭”被当作隔离/降权手段，这一条需要特别留意（当前语义是“能力面收敛”，不是安全边界）。
- **文本耦合（插件侧代价）**：#3 的剔除依赖宿主清单段的**字面文案**（`server argument:`
  锚点 + 段尾单行 JSON 数组）。宿主若改文案/结构，过滤会 fail-open 退化为“名字重新出现”，
  不会报错；届时按 §2 重新对齐正则即可。**不要**把它升级成“整段删除”或“复刻整段模板”。

## 5. 退出条件（上游落地后要做什么）

上游 discussion 建议了三条路线（任一条落地即可）：

1. 资源清单与资源请求改为**从受限工具视图派生**（restrict 了 `mcp__<server>__*` 即视为不可见）；
2. 提供 `mcpResources.suppress(server)` 之类的 **scoped 抑制/移除 API**（精确 disposer，merge 做减法）；
3. 提供 per-assembly 的清单过滤钩子（最不优先，仍是文本层）。

落地后本仓库动作：
- 删除 `installResourceListFilter` / `filterResourceListNames` / `RESOURCE_LIST_PATTERN` 文本手术，
  改用上游 API（并同步 CHANGELOG / AGENTS.md / README 的“已知残留”表述）；
- 删除 `applyPromptShadows` 中已不再需要的兼容分支（若上游同时覆盖指令段——按实际契约判断）；
- 回归：`notes/verify/prompt-shadow.mjs`、`notes/verify/resource-list-filter.mjs`、
  `notes/verify/loader-behavior.mjs`（均在 `notes/`，gitignored）。

## 6. 复现与验证

复现（真机）：
1. 在会话能力里关掉任意一个**全局/外部注入**的 MCP server；
2. 下一轮消息的系统提示词里：`### MCP server: <该名字>` 应消失；`## MCP resource servers`
   名单中不应再有该名字（全关时为 `[]`）；
3. 直接调用 `list_mcp_resources`（`server` 填该名字）：**仍可返回**——即本文件记录的残留。

本地验证（gitignored，不入库）：
- `notes/verify/prompt-shadow.mjs`（68/68）：指令段遮蔽行为；
- `notes/verify/resource-list-filter.mjs`（48/48）+ `resource-list-filter-negative-controls.mjs`
  （5/5 变异可检出）：资源清单文本剔除；
- `notes/verify/real-runtime/`：运行版 DSH 0.2.1-rc.3 的真实语义取证（含 `mcp-resource-servers`
  残留确认、版本漂移、`complete: true` 无害性）。

## 7. 讨论记录

- **2026-10-30**：向 `deepseek-ai/deepseek-harness` 提交 discussion
  <https://github.com/deepseek-ai/deepseek-harness/discussions/11562>
  （标题：*dsh-mcp-resources: allow per-session suppression of disabled servers (prompt name list + resource tools)*），
  内容包括现象、源码位置、三条候选修法、当前插件侧权宜方案。后续有结论时在本文件追加一行。
