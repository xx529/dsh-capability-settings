/**
 * Prompt 域（首轮注入的指令文件）的共享类型。
 *
 * 语义边界（与宿主 `@deepseek-ai/dsh-agent-instructions` 对齐）：
 *
 *   - 候选 = 全局 `$DSH_HOME/AGENTS.md`、`$DSH_AGENTS_HOME/AGENTS.md`，以及
 *     项目根（向上找 `.git`）到会话 cwd 每层的 `AGENTS.md` / `CLAUDE.md` +
 *     `AGENTS.local.md` / `CLAUDE.local.md`；
 *   - 全局与项目是**叠加注入**（不是覆盖）：每个文件独立启用，全部按顺序交给
 *     宿主渲染；只有同一候选组内容重复时由宿主去重；
 *   - 本插件**不自行拼接 / 去重 / 算预算**：渲染交给宿主导出的
 *     `loadBaselineInstructions`，我们只控制「传哪些文件给它」。
 *
 * @module dsh-capability-settings/prompt/types
 */

/** 文件来源作用域。 */
export type PromptScope = "user-global" | "agents-global" | "project";

/** 候选类型：基础候选 / 本地覆盖。 */
export type PromptKind = "base" | "local";

/** 一行的展示状态（面板 / 首屏 / 会话页共用）。 */
export type PromptState =
  /** 本会话/本工作区会注入 */
  | "injected"
  /** 被预算截断 */
  | "truncated"
  /** 被预算整份省略 */
  | "omitted"
  /** 默认关闭（项目默认 / 全局默认） */
  | "disabled"
  /** 全局可见性对本工作区关闭 */
  | "invisible"
  /** 同候选组内容重复，被宿主去重折叠 */
  | "duplicate"
  /** 单文件超过 maxSourceBytes，宿主静默跳过 */
  | "too-large"
  /** 读取失败 */
  | "unreadable";

/** 可见性模式（与 Skills / MCP 的可见性同构，但只作用于全局 prompt）。 */
export type PromptVisibilityMode = "all" | "selected" | "none";

/** 一个工作区在某个全局 prompt 上的可见性/默认。 */
export interface PromptWorkspaceVisibility {
  /** false = 该工作区不可见（优先于 mode=all）。 */
  visible?: boolean;
  /** 该工作区默认启用；缺省 = 宿主默认（启用）。 */
  defaultEnabled?: boolean;
}

/** 一个全局 prompt 的可见性配置。 */
export interface PromptVisibility {
  mode: PromptVisibilityMode;
  workspaces: Record<string, PromptWorkspaceVisibility>;
}

/** 面板/首屏看到的一个文件。 */
export interface PromptFileView {
  /** 绝对路径（唯一 id）。 */
  id: string;
  /** 文件名（AGENTS.md / CLAUDE.md / …）。 */
  name: string;
  /** 绝对路径。 */
  path: string;
  /** 模型可见路径（`~/.dsh/AGENTS.md` 或项目根相对路径）。 */
  displayPath: string;
  scope: PromptScope;
  kind: PromptKind;
  /** 所在目录（绝对路径）。 */
  directory: string;
  /** 字节数。 */
  size: number;
  /** 修改时间（ms）。 */
  mtimeMs: number;
  /** 当前视图下的有效启用态。 */
  enabled: boolean;
  /** 有效默认（无会话显式选择时的值）。 */
  defaultEnabled: boolean;
  /** 项目级默认（未显式设置时缺省）。 */
  projectDefault?: boolean;
  /** 本会话是否被显式勾选/取消（false = 显式关闭）。 */
  sessionExplicit?: boolean;
  /** 全局可见性摘要（仅全局 prompt）。 */
  visibility?: { mode: PromptVisibilityMode; visible: boolean; defaultEnabled: boolean };
  /** 展示状态。 */
  state: PromptState;
  /** 重复折叠时指向保留的那一份。 */
  duplicateOf?: string;
  /** 宿主渲染顺序（仅本会话冻结后可得）。 */
  order?: number;
}

/** 本会话冻结清单里的一个文件。 */
export interface PromptManifestFile {
  id: string;
  path: string;
  displayPath: string;
  scope: PromptScope;
  order: number;
  bytes: number;
  /** 全文 SHA-1（与宿主 `source.changes[].digest` 同口径）。 */
  digest: string;
}

/** 本会话冻结清单（会话开始后只读的权威来源）。 */
export interface PromptManifest {
  sessionId: string;
  cwd: string;
  /** 冻结时间（ms）。 */
  at: number;
  /** 渲染者：宿主导出函数（唯一实现）。 */
  renderer: "host";
  files: PromptManifestFile[];
  /** 被预算整份丢弃的文件。 */
  omitted: Array<{ displayPath: string }>;
  /** 被预算截断的文件。 */
  truncated: Array<{ displayPath: string; originalBytes: number; includedBytes: number }>;
  /** 渲染后的完整正文（只读展示用，不落盘到会话日志）。 */
  text?: string;
}

/** `prompt.list` 的返回。 */
export interface PromptListResult {
  files: PromptFileView[];
  cwd: string;
  /** 宿主语义的项目根（向上找 `.git`；找不到 = cwd）。 */
  projectRoot: string;
  sessionId?: string;
  /** 会话显式选择（未设置时缺省 = 跟随默认层）。 */
  sessionSelected?: string[];
  /** 本会话冻结清单（存在 = 已冻结，页面只读）。 */
  frozen?: PromptManifest;
  /** 宿主预算配置（用于状态条展示）。 */
  budget: { maxBytes: number; maxSourceBytes: number };
  /** 宿主渲染管线是否可用（false = 开关暂不生效，UI 需提示降级）。 */
  engineAvailable: boolean;
  /**
   * 全局 prompt 的完整可见性映射（逻辑作用域键 → `{mode, workspaces}`）。
   *
   * 面板写 `setVisibility` 是整份替换，必须拿到全部工作区 key 才能只改当前
   * 工作区而保留其它（含未在面板下拉里出现的工作区）。
   */
  visibility: Record<string, { mode: "all" | "selected" | "none"; workspaces: Record<string, { visible?: boolean; defaultEnabled?: boolean }> }>;
  /** 降级/读取错误（不阻断列表）。 */
  errors: string[];
}

/** `prompt.read` / `prompt.save` 的业务失败码。 */
export type PromptFailureCode = "unknown-file" | "too-large" | "not-text" | "write-failed";

/** 策略写操作的统一返回。 */
export type PromptMutation =
  | { ok: true }
  | { ok: false; errors: string[]; code?: PromptFailureCode };

/** `prompt.read` 的成功返回。 */
export interface PromptReadResult {
  ok: true;
  id: string;
  path: string;
  size: number;
  content: string;
  truncated: boolean;
}
