// 03-mcp-overview.js — 帧 03「MCP 总览（三组）」主区
await figma.loadAllPagesAsync();
const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);
const C = { bg: '#1E222B', panel: '#23272F', rail: '#1B1F27', tabOn: '#2E3540', rowOn: '#2A303B', blue: '#61AFEF', blueLt: '#8FBCFF', green: '#98C379', warn: '#D19A66', red: '#E06C75', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794', reader: '#1F232B' };

// ---------- helper ----------
const rgb = (h) => { h = h.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; };
const paint = (h, o) => ({ type: 'SOLID', color: rgb(h), opacity: o == null ? 1 : o });
function box(p, name, x, y, w, h, o) {
  o = o || {}; const n = figma.createFrame(); p.appendChild(n); n.name = name;
  n.x = x; n.y = y; n.resize(w, h); n.clipsContent = o.clip !== false;
  n.fills = o.fill ? [paint(o.fill, o.fillOp)] : []; n.cornerRadius = o.r || 0;
  n.strokes = o.stroke ? [paint(o.stroke, o.strokeOp)] : []; n.strokeWeight = 1; n.strokeAlign = 'INSIDE'; n.effects = [];
  return n;
}
function txtw(s, fs) { let w = 0; for (const ch of s) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? fs : fs * 0.55; return Math.ceil(w); }
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
const hline = (p, name, x, y, w, op) => box(p, name, x, y, w, 1, { fill: '#FFFFFF', fillOp: op == null ? 0.06 : op, clip: false });
const vline = (p, name, x, y, h, op) => box(p, name, x, y, 1, h, { fill: '#FFFFFF', fillOp: op == null ? 0.06 : op, clip: false });
function clipText(p, name, x, y, w, h, chars, o) { const c = box(p, name, x, y, w, h, { clip: true }); text(c, name + '/t', 0, 0, w, h, chars, o); return c; }
function tagStyle(l) {
  if (l === '项目' || l === '引用') return { bg: C.blue, bgOp: 0.1, color: C.blueLt };
  if (l === '全局' || l === '已挂载') return { bg: C.green, bgOp: 0.1, color: C.green };
  if (l === '外部' || l === '默认关闭' || l === '未挂载') return { bg: C.warn, bgOp: 0.1, color: C.warn };
  if (l === '只读') return { bg: '#FFFFFF', bgOp: 0.06, color: C.t3 };
  return { bg: '#FFFFFF', bgOp: 0.06, color: C.t2 };
}
function tag(p, name, x, y, label) {
  const st = tagStyle(label), s = 10.5, h = 16, w = txtw(label, s) + 10;
  const n = box(p, name, x, y, w, h, { fill: st.bg, fillOp: st.bgOp, r: 4, stroke: st.stroke, strokeOp: st.strokeOp });
  text(n, name + '/t', 0, 0, w, h, label, { size: s, font: F.m, color: st.color, align: 'CENTER', lh: h });
  return n;
}
function btn(p, name, x, y, label, o) {
  o = o || {}; const h = o.h || 30, s = o.size || 12, w = o.w || txtw(label, s) + 22;
  const n = box(p, name, x, y, w, h, { fill: o.fill, fillOp: o.fillOp, r: 999, stroke: o.stroke, strokeOp: o.strokeOp });
  text(n, name + '/t', 0, 0, w, h, label, { size: s, font: o.font || F.m, color: o.color || C.t2, align: 'CENTER', lh: h });
  return n;
}
// 统一开关：30×18、knob 14；开 #61AFEF、关白 13%
function sw(p, name, x, y, on, dim) {
  const t = box(p, name, x, y, 30, 18, { r: 999, fill: '#FFFFFF', fillOp: dim ? 0.08 : (on ? 1 : 0.13) });
  if (on && !dim) t.fills = [paint(C.blue)];
  box(t, name + '/knob', on ? 14 : 2, 2, 14, 14, { fill: on ? (dim ? '#C9CED8' : '#FFFFFF') : '#C9CED8', r: 7, clip: false });
  return t;
}
function toggle(p, x, y, label, on) {
  text(p, 'toggle-label', x - 40, y, 32, 18, label, { size: 10.5, color: C.t3, align: 'RIGHT', lh: 18 });
  return sw(p, 'switch', x, y, on, false);
}
function magnifier(p, x, y) {
  const e = figma.createEllipse(); p.appendChild(e); e.name = 'search-icon'; e.x = x; e.y = y; e.resize(11, 11);
  e.fills = []; e.strokes = [paint(C.t3)]; e.strokeWeight = 1.4;
  const s = figma.createRectangle(); p.appendChild(s); s.name = 'search-handle'; s.x = x + 8; s.y = y + 8;
  s.resize(5, 1.4); s.rotation = 45; s.fills = [paint(C.t3)]; s.strokes = []; s.cornerRadius = 1;
}

// ---------- 定位 + 清空 ----------
let page = figma.root.children.find((p) => p.name === 'Capability Panel · 升级原型 v6');
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);
const fr = page.children.find((n) => n.type === 'FRAME' && n.name.startsWith('03'));
if (!fr) throw new Error('画框 03 不存在：先执行 00-init.js');
for (const c of [...fr.children]) if (c.name !== 'sidebar') c.remove();

// ---------- 头部 / 工具条（MCP 选中） ----------
text(fr, 'header/title', 276, 16, 80, 24, '能力面板', { size: 17, font: F.sb, lh: 24 });
clipText(fr, 'header/workspace', 360, 19, 640, 22, '/Users/lzx/Documents/GitHub/dsh-capability-settings', { size: 12.5, color: C.t3, lh: 22, trunc: true });
const dd = box(fr, 'header/workspace-dd', 1204, 8, 216, 34, { fill: C.panel, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
text(dd, 'header/workspace-dd-text', 12, 0, 192, 34, '跟随当前会话 ▾', { size: 12.5, color: C.t2, lh: 34 });
hline(fr, 'header/line', 256, 87, 1184);
const trk = box(fr, 'header/tabs', 276, 51, 300, 36, { fill: C.rail, r: 8 });
text(trk, 'header/tab-skills-t', 3, 3, 147, 30, '技能 12', { size: 13, color: C.t3, align: 'CENTER', lh: 30 });
const selTab = box(trk, 'header/tab-mcp', 150, 3, 147, 30, { fill: C.tabOn, r: 6 });
text(selTab, 'header/tab-mcp-t', 0, 0, 147, 30, 'MCP 9', { size: 13, font: F.sb, align: 'CENTER', lh: 30 });
hline(fr, 'toolbar/line', 256, 139, 1184);
const srch = box(fr, 'toolbar/search', 276, 96, 1012, 36, { fill: C.panel, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
magnifier(srch, 14, 12);
text(srch, 'toolbar/search-ph', 32, 0, 500, 36, '搜索 MCP 服务器…', { size: 12.5, color: C.t3, lh: 36 });
const cta = box(fr, 'toolbar/cta', 1304, 96, 112, 32, { fill: C.blue, r: 999 });
text(cta, 'toolbar/cta-t', 0, 0, 112, 32, '+ 添加 MCP', { size: 12.5, font: F.sb, color: '#0F1115', align: 'CENTER', lh: 32 });

// ---------- 列表列（三组，行尾统一开关） ----------
vline(fr, 'list/divider', 575, 140, 760);
function groupHeader(name, y, label, count, note) {
  const g = box(fr, name, 264, y, 304, 36, {});
  text(g, name + '/title', 0, 0, 80, 36, label, { size: 13, font: F.sb, lh: 36 });
  const pill = box(g, name + '/count', txtw(label, 13) + 14, 9, 24, 18, { fill: '#FFFFFF', fillOp: 0.08, r: 999 });
  text(pill, name + '/count-t', 0, 0, 24, 18, count, { size: 10.5, font: F.m, color: C.t2, align: 'CENTER', lh: 18 });
  text(g, name + '/note', 100, 0, 204, 36, note, { size: 11, color: C.t3, align: 'RIGHT', lh: 36, trunc: true });
  hline(fr, name + '/line', 264, y + 35, 304);
}
function mcpRow(name, y, o) {
  const r = box(fr, name, 264, y, 304, 72, { r: 10, fill: o.sel ? C.rowOn : null });
  if (o.sel) box(r, 'sel-bar', 8, 7, 2, 58, { fill: C.blue, r: 1 });
  box(r, 'dot', 12, 13, 8, 8, { fill: o.dot || C.green, r: 4 });
  const nw = Math.min(170, txtw(o.title, 13.5) + 16);
  clipText(r, 'name', 24, 7, nw, 20, o.title, { size: 13.5, font: F.sb, lh: 20, trunc: true });
  let tx = 24 + nw + 8;
  for (const l of o.tags) { if (tx + txtw(l, 10.5) + 10 > 238) break; const t = tag(r, 'tag-' + l, tx, 10, l); tx += t.width + 4; }
  clipText(r, 'meta', 24, 29, 192, 18, o.meta, { size: 12, color: C.t2, lh: 18, trunc: true });
  clipText(r, 'summary', 24, 49, 192, 18, o.summary, { size: 11, font: F.code, color: C.t3, lh: 18, trunc: true });
  toggle(r, 264, 27, '默认', o.on);
  return r;
}
groupHeader('grp/project', 148, '本项目', '2', '随项目走 · 只在本项目生效');
mcpRow('row/anysearch', 192, { sel: true, on: true, title: 'AnySearch', tags: ['引用', 'stdio'], meta: '已挂载 · 17 个工具', summary: 'npx -y mcp-remote https://api.anysearch.com/mcp' });
mcpRow('row/playwright', 268, { on: true, dot: C.t3, title: 'playwright', tags: ['项目', 'stdio'], meta: '未挂载到当前会话 · 工具数未知', summary: 'npx @playwright/mcp@latest' });
hline(fr, 'list/divider-a', 264, 348, 304);
groupHeader('grp/global', 356, '全局', '4', '所有项目共享 · 改动影响全部项目');
mcpRow('row/context7', 400, { on: true, title: 'context7', tags: ['全局', 'stdio'], meta: '已挂载 · 工具数未知', summary: 'bunx -y @upstash/context7-mcp' });
mcpRow('row/deepwiki', 476, { on: true, title: 'deepwiki', tags: ['全局', 'http'], meta: '已挂载 · 工具数未知', summary: 'https://mcp.deepwiki.com/mcp' });
mcpRow('row/open-computer-use', 552, { on: true, title: 'open-computer-use', tags: ['全局', 'stdio'], meta: '已挂载 · 工具数未知', summary: '本机伴生进程 · open-computer-use' });
mcpRow('row/tavily', 628, { on: true, title: 'tavily', tags: ['全局', 'stdio'], meta: '已挂载 · 默认开启', summary: 'npx -y tavily-mcp' });
hline(fr, 'list/divider-b', 264, 708, 304);
groupHeader('grp/external', 716, '外部注入', '1', '运行时注入 · 只读');
mcpRow('row/figma', 760, { on: false, dot: C.warn, title: 'figma', tags: ['外部', '默认关闭'], meta: '17 个工具 · 调用 4 次', summary: '运行时注入，不由能力面板管理' });
box(fr, 'list/scrollbar', 569, 400, 3, 250, { fill: '#FFFFFF', fillOp: 0.1, r: 2 });

// ---------- 详情：AnySearch（全局，可管理） ----------
text(fr, 'detail/name', 600, 168, 180, 26, 'AnySearch', { size: 18, font: F.sb, lh: 26 });
tag(fr, 'detail/tag-global', 704, 172, '全局');
tag(fr, 'detail/tag-ref', 740, 172, '引用');
text(fr, 'detail/copy-ns', 1300, 168, 116, 26, '复制命名空间', { size: 12, color: C.t3, align: 'RIGHT', lh: 26 });
btn(fr, 'act/import', 600, 217, '导入到本项目', { w: 94, stroke: '#FFFFFF', strokeOp: 0.14, color: C.t2 });
btn(fr, 'act/edit', 702, 217, '编辑', { w: 46, stroke: '#FFFFFF', strokeOp: 0.14, color: C.t2 });
btn(fr, 'act/tools', 756, 217, '查看工具与参数', { w: 110, stroke: C.blue, strokeOp: 0.4, color: C.blueLt });
btn(fr, 'act/usage', 874, 217, '使用记录', { w: 68, stroke: '#FFFFFF', strokeOp: 0.14, color: C.t2 });
btn(fr, 'act/delete', 950, 217, '删除', { w: 44, color: C.red });

const lbl = (n, y, s) => text(fr, 'field/' + n + '/label', 600, y, 90, 28, s, { size: 12, color: C.t3, lh: 28 });
lbl('ns', 264, '命名空间');
text(fr, 'field/ns/value', 700, 264, 716, 28, 'mcp__AnySearch__*', { size: 11.5, font: F.code, lh: 28 });
hline(fr, 'field/line-a', 600, 296, 816);
lbl('cmd', 304, '命令');
text(fr, 'field/cmd/value', 700, 304, 716, 28, 'npx', { size: 11.5, font: F.code, lh: 28 });
lbl('args', 336, '参数');
text(fr, 'field/args/value', 700, 336, 716, 44, '-y mcp-remote https://api.anysearch.com/mcp\n--header "Authorization: Bearer as_sk_••••"', { size: 11.5, font: F.code, color: C.t2, lh: 18 });
hline(fr, 'field/line-b', 600, 388, 816);
lbl('cfg', 396, '配置文件');
text(fr, 'field/cfg/value', 700, 396, 716, 28, '/Users/lzx/.agents/mcp.json', { size: 11.5, font: F.code, color: C.t2, lh: 28 });
lbl('status', 428, '状态');
box(fr, 'field/status/dot', 700, 439, 8, 8, { fill: C.green, r: 4 });
text(fr, 'field/status/value', 716, 428, 700, 28, '已挂载到当前会话 · 默认开启', { size: 13, color: C.t2, lh: 28 });

// ---------- 折叠区：工具与参数（左列表 + 右参数表） ----------
const tp = box(fr, 'collapse/tools', 600, 464, 816, 248, { fill: C.reader, r: 10, stroke: '#FFFFFF', strokeOp: 0.06 });
text(tp, 'collapse/tools/title', 14, 0, 100, 40, '工具与参数', { size: 13, font: F.sb, lh: 40 });
text(tp, 'collapse/tools/meta', 104, 0, 280, 40, '17 个工具 · 点击工具查看参数', { size: 11, color: C.t3, lh: 40 });
text(tp, 'collapse/tools/chev', 780, 0, 22, 40, '▾', { size: 14, color: C.t2, align: 'RIGHT', lh: 40 });
hline(tp, 'collapse/tools/line', 14, 40, 788);
vline(tp, 'collapse/tools/div', 312, 44, 196, 0.06);
const tools = [
  ['search', 'mcp__AnySearch__search', '搜索（query / limit）', true],
  ['batch', 'mcp__AnySearch__batch_search', '并行搜索（queries 数组）', false],
  ['extract', 'mcp__AnySearch__extract', '抓取网页正文（url）', false],
  ['subdomains', 'mcp__AnySearch__get_sub_domains', '发现垂直子域与参数', false],
  ['score', 'mcp__AnySearch__score', '提交搜索反馈评分', false],
];
tools.forEach(([id, t, d, on], i) => {
  const y = 48 + i * 34;
  if (on) { box(tp, 'tools/' + id + '/bg', 8, y, 292, 34, { fill: C.rowOn, r: 6 }); box(tp, 'tools/' + id + '/bar', 8, y + 8, 2, 18, { fill: C.blue, r: 1 }); }
  clipText(tp, 'tools/' + id + '/name', 20, y + 2, 280, 16, t, { size: 11.5, font: F.code, color: on ? C.t1 : C.t2, lh: 16, trunc: true });
  clipText(tp, 'tools/' + id + '/desc', 20, y + 16, 280, 14, d, { size: 10.5, color: C.t3, lh: 14, trunc: true });
});
text(tp, 'params/title', 340, 48, 300, 20, 'mcp__AnySearch__search', { size: 11.5, font: F.code, color: C.blueLt, lh: 20 });
text(tp, 'params/count', 514, 48, 80, 20, '3 个参数', { size: 11, color: C.t3, lh: 20 });
text(tp, 'params/h-name', 340, 76, 104, 18, '参数', { size: 10.5, color: C.t3, lh: 18 });
text(tp, 'params/h-type', 452, 76, 64, 18, '类型', { size: 10.5, color: C.t3, lh: 18 });
text(tp, 'params/h-req', 524, 76, 42, 18, '必填', { size: 10.5, color: C.t3, lh: 18 });
text(tp, 'params/h-desc', 572, 76, 220, 18, '说明', { size: 10.5, color: C.t3, lh: 18 });
hline(tp, 'params/line', 340, 96, 456, 0.06);
const params = [
  ['query', 'string', '必填', '搜索关键词'],
  ['max_results', 'number', '可选', '返回条数，默认 10'],
  ['search_depth', 'string', '可选', 'basic / advanced'],
];
params.forEach(([n, t, r, d], i) => {
  const y = 104 + i * 32;
  clipText(tp, 'params/' + n + '/name', 340, y, 104, 32, n, { size: 11.5, font: F.code, lh: 32, trunc: true });
  text(tp, 'params/' + n + '/type', 452, y, 64, 32, t, { size: 11, color: C.t3, lh: 32 });
  text(tp, 'params/' + n + '/req', 524, y, 42, 32, r, { size: 10, color: r === '必填' ? C.warn : C.t3, lh: 32 });
  clipText(tp, 'params/' + n + '/desc', 572, y, 226, 32, d, { size: 11.5, color: C.t2, lh: 32, trunc: true });
});

// ---------- 折叠区：使用记录 ----------
const us = box(fr, 'collapse/usage', 600, 720, 816, 110, { fill: C.reader, r: 10, stroke: '#FFFFFF', strokeOp: 0.06 });
text(us, 'collapse/usage/title', 14, 0, 120, 40, '使用记录', { size: 13, font: F.sb, lh: 40 });
text(us, 'collapse/usage/meta', 92, 0, 160, 40, '本会话 2 次', { size: 11, color: C.t3, lh: 40 });
text(us, 'collapse/usage/chev', 780, 0, 22, 40, '▾', { size: 14, color: C.t2, align: 'RIGHT', lh: 40 });
hline(us, 'collapse/usage/line', 14, 40, 788);
text(us, 'usage/time-1', 14, 48, 50, 30, '16:42', { size: 11, font: F.code, color: C.t3, lh: 30 });
text(us, 'usage/session-1', 74, 48, 70, 30, '本会话', { size: 11, color: C.t3, lh: 30 });
text(us, 'usage/tool-1', 152, 48, 400, 30, 'mcp__AnySearch__search', { size: 11.5, font: F.code, color: C.t2, lh: 30 });
text(us, 'usage/time-2', 14, 78, 50, 30, '16:41', { size: 11, font: F.code, color: C.t3, lh: 30 });
text(us, 'usage/session-2', 74, 78, 70, 30, '本会话', { size: 11, color: C.t3, lh: 30 });
text(us, 'usage/tool-2', 152, 78, 400, 30, 'mcp__AnySearch__batch_search', { size: 11.5, font: F.code, color: C.t2, lh: 30 });
box(fr, 'detail/scrollbar', 1409, 464, 3, 240, { fill: '#FFFFFF', fillOp: 0.1, r: 2 });
return { frame: fr.id, children: fr.children.length };
