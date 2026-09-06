import os, json
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

OUT = os.environ.get("BRAND_OUT", "public/brand"); os.makedirs(OUT, exist_ok=True)
FONT = os.environ.get("PLEX_SANS_DIR", "/tmp/plex/ibm-plex-sans/fonts/complete/ttf") + "/IBMPlexSans-SemiBold.ttf"
P = dict(teal="#0E8C7E", teal_bright="#2EBFAE", teal_deep="#0B6F64", ink="#0F1F1D", paper="#F7F9F8", line="#D8E1DE", cell="#BFCFCA", cell_dark="#2A3F3B", white="#FFFFFF")

def text_paths(text, tracking_em=-0.02, font=None):
    f = TTFont(font or FONT); gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f["head"].unitsPerEm
    hhea = f["hhea"]; asc, desc = hhea.ascent, hhea.descent
    x = 0; paths = []
    for ch in text:
        g = cmap[ord(ch)]; pen = SVGPathPen(gs)
        tp = TransformPen(pen, (1, 0, 0, -1, x, 0))
        gs[g].draw(tp); paths.append(pen.getCommands())
        x += gs[g].width + tracking_em * upm
    return paths, x, upm, asc, desc

def mark_svg(size=100, lit="#0E8C7E", cell="#BFCFCA", r=None, x0=0, y0=0, s=1.0):
    c, gap = 19*s, 8*s; r = (2.0*s) if r is None else r
    out = []
    for row in range(4):
        for col in range(4):
            fill = lit if (row == 1 and col == 2) else cell
            out.append(f'<rect x="{x0+col*(c+gap):.2f}" y="{y0+row*(c+gap):.2f}" width="{c:.2f}" height="{c:.2f}" rx="{r:.2f}" fill="{fill}"/>')
    return "\n".join(out)

def write(name, svg): open(os.path.join(OUT, name), "w").write(svg)

for variant, lit, cell in [("light", P["teal"], P["cell"]), ("dark", P["teal_bright"], P["cell_dark"]), ("mono-ink", P["ink"], P["ink"]), ("mono-white", P["white"], P["white"])]:
    body = mark_svg(lit=lit, cell=cell)
    if variant.startswith("mono"):
        body = body.replace(f'fill="{cell}"/>', f'fill="{cell}" fill-opacity="0.3"/>')
        lines = body.split("\n"); lines[6] = lines[6].replace(' fill-opacity="0.3"', ""); body = "\n".join(lines)
    write(f"singlet-mark-{variant}.svg", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="singlet.bio mark">\n{body}\n</svg>')

paths, width, upm, asc, desc = text_paths("singlet", -0.02)
paths2, width2, _, _, _ = text_paths(".bio", -0.02)
scale = 100/upm
def wm_group(paths, fill, dx=0):
    return f'<g transform="translate({dx:.2f},0) scale({scale:.6f})" fill="{fill}">' + "".join(f'<path d="{d}"/>' for d in paths if d) + "</g>"
total_w = (width + width2) * scale; H = 100; base_y = asc*scale
def wordmark_svg(ink, teal):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_w:.1f} {H}" width="{total_w:.1f}" height="{H}" role="img" aria-label="singlet.bio">'
            f'<g transform="translate(0,{base_y:.2f})">{wm_group(paths, ink)}{wm_group(paths2, teal, width*scale)}</g></svg>')
write("singlet-wordmark-light.svg", wordmark_svg(P["ink"], P["teal"]))
write("singlet-wordmark-dark.svg", wordmark_svg(P["white"], P["teal_bright"]))
write("singlet-wordmark-mono-ink.svg", wordmark_svg(P["ink"], P["ink"]))
write("singlet-wordmark-mono-white.svg", wordmark_svg(P["white"], P["white"]))

def lockup_svg(lit, cell, ink, teal):
    mark = mark_svg(lit=lit, cell=cell, s=0.72, x0=0, y0=14); wm_scale = 0.78; wm_w = total_w * wm_scale
    wm = f'<g transform="translate(86,{18 + asc*scale*wm_scale:.2f}) scale({wm_scale})">{wm_group(paths, ink)}{wm_group(paths2, teal, width*scale)}</g>'
    W = 86 + wm_w
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} 100" width="{W:.1f}" height="100" role="img" aria-label="singlet.bio">{mark}{wm}</svg>'
write("singlet-lockup-light.svg", lockup_svg(P["teal"], P["cell"], P["ink"], P["teal"]))
write("singlet-lockup-dark.svg", lockup_svg(P["teal_bright"], P["cell_dark"], P["white"], P["teal_bright"]))

def stacked_svg(lit, cell, ink, teal):
    wm_scale = 0.9; wm_w = total_w*wm_scale; W = max(wm_w, 100) + 40
    mark = mark_svg(lit=lit, cell=cell, s=1.0, x0=(W-100)/2, y0=20)
    wm = f'<g transform="translate({(W-wm_w)/2:.2f},{150 + asc*scale*wm_scale:.2f}) scale({wm_scale})">{wm_group(paths, ink)}{wm_group(paths2, teal, width*scale)}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} 270" width="{W:.1f}" height="270" role="img" aria-label="singlet.bio">{mark}{wm}</svg>'
write("singlet-stacked-light.svg", stacked_svg(P["teal"], P["cell"], P["ink"], P["teal"]))
write("singlet-stacked-dark.svg", stacked_svg(P["teal_bright"], P["cell_dark"], P["white"], P["teal_bright"]))

write("favicon.svg", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128"><rect width="128" height="128" rx="24" fill="{P["ink"]}"/>{mark_svg(lit=P["teal_bright"], cell="#3A524D", s=0.84, x0=22, y0=22, r=2.5)}</svg>')
write("avatar-512.svg", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="{P["paper"]}"/>{mark_svg(lit=P["teal"], cell=P["cell"], s=3.2, x0=96, y0=96, r=8)}</svg>')
write("app-icon-dark.svg", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" rx="96" fill="{P["ink"]}"/>{mark_svg(lit=P["teal_bright"], cell="#3A524D", s=3.2, x0=96, y0=96, r=8)}</svg>')

REG = os.environ.get("PLEX_SANS_DIR", "/tmp/plex/ibm-plex-sans/fonts/complete/ttf") + "/IBMPlexSans-Regular.ttf"
MONO = os.environ.get("PLEX_MONO_DIR", "/tmp/plexmono/ibm-plex-mono/fonts/complete/ttf") + "/IBMPlexMono-Medium.ttf"
def line_paths(text, font, size, fill, x, y, tracking=0.0):
    ps, w, u, a, d = text_paths(text, tracking, font); sc = size/u
    return f'<g transform="translate({x},{y}) scale({sc:.6f})" fill="{fill}">' + "".join(f'<path d="{p}"/>' for p in ps if p) + "</g>"
og = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
<rect width="1200" height="630" fill="{P["ink"]}"/>
{mark_svg(lit=P["teal_bright"], cell="#2F4642", s=1.9, x0=80, y0=72, r=4)}
<g transform="translate(80,{300 + asc*scale:.2f})">{wm_group(paths, P["white"])}{wm_group(paths2, P["teal_bright"], width*scale)}</g>
{line_paths("Every public scRNA-seq study on GEO, reprocessed the same way.", REG, 30, "#CADCD8", 80, 468)}
{line_paths("Find it in plain English. Load it in one line. Free, CC0.", REG, 30, "#CADCD8", 80, 512)}
{line_paths("pip install git+https://github.com/Singlet-Bio/singlet", MONO, 22, P["teal_bright"], 80, 578)}
</svg>'''
write("og-default.svg", og)
json.dump(dict(total_w=total_w, upm=upm, asc=asc, desc=desc), open(os.path.join(OUT, "meta.json"), "w"))
print("ok", total_w)
