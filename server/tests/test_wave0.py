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


def test_wp2b_guard_blocks_invented_promises():
    from app.assistant.wa_brain import guard_text

    assert guard_text("আজই পাঠিয়ে দেব।", "আপনার বার্তা পেয়েছি।") is None
    assert guard_text("I will send it by tomorrow.", "We got your message.") is None
    assert guard_text("কালকের মধ্যে হয়ে যাবে", "") is None
    # a promise already present in the allowed facts is not invented
    assert guard_text("কালকের মধ্যে হয়ে যাবে", "কালকের মধ্যে হয়ে যাবে") is not None
    assert guard_text("আপনার বার্তা পেয়েছি, দেখে জানাচ্ছি।", "") is not None


@pytest.mark.asyncio
async def test_wp3_held_alert_is_recorded_and_summarised(monkeypatch):
    """A quiet-time / over-cap alert is not silently lost: recorded with a reason, then summarised once."""
    from app.assistant.channels import alerts
    from app.assistant import wa_flow as flow

    store: dict[str, str] = {}

    async def get(db, key):
        return store.get(key, "")

    async def put(db, key, val):
        store[key] = val

    class DB:
        def add(self, o): self.added = getattr(self, "added", []) + [o]
        async def commit(self): pass

    monkeypatch.setattr(flow, "_get_val", get)
    monkeypatch.setattr(flow, "_set_val", put)
    db = DB()
    await alerts._record_held(db, "রহিম", 2, "নীরব সময়")
    await alerts._record_held(db, "করিম", 2, "নীরব সময়")
    held = await alerts.held_alerts(db)
    assert [h["who"] for h in held] == ["রহিম", "করিম"] and held[0]["why"] == "নীরব সময়"
    cfg = {"limits": {"quiet_from": "23:00", "quiet_to": "07:00"}}
    monkeypatch.setattr(alerts, "in_quiet_hours", lambda l, n: True)
    assert await alerts.send_held_digest(db, cfg) == 0  # still quiet: keep holding
    monkeypatch.setattr(alerts, "in_quiet_hours", lambda l, n: False)
    assert await alerts.send_held_digest(db, cfg) == 2
    assert await alerts.held_alerts(db) == []  # told once, not repeated
    assert "রহিম" in db.added[-1].body


def test_wp2d_pseudonymize_round_trip():
    from app.assistant import privacy

    text = "আমার নম্বর 01712345678, মেইল rahim@example.com, হিসাব 123456789012, 5 টি পণ্য"
    masked, mp = privacy.pseudonymize(text)
    assert "01712345678" not in masked and "rahim@example.com" not in masked and "123456789012" not in masked
    assert "5 টি পণ্য" in masked  # ordinary short numbers stay
    assert privacy.restore(masked, mp) == text
    same, _ = privacy.pseudonymize("01712345678 আবার 01712345678")
    assert same.count("[PHONE_1]") == 2


@pytest.mark.asyncio
async def test_wp2d_hub_sends_placeholders(monkeypatch):
    from app.assistant import ai_hub

    seen = {}

    async def fake_call(conn, model, system, user, **kw):
        seen["user"], seen["system"] = user, system
        return "ঠিক আছে [PHONE_1]"

    async def noop(*a, **k): return None

    monkeypatch.setattr(ai_hub, "_load", noop)
    monkeypatch.setattr(ai_hub, "_flush_stats", noop)
    monkeypatch.setattr(ai_hub, "_record", lambda *a, **k: None)
    monkeypatch.setattr(ai_hub, "_candidates", lambda task, vis: [({"id": "c", "label": "x", "tier": "free"}, {"id": "m"})])
    monkeypatch.setattr(ai_hub, "_call", fake_call)
    out = await ai_hub.run(None, "chat", "sys", "ফোন 01712345678")
    assert "01712345678" not in seen["user"] and "[PHONE_1]" in seen["user"] and "placeholders" in seen["system"]
    assert out == "ঠিক আছে 01712345678"


def test_wp23_client_ip_not_forgeable():
    from starlette.requests import Request
    from app.core.rate_limit import client_ip

    def req(headers, host="10.0.0.1"):
        return Request({"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()], "client": (host, 1)})

    # direct hit on the server address with a forged header: the header is ignored
    assert client_ip(req({"X-Forwarded-For": "9.9.9.9, 5.6.7.8", "CF-Connecting-IP": "1.2.3.4"})) == "5.6.7.8"
    # through Cloudflare: its edge is the last hop, so the real visitor header is believed
    assert client_ip(req({"X-Forwarded-For": "1.2.3.4, 172.68.1.1", "CF-Connecting-IP": "1.2.3.4"})) == "1.2.3.4"
    # no proxy headers at all: the socket address
    assert client_ip(req({}, host="7.7.7.7")) == "7.7.7.7"


@pytest.mark.asyncio
async def test_wp23_custom_ai_address_must_be_https(monkeypatch):
    from app.assistant import ai_hub

    async def noop(*a, **k): return None

    monkeypatch.setattr(ai_hub, "_load", noop)
    with pytest.raises(ai_hub.HubError):
        await ai_hub.add(None, "", "custom", "http://evil.example/v1", "", "x")
    with pytest.raises(ai_hub.HubError):
        await ai_hub.add(None, "", "custom", "file:///etc", "", "x")


@pytest.mark.asyncio
async def test_wp12_unconfirmed_sms_fails_honestly_not_resent(Session):
    from app.assistant.wa_flow import expire_unconfirmed_sms, utcnow

    async with Session() as db:
        contact = WaContact(phone="sms:+8801711000000", name="রহিম", channel="sms")
        db.add(contact)
        await db.flush()
        msg = WaMessage(contact_id=contact.id, direction="out", body="hi", status="sending")
        db.add(msg)
        await db.flush()
        old = InboxCommand(device_id=None, kind="sms", target="+8801711000000", body="hi", msg_id=msg.id, status="fetched")
        old.created_at = utcnow() - timedelta(minutes=30)
        fresh = InboxCommand(device_id=None, kind="sms", target="+8801711000001", body="x", status="fetched")
        db.add_all([old, fresh])
        await db.commit()
        assert await expire_unconfirmed_sms(db, utcnow()) == 1
        await db.refresh(old); await db.refresh(msg); await db.refresh(fresh)
        assert old.status == "failed" and msg.status == "failed" and "আবার পাঠানো হয়নি" in msg.error
        assert fresh.status == "fetched"  # the recent one is still waiting for the phone's confirmation


# -- part 2: name matching (WP15) -------------------------------------------------------

@pytest.mark.parametrize("a,b", [("Rahim", "রহিম"), ("Rohim", "রহীম ভাই"), ("Md. Karim", "করিম"), ("Abdul Karim", "আব্দুল করিম"), ("Shumon", "সুমন")])
def test_wp15_same_name_other_spelling_or_script(a, b):
    from app.assistant import names

    assert names.name_key(a) == names.name_key(b) and names.similar(a, b)


@pytest.mark.parametrize("a,b", [("Rahim", "Karim"), ("রহিম", "করিম"), ("Rahim Uddin", "Rahim Ahmed"), ("😀", "123")])
def test_wp15_different_people_stay_apart(a, b):
    from app.assistant import names

    assert not names.similar(a, b)


def test_wp15_relate_is_only_a_suggestion_and_numbers_still_win():
    from types import SimpleNamespace as NS
    from app.assistant import identity
    import uuid

    chat = NS(id=uuid.uuid4(), phone="notif:com.whatsapp:Rahim", name="Rahim", profile={})
    sms = NS(id=uuid.uuid4(), phone="sms:+8801711000000", name="রহিম", profile={})
    other = NS(id=uuid.uuid4(), phone="sms:+8801811000000", name="রহিম", profile={})
    assert identity.relate(chat, sms).level == "medium"          # a suggestion, never an automatic link
    assert identity.relate(sms, other).level == "none"            # different numbers are never merged
    alias = NS(id=uuid.uuid4(), phone="notif:com.imo:Boro Vai", name="Boro Vai", profile={"aliases": ["Rahim"]})
    assert identity.relate(alias, sms).level == "medium"


# -- part 2: facts a person tells about themselves (WP16) -------------------------------

@pytest.mark.parametrize("text,expect", [
    ("ভাই আমার জন্মদিন ১২ মার্চ", "জন্মদিন: ১২ মার্চ"),
    ("I am the manager at Acme Ltd", "manager"),
    ("সকালে ফোন দিবেন না", "সকালে ফোন"),
    ("আমি মিরপুরে থাকি", "মিরপুর"),
    ("আমাকে বাবু ডাকবেন", "বাবু"),
])
def test_wp16_extracts_stated_facts(text, expect):
    from app.assistant.extract import extract

    assert any(expect in f for f in extract(text))


@pytest.mark.parametrize("text", ["কাল দেখা হবে", "আপনি কি ম্যানেজার?", "", "ok"])
def test_wp16_no_fact_from_ordinary_text(text):
    from app.assistant.extract import extract

    assert extract(text) == []


def test_wp16_extracted_fact_is_inferred_never_confirmed():
    from app.assistant import memory
    from app.assistant.extract import extract

    prof, fact, _ = memory.add({}, extract("আমি মিরপুরে থাকি")[0], "ai", "msg:1", "low")
    assert fact["provenance"] == "ai" and fact["confidence"] in ("low", "medium")
    assert memory.view(prof)[0]["inferred"] is True


# -- part 2: F0 answers more questions (WP18, WP9) --------------------------------------

@pytest.mark.parametrize("text,intent", [
    ("রহিম কী বলেছে", "search"), ("খুঁজো দাম", "search"), ("জরুরি", "alerts"), ("খসড়া", "drafts"),
    ("কী কী পাঠানো হয়েছে", "history"), ("সহকারীর অবস্থা", "system"), ("নিয়ম", "rules"),
    ("রহিমকে বলো কাল জানাব", "reply"), ("মিসড কল", "missed_calls"), ("আমার কাজ", "tasks"),
])
def test_f0_parse_new_questions_without_breaking_old_ones(text, intent):
    from app.assistant import f0

    assert f0.parse(text)["intent"] == intent


@pytest.mark.asyncio
async def test_f0_search_skips_private_chats_and_lists_drafts_and_history(Session):
    from app.assistant import f0

    async with Session() as db:
        biz = WaContact(phone="notif:com.whatsapp:Rahim", name="Rahim", channel="notif", category="business")
        priv = WaContact(phone="notif:com.whatsapp:Ammu", name="আম্মু", channel="notif", category="personal", is_family=True)
        db.add_all([biz, priv])
        await db.flush()
        db.add_all([
            WaMessage(contact_id=biz.id, direction="in", channel="notif", body="দাম কত হবে?", status="received"),
            WaMessage(contact_id=priv.id, direction="in", channel="notif", body="দাম নিয়ে কথা", status="received"),
            WaMessage(contact_id=biz.id, direction="out", channel="notif", body="দেখে জানাচ্ছি", status="draft", reason="assistant"),
            WaMessage(contact_id=biz.id, direction="out", channel="notif", body="x", status="failed", reason="owner", error="ফোন পাঠাতে পারেনি"),
        ])
        await db.commit()
        hit = await f0.run(db, "খুঁজো দাম")
        assert len(hit["items"]) == 1 and "Rahim" in hit["items"][0]["subtitle"]       # the family chat is not searched
        who = await f0.run(db, "আম্মু কী বলেছে")
        assert "সার্চে ধরা হয় না" in who["answer"] and who["items"] == []
        drafts = await f0.run(db, "খসড়া")
        assert len(drafts["items"]) == 1
        hist = await f0.run(db, "কী কী পাঠানো হয়েছে")
        assert any("যায়নি" in i["subtitle"] and "ফোন পাঠাতে পারেনি" in i["subtitle"] for i in hist["items"])  # a failure is shown as a failure
        assert (await f0.run(db, "জরুরি"))["intent"] == "alerts"


@pytest.mark.asyncio
async def test_f0_system_answer_shows_a_label_not_a_raw_dict(Session):
    from app.assistant import f0

    async with Session() as db:
        r = await f0.run(db, "সহকারীর অবস্থা")
    assert "{" not in r["answer"] and "'key'" not in r["answer"]
