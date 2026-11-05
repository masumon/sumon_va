# ABO admin tab "সুমন VA": spec for the ABO agent

Owner decision (2026-11-06): the ONLY Sumon VA thing that stays in ABO is one small tab in the main admin (`admin.aboenterprise.com`). From it the owner can **pair a phone, list phones, and cancel a phone** (cancel = that phone stops at once), like before. It must now talk to the NEW Sumon VA server instead of ABO's own tables. Read `docs/ABO_CLEANUP_HANDOFF.md` too: everything else Sumon VA is removed from ABO.

## How it works
```
owner in ABO admin (browser, normal admin login)
   -> ABO backend  /api/v1/admin/va/...   (require_admin; the browser never sees the token)
      -> https://va-api.aboenterprise.com/api/v1/integration/...   (server to server, signed)
```

## The Sumon VA side (already built, in `masumon/sumon_va`, `server/app/api/v1/routes/integration.py`)
Base URL `https://va-api.aboenterprise.com/api/v1`. Off (404) until `VA_INTEGRATION_TOKEN` is set on that Render service.
| Call | Result |
|---|---|
| `GET  /integration/devices` | `{"data":{"devices":[{id,name,app_version,paired_at,last_seen_at,revoked}]}}` |
| `POST /integration/pair-code` | `{"data":{"code":"ABCD2345","minutes":10}}` (one use, 10 minutes) |
| `DELETE /integration/devices/{id}` | `{"data":{"ok":true}}` the phone is cut off at once |

Every request needs three headers: `Authorization: Bearer <VA_INTEGRATION_TOKEN>`, `X-VA-Timestamp: <unix seconds>`, `X-VA-Signature: <hex HMAC-SHA256 with the token as key over the text "<timestamp>.<METHOD>.<path>">` where `<path>` is the full URL path as the server sees it, e.g. `/api/v1/integration/devices`. A request older than 5 minutes or with a wrong signature gets 403.

## What to build in ABO (additive, off by default)
1. **Backend** `backend/app/api/v1/routes/va_admin.py`, router prefix `/admin/va`, every route `Depends(require_admin)` (owner role), rate limited, one activity-log entry per action (pair-code, revoke). Routes: `GET /admin/va/devices`, `POST /admin/va/pair-code`, `DELETE /admin/va/devices/{id}`. Each calls the Sumon VA call above with `httpx` (timeout 10 s) and returns the same JSON. Env on ABO's Render: `VA_API_BASE=https://va-api.aboenterprise.com`, `VA_INTEGRATION_TOKEN` (the SAME value as on the Sumon VA service; the owner sets both by hand, never in chat). If either is missing, return 404.
2. **Frontend** one tab "সুমন VA" in the admin: a list of phones (name, version, last seen, paired, status), a button "নতুন কোড" showing the code big for 10 minutes, a "বাতিল" button per phone with a confirm dialog. Bangla UI, same look as the other admin tabs. Reuse the old `TrustedDevices.tsx` layout if it fits, pointed at the new routes.
3. **Tests**: signature helper (same formula as above), 404 when env missing, a fake Sumon VA server answering the three calls, no real network.
4. Remove the old `/admin/inbox/*` based pieces as the cleanup handoff says, so the tab never talks to ABO's own `inbox_*` tables.
5. Separate branch, run the whole backend test suite and the frontend build, the owner merges. Do not change anything else in ABO.

## Setup the owner does after both sides are merged
- Make one long random value; put it as `VA_INTEGRATION_TOKEN` on BOTH Render services (ABO and `sumon-va-api`).
- Open the new tab, press "নতুন কোড", type the code into the phone app's pairing screen.
