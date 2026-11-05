"""Start-up safety net for additive admin-security columns.

This project applies database changes by hand (backend/manual_sql/*.sql on Supabase,
because Render's free tier has no migration step). If the SQL is forgotten the new
admin-security columns are missing and *every* admin sign-in fails.

At start-up we look at `admin_users` once; only if a column is missing do we add it with
`ADD COLUMN IF NOT EXISTS` — the exact statements of manual_sql/0041_admin_security.sql.
Nothing is ever changed, dropped or rewritten, normal start-ups run no DDL at all, and a
failure here is logged but never blocks the API from starting.
"""
from __future__ import annotations

import logging

from sqlalchemy import text

logger = logging.getLogger(__name__)

# column -> DDL type (identical to alembic 0041 and manual_sql/0041)
ADMIN_SECURITY_COLUMNS: dict[str, str] = {
    "totp_recovery_codes": "TEXT",
    "totp_last_step": "BIGINT",
    "token_version": "INTEGER NOT NULL DEFAULT 0",
    "failed_login_count": "INTEGER NOT NULL DEFAULT 0",
    "locked_until": "TIMESTAMPTZ",
}


def missing_admin_security_statements(existing_columns: set[str]) -> list[str]:
    """ALTER statements for the columns that are not there yet (empty when all exist)."""
    return [
        f"ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS {name} {ddl}"
        for name, ddl in ADMIN_SECURITY_COLUMNS.items()
        if name not in existing_columns
    ]


ORDER_REFUND_COLUMNS: dict[str, str] = {
    "refund_amount": "NUMERIC(10,2)",
    "refund_method": "VARCHAR(30)",
    "refund_note": "TEXT",
    "refunded_at": "TIMESTAMPTZ",
    "courier_dispatch_at": "TIMESTAMPTZ",  # manual_sql/0050
    "courier_error": "TEXT",
}


async def ensure_order_refund_columns(engine) -> list[str]:
    """Add any missing refund columns on orders (manual_sql/0048). Never blocks start-up."""
    if getattr(engine.dialect, "name", "") != "postgresql":
        return []
    try:
        async with engine.begin() as conn:
            rows = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'orders' AND table_schema = current_schema()"))
            existing = {r[0] for r in rows}
            if not existing:
                return []
            statements = [f"ALTER TABLE orders ADD COLUMN IF NOT EXISTS {n} {d}"
                          for n, d in ORDER_REFUND_COLUMNS.items() if n not in existing]
            for stmt in statements:
                await conn.execute(text(stmt))
        if statements:
            logger.warning("orders was missing %d refund column(s); added them. Run manual_sql/0048.", len(statements))
        return statements
    except Exception:  # never stop the API from starting
        logger.exception("Schema guard could not check/patch orders refund columns")
        return []


PROMO_SLIDE_COLUMNS: dict[str, str] = {
    "mobile_image_url": "TEXT",
}


async def ensure_promo_slide_columns(engine) -> list[str]:
    """Add any missing promo_slides columns (manual_sql/0052). Never blocks start-up."""
    if getattr(engine.dialect, "name", "") != "postgresql":
        return []
    try:
        async with engine.begin() as conn:
            rows = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'promo_slides' AND table_schema = current_schema()"))
            existing = {r[0] for r in rows}
            if not existing:
                return []
            statements = [f"ALTER TABLE promo_slides ADD COLUMN IF NOT EXISTS {n} {d}"
                          for n, d in PROMO_SLIDE_COLUMNS.items() if n not in existing]
            for stmt in statements:
                await conn.execute(text(stmt))
        if statements:
            logger.warning("promo_slides was missing %d column(s); added them. Run manual_sql/0052.", len(statements))
        return statements
    except Exception:  # never stop the API from starting
        logger.exception("Schema guard could not check/patch promo_slides columns")
        return []


async def ensure_admin_security_columns(engine) -> list[str]:
    """Add any missing admin-security columns. Returns the statements that were run."""
    if getattr(engine.dialect, "name", "") != "postgresql":
        return []
    try:
        async with engine.begin() as conn:
            rows = await conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'admin_users' AND table_schema = current_schema()"
                )
            )
            existing = {r[0] for r in rows}
            if not existing:  # table not there at all: nothing to patch
                return []
            statements = missing_admin_security_statements(existing)
            for stmt in statements:
                await conn.execute(text(stmt))
        if statements:
            logger.warning(
                "admin_users was missing %d admin-security column(s); added them automatically. "
                "Run backend/manual_sql/0041_admin_security.sql on Supabase to keep the schema record complete.",
                len(statements),
            )
        return statements
    except Exception:  # never stop the API from starting
        logger.exception("Schema guard could not check/patch admin_users columns")
        return []


PUSH_TABLES_SQL = [
    """CREATE TABLE IF NOT EXISTS push_subscriptions (
        id UUID PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh VARCHAR(255) NOT NULL, auth VARCHAR(255) NOT NULL,
        lang VARCHAR(5) NOT NULL DEFAULT 'bn', user_agent VARCHAR(255), is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_sent_at TIMESTAMPTZ)""",
    "CREATE INDEX IF NOT EXISTS ix_push_subscriptions_is_active ON push_subscriptions (is_active)",
    """CREATE TABLE IF NOT EXISTS push_campaigns (
        id UUID PRIMARY KEY, title_bn VARCHAR(120) NOT NULL, title_en VARCHAR(120), body_bn VARCHAR(300) NOT NULL,
        body_en VARCHAR(300), image_url TEXT, link_url VARCHAR(500) NOT NULL DEFAULT '/', audience VARCHAR(10) NOT NULL DEFAULT 'all',
        scheduled_at TIMESTAMPTZ, status VARCHAR(12) NOT NULL DEFAULT 'draft', sent_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0, sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    "CREATE INDEX IF NOT EXISTS ix_push_campaigns_status ON push_campaigns (status)",
]  # identical to manual_sql/0053


async def ensure_push_tables(engine) -> None:
    """Create the offer-notification tables when the SQL was not run yet (additive; never blocks start-up)."""
    if getattr(engine.dialect, "name", "") != "postgresql":
        return
    try:
        async with engine.begin() as conn:
            for stmt in PUSH_TABLES_SQL:
                await conn.execute(text(stmt))
    except Exception:  # never stop the API from starting
        logger.exception("Schema guard could not create push tables")


WA_TABLES_SQL = [
    """CREATE TABLE IF NOT EXISTS wa_contacts (
        id UUID PRIMARY KEY, phone VARCHAR(20) NOT NULL UNIQUE, name VARCHAR(120), calls_him VARCHAR(40), relation VARCHAR(40),
        gender VARCHAR(10), mode VARCHAR(10) NOT NULL DEFAULT 'inherit', is_vip BOOLEAN NOT NULL DEFAULT FALSE,
        is_family BOOLEAN NOT NULL DEFAULT FALSE, is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
        state VARCHAR(10) NOT NULL DEFAULT 'assistant', hold_until TIMESTAMPTZ, priority SMALLINT NOT NULL DEFAULT 5,
        need TEXT, summary TEXT, profile JSON, unread INTEGER NOT NULL DEFAULT 0, lang VARCHAR(5),
        last_inbound_at TIMESTAMPTZ, last_outbound_at TIMESTAMPTZ, last_message_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    "CREATE INDEX IF NOT EXISTS ix_wa_contacts_state ON wa_contacts (state)",
    "CREATE INDEX IF NOT EXISTS ix_wa_contacts_last_message_at ON wa_contacts (last_message_at DESC)",
    """CREATE TABLE IF NOT EXISTS wa_messages (
        id UUID PRIMARY KEY, contact_id UUID NOT NULL REFERENCES wa_contacts(id) ON DELETE CASCADE, direction VARCHAR(3) NOT NULL,
        wa_id VARCHAR(120) UNIQUE, kind VARCHAR(12) NOT NULL DEFAULT 'text', body TEXT, transcript TEXT,
        status VARCHAR(10) NOT NULL DEFAULT 'received', reason VARCHAR(40), send_after TIMESTAMPTZ, sent_at TIMESTAMPTZ,
        delivery VARCHAR(12), error VARCHAR(300), meta JSON, feedback SMALLINT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    "CREATE INDEX IF NOT EXISTS ix_wa_messages_contact_created ON wa_messages (contact_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_wa_messages_status_send_after ON wa_messages (status, send_after)",
    """CREATE TABLE IF NOT EXISTS wa_notes (
        id UUID PRIMARY KEY, contact_id UUID NOT NULL REFERENCES wa_contacts(id) ON DELETE CASCADE, text TEXT NOT NULL,
        until TIMESTAMPTZ, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now())""",
    "CREATE INDEX IF NOT EXISTS ix_wa_notes_contact_active ON wa_notes (contact_id, is_active)",
    """CREATE TABLE IF NOT EXISTS wa_tasks (
        id UUID PRIMARY KEY, contact_id UUID REFERENCES wa_contacts(id) ON DELETE SET NULL, title VARCHAR(300) NOT NULL,
        due_at TIMESTAMPTZ, is_done BOOLEAN NOT NULL DEFAULT FALSE, source VARCHAR(10) NOT NULL DEFAULT 'manual',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), done_at TIMESTAMPTZ)""",
    "CREATE INDEX IF NOT EXISTS ix_wa_tasks_open ON wa_tasks (is_done, due_at)",
]  # identical to manual_sql/0055


async def ensure_wa_tables(engine) -> None:
    """Create the personal-assistant tables when the SQL was not run yet (additive; never blocks start-up)."""
    if getattr(engine.dialect, "name", "") != "postgresql":
        return
    try:
        async with engine.begin() as conn:
            for stmt in WA_TABLES_SQL:
                await conn.execute(text(stmt))
    except Exception:  # never stop the API from starting
        logger.exception("Schema guard could not create WhatsApp assistant tables")


async def ensure_customer_avatar_column(engine) -> None:
    """customers.avatar_url (manual_sql/0051) — without it a customer's photo can neither be saved nor shown."""
    if getattr(engine.dialect, "name", "") != "postgresql":
        return
    try:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar_url TEXT"))
    except Exception:  # never stop the API from starting
        logger.exception("Schema guard could not add customers.avatar_url")


MULTI_APP_SQL = [
    "ALTER TABLE app_releases ADD COLUMN IF NOT EXISTS app_key VARCHAR(30) NOT NULL DEFAULT 'apon'",
    "CREATE INDEX IF NOT EXISTS ix_app_releases_app_key ON app_releases (app_key)",
    "ALTER TABLE app_releases DROP CONSTRAINT IF EXISTS app_releases_version_code_key",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_app_releases_app_version ON app_releases (app_key, version_code) WHERE is_deleted = false",
]  # identical to manual_sql/0054


async def ensure_multi_app_columns(engine) -> None:
    """app_releases.app_key and per-app version numbers (manual_sql/0054). Additive; never blocks start-up."""
    if getattr(engine.dialect, "name", "") != "postgresql":
        return
    try:
        async with engine.begin() as conn:
            for stmt in MULTI_APP_SQL:
                await conn.execute(text(stmt))
    except Exception:  # never stop the API from starting
        logger.exception("Schema guard could not apply the multi-app change")
