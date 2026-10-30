/**
 * Tools 域（插件级开关）的契约类型。
 *
 * 方案：`docs/architecture/v13-implementation.md` §5.1（唯一权威）。
 * 与客户端类型镜像同名字段、同义（客户端镜像在 `src/client/api.ts`，本文件是
 * 宿主侧**唯一**定义处；客户端不得反向 import 宿主模块）。
 *
 * 域边界（方案 §2.1，互斥）：`mcp__*` 恒归 MCP 域，宿主内建工具不入任何域，
 * Tools 只收「插件直接注册的非 mcp 工具」，一个插件 = 一个开关单元；识别不到
 * 来源的合并成唯一单元 `__unattributed__`（A4：可开关、计入分母、不进 Jev 候选）。
 *
 * @module dsh-capability-settings/tools/types
 */
/** 未识别来源单元 id（固定常量；`__` 前缀避免与插件展示名冲突）。 */
export declare const UNATTRIBUTED_UNIT = "__unattributed__";
/** 未识别来源单元的展示名（卡片标题 / 详情标题）。 */
export declare const UNATTRIBUTED_DISPLAY = "\u6765\u6E90\u672A\u8BC6\u522B";
/** 持久化键前缀：`plugin:<unit>`（本批唯一使用的前缀）。 */
export declare const PLUGIN_UNIT_KEY_PREFIX = "plugin:";
/** 开关单元 id → 持久化键（`plugin:<unit>`）。 */
export declare function unitKeyOf(unit: string): string;
/**
 * 持久化键 → 开关单元 id。
 *
 * 只认 `plugin:` 前缀；`tool:` 是未来 per-tool 覆盖的预留前缀，本批读端忽略
 * （返回 undefined），避免旧版把新键当真。
 */
export declare function unitOfKey(key: string): string | undefined;
/** 该单元的工具（`restrict` 用 `name`；UI 只读展示 `name` + 截断后的说明）。 */
export interface HostToolBrief {
    /** 完整工具名（restrict 用这个名字；UI 只读展示）。 */
    name: string;
    /** 一句话说明（截断到 200 码点，与 Jev 的 DESCRIPTION_LIMIT 同口径）。 */
    description?: string;
}
/** 一个插件单元在视图里的样子（卡片 / 面板行共用）。 */
export interface ToolsUnitView {
    /** 开关单元 id（持久化键 = `plugin:<unit>`；未识别 = `"__unattributed__"`）。 */
    unit: string;
    /** 展示名（卡片标题 / 详情标题）。 */
    name: string;
    /**
     * 插件用途描述（additive）。
     *
     * 来源 = 插件包根 `package.json` 的 `description`（attribution 扫描时读取）；
     * 读不到（扫描超时/非 npm 包）时缺省。Jev 能力决策用它替代旧的
     * 「N 个工具 · 插件注入」占位描述。
     */
    description?: string;
    /** plugin = 已识别插件；unattributed = 来源未识别。 */
    kind: "plugin" | "unattributed";
    /** 该单元当前可见的全部工具。 */
    tools: HostToolBrief[];
    /** 工具数（卡片描述与 Jev toolCount 用）。 */
    toolCount: number;
    /**
     * 归属判定（详情「来源判定」文案）。
     *
     * additive：`matchedBy` 扩为自动发现层；旧值 `prefix` / `exact` / `source`
     * 继续被识别（人工表 T4 仍发旧值，保证旧客户端文案不变）。
     */
    attribution: {
        matchedBy: "runtime" | "literal" | "namespace" | "table" | "similarity" | "prefix" | "exact" | "source" | "unknown";
        /** 命中的模式原文（未识别缺省）。 */
        pattern?: string;
        /** 包名（已识别才有；= 规范 unit id）。 */
        packageName?: string;
        /** 置信度（`similarity` 记为 medium，UI 应标「推测」）。 */
        confidence?: "high" | "medium" | "low";
        /** 诊断：自动归属结果与人工表（T4）不一致。 */
        conflictsWithTable?: boolean;
        /** 诊断：多候选/相似度 margin 不足。 */
        ambiguous?: boolean;
        /** 诊断：该单元内工具归属依据不一致（运行时 + 扫描/推测混排）。 */
        mixed?: boolean;
        /** 旧 unit id（迁移诊断；`plugin:<legacy>` 可回滚）。 */
        legacyUnit?: string;
    };
    /**
     * 全局默认（能力面板开关）：true = 全局启用（默认）、false = 全局默认关闭。
     *
     * additive（v13 修复）：`effective = 会话覆盖 ?? defaultEnabled`；会话首屏
     * 覆盖不影响该字段（它只反映 `tools-global.json` 的全局态）。
     */
    defaultEnabled: boolean;
    /**
     * 本会话**生效值** = 会话覆盖 ?? 全局默认（additive；推荐客户端用这个）。
     *
     * 等价于旧字段 {@link enabledInSession}；两者恒相等（保留旧字段仅为兼容）。
     */
    enabled: boolean;
    /**
     * 本会话生效开关（**legacy 别名**，恒等于 `enabled`）。
     *
     * v13 修复前它是唯一开关字段；为避免旧客户端/Jev 读不到值，继续下发同值，
     * 文档口径以 `enabled` 为准。
     */
    enabledInSession: boolean;
    /**
     * 本会话是否有**显式覆盖**（additive，供 UI 解释「全局关但本会话仍开」）。
     *
     * - `true` = `session-capabilities.json` 的 `tools` 域里存在该单元的键
     *   （`plugin:<unit>`，值为 `true` 或 `false` 都算显式覆盖）；
     * - `false` = 没有覆盖，`enabled` 完全由全局默认决定；
     * - 未传 `sessionId`（主面板）时恒为 `false`（没有"本会话"可谈）。
     *
     * 「恢复默认」仅在 `explicit === true` 时可点（清除覆盖 → 回落到全局默认）。
     */
    explicit: boolean;
    /**
     * 不可开关原因；正常缺省。第一批唯一可能来源 = 当前 agent 作用域缺少
     * `tools.restrict`（旧外壳 / 服务缺失），或该 unit 含被契约禁止的名字
     * （`run_code` 等，理论不会出现）。
     */
    lockedReason?: string;
    /** 上一次 restrict 的降级状态（仅传了 sessionId 时；诊断/文案用）。 */
    restriction?: {
        state: "applied" | "skipped" | "failed";
        error?: string;
    };
}
/** `tools.list` 的返回。 */
export interface ToolsListView {
    units: ToolsUnitView[];
    /** 全局工具总数（诊断）。 */
    totalGlobalTools: number;
    /** 被判定为宿主内建而排除的条数（诊断；不下发名单）。 */
    excludedBuiltinCount: number;
    /** 服务缺失/异常时的原因（不阻断其它域）。 */
    errors: string[];
    /** 本次查询绑定的会话（没传 sessionId 时缺省；enabledInSession 恒为默认值）。 */
    sessionId?: string;
    /**
     * 归属扫描/缓存是否仍在后台收敛（additive）。
     *
     * `true` 时列表已可用（不阻塞），前端可在首次见到后延迟静默刷新一次。
     */
    attributionSettling?: boolean;
}
/**
 * `tools.setSessionEnabled` 入参（**batch-first**：单条 = 长度 1 的数组）。
 *
 * 客户端只传 `unit`（不是工具名）：宿主自己从当前全局视图重算 deny 名单，
 * 防止客户端注入任意 deny 名单。
 */
export interface ToolsSetSessionInput {
    sessionId: string;
    /** 单元 id 列表。 */
    units: string[];
    /** true=开启（写 true）；false=关闭；undefined=清除显式覆盖（恢复默认）。 */
    enabled: boolean | undefined;
}
/** `tools.setSessionEnabled` 结果（业务失败收在 `ok:false`）。 */
export type ToolsSetSessionResult = {
    ok: true;
    applied: number;
} | {
    ok: false;
    errors: string[];
};
/**
 * `tools.setGlobalEnabled` 入参：设置**全局默认**（能力面板开关，所有会话）。
 *
 * 与 `setSessionEnabled` 的区别：这个写 `tools-global.json`（影响所有会话与新
 * 会话的默认态），不写会话覆盖；会话首屏的开关仍走 `setSessionEnabled`。
 */
export interface ToolsSetGlobalInput {
    /** 开关单元 id 列表（兼容裸 unit 与 `plugin:<unit>` 两种写法）。 */
    units: string[];
    /** true=全局启用（移出 disabled）；false=全局默认关闭（加入 disabled）。 */
    enabled: boolean;
}
/** `tools.setGlobalEnabled` 结果（业务失败收在 `ok:false`）。 */
export type ToolsSetGlobalResult = {
    ok: true;
    applied: number;
} | {
    ok: false;
    errors: string[];
};
/** `tools.inspect` 返回的单个工具：名称 + **完整**说明 + 原始参数 JSON Schema。 */
export interface ToolsInspectedTool {
    /** 完整工具名（`schemas()` 里的 `name`）。 */
    name: string;
    /** 完整说明（**不截断**，与 `tools.list` 的 200 码点不同：详情页要能读全）。 */
    description?: string;
    /**
     * 原始参数 JSON Schema（`schemas()` 的 `parameters`，不裁剪内容）。
     *
     * 原样透传，不做结构解释；宿主没给 / 给了非对象时缺省。
     */
    parameters?: Record<string, unknown>;
}
/** `tools.inspect` 入参。 */
export interface ToolsInspectInput {
    /**
     * 会话 id（可选；当前 inspect 只读全局注册表、不区分会话，保留给未来
     * 「按会话可见性裁剪」扩展，宿主不校验也不使用）。
     */
    sessionId?: string;
    /**
     * 开关单元 id。接受两种写法并归一：
     *   - 裸 unit（= `tools.list` 里的 `units[].unit`，如 `dsh-remote`、
     *     `__unattributed__`）；
     *   - 持久化键形态（带 `plugin:` 前缀，如 `plugin:dsh-remote`）。
     */
    unit: string;
}
/** `tools.inspect` 成功 value（注意：**成功支没有 `ok` 字段**，靠此判别）。 */
export interface ToolsInspectView {
    /** 归一后的裸 unit（与 `tools.list` 的 `units[].unit` 同形）。 */
    unit: string;
    /** 该单元当前可见工具（已按名称排序；含完整 description 与 parameters）。 */
    tools: ToolsInspectedTool[];
}
/**
 * `tools.inspect` 结果：成功 = {@link ToolsInspectView}（无 `ok` 字段）；
 * 业务失败 = `{ok:false, errors}`（传输层信封仍恒 `{ok:true,value}`）。
 */
export type ToolsInspectResult = ToolsInspectView | {
    ok: false;
    errors: string[];
};
/**
 * **legacy**：早期「Tools 无项目级默认、键缺失 = 开启」的常量。
 *
 * v13 修复后生效值改为 `会话覆盖 ?? 全局默认`（见 `effectiveEnabled`），本常量
 * 不再参与计算；保留导出仅为旧代码/测试兼容。
 */
export declare const TOOLS_DEFAULT_ENABLED = true;
