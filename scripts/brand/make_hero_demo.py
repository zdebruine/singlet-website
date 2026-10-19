"""Render the home page demo GIF (about 10 s): load a study in a Python notebook, then ask Claude to do it.

Every number comes from the live catalog (GSE138867 and the "microglia in the aging mouse brain" search),
as of 2026-10-19; nothing is invented. Re-run after the data changes:

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
TOTAL = 10.0
SWITCH = 5.0  # python scene ends, Claude scene begins
FADE = 0.4

FONT_DIR = Path(r"C:\Windows\Fonts")


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / name), size)


UI = font("segoeui.ttf", 17)
UI_SM = font("segoeui.ttf", 14)
UI_B = font("segoeuib.ttf", 17)
UI_LG = font("segoeui.ttf", 19)
MONO = font("consola.ttf", 19)
MONO_SM = font("consola.ttf", 15)

TEAL = (46, 191, 174)
TEAL_DARK = (20, 120, 108)
INK = (24, 34, 32)
MUTED = (110, 124, 120)
LINE = (214, 221, 218)
PAGE = (236, 241, 239)

# Real numbers: cells per sample in GSE138867 (sums to 46,741) and the top search results.
SAMPLES = [("GSM4120733", 8121), ("GSM4120734", 6618), ("GSM4120735", 5443), ("GSM4120736", 4148),
           ("GSM4120737", 6458), ("GSM4120738", 3211), ("GSM4120739", 7689), ("GSM4120740", 5053)]
RESULTS = [("GSE307686", "TREM2-T96K mutation and Alzheimer's risk", "15", "116,169"),
           ("GSE200901", "Biological aging of CNS-resident cells", "2", "13,224"),
           ("GSE301217", "Lifestyle shapes social and microglial deficits", "2", "8,196")]


def typed(text: str, t: float, start: float, cps: float = 28.0) -> str:
    n = int(max(0.0, t - start) * cps)
    return text[: min(len(text), n)]


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
    rr(d, [x0, 16, x0 + w, 48], 16, fill=(255, 255, 255), outline=LINE)
    d.ellipse([x0 + 14, 27, x0 + 24, 37], fill=dot)
    d.text((x0 + 32, 23), text, font=UI_B, fill=INK)


KEYWORDS = ("import", "as", "from")


def code_line(d, x, y, line, f=MONO, base=INK):
    """Tiny highlighter: keywords purple, strings green, calls blue."""
    i = 0
    while i < len(line):
        ch = line[i]
        if ch in "\"'":
            j = line.find(ch, i + 1)
            j = len(line) if j < 0 else j + 1
            seg = line[i:j]
            col = (30, 130, 80)
        elif ch.isalpha() or ch == "_":
            j = i
            while j < len(line) and (line[j].isalnum() or line[j] in "_"):
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


# ── Scene A: a Python notebook ──────────────────────────────────────────────

CODE1 = ["import singlet", 'adata = singlet.load("GSE138867")']
CODE2 = ['adata.obs["gsm_id"].value_counts().plot.barh()']


def scene_python(t: float) -> Image.Image:
    img = Image.new("RGB", (W, H), PAGE)
    d = ImageDraw.Draw(img)
    pill(d, W / 2, "Python", TEAL)
    rr(d, [60, 64, W - 60, H - 26], 12, fill=(255, 255, 255), outline=LINE)
    d.rectangle([61, 64, W - 61, 94], fill=(247, 249, 248))
    rr(d, [60, 64, W - 60, 100], 12, fill=(247, 249, 248), outline=LINE)
    d.rectangle([61, 90, W - 61, 100], fill=(247, 249, 248))
    for k, c in enumerate([(236, 106, 94), (244, 191, 79), (97, 197, 84)]):
        d.ellipse([80 + k * 22, 76, 92 + k * 22, 88], fill=c)
    d.text((170, 73), "singlet-demo.ipynb", font=UI_SM, fill=MUTED)
    d.line([60, 100, W - 60, 100], fill=LINE)

    # cell 1
    y = 122
    d.text((82, y + 2), "In [1]:", font=MONO_SM, fill=(60, 100, 200))
    rr(d, [160, y - 6, W - 84, y + 64], 6, fill=(245, 247, 246), outline=LINE)
    shown1 = [typed(CODE1[0], t, 0.4), typed(CODE1[1], t, 0.4 + len(CODE1[0]) / 28.0 + 0.15)]
    for k, ln in enumerate(shown1):
        code_line(d, 176, y + k * 28, ln)
    if t < 2.0:
        k = 0 if shown1[1] == "" else 1
        cursor(d, 176 + d.textlength(shown1[k], font=MONO), y + k * 28, t)
    if t >= 2.3:
        loading = t < 2.9
        d.text((82, y + 76), "Out[1]:", font=MONO_SM, fill=(200, 90, 40))
        d.text((176, y + 76), "loading…" if loading else "46,741 cells · 8 samples", font=MONO, fill=MUTED if loading else INK)

    # cell 2
    y2 = 246
    if t >= 3.0:
        d.text((82, y2 + 2), "In [2]:", font=MONO_SM, fill=(60, 100, 200))
        rr(d, [160, y2 - 6, W - 84, y2 + 34], 6, fill=(245, 247, 246), outline=LINE)
        s2 = typed(CODE2[0], t, 3.1, 34)
        code_line(d, 176, y2, s2)
        if t < 4.2:
            cursor(d, 176 + d.textlength(s2, font=MONO), y2, t)
    if t >= 4.0:
        grow = ease((t - 4.0) / 0.8)
        cx0, cy0 = 176, y2 + 52
        d.text((82, cy0), "Out[2]:", font=MONO_SM, fill=(200, 90, 40))
        bar_h, gap = 15, 5
        label_w = 112
        maxv = 8500
        plot_w = 520
        d.line([cx0 + label_w, cy0, cx0 + label_w, cy0 + 8 * (bar_h + gap)], fill=LINE)
        for k, (g, n) in enumerate(SAMPLES):
            by = cy0 + k * (bar_h + gap)
            d.text((cx0, by - 3), g, font=MONO_SM, fill=MUTED)
            bw = int(plot_w * n / maxv * grow)
            d.rectangle([cx0 + label_w + 1, by, cx0 + label_w + 1 + bw, by + bar_h], fill=TEAL)
            if grow > 0.95:
                d.text((cx0 + label_w + 8 + bw, by - 3), f"{n:,}", font=MONO_SM, fill=MUTED)
        d.text((cx0 + label_w, cy0 + 8 * (bar_h + gap) + 2), "cells per sample", font=UI_SM, fill=MUTED)
    return img


# ── Scene B: Claude ─────────────────────────────────────────────────────────

ASK = "Find the largest study of microglia in the aging mouse brain and load it."
ANSWER = ["GSE307686 is the largest: 15 samples, 116,169 cells,", "mouse reference GRCm39. Loaded with singlet.load(\"GSE307686\")."]


def chip(d, x, y, label, done, t):
    w = d.textlength(label, font=UI_SM) + 52
    rr(d, [x, y, x + w, y + 30], 15, fill=(255, 255, 255), outline=LINE)
    if done:
        d.ellipse([x + 11, y + 8, x + 25, y + 22], fill=TEAL)
        d.line([x + 14, y + 15, x + 17, y + 18, x + 22, y + 12], fill=(255, 255, 255), width=2)
    else:
        a = int(t * 8) % 4
        for k in range(4):
            d.ellipse([x + 11 + k * 0, y + 8, x + 25, y + 22], outline=LINE, width=2)
        d.arc([x + 11, y + 8, x + 25, y + 22], start=a * 90, end=a * 90 + 110, fill=TEAL, width=2)
    d.text((x + 36, y + 6), label, font=UI_SM, fill=INK)
    return w


def scene_claude(t: float) -> Image.Image:
    img = Image.new("RGB", (W, H), PAGE)
    d = ImageDraw.Draw(img)
    pill(d, W / 2, "Claude", (217, 119, 87))
    rr(d, [60, 64, W - 60, H - 26], 12, fill=(250, 249, 245), outline=LINE)

    # user message
    s = typed(ASK, t, 0.2, 72)
    if s:
        tw = d.textlength(ASK, font=UI_LG)
        rr(d, [W - 84 - tw - 36, 90, W - 84, 134], 14, fill=(240, 237, 228))
        d.text((W - 84 - tw - 18, 100), s, font=UI_LG, fill=INK)

    y = 154
    # tool 1: search
    if t >= 1.3:
        w = chip(d, 90, y, "singlet.bio · search_datasets", t >= 1.9, t)
        if t >= 1.9:
            d.text((90 + w + 12, y + 6), "“microglia in the aging mouse brain”", font=UI_SM, fill=MUTED)
        y += 42
    if t >= 1.9:
        show = min(3, int((t - 1.9) / 0.2) + 1)
        rr(d, [90, y, W - 90, y + 24 + show * 26], 8, fill=(255, 255, 255), outline=LINE)
        for k, (g, title, ns, nc) in enumerate(RESULTS[:show]):
            ry = y + 10 + k * 26
            d.text((106, ry), g, font=MONO_SM, fill=TEAL_DARK)
            d.text((200, ry - 1), title, font=UI_SM, fill=INK)
            d.text((W - 90 - 190, ry - 1), f"{ns} samples", font=UI_SM, fill=MUTED)
            d.text((W - 90 - 90, ry - 1), f"{nc} cells", font=UI_SM, fill=MUTED)
        y += 36 + show * 26
    # tool 2: get_study
    if t >= 2.6:
        chip(d, 90, y, "singlet.bio · get_study", t >= 3.0, t)
        y += 42
    # answer
    if t >= 3.0:
        full = ANSWER[0] + ANSWER[1]
        n = int((t - 3.0) * 90)
        a0 = ANSWER[0][: min(len(ANSWER[0]), n)]
        a1 = ANSWER[1][: max(0, n - len(ANSWER[0]))]
        d.text((90, y), a0, font=UI_LG, fill=INK)
        d.text((90, y + 28), a1, font=UI_LG, fill=INK)
        if n >= len(full) and t >= 3.0 + len(full) / 90 + 0.1:
            rr(d, [90, y + 64, 90 + 420, y + 100], 8, fill=(245, 247, 246), outline=LINE)
            code_line(d, 104, y + 70, 'adata = singlet.load("GSE307686")', f=MONO_SM)
    return img


def frame(t: float) -> Image.Image:
    if t < SWITCH - FADE / 2:
        return scene_python(t)
    if t < SWITCH + FADE / 2:
        a = (t - (SWITCH - FADE / 2)) / FADE
        return Image.blend(scene_python(min(t, SWITCH - 0.001)), scene_claude(0.0), ease(a))
    return scene_claude(t - SWITCH)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    frames = []
    n = int(TOTAL / STEP)
    for i in range(n):
        frames.append(frame(i * STEP))
    pal = [f.quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
    pal[0].save(OUT / "singlet-demo.gif", save_all=True, append_images=pal[1:], duration=int(STEP * 1000), loop=0, optimize=True, disposal=1)
    frame(4.7).save(OUT / "singlet-demo-poster.png", optimize=True)
    print(f"{n} frames, {(OUT / 'singlet-demo.gif').stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
