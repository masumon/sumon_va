"""Keep only the e-mails that matter. Promotions, newsletters and automatic mail are dropped BEFORE they are stored.

Why: the free server and database are small; a mailbox of offers would fill them with nothing. Decision, in order:
  1. the owner's own block list (sender/word)            -> drop
  2. the owner's own allow list, a person he knows, or a reply ("Re:") -> keep
  3. words that mean money, law, deadlines, orders        -> keep
  4. no-reply senders, newsletter/promotion words, "unsubscribe" -> drop
  5. anything else                                        -> keep (a real person writing to you is more likely than not important)
Only a counter of what was dropped is kept, never the mail itself.
"""
from __future__ import annotations

import re
from typing import Any

from app.assistant import wa_brain as brain

GMAIL_PACKAGES = ("com.google.android.gm",)

NOISY_SENDER = re.compile(r"(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|newsletter|marketing|promo(tion)?s?|offers?|deals?|mailer|mailchimp|sendgrid|notifications?@|alerts?@|updates?@|digest|bounce|info@.*(sale|shop))", re.I)
PROMO_WORDS = ["unsubscribe", "% off", "percent off", "sale", "limited time", "special offer", "flash", "discount", "coupon", "promo code", "deal of", "free shipping", "webinar", "newsletter",
               "weekly digest", "you won", "congratulations", "click here", "buy now", "order now", "last chance", "exclusive",
               "অফার", "ছাড়", "ডিসকাউন্ট", "বিশেষ মূল্য", "সীমিত সময়", "ফ্রি ডেলিভারি", "বিজ্ঞাপন", "লটারি", "জিতেছেন", "কুপন"]
IMPORTANT_WORDS = ["invoice", "payment", "paid", "receipt", "overdue", "due date", "deadline", "urgent", "asap", "contract", "agreement", "court", "legal notice", "tax", "visa", "interview", "meeting", "appointment",
                   "your order", "delivery failed", "security alert", "password reset", "verification",
                   "ইনভয়েস", "পেমেন্ট", "বকেয়া", "জরুরি", "চুক্তি", "মামলা", "আদালত", "নোটিশ", "কর", "ভিসা", "ইন্টারভিউ", "মিটিং", "সাক্ষাৎ", "অর্ডার", "ব্যাংক"]


def _hit(text: str, words: list[str]) -> bool:
    low = (text or "").lower()
    return any(w.lower() in low for w in words if w)


def settings_of(cfg: dict[str, Any]) -> dict[str, Any]:
    s = cfg.get("email_filter") or {}
    return {"mode": s.get("mode", "important"), "allow": list(s.get("allow") or []), "block": list(s.get("block") or [])}


def is_email_source(channel: str, app: str | None) -> bool:
    return channel == "email" or (app or "") in GMAIL_PACKAGES


def decide(cfg: dict[str, Any], sender: str, subject: str, body: str = "", known_person: bool = False) -> tuple[bool, str]:
    """(keep?, short reason). `known_person` = the sender is already someone the owner has chatted with, tagged, or starred."""
    s = settings_of(cfg)
    if s["mode"] == "all":
        return True, "সব ইমেইল আনার সেটিং"
    text = f"{sender} {subject} {body}"
    if _hit(text, s["block"]):
        return False, "আপনার ব্লক-তালিকায়"
    if known_person or _hit(text, s["allow"]):
        return True, "চেনা ব্যক্তি/আপনার অনুমোদন-তালিকা"
    if re.match(r"^\s*(re|fw|fwd)\s*:", subject or "", re.I):
        return True, "উত্তর/ফরওয়ার্ড (কথোপকথন চলছে)"
    if _hit(text, IMPORTANT_WORDS):
        return True, "জরুরি/টাকা/আইনি শব্দ আছে"
    if NOISY_SENDER.search(sender or "") or _hit(f"{subject} {body}", PROMO_WORDS):
        return False, "প্রচার/অটো-ইমেইল"
    return True, "সাধারণ ব্যক্তিগত ইমেইল"


async def count_dropped(db: Any, n: int = 1) -> None:
    """Keep a daily counter of what was filtered out (the only thing stored about dropped mail)."""
    from app.assistant import wa_flow

    today = brain.now_dhaka().strftime("%Y-%m-%d")
    raw = await wa_flow._get_val(db, "email_dropped")
    day, _, total = raw.partition(":")
    kept = int(total) if day == today and total.isdigit() else 0
    await wa_flow._set_val(db, "email_dropped", f"{today}:{kept + n}")


async def dropped_today(db: Any) -> int:
    from app.assistant import wa_flow

    day, _, total = (await wa_flow._get_val(db, "email_dropped")).partition(":")
    return int(total) if day == brain.now_dhaka().strftime("%Y-%m-%d") and total.isdigit() else 0
