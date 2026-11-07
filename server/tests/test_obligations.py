"""Official/legal notices and invitations (Brain domains 3 Social, 6 Legal & Official, 14 Priority): rules, decide() and _process (SQLite)."""
import asyncio
import copy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.assistant import obligations as ob
from app.assistant import wa_brain as brain
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


def who(**kw):
    base = dict(is_family=False, is_vip=False, category="business", channel="sms", name="রহিম", lang=None, is_blocked=False,
                state="assistant", hold_until=None, mode="inherit", tags=[])
    base.update(kw)
    return SimpleNamespace(**base)


# -- detection ---------------------------------------------------------------------

def test_a_dated_official_notice_is_detected_with_a_due_date():
    r = ob.detect("আপনার আয়কর রিটার্ন জমার শেষ তারিখ আগামী সোমবার", cfg(), NOW)
    assert r and r["kind"] == "official" and r["due_at"] is not None


def test_an_invitation_without_a_date_has_no_invented_due_date():
    r = ob.detect("আপনাকে আমার মেয়ের বিয়ের অনুষ্ঠানে দাওয়াত", cfg(), NOW)
    assert r and r["kind"] == "invite" and r["due_at"] is None


def test_ordinary_chat_is_neither_official_nor_an_invitation():
    assert ob.detect("ভাই কেমন আছেন? I'm fine", cfg(), NOW) is None
    assert ob.detect("", cfg(), NOW) is None


def test_official_wins_over_invitation():
    assert ob.detect("দূতাবাসের দাওয়াত আগামীকাল", cfg(), NOW)["kind"] == "official"


def test_a_private_title_stores_no_words():
    assert ob.proposal_title(who(), "official", "আদালতের নোটিশ", True) == ob.PRIVATE_TITLE
    assert ob.proposal_title(who(), "invite", "জন্মদিনের দাওয়াত", False).startswith("রহিম: দাওয়াত:")


def test_the_owner_can_empty_the_word_lists():
    assert ob.detect("আদালতের নোটিশ এসেছে", cfg(official_words=[], invite_words=[]), NOW) is None


# -- decide(): official matters are the owner's own call ------------------------------

def test_an_official_message_is_never_answered_and_is_raised_to_priority_two():
    d = asyncio.run(brain.decide(None, cfg(ai={"enabled": False, "voice": False}), who(), "আপনার পাসপোর্ট নবায়নের নোটিশ এসেছে", "text", None, [], []))
    assert d.handoff and d.notify and d.reply is None and d.reason == "sensitive" and d.priority <= 2 and "দাপ্তরিক" in d.note


def test_an_urgent_official_message_keeps_priority_one():
    d = asyncio.run(brain.decide(None, cfg(ai={"enabled": False, "voice": False}), who(), "জরুরি: আদালতে হাজিরা আজ", "text", None, [], []))
    assert d.priority == 1 and d.handoff


def test_family_keeps_the_family_reason_and_note():
    d = asyncio.run(brain.decide(None, cfg(ai={"enabled": False, "voice": False}), who(is_family=True), "ভিসার কাগজ পাঠাও", "text", None, [], []))
    assert d.reason == "family" and "পরিবার" in d.note


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
        return cfg(enabled=True, ai={"enabled": False, "voice": False})

    async def fake_presence(db, c):
        return c

    async def fake_push(db, c, contact, d, label=None):
        sent.append({"p": d.priority, "note": d.note})
        return True

    monkeypatch.setattr(wa_flow.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(wa_flow.presence, "apply", fake_presence)
    monkeypatch.setattr(alerts, "push_owner", fake_push)
    return sent


async def setup(s, body, family=False):
    c = WaContact(phone="sms:+8801711000099", channel="sms", name="অফিস", category="business", priority=5, mode="inherit", state="assistant",
                  is_vip=False, is_family=family, is_blocked=False, unread=0)
    s.add(c)
    await s.flush()
    m = WaMessage(contact_id=c.id, direction="in", channel="sms", kind="text", body=body, status="received",
                  created_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    s.add(m)
    await s.commit()
    return c, m


@pytest.mark.asyncio
async def test_a_dated_official_notice_becomes_one_proposed_task_and_no_reply(Session, alerts_sent):
    async with Session() as s:
        c, m = await setup(s, "ট্রেড লাইসেন্স নবায়নের শেষ তারিখ আগামী রবিবার")
        await wa_flow._process(s, m.id)
        await wa_flow._process(s, m.id)  # the same message again must not duplicate the task
        tasks = (await s.execute(select(WaTask).where(WaTask.contact_id == c.id))).scalars().all()
        assert [t.source for t in tasks] == ["proposed"] and tasks[0].due_at is not None and tasks[0].title.startswith("অফিস: দাপ্তরিক:")
        outs = (await s.execute(select(WaMessage).where(WaMessage.contact_id == c.id, WaMessage.direction == "out"))).scalars().all()
        assert outs == []  # the assistant said nothing to the sender
        assert alerts_sent and alerts_sent[0]["p"] <= 2


@pytest.mark.asyncio
async def test_an_undated_invitation_creates_no_task(Session, alerts_sent):
    async with Session() as s:
        c, m = await setup(s, "আমার ছেলের আকিকায় আপনাকে দাওয়াত")
        await wa_flow._process(s, m.id)
        assert (await s.execute(select(WaTask).where(WaTask.contact_id == c.id))).scalars().all() == []


@pytest.mark.asyncio
async def test_a_family_invitation_task_stores_no_words(Session, alerts_sent):
    async with Session() as s:
        c, m = await setup(s, "শুক্রবার বৌভাতে দাওয়াত, অবশ্যই আসবে", family=True)
        await wa_flow._process(s, m.id)
        titles = [t.title for t in (await s.execute(select(WaTask).where(WaTask.contact_id == c.id))).scalars().all()]
        assert ob.PRIVATE_TITLE in titles and not any("বৌভাত" in t for t in titles)


# -- owner's own AI questions: people's names leave only as placeholders --------------

def test_names_and_aliases_are_masked_for_the_owners_ai_questions():
    import contextvars

    from app.assistant import privacy, wa_ai

    def run():
        wa_ai._mask_names(SimpleNamespace(name="করিম মিয়া", profile={"aliases": ["করিম ভাই"]}), None)
        return privacy.pseudonymize("করিম মিয়া বলেছেন করিম ভাই কাল আসবেন")

    masked, mapping = contextvars.copy_context().run(run)
    assert "করিম" not in masked and set(mapping.values()) == {"করিম মিয়া", "করিম ভাই"}
    assert privacy.restore(masked, mapping) == "করিম মিয়া বলেছেন করিম ভাই কাল আসবেন"


# -- the phone app's own daily summary ----------------------------------------------

@pytest.mark.asyncio
async def test_app_digest_names_family_without_words_and_skips_when_nothing_waits(Session, monkeypatch):
    monkeypatch.setattr(alerts.telegram, "configured", lambda: False)
    async with Session() as s:
        assert await alerts.send_app_digest(s) is False  # nothing waiting, nothing due
        fam = WaContact(phone="sms:+8801711000101", channel="sms", name="আম্মা", category="personal", priority=1, mode="inherit", state="assistant",
                        is_vip=False, is_family=True, is_blocked=False, unread=2, need="শরীর ভালো না")
        biz = WaContact(phone="notif:whatsapp:করিম", channel="notif", name="করিম", category="business", priority=2, mode="inherit", state="assistant",
                        is_vip=False, is_family=False, is_blocked=False, unread=1, need="দাম জানতে চান")
        web = WaContact(phone="8801711000103", channel="whatsapp", name="ওয়েব", category="business", priority=1, mode="inherit", state="assistant",
                        is_vip=False, is_family=False, is_blocked=False, unread=1)
        s.add_all([fam, biz, web])
        await s.commit()
        assert await alerts.send_app_digest(s) is True
        body = (await s.execute(select(InboxCommand).where(InboxCommand.kind == "alert"))).scalars().one().body
        assert "২ জন" in body and "আম্মা" in body and "শরীর" not in body and "করিম: দাম জানতে চান" in body and "ওয়েব" not in body


# -- same-day deadlines (domain 14) -----------------------------------------------------

def test_a_work_ask_due_today_is_raised_to_priority_two_but_chat_is_not():
    assert brain.rule_priority("ডিজাইনটা আজকের মধ্যে লাগবে", cfg(), who(), "work", False) == (2, "deadline")
    assert brain.rule_priority("send the file asap", cfg(), who(), "work", False) == (2, "deadline")
    assert brain.rule_priority("আজকের মধ্যে দেখা হবে না মনে হয়", cfg(), who(), "other", False)[0] == 5  # not a work/money ask
    assert brain.rule_priority("জরুরি, আজকের মধ্যে লাগবে", cfg(), who(), "work", False) == (1, "urgent")  # urgent still wins


# -- AI connections: a broken key reaches the owner (no e-mail on this server) ---------

@pytest.mark.asyncio
async def test_ai_daily_check_tells_the_owner_on_the_phone_when_a_key_breaks(Session, monkeypatch):
    from app.assistant import ai_hub

    async def fake_load(db, force=False):
        ai_hub._state["conns"] = [{"id": "g1", "label": "Gemini", "provider": "gemini", "status": "ok", "enabled": True, "checked_at": ""}]

    async def fake_test_all(db, full=True):
        return [{"id": "g1", "label": "Gemini", "provider": "gemini", "status": "bad", "enabled": True}]

    monkeypatch.setattr(ai_hub, "_load", fake_load)
    monkeypatch.setattr(ai_hub, "test_all", fake_test_all)
    monkeypatch.setattr(alerts.telegram, "configured", lambda: False)
    async with Session() as s:
        out = await ai_hub.daily_check(s)
        body = (await s.execute(select(InboxCommand).where(InboxCommand.kind == "alert"))).scalars().one().body
    assert out["broken"] == 1 and "Gemini" in body and "কাজ করছে না" in body


# -- Telegram webhook replay (acceptance test 38) ----------------------------------------

@pytest.mark.asyncio
async def test_a_replayed_telegram_update_is_handled_only_once(Session, monkeypatch):
    import json as _json

    from app.api.v1.routes import inbox as ib

    calls = []

    async def fake_handle(db, update):
        calls.append(update["update_id"])
        return []

    async def fake_cfg(db, force=False, scope=None):
        return cfg(enabled=True, channels={"telegram": {"enabled": True}})

    monkeypatch.setattr(ib.telegram, "configured", lambda: True)
    monkeypatch.setattr(ib.telegram, "verify_secret", lambda s: True)
    monkeypatch.setattr(ib.telegram, "handle_update", fake_handle)
    monkeypatch.setattr(ib.wcfg, "load_config", fake_cfg)

    class Req:
        headers = {"x-telegram-bot-api-secret-token": "x"}

        def __init__(self, uid):
            self._b = _json.dumps({"update_id": uid, "message": {"text": "ঠিক আছে, কাল দেব"}}).encode()

        async def body(self):
            return self._b

    class Bg:
        def add_task(self, *a, **k):
            pass

    async with Session() as s:
        for uid in (501, 501, 502, 501):  # Telegram retried 501 twice
            assert await ib.telegram_webhook(Req(uid), Bg(), s) == {"ok": True}
    assert calls == [501, 502]


# -- F0: free words read by the AI, auto / manual switch -------------------------------------

def _f0_cfg(auto):
    async def fake_cfg(db, force=False, scope=None):
        return cfg(enabled=True, ai={"enabled": True, "voice": False}, f0={"auto_send": auto})
    return fake_cfg


async def _f0_person(s, name="করিম", channel="sms"):
    c = WaContact(phone=f"{channel}:+8801711000777", channel=channel, name=name, category="business", priority=5, mode="inherit", state="assistant",
                  is_vip=False, is_family=False, is_blocked=False, unread=0, last_inbound_at=datetime.now(timezone.utc))
    s.add(c)
    await s.commit()
    return c


@pytest.mark.asyncio
async def test_f0_free_words_are_read_by_the_ai_and_manual_mode_only_drafts(Session, monkeypatch):
    from app.assistant import ai_hub, f0

    async def fake_ai(db, task, system, user, **kw):
        return '{"intent": "reply", "name": "করিম", "msg": "কাল বিকেলে আসছি"}'

    monkeypatch.setattr(ai_hub, "run", fake_ai)
    monkeypatch.setattr(f0.wcfg, "load_config", _f0_cfg(False))
    async with Session() as s:
        c = await _f0_person(s)
        r = await f0.run(s, "করিম ভাইকে একটু জানিয়ে দাও কাল বিকেলে আসছি")
        assert r["intent"] == "reply" and r["draft"] and r["draft"]["body"] == "কাল বিকেলে আসছি"
        outs = (await s.execute(select(WaMessage).where(WaMessage.contact_id == c.id))).scalars().all()
        assert [m.status for m in outs] == ["draft"]  # manual: nothing goes out by itself


@pytest.mark.asyncio
async def test_f0_auto_mode_sends_at_once_but_a_warning_keeps_the_preview(Session, monkeypatch):
    from app.assistant import f0

    monkeypatch.setattr(f0.wcfg, "load_config", _f0_cfg(True))
    delivered = []

    async def fake_deliver(db, mid):
        m = await db.get(WaMessage, mid)
        m.status = "sending"
        await db.commit()
        delivered.append(mid)
        return True

    monkeypatch.setattr(f0.flow, "deliver", fake_deliver)
    async with Session() as s:
        await _f0_person(s)
        r = await f0.run(s, "করিমকে বলো কাল আসব")
        assert r["draft"] is None and r["sent"]["status"] == "sending" and len(delivered) == 1
        old = await _f0_person(s, name="জামাল", channel="whatsapp")  # WhatsApp, no inbound for 2 days: 24-hour warning
        old.last_inbound_at = datetime.now(timezone.utc) - timedelta(days=2)
        await s.commit()
        r2 = await f0.run(s, "জামালকে বলো কাল আসব")
        assert r2["draft"] and r2["draft"]["warnings"] and len(delivered) == 1 and "অটো-পাঠানো হয়নি" in r2["answer"]


@pytest.mark.asyncio
async def test_f0_without_ai_still_gives_the_help_text(Session, monkeypatch):
    from app.assistant import ai_hub, f0

    async def no_ai(db, *a, **k):
        raise ai_hub.HubError("x", "x", 503)

    monkeypatch.setattr(ai_hub, "run", no_ai)
    async with Session() as s:
        r = await f0.run(s, "এটা কোনো চেনা কথা না")
    assert r["intent"] == "unknown" and r["answer"] == f0.UNKNOWN_HELP
