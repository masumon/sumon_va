"""Comprehensive tests for F0 NLP upgrades, phonetic/alias resolution, owner write intents (remember/add_task), and multi-source search."""
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.assistant import f0
from app.models.models import ActivityLog, Setting
from app.models.wa import InboxCommand, InboxDevice, WaContact, WaMessage, WaNote, WaTask


@pytest_asyncio.fixture
async def Session():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        for model in (Setting, ActivityLog, WaContact, WaMessage, WaNote, WaTask, InboxDevice, InboxCommand):
            await conn.run_sync(model.__table__.create)
        await conn.execute(text("ALTER TABLE wa_contacts ADD COLUMN person_id CHAR(32)"))
    yield async_sessionmaker(engine, expire_on_commit=False), engine
    await engine.dispose()


async def _person(s, name="রহিম", phone="sms:+8801711000010", channel="sms", **kw):
    fields = {
        "phone": phone,
        "channel": channel,
        "name": name,
        "category": "business",
        "priority": 5,
        "mode": "inherit",
        "state": "assistant",
        "is_vip": False,
        "is_family": False,
        "is_blocked": False,
        "unread": 0,
    }
    fields.update(kw)
    c = WaContact(**fields)
    s.add(c)
    await s.flush()
    return c


@pytest.mark.parametrize("text_cmd,intent", [
    ("rahim ke bolo kal asbo", "reply"),
    ("জরুরী কি আছে", "alerts"),
    ("kar uttor baki", "pending"),
    ("amar kaj ki", "tasks"),
    ("khosra dekhao", "drafts"),
    ("খুঁজে দাও টাকা", "search"),
    ("sohokarir obostha ki", "system"),
    ("রহিম সম্পর্কে মনে রাখো সে মিরপুরে থাকে", "remember"),
    ("কাজ যোগ করো কাল রহিমকে ফোন দিতে হবে", "add_task"),
    ("মনে করিয়ে দিও কাল বিকালে মিটিং", "add_task"),
])
def test_f0_parse_banglish_variants_and_write_intents(text_cmd, intent):
    p = f0.parse(text_cmd)
    assert p["intent"] == intent


@pytest.mark.asyncio
async def test_f0_resolve_phonetic_token_alias_phone_and_disambiguation(Session):
    Sess, _ = Session
    async with Sess() as s:
        abdur = await _person(s, name="Md Abdur Rahim", phone="sms:+8801711009999", profile={"aliases": ["বড় ভাই"]})
        await s.commit()

        r1 = await f0.run(s, "রহিমকে বলো ঠিক আছে")
        assert r1["draft"] is not None and r1["draft"]["body"] == "ঠিক আছে"

        # Clear draft to test alias resolution cleanly
        r_alias = await f0.run(s, "বড় ভাইকে বলো আসছি")
        assert r_alias["draft"] is not None and "Md Abdur Rahim" in r_alias["draft"]["to"]

        # Phone suffix resolution
        by_phone, choices_phone = await f0.resolve(s, "01711009999", None)
        assert len(by_phone) == 1 and by_phone[0].id == abdur.id and choices_phone == []

        # Cross-script Banglish -> Bangla contact resolution
        await _person(s, name="করিম", phone="sms:+8801811001111")
        await s.commit()
        r_banglish = await f0.run(s, "korim ke bolo kal dekha hobe")
        assert r_banglish["draft"] is not None and "করিম" in r_banglish["draft"]["to"]

        # Ambiguity: adding second Rahim must trigger choices and create NO draft
        await _person(s, name="Rahim Mia", phone="sms:+8801911002222")
        await s.commit()
        before_drafts = len((await s.execute(select(WaMessage).where(WaMessage.status == "draft"))).scalars().all())
        r_amb = await f0.run(s, "রহিমকে বলো নতুন কথা")
        after_drafts = len((await s.execute(select(WaMessage).where(WaMessage.status == "draft"))).scalars().all())
        assert r_amb["draft"] is None and len(r_amb["choices"]) == 2
        assert after_drafts == before_drafts


@pytest.mark.asyncio
async def test_f0_remember_saves_seals_private_and_localizes_confidence(Session):
    Sess, _ = Session
    async with Sess() as s:
        biz = await _person(s, name="সজীব", phone="sms:+8801711000040")
        priv = await _person(s, name="আম্মু", phone="sms:+8801711000041", category="personal", is_family=True)
        await s.commit()

        r1 = await f0.run(s, "সজীব সম্পর্কে মনে রাখো সে মিরপুরে থাকে")
        assert r1["intent"] == "remember" and "মনে রাখা হয়েছে" in r1["answer"]
        r1_dup = await f0.run(s, "সজীব সম্পর্কে মনে রাখো সে মিরপুরে থাকে")
        assert "আগেই আছে" in r1_dup["answer"]

        r2 = await f0.run(s, "আম্মু সম্পর্কে মনে রাখো সকাল ৮টায় ওষুধ")
        assert r2["intent"] == "remember" and "মনে রাখা হয়েছে" in r2["answer"]
        await s.refresh(biz)
        await s.refresh(priv)
        assert priv.profile["facts"][0]["text"].startswith("enc1:")
        assert "ওষুধ" not in priv.profile["facts"][0]["text"]

        mem_priv = await f0.run(s, "আম্মু সম্পর্কে কী জানো")
        assert mem_priv["items"] and mem_priv["items"][0]["title"] == "সকাল ৮টায় ওষুধ"
        assert "আস্থা নিশ্চিত" in mem_priv["items"][0]["subtitle"]
        assert "high" not in mem_priv["items"][0]["subtitle"]


@pytest.mark.asyncio
async def test_f0_add_task_with_optional_due_date_and_dedupe(Session):
    Sess, _ = Session
    now = datetime(2026, 11, 19, 10, 0, tzinfo=timezone.utc)
    async with Sess() as s:
        r_dated = await f0.run(s, "কাজ যোগ করো কাল বিকালে রহিমকে ফোন দিতে হবে", now=now)
        assert r_dated["intent"] == "add_task" and "কাজ যোগ করা হয়েছে" in r_dated["answer"]

        r_undated = await f0.run(s, "কাজ যোগ করো ইন্টারনেট বিল দেওয়া", now=now)
        assert r_undated["intent"] == "add_task" and "কাজ যোগ করা হয়েছে" in r_undated["answer"]

        r_dup = await f0.run(s, "কাজ যোগ করো ইন্টারনেট বিল দেওয়া", now=now)
        assert "আগেই তালিকায় আছে" in r_dup["answer"]

        tasks = (await s.execute(select(WaTask))).scalars().all()
        assert len(tasks) == 2
        by_title = {t.title: t for t in tasks}
        assert by_title["কাল বিকালে রহিমকে ফোন দিতে হবে"].due_at is not None
        assert by_title["কাল বিকালে রহিমকে ফোন দিতে হবে"].source == "manual"
        assert by_title["ইন্টারনেট বিল দেওয়া"].due_at is None


@pytest.mark.asyncio
async def test_f0_multisource_search_and_private_exclusion(Session):
    Sess, _ = Session
    async with Sess() as s:
        biz = await _person(
            s,
            name="তানভীর",
            phone="sms:+8801711000050",
            profile={"facts": [{"id": "f1", "text": "মিরপুর প্রজেক্ট ক্রেতা", "confidence": "high", "provenance": "owner", "status": "active"}]},
        )
        priv = await _person(
            s,
            name="বোন",
            phone="sms:+8801711000051",
            category="personal",
            is_family=True,
            profile={"facts": [{"id": "f2", "text": "মিরপুর বাসার চাবি", "confidence": "high", "provenance": "owner", "status": "active"}]},
        )
        await s.flush()
        s.add_all([
            WaMessage(contact_id=biz.id, direction="in", channel="whatsapp", kind="audio", body="[ভয়েস]", transcript="মিরপুর রোডে দেখা হবে", status="received"),
            WaMessage(contact_id=biz.id, direction="in", channel="whatsapp", kind="text", body="গত মাসের মিরপুর চালান", status="imported"),
            WaMessage(contact_id=priv.id, direction="in", channel="whatsapp", kind="text", body="মিরপুর গোপন কথা", status="received"),
            WaNote(contact_id=biz.id, text="মিরপুর ডেলিভারি শুক্রবার", is_active=True),
            WaNote(contact_id=priv.id, text="মিরপুর পরিবারের নোট", is_active=True),
            WaTask(contact_id=biz.id, title="মিরপুর বিল পাঠানো", is_done=False, source="manual"),
            WaTask(contact_id=priv.id, title="মিরপুর পরিবারের কাজ", is_done=False, source="manual"),
        ])
        await s.commit()

        res = await f0.run(s, "খুঁজো মিরপুর")
        titles = [it["title"] for it in res["items"]]
        subtitles = [it["subtitle"] for it in res["items"]]

        assert any("মিরপুর রোডে দেখা হবে" in t for t in titles)
        assert any("গত মাসের মিরপুর চালান" in t for t in titles)
        assert any("মিরপুর প্রজেক্ট ক্রেতা" in t for t in titles)
        assert any("মিরপুর ডেলিভারি শুক্রবার" in t for t in titles)
        assert any("মিরপুর বিল পাঠানো" in t for t in titles)
        assert any("ভয়েস" in sub for sub in subtitles)
        assert any("ইমপোর্ট" in sub for sub in subtitles)
        assert any("স্মৃতি" in sub for sub in subtitles)
        assert any("নোট" in sub for sub in subtitles)
        assert any("কাজ" in sub for sub in subtitles)

        # Private/family items must NEVER leak into search results
        joined = " ".join(titles)
        assert "গোপন কথা" not in joined
        assert "বাসার চাবি" not in joined
        assert "পরিবারের নোট" not in joined
        assert "পরিবারের কাজ" not in joined


@pytest.mark.asyncio
async def test_f0_subtitles_use_bangla_digits(Session):
    Sess, _ = Session
    now = datetime(2026, 11, 19, 10, 0, tzinfo=timezone.utc)
    async with Sess() as s:
        c = await _person(s, name="হাবিব", phone="sms:+8801711000060", unread=2, priority=1)
        s.add(WaMessage(contact_id=c.id, direction="in", channel="sms", kind="text", body="[মিসড কল]", status="received", meta={"call": True}, created_at=now - timedelta(minutes=10)))
        await s.commit()

        alerts_res = await f0.run(s, "জরুরী", now=now)
        assert alerts_res["items"] and "২টি অপঠিত" in alerts_res["items"][0]["subtitle"]
        assert "2" not in alerts_res["items"][0]["subtitle"]

        calls_res = await f0.run(s, "মিসড কল", now=now)
        assert calls_res["items"] and "১টি মিসড কল" in calls_res["items"][0]["subtitle"]
