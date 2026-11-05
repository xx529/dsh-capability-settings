/**
 * Prompt 域的两个持久化文件（都在 `<dshHome>/dsh-capability-settings/`，0600）：
 *
 *   1. `prompt-policy.json` —— 策略层：
 *      - `visibility`：全局 prompt（`user-global` / `agents-global`）的可见范围与
 *        每工作区默认；
 *      - `projects`：按**项目根**记录每个文件的「本项目默认启停」；
 *      - `sessions`：会话首屏的显式选择（未设置 = 跟随默认层 = 全选）。
 *   2. `prompt-manifests.json` —— 会话冻结清单（会话开始后只读，面板/会话页的
 *      权威来源）；会话首轮注入时写入一次，之后不再变化。
 *
 * 写入统一走 `atomicWriteText` + `withFileLock`；读取损坏时降级为空策略并回收
 * 可读错误（不拖垮面板）。
 *
 * @module dsh-capability-settings/prompt/store
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

import { atomicWriteText } from "../shared/atomic-write.js";
import { withFileLock } from "../shared/file-lock.js";
import { errMessage } from "../shared/errors.js";
import { readJsonDocument } from "../shared/json-config.js";
import { PROMPT_DATA_DIR_NAME, PROMPT_MANIFESTS_FILE_NAME, PROMPT_POLICY_FILE_NAME } from "./paths.js";
import type { PromptManifest, PromptVisibility } from "./types.js";

/** 策略文件里的项目级默认集合。 */
export interface PromptProjectPolicy {
  /** 文件绝对路径 → 本项目默认启用。 */
  defaults: Record<string, boolean>;
  updatedAt?: number;
  cwd?: string;
}

/** 策略文件里的会话显式选择。 */
export interface PromptSessionPolicy {
  /** 显式选中的文件绝对路径（按会话；缺省 = 跟随默认层）。 */
  selected: string[];
  updatedAt?: number;
  cwd?: string;
}

/** `prompt-policy.json` 的磁盘形状。 */
export interface PromptPolicyFile {
  version: 1;
  /** 全局逻辑作用域 → 可见性（逻辑键，不随 DSH_HOME 变化）。 */
  visibility: Record<string, PromptVisibility>;
  /** 项目根绝对路径 → 项目级默认。 */
  projects: Record<string, PromptProjectPolicy>;
  /** sessionId → 显式选择。 */
  sessions: Record<string, PromptSessionPolicy>;
}

/** 读取策略的结果（坏数据降级 + errors）。 */
export interface PromptPolicyReadResult {
  policy: PromptPolicyFile;
  errors: string[];
}

/** 空策略。 */
export function emptyPromptPolicy(): PromptPolicyFile {
  return { version: 1, visibility: {}, projects: {}, sessions: {} };
}

/** 策略文件绝对路径。 */
export function promptPolicyFile(dshHome?: string): string {
  return join(resolveDshHome(dshHome), PROMPT_DATA_DIR_NAME, PROMPT_POLICY_FILE_NAME);
}

/** 冻结清单文件绝对路径。 */
export function promptManifestsFile(dshHome?: string): string {
  return join(resolveDshHome(dshHome), PROMPT_DATA_DIR_NAME, PROMPT_MANIFESTS_FILE_NAME);
}

/** 宽松校验：非对象/坏值一律丢弃并记 errors（读路径绝不抛）。 */
function normalizePolicy(raw: Record<string, unknown>, errors: string[]): PromptPolicyFile {
  const policy = emptyPromptPolicy();
  const visibility = raw.visibility;
  if (visibility !== undefined) {
    if (visibility !== null && typeof visibility === "object" && !Array.isArray(visibility)) {
      for (const [scope, value] of Object.entries(visibility as Record<string, unknown>)) {
        const v = value as Record<string, unknown> | null;
        if (v === null || typeof v !== "object") {
          errors.push(`prompt-policy: visibility.${scope} 不是对象，已忽略`);
          continue;
        }
        const mode = v.mode;
        if (mode !== "all" && mode !== "selected" && mode !== "none") {
          errors.push(`prompt-policy: visibility.${scope}.mode 非法，按 all 降级`);
        }
        const workspaces: PromptVisibility["workspaces"] = {};
        if (v.workspaces !== null && typeof v.workspaces === "object" && !Array.isArray(v.workspaces)) {
          for (const [ws, entry] of Object.entries(v.workspaces as Record<string, unknown>)) {
            if (entry === null || typeof entry !== "object") continue;
            const e = entry as Record<string, unknown>;
            workspaces[ws] = {
              ...(typeof e.visible === "boolean" ? { visible: e.visible } : {}),
              ...(typeof e.defaultEnabled === "boolean" ? { defaultEnabled: e.defaultEnabled } : {}),
            };
          }
        }
        policy.visibility[scope] = { mode: mode === "selected" || mode === "none" ? mode : "all", workspaces };
      }
    } else {
      errors.push("prompt-policy: visibility 不是对象，已忽略");
    }
  }
  const readBooleanMap = (value: unknown, label: string): Record<string, boolean> => {
    const out: Record<string, boolean> = {};
    if (value === undefined) return out;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`prompt-policy: ${label} 不是对象，已忽略`);
      return out;
    }
    for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
      if (typeof flag === "boolean") out[key] = flag;
    }
    return out;
  };
  const projects = raw.projects;
  if (projects !== null && typeof projects === "object" && !Array.isArray(projects)) {
    for (const [root, value] of Object.entries(projects as Record<string, unknown>)) {
      if (value === null || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      policy.projects[root] = {
        defaults: readBooleanMap(v.defaults, `projects[${root}].defaults`),
        ...(typeof v.updatedAt === "number" ? { updatedAt: v.updatedAt } : {}),
        ...(typeof v.cwd === "string" ? { cwd: v.cwd } : {}),
      };
    }
  }
  const sessions = raw.sessions;
  if (sessions !== null && typeof sessions === "object" && !Array.isArray(sessions)) {
    for (const [sid, value] of Object.entries(sessions as Record<string, unknown>)) {
      if (value === null || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      if (!Array.isArray(v.selected) || v.selected.some((item) => typeof item !== "string")) continue;
      policy.sessions[sid] = {
        selected: [...new Set((v.selected as string[]).map((item) => item.trim()).filter((item) => item.length > 0))],
        ...(typeof v.updatedAt === "number" ? { updatedAt: v.updatedAt } : {}),
        ...(typeof v.cwd === "string" ? { cwd: v.cwd } : {}),
      };
    }
  }
  return policy;
}

/**
 * 读取策略文件（宽容：缺失/损坏 → 空策略 + errors）。
 *
 * @param dshHome 覆盖（缺省解析）
 * @returns 规范化策略 + 可读错误
 */
export async function readPromptPolicy(dshHome?: string): Promise<PromptPolicyReadResult> {
  const file = promptPolicyFile(dshHome);
  const errors: string[] = [];
  try {
    const raw = await readJsonDocument(file, "prompt policy");
    if (raw === undefined) return { policy: emptyPromptPolicy(), errors };
    return { policy: normalizePolicy(raw, errors), errors };
  } catch (error) {
    errors.push(errMessage(error));
    return { policy: emptyPromptPolicy(), errors };
  }
}

/**
 * 读-改-写策略文件（进程内按文件串行）。
 *
 * @param mutate 修改函数（可原地修改并返回新策略）
 * @param dshHome 覆盖
 * @returns 写入后的策略
 */
export async function mutatePromptPolicy(
  mutate: (policy: PromptPolicyFile) => PromptPolicyFile | void,
  dshHome?: string,
): Promise<PromptPolicyFile> {
  const file = promptPolicyFile(dshHome);
  return withFileLock(file, async () => {
    const { policy } = await readPromptPolicy(dshHome);
    const next = mutate(policy) ?? policy;
    await atomicWriteText(file, `${JSON.stringify(next, null, 2)}\n`, "prompt-policy", { mode: 0o600 });
    return next;
  });
}

/** 冻结清单文件的磁盘形状。 */
interface ManifestsFile {
  version: 1;
  sessions: Record<string, PromptManifest>;
}

/**
 * 读取某会话的冻结清单。
 *
 * @param sessionId 会话 id
 * @param dshHome 覆盖
 * @returns 清单或 undefined
 */
export async function readPromptManifest(sessionId: string, dshHome?: string): Promise<PromptManifest | undefined> {
  const file = promptManifestsFile(dshHome);
  try {
    const raw = await readJsonDocument(file, "prompt manifests");
    if (raw === undefined) return undefined;
    const sessions = raw.sessions;
    if (sessions === null || typeof sessions !== "object" || Array.isArray(sessions)) return undefined;
    const entry = (sessions as Record<string, unknown>)[sessionId];
    if (entry === null || typeof entry !== "object") return undefined;
    const m = entry as Record<string, unknown>;
    if (typeof m.at !== "number" || !Array.isArray(m.files)) return undefined;
    return {
      sessionId,
      cwd: typeof m.cwd === "string" ? m.cwd : "",
      at: m.at,
      renderer: "host",
      files: m.files
        .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
        .map((item, index) => ({
          id: typeof item.id === "string" ? item.id : "",
          path: typeof item.path === "string" ? item.path : "",
          displayPath: typeof item.displayPath === "string" ? item.displayPath : "",
          scope: item.scope === "user-global" || item.scope === "agents-global" ? item.scope : "project",
          order: typeof item.order === "number" ? item.order : index + 1,
          bytes: typeof item.bytes === "number" ? item.bytes : 0,
          digest: typeof item.digest === "string" ? item.digest : "",
        })),
      omitted: Array.isArray(m.omitted)
        ? m.omitted
            .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
            .map((item) => ({ displayPath: typeof item.displayPath === "string" ? item.displayPath : "" }))
        : [],
      truncated: Array.isArray(m.truncated)
        ? m.truncated
            .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
            .map((item) => ({
              displayPath: typeof item.displayPath === "string" ? item.displayPath : "",
              originalBytes: typeof item.originalBytes === "number" ? item.originalBytes : 0,
              includedBytes: typeof item.includedBytes === "number" ? item.includedBytes : 0,
            }))
        : [],
      ...(typeof m.text === "string" ? { text: m.text } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * 写入/覆盖某会话冻结清单（会话首轮注入时一次）。
 *
 * @param manifest 冻结清单
 * @param dshHome 覆盖
 */
export async function writePromptManifest(manifest: PromptManifest, dshHome?: string): Promise<void> {
  const file = promptManifestsFile(dshHome);
  await withFileLock(file, async () => {
    let current: ManifestsFile = { version: 1, sessions: {} };
    try {
      const raw = await readJsonDocument(file, "prompt manifests");
      if (raw !== undefined && raw.sessions !== null && typeof raw.sessions === "object" && !Array.isArray(raw.sessions)) {
        current = { version: 1, sessions: raw.sessions as Record<string, PromptManifest> };
      }
    } catch {
      current = { version: 1, sessions: {} };
    }
    current.sessions[manifest.sessionId] = manifest;
    await atomicWriteText(file, `${JSON.stringify(current, null, 2)}\n`, "prompt-manifests", { mode: 0o600 });
  });
}

/** 读取文件的 `{size, mtimeMs, digest?}`；失败返回 undefined。 */
export async function fileStatSafe(path: string): Promise<{ size: number; mtimeMs: number } | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return undefined;
    return { size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return undefined;
  }
}

/** 读取整个文件（UTF-8）；失败返回 undefined。 */
export async function readFileSafe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}
