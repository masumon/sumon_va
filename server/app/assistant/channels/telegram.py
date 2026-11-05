"""Telegram channel: customer chats with the bot, Telegram Business chats on the owner's own account, and owner commands.

Safety rules kept here:
* a request is accepted only with the secret header Telegram echoes back (set when the webhook is registered);
* commands that change anything (/stop, /resume, /baki) work only for TELEGRAM_OWNER_ID — anyone else gets a plain reply;
* /id is open to everyone on purpose: it is how the owner finds the id to put in TELEGRAM_OWNER_ID.
"""
from __future__ import annotations

import hmac
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import wa_config as wcfg
from app.assistant import presence, timectx
from app.assistant import wa_brain as brain
from app.assistant import wa_flow as flow
from app.assistant.channels import phone_login
from app.assistant.channels.ingest import ingest
from app.assistant.wa_send import SendError
from app.core.config import settings
from app.models.wa import WaContact, WaMessage, WaTask

logger = logging.getLogger(__name__)
API = "https://api.telegram.org"
KEY = "tg:"

def greeting(now: datetime | None = None) -> str:
    """What a customer sees on /start. Time-aware, honest that it is an assistant, never 'good morning' at night."""
    return (timectx.greeting(now) + " আমি সুমন ভাইয়ের ভার্চুয়াল সহকারী (মানুষ নই)। "
            "আপনার প্রশ্ন বা প্রয়োজন এখানে লিখুন, তাঁকে জানিয়ে দেব।")


GREETING = greeting()  # kept for old imports; the live reply uses greeting() so it follows the hour
HELP = "\n".join(['সুমন ভাইয়ের ভার্চুয়াল সহকারী','','/status — এখনকার অবস্থা দেখুন ও বদলান','/today — আজকের সারসংক্ষেপ','/baki — কার উত্তর বাকি','/places — সংরক্ষিত জায়গা','/stop — সব অটো-উত্তর বন্ধ (শুধু খসড়া)','/resume — অটো-উত্তর আবার চালু','/id — আপনার Telegram আইডি'])
SOURCE_BN = {"manual": "আপনি নিজে বেছেছেন", "schedule": "আপনার সাপ্তাহিক রুটিন অনুযায়ী", "place": "সংরক্ষিত জায়গার সঙ্গে ফোনের অবস্থান মিলেছে",
             "presence": "ফোন দেখে স্বয়ংক্রিয়", "default": "কোনো অবস্থা সেট করা নেই"}
DURATIONS = [(30, "৩০ মিনিট"), (60, "১ ঘণ্টা"), (120, "২ ঘণ্টা")]


def configured() -> bool:
    return bool(settings.TELEGRAM_BOT_TOKEN)


def is_owner(user_id: Any) -> bool:
    owner = (settings.TELEGRAM_OWNER_ID or "").strip()
    return bool(owner) and str(user_id) == owner


def verify_secret(header: str | None) -> bool:
    secret = settings.TELEGRAM_WEBHOOK_SECRET or ""
    return bool(secret) and hmac.compare_digest(secret, header or "")


async def _call(method: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not configured():
        raise SendError("Telegram বট এখনও সংযুক্ত নয় (TELEGRAM_BOT_TOKEN নেই)")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(f"{API}/bot{settings.TELEGRAM_BOT_TOKEN}/{method}", json=payload)
    except httpx.HTTPError as exc:
        raise SendError(f"Telegram-এ পৌঁছানো যায়নি: {type(exc).__name__}") from exc
    data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if not data.get("ok"):
        raise SendError(f"Telegram: {str(data.get('description') or r.status_code)[:200]}")
    return data


async def send_text(chat_id: str | int, text: str, business_connection_id: str | None = None, reply_markup: dict[str, Any] | None = None) -> str | None:
    payload: dict[str, Any] = {"chat_id": chat_id, "text": text[:4000]}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    if business_connection_id:
        payload["business_connection_id"] = business_connection_id
    data = await _call("sendMessage", payload)
    return str((data.get("result") or {}).get("message_id") or "") or None


async def answer_callback(callback_id: str, text: str = "") -> None:
    await _call("answerCallbackQuery", {"callback_query_id": callback_id, "text": text[:180]})


async def edit_text(chat_id: str | int, message_id: int, text: str, reply_markup: dict[str, Any] | None = None) -> None:
    payload: dict[str, Any] = {"chat_id": chat_id, "message_id": message_id, "text": text[:4000]}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    await _call("editMessageText", payload)


async def fetch_file(file_id: str) -> tuple[str, bytes]:
    """Download one file (a voice note) the person sent to the bot. Refuses anything over 5 MB."""
    meta = (await _call("getFile", {"file_id": file_id})).get("result") or {}
    path = meta.get("file_path")
    if not path or int(meta.get("file_size") or 0) > 5_000_000:
        raise SendError("ফাইলটি বড় বা পাওয়া যায়নি")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{API}/file/bot{settings.TELEGRAM_BOT_TOKEN}/{path}")
    if r.status_code != 200:
        raise SendError("ফাইল নামানো যায়নি")
    return ("audio/ogg" if path.endswith((".oga", ".ogg")) else "audio/mpeg"), r.content


async def set_webhook(url: str) -> str:
    """Register our URL with Telegram (also asks for Business updates). Returns Telegram's own answer."""
    data = await _call("setWebhook", {
        "url": url, "secret_token": settings.TELEGRAM_WEBHOOK_SECRET, "drop_pending_updates": False,
        "allowed_updates": ["message", "callback_query", "business_message", "business_connection", "edited_business_message"],
    })
    return str(data.get("description") or "ok")


_INFO_CACHE: dict[str, Any] = {"at": 0.0, "value": None}
_INFO_TTL_S = 45  # the modules screen asks every 30 s: two Telegram calls each time made every refresh slow


async def info(force: bool = False) -> dict[str, Any]:
    import time as _time

    now = _time.monotonic()
    if not force and _INFO_CACHE["value"] is not None and now - _INFO_CACHE["at"] < _INFO_TTL_S:
        return _INFO_CACHE["value"]
    me = (await _call("getMe", {})).get("result") or {}
    hook = (await _call("getWebhookInfo", {})).get("result") or {}
    value = {"bot": me.get("username"), "url": hook.get("url") or "", "pending": hook.get("pending_update_count", 0),
             "last_error": hook.get("last_error_message") or ""}
    _INFO_CACHE.update(at=now, value=value)
    return value


def _name(frm: dict[str, Any], chat: dict[str, Any]) -> str | None:
    full = " ".join(p for p in (frm.get("first_name"), frm.get("last_name")) if p).strip()
    return (full or frm.get("username") or chat.get("title") or None)


def _content(msg: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
    """(kind, body, meta) — voice notes keep their file id; other media become a short tag the brain treats as 'unsupported'."""
    if msg.get("text"):
        return "text", msg["text"], {}
    if msg.get("voice") or msg.get("audio"):
        v = msg.get("voice") or msg.get("audio")
        return "audio", "", {"file_id": v.get("file_id")}
    if msg.get("caption"):
        return "text", msg["caption"], {}
    for tag, word in (("photo", "ছবি"), ("video", "ভিডিও"), ("document", "ফাইল"), ("sticker", "স্টিকার")):
        if msg.get(tag):
            return "text", f"[{word}]", {}
    return "text", "", {}


def status_keyboard(cfg: dict[str, Any]) -> dict[str, Any]:
    """Inline keyboard for /status: every status the owner has (custom ones included), then a duration row."""
    rows: list[list[dict[str, str]]] = []
    row: list[dict[str, str]] = []
    for i, s in enumerate(cfg.get("statuses") or []):
        row.append({"text": str(s.get("label") or s.get("key"))[:30], "callback_data": f"s:{i}"})
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([{"text": label, "callback_data": f"d:{m}"} for m, label in DURATIONS])
    return {"inline_keyboard": rows}


def status_text(cfg: dict[str, Any], now: datetime | None = None) -> str:
    st = brain.current_status(cfg, now)
    c = timectx.time_context(now)
    head = f"এখন {c['weekday_bn']}, {c['day_part_bn']}।"
    if st["key"] == "free":
        body = "আপনার অবস্থা: ফ্রি। সহকারী কাউকে ব্যস্ত বা বিশ্রামে আছেন বলবে না।"
    else:
        body = f"আপনার অবস্থা: {st['label']}।\nকারণ: {SOURCE_BN.get(st['source'], st['source'])}।"
        until = brain._parse_dt((cfg.get("status") or {}).get("until"))
        if st["source"] == "manual" and until:
            body += f"\nশেষ হবে: {until.astimezone(brain.DHAKA):%H:%M}।"
    return f"{head}\n{body}\n\nবদলাতে নিচ থেকে বেছে নিন।"


async def _effective_cfg(db: AsyncSession) -> dict[str, Any]:
    return await presence.apply(db, await wcfg.load_config(db, force=True))


async def _today_text(db: AsyncSession) -> str:
    bn = timectx.bn_num
    waiting = (await db.execute(select(func.count()).select_from(WaContact).where(WaContact.unread > 0, WaContact.state != "done"))).scalar_one()
    urgent = (await db.execute(select(func.count()).select_from(WaContact).where(WaContact.unread > 0, WaContact.state != "done", WaContact.priority == 1))).scalar_one()
    open_tasks = (await db.execute(select(func.count()).select_from(WaTask).where(WaTask.is_done == False))).scalar_one()  # noqa: E712
    nxt = (await db.execute(select(WaTask).where(WaTask.is_done == False, WaTask.due_at.isnot(None)).order_by(WaTask.due_at.asc()).limit(1))).scalar_one_or_none()  # noqa: E712
    lines = ["আজকের সারসংক্ষেপ", f"জরুরি: {bn(urgent)}টি", f"উত্তরের অপেক্ষায়: {bn(waiting)} জন", f"বাকি কাজ: {bn(open_tasks)}টি"]
    if nxt:
        lines.append(f"পরের প্রতিশ্রুত কাজ: {nxt.title[:80]} ({nxt.due_at.astimezone(brain.DHAKA):%d/%m %H:%M})")
    return "\n".join(lines)


def places_text(cfg: dict[str, Any]) -> str:
    places = timectx.normalize_places(cfg.get("places"))
    if not places:
        return "কোনো জায়গা সংরক্ষিত নেই। জায়গা সংরক্ষণ করলে ফোনের অবস্থান মিললে সহকারী সেটা বলতে পারবে।"
    return "সংরক্ষিত জায়গা\n" + "\n".join(f"• {p['label']} (ব্যাসার্ধ {timectx.bn_num(p['radius_m'])} মিটার)" for p in places)


async def _owner_command(db: AsyncSession, text: str) -> tuple[str, dict[str, Any] | None]:
    """(reply text, optional inline keyboard)."""
    cmd = text.split()[0].split("@")[0].lower()
    if cmd in ("/start", "/help"):
        return HELP, None
    if cmd == "/stop":
        await wcfg.save_config(db, {"mode": "shadow"})
        return "সব অটো-উত্তর বন্ধ। এখন শুধু খসড়া হবে। আবার চালু করতে /resume", None
    if cmd == "/resume":
        await wcfg.save_config(db, {"mode": "auto"})
        return "অটো-উত্তর চালু হয়েছে।", None
    if cmd == "/status":
        cfg = await _effective_cfg(db)
        return status_text(cfg), status_keyboard(cfg)
    if cmd == "/today":
        return await _today_text(db), None
    if cmd == "/places":
        return places_text(await wcfg.load_config(db)), None
    if cmd == "/baki":
        rows = (await db.execute(select(WaContact).where(WaContact.unread > 0, WaContact.state != "done")
                                 .order_by(WaContact.priority, WaContact.last_message_at.desc()).limit(10))).scalars().all()
        if not rows:
            return "কারও উত্তর বাকি নেই।", None
        return "উত্তর বাকি:\n" + "\n".join(f"• {c.name or c.phone} — {c.unread}টি ({c.channel})" for c in rows), None
    return HELP, None


async def _reply(chat_id: Any, text: str, markup: dict[str, Any] | None) -> None:
    if markup:
        await send_text(chat_id, text, reply_markup=markup)
    else:
        await send_text(chat_id, text)


# ── per-chat "approve in Telegram" ─────────────────────────────────────────────
# A chat whose reply style is "telegram": every new message is sent to the owner's own chat with the bot, with the assistant's
# draft and two buttons (send / discard). Whatever the owner writes as a Telegram *reply* to that card goes to the person instead.

def _approval_keyboard(draft_id: uuid.UUID) -> dict[str, Any]:
    return {"inline_keyboard": [[{"text": "✅ পাঠান", "callback_data": f"a:{draft_id}"}, {"text": "🗑 বাদ দিন", "callback_data": f"x:{draft_id}"}]]}


async def send_approval(db: AsyncSession, contact: WaContact, incoming: WaMessage, text: str, draft: WaMessage | None) -> None:
    """Tell the owner on Telegram; never raises (a Telegram hiccup must not lose the message or the draft)."""
    if not (configured() and settings.TELEGRAM_OWNER_ID):
        return
    from app.assistant.channels import label as channel_label  # local: avoids an import cycle
    who = contact.name or contact.phone.split(":")[-1]
    lines = [f"📩 {who} · {channel_label(contact.channel or 'whatsapp')}", (text or "(লেখা নেই)")[:1500]]
    if draft is not None:
        lines += ["", "✍ সহকারীর খসড়া উত্তর:", (draft.body or "")[:1500]]
    lines += ["", "↩ এই বার্তার Reply-তে নিজে লিখলে সেটাই ওই মানুষের কাছে যাবে।"]
    try:
        mid = await send_text(settings.TELEGRAM_OWNER_ID, chr(10).join(lines), reply_markup=_approval_keyboard(draft.id) if draft is not None else None)
    except SendError:
        logger.warning("telegram approval card failed", exc_info=True)
        return
    if mid:
        incoming.meta = {**(incoming.meta or {}), "tg_mid": mid}
        if draft is not None:
            draft.meta = {**(draft.meta or {}), "tg_mid": mid}
        await db.commit()


async def _card_message(db: AsyncSession, tg_mid: Any) -> WaMessage | None:
    """The inbox message an approval card was about (looked up by the card's Telegram message id)."""
    want = str(tg_mid or "")
    if not want:
        return None
    since = datetime.now(timezone.utc) - timedelta(days=7)
    rows = (await db.execute(select(WaMessage).where(WaMessage.created_at >= since, WaMessage.meta.isnot(None))
                             .order_by(WaMessage.created_at.desc()).limit(2000))).scalars().all()
    return next((m for m in rows if str((m.meta or {}).get("tg_mid") or "") == want), None)


async def _owner_reply_from_telegram(db: AsyncSession, chat_id: Any, reply_to: dict[str, Any], text: str) -> None:
    card = await _card_message(db, reply_to.get("message_id"))
    if card is None:
        await _reply(chat_id, "এই বার্তাটা কোন চ্যাটের, খুঁজে পাইনি (৭ দিনের বেশি পুরনো হতে পারে)। অ্যাপ থেকে উত্তর দিন।", None)
        return
    contact = await db.get(WaContact, card.contact_id)
    if contact is None:
        return
    now = datetime.now(timezone.utc)
    # the owner answered: the assistant's waiting draft for this person is no longer needed
    for d in (await db.execute(select(WaMessage).where(WaMessage.contact_id == contact.id, WaMessage.direction == "out", WaMessage.status == "draft"))).scalars().all():
        d.status = "discarded"
    m = WaMessage(contact_id=contact.id, direction="out", kind="text", body=text[:4000], reason="owner", status="queued", send_after=now, meta={"via": "telegram"})
    db.add(m)
    contact.state, contact.unread = "owner", 0
    contact.hold_until = now + timedelta(hours=int((await wcfg.load_config(db)).get("hold_hours", 12)))
    await db.commit()
    ok = await flow.deliver(db, m.id)
    await db.refresh(m)
    await _reply(chat_id, ("✅ পাঠানো হয়েছে" if m.status == "sent" else "⏳ ফোন থেকে যাচ্ছে") if ok else f"❌ যায়নি: {m.error or 'কারণ জানা নেই'}", None)


async def _approve_from_telegram(db: AsyncSession, draft_id: str, send: bool) -> str:
    try:
        m = await db.get(WaMessage, uuid.UUID(draft_id))
    except ValueError:
        return "বোঝা গেল না"
    if not m or m.direction != "out" or m.status not in ("draft", "failed"):
        return "এটা আর অপেক্ষায় নেই (আগেই পাঠানো বা বাদ দেওয়া হয়েছে)"
    if not send:
        m.status = "discarded"
        await db.commit()
        return "🗑 বাদ দেওয়া হলো"
    m.status, m.send_after, m.error = "queued", datetime.now(timezone.utc), None
    await db.commit()
    ok = await flow.deliver(db, m.id)
    await db.refresh(m)
    return ("✅ পাঠানো হয়েছে" if m.status == "sent" else "⏳ ফোন থেকে যাচ্ছে") if ok else f"❌ যায়নি: {m.error or ''}"[:190]


async def handle_callback(db: AsyncSession, cb: dict[str, Any]) -> None:
    """A button press. Only the owner is obeyed; anybody else is ignored without even an answer."""
    frm, msg = cb.get("from") or {}, cb.get("message") or {}
    if not is_owner(frm.get("id")):
        return
    chat_id, mid, data = (msg.get("chat") or {}).get("id"), msg.get("message_id"), str(cb.get("data") or "")
    cfg = await wcfg.load_config(db, force=True)
    note = ""
    now = datetime.now(brain.DHAKA)
    kind, _, arg = data.partition(":")
    if kind == "l":  # the owner answers "may this phone sign in?"
        yes, _, short = arg.partition(":")
        decided = phone_login.decide(short, yes == "y")
        note = ("✅ ঢুকতে দেওয়া হলো" if yes == "y" else "❌ বাতিল করা হলো") if decided else "অনুরোধটি আর নেই (মেয়াদ শেষ বা আগেই সিদ্ধান্ত হয়েছে)"
        try:
            await answer_callback(str(cb.get("id") or ""), note[:190])
        except SendError:
            pass
        if chat_id is not None and mid is not None:
            try:
                await edit_text(chat_id, mid, (msg.get("text") or "")[:3800] + chr(10) * 2 + note, None)
            except SendError:
                pass
        return
    if kind in ("a", "x"):  # an approval card: send or discard the assistant's draft
        note = await _approve_from_telegram(db, arg, kind == "a")
        try:
            await answer_callback(str(cb.get("id") or ""), note[:190])
        except SendError:
            pass
        if chat_id is not None and mid is not None:
            try:
                await edit_text(chat_id, mid, (msg.get("text") or "")[:3800] + chr(10) * 2 + note, None)
            except SendError:
                pass
        return
    if kind == "s" and arg.isdigit() and int(arg) < len(cfg.get("statuses") or []):
        s = cfg["statuses"][int(arg)]
        await wcfg.save_config(db, {"status": {"key": str(s.get("key") or "free"), "until": None, "custom": ""}})
        note = f"অবস্থা: {s.get('label')}"
    elif kind == "d" and arg.isdigit() and int(arg) in {m for m, _ in DURATIONS}:
        cur = cfg.get("status") or {}
        if cur.get("key", "free") == "free":
            note = "আগে একটি অবস্থা বেছে নিন"
        else:
            await wcfg.save_config(db, {"status": {"key": cur["key"], "until": (now + timedelta(minutes=int(arg))).isoformat(timespec="minutes"), "custom": cur.get("custom") or ""}})
            note = "সময় ঠিক করা হলো"
    else:
        return await answer_callback(str(cb.get("id") or ""), "বোঝা গেল না")
    try:
        await answer_callback(str(cb.get("id") or ""), note)
    except SendError:
        pass
    cfg = await _effective_cfg(db)
    if chat_id is not None and mid is not None:
        try:
            await edit_text(chat_id, mid, status_text(cfg), status_keyboard(cfg))
        except SendError:  # e.g. "message is not modified"
            pass


async def handle_update(db: AsyncSession, update: dict[str, Any]) -> list[uuid.UUID]:
    """Process one Telegram update. Returns the ids of new inbound messages for the brain to answer."""
    if update.get("callback_query"):
        await handle_callback(db, update["callback_query"])
        return []
    business = update.get("business_message")
    msg = update.get("message") or business
    if not msg:
        return []
    chat, frm = msg.get("chat") or {}, msg.get("from") or {}
    chat_id, uid = chat.get("id"), frm.get("id")
    text = (msg.get("text") or "").strip()
    bc = (business or {}).get("business_connection_id")

    if business is None:  # a direct chat with the bot
        if text.startswith("/id"):
            await send_text(chat_id, f"আপনার Telegram আইডি: {uid}")
            return []
        if is_owner(uid):
            if text.startswith("/"):
                reply, markup = await _owner_command(db, text)
                await _reply(chat_id, reply, markup)
            elif text and msg.get("reply_to_message"):  # the owner answered an approval card: send his words to that person
                await _owner_reply_from_telegram(db, chat_id, msg["reply_to_message"], text)
            return []  # the owner's own chat with the bot is the control room, never a customer thread
        if text.startswith("/"):  # a stranger's slash command is never a command; /start from a customer is just a hello
            if text.split()[0].split("@")[0].lower() == "/start":
                await send_text(chat_id, greeting())
            return []
    elif is_owner(uid):  # the owner answered a customer himself on his own account → the assistant steps back
        contact = (await db.execute(select(WaContact).where(WaContact.phone == f"{KEY}{chat_id}"))).scalar_one_or_none()
        if contact:
            now = datetime.now(timezone.utc)
            cfg = await wcfg.load_config(db)
            db.add(WaMessage(contact_id=contact.id, direction="out", channel="telegram", kind="text", body=(text or "")[:4000],
                             status="sent", reason="owner", sent_at=now))
            contact.state, contact.unread = "owner", 0
            contact.hold_until = now + timedelta(hours=int(cfg.get("hold_hours", 12)))
            contact.last_outbound_at = contact.last_message_at = now
        return []

    kind, body, meta = _content(msg)
    if not (body or kind == "audio") or chat_id is None:
        return []
    if bc:
        meta = {**meta, "bc": bc}
    at = datetime.fromtimestamp(int(msg.get("date") or datetime.now(timezone.utc).timestamp()), tz=timezone.utc)
    mid = await ingest(db, channel="telegram", key=f"{KEY}{chat_id}", name=_name(frm, chat), body=body,
                       ext_id=f"{chat_id}:{msg.get('message_id')}", kind=kind, meta=meta, at=at)
    return [mid] if mid else []


async def business_id_for(db: AsyncSession, contact: WaContact) -> str | None:
    """The Business connection the person last wrote through (needed to answer inside the owner's own chat)."""
    row = (await db.execute(select(WaMessage.meta).where(WaMessage.contact_id == contact.id, WaMessage.direction == "in")
                            .order_by(WaMessage.created_at.desc()).limit(1))).first()
    return ((row[0] or {}).get("bc") if row else None) or None
