import uuid
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, EmailStr, Field, computed_field, field_validator
import re


def bd_phone(v: str) -> str:
    # Accepts BD numbers with or without country code, and international
    # numbers (E.164) so customers ordering from outside Bangladesh can check
    # out. The delivery address still stays inside Bangladesh; only the phone
    # may be foreign. Mirrors frontend BD_PHONE_REGEX in src/lib/phone.ts.
    c = re.sub(r"[\s()-]", "", (v or "").strip())
    if re.match(r"^(?:0|\+?880)1[3-9]\d{8}$", c) or re.match(r"^\+[1-9]\d{6,14}$", c):
        return c
    raise ValueError(
        "Invalid phone number. Use 01XXXXXXXXX or an international number "
        "with country code (e.g. +8801XXXXXXXXX, +9715XXXXXXXX)"
    )


class ApiResponse(BaseModel):
    success: bool = True
    data: Any = None
    message: str = ""


class PaginatedMeta(BaseModel):
    page: int
    per_page: int
    total: int
    total_pages: int


class PaginatedResponse(BaseModel):
    success: bool = True
    data: list[Any]
    message: str = ""
    meta: PaginatedMeta


# ---- Product ----

class ProductBase(BaseModel):
    slug: str
    name_en: str
    name_bn: str
    description_en: str | None = None
    description_bn: str | None = None
    price: float
    original_price: float | None = None
    cost_price: float | None = None
    category: str
    badge: str | None = None
    image_url: str | None = None
    images: list[str] = []
    stock_quantity: int = 0
    is_active: bool = True
    is_featured: bool = False
    sort_order: int = 0
    specifications: dict = {}
    seo_title: str | None = None
    seo_description: str | None = None
    seo_keywords: str | None = None
    canonical_url: str | None = None
    og_image: str | None = None
    video_url: str | None = Field(None, max_length=1000)
    variant_group: str | None = Field(None, max_length=64)
    variant_label: str | None = Field(None, max_length=80)
    sku: str | None = None
    barcode: str | None = None
    brand: str | None = None
    sub_category: str | None = None
    tags: list[str] = []
    weight: float | None = None
    warranty_info: str | None = None
    delivery_info: str | None = None
    delivery_charge: float | None = None
    requires_advance: bool = False
    is_flash_sale: bool = False
    flash_sale_price: float | None = None
    flash_sale_ends_at: datetime | None = None
    low_stock_threshold: int = 5
    is_best_seller: bool = False
    rating: float | None = None


class ProductCreate(ProductBase):
    # Capability overrides can be set at creation too (additive; default NULL).
    is_orderable: bool | None = None
    is_bookable: bool | None = None
    # Blog posts this product is linked to (many-to-many; handled separately
    # from the product row — see core/blog_links.py).
    blog_ids: list[uuid.UUID] | None = None


class ProductUpdate(BaseModel):
    name_en: str | None = None
    name_bn: str | None = None
    description_en: str | None = None
    description_bn: str | None = None
    price: float | None = None
    original_price: float | None = None
    cost_price: float | None = None
    category: str | None = None
    category_id: uuid.UUID | None = None
    subcategory_id: uuid.UUID | None = None
    is_orderable: bool | None = None
    is_bookable: bool | None = None
    stock_quantity: int | None = None
    is_active: bool | None = None
    is_featured: bool | None = None
    badge: str | None = None
    image_url: str | None = None
    images: list[str] | None = None
    sort_order: int | None = None
    seo_title: str | None = None
    seo_description: str | None = None
    seo_keywords: str | None = None
    canonical_url: str | None = None
    og_image: str | None = None
    video_url: str | None = Field(None, max_length=1000)
    variant_group: str | None = Field(None, max_length=64)
    variant_label: str | None = Field(None, max_length=80)
    sku: str | None = None
    barcode: str | None = None
    brand: str | None = None
    sub_category: str | None = None
    tags: list[str] | None = None
    weight: float | None = None
    warranty_info: str | None = None
    delivery_info: str | None = None
    delivery_charge: float | None = None
    requires_advance: bool | None = None
    is_flash_sale: bool | None = None
    flash_sale_price: float | None = None
    flash_sale_ends_at: datetime | None = None
    specifications: dict | None = None
    low_stock_threshold: int | None = None
    is_best_seller: bool | None = None
    rating: float | None = None
    # Blog posts this product is linked to (many-to-many; NULL = leave links
    # untouched, [] = clear them). Handled in core/blog_links.py, not a column.
    blog_ids: list[uuid.UUID] | None = None


class ProductOut(ProductBase):
    id: uuid.UUID
    created_at: datetime
    # Unified taxonomy links (additive; null until associated).
    category_id: uuid.UUID | None = None
    subcategory_id: uuid.UUID | None = None
    is_orderable: bool | None = None
    is_bookable: bool | None = None

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def capabilities(self) -> list[str]:
        """What the customer can do with this product (single source: core/capabilities.py)."""
        from app.core.capabilities import capabilities_for
        return sorted(c.value for c in capabilities_for("product", self.is_orderable, self.is_bookable))

    @field_validator("images", mode="before")
    @classmethod
    def coerce_images(cls, v: Any) -> list:
        return v if v is not None else []

    @field_validator("specifications", mode="before")
    @classmethod
    def coerce_specs(cls, v: Any) -> dict:
        return v if v is not None else {}

    @field_validator("tags", mode="before")
    @classmethod
    def coerce_tags(cls, v: Any) -> list:
        return v if v is not None else []



class PublicProductOut(ProductOut):
    """Storefront view of a product: the private purchase price (cost_price)
    is never serialized for customers."""
    cost_price: float | None = Field(default=None, exclude=True)

# ---- Review ----


# Alias kept for callers/tests that use the other name.
ProductPublicOut = PublicProductOut

class ReviewCreate(BaseModel):
    product_id: uuid.UUID | None = None
    service_id: uuid.UUID | None = None
    customer_name: str
    company: str | None = None
    rating: int
    review_en: str
    review_bn: str | None = None
    photo_url: str | None = None
    source: str = "direct"

    @field_validator("rating")
    @classmethod
    def validate_rating(cls, v: int) -> int:
        if v < 1 or v > 5:
            raise ValueError("Rating must be 1-5")
        return v


class ReviewOut(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID | None
    service_id: uuid.UUID | None = None
    customer_name: str
    company: str | None
    rating: int
    review_en: str
    review_bn: str | None
    photo_url: str | None
    source: str
    is_verified: bool
    is_featured: bool
    is_active: bool
    admin_reply: str | None = None
    admin_reply_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ---- Order ----

class OrderItemCreate(BaseModel):
    product_id: str
    product_name: str
    product_price: float
    quantity: int
    subtotal: float


class ComboOrderIn(BaseModel):
    """A combo line in an order. Only the id + quantity are trusted; the price
    and free-delivery flag are re-derived from the DB server-side."""
    combo_id: str
    quantity: int = 1


class OrderCreate(BaseModel):
    customer_name: str
    customer_phone: str
    customer_email: str | None = None
    delivery_address: str
    payment_method: str
    payment_number: str | None = None
    items: list[OrderItemCreate]
    # Optional combo lines — additive; an order with none behaves exactly as
    # before. Priced server-side, never from the client.
    combos: list[ComboOrderIn] = []
    subtotal: float
    discount_amount: float = 0
    coupon_code: str | None = None
    # Delivery: district/upazila let the server re-derive the charge from admin
    # zones/settings (never trusting the client). delivery_charge is kept only
    # as a fallback for API clients that don't send a district.
    district: str | None = None
    upazila: str | None = None
    delivery_charge: float = 0
    total: float
    # Institutional invoice identity (manual_sql/0009). Every field optional:
    # a personal order sends none of them and is unchanged.
    company_name: str | None = None
    company_bin: str | None = None
    company_tin: str | None = None
    po_number: str | None = None
    billing_address: str | None = None
    notes: str | None = None

    @field_validator("customer_phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return bd_phone(v)


class OrderStatusUpdate(BaseModel):
    status: str


class OrderCourierUpdate(BaseModel):
    courier_provider: str | None = None
    courier_tracking_id: str | None = None


class BulkOrderStatusUpdate(BaseModel):
    order_ids: list[uuid.UUID]
    status: str


class OrderItemOut(BaseModel):
    # Standalone (not inheriting OrderItemCreate): DB rows have product_id as
    # UUID | None, which fails OrderItemCreate's required `product_id: str`.
    id: uuid.UUID
    product_id: uuid.UUID | None = None
    product_name: str
    product_price: float
    quantity: int
    subtotal: float

    model_config = {"from_attributes": True}


class OrderOut(BaseModel):
    id: uuid.UUID
    order_number: str
    customer_name: str
    customer_phone: str
    customer_email: str | None
    delivery_address: str
    payment_method: str
    payment_status: str
    order_status: str
    subtotal: float
    discount_amount: float = 0
    coupon_code: str | None = None
    delivery_charge: float
    advance_amount: float = 0
    advance_paid: bool = False
    total: float
    courier_provider: str | None = None
    courier_tracking_id: str | None = None
    courier_consignment_id: str | None = None
    courier_status: str | None = None
    company_name: str | None = None
    company_bin: str | None = None
    company_tin: str | None = None
    po_number: str | None = None
    billing_address: str | None = None
    notes: str | None
    items: list[OrderItemOut]
    created_at: datetime
    refund_amount: float | None = None
    refund_method: str | None = None
    refund_note: str | None = None
    refunded_at: datetime | None = None
    courier_dispatch_at: datetime | None = None
    courier_error: str | None = None
    model_config = {"from_attributes": True}


# ---- Booking ----

class BookingCreate(BaseModel):
    service_type: str
    service_subtype: str | None = None
    customer_name: str
    customer_phone: str
    customer_email: str | None = None
    details: str | None = None
    estimated_price: str | None = None

    @field_validator("customer_phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return bd_phone(v)


class BookingStatusUpdate(BaseModel):
    status: str


class BookingOut(BaseModel):
    # Standalone (not inheriting BookingCreate): output must not re-run input
    # validators like bd_phone, or one legacy row breaks the whole list.
    id: uuid.UUID
    booking_number: str
    service_type: str
    service_subtype: str | None = None
    customer_name: str
    customer_phone: str
    customer_email: str | None = None
    details: str | None = None
    estimated_price: str | None = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ---- Lead ----

class LeadCreate(BaseModel):
    source: str = "website"
    lead_type: str
    name: str
    company: str | None = None
    phone: str
    email: str | None = None
    budget_range: str | None = None
    project_description: str | None = None
    requirements: str | None = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return bd_phone(v)


class LeadStatusUpdate(BaseModel):
    status: str


class LeadOut(BaseModel):
    # Standalone (not inheriting LeadCreate): output must not re-run input
    # validators like bd_phone, or one legacy row breaks the whole list.
    id: uuid.UUID
    source: str
    lead_type: str
    name: str
    company: str | None = None
    phone: str
    email: str | None = None
    budget_range: str | None = None
    project_description: str | None = None
    requirements: str | None = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ---- Auth ----

class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    # Required only when the account has TOTP 2FA enabled
    totp_code: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    # Set when the owner requires 2FA and this account has not set it up yet:
    # the session may only open the 2FA set-up screen.
    mfa_setup_required: bool = False
    # Set when a one-time recovery code was used instead of the authenticator app.
    recovery_code_used: bool = False
    recovery_codes_remaining: int | None = None


class SecurityPolicyPayload(BaseModel):
    require_2fa: bool


class TotpCodePayload(BaseModel):
    code: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")


class AdminUserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str = "admin"


class AdminUserUpdate(BaseModel):
    name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    password: str | None = None


# ---- Dashboard ----

class DashboardStats(BaseModel):
    total_orders: int
    pending_orders: int
    total_bookings: int
    pending_bookings: int
    new_leads: int
    total_leads: int
    total_products: int
    new_applications: int = 0
    low_stock: int = 0
    recent_orders: list[Any] = []
    recent_leads: list[Any] = []


# ---- Settings ----

class SettingBase(BaseModel):
    key: str
    value: str
    data_type: str = "string"
    description: str | None = None
    is_secret: bool = False
    is_editable: bool = True


class SettingCreate(SettingBase):
    pass


class SettingUpdate(BaseModel):
    value: str
    is_editable: bool | None = None


class SettingOut(SettingBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ==================== SERVICE SCHEMAS ====================

class ServicePricingTierBase(BaseModel):
    tier_name: str
    description_en: str | None = None
    description_bn: str | None = None
    price: float
    duration_days: int | None = None
    features: list[str] = []
    includes: str | None = None
    is_active: bool = True
    sort_order: int | None = None


class ServicePricingTierCreate(ServicePricingTierBase):
    pass


class ServicePricingTierOut(ServicePricingTierBase):
    id: uuid.UUID
    service_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ServiceBookingFormBase(BaseModel):
    field_name: str
    field_type: str
    field_label_en: str
    field_label_bn: str
    is_required: bool = True
    placeholder: str | None = None
    options: list[str] | None = None
    default_value: str | None = None
    validation_rules: dict | None = None
    conditional_logic: dict | None = None
    sort_order: int | None = None
    is_active: bool = True


# Field types supported end to end (public renderer + server validator).
# Applied to the *input* schema only — ServiceBookingFormOut keeps a plain str
# so a legacy row with an unlisted type can never fail serialization and 500
# the service detail page.
ServiceFieldType = Literal[
    "text", "textarea", "number", "integer", "email", "phone", "tel", "url",
    "date", "datetime", "select", "multiselect", "radio", "checkbox_group",
    "file",
    "checkbox", "boolean",
]


class ServiceBookingFormCreate(ServiceBookingFormBase):
    field_type: ServiceFieldType


class ServiceBookingFormOut(ServiceBookingFormBase):
    id: uuid.UUID
    service_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ServiceBase(BaseModel):
    slug: str
    name_en: str
    name_bn: str
    description_en: str | None = None
    description_bn: str | None = None
    short_description_en: str | None = None
    short_description_bn: str | None = None
    long_description_en: str | None = None
    long_description_bn: str | None = None
    category: str
    icon_url: str | None = None
    featured_image_url: str | None = None
    icon_color: str | None = None
    pricing_type: str
    # Where the service is completed (manual_sql/0008). None = unspecified.
    fulfilment: str | None = None
    # How long it takes, in working days (manual_sql/0011). None = not published.
    turnaround_days_min: int | None = None
    turnaround_days_max: int | None = None
    # CTA override (None = infer from pricing_type/capabilities).
    cta_type: str | None = None
    cta_label_en: str | None = None
    cta_label_bn: str | None = None
    base_price: float | None = None
    min_price: float | None = None
    max_price: float | None = None
    hourly_rate: float | None = None
    delivery_charge: float | None = None
    consultancy_fee: float | None = None
    requires_advance: bool = False
    scheduling_enabled: bool = False
    slot_duration_minutes: int | None = None
    slot_capacity: int | None = None
    min_notice_hours: int | None = None
    booking_horizon_days: int | None = None
    working_hours: dict = {}
    holidays: list[str] = []
    is_active: bool = True
    is_featured: bool = False
    sort_order: int = 0
    lead_priority: int = 5
    lead_qualification_score: int = 0
    tags: list[str] = []
    seo_title: str | None = None
    seo_description: str | None = None
    seo_keywords: str | None = None
    canonical_url: str | None = None
    og_image: str | None = None
    video_url: str | None = Field(None, max_length=1000)
    # Content blocks. Items may be plain strings (legacy, treated as English) or
    # bilingual objects ({en, bn} for lists; title_bn/description_bn on steps;
    # question_bn/answer_bn on faq). Kept untyped so both shapes are accepted
    # and stored verbatim in the JSON columns — no DB migration, fully
    # backward-compatible. The frontend picks the language with an English
    # fallback (see ServiceDetailClient).
    process_steps: list = []
    benefits: list = []
    requirements: list = []
    required_documents: list = []
    faq: list = []


# Accepted pricing types. "custom" is retained as a back-compat alias for
# "custom_quote" (see core/capabilities.resolve_service_cta). Applied to input
# schemas only, for the same reason as ServiceFieldType above.
ServicePricingType = Literal["fixed", "hourly", "package", "custom", "custom_quote"]

# Where the service is completed. Validated on input only: existing rows are
# NULL and any legacy value already stored must still be readable.
ServiceFulfilment = Literal["remote", "at_shop", "hybrid"]

# Money columns that must never be negative.
_PRICE_FIELDS = (
    "base_price", "min_price", "max_price", "hourly_rate",
    "delivery_charge", "consultancy_fee",
)


def _reject_negative(v: float | None, info) -> float | None:
    if v is not None and v < 0:
        raise ValueError(f"{info.field_name} cannot be negative")
    return v


class ServiceCreate(ServiceBase):
    pricing_type: ServicePricingType
    fulfilment: ServiceFulfilment | None = None
    turnaround_days_min: int | None = Field(default=None, ge=1, le=365)
    turnaround_days_max: int | None = Field(default=None, ge=1, le=365)
    # Capability overrides can be set at creation too (additive; default NULL).
    is_orderable: bool | None = None
    is_bookable: bool | None = None
    # Taxonomy links can be set at creation too (additive; default NULL).
    category_id: uuid.UUID | None = None
    subcategory_id: uuid.UUID | None = None
    # Blog posts this service is linked to (many-to-many; see core/blog_links.py).
    blog_ids: list[uuid.UUID] | None = None

    _no_negative_prices = field_validator(*_PRICE_FIELDS)(_reject_negative)


class ServiceUpdate(BaseModel):
    # Editable after creation — the admin editor has always rendered a slug
    # input, but the field was absent here so every edit was silently dropped.
    # Uniqueness is enforced by the route against other live services.
    slug: str | None = None
    name_en: str | None = None
    name_bn: str | None = None
    description_en: str | None = None
    description_bn: str | None = None
    short_description_en: str | None = None
    short_description_bn: str | None = None
    long_description_en: str | None = None
    long_description_bn: str | None = None
    category: str | None = None
    category_id: uuid.UUID | None = None
    subcategory_id: uuid.UUID | None = None
    is_orderable: bool | None = None
    is_bookable: bool | None = None
    pricing_type: ServicePricingType | None = None
    fulfilment: ServiceFulfilment | None = None
    turnaround_days_min: int | None = Field(default=None, ge=1, le=365)
    turnaround_days_max: int | None = Field(default=None, ge=1, le=365)
    cta_type: str | None = None
    cta_label_en: str | None = None
    cta_label_bn: str | None = None
    base_price: float | None = None
    min_price: float | None = None
    max_price: float | None = None
    hourly_rate: float | None = None
    delivery_charge: float | None = None
    consultancy_fee: float | None = None
    requires_advance: bool | None = None
    scheduling_enabled: bool | None = None
    slot_duration_minutes: int | None = None
    slot_capacity: int | None = None
    min_notice_hours: int | None = None
    booking_horizon_days: int | None = None
    working_hours: dict | None = None
    holidays: list[str] | None = None
    is_active: bool | None = None
    is_featured: bool | None = None
    lead_priority: int | None = None
    seo_title: str | None = None
    seo_description: str | None = None
    seo_keywords: str | None = None
    canonical_url: str | None = None
    og_image: str | None = None
    video_url: str | None = Field(None, max_length=1000)
    sort_order: int | None = None
    icon_url: str | None = None
    featured_image_url: str | None = None
    icon_color: str | None = None
    tags: list[str] | None = None
    # Untyped lists so bilingual item shapes ({en,bn} / *_bn keys) and legacy
    # plain strings are both accepted and stored verbatim (see ServiceBase).
    process_steps: list | None = None
    benefits: list | None = None
    requirements: list | None = None
    required_documents: list | None = None
    faq: list | None = None
    # Blog posts this service is linked to (many-to-many; NULL = leave links
    # untouched, [] = clear them). Handled in core/blog_links.py, not a column.
    blog_ids: list[uuid.UUID] | None = None

    _no_negative_prices = field_validator(*_PRICE_FIELDS)(_reject_negative)


class ServiceOut(ServiceBase):
    id: uuid.UUID
    pricing_tiers: list[ServicePricingTierOut] = []
    booking_forms: list[ServiceBookingFormOut] = []

    @field_validator("pricing_tiers", "booking_forms", mode="before")
    @classmethod
    def _drop_soft_deleted(cls, v):
        """Soft-deleted rows must never reach clients: a deleted booking-form
        field that still renders would be filled in and then rejected by the
        booking validator, blocking the whole booking."""
        try:
            return [item for item in v if not getattr(item, "is_deleted", False)]
        except TypeError:
            return v
    created_at: datetime
    updated_at: datetime
    # Unified taxonomy links (additive; null until associated).
    category_id: uuid.UUID | None = None
    subcategory_id: uuid.UUID | None = None
    is_orderable: bool | None = None
    is_bookable: bool | None = None

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def capabilities(self) -> list[str]:
        """What the customer can do with this service (single source: core/capabilities.py)."""
        from app.core.capabilities import capabilities_for
        return sorted(c.value for c in capabilities_for("service", self.is_orderable, self.is_bookable))

    @computed_field
    @property
    def cta(self) -> dict:
        """Effective Call-To-Action (single source: core/capabilities.py)."""
        from app.core.capabilities import resolve_service_cta
        return resolve_service_cta(
            self.cta_type, self.cta_label_en, self.cta_label_bn,
            self.pricing_type, self.is_orderable, self.is_bookable,
        )


# ==================== BOOKING V2 SCHEMAS ====================

class BookingV2Create(BaseModel):
    # Optional since the legacy printing/legal intake was merged in (0015).
    # When absent, service_name identifies what was requested.
    service_id: uuid.UUID | None = None
    service_name: str | None = None
    service_tier: str | None = None
    customer_name: str
    customer_phone: str
    customer_email: str | None = None
    customer_company: str | None = None
    district: str | None = None
    upazila: str | None = None
    booking_date: datetime | None = None
    estimated_completion_date: datetime | None = None
    # Optional for a service-less booking; otherwise taken from the service row.
    pricing_type: str | None = None
    quoted_price: float | None = None
    details: str | None = None
    requirements: str | None = None
    coupon_code: str | None = None
    # Answers to the service's dynamic booking form; validated server-side
    # against service_booking_forms config (core/booking_form.py).
    form_data: dict = {}
    attachments: list[str] = []

    @field_validator("customer_phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return bd_phone(v)


# Every status any surface writes today: the admin dropdown
# (pending/in_progress/completed/cancelled/on_hold) plus "confirmed", which the
# stats endpoint counts. Kept as a superset so no existing caller breaks.
BookingV2Status = Literal[
    "pending", "confirmed", "in_progress", "completed", "cancelled", "on_hold"
]


class BookingV2StatusUpdate(BaseModel):
    status: BookingV2Status


class BookingV2AdminUpdate(BaseModel):
    """Partial admin edit of a booking.

    Every field is optional and the route applies only what was sent, so a
    routine correction can never blank the fields it didn't mention. This is
    what makes final_price / payment_status reachable at all — nothing else in
    the system writes them, which is why booking revenue reported as zero.
    """

    customer_name: str | None = None
    customer_phone: str | None = None
    customer_email: str | None = None
    customer_company: str | None = None
    district: str | None = None
    upazila: str | None = None
    service_tier: str | None = None
    booking_date: datetime | None = None
    estimated_completion_date: datetime | None = None
    quoted_price: float | None = None
    final_price: float | None = None
    hours_worked: float | None = None
    advance_paid: bool | None = None
    details: str | None = None
    requirements: str | None = None
    notes: str | None = None
    status: BookingV2Status | None = None
    payment_status: Literal["pending", "unpaid", "partial", "paid", "completed", "refunded"] | None = None
    payment_method: str | None = None
    payment_number: str | None = None
    form_data: dict | None = None

    @field_validator("customer_phone")
    @classmethod
    def validate_phone(cls, v: str | None) -> str | None:
        return bd_phone(v) if v else v

    @field_validator("quoted_price", "final_price", "hours_worked")
    @classmethod
    def no_negative(cls, v: float | None) -> float | None:
        if v is not None and v < 0:
            raise ValueError("Value cannot be negative")
        return v


class BookingV2Out(BaseModel):
    id: uuid.UUID
    booking_number: str
    service_id: uuid.UUID | None = None
    service_name: str
    service_tier: str | None
    customer_name: str
    customer_phone: str
    customer_email: str | None
    customer_company: str | None
    district: str | None = None
    upazila: str | None = None
    booking_date: datetime | None
    estimated_completion_date: datetime | None
    pricing_type: str
    quoted_price: float | None
    final_price: float | None
    advance_amount: float = 0
    advance_paid: bool = False
    coupon_code: str | None = None
    discount_amount: float = 0
    hours_worked: float | None
    details: str | None
    requirements: str | None
    form_data: dict = {}
    # field_name → admin-defined EN label, so consoles can show "Business Name"
    # instead of the raw machine key. Additive and optional; populated by the
    # admin endpoints only.
    form_labels: dict[str, str] = {}
    # Customer-supplied document URLs. Accepted at creation since day one but
    # never returned, so nothing could ever display them.
    attachments: list[str] = []
    status: str
    payment_status: str
    payment_method: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


# ==================== LEAD V2 SCHEMAS ====================

class LeadV2Create(BaseModel):
    service_id: uuid.UUID | None = None
    lead_type: str
    name: str
    email: str | None = None
    phone: str
    company: str | None = None
    job_title: str | None = None
    company_size: str | None = None
    project_description: str | None = None
    requirements: str | None = None
    budget_range: str | None = None
    budget_min: float | None = None
    budget_max: float | None = None
    timeline: str | None = None
    attachments: list[str] = []

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return bd_phone(v)


class LeadV2StatusUpdate(BaseModel):
    status: str
    reason_lost: str | None = None


class LeadV2Out(BaseModel):
    id: uuid.UUID
    lead_number: str
    service_id: uuid.UUID | None
    lead_type: str
    source: str
    name: str
    email: str | None
    phone: str
    company: str | None
    project_description: str | None
    requirements: str | None
    budget_range: str | None
    budget_min: float | None
    budget_max: float | None
    timeline: str | None
    qualification_score: int
    status: str
    assigned_to: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    converted_at: datetime | None

    model_config = {"from_attributes": True}


# ==================== INVOICE SCHEMAS ====================

class InvoiceItemBase(BaseModel):
    name: str
    quantity: int
    price: float


class InvoiceCreate(BaseModel):
    order_id: uuid.UUID | None = None
    booking_id: uuid.UUID | None = None
    customer_name: str
    customer_email: str | None = None
    customer_phone: str | None = None
    items: list[InvoiceItemBase]
    subtotal: float
    tax: float = 0
    total: float
    payment_method: str | None = None
    # Institutional identity printed on this invoice (manual_sql/0010).
    # Optional: a personal invoice sends none of them.
    company_name: str | None = None
    company_bin: str | None = None
    company_tin: str | None = None
    po_number: str | None = None
    billing_address: str | None = None
    notes: str | None = None


class InvoiceOut(BaseModel):
    id: uuid.UUID
    invoice_number: str
    order_id: uuid.UUID | None
    booking_id: uuid.UUID | None
    customer_name: str
    customer_email: str | None
    customer_phone: str | None
    items: list[dict]
    subtotal: float
    tax: float
    discount_amount: float = 0
    delivery_charge: float = 0
    total: float
    payment_method: str | None
    payment_status: str
    company_name: str | None = None
    company_bin: str | None = None
    company_tin: str | None = None
    po_number: str | None = None
    billing_address: str | None = None
    issued_date: datetime | None
    due_date: datetime | None
    paid_date: datetime | None
    pdf_url: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ==================== PAYMENT SCHEMAS ====================

class PaymentMethodBase(BaseModel):
    payment_gateway: str
    is_active: bool = True
    account_identifier: str | None = None
    commission_percentage: float = 0
    min_amount: float | None = None
    max_amount: float | None = None
    description: str | None = None
    sort_order: int | None = None


class PaymentMethodCreate(PaymentMethodBase):
    pass


class PaymentMethodUpdate(BaseModel):
    payment_gateway: str | None = None
    is_active: bool | None = None
    account_identifier: str | None = None
    commission_percentage: float | None = None
    min_amount: float | None = None
    max_amount: float | None = None
    description: str | None = None
    sort_order: int | None = None


class PaymentMethodOut(PaymentMethodBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ==================== ADMIN SETTINGS SCHEMAS ====================

# ==================== EMAIL TEMPLATE SCHEMAS ====================

class EmailTemplateBase(BaseModel):
    template_name: str
    subject_en: str
    subject_bn: str
    body_en: str
    body_bn: str
    variables: list[str] = []
    is_active: bool = True


class EmailTemplateCreate(EmailTemplateBase):
    pass


class EmailTemplateUpdate(BaseModel):
    subject_en: str | None = None
    subject_bn: str | None = None
    body_en: str | None = None
    body_bn: str | None = None
    is_active: bool | None = None


class EmailTemplateOut(EmailTemplateBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# Payment Schemas
from pydantic import BaseModel, Field
from typing import Optional
from decimal import Decimal
from uuid import UUID
from datetime import datetime

class BookingPaymentInitiateRequest(BaseModel):
    """Start a hosted checkout for a service booking.

    Phone-gated like every other public booking read: the caller must know the
    number used on the booking, not just its id.
    """
    booking_id: UUID
    phone: str
    success_url: str | None = None
    fail_url: str | None = None
    cancel_url: str | None = None


class PaymentInitiateRequest(BaseModel):
    order_id: UUID
    payment_gateway: str = Field(..., pattern="^(bkash|nagad|sslcommerz)$")
    success_url: str | None = None
    fail_url: str | None = None
    cancel_url: str | None = None
    
    class Config:
        from_attributes = True


class PaymentVerifyRequest(BaseModel):
    payment_id: str
    payment_gateway: str = Field(..., pattern="^(bkash|nagad)$")
    
    class Config:
        from_attributes = True


class PaymentResponseModel(BaseModel):
    success: bool
    payment_url: Optional[str] = None
    payment_gateway: str
    transaction_id: Optional[str] = None
    status: Optional[str] = None
    message: Optional[str] = None
    order_number: Optional[str] = None
    booking_number: Optional[str] = None
    customer_phone: Optional[str] = None

    class Config:
        from_attributes = True


class PaymentWebhookRequest(BaseModel):
    transaction_id: str
    status: str
    amount: Optional[Decimal] = None
    timestamp: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class BkashTransactionOut(BaseModel):
    id: UUID
    order_id: Optional[UUID]
    booking_id: Optional[UUID]
    bkash_transaction_id: str
    payment_id: Optional[str]
    amount: Decimal
    status: str
    payment_execute_time: Optional[datetime]
    created_at: datetime
    
    class Config:
        from_attributes = True


class NagadTransactionOut(BaseModel):
    id: UUID
    order_id: Optional[UUID]
    booking_id: Optional[UUID]
    nagad_reference_id: str
    merchant_order_id: str
    amount: Decimal
    status: str
    payment_completion_time: Optional[datetime]
    created_at: datetime
    
    class Config:
        from_attributes = True


class PaymentReconciliationOut(BaseModel):
    id: UUID
    reconciliation_date: datetime
    payment_gateway: str
    total_transactions: int
    total_amount: Decimal
    successful_count: int
    failed_count: int
    pending_count: int
    reconciliation_status: str
    created_at: datetime

    class Config:
        from_attributes = True


# ==================== BLOG SCHEMAS ====================

class BlogPostBase(BaseModel):
    slug: str
    title_en: str
    title_bn: str | None = None
    content_en: str
    content_bn: str | None = None
    excerpt_en: str | None = None
    excerpt_bn: str | None = None
    featured_image_url: str | None = None
    category: str | None = None
    tags: list[str] = []
    author_name: str = "ABO Enterprise"
    status: str = "draft"
    is_featured: bool = False
    sort_order: int = 0
    published_at: datetime | None = None
    seo_title: str | None = None
    seo_description: str | None = None
    seo_keywords: str | None = None
    canonical_url: str | None = None
    og_image: str | None = None


class BlogPostCreate(BlogPostBase):
    # Products & services this post features (many-to-many; see
    # core/blog_links.py). Optional — omitted means no links.
    product_ids: list[UUID] | None = None
    service_ids: list[UUID] | None = None


class BlogPostUpdate(BaseModel):
    title_en: str | None = None
    title_bn: str | None = None
    content_en: str | None = None
    content_bn: str | None = None
    excerpt_en: str | None = None
    excerpt_bn: str | None = None
    featured_image_url: str | None = None
    category: str | None = None
    tags: list[str] | None = None
    author_name: str | None = None
    status: str | None = None
    is_featured: bool | None = None
    sort_order: int | None = None
    published_at: datetime | None = None
    seo_title: str | None = None
    seo_description: str | None = None
    seo_keywords: str | None = None
    canonical_url: str | None = None
    og_image: str | None = None
    # Linked products & services (many-to-many; NULL = leave untouched,
    # [] = clear). Handled in core/blog_links.py, not columns.
    product_ids: list[UUID] | None = None
    service_ids: list[UUID] | None = None


class BlogPostOut(BlogPostBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    # Populated by the admin GET so the editor can pre-tick linked items.
    product_ids: list[UUID] = []
    service_ids: list[UUID] = []

    model_config = {"from_attributes": True}


# ---- Generic CMS Page ----

class PageBase(BaseModel):
    slug: str
    title_en: str
    title_bn: str | None = None
    content_en: str
    content_bn: str | None = None
    status: str = "draft"
    published_at: datetime | None = None
    seo_title: str | None = None
    seo_description: str | None = None
    seo_keywords: str | None = None
    canonical_url: str | None = None
    og_image: str | None = None


class PageCreate(PageBase):
    pass


class PageUpdate(BaseModel):
    title_en: str | None = None
    title_bn: str | None = None
    content_en: str | None = None
    content_bn: str | None = None
    status: str | None = None
    published_at: datetime | None = None
    seo_title: str | None = None
    seo_description: str | None = None
    seo_keywords: str | None = None
    canonical_url: str | None = None
    og_image: str | None = None


class PageOut(PageBase):
    id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---- Assistant ----

class AssistantChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    session_token: str | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    customer_email: str | None = None
    language: str | None = None
    page_path: str | None = None  # current site path — powers context awareness
    customer_token: str | None = Field(default=None, max_length=2000)  # logged-in customer JWT (skips the order OTP)

    @field_validator("message")
    @classmethod
    def validate_message(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Message cannot be empty")
        if len(v) > 2000:
            raise ValueError("Message exceeds 2000 characters")
        return v

    @field_validator("customer_phone")
    @classmethod
    def validate_phone_optional(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        return bd_phone(v)


class AssistantChatResponse(BaseModel):
    message: str
    intent: str
    language: str
    session_id: str
    session_token: str | None = None
    data: dict | None = None
    suggestions: list[str] | None = None


class AssistantMessageOut(BaseModel):
    role: str
    content: str
    intent: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AssistantActionLogOut(BaseModel):
    id: UUID
    session_id: str | None
    intent: str | None
    action: str
    status: str
    details: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class AssistantConversationOut(BaseModel):
    id: UUID
    session_id: str
    customer_name: str | None
    customer_phone: str | None
    customer_email: str | None
    language: str
    last_intent: str | None
    created_at: datetime
    updated_at: datetime
    message_count: int = 0

    model_config = {"from_attributes": True}


class AssistantConfigOut(BaseModel):
    feature_assistant_chat: bool = True
    feature_assistant_whatsapp: bool = True
    whatsapp_number: str = ""
    assistant_welcome_en: str = ""
    assistant_welcome_bn: str = ""
    assistant_feature_orders: bool = True
    assistant_feature_order_tracking: bool = True
    assistant_feature_bookings: bool = True
    assistant_feature_booking_tracking: bool = True
    assistant_feature_leads: bool = True
    assistant_feature_lead_tracking: bool = True
    assistant_feature_product_search: bool = True
    assistant_feature_service_info: bool = True
    assistant_feature_coupons: bool = True
    assistant_feature_invoices: bool = True
    assistant_feature_delivery_info: bool = True
    assistant_feature_faq: bool = True
    assistant_feature_blog: bool = True
    assistant_feature_web_search: bool = False
    assistant_feature_complaints: bool = True
    assistant_feature_cards: bool = True
    assistant_feature_logo_watermark: bool = True
    assistant_feature_ai_chat: bool = True


class AssistantConfigUpdate(BaseModel):
    feature_assistant_chat: bool | None = None
    feature_assistant_whatsapp: bool | None = None
    whatsapp_number: str | None = None
    assistant_welcome_en: str | None = None
    assistant_welcome_bn: str | None = None
    assistant_feature_orders: bool | None = None
    assistant_feature_order_tracking: bool | None = None
    assistant_feature_bookings: bool | None = None
    assistant_feature_booking_tracking: bool | None = None
    assistant_feature_leads: bool | None = None
    assistant_feature_lead_tracking: bool | None = None
    assistant_feature_product_search: bool | None = None
    assistant_feature_service_info: bool | None = None
    assistant_feature_coupons: bool | None = None
    assistant_feature_invoices: bool | None = None
    assistant_feature_delivery_info: bool | None = None
    assistant_feature_faq: bool | None = None
    assistant_feature_blog: bool | None = None
    assistant_feature_web_search: bool | None = None
    assistant_feature_complaints: bool | None = None
    assistant_feature_cards: bool | None = None
    assistant_feature_logo_watermark: bool | None = None
    assistant_feature_ai_chat: bool | None = None


class AssistantFaqEntry(BaseModel):
    key: str
    topic: str = ""
    answer_en: str
    answer_bn: str = ""
    # Customer questions/keywords (any language, one per line) that should
    # trigger this answer — lets admins teach the assistant without code.
    questions: str = ""


class AssistantFaqUpdate(BaseModel):
    topic: str | None = None
    answer_en: str | None = None
    answer_bn: str | None = None
    questions: str | None = None


class CareerApplicationCreate(BaseModel):
    name: str
    email: str | None = None
    phone: str
    position: str
    cover_letter: str | None = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return bd_phone(v)


class CareerApplicationUpdate(BaseModel):
    status: str | None = None
    notes: str | None = None


class CareerApplicationResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str | None
    phone: str
    position: str
    cover_letter: str | None
    status: str
    notes: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ==================== COMMERCE TAXONOMY SCHEMAS ====================
# Normalized Category -> Subcategory taxonomy shared by products & services.

class SubcategoryBase(BaseModel):
    slug: str
    name_en: str
    name_bn: str | None = None
    description_en: str | None = None
    description_bn: str | None = None
    icon: str | None = None
    image_url: str | None = None
    sort_order: int = 0
    is_active: bool = True


class SubcategoryCreate(SubcategoryBase):
    category_id: uuid.UUID


class SubcategoryUpdate(BaseModel):
    slug: str | None = None
    name_en: str | None = None
    name_bn: str | None = None
    description_en: str | None = None
    description_bn: str | None = None
    icon: str | None = None
    image_url: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class SubcategoryOut(SubcategoryBase):
    id: uuid.UUID
    category_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PromoSlideBase(BaseModel):
    placement: Literal["hero", "flash_sale", "combo"] = "hero"
    image_url: str | None = None
    mobile_image_url: str | None = None
    video_url: str | None = None
    link_url: str | None = None
    title_en: str | None = None
    title_bn: str | None = None
    alt_text: str | None = None
    sort_order: int = 0
    is_active: bool = True
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class PromoSlideCreate(PromoSlideBase):
    pass


class PromoSlideUpdate(BaseModel):
    placement: Literal["hero", "flash_sale", "combo"] | None = None
    image_url: str | None = None
    mobile_image_url: str | None = None
    video_url: str | None = None
    link_url: str | None = None
    title_en: str | None = None
    title_bn: str | None = None
    alt_text: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class PromoSlideOut(PromoSlideBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CategorySeoMixin(BaseModel):
    """Optional per-category SEO overrides (alembic 0011)."""
    seo_title: str | None = None
    seo_description: str | None = None
    seo_keywords: str | None = None
    canonical_url: str | None = None
    og_image: str | None = None


class CategoryBase(CategorySeoMixin):
    slug: str
    name_en: str
    name_bn: str | None = None
    description_en: str | None = None
    description_bn: str | None = None
    icon: str | None = None
    image_url: str | None = None
    applies_to: list[str] = []
    sort_order: int = 0
    is_active: bool = True


class CategoryCreate(CategoryBase):
    parent_id: uuid.UUID | None = None


class CategoryUpdate(CategorySeoMixin):
    slug: str | None = None
    name_en: str | None = None
    name_bn: str | None = None
    description_en: str | None = None
    description_bn: str | None = None
    icon: str | None = None
    image_url: str | None = None
    applies_to: list[str] | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    parent_id: uuid.UUID | None = None


class CategoryOut(CategoryBase):
    id: uuid.UUID
    parent_id: uuid.UUID | None = None
    # Children (recursive tree) — key kept as "subcategories" for backward
    # compatibility with every existing consumer.
    subcategories: list["CategoryOut"] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
