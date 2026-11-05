# Sumon VA server

Own backend for the phone app (FastAPI, SQLAlchemy 2 async, Supabase Postgres). Forked from `masumon/abo-enterprise` `main` at commit 9b258a45 (2026-11-06; includes release PR #468). It does NOT connect to ABO's database.

- Routes: `inbox` (device pair/login/passkey/ingest/poll/ack), `wa_assistant`, `ai_hub`, `ai_catalog`, `/health`, `/.well-known/assetlinks.json`.
- Removed from the fork: shop, payments, couriers, website chatbot, backup engine, Apon downloads.
- ABO business numbers: `app/core/abo_client.py` (read-only, off until `ABO_API_BASE` + `ABO_INTEGRATION_TOKEN` are set).
- Schema: run `manual_sql/0001_sumon_va_schema.sql` once in the new Supabase SQL editor (idempotent, RLS on).
- Render: root directory `server`, build `pip install -r requirements.txt`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, health `/health`, Python 3.11.9.
- Tests: `pip install pytest pytest-asyncio aiosqlite` then `pytest` (267 pass at fork time).
- Env variable names and the whole plan: `docs/TRANSFER.md`. Never put secrets in git.
