"""What time and place mean to a person in Bangladesh, as plain facts the assistant (and its AI prompts) can rely on.

Pure functions only: no database, no network. The day-part names are the ones people actually say in Sylhet and Dhaka:
ভোর (before sunrise), সকাল, দুপুর, বিকাল, সন্ধ্যা, রাত, মাঝরাত.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any

DHAKA = timezone(timedelta(hours=6))
WEEKDAYS_BN = ["সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার", "রবিবার"]
WEEKDAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
# (from hour inclusive, to hour exclusive, bn, en)
_PARTS = [(0, 4, "মাঝরাত", "after midnight"), (4, 6, "ভোর", "dawn"), (6, 12, "সকাল", "morning"), (12, 15, "দুপুর", "noon and early afternoon"),
          (15, 18, "বিকাল", "late afternoon"), (18, 20, "সন্ধ্যা", "evening"), (20, 24, "রাত", "night")]
_BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")


def bn_num(n: Any) -> str:
    return str(n).translate(_BN_DIGITS)


def time_context(now: datetime | None = None) -> dict[str, Any]:
    now = (now or datetime.now(DHAKA)).astimezone(DHAKA)
    h = now.hour
    bn, en = next((b, e) for a, z, b, e in _PARTS if a <= h < z)
    minute = h * 60 + now.minute
    friday = now.weekday() == 4
    return {"day_part_bn": bn, "day_part_en": en, "weekday_bn": WEEKDAYS_BN[now.weekday()], "weekday_en": WEEKDAYS_EN[now.weekday()],
            "is_friday": friday, "is_jumma_time": friday and 12 * 60 <= minute <= 14 * 60 + 30,
            "is_late_night": h >= 23 or h < 5, "hhmm": f"{h:02d}:{now.minute:02d}"}


def greeting(now: datetime | None = None, lang: str = "bn") -> str:
    """A salam that fits the hour. Never 'good morning' at night."""
    c = time_context(now)
    part = c["day_part_bn"]
    if lang == "en":
        tail = {"মাঝরাত": "", "ভোর": " Good morning.", "সকাল": " Good morning.", "দুপুর": " Good afternoon.", "বিকাল": " Good afternoon.", "সন্ধ্যা": " Good evening.", "রাত": ""}[part]
        return "Assalamu alaikum." + tail
    tail = {"মাঝরাত": "", "ভোর": " শুভ সকাল।", "সকাল": " শুভ সকাল।", "দুপুর": " শুভ দুপুর।", "বিকাল": " শুভ বিকাল।", "সন্ধ্যা": " শুভ সন্ধ্যা।", "রাত": ""}[part]
    if c["is_jumma_time"]:
        tail = " জুমার দিনের শুভেচ্ছা।"
    return "আসসালামু আলাইকুম।" + tail


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p = math.pi / 180
    h = math.sin((la2 - la1) * p / 2) ** 2 + math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2
    return 12742000 * math.asin(math.sqrt(min(1.0, h)))


def normalize_places(raw: Any) -> list[dict[str, Any]]:
    """Keep only well-formed places (max 30). Bad lat/lng, empty label or duplicate keys are dropped."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, p in enumerate(raw if isinstance(raw, list) else []):
        if not isinstance(p, dict):
            continue
        try:
            lat, lng = float(p.get("lat")), float(p.get("lng"))
            radius = int(p.get("radius_m") or 300)
        except (TypeError, ValueError):
            continue
        label = str(p.get("label") or "").strip()[:60]
        if not label or not (-90 <= lat <= 90) or not (-180 <= lng <= 180) or math.isnan(lat) or math.isnan(lng):
            continue
        key = (str(p.get("key") or "").strip()[:40] or f"place{i + 1}")
        if key in seen:
            continue
        seen.add(key)
        item = {"key": key, "label": label, "say": str(p.get("say") or "").strip()[:200] or "{owner} এখন " + label + "-এ আছেন।",
                "lat": lat, "lng": lng, "radius_m": max(50, min(radius, 20000))}
        if str(p.get("say_en") or "").strip():
            item["say_en"] = str(p["say_en"]).strip()[:200]
        out.append(item)
        if len(out) >= 30:
            break
    return out


def detect_place(places: Any, pos: dict[str, Any] | None, now: datetime | None = None, max_age_min: int = 30) -> dict[str, Any] | None:
    """The nearest saved place whose radius contains the (fresh) position, else None."""
    if not pos or not places:
        return None
    now = now or datetime.now(timezone.utc)
    try:
        at = datetime.fromisoformat(pos.get("at"))
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        here = (float(pos["lat"]), float(pos["lng"]))
    except (TypeError, ValueError, KeyError):
        return None
    if now - at > timedelta(minutes=max_age_min) or at - now > timedelta(minutes=5):
        return None  # old (or impossible) location: never guess where he is
    best, best_d = None, None
    for p in normalize_places(places):
        d = haversine_m(here, (p["lat"], p["lng"]))
        if d <= p["radius_m"] and (best_d is None or d < best_d):
            best, best_d = p, d
    return best


def context_block(now: datetime | None, status: dict[str, Any] | None) -> str:
    """The short time/place block placed in every AI prompt that writes words for the owner."""
    c = time_context(now)
    active = bool(status and status.get("key") not in (None, "free") and (status.get("say") or "").strip())
    lines = [f"TIME CONTEXT (facts): local time {c['hhmm']} in Bangladesh, {c['day_part_bn']} ({c['day_part_en']}), {c['weekday_bn']} ({c['weekday_en']})."]
    if c["is_jumma_time"]:
        lines.append("It is Friday, Jumma prayer time.")
    elif c["is_friday"]:
        lines.append("It is Friday (Jumma day).")
    if c["is_late_night"]:
        lines.append("It is late at night.")
    if active:
        lines.append(f"CURRENT STATUS (set by the owner or his schedule/place, reason: {status.get('source', '')}): {status['say']}")
        if status.get("source") == "place":
            lines.append("The status above names where he is; you may mention that place.")
    else:
        lines.append("CURRENT STATUS: none. Do NOT say or imply the owner is sleeping, resting, busy, praying, in a meeting, travelling or at any place.")
    lines.append("RULES: match the tone to the time (calm and short late at night, a warm greeting in the morning, no 'good morning' at night or "
                 "'good night' in the day); mention a status or place ONLY if the status line above says so; never promise a time; never invent facts.")
    return "\n".join(lines)
