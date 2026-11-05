"""Commerce capability layer.

A single, declarative place that answers: *what can be done with this
commerce entity?* Capabilities are inferred from the entity's own data
(fields that already exist in the schema) rather than hardcoded at each call
site, so the rule lives in one location and new entity kinds slot in without
touching the checkout/booking code.

Current mapping (derived from the actual models):
- ``Product``  → ORDERABLE   (has ``price`` + participates in OrderItem)
- ``Service``  → BOOKABLE     (has ``pricing_type`` + drives BookingV2)

The design is intentionally extensible: an entity may declare *more than one*
capability (e.g. a future product that also needs on-site installation would
be both ORDERABLE and BOOKABLE). Nothing here mutates data or touches the DB;
it only reads attributes, so it is safe to call from any layer.
"""

from __future__ import annotations

from enum import Enum
from typing import Any


class Capability(str, Enum):
    ORDERABLE = "orderable"  # can be added to cart and checked out as an Order
    BOOKABLE = "bookable"    # can be requested via a (dynamic) booking form


def _is_product(entity: Any) -> bool:
    return entity.__class__.__name__ == "Product" or getattr(entity, "__tablename__", None) == "products"


def _is_service(entity: Any) -> bool:
    return entity.__class__.__name__ == "Service" or getattr(entity, "__tablename__", None) == "services"


def capabilities_for(
    kind: str,
    is_orderable: bool | None,
    is_bookable: bool | None,
) -> set[Capability]:
    """Single source of the capability rule, working on plain flags.

    ``kind`` is ``"product"`` or ``"service"``. Rule:
    - an explicit ``True`` override always grants the capability;
    - otherwise a product is ORDERABLE by default and a service is BOOKABLE by
      default (``None`` = infer from kind);
    - an explicit ``False`` disables the inferred capability.

    Both the ORM helper below and the API schemas call this, so the rule lives
    in exactly one place.
    """
    caps: set[Capability] = set()

    if is_orderable is True or (is_orderable is None and kind == "product"):
        caps.add(Capability.ORDERABLE)
    if is_bookable is True or (is_bookable is None and kind == "service"):
        caps.add(Capability.BOOKABLE)

    return caps


def get_capabilities(entity: Any) -> set[Capability]:
    """Infer the set of capabilities for a commerce entity ORM instance.

    Delegates the rule to :func:`capabilities_for`; this wrapper only resolves
    the entity ``kind`` and reads the optional override columns.
    """
    if _is_product(entity):
        kind = "product"
    elif _is_service(entity):
        kind = "service"
    else:
        return set()

    return capabilities_for(
        kind,
        getattr(entity, "is_orderable", None),
        getattr(entity, "is_bookable", None),
    )


def is_orderable(entity: Any) -> bool:
    return Capability.ORDERABLE in get_capabilities(entity)


def is_bookable(entity: Any) -> bool:
    return Capability.BOOKABLE in get_capabilities(entity)


# ==================== SERVICE CTA RESOLUTION ====================

# Default bilingual labels per CTA type. An admin label override always wins.
CTA_DEFAULT_LABELS: dict[str, tuple[str, str]] = {
    "book": ("Book Now", "বুকিং করুন"),
    "order": ("Order Now", "এখনই অর্ডার করুন"),
    "quote": ("Request Quote", "কোটেশন নিন"),
    "contact": ("Contact Us", "যোগাযোগ করুন"),
}


def resolve_service_cta(
    cta_type: str | None,
    cta_label_en: str | None,
    cta_label_bn: str | None,
    pricing_type: str | None,
    is_orderable: bool | None,
    is_bookable: bool | None,
) -> dict:
    """Resolve the effective Call-To-Action for a service.

    Single source of truth used by the API (ServiceOut.cta) so every surface
    (cards, detail page, booking form) renders the same button. Rule:
    - an explicit admin ``cta_type`` override wins;
    - otherwise infer: ``custom_quote`` pricing → "quote"; orderable-but-not-
      bookable → "order"; not bookable at all → "contact"; default → "book".
    Admin label overrides replace the default bilingual labels.
    """
    ctype = cta_type if cta_type in CTA_DEFAULT_LABELS else None
    if ctype is None:
        caps = capabilities_for("service", is_orderable, is_bookable)
        # "custom" is a legacy alias for "custom_quote" — both mean the price is
        # quoted per job, so both must resolve to the quote CTA.
        if pricing_type in ("custom_quote", "custom"):
            ctype = "quote"
        elif Capability.ORDERABLE in caps and Capability.BOOKABLE not in caps:
            ctype = "order"
        elif Capability.BOOKABLE not in caps:
            ctype = "contact"
        else:
            ctype = "book"
    default_en, default_bn = CTA_DEFAULT_LABELS[ctype]
    return {
        "type": ctype,
        "label_en": cta_label_en or default_en,
        "label_bn": cta_label_bn or default_bn,
    }
