"""Phone-number sign-in rules (no network, no database)."""
import asyncio

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1.routes import inbox


def test_normaliser_accepts_common_forms():
    for raw in ("01711223344", "+8801711223344", "8801711223344", "+880 1711-223344", "০১৭১১২২৩৩৪৪", "8801711223344 "):
        assert inbox.normalize_bd_phone(raw) == "8801711223344"


def test_normaliser_rejects_bad_numbers():
    for raw in ("", None, "abc", "0171122334", "017112233445", "01211223344", "admin@x.com", "12345678901234"):
        assert inbox.normalize_bd_phone(raw) is None


def test_masking_hides_the_middle():
    assert inbox.mask_phone("8801711223344") == "01711****44"
    assert inbox.mask_phone("01711223344") == "01711****44"
    assert inbox.mask_phone("junk") == "" and inbox.mask_phone(None) == ""


def test_phone_detection():
    assert inbox.looks_like_phone("01711223344") and inbox.looks_like_phone("+8801711223344")
    assert not inbox.looks_like_phone("a@b.com") and not inbox.looks_like_phone("a1@b.com") and not inbox.looks_like_phone("owner")


def _login(value, stored=""):
    async def fake_get(db, key):
        return stored if key == inbox.PHONE_KEY else ""
    inbox.flow._get_val, orig = fake_get, inbox.flow._get_val
    try:
        return asyncio.run(inbox._owner_by_login(None, value))
    finally:
        inbox.flow._get_val = orig


def test_unknown_or_malformed_phone_is_just_no_user():
    assert _login("01711223344", stored="") is None                  # nothing saved
    assert _login("01811223344", stored="8801711223344") is None     # different number
    assert _login("0171122334455", stored="8801711223344") is None   # malformed
    assert _login("0171122334455x", stored="8801711223344") is None


def test_device_login_with_unknown_phone_answers_like_a_wrong_email(monkeypatch):
    seen = []
    monkeypatch.setattr(inbox, "_is_locked", lambda ip: False)
    monkeypatch.setattr(inbox, "_record_failure", lambda ip: seen.append(ip))

    async def none(db, value):
        return None
    monkeypatch.setattr(inbox, "_owner_by_login", none)
    req = Request({"type": "http", "headers": [], "client": ("1.2.3.4", 1), "method": "POST", "path": "/"})
    for who in ("01711223344", "nobody@example.com"):
        with pytest.raises(HTTPException) as e:
            asyncio.run(inbox.device_login(inbox.PasswordLoginIn(email=who, password="x"), req, None))
        assert e.value.status_code == 400 and e.value.detail == "ইমেইল বা পাসওয়ার্ড ভুল"
    assert len(seen) == 2
