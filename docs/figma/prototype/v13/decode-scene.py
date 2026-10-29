#!/usr/bin/env python3
"""decode-scene.py — 把 prototype/v13/export-scene.js 的紧凑结构还原成 import_scene 契约。

用法：
  python3 docs/figma/prototype/v13/decode-scene.py <compact.json> <out.scene.json> [expected_nodes]

compact 结构（见 export-scene.js）：
  node = { t: 类型码, n: 名称, x?, y?, L?: 自动布局, w, h, f?: 填充串, s?: 描边串, sw?, sa?, cr?, cl?,
           tx?: 文本, c?: 子节点[] }
  颜色串： "#rrggbb" 或 "#rrggbb/opacity"，多个用逗号分隔。
输出：{ nodes: [FRAME] }，与 docs/figma/tools/export-scene.js 的契约一致。
"""
import json
import sys

TYPE_BACK = {
    'F': 'FRAME', 'T': 'TEXT', 'R': 'RECTANGLE', 'E': 'ELLIPSE', 'C': 'COMPONENT',
    'S': 'SECTION', 'Y': 'STICKY', 'H': 'SHAPE_WITH_TEXT',
}


def parse_solid(spec):
    items = []
    for part in spec.split(','):
        if not part:
            continue
        color, _, opacity = part.partition('/')
        r = int(color[1:3], 16) / 255.0
        g = int(color[3:5], 16) / 255.0
        b = int(color[5:7], 16) / 255.0
        item = {'type': 'SOLID', 'color': {'r': r, 'g': g, 'b': b}, 'opacity': float(opacity) if opacity else 1}
        items.append(item)
    return items


def convert(node):
    props = {'name': node['n']}
    if 'L' in node:
        lay = node['L']
        props['layoutMode'] = lay['m']
        props['primaryAxisSizingMode'] = lay['p']
        props['counterAxisSizingMode'] = lay['c']
        props['itemSpacing'] = lay['g']
        props['paddingTop'] = lay['pt']
        props['paddingBottom'] = lay['pb']
        props['paddingLeft'] = lay['pl']
        props['paddingRight'] = lay['pr']
        props['primaryAxisAlignItems'] = lay['pa']
        props['counterAxisAlignItems'] = lay['ca']
    else:
        props['x'] = node['x']
        props['y'] = node['y']
    props['width'] = node['w']
    props['height'] = node['h']
    if 'f' in node:
        props['fills'] = parse_solid(node['f'])
    if 's' in node:
        props['strokes'] = parse_solid(node['s'])
        props['strokeWeight'] = node['sw']
        props['strokeAlign'] = node['sa']
    if 'cr' in node:
        props['cornerRadius'] = node['cr']
    if node.get('cl'):
        props['clipsContent'] = True
    if 'tx' in node:
        tx = node['tx']
        props['characters'] = tx['c']
        props['fontName'] = {'family': tx['f'], 'style': tx['y']}
        props['fontSize'] = tx['s']
        props['textAutoResize'] = tx['ar']
        if 'lh' in tx:
            props['lineHeight'] = {'unit': 'PIXELS', 'value': tx['lh']}
        if 'ls' in tx:
            props['letterSpacing'] = {'unit': 'PIXELS', 'value': tx['ls']}
        if 'ah' in tx:
            props['textAlignHorizontal'] = tx['ah']
        if 'av' in tx:
            props['textAlignVertical'] = tx['av']
    kids = node.get('c')
    if kids:
        props['children'] = [convert(k) for k in kids]
    return {'type': TYPE_BACK[node['t']], 'props': props}


def count(node):
    n = 1
    for k in node.get('c', []):
        n += count(k)
    return n


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    src, dst = sys.argv[1], sys.argv[2]
    expected = int(sys.argv[3]) if len(sys.argv) > 3 else None
    with open(src, 'r', encoding='utf-8') as fh:
        root = json.load(fh)
    nodes = count(root)
    if expected is not None and nodes != expected:
        raise SystemExit(f'节点数不一致：decoded={nodes} expected={expected}')
    scene = {'nodes': [convert(root)]}
    with open(dst, 'w', encoding='utf-8') as fh:
        json.dump(scene, fh, ensure_ascii=False, separators=(',', ':'))
    import os
    print(json.dumps({'out': dst, 'nodes': nodes, 'bytes': os.path.getsize(dst)}, ensure_ascii=False))


if __name__ == '__main__':
    main()