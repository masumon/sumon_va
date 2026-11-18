import base64
import pytest
from fastapi import HTTPException

from app.api.v1.routes import wa_assistant as wa
from app.assistant import ai_hub


@pytest.mark.asyncio
async def test_analyze_media_audio_calls_vision(monkeypatch):
    captured = {}

    async def fake_run(db, task, system, user, *, images=None, json_mode=False, max_tokens=None, **kw):
        captured["task"] = task
        captured["images"] = images
        return "ভয়েস: কাল সকাল ১০টায় দেখা হবে।"

    monkeypatch.setattr(ai_hub, "run", fake_run)
    payload = wa.AnalyzeMediaIn(mime="audio/ogg", data_b64=base64.b64encode(b"fake-ogg-bytes").decode(), name="voice.opus")
    res = await wa.analyze_media(payload, db=None, _a="dev")
    assert res.data["ok"] is True
    assert res.data["kind"] == "audio"
    assert "সকাল ১০টায়" in res.data["summary"]
    assert captured["task"] == "vision"
    assert captured["images"] == [("audio/ogg", b"fake-ogg-bytes")]


@pytest.mark.asyncio
async def test_analyze_media_image_calls_vision(monkeypatch):
    async def fake_run(db, task, system, user, *, images=None, **kw):
        return "রসিদে ১,৫০০ টাকা লেখা আছে।"

    monkeypatch.setattr(ai_hub, "run", fake_run)
    payload = wa.AnalyzeMediaIn(mime="image/jpeg; charset=utf-8", data_b64=base64.b64encode(b"fake-jpg").decode())
    res = await wa.analyze_media(payload, db=None, _a="dev")
    assert res.data["ok"] is True
    assert res.data["kind"] == "image"
    assert "১,৫০০" in res.data["summary"]


@pytest.mark.asyncio
async def test_analyze_media_rejects_unsupported_mime():
    payload = wa.AnalyzeMediaIn(mime="application/pdf", data_b64=base64.b64encode(b"pdf").decode())
    with pytest.raises(HTTPException) as exc:
        await wa.analyze_media(payload, db=None, _a="dev")
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_analyze_media_rejects_oversize():
    big = base64.b64encode(b"x" * 5_000_001).decode()
    payload = wa.AnalyzeMediaIn(mime="image/png", data_b64=big)
    with pytest.raises(HTTPException) as exc:
        await wa.analyze_media(payload, db=None, _a="dev")
    assert exc.value.status_code == 413
