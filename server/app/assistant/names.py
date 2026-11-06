"""Name matching that survives spelling and script: "Rahim", "Rohim", "রহিম", "রহীম ভাই" all give the same key.

Pure functions, no dependency. The key is only a way to SUGGEST that two rows may be one person; linking still needs the owner
(identity.relate marks a name match "medium", never automatic). Common given names (রহিম, করিম, আব্দুল) will collide: that is why the
owner confirms, and why a different phone number always keeps two rows apart.
"""
from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

# respectful words around a name: they say nothing about WHO the person is
HONORIFICS = {
    "ভাই", "ভাইয়া", "ভাইজান", "আপু", "আপা", "আপি", "ভাবী", "ভাবি", "সাহেব", "সাব", "স্যার", "ম্যাডাম", "ম্যাম", "চাচা", "চাচি", "চাচী",
    "মামা", "মামী", "খালা", "খালু", "ফুফু", "ফুফা", "দাদা", "দাদী", "নানা", "নানী", "জনাব", "মিস্টার", "মিঃ", "মোঃ", "মো", "মোহাম্মদ", "মুহাম্মদ", "মোহাম্মাদ", "মুহাম্মাদ",
    "bhai", "bhaiya", "vai", "vaiya", "apu", "apa", "bhabi", "vabi", "sir", "madam", "mam", "uncle", "chacha", "mama", "khala", "mr", "mrs", "ms", "md", "mohammad", "muhammad", "mohammed", "mohd",
}

GENERIC = {"unknown", "অজানা", "অজানা নম্বর", "unknown number", "no name", "whatsapp", "sms", "me", "আমি"}  # placeholders, not names

_CONS = {
    "ক": "k", "খ": "k", "গ": "g", "ঘ": "g", "ঙ": "ng", "চ": "c", "ছ": "c", "জ": "j", "ঝ": "j", "ঞ": "n", "ট": "t", "ঠ": "t", "ড": "d", "ঢ": "d",
    "ণ": "n", "ত": "t", "থ": "t", "দ": "d", "ধ": "d", "ন": "n", "প": "p", "ফ": "f", "ব": "b", "ভ": "b", "ম": "m", "য": "j", "র": "r", "ল": "l",
    "শ": "s", "ষ": "s", "স": "s", "হ": "h", "ড়": "r", "ঢ়": "r", "য়": "y", "ৎ": "t", "ং": "ng", "ঃ": "h", "ঁ": "",
}
_VOW = {"অ": "a", "আ": "a", "ই": "i", "ঈ": "i", "উ": "u", "ঊ": "u", "ঋ": "ri", "এ": "a", "ঐ": "oi", "ও": "a", "ঔ": "ou"}
_SIGN = {"া": "a", "ি": "i", "ী": "i", "ু": "u", "ূ": "u", "ৃ": "ri", "ে": "a", "ৈ": "oi", "ো": "a", "ৌ": "ou"}
_HASANTA = "্"
_BN = re.compile(r"[ঀ-৿]")


def _bangla_to_latin(word: str) -> str:
    """Rough sound-alike: every consonant carries the inherent vowel 'a' unless a vowel sign, a hasanta (conjunct) or the word end follows."""
    word = unicodedata.normalize("NFC", word).replace("ড়", "ড়").replace("য়", "য়")
    out: list[str] = []
    i, n = 0, len(word)
    while i < n:
        ch = word[i]
        if ch in _VOW:
            out.append(_VOW[ch])
        elif ch in _CONS:
            out.append(_CONS[ch])
            nxt = word[i + 1] if i + 1 < n else ""
            if nxt in _SIGN or nxt == _HASANTA or nxt == "" or nxt in ("ং", "ঃ", "ঁ"):
                pass  # no inherent vowel
            elif nxt in _CONS or nxt in _VOW:
                out.append("a")
            else:
                out.append("a")
        elif ch in _SIGN:
            out.append(_SIGN[ch])
        # hasanta and unknown marks add nothing
        i += 1
    return "".join(out)


def _collapse(latin: str) -> str:
    s = re.sub(r"[^a-z]", "", latin.lower())
    s = s.replace("ph", "f").replace("sh", "s").replace("kh", "k").replace("gh", "g").replace("th", "t").replace("dh", "d").replace("bh", "b")
    s = s.replace("ee", "i").replace("oo", "u").replace("ou", "u").replace("oi", "i").replace("w", "u").replace("v", "b").replace("z", "j").replace("q", "k").replace("x", "ks").replace("y", "i")
    s = s.replace("ch", "C").replace("c", "k").replace("C", "c")
    s = re.sub(r"[aeo]", "a", s)
    s = re.sub(r"(.)\1+", r"\1", s)
    return s


def name_key(name: str | None) -> str | None:
    """Comparable key for a person's name, or None when nothing usable is left (numbers, emoji, only honorifics)."""
    raw = "".join(" " if unicodedata.category(ch)[0] in "PSC" else ch for ch in (name or "").casefold())
    if " ".join(raw.split()) in GENERIC:
        return None
    parts = []
    for w in raw.split():
        if w.strip(".") in HONORIFICS:
            continue
        parts.append(_collapse(_bangla_to_latin(w)) if _BN.search(w) else _collapse(w))
    key = "".join(p for p in parts if p)
    return key if len(key) >= 3 and not key.isdigit() else None


def similar(a: str | None, b: str | None, threshold: float = 0.9) -> bool:
    """Same key, or almost the same (one slip). Used only for a SUGGESTION."""
    ka, kb = name_key(a), name_key(b)
    if not ka or not kb:
        return False
    return ka == kb or (min(len(ka), len(kb)) >= 5 and SequenceMatcher(None, ka, kb).ratio() >= threshold)


def alias_keys(profile: dict | None) -> set[str]:
    """Keys of the owner-written alternative names (`profile.aliases`): the most reliable signal of all."""
    out = set()
    for a in (profile or {}).get("aliases") or []:
        k = name_key(str(a))
        if k:
            out.add(k)
    return out
