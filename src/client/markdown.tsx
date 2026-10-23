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

/** 行内标记：`` `code` `` 与 `**bold**`（其余字符原样输出）。 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let index = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      nodes.push(
        <code key={`${keyPrefix}-c${index}`} className="skp-md-inline-code">
          {match[1]}
        </code>,
      );
    } else {
      nodes.push(<strong key={`${keyPrefix}-b${index}`}>{match[2]}</strong>);
    }
    last = match.index + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** 段落内软换行：CJK 之间直接拼接，西文之间补一个空格（贴近 CommonMark 行为）。 */
function joinSoft(a: string, b: string): string {
  const cjkEnd = /[\u3000-\u9fff\uff00-\uffef]$/;
  const cjkStart = /^[\u3000-\u9fff\uff00-\uffef]/;
  return cjkEnd.test(a) || cjkStart.test(b) ? `${a}${b}` : `${a} ${b}`;
}

/** 围栏代码块起始行（``` 或 ~~~，允许首行缩进 ≤3 空格与语言后缀）。 */
function fenceStart(line: string): { marker: string; lang: string } | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
  if (match === null) return undefined;
  return { marker: match[1][0].repeat(match[1].length), lang: match[2] };
}

/** 是否是一行的块级起始（用于段落收集时提前收口）。 */
function isBlockStart(line: string): boolean {
  return (
    /^ {0,3}#{1,6}\s+/.test(line) ||
    /^ {0,3}>/.test(line) ||
    /^ {0,3}(?:[-*+]|\d+[.)])\s+/.test(line) ||
    /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
    fenceStart(line) !== undefined
  );
}

function headingLevel(hashes: string): number {
  return Math.min(hashes.length, 3);
}

/**
 * 把 Markdown 原文解析为 React 元素树。
 *
 * 调用方负责兜底：本函数对任何输入都返回合法元素，但若未来出现解析缺陷，
 * `MarkdownPreview` 会捕获异常并显示 `<pre>` 原文。
 */
export function renderMarkdown(source: string): ReactNode {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行。
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }

    // 围栏代码块：内容原样保留（含缩进），直到同字符、长度不短于起始的围栏。
    const fence = fenceStart(line);
    if (fence !== undefined) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length) {
        const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[i]);
        if (closing !== null && closing[1][0] === fence.marker[0] && closing[1].length >= fence.marker.length) {
          i += 1;
          break;
        }
        code.push(lines[i]);
        i += 1;
      }
      blocks.push(
        <pre key={`pre-${blocks.length}`} className="skp-md-pre">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // ATX 标题。
    const heading = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      const level = headingLevel(heading[1]);
      const key = `h-${blocks.length}`;
      const content = renderInline(heading[2], key);
      if (level === 1) {
        blocks.push(
          <h1 key={key} className="skp-md-h1">
            {content}
          </h1>,
        );
      } else if (level === 2) {
        blocks.push(
          <h2 key={key} className="skp-md-h2">
            {content}
          </h2>,
        );
      } else {
        blocks.push(
          <h3 key={key} className="skp-md-h3">
            {content}
          </h3>,
        );
      }
      i += 1;
      continue;
    }

    // 分隔线。
    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={`hr-${blocks.length}`} className="skp-md-hr" />);
      i += 1;
      continue;
    }

    // 引用块：连续 `>` 行合成一个 blockquote，每个源行一段。
    if (/^ {0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^ {0,3}>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote key={`bq-${blocks.length}`} className="skp-md-quote">
          {quoted.map((text, index) => (
            <p key={`bq-${blocks.length}-${index}`}>{renderInline(text, `bq-${blocks.length}-${index}`)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // 列表：同类型连续行合成一个 ul / ol（L1 不解析嵌套）。
    const unordered = /^ {0,3}[-*+]\s+(.*)$/.exec(line);
    const ordered = /^ {0,3}\d+[.)]\s+(.*)$/.exec(line);
    if (unordered !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const items: string[] = [];
      while (i < lines.length) {
        const nextUnordered = /^ {0,3}[-*+]\s+(.*)$/.exec(lines[i]);
        const nextOrdered = /^ {0,3}\d+[.)]\s+(.*)$/.exec(lines[i]);
        const match = isOrdered ? nextOrdered : nextUnordered;
        if (match === null) break;
        items.push(match[1]);
        i += 1;
      }
      const ListTag = isOrdered ? "ol" : "ul";
      blocks.push(
        <ListTag key={`list-${blocks.length}`} className={isOrdered ? "skp-md-ol" : "skp-md-ul"}>
          {items.map((item, index) => (
            <li key={`li-${blocks.length}-${index}`}>{renderInline(item, `li-${blocks.length}-${index}`)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    // 段落：收集到空行或下一个块级起始为止；软换行按 CJK 规则拼接。
    const paragraph: string[] = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim().length > 0 && !isBlockStart(lines[i])) {
      const previous = paragraph[paragraph.length - 1];
      paragraph[paragraph.length - 1] = joinSoft(previous, lines[i].trim());
      i += 1;
    }
    blocks.push(
      <p key={`p-${blocks.length}`} className="skp-md-p">
        {renderInline(paragraph.join("\n"), `p-${blocks.length}`)}
      </p>,
    );
  }

  return blocks;
}

/** 裁掉 YAML frontmatter（预览用；「源码」视图仍显示完整原文）。 */
export function stripFrontmatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/**
 * 预览组件：正常时渲染 Markdown 元素树；渲染器抛错时回落到 `<pre>` 原文
 * 并提示（见 UX §5.9 的降级判定）。
 */
export function MarkdownPreview({ source }: { source: string }) {
  try {
    return <div className="skp-md">{renderMarkdown(source)}</div>;
  } catch {
    return (
      <div className="skp-md skp-md-fallback">
        <p className="skp-md-warn">Markdown 渲染失败，已显示原文</p>
        <pre className="skp-md-pre">{source}</pre>
      </div>
    );
  }
}
