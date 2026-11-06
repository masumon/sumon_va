"""Facts about a person with provenance, confidence and a correction history (Brain_Prompt section 8). No new table:
they live in `wa_contacts.profile["facts"]` (the existing JSON; other keys of `profile` are never touched).

Rules enforced here (pure functions, no database):
  * an AI guess is never stored as confirmed: provenance "ai" is capped at confidence "medium" and shows as an inference;
  * an owner-given fact is never overwritten by an AI/imported one (a similar AI fact is simply skipped);
  * repeated facts are deduplicated (same normalised text);
  * a correction keeps the old text in the history, marks it "corrected" and writes the new one as the owner's fact;
  * the owner can remove a fact completely (privacy: the text is gone, only the removal is logged without the words);
  * every fact keeps its source (message id / "owner" / import), when it was captured, and when it was last verified.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

MAX_FACTS = 100
PROVENANCE = ("owner", "ai", "imported", "platform")
CONFIDENCE = ("high", "medium", "low")
STATUS_LIVE = ("active", "disputed")


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (text or "").casefold())).strip()


def facts_of(profile: dict[str, Any] | None) -> list[dict[str, Any]]:
    f = (profile or {}).get("facts")
    return [x for x in f if isinstance(x, dict)] if isinstance(f, list) else []


def _with(profile: dict[str, Any] | None, facts: list[dict[str, Any]]) -> dict[str, Any]:
    return {**(profile or {}), "facts": facts[:MAX_FACTS]}  # a NEW dict: SQLAlchemy only saves a JSON column that was reassigned


def add(profile: dict[str, Any] | None, text: str, provenance: str, source: str, confidence: str = "high",
        now: datetime | None = None, by: str = "owner") -> tuple[dict[str, Any], dict[str, Any] | None, str]:
    """(new_profile, fact or None, why). `why` is "" when stored, else the plain reason it was skipped."""
    now = now or datetime.now(timezone.utc)
    text = (text or "").strip()[:300]
    if len(text) < 3:
        return profile or {}, None, "খুব ছোট"
    if provenance not in PROVENANCE:
        provenance = "ai"
    if confidence not in CONFIDENCE:
        confidence = "low"
    if provenance == "ai" and confidence == "high":
        confidence = "medium"  # an AI inference is never "high"
    facts = facts_of(profile)
    key = _norm(text)
    for f in facts:
        if f.get("status") in STATUS_LIVE and _norm(f.get("text", "")) == key:
            if provenance != "owner" or f.get("provenance") == "owner":
                return profile or {}, None, "একই তথ্য আগেই আছে"
            f.update(provenance="owner", confidence="high", last_verified=now.isoformat(timespec="seconds"),
                     history=[*f.get("history", []), {"at": now.isoformat(timespec="seconds"), "by": by, "action": "confirmed_by_owner"}])
            return _with(profile, facts), f, ""  # the owner confirmed an inferred fact: now it is his
    if provenance != "owner" and len(facts) >= MAX_FACTS:
        return profile or {}, None, "তথ্যের সীমা পূর্ণ"
    fact = {"id": uuid.uuid4().hex[:12], "text": text, "source": (source or "")[:80], "confidence": confidence, "provenance": provenance,
            "status": "active", "at": now.isoformat(timespec="seconds"), "last_verified": now.isoformat(timespec="seconds") if provenance == "owner" else None,
            "history": []}
    return _with(profile, [fact, *facts]), fact, ""


def correct(profile: dict[str, Any] | None, fid: str, text: str, now: datetime | None = None, by: str = "owner") -> tuple[dict[str, Any], dict[str, Any] | None]:
    """The owner fixes a fact. The old words stay in the history; the new text is the owner's own, high-confidence fact."""
    now = now or datetime.now(timezone.utc)
    text = (text or "").strip()[:300]
    facts = facts_of(profile)
    old = next((f for f in facts if f.get("id") == fid and f.get("status") in STATUS_LIVE), None)
    if not old or len(text) < 3:
        return profile or {}, None
    stamp = now.isoformat(timespec="seconds")
    new = {"id": uuid.uuid4().hex[:12], "text": text, "source": "owner", "confidence": "high", "provenance": "owner", "status": "active", "at": stamp,
           "last_verified": stamp, "history": [{"at": stamp, "by": by, "action": "corrected", "was": old.get("text", ""), "was_id": old.get("id")}]}
    old["status"] = "corrected"
    old["history"] = [*old.get("history", []), {"at": stamp, "by": by, "action": "superseded_by", "id": new["id"]}]
    return _with(profile, [new, *facts]), new


def remove(profile: dict[str, Any] | None, fid: str) -> tuple[dict[str, Any], bool]:
    """Delete one fact for good (its words and its history). The caller may log the removal WITHOUT the words."""
    facts = facts_of(profile)
    kept = [f for f in facts if f.get("id") != fid and f.get("superseded_id") != fid]
    # a fact that only exists as the "was" of a correction disappears with its corrected successor's history entry
    kept = [{**f, "history": [h for h in f.get("history", []) if h.get("was_id") != fid]} for f in kept]
    return _with(profile, kept), len(kept) != len(facts)


def view(profile: dict[str, Any] | None, unseal=lambda t: t) -> list[dict[str, Any]]:
    """What the app shows: live facts first (owner's before inferred), corrected ones last, inferred ones marked."""
    out = []
    for f in facts_of(profile):
        out.append({"id": f.get("id"), "text": unseal(f.get("text", "")), "source": f.get("source", ""), "confidence": f.get("confidence", "low"),
                    "provenance": f.get("provenance", "ai"), "status": f.get("status", "active"), "at": f.get("at", ""),
                    "inferred": f.get("provenance") in ("ai", "imported") and f.get("provenance") != "owner"})
    order = {"active": 0, "disputed": 1, "superseded": 2, "corrected": 3}
    return sorted(out, key=lambda x: (order.get(x["status"], 4), x["provenance"] != "owner"))
