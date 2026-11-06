"""Wave 0 fixes from the 2026-11-06 audit: OTP masking, private chats never reach the AI helper, lost messages are recovered once."""
import copy
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.assistant import privacy, wa_ai
from app.assistant import wa_config as wc
from app.assistant import wa_flow
from app.assistant.channels import alerts, ingest as ingest_mod
from app.models.models import ActivityLog, Setting
from app.models.wa import InboxCommand, InboxDevice, WaContact, WaMessage, WaNote, WaTask


# -- OTP masking (WP2c) -----------------------------------------------------------------

@pytest.mark.parametrize("raw,hidden", [
    ("Your OTP is 482913. Do not share it.", "482913"),
    ("আপনার ওটিপি কোড ৪৮২৯১৩, কাউকে বলবেন না", "৪৮২৯১৩"),
    ("Verification code: 123 456", "123 456"),
    ("Your PIN is 4821", "4821"),
    ("code 123-456 valid for 5 minutes", "123-456"),
])
def test_one_time_codes_are_hidden(raw, hidden):
    out, changed = privacy.mask_secrets(raw)
    assert changed and hidden not in out and privacy.MASK in out


@pytest.mark.parametrize("raw", [
    "bKash: Tk 5000 received from 01711000000",          # a code word is absent -> untouched
    "Your verification code is ready. Pay Tk 1500 by Friday",  # money is not a code
    "Meeting at 2026 sharp, bring the code files",       # no 4-8 digit run next to a secret word besides the year...
    "ভাই কাল ৩টায় আসবেন",
    "",
])
def test_normal_messages_and_money_are_left_alone(raw):
    out, changed = privacy.mask_secrets(raw)
    if raw.startswith("Meeting"):
        assert privacy.MASK in out  # documented limit: a 4-digit number beside the word 'code' is hidden (safe side)
    else:
        assert not changed and out == raw


def test_amounts_next_to_a_code_word_survive():
    out, changed = privacy.mask_secrets("OTP 482913 for payment of Tk 2500 and 3000 taka")
    assert "482913" not in out and "Tk 2500" in out and "3000 taka" in out and changed


# -- fixtures -----------------------------------------------------------------------------

@pytest_asyncio.fixture
async def Session():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        for model in (Setting, ActivityLog, WaContact, WaMessage, WaNote, WaTask, InboxDevice, InboxCommand):
            await conn.run_sync(model.__table__.create)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def person(s, name, phone, channel="sms", **kw):
    base = dict(phone=phone, channel=channel, name=name, category="business", priority=5, mode="inherit", state="assistant",
                is_vip=False, is_family=False, is_blocked=False, unread=0)
    c = WaContact(**{**base, **kw})
    s.add(c)
    await s.flush()
    return c


def patch_flow(monkeypatch, enabled=True):
    async def fake_cfg(db, force=False, scope=None):
        k = copy.deepcopy(wc.DEFAULT_CONFIG)
        k.update(enabled=enabled, ai={"enabled": False, "voice": False})
        return k

    async def fake_presence(db, c):
        return c

    async def fake_push(*a, **k):
        return True

    monkeypatch.setattr(wa_flow.wcfg, "load_config", fake_cfg)
    monkeypatch.setattr(wa_flow.presence, "apply", fake_presence)
    monkeypatch.setattr(alerts, "push_owner", fake_push)


@pytest.mark.asyncio
async def test_ingest_never_stores_a_code_and_remembers_that_it_hid_one(Session):
    async with Session() as s:
        mid = await ingest_mod.ingest(s, channel="sms", key="sms:+8801711000050", name="Bank", body="Your OTP is 482913. Do not share it.", ext_id="otp1")
        await s.commit()
        m = await s.get(WaMessage, mid)
        assert "482913" not in m.body and m.meta.get("masked") is True
        mid2 = await ingest_mod.ingest(s, channel="sms", key="sms:+8801711000051", name="Rahim", body="ভাই কাল ৩টায় আসবেন", ext_id="n1")
        await s.commit()
        assert (await s.get(WaMessage, mid2)).body == "ভাই কাল ৩টায় আসবেন" and "masked" not in (await s.get(WaMessage, mid2)).meta


# -- private chats never reach the AI helper (WP2a) ----------------------------------------

@pytest.mark.asyncio
async def test_the_ai_helper_never_gets_a_private_chats_words(Session, monkeypatch):
    seen = []

    async def fake_run(db, task, system, user, **k):
        seen.append(user)
        return "ঠিক আছে"

    async def fake_cfg(db, force=False, scope=None):
        return copy.deepcopy(wc.DEFAULT_CONFIG)

    monkeypatch.setattr(wa_ai.ai_hub, "run", fake_run)
    monkeypatch.setattr(wa_ai.wcfg, "load_config", fake_cfg)
    async with Session() as s:
        fam = await person(s, "আম্মা", "sms:+8801711000060", is_family=True, need="আম্মার অপারেশনের টাকা লাগবে")
        biz = await person(s, "রহিম", "sms:+8801711000061")
        biz.need = "লোগোর দাম জানতে চায়"
        for c, body in ((fam, "আম্মার অপারেশন কাল সকালে"), (biz, "ভাই লোগোর দামটা বলবেন")):
            s.add(WaMessage(contact_id=c.id, direction="in", channel="sms", kind="text", body=body, status="received", created_at=datetime.now(timezone.utc)))
            c.unread = 1
        await s.commit()

        # 1. 'ask' about the family chat: neither the thread nor the stored need reaches the AI
        await wa_ai.ask(s, "কাকে আগে উত্তর দেব?", fam.id)
        joined = " ".join(seen)
        assert "অপারেশন" not in joined and "ব্যক্তিগত/পরিবারের চ্যাট" in joined
        # 2. a business chat still gets full help
        seen.clear()
        await wa_ai.ask(s, "কাকে আগে উত্তর দেব?", biz.id)
        assert "লোগোর দামটা" in " ".join(seen)
        # 3. a reply draft for the family chat is refused before any AI call
        seen.clear()
        r = await wa_ai.suggest_reply(s, fam.id, "বলো কাল আসছি")
        assert r["text"] == "" and r["private"] is True and "নিজে লিখুন" in r["warning"] and seen == []
        # 4. and for the business chat it works
        r2 = await wa_ai.suggest_reply(s, biz.id, "বলো কাল জানাব")
        assert r2["text"] == "ঠিক আছে" and "private" not in r2 and seen


# -- lost messages are recovered once (WP1) -----------------------------------------------

def msg(c, body, mins_ago, **kw):
    return WaMessage(contact_id=c.id, direction="in", channel=kw.pop("channel", "sms"), kind="text", body=body, status=kw.pop("status", "received"),
                     created_at=datetime.now(timezone.utc) - timedelta(minutes=mins_ago), meta=kw.pop("meta", None))


@pytest.mark.asyncio
async def test_sweep_recovers_only_the_newest_lost_text_per_person_and_only_once(Session, monkeypatch):
    patch_flow(monkeypatch)
    async with Session() as s:
        a = await person(s, "রহিম", "sms:+8801711000070")
        b = await person(s, "করিম", "sms:+8801711000071")
        c = await person(s, "নাসির", "8801711000072", channel="whatsapp")
        d = await person(s, "জামাল", "sms:+8801711000073")
        old1, old2, newest = msg(a, "ভাই", 30), msg(a, "একটা কাজ ছিল", 29), msg(a, "ছবিটা পাঠান", 28)
        recent = msg(b, "এইমাত্র এসেছে", 1)                                  # too fresh: its own task may still be waiting
        handled = msg(b, "আগেই প্রক্রিয়া হয়েছে", 40, meta={"priority": 5})
        grouped = msg(b, "ব্যাচের অংশ", 41, meta={"grouped": True})
        imported = msg(d, "পুরোনো ইতিহাস", 50, status="imported")
        web = msg(c, "ওয়েবসাইটের WhatsApp", 30, channel="whatsapp")           # the website's own scope: not touched here
        old_call = msg(d, "[মিসড কল]", 35, meta={"call": True})
        s.add_all([old1, old2, newest, recent, handled, grouped, imported, web, old_call])
        await s.commit()

        n = await wa_flow.sweep_unprocessed(s, datetime.now(timezone.utc))
        for m in (old1, old2, newest, recent, handled, grouped, imported, web, old_call):
            await s.refresh(m)
        assert n == 2                                                          # the newest text of the first person + the missed call
        assert "priority" in newest.meta and "swept" in newest.meta            # processed
        assert "swept" in old1.meta and "priority" not in old1.meta and "swept" in old2.meta and "priority" not in old2.meta  # marked, not answered one by one
        assert "priority" in old_call.meta  # the lost missed call was analysed too
        for untouched in (recent, grouped, imported, web):
            assert "swept" not in (untouched.meta or {})
        assert await wa_flow.sweep_unprocessed(s, datetime.now(timezone.utc)) == 0  # nothing is ever handled twice


@pytest.mark.asyncio
async def test_sweep_does_nothing_while_the_assistant_is_off_and_ignores_old_history(Session, monkeypatch):
    patch_flow(monkeypatch, enabled=False)
    async with Session() as s:
        a = await person(s, "রহিম", "sms:+8801711000080")
        s.add_all([msg(a, "বন্ধ থাকলে নয়", 30), msg(a, "দুই ঘণ্টার পুরোনো", 200)])
        await s.commit()
        assert await wa_flow.sweep_unprocessed(s, datetime.now(timezone.utc)) == 0
    patch_flow(monkeypatch, enabled=True)
    async with Session() as s:
        assert await wa_flow.sweep_unprocessed(s, datetime.now(timezone.utc)) == 1  # only the 30-minute-old one; the 200-minute-old one is ignored


@pytest.mark.asyncio
async def test_a_message_skipped_by_the_grouping_wait_is_marked_so_the_sweep_leaves_it_alone(Session, monkeypatch):
    patch_flow(monkeypatch)

    async def no_sleep(_):
        return None

    monkeypatch.setattr(wa_flow, "AsyncSessionLocal", Session)
    monkeypatch.setattr(wa_flow.asyncio, "sleep", no_sleep)
    async with Session() as s:
        a = await person(s, "রহিম", "sms:+8801711000090")
        ms = [msg(a, "ভাই", 12), msg(a, "একটা কাজ", 11), msg(a, "ছবিটা পাঠান", 10)]
        s.add_all(ms)
        await s.commit()
        ids = [m.id for m in ms]
    results = [await wa_flow._group_gate(i) for i in ids]
    assert results == [False, False, True]
    async with Session() as s:
        got = [await s.get(WaMessage, i) for i in ids]
        assert got[0].meta.get("grouped") and got[1].meta.get("grouped") and not (got[2].meta or {}).get("grouped")
        # only the (not yet processed) last one is a candidate for the sweep
        assert await wa_flow.sweep_unprocessed(s, datetime.now(timezone.utc)) == 1
