# ABO cleanup handoff: remove Sumon VA-only parts from `masumon/abo-enterprise`

For the AI agent that works on the ABO repo. Written 2026-11-06 from a static import analysis of `abo-enterprise` `main` (9b258a45) and the new Sumon VA server (repo `masumon/sumon_va`, folder `server/`).

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

## 2. What must STAY (shared with the WhatsApp assistant: do NOT remove)
Everything below is imported by `routes/wa_assistant.py` (the WhatsApp admin product) or by shared core:
- `assistant/{wa_flow, wa_brain, wa_ai, wa_config, wa_health, wa_send, wa_coexist, privacy, promises, presence, timectx}.py`
- `assistant/{ai_hub, ai_gemini, ai_providers, ai_catalog}.py` and routes `ai_hub.py`, `ai_catalog.py`
- `assistant/channels/{__init__, alerts, dispatch, ingest, phone_login, platforms, telegram, wake}.py`
- `core/device_auth.py` and the `InboxDevice`, `InboxCommand`, `InboxPairCode`, `WaContact`, `WaMessage`, `WaNote`, `WaTask` models (WhatsApp admin uses `owner_or_device`)
- `routes/wa_assistant.py` including `/wa/cron` (WhatsApp delayed replies; its cron-job.org job stays)
- the config scope `"app"` inside `wa_config.py` may be left alone (harmless; removing it risks the shared flow)
- `Setting`, `AdminUser`, `Passkey` tables and models (website admin)
- `assistant/__init__.py` importing the website chatbot orchestrator stays as is for ABO.
- All SQL files and every database table. Do not drop `inbox_*`; they contain history until the owner decides.

## 3. Render / Cloudflare / Telegram side (owner does these, agent only advises)
- Telegram bot `@SumonVA_bot`: its webhook already points to `va-api.aboenterprise.com` (set 2026-11-06). ABO's `TELEGRAM_*` env vars can be removed from ABO's Render after the cleanup is merged and verified; leaving them is harmless.
- Cloudflare Worker `abo-mail-to-inbox`: repointed to `https://va-api.aboenterprise.com/api/v1/email/inbound`. Leave it.
- ABO Render env `EMAIL_INBOUND_SECRET`, `DEVICE_PASSKEY_*`: remove only after the cleanup PR is deployed and green.
- cron-job.org: a job for `/api/v1/email/cron` (if one exists) must be deleted, otherwise it will start returning 404 on ABO. The `/wa/cron` job stays.

## 4. Order of work (each step needs the owner's go)
1. Read `docs/TRANSFER.md` in `masumon/sumon_va`; confirm cutover is done. Ask the owner if unsure.
2. New branch from `main`, e.g. `cleanup/remove-sumon-va-2026-11`.
3. Remove frontend pieces first (build must pass), then backend route + tests, then `sumon-va/` folder, then unused settings.
4. Run the whole backend test suite and `npm run build` in `frontend/`. Fix only what the removal broke.
5. Push the branch; show the owner a short Bangla summary (what was removed, tests result). The owner merges. Watch the Render deploy and `/health`, and check the WhatsApp admin page `/sumon/whatsapp` still loads.
6. Rollback: revert the merge commit.

## 5. Quick self-check before the PR
- `grep -rn "routes.inbox\|admin/inbox\|device/pair\|assetlinks" backend frontend` returns nothing except historical docs.
- `/api/v1/admin/wa/overview` and the WhatsApp admin page still work.
- The website, `/health`, admin login, one order flow in a test run are untouched.
