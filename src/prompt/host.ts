/**
 * 宿主集成层：**只负责「把哪些文件交给 DSH」**，不实现渲染。
 *
 * 渲染统一调用宿主导出的
 * `@deepseek-ai/dsh-agent-instructions` 的 `loadBaselineInstructions(options, fileSystem)`：
 *
 *   - 第二个参数是宿主自己的 `fileSystem` 接缝；我们传入一个「只把已启用文件
 *     视为存在」的虚拟 fs；
 *   - 于是**发现顺序、trim 去重、`maxSourceBytes` 跳过、`maxBytes` 预算截断、
 *     `<system-reminder>` framing** 全部由宿主完成；
 *   - 本模块只做：取宿主模块实例（`loader.import`，与宿主注入器同一份代码）、
 *     枚举候选路径（用于 UI / 策略计算）、把允许集合包成虚拟 fs、调用渲染。
 *
 * 任何失败都返回 undefined（fail-open：调用方放行宿主原消息，绝不拖垮对话）。
 *
 * @module dsh-capability-settings/prompt/host
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  PROMPT_ALL_CANDIDATES,
  PROMPT_GLOBAL_FILE,
  defaultRenderConfig,
  globalPromptCandidates,
  projectPromptCandidates,
  type PromptCandidate,
  type PromptHomes,
  type PromptRenderConfig,
} from "./paths.js";

/** 宿主模块的最小形状（只用到这两个导出）。 */
interface HostInstructionsModule {
  discoverBaselineInstructionFiles?: (options: Record<string, unknown>) => Promise<Array<{ absolutePath: string; displayPath: string }>>;
  loadBaselineInstructions?: (options: Record<string, unknown>, fileSystem?: unknown) => Promise<
    | {
        text: string;
        omitted: Array<{ displayPath: string }>;
        truncated: Array<{ displayPath: string; originalBytes: number; includedBytes: number }>;
      }
    | undefined
  >;
}

/** 宿主渲染结果（原样透传宿主的诊断）。 */
export interface PromptRenderResult {
  text: string;
  omitted: Array<{ displayPath: string }>;
  truncated: Array<{ displayPath: string; originalBytes: number; includedBytes: number }>;
}

/** 宿主集成句柄。 */
export interface PromptHost {
  /** 模块是否可用（不可用 = 只读面板仍可工作，注入层降级为宿主原样）。 */
  available(): Promise<boolean>;
  /**
   * 枚举「已存在」的候选（只列路径，不渲染）。
   *
   * @param options cwd / 项目根 / 渲染配置
   * @returns 候选列表（全局两处 + 项目链，宽泛 → 具体）
   */
  discover(options: {
    cwd: string;
    projectRoot: string;
    homes: PromptHomes;
    config: PromptRenderConfig;
  }): Promise<PromptCandidate[]>;
  /**
   * 用宿主渲染器生成 baseline 正文（只传允许集合）。
   *
   * @param options 渲染参数
   * @param allowed 允许出现在渲染里文件的绝对路径集合
   * @returns 宿主渲染结果；失败或空返回 undefined
   */
  render(options: {
    cwd: string;
    homes: PromptHomes;
    config: PromptRenderConfig;
    replacePreviousBaseline?: boolean;
  }, allowed: ReadonlySet<string>): Promise<PromptRenderResult | undefined>;
}

/** 计算全文 SHA-1（与宿主 `source.changes[].digest` 同口径）。 */
export function sha1Of(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/** 判断路径是否是某个指令候选文件名（虚拟 fs 的「未启用即不可见」判定）。 */
function isInstructionFileName(name: string): boolean {
  return PROMPT_ALL_CANDIDATES.includes(name);
}

/**
 * 构造虚拟 fs：只让 `allowed` 里的指令文件「存在」，其余指令候选一律 absent。
 *
 * 目录（如项目根标记 `.git`）与其它文件照常透传，宿主发现项目根仍能工作。
 */
function createVirtualFileSystem(allowed: ReadonlySet<string>) {
  const allowedResolved = new Set([...allowed].map((path) => resolve(path)));
  const isInstructionPath = (path: string): boolean => isInstructionFileName(basename(path));
  return {
    /** 宿主只把 resolve 结果当 target 传回 stat/streamText。 */
    async resolve(path: string): Promise<string> {
      return path;
    },
    async stat(target: string): Promise<{ type: string; version?: string; size?: number } | undefined> {
      const path = resolve(target);
      if (isInstructionPath(path) && !allowedResolved.has(path)) return undefined;
      try {
        const info = await stat(path);
        return {
          type: info.isFile() ? "file" : "directory",
          ...(info.isFile() ? { version: `${info.size}:${info.mtimeMs}`, size: info.size } : {}),
        };
      } catch {
        return undefined;
      }
    },
    async *streamText(target: string): AsyncIterable<string> {
      const stream = createReadStream(resolve(target), { encoding: "utf8" });
      for await (const chunk of stream) yield String(chunk);
    },
  };
}

/** 读取宿主模块（懒加载 + 缓存；失败缓存 undefined，不反复重试）。 */
function createModuleLoader(ctx: { get?: (name: string) => unknown }): () => Promise<HostInstructionsModule | undefined> {
  let cached: Promise<HostInstructionsModule | undefined> | undefined;
  return () => {
    cached ??= (async () => {
      try {
        const loader = ctx.get?.("loader") as { import?: (name: string) => Promise<unknown> } | undefined;
        if (loader?.import === undefined) return undefined;
        const mod = (await loader.import("@deepseek-ai/dsh-agent-instructions")) as HostInstructionsModule | undefined;
        if (mod === undefined || typeof mod.loadBaselineInstructions !== "function") return undefined;
        return mod;
      } catch {
        return undefined;
      }
    })();
    return cached;
  };
}

/** fallback 发现（宿主模块不可用时）：仅做路径存在性枚举。 */
async function fallbackDiscover(
  cwd: string,
  projectRoot: string,
  homes: PromptHomes,
  config: PromptRenderConfig,
): Promise<PromptCandidate[]> {
  const all = [...globalPromptCandidates(homes), ...projectPromptCandidates(projectRoot, cwd, config, homes)];
  const out: PromptCandidate[] = [];
  for (const candidate of all) {
    try {
      const info = await stat(candidate.path);
      if (info.isFile()) out.push(candidate);
    } catch {
      /* absent */
    }
  }
  return out;
}

/**
 * 创建宿主集成句柄。
 *
 * @param ctx 插件宿主 ctx（用 `ctx.get("loader").import` 取宿主模块实例）
 * @returns 句柄；模块不可用时 `available()` 为 false，其余方法降级
 */
export function createPromptHost(ctx: { get?: (name: string) => unknown }): PromptHost {
  const loadModule = createModuleLoader(ctx);
  return {
    async available() {
      return (await loadModule()) !== undefined;
    },
    async discover({ cwd, projectRoot, homes, config }) {
      const mod = await loadModule();
      if (mod?.discoverBaselineInstructionFiles !== undefined) {
        try {
          const files = await mod.discoverBaselineInstructionFiles({
            cwd,
            projectRoot,
            dshHome: homes.dshHome,
            agentsHome: homes.agentsHome,
            projectRootMarkers: config.projectRootMarkers,
            instructionFileCandidates: config.instructionFileCandidates,
            localInstructionFileCandidates: config.localInstructionFileCandidates,
          });
          const originals = new Map(
            [...globalPromptCandidates(homes), ...projectPromptCandidates(projectRoot, cwd, config, homes)].map((c) => [
              c.path,
              c,
            ]),
          );
          const out: PromptCandidate[] = [];
          for (const file of files) {
            const known = originals.get(resolve(file.absolutePath));
            if (known !== undefined) out.push({ ...known, displayPath: file.displayPath });
            else
              out.push({
                id: resolve(file.absolutePath),
                path: resolve(file.absolutePath),
                displayPath: file.displayPath,
                directory: resolve(file.absolutePath, ".."),
                name: basename(file.absolutePath),
                scope: resolve(file.absolutePath).startsWith(resolve(homes.dshHome) + "/")
                  ? "user-global"
                  : resolve(file.absolutePath).startsWith(resolve(homes.agentsHome) + "/")
                    ? "agents-global"
                    : "project",
                kind: "base",
              });
          }
          return out;
        } catch {
          /* fall through to local enumeration */
        }
      }
      return fallbackDiscover(cwd, projectRoot, homes, config);
    },
    async render({ cwd, homes, config, replacePreviousBaseline }, allowed) {
      const mod = await loadModule();
      if (mod?.loadBaselineInstructions === undefined) return undefined;
      try {
        const rendered = await mod.loadBaselineInstructions(
          {
            cwd,
            projectRoot: config.projectRoot,
            dshHome: homes.dshHome,
            agentsHome: homes.agentsHome,
            projectRootMarkers: config.projectRootMarkers,
            instructionFileCandidates: config.instructionFileCandidates,
            localInstructionFileCandidates: config.localInstructionFileCandidates,
            maxBytes: config.maxBytes,
            maxSourceBytes: config.maxSourceBytes,
            ...(replacePreviousBaseline === true ? { replacePreviousBaseline: true } : {}),
          },
          createVirtualFileSystem(allowed),
        );
        if (rendered === undefined) return undefined;
        return {
          text: rendered.text,
          omitted: rendered.omitted ?? [],
          truncated: rendered.truncated ?? [],
        };
      } catch {
        return undefined;
      }
    },
  };
}

/** 解析 baselineIdentity（宿主注入消息里的权威渲染配置）。 */
export function parseBaselineIdentity(raw: unknown): PromptRenderConfig | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const markers = Array.isArray(parsed.projectRootMarkers)
      ? parsed.projectRootMarkers.filter((item): item is string => typeof item === "string")
      : undefined;
    const bases = Array.isArray(parsed.instructionFileCandidates)
      ? parsed.instructionFileCandidates.filter((item): item is string => typeof item === "string")
      : undefined;
    const locals = Array.isArray(parsed.localInstructionFileCandidates)
      ? parsed.localInstructionFileCandidates.filter((item): item is string => typeof item === "string")
      : undefined;
    if (typeof parsed.maxBytes !== "number" || parsed.maxBytes <= 0) return undefined;
    const fallback = defaultRenderConfig("");
    return {
      projectRoot: typeof parsed.projectRoot === "string" ? parsed.projectRoot : "",
      projectRootMarkers: markers ?? fallback.projectRootMarkers,
      instructionFileCandidates: bases ?? fallback.instructionFileCandidates,
      localInstructionFileCandidates: locals ?? fallback.localInstructionFileCandidates,
      maxBytes: parsed.maxBytes,
      maxSourceBytes: typeof parsed.maxSourceBytes === "number" ? parsed.maxSourceBytes : fallback.maxSourceBytes,
    };
  } catch {
    return undefined;
  }
}

/** 便捷：从配置 + 会话 cwd 还原绝对项目根。 */
export function absoluteProjectRoot(config: PromptRenderConfig, cwd: string): string {
  return config.projectRoot.length === 0 ? resolve(cwd) : resolve(cwd, config.projectRoot);
}

/** 便捷：全局候选文件的逻辑作用域键（`user-global` / `agents-global`）。 */
export function scopeKeyOf(candidate: Pick<PromptCandidate, "scope">): string {
  return candidate.scope === "project" ? "" : candidate.scope;
}

/** 便捷：判断路径是否为某个 home 下的全局 AGENTS.md。 */
export function isGlobalPromptPath(path: string, homes: PromptHomes): boolean {
  return resolve(path) === resolve(join(homes.dshHome, PROMPT_GLOBAL_FILE)) || resolve(path) === resolve(join(homes.agentsHome, PROMPT_GLOBAL_FILE));
}
