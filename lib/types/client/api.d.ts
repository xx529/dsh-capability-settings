/**
 * 客户端面板的 API 表面（传输无关）。
 *
 * 面板 UI 只依赖这套接口，不关心底层传输方式；具体的适配器
 * （插件自有通道 `/capability-panel` 上的 RPC，见 api-adapter.ts）由
 * `src/client.ts` 组装注入。
 *
 * 客户端类型（`Client*` 前缀）刻意与宿主类型（skills/types、mcp/types）
 * 保持独立：这是传输边界，宿主侧的类型（如 McpStatusView）是 Cordis
 * 运行时的概念，不能直接依赖。
 *
 * @module @chengdb/capability-panel/client/api
 */
import type { SkillFormat, SkillSpec, WritableScope } from "../skills/types.js";
import type { McpScope, McpServerEntry } from "../mcp/types.js";
import type { CapabilityDomain } from "../overrides/types.js";
/** 面板列表里的一行 skill 摘要（调用策略已拍平为两个布尔）。 */
export interface ClientSkillSummary {
    name: string;
    description: string;
    whenToUse?: string;
    modelInvocable: boolean;
    userInvocable: boolean;
    source: string;
    format: SkillFormat;
    readOnly: boolean;
    path?: string;
    /** 可写条目所属的受管根目录（写回/导出/导入时按 root 精确寻址）。 */
    root?: string;
    /**
     * 为 true 表示本条目是「项目内禁用全局」生成的屏蔽占位（shadow stub）：
     * 按宿主 rank 遮蔽同名全局条目，使其在本项目不可调用；删除它即恢复。
     */
    shadowStub?: boolean;
    /**
     * 仅全局条目携带：当前项目对它的遮蔽状态。
     * `stub` = 项目区已有屏蔽占位（本项目内已禁用，可「恢复」）；
     * `skill` = 项目区已有同名真实条目（项目副本遮蔽全局）。
     */
    projectShadow?: "stub" | "skill";
    /**
     * 本会话是否生效（composer 的 sessionList 投影）：内存态、不落盘。
     * 缺省 true；本会话关闭后为 false。
     */
    enabledInSession?: boolean;
    /** 当前会话是否有 agent ctx（false 时 UI 会话开关置灰）。 */
    canToggleInSession?: boolean;
}
/** skill 详情 = 摘要 + 完整 spec + 正文 + 资源文件列表。 */
export interface ClientSkillDetail extends ClientSkillSummary {
    spec: SkillSpec;
    body: string;
    resources: string[];
}
/** 创建 skill 的入参（scope/target 决定落盘位置）。 */
export interface CreateSkillInput {
    scope: WritableScope;
    target?: ".dsh" | ".agents";
    format: SkillFormat;
    spec: SkillSpec;
    body: string;
    overwrite?: boolean;
}
/** 操作结果：成功或错误信息列表（与宿主侧枚举保持同构）。 */
export type OpResult = {
    ok: true;
} | {
    ok: false;
    errors: string[];
};
/** 安装结果：成功时带回实际落盘的 skill 名（以 frontmatter 名称为准）。 */
export type InstallResult = {
    ok: true;
    name?: string;
    existed?: boolean;
} | {
    ok: false;
    errors: string[];
};
/** 上传/下载通道里的一个文件：相对路径 + base64 内容（二进制安全）。 */
export interface SkillFilePayload {
    path: string;
    content: string;
}
/** 浏览器上传安装的入参（单 .md 文件或含 SKILL.md 的一组目录文件）。 */
export interface InstallUploadInput {
    scope: WritableScope;
    target?: ".dsh" | ".agents";
    files: SkillFilePayload[];
    overwrite?: boolean;
}
/** 宿主路径安装的入参。 */
export interface InstallPathInput {
    scope: WritableScope;
    target?: ".dsh" | ".agents";
    sourcePath: string;
    overwrite?: boolean;
}
/** URL 下载安装的入参（GitHub 仓库 / .zip / raw .md）。 */
export interface InstallUrlInput {
    scope: WritableScope;
    target?: ".dsh" | ".agents";
    url: string;
    overwrite?: boolean;
}
/** 导出为文件清单的结果（客户端据此单文件下载或打 zip）。 */
export type ExportFilesResult = {
    ok: true;
    name: string;
    format: SkillFormat;
    files: SkillFilePayload[];
} | {
    ok: false;
    errors: string[];
};
/** 按行寻址一个可写 skill 的最小入参（root 优先，scope/target 兜底）。 */
export interface SkillRef {
    name: string;
    root?: string;
    scope?: WritableScope;
    target?: ".dsh" | ".agents";
}
/** skills 域的面板 API。 */
export interface SkillsApi {
    /** 列出（合并）当前作用域下所有 skill 摘要。 */
    list(): Promise<ClientSkillSummary[]>;
    /**
     * 会话视角的 skill 列表：与 {@link list} 相同，但多返回
     * `enabledInSession` / `canToggleInSession`（需要 api 带 sessionId，仅
     * composer 的每会话 api 提供）。用于输入框下方的会话能力配置区。
     */
    sessionList(): Promise<ClientSkillSummary[]>;
    /**
     * 关闭 / 恢复某个 skill 在**当前会话**的可见性（内存态、不落盘）：
     * 关闭通过 agent 作用域注册同名 runtime shadow 实现（从模型目录、
     * `skill` 工具与 `/name` 注入三条链路消失）；恢复即解除 shadow。
     * 只能「关闭 / 恢复」，不能强制开启文件级已禁用项。
     */
    setSessionEnabled(input: {
        name: string;
        enabled: boolean;
    }): Promise<OpResult>;
    /** 读取单个 skill 详情；不存在返回 undefined。 */
    read(name: string): Promise<ClientSkillDetail | undefined>;
    create(input: CreateSkillInput): Promise<OpResult>;
    update(input: {
        scope: WritableScope;
        target?: ".dsh" | ".agents";
        name: string;
        spec: SkillSpec;
        body: string;
    }): Promise<OpResult>;
    remove(input: SkillRef): Promise<OpResult>;
    /**
     * 一键启用/禁用 skill：禁用 = 用户与模型都不可调用（frontmatter 写入
     * `user-invocable: false` 与 `disable-model-invocation: true`）；启用 =
     * 清除两个键恢复缺省双启用。正文与其它元数据原样保留。
     */
    setEnabled(input: SkillRef & {
        enabled: boolean;
    }): Promise<OpResult>;
    /**
     * 细粒度调节调用方式：模型（agent 自动触发）与用户（输入框 `/name` 口令）
     * 两个方向分别启用/禁用。例如只希望用户手动触发、不让 agent 自动注入的
     * skill，把 `modelInvocable` 设为 false 即可——frontmatter 只写
     * `disable-model-invocation: true`，另一个方向原样保留。
     */
    setInvocation(input: SkillRef & {
        modelInvocable: boolean;
        userInvocable: boolean;
    }): Promise<OpResult>;
    /** 浏览器上传安装（单 .md / 含 SKILL.md 的目录文件清单 / zip 解压清单）。 */
    installUpload(input: InstallUploadInput): Promise<InstallResult>;
    /** 从宿主磁盘路径安装（skill 目录或 .md 文件）。 */
    installFromPath(input: InstallPathInput): Promise<InstallResult>;
    /** 从 URL 下载安装（GitHub 仓库、.zip URL 或 raw .md URL）。 */
    installFromUrl(input: InstallUrlInput): Promise<InstallResult>;
    /**
     * 导入单个全局 skill 到当前项目：**物理复制**到 `<项目>/.agents/skills`
     * （目录型连资源文件），此后在本项目内独立启停/调节调用方向（写项目
     * 副本的 frontmatter，全局配置不动；快照语义，不跟随全局更新）。
     * 目标已有同名条目且未传 overwrite 时返回 `{ ok: false, existed: true }`；
     * 其它项目根有同名原生条目时报硬错误（副本会被遮蔽、不生效）。
     */
    importToProject(input: {
        name: string;
        fromRoot?: string;
        overwrite?: boolean;
    }): Promise<OpResult & {
        existed?: boolean;
        path?: string;
    }>;
    /**
     * 在本项目内禁用某个全局 skill（shadow stub）：在项目 `.agents/skills`
     * 生成同名占位文件（frontmatter 双向禁用），按宿主 rank 覆盖全局条目，
     * 模型与用户调用都被宿主原生拒绝。项目内已有同名真实条目时返回
     * `{ ok: false, existed: true }`（应直接禁用那个条目）。
     */
    disableInProject(input: {
        name: string;
        fromRoot?: string;
    }): Promise<OpResult & {
        existed?: boolean;
    }>;
    /** 恢复全局 skill 在本项目可用：删除 shadow stub（幂等）。 */
    enableInProject(input: {
        name: string;
    }): Promise<OpResult>;
    /** 导出为 base64 文件清单（供浏览器下载/打包）。 */
    exportFiles(input: SkillRef): Promise<ExportFilesResult>;
    /** 导出到宿主上的指定目录。 */
    exportToPath(input: SkillRef & {
        destDir: string;
        overwrite?: boolean;
    }): Promise<OpResult>;
}
/** 面板视角的一条 MCP server（合并 + 投影后的视图，自带摘要）。 */
export interface ClientMcpServer {
    key: string;
    serverName: string;
    transport: "stdio" | "http";
    scope: McpScope;
    enabled: boolean;
    shadowed: boolean;
    summary: string;
    entry: McpServerEntry;
    filePath: string;
    /**
     * 为 true 表示这条**项目**条目与全局条目同源：引用视图（reference）
     * 恒带此标记；旧版「导入 = 物理复制」时期导入的副本（条目里带导入
     * 标记）也带此标记。面板据此显示「全局」归属徽标与「移出」按钮。
     */
    importedFromGlobal?: boolean;
    /**
     * 为 true 表示这条视图是**项目级引用**（内容实时取自同名全局条目，
     * 启停是引用上的项目级标记）。引用条目不提供「编辑」（请到全局区编辑）。
     */
    reference?: boolean;
    /**
     * 为 true 表示这个 server 被当前项目在项目级声明为**默认关闭**
     * （`.agents/capability-overrides.json` 的 mcp 列表）。面板「默认」列的开关
     * = `!disabledInProject`；新建对话按它来。
     */
    disabledInProject?: boolean;
    /**
     * 本会话的生效开关（composer 的 api 带了 sessionId 时由宿主投影）：显式会话
     * 开关优先，否则跟随项目默认。内存内、不落盘。
     */
    enabledInSession?: boolean;
}
/** 合并列表结果：servers + 非致命的读取错误。 */
export interface ClientMcpList {
    servers: ClientMcpServer[];
    errors: string[];
}
/** 一条 server 在一个 session 内的挂载状态。 */
export interface ClientMcpMount {
    key: string;
    serverName: string;
    state: "mounted" | "failed" | "conflict";
    error?: string;
}
/** 一个 session 的挂载状态视图（对应宿主的 McpStatusView）。 */
export interface ClientMcpStatus {
    sessionId: string;
    projectRoot?: string;
    servers: ClientMcpMount[];
    /**
     * 宿主后台是否还在重挂（写入不再阻塞 RPC，见 `manager.reloadFor`）。
     * 面板据此在写操作后短暂轮询，让挂载状态自行收敛。
     */
    settling?: boolean;
}
/**
 * 一条 MCP 工具调用记录（宿主内存内、不落盘）。
 *
 * 适配器已把 `sessionId` 解析成侧栏标题（`sessionTitle`）；拿不到时缺省，
 * 面板退化为显示会话 id 尾部。
 */
export interface ClientMcpUsageEntry {
    /** 调用时间（epoch 毫秒）。 */
    time: number;
    /** 桥接层 serverName（与 `ClientMcpServer.serverName` 对应）。 */
    serverName: string;
    /** 已去掉 `mcp__<serverName>__` 前缀的工具名。 */
    tool: string;
    /** 调用方 session id。 */
    sessionId: string;
    /** 会话标题（侧栏显示的那个）；拿不到时缺省。 */
    sessionTitle?: string;
}
/** `mcp.usage` 的返回：最近若干条记录 + 本次生效的条数上限。 */
export interface ClientMcpUsageView {
    entries: ClientMcpUsageEntry[];
    limit: number;
}
/**
 * 运行时注入的 MCP 实例（**只读**）：不是本插件配置文件里的条目，而是其它插件
 * 或 profile 直接挂载的 mcp-client。面板只展示，不提供编辑/卸载。
 */
export interface ClientMcpRuntimeServer {
    /** 实例的 serverName（工具名 `mcp__<serverName>__*` 里的那段）。 */
    serverName: string;
    /** 来源：注入它的插件显示名 / loader 条目 id；识别不到时缺省。 */
    source?: string;
    /** 发现路径：loader 条目 / 动态 fiber（用于文案与诊断）。 */
    origin: "entry" | "fiber";
    /** 桥接层配置里读到的传输方式（与配置条目同形）。 */
    transport?: "stdio" | "http";
    /** 与配置条目同款的命令/URL 摘要。 */
    summary?: string;
    /** 项目级「默认关闭」（overrides 声明）：新建对话默认不启用，可按当前对话覆盖。 */
    disabledInProject?: boolean;
    /** 能否按项目屏蔽（工具在全局注册表可见才可；agent 作用域注入的不可）。 */
    restrictable: boolean;
    /** 本会话的生效开关（传 sessionId 时才有；restrictable 才有意义）。 */
    enabledInSession?: boolean;
    /** 从工具注册表反推到的工具（含参数 JSON Schema）。 */
    tools: Array<{
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
    }>;
    /** 本次运行被调用次数（内存使用记录；0 = 未调用或不可见）。 */
    calls: number;
}
/** `mcp.runtime` 的返回。 */
export interface ClientMcpRuntimeView {
    servers: ClientMcpRuntimeServer[];
}
/** 新增/更新一条 server 的入参。 */
export interface McpUpsertInput {
    scope: McpScope;
    key: string;
    entry: McpServerEntry;
}
/** 面板视角的一个 MCP 工具（宿主探测结果投影）。 */
export interface ClientMcpTool {
    name: string;
    description?: string;
    /**
     * 工具的 `inputSchema`（JSON Schema 原样透传）：面板读取 `properties` /
     * `required` 渲染参数表（名字 / 类型 / 是否必填 / 说明）。
     */
    parameters?: Record<string, unknown>;
    outputSchema?: unknown;
}
/**
 * 「测试 MCP 服务器」的结果：
 *  - 成功：连接正常 + 工具清单（可能为空——服务器未暴露任何工具）+ 耗时；
 *  - 失败：人类可读的中文错误文案列表（含原始错误 / stderr 摘要）。
 */
export type McpTestResult = {
    ok: true;
    /** 规范化后的命名空间（对应挂载后的 `mcp__<serverName>__*`）。 */
    serverName: string;
    tools: ClientMcpTool[];
    elapsedMs: number;
    /** 服务器自报的 instructions（有则展示）。 */
    instruction?: string;
} | {
    ok: false;
    errors: string[];
};
/** MCP 域的面板 API。 */
export interface McpApi {
    list(): Promise<ClientMcpList>;
    upsert(input: McpUpsertInput): Promise<OpResult>;
    remove(input: {
        scope: McpScope;
        key: string;
    }): Promise<OpResult>;
    setEnabled(input: {
        scope: McpScope;
        key: string;
        enabled: boolean;
    }): Promise<OpResult>;
    /**
     * 导入全局 server 到当前项目：**登记一条引用**（写入
     * `<项目根>/.agents/capability-imports.json`），不是物理复制——内容始终
     * 跟随全局条目，全局更新实时生效；项目级启停记录在引用上。引用与项目
     * 原生条目同级参与挂载合并（遮蔽全局原版）。项目内已有同名原生条目时
     * 报硬错误；已有同名引用且未传 overwrite 时返回 `{ ok: false, existed: true }`。
     */
    importToProject(input: {
        key: string;
        overwrite?: boolean;
    }): Promise<OpResult & {
        existed?: boolean;
    }>;
    /** 当前项目下各 session 的实时挂载状态。 */
    status(): Promise<ClientMcpStatus[]>;
    /**
     * 「测试」：真实连接这份（可能尚未保存的）条目并列出其工具名与入参。
     *
     * 零副作用：不落盘、不注册工具、不改变任何已挂载连接；失败以
     * `{ ok:false, errors }` 返回（不抛异常），由面板就地展示。
     */
    test(input: {
        entry: McpServerEntry;
        key?: string;
        timeoutMs?: number;
    }): Promise<McpTestResult>;
    /**
     * 最近 MCP 工具调用记录（**只读、内存内、不落盘**）：什么时候、哪个 session
     * 调用了哪个 server 的哪个 tool。传 `serverName` 只取该 server 的记录。
     * 记录在插件/进程重载后清空——这是刻意的，不做任何持久化。
     */
    usage(input?: {
        serverName?: string;
        limit?: number;
    }): Promise<ClientMcpUsageView>;
    /**
     * 运行时注入的 MCP 实例（**只读**）：来自其它插件/profile 在运行时挂载的
     * mcp-client，不在能力面板的配置文件里。按工具注册表（`mcp__*`）与内存使用记录
     * 反推，只用于展示；编辑/卸载请去注入方。
     */
    runtime(input?: {
        cwd?: string;
    }): Promise<ClientMcpRuntimeView>;
    /**
     * 设置**当前 session** 的能力开关（内存内、不落盘）：项目条目按需挂载/卸载，
     * 全局与外部注入实例用 `tools.restrict` 屏蔽/恢复其工具（不卸载实例）。
     * `enabled: undefined` = 清掉显式覆盖、重新跟随项目默认。
     */
    setSessionEnabled(input: {
        target: string;
        kind: "project" | "server";
        enabled: boolean | undefined;
    }): Promise<void>;
}
/** 面板视角的完整禁用状态（各域的禁用清单 + 声明文件路径；skills 不走此机制）。 */
export interface ClientOverrides {
    mcp: string[];
    /** 声明文件绝对路径（无项目时缺省）。 */
    filePath?: string;
}
/** 项目级禁用域的面板 API。 */
export interface OverridesApi {
    /** 当前项目的禁用声明全量（无工作区时返回空清单）。 */
    get(): Promise<ClientOverrides>;
    /**
     * 切换某个**全局**能力在本项目的禁用状态：不在清单里 → 加入（禁用）；
     * 已在清单里 → 移除（恢复）。落盘 `<项目根>/.agents/capability-overrides.json`，
     * 读取兼容旧位置 `.dsh` / `.claude`。
     */
    toggle(domain: CapabilityDomain, key: string): Promise<OpResult>;
}
/** 评分 / 测试 / 密钥解析失败的分类码（架构 §5.4）。 */
export type JevErrorCode = "no-config" | "auth" | "rate-limit" | "overloaded" | "timeout" | "context-too-long" | "network" | "bad-request" | "empty-capabilities";
/** `setConfig` 的业务错误码。 */
export type JevSetConfigErrorCode = "invalid-config" | "write-failed";
/** `apply` 的业务错误码。 */
export type JevApplyErrorCode = "bad-request" | "write-failed";
/** 一次评分请求的 token 用量（宿主原样透传）。 */
export interface JevUsage {
    input_tokens: number;
    output_tokens: number;
}
/** 自动触发（输入停顿后自动评分）的四个可配置门槛。 */
export interface JevAutoTrigger {
    /** 总开关，**默认 false**（默认关闭）。 */
    enabled: boolean;
    /** 停顿阈值（ms）：300–3000，步长 100，默认 1000。 */
    pauseMs: number;
    /** 最少触发字数：1–200，默认 10。 */
    minChars: number;
    /** 最少修改间隔字符数：1–100，默认 4。 */
    minEditChars: number;
}
/**
 * 配置文件 `~/.dsh/capability-panel/jev.json` 的完整形状。
 *
 * 客户端只镜像语义、不落盘；`apiKey` 仅在提交 `setConfig` 时单向下发，
 * 任何读取响应都不会带明文（架构 §4.2）。
 */
export interface JevConfig {
    /** 服务根地址（不含 `/v1/systemone`），默认 `https://api.typesafe.ai`。 */
    baseURL: string;
    /** 模型名，默认 `jev-latest`。 */
    model: string;
    /** 直接填写的密钥（可省略）。 */
    apiKey?: string;
    /** 承载密钥的环境变量名，默认 `TYPESAFE_API_KEY`。 */
    apiKeyEnv?: string;
    autoTrigger: JevAutoTrigger;
    /** 单次 HTTP 尝试超时（ms），默认 30000。 */
    timeoutMs: number;
}
/** `setConfig` 的入参：字段均可选；`autoTrigger` 若提供必须是完整对象。 */
export type JevConfigInput = Partial<Omit<JevConfig, "autoTrigger">> & {
    autoTrigger?: JevAutoTrigger;
};
/** `jev.setConfig` 的 payload。 */
export interface JevSetConfigInput {
    config: JevConfigInput;
}
/**
 * `jev.getConfig` 的视图（**不含任何密钥明文**，架构 §4.2）。
 *
 * `apiKeyEnv` 是宿主 additive 字段（架构 §4.2 的补充，task-19）：返回已保存的
 * 环境变量名（默认 `TYPESAFE_API_KEY`，非明文），供配置页回显；宿主暂时缺失时
 * 前端退回默认值。
 */
export interface JevConfigView {
    baseURL: string;
    model: string;
    hasApiKey: boolean;
    apiKeySource: "env" | "file" | "none";
    /** 已保存密钥的末 4 位；无 key 为 null，短 key 为 `"****"`。 */
    apiKeyLast4: string | null;
    autoTrigger: JevAutoTrigger;
    timeoutMs: number;
    /** 已保存的环境变量名（additive，默认 TYPESAFE_API_KEY；缺省时前端兜底）。 */
    apiKeyEnv?: string;
}
/** 保存结果的字段级明细（宿主 additive 返回）。 */
export interface JevConfigIssue {
    field: string;
    code: string;
    message: string;
}
/** `jev.setConfig` 的返回：成功 `{ok:true}`；失败带错误码与可读错误。 */
export type JevSetConfigResult = {
    ok: true;
} | {
    ok: false;
    code: JevSetConfigErrorCode;
    errors: string[];
    issues?: JevConfigIssue[];
};
/** `jev.test` 的返回：成功带回实际模型与首次尝试耗时。 */
export type JevTestResult = {
    ok: true;
    model: string;
    latencyMs: number;
} | {
    ok: false;
    code: JevErrorCode;
    errors: string[];
};
/** 一条被评分的能力（宿主枚举 + 打分 + 会话态投影）。 */
export interface JevRankItem {
    /** 稳定能力 id：`cap_<36 位小写 hex>`；apply 只认这个 id。 */
    id: string;
    kind: "skill" | "mcp";
    name: string;
    description: string;
    /** 0..1 的 noul 分数；无答案记 0。 */
    score: number;
    /** 能力本身可启用（与 session 活性无关）。 */
    applicable: boolean;
    /** `applicable=false` 时的原因。 */
    reason?: string;
    /** 当前会话启用态（前端勾选初值 / 回显）。 */
    enabledInSession: boolean;
}
/** 冷会话排队应用的结果回执（宿主 additive 返回，读取即消费）。 */
export interface JevPendingOutcome {
    applied: number;
    failed: number;
    errors: string[];
    /** epoch ms。 */
    at: number;
}
/** `jev.rank` 的返回：成功分支携带完整评分结果；失败分支带分类码。 */
export type JevRankResult = {
    ok: true;
    items: JevRankItem[];
    model: string;
    usage: JevUsage;
    elapsedMs: number;
    /** 逻辑批量请求数（重试不累加），恒为 1。 */
    requestCount: 1;
    capabilitiesTotal: number;
    pendingOutcome?: JevPendingOutcome;
} | {
    ok: false;
    code: JevErrorCode;
    errors: string[];
};
/** `apply` 跳过原因。 */
export type JevApplySkipReason = "unknown-id" | "hard-disabled" | "not-restrictable" | "not-toggleable" | "shadowed" | "already-applied";
/** 一条应用计划项（宿主按 id 重解析，不信任 name/target）。 */
export interface JevApplyPlanItem {
    id: string;
    kind: "skill" | "mcp";
    name: string;
    target?: string;
    /** 本期只支持「启用」。 */
    enabled: true;
}
/** 被跳过的计划项。 */
export interface JevApplySkipped {
    id: string;
    reason: JevApplySkipReason;
}
/** 应用失败的计划项。 */
export interface JevApplyFailed {
    id: string;
    reason: string;
}
/** `jev.apply` 的返回：成功分支含 applied/skipped/pending；失败分支带分类码。 */
export type JevApplyResult = {
    ok: true;
    /** 生效条数（旧宿主语义 = 本次启用数；回滚后为 0）。 */
    applied: number;
    /**
     * additive（task-42 筛选语义）：本次实际启用条数。
     *
     * 旧宿主不返回；客户端缺失时回退 `applied`（旧宿主只会启用，不会关闭）。
     */
    enabled?: number;
    /** additive（task-42 筛选语义）：本次实际关闭条数；旧宿主缺失视为 0。 */
    disabled?: number;
    skipped: JevApplySkipped[];
    pending: boolean;
    failed?: JevApplyFailed[];
    errors?: string[];
    pendingOutcome?: JevPendingOutcome;
} | {
    ok: false;
    code: JevApplyErrorCode;
    errors: string[];
};
/** 成功分支的收窄别名（组件按需使用）。 */
export type JevRankSuccess = Extract<JevRankResult, {
    ok: true;
}>;
export type JevApplySuccess = Extract<JevApplyResult, {
    ok: true;
}>;
/**
 * Jev 域的面板 API。
 *
 * 与 skills/mcp 不同，`rank` / `apply` 的业务失败**不 throw**，原样返回带
 * `code` 的对象；只有传输层异常（RPC reject / sessionId 缺失）才抛。
 */
export interface JevApi {
    /** 读取全局配置视图（永远不含密钥明文）。 */
    getConfig(): Promise<JevConfigView>;
    /** 保存全局配置：成功不关闭配置页，由调用方决定是否重新读取。 */
    setConfig(input: JevSetConfigInput): Promise<JevSetConfigResult>;
    /**
     * 发一次最小探针（不落盘、不改会话开关）。
     *
     * - 不传 / 传 `{}`：用**已保存的配置**（旧行为）。
     * - 传 `{config: {config: JevConfigInput}}`：内层 `config` 与 `setConfig` 同形，
     *   adapter 把它原样作为 RPC payload `{config: JevConfigInput}` 透传；宿主以
     *   「当前磁盘配置 + 该 config」合并出**仅本次探针使用的临时配置**，用于
     *   AC-CFG-10「测试使用当前表单值且不写盘」。
     */
    test(input?: {
        config?: JevSetConfigInput;
    }): Promise<JevTestResult>;
    /**
     * 为当前会话的全部可评分能力打分。
     * `sessionId` / `cwd` 由 adapter 从 api 依赖自动注入，组件只需传草稿。
     */
    rank(input: {
        draft: string;
        sessionId?: string;
        cwd?: string;
    }, signal?: AbortSignal): Promise<JevRankResult>;
    /** 应用一份计划（由宿主按 id 重解析；冷会话走排队）。 */
    apply(input: {
        plan: JevApplyPlanItem[];
        sessionId?: string;
        cwd?: string;
    }): Promise<JevApplyResult>;
}
/** 项目下拉框里的一个工作区选项。 */
export interface WorkspaceOption {
    id: string;
    path: string;
    title?: string;
}
/** 面板需要的全部宿主能力（skills + mcp + overrides + jev + 工作区选择），传输无关。 */
export interface CapabilityPanelApi {
    skills: SkillsApi;
    mcp: McpApi;
    overrides: OverridesApi;
    /**
     * Jev 能力决策域。配置页只用 `getConfig/setConfig/test`；`rank/apply` 需要
     * 会话上下文（composer 的每会话 api），在面板根 api 上调用会抛错。
     */
    jev: JevApi;
    /** 面板头部的"项目作用域"目录标签。 */
    workspaceLabel(): string;
    /**
     * 当前显式钉选的项目目录；`undefined` 表示面板自动跟随
     * 当前 session / 最近工作区。
     */
    selectedProject(): string | undefined;
    /** 把项目作用域钉选到一个工作区路径（`undefined` 恢复自动跟随）。 */
    selectProject(path: string | undefined): void;
    /** 项目下拉框可用的工作区列表。 */
    projects(): WorkspaceOption[];
    /**
     * 订阅当前工作区变化，供面板刷新头部标签并重拉项目作用域条目
     * （解析完成或切换时触发）。
     * @returns 取消订阅函数。
     */
    subscribeWorkspace(listener: () => void): () => void;
}
