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
import type { OverridesManager } from "../overrides/manager.js";
import type { ImportsManager } from "../imports/manager.js";
import type { SessionStateStore } from "../session-state.js";
import type { McpStatusView } from "./types.js";
/**
 * 全局层在状态视图里的哨兵 sessionId（不是真实 session）。`*` 不在任何
 * session id 的字符集里，不会与真实记录相撞。
 */
export declare const GLOBAL_MOUNT_SESSION_ID = "*global*";
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
    /** 该 session 的显式开关快照（键带 `project:` / `server:` 前缀）。 */
    sessionToggleState(sessionId?: string): Record<string, boolean>;
}
/** 创建挂载器：注册 agent 生命周期监听 + 全局层首轮挂载 + 存量 agent 补挂。 */
export declare function createMcpLoader(ctx: any, deps?: McpLoaderDeps): McpLoader;
