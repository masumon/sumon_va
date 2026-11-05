"""A fresh server has the assistant switched off; the owner's Telegram tap that lets the FIRST phone in must still work."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from app.api.v1.routes import inbox
from app.assistant import wa_config as wcfg
from app.assistant.channels import telegram


class FakeRequest:
    def __init__(self, update):
        self.headers = {"x-telegram-bot-api-secret-token": "s"}
        self._raw = json.dumps(update).encode()

    async def body(self):
        return self._raw


def run(update, monkeypatch):
    seen = {"cb": None, "cfg_loaded": False}

    async def fake_cb(db, cb):
        seen["cb"] = cb

    async def fake_load(*a, **k):
        seen["cfg_loaded"] = True
        return {"enabled": False, "channels": {}}

    monkeypatch.setattr(telegram, "configured", lambda: True)
    monkeypatch.setattr(telegram, "verify_secret", lambda v: True)
    monkeypatch.setattr(telegram, "handle_callback", fake_cb)
    monkeypatch.setattr(wcfg, "load_config", fake_load)
    out = asyncio.run(inbox.telegram_webhook(FakeRequest(update), SimpleNamespace(add_task=lambda *a, **k: None), SimpleNamespace()))
    return out, seen


def test_login_button_is_handled_even_when_the_assistant_is_off(monkeypatch):
    out, seen = run({"callback_query": {"id": "1", "data": "l:y:abcd", "from": {"id": 1}}}, monkeypatch)
    assert out == {"ok": True} and seen["cb"]["data"] == "l:y:abcd"


def test_other_buttons_still_wait_for_the_assistant_to_be_on(monkeypatch):
    out, seen = run({"callback_query": {"id": "1", "data": "a:xyz", "from": {"id": 1}}}, monkeypatch)
    assert out == {"ok": True} and seen["cb"] is None and seen["cfg_loaded"]
