"""Send one queued reply on a non-WhatsApp channel. (WhatsApp keeps its own, untouched path in wa_flow.deliver.)"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import privacy
from app.assistant.channels import telegram, wake
from app.assistant.wa_send import SendError
from app.models.wa import InboxCommand, InboxDevice, WaContact, WaMessage

logger = logging.getLogger(__name__)
ONLINE = timedelta(days=3)  # a phone not seen for this long is not a place to queue an SMS


async def _active_device(db: AsyncSession) -> InboxDevice | None:
    rows = (await db.execute(select(InboxDevice).where(InboxDevice.revoked_at.is_(None))
                             .order_by(InboxDevice.last_seen_at.desc().nullslast()))).scalars().all()
    return rows[0] if rows else None


_PHONE_RE = re.compile(r"^\+?\d{8,15}$")


def is_normal_phone(target: str) -> bool:
    return bool(_PHONE_RE.match(re.sub(r"[\s\-]", "", target or "")))


async def queue_for_device(db: AsyncSession, *, kind: str, target: str, body: str, msg_id: uuid.UUID | None = None) -> InboxCommand:
    if kind == "sms" and not is_normal_phone(target):  # short-codes and names cannot receive a normal SMS
        raise SendError("এই প্রেরক সাধারণ ফোন নম্বর নয় (শর্ট-কোড বা নাম), তাই SMS পাঠানো হয়নি")
    dev = await _active_device(db)
    if not dev:
        raise SendError("কোনো ফোন সংযুক্ত নেই — “সুমনের ভার্চুয়াল সহকারী” অ্যাপ জোড়া লাগান")
    if dev.last_seen_at and datetime.now(timezone.utc) - dev.last_seen_at > ONLINE:
        raise SendError("ফোনটি অনেকদিন সংযোগ দেয়নি — অ্যাপ খুলে ইন্টারনেট চালু করুন")
    cmd = InboxCommand(device_id=dev.id, msg_id=msg_id, kind=kind, target=target[:80], body=body)
    db.add(cmd)
    await db.flush()
    return cmd


async def deliver_other(db: AsyncSession, msg: WaMessage, contact: WaContact) -> bool:
    """Send (or hand to the phone) one claimed message; sets status/error and commits. True when it went out."""
    channel = contact.channel or "whatsapp"
    assistant_reply = (msg.reason or "") not in ("owner", "manual")
    if assistant_reply and (contact.is_blocked or contact.state == "owner"):
        msg.status, msg.error = "skipped", "আপনি নিজে নিয়েছেন বা ব্লক — পাঠানো হয়নি"
        await db.commit()
        return False
    try:
        if channel == "telegram":
            chat_id = contact.phone.removeprefix(telegram.KEY)
            msg.wa_id = f"telegram:out:{await telegram.send_text(chat_id, privacy.unseal(msg.body) or '', await telegram.business_id_for(db, contact)) or msg.id}"[:120]
        elif channel == "sms":
            await queue_for_device(db, kind="sms", target=contact.phone.removeprefix("sms:"), body=privacy.unseal(msg.body) or "", msg_id=msg.id)
            msg.delivery = "device"
        elif channel == "notif":  # a reply the owner approved himself: the phone sends it through the app's own reply box
            await queue_for_device(db, kind="reply", target=contact.phone, body=privacy.unseal(msg.body) or "", msg_id=msg.id)
            msg.delivery = "device"
        else:
            raise SendError("এই মাধ্যমে এখান থেকে সরাসরি পাঠানো যায় না — খসড়াটি কপি করে সেই অ্যাপে পাঠান")
        if msg.delivery == "device":  # handed to the phone: it is NOT sent yet — the phone confirms (or reports failure) through /device/ack
            msg.status, msg.error = "sending", None
        else:
            msg.status, msg.sent_at, msg.error = "sent", datetime.now(timezone.utc), None
            contact.last_outbound_at = msg.sent_at
    except SendError as exc:
        msg.status, msg.error = "failed", str(exc)[:290]
    await db.commit()
    wake.notify()
    return msg.status in ("sent", "sending")
