// 06-panel-tools.js — v13 帧 06：能力面板 · Tools（全局，插件级）
// 两栏布局：中间=插件行（插件名 / `插件` 标签 / 工具数 / 整插件开关），右侧=插件详情（工具清单只读）。
// 不显示左导航（Tools 全局注册，无 scope/工作区维度）；header 显示「全局工具注册 · 不区分项目 / 工作区」。
// 四 Tab：Skills / MCP / Tools / Jev 模型（Jev 不高亮）。
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

const C = { rail: '#1B1F27', rowOn: '#222A35', rowOff: '#1B1F27', tabOn: '#2E3540', blue: '#61AFEF', blueLt: '#8FBCFF', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794', purple: '#B79CFF', green: '#98C379', warn: '#D19A66' };
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
function tag(p, name, label, kind, x, y, maxW) {
  let fill, color, font = F.m, size = 10.5;
  if (kind === 'plugin') { fill = [C.purple, 0.18]; color = C.purple; }
  else if (kind === 'channel') { fill = ['#FFFFFF', 0.06]; color = C.t3; font = F.code; size = 10; }
  else if (kind === 'green') { fill = [C.green, 0.12]; color = C.green; }
  else if (kind === 'warn') { fill = [C.warn, 0.14]; color = C.warn; }
  else { fill = ['#FFFFFF', 0.06]; color = C.t3; }
  let w = (font === F.code ? Math.ceil(label.length * size * 0.62) : txtw(label, size)) + 10;
  const capped = maxW != null && w > maxW;
  if (capped) w = maxW;
  const n = box(p, name, x, y, w, 16, { fill: fill[0], fillOp: fill[1], r: 4 });
  const t = text(n, name + '/t', 0, 0, w, 16, label, { size, font, color, align: 'CENTER', lh: 16 });
  if (capped) { try { t.textTruncation = 'ENDING'; } catch (e) {} }
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

// 只保留外壳（sidebar + header），其余旧列表/详情/左导航全部隐藏
const keep = new Set(['sidebar', 'header/title', 'header/workspace', 'header/workspace-dd', 'header/line1', 'header/line2']);
for (const c of [...base.children]) { if (!keep.has(c.name)) c.visible = false; }
const ws = base.findOne((n) => n.name === 'header/workspace');
const wsT = ws && ws.findOne((n) => n.type === 'TEXT');
if (wsT) { wsT.characters = '全局工具注册 · 不区分项目 / 工作区'; wsT.resize(560, 22); }
const dd = base.findOne((n) => n.name === 'header/workspace-dd');
const ddT = dd && dd.findOne((n) => n.type === 'TEXT');
if (ddT) ddT.characters = '全局工具 ▾';

// 四 Tab：Skills / MCP / Tools / Jev 模型（Tools 激活，Jev 不高亮）
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

// ---------- 中间列表：插件行 ----------
text(fr, 'v13/list/title', 280, 112, 150, 32, 'Tools', { size: 15, font: F.sb, color: C.t1, lh: 32 });
const cnt = box(fr, 'v13/list/count', 330, 119, 30, 18, { fill: '#FFFFFF', fillOp: 0.06, r: 999 });
text(cnt, 'v13/list/count/t', 0, 0, 30, 18, '6', { size: 10, font: F.m, color: C.t2, align: 'CENTER', lh: 18 });
text(fr, 'v13/list/note', 368, 112, 320, 32, '· 3 启用 · 插件级开关（整插件生效）', { size: 10, color: C.t3, lh: 32 });

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
  const isPlugin = p.name !== '来源未识别';
  text(row, 'v13/row/' + i + '/name', 24, 7, 240, 20, p.name, { size: isPlugin ? 12.5 : 12, font: isPlugin ? F.code : F.r, color: p.on ? C.t1 : C.t2, lh: 20, trunc: true });
  if (isPlugin) tag(row, 'v13/row/' + i + '/tag', '插件', 'plugin', 24, 30, 40);
  else tag(row, 'v13/row/' + i + '/tag', '未识别', 'warn', 24, 30, 60);
  text(row, 'v13/row/' + i + '/tools', 24 + (isPlugin ? 40 : 56) + 8, 30, 120, 16, p.tools + ' 个工具', { size: 10, color: C.t3, lh: 16 });
  sw(row, 'v13/row/' + i + '/switch', 378, 29, p.on);
});

// ---------- 右侧详情（插件级 + 只读工具清单） ----------
text(fr, 'v13/detail/name', 744, 132, 300, 26, 'dsh-univer-office', { size: 20, font: F.code, color: C.t1, lh: 26 });
const dt1 = tag(fr, 'v13/detail/tag-plugin', '插件', 'plugin', 1050, 135, null);
tag(fr, 'v13/detail/tag-name', 'dsh-to-figma', 'channel', 1050 + dt1.w + 4, 135, null);

sw(fr, 'v13/detail/switch', 744, 176, true);
text(fr, 'v13/detail/state-label', 782, 170, 120, 30, '已启用', { size: 11.5, font: F.m, color: C.green, lh: 30 });
text(fr, 'v13/detail/copy', 1246, 170, 170, 30, '复制插件名', { size: 10.5, color: C.blueLt, align: 'RIGHT', lh: 30 });

const meta = box(fr, 'v13/detail/meta', 744, 216, 672, 32, { fill: C.rail, r: 8 });
text(meta, 'v13/detail/meta/t', 12, 0, 648, 32, '来源判定：前缀 univer_ → dsh-univer-office（插件清单映射表）· 注入方式：插件运行时注册的非 MCP 工具（不落盘）', { size: 10.5, color: C.t3, lh: 32 });
text(fr, 'v13/detail/count', 744, 256, 600, 18, '工具数 13 · 开关为插件级：关闭后该插件全部工具在本会话不可见', { size: 10.5, color: C.t2, lh: 18 });

text(fr, 'v13/detail/tools-title', 744, 286, 260, 20, '工具清单（13）· 只读', { size: 12, font: F.sb, color: C.t1, lh: 20 });
const TOOLS = [
  ['univer_new', '新建表格 / 文档 / 幻灯片 / 看板'],
  ['univer_import', '导入 xlsx / csv / docx / pptx'],
  ['univer_execute', '执行表格 / 文档 / 幻灯片操作'],
  ['univer_export', '导出为 Office 或 PDF'],
  ['univer_screenshot', '渲染整页预览为图片'],
];
TOOLS.forEach((t, i) => {
  const y = 312 + i * 36;
  const r = box(fr, 'v13/tools/' + i, 744, y, 672, 32, { fill: i % 2 === 0 ? '#1F232B' : null, r: 6 });
  text(r, 'v13/tools/' + i + '/name', 12, 0, 260, 32, t[0], { size: 11, font: F.code, color: C.t1, lh: 32, trunc: true });
  text(r, 'v13/tools/' + i + '/desc', 286, 0, 370, 32, t[1], { size: 10, color: C.t3, lh: 32, trunc: true });
});

const impact = box(fr, 'v13/detail/impact', 744, 506, 672, 44, { fill: C.warn, fillOp: 0.10, r: 8, stroke: C.warn, strokeOp: 0.25 });
text(impact, 'v13/detail/impact/t1', 12, 6, 648, 16, '关闭影响', { size: 10.5, font: F.m, color: C.warn, lh: 16 });
text(impact, 'v13/detail/impact/t2', 12, 24, 648, 14, '关闭该插件后，本会话模型看不到它的全部 13 个工具；能力决策（Jev）以插件整体计分，选中才会启用该插件全部工具；不改项目默认', { size: 10, color: C.t2, lh: 14 });

text(fr, 'v13/detail/ro', 744, 560, 672, 32, '只读 / 不可关闭：插件级开关，不提供单工具开关；无法 restrict 的插件开关置灰并说明原因；宿主内建基础工具不进入本域。', { size: 10.5, color: C.t2, lh: 16 });
text(fr, 'v13/detail/foot', 744, 596, 672, 18, '※ 本版不做参数表：插件直接注册的工具没有统一的 inputSchema 承诺；工具清单只读展示名称与说明', { size: 10, color: C.t3, lh: 18 });

// 帧注
text(fr, 'v13/note', 280, 862, 1130, 16, '※ Tools（全局）：两栏（插件列表 + 插件详情）· 仅含插件直接注册的非 MCP 工具 · 插件级开关 + 只读工具清单 · 计数为示例，以运行时枚举为准', { size: 10.5, color: C.t3, lh: 16 });

const out = { frame: fr.id, tabs: tabs.id, plugins: PLUGINS.length, tools: TOOLS.length };
console.log(JSON.stringify(out));
return out;