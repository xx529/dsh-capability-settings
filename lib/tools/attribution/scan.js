/**
 * T1/T2/T3 的静态侧：包根发现 + 源码字面量索引 + 名字相似度。
 *
 * 设计：`docs/architecture/plugin-attribution-auto.md` §6（T1/T2）与 §5 相似度阈值；
 * 证据 §3（本机 26 个第三方 bundle 扫描 0.46s / 23k 字面量，跳 artifacts 与大文件）。
 *
 * 安全：**只读文本、绝不执行**被测插件的代码；跳过 node_modules/artifacts/test
 * 与大文件；单包/总量 deadline 到点放弃（记 failures），不阻塞事件循环。
 *
 * @module dsh-capability-settings/tools/attribution/scan
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { normalizePackageId, SELF_PACKAGE } from "./unit-id.js";
/** 默认限额（证据 §3.2 / §10 R6）。 */
export const DEFAULT_SCAN_LIMITS = {
    fileBytes: 2 * 1024 * 1024,
    filesPerPackage: 3000,
    deadlineMs: 300,
    totalBytes: 64 * 1024 * 1024,
};
/** 宿主/框架包：永不作为插件归属（app.asar 与 profile 内的 @deepseek-ai/* 包）。 */
export function isHostPackage(packageId) {
    const id = normalizePackageId(packageId);
    return id.startsWith("@deepseek-ai/") || id === "dsh-mcp-client" || id === SELF_PACKAGE;
}
/** 扫描时跳过的目录名（测试/构建产物/嵌套依赖）。 */
const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    ".hg",
    "artifacts",
    "artifact",
    "test",
    "tests",
    "__tests__",
    "coverage",
    ".cache",
    ".turbo",
    ".venv",
    "venv",
]);
/** 只扫这些扩展名（设计：.js/.mjs/.cjs；.d.ts 天然不在内）。 */
const SCAN_EXTENSIONS = [".js", ".mjs", ".cjs"];
/** 源码字面量正则（证据 §13 参数：长度 3–64 的普通标识符形态）。 */
const LITERAL_PATTERN = /["'`]([A-Za-z][A-Za-z0-9_.\-]{2,63})["'`]/g;
/** `mcp__<ns>__` 命名空间字面量。 */
const NAMESPACE_PATTERN = /^mcp__([A-Za-z0-9_-]+)__/;
/** 文件名是否要扫描。 */
function shouldScanFile(name) {
    const lower = name.toLowerCase();
    if (lower.endsWith(".d.ts") || lower.endsWith(".d.mts") || lower.endsWith(".d.cts"))
        return false;
    return SCAN_EXTENSIONS.some((extension) => lower.endsWith(extension));
}
/** 让出事件循环（避免大扫描阻塞 RPC）。 */
function yieldLoop() {
    return new Promise((wait) => setImmediate(wait));
}
/** baseUrl（URL 或路径）→ 文件系统路径；不可用时 undefined。 */
function baseUrlToPath(baseUrl) {
    if (typeof baseUrl !== "string" || baseUrl.length === 0)
        return undefined;
    let value = baseUrl.trim();
    if (value.startsWith("file://")) {
        try {
            value = decodeURIComponent(new URL(value).pathname);
        }
        catch {
            return undefined;
        }
    }
    if (!value.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(value))
        return undefined;
    return value;
}
/** 读包根下的 package.json（version；读失败给 "unknown"）。 */
async function readPackageVersion(dir) {
    try {
        const raw = await readFile(join(dir, "package.json"), "utf8");
        const parsed = JSON.parse(raw);
        return typeof parsed.version === "string" && parsed.version.length > 0 ? parsed.version : "unknown";
    }
    catch {
        return "unknown";
    }
}
/** 目录 mtime（探测不到 0；用于缓存失效键）。 */
async function readDirMtime(dir) {
    try {
        const info = await stat(dir);
        return typeof info.mtimeMs === "number" ? Math.trunc(info.mtimeMs) : 0;
    }
    catch {
        return 0;
    }
}
/**
 * 发现可扫描的第三方插件包根（D6）。
 *
 * 首选宿主 `pluginPackages.packageOf(name, baseUrl)?.dir`（官方消费范例
 * `dsh-tool-cordis`）；拿不到的条目回退 `createRequire(baseUrl).resolve.paths(name)`
 * 探测；仍拿不到 → 跳过该包（仅 T0/T3 覆盖）。自身包与宿主包一律排除。
 */
export async function resolvePackageRoots(ctx) {
    const roots = new Map();
    let entries = [];
    try {
        const loader = ctx?.loader ?? ctx?.get?.("loader");
        if (typeof loader?.entries === "function") {
            const raw = loader.entries();
            entries = Array.isArray(raw) ? raw : typeof raw?.[Symbol.iterator] === "function" ? [...raw] : [];
        }
    }
    catch {
        entries = [];
    }
    let packages;
    try {
        packages = ctx?.get?.("pluginPackages");
    }
    catch {
        packages = undefined;
    }
    const requireFrom = (baseUrl) => {
        const path = baseUrlToPath(baseUrl);
        if (path === undefined)
            return undefined;
        try {
            const anchor = path.endsWith("/") || /[\\/]$/.test(path) ? join(path, "package.json") : path;
            return createRequire(anchor);
        }
        catch {
            return undefined;
        }
    };
    for (const entry of entries) {
        const name = typeof entry?.options?.name === "string" ? entry.options.name : "";
        if (name.length === 0)
            continue;
        const packageId = normalizePackageId(name);
        if (isHostPackage(packageId) || roots.has(packageId))
            continue;
        const baseUrl = entry?.ctx?.baseUrl ?? entry?.baseUrl ?? entry?.options?.baseUrl;
        let dir;
        try {
            const found = typeof packages?.packageOf === "function" ? packages.packageOf(name, baseUrl) : undefined;
            if (typeof found?.dir === "string" && found.dir.length > 0)
                dir = found.dir;
        }
        catch {
            dir = undefined;
        }
        if (dir === undefined) {
            const req = requireFrom(typeof baseUrl === "string" ? baseUrl : "");
            try {
                const paths = req?.resolve.paths(name) ?? [];
                for (const nodeModules of paths) {
                    const candidate = join(nodeModules, name);
                    try {
                        await stat(candidate);
                        dir = candidate;
                        break;
                    }
                    catch {
                        /* 继续找 */
                    }
                }
            }
            catch {
                /* 解析失败：跳过该包 */
            }
        }
        if (dir === undefined)
            continue;
        roots.set(packageId, {
            packageId,
            dir: resolve(dir),
            version: await readPackageVersion(dir),
            mtimeMs: await readDirMtime(dir),
        });
    }
    return [...roots.values()];
}
/** 递归收集一个包根下的待扫文件（跳过 SKIP_DIRS）。 */
async function collectFiles(dir, out, filesLimit) {
    if (out.length >= filesLimit)
        return;
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (out.length >= filesLimit)
            return;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name))
                continue;
            await collectFiles(full, out, filesLimit);
            continue;
        }
        if (entry.isFile() && shouldScanFile(entry.name))
            out.push(full);
    }
}
/** 从源码文本提取字面量（纯字符串正则，不执行代码）。 */
export function extractLiterals(source) {
    const literals = new Set();
    const namespaces = new Set();
    LITERAL_PATTERN.lastIndex = 0;
    let match;
    while ((match = LITERAL_PATTERN.exec(source)) !== null) {
        const value = match[1] ?? "";
        literals.add(value);
        const ns = NAMESPACE_PATTERN.exec(value)?.[1];
        if (ns !== undefined && ns.length > 0)
            namespaces.add(ns);
    }
    return { literals: [...literals], namespaces: [...namespaces] };
}
/**
 * 扫描一个包（异步、限额、让出事件循环）。返回 undefined = 超时/失败。
 */
export async function scanPackage(root, limits = DEFAULT_SCAN_LIMITS) {
    const startedAt = Date.now();
    const files = [];
    await collectFiles(root.dir, files, limits.filesPerPackage);
    const literals = new Set();
    const namespaces = new Set();
    let bytes = 0;
    for (let index = 0; index < files.length; index += 1) {
        if (Date.now() - startedAt > limits.deadlineMs || bytes > limits.totalBytes)
            return undefined;
        if (index % 20 === 0)
            await yieldLoop();
        const file = files[index];
        if (file === undefined)
            continue;
        try {
            const info = await stat(file);
            if (info.size > limits.fileBytes)
                continue;
            const source = await readFile(file, "utf8");
            bytes += source.length;
            const found = extractLiterals(source);
            for (const literal of found.literals)
                literals.add(literal);
            for (const namespace of found.namespaces)
                namespaces.add(namespace);
        }
        catch {
            /* 单文件读失败：忽略 */
        }
    }
    return {
        version: root.version,
        mtimeMs: root.mtimeMs,
        literals: [...literals],
        namespaceHints: [...namespaces],
    };
}
/** 批量扫描（串行；单包超时记 failures）。 */
export async function scanPackages(roots, limits = DEFAULT_SCAN_LIMITS, logger) {
    const startedAt = Date.now();
    const packages = new Map();
    const failures = {};
    let files = 0;
    let bytes = 0;
    for (const root of roots) {
        try {
            const result = await scanPackage(root, limits);
            if (result === undefined) {
                failures[root.packageId] = "deadline-or-size-limit";
                logger?.warn?.(`capability-panel: 归属扫描超时/超限，跳过 ${root.packageId}`);
                continue;
            }
            packages.set(root.packageId, result);
            files += result.literals.length;
        }
        catch (error) {
            failures[root.packageId] = String(error);
        }
    }
    return { packages, files, bytes, ms: Date.now() - startedAt, failures };
}
/** 名字分词（小写、按非字母数字切、去停用词/过短 token）。 */
const STOPWORDS = new Set(["dsh", "plugin", "plugins", "tool", "tools", "mcp", "manager", "local", "npm", "the", "and", "for", "with", "lib", "src", "index", "main"]);
/** 分词。 */
export function tokenizeName(value) {
    const lower = value.toLowerCase();
    const stripped = lower.startsWith("@") && lower.includes("/") ? lower.slice(lower.indexOf("/") + 1) : lower;
    const tokens = stripped.split(/[^a-z0-9]+/gu).filter((token) => token.length >= 2 && !STOPWORDS.has(token));
    return [...new Set(tokens)];
}
/**
 * T3 相似度：包名 token ∩ 工具名 token / min(token 数)。
 *
 * 阈值由 resolver 决定（设计：score ≥0.5 且 margin ≥0.3 才采用）。
 */
export function similarityScore(packageId, toolName) {
    const packageTokens = tokenizeName(packageId);
    const toolTokens = tokenizeName(toolName);
    if (packageTokens.length === 0 || toolTokens.length === 0)
        return 0;
    let overlap = 0;
    for (const token of packageTokens)
        if (toolTokens.includes(token))
            overlap += 1;
    return overlap / Math.min(packageTokens.length, toolTokens.length);
}
/** 计算最佳/次佳相似度（供 margin 判定）。 */
export function rankSimilarity(packageIds, toolName) {
    const ranked = [];
    for (const packageId of packageIds) {
        if (isHostPackage(packageId))
            continue;
        const score = similarityScore(packageId, toolName);
        if (score > 0)
            ranked.push({ packageId, score });
    }
    ranked.sort((a, b) => b.score - a.score || a.packageId.localeCompare(b.packageId));
    return ranked;
}
/** 包名归一工具（re-export 方便调用方一处 import）。 */
export { normalizePackageId };
