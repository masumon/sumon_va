# Sumon VA: full separation plan (own repo, own backend, own database)

Written 2026-11-05/06. This is the ONE file to read before touching the server side of Sumon VA from any machine or any new AI session. It is a PLAN and a fact sheet: nothing in it has been executed yet except where marked DONE.
Labels: **VERIFIED** = read in code/docs or measured; **DESIGN** = a decision proposed here; **OPEN** = not yet known/decided.

## 0. Summary in Bangla (for the owner)

সুমন VA এখন ABO Enterprise-এর সার্ভার, ডাটাবেস ও মগজ ধার করে চলে। লক্ষ্য: সুমন VA হবে সম্পূর্ণ আলাদা: নিজের গিটহাব রিপো (`masumon/sumon_va`, তৈরি), নিজের Render সার্ভার (নতুন অ্যাকাউন্ট), নিজের Supabase ডাটাবেস (নতুন ফ্রি প্রজেক্ট), নিজের API ঠিকানা (`va-api.aboenterprise.com`), নিজের Telegram বট। ABO Enterprise (ওয়েবসাইট `www`, অ্যাডমিন `admin`, WhatsApp সহকারী `sumon.aboenterprise.com`) যেমন আছে তেমনই থাকবে, কিছু ভাঙবে না। সুমন VA ABO-র বুকিং/লিড/অর্ডার পড়বে ও উত্তর দিতে পারবে, কিন্তু ABO-র ডাটাবেসে সরাসরি ঢুকবে না: ABO-তে ছোট, সই-করা, শুধু-যোগ-করা কয়েকটা API থাকবে (ডিফল্টে বন্ধ)। মূল ABO অ্যাডমিনে একটা ছোট "সুমন VA" ট্যাব থাকবে ডিভাইস পেয়ার/সরানোর জন্য। নতুন যা যা লাগবে তার তালিকা §4-এ, ডাটাবেস §5-এ, ব্যাকএন্ড §6-এ, ধাপ §9-এ।

## 1. Rules for whoever works on this (owner's standing rules)

1. Owner is non-technical and reads Bangla. Chat replies: Bangla only, short, one step at a time, no stray foreign-language text. Files/code may be English.
2. Show the plan first and WAIT for the owner's explicit "start". Never run an irreversible or outward-facing action (force-push, deleting branches/data, merging, deploying, DNS changes) without a clear yes.
3. Nothing may harm the live ABO Enterprise website, the ABO admin, the WhatsApp assistant (sumon.aboenterprise.com) or their data. They share one Render service, one Supabase DB, Vercel, Cloudinary and the repo `masumon/abo-enterprise`: any merge there redeploys all of it.
4. Free tier only (Render free, Supabase free, Vercel, Cloudflare, Resend/SMTP, cron-job.org, GitHub). No paid service without asking.
5. Schema changes: manual SQL given in chat (paste-ready) and run by the owner in Supabase BEFORE the matching deploy. Render does not migrate.
6. Never put secrets (passwords, tokens, keystores, DB URLs, API keys) in chat, code, or git. Secrets live only in Render env vars / local untracked files.
7. Do NOT add `Co-Authored-By: Claude` (or any Claude/Anthropic attribution) to commits or PRs; the owner removed it from this repo's history. Commit author = the owner.
8. Builds: ask before building for the phone; `tools\build-apk.ps1 -Target phone -FreeMemory` (FINAL mode: screenshots blocked). Keep the previous APK as rollback.
9. Long pushes: the owner's upload is about 250 KB/s; one 25 MB push in a single request gets reset. Push in chunks of about 4 commits to a temporary branch, then move `main`; run in the background and report real progress.
10. Keep a log of what was verified vs inferred; do not guess.

## 2. The three subjects and their addresses

| Subject | Where | Domains |
|---|---|---|
| ABO Enterprise (website, shop, admin, website chatbot, Apon app downloads) | repo `masumon/abo-enterprise` (frontend on Vercel, backend on Render `abo-enterprise-api`, DB Supabase, images Cloudinary) | `www.aboenterprise.com`, admin `admin.aboenterprise.com`, API `api.aboenterprise.com` |
| WhatsApp assistant (admin product, Meta Cloud API, waiting for Meta App Review, a sub-product of ABO) | same repo and server as ABO | `sumon.aboenterprise.com` |
| **Sumon VA** (private Android app + its own server, this repo) | repo `masumon/sumon_va` (private, main branch holds the app, 64 commits, clean history) | API: `va-api.aboenterprise.com` (to be created) |

Owner decision: the three stay logically separate; the WhatsApp assistant stays with ABO; Sumon VA becomes fully independent (own git, DB, backend, Render). One git repo per subject; ABO stays ONE repo (do not split ABO).

## 3. Current state (before separation) — VERIFIED from code

### 3.1 Where the Sumon VA server lives today
In `abo-enterprise/backend/app` (FastAPI, SQLAlchemy 2 async + asyncpg, Python 3.11.9, 33 lines in requirements.txt). A static import analysis found the server code the phone needs: **53 modules, about 13,000 of 43,000 lines** (30%):
- Routes: `api/v1/routes/inbox.py` (device pair/login/otp/passkey/ingest/poll/ack/presence/logout, Telegram webhook, channels, kill switch, e-mail inbox, pair codes, devices), `wa_assistant.py` (contacts, messages, tasks, notes, config, report, health, simulate, learn/export, `/wa/cron`), `ai_hub.py` and `ai_catalog.py` (AI connections), `passkeys.py` (shared helpers), `core/device_auth.py`.
- Brain (shared with the ABO WhatsApp assistant today): `assistant/{wa_flow,wa_brain,wa_ai,wa_config,privacy,promises,presence,timectx,wa_health,wa_send,wa_coexist}.py`, `assistant/channels/{ingest,dispatch,alerts,telegram,phone_login,wake,email_filter,imap_mail,platforms}.py`, AI: `assistant/{ai_gemini,ai_hub,ai_providers,ai_catalog,link_import}.py`.
- Core: `core/{config,database,security,rbac,rate_limit,email*,notifications,ops_events,monitoring,service_health,totp_crypto,admin_security,capabilities,device_auth}.py`, models `models/models.py` (only a few classes), `models/wa.py`, `schemas/schemas.py`.
- Config scopes (`assistant/wa_config.py`): scope `web` = WhatsApp Cloud API conversations (ABO), scope `app` = everything else (Sumon VA: telegram, sms, notif, email, webhook), stored under settings key `va_app_config`.
- Passkey: the phone app has its OWN passkey bound to rp id `api.aboenterprise.com` (owner_type `admin_app` in table `passkeys`), `/.well-known/assetlinks.json` is served by FastAPI `main.py`. Android origins: release `android:apk-key-hash:VglfD6xy-PHcy-twYsPuAF6lG2mA9qK2ifNTpt-WOLo`, debug `android:apk-key-hash:sHl9FIQ4MIOr0wW0ZUvGBsv2QfVa_dBB9lk9GDJds5I`; release cert SHA-256 `56:09:5F:0F:AC:72:F8:F1:DC:CB:EB:70:62:C3:EE:00:5E:A5:1B:69:80:F6:A2:B6:89:F3:53:A6:DF:96:38:BA`, debug `B0:79:7D:14:84:38:30:83:AB:D3:05:B4:65:4B:C6:06:CB:F6:41:F5:5A:FD:D0:41:F6:59:3D:18:32:5D:B3:92`. Web passkeys use rp `aboenterprise.com`, whose apex redirects to www, which Android forbids, hence the separate rp.

### 3.2 What the app calls (server contract the new backend MUST serve)
The app talks ONLY through the native bridge `request()` with an allow-list of path prefixes `/admin/wa/`, `/admin/inbox/`, `/admin/ai-hub`, `/device/logout`; all under `https://<SERVER>/api/v1`. `SERVER` is the constant in `src/va/config.ts` (today `https://api.aboenterprise.com`). Endpoints used (see `src/va/api.ts` and `modules/va-bridge/android/.../VaBridgeModule.kt`, `PasskeyHelper.kt`):
- Device (no/device auth): `/device/pair`, `/device/login` (e-mail or saved phone + password + optional totp), `/device/otp/request|verify` (e-mail or saved phone; code goes to e-mail AND Telegram), `/device/login-telegram/request|status`, `/device/passkey/options|verify`, `/device/passkey/register/options|verify`, `/device/passkey/list`, `DELETE /device/passkey/{id}`, `/device/ingest`, `/device/poll?wait=25` (long poll, 25 s), `/device/ack`, `/device/presence`, `/device/logout`.
- Admin-style (owner or device token via `owner_or_device`): `/admin/wa/overview|contacts|contacts/{id}|reply|suggest|sent-by-hand|notes|tasks|config|report|health|simulate|messages/{id}/approve|discard|contacts/{id}/learn|export`, `/admin/inbox/channels|kill-switch|business|login-phone|email-filter|contacts/{id}/clear|pair-code|devices/{id}`, `/admin/ai-hub` (+`connections`, `test`, `prefs`, `test-all`, `try`).
- The app polls overview every 8-30 s (cached 8 s in the app) and long-polls `/device/poll`.

### 3.3 Hard couplings from Sumon VA to ABO DATA (must be solved when the DB is separate)
1. `inbox.py:/admin/inbox/business` counts ABO tables `orders`, `bookings_v2`, `leads_v2`, `career_applications` (Home screen "ব্যবসায়িক" numbers).
2. `assistant/wa_flow.py` looks up `Order`, `Booking`, `Lead` for a contact and creates `Lead` rows with source "whatsapp" (that is the WhatsApp assistant's business behaviour; it must NOT be copied into the Sumon VA server as direct DB access).
3. `core/notifications` writes ABO `notifications`/`system_events`; `Setting` (`settings` table) stores config; `AdminUser` and `Passkey` tables hold the owner and passkeys.
4. `assistant/__init__.py` imports the website chatbot orchestrator (import-time coupling): drop it in the copy.

### 3.4 Infrastructure facts (VERIFIED)
- Render free web service: 750 free instance hours PER WORKSPACE per month; spins down after 15 min without traffic; ~1 min to wake. The phone long-polls 24/7, so the Sumon VA service would use ~720-744 h/month by itself: it MUST live in a separate Render workspace/account or it will exhaust ABO's hours and everything in that workspace is suspended at month end. (source: render.com/docs/free)
- Supabase free: 2 free projects per account (paused ones do not count), 500 MB DB, 5 GB egress, projects may be paused after 7 days of low activity (the phone keeps it active), no downloadable backups on free. (sources: supabase.com/docs billing + going-into-prod)
- DB driver: asyncpg; `DATABASE_URL` is accepted as `postgresql://` or `postgres://` and rewritten to `postgresql+asyncpg://` (`core/config.py`); SSL `require` is added automatically for `supabase.co` / `pooler.supabase.com` (`core/database.py`). Pool: `pool_size=2, max_overflow=3, pool_timeout=30, pool_pre_ping=True, pool_recycle=300`. Supabase free session pooler allows only 15 clients in total (a deploy overlaps two instances): keep 2+3 per process.
- Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, health check `/health`, Python 3.11.9 (`backend/.python-version`), `STARTUP_BOOTSTRAP_ENABLED=false`, `APP_ENV=production`; `core/schema_guard.py` adds a few missing admin columns at start (safe, additive); admin user bootstrap from env.
- Periodic work: cron-job.org calls `GET /api/v1/wa/cron?token=<HMAC(SECRET_KEY,"wa-cron")[:32]>` every minute (delayed replies, morning summary, clean-up, stuck-message sweep, daily purge via `flow.run_cron`). The new server needs its own trigger (cron-job.org job or an in-process background loop; the server is always awake because of the phone's long poll).
- Backup: ABO has `.github/workflows/db-backup.yml` (daily pg_dump to a private Actions artifact, secret `BACKUP_DATABASE_URL`). Supabase free has no downloadable backups, so copy this workflow into `masumon/sumon_va` with its own secret.
- Existing manual SQL lineage for the Sumon VA tables: `0046_passkeys`, `0055_wa_assistant` (wa_* tables), `0058_unified_inbox` (inbox_devices, inbox_pair_codes, inbox_commands), `0059_message_category`, `0060_person_tags`, plus the base tables (`admin_users`, `settings`, ...). All run in ABO's DB; model columns match the SQL files (checked 2026-11-06).

## 4. Target architecture (DESIGN)

```
 ABO Enterprise (unchanged)                         Sumon VA (new, independent)
  repo masumon/abo-enterprise                        repo masumon/sumon_va  (app at root + server/)
  Render abo-enterprise-api (existing workspace)     Render sumon-va-api (NEW workspace/account)
  Supabase ABO project                               Supabase sumon-va project (NEW free project)
  www / admin / sumon.aboenterprise.com              va-api.aboenterprise.com
        |   small, additive, signed integration API       ^
        +------------ service token (HMAC) --------------+
  (Sumon VA never connects to ABO's database)
```
Sumon VA has no web front end of its own: the APK is the UI. Device pairing/revocation management appears as a small "সুমন VA" tab inside the ABO admin, implemented by the ABO backend calling the Sumon VA server with the service token (the browser never calls the Sumon VA API directly).

## 5. Everything that must be created (owner checklist, NEW resources)

Secrets are never pasted in chat; they go straight into Render env vars.

| # | Resource | Exact setup |
|---|---|---|
| 1 | **Supabase** new free project | name `sumon-va`; choose the region nearest to the Render region; run the schema SQL (§6) in its SQL editor; copy the **session pooler** connection string (host `*.pooler.supabase.com`, port 5432) into Render as `DATABASE_URL` (do not use the direct host: IPv6/limits) |
| 2 | **Render** new account/workspace | web service `sumon-va-api`, plan Free, runtime Python, root directory `server`, build `pip install -r requirements.txt`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, health check path `/health`, auto-deploy from `masumon/sumon_va` branch `main`, custom domain `va-api.aboenterprise.com` |
| 3 | **Cloudflare DNS** | CNAME `va-api` -> the Render hostname (set "DNS only" first; proxied only after the certificate is issued) |
| 4 | **GitHub** | repo exists. Add Actions secret `BACKUP_DATABASE_URL` and copy `db-backup.yml` |
| 5 | **Telegram** new bot (BotFather) | token -> `TELEGRAM_BOT_TOKEN`; owner chat id -> `TELEGRAM_OWNER_ID`; random `TELEGRAM_WEBHOOK_SECRET`; after deploy connect the webhook to `https://va-api.aboenterprise.com/api/v1/telegram/webhook` (a NEW bot, because the old bot's webhook is bound to ABO's server) |
| 6 | **E-mail** for sign-in codes | `RESEND_API_KEY` (new key, same Resend account) or `SMTP_*`; `EMAIL_PROVIDER`, `EMAIL_SENDER_NAME`, `SMTP_FROM`, `ADMIN_NOTIFY_EMAIL`, `BUSINESS_EMAIL`; optional IMAP mailbox `EMAIL_IMAP_HOST/USER/PASSWORD` (only ONE server may read the same mailbox: disable the ABO side at cutover) |
| 7 | **AI provider keys** | re-enter in the app's AI screen (old keys are encrypted with ABO's SECRET_KEY, not portable) |
| 8 | **cron-job.org** | one job every minute: `GET https://va-api.aboenterprise.com/api/v1/wa/cron?token=<token>` (token derived from the NEW `SECRET_KEY`), or implement an in-process loop |
| 9 | **Service token** | one long random secret `VA_INTEGRATION_TOKEN`, set in BOTH Render services (ABO side only when the integration is switched on) |
| 10 | **Core env (Render, Sumon VA)** | `APP_ENV=production`, `STARTUP_BOOTSTRAP_ENABLED=false`, `DATABASE_URL`, `SECRET_KEY` (generate), `JWT_ALGORITHM=HS256`, `ACCESS_TOKEN_EXPIRE_MINUTES=1440`, `FRONTEND_URL=https://va-api.aboenterprise.com`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` (bootstrap of the single owner account), `DEVICE_PASSKEY_RP_ID=va-api.aboenterprise.com`, `DEVICE_PASSKEY_ANDROID_ORIGINS` (release + debug origins above), `TELEGRAM_*`, e-mail vars, `ABO_API_BASE=https://api.aboenterprise.com`, `ABO_INTEGRATION_TOKEN`; `SUPABASE_URL/ANON/SERVICE_ROLE` only if the code path still needs them (check) |

## 6. Database plan

### 6.1 Tables for the new Supabase (about 14), from ABO models
`admin_users` (one owner), `passkeys`, `settings`, `activity_logs`, `notifications`, `system_events`, `email_templates` (for sign-in mails; may be dropped if the code path is trimmed), `wa_contacts`, `wa_messages`, `wa_notes`, `wa_tasks`, `inbox_devices`, `inbox_pair_codes`, `inbox_commands`. NOT needed (stay in ABO): orders, bookings*, leads*, customers, products, services, blog, payments, couriers, CMS, assistant_* chatbot tables, app_releases, push, etc.
Column definitions: take them from `backend/app/models/wa.py`, `models/models.py` (classes AdminUser, Passkey, Setting, ActivityLog, Notification, SystemEvent, EmailTemplate) and the SQL files `0046`, `0055`, `0058`, `0059`, `0060` of `abo-enterprise/backend/manual_sql`. Generate ONE idempotent file `server/manual_sql/0001_sumon_va_schema.sql` (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), including the indexes `ix_wa_messages_contact_created`, `ix_wa_messages_status_send_after`, `ix_wa_messages_channel_created`, `ix_wa_contacts_{state,last_message_at,channel,category}`, `ix_inbox_commands_pending`, unique `wa_messages.wa_id`, unique `passkeys.credential_id`. No alembic (Render does not run it).
Sizes that matter: sender 60, name 120, body 4000, ext_id 80, wa_id 120 characters; `owner_type` is String(20), status/category String(10).

### 6.2 Security of the new DB
Enable Row Level Security on every table with NO policies (the API connects with the database role, so the Supabase REST/anon key can read nothing). Read-only check the owner can run: `select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1;` (all `true`). (Audit finding D-07: the same check is still pending for ABO's DB.)

### 6.3 Moving the existing Sumon VA data (copy, never delete)
Read-only export from ABO's DB, import to the new DB, run on the owner's PC with both connection strings as environment variables (never pasted anywhere):
- `wa_contacts` where `channel <> 'whatsapp'` (and their `wa_messages`, `wa_notes`, `wa_tasks`), `inbox_devices`, `inbox_pair_codes` (unused/expired can be skipped), `inbox_commands` (skip pending), settings rows `va_app_config`, `owner_login_phone`, `owner_login_phone_admin`, `inbox_alerts`, `inbox_*` keys, the owner row of `admin_users` (or re-create by bootstrap env), `passkeys` NOT copied (create a new passkey on the new host).
- Idempotent by primary key / `wa_id` / `ext_id`; final delta copy at cutover; ABO rows are never modified.
- Encrypted private text (`enc1:` sealed with ABO's key via `privacy.py`): check which key seals it; if it depends on ABO's `SECRET_KEY`, the new server must be given the SAME key material or the sealed texts re-encrypted in the copy step (OPEN: verify `privacy.seal/unseal` before copying).
- Device tokens are stored hashed (`inbox_devices.token_hash`). Copying the rows keeps old tokens valid on the new server, BUT the app stores its server address in encrypted prefs at sign-in (`base`), so an updated app keeps calling the old server until it signs in again or the native code migrates `base` (see §8).

## 7. Backend plan (`server/` folder in this repo) (DESIGN)

7.1 Layout: keep the Expo app files at the repo root untouched; add `server/` (FastAPI app) with its own `requirements.txt`, `.python-version` (3.11.9), `manual_sql/`, `tests/`, `README`. Render `rootDir: server`.
7.2 Copy (fork) from ABO the 53 modules listed in §3.1, then cut:
- remove the import of the chatbot orchestrator in `assistant/__init__.py`;
- remove every other router from `main.py` (shop, payments, couriers, ...); mount only inbox, wa_assistant (needed endpoints), ai_hub/ai_catalog, passkeys (device part), health;
- replace the direct Order/Booking/Lead queries (business counts, WhatsApp-business lookups) by the ABO integration client (§8); drop the lead-creating behaviour from the copied brain unless explicitly wanted via the integration API;
- trim `models/models.py` and `schemas/schemas.py` to the classes actually used; drop unused `core` modules (bkash, nagad, couriers, backup engine, ga4, ...);
- keep: rate limits, audit log, kill switch, quiet hours/daily alert caps, family-never-auto-reply rules.
7.3 Auth: single owner. Sign-in methods stay exactly as the app has them: Telegram bot approval (no password), pairing code, e-mail 6-digit code, e-mail + password (+TOTP), saved phone number (code by e-mail and Telegram), app passkey. Pair-code creation today happens in the ABO admin web: keep `/admin/inbox/pair-code` on the Sumon VA server and expose it through the ABO admin tab (§8.3) or a first-run endpoint protected by the service token.
7.4 Periodic jobs: copy `/wa/cron` and add an in-process fallback loop; one trigger per minute is enough.
7.5 Tests: copy `test_unified_inbox`, `test_device_passkey`, `test_va_release_server`, `test_promises`, `test_passkeys`, `test_sumon_va_audit`, plus the `wa_*` tests that cover the copied brain; adapt fixtures; all green before any deploy. Add tests for the integration client with a fake ABO.
7.6 Fix, in the copy, the open audit findings that apply (they are listed in `docs/` of the audit folder; key ones): B-01 urgent alert swallowed (P1), B-02 family never auto-reply as a hard rule, B-04 one "spam" word flips a friend, B-12 late approval marked failed, P-01 restart loses in-flight messages, D-02 DB error at commit returns 200, B-07 links in AI answers, H-02 device token adding an AI base_url, B-14 OTP/bank SMS echoed to Telegram/AI. Because the copy is independent, no scope gating is needed there (gating is only for changes inside ABO).

## 8. ABO <-> Sumon VA integration (DESIGN: additive, off by default)

8.1 ABO side: ONE new route file (e.g. `integrations_va.py`), all routes return 404 unless `VA_INTEGRATION_TOKEN` is set; auth by `Authorization: Bearer <token>` plus timestamp+HMAC to stop replay; rate-limited; every call audited. Read endpoints: `GET /integrations/va/summary` (pending orders, pending bookings, new leads, new applications), `GET /integrations/va/feed?since=<cursor>&limit=` (new leads, bookings, orders, contact-form/chatbot messages, small field set), `GET .../leads|bookings|orders?status=` (short lists). Narrow write endpoints only: add a note, change status within a safe allow-list, send a reply e-mail to a lead through ABO's own e-mail system. NEVER: delete, payments, prices, users, settings.
8.2 Sumon VA side: `abo_client.py` + a poller (every minute: pull feed since cursor, create contacts/messages on a channel named `site`), cursor stored in `settings`; business numbers for Home come from `summary`; replies go through the write endpoints after the owner's approval (same approval rules as other channels). Pull, not push: nothing is hooked into ABO's existing flows.
8.3 ABO admin tab: a small page `/sumon/va` (frontend only, additive) calling the ABO backend, which calls the Sumon VA server (`/integration/*` guarded by the same token) to list devices, create a pair code, revoke a device, show last-seen and the kill switch.
8.4 The existing ABO admin pages that show the Sumon VA inbox (`components/admin/whatsapp/WaChannels`, `TrustedDevices`) keep working on the old data until the owner decides otherwise.

## 9. App changes (this repo, root)
- `src/va/config.ts`: `SERVER` -> `https://va-api.aboenterprise.com`.
- Stored base URL: `Store.setPaired(base, token)` keeps the server address in encrypted prefs, so after switching either sign in again (Telegram/e-mail code; the phone does it in a minute) or add a one-time native migration of `base` for tokens copied to the new server.
- Passkey: relying-party id comes from the server options; create a new passkey on the new host; `assetlinks.json` must be served by the new server (it is, in the copied `main.py`) and the release/debug fingerprints must be in it.
- `app_version` is read natively (versionName); bump versionCode for each build.
- Release signing key: `android/app/sumon-va-release.keystore` + `android/keystore.properties` are git-ignored and exist ONLY on the owner's PC: **back them up off-PC; losing them means the app can never be updated.**
- Build: `powershell -ExecutionPolicy Bypass -File tools\build-apk.ps1 -Target phone -FreeMemory` (needs ~4 GB free memory; `-Qa` is for test builds only). Install with `adb -s <id> install -r dist\sumon-va-arm64.apk`; phone adb id `10EDAX04RL0002X`. Rollback APKs live in `dist\` (not in git).

## 10. Phases with acceptance checks and rollback (each needs the owner's "go")

| Phase | Work | Effect on ABO | Done when | Rollback |
|---|---|---|---|---|
| P0 | Owner creates the §5 resources | none | accounts/projects exist | n/a |
| P1 | Create `server/` in this repo (copy + trim + tests) | none | tests green offline | delete folder |
| P2 | Schema SQL on the new Supabase; deploy to the new Render; domain + assetlinks; sign in with the Audit emulator/test device only | none | `/health` ok, sign-in + ingest + poll work on a test device | delete service |
| P3 | ABO: additive integration routes + tests (off by default); merge with the owner's OK; set token to enable | new inactive routes | routes 404 when token unset; 200 + correct data when set | unset env var / revert PR |
| P4 | Sumon VA: site feed, business numbers, reply actions | read first | numbers match ABO admin | disable poller |
| P5 | Copy existing data (read-only export) | read only | counts match | drop copied rows in the NEW db |
| P6 | ABO admin "সুমন VA" tab | additive page | devices list/pair/revoke work | revert PR |
| P7 | Cutover: new APK with the new `SERVER`, new Telegram bot, phone signs in again; run both for several days | none | messages flow end to end; alerts ring; passkey works | reinstall the previous APK (points to the old server, data untouched) |
| P8 | (Optional, last, separate permission) remove Sumon VA-only code/routes from ABO | **risky: ABO tests must pass; separate PR** | ABO full test suite green | revert PR |

## 11. Risks and decisions
- Render hours: separate workspace is mandatory (see §3.4). Supabase free has no backups: GitHub Actions dump is mandatory. Supabase pauses after 7 idle days (the phone keeps it alive).
- Two copies of the brain will drift (WhatsApp assistant in ABO, Sumon VA here): accepted by the owner for full independence. Record the ABO commit the fork started from in `server/README`.
- Telegram: one bot token cannot have two webhooks: use a new bot.
- Sealed private text key (see §6.3) is OPEN until `privacy.py` is checked.
- ABO's own pending items (WhatsApp Cloud API after Meta App Review, merged Meta review readiness) are NOT part of this repo.

## 12. OPEN questions (not yet verified)
- Exact columns the integration feed needs from `leads_v2`, `bookings_v2`, `orders`, `career_applications` and the chatbot conversation tables; which ABO e-mail function sends a reply to a lead.
- How `privacy.py` derives its sealing key (decides whether sealed text can be copied as-is).
- Whether the new Render region/Supabase region should match (latency) and which region ABO uses.
- Owner's Render plan/limits on the new account (not visible from here).
- How the website's contact messages (chatbot/forms) reach the WhatsApp/ABO inbox today.

## 13. Pointers
- Audit reports (local to the owner's PC, folder `_private\sumon-va-audit-2026-11-06\`): MASTER_RELEASE_AUDIT, SYSTEM_MAP, AUDIT_SURGICAL, UIUX_AUDIT, SERVER_BRAIN_SCHEMA_API_AUDIT (56 findings), CAPTURE_COVERAGE_AUDIT, PROJECT_SEPARATION_MAP. Owner memory notes (Claude Code): `C:\Users\masum\.claude\projects\d--abo-Enterprise\memory\` (start with `abo-sumon-va-todo-2026-11-06.md`).
- This repo's own handoff: `docs/HANDOFF.md`, `docs/PROJECT_CHARTER.md`, `CLAUDE.md`, `DESIGN.md`.
- Free-tier sources: render.com/docs/free; supabase.com/docs/guides/platform/billing-on-supabase; supabase.com/docs/guides/platform/going-into-prod.
