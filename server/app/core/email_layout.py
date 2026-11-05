"""One shared look for every e-mail the site sends (new order/booking/lead alerts to the owner and
confirmations/status updates to customers).

Table-based, inline-styled HTML that renders the same in Gmail, Outlook and phone mail apps: a
600px-max card that shrinks to the screen, big full-width tap-friendly buttons, readable in dark
mode (every surface sets its own background AND text colour, so mail apps that auto-invert keep the
contrast), brand header with the logo and a footer with the business details.
"""
from __future__ import annotations

from html import escape

from app.core.config import settings

BRAND = "#1e5ba8"
INK = "#111827"
MUTED = "#6b7280"
LINE = "#e5e7eb"
PAGE_BG = "#f1f3f8"
CARD_BG = "#ffffff"
SOFT_BG = "#f5f8fd"

NAME = "ABO Enterprise"
TAGLINE = "Simple Solution"
CONTACT = "Beanibazar, Sylhet, Bangladesh"


def site_url() -> str:
    return (settings.FRONTEND_URL or "https://www.aboenterprise.com").rstrip("/")


def admin_url(path: str = "orders") -> str:
    """Admin panel lives under /sumon (the old /admin path no longer exists); on the separate admin
    site when ADMIN_URL is configured."""
    base = settings.admin_base_url or site_url()
    return f"{base}/sumon/{path.strip('/')}"


def esc(value: object) -> str:
    return escape("" if value is None else str(value))


def button(url: str, label: str, color: str = BRAND) -> str:
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px"><tr>'
        f'<td align="center" bgcolor="{color}" style="border-radius:10px;background:{color}">'
        f'<a href="{escape(url, quote=True)}" style="display:block;padding:14px 18px;font:600 15px/1.2 Arial,Helvetica,sans-serif;'
        f'color:#ffffff;text-decoration:none;border-radius:10px">{esc(label)}</a></td></tr></table>'
    )


def buttons(*items: tuple[str, str, str]) -> str:
    """Stacked full-width buttons (one per row) — never wrap, clip or overlap on a phone."""
    return '<div style="margin:22px 0 4px">' + "".join(button(u, label, c) for u, label, c in items if u) + "</div>"


def callout(label: str, value: str, color: str = BRAND, sub: str = "") -> str:
    sub_html = f'<div style="margin-top:4px;font:14px/1.4 Arial,sans-serif;color:{MUTED}">{esc(sub)}</div>' if sub else ""
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0"><tr>'
        f'<td bgcolor="{SOFT_BG}" style="background:{SOFT_BG};border-left:4px solid {color};border-radius:8px;padding:14px 16px">'
        f'<div style="font:600 12px/1.3 Arial,sans-serif;color:{MUTED};text-transform:uppercase;letter-spacing:.06em">{esc(label)}</div>'
        f'<div style="margin-top:4px;font:700 20px/1.3 Arial,sans-serif;color:{INK};word-break:break-all">{esc(value)}</div>{sub_html}'
        f"</td></tr></table>"
    )


def facts(rows: list[tuple[str, str]], highlight_last: bool = False) -> str:
    """Label/value table. Values are escaped here, so callers pass plain text."""
    out = []
    for i, (label, value) in enumerate(rows):
        last = highlight_last and i == len(rows) - 1
        out.append(
            f'<tr><td style="padding:11px 0;border-bottom:1px solid {LINE};font:14px/1.4 Arial,sans-serif;color:{MUTED};width:38%;vertical-align:top">{esc(label)}</td>'
            f'<td style="padding:11px 0 11px 12px;border-bottom:1px solid {LINE};font:{"700 18px" if last else "600 14px"}/1.4 Arial,sans-serif;'
            f'color:{"#c2185b" if last else INK};vertical-align:top;word-break:break-word">{esc(value) or "—"}</td></tr>'
        )
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0">{"".join(out)}</table>'


def paragraph(text: str) -> str:
    return f'<p style="margin:0 0 14px;font:15px/1.6 Arial,sans-serif;color:#374151">{esc(text)}</p>'


def wrap_email(title: str, body_html: str, *, preheader: str = "", accent: str = BRAND, note: str = "") -> str:
    """Complete HTML document. `body_html` must already be safe (built with the helpers above)."""
    logo = f"{site_url()}/logo.png"
    note_html = (
        f'<p style="margin:22px 0 0;padding-top:16px;border-top:1px solid {LINE};font:13px/1.6 Arial,sans-serif;color:{MUTED}">{esc(note)}</p>'
        if note else ""
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>{esc(title)}</title></head>
<body style="margin:0;padding:0;background:{PAGE_BG}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:{PAGE_BG}">{esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="{PAGE_BG}" style="background:{PAGE_BG}"><tr><td align="center" style="padding:20px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
    <tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:14px 14px 0 0;border:1px solid {LINE};border-bottom:4px solid {BRAND};padding:16px 22px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:14px"><img src="{logo}" width="60" height="60" alt="{NAME}" style="display:block;border:0;border-radius:50%;background:#ffffff"></td>
        <td><div style="font:700 20px/1.2 Arial,sans-serif;color:{BRAND}">{NAME}</div>
            <div style="font:13px/1.4 Arial,sans-serif;color:{MUTED}">{TAGLINE}</div></td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="{CARD_BG}" style="background:{CARD_BG};padding:26px 22px;border-left:1px solid {LINE};border-right:1px solid {LINE}">
      <h1 style="margin:0 0 16px;font:700 22px/1.3 Arial,sans-serif;color:{accent}">{esc(title)}</h1>
      {body_html}
      {note_html}
    </td></tr>
    <tr><td bgcolor="{SOFT_BG}" style="background:{SOFT_BG};border:1px solid {LINE};border-radius:0 0 14px 14px;padding:16px 22px;text-align:center">
      <div style="font:600 13px/1.5 Arial,sans-serif;color:{INK}">{NAME} · {CONTACT}</div>
      <div style="font:12px/1.6 Arial,sans-serif;color:{MUTED}"><a href="{site_url()}" style="color:{BRAND};text-decoration:none">{site_url().replace("https://", "")}</a></div>
    </td></tr>
  </table>
</td></tr></table></body></html>"""
