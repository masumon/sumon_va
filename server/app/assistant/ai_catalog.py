"""AI helpers for the admin catalog: product drafts from photos and bilingual
descriptions from a name/notes. Pure prompt + normalising code (testable
without Google); the HTTP call lives in ai_gemini.generate_json.

Safety rules enforced HERE (not trusted to the model):
- A selling price is NEVER taken from the AI. It is only computed from a cost
  price printed on the photo/box, using the margin the admin chose.
- A suggested category must be one of the existing category slugs.
"""
from __future__ import annotations

import math
import re
from typing import Any

MAX_IMAGES = 10
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024  # Gemini inline request limit is ~20 MB

PHOTO_SYSTEM = (
    "You are a careful catalog assistant for ABO Enterprise, an electronics/accessories shop in Sylhet, Bangladesh. "
    "You look at product photos (boxes, labels, the product itself) and write draft product listings. "
    "Only state facts you can read or clearly see. Never invent specifications, warranty, prices or brand names. "
    "Bangla must be natural Bangladeshi Bangla in Bengali script. Reply with JSON only."
)

PHOTO_USER = """Photos are numbered from 0 in the order given. Group photos that show the SAME product.
Return JSON: {{"products": [ {{
  "image_indexes": [0, 1],
  "name_bn": "...", "name_en": "...",
  "brand": "brand exactly as printed, or empty",
  "category_slug": "one slug from CATEGORIES or empty",
  "description_bn": ["short bullet", "..."], "description_en": ["short bullet", "..."],
  "specifications": {{"Key": "Value"}},
  "printed_cost_price": null,
  "notes": "anything unclear, in Bangla"
}} ] }}
Rules: 3-6 bullets each language; specifications only from visible text;
printed_cost_price = a purchase/dealer/cost price ONLY if it is clearly printed or handwritten as such (a number in BDT), else null.
Do NOT output any selling price.
CATEGORIES (slug: name): {categories}
{hint}"""

DESCRIBE_SYSTEM = (
    "You write clear, honest product/service copy for ABO Enterprise (Sylhet, Bangladesh). "
    "Use only the facts given; never invent prices, discounts, warranty terms, delivery times or specifications. "
    "Bangla must be natural Bangladeshi Bangla in Bengali script. Reply with JSON only."
)

DESCRIBE_USER = """Write website copy for this {kind}.
Name: {name}
Owner's notes: {notes}
Return JSON: {{"description_bn": "2-4 sentence paragraph", "description_en": "2-4 sentence paragraph",
"features_bn": ["3-6 short bullets"], "features_en": ["3-6 short bullets"],
"faq": [{{"q_bn": "", "a_bn": "", "q_en": "", "a_en": ""}}]}}
Give 2-4 FAQ items answerable from the facts only (else fewer)."""


def _s(v: Any, limit: int = 255) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()[:limit]


def _bullets(v: Any) -> list[str]:
    if isinstance(v, str):
        v = [x for x in re.split(r"[\n•]+", v)]
    if not isinstance(v, list):
        return []
    out = []
    for x in v:
        t = _s(x, 300).lstrip("-•* ").strip()
        if t:
            out.append(t)
    return out[:8]


def bullets_text(items: list[str]) -> str:
    return "\n".join(f"• {b}" for b in items)


def _money(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        n = float(v)
    else:
        digits = str(v).translate(str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789"))
        m = re.search(r"\d[\d,]*(?:\.\d+)?", digits)
        if not m:
            return None
        n = float(m.group(0).replace(",", ""))
    return n if 0 < n < 10_000_000 else None


def price_from_margin(cost: float | None, margin_percent: float | None) -> float | None:
    """Selling price = cost + margin%, rounded UP to the nearest 10 Taka. None
    when there is no printed cost or the admin chose no margin rule."""
    if cost is None or margin_percent is None or margin_percent < 0:
        return None
    return float(math.ceil(cost * (1 + margin_percent / 100) / 10) * 10)


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:120]


def normalize_drafts(raw: Any, category_slugs: set[str], image_count: int,
                     margin_percent: float | None) -> list[dict]:
    items = raw.get("products") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return []
    drafts: list[dict] = []
    for it in items[:MAX_IMAGES]:
        if not isinstance(it, dict):
            continue
        name_en = _s(it.get("name_en"))
        name_bn = _s(it.get("name_bn"))
        if not (name_en or name_bn):
            continue
        idxs = [i for i in (it.get("image_indexes") or []) if isinstance(i, int) and 0 <= i < image_count]
        cat = _s(it.get("category_slug"), 120).lower()
        specs_in = it.get("specifications") if isinstance(it.get("specifications"), dict) else {}
        specs = {_s(k, 80): _s(v, 200) for k, v in specs_in.items() if _s(k, 80) and _s(v, 200)}
        cost = _money(it.get("printed_cost_price"))
        bn, en = _bullets(it.get("description_bn")), _bullets(it.get("description_en"))
        drafts.append({
            "name_bn": name_bn or name_en,
            "name_en": name_en or name_bn,
            "slug": slugify(name_en),
            "brand": _s(it.get("brand"), 100),
            "category": cat if cat in category_slugs else "",
            "description_bn": bullets_text(bn),
            "description_en": bullets_text(en),
            "specifications": dict(list(specs.items())[:20]),
            "cost_price": cost,
            # Never from the AI: only cost + the admin's margin rule.
            "price": price_from_margin(cost, margin_percent),
            "image_indexes": sorted(set(idxs)),
            "notes": _s(it.get("notes"), 400),
        })
    return drafts


def normalize_description(raw: Any) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    faq = []
    for f in raw.get("faq") or []:
        if isinstance(f, dict) and (_s(f.get("q_bn")) or _s(f.get("q_en"))):
            faq.append({k: _s(f.get(k), 500) for k in ("q_bn", "a_bn", "q_en", "a_en")})
    return {
        "description_bn": _s(raw.get("description_bn"), 2000),
        "description_en": _s(raw.get("description_en"), 2000),
        "features_bn": _bullets(raw.get("features_bn")),
        "features_en": _bullets(raw.get("features_en")),
        "faq": faq[:6],
    }


# ── Booking-form questions for a service ────────────────────────────────────
BOOKING_FIELD_TYPES = ("text", "textarea", "number", "email", "phone", "url", "date", "datetime",
                       "select", "multiselect", "radio", "checkbox", "file")

BOOKING_FIELDS_SYSTEM = (
    "You design short, friendly booking/order request forms for ABO Enterprise, a shop in Beanibazar, Sylhet, "
    "Bangladesh. Given a service name and notes, propose the 3-8 questions the shop really needs to quote or do "
    "the job. Do NOT ask for name, phone, e-mail or address (the form already has them). Prefer choices "
    "(select/radio) over free text where the answers are predictable. Allowed field_type values: "
    + ", ".join(BOOKING_FIELD_TYPES) + ". Use 'file' when the customer must send a document or photo. "
    "Labels: natural Bangla (আপনি tone) and clear English. Options: short, in Bangla and English pairs. "
    'Reply as JSON: {"fields": [{"label_bn": "", "label_en": "", "field_type": "", "required": true, '
    '"placeholder_bn": "", "options": [{"bn": "", "en": ""}]}]}'
)

BOOKING_FIELDS_USER = "Service: {name}\nNotes: {notes}"


def normalize_booking_fields(raw: Any) -> list[dict]:
    """Model reply → safe field drafts the admin can review before saving."""
    items = raw.get("fields") if isinstance(raw, dict) else raw
    out: list[dict] = []
    seen: set[str] = set()
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        en = str(it.get("label_en") or "").strip()[:120]
        bn = str(it.get("label_bn") or "").strip()[:120]
        if not (en or bn) or (en or bn).lower() in seen:
            continue
        seen.add((en or bn).lower())
        ftype = str(it.get("field_type") or "text").strip().lower()
        if ftype not in BOOKING_FIELD_TYPES:
            ftype = "text"
        opts: list[dict] = []
        for o in it.get("options") or []:
            if isinstance(o, dict) and (o.get("en") or o.get("bn")):
                opts.append({"en": str(o.get("en") or o.get("bn")).strip()[:80], "bn": str(o.get("bn") or o.get("en")).strip()[:80]})
            elif isinstance(o, str) and o.strip():
                opts.append({"en": o.strip()[:80], "bn": o.strip()[:80]})
        if ftype in ("select", "multiselect", "radio") and len(opts) < 2:
            ftype, opts = "text", []
        out.append({
            "field_label_en": en or bn, "field_label_bn": bn or en, "field_type": ftype,
            "is_required": bool(it.get("required", False)),
            "placeholder": str(it.get("placeholder_bn") or "").strip()[:120] or None,
            "options": opts[:12],
        })
        if len(out) >= 10:
            break
    return out


# ── Service details: steps, benefits, requirements, documents, FAQ, packages ──
SERVICE_DETAILS_SYSTEM = (
    "You write service-page content for ABO Enterprise, a shop in Beanibazar, Sylhet, Bangladesh. "
    "Given a service name and notes, write ONLY the requested parts, each in natural Bangla (polite আপনি, "
    "standard spelling) and clear English. Be practical and honest: never invent prices, guarantees, legal "
    "promises or times that the notes do not support. Keep items short (one line; FAQ answers 1-3 sentences). "
    "Counts: steps 4-6, benefits 4-6, requirements 3-6, documents 2-6, faq 4-8, packages exactly 3 "
    "(Basic/Standard/Premium style, features 3-6 each, no price). "
    'Reply as JSON with any of these keys: {"steps": [{"title_bn":"","title_en":"","desc_bn":"","desc_en":""}], '
    '"benefits": [{"bn":"","en":""}], "requirements": [{"bn":"","en":""}], "documents": [{"bn":"","en":""}], '
    '"faq": [{"q_bn":"","q_en":"","a_bn":"","a_en":""}], '
    '"packages": [{"name":"","desc_bn":"","desc_en":"","days": null, "features": [""]}]}'
)

SERVICE_DETAILS_PARTS = ("steps", "benefits", "requirements", "documents", "faq", "packages")


def normalize_service_details(raw: Any, parts: list[str]) -> dict[str, list]:
    """Model reply → the exact shapes the service record stores."""
    d = raw if isinstance(raw, dict) else {}

    def s(v: Any, n: int = 600) -> str:
        return str(v or "").strip()[:n]

    def pairs(key: str) -> list[dict]:
        out = []
        for it in d.get(key) or []:
            if isinstance(it, dict) and (it.get("bn") or it.get("en")):
                out.append({"en": s(it.get("en") or it.get("bn"), 200), "bn": s(it.get("bn") or it.get("en"), 200)})
            elif isinstance(it, str) and it.strip():
                out.append({"en": s(it, 200), "bn": s(it, 200)})
        return out[:10]

    out: dict[str, list] = {}
    if "steps" in parts:
        steps = [x for x in d.get("steps") or [] if isinstance(x, dict) and (x.get("title_bn") or x.get("title_en"))][:8]
        out["process_steps"] = [{
            "step": i + 1, "title": s(x.get("title_en") or x.get("title_bn"), 150), "title_bn": s(x.get("title_bn"), 150),
            "description": s(x.get("desc_en")), "description_bn": s(x.get("desc_bn")),
        } for i, x in enumerate(steps)]
    if "benefits" in parts:
        out["benefits"] = pairs("benefits")
    if "requirements" in parts:
        out["requirements"] = pairs("requirements")
    if "documents" in parts:
        out["required_documents"] = pairs("documents")
    if "faq" in parts:
        out["faq"] = [{
            "question": s(x.get("q_en") or x.get("q_bn"), 250), "question_bn": s(x.get("q_bn"), 250),
            "answer": s(x.get("a_en") or x.get("a_bn"), 1000), "answer_bn": s(x.get("a_bn"), 1000),
        } for x in d.get("faq") or [] if isinstance(x, dict) and (x.get("q_bn") or x.get("q_en"))][:10]
    if "packages" in parts:
        pk = []
        for x in (d.get("packages") or [])[:4]:
            if not isinstance(x, dict) or not s(x.get("name")):
                continue
            days = x.get("days")
            pk.append({
                "tier_name": s(x.get("name"), 80), "description_bn": s(x.get("desc_bn")), "description_en": s(x.get("desc_en")),
                "duration_days": int(days) if isinstance(days, (int, float)) and 0 < days < 366 else None,
                "features": [s(f, 120) for f in x.get("features") or [] if s(f)][:8],
            })
        out["packages"] = pk
    return out


# ── Category ideas: sub-categories for a category ────────────────────────────
CATEGORY_IDEAS_SYSTEM = (
    "You organise the online catalogue of ABO Enterprise, a mobile-accessories, electronics, printing and "
    "digital-services shop in Bangladesh. Given a category (and what already exists under it), suggest 4-10 "
    "useful sub-categories customers in Bangladesh actually search for. Do not repeat existing ones. Names short "
    "(1-3 words), natural Bangla and clear English, plus one fitting emoji. "
    'Reply as JSON: {"items": [{"name_bn": "", "name_en": "", "icon": ""}]}'
)


def normalize_category_ideas(raw: Any, existing: list[str]) -> list[dict]:
    items = raw.get("items") if isinstance(raw, dict) else raw
    have = {e.strip().lower() for e in existing if e}
    out: list[dict] = []
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        bn = str(it.get("name_bn") or "").strip()[:60]
        en = str(it.get("name_en") or "").strip()[:60]
        if not (bn or en) or bn.lower() in have or en.lower() in have:
            continue
        have.update({bn.lower(), en.lower()})
        out.append({"name_bn": bn or en, "name_en": en or bn, "icon": str(it.get("icon") or "").strip()[:4]})
    return out[:12]



# ── Blog draft from a short idea / photo, plus catalogue items to feature ────
BLOG_SYSTEM = (
    "You are the content writer of ABO Enterprise (mobile accessories, electronics, printing and digital "
    "services; Beanibazar, Sylhet, Bangladesh). From the admin's idea (and photo, if any) write a professional, "
    "helpful blog post for Bangladeshi customers, in natural Bangla (polite আপনি) and clear English. Honest: never "
    "invent prices, guarantees or facts. Structure the content with these plain marks: '## ' section headings, "
    "short paragraphs, '• ' bullet lines, '1. ' steps, **bold** for key words, and end with a friendly call to "
    "action (visit the shop / WhatsApp). 500-900 words per language. Then pick, ONLY from the CATALOGUE list given, "
    "up to 4 products and up to 3 services that genuinely fit the post (use their exact ids). "
    'Reply as JSON: {"title_bn": "", "title_en": "", "excerpt_bn": "", "excerpt_en": "", "content_bn": "", '
    '"content_en": "", "category": "", "tags": [""], "seo_title": "", "seo_description": "", '
    '"product_ids": [""], "service_ids": [""], "why_bn": ""}'
)


def normalize_blog(raw: Any, allowed_products: set[str], allowed_services: set[str]) -> dict:
    d = raw if isinstance(raw, dict) else {}

    def s(k: str, n: int = 20000) -> str:
        return str(d.get(k) or "").strip()[:n]

    return {
        "title_bn": s("title_bn", 200), "title_en": s("title_en", 200) or s("title_bn", 200),
        "excerpt_bn": s("excerpt_bn", 400), "excerpt_en": s("excerpt_en", 400),
        "content_bn": s("content_bn"), "content_en": s("content_en") or s("content_bn"),
        "category": s("category", 60) or "tips",
        "tags": [str(t).strip()[:40] for t in d.get("tags") or [] if str(t).strip()][:10],
        "seo_title": s("seo_title", 70), "seo_description": s("seo_description", 160),
        "product_ids": [str(i) for i in d.get("product_ids") or [] if str(i) in allowed_products][:4],
        "service_ids": [str(i) for i in d.get("service_ids") or [] if str(i) in allowed_services][:3],
        "why_bn": s("why_bn", 500),
    }
