"""Promotional and junk messages: SIM-operator offers, app/shop promotions, lotteries. They go to the "spam" folder, never to the inbox.

Rules only (no AI, no network). A message is promotional when
  * it comes from a known promotional sender (operators GP/Robi/Banglalink/Airtel/Teletalk/Skitto, shops), or
  * it comes from a NAME instead of a phone number (a sender id like "MyGP", "Daraz") and talks like an offer.
Never promotional: anything that looks like money moving or a one-time code (bKash, Nagad, banks, "credited", OTP), and any
sender the owner put in his own allow list. The owner's block list always wins over the rules.
Spam is kept 3 days (`retention_by_category.spam`) and can be cleared at once from the app.
"""
from __future__ import annotations

import re
from typing import Any

OPERATORS = ("gp", "grameenphone", "mygp", "gp offer", "robi", "airtel", "banglalink", "bl", "teletalk", "skitto", "robi-axiata", "my robi", "my airtel", "mybl")
SHOPS = ("daraz", "foodpanda", "pathao", "shohoz", "chaldal", "evaly", "ajkerdeal", "rokomari", "bikroy", "othoba", "pickaboo", "shajgoj", "aarong")
PROMO_WORDS = re.compile(
    r"অফার|ছাড়|ডিসকাউন্ট|বোনাস|ক্যাশব্যাক|ফ্রি|রিচার্জ করুন|রিচার্জে|ইন্টারনেট প্যাক|মিনিট প্যাক|প্যাক কিনুন|ডায়াল করুন|\*\d{3,}#|জিতে নিন|লটারি|পুরস্কার|"
    r"\boffer\b|discount|cashback|\bbonus\b|\bfree\b|recharge|\d+\s?%\s?off|\bsale\b|\bdeal\b|\bpack\b|\bgb\b|\bmb\b|validity|\bwin\b|prize|lottery|click here|buy now|limited time",
    re.I)
MONEY_OR_CODE = re.compile(
    r"bkash|nagad|rocket|upay|\bbank\b|ব্যাংক|বিকাশ|নগদ|রকেট|credited|debited|received|withdrawn|transferred|trxid|txnid|transaction|balance|"
    r"জমা হয়েছে|গ্রহণ করেছেন|পাঠিয়েছেন|লেনদেন|ব্যালেন্স|\botp\b|ওটিপি|verification|যাচাই|পিন|password",
    re.I)
_PHONE = re.compile(r"^\+?[\d\s\-()]{7,20}$")


def _sender(key: str, name: str | None) -> str:
    raw = (name or key.split(":", 1)[-1] or "").strip().lower()
    return raw.split(":")[-1].strip()


def is_promo(channel: str, key: str, name: str | None, body: str | None, cfg: dict[str, Any] | None = None) -> bool:
    """True when this incoming message should go straight to the spam folder."""
    p = (cfg or {}).get("promo") or {}
    if p.get("enabled") is False:
        return False
    ident = key.split(":", 1)[-1].split(":")[-1].strip().lower()  # what the network/app really sent: a number or a sender id
    who = _sender(key, name)
    names = {ident, who}
    text = body or ""
    allow = {str(a).strip().lower() for a in p.get("allow") or [] if str(a).strip()}
    block = {str(b).strip().lower() for b in p.get("block") or [] if str(b).strip()}
    if names & allow:
        return False
    if names & block:
        return True
    if MONEY_OR_CODE.search(text) or MONEY_OR_CODE.search(who):
        return False  # money and codes are never hidden
    if channel not in ("sms", "device", "notif"):
        return False  # the owner's chats on Telegram/e-mail are filtered elsewhere
    named = not _PHONE.match(ident)  # "MyGP", "Daraz": a sender id, not a person's number (a saved contact name does not count)
    known = bool(names & (set(OPERATORS) | set(SHOPS))) or any(n.startswith(o + " ") for n in names for o in OPERATORS)
    if channel in ("sms", "device") and known:
        return True
    return named and bool(PROMO_WORDS.search(text)) and (known or channel in ("sms", "device"))
