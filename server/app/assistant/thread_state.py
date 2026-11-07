"""Who answered whom? (Brain_Prompt §9.3, §9.4, §11). Pure functions: no database, no network.

* `assess`          - the state of the latest conversation burst: none / assistant_only / new_inbound / adequate / partial / uncertain.
* `grouped_text`    - one burst of messages from the same person = one text to analyse (the grouping window, default 5 minutes).
* `reminder_reason` - is an "unanswered" reminder due? It never says "read": the phone cannot know that, only "no answer found".

The owner's own answers are recognised through `reason in ("owner","manual")` (`sent-by-hand`, Telegram, approved by hand);
the assistant's through every other real outgoing message. Drafts, failed and skipped messages are not answers.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from app.assistant import wa_brain as brain
from app.assistant.call_context import is_call

UTC = timezone.utc
REAL_OUT = ("sent", "queued", "sending")
OWNER = ("owner", "manual")
NEEDS_ANSWER = ("none", "assistant_only", "new_inbound", "partial", "uncertain")


def _at(v: Any) -> datetime | None:
    if not isinstance(v, datetime):
        return None
    return v if v.tzinfo else v.replace(tzinfo=UTC)


def settings_grouping(cfg: dict[str, Any]) -> int:
    try:
        return max(0, min(int((cfg.get("grouping") or {}).get("window_min", 5)), 30))
    except (TypeError, ValueError):
        return 5


def settings_reminders(cfg: dict[str, Any]) -> tuple[int, bool]:
    c = cfg.get("reminders") or {}
    try:
        minutes = max(0, min(int(c.get("unanswered_min", 0)), 1440))
    except (TypeError, ValueError):
        minutes = 0
    return minutes, bool(c.get("only_important", True))


def _questions(body: str) -> int:
    body = body or ""
    if not brain.is_question(body):
        return 0
    return max(1, body.count("?") + body.count("？"))


@dataclass
class ReplyState:
    status: str = "none"       # none | assistant_only | new_inbound | adequate | partial | uncertain
    unanswered: int = 0        # messages of the latest burst still without an owner answer
    questions: int = 0
    last_in_at: datetime | None = None
    last_in_id: Any = None
    owner_replied: bool = False
    dismissed: bool = False    # the phone saw the notification disappear: NOT proof of reading
    label: str = ""


def assess(recent: list[dict[str, Any]]) -> ReplyState:
    """`recent` = the person's messages newest first (calls are ignored: a ring is not a sentence)."""
    st = ReplyState()
    burst: list[dict[str, Any]] = []
    owner_reply: dict[str, Any] | None = None
    assistant_replied = False
    rest: list[dict[str, Any]] = []
    for m in recent:
        if is_call(m):
            continue
        if m.get("direction") == "in":
            if m.get("status") == "imported":
                continue  # old history is context, not something waiting for an answer
            (burst if owner_reply is None else rest).append(m)
        elif m.get("direction") == "out" and m.get("status") in REAL_OUT + ("imported",):
            if owner_reply is not None:
                break
            if (m.get("reason") or "") in OWNER:
                owner_reply = m
            else:
                assistant_replied = True
    if burst:
        st.last_in_at, st.last_in_id = _at(burst[0].get("created_at")), burst[0].get("id")
    st.unanswered = len(burst)
    st.dismissed = any((m.get("meta") or {}).get("dismissed_at") for m in burst)
    st.owner_replied = owner_reply is not None
    if burst:  # the person wrote after the owner's last answer (or the owner never answered)
        st.questions = sum(_questions(m.get("body") or "") for m in burst)
        st.status = "new_inbound" if owner_reply is not None else ("assistant_only" if assistant_replied else "none")
        st.label = {"new_inbound": "আপনার উত্তরের পর নতুন বার্তা এসেছে", "assistant_only": "শুধু সহকারী সাড়া দিয়েছে, আপনি দেননি",
                    "none": "কোনো উত্তর পাওয়া যায়নি"}[st.status]
        return st
    if owner_reply is None:
        st.label = "উত্তর দেওয়ার মতো নতুন বার্তা নেই"
        return st
    st.last_in_at, st.last_in_id = _at(rest[0].get("created_at")) if rest else None, rest[0].get("id") if rest else None
    st.questions = sum(_questions(m.get("body") or "") for m in rest)
    reply = (owner_reply.get("body") or "").strip()
    if not rest:
        st.status, st.label = "adequate", "আপনি নিজেই কথা শুরু করেছেন"
    elif st.questions >= 2 and len(reply) < 30:
        st.status, st.label = "partial", f"{st.questions}টি প্রশ্নের মধ্যে আপনার উত্তর সম্ভবত অংশত"
    elif st.questions and len(reply) < 4:
        st.status, st.label = "uncertain", "আপনার উত্তরটি এত ছোট যে প্রশ্নের জবাব কি না নিশ্চিত নই"
    else:
        st.status, st.label = "adequate", "আপনি উত্তর দিয়েছেন"
    return st


def grouped_text(recent: list[dict[str, Any]], current_body: str, current_at: datetime, window_min: int) -> tuple[str, int]:
    """Texts of this person's burst (same person, inbound, no answer in between, within 3 windows), oldest first. Returns (text, count)."""
    if window_min <= 0:
        return current_body, 1
    now = _at(current_at) or datetime.now(UTC)
    parts = [current_body]
    for m in recent:  # newest first
        if m.get("direction") == "out" and m.get("status") in REAL_OUT:
            break
        a = _at(m.get("created_at"))
        if m.get("direction") != "in" or is_call(m) or (m.get("meta") or {}).get("group") or not a or now - a > timedelta(minutes=3 * window_min):
            continue
        parts.append(m.get("body") or "")
    parts = [p for p in reversed(parts) if p and p.strip()]
    return "\n".join(parts), max(1, len(parts))


def reminder_reason(cfg: dict[str, Any], contact: Any, st: ReplyState, now: datetime, already: bool) -> str:
    """'' = no reminder; otherwise the plain-Bangla line. Needs: owner switched it on, a real wait, an important person, nobody (owner) active."""
    minutes, only_important = settings_reminders(cfg)
    now = _at(now) or datetime.now(UTC)
    if not minutes or already or st.status not in NEEDS_ANSWER or not st.last_in_at or (st.status == "none" and not st.unanswered):
        return ""
    waited = (now - st.last_in_at).total_seconds() / 60
    if waited < minutes or waited > 24 * 60:
        return ""
    if getattr(contact, "is_blocked", False) or getattr(contact, "state", "") == "owner" or getattr(contact, "category", None) == "spam":
        return ""
    important = (getattr(contact, "priority", 5) or 5) <= 4 or getattr(contact, "is_vip", False) or getattr(contact, "is_family", False) \
        or any(t.get("important") for t in (getattr(contact, "tags", None) or [])) or getattr(contact, "category", None) == "business"
    if only_important and not important:
        return ""
    n = max(st.unanswered, 1)
    if st.status == "partial":
        return f"⏰ আংশিক উত্তর: {st.label}। বাকিটা দেখুন"
    if st.status == "uncertain":
        return f"⏰ যাচাই করুন: {st.label}"
    seen = "নোটিফিকেশন সরানো হয়েছে (এটা পড়ার প্রমাণ নয়)" if st.dismissed else "পড়া হয়েছে কি না অ্যাপ জানে না"
    return f"⏰ {brain.bn_digits(n)}টি বার্তার উত্তর বাকি ({brain.bn_digits(int(waited))} মিনিট) — কেউ উত্তর দিয়েছে এমন প্রমাণ নেই; {seen}"
