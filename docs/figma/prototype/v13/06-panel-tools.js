// 06-panel-tools.js — v13 帧 06：能力面板 · Tools（全局默认，插件级）
// 两层语义：能力面板 = 全局默认（「默认」开关，作用于所有会话）；单会话可在对话首屏覆盖。
// 两栏：中间=插件行（插件名 / `插件` 标签 / 工具数 / 「默认」开关），右侧=插件详情（可滚动 · 工具清单手风琴：
//   名称 + N 个参数 → 展开为 说明 + 参数表（参数/类型/必填/说明）+ 可折叠原始 JSON；schema 由 tools.inspect 懒加载）。
// 无左导航（无 workspace / 项目维度）；header 显示「全局默认 · 所有会话 · 不区分项目 / 工作区」。
// 前置：00-init.js；幂等（先删 base-* 与 v13/，再从 42:3433 克隆后重绘）
const PAGE_NAME = 'Capability Panel · 全局开关与派生 v13';
const FRAME_NAME = '06 · 能力面板 · Tools（全局）';
const BASE_ID = '42:3433';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

const C = { rail: '#1B1F27', rowOn: '#222A35', rowOff: '#1B1F27', box: '#1F232B', tabOn: '#2E3540', blue: '#61AFEF', blueLt: '#8FBCFF', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794', purple: '#B79CFF', green: '#98C379' };
const rgb = (h) => { h = h.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; };
const paint = (h, o) => ({ type: 'SOLID', color: rgb(h), opacity: o == null ? 1 : o });
function box(p, name, x, y, w, h, o) {
  o = o || {}; const n = figma.createFrame(); p.appendChild(n); n.name = name;
  n.x = x; n.y = y; n.resize(w, h); n.clipsContent = o.clip !== false;
  n.fills = o.fill ? [paint(o.fill, o.fillOp)] : []; n.cornerRadius = o.r || 0;
  n.strokes = o.stroke ? [paint(o.stroke, o.strokeOp)] : []; n.strokeWeight = 1; n.strokeAlign = 'INSIDE'; n.effects = [];
  return n;
}
function text(p, name, x, y, w, h, chars, o) {
  o = o || {}; const n = figma.createText(); p.appendChild(n); n.name = name;
  n.fontName = o.font || F.r; n.fontSize = o.size || 13.5;
  n.lineHeight = { value: o.lh || Math.round((o.size || 13.5) * 1.55), unit: 'PIXELS' };
  n.fills = [paint(o.color || C.t1)]; n.textAutoResize = 'NONE'; n.characters = chars;
  n.resize(w, h); n.x = x; n.y = y;
  n.textAlignHorizontal = o.align || 'LEFT'; n.textAlignVertical = o.valign || 'CENTER';
  if (o.trunc) { try { n.textTruncation = 'ENDING'; } catch (e) {} }
  return n;
}
function txtw(s, fs) { let w = 0; for (const ch of s) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? fs : fs * 0.55; return Math.ceil(w); }
function tag(p, name, label, kind, x, y) {
  let fill, color, font = F.m, size = 10.5;
  if (kind === 'plugin') { fill = [C.purple, 0.18]; color = C.purple; }
  else if (kind === 'channel') { fill = ['#FFFFFF', 0.06]; color = C.t3; font = F.code; size = 10; }
  else { fill = ['#FFFFFF', 0.06]; color = C.t3; }
  const w = (font === F.code ? Math.ceil(label.length * size * 0.62) : txtw(label, size)) + 10;
  const n = box(p, name, x, y, w, 16, { fill: fill[0], fillOp: fill[1], r: 4 });
  text(n, name + '/t', 0, 0, w, 16, label, { size, font, color, align: 'CENTER', lh: 16 });
  return { n, w };
}
function sw(p, name, x, y, on) {
  const t = box(p, name, x, y, 30, 18, { r: 999, fill: on ? C.blue : '#FFFFFF', fillOp: on ? 1 : 0.13 });
  box(t, name + '/knob', on ? 14 : 2, 2, 14, 14, { fill: on ? '#FFFFFF' : '#C9CED8', r: 7, clip: false });
  return t;
}

const page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME);
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);
const fr = page.children.find((n) => n.type === 'FRAME' && n.name === FRAME_NAME);
if (!fr) throw new Error('画框不存在：' + FRAME_NAME);
for (const n of [...fr.findAll((n) => String(n.name || '').indexOf('v13/') === 0)]) { if (!n.removed) n.remove(); }
for (const c of [...fr.children]) c.remove();
const src = await figma.getNodeByIdAsync(BASE_ID);
const base = src.clone(); base.name = 'base-42-3433';
fr.appendChild(base); base.x = 0; base.y = 0;

// 只保留外壳（sidebar + header）
const keep = new Set(['sidebar', 'header/title', 'header/workspace', 'header/workspace-dd', 'header/line1', 'header/line2']);
for (const c of [...base.children]) { if (!keep.has(c.name)) c.visible = false; }
const ws = base.findOne((n) => n.name === 'header/workspace');
const wsT = ws && ws.findOne((n) => n.type === 'TEXT');
if (wsT) { wsT.characters = '全局默认 · 所有会话 · 不区分项目 / 工作区'; wsT.resize(620, 22); }
const dd = base.findOne((n) => n.name === 'header/workspace-dd');
const ddT = dd && dd.findOne((n) => n.type === 'TEXT');
if (ddT) ddT.characters = '全局默认 ▾';

// 四 Tab：Skills / MCP / Tools / Jev 模型（Tools 激活）
const tabs = box(fr, 'v13/tabs', 276, 60, 560, 36, { fill: C.rail, r: 8 });
const tabDefs = [
  { label: 'Skills', count: '15', active: false },
  { label: 'MCP', count: '9', active: false },
  { label: 'Tools', count: '6', active: true },
  { label: 'Jev 模型', count: '', active: false },
];
tabDefs.forEach((t, i) => {
  const x = 3 + i * 138;
  const f = box(tabs, 'v13/tabs/' + i, x, 3, 138, 30, { fill: t.active ? C.tabOn : null, r: t.active ? 6 : 0 });
  text(f, 'v13/tabs/' + i + '/t', 0, 0, 138, 30, t.label, { size: 13, font: t.active ? F.sb : F.r, color: t.active ? C.t1 : C.t3, align: 'CENTER', lh: 30 });
  if (t.count) text(f, 'v13/tabs/' + i + '/c', 104, 0, 30, 30, t.count, { size: 10.5, color: t.active ? C.blueLt : '#6F7787', align: 'RIGHT', lh: 30 });
});
const search = box(fr, 'v13/search', 1096, 60, 320, 36, { fill: C.rail, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
text(search, 'v13/search/ph', 14, 0, 280, 36, '搜索插件或工具…', { size: 12.5, color: '#6F7787', lh: 36 });

// ---------- 中间列表：插件行（全局默认 · 「默认」开关） ----------
text(fr, 'v13/list/title', 280, 112, 150, 32, 'Tools', { size: 15, font: F.sb, color: C.t1, lh: 32 });
const cnt = box(fr, 'v13/list/count', 330, 119, 30, 18, { fill: '#FFFFFF', fillOp: 0.06, r: 999 });
text(cnt, 'v13/list/count/t', 0, 0, 30, 18, '6', { size: 10, font: F.m, color: C.t2, align: 'CENTER', lh: 18 });
text(fr, 'v13/list/note', 368, 112, 340, 32, '· 全局默认 3 启用 · 单会话可在对话首屏覆盖', { size: 10, color: C.t3, lh: 32 });

const PLUGINS = [
  { name: 'dsh-univer-office', tools: 13, on: true, sel: true },
  { name: 'dsh-remote', tools: 19, on: true },
  { name: 'dsh-im', tools: 8, on: true },
  { name: 'dsh-better-sidebar', tools: 1, on: false },
  { name: 'dsh-popout-window', tools: 1, on: false },
  { name: 'dsh-diff-approval', tools: 1, on: false },
];
PLUGINS.forEach((p, i) => {
  const y = 156 + i * 80;
  const row = box(fr, 'v13/row/' + i, 280, y, 420, 76, { fill: p.on ? C.rowOn : C.rowOff, r: 9, stroke: '#FFFFFF', strokeOp: p.on ? 0.05 : 0.02 });
  if (p.sel) box(row, 'v13/row/' + i + '/sel', 8, 8, 2, 60, { fill: C.blue, r: 999 });
  box(row, 'v13/row/' + i + '/dot', 12, 13, 8, 8, { fill: p.on ? C.blue : C.t3, r: 999 });
  text(row, 'v13/row/' + i + '/name', 24, 7, 200, 20, p.name, { size: 12.5, font: F.code, color: p.on ? C.t1 : C.t2, lh: 20, trunc: true });
  tag(row, 'v13/row/' + i + '/tag', '插件', 'plugin', 24, 30);
  text(row, 'v13/row/' + i + '/tools', 72, 30, 120, 16, p.tools + ' 个工具', { size: 10, color: C.t3, lh: 16 });
  text(row, 'v13/row/' + i + '/default', 326, 29, 44, 18, '默认', { size: 10, color: C.t3, align: 'RIGHT', lh: 18 });
  sw(row, 'v13/row/' + i + '/switch', 378, 29, p.on);
});

// ---------- 右侧详情（整块可滚动 + 工具清单手风琴） ----------
// 滚动条（整块详情一根）
box(fr, 'v13/detail/scroll-track', 1404, 112, 4, 752, { fill: '#FFFFFF', fillOp: 0.05, r: 2, clip: false });
box(fr, 'v13/detail/scroll-thumb', 1404, 112, 4, 300, { fill: '#FFFFFF', fillOp: 0.16, r: 2, clip: false });

text(fr, 'v13/detail/name', 744, 132, 300, 26, 'dsh-univer-office', { size: 20, font: F.code, color: C.t1, lh: 26 });
const dt1 = tag(fr, 'v13/detail/tag-plugin', '插件', 'plugin', 1050, 135);
tag(fr, 'v13/detail/tag-name', 'dsh-univer-office', 'channel', 1050 + dt1.w + 4, 135);
sw(fr, 'v13/detail/switch', 744, 176, true);
text(fr, 'v13/detail/state-label', 782, 170, 120, 30, '默认开启', { size: 11.5, font: F.m, color: C.green, lh: 30 });
text(fr, 'v13/detail/copy', 1246, 170, 170, 30, '复制插件名', { size: 10.5, color: C.blueLt, align: 'RIGHT', lh: 30 });

const meta = box(fr, 'v13/detail/meta', 744, 216, 650, 32, { fill: C.rail, r: 8 });
text(meta, 'v13/detail/meta/t', 12, 0, 626, 32, '来源判定：前缀 univer_ → dsh-univer-office（插件清单映射）· 注入方式：插件运行时注册的非 MCP 工具', { size: 10.5, color: C.t3, lh: 32 });
text(fr, 'v13/detail/count', 744, 256, 650, 32, '工具数 13 · 开关为「默认」：关闭后所有会话默认不可用；单个会话仍可在对话首屏单独开启', { size: 10.5, color: C.t2, lh: 16 });
text(fr, 'v13/detail/tools-title', 744, 292, 300, 20, '工具清单（13）· 展开查看参数', { size: 12, font: F.sb, color: C.t1, lh: 20 });

// 展开的第一项
const acc = box(fr, 'v13/acc/0', 744, 318, 650, 160, { fill: C.box, r: 8, stroke: '#FFFFFF', strokeOp: 0.05 });
text(acc, 'v13/acc/0/name', 12, 8, 240, 20, 'univer_new', { size: 11.5, font: F.code, color: C.t1, lh: 20 });
text(acc, 'v13/acc/0/params', 260, 8, 120, 20, '2 个参数', { size: 10, color: C.t3, lh: 20 });
text(acc, 'v13/acc/0/chevron', 608, 8, 30, 20, '▲', { size: 9.5, color: C.t3, align: 'RIGHT', lh: 20 });
text(acc, 'v13/acc/0/desc', 12, 32, 626, 18, '新建表格 / 文档 / 幻灯片 / 看板；支持指定类型与标题。', { size: 10, color: C.t2, lh: 18 });
text(acc, 'v13/acc/0/th1', 12, 55, 120, 16, '参数', { size: 9.5, color: C.t3, lh: 16 });
text(acc, 'v13/acc/0/th2', 150, 55, 80, 16, '类型', { size: 9.5, color: C.t3, lh: 16 });
text(acc, 'v13/acc/0/th3', 240, 55, 50, 16, '必填', { size: 9.5, color: C.t3, lh: 16 });
text(acc, 'v13/acc/0/th4', 310, 55, 320, 16, '说明', { size: 9.5, color: C.t3, lh: 16 });
box(acc, 'v13/acc/0/line1', 12, 72, 626, 1, { fill: '#FFFFFF', fillOp: 0.07, clip: false });
text(acc, 'v13/acc/0/r1a', 12, 75, 120, 16, 'type', { size: 10, font: F.code, color: C.t1, lh: 16 });
text(acc, 'v13/acc/0/r1b', 150, 75, 80, 16, 'string', { size: 10, font: F.code, color: C.t2, lh: 16 });
text(acc, 'v13/acc/0/r1c', 240, 75, 50, 16, '否', { size: 10, color: C.t3, lh: 16 });
text(acc, 'v13/acc/0/r1d', 310, 75, 320, 16, 'sheet | doc | slide | board', { size: 10, color: C.t2, lh: 16 });
text(acc, 'v13/acc/0/r2a', 12, 95, 120, 16, 'title', { size: 10, font: F.code, color: C.t1, lh: 16 });
text(acc, 'v13/acc/0/r2b', 150, 95, 80, 16, 'string', { size: 10, font: F.code, color: C.t2, lh: 16 });
text(acc, 'v13/acc/0/r2c', 240, 95, 50, 16, '否', { size: 10, color: C.t3, lh: 16 });
text(acc, 'v13/acc/0/r2d', 310, 95, 320, 16, '新文档标题', { size: 10, color: C.t2, lh: 16 });
box(acc, 'v13/acc/0/line2', 12, 114, 626, 1, { fill: '#FFFFFF', fillOp: 0.05, clip: false });
text(acc, 'v13/acc/0/json-toggle', 12, 119, 160, 16, '原始 JSON ▾', { size: 9.5, color: C.blueLt, lh: 16 });
text(acc, 'v13/acc/0/json-preview', 150, 119, 480, 16, '{ "type": "string", "enum": ["sheet", "doc", "slide", "board"] }', { size: 9, font: F.code, color: C.t3, lh: 16 });
text(acc, 'v13/acc/0/hint', 12, 140, 500, 14, 'schema 由 tools.inspect 懒加载；tools.list 只返回名称 / 参数个数', { size: 9, color: C.t3, lh: 14 });

// 其余折叠项
const more = [
  ['univer_import', '3 个参数'],
  ['univer_execute', '4 个参数'],
  ['univer_export', '2 个参数'],
  ['univer_screenshot', '1 个参数'],
];
more.forEach((t, i) => {
  const y = 486 + i * 34;
  const r = box(fr, 'v13/acc/' + (i + 1), 744, y, 650, 32, { fill: i % 2 === 0 ? '#1F232B' : null, r: 6 });
  text(r, 'v13/acc/' + (i + 1) + '/name', 12, 0, 240, 32, t[0], { size: 11, font: F.code, color: C.t1, lh: 32, trunc: true });
  text(r, 'v13/acc/' + (i + 1) + '/params', 260, 0, 120, 32, t[1], { size: 10, color: C.t3, lh: 32 });
  text(r, 'v13/acc/' + (i + 1) + '/chevron', 608, 0, 30, 32, '▸', { size: 9.5, color: C.t3, align: 'RIGHT', lh: 32 });
});
// 底部渐隐 + 滚动提示（详情整体一根滚动条）
box(fr, 'v13/fade/0', 744, 600, 650, 44, { fill: '#1E222B', fillOp: 0.55 });
box(fr, 'v13/fade/1', 744, 616, 650, 30, { fill: '#1E222B', fillOp: 0.75 });
box(fr, 'v13/fade/2', 744, 632, 650, 18, { fill: '#1E222B', fillOp: 0.92 });
text(fr, 'v13/detail/scroll-hint', 744, 646, 620, 14, '▾ 滚动查看其余 8 个工具（共 13 个）', { size: 9.5, color: C.t3, lh: 14 });
text(fr, 'v13/detail/ro', 744, 676, 650, 32, '只读 / 不可关闭：插件级开关，不提供单工具开关；无法 restrict 的插件开关置灰并说明原因；宿主内建基础工具不进入本域。', { size: 10, color: C.t2, lh: 16 });

// 帧注
text(fr, 'v13/note', 280, 862, 1130, 16, '※ Tools（全局默认）：开关为「默认」（所有会话）；单会话可在对话首屏覆盖 · 详情整块可滚动 · 工具清单 = 手风琴（参数表 + 原始 JSON，schema 懒加载）', { size: 10, color: C.t3, lh: 15 });

const out = { frame: fr.id, tabs: tabs.id, plugins: PLUGINS.length };
console.log(JSON.stringify(out));
return out;