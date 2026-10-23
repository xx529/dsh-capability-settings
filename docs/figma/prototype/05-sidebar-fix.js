// 05-sidebar-fix.js — 把克隆的 v5 sidebar 高亮从「多能力会话配置」改到「能力面板」
// 幂等：每次先隐藏 active-row、删除旧高亮、重建一个 sb-active-highlight，可反复执行。
const PAGE_NAME = 'Capability Panel · 升级原型 v6';
await figma.loadAllPagesAsync();
const page = figma.root.children.find((p) => p.name === PAGE_NAME);
if (!page) throw new Error('页面不存在：先执行 00-init.js');
await figma.setCurrentPageAsync(page);

// ---------- 精简 helper ----------
const F = { r: { family: 'PingFang SC', style: 'Regular' }, m: { family: 'PingFang SC', style: 'Medium' }, sb: { family: 'PingFang SC', style: 'Semibold' } };
for (const k of ['r', 'm', 'sb']) await figma.loadFontAsync(F[k]);
const rgb = (h) => { h = h.replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; };
const paint = (h, o) => ({ type: 'SOLID', color: rgb(h), opacity: o == null ? 1 : o });
function box(p, name, x, y, w, h, fill, r) {
  const n = figma.createFrame(); p.appendChild(n); n.name = name;
  n.x = x; n.y = y; n.resize(w, h); n.clipsContent = false;
  n.fills = fill ? [paint(fill)] : []; n.cornerRadius = r || 0; n.strokes = []; n.effects = [];
  return n;
}
function walk(n, out) { out.push(n); for (const c of n.children || []) walk(c, out); return out; }
function absOf(n, root) { let x = 0, y = 0, p = n; while (p && p !== root) { x += p.x; y += p.y; p = p.parent; } return { x, y }; }
function paintSmall(n) {
  if (n.type !== 'TEXT' && Array.isArray(n.fills) && n.width <= 20 && n.height <= 20) n.fills = [paint('#61AFEF', 0.9)];
  for (const c of n.children || []) paintSmall(c);
}

// ---------- 逐帧修复 ----------
const report = [];
for (const fr of page.children.filter((n) => n.type === 'FRAME')) {
  const sb = fr.children.find((c) => c.name === 'sidebar') || fr.children.find((c) => c.type === 'FRAME' && c.width >= 200 && c.height >= 800);
  if (!sb) { report.push({ frame: fr.name, sidebar: false }); continue; }
  const all = walk(sb, []);

  // 1) 隐藏 v5 原有高亮行（多能力会话配置）
  let hidden = 0;
  for (const n of all) if (n.name === 'active-row') { n.visible = false; hidden++; }

  // 2) 删掉上一次插入的高亮（幂等）
  for (const n of all) if (n.name === 'sb-active-highlight') n.remove();

  // 3) 找「能力面板」导航文本（按绝对 y 过滤，避开页头）
  const texts = all.filter((n) => n.type === 'TEXT' && (n.characters || '').includes('能力面板'));
  const withY = texts.map((n) => ({ n, a: absOf(n, sb) }));
  const pick = withY.find((o) => o.a.y >= 140 && o.a.y <= 320) || withY[0];
  let labelInfo = null, hl = null, dotCount = 0;

  if (pick) {
    const label = pick.n;
    labelInfo = { name: label.name, text: label.characters, y: Math.round(pick.a.y) };
    label.fills = [paint('#E3E6EA')];
    try { label.fontName = F.m; } catch (e) {}

    // 4) 高亮底：插在该行最外层容器的下方（z 序），确保文字在上
    let top = label;
    while (top.parent && top.parent !== sb) top = top.parent;
    const h = 30, w = 232;
    const y = Math.round(pick.a.y + (label.height || 22) / 2 - h / 2);
    const aTop = absOf(top, sb);
    const topFills = (top.fills || []).filter((f) => f.visible !== false && (f.opacity == null ? 1 : f.opacity) > 0.5);
    hl = box(sb, 'sb-active-highlight', 12, y, w, h, '#262B35', 8);
    hl.name = 'sb-active-highlight';
    try { hl.layoutPositioning = 'ABSOLUTE'; } catch (e) {}
    if (top !== sb && top.type === 'FRAME' && topFills.length) {
      // 行是有底色的 frame：放进行内最底层，避免被行底色盖住
      try { top.insertChild(0, hl); } catch (e) { top.appendChild(hl); }
      try { hl.layoutPositioning = 'ABSOLUTE'; } catch (e) {}
      hl.x = Math.round(12 - aTop.x); hl.y = Math.round(y - aTop.y);
    } else if (top && top.parent === sb) {
      const idx = sb.children.indexOf(top);
      try { sb.insertChild(idx < 0 ? 0 : idx, hl); } catch (e) {}
      const hi = sb.children.indexOf(hl), ti = sb.children.indexOf(top);
      if (ti >= 0 && (hi < 0 || hi > ti)) { try { sb.insertChild(Math.max(0, ti), hl); } catch (e) {} }
      hl.x = 12; hl.y = y;
    } else { sb.appendChild(hl); hl.x = 12; hl.y = y; }
  }

  // 5) 「能力面板」行小方块图标染主蓝（只染 ≤20px 的小节点，避免整行变蓝）
  const dot = all.find((n) => n.name === 'menu-dot-能力面板') || all.find((n) => n.name.includes('menu-dot') && n.name.includes('能力面板'));
  if (dot) { paintSmall(dot); dotCount++; }

  report.push({ frame: fr.name, sidebar: true, hiddenActive: hidden, label: labelInfo, highlight: hl ? { parent: hl.parent.name, x: hl.x, y: hl.y } : null, dot: dotCount });
}
return { page: page.id, frames: report };
