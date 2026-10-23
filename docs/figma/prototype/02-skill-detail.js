// 02-skill-detail.js — 帧 02「技能详情（SKILL.md + 文件树）」主区：详情最大化
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
function sw(p, name, x, y, on, dim) {
  const t = box(p, name, x, y, 30, 18, { r: 999, fill: '#FFFFFF', fillOp: dim ? 0.08 : (on ? 1 : 0.13) });
  if (on && !dim) t.fills = [paint(C.blue)];
  box(t, name + '/knob', on ? 14 : 2, 2, 14, 14, { fill: on ? (dim ? '#C9CED8' : '#FFFFFF') : '#C9CED8', r: 7, clip: false });
  return t;
}
function toggle(p, x, y, label, on, dim) {
  text(p, 'toggle-label', x - 40, y, 32, 18, label, { size: 10.5, color: C.t3, align: 'RIGHT', lh: 18 });
  return sw(p, 'switch', x, y, on, dim);
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
const fr = page.children.find((n) => n.type === 'FRAME' && n.name.startsWith('02'));
if (!fr) throw new Error('画框 02 不存在：先执行 00-init.js');
for (const c of [...fr.children]) if (c.name !== 'sidebar') c.remove();

// ---------- 头部 / 工具条 ----------
text(fr, 'header/title', 276, 16, 80, 24, '能力面板', { size: 17, font: F.sb, lh: 24 });
clipText(fr, 'header/workspace', 360, 19, 640, 22, '/Users/lzx/Documents/GitHub/dsh-capability-settings', { size: 12.5, color: C.t3, lh: 22, trunc: true });
const dd = box(fr, 'header/workspace-dd', 1204, 8, 216, 34, { fill: C.panel, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
text(dd, 'header/workspace-dd-text', 12, 0, 192, 34, '跟随当前会话 ▾', { size: 12.5, color: C.t2, lh: 34 });
hline(fr, 'header/line', 256, 87, 1184);
const trk = box(fr, 'header/tabs', 276, 51, 300, 36, { fill: C.rail, r: 8 });
const sel = box(trk, 'header/tab-skills', 3, 3, 147, 30, { fill: C.tabOn, r: 6 });
text(sel, 'header/tab-skills-t', 0, 0, 147, 30, '技能 12', { size: 13, font: F.sb, align: 'CENTER', lh: 30 });
text(trk, 'header/tab-mcp-t', 150, 3, 147, 30, 'MCP 9', { size: 13, color: C.t3, align: 'CENTER', lh: 30 });
hline(fr, 'toolbar/line', 256, 139, 1184);
const srch = box(fr, 'toolbar/search', 276, 96, 1012, 36, { fill: C.panel, r: 8, stroke: '#FFFFFF', strokeOp: 0.08 });
magnifier(srch, 14, 12);
text(srch, 'toolbar/search-ph', 32, 0, 500, 36, '搜索技能…', { size: 12.5, color: C.t3, lh: 36 });
const cta = box(fr, 'toolbar/cta', 1304, 96, 112, 32, { fill: C.blue, r: 999 });
text(cta, 'toolbar/cta-t', 0, 0, 112, 32, '+ 安装技能', { size: 12.5, font: F.sb, color: '#0F1115', align: 'CENTER', lh: 32 });

// ---------- 列表（简化：两组各 3 行，行尾开关） ----------
vline(fr, 'list/divider', 575, 140, 760);
function groupHeader(name, y, label, count, note) {
  const g = box(fr, name, 264, y, 304, 36, {});
  text(g, name + '/title', 0, 0, 62, 36, label, { size: 13, font: F.sb, lh: 36 });
  const pill = box(g, name + '/count', txtw(label, 13) + 14, 9, 24, 18, { fill: '#FFFFFF', fillOp: 0.08, r: 999 });
  text(pill, name + '/count-t', 0, 0, 24, 18, count, { size: 10.5, font: F.m, color: C.t2, align: 'CENTER', lh: 18 });
  text(g, name + '/note', 100, 0, 204, 36, note, { size: 11, color: C.t3, align: 'RIGHT', lh: 36, trunc: true });
  hline(fr, name + '/line', 264, y + 35, 304);
}
function skillRow(name, y, o) {
  const r = box(fr, name, 264, y, 304, 76, { r: 10, fill: o.sel ? C.rowOn : null });
  if (o.sel) box(r, 'sel-bar', 8, 8, 2, 60, { fill: C.blue, r: 1 });
  box(r, 'dot', 12, 13, 8, 8, { fill: o.dot || C.green, r: 4 });
  clipText(r, 'name', 24, 7, 200, 20, o.title, { size: 13.5, font: F.sb, lh: 20, trunc: true });
  let tx = 24;
  for (const l of o.tags) { const t = tag(r, 'tag-' + l, tx, 28, l); tx += t.width + 4; }
  clipText(r, 'desc', 12, 50, 214, 20, o.desc, { size: 12.5, color: C.t2, lh: 20, trunc: true });
  toggle(r, 264, 29, '启用', o.on, o.dim);
  if (o.opacity != null) r.opacity = o.opacity;
  return r;
}
groupHeader('grp/project', 148, '本项目', '3', '随项目走 · 只在本项目生效');
skillRow('row/agent-orchestration-advisor', 192, { sel: true, on: true, title: 'agent-orchestration-advisor', tags: ['项目', '目录', '覆盖全局'], desc: '设计多 agent 工作流与交接边界' });
skillRow('row/session-retrospective', 272, { on: false, dot: C.t3, title: 'session-retrospective', tags: ['项目', '目录', '屏蔽占位'], desc: '整理对话决策与待办，产出小结' });
skillRow('row/bootstrap', 352, { on: true, title: 'dsh-capability-settings-bootstrap', tags: ['项目', '目录'], desc: '仓库初始化引导与常用命令速查' });
hline(fr, 'list/gap-line', 264, 436, 304);
groupHeader('grp/global', 444, '全局', '9', '所有项目共享 · 改动影响全部项目');
skillRow('row/acceptance-criteria-writer', 488, { on: true, title: 'acceptance-criteria-writer', tags: ['全局', '.md'], desc: '拆成可观察、可测试的验收标准' });
skillRow('row/acquisition-channel-advisor', 568, { on: true, title: 'acquisition-channel-advisor', tags: ['全局', '目录'], desc: '用单位经济与客户质量评估渠道' });
skillRow('row/altitude-horizon-framework', 648, { on: true, title: 'altitude-horizon-framework', tags: ['全局', '目录'], desc: '用高度与时间视野诊断层级差距' });
box(fr, 'list/scrollbar', 569, 360, 3, 220, { fill: '#FFFFFF', fillOp: 0.1, r: 2 });

// ---------- 详情：标题 / 动作 / 元信息 ----------
clipText(fr, 'detail/name', 600, 164, 270, 26, 'agent-orchestration-advisor', { size: 18, font: F.sb, lh: 26, trunc: true });
tag(fr, 'detail/tag-project', 882, 168, '项目');
tag(fr, 'detail/tag-dir', 922, 168, '目录');
text(fr, 'detail/copy-path', 1330, 164, 86, 26, '复制路径', { size: 12, color: C.t3, align: 'RIGHT', lh: 26 });
btn(fr, 'act/enabled', 600, 209, '已启用', { w: 68, stroke: C.green, strokeOp: 0.4, color: C.green, dot: C.green });
btn(fr, 'act/export', 676, 209, '导出', { w: 46, stroke: '#FFFFFF', strokeOp: 0.14, color: C.t2 });
btn(fr, 'act/export-path', 730, 209, '导出到路径…', { w: 104, stroke: '#FFFFFF', strokeOp: 0.14, color: C.t2 });
btn(fr, 'act/delete', 842, 209, '删除', { w: 44, color: C.red });
clipText(fr, 'meta/source', 600, 252, 180, 36, '来源 user-agents · 目录', { size: 12, color: C.t2, lh: 36, trunc: true });
clipText(fr, 'meta/path', 784, 252, 374, 36, '/Users/lzx/.agents/skills/agent-orchestration-advisor/SKILL.md', { size: 11.5, font: F.code, color: C.t3, lh: 36, trunc: true });
text(fr, 'meta/caps', 1170, 252, 246, 36, '· 模型 ✓ 用户 ✓', { size: 12, color: C.t2, lh: 36 });

// ---------- 详情：内容区 816×584（文件目录树 240 + 16 + 阅读器 560） ----------
const tree = box(fr, 'detail/tree', 600, 296, 240, 584, { fill: C.reader, r: 10, stroke: '#FFFFFF', strokeOp: 0.06 });
const TH = 32, TB = 14, TBD = 150, TS = 190;
text(tree, 'tree/title', 14, 0, 110, 40, '技能文件', { size: 13, font: F.sb, lh: 40 });
text(tree, 'tree/count', 194, 0, 32, 40, '6', { size: 12, color: C.t3, align: 'RIGHT', lh: 40 });
hline(tree, 'tree/line', 14, 40, 212);
function badge(name, x, y, label) {
  const b = box(tree, name, x, y, 22, 14, { fill: '#FFFFFF', fillOp: 0.06, r: 3 });
  text(b, name + '/t', 0, 0, 22, 14, label, { size: 8.5, font: F.code, color: C.t3, align: 'CENTER', lh: 14 });
  return b;
}
function treeRow(name, y, o) {
  const ind = o.ind || 0;
  if (o.sel) { box(tree, name + '/bg', 8, y, 224, TH, { fill: C.rowOn, r: 6 }); box(tree, name + '/bar', 8, y + 7, 2, 18, { fill: C.blue, r: 1 }); }
  if (o.icon) text(tree, name + '/icon', TB + ind, y, 12, TH, o.icon, { size: 9.5, color: C.t3, lh: TH });
  const nx = 28 + ind;
  const right = o.badge ? TBD - 4 : (o.size ? TS - 4 : 238);
  clipText(tree, name + '/label', nx, y, right - nx, TH, o.label, { size: o.fs || 10.5, font: F.code, color: o.color || C.t1, lh: TH, trunc: true });
  if (o.count) text(tree, name + '/count', nx + txtw(o.label, 10.5) + 5, y, 20, TH, o.count, { size: 9.5, color: C.t3, lh: TH });
  if (o.badge) badge(name + '/badge', TBD, y + (TH - 14) / 2, o.badge);
  if (o.size) text(tree, name + '/size', TS, y, 44, TH, o.size, { size: 10.5, color: C.t3, align: 'RIGHT', lh: TH });
}
treeRow('tree/root', 48, { icon: '▾', label: 'agent-orchestration-advisor/', color: C.t2, fs: 11.5 });
box(tree, 'tree/guide-d1', 32, 80, 1, 224, { fill: '#FFFFFF', fillOp: 0.08, clip: false });
box(tree, 'tree/guide-d2', 46, 176, 1, 96, { fill: '#FFFFFF', fillOp: 0.08, clip: false });
treeRow('tree/skill-md', 80, { sel: true, ind: 14, label: 'SKILL.md', badge: 'MD', size: '8.2K' });
treeRow('tree/workflow', 112, { ind: 14, label: 'workflow.md', badge: 'MD', size: '3.1K' });
treeRow('tree/references', 144, { ind: 14, icon: '▾', label: 'references/', count: '3' });
treeRow('tree/schema', 176, { ind: 28, label: 'schema.json', badge: 'JSON', size: '1.2K' });
treeRow('tree/example', 208, { ind: 28, label: 'example.png', badge: 'PNG', size: '44K' });
treeRow('tree/patterns', 240, { ind: 28, label: 'patterns.md', badge: 'MD', size: '6.4K' });
treeRow('tree/examples', 272, { ind: 14, label: 'examples.md', badge: 'MD', size: '2.4K' });
box(tree, 'tree/scrollbar', 228, 48, 3, 256, { fill: '#FFFFFF', fillOp: 0.1, r: 2 });

const rd = box(fr, 'detail/reader', 856, 296, 560, 584, { fill: C.reader, r: 10, stroke: '#FFFFFF', strokeOp: 0.06 });
text(rd, 'reader/file', 14, 0, 90, 40, 'SKILL.md', { size: 13, font: F.sb, lh: 40 });
text(rd, 'reader/meta', 106, 0, 120, 40, '8.2 KB · MD', { size: 11, color: C.t3, lh: 40 });
const seg = box(rd, 'reader/seg', 424, 7, 112, 26, { fill: C.rail, r: 6 });
const segOn = box(seg, 'reader/seg-on', 3, 3, 52, 20, { fill: C.tabOn, r: 4 });
text(segOn, 'reader/seg-on-t', 0, 0, 52, 20, '预览', { size: 11, font: F.m, align: 'CENTER', lh: 20 });
text(seg, 'reader/seg-off-t', 52, 3, 52, 20, '源码', { size: 11, color: C.t3, align: 'CENTER', lh: 20 });
text(rd, 'reader/copy', 536, 7, 14, 26, '⧉', { size: 12, color: C.t3, align: 'RIGHT', lh: 26 });
hline(rd, 'reader/line', 14, 40, 532);
text(rd, 'md/h1', 18, 52, 524, 26, 'agent-orchestration-advisor', { size: 17, font: F.sb, lh: 26 });
text(rd, 'md/p1', 18, 88, 524, 44, '设计多 agent 工作流：明确每个角色的边界、交接格式与监控点，适用于复杂任务需要并行拆分的场景。', { size: 13.5, color: '#D7DBE2', lh: 22 });
text(rd, 'md/h2', 18, 142, 524, 22, '何时使用', { size: 15, font: F.sb, lh: 22 });
text(rd, 'md/list', 18, 172, 524, 44, '• 任务可拆分为并行角色时\n• 需要清晰交接格式与监控点时', { size: 13.5, color: '#D7DBE2', lh: 22 });
box(rd, 'md/quote-bar', 18, 228, 2, 36, { fill: C.blue, r: 1 });
text(rd, 'md/quote', 28, 228, 504, 36, '每个角色只读取自己的上下文，交接面必须可序列化。', { size: 13, color: C.t2, lh: 18 });
text(rd, 'md/h2b', 18, 280, 524, 22, '交接格式', { size: 15, font: F.sb, lh: 22 });
const code = box(rd, 'md/code', 18, 312, 524, 124, { fill: '#151920', r: 8 });
text(code, 'md/code-text', 14, 10, 496, 108, '{\n  "roles": ["planner", "builder", "reviewer"],\n  "handoff": "json",\n  "monitor": ["task", "result", "cost"]\n}', { size: 11.5, font: F.code, color: '#B9C0CB', lh: 18 });
text(rd, 'md/p2', 18, 452, 524, 44, '每个角色的输出都带一条监控点记录，主流程据此决定是否继续或重排。', { size: 13.5, color: '#D7DBE2', lh: 22 });
text(rd, 'md/p3', 18, 500, 524, 44, '适合把「调研 → 拆解 → 实现 → 审查」这类长任务并行化。', { size: 13.5, color: '#D7DBE2', lh: 22 });
box(rd, 'reader/scrollbar', 542, 52, 3, 140, { fill: '#FFFFFF', fillOp: 0.12, r: 2 });
return { frame: fr.id, children: fr.children.length };
