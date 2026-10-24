/**
 * patch-scenes.mjs — 在 **scene JSON 层**重放 apply-baseline.js 的补丁（Node，无依赖）。
 *
 * 背景：v8-02 / v11-04 打完补丁后节点数增长（约 +73 / +12），让 Lead 把 100–200KB 的
 * serialize 分片回传会撑爆工具输出。因此这里按**同一套增删改规则**直接改基线 scene：
 *   - v8-01：仅「全局」计数文本 146 → 157；
 *   - v8-02：移除（Figma 侧被隐藏的）磁盘第 3–5 行 / 详情写按钮 / meta/path /
 *            资源树与阅读器旧子节点；插入 `v12/` 注入分组 + 5 个注入行 + 只读详情
 *            （tag-channel / readonly 条 / meta/mode / 新资源树 / 新阅读器）；
 *   - v11-04：6 行结果改文本 / 分数 / 进度条宽；每行插入来源标签；
 *            「已选 5 / 52」与底部说明更新；说明列右移。
 *
 * 输出：
 *   docs/figma/scenes/v8-01-skills-project.scene.json
 *   docs/figma/scenes/v8-02-skills-global.scene.json
 *   docs/figma/scenes/v11-04-results.scene.json
 *   notes/figma-export/{v8-01,v8-02,v11-04}.after.sig.txt  ← 与 dump-tree.js 真值 diff 用
 *
 * 用法：node docs/figma/prototype/v12/patch-scenes.mjs [--check-only]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const SCENE = (f) => join(REPO, "docs/figma/scenes", f);
const SIGDIR = join(REPO, "notes/figma-export");
const CHECK_ONLY = process.argv.includes("--check-only");

// —— 与 apply-baseline.js 完全一致的常量 ——
const F = {
  r: { family: "PingFang SC", style: "Regular" },
  m: { family: "PingFang SC", style: "Medium" },
  sb: { family: "PingFang SC", style: "Semibold" },
  code: { family: "Menlo", style: "Regular" },
};
const C = {
  blue: "#61AFEF", blueLt: "#8FBCFF", green: "#98C379", warn: "#D19A66",
  t1: "#E3E6EA", t2: "#9DA5B4", t3: "#7F8794", rowOn: "#2A303B", rail: "#1B1F27",
  tabOn: "#2E3540", reader: "#1F232B", purple: "#B79CFF",
};
const rgb = (h) => {
  h = h.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
};
const solid = (h, opacity = 1) => ({ type: "SOLID", color: rgb(h), opacity });
const txtw = (s, fs) => {
  let w = 0;
  for (const ch of s) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? fs : fs * 0.55;
  return Math.ceil(w);
};
const monoW = (s, fs) => Math.ceil(s.length * fs * 0.62);

const frameNode = (name, x, y, w, h, o = {}) => ({
  type: "FRAME",
  props: {
    name, x, y, width: w, height: h,
    ...(o.fills ? { fills: o.fills } : {}),
    ...(o.r ? { cornerRadius: o.r } : {}),
    ...(o.clip !== false ? { clipsContent: true } : {}),
    ...(o.children ? { children: o.children } : {}),
  },
});
const textNode = (name, x, y, w, h, chars, o = {}) => ({
  type: "TEXT",
  props: {
    name, x, y, width: w, height: h,
    fills: [solid(o.color || C.t1)],
    characters: chars,
    fontName: o.font || F.r,
    fontSize: o.size || 13.5,
    textAutoResize: o.trunc ? "TRUNCATE" : "NONE",
    lineHeight: { unit: "PIXELS", value: o.lh || Math.round((o.size || 13.5) * 1.55) },
    textAlignHorizontal: o.align || "LEFT",
    textAlignVertical: "CENTER",
  },
});
const lineNode = (name, x, y, w, opacity) => ({
  type: "FRAME",
  props: { name, x, y, width: w, height: 1, fills: [solid("#FFFFFF", opacity)], clipsContent: false },
});
function clipTextNode(name, x, y, w, h, chars, o) {
  return frameNode(name, x, y, w, h, {
    children: [textNode(name + "/t", 0, 0, w, h, chars, o)],
  });
}
function tagSpec(kind) {
  if (kind === "bundled") return { bg: C.warn, bgOp: 0.14, color: C.warn, font: F.m, size: 10.5 };
  if (kind === "plugin") return { bg: C.purple, bgOp: 0.18, color: C.purple, font: F.m, size: 10.5 };
  if (kind === "preset") return { bg: "#FFFFFF", bgOp: 0.06, color: C.t2, font: F.m, size: 10.5 };
  if (kind === "disk") return { bg: C.green, bgOp: 0.12, color: C.green, font: F.m, size: 10.5 };
  return { bg: "#FFFFFF", bgOp: 0.06, color: C.t3, font: F.code, size: 10 };
}
function tagNode(name, x, y, label, kind) {
  const st = tagSpec(kind);
  const w = (st.font === F.code ? monoW(label, st.size) : txtw(label, st.size)) + 10;
  return frameNode(name, x, y, w, 16, {
    fills: [solid(st.bg, st.bgOp)], r: 4,
    children: [textNode(name + "/t", 0, 0, w, 16, label, {
      size: st.size, font: st.font, color: st.color, align: "CENTER", lh: 16,
    })],
  });
}
function switchNode(name, x, y, on) {
  return frameNode(name, x, y, 30, 18, {
    fills: [on ? solid(C.blue) : solid("#FFFFFF", 0.13)], r: 999, clip: true,
    children: [frameNode(name + "/knob", on ? 14 : 2, 2, 14, 14, {
      fills: [on ? solid("#FFFFFF") : solid("#C9CED8")], r: 7,
    })],
  });
}
function toggleNodes(x, y, label, on) {
  return [
    textNode("toggle-label", x - 40, y, 32, 18, label, { size: 10.5, color: C.t3, align: "RIGHT", lh: 18 }),
    switchNode("switch", x, y, on),
  ];
}

// —— JSON 树工具 ——
const kids = (n) => n.props.children || [];
const setKids = (n, list) => {
  if (list.length === 0) delete n.props.children;
  else n.props.children = list;
};
function findNode(root, name, type) {
  if (root.props && root.props.name === name && (!type || root.type === type)) return root;
  for (const c of kids(root)) {
    const hit = findNode(c, name, type);
    if (hit) return hit;
  }
  return null;
}
function findParent(root, name) {
  for (const c of kids(root)) {
    if (c.props && c.props.name === name) return root;
    const hit = findParent(c, name);
    if (hit) return hit;
  }
  return null;
}
function setText(root, name, chars) {
  const n = findNode(root, name, "TEXT");
  if (!n) throw new Error("scene 缺少文本节点：" + name);
  n.props.characters = chars;
}
function removeChildren(root, parentName, names) {
  const parent = findNode(root, parentName);
  if (!parent) throw new Error("scene 缺少父节点：" + parentName);
  setKids(parent, kids(parent).filter((c) => !names.includes(c.props.name)));
}
function sigOf(root) {
  const out = [];
  const round = (v) => Math.round(v * 100) / 100;
  const walk = (n) => {
    const p = n.props;
    const head = [n.type, String(p.name || ""), round(p.x), round(p.y), round(p.width), round(p.height)];
    if (n.type === "TEXT") head.push(String(p.characters || "").replace(/\n/g, "\\n"));
    out.push(head.join("|"));
    for (const c of kids(n)) walk(c);
  };
  walk(root);
  return out;
}
const countNodes = (root) => sigOf(root).length;
function writeJson(file, scene) {
  if (!CHECK_ONLY) writeFileSync(file, JSON.stringify(scene));
}
function writeSig(name, root) {
  const sig = sigOf(root);
  mkdirSync(SIGDIR, { recursive: true });
  writeFileSync(join(SIGDIR, name + ".after.sig.txt"), sig.join("\n") + "\n");
  return sig.length;
}

// ===========================================================================
// 1) v8-01：仅全局计数
// ===========================================================================
function patchV801() {
  const file = SCENE("v8-01-skills-project.scene.json");
  const scene = JSON.parse(readFileSync(file, "utf8"));
  const root = scene.nodes[0];
  const before = countNodes(root);
  const scopeGlobal = findNode(root, "scope/global", "FRAME");
  const countText = kids(scopeGlobal).find((c) => c.props.name === "count");
  if (!countText) throw new Error("v8-01 缺 scope/global/count");
  countText.props.characters = "157";
  writeJson(file, scene);
  return { file, before, after: countNodes(root), sig: writeSig("v8-01-skills-project", root) };
}

// ===========================================================================
// 2) v8-02：注入分组 + 5 个注入行 + 只读详情
// ===========================================================================
const GH_Y = 314;
function patchV802() {
  const file = SCENE("v8-02-skills-global.scene.json");
  const scene = JSON.parse(readFileSync(file, "utf8"));
  const root = scene.nodes[0];
  const before = countNodes(root);

  // 计数
  setText(root, "header/tab-skills-t", "技能 157");
  setText(root, "list/count-t", "14");
  const scopeGlobal = findNode(root, "scope/global", "FRAME");
  const scopeCount = kids(scopeGlobal).find((c) => c.props.name === "count");
  if (!scopeCount) throw new Error("v8-02 缺 scope/global/count");
  scopeCount.props.characters = "157";

  // 隐藏 = 从 scene 移除（export-scene 跳过 visible=false，等价）
  const removed = [
    "row/acquisition-channel-advisor", "row/altitude-horizon-framework", "row/ai-shaped-readiness-advisor",
    "act/import", "act/export", "act/export-path", "act/delete", "meta/path",
  ];
  removeChildren(root, root.props.name, removed);

  // 选中态移到注入行
  const row1 = findNode(root, "row/agent-orchestration-advisor", "FRAME");
  delete row1.props.fills;
  setKids(row1, kids(row1).filter((c) => c.props.name !== "sel-bar"));

  // —— 新增：分组头 + 5 个注入行（顺序与 apply-baseline.js 创建顺序一致） ——
  const added = [];
  added.push(lineNode("v12/group/line", 472, GH_Y, 284, 0.06));
  added.push(textNode("v12/group/title", 484, GH_Y + 6, 60, 22, "注入技能", { size: 12, font: F.sb, color: C.t2, lh: 22 }));
  added.push(textNode("v12/group/count", 536, GH_Y + 6, 24, 22, "5", { size: 11, font: F.m, color: C.t3, lh: 22 }));
  added.push(textNode("v12/group/note", 620, GH_Y + 6, 136, 22, "内容只读 · 可启停", { size: 11, color: C.t3, align: "RIGHT", lh: 22 }));

  const INJECTED = [
    { title: "figma-workbench", originLabel: "插件", originKind: "plugin", channel: "dsh-to-figma", desc: "Figma 设计稿读写（本地桥）", on: true, sel: true },
    { title: "dsh-remote-deploy", originLabel: "插件", originKind: "plugin", channel: "dsh-remote", desc: "远端 DSH 部署与排障", on: true },
    // Lead 画布修正：注入行名与渠道发布名一致
    { title: "dsh-diff-approval-annotate", originLabel: "插件", originKind: "plugin", channel: "dsh-diff-approval", desc: "代码批注卡片与评论应答", on: true },
    { title: "office", originLabel: "内置", originKind: "bundled", channel: "dsh-office", desc: "Word / PPT / Excel 文档工作流", on: false },
    { title: "office-docx", originLabel: "内置", originKind: "bundled", channel: "dsh-office", desc: "Word 文档创建与校验", on: true },
  ];
  const rowKids = (title, y, o) => {
    const list = [];
    if (o.sel) {
      list.push(frameNode("sel-bar", 8, 8, 2, 60, { fills: [solid(C.blue)], r: 1 }));
    }
    list.push(frameNode("dot", 12, 13, 8, 8, { fills: [solid(o.on ? C.green : C.t3)], r: 4 }));
    list.push(clipTextNode("name", 24, 7, 170, 20, title, { size: 13.5, font: F.sb, lh: 20, trunc: true }));
    const originTag = tagNode("tag-origin", 24, 28, o.originLabel, o.originKind);
    list.push(originTag);
    const channelTag = tagNode("tag-channel", 24 + originTag.props.width + 4, 28, o.channel, "channel");
    list.push(channelTag);
    list.push(clipTextNode("desc", 12, 50, 184, 20, o.desc, { size: 12.5, color: C.t2, lh: 20, trunc: true }));
    list.push(...toggleNodes(244, 29, "启用", o.on));
    return list;
  };
  INJECTED.forEach((row, i) => {
    added.push(frameNode("v12/row/" + row.title.replace(/[^a-zA-Z0-9-]/g, "-"), 472, 348 + i * 80, 284, 76, {
      r: 10,
      ...(row.sel ? { fills: [solid(C.rowOn)] } : {}),
      children: rowKids(row.title, 348 + i * 80, row),
    }));
  });

  // —— 详情切到注入技能 figma-workbench ——
  setText(root, "detail/name/t", "figma-workbench");
  // 来源标签：全局 → 插件
  const tagOrigin = findNode(root, "detail/tag-global", "FRAME");
  tagOrigin.props.fills = [solid(C.purple, 0.18)];
  tagOrigin.props.width = txtw("插件", 10.5) + 10;
  const tagOriginText = kids(tagOrigin).find((c) => c.props.name === "detail/tag-global/t");
  tagOriginText.props.characters = "插件";
  tagOriginText.props.fills = [solid(C.purple)];
  tagOriginText.props.width = tagOrigin.props.width;
  // 渠道标签
  added.push(tagNode("v12/detail/tag-channel", 1148, 136, "dsh-to-figma", "channel"));
  // 只读原因条
  const readonlyText = "内容只读 · 由插件 dsh-to-figma 运行时注册（无磁盘副本）；可在列表 / 会话中启用或禁用，不可编辑或删除。";
  added.push(frameNode("v12/detail/readonly", 788, 174, 628, 36, {
    fills: [solid(C.rowOn)], r: 8,
    children: [textNode("v12/detail/readonly/t", 12, 0, 604, 36, readonlyText, { size: 11.5, color: C.t3, lh: 36 })],
  }));
  setText(root, "meta/source/t", "来源 dsh-to-figma");
  added.push(textNode("v12/meta/mode", 956, 218, 210, 36, "插件注入 · 运行时注册（不落盘）", { size: 12, color: C.t2, lh: 36 }));

  // —— 资源树（替换旧子节点） ——
  const tree = findNode(root, "detail/tree", "FRAME");
  setKids(tree, []);
  const treeKids = [];
  treeKids.push(textNode("v12/tree/title", 12, 0, 100, 36, "技能文件", { size: 13, font: F.sb, lh: 36 }));
  treeKids.push(textNode("v12/tree/count", 152, 0, 36, 36, "4", { size: 12, color: C.t3, align: "RIGHT", lh: 36 }));
  treeKids.push(lineNode("v12/tree/line", 12, 36, 176, 0.06));
  const TH = 30, TBD = 118, TS = 156;
  const badge = (name, x, y, label) => frameNode(name, x, y, 22, 14, {
    fills: [solid("#FFFFFF", 0.06)], r: 3,
    children: [textNode(name + "/t", 0, 0, 22, 14, label, { size: 8, font: F.code, color: C.t3, align: "CENTER", lh: 14 })],
  });
  const treeRow = (name, y, o) => {
    const list = [];
    const ind = o.ind || 0;
    if (o.sel) {
      list.push(frameNode(name + "/bg", 4, y, 192, TH, { fills: [solid(C.rowOn)], r: 6 }));
      list.push(frameNode(name + "/bar", 4, y + 6, 2, 18, { fills: [solid(C.blue)], r: 1 }));
    }
    if (o.icon) list.push(textNode(name + "/icon", 12 + ind, y, 12, TH, o.icon, { size: 9.5, color: C.t3, lh: TH }));
    const nx = 26 + ind;
    const right = o.badge ? TBD - 4 : o.size ? TS - 4 : 196;
    list.push(clipTextNode(name + "/label", nx, y, right - nx, TH, o.label, {
      size: o.fs || 10, font: F.code, color: o.color || C.t1, lh: TH, trunc: true,
    }));
    if (o.count) list.push(textNode(name + "/count", nx + txtw(o.label, 10) + 4, y, 18, TH, o.count, { size: 9.5, color: C.t3, lh: TH }));
    if (o.badge) list.push(badge(name + "/badge", TBD, y + (TH - 14) / 2, o.badge));
    if (o.size) list.push(textNode(name + "/size", TS, y, 40, TH, o.size, { size: 10.5, color: C.t3, align: "RIGHT", lh: TH }));
    return list;
  };
  treeKids.push(...treeRow("v12/tree/root", 44, { icon: "▾", label: "figma-workbench/", color: C.t2 }));
  treeKids.push(frameNode("v12/tree/guide", 28, 74, 1, 150, { fills: [solid("#FFFFFF", 0.08)], clip: false }));
  treeKids.push(...treeRow("v12/tree/skill-md", 74, { sel: true, ind: 10, label: "SKILL.md", badge: "MD", size: "8.2K" }));
  // Lead 画布修正：references 资源计数 2 → 3
  treeKids.push(...treeRow("v12/tree/references", 104, { ind: 10, icon: "▾", label: "references/", count: "3" }));
  treeKids.push(...treeRow("v12/tree/workflow", 134, { ind: 20, label: "workflow.md", badge: "MD", size: "3.4K" }));
  treeKids.push(...treeRow("v12/tree/plugin-api", 164, { ind: 20, label: "plugin-api.md", badge: "MD", size: "2.8K" }));
  treeKids.push(...treeRow("v12/tree/design", 194, { ind: 20, label: "design-to-code.md", badge: "MD", size: "1.9K" }));
  treeKids.push(frameNode("v12/tree/scrollbar", 188, 44, 3, 160, { fills: [solid("#FFFFFF", 0.1)], r: 2 }));
  setKids(tree, treeKids);

  // —— 阅读器（替换旧子节点） ——
  const rd = findNode(root, "detail/reader", "FRAME");
  const rdKids = [];
  rdKids.push(textNode("v12/reader/file", 14, 0, 120, 40, "SKILL.md", { size: 13, font: F.sb, lh: 40 }));
  rdKids.push(textNode("v12/reader/meta", 140, 0, 120, 40, "5.9 KB · MD", { size: 11, color: C.t3, lh: 40 }));
  const seg = frameNode("v12/reader/seg", 300, 7, 100, 26, {
    fills: [solid(C.rail)], r: 6,
    children: [
      frameNode("seg-on", 3, 3, 46, 20, {
        fills: [solid(C.tabOn)], r: 4,
        children: [textNode("seg-on-t", 0, 0, 46, 20, "预览", { size: 10.5, font: F.m, align: "CENTER", lh: 20 })],
      }),
      textNode("seg-off-t", 47, 3, 46, 20, "源码", { size: 10.5, color: C.t3, align: "CENTER", lh: 20 }),
    ],
  });
  rdKids.push(seg);
  rdKids.push(lineNode("v12/reader/line", 14, 40, 388, 0.06));
  rdKids.push(textNode("v12/md/h1", 16, 52, 380, 26, "figma-workbench", { size: 17, font: F.sb, lh: 26 }));
  rdKids.push(textNode("v12/md/p1", 16, 86, 380, 44,
    "读取、编辑并实现 Figma Design / FigJam / Slides：配合真实画布截图、可复用组件与变量。",
    { size: 13.5, color: "#D7DBE2", lh: 22 }));
  rdKids.push(textNode("v12/md/h2", 16, 140, 380, 22, "何时使用", { size: 15, font: F.sb, lh: 22 }));
  rdKids.push(textNode("v12/md/list", 16, 170, 380, 44,
    "• 需要读/改 Figma 画布或导出预览时\n• 需要 Code Connect / 变量 / 组件上下文时",
    { size: 13.5, color: "#D7DBE2", lh: 22 }));
  rdKids.push(frameNode("v12/md/code", 16, 226, 380, 88, {
    fills: [solid("#151920")], r: 8,
    children: [textNode("v12/md/code-text", 12, 8, 356, 72,
      'figma_status()\nfigma_read_guide({ topic: "workflow" })',
      { size: 11.5, font: F.code, color: "#B9C0CB", lh: 18 })],
  }));
  rdKids.push(textNode("v12/md/p2", 16, 328, 380, 44,
    "本地模式由伴随插件提供画布读写；插件窗口需保持打开，断连后重新绑定文档。",
    { size: 13.5, color: "#D7DBE2", lh: 22 }));
  rdKids.push(frameNode("v12/reader/scrollbar", 394, 52, 3, 120, { fills: [solid("#FFFFFF", 0.12)], r: 2 }));
  setKids(rd, rdKids);

  // 追加到帧末尾（与 Figma appendChild 顺序一致）
  setKids(root, [...kids(root), ...added]);
  writeJson(file, scene);
  return { file, before, after: countNodes(root), sig: writeSig("v8-02-skills-global", root) };
}

// ===========================================================================
// 3) v11-04：6 行来源标签 + 行内容对齐 v12-03
// ===========================================================================
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
function patchV1104() {
  const file = SCENE("v11-04-results.scene.json");
  const scene = JSON.parse(readFileSync(file, "utf8"));
  const root = scene.nodes[0];
  const before = countNodes(root);
  const panel = findNode(root, "capability-panel", "FRAME");
  if (!panel) throw new Error("v11-04 缺 capability-panel");

  const added = [];
  ROWS.forEach((r, i) => {
    const nm = "v11/row/" + i;
    const dim = i === ROWS.length - 1;
    const nameN = findNode(panel, nm + "/name", "TEXT");
    const descN = findNode(panel, nm + "/desc", "TEXT");
    const typeBox = findNode(panel, nm + "/type", "FRAME");
    const typeT = findNode(panel, nm + "/type-t", "TEXT");
    const scoreN = findNode(panel, nm + "/score", "TEXT");
    const barFill = findNode(panel, nm + "/bar-fill", "FRAME");
    if (!nameN || !descN || !typeBox || !typeT || !scoreN || !barFill) {
      throw new Error("v11-04 结果行结构不符（缺 " + nm + "）");
    }
    const isMcp = r.type === "MCP";
    nameN.props.characters = r.name;
    descN.props.characters = r.desc;
    typeT.props.characters = r.type;
    typeBox.props.fills = [solid(dim ? "#FFFFFF" : isMcp ? C.green : C.blue, 0.12)];
    typeT.props.fills = [solid(dim ? C.t3 : isMcp ? C.green : C.blueLt)];
    scoreN.props.characters = r.score.toFixed(2);
    scoreN.props.fills = [solid(scoreColor(r.score, dim))];
    barFill.props.x = 680;
    barFill.props.width = Math.round(160 * r.score);
    barFill.props.fills = [solid(dim ? "#4A505C" : scoreColor(r.score, false), dim ? 1 : 0.85)];

    // 来源标签 + 说明列右移
    const st = tagSpec(r.tag.kind);
    const tw = (st.font === F.code ? monoW(r.tag.label, st.size) : txtw(r.tag.label, st.size)) + 10;
    const tagY = Math.round(typeBox.props.y);
    added.push(frameNode("v12/src/" + i, 306, tagY, tw, 16, {
      fills: [solid(st.bg, st.bgOp)], r: 4,
      children: [textNode("v12/src/" + i + "/t", 0, 0, tw, 16, r.tag.label, {
        size: st.size, font: st.font, color: st.color, align: "CENTER", lh: 16,
      })],
    }));
    const dx = 306 + tw + 8;
    descN.props.x = dx;
    descN.props.y = nameN.props.y;
    descN.props.width = 680 - dx - 10;
    descN.props.height = nameN.props.height;
  });

  // 头部计数 / 底部说明
  const selected = findNode(panel, "v11/thr/selected", "TEXT");
  if (!selected) throw new Error("v11-04 缺 v11/thr/selected");
  selected.props.characters = "已选 5 / 52";
  const note = findNode(root, "v11/note", "TEXT");
  if (!note) throw new Error("v11-04 缺 v11/note");
  note.props.characters = "※ 结果按分数降序 · 来源标签显示 全局 / 内置 / 注入插件 / 预设渠道 · 阈值只改预勾选 · 应用只写当前会话";
  note.props.width = 1000;

  setKids(panel, [...kids(panel), ...added]);
  writeJson(file, scene);
  return { file, before, after: countNodes(root), sig: writeSig("v11-04-results", root) };
}

// ===========================================================================
const out = { v801: patchV801(), v802: patchV802(), v1104: patchV1104() };
console.log(JSON.stringify(out, null, 2));
