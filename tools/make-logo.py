"""Writes the app's logo as SVG (the source of truth) and renders PNG / JPG / PDF with headless Chrome. Run: python tools/make-logo.py

The mark: a speech bubble (a conversation) holding one continuous S built from two equal arcs (Sumon, and "everything in one
place"), with a single coral dot on the bubble's edge (what needs you). Only circles and arcs, so it stays crisp from a 24 px
notification icon to a signboard. Colours follow the ABO Enterprise palette: deep indigo, bronze-gold, one accent.
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
        '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#26357F"/><stop offset="1" stop-color="#0B1030"/></linearGradient>'
        '<linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="420" y1="300" x2="610" y2="720"><stop offset="0" stop-color="#F8D06C"/><stop offset="1" stop-color="#B0760A"/></linearGradient>'
        '</defs>')
BUBBLE = '<circle cx="512" cy="500" r="300"/><path d="M318 716 Q304 800 232 840 Q356 846 452 790 Z"/>'
S_PATH = 'M604 410 A92 92 0 1 0 512 502 A92 92 0 1 1 420 594'


def svg(body: str, bg: bool) -> str:
    rect = '<rect width="1024" height="1024" fill="url(#bg)"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">{DEFS}{rect}{body}</svg>\n'


def mark(scale: float = 1.0, dot_ring: str = "#0B1030") -> str:
    t = f'transform="translate(512 512) scale({scale}) translate(-512 -512)"'
    return (f'<g {t}><g fill="#FFFFFF" opacity="0.10">{BUBBLE}</g>'
            f'<path d="{S_PATH}" fill="none" stroke="url(#gold)" stroke-width="62" stroke-linecap="round"/>'
            f'<circle cx="736" cy="290" r="64" fill="{dot_ring}"/><circle cx="736" cy="290" r="44" fill="#F0523A"/></g>')


def mono(scale: float) -> str:
    t = f'transform="translate(512 512) scale({scale}) translate(-512 -512)"'
    return f'<g {t}><path d="{S_PATH}" fill="none" stroke="#FFFFFF" stroke-width="70" stroke-linecap="round"/></g>'


VARIANTS = {
    "logo-icon": svg(mark(1.0), True),                 # full app icon
    "logo-mark": svg(mark(1.0, "#0B1030"), False),     # transparent, for the splash and anywhere on dark
    "logo-adaptive": svg(mark(0.86), False),           # Android adaptive foreground (safe zone)
    "logo-mono": svg(mono(1.0), False),                # Android themed icon
    "logo-notification": svg(mono(1.25), False),       # status-bar icon (white only)
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
