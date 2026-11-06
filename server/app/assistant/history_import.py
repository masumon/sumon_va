"""History from a chat the OWNER exported himself (WhatsApp "Export chat" .txt) - Brain_Prompt section 9.5.

What it is: the only honest way to get old WhatsApp text (the platform exposes no chat history to apps). What it is not: a full
history. The report always says "only what was in the file".

* idempotent / resumable: every message gets a stable key (`imp:` + hash of contact, time, speaker, text), so running the same file
  again - or a newer export that overlaps - adds only what is new;
* period: last 1/3/5/7/15/30 days or everything in the file (0), and never older than the retention period (it would be purged);
* imported messages have status "imported": they are context only, are never processed by the assistant (no draft, no alert, no
  auto-send) and never count as something waiting for an answer;
* private/family chats: stored sealed like every private message, and only with the owner's explicit consent;
* dates are read day-first (Bangladesh); a line whose first number is above 12 is certain, a month-first line is detected.
"""
from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import privacy
from app.models.wa import WaContact, WaMessage

DHAKA = timezone(timedelta(hours=6))
IMPORTED = "imported"
MAX_PER_RUN = 5000
PERIODS = (0, 1, 3, 5, 7, 15, 30)
MEDIA = "[ছবি/ভিডিও/ফাইল — এক্সপোর্ট থেকে]"
_HEAD = re.compile(r"^\[?(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4}),?\s+(\d{1,2})[:.](\d{2})(?::\d{2})?(?:\s?([APap][Mm]))?\]?\s*(?:[-–]\s*)?(.*)$")
_BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")


def _when(m: re.Match) -> datetime | None:
    a, b, y, hh, mm, ap = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)), m.group(6)
    y = y + 2000 if y < 100 else y
    day, month = (a, b) if not (b > 12 and a <= 12) else (b, a)  # day-first, unless only month-first can be valid
    if ap:
        hh = hh % 12 + (12 if ap.lower() == "pm" else 0)
    try:
        return datetime(y, month, day, hh, mm, tzinfo=DHAKA).astimezone(timezone.utc)
    except ValueError:
        return None


def parse_dated(text: str) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """[{at, speaker, text}] oldest first as in the file, and counters. System lines ("messages are end-to-end encrypted") are skipped."""
    rows: list[dict[str, Any]] = []
    stats = {"system": 0, "undated": 0}
    for raw in (text or "").translate(_BN_DIGITS).replace("‎", "").replace(" ", " ").splitlines():
        line = raw.strip()
        if not line:
            continue
        m = _HEAD.match(line)
        if not m:
            if rows and rows[-1] is not None:
                rows[-1]["text"] += " " + line  # a multi-line message
            continue
        at = _when(m)
        rest = m.group(7)
        if at is None:
            stats["undated"] += 1
            rows.append(None)  # type: ignore[arg-type]  # keeps following continuation lines away from the previous real message
            continue
        speaker, sep, msg = rest.partition(": ")
        if not sep or len(speaker) > 60:
            stats["system"] += 1
            rows.append(None)  # type: ignore[arg-type]
            continue
        rows.append({"at": at, "speaker": speaker.strip(), "text": msg.strip()})
    return [r for r in rows if r], stats


def speakers_of(rows: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    for r in rows:
        if r["speaker"] not in out:
            out.append(r["speaker"])
    return out


def key_of(contact_id: Any, r: dict[str, Any]) -> str:
    h = hashlib.sha256(f"{contact_id}|{r['at'].isoformat()}|{r['speaker']}|{r['text']}".encode("utf-8")).hexdigest()
    return "imp:" + h[:40]


async def import_rows(db: AsyncSession, contact: WaContact, rows: list[dict[str, Any]], owner_speaker: str, days: int, retention_days: int,
                      now: datetime | None = None) -> dict[str, Any]:
    """Store what is new. Caller commits. Never starts any processing of the stored messages."""
    now = now or datetime.now(timezone.utc)
    floor = now - timedelta(days=max(7, retention_days))
    period_floor = now - timedelta(days=days) if days else None
    rep = {"found": len(rows), "imported": 0, "duplicates": 0, "skipped_old": 0, "skipped_period": 0, "truncated": False,
           "first_at": None, "last_at": None}
    wanted: list[dict[str, Any]] = []
    for r in rows:
        if r["at"] < floor:
            rep["skipped_old"] += 1
        elif period_floor and r["at"] < period_floor:
            rep["skipped_period"] += 1
        else:
            wanted.append(r)
    keys = {key_of(contact.id, r): r for r in wanted}
    have: set[str] = set()
    ks = list(keys)
    for i in range(0, len(ks), 400):
        have |= set((await db.execute(select(WaMessage.wa_id).where(WaMessage.wa_id.in_(ks[i:i + 400])))).scalars().all())
    private = privacy.is_private(contact)
    seen: set[str] = set()
    for k, r in keys.items():
        if k in have or k in seen:
            rep["duplicates"] += 1
            continue
        if rep["imported"] >= MAX_PER_RUN:
            rep["truncated"] = True
            break
        seen.add(k)
        out = r["speaker"] == owner_speaker
        body = MEDIA if "<Media omitted>" in r["text"] or "<मीडिया" in r["text"] else r["text"][:4000]
        db.add(WaMessage(contact_id=contact.id, direction="out" if out else "in", channel=contact.channel or "whatsapp", kind="text",
                         body=privacy.seal(body) if private else body, status=IMPORTED, reason="owner" if out else None, wa_id=k, created_at=r["at"],
                         meta={"imported": True, "source": "export"}))
        rep["imported"] += 1
        iso = r["at"].isoformat(timespec="minutes")
        rep["first_at"] = min(rep["first_at"] or iso, iso)
        rep["last_at"] = max(rep["last_at"] or iso, iso)
    rep["note"] = "এটি শুধু আপনার দেওয়া ফাইলের তথ্য, পুরো ইতিহাস নয়। এগুলো কেবল প্রসঙ্গ: সহকারী এগুলোর কোনো উত্তর দেয় না"
    return rep
