"""The website's WhatsApp and the phone app keep separate assistant settings (2026-11-04, owner's rule)."""
import asyncio
import json
from types import SimpleNamespace

from app.assistant import wa_config as wcfg


class FakeDb:
    async def commit(self):
        pass


def _store(monkeypatch, initial):
    rows = {k: SimpleNamespace(value=json.dumps(v)) for k, v in initial.items()}

    async def _row(db, key):
        return rows.get(key)

    async def _put(db, key, value, secret):
        rows[key] = SimpleNamespace(value=value)

    monkeypatch.setattr(wcfg, "_row", _row)
    monkeypatch.setattr(wcfg, "_put", _put)
    wcfg.invalidate()
    return rows


def test_app_starts_as_a_copy_then_lives_apart(monkeypatch):
    rows = _store(monkeypatch, {"wa_config": {"enabled": True, "mode": "auto"}})
    db = FakeDb()

    async def go():
        app = await wcfg.load_config(db, scope="app")
        assert app["mode"] == "auto"                      # copied from today's settings: nothing changes at the switch-over
        await wcfg.save_config(db, {"mode": "shadow"}, scope="app")
        assert (await wcfg.load_config(db, force=True, scope="web"))["mode"] == "auto"   # the website is untouched
        await wcfg.save_config(db, {"enabled": False}, scope="web")
        assert (await wcfg.load_config(db, force=True, scope="app"))["enabled"] is True   # and the app is untouched
    asyncio.run(go())
    assert json.loads(rows["va_app_config"].value)["mode"] == "shadow"


def test_scope_follows_the_request_and_the_channel(monkeypatch):
    _store(monkeypatch, {"wa_config": {"mode": "auto"}, "va_app_config": {"mode": "shadow"}})
    db = FakeDb()

    async def go():
        wcfg.use_scope("app")
        assert (await wcfg.load_config(db))["mode"] == "shadow"
        wcfg.use_scope("web")
        assert (await wcfg.load_config(db))["mode"] == "auto"
    asyncio.run(go())
    assert wcfg.scope_for_channel("whatsapp") == "web"
    for ch in ("notif", "sms", "telegram", "email", None and "x"):
        assert wcfg.scope_for_channel(ch) in ("app", "web")
    assert wcfg.scope_for_channel("notif") == "app" and wcfg.scope_for_channel("telegram") == "app"


def test_fastapi_dependency_scope_reaches_the_endpoint():
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    api = FastAPI()

    async def phone():
        wcfg.use_scope("app")
        return True

    @api.get("/x")
    async def x(_=Depends(phone)):
        return {"scope": wcfg.current_scope()}

    @api.get("/y")
    async def y():
        return {"scope": wcfg.current_scope()}

    c = TestClient(api)
    assert c.get("/x").json()["scope"] == "app"
    assert c.get("/y").json()["scope"] == "web"   # never leaks into the next request


def test_app_conversation_never_rings_the_website_bell(monkeypatch):
    from app.assistant import wa_flow as flow
    bell, pushed = [], []

    async def fake_bell(db, **kw):
        bell.append(kw)

    async def fake_push(db, cfg, contact, d):
        pushed.append(contact.channel)
        return True

    monkeypatch.setattr(flow, "create_notification", fake_bell)
    monkeypatch.setattr(flow.alerts, "push_owner", fake_push)
    d = SimpleNamespace(notify=True, priority=1, summary="x")
    cfg = {"notify": {"urgent": True}}

    async def go():
        for ch in ("notif", "telegram", "sms"):
            assert await flow._notify(None, cfg, SimpleNamespace(id="1", name="A", phone="p", channel=ch), d, [])
        assert await flow._notify(None, cfg, SimpleNamespace(id="2", name="B", phone="q", channel="whatsapp"), d, [])
    asyncio.run(go())
    assert len(bell) == 1 and bell[0]["type"] == "wa_message"   # only the website's own WhatsApp reached the bell
    assert pushed == ["notif", "telegram", "sms", "whatsapp"]


# ── platforms the owner adds himself with the "add" button ──────────────────────────────────

def test_custom_platform_is_repaired_and_cannot_hijack_a_built_in_one():
    from app.assistant.channels import platforms as pl
    good = {"key": "my_chat", "name": "My Chat", "packages": ["com.example.chat"]}
    bad = [{"key": "whatsapp", "name": "x", "packages": ["com.example.a"]},          # clashes with a built-in platform
           {"key": "Bad Key!", "name": "x", "packages": ["com.example.a"]},          # not a safe key
           {"key": "nopkg", "name": "x", "packages": ["not a package"]},             # not a package name
           {"key": "noname", "name": "", "packages": ["com.example.a"]}, "junk", None]
    assert pl.normalize_custom([good, *bad]) == [good]
    assert pl.normalize_custom("x") == [] and len(pl.normalize_custom([{**good, "key": f"k{i}"} for i in range(99)])) == pl.MAX_CUSTOM


def test_chat_from_an_added_app_gets_its_own_platform_and_settings():
    from app.assistant import wa_flow as flow
    from app.assistant.channels import platforms as pl
    custom = [{"key": "my_chat", "name": "My Chat", "packages": ["com.example.chat"]}]
    c = SimpleNamespace(channel="notif", phone="notif:com.example.chat:Rahim", category="business", is_vip=False, tags=None, mode="inherit")
    assert pl.platform_key(c) == "other"                           # unknown to the built-in list
    assert pl.platform_key(c, custom) == "my_chat"
    cfg = {"mode": "auto", "custom_platforms": custom, "categories": {"business": {"auto": True}},
           "platforms": {"my_chat": {"enabled": True, "phone_auto": True}}}
    assert flow.effective_mode(cfg, c) == "auto"                   # its OWN switch decides, like every other platform
    cfg["platforms"]["my_chat"]["phone_auto"] = False
    assert flow.effective_mode(cfg, c) == "draft"


def test_saving_custom_platform_settings_keeps_them(monkeypatch):
    rows = _store(monkeypatch, {"wa_config": {"mode": "auto"}})
    db = FakeDb()

    async def go():
        await wcfg.save_config(db, {"custom_platforms": [{"key": "my_chat", "name": "My Chat", "packages": ["com.example.chat"]}],
                                    "platforms": {"my_chat": {"phone_auto": True, "junk": 1}, "not_added": {"enabled": False}}}, scope="app")
        cfg = await wcfg.load_config(db, force=True, scope="app")
        assert cfg["platforms"]["my_chat"]["phone_auto"] is True and "junk" not in cfg["platforms"]["my_chat"]
        assert "not_added" not in cfg["platforms"]                  # settings for a platform that does not exist are dropped
        assert cfg["custom_platforms"][0]["key"] == "my_chat"
    asyncio.run(go())
