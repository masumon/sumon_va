"""Tell the owner about an urgent message — loudly enough, never too often.

Limits come from cfg["limits"]: a daily cap, and quiet hours when only the most urgent (priority 1) may get through.
The alert goes to the owner's Telegram and to the phone app (as an "alert" command the app turns into a loud alarm).
Family and personal messages never put their words in an alert: only "who" and "urgent".
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
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


async def block_reason(db: AsyncSession, cfg: dict[str, Any], priority: int, now: datetime | None = None) -> str:
    """Empty when the alert may go; otherwise a plain-Bangla reason it is held back (it is never silently dropped)."""
    now = now or brain.now_dhaka()
    limits = cfg.get("limits") or {}
    if limits.get("quiet_urgent_only", True) and in_quiet_hours(limits, now) and priority > 1:
        return "নীরব সময়"
    used, cap = await _count_today(db, now.strftime("%Y-%m-%d")), int(limits.get("urgent_per_day", 5))
    if used < cap or (priority == 1 and used < cap + HARD_CEILING_EXTRA):
        return ""
    return "আজকের অ্যালার্ট-সীমা শেষ"


async def allowed(db: AsyncSession, cfg: dict[str, Any], priority: int, now: datetime | None = None) -> bool:
    return not await block_reason(db, cfg, priority, now)


HELD_KEY, HELD_MAX = "inbox_alerts_held", 30


def _load_held(raw: str) -> list[dict[str, Any]]:
    try:
        items = json.loads(raw or "{}").get("items") or []
    except (ValueError, AttributeError):
        return []
    return [i for i in items if isinstance(i, dict)]


async def held_alerts(db: AsyncSession, hours: int = 24) -> list[dict[str, Any]]:
    """Alerts that the limits held back (not yet summarised): who, priority, reason, time. Names only, never message text."""
    cut = (flow.utcnow() - timedelta(hours=hours)).isoformat(timespec="seconds")
    return [i for i in _load_held(await flow._get_val(db, HELD_KEY)) if str(i.get("ts", "")) >= cut]


async def _record_held(db: AsyncSession, who: str, priority: int, reason: str) -> None:
    items = _load_held(await flow._get_val(db, HELD_KEY))
    items.append({"who": who[:60], "p": priority, "why": reason, "ts": flow.utcnow().isoformat(timespec="seconds")})
    await flow._set_val(db, HELD_KEY, json.dumps({"items": items[-HELD_MAX:]}, ensure_ascii=False))
    await db.commit()


async def send_held_digest(db: AsyncSession, cfg: dict[str, Any]) -> int:
    """Once the quiet time is over (and the daily cap has room), tell the owner ONCE what was held back. Returns how many were summarised."""
    now = brain.now_dhaka()
    limits = cfg.get("limits") or {}
    items = await held_alerts(db)
    if not items or in_quiet_hours(limits, now):
        return 0
    names = ", ".join(dict.fromkeys(i["who"] for i in items))[:300]
    text = f"⏸ {brain.bn_digits(len(items))}টি জরুরি বার্তা অপেক্ষায় ছিল ({items[-1].get('why', '')}): {names}। অ্যাপে দেখুন।"
    if telegram.configured() and settings.TELEGRAM_OWNER_ID:
        try:
            await telegram.send_text(settings.TELEGRAM_OWNER_ID, text)
        except Exception:  # noqa: BLE001
            logger.warning("held digest telegram failed", exc_info=True)
    db.add(InboxCommand(device_id=None, kind="alert", target="p2", body=text[:400]))
    await flow._set_val(db, HELD_KEY, json.dumps({"items": []}))
    await db.commit()
    wake.notify()
    return len(items)


async def send_app_digest(db: AsyncSession) -> bool:
    """The phone app's own morning summary (Settings: "প্রতিদিন সারাংশ"): who is waiting and which confirmed tasks are due.

    Goes to the owner only (Telegram + the phone's alert list). Family and private chats appear by name only, never with their words.
    Returns True when something was sent (nothing waiting and nothing due = no message).
    """
    from sqlalchemy import select

    from app.assistant import assignments, privacy
    from app.models.wa import WaTask

    now = flow.utcnow()
    app = WaContact.channel != "whatsapp"  # the website's WhatsApp (Cloud API) has its own summary
    waiting = (await db.execute(select(WaContact).where(WaContact.unread > 0, WaContact.state != "done", WaContact.is_blocked == False, app)  # noqa: E712
                                .order_by(WaContact.priority, WaContact.last_message_at.desc()).limit(50))).scalars().all()
    waiting = [c for c in waiting if c.category != "spam"]
    urgent = [c for c in waiting if c.priority in (1, 2, 4)]
    tasks = (await db.execute(select(WaTask).where(WaTask.is_done == False, WaTask.due_at.isnot(None), WaTask.source != assignments.PROPOSED,  # noqa: E712
                                                   WaTask.due_at <= now + timedelta(days=1)).order_by(WaTask.due_at).limit(20))).scalars().all()
    if not waiting and not tasks:
        return False
    n = brain.bn_digits
    lines = [f"☀ সকালের সারাংশ: {n(len(waiting))} জন উত্তরের অপেক্ষায় (জরুরি {n(len(urgent))} জন), আজকের/মেয়াদোত্তীর্ণ কাজ {n(len(tasks))}টি।"]
    for c in urgent[:5]:
        who = c.name or c.phone.split(":", 1)[-1]
        lines.append(f"• {who}" + ("" if (c.is_family or privacy.is_private(c)) else f": {(c.need or c.summary or '')[:70]}"))
    lines += [f"✓ {t.title[:80]}" for t in tasks[:4]]
    text = "\n".join(lines)
    if telegram.configured() and settings.TELEGRAM_OWNER_ID:
        try:
            await telegram.send_text(settings.TELEGRAM_OWNER_ID, text)
        except Exception:  # noqa: BLE001
            logger.warning("app digest telegram failed", exc_info=True)
    db.add(InboxCommand(device_id=None, kind="alert", target="p3", body=text[:400]))
    await db.commit()
    wake.notify()
    return True


async def push_owner(db: AsyncSession, cfg: dict[str, Any], contact: WaContact, d: "brain.Decision", label: str | None = None) -> bool:
    """Send the alert if the limits allow. Returns True when something was sent."""
    try:
        now = brain.now_dhaka()
        if not platforms.may_alert(platforms.settings_for(cfg, platforms.platform_key(contact, cfg.get("custom_platforms"))), d.priority, bool(contact.is_family)):
            return False
        who = contact.name or contact.phone.split(":", 1)[-1]
        why = await block_reason(db, cfg, d.priority, now)
        if why:
            await _record_held(db, who, d.priority, why)  # held, not lost: shown in the app and summarised once the quiet time ends
            return False
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
