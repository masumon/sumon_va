"""Bring one incoming message from any channel into the shared inbox."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import privacy, promo
from app.assistant import wa_config as wcfg
from app.assistant import wa_flow as flow
from app.models.wa import WaContact, WaMessage

MAX_BODY = 4000


async def ingest(db: AsyncSession, *, channel: str, key: str, name: str | None, body: str, ext_id: str,
                 kind: str = "text", meta: dict[str, Any] | None = None, at: datetime | None = None) -> uuid.UUID | None:
    """Store one inbound message. `key` identifies the person on that channel ("tg:123", "sms:+8801...").

    Returns the new message id, or None when the same message was already stored (providers retry; a phone may resend).
    The caller commits and then starts `flow.process_inbound(id)` in the background, exactly like the WhatsApp webhook.
    """
    key = key.strip()[:80]
    ext = f"{channel}:{ext_id}"[:120]
    if not key or not ext_id:
        return None
    if (await db.execute(select(WaMessage.id).where(WaMessage.wa_id == ext))).first():
        return None
    contact = await flow.upsert_contact(db, key, name)
    if (contact.channel or "whatsapp") != channel:
        contact.channel = channel
    ts = at or datetime.now(timezone.utc)
    safe_body, masked = privacy.mask_secrets((body or "")[:MAX_BODY])  # a one-time code is never stored, alerted or sent to an AI
    junk = False
    try:
        junk = promo.is_promo(channel, key, name, safe_body, await wcfg.load_config(db, scope="app"))
    except Exception:  # noqa: BLE001 - a filter problem must never lose a message
        junk = False
    if junk:
        contact.category = "spam"  # straight to the spam folder: never in the inbox, no reply, no alert; kept 3 days
    msg = WaMessage(contact_id=contact.id, direction="in", channel=channel, wa_id=ext, kind=kind,
                    body=safe_body, status="received", meta={**(meta or {}), **({"masked": True} if masked else {}), **({"promo": True} if junk else {})}, created_at=ts)
    db.add(msg)
    contact.unread += 1
    contact.last_inbound_at = contact.last_message_at = ts
    await db.flush()
    return msg.id
