"""Draws the app's "S" mark and writes every icon/splash size. Run: python tools/make-icons.py

Brand match (ABO Enterprise): deep indigo background (#1e2b6b -> #0e1533), bronze/gold S (#f2c04d -> #a87008, like the
bronze "A" of the logo), one small red swoosh (#d6452f) echoing the red wing of the "B".
"""
from __future__ import annotations

import math
import pathlib

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
RES = ROOT / "android/app/src/main/res"
ASSETS = ROOT / "assets"
FONT = "C:/Windows/Fonts/segoeuib.ttf"
S = 1024  # master canvas


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vertical_gradient(size, top, bottom):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        c = lerp(top, bottom, y / (size - 1))
        for x in range(size):
            px[x, y] = c
    return img


def background(size=S):
    """Indigo with a soft light from the top-left."""
    base = vertical_gradient(size, (0x2b, 0x3a, 0x86), (0x0e, 0x15, 0x33))
    glow = Image.new("L", (size, size), 0)
    ImageDraw.Draw(glow).ellipse((-size * 0.2, -size * 0.3, size * 0.75, size * 0.6), fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.12))
    return Image.composite(Image.new("RGB", (size, size), (0x7c, 0x8c, 0xc7)), base, glow)


def s_mask(size=S, scale=0.62):
    """The letter S as an L mask, centred, `scale` of the canvas high."""
    font = ImageFont.truetype(FONT, int(size * scale * 1.38))
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    box = d.textbbox((0, 0), "S", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1] - size * 0.01), "S", font=font, fill=255)
    return mask


def gold_s(size=S, scale=0.62):
    mask = s_mask(size, scale)
    fill = vertical_gradient(size, (0xf8, 0xd0, 0x6c), (0xb0, 0x76, 0x0a))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # soft shadow under the letter
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow.paste(Image.new("RGBA", (size, size), (6, 10, 30, 170)), (int(size * 0.012), int(size * 0.02)), mask)
    out = Image.alpha_composite(out, shadow.filter(ImageFilter.GaussianBlur(size * 0.014)))
    glyph = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glyph.paste(fill, (0, 0), mask)
    return Image.alpha_composite(out, glyph)


def swoosh(size=S, scale=0.62):
    """A small red notification dot with a light ring, at the top-right of the S: "your inbox has something"."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    r = size * scale * 0.17
    cx, cy = size * 0.5 + size * scale * 0.45, size * 0.5 - size * scale * 0.46
    d.ellipse((cx - r * 1.28, cy - r * 1.28, cx + r * 1.28, cy + r * 1.28), fill=(14, 21, 51, 255))
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(0xe5, 0x48, 0x32, 255))
    return layer.filter(ImageFilter.GaussianBlur(size * 0.0012))


def mark(size=S, scale=0.62, with_wing=True):
    m = gold_s(size, scale)
    if with_wing:
        m = Image.alpha_composite(m, swoosh(size, scale))
    return m


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.size[0] - 1, img.size[1] - 1), radius=radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def save(img, path, px, fmt=None, **kw):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.resize((px, px), Image.LANCZOS).save(path, fmt, **kw)


def main():
    bg = background()
    full = Image.alpha_composite(bg.convert("RGBA"), mark(S, 0.64))
    # store/master icon (square, system masks it)
    save(full.convert("RGB"), ASSETS / "icon.png", 1024)
    # adaptive layers (108dp canvas, safe zone = centre 66%)
    fg = mark(S, 0.50)
    mono = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    mono.paste(Image.new("RGBA", (S, S), (255, 255, 255, 255)), (0, 0), s_mask(S, 0.50))
    save(fg, ASSETS / "adaptive-icon.png", 1024)
    save(mono, ASSETS / "monochrome-icon.png", 1024)
    notif = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    notif.paste(Image.new("RGBA", (S, S), (255, 255, 255, 255)), (0, 0), s_mask(S, 0.78))
    save(notif, ASSETS / "notification-icon.png", 1024)
    splash = mark(S, 0.62)
    save(splash, ASSETS / "splash-mark.png", 1024)
    save(full.convert("RGB"), ASSETS / "favicon.png", 96)

    dens = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for name, k in dens.items():
        base = RES / f"mipmap-{name}"
        legacy = rounded(full, int(S * 0.2))
        round_ = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        circle = Image.new("L", (S, S), 0)
        ImageDraw.Draw(circle).ellipse((0, 0, S - 1, S - 1), fill=255)
        rc = full.copy()
        rc.putalpha(circle)
        round_ = rc
        save(legacy, base / "ic_launcher.webp", int(48 * k), "WEBP", quality=95)
        save(round_, base / "ic_launcher_round.webp", int(48 * k), "WEBP", quality=95)
        save(fg, base / "ic_launcher_foreground.webp", int(108 * k), "WEBP", quality=95)
        save(mono, base / "ic_launcher_monochrome.webp", int(108 * k), "WEBP", quality=95)
        save(notif, RES / f"drawable-{name}" / "notification_icon.png", int(24 * k))
        save(splash, RES / f"drawable-{name}" / "splashscreen_logo.png", int(288 * k))
    print("icons written")


if __name__ == "__main__":
    main()
