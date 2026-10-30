/**
 * MCP 自动挂载器：**全局单例 + 项目级每会话隔离**。
 *
 * 分两层挂载，分别对应两类配置来源：
 *
 *   - **全局层（单例，全应用共用）**：`<agentsHome>/mcp.json`（兼容旧位置
 *     dsh home / `~/.claude`）里 `disabled !== true` 的条目，挂在**本插件
 *     自己的 ctx** 上（`ctx.plugin(mcpClient, config)`）。桥接层按注册作用域
 *     预留 `serverName`（`scopeOf(ctx) ?? ctx.root`，见
 *     {@link createMcpClientResolver} 注释），本插件 ctx 没有 agent scope
 *     标记 → owner 是 `ctx.root`，所以同一 `serverName` 全应用只会有一份
 *     实例：不管有多少 session、不管它们是否已经创建，都用同一个进程/连接。
 *     配置变化时先 dispose 旧一代、再挂新一代，由全局队列串行化。
 *
 *   - **项目层（每会话一份）**：挂在 `agent.ctx` 上（owner 是该 agent 的
 *     scope，天然按会话隔离），只包含：
 *       1. `<项目根>/.mcp.json` 里 `disabled !== true` 的**原生**条目；
 *       2. 项目级**启用态引用**且其全局条目自身 `disabled === true` 的条目
 *          ——引用是显式的项目级选用，全局层不会挂它，只能在本项目里跑。
 *     其余启用态引用不必在会话内再挂：全局层已经提供了同一份实例。
 *     项目原生条目与全局同名条目**同时**存在：工具注册表契约是
 *     「Scoped registrations shadow globals」，scoped 注册遮蔽全局注册，
 *     所以本项目的 session 看到项目那份、其他项目看到全局那份，不需要刻意
 *     跳过全局挂载（旧实现靠"合并后只挂一份"达到同样效果，但会让每个
 *     session 各起一个进程）。
 *
 * ## 为什么必须有 restrict
 *
 * 「本项目禁用某个全局 server」（`overrides.sets(cwd).mcp`、项目原生条目的
 * `disabled`、禁用态引用）旧实现靠**不挂载**实现；全局层变成共享单例后无法
 * 按项目卸载，于是改成按 session 屏蔽：`agent.ctx.get("tools").restrict({
 * deny: [该 server 的全部全局工具名] })`。契约原文（dsh-tools 的 tools 服务）
 * 是「Restrict global tools for the calling agent scope. … Restrictions
 * intersect; scoped registrations remain visible.」——restrict 只过滤该作用域
 * **继承**到的那一层，本 session 自己的 scoped 注册仍然可见，这正是
 * 「项目禁用全局原版」与「项目原生条目照常可用」需要的语义。
 *
 * 三条硬约束（契约规定违反即抛错，抛错绝不能让 session 挂载整体失败）：
 *
 *   - 工具名只能是**全局层当前已注册**的名字：从 `ctx.root.get("tools")
 *     .schemas()`（全局视图，天然不含 scoped 注册）按 `mcp__<serverName>__`
 *     前缀过滤取；空名单直接不调用；
 *   - `restrict` 必须由 `agent.ctx` 上的 tools 服务调用（`scopeOf(ctx)` 必须
 *     有值，否则报 "requires a scoped context"）；
 *   - 任何失败（宿主没提供 restrict、名单为空、restrict 抛错）都降级为
 *     warning + 状态视图标注（见 {@link McpRestrictionView}），不影响挂载。
 *
 * ## 状态视图
 *
 * `status(cwd?)` 在原来的 session 记录之外，额外返回一条全局层哨兵记录
 * （`sessionId === GLOBAL_MOUNT_SESSION_ID`，`scope: "global"`），保证面板里
 * 全局 server 不再永远显示"未挂载"；新字段全部可选，客户端
 * `aggregateMounts` 只读 `servers[].{key,serverName,state,error}`，形状不变。
 * 传入 cwd 时，该项目里已被 restrict **生效**屏蔽的全局键会从哨兵记录里剔除，
 * 避免面板把"本项目禁用"的全局 server 显示成"已挂载"；不传 cwd 时看到完整
 * 全局层。
 *
 * @module dsh-capability-settings/mcp/loader
 */

import { locateConfigFile } from "../shared/config-location.js";
import { errMessage } from "../shared/errors.js";
import { findProjectRoot } from "../shared/project-root.js";
import { readMcpFile, sanitizeServerName, toClientConfig } from "./config-file.js";
import { GLOBAL_MCP_FILE_NAME, globalMcpDirs, projectMcpFile } from "./paths.js";
import type { OverridesManager } from "../overrides/manager.js";
import type { ImportsManager } from "../imports/manager.js";
import type { SessionStateStore } from "../session-state.js";
import type { McpRestrictionView, McpServerEntry, McpStatusView } from "./types.js";

/**
 * 全局层在状态视图里的哨兵 sessionId（不是真实 session）。`*` 不在任何
 * session id 的字符集里，不会与真实记录相撞。
 */
export const GLOBAL_MOUNT_SESSION_ID = "*global*";

/** 挂载器的构造依赖。 */
export interface McpLoaderDeps {
  dshHome?: string;
  agentsHome?: string;
  /** 为 false 时不挂载任何 server（状态保持为空）。缺省 true。 */
  enabled?: boolean;
  /**
   * 项目级"全局能力禁用"管理器：全局层是共享单例、不能按项目卸载，所以被
   * 本项目禁用的全局 server 仍然挂载，但会在该项目各 session 上用
   * `tools.restrict` 屏蔽其全局工具（见模块头注释）。
   */
  overrides?: OverridesManager;
  /** 项目级「全局能力引用」管理器：启用态引用参与项目层挂载判定。 */
  imports?: ImportsManager;
  /**
   * 会话级开关的持久化存储（可选）。
   *
   * 提供时：`setSessionEnabled` 会把显式开关按 sessionId 落盘，并在 agent
   * 重建 / 宿主重启后由 {@link remount} 恢复（见 `session-state.ts`）；
   * 省略时保持旧的纯内存行为（headless / 旧装配）。
   */
  state?: SessionStateStore;
}

/** 一条 server 在一个 session（或全局层）内的挂载记录。 */
interface MountState {
  key: string;
  serverName: string;
  state: "mounted" | "failed" | "conflict";
  error?: string;
}

/** 一条已挂载 fiber 的释放句柄。 */
interface MountedFiber {
  dispose(): Promise<void>;
}

/** 本 session 需要屏蔽的全局 server：key + 该 key 在全局层的 serverName。 */
interface RestrictTarget {
  key: string;
  serverName: string;
}

/** 一个 session 的完整挂载簿记。 */
interface SessionRecord {
  agent: any;
  /** session 的工作目录（来自 session.header.cwd）。 */
  cwd?: string;
  /** 由 cwd 推导的项目根。 */
  projectRoot?: string;
  /** 当前这一代已挂载的 fiber（dispose 时逐个释放）。 */
  fibers: MountedFiber[];
  /** 当前这一代 restrict 的 disposer（换代时随旧一代一起释放）。 */
  restrictDisposers: Array<() => void>;
  /** 本代挂载结果（供状态视图读取）。 */
  mounts: MountState[];
  /** 本代「按会话屏蔽全局 server」的结果（供状态视图读取）。 */
  restrictions: McpRestrictionView[];
  /** 本代实际提交给 restrict 的工具名（用于幂等判断，名单没变就不重复调用）。 */
  appliedDeny: string[];
  /** 本代需要屏蔽的全局 server（由配置解析得出，换代时重算）。 */
  restrictTargets: RestrictTarget[];
  /** 降级 warning 只打一次，避免 tools/change 刷新刷屏。 */
  restrictWarned?: boolean;
  /**
   * 本代已生效的「服务器指令段」影子：serverName → disposer。
   *
   * 增量维护（不是"一代全量重建"）：`tools/change` / 全局换代时只增补新目标、
   * 只释放失效目标；换代（remount 前）才整表 dispose。
   */
  promptShadows: Map<string, () => void>;
  /**
   * 本代注册失败过的 serverName → 上次失败文案。
   *
   * 失败通常来自"外部按会话注入的实例已占用同名段"：这种目标会一直失败，
   * 但重试是廉价的，所以每次 refresh 都静默重试（成功即转为影子）；只有失败
   * 文案变化才再打一次 warning，避免 `tools/change` 刷屏。
   */
  promptShadowFailures: Map<string, string>;
  /** 宿主没有 systemPrompt.section 时只告警一次。 */
  promptWarned?: boolean;
  /**
   * 要从宿主资源清单段（`mcp-resource-servers`）里剔除的 serverName。
   *
   * 与 `restrictTargets` 同源，但**不加** root 侧证据过滤：只要名字出现在
   * 宿主清单里就说明有 resource provider，能剔除就剔除。每代由
   * `applyPromptShadows` 重算，装配钩子只读不写。
   */
  resourceListHidden: Set<string>;
  /** 资源清单过滤器注册失败/宿主不支持时只告警一次。 */
  resourceFilterWarned?: boolean;
  /** 重挂队列：串行化 reload，避免与 agent 初始化交错。 */
  queue: Promise<void>;
}

/** 挂载器对外接口：读状态 + 触发重挂。 */
export interface McpLoader {
  /** 实时挂载视图；传 cwd 时只返回该项目根下的 session（外加全局层哨兵）。 */
  status(cwd?: string): McpStatusView[];
  /** 重新读配置并重挂匹配的 session（省略 projectRoot 时全局层 + 全部 session）。 */
  reload(projectRoot?: string): Promise<void>;
  /**
   * 设置某个 session 的手动开关（**按会话落盘**；无 `state` 依赖时仅内存）。
   *
   * - `kind: "project"` + `target: configKey`：项目 `.mcp.json` 条目 → 按需挂载/卸载；
   * - `kind: "server"` + `target: serverName`：全局配置条目或外部注入实例 → 用
   *   `tools.restrict` 屏蔽/恢复其全局工具（共享实例不卸载）。
   * - `enabled === undefined`：清掉显式覆盖、重新跟随项目默认（面板「默认」开关）。
   */
  setSessionEnabled(input: {
    sessionId: string;
    cwd?: string;
    target: string;
    kind: "project" | "server";
    enabled: boolean | undefined;
  }): Promise<void>;
  /**
   * **批量**设置某个 session 的手动开关（R1 `session.setBulk` 用）。
   *
   * 语义与单条 `setSessionEnabled` 完全一致，但：一次 hydrate → 写全部 toggle
   * （`state.setToggles` 一次落盘）→ **一次** `scheduleRemount`。现状逐条调用会
   * 排队 N 次重挂（150 条量级不可接受），批量端点必须走这个方法。
   */
  setSessionEnabledMany(input: {
    sessionId: string;
    cwd?: string;
    entries: Array<{ target: string; kind: "project" | "server"; enabled: boolean | undefined }>;
  }): Promise<void>;
  /** 该 session 的显式开关快照（键带 `project:` / `server:` 前缀）。 */
  sessionToggleState(sessionId?: string): Record<string, boolean>;
  /** 读取前主动从磁盘恢复该 session 的显式开关（幂等；冷会话面板用）。 */
  hydrateSession(sessionId: string, meta?: { cwd?: string; headerCreatedAt?: number }): Promise<void>;
}

/**
 * 全局层 serverName 与 Host 根作用域其它 mcp-client 实例冲突时的友好文案。
 *
 * 这是安全网而非必然结果：`~/.dsh/profiles/desktop` 的 cordis.patch.yml
 * **没有** root 级 mcp-client 条目（实测 `grep -c dsh-mcp-client` = 0），
 * 全局条目都归本插件挂载；但其它 profile 会（例如 `profiles/web` 的
 * cordis.patch.yml 用 `insert:` 插了 mcp-AnySearch / mcp-tavily /
 * mcp-mobile-next / mcp-context7 / mcp-github 共 5 条），此时同名 serverName
 * 由那份
 * root 级实例持有，本插件不再重复挂载——工具仍然可用，但**面板里对该键的
 * 编辑不会生效**（真正生效的是 profile 的那份配置）。
 */
const GLOBAL_CONFLICT_NOTE =
  "同一 serverName 已由 Host 根作用域的其它 mcp-client 实例占用（例如 profile 的 cordis.patch.yml 里 root 级插入的 MCP 条目），本插件不再重复挂载：工具仍由那份实例提供，但面板里对该条目的修改不会生效";

/** 项目层 serverName 冲突（同一作用域内已有实例）时的友好文案。 */
const SESSION_CONFLICT_NOTE =
  "同一 serverName 已被本会话（或本会话所在作用域）的其它 mcp-client 实例占用，本插件不重复挂载";

/** 宿主未提供 tools.restrict 时的降级说明。 */
const RESTRICT_UNAVAILABLE =
  "宿主 tools 服务未提供 restrict()，无法在本会话屏蔽全局 server（全局工具对本会话可见）";

/** 全局层尚无该 server 的已注册工具时的降级说明。 */
const RESTRICT_NO_GLOBAL_TOOLS =
  "该 server 当前没有已注册的全局工具（可能尚未连接），本次未调用 restrict";

/**
 * MCP 桥接层注册「服务器指令」系统提示词段的段名前缀。
 *
 * 见宿主 `@deepseek-ai/dsh-mcp-client` 的 `registerServerContext()`：
 * `name: \`mcp:${server}\``，`order: getSectionOrder("MCP_SERVERS")`。
 * `server` 就是桥接配置里的 `serverName`（本项目由
 * {@link sanitizeServerName} 从配置键推出），所以会话内屏蔽的 serverName
 * 与段名一一对应。
 */
const MCP_INSTRUCTION_SECTION_PREFIX = "mcp:";

/**
 * `MCP_SERVERS` 段的兜底顺序（dsh-system-prompt 0.2.1-rc.3 的
 * `SECTION_ORDERS.MCP_SERVERS = 3100`；0.1.2-alpha.2 的顺序表里没有该键、
 * 0.1.0-rc.6 连 `getSectionOrder` 都没有，所以必须有兜底）。
 *
 * 宿主提供 `getSectionOrder` 时优先用宿主值；老宿主/精简装配缺少顺序表时
 * 用该常量兜底——空文本影子段的顺序只影响它在被遮蔽段位置上的排序占位，
 * 不影响遮蔽语义。
 */
const MCP_SERVERS_SECTION_ORDER = 3100;

/**
 * `dsh-mcp-resources` 注册的「资源服务器名清单」系统提示词段名。
 *
 * 见宿主 `@deepseek-ai/dsh-mcp-resources` 的 `McpResourceRuntime` 构造：
 * `name: "mcp-resource-servers"`，文本为
 * `## MCP resource servers\n\nUse list_mcp_resources, … server argument: ["a","b"].`
 * 名字来自资源 provider 注册表的 `layers.merge(scope)`——全局 provider 在全局层，
 * 所以被本会话关掉的 server 名仍会出现；它不归本插件所有，只能做文本剔除
 * （见 `filterResourceListNames`），不属于本插件的 MCP 指令段影子（那类段名是
 * `mcp:<serverName>`）。
 */
const RESOURCE_SERVERS_SECTION = "mcp-resource-servers";

/**
 * 资源清单段里名单的锚点正则（宿主 0.2.1-rc.3 实测格式：
 * `… server argument: ["a","b"].`，名单是单行 JSON 数组、位于段尾）。
 *
 * 用 `s` 标志让前缀跨行为空；解析失败一律 fail-open（原样返回，不让宿主改文案
 * 变成装配失败）。
 */
const RESOURCE_LIST_PATTERN = /^(.*server argument:\s*)(\[[\s\S]*\])(\.?\s*)$/s;

/**
 * 解析要挂载的 MCP 桥接插件实例（懒加载 + 缓存一次）。
 *
 * **必须优先用宿主自己的那份** `@deepseek-ai/dsh-mcp-client`：桥接层按
 * 「注册作用域」预留 `serverName`
 * （`const owner = scopeOf(ctx) ?? ctx.root`，两份副本的源码表达式**相同**，
 * 已对 0.2.0-rc.1 的 lib/index.js 逐字核对），挂在 `agent.ctx` 上时 owner
 * 才是该 agent 的 scope，各会话才能各自挂同名 server。
 *
 * 关键在于 `scopeOf()` 读的是宿主打在 agent ctx 上的 scope tag，而那份 tag
 * 的键是 `@deepseek-ai/dsh-scope` 里的 `kScope = Symbol("dsh.scope")`——
 * 普通 `Symbol` 而非 `Symbol.for`，**每份模块实例各有一个**。本插件
 * `dependencies` 里的副本走的是自己的 pnpm 目录（`dsh-scope` 是另一个模块
 * 实例），`scopeOf()` 永远读不到宿主的 tag，于是恒回落 `ctx.root`：项目层
 * 会退化成「全应用只允许一个 session 挂同名 server」，第二个同 cwd 的
 * session 直接 `already in use`。升级依赖版本解决不了这件事（实测
 * `node_modules/.pnpm/@deepseek-ai+dsh-scope@0.2.0-rc.1_<peerhash>/…`
 * 下的 `lib/index.js` 里就是 `kScope = Symbol("dsh.scope")`）。
 *
 * 因此按包名向宿主的 loader 取实例（加载本插件用的就是它，解析基准是
 * profile 目录）；宿主没有 loader 时（headless 等）才回落到自带副本——那时
 * 项目级的每会话隔离会按上面所述降级（不可用）。
 */
function createMcpClientResolver(ctx: any): () => Promise<any> {
  let resolved: Promise<any> | undefined;
  return () => {
    resolved ??= (async () => {
      const loader = ctx.get?.("loader");
      if (typeof loader?.import === "function") {
        try {
          const mod = await loader.import("@deepseek-ai/dsh-mcp-client");
          if (mod !== null && mod !== undefined) {
            return typeof loader.unwrapExports === "function" ? loader.unwrapExports(mod) : mod;
          }
        } catch (error) {
          ctx.logger?.warn?.(`capability-panel: host mcp-client unavailable (${errMessage(error)}); falling back to the bundled copy`);
        }
      }
      return await import("@deepseek-ai/dsh-mcp-client");
    })();
    return resolved;
  };
}

/** 创建挂载器：注册 agent 生命周期监听 + 全局层首轮挂载 + 存量 agent 补挂。 */
export function createMcpLoader(ctx: any, deps: McpLoaderDeps = {}): McpLoader {
  const sessions = new Map<string, SessionRecord>();
  /**
   * 每个 session 的**手动开关覆盖**（内存内，随 agent 销毁/宿主重启失效）。
   *
   * 键统一加前缀区分两类目标：
   *  - `project:<configKey>`：项目 `.mcp.json` 里的条目（每会话独立挂载的那类）；
   *  - `server:<serverName>`：全局配置条目与外部注入实例（共享实例，靠
   *    `tools.restrict` 按会话屏蔽工具，不卸载实例）。
   *
   * 值 = 显式启用/禁用；**未设置时跟随项目级默认**（面板里的「默认」开关，
   * 存在 `.agents/capability-overrides.json` 的 mcp 列表）。这样"新建对话按默认，
   * 当前对话可手动调整"两件事分别由默认与这里决定。
   */
  const sessionToggles = new Map<string, Map<string, boolean>>();
  /** 项目条目的开关键。 */
  const projectToggleKey = (key: string): string => `project:${key}`;
  /** 全局/外部实例的开关键（按 serverName）。 */
  const serverToggleKey = (serverName: string): string => `server:${serverName}`;

  /** 读某个 session 的显式开关（未设置返回 undefined = 跟随默认）。 */
  function sessionToggle(sessionId: string | undefined, toggleKey: string): boolean | undefined {
    if (sessionId === undefined) return undefined;
    return sessionToggles.get(sessionId)?.get(toggleKey);
  }

  /**
   * 已从磁盘恢复过开关的 session（每个 session 只 hydrate 一次）。
   *
   * agent 销毁时清标记：重开的会话重新按磁盘恢复——磁盘是权威，内存里的
   * 改动在 `setSessionEnabled` 里已即时落盘。**不清磁盘记录**（宿主重启后
   * 还要靠它恢复）。
   */
  const hydratedSessions = new Set<string>();

  /** 会话 header 的创建时间（防 sessionId 复用；取不到就不带）。 */
  function headerCreatedAtOf(agent: any): number | undefined {
    const value = agent?.session?.header?.createdAt;
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  /** 会话记录 → 落盘元数据（cwd 仅诊断、headerCreatedAt 防 id 复用）。 */
  function metaOf(record: SessionRecord | undefined): { cwd?: string; headerCreatedAt?: number } {
    const meta: { cwd?: string; headerCreatedAt?: number } = {};
    if (record?.cwd !== undefined) meta.cwd = record.cwd;
    const createdAt = headerCreatedAtOf(record?.agent);
    if (createdAt !== undefined) meta.headerCreatedAt = createdAt;
    return meta;
  }

  /**
   * 从持久化存储恢复某 session 的显式开关（幂等；每个 session 一次）。
   *
   * 内存里已有的键优先：同一运行内用户刚改过的开关不被磁盘旧值覆盖。
   * 读取前先 `await state.ready()`，失败降级为空（跟随项目默认，不阻断挂载）。
   */
  async function hydrateToggles(
    sessionId: string | undefined,
    meta: { cwd?: string; headerCreatedAt?: number } = {},
  ): Promise<void> {
    const state = deps.state;
    if (state === undefined || sessionId === undefined || hydratedSessions.has(sessionId)) return;
    await state.ready();
    hydratedSessions.add(sessionId);
    // sessionId 复用（header 创建时间不一致）⇒ 旧记录已作废。
    if (!state.verifySession(sessionId, meta)) return;
    const stored = state.mcp(sessionId);
    const keys = Object.keys(stored);
    if (keys.length === 0) return;
    let toggles = sessionToggles.get(sessionId);
    if (toggles === undefined) {
      toggles = new Map<string, boolean>();
      sessionToggles.set(sessionId, toggles);
    }
    for (const key of keys) {
      if (!toggles.has(key)) toggles.set(key, stored[key]);
    }
  }
  const enabled = deps.enabled !== false;

  const logger = ctx.logger ?? console;
  const mcpClient = createMcpClientResolver(ctx);

  /** 全局层当前这一代的 fiber 与挂载结果（全应用共享，不属于任何 session）。 */
  let globalFibers: MountedFiber[] = [];
  let globalMounts: MountState[] = [];
  /**
   * 正在重挂的代数计数（> 0 ⇒ `status().settling === true`）。
   *
   * 写入路径（`manager.reloadFor`）**不再等待**重挂完成，所以 RPC 返回后挂载
   * 状态可能还在后台换代；面板据此短暂轮询，让"已挂载/未挂载"在几秒内自行
   * 收敛，而不是让"保存/删除/启停"卡住数秒（见 manager 里 reloadFor 的注释）。
   */
  let settling = 0;
  /** 全局层重挂队列：配置变化时串行换代，避免新旧两代同 serverName 相撞。 */
  let globalQueue: Promise<void> = Promise.resolve();

  /**
   * 全局层 stdio 条目的 fallback 工作目录。全局层是全应用单例，没有"当前
   * 项目"，只能用宿主进程目录。旧实现按每个 session 的项目根各起一份进程，
   * 因此全局条目未显式写 `cwd` 时，其工作目录从"各会话的项目根"变成"宿主
   * 进程目录"（条目自己写了 `cwd` 时不受影响）。
   */
  const globalFallbackCwd = process.cwd();

  /** 读取全局 MCP 文件；读失败只记 warn，返回空表。 */
  async function readGlobalServers(): Promise<Record<string, McpServerEntry>> {
    // 全局配置读取生效位置（.agents 首选，兼容旧位置 dsh home / ~/.claude）。
    const globalFile = locateConfigFile(globalMcpDirs(deps), GLOBAL_MCP_FILE_NAME).readFile;
    try {
      return await readMcpFile(globalFile);
    } catch (error) {
      logger.warn?.(`capability-panel: ${errMessage(error)}`);
      return Object.create(null) as Record<string, McpServerEntry>;
    }
  }

  /** 全局层要挂的条目：全局文件里 `disabled !== true` 的全部条目。 */
  async function resolveGlobalEntries(): Promise<Array<{ key: string; entry: McpServerEntry }>> {
    const servers = await readGlobalServers();
    return Object.entries(servers)
      .filter(([, entry]) => entry.disabled !== true)
      .map(([key, entry]) => ({ key, entry }));
  }

  /**
   * 为某个 session 解析**项目层**要挂的条目 + 要屏蔽的全局 server：
   *
   *   - 项目原生条目（`disabled !== true`）→ 会话内挂载（与全局同名时靠
   *     scoped shadow 生效）；原生条目 `disabled` → 不挂载，且若全局层有
   *     同名启用条目，则在本会话屏蔽它（旧实现里项目条目覆盖了全局条目，
   *     等于本项目内全部不挂载）；
   *   - 引用（`.agents/capability-imports.json`）：悬空引用忽略；有同名项目
   *     原生条目时原生优先（引用不参与）；禁用态引用 → 屏蔽全局同名条目；
   *     启用态引用 → 全局层已提供则不重复挂，只有全局条目自身
   *     `disabled === true`（全局层不挂）时在会话内补挂；
   *   - `overrides.sets(cwd).mcp` 列出的键 → 本项目禁用的全局 server，屏蔽。
   *
   * 单个文件读失败只记 warn，不中断另一个文件。
   */
  async function resolveSessionPlan(cwd: string | undefined, sessionId?: string): Promise<{
    session: Array<{ key: string; entry: McpServerEntry }>;
    restrict: RestrictTarget[];
  }> {
    // 项目级禁用的全局 server 键集合（无 cwd 或读取失败时为空集合）。
    const disabledByProject = new Set((await deps.overrides?.sets(cwd))?.mcp ?? []);
    // 三个来源并行解析；单个失败只记 warn。
    const refsPromise: Promise<Record<string, { disabled?: boolean }>> =
      cwd !== undefined && deps.imports !== undefined
        ? deps.imports.entries(cwd, "mcp")
        : Promise.resolve({} as Record<string, { disabled?: boolean }>);
    const [globalServers, projectServers, refs] = await Promise.all([
      readGlobalServers(),
      cwd !== undefined
        ? readMcpFile(projectMcpFile(cwd)).catch((error) => {
            logger.warn?.(`capability-panel: ${errMessage(error)}`);
            return Object.create(null) as Record<string, McpServerEntry>;
          })
        : Promise.resolve(Object.create(null) as Record<string, McpServerEntry>),
      refsPromise,
    ]);
    /** 全局层是否真的会挂这个 key（`disabled !== true`）。 */
    const globalEnabled = (key: string): boolean => Object.hasOwn(globalServers, key) && globalServers[key].disabled !== true;
    const session: Array<{ key: string; entry: McpServerEntry }> = [];
    const restrict = new Map<string, RestrictTarget>();
    /**
     * 登记一条"本项目屏蔽全局 server"。
     *
     * - 配置文件里的 key：只有全局层真挂了才需要屏蔽（原逻辑）。
     * - `externalCandidate`：overrides 里的键也可能指向**运行时注入**的实例（不在
     *   我们的全局文件里，例如别的插件挂的 `figma`）。这类也要登记为候选，
     *   `applyRestrictions` 会按 `mcp__<serverName>__*` 去全局工具视图找名字——
     *   找不到就自动降级成 skipped（契约规定空 filter 会失败），不会误调用。
     */
    const restrictKey = (key: string, externalCandidate = false): void => {
      if (!globalEnabled(key) && !externalCandidate) return;
      restrict.set(key, { key, serverName: sanitizeServerName(key) });
    };
    /**
     * 项目条目的「本会话是否启用」：
     * 文件里 `disabled: true` = 硬关闭（忽略会话开关）；否则
     * 显式 session 开关 > 项目级默认（overrides 里列了 = 默认关闭）。
     */
    const projectEntryEnabled = (key: string): boolean => {
      const explicit = sessionToggle(sessionId, projectToggleKey(key));
      return explicit ?? !disabledByProject.has(key);
    };
    for (const [key, entry] of Object.entries(projectServers)) {
      if (entry.disabled === true) {
        restrictKey(key);
        continue;
      }
      if (projectEntryEnabled(key)) session.push({ key, entry });
      // 项目条目被关掉时：如果全局层有同名 server，它本来被本条遮蔽，现在会露出来
      // → 同步屏蔽掉全局那份，语义才是"这个 MCP 在本会话里关着"。
      else restrictKey(key);
    }
    for (const [key, ref] of Object.entries(refs)) {
      // 同名项目原生条目恒优先（与 manager.list 的口径一致）。
      if (Object.hasOwn(projectServers, key)) continue;
      // 悬空引用（全局条目已删）忽略。
      if (!Object.hasOwn(globalServers, key)) continue;
      if (ref.disabled === true) {
        restrictKey(key);
        continue;
      }
      // 引用也是项目级条目：受"默认/会话开关"管理（关掉 = 屏蔽全局那份）。
      const refExplicit = sessionToggle(sessionId, projectToggleKey(key));
      if (refExplicit === false || (refExplicit === undefined && disabledByProject.has(key))) {
        restrictKey(key);
        continue;
      }
      // 启用态引用：全局层已提供同一实例，不必在会话内重复挂；只有全局条目
      // 自身 `disabled: true`（全局层不会挂它）时才在会话内补挂。
      if (globalServers[key].disabled === true) session.push({ key, entry: globalServers[key] });
    }
    // 全局配置条目 + 外部注入实例：候选 = 项目默认关闭的键 ∪ 本会话显式开关过的键。
    // 生效规则：显式会话开关 > 项目级默认；关掉即用 tools.restrict 屏蔽其全局工具
    // （共享实例不卸载；按 agent 作用域注入的实例 restrict 会失败→降级 skipped）。
    const serverCandidates = new Map<string, string>(); // serverName → 展示用 key（config key 优先）
    for (const key of disabledByProject) {
      // 项目原生条目（且全局没有同名）由"是否在会话内挂载"控制，不是全局/外部实例，
      // 不能当成 server 屏蔽候选——否则会平白产生一条 skipped 记录。
      if (Object.hasOwn(projectServers, key) && !globalEnabled(key) && !Object.hasOwn(refs, key)) continue;
      serverCandidates.set(sanitizeServerName(key), key);
    }
    for (const [toggleKey] of sessionToggles.get(sessionId ?? "") ?? []) {
      if (!toggleKey.startsWith("server:")) continue;
      const serverName = toggleKey.slice("server:".length);
      if (!serverCandidates.has(serverName)) serverCandidates.set(serverName, serverName);
    }
    for (const [serverName, key] of serverCandidates) {
      const explicit = sessionToggle(sessionId, serverToggleKey(serverName));
      if (explicit !== undefined) {
        if (!explicit) restrict.set(key, { key, serverName });
        continue;
      }
      // 未显式设置 ⇒ 跟随项目默认：只有"项目默认关闭"才需要屏蔽。
      const defaultDisabled = [...disabledByProject].some((item) => sanitizeServerName(item) === serverName);
      if (defaultDisabled) restrict.set(key, { key, serverName });
    }
    return { session, restrict: [...restrict.values()] };
  }

  /**
   * 取某个 serverName 当前在**全局层**已注册的全部工具名。
   *
   * 用 `ctx.root` 上的 tools 服务读全局视图：`schemas()` 不传 scope 时返回
   * 全局层可见的工具（不含任何 scoped 注册），正好满足 restrict 的契约
   * ——"unknown names / scope-local names fail"。取不到（headless 假 ctx、
   * 服务缺失）时返回空数组，调用方据此降级。
   */
  function globalToolNames(serverNames: readonly string[]): string[] {
    const tools = ctx.root?.get?.("tools") ?? ctx.get?.("tools");
    if (typeof tools?.schemas !== "function") return [];
    let schemas: unknown;
    try {
      schemas = tools.schemas();
    } catch (error) {
      logger.warn?.(`capability-panel: 读取全局工具清单失败（${errMessage(error)}），本次不调用 restrict`);
      return [];
    }
    if (!Array.isArray(schemas)) return [];
    const prefixes = serverNames.map((name) => `mcp__${name}__`);
    const names: string[] = [];
    for (const schema of schemas) {
      const name = (schema as { name?: unknown } | undefined)?.name;
      if (typeof name === "string" && prefixes.some((prefix) => name.startsWith(prefix))) names.push(name);
    }
    return names;
  }

  /** 释放本 session 上一代的 restrict（同步；换代与重算前都会调用）。 */
  function disposeRestrictions(record: SessionRecord): void {
    const disposers = record.restrictDisposers;
    record.restrictDisposers = [];
    record.restrictions = [];
    record.appliedDeny = [];
    for (const dispose of disposers) {
      try {
        dispose();
      } catch (error) {
        logger.warn?.(`capability-panel: 解除全局 MCP 屏蔽失败（session ${record.agent?.id}）：${errMessage(error)}`);
      }
    }
  }

  /** 两个工具名清单是否等价（restrict 名单与顺序无关）。 */
  function sameNames(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((name) => right.includes(name));
  }

  /**
   * 按当前全局工具清单（重）计算本 session 的全局屏蔽。全程同步，因此不会
   * 与其它队列的异步挂载交错成半成品状态；任何失败都只降级（warning +
   * 状态视图标注），绝不抛穿到 session 挂载。
   *
   * 幂等：名单与上一代实际提交的完全一致时直接返回——`tools.restrict` 自身
   * 也会触发 `tools/change`，这条短路是刷新路径不形成循环的关键。
   */
  function applyRestrictions(record: SessionRecord): void {
    const targets = record.restrictTargets;
    if (targets.length === 0) {
      if (record.restrictDisposers.length > 0 || record.restrictions.length > 0) disposeRestrictions(record);
      return;
    }
    const tools = record.agent?.ctx?.get?.("tools");
    if (typeof tools?.restrict !== "function") {
      if (record.restrictDisposers.length > 0) disposeRestrictions(record);
      record.restrictions = targets.map((target) => ({ key: target.key, state: "skipped" as const, error: RESTRICT_UNAVAILABLE }));
      if (record.restrictWarned !== true) {
        record.restrictWarned = true;
        logger.warn?.(
          `capability-panel: 无法屏蔽全局 MCP server（session ${record.agent?.id}）：${targets.map((target) => target.key).join(", ")} —— ${RESTRICT_UNAVAILABLE}`,
        );
      }
      return;
    }
    const deny = globalToolNames(targets.map((target) => target.serverName));
    if (deny.length === 0) {
      // 契约规定空 filters 会 fail，且没有工具可屏蔽时 restrict 也无意义。
      if (record.restrictDisposers.length > 0) disposeRestrictions(record);
      record.restrictions = targets.map((target) => ({ key: target.key, state: "skipped" as const, error: RESTRICT_NO_GLOBAL_TOOLS }));
      return;
    }
    if (record.restrictDisposers.length > 0 && sameNames(deny, record.appliedDeny)) return;
    disposeRestrictions(record);
    try {
      // 必须由 agent.ctx 调用：restrict 按调用方作用域生效（契约原文见模块头）。
      const dispose = tools.restrict({ deny });
      if (typeof dispose === "function") record.restrictDisposers.push(dispose);
      record.appliedDeny = deny;
      record.restrictions = targets.map((target) => ({ key: target.key, state: "applied" as const }));
    } catch (error) {
      record.restrictions = targets.map((target) => ({ key: target.key, state: "failed" as const, error: errMessage(error) }));
      logger.warn?.(`capability-panel: 屏蔽全局 MCP server 失败（session ${record.agent?.id}）：${errMessage(error)}`);
    }
  }

  /** 释放本 session 上一代的全部「服务器指令段」遮蔽（同步；换代前调用）。 */
  function disposePromptShadows(record: SessionRecord): void {
    const shadows = record.promptShadows;
    record.promptShadows = new Map();
    record.promptShadowFailures.clear();
    for (const [serverName, dispose] of shadows) {
      try {
        dispose();
      } catch (error) {
        logger.warn?.(
          `capability-panel: 解除 MCP 指令段遮蔽失败（session ${record.agent?.id}，server ${serverName}）：${errMessage(error)}`,
        );
      }
    }
  }

  /** 解析宿主 `MCP_SERVERS` 段的顺序；宿主缺顺序表时用兜底常量。 */
  function mcpSectionOrder(systemPrompt: any): number {
    try {
      const order = systemPrompt?.getSectionOrder?.("MCP_SERVERS");
      return typeof order === "number" && Number.isFinite(order) ? order : MCP_SERVERS_SECTION_ORDER;
    } catch {
      return MCP_SERVERS_SECTION_ORDER;
    }
  }

  /**
   * **确定挂在 root 侧**的 serverName 集合（本插件全局层 + Host 根作用域的外部
   * 注入实例），作为「是否值得注册指令段影子段」的证据。
   *
   *  - 本插件全局层：直接看 `globalMounts`（含 `conflict`——实例实际在 Host
   *    根作用域，同样需要按会话遮蔽）；
   *  - 外部注入实例不在本插件簿记里，用全局工具注册表的 `mcp__<serverName>__*`
   *    反推（与面板 `restrictable` 同一判据；serverName 受桥接层
   *    `[A-Za-z0-9_-]{1,32}` 约束，前缀拆分可靠）。
   *
   * 认不出来的名字（按 agent 作用域注入的实例、或只存在于历史开关里的名字）
   * 一律不遮蔽：那类实例的 `mcp:<serverName>` 段注册在**本会话作用域**，注册
   * 同名影子段会撞名并可能拖垮它的挂载；`tools.restrict` 对它们本来也无效，
   * 两边行为一致（都不动）。
   */
  function rootSideServerNames(): Set<string> {
    const names = new Set<string>();
    for (const mount of globalMounts) names.add(mount.serverName);
    const tools = ctx.root?.get?.("tools") ?? ctx.get?.("tools");
    if (typeof tools?.schemas !== "function") return names;
    let schemas: unknown;
    try {
      schemas = tools.schemas();
    } catch {
      return names;
    }
    if (!Array.isArray(schemas)) return names;
    for (const schema of schemas) {
      const name = (schema as { name?: unknown } | undefined)?.name;
      if (typeof name !== "string" || !name.startsWith("mcp__")) continue;
      const rest = name.slice("mcp__".length);
      const cut = rest.indexOf("__");
      if (cut > 0) names.add(rest.slice(0, cut));
    }
    return names;
  }

  /**
   * 遮蔽「本会话不可见」的全局/外部 server 注册在系统提示词里的服务器指令段。
   *
   * 为什么需要：`tools.restrict` 只过滤**工具表**；MCP 桥接层还会把每个
   * server 的 `instructions` 注册成系统提示词段
   * （`@deepseek-ai/dsh-mcp-client` 的 `registerServerContext()`：
   * `name: \`mcp:${serverName}\``，注册在挂载它的作用域——本项目全局层是
   * 插件 ctx ⇒ **全局作用域**）。于是「当前对话里关掉」的共享实例虽然工具
   * 被屏蔽了，整段指令仍会进入本会话的系统提示词（白白占 token，还可能
   * 干扰模型行为）。
   *
   * 做法：宿主 system-prompt 的契约是「A scoped section shadows a global
   * section with the same name」，所以在 `agent.ctx`（本会话作用域）注册
   * **同名、空文本**的段：本会话装配时同名段取到空文本，`renderPrompt`
   * 渲染阶段把空文本段丢弃——等价于「这段不存在」；dispose 即恢复。
   *
   * 四条边界（与 restrict 同源的降级策略，任何失败都不得拖垮 session 挂载）：
   *  - **本会话自己挂载的项目层 server 不遮蔽**：桥接层会把同名段注册在
   *    **同一个 agent 作用域**，重复注册会抛
   *    "prompt section ... is already registered in this scope"，可能连带
   *    拖垮该 server 的挂载；这些条目在本会话里本就启用，无需遮蔽。
   *  - **只遮蔽确定挂在 root 侧的 server**（本插件全局层 / Host 根作用域的外部
   *    实例，见 {@link rootSideServerNames}）：认不出来的名字可能是按会话注入
   *    的实例，影子段会和它的同名段抢注册。
   *  - 外部按会话注入的实例若已占用同名段，逐条 catch + warn，不影响其余条目；
   *    宿主没有 `systemPrompt.section`（headless / 旧装配）时整组降级为
   *    warning（只打一次），不抛。
   *
   * 同步、增量、幂等：已生效的目标直接跳过；名单缩小只释放失效目标（保留仍
   * 需要的影子段，不做全量重建）；注册失败的目标每次 refresh 静默重试，同一
   * 失败文案只 warning 一次。这样 `tools/change` 的刷新不会产生无谓的
   * dispose/re-register 抖动，也不会刷屏。
   *
   * @param mountedServerNames 本代在本会话（agent 作用域）成功挂载的 serverName。
   */
  function applyPromptShadows(record: SessionRecord, mountedServerNames: readonly string[]): void {
    const mounted = new Set(mountedServerNames);
    // 资源清单的隐藏名单与影子段同源（restrictTargets − 本会话挂载），但**不加**
    // root 侧证据过滤：名字出现在宿主清单里就说明有 resource provider，能剔就剔。
    record.resourceListHidden = new Set(
      [...new Set(record.restrictTargets.map((target) => target.serverName))].filter((serverName) => !mounted.has(serverName)),
    );
    const rootSide = rootSideServerNames();
    const wanted = [...new Set(record.restrictTargets.map((target) => target.serverName))].filter(
      (serverName) => !mounted.has(serverName) && rootSide.has(serverName),
    );
    const wantedSet = new Set(wanted);
    // 只释放不再需要的影子段；仍需要的保留（幂等，避免全量重建抖动）。
    for (const [serverName, dispose] of [...record.promptShadows]) {
      if (wantedSet.has(serverName)) continue;
      record.promptShadows.delete(serverName);
      try {
        dispose();
      } catch (error) {
        logger.warn?.(
          `capability-panel: 解除 MCP 指令段遮蔽失败（session ${record.agent?.id}，server ${serverName}）：${errMessage(error)}`,
        );
      }
    }
    // 名单缩表后清掉不再相关的失败记录；仍在名单里的保留，避免重复告警同一失败。
    for (const serverName of [...record.promptShadowFailures.keys()]) {
      if (!wantedSet.has(serverName)) record.promptShadowFailures.delete(serverName);
    }
    if (wanted.length === 0) return;
    const systemPrompt = record.agent?.ctx?.get?.("systemPrompt");
    if (typeof systemPrompt?.section !== "function") {
      if (record.promptWarned !== true) {
        record.promptWarned = true;
        logger.warn?.(
          `capability-panel: 宿主 systemPrompt 服务不可用，无法在本会话遮蔽 MCP 服务器指令段（session ${record.agent?.id}）：${wanted.join(", ")}`,
        );
      }
      return;
    }
    const order = mcpSectionOrder(systemPrompt);
    for (const serverName of wanted) {
      // 已生效：跳过（幂等短路；名单没变时这一轮什么也不做）。
      if (record.promptShadows.has(serverName)) continue;
      try {
        // 必须由 agent.ctx 调用（get 返回按调用方作用域绑定的服务视图）：
        // 同名 scoped 段才会落进本会话层并覆盖全局层。
        const dispose = systemPrompt.section({ name: `${MCP_INSTRUCTION_SECTION_PREFIX}${serverName}`, order, text: "" });
        if (typeof dispose !== "function") throw new Error("systemPrompt.section() 没有返回 disposer");
        record.promptShadows.set(serverName, dispose);
        record.promptShadowFailures.delete(serverName);
      } catch (error) {
        const message = errMessage(error);
        // 同一目标同一失败只告警一次（外部实例一直占着同名段时不会刷屏）；
        // 失败目标不进入 promptShadows，下次 refresh 仍会静默重试。
        if (record.promptShadowFailures.get(serverName) !== message) {
          record.promptShadowFailures.set(serverName, message);
          logger.warn?.(
            `capability-panel: 遮蔽 MCP 服务器指令段失败（session ${record.agent?.id}，server ${serverName}）：${message}`,
          );
        }
      }
    }
  }

  /**
   * 按当前挂载簿记重算某 session 的指令段遮蔽（同步、幂等）。
   *
   * 用于两类"证据后到"的收敛：全局层换代完成（`globalMounts` 变了）、
   * `tools/change`（外部注入实例连上并注册工具后，`rootSideServerNames`
   * 才认得它）。影子段名单没变时 `applyPromptShadows` 直接短路。
   */
  function refreshPromptShadows(record: SessionRecord): void {
    applyPromptShadows(record, record.mounts.filter((mount) => mount.state === "mounted").map((mount) => mount.serverName));
  }

  /**
   * 从 `mcp-resource-servers` 段文本里剔除本会话已关闭的 server 名。
   *
   * 只做**最小文本手术**：解析段尾名单 → 过滤 → 用原前后缀拼回，保持名单顺序。
   * 正则不匹配 / JSON 非法 / 不是数组 / text 非字符串时一律原样返回
   * （fail-open）：宿主改文案只会退化为"名单不隐藏"，不会影响装配本身。
   * 全部被剔除时保留段并把名单写成 `[]`（不整段删除，明确告知"没有可用资源
   * 服务器"）。
   *
   * 注意：这是宿主持久文本格式的耦合点，长期方案应由上游
   * `dsh-mcp-resources` 从受限工具视图派生清单或提供按作用域抑制的 API。
   */
  function filterResourceListNames(assembly: any, hidden: ReadonlySet<string>): any {
    if (hidden.size === 0) return assembly;
    const sections = assembly?.sections;
    if (!Array.isArray(sections)) return assembly;
    let changed = false;
    const next = sections.map((section: any) => {
      if (section?.name !== RESOURCE_SERVERS_SECTION || typeof section.text !== "string") return section;
      const match = RESOURCE_LIST_PATTERN.exec(section.text);
      if (match === null) return section;
      let names: unknown;
      try {
        names = JSON.parse(match[2]);
      } catch {
        return section;
      }
      if (!Array.isArray(names)) return section;
      // 非字符串项原样保留（宿主未来若扩展名单结构，不误删）。
      const kept = names.filter((name) => typeof name !== "string" || !hidden.has(name));
      if (kept.length === names.length) return section;
      changed = true;
      return { ...section, text: `${match[1]}${JSON.stringify(kept)}${match[3]}` };
    });
    return changed ? { ...assembly, sections: next } : assembly;
  }

  /**
   * 给一个 session 挂「资源清单名字过滤」装配钩子（每会话恰好一次）。
   *
   * 为什么用 `system-prompt/assemble` 而不是 scoped 段影子：`mcp-resource-servers`
   * 段的文本由宿主按资源 provider 注册表现算，宿主没有按名字移除 provider 的
   * API（`merge` 是并集、scoped 同名只能覆盖），所以只能在装配结果上做文本手术。
   *
   * 钩子随 agent ctx 释放；`remount` 不重复注册。宿主 ctx 不支持 `on` 或注册
   * 抛错时只降级 warning（名单继续露出名字），绝不影响 session 挂载。
   */
  function installResourceListFilter(record: SessionRecord): void {
    const agentCtx = record.agent?.ctx;
    if (typeof agentCtx?.on !== "function") {
      if (record.resourceFilterWarned !== true) {
        record.resourceFilterWarned = true;
        logger.warn?.(
          `capability-panel: 宿主 ctx 不支持事件监听，无法从资源清单里剔除已关闭的 MCP server 名（session ${record.agent?.id}）`,
        );
      }
      return;
    }
    try {
      agentCtx.on("system-prompt/assemble", (assembly: any, _context: any, next: any) => {
        const inner = typeof next === "function" ? next() : assembly;
        // 真实宿主的水线是 async（next() 返回 Promise）；测试/同步实现可能直接返回
        // assembly。两种形态都要在"内层结果"上过滤。
        if (inner !== null && typeof inner === "object" && typeof inner.then === "function") {
          return (inner as Promise<any>).then((resolved: any) => filterResourceListNames(resolved, record.resourceListHidden));
        }
        return filterResourceListNames(inner, record.resourceListHidden);
      });
    } catch (error) {
      if (record.resourceFilterWarned !== true) {
        record.resourceFilterWarned = true;
        logger.warn?.(
          `capability-panel: 安装资源清单名字过滤器失败（session ${record.agent?.id}）：${errMessage(error)}`,
        );
      }
    }
  }

  /** 刷新合并标记：同一轮同步工具变更只安排一次微任务重算。 */
  let restrictionRefreshQueued = false;

  /**
   * 工具集变化后的屏蔽刷新（监听 `tools/change`：「A tool was registered or
   * unregistered, or a scoped restriction changed」）。
   *
   * restrict 只能按**当前已注册**的名字屏蔽，所以首轮算名单时还没连上的
   * MCP server 之后注册的工具会漏网；等它注册完再重算一次即可收敛。用微任务
   * 合并，避免在 register/restrict 的同步调用栈里重入；名单没变时
   * {@link applyRestrictions} 直接返回，因此本刷新不会自激。
   */
  function scheduleRestrictionRefresh(): void {
    if (restrictionRefreshQueued) return;
    restrictionRefreshQueued = true;
    queueMicrotask(() => {
      restrictionRefreshQueued = false;
      for (const record of sessions.values()) {
        if (record.restrictTargets.length > 0) applyRestrictions(record);
        refreshPromptShadows(record);
      }
    });
  }

  /**
   * 全局层换代：dispose 旧一代 fiber（释放桥接层按 `ctx.root` 预留的
   * serverName），再逐个挂载新一代。挂载失败（含 profile 根作用域已占用
   * 同名 serverName 的 `already in use`）只记状态，绝不抛穿——全局层失败
   * 不能让插件加载或 session 挂载失败。挂完后刷新各 session 的屏蔽清单
   * （全局工具集变了，原先"暂无可屏蔽工具"的 session 需要重新计算）。
   */
  async function remountGlobal(): Promise<void> {
    settling += 1;
    // 新一代的挂载状态先攒在本地、换代完成才赋给 globalMounts：否则重挂期间
    // `status()` 会短暂显示"全部未挂载"（旧代已 dispose、新代还没挂上），
    // 面板看起来像"刚删完所有 server 都掉了"。
    const nextMounts: MountState[] = [];
    try {
      const previous = globalFibers;
      globalFibers = [];
      // 上一代 fiber 并联释放（各 fiber 独立，失败不挡住新一代挂载）。
      await Promise.all(previous.map((fiber) => fiber.dispose().catch(() => undefined)));
      const servers = await resolveGlobalEntries();
      for (const { key, entry } of servers) {
        const config = toClientConfig(key, entry, globalFallbackCwd);
        const serverName = config.serverName;
        try {
          // 挂在**本插件自己的 ctx**（root 侧）→ 桥接层 owner = ctx.root →
          // 全应用一份实例（这是本次改动的核心）。
          const fiber = ctx.plugin(await mcpClient(), config);
          globalFibers.push({ dispose: () => fiber.dispose() });
          // await 激活：同步的配置/命名空间/owner 冲突失败要归因到这一条。
          await fiber;
          nextMounts.push({ key, serverName, state: "mounted" });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // 桥接层按 (owner, serverName) 预留："already in use" 表示 Host 的
          // root 作用域上已有同名 mcp-client（profile 自带的 AnySearch /
          // context7 等）。这是预期行为而非配置错误：不重复挂载，功能由既有
          // 实例提供，只把文案换成人话，避免误导用户去改 serverName。
          const conflict = /already in use/.test(message);
          nextMounts.push({ key, serverName, state: conflict ? "conflict" : "failed", error: conflict ? GLOBAL_CONFLICT_NOTE : message });
          logger.warn?.(`capability-panel: global MCP server "${key}" not mounted: ${message}`);
        }
      }
      // 全局工具集换代后重算各 session 的屏蔽（同步调用，不跨 await）。
      for (const record of sessions.values()) applyRestrictions(record);
    } finally {
      globalMounts = nextMounts;
      settling -= 1;
    }
    // 指令段遮蔽放在 finally 之后：`rootSideServerNames` 的 root 侧证据来自
    // 本代 `globalMounts`，必须等它换代完成再算（否则读到的还是旧一代）。
    for (const record of sessions.values()) refreshPromptShadows(record);
  }

  /** 全局层重挂串行化：并发触发会落在队尾依次执行。 */
  function scheduleGlobalRemount(): Promise<void> {
    const run = globalQueue.then(() => remountGlobal());
    globalQueue = run.catch(() => undefined);
    return run;
  }

  /**
   * 重挂一个 session：先 dispose 上一代 fiber + restrict disposer（释放桥接
   * 层按 agent scope 预留的 serverName、解除旧屏蔽），再挂载本代项目层条目，
   * 最后按当前全局工具清单重算屏蔽。同步风格的配置/命名空间失败会被归因到
   * 具体条目上；`failOnStartupError: false` 保证不可达 server 依然能 resolve
   * （重连交由桥接层处理）；restrict 的任何失败都降级。
   */
  async function remount(record: SessionRecord): Promise<void> {
    settling += 1;
    // 同全局层：新一代状态攒本地、换代完成才替换，避免重挂期间出现
    // "该项目所有 server 都掉了"的假象。
    const nextMounts: MountState[] = [];
    try {
      // 先恢复落盘的会话级开关（resolveSessionPlan 要读 sessionToggles）；
      // 幂等，失败降级为"无显式覆盖"（跟随项目默认），不阻断挂载。
      await hydrateToggles(typeof record.agent?.id === "string" ? record.agent.id : undefined, metaOf(record));
      disposeRestrictions(record);
      // 先解除上一代的指令段遮蔽：本代若挂载同名项目层 server，桥接层要在
      // **同一** agent 作用域注册同名段，残留影子段会让它重复注册失败。
      disposePromptShadows(record);
      const previous = record.fibers;
      record.fibers = [];
      // 上一代 fiber 并联释放（各 fiber 独立，失败不挡住新一代挂载）。
      await Promise.all(previous.map((fiber) => fiber.dispose().catch(() => undefined)));
      if (!enabled) return;
      const plan = await resolveSessionPlan(record.cwd, record.agent?.id);
      record.restrictTargets = plan.restrict;
      for (const { key, entry } of plan.session) {
        const config = toClientConfig(key, entry, record.projectRoot ?? record.cwd);
        const serverName = config.serverName;
        try {
          const fiber = record.agent.ctx.plugin(await mcpClient(), config);
          record.fibers.push({ dispose: () => fiber.dispose() });
        // await 激活：同步的配置/命名空间失败要归因到这一条。
        await fiber;
          nextMounts.push({ key, serverName, state: "mounted" });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const conflict = /already in use/.test(message);
          nextMounts.push({ key, serverName, state: conflict ? "conflict" : "failed", error: conflict ? SESSION_CONFLICT_NOTE : message });
          logger.warn?.(`capability-panel: MCP server "${key}" not mounted for session ${record.agent.id}: ${message}`);
        }
      }
      // 全局屏蔽在项目层挂载之后重算：本代的 scoped 注册与全局可见性都已就位。
      applyRestrictions(record);
      // 指令段遮蔽同样放在挂载之后：只用本代真正挂上的 serverName 做排除，
      // 避免和项目层自挂实例的同名段抢注册（见 applyPromptShadows 注释）。
      applyPromptShadows(
        record,
        nextMounts.filter((mount) => mount.state === "mounted").map((mount) => mount.serverName),
      );
    } finally {
      record.mounts = nextMounts;
      settling -= 1;
    }
  }

  /** 每个 session 串行化重挂：并发触发会落在队尾合并执行。 */
  function scheduleRemount(record: SessionRecord): Promise<void> {
    const run = record.queue.then(() => remount(record));
    record.queue = run.catch(() => undefined);
    return run;
  }

  /** 登记一个新 agent 并触发首轮挂载（跳过无 ctx/id 的 stub）。 */
  function mountAgent(agent: any): void {
    if (agent?.ctx === undefined || agent?.id === undefined) return;
    if (sessions.has(agent.id)) return;
    const cwd = typeof agent.session?.header?.cwd === "string" ? agent.session.header.cwd : undefined;
    const record: SessionRecord = {
      agent,
      cwd,
      projectRoot: cwd !== undefined ? findProjectRoot(cwd) : undefined,
      fibers: [],
      restrictDisposers: [],
      mounts: [],
      restrictions: [],
      appliedDeny: [],
      restrictTargets: [],
      promptShadows: new Map(),
      promptShadowFailures: new Map(),
      resourceListHidden: new Set(),
      queue: Promise.resolve(),
    };
    sessions.set(agent.id, record);
    // 资源清单过滤器与会话同生命周期（与 remount 解耦：监听器只注册一次）。
    installResourceListFilter(record);
    scheduleRemount(record).catch((error) => {
      logger.warn?.(`capability-panel: MCP mount sweep failed for session ${agent.id}: ${String(error)}`);
    });
  }

  if (enabled) {
    // 新 agent 创建 / 释放时维护簿记（挂载的 fiber 与 restrict 都由 agent
    // 上下文自动解绑，这里只需清掉记录）。
    ctx.on("agent/created", ({ agent }: any) => mountAgent(agent));
    ctx.on("agent/disposed", ({ agent }: any) => {
      if (agent?.id !== undefined) {
        // 只清内存：磁盘记录要留给宿主重启后恢复（见 session-state.ts）。
        sessions.delete(agent.id);
        sessionToggles.delete(agent.id);
        hydratedSessions.delete(agent.id);
      }
    });
    // 工具集变化（MCP server 连接后注册工具 / 断线注销 / 别的插件改动）时
    // 重算各 session 的屏蔽清单：restrict 只能按当前已注册的名字屏蔽，首轮
    // 名单可能漏掉后到的工具。微任务合并 + 幂等短路，不会与自身形成循环。
    ctx.on("tools/change", () => scheduleRestrictionRefresh());
    // 插件加载时已经存活的 agent（resume / 历史 session）补挂。
    for (const agent of ctx.get("agents")?.list?.() ?? []) {
      mountAgent(agent);
    }
    // 全局层首轮挂载：不等任何 session，也不被任何 session 等待（两个队列
    // 各自串行，避免互相 await 造成死锁）。
    scheduleGlobalRemount().catch((error) => {
      logger.warn?.(`capability-panel: global MCP mount sweep failed: ${String(error)}`);
    });
  }

  /**
   * 设置某个 session 的手动开关（内存内，不落盘）。
   *
   * 只影响该 session：项目条目会按需挂载/卸载，全局/外部实例用 `tools.restrict`
   * 屏蔽或恢复其工具（不卸载共享实例）。`enabled` 传 `undefined` 可清掉显式覆盖、
   * 重新跟随项目默认。
   */
  async function setSessionEnabled(input: {
    sessionId: string;
    cwd?: string;
    target: string;
    kind: "project" | "server";
    enabled: boolean | undefined;
  }): Promise<void> {
    // 找到这个 session 的记录（冷会话可能是 undefined：仍允许先落盘，等 agent 创建时恢复）。
    const record = [...sessions.values()].find((item) => item.agent?.id === input.sessionId);
    const meta = metaOf(record);
    if (input.cwd !== undefined && meta.cwd === undefined) meta.cwd = input.cwd;
    // 先把磁盘上的其它键恢复进内存，避免本次写盘覆盖掉它们。
    await hydrateToggles(input.sessionId, meta);
    let toggles = sessionToggles.get(input.sessionId);
    if (toggles === undefined) {
      toggles = new Map<string, boolean>();
      sessionToggles.set(input.sessionId, toggles);
    }
    const toggleKey = input.kind === "project" ? projectToggleKey(input.target) : serverToggleKey(input.target);
    if (input.enabled === undefined) toggles.delete(toggleKey);
    else toggles.set(toggleKey, input.enabled);
    // 落盘：失败只 warn（本次运行内仍生效，等价于旧行为），不向 RPC 抛。
    const state = deps.state;
    if (state !== undefined) await state.setMcp(input.sessionId, toggleKey, input.enabled, meta);
    // 只重挂这个 session（项目条目挂载 / restrict 都要重算）。
    if (record !== undefined) await scheduleRemount(record);
  }

  /** 读某个 session 的显式开关表（供 list/runtime 投影 enabledInSession）。 */
  function sessionToggleState(sessionId?: string): Record<string, boolean> {
    if (sessionId === undefined) return {};
    return Object.fromEntries(sessionToggles.get(sessionId) ?? []);
  }

  /** 供 mcp.list/runtime 读投影前调用：把落盘开关恢复进内存（幂等）。 */
  async function hydrateSession(
    sessionId: string,
    meta: { cwd?: string; headerCreatedAt?: number } = {},
  ): Promise<void> {
    await hydrateToggles(sessionId, meta);
  }

  /** 找到某个 session 的记录（冷会话可能是 undefined：仍允许先落盘）。 */
  function findSessionRecord(sessionId: string): SessionRecord | undefined {
    return [...sessions.values()].find((item) => item.agent?.id === sessionId);
  }

  /** 取 / 建某 session 的内存开关表。 */
  function togglesOf(sessionId: string): Map<string, boolean> {
    let toggles = sessionToggles.get(sessionId);
    if (toggles === undefined) {
      toggles = new Map<string, boolean>();
      sessionToggles.set(sessionId, toggles);
    }
    return toggles;
  }

  /**
   * 批量写某个 session 的手动开关（R1）：一次 hydrate → 写全部 toggle →
   * 一次 `state.setToggles` 落盘 → 一次重挂。
   *
   * 与单条 `setSessionEnabled` 语义一致：`enabled === undefined` 清覆盖。
   */
  async function setSessionEnabledMany(input: {
    sessionId: string;
    cwd?: string;
    entries: Array<{ target: string; kind: "project" | "server"; enabled: boolean | undefined }>;
  }): Promise<void> {
    const sessionId = typeof input?.sessionId === "string" ? input.sessionId : "";
    if (sessionId.length === 0) return;
    const entries = Array.isArray(input?.entries) ? input.entries : [];
    if (entries.length === 0) return;
    const record = findSessionRecord(sessionId);
    const meta = metaOf(record);
    if (input.cwd !== undefined && meta.cwd === undefined) meta.cwd = input.cwd;
    // 先把磁盘上的其它键恢复进内存，避免本次写盘覆盖掉它们（幂等）。
    await hydrateToggles(sessionId, meta);
    const toggles = togglesOf(sessionId);
    /** 本批落盘条目（`undefined` = 清除该键）；一次 setToggles。 */
    const writes: Record<string, boolean | undefined> = {};
    for (const entry of entries) {
      if (typeof entry?.target !== "string" || entry.target.length === 0) continue;
      const toggleKey = entry.kind === "project" ? projectToggleKey(entry.target) : serverToggleKey(entry.target);
      if (entry.enabled === undefined) toggles.delete(toggleKey);
      else toggles.set(toggleKey, entry.enabled);
      writes[toggleKey] = entry.enabled;
    }
    if (Object.keys(writes).length === 0) return;
    const state = deps.state;
    if (state !== undefined) await state.setToggles(sessionId, "mcp", writes, meta);
    // 只重挂这个 session 一次（项目条目挂载 / restrict 都要重算）。
    if (record !== undefined) await scheduleRemount(record);
  }

  return {
    setSessionEnabled,
    setSessionEnabledMany,
    sessionToggleState,
    hydrateSession,
    /** 状态视图；传 cwd 时按项目根过滤 session，全局层哨兵恒返回（见模块头注释）。 */
    status(cwd?: string): McpStatusView[] {
      if (!enabled) return [];
      const projectRoot = cwd !== undefined ? findProjectRoot(cwd) : undefined;
      // 该项目里已被 restrict **生效**屏蔽的全局键：从哨兵记录里剔除，避免
      // 面板把"本项目禁用"的全局 server 显示成"已挂载"。降级（skipped /
      // failed）的键不移除——那时全局工具确实对本会话可见，如实展示。
      const restrictedForProject = new Set<string>();
      if (projectRoot !== undefined) {
        for (const record of sessions.values()) {
          if (record.projectRoot !== projectRoot) continue;
          for (const restriction of record.restrictions) {
            if (restriction.state === "applied") restrictedForProject.add(restriction.key);
          }
        }
      }
      const views: McpStatusView[] = [
        {
          sessionId: GLOBAL_MOUNT_SESSION_ID,
          scope: "global",
          servers: globalMounts.filter((mount) => !restrictedForProject.has(mount.key)).map((mount) => ({ ...mount })),
          ...(settling > 0 ? { settling: true } : {}),
        },
      ];
      for (const [sessionId, record] of sessions) {
        if (projectRoot !== undefined && record.projectRoot !== projectRoot) continue;
        views.push({
          sessionId,
          ...(record.projectRoot !== undefined ? { projectRoot: record.projectRoot } : {}),
          scope: "session",
          servers: record.mounts.map((mount) => ({ ...mount })),
          ...(record.restrictions.length > 0 ? { restrictions: record.restrictions.map((restriction) => ({ ...restriction })) } : {}),
          ...(settling > 0 ? { settling: true } : {}),
        });
      }
      return views;
    },

    /**
     * 定向重挂：不传 projectRoot = 全局层 + 全部 session；传 projectRoot =
     * 只重挂该项目根的 session（全局层不动，全局写入才需要换代）。
     */
    async reload(projectRoot?: string): Promise<void> {
      const tasks: Promise<void>[] = [];
      if (projectRoot === undefined && enabled) tasks.push(scheduleGlobalRemount());
      for (const record of sessions.values()) {
        if (projectRoot !== undefined && record.projectRoot !== projectRoot) continue;
        tasks.push(scheduleRemount(record));
      }
      await Promise.allSettled(tasks);
    },
  };
}
