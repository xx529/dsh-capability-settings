/**
 * 默认关闭管理服务（挂载为 `ctx.capabilityPanel.overrides`）。
 *
 * **两层存储**（B2，v20.1）：
 *
 *   1. **全局层**：`<dshHome>/dsh-capability-settings/capability-global-overrides.json`
 *      ——`{ version: 1, skills: string[] }`，全局默认关闭名单；不改技能文件。
 *      面板全局视图的 Skills 开关写这里（见 {@link globalToggle}）。
 *   2. **项目层（统一存储）**：`<dshHome>/dsh-capability-settings/capability-overrides.json`
 *      ——一个文件按**项目根**（`findProjectRoot(cwd)`）分 key，记录每个项目默认
 *      关闭的 MCP server / Skill，以及（B2）本项目**显式重新打开**的 Skill
 *      （`enabledSkills`）。MCP 列表读取、MCP 自动挂载、技能默认投影共用它的
 *      `sets()` 快照；面板通过 `get()` 读全量、`toggle()` 切换某一条。
 *
 * **有效默认**（契约 §1.3）：`(global.skills ∪ project.skills) \ project.enabledSkills`；
 * `defaultSets()` / {@link effectiveDisabledSkills} 是唯一计算入口，供面板列表与
 * `skills/session.ts` 的运行时投影共用（见 `shared/skill-defaults.ts`）。
 *
 * **旧位置兼容**：`<项目根>/.agents/capability-overrides.json`（以及更早的
 * `.dsh` / `.claude`）仍会被读取；某个项目在统一存储里还没有记录时，`sets()`
 * 回退到旧文件。首次 `toggle()` 会把旧内容并入统一存储并删除项目内旧文件
 * （之后旧文件不再生效，避免同一份声明两处维护）。
 *
 * `skills` 域对**磁盘技能与注入技能**都生效：磁盘技能靠 agent 作用域 runtime
 * shadow（与全局层投影片同一条机制），注入技能同样是 runtime shadow；由组合根在
 * 写盘成功后对同项目的 live 会话（全局层则对所有 live 会话）做增量 reconcile
 * （见 `index.ts` / `skills/session.ts`）。
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
import { effectiveDisabledSkills as effectiveDisabledSetOf, skillDefaultSets, } from "../shared/skill-defaults.js";
import { DOMAIN_KEYS, domainSetOf, emptyOverrides, normalizeOverridesSet, readOverrides, readOverridesStore, writeOverridesStore, } from "./config-file.js";
import { emptyGlobalOverrides, readGlobalOverrides, writeGlobalOverrides, } from "./global-file.js";
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
    /** 统一存储条目 → 规范化清单（缺失域 = 空数组；B2 不变量在此强制）。 */
    function setOf(entry) {
        return normalizeOverridesSet({
            mcp: entry?.mcp ?? [],
            skills: entry?.skills ?? [],
            enabledSkills: entry?.enabledSkills ?? [],
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
     * 读全局覆盖（严格读取）；失败时降级为空名单并带回可读错误。
     *
     * 列表 / 投影路径不该被一个损坏的全局文件拖垮，所以这里降级；错误由
     * `globalGet()` 透出给面板，写入路径（`globalToggle`）会显式报错。
     */
    async function readGlobalSafe() {
        try {
            return { overrides: await readGlobalOverrides(globalOverridesFile(deps.dshHome)) };
        }
        catch (error) {
            return { overrides: emptyGlobalOverrides(), errors: [errMessage(error)] };
        }
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
    /** 读取全量视图（attach 统一存储路径 + 项目根；无工作区时返回空视图）。 */
    async function get(cwd) {
        const loc = locationFor(cwd);
        const view = domainSetOf(await projectSets(cwd));
        if (loc !== undefined) {
            view.filePath = loc.storeFile;
            view.projectRoot = loc.projectRoot;
        }
        return view;
    }
    /**
     * 全局视图（`overrides.globalGet`）：规范化清单 + 文件路径。
     *
     * 契约 §2.1 只要求 `skills` / `filePath`；文件损坏时额外带回 `errors`
     * （可读原因），供面板选择性展示，不让读取抛穿 RPC。
     */
    async function globalGet() {
        const filePath = globalOverridesFile(deps.dshHome);
        const { overrides, errors } = await readGlobalSafe();
        const view = { skills: [...overrides.skills], filePath };
        if (errors !== undefined && errors.length > 0)
            view.errors = errors;
        return view;
    }
    /**
     * 切换某个能力的**全局默认**（B2）：`disabled=true` 加入全局默认关闭名单，
     * `false` 从名单移除。读→改→写按全局文件串行化；文件损坏时显式报错
     * （不静默覆盖用户数据）。
     */
    async function globalToggle(input) {
        const domain = input.domain;
        if (domain !== "skills") {
            return { ok: false, errors: [`global defaults only support the "skills" domain (got "${String(domain)}")`] };
        }
        const rawKey = input.key;
        const key = typeof rawKey === "string" ? rawKey.trim() : "";
        if (key.length === 0)
            return { ok: false, errors: ["key must not be empty"] };
        if (!isSkillName(key)) {
            return { ok: false, errors: [`invalid skill name "${key}" — must match kebab-case /^[a-z0-9]+(?:-[a-z0-9]+)*$/`] };
        }
        const disabled = input.disabled;
        if (typeof disabled !== "boolean")
            return { ok: false, errors: ['"disabled" must be a boolean'] };
        const file = globalOverridesFile(deps.dshHome);
        try {
            return await withFileLock(file, async () => {
                const current = await readGlobalOverrides(file);
                const set = new Set(current.skills);
                if (disabled)
                    set.add(key);
                else
                    set.delete(key);
                await writeGlobalOverrides(file, { skills: [...set].sort((a, b) => a.localeCompare(b)) });
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
    /**
     * 切换某个能力在本项目的默认关闭状态。
     *
     * - `mcp` 域：翻转项目禁用清单成员（语义与旧版一致）；
     * - `skills` 域（B2 三态）：
     *   - 传 `enabled` 时显式设为启用 / 禁用；
     *   - 不传时翻转**有效默认**（全局默认 < 项目显式 < 会话显式中的第二层）。
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
        // skills 域只接受 kebab-case 技能名（与宿主技能命名文法一致）。
        if (input.domain === "skills" && !isSkillName(key)) {
            return { ok: false, errors: [`invalid skill name "${key}" — must match kebab-case /^[a-z0-9]+(?:-[a-z0-9]+)*$/`] };
        }
        // 全局默认关闭集：B2 计算需要它；全局文件损坏时降级为空（不阻塞项目编辑）。
        let globalDisabled = new Set();
        try {
            globalDisabled = new Set((await readGlobalOverrides(loc.globalFile)).skills);
        }
        catch {
            globalDisabled = new Set();
        }
        try {
            return await withFileLock(loc.storeFile, async () => {
                const store = await readOverridesStore(loc.storeFile);
                const existing = store.projects[loc.projectRoot];
                // 统一存储里还没有该项目 ⇒ 首次写入，把旧声明并入（坏文件抛错，绝不静默丢弃）。
                const current = existing !== undefined ? setOf(existing) : await readOverrides(loc.legacy.readFile);
                let next;
                if (input.domain === "mcp") {
                    next = normalizeOverridesSet({ ...current, mcp: flipped(current.mcp, key) });
                }
                else {
                    const projectDisabled = current.skills.includes(key);
                    const projectEnabled = current.enabledSkills.includes(key);
                    const effectiveDefaultEnabled = projectEnabled
                        ? true
                        : projectDisabled || globalDisabled.has(key)
                            ? false
                            : true;
                    const desired = typeof input.enabled === "boolean" ? input.enabled : !effectiveDefaultEnabled;
                    if (desired) {
                        // 启用：移除项目禁用；只有全局默认关闭时才需要写 enabledSkills。
                        next = normalizeOverridesSet({
                            ...current,
                            skills: current.skills.filter((item) => item !== key),
                            enabledSkills: globalDisabled.has(key)
                                ? [...current.enabledSkills, key].sort((a, b) => a.localeCompare(b))
                                : current.enabledSkills.filter((item) => item !== key),
                        });
                    }
                    else {
                        // 禁用：加入项目禁用并移除 enabledSkills（禁用优先）。
                        next = normalizeOverridesSet({
                            ...current,
                            skills: flipped(current.skills, key),
                            enabledSkills: current.enabledSkills.filter((item) => item !== key),
                        });
                    }
                }
                const entry = { updatedAt: Date.now(), cwd: loc.cwd };
                if (next.mcp.length > 0)
                    entry.mcp = next.mcp;
                if (next.skills.length > 0)
                    entry.skills = next.skills;
                if (next.enabledSkills.length > 0)
                    entry.enabledSkills = next.enabledSkills;
                // 三个名单都空 ⇒ 删除该项目条目（空条目不落盘）。
                if (entry.mcp === undefined && entry.skills === undefined && entry.enabledSkills === undefined) {
                    delete store.projects[loc.projectRoot];
                }
                else {
                    store.projects[loc.projectRoot] = entry;
                }
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
    return { sets, projectSets, get, toggle, globalGet, globalToggle, defaultSets, effectiveDisabledSkills };
}
