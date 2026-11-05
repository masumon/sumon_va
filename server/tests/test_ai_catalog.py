"""AI catalog helpers: drafts from photos (mocked Google), never an invented
selling price, category only from existing slugs, graceful Bangla errors."""
import json

import httpx
import pytest

from app.assistant import ai_catalog as ac
from app.assistant import ai_gemini as ai

GOOD_KEY = "AIzaSyA1234567890abcdefghijklmnopqrstuv"


@pytest.fixture(autouse=True)
def _reset():
    ai.invalidate()
    ai._usage.update(day=None, count=0)
    yield
    ai.invalidate()


def _cfg(monkeypatch, **over):
    cfg = {"key": GOOD_KEY, "model": "gemini-3.8-flash", "auth": "header", "model_raw": "gemini-3.8-flash",
           "enabled": True, "daily_cap": 300, "hint": "", "verified_at": ""}
    cfg.update(over)

    async def load(_db):
        return cfg

    monkeypatch.setattr(ai, "load_config", load)


def _google(monkeypatch, handler):
    real = httpx.AsyncClient
    seen: list[httpx.Request] = []

    def wrapped(request):
        seen.append(request)
        return handler(request)

    monkeypatch.setattr(ai.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(wrapped)))
    return seen


def _reply(obj, fenced=False):
    text = json.dumps(obj, ensure_ascii=False)
    if fenced:
        text = f"```json\n{text}\n```"
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": text}]}}]})


AI_REPLY = {"products": [
    {"image_indexes": [0, 1, 9], "name_bn": "ফাস্ট চার্জার", "name_en": "Fast Charger 33W", "brand": "Baseus",
     "category_slug": "chargers", "description_bn": ["৩৩W চার্জ", "USB-A"], "description_en": "33W\n• USB-A",
     "specifications": {"Output": "33W", "": "x"}, "printed_cost_price": "৳ ৯৫০", "price": 99999},
    {"name_en": "Cable", "category_slug": "invented-cat", "printed_cost_price": None},
    {"name_bn": "", "name_en": ""},
]}


@pytest.mark.asyncio
async def test_drafts_from_photos_parse_and_price_rule(monkeypatch):
    _cfg(monkeypatch)
    seen = _google(monkeypatch, lambda r: _reply(AI_REPLY, fenced=True))
    raw = await ai.generate_json(None, ac.PHOTO_SYSTEM, "x", [("image/jpeg", b"\xff\xd8abc"), ("image/png", b"png")])
    body = json.loads(seen[0].content)
    parts = body["contents"][0]["parts"]
    assert parts[1]["inline_data"]["mime_type"] == "image/jpeg" and len(parts) == 3
    assert body["generationConfig"]["responseMimeType"] == "application/json"

    drafts = ac.normalize_drafts(raw, {"chargers"}, image_count=2, margin_percent=30)
    assert len(drafts) == 2
    d = drafts[0]
    assert d["image_indexes"] == [0, 1]                         # out-of-range index dropped
    assert d["cost_price"] == 950.0 and d["price"] == 1240.0    # 950*1.3=1235 -> ceil to 10
    assert d["description_en"] == "• 33W\n• USB-A"
    assert d["specifications"] == {"Output": "33W"} and d["slug"] == "fast-charger-33w"
    assert drafts[1]["category"] == "" and drafts[1]["price"] is None  # no invented category / price
    assert ai.usage_today() == 1


def test_never_a_price_without_margin_or_cost():
    raw = {"products": [{"name_en": "A", "printed_cost_price": 500, "price": 800, "selling_price": 900}]}
    assert ac.normalize_drafts(raw, set(), 1, None)[0]["price"] is None
    assert ac.price_from_margin(None, 30) is None
    assert ac.price_from_margin(100, 0) == 100.0


@pytest.mark.asyncio
async def test_generate_json_errors_are_bangla(monkeypatch):
    _cfg(monkeypatch, enabled=False)
    with pytest.raises(ai.AiUnavailable) as e:
        await ai.generate_json(None, "s", "u")
    assert "AI চালু নেই" in e.value.message_bn and e.value.status == 400

    _cfg(monkeypatch, daily_cap=1)
    ai._usage.update(day=ai.date.today().isoformat(), count=1)
    with pytest.raises(ai.AiUnavailable) as e:
        await ai.generate_json(None, "s", "u")
    assert e.value.status == 429

    ai._usage.update(day=None, count=0)
    _google(monkeypatch, lambda r: httpx.Response(429, json={"error": {"message": "quota"}}))
    with pytest.raises(ai.AiUnavailable) as e:
        await ai.generate_json(None, "s", "u")
    assert "ফ্রি সীমা" in e.value.message_bn

    _google(monkeypatch, lambda r: httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "sorry"}]}}]}))
    with pytest.raises(ai.AiUnavailable):
        await ai.generate_json(None, "s", "u")


def test_describe_normalisation():
    out = ac.normalize_description({"description_bn": "ভালো", "description_en": "Good", "features_bn": ["• এক", ""],
                                    "faq": [{"q_bn": "প্রশ্ন", "a_bn": "উত্তর"}, {"x": 1}]})
    assert out["features_bn"] == ["এক"] and len(out["faq"]) == 1 and out["faq"][0]["q_en"] == ""


def test_booking_fields_normalisation():
    raw = {"fields": [
        {"label_bn": "কাগজের সাইজ", "label_en": "Paper size", "field_type": "select", "required": True,
         "options": [{"bn": "A4", "en": "A4"}, {"bn": "A3", "en": "A3"}]},
        {"label_bn": "কাগজের সাইজ", "label_en": "Paper size", "field_type": "select"},  # duplicate
        {"label_bn": "রঙ", "label_en": "Colour", "field_type": "radio", "options": ["Colour"]},  # 1 option → text
        {"label_en": "File", "field_type": "weird"},
        "junk",
    ]}
    out = ac.normalize_booking_fields(raw)
    assert [f["field_label_en"] for f in out] == ["Paper size", "Colour", "File"]
    assert out[0]["field_type"] == "select" and out[0]["is_required"] and len(out[0]["options"]) == 2
    assert out[1]["field_type"] == "text" and out[1]["options"] == []
    assert out[2]["field_type"] == "text" and out[2]["field_label_bn"] == "File"


def test_service_details_normalisation():
    raw = {
        "steps": [{"title_bn": "অর্ডার", "title_en": "Order", "desc_bn": "জানান", "desc_en": "Tell us"}, {"x": 1}],
        "benefits": [{"bn": "দ্রুত", "en": "Fast"}, "Cheap"],
        "faq": [{"q_bn": "কত সময়?", "a_bn": "১ দিন", "q_en": "How long?", "a_en": "1 day"}],
        "packages": [{"name": "Basic", "features": ["A4", ""], "days": 2}, {"name": ""}],
    }
    out = ac.normalize_service_details(raw, ["steps", "benefits", "faq", "packages"])
    assert out["process_steps"] == [{"step": 1, "title": "Order", "title_bn": "অর্ডার", "description": "Tell us", "description_bn": "জানান"}]
    assert out["benefits"][1] == {"en": "Cheap", "bn": "Cheap"}
    assert out["faq"][0]["answer_bn"] == "১ দিন"
    assert out["packages"] == [{"tier_name": "Basic", "description_bn": "", "description_en": "", "duration_days": 2, "features": ["A4"]}]
    assert "requirements" not in out


def test_write_endpoint_validation():
    from app.api.v1.routes.ai_catalog import WriteIn, _WRITE_TASKS

    assert {"improve", "to_en", "to_bn", "write", "seo"} <= set(_WRITE_TASKS)
    assert WriteIn(task="to_bn", text="Hello").task == "to_bn"
    import pydantic
    with pytest.raises(pydantic.ValidationError):
        WriteIn(task="hack", text="x")


def test_category_ideas_normalisation():
    raw = {"items": [{"name_bn": "চার্জার", "name_en": "Chargers", "icon": "🔌"}, {"name_bn": "কেবল", "name_en": "Cables"}, {"name_en": "Chargers"}, "x"]}
    out = ac.normalize_category_ideas(raw, ["Cables"])
    assert out == [{"name_bn": "চার্জার", "name_en": "Chargers", "icon": "🔌"}]


def test_blog_normalisation_keeps_only_catalogue_ids():
    raw = {"title_bn": "চার্জার গাইড", "content_bn": "## শুরু", "product_ids": ["p1", "zzz"], "service_ids": ["s9"], "tags": ["a", ""]}
    out = ac.normalize_blog(raw, {"p1", "p2"}, {"s1"})
    assert out["product_ids"] == ["p1"] and out["service_ids"] == []
    assert out["title_en"] == "চার্জার গাইড" and out["content_en"] == "## শুরু" and out["tags"] == ["a"]
