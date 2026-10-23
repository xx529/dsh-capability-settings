// 00-init.js — v9「Jev 模型」原型：建/重置页 + 4 帧 + 克隆基准帧
// 执行顺序：00-init → 01-entry → 02-results → 03-loading → 04-config
// 说明：帧 01/02/03 克隆 v5 hero 4:7，帧 04 克隆 v8 技能项目 42:3376；克隆层命名 base-*
const PAGE_NAME = 'Capability Panel · Jev 模型 v9';
await figma.loadAllPagesAsync();

const F = {
  r: { family: 'PingFang SC', style: 'Regular' },
  m: { family: 'PingFang SC', style: 'Medium' },
  sb: { family: 'PingFang SC', style: 'Semibold' },
  code: { family: 'Menlo', style: 'Regular' },
};
for (const k of ['r', 'm', 'sb', 'code']) await figma.loadFontAsync(F[k]);

const C = { bg: '#1E222B', t3: '#7F8794', red: '#E06C75' };

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
  n.fills = [paint(o.color || '#E3E6EA')]; n.textAutoResize = 'NONE'; n.characters = chars;
  n.resize(w, h); n.x = x; n.y = y;
  n.textAlignHorizontal = o.align || 'LEFT'; n.textAlignVertical = o.valign || 'CENTER';
  return n;
}

// ---------- 页面 ----------
let page = figma.root.children.find((p) => p.type === 'PAGE' && p.name === PAGE_NAME);
if (!page) { page = figma.createPage(); page.name = PAGE_NAME; }
await figma.setCurrentPageAsync(page);
for (const c of [...page.children]) c.remove();

text(page, 'page-title', 0, 0, 960, 40, '能力面板 · Jev 模型 v9', { size: 30, font: F.sb, color: '#E8EAF0', lh: 40 });
text(page, 'page-subtitle', 0, 48, 1320, 24,
  '首屏「✦ 自动选择」入口 → 结果（阈值预勾选）→ 评分中 → 能力面板新增「Jev 模型」配置 Tab · 4 帧 1440×900',
  { size: 14, color: '#99A1B0', lh: 24 });

// ---------- 4 帧 + 克隆底座 ----------
const DEFS = [
  { name: '01 · 首屏 · 自动选择入口', x: 0, y: 150, base: '4:7' },
  { name: '02 · 自动选择 · 结果', x: 1520, y: 150, base: '4:7' },
  { name: '03 · 自动选择 · 评分中', x: 0, y: 1200, base: '4:7' },
  { name: '04 · 能力面板 · Jev 模型', x: 1520, y: 1200, base: '42:3376' },
];
const frames = [];
const warnings = [];
for (const d of DEFS) {
  const fr = box(page, d.name, d.x, d.y, 1440, 900, { fill: C.bg, clip: true });
  fr.clipsContent = true;
  text(page, d.name + ' · 帧标题', d.x, d.y - 34, 1100, 22, d.name, { size: 17, font: F.sb, color: '#DEE3EC', lh: 22 });
  try {
    const src = await figma.getNodeByIdAsync(d.base);
    if (!src) throw new Error('节点不存在 ' + d.base);
    const base = src.clone();
    base.name = 'base-' + d.base.replace(':', '-');
    fr.appendChild(base); base.x = 0; base.y = 0;
  } catch (e) {
    warnings.push(d.name + ': ' + e.message);
    text(fr, 'base-missing', 24, 24, 800, 40, '底稿克隆失败：' + d.base + ' · ' + e.message, { size: 12, color: C.red });
  }
  frames.push({ name: d.name, id: fr.id, base: d.base });
}

const out = { pageId: page.id, frames, warnings };
console.log(JSON.stringify(out));
return out;
