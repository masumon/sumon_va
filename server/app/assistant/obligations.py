"""Official/legal notices and social invitations (Brain domains 3 Social, 6 Legal & Official, 14 Priority).

Rules only, no AI. `detect` says whether a message is an official matter or an invitation and, when the same message
carries a date or time, when it is due (the promise parser's own date reading). `wa_brain.decide` uses the official part
to stay silent and raise priority; `wa_flow._process` turns a DATED one into a PROPOSED task (the owner confirms).
Nothing here sends anything, and a private/family contact's words are never copied into a task title.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.assistant import assignments
from app.assistant import promises as pr

PRIVATE_TITLE = "তারিখসহ দায়িত্ব (লেখা সুরক্ষিত)"
PREFIX = {"official": "দাপ্তরিক", "invite": "দাওয়াত"}


def detect(text: str, cfg: dict[str, Any], now: datetime) -> dict[str, Any] | None:
    """{kind: official|invite, word, due_at|None} or None. Official wins over invitation."""
    from app.assistant.wa_brain import has_any  # late import: wa_brain imports this module's caller chain

    if not text or len(text.strip()) < 4:
        return None
    for kind, key in (("official", "official_words"), ("invite", "invite_words")):
        word = has_any(text, cfg.get(key) or [])
        if word:
            due = pr._due(text, now)[0] if assignments._WHEN.search(text) else None
            return {"kind": kind, "word": word, "due_at": due}
    return None


def proposal_title(contact: Any, kind: str, body: str, private: bool) -> str:
    if private:
        return PRIVATE_TITLE
    who = pr._short(str(getattr(contact, "name", None) or getattr(contact, "phone", None) or "").split(":")[-1], 40)
    what = f"{PREFIX.get(kind, kind)}: {pr._short(body, 60)}"
    return (f"{who}: {what}" if who else what)[:300]
