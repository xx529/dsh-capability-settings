/**
 * v22 详情页外壳：能力中心「Skills / MCP」两个详情页共用的头部与菜单原语。
 *
 * 设计目标（见 `docs/figma/preview/v22-*`，页面 `Capability Panel · 详情页内容优先 v22 草案`）：
 * 把详情页从「整列滚动 + 元数据堆叠」改成「固定头部三段 + 内容区独立滚动」：
 *
 * ```
 * 标题行（名称 / 徽章 / 开关 / ⋯ 菜单）
 * 状态条（作用域链摘要 · 来源 · 命名空间 … | 使用记录 · 元数据 ⌄）
 * 内容工具条（由各域自己渲染）
 * 内容区（flex:1，内部滚动）
 * ```
 *
 * 长元数据（URL / 配置文件 / frontmatter / 可见范围 …）由 `MetaPanel` 承载，
 * 默认收起、点状态条右侧「元数据」展开；低频与破坏性动作收进 `MoreMenu`。
 *
 * 纯展示组件，不含业务状态；MCP / Skills 两个域各自传入数据与回调。
 *
 * @module dsh-capability-settings/client/detail-shell
 */
import type { ReactNode } from "react";
/** 详情页根容器：固定头部 + 可滚动内容（样式见 `.skp-detail-page`）。 */
export declare function DetailPage({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
/** 标题行：名称 + 徽章；右侧由调用方放开关 / 菜单。 */
export declare function DetailTitleBar({ title, tags, right, }: {
    title: string;
    tags?: ReactNode;
    right?: ReactNode;
}): import("react").JSX.Element;
/** 状态条：单行摘要；超宽省略，不换行。 */
export declare function DetailStrip({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
/** 状态条里的分隔竖线。 */
export declare function StripSeparator(): import("react").JSX.Element;
/**
 * 启用开关（详情页常驻）：`checked` / `partial` 表达三态（全开 / 部分 / 全关）。
 * 语义由调用方决定（Skills = 模型与用户都可调用；MCP = 配置内启用）。
 */
export declare function ToggleSwitch({ checked, partial, disabled, title, label, onChange, }: {
    checked: boolean;
    partial?: boolean;
    disabled?: boolean;
    title?: string;
    label?: string;
    onChange(next: boolean): void;
}): import("react").JSX.Element;
/** ⋯ 菜单项：`danger` 用红色；`confirming` 用于二次确认态（红色实心文案）。 */
export interface MoreMenuItem {
    key: string;
    label: string;
    onSelect(): void;
    title?: string;
    danger?: boolean;
    disabled?: boolean;
}
/**
 * 低频 / 破坏性动作收进 `⋯` 菜单：点外部或 Esc 关闭；菜单项点击后自动收起。
 */
export declare function MoreMenu({ items, label }: {
    items: MoreMenuItem[];
    label?: string;
}): import("react").JSX.Element;
/** 元数据面板（默认收起；展开后内容区整体下移，自身不滚动）。 */
export declare function MetaPanel({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
/** 元数据网格（3 列；窄容器降为 2 列 / 1 列）。 */
export declare function MetaGrid({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
/** 元数据单元：小标题 + 值（单行省略，完整值走 title）。 */
export declare function MetaCell({ label, mono, title, children, }: {
    label: string;
    mono?: boolean;
    title?: string;
    children: ReactNode;
}): import("react").JSX.Element;
