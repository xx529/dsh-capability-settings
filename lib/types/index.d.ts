/**
 * capability-panel 插件的宿主端入口。
 *
 * 职责：
 *
 *   - 暴露 `ctx.capabilityPanel` 服务（Cordis `ctx.provide`），内含：
 *     - `skills`：传输无关的磁盘 CRUD 管理器（见 `skills/manager.ts` 与
 *       `skills/crud.ts`）；
 *     - `mcp`：项目/全局 MCP 配置 CRUD + 实时挂载状态（见 `mcp/manager.ts`）；
 *     - `overrides`：项目级"全局能力禁用"声明（见 `overrides/manager.ts`）——
 *       允许在单个项目里禁用指定的全局 MCP server（项目自身的同名条目不受影响）。
 *   - 通过 `mcp/loader.ts` 把配置好的 MCP server 自动挂载进每个存活 agent
 *     （全局 `~/.agents/mcp.json`，兼容旧位置 `~/.dsh` / `~/.claude`；
 *     + 项目 `.mcp.json`，项目级禁用的全局 server 跳过）。
 *   - 当存在 Web 端 `connection` 服务时，挂载插件自有的 RPC 通道
 *     `/capability-panel`，让 GUI 客户端能调用各域（见 `remote.ts`）。
 *
 * 本插件**不会**重复注册 skills provider：文件系统 provider 已经拥有
 * 项目/全局根目录，所以技能读取复用 `ctx.skills` 与直接磁盘列举，
 * 而不是注册第二个 provider。
 *
 * @module dsh-capability-settings
 */
import { createService } from "./skills/manager.js";
import type { SessionSkillView, SkillSessionRegistry } from "./skills/session.js";
import { createMcpManager } from "./mcp/manager.js";
import { createOverridesManager } from "./overrides/manager.js";
import { createJevManager } from "./jev/manager.js";
import type { ToolsManager } from "./tools/manager.js";
/** Cordis 插件名（对应 cordis.patch.yml 里的插件 id）。 */
export declare const name = "capability-panel";
/** 宿主插件强依赖的服务（connection/webServer 是惰性解析的，不在这里声明）。 */
export declare const inject: string[];
/** 宿主插件配置项。 */
export interface Config {
    /** dsh home 覆盖（缺省用 `resolveDshHome()` 解析）。 */
    dshHome?: string;
    /** agents home 覆盖（缺省 `~/.agents`）。 */
    agentsHome?: string;
    /** 为 false 时不挂载 Web RPC 通道（headless 场景）。缺省 true。 */
    mountRpc?: boolean;
    /** 为 false 时不自动把 MCP server 挂载进 agent。缺省 true。 */
    mountMcp?: boolean;
    /**
     * 插件工具自动归属（T0 运行时栈 / T1 包扫描 / T2 namespace / T3 相似度）。
     *
     * 缺省 **true**；false = 退回纯人工表（T4）行为（不挂监听、不扫描、不写缓存）。
     */
    enableAutoAttribution?: boolean;
}
/**
 * skills 域服务 = 磁盘 CRUD 管理器 + 会话级开关（按会话落盘的 runtime shadow）。
 *
 * 会话级开关是纯增量：`list` 等原有方法不变，客户端改用 `sessionList`
 * （多带 enabledInSession / canToggleInSession 两列）。
 */
export type SkillsService = ReturnType<typeof createService> & {
    /** 磁盘列表 + 本会话启用态（见 skills/session.ts）。 */
    sessionList: (cwd?: string, sessionId?: string) => Promise<SessionSkillView[]>;
    /** 设置本会话开关（按会话落盘；重启/resume 后恢复）。 */
    setSessionEnabled: SkillSessionRegistry["setEnabled"];
};
/** 暴露给宿主调用方的传输无关服务：skills / mcp 两个域的合体 + 项目级禁用声明 + Jev。 */
export interface CapabilityPanelService {
    skills: SkillsService;
    mcp: ReturnType<typeof createMcpManager>;
    overrides: ReturnType<typeof createOverridesManager>;
    /** Jev 能力决策（配置 / 打分 / 应用；见 `jev/manager.ts`）。 */
    jev: ReturnType<typeof createJevManager>;
    /**
     * Tools 域（插件级会话开关，v13；见 `tools/manager.ts`）。
     *
     * 一个插件 = 一个开关单元；关闭 = 对该插件在本会话的全部可继承工具调
     * `tools.restrict({deny})`。主面板 `/tools.list` 只读；开关只作用于会话。
     */
    tools: ToolsManager;
    /**
     * R1 批量端点（三域一次开 / 关 / 恢复默认；见 `session-bulk.ts`）。
     *
     * 业务失败收在返回值里（`{ok:false,errors}`），通道层信封恒 `{ok:true,value}`。
     */
    session: {
        setBulk(input: unknown): Promise<unknown>;
    };
    /**
     * 可选：按 serverName 从全局工具注册表反推 MCP 工具清单（只读）。
     *
     * 只给 Jev rank 的逐能力 question 用（让模型知道 server 实际能做什么）；
     * 实现方任何异常应静默返回 []，不影响枚举/评分。
     */
    mcpTools?: (serverName: string) => Array<{
        name: string;
        description?: string;
    }>;
}
/** 宿主上下文增强：`ctx.capabilityPanel`。 */
declare module "@deepseek-ai/cordis" {
    interface Context {
        capabilityPanel: CapabilityPanelService;
    }
}
/**
 * 在 `ctx` 上注册宿主插件。
 *
 * loader 只建一次：自动挂载器（agent/created 监听）与管理器
 * （状态查询 + 写后重挂）共用同一实例，保证两者的状态口径一致。
 */
export declare function apply(ctx: any, config?: Config): void;
export { createService, isGlobalSource } from "./skills/manager.js";
export { createSkillSessionRegistry } from "./skills/session.js";
export type { SkillSessionRegistry, SkillSessionDeps, SessionSkillView, SessionSkillOpResult } from "./skills/session.js";
export { createSkillRegistryBridge, isOwnShadow, SHADOW_DESCRIPTION, SHADOW_METADATA_KEY, } from "./skills/registry.js";
export type { ClassifiedInjectedRow, HostSkillCatalogSnapshot, HostSkillDefinition, HostSkillSummary, HostSkillsService, InjectedMergeInput, RegistryNameVerdict, RegistryReadResult, SkillRegistryBridge, SkillRegistryBridgeDeps, SkillResourceResult, } from "./skills/registry.js";
export { createMcpLoader } from "./mcp/loader.js";
export { createMcpManager } from "./mcp/manager.js";
export { scanInjectedMcpInstances, scanInjectedMcpEntries, scanInjectedMcpFibers, scanInjectedMcpNamespaces } from "./mcp/runtime.js";
export type { InjectedMcpInstance } from "./mcp/runtime.js";
export { createToolsManager, applyForAgent, effectiveEnabled, TOOL_DESCRIPTION_LIMIT, TOOL_INSPECT_WARN_BYTES, LOCKED_RESTRICT_UNAVAILABLE, } from "./tools/manager.js";
export type { ToolsManager, ToolsManagerDeps, ToolsLogger, ApplyForAgentResult } from "./tools/manager.js";
export { computeDenyNames, applyRestrict, sameDenyNames, TOOLS_RESTRICT_UNAVAILABLE, TOOLS_RESTRICT_NO_TOOLS } from "./tools/restrict.js";
export type { RestrictOutcome, ToolsRestrictionState } from "./tools/restrict.js";
export { UNATTRIBUTED_UNIT, UNATTRIBUTED_DISPLAY, PLUGIN_UNIT_KEY_PREFIX, TOOLS_DEFAULT_ENABLED, unitKeyOf, unitOfKey, } from "./tools/types.js";
export { createToolsGlobalStore, toolsGlobalDir, toolsGlobalFile, TOOLS_GLOBAL_FILE_NAME, TOOLS_GLOBAL_VERSION } from "./tools/global-state.js";
export type { ToolsGlobalStore, ToolsGlobalStoreDeps, ToolsGlobalLogger, ToolsGlobalSetResult } from "./tools/global-state.js";
export type { HostToolBrief, ToolsUnitView, ToolsListView, ToolsSetSessionInput, ToolsSetSessionResult, ToolsInspectedTool, ToolsInspectInput, ToolsInspectView, ToolsInspectResult, ToolsSetGlobalInput, ToolsSetGlobalResult, } from "./tools/types.js";
export { createSessionBulk } from "./session-bulk.js";
export type { SessionBulk, SessionBulkAction, SessionBulkDeps, SessionBulkDomain, SessionBulkDomainStat, SessionBulkFailure, SessionBulkInput, SessionBulkResult, SessionBulkServices, } from "./session-bulk.js";
export { TOOL_RULES, MCP_NAMESPACE_RULES, RESTRICT_FORBIDDEN_TOOL_NAMES, attributeTool, attributeMcpNamespace, displayNameOfSource, isHostBuiltinTool, isRestrictForbiddenToolName, } from "./shared/plugin-attribution.js";
export type { ToolRule, McpNamespaceRule } from "./shared/plugin-attribution.js";
export { createSessionState, sessionStateDir, sessionStateFile, SESSION_STATE_FILE_NAME, SESSION_STATE_GRACE_MS, } from "./session-state.js";
export { createSessionStateReconciler } from "./session-state-reconcile.js";
export type { SessionStateEntry, SessionStateReconcileInput, SessionStateReconcileResult, SessionStateStore, } from "./session-state.js";
export type { SessionStateReconciler, SessionStateReconcilerDeps } from "./session-state-reconcile.js";
export { createOverridesManager } from "./overrides/manager.js";
export { createJevManager } from "./jev/manager.js";
export type { JevManager, JevManagerDeps } from "./jev/manager.js";
export { readJevConfig, setJevConfig, validateJevConfig, resolveJevKey, toJevConfigView, redact, } from "./jev/config-file.js";
export { jevConfigDir, jevConfigFile } from "./jev/paths.js";
export { defaultJevConfig } from "./jev/types.js";
export type { JevConfig, JevConfigInput, JevConfigView, JevRankItem, JevRankResult, JevApplyResult, JevTestResult, } from "./jev/types.js";
export { mountRpcChannel, handleEndpoint, CHANNEL } from "./remote.js";
export { findProjectRoot } from "./shared/project-root.js";
export { globalSkillsDir, projectSkillsDir, userAgentsSkillsDir } from "./skills/roots.js";
export { projectOverridesFile, OVERRIDES_FILE_NAME, overridesStoreFile, OVERRIDES_STORE_FILE_NAME } from "./overrides/paths.js";
export { readOverrides, writeOverrides, readOverridesStore, writeOverridesStore, DOMAIN_KEYS, OVERRIDES_STORE_VERSION, } from "./overrides/config-file.js";
export { createSkill, updateSkill, removeSkill, readSkillDetail, cloneSkill, listSkillNames } from "./skills/crud.js";
export { installFromPath, installFromFiles, exportToPath, exportSkillFiles } from "./skills/transfer.js";
export { installFromUrl, fetchSkillFiles, classifySkillUrl } from "./skills/download.js";
export { unzipSync } from "./skills/unzip.js";
export { locateSkillRoot } from "./shared/skill-locate.js";
export type { TransferFile, TransferResult } from "./skills/transfer.js";
export { isSkillName, validateSpec } from "./skills/validate.js";
export { invocationPolicy } from "./skills/types.js";
export { globalMcpFile, projectMcpFile } from "./mcp/paths.js";
export { readMcpFile, writeMcpFile, sanitizeServerName, toClientConfig, validateEntry } from "./mcp/config-file.js";
export type { SkillSummaryView, SkillSpec, SkillFormat, WritableScope, InvocationPolicy, InjectedSkillFields, RegistryResourceBaseKind, SkillOrigin, SkillSource, } from "./skills/types.js";
export type { McpScope, McpServerEntry, McpServerView, McpListResult, McpStatusView, McpMountState } from "./mcp/types.js";
export type { CapabilityDomain, CapabilityOverrides, OverridesProjectEntry, OverridesSet, OverridesStore, OverridesView, } from "./overrides/types.js";
export type { OverridesManager } from "./overrides/manager.js";
/**
 * Cordis 以 `module.default || module` 解析插件包。这里提供默认导出
 * （{ name, inject, apply }），让 profile patch 能按包名挂载
 * （`dsh-capability-settings`，见 cordis.patch.yml）。
 */
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;
