# ABO: read-only summary API for Sumon VA (instruction for the ABO agent)

Owner decision 2026-11-06: Sumon VA's Home shows ABO's four business numbers through an API. Build this in `masumon/abo-enterprise` only (Sumon VA never touches ABO's database). The Sumon VA side is already built and waiting (`server/app/core/abo_client.py` in `masumon/sumon_va`).

## Contract (must match exactly)
`GET /api/v1/integrations/va/summary` on `https://api.aboenterprise.com`

Headers sent by Sumon VA:
- `Authorization: Bearer <ABO_INTEGRATION_TOKEN>`
- `X-VA-Timestamp: <unix seconds>`
- `X-VA-Signature: <hex HMAC-SHA256, key = the token, message = "<timestamp>.GET./api/v1/integrations/va/summary">`

Reject with 403 when the token or signature is wrong or the timestamp is older than 5 minutes. Return **404 when `VA_INTEGRATION_TOKEN` is not set** on ABO (off by default).

Response 200:
```json
{"data": {"pending_orders": 0, "pending_bookings": 0, "new_leads": 0, "new_applications": 0}}
```
Meaning (use ABO's own status names; write the exact filters in the PR description):
- `pending_orders`: orders waiting for action (not delivered / cancelled).
- `pending_bookings`: bookings not yet confirmed/finished (`bookings_v2`).
- `new_leads`: leads not yet contacted (`leads_v2`).
- `new_applications`: career applications not yet reviewed (`career_applications`).

## Rules
1. One new route file, read-only, counts only (no names, phones, money, or rows). Rate limit (for example 60/min). One activity-log line per call is optional; never log the token.
2. Reuse the same token as the existing "সুমন VA" admin tab (`VA_INTEGRATION_TOKEN`); on the Sumon VA Render the same value is `ABO_INTEGRATION_TOKEN`, plus `ABO_API_BASE=https://api.aboenterprise.com`. The owner sets both by hand, never in chat.
3. Tests: signature ok / wrong / expired, 404 when the env var is missing, counts from fixture rows. Run ABO's full backend suite. Separate branch; the owner merges.
4. Do not change anything else in ABO (website, shop, admin, WhatsApp assistant).

## After merge (owner)
Set `ABO_API_BASE` and `ABO_INTEGRATION_TOKEN` on the Sumon VA Render, redeploy. Home then shows the four numbers; until then it shows "সংযুক্ত নয়" (never a fake zero).
