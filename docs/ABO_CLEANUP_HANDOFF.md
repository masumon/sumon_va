# ABO cleanup handoff: remove Sumon VA-only parts from `masumon/abo-enterprise`

For the AI agent that works on the ABO repo. Written 2026-11-06 from a static import analysis of `abo-enterprise` `main` (9b258a45) and the new Sumon VA server (repo `masumon/sumon_va`, folder `server/`).

## Goal (owner's words, 2026-11-06)
Sumon VA is now fully separate (own repo, own Render, own Supabase, own domain `va-api.aboenterprise.com`). **When this cleanup is finished, nothing that belongs to Sumon VA may remain in ABO**: no phone endpoints, no phone-app copy, no Sumon VA code paths, no Sumon VA data. ABO keeps only the website, shop, admin and the WhatsApp assistant (Meta Cloud API, channel `whatsapp`, config scope `web`). Do it in two tiers (section 1 = tier 1, section 2 = tier 2, section 3 = tier 3 data), always without breaking the WhatsApp assistant.

## 0. Hard rules (read first)
1. **Do nothing here until the owner says "cutover done".** Until then the owner's phone still talks to ABO's server for part of its data. Cutover is done only when: the phone app signs in to `https://va-api.aboenterprise.com`, messages flow there, the old data was copied (docs/TRANSFER.md C9) and several days passed without problems. Check `docs/TRANSFER.md` in `masumon/sumon_va` first.
2. **Never harm ABO**: website, shop, admin, the **WhatsApp assistant (`sumon.aboenterprise.com`)**, payments, couriers. Run the FULL backend test suite and the frontend build before every push. Work on a feature branch; the owner merges (a merge redeploys Render and Vercel).
3. **No SQL, no table drops.** `inbox_*` and `wa_*` tables are shared with the WhatsApp assistant and hold history. If a schema change ever seems needed, give manual SQL in chat first and wait.
4. No secrets in chat, code or git. No `Co-Authored-By: Claude` lines in commits.
5. Reply to the owner in short Bangla, one step at a time.

## 1. What is SAFE to remove (Sumon VA only)
Verified by import graph: these are imported by nothing outside the phone feature.

**Backend**
- `backend/app/api/v1/routes/inbox.py` (device pair/login/otp/passkey/ingest/poll/ack/presence/logout, Telegram webhook, `/email/inbound`, `/email/cron`, `/admin/inbox/*`) and its two lines in `routes/__init__`/`router.py` (`inbox,` in the import list and `api_router.include_router(inbox.router)`).
- `backend/app/assistant/channels/email_filter.py`, `backend/app/assistant/channels/imap_mail.py` (only inbox.py uses them).
- In `backend/app/main.py`: the `/.well-known/assetlinks.json` handler and its constants `_APP_PACKAGE`, `_APP_CERT_SHA256` (the new server serves it for `va-api.aboenterprise.com`; ABO's host `api.aboenterprise.com` no longer needs to be a passkey host for the app).
- Settings no longer used once inbox.py is gone: `DEVICE_PASSKEY_RP_ID`, `DEVICE_PASSKEY_ANDROID_ORIGINS`, `EMAIL_INBOUND_SECRET`, `EMAIL_IMAP_*` in `core/config.py` (remove only after a grep shows no other use).
- Tests that only test the removed code: `test_device_passkey.py`, `test_phone_login.py`, `test_phone_login_telegram.py`, `test_unified_inbox.py`, `test_va_release_server.py`, and the Sumon-VA parts of `test_email_voice_channels.py` (check each file with `grep`; keep any test that also covers shared code and only drop the inbox imports).

**Repo folder**
- `sumon-va/` (the copy of the phone app inside ABO, merged by PR #465/#467/#468). The app now lives in `masumon/sumon_va`. Remove the folder in one commit. Also check CI/Vercel/Render path filters that mention it.

**Frontend (ABO admin page `/sumon/whatsapp`)**
- `components/admin/TrustedDevices.tsx` and `components/admin/whatsapp/WaChannels.tsx` and the places that render them, plus the `/admin/inbox/*` helpers in `lib/waAssistant.ts` that only they use. These call the removed `/admin/inbox/*` routes: remove them TOGETHER with the backend route or the admin page breaks. Keep every other WhatsApp tab.
- Optional, later and only with the owner's wish: an ABO admin tab "সুমন VA" is planned in the other repo's TRANSFER.md (C7a); do not build it here unless asked.

## 2. TIER 2: Sumon VA code that sits inside files the WhatsApp assistant also imports
An import-graph check shows these modules are imported by `routes/wa_assistant.py`, but "imported" is not "used by WhatsApp": most of the logic in them serves the phone (channels `telegram`, `sms`, `notif`, `email`, `webhook`; config scope `app`; phone commands; presence). Goal: remove the Sumon VA parts while the WhatsApp path (channel `whatsapp`, scope `web`) keeps working.
Method (agent must do this carefully, in small commits, tests green after each):
1. For each module below, find which functions the WhatsApp path really calls (`grep` callers from `wa_assistant.py`, `wa_flow.process_inbound` when `contact.channel == "whatsapp"`, the Meta webhook `/wa/webhook`, `/wa/cron`). Write the list into the PR description.
2. Delete the functions, branches and imports that only the phone path uses (`channel != "whatsapp"`, `scope == "app"`, `owner_or_device` device branch, dispatch to `InboxCommand`, alerts, wake/long-poll, phone presence, phone-number login, Telegram bot, platforms/custom_platforms for chat apps, `sealed` private text for non-WhatsApp people only if unused by WhatsApp).
3. Candidates (verify each, do not trust this list blindly): `assistant/channels/{alerts, dispatch, ingest, phone_login, platforms, telegram, wake}.py`, `assistant/presence.py`, `assistant/promises.py` (only if WhatsApp does not use tasks), `assistant/timectx.py` (check), `core/device_auth.py` (after `owner_or_device` loses its device branch), the `app` scope in `assistant/wa_config.py` and the `app` defaults, the phone parts of `wa_flow.py`, `wa_brain.py`, `wa_health.py`, and the phone-only endpoints in `routes/wa_assistant.py` (`/admin/wa/*` paths used only by the app; the ABO admin page `/sumon/whatsapp` must keep every call it needs).
4. Models `InboxDevice`, `InboxCommand`, `InboxPairCode` and the columns used only by the phone may be removed from `models/wa.py` only when nothing imports them; the TABLES stay until tier 3.
5. Frontend: remove every screen/tab/button in the ABO admin that manages Sumon VA (devices, pairing, channels other than WhatsApp, phone alerts, phone settings). Keep the WhatsApp tabs.

## 2b. What must STAY (really WhatsApp/ABO, do NOT remove)
Used by the WhatsApp assistant or the website:
- the WhatsApp parts of `assistant/{wa_flow, wa_brain, wa_ai, wa_config, wa_health, wa_send, wa_coexist, privacy}.py`
- `assistant/{ai_hub, ai_gemini, ai_providers, ai_catalog}.py` and routes `ai_hub.py`, `ai_catalog.py`
- the `WaContact`, `WaMessage`, `WaNote`, `WaTask` models and tables (WhatsApp data)
- `routes/wa_assistant.py` including `/wa/cron` (WhatsApp delayed replies; its cron-job.org job stays)
- `Setting`, `AdminUser`, `Passkey` tables and models (website admin)
- `assistant/__init__.py` importing the website chatbot orchestrator stays as is for ABO.
- All SQL files and every database table, until tier 3.

## 3. TIER 3: Sumon VA data inside ABO's database (last; owner decides; MANUAL SQL in chat first)
Only after: the phone runs on the new server, the data copy (TRANSFER.md C9) was verified there, and the owner has a fresh backup of ABO's database (GitHub Actions dump). Then, one SQL at a time, shown in chat and run by the owner in Supabase:
- `wa_contacts` rows with `channel <> 'whatsapp'`, and their `wa_messages`, `wa_notes`, `wa_tasks` (cascade by foreign key; check before running).
- tables `inbox_devices`, `inbox_pair_codes`, `inbox_commands` (drop only when no code references them).
- `passkeys` rows with `owner_type = 'admin_app'`.
- `settings` rows `va_app_config`, `owner_login_phone`, `owner_login_phone_admin`, `inbox_alerts`, other `inbox_*` keys.
- Never touch `channel = 'whatsapp'` rows or website tables. Give a `SELECT count(*)` version of each statement first so the owner sees what would go.

## 4. Render / Cloudflare / Telegram side (owner does these, agent only advises)
- Telegram bot `@SumonVA_bot`: its webhook already points to `va-api.aboenterprise.com` (set 2026-11-06). ABO's `TELEGRAM_*` env vars can be removed from ABO's Render after the cleanup is merged and verified; leaving them is harmless.
- Cloudflare Worker `abo-mail-to-inbox`: repointed to `https://va-api.aboenterprise.com/api/v1/email/inbound`. Leave it.
- ABO Render env `EMAIL_INBOUND_SECRET`, `DEVICE_PASSKEY_*`: remove only after the cleanup PR is deployed and green.
- cron-job.org: a job for `/api/v1/email/cron` (if one exists) must be deleted, otherwise it will start returning 404 on ABO. The `/wa/cron` job stays.

## 5. Order of work (each step needs the owner's go)
1. Read `docs/TRANSFER.md` in `masumon/sumon_va`; confirm cutover is done. Ask the owner if unsure.
2. New branch from `main`, e.g. `cleanup/remove-sumon-va-2026-11`.
3. Tier 1: frontend pieces first (build must pass), then backend route + tests, then `sumon-va/` folder, then unused settings. Tier 2: separate PR(s) after tier 1 is live and green. Tier 3: only with manual SQL as above.
4. Run the whole backend test suite and `npm run build` in `frontend/`. Fix only what the removal broke.
5. Push the branch; show the owner a short Bangla summary (what was removed, tests result). The owner merges. Watch the Render deploy and `/health`, and check the WhatsApp admin page `/sumon/whatsapp` still loads.
6. Rollback: revert the merge commit.

## 6. Quick self-check before each PR
- `grep -rniE "routes.inbox|admin/inbox|device/pair|assetlinks|sumon-va|sumonva|InboxDevice|InboxCommand|telegram" backend frontend` returns nothing except historical docs (after tier 2).
- `/api/v1/admin/wa/overview` and the WhatsApp admin page still work.
- The website, `/health`, admin login, one order flow in a test run are untouched.
