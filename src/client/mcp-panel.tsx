/**
 * Capability Panel 的 MCP 域视图（v20.1 能力中心）。
 *
 * 与 Skills 域**同构的两栏**：列表 + 详情。作用域唯一入口在根组件 header
 * （全局 / 工作区 ▾，工作区下拉列出全部工作区），**左栏 ScopeNav 已删除**，
 * 面板与当前对话所在工作区解耦、默认进入全局。列表标题栏固定写
 * 「全局 MCP」/「HtDot · MCP」+ 计数 + 作用域提示 + 内联「＋ 添加 MCP」。
 *
 * - **全局作用域**：`~/.agents/mcp.json` 条目（行尾开关 = 全局默认，写配置
 *   文件 `disabled`）；「外部注入」（其它插件 / profile 在运行时挂载的
 *   mcp-client）作为第二组，**配置只读、默认开关可写**：全局视图写独立文件
 *   `capability-global-overrides.json` 的 `mcp` 名单（不改注入方配置、不卸载实例）；
 * - **工作区作用域**：该工作区 `.mcp.json` 条目 + 引用的全局配置；行尾开关 =
 *   该工作区的默认（写项目 overrides，仅此工作区生效）；
 * - 按契约 §3.6：**不展示某会话的挂载状态**；连接健康以详情「查看工具与参数」
 *   的真实探测结果为准（零副作用，见 `mcp/probe.ts`）；
 * - 详情用同款两段作用域链（全局 → 工作区），只到工作区。
 *
 * 搜索框在根组件头部，由 `query` prop 传入，只过滤当前列表。行内不提供文字
 * 按钮：启用/编辑/删除/引用/探测/使用记录都在详情卡。
 *
 * @module dsh-capability-settings/client/mcp-panel
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  CapabilityPanelApi,
  ClientCapabilityVisibility,
  ClientGlobalOverrides,
  ClientMcpRuntimeServer,
  ClientMcpServer,
  ClientMcpTool,
  ClientMcpUsageView,
  ClientOverrides,
  McpApi,
  McpTestResult,
  OpResult,
} from "./api.js";
import { summarizeEntry, transportOf, validateEntry } from "../mcp/entry-util.js";
import { sanitizeDescriptorText, formatMaskedArgs } from "../shared/descriptor-text.js";
import type { McpScope, McpServerEntry } from "../mcp/types.js";
import { Modal } from "./modal.js";
import { ScopeChain } from "./scope-chain.js";
import { ToolParameterTable, toolParameters } from "./tool-schema.js";
import { SkpSelect } from "./select.js";
import { hasWorkspaceLabel, useAsyncList } from "./panel-common.js";
import {
  EMPTY_VISIBILITY_SETS,
  VisibilityDetailFields,
  VisibilityRowMeta,
  isRowInvisible,
  safeGlobalGet,
  safeOverridesGet,
  visibilityEntryOf,
  visibilityModeOf,
  visibleWorkspaceCountOf,
  workspaceOverrideOf,
  type VisibilityWorkspace,
  type WorkspaceOverrideState,
} from "./visibility.js";

/** 复合行 id：同一个 key 可能同时存在于 project 与 global 两个作用域。 */
function rowId(server: Pick<ClientMcpServer, "scope" | "key">): string {
  return `${server.scope}:${server.key}`;
}

/** 行摘要：单行省略（覆盖 `.skp-row-desc` 的两行 clamp，保证行高 72）。 */
const ROW_SUMMARY_STYLE: CSSProperties = {
  display: "block",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  WebkitLineClamp: "unset",
};

/** 详情头右侧的标签组（两个标签并排，无对应样式类）。 */
const HEAD_TAGS_STYLE: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, flex: "none" };

/** 检视区标题行右侧（计数 / 重新测试并排）。 */
const INSPECT_HEAD_RIGHT_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

/**
 * 一条配置条目行（v20.1：全局 / 工作区两种作用域共用同一行结构）。
 *
 * 点行 = 选中（详情卡跟着换）；行尾开关独立，不改变选中。开关语义由**当前
 * 作用域**决定：
 *   - 全局视图 = **全局默认**（写配置文件 `disabled`，所有工作区生效）；
 *   - 工作区视图 = **该工作区的默认**（写项目 overrides，仅此工作区生效）。
 * 行内不渲染文字按钮——启用/编辑/删除/导入/探测/使用记录全部在详情卡里。
 */
function McpServerRowImpl({
  server,
  scope,
  projectName,
  toolCount,
  visibilityEntry,
  projects,
  globalOff,
  invisible,
  overrideState,
  selected,
  busy,
  onSelect,
  onToggleDefault,
}: {
  server: ClientMcpServer;
  /** 当前面板作用域（global = 全局默认；workspace = 该工作区默认）。 */
  scope: "global" | "workspace";
  /** 工作区展示名（HtDot 口径，用于开关标签）。 */
  projectName?: string;
  /** 本次运行内探测成功回填的工具数（未探测时缺省 → 「工具数未知」）。 */
  toolCount?: number;
  /** v21：可见性配置（仅全局条目；项目原生 / 引用条目不参与）。 */
  visibilityEntry?: ClientCapabilityVisibility;
  /** v21：全部已知工作区（可见性标签 / 默认摘要）。 */
  projects: VisibilityWorkspace[];
  /** v21：兜底默认是否关闭（MCP 全局默认名单）。 */
  globalOff: boolean;
  /** v21：该能力对所有工作区不可见（全局视图行尾默认开关禁用）。 */
  invisible: boolean;
  /** v21：工作区视图下本工作区是否显式覆盖了默认（跟随 / 已覆盖）。 */
  overrideState: WorkspaceOverrideState;
  selected: boolean;
  /** 写操作进行中（同一时间只允许一个开关操作）。 */
  busy: boolean;
  /** v21.3：稳定回调（父级 ref 包装）——server 由行组件回传，保证 memo 生效。 */
  onSelect(server: ClientMcpServer): void;
  onToggleDefault(server: ClientMcpServer): void;
}) {
  const isGlobal = server.scope === "global";
  // 勾选态：全局视图 = 配置级 enabled；工作区视图 = 该工作区默认是否启用。
  const checked = scope === "global" ? server.enabled : isGlobal ? server.disabledInProject !== true : server.enabled;
  const dotClass = checked ? "skp-dot skp-dot-enabled" : "skp-dot skp-dot-hollow";
  /** 归属标签按「出身」：引用 / 旧版导入副本本质是全局条目，标「引用」「导入」。 */
  const scopeTag =
    server.reference === true
      ? { label: "引用", className: "skp-tag skp-tag-flat" }
      : server.importedFromGlobal === true
        ? { label: "导入", className: "skp-tag skp-tag-flat" }
        : isGlobal
          ? { label: "全局", className: "skp-tag skp-tag-global" }
          : { label: "本项", className: "skp-tag skp-tag-project" };
  const defaultOff = scope === "workspace" && isGlobal && server.disabledInProject === true;
  const switchLabel = invisible
    ? "不可见 · 不参与默认"
    : scope === "global"
      ? "全局默认"
      : `${projectName ?? "工作区"} 默认 · ${overrideState === "inherit" ? "跟随全局" : "已覆盖"}`;
  /** 只有全局视图的全局条目能编辑可见性（项目原生 / 引用不参与）。 */
  const showVisibility = scope === "global" && isGlobal;
  return (
    <li className={selected ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap"}>
      <button type="button" className={selected ? "skp-row skp-row-active" : "skp-row"} style={{ minHeight: 72 }} onClick={() => onSelect(server)}>
        <span className="skp-row-name">
          <span className={dotClass} title={checked ? "已启用" : "已关闭"} />
          <span className="skp-row-title" title={server.key}>
            {server.key}
          </span>
          <span className={scopeTag.className}>{scopeTag.label}</span>
        </span>
        <span className="skp-row-meta">
          <span className="skp-tag skp-tag-flat">{server.transport}</span>
          {!server.enabled && (
            <span className="skp-tag skp-tag-warn" title="配置文件里标记为 disabled；可在全局视图开关恢复">
              配置已禁用
            </span>
          )}
          {defaultOff && (
            <span className="skp-tag skp-tag-warn" title="该工作区默认关闭；只影响本工作区，可在本工作区重新打开">
              工作区默认关闭
            </span>
          )}
          {server.shadowed && (
            <span className="skp-tag skp-tag-directory" title="被本工作区内的同名条目遮蔽：本工作区的条目优先生效">
              被遮蔽
            </span>
          )}
          {showVisibility && (
            <VisibilityRowMeta
              entry={visibilityEntry}
              workspaces={projects}
              globalOff={globalOff}
              mode={server.visibilityMode ?? visibilityModeOf(visibilityEntry)}
              count={server.visibleWorkspaceCount ?? visibleWorkspaceCountOf(visibilityEntry, projects)}
              invisible={invisible}
            />
          )}
          {scope === "workspace" && overrideState !== "inherit" && isGlobal && (
            <span
              className="skp-tag skp-tag-warn"
              title={
                overrideState === "on"
                  ? "本工作区显式打开（覆盖全局的每工作区默认）"
                  : "本工作区显式关闭（覆盖全局的每工作区默认）"
              }
            >
              已覆盖
            </span>
          )}
          <span>
            {toolCount !== undefined
              ? `${toolCount} 个工具`
              : "工具数未知 · 详情可测试连接"}
          </span>
        </span>
        <span className="skp-row-desc" style={ROW_SUMMARY_STYLE} title={server.summary}>
          {server.summary}
        </span>
      </button>
      {/* v21 UX 修订：全局视图行尾不再有单开关（默认在「可见范围」里按工作区配）；
          工作区视图保留默认开关 = 本工作区覆盖。 */}
      {scope === "workspace" && (
        <label
          className="skp-row-toggle"
          title={
            checked
              ? "关闭：仅此工作区默认不启用（写项目覆盖，其它工作区不受影响）"
              : "打开：仅此工作区默认启用（写项目覆盖）"
          }
        >
          <span className="skp-row-default-label">{switchLabel}</span>
          <span className="skp-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label={`${switchLabel} ${server.key}`}
              checked={checked}
              disabled={busy}
              onChange={() => onToggleDefault(server)}
            />
            <span className="skp-switch-track" />
          </span>
        </label>
      )}
    </li>
  );
}

/** v21.3：列表行 memo 化（160+ 行时避免整表重渲）；回调由父级稳定引用驱动。 */
const McpServerRow = memo(McpServerRowImpl);

/**
 * 一条「外部注入」实例行：**配置只读、默认开关可写**。
 *
 * - 全局视图：开关 = **全局默认**（写独立文件 `capability-global-overrides.json`
 *   的 `mcp` 名单，所有工作区新建对话生效；不改注入方配置、不卸载共享实例）；
 * - 工作区视图：开关 = **本工作区默认**（写项目 overrides 的 `mcp` / `enabledMcp`
 *   三态，可覆盖全局默认）。
 *
 * 能否写由 `restrictable` 决定（工具在全局注册表可见才能 `tools.restrict` 屏蔽；
 * 按 agent 作用域注入的实例置灰 + tooltip 说明宿主契约上限）。
 */
/** 注入方展示名（R4）：优先 `channel`，没有则 undefined（不猜）。 */
function externalChannelOf(server: ClientMcpRuntimeServer): string | undefined {
  return typeof server.channel === "string" && server.channel.length > 0 ? server.channel : undefined;
}

/** true = 命名空间合成行（没有 mcp-client 实例，工具来自 `mcp__<ns>__*` 命名空间）。 */
function isSynthesized(server: ClientMcpRuntimeServer): boolean {
  return server.synthesized === true || server.origin === "namespace";
}

/** 外部注入实例「不可写」的统一 tooltip（宿主 `tools.restrict` 契约上限）。 */
const EXTERNAL_TOGGLE_BLOCKED_TITLE = "该实例按 agent 作用域注入，无法用 tools.restrict 屏蔽（宿主契约上限）";

/**
 * 工作区视图下外部实例的**有效默认关闭**（决定行尾开关 checked）：
 * 优先宿主投影的 `disabledInProject`（v20.2 = 全局默认 ∪ 工作区默认 − 工作区重新打开）；
 * 旧宿主缺该字段时退化到 `disabledGlobally`（全局视图口径）。
 */
function disabledInWorkspaceOf(server: ClientMcpRuntimeServer): boolean {
  return server.disabledInProject !== undefined ? server.disabledInProject : server.disabledGlobally === true;
}

/**
 * 外部实例的来源标签（v13 R4 两枚标签规则）：
 *   - 有 channel → `插件` + 插件名（第二枚等宽小标签）；
 *   - 命名空间合成且无映射 → `未识别`（琥珀，只此一枚）；
 *   - 其余 → `外部注入`（只此一枚）。
 */
function ExternalSourceTags({ server }: { server: ClientMcpRuntimeServer }) {
  const channel = externalChannelOf(server);
  if (channel !== undefined) {
    return (
      <>
        <span className="skp-tag skp-tag-plugin" title="插件注入的 MCP（来源由插件运行时注册）">
          插件
        </span>
        <span className="skp-tag skp-tag-channel" title={channel}>
          {channel}
        </span>
      </>
    );
  }
  if (isSynthesized(server)) {
    return (
      <span className="skp-tag skp-tag-warn" title="工具命名空间合成：来源未识别（不是宿主内置）">
        未识别
      </span>
    );
  }
  return (
    <span className="skp-tag skp-tag-readonly" title="运行时注入 · 未注册插件名">
      外部注入
    </span>
  );
}

/** 归属依据的人话标签（task-32：runtime/literal/table/similarity 等新依据）。 */
function externalAttributionLabel(server: ClientMcpRuntimeServer): string | undefined {
  switch (server.attribution?.matchedBy) {
    case "runtime":
      return "运行时捕获";
    case "literal":
      return "包扫描";
    case "table":
      return "人工映射";
    case "similarity":
      return "名字推测";
    default:
      return undefined;
  }
}

/** true = 来源含推测成分（MCP 详情同样加「推测」标识，不改变「配置只读」语义）。 */
function externalAttributionIsSpeculative(server: ClientMcpRuntimeServer): boolean {
  const attribution = server.attribution;
  if (attribution === undefined) return false;
  return (
    attribution.matchedBy === "similarity" || attribution.ambiguous === true || attribution.conflictsWithTable === true
  );
}

/** 详情「来源判定」文案（方案 §7.6；task-32 新依据优先用人话标签）。 */
function externalAttributionText(server: ClientMcpRuntimeServer): string {
  const channel = externalChannelOf(server);
  const matchedBy = server.attribution?.matchedBy;
  const basisLabel = externalAttributionLabel(server);
  if (basisLabel !== undefined) {
    const pattern = server.attribution?.pattern ?? server.attribution?.packageName;
    const target = channel ?? server.source;
    return `${basisLabel}${pattern !== undefined ? `：${pattern}` : ""}${target !== undefined && target !== pattern ? ` → ${target}` : ""}`;
  }
  if (channel !== undefined) {
    if (matchedBy === "namespace") {
      return `前缀 mcp__${server.attribution?.pattern ?? server.serverName}__ → ${channel}（插件清单映射表）`;
    }
    return `运行时注入来源：${server.attribution?.pattern ?? server.source ?? server.serverName} → ${channel}`;
  }
  return "来源未识别（不是宿主内置）";
}

/** 详情「注入方式」文案（R4：命名空间合成单独说明）。 */
function externalInjectionText(server: ClientMcpRuntimeServer): string {
  if (server.origin === "namespace") return "工具命名空间合成（不落盘、无 mcp-client 实例）";
  return server.origin === "entry" ? "loader 条目（profile patch insert）" : "动态 fiber（其它插件在 apply 中挂载）";
}

function McpExternalRowImpl({
  server,
  scope,
  projectName,
  globalDefaultDisabled,
  visibilityEntry,
  projects,
  invisible,
  overrideState,
  selected,
  busy,
  onSelect,
  onToggleDefault,
}: {
  server: ClientMcpRuntimeServer;
  scope: "global" | "workspace";
  projectName?: string;
  /**
   * 名字是否在**全局默认关闭名单**里（原始成员关系，来自 `overrides.globalGet`，
   * 与宿主行字段 `disabledGlobally` 取并集：旧宿主缺字段时仍能给出标签）。
   */
  globalDefaultDisabled: boolean;
  /** v21：可见性配置（外部注入实例同样按 serverName 存可见性）。 */
  visibilityEntry?: ClientCapabilityVisibility;
  /** v21：全部已知工作区（标签 / 默认摘要）。 */
  projects: VisibilityWorkspace[];
  /** v21：该实例对所有工作区不可见 ⇒ 默认开关禁用 + 标「不可见 · 不参与默认」。 */
  invisible: boolean;
  /** v21：工作区视图下本工作区是否显式覆盖了默认。 */
  overrideState: WorkspaceOverrideState;
  selected: boolean;
  busy: boolean;
  onSelect(server: ClientMcpRuntimeServer): void;
  onToggleDefault(server: ClientMcpRuntimeServer): void;
}) {
  /** 全局默认关闭（原始名单；宿主 `disabledGlobally` 为 true 时也必然是关闭）。 */
  const globalOff = globalDefaultDisabled || server.disabledGlobally === true;
  /** 当前视图的默认关闭态：全局视图看全局默认；工作区视图看本工作区有效默认。 */
  const defaultOff = scope === "global" ? globalOff : disabledInWorkspaceOf(server);
  /** 工具在全局注册表可见才可写（两种作用域同一判据；agent 作用域注入的不可）。 */
  const canToggle = server.restrictable;
  const checked = !defaultOff;
  const dot = checked ? { className: "skp-dot skp-dot-enabled", style: undefined } : { className: "skp-dot", style: { background: "var(--skp-warn)" } };
  const toolText = server.tools.length > 0 ? `${server.tools.length} 个工具` : "工具数未知";
  const meta = server.calls > 0 ? `${toolText} · 调用 ${server.calls} 次` : toolText;
  const summary = isSynthesized(server)
    ? "由工具命名空间合成 · 无 mcp-client 实例（配置只读）"
    : (server.summary ?? "运行时注入，由注入方管理（默认开关可写）");
  const switchLabel = invisible
    ? "不可见 · 不参与默认"
    : scope === "global"
      ? "全局默认"
      : `${projectName ?? "工作区"} 默认 · ${overrideState === "inherit" ? "跟随全局" : "已覆盖"}`;
  /** 行内状态标签：全局默认关闭 / 已覆盖全局默认 / 工作区默认关闭。 */
  const stateTag =
    scope === "global"
      ? globalOff
        ? { label: "全局默认关闭", title: "该实例在全局默认关闭名单里（所有工作区新建对话默认不启用）" }
        : undefined
      : globalOff
        ? defaultOff
          ? { label: "全局默认关闭", title: "继承全局默认关闭；本工作区未重新打开" }
          : { label: "已覆盖全局默认", title: "全局默认关闭，但本工作区已显式重新打开" }
        : defaultOff
          ? { label: "工作区默认关闭", title: "该工作区默认关闭；只影响本工作区" }
          : undefined;
  const switchTitle = invisible
    ? "该实例对所有工作区都不可见：不参与默认开关；先在「可见范围」里打开可见性"
    : !canToggle
    ? EXTERNAL_TOGGLE_BLOCKED_TITLE
    : scope === "global"
      ? checked
        ? "关闭：写入全局默认关闭名单（所有工作区新建对话默认不启用；不改注入方配置、不卸载共享实例）"
        : "打开：从全局默认关闭名单移除（恢复所有工作区默认启用）"
      : checked
        ? "关闭：仅此工作区默认不启用（写工作区覆盖，其它工作区不受影响）"
        : globalOff
          ? "打开：本工作区显式重新打开（覆盖全局默认关闭，写 enabledMcp）"
          : "打开：仅此工作区默认启用（写工作区覆盖）";
  return (
    <li className={selected ? "skp-row-wrap skp-row-wrap-active" : "skp-row-wrap"}>
      <button type="button" className={selected ? "skp-row skp-row-active" : "skp-row"} style={{ minHeight: 72 }} onClick={() => onSelect(server)}>
        {/* 名称行只放状态点 + serverName；来源两枚标签移到 meta 行。 */}
        <span className="skp-row-name">
          <span
            className={dot.className}
            style={dot.style}
            title={defaultOff ? (globalOff ? "全局默认关闭" : "本工作区默认关闭") : "运行时注入的实例"}
          />
          <span className="skp-row-title" title={server.serverName}>
            {server.serverName}
          </span>
          <span className="skp-tag skp-tag-warn" title="不是本插件配置文件里的条目：由其它插件 / profile 运行时注入（配置只读、默认开关可写）">
            外部注入
          </span>
        </span>
        <span className="skp-row-meta">
          <ExternalSourceTags server={server} />
          {externalChannelOf(server) === undefined && server.source !== undefined && (
            <span className="skp-tag skp-tag-flat">{server.source}</span>
          )}
          {server.transport !== undefined && <span className="skp-tag skp-tag-flat">{server.transport}</span>}
          {stateTag !== undefined && (
            <span className="skp-tag skp-tag-warn" title={stateTag.title}>
              {stateTag.label}
            </span>
          )}
          {scope === "global" && (
            <VisibilityRowMeta
              entry={visibilityEntry}
              workspaces={projects}
              globalOff={globalOff}
              mode={server.visibilityMode ?? visibilityModeOf(visibilityEntry)}
              count={server.visibleWorkspaceCount ?? visibleWorkspaceCountOf(visibilityEntry, projects)}
              invisible={invisible}
            />
          )}
          {scope === "workspace" && overrideState !== "inherit" && (
            <span
              className="skp-tag skp-tag-warn"
              title={overrideState === "on" ? "本工作区显式打开（覆盖全局的每工作区默认）" : "本工作区显式关闭（覆盖全局的每工作区默认）"}
            >
              已覆盖
            </span>
          )}
          <span>{meta}</span>
        </span>
        <span className="skp-row-desc" style={ROW_SUMMARY_STYLE} title={summary}>
          {summary}
        </span>
      </button>
      {/* v21 UX 修订：全局视图行尾不再有单开关；工作区视图保留默认开关。 */}
      {scope === "workspace" && (
        <label className="skp-row-toggle" title={canToggle ? switchTitle : EXTERNAL_TOGGLE_BLOCKED_TITLE}>
          <span className="skp-row-default-label">{switchLabel}</span>
          <span className="skp-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label={`${switchLabel} ${server.serverName}`}
              checked={checked}
              disabled={!canToggle || busy}
              onChange={() => onToggleDefault(server)}
            />
            <span className="skp-switch-track" />
          </span>
        </label>
      )}
    </li>
  );
}

/** v21.3：外部注入行同样 memo 化。 */
const McpExternalRow = memo(McpExternalRowImpl);

/** 路径最后一段（工作区名）；空串/纯分隔符回退为原串。 */
function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return at >= 0 ? trimmed.slice(at + 1) || trimmed : trimmed || path;
}

/**
 * MCP 视图主组件（v20.1）：**两栏**（列表 + 详情），不再有左栏 ScopeNav。
 *
 * - **全局作用域**：全局 `~/.agents/mcp.json` 条目（开关 = 全局默认，写配置文件
 *   `disabled`）+ 「外部注入」（配置只读，行尾开关写全局默认关闭名单）；
 * - **工作区作用域**：该工作区 `.mcp.json` 条目（本项目） + 引用的全局配置；
 *   行尾开关 = **该工作区的默认**（写项目 overrides，仅此工作区生效；外部注入
 *   行可覆盖全局默认）；
 * - **搜索**来自根组件头部输入框（`query` prop），只过滤当前列表；
 * - 列表标题栏固定「类型 + 作用域」+ 计数 + 内联「＋ 添加 MCP」，落点由
 *   当前作用域直接确定；行内没有文字按钮——启停/编辑/删除/导入/探测都在详情卡。
 * - 按契约 §3.6：不展示「某会话的挂载状态」（挂载是会话级事实），连接健康
 *   以详情页「查看工具与参数」的真实探测结果为准。
 */
export function McpView({
  api,
  query,
  projects,
  workspace,
  onSelectWorkspace,
  onCount,
}: {
  api: CapabilityPanelApi;
  /** 根组件头部搜索框的值（即时本地过滤当前列表；不跨作用域）。 */
  query: string;
  /** 全部已知工作区（作用域链入口选项；不再在左栏列出）。 */
  projects: Array<{ path: string; title?: string }>;
  /** 当前工作区路径（undefined = 全局作用域）。 */
  workspace?: string;
  /** 切换作用域（传 undefined = 回全局）。 */
  onSelectWorkspace(path?: string): void;
  /** 数据到达后上报当前作用域总数（域 Tab 计数）。 */
  onCount?: (total: number) => void;
}) {
  const mcpApi = api.mcp;
  const [opError, setOpError] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  /** 选中的「外部注入」实例（serverName）；与 selected 互斥。 */
  const [selectedExternalName, setSelectedExternalName] = useState<string | undefined>(undefined);
  /** 行尾默认开关最近一次操作失败的错误。 */
  const [defaultError, setDefaultError] = useState<string | undefined>(undefined);
  // 编辑态：undefined = 空闲；非空 = 正在弹窗里编辑这条 server（McpEditDialog）。
  const [editServer, setEditServer] = useState<ClientMcpServer | undefined>(undefined);
  // 新增弹窗开关（表单 / JSON 两种模式见 McpAddDialog）。
  const [addOpen, setAddOpen] = useState(false);
  /** 正在写开关的行 id（同一时间只允许一个，防重复提交）。 */
  const [busyKey, setBusyKey] = useState<string | undefined>(undefined);
  // 二次确认删除：记录“待确认的行 id”，再点一次才真正删除。
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>(undefined);
  // 二次确认导入覆盖：工作区内已有同名时记录“待确认的行 id”，再点一次带 overwrite。
  const [confirmImport, setConfirmImport] = useState<string | undefined>(undefined);
  /** 本次运行内探测成功回填的工具数（serverName → 工具数）；不落盘、不新增宿主字段。 */
  const [toolCounts, setToolCounts] = useState<Record<string, number>>({});
  /** v21：工作区视图的项目 overrides（判断「跟随全局默认 / 已覆盖」）。 */
  const [projectOverrides, setProjectOverrides] = useState<ClientOverrides | undefined>(undefined);
  /** 写操作计数：overrides 变化后重读项目覆盖态。 */
  const [writeVersion, setWriteVersion] = useState(0);

  const scope: "global" | "workspace" = workspace === undefined ? "global" : "workspace";
  const projectName =
    workspace === undefined ? undefined : (projects.find((project) => project.path === workspace)?.title ?? baseName(workspace));
  /**
   * 拉取 list + runtime + 全局默认关闭名单（挂载时、作用域变化时自动执行，写操作后
   * 显式 reload）。不再拉 `mcp.status`：面板不展示某会话的挂载状态（契约 §3.6）。
   *
   * 额外读一次 `globalGet`：宿主 `disabledGlobally` 已是原始名单成员（v20.2），
   * 这里取同一份名单做防御（旧宿主缺字段 / 工作区视图需要区分「继承」与
   * 「已覆盖」），复用已有 RPC 的 `mcp` 字段，不新增端点；失败不影响主列表。
   */
  const { data, loading, error, reload } = useAsyncList(
    async () => {
      const [list, runtime, globalOverrides] = await Promise.all([
        mcpApi.list(),
        // 运行时注入的 MCP（其它插件/profile 挂的 mcp-client）：配置只读展示，失败不影响主列表。
        mcpApi.runtime({ cwd: workspace }).catch(() => ({ servers: [], hiddenCount: 0 })),
        // 全局层（v20.2 默认关闭名单 + v21 可见性）：失败不影响主列表。
        safeGlobalGet(api),
      ]);
      return {
        servers: list.servers,
        listErrors: list.errors,
        listHiddenCount: list.hiddenCount ?? 0,
        runtimeServers: runtime.servers,
        runtimeHiddenCount: runtime.hiddenCount ?? 0,
        globalOverrides,
      };
    },
    [api, mcpApi, workspace],
    // v21.3：按作用域缓存，切回已访问作用域时同步出旧列表再后台刷新。
    { cacheKey: `mcp:${workspace ?? "global"}` },
  );
  const servers = data?.servers ?? [];
  const listErrors = data?.listErrors ?? [];
  const runtimeServers = data?.runtimeServers ?? [];
  const globalOverrides = data?.globalOverrides;
  const visibilitySets = globalOverrides?.visibility ?? EMPTY_VISIBILITY_SETS;
  /** v21：工作区视图被可见性隐藏的条目数（配置条目 + 外部实例）。 */
  const hiddenCount = scope === "workspace" ? (data?.listHiddenCount ?? 0) + (data?.runtimeHiddenCount ?? 0) : 0;

  /** 某 serverName 的可见性配置（配置条目与外部注入共用 serverName）。 */
  const visibilityOfName = (serverName: string): ClientCapabilityVisibility | undefined =>
    visibilityEntryOf(visibilitySets, "mcp", serverName);
  /** 兜底默认是否关闭（全局默认关闭名单原始成员；外部实例也看 disabledGlobally）。 */
  const globalOffOf = (serverName: string, disabledGlobally?: boolean): boolean =>
    globalOverrides?.mcp.includes(serverName) === true || disabledGlobally === true;
  const invisibleOf = (row: { visibilityMode?: string; visibleWorkspaceCount?: number; disabledByVisibility?: boolean }, entry: ClientCapabilityVisibility | undefined): boolean =>
    isRowInvisible(row as { visibilityMode?: "all" | "selected" | "none"; visibleWorkspaceCount?: number; disabledByVisibility?: boolean }, entry, projects);

  // v21：工作区视图读项目 overrides（判断「跟随全局默认 / 已覆盖」）。
  useEffect(() => {
    if (scope !== "workspace") {
      setProjectOverrides(undefined);
      return;
    }
    let alive = true;
    void safeOverridesGet(api).then((value) => {
      if (alive) setProjectOverrides(value);
    });
    return () => {
      alive = false;
    };
  }, [api, scope, workspace, writeVersion]);

  const globalServers = servers.filter((server) => server.scope === "global");
  const projectServers = servers.filter((server) => server.scope === "project");
  /** 工作区视图里因可见性被隐藏、不应渲染的全局配置条目（旧宿主自动过滤用）。 */
  const workspaceGlobalServers =
    scope === "workspace" ? globalServers.filter((server) => server.visibleInWorkspace !== false) : globalServers;
  /** 当前作用域总数（Tab 与列表标题共用同一口径；外部注入单独成组计数）。 */
  const scopeTotal =
    scope === "global" ? globalServers.length : projectServers.length + workspaceGlobalServers.length;

  useEffect(() => {
    if (data === undefined) return;
    onCount?.(scope === "global" ? globalServers.length : projectServers.length + workspaceGlobalServers.length);
  }, [data, scope, globalServers.length, projectServers.length, workspaceGlobalServers.length, onCount]);

  /** 作用域切换：清空选中与待确认态（详情跟走）。 */
  useEffect(() => {
    setSelected(undefined);
    setSelectedExternalName(undefined);
    setEditServer(undefined);
    setConfirmDelete(undefined);
    setConfirmImport(undefined);
  }, [scope, workspace]);

  const trimmedQuery = query.trim();
  const q = trimmedQuery.toLowerCase();
  const matchesServer = (server: ClientMcpServer) =>
    q.length === 0 ||
    server.key.toLowerCase().includes(q) ||
    server.serverName.toLowerCase().includes(q) ||
    server.summary.toLowerCase().includes(q);
  const matchesExternal = (server: ClientMcpRuntimeServer) =>
    q.length === 0 ||
    server.serverName.toLowerCase().includes(q) ||
    (server.channel ?? "").toLowerCase().includes(q) ||
    (server.source ?? "").toLowerCase().includes(q) ||
    (server.summary ?? "").toLowerCase().includes(q);
  const visibleGlobal = workspaceGlobalServers.filter(matchesServer);
  const visibleProject = projectServers.filter(matchesServer);
  // R4：有插件展示名的排前面（按展示名升序），无 channel 的排后面（按 serverName）。
  // v21：工作区视图里隐藏实例不渲染（宿主已过滤，这里防旧宿主）。
  const scenarioRuntimes =
    scope === "workspace" ? runtimeServers.filter((server) => server.visibleInWorkspace !== false) : runtimeServers;
  const visibleExternal = scenarioRuntimes
    .filter(matchesExternal)
    .sort((a, b) => {
      const aChannel = a.channel ?? "";
      const bChannel = b.channel ?? "";
      if (aChannel.length === 0 && bChannel.length > 0) return 1;
      if (bChannel.length === 0 && aChannel.length > 0) return -1;
      return aChannel.localeCompare(bChannel) || a.serverName.localeCompare(b.serverName);
    });
  const searching = trimmedQuery.length > 0;

  const selectedServer = servers.find((s) => rowId(s) === selected);
  const selectedExternal =
    selectedExternalName === undefined ? undefined : runtimeServers.find((s) => s.serverName === selectedExternalName);

  /** 执行一次写操作：失败写 opError；成功清错误并重拉列表。返回是否成功。 */
  const runOp = async (op: Promise<OpResult>): Promise<boolean> => {
    const result = await op;
    if (!result.ok) {
      setOpError(result.errors.join("; "));
      return false;
    }
    setOpError(undefined);
    reload();
    return true;
  };

  /**
   * 行尾默认开关（按作用域分派）：
   *   - 全局视图 → `mcp.setEnabled({scope:"global"})`（写配置文件 `disabled`）；
   *   - 工作区视图 → `overrides.toggle("mcp", key, { enabled })`（B2 三态，仅此工作区；
   *     显式传 enabled，避免宿主按「有效默认」翻转时写错名单）。
   */
  const toggleRow = async (server: ClientMcpServer) => {
    const id = rowId(server);
    if (busyKey !== undefined) return;
    // 当前勾选态（与 McpServerRow 的行内口径一致）：全局配置条目看配置级 enabled；
    // 全局视图看配置级 enabled；工作区视图的全局条目看本工作区有效默认。
    const current =
      scope === "global" ? server.enabled : server.scope === "global" ? server.disabledInProject !== true : server.enabled;
    setBusyKey(id);
    setDefaultError(undefined);
    try {
      const result =
        scope === "global"
          ? await mcpApi.setEnabled({ scope: "global", key: server.key, enabled: !server.enabled })
          : await api.overrides.toggle("mcp", server.key, { enabled: !current });
      if (!result.ok) setDefaultError(result.errors.join("; "));
    } catch (failure) {
      setDefaultError(String(failure));
    } finally {
      setBusyKey(undefined);
      setWriteVersion((value) => value + 1);
      reload({ silent: true });
    }
  };

  /**
   * 外部注入实例的行尾默认开关（v20.2：两种作用域都可写，限制只看 `restrictable`）：
   *   - 全局视图 → `overrides.globalToggle({domain:"mcp"})`，写全局默认关闭名单；
   *   - 工作区视图 → `overrides.toggle("mcp", serverName, { enabled })`，写工作区覆盖
   *     （B2 三态：全局默认关闭时「打开」写 `enabledMcp`）。
   * 都是「不卸载共享实例、只按会话重新 restrict」的写入路径。
   */
  const toggleExternal = async (server: ClientMcpRuntimeServer) => {
    const id = `external:${server.serverName}`;
    if (busyKey !== undefined || !server.restrictable) return;
    const checked = scope === "global" ? server.disabledGlobally !== true : !disabledInWorkspaceOf(server);
    setBusyKey(id);
    setDefaultError(undefined);
    try {
      const result =
        scope === "global"
          ? await api.overrides.globalToggle({ domain: "mcp", key: server.serverName, disabled: checked })
          : await api.overrides.toggle("mcp", server.serverName, { enabled: !checked });
      if (!result.ok) setDefaultError(result.errors.join("; "));
    } catch (failure) {
      setDefaultError(String(failure));
    } finally {
      setBusyKey(undefined);
      setWriteVersion((value) => value + 1);
      reload({ silent: true });
    }
  };

  /**
   * 导入这条**全局** server 到当前工作区：登记工作区级引用（内容跟随全局，
   * 启停是引用上的工作区级标记）。工作区内已有同名引用时进入“确认覆盖”态。
   */
  const onImport = async (server: ClientMcpServer) => {
    const id = rowId(server);
    const result = await mcpApi.importToProject({ key: server.key, overwrite: confirmImport === id });
    if (!result.ok) {
      if (result.existed === true) {
        setConfirmImport(id);
        return;
      }
      setOpError(result.errors.join("; "));
      return;
    }
    setOpError(undefined);
    setConfirmImport(undefined);
    reload();
  };

  /** 删除：第一次点击进入确认态；同一行再次点击才真正删除并清空选中。 */
  const onDelete = (server: ClientMcpServer) => {
    const id = rowId(server);
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(undefined);
    void runOp(mcpApi.remove({ scope: server.scope, key: server.key })).then((ok) => {
      if (ok) setSelected(undefined);
    });
  };

  /** 选中一条配置条目：清掉外部实例选中与所有待确认态。 */
  const selectServer = (server: ClientMcpServer) => {
    setSelected(rowId(server));
    setSelectedExternalName(undefined);
    setEditServer(undefined);
    setConfirmDelete(undefined);
    setConfirmImport(undefined);
  };

  /** 选中一个外部注入实例：与配置条目选中互斥。 */
  const selectExternal = (server: ClientMcpRuntimeServer) => {
    setSelectedExternalName(server.serverName);
    setSelected(undefined);
    setEditServer(undefined);
    setConfirmDelete(undefined);
    setConfirmImport(undefined);
  };

  /** 打开新增弹窗：落点由当前作用域固定（全局 / 此工作区），不再二次选择。 */
  const openAdd = () => {
    setEditServer(undefined);
    setAddOpen(true);
  };

  /**
   * v21.3：列表行 memo 需要稳定回调——用 ref 取最新实现，避免行组件因闭包
   * 函数每次重建而全量重渲。行组件把 server 回传给回调。
   */
  const rowActionsRef = useRef({ selectServer, selectExternal, toggleRow, toggleExternal });
  rowActionsRef.current = { selectServer, selectExternal, toggleRow, toggleExternal };
  const stableSelectServer = useCallback((server: ClientMcpServer) => rowActionsRef.current.selectServer(server), []);
  const stableToggleServer = useCallback((server: ClientMcpServer) => {
    void rowActionsRef.current.toggleRow(server);
  }, []);
  const stableSelectExternal = useCallback(
    (server: ClientMcpRuntimeServer) => rowActionsRef.current.selectExternal(server),
    [],
  );
  const stableToggleExternal = useCallback((server: ClientMcpRuntimeServer) => {
    void rowActionsRef.current.toggleExternal(server);
  }, []);

  /** 非空的服务器列表（组内滚动 + listbox 语义）。 */
  const renderServerScroll = (list: ClientMcpServer[], label: string) => (
    <div className="skp-group-scroll">
      <ul className="skp-list" role="listbox" aria-label={label}>
        {list.map((server) => {
          const isGlobal = server.scope === "global";
          const entry = isGlobal ? visibilityOfName(server.serverName) : undefined;
          return (
            <McpServerRow
              key={rowId(server)}
              server={server}
              scope={scope}
              projectName={projectName}
              toolCount={toolCounts[server.serverName]}
              visibilityEntry={entry}
              projects={projects}
              globalOff={globalOffOf(server.serverName)}
              invisible={isGlobal && invisibleOf(server, entry)}
              overrideState={
                scope === "workspace" && isGlobal
                  ? workspaceOverrideOf(projectOverrides, "mcp", server.serverName)
                  : "inherit"
              }
              selected={selected === rowId(server)}
              busy={busyKey !== undefined}
              onSelect={stableSelectServer}
              onToggleDefault={stableToggleServer}
            />
          );
        })}
      </ul>
    </div>
  );

  /** 空态：区分「还没有」与搜索「无匹配」，并给原地添加入口。 */
  const renderEmpty = () => {
    if (searching) return <div className="skp-empty">没有匹配「{trimmedQuery}」的 MCP。</div>;
    return (
      <div className="skp-empty">
        <div>{scope === "global" ? "全局还没有 MCP。" : `工作区 ${projectName ?? ""} 还没有 MCP。`}</div>
        <button type="button" className="skp-btn" style={{ marginTop: 10 }} onClick={openAdd}>
          {scope === "global" ? "添加全局 MCP" : "添加到此工作区"}
        </button>
      </div>
    );
  };

  /** 一个分组头（标题 + 计数 + 说明）。 */
  const renderGroupHead = (title: string, count: number, note: string) => (
    <div className="skp-list-group-head">
      <span className="skp-list-group-title">{title}</span>
      <span className="skp-group-count">{count}</span>
      <span className="skp-list-group-note">{note}</span>
    </div>
  );

  /**
   * 「外部注入」组（全局 / 工作区两个视图共用）：配置只读、行尾默认开关可写。
   * 组头备注按作用域说明写入落点；保留组头与计数，为空时不占位。
   */
  const renderExternalGroup = () =>
    visibleExternal.length > 0 ? (
      <section className="skp-group" role="group" aria-label={`外部注入（${visibleExternal.length}）`}>
        {renderGroupHead(
          "外部注入",
          scenarioRuntimes.length,
          scope === "global" ? "运行时注入 · 可设全局默认" : "运行时注入 · 可设本工作区默认",
        )}
        <div className="skp-group-scroll">
          <ul className="skp-list" role="listbox" aria-label="外部注入 MCP">
            {visibleExternal.map((server) => (
              <McpExternalRow
                key={`external:${server.serverName}`}
                server={server}
                scope={scope}
                projectName={projectName}
                globalDefaultDisabled={globalOffOf(server.serverName, server.disabledGlobally)}
                visibilityEntry={visibilityOfName(server.serverName)}
                projects={projects}
                invisible={invisibleOf(server, visibilityOfName(server.serverName))}
                overrideState={
                  scope === "workspace"
                    ? workspaceOverrideOf(projectOverrides, "mcp", server.serverName)
                    : "inherit"
                }
                selected={selectedExternalName === server.serverName}
                busy={busyKey !== undefined}
                onSelect={stableSelectExternal}
                onToggleDefault={stableToggleExternal}
              />
            ))}
          </ul>
        </div>
      </section>
    ) : null;

  /** 列表主体：全局 = 全局配置 + 外部注入；工作区 = 本项目 + 引用的全局配置 + 外部注入。 */
  const renderListBody = () => {
    if (loading && data === undefined) return <div className="skp-status">加载中…</div>;
    if (error !== undefined) return <div className="skp-error">读取失败：{error}</div>;
    if (scope === "global") {
      if (visibleGlobal.length === 0 && visibleExternal.length === 0) return renderEmpty();
      return (
        <div className="skp-group-scroll skp-group-scroll-plain">
          {visibleGlobal.length > 0 && (
            <>
              {renderGroupHead("全局配置", globalServers.length, "~/.agents/mcp.json")}
              {renderServerScroll(visibleGlobal, "全局配置 MCP")}
            </>
          )}
          {renderExternalGroup()}
        </div>
      );
    }
    if (visibleProject.length === 0 && visibleGlobal.length === 0 && visibleExternal.length === 0) {
      if (hiddenCount > 0) {
        return (
          <div className="skp-group-scroll skp-group-scroll-plain">
            <div className="skp-empty">本工作区没有可见的 MCP。</div>
            <div className="skp-pane-note">另有 {hiddenCount} 个能力未对此外工作区开放</div>
          </div>
        );
      }
      return renderEmpty();
    }
    return (
      <div className="skp-group-scroll skp-group-scroll-plain">
        {visibleProject.length > 0 && (
          <>
            {renderGroupHead(`本项目 · ${projectName ?? "工作区"}`, projectServers.length, "工作区独有")}
            {renderServerScroll(visibleProject, "本项目 MCP")}
          </>
        )}
        {visibleGlobal.length > 0 && (
          <>
            {renderGroupHead("引用的全局配置", workspaceGlobalServers.length, `默认开关作用于 ${projectName ?? "此工作区"}`)}
            {renderServerScroll(visibleGlobal, "引用的全局 MCP")}
          </>
        )}
        {renderExternalGroup()}
        {hiddenCount > 0 && (
          <div className="skp-pane-note" title="这些能力/实例在全局视图里未被开放给本工作区；请在全局视图的「可见范围」里开启">
            另有 {hiddenCount} 个能力未对此外工作区开放
          </div>
        )}
      </div>
    );
  };

  const listTitle = scope === "global" ? "全局 MCP" : `${projectName ?? "工作区"} · MCP`;
  const listNote = scope === "global" ? "所有工作区" : "仅此工作区";
  const addTitle = scope === "global" ? "添加 MCP 到全局" : `添加 MCP 到工作区 ${projectName ?? "工作区"}`;

  return (
    <div className="skp-domain">
      {listErrors.length > 0 && <div className="skp-error">{listErrors.join("\n")}</div>}
      {opError && <div className="skp-error">{opError}</div>}
      {defaultError !== undefined && <div className="skp-error">{defaultError}</div>}

      <div className="skp-body">
        {/* 列表栏：标题栏（类型 + 作用域 + 计数 + 内联添加）+ 分组列表。 */}
        <div className="skp-list-pane">
          <div className="skp-list-head">
            <span className="skp-list-title" title={listTitle}>
              <span className="skp-list-title-scope">{scope === "global" ? "全局" : (projectName ?? "工作区")}</span>
              <span className="skp-list-title-type">{scope === "global" ? " MCP" : " · MCP"}</span>
            </span>
            <span className="skp-group-count" title="当前作用域总数">
              {searching ? `${visibleProject.length + visibleGlobal.length} / ${scopeTotal}` : scopeTotal}
            </span>
            <span className="skp-list-note">{listNote}</span>
            {loading && data !== undefined && <span className="skp-refresh-note">刷新中…</span>}
            <span className="skp-detail-head-spacer" />
            <button
              type="button"
              className="skp-btn skp-btn-primary skp-list-add"
              title={addTitle}
              aria-label={addTitle}
              onClick={openAdd}
            >
              ＋ 添加 MCP
            </button>
          </div>
          {scope === "global" && (
            <div className="skp-pane-note">全局配置写入 ~/.agents/mcp.json · 所有工作区生效</div>
          )}
          {scope === "workspace" && (
            <div className="skp-pane-note">默认开关写入工作区覆盖 · 仅此工作区生效</div>
          )}
          {renderListBody()}
        </div>

        {/* 详情栏：作用域链（全局 → 工作区）+ 条目详情。 */}
        <div className="skp-detail skp-detail-fixed">
          {selectedExternal !== undefined ? (
            <McpExternalDetail
              key={selectedExternal.serverName}
              api={mcpApi}
              panelApi={api}
              server={selectedExternal}
              scope={scope}
              projectName={projectName}
              globalDefaultDisabled={globalOffOf(selectedExternal.serverName, selectedExternal.disabledGlobally)}
              visibilityEntry={visibilityOfName(selectedExternal.serverName)}
              projects={projects}
              globalOff={globalOffOf(selectedExternal.serverName, selectedExternal.disabledGlobally)}
              onVisibilitySaved={() => {
                setWriteVersion((value) => value + 1);
                reload({ silent: true });
              }}
              workspaces={projects}
              onSelectWorkspace={onSelectWorkspace}
            />
          ) : selectedServer ? (
            <McpDetail
              key={rowId(selectedServer)}
              api={mcpApi}
              panelApi={api}
              server={selectedServer}
              scope={scope}
              workspace={workspace}
              projectName={projectName}
              visibilityEntry={
                selectedServer.scope === "global" ? visibilityOfName(selectedServer.serverName) : undefined
              }
              projects={projects}
              globalOff={globalOffOf(selectedServer.serverName)}
              onVisibilitySaved={() => {
                setWriteVersion((value) => value + 1);
                reload({ silent: true });
              }}
              workspaces={projects}
              onSelectWorkspace={onSelectWorkspace}
              confirmingDelete={confirmDelete === rowId(selectedServer)}
              confirmingImport={confirmImport === rowId(selectedServer)}
              onEdit={() => setEditServer(selectedServer)}
              onToggle={() => {
                if (selectedServer.scope === "global") {
                  void runOp(mcpApi.setEnabled({ scope: "global", key: selectedServer.key, enabled: !selectedServer.enabled }));
                } else {
                  void runOp(mcpApi.setEnabled({ scope: selectedServer.scope, key: selectedServer.key, enabled: !selectedServer.enabled }));
                }
              }}
              onDelete={() => onDelete(selectedServer)}
              onImport={() => void onImport(selectedServer)}
              onToolCount={(count) =>
                setToolCounts((prev) => (prev[selectedServer.serverName] === count ? prev : { ...prev, [selectedServer.serverName]: count }))
              }
            />
          ) : (
            <div className="skp-detail-empty">
              {scopeTotal === 0
                ? "此作用域还没有 MCP。用列表标题栏的「＋ 添加 MCP」添加一个。"
                : "选择一个服务器查看详情，或新增一个。"}
            </div>
          )}
        </div>
      </div>

      {/* 新增弹窗：类型与落点由当前 Tab × 当前作用域固定（不再二次选择）。 */}
      {addOpen && (
        <McpAddDialog
          api={mcpApi}
          servers={servers}
          scope={scope === "global" ? "global" : "project"}
          workspace={workspace}
          projectName={projectName}
          onClose={() => setAddOpen(false)}
          onMutated={() => reload({ silent: true })}
        />
      )}
      {/* 编辑弹窗：与新增同款外壳（Modal + 内嵌表单）。 */}
      {editServer !== undefined && (
        <McpEditDialog
          api={mcpApi}
          server={editServer}
          workspace={workspace}
          onClose={() => setEditServer(undefined)}
          onSaved={() => reload()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 详情卡片
// ---------------------------------------------------------------------------

/**
 * 「使用记录」只读区：最近谁（哪个 session）在什么时候调用了该 server 的哪个 tool。
 *
 * 数据来自宿主内存（`tools.guard` 旁路记录，见 `mcp/usage.ts`）——插件/进程重载即
 * 清空、**不落盘**；打开期间每 2s 静默刷新。详情卡与「外部注入」详情共用这一块。
 */
function McpUsageSection({ api, serverName }: { api: McpApi; serverName: string }) {
  const [view, setView] = useState<ClientMcpUsageView | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const next = await api.usage({ serverName });
        if (cancelled) return;
        setView(next);
        setError(undefined);
      } catch (err) {
        if (cancelled) return;
        setError(String(err));
      }
      if (!cancelled) timer = window.setTimeout(() => void load(), 2000);
    };
    void load();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [api, serverName]);
  return (
    <>
      <div className="skp-detail-inspect-head">
        <span className="skp-field-label">使用记录</span>
        <span className="skp-test-stat">仅本次运行 · 不落盘{view === undefined ? "" : ` · 最近 ${view.limit} 条`}</span>
      </div>
      {error !== undefined && <div className="skp-error">{error}</div>}
      {view === undefined ? (
        <div className="skp-note">读取中…</div>
      ) : view.entries.length === 0 ? (
        <div className="skp-note">本次运行还没有调用记录。</div>
      ) : (
        <ul className="skp-usage">
          {/* 最新在上 */}
          {view.entries
            .slice()
            .reverse()
            .map((entry, index) => (
              <li key={`${entry.time}-${entry.tool}-${index}`} className="skp-usage-row">
                <span className="skp-usage-time" title={new Date(entry.time).toLocaleString()}>
                  {formatUsageTime(entry.time)}
                </span>
                <span className="skp-usage-session" title={entry.sessionId === "" ? undefined : entry.sessionId}>
                  {entry.sessionTitle ?? (entry.sessionId.length > 0 ? `对话 ${entry.sessionId.slice(-8)}` : "—")}
                </span>
                <code className="skp-usage-tool" title={entry.serverName}>
                  {entry.tool}
                </code>
              </li>
            ))}
        </ul>
      )}
    </>
  );
}

/**
 * MCP 详情的两段作用域链（全局 → 工作区，契约 §3.6：只到工作区）。
 *
 * 全局视图的第二段先展开工作区下拉，选中后才切到该工作区；工作区视图的
 * 第二段是真实状态。**不展示任何会话挂载状态**（挂载是会话级事实）。
 */
function McpScopeChain({
  scope,
  projectName,
  globalSeg,
  workspaceSeg,
  workspaces,
  onSelectWorkspace,
}: {
  scope: "global" | "workspace";
  projectName?: string;
  globalSeg: { on: boolean; title: string; note: string };
  workspaceSeg: { on: boolean; title: string; note: string };
  workspaces: Array<{ path: string; title?: string }>;
  onSelectWorkspace(path: string): void;
}) {
  return (
    <ScopeChain
      scope={scope}
      projectName={projectName}
      globalSeg={globalSeg}
      workspaceSeg={workspaceSeg}
      workspaces={workspaces}
      onSelectWorkspace={onSelectWorkspace}
    />
  );
}

/**
 * 「外部注入」MCP 的详情：**配置只读，默认开关可写**。
 *
 * 这些实例不在本插件配置文件里（其它插件/profile 在运行时挂的 mcp-client），
 * 配置与生命周期由注入方管理，能力面板不能编辑/删除/卸载；但**默认开关可写**：
 * 全局视图 = 全局默认关闭名单（独立文件 `capability-global-overrides.json`），
 * 工作区视图 = 本工作区默认（项目 overrides，可覆盖全局默认）；两者都不卸载
 * 共享实例，只按会话重新 `tools.restrict`。详情只展示能观察到的信息：来源插件、
 * 注入方式、命名空间、传输/命令摘要（能读到才有）、每个工具的说明与参数
 * （来自工具注册表，与「查看工具与参数」同源），以及使用记录。
 */
function McpExternalDetail({
  api,
  panelApi,
  server,
  scope,
  projectName,
  globalDefaultDisabled,
  visibilityEntry,
  projects,
  globalOff: globalOffProp,
  onVisibilitySaved,
  workspaces,
  onSelectWorkspace,
}: {
  api: McpApi;
  /** v21：可见性编辑需要面板级 api（`overrides.setVisibility`）。 */
  panelApi: CapabilityPanelApi;
  server: ClientMcpRuntimeServer;
  scope: "global" | "workspace";
  projectName?: string;
  /** 名字是否在全局默认关闭名单里（原始成员关系；见 McpExternalRow 同名字段）。 */
  globalDefaultDisabled: boolean;
  /** v21：可见性配置（按 serverName 存）。 */
  visibilityEntry?: ClientCapabilityVisibility;
  /** v21：全部已知工作区（可见性分段表格）。 */
  projects: VisibilityWorkspace[];
  /** v21：兜底默认是否关闭（与行内摘要同一口径）。 */
  globalOff: boolean;
  /** v21：可见性保存成功后的回调（父级重拉列表）。 */
  onVisibilitySaved: () => void;
  workspaces: Array<{ path: string; title?: string }>;
  onSelectWorkspace(path: string): void;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  // 「使用记录」：宿主内存里的 MCP 工具调用记录（只读、不落盘），打开才拉取。
  const [usageOpen, setUsageOpen] = useState(false);
  const hasTools = server.tools.length > 0;
  /** 全局默认关闭（原始名单；宿主 `disabledGlobally` 为 true 时也必然是关闭）。 */
  const globalOff = globalOffProp || globalDefaultDisabled || server.disabledGlobally === true;
  /** 本工作区有效默认关闭（含全局默认继承；本工作区重新打开后为 false）。 */
  const workspaceOff = disabledInWorkspaceOf(server);
  return (
    <div className="skp-detail-card">
      <div className="skp-detail-head">
        <h3>{server.serverName}</h3>
        <span style={HEAD_TAGS_STYLE}>
          <ExternalSourceTags server={server} />
          {externalAttributionIsSpeculative(server) && (
            <span className="skp-tag skp-tag-warn" title="来源为推测，请核对工具清单">
              推测
            </span>
          )}
          <span className="skp-tag skp-tag-flat" title="配置由注入方管理（只读）；默认开关可在列表行尾设置（可写）">
            配置只读
          </span>
        </span>
      </div>
      <McpScopeChain
        scope={scope}
        projectName={projectName}
        globalSeg={{
          on: !globalOff,
          title: globalOff ? "全局默认关闭" : "全局默认启用",
          note: "全局默认写 capability-global-overrides.json · 不改注入方配置",
        }}
        workspaceSeg={{
          on: !workspaceOff,
          title: !workspaceOff
            ? globalOff
              ? "已覆盖全局默认"
              : "默认启用"
            : globalOff
              ? "继承全局默认关闭"
              : "本工作区默认关闭",
          note: server.restrictable ? "行尾开关可写本工作区默认（不卸载共享实例）" : EXTERNAL_TOGGLE_BLOCKED_TITLE,
        }}
        workspaces={workspaces}
        onSelectWorkspace={onSelectWorkspace}
      />
      {externalAttributionIsSpeculative(server) && (
        <div className="skp-note skp-note-warn">来源为推测，请核对工具清单</div>
      )}
      {(server.attribution?.legacyUnit === true || typeof server.attribution?.legacyUnit === "string") && (
        <div className="skp-note" title={typeof server.attribution.legacyUnit === "string" ? `旧版键：${server.attribution.legacyUnit}` : undefined}>
          旧版键已迁移
        </div>
      )}
      <div className="skp-note">
        {isSynthesized(server)
          ? `配置只读：该实例由工具命名空间 mcp__${server.serverName}__* 合成（没有 mcp-client 实例，无配置可编辑）；默认开关可写（全局默认 / 本工作区）。`
          : `配置只读：该 MCP 由 ${externalChannelOf(server) ?? server.source ?? "其它插件"} 在运行时注入，能力面板不能编辑或删除；默认开关可写（全局默认 / 本工作区），不卸载共享实例。`}
      </div>
      <div className="skp-detail-actions">
        <button
          type="button"
          className="skp-btn"
          title={hasTools ? "查看该实例暴露的工具与参数（数据来自运行时工具注册表，不重新连接）" : "该实例的工具清单不可见（只能统计调用次数）"}
          onClick={() => setToolsOpen((open) => !open)}
        >
          {toolsOpen ? "收起工具与参数" : "查看工具与参数"}
        </button>
        <button type="button" className="skp-btn" onClick={() => setUsageOpen((open) => !open)}>
          {usageOpen ? "收起使用记录" : "使用记录"}
        </button>
      </div>
      <dl className="skp-detail-fields">
        <dt>来源</dt>
        <dd>{externalChannelOf(server) ?? server.source ?? "来源未识别"}</dd>
        <dt>来源判定</dt>
        <dd>{externalAttributionText(server)}</dd>
        <dt>注入方式</dt>
        <dd>
          {externalInjectionText(server)}
          {isSynthesized(server) ? "；无实例配置，传输方式未知" : ""}
        </dd>
        <dt>命名空间</dt>
        <dd>
          <code>mcp__{server.serverName}__*</code>
        </dd>
        {server.transport !== undefined && (
          <>
            <dt>传输方式</dt>
            <dd>
              {server.transport}
              {server.summary !== undefined ? ` · ${server.summary}` : ""}
            </dd>
          </>
        )}
        {scope === "global" && (
          <VisibilityDetailFields
            api={panelApi}
            domain="mcp"
            capabilityKey={server.serverName}
            name={server.serverName}
            entry={visibilityEntry}
            workspaces={projects}
            globalOff={globalOff}
            onSaved={onVisibilitySaved}
          />
        )}
        <dt>全局默认</dt>
        <dd>
          {globalOff
            ? "关闭（在「全局」作用域用列表行尾开关恢复；不改注入方配置、不卸载共享实例）"
            : "启用"}
        </dd>
        <dt>本工作区</dt>
        <dd>
          {!workspaceOff
            ? globalOff
              ? "已覆盖全局默认：本工作区显式重新打开"
              : "继承全局默认（启用）"
            : globalOff
              ? "继承全局默认（关闭）"
              : "本工作区默认关闭"}
        </dd>
        <dt>默认开关</dt>
        <dd>
          {server.restrictable
            ? "列表行尾开关可写：全局视图 = 全局默认（独立文件，所有工作区生效）；工作区视图 = 本工作区默认（可覆盖全局默认）。均不卸载共享实例。"
            : EXTERNAL_TOGGLE_BLOCKED_TITLE}
        </dd>
        <dt>本次运行调用</dt>
        <dd>{server.calls > 0 ? `${server.calls} 次` : "还没有调用记录"}</dd>
        <dt>管理</dt>
        <dd>
          {isSynthesized(server)
            ? "工具命名空间无法在这里编辑或卸载；请在注入方管理（默认开关仍可写）。"
            : "配置由注入方管理；能力面板不提供编辑/删除/卸载，但默认开关可写。"}
        </dd>
      </dl>
      {toolsOpen && (
        <div className="skp-detail-inspect">
          <div className="skp-detail-inspect-head">
            <span className="skp-field-label">工具与参数</span>
            <span className="skp-test-stat">{hasTools ? `${server.tools.length} 个工具 · 点击工具查看参数` : "工具清单不可见"}</span>
          </div>
          {hasTools ? (
            <ToolsInspector tools={server.tools} />
          ) : (
            <div className="skp-note">工具清单不可见（该实例按作用域注入，只能统计调用次数）。</div>
          )}
        </div>
      )}
      {usageOpen && (
        <div className="skp-detail-inspect">
          <McpUsageSection api={api} serverName={server.serverName} />
        </div>
      )}
    </div>
  );
}

/**
 * 配置条目详情：归属徽标 + 字段 + 写操作 + 「工具与参数」（真连一次探测，
 * 两栏工具/参数）/「使用记录」两个折叠区。
 *
 * 动作语义沿用现状：**项目条目** = 启用/禁用、编辑、删除（两击确认）；
 * **全局条目** = 「导入到本项目」（登记项目级引用，同名时两击确认）、编辑、
 * 删除；全局条目自身 disabled 时给一个直接的恢复入口。
 */
function McpDetail({
  api,
  panelApi,
  server,
  scope,
  workspace,
  projectName,
  visibilityEntry,
  projects,
  globalOff,
  onVisibilitySaved,
  workspaces,
  onSelectWorkspace,
  confirmingDelete,
  confirmingImport,
  onEdit,
  onToggle,
  onDelete,
  onImport,
  onToolCount,
}: {
  /** 面板 API：详情页的「查看工具与参数」直接复用 `mcp.test` 探测通道。 */
  api: McpApi;
  /** v21：可见性编辑需要面板级 api（`overrides.setVisibility`）。 */
  panelApi: CapabilityPanelApi;
  server: ClientMcpServer;
  /** 当前面板作用域（global / workspace）。 */
  scope: "global" | "workspace";
  /** 工作区作用域下的工作区路径。 */
  workspace?: string;
  /** 工作区展示名（HtDot 口径）。 */
  projectName?: string;
  /** v21：可见性配置（仅全局配置条目；项目原生 / 引用不参与）。 */
  visibilityEntry?: ClientCapabilityVisibility;
  /** v21：全部已知工作区（可见性分段表格）。 */
  projects: VisibilityWorkspace[];
  /** v21：兜底默认是否关闭（MCP 全局默认名单）。 */
  globalOff: boolean;
  /** v21：可见性保存成功后的回调（父级重拉列表）。 */
  onVisibilitySaved: () => void;
  /** 全部工作区（全局视图作用域链第二段的下拉选项）。 */
  workspaces: Array<{ path: string; title?: string }>;
  /** 选中工作区后切换面板作用域。 */
  onSelectWorkspace(path: string): void;
  confirmingDelete: boolean;
  confirmingImport: boolean;
  onEdit(): void;
  onToggle(): void;
  onDelete(): void;
  onImport(): void;
  /** 探测成功时回填工具数（行 meta 用；本次运行内缓存）。 */
  onToolCount?(count: number): void;
}) {
  const isGlobal = server.scope === "global";
  /** 工作区里来自全局导入的副本（条目带导入标记）：徽标按"出身"标「全局」。 */
  const imported = !isGlobal && server.importedFromGlobal === true;
  /** 工作区级引用（内容跟随全局，启停是工作区级标记；不提供「编辑」）。 */
  const isReference = server.reference === true;
  /** 移除按钮文案：全局导入的副本 = 「移出」（全局原版仍在全局区）；其余 = 「删除」。 */
  const removeVerb = imported ? "移出" : "删除";
  const hasWorkspace = workspace !== undefined;
  // 「查看工具与参数」：真连一次该条目（零副作用探测），用两栏检视器展开工具与参数。
  const [inspect, setInspect] = useState<{ open: boolean; testing: boolean; result?: McpTestResult }>({
    open: false,
    testing: false,
  });
  // 「使用记录」：宿主内存里的 MCP 工具调用记录（只读、不落盘）。
  const [usageOpen, setUsageOpen] = useState(false);
  // 换选中的服务器时收起并丢弃上一次的结果，避免把 A 的清单显示在 B 上。
  useEffect(() => {
    setInspect({ open: false, testing: false });
    setUsageOpen(false);
  }, [server.key, server.scope]);

  /** 跑一次探测；失败以 `{ ok:false, errors }` 归一（不抛异常，就地展示）。 */
  const runInspect = async () => {
    setInspect({ open: true, testing: true });
    try {
      const result = await api.test({ entry: server.entry, key: server.key });
      setInspect({ open: true, testing: false, result });
      if (result.ok) onToolCount?.(result.tools.length);
    } catch (error) {
      setInspect({ open: true, testing: false, result: { ok: false, errors: [String(error)] } });
    }
  };
  /** 两段作用域链：全局 → 工作区（不展示任何会话挂载状态）。 */
  const globalSeg = isGlobal
    ? {
        on: server.enabled,
        title: server.enabled ? "已配置 · 默认启用" : "已配置 · 配置内禁用",
        note: `来源：${server.filePath}`,
      }
    : { on: false, title: "未配置", note: "本项只存在于所选工作区" };
  const workspaceSeg = isReference
    ? {
        on: server.enabled,
        title: server.enabled ? "已引用 · 默认启用" : "已引用 · 已禁用",
        note: "来源：工作区引用（内容跟随全局配置）",
      }
    : isGlobal
      ? {
          on: server.disabledInProject !== true,
          title: server.disabledInProject === true ? "已关闭（覆盖）" : "默认启用",
          note:
            server.disabledInProject === true
              ? "来源：工作区覆盖 · 仅此工作区默认关闭"
              : "未配置工作区覆盖 · 跟随全局配置",
        }
      : {
          on: server.enabled,
          title: server.enabled ? "已配置 · 默认启用" : "已配置 · 配置内禁用",
          note: "来源：工作区 .mcp.json",
        };
  return (
    <div className="skp-detail-card">
      {/* 头部：标题 + 归属徽标。徽标按"出身"显示：与全局同源的工作区条目
          （引用 / 旧版导入副本）也标「全局」（绿）。 */}
      <div className="skp-detail-head">
        <h3>{server.key}</h3>
        <span style={HEAD_TAGS_STYLE}>
          <span
            className={isGlobal || imported ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project"}
            title={
              isGlobal
                ? server.shadowed
                  ? "全局服务器（对所有工作区生效）；当前被本工作区内的同名条目遮蔽"
                  : "全局服务器（对所有工作区生效）"
                : isReference
                  ? "本工作区内对全局服务器的引用（内容跟随全局，默认开关只作用于本工作区）"
                  : imported
                    ? "本工作区内来自全局导入的副本（遮蔽全局同名条目，控制只作用于本工作区）"
                    : "本工作区内的服务器（遮蔽全局同名条目）"
            }
          >
            {isGlobal || imported ? "全局" : "本项"}
          </span>
          {isReference && (
            <span className="skp-tag skp-tag-flat" title="引用：内容跟随全局，默认开关只作用于本工作区">
              引用
            </span>
          )}
        </span>
      </div>
      <McpScopeChain
        scope={scope}
        projectName={projectName}
        globalSeg={globalSeg}
        workspaceSeg={workspaceSeg}
        workspaces={workspaces}
        onSelectWorkspace={onSelectWorkspace}
      />
      <div className="skp-detail-actions">
        {/* 配置级启用/禁用：只对**工作区条目**渲染（全局条目的全局默认开关在列表行尾）。 */}
        {!isGlobal && !isReference && (
          <button
            type="button"
            className={`skp-btn ${server.enabled ? "skp-state-on" : "skp-state-off"}`}
            title={server.enabled ? "点击禁用（保留在配置文件中，不挂载）" : "点击启用（写入配置文件并挂载）"}
            onClick={onToggle}
          >
            {server.enabled ? "已启用" : "已禁用"}
          </button>
        )}
        {/* 全局条目自身 disabled（旧数据）时给一个恢复入口（只在全局作用域写全局配置）。 */}
        {isGlobal && !server.enabled && scope === "global" && (
          <button
            type="button"
            className="skp-btn skp-state-off"
            title="此全局服务器当前为禁用状态；点击恢复启用（对所有工作区生效）"
            onClick={onToggle}
          >
            已禁用
          </button>
        )}
        {/* 引用到本工作区：只对有工作区的全局条目渲染（登记工作区级引用）。 */}
        {isGlobal && hasWorkspace && (
          <button
            type="button"
            className={confirmingImport ? "skp-btn skp-btn-danger" : "skp-btn"}
            title={
              confirmingImport
                ? "工作区内已有同名引用，再次点击将重新登记（保留原启停状态，全局配置不变）"
                : "在本工作区登记对全局服务器的引用（内容跟随全局，可设置本工作区默认）"
            }
            onClick={onImport}
          >
            {confirmingImport ? "确认重复导入同名引用？" : "引用到本工作区"}
          </button>
        )}
        {/* 引用条目不提供「编辑」（内容就是全局条目，请到全局区编辑）。 */}
        {!isReference && (
          <button type="button" className="skp-btn" onClick={onEdit}>
            编辑
          </button>
        )}
        {/* 查看工具与参数：真连一次并列出描述/工具/参数（零副作用探测）。 */}
        <button
          type="button"
          className="skp-btn"
          disabled={inspect.testing}
          title={
            inspect.open
              ? "收起工具与参数"
              : "真连一次该服务器并列出它的描述、工具与参数（不落盘、不注册工具、不影响已挂载的连接）"
          }
          onClick={() => {
            if (inspect.open) setInspect({ open: false, testing: false });
            else void runInspect();
          }}
        >
          {inspect.testing ? "连接中…" : inspect.open ? "收起工具列表" : "查看工具与参数"}
        </button>
        {/* 使用记录：最近哪个对话在什么时候调用了这个 server 的哪个 tool（内存记录、不落盘）。 */}
        <button
          type="button"
          className="skp-btn"
          title="查看最近哪个对话在什么时候调用了这个 MCP 的哪个工具（仅本次运行的内存记录，不落盘）"
          onClick={() => setUsageOpen((open) => !open)}
        >
          {usageOpen ? "收起使用记录" : "使用记录"}
        </button>
        {/* 二次确认：confirmingDelete 时按钮变红并显示确认文案。 */}
        <button
          type="button"
          className={confirmingDelete ? "skp-btn skp-btn-danger" : "skp-btn skp-btn-danger-ghost"}
          title={
            isGlobal
              ? "删除此全局服务器；各工作区内的引用不受影响（变为悬空引用）"
              : isReference
                ? "移出本工作区（移除对全局服务器的引用，全局原版仍在全局区）"
                : imported
                  ? "移出本工作区（移除全局导入的副本，全局原版仍在全局区）"
                  : "删除本工作区中的这个服务器"
          }
          onClick={onDelete}
        >
          {confirmingDelete ? `确认${removeVerb}？` : removeVerb}
        </button>
      </div>
      {isReference && <div className="skp-note">引用：内容跟随全局配置，默认开关只作用于本工作区。</div>}
      <dl className="skp-detail-fields">
        {scope === "global" && isGlobal && (
          <VisibilityDetailFields
            api={panelApi}
            domain="mcp"
            capabilityKey={server.serverName}
            name={server.key}
            entry={visibilityEntry}
            workspaces={projects}
            globalOff={globalOff}
            onSaved={onVisibilitySaved}
          />
        )}
        <dt>命名空间</dt>
        <dd>mcp__{server.serverName}__*</dd>
        {typeof server.entry.description === "string" && server.entry.description.trim().length > 0 && (
          <>
            <dt>用途描述</dt>
            <dd>{server.entry.description}</dd>
          </>
        )}
        {/* 按传输方式展示不同字段：stdio 显示命令与参数，http 显示 URL。
            参数/URL 里可能内联凭据（`--header "Bearer …"`），显示前统一掩码。 */}
        {server.transport === "stdio" ? (
          <>
            <dt>命令</dt>
            <dd className="skp-path">{server.entry.command}</dd>
            {(server.entry.args ?? []).length > 0 && (
              <>
                <dt>参数</dt>
                <dd className="skp-path">{formatMaskedArgs(server.entry.args ?? [])}</dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt>URL</dt>
            <dd className="skp-path">{sanitizeDescriptorText(server.entry.url ?? "")}</dd>
          </>
        )}
        <dt>配置文件</dt>
        <dd className="skp-path">{server.filePath}</dd>
      </dl>
      {/* 「查看工具与参数」的结果排在使用记录之前（工具是详情主体），两栏检视器
          自身滚动，不会把详情页顶长到看不见操作按钮。 */}
      {inspect.open && (
        <div className="skp-detail-inspect">
          <div className="skp-detail-inspect-head">
            <span className="skp-field-label">工具与参数</span>
            <span style={INSPECT_HEAD_RIGHT_STYLE}>
              {inspect.result?.ok === true && inspect.result.tools.length > 0 && (
                <span className="skp-test-stat">点击工具查看参数</span>
              )}
              <button type="button" className="skp-link-btn" disabled={inspect.testing} onClick={() => void runInspect()}>
                {inspect.testing ? "连接中…" : "重新测试"}
              </button>
            </span>
          </div>
          {inspect.result === undefined ? (
            <div className="skp-note">正在连接并读取工具清单…</div>
          ) : (
            <ToolsReport result={inspect.result} />
          )}
        </div>
      )}
      {usageOpen && (
        <div className="skp-detail-inspect">
          <McpUsageSection api={api} serverName={server.serverName} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 新增 / 编辑表单
// ---------------------------------------------------------------------------

/**
 * 新增 / 编辑表单（分别内嵌在添加 / 编辑弹窗里，见 McpAddDialog / McpEditDialog）。
 *
 * 多行文本框承载 env / headers（每行 `KEY=VALUE`）与 args（每行一个参数），
 * 提交时解析成结构化字段。v20.1 起添加弹窗的**落点由当前作用域固定**
 * （`fixedScope`），表单不再二次选择类型/作用域；编辑态 scope 与 name 锁定
 * （改名 = 删除后重建）。
 *
 * `embedded` 为 true 时褪掉卡片外壳与自带标题，直接作为弹窗内容；
 * 此时按钮行由 `actionsClass` 指定落到弹窗底部的对齐方式。
 * onSave 抛错（如宿主校验/落盘失败）时把错误信息展示在表单顶部。
 */
function McpForm({
  api,
  mode,
  server,
  workspace,
  embedded,
  actionsClass = "skp-detail-actions",
  fixedScope,
  onCancel,
  onSave,
}: {
  api: McpApi;
  mode: "new" | "edit";
  server?: ClientMcpServer;
  workspace?: string;
  /** 内嵌到弹窗：去掉卡片外壳与自带标题，直接渲染字段。 */
  embedded?: boolean;
  /** 按钮行容器类；弹窗内传 `skp-modal-actions`（右对齐）。 */
  actionsClass?: string;
  /** 固定落点（添加弹窗）：给定后不再渲染作用域选择。 */
  fixedScope?: McpScope;
  onCancel(): void;
  onSave(scope: McpScope, key: string, entry: McpServerEntry): Promise<void>;
}) {
  // 编辑态用现有条目回填；新增态从空对象起步。
  const entry = server?.entry ?? {};
  const [scope, setScope] = useState<McpScope>(server?.scope ?? fixedScope ?? (workspace !== undefined ? "project" : "global"));
  const [key, setKey] = useState(server?.key ?? "");
  const [description, setDescription] = useState(typeof entry.description === "string" ? entry.description : "");
  const [transport, setTransport] = useState<"stdio" | "http">(server?.transport ?? "stdio");
  const [command, setCommand] = useState(entry.command ?? "");
  const [args, setArgs] = useState((entry.args ?? []).join("\n"));
  const [env, setEnv] = useState(recordToLines(entry.env));
  const [url, setUrl] = useState(entry.url ?? "");
  const [headers, setHeaders] = useState(recordToLines(entry.headers));
  const [timeoutMs, setTimeoutMs] = useState(entry.timeoutMs !== undefined ? String(entry.timeoutMs) : "");
  const [disabled, setDisabled] = useState(entry.disabled === true);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // 「测试连接」：结果（成功含工具清单 / 失败含错误文案）与进行中标志。
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<McpTestResult | undefined>(undefined);

  const isNew = mode === "new";

  /**
   * 从当前表单值构建条目（保存与测试共用同一口径，避免"能测不能存"漂移）。
   * 有校验问题时返回问题列表；测试与保存都直接展示这些问题。
   */
  const buildEntry = (): { ok: true; entry: McpServerEntry } | { ok: false; problems: string[] } => {
    const problems: string[] = [];
    if (key.trim().length === 0) problems.push("名称不能为空");
    if (transport === "stdio" && command.trim().length === 0) problems.push('stdio 服务器需要填写「命令」');
    if (transport === "http" && url.trim().length === 0) problems.push('http 服务器需要填写「URL」');
    const envRecord = linesToRecord(env, "env", problems);
    const headerRecord = linesToRecord(headers, "headers", problems);
    const timeout = timeoutMs.trim().length === 0 ? undefined : Number(timeoutMs);
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) problems.push("超时必须是正数（ms）");
    if (problems.length > 0) return { ok: false, problems };
    // 只把"有内容的可选字段"写进条目，保持配置文件最小化。
    // 「全局导入」标记随编辑保留（改字段不抹掉"来自全局导入"的身份）。
    const importMarker = entry.importedFromGlobal === true ? { importedFromGlobal: true as const } : {};
    const descriptionValue = description.trim();
    const descriptionField = descriptionValue.length > 0 ? { description: descriptionValue } : {};
    const next: McpServerEntry =
      transport === "stdio"
        ? {
            type: "stdio",
            command: command.trim(),
            args: linesToArray(args),
            ...descriptionField,
            ...(Object.keys(envRecord).length > 0 ? { env: envRecord } : {}),
            ...(timeout !== undefined ? { timeoutMs: timeout } : {}),
            ...(disabled ? { disabled: true } : {}),
            ...importMarker,
          }
        : {
            type: "http",
            url: url.trim(),
            ...descriptionField,
            ...(Object.keys(headerRecord).length > 0 ? { headers: headerRecord } : {}),
            ...(timeout !== undefined ? { timeoutMs: timeout } : {}),
            ...(disabled ? { disabled: true } : {}),
            ...importMarker,
          };
    return { ok: true, entry: next };
  };

  /** 保存（客户端前置校验与宿主 validateEntry 同口径，快速反馈）。 */
  const submit = async () => {
    const built = buildEntry();
    if (!built.ok) {
      setErrors(built.problems);
      return;
    }
    setSaving(true);
    try {
      await onSave(scope, key.trim(), built.entry);
      setErrors([]);
    } catch (error) {
      // 宿主校验 / 落盘失败：把错误展示在表单顶部（编辑态此前走面板级
      // opError，新增态弹窗内没有该通道，统一收敛到表单内）。
      setErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setSaving(false);
    }
  };

  /**
   * 「测试」：把当前表单草稿直接交给宿主真实连接（不落盘、不挂载），
   * 结果就地展示工具名与参数。失败只更新 testResult，不抛异常。
   */
  const runTest = async () => {
    const built = buildEntry();
    if (!built.ok) {
      setErrors(built.problems);
      setTestResult(undefined);
      return;
    }
    setErrors([]);
    setTesting(true);
    setTestResult(undefined);
    try {
      setTestResult(await api.test({ entry: built.entry, key: key.trim() }));
    } catch (error) {
      // 传输层异常（RPC 断线等）：按失败结果展示，不冒泡到渲染层。
      setTestResult({ ok: false, errors: [error instanceof Error ? error.message : String(error)] });
    } finally {
      setTesting(false);
    }
  };

  const busy = saving || testing;

  return (
    <div className={embedded ? undefined : "skp-detail-card"}>
      {!embedded && <h3>{isNew ? "添加 MCP" : `编辑 ${server?.key}`}</h3>}
      {errors.length > 0 && <div className="skp-error">{errors.join("\n")}</div>}
      <div className="skp-form">
        {/* 添加弹窗的落点由当前作用域固定（fixedScope），不再二次选择；编辑态锁定。 */}
        {fixedScope === undefined && (
          <label className="skp-field">
            <span className="skp-field-label">作用域</span>
            <SkpSelect
              value={scope}
              disabled={!isNew}
              ariaLabel="服务器作用域"
              options={[
                { value: "project", label: "工作区（.mcp.json）", disabled: !hasWorkspaceLabel(workspace) },
                { value: "global", label: "全局（~/.agents/mcp.json）" },
              ]}
              onChange={(value) => setScope(value === "project" ? "project" : "global")}
            />
          </label>
        )}
        <label className="skp-field">
          <span className="skp-field-label">名称</span>
          <input className="skp-input" value={key} disabled={!isNew} placeholder="github" onChange={(e) => setKey(e.target.value)} />
        </label>
        <label className="skp-field">
          <span className="skp-field-label">用途描述（可选，供 Jev 能力判断）</span>
          <textarea
            className="skp-input skp-textarea"
            value={description}
            placeholder="例如：连接 GitHub 仓库，读写 issue / PR / 文件"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="skp-field">
          <span className="skp-field-label">传输方式</span>
          <SkpSelect
            value={transport}
            ariaLabel="传输方式"
            options={[
              { value: "stdio", label: "stdio（启动本地命令）" },
              { value: "http", label: "http（流式 HTTP 端点）" },
            ]}
            onChange={(value) => setTransport(value === "http" ? "http" : "stdio")}
          />
        </label>
        {/* 按传输方式渲染对应字段：stdio → command/args/env；http → url/headers。 */}
        {transport === "stdio" ? (
          <>
            <label className="skp-field">
              <span className="skp-field-label">命令</span>
              <input className="skp-input" value={command} placeholder="npx" onChange={(e) => setCommand(e.target.value)} />
            </label>
            <label className="skp-field">
              <span className="skp-field-label">参数（每行一个）</span>
              <textarea className="skp-input skp-textarea" value={args} placeholder={"-y\n@modelcontextprotocol/server-github"} onChange={(e) => setArgs(e.target.value)} />
            </label>
            <label className="skp-field">
              <span className="skp-field-label">环境变量（每行 KEY=VALUE，支持 ${"${VAR}"}）</span>
              <textarea className="skp-input skp-textarea" value={env} placeholder={"GITHUB_TOKEN=${GITHUB_TOKEN}"} onChange={(e) => setEnv(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className="skp-field">
              <span className="skp-field-label">URL</span>
              <input className="skp-input" value={url} placeholder="http://localhost:3000/mcp" onChange={(e) => setUrl(e.target.value)} />
            </label>
            <label className="skp-field">
              <span className="skp-field-label">请求头（每行 KEY=VALUE）</span>
              <textarea className="skp-input skp-textarea" value={headers} onChange={(e) => setHeaders(e.target.value)} />
            </label>
          </>
        )}
        <label className="skp-field">
          <span className="skp-field-label">工具调用超时（ms，可选）</span>
          <input className="skp-input" value={timeoutMs} inputMode="numeric" placeholder="60000" onChange={(e) => setTimeoutMs(e.target.value)} />
        </label>
        <label className="skp-field skp-field-inline">
          <input type="checkbox" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />
          <span>禁用（保留在配置文件中，不挂载）</span>
        </label>
        {/* 测试结果：成功给出工具名 + 参数（名字/类型/是否必填/说明），
            失败给出宿主侧的中文错误文案（含原始错误 / stderr 摘要）。 */}
        {testing && <div className="skp-status">正在连接并读取工具列表…</div>}
        {testResult !== undefined && <ToolsReport result={testResult} />}
        <div className={actionsClass}>
          {/* 「测试连接」= 次级按钮，与保存同级：用当前表单草稿真实连一次
              （不落盘、不挂载），成功/失败都在表单内就地展示。 */}
          <button
            type="button"
            className="skp-btn"
            disabled={busy}
            title="用当前表单内容真实连接一次（不保存、不挂载），列出该服务器的工具与参数"
            onClick={() => void runTest()}
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
          <button type="button" className="skp-btn skp-btn-primary" disabled={busy} onClick={() => void submit()}>
            {saving ? (isNew ? "添加中…" : "保存中…") : isNew ? "添加" : "保存"}
          </button>
          <button type="button" className="skp-btn" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 工具与参数（两栏检视器）
// ---------------------------------------------------------------------------

/**
 * 「工具与参数」手风琴检视器（配置条目与外部注入共用）：
 *  - 每个工具一行，只显示工具名 + 参数个数（不显示 description）；
 *  - 点工具名在其**下方**展开参数表（参数 / 类型 / 必填 / 说明），再点收起；
 *    同一时间只展开一个工具；
 *  - 参数从 `tool.parameters` 的 `properties` + `required` 展开；无参数显示「无参数」。
 *
 * 展开/收起只改变本地状态，**不重新探测**（探测由调用方控制）；工具清单变化
 * （重新测试 / 换服务器）时若当前展开项已不存在则自动收起。
 */
function ToolsInspector({ tools }: { tools: readonly ClientMcpTool[] }) {
  // 手风琴：默认全部收起；点工具名展开其参数表，再点收起（同一时间只展开一个）。
  const [expandedName, setExpandedName] = useState<string | undefined>(undefined);
  useEffect(() => {
    setExpandedName((current) => (current !== undefined && tools.some((tool) => tool.name === current) ? current : undefined));
  }, [tools]);
  return (
    <div className="skp-tool-accordion" role="list">
      {tools.map((tool) => {
        const open = expandedName === tool.name;
        const parameters = toolParameters(tool.parameters);
        return (
          <div key={tool.name} className={open ? "skp-tool-item skp-tool-item-open" : "skp-tool-item"} role="listitem">
            <button
              type="button"
              className="skp-tool-trigger"
              aria-expanded={open}
              title={tool.name}
              onClick={() => setExpandedName(open ? undefined : tool.name)}
            >
              <span className="skp-tool-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
              <code className="skp-tool-name">{tool.name}</code>
              <span className="skp-tool-count">{parameters.length > 0 ? `${parameters.length} 个参数` : "无参数"}</span>
            </button>
            {open && (
              <div className="skp-tool-body">
                <ToolParameterTable parameters={parameters} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 「测试连接」/「查看工具与参数」的成功报告：状态行（连接正常 / 工具数 / 耗时）
 * + 服务器提示（默认折叠 3 行）+ 两栏工具/参数检视器。失败只展示错误块。
 */
function ToolsReport({ result }: { result: McpTestResult }) {
  if (!result.ok) return <div className="skp-error">{result.errors.join("\n")}</div>;
  const instruction = typeof result.instruction === "string" ? result.instruction.trim() : "";
  return (
    <div className="skp-test">
      <div className="skp-test-head">
        <span className="skp-tag skp-tag-global">连接正常</span>
        <span className="skp-test-stat">{result.tools.length} 个工具</span>
        <span className="skp-test-stat">耗时 {result.elapsedMs}ms</span>
      </div>
      {instruction.length > 0 && <McpInstruction text={instruction} />}
      {result.tools.length === 0 ? (
        <div className="skp-note">连接成功，但服务器未暴露任何工具。</div>
      ) : (
        <ToolsInspector tools={result.tools} />
      )}
    </div>
  );
}

/** 服务器提示（`instructions`）：默认折叠 3 行，点「展开/收起」切换。 */
function McpInstruction({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="skp-test-instruction">
      <div className="skp-test-instruction-head">
        <span className="skp-field-label">服务器提示</span>
        <button type="button" className="skp-link-btn" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "收起" : "展开"}
        </button>
      </div>
      <p className={expanded ? "skp-test-instruction-body" : "skp-test-instruction-body skp-clamp-3"}>{text}</p>
    </div>
  );
}

/**
 * 使用记录的时间列：当天只显示 `HH:mm:ss`，跨天补上 `MM-DD `（避免不同日期的
 * 记录看起来一样）。时间来自宿主 `Date.now()`，客户端本地时区格式化。
 */
function formatUsageTime(time: number): string {
  if (!Number.isFinite(time) || time <= 0) return "—";
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return sameDay ? clock : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
}

// ---------------------------------------------------------------------------
// 添加弹窗（表单 / JSON）
// ---------------------------------------------------------------------------

/**
 * 添加 MCP 服务器弹窗：与技能安装弹窗同构（Modal + 模式 Tab）。
 *
 * - 表单：沿用 McpForm（embedded 内嵌）逐字段填写单个条目；
 * - JSON：粘贴 .mcp.json 或裸服务器映射，实时预览后批量添加。
 */
function McpAddDialog({
  api,
  servers,
  scope,
  workspace,
  projectName,
  onClose,
  onMutated,
}: {
  api: McpApi;
  servers: ClientMcpServer[];
  /** 固定落点：global = ~/.agents/mcp.json；project = <工作区>/.mcp.json。 */
  scope: McpScope;
  workspace?: string;
  projectName?: string;
  onClose(): void;
  /** 任意写操作成功后刷新列表（不关闭弹窗）。 */
  onMutated(): void;
}) {
  const [tab, setTab] = useState<"form" | "json">("form");
  const isGlobal = scope === "global";
  const title = isGlobal ? "添加 MCP 到全局" : `添加 MCP 到工作区 ${projectName ?? "工作区"}`;
  const targetPath = isGlobal ? "~/.agents/mcp.json" : `${workspace ?? "<工作区>"}/.mcp.json`;
  return (
    <Modal title={title} onClose={onClose}>
      {/* 固定落点卡：作用域徽章 + 写入路径 + 与当前对话无关。 */}
      <div className="skp-landing">
        <div className="skp-landing-head">
          <span className="skp-landing-icon" aria-hidden="true">
            ⌖
          </span>
          <span className="skp-field-label">落点</span>
          <span className={isGlobal ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project"}>
            {isGlobal ? "全局" : `工作区 ${projectName ?? "工作区"}`}
          </span>
          <span className="skp-landing-note">仅此作用域生效 · 与当前对话无关</span>
          <span className="skp-detail-head-spacer" />
          <span className="skp-landing-hint">要换落点？先切换顶部作用域</span>
        </div>
        <code className="skp-landing-path" title={targetPath}>
          {targetPath}
        </code>
      </div>
      <div className="skp-tabs" role="tablist">
        {(["form", "json"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tab === t ? "skp-tab skp-tab-active" : "skp-tab"}
            onClick={() => setTab(t)}
          >
            {t === "form" ? "表单" : "JSON 粘贴"}
          </button>
        ))}
      </div>
      {/* 两个子面板常驻挂载：切 Tab 不丢已填内容。 */}
      <div hidden={tab !== "form"}>
        <McpForm
          api={api}
          mode="new"
          workspace={workspace}
          embedded
          actionsClass="skp-modal-actions"
          fixedScope={scope}
          onCancel={onClose}
          onSave={async (savedScope, key, entry) => {
            const result = await api.upsert({ scope: savedScope, key, entry });
            if (!result.ok) throw new Error(result.errors.join("; "));
            onMutated();
            onClose();
          }}
        />
      </div>
      <div hidden={tab !== "json"}>
        <McpJsonImport api={api} servers={servers} scope={scope} onClose={onClose} onMutated={onMutated} />
      </div>
    </Modal>
  );
}

/**
 * 编辑 MCP 服务器弹窗：与新增同款外壳（Modal + 内嵌 McpForm）。
 * 只含表单（JSON 批量导入只属于新增场景）；scope 与 name 在编辑态锁定
 * （改名 = 删除后重建，沿用 McpForm 的禁用态规避）。
 */
function McpEditDialog({
  api,
  server,
  workspace,
  onClose,
  onSaved,
}: {
  api: McpApi;
  server: ClientMcpServer;
  workspace?: string;
  onClose(): void;
  /** 保存成功后刷新列表（不关闭弹窗）。 */
  onSaved(): void;
}) {
  return (
    <Modal title={`编辑 ${server.key}`} onClose={onClose}>
      <McpForm
        api={api}
        mode="edit"
        server={server}
        workspace={workspace}
        embedded
        actionsClass="skp-modal-actions"
        onCancel={onClose}
        onSave={async (scope, key, entry) => {
          const result = await api.upsert({ scope, key, entry });
          if (!result.ok) throw new Error(result.errors.join("; "));
          onSaved();
          onClose();
        }}
      />
    </Modal>
  );
}

/** parseMcpJson 解析出的单个条目（键 + 原始条目）。 */
type ParsedMcpEntry = { key: string; entry: McpServerEntry };

/**
 * 解析"添加 MCP 服务器"的 JSON 文本为条目清单。
 *
 * 接受两种形状：
 *   - 完整配置文件：`{ "mcpServers": { … } }`（可直接粘贴 .mcp.json）；
 *   - 裸映射：`{ "github": { … }, "web": { … } }`。
 * 顶层必须是对象；逐条用与宿主同口径的 validateEntry 校验
 * （见 mcp/entry-util.ts），任一非法条目都会整体返回错误与逐条原因。
 */
function parseMcpJson(text: string): { ok: true; entries: ParsedMcpEntry[] } | { ok: false; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`] };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ['JSON 顶层必须是对象，例如 { "mcpServers": { … } } 或 { "服务器名": { … } }'] };
  }
  const root = data as Record<string, unknown>;
  // 裸映射的每个值都不是对象 → 更像"单条条目缺名称键"，给出明确提示。
  if (Object.keys(root).length > 0 && Object.values(root).every((v) => v === null || typeof v !== "object" || Array.isArray(v))) {
    return { ok: false, errors: ['看起来是单条服务器条目，缺少名称键；请用 { "服务器名": { … } } 包裹。'] };
  }
  // 完整配置文件取 mcpServers 键；否则把顶层本身当服务器映射。
  let servers: unknown;
  if (typeof root.mcpServers === "object" && root.mcpServers !== null && !Array.isArray(root.mcpServers)) {
    servers = root.mcpServers;
  } else if ("mcpServers" in root && Object.keys(root).length === 1) {
    return { ok: false, errors: ['「mcpServers」必须是服务器对象映射。'] };
  } else {
    servers = root;
  }
  const entries: ParsedMcpEntry[] = [];
  const problems: string[] = [];
  for (const [key, value] of Object.entries(servers as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      problems.push(`${key}: 条目必须是对象`);
      continue;
    }
    const entry = value as McpServerEntry;
    const entryProblems = validateEntry(key, entry);
    if (entryProblems.length > 0) {
      problems.push(`${key}: ${entryProblems.join("; ")}`);
      continue;
    }
    entries.push({ key, entry });
  }
  if (problems.length > 0) return { ok: false, errors: problems };
  if (entries.length === 0) return { ok: false, errors: ["没有可添加的服务器条目。"] };
  return { ok: true, entries };
}

/** JSON 文本框占位示例（两种形状都能贴）。 */
const JSON_PLACEHOLDER = `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "\${GITHUB_TOKEN}" }
    },
    "web": { "type": "http", "url": "http://localhost:3000/mcp" }
  }
}`;

/**
 * JSON 批量添加面板：粘贴 .mcp.json 或裸服务器映射，实时解析并预览
 * （新增 / 覆盖 / 跳过与逐条错误），确认后逐条写入。
 *
 * 逐条**串行** upsert：并发读写同一配置文件会互相覆盖（读-改-写竞态），
 * 串行保证每次写入都基于最新文件内容。
 */
function McpJsonImport({
  api,
  servers,
  scope,
  onClose,
  onMutated,
}: {
  api: McpApi;
  servers: ClientMcpServer[];
  /** 固定落点（由当前 Tab × 当前作用域决定，不再二次选择）。 */
  scope: McpScope;
  onClose(): void;
  onMutated(): void;
}) {
  const [text, setText] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opErrors, setOpErrors] = useState<string[]>([]);

  // 实时解析：文本一变预览区就刷新（整体非法时展示解析错误）。
  const parse = useMemo(() => parseMcpJson(text), [text]);

  // 预览行：标注每条的状态（将新增 / 将覆盖 / 已存在跳过），供确认与冲突提示。
  const preview = useMemo(() => {
    if (!parse.ok) return undefined;
    return parse.entries.map(({ key, entry }) => {
      const exists = servers.some((s) => s.scope === scope && s.key === key);
      return { key, entry, exists, overwriting: exists && overwrite, skipped: exists && !overwrite };
    });
  }, [parse, servers, scope, overwrite]);

  const addable = preview?.filter((item) => !item.skipped) ?? [];

  const doAdd = async () => {
    setBusy(true);
    setOpErrors([]);
    const failures: string[] = [];
    let added = 0;
    for (const { key, entry } of addable) {
      const result = await api.upsert({ scope, key, entry });
      if (result.ok) added += 1;
      else failures.push(`${key}: ${result.errors.join("; ")}`);
    }
    onMutated(); // 已写入的部分先刷新列表与冲突检测
    if (failures.length > 0) {
      setOpErrors([`已导入 ${added} 个，失败 ${failures.length} 个：`, ...failures]);
      setBusy(false);
      return;
    }
    onClose();
  };

  return (
    <div className="skp-form">
      <label className="skp-field">
        <span className="skp-field-label">JSON 配置</span>
        <textarea
          className="skp-input skp-textarea skp-json-field"
          value={text}
          spellCheck={false}
          placeholder={JSON_PLACEHOLDER}
          onChange={(e) => {
            setText(e.target.value);
            setOpErrors([]);
          }}
        />
        <span className="skp-note">支持完整 .mcp.json（含 mcpServers 键），或直接粘贴 {`{ "服务器名": { … } }`} 映射。</span>
      </label>

      {!parse.ok && text.trim().length > 0 && <div className="skp-error">{parse.errors.join("\n")}</div>}

      {preview !== undefined && preview.length > 0 && (
        <div className="skp-field">
          <span className="skp-field-label">将导入 {addable.length}/{preview.length} 个服务器</span>
          <ul className="skp-import-list">
            {preview.map(({ key, entry, overwriting, skipped }) => (
              <li key={key} className="skp-import-item">
                <span className="skp-import-name">{key}</span>
                <span className="skp-tag skp-tag-flat">{transportOf(entry)}</span>
                <span className="skp-import-desc">{summarizeEntry(entry)}</span>
                <span className={`skp-import-note ${overwriting ? "skp-import-note-over" : skipped ? "skp-import-note-skip" : "skp-import-note-add"}`}>
                  {overwriting ? "将覆盖" : skipped ? "已存在，跳过" : "将新增"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="skp-field skp-field-inline">
        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
        同名服务器已存在时覆盖
      </label>

      {opErrors.length > 0 && <div className="skp-error">{opErrors.join("\n")}</div>}

      <div className="skp-modal-actions">
        <button type="button" className="skp-btn" onClick={onClose}>
          取消
        </button>
        <button type="button" className="skp-btn skp-btn-primary" disabled={busy || addable.length === 0} onClick={() => void doAdd()}>
          {busy ? "导入中…" : `导入 ${addable.length} 个服务器`}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 文本帮助函数（KEY=VALUE 行 ⇄ 记录、一行一个 ⇄ 数组）
// ---------------------------------------------------------------------------

/** 记录 → 每行 `KEY=VALUE` 的文本（多行文本框回填用）。 */
function recordToLines(record: Record<string, string> | undefined): string {
  return Object.entries(record ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** 文本 → 记录；非法行（不以 `KEY=` 开头）记入 problems 并跳过。 */
function linesToRecord(text: string, field: string, problems: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) {
      problems.push(`${field}：行「${line}」不是 KEY=VALUE 格式`);
      continue;
    }
    out[line.slice(0, eq).trim()] = line.slice(eq + 1);
  }
  return out;
}

/** 文本 → 参数数组：按行拆分、trim、跳过空行。 */
function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
