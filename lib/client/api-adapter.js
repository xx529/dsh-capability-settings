/**
 * `CapabilityPanelApi` 的 Web 客户端适配器：每个调用都走插件自有 RPC 通道
 * （`/capability-panel`，见 channel.ts），endpoint 按域前缀命名
 * （`skills.*` / `mcp.*`，见 remote.ts 的路由表）。
 *
 * 这里负责：包上信封 → 调用通道 → 解信封（失败抛错）→ 把宿主返回的
 * 普通对象投影成客户端类型（见 toSummary）。
 *
 * @module @chengdb/capability-panel/client/api-adapter
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
            /** 详情：宿主可能返回 undefined（不存在）。 */
            async read(name) {
                const cwd = deps.currentWorkspaceCwd();
                const result = await rpc("skills.read", { name, cwd });
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                const detail = result.value;
                if (detail === undefined)
                    return undefined;
                return detail;
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
                const result = await rpc("mcp.list", { cwd });
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
             * 投影成客户端类型；脏数据丢弃。
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
                            origin: server.origin === "entry" ? "entry" : "fiber",
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
        quickMessages: {
            /** 列表：宿主的合并视图直接可用，无需投影。 */
            async list() {
                const cwd = deps.currentWorkspaceCwd();
                const result = await rpc("quick.list", { cwd });
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                return result.value;
            },
            async upsert(input) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("quick.upsert", { ...input, cwd }));
            },
            async remove(input) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("quick.remove", { ...input, cwd }));
            },
            async setEnabled(input) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("quick.setEnabled", { ...input, cwd }));
            },
            /** 导入全局快捷消息到当前项目：与服务端同名词条一致，直接返回信封（existed 字段透传）。 */
            async importToProject(input) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("quick.importToProject", { ...input, cwd }));
            },
        },
        overrides: {
            /** 读取当前项目的禁用声明全量（宿主侧无工作区时返回空清单）。 */
            async get() {
                const cwd = deps.currentWorkspaceCwd();
                const result = await rpc("overrides.get", { cwd });
                if (!result.ok)
                    throw new Error(result.errors.join("; "));
                return result.value;
            },
            /** 切换某个全局能力在本项目的禁用状态（写回后由面板重拉列表刷新标记）。 */
            async toggle(domain, key) {
                const cwd = deps.currentWorkspaceCwd();
                return unwrap(await rpc("overrides.toggle", { cwd, domain, key }));
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
 * 把宿主返回的行对象投影成客户端摘要：
 * 调用策略是嵌套的 `invocation` 对象 → 拍平成两个布尔；
 * 其它字段做了宽松的字符串归一，防御宿主侧数据漂移。
 */
function toSummary(value) {
    const inv = (value.invocation ?? {});
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
