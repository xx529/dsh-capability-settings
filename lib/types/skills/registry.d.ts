/**
 * 宿主技能注册表桥（registry bridge）。
 *
 * 面板的磁盘视图（`skills/manager.ts`）只覆盖本插件受管的 6 个根目录；
 * 宿主 `ctx.get("skills")`（`@deepseek-ai/dsh-skill` 的 `SkillRegistry`）里还有
 * 三类「注入条目」，模型实际能看到、面板却看不见：
 *
 *   - **DSH 随包 / 部署级 provider**（如 `dsh-skill-office`、`dsh-to-figma`）；
 *   - **插件运行时注册**（`ctx.skills.register(...)`，provider 缺省 `runtime`）；
 *   - **preset 层 provider**（preset 组合里挂的 `dsh-skill-filesystem`，只有带
 *     `scope: agent` 的读才看得见）。
 *
 * 本模块负责把这些条目 **additive 合并**进面板视图，并给出展示用的来源分类
 * （`origin` / `channel` / `provider`），同时承担三个派生能力：
 *
 *   1. 详情 fallback：磁盘读不到时用 `ctx.skills.get(name, {cwd, scope})` 取正文；
 *   2. 资源读取边界：只允许 `resourceBase.kind === "directory"` 且路径被限制在
 *      该目录内（拒绝 `..`、绝对路径、反斜杠、符号链接、realpath 逃逸）；
 *   3. 导出快照：注入技能导出为单文件正文快照（不打包资源）。
 *
 * 硬约束（`AGENTS.md`「MCP 关键模型」第 2 条）：
 *   - **只用 `ctx.get("skills")` 运行时对象**，不 import 插件自带的
 *     `@deepseek-ai/dsh-scope`（其 `kScope` 不是 `Symbol.for`，读不到宿主 scope）；
 *   - scope **直接把 agent 对象原样传进去**（`{ scope: agent }`），不自己构造
 *     scope key。
 *
 * 降级：registry 缺失 / `snapshot` 抛错 / `snapshot.complete === false` 时一律
 * 返回空注入行（面板仍完整显示磁盘技能），并在 `skills/change` 后重建缓存。
 *
 * @module dsh-capability-settings/skills/registry
 */
import type { RegistryResourceBaseKind, SkillFormat, SkillOrigin, SkillSpec, SkillSummaryView } from "./types.js";
import type { TransferResult } from "./transfer.js";
/** shadow skill 的描述（仅出现在注册表内部，用户看不到正文）。 */
export declare const SHADOW_DESCRIPTION = "\u672C\u4F1A\u8BDD\u5DF2\u7981\u7528\uFF08capability-panel\uFF09";
/** shadow 注册附带的 metadata 标记键（便于 `ctx.skills.get` 侧二次确认）。 */
export declare const SHADOW_METADATA_KEY = "capability-panel/shadow";
/** 判断一个 registry 摘要条目是否是**本插件自己**注册的 shadow。 */
export declare function isOwnShadow(entry: {
    provider?: string;
    description?: string;
} | undefined): boolean;
/** registry 摘要条目（`SkillSummary` 的结构子集）。 */
export interface HostSkillSummary {
    readonly name: string;
    readonly description: string;
    readonly whenToUse?: string;
    readonly invocation?: {
        readonly modelInvocable: boolean;
        readonly userInvocable: boolean;
    };
    readonly source?: string;
    readonly provider?: string;
    readonly path?: string;
    readonly resourceBase?: {
        readonly kind: "directory";
        readonly path: string;
    } | {
        readonly kind: "url";
        readonly url: string;
    } | {
        readonly kind: "opaque";
        readonly description: string;
    };
}
/** 完整定义（`SkillDefinition` 的结构子集：带正文）。 */
export interface HostSkillDefinition extends HostSkillSummary {
    readonly content: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
/** 目录快照（`SkillCatalogSnapshot` 的结构子集）。 */
export interface HostSkillCatalogSnapshot {
    readonly skills: HostSkillSummary[];
    readonly complete?: boolean;
}
/** 读选项：`scope` 只接受 agent 对象原样传入（C2）。 */
export interface HostSkillViewOptions {
    cwd?: string;
    scope?: unknown;
}
/** 本模块用到的宿主 skills 服务子集。 */
export interface HostSkillsService {
    list?(options?: HostSkillViewOptions): Promise<HostSkillSummary[]>;
    snapshot?(options?: HostSkillViewOptions): Promise<HostSkillCatalogSnapshot>;
    get?(name: string, options?: HostSkillViewOptions): Promise<HostSkillDefinition | undefined>;
}
/** 分类后的注入行（合并与详情 fallback 共用）。 */
export interface ClassifiedInjectedRow {
    name: string;
    description: string;
    whenToUse?: string;
    invocation: {
        modelInvocable: boolean;
        userInvocable: boolean;
    };
    origin: SkillOrigin;
    channel: string;
    provider: string;
    registrySource: string;
    resourceBaseKind?: RegistryResourceBaseKind;
    path?: string;
}
/** 合并入参（磁盘行用于同名去重，projectDisabled 用于 disabledInProject）。 */
export interface InjectedMergeInput {
    cwd?: string;
    sessionId?: string;
    /** 磁盘视图行（manager.list 结果）；同名时磁盘优先。 */
    diskRows: SkillSummaryView[];
    /** 项目默认禁用名单（overrides.skills）。 */
    projectDisabled: ReadonlySet<string>;
}
/** 详情 fallback 的结果（与 crud.ReadResult 兼容的超集）。 */
export interface RegistryReadResult {
    ok: true;
    spec: SkillSpec;
    body: string;
    format: SkillFormat;
    resources: string[];
    fromRegistry?: true;
    resourceBaseNote?: string;
    path?: string;
}
/** 资源读取错误码（架构契约 §7.3）。 */
export type SkillResourceErrorCode = "not-found" | "escape" | "not-text" | "too-large" | "unsupported-base" | "registry-unavailable" | "requires-session" | "read-only";
/** `skills.readResource` 的结果。 */
export type SkillResourceResult = {
    ok: true;
    path: string;
    size: number;
    content: string;
    truncated: boolean;
} | {
    ok: false;
    errors: string[];
    code?: SkillResourceErrorCode;
};
/** 名字在当前 registry 视图里的性质（写拦截用）。 */
export interface RegistryNameVerdict {
    kind: "injected" | "disk-root" | "shadow";
    row?: ClassifiedInjectedRow;
}
/** 注册表桥的构造依赖。 */
export interface SkillRegistryBridgeDeps {
    /** 插件 ctx（只读；用 `ctx.get("skills")` 取宿主服务）。 */
    ctx: any;
    logger?: {
        warn?: (message: string) => void;
    };
    /** 取某 session 的 live agent（scope 传参 + preset 归属解析用）。 */
    agentOf?: (sessionId: string) => any | undefined;
    /** 某个名字是否正被本插件的会话 shadow 遮蔽（清缓存时保留展示元数据）。 */
    isShadowed?: (sessionId: string, name: string) => boolean;
    /** 宿主服务访问器覆盖（测试/诊断用；缺省 `ctx.get("skills")`）。 */
    skillsService?: () => HostSkillsService | undefined;
}
/** 合并 / 详情 / 资源 / 导出 的公共入口。 */
export interface SkillRegistryBridge {
    /** 合并注入行（只返回注入行；磁盘行由调用方拼在其前面）。 */
    merge(input: InjectedMergeInput): Promise<SkillSummaryView[]>;
    /** 当前 scope 视图里属于注入条目的名字集合（项目默认只作用于这些名字）。 */
    injectedNames(agent: unknown, sessionId: string | undefined, cwd?: string): Promise<Set<string> | undefined>;
    /** 名字在当前视图里的性质（写拦截用；registry 不可用返回 undefined）。 */
    inspectName(name: string, options: {
        cwd?: string;
        sessionId?: string;
    }): Promise<RegistryNameVerdict | undefined>;
    /** 详情 fallback（磁盘读不到时调用）。 */
    readDetail(input: {
        name: string;
        cwd?: string;
        sessionId?: string;
    }): Promise<RegistryReadResult | undefined>;
    /** 完整定义（资源读取 / 导出用；registry 不可用或名字不存在返回 undefined）。 */
    getDefinition(input: {
        name: string;
        cwd?: string;
        sessionId?: string;
    }): Promise<HostSkillDefinition | undefined>;
    /** 资源读取（路径边界见模块头注释）。 */
    readResource(input: {
        name: string;
        path: string;
        cwd?: string;
        sessionId?: string;
    }): Promise<SkillResourceResult>;
    /** 注入行导出：单文件正文快照（`lossy: true`）。 */
    exportSnapshot(input: {
        name: string;
        cwd?: string;
        sessionId?: string;
    }): Promise<TransferResult | undefined>;
    /** read-before-shadow：读一次 scope 快照并缓存注入元数据，返回该名字的分类。 */
    prepareShadow(agent: unknown, sessionId: string | undefined, cwd: string | undefined, name: string): Promise<ClassifiedInjectedRow | undefined>;
    /** read-after-shadow：确认该名字当前胜者就是本插件的 shadow；无法判定返回 undefined。 */
    verifyShadow(agent: unknown, sessionId: string | undefined, cwd: string | undefined, name: string): Promise<boolean | undefined>;
    /** 把「正被本插件 shadow 遮蔽」的元数据写回缓存（register 触发的 skills/change 会清掉它）。 */
    keepShadowed(agent: unknown, sessionId: string | undefined, row: ClassifiedInjectedRow): void;
    /** 该名字是否已知为注入条目（用于项目默认的热更新判定）。 */
    knowsInjected(sessionId: string, name: string): boolean;
    /** 清空某个 session 的缓存（agent 销毁 / 插件卸载）。 */
    invalidateSession(sessionId: string): void;
    /** 卸载：移除监听并清空缓存。 */
    dispose(): void;
}
/** 构造注册表桥。 */
export declare function createSkillRegistryBridge(deps: SkillRegistryBridgeDeps): SkillRegistryBridge;
