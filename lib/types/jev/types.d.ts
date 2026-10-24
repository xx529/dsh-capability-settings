/**
 * Jev 能力决策：宿主与客户端共用的类型、默认值与错误码。
 *
 * 契约来源：`docs/architecture/jev-capability-decision.md` §3.4 / §5.2。
 *
 * 本文件**不**引用任何宿主服务，保证可以被客户端类型镜像与单元测试直接
 * import。宿主内部使用的 `JevCapability` 等类型也放在这里，避免
 * `rank.ts` / `apply.ts` 之间循环依赖。
 *
 * @module dsh-capability-settings/jev/types
 */
/** 自动触发的门槛（全部由前端调度器消费；宿主只负责存取与校验）。 */
export interface JevAutoTrigger {
    /** 自动触发总开关，默认 false（默认关闭）。 */
    enabled: boolean;
    /** 停顿阈值 300–3000（步长 100），默认 1000。 */
    pauseMs: number;
    /** 最少触发字数 1–200，默认 10。 */
    minChars: number;
    /** 最少修改间隔字符数 1–100，默认 4。 */
    minEditChars: number;
}
/** 落盘的完整配置（`<dshHome>/dsh-capability-settings/jev.json`）。 */
export interface JevConfig {
    /** 根地址，不含 `/v1/systemone`；默认 `https://api.typesafe.ai`。 */
    baseURL: string;
    /** 模型名，默认 `jev-latest`。 */
    model: string;
    /** 直接填写的 key（落盘；文件 0600）。env 优先于它。 */
    apiKey?: string;
    /** 读取 key 的环境变量名，默认 `TYPESAFE_API_KEY`。 */
    apiKeyEnv?: string;
    autoTrigger: JevAutoTrigger;
    /** 单次 HTTP 尝试超时（毫秒），默认 30000。 */
    timeoutMs: number;
}
/** `jev.setConfig` 的入参（字段均可选；`autoTrigger` 若提供必须是完整对象）。 */
export type JevConfigInput = Partial<Omit<JevConfig, "autoTrigger">> & {
    autoTrigger?: JevAutoTrigger;
};
/** 一次默认配置（每次返回新对象，避免调用方改到共享引用）。 */
export declare function defaultJevConfig(): JevConfig;
/** `jev.getConfig` 的视图：**绝不含明文 key**。 */
export interface JevConfigView {
    baseURL: string;
    model: string;
    hasApiKey: boolean;
    apiKeySource: JevKeySource;
    apiKeyLast4: string | null;
    autoTrigger: JevAutoTrigger;
    timeoutMs: number;
    /**
     * 已保存的密钥环境变量名（默认 `TYPESAFE_API_KEY`）。
     *
     * additive（task-19 / AC-CFG-10）：只回**变量名**，不回任何密钥内容；
     * 供配置表单回显「环境变量名」输入框。
     */
    apiKeyEnv: string;
}
/** 密钥来源：环境变量 > 配置文件 > 无。 */
export type JevKeySource = "env" | "file" | "none";
/** 一条字段级校验错误（`message` 为中文可读文案）。 */
export interface JevConfigIssue {
    field: string;
    code: string;
    message: string;
}
/** 校验结果：成功时给出规范化后的完整配置。 */
export type JevConfigValidation = {
    ok: true;
    value: JevConfig;
} | {
    ok: false;
    issues: JevConfigIssue[];
    errors: string[];
};
/** rank / test 的业务错误码（§5.4）。 */
export type JevErrorCode = "no-config" | "auth" | "rate-limit" | "overloaded" | "timeout" | "context-too-long" | "network" | "bad-request" | "empty-capabilities";
/** setConfig 的业务错误码。 */
export type JevSetConfigErrorCode = "invalid-config" | "write-failed";
/** apply 的业务错误码。 */
export type JevApplyErrorCode = "bad-request" | "write-failed";
/** 服务端返回的 token 用量（缺失记 0，不伪造估算）。 */
export interface JevUsage {
    input_tokens: number;
    output_tokens: number;
}
/**
 * `jev.test` 的可选入参（additive，task-19 / AC-CFG-11）。
 *
 * 带 `config` 时用「已保存配置 + 本次表单值」合并出的**临时配置**做探针
 * （不落盘、不缓存）；缺省 / `{}` 时沿用已保存配置（旧行为）。
 */
export interface JevTestInput {
    config?: JevConfigInput;
}
export type JevTestResult = {
    ok: true;
    model: string;
    latencyMs: number;
} | {
    ok: false;
    code: JevErrorCode;
    errors: string[];
};
export interface JevRankInput {
    cwd?: string;
    sessionId: string;
    draft: string;
}
/** 一条能力在会话里的可应用原因（不可应用时写进 `reason`）。 */
export type JevApplySkipReason = "unknown-id" | "hard-disabled" | "not-restrictable" | "not-toggleable" | "shadowed" | "already-applied";
/** rank 结果里的一行（前端勾选/排序用）。 */
export interface JevRankItem {
    /** `cap_<36 位小写 hex>`。 */
    id: string;
    kind: "skill" | "mcp";
    name: string;
    /** 已按 200 码点截断。 */
    description: string;
    /** 0..1，`noul`；无答案记 0。 */
    score: number;
    /** 能力本身是否允许启用（与会话是否 live 无关，见架构 §7.3）。 */
    applicable: boolean;
    /** `applicable=false` 时的原因；否则可能为 `no-answer`。 */
    reason?: string;
    /** 当前会话启用态（前端勾选初值/回显）。 */
    enabledInSession: boolean;
}
export type JevRankResult = {
    ok: true;
    items: JevRankItem[];
    model: string;
    usage: JevUsage;
    elapsedMs: number;
    /** 逻辑批量请求数（重试不累加）。 */
    requestCount: 1;
    capabilitiesTotal: number;
    pendingOutcome?: JevPendingOutcome;
} | {
    ok: false;
    code: JevErrorCode;
    errors: string[];
};
export interface JevApplyInput {
    cwd?: string;
    sessionId: string;
    plan: JevApplyPlanItem[];
}
/**
 * 客户端提交的计划项（**只含勾选项**；宿主只信 `id`，`name`/`target` 仅用于诊断）。
 *
 * 筛选语义（task-42）：宿主把 plan 当「选中集合」——选中项目标 enable，
 * 当前会话里其余**可应用**能力目标 disable（未勾选 = 关闭），只改会话开关。
 */
export interface JevApplyPlanItem {
    id: string;
    kind: "skill" | "mcp";
    name: string;
    target?: string;
    /** 本期客户端只提交勾选项，恒为 true。 */
    enabled: true;
}
export interface JevApplySkipped {
    id: string;
    reason: JevApplySkipReason;
}
export interface JevApplyFailed {
    id: string;
    reason: string;
}
/** 冷会话排队结果回执：读取即消费，附在下一次 rank/apply 成功响应里。 */
export interface JevPendingOutcome {
    /** 激活后实际写入条数（筛选语义下 = 启用数 + 关闭数）。 */
    applied: number;
    failed: number;
    errors: string[];
    /** epoch ms。 */
    at: number;
}
export type JevApplyResult = {
    ok: true;
    /** 本次实际写入条数 = `enabled + disabled`（回滚 = 0）。 */
    applied: number;
    /**
     * 本次实际**启用**的条数（筛选语义：勾选项里当前关闭 → 打开）。
     *
     * additive（task-42）：客户端旧版本忽略该字段即可；`applied` 语义不变。
     */
    enabled: number;
    /** 本次实际**关闭**的条数（筛选语义：可应用但未勾选、当前开启 → 关闭）。 */
    disabled: number;
    skipped: JevApplySkipped[];
    /** true = 冷会话排队，尚未写入（此时 enabled/disabled/applied 均为 0）。 */
    pending: boolean;
    failed?: JevApplyFailed[];
    /** additive：回滚细节/诊断（脱敏）。 */
    errors?: string[];
    /**
     * additive（task-47）：宿主测得的 apply 总耗时（枚举 + 批量写入，毫秒）。
     *
     * 仅成功支返回；客户端可忽略（用于排查「应用中…」过长）。
     */
    elapsedMs?: number;
    pendingOutcome?: JevPendingOutcome;
} | {
    ok: false;
    code: JevApplyErrorCode;
    errors: string[];
};
export interface JevSetConfigInput {
    config: JevConfigInput;
}
export type JevSetConfigResult = {
    ok: true;
} | {
    ok: false;
    code: JevSetConfigErrorCode;
    errors: string[];
    issues?: JevConfigIssue[];
};
/**
 * 一条可评分/可应用能力（宿主内部）。
 *
 * 与 `JevRankItem` 的差异：多了写回目标（`write`）、当前会话是否可切换的
 * 原始快照（`canToggleInSession`，冷会话重试就绪用）、MCP 显式会话覆盖
 * （`mcpExplicitToggle`，回滚用）。
 */
export interface JevCapability {
    id: string;
    kind: "skill" | "mcp";
    name: string;
    /** 已按 200 码点截断（发模型用）。 */
    description: string;
    /** 已按 120 码点截断；空则不带。 */
    whenToUse?: string;
    source: "project" | "global" | "external";
    applicable: boolean;
    reason?: JevApplySkipReason;
    enabledInSession: boolean;
    /** 仅 skill：`skills.sessionList` 的原始 `canToggleInSession`（冷会话为 false）。 */
    canToggleInSession?: boolean;
    /** 仅 MCP：是否存在显式会话覆盖；undefined = 跟随项目默认。 */
    mcpExplicitToggle?: boolean;
    /**
     * 仅 MCP：从全局工具注册表反推出的工具（name + description）。
     *
     * 用于 `jev.rank` 让模型知道该 server 实际能做什么（配置条目走宿主
     * `mcpTools(serverName)`，外部注入实例取 `mcp.runtime` 的 `view.tools`）。
     * 只用于 prompt，不跨 RPC 下发。
     */
    tools?: Array<{
        name: string;
        description?: string;
    }>;
    /** 写回目标（不发给模型）。 */
    write: JevCapabilityWrite;
}
/** 写回目标：skills 按 name；MCP 按 config key / serverName。 */
export type JevCapabilityWrite = {
    type: "skills";
    name: string;
} | {
    type: "mcp";
    target: string;
    targetKind: "project" | "server";
    serverName: string;
};
/** 写入前的状态快照（回滚用）。 */
export type JevPrevState = {
    type: "skills";
    enabled: boolean;
} | {
    type: "mcp";
    enabled: boolean | undefined;
};
/** 宿主日志接口（`ctx.logger` 的结构子集；缺省时静默）。 */
export interface JevLogger {
    warn?(message: string): void;
    error?(message: string): void;
}
/** 宿主 ctx 的结构子集：只用到 get / on / logger。 */
export interface JevHostContext {
    get?: (name: string) => any;
    on?: (event: string, handler: (payload: any) => void) => unknown;
    logger?: JevLogger;
}
/** rank 成功支的收窄别名。 */
export type JevRankSuccess = Extract<JevRankResult, {
    ok: true;
}>;
/** apply 成功支的收窄别名。 */
export type JevApplySuccess = Extract<JevApplyResult, {
    ok: true;
}>;
