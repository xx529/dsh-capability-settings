/**
 * 项目级"默认关闭"管理服务（挂载为 `ctx.capabilityPanel.overrides`）。
 *
 * **统一存储**：`<dshHome>/dsh-capability-settings/capability-overrides.json`
 * ——一个文件按**项目根**（`findProjectRoot(cwd)`）分 key，记录每个项目默认关闭
 * 的 MCP server / 注入技能清单。MCP 列表读取、MCP 自动挂载、技能项目默认投影
 * 共用它的 `sets()` 快照；面板通过 `get()` 读全量、`toggle()` 切换某一条。
 *
 * **旧位置兼容**：`<项目根>/.agents/capability-overrides.json`（以及更早的
 * `.dsh` / `.claude`）仍会被读取；某个项目在统一存储里还没有记录时，`sets()`
 * 回退到旧文件。首次 `toggle()` 会把旧内容并入统一存储并删除项目内旧文件
 * （之后旧文件不再生效，避免同一份声明两处维护）。
 *
 * `skills` 域只对**宿主 registry 注入的技能**生效（写入 `skills: string[]`；
 * 非法/非 kebab-case 名字直接拒绝），由组合根在写盘成功后对同项目的 live
 * 会话做增量 reconcile（见 `index.ts` / `skills/session.ts`）。
 *
 * 无工作区（cwd 为 undefined）时不适用任何项目级禁用：`sets()` 返回全空
 * 快照，`toggle()` 直接报错。
 *
 * @module dsh-capability-settings/overrides/manager
 */
import { findProjectRoot } from "../shared/project-root.js";
import { withFileLock } from "../shared/file-lock.js";
import { locateConfigFile, removeFiles } from "../shared/config-location.js";
import { isSkillName } from "../skills/validate.js";
import { DOMAIN_KEYS, emptyOverrides, normalizeList, readOverrides, readOverridesStore, writeOverridesStore, } from "./config-file.js";
import { OVERRIDES_FILE_NAME, overridesStoreFile, projectOverridesDirs } from "./paths.js";
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
            legacy: locateConfigFile(projectOverridesDirs(cwd, projectRoot), OVERRIDES_FILE_NAME),
        };
    }
    /** 统一存储条目 → 规范化清单（缺失域 = 空数组）。 */
    function setOf(entry) {
        return { mcp: normalizeList(entry?.mcp ?? []), skills: normalizeList(entry?.skills ?? []) };
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
     * 当前项目的默认关闭快照：无工作区返回全空快照；统一存储里已有该项目记录
     * 时以它为准，否则回退读项目内旧声明；两者都缺失 / 坏文件时返回全空。
     */
    async function sets(cwd) {
        const loc = locationFor(cwd);
        if (loc === undefined)
            return emptyOverrides();
        const store = await readStoreSafe(loc.storeFile);
        const entry = store?.projects[loc.projectRoot];
        if (entry !== undefined)
            return setOf(entry);
        return readLegacySafe(loc);
    }
    /** 读取全量视图（attach 统一存储路径 + 项目根；无工作区时返回空视图）。 */
    async function get(cwd) {
        const loc = locationFor(cwd);
        const view = { ...(await sets(cwd)) };
        if (loc !== undefined) {
            view.filePath = loc.storeFile;
            view.projectRoot = loc.projectRoot;
        }
        return view;
    }
    /**
     * 切换某个能力在本项目的默认关闭状态：已在清单里则移除（恢复），否则加入
     * （禁用）。读→改→写整段按统一存储文件串行化，避免并发写者互相覆盖。
     *
     * 某个项目首次写入时：把项目内旧声明（`.agents` / `.dsh` / `.claude`）并入
     * 统一存储，成功后删除旧文件。旧文件损坏时显式报错（不静默覆盖用户数据）。
     */
    async function toggle(input) {
        const key = input.key.trim();
        if (key.length === 0)
            return { ok: false, errors: ["key must not be empty"] };
        if (!DOMAIN_KEYS.includes(input.domain)) {
            return { ok: false, errors: [`unknown domain "${String(input.domain)}"`] };
        }
        const loc = locationFor(input.cwd);
        if (loc === undefined)
            return { ok: false, errors: ["project scope requires a workspace path"] };
        // skills 域只接受 kebab-case 技能名（与宿主技能命名文法一致；注入技能才有意义）。
        if (input.domain === "skills" && !isSkillName(key)) {
            return { ok: false, errors: [`invalid skill name "${key}" — must match kebab-case /^[a-z0-9]+(?:-[a-z0-9]+)*$/`] };
        }
        try {
            return await withFileLock(loc.storeFile, async () => {
                const store = await readOverridesStore(loc.storeFile);
                const existing = store.projects[loc.projectRoot];
                // 统一存储里还没有该项目 ⇒ 首次写入，把旧声明并入（坏文件抛错，绝不静默丢弃）。
                const current = existing !== undefined ? setOf(existing) : await readOverrides(loc.legacy.readFile);
                const next = { mcp: [...current.mcp], skills: [...current.skills] };
                const list = normalizeList(next[input.domain]);
                next[input.domain] = list.includes(key)
                    ? list.filter((item) => item !== key)
                    : [...list, key].sort((a, b) => a.localeCompare(b));
                const entry = { updatedAt: Date.now(), cwd: loc.cwd };
                const mcp = normalizeList(next.mcp);
                if (mcp.length > 0)
                    entry.mcp = mcp;
                const skills = normalizeList(next.skills);
                if (skills.length > 0)
                    entry.skills = skills;
                // 两个域都空 ⇒ 删除该项目条目（空条目不落盘）。
                if (entry.mcp === undefined && entry.skills === undefined)
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
            return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
        }
    }
    return { sets, get, toggle };
}
