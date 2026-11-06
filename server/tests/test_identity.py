"""One human, many identifiers (Brain_Prompt 7, acceptance tests 1-6) + the database path on SQLite, with and without manual_sql/0002."""
import copy
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1.routes import wa_assistant
from app.assistant import identity as idn
from app.assistant import wa_config as wc
from app.assistant import wa_flow
from app.assistant.channels import alerts
from app.models.models import ActivityLog, Setting
from app.models.wa import InboxCommand, InboxDevice, WaContact, WaMessage, WaNote, WaTask


def c(phone, name=None, channel="sms"):
    return SimpleNamespace(id=uuid.uuid4(), phone=phone, name=name, channel=channel)


# -- pure rules ------------------------------------------------------------------------

def test_the_same_number_in_different_formats_is_one_human_with_high_confidence():
    a, b = c("sms:+8801711000000"), c("8801711000000", channel="whatsapp")
    assert idn.relate(a, b).level == "high"
    assert idn.relate(c("sms:01711000000"), b).level == "high"  # local format, same number


def test_one_human_can_hold_several_identifiers_numbers_names_and_usernames():
    assert idn.number_of("notif:com.whatsapp:Rahim") is None and idn.number_of("tg:12345") is None and idn.number_of("mail:a@b.com") is None
    assert idn.number_of("sms:+88 01711-000000") == "8801711000000"


def test_two_contacts_with_the_same_display_name_are_never_auto_merged():
    a, b = c("sms:+8801711000000", "Rahim"), c("sms:+8801811000000", "Rahim")
    assert idn.relate(a, b).level == "none"  # different numbers: conflicting identifiers stay separate
    n = c("notif:com.whatsapp:Rahim", "Rahim", "notif")
    assert idn.relate(a, n).level == "medium"  # name only: a suggestion, never a link by itself


def test_a_medium_match_is_only_suggested_and_a_weak_name_never_is():
    a, b = c("sms:+8801711000000", "Rahim Uddin"), c("notif:com.whatsapp:Rahim Uddin", "Rahim Uddin", "notif")
    sug = idn.suggestions([a, b], set(), {})
    assert len(sug) == 1 and sug[0]["level"] == "medium" and "নিশ্চিত" in sug[0]["reasons"][0]
    assert idn.relate(c("sms:+8801711000000", "Al"), c("notif:x", "Al", "notif")).level == "none"  # too short
    assert idn.relate(c("sms:+8801711000000", "অজানা"), c("notif:x", "অজানা", "notif")).level == "none"  # generic


def test_a_group_conversation_is_never_treated_as_a_person():
    a, b = c("sms:+8801711000000", "Team"), c("notif:com.whatsapp:Team", "Team", "notif")
    assert idn.relate(a, b, b_group=True).level == "none"
    assert idn.suggestions([a, b], {b.id}, {}) == []


# -- database path -----------------------------------------------------------------------

@pytest_asyncio.fixture
async def Session():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        for model in (Setting, ActivityLog, WaContact, WaMessage, WaNote, WaTask, InboxDevice, InboxCommand):
            await conn.run_sync(model.__table__.create)
        await conn.execute(text("ALTER TABLE wa_contacts ADD COLUMN person_id CHAR(32)"))  # = manual_sql/0002 already run
    yield async_sessionmaker(engine, expire_on_commit=False), engine
    await engine.dispose()


async def add(s, phone, name=None, channel="sms"):
    ct = WaContact(phone=phone, channel=channel, name=name, category="business", priority=5, mode="inherit", state="assistant",
                   is_vip=False, is_family=False, is_blocked=False, unread=0)
    s.add(ct)
    await s.flush()
    return ct


async def person_of(s, ct):
    return (await s.execute(select(idn._T.c.person_id).where(idn._T.c.id == ct.id))).scalar_one()


@pytest.mark.asyncio
async def test_same_number_on_two_channels_links_automatically_and_is_logged(Session):
    Sess, _ = Session
    async with Sess() as s:
        a, b = await add(s, "sms:+8801711000000", "Rahim"), await add(s, "8801711000000", None, "whatsapp")
        await s.commit()
        assert await idn.auto_link(s, b) is True
        pa, pb = await person_of(s, a), await person_of(s, b)
        assert pa and pa == pb
        assert await idn.auto_link(s, b) is False  # already one person: nothing more happens
        log = await wa_flow._get_val(s, idn.LOG_KEY)
        assert "auto" in log and "একই নম্বর" in log


@pytest.mark.asyncio
async def test_same_name_different_number_never_links_automatically(Session):
    Sess, _ = Session
    async with Sess() as s:
        a, b = await add(s, "sms:+8801711000000", "Rahim"), await add(s, "sms:+8801811000000", "Rahim")
        await s.commit()
        assert await idn.auto_link(s, b) is False and await person_of(s, a) is None and await person_of(s, b) is None


@pytest.mark.asyncio
async def test_a_confirmed_link_can_be_reversed_without_losing_any_source_record(Session):
    Sess, _ = Session
    async with Sess() as s:
        a, n = await add(s, "sms:+8801711000000", "Rahim Uddin"), await add(s, "notif:com.whatsapp:Rahim Uddin", "Rahim Uddin", "notif")
        s.add(WaMessage(contact_id=a.id, direction="in", channel="sms", kind="text", body="hi", status="received"))
        s.add(WaMessage(contact_id=n.id, direction="in", channel="notif", kind="text", body="hello", status="received"))
        s.add(WaTask(contact_id=n.id, title="কাজ", source="confirmed"))
        await s.commit()
        r = await wa_assistant.identity_link(wa_assistant.LinkIn(contact_ids=[a.id, n.id]), s, "owner")
        assert r.data["person_id"] and set(await idn.person_contact_ids(s, a)) == {a.id, n.id}
        assert (await wa_assistant.identity_unlink(n.id, s, "owner")).data["unlinked"] is True
        assert await idn.person_contact_ids(s, a) == [a.id] and await person_of(s, a) is None  # a person left alone dissolves
        assert len((await s.execute(select(WaMessage))).scalars().all()) == 2 and len((await s.execute(select(WaTask))).scalars().all()) == 1
        assert "unlink" in await wa_flow._get_val(s, idn.LOG_KEY)


@pytest.mark.asyncio
async def test_the_owner_cannot_link_different_numbers_or_a_group(Session):
    Sess, _ = Session
    async with Sess() as s:
        a, b = await add(s, "sms:+8801711000000", "Rahim"), await add(s, "sms:+8801811000000", "Rahim")
        g = await add(s, "notif:com.whatsapp:Team", "Team", "notif")
        s.add(WaMessage(contact_id=g.id, direction="in", channel="notif", kind="text", body="x", status="received", meta={"group": True}))
        await s.commit()
        for ids, code in (([a.id, b.id], 422), ([a.id, g.id], 422)):
            with pytest.raises(HTTPException) as e:
                await wa_assistant.identity_link(wa_assistant.LinkIn(contact_ids=ids), s, "owner")
            assert e.value.status_code == code


@pytest.mark.asyncio
async def test_suggestions_list_only_the_name_matches_not_yet_linked(Session):
    Sess, _ = Session
    async with Sess() as s:
        a, n = await add(s, "sms:+8801711000000", "Karim Hossain"), await add(s, "notif:com.whatsapp:Karim Hossain", "Karim Hossain", "notif")
        await s.commit()
        got = (await wa_assistant.identity_suggestions(s, "owner")).data
        assert len(got) == 1 and got[0]["level"] == "medium"
        await wa_assistant.identity_link(wa_assistant.LinkIn(contact_ids=[a.id, n.id]), s, "owner")
        assert (await wa_assistant.identity_suggestions(s, "owner")).data == []


@pytest.mark.asyncio
async def test_before_the_sql_is_run_everything_keeps_working_and_the_routes_say_why(Session):
    Sess, engine = Session
    async with engine.begin() as conn:
        await conn.execute(text("DROP INDEX IF EXISTS ix_wa_contacts_person_id"))
        await conn.execute(text("ALTER TABLE wa_contacts DROP COLUMN person_id"))  # the live database before manual_sql/0002
    async with Sess() as s:
        a = await add(s, "sms:+8801711000000", "Rahim")  # normal inserts and selects must not mention the missing column
        await s.commit()
        assert (await s.execute(select(WaContact).where(WaContact.id == a.id))).scalar_one().name == "Rahim"
        assert await idn.column_ready(s) is False
        assert await idn.auto_link(s, a) is False
        assert await idn.person_contact_ids(s, a) == [a.id]
        with pytest.raises(HTTPException) as e:
            await wa_assistant.identity_suggestions(s, "owner")
        assert e.value.status_code == 409 and "0002" in e.value.detail


# -- the benefit: a missed call is explained with the WHOLE person's history -----------------------------

@pytest.mark.asyncio
async def test_a_missed_call_sees_the_same_persons_whatsapp_message_and_task(Session, monkeypatch):
    Sess, _ = Session
    sent = []

    async def fake_cfg(db, force=False, scope=None):
        k = copy.deepcopy(wc.DEFAULT_CONFIG)
        k.update(enabled=True, ai={"enabled": False, "voice": False})
        return k

    async def fake_presence(db, cfg):
        return cfg

    async def fake_push(db, cfg, contact, d, label=None):
        sent.append(d.summary + " | " + d.note)
        return True

    monkeypatch.setattr(wa_flow.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(wa_flow.presence, "apply", fake_presence)
    monkeypatch.setattr(alerts, "push_owner", fake_push)
    async with Sess() as s:
        sms, wa = await add(s, "sms:+8801711000000", "Rahim"), await add(s, "8801711000000", "Rahim", "whatsapp")
        s.add(WaMessage(contact_id=wa.id, direction="in", channel="whatsapp", kind="text", body="ভাই ডিজাইনটা কবে পাব?", status="received",
                        created_at=datetime.now(timezone.utc) - timedelta(minutes=20)))
        s.add(WaTask(contact_id=wa.id, title="লোগো", source="confirmed"))
        call = WaMessage(contact_id=sms.id, direction="in", channel="sms", kind="text", body="[মিসড কল]", status="received", meta={"call": True})
        s.add(call)
        await s.commit()
        await wa_flow._process(s, call.id)  # auto-links by number first, then explains the call with both channels
        assert await person_of(s, sms) == await person_of(s, wa) is not None
        assert sent and "খোলা কাজ" in sent[0] and "বার্তা পাঠিয়েছেন" in sent[0]


@pytest.mark.asyncio
async def test_process_works_end_to_end_on_a_database_without_the_person_column(Session, monkeypatch):
    """The live database BEFORE the owner runs manual_sql/0002: a message and a missed call must be processed normally."""
    Sess, engine = Session
    sent = []

    async def fake_cfg(db, force=False, scope=None):
        k = copy.deepcopy(wc.DEFAULT_CONFIG)
        k.update(enabled=True, ai={"enabled": False, "voice": False})
        return k

    async def fake_presence(db, cfg):
        return cfg

    async def fake_push(db, cfg, contact, d, label=None):
        sent.append(d.summary)
        return True

    monkeypatch.setattr(wa_flow.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(wa_flow.presence, "apply", fake_presence)
    monkeypatch.setattr(alerts, "push_owner", fake_push)
    async with engine.begin() as conn:
        await conn.execute(text("DROP INDEX IF EXISTS ix_wa_contacts_person_id"))
        await conn.execute(text("ALTER TABLE wa_contacts DROP COLUMN person_id"))
    async with Sess() as s:
        ct = await add(s, "sms:+8801711000000", "Rahim")
        s.add(WaTask(contact_id=ct.id, title="লোগো", source="confirmed"))
        text_msg = WaMessage(contact_id=ct.id, direction="in", channel="sms", kind="text", body="ভাই লোগোটা কাল পাঠিয়ে দিন", status="received")
        call = WaMessage(contact_id=ct.id, direction="in", channel="sms", kind="text", body="[মিসড কল]", status="received", meta={"call": True})
        s.add_all([text_msg, call])
        await s.commit()
        await wa_flow._process(s, text_msg.id)
        await wa_flow._process(s, call.id)
        assert sent and "মিসড কল" in sent[-1]
        assert any(t.source == "proposed" for t in (await s.execute(select(WaTask))).scalars().all())
