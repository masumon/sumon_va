"""In-process once-a-minute job (replaces cron-job.org on this server).

The phone long-polls this server all day, so the process is always awake. Each tick runs the same work the old
`/wa/cron` URL did: delayed replies, stuck-message sweep, expired "busy" status, daily clean-up. A failure is logged and
the loop continues; nothing here can stop the API from starting.
"""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)
INTERVAL_S = 60


async def tick() -> None:
    from app.assistant import wa_flow as flow
    from app.core.database import AsyncSessionLocal
    from app.core.service_health import mark_cron

    async with AsyncSessionLocal() as db:
        try:
            await mark_cron(db, "wa")
        except Exception:  # noqa: BLE001 — bookkeeping must never block the work
            await db.rollback()
        await flow.run_cron(db)


async def _loop(interval: float) -> None:
    await asyncio.sleep(interval)  # let the server finish starting first
    while True:
        try:
            await tick()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("scheduled tick failed")
        await asyncio.sleep(interval)


def start(interval: float = INTERVAL_S) -> "asyncio.Task[None]":
    return asyncio.create_task(_loop(interval), name="va-scheduler")
