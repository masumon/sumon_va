"""Test isolation: the local backend/.env points at the LIVE Supabase database
and LIVE Sentry. Environment variables win over .env (pydantic-settings), so
set safe values here — before any test imports the app — so a test run can
never open connections to production or report errors to production Sentry.
"""
import os

os.environ["DATABASE_URL"] = "postgresql+asyncpg://localhost:5999/abo_test_never_production"
os.environ["SENTRY_DSN"] = ""
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production")
os.environ["RESEND_API_KEY"] = ""
