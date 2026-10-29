/**
 * 会话级能力开关的持久化存储（Skills / MCP）。
 *
 * 背景：插件的「当前对话」开关原本是纯内存态（`mcp/loader.ts` 的
 * `sessionToggles`、`skills/session.ts` 的 `explicit`），宿主重启 / agent 重建后
 * 即回到项目默认，用户看到的行为与重启前不一致。本模块把**显式会话覆盖**
 * 落盘，让同一会话在重启 / resume 后恢复原状。
 *
 * 存储契约：
 *
 *   - 文件：`<dshHome>/dsh-capability-settings/session-capabilities.json`
 *     （与 `jev.json` 同目录；目录 0700、文件 0600）；
 *   - 写入复用 `shared/atomic-write.ts` + `shared/file-lock.ts`（禁止裸写）；
 *   - 读：文件缺失 / 空 / JSON 损坏 / version 不认识 → 空表 + `warn`，
 *     不阻断 MCP 挂载与会话开关（等价于"没有显式覆盖"，跟随项目默认）；
 *   - 写：内存镜像权威，串行队列 + 文件锁内"读盘合并（保留其它实例写入的
 *     会话）→ 原子写"；写失败只 `warn`，**本次运行内仍生效**；
 *   - **不存密钥、不存会话内容**：只有 sessionId、三个域的开关键、诊断用
 *     cwd / headerCreatedAt。
 *
 * 三个域共用同一记录（`skills` / `mcp` / `tools`），互不影响；`tools` 域为
 * v13 additive 新增（键 `plugin:<unit>`，`version` 仍为 1，旧版读忽略该字段）。
 *
 * 记录形状（`version: 1`）：
 *
 * ```jsonc
 * {
 *   "version": 1,
 *   "sessions": {
 *     "<sessionId>": {
 *       "updatedAt": 1761328800000,
 *       "headerCreatedAt": 1761000000000,
 *       "cwd": "/path/to/project",
 *       "skills": { "figma-workbench": false },
 *       "mcp": { "project:github": false, "server:figma": true },
 *       // v13 additive（version 不变）：插件级 Tools 开关，键 = 开关单元 id
 *       "tools": { "plugin:dsh-univer-office": false, "plugin:__unattributed__": false },
 *       "missingSince": 1761328800000
 *     }
 *   }
 * }
 * ```
 *
 * `headerCreatedAt` 用于防 sessionId 复用（不一致 ⇒ 丢弃旧记录）；
 * `missingSince` 是两阶段对账的"疑似已删除"标记，见 {@link SessionStateStore.reconcile}。
 *
 * @module dsh-capability-settings/session-state
 */
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { atomicWriteText } from "./shared/atomic-write.js";
import { errMessage } from "./shared/errors.js";
import { withFileLock } from "./shared/file-lock.js";
import { readJsonDocument } from "./shared/json-config.js";
/** 当前数据文件版本；版本不认识时整份忽略（不猜测迁移）。 */
export const SESSION_STATE_VERSION = 1;
/** 插件在 dsh home 下的目录名（与包名一致，和 `jev.json` 共用）。 */
export const SESSION_STATE_DIR_NAME = "dsh-capability-settings";
/** 数据文件名。 */
export const SESSION_STATE_FILE_NAME = "session-capabilities.json";
/** 疑似已删除会话的默认宽限期（两阶段对账；24 小时）。 */
export const SESSION_STATE_GRACE_MS = 24 * 60 * 60 * 1000;
/** 目录目标权限。 */
const DIR_MODE = 0o700;
/** 文件目标权限（会话 id 与开关不算敏感，但与 jev.json 保持一致的最小权限）。 */
const FILE_MODE = 0o600;
/** 配置目录：`<dshHome>/dsh-capability-settings`。 */
export function sessionStateDir(dshHome) {
    return join(resolveDshHome(dshHome), SESSION_STATE_DIR_NAME);
}
/** 数据文件：`<dshHome>/dsh-capability-settings/session-capabilities.json`。 */
export function sessionStateFile(dshHome) {
    return join(sessionStateDir(dshHome), SESSION_STATE_FILE_NAME);
}
/** 空快照。 */
function emptySnapshot() {
    return { version: SESSION_STATE_VERSION, sessions: {} };
}
/** 布尔开关表清洗：只收 boolean 值。 */
function sanitizeToggles(raw) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
        return undefined;
    const toggles = {};
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === "boolean")
            toggles[key] = value;
    }
    return Object.keys(toggles).length > 0 ? toggles : undefined;
}
/** 单条记录清洗：非法形状丢弃，未知字段忽略。 */
function sanitizeEntry(raw) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
        return undefined;
    const source = raw;
    const entry = { updatedAt: typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt) ? source.updatedAt : 0 };
    if (typeof source.headerCreatedAt === "number" && Number.isFinite(source.headerCreatedAt))
        entry.headerCreatedAt = source.headerCreatedAt;
    if (typeof source.cwd === "string" && source.cwd.length > 0)
        entry.cwd = source.cwd;
    const skills = sanitizeToggles(source.skills);
    if (skills !== undefined)
        entry.skills = skills;
    const mcp = sanitizeToggles(source.mcp);
    if (mcp !== undefined)
        entry.mcp = mcp;
    const tools = sanitizeToggles(source.tools);
    if (tools !== undefined)
        entry.tools = tools;
    if (typeof source.missingSince === "number" && Number.isFinite(source.missingSince))
        entry.missingSince = source.missingSince;
    // 完全空的记录没有保存价值（只有 meta 也不影响语义，但会让文件膨胀）。
    if (entry.skills === undefined && entry.mcp === undefined && entry.tools === undefined && entry.missingSince === undefined)
        return undefined;
    return entry;
}
/** 整份快照清洗：版本不认识时整份忽略（返回空表）。 */
function sanitizeSnapshot(raw) {
    if (raw.version !== SESSION_STATE_VERSION) {
        throw new Error(`unsupported session-capabilities version: ${String(raw.version)}`);
    }
    const source = raw.sessions;
    if (source === null || typeof source !== "object" || Array.isArray(source))
        return emptySnapshot();
    const sessions = {};
    for (const [sessionId, value] of Object.entries(source)) {
        const entry = sanitizeEntry(value);
        if (entry !== undefined)
            sessions[sessionId] = entry;
    }
    return { version: SESSION_STATE_VERSION, sessions };
}
/** 记录是否已经没有任何开关（用于"清空后删整条"）。 */
function isEmptyEntry(entry) {
    if (entry.missingSince !== undefined)
        return false;
    return (Object.keys(entry.skills ?? {}).length === 0 &&
        Object.keys(entry.mcp ?? {}).length === 0 &&
        Object.keys(entry.tools ?? {}).length === 0);
}
/**
 * 构造会话级开关存储。
 *
 * 单实例语义：MCP loader 与 Skills 会话注册表必须共用**同一个** store
 * （组合根注入），否则两个域各自"读盘-改-写"会互相覆盖。
 *
 * @param deps dsh home / 日志 / 时间源
 */
export function createSessionState(deps = {}) {
    const logger = deps.logger;
    const now = deps.now ?? (() => Date.now());
    const filePath = sessionStateFile(deps.dshHome);
    /** 内存镜像（磁盘 + 本次运行内的改动；写盘后与磁盘合并结果同步）。 */
    let image = emptySnapshot();
    /** 本次运行内删除过的会话 id：写盘合并时用来压过磁盘上的旧条目。 */
    const deleted = new Set();
    /** 懒加载 promise（失败也 resolve，避免每次调用重试）。 */
    let loaded;
    /** 写盘串行队列。 */
    let queue = Promise.resolve();
    let disposed = false;
    /** 日志 warn 包装（缺省静默）。 */
    function warn(message) {
        logger?.warn?.(message);
    }
    /** 读盘并清洗；失败降级为空表（不影响功能，只是没有显式覆盖）。 */
    async function load() {
        try {
            const raw = await readJsonDocument(filePath, "session capabilities");
            image = raw === undefined ? emptySnapshot() : sanitizeSnapshot(raw);
        }
        catch (error) {
            warn(`capability-panel: 读取会话能力开关失败，按空表继续（${errMessage(error)}）`);
            image = emptySnapshot();
        }
    }
    /** 懒加载（幂等）。 */
    function ready() {
        loaded ??= load();
        return loaded;
    }
    /** 取 / 建记录（不落盘）。 */
    function ensureEntry(sessionId, meta) {
        const known = image.sessions[sessionId];
        const entry = known ?? { updatedAt: 0 };
        if (meta?.cwd !== undefined)
            entry.cwd = meta.cwd;
        if (meta?.headerCreatedAt !== undefined)
            entry.headerCreatedAt = meta.headerCreatedAt;
        entry.updatedAt = now();
        image.sessions[sessionId] = entry;
        return entry;
    }
    /** 写 / 清除一个开关键（不落盘）。 */
    function writeToggle(sessionId, field, key, enabled, meta) {
        if (key.length === 0)
            return;
        const entry = ensureEntry(sessionId, meta);
        const toggles = entry[field] ?? {};
        if (enabled === undefined)
            delete toggles[key];
        else
            toggles[key] = enabled;
        if (Object.keys(toggles).length > 0)
            entry[field] = toggles;
        else
            delete entry[field];
        if (isEmptyEntry(entry)) {
            delete image.sessions[sessionId];
            // 记录"本进程删除了该条目"：写盘合并时压过磁盘上的旧副本，
            // 否则刚清空的记录会被合并逻辑当成"其它实例写入的新条目"复活。
            deleted.add(sessionId);
        }
    }
    /** 写盘本体：锁内读盘合并（保留其它实例写入、本进程未删除的会话）→ 原子写。 */
    async function writeSnapshot() {
        try {
            await withFileLock(filePath, async () => {
                let diskSessions = {};
                try {
                    const raw = await readJsonDocument(filePath, "session capabilities");
                    if (raw !== undefined)
                        diskSessions = sanitizeSnapshot(raw).sessions;
                }
                catch (error) {
                    // 磁盘上是旧版本 / 损坏文件：以内存镜像为准覆盖（读失败已在 load 里 warn 过）。
                    warn(`capability-panel: 合并会话能力开关时读取旧文件失败，改为整份覆盖（${errMessage(error)}）`);
                    diskSessions = {};
                }
                const merged = { version: SESSION_STATE_VERSION, sessions: {} };
                for (const [sessionId, entry] of Object.entries(diskSessions)) {
                    if (deleted.has(sessionId))
                        continue;
                    if (image.sessions[sessionId] !== undefined)
                        continue;
                    merged.sessions[sessionId] = entry;
                }
                for (const [sessionId, entry] of Object.entries(image.sessions))
                    merged.sessions[sessionId] = entry;
                await mkdir(sessionStateDir(deps.dshHome), { recursive: true, mode: DIR_MODE });
                await chmod(sessionStateDir(deps.dshHome), DIR_MODE).catch(() => undefined);
                await atomicWriteText(filePath, `${JSON.stringify(merged, null, 2)}\n`, "session-capabilities", { mode: FILE_MODE });
                image = merged;
                deleted.clear();
            });
        }
        catch (error) {
            warn(`capability-panel: 保存会话能力开关失败（仅本次运行内生效，重启后会丢失该次修改）：${errMessage(error)}`);
        }
    }
    /** 排队写盘（串行；失败不抛）。 */
    function persist() {
        if (disposed)
            return Promise.resolve();
        const run = queue.then(writeSnapshot, writeSnapshot);
        queue = run.then(() => undefined, () => undefined);
        return run;
    }
    return {
        filePath,
        ready,
        skills(sessionId) {
            return { ...(image.sessions[sessionId]?.skills ?? {}) };
        },
        mcp(sessionId) {
            return { ...(image.sessions[sessionId]?.mcp ?? {}) };
        },
        tools(sessionId) {
            return { ...(image.sessions[sessionId]?.tools ?? {}) };
        },
        verifySession(sessionId, meta) {
            const entry = image.sessions[sessionId];
            if (entry === undefined)
                return false;
            if (meta?.headerCreatedAt !== undefined &&
                entry.headerCreatedAt !== undefined &&
                entry.headerCreatedAt !== meta.headerCreatedAt) {
                // sessionId 复用：旧记录不属于这个会话，丢弃。
                delete image.sessions[sessionId];
                deleted.add(sessionId);
                void persist();
                return false;
            }
            return true;
        },
        async setSkill(sessionId, name, enabled, meta) {
            await ready();
            writeToggle(sessionId, "skills", name, enabled, meta);
            await persist();
        },
        async setMcp(sessionId, toggleKey, enabled, meta) {
            await ready();
            writeToggle(sessionId, "mcp", toggleKey, enabled, meta);
            await persist();
        },
        async setTool(sessionId, unitKey, enabled, meta) {
            await ready();
            writeToggle(sessionId, "tools", unitKey, enabled, meta);
            await persist();
        },
        async setToggles(sessionId, domain, entries, meta) {
            await ready();
            // 空表 = 不改（不是"清空全部"）：调用方按批给出要写的键。
            const keys = Object.keys(entries);
            if (keys.length === 0)
                return;
            for (const key of keys)
                writeToggle(sessionId, domain, key, entries[key], meta);
            await persist();
        },
        async forget(sessionId) {
            await ready();
            const existed = image.sessions[sessionId] !== undefined;
            delete image.sessions[sessionId];
            deleted.add(sessionId);
            if (existed)
                await persist();
            // 内存里本就没有：磁盘上若有该条目是其它实例写的新数据，不该删除；
            // 只撤销本进程的删除标记（不能 clear，否则会误伤其它待删 id）。
            else
                deleted.delete(sessionId);
        },
        async reconcile(input) {
            await ready();
            const timestamp = input.now ?? now();
            const graceMs = input.graceMs ?? SESSION_STATE_GRACE_MS;
            const missing = [];
            const removed = [];
            const retained = [];
            let changed = false;
            let checked = 0;
            for (const [sessionId, entry] of Object.entries(image.sessions)) {
                checked += 1;
                // live（有 agent / session 对象）⇒ 必然存在。
                if (input.liveIds.has(sessionId)) {
                    retained.push(sessionId);
                    if (entry.missingSince !== undefined) {
                        delete entry.missingSince;
                        changed = true;
                    }
                    continue;
                }
                let exists;
                try {
                    exists = await input.persisted(sessionId);
                }
                catch {
                    exists = undefined;
                }
                // 无法判断（服务未就绪 / 快照损坏 / 未知异常）：保留，绝不误删。
                if (exists === undefined) {
                    retained.push(sessionId);
                    continue;
                }
                if (exists) {
                    retained.push(sessionId);
                    if (entry.missingSince !== undefined) {
                        delete entry.missingSince;
                        changed = true;
                    }
                    continue;
                }
                missing.push(sessionId);
                if (!input.allowDelete) {
                    // disposed 触发的核对：只标记，交给下一次允许删除的对账。
                    if (entry.missingSince === undefined) {
                        entry.missingSince = timestamp;
                        changed = true;
                    }
                    continue;
                }
                if (entry.missingSince === undefined) {
                    // 第一阶段：首次发现缺失，只打标记。
                    entry.missingSince = timestamp;
                    changed = true;
                    continue;
                }
                if (timestamp - entry.missingSince >= graceMs) {
                    delete image.sessions[sessionId];
                    deleted.add(sessionId);
                    removed.push(sessionId);
                    changed = true;
                }
            }
            if (changed)
                await persist();
            return { checked, missing, removed, retained };
        },
        entries() {
            return { ...image.sessions };
        },
        dispose() {
            disposed = true;
        },
    };
}
