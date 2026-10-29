// 05-session-tab.js — v13 帧 05：会话顶部「能力」Tab 整页（宽屏 1080）
// 验证：三域 Tab + 行 3 控制条（全局开/关 + 派生继承）在整页形态与首屏完全一致
// 前置：00-init.js；幂等（先删 base-* 与 v13/，再从 88:9375 克隆后重绘）
const PAGE_NAME = 'Capability Panel · 全局开关与派生 v13';
const FRAME_NAME = '05 · 会话「能力」Tab 整页（宽屏）';
const BASE_ID = '88:9375';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

const C = { panel: '#23272F', rail: '#1B1F27', tabOn: '#2E3540', blue: '#61AFEF', blueLt: '#8FBCFF', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794', ink: '#0F1115', purple: '#B79CFF' };
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

const page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME);
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);
const fr = page.children.find((n) => n.type === 'FRAME' && n.name === FRAME_NAME);
if (!fr) throw new Error('画框不存在：' + FRAME_NAME);
for (const n of [...fr.findAll((n) => String(n.name || '').indexOf('v13/') === 0)]) { if (!n.removed) n.remove(); }
for (const c of [...fr.children]) c.remove();
const src = await figma.getNodeByIdAsync(BASE_ID);
const base = src.clone(); base.name = 'base-' + BASE_ID.replace(':', '-');
fr.appendChild(base); base.x = 0; base.y = 0;

const panel = fr.findOne((n) => n.name === 'capability-panel');
panel.x = 40; panel.y = 84; panel.resize(1080, 356);

// 头部右侧控件右移 +160（920 → 1080）
const search = panel.findOne((n) => n.name === 'search'); if (search) search.x = 880;
const manage = panel.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('管理全部') >= 0); if (manage) manage.x = 1006;

// 三域 Tab
const track = panel.findOne((n) => n.name === 'tabs');
track.resize(424, 28);
const mcpName05 = track.findOne((n) => n.name === 'tab-mcp');
const mcpNameText05 = mcpName05 && mcpName05.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('MCP') === 0);
if (mcpNameText05) mcpNameText05.characters = 'MCP';
const skillsTab05 = track.findOne((n) => n.name === 'tab-skills-active');
const mcpTab05 = track.findOne((n) => n.name === 'tab-mcp');
const skillsCnt = skillsTab05 && skillsTab05.findOne((n) => n.type === 'TEXT' && /\//.test(String(n.characters || '')));
if (skillsCnt) skillsCnt.characters = '8 / 15';
const mcpCnt = mcpTab05 && mcpTab05.findOne((n) => n.type === 'TEXT' && /\//.test(String(n.characters || '')));
if (mcpCnt) mcpCnt.characters = '5 / 9';
const tabTools = box(track, 'tab-tools', 277, 3, 140, 22, { fill: null, r: 7 });
text(tabTools, 'Tools', 10, 2, 56, 18, 'Tools', { size: 11.5, color: C.t3, lh: 18 });
text(tabTools, '3 / 6', 68, 2, 56, 18, '3 / 6', { size: 11, color: '#6F7787', lh: 18 });

// ---------- 行 3 控制条（与首屏同一控件 / 同一文案，仅加宽） ----------
const ctl = box(panel, 'v13/ctl', 14, 80, 1052, 36, { fill: C.rail, r: 8 });
function pillBtn(p, name, x, y, w, h, label, o) {
  o = o || {};
  const n = box(p, name, x, y, w, h, { fill: o.fill, fillOp: o.fillOp, r: 6, stroke: o.stroke, strokeOp: o.strokeOp });
  text(n, name + '/t', 0, 0, w, h, label, { size: 11, font: F.m, color: o.color || C.t2, align: 'CENTER', lh: h });
  return n;
}
pillBtn(ctl, 'v13/ctl/btn-on', 10, 6, 64, 24, '全部开启', { fill: C.blue, fillOp: 0.12, stroke: C.blue, strokeOp: 0.35, color: C.blueLt });
pillBtn(ctl, 'v13/ctl/btn-off', 80, 6, 64, 24, '全部关闭', { stroke: '#FFFFFF', strokeOp: 0.14, color: '#C9CED8' });
text(ctl, 'v13/ctl/count', 152, 6, 110, 24, '已启用 16 / 30', { size: 11.5, font: F.m, color: C.t1, lh: 24 });
text(ctl, 'v13/ctl/scope', 268, 6, 200, 24, '仅当前会话 · 不改项目默认', { size: 10.5, color: C.t3, lh: 24 });
text(ctl, 'v13/ctl/derive-note', 560, 6, 190, 24, '派生 agent 整体继承三域', { size: 10.5, color: C.t3, lh: 24 });
text(ctl, 'v13/ctl/derive-label', 830, 6, 58, 24, '派生继承', { size: 11, color: C.t2, lh: 24 });
const seg = box(ctl, 'v13/ctl/seg', 896, 6, 146, 24, { fill: C.panel, r: 6, stroke: '#FFFFFF', strokeOp: 0.06 });
const segOn = box(seg, 'v13/ctl/seg-on', 3, 3, 70, 18, { fill: C.tabOn, r: 4 });
text(segOn, 'v13/ctl/seg-on-t', 0, 0, 70, 18, '继承', { size: 11, font: F.m, color: C.t1, align: 'CENTER', lh: 18 });
text(seg, 'v13/ctl/seg-off-t', 73, 3, 70, 18, '不继承', { size: 11, color: C.t3, align: 'CENTER', lh: 18 });

// ---------- 卡片：4 列 × 250，两行 ----------
const cardXs = [14, 276, 538, 800];
const cards = panel.findAll((n) => String(n.name || '').indexOf('card-') === 0);
cards.forEach((c, i) => {
  c.x = cardXs[i % 4];
  c.y = i < 4 ? 126 : 220;
  c.resize(250, 84);
  const sw = c.findOne((n) => String(n.name || '').indexOf('switch') === 0);
  if (sw) sw.x = 210;
  const descText = c.findOne((n) => n.type === 'TEXT' && (n.fontName || {}).style === 'Regular');
  if (descText) descText.resize(230, 14);
});

// ---------- 底栏 ----------
const fl = panel.findOne((n) => n.name === 'footer-line'); if (fl) { fl.y = 318; fl.resize(1080, 1); }
const footText = panel.findOne((n) => n.type === 'TEXT' && String(n.characters || '').indexOf('项已启用') >= 0);
if (footText) { footText.characters = '16 / 30 项已启用 · 其中 4 项来自插件 / DSH 内置 / Agent 预设 · 开关只作用于当前对话'; footText.resize(720, 16); footText.x = 14; footText.y = 326; }
const reset = panel.findOne((n) => n.name === 'reset-default'); if (reset) reset.x = 958; if (reset) reset.y = 322;

// ---------- 整页说明（面板下方） ----------
const notes = fr.findAll((n) => n.type === 'TEXT' && n.parent && n.parent.name === 'main' && n.y >= 400);
const noteSpecs = [
  '进入「能力」Tab 时输入框隐藏，切回其它 Tab 恢复；内容右侧留出外壳浮动控件安全区',
  '宽屏 1080：三域 Tab + 本会话控制条（全局开/关 + 派生继承）与首屏同一控件、同一文案；容器 ≥1180 时卡片 5 列',
  'MCP 来源 =「插件」+「插件名」两枚标签；Tools按插件分组，无法 restrict 的项降级只读（原因 tooltip），不参与批量',
];
let ni = 0;
for (const n of notes) {
  if (ni >= noteSpecs.length) break;
  n.characters = noteSpecs[ni]; n.resize(1000, 15); n.x = 152; n.y = 470 + ni * 22;
  ni++;
}
for (const n of [...fr.findAll((n) => n.name === 'v13/note/impl')]) { if (!n.removed) n.remove(); }
const mainNote = fr.findOne((n) => n.name === 'main');
text(mainNote, 'v13/note/impl', 152, 536, 1000, 16, '※ 实现约束：1080 容器固定 4 列（5 列仅容器 >1180 时可选）；派生继承控件为 R2 设计提案、本版零渲染', { size: 10, color: C.t3, lh: 15 });
text(fr, 'v13/note', 276, 860, 900, 16, '※ 整页「能力」Tab：三域 Tab + 全局开关 + 派生继承与首屏一致（同一组件、同一文案）；计数为示例口径', { size: 10.5, color: C.t3, lh: 16 });

const out = { frame: fr.id, panel: panel.id, control: ctl.id, cards: cards.length };
console.log(JSON.stringify(out));
return out;