"""Personal WhatsApp assistant — the rules that must never regress (no network, no database)."""
import asyncio
import copy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.assistant import wa_brain as b
from app.assistant import wa_config as wc
from app.assistant import wa_send

DHAKA = b.DHAKA


def cfg(**over):
    c = copy.deepcopy(wc.DEFAULT_CONFIG)
    c["ai"]["enabled"] = False
    c.update(over)
    return c


def person(**kw):
    base = dict(name="রহিম", lang=None, is_blocked=False, state="assistant", hold_until=None, mode="inherit", is_family=False, is_vip=False, profile=None)
    base.update(kw)
    return SimpleNamespace(**base)


def run(c, who, text, recent=None, notes=None, kind="text", transcript=None, now=None):
    return asyncio.run(b.decide(None, c, who, text, kind, transcript, recent or [], notes or [], now))


def out(reason, minutes_ago=1, status="sent"):
    return {"direction": "out", "reason": reason, "status": status, "body": "x", "created_at": datetime.now(DHAKA) - timedelta(minutes=minutes_ago)}


def inn(text, minutes_ago=1):
    return {"direction": "in", "reason": None, "status": "received", "body": text, "created_at": datetime.now(DHAKA) - timedelta(minutes=minutes_ago)}


# ── helpers ──────────────────────────────────────────────────────────────────────

def test_phone_normalisation():
    assert b.normalize_phone("01825-007977") == "8801825007977"
    assert b.normalize_phone("+880 1825 007977") == "8801825007977"
    assert b.normalize_phone("8801825007977") == "8801825007977"


def test_short_words_match_whole_tokens_only():
    assert b.has_any("কই আপনি?", ["কই"])
    assert not b.has_any("কইতে পারব না", ["কই"])
    assert b.has_any("আমার আব্বা অসুস্থ", ["অসুস্থ"])


def test_language_detection():
    assert b.detect_lang("আসসালামু আলাইকুম") == "bn"
    assert b.detect_lang("apni kemon achen") == "bn"
    assert b.detect_lang("Please call me about the invoice") == "en"


def test_guard_blocks_money_and_new_numbers():
    assert b.guard_text("কাজটি ১৫ তারিখে পাবেন", "১৫ তারিখে কাজ রেডি") is not None
    assert b.guard_text("দাম ৫০০ টাকা", "") is None
    assert b.guard_text("আজ ৩টায় আসুন", "কাল আসুন") is None


def test_manual_status_schedule_and_overnight():
    c = cfg()
    c["schedule"] = [{"days": [0, 1, 2, 3, 4, 5, 6], "from": "23:00", "to": "07:00", "status": "sleeping"}]
    night = datetime(2026, 10, 27, 2, 0, tzinfo=DHAKA)
    noon = datetime(2026, 10, 27, 12, 0, tzinfo=DHAKA)
    assert b.current_status(c, night)["key"] == "sleeping"
    assert b.current_status(c, noon)["key"] == "free"
    c["status"] = {"key": "meeting", "until": (noon + timedelta(hours=1)).isoformat(), "custom": "ডাক্তারের কাছে"}
    s = b.current_status(c, noon)
    assert s["key"] == "meeting" and s["say"] == "ডাক্তারের কাছে"
    assert b.current_status(c, noon + timedelta(hours=2))["key"] == "free"  # expired manual status falls back


def test_export_parsing_and_scrub():
    txt = "12/10/2026, 10:15 - রহিম: আসসালামু আলাইকুম\n12/10/2026, 10:16 - Sumon: ওয়ালাইকুম\nআরেক লাইন\n12/10/2026, 10:17 - রহিম: 01712345678 নম্বরে কল দিন"
    rows, speakers = b.parse_export(txt)
    assert speakers == ["রহিম", "Sumon"] and len(rows) == 3 and "আরেক লাইন" in rows[1][1]
    assert "01712345678" not in b.scrub(rows[2][1])


def test_config_sanitise_and_fill():
    clean = wc.sanitize({"enabled": 1, "mode": "auto", "evil": "x", "delay": {"min": "5", "max": 9}}, wc.DEFAULT_CONFIG)
    assert clean == {"enabled": True, "mode": "auto", "delay": {"min": 5, "max": 9}}
    assert wc.fill("ধন্যবাদ {name}। {owner} উত্তর দেবেন", name="", owner="সুমন ভাই") == "ধন্যবাদ। সুমন ভাই উত্তর দেবেন"
    assert wc.masked({"token": "abcdefgh1234"})["token"]["preview"] == "••••1234"


def test_webhook_signature():
    import hashlib
    import hmac

    body = b'{"x":1}'
    good = "sha256=" + hmac.new(b"secret", body, hashlib.sha256).hexdigest()
    assert wa_send.verify_signature("secret", body, good)
    assert not wa_send.verify_signature("secret", body, "sha256=00")
    assert not wa_send.verify_signature("", body, good)


# ── decisions ────────────────────────────────────────────────────────────────────

def test_blocked_and_owner_hold_stay_silent():
    assert run(cfg(), person(is_blocked=True), "হ্যালো ভাই").reply is None
    held = person(state="owner", hold_until=datetime.now(DHAKA) + timedelta(hours=1))
    assert run(cfg(), held, "কাজ কতদূর").reply is None


def test_urgent_gets_only_the_fixed_acknowledgement_and_notifies():
    d = run(cfg(), person(), "আমার আম্মা অসুস্থ, হাসপাতালে")
    assert d.priority == 1 and d.notify and d.handoff and d.reason == "urgent"
    assert "জানানো হয়েছে" in d.reply
    again = run(cfg(), person(), "আম্মা অসুস্থ", recent=[out("urgent", 5)])
    assert again.reply is None  # not repeated within 30 minutes


def test_family_is_never_auto_answered():
    d = run(cfg(), person(is_family=True), "কেমন আছো বাবা")
    assert d.reply is None and d.notify and d.handoff


def test_identity_question_is_answered_honestly():
    d = run(cfg(), person(), "আপনি কি বট?")
    assert d.reason == "identity" and "মানুষ নই" in d.reply


def test_note_is_told_verbatim_and_not_repeated():
    d = run(cfg(), person(), "আমার কাজ কতদূর?", notes=["আপনার কাজ ১৫ তারিখে পাবেন"])
    assert d.reason == "note" and "১৫ তারিখে" in d.reply
    again = run(cfg(), person(), "কবে পাব?", notes=["আপনার কাজ ১৫ তারিখে পাবেন"], recent=[out("note", 3)])
    assert again.reason != "note"


def test_sleeping_status_is_spoken_and_asks_to_write_not_call():
    c = cfg()
    c["status"] = {"key": "sleeping", "until": None, "custom": ""}
    c["reply_by"] = "বিকেল ৪টার পর"
    d = run(c, person(), "আসসালামু আলাইকুম")
    assert d.reason == "salam" and "বিশ্রামে" in d.reply and "কল বা ভয়েস" in d.reply
    call = run(c, person(), "আমি ফোন দিলাম কিন্তু ধরলেন না")
    assert call.reason == "call" and "বিকেল ৪টার পর" in call.reply


def test_question_flow_asks_then_thanks_then_goes_quiet():
    c = cfg()
    first = run(c, person(), "আমার একটা ডিজাইনের কাজ লাগবে")
    assert first.kind == "work" and first.reason == "ask1" and "কাজটি কী ধরনের" in first.reply
    second = run(c, person(), "ব্যানার", recent=[out("ask1", 2), inn("আমার একটা ডিজাইনের কাজ লাগবে", 3)])
    assert second.reason == "ask2" and "কবে" in second.reply
    third = run(c, person(), "পরশুর মধ্যে", recent=[out("ask2", 1), inn("ব্যানার", 2), out("ask1", 3), inn("আমার একটা ডিজাইনের কাজ লাগবে", 4)])
    assert third.reason == "thanks" and third.tasks
    quiet = run(c, person(), "ধন্যবাদ", recent=[out("thanks", 2)])
    assert quiet.reply is None and quiet.reason == "quiet"


def test_repeated_chasing_gets_one_apology_then_waits():
    now = datetime.now(DHAKA)
    chase = [{"direction": "in", "reason": None, "status": "received", "body": "কই", "created_at": now - timedelta(minutes=m)} for m in (1, 3)]
    d = run(cfg(), person(), "কই ভাই, উত্তর দেন", recent=chase)
    assert d.priority == 4 and d.reason == "repeat" and d.notify
    d2 = run(cfg(), person(), "কই ভাই", recent=chase + [out("repeat", 4)])
    assert d2.reply is None


def test_voice_without_transcript_is_flagged_for_listening():
    d = run(cfg(), person(), "", kind="audio")
    assert d.reason == "voice" and d.notify and "শুনে দেখুন" in d.summary


def test_abo_text_is_not_used_while_the_switch_is_off():
    c = cfg()
    c["abo"]["facts"] = "আমাদের দোকান শনিবার বন্ধ"
    d = run(c, person(), "দোকান কি শনিবার খোলা?")
    assert "শনিবার বন্ধ" not in (d.reply or "")


def test_unknown_question_is_not_guessed():
    d = run(cfg(), person(), "আজ কি বৃষ্টি হবে?")
    assert d.reason == "unknown" and "জিজ্ঞেস করে" in d.reply and d.tasks


def test_main_number_needs_every_safety_box():
    c = cfg()
    c["enabled"] = True
    assert wc.readiness_problem(c) is None  # test number: no gate
    c["readiness"]["target"] = "main"
    assert "সব ঘরে টিক" in wc.readiness_problem(c)
    for k in wc.READINESS_LABELS:
        c["readiness"][k] = True
    assert wc.readiness_problem(c) is None
    c["enabled"] = False
    c["readiness"]["backup"] = False
    assert wc.readiness_problem(c) is None  # switching OFF is always allowed


def test_ai_helper_routes_are_owner_only_and_registered():
    from app.api.v1.routes import wa_assistant as r

    paths = {getattr(x, "path", ""): x for x in r.router.routes}
    for p in ("/admin/wa/ask", "/admin/wa/contacts/{cid}/suggest"):
        assert p in paths, p
        deps = [d.call for d in paths[p].dependant.dependencies]
        assert any(getattr(d, "_abo_required_permission", None) == r.OWNER for d in deps), p
    for gone in ("/admin/wa/health", "/admin/wa/setup", "/admin/wa/events", "/admin/wa/webhook/connect"):  # WhatsApp Cloud API removed
        assert gone not in paths, gone


def test_english_writer_gets_an_all_english_reply():
    c = cfg()
    c["status"] = {"key": "sleeping", "until": None, "custom": ""}
    d = run(c, person(name="John"), "I need a banner design for my shop")
    assert d.lang == "en" and d.reason == "ask1"
    assert "Sumon's virtual assistant" in d.reply and "resting right now" in d.reply and "What kind of work" in d.reply
    assert not any("ঀ" <= ch <= "৿" for ch in d.reply), d.reply  # no Bangla letters at all
    bn = run(c, person(), "আমার একটা ডিজাইনের কাজ লাগবে")
    assert "কাজটি কী ধরনের" in bn.reply and "Sumon" not in bn.reply


# (test of the deleted WhatsApp Cloud API "connect webhook" route removed 2026-11-07)

def test_send_errors_are_explained_in_plain_bangla():
    r = wa_send.send_reason({"status": 403, "code": 131005, "message": "Access denied"})
    assert "স্থায়ী টোকেন" in r and "#131005" in r and "Access denied" in r
    assert "প্রাপক-তালিকায়" in wa_send.send_reason({"status": 400, "code": 131030, "message": "x"})
    assert "মেয়াদ" in wa_send.send_reason({"status": 401, "code": 190, "message": "expired"})


# (test of the deleted WhatsApp Cloud webhook receiver removed 2026-11-07)

def test_daily_token_check_warns_only_when_dead_or_ending_soon(monkeypatch):
    from app.assistant import wa_flow

    alerts = []

    async def secrets(db):
        return {"token": "T", "phone_number_id": "1"}

    async def alert(db):
        alerts.append(1)

    soon = int((datetime.now(timezone.utc) + timedelta(days=1)).timestamp())
    far = int((datetime.now(timezone.utc) + timedelta(days=40)).timestamp())
    monkeypatch.setattr(wc, "get_secrets", secrets)
    monkeypatch.setattr(wa_flow, "_alert_token", alert)
    for data, expected in (({"is_valid": True, "expires_at": 0}, 0), ({"is_valid": True, "expires_at": far}, 0),
                           ({"is_valid": True, "expires_at": soon}, 1), ({"is_valid": False, "expires_at": 0}, 1)):
        alerts.clear()

        async def graph(c, path, params=None, token=None, _d=data):
            return True, {"data": _d}

        monkeypatch.setattr(wa_send, "graph_get", graph)
        asyncio.run(wa_flow._check_token(None))
        assert len(alerts) == expected, data


def test_token_errors_are_recognised_for_alert_and_retry():
    from app.assistant import wa_flow

    for msg in ("টোকেনের মেয়াদ শেষ (Meta: #190 x)", "Meta এই টোকেনকে … (Meta: #131005 Access denied)"):
        assert any(c in msg for c in wa_flow.AUTH_CODES)
    assert not any(c in "২৪ ঘণ্টা পার — ব্যক্তি আবার লিখলে" for c in wa_flow.AUTH_CODES)
