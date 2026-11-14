/**
 * 「宿主注入能力」判定（Skills / MCP / Tools 三域共用）。
 *
 * 语义：能力由 DSH 自身装载的 `@deepseek-ai/*` 包（宿主 bundle / 宿主插件 /
 * Agent 预设包）提供，而不是用户安装的第三方插件或工作区配置。这类能力属于
 * **运行基线**：所有工作区默认都需要，面板只做只读展示，不提供任何开关
 * （全局默认 / 每工作区默认 / 当前对话 / 可见性都不可写）。
 *
 * 判定依据（从强到弱）：
 *   1. 所属 npm 包名带 `@deepseek-ai/` 前缀（宿主包）；
 *   2. 注入来源（fiber / loader 条目 / registry provider / path）落在
 *      `@deepseek-ai/*` 包或 DSH 安装包内（`app.asar`）；
 *   3. Skills 的 `origin` 为 `bundled`（DSH 随包技能）或 `preset`（宿主预制层）。
 *
 * 纯字符串实现、无 node 依赖：宿主侧与客户端 bundle 都可直接复用。
 *
 * @module dsh-capability-settings/shared/host-injected
 */
/** 宿主包 scope。 */
export declare const HOST_PACKAGE_SCOPE = "@deepseek-ai/";
/** 面板展示的「宿主」标签。 */
export declare const HOST_INJECTED_LABEL = "\u5BBF\u4E3B";
/** 宿主注入能力的统一禁用原因（开关 tooltip / 后端业务错误共用）。 */
export declare const HOST_INJECTED_REASON = "\u5BBF\u4E3B\u6CE8\u5165\u7684\u80FD\u529B\uFF1A\u4EC5\u5C55\u793A\uFF0C\u4E0D\u80FD\u5F00\u5173\uFF08\u6240\u6709\u5DE5\u4F5C\u533A\u9ED8\u8BA4\u542F\u7528\uFF09";
/**
 * 「Agent 预设注入」单元的只读原因（Tools 域，v26.2）。
 *
 * 桌面 / Web 组合把内建工具改由 Agent 预设按会话挂载（agent scope）；宿主
 * `tools.restrict` 只作用于继承层，viewing scope 自己的注册不受限，因此这类
 * 工具**无法按会话关闭**，面板只读展示。
 */
export declare const AGENT_SCOPED_REASON = "Agent \u9884\u8BBE\u6CE8\u5165\u7684\u4F1A\u8BDD\u5DE5\u5177\uFF1A\u968F\u9884\u8BBE\u56FA\u5B9A\uFF0C\u4E0D\u80FD\u6309\u4F1A\u8BDD\u5F00\u5173";
/**
 * 是否为宿主拥有的 npm 包（`@deepseek-ai/*`）。
 *
 * 注意：只认 scope，不认裸 `dsh-*` 包名——第三方插件经常使用裸名
 * （`dsh-terminal-panel` / `dsh-diff-approval`），不能误判成宿主能力。
 */
export declare function isHostOwnedPackage(packageId: string | undefined | null): boolean;
/**
 * 注入来源是否为宿主（包名 / fiber 名 / loader 条目名 / registry provider）。
 *
 * `@deepseek-ai/*` 之外的来源一律按第三方处理；无法识别的来源返回 false，
 * 由调用方保持旧行为（可开关）。
 */
export declare function isHostOwnedSource(source: string | undefined | null): boolean;
/**
 * 路径是否落在 DSH 宿主安装内（`@deepseek-ai` 包目录或 `app.asar`）。
 *
 * Skills 的 registry 条目可能只暴露磁盘路径（preset / bundled 技能目录），
 * 用它兜底识别宿主预制技能。
 */
export declare function isHostOwnedPath(value: string | undefined | null): boolean;
