/**
 * 宿主集成层：**只负责「把哪些文件交给 DSH」**，不实现渲染。
 *
 * 渲染统一调用宿主导出的
 * `@deepseek-ai/dsh-agent-instructions` 的 `loadBaselineInstructions(options, fileSystem)`：
 *
 *   - 第二个参数是宿主自己的 `fileSystem` 接缝；我们传入一个「只把已启用文件
 *     视为存在」的虚拟 fs；
 *   - 于是**发现顺序、trim 去重、`maxSourceBytes` 跳过、`maxBytes` 预算截断、
 *     `<system-reminder>` framing** 全部由宿主完成；
 *   - 本模块只做：取宿主模块实例（`loader.import`，与宿主注入器同一份代码）、
 *     枚举候选路径（用于 UI / 策略计算）、把允许集合包成虚拟 fs、调用渲染。
 *
 * 任何失败都返回 undefined（fail-open：调用方放行宿主原消息，绝不拖垮对话）。
 *
 * @module dsh-capability-settings/prompt/host
 */
import { type PromptCandidate, type PromptHomes, type PromptRenderConfig } from "./paths.js";
/** 宿主渲染结果（原样透传宿主的诊断）。 */
export interface PromptRenderResult {
    text: string;
    omitted: Array<{
        displayPath: string;
    }>;
    truncated: Array<{
        displayPath: string;
        originalBytes: number;
        includedBytes: number;
    }>;
}
/** 宿主集成句柄。 */
export interface PromptHost {
    /** 模块是否可用（不可用 = 只读面板仍可工作，注入层降级为宿主原样）。 */
    available(): Promise<boolean>;
    /**
     * 枚举「已存在」的候选（只列路径，不渲染）。
     *
     * @param options cwd / 项目根 / 渲染配置
     * @returns 候选列表（全局两处 + 项目链，宽泛 → 具体）
     */
    discover(options: {
        cwd: string;
        projectRoot: string;
        homes: PromptHomes;
        config: PromptRenderConfig;
    }): Promise<PromptCandidate[]>;
    /**
     * 用宿主渲染器生成 baseline 正文（只传允许集合）。
     *
     * @param options 渲染参数
     * @param allowed 允许出现在渲染里文件的绝对路径集合
     * @returns 宿主渲染结果；失败或空返回 undefined
     */
    render(options: {
        cwd: string;
        homes: PromptHomes;
        config: PromptRenderConfig;
        replacePreviousBaseline?: boolean;
    }, allowed: ReadonlySet<string>): Promise<PromptRenderResult | undefined>;
}
/** 计算全文 SHA-1（与宿主 `source.changes[].digest` 同口径）。 */
export declare function sha1Of(text: string): string;
/**
 * 创建宿主集成句柄。
 *
 * @param ctx 插件宿主 ctx（用 `ctx.get("loader").import` 取宿主模块实例）
 * @returns 句柄；模块不可用时 `available()` 为 false，其余方法降级
 */
export declare function createPromptHost(ctx: {
    get?: (name: string) => unknown;
}): PromptHost;
/** 解析 baselineIdentity（宿主注入消息里的权威渲染配置）。 */
export declare function parseBaselineIdentity(raw: unknown): PromptRenderConfig | undefined;
/** 便捷：从配置 + 会话 cwd 还原绝对项目根。 */
export declare function absoluteProjectRoot(config: PromptRenderConfig, cwd: string): string;
/** 便捷：全局候选文件的逻辑作用域键（`user-global` / `agents-global`）。 */
export declare function scopeKeyOf(candidate: Pick<PromptCandidate, "scope">): string;
/** 便捷：判断路径是否为某个 home 下的全局 AGENTS.md。 */
export declare function isGlobalPromptPath(path: string, homes: PromptHomes): boolean;
