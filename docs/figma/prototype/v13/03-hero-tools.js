// 03-hero-tools.js — v13 帧 03：首屏 hero · Tools（插件级开关，卡片形制同 Skills）
// 结构：三域 Tab（Skills / MCP / Tools，Tools 激活）+ 行 3 控制条 + 插件卡片网格（4 列）
// 卡片：插件名（Menlo 单行省略）+ 描述「17 个工具 · 插件注入」+ `插件` 紫标签 + 整插件开关
// 计数：Tab 3/6（已启用插件 / 全部插件）；控制条 16/30（8+5+3 / 15+9+6）
// 前置：00-init.js；幂等（先删 base-* 与 v13/，再从 88:8797 克隆后重绘）
const PAGE_NAME = 'Capability Panel · 全局开关与派生 v13';
const FRAME_NAME = '03 · 首屏 hero · Tools（插件级）';
const BASE_ID = '88:8797';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

const C = { panel: '#23272F', rail: '#1B1F27', card: '#222A35', cardOff: '#1B1F27', tabOn: '#2E3540', blue: '#61AFEF', blueLt: '#8FBCFF', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794', purple: '#B79CFF', warn: '#D19A66' };
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

const page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME);
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);
const fr = page.children.find((n) => n.type === 'FRAME' && n.name === FRAME_NAME);
if (!fr) throw new Error('画框不存在：' + FRAME_NAME);
for (const n of [...fr.findAll((n) => String(n.name || '').indexOf('v13/') === 0)]) { if (!n.removed) n.remove(); }
for (const c of [...fr.children]) c.remove();
const src = await figma.getNodeByIdAsync(BASE_ID);
const base = src.clone(); base.name = 'base-88-8797';
fr.appendChild(base); base.x = 0; base.y = 0;

const panel = fr.findOne((n) => n.name === 'capability-panel');
panel.resize(920, 356);

// 三域 Tab（Tools 激活）
const track = panel.findOne((n) => n.name === 'tabs');
track.resize(424, 28);
const skillsTab = track.findOne((n) => n.name === 'tab-skills-active');
const mcpTab = track.findOne((n) => n.name === 'tab-mcp');
const tabTools = box(track, 'tab-tools', 277, 3, 140, 22, { fill: C.tabOn, r: 7 });
text(tabTools, 'Tools', 10, 2, 56, 18, 'Tools', { size: 11.5, font: F.sb, color: C.t1, lh: 18 });
text(tabTools, '3 / 6', 68, 2, 56, 18, '3 / 6', { size: 11, font: F.m, color: C.blueLt, lh: 18 });
function setInactive(tabFrame) {
  tabFrame.fills = []; tabFrame.cornerRadius = 7;
  for (const c of tabFrame.children) {
    if (c.type !== 'TEXT') continue;
    const isCount = /\/|\d/.test(String(c.characters || ''));
    c.fontName = F.r; c.fills = [paint(isCount ? '#6F7787' : '#8F97A6')];
  }
}
setInactive(skillsTab); setInactive(mcpTab);
// 旧文案 MCP 服务器 → MCP
const mcpName = mcpTab.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('MCP') === 0);
if (mcpName) mcpName.characters = 'MCP';
const mcpCnt = mcpTab.findOne((n) => n.type === 'TEXT' && /\//.test(String(n.characters || '')));
if (mcpCnt) mcpCnt.characters = '5 / 9';
const hint = panel.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('自动触发默认关闭') === 0);
if (hint) { hint.characters = '自动触发默认关闭'; hint.resize(240, 28); hint.x = 470; hint.textAlignHorizontal = 'RIGHT'; }

// 行 3 控制条（范围 = Skills · MCP · Tools 三域整体）
const ctl = box(panel, 'v13/ctl', 14, 80, 892, 36, { fill: C.rail, r: 8 });
function pillBtn(p, name, x, y, w, h, label, o) {
  o = o || {};
  const n = box(p, name, x, y, w, h, { fill: o.fill, fillOp: o.fillOp, r: 6, stroke: o.stroke, strokeOp: o.strokeOp });
  text(n, name + '/t', 0, 0, w, h, label, { size: 11, font: F.m, color: o.color || C.t2, align: 'CENTER', lh: h });
  return n;
}
pillBtn(ctl, 'v13/ctl/btn-on', 10, 6, 64, 24, '全部开启', { fill: C.blue, fillOp: 0.12, stroke: C.blue, strokeOp: 0.35, color: C.blueLt });
pillBtn(ctl, 'v13/ctl/btn-off', 80, 6, 64, 24, '全部关闭', { stroke: '#FFFFFF', strokeOp: 0.14, color: '#C9CED8' });
text(ctl, 'v13/ctl/count', 152, 6, 100, 24, '已启用 16 / 30', { size: 11.5, font: F.m, color: C.t1, lh: 24 });
text(ctl, 'v13/ctl/scope', 258, 6, 150, 24, '仅当前会话 · 不改项目默认', { size: 10.5, color: C.t3, lh: 24 });
text(ctl, 'v13/ctl/derive-note', 420, 6, 170, 24, '派生 agent 整体继承三域', { size: 10.5, color: C.t3, lh: 24 });
text(ctl, 'v13/ctl/derive-label', 670, 6, 58, 24, '派生继承', { size: 11, color: C.t2, lh: 24 });
const seg = box(ctl, 'v13/ctl/seg', 736, 6, 146, 24, { fill: C.panel, r: 6, stroke: '#FFFFFF', strokeOp: 0.06 });
const segOn = box(seg, 'v13/ctl/seg-on', 3, 3, 70, 18, { fill: C.tabOn, r: 4 });
text(segOn, 'v13/ctl/seg-on-t', 0, 0, 70, 18, '继承', { size: 11, font: F.m, color: C.t1, align: 'CENTER', lh: 18 });
text(seg, 'v13/ctl/seg-off-t', 73, 3, 70, 18, '不继承', { size: 11, color: C.t3, align: 'CENTER', lh: 18 });

// ---------- 插件卡片（4 列，形制同 Skills） ----------
const template = panel.findOne((n) => n.name === 'card-数据分析');
for (const c of [...panel.children]) { if (String(c.name || '').indexOf('card-') === 0) c.visible = false; }
function tag(p, name, label, kind, x, y) {
  let fill, color;
  if (kind === 'plugin') { fill = [C.purple, 0.18]; color = C.purple; }
  else if (kind === 'warn') { fill = [C.warn, 0.14]; color = C.warn; }
  else { fill = ['#FFFFFF', 0.06]; color = C.t3; }
  const w = txtw(label, 10.5) + 10;
  const n = box(p, name, x, y, w, 16, { fill: fill[0], fillOp: fill[1], r: 4 });
  text(n, name + '/t', 0, 0, w, 16, label, { size: 10.5, font: F.m, color, align: 'CENTER', lh: 16 });
  return { n, w };
}
function pluginCard(x, y, title, desc, on, kind) {
  const c = template.clone();
  c.name = 'v13/plugin/' + title;
  panel.appendChild(c);
  c.x = x; c.y = y; c.visible = true;
  c.resize(215, 84);
  c.fills = on ? [paint(C.card)] : [paint(C.cardOff)];
  c.strokes = on ? [paint(C.blue, 0.2)] : [];
  const kids = [...c.children];
  const icon = kids.find((k) => k.type === 'FRAME' && k.width < 16 && k.fills && k.fills.length);
  const nameText = kids.find((k) => k.type === 'TEXT' && (k.fontName || {}).style === 'Semibold');
  const descText = kids.find((k) => k.type === 'TEXT' && (k.fontName || {}).style === 'Regular' && k !== nameText);
  const swNode = kids.find((k) => String(k.name || '').indexOf('switch') === 0);
  for (const k of kids) { if (k === icon || k === nameText || k === descText || k === swNode) continue; k.remove(); }
  if (nameText) { nameText.characters = title; nameText.fontName = kind === 'plugin' ? F.code : F.r; nameText.fontSize = 12; nameText.resize(150, 18); nameText.fills = [paint(on ? C.t1 : C.t2)]; }
  if (descText) { descText.characters = desc; descText.resize(195, 14); descText.y = 31; }
  tag(c, 'v13/tag/' + title, kind === 'plugin' ? '插件' : '未识别', kind, 10, 62);
  if (swNode) {
    swNode.fills = on ? [paint(C.blue)] : [paint('#FFFFFF', 0.13)];
    const knob = swNode.children[0];
    if (knob) { knob.x = on ? 14 : 2; knob.fills = [paint(on ? '#FFFFFF' : '#C9CED8')]; }
  }
  return c;
}
pluginCard(14, 126, 'dsh-univer-office', '13 个工具 · 插件注入', true, 'plugin');
pluginCard(239, 126, 'dsh-remote', '19 个工具 · 插件注入', true, 'plugin');
pluginCard(464, 126, 'dsh-im', '8 个工具 · 插件注入', true, 'plugin');
pluginCard(689, 126, 'dsh-better-sidebar', '1 个工具 · 插件注入', false, 'plugin');
pluginCard(14, 220, 'dsh-popout-window', '1 个工具 · 插件注入', false, 'plugin');
pluginCard(239, 220, 'dsh-diff-approval', '1 个工具 · 插件注入', false, 'plugin');

text(panel, 'v13/tools/hint', 14, 305, 892, 13,
  '插件级开关：关闭插件即关闭该插件全部工具；共 6 个插件（仅插件直接注册的非 MCP 工具）· 计数为示例口径',
  { size: 9.5, color: C.t3, lh: 13 });

// 底栏
const fl = panel.findOne((n) => n.name === 'footer-line'); if (fl) fl.y = 318;
const footText = panel.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('项已启用') >= 0);
if (footText) { footText.characters = '16 / 30 项已启用 · 其中 4 项来自插件 / DSH 内置 / Agent 预设 · 开关只作用于当前对话'; footText.resize(640, 16); footText.x = 14; footText.y = 326; }
const reset = panel.findOne((n) => n.name === 'reset-default'); if (reset) reset.y = 322;
const done = panel.findOne((n) => n.name === 'done'); if (done) done.y = 322;
const heroNote = fr.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('首屏默认展开') >= 0);
if (heroNote) heroNote.visible = false;
const oldNote = fr.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('点按立即决策') >= 0);
if (oldNote) oldNote.visible = false;
text(fr, 'v13/note', 276, 856, 1000, 16, '※ Tools 域：6 张插件卡片（4 + 2 两行）· 仅含插件直接注册的非 MCP 工具 · 开关按插件整体生效 · Tab 计数 3 / 6 · 计数为示例', { size: 10.5, color: C.t3, lh: 16 });

const out = { frame: fr.id, panel: panel.id, cards: panel.findAll((n) => String(n.name).indexOf('v13/plugin/') === 0).length };
console.log(JSON.stringify(out));
return out;