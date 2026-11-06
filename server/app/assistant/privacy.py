"""Privacy rules for family and personal messages.

1. Their words never go to an AI service (wa_brain.decide skips the AI reading when `is_private`).
2. Their text is stored encrypted ("enc1:..."), readable only through the owner's own API calls (`unseal`).
3. They are deleted sooner than business messages (`retention_for`, used by the daily cleanup).

Business and social chats stay readable in the database so the admin can search and answer them.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.totp_crypto import decrypt_totp_secret, encrypt_totp_secret

logger = logging.getLogger(__name__)
PREFIX = "enc1:"
UNREADABLE = "(এই লেখা পড়া যায়নি)"


def is_private(contact: Any, category: str | None = None) -> bool:
    """Family is always private; so is anyone sorted as personal."""
    return bool(getattr(contact, "is_family", False)) or (category or getattr(contact, "category", None)) == "personal"


def seal(text: str | None) -> str | None:
    if not text or text.startswith(PREFIX):
        return text
    return PREFIX + encrypt_totp_secret(text)


def unseal(text: str | None) -> str | None:
    if not text or not text.startswith(PREFIX):
        return text
    token = text[len(PREFIX):]
    try:
        out = decrypt_totp_secret(token)
        return UNREADABLE if out == token else out  # the helper hands back its input when it cannot decrypt: never show that as if it were the message
    except Exception:  # noqa: BLE001 - a key change must never break the inbox, only hide that one line
        logger.warning("could not decrypt a stored message")
        return UNREADABLE


async def seal_contact_messages(db: AsyncSession, contact_id: Any) -> int:
    """Encrypt everything already stored for a person who has just become family/personal. Returns how many messages changed."""
    from app.models.wa import WaMessage

    rows = (await db.execute(select(WaMessage).where(WaMessage.contact_id == contact_id))).scalars().all()
    changed = 0
    for m in rows:
        body, transcript = seal(m.body), seal(m.transcript)
        if body != m.body or transcript != m.transcript:
            m.body, m.transcript = body, transcript
            changed += 1
    return changed


def retention_days(cfg: dict[str, Any], category: str | None, family: bool) -> int:
    """How long messages of this kind are kept (days). Family is its own setting; categories fall back to the general one."""
    general = int(cfg.get("retention_days", 90))
    if family:
        return max(1, int(cfg.get("retention_family_days", 30)))
    by = cfg.get("retention_by_category") or {}
    return max(1, int(by.get(category or "", general)))


# ── one-time codes (OTP / PIN / password) ───────────────────────────────────────

_SECRET_WORDS = re.compile(r"otp|one[\s-]*time|verification|verify|passcode|password|passwd|\bpin\b|security\s*code|confirmation\s*code|auth(?:entication)?\s*code|"
                           r"\bcode\b|ওটিপি|কোড|পিন|পাসওয়ার্ড|পাসকোড|যাচাই", re.I)
_BN_TO_EN = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
_CODE = re.compile(r"(?<![\d.,])(?:\d{3}[-\s]\d{3}|\d{4,8})(?![\d.,]?\d)")
_MONEY_BEFORE = re.compile(r"(?:৳|tk\.?|bdt|rs\.?|usd|\$|taka|টাকা)\s*$", re.I)
_MONEY_AFTER = re.compile(r"^\s*(?:tk\.?|bdt|taka|টাকা|৳|usd)", re.I)
MASK = "••••••"


def mask_secrets(text: str | None) -> tuple[str, bool]:
    """Hide one-time codes in a message that talks about OTP/verification/PIN/password. Returns (text, changed).

    Only runs of 4-8 digits (or 123-456) are hidden, and only when such a word is in the same message; amounts of money are left alone.
    The phone may keep the original, but the server never stores, shows, alerts or sends a code to an AI."""
    if not text or not _SECRET_WORDS.search(text):
        return text or "", False
    changed = False
    out, last = [], 0
    for m in _CODE.finditer(text.translate(_BN_TO_EN)):
        a, b = m.span()
        if _MONEY_BEFORE.search(text[:a]) or _MONEY_AFTER.search(text[b:b + 12]):
            continue
        out.append(text[last:a])
        out.append(MASK)
        last = b
        changed = True
    out.append(text[last:])
    return "".join(out), changed


# ── masking before text leaves for an AI provider (free tiers may use the input to train) ───────────────────
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE = re.compile(r"(?<![\w])(?:\+?৮৮|\+?88)?[0০][1১][3-9৩-৯][\d০-৯][\s-]?[\d০-৯]{3}[\s-]?[\d০-৯]{4}(?![\w])|(?<![\w])\+?\d{1,3}[\s-]?\d{6,12}(?![\w])")
_LONG_NUM = re.compile(r"(?<![\w])[\d০-৯]{9,}(?![\w])")
PLACEHOLDER_NOTE = "Personal identifiers (phone numbers, e-mails, long numbers) are replaced by placeholders like [PHONE_1]; keep them exactly as written."


def pseudonymize(text: str | None) -> tuple[str, dict[str, str]]:
    """Replace phone numbers, e-mail addresses and long numbers by placeholders. Returns (masked text, {placeholder: original})."""
    if not text:
        return text or "", {}
    mapping: dict[str, str] = {}
    counts = {"EMAIL": 0, "PHONE": 0, "NUM": 0}

    def sub(kind: str):
        def inner(m: "re.Match[str]") -> str:
            orig = m.group(0)
            for k, v in mapping.items():
                if v == orig and k.startswith(f"[{kind}_"):
                    return k
            counts[kind] += 1
            key = f"[{kind}_{counts[kind]}]"
            mapping[key] = orig
            return key
        return inner

    out = _EMAIL.sub(sub("EMAIL"), text)
    out = _PHONE.sub(sub("PHONE"), out)
    out = _LONG_NUM.sub(sub("NUM"), out)
    return out, mapping


def restore(text: str | None, mapping: dict[str, str]) -> str:
    """Put the original values back into an AI answer."""
    out = text or ""
    for key, orig in mapping.items():
        out = out.replace(key, orig)
    return out
