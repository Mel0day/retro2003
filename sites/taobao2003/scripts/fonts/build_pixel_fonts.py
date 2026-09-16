#!/usr/bin/env python3
"""
把文泉驿点阵宋体（WenQuanYi Bitmap Song）和 Liberation Sans 点阵 BDF 转成「像素方块轮廓」网页字体。

每个点阵像素变成一个 100 单位见方的方块（unitsPerEm = 像素尺寸 × 100），
字体按设计尺寸使用时，一个字体像素正好对应一个 CSS 像素，效果接近 Windows XP 上的 12px 宋体。

粗体模拟 Windows GDI 的「伪粗体」：点阵整体向右多描一个像素。

用法：
  pip install fonttools brotli
  python3 scripts/fonts/build_pixel_fonts.py <wqy-bitmapsong 源码目录> public/fonts

源字体许可：GPL v2 with font embedding exception，见 public/fonts/LICENSE-wqy-bitmapsong.txt。
本脚本即为生成的网页字体的「源代码」，一并以 GPL v2 发布。
"""
import os
import sys
import shutil
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

SRC = sys.argv[1] if len(sys.argv) > 1 else 'wqy-bitmapsong'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/fonts'
UNIT = 100

# 源文件：(文件名, 像素尺寸)
SONG = {12: 'wenquanyi_9pt.bdf', 13: 'wenquanyi_10pt.bdf', 14: 'wenquanyi_13px.bdf', 16: 'wenquanyi_12pt.bdf'}
SANS = {12: 'LiberationSans-9pt.bdf', 13: 'LiberationSans-10pt.bdf', 16: 'LiberationSans-12pt.bdf'}

# 字符切片：unicode-range 用连续区间，CSS 很短；区间内只收 GBK 能编码的字，控制体积
SLICES = {
    'latin': [(0x0000, 0x00FF), (0x0131, 0x0131), (0x0152, 0x0153), (0x02C6, 0x02DC), (0x2013, 0x2014), (0x2018, 0x201E), (0x2022, 0x2022), (0x2026, 0x2026), (0x20AC, 0x20AC), (0x2122, 0x2122)],
    'sym': [(0x0100, 0x0130), (0x0132, 0x0151), (0x0154, 0x02C5), (0x02DD, 0x2012), (0x2015, 0x2017), (0x201F, 0x2021), (0x2023, 0x2025), (0x2027, 0x20AB), (0x20AD, 0x2121), (0x2123, 0x33FF), (0xFE30, 0xFE6F), (0xFF00, 0xFFEF)],
    'han1': [(0x4E00, 0x6FFF)],
    'han2': [(0x7000, 0x9FFF)],
}


def in_slice(cp, name):
    return any(a <= cp <= b for a, b in SLICES[name])


def gbk_ok(cp):
    try:
        chr(cp).encode('gbk')
        return True
    except UnicodeEncodeError:
        return False


def parse_bdf(path):
    glyphs = {}
    props = {}
    with open(path, 'r', encoding='latin-1') as f:
        lines = f.read().split('\n')
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if line.startswith('FONT_ASCENT') or line.startswith('FONT_DESCENT') or line.startswith('PIXEL_SIZE'):
            k, v = line.split()[:2]
            props[k] = int(v)
        if line.startswith('STARTCHAR'):
            enc = None
            dw = None
            bbx = None
            rows = []
            i += 1
            while not lines[i].startswith('ENDCHAR'):
                l = lines[i]
                if l.startswith('ENCODING'):
                    enc = int(l.split()[1])
                elif l.startswith('DWIDTH'):
                    dw = int(l.split()[1])
                elif l.startswith('BBX'):
                    bbx = tuple(int(x) for x in l.split()[1:5])
                elif l.startswith('BITMAP'):
                    i += 1
                    while not lines[i].startswith('ENDCHAR'):
                        rows.append(lines[i].strip())
                        i += 1
                    break
                i += 1
            if enc is not None and enc >= 0 and bbx:
                w, h, xo, yo = bbx
                bits = []
                for r in rows[:h]:
                    val = int(r, 16) if r else 0
                    nbits = len(r) * 4
                    bits.append([(val >> (nbits - 1 - c)) & 1 for c in range(w)])
                glyphs[enc] = (dw if dw is not None else w, (w, h, xo, yo), bits)
        i += 1
    return glyphs, props


def fix_punctuation(glyphs):
    """按 GB/T 15834 和 Windows 宋体的习惯，全角冒号、分号靠左，与逗号对齐。"""
    comma = glyphs.get(0xFF0C)
    if not comma:
        return
    for cp in (0xFF1A, 0xFF1B):
        if cp in glyphs:
            dw, (w, h, xo, yo), bits = glyphs[cp]
            glyphs[cp] = (dw, (w, h, comma[1][2], yo), bits)


def embolden(bits):
    out = []
    for row in bits:
        w = len(row)
        nr = row + [0]
        for c in range(w):
            if row[c]:
                nr[c + 1] = 1
        out.append(nr)
    return out


def rects(bits):
    """把点阵合并成尽量少的矩形：先按行合并连续像素，再把上下相同的横条合并。"""
    active = {}
    done = []
    for r, row in enumerate(bits):
        runs = []
        c = 0
        w = len(row)
        while c < w:
            if row[c]:
                s = c
                while c < w and row[c]:
                    c += 1
                runs.append((s, c))
            else:
                c += 1
        nxt = {}
        for run in runs:
            if run in active:
                nxt[run] = active.pop(run)
            else:
                nxt[run] = r
        for run, start in active.items():
            done.append((run[0], run[1], start, r))
        active = nxt
    for run, start in active.items():
        done.append((run[0], run[1], start, len(bits)))
    return done  # (x0, x1, rowTop, rowBottomExclusive)


def draw(bbx, bits):
    w, h, xo, yo = bbx
    pen = TTGlyphPen(None)
    for x0, x1, rt, rb in rects(bits):
        # BDF 第 0 行在最上方；y 轴向上，最底行的底边在 yo
        top = yo + h - rt
        bottom = yo + h - rb
        X0, X1, T, B = (xo + x0) * UNIT, (xo + x1) * UNIT, top * UNIT, bottom * UNIT
        pen.moveTo((X0, B))
        pen.lineTo((X0, T))
        pen.lineTo((X1, T))
        pen.lineTo((X1, B))
        pen.closePath()
    return pen.glyph()


def build(glyphs, props, px, cps, family, bold, out_path):
    fb = FontBuilder(px * UNIT, isTTF=True)
    order = ['.notdef'] + [f'u{cp:04X}' for cp in cps]
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({cp: f'u{cp:04X}' for cp in cps})
    glyf = {'.notdef': TTGlyphPen(None).glyph()}
    metrics = {'.notdef': (px * UNIT // 2, 0)}
    for cp in cps:
        dw, bbx, bits = glyphs[cp]
        if bold:
            bits = embolden(bits)
            bbx = (bbx[0] + 1, bbx[1], bbx[2], bbx[3])
        g = draw(bbx, bits)
        glyf[f'u{cp:04X}'] = g
        metrics[f'u{cp:04X}'] = (dw * UNIT, bbx[2] * UNIT)
    fb.setupGlyf(glyf)
    fb.setupHorizontalMetrics(metrics)
    asc = props['FONT_ASCENT'] * UNIT
    desc = props['FONT_DESCENT'] * UNIT
    fb.setupHorizontalHeader(ascent=asc, descent=-desc, lineGap=0)
    style = 'Bold' if bold else 'Regular'
    fb.setupNameTable({'familyName': family, 'styleName': style, 'uniqueFontIdentifier': f'{family}-{style}',
                       'fullName': f'{family} {style}', 'psName': f'{family.replace(" ", "")}-{style}',
                       'version': 'Version 1.000', 'licenseDescription': 'GPL v2 with font embedding exception'})
    fb.setupOS2(sTypoAscender=asc, sTypoDescender=-desc, sTypoLineGap=0, usWinAscent=asc, usWinDescent=desc,
                fsType=0, usWeightClass=700 if bold else 400, fsSelection=0x20 if bold else 0x40)
    fb.setupPost(keepGlyphNames=False)
    fb.setupMaxp()
    fb.font['head'].macStyle = 1 if bold else 0
    fb.font.flavor = 'woff2'
    fb.save(out_path)
    return os.path.getsize(out_path)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    total = 0
    jobs = [('song', px, f) for px, f in SONG.items()] + [('sans', px, f) for px, f in SANS.items()]
    for kind, px, fname in jobs:
        glyphs, props = parse_bdf(os.path.join(SRC, fname))
        if kind == 'song':
            fix_punctuation(glyphs)
        slice_names = ['latin'] if kind == 'sans' else list(SLICES.keys())
        only = os.environ.get('ONLY_SLICES')
        if only:
            slice_names = [n for n in slice_names if n in only.split(',')]
        for sname in slice_names:
            cps = sorted(cp for cp in glyphs if in_slice(cp, sname) and cp >= 0x20 and (sname == 'latin' or gbk_ok(cp)))
            if kind == 'song' and sname == 'latin':
                cps = [cp for cp in cps if cp < 0x2000 or cp in glyphs]
            if not cps:
                continue
            for bold in (False, True):
                name = f'{kind}{px}-{sname}{"-b" if bold else ""}.woff2'
                size = build(glyphs, props, px, cps, f'XHS {kind.title()} {px}', bold, os.path.join(OUT, name))
                total += size
                manifest.append((kind, px, sname, bold, name, len(cps), size))
                print(f'{name:28s} {len(cps):6d} 字  {size / 1024:8.1f} KB')
    print(f'合计 {total / 1024 / 1024:.2f} MB')
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'manifest.tsv'), 'w') as f:
        for row in manifest:
            f.write('\t'.join(str(x) for x in row) + '\n')
    shutil.copy(os.path.join(SRC, 'COPYING'), os.path.join(OUT, 'LICENSE-wqy-bitmapsong.txt'))


if __name__ == '__main__':
    main()
