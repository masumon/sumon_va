"""AI Hub: detection, Bangla scoring, free→paid failover, caps, vision routing."""
import asyncio

import httpx
import pytest

from app.assistant import ai_hub as hub


def _conn(cid, provider="groq", tier="free", models=("m1",), vision=False):
    return {"id": cid, "provider": provider, "label": cid, "key": "k" * 20, "base_url": "", "auth": "header",
            "enabled": True, "tier": tier, "status": "ok", "note": "",
            "models": [{"id": m, "vision": vision, "score": 2, "ms": 500} for m in models]}


@pytest.fixture
def state(monkeypatch):
    async def no_load(db, force=False):
        return None

    async def no_flush(force=False):
        return None

    monkeypatch.setattr(hub, "_load", no_load)
    monkeypatch.setattr(hub, "_flush_stats", no_flush)
    hub._rest.clear()
    hub._state.update(conns=[], prefs=dict(hub.DEFAULT_PREFS), stats=hub._fresh_stats())
    return hub._state


def _err(code):
    req = httpx.Request("POST", "https://x")
    return httpx.HTTPStatusError("e", request=req, response=httpx.Response(code, request=req, json={"error": {"message": "x"}}))


def test_detect_new_prefixes():
    assert hub.detect("nvapi-abc") == "nvidia"
    assert hub.detect("vck_abc") == "vercel"
    assert hub.detect("AIzaSyX") == "gemini"
    assert hub.detect("gsk_abc") == "groq"


def test_bangla_score():
    assert hub._score('{"text": "বাংলাদেশের রাজধানী ঢাকা।"}') == 3
    assert hub._score('{"text": "The capital is Dhaka."}') == 2
    assert hub._score("garbage") == 1


def test_failover_free_then_paid(state, monkeypatch):
    state["conns"] = [_conn("free1"), _conn("paid1", provider="openai", tier="paid")]
    calls = []

    async def fake_call(conn, model, *a, **k):
        calls.append(conn["id"])
        if conn["id"] == "free1":
            raise _err(429)
        return "ঠিক আছে"

    monkeypatch.setattr(hub, "_call", fake_call)
    meta = {}
    out = asyncio.run(hub.run(None, "chat", "s", "u", meta=meta))
    assert out == "ঠিক আছে" and calls == ["free1", "paid1"] and meta["label"] == "paid1"
    assert hub._rest["free1"] > 0  # rate-limited connection rests


def test_paid_cap_blocks_paid(state, monkeypatch):
    state["conns"] = [_conn("paid1", provider="openai", tier="paid")]
    state["prefs"]["paid_daily_cap"] = 0

    async def fake_call(*a, **k):
        return "x"

    monkeypatch.setattr(hub, "_call", fake_call)
    with pytest.raises(hub.HubError):
        asyncio.run(hub.run(None, "chat", "s", "u"))


def test_vision_only_uses_vision_models(state, monkeypatch):
    state["conns"] = [_conn("text1"), _conn("gem", provider="gemini", vision=True)]
    used = []

    async def fake_call(conn, model, *a, **k):
        used.append(conn["id"])
        return '{"ok": true}'

    monkeypatch.setattr(hub, "_call", fake_call)
    asyncio.run(hub.run(None, "vision", "s", "u", images=[("image/png", b"x")], json_mode=True))
    assert used == ["gem"]


def test_bad_key_rests_connection(state, monkeypatch):
    state["conns"] = [_conn("a"), _conn("b")]

    async def fake_call(conn, model, *a, **k):
        if conn["id"] == "a":
            raise _err(401)
        return "ok"

    monkeypatch.setattr(hub, "_call", fake_call)
    assert asyncio.run(hub.run(None, "json", "s", "u")) == "ok"
    assert state["conns"][0]["status"] == "bad"


def test_cron_token_stable():
    assert hub.cron_token() == hub.cron_token() and len(hub.cron_token()) == 32
