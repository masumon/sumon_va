"""Writes the app's logo as SVG (the source of truth) and renders PNG / JPG / PDF with headless Chrome. Run: python tools/make-logo.py

The mark: one line that reads two ways, a Latin S and a Bangla letter hanging from its matra (the bar on top, as in the Bangla স).
Only a bar and two arcs, so it reads at 24 px and on a signboard. Green on white-on-green for a modern, calm feel. Colours follow the owner's choice: emerald green with white.
"""
from __future__ import annotations

import pathlib
import subprocess
import tempfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "logo"
CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"

DEFS = ('<defs>'
        '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#19C98F"/><stop offset="1" stop-color="#067A57"/></linearGradient>'
        '<linearGradient id="soft" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5EEAB4"/><stop offset="1" stop-color="#12B886"/></linearGradient>'
        '</defs>')
R, CX, TOP, SW = 92, 512, 478, 66
S_PATH = f'M{CX + R} {TOP} A{R} {R} 0 1 0 {CX} {TOP + R} A{R} {R} 0 1 1 {CX - R} {TOP + 2 * R}'
BAR = 'M392 288 H632'                    # the Bangla matra, the line every Bangla letter hangs from


def svg(body: str, bg: bool) -> str:
    rect = '<rect width="1024" height="1024" fill="url(#bg)"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">{DEFS}{rect}{body}</svg>' + chr(10)


def mark(scale: float = 1.0, color: str = "#FFFFFF") -> str:
    """One mark that reads two ways: a Latin S, and a Bangla letter hanging from its matra (the bar on top), like the Bangla স."""
    t = f'transform="translate(512 512) scale({scale}) translate(-512 -512)"'
    return (f'<g {t} fill="none" stroke="{color}" stroke-linecap="round"><path d="{BAR}" stroke-width="{SW}"/>'
            f'<path d="{S_PATH}" stroke-width="{SW}"/></g>')


def mono(scale: float) -> str:
    return mark(scale, "#FFFFFF")


VARIANTS = {
    "logo-icon": svg(mark(1.0), True),                 # full app icon
    "logo-mark": svg(mark(1.0, "url(#soft)"), False),     # transparent, for the splash and anywhere on dark
    "logo-adaptive": svg(mark(0.86), False),           # Android adaptive foreground (safe zone)
    "logo-mono": svg(mono(1.0), False),                # Android themed icon
    "logo-notification": svg(mono(1.15), False),       # status-bar icon (white only)
}


def render(svg_path: pathlib.Path, png: pathlib.Path, size: int = 1024, transparent: bool = True) -> None:
    with tempfile.TemporaryDirectory() as td:
        html = pathlib.Path(td) / "p.html"
        html.write_text(f'<html><body style="margin:0;background:transparent"><img src="file:///{svg_path.as_posix()}" width="{size}" height="{size}" style="display:block"></body></html>', encoding="utf-8")
        args = [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--window-size={size},{size}", f"--screenshot={png}",
                f"--default-background-color={'00000000' if transparent else 'FFFFFFFF'}", f"--user-data-dir={td}/prof", html.as_uri()]
        subprocess.run(args, check=True, capture_output=True, timeout=120)


def sheet_pdf(pdf: pathlib.Path) -> None:
    icon = (OUT / "logo-icon.svg").as_posix()
    mk = (OUT / "logo-mark.svg").as_posix()
    html = f'''<html><head><meta charset="utf-8"><style>@page{{size:A4;margin:0}}body{{margin:0;font-family:"Noto Sans Bengali","Nirmala UI",sans-serif;color:#0B1030}}
.pg{{width:210mm;height:297mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14mm}}
.row{{display:flex;align-items:center;gap:10mm}}.dark{{background:#0B1030;padding:10mm;border-radius:8mm}}h1{{font-size:26pt;margin:0}}p{{margin:0;font-size:11pt;color:#4a5280}}</style></head>
<body><div class="pg"><img src="file:///{icon}" width="320"><h1>সুমনের ভার্চুয়াল সহকারী</h1><p>Sumon's Virtual Assistant &middot; ABO ENTERPRISE</p>
<div class="row"><div class="dark"><img src="file:///{mk}" width="120"></div><img src="file:///{icon}" width="120" style="border-radius:26px"><img src="file:///{icon}" width="48" style="border-radius:11px"></div></div></body></html>'''
    with tempfile.TemporaryDirectory() as td:
        h = pathlib.Path(td) / "s.html"
        h.write_text(html, encoding="utf-8")
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={pdf}", f"--user-data-dir={td}/prof", h.as_uri()], check=True, capture_output=True, timeout=120)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in VARIANTS.items():
        (OUT / f"{name}.svg").write_text(text, encoding="utf-8")
        render(OUT / f"{name}.svg", OUT / f"{name}.png", 1024, transparent=name != "logo-icon")
    Image.open(OUT / "logo-icon.png").convert("RGB").save(OUT / "logo-icon.jpg", quality=95)
    sheet_pdf(OUT / "logo-sheet.pdf")
    print("logo files written to", OUT)


if __name__ == "__main__":
    main()
