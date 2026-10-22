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
import type {
  CapabilityPanelApi,
  ClientMcpList,
  ClientMcpStatus,
  ClientMcpTool,
  ClientMcpRuntimeServer,
  ClientMcpUsageEntry,
  ClientOverrides,
  ClientQuickMessagesList,
  ClientSkillDetail,
  ClientSkillSummary,
  CreateSkillInput,
  InstallResult,
  McpTestResult,
  McpUpsertInput,
  WorkspaceOption,
} from "./api.js";

/** 宿主 RPC 通道结果信封的薄包装（与 remote.ts 的 RpcResult 同构）。 */
type RawResult = { ok: true; value: unknown } | { ok: false; errors: string[] };

/** 适配器的构造依赖（把"如何取当前工作区/订阅工作区"等外壳交互注入进来）。 */
export interface AdapterDeps {
  rpc: { call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> };
  /**
   * 解析"project"作用域的有效工作区目录：
   * 钉选时用钉选的路径，否则用当前 session 的工作区。
   */
  currentWorkspaceCwd(): string | undefined;
  /** 订阅活跃工作区变化；返回取消订阅函数。 */
  subscribeWorkspace(listener: () => void): () => void;
  /** 项目下拉框可用的工作区列表。 */
  listProjects(): WorkspaceOption[];
  /** 当前钉选的项目目录（undefined = 跟随当前 session）。 */
  selectedProject(): string | undefined;
  /** 钉选/取消钉选项目作用域。 */
  selectProject(path: string | undefined): void;
  /**
   * 把 session id 解析成侧栏显示的会话标题（本地同步查询客户端会话快照，
   * 不产生 RPC）。拿不到时返回 undefined，面板会退化成显示会话 id 尾部。
   * 使用记录里只有 sessionId——宿主侧 `SessionHeader` 没有标题字段。
   */
  sessionTitle?(sessionId: string): string | undefined;
  /**
   * 当前 session id（composer 的 api 才有）。带上后 `mcp.list` / `mcp.runtime`
   * 会多返回 `enabledInSession`，`mcp.setSessionEnabled` 也知道改哪个会话。
   */
  sessionId?: string;
}

/** 构建传输无关的面板 API（RPC 实现）。 */
export function createPanelApi(deps: AdapterDeps): CapabilityPanelApi {
  /** 调用一次宿主 RPC，并把响应归一成与旧信封同构的 RawResult。 */
  async function rpc(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RawResult> {
    const raw = await deps.rpc.call(CHANNEL, endpoint, payload, signal);
    if (raw && typeof raw === "object" && "ok" in raw) {
      const record = raw as Record<string, unknown>;
      // 宿主把业务失败包成 { ok: true, value: { ok: false, errors } }
      // （传输信封恒为 ok:true，见 remote.ts 的说明）。这里重新曝光为
      // { ok: false, errors }，让所有调用点的旧逻辑（!result.ok → 报错）
      // 保持不变。
      if (record.ok === true && record.value !== null && typeof record.value === "object") {
        const inner = record.value as Record<string, unknown>;
        if (inner.ok === false && Array.isArray(inner.errors)) {
          // 展平业务失败信封时**透传其余字段**（如 importToProject 的
          // existed 标记——丢失它会让客户端的"确认覆盖"两击交互永远走不到）。
          const { ok: _ok, errors, ...rest } = inner;
          return { ok: false, errors: errors as string[], ...rest } as RawResult;
        }
        return raw as RawResult;
      }
      // ok === false：兼容旧宿主把失败直出在传输信封上的情况。
      return {
        ok: false,
        errors: Array.isArray(record.errors)
          ? (record.errors as string[])
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
  function unwrap(result: RawResult): RawResult {
    if (result.ok && result.value !== null && typeof result.value === "object" && "ok" in (result.value as Record<string, unknown>)) {
      return result.value as RawResult;
    }
    return result;
  }

  return {
    skills: {
      /** 列表：把宿主返回的普通对象逐条投影成 ClientSkillSummary。 */
      async list() {
        const cwd = deps.currentWorkspaceCwd();
        const result = await rpc("skills.list", { cwd });
        if (!result.ok) throw new Error(result.errors.join("; "));
        const values = (result.value as unknown[]).filter((v) => v !== null && typeof v === "object") as Record<string, unknown>[];
        return values.map(toSummary);
      },

      /**
       * 会话视角列表：与 `list()` 同源，但宿主额外投影 `enabledInSession` /
       * `canToggleInSession`（需要本 api 带 sessionId——只有 composer 的每会话
       * api 有）。输入框下方的能力配置区用它。
       */
      async sessionList() {
        if (deps.sessionId === undefined) throw new Error("skills.sessionList 只能在会话作用域的 api 上调用");
        const cwd = deps.currentWorkspaceCwd();
        const result = await rpc("skills.sessionList", { cwd, sessionId: deps.sessionId });
        if (!result.ok) throw new Error(result.errors.join("; "));
        const values = (result.value as unknown[]).filter((v) => v !== null && typeof v === "object") as Record<string, unknown>[];
        return values.map(toSummary);
      },

      /** 会话级关闭 / 恢复：宿主返回业务信封，失败抛错由 UI 回滚。 */
      async setSessionEnabled(input) {
        if (deps.sessionId === undefined) throw new Error("skills.setSessionEnabled 只能在会话作用域的 api 上调用");
        const cwd = deps.currentWorkspaceCwd();
        const result = unwrap(
          await rpc("skills.setSessionEnabled", { ...input, sessionId: deps.sessionId, ...(cwd !== undefined ? { cwd } : {}) }),
        ) as { ok: true } | { ok: false; errors: string[] };
        if (!result.ok) throw new Error(result.errors.join("; "));
        return result;
      },

      /** 详情：宿主可能返回 undefined（不存在）。 */
      async read(name) {
        const cwd = deps.currentWorkspaceCwd();
        const result = await rpc("skills.read", { name, cwd });
        if (!result.ok) throw new Error(result.errors.join("; "));
        const detail = result.value as Partial<ClientSkillDetail> | undefined;
        if (detail === undefined) return undefined;
        return detail as ClientSkillDetail;
      },

      async create(input: CreateSkillInput) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(await rpc("skills.create", { ...input, cwd })) as { ok: true } | { ok: false; errors: string[] };
      },

      async update(input) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(await rpc("skills.update", { ...input, cwd })) as { ok: true } | { ok: false; errors: string[] };
      },

      async remove(input) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(await rpc("skills.remove", { ...input, cwd })) as { ok: true } | { ok: false; errors: string[] };
      },

      /** 一键启用/禁用：与服务端同名词条一致，直接返回信封。 */
      async setEnabled(input) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(await rpc("skills.setEnabled", { ...input, cwd })) as { ok: true } | { ok: false; errors: string[] };
      },

      /** 细粒度调节调用方式（模型/用户两个方向分别开关）：与服务端同名词条一致。 */
      async setInvocation(input) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(await rpc("skills.setInvocation", { ...input, cwd })) as { ok: true } | { ok: false; errors: string[] };
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
        return unwrap(await rpc("skills.importToProject", { ...input, cwd })) as
          | { ok: true; existed?: boolean; path?: string }
          | { ok: false; errors: string[] };
      },

      /** 在本项目内禁用某个全局 skill（shadow stub）：与服务端同名词条一致（existed 字段透传）。 */
      async disableInProject(input) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(await rpc("skills.disableInProject", { ...input, cwd })) as
          | { ok: true; existed?: boolean }
          | { ok: false; errors: string[] };
      },

      /** 恢复全局 skill 在本项目可用（删除 shadow stub，幂等）。 */
      async enableInProject(input) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(await rpc("skills.enableInProject", { ...input, cwd })) as { ok: true } | { ok: false; errors: string[] };
      },

      /** 导出为文件清单：解开信封后按宿主返回的形状投影。 */
      async exportFiles(input) {
        const cwd = deps.currentWorkspaceCwd();
        const result = unwrap(await rpc("skills.export", { ...input, cwd }));
        if (!result.ok) return { ok: false, errors: result.errors };
        // 解开信封后 result 即业务层 TransferResult：files/name/format 直接挂其上。
        const self = result as unknown as Record<string, unknown>;
        if (!Array.isArray(self.files)) return { ok: false, errors: ["export returned no files"] };
        return {
          ok: true,
          name: typeof self.name === "string" ? self.name : input.name,
          format: self.format === "directory" ? "directory" : "flat",
          files: self.files as { path: string; content: string }[],
        };
      },

      /** 导出到宿主目录。 */
      async exportToPath(input) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(await rpc("skills.export", { ...input, cwd })) as { ok: true } | { ok: false; errors: string[] };
      },
    },

    mcp: {
      /** 列表：宿主的合并视图直接可用，无需投影。 */
      async list(): Promise<ClientMcpList> {
        const cwd = deps.currentWorkspaceCwd();
        // sessionId 让宿主投影 enabledInSession（会话能力配置区需要）。
        const result = await rpc("mcp.list", { cwd, ...(deps.sessionId !== undefined ? { sessionId: deps.sessionId } : {}) });
        if (!result.ok) throw new Error(result.errors.join("; "));
        return result.value as ClientMcpList;
      },

      async upsert(input: McpUpsertInput) {
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
        return unwrap(await rpc("mcp.importToProject", { ...input, cwd })) as
          | { ok: true; existed?: boolean }
          | { ok: false; errors: string[] };
      },

      async status(): Promise<ClientMcpStatus[]> {
        const cwd = deps.currentWorkspaceCwd();
        const result = await rpc("mcp.status", { cwd });
        if (!result.ok) throw new Error(result.errors.join("; "));
        return result.value as ClientMcpStatus[];
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
        if (!result.ok) throw new Error(result.errors.join("; "));
        const view = (result.value ?? { entries: [], limit: 0 }) as { entries?: unknown; limit?: unknown };
        const entries = Array.isArray(view.entries) ? view.entries : [];
        return {
          limit: typeof view.limit === "number" ? view.limit : entries.length,
          entries: entries
            .map((raw) => {
              const entry = (raw ?? {}) as Record<string, unknown>;
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
            .filter((entry) => entry.serverName.length > 0 && entry.tool.length > 0) as ClientMcpUsageEntry[],
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
        if (deps.sessionId === undefined) throw new Error("mcp.setSessionEnabled 只能在会话作用域的 api 上调用");
        const cwd = deps.currentWorkspaceCwd();
        const result = await rpc("mcp.setSessionEnabled", { ...input, sessionId: deps.sessionId, ...(cwd !== undefined ? { cwd } : {}) });
        if (!result.ok) throw new Error(result.errors.join("; "));
        const value = (result.value ?? {}) as { ok?: boolean; errors?: unknown };
        if (value.ok === false) throw new Error(Array.isArray(value.errors) ? value.errors.join("; ") : "mcp.setSessionEnabled failed");
      },

      async runtime(input) {
        // cwd 用于宿主机判断"本项目是否已禁用"；sessionId 让宿主多返回 enabledInSession。
        const result = await rpc("mcp.runtime", {
          cwd: input?.cwd ?? deps.currentWorkspaceCwd(),
          ...(deps.sessionId !== undefined ? { sessionId: deps.sessionId } : {}),
        });
        if (!result.ok) throw new Error(result.errors.join("; "));
        const view = (result.value ?? { servers: [] }) as { servers?: unknown };
        const servers = Array.isArray(view.servers) ? view.servers : [];
        return {
          servers: servers
            .map((raw) => {
              const server = (raw ?? {}) as Record<string, unknown>;
              const tools = Array.isArray(server.tools) ? server.tools : [];
              return {
                serverName: typeof server.serverName === "string" ? server.serverName : "",
                ...(typeof server.source === "string" && server.source.length > 0 ? { source: server.source } : {}),
                origin: server.origin === "entry" ? ("entry" as const) : ("fiber" as const),
                ...(server.transport === "stdio" || server.transport === "http" ? { transport: server.transport } : {}),
                ...(typeof server.summary === "string" && server.summary.length > 0 ? { summary: server.summary } : {}),
                ...(server.disabledInProject === true ? { disabledInProject: true } : {}),
                restrictable: server.restrictable === true,
                ...(typeof server.enabledInSession === "boolean" ? { enabledInSession: server.enabledInSession } : {}),
                calls: typeof server.calls === "number" ? server.calls : 0,
                tools: tools
                  .map((item) => {
                    const tool = (item ?? {}) as Record<string, unknown>;
                    return {
                      name: typeof tool.name === "string" ? tool.name : "",
                      ...(typeof tool.description === "string" && tool.description.length > 0 ? { description: tool.description } : {}),
                      ...(tool.parameters !== null && typeof tool.parameters === "object" ? { parameters: tool.parameters as Record<string, unknown> } : {}),
                    };
                  })
                  .filter((tool) => tool.name.length > 0),
              };
            })
            .filter((server) => server.serverName.length > 0) as ClientMcpRuntimeServer[],
        };
      },
    },

    quickMessages: {
      /** 列表：宿主的合并视图直接可用，无需投影。 */
      async list() {
        const cwd = deps.currentWorkspaceCwd();
        const result = await rpc("quick.list", { cwd });
        if (!result.ok) throw new Error(result.errors.join("; "));
        return result.value as ClientQuickMessagesList;
      },

      async upsert(input) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(await rpc("quick.upsert", { ...input, cwd })) as { ok: true } | { ok: false; errors: string[] };
      },

      async remove(input) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(await rpc("quick.remove", { ...input, cwd })) as { ok: true } | { ok: false; errors: string[] };
      },

      async setEnabled(input) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(await rpc("quick.setEnabled", { ...input, cwd })) as { ok: true } | { ok: false; errors: string[] };
      },

      /** 导入全局快捷消息到当前项目：与服务端同名词条一致，直接返回信封（existed 字段透传）。 */
      async importToProject(input) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(await rpc("quick.importToProject", { ...input, cwd })) as
          | { ok: true; existed?: boolean }
          | { ok: false; errors: string[] };
      },
    },

    overrides: {
      /** 读取当前项目的禁用声明全量（宿主侧无工作区时返回空清单）。 */
      async get() {
        const cwd = deps.currentWorkspaceCwd();
        const result = await rpc("overrides.get", { cwd });
        if (!result.ok) throw new Error(result.errors.join("; "));
        return result.value as ClientOverrides;
      },

      /** 切换某个全局能力在本项目的禁用状态（写回后由面板重拉列表刷新标记）。 */
      async toggle(domain, key) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(await rpc("overrides.toggle", { cwd, domain, key })) as { ok: true } | { ok: false; errors: string[] };
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
function toSummary(value: Record<string, unknown>): ClientSkillSummary {
  const inv = (value.invocation ?? {}) as Record<string, unknown>;
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
  };
}

/** 把解开信封后的安装结果投影成 InstallResult（防御宿主侧数据漂移）。 */
function toInstallResult(result: RawResult): InstallResult {
  if (!result.ok) return { ok: false, errors: result.errors };
  const self = result as unknown as Record<string, unknown>;
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
function toMcpTestResult(result: RawResult): McpTestResult {
  if (!result.ok) return { ok: false, errors: result.errors };
  const self = result as unknown as Record<string, unknown>;
  const tools = (Array.isArray(self.tools) ? self.tools : [])
    .filter((tool): tool is Record<string, unknown> => tool !== null && typeof tool === "object" && !Array.isArray(tool))
    .filter((tool) => typeof tool.name === "string" && (tool.name as string).length > 0)
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
function toClientTool(tool: Record<string, unknown>): ClientMcpTool {
  const parameters = tool.parameters;
  const outputSchema = tool.outputSchema;
  return {
    name: tool.name as string,
    ...(typeof tool.description === "string" && tool.description.length > 0 ? { description: tool.description } : {}),
    ...(parameters !== null && typeof parameters === "object" && !Array.isArray(parameters) ? { parameters: parameters as Record<string, unknown> } : {}),
    ...(outputSchema !== undefined ? { outputSchema } : {}),
  };
}