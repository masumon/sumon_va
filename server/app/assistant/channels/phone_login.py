"""Sign the owner's phone in without a password: the phone asks, the owner approves with one tap in his own Telegram bot.

Why this is safe:
* Only the owner's Telegram account (TELEGRAM_OWNER_ID) can approve; the bot checks that before this module is even called.
* The phone shows a 4-digit code and the bot message shows the same code, so a request somebody else started cannot be approved
  by mistake. A request lives 2 minutes and works once.
* The phone polls with a long random request id that only it knows; the token is handed over exactly once.
* Requests are rate limited per address and in total, so nobody can flood the owner's Telegram.

State is kept in memory on purpose: a request lives two minutes and the free server runs as a single instance. If the server
restarts in that window the owner simply taps the button again.
"""
from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field

TTL_SECONDS = 120
MAX_PENDING = 5            # at most this many open requests at once
MAX_PER_HOUR = 12          # and this many in any hour, across everybody
_requests: dict[str, "LoginRequest"] = {}
_history: list[float] = []


@dataclass
class LoginRequest:
    request_id: str                    # secret, only the phone has it
    code: str                          # 4 digits shown on the phone AND in the bot message
    name: str                          # the phone's name, shown to the owner
    ip: str
    created: float = field(default_factory=time.monotonic)
    state: str = "pending"             # pending | approved | denied | used

    @property
    def short(self) -> str:            # what goes into the Telegram button (callback data is limited to 64 bytes)
        return self.request_id[:16]

    def expired(self) -> bool:
        return time.monotonic() - self.created > TTL_SECONDS


def _sweep() -> None:
    now = time.monotonic()
    for k in [k for k, r in _requests.items() if now - r.created > TTL_SECONDS * 3]:
        _requests.pop(k, None)
    while _history and now - _history[0] > 3600:
        _history.pop(0)


def create(name: str, ip: str) -> LoginRequest | None:
    """A new request, or None when too many are open / were made recently."""
    _sweep()
    if sum(1 for r in _requests.values() if r.state == "pending" and not r.expired()) >= MAX_PENDING or len(_history) >= MAX_PER_HOUR:
        return None
    req = LoginRequest(request_id=secrets.token_urlsafe(32), code=f"{secrets.randbelow(10000):04d}", name=(name or "ফোন").strip()[:60], ip=ip[:45])
    _requests[req.request_id] = req
    _history.append(time.monotonic())
    return req


def get(request_id: str) -> LoginRequest | None:
    r = _requests.get(request_id or "")
    return r if r and not r.expired() else None


def decide(short: str, approve: bool) -> LoginRequest | None:
    """The owner pressed a button. Returns the request that was decided, or None (unknown / expired / already decided)."""
    for r in _requests.values():
        if secrets.compare_digest(r.short, short or "") and r.state == "pending" and not r.expired():
            r.state = "approved" if approve else "denied"
            return r
    return None


def consume(req: LoginRequest) -> bool:
    """Take the approval once; a second poll can never mint a second token."""
    if req.state != "approved":
        return False
    req.state = "used"
    return True
