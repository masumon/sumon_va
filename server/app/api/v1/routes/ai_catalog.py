"""Admin AI helpers for the catalog (Google Gemini, same key/cap as the chat
assistant). Nothing here writes to the database: drafts are returned to the
admin, who reviews/edits them and saves through the normal product API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import ai_catalog as ac
from app.assistant import ai_gemini
from app.core.database import get_db
from app.core.security import require_admin, require_role
from app.models.models import Category
from app.schemas.schemas import ApiResponse

router = APIRouter(prefix="/admin/ai-catalog", tags=["admin-ai"])

_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}


def _fail(exc: ai_gemini.AiUnavailable) -> HTTPException:
    return HTTPException(status_code=exc.status, detail=exc.message_bn)


@router.get("/status", response_model=ApiResponse)
async def ai_status(_admin: str = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Whether the AI buttons should be shown (a working key is saved and on)."""
    cfg = await ai_gemini.load_config(db)
    return ApiResponse(data={
        "available": bool(cfg["enabled"] and cfg["key"]),
        "used_today": ai_gemini.usage_today(),
        "daily_cap": cfg["daily_cap"],
    })


@router.post("/products-from-photos", response_model=ApiResponse)
async def products_from_photos(
    files: list[UploadFile] = File(...),
    margin_percent: float | None = Form(None),
    hint: str = Form(""),
    _admin: str = Depends(require_role("products.write")),
    db: AsyncSession = Depends(get_db),
):
    """1-10 product photos -> draft products (not saved). A selling price is only
    suggested from a printed cost price + the admin's margin rule."""
    if not files or len(files) > ac.MAX_IMAGES:
        raise HTTPException(status_code=400, detail=f"১ থেকে {ac.MAX_IMAGES}টি ছবি দিন।")
    images: list[tuple[str, bytes]] = []
    total = 0
    for f in files:
        mime = (f.content_type or "").lower()
        if mime not in _IMAGE_TYPES:
            raise HTTPException(status_code=400, detail=f"'{f.filename}' ছবি নয় — JPG/PNG/WEBP দিন।")
        data = await f.read()
        if not data or len(data) > ac.MAX_IMAGE_BYTES:
            raise HTTPException(status_code=400, detail=f"'{f.filename}' ৪ MB-এর বেশি বা খালি — ছোট ছবি দিন।")
        total += len(data)
        images.append((mime, data))
    if total > ac.MAX_TOTAL_BYTES:
        raise HTTPException(status_code=400, detail="সব ছবি মিলিয়ে ১৬ MB-এর বেশি — কম বা ছোট ছবি দিন।")
    if margin_percent is not None and not (0 <= margin_percent <= 1000):
        raise HTTPException(status_code=400, detail="লাভের হার ০–১০০০% এর মধ্যে দিন।")

    cats = (await db.execute(
        select(Category.slug, Category.name_en, Category.name_bn).where(Category.is_deleted == False, Category.is_active == True)  # noqa: E712
    )).all()
    cat_text = "; ".join(f"{c[0]}: {c[2] or c[1]}" for c in cats)[:4000] or "(none)"
    user = ac.PHOTO_USER.format(categories=cat_text, hint=f"Owner's hint: {hint[:300]}" if hint.strip() else "")
    try:
        raw = await ai_gemini.generate_json(db, ac.PHOTO_SYSTEM, user, images)
    except ai_gemini.AiUnavailable as exc:
        raise _fail(exc)
    drafts = ac.normalize_drafts(raw, {c[0] for c in cats}, len(images), margin_percent)
    if not drafts:
        raise HTTPException(status_code=422, detail="ছবি থেকে কোনো পণ্য চেনা যায়নি — আরও পরিষ্কার ছবি দিন।")
    return ApiResponse(data={"drafts": drafts}, message="AI drafts ready (not saved)")


class DescribeIn(BaseModel):
    kind: str = Field("product", pattern="^(product|service|software|showcase)$")
    name: str = Field(..., min_length=2, max_length=200)
    notes: str = Field("", max_length=1500)


@router.post("/describe", response_model=ApiResponse)
async def describe(payload: DescribeIn, _admin: str = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Name + short notes -> bn/en description, feature bullets and FAQ."""
    user = ac.DESCRIBE_USER.format(kind=payload.kind, name=payload.name.strip(),
                                   notes=ai_gemini._mask(payload.notes.strip()) or "(none)")
    try:
        raw = await ai_gemini.generate_json(db, ac.DESCRIBE_SYSTEM, user, max_tokens=4096)
    except ai_gemini.AiUnavailable as exc:
        raise _fail(exc)
    out = ac.normalize_description(raw)
    if not (out["description_bn"] or out["description_en"]):
        raise HTTPException(status_code=502, detail="AI বিবরণ লিখতে পারেনি — আবার চেষ্টা করুন।")
    return ApiResponse(data=out)


class BookingFieldsIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    notes: str = Field("", max_length=1500)


@router.post("/booking-fields", response_model=ApiResponse)
async def booking_fields(payload: BookingFieldsIn, _admin: str = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Service name + notes -> suggested booking-form questions (nothing is saved)."""
    user = ac.BOOKING_FIELDS_USER.format(name=payload.name.strip(), notes=ai_gemini._mask(payload.notes.strip()) or "(none)")
    try:
        raw = await ai_gemini.generate_json(db, ac.BOOKING_FIELDS_SYSTEM, user, max_tokens=4096)
    except ai_gemini.AiUnavailable as exc:
        raise _fail(exc)
    fields = ac.normalize_booking_fields(raw)
    if not fields:
        raise HTTPException(status_code=502, detail="AI প্রশ্ন প্রস্তাব করতে পারেনি — আবার চেষ্টা করুন।")
    return ApiResponse(data={"fields": fields})


class FromLinkIn(BaseModel):
    url: str = Field(..., min_length=8, max_length=1000)
    kind: str = Field("product", pattern="^(product|service)$")


@router.post("/from-link", response_model=ApiResponse)
async def from_link(payload: FromLinkIn, _admin: str = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Web link (supplier/maker page) -> product/service draft. Nothing is saved.
    Without AI the page's own title, description and image are still returned."""
    from app.assistant import link_import as li

    try:
        final_url, page = await li.fetch_page(payload.url)
    except li.LinkError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:  # noqa: BLE001 — network trouble
        raise HTTPException(status_code=502, detail="পাতাটি খোলা যায়নি — একটু পরে আবার চেষ্টা করুন বা অন্য লিংক দিন।")
    facts = li.extract(final_url, page)
    if not (facts["title"] or facts["text"]):
        raise HTTPException(status_code=422, detail="এই পাতায় কাজে লাগার মতো তথ্য পাওয়া যায়নি।")
    raw: dict = {}
    ai_used = False
    if await ai_gemini.is_available(db):
        user = "FACTS:\n" + "\n".join(f"{k}: {v}" for k, v in facts.items() if v and k != "image_url")
        try:
            raw = await ai_gemini.generate_json(db, li.LINK_SYSTEM.format(kind=payload.kind), ai_gemini._mask(user), max_tokens=4096)
            ai_used = True
        except ai_gemini.AiUnavailable:
            raw = {}
    return ApiResponse(data={**li.normalize_draft(raw, facts), "ai_used": ai_used})


class ServiceDetailsIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    notes: str = Field("", max_length=2000)
    parts: list[str] = Field(default_factory=lambda: list(ac.SERVICE_DETAILS_PARTS))


@router.post("/service-details", response_model=ApiResponse)
async def service_details(payload: ServiceDetailsIn, _admin: str = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Service name + notes -> steps, benefits, requirements, documents, FAQ and/or packages (nothing saved)."""
    parts = [p for p in payload.parts if p in ac.SERVICE_DETAILS_PARTS] or list(ac.SERVICE_DETAILS_PARTS)
    notes = ai_gemini._mask(payload.notes.strip()) or "(none)"
    user = "Service: " + payload.name.strip() + "\nNotes: " + notes + "\nWrite these parts: " + ", ".join(parts)
    try:
        raw = await ai_gemini.generate_json(db, ac.SERVICE_DETAILS_SYSTEM, user, max_tokens=8192)
    except ai_gemini.AiUnavailable as exc:
        raise _fail(exc)
    out = ac.normalize_service_details(raw, parts)
    if not any(out.values()):
        raise HTTPException(status_code=502, detail="AI লিখতে পারেনি — আবার চেষ্টা করুন।")
    return ApiResponse(data=out)


# ── General AI writer: used by every text box in the admin (toolbar ✨) ──────
_WRITE_TASKS = {
    "improve": "Rewrite the text so it reads professionally and naturally for customers. Keep the meaning, facts, numbers, links and formatting marks.",
    "shorten": "Make the text shorter and clearer (about half). Keep key facts, numbers, links and formatting marks.",
    "expand": "Expand the text with helpful, honest detail for customers (about double). Do not invent prices, guarantees or facts.",
    "fix": "Fix spelling, grammar and punctuation only. Change nothing else.",
    "to_en": "Translate the text into clear, natural English for customers. Keep links, numbers, brand names and formatting marks.",
    "to_bn": "Translate the text into natural Bangladeshi Bangla (polite আপনি). Keep links, numbers, brand names and formatting marks.",
    "bullets": "Turn the text into short bullet lines, each starting with '• '. Keep facts and links.",
    "seo": "Write an SEO meta description (max 155 characters) from the text, in the same language.",
    "write": "Follow the instruction to write new text for the shop's website or admin. Be honest; never invent prices or facts.",
}
WRITE_SYSTEM = (
    "You are the in-house copywriter of ABO Enterprise, a mobile-accessories, electronics, printing and "
    "digital-services shop in Beanibazar, Sylhet, Bangladesh. Bangla must be natural and correctly spelt; "
    "English clear. Formatting marks like **bold**, {red}…{/red}, :icon:, '• ', '# ' and [label](url) must be kept "
    "exactly when present. Unless translating, reply in the same language as the input text. Task: "
)


class WriteIn(BaseModel):
    task: str = Field("improve", pattern="^(" + "|".join(_WRITE_TASKS) + ")$")
    text: str = Field("", max_length=8000)
    instruction: str = Field("", max_length=1000)
    context: str = Field("", max_length=300)
    # Optional voice: professional (default) | friendly | sales. Old callers send nothing.
    tone: str = Field("", pattern="^(|professional|friendly|sales)$")


_TONES = {
    "professional": "Tone: professional, trustworthy and clear.",
    "friendly": "Tone: warm, friendly and simple, like talking to a neighbour.",
    "sales": "Tone: persuasive and benefit-focused with a clear call to action — but never invent prices, discounts or guarantees.",
}


@router.post("/write", response_model=ApiResponse)
async def ai_write(payload: WriteIn, _admin: str = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Improve / shorten / expand / fix / translate / bullet / SEO / free-write any admin text. Nothing saved."""
    if payload.task != "write" and not payload.text.strip():
        raise HTTPException(status_code=400, detail="আগে কিছু লিখুন, তারপর AI চাপুন।")
    if payload.task == "write" and not (payload.instruction.strip() or payload.text.strip()):
        raise HTTPException(status_code=400, detail="AI-কে কী লিখতে হবে তা লিখুন।")
    parts = []
    if payload.context.strip():
        parts.append("Where it is used: " + payload.context.strip())
    if payload.tone:
        parts.append(_TONES[payload.tone])
    if payload.instruction.strip():
        parts.append("Instruction: " + ai_gemini._mask(payload.instruction.strip()))
    if payload.text.strip():
        parts.append("TEXT:\n" + payload.text.strip())
    try:
        out = await ai_gemini.generate_text(db, WRITE_SYSTEM + _WRITE_TASKS[payload.task], "\n\n".join(parts), max_tokens=4096)
    except ai_gemini.AiUnavailable as exc:
        raise _fail(exc)
    if not out:
        raise HTTPException(status_code=502, detail="AI কিছু লেখেনি — আবার চেষ্টা করুন।")
    return ApiResponse(data={"text": out})


class CategoryIdeasIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    kind: str = Field("product", pattern="^(product|service|both)$")
    existing: list[str] = Field(default_factory=list, max_length=200)


@router.post("/category-ideas", response_model=ApiResponse)
async def category_ideas(payload: CategoryIdeasIn, _admin: str = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Suggested sub-categories for a category (nothing is saved)."""
    user = "Category: " + payload.name.strip() + " (" + payload.kind + ")\nAlready exists: " + (", ".join(payload.existing[:200]) or "(none)")
    try:
        raw = await ai_gemini.generate_json(db, ac.CATEGORY_IDEAS_SYSTEM, user, max_tokens=2048)
    except ai_gemini.AiUnavailable as exc:
        raise _fail(exc)
    items = ac.normalize_category_ideas(raw, payload.existing)
    if not items:
        raise HTTPException(status_code=502, detail="AI নতুন কিছু প্রস্তাব করতে পারেনি।")
    return ApiResponse(data={"items": items})



@router.post("/blog-draft", response_model=ApiResponse)
async def blog_draft(
    idea: str = Form(..., min_length=3, max_length=2000),
    image: UploadFile | None = File(None),
    _admin: str = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Short idea (+ optional photo) -> full blog draft and matching products/services. Nothing saved."""
    from app.models.models import Product, Service

    images = []
    if image is not None and image.filename:
        if image.content_type not in _IMAGE_TYPES:
            raise HTTPException(status_code=400, detail="শুধু JPG/PNG/WebP ছবি দিন।")
        data = await image.read()
        if len(data) > 8 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="ছবি ৮MB-এর কম হতে হবে।")
        images.append((image.content_type, data))
    prods = (await db.execute(select(Product.id, Product.name_en, Product.name_bn).where(
        Product.is_active == True, Product.is_deleted == False).limit(300))).all()  # noqa: E712
    svcs = (await db.execute(select(Service.id, Service.name_en, Service.name_bn).where(
        Service.is_active == True, Service.is_deleted == False).limit(150))).all()  # noqa: E712
    catalogue = "PRODUCTS:\n" + "\n".join(f"{p.id} | {p.name_bn or ''} | {p.name_en}" for p in prods)
    catalogue += "\nSERVICES:\n" + "\n".join(f"{x.id} | {x.name_bn or ''} | {x.name_en}" for x in svcs)
    user = "IDEA: " + ai_gemini._mask(idea.strip()) + "\n\nCATALOGUE:\n" + catalogue
    try:
        raw = await ai_gemini.generate_json(db, ac.BLOG_SYSTEM, user, images=images or None, max_tokens=8192)
    except ai_gemini.AiUnavailable as exc:
        raise _fail(exc)
    out = ac.normalize_blog(raw, {str(p.id) for p in prods}, {str(x.id) for x in svcs})
    if not (out["content_bn"] or out["content_en"]):
        raise HTTPException(status_code=502, detail="AI ব্লগ লিখতে পারেনি — আবার চেষ্টা করুন।")
    names = {str(p.id): (p.name_bn or p.name_en) for p in prods} | {str(x.id): (x.name_bn or x.name_en) for x in svcs}
    out["suggested"] = [{"id": i, "kind": "product", "name": names.get(i, "")} for i in out["product_ids"]] + \
        [{"id": i, "kind": "service", "name": names.get(i, "")} for i in out["service_ids"]]
    return ApiResponse(data=out)



# ── Generic "✨ AI দিয়ে পূরণ" for any admin form ────────────────────────────────
# The form sends its own field list, so one endpoint serves every editor (team,
# partner logos, registrations, FAQ, reasons, announcements, reviews, hero…).
# Only the requested keys come back; nothing is saved here.

class FillField(BaseModel):
    key: str = Field(..., min_length=1, max_length=60, pattern=r"^[A-Za-z0-9_.]+$")
    label: str = Field("", max_length=120)
    hint: str = Field("", max_length=200)
    type: str = Field("text", pattern="^(text|textarea|number|icon)$")


class FillIn(BaseModel):
    context: str = Field(..., min_length=2, max_length=300)
    fields: list[FillField] = Field(..., min_length=1, max_length=20)
    input: str = Field("", max_length=4000)
    count: int = Field(1, ge=1, le=10)
    existing: dict[str, str] = Field(default_factory=dict)
    avoid: list[str] = Field(default_factory=list, max_length=50)
    tone: str = Field("", pattern="^(|professional|friendly|sales)$")


FILL_SYSTEM = (
    WRITE_SYSTEM
    + ' You fill admin form fields. Return ONLY JSON: {"items": [ {<key>: <value>, ...}, ... ]}. '
    "Use exactly the given keys. Keys ending in _bn / .bn / bn are natural Bangla; _en / .en / en are English "
    "(same meaning). Fields of type icon get ONE fitting emoji. Numbers are plain numbers. Keep values short "
    "enough for a website card unless the hint says otherwise. Never invent prices, phone numbers, addresses, "
    "registration numbers, awards or customer names that were not given — leave such fields as an empty string."
)


@router.post("/fill", response_model=ApiResponse)
async def ai_fill(payload: FillIn, _admin: str = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Draft one or more items for any admin form from a short input (or fill an item's empty fields)."""
    if not (payload.input.strip() or any(v.strip() for v in payload.existing.values())):
        raise HTTPException(status_code=400, detail="AI-কে কিছু তথ্য দিন — কয়েকটি শব্দ লিখুন।")
    nl = "\n"
    spec = nl.join(f"- {f.key} ({f.type}): {f.label}{' — ' + f.hint if f.hint else ''}" for f in payload.fields)
    parts = [f"Form: {payload.context.strip()}", "Fields:" + nl + spec, f"How many items: {payload.count}"]
    if payload.input.strip():
        parts.append("Owner's input:" + nl + ai_gemini._mask(payload.input.strip()))
    filled = [f"{k}: {v}" for k, v in payload.existing.items() if v.strip()]
    if filled:
        parts.append("Already filled (keep these meanings, fill only the empty ones):" + nl + nl.join(filled))
    if payload.avoid:
        parts.append("Do not repeat these existing items: " + "; ".join(a[:80] for a in payload.avoid))
    if payload.tone:
        parts.append(_TONES[payload.tone])
    try:
        raw = await ai_gemini.generate_json(db, FILL_SYSTEM, (nl + nl).join(parts), max_tokens=4096)
    except ai_gemini.AiUnavailable as exc:
        raise _fail(exc)
    items = raw.get("items") if isinstance(raw, dict) else raw
    keys = {f.key: f.type for f in payload.fields}
    out = []
    for it in (items if isinstance(items, list) else [])[: payload.count]:
        if not isinstance(it, dict):
            continue
        row = {}
        for k, t in keys.items():
            v = it.get(k)
            if v is None:
                continue
            if t == "number":
                try:
                    row[k] = float(v) if "." in str(v) else int(v)
                except (TypeError, ValueError):
                    continue
            else:
                row[k] = str(v).strip()[:2000]
        if row:
            out.append(row)
    if not out:
        raise HTTPException(status_code=502, detail="AI কিছু তৈরি করতে পারেনি — আরেকটু তথ্য দিয়ে আবার চেষ্টা করুন।")
    return ApiResponse(data={"items": out})
