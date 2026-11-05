"""Any-provider AI: key detection, OpenAI-compatible and Claude calls, model probing."""
import asyncio
import json

import httpx
import pytest

from app.assistant import ai_providers as ap


@pytest.mark.parametrize("key,prov", [
    ("AIzaSyX", "gemini"), ("AQ.Ab12", "gemini"), ("sk-ant-api03-x", "anthropic"), ("sk-or-v1-x", "openrouter"),
    ("gsk_abc", "groq"), ("xai-abc", "xai"), ("sk-proj-abc", "openai"), ("whatever-123", "custom"),
])
def test_detect(key, prov):
    assert ap.detect(key) == prov


def _mock(monkeypatch, handler):
    real = httpx.AsyncClient
    seen: list[httpx.Request] = []

    def wrapped(request):
        seen.append(request)
        return handler(request)

    monkeypatch.setattr(ap.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(wrapped)))
    return seen


def test_openai_compatible_json(monkeypatch):
    seen = _mock(monkeypatch, lambda r: httpx.Response(200, json={"choices": [{"message": {"content": '{"a": 1}'}}]}))
    out = asyncio.run(ap.generate("groq", "gsk_x", "llama", "sys", "hi", json_mode=True))
    assert out == '{"a": 1}'
    body = json.loads(seen[0].content)
    assert seen[0].url == "https://api.groq.com/openai/v1/chat/completions"
    assert body["response_format"] == {"type": "json_object"} and seen[0].headers["authorization"] == "Bearer gsk_x"


def test_openai_retries_without_json_mode(monkeypatch):
    calls = []

    def h(r):
        calls.append(json.loads(r.content))
        return httpx.Response(400, json={"error": {"message": "response_format unsupported"}}) if len(calls) == 1 else \
            httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})
    _mock(monkeypatch, h)
    assert asyncio.run(ap.generate("custom", "k", "m", "s", "u", base_url="https://my.ai/v1", json_mode=True)) == "ok"
    assert "response_format" not in calls[1]


def test_anthropic(monkeypatch):
    seen = _mock(monkeypatch, lambda r: httpx.Response(200, json={"content": [{"type": "text", "text": "হ্যালো"}]}))
    assert asyncio.run(ap.generate("anthropic", "sk-ant-x", "claude-haiku-5-5", "s", "u")) == "হ্যালো"
    assert seen[0].url == "https://api.anthropic.com/v1/messages" and seen[0].headers["x-api-key"] == "sk-ant-x"


def test_find_model_bad_key(monkeypatch):
    _mock(monkeypatch, lambda r: httpx.Response(401, json={"error": {"message": "invalid key"}}))
    model, err = asyncio.run(ap.find_model("openai", "sk-bad", "", "gpt-x"))
    assert model == "" and "invalid key" in err


def test_find_model_uses_listed(monkeypatch):
    def h(r):
        if r.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "text-embedding-3"}, {"id": "deepseek-chat"}]})
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})
    _mock(monkeypatch, h)
    assert asyncio.run(ap.find_model("deepseek", "sk-x")) == ("deepseek-chat", "")
