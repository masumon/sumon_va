"""Rule-based facts a person tells us about themselves ("আমার জন্মদিন ১২ মার্চ", "আমি মিরপুরে থাকি").

No AI and no network: fixed patterns, so it is cheap and predictable. Everything found is stored by the caller as an INFERRED fact
(`memory.add(..., provenance="ai", confidence="low")`): shown to the owner as "অনুমান" until he confirms it. Private and family chats are
never read by this module (the caller skips them). A miss is fine; a wrong fact is not, so every pattern is narrow.
"""
from __future__ import annotations

import re

_MONTH = r"(?:জানুয়ারি|ফেব্রুয়ারি|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্টেম্বর|অক্টোবর|নভেম্বর|ডিসেম্বর|january|february|march|april|may|june|july|august|september|october|november|december)"
_NUM = r"[০-৯0-9]{1,2}"
_ROLE = r"(?:ম্যানেজার|ডাক্তার|ইঞ্জিনিয়ার|শিক্ষক|ব্যবসায়ী|মালিক|ডিরেক্টর|এজেন্ট|সেলস|ঠিকাদার|manager|owner|doctor|engineer|director|teacher|agent|contractor)"

_BIRTHDAY = re.compile(rf"(?:জন্মদিন|birthday)[^\d০-৯\n]{{0,14}}({_NUM}\s*{_MONTH}|{_MONTH}\s*{_NUM})", re.I)
_ROLE_BN = re.compile(rf"আমি\s+(?:একজন\s+)?(\S{{2,25}}\s+)?({_ROLE})(?:\s|$|।|,)", re.I)
_ROLE_EN = re.compile(rf"\bI(?:'m| am)\s+(?:a|an|the)\s+({_ROLE})\b(?:\s+(?:of|at)\s+([A-Z][\w&.\- ]{{1,30}}))?", re.I)
_NOCALL = re.compile(r"(সকালে|দুপুরে|বিকালে|বিকেলে|সন্ধ্যায়|রাতে)\s*(?:আমাকে\s*)?(?:ফোন|কল)\s*(?:দিবেন না|দিয়েন না|করবেন না|ধরি না|ধরতে পারি না|ধরতে পারব না)")
_LIVES = re.compile(r"আমি\s+(\S{2,20}?)(?:তে|য়|ে)\s+থাকি")
_NICK = re.compile(r"আমাকে\s+(\S{2,20})\s+(?:বলে\s+)?(?:ডাকবেন|ডাকো|ডাকুন|বলে ডাকবেন)")


def extract(text: str | None) -> list[str]:
    """Plain-Bangla fact lines found in one incoming message (usually none)."""
    t = (text or "").strip()
    if not t or len(t) > 1500:
        return []
    out: list[str] = []
    if m := _BIRTHDAY.search(t):
        out.append(f"জন্মদিন: {m.group(1).strip()} (নিজে বলেছেন)")
    if m := _ROLE_EN.search(t):
        org = f", {m.group(2).strip()}" if m.group(2) else ""
        out.append(f"পরিচয়: {m.group(1).lower()}{org} (নিজে বলেছেন)")
    elif m := _ROLE_BN.search(t):
        org = f"{m.group(1).strip()} " if m.group(1) and not m.group(1).strip() in ("একজন", "খুব") else ""
        out.append(f"পরিচয়: {org}{m.group(2)} (নিজে বলেছেন)")
    if m := _NOCALL.search(t):
        out.append(f"{m.group(1)} ফোন ধরতে পারেন না বা পছন্দ করেন না (নিজে বলেছেন)")
    if m := _LIVES.search(t):
        out.append(f"থাকেন: {m.group(1)} (নিজে বলেছেন)")
    if m := _NICK.search(t):
        out.append(f"ডাকনাম: {m.group(1)} (নিজে বলেছেন)")
    return out[:4]
