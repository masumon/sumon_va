"""2026-11-04 audit: Banglish/Sylheti gets Bangla, phone-app auto replies are opt-in per platform."""
from types import SimpleNamespace

from app.assistant import wa_brain as brain
from app.assistant import wa_flow as flow
from app.assistant.channels import platforms


def test_sylheti_banglish_is_bangla():
    for t in ("Bala ni", "Koi", "kita koro", "apnar dam koto"):
        assert brain.detect_lang(t) == "bn", t
    assert brain.detect_lang("What is the price of a website?") == "en"


def test_phone_auto_is_off_by_default_and_parsed():
    assert platforms.settings_for({}, "whatsapp")["phone_auto"] is False
    assert platforms.settings_for({"platforms": {"whatsapp": {"phone_auto": True}}}, "whatsapp")["phone_auto"] is True
    assert platforms.settings_for({"platforms": {"whatsapp": {"phone_auto": "yes"}}}, "whatsapp")["phone_auto"] is False


def _contact(**kw):
    base = dict(channel="notif", phone="notif:com.whatsapp:Rahim", category="business", is_vip=False, tags=None, mode="inherit")
    base.update(kw)
    return SimpleNamespace(**base)


def test_phone_chat_needs_platform_opt_in():
    cfg = {"mode": "auto", "categories": {"business": {"auto": True}}}
    assert flow.effective_mode(cfg, _contact()) == "draft"
    cfg["platforms"] = {"whatsapp": {"phone_auto": True}}
    assert flow.effective_mode(cfg, _contact()) == "auto"
    cfg["mode"] = "shadow"  # the global "drafts only" switch still wins
    assert flow.effective_mode(cfg, _contact()) == "draft"


def test_personal_phone_chat_stays_draft_even_with_opt_in():
    cfg = {"mode": "auto", "categories": {"personal": {"auto": False}}, "platforms": {"whatsapp": {"phone_auto": True}}}
    assert flow.effective_mode(cfg, _contact(category="personal")) == "draft"


def test_explicit_auto_for_one_person_beats_platform_default():
    cfg = {"mode": "auto", "categories": {"business": {"auto": True}}}
    assert flow.effective_mode(cfg, _contact(mode="auto")) == "auto"           # phone chat, platform switch off
    assert flow.effective_mode(cfg, _contact(channel="telegram", phone="tg:1", mode="auto")) == "auto"  # bot chat, bot auto off
    assert flow.effective_mode(cfg, _contact(channel="email", phone="mail:a@b", mode="auto")) == "draft"  # nothing can be sent
    assert flow.effective_mode({**cfg, "mode": "shadow"}, _contact(mode="auto")) == "draft"  # global drafts-only still wins


def test_explicit_auto_never_for_personal():
    cfg = {"mode": "auto", "categories": {"personal": {"auto": False}}}
    assert flow.effective_mode(cfg, _contact(mode="auto", category="personal")) == "draft"


def test_telegram_mode_always_drafts_for_approval():
    cfg = {"mode": "auto", "categories": {"business": {"auto": True}}, "platforms": {"whatsapp": {"phone_auto": True}}}
    assert flow.effective_mode(cfg, _contact(mode="telegram")) == "draft"


def test_approval_keyboard_fits_telegram_limit():
    import uuid
    from app.assistant.channels import telegram
    kb = telegram._approval_keyboard(uuid.uuid4())
    for row in kb["inline_keyboard"]:
        for b in row:
            assert len(b["callback_data"].encode()) <= 64
