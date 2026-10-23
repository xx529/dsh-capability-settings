import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** 行内标记：`` `code` `` 与 `**bold**`（其余字符原样输出）。 */
function renderInline(text, keyPrefix) {
    const nodes = [];
    const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
    let last = 0;
    let index = 0;
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
        if (match.index > last)
            nodes.push(text.slice(last, match.index));
        if (match[1] !== undefined) {
            nodes.push(_jsx("code", { className: "skp-md-inline-code", children: match[1] }, `${keyPrefix}-c${index}`));
        }
        else {
            nodes.push(_jsx("strong", { children: match[2] }, `${keyPrefix}-b${index}`));
        }
        last = match.index + match[0].length;
        index += 1;
    }
    if (last < text.length)
        nodes.push(text.slice(last));
    return nodes;
}
/** 段落内软换行：CJK 之间直接拼接，西文之间补一个空格（贴近 CommonMark 行为）。 */
function joinSoft(a, b) {
    const cjkEnd = /[\u3000-\u9fff\uff00-\uffef]$/;
    const cjkStart = /^[\u3000-\u9fff\uff00-\uffef]/;
    return cjkEnd.test(a) || cjkStart.test(b) ? `${a}${b}` : `${a} ${b}`;
}
/** 围栏代码块起始行（``` 或 ~~~，允许首行缩进 ≤3 空格与语言后缀）。 */
function fenceStart(line) {
    const match = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (match === null)
        return undefined;
    return { marker: match[1][0].repeat(match[1].length), lang: match[2] };
}
/** 是否是一行的块级起始（用于段落收集时提前收口）。 */
function isBlockStart(line) {
    return (/^ {0,3}#{1,6}\s+/.test(line) ||
        /^ {0,3}>/.test(line) ||
        /^ {0,3}(?:[-*+]|\d+[.)])\s+/.test(line) ||
        /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
        fenceStart(line) !== undefined);
}
function headingLevel(hashes) {
    return Math.min(hashes.length, 3);
}
/**
 * 把 Markdown 原文解析为 React 元素树。
 *
 * 调用方负责兜底：本函数对任何输入都返回合法元素，但若未来出现解析缺陷，
 * `MarkdownPreview` 会捕获异常并显示 `<pre>` 原文。
 */
export function renderMarkdown(source) {
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
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
            const code = [];
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
            blocks.push(_jsx("pre", { className: "skp-md-pre", children: _jsx("code", { children: code.join("\n") }) }, `pre-${blocks.length}`));
            continue;
        }
        // ATX 标题。
        const heading = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
        if (heading !== null) {
            const level = headingLevel(heading[1]);
            const key = `h-${blocks.length}`;
            const content = renderInline(heading[2], key);
            if (level === 1) {
                blocks.push(_jsx("h1", { className: "skp-md-h1", children: content }, key));
            }
            else if (level === 2) {
                blocks.push(_jsx("h2", { className: "skp-md-h2", children: content }, key));
            }
            else {
                blocks.push(_jsx("h3", { className: "skp-md-h3", children: content }, key));
            }
            i += 1;
            continue;
        }
        // 分隔线。
        if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
            blocks.push(_jsx("hr", { className: "skp-md-hr" }, `hr-${blocks.length}`));
            i += 1;
            continue;
        }
        // 引用块：连续 `>` 行合成一个 blockquote，每个源行一段。
        if (/^ {0,3}>/.test(line)) {
            const quoted = [];
            while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
                quoted.push(lines[i].replace(/^ {0,3}>\s?/, ""));
                i += 1;
            }
            blocks.push(_jsx("blockquote", { className: "skp-md-quote", children: quoted.map((text, index) => (_jsx("p", { children: renderInline(text, `bq-${blocks.length}-${index}`) }, `bq-${blocks.length}-${index}`))) }, `bq-${blocks.length}`));
            continue;
        }
        // 列表：同类型连续行合成一个 ul / ol（L1 不解析嵌套）。
        const unordered = /^ {0,3}[-*+]\s+(.*)$/.exec(line);
        const ordered = /^ {0,3}\d+[.)]\s+(.*)$/.exec(line);
        if (unordered !== null || ordered !== null) {
            const isOrdered = ordered !== null;
            const items = [];
            while (i < lines.length) {
                const nextUnordered = /^ {0,3}[-*+]\s+(.*)$/.exec(lines[i]);
                const nextOrdered = /^ {0,3}\d+[.)]\s+(.*)$/.exec(lines[i]);
                const match = isOrdered ? nextOrdered : nextUnordered;
                if (match === null)
                    break;
                items.push(match[1]);
                i += 1;
            }
            const ListTag = isOrdered ? "ol" : "ul";
            blocks.push(_jsx(ListTag, { className: isOrdered ? "skp-md-ol" : "skp-md-ul", children: items.map((item, index) => (_jsx("li", { children: renderInline(item, `li-${blocks.length}-${index}`) }, `li-${blocks.length}-${index}`))) }, `list-${blocks.length}`));
            continue;
        }
        // 段落：收集到空行或下一个块级起始为止；软换行按 CJK 规则拼接。
        const paragraph = [line.trim()];
        i += 1;
        while (i < lines.length && lines[i].trim().length > 0 && !isBlockStart(lines[i])) {
            const previous = paragraph[paragraph.length - 1];
            paragraph[paragraph.length - 1] = joinSoft(previous, lines[i].trim());
            i += 1;
        }
        blocks.push(_jsx("p", { className: "skp-md-p", children: renderInline(paragraph.join("\n"), `p-${blocks.length}`) }, `p-${blocks.length}`));
    }
    return blocks;
}
/** 裁掉 YAML frontmatter（预览用；「源码」视图仍显示完整原文）。 */
export function stripFrontmatter(source) {
    return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
/**
 * 预览组件：正常时渲染 Markdown 元素树；渲染器抛错时回落到 `<pre>` 原文
 * 并提示（见 UX §5.9 的降级判定）。
 */
export function MarkdownPreview({ source }) {
    try {
        return _jsx("div", { className: "skp-md", children: renderMarkdown(source) });
    }
    catch {
        return (_jsxs("div", { className: "skp-md skp-md-fallback", children: [_jsx("p", { className: "skp-md-warn", children: "Markdown \u6E32\u67D3\u5931\u8D25\uFF0C\u5DF2\u663E\u793A\u539F\u6587" }), _jsx("pre", { className: "skp-md-pre", children: source })] }));
    }
}
