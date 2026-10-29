/**
 * 归属扫描缓存 `<dshHome>/dsh-capability-settings/tool-attribution.json`（D7/§8）。
 *
 * 契约：
 *   - `version: 1`；`hostVersion` / `selfPackage` 作为整体失效键；
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
/** 整体校验缓存文件。 */
function sanitizeCache(raw, deps) {
    if (raw.version !== TOOL_ATTRIBUTION_CACHE_VERSION)
        return undefined;
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
    const rawRuntime = raw.runtime !== null && typeof raw.runtime === "object" ? raw.runtime : {};
    for (const [tool, value] of Object.entries(rawRuntime)) {
        if (value === null || typeof value !== "object")
            continue;
        const entry = value;
        if (typeof entry.package !== "string" || entry.package.length === 0)
            continue;
        runtime[tool] = { package: entry.package, at: typeof entry.at === "number" ? entry.at : 0 };
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
                        const body = {
                            version: TOOL_ATTRIBUTION_CACHE_VERSION,
                            generatedAt: now(),
                            hostVersion: deps.hostVersion,
                            selfPackage: SELF_PACKAGE,
                            packages,
                            runtime: Object.fromEntries(runtimeEntries),
                            failures: Object.fromEntries(failureEntries),
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
