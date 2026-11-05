/**
 * Prompt 域宿主服务：策略层 + 面板/首屏/会话页的数据入口。
 *
 * 职责边界：
 *
 *   - **发现**：候选路径枚举（宿主 `discoverBaselineInstructionFiles`，失败时本地
 *     stat 枚举）；不做渲染；
 *   - **策略**：可见性（仅全局）/ 项目级默认 / 会话首屏显式选择 → 每个文件
 *     「是否传给 DSH」；全局与项目**叠加**（没有覆盖关系）；
 *   - **展示**：面板列表、详情读取、编辑保存、冻结清单读取；
 *   - **不实现**：拼接、去重、预算、framing —— 全部交给 `./host` 调用的宿主渲染器。
 *
 * @module dsh-capability-settings/prompt/manager
 */
import { type PromptCandidate, type PromptHomes, type PromptRenderConfig } from "./paths.js";
import { type PromptHost, type PromptRenderResult } from "./host.js";
import { type PromptPolicyFile } from "./store.js";
import type { PromptListResult, PromptManifest, PromptMutation, PromptReadResult, PromptVisibility } from "./types.js";
/** 详情读取/编辑的大小上限（与 skills registry 同量级）。 */
export declare const PROMPT_READ_MAX_BYTES: number;
/** 保存内容的硬上限（宿主单文件上限 1 MiB）。 */
export declare const PROMPT_WRITE_MAX_BYTES: number;
/** 一次选择的计算结果（策略层）。 */
export interface PromptSelection {
    homes: PromptHomes;
    projectRoot: string;
    cwd: string;
    config: PromptRenderConfig;
    candidates: PromptCandidate[];
    /** 允许传给 DSH 的文件绝对路径。 */
    allowed: Set<string>;
    /** 每个候选的有效启用态（用于列表）。 */
    views: Array<{
        candidate: PromptCandidate;
        visible: boolean;
        enabled: boolean;
        defaultEnabled: boolean;
        projectDefault?: boolean;
        sessionExplicit?: boolean;
        visibility?: {
            mode: PromptVisibility["mode"];
            visible: boolean;
            defaultEnabled: boolean;
        };
    }>;
    errors: string[];
}
/** 服务依赖。 */
export interface PromptManagerDeps {
    ctx: {
        get?: (name: string) => unknown;
    };
    host: PromptHost;
    dshHome?: string;
    agentsHome?: string;
    logger?: {
        warn?: (message: string) => void;
    };
}
/** 面板/首屏/会话页共用的服务形状。 */
export interface PromptManager {
    /** 列表（策略层 + 冻结清单状态）。 */
    list(input: {
        cwd?: string;
        sessionId?: string;
    }): Promise<PromptListResult>;
    /** 读取文件正文（只允许候选路径）。 */
    read(input: {
        path?: unknown;
        cwd?: unknown;
    }): Promise<PromptReadResult | PromptMutation>;
    /** 保存文件正文（原子写；仅候选路径，≤ 1 MiB）。 */
    save(input: {
        path?: unknown;
        content?: unknown;
        cwd?: unknown;
    }): Promise<PromptMutation>;
    /** 写全局可见性（整份替换该作用域）。 */
    setVisibility(input: {
        scope?: unknown;
        mode?: unknown;
        workspaces?: unknown;
    }): Promise<PromptMutation>;
    /** 写项目级默认（enabled=null 表示删除覆盖、回到全局默认）。 */
    setProjectDefault(input: {
        cwd?: unknown;
        projectRoot?: unknown;
        path?: unknown;
        enabled?: unknown;
    }): Promise<PromptMutation>;
    /** 写会话首屏显式选择（null/undefined = 清除，跟随默认层 = 全选）。 */
    setSessionSelection(input: {
        sessionId?: unknown;
        selected?: unknown;
        cwd?: unknown;
    }): Promise<PromptMutation>;
    /** 读会话冻结清单。 */
    manifest(input: {
        sessionId?: unknown;
    }): Promise<{
        ok: true;
        manifest?: PromptManifest;
    }>;
    /**
     * 计算一次选择（注入层用；可注入宿主 baselineIdentity 提供的配置）。
     *
     * @param options cwd / sessionId / 渲染配置（缺省用默认）
     * @returns 选择结果（allowed 集合 + 每项视图）
     */
    select(options: {
        cwd: string;
        sessionId?: string;
        config?: PromptRenderConfig;
    }): Promise<PromptSelection>;
    /**
     * 用宿主渲染器渲染允许集合（注入层用）。
     *
     * @param selection `select()` 的结果
     * @param options replacePreviousBaseline 透传
     * @returns 宿主渲染结果或 undefined（宿主管线不可用 / 无内容）
     */
    render(selection: PromptSelection, options?: {
        replacePreviousBaseline?: boolean;
    }): Promise<PromptRenderResult | undefined>;
    /** 写冻结清单（注入层首轮一次）。 */
    recordManifest(selection: PromptSelection, rendered: PromptRenderResult | undefined, sessionId: string): Promise<PromptManifest>;
    /** 宿主渲染管线是否可用（面板/首屏的降级提示）。 */
    hostAvailable(): Promise<boolean>;
}
/** 读取当前策略（供 host/inject 共用）。 */
export declare function readPolicy(dshHome?: string): Promise<{
    policy: PromptPolicyFile;
    errors: string[];
}>;
/**
 * 创建 Prompt 域服务。
 *
 * @param deps 依赖（ctx / host / home 覆盖）
 * @returns 服务实例
 */
export declare function createPromptManager(deps: PromptManagerDeps): PromptManager;
/** 数据文件路径（面板展示用）。 */
export declare function promptDataPaths(dshHome?: string): {
    policy: string;
    manifests: string;
};
