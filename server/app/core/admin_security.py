"""Admin sign-in hardening helpers (free-tier friendly: no extra services).

* one-time recovery codes (stored only as keyed hashes)
* TOTP verification that refuses to accept the same 30-second code twice
* the site-wide "2FA required for admins" policy, cached in-process
  (the API runs a single worker, so a short TTL + refresh-on-save is enough)
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Iterable

from app.core.config import settings

POLICY_KEY = "security_require_2fa_admins"

RECOVERY_CODE_COUNT = 10
_RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I/L

LOCK_AFTER_FAILURES = 8
LOCK_MINUTES = 15
MFA_SETUP_TOKEN_MINUTES = 30

# A session that still has to set up 2FA may only reach these endpoints.
MFA_SETUP_ALLOWED_PREFIXES = (
    "/api/v1/auth/2fa/",
    "/api/v1/auth/me",
    "/api/v1/auth/logout",
)

TOTP_STEP_SECONDS = 30


# ---------------------------------------------------------------- recovery codes
def _normalize(code: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (code or "").upper())


def _hash_code(code: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode("utf-8"), _normalize(code).encode("utf-8"), hashlib.sha256).hexdigest()


def looks_like_recovery_code(code: str) -> bool:
    return len(_normalize(code)) == 10 and not re.fullmatch(r"\d{6}", (code or "").strip())


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    """Human-friendly one-time codes like `K7Q2M-9XH4T`."""
    codes = []
    for _ in range(count):
        raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(10))
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def hash_recovery_codes(codes: Iterable[str]) -> str:
    return json.dumps([_hash_code(c) for c in codes])


def recovery_codes_remaining(stored: str | None) -> int:
    try:
        return len(json.loads(stored)) if stored else 0
    except (ValueError, TypeError):
        return 0


def consume_recovery_code(stored: str | None, code: str) -> tuple[bool, str | None]:
    """Return (matched, new_stored). A matched code is removed so it works once."""
    try:
        hashes = json.loads(stored) if stored else []
    except (ValueError, TypeError):
        return False, stored
    candidate = _hash_code(code)
    for h in hashes:
        if hmac.compare_digest(h, candidate):
            hashes.remove(h)
            return True, json.dumps(hashes)
    return False, stored


# ------------------------------------------------------------------------- TOTP
def verify_totp_once(secret: str, code: str, last_step: int | None, now: float | None = None) -> int | None:
    """Return the accepted time-step, or None when the code is wrong or was already used."""
    import pyotp

    code = (code or "").strip()
    if not re.fullmatch(r"\d{6}", code):
        return None
    totp = pyotp.TOTP(secret)
    current = int((now if now is not None else time.time()) // TOTP_STEP_SECONDS)
    for offset in (0, -1, 1):  # tolerate ±30 s clock drift, like valid_window=1
        step = current + offset
        if hmac.compare_digest(totp.at(step * TOTP_STEP_SECONDS), code):
            if last_step is not None and step <= last_step:
                return None  # replay of an already-used code
            return step
    return None


# ----------------------------------------------------------------- lockout rules
def is_locked(locked_until: datetime | None, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    return bool(locked_until and locked_until > now)


def next_failure_state(failed_count: int, now: datetime | None = None) -> tuple[int, datetime | None]:
    """(new_count, locked_until) after one more failed attempt."""
    now = now or datetime.now(timezone.utc)
    count = (failed_count or 0) + 1
    if count >= LOCK_AFTER_FAILURES:
        return 0, now + timedelta(minutes=LOCK_MINUTES)
    return count, None


# -------------------------------------------------------------- 2FA policy cache
_policy = {"required": False, "checked": 0.0}
_POLICY_TTL = 30.0


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in ("true", "1", "yes", "on")


def set_policy_cache(required: bool) -> None:
    _policy["required"] = bool(required)
    _policy["checked"] = time.monotonic()


async def two_factor_required(db) -> bool:
    """Is 2FA mandatory for every admin? Cached for a short time; fails open on DB errors."""
    if time.monotonic() - _policy["checked"] < _POLICY_TTL:
        return _policy["required"]
    try:
        from sqlalchemy import select

        from app.models.models import Setting

        row = (
            await db.execute(select(Setting.value).where(Setting.key == POLICY_KEY, Setting.is_deleted == False))  # noqa: E712
        ).scalar_one_or_none()
        set_policy_cache(_truthy(row))
    except Exception:  # never lock everyone out because of a transient DB error
        _policy["checked"] = time.monotonic()
    return _policy["required"]


def path_allowed_before_2fa(path: str) -> bool:
    return path.startswith(MFA_SETUP_ALLOWED_PREFIXES)
