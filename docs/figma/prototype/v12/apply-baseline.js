/**
 * apply-baseline.js — 把已确认的 v12 方案**补丁式**落到 Figma 基线（贴进 use_figma 执行）。
 *
 * 覆盖：
 *   1) v8 page 42:3373 · frame 42:3433「02 · 技能 · 全局」
 *      新增「注入技能」分组 + 5 个注入行（来源标签 + 渠道名 + 开关）；
 *      详情切到注入技能 figma-workbench（只读原因条 / meta / 资源树 / 阅读器）；
 *      列表与 scope 计数改为 157 / 14（与 v12-01 参考帧 88:8523 对齐）。
 *   2) v8 page 42:3373 · frame 42:3376「01 · 技能 · 项目」
 *      仅同步左导航「全局」计数 146 → 157（项目内容与语义不变）。
 *   3) v11 page 56:7043 · frame 56:7679「04 · 能力决策 · 结果」
 *      6 行结果加**来源标签**（全局 / dsh-to-figma / 内置 / dsh-remote / 预设 cordis）
 *      并把说明列右移；行内容/分数对齐 v12-03 参考帧 88:9011；底部说明更新。
 *
 * 纪律：
 *   - **幂等**：新增节点统一 `v12/` 前缀，重跑先删；被隐藏的基线节点打
 *     `v12-hidden` pluginData，重跑先恢复再隐藏，绝不删除基线节点。
 *   - **不动历史页面**：v5 / v6 / v7 / v9 / v10 与 v12 提案页 88:8519 完全不碰。
 *   - 返回新/改节点 id，便于回执与 scene 导出核对。
 */
await figma.loadAllPagesAsync();

const F = {
  r: { family: "PingFang SC", style: "Regular" },
  m: { family: "PingFang SC", style: "Medium" },
  sb: { family: "PingFang SC", style: "Semibold" },
  code: { family: "Menlo", style: "Regular" },
};
for (const k of ["r", "m", "sb", "code"]) await figma.loadFontAsync(F[k]);

const C = {
  bg: "#1E222B", panel: "#23272F", rail: "#1B1F27", tabOn: "#2E3540", rowOn: "#2A303B",
  blue: "#61AFEF", blueLt: "#8FBCFF", green: "#98C379", warn: "#D19A66", red: "#E06C75",
  t1: "#E3E6EA", t2: "#9DA5B4", t3: "#7F8794", reader: "#1F232B", purple: "#B79CFF", ink: "#0F1115",
};

const P = "v12/";
const HIDE = "v12-hidden";

const rgb = (h) => {
  h = h.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
};
const paint = (h, o) => ({ type: "SOLID", color: rgb(h), opacity: o == null ? 1 : o });
function txtw(s, fs) {
  let w = 0;
  for (const ch of s) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? fs : fs * 0.55;
  return Math.ceil(w);
}
function monoW(s, fs) {
  return Math.ceil(s.length * fs * 0.62);
}

function box(p, name, x, y, w, h, o) {
  o = o || {};
  const n = figma.createFrame();
  p.appendChild(n);
  n.name = name;
  n.x = x; n.y = y; n.resize(w, h);
  n.clipsContent = o.clip !== false;
  n.fills = o.fill ? [paint(o.fill, o.fillOp)] : [];
  n.cornerRadius = o.r || 0;
  n.strokes = o.stroke ? [paint(o.stroke, o.strokeOp)] : [];
  n.strokeWeight = 1; n.strokeAlign = "INSIDE"; n.effects = [];
  return n;
}
function text(p, name, x, y, w, h, chars, o) {
  o = o || {};
  const n = figma.createText();
  p.appendChild(n);
  n.name = name;
  n.fontName = o.font || F.r;
  n.fontSize = o.size || 13.5;
  n.lineHeight = { value: o.lh || Math.round((o.size || 13.5) * 1.55), unit: "PIXELS" };
  n.fills = [paint(o.color || C.t1)];
  n.textAutoResize = "NONE";
  n.characters = chars;
  n.resize(w, h);
  n.x = x; n.y = y;
  n.textAlignHorizontal = o.align || "LEFT";
  n.textAlignVertical = o.valign || "CENTER";
  if (o.trunc) { try { n.textTruncation = "ENDING"; } catch (e) {} }
  return n;
}
const hline = (p, name, x, y, w, op) => box(p, name, x, y, w, 1, { fill: "#FFFFFF", fillOp: op == null ? 0.06 : op, clip: false });
function clipText(p, name, x, y, w, h, chars, o) {
  const c = box(p, name, x, y, w, h, { clip: true });
  text(c, name + "/t", 0, 0, w, h, chars, o);
  return c;
}
function setChars(node, chars) {
  if (!node) return false;
  try { node.characters = chars; return true; } catch (e) { return false; }
}
function recolorText(node, color) {
  if (!node || !("fills" in node)) return;
  try { node.fills = [paint(color)]; } catch (e) {}
}

// —— 标签样式：来源类别 / 渠道 ——
function tagSpec(kind) {
  if (kind === "bundled") return { bg: C.warn, bgOp: 0.14, color: C.warn, font: F.m, size: 10.5 };
  if (kind === "plugin") return { bg: C.purple, bgOp: 0.18, color: C.purple, font: F.m, size: 10.5 };
  if (kind === "preset") return { bg: "#FFFFFF", bgOp: 0.06, color: C.t2, font: F.m, size: 10.5 };
  if (kind === "disk") return { bg: C.green, bgOp: 0.12, color: C.green, font: F.m, size: 10.5 };
  // channel：等宽、弱化
  return { bg: "#FFFFFF", bgOp: 0.06, color: C.t3, font: F.code, size: 10 };
}
function makeTag(p, name, x, y, label, kind) {
  const st = tagSpec(kind);
  const w = (st.font === F.code ? monoW(label, st.size) : txtw(label, st.size)) + 10;
  const h = 16;
  const n = box(p, name, x, y, w, h, { fill: st.bg, fillOp: st.bgOp, r: 4 });
  text(n, name + "/t", 0, 0, w, h, label, { size: st.size, font: st.font, color: st.color, align: "CENTER", lh: h });
  return n;
}
function sw(p, name, x, y, on) {
  const t = box(p, name, x, y, 30, 18, { r: 999, fill: "#FFFFFF", fillOp: 0.13 });
  if (on) t.fills = [paint(C.blue)];
  box(t, name + "/knob", on ? 14 : 2, 2, 14, 14, { fill: on ? "#FFFFFF" : "#C9CED8", r: 7, clip: false });
  return t;
}
function toggle(p, x, y, label, on) {
  text(p, "toggle-label", x - 40, y, 32, 18, label, { size: 10.5, color: C.t3, align: "RIGHT", lh: 18 });
  return sw(p, "switch", x, y, on);
}

// —— 幂等工具 ——
function cleanup(root) {
  for (const n of [...root.findAll((n) => String(n.name || "").startsWith(P))]) {
    if (!n.removed) n.remove();
  }
}
function restoreHidden(root) {
  for (const n of root.findAll(() => true)) {
    try {
      if (n.getPluginData(HIDE) === "1") {
        n.visible = true;
        n.setPluginData(HIDE, "");
      }
    } catch (e) {}
  }
}
function hide(node) {
  if (!node || node.removed) return;
  try { node.setPluginData(HIDE, "1"); } catch (e) {}
  node.visible = false;
}

// ===========================================================================
// 1) v8 · 02 技能 · 全局
// ===========================================================================
const v8Page = await figma.getNodeByIdAsync("42:3373");
if (!v8Page) throw new Error("v8 页面 42:3373 不存在");
await figma.setCurrentPageAsync(v8Page);

function v8Frame(prefix) {
  const fr = v8Page.children.find((n) => n.type === "FRAME" && String(n.name || "").startsWith(prefix));
  if (!fr) throw new Error("v8 帧不存在：" + prefix);
  return fr;
}
const g = v8Frame("02");
cleanup(g);
restoreHidden(g);

// 头部/侧栏/列表计数（与 v12-01 对齐）
const tabT = g.findOne((n) => n.name === "header/tab-skills-t");
setChars(tabT, "技能 157");
const scopeGlobal = g.findOne((n) => n.name === "scope/global");
const scopeCount = scopeGlobal && scopeGlobal.children.find((n) => n.name === "count");
setChars(scopeCount, "157");
setChars(g.findOne((n) => n.name === "list/count-t"), "14");

// 磁盘全局行只保留前 2 个（v12-01 版式），其余 3 行隐藏（不删除）
for (const nm of ["row/acquisition-channel-advisor", "row/altitude-horizon-framework", "row/ai-shaped-readiness-advisor"]) {
  hide(g.findOne((n) => n.name === nm));
}
// 选中态移到注入行的 figma-workbench
const row1 = g.findOne((n) => n.name === "row/agent-orchestration-advisor");
if (row1) {
  row1.fills = [];
  const bar = row1.children.find((n) => n.name === "sel-bar");
  if (bar) bar.visible = false;
}

// 分组头（分隔线 + 标题 + 计数 + 右侧说明）
const created = [];
const GH_Y = 314;
hline(g, P + "group/line", 472, GH_Y, 284, 0.06);
created.push(text(g, P + "group/title", 484, GH_Y + 6, 60, 22, "注入技能", { size: 12, font: F.sb, color: C.t2, lh: 22 }).id);
created.push(text(g, P + "group/count", 536, GH_Y + 6, 24, 22, "5", { size: 11, font: F.m, color: C.t3, lh: 22 }).id);
created.push(text(g, P + "group/note", 620, GH_Y + 6, 136, 22, "内容只读 · 可启停", { size: 11, color: C.t3, align: "RIGHT", lh: 22 }).id);

// 5 个注入行
function injectedRow(title, y, o) {
  const safe = title.replace(/[^a-zA-Z0-9-]/g, "-");
  const r = box(g, P + "row/" + safe, 472, y, 284, 76, { r: 10, fill: o.sel ? C.rowOn : null });
  const ids = [r.id];
  if (o.sel) ids.push(box(r, "sel-bar", 8, 8, 2, 60, { fill: C.blue, r: 1 }).id);
  ids.push(box(r, "dot", 12, 13, 8, 8, { fill: o.on ? C.green : C.t3, r: 4 }).id);
  ids.push(clipText(r, "name", 24, 7, 170, 20, title, { size: 13.5, font: F.sb, lh: 20, trunc: true }).id);
  const ot = makeTag(r, "tag-origin", 24, 28, o.originLabel, o.originKind);
  ids.push(ot.id);
  const ct = makeTag(r, "tag-channel", 24 + ot.width + 4, 28, o.channel, "channel");
  ids.push(ct.id);
  ids.push(clipText(r, "desc", 12, 50, 184, 20, o.desc, { size: 12.5, color: C.t2, lh: 20, trunc: true }).id);
  const tg = toggle(r, 244, 29, "启用", o.on);
  ids.push(tg.id);
  return ids;
}
const INJECTED = [
  { title: "figma-workbench", originLabel: "插件", originKind: "plugin", channel: "dsh-to-figma", desc: "Figma 设计稿读写（本地桥）", on: true, sel: true },
  { title: "dsh-remote-deploy", originLabel: "插件", originKind: "plugin", channel: "dsh-remote", desc: "远端 DSH 部署与排障", on: true },
  { title: "dsh-diff-approval-answer", originLabel: "插件", originKind: "plugin", channel: "dsh-diff-approval", desc: "代码批注卡片与评论应答", on: true },
  { title: "office", originLabel: "内置", originKind: "bundled", channel: "dsh-office", desc: "Word / PPT / Excel 文档工作流", on: false },
  { title: "office-docx", originLabel: "内置", originKind: "bundled", channel: "dsh-office", desc: "Word 文档创建与校验", on: true },
];
INJECTED.forEach((row, i) => {
  created.push(...injectedRow(row.title, 348 + i * 80, row));
});

// —— 详情切到注入技能 figma-workbench ——
setChars(g.findOne((n) => n.name === "detail/name/t"), "figma-workbench");
// 来源标签：全局 → 插件（紫）
const tagOrigin = g.findOne((n) => n.name === "detail/tag-global");
if (tagOrigin) {
  tagOrigin.fills = [paint(C.purple, 0.18)];
  const t = tagOrigin.children.find((n) => n.name === "tag-global/t") || tagOrigin.children[0];
  if (t) { setChars(t, "插件"); recolorText(t, C.purple); }
  tagOrigin.resize(txtw("插件", 10.5) + 10, 16);
  if (t) t.resize(tagOrigin.width, 16);
}
// 渠道标签
created.push(makeTag(g, P + "detail/tag-channel", 1148, 136, "dsh-to-figma", "channel").id);
// 写操作按钮隐藏（注入内容只读）
for (const nm of ["act/import", "act/export", "act/export-path", "act/delete"]) hide(g.findOne((n) => n.name === nm));
// 只读原因条
const noteBox = box(g, P + "detail/readonly", 788, 174, 628, 36, { fill: C.rowOn, r: 8 });
created.push(noteBox.id);
created.push(text(noteBox, P + "detail/readonly/t", 12, 0, 604, 36,
  "内容只读 · 由插件 dsh-to-figma 运行时注册（无磁盘副本）；可在列表 / 会话中启用或禁用，不可编辑或删除。",
  { size: 11.5, color: C.t3, lh: 36 }).id);
// meta：来源 / 注入方式 / 调用方式
setChars(g.findOne((n) => n.name === "meta/source/t"), "来源 dsh-to-figma");
hide(g.findOne((n) => n.name === "meta/path"));
created.push(text(g, P + "meta/mode", 956, 218, 210, 36, "插件注入 · 运行时注册（不落盘）", { size: 12, color: C.t2, lh: 36 }).id);

// —— 资源树（隐藏基线子节点，按 v12 重绘） ——
const tree = g.findOne((n) => n.name === "detail/tree");
if (tree) {
  for (const c of [...tree.children]) hide(c);
  created.push(text(tree, P + "tree/title", 12, 0, 100, 36, "技能文件", { size: 13, font: F.sb, lh: 36 }).id);
  created.push(text(tree, P + "tree/count", 152, 0, 36, 36, "4", { size: 12, color: C.t3, align: "RIGHT", lh: 36 }).id);
  created.push(hline(tree, P + "tree/line", 12, 36, 176).id);
  const TH = 30, TBD = 118, TS = 156;
  function badge(name, x, y, label) {
    const b = box(tree, name, x, y, 22, 14, { fill: "#FFFFFF", fillOp: 0.06, r: 3 });
    text(b, name + "/t", 0, 0, 22, 14, label, { size: 8, font: F.code, color: C.t3, align: "CENTER", lh: 14 });
    return b;
  }
  function treeRow(name, y, o) {
    const ind = o.ind || 0;
    const ids = [];
    if (o.sel) {
      ids.push(box(tree, name + "/bg", 4, y, 192, TH, { fill: C.rowOn, r: 6 }).id);
      ids.push(box(tree, name + "/bar", 4, y + 6, 2, 18, { fill: C.blue, r: 1 }).id);
    }
    if (o.icon) ids.push(text(tree, name + "/icon", 12 + ind, y, 12, TH, o.icon, { size: 9.5, color: C.t3, lh: TH }).id);
    const nx = 26 + ind;
    const right = o.badge ? TBD - 4 : o.size ? TS - 4 : 196;
    ids.push(clipText(tree, name + "/label", nx, y, right - nx, TH, o.label, { size: o.fs || 10, font: F.code, color: o.color || C.t1, lh: TH, trunc: true }).id);
    if (o.count) ids.push(text(tree, name + "/count", nx + txtw(o.label, 10) + 4, y, 18, TH, o.count, { size: 9.5, color: C.t3, lh: TH }).id);
    if (o.badge) badge(name + "/badge", TBD, y + (TH - 14) / 2, o.badge);
    if (o.size) ids.push(text(tree, name + "/size", TS, y, 40, TH, o.size, { size: 10.5, color: C.t3, align: "RIGHT", lh: TH }).id);
    return ids;
  }
  created.push(...treeRow(P + "tree/root", 44, { icon: "▾", label: "figma-workbench/", color: C.t2 }));
  created.push(box(tree, P + "tree/guide", 28, 74, 1, 150, { fill: "#FFFFFF", fillOp: 0.08, clip: false }).id);
  created.push(...treeRow(P + "tree/skill-md", 74, { sel: true, ind: 10, label: "SKILL.md", badge: "MD", size: "8.2K" }));
  created.push(...treeRow(P + "tree/references", 104, { ind: 10, icon: "▾", label: "references/", count: "2" }));
  created.push(...treeRow(P + "tree/workflow", 134, { ind: 20, label: "workflow.md", badge: "MD", size: "3.4K" }));
  created.push(...treeRow(P + "tree/plugin-api", 164, { ind: 20, label: "plugin-api.md", badge: "MD", size: "2.8K" }));
  created.push(...treeRow(P + "tree/design", 194, { ind: 20, label: "design-to-code.md", badge: "MD", size: "1.9K" }));
  created.push(box(tree, P + "tree/scrollbar", 188, 44, 3, 160, { fill: "#FFFFFF", fillOp: 0.1, r: 2 }).id);
}

// —— 阅读器（隐藏基线子节点，按 v12 重绘） ——
const rd = g.findOne((n) => n.name === "detail/reader");
if (rd) {
  for (const c of [...rd.children]) hide(c);
  created.push(text(rd, P + "reader/file", 14, 0, 120, 40, "SKILL.md", { size: 13, font: F.sb, lh: 40 }).id);
  created.push(text(rd, P + "reader/meta", 140, 0, 120, 40, "5.9 KB · MD", { size: 11, color: C.t3, lh: 40 }).id);
  const seg = box(rd, P + "reader/seg", 300, 7, 100, 26, { fill: C.rail, r: 6 });
  const segOn = box(seg, "seg-on", 3, 3, 46, 20, { fill: C.tabOn, r: 4 });
  text(segOn, "seg-on-t", 0, 0, 46, 20, "预览", { size: 10.5, font: F.m, align: "CENTER", lh: 20 });
  text(seg, "seg-off-t", 47, 3, 46, 20, "源码", { size: 10.5, color: C.t3, align: "CENTER", lh: 20 });
  created.push(hline(rd, P + "reader/line", 14, 40, 388).id);
  created.push(text(rd, P + "md/h1", 16, 52, 380, 26, "figma-workbench", { size: 17, font: F.sb, lh: 26 }).id);
  created.push(text(rd, P + "md/p1", 16, 86, 380, 44,
    "读取、编辑并实现 Figma Design / FigJam / Slides：配合真实画布截图、可复用组件与变量。",
    { size: 13.5, color: "#D7DBE2", lh: 22 }).id);
  created.push(text(rd, P + "md/h2", 16, 140, 380, 22, "何时使用", { size: 15, font: F.sb, lh: 22 }).id);
  created.push(text(rd, P + "md/list", 16, 170, 380, 44,
    "• 需要读/改 Figma 画布或导出预览时\n• 需要 Code Connect / 变量 / 组件上下文时",
    { size: 13.5, color: "#D7DBE2", lh: 22 }).id);
  const code = box(rd, P + "md/code", 16, 226, 380, 88, { fill: "#151920", r: 8 });
  created.push(text(code, P + "md/code-text", 12, 8, 356, 72,
    'figma_status()\nfigma_read_guide({ topic: "workflow" })',
    { size: 11.5, font: F.code, color: "#B9C0CB", lh: 18 }).id);
  created.push(text(rd, P + "md/p2", 16, 328, 380, 44,
    "本地模式由伴随插件提供画布读写；插件窗口需保持打开，断连后重新绑定文档。",
    { size: 13.5, color: "#D7DBE2", lh: 22 }).id);
  created.push(box(rd, P + "reader/scrollbar", 394, 52, 3, 120, { fill: "#FFFFFF", fillOp: 0.12, r: 2 }).id);
}

// ===========================================================================
// 2) v8 · 01 技能 · 项目（只同步侧栏全局计数）
// ===========================================================================
const p = v8Frame("01");
cleanup(p);
restoreHidden(p);
const pScopeGlobal = p.findOne((n) => n.name === "scope/global");
const pCount = pScopeGlobal && pScopeGlobal.children.find((n) => n.name === "count");
setChars(pCount, "157");

// ===========================================================================
// 3) v11 · 04 能力决策 · 结果（决策行来源标签）
// ===========================================================================
const v11Page = await figma.getNodeByIdAsync("56:7043");
if (!v11Page) throw new Error("v11 页面 56:7043 不存在");
await figma.setCurrentPageAsync(v11Page);
const v11FrameNode = await figma.getNodeByIdAsync("56:7679");
if (!v11FrameNode) throw new Error("v11 04 结果帧 56:7679 不存在");
cleanup(v11FrameNode);
restoreHidden(v11FrameNode);
const panel = v11FrameNode.findOne((n) => n.name === "capability-panel");
if (!panel) throw new Error("capability-panel 不存在");

const ROWS = [
  { type: "技能", name: "agent-orchestration-advisor", desc: "设计多 agent 工作流与交接边界", score: 0.93, tag: { kind: "disk", label: "全局" } },
  { type: "技能", name: "figma-workbench", desc: "Figma 设计稿读写（本地桥）", score: 0.91, tag: { kind: "channel", label: "dsh-to-figma" } },
  { type: "MCP", name: "AnySearch", desc: "联网搜索与页面正文提取", score: 0.85, tag: { kind: "disk", label: "全局" } },
  { type: "技能", name: "office", desc: "Word / PPT / Excel 文档工作流", score: 0.78, tag: { kind: "bundled", label: "内置" } },
  { type: "技能", name: "dsh-remote-deploy", desc: "远端 DSH 部署与排障", score: 0.66, tag: { kind: "channel", label: "dsh-remote" } },
  { type: "技能", name: "agent-experience", desc: "工具描述与上下文加载（低于阈值）", score: 0.42, tag: { kind: "preset", label: "预设 cordis" } },
];
function scoreColor(s, dim) {
  if (dim) return C.t3;
  if (s >= 0.8) return C.green;
  if (s >= 0.7) return C.blueLt;
  return C.blue;
}
const changed = [];
ROWS.forEach((r, i) => {
  const nm = "v11/row/" + i;
  const dim = i === ROWS.length - 1;
  const nameText = panel.findOne((n) => n.name === nm + "/name");
  const descText = panel.findOne((n) => n.name === nm + "/desc");
  if (!nameText || !descText) throw new Error("结果行结构不符（缺 " + nm + "/name|desc）：请先跑 00-inspect.js 复核");
  const typeBox = panel.findOne((n) => n.name === nm + "/type");
  const typeT = panel.findOne((n) => n.name === nm + "/type-t");
  const scoreText = panel.findOne((n) => n.name === nm + "/score");
  const barFill = panel.findOne((n) => n.name === nm + "/bar-fill");
  const isMcp = r.type === "MCP";
  setChars(nameText, r.name);
  setChars(descText, r.desc);
  setChars(typeT, r.type);
  if (typeBox) typeBox.fills = [paint(dim ? "#FFFFFF" : isMcp ? C.green : C.blue, 0.12)];
  recolorText(typeT, dim ? C.t3 : isMcp ? C.green : C.blueLt);
  setChars(scoreText, r.score.toFixed(2));
  recolorText(scoreText, scoreColor(r.score, dim));
  if (barFill) {
    barFill.x = 680;
    barFill.resize(Math.round(160 * r.score), 6);
    barFill.fills = [paint(dim ? "#4A505C" : scoreColor(r.score, false), dim ? 1 : 0.85)];
  }
  // 来源标签 + 说明列右移
  const st = tagSpec(r.tag.kind);
  const tw = (st.font === F.code ? monoW(r.tag.label, st.size) : txtw(r.tag.label, st.size)) + 10;
  const stamp = box(panel, P + "src/" + i, 306, Math.round(typeBox.y), tw, 16, {
    fill: st.bg, fillOp: st.bgOp, r: 4,
  });
  text(stamp, P + "src/" + i + "/t", 0, 0, tw, 16, r.tag.label, {
    size: st.size, font: st.font, color: st.color, align: "CENTER", lh: 16,
  });
  changed.push(stamp.id);
  const dx = 306 + tw + 8;
  descText.x = dx;
  descText.y = nameText.y;
  descText.resize(680 - dx - 10, nameText.height);
});
// 头部计数与底部说明（与 v12-03 一致）
for (const t of panel.findAll((n) => n.type === "TEXT" && String(n.characters || "").startsWith("已选"))) {
  setChars(t, "已选 5 / 52");
}
for (const t of v11FrameNode.findAll((n) => n.type === "TEXT" && String(n.characters || "").startsWith("※ 结果按分数降序"))) {
  setChars(t, "※ 结果按分数降序 · 来源标签显示 全局 / 内置 / 注入插件 / 预设渠道 · 阈值只改预勾选 · 应用只写当前会话");
  try { t.resize(1000, t.height); } catch (e) {}
}

return {
  v8Global: { frame: g.id, nodes: created.length, ids: created },
  v8Project: { frame: p.id, scopeCount: pCount ? pCount.id : null },
  v11Results: { frame: v11FrameNode.id, panel: panel.id, rows: ROWS.length, tags: changed },
};
