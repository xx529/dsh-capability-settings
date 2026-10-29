/**
 * R1 批量端点 `session.setBulk`：三域（Skills / MCP / Tools）一次开 / 关 / 恢复默认。
 *
 * 方案：`docs/architecture/v13-implementation.md` §6（唯一权威）。
 *
 * 契约要点（不得偏离）：
 *
 *   - 传输层信封恒 `{ok:true,value}`（`remote.ts` 文件头）；本模块的**业务失败**
 *     也返回 `{ok:false, errors}` 放在 value 里，绝不抛到通道层。
 *   - **幂等**：同一 `action` 重放 → `applied:0` + `unchanged:N`（不重复写盘）。
 *   - **按会话串行**：同 session 的批量请求排队（重复调用排队而非拒绝）；
 *     不同 session 互不影响。
 *   - **部分失败不回滚**（A7）：某条失败只进 `failed[]`，已成功的保留；
 *     重试 = 重放同一 action（已成功项进 `unchanged`）。
 *   - **宿主自己枚举**：客户端不传目标列表（避免与宿主枚举口径漂移）。
 *   - 写盘批量化：mcp / tools 一次落盘（`state.setToggles` / loader 批量方法），
 *     skills 保持逐条（shadow 注册本来就必须逐条）；restrict 只重算一次。
 *
 * @module dsh-capability-settings/session-bulk
 */
import type { McpLoader } from "./mcp/loader.js";
import type { McpListResult, McpRuntimeView } from "./mcp/types.js";
import type { SessionStateStore } from "./session-state.js";
import type { SessionSkillOpResult, SessionSkillView } from "./skills/session.js";
import type { ToolsListView, ToolsSetSessionResult } from "./tools/types.js";
/** 三域的域名（顺序固定 `skills → mcp → tools`）。 */
export type SessionBulkDomain = "skills" | "mcp" | "tools";
/** 目标态：enable=全部打开；disable=全部关闭；reset=清除显式会话覆盖（回默认）。 */
export type SessionBulkAction = "enable" | "disable" | "reset";
/** 逐项失败（不阻断其它项）。 */
export interface SessionBulkFailure {
    domain: SessionBulkDomain;
    /** skills = skill 名；mcp = target（项目 key / serverName）；tools = unit id。 */
    target: string;
    /** 细分种类，便于 UI 只重试某类。 */
    kind: "skill" | "mcp-project" | "mcp-server" | "plugin";
    error: string;
}
/** 单域统计。 */
export interface SessionBulkDomainStat {
    changed: number;
    unchanged: number;
    skipped: number;
    failed: number;
}
/** `session.setBulk` 入参（缺省 = 三域全部）。 */
export interface SessionBulkInput {
    /** 必填；空 → 业务失败。 */
    sessionId: string;
    action: SessionBulkAction;
    /** 缺省 = 三域全部；客户端按域串行调用以取得粗粒度进度。 */
    domains?: SessionBulkDomain[];
    /** 项目作用域（skills 列表 / mcp 项目条目需要）；缺省由宿主从 session header.cwd 解析。 */
    cwd?: string;
    /** 仅测试/诊断：只计算不写入，返回将改变的数量。 */
    dryRun?: boolean;
}
/** `session.setBulk` 成功 value。 */
export interface SessionBulkResult {
    ok: true;
    action: SessionBulkAction;
    /** 状态实际改变数（dryRun 时为「将要改变」数）。 */
    applied: number;
    /** 已是目标态、无需写入。 */
    unchanged: number;
    /** 不可参与（locked / 非 live 的 skills / 无 deny 名单的插件）。 */
    skipped: number;
    /** 逐项失败（不阻断其它项）。 */
    failed: SessionBulkFailure[];
    byDomain: Record<SessionBulkDomain, SessionBulkDomainStat>;
    /** 非 live 会话里仍有只落盘写入的域（mcp/tools）时的提示位。 */
    coldSession?: boolean;
    elapsedMs: number;
}
/** 业务失败支（放在传输层 `{ok:true, value}` 里）。 */
export interface SessionBulkFailureResult {
    ok: false;
    errors: string[];
}
/** 批量端点依赖的三域服务（结构子集，避免与组合根循环 import）。 */
export interface SessionBulkServices {
    skills: {
        sessionList(cwd?: string, sessionId?: string): Promise<SessionSkillView[]>;
        setSessionEnabled(input: {
            sessionId: string;
            name: string;
            enabled?: boolean;
        }): Promise<SessionSkillOpResult>;
    };
    mcp: {
        list(cwd?: string, sessionId?: string): Promise<McpListResult>;
        runtime(input: {
            cwd?: string;
            sessionId?: string;
        }): Promise<McpRuntimeView>;
        setSessionEnabled(input: {
            sessionId: string;
            cwd?: string;
            target: string;
            kind: "project" | "server";
            enabled: boolean | undefined;
        }): Promise<{
            ok: true;
        } | {
            ok: false;
            errors: string[];
        }>;
    };
    tools: {
        list(input: {
            sessionId?: string;
        }): Promise<ToolsListView>;
        setSessionEnabled(input: {
            sessionId: string;
            units: string[];
            enabled: boolean | undefined;
        }): Promise<ToolsSetSessionResult>;
    };
}
/** 构造依赖。 */
export interface SessionBulkDeps {
    /** 宿主上下文（只用到 `get("agents")`）。 */
    ctx: any;
    /** 会话级开关存储（批量落盘 + `entries()` 读显式名单）。 */
    state?: SessionStateStore;
    /** MCP loader（批量写 + 显式开关快照）。 */
    loader: McpLoader;
    /** 三域服务（延迟求值，避免与组合根构造顺序耦合）。 */
    service: () => SessionBulkServices | undefined;
    logger?: {
        warn?(message: string): void;
    };
    /** 时钟注入（测试用；缺省 `Date.now`）。 */
    now?: () => number;
}
/** 批量端点（挂到 `ctx.capabilityPanel.session`）。 */
export interface SessionBulk {
    setBulk(input: unknown): Promise<SessionBulkResult | SessionBulkFailureResult>;
}
/** 构造批量端点实现（组合根单例）。 */
export declare function createSessionBulk(deps: SessionBulkDeps): SessionBulk;
