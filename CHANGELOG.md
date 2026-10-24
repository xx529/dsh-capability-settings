# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.4.1] - 2026-10-24

### 修复

- **能力决策「应用所选」改为筛选语义**（用户 bug：应用后本会话能力面板仍全开）：
  旧实现只启用勾选项、未勾选项保持现状，因此面板保留全部已启用能力（如 145/145），
  看起来没有过滤。现在宿主枚举当前会话全部可应用能力：勾选 → 启用、未勾选 → 关闭
  （只改当前会话、不动项目默认），只写状态不一致项；成功支新增 `enabled` / `disabled`
  计数（`applied = enabled + disabled`）；跳过项区分真正不可应用与 `already-applied`
  （后者不展示为「不可切换」），重复应用只写差异；冷会话 pending 保存完整 ops
  （含关闭）并在 `agent/created` 后重放，失败仍按前态逆序回滚。
  实现 / 验证：task-42（宿主筛选语义）、task-43（客户端 toast / 过滤）、
  task-44（tester 571 PASS / 0 FAIL，`notes/verify/jev-capability-decision/report.md`）。

## [1.4.0] - 2026-10-24

### 新增

- **能力面板第三个域 Tab「Jev 模型」**（TypeSafe Jev 全局配置页，无计数 / 无搜索 /
  无左导航）：Base URL（默认 `https://api.typesafe.ai`）、模型名（默认 `jev-latest`）、
  API Key 来源（`直接填写` / `环境变量`，默认变量名 `TYPESAFE_API_KEY`）、测试连接、
  保存、恢复默认（需行内再点一次确认，只重置表单）。保存成功**不关闭页面、不跳转**，下一次
  评分 / 测试立即生效。
- **Jev 配置存储与密钥边界**：配置文件写入 `<dshHome>/capability-panel/jev.json`
  （默认 `~/.dsh/capability-panel/jev.json`；`DSH_HOME` 存在时以其为根；目录 `0700` /
  文件 `0600`）。密钥解析优先级 **环境变量（`apiKeyEnv`）> 配置文件 `apiKey`**；
  `jev.getConfig` 只回 `hasApiKey` / `apiKeySource` / `apiKeyLast4`，浏览器与 RPC
  响应均无明文；错误、日志与错误摘要统一脱敏。旧 `~/.agents/jev.json` 无历史迁移、
  不读取。
- **首屏 hero「✦ 能力决策」**：手动点按即发起评分；结果面板替换 hero 能力区内容
  （同宽、不遮输入框、不抢焦点），按分数降序（同分技能先于 MCP、再按名称）；
  阈值滑杆 `0–1` 步长 `0.05` 默认 `0.50`，分数 ≥ 阈值预勾选、支持手改；显示
  `已选 n / N`（N 含不可切换项）；「应用所选」只写**当前会话**的会话开关，不改项目
  默认，失败尽力回滚并报错。
- **一次批量评分**：`POST {baseURL}/v1/systemone` 单次请求、每能力一条 `noul`、
  返回 0–1 分；**不分片、不按能力拆请求**；单次最多 300 个能力（超出直接报错不请求）；
  超上下文返回「输入内容超出模型上下文上限」，不自动截断或分批。缺分 / 非数值容错：
  数值 clamp 到 `[0,1]`（`1.2`→`1`），缺失 / 字符串 / `NaN` → 该能力 `score=0` +
  `reason="no-answer"`（界面「未获得评分」），**不整单失败**，列表不丢行。
- **输入停顿自动触发（默认关闭）**：开启后仅 hero 相位、已配置、无评分 / 应用进行中，
  且同时满足「草稿字符数 ≥ 最少触发字数」「自上次能力决策累计插入 + 删除字符数 ≥
  最少修改间隔字符数」时，停顿达到阈值自动发起 1 次评分并展开面板。可配置：停顿阈值
  （默认 `1000ms`，`300–3000`、步长 100）、最少触发字数（默认 `10`，`1–200`）、
  最少修改间隔字符数（默认 `4`，`1–100`）。编辑量在任意一次决策触发后、草稿清空后、
  发送首条消息后归零；停顿计时每次草稿变化都重置但不清零编辑量；取消后同草稿静默，
  直到再次累计到最少修改量；不弹 toast、不抢焦点、不进 `aria-live`。
- **冷会话排队应用**：首屏无 live agent 时 `jev.apply` 只入宿主内存 pending 队列，
  chips 立即乐观回显 + 提示「已加入本会话，发送首条消息后生效」（有跳过项时合并
  提示）；`agent/created` 后 `setTimeout(0)` 延后应用，失败重试 2 次（100ms / 300ms）；
  激活后应用失败以一次性 `pendingOutcome` 回执提示（读取即消费，插件重载会丢失）。
- **RPC**：新增 `jev.getConfig / setConfig / test / rank / apply` 五个端点；沿用
  `{ok:true,value}` 传输信封与 `value:{ok:false,...}` 业务失败约定。

### 修复

- **首次配置保存后首屏不刷新**（测试报告 F3）：配置保存成功后广播
  `capability-panel:jev-config-changed` 事件，hero 监听事件并在窗口重新聚焦时重读
  `jev.getConfig`；无需刷新页面即可用新配置评分、按新门槛自动触发。
- **Jev rank 打分质量**：旧请求把能力数组放在 `state.capabilities`，但 155 条
  noul question 的 instructions/criteria 完全相同、题内又不含能力（question id
  不发给模型），模型只能给出几乎相同的概率，实测分数集中在 0.40–0.41，排序与阈值
  失效。现改为 `state = { request, guidance }`，每题结构化 instructions 内嵌
  `capability { kind, name, description, whenToUse?, tools? }`（MCP 带工具名/描述：
  配置条目经宿主 `mcpTools(serverName)` 从工具 schema 反推、外部实例用 runtime
  tools），题目逐能力唯一、criteria 更明确，仍保持一次请求、不分片。RPC 返回形状
  不变、客户端无感；内部请求体积 152 条 ≈105KB（约 27k tokens），低于默认 64k
  上下文，超限仍报 `context-too-long`。tester task-31 复验 **567 PASS / 0 FAIL**
  （host-rank 126），typecheck / build 与既有回归全 0；真实 Jev 分数分布需用户真机
  复测（本机无 key），架构文档同步 v1.1（task-32）。

### 变更

- **结果面板精简**：移除说明行 / 隐私行 / 阈值提示，仅保留标题、模型徽标、阈值与列表。
- **域 Tab 由两个变三个**：`技能 / MCP / Jev 模型`；第三个 Tab 无计数、无搜索，
  选中时头部工作区路径与项目作用域下拉隐藏（内容区为单列配置页）。
- **评分错误语义调整**：不再有「评分结果不完整」错误态；单能力缺分 / 非法分按
  `no-answer` 容错（0 分 + 可解释标注），只有 HTTP / 鉴权 / 超时 / 上下文 / 空能力等
  整体失败才进入错误态。
- **重试与超时边界**：仅 429 / 529 在 HTTP 层最多重试 2 次（固定 500ms / 1000ms
  退避，无抖动）；其它 4xx 不重试；单次尝试超时 30s；自动触发失败不自动重试。
- **隐私与发送范围**：评分请求只由宿主发起；请求体仅含当前草稿 + 能力名称 / 描述
  （截断到 200 / 120 码点），不含历史消息、文件正文、项目路径、session/cwd 或
  API Key；错误与日志同样脱敏。
- **文档与原型**：新增 `docs/specs/jev-auto-select.md` v1.3.1（含 §11 实现裁决记录）、
  `docs/ux/jev-auto-select.md` v1.5、`docs/architecture/jev-capability-decision.md`；
  Figma v11 五帧（`docs/figma/preview/v11-*.png`）；README 增加「Jev 能力决策」章节、
  三 Tab 总述与旧截图跨版本说明。

### 内部

- 实现（task-14~21）：
  - 宿主新增 `src/jev/paths.ts`（dsh home 路径）、`types.ts`（配置 / 错误码契约）、
    `config-file.ts`（读写锁 + 原子写 + 校验 + 脱敏）、`manager.ts`（RPC 业务与密钥
    解析）、`rank.ts`（systemone 请求构造 / 容错解析 / 排序 / 错误映射）、
    `apply.ts`（枚举、会话写入事务、冷会话 pending）。
  - `src/remote.ts` 增加 5 个 `jev.*` 路由；`src/index.ts` 装配 manager / apply 引擎与
    `agent/created`、`agent/disposed` 生命周期监听；`src/shared/atomic-write.ts`
    支持写入文件 mode。
  - 客户端新增 `src/client/jev-panel.tsx`（配置页）；`src/client/api.ts` /
    `api-adapter.ts` 增加 `jev.*` 适配；`src/client/panel.tsx` 三域 Tab 与 Jev 页；
    `src/client/composer-capability.tsx` 能力决策调度器（手动 / 自动 / 编辑计数 /
    冷会话 pending / 结果面板）；`src/client/styles.ts` 新增样式与
    `@container 720/560` 断点。
- 验证（task-17）：
  - `bash notes/verify/jev-capability-decision/run-all.sh` — exit 0，**511/511 断言
    通过**（host-config 68、host-rank 93、host-apply 69、host-rpc 12、client-panel 73、
    client-hero 178、client-adapter 18）；`pnpm typecheck` / `pnpm build` exit 0。
  - 既有回归 `bash notes/verify/run-all.sh` — 全部子脚本 exit 0；既有回归断言未改，
    `render-smoke` 的域 Tab 断言仍只校验「技能 / MCP 存在且无快捷消息」，不与第三
    Tab 冲突。
  - 报告：`notes/verify/jev-capability-decision/report.md`（含覆盖矩阵、关键断言、
    规格—实现偏差 F1/F2/F3/F4/F5 与真机验证状态）。
- 未验证 / 已知限制：真机浏览器未执行（隔离 `DSH_HOME` + 同版本外壳未搭建）；hero
  `useInput` 实机可用性、冷会话排队后首条消息是否真正生效、首次配置保存后事件链
  仍建议真机补验（见报告 §8–§9）；Windows 上 POSIX mode 语义不生效（记录 warning，
  不阻断保存）。

## [1.3.4] - 2026-10-23

### 变更

- **MCP「工具与参数」改为手风琴**：工具列表行只显示工具名 + 参数个数（不再显示
  description）；点击工具名在该行**下方**展开参数表，再点收起，同一时间只展开一个。
  展开/收起只改本地状态，不重新探测。
- 工具行显式 `outline:none`（`focus-visible` 用内描边代替），修掉鼠标点击后左侧留下的
  白色焦点竖条。

### 内部

- `src/client/mcp-panel.tsx`：`ToolsInspector` 由左右两栏改为手风琴；删除两栏相关
  内联样式常量与 description 渲染。
- `src/client/styles.ts`：删除 `.skp-inspector*` / `@container` 规则，新增
  `.skp-tool-accordion` / `.skp-tool-item(-open)` / `.skp-tool-trigger` /
  `.skp-tool-chevron` / `.skp-tool-count` / `.skp-tool-body`。
- 构建 / 测试：
  - `pnpm typecheck` — exit 0，无类型错误。
  - `pnpm build` — exit 0；`lib/client.js` 343.16 kB（gzip 81.96 kB）、`lib/client.map` 529.28 kB。
  - `bash notes/verify/run-all.sh` — exit 0（render-smoke 20/20、bug1-e2e 21/21、
    mutation controlOk:true、loader-behavior 81/81、probe-connectivity 12/12、baseline PASS 等）。
  - `node notes/verify/panel-upgrade.test.mjs` — **86/86**（8 条手风琴断言：默认收起、
    行文本不含 description、点击行下展开、再点收起、单开、不重新探测、focus-visible
    内描边且旧 `.skp-inspector` 规则已移除）。
- 版本号：`1.3.4`（工具参数面板交互调整）。

## [1.3.3] - 2026-10-23

### 修复

- **切换工作区时整页闪烁**：`useAsyncList` 重新加载时只要已有数据，就保留列表/详情框架
  （不再卸载 `.skp-body`）；只有首次加载（数据尚未到达）才显示「加载中…」。点项目名/
  切工作区时页面不再闪一下。
- **MCP「工具与参数」窄容器被压扁**：两栏改为 `.skp-inspector` / `.skp-inspector-list` /
  `.skp-inspector-pane` 类；详情区设为容器查询上下文，`@container (max-width:620px)` 时
  自动改为上下堆叠（工具列表在上、参数表在下），宽详情仍保持左右两栏；左列表
  `min-width:220`，不会被右栏 min-content 压成细条。

### 内部

- `src/client/panel.tsx` / `mcp-panel.tsx`：数据到达后的重载不再以 loading 卸载 body；
  ToolsInspector 改用 CSS 类 + 容器查询。
- `src/client/styles.ts`：新增 `.skp-inspector*` 与容器查询规则；`.skp-detail-inspect`
  增加 `container-type:inline-size`。
- 构建 / 测试：
  - `pnpm typecheck` — exit 0，无类型错误。
  - `pnpm build` — exit 0；`lib/client.js` 345.12 kB（gzip 82.65 kB）、`lib/client.map` 532.19 kB。
  - `bash notes/verify/run-all.sh` — exit 0（render-smoke 20/20、bug1-e2e 21/21、
    mutation controlOk:true、loader-behavior 81/81、probe-connectivity 12/12、baseline PASS 等）。
  - `node notes/verify/panel-upgrade.test.mjs` — **84/84**（新增：数据在途切工作区不卸载
    `.skp-body`、仅首次显示加载；`.skp-inspector*` 类与 `@container (max-width:620px)` 堆叠规则）。
  - 负控制：回退 gating 后 81/84，失败项恰为新增的三条“不闪”断言。
- 版本号：`1.3.3`（交互稳定性修复）。

## [1.3.2] - 2026-10-23

### 修复

- **全局 scope 下左侧工作区列表被隐藏**：v7 实现只在 project scope 渲染工作区列表，
  点「全局」后列表消失、无法直接切到其它工作区。现在两种 scope 都保留「项目」下方的工作区
  列表；点任一工作区会切回 project scope 并钉选该工作区。
- **MCP 行 hover/选中底色错位**：底色原先只落在左侧卡片（`.skp-row`），右侧「默认」开关
  落在底色之外，hover 时像被切成两块。现在 hover/选中底色放在整行 wrapper
  （`.skp-row-wrap` / `.skp-row-wrap-active`），右侧开关与卡片处于同一块高亮内。

### 内部

- `src/client/panel.tsx` / `mcp-panel.tsx`：工作区列表去掉 scope 条件；选中工作区时
  `setScope("project")`；MCP 行 `<li>` 增加选中类。
- `src/client/styles.ts`：`.skp-row-wrap` 承载 hover/选中底色，`.skp-row` 在其内透明。
- 构建 / 测试：
  - `pnpm typecheck` — exit 0，无类型错误。
  - `pnpm build` — exit 0；`lib/client.js` 345.06 kB（gzip 82.64 kB）、`lib/client.map` 532.45 kB。
  - `bash notes/verify/run-all.sh` — exit 0（render-smoke 20/20、bug1-e2e 21/21、
    mutation controlOk:true、loader-behavior 81/81、probe-connectivity 12/12、baseline PASS 等）。
  - `node notes/verify/panel-upgrade.test.mjs` — **75/75**（新增：两种 scope 下 nav 工作区列表
    均可见；全局态点工作区 → 项目 scope + selectProject + 条目；MCP 选中行 `.skp-row-wrap-active`；
    CSS 含整行 hover 规则）。
- 版本号：`1.3.2`（交互缺陷修复）。

## [1.3.1] - 2026-10-23

### 变更

- **v7 IA 调整：工作区列表移入左导航**：工作区列表从中间列移到左 ScopeNav「项目」行下方
  （**仅 project scope 显示，global scope 隐藏**；行高 34、名称 = 文件夹 basename、`title` =
  完整路径、选中态 = 高亮 + 左侧 2px 蓝条、列表在 nav 内自身滚动）；中间列只保留标题 + 条目，
  项目未选工作区时显示居中空态「请选择左侧工作区」；**删除「‹ 工作区」返回行**。未选工作区时
  头部搜索过滤左导航工作区名/路径，已选后 nav 保持完整、搜索只过滤中间列条目。全局/项目行
  右侧「+」入口不变。
- 设计源切到 Figma 页 `Capability Panel · 交互原型 v7`（2 帧，技能 · 项目 / MCP · 项目），
  预览 `docs/figma/preview/v7-01-skills-project.png`、`v7-02-mcp-project.png`；v6 的 4 帧
  与预览转为上一版留档。
- 宽度取舍：实现沿用「中列 280 + 详情 694（内容 646，目录树常驻 200）」，不采用 v7 原型
  的 300/676；v7 帧中列标题的蓝色「+」**不补入实现**——添加入口只保留在「全局 / 项目」行
  右侧（避免两套入口）。

### 内部

- `src/client/panel.tsx` / `mcp-panel.tsx`：工作区列表移入 ScopeNav（`.skp-scope-workspaces` /
  `.skp-scope-workspace[-active]`），中间列删除 `.skp-workspace-pane` / `‹ 工作区` 返回行；
  搜索两口径（未选工作区过滤 nav，已选过滤条目）。
- 构建 / 测试：
  - `pnpm typecheck` — exit 0，无类型错误。
  - `pnpm build` — exit 0；`lib/client.js` 344.47 kB（gzip 82.52 kB）、`lib/client.map` 531.67 kB。
  - `bash notes/verify/run-all.sh` — exit 0；render-smoke 20/20、bug1-e2e 21/21、
    mutation-negative-control `controlOk:true`、composer-api-cache 7/7、workspace-items-key 10/10、
    api-two-instances 17/17、loader-behavior 81/81、probe-connectivity 12/12、
    mcp-connectivity-baseline PASS、lib 产物 loader 81/81。
  - `node notes/verify/panel-upgrade.test.mjs` — 70/70（v7 IA：工作区列表在 nav 内且 global
    隐藏 / 中间列提示空态 / 无返回行 / 两种搜索口径 / 行尾开关 / 文件树与阅读器 / MCP 参数表 /
    删除确认 / 未选工作区置灰）。
- 版本号：`1.3.1`（在 1.3.0 已推送基础上的交互布局修订）。

## [1.3.0] - 2026-10-23

### 新增

- **能力面板两域计数**：域 Tab 收敛为「技能 / MCP」并带条目计数（技能 = 项目 + 全局条目数，
  MCP = 项目 + 全局配置条目数、不含外部注入）。
- **双作用域呈现（v2 形态，第三轮已演进）**：先在同一个列表里用「本项目 / 全局」两组同屏呈现
  （组头 = 标题 + 计数 + 一句说明，组内独立滚动，空组折叠为一行引导）；**第三轮改为左导航 +
  项目按工作区下钻，v7 再把工作区列表收进左导航，见「变更」两条 IA 调整**。
- **行尾统一开关**：列表每行右端只有一个「label + 30×18 开关」，点击不改变选中、失败回滚、
  写后静默重拉。技能行 =「启用」（项目条目整体启停 `setEnabled`；全局条目 = 在本项目禁用/恢复
  `disableInProject` / `enableInProject`；项目屏蔽占位 = 恢复；只读、`项目副本生效中`、
  无工作区时置灰并给 tooltip）；MCP 行 =「默认」（语义不变：新建对话是否启用，写项目级 overrides）。
- **技能详情「目录树 + SKILL.md 阅读器」**：根目录 → 文件夹（`/` + 文件计数、可展开）→ 文件
  （类型徽标 `MD`/`JSON`/`PNG`… + 大小），14px 缩进 + 1px 引导线，`SKILL.md` 置顶并默认选中；
  点击文件 1 次切换内容（一次拉全量后本地缓存，切换 0 请求）；「预览 / 源码」切换，预览走零依赖
  Markdown 渲染（标题/列表/代码块/引用/分隔线/行内 code 与粗体；不解析内联 HTML、不加载外链图片、
  无 `dangerouslySetInnerHTML`，渲染器异常时回落 `<pre>` 原文）。上限：单文件预览 256 KB、
  目录 200 文件、树深 3 层；二进制 / 空文件 / 截断各有降级；窄容器（内容区 < 632px）目录树
  折叠为「文件 (N)」下拉。
- **MCP「工具与参数」左右两栏**（配置条目与外部注入共用 `ToolsInspector`）：左列工具清单
  （工具名 + 说明，可点选），右列参数表（参数 / 类型 / 必填 / 说明），数据来自 `inputSchema` 的
  `properties` + `required`；探测成功默认选中第一个工具，切换工具只换右栏、不重新探测；
  外部注入直接用运行时注册表数据（不需要重连）。
- 关系标签可点击互跳：`覆盖全局` / `项目副本生效中` / `本项目已禁用` 等会切到另一 scope 并选中同名条目（第三轮行为）。

### 变更

- **第三轮 IA 调整（v7 的基础）**：头部第二行改为「域 Tab（左）+ 搜索框（右）」，删除视图内搜索 / 安装工具条；
  左列新增 ScopeNav「全局 / 项目」，每行右端「+」为安装 / 添加入口（项目未选工作区时置灰）；
  项目 scope 改为**工作区下钻**——先选工作区再显示该工作区条目（v7 进一步把工作区列表移入
  左导航，见上一条）；全局 scope 只显示全局条目，MCP 的「外部注入」从独立第三组归入全局
  scope 的第二组（保留组头与计数，仅非空时出现）。
- 删除上一版「同屏双组」布局与双组组头；详情宽度 864 → 694（内容 816 → 646），
  目录树 220 → 200、阅读器 580 → 430；内容宽 < 632 时目录树折叠为下拉的阈值随之调整。
- 搜索语义收敛：只过滤**当前可见列表**，不跨 scope；**未选工作区时过滤左导航工作区名/路径，
  已选后工作区列表保持完整、只过滤中间列条目**（v7 口径）；切 scope / 工作区保留搜索词，
  切域清空；技能全局标题在搜索时显示「匹配/总数」。
- 空态按 scope 重划：全局空态、左导航工作区空态（没有工作区 / 无匹配）、中间列「请选择左侧
  工作区」提示、项目空态；全局条目在未选工作区时项目级动作（安装到本项目 / 在本项目禁用 /
  行尾开关）置灰。
- 面板 IA（上一轮）：取消「项目 / 全局」二选一 Tab（删除 `ZoneTabs`），域 Tab 只剩技能 / MCP；
  头部「项目作用域」钉选行为不变（第三轮保留，并与左导航工作区选择共用同一状态）。
- 列表行：删除行内文字动作按钮（安装 / 禁用 / 导出 / 删除等），其余动作全部收进详情动作区；
  技能状态点**仅项目行**保留（绿 / 蓝 / 灰 / 空心），全局行改用关系标签；MCP 三组行均保留
  状态点（绿 / 蓝 / 橙 / 红 / 灰）。
- 技能删除由「两击确认」改为**确认对话框**（`Modal`，写明作用域后果，`Esc` 取消）；
  MCP 删除 / 移出与引用覆盖仍为两击确认。
- MCP 详情：原「查看工具与参数」的卡片式报告改为两栏 Inspector；「使用记录」保留
  （只读、内存、不落盘）。
- 域 Tab 计数口径：技能含只读与屏蔽占位、不去重；MCP 不含外部注入（外部注入在全局 scope 的
  第二组单独计数，且仅非空时出现）。
- 安装/添加对话框的作用域默认跟随所点位置：左导航全局行「+」= 全局、项目行「+」= 该项目的工作区；
  项目未选工作区时项目侧「+」置灰。

### 移除

- **快捷消息模块整体下线**：面板域 Tab、列表 / 详情 / 安装对话框、`quick.*` RPC 端点、宿主
  `quickMessages` 服务与 `src/quick-messages/**`、`src/client/quick-messages-panel.tsx`、
  `src/client/composer-quick.tsx`；`overrides` / `imports` 的域键收敛为 `mcp`（旧文件里的
  `skills` / `quickMessages` 键读取时忽略、写盘时清除）。
- 用户数据 `.agents/quick-messages.json`（项目 / 全局及旧位置 `.dsh`）**不再读写、文件原样保留**；
  卸载也不会删除（需要清理请手动处理）。
- 面板「项目 / 全局」二选一 Tab 与 `ZoneTabs` 组件、行内文字动作按钮，以及 `在文件树中查看` /
  `查看项目副本` 两个辅助入口（分别由目录树与可点击关系标签覆盖）。

### 内部

- 技能内容区**复用 `skills.export`**（`exportSkillFiles` 已递归返回相对路径 + base64），
  **不新增宿主 RPC**；新增 `src/client/skill-content.tsx`（建树 / 阅读器 / 解码 / 上限）与
  `src/client/markdown.tsx`（零依赖 L1 渲染）。
- `src/client/mcp-panel.tsx` 新增 `ToolsInspector` 与参数表；`src/client/styles.ts` 新增
  `.skp-group*`、`.skp-file-tree*`、`.skp-file-picker*`、`.skp-reader*`、`.skp-md-*`、
  `.skp-params*` 等样式（纯自绘、只用宿主 token 与回退值）。
- 列表面板改为 `listbox` 语义 + 行尾开关；选中项、按 scope / 工作区记忆的滚动位置与搜索词在
  静默刷新后保持。
- 构建 / 测试：
  - `pnpm typecheck` — exit 0，无类型错误。
  - `pnpm build` — exit 0；`lib/client.js` 328.57 kB（gzip 79.36 kB）、`lib/client.map` 511.00 kB，`lib/quick-messages/**` 死产物已清理。
  - `bash notes/verify/run-all.sh` — exit 0；render-smoke 19/19、bug1-e2e 21/21、
    mutation-negative-control `controlOk:true`、composer-api-cache 7/7、workspace-items-key 10/10、
    api-two-instances 17/17、loader-behavior 81/81、probe-connectivity 12/12、
    mcp-connectivity-baseline PASS、lib 产物 loader 81/81。
  - `node notes/verify/panel-upgrade.test.mjs` — 55/55（第三轮 IA：2 Tab / 左导航与「+」/
    工作区下钻与返回 / 当前列表搜索 / 行尾开关语义 / 文件树与阅读器 / 源码视图 / MCP 两组与
    参数表 / 删除确认 / 未选工作区置灰）。
- 版本号：`1.3.0`（本批功能与移除均属用户可见变更，minor bump）。

## [1.2.0] - 2026-10-23

### 新增

- **会话能力配置（Skills / MCP）两个入口**：首屏（hero）输入框下方默认展开的能力面板、会话内顶部
  「能力」Tab（`conversation.view`）整页管理；均为 Tab + 卡片网格，卡片右上角开关只写**当前会话**，
  附搜索、`恢复默认`、`管理全部`。打开「能力」Tab 时临时隐藏输入框，切回其它 Tab 恢复。
  - **Skills 会话级开关（关闭 / 恢复）**：宿主 skills 注册表没有按会话禁用 API，改为在
    `agent.ctx.get("skills")` 上注册同名 runtime shadow（`invocation` 双向 false），从模型目录 /
    `skill` 工具 / `/name` 注入三条链路隐藏；恢复即解除。只可关闭、不能强制开启文件级禁用项；
    会话无 live agent 时置灰。纯内存、不落盘。
  - **MCP 会话级开关（服务器级）**：复用既有 `mcp.setSessionEnabled`（项目条目按需挂载/卸载，
    global/外部实例 `tools.restrict` 屏蔽），`mcp.list` 带 `sessionId` 投影 `enabledInSession`；
    写后 `settling` 轮询收敛。
  - 新增 RPC `skills.sessionList` / `skills.setSessionEnabled`（信封契约不变）；新增
    `src/skills/session.ts`、`src/client/composer-capability.tsx` 与 `skp-dock-*` / `skp-cap-view`
    样式（只用宿主 `--dsw-*` token）。

### 变更

- 移除输入框左下角原来的三个快捷按钮（快捷消息 / Skills / MCP）及其弹层；快捷消息仍可在侧栏能力面板
  管理。旧的 `composer-quick.tsx` / `composer-skills.tsx` / `composer-mcp.tsx` 组件代码保留未注册，
  便于回退。
- 移除上一轮原型里的「输入框下方常驻能力条」（`conversation.composer.dock`）与后续临时加的输入框
  「能力」图标/快捷弹层：会话中只保留顶部「能力」Tab，首屏保留输入框下方内联面板。
- 移除多重面板头部多余的「仅本会话」标签；hero 收起条宽度与输入卡严格对齐。

### 内部

- 验证：`pnpm typecheck` / `pnpm build` 通过；`notes/verify/session-skills.test.mjs` PASS 11；
  `notes/verify/capability-dock-render.mjs` 30/30；`notes/verify/run-all.sh` 全绿
  （bug1-e2e 的 `composerApiFor` 计数断言调整为 ≥3；按钮预取改为能力按钮的计数角标）。
- 新增 `notes/verify/dock-visual.mjs`：真实 Chromium 视觉 harness，覆盖 hero 收起/展开、快捷弹层、
  顶部 Tab 整页与窄容器。

## [1.1.0] - 2026-09-29

### 修复

- **DSH 升级到 0.2.0-rc.1 后整个插件被跳过（`skipping profile bundle`）**：
  `dsh-app-boot` 的兼容性判定只检查插件 `peerDependencies` 里
  `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 semver 范围
  （`semver.satisfies(runtime, range, { includePrerelease: true })`），原来那批
  `^0.1.0-rc.7` 在 0.2.0-rc.1 上全部不满足，于是整个 bundle 被
  `prepareProfileEntries` 跳过。其中 `@deepseek-ai/dsh-client-runtime` 在
  0.2.0-rc.1 已不再发布（npm 上最新为 0.1.1-rc.2，内容已拆到
  `dsh-client-ui-slots` / `dsh-client-ui-renderer` / `dsh-client-store` 等包），
  这条 peer 永远无法满足。现改为 `^0.2.0-rc.1` 并移除该条；`slots` 服务在
  0.2.0-rc.1 由 `@deepseek-ai/dsh-client-ui-renderer` 提供，据此更新
  `dsh.client.inject`；`@deepseek-ai/cordis` 对齐生态统一的 `~4.0.4`。
  插件自身的运行时依赖没有变化——客户端 bundle 只外部化 `react` /
  `react/jsx-runtime`，构建产物里不含任何 `@deepseek-ai/*` 导入。
- **输入框的三个弹层（快捷消息 / Skills / MCP）背景透明、下层文字透出**：
  0.2.0-rc.1 把宿主菜单底色 `--dsw-specific-menu` 改成了两级间接的磨砂底
  （`body` → `var(--dsw-menu-surface-fill)`，light `#f8f9fa94`≈58% /
  dark `#43454a73`≈45%，且只有 `html[data-platform=darwin]` 被覆盖成近不透明），
  宿主一律配 `backdrop-filter: var(--dsw-menu-backdrop-filter)` 兜底
  （16 处引用中 11 处如此）。弹层此前只抄了 `background` 没抄模糊，于是只剩
  半透明。现改用宿主不透明的层级底色 `--dsw-alias-bg-layer-1`（与
  `.skp-panel` / `.skp-modal` 同一 token）；三个弹层共用 `.skp-composer-pop`，
  一并修复。

### 破坏性变更

- `peerDependencies` 的 dsh 范围由 `^0.1.0-rc.7` 改为 `^0.2.0-rc.1`，插件不再在
  dsh 0.1.x 上加载。

## [1.0.2] - 2026-09-16

### 修复

- **同一应用里只有第一个会话能看到 MCP 工具，其余会话静默 `conflict`**：
  `mcp/loader.ts` 顶层静态 `import` 拿到的是本插件 `dependencies` 里那份
  `@deepseek-ai/dsh-mcp-client`（0.1.0-rc.8），它按 `ctx.root` 预留
  `serverName`——全应用只允许一个会话挂上同名 server，后开的会话拿不到任何
  `mcp__*` 工具，面板聚合显示「任一会话已挂载」因而看不出问题；宿主自己那份
  （0.1.5-rc.2 起）按 agent 作用域预留（`scopeOf(ctx) ?? ctx.root`），多会话
  才能各自挂载。注意**升级依赖版本解决不了**：插件自带的
  `@deepseek-ai/dsh-scope` 副本里 `kScope` 是每份模块实例独有的 Symbol，
  `scopeOf()` 读不到宿主打在 agent ctx 上的 scope tag，仍会回落 `ctx.root`。
  现改为挂载时按包名向宿主 loader 取实例
  （`ctx.get("loader").import(...)` + `unwrapExports`，解析基准是 profile
  目录），宿主没有 loader 时才回落到自带副本。

## [1.0.1] - 2026-09-16

### 修复

- **DSH 升级到 0.1.5-rc.2 后打开「能力面板」即报 `transport failure for
  /capability-panel/skills.list: HTTP 405`**：宿主端原先用
  `connection.rpc.handle("/capability-panel", …)` 挂通道，该 API 在当前版本内部
  执行 `owner.effect(() => owner.webServer.register(route))`，其中 `owner` 经
  cordis 的 shadow/origin 绑定解析成 **connection 插件自己的 ctx**（inject 里
  没有 `webServer`），于是恒定抛 `cannot get property "webServer" without
  inject`——异常发生在 `rpc.handle` 内部，通道静默不挂载，浏览器端的 POST 落到
  前端静态兜底路由上，返回 405。现改为用宿主公开 API 自行挂前缀路由：
  `ctx.inject(["connection", "webServer"], …)` 等两端服务就位 +
  `connection.requestRejection(req)` 过宿主/来源信任与浏览器会话认证 +
  `webServer.register({ kind: "prefix", path, handler })` 注册路由，并自行实现
  与 `dsh-client-connection` 客户端 `rpc.call` 一致的线上信封
  （`client-request` / `server-response`）。路由注册生命周期挂在插件自己的
  fiber 上，插件卸载 / 重载即摘除。

## [1.0.0] - 2026-09-08

### 新增

- **「在本项目禁用」全局 skill（shadow stub 屏蔽占位）**：全局区详情卡新增
  「在本项目禁用 / 在本项目恢复」。禁用会在项目 `.agents/skills` 生成一个
  同名占位文件（frontmatter 双向禁用 + `metadata: capability-panel:
  shadow-stub` 标记）——宿主 registry 按 frontmatter name 合并技能且项目根
  rank 恒高于全局根，占位文件于是顶掉同名全局条目：catalog 注入、`skill`
  工具调用、`/name` 用户注入三条链路都在本项目内被宿主**原生**拒绝（其它
  项目不受影响，也不写任何插件私有状态）。占位条目出现在项目区（灰点 +
  「屏蔽占位」徽标，删除即恢复）；被遮蔽的全局条目带「本项目已禁用」徽标；
  项目区已有同名真实条目的全局技能带「项目副本生效中」徽标。
- **Skills 快捷弹层与宿主解析口径对齐**：同名 skill 以项目区条目为准（rank
  语义）——项目副本 / 屏蔽占位 / 项目原生条目被禁用（含仅关闭「用户调用」）
  时，该名字整体从弹层排除，不再漏出全局同名的"死口令"（点了宿主也不会
  注入）；`.claude` 兼容根的条目同步排除（宿主 registry 不扫描该根）。
- **Skill 调用方式可按方向细调**：详情卡「调用方式」字段上，「模型调用」
  与「用户调用」两个方向各自独立开关（例如只希望用户 `/name` 手动触发、
  不需要 agent 自动注入的 skill，关闭「模型调用」即可）。frontmatter 只
  写入 `disable-model-invocation` / `user-invocable` 对应扁平键，另一个
  方向原样保留，正文与其它元数据不动。两个方向状态不一致时，整体按钮
  显示蓝色「部分禁用」。
- **Skills 域改为「全局 / 项目」两区分离 + 导入制**：Skills 域内不再混排
  全局与项目条目、也不再走"项目级禁用全局项"的叠层（旧
  `capability-overrides.json` 的 skills 声明不再读取）。每区只列该作用域的
  真实文件：
  - 全局区管理 `~/.agents/skills` 等全局根，**全局技能没有启停与调用方向
    开关**（会影响所有项目），只有「导入到本项目」/ 导出 / 删除；
  - 项目区管理 `<项目>/.agents/skills` 等项目根，**启用/禁用与模型/用户
    调用方向只作用于项目文件**（写 frontmatter 扁平调用键，宿主原生链路
    下一步即生效）；
  - 全局区详情卡新增「**导入到本项目**」：把全局 skill 物理复制到项目根
    （目录型连资源），此后在本项目内独立控制；同名冲突可确认覆盖；
  - 安装对话框的目标随区固定（全局区只装全局，项目区只装项目）；
  - Skills 列表行不再显示「部分禁用」等文字状态标签，只保留**项目区行的
    状态圆点**（绿=双开、蓝=部分禁用、灰=全禁用）；行内"项目/全局"标签
    与"本项目禁用"标记同时删除（区归属即作用域）；
  - 详情卡标题旁新增**归属徽标**（项目=蓝 / 全局=绿，按作用域着色）；
    删除按钮语义统一为「删除」（全局条目删全局文件，项目条目删项目文件）。
- **MCP / 快捷消息域同步改为「项目 / 全局」两区分离**：三域视图头部统一
  为项目/全局两区 Tab（取代 All/Project/Global 三档作用域过滤），每区
  只列该作用域配置文件里的真实条目；列表行不再渲染"项目/全局"标签（区
  归属即作用域），状态圆点只在项目区行显示；新增/安装对话框的默认作用域
  跟随当前区（全局区只见全局目标）。
- **「导入到本项目」（MCP / 快捷消息）= 登记引用而非物理复制**：全局区
  详情卡新增「导入到本项目」，写入
  `<项目根>/.agents/capability-imports.json`。引用内容实时取自同名全局
  条目（全局更新立即生效），启停是引用上的项目级 `disabled` 标记；引用
  与项目原生条目同级参与合并——MCP 挂载时遮蔽全局原版（启用态引用还会
  覆盖全局条目自身的 disabled 默认），快捷消息的全局原版被同名项目条目
  （原生或引用）遮蔽时标 `shadowed`，输入框弹层据此过滤。引用条目在项目
  区显示「全局」归属徽标，移除按钮为「移出」；项目内已有同名原生条目时
  报硬错误，已有同名引用时两击确认重登记（保留原启停状态）。旧版
  「导入 = 物理复制」写入的 `importedFromGlobal` 标记随读→写周期保留，
  这类副本同样显示「全局」徽标与「移出」按钮。

### 变更

- **配置文件位置改为 `.agents` 优先**：所有可写配置（项目级能力禁用声明、
  项目/全局快捷消息、全局 MCP、skills 安装目标）保存时优先写入 `.agents`
  目录（项目 `<项目根>/.agents/`，全局 `~/.agents/`）；读取兼容旧位置
  （项目 `.dsh` / `.claude`，全局 dsh home / `~/.claude`）。首次写入新位置
  时自动并入旧文件内容并删除旧文件，旧配置不丢失、不留两份。
- **Skills 只读兼容 `.claude/skills`**：项目与全局的 Claude Code 技能目录
  出现在面板中（只读徽标，不可写回）；skills 默认安装目标改为 `.agents`
  （项目）与 `~/.agents/skills`（全局）。
- **项目根判定标记新增 `.agents` 与 `.claude`**：与 `.git` / `.dsh` 同等
  参与 `findProjectRoot` 的向上探测（主目录护栏不变）。
- **三域详情卡移除「项目已启用 / 项目已禁用」覆写按钮**：项目级控制改用
  各域的导入制入口（skills = 物理副本 / 屏蔽占位，MCP / 快捷消息 = 引用
  启停）。`capability-overrides.json` 机制保留：MCP 弹层的「本项目」开关
  仍在使用；快捷消息域的既有声明仍被读取（弹层继续过滤），但面板不再
  提供开关入口（用引用启停替代）；skills 域声明不再读取。
- **代码重构**（行为不变）：三域头部 Tab 收敛为共用的 `ZoneTabs`
  （`scope-tabs.ts` 删除），`ProjectOverrideButton` 移除；skill 来源的
  项目/全局分类收敛到 `shared/skill-sources.ts`（宿主端与客户端共用）。

### 修复

- **Skills 项目区启停/调用方向现在真实生效**：此前「导入到本项目」登记的是
  引用（`capability-imports.json`），其启停状态只对插件面板可见——宿主的
  目录注入 / `skill` 工具 / `/name` 注入三条链路只读 skill 文件的
  frontmatter，而补偿用的注入守卫只能过滤**本步新注入**的消息，无法触及
  已持久化在会话里的旧目录消息，导致引用条目禁用后上下文仍始终注入。
  现在 skills 域彻底移除引用机制与注入守卫（`capability-imports.json` 里
  遗留的 skills 键读取时忽略、下次写盘自动清除），「导入到本项目」回归
  物理复制，启停与调用方向一律写项目副本的 frontmatter——由宿主的文件
  watcher + 目录重发布原生生效（实测下一步即剔除）。
- **MCP 多会话同名 server 冲突不再伪装成故障**：桥接层按 app（`ctx.root`）
  预留 `serverName`，同一 server 全应用只允许一个会话挂载，其余会话报
  `already in use` 属预期。此前面板按"最差状态"聚合（conflict 排最高），
  只要存在第二个会话，行上就永远显示「冲突」（删除后重加也一样），
  看起来像删除未生效。现在：
  - 聚合改为**任一会话已挂载即显示"已挂载"**，全部未挂载时才取最差状态；
  - 冲突状态的详情文案从桥接层的原始报错（误导性提示"pick a unique
    serverName in cordis.yml"）换成说明真实原因的中文说明。

## [0.8.0] - 2026-08-28

### 新增

- **项目级禁用全局能力**：全局的 skill / MCP server / 快捷消息默认对所有
  项目生效，现在可以在单个项目里关掉而不动全局配置。打开详情卡，点击
  **「项目已启用 / 项目已禁用」** 状态按钮（绿=生效，橙=禁用）即可。
  - 声明写入 `<项目根>/.dsh/capability-overrides.json`，全局配置原样保留，
    其他项目完全不受影响；
  - 效果真实生效：Skills / 快捷消息立刻从输入框弹层消失，MCP server 从
    本项目所有 session **热卸载**（恢复时自动重挂）。
- **MCP 快捷弹层改为「本项目」开关**：全局条目在弹层里只切换本项目
  启用/禁用（走项目级覆写，不翻全局配置）；全局已禁用的 server 不再列出。
- **输入框工具组三个弹层共享同一份列表数据**：按钮与弹层不再各拉一次
  同一份 RPC 数据（打开弹层时的重复请求被消除）。

### 变更

- **列表状态语义统一**：三个域的列表圆点统一为「绿=已启用 / 灰=已禁用 /
  橙=本项目禁用」；MCP 的挂载失败 / 冲突 / 未挂载改用行内标签与 tooltip
  呈现，详情卡「状态」字段保留完整挂载信息与错误，未再把挂载异常画进圆点。
- **代码重构**（行为不变）：
  - 输入框工具行三个弹层（快捷消息 / Skills / MCP）共用一套模块级开合
    存储 + Esc/外部点击关闭 + 锚点定位（`client/composer-common.ts`）；
  - 三个面板视图共用 `ScopeTabs` / `useAsyncList` / `ProjectOverrideButton`
    与工作区/来源判定小工具（`client/panel-common.tsx`）；
  - MCP 挂载状态按 key 聚合的"取最差"逻辑收敛到 `client/mcp-common.ts`；
  - JSON 配置文件读取脚手架、原子写入（临时文件 + rename）、错误文案
    归一收敛到 `shared/` 工具模块；file-lock 队列在 settle 后自动清理
    （长驻进程不再无界增长）；MCP 旧 fiber 改为并发释放。
- 详情卡项目级覆写按钮在**全局已禁用**时恒灰并禁用（本项目状态无意义）。

### 修复

- **安全：skill 名称路径穿越封堵**。`skills.read / remove / setEnabled /
  update / clone / export` 此前把 RPC 传入的 `name` 原样拼进文件路径
  （`join(root, name)`），恶意名称（如 `../x`）可越出受管根读写任意 `.md`
  文件；现在所有拼路径的入口强制 `isSkillName`（kebab-case）校验。
- **安全：ZIP 解压上限与越界防护**。宿主端与浏览器端解压均增加 64 MiB
  输出总量上限（对接入的压缩包上限之下再拦一层"膨胀内存"），并修复
  数据区越界被静默截断、短归档负面偏移读越界的问题（zip bomb 防护）。

[1.4.1]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.3.4...v1.4.0
[1.3.4]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/chengdb/dsh-plugin-capability-panel/compare/v0.8.0...v1.0.0
[0.8.0]: https://github.com/chengdb/dsh-plugin-capability-panel/releases/tag/v0.8.0