// 02-mcp-project.js — v7 帧 02「MCP · 项目」：左 ScopeNav(208) + 中 列表(300) + 右 详情(676)
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
  if (l === '外部' || l === '默认关闭') return { bg: C.warn, bgOp: 0.1, color: C.warn };
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
function sw(p, name, x, y, on) {
  const t = box(p, name, x, y, 30, 18, { r: 999, fill: '#FFFFFF', fillOp: on ? 1 : 0.13 });
  if (on) t.fills = [paint(C.blue)];
  box(t, name + '/knob', on ? 14 : 2, 2, 14, 14, { fill: on ? '#FFFFFF' : '#C9CED8', r: 7, clip: false });
  return t;
}
function toggle(p, x, y, label, on) {
  text(p, 'toggle-label', x - 40, y, 32, 18, label, { size: 10.5, color: C.t3, align: 'RIGHT', lh: 18 });
  return sw(p, 'switch', x, y, on);
}
function magnifier(p, x, y) {
  const e = figma.createEllipse(); p.appendChild(e); e.name = 'search-icon'; e.x = x; e.y = y; e.resize(11, 11);
  e.fills = []; e.strokes = [paint(C.t3)]; e.strokeWeight = 1.4;
  const s = figma.createRectangle(); p.appendChild(s); s.name = 'search-handle'; s.x = x + 8; s.y = y + 8;
  s.resize(5, 1.4); s.rotation = 45; s.fills = [paint(C.t3)]; s.strokes = []; s.cornerRadius = 1;
}

// ---------- 定位 + 清空（保留 sidebar） ----------
let page = figma.root.children.find((p) => p.name === 'Capability Panel · 终稿 v8');
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);
const fr = page.children.find((n) => n.type === 'FRAME' && n.name.startsWith('04'));
if (!fr) throw new Error('画框 02 不存在：先执行 00-init.js');
for (const c of [...fr.children]) if (c.name !== 'sidebar') c.remove();

// ---------- 头部（两行） ----------
text(fr, 'header/title', 276, 16, 90, 24, '能力面板', { size: 17, font: F.sb, lh: 24 });
clipText(fr, 'header/workspace', 360, 19, 560, 22, 'LiveShopping · /Users/lzx/Documents/GitHub/LiveShopping', { size: 12.5, color: C.t3, lh: 22, trunc: true });
const dd = box(fr, 'header/workspace-dd', 1204, 10, 216, 34, { fill: C.panel, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
text(dd, 'header/workspace-dd-text', 12, 0, 192, 34, '跟随当前会话 ▾', { size: 12.5, color: C.t2, lh: 34 });
hline(fr, 'header/line1', 256, 51, 1184);
const trk = box(fr, 'header/tabs', 276, 60, 300, 36, { fill: C.rail, r: 8 });
text(trk, 'header/tab-skills-t', 3, 3, 147, 30, '技能 12', { size: 13, color: C.t3, align: 'CENTER', lh: 30 });
const selTab = box(trk, 'header/tab-mcp', 150, 3, 147, 30, { fill: C.tabOn, r: 6 });
text(selTab, 'header/tab-mcp-t', 0, 0, 147, 30, 'MCP 4', { size: 13, font: F.sb, align: 'CENTER', lh: 30 });
const srch = box(fr, 'header/search', 1096, 60, 320, 36, { fill: C.panel, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
magnifier(srch, 14, 12);
text(srch, 'header/search-ph', 32, 0, 260, 36, '搜索 MCP 服务器…', { size: 12.5, color: C.t3, lh: 36 });
hline(fr, 'header/line2', 256, 103, 1184);

// ---------- 左 ScopeNav 208（同 01） ----------
vline(fr, 'scope/divider', 463, 104, 796);
vline(fr, 'list/divider', 763, 104, 796);
function scopeRow(name, y, label, count, active) {
  const r = box(fr, name, 264, y, 192, 32, { r: 8, fill: active ? C.rowOn : null });
  text(r, 'label', 8, 0, 64, 32, label, { size: 13, font: F.sb, color: active ? C.t1 : C.t2, lh: 32 });
  text(r, 'count', 108, 0, 44, 32, count, { size: 11, color: C.t3, align: 'RIGHT', lh: 32 });
  text(r, 'plus', 164, 0, 16, 32, '+', { size: 14, color: C.t3, align: 'CENTER', lh: 32 });
  return r;
}
scopeRow('scope/global', 112, '全局', '146', true);
scopeRow('scope/project', 148, '项目', '12', false);
const workspaces = ['Desktop', 'HtDot', 'dsh-setup', 'RemoteTTS', 'miraclip_ai', 'research', 'miraclips', 'agent-workspace', 'LiveShopping', 'mira-ai', 'mira-live', 'OmniJev', 'Evoke', 'Raise'];
workspaces.forEach((name, i) => {
  const y = 186 + i * 34;
  const on = name === 'LiveShopping';
  const r = box(fr, 'ws/' + name, 272, y, 184, 34, { r: 8, fill: on ? C.rowOn : null });
  if (on) box(r, 'bar', 0, 8, 2, 18, { fill: C.blue, r: 1 });
  clipText(r, 'name', 12, 0, 160, 34, name, { size: 13, font: on ? F.m : F.r, color: on ? C.t1 : C.t2, lh: 34, trunc: true });
});
box(fr, 'scope/scrollbar', 458, 190, 3, 300, { fill: '#FFFFFF', fillOp: 0.1, r: 2 });

// ---------- 中列 300：全局 MCP + 外部注入 ----------
text(fr, 'list/title', 476, 112, 150, 32, '全局', { size: 13.5, font: F.sb, lh: 32 });
const cnt = box(fr, 'list/count', 476 + txtw('全局', 13.5) + 8, 119, 26, 18, { fill: '#FFFFFF', fillOp: 0.08, r: 999 });
text(cnt, 'list/count-t', 0, 0, 26, 18, '5', { size: 11, font: F.m, color: C.t2, align: 'CENTER', lh: 18 });
const add = box(fr, 'list/add', 720, 112, 32, 32, { fill: C.blue, r: 8 });
text(add, 'list/add-t', 0, 0, 32, 32, '+', { size: 18, color: '#0F1115', align: 'CENTER', lh: 32 });

function groupHeader(name, y, label, count, note) {
  const g = box(fr, name, 472, y, 284, 36, {});
  text(g, name + '/title', 0, 0, 80, 36, label, { size: 13, font: F.sb, lh: 36 });
  const pill = box(g, name + '/count', txtw(label, 13) + 14, 9, 24, 18, { fill: '#FFFFFF', fillOp: 0.08, r: 999 });
  text(pill, name + '/count-t', 0, 0, 24, 18, count, { size: 10.5, font: F.m, color: C.t2, align: 'CENTER', lh: 18 });
  text(g, name + '/note', 96, 0, 184, 36, note, { size: 10.5, color: C.t3, align: 'RIGHT', lh: 36, trunc: true });
  hline(fr, name + '/line', 472, y + 35, 284);
}
function mcpRow(name, y, o) {
  const r = box(fr, name, 472, y, 284, 72, { r: 10, fill: o.sel ? C.rowOn : null });
  if (o.sel) box(r, 'sel-bar', 8, 7, 2, 58, { fill: C.blue, r: 1 });
  box(r, 'dot', 12, 13, 8, 8, { fill: o.on ? C.green : C.t3, r: 4 });
  clipText(r, 'name', 24, 7, 170, 20, o.title, { size: 13.5, font: F.sb, lh: 20, trunc: true });
  let tx = 24;
  for (const l of o.tags) { if (tx + txtw(l, 10.5) + 10 > 196) break; const t = tag(r, 'tag-' + l, tx, 28, l); tx += t.width + 4; }
  clipText(r, 'meta', 24, 49, 184, 18, o.meta, { size: 11, color: C.t3, lh: 18, trunc: true });
  toggle(r, 244, 27, '默认', o.on);
  return r;
}
groupHeader('grp/global', 156, '全局', '4', '所有项目共享 · 改动影响全部项目');
mcpRow('row/context7', 200, { on: true, title: 'context7', tags: ['全局', 'stdio'], meta: '已挂载 · 工具数未知' });
mcpRow('row/deepwiki', 276, { on: true, title: 'deepwiki', tags: ['全局', 'http'], meta: '已挂载 · 工具数未知' });
mcpRow('row/open-computer-use', 352, { on: true, title: 'open-computer-use', tags: ['全局', 'stdio'], meta: '已挂载 · 工具数未知' });
mcpRow('row/tavily', 428, { on: true, title: 'tavily', tags: ['全局', 'stdio'], meta: '已挂载 · 默认开启' });
hline(fr, 'list/gap-line', 472, 508, 284);
groupHeader('grp/external', 516, '外部注入', '1', '运行时注入 · 只读');
mcpRow('row/figma', 560, { on: false, title: 'figma', tags: ['外部', '默认关闭'], meta: '17 个工具 · 调用 4 次' });
box(fr, 'list/scrollbar', 757, 160, 3, 400, { fill: '#FFFFFF', fillOp: 0.1, r: 2 });

// ---------- 右详情 676（内容 628）：外部注入只读 ----------
text(fr, 'detail/name', 788, 132, 120, 26, 'figma', { size: 18, font: F.sb, lh: 26 });
tag(fr, 'detail/tag-external', 850, 136, '外部注入');
tag(fr, 'detail/tag-readonly', 930, 136, '只读');
text(fr, 'detail/copy-ns', 1300, 132, 116, 26, '复制命名空间', { size: 12, color: C.t3, align: 'RIGHT', lh: 26 });
btn(fr, 'act/tools', 788, 176, '查看工具与参数', { w: 110, stroke: C.blue, strokeOp: 0.4, color: C.blueLt });
btn(fr, 'act/usage', 906, 176, '使用记录', { w: 68, stroke: '#FFFFFF', strokeOp: 0.14, color: C.t2 });
const notice = box(fr, 'notice/readonly', 788, 218, 628, 32, { fill: C.warn, fillOp: 0.1, r: 8 });
text(notice, 'notice/text', 14, 0, 600, 32, '只读原因：该 MCP 由 figma-workbench 在运行时注入，能力面板只能查看与记录调用，不能编辑或删除。', { size: 12, color: C.warn, lh: 32, trunc: true });

function field(name, y, label, value, o) {
  o = o || {};
  text(fr, 'field/' + name + '/label', 788, y, 90, 28, label, { size: 12, color: C.t3, lh: 28 });
  text(fr, 'field/' + name + '/value', 878, y, 538, 28, value, { size: o.size || 13, font: o.font || F.r, color: o.color || C.t1, lh: 28, trunc: true });
}
field('ns', 262, '命名空间', 'mcp__figma__*', { font: F.code, size: 11.5 });
hline(fr, 'field/line-a', 788, 294, 628);
field('source', 302, '来源', 'figma-workbench（由插件运行时注入）');
field('inject', 332, '注入方式', 'loader 条目 / 动态 fiber');
field('transport', 362, '传输方式', 'stdio');
hline(fr, 'field/line-b', 788, 396, 628);
field('default', 404, '默认', '○ 默认关闭（新建对话不启用）', { color: C.t2 });
text(fr, 'field/current/label', 788, 434, 90, 28, '当前对话', { size: 12, color: C.t3, lh: 28 });
box(fr, 'field/current/dot', 878, 445, 8, 8, { fill: C.green, r: 4 });
text(fr, 'field/current/value', 894, 434, 522, 28, '开启（会话内可覆盖）', { size: 13, color: C.t2, lh: 28 });
hline(fr, 'field/line-c', 788, 468, 628);
field('calls', 476, '本次运行调用', '4 次');
field('manage', 506, '管理', '只读：不由能力面板管理，无法编辑或删除', { color: C.t2 });
hline(fr, 'field/line-d', 788, 540, 628);

// ---------- 工具与参数（手风琴：一项展开） ----------
const tp = box(fr, 'collapse/tools', 788, 552, 628, 214, { fill: C.reader, r: 10, stroke: '#FFFFFF', strokeOp: 0.06 });
text(tp, 'collapse/tools/title', 14, 0, 100, 40, '工具与参数', { size: 13, font: F.sb, lh: 40 });
text(tp, 'collapse/tools/meta', 104, 0, 300, 40, '17 个工具 · 点击工具展开参数', { size: 11, color: C.t3, lh: 40 });
hline(tp, 'collapse/tools/line', 14, 40, 600);
function toolRow(name, y, id, label, n, open) {
  text(tp, 'tools/' + id + '/chev', 14, y, 16, 36, open ? '▾' : '▸', { size: 11, color: open ? C.blueLt : C.t3, lh: 36 });
  text(tp, 'tools/' + id + '/name', 34, y, 380, 36, label, { size: 11.5, font: F.code, color: open ? C.blueLt : C.t1, lh: 36, trunc: true });
  text(tp, 'tools/' + id + '/count', 460, y, 150, 36, n, { size: 11, color: C.t3, align: 'RIGHT', lh: 36 });
  hline(tp, 'tools/' + id + '/line', 14, y + 36, 600);
}
toolRow('status', 40, 'status', 'mcp__figma__figma_status', '0 个参数', false);
toolRow('select', 76, 'select', 'mcp__figma__figma_select_document', '1 个参数', true);
text(tp, 'params/h-name', 34, 116, 100, 24, '参数', { size: 10.5, color: C.t3, lh: 24 });
text(tp, 'params/h-type', 144, 116, 60, 24, '类型', { size: 10.5, color: C.t3, lh: 24 });
text(tp, 'params/h-req', 216, 116, 44, 24, '必填', { size: 10.5, color: C.t3, lh: 24 });
text(tp, 'params/h-desc', 272, 116, 340, 24, '说明', { size: 10.5, color: C.t3, lh: 24 });
hline(tp, 'params/line', 34, 140, 576, 0.06);
clipText(tp, 'params/connectionId/name', 34, 140, 100, 30, 'connectionId', { size: 11, font: F.code, lh: 30, trunc: true });
text(tp, 'params/connectionId/type', 144, 140, 60, 30, 'string', { size: 11, color: C.t3, lh: 30 });
text(tp, 'params/connectionId/req', 216, 140, 44, 30, '必填', { size: 10, color: C.warn, lh: 30 });
clipText(tp, 'params/connectionId/desc', 272, 140, 338, 30, '文档连接 ID（由 figma_status 返回）', { size: 11, color: C.t2, lh: 30, trunc: true });
toolRow('guide', 176, 'guide', 'mcp__figma__figma_read_guide', '0 个参数', false);

// ---------- 使用记录（折叠态） ----------
const us = box(fr, 'collapse/usage', 788, 778, 628, 44, { fill: C.reader, r: 10, stroke: '#FFFFFF', strokeOp: 0.06 });
text(us, 'collapse/usage/title', 14, 0, 120, 44, '使用记录', { size: 13, font: F.sb, lh: 44 });
text(us, 'collapse/usage/meta', 92, 0, 160, 44, '本会话 2 次', { size: 11, color: C.t3, lh: 44 });
text(us, 'collapse/usage/chev', 592, 0, 22, 44, '▸', { size: 14, color: C.t2, align: 'RIGHT', lh: 44 });
box(fr, 'detail/scrollbar', 1409, 552, 3, 160, { fill: '#FFFFFF', fillOp: 0.1, r: 2 });
return { frame: fr.id, children: fr.children.length };
