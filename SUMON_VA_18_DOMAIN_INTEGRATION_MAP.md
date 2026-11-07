# SUMON VA — 18 Domain Integration Map (2026-11-07, v1.0)

There is **one** decision path. The architecture has no duplicate Brain, memory, task or decision engine (SOURCE). Every inbound event goes through `server/app/assistant/wa_flow.py::_process`, and the decision itself is `wa_brain.decide`. Memory is one store (`wa_contacts.profile.facts` + `wa_notes`), tasks are one table (`wa_tasks`), and the scheduler is one loop (`core/scheduler.py` → `wa_flow.run_cron`).

```mermaid
flowchart TD
  IN[/device/ingest · /telegram/webhook · /email/inbound/] -->|D8 dedupe, OTP mask, spam| MSG[(wa_messages)]
  MSG --> P[_process]
  P -->|D1 identity.auto_link + names| ID[person_ids]
  P -->|D7 call_context| CALL[call insight + burst]
  P -->|D10 thread_state + _group_gate| CONV[reply state, grouped text]
  P --> DEC[D17 wa_brain.decide]
  DEC -->|D18 current_status / presence| AV[availability]
  DEC -->|D14 rule_priority, tags, official| PRI[priority]
  DEC -->|D2 family/VIP/category, D6 never/official words| STOP[hard stops: no reply]
  DEC -->|D13 classify_kind, AI analyze (non-private only)| INT[intent]
  P -->|D4 assignments, D3/D6 obligations| TASK[(wa_tasks proposed)]
  P -->|D11 extract → memory.add (inferred)| MEM[(profile.facts)]
  DEC --> RESP[D16 draft / queued + guard_text + explain_mode]
  RESP --> DLV[deliver → phone command / Telegram / SMS] --> ACK[/device/ack status]
  P --> AL[alerts.push_owner: limits, held record]
  CRON[run_cron each minute] -->|sweep, task + unanswered reminders, held digest, purge| P
```

| Workflow | Modules in code order | Tables | Tested (SQLite) | Where it is incomplete |
|---|---|---|---|---|
| A Incoming message | ingest → `_process` → identity → thread_state/group gate → decide (priority, category, hard stops, AI) → assignments/obligations/extract → draft or queued → deliver → ack | wa_messages, wa_contacts, wa_tasks, inbox_commands | yes (`test_brain_rest`, `test_assignments`, `test_obligations`) | delivery proof only through the phone's ack; nothing seen on a device today |
| B Missed call | CallReceiver/call-log → ingest (`call` meta) → `_process` → call_context (person-wide history, hypotheses, burst) → alert | same | yes (`test_call_context`) | real cellular/WhatsApp calls untested |
| C Owner unavailable | `current_status`/presence → decide (status line in reply, quiet hours) → `explain_mode` (auto only with platform + person permission) → auto / draft / alert | settings, wa_messages | yes | the owner's real status and per-platform auto settings not checked |
| D Unanswered | thread_state → `send_unanswered_reminders` (cron) → alert; owner action = reply / sent-by-hand / dismissed hint | wa_messages, settings | yes | reminders OFF by default; phone `seen` signal never run on a device |
| E Important | decide priority p1/p2 (+ official) → alerts (limits, held record, digest) → action history (alerts list) | settings (`inbox_alerts_held`), activity_logs | yes | urgent alert did not ring once on the phone (open) |
| F New platform | platforms button (`custom_platforms`) → notification capture → identity → history import (`/import-history`, imported never processed) → dedupe | settings, wa_messages | yes (`test_platform_settings`, `test_brain_rest`) | each new app's notification format untested |

Findings: no circular decision engines. Identity resolution is consistent, because one `person_ids` set is used for calls, tasks and F0. The rule order (hard stops → rules → AI reads) is explained in `decide` and `explain_mode`. Response policy lives in one place (`explain_mode`). The one remaining duplicate is historical: the WhatsApp Cloud API (`wa_send`, `wa_coexist`, scope `web`) stays as unused code by owner decision.
