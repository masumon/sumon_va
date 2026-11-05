"""Sumon VA release fixes on the server: ingest hygiene, stuck-send cleanup, SMS target guard, export labels, overview counts.
Uses an in-memory SQLite database (no network)."""
import uuid
from datetime import timedelta

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1.routes import inbox
from app.api.v1.routes import wa_assistant as wa
from app.assistant import wa_brain as brain
from app.assistant import wa_config as wcfg
from app.assistant import wa_flow
from app.assistant.channels import dispatch
from app.assistant.wa_send import SendError
from app.models.models import ActivityLog, Setting
from app.models.wa import InboxCommand, InboxDevice, WaContact, WaMessage, WaTask, utcnow


@pytest_asyncio.fixture
async def Session():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        for model in (Setting, ActivityLog, WaContact, WaMessage, WaTask, InboxDevice, InboxCommand):
            await conn.run_sync(model.__table__.create)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


def item(**kw):
    base = dict(type="msg", channel="sms", sender="+8801711000000", app=None, name=None, group=False, body="hi", ext_id="e1", at=None)
    base.update(kw)
    return inbox.IngestItem(**base)


async def make_device(s):
    d = InboxDevice(name="t", token_hash=uuid.uuid4().hex + uuid.uuid4().hex, last_seen_at=utcnow())
    s.add(d)
    await s.commit()
    return d


@pytest.mark.asyncio
async def test_ingest_strips_control_chars_and_survives_a_bad_item(Session, monkeypatch):
    real = inbox.ingest

    async def flaky(db, **kw):
        if kw["ext_id"] == "boom":
            raise RuntimeError("bad row")
        return await real(db, **kw)

    monkeypatch.setattr(inbox, "ingest", flaky)
    async with Session() as s:
        dev = await make_device(s)
        body = inbox.IngestIn(items=[item(ext_id="a", body="he\x00llo\x07 w\norld\t!", sender="+88017\x0011"),
                                     item(ext_id="boom"), item(ext_id="c", sender="Bank")])
        r = await inbox.device_ingest(body, BackgroundTasks(), dev, s)
        assert r["stored"] == 2 and r["skipped"] == 1 and r["filtered"] == 0
        msgs = (await s.execute(select(WaMessage).order_by(WaMessage.wa_id))).scalars().all()
        assert [m.wa_id for m in msgs] == ["sms:a", "sms:c"]
        assert msgs[0].body == "hello w\norld\t!"
        assert (await s.execute(select(WaContact.phone).where(WaContact.phone == "sms:+8801711"))).first()
        # a resend of the same ids stays idempotent
        r2 = await inbox.device_ingest(inbox.IngestIn(items=[item(ext_id="a"), item(ext_id="c", sender="Bank")]), BackgroundTasks(), dev, s)
        assert r2["stored"] == 0
        assert len((await s.execute(select(WaMessage))).scalars().all()) == 2


async def seed_sending(s, dev, age_min, phone="sms:+8801700000001"):
    c = WaContact(phone=phone, name="Rahim", channel="sms")
    s.add(c)
    await s.flush()
    m = WaMessage(contact_id=c.id, direction="out", channel="sms", body="x", status="sending", created_at=utcnow() - timedelta(minutes=age_min))
    s.add(m)
    await s.flush()
    cmd = InboxCommand(device_id=dev.id, msg_id=m.id, kind="sms", target="+8801700000001", body="x", created_at=utcnow() - timedelta(minutes=age_min))
    s.add(cmd)
    await s.commit()
    return m, cmd


@pytest.mark.asyncio
async def test_poll_hides_commands_of_dead_messages_but_keeps_alerts(Session):
    async with Session() as s:
        dev = await make_device(s)
        m, cmd = await seed_sending(s, dev, 1)
        alert = InboxCommand(device_id=None, msg_id=None, kind="alert", target="x", body="y")
        s.add(alert)
        await s.commit()
        r = await inbox.device_poll(wait=0, dev=dev, db=s)
        assert {c["id"] for c in r["commands"]} == {str(cmd.id), str(alert.id)}
        m.status = "failed"
        await s.commit()
        r = await inbox.device_poll(wait=0, dev=dev, db=s)
        assert {c["id"] for c in r["commands"]} == {str(alert.id)}


@pytest.mark.asyncio
async def test_sweep_cancels_command_of_stuck_message_and_expires_old_ones(Session):
    async with Session() as s:
        dev = await make_device(s)
        await wcfg.save_config(s, {"enabled": True}, scope="app")
        await s.commit()
        m, cmd = await seed_sending(s, dev, 30)
        fresh_m, fresh_cmd = await seed_sending(s, dev, 1, phone="sms:+8801700000009")
        old_alert = InboxCommand(device_id=None, kind="alert", target="x", body="y", created_at=utcnow() - timedelta(hours=3))
        s.add(old_alert)
        await s.commit()
        await wa_flow.run_cron(s)
        await s.commit()
        for row in (m, cmd, fresh_m, fresh_cmd, old_alert):
            await s.refresh(row)
        assert m.status == "failed" and cmd.status == "cancelled"
        assert fresh_m.status == "sending" and fresh_cmd.status == "pending"
        assert old_alert.status == "cancelled"


def test_sms_target_guard():
    ok = ["+8801711000000", "01711000000", "+880 1711-000000", "12345678"]
    bad = ["Bank", "16216", "bKash", "", "+12", "1234567890123456", "a1234567890"]
    assert all(dispatch.is_normal_phone(t) for t in ok)
    assert not any(dispatch.is_normal_phone(t) for t in bad)


@pytest.mark.asyncio
async def test_sms_to_a_short_code_is_refused_with_bangla_reason(Session):
    async with Session() as s:
        with pytest.raises(SendError) as e:
            await dispatch.queue_for_device(s, kind="sms", target="16216", body="x")
        assert "সাধারণ ফোন নম্বর নয়" in str(e.value)
        # a refused auto-reply marks the message failed instead of crashing
        c = WaContact(phone="sms:bKash", channel="sms")
        s.add(c)
        await s.flush()
        m = WaMessage(contact_id=c.id, direction="out", channel="sms", body="x", status="sending")
        s.add(m)
        await s.commit()
        assert not await dispatch.deliver_other(s, m, c)
        assert m.status == "failed" and "সাধারণ ফোন নম্বর নয়" in m.error


@pytest.mark.asyncio
async def test_export_labels_and_reimport(Session):
    async with Session() as s:
        c = WaContact(phone="sms:+8801700000002", name="Karim", channel="sms")
        s.add(c)
        await s.flush()
        t = utcnow()
        for i, (d, reason, text) in enumerate([("in", None, "ভাই আছেন?"), ("out", "auto", "জি বলুন"), ("out", "owner", "আমি আসছি"), ("out", "manual", "ঠিক আছে")]):
            s.add(WaMessage(contact_id=c.id, direction=d, channel="sms", body=text, status="sent", reason=reason, created_at=t + timedelta(minutes=i)))
        await s.commit()
        r = await wa.export_chat(c.id, s, str(uuid.uuid4()))
        lines = r.data["text"].split("\n")
        assert [ln.split(" - ", 1)[1].split(":")[0] for ln in lines] == ["Karim", "Assistant", "Sumon", "Sumon"]
        rows, speakers = brain.parse_export(r.data["text"])
        assert len(rows) == 4 and {"Karim", "Assistant", "Sumon"} <= set(speakers)


@pytest.mark.asyncio
async def test_overview_numbers(Session):
    async with Session() as s:
        now = utcnow()
        cs = [WaContact(phone="p1", unread=2, state="assistant", priority=1), WaContact(phone="p2", unread=1, state="assistant", priority=5),
              WaContact(phone="p3", unread=3, state="done", priority=1), WaContact(phone="p4", unread=0, state="assistant", priority=2)]
        s.add_all(cs)
        await s.flush()
        for st, age in (("draft", 0), ("draft", 0), ("queued", 0), ("failed", 0), ("failed", 3), ("sent", 0)):
            s.add(WaMessage(contact_id=cs[0].id, direction="out", body="x", status=st, created_at=now - timedelta(days=age)))
        s.add_all([WaTask(title="a", is_done=False, due_at=now - timedelta(days=1)), WaTask(title="b", is_done=False),
                   WaTask(title="c", is_done=False, due_at=now + timedelta(days=1)), WaTask(title="d", is_done=True, due_at=now - timedelta(days=1))])
        await s.commit()
        d = (await wa.overview(s, "admin")).data
        assert (d["waiting"], d["urgent"], d["drafts"], d["queued"], d["failed_24h"], d["tasks_open"], d["tasks_late"]) == (2, 1, 2, 1, 1, 3, 1)


@pytest.mark.asyncio
async def test_task_titles_and_api_contact_name(Session):
    from app.assistant import promises
    async with Session() as s:
        c = WaContact(phone="sms:+8801700000003", name="Rahim")
        s.add(c)
        await s.flush()
        t = await promises.track_promise(s, c, "কাল পাঠাব")
        await s.commit()
        assert t.title.startswith("Rahim: ")
        out = (await wa.tasks("open", s, "admin")).data
        assert out[0]["contact_name"] == "Rahim" and out[0]["who"] == "Rahim"


@pytest.mark.asyncio
async def test_report_has_truncated_flag(Session):
    async with Session() as s:
        d = (await wa.report(7, s, "admin")).data
        assert d["truncated"] is False
