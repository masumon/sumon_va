"""Writes vector (SVG) masters of the app logo and renders PNG / JPG / PDF with headless Chrome. Run: python tools/make-logo.py

The logo is the owner's first design, polished: a gold "S" on deep ABO indigo with one red notification dot. The letter is drawn from
the Inter Bold typeface (SIL Open Font License, free for logos and apps) so the artwork carries no Microsoft/Segoe font licence.
Polish over the first version: the S is optically centred, the dot sits clear of the letter (it used to overlap it) with a ring in the
background colour, a fine light edge on the letter gives it a metal feel, and the background carries one soft light.
tools/make-icons.py cuts the Android icons from the PNGs this script writes.
"""
from __future__ import annotations

import pathlib
import subprocess
import tempfile

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "logo"
FONT = ROOT / "node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf"
CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"

DEFS = ('<defs>'
        '<linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#2C3C8A"/><stop offset="1" stop-color="#0C122F"/></linearGradient>'
        '<radialGradient id="glow" cx="0.3" cy="0.2" r="0.7"><stop offset="0" stop-color="#8E9CDA" stop-opacity="0.30"/><stop offset="1" stop-color="#8E9CDA" stop-opacity="0"/></radialGradient>'
        '<linearGradient id="gold" x1="0.1" y1="0" x2="0.7" y2="1"><stop offset="0" stop-color="#FCE08A"/><stop offset="0.55" stop-color="#E2B04A"/><stop offset="1" stop-color="#B07A0C"/></linearGradient>'
        '<linearGradient id="edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF4C8" stop-opacity="0.9"/><stop offset="0.5" stop-color="#FFF4C8" stop-opacity="0"/></linearGradient>'
        '<radialGradient id="red" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#FF7B5F"/><stop offset="1" stop-color="#DB3E2A"/></radialGradient>'
        '<filter id="soft" x="-10%" y="-10%" width="130%" height="130%"><feGaussianBlur stdDeviation="16"/></filter>'
        '</defs>')

S_HEIGHT = 540


def letter_s(height: float) -> str:
    """The S outline as an SVG path, scaled so it is `height` tall and centred on the 1024 canvas (a little low of true centre:
    the dot above it makes the whole mark look balanced)."""
    font = TTFont(str(FONT))
    glyphs = font.getGlyphSet()
    name = font.getBestCmap()[ord("S")]
    bp = BoundsPen(glyphs)
    glyphs[name].draw(bp)
    x0, y0, x1, y1 = bp.bounds
    k = height / (y1 - y0)
    ox = 500 - (x0 + x1) / 2 * k
    oy = 536 + (y0 + y1) / 2 * k       # the font's y axis points up, SVG's down
    pen = SVGPathPen(glyphs)
    glyphs[name].draw(TransformPen(pen, (k, 0, 0, -k, ox, oy)))
    return pen.getCommands()


S_PATH = letter_s(S_HEIGHT)


def dot() -> str:
    """The notification dot: clear of the letter, with a ring in the background colour so it reads as a badge."""
    cx, cy = 742, 262
    return (f'<circle cx="{cx}" cy="{cy}" r="78" fill="#0C122F" fill-opacity="0.9"/><circle cx="{cx}" cy="{cy}" r="56" fill="url(#red)"/>'
            f'<ellipse cx="{cx - 14}" cy="{cy - 20}" rx="20" ry="12" fill="#FFFFFF" fill-opacity="0.32"/>')


def svg(body: str, bg: bool) -> str:
    base = '<rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#glow)"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">{DEFS}{base}{body}</svg>' + chr(10)


def tf(scale: float) -> str:
    return f'transform="translate(512 512) scale({scale}) translate(-512 -512)"'


def gold_s(scale: float = 1.0) -> str:
    return (f'<g {tf(scale)}><path d="{S_PATH}" fill="#050819" fill-opacity="0.6" transform="translate(10 22)" filter="url(#soft)"/>'
            f'<path d="{S_PATH}" fill="url(#gold)"/><path d="{S_PATH}" fill="url(#edge)" fill-opacity="0.28"/></g>')


def dot_g(scale: float) -> str:
    return f'<g {tf(scale)}>{dot()}</g>'


def mono(scale: float) -> str:
    return f'<g {tf(scale)}><path d="{S_PATH}" fill="#FFFFFF"/></g>'


VARIANTS = {
    "logo-icon": svg(gold_s() + dot(), True),                         # the full app icon
    "logo-mark": svg(gold_s() + dot(), False),                        # transparent background, for the splash and anywhere on dark
    "logo-adaptive": svg(gold_s(0.80) + dot_g(0.80), False),          # Android adaptive foreground (safe zone)
    "logo-mono": svg(mono(0.80), False),                              # Android themed icon
    "logo-notification": svg(mono(1.14), False),                      # status-bar icon (white only)
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
    html = f'''<html><head><meta charset="utf-8"><style>@page{{size:A4;margin:0}}body{{margin:0;font-family:"Noto Sans Bengali","Nirmala UI",sans-serif;color:#0C122F}}
.pg{{width:210mm;height:297mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14mm}}
.row{{display:flex;align-items:center;gap:10mm}}.dark{{background:#0C122F;padding:10mm;border-radius:8mm}}h1{{font-size:26pt;margin:0}}p{{margin:0;font-size:11pt;color:#4a5280}}</style></head>
<body><div class="pg"><img src="file:///{icon}" width="320" style="border-radius:70px"><h1>সুমনের ভার্চুয়াল সহকারী</h1><p>Sumon's Virtual Assistant &middot; ABO ENTERPRISE</p>
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
