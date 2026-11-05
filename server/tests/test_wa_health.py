"""Setup health panel: every tick is a real test and every red item carries the real reason (no network, no database)."""
import asyncio
import copy
from datetime import datetime, timedelta, timezone

from app.assistant import ai_hub, wa_config as wc, wa_flow, wa_health, wa_send


def _now():
    """Evaluated per use: the full suite takes minutes, so a module-level timestamp goes stale before the cron checks run."""
    return datetime.now(timezone.utc)


class FakeDB:
    async def execute(self, *a, **k):
        return None

    async def rollback(self):
        return None


def cfg(**over):
    c = copy.deepcopy(wc.DEFAULT_CONFIG)
    c.update(over)
    return c


def build(monkeypatch, *, creds=None, stored=None, graph=None, conf=None, ai=False, remote=True):
    stored = stored or {}
    graph = graph or {}

    async def load_config(db, force=False):
        return conf or cfg()

    async def get_secrets(db):
        return creds or {}

    async def get_val(db, key):
        return stored.get(key, "")

    async def graph_get(c, path, params=None, token=None):
        if token and "|" in token:
            return graph.get("app_check", (True, {"id": path}))
        return graph.get(path.split("/")[-1] if path.endswith("subscribed_apps") else path, (False, {"error": {"status": 0, "message": "no stub"}}))

    async def has_ai(db):
        return ai

    monkeypatch.setattr(wc, "load_config", load_config)
    monkeypatch.setattr(wc, "get_secrets", get_secrets)
    monkeypatch.setattr(wa_flow, "_get_val", get_val)
    monkeypatch.setattr(wa_send, "graph_get", graph_get)
    monkeypatch.setattr(ai_hub, "has_connections", has_ai)
    return asyncio.run(wa_health.build(FakeDB(), remote))


def by(out):
    return {i["key"]: i for i in out["items"]}


GOOD = {"phone_number_id": "111", "token": "tok", "app_secret": "sec", "waba_id": "222"}
GRAPH_OK = {
    "111": (True, {"display_phone_number": "+880 1700-000000", "verified_name": "ABO", "quality_rating": "GREEN"}),
    "debug_token": (True, {"data": {"is_valid": True, "app_id": "999", "expires_at": 0, "scopes": ["whatsapp_business_messaging", "whatsapp_business_management"]}}),
    "subscribed_apps": (True, {"data": [{"id": "999"}]}),
}


def test_nothing_configured_is_todo_not_green(monkeypatch):
    out = by_summary = build(monkeypatch)
    items = by(out)
    assert out["summary"] == "todo"
    assert items["creds"]["state"] == "todo" and items["meta"]["state"] == "todo" and items["incoming"]["state"] == "todo"
    assert items["creds"]["fix"]["tab"] == "secrets"
    assert by_summary["bad"] == 0


def test_everything_real_is_green(monkeypatch):
    stored = {wa_health.HOOK_VERIFIED: _now().isoformat(), wa_health.HOOK_OK: _now().isoformat(), "cron_seen_wa": _now().isoformat()}
    out = build(monkeypatch, creds=GOOD, stored=stored, graph=GRAPH_OK, conf=cfg(enabled=True), ai=True)
    items = by(out)
    assert out["summary"] == "ok" and out["bad"] == 0 and out["todo"] == 0
    assert items["meta"]["state"] == "ok" and "+880 1700-000000" in items["meta"]["detail"]
    assert items["token"]["state"] == "ok" and "স্থায়ী" in items["token"]["detail"]
    assert items["subscribed"]["state"] == "ok" and items["enabled"]["state"] == "ok"


def test_bad_token_shows_plain_reason_raw_meta_text_and_fix_link(monkeypatch):
    err = {"error": {"status": 400, "code": 190, "message": "Error validating access token: Session has expired"}}
    out = build(monkeypatch, creds=GOOD, graph={"111": (False, err), "debug_token": (False, err)})
    meta = by(out)["meta"]
    assert meta["state"] == "bad" and out["summary"] == "bad"
    assert "মেয়াদ শেষ" in meta["detail"] and "Session has expired" in meta["meta"]
    assert meta["fix"]["href"].startswith("https://business.facebook.com/settings")


def test_wrong_phone_id_and_missing_permission_are_told_apart():
    assert "Phone Number ID ভুল" in wa_send.explain({"status": 400, "code": 100, "message": "Unsupported get request. Object with ID '111' does not exist"})
    assert "অনুমতি" in wa_send.explain({"status": 403, "code": 10, "message": "(#10) Application does not have permission"})
    assert "সীমিত" in wa_send.explain({"status": 429, "code": 4, "message": "rate"})


def test_token_without_required_scopes_is_red(monkeypatch):
    graph = {**GRAPH_OK, "debug_token": (True, {"data": {"is_valid": True, "app_id": "9", "expires_at": 0, "scopes": ["whatsapp_business_messaging"]}})}
    token = by(build(monkeypatch, creds=GOOD, graph=graph))["token"]
    assert token["state"] == "bad" and "whatsapp_business_management" in token["detail"]


def test_expiring_token_is_amber(monkeypatch):
    soon = int((_now() + timedelta(days=2)).timestamp())
    graph = {**GRAPH_OK, "debug_token": (True, {"data": {"is_valid": True, "app_id": "9", "expires_at": soon, "scopes": list(wa_health.REQUIRED_SCOPES)}})}
    assert by(build(monkeypatch, creds=GOOD, graph=graph))["token"]["state"] == "warn"


def test_meta_message_with_wrong_app_secret_is_red(monkeypatch):
    stored = {wa_health.HOOK_OK: (_now() - timedelta(hours=2)).isoformat(), wa_health.HOOK_BAD: _now().isoformat()}
    incoming = by(build(monkeypatch, creds=GOOD, stored=stored, graph=GRAPH_OK))["incoming"]
    assert incoming["state"] == "bad" and "App Secret মেলেনি" in incoming["detail"]


def test_old_signature_failure_is_not_blamed_on_a_newer_secret(monkeypatch):
    stored = {wa_health.HOOK_BAD: (_now() - timedelta(minutes=8)).isoformat(), "wa_app_secret_saved_at": (_now() - timedelta(minutes=2)).isoformat()}
    inc = by(build(monkeypatch, creds=GOOD, stored=stored, graph=GRAPH_OK))["incoming"]
    assert inc["state"] == "todo" and "নতুন মেসেজ" in inc["detail"]
    after = {wa_health.HOOK_BAD: _now().isoformat(), "wa_app_secret_saved_at": (_now() - timedelta(minutes=5)).isoformat()}
    assert by(build(monkeypatch, creds=GOOD, stored=after, graph=GRAPH_OK))["incoming"]["state"] == "bad"  # failed again AFTER the new secret


def test_cron_states(monkeypatch):
    assert by(build(monkeypatch, remote=False))["cron"]["state"] == "todo"
    stale = {"cron_seen_wa": (_now() - timedelta(minutes=30)).isoformat()}
    cron = by(build(monkeypatch, stored=stale, remote=False))["cron"]
    assert cron["state"] == "bad" and "cron-job.org" in cron["fix"]["label"]
    fresh = {"cron_seen_wa": _now().isoformat()}
    assert by(build(monkeypatch, stored=fresh, remote=False))["cron"]["state"] == "ok"


def test_main_number_guard_is_reported(monkeypatch):
    c = cfg()
    c["readiness"]["target"] = "main"
    safety = by(build(monkeypatch, conf=c, remote=False))["safety"]
    assert safety["state"] == "bad" and safety["fix"]["tab"] == "readiness"


def test_event_summary_shows_kind_only_never_text_or_numbers():
    lines = wa_health.summarize({"entry": [{"changes": [
        {"field": "messages", "value": {"messages": [{"type": "text", "text": {"body": "secret words"}, "from": "8801700000000"}], "metadata": {"phone_number_id": "1433965813128503"}}},
        {"field": "messages", "value": {"statuses": [{"status": "sent"}, {"status": "delivered"}]}},
    ]}]})
    assert len(lines) == 2 and "text" in lines[0] and "8503" in lines[0]
    assert "secret" not in " ".join(lines) and "8801700000000" not in " ".join(lines)
    assert "delivered" in lines[1] and "sent" in lines[1]
    assert wa_health.summarize({}) == ["খালি বা চেনা যায়নি"]


def test_app_secret_is_checked_against_meta_not_just_stored(monkeypatch):
    wrong = {"error": {"status": 400, "code": 190, "message": "Invalid OAuth access token signature."}}
    out = by(build(monkeypatch, creds=GOOD, graph={**GRAPH_OK, "app_check": (False, wrong)}))
    assert out["secret"]["state"] == "bad" and "OAuth access token signature" in out["secret"]["meta"]
    assert out["secret"]["fix"]["tab"] == "secrets"
    good = by(build(monkeypatch, creds=GOOD, graph=GRAPH_OK))
    assert good["secret"]["state"] == "ok" and "Meta যাচাই করেছে" in good["secret"]["detail"]
    assert [i["key"] for i in build(monkeypatch, creds=GOOD, graph=GRAPH_OK)["items"]].count("secret") == 1
