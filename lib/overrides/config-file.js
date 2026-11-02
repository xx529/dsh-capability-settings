/**
 * 读写项目级"默认关闭"声明。
 *
 * **当前写入目标**：`<dshHome>/dsh-capability-settings/capability-overrides.json`
 * （统一存储：一个文件、按项目根分 key，见 {@link readOverridesStore} /
 * {@link writeOverridesStore}）。
 *
 * **旧格式**：`<项目根>/.agents/capability-overrides.json`（读取兼容 `.dsh` /
 * `.claude`，见 `paths.ts`）仍然可读（{@link readOverrides}），并在首次写入统一
 * 存储时并入内容、删除旧文件；{@link writeOverrides} 仅为公开 API / 测试保留。
 *
 * v20.1 B2：项目条目新增 `enabledSkills`（本项目显式重新打开的技能，覆盖全局
 * 默认关闭）；同一名字同时出现在 `skills` / `enabledSkills` 时**禁用优先**
 * （{@link normalizeOverridesSet} 读取与写盘两侧都强制）。
 *
 * v20.2：同一层扩到 MCP——项目条目新增 `enabledMcp`（本项目显式重新打开的
 * serverName，覆盖全局默认关闭），`mcp` / `enabledMcp` 同样**禁用优先**。
 *
 * v21：再扩到 Tools——项目条目新增 `tools` / `enabledTools`（Tools 单元 id 的
 * 工作区默认关闭 / 重新打开），同样**禁用优先**。全局层的
 * `capability-global-overrides.json` 在 `global-file.ts`，与本文件读写逻辑独立。
 *
 * 写入原子（临时文件 + rename）、父目录按需创建；读取对"文件缺失 / 文件为空"
 * 宽容（视为空声明），对"JSON 非法 / 形状不符合预期 / 版本不认识"抛出带文件名的
 * 错误，让面板明确展示问题。读入时每个域的清单 trim、去重、按语言排序；写出时
 * 空数组不落盘。
 *
 * @module dsh-capability-settings/overrides/config-file
 */
import { atomicWriteText } from "../shared/atomic-write.js";
import { readJsonDocument } from "../shared/json-config.js";
/** 能力域在声明文件里的键名（与 CapabilityDomain 一一对应）。 */
export const DOMAIN_KEYS = ["mcp", "skills", "tools"];
/**
 * 项目层「重新打开」名单字段（不属于 {@link CapabilityDomain} 的禁用清单）。
 *
 * 与 `DOMAIN_KEYS` 分开：这些字段只影响默认投影 / 挂载判定，不参与
 * 「某域是否被禁用」的通用语义，面板按域取用。
 */
const OVERRIDES_ENABLED_FIELDS = ["enabledSkills", "enabledMcp", "enabledTools"];
/** 项目条目上的六个名单字段（三域禁用清单 + 三个重新打开名单）。 */
const entryFields = [...DOMAIN_KEYS, ...OVERRIDES_ENABLED_FIELDS];
/**
 * 构造一份空的规范化声明（三域禁用清单与三个重新打开名单都是空数组）。
 */
export function emptyOverrides() {
    return { mcp: [], skills: [], tools: [], enabledSkills: [], enabledMcp: [], enabledTools: [] };
}
/**
 * 规范化一份声明并强制「同一名字不同时出现在禁用 / 重新打开两个名单」。
 *
 * 契约 §1.2 的「禁用优先」在这里落地：`enabledSkills` 里与 `skills` 同名的
 * 条目、`enabledMcp` 里与 `mcp` 同名的条目都被剔除（写读两侧都走本函数，
 * 保证磁盘上不会长期保留矛盾数据）。
 *
 * @param input 任意来源（磁盘 / 调用方）的清单
 * @returns 规范化后的声明（每域 trim、去重、排序）
 */
export function normalizeOverridesSet(input) {
    const mcp = normalizeList(input?.mcp ?? []);
    const mcpDisabled = new Set(mcp);
    const enabledMcp = normalizeList(input?.enabledMcp ?? []).filter((name) => !mcpDisabled.has(name));
    const skills = normalizeList(input?.skills ?? []);
    const disabled = new Set(skills);
    const enabledSkills = normalizeList(input?.enabledSkills ?? []).filter((name) => !disabled.has(name));
    const tools = normalizeList(input?.tools ?? []);
    const toolsDisabled = new Set(tools);
    const enabledTools = normalizeList(input?.enabledTools ?? []).filter((name) => !toolsDisabled.has(name));
    return { mcp, skills, tools, enabledSkills, enabledMcp, enabledTools };
}
/**
 * 取两域视图（`{mcp, skills}`）：兼容旧调用方 / 旧回归测试的既有返回形状。
 *
 * @param set 完整声明（含 B2 的 enabledSkills）
 * @returns 只含 mcp / skills 的浅拷贝
 */
export function domainSetOf(set) {
    return { mcp: [...set.mcp], skills: [...set.skills] };
}
/**
 * 规范化一个域的清单：trim、去重、按语言排序。
 */
export function normalizeList(values) {
    if (!Array.isArray(values))
        return [];
    const seen = new Set();
    const out = [];
    for (const value of values) {
        if (typeof value !== "string")
            continue;
        const key = value.trim();
        if (key.length === 0 || seen.has(key))
            continue;
        seen.add(key);
        out.push(key);
    }
    return out.sort((a, b) => a.localeCompare(b));
}
/**
 * 读取一个禁用声明文件并规范化为 OverridesSet。
 *
 * - 文件缺失 / 空 → 全空声明（不报错）；
 * - JSON 非法 / 顶层不是对象 → 抛出带文件名的 Error；
 * - 某个域的键存在但不是字符串数组 → 抛出带文件名的 Error
 *   （手改文件写坏时显式暴露，而不是静默丢弃）；
 * - `enabledSkills`（B2）可选；旧文件没有该键时按空处理；与 `skills` 同时
 *   出现时禁用优先（{@link normalizeOverridesSet}）。
 * - `enabledMcp`（v20.2）同上，与 `mcp` 同时出现时禁用优先。
 */
export async function readOverrides(filePath) {
    const parsed = await readJsonDocument(filePath, "capability overrides");
    if (parsed === undefined)
        return emptyOverrides();
    const record = parsed;
    const out = emptyOverrides();
    for (const domain of DOMAIN_KEYS) {
        const value = record[domain];
        if (value === undefined)
            continue;
        if (!Array.isArray(value)) {
            throw new Error(`invalid capability overrides in ${filePath}: "${domain}" must be an array of strings`);
        }
        for (const item of value) {
            if (typeof item !== "string") {
                throw new Error(`invalid capability overrides in ${filePath}: "${domain}" must be an array of strings`);
            }
        }
        out[domain] = normalizeList(value);
    }
    for (const field of OVERRIDES_ENABLED_FIELDS) {
        const enabled = record[field];
        if (enabled === undefined)
            continue;
        if (!Array.isArray(enabled) || enabled.some((item) => typeof item !== "string")) {
            throw new Error(`invalid capability overrides in ${filePath}: "${field}" must be an array of strings`);
        }
        out[field] = normalizeList(enabled);
    }
    return normalizeOverridesSet(out);
}
/**
 * 原子写入一份旧格式禁用声明（自动创建父目录）。
 * 用带时间戳与随机后缀的临时文件 + rename 覆盖；空数组不落盘。
 *
 * 仅保留给公开 API / 测试 / 迁移工具使用；面板写入走 {@link writeOverridesStore}。
 */
export async function writeOverrides(filePath, overrides) {
    const normalized = normalizeOverridesSet(overrides);
    const body = {};
    for (const domain of DOMAIN_KEYS) {
        const values = normalized[domain];
        if (values.length > 0)
            body[domain] = values;
    }
    for (const field of OVERRIDES_ENABLED_FIELDS) {
        const values = normalized[field];
        if (values.length > 0)
            body[field] = values;
    }
    await atomicWriteText(filePath, `${JSON.stringify(body, null, 2)}\n`, "capability-overrides");
}
// ---------------------------------------------------------------------------
// 统一存储（按项目根分 key 的单文件）
// ---------------------------------------------------------------------------
/** 统一存储的当前版本；版本不认识时整份拒绝（不猜测迁移，避免覆盖用户数据）。 */
export const OVERRIDES_STORE_VERSION = 1;
/** 构造一份空的统一存储。 */
export function emptyOverridesStore() {
    return { version: OVERRIDES_STORE_VERSION, projects: {} };
}
/** 校验 / 规范化一个字符串数组（非法形状抛带文件名的错误）。 */
function requireStringList(value, filePath, field) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error(`invalid capability overrides store in ${filePath}: "${field}" must be an array of strings`);
    }
    return normalizeList(value);
}
/**
 * 读取统一存储。
 *
 * - 文件缺失 / 空 → 空存储；
 * - JSON 非法 / `version` 不认识 / `projects` 或条目形状非法 → 抛错
 *   （读路径由调用方降级为空声明，写路径显式报错暴露问题）。
 */
export async function readOverridesStore(filePath) {
    const parsed = await readJsonDocument(filePath, "capability overrides store");
    if (parsed === undefined)
        return emptyOverridesStore();
    if (parsed.version !== OVERRIDES_STORE_VERSION) {
        throw new Error(`unsupported capability overrides store version in ${filePath}: ${String(parsed.version)} (expected ${OVERRIDES_STORE_VERSION})`);
    }
    const rawProjects = parsed.projects;
    if (rawProjects === undefined)
        return emptyOverridesStore();
    if (rawProjects === null || typeof rawProjects !== "object" || Array.isArray(rawProjects)) {
        throw new Error(`invalid capability overrides store in ${filePath}: "projects" must be an object`);
    }
    const projects = {};
    for (const [projectRoot, value] of Object.entries(rawProjects)) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
            throw new Error(`invalid capability overrides store in ${filePath}: "${projectRoot}" must be an object`);
        }
        const source = value;
        const entry = {
            updatedAt: typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt) ? source.updatedAt : 0,
        };
        if (typeof source.cwd === "string" && source.cwd.length > 0)
            entry.cwd = source.cwd;
        for (const field of entryFields) {
            if (source[field] !== undefined)
                entry[field] = requireStringList(source[field], filePath, `${projectRoot}.${field}`);
        }
        // 不变量（禁用优先）：同一名字不同时留在禁用 / 重新打开两个名单里。
        const normalized = normalizeOverridesSet(entry);
        for (const field of entryFields) {
            if (normalized[field].length > 0)
                entry[field] = normalized[field];
            else
                delete entry[field];
        }
        projects[projectRoot] = entry;
    }
    return { version: OVERRIDES_STORE_VERSION, projects };
}
/**
 * 原子写入统一存储（自动创建父目录）。
 *
 * 只写非空条目（四个名单都为空的项目直接省略），保持文件最小化。
 */
export async function writeOverridesStore(filePath, store) {
    const projects = {};
    for (const [projectRoot, entry] of Object.entries(store.projects)) {
        const normalized = normalizeOverridesSet(entry);
        const out = { updatedAt: entry.updatedAt };
        if (entry.cwd !== undefined)
            out.cwd = entry.cwd;
        let any = false;
        for (const field of entryFields) {
            if (normalized[field].length > 0) {
                out[field] = normalized[field];
                any = true;
            }
        }
        if (!any)
            continue;
        projects[projectRoot] = out;
    }
    const body = { version: OVERRIDES_STORE_VERSION, projects };
    // 统一存储放在 dsh home（含本机项目路径），与 jev.json / session-capabilities.json
    // 保持同一最小权限：文件 0600。
    await atomicWriteText(filePath, `${JSON.stringify(body, null, 2)}\n`, "capability-overrides", { mode: 0o600 });
}
