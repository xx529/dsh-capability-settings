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
import type {
  CapabilityPanelApi,
  ClientPromptFile,
  ClientPromptList,
  ClientPromptManifest,
  ClientPromptRead,
  ClientPromptScope,
  ClientPromptState,
  ClientMcpList,
  ClientMcpStatus,
  ClientMcpTool,
  ClientAttributionInfo,
  ClientMcpRuntimeServer,
  ClientMcpUsageEntry,
  ClientGlobalOverrides,
  ClientOverrides,
  ClientSetVisibilityResult,
  ClientSkillDetail,
  ClientSkillSummary,
  ClientToolInspectTool,
  ClientToolsInspect,
  ClientToolsList,
  ClientToolsUnit,
  ClientVisibilityFields,
  ClientVisibilitySets,
  ClientWorkspaceVisibility,
  ClientVisibilityMode,
  CreateSkillInput,
  DeriveGetResult,
  DerivedInfo,
  DeriveMode,
  InstallResult,
  JevApplyResult,
  JevConfigIssue,
  JevConfigView,
  JevRankResult,
  JevSetConfigResult,
  JevTestResult,
  McpTestResult,
  McpUpsertInput,
  SessionBulkFailure,
  SessionBulkInput,
  SessionBulkResult,
  SessionBulkSuccess,
  SkillResourceErrorCode,
  SkillResourceResult,
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
        // v21：宿主 RPC value 改为 `{skills, hiddenCount}`；这里只回数组（旧契约）。
        return toSkillList(result.value).skills;
      },

      /**
       * v21：列表 + 工作区视图的 hiddenCount（RPC value 为
       * `{skills, hiddenCount}`；兼容旧宿主的纯数组响应）。
       */
      async listView() {
        const cwd = deps.currentWorkspaceCwd();
        const result = await rpc("skills.list", { cwd });
        if (!result.ok) throw new Error(result.errors.join("; "));
        return toSkillList(result.value);
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
        return toSkillList(result.value).skills;
      },

      /**
       * v21：会话视角列表 + hiddenCount（RPC value 为 `{skills, hiddenCount}`；
       * 兼容旧宿主的纯数组响应）。首屏「不可见 N 项已隐藏」用它。
       */
      async sessionListView() {
        if (deps.sessionId === undefined) throw new Error("skills.sessionList 只能在会话作用域的 api 上调用");
        const cwd = deps.currentWorkspaceCwd();
        const result = await rpc("skills.sessionList", { cwd, sessionId: deps.sessionId });
        if (!result.ok) throw new Error(result.errors.join("; "));
        return toSkillList(result.value);
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

      /** 详情：宿主可能返回 undefined（不存在）；注入行走 registry fallback。 */
      async read(name, ref) {
        const cwd = deps.currentWorkspaceCwd();
        // `ref` 带 root（磁盘行）/ scope（兜底）——旧实现只传 name，导致项目技能
        // 详情恒 not found（架构契约 §8.5）；注入行则由宿主回落到 registry。
        const result = unwrap(
          await rpc("skills.read", {
            name,
            cwd,
            ...(ref ?? {}),
            ...(deps.sessionId !== undefined ? { sessionId: deps.sessionId } : {}),
          }),
        );
        // 业务失败（磁盘 not found / registry 命中但 get 失败）按「无详情」处理，
        // 内容区显示空态而不是把错误对象当详情渲染。
        if (!result.ok) return undefined;
        return toSkillDetail(result, name);
      },

      /**
       * 注入技能的单个资源文件读取：业务失败（escape / not-text / too-large …）
       * 原样返回 `{ok:false, errors, code}`，由内容区就地展示；传输层失败才抛。
       */
      async readResource(input) {
        const cwd = deps.currentWorkspaceCwd();
        const result = unwrap(
          await rpc("skills.readResource", {
            ...input,
            cwd,
            ...(deps.sessionId !== undefined ? { sessionId: deps.sessionId } : {}),
          }),
        );
        if (!result.ok) {
          const code = (result as unknown as Record<string, unknown>).code;
          return {
            ok: false as const,
            errors: result.errors,
            ...(typeof code === "string" && code.length > 0 ? { code: code as SkillResourceErrorCode } : {}),
          };
        }
        // 关键：`unwrap` 已把 `{ok:true,value:{ok:true,path,…}}` 展平成业务对象
        // `{ok:true,path,…}` 本身（见上方 unwrap 定义），这里不能再读
        // `result.value`——那会恒为 undefined，把成功响应误判成「非法结果」
        // （安全审计 task-6 发现 1）。仍兼容外层多包一层 `value` 的防御性形状。
        const raw = result as unknown as Record<string, unknown>;
        const value = (
          typeof raw.path === "string"
            ? raw
            : raw.value !== null && typeof raw.value === "object"
              ? (raw.value as Record<string, unknown>)
              : raw
        ) as Record<string, unknown>;
        if (typeof value.path !== "string" || typeof value.content !== "string") {
          return { ok: false as const, errors: ["资源读取返回了非法结果"] };
        }
        return {
          ok: true as const,
          path: value.path,
          size: typeof value.size === "number" && Number.isFinite(value.size) ? value.size : value.content.length,
          content: value.content,
          truncated: value.truncated === true,
        };
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
          ...(self.lossy === true ? { lossy: true } : {}),
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
       * 运行时注入的 MCP（**配置只读**，默认开关可写）：宿主的
       * `{servers:[{serverName,tools,calls}]}` 直接投影成客户端类型；脏数据丢弃。
       * v13 R4 额外透传 channel / attribution / synthesized，并把
       * `origin:"namespace"`（工具命名空间合成行）原样保留；v20.2 再透传
       * `disabledGlobally`（全局默认关闭）与语义扩展后的 `disabledInProject`
       * （本工作区有效默认关闭）。
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
        const view = (result.value ?? { servers: [] }) as { servers?: unknown; attributionSettling?: unknown; hiddenCount?: unknown };
        const servers = Array.isArray(view.servers) ? view.servers : [];
        return {
          ...(view.attributionSettling === true ? { attributionSettling: true } : {}),
          // v21：工作区视图里被可见性隐藏的外部实例数（供「另有 N 个未开放」提示）。
          ...(typeof view.hiddenCount === "number" && Number.isFinite(view.hiddenCount) ? { hiddenCount: view.hiddenCount } : {}),
          servers: servers
            .map((raw) => {
              const server = (raw ?? {}) as Record<string, unknown>;
              const tools = Array.isArray(server.tools) ? server.tools : [];
              return {
                serverName: typeof server.serverName === "string" ? server.serverName : "",
                ...toVisibilityFields(server),
                ...(typeof server.source === "string" && server.source.length > 0 ? { source: server.source } : {}),
                origin:
                  server.origin === "entry"
                    ? ("entry" as const)
                    : server.origin === "namespace"
                      ? ("namespace" as const)
                      : ("fiber" as const),
                ...(typeof server.channel === "string" && server.channel.length > 0 ? { channel: server.channel } : {}),
                ...(toAttribution(server.attribution) !== undefined ? { attribution: toAttribution(server.attribution) } : {}),
                ...(server.synthesized === true ? { synthesized: true } : {}),
                ...(server.transport === "stdio" || server.transport === "http" ? { transport: server.transport } : {}),
                ...(typeof server.summary === "string" && server.summary.length > 0 ? { summary: server.summary } : {}),
                ...(server.disabledInProject === true ? { disabledInProject: true } : {}),
                // v20.2：全局默认关闭（本工作区未重新打开）；旧宿主缺省。
                ...(server.disabledGlobally === true ? { disabledGlobally: true } : {}),
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

    tools: {
      /**
       * 列出插件单元（v13）。宿主把「服务缺失 / schemas() 失败」包成空 units +
       * errors（不阻断其它域）；适配器原样投影，界面据此显示空态说明。
       */
      async list(input): Promise<ClientToolsList> {
        const sessionId = input?.sessionId ?? deps.sessionId;
        // v21：cwd 让宿主做工作区可见性/每工作区默认投影（全局视图 cwd 缺省）。
        const cwd = input?.cwd ?? deps.currentWorkspaceCwd();
        const result = await rpc("tools.list", {
          ...(cwd !== undefined ? { cwd } : {}),
          ...(sessionId !== undefined ? { sessionId } : {}),
        });
        if (!result.ok) {
          return { units: [], totalGlobalTools: 0, excludedBuiltinCount: 0, errors: result.errors };
        }
        return toToolsList(result.value);
      },

      /**
       * 按需读取工具定义（含 parameters）：只在详情选中单元时调用，按 unit 缓存。
       * 业务失败抛错，UI 降级为「仅名称 + 说明」并提示参数不可用。
       */
      async inspect(input): Promise<ClientToolsInspect> {
        const sessionId = input.sessionId ?? deps.sessionId;
        const result = await rpc("tools.inspect", {
          unit: input.unit,
          ...(sessionId !== undefined ? { sessionId } : {}),
        });
        // 业务失败必须抛错（否则会被 toToolsInspect 投影成空清单、静默降级成
        // 「无参数」，掩盖 unit 失效 / 服务缺失）。`rpc()` 已把外层的
        // `{ok:true,value:{ok:false,errors}}` 展平成 `{ok:false,errors}`；这里
        // 再防御一次 value 自身带 `ok:false` 的旧/异常形状。
        if (!result.ok) throw new Error(result.errors.join("; "));
        const value = result.value;
        if (value !== null && typeof value === "object" && (value as Record<string, unknown>).ok === false) {
          const errors = (value as Record<string, unknown>).errors;
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
        const result = unwrap(await rpc("tools.setGlobalEnabled", { units: input.units, enabled: input.enabled })) as
          | { ok: true; applied?: unknown }
          | { ok: false; errors: string[] };
        if (!result.ok) throw new Error(result.errors.join("; "));
        return { ok: true as const, applied: typeof result.applied === "number" ? result.applied : input.units.length };
      },

      /** 按会话开关插件（batch-first）；业务失败抛错（与 skills/mcp 单条一致）。 */
      async setSessionEnabled(input) {
        const sessionId = input.sessionId ?? deps.sessionId;
        if (sessionId === undefined) throw new Error("tools.setSessionEnabled 需要当前会话");
        const result = unwrap(
          await rpc("tools.setSessionEnabled", { sessionId, units: input.units, enabled: input.enabled }),
        ) as { ok: true; applied?: unknown } | { ok: false; errors: string[] };
        if (!result.ok) throw new Error(result.errors.join("; "));
        return { ok: true as const, applied: typeof result.applied === "number" ? result.applied : input.units.length };
      },
    },

    prompt: {
      /**
       * 列表：全局 + 项目候选（只含已存在文件）、策略默认、会话显式选择、冻结清单。
       * 服务缺失 / 降级错误收在 `errors` 里，不抛（与 tools.list 同口径）。
       */
      async list(input): Promise<ClientPromptList> {
        const cwd = input?.cwd ?? deps.currentWorkspaceCwd();
        const sessionId = input?.sessionId ?? deps.sessionId;
        const result = await rpc("prompt.list", {
          ...(cwd !== undefined ? { cwd } : {}),
          ...(sessionId !== undefined ? { sessionId } : {}),
        });
        if (!result.ok) {
          return {
            files: [],
            cwd: cwd ?? "",
            projectRoot: cwd ?? "",
            budget: { maxBytes: 65536, maxSourceBytes: 1048576 },
            engineAvailable: false,
            visibility: {},
            errors: result.errors,
          };
        }
        return toPromptList(result.value);
      },

      /** 读取正文：业务失败抛错（含 too-large / unknown-file 的文案）。 */
      async read(input): Promise<ClientPromptRead> {
        const result = await rpc("prompt.read", { path: input.path });
        if (!result.ok) throw new Error(result.errors.join("; "));
        const value = result.value as Record<string, unknown> | undefined;
        if (value !== undefined && value !== null && value.ok === false) {
          const errors = Array.isArray(value.errors) ? value.errors.map(String) : ["读取失败"];
          throw new Error(errors.join("; "));
        }
        if (value === undefined || value === null || typeof value.content !== "string") {
          throw new Error("prompt.read 返回为空");
        }
        const projected: ClientPromptRead = {
          ok: true,
          id: typeof value.id === "string" ? value.id : input.path,
          path: typeof value.path === "string" ? value.path : input.path,
          size: typeof value.size === "number" ? value.size : value.content.length,
          content: value.content,
          truncated: value.truncated === true,
        };
        return projected;
      },

      /** 保存正文：业务失败抛错（原子写由宿主完成）。 */
      async save(input): Promise<void> {
        const result = await rpc("prompt.save", { path: input.path, content: input.content });
        if (!result.ok) throw new Error(result.errors.join("; "));
        const value = result.value as Record<string, unknown> | undefined;
        if (value !== undefined && value !== null && value.ok === false) {
          const errors = Array.isArray(value.errors) ? value.errors.map(String) : ["保存失败"];
          throw new Error(errors.join("; "));
        }
      },

      async setVisibility(input): Promise<void> {
        const result = await rpc("prompt.setVisibility", {
          scope: input.scope,
          mode: input.mode,
          ...(input.workspaces !== undefined ? { workspaces: input.workspaces } : {}),
        });
        if (!result.ok) throw new Error(result.errors.join("; "));
        const value = result.value as Record<string, unknown> | undefined;
        if (value !== undefined && value !== null && value.ok === false) {
          const errors = Array.isArray(value.errors) ? value.errors.map(String) : ["保存失败"];
          throw new Error(errors.join("; "));
        }
      },

      async setProjectDefault(input): Promise<void> {
        const result = await rpc("prompt.setProjectDefault", {
          ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
          ...(input.projectRoot !== undefined ? { projectRoot: input.projectRoot } : {}),
          path: input.path,
          enabled: input.enabled,
        });
        if (!result.ok) throw new Error(result.errors.join("; "));
        const value = result.value as Record<string, unknown> | undefined;
        if (value !== undefined && value !== null && value.ok === false) {
          const errors = Array.isArray(value.errors) ? value.errors.map(String) : ["保存失败"];
          throw new Error(errors.join("; "));
        }
      },

      async setSessionSelection(input): Promise<void> {
        const sessionId = input.sessionId ?? deps.sessionId;
        if (sessionId === undefined || sessionId.length === 0) throw new Error("缺少 sessionId");
        const result = await rpc("prompt.setSessionSelection", {
          sessionId,
          selected: input.selected,
          ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        });
        if (!result.ok) throw new Error(result.errors.join("; "));
        const value = result.value as Record<string, unknown> | undefined;
        if (value !== undefined && value !== null && value.ok === false) {
          const errors = Array.isArray(value.errors) ? value.errors.map(String) : ["保存失败"];
          throw new Error(errors.join("; "));
        }
      },

      async manifest(input): Promise<ClientPromptManifest | undefined> {
        const result = await rpc("prompt.manifest", { sessionId: input.sessionId });
        if (!result.ok) return undefined;
        const value = result.value as Record<string, unknown> | undefined;
        if (value === undefined || value === null) return undefined;
        if (value.manifest === undefined) return undefined;
        return toPromptManifest(value.manifest);
      },
    },

    session: {
      /**
       * 批量开/关/恢复默认（v13 R1）。`failed[]` 属成功 value，不抛错；
       * 业务失败（缺 sessionId / 非法 action / 未知域）原样返回 `{ok:false,errors}`。
       */
      async setBulk(input: SessionBulkInput): Promise<SessionBulkResult> {
        const sessionId = input.sessionId ?? deps.sessionId;
        const payload = { ...input, ...(sessionId !== undefined ? { sessionId } : {}) };
        const result = await rpc("session.setBulk", payload);
        if (!result.ok) return { ok: false, errors: result.errors };
        return toSessionBulkResult(unwrap(result));
      },
    },

    derive: {
      /** 读取当前会话的派生模式 + 自身作为派生会话时的创建快照。 */
      async get(): Promise<DeriveGetResult> {
        if (deps.sessionId === undefined) throw new Error("session.deriveGet 只能在会话作用域的 api 上调用");
        const result = await rpc("session.deriveGet", { sessionId: deps.sessionId });
        if (!result.ok) throw new Error(result.errors.join("; "));
        const raw = unwrap(result) as Record<string, unknown>;
        const toMode = (value: unknown): DeriveMode =>
          value === "workspace" ? "workspace" : value === "dynamic" ? "dynamic" : "session";
        const toDynamic = (value: unknown): DerivedInfo["dynamic"] => {
          if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
          const source = value as Record<string, unknown>;
          if (source.status !== "ok" && source.status !== "fallback") return undefined;
          if (typeof source.threshold !== "number" || !Number.isFinite(source.threshold)) return undefined;
          if (source.threshold < 0 || source.threshold > 1) return undefined;
          const countsRaw =
            source.counts !== null && typeof source.counts === "object" && !Array.isArray(source.counts)
              ? (source.counts as Record<string, unknown>)
              : {};
          const countOf = (key: string): number => {
            const count = countsRaw[key];
            return typeof count === "number" && Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
          };
          const selected = typeof source.selected === "number" && Number.isFinite(source.selected) ? Math.trunc(source.selected) : 0;
          const total = typeof source.total === "number" && Number.isFinite(source.total) ? Math.trunc(source.total) : 0;
          return {
            status: source.status,
            ...(typeof source.reason === "string" && source.reason.length > 0 ? { reason: source.reason } : {}),
            threshold: source.threshold,
            selected: selected >= 0 ? selected : 0,
            total: total >= 0 ? total : 0,
            counts: { skills: countOf("skills"), mcp: countOf("mcp"), tools: countOf("tools") },
            ...(source.fallback === "session" || source.fallback === "workspace" ? { fallback: source.fallback } : {}),
            at: typeof source.at === "number" && Number.isFinite(source.at) ? source.at : 0,
          };
        };
        const mode: DeriveMode = toMode(raw.mode);
        const derivedRaw =
          raw.derived !== null && typeof raw.derived === "object" ? (raw.derived as Record<string, unknown>) : undefined;
        const derived =
          derivedRaw === undefined
            ? undefined
            : {
                mode: toMode(derivedRaw.mode),
                ...(typeof derivedRaw.from === "string" && derivedRaw.from.length > 0 ? { from: derivedRaw.from } : {}),
                ...(typeof derivedRaw.at === "number" && Number.isFinite(derivedRaw.at) ? { at: derivedRaw.at } : {}),
                ...(toDynamic(derivedRaw.dynamic) !== undefined ? { dynamic: toDynamic(derivedRaw.dynamic) } : {}),
              };
        return { mode, ...(derived !== undefined ? { derived } : {}) };
      },

      /** 设置当前会话之后创建 child 时的继承模式；业务失败返回 errors。 */
      async set(mode: DeriveMode) {
        if (deps.sessionId === undefined) throw new Error("session.deriveSet 只能在会话作用域的 api 上调用");
        const result = await rpc("session.deriveSet", { sessionId: deps.sessionId, mode });
        if (!result.ok) return { ok: false as const, errors: result.errors };
        const raw = unwrap(result) as Record<string, unknown>;
        if (raw.ok === false) return { ok: false as const, errors: Array.isArray(raw.errors) ? (raw.errors as string[]) : [] };
        return { ok: true as const };
      },
    },

    overrides: {
      /** 读取当前项目的禁用声明全量（宿主侧无工作区时返回空清单）。 */
      async get() {
        const cwd = deps.currentWorkspaceCwd();
        const result = await rpc("overrides.get", { cwd });
        if (!result.ok) throw new Error(result.errors.join("; "));
        const view = (result.value ?? {}) as Record<string, unknown>;
        const listOf = (value: unknown): string[] =>
          Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
        return {
          mcp: listOf(view.mcp),
          // skills 域是宿主 additive 字段：旧宿主缺失时按空清单（旧行为不变）。
          skills: listOf(view.skills),
          // v20.1（B2）additive：本项目显式重新打开的名单；旧宿主缺失视为空。
          ...(Array.isArray(view.enabledSkills) ? { enabledSkills: listOf(view.enabledSkills) } : {}),
          // v20.2 additive：MCP 的「本工作区重新打开」名单。
          ...(Array.isArray(view.enabledMcp) ? { enabledMcp: listOf(view.enabledMcp) } : {}),
          // v21 additive：Tools 域的项目覆盖（关闭 / 重新打开）；旧宿主缺失视为空。
          ...(Array.isArray(view.tools) ? { tools: listOf(view.tools) } : {}),
          ...(Array.isArray(view.enabledTools) ? { enabledTools: listOf(view.enabledTools) } : {}),
          ...(typeof view.filePath === "string" ? { filePath: view.filePath } : {}),
          ...(typeof view.projectRoot === "string" ? { projectRoot: view.projectRoot } : {}),
        } satisfies ClientOverrides;
      },

      /**
       * 切换某个全局能力在本项目的禁用状态（写回后由面板重拉列表刷新标记）。
       *
       * v20.2：`domain: "mcp"` 走 B2 三态（`mcp` / `enabledMcp`），面板显式传
       * `options.enabled`；不传时沿用宿主的旧翻转语义（翻转有效默认）。
       */
      async toggle(domain, key, options) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(
          await rpc("overrides.toggle", {
            cwd,
            domain,
            key,
            ...(options?.enabled !== undefined ? { enabled: options.enabled } : {}),
          }),
        ) as { ok: true } | { ok: false; errors: string[] };
      },

      /**
       * v20.1（B2）：显式设置 skill 在本项目的默认启用/禁用（不是翻转）。
       * 复用 `overrides.toggle` 的新增可选参数 `enabled`（与 backend 对齐；
       * 不传 `enabled` 时保持旧的翻转语义）。写盘成功后宿主对同项目 live
       * 会话 reconcile，UI 重拉 skills.list 即可。
       */
      async setSkillDefault(input) {
        const cwd = deps.currentWorkspaceCwd();
        return unwrap(
          await rpc("overrides.toggle", { cwd, domain: "skills", key: input.key, enabled: input.enabled }),
        ) as { ok: true } | { ok: false; errors: string[] };
      },

      /** v20.1（B2）/ v21：读取全局默认关闭层 + 三域可见性（损坏时降级空 + errors）。 */
      async globalGet() {
        const result = await rpc("overrides.globalGet", {});
        if (!result.ok) throw new Error(result.errors.join("; "));
        const view = (result.value ?? {}) as Record<string, unknown>;
        const errors = Array.isArray(view.errors)
          ? view.errors.filter((item): item is string => typeof item === "string")
          : [];
        const listOf = (value: unknown): string[] =>
          Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
        return {
          skills: listOf(view.skills),
          // v20.2 additive：全局默认关闭的 MCP serverName；旧宿主缺失视为空清单。
          mcp: listOf(view.mcp),
          // v21 additive：Tools 全局默认兜底名单；旧宿主缺失视为空清单。
          tools: listOf(view.tools),
          // v21 additive：三域可见性；旧宿主 / v1 文件缺省 ⇒ 三域空 map（全部可见）。
          visibility: toVisibilitySets(view.visibility),
          ...(typeof view.filePath === "string" ? { filePath: view.filePath } : {}),
          ...(errors.length > 0 ? { errors } : {}),
        } satisfies ClientGlobalOverrides;
      },

      /**
       * v20.1（B2）/ v20.2：切换全局默认开关（写 capability-global-overrides.json）。
       * `domain` 与 `key` / `disabled` 原样透传；只写配置，已有会话不受影响。
       */
      async globalToggle(input) {
        return unwrap(await rpc("overrides.globalToggle", input)) as { ok: true } | { ok: false; errors: string[] };
      },

      /**
       * v21：保存某个能力的可见性 + 每工作区默认开/关（写全局文件 v2）。
       * `workspaces` 为完整映射原样透传；业务失败返回 `{ok:false,errors}`（不抛）。
       */
      async setVisibility(input) {
        // 业务失败可能带 code / conflicts（v21.1 冲突决策）：rpc 展平业务信封时
        // 会透传其余字段，这里原样返回给弹层做二级确认。
        return unwrap(await rpc("overrides.setVisibility", input)) as ClientSetVisibilityResult;
      },
    },

    jev: {
      /**
       * 读取全局配置视图：宿主只回掩码 / 来源，**永不含明文**（架构 §4.2）。
       * 传输层失败（通道不可用 / 宿主未装配 jev 服务）抛错，配置页进入
       * load-error 态并给「重试」。
       */
      async getConfig(): Promise<JevConfigView> {
        const result = await rpc("jev.getConfig", {});
        if (!result.ok) throw new Error(result.errors.join("; "));
        return toJevConfigView(result.value);
      },

      /**
       * 保存全局配置：**业务失败原样返回**（`invalid-config` / `write-failed`
       * + errors + 可选 issues），不抛错——配置页需要按 code 分类并把
       * issues 落到字段行内。只有传输层失败才抛。
       */
      async setConfig(input): Promise<JevSetConfigResult> {
        const result = await rpc("jev.setConfig", { config: input.config });
        const failure = toJevFailure(result);
        if (failure !== undefined) return failure as JevSetConfigResult;
        if (!result.ok) throw new Error(result.errors.join("; "));
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
      async test(input): Promise<JevTestResult> {
        const payload: unknown = input?.config !== undefined ? input.config : {};
        const result = await rpc("jev.test", payload);
        const failure = toJevFailure(result);
        if (failure !== undefined) return failure as JevTestResult;
        if (!result.ok) throw new Error(result.errors.join("; "));
        const value = unwrap(result) as unknown as Record<string, unknown>;
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
      async rank(input, signal): Promise<JevRankResult> {
        if (deps.sessionId === undefined) throw new Error("jev.rank requires a session context");
        const cwd = input.cwd ?? deps.currentWorkspaceCwd();
        const result = await rpc(
          "jev.rank",
          { sessionId: deps.sessionId, draft: input.draft, ...(cwd !== undefined ? { cwd } : {}) },
          signal,
        );
        const failure = toJevFailure(result);
        if (failure !== undefined) return failure as JevRankResult;
        if (!result.ok) throw new Error(result.errors.join("; "));
        return unwrap(result) as unknown as JevRankResult;
      },

      /** 应用：同上，业务失败原样返回（bad-request / write-failed）。 */
      async apply(input): Promise<JevApplyResult> {
        if (deps.sessionId === undefined) throw new Error("jev.apply requires a session context");
        const cwd = input.cwd ?? deps.currentWorkspaceCwd();
        const result = await rpc("jev.apply", {
          sessionId: deps.sessionId,
          plan: input.plan,
          ...(cwd !== undefined ? { cwd } : {}),
        });
        const failure = toJevFailure(result);
        if (failure !== undefined) return failure as JevApplyResult;
        if (!result.ok) throw new Error(result.errors.join("; "));
        return unwrap(result) as unknown as JevApplyResult;
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
/** 投影全局 prompt 的完整可见性映射（坏值丢弃，不抛）。 */
function toPromptVisibilityMap(
  value: unknown,
): Record<string, { mode: ClientVisibilityMode; workspaces: Record<string, ClientWorkspaceVisibility> }> {
  const out: Record<string, { mode: ClientVisibilityMode; workspaces: Record<string, ClientWorkspaceVisibility> }> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [scope, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const workspaces: Record<string, ClientWorkspaceVisibility> = {};
    if (raw.workspaces !== null && typeof raw.workspaces === "object" && !Array.isArray(raw.workspaces)) {
      for (const [root, ws] of Object.entries(raw.workspaces as Record<string, unknown>)) {
        if (ws === null || typeof ws !== "object") continue;
        const item = ws as Record<string, unknown>;
        workspaces[root] = {
          ...(typeof item.visible === "boolean" ? { visible: item.visible } : {}),
          ...(typeof item.defaultEnabled === "boolean" ? { defaultEnabled: item.defaultEnabled } : {}),
        };
      }
    }
    const mode: ClientVisibilityMode = raw.mode === "selected" || raw.mode === "none" ? raw.mode : "all";
    out[scope] = { mode, workspaces };
  }
  return out;
}

/** 把宿主 `prompt.list` 返回值投影成客户端类型（字段级容错）。 */
function toPromptList(value: unknown): ClientPromptList {
  const raw = (value ?? {}) as Record<string, unknown>;
  const files = (Array.isArray(raw.files) ? raw.files : [])
    .map((item) => toPromptFile(item))
    .filter((item): item is ClientPromptFile => item !== undefined);
  const rawBudget = (raw.budget ?? {}) as Record<string, unknown>;
  const frozen = raw.frozen === undefined ? undefined : toPromptManifest(raw.frozen);
  return {
    files,
    cwd: typeof raw.cwd === "string" ? raw.cwd : "",
    projectRoot: typeof raw.projectRoot === "string" ? raw.projectRoot : "",
    ...(typeof raw.sessionId === "string" ? { sessionId: raw.sessionId } : {}),
    ...(Array.isArray(raw.sessionSelected)
      ? { sessionSelected: raw.sessionSelected.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(frozen !== undefined ? { frozen } : {}),
    budget: {
      maxBytes: typeof rawBudget.maxBytes === "number" ? rawBudget.maxBytes : 65536,
      maxSourceBytes: typeof rawBudget.maxSourceBytes === "number" ? rawBudget.maxSourceBytes : 1048576,
    },
    engineAvailable: raw.engineAvailable !== false,
    visibility: toPromptVisibilityMap(raw.visibility),
    errors: Array.isArray(raw.errors) ? raw.errors.map(String) : [],
  };
}

/** 单条 prompt 文件投影。 */
function toPromptFile(value: unknown): ClientPromptFile | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.path !== "string") return undefined;
  const scope: ClientPromptScope =
    raw.scope === "user-global" || raw.scope === "agents-global" ? raw.scope : "project";
  const states: ClientPromptState[] = [
    "injected",
    "truncated",
    "omitted",
    "disabled",
    "invisible",
    "duplicate",
    "too-large",
    "unreadable",
  ];
  const state = states.includes(raw.state as ClientPromptState) ? (raw.state as ClientPromptState) : "injected";
  const visibility = (raw.visibility ?? undefined) as Record<string, unknown> | undefined;
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : raw.path.split("/").pop() ?? raw.path,
    path: raw.path,
    displayPath: typeof raw.displayPath === "string" ? raw.displayPath : raw.path,
    scope,
    kind: raw.kind === "local" ? "local" : "base",
    directory: typeof raw.directory === "string" ? raw.directory : "",
    size: typeof raw.size === "number" ? raw.size : 0,
    mtimeMs: typeof raw.mtimeMs === "number" ? raw.mtimeMs : 0,
    enabled: raw.enabled === true,
    defaultEnabled: raw.defaultEnabled !== false,
    ...(typeof raw.projectDefault === "boolean" ? { projectDefault: raw.projectDefault } : {}),
    ...(typeof raw.sessionExplicit === "boolean" ? { sessionExplicit: raw.sessionExplicit } : {}),
    ...(visibility !== undefined && typeof visibility.mode === "string"
      ? {
          visibility: {
            mode: visibility.mode as ClientVisibilityMode,
            visible: visibility.visible === true,
            defaultEnabled: visibility.defaultEnabled !== false,
          },
        }
      : {}),
    state,
    ...(typeof raw.duplicateOf === "string" ? { duplicateOf: raw.duplicateOf } : {}),
    ...(typeof raw.order === "number" ? { order: raw.order } : {}),
  };
}

/** 会话冻结清单投影。 */
function toPromptManifest(value: unknown): ClientPromptManifest | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.sessionId !== "string" || typeof raw.at !== "number") return undefined;
  const files = (Array.isArray(raw.files) ? raw.files : [])
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item, index) => ({
      id: typeof item.id === "string" ? item.id : "",
      path: typeof item.path === "string" ? item.path : "",
      displayPath: typeof item.displayPath === "string" ? item.displayPath : "",
      scope: (item.scope === "user-global" || item.scope === "agents-global" ? item.scope : "project") as ClientPromptScope,
      order: typeof item.order === "number" ? item.order : index + 1,
      bytes: typeof item.bytes === "number" ? item.bytes : 0,
      digest: typeof item.digest === "string" ? item.digest : "",
    }));
  return {
    sessionId: raw.sessionId,
    cwd: typeof raw.cwd === "string" ? raw.cwd : "",
    at: raw.at,
    renderer: "host",
    files,
    omitted: Array.isArray(raw.omitted)
      ? raw.omitted
          .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
          .map((item) => ({ displayPath: typeof item.displayPath === "string" ? item.displayPath : "" }))
      : [],
    truncated: Array.isArray(raw.truncated)
      ? raw.truncated
          .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
          .map((item) => ({
            displayPath: typeof item.displayPath === "string" ? item.displayPath : "",
            originalBytes: typeof item.originalBytes === "number" ? item.originalBytes : 0,
            includedBytes: typeof item.includedBytes === "number" ? item.includedBytes : 0,
          }))
      : [],
    ...(typeof raw.text === "string" ? { text: raw.text } : {}),
  };
}

function toToolsList(value: unknown): ClientToolsList {
  const raw = (value ?? {}) as Record<string, unknown>;
  const units = (Array.isArray(raw.units) ? raw.units : [])
    .map((item) => {
      const unit = (item ?? {}) as Record<string, unknown>;
      if (typeof unit.unit !== "string" || unit.unit.length === 0) return undefined;
      const tools = (Array.isArray(unit.tools) ? unit.tools : [])
        .map((tool) => {
          const brief = (tool ?? {}) as Record<string, unknown>;
          if (typeof brief.name !== "string" || brief.name.length === 0) return undefined;
          return {
            name: brief.name,
            ...(typeof brief.description === "string" && brief.description.length > 0 ? { description: brief.description } : {}),
          };
        })
        .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined);
      const attribution = toAttribution(unit.attribution) ?? { matchedBy: "unknown" as const };
      // v13 两层语义：`defaultEnabled` = 全局默认，`enabled` = 本会话生效值。
      // 旧宿主只有 `enabledInSession`（单层）→ 两个都回落到它；再缺省按默认开启。
      const legacyEnabled = typeof unit.enabledInSession === "boolean" ? unit.enabledInSession : undefined;
      const defaultEnabled =
        typeof unit.defaultEnabled === "boolean" ? unit.defaultEnabled : (legacyEnabled ?? true);
      const enabled = typeof unit.enabled === "boolean" ? unit.enabled : (legacyEnabled ?? defaultEnabled);
      const restriction = (unit.restriction ?? {}) as Record<string, unknown>;
      const restrictionState =
        restriction.state === "applied" || restriction.state === "skipped" || restriction.state === "failed"
          ? restriction.state
          : undefined;
      const projected: ClientToolsUnit = {
        unit: unit.unit,
        ...toVisibilityFields(unit),
        name: typeof unit.name === "string" && unit.name.length > 0 ? unit.name : unit.unit,
        kind: unit.kind === "unattributed" ? "unattributed" : "plugin",
        tools,
        toolCount:
          typeof unit.toolCount === "number" && Number.isFinite(unit.toolCount) ? unit.toolCount : tools.length,
        attribution,
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
    .filter((unit): unit is ClientToolsUnit => unit !== undefined);
  return {
    units,
    totalGlobalTools: typeof raw.totalGlobalTools === "number" ? raw.totalGlobalTools : 0,
    excludedBuiltinCount: typeof raw.excludedBuiltinCount === "number" ? raw.excludedBuiltinCount : 0,
    errors: Array.isArray(raw.errors) ? raw.errors.filter((item): item is string => typeof item === "string") : [],
    // v21：工作区视图里被可见性隐藏的单元数。
    ...(typeof raw.hiddenCount === "number" && Number.isFinite(raw.hiddenCount) ? { hiddenCount: raw.hiddenCount } : {}),
    ...(typeof raw.sessionId === "string" && raw.sessionId.length > 0 ? { sessionId: raw.sessionId } : {}),
    ...(raw.attributionSettling === true ? { attributionSettling: true } : {}),
  };
}

/** `tools.inspect` 的防御性投影（兼容 `{unit,tools}` / `{ok:true,unit,tools}` 两种外壳）。 */
function toToolsInspect(value: unknown): ClientToolsInspect {
  const raw = (value ?? {}) as Record<string, unknown>;
  const inner = raw.value !== null && typeof raw.value === "object" ? (raw.value as Record<string, unknown>) : raw;
  const unit = typeof inner.unit === "string" ? inner.unit : typeof raw.unit === "string" ? raw.unit : "";
  const tools = (Array.isArray(inner.tools) ? inner.tools : [])
    .map((item) => {
      const tool = (item ?? {}) as Record<string, unknown>;
      if (typeof tool.name !== "string" || tool.name.length === 0) return undefined;
      const projected: ClientToolInspectTool = {
        name: tool.name,
        ...(typeof tool.description === "string" && tool.description.length > 0 ? { description: tool.description } : {}),
        ...(tool.parameters !== null && typeof tool.parameters === "object" && !Array.isArray(tool.parameters)
          ? { parameters: tool.parameters as Record<string, unknown> }
          : {}),
      };
      return projected;
    })
    .filter((tool): tool is ClientToolInspectTool => tool !== undefined);
  return { unit, tools };
}

/** `session.setBulk` 成功 value 的防御性投影（缺字段补 0 / 空表）。 */
function toSessionBulkResult(value: unknown): SessionBulkSuccess {
  const raw = (value ?? {}) as Record<string, unknown>;
  const countOf = (input: unknown): { changed: number; unchanged: number; skipped: number; failed: number } => {
    const item = (input ?? {}) as Record<string, unknown>;
    const num = (candidate: unknown): number =>
      typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
    return { changed: num(item.changed), unchanged: num(item.unchanged), skipped: num(item.skipped), failed: num(item.failed) };
  };
  const byDomain = (raw.byDomain ?? {}) as Record<string, unknown>;
  const failed = (Array.isArray(raw.failed) ? raw.failed : [])
    .map((item) => {
      const entry = (item ?? {}) as Record<string, unknown>;
      if (typeof entry.domain !== "string" || typeof entry.target !== "string") return undefined;
      const kind =
        entry.kind === "skill" || entry.kind === "mcp-project" || entry.kind === "mcp-server" || entry.kind === "plugin"
          ? entry.kind
          : "skill";
      return {
        domain: entry.domain as SessionBulkFailure["domain"],
        target: entry.target,
        kind,
        error: typeof entry.error === "string" ? entry.error : "操作失败",
      };
    })
    .filter((item): item is SessionBulkFailure => item !== undefined);
  const action = raw.action === "disable" || raw.action === "reset" ? raw.action : "enable";
  const num = (candidate: unknown): number =>
    typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
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

/** 已知的归属依据取值（task-32 additive；未知值统一回落 `unknown`）。 */
const ATTRIBUTION_MATCHED_BY = new Set<ClientAttributionInfo["matchedBy"]>([
  "runtime",
  "literal",
  "table",
  "similarity",
  "namespace",
  "prefix",
  "exact",
  "source",
  "unknown",
]);

/**
 * 置信度归一：宿主 D4 契约是 `"high" | "medium" | "low"` 字符串；兼容旧数字口径
 * （0–1 或 0–100 → 统一归一到 0–1）。其它形状丢弃（不展示）。
 */
function normalizeConfidence(value: unknown): "high" | "medium" | "low" | number | undefined {
  if (value === "high" || value === "medium" || value === "low") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = value > 1 ? value / 100 : value;
    return Math.max(0, Math.min(1, normalized));
  }
  return undefined;
}

/**
 * 归属判定投影（Tools 单元 / MCP 运行时实例共用）：
 * - `matchedBy` 只收已知值，未知/缺失回落 `unknown`；
 * - 其余 additive 字段（confidence / conflictsWithTable / ambiguous / mixed /
 *   legacyUnit）逐项容错：类型不对就丢弃，不影响开关语义；
 * - 传入非对象返回 undefined（调用方决定是否补 `{matchedBy:"unknown"}`）。
 */
function toAttribution(value: unknown): ClientAttributionInfo | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const matchedBy = ATTRIBUTION_MATCHED_BY.has(raw.matchedBy as ClientAttributionInfo["matchedBy"])
    ? (raw.matchedBy as ClientAttributionInfo["matchedBy"])
    : ("unknown" as const);
  // legacyUnit 只认 true 或非空旧键字符串；false/空串视为「未迁移」。
  const legacyUnit =
    raw.legacyUnit === true
      ? true
      : typeof raw.legacyUnit === "string" && raw.legacyUnit.length > 0
        ? raw.legacyUnit
        : undefined;
  return {
    matchedBy,
    ...(typeof raw.pattern === "string" && raw.pattern.length > 0 ? { pattern: raw.pattern } : {}),
    ...(typeof raw.packageName === "string" && raw.packageName.length > 0 ? { packageName: raw.packageName } : {}),
    ...(normalizeConfidence(raw.confidence) !== undefined ? { confidence: normalizeConfidence(raw.confidence) } : {}),
    ...(raw.conflictsWithTable === true ? { conflictsWithTable: true } : {}),
    ...(raw.ambiguous === true ? { ambiguous: true } : {}),
    ...(raw.mixed === true ? { mixed: true } : {}),
    ...(legacyUnit !== undefined ? { legacyUnit } : {}),
  };
}

/**
 * v21：可见性行字段的防御性投影（skills / mcp / tools 三域共用）。
 * 旧宿主缺省 ⇒ 整组字段不出现（UI 按「全部可见」渲染）。
 */
function toVisibilityFields(value: Record<string, unknown>): ClientVisibilityFields {
  const mode =
    value.visibilityMode === "all" || value.visibilityMode === "selected" || value.visibilityMode === "none"
      ? (value.visibilityMode as ClientVisibilityMode)
      : undefined;
  return {
    ...(mode !== undefined ? { visibilityMode: mode } : {}),
    ...(typeof value.visibleWorkspaceCount === "number" && Number.isFinite(value.visibleWorkspaceCount)
      ? { visibleWorkspaceCount: value.visibleWorkspaceCount }
      : {}),
    ...(typeof value.visibleInWorkspace === "boolean" ? { visibleInWorkspace: value.visibleInWorkspace } : {}),
    ...(value.disabledByVisibility === true ? { disabledByVisibility: true } : {}),
  };
}

/** v21：`skills.list` / `skills.sessionList` 的 value 归一（`{skills, hiddenCount}` 或旧数组）。 */
function toSkillList(value: unknown): { skills: ClientSkillSummary[]; hiddenCount?: number } {
  const raw = Array.isArray(value)
    ? { skills: value }
    : value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const values = (Array.isArray(raw.skills) ? raw.skills : []).filter(
    (item): item is Record<string, unknown> => item !== null && typeof item === "object",
  );
  return {
    skills: values.map(toSummary),
    ...(typeof raw.hiddenCount === "number" && Number.isFinite(raw.hiddenCount) ? { hiddenCount: raw.hiddenCount } : {}),
  };
}

/**
 * v21：`overrides.globalGet.visibility` 的防御性投影。
 * 三域恒为对象；条目 mode 非法按 all；workspaces 非对象按空、字段只收布尔。
 */
function toVisibilitySets(value: unknown): ClientVisibilitySets {
  const source = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const domainOf = (domain: "skills" | "mcp" | "tools"): Record<string, { mode: ClientVisibilityMode; workspaces: Record<string, ClientWorkspaceVisibility> }> => {
    const raw = source[domain];
    if (raw === null || typeof raw !== "object") return {};
    const result: Record<string, { mode: ClientVisibilityMode; workspaces: Record<string, ClientWorkspaceVisibility> }> = {};
    for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (key.length === 0 || entry === null || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const mode: ClientVisibilityMode =
        record.mode === "selected" || record.mode === "none" ? record.mode : "all";
      const workspaces: Record<string, ClientWorkspaceVisibility> = {};
      if (record.workspaces !== null && typeof record.workspaces === "object") {
        for (const [path, rawVisibility] of Object.entries(record.workspaces as Record<string, unknown>)) {
          if (path.length === 0 || rawVisibility === null || typeof rawVisibility !== "object") continue;
          const visibility = rawVisibility as Record<string, unknown>;
          const projected: ClientWorkspaceVisibility = {
            ...(typeof visibility.visible === "boolean" ? { visible: visibility.visible } : {}),
            ...(typeof visibility.defaultEnabled === "boolean" ? { defaultEnabled: visibility.defaultEnabled } : {}),
          };
          if (projected.visible !== undefined || projected.defaultEnabled !== undefined) workspaces[path] = projected;
        }
      }
      result[key] = { mode, workspaces };
    }
    return result;
  };
  return { skills: domainOf("skills"), mcp: domainOf("mcp"), tools: domainOf("tools") };
}

/**
 * 把宿主返回的行对象投影成客户端摘要：
 * 调用策略是嵌套的 `invocation` 对象 → 拍平成两个布尔；
 * 其它字段做了宽松的字符串归一，防御宿主侧数据漂移。
 *
 * 注入字段（`injected` / `origin` / `channel` / …）是 additive 的：宿主/旧
 * 宿主缺失时整组字段不出现，UI 按磁盘行渲染（降级兼容）。
 */
function toSummary(value: Record<string, unknown>): ClientSkillSummary {
  const inv = (value.invocation ?? {}) as Record<string, unknown>;
  const origin = value.origin === "bundled" || value.origin === "plugin" || value.origin === "preset" ? value.origin : undefined;
  const resourceBaseKind =
    value.resourceBaseKind === "directory" || value.resourceBaseKind === "url" || value.resourceBaseKind === "opaque"
      ? value.resourceBaseKind
      : undefined;
  const injected = value.injected === true;
  return {
    ...toVisibilityFields(value),
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
    ...(value.activationPending === true ? { activationPending: true } : {}),
    ...(injected ? { injected: true } : {}),
    ...(origin !== undefined ? { origin } : {}),
    ...(typeof value.channel === "string" && value.channel.length > 0 ? { channel: value.channel } : {}),
    ...(typeof value.provider === "string" && value.provider.length > 0 ? { provider: value.provider } : {}),
    ...(typeof value.registrySource === "string" && value.registrySource.length > 0 ? { registrySource: value.registrySource } : {}),
    ...(resourceBaseKind !== undefined ? { resourceBaseKind } : {}),
    ...(value.contentReadOnly === true ? { contentReadOnly: true } : {}),
    ...(typeof value.disabledInProject === "boolean" ? { disabledInProject: value.disabledInProject } : {}),
    // v20.1（B2）additive：全局默认 / 工作区显式覆盖 / 有效默认值。
    ...(typeof value.globalDefaultDisabled === "boolean" ? { globalDefaultDisabled: value.globalDefaultDisabled } : {}),
    ...(typeof value.projectDefaultEnabled === "boolean" ? { projectDefaultEnabled: value.projectDefaultEnabled } : {}),
    ...(typeof value.projectDefaultDisabled === "boolean" ? { projectDefaultDisabled: value.projectDefaultDisabled } : {}),
    ...(typeof value.effectiveDefaultEnabled === "boolean" ? { effectiveDefaultEnabled: value.effectiveDefaultEnabled } : {}),
    ...(typeof value.canToggleGlobal === "boolean" ? { canToggleGlobal: value.canToggleGlobal } : {}),
    ...(typeof value.globalToggleBlockedReason === "string" && value.globalToggleBlockedReason.length > 0
      ? { globalToggleBlockedReason: value.globalToggleBlockedReason }
      : {}),
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
function toSkillDetail(result: unknown, name: string): ClientSkillDetail | undefined {
  const raw = (result ?? {}) as Record<string, unknown>;
  // 兼容两种输入：未解信封的 `{ok, value}` 与已解开的业务结果。
  const value = (raw.value !== null && typeof raw.value === "object" ? (raw.value as Record<string, unknown>) : raw) as Record<string, unknown>;
  const spec = (value.spec ?? {}) as Record<string, unknown>;
  const invocation = (spec.invocation ?? {}) as Record<string, unknown>;
  const resources = Array.isArray(value.resources)
    ? value.resources.filter((item): item is string => typeof item === "string")
    : [];
  if (typeof value.body !== "string") return undefined;
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
    spec: spec as unknown as ClientSkillDetail["spec"],
    body: value.body,
    resources,
    ...(value.fromRegistry === true ? { fromRegistry: true } : {}),
    ...(typeof value.resourceBaseNote === "string" && value.resourceBaseNote.length > 0
      ? { resourceBaseNote: value.resourceBaseNote }
      : {}),
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

/**
 * `jev.*` 的业务失败提取（与 skills/mcp 的 unwrap 抛错刻意不同，架构 §9.7）：
 * 宿主把业务失败包成 `{ok:true, value:{ok:false, code, errors, issues?}}`，
 * 适配器 `rpc()` 已展平为 `{ok:false, code, errors, issues?}`。这里保留
 * `code` 原样返回，供调用方做错误分类；没有 `code` 的是传输层失败，返回
 * undefined 交给调用方抛错。
 */
function toJevFailure(
  result: RawResult,
): { ok: false; code: string; errors: string[]; issues?: JevConfigIssue[] } | undefined {
  if (result.ok) return undefined;
  const record = result as unknown as Record<string, unknown>;
  const code = record.code;
  if (typeof code !== "string" || code.length === 0) return undefined;
  return {
    ok: false,
    code,
    errors: result.errors,
    ...(Array.isArray(record.issues) ? { issues: record.issues as JevConfigIssue[] } : {}),
  };
}

/**
 * `jev.getConfig` 视图的防御性投影：宿主字段缺失 / 类型漂移时回退默认值，
 * 保证配置表单永远可渲染（默认值与宿主 `defaultJevConfig()` 对齐）。
 */
function toJevConfigView(value: unknown): JevConfigView {
  const raw = (value ?? {}) as Record<string, unknown>;
  const auto = (raw.autoTrigger ?? {}) as Record<string, unknown>;
  const source = raw.apiKeySource === "env" || raw.apiKeySource === "file" ? raw.apiKeySource : "none";
  const num = (input: unknown, fallback: number): number =>
    typeof input === "number" && Number.isFinite(input) ? input : fallback;
  /** 阈值投影：宿主已校验 0–1，这里再夹取 + 取两位小数，避免滑杆收到越界值。 */
  const threshold = Math.min(1, Math.max(0, Math.round(num(raw.decisionThreshold, 0.5) * 100) / 100));
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
    decisionThreshold: threshold,
    timeoutMs: num(raw.timeoutMs, 30000),
    ...(typeof raw.apiKeyEnv === "string" && raw.apiKeyEnv.length > 0 ? { apiKeyEnv: raw.apiKeyEnv } : {}),
  };
}