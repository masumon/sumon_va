"""Database-side flow of the personal WhatsApp assistant: store a message, decide, queue/draft/send, housekeeping.

The HTTP layer (routes/wa_assistant.py) stays thin; the pure decisions live in wa_brain.py.
"""
from __future__ import annotations

import asyncio
import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import assignments
from app.assistant import identity
from app.assistant import call_context as call_ctx
from app.assistant import presence, privacy
from app.assistant import task_details
from app.assistant import thread_state as ts
from app.assistant import wa_brain as brain
from app.assistant import wa_config as wcfg
from app.assistant import wa_send
from app.assistant import channels as chan
from app.assistant.channels import alerts, dispatch, platforms, wake
from app.core.database import AsyncSessionLocal
from app.core.notifications import create_notification
from app.models.models import Setting
from app.models.wa import InboxCommand, WaContact, WaMessage, WaNote, WaTask

logger = logging.getLogger(__name__)
WINDOW = timedelta(hours=24)
PRIO_LABEL = {1: "জরুরি", 2: "টাকা/পরিবার", 3: "নতুন কাজ", 4: "বিরক্ত/বারবার", 5: "সাধারণ"}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def upsert_contact(db: AsyncSession, phone: str, name: str | None) -> WaContact:
    c = (await db.execute(select(WaContact).where(WaContact.phone == phone))).scalar_one_or_none()
    if c:
        if name and not c.name:
            c.name = name[:120]
        return c
    c = WaContact(phone=phone, name=(name or None) and name[:120])
    db.add(c)
    await db.flush()
    return c


async def recent_messages(db: AsyncSession, contact_id: "uuid.UUID | list[uuid.UUID]", n: int = 14) -> list[dict[str, Any]]:
    """Newest first. `contact_id` may be a list: all the contacts of ONE linked person (identity.py)."""
    where = WaMessage.contact_id.in_(contact_id) if isinstance(contact_id, (list, tuple, set)) else WaMessage.contact_id == contact_id
    rows = (await db.execute(select(WaMessage).where(where).order_by(WaMessage.created_at.desc()).limit(n))).scalars().all()
    return [{"id": m.id, "direction": m.direction, "body": privacy.unseal(m.transcript or m.body), "reason": m.reason, "status": m.status,
             "created_at": m.created_at, "meta": m.meta or {}} for m in rows]


async def mark_dismissed(db: AsyncSession, key: str, at: datetime | None) -> bool:
    """The phone says the owner dismissed this chat's notification. Stored on the person's latest incoming message as
    `dismissed_at`: it is NOT a read receipt (a swipe, another device or a bulk clear look the same). Returns True when stored."""
    contact = (await db.execute(select(WaContact).where(WaContact.phone == key))).scalar_one_or_none()
    if not contact:
        return False
    rows = (await db.execute(select(WaMessage).where(WaMessage.contact_id == contact.id, WaMessage.direction == "in")
                             .order_by(WaMessage.created_at.desc()).limit(5))).scalars().all()
    last = next((m for m in rows if not call_ctx.is_call({"meta": m.meta, "body": m.body})), None)
    if not last or (last.meta or {}).get("dismissed_at"):
        return False
    last.meta = {**(last.meta or {}), "dismissed_at": (at or utcnow()).isoformat(timespec="seconds")}
    return True


async def active_notes(db: AsyncSession, contact_id: uuid.UUID) -> list[str]:
    now = utcnow()
    rows = (await db.execute(select(WaNote).where(WaNote.contact_id == contact_id, WaNote.is_active == True)  # noqa: E712
                             .order_by(WaNote.created_at))).scalars().all()
    return [n.text for n in rows if n.until is None or n.until > now]


ORDER_BN = {"pending": "অপেক্ষমাণ", "confirmed": "নিশ্চিত হয়েছে", "processing": "প্রস্তুত হচ্ছে", "shipped": "পাঠানো হয়েছে",
            "delivered": "পৌঁছে গেছে", "completed": "সম্পন্ন হয়েছে", "cancelled": "বাতিল হয়েছে", "in_progress": "কাজ চলছে"}
_STATUS_WORDS = ["অর্ডার", "order", "বুকিং", "booking", "ডেলিভারি", "delivery", "কুরিয়ার", "কতদূর", "কবে পাব", "কবে পাবো"]


async def abo_order_facts(db: AsyncSession, cfg: dict[str, Any], contact: WaContact, body: str) -> list[str]:
    """Sumon VA keeps no ABO shop data: the person's order status is not looked up here (see docs/TRANSFER.md, ABO integration)."""
    return []


async def abo_lead(db: AsyncSession, cfg: dict[str, Any], contact: WaContact, d: "brain.Decision") -> None:
    """Sumon VA never writes ABO leads: no-op kept so callers stay unchanged."""
    return None


def explain_mode(cfg: dict[str, Any], contact: WaContact) -> tuple[str, str]:
    """(auto | draft, the rule that decided it, in plain Bangla). The ONE place the order lives; `effective_mode` just returns the first part.

    Order, first match wins (a lower rule can never override a higher one): global "drafts only" switch -> person approved in Telegram
    -> the platform / channel may not answer by itself -> the category (personal/social/family) is draft-only -> the platform's own
    people/hours limits -> the person's own "draft" choice -> auto. An explicit "auto" for THIS person beats the platform and channel
    defaults, never the global switch and never the personal/family category rule."""
    if cfg.get("mode") != "auto":
        return "draft", "সাধারণ সেটিং: এখন শুধু খসড়া (পরীক্ষামূলক মোড)"
    plat = platforms.settings_for(cfg, platforms.platform_key(contact, cfg.get("custom_platforms")))  # the platform's own choices: who, and during which hours
    channel = contact.channel or "whatsapp"
    explicit = getattr(contact, "mode", None) == "auto" and channel in ("whatsapp", "telegram", "sms", "notif")
    if getattr(contact, "mode", None) == "telegram":
        return "draft", "ব্যক্তি: আপনি Telegram-এ অনুমোদন করবেন"
    if channel == "notif":
        if not (plat.get("phone_auto") or explicit):  # the phone's own chat apps: only when the owner switched it on
            return "draft", "প্ল্যাটফর্ম: ফোনের চ্যাট অ্যাপে নিজে উত্তর দেওয়া চালু করা নেই"
    elif not (chan.auto_allowed(cfg, channel) or explicit):  # bridge-only channels are never answered by the assistant itself
        return "draft", "চ্যানেল: এই মাধ্যমে সহকারী নিজে উত্তর দেয় না"
    cat = getattr(contact, "category", None)  # personal and social messages only get drafts unless the owner switched that category to auto
    if cat and not (cfg.get("categories") or {}).get(cat, {}).get("auto", True):
        return "draft", f"বিভাগ: “{cat}” বিভাগে নিজে উত্তর বন্ধ"
    known = bool(getattr(contact, "is_vip", False) or getattr(contact, "tags", None))
    if not explicit and not platforms.auto_ok(plat, cat, known, brain.now_dhaka().hour * 60 + brain.now_dhaka().minute):
        return "draft", "প্ল্যাটফর্ম: এই ব্যক্তি বা এই সময়ে নিজে উত্তরের অনুমতি নেই"
    if contact.mode == "draft":
        return "draft", "ব্যক্তি: এই ব্যক্তির জন্য আপনি শুধু খসড়া বেছেছেন"
    return "auto", "সব নিয়ম অনুমতি দিয়েছে" + (" (এই ব্যক্তির জন্য আপনি ‘নিজে’ বেছেছেন)" if explicit else "")


def effective_mode(cfg: dict[str, Any], contact: WaContact) -> str:
    """auto | draft. Global "shadow" (test phase) forces drafts for everyone. See explain_mode for the order and the reason."""
    return explain_mode(cfg, contact)[0]


# ── sending ───────────────────────────────────────────────────────────────────

async def deliver(db: AsyncSession, msg_id: uuid.UUID) -> bool:
    """Send one queued message. Claims it first so cron and the in-process timer can never both send."""
    claimed = await db.execute(update(WaMessage).where(WaMessage.id == msg_id, WaMessage.status == "queued")
                               .values(status="sending").returning(WaMessage.id))
    if claimed.first() is None:
        await db.rollback()
        return False
    await db.commit()
    msg = await db.get(WaMessage, msg_id)
    contact = await db.get(WaContact, msg.contact_id) if msg else None
    if not msg or not contact:
        return False
    if (contact.channel or "whatsapp") != "whatsapp":
        return await dispatch.deliver_other(db, msg, contact)
    if not contact.phone.isdigit():
        msg.status, msg.error = "failed", "এই ব্যক্তি WhatsApp username ব্যবহার করছেন, ফোন নম্বর পাওয়া যায়নি — এখান থেকে উত্তর পাঠানো যায় না, সরাসরি WhatsApp-এ উত্তর দিন"
        await db.commit()
        return False
    assistant_reply = (msg.reason or "") not in ("owner", "manual")
    if assistant_reply and (contact.is_blocked or contact.state == "owner"):
        msg.status, msg.error = "skipped", "আপনি নিজে নিয়েছেন বা নম্বর ব্লক — পাঠানো হয়নি"
    elif contact.last_inbound_at is None or utcnow() - contact.last_inbound_at > WINDOW:
        msg.status, msg.error = "failed", "২৪ ঘণ্টা পার — এই সময়ের পর শুধু অনুমোদিত টেমপ্লেট পাঠানো যায়"
    else:
        try:
            msg.wa_id = (await wa_send.send_text(await wcfg.get_secrets(db), contact.phone, privacy.unseal(msg.body) or "")) or msg.wa_id  # stored text of private people is encrypted: send the real words, never "enc1:..."
            msg.status, msg.sent_at, msg.delivery, msg.error = "sent", utcnow(), "sent", None
            contact.last_outbound_at = msg.sent_at
        except wa_send.SendError as exc:
            err, tries = str(exc)[:290], int((msg.meta or {}).get("rl", 0))
            if "#131056" in err and tries < 4:  # Meta: one message per 6 s to the same person → try again after 4^n seconds
                msg.status, msg.error, msg.send_after = "queued", None, utcnow() + timedelta(seconds=4 ** (tries + 1))
                msg.meta = {**(msg.meta or {}), "rl": tries + 1}
            else:
                msg.status, msg.error = "failed", err
                if any(c in err for c in AUTH_CODES):
                    await _alert_token(db)
    await db.commit()
    return msg.status == "sent"


AUTH_CODES = ("#190", "#131005", "টোকেন")  # errors that mean "the token is dead or not allowed to send"


async def _alert_token(db: AsyncSession) -> None:
    """One bell notification (at most every 6 hours) when sending fails because of the token."""
    last = brain._parse_dt(await _get_val(db, "wa_token_alert_at"))
    if last and utcnow() - last < timedelta(hours=6):
        return
    await _set_val(db, "wa_token_alert_at", utcnow().isoformat(timespec="seconds"))
    await create_notification(db, type="wa_token", severity="warning", title="WhatsApp উত্তর যাচ্ছে না — টোকেন বদলাতে হবে",
                              body="Meta টোকেনটি নিচ্ছে না। System user-এর স্থায়ী টোকেন বানিয়ে সংযোগ ট্যাবে বসান; আটকে থাকা উত্তর নিজেই আবার যাবে।",
                              link="/sumon/whatsapp?tab=setup")


async def _later(msg_id: uuid.UUID, seconds: float) -> None:
    """Best-effort timer; cron is the guarantee (the free server can sleep)."""
    await asyncio.sleep(seconds)
    async with AsyncSessionLocal() as db:
        await deliver(db, msg_id)


# ── inbound ───────────────────────────────────────────────────────────────────

async def _notify(db: AsyncSession, cfg: dict[str, Any], contact: WaContact, d: brain.Decision, recent: list[dict[str, Any]], force: bool = False) -> bool:
    if not (d.notify and cfg.get("notify", {}).get("urgent", True)):
        return False
    cut = utcnow() - timedelta(minutes=10)
    if not force and any((m.get("meta") or {}).get("notified") and m["created_at"] >= cut for m in recent if m["direction"] == "in"):
        return False
    who = contact.name or contact.phone
    if wcfg.scope_for_channel(contact.channel) == "app":
        # The phone app's conversations alert only in the app (phone alarm + its Telegram bot), never in the website's bell.
        await alerts.push_owner(db, cfg, contact, d)
        return True
    await create_notification(db, type="wa_message", severity="warning" if d.priority in (1, 2, 4) else "info",
                              title=f"WhatsApp · {who} · {PRIO_LABEL.get(d.priority, '')}", body=d.summary or None,
                              link=f"/sumon/whatsapp?c={contact.id}", meta={"contact_id": str(contact.id), "priority": d.priority})
    await alerts.push_owner(db, cfg, contact, d)
    return True


async def _transcribe(db: AsyncSession, cfg: dict[str, Any], media_id: str) -> str | None:
    if not (cfg.get("ai", {}).get("enabled") and cfg["ai"].get("voice") and media_id):
        return None
    try:
        from app.assistant import ai_hub

        mime, data = await wa_send.fetch_media(await wcfg.get_secrets(db), media_id)
        out = await ai_hub.run(db, "vision", "Transcribe this voice message exactly as spoken, in its original language (Bangla/Sylheti/English). "
                               "Output only the text. If it is unintelligible output nothing.", "Transcribe.", images=[(mime, data)], max_tokens=500)
        return out.strip()[:1500] or None
    except Exception as exc:  # noqa: BLE001 — never block the flow; the owner will just see "voice"
        logger.info("wa transcribe skipped: %s", type(exc).__name__)
        return None


async def _transcribe_telegram(db: AsyncSession, cfg: dict[str, Any], file_id: str) -> str | None:
    if not (cfg.get("ai", {}).get("enabled") and cfg["ai"].get("voice") and file_id):
        return None
    try:
        from app.assistant import ai_hub
        from app.assistant.channels import telegram

        mime, data = await telegram.fetch_file(file_id)
        out = await ai_hub.run(db, "vision", "Transcribe this voice message exactly as spoken, in its original language (Bangla/Sylheti/English). "
                               "Output only the text. If it is unintelligible output nothing.", "Transcribe.", images=[(mime, data)], max_tokens=500)
        return out.strip()[:1500] or None
    except Exception as exc:  # noqa: BLE001 - never block the flow
        logger.info("telegram transcribe skipped: %s", type(exc).__name__)
        return None


async def _group_gate(msg_id: uuid.UUID) -> bool:
    """True = go on now. Messages from one person inside the grouping window are answered ONCE: every message waits the window,
    and only the last one of the burst carries on (it reads the whole burst, see ts.grouped_text). Urgent ones, calls and group
    chats never wait. No database connection is held while waiting (the free server has few)."""
    async with AsyncSessionLocal() as db:
        msg = await db.get(WaMessage, msg_id)
        contact = await db.get(WaContact, msg.contact_id) if msg else None
        if not msg or not contact or msg.direction != "in" or (msg.meta or {}).get("group") or call_ctx.is_call({"meta": msg.meta, "body": msg.body}):
            return True
        wcfg.use_scope(wcfg.scope_for_channel(contact.channel))
        cfg = await wcfg.load_config(db)
        window = ts.settings_grouping(cfg)
        if not window or not cfg.get("enabled"):
            return True
        body = privacy.unseal(msg.transcript or msg.body) or ""
        urgent = brain.rule_priority(body, cfg, contact, "other", False)[0] <= 2 or any(t.get("important") for t in (contact.tags or []))
        if urgent:
            return True
        contact_id, created = contact.id, msg.created_at
    await asyncio.sleep(window * 60)
    async with AsyncSessionLocal() as db:
        later = (await db.execute(select(WaMessage).where(WaMessage.contact_id == contact_id, WaMessage.direction == "in", WaMessage.created_at > created)
                                  .limit(20))).scalars().all()
        return not any(not (m.meta or {}).get("group") and not call_ctx.is_call({"meta": m.meta, "body": m.body}) for m in later)


async def process_inbound(msg_id: uuid.UUID) -> None:
    """Background job started by the webhook for each new incoming message."""
    try:
        if not await _group_gate(msg_id):
            return  # a newer message of the same burst will answer for all of them
        async with AsyncSessionLocal() as db:
            await _process(db, msg_id)
        wake.notify()  # a draft or a status change may be waiting: tell the phone's open screens at once
    except Exception:  # noqa: BLE001
        logger.exception("wa process_inbound failed")


async def _process(db: AsyncSession, msg_id: uuid.UUID) -> None:
    msg = await db.get(WaMessage, msg_id)
    contact = await db.get(WaContact, msg.contact_id) if msg else None
    if not msg or not contact:
        return
    if msg.status == "imported":
        return  # history is context only: no draft, no alert, no auto-send
    try:
        await identity.auto_link(db, contact)  # same phone number on another channel = same human (high confidence only; logged, reversible)
    except Exception:  # noqa: BLE001 - linking must never stop a message from being processed
        logger.exception("identity auto_link failed")
        await db.rollback()
        contact = await db.get(WaContact, msg.contact_id)
    person_ids = await identity.person_contact_ids(db, contact)  # [contact.id] while nothing is linked
    wcfg.use_scope(wcfg.scope_for_channel(contact.channel))  # Cloud-API WhatsApp: the website's rules; everything else: the app's
    cfg = await presence.apply(db, await wcfg.load_config(db))
    if not cfg.get("enabled"):
        return
    if not platforms.settings_for(cfg, platforms.platform_key(contact, cfg.get("custom_platforms")))["enabled"]:
        return  # this platform is paused in its own settings: the message stays in the inbox, no draft, no alert
    now = utcnow()
    if contact.state == "done":
        contact.state = "assistant"
    if contact.state == "owner" and contact.hold_until and contact.hold_until <= now:
        contact.state, contact.hold_until = "assistant", None
    transcript = msg.transcript
    if msg.kind == "audio" and not transcript and not privacy.is_private(contact):  # family/personal voice never goes to an AI service
        if (contact.channel or "whatsapp") == "whatsapp":
            transcript = msg.transcript = await _transcribe(db, cfg, (msg.meta or {}).get("media_id", ""))
        elif contact.channel == "telegram":
            transcript = msg.transcript = await _transcribe_telegram(db, cfg, (msg.meta or {}).get("file_id", ""))
    recent = [m for m in await recent_messages(db, contact.id) if m["id"] != msg.id]
    notes = await active_notes(db, contact.id) + await abo_order_facts(db, cfg, contact, msg.body or transcript or "")
    is_missed_call = msg.direction == "in" and call_ctx.is_call({"meta": msg.meta, "body": msg.body})
    text_in, burst_n = (msg.body or "", 1) if is_missed_call or (msg.meta or {}).get("group") or transcript else ts.grouped_text(
        recent, msg.body or "", msg.created_at, ts.settings_grouping(cfg))
    d = await brain.decide(db, cfg, contact, text_in, msg.kind, transcript, recent, notes)
    if burst_n > 1:
        d.note = (d.note + " · " if d.note else "") + f"{burst_n}টি বার্তা একসঙ্গে পড়ে একটি উত্তর"
    call_insight = None
    if is_missed_call:
        # A missed call is not a sentence: explain it from what the inbox really knows, one alert per burst (call_context.py).
        wide = [m for m in await recent_messages(db, person_ids, 60) if m["id"] != msg.id]  # the whole person: SMS + WhatsApp + ...
        tasks = [{"title": t, "due_at": due} for t, due in (await db.execute(
            select(WaTask.title, WaTask.due_at).where(WaTask.is_done == False, WaTask.contact_id.in_(person_ids)).limit(10))).all()]  # noqa: E712
        ins = call_ctx.analyze(cfg, contact, wide, tasks, now, d.priority)
        if call_ctx.apply(d, ins, cfg):
            call_insight = ins
    else:
        late = call_ctx.after_call_note(recent, now)
        if late:
            d.note = f"{d.note} · {late}" if d.note else late
    plain = msg.body or transcript or ""  # before sealing: the owner's own Telegram card shows the words
    via_tg = getattr(contact, "mode", None) == "telegram"

    if (msg.meta or {}).get("group"):  # a group chat: you read it, you answer in the group yourself
        d.reply, d.notify, d.reason, d.note = None, False, "group", "গ্রুপের বার্তা — সহকারী উত্তর লেখে না, আপনি নিজে গ্রুপে উত্তর দেবেন"
    contact.priority, contact.lang = d.priority, d.lang
    if d.category and (contact.category in (None, "", "spam", "social") or d.category == "spam"):
        contact.category = d.category  # a person sorted as business/personal keeps it until the owner changes it
    open_titles = {t for (t,) in (await db.execute(select(WaTask.title).where(WaTask.is_done == False, WaTask.contact_id == contact.id))).all()}  # noqa: E712
    if msg.direction == "in" and not is_missed_call and not (msg.meta or {}).get("group") and d.reason not in ("blocked", "spam"):
        private = privacy.is_private(contact, d.category)
        asked = msg.body or transcript or ""
        for cand in [c for c in assignments.detect(text_in, now) if c["confidence"] in ("high", "medium")]:  # only PROPOSED: the owner confirms
            title = assignments.proposal_title(contact, cand["title_body"], private)
            if title not in open_titles:
                task = WaTask(contact_id=contact.id, title=title, due_at=cand["due_at"], source=assignments.PROPOSED)
                db.add(task)
                await db.flush()
                await task_details.set_details(db, task.id, status="proposed", source_msg_id=msg.id, confidence=cand["confidence"], assigner_contact_id=contact.id)
                open_titles.add(title)
                d.note = (d.note + " · " if d.note else "") + "কাজের অনুরোধ ধরা হয়েছে (প্রস্তাবিত, নিশ্চিত করুন)"
        if assignments.asks_status(text_in) or assignments.asks_status(asked):
            rows = (await db.execute(select(WaTask.id, WaTask.title, WaTask.due_at, WaTask.is_done, WaTask.done_at, WaTask.source).where(WaTask.contact_id.in_(person_ids))
                                     .order_by(WaTask.created_at.desc()).limit(5))).all()
            extra = await task_details.get_details(db, [r[0] for r in rows])  # the owner's own progress/blocker notes (manual_sql/0003)
            known = [{"title": t, "due_at": due, "is_done": done, "done_at": at, "source": src, **extra.get(tid, {})} for tid, t, due, done, at, src in rows]
            d.note = (d.note + " · " if d.note else "") + assignments.status_note(known, now, private)
            d.notify = True  # the owner hears what is really on record; nothing is promised to the person
    if not call_insight:  # a call must not overwrite what we know the person needs / the conversation summary
        contact.need, contact.summary = d.need[:400] or contact.need, d.summary[:600] or contact.summary
    if d.notify and await _notify(db, cfg, contact, d, recent, force=bool(call_insight and call_insight.escalated)):
        msg.meta = {**(msg.meta or {}), "notified": True}
        if call_insight:
            msg.meta = {**msg.meta, "call_alert": {"p": d.priority, "n": call_insight.attempts_burst}}
    for t in d.tasks[:3]:
        if t["title"] not in open_titles:
            due = brain._parse_dt(t.get("due")) if t.get("due") else None
            db.add(WaTask(contact_id=contact.id, title=t["title"][:300], due_at=due, source="ai"))
    msg.meta = {**(msg.meta or {}), "priority": d.priority, "kind": d.kind, "reason": d.reason, "note": d.note, "category": d.category}
    if privacy.is_private(contact, d.category):  # from now on this person's words sit encrypted in the database
        await privacy.seal_contact_messages(db, contact.id)
    await db.commit()
    await abo_lead(db, cfg, contact, d)

    if not d.reply:
        if via_tg and d.reason not in ("spam", "blocked"):  # nothing to draft, but the owner still hears it on Telegram
            await _telegram_card(db, contact, msg, plain, None)
        return
    recent_out = (await db.execute(select(func.count()).select_from(WaMessage).where(
        WaMessage.contact_id == contact.id, WaMessage.direction == "out", WaMessage.created_at >= now - timedelta(hours=1),
        WaMessage.status.in_(("sent", "queued", "sending")), WaMessage.reason.notin_(("owner", "manual"))))).scalar_one()
    if recent_out >= int(cfg.get("per_sender_hour", 10)) and d.priority > 1:
        return
    reply = d.reply
    greeted = reply.lstrip().lower().startswith(("আসসালামু", "assalam", "ওয়া আলাইকুম", "wa alaikum", "শুভ", "good "))
    if not greeted and d.reason not in ("urgent", "identity") and (d.category == "business" or any(brain.has_any(str(t.get("label", "")), cfg.get("tag_client_words") or []) for t in (contact.tags or []))):
        reply = f"{brain.mood_prefix(now.astimezone(brain.DHAKA), d.lang)} {reply}"  # time-aware greeting for clients
    if contact.profile and d.reason not in brain.PROTECTED and not d.reason.startswith("urgent"):
        reply = await brain.polish(db, cfg, reply, contact.profile)
    mode, mode_rule = explain_mode(cfg, contact)
    unanswered = 1
    for m in recent:  # newest first: how many messages from this person are still unanswered (this one included)
        if m["direction"] == "out" and m["status"] in ("sent", "queued", "sending"):
            break
        if m["direction"] == "in":
            unanswered += 1
    why = f"{d.note + ' · ' if d.note else ''}এটি এই ব্যক্তির {unanswered}-তম অনুত্তরিত বার্তা" + (" (বারবার লিখছেন)" if unanswered >= 3 else " (প্রথম বার)" if unanswered == 1 else "")
    if mode == "draft":
        # One draft per person: a new message UPDATES the waiting draft instead of piling up another one.
        # (never the OWNER's own draft, e.g. one made in F0: those words are his and must not be rewritten by the assistant)
        waiting = (await db.execute(select(WaMessage).where(WaMessage.contact_id == contact.id, WaMessage.direction == "out", WaMessage.status == "draft",
                                                            or_(WaMessage.reason.is_(None), WaMessage.reason.notin_(("owner", "manual"))))
                                    .order_by(WaMessage.created_at.desc()).limit(1))).scalar_one_or_none()
        if waiting:
            waiting.body, waiting.meta = reply, {**(waiting.meta or {}), "note": why, "updated": True}
            await db.commit()
            if via_tg:
                await _telegram_card(db, contact, msg, plain, waiting)
            return
        # Your own phone's chats (WhatsApp, Messenger, ...) get a draft only when there is something to answer: a question, work, money, urgent.
        if (contact.channel or "whatsapp") == "notif" and d.priority >= 5 and not brain.is_question(msg.body or transcript or "") and not via_tg:
            return
    delay = random.randint(int(cfg["delay"]["min"]), max(int(cfg["delay"]["min"]), int(cfg["delay"]["max"])))
    if d.priority == 1:
        delay = min(delay, 5)  # the one place we answer fast: "your urgent message reached Sumon"
    out = WaMessage(contact_id=contact.id, direction="out", kind="text", body=reply, reason=d.reason,
                    status="queued" if mode == "auto" else "draft", send_after=now + timedelta(seconds=delay) if mode == "auto" else None,
                    meta={"source": d.source, "ai": d.ai_used, "mode": mode, "note": why, "rule": mode_rule})
    db.add(out)
    await db.commit()
    if mode == "auto":
        asyncio.create_task(_later(out.id, delay + 1))
    elif via_tg:
        await _telegram_card(db, contact, msg, plain, out)


async def _telegram_card(db: AsyncSession, contact: WaContact, msg: WaMessage, text: str, draft: WaMessage | None) -> None:
    from app.assistant.channels import telegram  # local: telegram imports this module
    await telegram.send_approval(db, contact, msg, text, draft)


async def send_task_reminders(db: AsyncSession, now: datetime) -> int:
    """A confirmed (never merely proposed) task is due soon or overdue: tell the owner once per stage. Off by default (`reminders.task_lead_min`)."""
    import json

    cfg = await wcfg.load_config(db, force=True, scope="app")
    lead = int((cfg.get("reminders") or {}).get("task_lead_min", 0) or 0)
    if not lead or not cfg.get("enabled"):
        return 0
    tasks = (await db.execute(select(WaTask).where(WaTask.is_done == False, WaTask.due_at.isnot(None), WaTask.source != assignments.PROPOSED)  # noqa: E712
                              .order_by(WaTask.due_at.asc()).limit(50))).scalars().all()
    try:
        sent_map = json.loads(await _get_val(db, "task_reminders") or "{}")
    except ValueError:
        sent_map = {}
    sent = 0
    for t in tasks:
        kind = assignments.reminder_kind(t.due_at, now, lead, sent_map.get(str(t.id)))
        if not kind:
            continue
        contact = await db.get(WaContact, t.contact_id) if t.contact_id else None
        stand_in = contact or WaContact(phone="task:", channel="device", name="আপনার কাজ", is_family=False, is_vip=False)
        text = (f"⏰ কাজের সময় ঘনিয়েছে: {t.title[:80]}" if kind == "due" else f"⏰ কাজের সময় পেরিয়ে গেছে: {t.title[:80]}")
        d = brain.Decision(priority=3, summary=text, notify=True)
        if await alerts.push_owner(db, cfg, stand_in, d, label="কাজের সময়"):
            sent_map[str(t.id)] = kind
            sent += 1
    if sent:
        live = {str(t.id) for t in tasks}
        await _set_val(db, "task_reminders", json.dumps({k: v for k, v in sent_map.items() if k in live}))
        await db.commit()
    return sent


async def send_unanswered_reminders(db: AsyncSession, now: datetime) -> int:
    """"Nobody answered yet" reminders for the phone app's chats (owner switch `reminders.unanswered_min`, off by default).
    It says only that NO ANSWER WAS FOUND, never that the message was read. A reminder is sent once per waiting message and stops
    by itself as soon as the owner answers (ts.assess sees the answer)."""
    cfg = await wcfg.load_config(db, force=True, scope="app")
    minutes, _ = ts.settings_reminders(cfg)
    if not minutes or not cfg.get("enabled"):
        return 0
    rows = (await db.execute(select(WaContact).where(WaContact.last_inbound_at >= now - timedelta(hours=24), WaContact.last_inbound_at <= now - timedelta(minutes=minutes),
                                                     WaContact.is_blocked == False, WaContact.state != "owner").limit(50))).scalars().all()  # noqa: E712
    sent = 0
    for c in rows:
        if wcfg.scope_for_channel(c.channel) != "app":
            continue
        st = ts.assess(await recent_messages(db, c.id, 20))
        last = await db.get(WaMessage, st.last_in_id) if st.last_in_id else None
        reason = ts.reminder_reason(cfg, c, st, now, bool(last and (last.meta or {}).get("unanswered_reminded")))
        if not reason or not last:
            continue
        d = brain.Decision(priority=max(2, min(c.priority or 4, 4)), summary=("ব্যক্তিগত বার্তা (লেখা সুরক্ষিত)" if privacy.is_private(c) else reason), notify=True)
        d.summary = reason if not privacy.is_private(c) else reason.split(" — ")[0]
        if await alerts.push_owner(db, cfg, c, d, label="উত্তর বাকি"):
            last.meta = {**(last.meta or {}), "unanswered_reminded": True}
            await db.commit()
            sent += 1
    return sent


# ── cron housekeeping ─────────────────────────────────────────────────────────

async def _get_val(db: AsyncSession, key: str) -> str:
    row = (await db.execute(select(Setting).where(Setting.key == key, Setting.is_deleted == False))).scalar_one_or_none()  # noqa: E712
    return row.value if row else ""


async def _set_val(db: AsyncSession, key: str, value: str) -> None:
    row = (await db.execute(select(Setting).where(Setting.key == key))).scalar_one_or_none()
    if row:
        row.value, row.is_deleted = value, False
    else:
        db.add(Setting(key=key, value=value, data_type="string", is_secret=False, is_editable=False, description="WhatsApp সহকারী (স্বয়ংক্রিয়)"))


async def run_cron(db: AsyncSession) -> dict[str, Any]:
    cfg = await wcfg.load_config(db, force=True, scope="web")  # digest / token checks below belong to the website's WhatsApp
    app_cfg = await wcfg.load_config(db, force=True, scope="app")
    out: dict[str, Any] = {"sent": 0, "expired_status": False, "released": 0, "digest": False, "purged": 0}
    now = utcnow()
    for sc, c in (("app", app_cfg),):  # the app's own "busy for 30 min" ends on time too, in the app's settings only
        st = c.get("status") or {}
        until = brain._parse_dt(st.get("until"))
        if c.get("enabled") and st.get("key") != "free" and until and until <= now:
            await wcfg.save_config(db, {"status": {"key": "free", "until": None, "custom": ""}}, scope=sc)
            out["expired_status_app"] = True
    if cfg.get("enabled") or app_cfg.get("enabled"):
        due = (await db.execute(select(WaMessage.id).where(WaMessage.status == "queued", WaMessage.send_after <= now)
                                .order_by(WaMessage.send_after).limit(20))).scalars().all()
        for mid in due:
            out["sent"] += 1 if await deliver(db, mid) else 0
        # stuck "sending" (server restarted mid-send) → failed, never silently re-sent
        stuck_ids = (await db.execute(select(WaMessage.id).where(WaMessage.status == "sending", WaMessage.created_at < now - timedelta(minutes=10)))).scalars().all()
        if stuck_ids:
            await db.execute(update(WaMessage).where(WaMessage.id.in_(stuck_ids))
                             .values(status="failed", error="পাঠানোর মাঝখানে বন্ধ হয়েছিল — আবার পাঠাতে চাইলে নিজে পাঠান"))
            # the phone must not send it later: cancel its still-pending command(s)
            await db.execute(update(InboxCommand).where(InboxCommand.msg_id.in_(stuck_ids), InboxCommand.status == "pending")
                             .values(status="cancelled", done_at=now, error="বার্তাটি ব্যর্থ হয়েছে — বাতিল"))
        # commands the phone never fetched within the alert window are retired so they do not pile up
        await db.execute(update(InboxCommand).where(InboxCommand.status == "pending", InboxCommand.created_at < now - timedelta(hours=1))
                         .values(status="cancelled", done_at=now, error="মেয়াদ শেষ"))
        out["released"] = (await db.execute(update(WaContact).where(WaContact.state == "owner", WaContact.hold_until <= now)
                                            .values(state="assistant", hold_until=None))).rowcount or 0
        saved = brain._parse_dt(await _get_val(db, "wa_token_saved_at"))
        if saved:  # a new token was saved: replies that died with the old one (last 23h only, once each) get another try
            stuck = (await db.execute(select(WaMessage).where(WaMessage.direction == "out", WaMessage.status == "failed",
                                                              WaMessage.created_at >= now - timedelta(hours=23), WaMessage.created_at < saved).limit(30))).scalars().all()
            for m in stuck:
                if any(c in (m.error or "") for c in AUTH_CODES) and not (m.meta or {}).get("auto_retried"):
                    m.status, m.error, m.send_after, m.meta = "queued", None, now, {**(m.meta or {}), "auto_retried": True}
                    out["requeued"] = out.get("requeued", 0) + 1
        st = cfg.get("status") or {}
        until = brain._parse_dt(st.get("until"))
        if cfg.get("enabled") and st.get("key") != "free" and until and until <= now:
            await wcfg.save_config(db, {"status": {"key": "free", "until": None, "custom": ""}}, scope="web")
            out["expired_status"] = True
    await db.commit()
    try:
        out["task_reminded"] = await send_task_reminders(db, now)
    except Exception:  # noqa: BLE001
        logger.exception("task reminders failed")
        await db.rollback()
    try:
        out["reminded"] = await send_unanswered_reminders(db, now)
    except Exception:  # noqa: BLE001 - a reminder must never stop the housekeeping below
        logger.exception("unanswered reminders failed")
        await db.rollback()

    local = brain.now_dhaka()
    today = local.date().isoformat()
    if cfg.get("enabled") and cfg.get("notify", {}).get("digest") and await _get_val(db, "wa_digest_last") != today:
        hh = brain._hhmm(cfg["notify"].get("digest_time", "08:00")) or 480
        if local.hour * 60 + local.minute >= hh:
            await send_digest(db, cfg)
            await _set_val(db, "wa_digest_last", today)
            out["digest"] = True
    if cfg.get("enabled") and await _get_val(db, "wa_token_check_last") != today:
        await _set_val(db, "wa_token_check_last", today)
        await _check_token(db)
    if await _get_val(db, "wa_purge_last") != today:
        purged = 0
        for category in (cfg.get("retention_by_category") or {}):  # personal chats go first, business last
            ids = select(WaContact.id).where(WaContact.category == category, WaContact.is_family == False)  # noqa: E712
            cut = now - timedelta(days=privacy.retention_days(cfg, category, False))
            purged += (await db.execute(delete(WaMessage).where(WaMessage.contact_id.in_(ids), WaMessage.created_at < cut))).rowcount or 0
        fam = select(WaContact.id).where(WaContact.is_family == True)  # noqa: E712
        purged += (await db.execute(delete(WaMessage).where(WaMessage.contact_id.in_(fam), WaMessage.created_at < now - timedelta(days=privacy.retention_days(cfg, None, True))))).rowcount or 0
        cut = now - timedelta(days=max(7, int(cfg.get("retention_days", 90))))
        purged += (await db.execute(delete(WaMessage).where(WaMessage.created_at < cut))).rowcount or 0  # everything else: the general period
        out["purged"] = purged
        await _set_val(db, "wa_purge_last", today)
    await db.commit()
    return out


async def _check_token(db: AsyncSession) -> None:
    """Once a day: ask Meta about the token and warn in the bell if it is dead or ends within 3 days."""
    creds = await wcfg.get_secrets(db)
    if not wa_send.ready(creds):
        return
    ok, res = await wa_send.graph_get(creds, "debug_token", {"input_token": creds["token"]})
    d = (res.get("data") or {}) if ok else {}
    if not ok or not d:
        return
    exp = int(d.get("expires_at") or 0)
    left = (datetime.fromtimestamp(exp, tz=timezone.utc) - utcnow()) if exp else None
    if d.get("is_valid") is False or (left is not None and left < timedelta(days=3)):
        await _alert_token(db)


async def send_digest(db: AsyncSession, cfg: dict[str, Any]) -> None:
    now = utcnow()
    # The website's morning summary covers only the website's own WhatsApp; the phone app's chats stay in the app.
    web = (WaContact.channel == "whatsapp") | (WaContact.channel.is_(None))
    waiting = (await db.execute(select(WaContact).where(WaContact.unread > 0, WaContact.state != "done", web)
                                .order_by(WaContact.priority, WaContact.last_message_at.desc()).limit(50))).scalars().all()
    urgent = [c for c in waiting if c.priority in (1, 2, 4)]
    tasks = (await db.execute(select(WaTask).outerjoin(WaContact, WaTask.contact_id == WaContact.id).where(
        WaTask.is_done == False, WaTask.due_at != None, WaTask.due_at <= now + timedelta(days=1),  # noqa: E711,E712
        (WaTask.contact_id.is_(None)) | web).order_by(WaTask.due_at).limit(20))).scalars().all()
    if not waiting and not tasks:
        return
    lines = [f"{len(waiting)} জন অপেক্ষায়, জরুরি {len(urgent)} জন, আজকের/মেয়াদোত্তীর্ণ কাজ {len(tasks)}টি।"]
    lines += [f"• {(c.name or c.phone)}: {(c.need or c.summary or '')[:70]}" for c in urgent[:5]]
    lines += [f"✓ {t.title[:80]}" for t in tasks[:4]]
    await create_notification(db, type="wa_digest", severity="info", title="সকালের WhatsApp সারাংশ",
                              body="\n".join(lines), link="/sumon/whatsapp")
