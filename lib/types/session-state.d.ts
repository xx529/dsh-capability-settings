/**
 * 会话级能力开关的持久化存储（Skills / MCP）。
 *
 * 背景：插件的「当前对话」开关原本是纯内存态（`mcp/loader.ts` 的
 * `sessionToggles`、`skills/session.ts` 的 `explicit`），宿主重启 / agent 重建后
 * 即回到项目默认，用户看到的行为与重启前不一致。本模块把**显式会话覆盖**
 * 落盘，让同一会话在重启 / resume 后恢复原状。
 *
 * 存储契约：
 *
 *   - 文件：`<dshHome>/dsh-capability-settings/session-capabilities.json`
 *     （与 `jev.json` 同目录；目录 0700、文件 0600）；
 *   - 写入复用 `shared/atomic-write.ts` + `shared/file-lock.ts`（禁止裸写）；
 *   - 读：文件缺失 / 空 / JSON 损坏 / version 不认识 → 空表 + `warn`，
 *     不阻断 MCP 挂载与会话开关（等价于"没有显式覆盖"，跟随项目默认）；
 *   - 写：内存镜像权威，串行队列 + 文件锁内"读盘合并（保留其它实例写入的
 *     会话）→ 原子写"；写失败只 `warn`，**本次运行内仍生效**；
 *   - **不存密钥、不存会话内容**：只有 sessionId、三个域的开关键、诊断用
 *     cwd / headerCreatedAt。
 *
 * 三个域共用同一记录（`skills` / `mcp` / `tools`），互不影响；`tools` 域为
 * v13 additive 新增（键 `plugin:<unit>`，`version` 仍为 1，旧版读忽略该字段）。
 *
 * 记录形状（`version: 1`）：
 *
 * ```jsonc
 * {
 *   "version": 1,
 *   "sessions": {
 *     "<sessionId>": {
 *       "updatedAt": 1761328800000,
 *       "headerCreatedAt": 1761000000000,
 *       "cwd": "/path/to/project",
 *       "skills": { "figma-workbench": false },
 *       "mcp": { "project:github": false, "server:figma": true },
 *       // v13 additive（version 不变）：插件级 Tools 开关，键 = 开关单元 id
 *       "tools": { "plugin:dsh-univer-office": false, "plugin:__unattributed__": false },
 *       "missingSince": 1761328800000
 *     }
 *   }
 * }
 * ```
 *
 * `headerCreatedAt` 用于防 sessionId 复用（不一致 ⇒ 丢弃旧记录）；
 * `missingSince` 是两阶段对账的"疑似已删除"标记，见 {@link SessionStateStore.reconcile}。
 *
 * @module dsh-capability-settings/session-state
 */
/** 当前数据文件版本；版本不认识时整份忽略（不猜测迁移）。 */
export declare const SESSION_STATE_VERSION = 1;
/** 插件在 dsh home 下的目录名（与包名一致，和 `jev.json` 共用）。 */
export declare const SESSION_STATE_DIR_NAME = "dsh-capability-settings";
/** 数据文件名。 */
export declare const SESSION_STATE_FILE_NAME = "session-capabilities.json";
/** 疑似已删除会话的默认宽限期（两阶段对账；24 小时）。 */
export declare const SESSION_STATE_GRACE_MS: number;
/** 配置目录：`<dshHome>/dsh-capability-settings`。 */
export declare function sessionStateDir(dshHome?: string): string;
/** 数据文件：`<dshHome>/dsh-capability-settings/session-capabilities.json`。 */
export declare function sessionStateFile(dshHome?: string): string;
/** 写记录时一并保存的会话元数据（防 id 复用 / 诊断）。 */
export interface SessionStateMeta {
    /** 会话工作目录（仅诊断，不参与匹配）。 */
    cwd?: string;
    /** 会话 header 的创建时间（与记录不一致 ⇒ 视为新会话，丢弃旧记录）。 */
    headerCreatedAt?: number;
}
/** 一个会话的记录。 */
export interface SessionStateEntry {
    /** 最后一次写入时间（毫秒）。 */
    updatedAt: number;
    /** 会话 header 创建时间（防 sessionId 复用）。 */
    headerCreatedAt?: number;
    /** 会话工作目录（仅诊断）。 */
    cwd?: string;
    /** Skills 显式开关（名字 → 是否启用；只存显式覆盖）。 */
    skills?: Record<string, boolean>;
    /** MCP 显式开关（`project:<key>` / `server:<serverName>` → 是否启用）。 */
    mcp?: Record<string, boolean>;
    /**
     * Tools 显式开关（`plugin:<unit>` → 是否启用；`plugin:__unattributed__` =
     * 「来源未识别」单元）。
     *
     * v13 additive：`version` 仍为 1；旧版插件读本文件时忽略该字段（降级 =
     * 回到默认全开，见 CHANGELOG）。键只存**单元 id**，不存工具名——插件升级
     * 增减工具后 deny 名单自动跟随（见 `tools/manager.ts`）。
     */
    tools?: Record<string, boolean>;
    /** 两阶段对账的"首次发现不存在"时间戳；确认存在后清除。 */
    missingSince?: number;
}
/** 数据文件完整形状。 */
export interface SessionStateSnapshot {
    version: number;
    sessions: Record<string, SessionStateEntry>;
}
/** 结构化 logger 子集（与插件其它模块一致，缺省静默）。 */
export interface SessionStateLogger {
    warn?: (message: string) => void;
    info?: (message: string) => void;
}
/** 对账输入：由调度层（`session-state-reconcile.ts`）提供外部的存在性判断。 */
export interface SessionStateReconcileInput {
    /** 当前 live（有 agent/session 对象）的会话 id。 */
    liveIds: ReadonlySet<string>;
    /** 持久化快照探测：true = 存在；false = 确认不存在；undefined = 无法判断（保留）。 */
    persisted: (sessionId: string) => Promise<boolean | undefined>;
    /** `allowDelete=false` 时只标记 `missingSince`，绝不删除（关机 / disposed 触发时用）。 */
    allowDelete: boolean;
    /** 当前时间（测试注入）；缺省 `Date.now()`。 */
    now?: number;
    /** 宽限期（测试注入）；缺省 {@link SESSION_STATE_GRACE_MS}。 */
    graceMs?: number;
}
/** 对账结果（诊断 / 测试用）。 */
export interface SessionStateReconcileResult {
    /** 本轮检查的记录数。 */
    checked: number;
    /** 本轮确认"不存在"的会话（含未到宽限期、仅标记的）。 */
    missing: string[];
    /** 本轮真正删除的会话。 */
    removed: string[];
    /** 本轮判定存在的会话。 */
    retained: string[];
}
/** 构造参数。 */
export interface SessionStateDeps {
    /** dsh home 覆盖（缺省 `resolveDshHome()`）。 */
    dshHome?: string;
    /** 日志（缺省静默）。 */
    logger?: SessionStateLogger;
    /** 时间源覆盖（测试用）。 */
    now?: () => number;
}
/** 会话级开关存储（挂到宿主侧；两个域共用同一实例）。 */
export interface SessionStateStore {
    /** 数据文件绝对路径（诊断 / 测试）。 */
    readonly filePath: string;
    /** 懒加载磁盘快照（幂等；读取失败降级为空表，不抛）。 */
    ready(): Promise<void>;
    /** 某会话的 Skills 显式开关（同步；调用方需先 `await ready()`）。 */
    skills(sessionId: string): Readonly<Record<string, boolean>>;
    /** 某会话的 MCP 显式开关（同步；调用方需先 `await ready()`）。 */
    mcp(sessionId: string): Readonly<Record<string, boolean>>;
    /** 某会话的 Tools 显式开关（同步；调用方先 `await ready()`）。 */
    tools(sessionId: string): Readonly<Record<string, boolean>>;
    /**
     * 校验记录是否仍属于"当前这个会话"。
     *
     * `headerCreatedAt` 不一致（sessionId 复用）⇒ 丢弃旧记录并返回 false；
     * 无记录也返回 false（调用方按"无显式覆盖"处理）。
     */
    verifySession(sessionId: string, meta?: SessionStateMeta): boolean;
    /** 写 / 清除一个 Skills 显式开关（`enabled === undefined` = 清除）。 */
    setSkill(sessionId: string, name: string, enabled: boolean | undefined, meta?: SessionStateMeta): Promise<void>;
    /** 写 / 清除一个 MCP 显式开关（`enabled === undefined` = 清除）。 */
    setMcp(sessionId: string, toggleKey: string, enabled: boolean | undefined, meta?: SessionStateMeta): Promise<void>;
    /** 写 / 清除一个 Tools 显式开关（`enabled === undefined` = 清除覆盖）。 */
    setTool(sessionId: string, unitKey: string, enabled: boolean | undefined, meta?: SessionStateMeta): Promise<void>;
    /**
     * 批量写 / 清除同一域的多个键（**一次落盘**）。
     *
     * 供 R1 批量端点与 MCP 批量写使用：`entries` 里的 `undefined` = 清除该键，
     * **空表 = 不改任何键**（不是"清空全部"）。批量 QPS 下避免逐条
     * "读盘-合并-原子写"。
     */
    setToggles(sessionId: string, domain: "skills" | "mcp" | "tools", entries: Readonly<Record<string, boolean | undefined>>, meta?: SessionStateMeta): Promise<void>;
    /** 删除某会话的全部记录（对账确认删除 / 显式清理时用）。 */
    forget(sessionId: string): Promise<void>;
    /** 两阶段对账：见 {@link SessionStateReconcileInput}。 */
    reconcile(input: SessionStateReconcileInput): Promise<SessionStateReconcileResult>;
    /** 当前内存镜像（只读副本；诊断 / 测试）。 */
    entries(): Readonly<Record<string, SessionStateEntry>>;
    /** 卸载：停止后续写入（进行中的写盘不会被打断）。 */
    dispose(): void;
}
/**
 * 构造会话级开关存储。
 *
 * 单实例语义：MCP loader 与 Skills 会话注册表必须共用**同一个** store
 * （组合根注入），否则两个域各自"读盘-改-写"会互相覆盖。
 *
 * @param deps dsh home / 日志 / 时间源
 */
export declare function createSessionState(deps?: SessionStateDeps): SessionStateStore;
