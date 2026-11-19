"""Super-Premium Master Plan tests (2026-11-19):
1. Missed Call Tactical Engine (VIP/business context-aware reply + callback task, stranger 1st vs 2nd call, already answered, family guard)
2. VIP & Official Tactical Auto-Reply + Undated Official Task Creation + Media Acknowledgment
3. Presence Sensor Gate (is_owner_holding_phone -> switches auto to draft while holding phone)
4. Owner's Personal Second WhatsApp Relay (owner_whatsapp config, F0 command, InboxCommand kind='owner_wa')
5. Full-Context AI Secretary Bot (F0 unknown question -> wa_ai.ask) & Multi-Modal Video/Photo/Voice Analysis
"""
import base64
import copy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.api.v1.routes import wa_assistant as wa
from app.assistant import ai_hub, f0, presence
from app.assistant import call_context as cc
from app.assistant import wa_brain as brain
from app.assistant import wa_config as wc
from app.assistant import wa_flow
from app.assistant.channels import alerts, telegram
from app.core.config import settings
from app.models.models import ActivityLog, Setting
from app.models.wa import InboxCommand, InboxDevice, WaContact, WaMessage, WaNote, WaTask

NOW = datetime(2026, 11, 19, 10, 0, tzinfo=timezone.utc)


def make_cfg(**over):
    c = copy.deepcopy(wc.DEFAULT_CONFIG)
    c["ai"]["enabled"] = False
    c.update(over)
    return c


def make_contact(**over):
    base = dict(
        name="রহিম ট্রেডার্স",
        phone="sms:+8801711000111",
        channel="sms",
        category="business",
        is_vip=False,
        is_family=False,
        is_blocked=False,
        mode="inherit",
        state="assistant",
        hold_until=None,
        lang="bn",
        tags=[],
        profile={},
    )
    base.update(over)
    return SimpleNamespace(**base)


@pytest_asyncio.fixture
async def Session():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        for model in (Setting, ActivityLog, WaContact, WaMessage, WaNote, WaTask, InboxDevice, InboxCommand):
            await conn.run_sync(model.__table__.create)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


# ── 1. Missed Call Tactical Engine ────────────────────────────────────────────

def test_missed_call_tactical_reply_for_business_and_vip_with_context():
    c = make_cfg(status={"key": "meeting", "until": None, "custom": "মিটিংয়ে আছেন"})
    who = make_contact(is_vip=True)
    recent = [{"id": "m1", "direction": "in", "body": "ভাই পেমেন্টের কী হলো?", "status": "received", "reason": None, "created_at": NOW - timedelta(minutes=15), "meta": {}}]
    tasks = [{"title": "ইনভয়েস চেক করা", "due_at": NOW + timedelta(hours=2)}]
    ins = cc.analyze(c, who, recent, tasks, NOW, 2)
    d = brain.Decision(priority=2, lang="bn")
    assert cc.apply(d, ins, c, contact=who, status=brain.current_status(c, NOW))
    assert d.reply is not None
    assert "কলটি এসেছে" in d.reply and "মিটিংয়ে" in d.reply and "কাজের বিষয়টি" in d.reply
    assert any("কলব্যাক" in t["title"] for t in d.tasks)


def test_missed_call_stranger_first_silent_second_tactical_inquiry():
    c = make_cfg()
    stranger = make_contact(name="", category=None, is_vip=False)
    # 1st lone call from stranger: stays quiet, no auto-reply
    ins1 = cc.analyze(c, stranger, [], [], NOW, 5)
    d1 = brain.Decision(priority=5, lang="bn")
    cc.apply(d1, ins1, c, contact=stranger)
    assert d1.reply is None

    # 2nd call in burst from stranger: asks politely who is calling and why
    call1 = {"id": "c1", "direction": "in", "body": cc.MISSED_TEXT, "status": "received", "reason": None, "created_at": NOW - timedelta(minutes=2), "meta": {"call": True}}
    ins2 = cc.analyze(c, stranger, [call1], [], NOW, 5)
    d2 = brain.Decision(priority=5, lang="bn")
    cc.apply(d2, ins2, c, contact=stranger)
    assert d2.reply is not None and "কে বলছেন" in d2.reply
    assert any("কলব্যাক" in t["title"] for t in d2.tasks)


def test_missed_call_skips_reply_when_owner_already_answered_or_family():
    c = make_cfg()
    who = make_contact()
    recent = [
        {"id": "o1", "direction": "out", "body": "দেখছি ভাই", "status": "sent", "reason": "owner", "created_at": NOW - timedelta(minutes=2), "meta": {}},
        {"id": "i1", "direction": "in", "body": "কাজটা হয়েছে?", "status": "received", "reason": None, "created_at": NOW - timedelta(minutes=10), "meta": {}},
    ]
    ins = cc.analyze(c, who, recent, [], NOW, 3)
    d = brain.Decision(priority=3, lang="bn")
    cc.apply(d, ins, c, contact=who)
    assert d.reply is None  # owner already answered

    fam = make_contact(is_family=True, category="personal")
    ins_fam = cc.analyze(c, fam, [], [], NOW, 2)
    d_fam = brain.Decision(priority=2, lang="bn")
    cc.apply(d_fam, ins_fam, c, contact=fam)
    assert d_fam.reply is None  # family never gets robotic call text by default


# ── 2. VIP & Official Tactical Reply + Undated Official Task + Media Ack ─────

@pytest.mark.asyncio
async def test_undated_official_notice_creates_proposed_task_and_tactical_reply(Session, monkeypatch):
    async def fake_cfg(db, force=False, scope=None):
        return make_cfg(enabled=True)

    async def fake_presence(db, c):
        return c

    async def fake_push(*a, **k):
        return True

    monkeypatch.setattr(wa_flow.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(wa_flow.presence, "apply", fake_presence)
    monkeypatch.setattr(alerts, "push_owner", fake_push)

    async with Session() as s:
        c = WaContact(phone="sms:+8801711000222", channel="sms", name="ব্যাংক অফিস", category="business", priority=5, mode="inherit", state="assistant", is_vip=True, is_family=False, is_blocked=False, unread=0)
        s.add(c)
        await s.flush()
        # No date mentioned in the official notice
        m = WaMessage(contact_id=c.id, direction="in", channel="sms", kind="text", body="আপনার ব্যাংক হিসাব ও ট্রেড লাইসেন্সের কাগজপত্র যাচাই প্রয়োজন", status="received", created_at=NOW)
        s.add(m)
        await s.commit()
        await wa_flow._process(s, m.id)

        tasks = (await s.execute(select(WaTask).where(WaTask.contact_id == c.id))).scalars().all()
        assert tasks and any("দাপ্তরিক" in t.title for t in tasks)
        outs = (await s.execute(select(WaMessage).where(WaMessage.contact_id == c.id, WaMessage.direction == "out"))).scalars().all()
        assert len(outs) == 1 and "দাপ্তরিক বার্তাটি গুরুত্বের সাথে" in outs[0].body


@pytest.mark.asyncio
async def test_media_notification_without_transcript_gets_polite_media_ack():
    d = await brain.decide(None, make_cfg(), make_contact(), "[ভিডিও]", "video", None, [], [], NOW)
    assert d.reason == "media_ack" and d.notify and "ভিডিওটি পেয়েছি" in (d.reply or "")


# ── 3. Presence Sensor Gate (Phone in Hand -> Draft Instead of Auto) ─────────

def test_presence_holding_phone_switches_auto_to_draft():
    p_active = {"at": NOW.isoformat(), "screen_on": True, "touched_at": (NOW - timedelta(seconds=30)).isoformat()}
    p_idle = {"at": NOW.isoformat(), "screen_on": False, "touched_at": (NOW - timedelta(minutes=10)).isoformat()}
    assert presence.is_owner_holding_phone(p_active, NOW) is True
    assert presence.is_owner_holding_phone(p_idle, NOW) is False

    who = make_contact(channel="telegram", phone="tg:100")
    c = make_cfg(mode="auto")
    c["channels"]["telegram"].update(enabled=True, auto=True)
    assert wa_flow.effective_mode(c, who) == "auto"

    c_holding = {**c, "_presence": presence.hint(p_active, c, NOW)}
    mode, why = wa_flow.explain_mode(c_holding, who)
    assert mode == "draft" and "ফোন এখন আপনার হাতে সচল" in why


# ── 4. Owner's Personal Second WhatsApp Relay ─────────────────────────────────

@pytest.mark.asyncio
async def test_f0_set_owner_whatsapp_and_alert_relay(Session):
    parsed = f0.parse("আমার আপডেট নম্বর ০১৭১১-২২৩৩৪৪")
    assert parsed["intent"] == "set_owner_wa" and parsed["msg"] == "01711223344"

    async with Session() as s:
        res = await f0.run(s, "আমার দ্বিতীয় হোয়াটসঅ্যাপ 01819001122", NOW)
        assert res["intent"] == "set_owner_wa" and "০১৮১৯০০১১২২" in res["answer"]
        saved_cfg = await wc.load_config(s, force=True, scope="app")
        assert saved_cfg["owner_whatsapp"] == "01819001122"

        contact = WaContact(phone="sms:+8801711000333", channel="sms", name="জরুরি ক্লায়েন্ট", category="business", is_family=False, is_vip=True)
        s.add(contact)
        await s.flush()
        d = brain.Decision(priority=1, summary="জরুরি পেমেন্ট ইস্যু", notify=True)
        assert await alerts.push_owner(s, saved_cfg, contact, d) is True
        cmds = (await s.execute(select(InboxCommand).where(InboxCommand.kind == "owner_wa"))).scalars().all()
        assert len(cmds) == 1 and cmds[0].target == "01819001122" and "জরুরি ক্লায়েন্ট" in cmds[0].body


# ── 5. Full-Context AI Secretary Bot & Multi-Modal Media (`video/*`) ─────────

@pytest.mark.asyncio
async def test_f0_open_question_delegates_to_wa_ai_ask(Session, monkeypatch):
    async def fake_ai_parse(db, text):
        return None

    async def fake_ask(db, q, contact_id=None):
        return f"পরামর্শ: আগে জরুরি ক্লায়েন্টের উত্তর দিন ({q})"

    monkeypatch.setattr(f0, "ai_parse", fake_ai_parse)
    from app.assistant import wa_ai
    monkeypatch.setattr(wa_ai, "ask", fake_ask)

    async with Session() as s:
        res = await f0.run(s, "আজকে কোন কাজটা আগে করলে সবচেয়ে ভালো হবে?", NOW)
        assert res["intent"] == "ai_answer"
        assert "পরামর্শ: আগে জরুরি ক্লায়েন্টের উত্তর দিন" in res["answer"]


@pytest.mark.asyncio
async def test_analyze_media_accepts_video_and_returns_suggested_reply(monkeypatch):
    async def fake_run(db, task, system, user, *, images=None, **kw):
        return "ভিডিওতে দেখা যাচ্ছে দোকানের নতুন সাইনবোর্ড লাগানো হয়েছে, দাম জানতে চেয়েছেন।"

    monkeypatch.setattr(ai_hub, "run", fake_run)
    payload = wa.AnalyzeMediaIn(mime="video/mp4", data_b64=base64.b64encode(b"fake-mp4-video").decode(), name="clip.mp4")
    res = await wa.analyze_media(payload, db=None, _a="dev")
    assert res.data["ok"] is True
    assert res.data["kind"] == "video"
    assert "সাইনবোর্ড" in res.data["summary"]
    assert res.data["suggested_reply"] and res.data["pattern"]


@pytest.mark.asyncio
async def test_telegram_owner_photo_and_video_analysis(monkeypatch):
    sent = []

    async def fake_send(chat_id, text, **kw):
        sent.append(text)
        return "1"

    async def fake_fetch(file_id):
        return ("image/jpeg", b"fake-img")

    async def fake_run(db, task, system, user, *, images=None, **kw):
        return "রসিদে ৫,০০০ টাকা জমা দেওয়ার তথ্য আছে।"

    monkeypatch.setattr(telegram, "send_text", fake_send)
    monkeypatch.setattr(telegram, "fetch_file", fake_fetch)
    monkeypatch.setattr(ai_hub, "run", fake_run)
    monkeypatch.setattr(settings, "TELEGRAM_OWNER_ID", "999")

    kind, body, meta = telegram._content({"photo": [{"file_id": "p1"}, {"file_id": "p2"}], "caption": "রসিদ দেখুন"})
    assert kind == "image" and body == "রসিদ দেখুন" and meta["file_id"] == "p2"

    await telegram.handle_update(None, {"message": {"chat": {"id": 999}, "from": {"id": 999}, "photo": [{"file_id": "p2"}], "message_id": 10, "date": 1}})
    assert len(sent) == 1 and "৫,০০০ টাকা" in sent[0] and "প্রস্তাবিত কৌশলী উত্তর" in sent[0]
