"""Google AI layer: verify before save, never break chat, never leak numbers."""
import httpx
import pytest

from app.assistant import ai_gemini as ai

pytestmark = pytest.mark.asyncio

FACTS = {"site": "ABO Enterprise", "phone": "01885411007", "whatsapp": "01885411007"}
GOOD_KEY = "AIzaSyA1234567890abcdefghijklmnopqrstuv"
AQ_KEY = "AQ.Ab8RN6Lx2kQ9vT3mPz7wY1cD4fG6hJ8kL0nB"


@pytest.fixture(autouse=True)
def _reset():
    ai.invalidate()
    ai._usage.update(day=None, count=0)
    yield
    ai.invalidate()


def _cfg(**over):
    cfg = {"key": GOOD_KEY, "model": "gemini-3.8-flash", "auth": "header", "model_raw": "gemini-3.8-flash",
           "enabled": True, "daily_cap": 300, "hint": "AIza…stuv", "verified_at": ""}
    cfg.update(over)

    async def load(_db):
        return cfg

    return load


def _google(monkeypatch, handler):
    """Route every httpx call made by ai_gemini through a fake Google."""
    real = httpx.AsyncClient
    seen: list[httpx.Request] = []

    def wrapped(request):
        seen.append(request)
        return handler(request)

    monkeypatch.setattr(ai.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(wrapped)))
    return seen


def _ok(text="OK"):
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": text}]}}]})


async def test_malformed_key_is_rejected_without_calling_google(monkeypatch):
    seen = _google(monkeypatch, lambda r: _ok())
    res = await ai.verify_key("not a key")
    assert not res.ok and "কী" in res.message_bn and not seen


async def test_classic_key_uses_newest_listed_flash_model(monkeypatch):
    def handler(r):
        if r.method == "GET":
            return httpx.Response(200, json={"models": [
                {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/gemini-3.8-flash", "supportedGenerationMethods": ["generateContent"]},
                {"name": "models/gemini-3.8-flash-tts", "supportedGenerationMethods": ["generateContent"]},
            ]})
        assert r.headers["x-goog-api-key"] == GOOD_KEY
        return _ok()

    _google(monkeypatch, handler)
    res = await ai.verify_key(GOOD_KEY)
    assert res.ok and res.model == "gemini-3.8-flash"


async def test_retired_models_are_skipped(monkeypatch):
    def handler(r):
        if r.method == "GET":
            return httpx.Response(200, json={"models": []})
        if "gemini-flash-latest" in str(r.url) or "gemini-3.8" in str(r.url):
            return httpx.Response(404, json={"error": {"message": "not found"}})
        return _ok()

    _google(monkeypatch, handler)
    res = await ai.verify_key(GOOD_KEY)
    assert res.ok and res.model == "gemini-3.7-flash"


@pytest.mark.parametrize("status,needle", [(400, "সঠিক নয়"), (403, "অনুমতি নেই"), (429, "সীমা")])
async def test_verify_maps_google_errors_to_plain_bangla(monkeypatch, status, needle):
    _google(monkeypatch, lambda r: httpx.Response(200, json={"models": []}) if r.method == "GET"
            else httpx.Response(status, json={"error": {"message": "API key not valid"}}))
    res = await ai.verify_key(GOOD_KEY)
    assert not res.ok and needle in res.message_bn and "Google:" in res.message_bn


async def test_aq_keys_fall_back_to_bearer_auth(monkeypatch):
    def handler(r):
        if r.headers.get("authorization") == f"Bearer {AQ_KEY}":
            return httpx.Response(200, json={"models": []}) if r.method == "GET" else _ok()
        return httpx.Response(401, json={"error": {"message": "expected OAuth 2 access token"}})

    seen = _google(monkeypatch, handler)
    res = await ai.verify_key(AQ_KEY)
    assert res.ok and res.model.endswith("@bearer")
    assert all("generativelanguage.googleapis.com" in str(r.url) for r in seen)


async def test_no_model_found_reports_google_reason(monkeypatch):
    _google(monkeypatch, lambda r: httpx.Response(200, json={"models": []}) if r.method == "GET"
            else httpx.Response(404, json={"error": {"message": "models/x is not found"}}))
    res = await ai.verify_key(GOOD_KEY)
    assert not res.ok and "পাওয়া যায়নি" in res.message_bn and "not found" in res.message_bn


async def test_answer_is_none_when_disabled_or_without_key(monkeypatch):
    monkeypatch.setattr(ai, "load_config", _cfg(enabled=False))
    assert await ai.answer(None, "q", "bn", "facts", FACTS) is None
    monkeypatch.setattr(ai, "load_config", _cfg(key=""))
    assert await ai.answer(None, "q", "bn", "facts", FACTS) is None


async def test_answer_falls_back_quietly_on_google_failure(monkeypatch):
    monkeypatch.setattr(ai, "load_config", _cfg())

    async def gen(*a, **k):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(ai, "_generate", gen)
    assert await ai.answer(None, "q", "bn", "facts", FACTS) is None


async def test_answer_uses_saved_auth_masks_numbers_and_respects_daily_cap(monkeypatch):
    monkeypatch.setattr(ai, "load_config", _cfg(daily_cap=1, auth="bearer"))
    sent = {}

    async def gen(client, key, model, system, user, max_tokens=400, auth="header"):
        sent.update(user=user, system=system, auth=auth)
        return "## উত্তর\n**হ্যাঁ**, আমরা করি।"

    monkeypatch.setattr(ai, "_generate", gen)
    out = await ai.answer(None, "আমার নম্বর 01712345678, mail me@x.com", "bn", "FACTS", FACTS)
    assert out == "উত্তর\nহ্যাঁ, আমরা করি।"
    assert sent["auth"] == "bearer"
    assert "01712345678" not in sent["user"] and "me@x.com" not in sent["user"]
    assert "Bangla" in sent["system"] and "01885411007" in sent["system"]
    assert await ai.answer(None, "again", "bn", "FACTS", FACTS) is None


async def test_empty_reply_from_thinking_model_still_counts_as_working(monkeypatch):
    _google(monkeypatch, lambda r: httpx.Response(200, json={"models": []}) if r.method == "GET"
            else httpx.Response(200, json={"candidates": [{"finishReason": "MAX_TOKENS", "content": {"role": "model"}}]}))
    res = await ai.verify_key(GOOD_KEY)
    assert res.ok and res.model == "gemini-flash-latest"
