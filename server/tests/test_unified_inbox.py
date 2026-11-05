"""Unified inbox rules that must never regress: who may auto-reply, alert limits, Telegram safety (no network, no database)."""
import asyncio
import copy
from datetime import datetime
from types import SimpleNamespace

from app.assistant import channels as ch
from app.assistant import wa_brain as brain
from app.assistant import wa_config as wc
from app.assistant import wa_flow
from app.assistant.channels import alerts, telegram
from app.core.config import settings


def cfg(**over):
    c = copy.deepcopy(wc.DEFAULT_CONFIG)
    c.update(over)
    return c


def who(channel="whatsapp", mode="inherit"):
    return SimpleNamespace(channel=channel, mode=mode)


# ── who may answer by itself ──────────────────────────────────────────────────

def test_whatsapp_behaviour_is_unchanged():
    assert wa_flow.effective_mode(cfg(mode="auto"), who("whatsapp")) == "auto"
    assert wa_flow.effective_mode(cfg(mode="shadow"), who("whatsapp")) == "draft"
    assert wa_flow.effective_mode(cfg(mode="auto"), who("whatsapp", "draft")) == "draft"


def test_bridge_only_channels_are_never_answered_by_the_assistant():
    c = cfg(mode="auto")
    c["channels"]["telegram"].update(enabled=True, auto=True)
    for channel in ("notif", "email", "webhook"):
        assert wa_flow.effective_mode(c, who(channel)) == "draft"
    assert wa_flow.effective_mode(c, who("telegram")) == "auto"


def test_telegram_and_sms_need_their_own_switch():
    c = cfg(mode="auto")
    assert wa_flow.effective_mode(c, who("telegram")) == "draft"   # off by default
    assert wa_flow.effective_mode(c, who("sms")) == "draft"
    c["channels"]["device"]["auto_sms"] = True
    assert wa_flow.effective_mode(c, who("sms")) == "auto"


def test_kill_switch_beats_every_channel():
    c = cfg(mode="shadow")
    c["channels"]["telegram"].update(enabled=True, auto=True)
    assert wa_flow.effective_mode(c, who("telegram")) == "draft"


def test_labels_exist_for_every_channel():
    for key in ch.CHANNELS:
        assert ch.label(key) and ch.icon(key)


# ── alert limits ──────────────────────────────────────────────────────────────

def at(h, m=0):
    return datetime(2026, 11, 4, h, m)


def test_quiet_hours_wrap_over_midnight():
    limits = {"quiet_from": "23:00", "quiet_to": "07:00"}
    assert alerts.in_quiet_hours(limits, at(23, 30))
    assert alerts.in_quiet_hours(limits, at(3))
    assert not alerts.in_quiet_hours(limits, at(7))
    assert not alerts.in_quiet_hours(limits, at(14))


def run_allowed(priority, used, now, **limits):
    c = cfg()
    c["limits"].update(limits)

    async def fake_get(db, key):
        return f"{now.strftime('%Y-%m-%d')}:{used}"

    orig = wa_flow._get_val
    wa_flow._get_val = fake_get
    try:
        return asyncio.run(alerts.allowed(None, c, priority, now))
    finally:
        wa_flow._get_val = orig


def test_daily_cap_and_priority_one_ceiling():
    assert run_allowed(2, 0, at(12))
    assert not run_allowed(2, 5, at(12))            # cap reached
    assert run_allowed(1, 5, at(12))                # the most urgent may pass the cap...
    assert not run_allowed(1, 10, at(12))           # ...but never forever


def test_at_night_only_priority_one_gets_through():
    assert not run_allowed(2, 0, at(2))
    assert run_allowed(1, 0, at(2))
    assert run_allowed(2, 0, at(2), quiet_urgent_only=False)


# ── Telegram safety ───────────────────────────────────────────────────────────

def test_webhook_secret_must_match_and_cannot_be_empty(monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_SECRET", "")
    assert not telegram.verify_secret("")          # an unset secret must not accept an empty header
    monkeypatch.setattr(settings, "TELEGRAM_WEBHOOK_SECRET", "s3cret")
    assert telegram.verify_secret("s3cret")
    assert not telegram.verify_secret("wrong")
    assert not telegram.verify_secret(None)


def test_only_the_owner_id_is_the_owner(monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_OWNER_ID", "")
    assert not telegram.is_owner(123)
    monkeypatch.setattr(settings, "TELEGRAM_OWNER_ID", "123")
    assert telegram.is_owner(123) and telegram.is_owner("123")
    assert not telegram.is_owner(124)


def test_message_content_kinds():
    assert telegram._content({"text": "hi"}) == ("text", "hi", {})
    assert telegram._content({"voice": {"file_id": "f1"}}) == ("audio", "", {"file_id": "f1"})
    assert telegram._content({"photo": [{}]})[1] == "[ছবি]"
    assert telegram._content({"unknown": 1})[1] == ""


class RecordingDB:
    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, *a, **k):
        raise AssertionError("no database access expected")


def run_update(update, monkeypatch, owner="999"):
    sent = []

    async def fake_send(chat_id, text, bc=None):
        sent.append((str(chat_id), text))
        return "1"

    monkeypatch.setattr(telegram, "send_text", fake_send)
    monkeypatch.setattr(settings, "TELEGRAM_OWNER_ID", owner)
    ids = asyncio.run(telegram.handle_update(RecordingDB(), update))
    return ids, sent


def test_anyone_can_ask_for_their_id_but_it_creates_no_message(monkeypatch):
    ids, sent = run_update({"message": {"chat": {"id": 5}, "from": {"id": 5}, "text": "/id", "message_id": 1, "date": 1}}, monkeypatch)
    assert ids == [] and sent == [("5", "আপনার Telegram আইডি: 5")]


def test_a_strangers_command_never_runs_as_a_command(monkeypatch):
    # /stop from a non-owner must neither change anything nor land in the inbox as a message
    ids, sent = run_update({"message": {"chat": {"id": 7}, "from": {"id": 7}, "text": "/stop", "message_id": 2, "date": 1}}, monkeypatch)
    assert ids == [] and sent == []


def test_a_customers_start_gets_an_honest_greeting(monkeypatch):
    ids, sent = run_update({"message": {"chat": {"id": 8}, "from": {"id": 8}, "text": "/start", "message_id": 4, "date": 1}}, monkeypatch)
    assert ids == [] and sent and "মানুষ নই" in sent[0][1]


def test_owner_chat_with_the_bot_is_never_a_customer_thread(monkeypatch):
    ids, sent = run_update({"message": {"chat": {"id": 999}, "from": {"id": 999}, "text": "/help", "message_id": 3, "date": 1}}, monkeypatch)
    assert ids == [] and sent and "/stop" in sent[0][1]


def test_prompt_injection_text_is_only_text():
    # A customer's words are data: the brain's guard rejects invented money/time promises whatever the message says.
    assert brain.guard_text("টাকা ৫০০০ দিন", "") is None


# ── paired-phone authentication ───────────────────────────────────────────────

def test_device_tokens_are_recognisable_hashed_and_never_stored_raw():
    from app.core import device_auth as da

    t = da.new_token()
    assert da.is_device_token(t) and not da.is_device_token("eyJhbGciOi.jwt.like")
    assert len(da.hash_token(t)) == 64 and t not in da.hash_token(t)
    assert da.new_token() != t


def test_routes_a_lost_phone_must_not_reach_stay_admin_session_only():
    import inspect

    from app.api.v1.routes import wa_assistant as wa

    src = inspect.getsource(wa)
    for name in ("put_secrets", "test_secrets", "connect_webhook", "erase_contact", "reset_config", "setup"):
        block = src.split(f"async def {name}(")[1].split("\n@router")[0]
        assert "require_role(OWNER)" in block and "owner_or_device" not in block, name


# ── e-mail code sign-in and real-time wake ────────────────────────────────────

def test_otp_hash_is_bound_to_the_account_and_ignores_spaces():
    from app.api.v1.routes import inbox as ib

    assert ib._otp_hash("a1", "123456") == ib._otp_hash("a1", " 123456 ")
    assert ib._otp_hash("a1", "123456") != ib._otp_hash("a2", "123456")   # another admin's code can never match
    assert ib._otp_hash("a1", "123456") != ib._otp_hash("a1", "123457")


def test_five_wrong_codes_block_the_account_for_a_while_and_then_release_it():
    from app.api.v1.routes import inbox as ib

    ib._otp_fail.clear()
    for _ in range(ib.OTP_MAX_TRIES - 1):
        ib._otp_wrong("u1")
    assert not ib._otp_blocked("u1")
    ib._otp_wrong("u1")
    assert ib._otp_blocked("u1")
    assert not ib._otp_blocked("someone-else")
    ib._otp_fail["u1"] = (ib.OTP_MAX_TRIES, 0.0)  # the block was long ago
    assert not ib._otp_blocked("u1")


def test_otp_endpoints_never_say_which_emails_are_admins():
    import inspect

    from app.api.v1.routes import inbox as ib

    src = inspect.getsource(ib.otp_request)
    assert "return {\"ok\": True" in src and src.count("raise HTTPException") == 1  # only the IP lock may refuse; unknown e-mails look the same


def test_a_waiting_phone_is_woken_at_once_and_times_out_quietly():
    from app.assistant.channels import wake

    async def scenario():
        waiter = asyncio.create_task(wake.wait(5))
        await asyncio.sleep(0.05)
        wake.notify()
        woken = await waiter
        quiet = await wake.wait(0.05)
        return woken, quiet

    assert asyncio.run(scenario()) == (True, False)


# ── business / personal / social / spam sorting ───────────────────────────────

def person(**kw):
    base = dict(is_family=False, is_vip=False, category=None, channel="whatsapp", name="রহিম", lang=None, is_blocked=False, state="assistant", hold_until=None, mode="inherit")
    base.update(kw)
    return SimpleNamespace(**base)


def cat(text, kind="other", channel="whatsapp", **kw):
    return brain.category_for(text, cfg(), person(channel=channel, **kw), kind, channel)


def test_family_is_always_personal_even_when_the_text_sounds_like_work():
    assert cat("ওয়েবসাইট বানাতে কত টাকা লাগবে", kind="work", is_family=True) == "personal"


def test_work_money_and_meeting_asks_are_business():
    for kind in ("work", "update", "meet", "money"):
        assert cat("কাজ নিয়ে কথা", kind=kind) == "business"


def test_invitations_and_greetings_are_social_and_ads_are_spam():
    assert cat("কাল আমার ছেলের বিয়ের দাওয়াত রইল", channel="notif") == "social"
    assert cat("ঈদ মোবারক ভাই", channel="notif") == "social"
    assert cat("অভিনন্দন! আপনি লটারি জিতেছেন, ক্লিক করুন", channel="sms") == "spam"


def test_a_person_the_owner_already_sorted_keeps_that_sort():
    assert cat("hello", channel="whatsapp", category="personal") == "personal"
    assert cat("hello", channel="notif", category="business") == "business"


def test_with_nothing_to_go_on_customer_channels_are_business_and_own_phone_chats_are_personal():
    assert cat("hello", channel="telegram") == "business"
    assert cat("hello", channel="notif") == "personal"


def test_the_ai_reading_can_decide_when_words_do_not():
    assert brain.category_for("some unclear text", cfg(), person(channel="notif"), "other", "notif", "social") == "social"
    assert brain.category_for("some unclear text", cfg(), person(channel="notif"), "other", "notif", "nonsense") == "personal"  # unknown AI answer is ignored


def test_personal_and_social_only_get_drafts_while_business_may_auto_reply():
    c = cfg(mode="auto")
    c["channels"]["telegram"].update(enabled=True, auto=True)
    for category, expected in (("business", "auto"), ("personal", "draft"), ("social", "draft")):
        assert wa_flow.effective_mode(c, SimpleNamespace(channel="telegram", mode="inherit", category=category)) == expected
    c["categories"]["social"]["auto"] = True  # the owner may switch a category to auto
    assert wa_flow.effective_mode(c, SimpleNamespace(channel="telegram", mode="inherit", category="social")) == "auto"


def test_spam_is_dropped_silently_by_the_brain():
    d = asyncio.run(brain.decide(None, cfg(), person(channel="sms"), "ফ্রি রিচার্জ অফার শেষ হচ্ছে ক্লিক করুন", "text", None, [], []))
    assert d.category == "spam" and d.reply is None and not d.notify


# ── privacy for family and personal messages ──────────────────────────────────

def test_sealed_text_round_trips_and_is_not_readable_in_the_database():
    from app.assistant import privacy

    sealed = privacy.seal("আব্বা হাসপাতালে")
    assert sealed.startswith(privacy.PREFIX) and "আব্বা" not in sealed
    assert privacy.unseal(sealed) == "আব্বা হাসপাতালে"
    assert privacy.seal(sealed) == sealed             # never encrypted twice
    assert privacy.unseal("plain business text") == "plain business text"
    assert privacy.unseal(None) is None and privacy.seal("") == ""


def test_a_broken_key_hides_one_line_but_never_breaks_the_inbox():
    from app.assistant import privacy

    assert privacy.unseal(privacy.PREFIX + "not-a-real-token") == privacy.UNREADABLE


def test_family_and_personal_are_private_business_and_social_are_not():
    from app.assistant import privacy

    assert privacy.is_private(person(is_family=True))
    assert privacy.is_private(person(), "personal")
    assert privacy.is_private(person(category="personal"))
    assert not privacy.is_private(person(), "business") and not privacy.is_private(person(), "social")


def run_decide(contact, text, monkeypatch):
    called = []

    async def spy(db, c, body, recent, facts):
        called.append(body)
        return None

    monkeypatch.setattr(brain, "analyze", spy)
    d = asyncio.run(brain.decide(None, cfg(), contact, text, "text", None, [], []))
    return d, called


def test_family_words_never_reach_the_ai_but_business_words_may(monkeypatch):
    d, called = run_decide(person(is_family=True), "আব্বার শরীর খারাপ, এখনই ফোন দাও", monkeypatch)
    assert called == [] and "আব্বা" not in d.summary and "শরীর" not in d.summary and d.summary == "ব্যক্তিগত বার্তা (লেখা সুরক্ষিত)"
    d, called = run_decide(person(channel="telegram"), "আমার একটা ওয়েবসাইট বানাতে কত খরচ পড়বে বলবেন", monkeypatch)
    assert len(called) == 1 and d.category == "business"


def test_a_person_sorted_as_personal_is_not_read_by_the_ai_either(monkeypatch):
    d, called = run_decide(person(category="personal", channel="notif"), "কাল দেখা হবে, কেমন আছো ভাই বলো তো", monkeypatch)
    assert called == [] and d.summary == "ব্যক্তিগত বার্তা (লেখা সুরক্ষিত)"


def test_retention_is_shortest_for_personal_and_spam_and_family_has_its_own():
    from app.assistant import privacy

    c = cfg()
    assert privacy.retention_days(c, "personal", False) == 7
    assert privacy.retention_days(c, "spam", False) == 3
    assert privacy.retention_days(c, "business", False) == 90
    assert privacy.retention_days(c, None, True) == 30                 # family
    assert privacy.retention_days(c, "unknown-kind", False) == int(c["retention_days"])


def test_password_login_answers_the_same_for_unknown_and_wrong_and_asks_totp_only_after_a_right_password():
    import inspect

    from app.api.v1.routes import inbox as ib

    src = inspect.getsource(ib.device_login)
    assert src.count('"ইমেইল বা পাসওয়ার্ড ভুল"') == 1 and src.index("verify_password") < src.index("totp_required")
    assert "_register_account_failure" in src and "account_locked" in src  # same lockouts as the website


# ── tags, mood greeting, presence, honest delivery ────────────────────────────

def test_a_client_tag_makes_the_chat_business_and_an_important_tag_lifts_priority():
    tagged = person(tags=[{"label": "ক্লায়েন্ট", "value": "", "important": False}], channel="notif")
    assert brain.category_for("hello", cfg(), tagged, "other", "notif") == "business"
    d = asyncio.run(brain.decide(None, cfg(), person(tags=[{"label": "মামলা", "value": "১২/২৪", "important": True}], channel="notif"), "কেমন আছেন", "text", None, [], []))
    assert d.priority <= 2 and d.notify


def test_greeting_fits_the_hour():
    from datetime import datetime as dt

    assert brain.mood_prefix(dt(2026, 1, 1, 9), "bn") == "শুভ সকাল।"
    assert brain.mood_prefix(dt(2026, 1, 1, 14), "bn") == "শুভ দুপুর।"
    assert brain.mood_prefix(dt(2026, 1, 1, 19), "bn") == "শুভ সন্ধ্যা।"
    assert brain.mood_prefix(dt(2026, 1, 1, 2), "en") == "Good night."


def test_presence_never_guesses_and_a_manual_status_always_wins():
    from datetime import datetime as dt, timedelta as td, timezone as tz

    from app.assistant import presence

    now = dt.now(tz.utc)
    assert presence.state({}) == "unknown"
    assert presence.state({"at": (now - td(hours=2)).isoformat()}) == "unknown"           # stale report
    fresh = {"at": now.isoformat(), "screen_on": True, "touched_at": now.isoformat()}
    assert presence.state(fresh) == "active"
    dark = {"at": now.isoformat(), "screen_on": False, "touched_at": (now - td(hours=2)).isoformat(), "moved_at": (now - td(hours=2)).isoformat()}
    assert presence.state(dark) == "still"
    moving = {**fresh, "screen_on": False, "touched_at": (now - td(hours=1)).isoformat(),
              "fixes": [{"lat": 24.90, "lng": 91.87, "at": (now - td(minutes=15)).isoformat()}, {"lat": 24.95, "lng": 91.95, "at": (now - td(minutes=2)).isoformat()}]}
    assert presence.state(moving) == "moving"

    async def fake_load(db):
        return dark
    orig = presence.load
    presence.load = fake_load
    try:
        c = cfg()
        c["status"] = {"key": "meeting", "until": None, "custom": ""}
        assert asyncio.run(presence.apply(None, c))["status"]["key"] == "meeting"          # owner's own status is never overridden
    finally:
        presence.load = orig


def test_a_message_handed_to_the_phone_is_not_marked_sent_until_the_phone_confirms():
    import inspect

    from app.api.v1.routes import inbox as ib
    from app.assistant.channels import dispatch

    assert '"sending"' in inspect.getsource(dispatch.deliver_other)
    src = inspect.getsource(ib.device_ack)
    assert 'm.status, m.sent_at, m.delivery, m.error = "sent"' in src and '"delivered"' in src


def test_our_chat_export_can_be_imported_again_and_private_chats_need_explicit_consent():
    import inspect
    from datetime import datetime as dt

    from app.api.v1.routes import wa_assistant as wa

    line = f"{dt(2026, 11, 4, 14, 5):%d/%m/%Y, %H:%M} - Rahim: কাজটা কবে হবে?"
    rows, speakers = brain.parse_export(line + "\n" + line.replace("Rahim", "Sumon").replace("কবে", "আজ") + "\n" + line)
    assert speakers == ["Rahim", "Sumon"] and len(rows) == 3
    src = inspect.getsource(wa.learn)
    assert "need_consent" in src and "consent_private" in inspect.getsource(wa.LearnIn)


def test_group_messages_are_shown_but_never_answered_and_drafts_do_not_pile_up():
    import inspect

    from app.assistant import wa_flow

    src = inspect.getsource(wa_flow._process)
    assert '"group"' in src and "d.reply, d.notify" in src                       # groups: no draft, no alert
    assert "One draft per person" in src and "waiting.body" in src                # a new message updates the waiting draft
    assert 'channel or "whatsapp") == "notif"' in src and "is_question" in src    # own-phone chats: draft only when there is something to answer


# ── e-mail filtering ──────────────────────────────────────────────────────────

def mail(sender, subject, body="", known=False, **cfg_over):
    from app.assistant.channels import email_filter

    c = cfg()
    c["email_filter"].update(cfg_over)
    return email_filter.decide(c, sender, subject, body, known)[0]


def test_promotions_newsletters_and_no_reply_mail_are_dropped():
    assert not mail("Daraz <no-reply@daraz.com.bd>", "Flash sale: 70% off today only")
    assert not mail("Shop News <newsletter@shop.com>", "Our weekly digest")
    assert not mail("অফার ঘর <hello@x.com>", "বিশেষ ছাড় — সীমিত সময়")
    assert not mail("someone@x.com", "Great news", "Click here to unsubscribe from these emails")


def test_money_law_deadline_and_replies_and_known_people_are_kept():
    assert mail("accounts@vendor.com", "Invoice 1043 payment overdue")
    assert mail("bank@bank.com.bd", "আপনার ব্যাংক হিসাব সংক্রান্ত নোটিশ")
    assert mail("Rahim <rahim@gmail.com>", "Re: ওয়েবসাইটের কাজ")
    assert mail("no-reply@promo.com", "anything", known=True)               # a person the owner knows always gets through
    assert mail("friend@gmail.com", "কাল দেখা হবে?")                         # a plain personal mail is kept


def test_owner_lists_and_the_all_mode_override_the_rules():
    assert not mail("rahim@gmail.com", "hello", block=["rahim@gmail.com"])
    assert mail("no-reply@bigclient.com", "update", allow=["bigclient.com"])
    assert mail("no-reply@promo.com", "70% off", mode="all")


def test_only_a_counter_of_dropped_mail_is_stored_and_the_ingest_uses_the_filter():
    import inspect

    from app.api.v1.routes import inbox as ib

    src = inspect.getsource(ib.device_ingest)
    assert "email_filter.decide" in src and "count_dropped" in src and "continue" in src
