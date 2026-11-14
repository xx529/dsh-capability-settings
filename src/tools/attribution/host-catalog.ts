/**
 * 宿主随包工具目录（`@deepseek-ai/dsh/docs/tool-catalog.md`）解析。
 *
 * 背景：宿主工具注册表没有来源字段，而桌面 / Web 组合把**几乎所有模型可见的
 * 内建工具**改由 Agent 预设按会话挂载（`dsh-web-app` 的 patch 把根层同名工具行
 * 逐条 `disabled: true`，再由 `presets/standard.patch.yml` 挂进 agent scope）。
 * 这些工具既不在全局 `tools.schemas()` 里，也不在插件包源码的字面量里可唯一
 * 归属，靠人工表维护会随宿主升级漂移（`present` / `working_directory` /
 * `apply_patch` / `exit_plan_mode` / `session_*` / `team_task_*` …）。
 *
 * 宿主自己随包提供了一份**生成式**工具目录（`pnpm run gen-tool-catalog` 产出），
 * 其中 `Tool Package Map` 表把每个模型可见工具名映射到提供它的 npm 包。本模块
 * 只读解析这张表，作为宿主工具的**权威归属来源**；读不到 / 有歧义时调用方回落
 * 人工表。解析失败一律 fail-open（返回空表），绝不影响 Tools 域可用性。
 *
 * 约束：
 *   - 只读文本、不执行任何宿主代码；
 *   - 同名字段可能对应多个包（如 `bash` 同时有 `dsh-tool-bash` 与
 *     `dsh-tool-bash-persistent`）→ 记入 `ambiguous`，不猜；
 *   - 不缓存到磁盘（随宿主版本变化，进程内一次性解析即可）。
 *
 * @module dsh-capability-settings/tools/attribution/host-catalog
 */

import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 合法工具名（模型可见名 / 别名）。 */
const TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 合法 npm 包名（含 scope）。 */
const PACKAGE_NAME_PATTERN = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/** 解析结果。 */
export interface HostToolCatalog {
  /** 唯一归属的工具名 → 包名。 */
  tools: ReadonlyMap<string, string>;
  /** 同一工具名被多个宿主包声明：不猜，调用方回落人工表。 */
  ambiguous: ReadonlySet<string>;
  /** 命中的目录文件（诊断用；不落盘）。 */
  source?: string;
}

/** 空目录（读不到 / 解析失败）。 */
export function emptyHostToolCatalog(): HostToolCatalog {
  return { tools: new Map(), ambiguous: new Set() };
}

/**
 * 解析 `tool-catalog.md` 的 `Tool Package Map` 表。
 *
 * 行形状：`| \`@deepseek-ai/dsh-tool-fs\` | \`apply_patch\`, \`edit\`, … | Requires |
 * Writes | \`alias\` | note |`。只取第 2 列（模型可见名）与第 5 列（Shipped
 * aliases），其余列是说明/依赖，不能当工具名。
 *
 * @param text 目录文件全文
 * @param source 诊断用来源路径
 */
export function parseToolCatalogMarkdown(text: string, source?: string): HostToolCatalog {
  const owners = new Map<string, Set<string>>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const body = trimmed.endsWith("|") ? trimmed.slice(1, -1) : trimmed.slice(1);
    const cells = body.split("|").map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const packageMatch = /^`([^`]+)`$/.exec(cells[0] ?? "");
    if (packageMatch === null) continue;
    const packageId = (packageMatch[1] ?? "").toLowerCase().trim();
    if (!PACKAGE_NAME_PATTERN.test(packageId)) continue;
    // 第 2 列 = Model-visible names，第 5 列 = Shipped aliases（1-based 2/5）。
    for (const index of [1, 4]) {
      const cell = cells[index];
      if (typeof cell !== "string") continue;
      for (const token of cell.matchAll(/`([^`]+)`/g)) {
        const name = (token[1] ?? "").trim();
        if (!TOOL_NAME_PATTERN.test(name)) continue;
        let set = owners.get(name);
        if (set === undefined) {
          set = new Set<string>();
          owners.set(name, set);
        }
        set.add(packageId);
      }
    }
  }
  const tools = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [name, set] of owners) {
    if (set.size === 1) {
      const [only] = [...set];
      if (only !== undefined) tools.set(name, only);
    } else {
      ambiguous.add(name);
    }
  }
  const result: HostToolCatalog = { tools, ambiguous };
  if (source !== undefined) result.source = source;
  return result;
}

/** 从 loader 条目读 `entries()`（数组/可迭代都兼容；异常给空）。 */
function loaderEntries(ctx: any): any[] {
  try {
    const loader = ctx?.loader ?? ctx?.get?.("loader");
    const raw = typeof loader?.entries === "function" ? loader.entries() : undefined;
    if (Array.isArray(raw)) return raw;
    if (raw !== undefined && raw !== null && typeof raw[Symbol.iterator] === "function") return [...raw];
  } catch {
    /* loader 不可用 */
  }
  return [];
}

/** `file://` / 裸路径 → 文件系统路径（失败原样返回）。 */
function toFsPath(value: string): string {
  try {
    return value.startsWith("file:") ? fileURLToPath(value) : value;
  } catch {
    return value;
  }
}

/**
 * 候选 `@deepseek-ai/dsh` 包根（去重）。
 *
 * 顺序：`pluginPackages.packageOf`（宿主包解析器）→ loader 条目 baseUrl 反推
 * `node_modules` → Electron `process.resourcesPath` 固定布局。任一命中即可，
 * 全部失败时返回空数组（调用方 fail-open）。
 */
export function hostToolCatalogCandidates(ctx: any): string[] {
  const dirs = new Set<string>();
  try {
    const packages = ctx?.get?.("pluginPackages");
    for (const name of ["@deepseek-ai/dsh", "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]) {
      let found: { dir?: unknown } | undefined;
      try {
        found = packages?.packageOf?.(name, undefined);
      } catch {
        found = undefined;
      }
      if (typeof found?.dir !== "string" || found.dir.length === 0) continue;
      // found.dir = …/node_modules/@deepseek-ai/<pkg> → 同级 @deepseek-ai/dsh。
      const scopeDir = dirname(found.dir);
      const modulesDir = dirname(scopeDir);
      const scope = basename(scopeDir);
      if (scope.startsWith("@")) dirs.add(join(modulesDir, scope, "dsh"));
    }
  } catch {
    /* pluginPackages 不可用 */
  }
  for (const entry of loaderEntries(ctx)) {
    const name = entry?.options?.name;
    const baseUrl = entry?.ctx?.baseUrl ?? entry?.baseUrl;
    if (typeof name !== "string" || !name.startsWith("@deepseek-ai/") || typeof baseUrl !== "string") continue;
    const file = toFsPath(baseUrl).replace(/\\/g, "/");
    const index = file.lastIndexOf("/node_modules/");
    if (index < 0) continue;
    const modulesDir = file.slice(0, index) + "/node_modules";
    dirs.add(join(modulesDir, "@deepseek-ai", "dsh"));
  }
  try {
    const resources = (process as { resourcesPath?: unknown }).resourcesPath;
    if (typeof resources === "string" && resources.length > 0) {
      dirs.add(join(resources, "app.asar", "dsh", "node_modules", "@deepseek-ai", "dsh"));
      dirs.add(join(resources, "app", "dsh", "node_modules", "@deepseek-ai", "dsh"));
    }
  } catch {
    /* 非 Electron */
  }
  return [...dirs];
}

/**
 * 读取并解析宿主随包工具目录（同步、fail-open）。
 *
 * 同步是刻意的：归属解析 `resolveTool` / `tools.list` 都是同步路径，目录文件通常
 * 只有 ~100KB，一次读入 + 解析在毫秒级；失败返回空表，后续仍可重试。
 *
 * @param ctx 宿主插件上下文（`get("pluginPackages")` / `loader`）
 * @param logger 可选：记录命中的目录路径（debug 级；缺省静默）
 */
export function loadHostToolCatalog(
  ctx: any,
  logger?: { info?: (message: string) => void; warn?: (message: string) => void },
): HostToolCatalog {
  for (const dir of hostToolCatalogCandidates(ctx)) {
    const file = join(dir, "docs", "tool-catalog.md");
    try {
      const text = readFileSync(file, "utf8");
      const parsed = parseToolCatalogMarkdown(text, file);
      if (parsed.tools.size > 0) {
        logger?.info?.(`capability-panel: 宿主工具目录命中 ${file}（${parsed.tools.size} 个工具名）`);
        return parsed;
      }
    } catch {
      /* 候选路径不存在 / 读失败：继续下一个 */
    }
  }
  return emptyHostToolCatalog();
}
