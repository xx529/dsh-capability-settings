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
 * @module @chengdb/capability-panel/mcp/loader
 */
import { locateConfigFile } from "../shared/config-location.js";
import { errMessage } from "../shared/errors.js";
import { findProjectRoot } from "../shared/project-root.js";
import { readMcpFile, sanitizeServerName, toClientConfig } from "./config-file.js";
import { GLOBAL_MCP_FILE_NAME, globalMcpDirs, projectMcpFile } from "./paths.js";
/**
 * 全局层在状态视图里的哨兵 sessionId（不是真实 session）。`*` 不在任何
 * session id 的字符集里，不会与真实记录相撞。
 */
export const GLOBAL_MOUNT_SESSION_ID = "*global*";
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
const GLOBAL_CONFLICT_NOTE = "同一 serverName 已由 Host 根作用域的其它 mcp-client 实例占用（例如 profile 的 cordis.patch.yml 里 root 级插入的 MCP 条目），本插件不再重复挂载：工具仍由那份实例提供，但面板里对该条目的修改不会生效";
/** 项目层 serverName 冲突（同一作用域内已有实例）时的友好文案。 */
const SESSION_CONFLICT_NOTE = "同一 serverName 已被本会话（或本会话所在作用域）的其它 mcp-client 实例占用，本插件不重复挂载";
/** 宿主未提供 tools.restrict 时的降级说明。 */
const RESTRICT_UNAVAILABLE = "宿主 tools 服务未提供 restrict()，无法在本会话屏蔽全局 server（全局工具对本会话可见）";
/** 全局层尚无该 server 的已注册工具时的降级说明。 */
const RESTRICT_NO_GLOBAL_TOOLS = "该 server 当前没有已注册的全局工具（可能尚未连接），本次未调用 restrict";
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
function createMcpClientResolver(ctx) {
    let resolved;
    return () => {
        resolved ??= (async () => {
            const loader = ctx.get?.("loader");
            if (typeof loader?.import === "function") {
                try {
                    const mod = await loader.import("@deepseek-ai/dsh-mcp-client");
                    if (mod !== null && mod !== undefined) {
                        return typeof loader.unwrapExports === "function" ? loader.unwrapExports(mod) : mod;
                    }
                }
                catch (error) {
                    ctx.logger?.warn?.(`capability-panel: host mcp-client unavailable (${errMessage(error)}); falling back to the bundled copy`);
                }
            }
            return await import("@deepseek-ai/dsh-mcp-client");
        })();
        return resolved;
    };
}
/** 创建挂载器：注册 agent 生命周期监听 + 全局层首轮挂载 + 存量 agent 补挂。 */
export function createMcpLoader(ctx, deps = {}) {
    const sessions = new Map();
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
    const sessionToggles = new Map();
    /** 项目条目的开关键。 */
    const projectToggleKey = (key) => `project:${key}`;
    /** 全局/外部实例的开关键（按 serverName）。 */
    const serverToggleKey = (serverName) => `server:${serverName}`;
    /** 读某个 session 的显式开关（未设置返回 undefined = 跟随默认）。 */
    function sessionToggle(sessionId, toggleKey) {
        if (sessionId === undefined)
            return undefined;
        return sessionToggles.get(sessionId)?.get(toggleKey);
    }
    const enabled = deps.enabled !== false;
    const logger = ctx.logger ?? console;
    const mcpClient = createMcpClientResolver(ctx);
    /** 全局层当前这一代的 fiber 与挂载结果（全应用共享，不属于任何 session）。 */
    let globalFibers = [];
    let globalMounts = [];
    /**
     * 正在重挂的代数计数（> 0 ⇒ `status().settling === true`）。
     *
     * 写入路径（`manager.reloadFor`）**不再等待**重挂完成，所以 RPC 返回后挂载
     * 状态可能还在后台换代；面板据此短暂轮询，让"已挂载/未挂载"在几秒内自行
     * 收敛，而不是让"保存/删除/启停"卡住数秒（见 manager 里 reloadFor 的注释）。
     */
    let settling = 0;
    /** 全局层重挂队列：配置变化时串行换代，避免新旧两代同 serverName 相撞。 */
    let globalQueue = Promise.resolve();
    /**
     * 全局层 stdio 条目的 fallback 工作目录。全局层是全应用单例，没有"当前
     * 项目"，只能用宿主进程目录。旧实现按每个 session 的项目根各起一份进程，
     * 因此全局条目未显式写 `cwd` 时，其工作目录从"各会话的项目根"变成"宿主
     * 进程目录"（条目自己写了 `cwd` 时不受影响）。
     */
    const globalFallbackCwd = process.cwd();
    /** 读取全局 MCP 文件；读失败只记 warn，返回空表。 */
    async function readGlobalServers() {
        // 全局配置读取生效位置（.agents 首选，兼容旧位置 dsh home / ~/.claude）。
        const globalFile = locateConfigFile(globalMcpDirs(deps), GLOBAL_MCP_FILE_NAME).readFile;
        try {
            return await readMcpFile(globalFile);
        }
        catch (error) {
            logger.warn?.(`capability-panel: ${errMessage(error)}`);
            return Object.create(null);
        }
    }
    /** 全局层要挂的条目：全局文件里 `disabled !== true` 的全部条目。 */
    async function resolveGlobalEntries() {
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
    async function resolveSessionPlan(cwd, sessionId) {
        // 项目级禁用的全局 server 键集合（无 cwd 或读取失败时为空集合）。
        const disabledByProject = new Set((await deps.overrides?.sets(cwd))?.mcp ?? []);
        // 三个来源并行解析；单个失败只记 warn。
        const refsPromise = cwd !== undefined && deps.imports !== undefined
            ? deps.imports.entries(cwd, "mcp")
            : Promise.resolve({});
        const [globalServers, projectServers, refs] = await Promise.all([
            readGlobalServers(),
            cwd !== undefined
                ? readMcpFile(projectMcpFile(cwd)).catch((error) => {
                    logger.warn?.(`capability-panel: ${errMessage(error)}`);
                    return Object.create(null);
                })
                : Promise.resolve(Object.create(null)),
            refsPromise,
        ]);
        /** 全局层是否真的会挂这个 key（`disabled !== true`）。 */
        const globalEnabled = (key) => Object.hasOwn(globalServers, key) && globalServers[key].disabled !== true;
        const session = [];
        const restrict = new Map();
        /**
         * 登记一条"本项目屏蔽全局 server"。
         *
         * - 配置文件里的 key：只有全局层真挂了才需要屏蔽（原逻辑）。
         * - `externalCandidate`：overrides 里的键也可能指向**运行时注入**的实例（不在
         *   我们的全局文件里，例如别的插件挂的 `figma`）。这类也要登记为候选，
         *   `applyRestrictions` 会按 `mcp__<serverName>__*` 去全局工具视图找名字——
         *   找不到就自动降级成 skipped（契约规定空 filter 会失败），不会误调用。
         */
        const restrictKey = (key, externalCandidate = false) => {
            if (!globalEnabled(key) && !externalCandidate)
                return;
            restrict.set(key, { key, serverName: sanitizeServerName(key) });
        };
        /**
         * 项目条目的「本会话是否启用」：
         * 文件里 `disabled: true` = 硬关闭（忽略会话开关）；否则
         * 显式 session 开关 > 项目级默认（overrides 里列了 = 默认关闭）。
         */
        const projectEntryEnabled = (key) => {
            const explicit = sessionToggle(sessionId, projectToggleKey(key));
            return explicit ?? !disabledByProject.has(key);
        };
        for (const [key, entry] of Object.entries(projectServers)) {
            if (entry.disabled === true) {
                restrictKey(key);
                continue;
            }
            if (projectEntryEnabled(key))
                session.push({ key, entry });
            // 项目条目被关掉时：如果全局层有同名 server，它本来被本条遮蔽，现在会露出来
            // → 同步屏蔽掉全局那份，语义才是"这个 MCP 在本会话里关着"。
            else
                restrictKey(key);
        }
        for (const [key, ref] of Object.entries(refs)) {
            // 同名项目原生条目恒优先（与 manager.list 的口径一致）。
            if (Object.hasOwn(projectServers, key))
                continue;
            // 悬空引用（全局条目已删）忽略。
            if (!Object.hasOwn(globalServers, key))
                continue;
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
            if (globalServers[key].disabled === true)
                session.push({ key, entry: globalServers[key] });
        }
        // 全局配置条目 + 外部注入实例：候选 = 项目默认关闭的键 ∪ 本会话显式开关过的键。
        // 生效规则：显式会话开关 > 项目级默认；关掉即用 tools.restrict 屏蔽其全局工具
        // （共享实例不卸载；按 agent 作用域注入的实例 restrict 会失败→降级 skipped）。
        const serverCandidates = new Map(); // serverName → 展示用 key（config key 优先）
        for (const key of disabledByProject) {
            // 项目原生条目（且全局没有同名）由"是否在会话内挂载"控制，不是全局/外部实例，
            // 不能当成 server 屏蔽候选——否则会平白产生一条 skipped 记录。
            if (Object.hasOwn(projectServers, key) && !globalEnabled(key) && !Object.hasOwn(refs, key))
                continue;
            serverCandidates.set(sanitizeServerName(key), key);
        }
        for (const [toggleKey] of sessionToggles.get(sessionId ?? "") ?? []) {
            if (!toggleKey.startsWith("server:"))
                continue;
            const serverName = toggleKey.slice("server:".length);
            if (!serverCandidates.has(serverName))
                serverCandidates.set(serverName, serverName);
        }
        for (const [serverName, key] of serverCandidates) {
            const explicit = sessionToggle(sessionId, serverToggleKey(serverName));
            if (explicit !== undefined) {
                if (!explicit)
                    restrict.set(key, { key, serverName });
                continue;
            }
            // 未显式设置 ⇒ 跟随项目默认：只有"项目默认关闭"才需要屏蔽。
            const defaultDisabled = [...disabledByProject].some((item) => sanitizeServerName(item) === serverName);
            if (defaultDisabled)
                restrict.set(key, { key, serverName });
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
    function globalToolNames(serverNames) {
        const tools = ctx.root?.get?.("tools") ?? ctx.get?.("tools");
        if (typeof tools?.schemas !== "function")
            return [];
        let schemas;
        try {
            schemas = tools.schemas();
        }
        catch (error) {
            logger.warn?.(`capability-panel: 读取全局工具清单失败（${errMessage(error)}），本次不调用 restrict`);
            return [];
        }
        if (!Array.isArray(schemas))
            return [];
        const prefixes = serverNames.map((name) => `mcp__${name}__`);
        const names = [];
        for (const schema of schemas) {
            const name = schema?.name;
            if (typeof name === "string" && prefixes.some((prefix) => name.startsWith(prefix)))
                names.push(name);
        }
        return names;
    }
    /** 释放本 session 上一代的 restrict（同步；换代与重算前都会调用）。 */
    function disposeRestrictions(record) {
        const disposers = record.restrictDisposers;
        record.restrictDisposers = [];
        record.restrictions = [];
        record.appliedDeny = [];
        for (const dispose of disposers) {
            try {
                dispose();
            }
            catch (error) {
                logger.warn?.(`capability-panel: 解除全局 MCP 屏蔽失败（session ${record.agent?.id}）：${errMessage(error)}`);
            }
        }
    }
    /** 两个工具名清单是否等价（restrict 名单与顺序无关）。 */
    function sameNames(left, right) {
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
    function applyRestrictions(record) {
        const targets = record.restrictTargets;
        if (targets.length === 0) {
            if (record.restrictDisposers.length > 0 || record.restrictions.length > 0)
                disposeRestrictions(record);
            return;
        }
        const tools = record.agent?.ctx?.get?.("tools");
        if (typeof tools?.restrict !== "function") {
            if (record.restrictDisposers.length > 0)
                disposeRestrictions(record);
            record.restrictions = targets.map((target) => ({ key: target.key, state: "skipped", error: RESTRICT_UNAVAILABLE }));
            if (record.restrictWarned !== true) {
                record.restrictWarned = true;
                logger.warn?.(`capability-panel: 无法屏蔽全局 MCP server（session ${record.agent?.id}）：${targets.map((target) => target.key).join(", ")} —— ${RESTRICT_UNAVAILABLE}`);
            }
            return;
        }
        const deny = globalToolNames(targets.map((target) => target.serverName));
        if (deny.length === 0) {
            // 契约规定空 filters 会 fail，且没有工具可屏蔽时 restrict 也无意义。
            if (record.restrictDisposers.length > 0)
                disposeRestrictions(record);
            record.restrictions = targets.map((target) => ({ key: target.key, state: "skipped", error: RESTRICT_NO_GLOBAL_TOOLS }));
            return;
        }
        if (record.restrictDisposers.length > 0 && sameNames(deny, record.appliedDeny))
            return;
        disposeRestrictions(record);
        try {
            // 必须由 agent.ctx 调用：restrict 按调用方作用域生效（契约原文见模块头）。
            const dispose = tools.restrict({ deny });
            if (typeof dispose === "function")
                record.restrictDisposers.push(dispose);
            record.appliedDeny = deny;
            record.restrictions = targets.map((target) => ({ key: target.key, state: "applied" }));
        }
        catch (error) {
            record.restrictions = targets.map((target) => ({ key: target.key, state: "failed", error: errMessage(error) }));
            logger.warn?.(`capability-panel: 屏蔽全局 MCP server 失败（session ${record.agent?.id}）：${errMessage(error)}`);
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
    function scheduleRestrictionRefresh() {
        if (restrictionRefreshQueued)
            return;
        restrictionRefreshQueued = true;
        queueMicrotask(() => {
            restrictionRefreshQueued = false;
            for (const record of sessions.values()) {
                if (record.restrictTargets.length > 0)
                    applyRestrictions(record);
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
    async function remountGlobal() {
        settling += 1;
        // 新一代的挂载状态先攒在本地、换代完成才赋给 globalMounts：否则重挂期间
        // `status()` 会短暂显示"全部未挂载"（旧代已 dispose、新代还没挂上），
        // 面板看起来像"刚删完所有 server 都掉了"。
        const nextMounts = [];
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
                }
                catch (error) {
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
            for (const record of sessions.values())
                applyRestrictions(record);
        }
        finally {
            globalMounts = nextMounts;
            settling -= 1;
        }
    }
    /** 全局层重挂串行化：并发触发会落在队尾依次执行。 */
    function scheduleGlobalRemount() {
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
    async function remount(record) {
        settling += 1;
        // 同全局层：新一代状态攒本地、换代完成才替换，避免重挂期间出现
        // "该项目所有 server 都掉了"的假象。
        const nextMounts = [];
        try {
            disposeRestrictions(record);
            const previous = record.fibers;
            record.fibers = [];
            // 上一代 fiber 并联释放（各 fiber 独立，失败不挡住新一代挂载）。
            await Promise.all(previous.map((fiber) => fiber.dispose().catch(() => undefined)));
            if (!enabled)
                return;
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
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const conflict = /already in use/.test(message);
                    nextMounts.push({ key, serverName, state: conflict ? "conflict" : "failed", error: conflict ? SESSION_CONFLICT_NOTE : message });
                    logger.warn?.(`capability-panel: MCP server "${key}" not mounted for session ${record.agent.id}: ${message}`);
                }
            }
            // 全局屏蔽在项目层挂载之后重算：本代的 scoped 注册与全局可见性都已就位。
            applyRestrictions(record);
        }
        finally {
            record.mounts = nextMounts;
            settling -= 1;
        }
    }
    /** 每个 session 串行化重挂：并发触发会落在队尾合并执行。 */
    function scheduleRemount(record) {
        const run = record.queue.then(() => remount(record));
        record.queue = run.catch(() => undefined);
        return run;
    }
    /** 登记一个新 agent 并触发首轮挂载（跳过无 ctx/id 的 stub）。 */
    function mountAgent(agent) {
        if (agent?.ctx === undefined || agent?.id === undefined)
            return;
        if (sessions.has(agent.id))
            return;
        const cwd = typeof agent.session?.header?.cwd === "string" ? agent.session.header.cwd : undefined;
        const record = {
            agent,
            cwd,
            projectRoot: cwd !== undefined ? findProjectRoot(cwd) : undefined,
            fibers: [],
            restrictDisposers: [],
            mounts: [],
            restrictions: [],
            appliedDeny: [],
            restrictTargets: [],
            queue: Promise.resolve(),
        };
        sessions.set(agent.id, record);
        scheduleRemount(record).catch((error) => {
            logger.warn?.(`capability-panel: MCP mount sweep failed for session ${agent.id}: ${String(error)}`);
        });
    }
    if (enabled) {
        // 新 agent 创建 / 释放时维护簿记（挂载的 fiber 与 restrict 都由 agent
        // 上下文自动解绑，这里只需清掉记录）。
        ctx.on("agent/created", ({ agent }) => mountAgent(agent));
        ctx.on("agent/disposed", ({ agent }) => {
            if (agent?.id !== undefined) {
                sessions.delete(agent.id);
                sessionToggles.delete(agent.id);
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
    async function setSessionEnabled(input) {
        let toggles = sessionToggles.get(input.sessionId);
        if (toggles === undefined) {
            toggles = new Map();
            sessionToggles.set(input.sessionId, toggles);
        }
        const toggleKey = input.kind === "project" ? projectToggleKey(input.target) : serverToggleKey(input.target);
        if (input.enabled === undefined)
            toggles.delete(toggleKey);
        else
            toggles.set(toggleKey, input.enabled);
        // 找到这个 session 的记录并只重挂它（项目条目挂载 / restrict 都要重算）。
        const record = [...sessions.values()].find((item) => item.agent?.id === input.sessionId);
        if (record !== undefined)
            await scheduleRemount(record);
    }
    /** 读某个 session 的显式开关表（供 list/runtime 投影 enabledInSession）。 */
    function sessionToggleState(sessionId) {
        if (sessionId === undefined)
            return {};
        return Object.fromEntries(sessionToggles.get(sessionId) ?? []);
    }
    return {
        setSessionEnabled,
        sessionToggleState,
        /** 状态视图；传 cwd 时按项目根过滤 session，全局层哨兵恒返回（见模块头注释）。 */
        status(cwd) {
            if (!enabled)
                return [];
            const projectRoot = cwd !== undefined ? findProjectRoot(cwd) : undefined;
            // 该项目里已被 restrict **生效**屏蔽的全局键：从哨兵记录里剔除，避免
            // 面板把"本项目禁用"的全局 server 显示成"已挂载"。降级（skipped /
            // failed）的键不移除——那时全局工具确实对本会话可见，如实展示。
            const restrictedForProject = new Set();
            if (projectRoot !== undefined) {
                for (const record of sessions.values()) {
                    if (record.projectRoot !== projectRoot)
                        continue;
                    for (const restriction of record.restrictions) {
                        if (restriction.state === "applied")
                            restrictedForProject.add(restriction.key);
                    }
                }
            }
            const views = [
                {
                    sessionId: GLOBAL_MOUNT_SESSION_ID,
                    scope: "global",
                    servers: globalMounts.filter((mount) => !restrictedForProject.has(mount.key)).map((mount) => ({ ...mount })),
                    ...(settling > 0 ? { settling: true } : {}),
                },
            ];
            for (const [sessionId, record] of sessions) {
                if (projectRoot !== undefined && record.projectRoot !== projectRoot)
                    continue;
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
        async reload(projectRoot) {
            const tasks = [];
            if (projectRoot === undefined && enabled)
                tasks.push(scheduleGlobalRemount());
            for (const record of sessions.values()) {
                if (projectRoot !== undefined && record.projectRoot !== projectRoot)
                    continue;
                tasks.push(scheduleRemount(record));
            }
            await Promise.allSettled(tasks);
        },
    };
}
