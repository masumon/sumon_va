"""Real e-mail channel without any paid service: read the owner's mailbox over IMAP (a Gmail "app password" works), keep only mail that
matters (email_filter), and put it in the same inbox as every other channel.

Free-tier friendly: a cron job (cron-job.org, every 5 minutes) calls /api/v1/email/cron; each run opens one short IMAP session,
asks only for the newest few messages' headers and a short text snippet (BODY.PEEK, so nothing is marked as read), and closes.
The id of the last message handled is remembered, so every mail is looked at once. Nothing is sent from here: replies are drafts.

Env (set on Render, never in chat): EMAIL_IMAP_USER, EMAIL_IMAP_PASSWORD (app password), optional EMAIL_IMAP_HOST (default imap.gmail.com).
"""
from __future__ import annotations

import email
import imaplib
import logging
import re
from email.header import decode_header, make_header
from email.utils import parseaddr
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import wa_config as wcfg
from app.assistant import wa_flow as flow
from app.assistant.channels import email_filter
from app.assistant.channels.ingest import ingest
from app.core.config import settings
from app.models.wa import WaContact

logger = logging.getLogger(__name__)
MAX_PER_RUN = 15
KEY = "email_last_uid"


def configured() -> bool:
    return bool(settings.EMAIL_IMAP_USER and settings.EMAIL_IMAP_PASSWORD)


def _text(value: str | None) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value))).strip()
    except Exception:  # noqa: BLE001 - a badly encoded header must not stop the run
        return value.strip()


def _snippet(raw: bytes) -> str:
    """A short plain-text snippet of the body (first text/plain part, tags stripped), at most 400 characters."""
    try:
        msg = email.message_from_bytes(raw)
        part = msg if not msg.is_multipart() else next((p for p in msg.walk() if p.get_content_type() == "text/plain"), msg)
        payload = part.get_payload(decode=True) or b""
        text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        text = raw.decode("utf-8", errors="replace")
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:400]


def parse_raw(raw: bytes) -> dict[str, Any]:
    """One whole message (as Cloudflare Email Routing hands it over) -> the same small record the IMAP reader builds."""
    head = email.message_from_bytes(raw)
    name, addr = parseaddr(_text(head.get("From")))
    to = parseaddr(_text(head.get("To")))[1]
    return {"uid": 0, "name": name or addr, "addr": addr.lower(), "to": to.lower(), "subject": _text(head.get("Subject")),
            "id": _text(head.get("Message-ID")) or "", "snippet": _snippet(raw)}


async def accept(db: AsyncSession, cfg: dict[str, Any], m: dict[str, Any]):
    """Filter one message and store it. Returns (message id or None, dropped?). Shared by the IMAP reader and the Cloudflare hook."""
    key = f"mail:{m['addr']}"[:80]
    person = (await db.execute(select(WaContact).where(WaContact.phone == key))).scalar_one_or_none()
    known = bool(person and (person.is_vip or person.is_family or person.tags))
    keep, _why = email_filter.decide(cfg, f"{m['name']} <{m['addr']}>", m["subject"], m["snippet"], known)
    if not keep:
        return None, True
    ext = (m.get("id") or f"{m['addr']}:{m['subject']}:{m['snippet'][:40]}")[:80]
    mid = await ingest(db, channel="email", key=key, name=m["name"], body=(m["subject"] + "\n" + m["snippet"]).strip(), ext_id=ext,
                       meta={"subject": m["subject"][:200], "to": m.get("to", "")})
    return mid, False


def fetch_new(last_uid: int) -> tuple[list[dict[str, Any]], int]:
    """Blocking IMAP read (called from a thread). Returns (messages, newest uid seen)."""
    host = settings.EMAIL_IMAP_HOST or "imap.gmail.com"
    out: list[dict[str, Any]] = []
    newest = last_uid
    box = imaplib.IMAP4_SSL(host, timeout=20)
    try:
        box.login(settings.EMAIL_IMAP_USER, settings.EMAIL_IMAP_PASSWORD)
        box.select("INBOX", readonly=True)
        typ, data = box.uid("search", None, f"UID {last_uid + 1}:*" if last_uid else "UNSEEN")
        uids = [int(u) for u in (data[0].split() if typ == "OK" and data and data[0] else [])]
        uids = [u for u in uids if u > last_uid][-MAX_PER_RUN:]
        for uid in uids:
            typ, msgdata = box.uid("fetch", str(uid), "(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID DATE)] BODY.PEEK[TEXT]<0.2500>)")
            newest = max(newest, uid)
            if typ != "OK":
                continue
            chunks = [p[1] for p in msgdata if isinstance(p, tuple)]
            if len(chunks) < 2:
                continue
            head = email.message_from_bytes(chunks[0])
            name, addr = parseaddr(_text(head.get("From")))
            out.append({"uid": uid, "name": name or addr, "addr": addr.lower(), "subject": _text(head.get("Subject")), "id": _text(head.get("Message-ID")) or str(uid), "snippet": _snippet(chunks[1])})
    finally:
        try:
            box.logout()
        except Exception:  # noqa: BLE001
            pass
    return out, newest


async def run(db: AsyncSession) -> dict[str, int]:
    """One poll: returns counts (read, kept, dropped). The caller commits and schedules the brain for each kept message."""
    import asyncio

    cfg = await wcfg.load_config(db, scope="app")  # e-mail is part of the phone app's inbox
    last = int((await flow._get_val(db, KEY)) or 0)
    items, newest = await asyncio.to_thread(fetch_new, last)
    kept_ids, dropped = [], 0
    for m in items:
        mid, was_dropped = await accept(db, cfg, m)
        dropped += 1 if was_dropped else 0
        if mid:
            kept_ids.append(mid)
    if dropped:
        await email_filter.count_dropped(db, dropped)
    if newest != last:
        await flow._set_val(db, KEY, str(newest))
    await db.commit()
    return {"read": len(items), "kept": len(kept_ids), "dropped": dropped, "ids": kept_ids}  # type: ignore[dict-item]
