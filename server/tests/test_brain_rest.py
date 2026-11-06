"""Phase 2-7 remainder: dismissed signal, fact memory, relationship signs, F0, task details and reminders, history import, rule trace."""
import copy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1.routes import wa_assistant
from app.assistant import assignments as asg
from app.assistant import f0, history_import, memory, relationship
from app.assistant import task_details as td
from app.assistant import thread_state as ts
from app.assistant import wa_config as wc
from app.assistant import wa_flow
from app.assistant.channels import alerts
from app.models.models import ActivityLog, Setting
from app.models.wa import InboxCommand, InboxDevice, WaContact, WaMessage, WaNote, WaTask

NOW = datetime(2026, 11, 6, 10, 0, tzinfo=timezone.utc)


def cfg(**over):
    c = copy.deepcopy(wc.DEFAULT_CONFIG)
    c.update(over)
    return c


# -- fact memory ---------------------------------------------------------------------------

def test_an_ai_guess_is_never_high_confidence_and_never_replaces_an_owner_fact():
    prof, fact, why = memory.add({}, "রহিম ঢাকায় থাকে", "ai", "msg-1", "high")
    assert fact["confidence"] == "medium" and fact["provenance"] == "ai" and not why
    prof, owner, _ = memory.add(prof, "রহিম ঢাকায় থাকে", "owner", "owner")
    assert owner["provenance"] == "owner" and owner["confidence"] == "high" and len(memory.facts_of(prof)) == 1  # confirmed, not duplicated
    prof2, again, why = memory.add(prof, "রহিম ঢাকায় থাকে", "ai", "msg-9", "medium")
    assert again is None and "আগেই" in why and memory.facts_of(prof2)[0]["provenance"] == "owner"


def test_a_correction_keeps_the_old_words_in_history_and_removal_erases_them():
    prof, f, _ = memory.add({"learned_at": "x"}, "জন্মদিন ৫ মে", "owner", "owner")
    prof, new = memory.correct(prof, f["id"], "জন্মদিন ৬ মে")
    live = [x for x in memory.facts_of(prof) if x["status"] == "active"]
    assert [x["text"] for x in live] == ["জন্মদিন ৬ মে"] and live[0]["history"][0]["was"] == "জন্মদিন ৫ মে"
    assert any(x["status"] == "corrected" for x in memory.facts_of(prof)) and prof["learned_at"] == "x"  # other profile keys untouched
    prof, removed = memory.remove(prof, new["id"])
    assert removed and "জন্মদিন ৬ মে" not in str(prof) or all(x["id"] != new["id"] for x in memory.facts_of(prof))
    assert "৬ মে" not in " ".join(h.get("was", "") for x in memory.facts_of(prof) for h in x.get("history", []))


def test_inferred_facts_are_marked_and_too_short_ones_are_refused():
    prof, _, _ = memory.add({}, "পছন্দ: সকালে ফোন", "ai", "m", "low")
    assert memory.view(prof)[0]["inferred"] is True
    assert memory.add({}, "ab", "owner", "owner")[1] is None


# -- relationship signs ------------------------------------------------------------------------

def msg(days_ago, d="in", status="received", reason=None, body="hi", call=False, minutes=0):
    return {"id": f"{d}{days_ago}{minutes}", "direction": d, "status": status, "reason": reason, "body": "[মিসড কল]" if call else body,
            "created_at": NOW - timedelta(days=days_ago, minutes=minutes), "meta": {"call": True} if call else {}}


def test_too_little_evidence_means_no_observation_at_all():
    assert relationship.observe([msg(1), msg(2), msg(3)], NOW) == []


def test_a_sudden_rise_and_repeated_calls_and_long_silence_are_reported_as_signs_with_basis():
    rise = [msg(d) for d in (1, 2, 3, 4, 5, 6, 7, 8)] + [msg(d) for d in (20, 21, 22, 23)]
    obs = relationship.observe(rise, NOW)
    assert any("অনেক বেশি" in o["text"] and "8" in o["basis"] for o in obs)
    calls = [msg(d, call=True) for d in (1, 2, 3)] + [msg(d) for d in (10, 11, 12, 13, 14)]
    assert any("একাধিকবার ফোন" in o["text"] for o in relationship.observe(calls, NOW))
    silent = [msg(d) for d in (4, 5, 6, 7, 8, 9)]
    assert any("৩ দিনের বেশি" in o["text"] and o["confidence"] == "high" for o in relationship.observe(silent, NOW))


# -- history import: parsing ---------------------------------------------------------------------

ANDROID = """12/05/2024, 10:15 pm - Messages and calls are end-to-end encrypted.
12/05/2024, 10:15 pm - Rahim: কাজটা হয়েছে?
আর ছবিটাও দিন
12/05/2024, 22:20 - Sumon: কাল দিচ্ছি
13/05/2024, 09:00 - Rahim: <Media omitted>
[14/05/24, 10:15:30] Sumon: ঠিক আছে
"""


def test_exports_in_several_formats_are_read_with_dates_multiline_media_and_system_lines():
    rows, stats = history_import.parse_dated(ANDROID)
    assert [r["speaker"] for r in rows] == ["Rahim", "Sumon", "Rahim", "Sumon"] and stats["system"] == 1
    assert rows[0]["text"] == "কাজটা হয়েছে? আর ছবিটাও দিন"
    assert rows[0]["at"] == datetime(2024, 5, 12, 16, 15, tzinfo=timezone.utc)  # 10:15 pm in Dhaka (UTC+6)
    assert history_import.speakers_of(rows) == ["Rahim", "Sumon"]
    month_first, _ = history_import.parse_dated("05/13/2024, 10:15 - A: hi\n05/14/2024, 10:16 - B: yo")
    assert month_first[0]["at"].month == 5 and month_first[0]["at"].day == 13  # 13 can only be a day


def test_bangla_digits_and_impossible_dates_do_not_crash():
    rows, stats = history_import.parse_dated("১২/০৫/২০২৪, ১০:১৫ - Rahim: ভালো\n99/99/2024, 10:15 - X: bad")
    assert len(rows) == 1 and stats["undated"] == 1


# -- database path ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def Session():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        for model in (Setting, ActivityLog, WaContact, WaMessage, WaNote, WaTask, InboxDevice, InboxCommand):
            await conn.run_sync(model.__table__.create)
        await conn.execute(text("ALTER TABLE wa_contacts ADD COLUMN person_id CHAR(32)"))  # 0002 already run
    yield async_sessionmaker(engine, expire_on_commit=False), engine
    await engine.dispose()


async def add_task_columns(engine):
    async with engine.begin() as conn:
        for col, typ in (("status", "VARCHAR(12)"), ("progress", "TEXT"), ("blocker", "TEXT"), ("source_msg_id", "CHAR(32)"),
                         ("confidence", "VARCHAR(8)"), ("assigner_contact_id", "CHAR(32)"), ("updated_at", "DATETIME")):
            await conn.execute(text(f"ALTER TABLE wa_tasks ADD COLUMN {col} {typ}"))  # = manual_sql/0003 run


async def person(s, name="রহিম", phone="sms:+8801711000020", channel="sms", **kw):
    c = WaContact(phone=phone, channel=channel, name=name, category="business", priority=5, mode="inherit", state="assistant",
                  is_vip=False, is_family=False, is_blocked=False, unread=0, **kw)
    s.add(c)
    await s.flush()
    return c


@pytest.mark.asyncio
async def test_a_dismissed_notification_is_a_hint_not_a_read_receipt(Session):
    Sess, _ = Session
    async with Sess() as s:
        c = await person(s, phone="notif:com.whatsapp:Rahim", channel="notif")
        old = WaMessage(contact_id=c.id, direction="in", channel="notif", kind="text", body="কবে?", status="received",
                        created_at=datetime.now(timezone.utc) - timedelta(minutes=40))
        s.add(old)
        await s.commit()
        assert await wa_flow.mark_dismissed(s, "notif:com.whatsapp:Rahim", None) is True
        assert await wa_flow.mark_dismissed(s, "notif:com.whatsapp:Rahim", None) is False  # only once
        assert await wa_flow.mark_dismissed(s, "notif:com.whatsapp:Nobody", None) is False
        await s.commit()
        got = await wa_flow.recent_messages(s, c.id, 5)
        st = ts.assess(got)
        assert st.status == "none" and st.unanswered == 1 and st.dismissed is True  # still waiting for an answer
        r = ts.reminder_reason(cfg(reminders={"unanswered_min": 15, "only_important": True, "task_lead_min": 0}), c, st, datetime.now(timezone.utc), False)
        assert "পড়ার প্রমাণ নয়" in r and "পড়া হয়েছে" not in r.replace("প্রমাণ নয়", "")


@pytest.mark.asyncio
async def test_owner_facts_survive_learning_a_chat_and_private_facts_are_stored_sealed(Session, monkeypatch):
    Sess, _ = Session

    async def fake_learn(db, rows, owner):
        return {"relation": "friend", "summary": "x"}

    monkeypatch.setattr(wa_flow.brain if hasattr(wa_flow.brain, "learn_profile") else wa_assistant.brain, "learn_profile", fake_learn)
    async with Sess() as s:
        c = await person(s, phone="sms:+8801711000021")
        c.is_family = True  # private
        await wa_assistant.add_fact(c.id, wa_assistant.FactIn(text="আম্মার ওষুধ সকালে"), s, "owner")
        await s.refresh(c)
        stored = [f["text"] for f in c.profile["facts"]]
        assert stored and stored[0].startswith("enc1:") and "ওষুধ" not in stored[0]
        assert "আম্মার ওষুধ সকালে" in [f["text"] for f in (await wa_assistant.contact_facts(c.id, s, "owner")).data]
        chat = "12/05/2024, 10:15 - Amma: কেমন আছিস\n12/05/2024, 10:16 - Sumon: ভালো\n12/05/2024, 10:17 - Amma: খেয়েছিস?\n"
        await wa_assistant.learn(c.id, wa_assistant.LearnIn(chat_text=chat, owner_speaker="Sumon", consent_private=True), s, "00000000-0000-0000-0000-000000000001")
        await s.refresh(c)
        assert c.profile.get("relation") == "friend" and len(c.profile["facts"]) == 1  # the owner's fact was not wiped


@pytest.mark.asyncio
async def test_import_is_idempotent_respects_the_period_and_never_waits_for_an_answer(Session):
    Sess, _ = Session
    now = datetime.now(timezone.utc).astimezone(history_import.DHAKA)
    d = lambda days, mins=0: (now - timedelta(days=days, minutes=mins)).strftime("%d/%m/%Y, %H:%M")  # noqa: E731
    chat = "\n".join([f"{d(120)} - Rahim: খুব পুরোনো", f"{d(10)} - Rahim: ১০ দিন আগে", f"{d(2)} - Rahim: কাজটা হয়েছে?", f"{d(2, -1)} - Sumon: হ্যাঁ দিয়েছি"])
    rows, _ = history_import.parse_dated(chat)
    async with Sess() as s:
        c = await person(s, phone="8801711000022", channel="whatsapp")
        rep = await history_import.import_rows(s, c, rows, "Sumon", 7, 90)
        await s.commit()
        assert rep["imported"] == 2 and rep["skipped_old"] + rep["skipped_period"] == 2 and "পুরো ইতিহাস নয়" in rep["note"]
        again = await history_import.import_rows(s, c, rows, "Sumon", 7, 90)
        await s.commit()
        assert again["imported"] == 0 and again["duplicates"] == 2  # same file again: nothing doubles
        allp = await history_import.import_rows(s, c, rows, "Sumon", 0, 90)
        await s.commit()
        assert allp["imported"] == 1 and allp["skipped_old"] == 1  # "everything in the file" adds the 10-day-old line; 120 days is past retention
        stored = (await s.execute(select(WaMessage).where(WaMessage.contact_id == c.id))).scalars().all()
        assert {m.status for m in stored} == {"imported"} and {m.direction for m in stored} == {"in", "out"}
        st = ts.assess(await wa_flow.recent_messages(s, c.id, 20))
        assert st.unanswered == 0  # imported history never waits for an answer


@pytest.mark.asyncio
async def test_an_imported_message_is_never_processed_no_draft_no_alert(Session, monkeypatch):
    Sess, _ = Session
    sent = []

    async def fake_cfg(db, force=False, scope=None):
        k = cfg()
        k.update(enabled=True, mode="auto", ai={"enabled": False, "voice": False})
        return k

    async def fake_push(*a, **k):
        sent.append(1)
        return True

    monkeypatch.setattr(wa_flow.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(alerts, "push_owner", fake_push)
    async with Sess() as s:
        c = await person(s, phone="8801711000023", channel="whatsapp")
        m = WaMessage(contact_id=c.id, direction="in", channel="whatsapp", kind="text", body="জরুরি, হাসপাতালে", status="imported")
        s.add(m)
        await s.commit()
        await wa_flow._process(s, m.id)
        assert sent == [] and (await s.execute(select(WaMessage).where(WaMessage.direction == "out"))).scalars().all() == []


@pytest.mark.asyncio
async def test_import_route_needs_consent_for_private_and_the_owner_name(Session):
    Sess, _ = Session
    chat = "12/05/2024, 10:15 - Amma: কেমন আছিস\n12/05/2024, 10:16 - Sumon: ভালো\n"
    async with Sess() as s:
        c = await person(s, phone="sms:+8801711000024")
        c.is_family = True
        await s.commit()
        body = dict(chat_text=chat + "x" * 20, owner_speaker="Sumon", days=0)
        assert (await wa_assistant.import_history(c.id, wa_assistant.ImportIn(**body), s, "00000000-0000-0000-0000-000000000001")).data["need_consent"]
        no_owner = await wa_assistant.import_history(c.id, wa_assistant.ImportIn(chat_text=chat + "x" * 20, days=0, consent_private=True), s, "00000000-0000-0000-0000-000000000001")
        assert no_owner.data["need_owner"] and set(no_owner.data["speakers"]) == {"Amma", "Sumon"}
        with pytest.raises(HTTPException) as e:
            await wa_assistant.import_history(c.id, wa_assistant.ImportIn(**{**body, "days": 4}), s, "00000000-0000-0000-0000-000000000001")
        assert e.value.status_code == 422


# -- task details (manual_sql/0003) ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_task_details_degrade_before_the_sql_and_work_after_it(Session):
    Sess, engine = Session
    async with Sess() as s:
        t = WaTask(title="লোগো", source="confirmed")
        s.add(t)
        await s.commit()
        assert await td.ready(s) is False and await td.set_details(s, t.id, status="in_progress") is False and await td.get_details(s, [t.id]) == {}
        with pytest.raises(HTTPException) as e:
            await wa_assistant.task_progress(t.id, wa_assistant.ProgressIn(status="in_progress"), s, "owner")
        assert e.value.status_code == 409 and "0003" in e.value.detail
    await add_task_columns(engine)
    async with Sess() as s:
        t = (await s.execute(select(WaTask))).scalars().one()
        await wa_assistant.task_progress(t.id, wa_assistant.ProgressIn(status="in_progress", progress="ডিজাইন ৭০% হয়েছে"), s, "owner")
        d = (await td.get_details(s, [t.id]))[t.id]
        assert d["status"] == "in_progress" and "৭০%" in d["progress"]
        line = dict(asg.task_status([{"title": "x", "is_done": False, "source": "confirmed", **d}], NOW))
        assert "ডিজাইন ৭০% হয়েছে" in line["open"]
        await wa_assistant.task_progress(t.id, wa_assistant.ProgressIn(status="completed"), s, "owner")
        await s.refresh(t)
        assert t.is_done and t.done_at  # completion only by the owner's route
        with pytest.raises(HTTPException):
            await wa_assistant.task_progress(t.id, wa_assistant.ProgressIn(status="bogus"), s, "owner")


@pytest.mark.asyncio
async def test_a_proposed_task_records_its_evidence_when_the_sql_exists(Session, monkeypatch):
    Sess, engine = Session
    await add_task_columns(engine)

    async def fake_cfg(db, force=False, scope=None):
        k = cfg()
        k.update(enabled=True, ai={"enabled": False, "voice": False})
        return k

    async def fake_presence(db, c):
        return c

    async def fake_push(*a, **k):
        return True

    monkeypatch.setattr(wa_flow.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(wa_flow.presence, "apply", fake_presence)
    monkeypatch.setattr(alerts, "push_owner", fake_push)
    async with Sess() as s:
        c = await person(s, phone="sms:+8801711000025")
        m = WaMessage(contact_id=c.id, direction="in", channel="sms", kind="text", body="লোগোটা কাল পাঠিয়ে দিন", status="received")
        s.add(m)
        await s.commit()
        await wa_flow._process(s, m.id)
        t = (await s.execute(select(WaTask))).scalars().one()
        d = (await td.get_details(s, [t.id]))[t.id]
        assert d["status"] == "proposed" and d["source_msg_id"] == str(m.id) and d["confidence"] == "high"


def test_task_reminder_stages_fire_once_each_and_never_for_old_or_undated_tasks():
    soon, late = NOW + timedelta(minutes=30), NOW - timedelta(hours=2)
    assert asg.reminder_kind(soon, NOW, 60, None) == "due" and asg.reminder_kind(soon, NOW, 60, "due") is None
    assert asg.reminder_kind(late, NOW, 60, "due") == "late" and asg.reminder_kind(late, NOW, 60, "late") is None
    assert asg.reminder_kind(NOW - timedelta(days=9), NOW, 60, None) is None and asg.reminder_kind(None, NOW, 60, None) is None
    assert asg.reminder_kind(soon, NOW, 0, None) is None  # off


@pytest.mark.asyncio
async def test_cron_reminds_only_for_confirmed_tasks_once_per_stage(Session, monkeypatch):
    Sess, _ = Session
    sent = []

    async def fake_cfg(db, force=False, scope=None):
        k = cfg()
        k.update(enabled=True, reminders={"unanswered_min": 0, "only_important": True, "task_lead_min": 60})
        return k

    async def fake_push(db, conf, contact, d, label=None):
        sent.append((d.summary, label))
        return True

    monkeypatch.setattr(wa_flow.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(alerts, "push_owner", fake_push)
    now = datetime.now(timezone.utc)
    async with Sess() as s:
        s.add_all([WaTask(title="আমার কাজ", source="manual", due_at=now + timedelta(minutes=20)),
                   WaTask(title="প্রস্তাবিত", source="proposed", due_at=now + timedelta(minutes=20)),
                   WaTask(title="শেষ", source="manual", due_at=now + timedelta(minutes=20), is_done=True)])
        await s.commit()
        assert await wa_flow.send_task_reminders(s, now) == 1 and "আমার কাজ" in sent[0][0] and sent[0][1] == "কাজের সময়"
        assert await wa_flow.send_task_reminders(s, now) == 0  # same stage: not again
        assert await wa_flow.send_task_reminders(s, now + timedelta(hours=1)) == 1  # the overdue stage


# -- F0 ------------------------------------------------------------------------------------------

def test_f0_understands_bangla_and_english_commands_and_the_choice_suffix():
    p = f0.parse("রহিমকে বলো আমি কাজটা করছি, কাল জানাব")
    assert p["intent"] == "reply" and p["name"] == "রহিম" and p["msg"].startswith("আমি কাজটা")
    assert f0.parse("tell Rahim that I will update tomorrow")["msg"] == "I will update tomorrow"
    assert f0.parse("রহিমের কাজের কী হলো")["intent"] == "task_status"
    assert f0.parse("মিসড কল")["intent"] == "missed_calls" and f0.parse("কার উত্তর বাকি")["intent"] == "pending" and f0.parse("আমার কাজ")["intent"] == "tasks"
    assert f0.parse("রহিম সম্পর্কে কী জানো")["intent"] == "memory" and f0.parse("কিছু একটা")["intent"] == "unknown"
    cid = "a" * 32
    assert f0.parse(f"রহিমকে বলো ঠিক আছে #{cid}")["contact_id"] == cid


@pytest.mark.asyncio
async def test_f0_asks_which_person_and_never_sends(Session):
    Sess, _ = Session
    async with Sess() as s:
        await person(s, "রহিম উদ্দিন", "sms:+8801711000030")
        await person(s, "রহিম মিয়া", "sms:+8801811000031")
        await s.commit()
        r = await f0.run(s, "রহিমকে বলো কাল জানাব")
        assert r["choices"] and len(r["choices"]) == 2 and r["draft"] is None
        assert (await s.execute(select(WaMessage))).scalars().all() == []
        none = await f0.run(s, "করিমকে বলো কাল জানাব")
        assert none["draft"] is None and "পাইনি" in none["answer"]


@pytest.mark.asyncio
async def test_f0_makes_a_draft_with_warnings_reuses_it_and_refuses_blocked(Session):
    Sess, _ = Session
    async with Sess() as s:
        a = await person(s, "রহিম", "sms:+8801711000032")
        s.add_all([WaMessage(contact_id=a.id, direction="in", channel="sms", kind="text", body="কাজটা কবে?", status="received", created_at=datetime.now(timezone.utc) - timedelta(minutes=30)),
                   WaMessage(contact_id=a.id, direction="out", channel="sms", kind="text", body="কাল দিচ্ছি", status="sent", reason="owner", created_at=datetime.now(timezone.utc) - timedelta(minutes=10))])
        await s.commit()
        r = await f0.run(s, "রহিমকে বলো কাল জানাব")
        d = r["draft"]
        assert d and d["body"] == "কাল জানাব" and any("আগেই উত্তর দিয়েছেন" in w for w in d["warnings"]) and "এখনো কিছু পাঠানো হয়নি" in r["answer"]
        row = await s.get(WaMessage, __import__("uuid").UUID(d["id"]))
        assert row.status == "draft" and row.reason == "owner" and row.meta["via"] == "f0"  # owner-originated, but only a draft
        again = await f0.run(s, "রহিমকে বলো কাল জানাব")
        assert again["draft"]["id"] == d["id"]  # the same command twice = one draft
        assert len((await s.execute(select(WaMessage).where(WaMessage.status == "draft"))).scalars().all()) == 1
        a.is_blocked = True
        await s.commit()
        assert (await f0.run(s, "রহিমকে বলো ঠিক আছে"))["draft"] is None


@pytest.mark.asyncio
async def test_f0_answers_from_real_data_and_says_when_there_is_nothing(Session):
    Sess, _ = Session
    async with Sess() as s:
        assert "কোনো মিসড কল নেই" in (await f0.run(s, "মিসড কল"))["answer"]
        assert "কোনো খোলা কাজ নেই" in (await f0.run(s, "আমার কাজ"))["answer"]
        c = await person(s, "করিম", "sms:+8801711000033")
        s.add(WaTask(contact_id=c.id, title="করিম: কাজ: লোগো", source="proposed"))
        s.add(WaMessage(contact_id=c.id, direction="in", channel="sms", kind="text", body="[মিসড কল]", status="received", meta={"call": True}))
        s.add(WaMessage(contact_id=c.id, direction="in", channel="sms", kind="text", body="ভাই কবে হবে?", status="received"))
        c.last_inbound_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        await s.commit()
        assert "1 জনের মিসড কল" in (await f0.run(s, "মিসড কল"))["answer"]
        assert "প্রস্তাবিত" in (await f0.run(s, "আমার কাজ"))["items"][0]["subtitle"]
        assert "নিশ্চিত করেননি" in (await f0.run(s, "করিমের কাজের কী হলো"))["answer"]
        assert (await f0.run(s, "কার উত্তর বাকি"))["items"]
        assert "কোনো তথ্য সংরক্ষিত নেই" in (await f0.run(s, "করিম সম্পর্কে কী জানো"))["answer"]


# -- rule trace -----------------------------------------------------------------------------------

def test_every_automatic_decision_names_the_rule_that_decided_it():
    who = lambda **k: SimpleNamespace(**{"channel": "sms", "mode": "inherit", "category": None, "is_vip": False, "tags": None, **k})  # noqa: E731
    mode, rule = wa_flow.explain_mode(cfg(mode="shadow"), who())
    assert mode == "draft" and "শুধু খসড়া" in rule
    c = cfg(mode="auto")
    c["channels"]["device"]["auto_sms"] = True
    assert wa_flow.explain_mode(c, who(category="personal"))[1].startswith("বিভাগ")
    assert wa_flow.explain_mode(c, who(mode="telegram"))[1].startswith("ব্যক্তি")
    assert wa_flow.explain_mode(cfg(mode="auto"), who(channel="email"))[1].startswith("চ্যানেল")
    auto, why = wa_flow.explain_mode(c, who())
    assert auto == "auto" and "সব নিয়ম" in why and wa_flow.effective_mode(c, who()) == "auto"


# -- the phone's "seen" item through the real ingest route ----------------------------------------------------

@pytest.mark.asyncio
async def test_a_seen_item_marks_the_latest_message_but_stores_nothing_and_alerts_nobody(Session, monkeypatch):
    import uuid as _uuid

    from fastapi import BackgroundTasks

    from app.api.v1.routes import inbox
    from app.models.wa import utcnow

    Sess, _ = Session
    monkeypatch.setattr(inbox.wake, "notify", lambda: None)
    async with Sess() as s:
        dev = InboxDevice(name="t", token_hash=_uuid.uuid4().hex + _uuid.uuid4().hex, last_seen_at=utcnow())
        s.add(dev)
        c = await person(s, phone="notif:com.whatsapp:Rahim", channel="notif")
        m = WaMessage(contact_id=c.id, direction="in", channel="notif", kind="text", body="কবে?", status="received")
        s.add(m)
        await s.commit()
        item = dict(type="seen", channel="notif", sender="Rahim", app="com.whatsapp", body="", ext_id="s:abc", group=False, at=None)
        r = await inbox.device_ingest(inbox.IngestIn(items=[inbox.IngestItem(**item)]), BackgroundTasks(), dev, s)
        assert r["stored"] == 0
        await s.refresh(m)
        assert m.meta.get("dismissed_at") and (await s.execute(select(WaMessage))).scalars().all() == [m]
        ghost = await inbox.device_ingest(inbox.IngestIn(items=[inbox.IngestItem(**{**item, "sender": "Nobody", "ext_id": "s:def"})]), BackgroundTasks(), dev, s)
        assert ghost["stored"] == 0 and (await s.execute(select(WaContact).where(WaContact.name == "Nobody"))).first() is None  # no contact invented


# -- F0 x the rest of the flow (final audit) ---------------------------------------------------------------

def _flow_patches(monkeypatch):
    async def fake_cfg(db, force=False, scope=None):
        k = cfg()
        k.update(enabled=True, ai={"enabled": False, "voice": False})
        return k

    async def fake_presence(db, c):
        return c

    async def fake_push(*a, **k):
        return True

    monkeypatch.setattr(wa_flow.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(wa_flow.presence, "apply", fake_presence)
    monkeypatch.setattr(alerts, "push_owner", fake_push)


@pytest.mark.asyncio
async def test_a_new_message_never_overwrites_the_owners_own_f0_draft(Session, monkeypatch):
    _flow_patches(monkeypatch)
    Sess, _ = Session
    async with Sess() as s:
        c = await person(s, "রহিম", "sms:+8801711000040")
        c.last_inbound_at = datetime.now(timezone.utc) - timedelta(minutes=2)
        await s.commit()
        r = await f0.run(s, "রহিমকে বলো কাল সকালে জানাব")
        draft_id = __import__("uuid").UUID(r["draft"]["id"])
        m = WaMessage(contact_id=c.id, direction="in", channel="sms", kind="text", body="ভাই কেমন আছেন? একটা কথা ছিল", status="received")
        s.add(m)
        await s.commit()
        await wa_flow._process(s, m.id)
        mine = await s.get(WaMessage, draft_id)
        await s.refresh(mine)
        assert mine.status == "draft" and mine.body == "কাল সকালে জানাব" and not (mine.meta or {}).get("updated")  # the owner's words are untouched
        others = (await s.execute(select(WaMessage).where(WaMessage.direction == "out", WaMessage.id != draft_id))).scalars().all()
        assert all(o.reason != "owner" for o in others)  # the assistant's own suggestion, if any, is a separate message


@pytest.mark.asyncio
async def test_a_waiting_f0_draft_is_not_counted_as_an_owner_answer(Session):
    from app.assistant import wa_brain as brain

    Sess, _ = Session
    now = datetime.now(timezone.utc)
    recent = [{"id": 1, "direction": "out", "status": "draft", "reason": "owner", "body": "x", "created_at": now, "meta": {}},
              {"id": 2, "direction": "in", "status": "received", "reason": None, "body": "কই?", "created_at": now - timedelta(minutes=3), "meta": {}},
              {"id": 3, "direction": "in", "status": "received", "reason": None, "body": "ভাই?", "created_at": now - timedelta(minutes=4), "meta": {}}]
    contact = SimpleNamespace(name="রহিম", is_family=False, is_vip=False, tags=None, lang=None, channel="sms", mode="inherit", state="assistant", hold_until=None,
                              is_blocked=False, category=None, priority=5)
    d = await brain.decide(None, {**cfg(), "ai": {"enabled": False, "voice": False}}, contact, "উত্তর দিচ্ছেন না কেন", "text", None, recent, [])
    assert d.priority == 4  # three unanswered in a row = "repeated"; an unsent draft is not an answer


@pytest.mark.asyncio
async def test_f0_checks_the_whole_linked_person_even_when_a_choice_is_picked_by_id(Session):
    Sess, _ = Session
    async with Sess() as s:
        sms = await person(s, "রহিম", "sms:+8801711000041")
        wa = await person(s, "রহিম", "8801711000041", channel="whatsapp")
        s.add(WaMessage(contact_id=wa.id, direction="in", channel="whatsapp", kind="text", body="কাজটা কবে?", status="received", created_at=datetime.now(timezone.utc) - timedelta(minutes=30)))
        s.add(WaMessage(contact_id=wa.id, direction="out", channel="whatsapp", kind="text", body="কাল দিচ্ছি", status="sent", reason="owner", created_at=datetime.now(timezone.utc) - timedelta(minutes=10)))
        await s.commit()
        from app.assistant import identity as idn
        await idn.link(s, [sms, wa], "owner", "test")
        await s.commit()
        r = await f0.run(s, f"রহিমকে বলো ঠিক আছে #{sms.id}")  # picked the SMS row, but the answer was sent on WhatsApp
        assert any("আগেই উত্তর দিয়েছেন" in w for w in r["draft"]["warnings"])


@pytest.mark.asyncio
async def test_f0_second_different_draft_warns_about_the_owners_own_waiting_draft(Session):
    Sess, _ = Session
    async with Sess() as s:
        await person(s, "রহিম", "sms:+8801711000042")
        await s.commit()
        await f0.run(s, "রহিমকে বলো কাল জানাব")
        second = await f0.run(s, "রহিমকে বলো পরশু জানাব")
        assert any("আপনার আগের একটি খসড়া" in w for w in second["draft"]["warnings"]) and not any("সহকারীর" in w for w in second["draft"]["warnings"])


def test_f0_choice_suffix_works_with_the_dashed_uuid_the_app_really_sends():
    import uuid as _u
    cid = str(_u.uuid4())
    p = f0.parse(f"রহিমকে বলো ঠিক আছে #{cid}")
    assert p["contact_id"] == cid and p["msg"] == "ঠিক আছে"
