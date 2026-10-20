"""Replace the round period in "singlet.bio" with a square the size of a logo cell.

The wordmark's ".bio" group is drawn in glyph units (1000 per em, scaled by 0.1). In the lockup a logo cell is
13.68 px and one glyph unit is 0.1 x 0.7563 px, so a cell is about 181 glyph units; the same glyph size is used in
every variant so the square keeps its proportion to the letters. Its corner radius matches the cell's (1.44 px).

Rewrites src/generated/logo-svg.ts and public/brand/*.svg in place; safe to re-run (it skips files already done).

    python scripts/brand/square-dot.py
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
SIDE = 181.0
RADIUS = 19.0
# The period glyph: x 69-229, sitting on the baseline (y 11 at its lowest point).
CENTER_X = 149.0
BOTTOM = 11.0
SQUARE = f'<rect x="{CENTER_X - SIDE / 2:.1f}" y="{BOTTOM - SIDE:.1f}" width="{SIDE:.1f}" height="{SIDE:.1f}" rx="{RADIUS:.1f}"/>'

GROUP = re.compile(r'(<g transform="translate\([0-9.]+,0\) scale\(0\.100000\)" fill="[^"]+">\s*)(<path d="M149 11Q108[^"]*"/>)')


def fix(text: str) -> tuple[str, int]:
    """Swap the first path of each ".bio" group when it is the period glyph."""
    return GROUP.subn(lambda m: m.group(1) + SQUARE, text)


def main() -> None:
    targets = [ROOT / "src" / "generated" / "logo-svg.ts", *sorted((ROOT / "public" / "brand").glob("*.svg"))]
    for p in targets:
        text = p.read_text(encoding="utf-8")
        new, n = fix(text)
        if n:
            p.write_text(new, encoding="utf-8")
        print(f"{p.relative_to(ROOT)}: {n} period(s) squared")


if __name__ == "__main__":
    main()
