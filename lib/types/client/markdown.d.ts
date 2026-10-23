/**
 * 零依赖的轻量 Markdown 渲染（L1，见 docs/ux/panel-upgrade.md §5.9）。
 *
 * 只识别「技能文件里实际会出现的结构」：
 *   - ATX 标题 `#` ~ `###`（更深的标题降级为 h3）
 *   - 有序 / 无序列表（单层，不解析嵌套）
 *   - ``` 围栏代码块（不做语法高亮）
 *   - `>` 引用、`---` 分隔线、普通段落
 *   - 行内 `` `code` `` 与 `**bold**`
 *
 * 刻意**不**做的事：不解析内联 HTML、不调用 `dangerouslySetInnerHTML`、
 * 不加载外链图片 / iframe、不引第三方库——渲染结果始终是 React 元素树，
 * 因此没有 XSS 面。渲染器自身抛错时由调用方回落到 `<pre>` 原文
 * （见 skill-content.tsx 的 MarkdownPreview）。
 *
 * @module @chengdb/capability-panel/client/markdown
 */
import type { ReactNode } from "react";
/**
 * 把 Markdown 原文解析为 React 元素树。
 *
 * 调用方负责兜底：本函数对任何输入都返回合法元素，但若未来出现解析缺陷，
 * `MarkdownPreview` 会捕获异常并显示 `<pre>` 原文。
 */
export declare function renderMarkdown(source: string): ReactNode;
/** 裁掉 YAML frontmatter（预览用；「源码」视图仍显示完整原文）。 */
export declare function stripFrontmatter(source: string): string;
/**
 * 预览组件：正常时渲染 Markdown 元素树；渲染器抛错时回落到 `<pre>` 原文
 * 并提示（见 UX §5.9 的降级判定）。
 */
export declare function MarkdownPreview({ source }: {
    source: string;
}): import("react").JSX.Element;
