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
 * **两份 api，切勿合并（防回归）**：
 *   - 面板自身用 client.ts 中带「项目钉选」的 `api`：`currentWorkspaceCwd`
 *     是 `selection.cwd ?? 当前会话工作区`，所以头部「项目作用域」下拉框
 *     能把项目级视图钉到任意工作区；
 *   - composer（输入框工具行：Skills / MCP 按钮与弹层）在 client.ts 中用
 *     单独的 `composerApi`：`currentWorkspaceCwd` **只**取当前会话自己的
 *     工作区，`selectedProject()` 恒为 undefined。两者共用同一份
 *     `subscribeWorkspace` 回调集合，因此都会随会话工作区切换刷新。
 *   若把面板这份 api 交给 composer，就会出现在面板里把项目作用域钉到 A
 *   工作区后、B 工作区的对话框弹层列出 A 的项目级技能/MCP 的串味 bug。
 *
 * 根容器按能力域分 Tab（**只剩两个**：技能 / MCP，带数据量计数），第二行
 * 是「域 Tab + 搜索框」：搜索框由根组件持有，按域切换 placeholder，两个
 * 视图只接收 `query` 做本地过滤（视图内不再有搜索/安装行）：
 *   - Skills：左列 200–220px 的 ScopeNav（全局 / 项目 + 行尾「+」安装），
 *     中间列按 scope 显示全局技能、工作区选择列表或选中工作区的项目技能
 *     （项目 scope 未选工作区时先列全部工作区，点击 = `api.selectProject`）；
 *     详情页带完整文件树 + SKILL.md 阅读器（见 skill-content.tsx）；
 *   - MCP：同构的左导航 + 中间列（全局含外部注入 / 项目→工作区下钻），
 *     带每个 session 的实时挂载状态（见 mcp-panel.tsx）。
 *
 * 快捷消息域已整体下线（2026-10 产品决定），域 Tab 不再有第三个入口。
 *
 * 布局刻意保持朴素（自带 CSS 类，见 styles.ts），对未经确认的 UI 原语
 * 组件零硬依赖。
 *
 * @module @chengdb/capability-panel/client/panel
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CapabilityPanelApi, ClientSkillSummary, SkillFilePayload, SkillsApi } from "./api.js";
import { McpView } from "./mcp-panel.js";
import { Modal } from "./modal.js";
import { SkpSelect } from "./select.js";
import { hasWorkspaceLabel, isProjectSource, useAsyncList } from "./panel-common.js";
import { SkillContent, skillRefOf } from "./skill-content.js";
import { isGlobalSkillSource } from "../shared/skill-sources.js";
import { locateSkillRoot, rerootEntries, stripCommonTopFolder } from "../shared/skill-locate.js";
import { unzip } from "./unzip.js";
import { base64ToBytes, buildZip, downloadBytes } from "./zip.js";

/** 域 Tab 的取值（快捷消息域已下线，只剩技能 / MCP）。 */
type DomainTab = "skills" | "mcp";

/** 域 Tab 的展示文案（当前硬编码中文，见 client.ts 的 locale 说明）。 */
const DOMAIN_LABEL: Record<DomainTab, string> = {
  skills: "技能",
  mcp: "MCP",
};

const DOMAIN_ORDER: DomainTab[] = ["skills", "mcp"];

/** 各域的搜索占位符（搜索框在根组件头部，切换域时切换文案）。 */
const DOMAIN_SEARCH_PLACEHOLDER: Record<DomainTab, string> = {
  skills: "搜索技能…",
  mcp: "搜索 MCP 服务器…",
};

/**
 * 面板根组件：头部（标题 + 项目下拉框 + 域 Tab）+ 当前域视图。
 *
 * 它是主区域页面的本体（见 panel-entry.tsx 的 CapabilityPanelPage），自带
 * `.skp-panel`（height:100% / flex column），因此不再需要浮层外壳与关闭
 * 按钮——关闭 = 侧栏切换到别的主面板。
 */
export function CapabilityPanel({ api }: { api: CapabilityPanelApi }) {
  // 域、工作区标签、下拉框选项、钉选状态各自维护一份 useState；
  // 起始值取自 api 的快照方法。
  const [domain, setDomain] = useState<DomainTab>("skills");
  /** 当前域的搜索词（搜索框在头部，按域切换 placeholder；切域清空）。 */
  const [query, setQuery] = useState("");
  const [workspace, setWorkspace] = useState<string | undefined>(() => api.workspaceLabel());
  const [projects, setProjects] = useState(() => api.projects());
  const [pinned, setPinned] = useState<string | undefined>(() => api.selectedProject());
  // 域 Tab 计数：由各域视图在数据到达后回填（加载中显示 —）。
  // 口径（UX §3.2 定稿，Lead 2026-10-23 裁决 A）：
  //   - 技能 = 项目条目数 + 全局条目数（含只读、含屏蔽占位，不去重）；
  //   - MCP  = 项目配置条目数 + 全局配置条目数，**不含**外部注入
  //     （外部注入在组 C 单独计数，由 McpView 自己展示）。
  // 搜索不改变 Tab 计数（Tab 计数是总量）。
  const [skillsCount, setSkillsCount] = useState<number | undefined>(undefined);
  const [mcpCount, setMcpCount] = useState<number | undefined>(undefined);

  // 工作区标签/项目选项/钉选状态都会随"当前工作区解析完成或变化、
  // 用户挑选项目"而变；数据源是快照（SnapshotStore），本身不具备响应性，
  // 所以订阅借由 adapter 暴露的 subscribeWorkspace 手动同步。
  useEffect(() => {
    let alive = true;
    const update = () => {
      if (!alive) return;
      setWorkspace(api.workspaceLabel());
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

  const counts: Record<DomainTab, number | undefined> = { skills: skillsCount, mcp: mcpCount };

  // 页面 chrome 由主区域提供（侧栏切换主面板 = 关闭）；这里只渲染
  // 标题行 + 域 Tab 与当前域视图。
  return (
    <section className="skp-panel" aria-label="能力面板">
      <header className="skp-header">
        <div className="skp-title-row">
          <div className="skp-title-main">
            <h2>能力面板</h2>
            {/* 当前作用域的工作区路径（跟随 session 或钉选的项目）。 */}
            {workspace !== undefined && (
              <span className="skp-workspace" title={workspace}>
                {workspace}
              </span>
            )}
          </div>
          <div className="skp-title-tools">
            {/* 项目作用域下拉框："" = 跟随当前 session；钉选才固定。 */}
            <SkpSelect
              className="skp-dd-scope"
              value={pinned ?? ""}
              title={workspace}
              ariaLabel="项目作用域"
              options={[
                { value: "", label: "跟随当前会话" },
                ...projects.map((p) => ({ value: p.path, label: p.title ?? p.path })),
                // 钉选的项目不在已知列表里时也保留为选项，避免"消失"。
                ...(pinned !== undefined && !projects.some((p) => p.path === pinned) ? [{ value: pinned, label: pinned }] : []),
              ]}
              onChange={(value) => api.selectProject(value === "" ? undefined : value)}
            />
          </div>
        </div>
        {/* 第二行：域 Tab 在左，搜索框右对齐（同一个 input，按域切 placeholder）。 */}
        <div className="skp-header-row">
          <div className="skp-tabs" role="tablist">
            {DOMAIN_ORDER.map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={domain === d}
                className={domain === d ? "skp-tab skp-tab-active" : "skp-tab"}
                onClick={() => {
                  setDomain(d);
                  setQuery("");
                }}
              >
                <span>{DOMAIN_LABEL[d]}</span>
                <span className="skp-tab-count">{counts[d] ?? "—"}</span>
              </button>
            ))}
          </div>
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
        </div>
      </header>

      {domain === "skills" ? (
        <SkillsView
          api={api}
          workspace={workspace}
          projects={projects}
          query={query}
          pinned={pinned}
          onSelectWorkspace={(path) => api.selectProject(path)}
          onCount={setSkillsCount}
        />
      ) : (
        <McpView
          api={api}
          workspace={workspace}
          projects={projects}
          query={query}
          pinned={pinned}
          onSelectWorkspace={(path) => api.selectProject(path)}
          onCount={setMcpCount}
        />
      )}
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

/** 行左标签的排序与文案：scope → 格式 → 关系（最多 3 个）。 */
function skillTags(item: ClientSkillSummary, hasGlobal: boolean): Array<{ key: string; label: string; className: string; title?: string }> {
  const isProject = isProjectSource(item.source);
  const tags: Array<{ key: string; label: string; className: string; title?: string }> = [
    {
      key: "scope",
      label: isProject ? "项目" : "全局",
      className: isProject ? "skp-tag skp-tag-project" : "skp-tag skp-tag-global",
      title: isProject ? "本项目内的技能，只在本项目生效" : "全局技能，对所有项目生效",
    },
    {
      key: "format",
      label: item.format === "directory" ? "目录" : ".md",
      className: "skp-tag skp-tag-flat",
      title: item.format === "directory" ? "目录型技能（SKILL.md + 其他文件）" : "单文件技能",
    },
  ];
  if (item.readOnly) {
    tags.push({ key: "readonly", label: "只读", className: "skp-tag skp-tag-readonly", title: "只读来源，无法修改或删除" });
  } else if (isProject && item.shadowStub === true) {
    tags.push({
      key: "stub",
      label: "屏蔽占位",
      className: "skp-tag skp-tag-warn",
      title: "已生成屏蔽占位，使同名全局技能在本项目不可用；删除占位即恢复",
    });
  } else if (isProject && hasGlobal) {
    tags.push({ key: "override", label: "覆盖全局", className: "skp-tag skp-tag-relation", title: "本项目生效的是这份项目副本；同名全局技能被遮蔽" });
  } else if (!isProject && item.projectShadow === "stub") {
    tags.push({
      key: "disabled-in-project",
      label: "本项目已禁用",
      className: "skp-tag skp-tag-warn",
      title: "本项目内已放置屏蔽占位，此技能在本项目不可用（不影响其它项目）",
    });
  } else if (!isProject && item.projectShadow === "skill") {
    tags.push({
      key: "project-copy",
      label: "项目副本生效中",
      className: "skp-tag skp-tag-readonly",
      title: "本项目内已有同名技能，按优先级本项目中生效的是项目副本",
    });
  }
  return tags;
}

/** 行开关的勾选态（语义见任务规格 / docs/ux/panel-upgrade.md §3.5、§5.3）。 */
function skillSwitchChecked(item: ClientSkillSummary): boolean {
  if (isProjectSource(item.source)) {
    // 屏蔽占位 = "在本项目禁用同名全局"的占位条目，本身不应显示为启用。
    if (item.shadowStub === true) return false;
    // 项目普通条目：模型与用户两个方向都开才算启用。
    return item.modelInvocable && item.userInvocable;
  }
  // 全局条目：开关表达"本项目是否禁用（有无屏蔽占位）"。
  return item.projectShadow !== "stub";
}

/** 行开关是否置灰 + tooltip（只读 / 项目副本生效中 / 无工作区）。 */
function skillSwitchDisabled(item: ClientSkillSummary, hasWorkspace: boolean): { disabled: boolean; title: string } {
  const isProject = isProjectSource(item.source);
  if (item.readOnly) {
    return { disabled: true, title: "只读来源（.claude 兼容目录），无法修改或删除" };
  }
  if (!hasWorkspace) {
    return { disabled: true, title: "需要可写的工作区才能修改技能" };
  }
  if (isProject) {
    if (item.shadowStub === true) {
      return { disabled: false, title: "打开：删除屏蔽占位，恢复同名全局技能在本项目可用" };
    }
    return {
      disabled: false,
      title: skillSwitchChecked(item)
        ? "关闭：模型与用户都不可调用"
        : "打开：恢复模型与用户调用（写入项目副本 frontmatter）",
    };
  }
  if (item.projectShadow === "skill") {
    return { disabled: true, title: "本项目已有同名技能（项目副本生效中），请在项目副本上操作" };
  }
  if (item.projectShadow === "stub") {
    return { disabled: false, title: "打开：删除本项目内的屏蔽占位，恢复此全局技能在本项目可用" };
  }
  return {
    disabled: false,
    title: skillSwitchChecked(item)
      ? "关闭：在本项目内禁用此全局技能（生成屏蔽占位，不影响其它项目）"
      : "打开：恢复此全局技能在本项目可用",
  };
}

/** 取路径最后一段作为工作区显示名（兼容 POSIX / Windows 分隔符）。 */
function basenameOf(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

/**
 * Skills 视图：左侧 ScopeNav（全局 / 项目）+ 中间列 + 右侧详情。
 *
 *  - 全局：中间列显示全部全局技能（含只读/被本项目遮蔽状态标签）；
 *  - 项目：未选工作区时先列全部工作区（点击 = api.selectProject，进入该
 *    工作区的项目技能）；已选工作区时显示「‹ 工作区」返回行 + 该项目技能。
 *
 * 搜索词由根组件头部的同一输入框提供（query），按当前列表过滤：技能名称/
 * 描述，或工作区名/完整路径。行内只有状态点、标签、两行描述与行尾「启用」
 * 开关；导出/导入/删除等动作全部在右侧详情（含文件树与阅读器）。
 */
function SkillsView({
  api,
  workspace,
  projects,
  query,
  pinned,
  onSelectWorkspace,
  onCount,
}: {
  api: CapabilityPanelApi;
  workspace?: string;
  projects: Array<{ path: string; title?: string }>;
  /** 根组件头部搜索框的当前值（切域清空）。 */
  query: string;
  /** 当前钉选的工作区路径；undefined = 未选工作区（中间列显示工作区列表）。 */
  pinned?: string;
  /** 选择 / 清除项目工作区（写回面板作用域）。 */
  onSelectWorkspace: (path?: string) => void;
  onCount?: (count: number) => void;
}) {
  const skillsApi = api.skills;
  const [scope, setScope] = useState<"global" | "project">("project");
  const [selected, setSelected] = useState<string | undefined>(undefined);
  /** 关系标签互跳的目标行：切 scope / 选工作区后待列表出现再选中。 */
  const [pendingSelect, setPendingSelect] = useState<string | undefined>(undefined);
  const [installOpen, setInstallOpen] = useState(false);
  const [installScope, setInstallScope] = useState<"project" | "global">("project");
  const [opError, setOpError] = useState<string | undefined>(undefined);
  const [busyRow, setBusyRow] = useState<string | undefined>(undefined);
  /** 写操作计数：传给 SkillContent，变化时清空文件缓存并重拉。 */
  const [contentVersion, setContentVersion] = useState(0);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  // 挂载时、工作区变化时（项目作用域列表依赖该 cwd 解析）、写操作后重新拉取。
  const { data: allItems, loading, error, reload } = useAsyncList(() => skillsApi.list(), [skillsApi, workspace]);
  const items = allItems ?? [];
  const projectItems = useMemo(() => items.filter((item) => isProjectSource(item.source)), [items]);
  const globalItems = useMemo(() => items.filter((item) => !isProjectSource(item.source)), [items]);

  // 域 Tab 计数 = 全部条目（含只读、含屏蔽占位，不去重；搜索不影响）。
  useEffect(() => {
    if (!loading && error === undefined) onCount?.(items.length);
  }, [items.length, loading, error, onCount]);

  const q = query.trim().toLowerCase();
  const matchesSkill = (item: ClientSkillSummary) =>
    q.length === 0 || item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
  const globalVisible = useMemo(() => globalItems.filter(matchesSkill), [globalItems, q]);
  const projectVisible = useMemo(() => projectItems.filter(matchesSkill), [projectItems, q]);
  const workspaceVisible = useMemo(
    () =>
      projects.filter(
        (project) =>
          q.length === 0 || basenameOf(project.path).toLowerCase().includes(q) || project.path.toLowerCase().includes(q),
      ),
    [projects, q],
  );

  /** 项目 scope 且尚未选择工作区 → 中间列只显示空态，工作区列表在左导航内。 */
  const showWorkspacePicker = scope === "project" && pinned === undefined;
  /** 当前中间列可选的技能行（决定键盘导航与关系互跳的落点）。 */
  const visibleSkills = useMemo(
    () => (showWorkspacePicker ? [] : scope === "global" ? globalVisible : projectVisible),
    [showWorkspacePicker, scope, globalVisible, projectVisible],
  );
  const visibleKeys = useMemo(() => visibleSkills.map(skillRowKey), [visibleSkills]);
  const selectedItem = items.find((item) => skillRowKey(item) === selected);

  // 工作区切换（含顶部项目下拉 / 左侧工作区列表 / 返回）一律清空选中；
  // pendingSelect 不清——关系互跳会在新列表到达后重新选中目标行。
  useEffect(() => {
    setSelected(undefined);
  }, [workspace, pinned]);

  // 关系标签互跳：切换 scope / 工作区后，等目标行出现再选中。
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

  /** 切 scope：清空选中与待跳目标（搜索结果保留，作用域切换后仍可沿用）。 */
  const switchScope = (next: "global" | "project") => {
    if (scope === next) return;
    setScope(next);
    setSelected(undefined);
    setPendingSelect(undefined);
    setOpError(undefined);
  };

  /** 选择 / 清除工作区：清空选中，写回面板钉选状态（列表随 workspace 重拉）。 */
  const chooseWorkspace = (path?: string) => {
    // 点工作区 = 进入项目 scope（全局态下也保留工作区列表，点选即切回项目）。
    setScope("project");
    setSelected(undefined);
    setPendingSelect(undefined);
    onSelectWorkspace(path);
  };

  /**
   * 关系标签互跳：项目行「覆盖全局」→ 全局同名行；全局行「项目副本生效中 /
   * 本项目已禁用」→ 项目行。跨 scope 时先切换 scope；项目侧尚未选工作区时
   * 自动钉选当前工作区（若在已知项目列表里），等列表刷新后再选中目标行。
   */
  const jumpToRelated = (item: ClientSkillSummary) => {
    const isProject = isProjectSource(item.source);
    let target: ClientSkillSummary | undefined;
    if (isProject) {
      if (item.shadowStub === true) return;
      target = globalItems.find((globalItem) => globalItem.name === item.name);
    } else if (item.projectShadow === "stub") {
      target = projectItems.find((entry) => entry.name === item.name && entry.shadowStub === true);
    } else if (item.projectShadow === "skill") {
      target = projectItems.find((entry) => entry.name === item.name && entry.shadowStub !== true);
    }
    if (target === undefined) return;
    const targetKey = skillRowKey(target);
    if (!isProject) {
      // 全局行 → 项目行：切到项目 scope；未选工作区时尝试钉选当前工作区。
      if (pinned !== undefined) {
        setScope("project");
        setSelected(undefined);
        setPendingSelect(targetKey);
        return;
      }
      const match = projects.find((project) => project.path === workspace);
      if (match === undefined) return;
      setScope("project");
      setSelected(undefined);
      setPendingSelect(targetKey);
      onSelectWorkspace(match.path);
      return;
    }
    // 项目行 → 全局行：全局 scope 无需工作区，直接切过去。
    setScope("global");
    setSelected(undefined);
    setPendingSelect(targetKey);
  };

  /** 行内统一开关：按行类型分派到 setEnabled / enableInProject / disableInProject。 */
  const toggleRow = async (item: ClientSkillSummary, next: boolean) => {
    const key = skillRowKey(item);
    if (busyRow !== undefined) return;
    setBusyRow(key);
    setOpError(undefined);
    try {
      const isProject = isProjectSource(item.source);
      const result = isProject
        ? item.shadowStub === true
          ? next
            ? await skillsApi.enableInProject({ name: item.name })
            : { ok: true as const }
          : await skillsApi.setEnabled({ ...skillRefOf(item), enabled: next })
        : next
          ? await skillsApi.enableInProject({ name: item.name })
          : await skillsApi.disableInProject({ name: item.name, fromRoot: item.root });
      if (!result.ok) {
        setOpError(result.errors.join("; "));
        return;
      }
      setContentVersion((value) => value + 1);
    } catch (failure) {
      setOpError(String(failure));
    } finally {
      setBusyRow(undefined);
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

  const openInstall = (target: "project" | "global") => {
    setInstallScope(target);
    setInstallOpen(true);
  };

  /** ScopeNav 一行：作用域名 + 计数 + 右侧「+」安装入口。 */
  const renderScopeItem = (target: "global" | "project", label: string, count: number | string) => {
    const addDisabled = target === "project" && pinned === undefined;
    const addTitle = addDisabled ? "先选择工作区" : target === "global" ? "安装技能到全局" : "安装技能到本项目";
    return (
      <div className={scope === target ? "skp-scope-item skp-scope-item-active" : "skp-scope-item"}>
        <button type="button" className="skp-scope-main" aria-pressed={scope === target} onClick={() => switchScope(target)}>
          <span className="skp-scope-label">{label}</span>
          <span className="skp-scope-count">{count}</span>
        </button>
        <button type="button" className="skp-scope-add" disabled={addDisabled} title={addTitle} aria-label={addTitle} onClick={() => openInstall(target)}>
          +
        </button>
      </div>
    );
  };

  /** 当前 scope 的技能列表（空态区分「没有」与搜索「无匹配」）。 */
  const renderSkillList = (list: ClientSkillSummary[], group: "global" | "project") => {
    if (list.length === 0) {
      if (q.length > 0) {
        return <div className="skp-empty">没有匹配「{query.trim()}」的技能。</div>;
      }
      return (
        <div className="skp-empty">
          <div>{group === "global" ? "还没有全局技能。" : "本项目还没有技能。"}</div>
          <button type="button" className="skp-btn" style={{ marginTop: 10 }} onClick={() => openInstall(group)}>
            {group === "global" ? "安装到全局" : "安装到本项目"}
          </button>
        </div>
      );
    }
    return (
      <div className="skp-group-scroll">
        <ul className="skp-list" role="listbox" aria-label={group === "global" ? "全局技能" : "本项目技能"}>
          {list.map((item) => (
            <li key={skillRowKey(item)} role="presentation">
              {renderRow(item)}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  /**
   * ScopeNav「项目」行下方的工作区列表（仅 project scope 渲染，nav 内自身滚动）。
   * 未选工作区时跟随搜索词过滤名称/路径；已选中工作区时保持完整列表方便切换。
   */
  const renderScopeWorkspaces = () => {
    const list = pinned === undefined ? workspaceVisible : projects;
    if (list.length === 0) {
      return <div className="skp-scope-empty">{pinned === undefined && q.length > 0 ? "无匹配" : "没有工作区"}</div>;
    }
    return (
      <div className="skp-scope-workspaces" role="listbox" aria-label="工作区">
        {list.map((project) => {
          const active = project.path === pinned;
          return (
            <button
              key={project.path}
              type="button"
              role="option"
              aria-selected={active}
              className={active ? "skp-scope-workspace skp-scope-workspace-active" : "skp-scope-workspace"}
              title={project.path}
              onClick={() => chooseWorkspace(project.path)}
            >
              <span className="skp-scope-workspace-name">{basenameOf(project.path)}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const renderRow = (item: ClientSkillSummary) => {
    const key = skillRowKey(item);
    const isProject = isProjectSource(item.source);
    const state = invocationState(item);
    const tags = skillTags(item, globalItems.some((global) => global.name === item.name));
    const switcher = skillSwitchDisabled(item, pinned !== undefined);
    const dotClass =
      item.shadowStub === true || item.readOnly
        ? "skp-dot skp-dot-hollow"
        : state === "full"
          ? "skp-dot skp-dot-enabled"
          : state === "partial"
            ? "skp-dot skp-dot-partial"
            : "skp-dot";
    const dotText =
      item.shadowStub === true
        ? "屏蔽占位"
        : item.readOnly
          ? "只读"
          : state === "full"
            ? "已启用"
            : state === "partial"
              ? "部分禁用"
              : "已禁用";
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
          {/* 状态点（仅项目行）：绿=全启用 / 蓝=部分禁用 / 灰=全禁用 / 空心=只读或屏蔽占位。 */}
          {isProject && (
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
            {tags.map((tag) =>
              tag.key === "override" || tag.key === "disabled-in-project" || tag.key === "project-copy" ? (
                <button
                  key={tag.key}
                  type="button"
                  className={tag.className}
                  title={tag.title}
                  onClick={(event) => {
                    event.stopPropagation();
                    jumpToRelated(item);
                  }}
                >
                  {tag.label}
                </button>
              ) : (
                <span key={tag.key} className={tag.className} title={tag.title}>
                  {tag.label}
                </span>
              ),
            )}
          </div>
          {/* 行尾统一开关（与 MCP 的「默认」开关同款同位置）。点击不改变选中。 */}
          <label
            className="skp-row-toggle"
            title={switcher.title}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <span className="skp-row-default-label">启用</span>
            <span className="skp-switch">
              <input
                type="checkbox"
                role="switch"
                aria-label={`启用 ${item.name}`}
                checked={skillSwitchChecked(item)}
                disabled={switcher.disabled || busyRow === key}
                onChange={(event) => void toggleRow(item, event.target.checked)}
              />
              <span className="skp-switch-track" />
            </span>
          </label>
        </div>
        <div className="skp-row-desc">{item.description.length > 0 ? item.description : "（无描述）"}</div>
      </div>
    );
  };

  return (
    <div className="skp-domain">
      {opError !== undefined && <div className="skp-error">{opError}</div>}
      {error !== undefined && <div className="skp-error">读取失败：{error}</div>}
      {loading && <div className="skp-status">加载中…</div>}

      {!loading && error === undefined && (
        <div className="skp-body">
          {/* 左侧作用域导航：全局 / 项目 + 工作区列表（两种 scope 都保留）。 */}
          <nav className="skp-scope-nav" aria-label="技能作用域">
            {renderScopeItem("global", "全局", globalItems.length)}
            {renderScopeItem("project", "项目", pinned === undefined ? "—" : projectItems.length)}
            {renderScopeWorkspaces()}
          </nav>

          {/* 中间列：只渲染当前列表标题 + 条目；未选工作区时显示空态引导。 */}
          <div className="skp-workspace-pane">
            <div className="skp-pane-title">
              {scope === "global" ? (
                <>
                  <span className="skp-pane-title-text">全局技能</span>
                  <span className="skp-group-count">{globalVisible.length}</span>
                </>
              ) : pinned === undefined ? (
                <span className="skp-pane-title-text">项目</span>
              ) : (
                <>
                  <span className="skp-pane-title-text" title={pinned}>
                    {basenameOf(pinned)}
                  </span>
                  <span className="skp-group-count">{projectVisible.length}</span>
                </>
              )}
            </div>
            {scope === "global" ? (
              renderSkillList(globalVisible, "global")
            ) : pinned === undefined ? (
              <div className="skp-empty">请选择左侧工作区</div>
            ) : (
              renderSkillList(projectVisible, "project")
            )}
          </div>

          <div className="skp-detail skp-detail-fixed">
            {selectedItem !== undefined ? (
              <SkillDetail
                key={skillRowKey(selectedItem)}
                summary={selectedItem}
                api={skillsApi}
                hasWorkspace={pinned !== undefined}
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
                {items.length === 0
                  ? "还没有任何技能。技能让 agent 在特定任务上按固定做法工作。"
                  : scope === "project" && showWorkspacePicker
                    ? "请选择左侧工作区，再查看或安装本项目技能。"
                    : "选择一个技能查看说明与全部文件内容。"}
              </div>
            )}
          </div>
        </div>
      )}

      {installOpen && (
        <InstallDialog
          api={skillsApi}
          hasWorkspace={pinned !== undefined}
          defaultScope={installScope}
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
 * 详情卡片：标题 / 动作区 / 元信息 + **文件树与阅读器**（本版新增）。
 *
 * 动作与元信息沿用旧实现（启用/禁用、模型/用户调用开关、导入到本项目、
 * 在本项目禁用/恢复、导出、导出到路径…、删除），删除确认从「两击」改为
 * 模态对话框；内容区见 skill-content.tsx。
 */
function SkillDetail({
  summary,
  api,
  hasWorkspace,
  contentVersion,
  onChanged,
  onRemoved,
}: {
  summary: ClientSkillSummary;
  api: SkillsApi;
  /** 面板是否附着在可写工作区上（全局条目的「导入到本项目」需要 cwd）。 */
  hasWorkspace: boolean;
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
  const state = invocationState(summary);

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

  /** 在本项目内禁用这个全局 skill：生成 shadow stub（不影响其它项目）。 */
  const doDisableInProject = async () => {
    setBusy(true);
    setOpError(undefined);
    try {
      const result = await api.disableInProject({ name: summary.name, fromRoot: summary.root });
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

  /** 恢复：删除本项目内的 shadow stub，该全局技能重新对本项目可见。 */
  const doEnableInProject = async () => {
    setBusy(true);
    setOpError(undefined);
    try {
      const result = await api.enableInProject({ name: summary.name });
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
      ? "将删除本项目内的屏蔽占位，同名全局技能在本项目恢复可用。"
      : isGlobal
        ? "将删除全局技能，所有项目都将不再可用。此操作不可撤销。"
        : "将删除本项目中的这份技能（含目录下的所有文件）。此操作不可撤销。";

  return (
    <div className="skp-detail-card">
      {/* 标题行：名称 + 归属标签 + 只读/覆盖/遮蔽徽标 + 右侧「复制路径」。 */}
      <div className="skp-detail-head">
        <h3 title={summary.name}>{summary.name}</h3>
        <span
          className={isGlobal ? "skp-tag skp-tag-global" : "skp-tag skp-tag-project"}
          title={isGlobal ? "全局技能（对所有项目生效）" : "本项目内的技能"}
        >
          {isGlobal ? "全局" : "项目"}
        </span>
        <span className="skp-tag skp-tag-flat">{summary.format === "directory" ? "目录" : ".md"}</span>
        {summary.readOnly && <span className="skp-badge">只读</span>}
        {summary.shadowStub === true && (
          <span className="skp-badge" title="屏蔽占位：使同名全局技能在本项目不可用；删除本条目即可恢复">
            屏蔽占位
          </span>
        )}
        {isGlobal && summary.projectShadow === "stub" && (
          <span className="skp-badge" title="本项目内已放置屏蔽占位，此技能在本项目不可用（不影响其它项目）">
            本项目已禁用
          </span>
        )}
        {isGlobal && summary.projectShadow === "skill" && (
          <span className="skp-badge" title="项目区有同名技能，按宿主优先级在本项目生效的是项目副本">
            项目副本生效中
          </span>
        )}
        <span className="skp-detail-head-spacer" />
        {summary.path !== undefined && (
          <button type="button" className="skp-link-btn" title={summary.path} onClick={() => void copyPath()}>
            {copied ? "已复制" : "复制路径"}
          </button>
        )}
      </div>

      {!summary.readOnly && (
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
              title="此全局技能当前为禁用状态；点击恢复启用（对所有项目生效）"
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
                  ? "项目内已有同名技能，再次点击将覆盖为全局副本"
                  : "复制到本项目（.agents/skills），此后可在本项目内独立启停"
              }
              onClick={() => void doImport(confirmImport)}
            >
              {confirmImport ? "确认覆盖项目内的同名技能？" : "导入到本项目"}
            </button>
          )}
          {hasWorkspace && isGlobal && summary.projectShadow === undefined && (
            <button
              type="button"
              className="skp-btn"
              disabled={busy}
              title="在本项目内禁用此全局技能（生成屏蔽占位，模型与用户调用都被宿主原生拒绝；不影响其它项目，可随时恢复）"
              onClick={() => void doDisableInProject()}
            >
              在本项目禁用
            </button>
          )}
          {hasWorkspace && isGlobal && summary.projectShadow === "stub" && (
            <button
              type="button"
              className="skp-btn"
              disabled={busy}
              title="删除本项目内的屏蔽占位，恢复此全局技能在本项目可用"
              onClick={() => void doEnableInProject()}
            >
              在本项目恢复
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
          来源 <span className="skp-detail-meta-strong">{summary.source}</span>
        </span>
        <span className="skp-detail-meta-item">{summary.format === "directory" ? "目录格式" : "单文件"}</span>
        {(summary.readOnly || !isGlobal) && (
          <span className="skp-detail-meta-item">
            调用方式
            {summary.readOnly || summary.shadowStub === true ? (
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
                      ? "点击关闭用户调用（输入框 /name 不再注入此技能；模型仍可自动触发）"
                      : "点击开启用户调用（输入框 /name 可注入此技能）"
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
        <Modal title={`删除技能「${summary.name}」？`} onClose={() => setDeleteOpen(false)}>
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

/** 安装对话框的作用域选项取值（映射到 scope/target 对）。 */
type InstallScopeChoice = "project-dsh" | "project-agents" | "global";

/** 安装对话框的来源模式与 Tab 文案。 */
const INSTALL_MODE = { upload: "上传", path: "宿主路径", url: "URL" } as const;
type InstallMode = keyof typeof INSTALL_MODE;

/**
 * 安装对话框：三种来源——浏览器上传（单个 .md / 整个 skill 目录 / .zip
 * 压缩包）、宿主磁盘路径、URL 下载（GitHub 仓库 / .zip / raw .md）。
 *
 * 作用域默认「本项目」（无工作区时默认「全局」、项目项置灰），可手动切到
 * 全局——对应「同屏双组」后不再有当前区概念，安装入口统一在工具条 /
 * 空组引导行（`defaultScope` 决定预选项）。
 */
function InstallDialog({
  api,
  hasWorkspace,
  defaultScope,
  onClose,
  onInstalled,
}: {
  api: SkillsApi;
  hasWorkspace: boolean;
  /** 预选作用域：工具条默认项目；空组引导行按组预选。 */
  defaultScope: "project" | "global";
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [mode, setMode] = useState<InstallMode>("upload");
  const [scopeChoice, setScopeChoice] = useState<InstallScopeChoice>(
    defaultScope === "global" || !hasWorkspace ? "global" : "project-agents",
  );
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [sourcePath, setSourcePath] = useState("");
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<{ label: string; files: SkillFilePayload[] } | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dirInputRef = useRef<HTMLInputElement | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);

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
    const scope = scopeChoice === "global" ? "global" : "project";
    const target = scopeChoice === "project-agents" ? ".agents" : scopeChoice === "project-dsh" ? ".dsh" : undefined;
    try {
      const result =
        mode === "upload"
          ? await api.installUpload({ scope, target, files: picked?.files ?? [], overwrite })
          : mode === "path"
            ? await api.installFromPath({ scope, target, sourcePath: sourcePath.trim(), overwrite })
            : await api.installFromUrl({ scope, target, url: url.trim(), overwrite });
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
    <Modal title="安装技能" onClose={onClose}>
      <div className="skp-form">
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

        <div className="skp-field">
          <span className="skp-field-label">安装到</span>
          <SkpSelect
            value={scopeChoice}
            ariaLabel="安装目标"
            options={[
              { value: "project-agents", label: "项目 — .agents/skills（默认）", disabled: !hasWorkspace },
              { value: "project-dsh", label: "项目 — .dsh/skills（旧）", disabled: !hasWorkspace },
              { value: "global", label: "全局 — ~/.agents/skills" },
            ]}
            onChange={(value) => setScopeChoice(value as InstallScopeChoice)}
          />
        </div>

        <label className="skp-field skp-field-inline">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          同名技能已存在时覆盖
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
