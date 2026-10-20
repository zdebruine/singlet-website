"""Render the home page demo GIF (about 33 s): Python, then R, then Claude, each with time to read.

Every number and file name comes from the live catalog as of 2026-10-19: GSE138867 (cells per sample, the
layers in its file) and the "microglia in the aging mouse brain" search. Nothing is invented. Re-run after the
data changes:

    python scripts/brand/make_hero_demo.py

Writes public/demo/singlet-demo.gif and public/demo/singlet-demo-poster.png. Needs Pillow and the Segoe UI /
Consolas fonts that ship with Windows.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "demo"

W, H = 960, 540
STEP = 0.08  # seconds per frame (80 ms)
SCENE = 11.0  # seconds per scene
FADE = 0.5

FONT_DIR = Path(r"C:\Windows\Fonts")


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / name), size)


UI_SM = font("segoeui.ttf", 15)
UI_B = font("segoeuib.ttf", 17)
UI_LG = font("segoeui.ttf", 20)
UI_XL = font("segoeuib.ttf", 26)
MONO = font("consola.ttf", 20)
MONO_SM = font("consola.ttf", 15)

TEAL = (46, 191, 174)
TEAL_DARK = (20, 120, 108)
TEAL_TINT = (226, 245, 242)
INK = (24, 34, 32)
MUTED = (110, 124, 120)
LINE = (214, 221, 218)
PAGE = (236, 241, 239)
R_BLUE = (39, 109, 195)
CLAUDE = (217, 119, 87)

# Real numbers: cells per sample in GSE138867 (sums to 46,741), the layers in its file, and the top search results.
SAMPLES = [("GSM4120733", 8121), ("GSM4120734", 6618), ("GSM4120735", 5443), ("GSM4120736", 4148),
           ("GSM4120737", 6458), ("GSM4120738", 3211), ("GSM4120739", 7689), ("GSM4120740", 5053)]
LAYERS = [("Counts", ["exon_counts", "intron_counts", "cell_calls"]),
          ("Splicing", ["junctions", "splice_psi"]),
          ("Mitochondria", ["mt_heteroplasmy"]),
          ("Immune", ["vdj_gene_usage"]),
          ("QC", ["summary", "pileup_stats", "provenance"])]
RESULTS = [("GSE307686", "TREM2-T96K mutation and Alzheimer's risk…", "15", "116,169"),
           ("GSE200901", "Biological aging of CNS-resident cells…", "2", "13,224"),
           ("GSE301217", "Lifestyle shapes social and microglial deficits…", "2", "8,196")]


def typed(text: str, t: float, start: float, cps: float) -> str:
    n = int(max(0.0, t - start) * cps)
    return text[: min(len(text), n)]


def done_at(text: str, start: float, cps: float) -> float:
    return start + len(text) / cps


def ease(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def rr(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def cursor(d, x, y, t, h=22, color=INK):
    if int(t * 2.5) % 2 == 0:
        d.rectangle([x + 1, y + 1, x + 2, y + h], fill=color)


def pill(d, cx, text, dot):
    w = d.textlength(text, font=UI_B) + 44
    x0 = cx - w / 2
    rr(d, [x0, 14, x0 + w, 46], 16, fill=(255, 255, 255), outline=LINE)
    d.ellipse([x0 + 14, 25, x0 + 24, 35], fill=dot)
    d.text((x0 + 32, 21), text, font=UI_B, fill=INK)


def window(d, title, fill=(255, 255, 255)):
    rr(d, [60, 60, W - 60, H - 22], 12, fill=fill, outline=LINE)
    rr(d, [60, 60, W - 60, 96], 12, fill=(247, 249, 248), outline=LINE)
    d.rectangle([61, 86, W - 61, 96], fill=(247, 249, 248))
    d.line([60, 96, W - 60, 96], fill=LINE)
    for k, c in enumerate([(236, 106, 94), (244, 191, 79), (97, 197, 84)]):
        d.ellipse([80 + k * 22, 72, 92 + k * 22, 84], fill=c)
    d.text((170, 69), title, font=UI_SM, fill=MUTED)


KEYWORDS = ("import", "as", "from", "library")


def code_line(d, x, y, line, f=MONO, base=INK):
    """Tiny highlighter: keywords purple, strings green, calls blue."""
    i = 0
    while i < len(line):
        ch = line[i]
        if ch in "\"'":
            j = line.find(ch, i + 1)
            j = len(line) if j < 0 else j + 1
            seg, col = line[i:j], (30, 130, 80)
        elif ch.isalpha() or ch == "_":
            j = i
            while j < len(line) and (line[j].isalnum() or line[j] in "_."):
                j += 1
            seg = line[i:j]
            nxt = line[j : j + 1]
            col = (150, 60, 170) if seg in KEYWORDS else (40, 90, 190) if nxt == "(" else base
        else:
            j = i + 1
            seg, col = ch, base
        d.text((x, y), seg, font=f, fill=col)
        x += d.textlength(seg, font=f)
        i = j


def code_cell(d, t, x, y, lines, start, cps, prompt, prompt_color):
    """Type `lines` one after another from `start`; returns the time the last line finishes."""
    d.text((x - 78, y + 3), prompt, font=MONO_SM, fill=prompt_color)
    rr(d, [x - 14, y - 7, W - 84, y + 30 * len(lines) - 3], 6, fill=(245, 247, 246), outline=LINE)
    s = start
    for k, ln in enumerate(lines):
        shown = typed(ln, t, s, cps)
        code_line(d, x, y + k * 30, shown)
        end = done_at(ln, s, cps)
        if s <= t < end + 0.4 and (k == len(lines) - 1 or t < end):
            cursor(d, x + d.textlength(shown, font=MONO), y + k * 30, t)
        s = end + 0.25
    return s - 0.25


def big_fact(d, x, y, text, t, at):
    """A short headline fact that fades in at `at`."""
    if t < at:
        return
    a = ease((t - at) / 0.5)
    col = tuple(int(255 + (c - 255) * a) for c in TEAL_DARK)
    d.text((x, y), text, font=UI_XL, fill=col)


# ── Scene 1: Python notebook ───────────────────────────────────────────────

PY1 = ["import singlet", 'adata = singlet.load("GSE138867")']
PY2 = ['adata.obs["gsm_id"].value_counts().plot.barh()']


def scene_python(t: float) -> Image.Image:
    img = Image.new("RGB", (W, H), PAGE)
    d = ImageDraw.Draw(img)
    pill(d, W / 2, "Python", TEAL)
    window(d, "notebook.ipynb")

    y = 118
    end1 = code_cell(d, t, 176, y, PY1, 0.5, 17, "In [1]:", (60, 100, 200))
    if t >= end1 + 0.5:
        loading = t < end1 + 1.2
        d.text((98, y + 72), "Out:", font=MONO_SM, fill=(200, 90, 40))
        d.text((176, y + 70), "loading…" if loading else "46,741 cells · 8 samples", font=MONO, fill=MUTED if loading else INK)
    start2 = end1 + 1.8
    y2 = 238
    if t >= start2 - 0.3:
        end2 = code_cell(d, t, 176, y2, PY2, start2, 24, "In [2]:", (60, 100, 200))
        if t >= end2 + 0.4:
            grow = ease((t - end2 - 0.4) / 0.9)
            cx0, cy0 = 176, y2 + 46
            bar_h, gap, label_w, plot_w, maxv = 16, 6, 112, 500, 8500
            for k, (g, n) in enumerate(SAMPLES):
                by = cy0 + k * (bar_h + gap)
                d.text((cx0, by - 1), g, font=MONO_SM, fill=MUTED)
                bw = int(plot_w * n / maxv * grow)
                d.rectangle([cx0 + label_w, by, cx0 + label_w + bw, by + bar_h], fill=TEAL)
                if grow > 0.95:
                    d.text((cx0 + label_w + 8 + bw, by - 1), f"{n:,}", font=MONO_SM, fill=MUTED)
    return img


# ── Scene 2: R ──────────────────────────────────────────────────────────────

R1 = ['path <- singlet_download("GSE138867")', "names(singlet_modalities(path))"]
R2 = ['sce <- singlet::load("GSE138867")']


def scene_r(t: float) -> Image.Image:
    img = Image.new("RGB", (W, H), PAGE)
    d = ImageDraw.Draw(img)
    pill(d, W / 2, "R", R_BLUE)
    window(d, "R console")

    y = 118
    end1 = code_cell(d, t, 176, y, R1, 0.5, 22, ">", R_BLUE)
    # What is in the file, as grouped chips that appear one group at a time.
    if t >= end1 + 0.4:
        gy = y + 76
        for k, (group, keys) in enumerate(LAYERS):
            at = end1 + 0.4 + k * 0.25
            if t < at:
                break
            d.text((176, gy + 4), group, font=UI_SM, fill=MUTED)
            x = 300
            for key in keys:
                w = d.textlength(key, font=MONO_SM) + 20
                rr(d, [x, gy, x + w, gy + 26], 13, fill=TEAL_TINT, outline=(170, 222, 214))
                d.text((x + 10, gy + 4), key, font=MONO_SM, fill=TEAL_DARK)
                x += w + 8
            gy += 34
    start2 = end1 + 2.4
    y2 = 384
    if t >= start2 - 0.3:
        end2 = code_cell(d, t, 176, y2, R2, start2, 22, ">", R_BLUE)
        if t >= end2 + 0.5:
            d.text((176, y2 + 42), "SingleCellExperiment · 46,741 cells · 8 samples", font=MONO, fill=INK)
    return img


# ── Scene 3: Claude ─────────────────────────────────────────────────────────

ASK = "Find the largest study of microglia in the aging mouse brain and load it."
ANSWER = ["GSE307686 is the largest: 15 samples, 116,169 cells,", 'mouse reference GRCm39. Loaded with singlet.load("GSE307686").']


def chip(d, x, y, label, done, t):
    w = d.textlength(label, font=UI_SM) + 52
    rr(d, [x, y, x + w, y + 30], 15, fill=(255, 255, 255), outline=LINE)
    if done:
        d.ellipse([x + 11, y + 8, x + 25, y + 22], fill=TEAL)
        d.line([x + 14, y + 15, x + 17, y + 18, x + 22, y + 12], fill=(255, 255, 255), width=2)
    else:
        a = int(t * 8) % 4
        d.ellipse([x + 11, y + 8, x + 25, y + 22], outline=LINE, width=2)
        d.arc([x + 11, y + 8, x + 25, y + 22], start=a * 90, end=a * 90 + 110, fill=TEAL, width=2)
    d.text((x + 36, y + 5), label, font=UI_SM, fill=INK)
    return w


def scene_claude(t: float) -> Image.Image:
    img = Image.new("RGB", (W, H), PAGE)
    d = ImageDraw.Draw(img)
    pill(d, W / 2, "Claude", CLAUDE)
    rr(d, [60, 60, W - 60, H - 22], 12, fill=(250, 249, 245), outline=LINE)

    s = typed(ASK, t, 0.3, 42)
    if s:
        tw = d.textlength(ASK, font=UI_LG)
        rr(d, [W - 84 - tw - 36, 84, W - 84, 130], 14, fill=(240, 237, 228))
        d.text((W - 84 - tw - 18, 94), s, font=UI_LG, fill=INK)
    asked = done_at(ASK, 0.3, 42)

    y = 150
    t_search = asked + 0.6
    if t >= t_search:
        w = chip(d, 90, y, "singlet.bio · search_datasets", t >= t_search + 0.8, t)
        if t >= t_search + 0.8:
            d.text((90 + w + 12, y + 5), "“microglia in the aging mouse brain”", font=UI_SM, fill=MUTED)
        y += 42
    if t >= t_search + 0.8:
        show = min(3, int((t - t_search - 0.8) / 0.3) + 1)
        rr(d, [90, y, W - 90, y + 20 + show * 28], 8, fill=(255, 255, 255), outline=LINE)
        for k, (g, title, ns, nc) in enumerate(RESULTS[:show]):
            ry = y + 10 + k * 28
            hl = k == 0 and t >= t_search + 2.2
            if hl:
                d.rectangle([91, ry - 4, W - 91, ry + 23], fill=TEAL_TINT)
            d.text((106, ry), g, font=MONO_SM, fill=TEAL_DARK)
            d.text((200, ry - 1), title, font=UI_SM, fill=INK)
            d.text((W - 90 - 196, ry - 1), f"{ns} samples", font=UI_SM, fill=MUTED)
            d.text((W - 90 - 92, ry - 1), f"{nc} cells", font=UI_SM, fill=INK if hl else MUTED)
        y += 32 + show * 28
    t_study = t_search + 2.6
    if t >= t_study:
        chip(d, 90, y, "singlet.bio · get_study", t >= t_study + 0.6, t)
        y += 44
    t_answer = t_study + 0.8
    if t >= t_answer:
        n = int((t - t_answer) * 60)
        d.text((90, y), ANSWER[0][: min(len(ANSWER[0]), n)], font=UI_LG, fill=INK)
        d.text((90, y + 28), ANSWER[1][: max(0, n - len(ANSWER[0]))], font=UI_LG, fill=INK)
        if t >= t_answer + len("".join(ANSWER)) / 60 + 0.3:
            rr(d, [90, y + 66, 90 + 420, y + 102], 8, fill=(245, 247, 246), outline=LINE)
            code_line(d, 104, y + 74, 'adata = singlet.load("GSE307686")', f=MONO_SM)
    return img


SCENES = [scene_python, scene_r, scene_claude]


def frame(t: float) -> Image.Image:
    k = min(int(t // SCENE), len(SCENES) - 1)
    local = t - k * SCENE
    img = SCENES[k](local)
    # Cross-fade into the next scene over the last FADE seconds (and back to the first at the loop).
    if local > SCENE - FADE:
        nxt = SCENES[(k + 1) % len(SCENES)](0.0)
        img = Image.blend(img, nxt, ease((local - (SCENE - FADE)) / FADE))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    n = int(SCENE * len(SCENES) / STEP)
    frames = [frame(i * STEP) for i in range(n)]
    pal = [f.quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
    pal[0].save(OUT / "singlet-demo.gif", save_all=True, append_images=pal[1:], duration=int(STEP * 1000), loop=0, optimize=True, disposal=1)
    frame(9.5).save(OUT / "singlet-demo-poster.png", optimize=True)
    print(f"{n} frames, {(OUT / 'singlet-demo.gif').stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
