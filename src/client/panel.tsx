/**
 * Capability Panel 的 React 视图（占据**主区域**的页面，不再是浮层）。
 *
 * 入口在**侧栏上方**：本插件向 `sidebar.panellist`（ui-sidebar 的「全局
 * 面板」图标排，位于工作区列表之上、`sidebar.settings` 页脚之上）注册
 * `{ id: 'capability-panel', order: 30, label: '能力面板' }` 与图标本体，
 * 并向 `main` keyed slot 注册同名的 `key: 'capability-panel'` 页面组件。
 * 侧栏自己渲染按钮 / tooltip / label 文本，点击时把主区域切到该 key
 * （与 plugins / schedules / dsh-context 同构）；两者必须成对注册——侧栏
 * 选择没有对应 main 条目的 id 会抛错。浮层外壳、backdrop 与关闭按钮都已
 * 随之删除。
 *
 * **v20.1 信息架构（能力中心）**：只保留两条轴 + 一个解释层。
 *   1. 类型 = Tab（Skills / MCP / Tools，Jev 用分隔线单独成组）；
 *   2. 作用域 = 头部常驻分段控件（全局 / 工作区 ▾，工作区下拉列出全部
 *      工作区）——**面板与当前对话所在工作区完全解耦，默认进入全局**；
 *      `src/client.ts` 的面板 api `currentWorkspaceCwd = () => selection.cwd`
 *      （undefined = 全局，禁止 session fallback）；
 *   3. 详情 = 两段作用域链（全局 → 工作区，逐段标 继承 / 覆盖 / 来源）；
 *      **面板不涉及会话层级**，会话级开关在对话上方的「能力」Tab。
 *
 * 左栏 ScopeNav / 工作区列表已删除；列表标题栏固定写「类型 + 作用域」
 * （`全局 Skills` / `HtDot · Skills` / `HtDot · MCP`）+ 计数 + 作用域提示 +
 * 内联「＋ 添加 Skill / ＋ 添加 MCP」入口，弹窗落点由当前 Tab × 当前作用域
 * 直接确定（不再二次选择）。
 *
 * **两份 api，切勿合并（防回归）**：面板这份 api 的 cwd 只取用户在面板里
 * 显式选择的作用域；composer（输入框工具行 / 首屏入口）在 client.ts 中用
 * 单独的每会话 api，`currentWorkspaceCwd` 只取该会话自己的工作区。两者共用
 * 同一份 `subscribeWorkspace` 回调集合。若把面板这份 api 交给 composer，
 * 就会出现跨工作区串味 bug。
 *
 * 布局刻意保持朴素（自带 CSS 类，见 styles.ts），对未经确认的 UI 原语
 * 组件零硬依赖。
 *
 * @module dsh-capability-settings/client/panel
 */

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  CapabilityPanelApi,
  ClientCapabilityVisibility,
  ClientGlobalOverrides,
  ClientOverrides,
  ClientSkillSummary,
  SkillFilePayload,
  SkillsApi,
} from "./api.js";
import { McpView } from "./mcp-panel.js";
import { ToolsView } from "./tools-panel.js";
import { JevPanel } from "./jev-panel.js";
import { Modal } from "./modal.js";
import { ScopeChain } from "./scope-chain.js";
import { SkpSelect } from "./select.js";
import { isProjectSource, useAsyncList } from "./panel-common.js";
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
} from "./visibility.js";
import { SkillContent, skillRefOf } from "./skill-content.js";
import { isGlobalSkillSource } from "../shared/skill-sources.js";
import { locateSkillRoot, rerootEntries, stripCommonTopFolder } from "../shared/skill-locate.js";
import { unzip } from "./unzip.js";
import { base64ToBytes, buildZip, downloadBytes } from "./zip.js";

/**
 * 域 Tab 的取值（v13：Skills / MCP / Tools / Jev 模型四域）。
 * `jev` 是配置页而不是条目域：无计数、无搜索、无左导航（见 UX v1.8 §7.1）；
 * `tools` 是全局工具注册：无项目 / 工作区维度、无左导航（见 UX v1.8 §2.5）。
 * 导出给 client.ts 的 `openCapabilityPanel(domain?)` 复用。
 */
export type DomainTab = "skills" | "mcp" | "tools" | "jev";

/** 外部（client.ts）请求面板切域时派发的 window 自定义事件名。 */
const PANEL_DOMAIN_EVENT = "capability-panel:set-domain";

/**
 * 待应用的目标域：面板**尚未挂载**时，`openCapabilityPanel(domain)` 先把目标
 * 记在这里，由 CapabilityPanel 首次渲染读取并清空；面板已挂载时改用事件即时
 * 切换（见 setPanelDomain）。
 */
let pendingPanelDomain: DomainTab | undefined;

/**
 * 请求能力面板切到指定域（由 client.ts 的 `openCapabilityPanel(domain?)` 在
 * `layout.selectPanel("capability-panel")` 之前调用）。
 *
 * 覆盖两种时序：
 *   - 面板**已挂载**：派发 `capability-panel:set-domain`，组件监听后立即切 Tab；
 *   - 面板**未挂载**：目标留在模块级 pending，组件首次渲染直接落在该域
 *     （hero「去配置」因此能一步打开 Jev Tab，AC-ENT-4）。
 *
 * `undefined` = 保持当前域（无参打开面板的旧行为）。
 */
export function setPanelDomain(domain?: DomainTab): void {
  pendingPanelDomain = domain;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new window.CustomEvent(PANEL_DOMAIN_EVENT, { detail: domain }));
  } catch {
    /* 非浏览器/测试环境没有 CustomEvent：只走 pending 路径 */
  }
}

/** 域 Tab 的展示文案（当前硬编码中文，见 client.ts 的 locale 说明）。 */
const DOMAIN_LABEL: Record<DomainTab, string> = {
  // 全站命名统一（UX v1.8 §2.1）：技能 → Skills、MCP 服务器 → MCP、插件工具 → Tools。
  skills: "Skills",
  mcp: "MCP",
  tools: "Tools",
  jev: "Jev 模型",
};

const DOMAIN_ORDER: DomainTab[] = ["skills", "mcp", "tools", "jev"];

/**
 * 各域的搜索占位符（搜索框在根组件头部，切换域时切换文案）。
 * `jev` 域没有搜索框，故不在此表内（渲染处按 `domain !== "jev"` 隐藏）。
 */
const DOMAIN_SEARCH_PLACEHOLDER: Record<Exclude<DomainTab, "jev">, string> = {
  skills: "搜索 Skills…",
  mcp: "搜索 MCP…",
  tools: "搜索插件或工具…",
};

/**
 * 面板根组件：头部（标题 + 项目下拉框 + 域 Tab）+ 当前域视图。
 *
 * 它是主区域页面的本体（见 panel-entry.tsx 的 CapabilityPanelPage），自带
 * `.skp-panel`（height:100% / flex column），因此不再需要浮层外壳与关闭
 * 按钮——关闭 = 侧栏切换到别的主面板。
 */
export function CapabilityPanel({ api }: { api: CapabilityPanelApi }) {
  // 域、工作区列表、作用域选择各自维护一份 useState；起始值取自 api 快照方法。
  //
  // 初始域优先消费外部 pending（`setPanelDomain`）；初始化器只读不写，
  // 避开 React StrictMode 双调用初始化器的副作用问题，pending 由下方
  // effect 在挂载后清空。
  const [domain, setDomain] = useState<DomainTab>(() => pendingPanelDomain ?? "skills");
  /** 当前域的搜索词（搜索框在头部，按域切换 placeholder；切域清空）。 */
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState(() => api.projects());
  /** 面板作用域：undefined = 全局（默认），路径 = 用户选中的工作区。 */
  const [pinned, setPinned] = useState<string | undefined>(() => api.selectedProject());
  // 域 Tab 计数：由各域视图在数据到达后回填（加载中显示 —）。
  // 口径（v20.1 统一）：Tab 计数 = 该域全部条目总数（不随作用域/搜索变化）；
  // 列表标题栏显示「当前作用域可见数 / 当前作用域总数」。
  const [skillsCount, setSkillsCount] = useState<number | undefined>(undefined);
  const [mcpCount, setMcpCount] = useState<number | undefined>(undefined);
  const [toolsCount, setToolsCount] = useState<number | undefined>(undefined);
  /**
   * Jev 配置页在首次进入该 Tab 时挂载，之后**常驻**（用 active 控制显隐）：
   * 这样在同一面板会话内切到技能/MCP 再切回来，未保存的表单草稿仍在
   * （AC-CFG-16）；关闭能力面板后整棵子树卸载，草稿丢弃。
   * 若初始域就是 jev（pending），同样要挂载。
   */
  const [jevMounted, setJevMounted] = useState(() => pendingPanelDomain === "jev");

  // 消费 pending + 监听外部切域事件：挂载期间 `setPanelDomain(domain)` 会
  // 立即切 Tab（清空搜索词，沿用点 Tab 的既有规则）；卸载移除监听。
  useEffect(() => {
    pendingPanelDomain = undefined;
    const onSetDomain = (event: Event) => {
      pendingPanelDomain = undefined;
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail !== "skills" && detail !== "mcp" && detail !== "tools" && detail !== "jev") return;
      setDomain(detail);
      setQuery("");
      if (detail === "jev") setJevMounted(true);
    };
    window.addEventListener(PANEL_DOMAIN_EVENT, onSetDomain);
    return () => window.removeEventListener(PANEL_DOMAIN_EVENT, onSetDomain);
  }, []);

  // 工作区选项 / 作用域选择都会随「工作区列表变化、用户切换作用域」而变；
  // 数据源是快照（SnapshotStore），本身不具备响应性，所以订阅借由 adapter
  // 暴露的 subscribeWorkspace 手动同步。**面板不再监听当前对话工作区**：
  // 面板的 cwd 只取 selection（见 client.ts 契约 §3.1）。
  useEffect(() => {
    let alive = true;
    const update = () => {
      if (!alive) return;
      setProjects(api.projects());
      setPinned(api.selectedProject());
    };
    const unsub = api.subscribeWorkspace(update);
    update();
    return () => {
      alive = false; // 卸载后丢弃异步通知，避免对已卸载组件 setState
      unsub();
    };
  }, [api]);

  // Jev 域无条目计数（不是条目域，无「总数」语义），恒为 undefined。
  const counts: Record<DomainTab, number | undefined> = {
    skills: skillsCount,
    mcp: mcpCount,
    tools: toolsCount,
    jev: undefined,
  };

  const jevActive = domain === "jev";
  /** 作用域：未选择工作区 = 全局（面板默认，与当前对话无关）。 */
  // v21：Tools 也纳入可见性/工作区默认，三域共用同一作用域控件。

  const workspaceSelected = pinned !== undefined;
  const activeProject = pinned === undefined ? undefined : projects.find((project) => project.path === pinned);
  /** 工作区展示名：优先工作区 title，其次目录 basename（统一 HtDot 口径）。 */
  const projectName =
    pinned === undefined ? undefined : (activeProject?.title ?? basenameOf(pinned));
  /** 切换作用域：undefined = 全局；路径 = 该工作区。 */
  const selectWorkspace = (path: string | undefined) => api.selectProject(path);

  // 页面 chrome 由主区域提供（侧栏切换主面板 = 关闭）；这里只渲染
  // 标题行（标题 + 作用域分段）+ 域 Tab 与当前域视图。
  return (
    <section className="skp-panel" aria-label="能力面板">
      <header className="skp-header">
        <div className="skp-title-row">
          <div className="skp-title-main">
            <h2>能力中心</h2>
            {!jevActive &&
              (workspaceSelected ? (
                <>
                  <span className="skp-scope-badge">工作区视图</span>
                  <span className="skp-workspace" title={pinned}>
                    {projectName}
                  </span>
                </>
              ) : (
                <>
                  <span className="skp-scope-badge">全局视图</span>
                  <span className="skp-workspace">所有工作区生效</span>
                </>
              ))}
          </div>
          {!jevActive && (
            <div className="skp-title-tools">
              {/* 作用域唯一入口：全局 / 工作区（工作区段同时是全部工作区下拉）。 */}
              <div className="skp-scope-seg" role="group" aria-label="作用域">
                <button
                  type="button"
                  className={workspaceSelected ? "skp-scope-seg-btn" : "skp-scope-seg-btn skp-scope-seg-btn-active"}
                  aria-pressed={!workspaceSelected}
                  title="管理全局能力（所有工作区生效）"
                  onClick={() => selectWorkspace(undefined)}
                >
                  全局
                </button>
                <SkpSelect
                  className="skp-dd-scope skp-scope-seg-select"
                  value={pinned ?? ""}
                  title={workspaceSelected ? pinned : "从全部工作区中选择"}
                  ariaLabel="工作区作用域"
                  options={[
                    // 未选工作区时显示占位项（点击无副作用），让分段读作「工作区 ▾」。
                    ...(pinned === undefined ? [{ value: "", label: "工作区 ▾" }] : []),
                    ...projects.map((project) => ({
                      value: project.path,
                      label: `工作区 · ${project.title ?? basenameOf(project.path)}`,
                      ...(pinned === project.path ? { hint: "当前" } : {}),
                    })),
                    // 已选工作区不在已知列表里时也保留为选项，避免“消失”。
                    ...(pinned !== undefined && !projects.some((project) => project.path === pinned)
                      ? [{ value: pinned, label: `工作区 · ${basenameOf(pinned)}` }]
                      : []),
                  ]}
                  onChange={(value) => selectWorkspace(value === "" ? undefined : value)}
                />
              </div>
            </div>
          )}
        </div>
        {/* 第二行：域 Tab 在左，搜索框右对齐（同一个 input，按域切 placeholder）。 */}
        <div className="skp-header-row">
          <div className="skp-tabs" role="tablist">
            {DOMAIN_ORDER.map((d) => (
              <Fragment key={d}>
                {d === "jev" && <span className="skp-tab-sep" aria-hidden="true" />}
                <button
                  role="tab"
                  aria-selected={domain === d}
                  className={domain === d ? "skp-tab skp-tab-active" : "skp-tab"}
                  onClick={() => {
                    setDomain(d);
                    setQuery("");
                    // 首次进入 Jev 域才挂载配置页；之后常驻以保留未保存草稿。
                    if (d === "jev") setJevMounted(true);
                  }}
                >
                  <span>{DOMAIN_LABEL[d]}</span>
                  {/* Jev 不是条目域，无「总数」语义，不显示计数徽标（AC-CFG-1）。 */}
                  {d !== "jev" && <span className="skp-tab-count">{counts[d] ?? "—"}</span>}
                </button>
              </Fragment>
            ))}
          </div>
          {/* Jev 配置页没有搜索框：该 Tab 下整个 input 不渲染（不是禁用）。 */}
          {domain !== "jev" && (
            <input
              className="skp-search skp-header-search"
              type="search"
              aria-label={DOMAIN_SEARCH_PLACEHOLDER[domain]}
              placeholder={DOMAIN_SEARCH_PLACEHOLDER[domain]}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query.length > 0) {
                  event.preventDefault();
                  setQuery("");
                }
              }}
            />
          )}
        </div>
      </header>

      {jevActive ? null : domain === "tools" ? (
        <ToolsView api={api} workspace={pinned} projects={projects} query={query} onCount={setToolsCount} />
      ) : domain === "skills" ? (
        <SkillsView
          api={api}
          workspace={pinned}
          projects={projects}
          query={query}
          onSelectWorkspace={selectWorkspace}
          onCount={setSkillsCount}
        />
      ) : (
        <McpView
          api={api}
          workspace={pinned}
          projects={projects}
          query={query}
          onSelectWorkspace={selectWorkspace}
          onCount={setMcpCount}
        />
      )}
      {/* 常驻挂载：切走时仅 display:none，未保存草稿不丢（AC-CFG-16）。 */}
      {jevMounted && <JevPanel api={api} active={jevActive} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Skills 域视图
// ---------------------------------------------------------------------------

/** 技能行的复合 key：同名技能可能同时存在于两个作用域，必须带分组前缀。 */
function skillRowKey(item: Pick<ClientSkillSummary, "source" | "name">): string {
  const group = isProjectSource(item.source) ? "project" : "global";
  return `${group}:${item.source}:${item.name}`;
}

/** 调用状态三分：全启用 / 全禁用 / 部分禁用（仅其中一个方向被关）。 */
function invocationState(item: Pick<ClientSkillSummary, "modelInvocable" | "userInvocable">): "full" | "none" | "partial" {
  if (item.modelInvocable && item.userInvocable) return "full";
  if (!item.modelInvocable && !item.userInvocable) return "none";
  return "partial";
}

/** 注入来源的展示文案（与 Figma v12 标签语义一致）。 */
function originLabel(item: Pick<ClientSkillSummary, "origin">): string {
  return item.origin === "bundled" ? "内置" : item.origin === "preset" ? "预设" : "插件";
}

/** 注入来源标签的配色类（内置琥珀 / 插件紫 / 预设灰）。 */
function originTagClass(item: Pick<ClientSkillSummary, "origin">): string {
  return item.origin === "bundled" ? "skp-tag skp-tag-bundled" : item.origin === "preset" ? "skp-tag skp-tag-preset" : "skp-tag skp-tag-plugin";
}

/** 注入行的「来源 + 渠道」说明（详情页 meta 用）。 */
function injectedOriginText(item: Pick<ClientSkillSummary, "origin" | "channel" | "provider">): string {
  if (item.origin === "bundled") return "DSH 内置（随包提供）";
  if (item.origin === "preset") return `Agent 预设 · 仅在「${item.channel ?? "未知预设"}」的对话可见`;
  return item.channel !== undefined && item.channel.length > 0 ? `${item.channel} 运行时注入（不落盘）` : "插件运行时注入（不落盘）";
}

/** 注入行的只读原因条文案（详情页顶部）。 */
function injectedReadonlyNote(item: ClientSkillSummary): string {
  const channel = item.channel !== undefined && item.channel.length > 0 ? item.channel : "插件";
  if (item.origin === "bundled") {
    return "内容只读 · DSH 内置 Skills（无磁盘副本）；可在列表 / 本页启用或禁用，不可编辑或删除。";
  }
  if (item.origin === "preset") {
    return `内容只读 · 由 Agent 预设「${channel}」提供（无磁盘副本，仅绑定该预设的对话可见）；可在本页启用或禁用，不可编辑或删除。`;
  }
  return `内容只读 · 由插件 ${channel} 运行时注册（无磁盘副本）；可在列表 / 本页启用或禁用，不可编辑或删除。`;
}

/** 行左标签的排序与文案：scope → 格式 → 关系（最多 3 个）。 */
function skillTags(item: ClientSkillSummary, hasGlobal: boolean): Array<{ key: string; label: string; className: string; title?: string }> {
  const tags: Array<{ key: string; label: string; className: string; title?: string }> = [];
  if (item.injected === true) {
    // 注入行没有「全局/项目」磁盘归属：来源标签（内置/插件/预设）+ 格式 + 渠道名。
    tags.push({
      key: "origin",
      label: originLabel(item),
      className: originTagClass(item),
      title:
        item.origin === "bundled"
          ? "DSH 随包提供的 Skills（只读）"
          : item.origin === "preset"
            ? "由当前 Agent 预设渠道提供，只在绑定该预设的对话里可见"
            : "由插件在运行时注册的 Skills（只读）",
    });
    tags.push({
      key: "format",
      label: item.format === "directory" ? "目录" : ".md",
      className: "skp-tag skp-tag-flat",
      title: item.format === "directory" ? "目录型 Skills（SKILL.md + 其他文件）" : "单文件 Skills",
    });
    if (item.channel !== undefined && item.channel.length > 0) {
      tags.push({
        key: "channel",
        label: item.channel,
        className: "skp-tag skp-tag-channel",
        title: "注入方 / 渠道名（只读来源：没有可编辑的磁盘副本）",
      });
    }
    return tags;
  }
  const isProject = isProjectSource(item.source);
  tags.push(
    {
      key: "scope",
      label: isProject ? "本项" : "全局",
      className: isProject ? "skp-tag skp-tag-project" : "skp-tag skp-tag-global",
      title: isProject ? "仅存在于所选工作区的 Skills" : "全局 Skills，对所有工作区生效",
    },
    {
      key: "format",
      label: item.format === "directory" ? "目录" : ".md",
      className: "skp-tag skp-tag-flat",
      title: item.format === "directory" ? "目录型 Skills（SKILL.md + 其他文件）" : "单文件 Skills",
    },
  );
  if (item.readOnly) {
    tags.push({ key: "readonly", label: "只读", className: "skp-tag skp-tag-readonly", title: "只读来源，无法修改或删除" });
  } else if (isProject && item.shadowStub === true) {
    tags.push({
      key: "stub",
      label: "屏蔽占位",
      className: "skp-tag skp-tag-warn",
      title: "已生成屏蔽占位，使同名全局 Skills 在本工作区不可用；删除占位即恢复",
    });
  } else if (isProject && hasGlobal) {
    tags.push({ key: "override", label: "覆盖全局", className: "skp-tag skp-tag-relation", title: "本工作区生效的是这份副本；同名全局 Skills 被遮蔽" });
  } else if (!isProject && item.projectShadow === "stub") {
    tags.push({
      key: "disabled-in-project",
      label: "工作区默认关闭",
      className: "skp-tag skp-tag-warn",
      title: "该工作区已禁用同名全局 Skills；可在工作区作用域重新打开（不影响其它工作区）",
    });
  } else if (!isProject && item.projectShadow === "skill") {
    tags.push({
      key: "project-copy",
      label: "工作区副本生效中",
      className: "skp-tag skp-tag-readonly",
      title: "工作区已有同名 Skills，按优先级该工作区生效的是工作区副本",
    });
  }
  return tags;
}

/**
 * 全局视图的开关勾选态 = **全局默认是否启用**（v20.1 B2：独立
 * `capability-global-overrides.json`，不修改技能文件）。
 * 旧宿主没有 `globalDefaultDisabled` 时回退到旧的项目遮蔽口径。
 */
function globalDefaultEnabledOf(item: ClientSkillSummary): boolean {
  if (item.globalDefaultDisabled !== undefined) return !item.globalDefaultDisabled;
  if (item.projectShadow === "stub") return false;
  return item.disabledInProject !== true;
}

/**
 * 工作区视图的开关勾选态 = **有效默认值**（契约 §1.3：全局默认 < 工作区显式）。
 * 优先用宿主投影的 `effectiveDefaultEnabled`；旧宿主按可见字段回退。
 */
function effectiveDefaultEnabledOf(item: ClientSkillSummary): boolean {
  if (item.effectiveDefaultEnabled !== undefined) return item.effectiveDefaultEnabled;
  if (item.projectDefaultEnabled === true) return true;
  if (item.projectDefaultDisabled === true) return false;
  if (item.projectShadow === "stub") return false;
  return item.globalDefaultDisabled !== true && item.disabledInProject !== true;
}

/**
 * 行开关是否置灰 + tooltip。
 *
 * - 全局视图：写全局默认（独立文件）；注入行也可启停（readOnly 只限制内容编辑）；
 * - 工作区视图：项目磁盘条目的开关写 frontmatter（只读/无工作区时置灰）；
 *   全局 / 注入条目写「工作区显式启用/禁用」（B2）。
 *
 * 注意判序：`canToggleGlobal` 必须先于 `readOnly` 判——宿主 `skills.list` 里
 * **所有注入行**都带 `readOnly:true`（内容只读），把 readOnly 当开关禁用条件
 * 会把「插件注入 · 只读 · 可启停」整组错误置灰（verifier V20-05j）。
 */
function skillSwitchDisabled(
  item: ClientSkillSummary,
  scope: "global" | "workspace",
): { disabled: boolean; title: string } {
  /** true = 内容只读但开关可写（注入行）：readOnly 不拦启停。 */
  const contentOnlyReadOnly = item.readOnly && item.injected !== true;
  if (scope === "global") {
    if (item.canToggleGlobal === false) {
      return {
        disabled: true,
        title: item.globalToggleBlockedReason ?? "该条目由同层注入提供，无法设置全局默认",
      };
    }
    if (contentOnlyReadOnly) return { disabled: true, title: "只读来源，无法修改" };
    const enabled = globalDefaultEnabledOf(item);
    return {
      disabled: false,
      title: enabled
        ? "关闭：所有工作区默认不启用（写全局默认名单，不修改 Skills 文件；工作区可重新打开）"
        : "打开：恢复此 Skill 的全局默认启用",
    };
  }
  if (contentOnlyReadOnly) return { disabled: true, title: "只读来源（.claude 兼容目录），无法修改" };
  if (isProjectSource(item.source)) {
    if (item.shadowStub === true) {
      return { disabled: false, title: "打开：删除屏蔽占位，恢复同名全局 Skill 在本工作区可用" };
    }
    const on = item.modelInvocable && item.userInvocable;
    return {
      disabled: false,
      title: on ? "关闭：本工作区内的这份 Skill 模型与用户都不可调用（写 frontmatter）" : "打开：恢复模型与用户调用（写 frontmatter）",
    };
  }
  const enabled = effectiveDefaultEnabledOf(item);
  return {
    disabled: false,
    title: enabled ? "关闭：仅此工作区默认不启用（写项目覆盖）" : "打开：仅此工作区默认启用（可覆盖全局默认关闭）",
  };
}

/** 取路径最后一段作为工作区显示名（兼容 POSIX / Windows 分隔符）。 */
function basenameOf(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

/**
 * Skills 视图（v20.1）：**两栏**（列表 + 详情），不再有左栏 ScopeNav 与工作区列表。
 *
 *  - **全局作用域**（`workspace === undefined`）：列表 = 磁盘全局 Skills +
 *    宿主注入 Skills（按来源分组）；行尾开关写**全局默认**
 *    （`overrides.globalToggle` → `capability-global-overrides.json`）。
 *  - **工作区作用域**（`workspace` = 用户选中的工作区）：列表 = 本项目独有条目
 *    + 引用的全局能力（按来源分组）；行尾开关写**该工作区的有效默认**
 *    （B2：项目磁盘条目走 frontmatter，全局 / 注入条目走 overrides 显式启用/禁用）。
 *
 * 作用域入口只在根部 header（全局 / 工作区 ▾），本视图不提供第二套导航；
 * 列表标题栏固定「类型 + 作用域」与内联「＋ 添加 Skill」入口，类型与落点由
 * 当前 Tab × 当前作用域直接决定（弹窗不再二次选择）。
 *
 * 搜索词由根组件头部的同一输入框提供（query），只过滤当前列表；计数口径 =
 * Tab 与列表标题共享「当前作用域总数」，搜索时标题显示「匹配 / 总数」。
 */
function SkillsView({
  api,
  workspace,
  projects,
  query,
  onSelectWorkspace,
  onCount,
}: {
  api: CapabilityPanelApi;
  /** 当前工作区路径（undefined = 全局作用域）。 */
  workspace?: string;
  /** 全部已知工作区（作用域链入口选项）。 */
  projects: Array<{ path: string; title?: string }>;
  /** 根组件头部搜索框的当前值（切域清空）。 */
  query: string;
  /** 切换作用域（传 undefined = 回全局）。 */
  onSelectWorkspace: (path?: string) => void;
  onCount?: (count: number) => void;
}) {
  const skillsApi = api.skills;
  const [selected, setSelected] = useState<string | undefined>(undefined);
  /** 关系标签互跳的目标行：切作用域后待列表出现再选中。 */
  const [pendingSelect, setPendingSelect] = useState<string | undefined>(undefined);
  const [installOpen, setInstallOpen] = useState(false);
  const [opError, setOpError] = useState<string | undefined>(undefined);
  const [busyRow, setBusyRow] = useState<string | undefined>(undefined);
  /** 写操作计数：传给 SkillContent，变化时清空文件缓存并重拉。 */
  const [contentVersion, setContentVersion] = useState(0);
  /** 全局默认层（独立文件）：文件路径 + 损坏警告；开关后重读。 */
  const [globalOverrides, setGlobalOverrides] = useState<ClientGlobalOverrides | undefined>(undefined);
  const [globalVersion, setGlobalVersion] = useState(0);
  /** v21：工作区视图的项目 overrides（判断「跟随全局默认 / 已覆盖」）。 */
  const [projectOverrides, setProjectOverrides] = useState<ClientOverrides | undefined>(undefined);
  /** 写操作计数：工作区 overrides 变化后重读（「跟随 / 已覆盖」标签）。 */
  const [writeVersion, setWriteVersion] = useState(0);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  const scope: "global" | "workspace" = workspace === undefined ? "global" : "workspace";
  const workspaceSelected = scope === "workspace";
  const projectName =
    workspace === undefined ? undefined : (projects.find((project) => project.path === workspace)?.title ?? basenameOf(workspace));

  /** 当前全局可见性集合（旧宿主 / v1 文件 ⇒ 全空 = 全部可见）。 */
  const visibilitySets = globalOverrides?.visibility ?? EMPTY_VISIBILITY_SETS;
  /** 某 skill 的可见性配置（global 视图的行标签 / 详情用）。 */
  const visibilityOf = (name: string): ClientCapabilityVisibility | undefined =>
    visibilityEntryOf(visibilitySets, "skills", name);
  /** 兜底默认：名字在全局默认关闭名单里。 */
  const globalOffOf = (item: ClientSkillSummary): boolean =>
    item.globalDefaultDisabled === true || globalOverrides?.skills.includes(item.name) === true;

  // 挂载时、作用域变化时（列表 cwd 变化）、写操作后重新拉取。
  // 全局作用域 cwd = undefined（宿主只返回全局 + 注入），工作区作用域 cwd = 该
  // 工作区（宿主返回项目 + 全局 + 注入，并投影 v20.1 的有效默认字段）。
  // v21：行数据之外还要工作区视图的 `hiddenCount`（可见性过滤掉的条数）。
  const { data, loading, error, reload } = useAsyncList(async () => {
    const view =
      skillsApi.listView !== undefined ? await skillsApi.listView() : { skills: await skillsApi.list(), hiddenCount: 0 };
    return { items: view.skills, hiddenCount: view.hiddenCount ?? 0 };
  }, [skillsApi, workspace]);
  const items = data?.items ?? [];
  const hiddenCount = data?.hiddenCount ?? 0;
  const projectItems = useMemo(() => items.filter((item) => isProjectSource(item.source)), [items]);
  const globalItems = useMemo(() => items.filter((item) => !isProjectSource(item.source)), [items]);
  const injectedItems = useMemo(() => globalItems.filter((item) => item.injected === true), [globalItems]);
  const diskGlobalItems = useMemo(() => globalItems.filter((item) => item.injected !== true), [globalItems]);
  /** v21：工作区视图里因可见性被隐藏的**全局**条目（宿主已过滤，这里防御旧宿主）。 */
  const workspaceGlobalItems = useMemo(
    () => (scope === "workspace" ? globalItems.filter((item) => item.visibleInWorkspace !== false) : globalItems),
    [globalItems, scope],
  );

  // 全局默认层（开关的真实来源）：只在全局作用域需要文件路径/损坏警告，
  // 但重复读取很便宜，切换作用域后也重读一次，保证 warning 不陈旧。
  useEffect(() => {
    let alive = true;
    void safeGlobalGet(api).then((value) => {
      if (alive) setGlobalOverrides(value);
    });
    return () => {
      alive = false;
    };
  }, [api, globalVersion]);

  // v21：工作区视图读项目 overrides（判断「跟随全局默认 / 已覆盖」）。写操作后随
  // writeVersion 重读。
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

  /**
   * 当前作用域总数（Tab 与列表标题共用同一口径）：
   * 全局视图 = 全部条目；工作区视图 = 可见条目（v21 计数可见口径）。
   */
  const scopeTotal = scope === "global" ? globalItems.length : projectItems.length + workspaceGlobalItems.length;

  // Tab 计数 = 当前作用域总数（不随搜索变化；列表标题显示同一数字）。
  useEffect(() => {
    if (!loading && error === undefined) onCount?.(scopeTotal);
  }, [scopeTotal, loading, error, onCount]);

  const q = query.trim().toLowerCase();
  const matchesSkill = (item: ClientSkillSummary) =>
    q.length === 0 ||
    item.name.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q) ||
    // 注入行的渠道名（插件 / preset 名）也参与搜索。
    (item.channel !== undefined && item.channel.toLowerCase().includes(q));
  /** 当前作用域参与渲染的全局条目（工作区视图已按可见性过滤）。 */
  const globalItemsForScope = scope === "global" ? globalItems : workspaceGlobalItems;
  const visibleProject = useMemo(() => projectItems.filter(matchesSkill), [projectItems, q]);
  const visibleGlobal = useMemo(() => globalItemsForScope.filter(matchesSkill), [globalItemsForScope, q]);
  const visibleDiskGlobal = useMemo(
    () => diskGlobalItems.filter((item) => scope === "global" || item.visibleInWorkspace !== false).filter(matchesSkill),
    [diskGlobalItems, scope, q],
  );
  const visibleInjected = useMemo(
    () => injectedItems.filter((item) => scope === "global" || item.visibleInWorkspace !== false).filter(matchesSkill),
    [injectedItems, scope, q],
  );
  /** 当前作用域可见行（决定键盘导航与选中查找）。 */
  const visibleItems = useMemo(
    () => (scope === "global" ? visibleGlobal : [...visibleProject, ...visibleGlobal]),
    [scope, visibleGlobal, visibleProject],
  );
  const visibleKeys = useMemo(() => visibleItems.map(skillRowKey), [visibleItems]);
  const selectedItem = items.find((item) => skillRowKey(item) === selected);

  // 作用域切换清空选中；pendingSelect 保留（关系互跳会在新列表到达后重新选中）。
  useEffect(() => {
    setSelected(undefined);
  }, [workspace]);

  useEffect(() => {
    if (pendingSelect === undefined) return;
    if (!visibleKeys.includes(pendingSelect)) return;
    setSelected(pendingSelect);
    setPendingSelect(undefined);
  }, [pendingSelect, visibleKeys]);

  // `/` 聚焦头部搜索框（输入框 / 文本域 / contenteditable 内不生效）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      const tagName = active?.tagName.toLowerCase();
      if (tagName === "input" || tagName === "textarea" || (active as HTMLElement | null)?.isContentEditable === true) return;
      event.preventDefault();
      document.querySelector<HTMLInputElement>(".skp-header-search")?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectRow = (key: string) => {
    setSelected(key);
    setOpError(undefined);
  };

  const focusRow = (key: string) => {
    const element = rowRefs.current.get(key);
    if (element === undefined) return;
    element.focus();
    element.scrollIntoView({ block: "nearest" });
  };

  /** 行内统一开关：按「当前作用域 × 行类型」分派（全部真实调用后端）。 */
  const toggleRow = async (item: ClientSkillSummary, next: boolean) => {
    const key = skillRowKey(item);
    if (busyRow !== undefined) return;
    setBusyRow(key);
    setOpError(undefined);
    try {
      const isProject = isProjectSource(item.source);
      if (scope === "global") {
        // v20.1 B2：全局默认 = 独立文件里的关闭名单，不修改技能文件。
        const result = await api.overrides.globalToggle({ domain: "skills", key: item.name, disabled: !next });
        if (!result.ok) {
          setOpError(result.errors.join("; "));
          return;
        }
        setGlobalVersion((value) => value + 1);
      } else if (isProject) {
        // 项目磁盘条目：内容属于该工作区，开关仍写 frontmatter（模型/用户双方向）。
        const result =
          item.shadowStub === true
            ? next
              ? await skillsApi.enableInProject({ name: item.name })
              : { ok: true as const }
            : await skillsApi.setEnabled({ ...skillRefOf(item), enabled: next });
        if (!result.ok) {
          setOpError(result.errors.join("; "));
          return;
        }
      } else {
        // 全局 / 注入条目：写该工作区的显式启用/禁用（B2，覆盖全局默认）。
        const result = await api.overrides.setSkillDefault({ key: item.name, enabled: next });
        if (!result.ok) {
          setOpError(result.errors.join("; "));
          return;
        }
      }
      setContentVersion((value) => value + 1);
    } catch (failure) {
      setOpError(String(failure));
    } finally {
      setBusyRow(undefined);
      setWriteVersion((value) => value + 1);
      // 写后静默重拉：不整页 loading、不改选中与滚动位置。
      reload({ silent: true });
    }
  };

  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLElement>, key: string) => {
    if (visibleKeys.length === 0) return;
    const index = visibleKeys.indexOf(key);
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? visibleKeys.length - 1
            : event.key === "ArrowDown"
              ? Math.min(visibleKeys.length - 1, index + 1)
              : Math.max(0, index - 1);
      const nextKey = visibleKeys[next];
      if (nextKey !== undefined) {
        selectRow(nextKey);
        requestAnimationFrame(() => focusRow(nextKey));
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectRow(key);
    }
  };

  /** 列表标题栏的内联添加（类型 + 落点已由当前 Tab × 作用域决定）。 */
  const addLabel = "＋ 添加 Skill";
  const addTitle = scope === "global" ? "添加 Skill 到全局" : `添加 Skill 到工作区 ${projectName ?? "工作区"}`;

  /** 列表标题：全局 = 「全局 Skills」；工作区 = 「HtDot · Skills」。 */
  const listTitle = scope === "global" ? "全局 Skills" : `${projectName ?? "工作区"} · Skills`;
  const listNote = scope === "global" ? "所有工作区" : "仅此工作区";

  const renderRow = (item: ClientSkillSummary) => {
    const key = skillRowKey(item);
    const isProject = isProjectSource(item.source);
    const isInjected = item.injected === true;
    const state = invocationState(item);
    /** v21：只有「全局视图里的全局条目」编辑可见性；项目自己的条目不参与。 */
    const visibilityEditable = scope === "global" && !isProject;
    const entry = visibilityOf(item.name);
    const mode = item.visibilityMode ?? visibilityModeOf(entry);
    const visibleCount = item.visibleWorkspaceCount ?? visibleWorkspaceCountOf(entry, projects);
    const invisible = visibilityEditable && isRowInvisible(item, entry, projects);
    /** 工作区视图：全局条目是否已显式覆盖「每工作区默认」。 */
    const overrideState = workspaceSelected && !isProject ? workspaceOverrideOf(projectOverrides, "skills", item.name) : "inherit";
    // 开关勾选态：全局视图 = 全局默认；工作区视图 = 有效默认；项目磁盘行 = 调用状态。
    const checked =
      scope === "global"
        ? globalDefaultEnabledOf(item)
        : isProject
          ? item.shadowStub === true
            ? false
            : item.modelInvocable && item.userInvocable
          : effectiveDefaultEnabledOf(item);
    const tags = skillTags(item, diskGlobalItems.some((global) => global.name === item.name));
    const switcher = skillSwitchDisabled(item, scope);
    const dotClass = isInjected
      ? checked
        ? "skp-dot skp-dot-enabled"
        : "skp-dot skp-dot-hollow"
      : item.shadowStub === true || item.readOnly
        ? "skp-dot skp-dot-hollow"
        : state === "full"
          ? "skp-dot skp-dot-enabled"
          : state === "partial"
            ? "skp-dot skp-dot-partial"
            : "skp-dot";
    const dotText = isInjected
      ? checked
        ? "已启用"
        : "默认关闭"
      : item.shadowStub === true
        ? "屏蔽占位"
        : item.readOnly
          ? "只读"
          : state === "full"
            ? "已启用"
            : state === "partial"
              ? "部分禁用"
              : "已禁用";
    // v21 UX 修订：全局视图行尾不再有单开关（默认按工作区在弹层里配）；
    // 工作区视图保留行尾默认开关（写本工作区覆盖）。
    const switchLabel = `${projectName ?? "工作区"} 默认 · ${overrideState === "inherit" ? "跟随全局" : "已覆盖"}`;
    const switchTitle = switcher.title;
    return (
      <div
        role="option"
        aria-selected={selected === key}
        tabIndex={selected === key ? 0 : -1}
        className={selected === key ? "skp-row skp-row-active" : "skp-row"}
        ref={(element) => {
          if (element === null) rowRefs.current.delete(key);
          else rowRefs.current.set(key, element);
        }}
        onClick={() => selectRow(key)}
        onKeyDown={(event) => onRowKeyDown(event, key)}
      >
        <div className="skp-row-name">
          {/* 状态点：绿=启用 / 蓝=部分禁用 / 灰=禁用 / 空心=只读或默认关闭。 */}
          {(isProject || isInjected || scope === "workspace") && (
            <>
              <span className={dotClass} aria-hidden="true" />
              <span className="skp-sr-only">{dotText}</span>
            </>
          )}
          <span className="skp-row-title" title={item.name}>
            {item.name}
          </span>
        </div>
        <div className="skp-row-mid">
          <div className="skp-row-tags">
            {tags.map((tag) => (
              <span key={tag.key} className={tag.className} title={tag.title}>
                {tag.label}
              </span>
            ))}
            {visibilityEditable && (
              <VisibilityRowMeta
                entry={entry}
                workspaces={projects}
                globalOff={globalOffOf(item)}
                mode={mode}
                count={visibleCount}
                invisible={invisible}
              />
            )}
            {overrideState !== "inherit" && (
              <span
                className="skp-tag skp-tag-warn"
                title={
                  overrideState === "on"
                    ? "本工作区显式打开该能力（覆盖全局的每工作区默认）；点行尾开关可关闭"
                    : "本工作区显式关闭该能力（覆盖全局的每工作区默认）；点行尾开关可打开"
                }
              >
                已覆盖
              </span>
            )}
          </div>
          {/* 行尾开关（仅工作区视图 = 本工作区默认覆盖；全局默认在「可见范围」弹层里按工作区配）。 */}
          {scope === "workspace" && (
            <label
              className="skp-row-toggle"
              title={switchTitle}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <span className="skp-row-default-label">{switchLabel}</span>
              <span className="skp-switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`启用 ${item.name}`}
                  checked={checked}
                  disabled={switcher.disabled || busyRow === key}
                  onChange={(event) => void toggleRow(item, event.target.checked)}
                />
                <span className="skp-switch-track" />
              </span>
            </label>
          )}
        </div>
        <div className="skp-row-desc">{item.description.length > 0 ? item.description : "（无描述）"}</div>
      </div>
    );
  };

  /** 一组技能行（列表容器 + 可访问性标签）。 */
  const renderRows = (list: ClientSkillSummary[], label: string) => (
    <ul className="skp-list" role="listbox" aria-label={label}>
      {list.map((item) => (
        <li key={skillRowKey(item)} role="presentation">
          {renderRow(item)}
        </li>
      ))}
    </ul>
  );

  /** 一个分组头（标题 + 计数 + 说明）。 */
  const renderGroupHead = (title: string, count: number, note: string) => (
    <div className="skp-list-group-head">
      <span className="skp-list-group-title">{title}</span>
      <span className="skp-group-count">{count}</span>
      <span className="skp-list-group-note">{note}</span>
    </div>
  );

  /** 空态：按「一个都没有」与「搜索无匹配」区分，并给原地添加入口。 */
  const renderEmpty = () => {
    if (q.length > 0) {
      return <div className="skp-empty">没有匹配「{query.trim()}」的 Skills。</div>;
    }
    return (
      <div className="skp-empty">
        <div>{scope === "global" ? "全局还没有 Skills。" : `工作区 ${projectName ?? ""} 还没有 Skills。`}</div>
        <button type="button" className="skp-btn" style={{ marginTop: 10 }} onClick={() => setInstallOpen(true)}>
          {scope === "global" ? "添加到全局" : "添加到此工作区"}
        </button>
      </div>
    );
  };

  /** 列表主体：全局 = 用户安装 + 插件注入；工作区 = 本项目 + 引用的全局能力。 */
  const renderListBody = () => {
    if (loading && data === undefined) return <div className="skp-status">加载中…</div>;
    if (error !== undefined) return <div className="skp-error">读取失败：{error}</div>;
    if (scope === "global") {
      if (visibleDiskGlobal.length === 0 && visibleInjected.length === 0) return renderEmpty();
      return (
        <div className="skp-group-scroll skp-group-scroll-plain">
          {visibleDiskGlobal.length > 0 && (
            <>
              {renderGroupHead("用户安装", diskGlobalItems.length, "~/.agents/skills")}
              {renderRows(visibleDiskGlobal, "用户安装的全局 Skills")}
            </>
          )}
          {visibleInjected.length > 0 && (
            <>
              {renderGroupHead("插件注入", injectedItems.length, "只读 · 可启停")}
              {renderRows(visibleInjected, "插件注入的 Skills")}
            </>
          )}
        </div>
      );
    }
    if (visibleProject.length === 0 && visibleGlobal.length === 0) {
      if (hiddenCount > 0) {
        return (
          <div className="skp-group-scroll skp-group-scroll-plain">
            <div className="skp-empty">本工作区没有可见的 Skills。</div>
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
            {renderGroupHead(`本项目 · ${projectName ?? "工作区"}`, projectItems.length, "工作区独有")}
            {renderRows(visibleProject, "本项目 Skills")}
          </>
        )}
        {visibleGlobal.length > 0 && (
          <>
            {renderGroupHead("引用的全局能力", globalItemsForScope.length, `开关作用于 ${projectName ?? "此工作区"}`)}
            {renderRows(visibleGlobal, "引用的全局 Skills")}
          </>
        )}
        {hiddenCount > 0 && (
          <div className="skp-pane-note" title="这些能力在全局视图里未被开放给本工作区；请在全局视图的「可见范围」里开启">
            另有 {hiddenCount} 个能力未对此外工作区开放
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="skp-domain">
      {opError !== undefined && <div className="skp-error">{opError}</div>}
      {scope === "global" && globalOverrides?.errors !== undefined && globalOverrides.errors.length > 0 && (
        <div className="skp-error">全局默认名单读取失败（按空名单处理）：{globalOverrides.errors.join("; ")}</div>
      )}

      <div className="skp-body">
        {/* 列表栏：标题栏（类型 + 作用域 + 计数 + 内联添加）+ 分组列表。 */}
        <div className="skp-list-pane">
          <div className="skp-list-head">
            <span className="skp-list-title" title={listTitle}>
              <span className="skp-list-title-scope">{scope === "global" ? "全局" : (projectName ?? "工作区")}</span>
              <span className="skp-list-title-type">{scope === "global" ? " Skills" : " · Skills"}</span>
            </span>
            <span className="skp-group-count" title="当前作用域总数">
              {q.length > 0 ? `${visibleItems.length} / ${scopeTotal}` : scopeTotal}
            </span>
            <span className="skp-list-note">{listNote}</span>
            <span className="skp-detail-head-spacer" />
            <button
              type="button"
              className="skp-btn skp-btn-primary skp-list-add"
              title={addTitle}
              aria-label={addTitle}
              onClick={() => setInstallOpen(true)}
            >
              {addLabel}
            </button>
          </div>
          {scope === "global" && (
            <div className="skp-pane-note" title={globalOverrides?.filePath}>
              {globalOverrides?.filePath !== undefined
                ? `全局默认写入 ${globalOverrides.filePath}`
                : "全局默认对所有工作区生效；工作区可单独覆盖"}
            </div>
          )}
          {scope === "workspace" && (
            <div className="skp-pane-note">开关作用于 {projectName ?? "此工作区"} 的默认值 · 其它工作区不受影响</div>
          )}
          {renderListBody()}
        </div>

        {/* 详情栏：作用域链（全局 → 工作区）+ 条目详情。 */}
        <div className="skp-detail skp-detail-fixed">
          {selectedItem !== undefined ? (
            <SkillDetail
              key={skillRowKey(selectedItem)}
              summary={selectedItem}
              api={skillsApi}
              scope={scope}
              workspace={workspace}
              projectName={projectName}
              workspaces={projects}
              onSelectWorkspace={onSelectWorkspace}
              visibility={
                scope === "global" && !isProjectSource(selectedItem.source)
                  ? {
                      api,
                      entry: visibilityOf(selectedItem.name),
                      globalOff: globalOffOf(selectedItem),
                      onSaved: () => {
                        setGlobalVersion((value) => value + 1);
                        setWriteVersion((value) => value + 1);
                        reload({ silent: true });
                      },
                    }
                  : undefined
              }
              contentVersion={contentVersion}
              onChanged={() => {
                setContentVersion((value) => value + 1);
                reload({ silent: true });
              }}
              onRemoved={() => {
                setSelected(undefined);
                setContentVersion((value) => value + 1);
                reload({ silent: true });
              }}
            />
          ) : (
            <div className="skp-detail-empty">
              {scopeTotal === 0
                ? "此作用域还没有 Skills。用列表标题栏的「＋ 添加 Skill」添加一个。"
                : "选择一个条目查看说明与全部文件内容。"}
            </div>
          )}
        </div>
      </div>

      {installOpen && (
        <InstallDialog
          api={skillsApi}
          scope={scope === "global" ? "global" : "project"}
          workspace={workspace}
          projectName={projectName}
          onClose={() => setInstallOpen(false)}
          onInstalled={() => {
            setInstallOpen(false);
            setContentVersion((value) => value + 1);
            reload({ silent: true });
          }}
        />
      )}
    </div>
  );
}

/**
 * 详情卡片（v20.1）：标题 / 两段作用域链（全局 → 工作区）/ 动作区 / 元信息 +
 * **文件树与阅读器**（见 skill-content.tsx）。
 *
 * 作用域链只到工作区：全局视图第二段是「在「工作区」作用域查看 ↗」入口；
 * 工作区视图第二段显示该工作区的真实有效状态。会话级开关不进入本面板。
 */
function SkillDetail({
  summary,
  api,
  scope,
  workspace,
  projectName,
  workspaces,
  onSelectWorkspace,
  visibility,
  contentVersion,
  onChanged,
  onRemoved,
}: {
  summary: ClientSkillSummary;
  api: SkillsApi;
  /** 当前面板作用域（global = 全局视图；workspace = 某工作区视图）。 */
  scope: "global" | "workspace";
  /** 工作区作用域下的工作区路径。 */
  workspace?: string;
  /** 工作区展示名（HtDot 口径）。 */
  projectName?: string;
  /** 全部工作区（全局视图作用域链第二段的下拉选项）。 */
  workspaces: Array<{ path: string; title?: string }>;
  /** 选中工作区后切换面板作用域。 */
  onSelectWorkspace(path: string): void;
  /**
   * v21：全局视图的可见性编辑上下文（仅全局条目；项目自己的条目不参与）。
   * 缺省 = 不渲染「可见范围」分段。
   */
  visibility?: {
    api: CapabilityPanelApi;
    entry?: ClientCapabilityVisibility;
    globalOff: boolean;
    onSaved: () => void;
  };
  /** 父级写操作计数：变化时内容区清缓存重拉文件清单。 */
  contentVersion: number;
  /** 条目内容已变化（如启用/禁用/导入）：保留选中，重拉列表即可。 */
  onChanged: () => void;
  /** 条目已删除：应清空选中。 */
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | undefined>(undefined);
  const [confirmImport, setConfirmImport] = useState(false);
  const [exportPathOpen, setExportPathOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isGlobal = isGlobalSkillSource(summary.source);
  const isProject = isProjectSource(summary.source);
  const hasWorkspace = workspace !== undefined;
  // 宿主 registry 注入行：正文/资源只读、无磁盘副本，但保留启停。
  const injected = summary.injected === true;
  const state = invocationState(summary);
  /** 两段作用域链（全局 → 工作区）的文案：回答「为什么是现在这个状态」。 */
  const globalSegment = (() => {
    if (isProject) return { on: false, title: "未配置", note: "本项只存在于所选工作区" };
    const on = globalDefaultEnabledOf(summary);
    return {
      on,
      title: on ? "已安装 · 默认启用" : "已安装 · 默认关闭",
      note: on ? "对所有工作区生效" : "全局默认关闭；工作区可重新打开",
    };
  })();
  const workspaceSegment = (() => {
    if (isProject) {
      return {
        on: summary.shadowStub !== true,
        title: summary.shadowStub === true ? "屏蔽占位" : "本项独有 · 默认启用",
        note: "来源：本项目 .agents/skills",
      };
    }
    if (summary.projectDefaultEnabled === true) {
      return { on: true, title: "默认启用（重新打开）", note: "来源：工作区覆盖 · 覆盖全局默认关闭" };
    }
    if (summary.projectDefaultDisabled === true || summary.projectShadow === "stub") {
      return { on: false, title: "已关闭（覆盖）", note: "来源：工作区覆盖 · 仅此工作区默认关闭" };
    }
    if (summary.projectDefaultEnabled === false || summary.projectDefaultDisabled === false) {
      return {
        on: effectiveDefaultEnabledOf(summary),
        title: effectiveDefaultEnabledOf(summary) ? "默认启用" : "已关闭",
        note: "来源：工作区覆盖（capability-overrides.json）",
      };
    }
    return {
      on: effectiveDefaultEnabledOf(summary),
      title: effectiveDefaultEnabledOf(summary) ? "默认启用" : "已关闭",
      note: "未配置工作区覆盖 · 跟随全局默认",
    };
  })();

  // 删除确认对话框：Esc = 取消（与 UX §7.9 一致）。
  useEffect(() => {
    if (!deleteOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDeleteOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [deleteOpen]);

  /** 一键启用/禁用：开关状态 = 模型与用户都可用（两者任一被关即视为禁用）。 */
  const doSetEnabled = async (next: boolean) => {
    setBusy(true);
    setOpError(undefined);
    try {
      const result = await api.setEnabled({ ...skillRefOf(summary), enabled: next });
      if (!result.ok) {
        setOpError(result.errors.join("; "));
        return;
      }
      onChanged();
    } catch (failure) {
      setOpError(String(failure));
    } finally {
      setBusy(false);
    }
  };

  /** 细粒度切换其中一个调用方向（另一个方向保持原样）。 */
  const doSetInvocation = async (modelInvocable: boolean, userInvocable: boolean) => {
    setBusy(true);
    setOpError(undefined);
    try {
      const result = await api.setInvocation({ ...skillRefOf(summary), modelInvocable, userInvocable });
      if (!result.ok) {
        setOpError(result.errors.join("; "));
        return;
      }
      onChanged();
    } catch (failure) {
      setOpError(String(failure));
    } finally {
      setBusy(false);
    }
  };

  /** 导出为浏览器下载：flat ⇒ 单个 .md；directory ⇒ 打 zip（store-only）。 */
  const doExportDownload = async () => {
    setBusy(true);
    setOpError(undefined);
    try {
      const result = await api.exportFiles(skillRefOf(summary));
      if (!result.ok) {
        setOpError(result.errors.join("; "));
        return;
      }
      if (result.format === "flat" && result.files.length === 1) {
        downloadBytes(`${result.name}.md`, base64ToBytes(result.files[0].content), "text/markdown");
      } else {
        const zip = buildZip(result.files.map((file) => ({ name: `${result.name}/${file.path}`, data: base64ToBytes(file.content) })));
        downloadBytes(`${result.name}.zip`, zip, "application/zip");
      }
    } catch (failure) {
      setOpError(String(failure));
    } finally {
      setBusy(false);
    }
  };

  /** 确认后删除（对话框已收集用户确认，不再两击）。 */
  const doRemove = async () => {
    setBusy(true);
    setOpError(undefined);
    try {
      const result = await api.remove(skillRefOf(summary));
      if (!result.ok) {
        setOpError(result.errors.join("; "));
        setDeleteOpen(false);
        return;
      }
      setDeleteOpen(false);
      onRemoved();
    } catch (failure) {
      setOpError(String(failure));
      setDeleteOpen(false);
    } finally {
      setBusy(false);
    }
  };

  /** 导入这个全局 skill 到当前项目（项目内已有同名时二次确认覆盖）。 */
  const doImport = async (overwrite: boolean) => {
    setBusy(true);
    setOpError(undefined);
    try {
      const result = await api.importToProject({ name: summary.name, fromRoot: summary.root, overwrite });
      if (!result.ok) {
        if (result.existed === true) {
          setConfirmImport(true);
          return;
        }
        setOpError(result.errors.join("; "));
        return;
      }
      onChanged();
    } catch (failure) {
      setOpError(String(failure));
    } finally {
      setBusy(false);
    }
  };

  const copyPath = async () => {
    if (summary.path === undefined) return;
    try {
      await navigator.clipboard?.writeText(summary.path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  const deleteBody =
    summary.shadowStub === true
      ? "将删除工作区内的屏蔽占位，同名全局 Skills 在本工作区恢复可用。"
      : isGlobal
        ? "将删除全局 Skills，所有工作区都将不再可用。此操作不可撤销。"
        : "将删除本工作区中的这份 Skills（含目录下的所有文件）。此操作不可撤销。";

  return (
    <div className="skp-detail-card">
      {/* 标题行：名称 + 归属/来源标签 + 只读/覆盖/遮蔽徽标 + 右侧「复制路径」。 */}
      <div className="skp-detail-head">
        <h3 title={summary.name}>{summary.name}</h3>
        {injected ? (
          <>
            <span className={originTagClass(summary)} title="注入来源类别（内置 / 插件 / 预设渠道）">
              {originLabel(summary)}
            </span>
            <span className="skp-tag skp-tag-flat">{summary.format === "directory" ? "目录" : ".md"}</span>
            {summary.channel !== undefined && summary.channel.length > 0 && (
              <span className="skp-tag skp-tag-channel" title="注入方 / 渠道名（只读来源，无磁盘副本）">
                {summary.channel}
              </span>
            )}
          </>
        ) : (
          <>
            <span
              className={isGlobal ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project"}
              title={isGlobal ? "全局 Skills（对所有工作区生效）" : "仅存在于所选工作区的 Skills"}
            >
              {isGlobal ? "全局" : "本项"}
            </span>
            <span className="skp-tag skp-tag-flat">{summary.format === "directory" ? "目录" : ".md"}</span>
            {summary.readOnly && <span className="skp-badge">只读</span>}
          </>
        )}
        {!injected && summary.shadowStub === true && (
          <span className="skp-badge" title="屏蔽占位：使同名全局 Skills 在本工作区不可用；删除本条目即可恢复">
            屏蔽占位
          </span>
        )}
        {isGlobal && summary.projectShadow === "stub" && (
          <span className="skp-badge" title="该工作区已禁用同名全局 Skills；可在工作区作用域重新打开（不影响其它工作区）">
            工作区默认关闭
          </span>
        )}
        {isGlobal && summary.projectShadow === "skill" && (
          <span className="skp-badge" title="工作区有同名 Skills，按宿主优先级在该工作区生效的是工作区副本">
            工作区副本生效中
          </span>
        )}
        <span className="skp-detail-head-spacer" />
        {summary.path !== undefined && (
          <button type="button" className="skp-link-btn" title={summary.path} onClick={() => void copyPath()}>
            {copied ? "已复制" : "复制路径"}
          </button>
        )}
      </div>

      {injected && (
        <div className="skp-detail-readonly">
          <span className="skp-detail-readonly-icon" aria-hidden="true">
            i
          </span>
          <span>{injectedReadonlyNote(summary)}</span>
        </div>
      )}

      {/* v20.1：两段作用域链（全局 → 工作区）。全局视图先选工作区，再切换。 */}
      <ScopeChain
        scope={scope}
        projectName={projectName}
        globalSeg={globalSegment}
        workspaceSeg={workspaceSegment}
        workspaces={workspaces}
        onSelectWorkspace={onSelectWorkspace}
      />

      {visibility !== undefined && (
        <dl className="skp-detail-fields">
          <VisibilityDetailFields
            api={visibility.api}
            domain="skills"
            capabilityKey={summary.name}
            name={summary.name}
            entry={visibility.entry}
            workspaces={workspaces}
            globalOff={visibility.globalOff}
            onSaved={visibility.onSaved}
          />
        </dl>
      )}

      {!summary.readOnly && !injected && (
        <div className="skp-detail-actions">
          {!isGlobal && summary.shadowStub !== true && (
            <button
              type="button"
              className={`skp-btn ${state === "full" ? "skp-state-on" : state === "partial" ? "skp-state-partial" : "skp-state-off"}`}
              disabled={busy}
              title={state === "full" ? "点击禁用（用户与模型都不可调用）" : "点击启用（恢复用户与模型调用）"}
              onClick={() => void doSetEnabled(state !== "full")}
            >
              {state === "full" ? "已启用" : state === "none" ? "已禁用" : "部分禁用"}
            </button>
          )}
          {isGlobal && state !== "full" && (
            <button
              type="button"
              className="skp-btn skp-state-off"
              disabled={busy}
              title="此全局 Skills 当前为禁用状态；点击恢复启用（对所有项目生效）"
              onClick={() => void doSetEnabled(true)}
            >
              已禁用
            </button>
          )}
          {hasWorkspace && isGlobal && (
            <button
              type="button"
              className={confirmImport ? "skp-btn skp-btn-danger" : "skp-btn"}
              disabled={busy}
              title={
                confirmImport
                  ? "工作区内已有同名 Skills，再次点击将覆盖为全局副本"
                  : "复制到本工作区（.agents/skills），此后可在本工作区独立启停"
              }
              onClick={() => void doImport(confirmImport)}
            >
              {confirmImport ? "确认覆盖工作区内的同名 Skills？" : "复制到本工作区"}
            </button>
          )}
          <button type="button" className="skp-btn" disabled={busy} onClick={() => void doExportDownload()}>
            导出
          </button>
          <button type="button" className="skp-btn" disabled={busy} onClick={() => setExportPathOpen(true)}>
            导出到路径…
          </button>
          <button
            type="button"
            className="skp-btn skp-btn-danger-ghost"
            disabled={busy}
            title={deleteBody}
            onClick={() => setDeleteOpen(true)}
          >
            删除
          </button>
        </div>
      )}

      {/* 描述 / 使用时机（旧版详情字段，压缩为 2 行；正文里也有完整内容）。 */}
      {(summary.description.length > 0 || summary.whenToUse !== undefined) && (
        <div className="skp-detail-desc">
          {summary.description.length > 0 && <p className="skp-detail-desc-text">{summary.description}</p>}
          {summary.whenToUse !== undefined && (
            <p className="skp-detail-desc-text">
              <span className="skp-detail-meta-strong">使用时机</span> {summary.whenToUse}
            </p>
          )}
        </div>
      )}

      {/* 元信息条（单行，压缩自旧版 dl 字段；调用方式开关保留原语义）。 */}
      <div className="skp-detail-meta">
        <span className="skp-detail-meta-item">
          来源{" "}
          <span className="skp-detail-meta-strong">
            {injected ? (summary.channel !== undefined && summary.channel.length > 0 ? summary.channel : originLabel(summary)) : summary.source}
          </span>
        </span>
        <span className="skp-detail-meta-item">
          {injected ? injectedOriginText(summary) : summary.format === "directory" ? "目录格式" : "单文件"}
        </span>
        {(injected || summary.readOnly || !isGlobal) && (
          <span className="skp-detail-meta-item">
            调用方式
            {injected || summary.readOnly || summary.shadowStub === true ? (
              <span className="skp-detail-meta-strong">
                模型 {summary.modelInvocable ? "✓" : "✗"} · 用户 {summary.userInvocable ? "✓" : "✗"}
              </span>
            ) : (
              <span className="skp-invoke-btns">
                <button
                  type="button"
                  className={`skp-btn ${summary.modelInvocable ? "skp-state-on" : "skp-state-off"}`}
                  disabled={busy}
                  title={
                    summary.modelInvocable
                      ? "点击关闭模型调用（agent 不再自动触发；用户仍可 /name 调用）"
                      : "点击开启模型调用（agent 可自动触发）"
                  }
                  onClick={() => void doSetInvocation(!summary.modelInvocable, summary.userInvocable)}
                >
                  模型 {summary.modelInvocable ? "✓" : "✗"}
                </button>
                <button
                  type="button"
                  className={`skp-btn ${summary.userInvocable ? "skp-state-on" : "skp-state-off"}`}
                  disabled={busy}
                  title={
                    summary.userInvocable
                      ? "点击关闭用户调用（输入框 /name 不再注入此 Skills；模型仍可自动触发）"
                      : "点击开启用户调用（输入框 /name 可注入此 Skills）"
                  }
                  onClick={() => void doSetInvocation(summary.modelInvocable, !summary.userInvocable)}
                >
                  用户 {summary.userInvocable ? "✓" : "✗"}
                </button>
              </span>
            )}
          </span>
        )}
        {summary.path !== undefined && (
          <button type="button" className="skp-detail-path" title={summary.path} onClick={() => void copyPath()}>
            {summary.path}
          </button>
        )}
      </div>

      {opError !== undefined && <div className="skp-error">{opError}</div>}

      {/* 内容区：文件树 + 阅读器（本版核心新增；flat 自动隐藏树）。 */}
      <SkillContent summary={summary} api={api} refreshKey={contentVersion} />

      {exportPathOpen && <ExportToPathDialog summary={summary} api={api} onClose={() => setExportPathOpen(false)} />}
      {deleteOpen && (
        <Modal title={`删除 Skills 「${summary.name}」？`} onClose={() => setDeleteOpen(false)}>
          <p className="skp-modal-text">{deleteBody}</p>
          <div className="skp-modal-actions">
            <button type="button" className="skp-btn" autoFocus onClick={() => setDeleteOpen(false)}>
              取消
            </button>
            <button type="button" className="skp-btn skp-btn-danger" disabled={busy} onClick={() => void doRemove()}>
              {busy ? "删除中…" : "删除"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 模态框
// ---------------------------------------------------------------------------
// 外壳（skp-modal-overlay / skp-modal）抽到了 modal.tsx 供 Skills 与 MCP
// 两个域共用；这里的对话框组件只负责各自的内容与提交逻辑。

/** 安装对话框的来源模式与 Tab 文案。 */
const INSTALL_MODE = { upload: "上传", path: "宿主路径", url: "URL" } as const;
type InstallMode = keyof typeof INSTALL_MODE;

/**
 * 安装对话框（v20.1）：**固定落点**，不再二次选择类型 / 作用域。
 *
 * 类型与落点由「当前 Tab × 当前作用域」决定（Skills + 全局 / Skills + 某工作区），
 * 因此顶部固定一张「落点」卡：作用域徽章 + 写入路径 + 「仅此作用域生效 ·
 * 与当前对话无关」，并提示换落点要先切换顶部作用域。弹窗内只填内容：
 * 上传（.md / 文件夹 / .zip）、宿主路径、URL 三种来源，校验 `SKILL.md`。
 */
function InstallDialog({
  api,
  scope,
  workspace,
  projectName,
  onClose,
  onInstalled,
}: {
  api: SkillsApi;
  /** 固定落点：global = ~/.agents/skills；project = <工作区>/.agents/skills。 */
  scope: "global" | "project";
  /** 工作区作用域下的工作区路径（写路径展示 + 服务端解析项目根）。 */
  workspace?: string;
  /** 工作区展示名（弹窗标题「工作区 HtDot」）。 */
  projectName?: string;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [mode, setMode] = useState<InstallMode>("upload");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [sourcePath, setSourcePath] = useState("");
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<{ label: string; files: SkillFilePayload[] } | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  const isGlobal = scope === "global";
  const title = isGlobal ? "添加 Skill 到全局" : `添加 Skill 到工作区 ${projectName ?? "工作区"}`;
  const targetPath = isGlobal ? "~/.agents/skills/" : `${workspace ?? "<工作区>"}/.agents/skills/`;

  /** 选中单个 .md 文件（flat 安装）。 */
  const onPickFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = ""; // 允许重复选同一文件
    if (file === undefined) return;
    setErrors([]);
    try {
      const content = await fileToBase64(file);
      setPicked({ label: file.name, files: [{ path: file.name, content }] });
    } catch (failure) {
      setErrors([String(failure)]);
    }
  };

  /**
   * 选中整个目录（directory 安装）：webkitRelativePath 形如
   * `<folder>/<rel>`，剥掉首段得到 skill 内部相对路径；根上必须有 SKILL.md。
   */
  const onPickDirectory = async (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) return;
    setErrors([]);
    try {
      const payload: SkillFilePayload[] = [];
      let folder = "";
      for (const file of files) {
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        const segments = relative.split("/");
        folder = segments[0] ?? folder;
        const inner = segments.slice(1).join("/");
        if (inner.length === 0) continue; // 目录占位项，跳过
        payload.push({ path: inner, content: await fileToBase64(file) });
      }
      if (!payload.some((entry) => entry.path === "SKILL.md")) {
        setPicked(undefined);
        setErrors([`文件夹 "${folder}" 的根目录下没有 SKILL.md`]);
        return;
      }
      setPicked({ label: `${folder}/（${payload.length} 个文件）`, files: payload });
    } catch (failure) {
      setErrors([String(failure)]);
    }
  };

  /**
   * 选中 .zip 压缩包：浏览器端解压 → 剥公共顶层文件夹 → 与宿主下载安装
   * 同一套 locate 口径定位 skill 根（唯一 SKILL.md 或单 flat .md）→
   * 重定根为上传清单。
   */
  const onPickArchive = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined) return;
    setErrors([]);
    try {
      const entries = await unzip(new Uint8Array(await file.arrayBuffer()));
      const stripped = stripCommonTopFolder(entries.map((entry) => entry.path));
      const normalized = entries.map((entry, i) => ({ ...entry, path: stripped[i] }));
      const located = locateSkillRoot(normalized.map((entry) => entry.path));
      if (!located.ok) {
        setPicked(undefined);
        setErrors([located.error]);
        return;
      }
      const payload = rerootEntries(normalized, located.root).map((entry) => ({ path: entry.path, content: bytesToBase64(entry.data) }));
      setPicked({ label: `${file.name}（${payload.length} 个文件）`, files: payload });
    } catch (failure) {
      setPicked(undefined);
      setErrors([String(failure)]);
    }
  };

  const doInstall = async () => {
    setBusy(true);
    setErrors([]);
    // 落点已由列表标题栏决定（global / 指定工作区），这里不再判断/切换。
    const writableScope = isGlobal ? "global" : "project";
    const target = isGlobal ? undefined : ".agents";
    try {
      const result =
        mode === "upload"
          ? await api.installUpload({ scope: writableScope, target, files: picked?.files ?? [], overwrite })
          : mode === "path"
            ? await api.installFromPath({ scope: writableScope, target, sourcePath: sourcePath.trim(), overwrite })
            : await api.installFromUrl({ scope: writableScope, target, url: url.trim(), overwrite });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      onInstalled();
    } catch (failure) {
      setErrors([String(failure)]);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy &&
    (mode === "upload" ? picked !== undefined : mode === "path" ? sourcePath.trim().length > 0 : url.trim().length > 0);

  return (
    <Modal title={title} onClose={onClose}>
      <div className="skp-form">
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
          {(Object.keys(INSTALL_MODE) as InstallMode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "skp-tab skp-tab-active" : "skp-tab"} onClick={() => setMode(m)}>
              {INSTALL_MODE[m]}
            </button>
          ))}
        </div>

        {mode === "upload" && (
          <div className="skp-field">
            <span className="skp-field-label">来源</span>
            <div className="skp-subheader-row">
              <button type="button" className="skp-btn" onClick={() => fileInputRef.current?.click()}>
                选择 .md 文件
              </button>
              <button type="button" className="skp-btn" onClick={() => dirInputRef.current?.click()}>
                选择文件夹
              </button>
              <button type="button" className="skp-btn" onClick={() => zipInputRef.current?.click()}>
                选择 .zip
              </button>
            </div>
            {/* webkitdirectory 非标准属性，React 类型不认识，用 ref 回调设置。 */}
            <input ref={fileInputRef} type="file" accept=".md,text/markdown" hidden onChange={(e) => void onPickFile(e.currentTarget)} />
            <input
              ref={(el) => {
                dirInputRef.current = el;
                el?.setAttribute("webkitdirectory", "");
              }}
              type="file"
              multiple
              hidden
              onChange={(e) => void onPickDirectory(e.currentTarget)}
            />
            <input ref={zipInputRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => void onPickArchive(e.currentTarget)} />
            <span className="skp-note">
              {picked !== undefined ? `已选择：${picked.label}` : "选择单个 <名称>.md 文件、包含 SKILL.md 的文件夹，或 .zip 压缩包。"}
            </span>
          </div>
        )}

        {mode === "path" && (
          <div className="skp-field">
            <span className="skp-field-label">宿主上的源路径</span>
            <input
              className="skp-input"
              type="text"
              placeholder="/path/to/skill 目录或 <名称>.md"
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
            />
          </div>
        )}

        {mode === "url" && (
          <div className="skp-field">
            <span className="skp-field-label">下载 URL</span>
            <input
              className="skp-input"
              type="url"
              placeholder="https://github.com/<owner>/<repo>[/tree/<branch>/<dir>] 或 .zip / .md 链接"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <span className="skp-note">支持 GitHub 仓库（整库或 /tree/… 子目录）、.zip 链接或 raw .md 链接。</span>
          </div>
        )}

        <label className="skp-field skp-field-inline">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          同名 Skills 已存在时覆盖
        </label>

        {errors.length > 0 && <div className="skp-error">{errors.join("\n")}</div>}

        <div className="skp-modal-actions">
          <button type="button" className="skp-btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="skp-btn skp-btn-primary" disabled={!canSubmit} onClick={doInstall}>
            {busy ? "安装中…" : "安装"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 导出到宿主路径的小对话框：目标目录 + 覆盖开关。 */
function ExportToPathDialog({ summary, api, onClose }: { summary: ClientSkillSummary; api: SkillsApi; onClose: () => void }) {
  const [destDir, setDestDir] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const doExport = async () => {
    setBusy(true);
    setErrors([]);
    try {
      const result = await api.exportToPath({ ...skillRefOf(summary), destDir: destDir.trim(), overwrite });
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      onClose();
    } catch (failure) {
      setErrors([String(failure)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`将「${summary.name}」导出到路径`} onClose={onClose}>
      <div className="skp-form">
        <div className="skp-field">
          <span className="skp-field-label">宿主上的目标目录</span>
          <input
            className="skp-input"
            type="text"
            placeholder="/path/to/目标目录"
            value={destDir}
            onChange={(e) => setDestDir(e.target.value)}
          />
        </div>
        <label className="skp-field skp-field-inline">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          目标已存在时覆盖
        </label>
        {errors.length > 0 && <div className="skp-error">{errors.join("\n")}</div>}
        <div className="skp-modal-actions">
          <button type="button" className="skp-btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="skp-btn skp-btn-primary" disabled={busy || destDir.trim().length === 0} onClick={doExport}>
            {busy ? "导出中…" : "导出"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** File → base64（readAsDataURL 剥掉 `data:…;base64,` 前缀）。 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`读取 ${file.name} 失败`));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** 字节 → base64（分块避免 fromCharCode 参数过长）。 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
