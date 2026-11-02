/**
 * 默认关闭管理服务（挂载为 `ctx.capabilityPanel.overrides`）。
 *
 * **三层存储**（B2，v20.1；v20.2 扩到 MCP；v21 扩到 Tools + 可见性 + 全局文件 v2）：
 *
 *   1. **全局层**：`<dshHome>/dsh-capability-settings/capability-global-overrides.json`
 *      ——`{ version: 1, skills: string[], mcp: string[] }`，全局默认关闭名单；
 *      不改技能文件、不改 MCP 注入方配置、不卸载共享实例。
 *      面板全局视图的 Skills / 外部注入 MCP / Tools 兜底默认写这里
 *      （见 {@link globalToggle} / {@link globalToggleMany}）；v21 起的 `visibility`
 *      也在这里（{@link setVisibility}）。
 *   2. **项目层（统一存储）**：`<dshHome>/dsh-capability-settings/capability-overrides.json`
 *      ——一个文件按**项目根**（`findProjectRoot(cwd)`）分 key，记录每个项目默认
 *      关闭的 MCP server / Skill，以及（B2）本项目**显式重新打开**的 Skill /
 *      MCP server（`enabledSkills` / `enabledMcp`）。MCP 列表读取、MCP 自动挂载、
 *      技能默认投影共用它的 `sets()` 快照；面板通过 `get()` 读全量、`toggle()`
 *      切换某一条。
 *
 * **有效默认**（契约 §1.3）：
 *
 *   - Skills：`(global.skills ∪ project.skills) \ project.enabledSkills`；
 *     `defaultSets()` / {@link effectiveDisabledSkills} 是唯一计算入口；
 *   - MCP：`(global.mcp ∪ project.mcp) \ project.enabledMcp`；
 *     {@link mcpDefaultSets} 是旧计算入口（实现见 `shared/mcp-defaults.ts`）。
 *
 * **v21 的统一计算入口**是 {@link capabilityDefaults} / {@link capabilityDefaultsMany}：
 * `visible && (projectOverride ?? workspaces[ws].defaultEnabled ?? !兜底全局默认关闭)`
 * ——可见性 + 每工作区默认 + 项目三态合并成一个快照，三域列表投影与运行时 gate
 * 都从它取值（见 `shared/visibility.ts`）。
 *
 * **旧位置兼容**：`<项目根>/.agents/capability-overrides.json`（以及更早的
 * `.dsh` / `.claude`）仍会被读取；某个项目在统一存储里还没有记录时，`sets()`
 * 回退到旧文件。首次 `toggle()` 会把旧内容并入统一存储并删除项目内旧文件
 * （之后旧文件不再生效，避免同一份声明两处维护）。
 *
 * `skills` 域对**磁盘技能与注入技能**都生效：磁盘技能靠 agent 作用域 runtime
 * shadow（与全局层投影片同一条机制），注入技能同样是 runtime shadow；由组合根在
 * 写盘成功后对同项目的 live 会话（全局层则对所有 live 会话）做增量 reconcile
 * （见 `index.ts` / `skills/session.ts`）。`mcp` 域的全局默认由组合根在写盘后
 * 调 `loader.refreshRestrictions()` 热应用（不重挂 fiber）。
 *
 * 无工作区（cwd 为 undefined）时不适用任何项目级禁用：`sets()` 返回全空
 * 快照，`toggle()` 直接报错；全局层不受工作区影响。
 *
 * @module dsh-capability-settings/overrides/manager
 */
import { findProjectRoot } from "../shared/project-root.js";
import { withFileLock } from "../shared/file-lock.js";
import { errMessage } from "../shared/errors.js";
import { locateConfigFile, removeFiles } from "../shared/config-location.js";
import { isSkillName } from "../skills/validate.js";
import { isMcpServerName } from "../mcp/config-file.js";
import { effectiveDisabledSkills as effectiveDisabledSetOf, skillDefaultSets, } from "../shared/skill-defaults.js";
import { mcpDefaultSets as mcpDefaultSetsOf } from "../shared/mcp-defaults.js";
import { invisibleKeysForWorkspace, normalizeMode, normalizeWorkspaceVisibility, perWorkspaceDefault, visibilityEntryOf, visibleIn, visibleWorkspaceCount, } from "../shared/visibility.js";
import { DOMAIN_KEYS, domainSetOf, emptyOverrides, normalizeOverridesSet, readOverrides, readOverridesStore, writeOverridesStore, } from "./config-file.js";
import { emptyGlobalOverrides, readGlobalOverrides, readGlobalOverridesDocument, writeGlobalOverrides, } from "./global-file.js";
import { OVERRIDES_FILE_NAME, globalOverridesFile, overridesStoreFile, projectOverridesDirs } from "./paths.js";
/** 创建管理服务。 */
export function createOverridesManager(deps = {}) {
    /** 解析项目定位（cwd 缺省时返回 undefined）。 */
    function locationFor(cwd) {
        if (cwd === undefined)
            return undefined;
        const projectRoot = findProjectRoot(cwd);
        return {
            projectRoot,
            cwd,
            storeFile: overridesStoreFile(deps.dshHome),
            globalFile: globalOverridesFile(deps.dshHome),
            legacy: locateConfigFile(projectOverridesDirs(cwd, projectRoot), OVERRIDES_FILE_NAME),
        };
    }
    /** 统一存储条目 → 规范化清单（缺失域 = 空数组；禁用优先不变量在此强制）。 */
    function setOf(entry) {
        return normalizeOverridesSet({
            mcp: entry?.mcp ?? [],
            skills: entry?.skills ?? [],
            tools: entry?.tools ?? [],
            enabledSkills: entry?.enabledSkills ?? [],
            enabledMcp: entry?.enabledMcp ?? [],
            enabledTools: entry?.enabledTools ?? [],
        });
    }
    /** 读统一存储；失败返回 undefined（列表降级为空，写路径会显式再读以暴露错误）。 */
    async function readStoreSafe(file) {
        try {
            return await readOverridesStore(file);
        }
        catch {
            return undefined;
        }
    }
    /** 兼容读取旧的项目内声明；坏文件降级为空（列表不被拖垮）。 */
    async function readLegacySafe(loc) {
        try {
            return await readOverrides(loc.legacy.readFile);
        }
        catch {
            return emptyOverrides();
        }
    }
    /**
     * 读全局覆盖（宽容可见性）；名单 / 版本错误降级为空名单并带回可读错误。
     *
     * 列表 / 投影路径不该被一个损坏的全局文件拖垮，所以这里降级；错误由
     * `globalGet()` 透出给面板，写入路径（`globalToggle` / `setVisibility`）
     * 会显式报错（严格读取）。
     */
    async function readGlobalSafe() {
        try {
            const { overrides, errors } = await readGlobalOverridesDocument(globalOverridesFile(deps.dshHome));
            return errors.length > 0 ? { overrides, errors } : { overrides };
        }
        catch (error) {
            return { overrides: emptyGlobalOverrides(), errors: [errMessage(error)] };
        }
    }
    /** 工作区匹配目标（projectRoot 用于「项目根精确命中」，cwd 用于「path 精确 / 最长前缀」）。 */
    function workspaceTargetOf(cwd) {
        if (cwd === undefined)
            return undefined;
        return { projectRoot: findProjectRoot(cwd), cwd };
    }
    /**
     * 某域的「兜底全局默认关闭」名单：
     *   - skills / mcp：全局文件对应名单；
     *   - tools：全局文件 `tools` ∪ 旧 `tools-global.json` 的 disabled（并集，只读兼容）。
     */
    async function globalOffListOf(domain, global) {
        const off = new Set(domain === "skills" ? global.skills : domain === "mcp" ? global.mcp : global.tools);
        if (domain === "tools" && deps.toolsGlobalDisabled !== undefined) {
            try {
                for (const unit of await deps.toolsGlobalDisabled())
                    off.add(unit);
            }
            catch {
                /* 旧文件读取失败不影响新名单 */
            }
        }
        return off;
    }
    /** 项目层某域的禁用 / 重新打开名单（按 CapabilityDomain 取值）。 */
    function projectListOf(set, domain, kind) {
        if (kind === "disabled")
            return domain === "skills" ? set.skills : domain === "mcp" ? set.mcp : set.tools;
        return domain === "skills" ? set.enabledSkills : domain === "mcp" ? set.enabledMcp : set.enabledTools;
    }
    /**
     * 批量计算能力的默认态快照（可见性 + 每工作区默认 + 项目覆盖）——
     * **列表投影与三处运行时 gate 的唯一计算入口**（契约 §3）。
     *
     * @param domain 可见性域
     * @param keys 能力 key（skills = 技能名；mcp = serverName；tools = unit id）
     * @param cwd 工作区路径；缺省 = 全局视图（可见恒 true、项目覆盖为空）
     */
    async function capabilityDefaultsMany(domain, keys, cwd) {
        const out = new Map();
        if (keys.length === 0)
            return out;
        const global = (await readGlobalSafe()).overrides;
        const project = await projectSets(cwd);
        const off = await globalOffListOf(domain, global);
        const target = workspaceTargetOf(cwd);
        for (const rawKey of keys) {
            const key = typeof rawKey === "string" ? rawKey.trim() : "";
            if (key.length === 0)
                continue;
            const entry = visibilityEntryOf(global.visibility, domain, key);
            const visible = visibleIn(global.visibility, domain, key, target);
            const globalDefaultEnabled = perWorkspaceDefault(global.visibility, domain, key, target, off);
            const projectDisabled = projectListOf(project, domain, "disabled").includes(key);
            const projectEnabled = projectListOf(project, domain, "enabled").includes(key);
            const projectOverride = projectEnabled ? true : projectDisabled ? false : undefined;
            const workspaceDefaultEnabled = projectOverride ?? globalDefaultEnabled;
            out.set(key, {
                visible,
                visibilityMode: normalizeMode(entry?.mode),
                visibleWorkspaceCount: visibleWorkspaceCount(entry),
                globalDefaultEnabled,
                ...(projectOverride !== undefined ? { projectOverride } : {}),
                workspaceDefaultEnabled,
                effectiveDefaultEnabled: visible && workspaceDefaultEnabled,
            });
        }
        return out;
    }
    /** 单个能力的默认态快照（`capabilityDefaultsMany` 的单条包装）。 */
    async function capabilityDefaults(domain, key, cwd) {
        const map = await capabilityDefaultsMany(domain, [key], cwd);
        const found = map.get(key.trim());
        if (found !== undefined)
            return found;
        // key 非法（空）：返回「全局视图缺省」形状，调用方按 visible=true 处理。
        return {
            visible: true,
            visibilityMode: "all",
            visibleWorkspaceCount: 0,
            globalDefaultEnabled: true,
            workspaceDefaultEnabled: true,
            effectiveDefaultEnabled: true,
        };
    }
    /** 全局可见性快照（坏文件降级全 all，不抛）。 */
    async function visibilitySets() {
        return (await readGlobalSafe()).overrides.visibility;
    }
    /** 某域在可见性里出现过的能力 key（运行时 gate 用来发现「可能不可见」的名字）。 */
    async function visibilityKeys(domain) {
        const sets = await visibilitySets();
        return Object.keys(sets[domain] ?? {}).sort();
    }
    /** 某工作区里不可见的能力 key（运行时 gate 用；未配置的名字不会出现）。 */
    async function invisibleKeys(domain, cwd) {
        const sets = await visibilitySets();
        return invisibleKeysForWorkspace(sets, domain, workspaceTargetOf(cwd));
    }
    /**
     * 当前项目的**完整**声明快照（含 B2 的 `enabledSkills`）：无工作区返回全空
     * 快照；统一存储里已有该项目记录时以它为准，否则回退读项目内旧声明；两者都
     * 缺失 / 坏文件时返回全空。
     */
    async function projectSets(cwd) {
        const loc = locationFor(cwd);
        if (loc === undefined)
            return emptyOverrides();
        const store = await readStoreSafe(loc.storeFile);
        const entry = store?.projects[loc.projectRoot];
        if (entry !== undefined)
            return setOf(entry);
        return readLegacySafe(loc);
    }
    /**
     * 当前项目的域视图（`{mcp, skills}`，与旧版返回形状一致）。
     *
     * 兼容 mcp loader 等既有调用方与旧回归测试；B2 的 `enabledSkills` 只在
     * {@link projectSets} / {@link defaultSets} 里体现。
     */
    async function sets(cwd) {
        return domainSetOf(await projectSets(cwd));
    }
    /**
     * 三层默认值集合快照（全局默认 + 项目覆盖）。
     *
     * 这是面板列表（`skills.list` 行字段）与运行时投影（`skills/session.ts`）的
     * 唯一计算入口；全局 / 项目文件任一损坏都降级为空名单，不抛。
     *
     * @param cwd 工作区路径；缺省 = 全局视图（项目集合为空）
     */
    async function defaultSets(cwd) {
        const global = (await readGlobalSafe()).overrides;
        const project = await projectSets(cwd);
        return skillDefaultSets({
            globalSkills: global.skills,
            projectSkills: project.skills,
            projectEnabledSkills: project.enabledSkills,
        });
    }
    /**
     * 有效默认关闭名单：`(global ∪ projectDisabled) \ projectEnabled`（排序后的数组）。
     *
     * @param cwd 工作区路径；缺省 = 全局视图
     */
    async function effectiveDisabledSkills(cwd) {
        const set = effectiveDisabledSetOf(await defaultSets(cwd));
        return [...set].sort((a, b) => a.localeCompare(b));
    }
    /**
     * MCP 三层默认值集合快照（全局默认 ∪ 工作区显式，v20.2）。
     *
     * 这是面板（`mcp.runtime` 行字段）与运行时（loader 的 `resolveSessionPlan`）
     * 的唯一计算入口；全局 / 项目文件任一损坏都降级为空名单，不抛。
     *
     * @param cwd 工作区路径；缺省 = 全局视图（项目两份名单为空）
     */
    async function mcpDefaultSets(cwd) {
        const global = (await readGlobalSafe()).overrides;
        const project = await projectSets(cwd);
        return mcpDefaultSetsOf({
            globalDisabled: global.mcp,
            projectDisabled: project.mcp,
            projectEnabled: project.enabledMcp,
        });
    }
    /** 读取全量视图（attach 统一存储路径 + 项目根；无工作区时返回空视图）。 */
    async function get(cwd) {
        const loc = locationFor(cwd);
        const set = await projectSets(cwd);
        // 兼容既有 `{mcp, skills}` 形状：两域禁用清单照旧，其余名单（B2 / v20.2 /
        // v21）作为 additive 字段并列给出。
        const view = {
            ...domainSetOf(set),
            tools: [...set.tools],
            enabledSkills: [...set.enabledSkills],
            enabledMcp: [...set.enabledMcp],
            enabledTools: [...set.enabledTools],
        };
        if (loc !== undefined) {
            view.filePath = loc.storeFile;
            view.projectRoot = loc.projectRoot;
        }
        return view;
    }
    /**
     * 全局视图（`overrides.globalGet`）：三名单 + 可见性 + 文件路径。
     *
     * 文件缺失 / 损坏时降级为空名单 / 全可见；损坏原因额外带回 `errors`
     * （可读原因），供面板选择性展示，不让读取抛穿 RPC。
     */
    async function globalGet() {
        const filePath = globalOverridesFile(deps.dshHome);
        const { overrides, errors } = await readGlobalSafe();
        const view = {
            skills: [...overrides.skills],
            mcp: [...overrides.mcp],
            tools: [...overrides.tools],
            visibility: overrides.visibility,
            filePath,
        };
        if (errors !== undefined && errors.length > 0)
            view.errors = errors;
        return view;
    }
    /** 校验一个全局默认域 + key；返回错误列表（空 = 合法）。 */
    function validateGlobalToggleTarget(domain, key) {
        if (domain !== "skills" && domain !== "mcp" && domain !== "tools") {
            return [`global defaults only support the "skills" / "mcp" / "tools" domains (got "${String(domain)}")`];
        }
        if (key.length === 0)
            return ["key must not be empty"];
        if (domain === "skills" && !isSkillName(key)) {
            return [`invalid skill name "${key}" — must match kebab-case /^[a-z0-9]+(?:-[a-z0-9]+)*$/`];
        }
        if (domain === "mcp" && !isMcpServerName(key)) {
            return [`invalid MCP server name "${key}" — must match bridge serverName /^[A-Za-z0-9_-]{1,32}$/`];
        }
        if (domain === "tools" && key.length > 200)
            return [`invalid tools unit id "${key}": too long (max 200)`];
        return [];
    }
    /** 把一份全局覆盖写成「某域名单 = 给定值」的完整对象（其它域原样保留）。 */
    function withGlobalList(global, domain, values) {
        const next = {
            skills: global.skills,
            mcp: global.mcp,
            tools: global.tools,
            visibility: global.visibility,
        };
        next[domain] = [...values].sort((a, b) => a.localeCompare(b));
        return next;
    }
    /**
     * 切换某个能力的**全局默认**（B2 Skills / v20.2 MCP / v21 Tools）：
     * `disabled=true` 加入全局默认关闭名单，`false` 从名单移除（写 v2 全局文件；
     * 可见性原样保留）。读→改→写按全局文件串行化；文件损坏时显式报错。
     */
    async function globalToggle(input) {
        const domain = input.domain;
        const rawKey = input.key;
        const key = typeof rawKey === "string" ? rawKey.trim() : "";
        const targetErrors = validateGlobalToggleTarget(domain, key);
        if (targetErrors.length > 0)
            return { ok: false, errors: targetErrors };
        const disabled = input.disabled;
        if (typeof disabled !== "boolean")
            return { ok: false, errors: ['"disabled" must be a boolean'] };
        const listDomain = domain;
        const file = globalOverridesFile(deps.dshHome);
        try {
            return await withFileLock(file, async () => {
                const current = await readGlobalOverrides(file);
                const set = new Set(current[listDomain]);
                if (disabled)
                    set.add(key);
                else
                    set.delete(key);
                await writeGlobalOverrides(file, withGlobalList(current, listDomain, [...set]));
                return { ok: true };
            });
        }
        catch (error) {
            return { ok: false, errors: [errMessage(error)] };
        }
    }
    /**
     * 批量设置某个域的**全局默认**（v21；Tools 面板/兜底写入用）。
     *
     * 一次读-改-写完成（避免逐条加锁）；返回实际变化的条数。
     */
    async function globalToggleMany(input) {
        const domain = input?.domain;
        if (domain !== "skills" && domain !== "mcp" && domain !== "tools") {
            return { ok: false, errors: [`global defaults only support the "skills" / "mcp" / "tools" domains (got "${String(domain)}")`] };
        }
        if (!Array.isArray(input?.keys))
            return { ok: false, errors: ["keys must be an array"] };
        if (typeof input?.disabled !== "boolean")
            return { ok: false, errors: ['"disabled" must be a boolean'] };
        const keys = [];
        for (const raw of input.keys) {
            if (typeof raw !== "string")
                continue;
            const key = raw.trim();
            if (key.length === 0 || keys.includes(key))
                continue;
            const errors = validateGlobalToggleTarget(domain, key);
            if (errors.length > 0)
                return { ok: false, errors };
            keys.push(key);
        }
        if (keys.length === 0)
            return { ok: true, applied: 0 };
        const file = globalOverridesFile(deps.dshHome);
        try {
            return await withFileLock(file, async () => {
                const current = await readGlobalOverrides(file);
                const set = new Set(current[domain]);
                let applied = 0;
                for (const key of keys) {
                    if (input.disabled === true) {
                        if (!set.has(key)) {
                            set.add(key);
                            applied += 1;
                        }
                    }
                    else if (set.delete(key)) {
                        applied += 1;
                    }
                }
                if (applied > 0)
                    await writeGlobalOverrides(file, withGlobalList(current, domain, [...set]));
                return { ok: true, applied };
            });
        }
        catch (error) {
            return { ok: false, errors: [errMessage(error)] };
        }
    }
    /**
     * 写某个能力的**可见性**（v21 `overrides.setVisibility`）。
     *
     * `workspaces` 是完整映射（整份替换）：key = 工作区 path（**原样，不做
     * projectRoot 归一化**；运行时按「projectRoot 精确 → path 精确 → cwd 最长前缀」
     * 匹配）。`mode=all` 且 workspaces 为空 ⇒ 删除该条目（等价缺省全可见）。
     * 读→改→写按全局文件串行化；坏 visibility 显式报错（严格读，不静默丢配置）。
     */
    async function setVisibility(input) {
        const domain = input.domain;
        if (domain !== "skills" && domain !== "mcp" && domain !== "tools") {
            return { ok: false, errors: [`visibility only supports the "skills" / "mcp" / "tools" domains (got "${String(domain)}")`] };
        }
        const rawKey = input.key;
        const key = typeof rawKey === "string" ? rawKey.trim() : "";
        if (key.length === 0)
            return { ok: false, errors: ["key must not be empty"] };
        if (key.length > 256)
            return { ok: false, errors: [`invalid capability key "${key}": too long (max 256)`] };
        const mode = input.mode;
        if (mode !== "all" && mode !== "selected" && mode !== "none") {
            return { ok: false, errors: ['"mode" must be "all" | "selected" | "none"'] };
        }
        const rawWorkspaces = input.workspaces;
        if (rawWorkspaces === null || typeof rawWorkspaces !== "object" || Array.isArray(rawWorkspaces)) {
            return { ok: false, errors: ['"workspaces" must be an object'] };
        }
        const workspaces = {};
        const errors = [];
        for (const [rawWorkspace, rawEntry] of Object.entries(rawWorkspaces)) {
            const workspace = rawWorkspace.trim();
            if (workspace.length === 0) {
                errors.push("workspace key must not be empty");
                continue;
            }
            const entry = normalizeWorkspaceVisibility(rawEntry, errors, `workspaces[${workspace}]`);
            if (entry === undefined) {
                errors.push(`invalid workspaces[${workspace}]: must be an object`);
                continue;
            }
            workspaces[workspace] = entry;
        }
        if (errors.length > 0)
            return { ok: false, errors };
        const file = globalOverridesFile(deps.dshHome);
        try {
            return await withFileLock(file, async () => {
                const current = await readGlobalOverrides(file);
                const visibility = {
                    skills: { ...current.visibility.skills },
                    mcp: { ...current.visibility.mcp },
                    tools: { ...current.visibility.tools },
                };
                if (mode === "all" && Object.keys(workspaces).length === 0)
                    delete visibility[domain][key];
                else
                    visibility[domain][key] = { mode, workspaces };
                await writeGlobalOverrides(file, { ...current, visibility });
                return { ok: true };
            });
        }
        catch (error) {
            return { ok: false, errors: [errMessage(error)] };
        }
    }
    /** 翻转一个清单的成员关系（先排序，保持落盘稳定）。 */
    function flipped(list, key) {
        return list.includes(key)
            ? list.filter((item) => item !== key)
            : [...list, key].sort((a, b) => a.localeCompare(b));
    }
    /** 加入一个名单成员（幂等；先排序，保持落盘稳定）。 */
    function withAdded(list, key) {
        const set = new Set(list);
        set.add(key);
        return [...set].sort((a, b) => a.localeCompare(b));
    }
    /** 项目层某域的禁用名单（按域取数组副本）。 */
    function projectDisabledOf(set, domain) {
        return domain === "mcp" ? [...set.mcp] : domain === "skills" ? [...set.skills] : [...set.tools];
    }
    /** 项目层某域的重新打开名单（按域取数组副本）。 */
    function projectEnabledOf(set, domain) {
        return domain === "mcp" ? [...set.enabledMcp] : domain === "skills" ? [...set.enabledSkills] : [...set.enabledTools];
    }
    /** 用新名单替换某域的禁用 / 重新打开两份名单（其它域原样保留）。 */
    function withProjectLists(set, domain, disabled, enabled) {
        const draft = {
            mcp: [...set.mcp],
            skills: [...set.skills],
            tools: [...set.tools],
            enabledSkills: [...set.enabledSkills],
            enabledMcp: [...set.enabledMcp],
            enabledTools: [...set.enabledTools],
        };
        if (domain === "mcp") {
            draft.mcp = disabled;
            draft.enabledMcp = enabled;
        }
        else if (domain === "skills") {
            draft.skills = disabled;
            draft.enabledSkills = enabled;
        }
        else {
            draft.tools = disabled;
            draft.enabledTools = enabled;
        }
        return normalizeOverridesSet(draft);
    }
    /**
     * 切换某个能力在本项目的默认关闭状态（B2 / v20.2 / v21 三域三态）。
     *
     * - 传 `enabled` 时显式设为启用 / 禁用（幂等，不翻转）；
     * - 不传时翻转**工作区默认**：`项目覆盖 ?? 每工作区全局默认`（全局默认 <
     *   工作区显式 < 会话显式中的第二层）。
     * - 启用时只有「该工作区的全局默认 = 关」才写重新打开名单
     *   （`enabledSkills` / `enabledMcp` / `enabledTools`），否则清掉该项目态；
     *   禁用时加入项目禁用名单并清掉重新打开标记（禁用优先）。
     *
     * 读→改→写整段按统一存储文件串行化，避免并发写者互相覆盖。某个项目首次
     * 写入时：把项目内旧声明（`.agents` / `.dsh` / `.claude`）并入统一存储，
     * 成功后删除旧文件。旧文件损坏时显式报错（不静默覆盖用户数据）。
     */
    async function toggle(input) {
        const key = typeof input?.key === "string" ? input.key.trim() : "";
        if (key.length === 0)
            return { ok: false, errors: ["key must not be empty"] };
        if (!DOMAIN_KEYS.includes(input.domain)) {
            return { ok: false, errors: [`unknown domain "${String(input.domain)}"`] };
        }
        const loc = locationFor(input.cwd);
        if (loc === undefined)
            return { ok: false, errors: ["project scope requires a workspace path"] };
        if (input.domain === "skills" && !isSkillName(key)) {
            return { ok: false, errors: [`invalid skill name "${key}" — must match kebab-case /^[a-z0-9]+(?:-[a-z0-9]+)*$/`] };
        }
        if (input.domain === "tools" && key.length > 200) {
            return { ok: false, errors: [`invalid tools unit id "${key}": too long (max 200)`] };
        }
        // 全局层快照（三名单 + 可见性）：计算「每工作区全局默认」需要它；文件损坏时
        // 降级为空（不阻塞项目编辑；与既有 skills 分支同策略）。
        let global;
        try {
            global = await readGlobalOverrides(loc.globalFile);
        }
        catch {
            global = emptyGlobalOverrides();
        }
        const off = await globalOffListOf(input.domain, global);
        const globalDefaultEnabled = perWorkspaceDefault(global.visibility, input.domain, key, workspaceTargetOf(loc.cwd), off);
        try {
            return await withFileLock(loc.storeFile, async () => {
                const store = await readOverridesStore(loc.storeFile);
                const existing = store.projects[loc.projectRoot];
                // 统一存储里还没有该项目 ⇒ 首次写入，把旧声明并入（坏文件抛错，绝不静默丢弃）。
                const current = existing !== undefined ? setOf(existing) : await readOverrides(loc.legacy.readFile);
                const projectDisabledNow = projectDisabledOf(current, input.domain).includes(key);
                const projectEnabledNow = projectEnabledOf(current, input.domain).includes(key);
                const workspaceDefaultEnabled = projectEnabledNow ? true : projectDisabledNow ? false : globalDefaultEnabled;
                const desired = typeof input.enabled === "boolean" ? input.enabled : !workspaceDefaultEnabled;
                const next = desired
                    ? // 启用：移出项目禁用；只有「每工作区全局默认 = 关」才写重新打开名单。
                        withProjectLists(current, input.domain, projectDisabledOf(current, input.domain).filter((item) => item !== key), globalDefaultEnabled
                            ? projectEnabledOf(current, input.domain).filter((item) => item !== key)
                            : withAdded(projectEnabledOf(current, input.domain), key))
                    : // 禁用：加入项目禁用并移除重新打开标记（禁用优先）。
                        withProjectLists(current, input.domain, withAdded(projectDisabledOf(current, input.domain), key), projectEnabledOf(current, input.domain).filter((item) => item !== key));
                const entry = { updatedAt: Date.now(), cwd: loc.cwd };
                const fields = ["mcp", "skills", "tools", "enabledSkills", "enabledMcp", "enabledTools"];
                let any = false;
                for (const field of fields) {
                    const values = next[field];
                    if (values.length === 0)
                        continue;
                    entry[field] = values;
                    any = true;
                }
                // 六个名单都空 ⇒ 删除该项目条目（空条目不落盘）。
                if (!any)
                    delete store.projects[loc.projectRoot];
                else
                    store.projects[loc.projectRoot] = entry;
                await writeOverridesStore(loc.storeFile, store);
                // 旧声明已并入统一存储：删除项目内旧文件（所有兼容位置）。
                await removeFiles([loc.legacy.readFile, ...loc.legacy.legacyFiles]);
                return { ok: true };
            });
        }
        catch (error) {
            return { ok: false, errors: [errMessage(error)] };
        }
    }
    return {
        sets,
        projectSets,
        get,
        toggle,
        globalGet,
        globalToggle,
        globalToggleMany,
        setVisibility,
        visibilitySets,
        visibilityKeys,
        invisibleKeys,
        capabilityDefaults,
        capabilityDefaultsMany,
        defaultSets,
        effectiveDisabledSkills,
        mcpDefaultSets,
    };
}
