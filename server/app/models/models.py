import uuid
from datetime import datetime, timezone
from sqlalchemy import BigInteger, String, Text, Boolean, Integer, SmallInteger, Numeric, ForeignKey, DateTime, JSON
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name_en: Mapped[str] = mapped_column(String(255), nullable=False)
    name_bn: Mapped[str] = mapped_column(String(255), nullable=False)
    description_en: Mapped[str | None] = mapped_column(Text)
    description_bn: Mapped[str | None] = mapped_column(Text)
    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    original_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    # Optional per-unit cost basis, admin-entered. NULL = not yet known; the
    # Profit report excludes such lines from its total rather than assuming 0,
    # and discloses how many were excluded — never fabricates a cost.
    cost_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    # Optional per-product delivery override (NULL = use zone charge) and an
    # admin on/off flag that forces an advance payment before confirmation.
    delivery_charge: Mapped[float | None] = mapped_column(Numeric(10, 2))
    requires_advance: Mapped[bool] = mapped_column(Boolean, default=False)
    category: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    badge: Mapped[str | None] = mapped_column(String(20))
    image_url: Mapped[str | None] = mapped_column(Text)
    images: Mapped[list] = mapped_column(JSON, default=list)
    stock_quantity: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    specifications: Mapped[dict] = mapped_column(JSON, default=dict)
    seo_title: Mapped[str | None] = mapped_column(String(255))
    seo_description: Mapped[str | None] = mapped_column(Text)
    seo_keywords: Mapped[str | None] = mapped_column(String(500))
    canonical_url: Mapped[str | None] = mapped_column(String(500))
    og_image: Mapped[str | None] = mapped_column(Text)
    # Optional product/service video (YouTube, Facebook, Vimeo or a Cloudinary upload).
    video_url: Mapped[str | None] = mapped_column(Text)
    # Variants: products sharing a group are shown as colour/size choices of each
    # other; each stays a normal product with its own price and stock.
    variant_group: Mapped[str | None] = mapped_column(String(64), index=True)
    variant_label: Mapped[str | None] = mapped_column(String(80))
    sku: Mapped[str | None] = mapped_column(String(100), index=True)
    barcode: Mapped[str | None] = mapped_column(String(100))
    brand: Mapped[str | None] = mapped_column(String(100))
    # FK counterpart of the legacy `brand` text column (alembic 0033); a DB
    # trigger keeps this synced from `brand` on insert/update.
    brand_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("brands.id", ondelete="SET NULL"), index=True
    )
    sub_category: Mapped[str | None] = mapped_column(String(100))
    # Unified taxonomy FKs (additive; `category`/`sub_category` strings kept as cache).
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"), index=True
    )
    subcategory_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subcategories.id", ondelete="SET NULL"), index=True
    )
    # Commerce capability overrides (NULL = infer from type; see core/capabilities.py).
    # A product is orderable by default; set is_bookable=True to ALSO offer booking.
    is_orderable: Mapped[bool | None] = mapped_column(Boolean)
    is_bookable: Mapped[bool | None] = mapped_column(Boolean)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    weight: Mapped[float | None] = mapped_column(Numeric(8, 3))
    warranty_info: Mapped[str | None] = mapped_column(Text)
    delivery_info: Mapped[str | None] = mapped_column(Text)
    is_flash_sale: Mapped[bool] = mapped_column(Boolean, default=False)
    flash_sale_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    flash_sale_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    low_stock_threshold: Mapped[int] = mapped_column(Integer, default=5)
    is_best_seller: Mapped[bool] = mapped_column(Boolean, default=False)
    rating: Mapped[float | None] = mapped_column(Numeric(3, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    order_items: Mapped[list["OrderItem"]] = relationship(back_populates="product")
    reviews: Mapped[list["Review"]] = relationship(back_populates="product")


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL"))
    # A review targets a product or a service (alembic 0016).
    service_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("services.id", ondelete="SET NULL"), index=True
    )
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    company: Mapped[str | None] = mapped_column(String(255))
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    review_en: Mapped[str] = mapped_column(Text, nullable=False)
    review_bn: Mapped[str | None] = mapped_column(Text)
    photo_url: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(50), default="direct")
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    admin_reply: Mapped[str | None] = mapped_column(Text)
    admin_reply_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    product: Mapped["Product | None"] = relationship(back_populates="reviews")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    customer_phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    customer_email: Mapped[str | None] = mapped_column(String(255))
    # Canonical customer-master link, resolved by phone at order creation
    # (app.core.customer_master.get_or_create_customer). Nullable: orders
    # created before this column existed are never backfilled automatically.
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id"), index=True)
    delivery_address: Mapped[str] = mapped_column(Text, nullable=False)
    payment_method: Mapped[str] = mapped_column(String(20), nullable=False)
    payment_number: Mapped[str | None] = mapped_column(String(50))
    payment_status: Mapped[str] = mapped_column(String(20), default="pending")
    order_status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    subtotal: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    discount_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    coupon_code: Mapped[str | None] = mapped_column(String(50))
    delivery_charge: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    # Advance / prepaid delivery amount and whether it has been received; the
    # order stays pending until the advance is paid (gateway or admin-marked).
    advance_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    advance_paid: Mapped[bool] = mapped_column(Boolean, default=False)
    total: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    courier_provider: Mapped[str | None] = mapped_column(String(50))
    courier_tracking_id: Mapped[str | None] = mapped_column(String(100))
    # Steadfast consignment id, saved when an order is pushed to the courier.
    courier_consignment_id: Mapped[str | None] = mapped_column(String(50))
    # Real delivery status reported by the courier's webhook (Steadfast:
    # pending/delivered/partial_delivered/cancelled/hold/in_review/unknown/
    # *_approval_pending). NULL until the first callback arrives.
    courier_status: Mapped[str | None] = mapped_column(String(50))
    courier_status_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Refund / return (manual_sql/0048). refund_amount is cumulative; NULL = never refunded.
    refund_amount: Mapped[float | None] = mapped_column(Numeric(10, 2))
    refund_method: Mapped[str | None] = mapped_column(String(30))
    refund_note: Mapped[str | None] = mapped_column(Text)
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Courier automation (manual_sql/0050): send time while the 15 s undo runs, last error.
    courier_dispatch_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    courier_error: Mapped[str | None] = mapped_column(Text)
    # Institutional invoice identity (manual_sql/0009). All NULL on a personal
    # order, which is exactly how every existing row behaves.
    company_name: Mapped[str | None] = mapped_column(String(255))
    company_bin: Mapped[str | None] = mapped_column(String(50))
    company_tin: Mapped[str | None] = mapped_column(String(50))
    po_number: Mapped[str | None] = mapped_column(String(100))
    billing_address: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    items: Mapped[list["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"))
    product_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id"))
    product_name: Mapped[str] = mapped_column(String(255), nullable=False)
    product_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    subtotal: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    order: Mapped["Order"] = relationship(back_populates="items")
    product: Mapped["Product | None"] = relationship(back_populates="order_items")


class Booking(Base):
    __tablename__ = "bookings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    booking_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    service_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    service_subtype: Mapped[str | None] = mapped_column(String(50))
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    customer_phone: Mapped[str] = mapped_column(String(20), nullable=False)
    customer_email: Mapped[str | None] = mapped_column(String(255))
    details: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    estimated_price: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String(50), default="website")
    lead_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    company: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    budget_range: Mapped[str | None] = mapped_column(String(50))
    project_description: Mapped[str | None] = mapped_column(Text)
    requirements: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="new", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="admin")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Optional TOTP two-factor auth (migration 0004)
    totp_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Sign-in hardening (migration 0041)
    totp_recovery_codes: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_last_step: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class Setting(Base):
    __tablename__ = "settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    data_type: Mapped[str] = mapped_column(String(50), default="string")
    description: Mapped[str | None] = mapped_column(Text)
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False)
    is_editable: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


# ==================== NEW MODELS FOR SERVICES ECOSYSTEM ====================


class Service(Base):
    __tablename__ = "services"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name_en: Mapped[str] = mapped_column(String(255), nullable=False)
    name_bn: Mapped[str] = mapped_column(String(255), nullable=False)
    description_en: Mapped[str | None] = mapped_column(Text)
    description_bn: Mapped[str | None] = mapped_column(Text)
    short_description_en: Mapped[str | None] = mapped_column(Text)
    short_description_bn: Mapped[str | None] = mapped_column(Text)
    long_description_en: Mapped[str | None] = mapped_column(Text)
    long_description_bn: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    # Unified taxonomy FKs (additive; `category` string kept as cache).
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"), index=True
    )
    subcategory_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("subcategories.id", ondelete="SET NULL"), index=True
    )
    # Commerce capability overrides (NULL = infer from type; see core/capabilities.py).
    # A service is bookable by default; set is_orderable=True to ALSO sell it like a product.
    is_orderable: Mapped[bool | None] = mapped_column(Boolean)
    is_bookable: Mapped[bool | None] = mapped_column(Boolean)
    icon_url: Mapped[str | None] = mapped_column(Text)
    featured_image_url: Mapped[str | None] = mapped_column(Text)
    icon_color: Mapped[str | None] = mapped_column(String(20))
    pricing_type: Mapped[str] = mapped_column(String(20), nullable=False)  # fixed|hourly|package|custom_quote
    # Where the service is completed (manual_sql/0008). NULL = unspecified,
    # which preserves the pre-0008 behaviour exactly.
    fulfilment: Mapped[str | None] = mapped_column(String(20))  # remote|at_shop|hybrid
    # How long it takes, in working days (manual_sql/0011). A range, because
    # that is what these are in practice. NULL = not published.
    turnaround_days_min: Mapped[int | None] = mapped_column(SmallInteger)
    turnaround_days_max: Mapped[int | None] = mapped_column(SmallInteger)
    # CTA override (NULL = infer from pricing_type/capabilities; see schemas.resolve_service_cta).
    cta_type: Mapped[str | None] = mapped_column(String(20))  # book|order|quote|contact
    cta_label_en: Mapped[str | None] = mapped_column(String(120))
    cta_label_bn: Mapped[str | None] = mapped_column(String(120))
    base_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    min_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    max_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    hourly_rate: Mapped[float | None] = mapped_column(Numeric(10, 2))
    # Optional delivery charge for physical deliverables and an advance
    # consultancy fee that (when requires_advance is on) must be paid before
    # the booking is confirmed.
    delivery_charge: Mapped[float | None] = mapped_column(Numeric(10, 2))
    consultancy_fee: Mapped[float | None] = mapped_column(Numeric(10, 2))
    requires_advance: Mapped[bool] = mapped_column(Boolean, default=False)
    # Optional appointment scheduling (alembic 0013). Off = booking_date stays
    # a free "preferred date"; see core/scheduling.py for the rules.
    scheduling_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    slot_duration_minutes: Mapped[int | None] = mapped_column(Integer)
    slot_capacity: Mapped[int | None] = mapped_column(Integer)
    min_notice_hours: Mapped[int | None] = mapped_column(Integer)
    booking_horizon_days: Mapped[int | None] = mapped_column(Integer)
    working_hours: Mapped[dict] = mapped_column(JSON, default=dict)
    holidays: Mapped[list] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    lead_priority: Mapped[int] = mapped_column(Integer, default=5)
    lead_qualification_score: Mapped[int] = mapped_column(Integer, default=0)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    seo_title: Mapped[str | None] = mapped_column(String(255))
    seo_description: Mapped[str | None] = mapped_column(Text)
    seo_keywords: Mapped[str | None] = mapped_column(String(500))
    canonical_url: Mapped[str | None] = mapped_column(String(500))
    og_image: Mapped[str | None] = mapped_column(Text)
    # Optional product/service video (YouTube, Facebook, Vimeo or a Cloudinary upload).
    video_url: Mapped[str | None] = mapped_column(Text)
    process_steps: Mapped[list] = mapped_column(JSON, default=list)
    benefits: Mapped[list] = mapped_column(JSON, default=list)
    requirements: Mapped[list] = mapped_column(JSON, default=list)
    required_documents: Mapped[list] = mapped_column(JSON, default=list)
    faq: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    pricing_tiers: Mapped[list["ServicePricingTier"]] = relationship(back_populates="service", cascade="all, delete-orphan")
    booking_forms: Mapped[list["ServiceBookingForm"]] = relationship(back_populates="service", cascade="all, delete-orphan")
    bookings: Mapped[list["BookingV2"]] = relationship(back_populates="service")


class ServicePricingTier(Base):
    __tablename__ = "service_pricing_tiers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    service_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("services.id", ondelete="CASCADE"))
    tier_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description_en: Mapped[str | None] = mapped_column(Text)
    description_bn: Mapped[str | None] = mapped_column(Text)
    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    duration_days: Mapped[int | None] = mapped_column(Integer)
    features: Mapped[list] = mapped_column(JSON, default=list)
    includes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    service: Mapped["Service"] = relationship(back_populates="pricing_tiers")


class ServiceBookingForm(Base):
    __tablename__ = "service_booking_forms"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    service_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("services.id", ondelete="CASCADE"))
    field_name: Mapped[str] = mapped_column(String(100), nullable=False)
    field_type: Mapped[str] = mapped_column(String(50), nullable=False)
    field_label_en: Mapped[str] = mapped_column(String(255), nullable=False)
    field_label_bn: Mapped[str] = mapped_column(String(255), nullable=False)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True)
    placeholder: Mapped[str | None] = mapped_column(String(255))
    options: Mapped[list | None] = mapped_column(JSON)
    default_value: Mapped[str | None] = mapped_column(Text)
    validation_rules: Mapped[dict | None] = mapped_column(JSON)
    conditional_logic: Mapped[dict | None] = mapped_column(JSON)
    sort_order: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    service: Mapped["Service"] = relationship(back_populates="booking_forms")


class BookingV2(Base):
    __tablename__ = "bookings_v2"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    booking_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    # Nullable since alembic 0015: a booking may not map to a catalog service
    # (migrated legacy printing/legal intake, and walk-in bookings).
    service_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("services.id"))
    service_name: Mapped[str] = mapped_column(String(255), nullable=False)
    service_tier: Mapped[str | None] = mapped_column(String(100))
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    customer_phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    customer_email: Mapped[str | None] = mapped_column(String(255))
    customer_company: Mapped[str | None] = mapped_column(String(255))
    # Canonical customer-master link, resolved by phone at booking creation
    # (app.core.customer_master.get_or_create_customer).
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id"), index=True)
    # Normalized service location (alembic 0012). Previously concatenated into
    # `details`, which made it unqueryable.
    district: Mapped[str | None] = mapped_column(String(100), index=True)
    upazila: Mapped[str | None] = mapped_column(String(100))
    booking_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    estimated_completion_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pricing_type: Mapped[str] = mapped_column(String(20), nullable=False)
    quoted_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    final_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    # Advance consultancy amount and whether it has been received (gateway or
    # admin-marked); the booking stays pending until then.
    advance_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    advance_paid: Mapped[bool] = mapped_column(Boolean, default=False)
    # Coupon captured at booking time (alembic 0016); mirrors the order shape.
    coupon_code: Mapped[str | None] = mapped_column(String(50))
    discount_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    hours_worked: Mapped[float | None] = mapped_column(Numeric(5, 2))
    details: Mapped[str | None] = mapped_column(Text)
    requirements: Mapped[str | None] = mapped_column(Text)
    # Answers to the service's dynamic booking form (service_booking_forms).
    form_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    attachments: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    payment_status: Mapped[str] = mapped_column(String(20), default="pending")
    payment_method: Mapped[str | None] = mapped_column(String(50))
    payment_number: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    service: Mapped["Service"] = relationship(back_populates="bookings")


class LeadV2(Base):
    __tablename__ = "leads_v2"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    service_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("services.id"))
    lead_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(50), default="website")
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    # Canonical customer-master link, resolved by phone at lead creation
    # (app.core.customer_master.get_or_create_customer).
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("customers.id"), index=True)
    company: Mapped[str | None] = mapped_column(String(255))
    job_title: Mapped[str | None] = mapped_column(String(255))
    company_size: Mapped[str | None] = mapped_column(String(50))
    project_description: Mapped[str | None] = mapped_column(Text)
    requirements: Mapped[str | None] = mapped_column(Text)
    budget_range: Mapped[str | None] = mapped_column(String(50))
    budget_min: Mapped[float | None] = mapped_column(Numeric(10, 2))
    budget_max: Mapped[float | None] = mapped_column(Numeric(10, 2))
    timeline: Mapped[str | None] = mapped_column(String(100))
    attachments: Mapped[list] = mapped_column(JSON, default=list)
    qualification_score: Mapped[int] = mapped_column(Integer, default=0, index=True)
    status: Mapped[str] = mapped_column(String(20), default="new", index=True)
    reason_lost: Mapped[str | None] = mapped_column(Text)
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id"))
    next_action: Mapped[str | None] = mapped_column(Text)
    next_action_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    converted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"))
    booking_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("bookings_v2.id"))
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    customer_email: Mapped[str | None] = mapped_column(String(255))
    customer_phone: Mapped[str | None] = mapped_column(String(20))
    items: Mapped[list] = mapped_column(JSON, nullable=False)
    subtotal: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    tax: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    # Delivery charge and coupon discount captured at invoice time so the
    # invoice always reconciles: subtotal - discount + delivery = total. Both
    # default 0 (older rows are backfilled from subtotal/total on read).
    discount_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    delivery_charge: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    total: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    payment_method: Mapped[str | None] = mapped_column(String(50))
    payment_status: Mapped[str] = mapped_column(String(20), default="pending")
    # Institutional identity as printed on THIS invoice (manual_sql/0010).
    # An invoice already keeps its own copy of the customer name, phone, email,
    # item lines and totals; this is the same idea, so editing or deleting the
    # order can never change a bill that has already gone out. NULL on every
    # personal order and on every invoice issued before 0010.
    company_name: Mapped[str | None] = mapped_column(String(255))
    company_bin: Mapped[str | None] = mapped_column(String(50))
    company_tin: Mapped[str | None] = mapped_column(String(50))
    po_number: Mapped[str | None] = mapped_column(String(100))
    billing_address: Mapped[str | None] = mapped_column(Text)
    issued_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    pdf_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class PaymentMethod(Base):
    __tablename__ = "payment_methods"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    payment_gateway: Mapped[str] = mapped_column(String(50), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    account_identifier: Mapped[str | None] = mapped_column(String(255))
    commission_percentage: Mapped[float] = mapped_column(Numeric(5, 2), default=0)
    min_amount: Mapped[float | None] = mapped_column(Numeric(10, 2))
    max_amount: Mapped[float | None] = mapped_column(Numeric(10, 2))
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class BkashTransaction(Base):
    __tablename__ = "bkash_transactions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"))
    booking_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("bookings_v2.id"))
    bkash_transaction_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    payment_id: Mapped[str | None] = mapped_column(String(50), unique=True)
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="BDT")
    payer_reference: Mapped[str | None] = mapped_column(String(255))
    merchant_invoice_number: Mapped[str | None] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    status_message: Mapped[str | None] = mapped_column(Text)
    payment_execute_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    webhook_received: Mapped[bool] = mapped_column(Boolean, default=False)
    webhook_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw_response: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class NagadTransaction(Base):
    __tablename__ = "nagad_transactions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"))
    booking_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("bookings_v2.id"))
    nagad_reference_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    merchant_order_id: Mapped[str] = mapped_column(String(50), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="BDT")
    customer_number: Mapped[str | None] = mapped_column(String(20))
    merchant_number: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    status_message: Mapped[str | None] = mapped_column(Text)
    settlement_status: Mapped[str | None] = mapped_column(String(20))
    payment_completion_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    webhook_received: Mapped[bool] = mapped_column(Boolean, default=False)
    webhook_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw_response: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class SslcommerzTransaction(Base):
    __tablename__ = "sslcommerz_transactions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("orders.id"))
    booking_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("bookings_v2.id"))
    tran_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    val_id: Mapped[str | None] = mapped_column(String(100))
    bank_tran_id: Mapped[str | None] = mapped_column(String(100))
    card_type: Mapped[str | None] = mapped_column(String(50))
    amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="BDT")
    status: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    status_message: Mapped[str | None] = mapped_column(Text)
    webhook_received: Mapped[bool] = mapped_column(Boolean, default=False)
    webhook_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw_response: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class PaymentReconciliation(Base):
    __tablename__ = "payment_reconciliation"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    reconciliation_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    payment_gateway: Mapped[str] = mapped_column(String(20), nullable=False)
    total_transactions: Mapped[int] = mapped_column(Integer, default=0)
    total_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    successful_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    pending_count: Mapped[int] = mapped_column(Integer, default=0)
    discrepancies: Mapped[list] = mapped_column(JSON, default=list)
    reconciliation_status: Mapped[str] = mapped_column(String(20), default="pending")
    notes: Mapped[str | None] = mapped_column(Text)
    processed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    admin_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id"))
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    old_values: Mapped[dict | None] = mapped_column(JSON)
    new_values: Mapped[dict | None] = mapped_column(JSON)
    ip_address: Mapped[str | None] = mapped_column(String(45))
    user_agent: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class Notification(Base):
    """Persistent, per-admin (or broadcast when target_admin_id is NULL)
    actionable alert — read/unread, dismissible. Distinct from ActivityLog
    (records what an admin did) and SystemEvent (technical/system telemetry):
    this is what an admin needs to *see and act on*."""

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="info")
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text)
    # NULL = broadcast to every admin; set = targeted at one admin account.
    target_admin_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id"), index=True)
    link: Mapped[str | None] = mapped_column(String(500))
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class SystemEvent(Base):
    """Persistent technical/operational event log — the durable counterpart
    to the in-process ring buffers in app.core.ops_events (recent_errors,
    failed_emails, failed_logins), which are lost on every restart/deploy."""

    __tablename__ = "system_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="error", index=True)
    source: Mapped[str] = mapped_column(String(100), nullable=False, default="app")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class EmailTemplate(Base):
    __tablename__ = "email_templates"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    template_name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    subject_en: Mapped[str] = mapped_column(String(255), nullable=False)
    subject_bn: Mapped[str] = mapped_column(String(255), nullable=False)
    body_en: Mapped[str] = mapped_column(Text, nullable=False)
    body_bn: Mapped[str] = mapped_column(Text, nullable=False)
    variables: Mapped[list] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class BlogPost(Base):
    __tablename__ = "blog_posts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    title_en: Mapped[str] = mapped_column(String(500), nullable=False)
    title_bn: Mapped[str | None] = mapped_column(String(500))
    content_en: Mapped[str] = mapped_column(Text, nullable=False)
    content_bn: Mapped[str | None] = mapped_column(Text)
    excerpt_en: Mapped[str | None] = mapped_column(Text)
    excerpt_bn: Mapped[str | None] = mapped_column(Text)
    featured_image_url: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(100), index=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    author_name: Mapped[str] = mapped_column(String(255), default="ABO Enterprise")
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    seo_title: Mapped[str | None] = mapped_column(String(255))
    seo_description: Mapped[str | None] = mapped_column(Text)
    seo_keywords: Mapped[str | None] = mapped_column(String(500))
    canonical_url: Mapped[str | None] = mapped_column(String(500))
    og_image: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class Page(Base):
    """Generic CMS page — independent of Blog/Product/Service, for one-off
    content (e.g. a standalone landing/legal/info page) that needs its own
    URL, SEO fields and draft/publish workflow without being any of those
    specific content types. Same shape as BlogPost by design, minus the
    blog-specific fields (category, author, excerpt, product/service links)."""

    __tablename__ = "pages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    title_en: Mapped[str] = mapped_column(String(500), nullable=False)
    title_bn: Mapped[str | None] = mapped_column(String(500))
    content_en: Mapped[str] = mapped_column(Text, nullable=False)
    content_bn: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    seo_title: Mapped[str | None] = mapped_column(String(255))
    seo_description: Mapped[str | None] = mapped_column(Text)
    seo_keywords: Mapped[str | None] = mapped_column(String(500))
    canonical_url: Mapped[str | None] = mapped_column(String(500))
    og_image: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class BlogPostLink(Base):
    """Many-to-many link between a blog post and a product OR a service.

    One row links a single post to a single item; exactly one of
    ``product_id`` / ``service_id`` is set (enforced by a CHECK constraint in
    the DB). Managed from both sides in the admin: a product/service form picks
    its blogs, and the blog editor picks its products & services — both write
    here, so there is a single source of truth and no duplicate rows (partial
    unique indexes). Cascade deletes keep it clean when either side is removed.
    """

    __tablename__ = "blog_post_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    blog_post_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("blog_posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    service_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("services.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AssistantConversation(Base):
    __tablename__ = "assistant_conversations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    customer_name: Mapped[str | None] = mapped_column(String(255))
    customer_phone: Mapped[str | None] = mapped_column(String(20), index=True)
    customer_email: Mapped[str | None] = mapped_column(String(255))
    language: Mapped[str] = mapped_column(String(10), default="en")
    last_intent: Mapped[str | None] = mapped_column(String(50))
    context: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    messages: Mapped[list["AssistantMessage"]] = relationship(back_populates="conversation")


class AssistantMessage(Base):
    __tablename__ = "assistant_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("assistant_conversations.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    intent: Mapped[str | None] = mapped_column(String(50))
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    conversation: Mapped["AssistantConversation"] = relationship(back_populates="messages")


class AssistantActionLog(Base):
    __tablename__ = "assistant_action_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[str | None] = mapped_column(String(64), index=True)
    intent: Mapped[str | None] = mapped_column(String(50))
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    admin_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("admin_users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class MediaAsset(Base):
    __tablename__ = "media_assets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    url: Mapped[str] = mapped_column(Text, nullable=False, unique=True, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    folder: Mapped[str] = mapped_column(String(255), default="abo-enterprise/uploads", index=True)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(50), nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    format: Mapped[str | None] = mapped_column(String(20))
    cloudinary_public_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    uploaded_by: Mapped[str | None] = mapped_column(String(255))
    alt_text: Mapped[str | None] = mapped_column(String(500))
    tags: Mapped[list] = mapped_column(JSON, default=list)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class CareerApplication(Base):
    __tablename__ = "career_applications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), index=True)
    phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    position: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    cover_letter: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="new", index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


# ---------------------------------------------------------------------------
# Unified commerce taxonomy — normalized Category → Subcategory → Item.
#
# Additive layer over the existing denormalized string columns
# (Product.category / Product.sub_category / Service.category). The string
# columns are retained as a backward-compatible cache so every existing
# query, filter and URL keeps working unchanged; these tables give a single
# managed taxonomy shared by products and services.
# ---------------------------------------------------------------------------
class PromoSlide(Base):
    """Admin-managed promo slide — image or video, with an optional link.

    One table serves every carousel on the site; `placement` decides where a
    slide appears (hero card, flash-sale strip, …), so a new surface needs no
    new table.
    """

    __tablename__ = "promo_slides"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    placement: Mapped[str] = mapped_column(String(40), default="hero", index=True)
    image_url: Mapped[str | None] = mapped_column(Text)
    # Optional phone/tablet artwork (<1024px); falls back to image_url when empty.
    mobile_image_url: Mapped[str | None] = mapped_column(Text)
    video_url: Mapped[str | None] = mapped_column(Text)
    link_url: Mapped[str | None] = mapped_column(Text)
    title_en: Mapped[str | None] = mapped_column(String(255))
    title_bn: Mapped[str | None] = mapped_column(String(255))
    alt_text: Mapped[str | None] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    # Optional scheduling window; NULL on either side = unbounded.
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    name_en: Mapped[str] = mapped_column(String(255), nullable=False)
    name_bn: Mapped[str | None] = mapped_column(String(255))
    description_en: Mapped[str | None] = mapped_column(Text)
    description_bn: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(80))
    image_url: Mapped[str | None] = mapped_column(Text)
    # Which item kinds this category applies to, e.g. ["product"], ["service"]
    # or both. JSON keeps it flexible without extra join tables.
    applies_to: Mapped[list] = mapped_column(JSON, default=list)
    # Unlimited-depth tree: NULL = root (a "vertical"); otherwise the parent
    # node. Legacy subcategories were unified into this table (same UUIDs) by
    # alembic 0008.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="CASCADE"), index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    # Per-category SEO overrides (alembic 0011). NULL = derive from name /
    # description, which is what every category page did before.
    seo_title: Mapped[str | None] = mapped_column(String(255))
    seo_description: Mapped[str | None] = mapped_column(Text)
    seo_keywords: Mapped[str | None] = mapped_column(String(500))
    canonical_url: Mapped[str | None] = mapped_column(String(500))
    og_image: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    subcategories: Mapped[list["Subcategory"]] = relationship(
        back_populates="category", cascade="all, delete-orphan"
    )


class Coupon(Base):
    """Real table backing coupon codes — replaces the coupons_json Setting
    blob (manual_sql/0023). orders.coupon_code / bookings_v2.coupon_code
    stay free-text (a coupon can be deleted after use without breaking
    historical orders that already snapshot their own discount_amount)."""

    __tablename__ = "coupons"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    discount_percent: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    min_subtotal: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class NewsletterSubscriber(Base):
    """Real table backing footer newsletter signups — replaces the
    newsletter_subscribers Setting JSON blob (0024), which had no timestamps,
    no unsubscribe state, and a check-then-write race under concurrent
    signups."""

    __tablename__ = "newsletter_subscribers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str | None] = mapped_column(String(50))
    subscribed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    unsubscribed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Subcategory(Base):
    __tablename__ = "subcategories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="CASCADE"), index=True
    )
    slug: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    name_en: Mapped[str] = mapped_column(String(255), nullable=False)
    name_bn: Mapped[str | None] = mapped_column(String(255))
    description_en: Mapped[str | None] = mapped_column(Text)
    description_bn: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(80))
    image_url: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    category: Mapped["Category"] = relationship(back_populates="subcategories")


class Combo(Base):
    """A bundle of products sold together at one combo price (manual_sql/030).

    The combo price is the single source of truth for what the customer pays —
    orders re-derive it server-side, never trusting a client total, exactly like
    single-product pricing. `compare_at_price` is optional; when unset the
    storefront falls back to the summed item prices for the struck-through
    "was" figure. A combo may also grant free delivery.
    """

    __tablename__ = "combos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    title_en: Mapped[str] = mapped_column(String(255), nullable=False)
    title_bn: Mapped[str] = mapped_column(String(255), nullable=False)
    description_en: Mapped[str | None] = mapped_column(Text)
    description_bn: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    combo_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    compare_at_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    badge_en: Mapped[str | None] = mapped_column(String(80))
    badge_bn: Mapped[str | None] = mapped_column(String(80))
    free_delivery: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    items: Mapped[list["ComboItem"]] = relationship(
        back_populates="combo", cascade="all, delete-orphan", order_by="ComboItem.sort_order"
    )


class ComboItem(Base):
    """One product line inside a combo (which product, how many)."""

    __tablename__ = "combo_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    combo_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("combos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    combo: Mapped["Combo"] = relationship(back_populates="items")


class DeliveryZone(Base):
    """Admin-defined delivery rule for a set of districts (and, optionally,
    specific upazilas). manual_sql/031.

    Checkout matches the customer's district/upazila to the first active zone
    (by sort_order) and uses its `charge`, with free delivery when the
    subtotal-after-discount reaches `free_threshold` (0/NULL = never free). When
    no zone matches, checkout falls back to the legacy settings-based 3-tier
    charge, so existing behaviour is never lost.
    """

    __tablename__ = "delivery_zones"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    name_bn: Mapped[str] = mapped_column(String(120), nullable=False)
    # District names this zone covers, and (optionally) the specific upazilas.
    # An empty upazilas list means the whole district(s).
    districts: Mapped[list] = mapped_column(JSON, default=list)
    upazilas: Mapped[list] = mapped_column(JSON, default=list)
    charge: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    free_threshold: Mapped[float | None] = mapped_column(Numeric(10, 2))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class ProductImportJob(Base):
    """One bulk product-import run — its counts and per-row error report, for the
    admin Import History (manual_sql/032). Additive audit only; nothing here is
    read by the storefront or the order/checkout path."""

    __tablename__ = "product_import_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    admin_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    filename: Mapped[str | None] = mapped_column(String(255))
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    created_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_count: Mapped[int] = mapped_column(Integer, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    # Per-row error report: [{"row": n, "errors": [...], "warnings": [...]}].
    errors: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SearchTerm(Base):
    """A normalized search query and how many times it's been searched — powers
    the storefront's "popular searches" suggestions (manual_sql/033). Additive
    analytics only; never read by the order/checkout path."""

    __tablename__ = "search_terms"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    term: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    count: Mapped[int] = mapped_column(Integer, default=0, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# ==================== MOBILE APP (APON) DOWNLOADS ====================


class AppRelease(Base):
    """One uploaded build of the mobile app. `source_url` is private (admin only): visitors
    only ever download through the website, never from this address."""

    __tablename__ = "app_releases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version_name: Mapped[str] = mapped_column(String(40), nullable=False)
    # Which app this build belongs to ('apon' = the first app). Version numbers are unique per app (manual_sql/0054).
    app_key: Mapped[str] = mapped_column(String(30), nullable=False, default="apon", server_default="apon", index=True)
    version_code: Mapped[int] = mapped_column(Integer, nullable=False)
    file_name: Mapped[str] = mapped_column(String(120), nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    sha256: Mapped[str | None] = mapped_column(String(64))
    min_android: Mapped[str | None] = mapped_column(String(20))
    changelog_bn: Mapped[str | None] = mapped_column(Text)
    changelog_en: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | published
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    download_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class AppDownloadEvent(Base):
    """One completed download request. The visitor's IP is stored only as a keyed hash."""

    __tablename__ = "app_download_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    release_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_releases.id", ondelete="SET NULL"))
    ip_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    user_agent: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Passkey(Base):
    """WebAuthn passkey (fingerprint / face / phone screen-lock sign-in).

    owner_type 'admin' → owner_ref = admin_users.id (text);
    owner_type 'customer' → owner_ref = the verified phone/e-mail the customer
    token is issued for. Only the PUBLIC key is stored — the private key never
    leaves the user's device.
    """

    __tablename__ = "passkeys"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    owner_ref: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    credential_id: Mapped[str] = mapped_column(String(512), nullable=False, unique=True, index=True)
    public_key: Mapped[str] = mapped_column(Text, nullable=False)
    sign_count: Mapped[int] = mapped_column(BigInteger, default=0)
    transports: Mapped[list] = mapped_column(JSON, default=list)
    name: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class PushSubscription(Base):
    """A browser/phone that agreed to receive offer notifications (Web Push)."""

    __tablename__ = "push_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(String(255), nullable=False)
    auth: Mapped[str] = mapped_column(String(255), nullable=False)
    lang: Mapped[str] = mapped_column(String(5), default="bn")
    user_agent: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PushCampaign(Base):
    """One offer notification written in admin: text, image, link and when to send it."""

    __tablename__ = "push_campaigns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title_bn: Mapped[str] = mapped_column(String(120), nullable=False)
    title_en: Mapped[str | None] = mapped_column(String(120))
    body_bn: Mapped[str] = mapped_column(String(300), nullable=False)
    body_en: Mapped[str | None] = mapped_column(String(300))
    image_url: Mapped[str | None] = mapped_column(Text)
    link_url: Mapped[str] = mapped_column(String(500), default="/")
    audience: Mapped[str] = mapped_column(String(10), default="all")  # all | bn | en
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # draft | scheduled | sending | sent | failed
    status: Mapped[str] = mapped_column(String(12), default="draft", index=True)
    sent_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
