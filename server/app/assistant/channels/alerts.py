"""Tell the owner about an urgent message — loudly enough, never too often.

Limits come from cfg["limits"]: a daily cap, and quiet hours when only the most urgent (priority 1) may get through.
The alert goes to the owner's Telegram and to the phone app (as an "alert" command the app turns into a loud alarm).
Family and personal messages never put their words in an alert: only "who" and "urgent".
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import channels as ch
from app.assistant import wa_brain as brain
from app.assistant import wa_flow as flow
from app.assistant.channels import platforms, telegram, wake
from app.core.config import settings
from app.models.wa import InboxCommand, WaContact

logger = logging.getLogger(__name__)
HARD_CEILING_EXTRA = 5  # priority-1 alerts may pass the daily cap, but never by more than this


def _minutes(hhmm: str, fallback: int) -> int:
    v = brain._hhmm(hhmm)
    return fallback if v is None else v


def in_quiet_hours(limits: dict[str, Any], now: datetime) -> bool:
    start, end = _minutes(limits.get("quiet_from", "23:00"), 23 * 60), _minutes(limits.get("quiet_to", "07:00"), 7 * 60)
    cur = now.hour * 60 + now.minute
    return (start <= cur or cur < end) if start > end else (start <= cur < end)


async def _count_today(db: AsyncSession, today: str) -> int:
    raw = await flow._get_val(db, "inbox_alerts")
    day, _, n = raw.partition(":")
    return int(n) if day == today and n.isdigit() else 0


async def allowed(db: AsyncSession, cfg: dict[str, Any], priority: int, now: datetime | None = None) -> bool:
    now = now or brain.now_dhaka()
    limits = cfg.get("limits") or {}
    if limits.get("quiet_urgent_only", True) and in_quiet_hours(limits, now) and priority > 1:
        return False
    used, cap = await _count_today(db, now.strftime("%Y-%m-%d")), int(limits.get("urgent_per_day", 5))
    return used < cap or (priority == 1 and used < cap + HARD_CEILING_EXTRA)


async def push_owner(db: AsyncSession, cfg: dict[str, Any], contact: WaContact, d: "brain.Decision", label: str | None = None) -> bool:
    """Send the alert if the limits allow. Returns True when something was sent."""
    try:
        now = brain.now_dhaka()
        if not platforms.may_alert(platforms.settings_for(cfg, platforms.platform_key(contact, cfg.get("custom_platforms"))), d.priority, bool(contact.is_family)):
            return False
        if not await allowed(db, cfg, d.priority, now):
            return False
        who = contact.name or contact.phone.split(":", 1)[-1]
        label = label or flow.PRIO_LABEL.get(d.priority, "")
        if contact.is_family:
            text = f"👪 পরিবার · {who} — {label or 'বার্তা'} (ভেতরের কথা এখানে নেই, অ্যাপে দেখুন)"
        else:
            text = f"{ch.icon(contact.channel)} {ch.label(contact.channel)} · {who} · {label}" + (f"\n{d.summary[:200]}" if d.summary else "")
        if telegram.configured() and settings.TELEGRAM_OWNER_ID:
            try:
                await telegram.send_text(settings.TELEGRAM_OWNER_ID, text)
            except Exception:  # noqa: BLE001 — a failed alert must never break the reply flow
                logger.warning("owner telegram alert failed", exc_info=True)
        db.add(InboxCommand(device_id=None, kind="alert", target=f"p{d.priority}", body=text[:400]))
        today = now.strftime("%Y-%m-%d")
        await flow._set_val(db, "inbox_alerts", f"{today}:{await _count_today(db, today) + 1}")
        await db.commit()
        wake.notify()
        return True
    except Exception:  # noqa: BLE001
        logger.exception("push_owner failed")
        await db.rollback()
        return False
