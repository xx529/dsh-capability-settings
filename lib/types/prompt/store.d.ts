/**
 * Prompt 域的两个持久化文件（都在 `<dshHome>/dsh-capability-settings/`，0600）：
 *
 *   1. `prompt-policy.json` —— 策略层：
 *      - `visibility`：全局 prompt（`user-global` / `agents-global`）的可见范围与
 *        每工作区默认；
 *      - `projects`：按**项目根**记录每个文件的「本项目默认启停」；
 *      - `sessions`：会话首屏的显式选择（未设置 = 跟随默认层 = 全选）。
 *   2. `prompt-manifests.json` —— 会话冻结清单（会话开始后只读，面板/会话页的
 *      权威来源）；会话首轮注入时写入一次，之后不再变化。
 *
 * 写入统一走 `atomicWriteText` + `withFileLock`；读取损坏时降级为空策略并回收
 * 可读错误（不拖垮面板）。
 *
 * @module dsh-capability-settings/prompt/store
 */
import type { PromptManifest, PromptVisibility } from "./types.js";
/** 策略文件里的项目级默认集合。 */
export interface PromptProjectPolicy {
    /** 文件绝对路径 → 本项目默认启用。 */
    defaults: Record<string, boolean>;
    updatedAt?: number;
    cwd?: string;
}
/** 策略文件里的会话显式选择。 */
export interface PromptSessionPolicy {
    /** 显式选中的文件绝对路径（按会话；缺省 = 跟随默认层）。 */
    selected: string[];
    updatedAt?: number;
    cwd?: string;
}
/** `prompt-policy.json` 的磁盘形状。 */
export interface PromptPolicyFile {
    version: 1;
    /** 全局逻辑作用域 → 可见性（逻辑键，不随 DSH_HOME 变化）。 */
    visibility: Record<string, PromptVisibility>;
    /** 项目根绝对路径 → 项目级默认。 */
    projects: Record<string, PromptProjectPolicy>;
    /** sessionId → 显式选择。 */
    sessions: Record<string, PromptSessionPolicy>;
}
/** 读取策略的结果（坏数据降级 + errors）。 */
export interface PromptPolicyReadResult {
    policy: PromptPolicyFile;
    errors: string[];
}
/** 空策略。 */
export declare function emptyPromptPolicy(): PromptPolicyFile;
/** 策略文件绝对路径。 */
export declare function promptPolicyFile(dshHome?: string): string;
/** 冻结清单文件绝对路径。 */
export declare function promptManifestsFile(dshHome?: string): string;
/**
 * 读取策略文件（宽容：缺失/损坏 → 空策略 + errors）。
 *
 * @param dshHome 覆盖（缺省解析）
 * @returns 规范化策略 + 可读错误
 */
export declare function readPromptPolicy(dshHome?: string): Promise<PromptPolicyReadResult>;
/**
 * 读-改-写策略文件（进程内按文件串行）。
 *
 * @param mutate 修改函数（可原地修改并返回新策略）
 * @param dshHome 覆盖
 * @returns 写入后的策略
 */
export declare function mutatePromptPolicy(mutate: (policy: PromptPolicyFile) => PromptPolicyFile | void, dshHome?: string): Promise<PromptPolicyFile>;
/**
 * 读取某会话的冻结清单。
 *
 * @param sessionId 会话 id
 * @param dshHome 覆盖
 * @returns 清单或 undefined
 */
export declare function readPromptManifest(sessionId: string, dshHome?: string): Promise<PromptManifest | undefined>;
/**
 * 写入/覆盖某会话冻结清单（会话首轮注入时一次）。
 *
 * @param manifest 冻结清单
 * @param dshHome 覆盖
 */
export declare function writePromptManifest(manifest: PromptManifest, dshHome?: string): Promise<void>;
/** 读取文件的 `{size, mtimeMs, digest?}`；失败返回 undefined。 */
export declare function fileStatSafe(path: string): Promise<{
    size: number;
    mtimeMs: number;
} | undefined>;
/** 读取整个文件（UTF-8）；失败返回 undefined。 */
export declare function readFileSafe(path: string): Promise<string | undefined>;
