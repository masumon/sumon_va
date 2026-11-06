# Brain traceability (living file; directive: `Brain_Prompt.md` v2.0 §22-23)

Status words: VERIFIED = code + test run by an agent (date). NV = code exists, not run/proven. PARTIAL. MISSING. BLOCKED-PLATFORM / -PERMISSION. Baseline 2026-11-06: `cd server; pytest` = 275 passed before Phase 1, 294 after Phase 1, 313 after Phase 2, 327 after Phase 3a, 340 after Phase 4.

| ID | Requirement | Existing component (evidence) | Status | Tests | Next |
|---|---|---|---|---|---|
| R-CALL-1 | Missed call: context, hypotheses with confidence, one alert per burst | `assistant/call_context.py`, `wa_flow._process`, `wa_config.calls` | VERIFIED by unit tests (pure logic); NOT verified end to end (no DB/phone run) | `tests/test_call_context.py` (19) | emulator/phone check after the owner enables the assistant |
| R-CALL-2 | Call capture on the phone | `Receivers.kt` `CallReceiver`, `/device/ingest` | NV | none | phone check |
| R-REPLY | Owner reply verification | `thread_state.assess`, `reason="owner"`, `sent-by-hand`, `hold_hours`; send guards in `deliver`/`dispatch.deliver_other` | VERIFIED by unit + SQLite tests (classification, reminder); NOT wired to block sends beyond the existing guards | `tests/test_thread_state.py` | F0 preview (Phase 5) |
| R-GROUP | 5-7 min grouping | `wa_flow._group_gate`, `thread_state.grouped_text`, config `grouping` (default 5) | VERIFIED by SQLite gate tests; `_process` end-to-end NOT run | `tests/test_thread_state.py` | phone/Render check |
| R-READ | Read/unanswered reminder | `wa_flow.send_unanswered_reminders` ("no answer found", default off); phone-side notification-removed signal NOT coded | PARTIAL: server part verified by tests | `tests/test_thread_state.py` | phone signal (needs build) |
| R-TASK | Incoming tasks, status, evidence | `assignments.py`, `promises.py`, `wa_flow._process`, route `/admin/wa/tasks/{id}/confirm`; `wa_tasks.source` (manual/ai/proposed/confirmed) | PARTIAL: detection, proposed->confirmed, honest status VERIFIED by unit + SQLite `_process` tests; app confirm button, progress/blocker/assigner columns, task follow-up reminders MISSING | `tests/test_assignments.py` (14) | Phase 3b: SQL (owner runs, backup first) + app button |
| R-ID | One person, many identifiers | `identity.py`, `wa_flow._process` (auto_link, person-wide call context), routes `/admin/wa/identity/*`, `manual_sql/0002_contact_person_link.sql` (+ROLLBACK) | PARTIAL: rules + DB path VERIFIED on SQLite incl. a DB WITHOUT the column; real Supabase NOT run (owner runs SQL); app UI for suggestions/link MISSING | `tests/test_identity.py` (13) | owner runs 0002; app screen (needs build) |
| R-MEM | Fact provenance/correction | `profile`, `wa_notes` | PARTIAL | - | Phase 4 |
| R-F0 | Command center | `ai.tsx`, assistant menu (name F0 not in code) | PARTIAL | - | Phase 5 |
| R-RULES | Precedence + decision trace | `effective_mode`, `Decision.note` | PARTIAL | `test_unified_inbox.py` | Phase 7 |
| R-HIST | Resumable import, no auto-reply | `wa_coexist.py`, `link_import.py` | NV | `test_link_import.py` | Phase 6 |
| R-SMSHIST | SMS history | `READ_SMS` not declared | BLOCKED-PERMISSION (owner approval) | - | owner decision |
| R-OWNHAND | Detect owner's typed in-app replies | not exposed by Android | BLOCKED-PLATFORM; alternative `sent-by-hand` | - | - |
| R-BACKUP | DB backup | none (owner deferred) | MISSING | - | owner decision before SQL |

18-domain status: see the chat report of 2026-11-06 (Identity..Availability); only Phase 1 touched Phone/Priority/Intent so far.
