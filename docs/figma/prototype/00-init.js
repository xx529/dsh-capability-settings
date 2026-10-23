// 00-init.js — 建页 + 4 画框 + 克隆 v5 sidebar（幂等，可反复执行）
// 执行：use_figma（普通 JS，顶部 await 可用，结尾 return）
const PAGE_NAME = 'Capability Panel · 升级原型 v6';
await figma.loadAllPagesAsync();

// ---------- 字体 ----------
const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

// ---------- 视觉常量 ----------
const C = { bg: '#1E222B', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794' };

// ---------- 精简 helper ----------
const rgb = (h) => { h = h.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; };
const paint = (h, o) => ({ type: 'SOLID', color: rgb(h), opacity: o == null ? 1 : o });
function box(p, name, x, y, w, h, o) {
  o = o || {};
  const n = figma.createFrame(); p.appendChild(n); n.name = name;
  n.x = x; n.y = y; n.resize(w, h); n.clipsContent = o.clip !== false;
  n.fills = o.fill ? [paint(o.fill, o.fillOp)] : [];
  n.cornerRadius = o.r || 0;
  n.strokes = o.stroke ? [paint(o.stroke, o.strokeOp)] : [];
  n.strokeWeight = 1; n.strokeAlign = 'INSIDE';
  n.effects = [];
  return n;
}
function txtw(s, fs) { let w = 0; for (const ch of s) w += /[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? fs : fs * 0.55; return Math.ceil(w); }
function text(p, name, x, y, w, h, chars, o) {
  o = o || {};
  const n = figma.createText(); p.appendChild(n); n.name = name;
  n.fontName = o.font || F.r;
  n.fontSize = o.size || 13.5;
  n.lineHeight = { value: o.lh || Math.round((o.size || 13.5) * 1.55), unit: 'PIXELS' };
  n.fills = [paint(o.color || C.t1)];
  n.textAutoResize = 'NONE';
  n.characters = chars;
  n.resize(w, h);
  n.x = x; n.y = y;
  n.textAlignHorizontal = o.align || 'LEFT';
  n.textAlignVertical = o.valign || 'CENTER';
  if (o.ls) { try { n.letterSpacing = { value: o.ls, unit: 'PIXELS' }; } catch (e) {} }
  if (o.trunc) { try { n.textTruncation = 'ENDING'; } catch (e) {} }
  return n;
}
const hline = (p, name, x, y, w, op) => box(p, name, x, y, w, 1, { fill: '#FFFFFF', fillOp: op == null ? 0.06 : op, clip: false });

// ---------- 页面 ----------
let page = figma.root.children.find((p) => p.name === PAGE_NAME);
if (!page) { page = figma.createPage(); page.name = PAGE_NAME; }
await figma.setCurrentPageAsync(page);
for (const c of [...page.children]) c.remove();

// ---------- 克隆 v5 sidebar（4:8） ----------
async function cloneSidebar(fr) {
  try {
    const src = await figma.getNodeByIdAsync('4:8');
    const sb = src.clone(); sb.name = 'sidebar';
    fr.appendChild(sb); sb.x = 0; sb.y = 0;
    return true;
  } catch (e) {
    const ph = box(fr, 'sidebar-missing', 0, 0, 256, 900, { fill: '#191C22' });
    text(ph, 'sidebar-missing-label', 24, 400, 208, 80, 'v5 sidebar (4:8) 克隆失败', { size: 12, color: C.t3 });
    return false;
  }
}

// ---------- 页标题 / 副标题 ----------
text(page, 'page-title', 0, 0, 900, 40, '能力面板 · 升级原型 v6', { size: 30, font: F.sb, color: '#E8EAF0', lh: 40 });
text(page, 'page-subtitle', 0, 48, 1180, 24,
  '三件事：去掉快捷消息入口 · 技能可在面板内全文浏览（SKILL.md + 文件树）· 项目与全局同屏对照',
  { size: 14, color: '#99A1B0', lh: 24 });

// ---------- 4 个画框 ----------
const defs = [
  ['01 · 技能总览（双作用域同屏）', 0, 150],
  ['02 · 技能详情（SKILL.md + 文件树）', 1520, 150],
  ['03 · MCP 总览（三组）', 0, 1200],
  ['04 · MCP 详情（外部只读）', 1520, 1200],
];
const frames = [];
let sidebarMissing = 0;
for (const [name, x, y] of defs) {
  const fr = box(page, name, x, y, 1440, 900, { fill: C.bg, r: 0 });
  fr.clipsContent = true;
  text(page, name + ' · 帧标题', x, y - 34, 1100, 22, name, { size: 17, font: F.sb, color: '#DEE3EC', lh: 22 });
  if (!(await cloneSidebar(fr))) sidebarMissing++;
  frames.push({ name, id: fr.id });
}
return { pageId: page.id, frames, sidebarMissing, fonts: Object.keys(F) };
