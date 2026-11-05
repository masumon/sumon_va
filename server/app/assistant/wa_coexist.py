"""Coexistence extras — the WhatsApp Business app and the assistant on one number.

Meta sends extra webhook kinds in that setup: `history` (old chats), `smb_app_state_sync` (phone contacts),
`account_update` (connection lost/back), and `edit` / `revoke` / `unsupported` messages. Everything here only
*stores or warns*: an imported old chat never makes the assistant answer anybody.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import wa_brain as brain
from app.assistant import wa_flow as flow
from app.core.notifications import create_notification
from app.models.wa import WaContact, WaMessage

IMPORTED = "imported"  # WaMessage.status of a message that came from the phone app's history
STATE_KEY = "wa_history_state"
LOST_KEY = "wa_connection_lost"
MAX_IMPORT = 20000  # per webhook; Meta says one webhook can hold thousands of messages
DELETED_TEXT = "[এই বার্তাটি মুছে ফেলা হয়েছে]"
SETUP_LINK = "/sumon/whatsapp?tab=setup"

TextOf = Callable[[dict[str, Any]], tuple[str, str, str]]

LOST_REASONS = {  # account_update → disconnection_info.reason
    "PRIMARY_INACTIVITY": "ফোনের WhatsApp Business অ্যাপ প্রায় ১৪ দিন খোলা হয়নি",
    "COMPANION_INACTIVITY": "সংযুক্ত অন্য ডিভাইস প্রায় ৩০ দিন ব্যবহার হয়নি",
    "USER_RE_REGISTERED": "নম্বরটি নতুন ফোনে চালু করা হয়েছে",
    "CHANGE_NUMBER": "ফোনের নম্বর বদলানো হয়েছে",
    "BUSINESS_DOWNGRADE": "নম্বরটি সাধারণ WhatsApp অ্যাপে নেওয়া হয়েছে",
    "ACCOUNT_DISCONNECTED": "WhatsApp অ্যাকাউন্টটি বিচ্ছিন্ন হয়েছে (আপনি মুছে ফেলেছেন বা WhatsApp ব্যবস্থা নিয়েছে)",
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dt(ts: Any) -> datetime | None:
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


async def alert(db: AsyncSession, key: str, title: str, body: str, hours: float = 6, severity: str = "warning") -> None:
    """One bell notification per `key` per `hours` (a Meta retry or a burst never floods the bell)."""
    last = brain._parse_dt(await flow._get_val(db, f"wa_alert_{key}"))
    if last and _now() - last < timedelta(hours=hours):
        return
    await flow._set_val(db, f"wa_alert_{key}", _now().isoformat(timespec="seconds"))
    await create_notification(db, type="wa_connection", severity=severity, title=title, body=body, link=SETUP_LINK)


# ── connection changes ─────────────────────────────────────────────────────────

async def account_update(db: AsyncSession, val: dict[str, Any]) -> bool:
    ev = str(val.get("event") or "")
    if ev == "PARTNER_REMOVED":
        info = val.get("disconnection_info") or {}
        why = LOST_REASONS.get(str(info.get("reason")), "কারণ জানানো হয়নি")
        by = "আপনার দিক থেকে" if info.get("initiated_by") == "USER" else "WhatsApp-এর সিস্টেম থেকে"
        await flow._set_val(db, LOST_KEY, why)
        await alert(db, "lost", "WhatsApp সংযোগ কেটে গেছে — সহকারী এখন উত্তর দিতে পারছে না",
                    f"{why} ({by})। ফোনের অ্যাপ থেকে নম্বরটি আবার Cloud API-তে যুক্ত করতে হবে; আগে কী করবেন সংযোগ ট্যাবে দেখুন।", hours=1)
        return True
    if ev == "ACCOUNT_OFFBOARDED":
        await flow._set_val(db, LOST_KEY, "নম্বরটি অন্য ফোনে বা নতুন করে নিবন্ধিত হয়েছে")
        await alert(db, "lost", "WhatsApp অ্যাকাউন্ট বিচ্ছিন্ন (offboarded)", "নম্বরটি নতুন ডিভাইসে নিবন্ধিত হওয়ায় সংযোগ কেটেছে। আবার যুক্ত না করলে সহকারী উত্তর দেবে না।", hours=1)
        return True
    if ev == "ACCOUNT_RECONNECTED":
        await flow._set_val(db, LOST_KEY, "")
        await alert(db, "back", "WhatsApp সংযোগ ফিরে এসেছে", "সহকারী আবার বার্তা পাচ্ছে।", hours=1, severity="info")
        return True
    return False


# ── messages that are not plain new texts ──────────────────────────────────────

async def edit_or_revoke(db: AsyncSession, m: dict[str, Any], text_of: TextOf) -> bool:
    """A person edited or deleted a message: change the stored one instead of making a new (junk) message."""
    t = m.get("type")
    if t not in ("edit", "revoke"):
        return False
    body = m.get(t) or {}
    orig = body.get("original_message_id")
    row = (await db.execute(select(WaMessage).where(WaMessage.wa_id == orig, WaMessage.direction == "in"))).scalar_one_or_none() if orig else None
    if row:
        if t == "revoke":
            row.body, row.transcript = DELETED_TEXT, None
            row.meta = {**(row.meta or {}), "revoked": True}
        else:
            _, text, _ = text_of(body.get("message") or {})
            if text:
                row.body = text[:4000]
                row.meta = {**(row.meta or {}), "edited": True}
    return True


async def unsupported(db: AsyncSession, m: dict[str, Any]) -> bool:
    """Meta's “unsupported” (error 131060): the person did write — tell the owner to look at the phone, store nothing."""
    if m.get("type") != "unsupported":
        return False
    who = str(m.get("from") or "")[-4:]
    await alert(db, f"unsup-{who}", "একটি বার্তা এখানে আসেনি — ফোনের WhatsApp-এ দেখুন",
                f"কেউ (…{who}) বার্তা পাঠিয়েছে যা সহকারী পড়তে পারেনি (নতুন ধরনের বার্তা বা অসমর্থিত ডিভাইস)। ফোনের অ্যাপে দেখে নিন।", hours=0.17, severity="info")
    return True


# ── imports (never answered) ───────────────────────────────────────────────────

async def history(db: AsyncSession, cfg: dict[str, Any], val: dict[str, Any], text_of: TextOf) -> int:
    """Old chats shared by the owner (up to 180 days) → stored as `imported`: readable, useful as context, never answered."""
    biz = brain.normalize_phone((val.get("metadata") or {}).get("display_phone_number", ""))
    keep_from = _now() - timedelta(days=max(7, int(cfg.get("retention_days", 90))))  # older ones would be purged at once
    added, progress, declined = 0, None, False
    for h in val.get("history") or []:
        if h.get("errors"):
            declined = declined or any(str(e.get("code")) == "2593109" for e in h["errors"])
            continue
        md = h.get("metadata") or {}
        progress = md.get("progress", progress)
        for th in h.get("threads") or []:
            phone = brain.normalize_phone(str(th.get("id") or ""))
            msgs = [x for x in th.get("messages") or [] if x.get("id")]
            if not phone or not msgs:
                continue
            have = set((await db.execute(select(WaMessage.wa_id).where(WaMessage.wa_id.in_([x["id"] for x in msgs])))).scalars().all())
            contact: WaContact | None = None
            for x in msgs:
                ts = _dt(x.get("timestamp"))
                if x["id"] in have or not ts or ts < keep_from or added >= MAX_IMPORT:
                    continue
                if x.get("type") == "media_placeholder":
                    kind, body = "other", "[ছবি/ভিডিও/ফাইল — পুরনো চ্যাট থেকে]"
                else:
                    kind, body, _ = text_of(x)
                out = bool(x.get("to")) or (bool(biz) and brain.normalize_phone(str(x.get("from") or "")) == biz)
                contact = contact or await flow.upsert_contact(db, phone, None)
                db.add(WaMessage(contact_id=contact.id, direction="out" if out else "in", wa_id=x["id"], kind=kind, body=body[:4000],
                                 status=IMPORTED, reason="owner" if out else None, created_at=ts, meta={"imported": True, "phase": md.get("phase")}))
                if contact.last_message_at is None or ts > contact.last_message_at:
                    contact.last_message_at = ts
                added += 1
    try:
        old = json.loads(await flow._get_val(db, STATE_KEY) or "{}")
    except ValueError:
        old = {}
    old = old if isinstance(old, dict) else {}
    await flow._set_val(db, STATE_KEY, json.dumps({
        "at": _now().isoformat(timespec="seconds"), "progress": progress if progress is not None else old.get("progress"),
        "count": int(old.get("count", 0)) + added, "declined": declined or bool(old.get("declined") and not added)}))
    return added


async def contacts_sync(db: AsyncSession, val: dict[str, Any]) -> int:
    """Names from the phone's address book → filled in for people we already know (no empty contacts are created)."""
    names: dict[str, str] = {}
    for s in (val.get("state_sync") or [])[:5000]:
        c = s.get("contact") or {}
        phone = brain.normalize_phone(str(c.get("phone_number") or ""))
        name = str(c.get("full_name") or c.get("first_name") or "").strip()
        if s.get("type") == "contact" and s.get("action") == "add" and phone and name:
            names[phone] = name
    if not names:
        return 0
    rows = (await db.execute(select(WaContact).where(WaContact.phone.in_(list(names))))).scalars().all()
    n = 0
    for c in rows:
        if not c.name:
            c.name, n = names[c.phone][:120], n + 1
    return n
