"""One human, many identifiers (Brain_Prompt section 7). Extends `wa_contacts`; no second identity table.

`wa_contacts` stays one row per identifier (a phone number, an "sms:+88..." key, a chat-app name). Rows of the SAME human share
`wa_contacts.person_id` (manual_sql/0002, a nullable column; the model keeps it deferred so nothing breaks before the SQL is run).

Confidence policy (never relaxed):
  high    the same normalised phone number on two channels  -> linked automatically (logged, reversible)
  medium  the same display name and no conflicting number    -> only a SUGGESTION; the owner confirms
  never   different numbers (even with the same name), group chats, names that are too short or generic
Every link and unlink is written to a small audit list (`identity_log` in `settings`) and nothing is ever merged destructively:
messages, tasks and notes stay on their own contact; only the shared `person_id` changes, and unlink sets it back to NULL.
"""
from __future__ import annotations

import json
import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import sqlalchemy as sa
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import wa_brain as brain
from app.models.wa import WaContact, WaMessage

LOG_KEY = "identity_log"
GENERIC = {"unknown", "অজানা", "অজানা নম্বর", "unknown number", "no name", "whatsapp", "sms", "me", "আমি"}
# Core reference, NOT the ORM model: before manual_sql/0002 the column does not exist, and only code that asks for it explicitly may fail.
_T = sa.table("wa_contacts", sa.column("id", sa.Uuid), sa.column("person_id", sa.Uuid))
_NUMBER_PREFIXES = ("sms:", "tel:", "phone:")


def number_of(key: str | None) -> str | None:
    """The normalised phone number inside a contact key, or None (chat-app names, "tg:123", mail have none)."""
    k = (key or "").strip().lower()
    for p in _NUMBER_PREFIXES:
        if k.startswith(p):
            k = k[len(p):]
            break
    else:
        if not re.fullmatch(r"\+?[\d\s\-()]{10,20}", k):
            return None
    n = brain.normalize_phone(k)
    return n if len(n) >= 10 else None


def norm_name(name: str | None) -> str | None:
    # keep letters AND combining marks (Bangla vowel signs); drop only punctuation and symbols/emoji
    kept = "".join(" " if unicodedata.category(ch)[0] in "PSC" else ch for ch in (name or "").casefold())
    n = re.sub(r"\s+", " ", kept).strip()
    if len(n) < 3 or n in GENERIC or n.replace(" ", "").isdigit():
        return None
    return n


@dataclass
class Relation:
    level: str = "none"   # high | medium | none
    reasons: list[str] = field(default_factory=list)


def relate(a: Any, b: Any, a_group: bool = False, b_group: bool = False) -> Relation:
    """How sure are we that two contact rows are the same human?"""
    if a.id == b.id:
        return Relation("none", ["একই রেকর্ড"])
    if a_group or b_group:
        return Relation("none", ["গ্রুপ চ্যাট কখনো ব্যক্তির সঙ্গে যুক্ত হয় না"])
    na, nb = number_of(a.phone), number_of(b.phone)
    if na and nb:
        return Relation("high", [f"একই নম্বর ({na})"]) if na == nb else Relation("none", ["নম্বর আলাদা: একই নাম হলেও যুক্ত হবে না"])
    ma, mb = norm_name(a.name), norm_name(b.name)
    if ma and ma == mb:
        return Relation("medium", ["একই নাম, কিন্তু নম্বর দিয়ে মেলানো যায়নি: আপনি নিশ্চিত করলে যুক্ত হবে"])
    return Relation("none", [])


def suggestions(contacts: list[Any], groups: set[Any], linked: dict[Any, Any]) -> list[dict[str, Any]]:
    """Pairs worth showing the owner (medium confidence, or high ones not yet linked). Buckets by name: no n-squared scan."""
    buckets: dict[str, list[Any]] = {}
    for c in contacts:
        key = norm_name(c.name)
        if key and c.id not in groups:
            buckets.setdefault(key, []).append(c)
    out = []
    for items in buckets.values():
        for i, a in enumerate(items):
            for b in items[i + 1:]:
                if linked.get(a.id) and linked.get(a.id) == linked.get(b.id):
                    continue
                rel = relate(a, b)
                if rel.level in ("high", "medium"):
                    out.append({"a": a, "b": b, "level": rel.level, "reasons": rel.reasons})
    return out


# -- database helpers (all degrade quietly when manual_sql/0002 has not been run) ------------------------------------

async def column_ready(db: AsyncSession) -> bool:
    """Is manual_sql/0002 run? The probe runs inside a SAVEPOINT: a missing column must never roll back (or expire) the caller's work."""
    try:
        async with db.begin_nested():
            await db.execute(select(_T.c.person_id).limit(1))
        return True
    except Exception:  # noqa: BLE001 - the column does not exist yet
        return False


async def person_map(db: AsyncSession) -> dict[Any, Any]:
    rows = await db.execute(select(_T.c.id, _T.c.person_id).where(_T.c.person_id.isnot(None)))
    return {cid: pid for cid, pid in rows.all()}


async def person_contact_ids(db: AsyncSession, contact: Any) -> list[Any]:
    """The contact itself plus every contact linked to the same human (just [id] while nothing is linked or the SQL is missing)."""
    cid = contact.id
    if not await column_ready(db):
        return [cid]
    pid = (await db.execute(select(_T.c.person_id).where(_T.c.id == cid))).scalar_one_or_none()
    if not pid:
        return [cid]
    return list((await db.execute(select(_T.c.id).where(_T.c.person_id == pid))).scalars().all()) or [cid]


async def group_contact_ids(db: AsyncSession) -> set[Any]:
    """Contacts that are group chats (a group message was ever stored for them)."""
    rows = (await db.execute(select(WaMessage.contact_id, WaMessage.meta).where(WaMessage.direction == "in").order_by(WaMessage.created_at.desc()).limit(3000))).all()
    return {cid for cid, meta in rows if isinstance(meta, dict) and meta.get("group")}


async def _audit(db: AsyncSession, who: str, action: str, ids: list[Any], why: str) -> None:
    from app.assistant import wa_flow as flow

    try:
        old = json.loads(await flow._get_val(db, LOG_KEY) or "[]")
        entry = {"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "by": who, "action": action, "contacts": [str(i) for i in ids], "why": why}
        await flow._set_val(db, LOG_KEY, json.dumps(([entry] + (old if isinstance(old, list) else []))[:200], ensure_ascii=False))
    except Exception:  # noqa: BLE001 - the audit line must never block the link itself
        pass


async def link(db: AsyncSession, contacts: list[Any], by: str, why: str) -> uuid.UUID:
    """Give these contacts one shared person_id (reusing an existing one). Caller commits. Nothing else is touched."""
    ids = [c.id for c in contacts]
    existing = (await db.execute(select(_T.c.person_id).where(_T.c.id.in_(ids), _T.c.person_id.isnot(None)))).scalars().all()
    pid = existing[0] if existing else uuid.uuid4()
    olds = set(existing)
    members = ids + ([r for r in (await db.execute(select(_T.c.id).where(_T.c.person_id.in_(olds)))).scalars().all()] if olds else [])
    await db.execute(update(_T).where(_T.c.id.in_(set(members))).values(person_id=pid))
    await _audit(db, by, "link", list(set(members)), why)
    return pid


async def unlink(db: AsyncSession, contact_id: Any, by: str) -> bool:
    """Take ONE contact out of its person (reversible: nothing but person_id changes). A person left with a single contact dissolves."""
    pid = (await db.execute(select(_T.c.person_id).where(_T.c.id == contact_id))).scalar_one_or_none()
    if not pid:
        return False
    await db.execute(update(_T).where(_T.c.id == contact_id).values(person_id=None))
    rest = (await db.execute(select(_T.c.id).where(_T.c.person_id == pid))).scalars().all()
    if len(rest) == 1:
        await db.execute(update(_T).where(_T.c.id == rest[0]).values(person_id=None))
    await _audit(db, by, "unlink", [contact_id], "মালিকের নির্দেশে আলাদা করা হয়েছে")
    return True


async def auto_link(db: AsyncSession, contact: Any) -> bool:
    """High confidence only: another contact with the same normalised phone number. Never by name. Returns True when it linked."""
    num = number_of(contact.phone)
    if not num or not await column_ready(db):
        return False
    tail = num[-10:]
    rows = (await db.execute(select(WaContact).where(WaContact.id != contact.id, WaContact.phone.contains(tail)).limit(20))).scalars().all()
    groups = await group_contact_ids(db) if rows else set()
    same = [r for r in rows if r.id not in groups and relate(contact, r).level == "high"]
    if not same:
        return False
    mine = (await db.execute(select(_T.c.person_id).where(_T.c.id == contact.id))).scalar_one_or_none()
    theirs = {pid for (pid,) in (await db.execute(select(_T.c.person_id).where(_T.c.id.in_([r.id for r in same])))).all() if pid}
    if mine and (not theirs or theirs == {mine}):
        return False  # already one person
    await link(db, [contact, *same], "auto", f"একই নম্বর ({num})")
    await db.commit()
    return True
