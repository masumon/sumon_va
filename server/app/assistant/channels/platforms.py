"""Per-platform settings: the owner can tune each messaging platform (WhatsApp, Messenger, LinkedIn, ...) on its own page in the app.

Stored in the assistant config under cfg["platforms"][<key>]. Every value is read through `settings_for`, which repairs anything
odd to a safe default, so a bad edit can never lock the owner out or switch on automatic replies by accident.
Family and personal contacts are never auto-replied on ANY platform, whatever is set here (see wa_flow.effective_mode / privacy).
"""
from __future__ import annotations

import re
from typing import Any

# phone-app package prefix -> platform key (chats read from notifications look like "notif:<package>:<name>")
PACKAGES: list[tuple[str, str]] = [
    ("com.whatsapp", "whatsapp"), ("com.facebook.orca", "messenger"), ("com.facebook.mlite", "messenger"), ("com.facebook.katana", "facebook"),
    ("com.facebook.lite", "facebook"), ("com.instagram", "instagram"), ("org.telegram", "telegram"), ("org.thunderdog", "telegram"),
    ("com.imo", "imo"), ("com.viber", "viber"), ("org.thoughtcrime", "signal"), ("jp.naver.line", "line"), ("com.tencent.mm", "wechat"),
    ("com.google.android.gm", "email"), ("com.linkedin", "linkedin"), ("com.zhiliaoapp", "tiktok"), ("com.ss.android.ugc", "tiktok"),
]
KEYS = ["whatsapp", "messenger", "instagram", "facebook", "telegram", "sms", "email", "imo", "viber", "line", "wechat", "signal", "linkedin", "tiktok"]
AUTO_FOR = ("all", "business", "known")      # who may be answered by the assistant itself on this platform
ALERTS = ("all", "urgent", "off")            # which of this platform's messages may alert the owner
# phone_auto: may the assistant answer by itself through the phone's own app (WhatsApp/Messenger/IMO read from notifications)?
# OFF by default: the owner switches it on per platform in the app; family and personal people are never answered either way.
DEFAULT: dict[str, Any] = {"enabled": True, "auto_for": "all", "alerts": "all", "hours_on": False, "hours_from": "09:00", "hours_to": "21:00", "phone_auto": False}


def default_block() -> dict[str, dict[str, Any]]:
    return {k: dict(DEFAULT) for k in KEYS}


_KEY = re.compile(r"^[a-z0-9_]{2,40}$")
_PKG = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+){1,8}$")
MAX_CUSTOM = 30


def normalize_custom(raw: Any) -> list[dict[str, Any]]:
    """The owner's own platforms (apps he added with the "add" button): [{"key","name","packages":[...]}], repaired to a safe shape.
    A key can never clash with a built-in platform, and every package name must look like a real Android package."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set(KEYS)
    for item in (raw if isinstance(raw, list) else [])[:MAX_CUSTOM]:
        if not isinstance(item, dict):
            continue
        key, name = str(item.get("key") or "").strip().lower(), str(item.get("name") or "").strip()[:40]
        pkgs = [str(p).strip() for p in (item.get("packages") if isinstance(item.get("packages"), list) else [])[:8] if _PKG.match(str(p).strip())]
        if not (_KEY.match(key) and name and pkgs) or key in seen:
            continue
        seen.add(key)
        out.append({"key": key, "name": name, "packages": pkgs})
    return out


def platform_key(contact: Any, custom: Any = None) -> str:
    """Which platform a conversation belongs to. `custom` = the owner's own added platforms (they win over the built-in list)."""
    channel = getattr(contact, "channel", None) or "whatsapp"
    if channel == "notif":
        pkg = (getattr(contact, "phone", "") or "").split(":")[1] if ":" in (getattr(contact, "phone", "") or "") else ""
        for c in normalize_custom(custom):
            if pkg in c["packages"]:
                return c["key"]
        for prefix, key in PACKAGES:
            if pkg.startswith(prefix):
                return key
        return "other"
    return {"device": "sms"}.get(channel, channel)


def settings_for(cfg: dict[str, Any], key: str) -> dict[str, Any]:
    raw = ((cfg.get("platforms") or {}).get(key) or {})
    out = dict(DEFAULT)
    if isinstance(raw.get("enabled"), bool):
        out["enabled"] = raw["enabled"]
    if raw.get("auto_for") in AUTO_FOR:
        out["auto_for"] = raw["auto_for"]
    if raw.get("alerts") in ALERTS:
        out["alerts"] = raw["alerts"]
    if isinstance(raw.get("hours_on"), bool):
        out["hours_on"] = raw["hours_on"]
    if isinstance(raw.get("phone_auto"), bool):
        out["phone_auto"] = raw["phone_auto"]
    for k in ("hours_from", "hours_to"):
        v = raw.get(k)
        if isinstance(v, str) and len(v) == 5 and v[2] == ":" and v[:2].isdigit() and v[3:].isdigit() and int(v[:2]) < 24 and int(v[3:]) < 60:
            out[k] = v
    return out


def _mins(hhmm: str) -> int:
    return int(hhmm[:2]) * 60 + int(hhmm[3:])


def inside_hours(s: dict[str, Any], minute_of_day: int) -> bool:
    """True when the platform has no hours limit, or `minute_of_day` (Dhaka time) falls inside it."""
    if not s["hours_on"]:
        return True
    a, b = _mins(s["hours_from"]), _mins(s["hours_to"])
    return (a <= minute_of_day < b) if a <= b else (minute_of_day >= a or minute_of_day < b)


def auto_ok(s: dict[str, Any], category: str | None, known: bool, minute_of_day: int) -> bool:
    """May the assistant answer by itself on this platform for this person right now?"""
    if not s["enabled"] or not inside_hours(s, minute_of_day):
        return False
    if s["auto_for"] == "business":
        return category == "business"
    if s["auto_for"] == "known":
        return known
    return True


def may_alert(s: dict[str, Any], priority: int, is_family: bool) -> bool:
    """Family alerts always pass; otherwise follow the platform's choice."""
    if is_family:
        return True
    if s["alerts"] == "off":
        return False
    if s["alerts"] == "urgent":
        return priority <= 1
    return True
