import asyncio

import pytest

from app.core import scheduler


@pytest.mark.asyncio
async def test_loop_keeps_running_after_a_failed_tick(monkeypatch):
    calls = []

    async def fake_tick():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("boom")

    monkeypatch.setattr(scheduler, "tick", fake_tick)
    task = scheduler.start(interval=0.01)
    await asyncio.sleep(0.15)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(calls) >= 2  # the first tick failed, the loop went on
