/**
 * 传输无关的 skills 域服务（挂载为 `ctx.capabilityPanel.skills`）。
 *
 * 读取直接走**受管磁盘视图**（项目 + 全局根目录，直接读盘以拿到
 * path/format/readOnly 等管理列表需要的信息；`.agents` 为写入目标根，
 * `.dsh` 为旧位置兼容根，`.claude` 为只读兼容根）。
 *
 * 写入一律经由 `crud.ts`，落在由 `roots.ts` 从工作区解析出来的具体根目录上。
 * 启停与调用方向只写 frontmatter 的扁平调用键（`disable-model-invocation` /
 * `user-invocable`）——宿主的目录注入 / `skill` 工具 / `/name` 注入三条
 * 链路都原生读这两个键（文件 watcher 使改动下一步即生效），本插件不维护
 * 任何平行的禁用状态。
 *
 * @module dsh-capability-settings/skills/manager
 */

import { findProjectRoot } from "../shared/project-root.js";
import { atomicWriteText } from "../shared/atomic-write.js";
import { isGlobalSkillSource, isProjectSkillSource } from "../shared/skill-sources.js";
import { globalSkillsDir, projectSkillsDir, userAgentsSkillsDir, userClaudeSkillsDir } from "./roots.js";
import { detectFormat, readSkill, resourceDirectory, skillFilePath } from "./disk.js";
import { cloneSkill, createSkill, updateSkill, removeSkill, setSkillEnabled, setSkillInvocation, readSkillDetail, listSkillEntries } from "./crud.js";
import type { ReadResult } from "./crud.js";
import { installFromUrl } from "./download.js";
import { exportSkillFiles, exportToPath, installFromFiles, installFromPath } from "./transfer.js";
import type { TransferFile, TransferResult } from "./transfer.js";
import { createShadowStub, isShadowStubSpec, removeShadowStub } from "./shadow.js";
import { invocationPolicy } from "./types.js";
import type { InvocationPolicy, SkillFormat, SkillSummaryView, WritableScope } from "./types.js";
import { isSkillName } from "./validate.js";
import { stat, rm } from "node:fs/promises";
import { join } from "node:path";
import type { SkillRegistryBridge } from "./registry.js";

/** 服务的构造依赖（用于覆盖默认目录解析）。 */
export interface ManagerDeps {
  dshHome?: string;
  agentsHome?: string;
  /**
   * 宿主技能注册表桥（见 `skills/registry.ts`）：提供注入技能的详情/资源/
   * 导出 fallback，以及写操作对注入行的 `read-only` 拦截。缺省时行为与旧版
   * 完全一致（纯磁盘）。
   */
  registry?: SkillRegistryBridge;
}

/** 写操作失败（业务信封里的失败支；`code` 供客户端区分降级原因）。 */
export interface SkillWriteFailure {
  ok: false;
  errors: string[];
  code?: string;
}

/** 一个受管 skill 根及其来源分类（claude 系为只读兼容根）。 */
export interface ManagedRoot {
  source: "user-dsh" | "user-agents" | "project-dsh" | "project-agents" | "user-claude" | "project-claude";
  path: string;
}

/**
 * 去掉解析到同一物理目录的重复根（Windows 上按大小写不敏感比较）。
 *
 * 当项目根本身就是 dsh home 的父目录时（例如 cwd == home），`.dsh/skills`
 * 与全局根会是同一目录，此时保留先出现的条目——即项目分类优先。
 */
function dedupeRoots(roots: ManagedRoot[]): ManagedRoot[] {
  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = root.path.replace(/[/\\]+$/, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 收集一个工作区（项目 + 全局）的所有受管根目录（.dsh/.agents/.claude）。 */
function managedRoots(cwd: string | undefined, deps: ManagerDeps = {}): ManagedRoot[] {
  const roots: ManagedRoot[] = [];
  if (cwd !== undefined) {
    const projectRoot = findProjectRoot(cwd);
    roots.push(
      { source: "project-dsh", path: projectSkillsDir(cwd, ".dsh", projectRoot) },
      { source: "project-agents", path: projectSkillsDir(cwd, ".agents", projectRoot) },
      { source: "project-claude", path: projectSkillsDir(cwd, ".claude", projectRoot) },
    );
  }
  roots.push(
    { source: "user-dsh", path: globalSkillsDir(deps.dshHome) },
    { source: "user-agents", path: userAgentsSkillsDir(deps.agentsHome) },
    { source: "user-claude", path: userClaudeSkillsDir() },
  );
  return roots;
}

/**
 * source 是否属于"全局系"（可用于按作用域归类列表）。
 * 分类清单的单一事实源在 shared/skill-sources.ts（与客户端共用）。
 */
export function isGlobalSource(source: SkillSummaryView["source"]): boolean {
  return isGlobalSkillSource(source);
}

/** claude 系来源是只读兼容根（面板展示但不可写回）。 */
function isReadOnlySource(source: SkillSummaryView["source"]): boolean {
  return source === "project-claude" || source === "user-claude";
}

/**
 * 构建 `ctx.capabilityPanel.skills` 服务。
 *
 * 读取直接走**受管磁盘视图**；宿主 registry 的注入条目由 `registry.ts` 桥
 * 在上层（`index.ts` 组装）合并进 `list` / `sessionList`，本模块只在
 * 详情/资源/导出与写操作入口使用它（避免磁盘写路径被注入条目污染）。
 *
 * @param ctx 宿主上下文
 * @param config dshHome / agentsHome 覆盖 + registry 桥
 */
export function createService(ctx: any, config: ManagerDeps = {}) {
  const deps: ManagerDeps = { dshHome: config.dshHome, agentsHome: config.agentsHome };
  const registry = config.registry;

  /**
   * 面板受管根目录的只读磁盘视图（按名称排序；稳定排序保持同名条目的
   * 优先级：项目根在前、全局根在后）。
   */
  async function list(cwd?: string): Promise<SkillSummaryView[]> {
    const roots = dedupeRoots(managedRoots(cwd, deps));
    // 每个根目录内的读取并行（一次 readdir 拿名称+布局，再并发读文件），
    // 根与根之间串行即可：目录总量小，避免一次性打开过多文件句柄。
    const views: SkillSummaryView[] = [];
    for (const root of roots) {
      const entries = await listSkillEntries(root.path);
      const readOnly = isReadOnlySource(root.source);
      const loaded = await Promise.all(
        entries.map(async ({ name, format }) => {
          const parsed = await readSkill(root.path, name, format);
          if (parsed === undefined) return undefined;
          return summaryView({
            name: parsed.spec.name,
            description: parsed.spec.description,
            whenToUse: parsed.spec.whenToUse,
            invocation: invocationPolicy(parsed.spec.invocation),
            source: root.source,
            format,
            readOnly,
            filePath: skillFilePath(root.path, name, format),
            resourceDirectory: format === "directory" ? resourceDirectory(root.path, name) : undefined,
            root: root.path,
            shadowStub: isShadowStubSpec(parsed.spec),
          });
        }),
      );
      for (const view of loaded) {
        if (view !== undefined) views.push(view);
      }
    }
    annotateProjectShadow(views);
    return views.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 从作用域 + 工作区解析一个具体的根目录供宿主侧写入：
   * global 固定用 `~/.agents/skills`（user-agents，首选）；project 需要 cwd，
   * 缺省目标子目录为 .agents。
   */
  function resolveRoot(scope: WritableScope, cwd: string | undefined, target: ".dsh" | ".agents" | undefined): string {
    if (scope === "global") return userAgentsSkillsDir(deps.agentsHome);
    if (cwd === undefined) throw new Error("project scope requires a workspace path");
    return projectSkillsDir(cwd, target ?? ".agents");
  }

  /**
   * 写操作对「注入条目」的拦截（架构契约 §7.4）：注入技能没有可写磁盘文件，
   * 只能在本项目/本会话启停。判据必须**重新查宿主 registry**（不能只信客户端
   * 传的字段）；同名磁盘条目在受管根里存在时按原逻辑放行。
   *
   * registry 不可用（未装配 / 服务缺失）时降级为不拦截，保持旧行为。
   */
  async function rejectInjectedWrite(input: {
    name?: unknown;
    cwd?: string;
    sessionId?: string;
  }): Promise<SkillWriteFailure | undefined> {
    if (registry === undefined) return undefined;
    const name = typeof input.name === "string" ? input.name : "";
    if (!isSkillName(name)) return undefined;
    // 受管磁盘根里已有的名字一律交给原写路径（其自身会做存在性/冲突校验）。
    const onDisk = await list(input.cwd);
    if (onDisk.some((row) => row.name === name)) return undefined;
    // registry 自身异常时降级为「不拦截」，磁盘写路径不受影响。
    let verdict: Awaited<ReturnType<SkillRegistryBridge["inspectName"]>>;
    try {
      verdict = await registry.inspectName(name, { cwd: input.cwd, sessionId: input.sessionId });
    } catch {
      return undefined;
    }
    if (verdict === undefined) return undefined;
    if (verdict.kind === "disk-root") {
      return {
        ok: false,
        errors: [`技能 "${name}" 由宿主的其它技能目录提供，不在本面板管理范围内，内容只读`],
        code: "read-only",
      };
    }
    return {
      ok: false,
      errors: [`注入技能 "${name}" 内容只读，只能在本项目/本会话启停`],
      code: "read-only",
    };
  }

  /** 从 create 入参里取出技能名（名称在 spec 里，用于写拦截）。 */
  function nameOfCreateSpec(spec: unknown): unknown {
    if (spec === null || typeof spec !== "object") return undefined;
    return (spec as Record<string, unknown>).name;
  }

  /**
   * 注入行导出到宿主目录：写单个 `<destDir>/<name>.md`（正文快照，不复制资源）。
   * 覆盖语义与 `exportToPath` 一致（已存在且未要求覆盖时报错）。
   */
  async function writeExportSnapshot(input: {
    name: string;
    destDir: string;
    overwrite?: boolean;
    snapshot: TransferResult;
  }): Promise<TransferResult> {
    const target = join(input.destDir, `${input.name}.md`);
    let existing: Awaited<ReturnType<typeof stat>> | undefined;
    try {
      existing = await stat(target);
    } catch {
      existing = undefined;
    }
    if (existing !== undefined) {
      if (input.overwrite !== true) {
        return { ok: false, errors: [`"${target}" already exists`], name: input.name, existed: true };
      }
      if (existing.isDirectory()) await rm(target, { recursive: true, force: true });
    }
    const files = input.snapshot.files ?? [];
    if (files.length === 0) return { ok: false, errors: [`skill "${input.name}" has no content`] };
    const text = Buffer.from(files[0].content, "base64").toString("utf8");
    await atomicWriteText(target, text, "skill");
    return { ...input.snapshot, path: target, format: "flat" };
  }

  return {
    list,
    /** 创建 skill（scope / target / cwd 未给时按 project + .agents 解析根）。 */
    async create(input: { root?: string; scope?: WritableScope; target?: ".dsh" | ".agents"; cwd?: string; sessionId?: string; format: SkillFormat; spec: unknown; body: string; overwrite?: boolean }) {
      const blocked = await rejectInjectedWrite({ name: nameOfCreateSpec(input.spec), cwd: input.cwd, sessionId: input.sessionId });
      if (blocked !== undefined) return blocked;
      const root = input.root ?? resolveRoot(input.scope ?? "project", input.cwd, input.target);
      return createSkill({ root, format: input.format, spec: input.spec as never, body: input.body, overwrite: input.overwrite });
    },
    /** 更新 skill（scope 缺省按 global 解析根）。 */
    async update(input: { root?: string; scope?: WritableScope; target?: ".dsh" | ".agents"; cwd?: string; sessionId?: string; name: string; spec: unknown; body: string }) {
      const blocked = await rejectInjectedWrite({ name: input.name, cwd: input.cwd, sessionId: input.sessionId });
      if (blocked !== undefined) return blocked;
      const root = input.root ?? resolveRoot(input.scope ?? "global", input.cwd, input.target);
      return updateSkill({ root, name: input.name, spec: input.spec as never, body: input.body });
    },
    /** 删除 skill（scope 缺省按 global 解析根）。 */
    async remove(input: { root?: string; scope?: WritableScope; target?: ".dsh" | ".agents"; cwd?: string; sessionId?: string; name: string }) {
      const blocked = await rejectInjectedWrite({ name: input.name, cwd: input.cwd, sessionId: input.sessionId });
      if (blocked !== undefined) return blocked;
      const root = input.root ?? resolveRoot(input.scope ?? "global", input.cwd, input.target);
      return removeSkill(root, input.name);
    },
    /** 一键启用/禁用 skill（scope 缺省按 global 解析根）；只写 frontmatter 调用键，宿主原生生效。 */
    async setEnabled(input: { root?: string; scope?: WritableScope; target?: ".dsh" | ".agents"; cwd?: string; sessionId?: string; name: string; enabled: boolean }) {
      const blocked = await rejectInjectedWrite({ name: input.name, cwd: input.cwd, sessionId: input.sessionId });
      if (blocked !== undefined) return blocked;
      const root = input.root ?? resolveRoot(input.scope ?? "global", input.cwd, input.target);
      return setSkillEnabled({ root, name: input.name, enabled: input.enabled });
    },
    /** 细粒度调节调用方式：模型/用户两个方向分别启用或禁用（scope 缺省按 global 解析根）。 */
    async setInvocation(input: { root?: string; scope?: WritableScope; target?: ".dsh" | ".agents"; cwd?: string; sessionId?: string; name: string; modelInvocable: boolean; userInvocable: boolean }) {
      const blocked = await rejectInjectedWrite({ name: input.name, cwd: input.cwd, sessionId: input.sessionId });
      if (blocked !== undefined) return blocked;
      const root = input.root ?? resolveRoot(input.scope ?? "global", input.cwd, input.target);
      return setSkillInvocation({ root, name: input.name, modelInvocable: input.modelInvocable, userInvocable: input.userInvocable });
    },
    /** 读取 skill 详情（scope 缺省按 global 解析根；磁盘读不到时走 registry fallback）。 */
    async read(input: { root?: string; scope?: WritableScope; target?: ".dsh" | ".agents"; cwd?: string; sessionId?: string; name: string }): Promise<ReadResult> {
      const root = input.root ?? resolveRoot(input.scope ?? "global", input.cwd, input.target);
      const disk = await readSkillDetail(root, input.name);
      if (disk.ok || registry === undefined) return disk;
      // 磁盘读不到：可能是宿主注入技能（无磁盘文件）或磁盘根解析差异
      // （架构契约 §8.1）。registry 的正文/路径读取失败时保留原磁盘错误。
      try {
        const fallback = await registry.readDetail({ name: input.name, cwd: input.cwd, sessionId: input.sessionId });
        if (fallback !== undefined) return fallback;
      } catch {
        /* 降级：保留磁盘 not-found */
      }
      return disk;
    },
    /**
     * 读取注入条目的资源文件（架构契约 §8.3 的路径边界：基准目录只来自宿主
     * registry，客户端只传 POSIX 相对路径；拒绝 `..` / 绝对路径 / 反斜杠 /
     * 符号链接 / realpath 逃逸，单文件上限 256 KiB）。
     */
    async readResource(input: { name: string; path: string; cwd?: string; sessionId?: string }) {
      if (registry === undefined) {
        return { ok: false as const, errors: ["宿主技能注册表不可用，无法读取注入技能资源"], code: "registry-unavailable" };
      }
      return registry.readResource(input);
    },
    /**
     * 安装 skill：`sourcePath` 走宿主路径复制，`url` 走 HTTP 下载（GitHub
     * 仓库 / .zip / raw .md），`files` 走客户端上传落盘；三者都缺时报错。
     * scope 缺省按 global 解析根。
     */
    async install(input: { root?: string; scope?: WritableScope; target?: ".dsh" | ".agents"; cwd?: string; sessionId?: string; sourcePath?: string; url?: string; files?: TransferFile[]; overwrite?: boolean }) {
      const root = input.root ?? resolveRoot(input.scope ?? "global", input.cwd, input.target);
      if (typeof input.sourcePath === "string" && input.sourcePath.length > 0) {
        return installFromPath({ root, sourcePath: input.sourcePath, overwrite: input.overwrite });
      }
      if (typeof input.url === "string" && input.url.length > 0) {
        return installFromUrl({ root, url: input.url, overwrite: input.overwrite });
      }
      if (Array.isArray(input.files)) {
        return installFromFiles({ root, files: input.files, overwrite: input.overwrite });
      }
      return { ok: false, errors: ["install requires a sourcePath, a url, or a files list"] };
    },
    /**
     * 把 skill 从全局导入到当前项目：**物理复制**到 `<项目>/.agents/skills`
     * （目录型连资源文件），此后在本项目内独立启停/调节调用方向（写项目
     * 副本的 frontmatter，全局配置不动；快照语义，不跟随全局更新）。
     * 目标根已有同名条目且未要求 overwrite 时返回 existed（overwrite 下
     * 先删后复制）；其它项目根（.dsh/.claude）有同名原生条目时报硬错误
     * ——复制过去也会被宿主按 rank 遮蔽，导入无意义。
     */
    async importToProject(input: { cwd: string; name: string; fromRoot?: string; sessionId?: string; overwrite?: boolean }) {
      // 导入的源必须是受管全局磁盘条目；注入行没有磁盘文件可复制。
      const blocked = await rejectInjectedWrite({ name: input.name, cwd: input.cwd, sessionId: input.sessionId });
      if (blocked !== undefined) return blocked;
      const fromRoot = typeof input.fromRoot === "string" && input.fromRoot.length > 0 ? input.fromRoot : resolveRoot("global", undefined, undefined);
      // 被复制的全局条目必须存在（fromRoot 是全局面板行携带的全局根）。
      if ((await detectFormat(fromRoot, input.name)) === undefined) {
        return { ok: false as const, errors: [`no global skill named "${input.name}"`] };
      }
      const toRoot = resolveRoot("project", input.cwd, ".agents");
      const existing = await detectFormat(toRoot, input.name);
      if (existing !== undefined && input.overwrite !== true) {
        return { ok: false as const, errors: [`项目内已有同名技能 "${input.name}"`], existed: true };
      }
      // 其它项目根（.dsh/.claude）有同名原生条目时，复制进 .agents 会被
      // 宿主按 rank 遮蔽（project-dsh 100 < project-agents 200），报硬错误
      // 而非制造一个看不到效果的副本。
      for (const target of [".dsh", ".claude"] as const) {
        if ((await detectFormat(projectSkillsDir(input.cwd, target), input.name)) !== undefined) {
          return { ok: false as const, errors: [`项目内已有同名原生技能 "${input.name}"（${target}），导入的副本不会生效`] };
        }
      }
      // 覆盖时先清掉旧副本（布局可能从 flat 变 directory 等，removeSkill
      // 只删探测到的那种布局，另一种形态显式再清一次）。
      if (existing !== undefined) {
        await removeSkill(toRoot, input.name);
        const leftover = await detectFormat(toRoot, input.name);
        if (leftover !== undefined) await removeSkill(toRoot, input.name);
      }
      return cloneSkill(fromRoot, toRoot, input.name);
    },
    /**
     * 在本项目内禁用某个全局 skill（shadow stub，见 skills/shadow.ts）：
     * 在项目 `.agents/skills` 生成同名占位文件（frontmatter 双向禁用 +
     * metadata 标记），按宿主 rank 覆盖全局条目——catalog 注入、`skill`
     * 工具调用、`/name` 用户注入三条链路都被宿主原生拒绝；删除占位即恢复。
     * 项目 `.dsh` 有同名条目时报硬错误（占位不会生效）；项目 `.agents`
     * 已有同名真实条目时返回 existed（应直接禁用那个条目）。
     */
    async disableInProject(input: { cwd?: string; name: string; fromRoot?: string }) {
      if (input.cwd === undefined) return { ok: false as const, errors: ["disableInProject requires a workspace path"] };
      // 注入技能的项目默认禁用走 `.agents/capability-overrides.json`
      // （overrides.toggle({domain:"skills"})），不生成 shadow stub（Lead 裁定 R7）。
      const blocked = await rejectInjectedWrite({ name: input.name, cwd: input.cwd });
      if (blocked !== undefined) return blocked;
      const fromRoot = typeof input.fromRoot === "string" && input.fromRoot.length > 0 ? input.fromRoot : resolveRoot("global", undefined, undefined);
      return createShadowStub({
        projectRoot: projectSkillsDir(input.cwd, ".agents"),
        projectDshRoot: projectSkillsDir(input.cwd, ".dsh"),
        fromRoot,
        name: input.name,
      });
    },
    /**
     * 恢复全局 skill 在本项目可用：删除 shadow stub（幂等）。同名条目不是
     * stub 时拒绝删除（可能是用户的真实项目技能）。
     */
    async enableInProject(input: { cwd?: string; name: string }) {
      if (input.cwd === undefined) return { ok: false as const, errors: ["enableInProject requires a workspace path"] };
      return removeShadowStub({ projectRoot: projectSkillsDir(input.cwd, ".agents"), name: input.name });
    },
    /**
     * 导出 skill：给 `destDir` 复制到宿主目录；否则读成 base64 文件清单
     * 返回给客户端下载。scope 缺省按 global 解析根。
     *
     * 注入行（无磁盘文件）走 registry fallback：单文件正文快照
     * （`lossy: true`，资源不打包，架构契约 §8.4）。
     */
    async export(input: { root?: string; scope?: WritableScope; target?: ".dsh" | ".agents"; cwd?: string; sessionId?: string; name: string; destDir?: string; overwrite?: boolean }) {
      const root = input.root ?? resolveRoot(input.scope ?? "global", input.cwd, input.target);
      const disk =
        typeof input.destDir === "string" && input.destDir.length > 0
          ? await exportToPath({ root, name: input.name, destDir: input.destDir, overwrite: input.overwrite })
          : await exportSkillFiles(root, input.name);
      if (disk.ok || registry === undefined) return disk;
      let snapshot: TransferResult | undefined;
      try {
        snapshot = await registry.exportSnapshot({ name: input.name, cwd: input.cwd, sessionId: input.sessionId });
      } catch {
        snapshot = undefined;
      }
      if (snapshot === undefined) return disk;
      if (typeof input.destDir === "string" && input.destDir.length > 0) {
        return writeExportSnapshot({
          name: input.name,
          destDir: input.destDir,
          overwrite: input.overwrite,
          snapshot,
        });
      }
      return snapshot;
    },
  };
}

/** 组装一行面板摘要（可选字段缺省时不输出，减少序列化噪音）。 */
function summaryView(input: {
  name: string;
  description: string;
  whenToUse: string | undefined;
  invocation: InvocationPolicy;
  source: SkillSummaryView["source"];
  format: SkillFormat;
  readOnly: boolean;
  /** skill 文件的绝对路径（directory 为 SKILL.md，flat 为 <name>.md）。 */
  filePath: string;
  /** directory 布局时的资源基准目录（flat 为 undefined）。 */
  resourceDirectory: string | undefined;
  /** 条目所属的受管根目录。 */
  root: string;
  /** 是否为「项目内禁用全局」的屏蔽占位（见 skills/shadow.ts）。 */
  shadowStub: boolean;
}): SkillSummaryView {
  return {
    name: input.name,
    description: input.description,
    ...(input.whenToUse !== undefined ? { whenToUse: input.whenToUse } : {}),
    invocation: input.invocation,
    source: input.source,
    format: input.format,
    readOnly: input.readOnly,
    path: input.filePath,
    ...(input.resourceDirectory !== undefined ? { resourceDirectory: input.resourceDirectory } : {}),
    root: input.root,
    ...(input.shadowStub ? { shadowStub: true } : {}),
  };
}

/**
 * 给全局条目标注当前项目对它的遮蔽状态（`projectShadow`）：
 *
 *   - 项目区有同名 shadow stub（屏蔽占位）→ `"stub"`：该全局技能在本项目
 *     已被宿主原生禁用，面板提供「恢复」；
 *   - 项目区有同名真实条目 → `"skill"`：项目副本遮蔽全局（rank 语义），
 *     面板仅作提示。
 *
 * 判定键与宿主 registry 的合并键一致：frontmatter name。
 */
function annotateProjectShadow(views: SkillSummaryView[]): void {
  const stubNames = new Set<string>();
  const projectNames = new Set<string>();
  for (const view of views) {
    if (!isProjectSkillSource(view.source)) continue;
    if (view.shadowStub === true) stubNames.add(view.name);
    else projectNames.add(view.name);
  }
  for (const view of views) {
    if (!isGlobalSkillSource(view.source)) continue;
    if (stubNames.has(view.name)) view.projectShadow = "stub";
    else if (projectNames.has(view.name)) view.projectShadow = "skill";
  }
}
