/**
 * Jev 配置文件的读写、校验、密钥解析与错误脱敏。
 *
 * 存储契约（架构 §3）：
 *
 *   - 文件：`<dshHome>/capability-panel/jev.json`（见 `paths.ts`）；
 *   - 目录 0700、文件 0600（写入路径才改权限，读不碰权限）；
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
import type { JevConfig, JevConfigValidation, JevConfigView, JevKeySource, JevLogger, JevSetConfigResult } from "./types.js";
/** 默认的密钥环境变量名。 */
export declare const DEFAULT_API_KEY_ENV = "TYPESAFE_API_KEY";
/** baseURL 规范化结果：成功时 value 已去尾部 `/`。 */
export type BaseURLNormalization = {
    ok: true;
    value: string;
} | {
    ok: false;
    code: string;
    message: string;
};
/**
 * 规范化并校验 baseURL（架构 §3.5）。
 *
 * 规则：trim；去尾部 `/`；可被 `new URL()` 解析；scheme 必须 https（loopback
 * 允许 http）；pathname 不得以 `/v1/systemone` 结尾；长度 ≤ 2048。
 */
export declare function normalizeBaseURL(raw: string): BaseURLNormalization;
/**
 * 读取有效配置：缺失/空/损坏都回默认值（不创建文件）。
 *
 * 单字段损坏（例如手工把 `pauseMs` 改成 250）只回落该字段，不丢其它字段
 * （尤其不丢 `apiKey`）；整个 JSON 损坏才整体回默认。
 */
export declare function readJevConfig(dshHome?: string, logger?: JevLogger): Promise<JevConfig>;
/**
 * 校验一份候选配置（字段缺省按默认值，用于读取容错与 setConfig 合并后的候选）。
 *
 * 输入按 `unknown` 处理：`setConfig` 的合并候选里可能带着用户传错的类型，
 * 这里必须逐字段给出字段级错误，而不是抛异常。
 */
export declare function validateJevConfig(input: unknown): JevConfigValidation;
/** 覆盖写入一份完整配置（持锁）。一般由 {@link setJevConfig} 调用。 */
export declare function saveJevConfig(dshHome: string | undefined, config: JevConfig): Promise<void>;
/**
 * 把用户传入的字段合并到当前配置上（未传字段保持原值；`autoTrigger` 整对象替换）。
 *
 * 导出供 `jev.test` 复用：测试「本次表单配置」时必须以同一套合并语义得到
 * 临时配置，避免 setConfig 与 test 对同一个 payload 解释不一致。
 */
export declare function mergeJevConfigInput(current: JevConfig, provided: Record<string, unknown>): Record<string, unknown>;
/**
 * `jev.setConfig` 的唯一实现：锁内「读当前 → 合并 → 校验 → 写盘」。
 *
 * 校验失败不落盘、不改任何状态，返回 `invalid-config` + `issues`；写盘失败
 * 返回 `write-failed`（错误文本已脱敏）。
 */
export declare function setJevConfig(dshHome: string | undefined, input: unknown, logger?: JevLogger): Promise<JevSetConfigResult>;
/** 解析出的密钥（**仅宿主内使用**；`value` 绝不下发客户端）。 */
export interface ResolvedJevKey {
    value?: string;
    source: JevKeySource;
    last4: string | null;
}
/**
 * 解析密钥：**env（`apiKeyEnv`，默认 `TYPESAFE_API_KEY`）优先于文件 `apiKey`**。
 */
export declare function resolveJevKey(config: JevConfig, env: NodeJS.ProcessEnv): ResolvedJevKey;
/** 一次请求/一次错误处理内需要脱敏的明文集合（去重、去空）。 */
export declare function collectJevSecrets(config: JevConfig, env: NodeJS.ProcessEnv): string[];
/** 构造对客户端的配置视图（无明文 key；`apiKeyEnv` 只回变量名，不回任何密钥）。 */
export declare function toJevConfigView(config: JevConfig, env: NodeJS.ProcessEnv): JevConfigView;
/**
 * 统一脱敏器（架构 §4.4）：所有面向 RPC 的 errors 与 logger 输出都必须经过它。
 *
 * 顺序：逐个明文替换 → `Bearer xxx` → `authorization/api-key/x-api-key: xxx`
 * → `sk-...` 兜底。不处理请求头对象/完整 URL（调用方不得把这些放进错误信息）。
 */
export declare function redact(text: string, secrets: readonly string[]): string;
