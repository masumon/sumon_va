"""Is the owner using the phone? The phone tells us (screen on/off, last touch, motion, an optional coarse position).

Used for two things only: a smarter automatic status while the owner has set none ("sleeping" when the phone has been
still and dark at night, "on the road" when the position moves), and a plain "active / idle" line on the dashboard.
Positions are rounded to ~1 km and only the last two are kept; nothing is shared with anybody.
"""
from __future__ import annotations

import copy
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

KEY = "owner_presence"
ACTIVE_S = 300          # touched within 5 minutes = actively using the phone
STILL_S = 45 * 60       # no touch and no motion for 45 minutes = still
MOVE_KM, MOVE_WITHIN = 0.8, timedelta(minutes=25)
DHAKA = timezone(timedelta(hours=6))


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    (la1, lo1), (la2, lo2) = a, b
    p = math.pi / 180
    h = math.sin((la2 - la1) * p / 2) ** 2 + math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


async def record(db: AsyncSession, data: dict[str, Any]) -> None:
    from app.assistant import wa_flow

    now = datetime.now(timezone.utc)
    prev = await load(db)
    fixes = list(prev.get("fixes") or [])
    if data.get("lat") is not None and data.get("lng") is not None:
        fixes.append({"lat": round(float(data["lat"]), 2), "lng": round(float(data["lng"]), 2), "at": now.isoformat()})
    fixes = fixes[-2:]
    pos = prev.get("pos")  # ~100 m precision, used ONLY to match the owner's own saved places; never shown or shared
    if data.get("lat") is not None and data.get("lng") is not None:
        pos = {"lat": round(float(data["lat"]), 3), "lng": round(float(data["lng"]), 3), "at": now.isoformat()}
    out = {"at": now.isoformat(), "screen_on": bool(data.get("screen_on")), "touched_at": (now - timedelta(seconds=int(data.get("interacted_ago_s", 0)))).isoformat(),
           "moved_at": (now - timedelta(seconds=int(data["moved_ago_s"]))).isoformat() if data.get("moved_ago_s") is not None else prev.get("moved_at"), "fixes": fixes, "pos": pos}
    await wa_flow._set_val(db, KEY, json.dumps(out))
    await db.commit()


async def load(db: AsyncSession) -> dict[str, Any]:
    from app.assistant import wa_flow

    try:
        return json.loads(await wa_flow._get_val(db, KEY) or "{}")
    except ValueError:
        return {}


def _t(v: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(v) if v else None
    except ValueError:
        return None


def state(p: dict[str, Any], now: datetime | None = None) -> str:
    """active | idle | still | moving | unknown. `still` = dark and motionless for a long time (probably resting)."""
    now = now or datetime.now(timezone.utc)
    seen, touched, moved = _t(p.get("at")), _t(p.get("touched_at")), _t(p.get("moved_at"))
    if not seen or now - seen > timedelta(minutes=30):
        return "unknown"  # the phone has not reported: never guess
    fx = p.get("fixes") or []
    if len(fx) == 2:
        a, b, ta, tb = (fx[0]["lat"], fx[0]["lng"]), (fx[1]["lat"], fx[1]["lng"]), _t(fx[0]["at"]), _t(fx[1]["at"])
        if ta and tb and tb - ta <= MOVE_WITHIN and now - tb <= MOVE_WITHIN and _km(a, b) >= MOVE_KM:
            return "moving"
    if p.get("screen_on") or (touched and (now - touched).total_seconds() <= ACTIVE_S):
        return "active"
    if (not touched or (now - touched).total_seconds() >= STILL_S) and (not moved or (now - moved).total_seconds() >= STILL_S):
        return "still"
    return "idle"


async def summary(db: AsyncSession) -> dict[str, Any]:
    p = await load(db)
    return {"state": state(p), "seen_at": p.get("at")}


async def apply(db: AsyncSession, cfg: dict[str, Any]) -> dict[str, Any]:
    """Give the status logic what the phone knows (a matched saved place, moving, resting at night) under cfg["_presence"].

    The owner's manual status and weekly schedule still win; wa_brain.current_status decides the order. Nothing is saved.
    """
    if not cfg.get("auto_presence", True):
        return cfg
    p = await load(db)
    out = copy.deepcopy(cfg)
    out["_presence"] = hint(p, cfg)
    return out


def hint(p: dict[str, Any], cfg: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    from app.assistant import timectx

    now = now or datetime.now(timezone.utc)
    st = state(p, now)
    hour = now.astimezone(DHAKA).hour
    key = "driving" if st == "moving" else "sleeping" if st == "still" and (hour >= 22 or hour < 6) else None
    return {"key": key, "place": timectx.detect_place(cfg.get("places"), p.get("pos"), now)}
