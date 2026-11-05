"""Coexistence extras: imported old chats are stored but never answered; edits/deletes/warnings (no network, no database)."""
import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.assistant import wa_coexist as cx
from app.assistant import wa_flow as flow
from app.assistant import wa_send

BIZ = "8801825007977"
NOW = datetime.now(timezone.utc)


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return self.rows

    def scalar_one_or_none(self):
        return self.rows[0] if self.rows else None


class FakeDB:
    def __init__(self, *results):
        self.results, self.added = list(results), []

    async def execute(self, _stmt):
        return _Res(self.results.pop(0) if self.results else [])

    def add(self, obj):
        self.added.append(obj)


@pytest.fixture
def store(monkeypatch):
    kv: dict[str, str] = {}

    async def get(_db, key):
        return kv.get(key, "")

    async def put(_db, key, value):
        kv[key] = value

    async def upsert(_db, phone, name):
        return SimpleNamespace(id=uuid.uuid4(), phone=phone, last_message_at=None, unread=0, name=name)

    monkeypatch.setattr(flow, "_get_val", get)
    monkeypatch.setattr(flow, "_set_val", put)
    monkeypatch.setattr(flow, "upsert_contact", upsert)
    return kv


def text_of(m):
    return "text", (m.get("text") or {}).get("body", ""), ""


def ts(days_ago=1):
    return str(int((NOW - timedelta(days=days_ago)).timestamp()))


def hist(threads, **meta):
    return {"metadata": {"display_phone_number": "+880 1825-007977"}, "history": [{"metadata": {"phase": 1, "chunk_order": 1, **meta}, "threads": threads}]}


def run(coro):
    return asyncio.run(coro)


def test_history_is_stored_as_imported_and_never_marks_unread(store):
    val = hist([{"id": "8801700000001", "messages": [
        {"id": "w1", "from": "8801700000001", "timestamp": ts(2), "type": "text", "text": {"body": "ভাই কাজের কী খবর"}},
        {"id": "w2", "from": BIZ, "timestamp": ts(2), "type": "text", "text": {"body": "কালকে পাবেন"}},
        {"id": "w3", "from": "8801700000001", "timestamp": ts(3), "type": "media_placeholder"},
    ]}], progress=55)
    db = FakeDB([])
    n = run(cx.history(db, {"retention_days": 90}, val, text_of))
    assert n == 3
    rows = {m.wa_id: m for m in db.added}
    assert all(m.status == cx.IMPORTED and m.meta["imported"] for m in rows.values())
    assert rows["w1"].direction == "in" and rows["w1"].reason is None
    assert rows["w2"].direction == "out" and rows["w2"].reason == "owner"  # the owner's own words, never "assistant"
    assert "ছবি" in rows["w3"].body
    assert json.loads(store[cx.STATE_KEY])["count"] == 3 and json.loads(store[cx.STATE_KEY])["progress"] == 55


def test_history_skips_known_and_too_old_messages(store):
    val = hist([{"id": "8801700000002", "messages": [
        {"id": "known", "from": "8801700000002", "timestamp": ts(1), "type": "text", "text": {"body": "a"}},
        {"id": "ancient", "from": "8801700000002", "timestamp": ts(170), "type": "text", "text": {"body": "b"}},
        {"id": "fresh", "from": "8801700000002", "timestamp": ts(1), "type": "text", "text": {"body": "c"}},
    ]}])
    db = FakeDB(["known"])
    assert run(cx.history(db, {"retention_days": 90}, val, text_of)) == 1
    assert [m.wa_id for m in db.added] == ["fresh"]  # "ancient" would be purged by the daily clean-up at once


def test_history_declined_is_remembered(store):
    val = {"history": [{"errors": [{"code": 2593109, "title": "History sync is turned off"}]}]}
    assert run(cx.history(FakeDB(), {}, val, text_of)) == 0
    assert json.loads(store[cx.STATE_KEY])["declined"] is True


def test_edit_and_revoke_change_the_stored_message_not_add_one(store):
    row = SimpleNamespace(body="পুরনো", transcript="x", meta={})
    edit = {"type": "edit", "edit": {"original_message_id": "w1", "message": {"type": "text", "text": {"body": "নতুন লেখা"}}}}
    assert run(cx.edit_or_revoke(FakeDB([row]), edit, text_of)) is True
    assert row.body == "নতুন লেখা" and row.meta["edited"] is True
    assert run(cx.edit_or_revoke(FakeDB([row]), {"type": "revoke", "revoke": {"original_message_id": "w1"}}, text_of)) is True
    assert row.body == cx.DELETED_TEXT and row.transcript is None and row.meta["revoked"] is True
    assert run(cx.edit_or_revoke(FakeDB(), {"type": "text"}, text_of)) is False  # a normal message is not ours to handle


def test_edit_of_unknown_message_is_ignored_quietly(store):
    assert run(cx.edit_or_revoke(FakeDB([]), {"type": "revoke", "revoke": {"original_message_id": "nope"}}, text_of)) is True


def test_unsupported_alerts_instead_of_storing(store, monkeypatch):
    seen = []

    async def fake_alert(_db, key, title, body, **kw):
        seen.append((key, title))

    monkeypatch.setattr(cx, "alert", fake_alert)
    assert run(cx.unsupported(FakeDB(), {"type": "unsupported", "from": "8801711112222"})) is True
    assert seen and seen[0][0] == "unsup-2222"
    assert run(cx.unsupported(FakeDB(), {"type": "text"})) is False


def test_connection_lost_and_back(store, monkeypatch):
    seen = []

    async def fake_alert(_db, key, title, body, **kw):
        seen.append((key, body))

    monkeypatch.setattr(cx, "alert", fake_alert)
    lost = {"event": "PARTNER_REMOVED", "disconnection_info": {"reason": "PRIMARY_INACTIVITY", "initiated_by": "SYSTEM"}}
    assert run(cx.account_update(FakeDB(), lost)) is True
    assert "১৪ দিন" in store[cx.LOST_KEY] and seen[0][0] == "lost"
    assert run(cx.account_update(FakeDB(), {"event": "ACCOUNT_RECONNECTED"})) is True
    assert store[cx.LOST_KEY] == ""
    assert run(cx.account_update(FakeDB(), {"event": "SOMETHING_ELSE"})) is False


def test_contact_names_fill_only_empty_ones(store):
    a, b = SimpleNamespace(phone="8801700000001", name=None), SimpleNamespace(phone="8801700000002", name="আগের নাম")
    val = {"state_sync": [
        {"type": "contact", "action": "add", "contact": {"full_name": "রহিম ভাই", "phone_number": "01700000001"}},
        {"type": "contact", "action": "add", "contact": {"full_name": "করিম", "phone_number": "01700000002"}},
        {"type": "contact", "action": "remove", "contact": {"phone_number": "01700000003"}},
    ]}
    assert run(cx.contacts_sync(FakeDB([a, b]), val)) == 1
    assert a.name == "রহিম ভাই" and b.name == "আগের নাম"


def test_graph_default_and_rate_limit_reason():
    assert wa_send._ver({}) == "v26.0" and wa_send._ver({"graph_version": "25.0"}) == "v25.0"
    assert "131056" in wa_send.send_reason({"code": 131056, "message": "pair rate limit"})
