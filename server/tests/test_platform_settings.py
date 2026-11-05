"""Per-platform settings: who may be auto-answered, hours, alert choice, pausing (no network, no database)."""
import copy
from types import SimpleNamespace

from app.assistant import wa_config as wc
from app.assistant import wa_flow
from app.assistant.channels import platforms as pf


def cfg(**plat):
    c = copy.deepcopy(wc.DEFAULT_CONFIG)
    c["mode"] = "auto"
    for k, v in plat.items():
        c["platforms"].setdefault(k, {}).update(v)
    return c


def who(channel="whatsapp", phone="8801700000000", category="business", **kw):
    return SimpleNamespace(channel=channel, phone=phone, mode="inherit", category=category, is_vip=kw.get("vip", False), tags=kw.get("tags"), is_family=kw.get("family", False))


def test_every_platform_has_defaults():
    assert set(pf.KEYS) <= set(wc.DEFAULT_CONFIG["platforms"])
    assert pf.settings_for(wc.DEFAULT_CONFIG, "messenger") == pf.DEFAULT


def test_platform_key_from_channel_and_phone_app():
    assert pf.platform_key(who("telegram")) == "telegram" and pf.platform_key(who("device")) == "sms"
    assert pf.platform_key(who("notif", "notif:com.linkedin.android:Rahim")) == "linkedin"
    assert pf.platform_key(who("notif", "notif:com.zhiliaoapp.musically:x")) == "tiktok"
    assert pf.platform_key(who("notif", "notif:com.facebook.orca:x")) == "messenger"
    assert pf.platform_key(who("notif", "notif:com.unknown:x")) == "other"


def test_bad_values_repair_to_safe_defaults():
    s = pf.settings_for({"platforms": {"telegram": {"enabled": "yes", "auto_for": "everyone", "alerts": 5, "hours_from": "25:99", "hours_on": 1}}}, "telegram")
    assert s == pf.DEFAULT


def test_auto_for_business_only():
    s = pf.settings_for(cfg(telegram={"auto_for": "business"}), "telegram")
    assert pf.auto_ok(s, "business", False, 600) and not pf.auto_ok(s, "personal", False, 600)


def test_auto_for_known_people_only():
    s = pf.settings_for(cfg(telegram={"auto_for": "known"}), "telegram")
    assert pf.auto_ok(s, "business", True, 600) and not pf.auto_ok(s, "business", False, 600)


def test_hours_including_overnight_window():
    s = pf.settings_for(cfg(sms={"hours_on": True, "hours_from": "09:00", "hours_to": "21:00"}), "sms")
    assert pf.inside_hours(s, 10 * 60) and not pf.inside_hours(s, 22 * 60)
    n = pf.settings_for(cfg(sms={"hours_on": True, "hours_from": "22:00", "hours_to": "06:00"}), "sms")
    assert pf.inside_hours(n, 23 * 60) and pf.inside_hours(n, 2 * 60) and not pf.inside_hours(n, 12 * 60)


def test_paused_platform_never_auto():
    s = pf.settings_for(cfg(telegram={"enabled": False}), "telegram")
    assert not pf.auto_ok(s, "business", True, 600)


def test_alert_choices_family_always_passes():
    off = pf.settings_for(cfg(whatsapp={"alerts": "off"}), "whatsapp")
    urg = pf.settings_for(cfg(whatsapp={"alerts": "urgent"}), "whatsapp")
    assert not pf.may_alert(off, 1, False) and pf.may_alert(off, 3, True)
    assert pf.may_alert(urg, 1, False) and not pf.may_alert(urg, 3, False)


def test_effective_mode_follows_platform_settings_but_never_beats_global_rules():
    c = cfg(telegram={"auto_for": "business"})
    c["channels"]["telegram"].update(enabled=True, auto=True)
    assert wa_flow.effective_mode(c, who("telegram", "tg:1", "business")) == "auto"
    assert wa_flow.effective_mode(c, who("telegram", "tg:1", "personal")) == "draft"
    c["mode"] = "shadow"
    assert wa_flow.effective_mode(c, who("telegram", "tg:1", "business")) == "draft"


def test_sanitise_keeps_only_known_platform_keys():
    out = wc.sanitize({"platforms": {"telegram": {"alerts": "off", "evil": 1}, "nope": {"enabled": False}}}, {"platforms": wc.DEFAULT_CONFIG["platforms"]})
    assert out["platforms"].keys() == {"telegram"} and out["platforms"]["telegram"] == {"alerts": "off"}
