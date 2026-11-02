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

import type {} from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-skill";

import { createService } from "./skills/manager.js";
import { createSkillSessionRegistry, supplementInjectedRows } from "./skills/session.js";
import type { SessionSkillView, SkillSessionRegistry } from "./skills/session.js";
import { createSkillRegistryBridge } from "./skills/registry.js";
import type { SkillRegistryBridge } from "./skills/registry.js";
import type { SkillSummaryView } from "./skills/types.js";
import { createMcpLoader } from "./mcp/loader.js";
import { createMcpManager } from "./mcp/manager.js";
import { createMcpUsageLog, registerMcpUsageGuard } from "./mcp/usage.js";
import { scanInjectedMcpInstances } from "./mcp/runtime.js";
import { createOverridesManager } from "./overrides/manager.js";
import type { OverrideToggleInput } from "./overrides/manager.js";
import { createImportsManager } from "./imports/manager.js";
import { createJevManager } from "./jev/manager.js";
import { createSessionState } from "./session-state.js";
import { createSessionStateReconciler } from "./session-state-reconcile.js";
import { createDeriveInheritance } from "./derive/manager.js";
import { createToolsManager } from "./tools/manager.js";
import { createAttributionResolver } from "./tools/attribution/resolver.js";
import type { ToolsManager } from "./tools/manager.js";
import { createToolsGlobalStore } from "./tools/global-state.js";
import { createSessionBulk } from "./session-bulk.js";
import type { SessionBulk } from "./session-bulk.js";
import { findProjectRoot } from "./shared/project-root.js";
import { annotateSkillDefaults } from "./shared/skill-defaults.js";
import { mountRpcChannel } from "./remote.js";

/** Cordis 插件名（对应 cordis.patch.yml 里的插件 id）。 */
export const name = "capability-panel";

/** 宿主插件强依赖的服务（connection/webServer 是惰性解析的，不在这里声明）。 */
export const inject = ["skills"];

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
  /**
   * v21：面板列表（磁盘 + 注入，工作区视图过滤不可见）+ `hiddenCount`
   * （被可见性隐藏的技能数）。RPC `skills.list` 返回这个形态。
   */
  listView: (cwd?: string) => Promise<{ skills: SkillSummaryView[]; hiddenCount: number }>;
  /** 磁盘列表 + 本会话启用态（见 skills/session.ts）。 */
  sessionList: (cwd?: string, sessionId?: string) => Promise<SessionSkillView[]>;
  /**
   * v21：会话视图（只返回可见技能）+ `hiddenCount`。RPC `skills.sessionList`
   * 返回这个形态；宿主内部（jev / session-bulk）继续用数组形态 `sessionList`。
   */
  sessionListView: (
    cwd?: string,
    sessionId?: string,
  ) => Promise<{ skills: SessionSkillView[]; hiddenCount: number }>;
  /** 设置本会话开关（按会话落盘；重启/resume 后恢复）。 */
  setSessionEnabled: SkillSessionRegistry["setEnabled"];
  /**
   * 批量设置本会话开关（性能路径：整批一次目录发现 + 一次落盘）。
   *
   * `jev.apply` 的筛选语义一次要写约 150 条技能；逐条调用会触发 O(N²) 的
   * 宿主 skill catalog 全量发现（见 `skills/session.ts` 的 `setEnabledBatch`）。
   */
  setSessionEnabledBatch: SkillSessionRegistry["setEnabledBatch"];
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
    /** 读取会话级「派生继承模式」及（若本会话是派生会话）创建时快照。 */
    deriveGet(input: unknown): Promise<unknown>;
    /** 设置会话级「派生继承模式」（`session` / `workspace`）。 */
    deriveSet(input: unknown): Promise<unknown>;
  };
  /**
   * 可选：按 serverName 从全局工具注册表反推 MCP 工具清单（只读）。
   *
   * 只给 Jev rank 的逐能力 question 用（让模型知道 server 实际能做什么）；
   * 实现方任何异常应静默返回 []，不影响枚举/评分。
   */
  mcpTools?: (serverName: string) => Array<{ name: string; description?: string }>;
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
export function apply(ctx: any, config: Config = {}) {
  // 自动归属 resolver：**最先**创建（T0 监听覆盖窗口最大），异步扫描不阻塞首屏。
  const attribution = createAttributionResolver({
    ctx,
    ...(config.dshHome !== undefined ? { dshHome: config.dshHome } : {}),
    logger: ctx.logger,
    enabled: config.enableAutoAttribution !== false,
  });
  // Tools 域全局默认存储（v13；v21 起只读兼容 + 新写入统一到全局文件 `tools`）。
  // 必须先于 overrides 建：overrides 计算「兜底全局默认」时要用它的 disabled
  // （旧 `tools-global.json`）与新名单取并集。
  const toolsGlobal = createToolsGlobalStore({ dshHome: config.dshHome, logger: ctx.logger });
  // overrides 原身只做声明文件的读/写；loader 与各域管理器共用它的 sets()
  // 快照。MCP 域的禁用切换落盘后需要热重挂（禁用即卸载、恢复即挂载），但
  // overrides 与 loader 互相依赖（loader 要 sets、切换要 reload），所以在
  // 组合根处包一层：loader 拿原身（只读），对外暴露的 service.overrides 是
  // 带 reload 侧效应的包装。
  const overridesRaw = createOverridesManager({
    dshHome: config.dshHome,
    // v21：Tools 兜底全局默认 = 旧 `tools-global.json` ∪ 全局文件 `tools`。
    toolsGlobalDisabled: async () => {
      await toolsGlobal.ready();
      return toolsGlobal.disabled();
    },
  });
  // 会话级开关的持久化存储：MCP loader 与 Skills 会话注册表**共用同一实例**
  // （见 session-state.ts）。两个域各自读-改-写同一文件会互相覆盖，所以必须
  // 在组合根建一次、注入下去；无 dshHome 的 headless 环境仍可工作（落盘到
  // 默认 dsh home，写入失败只 warn）。
  const sessionState = createSessionState({ dshHome: config.dshHome, logger: ctx.logger });
  // 派生继承（spawn-time snapshot）：必须**早于** tools / mcp / skills 的
  // `agent/created` 监听器创建，保证 child 的会话记录先写入快照，三个域随后
  // hydrate 时读到同一份结果（监听器被 cordis serial await）。
  const deriveSkillSessionsRef: {
    current?: {
      trackAgent(agent: any): void;
      setEnabledBatch(input: {
        sessionId: string;
        entries: ReadonlyArray<{ name: string; enabled: boolean }>;
      }): Promise<{ ok: boolean; errors: string[] }>;
    };
  } = {};
  const deriveInheritance = createDeriveInheritance(ctx, {
    state: sessionState,
    logger: ctx.logger,
    getSkillSessions: () => deriveSkillSessionsRef.current,
  });
  // Tools 域（v13）：枚举全局工具注册表 → 按插件聚合成开关单元 → 按会话
  // restrict 该插件全部可继承工具。与会话存储共用同一实例（`tools` 域）。
  // Tools 两层语义：全局默认（`tools-global.json`，能力面板开关） + 会话覆盖
  // （`session-capabilities.json` 的 `tools` 域，会话首屏开关）。
  const tools = createToolsManager(ctx, {
    state: sessionState,
    global: toolsGlobal,
    logger: ctx.logger,
    resolver: attribution,
    // v21：可见性 + 每工作区默认 + 项目三态（与 skills/mcp 共用同一计算入口）。
    capabilityDefaults: (units: readonly string[], cwd?: string) =>
      overridesRaw.capabilityDefaultsMany("tools", units, cwd),
    // 全局兜底关闭 = 旧 tools-global.json ∪ 全局文件 tools。
    globalDefaults: async () => {
      const legacy = new Set(toolsGlobal.disabled());
      const global = (await overridesRaw.globalGet()).tools;
      for (const unit of global) legacy.add(unit);
      return legacy;
    },
    // v21：全局默认写入统一到 capability-global-overrides.json 的 tools。
    writeGlobalDefaults: (units: readonly string[], enabled: boolean) =>
      overridesRaw.globalToggleMany({ domain: "tools", keys: units, disabled: !enabled }),
  });
  // R1 批量端点：延迟构造（依赖最终 service），同 session 串行由模块内部保证。
  const sessionBulkRef: { current?: SessionBulk } = {};
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
  const reconcileProjectRef: { current?: (cwd?: string) => Promise<{ ok: true } | { ok: false; errors: string[] }> } = {};
  const overrides = {
    ...overridesRaw,
    toggle: async (input: OverrideToggleInput) => {
      const result = await overridesRaw.toggle(input);
      if (!result.ok) return result;
      if (input.domain === "mcp" && input.cwd !== undefined) {
        await loader.reload(findProjectRoot(input.cwd));
      }
      // tools（v21）：工作区默认变更后重读兜底并扇出到 live agent 重算 restrict。
      if (input.domain === "tools") {
        try {
          await tools.refreshFromVisibility();
        } catch (error) {
          ctx.logger?.warn?.(`capability-panel: 工作区 Tools 默认已写入，但运行时刷新失败：${String(error)}`);
        }
        return result;
      }
      // skills：项目默认变更后热应用到同项目的 live 会话（无 live 会话时是 no-op，
      // 新会话在 agent/created 时按文件内容应用）。逐名独立、失败不回滚文件。
      if (input.domain === "skills" && input.cwd !== undefined && reconcileProjectRef.current !== undefined) {
        return reconcileProjectRef.current(input.cwd);
      }
      return result;
    },
    /**
     * 全局默认开关（B2 Skills / v20.2 MCP / v21 Tools）：写
     * `capability-global-overrides.json` 后热应用到 live 会话。
     *
     * - `domain === "skills"`：对**所有** live 会话 reconcile（全局层对所有项目
     *   生效）。逐名失败（preset 同层冲突）以 `{ok:false, errors}` 返回，绝不静默
     *   把列表当已生效。
     * - `domain === "mcp"`：`loader.refreshRestrictions()` 重算 restrict + 指令段
     *   影子（不重挂 fiber，共享实例不卸载）。失败降级为 `{ok:true}`（文件已写入），
     *   只 warn。
     */
    globalToggle: async (input: Parameters<typeof overridesRaw.globalToggle>[0]) => {
      const result = await overridesRaw.globalToggle(input);
      if (!result.ok) return result;
      const domain = (input as { domain?: unknown } | null | undefined)?.domain;
      if (domain === "mcp") {
        try {
          await loader.refreshRestrictions();
        } catch (error) {
          // 文件已写入：运行时投影失败不能把 RPC 判成失败（下次 tools/change /
          // 重挂仍会收敛），只留 warning。
          ctx.logger?.warn?.(`capability-panel: 全局 MCP 默认已写入，但运行时屏蔽刷新失败：${String(error)}`);
        }
        return result;
      }
      if (domain === "tools") {
        try {
          await tools.refreshFromVisibility();
        } catch (error) {
          ctx.logger?.warn?.(`capability-panel: 全局 Tools 默认已写入，但运行时刷新失败：${String(error)}`);
        }
        return result;
      }
      if (reconcileProjectRef.current === undefined) return result;
      const reconciled = await reconcileProjectRef.current(undefined);
      if (reconciled.ok) return reconciled;
      // 文件已写入但运行时投影未完全生效（preset 同层等硬边界）：逐名报错，
      // 并明确告知「文件已写入」，避免前端把失败误读成没落盘。
      return { ok: false, errors: ["全局默认已写入文件，但以下运行时投影失败：", ...reconciled.errors] };
    },
    /**
     * 写能力可见性（v21 `overrides.setVisibility`）：写全局文件 v2 的
     * `visibility`，成功后**三域热应用**（写盘已成功时运行时投影失败只 warn，
     * 不把 RPC 判成失败）：
     *
     *   - skills → `reconcileProject(undefined)`（全局可见性对所有工作区生效）；
     *   - mcp → `loader.refreshRestrictions()`（restrict + 指令段影子）；
     *   - tools → `tools.refreshFromVisibility()`（重读兜底 + 扇出重算 restrict）。
     */
    setVisibility: async (input: Parameters<typeof overridesRaw.setVisibility>[0]) => {
      const result = await overridesRaw.setVisibility(input);
      if (!result.ok) return result;
      const domain = (input as { domain?: unknown } | null | undefined)?.domain;
      try {
        if (domain === "skills" && reconcileProjectRef.current !== undefined) {
          const reconciled = await reconcileProjectRef.current(undefined);
          if (!reconciled.ok) {
            return { ok: false, errors: ["可见性已写入文件，但以下运行时投影失败：", ...reconciled.errors] };
          }
        } else if (domain === "mcp") {
          await loader.refreshRestrictions();
        } else if (domain === "tools") {
          await tools.refreshFromVisibility();
        }
      } catch (error) {
        ctx.logger?.warn?.(`capability-panel: 可见性已写入，但运行时投影失败：${String(error)}`);
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
  const skillSessionsRef: { current?: SkillSessionRegistry } = {};
  const skillsRegistry: SkillRegistryBridge = createSkillRegistryBridge({
    ctx,
    logger: ctx.logger,
    agentOf: (sessionId: string) => skillSessionsRef.current?.agentOf(sessionId),
    isShadowed: (sessionId: string, name: string) => skillSessionsRef.current?.isShadowed(sessionId, name) ?? false,
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
    // 默认值三层快照（全局默认 + 项目覆盖，B2）：列表行字段与运行时投影共用。
    defaultSets: async (cwd?: string) => overridesRaw.defaultSets(cwd),
    // 磁盘技能名：全局默认必须对磁盘技能生效；投影前用它做存在性判定。
    diskNames: async (cwd?: string) => {
      try {
        return (await diskList(cwd)).filter((row) => row.shadowStub !== true).map((row) => row.name);
      } catch {
        return [];
      }
    },
    // v21：可见性 + 每工作区默认（与 mcp/tools 共用同一计算入口）。
    capabilityDefaults: (names: readonly string[], cwd?: string) =>
      overridesRaw.capabilityDefaultsMany("skills", names, cwd),
    // v21：可见性里出现过的技能名（运行时 gate 发现「不在默认名单但被隐藏」）。
    visibilityNames: () => overridesRaw.visibilityKeys("skills"),
    // 旧注入点保留（兼容直接构造本服务的外部调用方）。
    projectDisabled: async (cwd?: string) => (await overridesRaw.sets(cwd)).skills,
  });
  skillSessionsRef.current = skillSessions;
  deriveSkillSessionsRef.current = skillSessions;
  reconcileProjectRef.current = (cwd?: string) => skillSessions.reconcileProject(cwd);
  /**
   * 面板 `skills.list` 的组合视图：受管磁盘行 + 宿主 registry 注入行。
   *
   * v21：同时返回 `hiddenCount`（工作区视图里被可见性隐藏的技能数），并给每行
   * 附加可见性字段。registry 任何异常都降级为「仅磁盘行」，不影响面板其它功能
   * （架构契约 §5.7 失败降级矩阵）。
   */
  async function panelSkillRows(cwd?: string): Promise<{ skills: SkillSummaryView[]; hiddenCount: number }> {
    const diskRows = await diskList(cwd);
    // 默认值三层快照：行的 4 个默认态字段（契约 §2.2）按同一口径计算。
    const defaults = await overridesRaw.defaultSets(cwd);
    let merged: SkillSummaryView[];
    try {
      const injected = await skillsRegistry.merge({ cwd, diskRows, projectDisabled: defaults.projectDisabled });
      merged = [...diskRows, ...injected].sort((a, b) => a.name.localeCompare(b.name));
      // v21 修复：工作区作用域快照可能漏掉全局注入技能（插件 / preset 注入），
      // 再取一次全局快照（cwd=undefined）只补注入行，保证它们在每个工作区都出现。
      if (cwd !== undefined) {
        const globalInjected = await skillsRegistry
          .merge({ cwd: undefined, diskRows, projectDisabled: defaults.projectDisabled })
          .catch(() => [] as SkillSummaryView[]);
        merged = supplementInjectedRows(merged, globalInjected);
      }
    } catch {
      merged = diskRows;
    }
    const annotated = annotateSkillDefaults(merged, defaults);
    // v21：可见性 + 每工作区默认（一次批量读取）。
    const capabilities = await overridesRaw.capabilityDefaultsMany(
      "skills",
      annotated.map((row) => row.name),
      cwd,
    );
    const workspaceView = cwd !== undefined;
    let hiddenCount = 0;
    const skills: SkillSummaryView[] = [];
    for (const row of annotated) {
      const capability = capabilities.get(row.name);
      if (workspaceView && capability !== undefined && !capability.visible) {
        hiddenCount += 1;
        continue; // 工作区视图不展示不可见技能
      }
      skills.push({
        ...row,
        ...(capability !== undefined
          ? {
              // 覆盖旧 flags 的有效默认：工作区默认可能来自可见性 / 每工作区默认。
              effectiveDefaultEnabled: capability.effectiveDefaultEnabled,
              visibilityMode: capability.visibilityMode,
              visibleWorkspaceCount: capability.visibleWorkspaceCount,
              globalDefaultEnabled: capability.globalDefaultEnabled,
              workspaceDefaultEnabled: capability.workspaceDefaultEnabled,
              ...(capability.projectOverride !== undefined
                ? { projectDefaultEnabledByOverride: capability.projectOverride }
                : {}),
              ...(workspaceView ? { visibleInWorkspace: capability.visible } : {}),
            }
          : {}),
      });
    }
    return { skills, hiddenCount };
  }

  /** 兼容数组形态（宿主内部 / 旧调用方）：只丢 hiddenCount。 */
  async function mergePanelList(cwd?: string): Promise<SkillSummaryView[]> {
    return (await panelSkillRows(cwd)).skills;
  }
  // Jev 管理器：内部持有冷会话排队表与 agent/created|disposed 监听。service
  // 访问器延迟求值（jev 与 service 互相引用），disposer 随插件卸载清监听与
  // 内存队列（架构 §8.7）。
  const serviceRef: { current?: CapabilityPanelService } = {};
  const jev = createJevManager({
    ctx,
    dshHome: config.dshHome,
    service: () => serviceRef.current,
    logger: ctx.logger,
  });
  const service: CapabilityPanelService = {
    // 用对象展开装配（不原地改 skillsBase）：三个覆盖方法都基于 `diskList`
    // 这一份原始磁盘 list，避免装配顺序造成的自引用/无限递归。
    skills: {
      ...skillsBase,
      /** 面板列表 = 磁盘视图 + 宿主 registry 注入行（同名磁盘优先）。 */
      list: (cwd?: string): Promise<SkillSummaryView[]> => mergePanelList(cwd),
      /** v21 RPC `skills.list` 的新形态：`{skills, hiddenCount}`。 */
      listView: (cwd?: string) => panelSkillRows(cwd),
      sessionList: (cwd?: string, sessionId?: string) => skillSessions.list(diskList, cwd, sessionId),
      /** v21 RPC `skills.sessionList` 的新形态：`{skills, hiddenCount}`。 */
      sessionListView: (cwd?: string, sessionId?: string) => skillSessions.listView(diskList, cwd, sessionId),
      setSessionEnabled: skillSessions.setEnabled,
      setSessionEnabledBatch: skillSessions.setEnabledBatch,
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
        scanInjected: () =>
        [...scanInjectedMcpInstances(ctx, (namespace) => attribution.resolveNamespace(namespace)).values()],
      },
      loader,
      overrides,
      imports,
    ),
    overrides,
    jev,
    tools,
    session: {
      setBulk: (input: unknown) => {
        sessionBulkRef.current ??= createSessionBulk({
          ctx,
          state: sessionState,
          loader,
          service: () => serviceRef.current,
          logger: ctx.logger,
        });
        return sessionBulkRef.current.setBulk(input);
      },
      /**
       * 读取派生继承设置：`mode` 是本会话之后创建 child 时使用的模式；
       * `derived`（可选）是本会话作为派生会话时的创建快照。
       */
      deriveGet: async (input: unknown) => {
        const payload = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
        const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
        if (sessionId.length === 0) return { ok: false, errors: ["sessionId is required"] };
        await sessionState.ready();
        const derived = sessionState.derivedInfo(sessionId);
        return {
          ok: true,
          sessionId,
          mode: sessionState.deriveMode(sessionId),
          ...(derived !== undefined ? { derived } : {}),
        };
      },
      /** 设置本会话之后创建 child 时的继承模式。 */
      deriveSet: async (input: unknown) => {
        const payload = input !== null && typeof input === "object" ? (input as Record<string, unknown>) : {};
        const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
        if (sessionId.length === 0) return { ok: false, errors: ["sessionId is required"] };
        if (payload.mode !== "session" && payload.mode !== "workspace") {
          return { ok: false, errors: ['mode must be "session" or "workspace"'] };
        }
        await sessionState.ready();
        await sessionState.setDeriveMode(sessionId, payload.mode);
        return { ok: true, sessionId, mode: payload.mode };
      },
    },
    // Jev rank 的 question 需要「这个 MCP server 能做什么」：从全局工具注册表
    // 反推 `mcp__<serverName>__*`（name 取后缀、description 取 schema 描述）。
    // 只读；tools 服务缺失或任何异常都静默降级为 []（评分照常，只是缺 tools）。
    mcpTools: (serverName: string) => {
      try {
        const schemas = ctx.get?.("tools")?.schemas?.() ?? [];
        const prefix = `mcp__${serverName}__`;
        const tools: Array<{ name: string; description?: string }> = [];
        for (const schema of Array.isArray(schemas) ? schemas : []) {
          const fullName = typeof schema?.name === "string" ? schema.name : "";
          if (!fullName.startsWith(prefix)) continue;
          const name = fullName.slice(prefix.length);
          if (name.length === 0) continue;
          const description =
            typeof schema?.description === "string" && schema.description.length > 0 ? schema.description : undefined;
          tools.push(description !== undefined ? { name, description } : { name });
        }
        return tools;
      } catch {
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
  const offSessionDisposed =
    typeof ctx.on === "function" ? ctx.on("session/disposed", () => reconciler.noteDisposed()) : undefined;
  const offAgentDisposed =
    typeof ctx.on === "function" ? ctx.on("agent/disposed", () => reconciler.noteDisposed()) : undefined;
  // unit id 迁移（D2）：读时已归一（内存语义正确），这里做一次性写回 + 镜像；
  // 幂等、异步、失败只 warn，绝不阻塞 RPC。
  void toolsGlobal.migrateUnitIds().catch((error: unknown) => {
    ctx.logger?.warn?.(`capability-panel: tools-global.json unit id 迁移失败：${String(error)}`);
  });
  void sessionState.migrateToolsUnits().catch((error: unknown) => {
    ctx.logger?.warn?.(`capability-panel: session-capabilities.json tools unit id 迁移失败：${String(error)}`);
  });

  const disposers: Array<() => void> = [
    disposeUsageGuard,
    () => deriveInheritance.dispose(),
    () => skillsRegistry.dispose(),
    () => skillSessions.dispose(),
    () => tools.dispose(),
    () => toolsGlobal.dispose(),
    () => attribution.dispose(),
    () => jev.dispose(),
    () => reconciler.dispose(),
    () => sessionState.dispose(),
    ...(typeof offSessionDisposed === "function" ? [offSessionDisposed] : []),
    ...(typeof offAgentDisposed === "function" ? [offAgentDisposed] : []),
  ];
  if (config.mountRpc !== false) {
    const dispose = mountRpcChannel(ctx, service);
    if (typeof dispose === "function") disposers.push(dispose);
  }
  if (disposers.length > 0) {
    ctx.effect(() => () => {
      for (const dispose of disposers) dispose();
    }, "capability-panel: rpc channel");
  }
}

// ---------------------------------------------------------------------------
// 公开 API（re-export）：供宿主内其它插件按需引入，保持名字稳定。
// ---------------------------------------------------------------------------

export { createService, isGlobalSource } from "./skills/manager.js";
export { createSkillSessionRegistry } from "./skills/session.js";
export type { SkillSessionRegistry, SkillSessionDeps, SessionSkillView, SessionSkillOpResult } from "./skills/session.js";
export {
  createSkillRegistryBridge,
  isOwnShadow,
  SHADOW_DESCRIPTION,
  SHADOW_METADATA_KEY,
  PRESET_GLOBAL_TOGGLE_BLOCKED_REASON,
} from "./skills/registry.js";
export type {
  ClassifiedInjectedRow,
  HostSkillCatalogSnapshot,
  HostSkillDefinition,
  HostSkillSummary,
  HostSkillsService,
  InjectedMergeInput,
  RegistryNameVerdict,
  RegistryReadResult,
  SkillRegistryBridge,
  SkillRegistryBridgeDeps,
  SkillResourceResult,
} from "./skills/registry.js";
export { createMcpLoader } from "./mcp/loader.js";
export { createMcpManager } from "./mcp/manager.js";
export { scanInjectedMcpInstances, scanInjectedMcpEntries, scanInjectedMcpFibers, scanInjectedMcpNamespaces } from "./mcp/runtime.js";
export type { InjectedMcpInstance } from "./mcp/runtime.js";
export {
  createToolsManager,
  applyForAgent,
  effectiveEnabled,
  effectiveEnabledFor,
  TOOL_DESCRIPTION_LIMIT,
  TOOL_INSPECT_WARN_BYTES,
  LOCKED_RESTRICT_UNAVAILABLE,
} from "./tools/manager.js";
export type { ToolsManager, ToolsManagerDeps, ToolsLogger, ApplyForAgentResult } from "./tools/manager.js";
export { computeDenyNames, applyRestrict, sameDenyNames, TOOLS_RESTRICT_UNAVAILABLE, TOOLS_RESTRICT_NO_TOOLS } from "./tools/restrict.js";
export type { RestrictOutcome, ToolsRestrictionState } from "./tools/restrict.js";
export {
  UNATTRIBUTED_UNIT,
  UNATTRIBUTED_DISPLAY,
  PLUGIN_UNIT_KEY_PREFIX,
  TOOLS_DEFAULT_ENABLED,
  unitKeyOf,
  unitOfKey,
} from "./tools/types.js";
export { createToolsGlobalStore, toolsGlobalDir, toolsGlobalFile, TOOLS_GLOBAL_FILE_NAME, TOOLS_GLOBAL_VERSION } from "./tools/global-state.js";
export type { ToolsGlobalStore, ToolsGlobalStoreDeps, ToolsGlobalLogger, ToolsGlobalSetResult } from "./tools/global-state.js";
export type {
  HostToolBrief,
  ToolsUnitView,
  ToolsListView,
  ToolsSetSessionInput,
  ToolsSetSessionResult,
  ToolsInspectedTool,
  ToolsInspectInput,
  ToolsInspectView,
  ToolsInspectResult,
  ToolsSetGlobalInput,
  ToolsSetGlobalResult,
} from "./tools/types.js";
export { createSessionBulk } from "./session-bulk.js";
export type {
  SessionBulk,
  SessionBulkAction,
  SessionBulkDeps,
  SessionBulkDomain,
  SessionBulkDomainStat,
  SessionBulkFailure,
  SessionBulkInput,
  SessionBulkResult,
  SessionBulkServices,
} from "./session-bulk.js";
export {
  TOOL_RULES,
  MCP_NAMESPACE_RULES,
  RESTRICT_FORBIDDEN_TOOL_NAMES,
  attributeTool,
  attributeMcpNamespace,
  displayNameOfSource,
  isHostBuiltinTool,
  isRestrictForbiddenToolName,
} from "./shared/plugin-attribution.js";
export type { ToolRule, McpNamespaceRule } from "./shared/plugin-attribution.js";
export {
  createSessionState,
  sessionStateDir,
  sessionStateFile,
  SESSION_STATE_FILE_NAME,
  SESSION_STATE_GRACE_MS,
} from "./session-state.js";
export { createSessionStateReconciler } from "./session-state-reconcile.js";
export type {
  SessionStateEntry,
  SessionStateReconcileInput,
  SessionStateReconcileResult,
  SessionStateStore,
} from "./session-state.js";
export type { SessionStateReconciler, SessionStateReconcilerDeps } from "./session-state-reconcile.js";
export { createOverridesManager } from "./overrides/manager.js";
export type { OverrideToggleInput, OverrideOpResult } from "./overrides/manager.js";
export { createJevManager } from "./jev/manager.js";
export type { JevManager, JevManagerDeps } from "./jev/manager.js";
export {
  readJevConfig,
  setJevConfig,
  validateJevConfig,
  resolveJevKey,
  toJevConfigView,
  redact,
} from "./jev/config-file.js";
export { jevConfigDir, jevConfigFile } from "./jev/paths.js";
export { defaultJevConfig } from "./jev/types.js";
export type {
  JevConfig,
  JevConfigInput,
  JevConfigView,
  JevRankItem,
  JevRankResult,
  JevApplyResult,
  JevTestResult,
} from "./jev/types.js";
export { mountRpcChannel, handleEndpoint, CHANNEL } from "./remote.js";
export { findProjectRoot } from "./shared/project-root.js";
export { globalSkillsDir, projectSkillsDir, userAgentsSkillsDir } from "./skills/roots.js";
export {
  projectOverridesFile,
  OVERRIDES_FILE_NAME,
  overridesStoreFile,
  OVERRIDES_STORE_FILE_NAME,
  globalOverridesFile,
  GLOBAL_OVERRIDES_FILE_NAME,
} from "./overrides/paths.js";
export {
  readOverrides,
  writeOverrides,
  readOverridesStore,
  writeOverridesStore,
  normalizeOverridesSet,
  DOMAIN_KEYS,
  OVERRIDES_STORE_VERSION,
} from "./overrides/config-file.js";
export {
  readGlobalOverrides,
  readGlobalOverridesDocument,
  writeGlobalOverrides,
  emptyGlobalOverrides,
  GLOBAL_OVERRIDES_VERSION,
  GLOBAL_OVERRIDES_LEGACY_VERSION,
} from "./overrides/global-file.js";
export type { GlobalOverridesReadResult } from "./overrides/global-file.js";
export {
  VISIBILITY_DOMAINS,
  INVISIBLE_CAPABILITY_ERROR,
  emptyVisibilitySets,
  emptyCapabilityVisibility,
  normalizeMode,
  normalizeWorkspaceVisibility,
  normalizeCapabilityVisibility,
  normalizeVisibilitySets,
  visibilityEntryOf,
  visibilityModeOf,
  visibleWorkspaceCount,
  workspaceMatchKey,
  visibleIn,
  perWorkspaceDefault,
  isGloballyDisabled,
  invisibleKeysForWorkspace,
} from "./shared/visibility.js";
export type {
  VisibilityDomain,
  VisibilityMode,
  VisibilitySets,
  CapabilityVisibility,
  WorkspaceVisibility,
  WorkspaceTarget,
} from "./shared/visibility.js";
export {
  skillDefaultSets,
  effectiveDisabledSkills,
  skillDefaultFlags,
  annotateSkillDefaults,
  EMPTY_SKILL_DEFAULT_SETS,
} from "./shared/skill-defaults.js";
export type { SkillDefaultSets, SkillDefaultFlags } from "./shared/skill-defaults.js";
export {
  mcpDefaultSets,
  emptyMcpDefaultSets,
  mcpDefaultEnabled,
} from "./shared/mcp-defaults.js";
export type { McpDefaultSets } from "./shared/mcp-defaults.js";
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
export type {
  SkillSummaryView,
  SkillSpec,
  SkillFormat,
  WritableScope,
  InvocationPolicy,
  InjectedSkillFields,
  RegistryResourceBaseKind,
  SkillOrigin,
  SkillSource,
} from "./skills/types.js";
export type { McpScope, McpServerEntry, McpServerView, McpListResult, McpStatusView, McpMountState } from "./mcp/types.js";
export type {
  CapabilityDefaults,
  CapabilityDomain,
  CapabilityOverrides,
  GlobalOverrideToggleInput,
  GlobalVisibilityInput,
  GlobalOverrides,
  GlobalOverridesFile,
  GlobalOverridesView,
  OverridesProjectEntry,
  OverridesSet,
  OverridesStore,
  OverridesView,
  VisibilityConflict,
  VisibilitySetResult,
} from "./overrides/types.js";
export type { OverridesManager } from "./overrides/manager.js";

/**
 * Cordis 以 `module.default || module` 解析插件包。这里提供默认导出
 * （{ name, inject, apply }），让 profile patch 能按包名挂载
 * （`dsh-capability-settings`，见 cordis.patch.yml）。
 */
export default { name, inject, apply };