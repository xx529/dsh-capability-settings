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
import { createSkillSessionRegistry } from "./skills/session.js";
import { createSkillRegistryBridge } from "./skills/registry.js";
import { createMcpLoader } from "./mcp/loader.js";
import { createMcpManager } from "./mcp/manager.js";
import { createMcpUsageLog, registerMcpUsageGuard } from "./mcp/usage.js";
import { scanInjectedMcpInstances } from "./mcp/runtime.js";
import { createOverridesManager } from "./overrides/manager.js";
import { createImportsManager } from "./imports/manager.js";
import { createJevManager } from "./jev/manager.js";
import { createSessionState } from "./session-state.js";
import { createSessionStateReconciler } from "./session-state-reconcile.js";
import { findProjectRoot } from "./shared/project-root.js";
import { mountRpcChannel } from "./remote.js";
/** Cordis 插件名（对应 cordis.patch.yml 里的插件 id）。 */
export const name = "capability-panel";
/** 宿主插件强依赖的服务（connection/webServer 是惰性解析的，不在这里声明）。 */
export const inject = ["skills"];
/**
 * 在 `ctx` 上注册宿主插件。
 *
 * loader 只建一次：自动挂载器（agent/created 监听）与管理器
 * （状态查询 + 写后重挂）共用同一实例，保证两者的状态口径一致。
 */
export function apply(ctx, config = {}) {
    // overrides 原身只做声明文件的读/写；loader 与各域管理器共用它的 sets()
    // 快照。MCP 域的禁用切换落盘后需要热重挂（禁用即卸载、恢复即挂载），但
    // overrides 与 loader 互相依赖（loader 要 sets、切换要 reload），所以在
    // 组合根处包一层：loader 拿原身（只读），对外暴露的 service.overrides 是
    // 带 reload 侧效应的包装。
    const overridesRaw = createOverridesManager({ dshHome: config.dshHome });
    // 会话级开关的持久化存储：MCP loader 与 Skills 会话注册表**共用同一实例**
    // （见 session-state.ts）。两个域各自读-改-写同一文件会互相覆盖，所以必须
    // 在组合根建一次、注入下去；无 dshHome 的 headless 环境仍可工作（落盘到
    // 默认 dsh home，写入失败只 warn）。
    const sessionState = createSessionState({ dshHome: config.dshHome, logger: ctx.logger });
    // 项目级「全局能力引用」存储：MCP 管理器与 MCP loader 共用同一实例
    // （「导入到本项目」= 登记引用，启停是引用上的项目级标记）。
    // skills 域不走引用——skill 的启停由宿主原生读 frontmatter，引用存储
    // 对宿主注入链不可见（见 CHANGELOG Unreleased）。
    const imports = createImportsManager();
    const loader = createMcpLoader(ctx, {
        dshHome: config.dshHome,
        agentsHome: config.agentsHome,
        enabled: config.mountMcp !== false,
        overrides: overridesRaw,
        imports,
        state: sessionState,
    });
    /**
     * skills 域的项目默认热应用钩子：写盘成功后对同项目的 live 会话增量
     * reconcile（注册/解除 agent 作用域 runtime shadow）。由组合根注入到
     * `skillSessions` 的构造里（延迟求值，避免构造顺序耦合）。
     */
    const reconcileProjectRef = {};
    const overrides = {
        ...overridesRaw,
        toggle: async (input) => {
            const result = await overridesRaw.toggle(input);
            if (!result.ok)
                return result;
            if (input.domain === "mcp" && input.cwd !== undefined) {
                await loader.reload(findProjectRoot(input.cwd));
            }
            // skills：项目默认变更后热应用到同项目的 live 会话（无 live 会话时是 no-op，
            // 新会话在 agent/created 时按文件内容应用）。逐名独立、失败不回滚文件。
            if (input.domain === "skills" && input.cwd !== undefined && reconcileProjectRef.current !== undefined) {
                return reconcileProjectRef.current(input.cwd);
            }
            return result;
        },
    };
    // MCP 工具调用的内存使用记录（只读、不落盘）：通过 root 作用域的 tools.guard
    // 旁路记录 mcp__* 调用，供面板详情页的「使用记录」展示。disposer 随插件卸载。
    const mcpUsage = createMcpUsageLog();
    const disposeUsageGuard = registerMcpUsageGuard(ctx, mcpUsage);
    // skills 域 = 磁盘管理器（原有，见 skills/manager.ts）+ registry 桥
    // （注入技能读取/详情/资源，见 skills/registry.ts）+ 会话级开关
    // （内存 shadow + 项目默认投影，见 skills/session.ts）。
    //
    // 构造顺序：桥需要"按 sessionId 取 live agent"，会话注册表需要桥的
    // read-before/after-shadow；两者用延迟访问器互相引用。
    const skillSessionsRef = {};
    const skillsRegistry = createSkillRegistryBridge({
        ctx,
        logger: ctx.logger,
        agentOf: (sessionId) => skillSessionsRef.current?.agentOf(sessionId),
        isShadowed: (sessionId, name) => skillSessionsRef.current?.isShadowed(sessionId, name) ?? false,
    });
    const skillsBase = createService(ctx, {
        dshHome: config.dshHome,
        agentsHome: config.agentsHome,
        registry: skillsRegistry,
    });
    // 磁盘原始 list 的稳定引用：装配阶段**不能**再把 skillsBase.list 原地覆盖成
    // 注入合并版，否则 mergePanelList → skillsBase.list 会自我递归（RangeError）。
    const diskList = skillsBase.list.bind(skillsBase);
    const skillSessions = createSkillSessionRegistry(ctx, {
        logger: ctx.logger,
        registry: skillsRegistry,
        state: sessionState,
        projectDisabled: async (cwd) => (await overridesRaw.sets(cwd)).skills,
    });
    skillSessionsRef.current = skillSessions;
    reconcileProjectRef.current = (cwd) => skillSessions.reconcileProject(cwd);
    /**
     * 面板 `skills.list` 的组合视图：受管磁盘行 + 宿主 registry 注入行。
     *
     * registry 任何异常都降级为「仅磁盘行」，不影响面板其它功能
     * （架构契约 §5.7 失败降级矩阵）。
     */
    async function mergePanelList(cwd) {
        const diskRows = await diskList(cwd);
        let projectDisabled = new Set();
        try {
            projectDisabled = new Set((await overridesRaw.sets(cwd)).skills);
        }
        catch {
            projectDisabled = new Set();
        }
        try {
            const injected = await skillsRegistry.merge({ cwd, diskRows, projectDisabled });
            return [...diskRows, ...injected].sort((a, b) => a.name.localeCompare(b.name));
        }
        catch {
            return diskRows;
        }
    }
    // Jev 管理器：内部持有冷会话排队表与 agent/created|disposed 监听。service
    // 访问器延迟求值（jev 与 service 互相引用），disposer 随插件卸载清监听与
    // 内存队列（架构 §8.7）。
    const serviceRef = {};
    const jev = createJevManager({
        ctx,
        dshHome: config.dshHome,
        service: () => serviceRef.current,
        logger: ctx.logger,
    });
    const service = {
        // 用对象展开装配（不原地改 skillsBase）：三个覆盖方法都基于 `diskList`
        // 这一份原始磁盘 list，避免装配顺序造成的自引用/无限递归。
        skills: {
            ...skillsBase,
            /** 面板列表 = 磁盘视图 + 宿主 registry 注入行（同名磁盘优先）。 */
            list: (cwd) => mergePanelList(cwd),
            sessionList: (cwd, sessionId) => skillSessions.list(diskList, cwd, sessionId),
            setSessionEnabled: skillSessions.setEnabled,
        },
        mcp: createMcpManager(
        // tools 访问器用于反推"运行时注入"的 MCP 实例（见 manager.runtime）。
        {
            dshHome: config.dshHome,
            agentsHome: config.agentsHome,
            usage: mcpUsage,
            tools: () => ctx.get?.("tools"),
            // 运行时注入的 mcp-client：cordis 注册表里的动态 fiber + loader 条目
            // （见 mcp/runtime.ts）。只读，用来给出「来源插件」与桥接层配置。
            scanInjected: () => [...scanInjectedMcpInstances(ctx).values()],
        }, loader, overrides, imports),
        overrides,
        jev,
        // Jev rank 的 question 需要「这个 MCP server 能做什么」：从全局工具注册表
        // 反推 `mcp__<serverName>__*`（name 取后缀、description 取 schema 描述）。
        // 只读；tools 服务缺失或任何异常都静默降级为 []（评分照常，只是缺 tools）。
        mcpTools: (serverName) => {
            try {
                const schemas = ctx.get?.("tools")?.schemas?.() ?? [];
                const prefix = `mcp__${serverName}__`;
                const tools = [];
                for (const schema of Array.isArray(schemas) ? schemas : []) {
                    const fullName = typeof schema?.name === "string" ? schema.name : "";
                    if (!fullName.startsWith(prefix))
                        continue;
                    const name = fullName.slice(prefix.length);
                    if (name.length === 0)
                        continue;
                    const description = typeof schema?.description === "string" && schema.description.length > 0 ? schema.description : undefined;
                    tools.push(description !== undefined ? { name, description } : { name });
                }
                return tools;
            }
            catch {
                return [];
            }
        },
    };
    // 回填给 jev 的延迟访问器：此后 apply/rank 才能枚举能力。
    serviceRef.current = service;
    ctx.provide("capabilityPanel", () => service);
    // 会话级开关记录的孤儿对账（见 session-state-reconcile.ts）：宿主没有"会话
    // 删除"事件，靠"存在性校验 + 24h 两阶段"清理；disposed 只触发"标记"核对
    // （关机时会对所有 live 会话成批发 disposed，不能当删除信号）。
    const reconciler = createSessionStateReconciler(ctx, sessionState, { logger: ctx.logger });
    reconciler.start();
    const offSessionDisposed = typeof ctx.on === "function" ? ctx.on("session/disposed", () => reconciler.noteDisposed()) : undefined;
    const offAgentDisposed = typeof ctx.on === "function" ? ctx.on("agent/disposed", () => reconciler.noteDisposed()) : undefined;
    const disposers = [
        disposeUsageGuard,
        () => skillsRegistry.dispose(),
        () => skillSessions.dispose(),
        () => jev.dispose(),
        () => reconciler.dispose(),
        () => sessionState.dispose(),
        ...(typeof offSessionDisposed === "function" ? [offSessionDisposed] : []),
        ...(typeof offAgentDisposed === "function" ? [offAgentDisposed] : []),
    ];
    if (config.mountRpc !== false) {
        const dispose = mountRpcChannel(ctx, service);
        if (typeof dispose === "function")
            disposers.push(dispose);
    }
    if (disposers.length > 0) {
        ctx.effect(() => () => {
            for (const dispose of disposers)
                dispose();
        }, "capability-panel: rpc channel");
    }
}
// ---------------------------------------------------------------------------
// 公开 API（re-export）：供宿主内其它插件按需引入，保持名字稳定。
// ---------------------------------------------------------------------------
export { createService, isGlobalSource } from "./skills/manager.js";
export { createSkillSessionRegistry } from "./skills/session.js";
export { createSkillRegistryBridge, isOwnShadow, SHADOW_DESCRIPTION, SHADOW_METADATA_KEY, } from "./skills/registry.js";
export { createMcpLoader } from "./mcp/loader.js";
export { createMcpManager } from "./mcp/manager.js";
export { createSessionState, sessionStateDir, sessionStateFile, SESSION_STATE_FILE_NAME, SESSION_STATE_GRACE_MS, } from "./session-state.js";
export { createSessionStateReconciler } from "./session-state-reconcile.js";
export { createOverridesManager } from "./overrides/manager.js";
export { createJevManager } from "./jev/manager.js";
export { readJevConfig, setJevConfig, validateJevConfig, resolveJevKey, toJevConfigView, redact, } from "./jev/config-file.js";
export { jevConfigDir, jevConfigFile } from "./jev/paths.js";
export { defaultJevConfig } from "./jev/types.js";
export { mountRpcChannel, handleEndpoint, CHANNEL } from "./remote.js";
export { findProjectRoot } from "./shared/project-root.js";
export { globalSkillsDir, projectSkillsDir, userAgentsSkillsDir } from "./skills/roots.js";
export { projectOverridesFile, OVERRIDES_FILE_NAME } from "./overrides/paths.js";
export { readOverrides, writeOverrides, DOMAIN_KEYS } from "./overrides/config-file.js";
export { createSkill, updateSkill, removeSkill, readSkillDetail, cloneSkill, listSkillNames } from "./skills/crud.js";
export { installFromPath, installFromFiles, exportToPath, exportSkillFiles } from "./skills/transfer.js";
export { installFromUrl, fetchSkillFiles, classifySkillUrl } from "./skills/download.js";
export { unzipSync } from "./skills/unzip.js";
export { locateSkillRoot } from "./shared/skill-locate.js";
export { isSkillName, validateSpec } from "./skills/validate.js";
export { invocationPolicy } from "./skills/types.js";
export { globalMcpFile, projectMcpFile } from "./mcp/paths.js";
export { readMcpFile, writeMcpFile, sanitizeServerName, toClientConfig, validateEntry } from "./mcp/config-file.js";
/**
 * Cordis 以 `module.default || module` 解析插件包。这里提供默认导出
 * （{ name, inject, apply }），让 profile patch 能按包名挂载
 * （`dsh-capability-settings`，见 cordis.patch.yml）。
 */
export default { name, inject, apply };
