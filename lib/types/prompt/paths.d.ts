/**
 * Prompt 域的路径解析：**按宿主 `@deepseek-ai/dsh-agent-instructions` 的语义**
 *（不是本插件其它域的「项目根 = 工作区目录本身」语义）。
 *
 * 关键差异（实现时不要换成 `shared/project-root.ts`）：
 *
 *   - 项目根从会话 cwd **向上找第一个含 `.git` 的目录**，找不到才回落 cwd；
 *   - 指令链 = 项目根 → cwd 的**每一级目录**（含端点）；
 *   - 全局根只有两处：`$DSH_HOME/AGENTS.md`（默认 `~/.dsh`）与
 *     `$DSH_AGENTS_HOME/AGENTS.md`（默认 `~/.agents`）；不做 `~/.claude` 兼容。
 *
 * @module dsh-capability-settings/prompt/paths
 */
/** 宿主默认的项目根标记。 */
export declare const PROMPT_ROOT_MARKERS: readonly [".git"];
/** 每层目录的基础候选（顺序即宿主顺序）。 */
export declare const PROMPT_BASE_CANDIDATES: readonly ["AGENTS.md", "CLAUDE.md"];
/** 每层目录的本地覆盖候选（在基础候选之后）。 */
export declare const PROMPT_LOCAL_CANDIDATES: readonly ["AGENTS.local.md", "CLAUDE.local.md"];
/** 所有候选文件名（用于虚拟 fs 的「未启用即不可见」判断）。 */
export declare const PROMPT_ALL_CANDIDATES: readonly string[];
/** 全局指令文件名（宿主固定为 AGENTS.md，与候选配置无关）。 */
export declare const PROMPT_GLOBAL_FILE: "AGENTS.md";
/** 插件数据目录名（与包名一致）。 */
export declare const PROMPT_DATA_DIR_NAME: "dsh-capability-settings";
/** 策略文件名。 */
export declare const PROMPT_POLICY_FILE_NAME: "prompt-policy.json";
/** 冻结清单文件名。 */
export declare const PROMPT_MANIFESTS_FILE_NAME: "prompt-manifests.json";
/** 解析后的宿主 home 对（绝对路径 + 模型可见显示形式）。 */
export interface PromptHomes {
    dshHome: string;
    dshHomeDisplay: string;
    agentsHome: string;
    agentsHomeDisplay: string;
}
/**
 * 解析宿主语义的 dsh home / agents home。
 *
 * @param dshHomeOverride 显式覆盖（测试用；manager 不传）
 * @param agentsHomeOverride 显式覆盖（测试用；manager 不传）
 * @returns 绝对路径 + 显示形式
 */
export declare function resolvePromptHomes(dshHomeOverride?: string, agentsHomeOverride?: string): PromptHomes;
/**
 * 从 cwd 向上找第一个含项目根标记的目录（宿主 `findProjectRoot` 同语义）。
 *
 * @param cwd 会话工作目录（绝对路径）
 * @param markers 标记名（缺省 `.git`）
 * @returns 项目根绝对路径；找不到回落 cwd
 * @throws 标记探测遇到 EACCES 等非「不存在」错误时抛出（与宿主一致，不猜祖先）
 */
export declare function findInstructionProjectRoot(cwd: string, markers?: readonly string[]): Promise<string>;
/**
 * 构造「项目根 → cwd」的目录链（从宽泛到具体，含两端）。
 *
 * @param root 项目根绝对路径
 * @param cwd 会话工作目录绝对路径
 * @returns 目录绝对路径列表
 */
export declare function instructionDirectoryChain(root: string, cwd: string): string[];
/** 一个待发现的指令候选（尚未读取内容）。 */
export interface PromptCandidate {
    id: string;
    path: string;
    displayPath: string;
    directory: string;
    name: string;
    scope: "user-global" | "agents-global" | "project";
    kind: "base" | "local";
}
/** 宿主渲染配置（来自 baselineIdentity 或默认值）。 */
export interface PromptRenderConfig {
    projectRoot: string;
    projectRootMarkers: string[];
    instructionFileCandidates: string[];
    localInstructionFileCandidates: string[];
    maxBytes: number;
    maxSourceBytes: number;
}
/** 宿主默认渲染配置（当拿不到 baselineIdentity 时退化使用）。 */
export declare function defaultRenderConfig(projectRoot: string): PromptRenderConfig;
/**
 * 全局根的候选（两处固定文件，仅当文件存在时进入列表）。
 *
 * @param homes 宿主语义 home
 * @returns 候选列表（顺序：dsh home → agents home）
 */
export declare function globalPromptCandidates(homes: PromptHomes): PromptCandidate[];
/** 把绝对路径转成模型可见路径（全局根 → `~/.dsh` / `$DSH_HOME`；项目内 → 项目根相对）。 */
export declare function promptDisplayPath(path: string, projectRoot: string, homes: PromptHomes): string;
/**
 * 项目链上的候选（项目根 → cwd 每层 × 基础候选 + 本地覆盖）。
 *
 * @param projectRoot 项目根绝对路径
 * @param cwd 会话 cwd 绝对路径
 * @param config 渲染配置（候选名可被宿主配置覆盖）
 * @param homes 宿主 home（用于 displayPath）
 * @returns 候选列表（宽泛 → 具体）
 */
export declare function projectPromptCandidates(projectRoot: string, cwd: string, config: Pick<PromptRenderConfig, "instructionFileCandidates" | "localInstructionFileCandidates">, homes: PromptHomes): PromptCandidate[];
/** 数据文件绝对路径。 */
export declare function promptDataFile(fileName: string, dshHome?: string): string;
