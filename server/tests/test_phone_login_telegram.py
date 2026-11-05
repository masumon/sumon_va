"""Password-free phone sign-in: the owner approves in his own Telegram bot (2026-11-05)."""
import asyncio
from types import SimpleNamespace

import pytest

from app.assistant.channels import phone_login, telegram
from app.core.config import settings


@pytest.fixture(autouse=True)
def clean():
    phone_login._requests.clear()
    phone_login._history.clear()
    yield


def test_request_has_secret_id_and_matching_short_code():
    r = phone_login.create("V2317", "1.2.3.4")
    assert len(r.request_id) >= 40 and len(r.code) == 4 and r.code.isdigit()
    assert len(f"l:y:{r.short}".encode()) <= 64                    # fits Telegram's callback_data limit
    assert phone_login.get(r.request_id) is r and phone_login.get("nope") is None


def test_only_a_pending_matching_request_can_be_approved_once():
    r = phone_login.create("p", "ip")
    assert phone_login.decide("wrong-short-id", True) is None
    assert phone_login.decide(r.short, True) is r and r.state == "approved"
    assert phone_login.decide(r.short, False) is None             # already decided: cannot be flipped
    assert phone_login.consume(r) is True
    assert phone_login.consume(r) is False                        # the token is handed over exactly once


def test_denied_never_yields_a_token():
    r = phone_login.create("p", "ip")
    phone_login.decide(r.short, False)
    assert r.state == "denied" and phone_login.consume(r) is False


def test_expiry(monkeypatch):
    r = phone_login.create("p", "ip")
    r.created -= phone_login.TTL_SECONDS + 1
    assert phone_login.get(r.request_id) is None
    assert phone_login.decide(r.short, True) is None


def test_flood_is_capped():
    made = [phone_login.create(f"p{i}", "ip") for i in range(phone_login.MAX_PENDING + 3)]
    assert sum(1 for m in made if m) == phone_login.MAX_PENDING


def test_hourly_cap(monkeypatch):
    for _ in range(phone_login.MAX_PER_HOUR):
        r = phone_login.create("p", "ip")
        phone_login._requests.clear()
    assert phone_login.create("p", "ip") is None


def _press(frm_id, data, monkeypatch):
    calls = []

    async def fake_cfg(db, force=False):
        return {}

    async def fake_answer(cid, text=""):
        calls.append(("answer", text))

    async def fake_edit(chat, mid, text, markup=None):
        calls.append(("edit", text))

    monkeypatch.setattr(telegram.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(telegram, "answer_callback", fake_answer)
    monkeypatch.setattr(telegram, "edit_text", fake_edit)
    monkeypatch.setattr(settings, "TELEGRAM_OWNER_ID", "999")
    cb = {"id": "1", "from": {"id": frm_id}, "message": {"chat": {"id": 5}, "message_id": 7, "text": "ask"}, "data": data}
    asyncio.run(telegram.handle_callback(None, cb))
    return calls


def test_stranger_cannot_approve(monkeypatch):
    r = phone_login.create("p", "ip")
    assert _press(123, f"l:y:{r.short}", monkeypatch) == []        # ignored silently
    assert r.state == "pending"


def test_owner_approves_and_denies(monkeypatch):
    r = phone_login.create("p", "ip")
    calls = _press(999, f"l:y:{r.short}", monkeypatch)
    assert r.state == "approved" and any("ঢুকতে দেওয়া" in c[1] for c in calls)
    r2 = phone_login.create("p2", "ip")
    _press(999, f"l:n:{r2.short}", monkeypatch)
    assert r2.state == "denied"


def test_stale_button_is_harmless(monkeypatch):
    calls = _press(999, "l:y:doesnotexist1234", monkeypatch)
    assert any("আর নেই" in c[1] for c in calls)


# ── the two endpoints, called directly (no network, no database) ─────────────────────────────

class FakeDb:
    def __init__(self, users):
        self.users, self.added, self.committed = users, [], 0

    async def execute(self, _stmt):
        users = self.users
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: users))

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.committed += 1


def _endpoints(monkeypatch, sent):
    from app.api.v1.routes import inbox

    async def fake_send(chat_id, text, business_connection_id=None, reply_markup=None):
        sent.append((chat_id, text, reply_markup))

    monkeypatch.setattr(inbox.telegram, "configured", lambda: True)
    monkeypatch.setattr(inbox.telegram, "send_text", fake_send)
    monkeypatch.setattr(inbox, "_client_ip", lambda request: "9.9.9.9")
    monkeypatch.setattr(settings, "TELEGRAM_OWNER_ID", "999")
    return inbox


def test_request_sends_the_code_and_buttons_to_the_owner_only(monkeypatch):
    sent = []
    inbox = _endpoints(monkeypatch, sent)
    out = asyncio.run(inbox.device_login_telegram(inbox.TelegramLoginIn(name="V2317"), SimpleNamespace()))
    assert sent[0][0] == "999" and out["code"] in sent[0][1] and "V2317" in sent[0][1]
    data = [b["callback_data"] for b in sent[0][2]["inline_keyboard"][0]]
    assert data[0].startswith("l:y:") and data[1].startswith("l:n:")
    assert "token" not in out and len(out["request_id"]) >= 40


def test_request_refused_when_the_bot_is_not_set_up(monkeypatch):
    from fastapi import HTTPException
    inbox = _endpoints(monkeypatch, [])
    monkeypatch.setattr(inbox.telegram, "configured", lambda: False)
    with pytest.raises(HTTPException) as e:
        asyncio.run(inbox.device_login_telegram(inbox.TelegramLoginIn(name="x"), SimpleNamespace()))
    assert e.value.status_code == 503


def test_status_gives_the_token_only_after_approval_and_only_once(monkeypatch):
    sent = []
    inbox = _endpoints(monkeypatch, sent)
    owner = SimpleNamespace(id="11111111-1111-1111-1111-111111111111", role="super_admin", name="Sumon", last_login=None)
    db = FakeDb([SimpleNamespace(id="x", role="editor", name="E", last_login=None), owner])
    out = asyncio.run(inbox.device_login_telegram(inbox.TelegramLoginIn(name="V2317"), SimpleNamespace()))
    rid = out["request_id"]
    st = lambda: asyncio.run(inbox.device_login_telegram_status(rid, None, db))   # noqa: E731
    assert st() == {"status": "pending"}
    phone_login.decide(phone_login.get(rid).short, True)
    got = st()
    assert got["status"] == "approved" and len(got["token"]) >= 30 and got["name"] == "Sumon"
    assert owner.last_login is not None and db.committed == 1
    assert st()["status"] == "used"                       # a second poll never mints another token
    dev = next(o for o in db.added if o.__class__.__name__ == "InboxDevice")
    assert str(dev.admin_id) == owner.id and dev.token_hash != got["token"]   # only the hash is stored


def test_status_unknown_or_denied(monkeypatch):
    inbox = _endpoints(monkeypatch, [])
    db = FakeDb([])
    assert asyncio.run(inbox.device_login_telegram_status("x" * 40, None, db)) == {"status": "expired"}
    out = asyncio.run(inbox.device_login_telegram(inbox.TelegramLoginIn(name="p"), SimpleNamespace()))
    phone_login.decide(phone_login.get(out["request_id"]).short, False)
    assert asyncio.run(inbox.device_login_telegram_status(out["request_id"], None, db)) == {"status": "denied"}


# ── "I sent it myself" keeps the chat thread whole ───────────────────────────────────────────

def test_sent_by_hand_records_the_owner_reply_and_steps_the_assistant_back(monkeypatch):
    from datetime import datetime, timezone
    from app.api.v1.routes import wa_assistant as wa

    contact = SimpleNamespace(id="c1", state="assistant", unread=3, hold_until=None, last_message_at=None, last_outbound_at=None)
    draft = SimpleNamespace(status="draft")

    class Db:
        def __init__(self):
            self.added, self.committed = [], 0

        async def execute(self, _s):
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [draft]))

        def add(self, o):
            self.added.append(o)

        async def commit(self):
            self.committed += 1

    async def fake_contact(db, cid):
        return contact

    async def fake_cfg(db, force=False):
        return {"hold_hours": 6}

    async def fake_promise(db, c, text):
        return None

    monkeypatch.setattr(wa, "_get_contact", fake_contact)
    monkeypatch.setattr(wa.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(wa, "_promise_task", fake_promise)
    db = Db()
    asyncio.run(wa.sent_by_hand("c1", wa.TextIn(text="  ঠিক আছে ভাই  "), db, "admin"))
    msg = db.added[0]
    assert msg.body == "ঠিক আছে ভাই" and msg.status == "sent" and msg.reason == "owner" and msg.delivery == "manual"
    assert draft.status == "discarded" and contact.state == "owner" and contact.unread == 0 and contact.hold_until is not None
    assert db.committed == 1
