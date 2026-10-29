/**
 * `CapabilityPanelApi` 的 Web 客户端适配器：每个调用都走插件自有 RPC 通道
 * （`/capability-panel`，见 channel.ts），endpoint 按域前缀命名
 * （`skills.*` / `mcp.*`，见 remote.ts 的路由表）。
 *
 * 这里负责：包上信封 → 调用通道 → 解信封（失败抛错）→ 把宿主返回的
 * 普通对象投影成客户端类型（见 toSummary）。
 *
 * @module dsh-capability-settings/client/api-adapter
 */
import { CHANNEL } from "../channel.js";
/** 构建传输无关的面板 API（RPC 实现）。 */
export function createPanelApi(deps) {
    /** 调用一次宿主 RPC，并把响应归一成与旧信封同构的 RawResult。 */
    async function rpc(endpoint, payload, signal) {
        const raw = await deps.rpc.call(CHANNEL, endpoint, payload, signal);
        if (raw && typeof raw === "object" && "ok" in raw) {
            const record = raw;
            // 宿主把业务失败包成 { ok: true, value: { ok: false, errors } }
            // （传输信封恒为 ok:true，见 remote.ts 的说明）。这里重新曝光为
            // { ok: false, errors }，让所有调用点的旧逻辑（!result.ok → 报错）
            // 保持不变。
            if (record.ok === true && record.value !== null && typeof record.value === "object") {
                const inner = record.value;
                if (inner.ok === false && Array.isArray(inner.errors)) {
                    // 展平业务失败信封时**透传其余字段**（如 importToProject 的
                    // existed 标记——丢失它会让客户端的"确认覆盖"两击交互永远走不到）。
                    const { ok: _ok, errors, ...rest } = inner;
                    return { ok: false, errors: errors, ...rest };
                }
                return raw;
            }
            // ok === false：兼容旧宿主把失败直出在传输信封上的情况。
            return {
                ok: false,
                errors: Array.isArray(record.errors)
                    ? record.errors
                    : [typeof record.message === "string" ? record.message : "操作失败"],
            };
        }
        return { ok: false, errors: [`unexpected response from ${CHANNEL}`] };
    }
    /**
     * 解开双层信封：宿主编排层把业务结果（CreateResult / TransferResult 等
     * 自带 ok/errors 的形状）包进 RPC 信封 `{ ok: true, value }`，所以信封
     * ok 不代表业务成功。value 自身带 ok 字段时以业务层为准。
     */
    function unwrap(result) {
        if (result.ok && result.value !== null && typeof result.value === "object" && "ok" in result.value) {
            return result.value;
        }
        return result;
    }
    return {
        skills: {
            /** 列表：把宿主返回的普通对象逐条投影成 ClientSkillSummary。 */
            async list() {
                const cwd = deps.currentWorkspaceCwd();
                const result = await rpc("skills.list", { cwd });
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                const values = result.value.filter((v) => v !== null && typeof v === "object");
                return values.map(toSummary);
            },
            /**
             * 会话视角列表：与 `list()` 同源，但宿主额外投影 `enabledInSession` /
             * `canToggleInSession`（需要本 api 带 sessionId——只有 composer 的每会话
             * api 有）。输入框下方的能力配置区用它。
             */
            async sessionList() {
                if (deps.sessionId === undefined)
                    throw new Error("skills.sessionList 只能在会话作用域的 api 上调用");
                const cwd = deps.currentWorkspaceCwd();
                const result = await rpc("skills.sessionList", { cwd, sessionId: deps.sessionId });
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                const values = result.value.filter((v) => v !== null && typeof v === "object");
                return values.map(toSummary);
            },
            /** 会话级关闭 / 恢复：宿主返回业务信封，失败抛错由 UI 回滚。 */
            async setSessionEnabled(input) {
                if (deps.sessionId === undefined)
                    throw new Error("skills.setSessionEnabled 只能在会话作用域的 api 上调用");
                const cwd = deps.currentWorkspaceCwd();
                const result = unwrap(await rpc("skills.setSessionEnabled", { ...input, sessionId: deps.sessionId, ...(cwd !== undefined ? { cwd } : {}) }));
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                return result;
            },
            /** 详情：宿主可能返回 undefined（不存在）；注入行走 registry fallback。 */
            async read(name, ref) {
                const cwd = deps.currentWorkspaceCwd();
                // `ref` 带 root（磁盘行）/ scope（兜底）——旧实现只传 name，导致项目技能
                // 详情恒 not found（架构契约 §8.5）；注入行则由宿主回落到 registry。
                const result = unwrap(await rpc("skills.read", {
                    name,
                    cwd,
                    ...(ref ?? {}),
                    ...(deps.sessionId !== undefined ? { sessionId: deps.sessionId } : {}),
                }));
                // 业务失败（磁盘 not found / registry 命中但 get 失败）按「无详情」处理，
                // 内容区显示空态而不是把错误对象当详情渲染。
                if (!result.ok)
                    return undefined;
                return toSkillDetail(result, name);
            },
            /**
             * 注入技能的单个资源文件读取：业务失败（escape / not-text / too-large …）
             * 原样返回 `{ok:false, errors, code}`，由内容区就地展示；传输层失败才抛。
             */
            async readResource(input) {
                const cwd = deps.currentWorkspaceCwd();
                const result = unwrap(await rpc("skills.readResource", {
                    ...input,
                    cwd,
                    ...(deps.sessionId !== undefined ? { sessionId: deps.sessionId } : {}),
                }));
                if (!result.ok) {
                    const code = result.code;
                    return {
                        ok: false,
                        errors: result.errors,
                        ...(typeof code === "string" && code.length > 0 ? { code: code } : {}),
                    };
                }
                // 关键：`unwrap` 已把 `{ok:true,value:{ok:true,path,…}}` 展平成业务对象
                // `{ok:true,path,…}` 本身（见上方 unwrap 定义），这里不能再读
                // `result.value`——那会恒为 undefined，把成功响应误判成「非法结果」
                // （安全审计 task-6 发现 1）。仍兼容外层多包一层 `value` 的防御性形状。
                const raw = result;
                const value = (typeof raw.path === "string"
                    ? raw
                    : raw.value !== null && typeof raw.value === "object"
                        ? raw.value
                        : raw);
                if (typeof value.path !== "string" || typeof value.content !== "string") {
                    return { ok: false, errors: ["资源读取返回了非法结果"] };
                }
                return {
                    ok: true,
                    path: value.path,
                    size: typeof value.size === "number" && Number.isFinite(value.size) ? value.size : value.content.length,
                    content: value.content,
                    truncated: value.truncated === true,
                };
            },
            async create(input) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("skills.create", { ...input, cwd }));
            },
            async update(input) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("skills.update", { ...input, cwd }));
            },
            async remove(input) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("skills.remove", { ...input, cwd }));
            },
            /** 一键启用/禁用：与服务端同名词条一致，直接返回信封。 */
            async setEnabled(input) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("skills.setEnabled", { ...input, cwd }));
            },
            /** 细粒度调节调用方式（模型/用户两个方向分别开关）：与服务端同名词条一致。 */
            async setInvocation(input) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("skills.setInvocation", { ...input, cwd }));
            },
            /** 上传安装：解开信封后投影成 InstallResult。 */
            async installUpload(input) {
                const cwd = deps.currentWorkspaceCwd();
                return toInstallResult(unwrap(await rpc("skills.install", { ...input, cwd })));
            },
            /** 宿主路径安装。 */
            async installFromPath(input) {
                const cwd = deps.currentWorkspaceCwd();
                return toInstallResult(unwrap(await rpc("skills.install", { ...input, cwd })));
            },
            /** URL 下载安装（GitHub 仓库 / .zip / raw .md）。 */
            async installFromUrl(input) {
                const cwd = deps.currentWorkspaceCwd();
                return toInstallResult(unwrap(await rpc("skills.install", { ...input, cwd })));
            },
            /** 导入全局 skill 到当前项目：与服务端同名词条一致，直接返回信封（existed/path 字段透传）。 */
            async importToProject(input) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("skills.importToProject", { ...input, cwd }));
            },
            /** 在本项目内禁用某个全局 skill（shadow stub）：与服务端同名词条一致（existed 字段透传）。 */
            async disableInProject(input) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("skills.disableInProject", { ...input, cwd }));
            },
            /** 恢复全局 skill 在本项目可用（删除 shadow stub，幂等）。 */
            async enableInProject(input) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("skills.enableInProject", { ...input, cwd }));
            },
            /** 导出为文件清单：解开信封后按宿主返回的形状投影。 */
            async exportFiles(input) {
                const cwd = deps.currentWorkspaceCwd();
                const result = unwrap(await rpc("skills.export", { ...input, cwd }));
                if (!result.ok)
                    return { ok: false, errors: result.errors };
                // 解开信封后 result 即业务层 TransferResult：files/name/format 直接挂其上。
                const self = result;
                if (!Array.isArray(self.files))
                    return { ok: false, errors: ["export returned no files"] };
                return {
                    ok: true,
                    name: typeof self.name === "string" ? self.name : input.name,
                    format: self.format === "directory" ? "directory" : "flat",
                    files: self.files,
                    ...(self.lossy === true ? { lossy: true } : {}),
                };
            },
            /** 导出到宿主目录。 */
            async exportToPath(input) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("skills.export", { ...input, cwd }));
            },
        },
        mcp: {
            /** 列表：宿主的合并视图直接可用，无需投影。 */
            async list() {
                const cwd = deps.currentWorkspaceCwd();
                // sessionId 让宿主投影 enabledInSession（会话能力配置区需要）。
                const result = await rpc("mcp.list", { cwd, ...(deps.sessionId !== undefined ? { sessionId: deps.sessionId } : {}) });
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                return result.value;
            },
            async upsert(input) {
                const cwd = deps.currentWorkspaceCwd();
                return rpc("mcp.upsert", { ...input, cwd });
            },
            async remove(input) {
                const cwd = deps.currentWorkspaceCwd();
                return rpc("mcp.remove", { ...input, cwd });
            },
            async setEnabled(input) {
                const cwd = deps.currentWorkspaceCwd();
                return rpc("mcp.setEnabled", { ...input, cwd });
            },
            /** 导入全局 server 到当前项目：与服务端同名词条一致，直接返回信封（existed 字段透传）。 */
            async importToProject(input) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("mcp.importToProject", { ...input, cwd }));
            },
            async status() {
                const cwd = deps.currentWorkspaceCwd();
                const result = await rpc("mcp.status", { cwd });
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                return result.value;
            },
            /**
             * 「测试」：探测结果自带业务 ok/errors 形状，`unwrap` 后直接以
             * McpTestResult 归一返回（失败不抛异常，交给面板就地展示）。
             */
            async test(input) {
                const cwd = deps.currentWorkspaceCwd();
                return toMcpTestResult(unwrap(await rpc("mcp.test", { ...input, cwd })));
            },
            /**
             * 最近 MCP 工具调用记录（只读、内存内、不落盘）。
             * 宿主的 `sessionId` 在这里就地解析成会话标题，面板直接展示。
             */
            async usage(input) {
                const result = await rpc("mcp.usage", { ...(input ?? {}) });
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                const view = (result.value ?? { entries: [], limit: 0 });
                const entries = Array.isArray(view.entries) ? view.entries : [];
                return {
                    limit: typeof view.limit === "number" ? view.limit : entries.length,
                    entries: entries
                        .map((raw) => {
                        const entry = (raw ?? {});
                        const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : "";
                        const title = sessionId.length > 0 ? deps.sessionTitle?.(sessionId) : undefined;
                        return {
                            time: typeof entry.time === "number" ? entry.time : 0,
                            serverName: typeof entry.serverName === "string" ? entry.serverName : "",
                            tool: typeof entry.tool === "string" ? entry.tool : "",
                            sessionId,
                            ...(typeof title === "string" && title.length > 0 ? { sessionTitle: title } : {}),
                        };
                    })
                        .filter((entry) => entry.serverName.length > 0 && entry.tool.length > 0),
                };
            },
            /**
             * 运行时注入的 MCP（只读）：宿主的 `{servers:[{serverName,tools,calls}]}` 直接
             * 投影成客户端类型；脏数据丢弃。v13 R4 额外透传 channel / attribution /
             * synthesized，并把 `origin:"namespace"`（工具命名空间合成行）原样保留。
             */
            /**
             * 设置**当前 session** 的能力开关。sessionId 来自 api 的 deps（composer 的
             * 每个 session 一份 api），面板侧没有这个入口。
             */
            async setSessionEnabled(input) {
                if (deps.sessionId === undefined)
                    throw new Error("mcp.setSessionEnabled 只能在会话作用域的 api 上调用");
                const cwd = deps.currentWorkspaceCwd();
                const result = await rpc("mcp.setSessionEnabled", { ...input, sessionId: deps.sessionId, ...(cwd !== undefined ? { cwd } : {}) });
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                const value = (result.value ?? {});
                if (value.ok === false)
                    throw new Error(Array.isArray(value.errors) ? value.errors.join("; ") : "mcp.setSessionEnabled failed");
            },
            async runtime(input) {
                // cwd 用于宿主机判断"本项目是否已禁用"；sessionId 让宿主多返回 enabledInSession。
                const result = await rpc("mcp.runtime", {
                    cwd: input?.cwd ?? deps.currentWorkspaceCwd(),
                    ...(deps.sessionId !== undefined ? { sessionId: deps.sessionId } : {}),
                });
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                const view = (result.value ?? { servers: [] });
                const servers = Array.isArray(view.servers) ? view.servers : [];
                return {
                    servers: servers
                        .map((raw) => {
                        const server = (raw ?? {});
                        const tools = Array.isArray(server.tools) ? server.tools : [];
                        return {
                            serverName: typeof server.serverName === "string" ? server.serverName : "",
                            ...(typeof server.source === "string" && server.source.length > 0 ? { source: server.source } : {}),
                            origin: server.origin === "entry"
                                ? "entry"
                                : server.origin === "namespace"
                                    ? "namespace"
                                    : "fiber",
                            ...(typeof server.channel === "string" && server.channel.length > 0 ? { channel: server.channel } : {}),
                            ...(toMcpAttribution(server.attribution) !== undefined ? { attribution: toMcpAttribution(server.attribution) } : {}),
                            ...(server.synthesized === true ? { synthesized: true } : {}),
                            ...(server.transport === "stdio" || server.transport === "http" ? { transport: server.transport } : {}),
                            ...(typeof server.summary === "string" && server.summary.length > 0 ? { summary: server.summary } : {}),
                            ...(server.disabledInProject === true ? { disabledInProject: true } : {}),
                            restrictable: server.restrictable === true,
                            ...(typeof server.enabledInSession === "boolean" ? { enabledInSession: server.enabledInSession } : {}),
                            calls: typeof server.calls === "number" ? server.calls : 0,
                            tools: tools
                                .map((item) => {
                                const tool = (item ?? {});
                                return {
                                    name: typeof tool.name === "string" ? tool.name : "",
                                    ...(typeof tool.description === "string" && tool.description.length > 0 ? { description: tool.description } : {}),
                                    ...(tool.parameters !== null && typeof tool.parameters === "object" ? { parameters: tool.parameters } : {}),
                                };
                            })
                                .filter((tool) => tool.name.length > 0),
                        };
                    })
                        .filter((server) => server.serverName.length > 0),
                };
            },
        },
        tools: {
            /**
             * 列出插件单元（v13）。宿主把「服务缺失 / schemas() 失败」包成空 units +
             * errors（不阻断其它域）；适配器原样投影，界面据此显示空态说明。
             */
            async list(input) {
                const sessionId = input?.sessionId ?? deps.sessionId;
                const result = await rpc("tools.list", { ...(sessionId !== undefined ? { sessionId } : {}) });
                if (!result.ok) {
                    return { units: [], totalGlobalTools: 0, excludedBuiltinCount: 0, errors: result.errors };
                }
                return toToolsList(result.value);
            },
            /**
             * 按需读取工具定义（含 parameters）：只在详情选中单元时调用，按 unit 缓存。
             * 业务失败抛错，UI 降级为「仅名称 + 说明」并提示参数不可用。
             */
            async inspect(input) {
                const sessionId = input.sessionId ?? deps.sessionId;
                const result = await rpc("tools.inspect", {
                    unit: input.unit,
                    ...(sessionId !== undefined ? { sessionId } : {}),
                });
                // 业务失败必须抛错（否则会被 toToolsInspect 投影成空清单、静默降级成
                // 「无参数」，掩盖 unit 失效 / 服务缺失）。`rpc()` 已把外层的
                // `{ok:true,value:{ok:false,errors}}` 展平成 `{ok:false,errors}`；这里
                // 再防御一次 value 自身带 `ok:false` 的旧/异常形状。
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                const value = result.value;
                if (value !== null && typeof value === "object" && value.ok === false) {
                    const errors = value.errors;
                    throw new Error(Array.isArray(errors) ? errors.join("; ") : "tools.inspect failed");
                }
                const inspected = toToolsInspect(value);
                // 响应既无 unit 也无 tools = 非法结果；宁可让 UI 显示错误，也不假装「无参数」。
                if (inspected.unit.length === 0 && inspected.tools.length === 0) {
                    throw new Error("tools.inspect 返回了空结果（unit/tools 缺失）");
                }
                return { unit: inspected.unit.length > 0 ? inspected.unit : input.unit, tools: inspected.tools };
            },
            /**
             * 设置插件的**全局默认**开关（能力面板 Tools 页）：影响所有会话的默认，
             * 不写任何会话覆盖。业务失败抛错（页面显示错误并回滚开关）。
             */
            async setGlobalEnabled(input) {
                const result = unwrap(await rpc("tools.setGlobalEnabled", { units: input.units, enabled: input.enabled }));
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                return { ok: true, applied: typeof result.applied === "number" ? result.applied : input.units.length };
            },
            /** 按会话开关插件（batch-first）；业务失败抛错（与 skills/mcp 单条一致）。 */
            async setSessionEnabled(input) {
                const sessionId = input.sessionId ?? deps.sessionId;
                if (sessionId === undefined)
                    throw new Error("tools.setSessionEnabled 需要当前会话");
                const result = unwrap(await rpc("tools.setSessionEnabled", { sessionId, units: input.units, enabled: input.enabled }));
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                return { ok: true, applied: typeof result.applied === "number" ? result.applied : input.units.length };
            },
        },
        session: {
            /**
             * 批量开/关/恢复默认（v13 R1）。`failed[]` 属成功 value，不抛错；
             * 业务失败（缺 sessionId / 非法 action / 未知域）原样返回 `{ok:false,errors}`。
             */
            async setBulk(input) {
                const sessionId = input.sessionId ?? deps.sessionId;
                const payload = { ...input, ...(sessionId !== undefined ? { sessionId } : {}) };
                const result = await rpc("session.setBulk", payload);
                if (!result.ok)
                    return { ok: false, errors: result.errors };
                return toSessionBulkResult(unwrap(result));
            },
        },
        overrides: {
            /** 读取当前项目的禁用声明全量（宿主侧无工作区时返回空清单）。 */
            async get() {
                const cwd = deps.currentWorkspaceCwd();
                const result = await rpc("overrides.get", { cwd });
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                const view = (result.value ?? {});
                const listOf = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
                return {
                    mcp: listOf(view.mcp),
                    // skills 域是宿主 additive 字段：旧宿主缺失时按空清单（旧行为不变）。
                    skills: listOf(view.skills),
                    ...(typeof view.filePath === "string" ? { filePath: view.filePath } : {}),
                    ...(typeof view.projectRoot === "string" ? { projectRoot: view.projectRoot } : {}),
                };
            },
            /** 切换某个全局能力在本项目的禁用状态（写回后由面板重拉列表刷新标记）。 */
            async toggle(domain, key) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("overrides.toggle", { cwd, domain, key }));
            },
        },
        jev: {
            /**
             * 读取全局配置视图：宿主只回掩码 / 来源，**永不含明文**（架构 §4.2）。
             * 传输层失败（通道不可用 / 宿主未装配 jev 服务）抛错，配置页进入
             * load-error 态并给「重试」。
             */
            async getConfig() {
                const result = await rpc("jev.getConfig", {});
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                return toJevConfigView(result.value);
            },
            /**
             * 保存全局配置：**业务失败原样返回**（`invalid-config` / `write-failed`
             * + errors + 可选 issues），不抛错——配置页需要按 code 分类并把
             * issues 落到字段行内。只有传输层失败才抛。
             */
            async setConfig(input) {
                const result = await rpc("jev.setConfig", { config: input.config });
                const failure = toJevFailure(result);
                if (failure !== undefined)
                    return failure;
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                return { ok: true };
            },
            /**
             * 测试连接：宿主发一次最小探针。
             *
             * - 无参：payload `{}` ⇒ 用已保存配置（旧行为）；
             * - 传 `{config: JevSetConfigInput}`：**透传内层对象**为 RPC payload
             *   `{config: JevConfigInput}`（与 setConfig 同形），宿主据此合并出仅本次
             *   探针使用的临时配置，不写盘（AC-CFG-10）。
             *
             * 业务失败带 code 原样返回供分类文案；传输层失败才抛。
             */
            async test(input) {
                const payload = input?.config !== undefined ? input.config : {};
                const result = await rpc("jev.test", payload);
                const failure = toJevFailure(result);
                if (failure !== undefined)
                    return failure;
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                const value = unwrap(result);
                return {
                    ok: true,
                    model: typeof value.model === "string" && value.model.length > 0 ? value.model : "",
                    latencyMs: typeof value.latencyMs === "number" && Number.isFinite(value.latencyMs) ? value.latencyMs : 0,
                };
            },
            /**
             * 评分：`sessionId` / `cwd` 由 api 依赖注入（组件只传草稿）。
             * 业务失败（含 no-config / auth / timeout 等 9 个 code）**不 throw**，
             * 前端按 code 分类；面板根 api 没有 session 上下文时直接抛错。
             */
            async rank(input, signal) {
                if (deps.sessionId === undefined)
                    throw new Error("jev.rank requires a session context");
                const cwd = input.cwd ?? deps.currentWorkspaceCwd();
                const result = await rpc("jev.rank", { sessionId: deps.sessionId, draft: input.draft, ...(cwd !== undefined ? { cwd } : {}) }, signal);
                const failure = toJevFailure(result);
                if (failure !== undefined)
                    return failure;
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                return unwrap(result);
            },
            /** 应用：同上，业务失败原样返回（bad-request / write-failed）。 */
            async apply(input) {
                if (deps.sessionId === undefined)
                    throw new Error("jev.apply requires a session context");
                const cwd = input.cwd ?? deps.currentWorkspaceCwd();
                const result = await rpc("jev.apply", {
                    sessionId: deps.sessionId,
                    plan: input.plan,
                    ...(cwd !== undefined ? { cwd } : {}),
                });
                const failure = toJevFailure(result);
                if (failure !== undefined)
                    return failure;
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                return unwrap(result);
            },
        },
        // 工作区相关方法直接透传注入的 deps（状态由 client.ts 持有）。
        workspaceLabel() {
            return deps.currentWorkspaceCwd() ?? "（无工作区）";
        },
        selectedProject() {
            return deps.selectedProject();
        },
        selectProject(path) {
            deps.selectProject(path);
        },
        projects() {
            return deps.listProjects();
        },
        subscribeWorkspace(listener) {
            return deps.subscribeWorkspace(listener);
        },
    };
}
/**
 * `tools.list` 视图的防御性投影：宿主字段缺失 / 类型漂移时补默认值，
 * 保证 UI 永远可渲染（工具清单只收 name/description，不带 parameters）。
 */
function toToolsList(value) {
    const raw = (value ?? {});
    const units = (Array.isArray(raw.units) ? raw.units : [])
        .map((item) => {
        const unit = (item ?? {});
        if (typeof unit.unit !== "string" || unit.unit.length === 0)
            return undefined;
        const tools = (Array.isArray(unit.tools) ? unit.tools : [])
            .map((tool) => {
            const brief = (tool ?? {});
            if (typeof brief.name !== "string" || brief.name.length === 0)
                return undefined;
            return {
                name: brief.name,
                ...(typeof brief.description === "string" && brief.description.length > 0 ? { description: brief.description } : {}),
            };
        })
            .filter((tool) => tool !== undefined);
        const attribution = (unit.attribution ?? {});
        const matchedBy = attribution.matchedBy === "prefix" || attribution.matchedBy === "exact" ? attribution.matchedBy : "unknown";
        // v13 两层语义：`defaultEnabled` = 全局默认，`enabled` = 本会话生效值。
        // 旧宿主只有 `enabledInSession`（单层）→ 两个都回落到它；再缺省按默认开启。
        const legacyEnabled = typeof unit.enabledInSession === "boolean" ? unit.enabledInSession : undefined;
        const defaultEnabled = typeof unit.defaultEnabled === "boolean" ? unit.defaultEnabled : (legacyEnabled ?? true);
        const enabled = typeof unit.enabled === "boolean" ? unit.enabled : (legacyEnabled ?? defaultEnabled);
        const restriction = (unit.restriction ?? {});
        const restrictionState = restriction.state === "applied" || restriction.state === "skipped" || restriction.state === "failed"
            ? restriction.state
            : undefined;
        const projected = {
            unit: unit.unit,
            name: typeof unit.name === "string" && unit.name.length > 0 ? unit.name : unit.unit,
            kind: unit.kind === "unattributed" ? "unattributed" : "plugin",
            tools,
            toolCount: typeof unit.toolCount === "number" && Number.isFinite(unit.toolCount) ? unit.toolCount : tools.length,
            attribution: {
                matchedBy,
                ...(typeof attribution.pattern === "string" && attribution.pattern.length > 0 ? { pattern: attribution.pattern } : {}),
                ...(typeof attribution.packageName === "string" && attribution.packageName.length > 0
                    ? { packageName: attribution.packageName }
                    : {}),
            },
            defaultEnabled,
            enabled,
            // 旧字段保留填值（旧代码/测试读 enabledInSession 时语义不变）。
            enabledInSession: legacyEnabled ?? enabled,
            explicit: unit.explicit === true,
            ...(typeof unit.lockedReason === "string" && unit.lockedReason.length > 0 ? { lockedReason: unit.lockedReason } : {}),
            ...(restrictionState !== undefined
                ? {
                    restriction: {
                        state: restrictionState,
                        ...(typeof restriction.error === "string" && restriction.error.length > 0 ? { error: restriction.error } : {}),
                    },
                }
                : {}),
        };
        return projected;
    })
        .filter((unit) => unit !== undefined);
    return {
        units,
        totalGlobalTools: typeof raw.totalGlobalTools === "number" ? raw.totalGlobalTools : 0,
        excludedBuiltinCount: typeof raw.excludedBuiltinCount === "number" ? raw.excludedBuiltinCount : 0,
        errors: Array.isArray(raw.errors) ? raw.errors.filter((item) => typeof item === "string") : [],
        ...(typeof raw.sessionId === "string" && raw.sessionId.length > 0 ? { sessionId: raw.sessionId } : {}),
    };
}
/** `tools.inspect` 的防御性投影（兼容 `{unit,tools}` / `{ok:true,unit,tools}` 两种外壳）。 */
function toToolsInspect(value) {
    const raw = (value ?? {});
    const inner = raw.value !== null && typeof raw.value === "object" ? raw.value : raw;
    const unit = typeof inner.unit === "string" ? inner.unit : typeof raw.unit === "string" ? raw.unit : "";
    const tools = (Array.isArray(inner.tools) ? inner.tools : [])
        .map((item) => {
        const tool = (item ?? {});
        if (typeof tool.name !== "string" || tool.name.length === 0)
            return undefined;
        const projected = {
            name: tool.name,
            ...(typeof tool.description === "string" && tool.description.length > 0 ? { description: tool.description } : {}),
            ...(tool.parameters !== null && typeof tool.parameters === "object" && !Array.isArray(tool.parameters)
                ? { parameters: tool.parameters }
                : {}),
        };
        return projected;
    })
        .filter((tool) => tool !== undefined);
    return { unit, tools };
}
/** `session.setBulk` 成功 value 的防御性投影（缺字段补 0 / 空表）。 */
function toSessionBulkResult(value) {
    const raw = (value ?? {});
    const countOf = (input) => {
        const item = (input ?? {});
        const num = (candidate) => typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
        return { changed: num(item.changed), unchanged: num(item.unchanged), skipped: num(item.skipped), failed: num(item.failed) };
    };
    const byDomain = (raw.byDomain ?? {});
    const failed = (Array.isArray(raw.failed) ? raw.failed : [])
        .map((item) => {
        const entry = (item ?? {});
        if (typeof entry.domain !== "string" || typeof entry.target !== "string")
            return undefined;
        const kind = entry.kind === "skill" || entry.kind === "mcp-project" || entry.kind === "mcp-server" || entry.kind === "plugin"
            ? entry.kind
            : "skill";
        return {
            domain: entry.domain,
            target: entry.target,
            kind,
            error: typeof entry.error === "string" ? entry.error : "操作失败",
        };
    })
        .filter((item) => item !== undefined);
    const action = raw.action === "disable" || raw.action === "reset" ? raw.action : "enable";
    const num = (candidate) => typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
    return {
        ok: true,
        action,
        applied: num(raw.applied),
        unchanged: num(raw.unchanged),
        skipped: num(raw.skipped),
        failed,
        byDomain: {
            skills: countOf(byDomain.skills),
            mcp: countOf(byDomain.mcp),
            tools: countOf(byDomain.tools),
        },
        ...(raw.coldSession === true ? { coldSession: true } : {}),
        elapsedMs: num(raw.elapsedMs),
    };
}
/** `mcp.runtime` 的 attribution 投影（未知形状丢弃，避免 UI 渲染垃圾）。 */
function toMcpAttribution(value) {
    if (value === null || typeof value !== "object")
        return undefined;
    const raw = value;
    if (raw.matchedBy !== "namespace" && raw.matchedBy !== "source" && raw.matchedBy !== "unknown")
        return undefined;
    return {
        matchedBy: raw.matchedBy,
        ...(typeof raw.pattern === "string" && raw.pattern.length > 0 ? { pattern: raw.pattern } : {}),
    };
}
/**
 * 把宿主返回的行对象投影成客户端摘要：
 * 调用策略是嵌套的 `invocation` 对象 → 拍平成两个布尔；
 * 其它字段做了宽松的字符串归一，防御宿主侧数据漂移。
 *
 * 注入字段（`injected` / `origin` / `channel` / …）是 additive 的：宿主/旧
 * 宿主缺失时整组字段不出现，UI 按磁盘行渲染（降级兼容）。
 */
function toSummary(value) {
    const inv = (value.invocation ?? {});
    const origin = value.origin === "bundled" || value.origin === "plugin" || value.origin === "preset" ? value.origin : undefined;
    const resourceBaseKind = value.resourceBaseKind === "directory" || value.resourceBaseKind === "url" || value.resourceBaseKind === "opaque"
        ? value.resourceBaseKind
        : undefined;
    const injected = value.injected === true;
    return {
        name: String(value.name),
        description: String(value.description ?? ""),
        ...(typeof value.whenToUse === "string" ? { whenToUse: value.whenToUse } : {}),
        modelInvocable: inv.modelInvocable !== false,
        userInvocable: inv.userInvocable !== false,
        source: String(value.source ?? "unknown"),
        format: (value.format === "directory" ? "directory" : "flat"),
        readOnly: value.readOnly === true,
        ...(typeof value.path === "string" ? { path: value.path } : {}),
        ...(typeof value.root === "string" ? { root: value.root } : {}),
        ...(value.shadowStub === true ? { shadowStub: true } : {}),
        ...(value.projectShadow === "stub" || value.projectShadow === "skill" ? { projectShadow: value.projectShadow } : {}),
        ...(typeof value.enabledInSession === "boolean" ? { enabledInSession: value.enabledInSession } : {}),
        ...(typeof value.canToggleInSession === "boolean" ? { canToggleInSession: value.canToggleInSession } : {}),
        ...(injected ? { injected: true } : {}),
        ...(origin !== undefined ? { origin } : {}),
        ...(typeof value.channel === "string" && value.channel.length > 0 ? { channel: value.channel } : {}),
        ...(typeof value.provider === "string" && value.provider.length > 0 ? { provider: value.provider } : {}),
        ...(typeof value.registrySource === "string" && value.registrySource.length > 0 ? { registrySource: value.registrySource } : {}),
        ...(resourceBaseKind !== undefined ? { resourceBaseKind } : {}),
        ...(value.contentReadOnly === true ? { contentReadOnly: true } : {}),
        ...(typeof value.disabledInProject === "boolean" ? { disabledInProject: value.disabledInProject } : {}),
    };
}
/**
 * 把 `skills.read` 的业务结果投影成客户端详情。
 *
 * 宿主的 `ReadResult` 是 `{ ok: true, spec, body, format, resources,
 * fromRegistry?, resourceBaseNote?, path? }`（不含拍平的摘要字段），这里补齐
 * `ClientSkillSummary` 的形状；注入行补 `injected` 由调用方从列表行带下来，
 * 本函数只透传宿主给的只读标记。
 */
function toSkillDetail(result, name) {
    const raw = (result ?? {});
    // 兼容两种输入：未解信封的 `{ok, value}` 与已解开的业务结果。
    const value = (raw.value !== null && typeof raw.value === "object" ? raw.value : raw);
    const spec = (value.spec ?? {});
    const invocation = (spec.invocation ?? {});
    const resources = Array.isArray(value.resources)
        ? value.resources.filter((item) => typeof item === "string")
        : [];
    if (typeof value.body !== "string")
        return undefined;
    return {
        name: typeof spec.name === "string" && spec.name.length > 0 ? spec.name : name,
        description: typeof spec.description === "string" ? spec.description : "",
        ...(typeof spec.whenToUse === "string" && spec.whenToUse.length > 0 ? { whenToUse: spec.whenToUse } : {}),
        // frontmatter 形态 → 拍平布尔（缺省语义与宿主 invocationPolicy 一致）。
        modelInvocable: invocation["disable-model-invocation"] !== true,
        userInvocable: invocation["user-invocable"] !== false,
        source: String(value.source ?? "unknown"),
        format: value.format === "directory" ? "directory" : "flat",
        readOnly: value.readOnly === true,
        ...(typeof value.path === "string" ? { path: value.path } : {}),
        spec: spec,
        body: value.body,
        resources,
        ...(value.fromRegistry === true ? { fromRegistry: true } : {}),
        ...(typeof value.resourceBaseNote === "string" && value.resourceBaseNote.length > 0
            ? { resourceBaseNote: value.resourceBaseNote }
            : {}),
    };
}
/** 把解开信封后的安装结果投影成 InstallResult（防御宿主侧数据漂移）。 */
function toInstallResult(result) {
    if (!result.ok)
        return { ok: false, errors: result.errors };
    const self = result;
    return {
        ok: true,
        ...(typeof self.name === "string" ? { name: self.name } : {}),
        ...(self.existed === true ? { existed: true } : {}),
    };
}
/**
 * 把解开信封后的探测结果投影成 McpTestResult（防御宿主侧数据漂移：
 * 工具必须是对象且带字符串 name，否则丢弃；缺省值补齐）。
 */
function toMcpTestResult(result) {
    if (!result.ok)
        return { ok: false, errors: result.errors };
    const self = result;
    const tools = (Array.isArray(self.tools) ? self.tools : [])
        .filter((tool) => tool !== null && typeof tool === "object" && !Array.isArray(tool))
        .filter((tool) => typeof tool.name === "string" && tool.name.length > 0)
        .map((tool) => toClientTool(tool));
    return {
        ok: true,
        serverName: typeof self.serverName === "string" && self.serverName.length > 0 ? self.serverName : "server",
        tools,
        elapsedMs: typeof self.elapsedMs === "number" && Number.isFinite(self.elapsedMs) ? self.elapsedMs : 0,
        ...(typeof self.instruction === "string" && self.instruction.length > 0 ? { instruction: self.instruction } : {}),
    };
}
/** 单个工具的宽松投影（parameters 必须是对象，否则省略该字段）。 */
function toClientTool(tool) {
    const parameters = tool.parameters;
    const outputSchema = tool.outputSchema;
    return {
        name: tool.name,
        ...(typeof tool.description === "string" && tool.description.length > 0 ? { description: tool.description } : {}),
        ...(parameters !== null && typeof parameters === "object" && !Array.isArray(parameters) ? { parameters: parameters } : {}),
        ...(outputSchema !== undefined ? { outputSchema } : {}),
    };
}
/**
 * `jev.*` 的业务失败提取（与 skills/mcp 的 unwrap 抛错刻意不同，架构 §9.7）：
 * 宿主把业务失败包成 `{ok:true, value:{ok:false, code, errors, issues?}}`，
 * 适配器 `rpc()` 已展平为 `{ok:false, code, errors, issues?}`。这里保留
 * `code` 原样返回，供调用方做错误分类；没有 `code` 的是传输层失败，返回
 * undefined 交给调用方抛错。
 */
function toJevFailure(result) {
    if (result.ok)
        return undefined;
    const record = result;
    const code = record.code;
    if (typeof code !== "string" || code.length === 0)
        return undefined;
    return {
        ok: false,
        code,
        errors: result.errors,
        ...(Array.isArray(record.issues) ? { issues: record.issues } : {}),
    };
}
/**
 * `jev.getConfig` 视图的防御性投影：宿主字段缺失 / 类型漂移时回退默认值，
 * 保证配置表单永远可渲染（默认值与宿主 `defaultJevConfig()` 对齐）。
 */
function toJevConfigView(value) {
    const raw = (value ?? {});
    const auto = (raw.autoTrigger ?? {});
    const source = raw.apiKeySource === "env" || raw.apiKeySource === "file" ? raw.apiKeySource : "none";
    const num = (input, fallback) => typeof input === "number" && Number.isFinite(input) ? input : fallback;
    return {
        baseURL: typeof raw.baseURL === "string" && raw.baseURL.length > 0 ? raw.baseURL : "https://api.typesafe.ai",
        model: typeof raw.model === "string" && raw.model.length > 0 ? raw.model : "jev-latest",
        hasApiKey: raw.hasApiKey === true || source !== "none",
        apiKeySource: source,
        apiKeyLast4: typeof raw.apiKeyLast4 === "string" ? raw.apiKeyLast4 : null,
        autoTrigger: {
            enabled: auto.enabled === true,
            pauseMs: num(auto.pauseMs, 1000),
            minChars: num(auto.minChars, 10),
            minEditChars: num(auto.minEditChars, 4),
        },
        timeoutMs: num(raw.timeoutMs, 30000),
        ...(typeof raw.apiKeyEnv === "string" && raw.apiKeyEnv.length > 0 ? { apiKeyEnv: raw.apiKeyEnv } : {}),
    };
}
