// 02-hero-mcp.js — v13 帧 02：首屏 hero · MCP 服务器（真实来源：配置 server + 插件命名空间合成行）
// 真实数据（取证 E3）：配置 MCP = AnySearch / context7 / tavily …（标签 全局/项目）；
// figma 由 dsh-to-figma 直接注册 mcp__figma__*、无 mcp-client 实例 ⇒ 设计上合成「插件 + dsh-to-figma」一行。
// 前置：00-init.js；幂等（先删 base-* 与 v13/，再从 88:8797 克隆后重绘）
const PAGE_NAME = 'Capability Panel · 全局开关与派生 v13';
const FRAME_NAME = '02 · 首屏 hero · MCP（插件来源）';
const BASE_ID = '88:8797';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

const C = { panel: '#23272F', rail: '#1B1F27', card: '#222A35', cardOff: '#1B1F27', tabOn: '#2E3540', blue: '#61AFEF', blueLt: '#8FBCFF', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794', ink: '#0F1115', purple: '#B79CFF' };
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
  return n;
}
function txtw(s, fs) { let w = 0; for (const ch of s) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? fs : fs * 0.55; return Math.ceil(w); }
const page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME);
if (!page) throw new Error('页面不存在');
await figma.setCurrentPageAsync(page);
const fr = page.children.find((n) => n.type === 'FRAME' && n.name === FRAME_NAME);
for (const n of [...fr.findAll((n) => String(n.name || '').indexOf('v13/') === 0)]) { if (!n.removed) n.remove(); }
for (const c of [...fr.children]) c.remove();
const src = await figma.getNodeByIdAsync(BASE_ID);
const base = src.clone(); base.name = 'base-88-8797';
fr.appendChild(base); base.x = 0; base.y = 0;

const panel = fr.findOne((n) => n.name === 'capability-panel');
panel.resize(920, 300);

// 三域 Tab（MCP 激活）
const track = panel.findOne((n) => n.name === 'tabs');
const mcpName02 = track.findOne((n) => n.name === 'tab-mcp');
const mcpNameText = mcpName02 && mcpName02.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('MCP') === 0);
if (mcpNameText) mcpNameText.characters = 'MCP';
const skillsTab02 = track.findOne((n) => n.name === 'tab-skills-active');
const sc02 = skillsTab02 && skillsTab02.findOne((n) => n.type === 'TEXT' && /\//.test(String(n.characters || '')));
if (sc02) sc02.characters = '8 / 15';
track.resize(424, 28);
const skillsTab = track.findOne((n) => n.name === 'tab-skills-active');
const mcpTab = track.findOne((n) => n.name === 'tab-mcp');
const tabTools = box(track, 'tab-tools', 277, 3, 140, 22, { fill: null, r: 7 });
text(tabTools, 'Tools', 10, 2, 56, 18, 'Tools', { size: 11.5, color: C.t3, lh: 18 });
text(tabTools, '3 / 6', 68, 2, 56, 18, '3 / 6', { size: 11, color: '#6F7787', lh: 18 });
function setActive(tabFrame, active) {
  tabFrame.fills = active ? [paint(C.tabOn)] : [];
  tabFrame.cornerRadius = 7;
  for (const c of tabFrame.children) {
    if (c.type !== 'TEXT') continue;
    const isCount = /\/|\d/.test(String(c.characters || ''));
    c.fontName = active ? (isCount ? F.m : F.sb) : F.r;
    c.fills = [paint(active ? (isCount ? C.blueLt : C.t1) : (isCount ? '#6F7787' : '#8F97A6'))];
  }
}
setActive(skillsTab, false); setActive(mcpTab, true); setActive(tabTools, false);
const mcpCnt = mcpTab.findOne((n) => n.type === 'TEXT' && /\//.test(String(n.characters || '')));
if (mcpCnt) mcpCnt.characters = '5 / 9';
const hint = panel.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('自动触发默认关闭') === 0);
if (hint) { hint.characters = '自动触发默认关闭'; hint.resize(240, 28); hint.x = 470; hint.textAlignHorizontal = 'RIGHT'; }

// 行 3 控制条
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

// ---------- MCP 卡片（真实来源） ----------
const template = panel.findOne((n) => n.name === 'card-数据分析');
for (const c of [...panel.children]) { if (String(c.name || '').indexOf('card-') === 0) c.visible = false; }
function tag(p, name, label, kind, x, maxW) {
  let fill, color, font = F.m, size = 10.5;
  if (kind === 'project') { fill = [C.blue, 0.10]; color = C.blue; }
  else if (kind === 'global') { fill = ['#FFFFFF', 0.06]; color = C.t2; }
  else if (kind === 'plugin') { fill = [C.purple, 0.18]; color = C.purple; }
  else if (kind === 'channel') { fill = ['#FFFFFF', 0.06]; color = C.t3; font = F.code; size = 10; }
  else { fill = ['#FFFFFF', 0.06]; color = C.t3; }
  let w = (font === F.code ? Math.ceil(label.length * size * 0.62) : txtw(label, size)) + 10;
  const capped = maxW != null && w > maxW;
  if (capped) w = maxW;
  const n = box(p, name, x, 62, w, 16, { fill: fill[0], fillOp: fill[1], r: 4 });
  const t = text(n, name + '/t', 0, 0, w, 16, label, { size, font, color, align: 'CENTER', lh: 16 });
  if (capped) { try { t.textTruncation = 'ENDING'; } catch (e) {} }
  return { n, w };
}
function mcpCard(name, x, title, desc, tags, on, disabled) {
  const c = template.clone();
  c.name = 'v13/mcp/' + name;
  panel.appendChild(c);
  c.x = x; c.y = 126; c.visible = true;
  c.fills = on ? [paint(C.card)] : [paint(C.cardOff)];
  c.strokes = on ? [paint(C.blue, 0.2)] : [];
  const kids = [...c.children];
  const icon = kids.find((k) => k.type === 'FRAME' && k.width < 16 && k.fills && k.fills.length);
  const nameText = kids.find((k) => k.type === 'TEXT' && (k.fontName || {}).style === 'Semibold');
  const descText = kids.find((k) => k.type === 'TEXT' && (k.fontName || {}).style === 'Regular' && k !== nameText);
  const swNode = kids.find((k) => String(k.name || '').indexOf('switch') === 0);
  for (const k of kids) { if (k === icon || k === nameText || k === descText || k === swNode) continue; k.remove(); }
  if (nameText) { nameText.characters = title; nameText.resize(150, 18); }
  if (descText) { descText.characters = desc; descText.resize(195, 14); descText.y = 31; }
  let tx = 10;
  tags.forEach((t, i) => {
    const isLast = i === tags.length - 1;
    const cap = isLast && tags.length > 1 ? Math.min(96, 195 - tx) : null;
    const r = tag(c, 'v13/tag/' + name + '/' + i, t.label, t.kind, tx, cap);
    tx += r.w + 4;
  });
  if (swNode) {
    const knob = swNode.children[0];
    swNode.fills = on ? [paint(C.blue)] : [paint('#FFFFFF', 0.13)];
    if (knob) { knob.x = on ? 14 : 2; knob.fills = [paint(on ? '#FFFFFF' : '#C9CED8')]; }
    if (disabled) { swNode.fills = [paint('#FFFFFF', 0.06)]; if (knob) { knob.x = 2; knob.fills = [paint(C.t3)]; } }
  }
  return c;
}
mcpCard('figma', 14, 'figma', '17 个工具 · 插件命名空间合成', [{ label: '插件', kind: 'plugin' }, { label: 'dsh-to-figma', kind: 'channel' }], true, false);
mcpCard('anysearch', 239, 'AnySearch', '4 个工具 · 已挂载', [{ label: '全局', kind: 'global' }], true, false);
mcpCard('context7', 464, 'context7', '2 个工具 · 已挂载', [{ label: '全局', kind: 'global' }], true, false);
mcpCard('tavily', 689, 'tavily', '5 个工具 · 会话内关闭', [{ label: '全局', kind: 'global' }], false, false);

text(panel, 'v13/mcp/hint', 14, 224, 880, 20,
  '插件自注册的 mcp__<x>__* 命名空间合成一行来源（插件 + 插件名）；配置文件 MCP 仍显示「全局 / 项目」；无插件名降级「外部注入」。',
  { size: 10.5, color: C.t3, lh: 20 });

const fl = panel.findOne((n) => n.name === 'footer-line'); if (fl) fl.y = 262;
const footText = panel.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('项已启用') >= 0);
if (footText) { footText.characters = '16 / 30 项已启用 · 其中 4 项来自插件 / DSH 内置 / Agent 预设 · 开关只作用于当前对话'; footText.resize(640, 16); footText.x = 14; footText.y = 270; }
const reset = panel.findOne((n) => n.name === 'reset-default'); if (reset) reset.y = 266;
const done = panel.findOne((n) => n.name === 'done'); if (done) done.y = 266;
const heroNote = fr.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('首屏默认展开') >= 0);
if (heroNote) heroNote.visible = false;
const oldNote = fr.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('点按立即决策') >= 0);
if (oldNote) oldNote.visible = false;
text(fr, 'v13/note', 276, 856, 1000, 16,
  '※ MCP 来源：「插件」+「插件名」两枚标签（第二枚 max-width 96px 省略、hover 全名）；配置来源保留 全局 / 项目；示例 9 个（8 配置 + 1 合成）',
  { size: 10.5, color: C.t3, lh: 16 });

const out = { frame: fr.id, panel: panel.id, cards: panel.findAll((n) => String(n.name).indexOf('v13/mcp/') === 0 && n.type === 'FRAME').length };
console.log(JSON.stringify(out));
return out;