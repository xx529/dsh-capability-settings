/**
 * 归属扫描缓存 `<dshHome>/dsh-capability-settings/tool-attribution.json`（D7/§8）。
 *
 * 契约：
 *   - `version: 3`；`hostVersion` / `selfPackage` 作为整体失效键；
 *   - **< v3 迁移**：保留 `packages` 扫描结果（省一次全量重扫）；`v1` 的
 *     `runtime` 全丢（`dsh-context` 包装 `register` 污染）；`v2` 的 `runtime`
 *     逐条校验——与人工表冲突的条目视为被监听拦截器污染（本机
 *     `dsh-trace-inspect/desc-inject`）丢弃，不冲突的保留；`interceptors` 不跨
 *     版本复用；
 *   - 单包失效键 = 包名 + version + mtimeMs（宿主版本变化时整份失效）；
 *   - 原子写（0600 / 目录 0700）+ `withFileLock` 锁内**读盘合并**（多实例/多次
 *     写入不丢别人的包结果）+ 进程内串行队列；
 *   - 损坏 / 未知 version → warn + 按空缓存继续（后台重建），**不抛**；
 *   - 只存包名/版本/mtime/字面量（**不存绝对路径**）。
 *
 * @module dsh-capability-settings/tools/attribution/cache
 */
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { atomicWriteText } from "../../shared/atomic-write.js";
import { errMessage } from "../../shared/errors.js";
import { withFileLock } from "../../shared/file-lock.js";
import { readJsonDocument } from "../../shared/json-config.js";
import { attributeTool } from "../../shared/plugin-attribution.js";
import { SESSION_STATE_DIR_NAME } from "../../session-state.js";
import { TOOL_ATTRIBUTION_CACHE_FILE, TOOL_ATTRIBUTION_CACHE_VERSION, } from "./types.js";
import { SELF_PACKAGE } from "./unit-id.js";
/** 目录/文件权限（与既有配置文件一致）。 */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
/** 缓存文件路径：`<dshHome>/dsh-capability-settings/tool-attribution.json`。 */
export function attributionCacheFile(dshHome) {
    return join(resolveDshHome(dshHome), SESSION_STATE_DIR_NAME, TOOL_ATTRIBUTION_CACHE_FILE);
}
/** 清洗一个单包扫描结果。 */
function sanitizePackage(raw) {
    if (raw === null || typeof raw !== "object")
        return undefined;
    const value = raw;
    const literals = Array.isArray(value.literals)
        ? value.literals.filter((item) => typeof item === "string").slice(0, 50000)
        : [];
    const namespaceHints = Array.isArray(value.namespaceHints)
        ? value.namespaceHints.filter((item) => typeof item === "string").slice(0, 500)
        : [];
    return {
        version: typeof value.version === "string" ? value.version : "unknown",
        mtimeMs: typeof value.mtimeMs === "number" && Number.isFinite(value.mtimeMs) ? Math.trunc(value.mtimeMs) : 0,
        literals,
        namespaceHints,
    };
}
/** 清洗拦截器包名单（只接受包名形态，去重、最多 50 个）。 */
function sanitizeInterceptors(raw) {
    if (!Array.isArray(raw))
        return [];
    const found = [];
    for (const item of raw) {
        if (typeof item !== "string")
            continue;
        const value = item.trim().toLowerCase();
        if (value.length === 0 || value.length > 214 || found.includes(value))
            continue;
        found.push(value);
    }
    return found.slice(0, 50);
}
/**
 * 整体校验缓存文件。
 *
 * v1 / v2 兼容：`packages` 继续可用（省一次全量扫描）；旧版 `runtime` 与人工表
 * **冲突**的条目视为被注册/监听拦截器污染、直接丢弃，不冲突的保留（避免升级
 * 丢掉新插件已学到的归属）；`interceptors` 不跨版本复用。
 */
function sanitizeCache(raw, deps) {
    const rawVersion = typeof raw.version === "number" ? raw.version : undefined;
    const legacy = rawVersion === 1 || rawVersion === 2;
    if (rawVersion !== TOOL_ATTRIBUTION_CACHE_VERSION && !legacy)
        return undefined;
    /** 旧版 runtime 需要逐条校验（v1 全丢；v2 只丢与人工表冲突的污染项）。 */
    const filterRuntime = rawVersion !== undefined && rawVersion < TOOL_ATTRIBUTION_CACHE_VERSION;
    const dropV1Runtime = rawVersion === 1;
    if (typeof raw.selfPackage === "string" && raw.selfPackage !== SELF_PACKAGE)
        return undefined;
    const hostVersion = typeof raw.hostVersion === "string" ? raw.hostVersion : "unknown";
    if (hostVersion !== "unknown" && deps.hostVersion !== "unknown" && hostVersion !== deps.hostVersion)
        return undefined;
    const packages = {};
    const rawPackages = raw.packages !== null && typeof raw.packages === "object" ? raw.packages : {};
    for (const [key, value] of Object.entries(rawPackages)) {
        const scan = sanitizePackage(value);
        if (scan !== undefined)
            packages[key] = scan;
    }
    const runtime = {};
    const rawRuntime = !dropV1Runtime && raw.runtime !== null && typeof raw.runtime === "object"
        ? raw.runtime
        : {};
    for (const [tool, value] of Object.entries(rawRuntime)) {
        // `mcp__*` 恒归 MCP 域（命名空间层），v2 起不再把工具归属写进 runtime。
        if (tool.startsWith("mcp__"))
            continue;
        if (value === null || typeof value !== "object")
            continue;
        const entry = value;
        if (typeof entry.package !== "string" || entry.package.length === 0)
            continue;
        // 旧版 runtime 与人工表冲突 ⇒ 视为被拦截器污染，丢弃；不冲突（含人工表
        // 没有规则的新插件）保留，避免每次升级丢掉已学到的归属。
        if (filterRuntime) {
            const rule = attributeTool(tool);
            const tablePackage = rule?.packageName ?? rule?.display;
            if (tablePackage !== undefined && tablePackage.toLowerCase() !== entry.package.toLowerCase())
                continue;
        }
        const confidence = entry.confidence === "medium" ? "medium" : "high";
        runtime[tool] = {
            package: entry.package,
            at: typeof entry.at === "number" ? entry.at : 0,
            confidence,
        };
    }
    const failures = {};
    const rawFailures = raw.failures !== null && typeof raw.failures === "object" ? raw.failures : {};
    for (const [key, value] of Object.entries(rawFailures)) {
        if (value === null || typeof value !== "object")
            continue;
        const entry = value;
        if (typeof entry.reason !== "string")
            continue;
        failures[key] = { reason: entry.reason, at: typeof entry.at === "number" ? entry.at : 0 };
    }
    return {
        version: TOOL_ATTRIBUTION_CACHE_VERSION,
        generatedAt: typeof raw.generatedAt === "number" ? raw.generatedAt : 0,
        hostVersion,
        selfPackage: SELF_PACKAGE,
        packages,
        runtime,
        failures,
        interceptors: filterRuntime ? [] : sanitizeInterceptors(raw.interceptors),
    };
}
/** 创建缓存读写器。 */
export function createAttributionCache(deps) {
    const logger = deps.logger;
    const now = deps.now ?? (() => Date.now());
    const filePath = attributionCacheFile(deps.dshHome);
    /** 进程内串行：写缓存不并发互相覆盖。 */
    let queue = Promise.resolve();
    let disposed = false;
    return {
        filePath,
        async load() {
            try {
                const raw = await readJsonDocument(filePath, "tool attribution cache");
                if (raw === undefined)
                    return undefined;
                return sanitizeCache(raw, deps);
            }
            catch (error) {
                logger?.warn?.(`capability-panel: 归属缓存损坏，按空缓存重建（${errMessage(error)}）`);
                return undefined;
            }
        },
        save(update) {
            if (disposed)
                return Promise.resolve();
            const run = queue.then(async () => {
                try {
                    await withFileLock(filePath, async () => {
                        let disk;
                        try {
                            const raw = await readJsonDocument(filePath, "tool attribution cache");
                            disk = raw === undefined ? undefined : sanitizeCache(raw, deps);
                        }
                        catch {
                            disk = undefined;
                        }
                        const packages = update.replacePackages === true ? {} : { ...(disk?.packages ?? {}) };
                        Object.assign(packages, update.packages ?? {});
                        // runtime：按 `at` 取更新，最多保留 500 条。
                        const runtime = update.replacePackages === true ? {} : { ...(disk?.runtime ?? {}) };
                        for (const [tool, entry] of Object.entries(update.runtime ?? {})) {
                            const previous = runtime[tool];
                            if (previous === undefined || entry.at >= previous.at)
                                runtime[tool] = entry;
                        }
                        const runtimeEntries = Object.entries(runtime)
                            .sort((left, right) => right[1].at - left[1].at)
                            .slice(0, 500);
                        const failures = { ...(disk?.failures ?? {}), ...(update.failures ?? {}) };
                        const failureEntries = Object.entries(failures)
                            .sort((left, right) => right[1].at - left[1].at)
                            .slice(0, 50);
                        const interceptors = sanitizeInterceptors([
                            ...(disk?.interceptors ?? []),
                            ...(update.interceptors ?? []),
                        ]);
                        const body = {
                            version: TOOL_ATTRIBUTION_CACHE_VERSION,
                            generatedAt: now(),
                            hostVersion: deps.hostVersion,
                            selfPackage: SELF_PACKAGE,
                            packages,
                            runtime: Object.fromEntries(runtimeEntries),
                            failures: Object.fromEntries(failureEntries),
                            interceptors,
                        };
                        const dir = join(resolveDshHome(deps.dshHome), SESSION_STATE_DIR_NAME);
                        await mkdir(dir, { recursive: true, mode: DIR_MODE });
                        await chmod(dir, DIR_MODE).catch(() => undefined);
                        await atomicWriteText(filePath, `${JSON.stringify(body, null, 2)}\n`, "tool-attribution", { mode: FILE_MODE });
                    });
                }
                catch (error) {
                    logger?.warn?.(`capability-panel: 写入归属缓存失败（${errMessage(error)}）`);
                }
            });
            queue = run.catch(() => undefined);
            return run;
        },
        dispose() {
            disposed = true;
        },
    };
}
