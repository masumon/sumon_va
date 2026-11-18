"""Tests for pattern-aware AI & rule-based drafts in every chat (including family) + 'write another' & tone selection."""
import copy
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.assistant import ai_hub, draft_writer as dw, wa_ai, wa_config as wc
from app.models.models import ActivityLog, Setting
from app.models.wa import WaContact, WaMessage, WaNote, WaTask


@pytest_asyncio.fixture
async def Session():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        for model in (Setting, ActivityLog, WaContact, WaMessage, WaNote, WaTask):
            await conn.run_sync(model.__table__.create)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.mark.parametrize("msg,expected_kind", [
    ("ভাই জরুরী ফোন ধরেন", "urgent"),
    ("ইন্নালিল্লাহ, চাচা মারা গেছেন", "condolence"),
    ("আম্মার অনেক জ্বর, হাসপাতালে নিচ্ছি", "sick"),
    ("কেমন আছিস? খেয়েছিস?", "family_check"),
    ("অনেক ধন্যবাদ ভাই", "thanks"),
    ("দুঃখিত ভাই দেরি হয়ে গেল", "sorry"),
    ("কতদিন হয়ে গেল এখনো হয়নি কেন?", "complaint"),
    ("বিকাশে টাকা পাঠিয়েছি দেখেন", "money"),
    ("এই লোগোর দাম কত পড়বে?", "price"),
    ("কাজটা কবে পাব?", "when"),
    ("আপনার অফিসের ঠিকানা কোথায়?", "where"),
    ("কাজের কী অবস্থা ভাই?", "status"),
    ("ফাইলটা একটু পাঠান প্লিজ", "request"),
    ("কাল দেখা করব?", "meet"),
    ("আসসালামু আলাইকুম ভাই", "greeting"),
    ("এটা কি আজ খোলা?", "question"),
    ("ঠিক আছে বুঝলাম", "statement"),
    ("", "empty"),
])
def test_read_pattern_detects_message_intent(msg, expected_kind):
    p = dw.read_pattern(msg)
    assert p.kind == expected_kind and p.label and p.hint


def test_rule_draft_distinguishes_family_business_english_and_variants():
    pat = dw.read_pattern("কেমন আছিস? খেয়েছিস?")
    fam_d = dw.rule_draft(pat, "bn", address="আম্মু", family=True, variant=0)
    biz_d = dw.rule_draft(pat, "bn", address="রহিম ভাই", family=False, variant=0)
    en_d = dw.rule_draft(pat, "en", address="Rahim", family=False, variant=0)
    assert "তুমি" in fam_d and fam_d.startswith("আম্মু")
    assert "আপনি" in biz_d and biz_d.startswith("রহিম ভাই")
    assert "doing well" in en_d

    req_pat = dw.read_pattern("ফাইলটা পাঠান")
    v0 = dw.rule_draft(req_pat, "bn", family=False, variant=0)
    v1 = dw.rule_draft(req_pat, "bn", family=False, variant=1)
    v2 = dw.rule_draft(req_pat, "bn", family=False, variant=2)
    assert len({v0, v1, v2}) == 3  # variants genuinely differ


@pytest.mark.asyncio
async def test_suggest_reply_works_in_family_chat_masks_otp_and_uses_warm_prompt(Session, monkeypatch):
    seen_sys, seen_user = [], []

    async def fake_run(db, task, system, user, **k):
        seen_sys.append(system)
        seen_user.append(user)
        return '"আলহামদুলিল্লাহ ভালো আছি আম্মু, তুমি কেমন আছ?"'

    async def fake_cfg(db, force=False, scope=None):
        return copy.deepcopy(wc.DEFAULT_CONFIG)

    monkeypatch.setattr(wa_ai.ai_hub, "run", fake_run)
    monkeypatch.setattr(wa_ai.wcfg, "load_config", fake_cfg)
    async with Session() as s:
        fam = WaContact(phone="sms:+8801711000090", channel="sms", name="আম্মু", category="personal", is_family=True, profile={"address": "আম্মু"})
        s.add(fam)
        await s.flush()
        s.add(WaMessage(contact_id=fam.id, direction="in", channel="sms", body="কেমন আছিস? আমার OTP 482913 দিলাম", status="received", created_at=datetime.now(timezone.utc)))
        await s.commit()

        r = await wa_ai.suggest_reply(s, fam.id, tone="warm")
        assert r["private"] is True and "পারিবারিক" in r["note"]
        assert r["source"] == "ai" and r["pattern"] == "খোঁজখবর নিচ্ছে"
        assert r["text"] == "আলহামদুলিল্লাহ ভালো আছি আম্মু, তুমি কেমন আছ?"  # quotes stripped
        assert "482913" not in seen_user[0]  # OTP masked before reaching AI
        assert "পরিবারের মানুষ" in seen_sys[0] and "আন্তরিক" in seen_user[0]


@pytest.mark.asyncio
async def test_suggest_reply_another_avoids_repeats_and_falls_back_when_ai_offline(Session, monkeypatch):
    async def fake_cfg(db, force=False, scope=None):
        return copy.deepcopy(wc.DEFAULT_CONFIG)

    monkeypatch.setattr(wa_ai.wcfg, "load_config", fake_cfg)

    async with Session() as s:
        biz = WaContact(phone="sms:+8801711000091", channel="sms", name="রহিম", category="business")
        s.add(biz)
        await s.flush()
        s.add(WaMessage(contact_id=biz.id, direction="in", channel="sms", body="কাজটা কবে পাব?", status="received", created_at=datetime.now(timezone.utc)))
        await s.commit()

        # 1. AI repeats the exact rejected draft -> server switches to a fresh rule-based alternative
        async def repeat_ai(db, task, system, user, **k):
            return "সময়টা দেখে জানাচ্ছি।"

        monkeypatch.setattr(wa_ai.ai_hub, "run", repeat_ai)
        r_dup = await wa_ai.suggest_reply(s, biz.id, avoid=["সময়টা দেখে জানাচ্ছি।"], variant=1)
        assert r_dup["source"] == "rules" and r_dup["text"] != "সময়টা দেখে জানাচ্ছি।" and r_dup["pattern"] == "সময়/তারিখ জানতে চাইছে"

        # 2. AI is completely unavailable -> safe rule-based draft still returned (never blank)
        async def down_ai(db, *a, **k):
            raise ai_hub.HubError("AI বন্ধ", "no ai", 503)

        monkeypatch.setattr(wa_ai.ai_hub, "run", down_ai)
        r_off = await wa_ai.suggest_reply(s, biz.id, variant=0)
        assert r_off["source"] == "rules" and len(r_off["text"]) > 5 and "AI এখন পাওয়া যাচ্ছে না" in r_off["warning"]
        r_off2 = await wa_ai.suggest_reply(s, biz.id, avoid=[r_off["text"]], variant=1)
        assert r_off2["text"] != r_off["text"]


@pytest.mark.asyncio
async def test_suggest_reply_warns_when_ai_invents_unmentioned_money(Session, monkeypatch):
    async def fake_cfg(db, force=False, scope=None):
        return copy.deepcopy(wc.DEFAULT_CONFIG)

    async def hallucinate_price(db, task, system, user, **k):
        return "এটার দাম ৫০০০ টাকা পড়বে।"

    monkeypatch.setattr(wa_ai.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(wa_ai.ai_hub, "run", hallucinate_price)
    async with Session() as s:
        biz = WaContact(phone="sms:+8801711000092", channel="sms", name="করিম", category="business")
        s.add(biz)
        await s.flush()
        s.add(WaMessage(contact_id=biz.id, direction="in", channel="sms", body="দাম কত হবে?", status="received", created_at=datetime.now(timezone.utc)))
        await s.commit()

        r = await wa_ai.suggest_reply(s, biz.id)
        assert r["text"] == "এটার দাম ৫০০০ টাকা পড়বে।" and "টাকা বা সংখ্যার" in r["warning"]
