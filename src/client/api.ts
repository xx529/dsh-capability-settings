/**
 * 客户端面板的 API 表面（传输无关）。
 *
 * 面板 UI 只依赖这套接口，不关心底层传输方式；具体的适配器
 * （插件自有通道 `/capability-panel` 上的 RPC，见 api-adapter.ts）由
 * `src/client.ts` 组装注入。
 *
 * 客户端类型（`Client*` 前缀）刻意与宿主类型（skills/types、mcp/types）
 * 保持独立：这是传输边界，宿主侧的类型（如 McpStatusView）是 Cordis
 * 运行时的概念，不能直接依赖。
 *
 * @module dsh-capability-settings/client/api
 */

import type { SkillFormat, SkillSpec, WritableScope } from "../skills/types.js";
import type { McpScope, McpServerEntry } from "../mcp/types.js";
import type { CapabilityDomain } from "../overrides/types.js";

// ---------------------------------------------------------------------------
// 能力可见性（v21）：检查某个能力对哪些工作区可见 + 每个工作区的默认开/关
//
// 存储：`capability-global-overrides.json` v2 的 `visibility.skills/mcp/tools`
// （按名字 → { mode, workspaces[项目根] }），详见 notes/redesign/visibility-contract.md。
// 传输边界两侧各镜像一份类型；客户端只做展示与编辑，不做运行时 gate。
// ---------------------------------------------------------------------------

/** 可见性模式：全部工作区（可单独隐藏某个）/ 仅勾选的工作区 / 不可见。 */
export type ClientVisibilityMode = "all" | "selected" | "none";

/** 一个工作区的可见性与默认开/关（缺省字段 = 继承：可见 / 走兜底默认）。 */
export interface ClientWorkspaceVisibility {
  /** false = 该工作区不可见（优先级高于 mode=all）。 */
  visible?: boolean;
  /** 该工作区的默认开/关；缺省 = 走兜底（`!全局默认关闭名单(name)`）。 */
  defaultEnabled?: boolean;
}

/** 一个能力（skill / mcp server / tools 单元）的可见性配置。 */
export interface ClientCapabilityVisibility {
  mode: ClientVisibilityMode;
  /** key = 项目根（与 capability-overrides.json 同源）。 */
  workspaces: Record<string, ClientWorkspaceVisibility>;
}

/** 三域的可见性全量（`overrides.globalGet` 的 `visibility` 字段）。 */
export type ClientVisibilitySets = Record<"skills" | "mcp" | "tools", Record<string, ClientCapabilityVisibility>>;

/**
 * v21.1：保存可见性时的**冲突工作区**——该工作区显式开启了此能力，但本次保存
 * 会把它设为不可见。宿主返回 `code: "visibility-conflicts"` + 此列表，由面板
 * 弹二级确认（保留 / 清除工作区显式开启）后带 `resolveConflicts` 重试。
 */
export interface ClientVisibilityConflict {
  /** 工作区展示路径（宿主给的工作区 key / path）。 */
  workspace: string;
  /** 该工作区解析出的项目根（与 visibility.workspaces 的 key 同源）。 */
  projectRoot: string;
}

/** 冲突解决方式：保留工作区的显式开启配置 / 清除它们（其它默认不变）。 */
export type ClientVisibilityConflictResolution = "keep" | "clear";

/** `overrides.setVisibility` 的返回：成功 or 业务失败（可能带冲突明细）。 */
export type ClientSetVisibilityResult =
  | { ok: true }
  | { ok: false; errors: string[]; code?: string; conflicts?: ClientVisibilityConflict[] };

/**
 * v21：列表行的可见性投影（skills / mcp / tools 三域共用字段）。
 *
 * 宿主按「当前作用域」计算：全局视图给 `visibilityMode` / `visibleWorkspaceCount`；
 * 工作区视图只返回可见行并额外给 `visibleInWorkspace`（行政防御用）。
 * 旧宿主缺失全部字段 ⇒ 客户端按「全部可见」渲染。
 */
export interface ClientVisibilityFields {
  /** 全局视图：该能力的可见性模式；缺省 = all。 */
  visibilityMode?: ClientVisibilityMode;
  /** 全局视图：可见的工作区数（指定模式下即勾选数）。 */
  visibleWorkspaceCount?: number;
  /** 工作区视图：该能力对当前工作区是否可见（缺省 true）。 */
  visibleInWorkspace?: boolean;
  /** 工作区视图：不可见导致运行时强制关闭（会话开关不能打开）。 */
  disabledByVisibility?: boolean;
}

/** 客户端三域（v21：`CapabilityDomain` 扩到 tools；用联合兜底旧宿主类型定义）。 */
export type ClientCapabilityDomain = CapabilityDomain | "tools";

// ---------------------------------------------------------------------------
// Skills 域：面板视角的摘要/详情/操作入参
// ---------------------------------------------------------------------------

/** 宿主 registry 注入条目的来源类别（仅 `injected` 行携带）。 */
export type ClientSkillOrigin = "bundled" | "plugin" | "preset";

/** registry 资源基准类别（决定能否浏览资源文件）。 */
export type ClientSkillResourceBaseKind = "directory" | "url" | "opaque";

/** 面板列表里的一行 skill 摘要（调用策略已拍平为两个布尔）。 */
export interface ClientSkillSummary extends ClientVisibilityFields {
  name: string;
  description: string;
  whenToUse?: string;
  modelInvocable: boolean;
  userInvocable: boolean;
  source: string;
  format: SkillFormat;
  readOnly: boolean;
  path?: string;
  /**
   * true = 该行来自**宿主技能注册表注入**（DSH 内置 / 插件运行时注册 /
   * Agent 预设渠道），不是面板受管的磁盘文件；正文与资源只读，但启停
   * （本项目默认 / 本会话）与磁盘技能同逻辑。
   *
   * 旧宿主没有该字段 ⇒ 全部按磁盘行渲染（字段缺失即旧行为）。
   */
  injected?: boolean;
  /** 注入来源类别（仅 injected 行）。 */
  origin?: ClientSkillOrigin;
  /** 展示用注入方名（「DSH 内置（Office）」/ `dsh-to-figma` / preset id）。 */
  channel?: string;
  /**
   * true = 宿主注入（DSH 随包 `bundled` / 宿主预设 `preset` / `@deepseek-ai/*`
   * 插件）。所有工作区默认需要，只读展示，任何开关都不可写。
   */
  hostInjected?: boolean;
  /** registry provider id（诊断用；不参与路由）。 */
  provider?: string;
  /** registry 原始 source（bundled / custom / runtime / 插件自定义 source）。 */
  registrySource?: string;
  /** 资源基准类别；缺省 = 无资源基准（只给正文）。 */
  resourceBaseKind?: ClientSkillResourceBaseKind;
  /** true = 正文/资源只读（UI 隐藏编辑/删除等写操作，但保留启停）。 */
  contentReadOnly?: boolean;
  /** 仅 injected 行：本项目默认是否禁用（来自 capability-overrides.json 的 skills 清单）。 */
  disabledInProject?: boolean;
  /**
   * v20.1（B2 全局默认层）：名字在**全局默认关闭名单**
   * （`<dshHome>/dsh-capability-settings/capability-global-overrides.json` 的
   * `skills`）里。全局视图的开关显示/写入依据它；缺省 = false（旧宿主）。
   */
  globalDefaultDisabled?: boolean;
  /** v20.1（B2）：名字在**本项目显式启用名单**（`enabledSkills`）里（工作区重新打开全局默认关闭项）。 */
  projectDefaultEnabled?: boolean;
  /** v20.1（B2）：名字在**本项目默认关闭名单**（`skills`）里。 */
  projectDefaultDisabled?: boolean;
  /**
   * v20.1（B2）：按契约 §1.3 计算出的**有效默认值**（工作区视图开关显示用）：
   * `projectDefaultEnabled ? true : (projectDefaultDisabled || globalDefaultDisabled) ? false : true`。
   * 缺省时由客户端按旧字段回退。
   */
  effectiveDefaultEnabled?: boolean;
  /**
   * v20.1（B2）：是否**允许**写全局默认开关。preset 等「同层注入」条目可能
   * 为 false（宿主 registry 硬边界：无法用 runtime shadow 覆盖同层注入），
   * 此时全局视图开关置灰并显示 {@link globalToggleBlockedReason}。
   * 缺省 = true（旧宿主按可写处理）。
   */
  canToggleGlobal?: boolean;
  /** v20.1：`canToggleGlobal=false` 时的可读原因（UI 禁用 tooltip 文案）。 */
  globalToggleBlockedReason?: string;
  /** 可写条目所属的受管根目录（写回/导出/导入时按 root 精确寻址）。 */
  root?: string;
  /**
   * 为 true 表示本条目是「项目内禁用全局」生成的屏蔽占位（shadow stub）：
   * 按宿主 rank 遮蔽同名全局条目，使其在本项目不可调用；删除它即恢复。
   */
  shadowStub?: boolean;
  /**
   * 仅全局条目携带：当前项目对它的遮蔽状态。
   * `stub` = 项目区已有屏蔽占位（本项目内已禁用，可「恢复」）；
   * `skill` = 项目区已有同名真实条目（项目副本遮蔽全局）。
   */
  projectShadow?: "stub" | "skill";
  /**
   * 本会话是否生效（composer 的 sessionList 投影）：按会话落盘、重启后恢复。
   * 缺省 true；本会话关闭后为 false。
   */
  enabledInSession?: boolean;
  /** 当前会话是否有 agent ctx（false 时 UI 会话开关置灰）。 */
  canToggleInSession?: boolean;
  /** 冷会话：改动已落盘，下次恢复时生效。 */
  activationPending?: boolean;
}

/** skill 详情 = 摘要 + 完整 spec + 正文 + 资源文件列表。 */
export interface ClientSkillDetail extends ClientSkillSummary {
  spec: SkillSpec;
  body: string;
  /**
   * 资源条目（注入行 = registry `resourceBase.directory` 的一层条目名，
   * 文件与目录都可能出现；磁盘行 = 技能目录下的文件清单）。
   */
  resources: string[];
  /** 仅注入行：true = 本详情来自 registry fallback（内容只读，无磁盘文件可写）。 */
  fromRegistry?: boolean;
  /** 仅注入行：资源基准不可浏览时的说明（url / opaque / 目录读不到）。 */
  resourceBaseNote?: string;
}

/** 读取注入技能单个资源文件的失败码（业务失败，见宿主契约 §7.3）。 */
export type SkillResourceErrorCode =
  | "not-found"
  | "escape"
  | "not-text"
  | "too-large"
  | "unsupported-base"
  | "registry-unavailable"
  | "requires-session"
  | "read-only";

/** 读取注入技能单个资源文件的结果。 */
export type SkillResourceResult =
  | { ok: true; path: string; size: number; content: string; truncated: boolean }
  | { ok: false; errors: string[]; code?: SkillResourceErrorCode };

/** 创建 skill 的入参（scope/target 决定落盘位置）。 */
export interface CreateSkillInput {
  scope: WritableScope;
  target?: ".dsh" | ".agents";
  format: SkillFormat;
  spec: SkillSpec;
  body: string;
  overwrite?: boolean;
}

/** 操作结果：成功或错误信息列表（与宿主侧枚举保持同构）。 */
export type OpResult = { ok: true } | { ok: false; errors: string[] };

/** 安装结果：成功时带回实际落盘的 skill 名（以 frontmatter 名称为准）。 */
export type InstallResult = { ok: true; name?: string; existed?: boolean } | { ok: false; errors: string[] };

/** 上传/下载通道里的一个文件：相对路径 + base64 内容（二进制安全）。 */
export interface SkillFilePayload {
  path: string;
  content: string;
}

/** 浏览器上传安装的入参（单 .md 文件或含 SKILL.md 的一组目录文件）。 */
export interface InstallUploadInput {
  scope: WritableScope;
  target?: ".dsh" | ".agents";
  files: SkillFilePayload[];
  overwrite?: boolean;
}

/** 宿主路径安装的入参。 */
export interface InstallPathInput {
  scope: WritableScope;
  target?: ".dsh" | ".agents";
  sourcePath: string;
  overwrite?: boolean;
}

/** URL 下载安装的入参（GitHub 仓库 / .zip / raw .md）。 */
export interface InstallUrlInput {
  scope: WritableScope;
  target?: ".dsh" | ".agents";
  url: string;
  overwrite?: boolean;
}

/** 导出为文件清单的结果（客户端据此单文件下载或打 zip）。 */
export type ExportFilesResult =
  | {
      ok: true;
      name: string;
      format: SkillFormat;
      files: SkillFilePayload[];
      /**
       * 注入技能的内容快照：只有正文，资源文件不打包（宿主 additive 字段；
       * 旧宿主缺省 = 非降级导出）。
       */
      lossy?: boolean;
    }
  | { ok: false; errors: string[] };

/** 按行寻址一个可写 skill 的最小入参（root 优先，scope/target 兜底）。 */
export interface SkillRef {
  name: string;
  root?: string;
  scope?: WritableScope;
  target?: ".dsh" | ".agents";
}

/** skills 域的面板 API。 */
/** v21：`skills.listView` 的返回（行 + 因可见性被隐藏的条数）。 */
export interface ClientSkillList {
  skills: ClientSkillSummary[];
  hiddenCount?: number;
}

export interface SkillsApi {
  /** 列出（合并）当前作用域下所有 skill 摘要。 */
  list(): Promise<ClientSkillSummary[]>;
  /**
   * v21（可选）：同 {@link list}，但额外返回工作区视图的 `hiddenCount`
   * （因可见性被过滤掉的条目数，供「另有 N 个能力未对此外工作区开放」提示）。
   * 旧宿主 / 测试夹具只有 `list()` 时面板回落 list()，hiddenCount 视为 0。
   */
  listView?(): Promise<ClientSkillList>;
  /**
   * 会话视角的 skill 列表：与 {@link list} 相同，但多返回
   * `enabledInSession` / `canToggleInSession`（需要 api 带 sessionId，仅
   * composer 的每会话 api 提供）。用于输入框下方的会话能力配置区。
   */
  sessionList(): Promise<ClientSkillSummary[]>;
  /**
   * v21（可选）：会话视角列表 + `hiddenCount`（工作区可见性过滤掉的技能数）。
   * 旧宿主只有 {@link sessionList} 时首屏提示的「不可见 N 项」缺省为 0。
   */
  sessionListView?(): Promise<ClientSkillList>;
  /**
   * 关闭 / 恢复某个 skill 在**当前会话**的可见性（按会话落盘，重启/resume 后恢复）：
   * 关闭通过 agent 作用域注册同名 runtime shadow 实现（从模型目录、
   * `skill` 工具与 `/name` 注入三条链路消失）；恢复即解除 shadow。
   * 只能「关闭 / 恢复」，不能强制开启文件级已禁用项。
   */
  setSessionEnabled(input: { name: string; enabled: boolean }): Promise<OpResult>;
  /** 读取单个 skill 详情；不存在返回 undefined。 */
  read(name: string, ref?: SkillRef): Promise<ClientSkillDetail | undefined>;
  /**
   * 读取**注入技能**单个资源文件的文本内容（路径边界由宿主校验：`..` /
   * 绝对路径 / 符号链接 / 超 256 KiB 都会被业务失败拒绝并带 `code`）。
   * 只对 `resourceBase.kind === "directory"` 的注入行有意义。
   */
  readResource(input: { name: string; path: string }): Promise<SkillResourceResult>;
  create(input: CreateSkillInput): Promise<OpResult>;
  update(input: { scope: WritableScope; target?: ".dsh" | ".agents"; name: string; spec: SkillSpec; body: string }): Promise<OpResult>;
  remove(input: SkillRef): Promise<OpResult>;
  /**
   * 一键启用/禁用 skill：禁用 = 用户与模型都不可调用（frontmatter 写入
   * `user-invocable: false` 与 `disable-model-invocation: true`）；启用 =
   * 清除两个键恢复缺省双启用。正文与其它元数据原样保留。
   */
  setEnabled(input: SkillRef & { enabled: boolean }): Promise<OpResult>;
  /**
   * 细粒度调节调用方式：模型（agent 自动触发）与用户（输入框 `/name` 口令）
   * 两个方向分别启用/禁用。例如只希望用户手动触发、不让 agent 自动注入的
   * skill，把 `modelInvocable` 设为 false 即可——frontmatter 只写
   * `disable-model-invocation: true`，另一个方向原样保留。
   */
  setInvocation(input: SkillRef & { modelInvocable: boolean; userInvocable: boolean }): Promise<OpResult>;
  /** 浏览器上传安装（单 .md / 含 SKILL.md 的目录文件清单 / zip 解压清单）。 */
  installUpload(input: InstallUploadInput): Promise<InstallResult>;
  /** 从宿主磁盘路径安装（skill 目录或 .md 文件）。 */
  installFromPath(input: InstallPathInput): Promise<InstallResult>;
  /** 从 URL 下载安装（GitHub 仓库、.zip URL 或 raw .md URL）。 */
  installFromUrl(input: InstallUrlInput): Promise<InstallResult>;
  /**
   * 导入单个全局 skill 到当前项目：**物理复制**到 `<项目>/.agents/skills`
   * （目录型连资源文件），此后在本项目内独立启停/调节调用方向（写项目
   * 副本的 frontmatter，全局配置不动；快照语义，不跟随全局更新）。
   * 目标已有同名条目且未传 overwrite 时返回 `{ ok: false, existed: true }`；
   * 其它项目根有同名原生条目时报硬错误（副本会被遮蔽、不生效）。
   */
  importToProject(input: { name: string; fromRoot?: string; overwrite?: boolean }): Promise<OpResult & { existed?: boolean; path?: string }>;
  /**
   * 在本项目内禁用某个全局 skill（shadow stub）：在项目 `.agents/skills`
   * 生成同名占位文件（frontmatter 双向禁用），按宿主 rank 覆盖全局条目，
   * 模型与用户调用都被宿主原生拒绝。项目内已有同名真实条目时返回
   * `{ ok: false, existed: true }`（应直接禁用那个条目）。
   */
  disableInProject(input: { name: string; fromRoot?: string }): Promise<OpResult & { existed?: boolean }>;
  /** 恢复全局 skill 在本项目可用：删除 shadow stub（幂等）。 */
  enableInProject(input: { name: string }): Promise<OpResult>;
  /** 导出为 base64 文件清单（供浏览器下载/打包）。 */
  exportFiles(input: SkillRef): Promise<ExportFilesResult>;
  /** 导出到宿主上的指定目录。 */
  exportToPath(input: SkillRef & { destDir: string; overwrite?: boolean }): Promise<OpResult>;
}

// ---------------------------------------------------------------------------
// MCP 域
// ---------------------------------------------------------------------------

/** 面板视角的一条 MCP server（合并 + 投影后的视图，自带摘要）。 */
export interface ClientMcpServer extends ClientVisibilityFields {
  key: string;
  serverName: string;
  transport: "stdio" | "http";
  scope: McpScope;
  enabled: boolean;
  shadowed: boolean;
  summary: string;
  entry: McpServerEntry;
  filePath: string;
  /**
   * 为 true 表示这条**项目**条目与全局条目同源：引用视图（reference）
   * 恒带此标记；旧版「导入 = 物理复制」时期导入的副本（条目里带导入
   * 标记）也带此标记。面板据此显示「全局」归属徽标与「移出」按钮。
   */
  importedFromGlobal?: boolean;
  /**
   * 为 true 表示这条视图是**项目级引用**（内容实时取自同名全局条目，
   * 启停是引用上的项目级标记）。引用条目不提供「编辑」（请到全局区编辑）。
   */
  reference?: boolean;
  /**
   * 为 true 表示这个 server 被当前项目在项目级声明为**默认关闭**
   * （`.agents/capability-overrides.json` 的 mcp 列表）。面板「默认」列的开关
   * = `!disabledInProject`；新建对话按它来。
   */
  disabledInProject?: boolean;
  /**
   * 本会话的生效开关（composer 的 api 带了 sessionId 时由宿主投影）：显式会话
   * 开关优先，否则跟随项目默认。按会话落盘、重启后恢复。
   */
  enabledInSession?: boolean;
}

/** 合并列表结果：servers + 非致命的读取错误。 */
export interface ClientMcpList {
  servers: ClientMcpServer[];
  errors: string[];
  /**
   * v21：工作区视图里因可见性被过滤掉的条目数（全局视图缺省）。
   * 面板据此提示「另有 N 个能力未对此外工作区开放」。
   */
  hiddenCount?: number;
  /** v21.1：工作区视图的项目根（项目级配置的实际归属目录；全局视图缺省）。 */
  projectRoot?: string;
  /** v21.1：项目级 MCP 配置文件真实路径（`<项目根>/.mcp.json`；全局视图缺省）。 */
  projectFile?: string;
}

/** 一条 server 在一个 session 内的挂载状态。 */
export interface ClientMcpMount {
  key: string;
  serverName: string;
  state: "mounted" | "failed" | "conflict";
  error?: string;
}

/** 一个 session 的挂载状态视图（对应宿主的 McpStatusView）。 */
export interface ClientMcpStatus {
  sessionId: string;
  projectRoot?: string;
  servers: ClientMcpMount[];
  /**
   * 宿主后台是否还在重挂（写入不再阻塞 RPC，见 `manager.reloadFor`）。
   * 面板据此在写操作后短暂轮询，让挂载状态自行收敛。
   */
  settling?: boolean;
}

/**
 * 一条 MCP 工具调用记录（宿主内存内、不落盘）。
 *
 * 适配器已把 `sessionId` 解析成侧栏标题（`sessionTitle`）；拿不到时缺省，
 * 面板退化为显示会话 id 尾部。
 */
export interface ClientMcpUsageEntry {
  /** 调用时间（epoch 毫秒）。 */
  time: number;
  /** 桥接层 serverName（与 `ClientMcpServer.serverName` 对应）。 */
  serverName: string;
  /** 已去掉 `mcp__<serverName>__` 前缀的工具名。 */
  tool: string;
  /** 调用方 session id。 */
  sessionId: string;
  /** 会话标题（侧栏显示的那个）；拿不到时缺省。 */
  sessionTitle?: string;
}

/** `mcp.usage` 的返回：最近若干条记录 + 本次生效的条数上限。 */
export interface ClientMcpUsageView {
  entries: ClientMcpUsageEntry[];
  limit: number;
}

// ---------------------------------------------------------------------------
// 自动归属（task-32 additive）
//
// 宿主把「插件 ↔ 工具 / MCP 命名空间」的归属判定从静态映射表扩展为多依据：
// 运行时捕获 / 包扫描 / 人工映射 / 名字推测 / 命名空间命中 / 未识别。客户端只做
// **展示与容错投影**：新增字段缺省全部可选，未知 matchedBy 一律回落 unknown。
// ---------------------------------------------------------------------------

/** 归属依据（新增值为 task-32 additive；`source` 兼容 v13 R4 的 MCP 来源判定）。 */
export type ClientAttributionMatchedBy =
  | "builtin"
  | "runtime"
  | "literal"
  | "table"
  | "similarity"
  | "namespace"
  | "prefix"
  | "exact"
  | "source"
  | "unknown";

/** 一条归属判定（Tools 单元 / MCP 运行时实例共用）。 */
export interface ClientAttributionInfo {
  /** 命中依据；未知/旧宿主缺失回落 `"unknown"`。 */
  matchedBy: ClientAttributionMatchedBy;
  /** 命中的模式 / 命名空间 / source / 包名等原文（依据不同含义不同）。 */
  pattern?: string;
  /** 包名（已识别才有）。 */
  packageName?: string;
  /**
   * 置信度：宿主 D4 契约为 `"high" | "medium" | "low"`（字符串）；
   * 兼容旧数字口径（0–1 或 0–100，adapter 归一到 0–1）。缺省 = 不展示。
   */
  confidence?: "high" | "medium" | "low" | number;
  /** true = 推测结果与人工映射表冲突（UI 加「推测」标识）。 */
  conflictsWithTable?: boolean;
  /** true = 候选不唯一（推测路径；UI 加「推测」标识）。 */
  ambiguous?: boolean;
  /** true = 同一单元由多个来源合并（诊断用）。 */
  mixed?: boolean;
  /**
   * 旧版持久化键已迁移到新 unit 的标记（additive）：true 或旧键原文。
   * UI 显示小字「旧版键已迁移」，不参与开关语义。
   */
  legacyUnit?: boolean | string;
}

/**
 * 运行时注入的 MCP 实例（**只读**）：不是本插件配置文件里的条目，而是其它插件
 * 或 profile 直接挂载的 mcp-client。面板只展示，不提供编辑/卸载。
 */
export interface ClientMcpRuntimeServer extends ClientVisibilityFields {
  /** 实例的 serverName（工具名 `mcp__<serverName>__*` 里的那段）。 */
  serverName: string;
  /** 来源：注入它的插件显示名 / loader 条目 id；识别不到时缺省。 */
  source?: string;
  /**
   * true = 宿主注入（注入方为 `@deepseek-ai/*` 包 / 宿主 fiber）。
   * 只读展示：全局默认 / 工作区默认 / 可见性 / 当前对话都不可写。
   */
  hostInjected?: boolean;
  /**
   * 发现路径：loader 条目 / 动态 fiber / 工具命名空间合成
   * （v13 R4；旧宿主只回 entry / fiber，按 `!=="entry"` 回落即可）。
   */
  origin: "entry" | "fiber" | "namespace";
  /**
   * 注入方**展示名**（v13 R4 additive）：映射表归一后的插件名
   * （如 fiber `dsh-figma` → `dsh-to-figma`）。卡片第二枚标签用它；无来源缺省。
   */
  channel?: string;
  /**
   * 来源判定（v13 R4 + task-32 additive）：详情「来源判定」文案与诊断。
   * 旧宿主只回 `matchedBy: namespace/source/unknown`，新宿主可带推测标记。
   */
  attribution?: ClientAttributionInfo;
  /** v13 R4 additive：true = 由工具命名空间合成（没有 mcp-client 实例，无 config）。 */
  synthesized?: boolean;
  /** 桥接层配置里读到的传输方式（与配置条目同形）。 */
  transport?: "stdio" | "http";
  /** 与配置条目同款的命令/URL 摘要。 */
  summary?: string;
  /**
   * **本工作区有效默认关闭**（v20.2 语义扩展）：全局默认关闭名单 ∪ 本工作区默认
   * 关闭名单，再减去本工作区显式重新打开（`enabledMcp`）。命中时本工作区新建对话
   * 默认不启用，可按当前对话覆盖。缺省 = false（旧宿主：仅项目级声明）。
   */
  disabledInProject?: boolean;
  /**
   * v20.2：该实例在**全局默认关闭名单**里（独立文件
   * `capability-global-overrides.json` 的 `mcp`）；**原始名单成员**，不含本工作区
   * 是否重新打开的判断。全局视图的行尾开关直接读写这份名单；工作区视图与
   * `disabledInProject` 组合区分「继承全局默认关闭」（两者皆 true）与
   * 「已覆盖全局默认」（本字段 true、`disabledInProject` 缺省）。缺省 = false（旧宿主）。
   */
  disabledGlobally?: boolean;
  /** 能否按项目屏蔽（工具在全局注册表可见才可；agent 作用域注入的不可）。 */
  restrictable: boolean;
  /** 本会话的生效开关（传 sessionId 时才有；restrictable 才有意义）。 */
  enabledInSession?: boolean;
  /** 从工具注册表反推到的工具（含参数 JSON Schema）。 */
  tools: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>;
  /** 本次运行被调用次数（内存使用记录；0 = 未调用或不可见）。 */
  calls: number;
}

/** `mcp.runtime` 的返回。 */
export interface ClientMcpRuntimeView {
  servers: ClientMcpRuntimeServer[];
  /** true = 宿主仍在解析归属（task-32 additive；UI 显示「来源解析中…」，不阻塞操作）。 */
  attributionSettling?: boolean;
  /** v21：工作区视图里因可见性被隐藏的**外部注入实例**数。 */
  hiddenCount?: number;
}

/** 新增/更新一条 server 的入参。 */
export interface McpUpsertInput {
  scope: McpScope;
  key: string;
  entry: McpServerEntry;
}

/** 面板视角的一个 MCP 工具（宿主探测结果投影）。 */
export interface ClientMcpTool {
  name: string;
  description?: string;
  /**
   * 工具的 `inputSchema`（JSON Schema 原样透传）：面板读取 `properties` /
   * `required` 渲染参数表（名字 / 类型 / 是否必填 / 说明）。
   */
  parameters?: Record<string, unknown>;
  outputSchema?: unknown;
}

/**
 * 「测试 MCP 服务器」的结果：
 *  - 成功：连接正常 + 工具清单（可能为空——服务器未暴露任何工具）+ 耗时；
 *  - 失败：人类可读的中文错误文案列表（含原始错误 / stderr 摘要）。
 */
export type McpTestResult =
  | {
      ok: true;
      /** 规范化后的命名空间（对应挂载后的 `mcp__<serverName>__*`）。 */
      serverName: string;
      tools: ClientMcpTool[];
      elapsedMs: number;
      /** 服务器自报的 instructions（有则展示）。 */
      instruction?: string;
    }
  | { ok: false; errors: string[] };

/** 「调试调用」的入参：配置条目与外部注入实例二选一。 */
export interface McpInvokeInput {
  /** 配置条目键名（决定命名空间）。 */
  key?: string;
  /** 配置条目（条目路径必填；外部实例路径不传）。 */
  entry?: McpServerEntry;
  /** 外部注入实例的 serverName（条目路径不传）。 */
  serverName?: string;
  /** 服务器原始工具名（不是 `mcp__*` 公共名）。 */
  tool: string;
  /** 调用参数（必须是 JSON 对象；缺省 `{}`）。 */
  arguments?: Record<string, unknown>;
  /** 超时（毫秒）；缺省 60s、硬上限 60s。 */
  timeoutMs?: number;
}

/** 一个结果内容块（MCP `content` 数组元素，原样透传）。 */
export type ClientMcpInvokeContent = Record<string, unknown>;

/** 「调试调用」的结果（成功带内容块与耗时；失败带人类可读错误）。 */
export type McpInvokeResult =
  | {
      ok: true;
      /** text / image / resource … 内容块。 */
      content: ClientMcpInvokeContent[];
      /** structuredContent（服务器有则带上）。 */
      structuredContent?: unknown;
      /** 服务器是否把这次调用标记为工具错误（`isError`）。 */
      isError: boolean;
      /** 往返耗时（毫秒，含连接）。 */
      elapsedMs: number;
    }
  | { ok: false; errors: string[] };

/** MCP 域的面板 API。 */
export interface McpApi {
  list(): Promise<ClientMcpList>;
  upsert(input: McpUpsertInput): Promise<OpResult>;
  remove(input: { scope: McpScope; key: string }): Promise<OpResult>;
  setEnabled(input: { scope: McpScope; key: string; enabled: boolean }): Promise<OpResult>;
  /**
   * 导入全局 server 到当前项目：**登记一条引用**（写入
   * `<项目根>/.agents/capability-imports.json`），不是物理复制——内容始终
   * 跟随全局条目，全局更新实时生效；项目级启停记录在引用上。引用与项目
   * 原生条目同级参与挂载合并（遮蔽全局原版）。项目内已有同名原生条目时
   * 报硬错误；已有同名引用且未传 overwrite 时返回 `{ ok: false, existed: true }`。
   */
  importToProject(input: { key: string; overwrite?: boolean }): Promise<OpResult & { existed?: boolean }>;
  /** 当前项目下各 session 的实时挂载状态。 */
  status(): Promise<ClientMcpStatus[]>;
  /**
   * 「测试」：真实连接这份（可能尚未保存的）条目并列出其工具名与入参。
   *
   * 零副作用：不落盘、不注册工具、不改变任何已挂载连接；失败以
   * `{ ok:false, errors }` 返回（不抛异常），由面板就地展示。
   */
  test(input: { entry: McpServerEntry; key?: string; timeoutMs?: number }): Promise<McpTestResult>;
  /**
   * 「调试调用」：真实调用一次 MCP 工具。
   *
   * - 配置条目（传 `entry`）：宿主起一次性 MCP 连接 `callTool`——不挂载、不注册
   *   工具、不影响正在运行的对话；与「测试连接」同一套收尾。
   * - 外部注入实例（传 `serverName`）：没有配置可读，改走已挂载工具注册表；
   *   仅当该工具在全局注册表可见时可调（agent 作用域注入的会返回业务失败）。
   *
   * 失败以 `{ ok:false, errors }` 返回（不抛异常），由弹窗就地展示。
   */
  invoke(input: McpInvokeInput): Promise<McpInvokeResult>;
  /**
   * 最近 MCP 工具调用记录（**只读、内存内、不落盘**）：什么时候、哪个 session
   * 调用了哪个 server 的哪个 tool。传 `serverName` 只取该 server 的记录。
   * 记录在插件/进程重载后清空——这是刻意的，不做任何持久化。
   */
  usage(input?: { serverName?: string; limit?: number }): Promise<ClientMcpUsageView>;
  /**
   * 运行时注入的 MCP 实例（**只读**）：来自其它插件/profile 在运行时挂载的
   * mcp-client，不在能力面板的配置文件里。按工具注册表（`mcp__*`）与内存使用记录
   * 反推，只用于展示；编辑/卸载请去注入方。
   */
  runtime(input?: { cwd?: string }): Promise<ClientMcpRuntimeView>;
  /**
   * 设置**当前 session** 的能力开关（按会话落盘，重启/resume 后恢复）：项目条目
   * 按需挂载/卸载，全局与外部注入实例用 `tools.restrict` 屏蔽/恢复其工具，并在
   * 本会话系统提示词里遮蔽/恢复其服务器指令段（`mcp:<serverName>` 影子段；不卸载
   * 实例）。`enabled: undefined` = 清掉显式覆盖、重新跟随项目默认。
   */
  setSessionEnabled(input: { target: string; kind: "project" | "server"; enabled: boolean | undefined }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Tools 域（v13：插件直接注册的非 MCP 工具；开关粒度 = 整个插件）
//
// 类型与宿主 `src/tools/types.ts` 同名同义（传输边界两侧各镜像一份）。
// 契约见 docs/architecture/v13-implementation.md §5.1 / 附录 A。
// ---------------------------------------------------------------------------

/** 一个插件单元里的一个工具（只读展示；不带 parameters，避免界面/传输冗余）。 */
export interface ClientToolBrief {
  /** 完整工具名（restrict 用这个名字；UI 只读展示）。 */
  name: string;
  /** 一句话说明（宿主已截断到 200 码点）。 */
  description?: string;
}

/** 一个 Tools 开关单元（一个插件 = 一个单元；来源未识别合并成一个单元）。 */
export interface ClientToolsUnit extends ClientVisibilityFields {
  /** 开关单元 id（持久化键 = `plugin:<unit>`；未识别 = `__unattributed__`）。 */
  unit: string;
  /** 展示名（卡片 / 列表 / 详情标题）。 */
  name: string;
  /**
   * 插件用途描述（additive；宿主读不到 package.json description 时缺省）。
   *
   * 详情页展示；Jev 能力决策也用它替代「N 个工具 · 插件注入」占位。
   */
  description?: string;
  /** plugin = 已识别插件；unattributed = 来源未识别。 */
  kind: "plugin" | "unattributed";
  /**
   * true = 宿主注入（`@deepseek-ai/*` 包 / 宿主运行时注册）。
   *
   * 只读展示：所有开关（会话 / 全局默认 / 每工作区默认 / 可见性）都禁用，
   * 列表里恒为启用。缺省 = false（旧宿主按第三方插件处理）。
   */
  hostInjected?: boolean;
  /** 该单元当前可见的全部工具。 */
  tools: ClientToolBrief[];
  /** 工具数（卡片描述与 Jev toolCount 用）。 */
  toolCount: number;
  /** 归属判定（详情「来源判定」文案；task-32 additive，字段均容错）。 */
  attribution: ClientAttributionInfo;
  /**
   * **全局默认**开关（v13 两层语义；能力面板的 Tools 开关展示 / 写这个）。
   * 关闭后所有会话默认不可用；单个会话仍可在对话首屏单独开启。
   */
  defaultEnabled?: boolean;
  /**
   * **本会话生效值**（会话覆盖 > 全局默认；首屏 / 能力 Tab 的开关展示 / 写这个）。
   * 查询时没带 `sessionId`（主面板）或无会话上下文时，宿主按全局默认投影。
   */
  enabled?: boolean;
  /**
   * 旧字段（v13 单层语义）= 当时的「本会话生效值」。新宿主可能不再下发；
   * 客户端统一按 {@link enabled} 读，保留该字段只为兼容旧宿主响应。
   */
  enabledInSession?: boolean;
  /** 是否有显式会话覆盖（「恢复默认」是否可点、诊断用）。 */
  explicit: boolean;
  /** 不可开关原因（正常缺省）。 */
  lockedReason?: string;
  /** 上一次 restrict 的降级状态（仅传了 sessionId 时）。 */
  restriction?: { state: "applied" | "skipped" | "failed"; error?: string };
}

/** `tools.list` 的返回。 */
export interface ClientToolsList {
  units: ClientToolsUnit[];
  /** 全局工具总数（诊断）。 */
  totalGlobalTools: number;
  /** 被判定为宿主内建而排除的条数（诊断；不下发名单）。 */
  excludedBuiltinCount: number;
  /** 服务缺失/异常时的原因（不阻断其它域）。 */
  errors: string[];
  /** v21：工作区视图里因可见性被过滤掉的单元数（全局视图缺省）。 */
  hiddenCount?: number;
  /** 本次查询绑定的会话（没传 sessionId 时缺省）。 */
  sessionId?: string;
  /** true = 宿主仍在解析归属（task-32 additive；UI 显示「来源解析中…」，不阻塞开关）。 */
  attributionSettling?: boolean;
}

/**
 * `tools.inspect` 返回的一个工具（v13 修复：详情展示 schema）。
 *
 * 与 `tools.list` 的 `ClientToolBrief` 区别：这里是**按需**拉取的完整定义，
 * 带 `parameters`（JSON Schema）。`tools.list` 仍然只下发 name/description，
 * 避免把全部 schema 塞进列表响应。
 */
export interface ClientToolInspectTool {
  name: string;
  description?: string;
  /** 工具的 JSON Schema（原样透传；UI 读 properties/required 渲染参数表）。 */
  parameters?: Record<string, unknown>;
}

/** `tools.inspect {unit}` 的返回。 */
export interface ClientToolsInspect {
  /** 被检视的开关单元 id。 */
  unit: string;
  /** 该单元当前可见的工具（含 schema）。 */
  tools: ClientToolInspectTool[];
}

/** Tools 域的面板 API。 */
export interface ToolsApi {
  /**
   * 列出插件单元。始终返回 `defaultEnabled`（全局默认）与 `enabled`（本会话
   * 生效值）；传 `sessionId` 时会话覆盖才生效（composer 的每会话 api 会带）。
   * 服务缺失 / `schemas()` 失败时返回 `{units:[],errors:[...]}`，不抛。
   */
  list(input?: { cwd?: string; sessionId?: string }): Promise<ClientToolsList>;
  /**
   * 设置一个或多个插件在**指定会话**的开关（batch-first：单条 = 长度 1 的数组）。
   * `enabled: undefined` = 清除显式覆盖（恢复默认开启）。
   * 业务失败抛 `Error(errors.join("; "))`（与 skills/mcp 单条一致）。
   */
  setSessionEnabled(input: { units: string[]; enabled: boolean | undefined; sessionId?: string }): Promise<{ ok: true; applied: number }>;
  /**
   * 设置一个或多个插件的**全局默认**开关（能力面板 Tools 页 / 所有会话的默认）。
   *
   * 与 {@link setSessionEnabled} 互不影响：全局关闭后，单个会话仍可在首屏
   * 通过会话覆盖单独开启。batch-first（单条 = 长度 1 的数组）；业务失败抛错。
   */
  setGlobalEnabled(input: { units: string[]; enabled: boolean }): Promise<{ ok: true; applied: number }>;
  /**
   * 按需读取一个插件单元的工具定义（含 `parameters` JSON Schema）。
   *
   * 只在详情选中单元时调用（按 unit 缓存）；业务失败 `{ok:false,errors}` 时
   * 适配器抛错，UI 降级为「仅名称 + 说明」并提示参数不可用。
   */
  inspect(input: { unit: string; sessionId?: string }): Promise<ClientToolsInspect>;
}

// ---------------------------------------------------------------------------
// 会话级批量开关域（R1：`session.setBulk`）
//
// 空名单/部分失败不回滚（A7）：`failed[]` 属**成功 value**，适配器不抛错；
// 只有传输层错误与业务信封 `ok:false` 才抛/返回失败。
// ---------------------------------------------------------------------------

/** 三域名称（批量端点的 `domains` 取值）。 */
export type SessionBulkDomain = "skills" | "mcp" | "tools";

/** 批量动作：全部打开 / 全部关闭 / 清除显式会话覆盖。 */
export type SessionBulkAction = "enable" | "disable" | "reset";

/** `session.setBulk` 的入参。 */
export interface SessionBulkInput {
  /** 必填；空 → 业务失败。 */
  sessionId?: string;
  action: SessionBulkAction;
  /** 缺省 = 三域全部；客户端按域串行调用以取得粗粒度进度。 */
  domains?: SessionBulkDomain[];
  /** 项目作用域（skills 列表 / mcp 项目条目需要）；缺省由宿主从 session header.cwd 解析。 */
  cwd?: string;
  /** 仅测试/诊断：只计算不写入。 */
  dryRun?: boolean;
}

/** 批量里的一条逐项失败（不阻断其它项）。 */
export interface SessionBulkFailure {
  domain: SessionBulkDomain;
  /** skills = skill 名；mcp = target；tools = unit id。 */
  target: string;
  kind: "skill" | "mcp-project" | "mcp-server" | "plugin";
  error: string;
}

/** 一个域的批量计数。 */
export interface SessionBulkDomainCount {
  changed: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

/** `session.setBulk` 的成功 value。 */
export interface SessionBulkSuccess {
  ok: true;
  action: SessionBulkAction;
  applied: number;
  unchanged: number;
  skipped: number;
  failed: SessionBulkFailure[];
  byDomain: Record<SessionBulkDomain, SessionBulkDomainCount>;
  /** 非 live 会话里仍有写入只落盘的域时的提示位。 */
  coldSession?: boolean;
  elapsedMs: number;
}

/** `session.setBulk` 的业务失败（transport 失败仍抛错）。 */
export interface SessionBulkFailureResult {
  ok: false;
  errors: string[];
}

/** `session.setBulk` 的返回。 */
export type SessionBulkResult = SessionBulkSuccess | SessionBulkFailureResult;

/** 会话级批量开关 API。 */
export interface SessionApi {
  /** 批量打开/关闭/恢复默认；`failed[]` 不抛错（页面级用失败计数 + 重试）。 */
  setBulk(input: SessionBulkInput): Promise<SessionBulkResult>;
}

// ---------------------------------------------------------------------------
// 派生继承（spawn-time snapshot）
// ---------------------------------------------------------------------------

/**
 * 派生继承模式：新派生的 subagent / teammate 在创建那一刻继承什么。
 *
 * - `session`（默认）：复制当前会话的显式能力覆盖；
 * - `workspace`：不复制，使用工作区 / 项目默认能力；
 * - `dynamic`（v24）：按子 agent 首条任务在工作区默认能力上打分，只启用
 *   `score >= 阈值` 的能力；空集 / Jev 不可用 / 超时回退 `session`。
 */
export type DeriveMode = "session" | "workspace" | "dynamic";

/** 动态选择结果（派生会话页只读展示；与宿主 `DerivedDynamicInfo` 同构）。 */
export interface DerivedDynamicInfo {
  /** `ok` = 按首条任务选出并应用；`fallback` = 已回退继承策略。 */
  status: "ok" | "fallback";
  /** fallback 原因码（UI 文案用）。 */
  reason?: string;
  /** 本次使用的相关度阈值（0–1）。 */
  threshold: number;
  /** 达到阈值的已启用量。 */
  selected: number;
  /** 参与打分的候选总数。 */
  total: number;
  /** 三域各自选中数。 */
  counts: { skills: number; mcp: number; tools: number };
  /** fallback 时实际回退到的策略（`session` / `workspace`）。 */
  fallback?: "session" | "workspace";
  /** 写入时间（毫秒）。 */
  at: number;
}

/** 派生会话的创建快照（只读；由宿主在 child 创建时落盘）。 */
export interface DerivedInfo {
  /** 创建时实际使用的模式。 */
  mode: DeriveMode;
  /** 直接父 session id。 */
  from?: string;
  /** 快照写入时间（毫秒）。 */
  at?: number;
  /** 动态选择的创建时结果（仅 `mode === "dynamic"`）。 */
  dynamic?: DerivedDynamicInfo;
}

/** `session.deriveGet` 的返回。 */
export interface DeriveGetResult {
  /** 本会话之后创建 child 时使用的模式（缺省 `session`）。 */
  mode: DeriveMode;
  /** 本会话自身作为派生会话时的创建快照；非派生会话为 undefined。 */
  derived?: DerivedInfo;
}

/** 派生继承 API（会话作用域）。 */
export interface DeriveApi {
  /** 读取当前会话的模式 + 派生快照。 */
  get(): Promise<DeriveGetResult>;
  /** 设置当前会话之后创建 child 时使用的模式。 */
  set(mode: DeriveMode): Promise<OpResult>;
}

// ---------------------------------------------------------------------------
// 项目级"全局能力禁用"域
// ---------------------------------------------------------------------------

/** 面板视角的完整禁用状态（各域的禁用清单 + 统一存储路径）。 */
export interface ClientOverrides {
  mcp: string[];
  /**
   * 本项目默认禁用的**注入技能**名（宿主 registry 注入的内置 / 插件 /
   * preset 条目；磁盘技能的项目级禁停仍走 frontmatter + shadow stub）。
   * 旧宿主缺失该字段 ⇒ 视作空清单。
   */
  skills: string[];
  /**
   * v20.1（B2）：本项目**显式重新打开**的技能名（覆盖全局默认关闭）。
   * 旧宿主缺失 ⇒ 视作空清单。
   */
  enabledSkills?: string[];
  /**
   * v20.2：本项目**显式重新打开**的 MCP serverName（覆盖全局默认关闭）。
   * 旧宿主缺失 ⇒ 视作空清单。
   */
  enabledMcp?: string[];
  /**
   * v21：本项目默认关闭的 Tools 单元 id 列表（工作区覆盖「每工作区全局默认」）。
   * 旧宿主缺失 ⇒ 视作空清单。
   */
  tools?: string[];
  /** v21：本项目显式重新打开的 Tools 单元 id 列表（工作区覆盖）。旧宿主缺失 ⇒ 空。 */
  enabledTools?: string[];
  /** 统一存储文件绝对路径（`<dshHome>/dsh-capability-settings/capability-overrides.json`；无项目时缺省）。 */
  filePath?: string;
  /** 当前项目根（统一存储里该项目条目的 key；无项目时缺省）。 */
  projectRoot?: string;
}

/** v20.1（B2）/ v20.2：全局默认关闭层（独立文件 `capability-global-overrides.json`）。 */
export interface ClientGlobalOverrides {
  /** 全局默认关闭的 skill 名（空数组 = 全部默认启用）。 */
  skills: string[];
  /**
   * v20.2：全局默认关闭的 MCP serverName 列表（外部注入实例；空数组 = 全部默认启用）。
   * 旧宿主缺失该字段 ⇒ 适配器按空数组投影。
   */
  mcp: string[];
  /**
   * v21：全局默认关闭的 Tools 单元 id 列表（`tools-global.json` 的 disabled 在宿主侧
   * 取并集；这里只反映统一全局文件）。旧宿主缺失 ⇒ 适配器按空数组投影。
   */
  tools: string[];
  /**
   * v21：三域可见性（全部 / 指定工作区 / 不可见 + 每工作区默认开/关）。
   * 旧宿主 / v1 文件缺失 ⇒ 适配器投影为三域全空（全部可见、走兜底默认）。
   */
  visibility: ClientVisibilitySets;
  /** 文件绝对路径（UI 展示「开关只改这个文件」；旧宿主缺省）。 */
  filePath?: string;
  /**
   * 读取路径的可读错误（additive）：文件损坏时宿主返回空清单 + errors，
   * 面板据此显示一行警告而不是把整页拖成错误态。
   */
  errors?: string[];
}

/** 项目级禁用域的面板 API。 */
export interface OverridesApi {
  /** 当前项目的禁用声明全量（无工作区时返回空清单）。 */
  get(): Promise<ClientOverrides>;
  /**
   * 切换某个能力在本项目的**默认关闭**状态：不在清单里 → 加入（默认关闭）；
   * 已在清单里 → 移除（恢复默认开启）。落盘统一存储
   * `<dshHome>/dsh-capability-settings/capability-overrides.json`（按项目根分 key）；
   * 项目内旧声明（`.agents` / `.dsh` / `.claude`）只做兼容读取，首次写入时并入并删除。
   *
   * `domain` 取 `"skills"` 时只对注入技能生效（合法的 kebab-case 名）；
   * 写盘只改配置：**已有会话不受影响**（创建时的默认已冻结），只对新建会话生效；
   * 当前会话请用会话级开关（sessionCapabilities）。
   *
   * v20.2（`domain: "mcp"`）：宿主按 **B2 三态**落盘——`mcp`（关闭）/
   * `enabledMcp`（重新打开全局默认关闭项）二选一，优先级
   * 全局默认 < 工作区显式 < 会话显式。面板显式传 `options.enabled`；不传时
   * 翻转的是「有效默认」而不是 `mcp` 成员（旧调用方须注意）。
   *
   * v21（`domain: "tools"`）：同构三态，写项目 `tools` / `enabledTools`；
   * 工作区默认层覆盖「每工作区全局默认」（可见性弹层里配置的 defaultEnabled）。
   */
  toggle(domain: ClientCapabilityDomain, key: string, options?: { enabled?: boolean }): Promise<OpResult>;
  /**
   * v20.1（B2）：显式设置某个 skill 在**本项目**的默认启用/禁用（不是翻转）。
   *
   * - `enabled=false` → 加入项目 `skills`（工作区默认关闭）、从 `enabledSkills` 移除；
   * - `enabled=true` → 加入项目 `enabledSkills`（重新打开全局默认关闭项）、从 `skills` 移除。
   *
   * 落盘统一存储的 `projects.<项目根>`；宿主写盘后对同项目 live 会话 reconcile。
   * 契约未写死 RPC 名，adapter 目前复用 `overrides.toggle` 的 `enabled` 扩展参数
   * （见 api-adapter.ts / backend 对齐说明）。
   */
  setSkillDefault(input: { key: string; enabled: boolean }): Promise<OpResult>;
  /** v20.1（B2）：读取**全局默认关闭层**（独立文件，不修改技能文件本身）。 */
  globalGet(): Promise<ClientGlobalOverrides>;
  /**
   * v20.1（B2）/ v20.2：切换**全局默认**开关（独立文件，不改任何技能文件 /
   * 注入方配置）。
   *
   * - `domain: "skills"`：`disabled=true` = 全局默认关闭；`false` = 恢复默认启用。
   * - `domain: "mcp"`：写 `capability-global-overrides.json` 的 `mcp` 名单
   *   （外部注入实例；`key` = bridge serverName）。只写配置：**只影响新建会话**，
   *   已有会话保持创建时冻结的基线，不会被重新 restrict。
   * - v21 `domain: "tools"`：写 `tools` 名单（Tools 全局默认兜底；与
   *   `tools-global.json` 在宿主侧取并集）。
   */
  globalToggle(input: { domain: ClientCapabilityDomain; key: string; disabled: boolean }): Promise<OpResult>;
  /**
   * v21：保存某个能力的**可见性 + 每工作区默认开/关**（全局唯一控制层）。
   *
   * - `mode`：`"all" | "selected" | "none"`；
   * - `workspaces`：**整份**工作区映射（key = 项目根；面板提交完整映射，避免增量
   *   合并歧义；未配置的工作区缺省 = 可见 / 走兜底默认）。
   *
   * 写 `capability-global-overrides.json` v2 的 `visibility.<domain>.<key>`；成功后
   * 只写配置：默认/可见性变更**不热应用到已有会话**（新建会话才读取新配置）。
   */
  setVisibility(input: {
    domain: ClientCapabilityDomain;
    key: string;
    mode: ClientVisibilityMode;
    workspaces: Record<string, ClientWorkspaceVisibility>;
    /**
     * v21.1：冲突解决方式（仅当宿主返回 `code:"visibility-conflicts"` 后重试时传）。
     * - `keep`：保留冲突工作区现有的显式开启配置；
     * - `clear`：清除这些工作区的显式开启配置（其它默认不变）。
     */
    resolveConflicts?: ClientVisibilityConflictResolution;
  }): Promise<ClientSetVisibilityResult>;
}

// ---------------------------------------------------------------------------
// Jev 域（能力决策：配置 / 测试连接 / 评分 / 应用）
//
// 类型与宿主 `src/jev/types.ts` 同名同义（传输边界两侧各镜像一份，见架构
// §5.2）。与 skills/mcp 的关键差异：`rank` / `apply` 的业务失败**不抛出**，
// 原样返回 `{ ok:false, code, errors }`，前端按 `code` 做错误分类（架构 §9.7）。
// ---------------------------------------------------------------------------

/** 评分 / 测试 / 密钥解析失败的分类码（架构 §5.4）。 */
export type JevErrorCode =
  | "no-config"
  | "auth"
  | "rate-limit"
  | "overloaded"
  | "timeout"
  | "context-too-long"
  | "network"
  | "bad-request"
  | "empty-capabilities";

/** `setConfig` 的业务错误码。 */
export type JevSetConfigErrorCode = "invalid-config" | "write-failed";

/** `apply` 的业务错误码。 */
export type JevApplyErrorCode = "bad-request" | "write-failed";

/** 一次评分请求的 token 用量（宿主原样透传）。 */
export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
}

/** 自动触发（输入停顿后自动评分）的四个可配置门槛。 */
export interface JevAutoTrigger {
  /** 总开关，**默认 false**（默认关闭）。 */
  enabled: boolean;
  /** 停顿阈值（ms）：300–3000，步长 100，默认 1000。 */
  pauseMs: number;
  /** 最少触发字数：1–200，默认 10。 */
  minChars: number;
  /** 最少修改间隔字符数：1–100，默认 4。 */
  minEditChars: number;
}

/**
 * 配置文件 `~/.dsh/dsh-capability-settings/jev.json` 的完整形状。
 *
 * 客户端只镜像语义、不落盘；`apiKey` 仅在提交 `setConfig` 时单向下发，
 * 任何读取响应都不会带明文（架构 §4.2）。
 */
export interface JevConfig {
  /** 服务根地址（不含 `/v1/systemone`），默认 `https://api.typesafe.ai`。 */
  baseURL: string;
  /** 模型名，默认 `jev-latest`。 */
  model: string;
  /** 直接填写的密钥（可省略）。 */
  apiKey?: string;
  /** 承载密钥的环境变量名，默认 `TYPESAFE_API_KEY`。 */
  apiKeyEnv?: string;
  autoTrigger: JevAutoTrigger;
  /**
   * 「✦ 能力决策」结果面板的初始相关度阈值（0–1，默认 0.50）。
   *
   * additive：旧配置缺省时宿主回落默认值；只决定滑杆初值，首屏拖动不回写配置。
   */
  decisionThreshold: number;
  /** 单次 HTTP 尝试超时（ms），默认 30000。 */
  timeoutMs: number;
}

/** `setConfig` 的入参：字段均可选；`autoTrigger` 若提供必须是完整对象。 */
export type JevConfigInput = Partial<Omit<JevConfig, "autoTrigger">> & { autoTrigger?: JevAutoTrigger };

/** `jev.setConfig` 的 payload。 */
export interface JevSetConfigInput {
  config: JevConfigInput;
}

/**
 * `jev.getConfig` 的视图（**不含任何密钥明文**，架构 §4.2）。
 *
 * `apiKeyEnv` 是宿主 additive 字段（架构 §4.2 的补充，task-19）：返回已保存的
 * 环境变量名（默认 `TYPESAFE_API_KEY`，非明文），供配置页回显；宿主暂时缺失时
 * 前端退回默认值。
 */
export interface JevConfigView {
  baseURL: string;
  model: string;
  hasApiKey: boolean;
  apiKeySource: "env" | "file" | "none";
  /** 已保存密钥的末 4 位；无 key 为 null，短 key 为 `"****"`。 */
  apiKeyLast4: string | null;
  autoTrigger: JevAutoTrigger;
  /** 能力决策结果面板的初始相关度阈值（0–1，默认 0.50；additive）。 */
  decisionThreshold: number;
  timeoutMs: number;
  /** 已保存的环境变量名（additive，默认 TYPESAFE_API_KEY；缺省时前端兜底）。 */
  apiKeyEnv?: string;
}

/** 保存结果的字段级明细（宿主 additive 返回）。 */
export interface JevConfigIssue {
  field: string;
  code: string;
  message: string;
}

/** `jev.setConfig` 的返回：成功 `{ok:true}`；失败带错误码与可读错误。 */
export type JevSetConfigResult =
  | { ok: true }
  | { ok: false; code: JevSetConfigErrorCode; errors: string[]; issues?: JevConfigIssue[] };

/** `jev.test` 的返回：成功带回实际模型与首次尝试耗时。 */
export type JevTestResult =
  | { ok: true; model: string; latencyMs: number }
  | { ok: false; code: JevErrorCode; errors: string[] };

/** 一条被评分的能力（宿主枚举 + 打分 + 会话态投影）。 */
export interface JevRankItem {
  /** 稳定能力 id：`cap_<36 位小写 hex>`；apply 只认这个 id。 */
  id: string;
  /** v13：新增 `tool`（Tools 域 = 整插件一个评分单元）。 */
  kind: "skill" | "mcp" | "tool";
  name: string;
  description: string;
  /**
   * 能力作用域（additive）：项目 / 全局 / 注入（external）。旧宿主没有该
   * 字段；注入行以 `origin` 为准，缺失时按 `source` 回落。
   */
  source?: "project" | "global" | "external";
  /** 注入来源类别（additive；磁盘行缺省）。 */
  origin?: ClientSkillOrigin;
  /** 展示用注入方名（与面板 `channel` 同源）。 */
  channel?: string;
  /** registry provider id（诊断用）。 */
  provider?: string;
  /** true = 内容只读（启用/禁用仍可）。 */
  contentReadOnly?: boolean;
  /** true = 宿主注入（`@deepseek-ai/*` / 随包 / 宿主预设）：只读展示，不可开关。 */
  hostInjected?: boolean;
  /** 0..1 的 noul 分数；无答案记 0。 */
  score: number;
  /** 能力本身可启用（与 session 活性无关）。 */
  applicable: boolean;
  /** `applicable=false` 时的原因。 */
  reason?: string;
  /** 当前会话启用态（前端勾选初值 / 回显）。 */
  enabledInSession: boolean;
  /**
   * Tools 单元的工具数（v13 additive；`kind==="tool"` 时必有）。
   * 结果行的 `N 个工具` 灰标签用它。
   */
  toolCount?: number;
}

/** 冷会话排队应用的结果回执（宿主 additive 返回，读取即消费）。 */
export interface JevPendingOutcome {
  applied: number;
  failed: number;
  errors: string[];
  /** epoch ms。 */
  at: number;
}

/** `jev.rank` 的返回：成功分支携带完整评分结果；失败分支带分类码。 */
export type JevRankResult =
  | {
      ok: true;
      items: JevRankItem[];
      model: string;
      usage: JevUsage;
      elapsedMs: number;
      /** 逻辑批量请求数（重试不累加），恒为 1。 */
      requestCount: 1;
      capabilitiesTotal: number;
      pendingOutcome?: JevPendingOutcome;
    }
  | { ok: false; code: JevErrorCode; errors: string[] };

/** `apply` 跳过原因。 */
export type JevApplySkipReason =
  | "unknown-id"
  | "hard-disabled"
  | "not-restrictable"
  | "not-toggleable"
  | "host-injected"
  | "shadowed"
  | "already-applied";

/** 一条应用计划项（宿主按 id 重解析，不信任 name/target）。 */
export interface JevApplyPlanItem {
  id: string;
  /** v13：`tool` = Tools 插件单元（选中即启用该插件全部工具）。 */
  kind: "skill" | "mcp" | "tool";
  name: string;
  target?: string;
  /** 本期只支持「启用」。 */
  enabled: true;
}

/** 被跳过的计划项。 */
export interface JevApplySkipped {
  id: string;
  reason: JevApplySkipReason;
}

/** 应用失败的计划项。 */
export interface JevApplyFailed {
  id: string;
  reason: string;
}

/** `jev.apply` 的返回：成功分支含 applied/skipped/pending；失败分支带分类码。 */
export type JevApplyResult =
  | {
      ok: true;
      /** 生效条数（旧宿主语义 = 本次启用数；回滚后为 0）。 */
      applied: number;
      /**
       * additive（task-42 筛选语义）：本次实际启用条数。
       *
       * 旧宿主不返回；客户端缺失时回退 `applied`（旧宿主只会启用，不会关闭）。
       */
      enabled?: number;
      /** additive（task-42 筛选语义）：本次实际关闭条数；旧宿主缺失视为 0。 */
      disabled?: number;
      skipped: JevApplySkipped[];
      pending: boolean;
      failed?: JevApplyFailed[];
      errors?: string[];
      pendingOutcome?: JevPendingOutcome;
    }
  | { ok: false; code: JevApplyErrorCode; errors: string[] };

/** 成功分支的收窄别名（组件按需使用）。 */
export type JevRankSuccess = Extract<JevRankResult, { ok: true }>;
export type JevApplySuccess = Extract<JevApplyResult, { ok: true }>;

/**
 * Jev 域的面板 API。
 *
 * 与 skills/mcp 不同，`rank` / `apply` 的业务失败**不 throw**，原样返回带
 * `code` 的对象；只有传输层异常（RPC reject / sessionId 缺失）才抛。
 */
export interface JevApi {
  /** 读取全局配置视图（永远不含密钥明文）。 */
  getConfig(): Promise<JevConfigView>;
  /** 保存全局配置：成功不关闭配置页，由调用方决定是否重新读取。 */
  setConfig(input: JevSetConfigInput): Promise<JevSetConfigResult>;
  /**
   * 发一次最小探针（不落盘、不改会话开关）。
   *
   * - 不传 / 传 `{}`：用**已保存的配置**（旧行为）。
   * - 传 `{config: {config: JevConfigInput}}`：内层 `config` 与 `setConfig` 同形，
   *   adapter 把它原样作为 RPC payload `{config: JevConfigInput}` 透传；宿主以
   *   「当前磁盘配置 + 该 config」合并出**仅本次探针使用的临时配置**，用于
   *   AC-CFG-10「测试使用当前表单值且不写盘」。
   */
  test(input?: { config?: JevSetConfigInput }): Promise<JevTestResult>;
  /**
   * 为当前会话的全部可评分能力打分。
   * `sessionId` / `cwd` 由 adapter 从 api 依赖自动注入，组件只需传草稿。
   */
  rank(input: { draft: string; sessionId?: string; cwd?: string }, signal?: AbortSignal): Promise<JevRankResult>;
  /** 应用一份计划（由宿主按 id 重解析；冷会话走排队）。 */
  apply(input: { plan: JevApplyPlanItem[]; sessionId?: string; cwd?: string }): Promise<JevApplyResult>;
}

// ---------------------------------------------------------------------------
// Prompt 域（v23）：首轮注入的指令文件
//
// 与宿主 `src/prompt/types.ts` 同构（传输边界两侧各镜像一份）。语义：
//   - 全局与项目 prompt **叠加注入**（不是覆盖），每个文件独立启用；
//   - 渲染/去重/预算由宿主完成；客户端只展示与写策略。
// ---------------------------------------------------------------------------

/** 一个 prompt 文件的作用域。 */
export type ClientPromptScope = "user-global" | "agents-global" | "project";

/** 一个 prompt 文件在列表里的状态。 */
export type ClientPromptState =
  | "injected"
  | "truncated"
  | "omitted"
  | "disabled"
  | "invisible"
  | "duplicate"
  | "too-large"
  | "unreadable";

/** 面板/首屏看到的一个 prompt 文件。 */
export interface ClientPromptFile {
  id: string;
  name: string;
  path: string;
  displayPath: string;
  scope: ClientPromptScope;
  kind: "base" | "local";
  directory: string;
  size: number;
  mtimeMs: number;
  enabled: boolean;
  defaultEnabled: boolean;
  projectDefault?: boolean;
  sessionExplicit?: boolean;
  visibility?: { mode: ClientVisibilityMode; visible: boolean; defaultEnabled: boolean };
  state: ClientPromptState;
  duplicateOf?: string;
  order?: number;
}

/** 本会话冻结清单里的一个文件。 */
export interface ClientPromptManifestFile {
  id: string;
  path: string;
  displayPath: string;
  scope: ClientPromptScope;
  order: number;
  bytes: number;
  digest: string;
}

/** 本会话冻结清单（会话开始后只读）。 */
export interface ClientPromptManifest {
  sessionId: string;
  cwd: string;
  at: number;
  renderer: "host";
  files: ClientPromptManifestFile[];
  omitted: Array<{ displayPath: string }>;
  truncated: Array<{ displayPath: string; originalBytes: number; includedBytes: number }>;
  text?: string;
}

/** `prompt.list` 的返回。 */
export interface ClientPromptList {
  files: ClientPromptFile[];
  cwd: string;
  projectRoot: string;
  sessionId?: string;
  sessionSelected?: string[];
  frozen?: ClientPromptManifest;
  budget: { maxBytes: number; maxSourceBytes: number };
  /** 宿主渲染管线是否可用（false = 开关暂不生效，UI 提示降级）。 */
  engineAvailable: boolean;
  /** 全局 prompt 的完整可见性映射（用于整份写回 `setVisibility`）。 */
  visibility: Record<
    string,
    { mode: ClientVisibilityMode; workspaces: Record<string, ClientWorkspaceVisibility> }
  >;
  errors: string[];
}

/** `prompt.read` 的成功返回。 */
export interface ClientPromptRead {
  ok: true;
  id: string;
  path: string;
  size: number;
  content: string;
  truncated: boolean;
}

/** Prompt 域的面板/首屏 API。 */
export interface PromptApi {
  /** 列表：全局 + 项目候选（只含已存在文件）、策略默认、会话显式选择、冻结清单。 */
  list(input?: { cwd?: string; sessionId?: string }): Promise<ClientPromptList>;
  /** 读取正文（仅已识别候选；超限/不存在时抛错）。 */
  read(input: { path: string }): Promise<ClientPromptRead>;
  /** 保存正文（原子写；仅已识别候选、≤ 1 MiB）。 */
  save(input: { path: string; content: string }): Promise<void>;
  /** 写全局 prompt 的可见范围（整份替换）。 */
  setVisibility(input: {
    scope: "user-global" | "agents-global";
    mode: ClientVisibilityMode;
    workspaces?: Record<string, ClientWorkspaceVisibility>;
  }): Promise<void>;
  /** 写项目级默认（enabled=null = 删除覆盖、回到默认启用）。 */
  setProjectDefault(input: { cwd?: string; projectRoot?: string; path: string; enabled: boolean | null }): Promise<void>;
  /** 写会话首屏显式选择（null = 清除、跟随默认层 = 全选）。 */
  setSessionSelection(input: { sessionId?: string; selected: string[] | null; cwd?: string }): Promise<void>;
  /** 读会话冻结清单（会话页只读）。 */
  manifest(input: { sessionId: string }): Promise<ClientPromptManifest | undefined>;
}

// ---------------------------------------------------------------------------
// 面板根（跨域公共部分）
// ---------------------------------------------------------------------------

/** 项目下拉框里的一个工作区选项。 */
export interface WorkspaceOption {
  id: string;
  path: string;
  title?: string;
}

/** 面板需要的全部宿主能力（skills + mcp + tools + overrides + jev + 工作区选择），传输无关。 */
export interface CapabilityPanelApi {
  skills: SkillsApi;
  mcp: McpApi;
  /** Tools 域（v13）：插件单元列表 + 按会话开关。 */
  tools: ToolsApi;
  /** Prompt 域（v23）：首轮注入的指令文件。 */
  prompt: PromptApi;
  /** 会话级批量开关（v13 R1：`session.setBulk`）。 */
  session: SessionApi;
  /** 派生继承（spawn-time snapshot）：会话级模式 + 派生快照读取。 */
  derive: DeriveApi;
  overrides: OverridesApi;
  /**
   * Jev 能力决策域。配置页只用 `getConfig/setConfig/test`；`rank/apply` 需要
   * 会话上下文（composer 的每会话 api），在面板根 api 上调用会抛错。
   */
  jev: JevApi;
  /** 面板头部的"项目作用域"目录标签。 */
  workspaceLabel(): string;
  /**
   * 当前显式选中的工作区目录；`undefined` = **全局作用域**（面板默认，
   * 与当前对话所在工作区无关，v20.1 契约 §3.1）。
   */
  selectedProject(): string | undefined;
  /** 把面板作用域切到某个工作区路径（`undefined` = 回到全局）。 */
  selectProject(path: string | undefined): void;
  /** 项目下拉框可用的工作区列表。 */
  projects(): WorkspaceOption[];
  /**
   * 订阅当前工作区变化，供面板刷新头部标签并重拉项目作用域条目
   * （解析完成或切换时触发）。
   * @returns 取消订阅函数。
   */
  subscribeWorkspace(listener: () => void): () => void;
}