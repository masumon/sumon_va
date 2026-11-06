"""Reply verification, grouping, unanswered reminders (Brain_Prompt 9.3-9.4, 11; acceptance tests 13-23)."""
import copy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.assistant import thread_state as ts
from app.assistant import wa_config as wc
from app.assistant import wa_flow
from app.assistant.channels import alerts
from app.models.models import ActivityLog, Setting
from app.models.wa import InboxCommand, InboxDevice, WaContact, WaMessage, WaTask

T0 = datetime(2026, 11, 6, 10, 0, tzinfo=timezone.utc)


def m(mins, body, d="in", status="received", reason=None, meta=None):
    return {"id": f"{d}{mins}", "direction": d, "body": body, "status": status, "reason": reason,
            "created_at": T0 + timedelta(minutes=mins), "meta": meta or {}}


def newest_first(*msgs):
    return sorted(msgs, key=lambda x: x["created_at"], reverse=True)


def cfg(**over):
    c = copy.deepcopy(wc.DEFAULT_CONFIG)
    c.update(over)
    return c


def person(**o):
    return SimpleNamespace(**{"is_blocked": False, "state": "assistant", "category": "business", "priority": 4, "is_vip": False,
                              "is_family": False, "tags": None, **o})


# -- reply verification --------------------------------------------------------

def test_no_answer_found_is_reported_as_none_not_as_read():
    st = ts.assess(newest_first(m(0, "ভাই কাজটা কবে?")))
    assert st.status == "none" and st.unanswered == 1 and "পড়া" not in st.label


def test_an_assistant_reply_alone_does_not_count_as_the_owners_answer():
    st = ts.assess(newest_first(m(0, "কবে?"), m(1, "আমি সহকারী", "out", "sent", "ask1")))
    assert st.status == "assistant_only" and st.status in ts.NEEDS_ANSWER


def test_a_draft_or_failed_message_is_not_an_answer():
    st = ts.assess(newest_first(m(0, "কবে?"), m(1, "x", "out", "draft", "owner"), m(2, "y", "out", "failed", "owner")))
    assert st.status == "none"


def test_an_adequate_owner_reply_is_recognised():
    st = ts.assess(newest_first(m(0, "কাজটা হয়েছে?"), m(2, "হ্যাঁ, কাল সকালে পাঠাচ্ছি", "out", "sent", "owner")))
    assert st.status == "adequate" and st.owner_replied and st.unanswered == 0


def test_a_short_reply_to_two_questions_is_partial():
    st = ts.assess(newest_first(m(0, "কবে পাব? দাম কত?"), m(1, "কাল", "out", "sent", "owner")))
    assert st.status == "partial" and st.questions >= 2


def test_a_tiny_reply_to_a_question_is_uncertain_and_asks_for_verification():
    st = ts.assess(newest_first(m(0, "আসছেন?"), m(1, "ok", "out", "sent", "owner")))
    assert st.status == "uncertain"


def test_a_new_message_after_the_owners_reply_is_a_new_event():
    st = ts.assess(newest_first(m(0, "কবে?"), m(1, "কাল দিচ্ছি", "out", "sent", "manual"), m(5, "আজ হলে ভালো হতো?")))
    assert st.status == "new_inbound" and st.unanswered == 1


def test_missed_calls_are_not_messages_to_answer():
    call = m(3, "[মিসড কল]", meta={"call": True})
    assert ts.assess(newest_first(call)).unanswered == 0
    assert ts.assess(newest_first(m(0, "hi"), call)).unanswered == 1


# -- grouping ------------------------------------------------------------------

def test_four_messages_within_five_minutes_become_one_text_in_order():
    recent = newest_first(m(0, "ভাই"), m(1, "একটা কাজ ছিল"), m(2, "ছবিটা পাঠান"))
    text, n = ts.grouped_text(recent, "জরুরি না, আজকের মধ্যে", T0 + timedelta(minutes=3), 5)
    assert n == 4 and text.splitlines() == ["ভাই", "একটা কাজ ছিল", "ছবিটা পাঠান", "জরুরি না, আজকের মধ্যে"]


def test_grouping_stops_at_the_last_real_answer_and_ignores_old_group_or_call_messages():
    recent = newest_first(m(-60, "পুরোনো"), m(0, "আগের প্রশ্ন"), m(1, "উত্তর", "out", "sent", "owner"), m(2, "নতুন ১"),
                          m(3, "গ্রুপ", meta={"group": True}), m(4, "[মিসড কল]", meta={"call": True}))
    text, n = ts.grouped_text(recent, "নতুন ২", T0 + timedelta(minutes=5), 5)
    assert text.splitlines() == ["নতুন ১", "নতুন ২"] and n == 2


def test_grouping_off_returns_the_single_message_and_the_window_is_clamped():
    assert ts.grouped_text(newest_first(m(0, "a")), "b", T0, 0) == ("b", 1)
    assert ts.settings_grouping({"grouping": {"window_min": 999}}) == 30 and ts.settings_grouping({}) == 5


# -- reminders -----------------------------------------------------------------

def due(msgs, minutes, now_min, who=None, already=False):
    conf = cfg(reminders={"unanswered_min": minutes, "only_important": True})
    return ts.reminder_reason(conf, who or person(), ts.assess(msgs), T0 + timedelta(minutes=now_min), already)


def test_reminders_are_off_by_default_and_never_say_read():
    assert wc.DEFAULT_CONFIG["reminders"]["unanswered_min"] == 0
    assert due(newest_first(m(0, "কবে?")), 0, 30) == ""
    r = due(newest_first(m(0, "কবে?")), 15, 30)
    assert "উত্তর বাকি" in r and "প্রমাণ নেই" in r and "পড়া হয়েছে কি না অ্যাপ জানে না" in r


def test_too_early_too_old_already_sent_or_owner_active_means_no_reminder():
    msgs = newest_first(m(0, "কবে?"))
    assert due(msgs, 15, 10) == "" and due(msgs, 15, 25 * 60) == "" and due(msgs, 15, 30, already=True) == ""
    assert due(msgs, 15, 30, who=person(state="owner")) == "" and due(msgs, 15, 30, who=person(is_blocked=True)) == ""


def test_an_owner_answer_cancels_the_reminder_and_a_stranger_is_not_important():
    assert due(newest_first(m(0, "কবে?"), m(5, "কাল দিচ্ছি ভাই", "out", "sent", "owner")), 15, 30) == ""
    assert due(newest_first(m(0, "hi")), 15, 30, who=person(category="personal", priority=5)) == ""


def test_partial_and_uncertain_answers_get_their_own_reminders():
    assert "আংশিক" in due(newest_first(m(0, "কবে? কত?"), m(1, "কাল", "out", "sent", "owner")), 15, 30)
    assert "যাচাই" in due(newest_first(m(0, "আসছেন?"), m(1, "ok", "out", "sent", "owner")), 15, 30)


# -- database path: cron reminder end to end (SQLite, no network) --------------

@pytest_asyncio.fixture
async def Session():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        for model in (Setting, ActivityLog, WaContact, WaMessage, WaTask, InboxDevice, InboxCommand):
            await conn.run_sync(model.__table__.create)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def seed(s, owner_reply=False, phone="sms:+8801711000001"):
    now = datetime.now(timezone.utc)
    c = WaContact(phone=phone, channel="sms", name="রহিম", category="business", priority=4, mode="inherit", state="assistant",
                  is_vip=False, is_family=False, is_blocked=False, unread=1, last_inbound_at=now - timedelta(minutes=40))
    s.add(c)
    await s.flush()
    inc = WaMessage(contact_id=c.id, direction="in", channel="sms", kind="text", body="কাজটা কবে হবে?", status="received", created_at=now - timedelta(minutes=40))
    s.add(inc)
    if owner_reply:
        s.add(WaMessage(contact_id=c.id, direction="out", channel="sms", kind="text", body="কাল দিচ্ছি", status="sent", reason="owner", created_at=now - timedelta(minutes=20)))
    await s.commit()
    return c, inc


async def run_reminders(s, monkeypatch, on=True):
    sent = []

    async def fake_cfg(db, force=False, scope=None):
        return {**cfg(), "enabled": on, "reminders": {"unanswered_min": 15, "only_important": True}}

    async def fake_push(db, conf, contact, d, label=None):
        sent.append((contact.name, d.summary, label))
        return True

    monkeypatch.setattr(wa_flow.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(alerts, "push_owner", fake_push)
    n = await wa_flow.send_unanswered_reminders(s, datetime.now(timezone.utc))
    return n, sent


@pytest.mark.asyncio
async def test_cron_reminds_once_for_an_unanswered_message_and_marks_it(Session, monkeypatch):
    async with Session() as s:
        _, inc = await seed(s)
        n, sent = await run_reminders(s, monkeypatch)
        assert n == 1 and sent[0][0] == "রহিম" and sent[0][2] == "উত্তর বাকি" and "প্রমাণ নেই" in sent[0][1]
        assert (await s.get(WaMessage, inc.id)).meta.get("unanswered_reminded") is True
        n2, _ = await run_reminders(s, monkeypatch)
        assert n2 == 0  # once per waiting message


@pytest.mark.asyncio
async def test_cron_sends_nothing_when_the_owner_answered_or_the_assistant_is_off(Session, monkeypatch):
    async with Session() as s:
        await seed(s, owner_reply=True)
        assert (await run_reminders(s, monkeypatch))[0] == 0
    async with Session() as s:
        await seed(s, phone="sms:+8801711000002")
        assert (await run_reminders(s, monkeypatch, on=False))[0] == 0


# -- grouping gate (database path) ---------------------------------------------

async def gate(Session, monkeypatch, bodies):
    """Insert inbound messages one minute apart; return the gate result for each, as the background tasks would see it."""
    async def fake_cfg(db, force=False, scope=None):
        return {**cfg(), "enabled": True}

    async def no_sleep(_):
        return None

    monkeypatch.setattr(wa_flow, "AsyncSessionLocal", Session)
    monkeypatch.setattr(wa_flow.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(wa_flow.asyncio, "sleep", no_sleep)
    now = datetime.now(timezone.utc) - timedelta(minutes=30)
    async with Session() as s:
        c = WaContact(phone="sms:+8801711000009", channel="sms", name="করিম", category="business", priority=5, mode="inherit", state="assistant",
                      is_vip=False, is_family=False, is_blocked=False, unread=0)
        s.add(c)
        await s.flush()
        ids = []
        for i, b in enumerate(bodies):
            msg = WaMessage(contact_id=c.id, direction="in", channel="sms", kind="text", body=b, status="received", created_at=now + timedelta(minutes=i))
            s.add(msg)
            await s.flush()
            ids.append(msg.id)
        await s.commit()
    return [await wa_flow._group_gate(i) for i in ids]


@pytest.mark.asyncio
async def test_only_the_last_message_of_a_burst_carries_on(Session, monkeypatch):
    assert await gate(Session, monkeypatch, ["ভাই", "একটা কাজ", "ছবিটা পাঠান"]) == [False, False, True]


@pytest.mark.asyncio
async def test_an_urgent_message_never_waits_for_the_window(Session, monkeypatch):
    assert await gate(Session, monkeypatch, ["ভাই", "জরুরি, হাসপাতালে", "আচ্ছা"]) == [False, True, True]
