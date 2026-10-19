"""Regenerate the favicon set from one geometry: the 4x4 singlet grid on a rounded dark tile.

The mark fills about half the tile (32 to 96 of 128), the same proportion as cloud.singlet.bio, so both
sites read alike in a browser tab. Writes public/favicon.svg, public/brand/favicon.svg, favicon-32.png,
favicon.ico (16/32/48), apple-touch-icon.png, icon-192.png and icon-512.png.

    python scripts/brand/favicons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"

TILE = "#0F1F1D"
DOT = "#3A524D"
ACCENT = "#2EBFAE"
ACCENT_CELL = (2, 1)  # column, row

VIEW = 128
RADIUS = 24
ORIGIN = 32.0
CELL = 12.0
GAP = 5.2
CELL_RADIUS = 2.0


def rects():
    for row in range(4):
        for col in range(4):
            x = ORIGIN + col * (CELL + GAP)
            y = ORIGIN + row * (CELL + GAP)
            yield x, y, ACCENT if (col, row) == ACCENT_CELL else DOT


def svg() -> str:
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VIEW} {VIEW}" width="{VIEW}" height="{VIEW}">',
             f'<rect width="{VIEW}" height="{VIEW}" rx="{RADIUS}" fill="{TILE}"/>']
    for x, y, fill in rects():
        parts.append(f'<rect x="{x:.2f}" y="{y:.2f}" width="{CELL:.2f}" height="{CELL:.2f}" rx="{CELL_RADIUS:.2f}" fill="{fill}"/>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def raster(size: int, rounded: bool = True) -> Image.Image:
    """Draw at 8x and scale down so edges are smooth at 16 and 32 px."""
    s = size * 8
    k = s / VIEW
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=RADIUS * k if rounded else 0, fill=TILE)
    for x, y, fill in rects():
        d.rounded_rectangle([x * k, y * k, (x + CELL) * k, (y + CELL) * k], radius=CELL_RADIUS * k, fill=fill)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    text = svg()
    (PUBLIC / "favicon.svg").write_text(text, encoding="utf-8")
    (PUBLIC / "brand" / "favicon.svg").write_text(text, encoding="utf-8")
    raster(32).save(PUBLIC / "favicon-32.png")
    raster(48).save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    raster(180).save(PUBLIC / "apple-touch-icon.png")
    raster(192).save(PUBLIC / "icon-192.png")
    raster(512).save(PUBLIC / "icon-512.png")
    print("wrote favicon set")


if __name__ == "__main__":
    main()
