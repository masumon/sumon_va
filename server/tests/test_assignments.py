"""Tasks others give the owner + task status questions (Brain_Prompt 10; acceptance tests 24-28) and the full _process path (SQLite)."""
import copy
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1.routes import wa_assistant
from app.assistant import assignments as asg
from app.assistant import wa_config as wc
from app.assistant import wa_flow
from app.assistant.channels import alerts
from app.models.models import ActivityLog, Setting
from app.models.wa import InboxCommand, InboxDevice, WaContact, WaMessage, WaNote, WaTask

NOW = datetime(2026, 11, 6, 10, 0, tzinfo=timezone.utc)


# -- detection -------------------------------------------------------------------

def test_a_clear_request_with_a_day_becomes_a_high_confidence_candidate_with_a_deadline():
    c = asg.detect("ভাই লোগোটা কাল পাঠিয়ে দিন", NOW)
    assert c and c[0]["confidence"] == "high" and c[0]["due_at"] is not None and "লোগো" in c[0]["title_body"]


def test_a_vague_request_gets_no_invented_deadline():
    c = asg.detect("রিপোর্টটা করে দিন", NOW)
    assert c and c[0]["confidence"] == "medium" and c[0]["due_at"] is None


def test_english_requests_are_detected_and_chitchat_is_not():
    assert asg.detect("Please send the invoice by Friday", NOW)[0]["confidence"] == "high"
    assert asg.detect("কেমন আছেন ভাই", NOW) == [] and asg.detect("ধন্যবাদ, ভালো থাকবেন", NOW) == []
    assert asg.detect("ঠিক আছে", NOW) == []


def test_negated_and_question_form_requests_do_not_create_candidates():
    assert asg.detect("এটা করবেন না", NOW) == []
    only = [c for c in asg.detect("Can you send it?", NOW) if c["confidence"] in ("high", "medium")]
    assert only == []


def test_at_most_two_candidates_per_message():
    assert len(asg.detect("ছবি পাঠান। ফাইল পাঠান। রিপোর্ট করে দিন।", NOW)) == 2


def test_proposal_title_names_the_person_but_a_private_one_stores_no_words():
    c = SimpleNamespace(name="রহিম", phone="sms:+88017")
    assert asg.proposal_title(c, "লোগো পাঠান", False).startswith("রহিম: কাজ:")
    assert asg.proposal_title(c, "আম্মার অপারেশন", True) == asg.PRIVATE_TITLE


# -- status questions -------------------------------------------------------------

def test_status_questions_are_recognised_in_bangla_and_english():
    for q in ("ভাই আমার কাজের কী হলো?", "কাজটা কতদূর?", "any update on this?", "what happened to my work"):
        assert asg.asks_status(q), q
    assert not asg.asks_status("ধন্যবাদ ভাই")


def tk(title="লোগো", due=None, done=False, source="confirmed", done_at=None):
    return {"title": title, "due_at": due, "is_done": done, "source": source, "done_at": done_at}


def test_status_never_invents_progress_completion_or_a_date():
    s = dict(asg.task_status([tk()], NOW))
    assert "open" in s and "অগ্রগতির কোনো তথ্য নেই" in s["open"] and "সময় ঠিক করা নেই" in s["open"]
    late = dict(asg.task_status([tk(due=NOW - timedelta(days=1))], NOW))
    assert "delayed" in late and "পেরিয়েছে" in late["delayed"]
    assert "proposed" in dict(asg.task_status([tk(source="proposed")], NOW))


def test_completion_needs_the_owners_confirmation_flag_and_unknown_is_reported_as_unknown():
    assert "completed" in dict(asg.task_status([tk(done=True, done_at=NOW)], NOW))
    assert "অজানা" in asg.status_note([], NOW, False)
    assert "লোগো" not in asg.status_note([tk()], NOW, True)  # a private contact's task words stay out


# -- full path through _process (SQLite, no network, no AI) --------------------------

@pytest_asyncio.fixture
async def Session():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        for model in (Setting, ActivityLog, WaContact, WaMessage, WaNote, WaTask, InboxDevice, InboxCommand):
            await conn.run_sync(model.__table__.create)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
def alerts_sent(monkeypatch):
    sent = []

    async def fake_cfg(db, force=False, scope=None):
        c = copy.deepcopy(wc.DEFAULT_CONFIG)
        c.update(enabled=True, ai={"enabled": False, "voice": False})
        return c

    async def fake_presence(db, cfg):
        return cfg

    async def fake_push(db, cfg, contact, d, label=None):
        sent.append({"who": contact.name, "p": d.priority, "summary": d.summary, "note": d.note})
        return True

    monkeypatch.setattr(wa_flow.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(wa_flow.presence, "apply", fake_presence)
    monkeypatch.setattr(alerts, "push_owner", fake_push)
    return sent


async def inbound(s, c, body, mins_ago, call=False, **meta):
    m = WaMessage(contact_id=c.id, direction="in", channel="sms", kind="text", body=body, status="received",
                  created_at=datetime.now(timezone.utc) - timedelta(minutes=mins_ago), meta={"call": True, **meta} if call else meta or None)
    s.add(m)
    await s.commit()
    return m


async def person(s, name="রহিম", phone="sms:+8801711000010", **kw):
    c = WaContact(phone=phone, channel="sms", name=name, category="business", priority=5, mode="inherit", state="assistant",
                  is_vip=False, is_family=False, is_blocked=False, unread=0, **kw)
    s.add(c)
    await s.flush()
    return c


@pytest.mark.asyncio
async def test_an_incoming_request_becomes_a_proposed_task_and_never_a_confirmed_one(Session, alerts_sent):
    async with Session() as s:
        c = await person(s)
        m = await inbound(s, c, "ভাই লোগোটা কাল পাঠিয়ে দিন", 1)
        await wa_flow._process(s, m.id)
        tasks = (await s.execute(select(WaTask).where(WaTask.contact_id == c.id))).scalars().all()
        assert [t.source for t in tasks] == ["proposed"] and tasks[0].due_at is not None and tasks[0].title.startswith("রহিম: কাজ:")
        await wa_flow._process(s, m.id)  # processing the same message again must not duplicate the task
        assert len((await s.execute(select(WaTask).where(WaTask.contact_id == c.id))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_confirming_turns_it_into_an_obligation_and_a_manual_task_is_untouched(Session, alerts_sent):
    async with Session() as s:
        c = await person(s)
        m = await inbound(s, c, "রিপোর্টটা করে দিন", 1)
        await wa_flow._process(s, m.id)
        t = (await s.execute(select(WaTask).where(WaTask.contact_id == c.id))).scalars().one()
        r = await wa_assistant.confirm_task(t.id, s, "owner")
        assert r.data["source"] == "confirmed"
        manual = WaTask(title="নিজের কাজ", source="manual")
        s.add(manual)
        await s.commit()
        again = await wa_assistant.confirm_task(manual.id, s, "owner")
        assert manual.source == "manual" and "আগেই" in again.message


@pytest.mark.asyncio
async def test_a_status_question_tells_the_owner_what_is_on_record_and_promises_nothing(Session, alerts_sent):
    async with Session() as s:
        c = await person(s)
        s.add(WaTask(contact_id=c.id, title="রহিম: লোগো", source="confirmed", due_at=datetime.now(timezone.utc) - timedelta(days=1)))
        m = await inbound(s, c, "ভাই আমার কাজের কী হলো?", 1)
        await s.commit()
        await wa_flow._process(s, m.id)
        assert alerts_sent and "কাজের খবর চাইছেন" in alerts_sent[0]["note"] and "অগ্রগতির কোনো তথ্য নেই" in alerts_sent[0]["note"]
        drafts = (await s.execute(select(WaMessage).where(WaMessage.direction == "out"))).scalars().all()
        assert all(not any(w in (d.body or "") for w in ("শেষ হয়েছে", "কাল দিয়ে", "হয়ে গেছে")) for d in drafts)


@pytest.mark.asyncio
async def test_a_family_request_stores_no_words(Session, alerts_sent):
    async with Session() as s:
        c = await person(s, name="আম্মা", phone="sms:+8801711000011", )
        c.is_family = True
        m = await inbound(s, c, "আম্মার অপারেশনের টাকা পাঠান", 1)
        await wa_flow._process(s, m.id)
        titles = [t.title for t in (await s.execute(select(WaTask).where(WaTask.contact_id == c.id))).scalars().all()]
        assert titles and all("অপারেশন" not in t for t in titles)


@pytest.mark.asyncio
async def test_missed_call_end_to_end_one_alert_per_burst_and_no_reply_draft(Session, alerts_sent):
    async with Session() as s:
        c = await person(s, phone="sms:+8801711000012")
        s.add(WaTask(contact_id=c.id, title="রহিম: কাজ", source="confirmed"))
        await s.commit()
        calls = [await inbound(s, c, "[মিসড কল]", mins, call=True) for mins in (6, 3, 0.5)]
        for m in calls:
            await wa_flow._process(s, m.id)
        assert len(alerts_sent) == 1 and "মিসড কল" in alerts_sent[0]["summary"] and alerts_sent[0]["p"] == 3
        assert (await s.execute(select(WaMessage).where(WaMessage.direction == "out"))).scalars().all() == []
        assert (await s.get(WaMessage, calls[0].id)).meta.get("call_alert")
