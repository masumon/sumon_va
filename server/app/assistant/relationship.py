"""Signs of how the relationship with one person changes over time (Brain_Prompt section 6 domains 12 and 15).

Observations only, computed from the stored messages; every line is a HYPOTHESIS with the evidence it rests on, and there is no
score and no judgement of the person. Too little evidence = no observation at all. Pure functions, no database.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Any

from app.assistant.call_context import is_call

UTC = timezone.utc
MIN_MESSAGES = 6  # fewer than this and we say nothing


def _at(v: Any) -> datetime | None:
    if not isinstance(v, datetime):
        return None
    return v if v.tzinfo else v.replace(tzinfo=UTC)


def observe(messages: list[dict[str, Any]], now: datetime) -> list[dict[str, str]]:
    """`messages` newest first (any channel of the same person). Returns [{text, confidence, basis}]."""
    now = _at(now) or datetime.now(UTC)
    real = [m for m in messages if _at(m.get("created_at")) and (m.get("direction") == "in" or m.get("status") in ("sent", "queued", "sending"))]
    if len(real) < MIN_MESSAGES:
        return []
    out: list[dict[str, str]] = []
    inbound = [m for m in real if m["direction"] == "in" and not is_call(m)]
    calls = [m for m in real if m["direction"] == "in" and is_call(m)]

    # 1. volume: the last 14 days against the 14 days before (needs enough on both sides)
    def count(items, lo, hi):  # messages whose age is in [lo, hi)
        return sum(1 for m in items if lo <= (now - _at(m["created_at"])) < hi)

    recent_n = count(inbound, timedelta(0), timedelta(days=14))
    before_n = count(inbound, timedelta(days=14), timedelta(days=28))
    if before_n >= 4 and recent_n >= 2 * before_n:
        out.append({"text": "গত ১৪ দিনে এই ব্যক্তি আগের ১৪ দিনের চেয়ে অনেক বেশি বার্তা পাঠিয়েছেন", "confidence": "medium", "basis": f"{recent_n}টি বনাম {before_n}টি বার্তা"})
    elif recent_n == 0 and before_n >= 4:
        out.append({"text": "আগে নিয়মিত লিখতেন, গত ১৪ দিনে কোনো বার্তা নেই", "confidence": "medium", "basis": f"আগের ১৪ দিনে {before_n}টি, এখন ০টি"})

    # 2. how fast the owner usually answers (median over answered incoming messages) and how that moved
    lags: list[tuple[datetime, float]] = []
    ordered = sorted(real, key=lambda m: _at(m["created_at"]))
    for i, m in enumerate(ordered):
        if m["direction"] == "in" and not is_call(m):
            nxt = next((o for o in ordered[i + 1:] if o["direction"] == "out" and (o.get("reason") or "") in ("owner", "manual")), None)
            if nxt:
                lags.append((_at(m["created_at"]), (_at(nxt["created_at"]) - _at(m["created_at"])).total_seconds() / 60))
    if len(lags) >= 6:
        half = len(lags) // 2
        old, new = median(x for _, x in lags[:half]), median(x for _, x in lags[half:])
        if old >= 1 and new >= 3 * old and new >= 30:
            out.append({"text": "আপনার উত্তর দিতে দেরি আগের চেয়ে বেড়েছে", "confidence": "low", "basis": f"মধ্যমা সময় {int(old)} মিনিট থেকে {int(new)} মিনিট"})
        elif new * 3 <= old and old >= 30:
            out.append({"text": "আপনি এখন আগের চেয়ে অনেক দ্রুত উত্তর দিচ্ছেন", "confidence": "low", "basis": f"মধ্যমা সময় {int(old)} মিনিট থেকে {int(new)} মিনিট"})

    # 3. repeated calls
    week_calls = sum(1 for m in calls if now - _at(m["created_at"]) <= timedelta(days=7))
    if week_calls >= 3:
        out.append({"text": "গত ৭ দিনে একাধিকবার ফোন করেছেন", "confidence": "medium", "basis": f"{week_calls}টি মিসড কল"})

    # 4. long silence after an unanswered message
    last = max(real, key=lambda m: _at(m["created_at"]))
    if last["direction"] == "in" and not is_call(last) and now - _at(last["created_at"]) > timedelta(days=3):
        out.append({"text": "শেষ বার্তার উত্তর যায়নি এবং ৩ দিনের বেশি পার হয়েছে", "confidence": "high", "basis": "শেষ বার্তাটি তাঁর, তারপর কোনো উত্তর নেই"})
    return out
