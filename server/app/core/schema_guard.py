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
import re

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
            missing = [s for s in WA_TABLES_SQL if (await conn.execute(text("SELECT to_regclass(:n)"), {"n": object_name(s)})).scalar() is None]
            if not missing:
                return  # everything exists: run NO DDL, so start-up never waits for a lock held by the old instance during a deploy
            await conn.execute(text("SET LOCAL lock_timeout = '3s'"))
            await conn.execute(text("SET LOCAL statement_timeout = '15s'"))
            for stmt in missing:
                await conn.execute(text(stmt))
    except Exception:  # never stop the API from starting (a lock that is not free within 3 s is skipped, the tables already exist)
        logger.exception("Schema guard could not create WhatsApp assistant tables")


def object_name(stmt: str) -> str:
    """The table or index a CREATE ... IF NOT EXISTS statement makes."""
    m = re.search(r"IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)", stmt)
    return m.group(1) if m else ""


