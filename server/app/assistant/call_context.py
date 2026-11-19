"""Missed-call intelligence: WHY might this person have called, and is it worth one alert?

Pure functions (no database, no network) so every rule is testable. `wa_flow._process` gathers the facts and calls `analyze`.

What it uses (only what really exists in the inbox): the caller's earlier calls, their messages before the call, whether the
owner already answered, open tasks for this person, and the owner's own priority words. What it never does: state a reason as
a fact. Every reason is a *hypothesis* with a plain confidence label, and a call with no evidence says exactly that.

Burst control (no schema, state lives in `WaMessage.meta["call_alert"]` of the call that raised the alert):
  * one alert per burst (default window 10 minutes);
  * a later call in the same burst raises a new alert only with NEW evidence (a message arrived after the alert, or the priority
    became more urgent) or when the owner set `calls.escalate_after` (0 = off);
  * a lone call from a stranger with no context stays quiet (priority 5) but is kept in the inbox.
"""
from __future__ import annotations

import re

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from app.assistant import privacy
from app.assistant import wa_brain as brain

MISSED_TEXT = "[মিসড কল]"
UTC = timezone.utc
LEVEL = {1: "জরুরি", 2: "উচ্চ", 3: "মাঝারি", 4: "মাঝারি", 5: "নিম্ন"}  # Critical / High / Medium / Medium / Low
NO_OVERRIDE = {"blocked", "spam", "owner_active", "group"}  # hard stops decided earlier: a call never reopens them
DONE = ("sent", "queued", "sending")


def settings(cfg: dict[str, Any]) -> dict[str, Any]:
    c = cfg.get("calls") or {}

    def num(key: str, default: int, lo: int, hi: int) -> int:
        try:
            return max(lo, min(int(c.get(key, default)), hi))
        except (TypeError, ValueError):
            return default

    return {"burst_min": num("burst_min", 10, 1, 120), "escalate_after": num("escalate_after", 0, 0, 50), "reply": bool(c.get("reply", False))}


def _at(v: Any) -> datetime | None:
    if not isinstance(v, datetime):
        return None
    return v if v.tzinfo else v.replace(tzinfo=UTC)  # SQLite hands back naive times; the database stores UTC


# WhatsApp / IMO / Messenger write these themselves; the phone forwards them as ordinary chat notifications.
_APP_MISSED = re.compile(r"^\s*(?:\d+\s+)?missed\s+(?:voice\s+|video\s+|group\s+)?calls?\b|^\s*(?:[\d০-৯]+টি\s+)?মিসড\s*(?:ভয়েস\s*|ভিডিও\s*)?কল", re.I)


def is_call(m: dict[str, Any]) -> bool:
    body = (m.get("body") or "").strip()
    return bool((m.get("meta") or {}).get("call")) or body == MISSED_TEXT or bool(_APP_MISSED.match(body))


@dataclass
class CallInsight:
    attempts_burst: int = 1
    attempts_day: int = 1
    priority: int = 5
    level: str = "নিম্ন"
    alert: bool = False
    escalated: bool = False          # a second alert inside one burst, justified by new evidence or the owner's own setting
    suppressed_why: str = ""
    hypotheses: list[tuple[str, str]] = field(default_factory=list)   # (text, confidence label)
    facts: list[str] = field(default_factory=list)                     # verified context only
    action: str = ""
    summary: str = ""
    note: str = ""


def analyze(cfg: dict[str, Any], contact: Any, recent: list[dict[str, Any]], open_tasks: list[dict[str, Any]],
            now: datetime, base_priority: int = 5) -> CallInsight:
    """`recent` = the caller's messages newest first, WITHOUT the call being analysed. `open_tasks` = [{"title", "due_at"}]."""
    s = settings(cfg)
    now = _at(now) or datetime.now(UTC)
    win = timedelta(minutes=s["burst_min"])
    private = privacy.is_private(contact)
    out = CallInsight()

    calls = [m for m in recent if m.get("direction") == "in" and is_call(m)]
    texts = [m for m in recent if m.get("direction") == "in" and not is_call(m)]
    in_burst = [m for m in calls if (a := _at(m.get("created_at"))) and now - a <= win]
    out.attempts_burst = 1 + len(in_burst)
    out.attempts_day = 1 + sum(1 for m in calls if (a := _at(m.get("created_at"))) and now - a <= timedelta(hours=24))

    # ── what is actually known ────────────────────────────────────────────────
    day_texts = [m for m in texts if (a := _at(m.get("created_at"))) and now - a <= timedelta(hours=24)]
    last_in = day_texts[0] if day_texts else None
    last_in_at = _at(last_in.get("created_at")) if last_in else None
    answered = any(m.get("direction") == "out" and m.get("status") in DONE and (_at(m.get("created_at")) or now) >= (last_in_at or now)
                   and (m.get("reason") or "") in ("owner", "manual") for m in recent)
    unanswered = 0
    for m in recent:  # newest first: messages since anything really went out
        if m.get("direction") == "out" and m.get("status") in DONE:
            break
        if m.get("direction") == "in" and not is_call(m) and (a := _at(m.get("created_at"))) and now - a <= timedelta(hours=24):
            unanswered += 1
    tasks = [t for t in open_tasks if t.get("title")]
    overdue = [t for t in tasks if (d := _at(t.get("due_at"))) and d < now]

    if day_texts:
        out.facts.append(f"২৪ ঘণ্টায় {brain.bn_digits(len(day_texts))}টি বার্তা পাঠিয়েছেন" + (f" (শেষটি: “{(last_in.get('body') or '')[:50]}”)" if not private and last_in and last_in.get("body") else ""))
    if unanswered:
        out.facts.append(f"{brain.bn_digits(unanswered)}টি বার্তার উত্তর যায়নি")
    if answered:
        out.facts.append("আপনি আগেই উত্তর দিয়েছেন")
    if tasks:
        out.facts.append(f"তাঁর জন্য {brain.bn_digits(len(tasks))}টি খোলা কাজ" + (f", {brain.bn_digits(len(overdue))}টির সময় পেরিয়েছে" if overdue else ""))

    # ── hypotheses: never facts ───────────────────────────────────────────────
    last_text = (last_in.get("body") or "") if last_in and not private else ""
    asked = bool(last_text) and brain.is_question(last_text)
    if tasks:
        out.hypotheses.append(("আগের কাজ/প্রতিশ্রুতির খোঁজ নিতে পারেন", "মাঝারি" if overdue or unanswered else "নিম্ন"))
    if unanswered and not answered:
        out.hypotheses.append(("আগের বার্তার উত্তর না পেয়ে ফোন করে থাকতে পারেন", "মাঝারি" if asked or unanswered >= 2 else "নিম্ন"))
    if answered:
        out.hypotheses.append(("আপনার উত্তরের পরও কিছু জানাতে বা শুনতে চাইতে পারেন", "নিম্ন"))
    word_p = brain.rule_priority(last_text, cfg, contact, "other", False)[0] if last_text else 5
    if word_p <= 2 and not getattr(contact, "is_family", False):
        out.hypotheses.append(("জরুরি বা টাকা-সংক্রান্ত বিষয় হতে পারে (তাঁর শেষ বার্তার শব্দ দেখে)", "নিম্ন"))
    if out.attempts_burst >= 3:
        out.hypotheses.append((f"{s['burst_min']} মিনিটে {out.attempts_burst} বার ফোন: জরুরি হতে পারে", "মাঝারি"))
    if not out.hypotheses:
        out.hypotheses.append(("কারণ বোঝার মতো কোনো প্রমাণ নেই", "নিম্ন"))

    # ── priority (only ever raises urgency; never below what the brain already decided) ──
    p = base_priority
    if tasks or (unanswered and not answered):
        p = min(p, 3)
    if word_p <= 2:
        p = min(p, word_p)
    if out.attempts_burst >= 3:
        p = min(p, 4)
    if getattr(contact, "is_family", False):
        p = min(p, 2)
    out.priority, out.level = p, LEVEL.get(p, "নিম্ন")

    # ── burst control ─────────────────────────────────────────────────────────
    alerted = [m for m in in_burst if (m.get("meta") or {}).get("call_alert")]
    if p > 4:
        out.suppressed_why = "প্রসঙ্গ বা বারবার ফোনের প্রমাণ নেই, তাই আলাদা অ্যালার্ট নয় (ইনবক্সে আছে)"
    elif not alerted:
        out.alert = True
    else:
        prev = max(alerted, key=lambda m: _at(m.get("created_at")) or now)
        prev_at, prev_p = _at(prev.get("created_at")) or now, int((prev["meta"]["call_alert"] or {}).get("p", 5))
        new_message = any((_at(m.get("created_at")) or now) > prev_at for m in texts)
        by_count = bool(s["escalate_after"]) and out.attempts_burst >= s["escalate_after"] and out.attempts_burst > int((prev["meta"]["call_alert"] or {}).get("n", 0))
        if new_message or p < prev_p or by_count:
            out.alert = out.escalated = True
        else:
            out.suppressed_why = f"{out.attempts_burst}তম ফোন — এই {s['burst_min']} মিনিটের অ্যালার্ট আগেই গেছে, নতুন তথ্য নেই"

    top = out.hypotheses[0]
    out.action = ("আগে চ্যাট দেখুন, তারপর উত্তর দিন বা কলব্যাক করুন" if (tasks or unanswered) and not answered
                  else "দরকার মনে করলে কলব্যাক করুন")
    who_line = f"📞 মিসড কল · {out.attempts_burst} বার" + (f" ({s['burst_min']} মিনিটে)" if out.attempts_burst > 1 else "") + f" · আজ মোট {out.attempts_day}"
    out.summary = f"{who_line} · অনুমান (আস্থা {top[1]}): {top[0]} · পরামর্শ: {out.action}"
    detail = "; ".join(out.facts) or "যাচাই-করা কোনো প্রসঙ্গ নেই"
    out.note = f"মিসড কল ({out.level})। জানা তথ্য: {detail}। কারণটি শুধু অনুমান, নিশ্চিত নয়" + (f" · {out.suppressed_why}" if out.suppressed_why else "")
    return out


def tactful_call_reply(
    cfg: dict[str, Any],
    contact: Any,
    ins: CallInsight,
    status: dict[str, Any] | None = None,
    lang: str = "bn",
) -> str | None:
    """Craft a polite, status-aware & context-aware tactical reply for a missed or unanswered call."""
    if "আপনি আগেই উত্তর দিয়েছেন" in (ins.facts or []):
        return None
    if contact is not None and getattr(contact, "is_family", False) and getattr(contact, "mode", None) != "auto":
        return None
    is_vip = bool(getattr(contact, "is_vip", False))
    cat = getattr(contact, "category", None)
    stranger = not is_vip and cat not in ("business", "social", "personal") and not (ins.facts or [])
    if stranger and ins.attempts_burst < 2:
        return None
    owner = str(cfg.get("owner_name") or "সুমন ভাই").strip()
    st = status or brain.current_status(cfg)
    st_key = (st or {}).get("key") or "free"
    st_say = str((st or {}).get("say") or "").strip().rstrip("।.")
    if lang == "en":
        if stranger:
            return (
                f"Assalamu Alaikum, {owner} could not take your call right now. "
                "Please share your name and the purpose of your call here; he will get back to you soon."
            )
        busy_en = brain.STATUS_EN.get(st_key, "is occupied right now")
        return (
            f"Assalamu Alaikum, we saw your missed call. {owner} {busy_en}. "
            "Your call has been noted with priority and he will call you back as soon as he is free. "
            "If it is urgent, please leave a short text here."
        )
    if stranger:
        return (
            f"আসসালামু আলাইকুম, {owner} এখন কল ধরতে পারছেন না। "
            "কে বলছেন এবং কী প্রয়োজনে ফোন দিয়েছেন অনুগ্রহ করে লিখে জানান, তিনি দেখে যোগাযোগ করবেন।"
        )
    status_part = f"{owner} {st_say}।" if st_say and st_key != "free" else f"{owner} এই মুহূর্তে কলটি রিসিভ করতে পারেননি।"
    facts_joined = " ".join(ins.facts or [])
    ctx_part = ""
    if "খোলা কাজ" in facts_joined:
        ctx_part = " আপনার আগের কাজের বিষয়টি আমাদের নোটে আছে।"
    elif "বার্তার উত্তর যায়নি" in facts_joined or "বার্তা পাঠিয়েছেন" in facts_joined:
        ctx_part = " আপনার আগের বার্তাটিও আমাদের নজরে আছে।"
    reply_by = str(cfg.get("reply_by") or "").strip()
    when_part = f" আশা করা যায় {reply_by} ফ্রি হয়েই" if reply_by and st_key != "free" else " ফ্রি হয়েই"
    return (
        f"আসসালামু আলাইকুম, আপনার কলটি এসেছে। {status_part}{ctx_part}"
        f" আপনার কলের বিষয়টি গুরুত্বের সাথে নোট করা হয়েছে,{when_part} তিনি আপনার সাথে যোগাযোগ করবেন। "
        "জরুরি কিছু হলে এখানে সংক্ষেপে লিখে রাখতে পারেন।"
    )


def apply(
    d: "brain.Decision",
    ins: CallInsight,
    cfg: dict[str, Any],
    contact: Any = None,
    status: dict[str, Any] | None = None,
) -> bool:
    """Put the insight into the brain's decision. Returns False (and changes nothing) after a hard stop such as a blocked number."""
    if d.reason in NO_OVERRIDE:
        return False
    d.priority, d.kind, d.need = ins.priority, "call", "মিসড কল"
    d.summary, d.note = ins.summary, ins.note
    d.notify = ins.alert
    if contact is None:
        if not settings(cfg)["reply"]:  # legacy pure caller without contact object
            d.reply, d.reason = None, "call_missed"
        return True
    if ins.attempts_burst >= 2 and (getattr(contact, "is_vip", False) or getattr(contact, "is_family", False) or ins.priority <= 2):
        d.priority = 1
        d.notify = True
    want_reply = (
        bool(cfg.get("call_tactical_reply", True))
        or settings(cfg)["reply"]
        or bool(getattr(contact, "is_vip", False))
        or getattr(contact, "mode", None) == "auto"
    )
    if want_reply:
        d.reply = tactful_call_reply(cfg, contact, ins, status=status, lang=d.lang)
        d.reason = "call_missed"
    else:
        d.reply, d.reason = None, "call_missed"
    if d.reply or ins.priority <= 3 or ins.attempts_burst >= 2 or getattr(contact, "is_vip", False):
        who = (getattr(contact, "name", None) or "").strip() or "কলার"
        title = f"{who}-কে কলব্যাক করুন (মিসড কল {brain.bn_digits(ins.attempts_burst)} বার)"
        if not any("কলব্যাক" in str(t.get("title") or "") for t in (d.tasks or [])):
            d.tasks = list(d.tasks or []) + [{"title": title[:200], "due": None}]
    return True


def after_call_note(recent: list[dict[str, Any]], now: datetime, minutes: int = 30) -> str:
    """A normal message arrives soon after this person's missed call: say so (verified fact, no guess)."""
    now = _at(now) or datetime.now(UTC)
    for m in recent:
        a = _at(m.get("created_at"))
        if m.get("direction") == "in" and is_call(m) and a and now - a <= timedelta(minutes=minutes):
            return f"ফোন করার পর {brain.bn_digits(int((now - a).total_seconds() // 60))} মিনিটের মধ্যে বার্তা পাঠিয়েছেন"
    return ""
