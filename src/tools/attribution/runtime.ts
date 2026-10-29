/**
 * T0 运行时栈归属：在 `tools/change` 监听器里抓注册调用栈，从帧路径反推插件包。
 *
 * 设计：`docs/architecture/plugin-attribution-auto.md` §5（D5/§5.2/§5.3）。
 * 证据：`docs/research/plugin-attribution-heuristics.md` §4（同步 emit；默认 10 帧
 * 不够，需临时抬到 48；单次 ~8µs，零文件 IO）。
 *
 * 纪律：
 *   - 监听器内任何异常都吞掉（绝不能影响注册流程）；
 *   - `stackTraceLimit` 必须 `finally` 恢复；
 *   - 连续 3 次失败 → 本进程禁用 T0（warn 一次），后续靠静态层；
 *   - bridge（dsh-mcp-client）帧 / 宿主帧（app.asar、@deepseek-ai/*）/ 自身包帧
 *     一律不归属。
 *
 * @module dsh-capability-settings/tools/attribution/runtime
 */

import { normalizePackageId, SELF_PACKAGE } from "./unit-id.js";

/** 运行时捕获依赖。 */
export interface RuntimeAttributorDeps {
  /** 宿主插件 ctx（要 `on("tools/change")`）。 */
  ctx: any;
  /** 同步取当前全局工具名（`schemas()`；旧装配）。 */
  knownNames?: () => string[];
  /** 同步取当前全局工具定义（name + description + parameters；优先于 knownNames）。 */
  knownSchemas?: () => Array<{ name: string; description?: unknown; parameters?: unknown }>;
  /** 新增归属（写内存索引 + 标记 dirty）。 */
  onCapture?: (capture: RuntimeCapture) => void;
  logger?: { warn?: (message: string) => void };
  selfPackage?: string;
}

/** 一次 tools/change 的捕获结果。 */
export interface RuntimeCapture {
  /** 本次新增的工具名（差集）。 */
  tools: string[];
  /** 注册方包名（目录名归一前的 npm 包名候选）。 */
  packageName: string;
  /** 其中 `mcp__<ns>__*` 的命名空间。 */
  namespaces: string[];
  /** 捕获时间（epoch ms）。 */
  at: number;
}

/** 运行时归属器。 */
export interface RuntimeAttributor {
  /** 移除监听（热重载/卸载）。 */
  dispose(): void;
  /** 本进程是否已因连续失败禁用 T0。 */
  disabled(): boolean;
  /** 连续失败计数（诊断）。 */
  failures(): number;
}

/** 栈帧里可忽略的宿主/框架帧特征。 */
const HOST_FRAME_MARKERS = ["app.asar", "/@deepseek-ai/", "\\@deepseek-ai\\"];

/** bridge 包（工具异步注册时栈里只剩它的帧）。 */
const BRIDGE_PACKAGE = "dsh-mcp-client";

/** 从单帧路径里解析「包目录名候选」。 */
function packageFromPath(rawPath: string): string | undefined {
  const path = rawPath.replace(/\\/g, "/").replace(/^file:\/\//, "");
  if (!path.includes("node_modules")) return undefined;
  if (HOST_FRAME_MARKERS.some((marker) => path.includes(marker.replace(/\\/g, "/")))) return undefined;
  // 取**最后一个** node_modules（pnpm 嵌套布局里内层才是真实包根）。
  const index = path.lastIndexOf("/node_modules/");
  if (index < 0) return undefined;
  const rest = path.slice(index + "/node_modules/".length);
  const parts = rest.split("/");
  if (parts.length === 0) return undefined;
  let candidate: string;
  if (parts[0]?.startsWith("@")) {
    if (parts[1] === undefined || parts[1].length === 0) return undefined;
    candidate = `${parts[0]}/${parts[1]}`;
  } else {
    candidate = parts[0] ?? "";
  }
  if (candidate.length === 0) return undefined;
  return normalizePackageId(candidate);
}

/**
 * 从 `Error().stack` 里解析注册方包名（纯函数，单测直接覆盖各路径形态）。
 *
 * 规则：逐帧取文件路径 → 跳过 node:/internal/<anonymous>/宿主帧 → 取最后一个
 * `/node_modules/` 之后的首段（scoped 取两段）→ 排除 bridge 与自身包。
 *
 * @param stack `new Error().stack` 原文
 * @param selfPackage 自身包名（缺省 {@link SELF_PACKAGE}）
 */
export function parsePackageFromStack(stack: string | undefined, selfPackage: string = SELF_PACKAGE): string | undefined {
  if (typeof stack !== "string" || stack.length === 0) return undefined;
  const self = normalizePackageId(selfPackage);
  for (const line of stack.split("\n").slice(1)) {
    const match = line.match(/\(?((?:file:\/\/)?[^()\s]+?):\d+:\d+\)?\s*$/);
    if (match === null) continue;
    const file = match[1] ?? "";
    // 非文件帧。
    if (file.startsWith("node:") || file.startsWith("internal/") || file.includes("<anonymous>")) continue;
    const candidate = packageFromPath(file);
    if (candidate === undefined) continue;
    if (candidate === self || candidate.startsWith(`${self}/`)) continue;
    if (candidate === BRIDGE_PACKAGE || candidate.startsWith(`${BRIDGE_PACKAGE}/`)) continue;
    return candidate;
  }
  return undefined;
}

/** 提取本次栈里的全部候选（诊断用；正常取第一个）。 */
export function parsePackagesFromStack(stack: string | undefined, selfPackage: string = SELF_PACKAGE): string[] {
  const found: string[] = [];
  if (typeof stack !== "string") return found;
  const self = normalizePackageId(selfPackage);
  for (const line of stack.split("\n").slice(1)) {
    const match = line.match(/\(?((?:file:\/\/)?[^()\s]+?):\d+:\d+\)?\s*$/);
    if (match === null) continue;
    const candidate = packageFromPath(match[1] ?? "");
    if (candidate === undefined || candidate === self || candidate === BRIDGE_PACKAGE) continue;
    if (!found.includes(candidate)) found.push(candidate);
  }
  return found;
}

/** 从工具名解析 MCP 命名空间（仅 `mcp__<ns>__<tool>`）。 */
function namespaceOfToolName(name: string): string | undefined {
  if (!name.startsWith("mcp__")) return undefined;
  const rest = name.slice("mcp__".length);
  const split = rest.indexOf("__");
  if (split <= 0) return undefined;
  return rest.slice(0, split);
}

/**
 * 创建 T0 运行时归属器（监听一挂、基线一取，之后每次注册顺手捕获）。
 *
 * @param deps 上下文/快照/回调
 */
export function createRuntimeAttributor(deps: RuntimeAttributorDeps): RuntimeAttributor {
  const logger = deps.logger;
  const selfPackage = deps.selfPackage ?? SELF_PACKAGE;
  /** 已知工具 → 定义签名（同名替换也能识别）。 */
  let known = new Map<string, string>();
  /** 上一次实际捕获的工具（用于同名同定义替换：无差集但注册帧已知时 last wins）。 */
  let lastChanged: string[] = [];
  let failures = 0;
  let disabled = false;
  let disposed = false;
  let off: (() => void) | undefined;

  /** 定义签名：description + parameters 的规范化 JSON（同名替换判定）。 */
  function signatureOf(item: { description?: unknown; parameters?: unknown }): string {
    try {
      return `${String(item.description ?? "")}\u0000${JSON.stringify(item.parameters ?? null)}`;
    } catch {
      return "unserializable";
    }
  }

  /** 同步取当前工具定义（失败给空数组：宁可漏捕一次，绝不抛出）。 */
  function schemasNow(): Array<{ name: string; description?: unknown; parameters?: unknown }> {
    try {
      if (deps.knownSchemas !== undefined) {
        const schemas = deps.knownSchemas();
        return Array.isArray(schemas) ? schemas : [];
      }
      const names = deps.knownNames?.() ?? [];
      return (Array.isArray(names) ? names : []).map((name) => ({ name }));
    } catch {
      return [];
    }
  }

  /** 捕获一次（异常全吞；连续 3 次失败禁用 T0）。 */
  function capture(): void {
    if (disabled || disposed) return;
    try {
      const oldLimit = Error.stackTraceLimit;
      let stack: string | undefined;
      Error.stackTraceLimit = 48;
      try {
        stack = new Error().stack;
      } finally {
        Error.stackTraceLimit = oldLimit;
      }
      const packageName = parsePackageFromStack(stack, selfPackage);
      // bridge / 宿主帧：提前返回，连 schemas 都不读（注册风暴时省开销）。
      if (packageName === undefined) return;
      const schemas = schemasNow();
      const changed: string[] = [];
      const next = new Map<string, string>();
      for (const item of schemas) {
        const name = typeof item?.name === "string" ? item.name : "";
        if (name.length === 0) continue;
        const signature = signatureOf(item);
        next.set(name, signature);
        // 新增或**同名替换（定义签名变化）**都归给当前注册帧（last wins）。
        if (known.get(name) !== signature) changed.push(name);
      }
      known = next;
      if (changed.length === 0) {
        // 同名**同定义**替换：schemas 无差异，但注册帧仍是可靠信号——把上次
        // 捕获的那批工具重归给当前注册包（last wins）。lastChanged 为空则忽略。
        if (lastChanged.length === 0) return;
        try {
          deps.onCapture?.({ tools: [...lastChanged], packageName, namespaces: [], at: Date.now() });
        } catch {
          /* 回调失败不影响注册流程 */
        }
        return;
      }
      lastChanged = changed;
      const namespaces: string[] = [];
      for (const name of changed) {
        const ns = namespaceOfToolName(name);
        if (ns !== undefined && !namespaces.includes(ns)) namespaces.push(ns);
      }
      try {
        deps.onCapture?.({ tools: changed, packageName, namespaces, at: Date.now() });
      } catch {
        /* 回调失败不影响注册流程 */
      }
    } catch (error) {
      failures += 1;
      if (failures >= 3 && !disabled) {
        disabled = true;
        logger?.warn?.(
          `capability-panel: T0 运行时归属连续失败 ${failures} 次，本进程降级到静态归属（${String(error)}）`,
        );
      }
    }
  }

  // 基线：监听前已注册的工具不归 T0（交给 T1/T2/T3/T4 回填）。
  known = new Map<string, string>();
  for (const item of schemasNow()) {
    const name = typeof item?.name === "string" ? item.name : "";
    if (name.length > 0) known.set(name, signatureOf(item));
  }
  try {
    const result = deps.ctx?.on?.("tools/change", capture);
    off = typeof result === "function" ? result : undefined;
  } catch (error) {
    logger?.warn?.(`capability-panel: 无法挂载 T0 tools/change 监听（${String(error)}），本次运行仅用静态归属`);
    disabled = true;
  }

  return {
    dispose(): void {
      disposed = true;
      try {
        off?.();
      } catch {
        /* 卸载阶段忽略 */
      }
      off = undefined;
    },
    disabled(): boolean {
      return disabled;
    },
    failures(): number {
      return failures;
    },
  };
}
