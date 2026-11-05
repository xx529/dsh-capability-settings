/**
 * Prompt 域宿主服务：策略层 + 面板/首屏/会话页的数据入口。
 *
 * 职责边界：
 *
 *   - **发现**：候选路径枚举（宿主 `discoverBaselineInstructionFiles`，失败时本地
 *     stat 枚举）；不做渲染；
 *   - **策略**：可见性（仅全局）/ 项目级默认 / 会话首屏显式选择 → 每个文件
 *     「是否传给 DSH」；全局与项目**叠加**（没有覆盖关系）；
 *   - **展示**：面板列表、详情读取、编辑保存、冻结清单读取；
 *   - **不实现**：拼接、去重、预算、framing —— 全部交给 `./host` 调用的宿主渲染器。
 *
 * @module dsh-capability-settings/prompt/manager
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { atomicWriteText } from "../shared/atomic-write.js";
import { errMessage } from "../shared/errors.js";
import {
  defaultRenderConfig,
  findInstructionProjectRoot,
  promptDataFile,
  resolvePromptHomes,
  type PromptCandidate,
  type PromptHomes,
  type PromptRenderConfig,
} from "./paths.js";
import { sha1Of, type PromptHost, type PromptRenderResult } from "./host.js";
import {
  fileStatSafe,
  readPromptManifest,
  readPromptPolicy,
  mutatePromptPolicy,
  writePromptManifest,
  type PromptPolicyFile,
} from "./store.js";
import type {
  PromptFileView,
  PromptListResult,
  PromptManifest,
  PromptManifestFile,
  PromptMutation,
  PromptReadResult,
  PromptScope,
  PromptState,
  PromptVisibility,
} from "./types.js";

/** 详情读取/编辑的大小上限（与 skills registry 同量级）。 */
export const PROMPT_READ_MAX_BYTES = 256 * 1024;

/** 保存内容的硬上限（宿主单文件上限 1 MiB）。 */
export const PROMPT_WRITE_MAX_BYTES = 1024 * 1024;

/** 一次选择的计算结果（策略层）。 */
export interface PromptSelection {
  homes: PromptHomes;
  projectRoot: string;
  cwd: string;
  config: PromptRenderConfig;
  candidates: PromptCandidate[];
  /** 允许传给 DSH 的文件绝对路径。 */
  allowed: Set<string>;
  /** 每个候选的有效启用态（用于列表）。 */
  views: Array<{
    candidate: PromptCandidate;
    visible: boolean;
    enabled: boolean;
    defaultEnabled: boolean;
    projectDefault?: boolean;
    sessionExplicit?: boolean;
    visibility?: { mode: PromptVisibility["mode"]; visible: boolean; defaultEnabled: boolean };
  }>;
  errors: string[];
}

/** 全局作用域键（策略里用的逻辑键，不随 DSH_HOME 变化）。 */
function visibilityKey(scope: PromptScope): string | undefined {
  if (scope === "user-global") return "user-global";
  if (scope === "agents-global") return "agents-global";
  return undefined;
}

/** 某工作区在一个全局 prompt 上的可见性/默认。 */
function visibilityFor(policy: PromptPolicyFile, scope: PromptScope, workspace: string): {
  visible: boolean;
  defaultEnabled: boolean;
  mode: PromptVisibility["mode"];
} {
  const key = visibilityKey(scope);
  const entry = key === undefined ? undefined : policy.visibility[key];
  const mode = entry?.mode ?? "all";
  const ws = entry?.workspaces?.[workspace];
  const visible = mode === "none" ? false : mode === "selected" ? ws?.visible === true : ws?.visible ?? true;
  const defaultEnabled = ws?.defaultEnabled ?? true;
  return { visible, defaultEnabled, mode };
}

/** 读取一个候选文件的展示信息。 */
async function viewOf(
  candidate: PromptCandidate,
  policy: PromptPolicyFile,
  projectRoot: string,
  sessionId: string | undefined,
): Promise<PromptFileView | undefined> {
  const info = await fileStatSafe(candidate.path);
  if (info === undefined) return undefined;
  const workspace = projectRoot;
  const global = visibilityKey(candidate.scope) !== undefined ? visibilityFor(policy, candidate.scope, workspace) : undefined;
  const projectDefault =
    candidate.scope === "project" ? policy.projects[projectRoot]?.defaults[candidate.id] : undefined;
  const sessionPolicy = sessionId === undefined ? undefined : policy.sessions[sessionId];
  const sessionExplicit = sessionPolicy === undefined ? undefined : sessionPolicy.selected.includes(candidate.id);
  const defaultEnabled = global !== undefined ? global.defaultEnabled : projectDefault ?? true;
  const visible = global !== undefined ? global.visible : true;
  const enabled = sessionPolicy !== undefined ? sessionExplicit === true : visible && defaultEnabled;
  const state: PromptState = !visible ? "invisible" : !enabled ? "disabled" : "injected";
  return {
    id: candidate.id,
    name: candidate.name,
    path: candidate.path,
    displayPath: candidate.displayPath,
    scope: candidate.scope,
    kind: candidate.kind,
    directory: candidate.directory,
    size: info.size,
    mtimeMs: info.mtimeMs,
    enabled,
    defaultEnabled,
    ...(projectDefault !== undefined ? { projectDefault } : {}),
    ...(sessionExplicit !== undefined ? { sessionExplicit } : {}),
    ...(global !== undefined ? { visibility: { mode: global.mode, visible: global.visible, defaultEnabled: global.defaultEnabled } } : {}),
    state,
  };
}

/** 服务依赖。 */
export interface PromptManagerDeps {
  ctx: { get?: (name: string) => unknown };
  host: PromptHost;
  dshHome?: string;
  agentsHome?: string;
  logger?: { warn?: (message: string) => void };
}

/** 面板/首屏/会话页共用的服务形状。 */
export interface PromptManager {
  /** 列表（策略层 + 冻结清单状态）。 */
  list(input: { cwd?: string; sessionId?: string }): Promise<PromptListResult>;
  /** 读取文件正文（只允许候选路径）。 */
  read(input: { path?: unknown; cwd?: unknown }): Promise<PromptReadResult | PromptMutation>;
  /** 保存文件正文（原子写；仅候选路径，≤ 1 MiB）。 */
  save(input: { path?: unknown; content?: unknown; cwd?: unknown }): Promise<PromptMutation>;
  /** 写全局可见性（整份替换该作用域）。 */
  setVisibility(input: { scope?: unknown; mode?: unknown; workspaces?: unknown }): Promise<PromptMutation>;
  /** 写项目级默认（enabled=null 表示删除覆盖、回到全局默认）。 */
  setProjectDefault(input: { cwd?: unknown; projectRoot?: unknown; path?: unknown; enabled?: unknown }): Promise<PromptMutation>;
  /** 写会话首屏显式选择（null/undefined = 清除，跟随默认层 = 全选）。 */
  setSessionSelection(input: { sessionId?: unknown; selected?: unknown; cwd?: unknown }): Promise<PromptMutation>;
  /** 读会话冻结清单。 */
  manifest(input: { sessionId?: unknown }): Promise<{ ok: true; manifest?: PromptManifest }>;
  /**
   * 计算一次选择（注入层用；可注入宿主 baselineIdentity 提供的配置）。
   *
   * @param options cwd / sessionId / 渲染配置（缺省用默认）
   * @returns 选择结果（allowed 集合 + 每项视图）
   */
  select(options: {
    cwd: string;
    sessionId?: string;
    config?: PromptRenderConfig;
  }): Promise<PromptSelection>;
  /**
   * 用宿主渲染器渲染允许集合（注入层用）。
   *
   * @param selection `select()` 的结果
   * @param options replacePreviousBaseline 透传
   * @returns 宿主渲染结果或 undefined（宿主管线不可用 / 无内容）
   */
  render(selection: PromptSelection, options?: { replacePreviousBaseline?: boolean }): Promise<PromptRenderResult | undefined>;
  /** 写冻结清单（注入层首轮一次）。 */
  recordManifest(selection: PromptSelection, rendered: PromptRenderResult | undefined, sessionId: string): Promise<PromptManifest>;
  /** 宿主渲染管线是否可用（面板/首屏的降级提示）。 */
  hostAvailable(): Promise<boolean>;
}

/** 读取当前策略（供 host/inject 共用）。 */
export async function readPolicy(dshHome?: string): Promise<{ policy: PromptPolicyFile; errors: string[] }> {
  return readPromptPolicy(dshHome);
}

/**
 * 创建 Prompt 域服务。
 *
 * @param deps 依赖（ctx / host / home 覆盖）
 * @returns 服务实例
 */
export function createPromptManager(deps: PromptManagerDeps): PromptManager {
  const logger = deps.logger;
  const homes = () => resolvePromptHomes(deps.dshHome, deps.agentsHome);

  const select = async (options: {
    cwd: string;
    sessionId?: string;
    config?: PromptRenderConfig;
    policy?: PromptPolicyFile;
  }): Promise<PromptSelection> => {
    const cwd = resolve(options.cwd);
    const resolvedHomes = homes();
    const { policy } = options.policy !== undefined ? { policy: options.policy } : await readPolicy(deps.dshHome);
    const baseConfig = options.config ?? defaultRenderConfig("");
    const projectRoot =
      baseConfig.projectRoot.length > 0
        ? absolute(baseConfig.projectRoot, cwd)
        : await findInstructionProjectRoot(cwd, baseConfig.projectRootMarkers);
    const config: PromptRenderConfig = { ...baseConfig, projectRoot };
    const errors: string[] = [];
    let candidates: PromptCandidate[] = [];
    try {
      candidates = await deps.host.discover({ cwd, projectRoot, homes: resolvedHomes, config });
    } catch (error) {
      errors.push(errMessage(error));
    }
    const views: PromptSelection["views"] = [];
    const allowed = new Set<string>();
    for (const candidate of candidates) {
      const view = await viewOf(candidate, policy, projectRoot, options.sessionId);
      if (view === undefined) continue;
      views.push({
        candidate,
        visible: view.state !== "invisible",
        enabled: view.enabled,
        defaultEnabled: view.defaultEnabled,
        ...(view.projectDefault !== undefined ? { projectDefault: view.projectDefault } : {}),
        ...(view.sessionExplicit !== undefined ? { sessionExplicit: view.sessionExplicit } : {}),
        ...(view.visibility !== undefined ? { visibility: view.visibility } : {}),
      });
      if (view.state !== "invisible" && view.enabled) allowed.add(candidate.id);
    }
    return { homes: resolvedHomes, projectRoot, cwd, config, candidates, allowed, views, errors };
  };

  const selectionForList = async (cwd: string, sessionId?: string): Promise<PromptSelection> =>
    select({ cwd, ...(sessionId !== undefined ? { sessionId } : {}) });

  const withManifestStates = (
    views: PromptFileView[],
    manifest: PromptManifest | undefined,
    manifestBudget: { maxSourceBytes: number },
  ): PromptFileView[] => {
    if (manifest === undefined) return views;
    const byPath = new Map(manifest.files.map((file) => [file.id, file]));
    const omitted = new Set(manifest.omitted.map((item) => item.displayPath));
    const truncated = new Map(manifest.truncated.map((item) => [item.displayPath, item]));
    return views.map((view) => {
      if (view.enabled === false) return view;
      const included = byPath.get(view.id);
      if (included !== undefined) {
        return {
          ...view,
          order: included.order,
          state: truncated.has(view.displayPath) ? "truncated" : "injected",
        };
      }
      if (omitted.has(view.displayPath)) return { ...view, state: "omitted" };
      if (view.size > (manifestBudget.maxSourceBytes ?? 1048576)) return { ...view, state: "too-large" };
      // 宿主没把它放进 included/omitted/truncated = 同候选组内容重复被去重。
      return { ...view, state: "duplicate" };
    });
  };

  return {
    async list({ cwd, sessionId }) {
      const selection = await selectionForList(cwd ?? process.cwd(), sessionId);
      const { policy, errors: policyErrors } = await readPolicy(deps.dshHome);
      const views: PromptFileView[] = [];
      for (const item of selection.views) {
        const view = await viewOf(item.candidate, policy, selection.projectRoot, sessionId);
        if (view !== undefined) views.push(view);
      }
      const frozen = sessionId === undefined ? undefined : await readPromptManifest(sessionId, deps.dshHome);
      const sessionPolicy = sessionId === undefined ? undefined : policy.sessions[sessionId];
      return {
        files: withManifestStates(views, frozen, selection.config),
        cwd: selection.cwd,
        projectRoot: selection.projectRoot,
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(sessionPolicy !== undefined ? { sessionSelected: sessionPolicy.selected } : {}),
        ...(frozen !== undefined ? { frozen } : {}),
        budget: { maxBytes: selection.config.maxBytes, maxSourceBytes: selection.config.maxSourceBytes },
        engineAvailable: await deps.host.available(),
        visibility: policy.visibility,
        errors: [...selection.errors, ...policyErrors],
      };
    },

    async read({ path, cwd }) {
      if (typeof path !== "string" || path.trim().length === 0) return { ok: false, errors: ["path is required"], code: "unknown-file" };
      const discoveryCwd = typeof cwd === "string" && cwd.length > 0 ? cwd : dirname(resolve(path));
      const selection = await selectionForList(discoveryCwd);
      const candidate = selection.candidates.find((item) => resolve(item.path) === resolve(path));
      if (candidate === undefined) return { ok: false, errors: ["不是已识别的 prompt 文件"], code: "unknown-file" };
      const info = await fileStatSafe(candidate.path);
      if (info === undefined) return { ok: false, errors: ["文件不存在或不可读"], code: "unknown-file" };
      if (info.size > PROMPT_READ_MAX_BYTES) {
        return { ok: false, errors: [`文件超过 ${PROMPT_READ_MAX_BYTES} 字节，暂不支持预览/编辑`], code: "too-large" };
      }
      try {
        const content = await readFile(candidate.path, "utf8");
        const truncated = content.length > PROMPT_READ_MAX_BYTES;
        return {
          ok: true,
          id: candidate.id,
          path: candidate.path,
          size: info.size,
          content: content.slice(0, PROMPT_READ_MAX_BYTES),
          truncated,
        };
      } catch (error) {
        return { ok: false, errors: [errMessage(error)], code: "not-text" };
      }
    },

    async save({ path, content, cwd }) {
      if (typeof path !== "string" || path.trim().length === 0) return { ok: false, errors: ["path is required"], code: "unknown-file" };
      if (typeof content !== "string") return { ok: false, errors: ["content is required"] };
      if (Buffer.byteLength(content, "utf8") > PROMPT_WRITE_MAX_BYTES) {
        return { ok: false, errors: ["内容超过 1 MiB 上限"], code: "too-large" };
      }
      const discoveryCwd = typeof cwd === "string" && cwd.length > 0 ? cwd : dirname(resolve(path));
      const selection = await selectionForList(discoveryCwd);
      const candidate = selection.candidates.find((item) => resolve(item.path) === resolve(path));
      if (candidate === undefined) return { ok: false, errors: ["不是已识别的 prompt 文件"], code: "unknown-file" };
      try {
        await atomicWriteText(candidate.path, content, "prompt");
        return { ok: true };
      } catch (error) {
        return { ok: false, errors: [errMessage(error)], code: "write-failed" };
      }
    },

    async setVisibility({ scope, mode, workspaces }) {
      if (scope !== "user-global" && scope !== "agents-global") {
        return { ok: false, errors: ["scope must be user-global | agents-global"] };
      }
      if (mode !== "all" && mode !== "selected" && mode !== "none") {
        return { ok: false, errors: ["mode must be all | selected | none"] };
      }
      const map: PromptVisibility["workspaces"] = {};
      if (workspaces !== null && typeof workspaces === "object" && !Array.isArray(workspaces)) {
        for (const [key, value] of Object.entries(workspaces as Record<string, unknown>)) {
          if (value === null || typeof value !== "object") continue;
          const entry = value as Record<string, unknown>;
          map[key] = {
            ...(typeof entry.visible === "boolean" ? { visible: entry.visible } : {}),
            ...(typeof entry.defaultEnabled === "boolean" ? { defaultEnabled: entry.defaultEnabled } : {}),
          };
        }
      }
      await mutatePromptPolicy((policy) => {
        policy.visibility[scope] = { mode, workspaces: map };
        return policy;
      }, deps.dshHome);
      return { ok: true };
    },

    async setProjectDefault({ cwd, projectRoot, path, enabled }) {
      if (typeof path !== "string" || path.trim().length === 0) return { ok: false, errors: ["path is required"], code: "unknown-file" };
      if (enabled !== null && enabled !== undefined && typeof enabled !== "boolean") {
        return { ok: false, errors: ["enabled must be boolean | null"] };
      }
      const root =
        typeof projectRoot === "string" && projectRoot.length > 0
          ? resolve(projectRoot)
          : await findInstructionProjectRoot(typeof cwd === "string" && cwd.length > 0 ? cwd : process.cwd());
      await mutatePromptPolicy((policy) => {
        const entry = (policy.projects[root] ??= { defaults: {} });
        if (enabled === null || enabled === undefined) delete entry.defaults[resolve(path)];
        else entry.defaults[resolve(path)] = enabled;
        entry.updatedAt = Date.now();
        entry.cwd = typeof cwd === "string" ? resolve(cwd) : undefined;
        if (Object.keys(entry.defaults).length === 0) delete policy.projects[root];
        return policy;
      }, deps.dshHome);
      return { ok: true };
    },

    async setSessionSelection({ sessionId, selected, cwd }) {
      const sid = typeof sessionId === "string" ? sessionId.trim() : "";
      if (sid.length === 0) return { ok: false, errors: ["sessionId is required"] };
      if (selected !== null && selected !== undefined && (!Array.isArray(selected) || selected.some((item) => typeof item !== "string"))) {
        return { ok: false, errors: ["selected must be string[] | null"] };
      }
      await mutatePromptPolicy((policy) => {
        if (selected === null || selected === undefined) {
          delete policy.sessions[sid];
        } else {
          policy.sessions[sid] = {
            selected: [...new Set((selected as string[]).map((item) => resolve(item)))],
            updatedAt: Date.now(),
            ...(typeof cwd === "string" ? { cwd: resolve(cwd) } : {}),
          };
        }
        return policy;
      }, deps.dshHome);
      return { ok: true };
    },

    async manifest({ sessionId }) {
      const sid = typeof sessionId === "string" ? sessionId.trim() : "";
      if (sid.length === 0) return { ok: true };
      const manifest = await readPromptManifest(sid, deps.dshHome);
      return { ok: true, ...(manifest !== undefined ? { manifest } : {}) };
    },

    select,

    async render(selection, options) {
      return deps.host.render(
        {
          cwd: selection.cwd,
          homes: selection.homes,
          config: selection.config,
          ...(options?.replacePreviousBaseline === true ? { replacePreviousBaseline: true } : {}),
        },
        selection.allowed,
      );
    },

    async recordManifest(selection, rendered, sessionId) {
      const files: PromptManifestFile[] = [];
      let order = 1;
      for (const candidate of selection.candidates) {
        if (!selection.allowed.has(candidate.id)) continue;
        const text = await readFileSafeText(candidate.path);
        if (text === undefined) continue;
        const info = await fileStatSafe(candidate.path);
        files.push({
          id: candidate.id,
          path: candidate.path,
          displayPath: candidate.displayPath,
          scope: candidate.scope,
          order: order++,
          bytes: info?.size ?? Buffer.byteLength(text, "utf8"),
          digest: sha1Of(text),
        });
      }
      const manifest: PromptManifest = {
        sessionId,
        cwd: selection.cwd,
        at: Date.now(),
        renderer: "host",
        files,
        omitted: rendered?.omitted ?? [],
        truncated: rendered?.truncated ?? [],
        ...(rendered?.text !== undefined ? { text: rendered.text } : {}),
      };
      await writePromptManifest(manifest, deps.dshHome);
      return manifest;
    },

    async hostAvailable() {
      try {
        return await deps.host.available();
      } catch {
        return false;
      }
    },
  };
}

/** 绝对项目根（相对路径按 cwd 解析）。 */
function absolute(projectRoot: string, cwd: string): string {
  return resolve(cwd, projectRoot);
}

/** 读取文本（失败 undefined；与 store.readFileSafe 同义，避免循环依赖）。 */
async function readFileSafeText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** 数据文件路径（面板展示用）。 */
export function promptDataPaths(dshHome?: string): { policy: string; manifests: string } {
  return { policy: promptDataFile(join("prompt-policy.json"), dshHome), manifests: promptDataFile(join("prompt-manifests.json"), dshHome) };
}

