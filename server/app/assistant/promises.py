"""Promise tracking: commitments the OWNER wrote ("কাল পাঠাব", "I will send it tomorrow") become tasks.

Rule-based, no AI, no network. detect_promise() is pure; track_promise() adds one WaTask (no schema change).
Conservative on purpose: questions, negations, conditionals, quoted text and very short texts never produce a promise.
Kinds: money (টাকা দেওয়া), work (কাজ করে দেওয়া), meeting (দেখা করা), reply (জানানো).
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

DHAKA = timezone(timedelta(hours=6))  # Bangladesh has no daylight saving
GENERIC_TITLE = "কথা দেওয়া আছে"  # used for private contacts: the message text is never copied
PREFIX = {"money": "টাকা দেওয়া:", "work": "কাজ করে দেওয়া:", "meeting": "দেখা করা:", "reply": "জানানো:"}

_BN = r"[ঀ-৿]"
_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
_BN_PROMISE = re.compile(
    r"(পাঠাব|পাঠাবো|পাঠাচ্ছি|পাঠিয়ে\s*(?:দিব|দিবো|দেব|দেবো|দিচ্ছি)|দিয়ে\s*(?:দিব|দিবো|দেব|দেবো)"
    r"|করব|করবো|করে\s*(?:দিব|দিবো|দেব|দেবো|দিচ্ছি)"
    r"|জানাব|জানাবো|জানাচ্ছি|বলব|বলবো|দিব|দিবো|দেব|দেবো|দিচ্ছি|দেখে\s*(?:বলছি|জানাচ্ছি|বলব|বলবো|জানাব|জানাবো)"
    r"|ফোন\s*(?:করব|করবো)|কল\s*(?:দিব|দিবো|দেব|দেবো)|কথা\s*(?:বলব|বলবো)|নিয়ে\s*আসব|নিয়ে\s*আসবো|আসব|আসবো|আসছি|যাব|যাবো"
    r"|দেখা\s*হবে|আসুন"
    r"|খোঁজ\s*(?:নিব|নিবো|নেব|নেবো|নিচ্ছি)|দেখব|দেখবো)(?!" + _BN + ")")
_BN_NEG = re.compile(r"(?<!" + _BN + r")(না|নাই|নি|নেই)(?!" + _BN + ")")
_BN_COND = re.compile(r"(?<!" + _BN + r")(যদি|তাহলে|তাহলেই|নইলে|অন্যথায়)(?!" + _BN + ")")

_EN_VERBS = (r"send|call|ring|text|email|mail|share|check|reply|respond|update|confirm|deliver|bring|transfer|pay|arrange|"
             r"finish|complete|do|fix|get\s+back|let\s+you\s+know|look\s+into|revert|come|visit|meet|forward|submit|prepare|ship|drop")
_EN_PROMISE = re.compile(
    r"(?:\b(?:i\s+will|i'll|i\s+shall|i'm\s+going\s+to|i\s+am\s+going\s+to|let\s+me|we\s+will|we'll)\b|^\s*will\b)"
    r"[^.!?]{0,40}?\b(?:" + _EN_VERBS + r")\b|\blet's\s+meet\b", re.I)
_EN_NEG = re.compile(r"\b(not|never|won't|wont|can't|cant|cannot|don't|dont|no\s+longer|unable)\b|n't\b", re.I)
_EN_COND = re.compile(r"\b(if|unless|in\s+case)\b", re.I)

_K_MONEY = re.compile(r"টাকা|বিকাশ|নগদ|রকেট|পরিশোধ|শোধ|পেমেন্ট|\b(pay|payment|money|cash|transfer)\b", re.I)
_K_WORK = re.compile(r"করে\s*দ|ঠিক|পাঠিয়ে|পাঠাব|পাঠাবো|পাঠাচ্ছি|দিয়ে\s*দ|নিয়ে\s*আসব|\b(fix|do|deliver|send|bring|finish|complete|"
                     r"submit|prepare|ship|drop|forward|share|arrange)\b", re.I)
_K_MEET = re.compile(r"দেখা|আসুন|আসব|আসবো|আসছি|যাব|যাবো|\b(meet|come|visit)\b", re.I)

_WEEKDAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6,
             "mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
_BN_WEEKDAYS = {"সোমবার": 0, "মঙ্গলবার": 1, "বুধবার": 2, "বৃহস্পতিবার": 3, "শুক্রবার": 4, "শনিবার": 5, "রবিবার": 6}

_QUOTES = re.compile(r'"[^"]*"|“[^”]*”|‘[^’]*’|«[^»]*»|^\s*>.*$|^.*(?:Forwarded message|ফরওয়ার্ড).*$', re.M | re.I)
_COARSE = re.compile(r"(?<=[.!?।॥])(?:\s+|$)|\n+")
_FINE = re.compile(r"\s*[,;،]\s*")

_PART = r"(সকালে|সকাল|দুপুরে|দুপুর|বিকালে|বিকাল|বিকেলে|বিকেল|সন্ধ্যায়|সন্ধ্যা|রাতে|রাত)"
_CLOCK_BN = re.compile(_PART + r"\s*(\d{1,2})(?::(\d{2}))?\s*(?:টা|টায়|ঘটিকা)?")
_CLOCK_BN_BARE = re.compile(r"(?<![\d:])(\d{1,2})(?::(\d{2}))?\s*(?:টা|টায়)")
_CLOCK_EN = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\bat\s+(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:days?|people))|(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])", re.I)


def _clean(text: str) -> list[list[str]]:
    """Coarse sentences (conditionals dropped), each split into comma clauses."""
    out = []
    for c in _COARSE.split(_QUOTES.sub(" ", text)):
        c = c.strip()
        if c and not _BN_COND.search(c) and not _EN_COND.search(c):
            out.append((c, [f.strip() for f in _FINE.split(c) if f.strip()]))
    return out


def _at(base: datetime, days: int, hour: int, minute: int = 0) -> datetime:
    return (base + timedelta(days=days)).replace(hour=hour, minute=minute, second=0, microsecond=0)


def _clock(s: str):
    """(hour, minute) in 24h if the text names a clock time, else None."""
    low = s.translate(_DIGITS)
    m = _CLOCK_BN.search(low)
    if m:
        part, h, mi = m.group(1), int(m.group(2)), int(m.group(3) or 0)
        if h > 12 or mi > 59:
            return None
        if part.startswith("সকাল"):
            h = h % 12 if h == 12 else h
        elif part.startswith("দুপুর"):
            h = h if h in (11, 12) else h + 12 if h < 12 else h
        elif part.startswith(("বিকা", "বিকে", "সন্ধ্যা")):
            h = h + 12 if h < 12 else h
        else:  # রাত
            h = 0 if h == 12 else h + 12 if h >= 5 else h
        return h, mi
    m = _CLOCK_BN_BARE.search(low)
    if m:
        h, mi = int(m.group(1)), int(m.group(2) or 0)
        if h > 12 or mi > 59:
            return None
        return (h + 12 if h <= 6 else h), mi
    m = _CLOCK_EN.search(low)
    if m:
        if m.group(3):
            h, mi, ap = int(m.group(1)), int(m.group(2) or 0), m.group(3).lower()
            if h > 12 or mi > 59:
                return None
            return (h % 12) + (12 if ap == "pm" else 0), mi
        h, mi = int(m.group(4) or m.group(6)), int(m.group(5) or m.group(7) or 0)
        if h > 23 or mi > 59:
            return None
        if h <= 12 and m.group(4):  # "at 5" → afternoon unless it says morning
            h = h + 12 if (h <= 6 and "morning" not in low) else h
        elif h <= 6 and "morning" not in low and "am" not in low:
            h += 12
        return h, mi
    return None


def _due(s: str, now: datetime) -> tuple[datetime, bool]:
    """Simple date words + clock → due time (Asia/Dhaka). Vague → next day 10:00. Second value: a clock time was given."""
    n = now.astimezone(DHAKA) if now.tzinfo else now.replace(tzinfo=timezone.utc).astimezone(DHAKA)
    bn = s.replace("গতকাল", " ").replace("গত কাল", " ")
    low = bn.lower()
    both = bn + " " + low
    word_hour = None
    if re.search(r"রাত|tonight|night", both):
        word_hour = 21
    elif re.search(r"সন্ধ্যা|evening", both):
        word_hour = 18
    elif re.search(r"বিকাল|বিকেল|afternoon", both):
        word_hour = 16
    elif re.search(r"দুপুর|noon", both):
        word_hour = 13
    elif re.search(r"সকাল|morning", both):
        word_hour = 9
    clk = _clock(s)
    hour, minute = clk if clk else (word_hour, 0)
    extra = 1 if (clk and clk[0] == 0 and "রাত" in both) else 0  # "রাত ১২টা" = midnight at the end of the day
    day = None
    if "পরশু" in bn or "day after tomorrow" in low:
        day = 2
    elif re.search(r"আগামী\s*কাল|আগামিকাল|(?<!" + _BN + ")কাল(?!" + _BN + ")|(?<!" + _BN + ")কালকে|tomorrow|tmrw|tmr\b", both):
        day = 1
    else:
        for name, wd in list(_WEEKDAYS.items()) + list(_BN_WEEKDAYS.items()):
            if (len(name) > 3 and (name in low or name in s)) or re.search(r"\b" + name + r"\b", low):
                day = (wd - n.weekday()) % 7 or 7
                break
    if day is None and re.search(r"next\s+week|আগামী\s*সপ্তাহ|পরের\s*সপ্তাহ", both):
        day = 7
    if day is not None:
        return _at(n, day + extra, hour if hour is not None else 10, minute), bool(clk)
    if re.search(r"আজ|today|tonight|this\s+evening", both) or clk:
        d = _at(n, extra, hour if hour is not None else 20, minute)
        if d <= n:
            d = _at(n, 1 + extra, hour if hour is not None else 10, minute) if clk else n + timedelta(hours=2)
        return d, bool(clk)
    return _at(n, 1, 10), False


def _short(s: str, limit: int = 80) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= limit else s[:limit - 1].rstrip() + "…"


def _kind(s: str) -> str:
    if _K_MONEY.search(s):
        return "money"
    if _K_WORK.search(s):
        return "work"
    if _K_MEET.search(s):
        return "meeting"
    if re.search(r"জানা|বল|দেখে|ফোন|কল|কথা|খোঁজ|call|ring|text|email|reply|respond|get\s+back|let\s+you\s+know|check|confirm|update", s, re.I):
        return "reply"
    return "work"


def detect_promise(text: str, now: datetime) -> dict | None:
    """Return {"title", "due_at", "kind"} if the owner's own text holds a commitment, else None."""
    if not text or len(text.strip()) < 8:
        return None
    for coarse, clauses in _clean(text):
        if "?" in coarse or "？" in coarse:
            continue
        for s in clauses:
            if len(s) < 6 or not (_BN_PROMISE.search(s) or _EN_PROMISE.search(s)):
                continue
            if _BN_NEG.search(s) or _EN_NEG.search(s):
                continue
            kind = _kind(s)
            due, has_clock = _due(coarse, now)
            body = _short(s, 80 - len(PREFIX[kind]) - 1)
            title = f"{PREFIX[kind]} {body}"
            if kind == "meeting" and has_clock:  # the meeting moment travels with the task
                stamp = f" ({due:%d/%m %H:%M})"
                title = f"{PREFIX[kind]} {_short(s, 80 - len(PREFIX[kind]) - 1 - len(stamp))}{stamp}"
            return {"title": title, "due_at": due, "kind": kind}
    return None


async def track_promise(db: Any, contact: Any, text: str, now: datetime | None = None) -> Any | None:
    """Add one open WaTask for a promise in the owner's outgoing text (deduped by title per contact). Caller commits."""
    from sqlalchemy import select

    from app.assistant import privacy
    from app.models.wa import WaTask, utcnow

    found = detect_promise(text or "", now or utcnow())
    if not found or contact is None:
        return None
    if privacy.is_private(contact):
        title = GENERIC_TITLE
    else:  # "<name>: <promise>" so the task list says who it is about
        who = _short(str(getattr(contact, "name", None) or getattr(contact, "phone", None) or "").split(":")[-1], 40)
        title = f"{who}: {found['title']}" if who else found["title"]
    open_titles = {t for (t,) in (await db.execute(select(WaTask.title).where(
        WaTask.is_done == False, WaTask.contact_id == contact.id))).all()}  # noqa: E712
    if title in open_titles:
        return None
    task = WaTask(contact_id=contact.id, title=title[:300], due_at=found["due_at"], source="ai")
    db.add(task)
    return task
