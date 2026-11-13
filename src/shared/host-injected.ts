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
export const HOST_PACKAGE_SCOPE = "@deepseek-ai/";

/** 面板展示的「宿主」标签。 */
export const HOST_INJECTED_LABEL = "宿主";

/** 宿主注入能力的统一禁用原因（开关 tooltip / 后端业务错误共用）。 */
export const HOST_INJECTED_REASON = "宿主注入的能力：仅展示，不能开关（所有工作区默认启用）";

/** 去空白并小写（npm 包名大小写不敏感），与 attribution 的归一化口径一致。 */
function normalizeId(raw: string | undefined | null): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/**
 * 是否为宿主拥有的 npm 包（`@deepseek-ai/*`）。
 *
 * 注意：只认 scope，不认裸 `dsh-*` 包名——第三方插件经常使用裸名
 * （`dsh-terminal-panel` / `dsh-diff-approval`），不能误判成宿主能力。
 */
export function isHostOwnedPackage(packageId: string | undefined | null): boolean {
  return normalizeId(packageId).startsWith(HOST_PACKAGE_SCOPE);
}

/**
 * 注入来源是否为宿主（包名 / fiber 名 / loader 条目名 / registry provider）。
 *
 * `@deepseek-ai/*` 之外的来源一律按第三方处理；无法识别的来源返回 false，
 * 由调用方保持旧行为（可开关）。
 */
export function isHostOwnedSource(source: string | undefined | null): boolean {
  return isHostOwnedPackage(source);
}

/**
 * 路径是否落在 DSH 宿主安装内（`@deepseek-ai` 包目录或 `app.asar`）。
 *
 * Skills 的 registry 条目可能只暴露磁盘路径（preset / bundled 技能目录），
 * 用它兜底识别宿主预制技能。
 */
export function isHostOwnedPath(value: string | undefined | null): boolean {
  const path = typeof value === "string" ? value.replace(/\\/g, "/").toLowerCase() : "";
  if (path.length === 0) return false;
  return path.includes(`/node_modules/${HOST_PACKAGE_SCOPE}`) || path.includes("/app.asar/") || path.startsWith("app.asar/");
}
