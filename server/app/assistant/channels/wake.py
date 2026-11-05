"""Instant hand-off from "something arrived" to "tell the phone": a long-poll waits here instead of sleeping and asking again.

One process (the free Render instance) serves everyone, so an in-memory set of waiting events is enough. A waiting request
holds no database connection (it releases it first), so a phone waiting 25 seconds costs the connection pool nothing.
"""
from __future__ import annotations

import asyncio

_waiting: set[asyncio.Event] = set()


def notify() -> None:
    """Wake every waiting phone. Call after the database change is committed."""
    for ev in list(_waiting):
        ev.set()


async def wait(timeout: float) -> bool:
    """True when woken by notify(), False when the time ran out."""
    ev = asyncio.Event()
    _waiting.add(ev)
    try:
        await asyncio.wait_for(ev.wait(), timeout)
        return True
    except asyncio.TimeoutError:
        return False
    finally:
        _waiting.discard(ev)
