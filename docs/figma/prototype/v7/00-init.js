// 00-init.js — v7：建页「Capability Panel · 交互原型 v7」+ 2 画框 + 克隆 v5 sidebar，并修正侧栏当前页高亮
const PAGE_NAME = 'Capability Panel · 交互原型 v7';
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
const C = { bg: '#1E222B', panel: '#23272F', t1: '#E3E6EA', t2: '#9DA5B4', t3: '#7F8794' };

// ---------- 精简 helper ----------
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
function walk(n, out) { out.push(n); for (const c of n.children || []) walk(c, out); return out; }
function absOf(n, root) { let x = 0, y = 0, p = n; while (p && p !== root) { x += p.x; y += p.y; p = p.parent; } return { x, y }; }
function paintSmall(n) {
  if (n.type !== 'TEXT' && Array.isArray(n.fills) && n.width <= 20 && n.height <= 20) n.fills = [paint('#61AFEF', 0.9)];
  for (const c of n.children || []) paintSmall(c);
}

// ---------- 页面 ----------
let page = figma.root.children.find((p) => p.name === PAGE_NAME);
if (!page) { page = figma.createPage(); page.name = PAGE_NAME; }
await figma.setCurrentPageAsync(page);
for (const c of [...page.children]) c.remove();

// ---------- 页标题 / 副标题 ----------
text(page, 'page-title', 0, 0, 900, 40, '能力面板 · 交互原型 v7', { size: 30, font: F.sb, color: '#E8EAF0', lh: 40 });
text(page, 'page-subtitle', 0, 48, 1200, 24,
  '工作区列表从中间列移入左侧「全局 / 项目」导航：左 ScopeNav（全局 / 项目 / 工作区）· 中 技能｜MCP 列表 · 右 详情',
  { size: 14, color: '#99A1B0', lh: 24 });

// ---------- 克隆 sidebar + 修正「能力面板」当前页高亮 ----------
async function cloneSidebar(fr) {
  let sb = null;
  try {
    const src = await figma.getNodeByIdAsync('4:8');
    sb = src.clone(); sb.name = 'sidebar';
    fr.appendChild(sb); sb.x = 0; sb.y = 0;
  } catch (e) {
    sb = box(fr, 'sidebar-missing', 0, 0, 256, 900, { fill: '#191C22' });
    text(sb, 'sidebar-missing-label', 24, 400, 208, 80, 'v5 sidebar (4:8) 克隆失败', { size: 12, color: C.t3 });
    return sb;
  }
  const all = walk(sb, []);
  for (const n of all) if (n.name === 'active-row') n.visible = false;
  for (const n of all) if (n.name === 'sb-active-highlight') n.remove();
  const texts = all.filter((n) => n.type === 'TEXT' && (n.characters || '').includes('能力面板'));
  const cand = texts.map((n) => ({ n, a: absOf(n, sb) })).find((o) => o.a.y >= 140 && o.a.y <= 320);
  if (cand) {
    const label = cand.n;
    label.fills = [paint('#E3E6EA')];
    try { label.fontName = F.m; } catch (e) {}
    let top = label;
    while (top.parent && top.parent !== sb) top = top.parent;
    const h = 30, y = Math.round(cand.a.y + (label.height || 22) / 2 - h / 2);
    const hl = box(sb, 'sb-active-highlight', 12, y, 232, h, '#262B35', 8);
    try { hl.layoutPositioning = 'ABSOLUTE'; } catch (e) {}
    const topFills = (top.fills || []).filter((f) => f.visible !== false && (f.opacity == null ? 1 : f.opacity) > 0.5);
    if (top !== sb && top.type === 'FRAME' && topFills.length) {
      try { top.insertChild(0, hl); } catch (e) { top.appendChild(hl); }
      const aTop = absOf(top, sb);
      try { hl.layoutPositioning = 'ABSOLUTE'; } catch (e) {}
      hl.x = Math.round(12 - aTop.x); hl.y = Math.round(y - aTop.y);
    } else if (top && top.parent === sb) {
      let idx = sb.children.indexOf(top);
      try { sb.insertChild(idx < 0 ? 0 : idx, hl); } catch (e) {}
      hl.x = 12; hl.y = y;
    } else { sb.appendChild(hl); hl.x = 12; hl.y = y; }
    hl.name = 'sb-active-highlight';
  }
  const dot = all.find((n) => n.name === 'menu-dot-能力面板') || all.find((n) => n.name.includes('menu-dot') && n.name.includes('能力面板'));
  if (dot) paintSmall(dot);
  return sb;
}

// ---------- 2 个画框 ----------
const defs = [['01 · 技能 · 项目', 0, 150], ['02 · MCP · 项目', 1520, 150]];
const frames = [];
for (const [name, x, y] of defs) {
  const fr = box(page, name, x, y, 1440, 900, { fill: C.bg, r: 0 });
  fr.clipsContent = true;
  text(page, name + ' · 帧标题', x, y - 34, 1100, 22, name, { size: 17, font: F.sb, color: '#DEE3EC', lh: 22 });
  await cloneSidebar(fr);
  frames.push({ name, id: fr.id });
}
return { pageId: page.id, frames, fonts: Object.keys(F) };
