/**
 * 传输无关的 skills 域服务（挂载为 `ctx.capabilityPanel.skills`）。
 *
 * 读取直接走**受管磁盘视图**（项目 + 全局根目录，直接读盘以拿到
 * path/format/readOnly 等管理列表需要的信息；`.agents` 为写入目标根，
 * `.dsh` 为旧位置兼容根，`.claude` 为只读兼容根）。
 *
 * 写入一律经由 `crud.ts`，落在由 `roots.ts` 从工作区解析出来的具体根目录上。
 * 启停与调用方向只写 frontmatter 的扁平调用键（`disable-model-invocation` /
 * `user-invocable`）——宿主的目录注入 / `skill` 工具 / `/name` 注入三条
 * 链路都原生读这两个键（文件 watcher 使改动下一步即生效），本插件不维护
 * 任何平行的禁用状态。
 *
 * @module dsh-capability-settings/skills/manager
 */
import type { ReadResult } from "./crud.js";
import type { TransferFile, TransferResult } from "./transfer.js";
import type { SkillFormat, SkillSummaryView, WritableScope } from "./types.js";
import type { SkillRegistryBridge } from "./registry.js";
/** 服务的构造依赖（用于覆盖默认目录解析）。 */
export interface ManagerDeps {
    dshHome?: string;
    agentsHome?: string;
    /**
     * 宿主技能注册表桥（见 `skills/registry.ts`）：提供注入技能的详情/资源/
     * 导出 fallback，以及写操作对注入行的 `read-only` 拦截。缺省时行为与旧版
     * 完全一致（纯磁盘）。
     */
    registry?: SkillRegistryBridge;
}
/** 写操作失败（业务信封里的失败支；`code` 供客户端区分降级原因）。 */
export interface SkillWriteFailure {
    ok: false;
    errors: string[];
    code?: string;
}
/** 一个受管 skill 根及其来源分类（claude 系为只读兼容根）。 */
export interface ManagedRoot {
    source: "user-dsh" | "user-agents" | "project-dsh" | "project-agents" | "user-claude" | "project-claude";
    path: string;
}
/**
 * source 是否属于"全局系"（可用于按作用域归类列表）。
 * 分类清单的单一事实源在 shared/skill-sources.ts（与客户端共用）。
 */
export declare function isGlobalSource(source: SkillSummaryView["source"]): boolean;
/**
 * 构建 `ctx.capabilityPanel.skills` 服务。
 *
 * 读取直接走**受管磁盘视图**；宿主 registry 的注入条目由 `registry.ts` 桥
 * 在上层（`index.ts` 组装）合并进 `list` / `sessionList`，本模块只在
 * 详情/资源/导出与写操作入口使用它（避免磁盘写路径被注入条目污染）。
 *
 * @param ctx 宿主上下文
 * @param config dshHome / agentsHome 覆盖 + registry 桥
 */
export declare function createService(ctx: any, config?: ManagerDeps): {
    list: (cwd?: string) => Promise<SkillSummaryView[]>;
    /** 创建 skill（scope / target / cwd 未给时按 project + .agents 解析根）。 */
    create(input: {
        root?: string;
        scope?: WritableScope;
        target?: ".dsh" | ".agents";
        cwd?: string;
        sessionId?: string;
        format: SkillFormat;
        spec: unknown;
        body: string;
        overwrite?: boolean;
    }): Promise<import("./crud.js").CreateResult | SkillWriteFailure>;
    /** 更新 skill（scope 缺省按 global 解析根）。 */
    update(input: {
        root?: string;
        scope?: WritableScope;
        target?: ".dsh" | ".agents";
        cwd?: string;
        sessionId?: string;
        name: string;
        spec: unknown;
        body: string;
    }): Promise<import("./crud.js").CreateResult | SkillWriteFailure>;
    /** 删除 skill（scope 缺省按 global 解析根）。 */
    remove(input: {
        root?: string;
        scope?: WritableScope;
        target?: ".dsh" | ".agents";
        cwd?: string;
        sessionId?: string;
        name: string;
    }): Promise<{
        ok: boolean;
        errors?: string[];
    }>;
    /** 一键启用/禁用 skill（scope 缺省按 global 解析根）；只写 frontmatter 调用键，宿主原生生效。 */
    setEnabled(input: {
        root?: string;
        scope?: WritableScope;
        target?: ".dsh" | ".agents";
        cwd?: string;
        sessionId?: string;
        name: string;
        enabled: boolean;
    }): Promise<{
        ok: boolean;
        errors?: string[];
    }>;
    /** 细粒度调节调用方式：模型/用户两个方向分别启用或禁用（scope 缺省按 global 解析根）。 */
    setInvocation(input: {
        root?: string;
        scope?: WritableScope;
        target?: ".dsh" | ".agents";
        cwd?: string;
        sessionId?: string;
        name: string;
        modelInvocable: boolean;
        userInvocable: boolean;
    }): Promise<{
        ok: boolean;
        errors?: string[];
    }>;
    /** 读取 skill 详情（scope 缺省按 global 解析根；磁盘读不到时走 registry fallback）。 */
    read(input: {
        root?: string;
        scope?: WritableScope;
        target?: ".dsh" | ".agents";
        cwd?: string;
        sessionId?: string;
        name: string;
    }): Promise<ReadResult>;
    /**
     * 读取注入条目的资源文件（架构契约 §8.3 的路径边界：基准目录只来自宿主
     * registry，客户端只传 POSIX 相对路径；拒绝 `..` / 绝对路径 / 反斜杠 /
     * 符号链接 / realpath 逃逸，单文件上限 256 KiB）。
     */
    readResource(input: {
        name: string;
        path: string;
        cwd?: string;
        sessionId?: string;
    }): Promise<{
        ok: true;
        path: string;
        size: number;
        content: string;
        truncated: boolean;
    } | {
        ok: false;
        errors: string[];
        code?: import("./registry.js").SkillResourceErrorCode;
    } | {
        ok: false;
        errors: string[];
        code: string;
    }>;
    /**
     * 安装 skill：`sourcePath` 走宿主路径复制，`url` 走 HTTP 下载（GitHub
     * 仓库 / .zip / raw .md），`files` 走客户端上传落盘；三者都缺时报错。
     * scope 缺省按 global 解析根。
     */
    install(input: {
        root?: string;
        scope?: WritableScope;
        target?: ".dsh" | ".agents";
        cwd?: string;
        sessionId?: string;
        sourcePath?: string;
        url?: string;
        files?: TransferFile[];
        overwrite?: boolean;
    }): Promise<TransferResult>;
    /**
     * 把 skill 从全局导入到当前项目：**物理复制**到 `<项目>/.agents/skills`
     * （目录型连资源文件），此后在本项目内独立启停/调节调用方向（写项目
     * 副本的 frontmatter，全局配置不动；快照语义，不跟随全局更新）。
     * 目标根已有同名条目且未要求 overwrite 时返回 existed（overwrite 下
     * 先删后复制）；其它项目根（.dsh/.claude）有同名原生条目时报硬错误
     * ——复制过去也会被宿主按 rank 遮蔽，导入无意义。
     */
    importToProject(input: {
        cwd: string;
        name: string;
        fromRoot?: string;
        sessionId?: string;
        overwrite?: boolean;
    }): Promise<import("./crud.js").CloneResult | SkillWriteFailure | {
        ok: false;
        errors: string[];
        existed: boolean;
    }>;
    /**
     * 在本项目内禁用某个全局 skill（shadow stub，见 skills/shadow.ts）：
     * 在项目 `.agents/skills` 生成同名占位文件（frontmatter 双向禁用 +
     * metadata 标记），按宿主 rank 覆盖全局条目——catalog 注入、`skill`
     * 工具调用、`/name` 用户注入三条链路都被宿主原生拒绝；删除占位即恢复。
     * 项目 `.dsh` 有同名条目时报硬错误（占位不会生效）；项目 `.agents`
     * 已有同名真实条目时返回 existed（应直接禁用那个条目）。
     */
    disableInProject(input: {
        cwd?: string;
        name: string;
        fromRoot?: string;
    }): Promise<import("./shadow.js").ShadowResult | SkillWriteFailure>;
    /**
     * 恢复全局 skill 在本项目可用：删除 shadow stub（幂等）。同名条目不是
     * stub 时拒绝删除（可能是用户的真实项目技能）。
     */
    enableInProject(input: {
        cwd?: string;
        name: string;
    }): Promise<import("./shadow.js").ShadowResult>;
    /**
     * 导出 skill：给 `destDir` 复制到宿主目录；否则读成 base64 文件清单
     * 返回给客户端下载。scope 缺省按 global 解析根。
     *
     * 注入行（无磁盘文件）走 registry fallback：单文件正文快照
     * （`lossy: true`，资源不打包，架构契约 §8.4）。
     */
    export(input: {
        root?: string;
        scope?: WritableScope;
        target?: ".dsh" | ".agents";
        cwd?: string;
        sessionId?: string;
        name: string;
        destDir?: string;
        overwrite?: boolean;
    }): Promise<TransferResult>;
};
