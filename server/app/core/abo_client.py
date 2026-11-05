"""Tiny read-only client for ABO's integration API. Never touches ABO's database.

Off unless ABO_API_BASE and ABO_INTEGRATION_TOKEN are both set. Requests are signed (HMAC over timestamp + path) so a captured
request cannot be replayed later. Only four counters come back; any failure returns zeros plus a reason, never an exception.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import time
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)
_ZERO = {"pending_orders": 0, "pending_bookings": 0, "new_leads": 0, "new_applications": 0}
_PATH = "/api/v1/integrations/va/summary"


def configured() -> bool:
    return bool(settings.ABO_API_BASE and settings.ABO_INTEGRATION_TOKEN)


def sign(token: str, ts: str, method: str, path: str) -> str:
    return hmac.new(token.encode(), f"{ts}.{method}.{path}".encode(), hashlib.sha256).hexdigest()


async def summary() -> dict[str, Any]:
    if not configured():
        return {**_ZERO, "available": False, "reason": "not_configured"}
    ts = str(int(time.time()))
    headers = {"Authorization": f"Bearer {settings.ABO_INTEGRATION_TOKEN}", "X-VA-Timestamp": ts,
               "X-VA-Signature": sign(settings.ABO_INTEGRATION_TOKEN, ts, "GET", _PATH)}
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(settings.ABO_API_BASE.rstrip("/") + _PATH, headers=headers)
        if r.status_code != 200:
            return {**_ZERO, "available": False, "reason": f"http_{r.status_code}"}
        d = r.json().get("data") or {}
        return {**{k: int(d.get(k, 0) or 0) for k in _ZERO}, "available": True}
    except Exception:  # noqa: BLE001 — a dashboard number must never break the app
        logger.exception("abo summary failed")
        return {**_ZERO, "available": False, "reason": "unreachable"}
