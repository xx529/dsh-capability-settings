// 01-skills-project.js — v7 帧 01「技能 · 项目」：左 ScopeNav(208) + 中 列表(300) + 右 详情(676)
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
  if (l === '项目') return { bg: C.blue, bgOp: 0.1, color: C.blueLt };
  if (l === '全局') return { bg: C.green, bgOp: 0.1, color: C.green };
  if (l === '屏蔽占位') return { bg: C.warn, bgOp: 0.1, color: C.warn };
  if (l === '覆盖全局') return { stroke: C.blue, strokeOp: 0.4, color: C.blueLt };
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
  let tx = 0;
  if (o.dot) { box(n, name + '/dot', 12, (h - 6) / 2, 6, 6, { fill: o.dot, r: 3, clip: false }); tx = 10; }
  text(n, name + '/t', tx, 0, w - tx, h, label, { size: s, font: o.font || F.m, color: o.color || C.t2, align: 'CENTER', lh: h });
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
let page = figma.root.children.find((p) => p.name === 'Capability Panel · 交互原型 v7');
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);
const fr = page.children.find((n) => n.type === 'FRAME' && n.name.startsWith('01'));
if (!fr) throw new Error('画框 01 不存在：先执行 00-init.js');
for (const c of [...fr.children]) if (c.name !== 'sidebar') c.remove();

// ---------- 头部（两行） ----------
text(fr, 'header/title', 276, 16, 90, 24, '能力面板', { size: 17, font: F.sb, lh: 24 });
clipText(fr, 'header/workspace', 360, 19, 560, 22, 'LiveShopping · /Users/lzx/Documents/GitHub/LiveShopping', { size: 12.5, color: C.t3, lh: 22, trunc: true });
const dd = box(fr, 'header/workspace-dd', 1204, 10, 216, 34, { fill: C.panel, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
text(dd, 'header/workspace-dd-text', 12, 0, 192, 34, '跟随当前会话 ▾', { size: 12.5, color: C.t2, lh: 34 });
hline(fr, 'header/line1', 256, 51, 1184);
const trk = box(fr, 'header/tabs', 276, 60, 300, 36, { fill: C.rail, r: 8 });
const sel = box(trk, 'header/tab-skills', 3, 3, 147, 30, { fill: C.tabOn, r: 6 });
text(sel, 'header/tab-skills-t', 0, 0, 147, 30, '技能 12', { size: 13, font: F.sb, align: 'CENTER', lh: 30 });
text(trk, 'header/tab-mcp-t', 150, 3, 147, 30, 'MCP 4', { size: 13, color: C.t3, align: 'CENTER', lh: 30 });
const srch = box(fr, 'header/search', 1096, 60, 320, 36, { fill: C.panel, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
magnifier(srch, 14, 12);
text(srch, 'header/search-ph', 32, 0, 260, 36, '搜索技能…', { size: 12.5, color: C.t3, lh: 36 });
hline(fr, 'header/line2', 256, 103, 1184);

// ---------- 左 ScopeNav 208 ----------
vline(fr, 'scope/divider', 463, 104, 796);
vline(fr, 'list/divider', 763, 104, 796);
function scopeRow(name, y, label, count, active) {
  const r = box(fr, name, 264, y, 192, 32, { r: 8, fill: active ? C.rowOn : null });
  text(r, 'label', 8, 0, 64, 32, label, { size: 13, font: F.sb, color: active ? C.t1 : C.t2, lh: 32 });
  text(r, 'count', 108, 0, 44, 32, count, { size: 11, color: C.t3, align: 'RIGHT', lh: 32 });
  text(r, 'plus', 164, 0, 16, 32, '+', { size: 14, color: C.t3, align: 'CENTER', lh: 32 });
  return r;
}
scopeRow('scope/global', 112, '全局', '146', false);
scopeRow('scope/project', 148, '项目', '12', true);
const workspaces = ['Desktop', 'HtDot', 'dsh-setup', 'RemoteTTS', 'miraclip_ai', 'research', 'miraclips', 'agent-workspace', 'LiveShopping', 'mira-ai', 'mira-live', 'OmniJev', 'Evoke', 'Raise'];
workspaces.forEach((name, i) => {
  const y = 186 + i * 34;
  const on = name === 'LiveShopping';
  const r = box(fr, 'ws/' + name, 272, y, 184, 34, { r: 8, fill: on ? C.rowOn : null });
  if (on) box(r, 'bar', 0, 8, 2, 18, { fill: C.blue, r: 1 });
  clipText(r, 'name', 12, 0, 160, 34, name, { size: 13, font: on ? F.m : F.r, color: on ? C.t1 : C.t2, lh: 34, trunc: true });
});
box(fr, 'scope/scrollbar', 458, 190, 3, 300, { fill: '#FFFFFF', fillOp: 0.1, r: 2 });

// ---------- 中列 300：LiveShopping 技能 ----------
text(fr, 'list/title', 476, 112, 150, 32, 'LiveShopping', { size: 13.5, font: F.sb, lh: 32 });
const cnt = box(fr, 'list/count', 476 + txtw('LiveShopping', 13.5) + 8, 119, 26, 18, { fill: '#FFFFFF', fillOp: 0.08, r: 999 });
text(cnt, 'list/count-t', 0, 0, 26, 18, '12', { size: 11, font: F.m, color: C.t2, align: 'CENTER', lh: 18 });
const add = box(fr, 'list/add', 720, 112, 32, 32, { fill: C.blue, r: 8 });
text(add, 'list/add-t', 0, 0, 32, 32, '+', { size: 18, color: '#0F1115', align: 'CENTER', lh: 32 });

function skillRow(name, y, o) {
  const r = box(fr, name, 472, y, 284, 76, { r: 10, fill: o.sel ? C.rowOn : null });
  if (o.sel) box(r, 'sel-bar', 8, 8, 2, 60, { fill: C.blue, r: 1 });
  box(r, 'dot', 12, 13, 8, 8, { fill: o.on ? C.green : C.t3, r: 4 });
  clipText(r, 'name', 24, 7, 170, 20, o.title, { size: 13.5, font: F.sb, lh: 20, trunc: true });
  let tx = 24;
  for (const l of o.tags) { const t = tag(r, 'tag-' + l, tx, 28, l); tx += t.width + 4; }
  clipText(r, 'desc', 12, 50, 184, 20, o.desc, { size: 12.5, color: C.t2, lh: 20, trunc: true });
  toggle(r, 244, 29, '启用', o.on);
  return r;
}
skillRow('row/agent-orchestration-advisor', 156, { sel: true, on: true, title: 'agent-orchestration-advisor', tags: ['项目', '目录', '覆盖全局'], desc: '设计多 agent 工作流与交接边界' });
skillRow('row/live-shopping-ops', 236, { on: true, title: 'live-shopping-ops', tags: ['项目', '目录'], desc: '大促页面巡检与价格监控' });
skillRow('row/liveshopping-price-monitor', 316, { on: true, title: 'liveshopping-price-monitor', tags: ['项目', '目录'], desc: '大促价格监控与异常告警' });
skillRow('row/session-retrospective', 396, { on: false, title: 'session-retrospective', tags: ['项目', '目录', '屏蔽占位'], desc: '整理对话决策与待办，产出小结' });
skillRow('row/promo-page-checklist', 476, { on: true, title: 'promo-page-checklist', tags: ['项目', '目录'], desc: '活动页上线前检查清单' });
box(fr, 'list/scrollbar', 757, 160, 3, 240, { fill: '#FFFFFF', fillOp: 0.1, r: 2 });

// ---------- 右详情 676（内容 628） ----------
clipText(fr, 'detail/name', 788, 132, 300, 26, 'agent-orchestration-advisor', { size: 18, font: F.sb, lh: 26, trunc: true });
tag(fr, 'detail/tag-project', 1070, 136, '项目');
tag(fr, 'detail/tag-dir', 1110, 136, '目录');
text(fr, 'detail/copy-path', 1330, 132, 86, 26, '复制路径', { size: 12, color: C.t3, align: 'RIGHT', lh: 26 });
btn(fr, 'act/enabled', 788, 176, '已启用', { w: 68, stroke: C.green, strokeOp: 0.4, color: C.green, dot: C.green });
btn(fr, 'act/export', 864, 176, '导出', { w: 46, stroke: '#FFFFFF', strokeOp: 0.14, color: C.t2 });
btn(fr, 'act/export-path', 918, 176, '导出到路径…', { w: 104, stroke: '#FFFFFF', strokeOp: 0.14, color: C.t2 });
btn(fr, 'act/delete', 1030, 176, '删除', { w: 44, color: C.red });
clipText(fr, 'meta/source', 788, 218, 160, 36, '来源 user-agents · 目录', { size: 12, color: C.t2, lh: 36, trunc: true });
clipText(fr, 'meta/path', 956, 218, 300, 36, '/Users/lzx/.agents/skills/agent-orchestration-advisor/SKILL.md', { size: 11.5, font: F.code, color: C.t3, lh: 36, trunc: true });
text(fr, 'meta/caps', 1264, 218, 152, 36, '· 模型 ✓ 用户 ✓', { size: 12, color: C.t2, lh: 36 });

// 文件目录树 200
const tree = box(fr, 'detail/tree', 788, 266, 200, 614, { fill: C.reader, r: 10, stroke: '#FFFFFF', strokeOp: 0.06 });
const TH = 30, TBD = 118, TS = 156;
text(tree, 'tree/title', 12, 0, 100, 36, '技能文件', { size: 13, font: F.sb, lh: 36 });
text(tree, 'tree/count', 152, 0, 36, 36, '5', { size: 12, color: C.t3, align: 'RIGHT', lh: 36 });
hline(tree, 'tree/line', 12, 36, 176);
function badge(name, x, y, label) {
  const b = box(tree, name, x, y, 22, 14, { fill: '#FFFFFF', fillOp: 0.06, r: 3 });
  text(b, name + '/t', 0, 0, 22, 14, label, { size: 8, font: F.code, color: C.t3, align: 'CENTER', lh: 14 });
  return b;
}
function treeRow(name, y, o) {
  const ind = o.ind || 0;
  if (o.sel) { box(tree, name + '/bg', 4, y, 192, TH, { fill: C.rowOn, r: 6 }); box(tree, name + '/bar', 4, y + 6, 2, 18, { fill: C.blue, r: 1 }); }
  if (o.icon) text(tree, name + '/icon', 12 + ind, y, 12, TH, o.icon, { size: 9.5, color: C.t3, lh: TH });
  const nx = 26 + ind;
  clipText(tree, name + '/label', nx, y, (o.badge ? TBD - 4 : (o.size ? TS - 4 : 196)) - nx, TH, o.label, { size: o.fs || 10, font: F.code, color: o.color || C.t1, lh: TH, trunc: true });
  if (o.count) text(tree, name + '/count', nx + txtw(o.label, 10) + 4, y, 18, TH, o.count, { size: 9.5, color: C.t3, lh: TH });
  if (o.badge) badge(name + '/badge', TBD, y + (TH - 14) / 2, o.badge);
  if (o.size) text(tree, name + '/size', TS, y, 40, TH, o.size, { size: 10.5, color: C.t3, align: 'RIGHT', lh: TH });
}
treeRow('tree/root', 44, { icon: '▾', label: 'agent-orchestration-advisor/', color: C.t2 });
box(tree, 'tree/guide-d1', 28, 74, 1, 180, { fill: '#FFFFFF', fillOp: 0.08, clip: false });
box(tree, 'tree/guide-d2', 38, 164, 1, 60, { fill: '#FFFFFF', fillOp: 0.08, clip: false });
treeRow('tree/skill-md', 74, { sel: true, ind: 10, label: 'SKILL.md', badge: 'MD', size: '8.2K' });
treeRow('tree/workflow', 104, { ind: 10, label: 'workflow.md', badge: 'MD', size: '3.1K' });
treeRow('tree/references', 134, { ind: 10, icon: '▾', label: 'references/', count: '2' });
treeRow('tree/schema', 164, { ind: 20, label: 'schema.json', badge: 'JSON', size: '1.2K' });
treeRow('tree/example', 194, { ind: 20, label: 'example.png', badge: 'PNG', size: '44K' });
treeRow('tree/examples', 224, { ind: 10, label: 'examples.md', badge: 'MD', size: '2.4K' });
box(tree, 'tree/scrollbar', 188, 44, 3, 200, { fill: '#FFFFFF', fillOp: 0.1, r: 2 });

// 阅读器 412
const rd = box(fr, 'detail/reader', 1004, 266, 412, 614, { fill: C.reader, r: 10, stroke: '#FFFFFF', strokeOp: 0.06 });
text(rd, 'reader/file', 14, 0, 82, 40, 'SKILL.md', { size: 13, font: F.sb, lh: 40 });
text(rd, 'reader/meta', 96, 0, 120, 40, '8.2 KB · MD', { size: 11, color: C.t3, lh: 40 });
const seg = box(rd, 'reader/seg', 300, 7, 100, 26, { fill: C.rail, r: 6 });
const segOn = box(seg, 'reader/seg-on', 3, 3, 46, 20, { fill: C.tabOn, r: 4 });
text(segOn, 'reader/seg-on-t', 0, 0, 46, 20, '预览', { size: 10.5, font: F.m, align: 'CENTER', lh: 20 });
text(seg, 'reader/seg-off-t', 47, 3, 46, 20, '源码', { size: 10.5, color: C.t3, align: 'CENTER', lh: 20 });
hline(rd, 'reader/line', 14, 40, 388);
text(rd, 'md/h1', 16, 52, 380, 26, 'agent-orchestration-advisor', { size: 17, font: F.sb, lh: 26 });
text(rd, 'md/p1', 16, 86, 380, 44, '设计多 agent 工作流：明确每个角色的边界、交接格式与监控点，适用于复杂任务需要并行拆分的场景。', { size: 13.5, color: '#D7DBE2', lh: 22 });
text(rd, 'md/h2', 16, 140, 380, 22, '何时使用', { size: 15, font: F.sb, lh: 22 });
text(rd, 'md/list', 16, 170, 380, 44, '• 任务可拆分为并行角色时\n• 需要清晰交接格式与监控点时', { size: 13.5, color: '#D7DBE2', lh: 22 });
const code = box(rd, 'md/code', 16, 226, 380, 88, { fill: '#151920', r: 8 });
text(code, 'md/code-text', 12, 8, 356, 72, '{\n  "roles": ["planner", "builder"],\n  "handoff": "json"\n}', { size: 11.5, font: F.code, color: '#B9C0CB', lh: 18 });
text(rd, 'md/p2', 16, 328, 380, 44, '交接必须带上目标、输入与验收标准，监控点用于判断是否继续。', { size: 13.5, color: '#D7DBE2', lh: 22 });
box(rd, 'reader/scrollbar', 394, 52, 3, 120, { fill: '#FFFFFF', fillOp: 0.12, r: 2 });
return { frame: fr.id, children: fr.children.length };
