/**
 * MCP 管理服务（挂载为 `ctx.capabilityPanel.mcp`）：对项目/全局 MCP 配置
 * 文件的 CRUD，叠加 loader 报告的实时挂载状态。
 *
 * 每次成功写入都会触发一次针对性的 loader reload，让改动无需重启即可在
 * 存活 session 中生效（项目写入只重挂该项目根的 session；全局写入重挂全部）。
 *
 * @module dsh-capability-settings/mcp/manager
 */
import { findProjectRoot } from "../shared/project-root.js";
import { displayNameOfSource } from "../shared/plugin-attribution.js";
import { mcpDefaultSets as mcpDefaultSetsOf } from "../shared/mcp-defaults.js";
import { MCP_USAGE_VIEW_LIMIT } from "./types.js";
import { parseMcpToolName } from "./usage.js";
import { withFileLock } from "../shared/file-lock.js";
import { errMessage } from "../shared/errors.js";
import { locateConfigFile, removeFiles } from "../shared/config-location.js";
import { readMcpFile, sanitizeServerName, summarizeEntry, transportOf, validateEntry, writeMcpFile } from "./config-file.js";
import { probeMcpServer } from "./probe.js";
import { GLOBAL_MCP_FILE_NAME, globalMcpDirs, projectMcpFile } from "./paths.js";
import { INVISIBLE_CAPABILITY_ERROR } from "../shared/visibility.js";
/** 全空 MCP 三层默认（无 overrides 管理器 / 读取失败时的降级值）。 */
const EMPTY_DEFAULT_SETS = {
    globalDisabled: [],
    projectDisabled: [],
    projectEnabled: [],
    effectiveDisabled: [],
};
/** 创建管理服务；loader 由 index.ts 注入（自动挂载与状态共用同一实例）。 */
export function createMcpManager(deps, loader, overrides, imports) {
    /**
     * 按作用域解析配置文件位置：全局写入 `<agentsHome>/mcp.json`（读取兼容
     * 旧位置 dsh home / `~/.claude`）；项目固定 `<项目根>/.mcp.json`。
     * 项目作用域缺少 cwd 时抛错。
     */
    function locationFor(scope, cwd) {
        if (scope === "global") {
            return locateConfigFile(globalMcpDirs(deps), GLOBAL_MCP_FILE_NAME);
        }
        if (cwd === undefined)
            throw new Error("project scope requires a workspace path");
        const file = projectMcpFile(cwd);
        return { writeFile: file, readFile: file, legacyFiles: [] };
    }
    /**
     * 一次写操作的公共骨架：在写入目标上加文件锁，读生效位置 → 修改 →
     * 写回写入目标 → 删除旧文件（全局作用域为 .agents 迁移，项目作用域无旧文件）。
     * 泛型 T 让 importToProject 这类操作能在失败信封上附带额外字段（existed）。
     */
    async function withLockedFile(input, mutate) {
        const loc = locationFor(input.scope, input.cwd);
        try {
            return await withFileLock(loc.writeFile, async () => {
                const servers = await readMcpFile(loc.readFile);
                const result = await mutate(servers, loc.readFile);
                if (!result.ok)
                    return result;
                await writeMcpFile(loc.writeFile, servers);
                await removeFiles(loc.legacyFiles);
                return result;
            });
        }
        catch (error) {
            // 失败信封不含 T 的附加字段（existed 缺省即"无冲突"语义），收窄是安全的。
            return { ok: false, errors: [errMessage(error)] };
        }
    }
    /**
     * 写入落盘后触发重挂：项目只重挂该项目根的 session，全局换代整个全局层。
     *
     * **故意不 await**（fire-and-forget）：全局写入会重挂所有全局 server，而桥接层
     * 的 `await fiber` 要等**每条 server 起进程 + MCP 握手**完成——本机 5 条 stdio
     * server 走 `npx`/`bunx` 冷启动，等待会让 `mcp.remove` / `mcp.upsert` /
     * `mcp.setEnabled` 这类 RPC 卡住数秒到数十秒。面板的刷新跟在 RPC 之后，于是
     * 表现为"删掉了但列表不消失，切页回来才看到"（那时文件早已写好）。
     *
     * 现在写入只等**文件落盘**就返回：紧随其后的 `mcp.list` 立刻是新的；挂载状态
     * 由 loader 自己的串行队列在后台收敛，并通过 `status().settling` 告知面板
     * "还在重挂"，面板据此短暂轮询（见 `mcp-panel` 的 settle 轮询）。
     *
     * 这里只做兜底 catch：`loader.reload()` 内部用 `Promise.allSettled` 且逐条把
     * 失败归因到状态里，正常情况下不会 reject。
     */
    function reloadFor(scope, cwd) {
        const task = scope === "global" ? loader.reload() : cwd !== undefined ? loader.reload(findProjectRoot(cwd)) : Promise.resolve();
        void task.catch(() => undefined);
    }
    /**
     * 合并列表：全局 + 项目原生 + 项目级引用（同名键项目遮蔽全局），按 key 排序。
     * 传入 cwd 时应用该工作区的「有效默认」（可见性 + 每工作区默认 + 项目三态）：
     * 不可见的**全局配置条目**从工作区视图隐藏并计入 `hiddenCount`（全局视图仍
     * 展示，带「不可见」标签）；项目原生条目 / 项目引用不做可见性、恒列出。
     * 引用（`.agents/capability-imports.json`）不是物理副本：视图内容实时取自
     * 同名全局条目，仅启停来自引用上的项目级 `disabled` 标记；被引用的全局
     * 原版与项目原生遮蔽一样标 `shadowed`。
     * 单个文件解析失败收集到 errors，不中断整体返回。
     */
    async function list(cwd, sessionId) {
        const errors = [];
        // 冷会话（teammate 已结束）的显式开关不在内存里；读投影前先从磁盘恢复，
        // 否则面板会先按默认全开渲染，直到用户改一项触发 hydrate 才突然跳到快照。
        if (sessionId !== undefined) {
            await loader.hydrateSession(sessionId, cwd !== undefined ? { cwd } : {}).catch(() => undefined);
        }
        const globalLocation = locationFor("global");
        const projectFile = cwd !== undefined ? projectMcpFile(cwd) : undefined;
        // 项目级禁用的全局 server 键集合（无 cwd 或读取失败时为空集合）。
        const disabledMcp = new Set((await overrides?.sets(cwd))?.mcp ?? []);
        // 两个配置文件并行解析；各自失败互不影响。
        const [globalServers, projectServers] = await Promise.all([
            readMcpFile(globalLocation.readFile).catch((error) => {
                errors.push(errMessage(error));
                return {};
            }),
            projectFile !== undefined
                ? readMcpFile(projectFile).catch((error) => {
                    errors.push(errMessage(error));
                    return {};
                })
                : Promise.resolve({}),
        ]);
        /** 把磁盘条目投影成面板视图。 */
        const view = (key, entry, scope, filePath, shadowed) => ({
            key,
            serverName: sanitizeServerName(key),
            transport: transportOf(entry),
            scope,
            enabled: entry.disabled !== true,
            shadowed,
            summary: summarizeEntry(entry),
            entry,
            filePath,
            // 导入标记只会出现在旧版「导入 = 物理复制」写入的项目副本上，原样透传。
            ...(entry.importedFromGlobal === true ? { importedFromGlobal: true } : {}),
        });
        /**
         * 本会话的显式开关（内存内）：`project:<configKey>` / `server:<serverName>`。
         * 未设置时跟随项目级默认（`disabledInProject` = 默认关闭）。
         */
        const toggles = loader.sessionToggleState?.(sessionId) ?? {};
        const sessionEnabledOf = (toggleKey, defaultEnabled) => Object.hasOwn(toggles, toggleKey) ? toggles[toggleKey] : defaultEnabled;
        const globalRows = [];
        // v21 可见性：只有**全局配置条目**参与（项目原生 / 引用不受影响）。
        const globalCapabilities = await capabilityDefaultsOf(cwd, Object.keys(globalServers).map((key) => sanitizeServerName(key)));
        /** 工作区视图里被可见性隐藏的全局配置条目数（`hiddenCount`）。 */
        let hiddenCount = 0;
        for (const [key, entry] of Object.entries(globalServers)) {
            const row = view(key, entry, "global", globalLocation.readFile, projectServers[key] !== undefined);
            const capability = globalCapabilities.get(row.serverName);
            if (capability !== undefined) {
                row.visibilityMode = capability.visibilityMode;
                row.visibleWorkspaceCount = capability.visibleWorkspaceCount;
            }
            if (capability?.visibilityMode === "none") {
                // 全局视图：mode=none 的能力对所有工作区都不可见 ⇒ 行开关禁用并标注。
                row.disabledByVisibility = true;
            }
            if (cwd !== undefined) {
                const visible = capability?.visible ?? true;
                row.visibleInWorkspace = visible;
                if (!visible) {
                    // 工作区视图不展示不可见条目（全局视图仍展示，带「不可见」标签）。
                    row.disabledByVisibility = true;
                    hiddenCount += 1;
                    continue;
                }
            }
            // 全局视图没有「工作区默认」概念：沿用旧口径（项目禁用清单，全局视图为空 =
            // 启用；配置级 disabled 另由 enabled 字段表达）。工作区视图用统一默认快照。
            const defaultEnabled = cwd !== undefined
                ? (capability?.effectiveDefaultEnabled ?? !disabledMcp.has(key))
                : !disabledMcp.has(key);
            if (cwd !== undefined && !defaultEnabled)
                row.disabledInProject = true;
            const enabledInSession = sessionEnabledOf(`server:${row.serverName}`, defaultEnabled);
            if (enabledInSession !== undefined)
                row.enabledInSession = enabledInSession;
            globalRows.push(row);
        }
        const projectRows = [];
        if (projectFile !== undefined) {
            for (const [key, entry] of Object.entries(projectServers)) {
                const row = view(key, entry, "project", projectFile, false);
                // 项目自己的条目（`.mcp.json`）不做可见性：工作区视图恒可见（显式 true，
                // 与全局配置条目同形，便于前端统一判断）。
                if (cwd !== undefined)
                    row.visibleInWorkspace = true;
                // 项目条目也受「默认开关」管理（overrides 的 mcp 列表同样收项目 key）。
                const defaultEnabled = !disabledMcp.has(key);
                if (!defaultEnabled)
                    row.disabledInProject = true;
                const enabledInSession = sessionEnabledOf(`project:${key}`, defaultEnabled);
                if (enabledInSession !== undefined)
                    row.enabledInSession = enabledInSession;
                projectRows.push(row);
            }
        }
        // 解析项目级引用：同名项目原生条目优先（引用视图不重复出现）；全局
        // 条目已不存在的是悬空引用，跳过（imports 记录留待用户「移出」清理）。
        if (cwd !== undefined && imports !== undefined) {
            const refs = await imports.entries(cwd, "mcp");
            for (const [key, ref] of Object.entries(refs)) {
                if (projectServers[key] !== undefined)
                    continue;
                const globalEntry = Object.hasOwn(globalServers, key) ? globalServers[key] : undefined;
                if (globalEntry === undefined)
                    continue;
                const globalRow = globalRows.find((row) => row.key === key);
                if (globalRow !== undefined)
                    globalRow.shadowed = true;
                const refRow = view(key, globalEntry, "project", globalLocation.readFile, false);
                // 项目级引用同属「项目自己的选用」：不做可见性，工作区视图恒可见。
                refRow.visibleInWorkspace = true;
                const refDefaultEnabled = !disabledMcp.has(key);
                if (!refDefaultEnabled)
                    refRow.disabledInProject = true;
                const refEnabledInSession = sessionEnabledOf(`project:${key}`, refDefaultEnabled);
                if (refEnabledInSession !== undefined)
                    refRow.enabledInSession = refEnabledInSession;
                projectRows.push({
                    ...refRow,
                    // 启停是引用上的项目级状态，且引用是显式的项目级选用：**启用态的
                    // 引用覆盖全局条目自身的 disabled 默认**（与项目原生条目在挂载合并
                    // 里的口径一致——同名原生条目 enabled 时也不受全局 disabled 影响）。
                    enabled: ref.disabled !== true,
                    importedFromGlobal: true,
                    reference: true,
                });
            }
        }
        const views = [...projectRows, ...globalRows];
        views.sort((a, b) => a.key.localeCompare(b.key));
        return { servers: views, errors, hiddenCount };
    }
    /** 新增或整体覆盖一条 server（校验失败不落盘），成功后重挂。 */
    async function upsert(input) {
        const errors = validateEntry(input.key, input.entry);
        if (errors.length > 0)
            return { ok: false, errors };
        const result = await withLockedFile(input, async (servers) => {
            servers[input.key] = input.entry;
            return { ok: true };
        });
        if (!result.ok)
            return result;
        reloadFor(input.scope, input.cwd);
        return { ok: true };
    }
    /** 删除一条 server（不存在时返回错误信息），成功后重挂。
     *  项目作用域下：原生条目删文件；无原生条目但有同名引用时改为移除引用（「移出」）。 */
    async function remove(input) {
        if (input.scope === "project" && imports !== undefined && input.cwd !== undefined && (await isReference(input.cwd, input.key))) {
            const result = await imports.remove({ cwd: input.cwd, domain: "mcp", name: input.key });
            if (result.ok)
                reloadFor("project", input.cwd);
            return result;
        }
        const result = await withLockedFile(input, async (servers, readFile) => {
            // 用 Object.hasOwn 判存在：普通属性查找会把 `__proto__` 等原型链上
            // 的对象误判为"已存在"。
            if (!Object.hasOwn(servers, input.key)) {
                return { ok: false, errors: [`no MCP server named "${input.key}" in ${readFile}`] };
            }
            delete servers[input.key];
            return { ok: true };
        });
        if (!result.ok)
            return result;
        reloadFor(input.scope, input.cwd);
        return { ok: true };
    }
    /**
     * 项目作用域的键是否由"引用"承载（无同名原生条目、但引用表里存在）。
     * 启停/删除据此路由到引用存储而不是项目配置文件。原生条目恒优先：
     * 同名原生存在时引用记录被遮蔽（list 里也不出现），写路径一律落文件。
     */
    async function isReference(cwd, key) {
        if (imports === undefined)
            return false;
        const servers = await readMcpFile(projectMcpFile(cwd)).catch(() => ({}));
        if (Object.hasOwn(servers, key))
            return false;
        const refs = await imports.entries(cwd, "mcp");
        return Object.hasOwn(refs, key);
    }
    /** 切换启用/禁用（保留条目，只动 disabled 键），成功后重挂。
     *  项目作用域下：原生条目写文件；引用条目只切换引用上的项目级标记（全局配置不动）。 */
    async function setEnabled(input) {
        if (input.scope === "project" && imports !== undefined && input.cwd !== undefined && (await isReference(input.cwd, input.key))) {
            const result = await imports.setEnabled({ cwd: input.cwd, domain: "mcp", name: input.key, enabled: input.enabled });
            if (result.ok)
                reloadFor("project", input.cwd);
            return result;
        }
        const result = await withLockedFile(input, async (servers, readFile) => {
            const entry = Object.hasOwn(servers, input.key) ? servers[input.key] : undefined;
            if (entry === undefined) {
                return { ok: false, errors: [`no MCP server named "${input.key}" in ${readFile}`] };
            }
            if (input.enabled) {
                delete entry.disabled;
            }
            else {
                entry.disabled = true;
            }
            return { ok: true };
        });
        if (!result.ok)
            return result;
        reloadFor(input.scope, input.cwd);
        return { ok: true };
    }
    /**
     * 把全局 server 导入到当前项目：**登记一条引用**（写入
     * `<项目根>/.agents/capability-imports.json`），不是物理复制——内容始终
     * 跟随全局条目，全局更新实时生效；项目级启停记录在引用上（见
     * imports/manager.ts）。引用与项目原生条目同级参与挂载合并（遮蔽全局原版）。
     * 项目内已有同名**原生**条目时报硬错误（原生优先，引用无意义）；已有同名
     * 引用且未要求 overwrite 时返回 existed（overwrite 下幂等成功）。
     * 成功后重挂本项目的 session。
     */
    async function importToProject(input) {
        if (input.cwd === undefined)
            return { ok: false, errors: ["importToProject requires a workspace path"] };
        if (imports === undefined)
            return { ok: false, errors: ["imports store unavailable"] };
        let globalServers;
        try {
            globalServers = await readMcpFile(locationFor("global").readFile);
        }
        catch (error) {
            return { ok: false, errors: [errMessage(error)] };
        }
        // 用 Object.hasOwn 判存在：原型链上的键（__proto__ 等）不算条目。
        if (!Object.hasOwn(globalServers, input.key)) {
            return { ok: false, errors: [`no global MCP server named "${input.key}"`] };
        }
        // 项目内已有同名原生条目时引用无意义（原生在挂载合并里恒优先），
        // 报硬错误而非覆盖用户配置。
        const projectServers = await readMcpFile(projectMcpFile(input.cwd)).catch(() => ({}));
        if (Object.hasOwn(projectServers, input.key)) {
            return { ok: false, errors: [`项目内已有同名原生服务器 "${input.key}"，无需也无法导入引用`] };
        }
        const result = await imports.import({ cwd: input.cwd, domain: "mcp", name: input.key, overwrite: input.overwrite });
        if (!result.ok)
            return result;
        reloadFor("project", input.cwd);
        return { ok: true };
    }
    /** 实时挂载状态：直接透传 loader 的视图。 */
    function status(cwd) {
        return loader.status(cwd);
    }
    /**
     * 「测试」：先做与 upsert 同一口径的**静态校验**（失败直接返回 errors，
     * 不发起任何连接），再真实连接这份草稿配置并列出工具名与入参。
     *
     * 纯探测、零副作用：不落盘、不触 loader.reload、不注册任何工具、不留子
     * 进程（见 mcp/probe.ts）。因此可以直接测面板里还没保存的表单草稿。
     */
    async function test(input) {
        // 键名只影响命名空间；草稿没填名字时也能测（回落 "server"，与
        // sanitizeServerName 的兜底一致），静态校验仍按该键名跑一遍。
        const key = typeof input.key === "string" && input.key.trim().length > 0 ? input.key.trim() : "server";
        const entry = input.entry !== null && typeof input.entry === "object" && !Array.isArray(input.entry) ? input.entry : {};
        const errors = validateEntry(key, entry);
        if (errors.length > 0)
            return { ok: false, errors };
        return probeMcpServer({ key, entry, cwd: input.cwd, timeoutMs: input.timeoutMs });
    }
    /**
     * 最近 MCP 工具调用记录（**只读、内存内、不落盘**）。
     *
     * 记录来自 loader/index 在宿主注册的 `tools.guard` 旁路（见 mcp/usage.ts），
     * 因此进程重启/插件重载即清空；这里只做查询与过滤，绝不写任何文件。
     */
    function usage(input) {
        const log = deps.usage;
        if (log === undefined)
            return { entries: [], limit: MCP_USAGE_VIEW_LIMIT };
        return log.query(input);
    }
    /**
     * 读 MCP 三层默认集合（v20.2）：优先 `overrides.mcpDefaultSets`（全局默认 ∪
     * 工作区显式），兼容只实现 `sets()` 的旧注入管理器（那时没有全局默认层）。
     * 任何失败降级为全空，不影响外部实例列表。
     */
    async function defaultSetsOf(cwd) {
        if (overrides === undefined)
            return EMPTY_DEFAULT_SETS;
        if (typeof overrides.mcpDefaultSets === "function") {
            try {
                return await overrides.mcpDefaultSets(cwd);
            }
            catch {
                return EMPTY_DEFAULT_SETS;
            }
        }
        try {
            const mcp = (await overrides.sets(cwd))?.mcp ?? [];
            return mcpDefaultSetsOf({ globalDisabled: [], projectDisabled: mcp, projectEnabled: [] });
        }
        catch {
            return EMPTY_DEFAULT_SETS;
        }
    }
    /**
     * 取某个工作区的 MCP 能力默认快照（可见性 + 每工作区默认 + 项目三态覆盖，v21）。
     *
     * 优先 `overrides.capabilityDefaultsMany`（唯一计算入口）；旧注入管理器没有该
     * 方法时返回空 map，调用方回退 v20.2 的 `defaultSetsOf` 语义（全部可见）。
     */
    async function capabilityDefaultsOf(cwd, keys) {
        if (overrides === undefined || keys.length === 0)
            return new Map();
        if (typeof overrides.capabilityDefaultsMany !== "function")
            return new Map();
        try {
            return await overrides.capabilityDefaultsMany("mcp", keys, cwd);
        }
        catch {
            return new Map();
        }
    }
    /**
     * **运行时注入**的 MCP 实例（只读）：不是本插件配置文件里的条目，而是其它插件或
     * profile 在运行时挂载的 mcp-client。
     *
     * 发现与补全（并集，全部只读）：
     *  1. `deps.scanInjected()`：cordis 注册表里的动态 fiber + loader 条目 → 拿到
     *     **来源插件名**与桥接层配置（传输/命令），这是"像自己配置那样展示"的数据源；
     *  2. 全局工具注册表：按 `mcp__<serverName>__*` 分组 → 工具名/描述/**参数**；
     *  3. 内存使用记录：补上只在 agent 作用域可见、或只被调用过的实例（并给出调用次数）。
     *
     * 本插件自己管理（或配置文件里声明过）的 serverName 一律排除；`cwd` 用于判断
     * 本工作区是否被默认关闭（v20.2 起为「有效默认」：全局默认 ∪ 项目默认 \
     * 项目重新打开），外部实例的开关走的就是这条链路。
     */
    async function runtime(input) {
        if (input?.sessionId !== undefined) {
            await loader.hydrateSession(input.sessionId, input.cwd !== undefined ? { cwd: input.cwd } : {}).catch(() => undefined);
        }
        const owned = new Set();
        try {
            for (const status of loader.status())
                for (const server of status.servers)
                    owned.add(server.serverName);
        }
        catch {
            /* status 不可用：只靠文件条目 */
        }
        try {
            for (const server of (await list()).servers)
                owned.add(server.serverName);
        }
        catch {
            /* 文件读失败不影响外部视图 */
        }
        // 三层默认（v20.2）：全局默认关闭 / 工作区有效默认关闭。
        const defaults = await defaultSetsOf(input?.cwd);
        const globalDisabled = new Set(defaults.globalDisabled);
        const effectiveDisabled = new Set(defaults.effectiveDisabled);
        // serverName → 视图（先放发现器给的来源/配置，随后用工具注册表补工具）。
        const groups = new Map();
        const ensure = (serverName, origin) => {
            const existing = groups.get(serverName);
            if (existing !== undefined)
                return existing;
            const created = { serverName, origin, restrictable: false, tools: [], calls: 0 };
            groups.set(serverName, created);
            return created;
        };
        try {
            for (const injected of deps.scanInjected?.() ?? []) {
                if (owned.has(injected.serverName))
                    continue;
                // 先到先得：真实例（fiber / loader 条目）优先，命名空间合成行**不覆盖**
                // 已有实例（方案 §7.2-5；发现器已按此顺序合并，这里再防一次乱序）。
                if (groups.has(injected.serverName))
                    continue;
                const view = ensure(injected.serverName, injected.origin);
                // R4：命名空间合成行 = 无实例、无配置（详情文案据此标「工具命名空间合成」）。
                if (injected.origin === "namespace")
                    view.synthesized = true;
                if (injected.source !== undefined) {
                    // source 保留原文，channel 是映射表归一后的展示名（两者都放视图里）。
                    view.source = injected.source;
                    const channel = displayNameOfSource(injected.source);
                    view.channel = channel;
                    view.attribution =
                        injected.origin === "namespace"
                            ? { matchedBy: "namespace", pattern: injected.serverName }
                            : { matchedBy: "source", pattern: injected.source };
                }
                else {
                    // 无来源：不猜（面板标「来源未识别」）。
                    view.attribution = { matchedBy: "unknown" };
                }
                const config = injected.config;
                if (config !== undefined) {
                    try {
                        view.transport = transportOf(config);
                        view.summary = summarizeEntry(config);
                    }
                    catch {
                        /* 配置形状异常：只保留来源 */
                    }
                }
            }
        }
        catch {
            /* 发现器失败：继续用工具注册表 + 使用记录 */
        }
        try {
            const schemas = deps.tools?.()?.schemas?.() ?? [];
            for (const schema of Array.isArray(schemas) ? schemas : []) {
                const parsed = parseMcpToolName(typeof schema?.name === "string" ? schema.name : "");
                if (parsed === undefined || owned.has(parsed.serverName))
                    continue;
                const existing = groups.get(parsed.serverName);
                // R4：没有任何发现记录（fiber / 条目 / namespace）时，工具注册表反推路径
                // 产出的就是「工具命名空间合成」行（现状写死 "fiber" 是错的）。
                const view = existing ?? ensure(parsed.serverName, "namespace");
                if (existing === undefined) {
                    view.synthesized = true;
                    view.attribution = { matchedBy: "unknown" };
                }
                view.tools.push({
                    name: parsed.tool,
                    ...(typeof schema?.description === "string" && schema.description.length > 0 ? { description: schema.description } : {}),
                    ...(schema?.parameters !== null && typeof schema?.parameters === "object" ? { parameters: schema.parameters } : {}),
                });
            }
        }
        catch {
            /* 工具服务不可用：降级 */
        }
        try {
            for (const serverName of deps.usage?.serverNames?.() ?? []) {
                if (owned.has(serverName))
                    continue;
                ensure(serverName, "fiber");
            }
        }
        catch {
            /* 使用记录不可用：忽略 */
        }
        const toggles = loader.sessionToggleState?.(input?.sessionId) ?? {};
        // v21：可见性 + 每工作区默认（一次批量读取；旧管理器返回空 map ⇒ 回退 v20.2）。
        const capabilities = await capabilityDefaultsOf(input?.cwd, [...groups.keys()]);
        /** 工作区视图里被可见性隐藏的外部注入实例数。 */
        let hiddenCount = 0;
        const servers = [];
        for (const view of groups.values()) {
            view.restrictable = view.tools.length > 0;
            const capability = capabilities.get(view.serverName);
            // 全局默认关闭 = **原始**全局名单成员；工作区视图与 disabledInProject 组合出
            // 「已覆盖全局默认」（见 types.ts 字段注释）。
            if (globalDisabled.has(view.serverName))
                view.disabledGlobally = true;
            if (capability !== undefined) {
                view.visibilityMode = capability.visibilityMode;
                view.visibleWorkspaceCount = capability.visibleWorkspaceCount;
                if (capability.visibilityMode === "none")
                    view.disabledByVisibility = true;
                if (input?.cwd !== undefined) {
                    view.visibleInWorkspace = capability.visible;
                    if (!capability.visible) {
                        view.disabledByVisibility = true;
                        hiddenCount += 1;
                        continue; // 工作区视图不展示不可见条目
                    }
                }
            }
            // 本工作区有效默认关闭（可见性 + 每工作区默认 + 项目三态）；旧管理器回退 v20.2。
            const defaultEnabled = capability !== undefined ? capability.effectiveDefaultEnabled : !effectiveDisabled.has(view.serverName);
            if (!defaultEnabled)
                view.disabledInProject = true;
            // 显式会话开关最高，其次跟随有效默认。
            const enabledInSession = Object.hasOwn(toggles, `server:${view.serverName}`)
                ? toggles[`server:${view.serverName}`]
                : defaultEnabled;
            if (view.restrictable)
                view.enabledInSession = enabledInSession;
            try {
                view.calls = deps.usage?.count?.(view.serverName) ?? 0;
            }
            catch {
                view.calls = 0;
            }
            servers.push(view);
        }
        return { servers: servers.sort((a, b) => a.serverName.localeCompare(b.serverName)), hiddenCount };
    }
    /**
     * 设置某个 session 的手动能力开关（内存内）：项目条目按需挂载/卸载，
     * 全局配置条目与外部注入实例用 `tools.restrict` 屏蔽/恢复其工具。
     */
    async function setSessionEnabled(input) {
        if (typeof input?.sessionId !== "string" || input.sessionId.length === 0) {
            return { ok: false, errors: ["sessionId is required"] };
        }
        if (typeof input.target !== "string" || input.target.length === 0) {
            return { ok: false, errors: ["target is required"] };
        }
        // v21：不可见能力的会话开关一律拒绝（全局层实例 / 外部注入实例；项目条目
        // 不受可见性影响，仍可开关）。
        if (input.kind === "server" && overrides !== undefined) {
            const names = [...new Set([input.target, sanitizeServerName(input.target)])];
            const capabilities = await capabilityDefaultsOf(input.cwd, names);
            if (names.some((name) => capabilities.get(name)?.visible === false)) {
                return { ok: false, errors: [INVISIBLE_CAPABILITY_ERROR] };
            }
        }
        await loader.setSessionEnabled(input);
        return { ok: true };
    }
    /**
     * 批量设置某个 session 的手动开关（性能路径）：一次 hydrate → 一次落盘 →
     * **一次**重挂（逐条调用会排队 N 次 remount，150 条量级不可接受）。
     *
     * 与 `setSessionEnabled` 语义一致：`enabled === undefined` 清除显式覆盖。
     * loader 侧逐条写入失败只 warn、不抛，因此这里只校验入参形状。
     */
    async function setSessionEnabledMany(input) {
        if (typeof input?.sessionId !== "string" || input.sessionId.length === 0) {
            return { ok: false, errors: ["sessionId is required"] };
        }
        if (!Array.isArray(input.entries)) {
            return { ok: false, errors: ["entries must be an array"] };
        }
        const entries = input.entries.filter((entry) => entry !== null && typeof entry === "object" && typeof entry.target === "string" && entry.target.length > 0);
        if (entries.length === 0)
            return { ok: true };
        // v21：批量路径跳过不可见能力（单条路径返回业务失败；批量不因个别不可见整批失败）。
        const serverTargets = entries.filter((entry) => entry.kind === "server");
        let visibleEntries = entries;
        if (serverTargets.length > 0 && overrides !== undefined) {
            const names = [
                ...new Set(serverTargets.flatMap((entry) => [entry.target, sanitizeServerName(entry.target)])),
            ];
            const capabilities = await capabilityDefaultsOf(input.cwd, names);
            visibleEntries = entries.filter((entry) => entry.kind !== "server" ||
                capabilities.get(entry.target)?.visible !== false ||
                capabilities.get(sanitizeServerName(entry.target))?.visible !== false);
            if (visibleEntries.length === 0)
                return { ok: true };
        }
        await loader.setSessionEnabledMany({
            sessionId: input.sessionId,
            ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
            entries: visibleEntries,
        });
        return { ok: true };
    }
    return {
        list,
        upsert,
        remove,
        setEnabled,
        importToProject,
        status,
        test,
        usage,
        runtime,
        setSessionEnabled,
        setSessionEnabledMany,
    };
}
