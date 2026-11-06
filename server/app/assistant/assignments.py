"""Tasks other people give the OWNER, and "what happened to my work?" (Brain_Prompt section 10). Pure functions, no database.

Extends `promises.py` (the owner's own promises) and reuses its date/clock parser; it does not add a second task system.
Everything detected here is only PROPOSED (`WaTask.source = "proposed"`): the owner confirms (`source = "confirmed"`) or deletes it.
No schema change is needed (`source` is VARCHAR(10)). Honest limits:
  * a deadline is stored only when the text names one; a vague request gets NO deadline (we never invent one);
  * a question-form request ("can you ...?") is only "low" confidence and creates nothing;
  * progress is never guessed: with no progress data an open task is "open, progress unknown".
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from app.assistant import promises as pr

PROPOSED, CONFIRMED = "proposed", "confirmed"
PRIVATE_TITLE = "কাজ চেয়েছেন (লেখা সুরক্ষিত)"
_BN = pr._BN
_VERBS = (r"send|share|call|fix|prepare|update|check|confirm|submit|finish|complete|arrange|bring|make|do|give|deliver|pay|reply|design|write")

_BN_REQ = re.compile(
    r"(পাঠান|পাঠিয়ে\s*(?:দিন|দেবেন|দিবেন)|পাঠাবেন|করে\s*(?:দিন|দেবেন|দিবেন)|করবেন|করুন|দেবেন|দিবেন|নিয়ে\s*আসবেন|জানাবেন|জানান|দেখবেন|দেখুন"
    r"|লাগবে|দরকার|চাই|প্রয়োজন|রেডি\s*করুন|ঠিক\s*করুন|বানিয়ে\s*(?:দিন|দেবেন)|আপডেট\s*দিন|শেষ\s*করুন|জমা\s*দিন)(?!" + _BN + ")")
_EN_REQ = re.compile(
    r"\b(?:please|pls|kindly)\b[^.!?]{0,60}?\b(?:" + _VERBS + r")\b|\bi\s+need\s+you\s+to\b|\byou\s+(?:need|have)\s+to\b|\bneed\s+(?:the|a|an|your)\b"
    r"|^\s*(?:" + _VERBS + r")\b[^.!?]{3,}", re.I)
_EN_QREQ = re.compile(r"\b(?:can|could|will|would)\s+you\b[^?]{0,60}?\b(?:" + _VERBS + r")\b", re.I)
_BN_QREQ = re.compile(r"(পারবেন|পারবে)\s*\?|\?\s*$")
_WHEN = re.compile(r"আজ|কাল|পরশু|আগামী|সোমবার|মঙ্গলবার|বুধবার|বৃহস্পতিবার|শুক্রবার|শনিবার|রবিবার|টার\s*মধ্যে|ঘণ্টার\s*মধ্যে|সপ্তাহ"
                   r"|\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|by\s+\w+|within|next\s+week|asap)\b", re.I)
_STATUS = re.compile(
    r"কাজের\s*কী\s*হলো|কাজটা?\s*(?:কতদূর|কী\s*অবস্থা|কি\s*অবস্থা|হয়েছে|হলো)|কতদূর\s*হলো|কী\s*হলো\s*আমার|আমার\s*কাজ|কবে\s*পাব|হয়ে\s*গেছে\s*কি"
    r"|what\s+happened\s+to\s+my|any\s+update|status\s+of|is\s+it\s+done|how\s+far|when\s+will\s+(?:it|i)\s+(?:be|get)|did\s+you\s+(?:finish|do|send)", re.I)


def detect(text: str, now: datetime) -> list[dict[str, Any]]:
    """[{title_body, due_at|None, confidence: high|medium|low, kind}] for what the SENDER asks the owner to do. Max 2."""
    if not text or len(text.strip()) < 6:
        return []
    out: list[dict[str, Any]] = []
    for coarse, clauses in pr._clean(text):
        for s in clauses:
            if len(s) < 6 or pr._BN_NEG.search(s) or pr._EN_NEG.search(s):
                continue
            strong = bool(_BN_REQ.search(s) or _EN_REQ.search(s))
            question_form = bool(_EN_QREQ.search(s) or (_BN_QREQ.search(s) and _BN_REQ.search(s)))
            if not strong and not question_form:
                continue
            has_when = bool(_WHEN.search(coarse))
            conf = "low" if (question_form and "?" in coarse and not _BN_REQ.search(s)) else ("high" if has_when else "medium")
            out.append({"title_body": pr._short(s, 60), "due_at": pr._due(coarse, now)[0] if has_when else None, "confidence": conf, "kind": pr._kind(s)})
            if len(out) == 2:
                return out
    return out


def proposal_title(contact: Any, body: str, private: bool) -> str:
    if private:
        return PRIVATE_TITLE
    who = pr._short(str(getattr(contact, "name", None) or getattr(contact, "phone", None) or "").split(":")[-1], 40)
    return (f"{who}: কাজ: {body}" if who else f"কাজ: {body}")[:300]


def asks_status(text: str) -> bool:
    return bool(text) and bool(_STATUS.search(text))


def task_status(tasks: list[dict[str, Any]], now: datetime) -> list[tuple[str, str]]:
    """[(status, plain Bangla line)] from what is really stored. Statuses: completed | delayed | open | proposed.
    Never invents progress, a completion or a date."""
    now = pr.datetime.now(pr.timezone.utc) if now is None else (now if now.tzinfo else now.replace(tzinfo=pr.timezone.utc))
    out = []
    for t in tasks:
        due = t.get("due_at")
        due = due if (due is None or due.tzinfo) else due.replace(tzinfo=pr.timezone.utc)
        if t.get("status") == "blocked" and not t.get("is_done"):
            out.append(("blocked", "বাধায় আটকে আছে" + (f": {t['blocker']}" if t.get("blocker") else "") + " — আপনার নিজের লেখা তথ্য"))
        elif t.get("status") == "in_progress" and t.get("progress") and not t.get("is_done"):
            out.append(("open", f"চলছে। আপনার শেষ আপডেট: {t['progress'][:120]}"))
        elif t.get("is_done"):
            out.append(("completed", "শেষ হয়েছে বলে চিহ্নিত" + (f" ({t['done_at']:%d/%m})" if t.get("done_at") else "") + " — আপনি নিশ্চিত করেছেন"))
        elif t.get("source") == PROPOSED:
            out.append(("proposed", "কাজটি ধরা হয়েছে কিন্তু আপনি এখনো নিশ্চিত করেননি"))
        elif due and due < now:
            out.append(("delayed", f"খোলা আছে, সময় ({due.astimezone(pr.DHAKA):%d/%m}) পেরিয়েছে; অগ্রগতির কোনো তথ্য নেই"))
        else:
            out.append(("open", "খোলা আছে; অগ্রগতির কোনো তথ্য নেই" + (f"; সময় {due.astimezone(pr.DHAKA):%d/%m}" if due else "; কোনো সময় ঠিক করা নেই")))
    return out


def status_note(tasks: list[dict[str, Any]], now: datetime, private: bool) -> str:
    """One line for the owner when the person asks about the work. Never a promise to the person."""
    if not tasks:
        return "কাজের খবর চাইছেন, কিন্তু এই ব্যক্তির জন্য কোনো টাস্ক নেই — অবস্থা অজানা, আপনি জানান"
    lines = []
    for t, (_, text) in zip(tasks, task_status(tasks, now)):
        lines.append(text if private else f"“{(t.get('title') or '')[:50]}”: {text}")
    return "কাজের খবর চাইছেন। " + "; ".join(lines[:3])


def reminder_kind(due_at: Any, now: datetime, lead_min: int, sent: str | None) -> str | None:
    """"due" (due within `lead_min` minutes) or "late" (overdue by at most 3 days), once each; None = nothing to say. 0 = off."""
    if not lead_min or due_at is None:
        return None
    due = due_at if due_at.tzinfo else due_at.replace(tzinfo=pr.timezone.utc)
    now = now if now.tzinfo else now.replace(tzinfo=pr.timezone.utc)
    left = (due - now).total_seconds() / 60
    if 0 < left <= lead_min and sent not in ("due", "late"):
        return "due"
    if -3 * 24 * 60 <= left <= 0 and sent != "late":
        return "late"
    return None
