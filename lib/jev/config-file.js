/**
 * Jev 配置文件的读写、校验、密钥解析与错误脱敏。
 *
 * 存储契约（架构 §3）：
 *
 *   - 文件：`<dshHome>/dsh-capability-settings/jev.json`（见 `paths.ts`）；
 *   - 目录 0700、文件 0600（写入路径才改权限，读不碰权限）；
 *   - 旧目录 `<dshHome>/capability-panel/jev.json` 首次读取时一次性迁移（见
 *     {@link migrateLegacyJevConfig}，幂等）；
 *   - 「读-改-写」整段包在 `withFileLock` 里（F6），写用 `atomicWriteText(..., { mode: 0o600 })`；
 *   - 读：文件缺失/空/JSON 损坏 → 回默认值（并 `logger.warn`），不把面板打挂；
 *   - 写：字段级校验，越界**拒绝保存**（不夹取、不四舍五入）。
 *
 * 密钥边界（架构 §4）：解析只在宿主内发生；`JevConfigView` 只回
 * `hasApiKey / apiKeySource / apiKeyLast4`，任何面向 RPC/日志的文本都经
 * `redact()` 处理。
 *
 * @module dsh-capability-settings/jev/config-file
 */
import { chmod, copyFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { atomicWriteText } from "../shared/atomic-write.js";
import { errMessage } from "../shared/errors.js";
import { withFileLock } from "../shared/file-lock.js";
import { readJsonDocument } from "../shared/json-config.js";
import { jevConfigDir, jevConfigFile, legacyJevConfigFile } from "./paths.js";
import { defaultJevConfig } from "./types.js";
/** 默认的密钥环境变量名。 */
export const DEFAULT_API_KEY_ENV = "TYPESAFE_API_KEY";
/** 配置目录的目标权限。 */
const DIR_MODE = 0o700;
/** 配置文件的目标权限。 */
const FILE_MODE = 0o600;
/** 环境变量名合法字符（架构 §3.5）。 */
const API_KEY_ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** loopback hostname 白名单：这些主机允许 http（测试假端点）。 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** baseURL 平均长度上限（防御）。 */
const MAX_BASE_URL_LENGTH = 2048;
/** 模型名长度上限。 */
const MAX_MODEL_LENGTH = 128;
/** 文件内 key 的长度上限。 */
const MAX_API_KEY_LENGTH = 512;
/**
 * 规范化并校验 baseURL（架构 §3.5）。
 *
 * 规则：trim；去尾部 `/`；可被 `new URL()` 解析；scheme 必须 https（loopback
 * 允许 http）；pathname 不得以 `/v1/systemone` 结尾；长度 ≤ 2048。
 */
export function normalizeBaseURL(raw) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return { ok: false, code: "E_BASE_URL_FORMAT", message: "baseURL 不能为空" };
    }
    if (trimmed.length > MAX_BASE_URL_LENGTH) {
        return { ok: false, code: "E_BASE_URL_FORMAT", message: `baseURL 长度不能超过 ${MAX_BASE_URL_LENGTH}` };
    }
    const withoutSlash = trimmed.replace(/\/+$/, "");
    let parsed;
    try {
        parsed = new URL(withoutSlash);
    }
    catch {
        return { ok: false, code: "E_BASE_URL_FORMAT", message: "baseURL 不是合法 URL" };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { ok: false, code: "E_BASE_URL_SCHEME", message: "baseURL 必须使用 https（localhost/127.0.0.1/::1 允许 http）" };
    }
    if (parsed.protocol === "http:" && !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
        return { ok: false, code: "E_BASE_URL_SCHEME", message: "只有 localhost/127.0.0.1/::1 允许使用 http" };
    }
    if (parsed.hostname.length === 0) {
        return { ok: false, code: "E_BASE_URL_FORMAT", message: "baseURL 缺少主机名" };
    }
    if (parsed.pathname.replace(/\/+$/, "").endsWith("/v1/systemone")) {
        return {
            ok: false,
            code: "E_BASE_URL_HAS_ENDPOINT",
            message: "baseURL 是根地址，不要包含 /v1/systemone",
        };
    }
    return { ok: true, value: withoutSlash };
}
// ---------------------------------------------------------------------------
// 字段判定（读取容错与校验共用）
// ---------------------------------------------------------------------------
function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isIntegerInRange(value, min, max) {
    return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
/** 控制字符（含换行）检测。 */
function hasControlChars(text) {
    return /[\u0000-\u001f\u007f]/.test(text);
}
/** 模型名是否可用（trim 后非空、≤128、无控制字符）。 */
function isUsableModel(value) {
    if (typeof value !== "string")
        return false;
    const trimmed = value.trim();
    return trimmed.length > 0 && Array.from(trimmed).length <= MAX_MODEL_LENGTH && !hasControlChars(trimmed);
}
/** 文件内 key 是否可用（非空、≤512、无空白）。 */
function isUsableApiKey(value) {
    if (typeof value !== "string")
        return false;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= MAX_API_KEY_LENGTH && !/\s/.test(trimmed);
}
/** 环境变量名是否可用（trim 后匹配正则）。 */
function isUsableApiKeyEnv(value) {
    if (typeof value !== "string")
        return false;
    return API_KEY_ENV_PATTERN.test(value.trim());
}
// ---------------------------------------------------------------------------
// 读取
// ---------------------------------------------------------------------------
/** 从落盘对象里挑出可用的字段，逐字段回落到默认值（读取容错，不抛错）。 */
function sanitizeStoredConfig(raw) {
    const defaults = defaultJevConfig();
    const baseURLRaw = raw.baseURL;
    const baseURL = typeof baseURLRaw === "string" ? normalizeBaseURL(baseURLRaw) : undefined;
    const triggerRaw = raw.autoTrigger;
    const trigger = isPlainObject(triggerRaw) ? triggerRaw : {};
    const autoTrigger = {
        enabled: typeof trigger.enabled === "boolean" ? trigger.enabled : defaults.autoTrigger.enabled,
        pauseMs: isIntegerInRange(trigger.pauseMs, 300, 3000) && trigger.pauseMs % 100 === 0
            ? trigger.pauseMs
            : defaults.autoTrigger.pauseMs,
        minChars: isIntegerInRange(trigger.minChars, 1, 200) ? trigger.minChars : defaults.autoTrigger.minChars,
        minEditChars: isIntegerInRange(trigger.minEditChars, 1, 100)
            ? trigger.minEditChars
            : defaults.autoTrigger.minEditChars,
    };
    const config = {
        baseURL: baseURL?.ok === true ? baseURL.value : defaults.baseURL,
        model: isUsableModel(raw.model) ? raw.model.trim() : defaults.model,
        apiKeyEnv: isUsableApiKeyEnv(raw.apiKeyEnv) ? raw.apiKeyEnv.trim() : DEFAULT_API_KEY_ENV,
        autoTrigger,
        timeoutMs: isIntegerInRange(raw.timeoutMs, 1000, 120000) ? raw.timeoutMs : defaults.timeoutMs,
    };
    if (isUsableApiKey(raw.apiKey))
        config.apiKey = raw.apiKey.trim();
    return config;
}
/**
 * 一次性迁移：`<dshHome>/capability-panel/jev.json` →
 * `<dshHome>/dsh-capability-settings/jev.json`。
 *
 * 幂等：新文件存在且不比旧文件旧 → 不动；旧文件不存在直接返回。**旧文件更新时
 * 覆盖新文件**（升级前旧版本又写过配置的场景，避免丢最后一次保存）。优先
 * `rename`（同分区原子，保留内容与 inode），失败再退化为
 * `copyFile + chmod + unlink`。并发下若另一调用已完成迁移，看到新文件即视为
 * 成功。迁移失败只告警，读取继续走新路径（缺失则回默认值），不阻断面板。
 */
export async function migrateLegacyJevConfig(dshHome, logger) {
    const next = jevConfigFile(dshHome);
    const legacy = legacyJevConfigFile(dshHome);
    if (next === legacy)
        return;
    let nextStat;
    try {
        nextStat = await stat(next);
    }
    catch {
        nextStat = undefined;
    }
    let legacyStat;
    try {
        legacyStat = await stat(legacy);
    }
    catch {
        return;
    }
    if (nextStat !== undefined && legacyStat.mtimeMs <= nextStat.mtimeMs)
        return;
    const dir = jevConfigDir(dshHome);
    try {
        await mkdir(dir, { recursive: true, mode: DIR_MODE });
        await chmod(dir, DIR_MODE).catch(() => undefined);
        try {
            await rename(legacy, next);
            // rename 保留旧文件的 inode/mode；密钥文件统一收敛到 0600（失败不阻断读取）。
            await chmod(next, FILE_MODE).catch(() => undefined);
        }
        catch {
            // 并发下可能刚被另一个调用迁走；新文件已不旧于旧文件就当作成功。
            try {
                const fresh = await stat(next);
                if (fresh.mtimeMs >= legacyStat.mtimeMs)
                    return;
            }
            catch {
                // 新文件仍不存在：退化为复制 + 删除旧文件。
            }
            await copyFile(legacy, next);
            await chmod(next, FILE_MODE).catch(() => undefined);
            await unlink(legacy).catch(() => undefined);
        }
    }
    catch (error) {
        logger?.warn?.(`capability-panel: Jev 配置迁移失败，继续使用新路径（${redact(errMessage(error), [])}）`);
    }
}
/**
 * 读取有效配置：缺失/空/损坏都回默认值（不创建文件）。
 *
 * 单字段损坏（例如手工把 `pauseMs` 改成 250）只回落该字段，不丢其它字段
 * （尤其不丢 `apiKey`）；整个 JSON 损坏才整体回默认。
 */
export async function readJevConfig(dshHome, logger) {
    await migrateLegacyJevConfig(dshHome, logger);
    const file = jevConfigFile(dshHome);
    let raw;
    try {
        raw = await readJsonDocument(file, "Jev config");
    }
    catch (error) {
        logger?.warn?.(`capability-panel: Jev 配置读取失败，已回默认值（${redact(errMessage(error), [])}）`);
        return defaultJevConfig();
    }
    if (raw === undefined)
        return defaultJevConfig();
    const sanitized = sanitizeStoredConfig(raw);
    const validation = validateJevConfig(sanitized);
    if (!validation.ok) {
        // 理论上 sanitize 后必过；防御：任何异常形状都回默认，不让面板打挂。
        logger?.warn?.(`capability-panel: Jev 配置校验未通过，已回默认值（${validation.errors.join("; ")}）`);
        return defaultJevConfig();
    }
    return validation.value;
}
// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------
/**
 * 校验一份候选配置（字段缺省按默认值，用于读取容错与 setConfig 合并后的候选）。
 *
 * 输入按 `unknown` 处理：`setConfig` 的合并候选里可能带着用户传错的类型，
 * 这里必须逐字段给出字段级错误，而不是抛异常。
 */
export function validateJevConfig(input) {
    const defaults = defaultJevConfig();
    const source = isPlainObject(input) ? input : {};
    const issues = [];
    const issue = (field, code, message) => {
        issues.push({ field, code, message });
    };
    // baseURL
    let baseURL = defaults.baseURL;
    if (source.baseURL !== undefined) {
        if (typeof source.baseURL !== "string") {
            issue("baseURL", "E_BASE_URL_FORMAT", "baseURL 必须是字符串");
        }
        else {
            const normalized = normalizeBaseURL(source.baseURL);
            if (normalized.ok)
                baseURL = normalized.value;
            else
                issue("baseURL", normalized.code, normalized.message);
        }
    }
    // model
    let model = defaults.model;
    if (source.model !== undefined) {
        if (!isUsableModel(source.model)) {
            issue("model", "E_MODEL", "model 必须是 1–128 个字符且不含换行/控制字符");
        }
        else {
            model = source.model.trim();
        }
    }
    // apiKey（可选；空串/null 表示清掉文件 key）
    let apiKey;
    if (source.apiKey !== undefined && source.apiKey !== null) {
        if (source.apiKey === "") {
            apiKey = undefined;
        }
        else if (!isUsableApiKey(source.apiKey)) {
            issue("apiKey", "E_API_KEY", "apiKey 必须是 1–512 个字符且不含空白");
        }
        else {
            apiKey = source.apiKey.trim();
        }
    }
    // apiKeyEnv（空串/缺省 → 默认变量名）
    let apiKeyEnv = DEFAULT_API_KEY_ENV;
    if (source.apiKeyEnv !== undefined && source.apiKeyEnv !== null && source.apiKeyEnv !== "") {
        if (!isUsableApiKeyEnv(source.apiKeyEnv)) {
            issue("apiKeyEnv", "E_API_KEY_ENV", "apiKeyEnv 必须是合法的环境变量名（[A-Za-z_][A-Za-z0-9_]{0,63}）");
        }
        else {
            apiKeyEnv = source.apiKeyEnv.trim();
        }
    }
    // autoTrigger（提供时要求整对象：缺字段也报错，不做部分合并）
    let autoTrigger = defaults.autoTrigger;
    if (source.autoTrigger !== undefined) {
        if (!isPlainObject(source.autoTrigger)) {
            issue("autoTrigger", "E_AUTO_ENABLED", "autoTrigger 必须是完整对象");
        }
        else {
            const trigger = source.autoTrigger;
            const issueCountBefore = issues.length;
            if (typeof trigger.enabled !== "boolean") {
                issue("autoTrigger.enabled", "E_AUTO_ENABLED", "autoTrigger.enabled 必须是布尔值");
            }
            if (!isIntegerInRange(trigger.pauseMs, 300, 3000) || trigger.pauseMs % 100 !== 0) {
                issue("autoTrigger.pauseMs", "E_PAUSE_MS", "pauseMs 必须是 300–3000 之间、步长 100 的整数");
            }
            if (!isIntegerInRange(trigger.minChars, 1, 200)) {
                issue("autoTrigger.minChars", "E_MIN_CHARS", "minChars 必须是 1–200 的整数");
            }
            if (!isIntegerInRange(trigger.minEditChars, 1, 100)) {
                issue("autoTrigger.minEditChars", "E_MIN_EDIT_CHARS", "minEditChars 必须是 1–100 的整数");
            }
            if (issues.length === issueCountBefore) {
                autoTrigger = {
                    enabled: trigger.enabled,
                    pauseMs: trigger.pauseMs,
                    minChars: trigger.minChars,
                    minEditChars: trigger.minEditChars,
                };
            }
        }
    }
    // timeoutMs
    let timeoutMs = defaults.timeoutMs;
    if (source.timeoutMs !== undefined) {
        if (!isIntegerInRange(source.timeoutMs, 1000, 120000)) {
            issue("timeoutMs", "E_TIMEOUT_MS", "timeoutMs 必须是 1000–120000 的整数");
        }
        else {
            timeoutMs = source.timeoutMs;
        }
    }
    if (issues.length > 0) {
        return {
            ok: false,
            issues,
            errors: issues.map((item) => `[${item.code}] ${item.field}: ${item.message}`),
        };
    }
    const value = { baseURL, model, apiKeyEnv, autoTrigger, timeoutMs };
    if (apiKey !== undefined)
        value.apiKey = apiKey;
    return { ok: true, value };
}
// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------
/** 写文件本体（**调用方负责持锁**；目录 0700、文件 0600）。 */
async function writeJevConfigFile(dshHome, config) {
    const dir = jevConfigDir(dshHome);
    const file = jevConfigFile(dshHome);
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
    // 已存在目录的 mode 不会被 mkdir 改写；chmod 失败（Windows/只读 FS）不阻断保存。
    await chmod(dir, DIR_MODE).catch(() => undefined);
    const body = `${JSON.stringify(config, null, 2)}\n`;
    await atomicWriteText(file, body, "jev", { mode: FILE_MODE });
}
/** 覆盖写入一份完整配置（持锁）。一般由 {@link setJevConfig} 调用。 */
export async function saveJevConfig(dshHome, config) {
    await withFileLock(jevConfigFile(dshHome), async () => {
        await writeJevConfigFile(dshHome, config);
    });
}
/**
 * 把用户传入的字段合并到当前配置上（未传字段保持原值；`autoTrigger` 整对象替换）。
 *
 * 导出供 `jev.test` 复用：测试「本次表单配置」时必须以同一套合并语义得到
 * 临时配置，避免 setConfig 与 test 对同一个 payload 解释不一致。
 */
export function mergeJevConfigInput(current, provided) {
    const next = { ...current };
    for (const field of ["baseURL", "model", "apiKeyEnv", "timeoutMs"]) {
        if (Object.hasOwn(provided, field))
            next[field] = provided[field];
    }
    // apiKey 特殊：空串表示「清掉文件 key」，由 validate 统一处理成 undefined。
    if (Object.hasOwn(provided, "apiKey"))
        next.apiKey = provided.apiKey;
    if (Object.hasOwn(provided, "autoTrigger"))
        next.autoTrigger = provided.autoTrigger;
    return next;
}
/**
 * `jev.setConfig` 的唯一实现：锁内「读当前 → 合并 → 校验 → 写盘」。
 *
 * 校验失败不落盘、不改任何状态，返回 `invalid-config` + `issues`；写盘失败
 * 返回 `write-failed`（错误文本已脱敏）。
 */
export async function setJevConfig(dshHome, input, logger) {
    const payload = isPlainObject(input) ? input : {};
    const rawConfig = payload.config;
    if (rawConfig !== undefined && !isPlainObject(rawConfig)) {
        const issues = [{ field: "config", code: "E_CONFIG", message: "config 必须是对象" }];
        return { ok: false, code: "invalid-config", errors: issues.map((item) => `[${item.code}] ${item.field}: ${item.message}`), issues };
    }
    const provided = isPlainObject(rawConfig) ? rawConfig : {};
    try {
        return await withFileLock(jevConfigFile(dshHome), async () => {
            const current = await readJevConfig(dshHome, logger);
            const candidate = mergeJevConfigInput(current, provided);
            const validation = validateJevConfig(candidate);
            if (!validation.ok) {
                return { ok: false, code: "invalid-config", errors: validation.errors, issues: validation.issues };
            }
            try {
                await writeJevConfigFile(dshHome, validation.value);
                return { ok: true };
            }
            catch (error) {
                return {
                    ok: false,
                    code: "write-failed",
                    errors: [`[write-failed] 写入 Jev 配置失败：${redact(errMessage(error), collectJevSecrets(current, process.env))}`],
                };
            }
        });
    }
    catch (error) {
        return {
            ok: false,
            code: "write-failed",
            errors: [`[write-failed] 写入 Jev 配置失败：${redact(errMessage(error), [])}`],
        };
    }
}
/** 末 4 位：只对足够长的 key 展示，短 key 一律 `****`。 */
function maskLast4(key) {
    return key.length >= 8 ? key.slice(-4) : "****";
}
/**
 * 解析密钥：**env（`apiKeyEnv`，默认 `TYPESAFE_API_KEY`）优先于文件 `apiKey`**。
 */
export function resolveJevKey(config, env) {
    const envName = config.apiKeyEnv !== undefined && config.apiKeyEnv.length > 0 ? config.apiKeyEnv : DEFAULT_API_KEY_ENV;
    const fromEnv = env[envName];
    if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
        const value = fromEnv.trim();
        return { value, source: "env", last4: maskLast4(value) };
    }
    if (typeof config.apiKey === "string" && config.apiKey.trim().length > 0) {
        const value = config.apiKey.trim();
        return { value, source: "file", last4: maskLast4(value) };
    }
    return { source: "none", last4: null };
}
/** 一次请求/一次错误处理内需要脱敏的明文集合（去重、去空）。 */
export function collectJevSecrets(config, env) {
    const resolved = resolveJevKey(config, env);
    const secrets = new Set();
    if (resolved.value !== undefined)
        secrets.add(resolved.value);
    if (typeof config.apiKey === "string" && config.apiKey.length > 0)
        secrets.add(config.apiKey);
    if (config.apiKeyEnv !== undefined && typeof env[config.apiKeyEnv] === "string" && env[config.apiKeyEnv].length > 0) {
        secrets.add(env[config.apiKeyEnv]);
    }
    return [...secrets];
}
/** 构造对客户端的配置视图（无明文 key；`apiKeyEnv` 只回变量名，不回任何密钥）。 */
export function toJevConfigView(config, env) {
    const resolved = resolveJevKey(config, env);
    return {
        baseURL: config.baseURL,
        model: config.model,
        hasApiKey: resolved.source !== "none",
        apiKeySource: resolved.source,
        apiKeyLast4: resolved.last4,
        autoTrigger: { ...config.autoTrigger },
        timeoutMs: config.timeoutMs,
        // additive（task-19 / AC-CFG-10）：只回变量名；空值回落默认名，与写入校验口径一致。
        apiKeyEnv: typeof config.apiKeyEnv === "string" && config.apiKeyEnv.length > 0 ? config.apiKeyEnv : DEFAULT_API_KEY_ENV,
    };
}
// ---------------------------------------------------------------------------
// 脱敏
// ---------------------------------------------------------------------------
/**
 * 统一脱敏器（架构 §4.4）：所有面向 RPC 的 errors 与 logger 输出都必须经过它。
 *
 * 顺序：逐个明文替换 → `Bearer xxx` → `authorization/api-key/x-api-key: xxx`
 * → `sk-...` 兜底。不处理请求头对象/完整 URL（调用方不得把这些放进错误信息）。
 */
export function redact(text, secrets) {
    let output = typeof text === "string" ? text : String(text ?? "");
    for (const secret of secrets) {
        if (typeof secret === "string" && secret.length > 0)
            output = output.split(secret).join("***");
    }
    output = output.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***");
    output = output.replace(/(authorization|api[-_]?key|x-api-key)\s*[:=]\s*\S+/gi, "$1: ***");
    output = output.replace(/\bsk-[A-Za-z0-9._-]{8,}/g, "sk-***");
    return output;
}
