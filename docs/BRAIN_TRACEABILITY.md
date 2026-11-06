# Brain traceability (living file; directive: `Brain_Prompt.md` v2.0 §22-23)

Status words: VERIFIED = code + test run by an agent (date). NV = code exists, not run/proven. PARTIAL. MISSING. BLOCKED-PLATFORM / -PERMISSION. Baseline 2026-11-06: `cd server; pytest` = 275 passed before Phase 1, 294 after Phase 1, 313 after Phase 2, 327 after Phase 3a, 340 after Phase 4, 362 after the remaining code phases, 367 after the final audit (live since 2026-11-06).

| ID | Requirement | Existing component (evidence) | Status | Tests | Next |
|---|---|---|---|---|---|
| R-CALL-1 | Missed call: context, hypotheses with confidence, one alert per burst | `assistant/call_context.py`, `wa_flow._process`, `wa_config.calls` | VERIFIED by unit tests (pure logic); NOT verified end to end (no DB/phone run) | `tests/test_call_context.py` (19) | emulator/phone check after the owner enables the assistant |
| R-CALL-2 | Call capture on the phone | `Receivers.kt` `CallReceiver`, `/device/ingest` | NV | none | phone check |
| R-REPLY | Owner reply verification | `thread_state.assess`, `reason="owner"`, `sent-by-hand`, `hold_hours`; send guards in `deliver`/`dispatch.deliver_other` | VERIFIED by unit + SQLite tests (classification, reminder); NOT wired to block sends beyond the existing guards | `tests/test_thread_state.py` | F0 preview (Phase 5) |
| R-GROUP | 5-7 min grouping | `wa_flow._group_gate`, `thread_state.grouped_text`, config `grouping` (default 5) | VERIFIED by SQLite gate tests; `_process` end-to-end NOT run | `tests/test_thread_state.py` | phone/Render check |
| R-READ | Read/unanswered reminder | `wa_flow.send_unanswered_reminders` ("no answer found", default off); phone-side notification-removed signal NOT coded | PARTIAL: server part verified by tests | `tests/test_thread_state.py` | phone signal (needs build) |
| R-TASK | Incoming tasks, status, evidence | `assignments.py`, `promises.py`, `wa_flow._process`, route `/admin/wa/tasks/{id}/confirm`; `wa_tasks.source` (manual/ai/proposed/confirmed) | PARTIAL: detection, proposed->confirmed, honest status VERIFIED by unit + SQLite `_process` tests; app confirm button, progress/blocker/assigner columns, task follow-up reminders MISSING | `tests/test_assignments.py` (14) | Phase 3b: SQL (owner runs, backup first) + app button |
| R-ID | One person, many identifiers | `identity.py`, `wa_flow._process` (auto_link, person-wide call context), routes `/admin/wa/identity/*`, `manual_sql/0002_contact_person_link.sql` (+ROLLBACK) | PARTIAL: rules + DB path VERIFIED on SQLite incl. a DB WITHOUT the column; SQL 0002 run by the owner 2026-11-06 and verified; behaviour with real data NOT tested; app UI for suggestions/link MISSING | `tests/test_identity.py` (13) | owner runs 0002; app screen (needs build) |
| R-MEM | Fact provenance/correction | `profile`, `wa_notes` | PARTIAL | - | Phase 4 |
| R-F0 | Command center | `ai.tsx`, assistant menu (name F0 not in code) | PARTIAL | - | Phase 5 |
| R-RULES | Precedence + decision trace | `effective_mode`, `Decision.note` | PARTIAL | `test_unified_inbox.py` | Phase 7 |
| R-HIST | Resumable import, no auto-reply | `wa_coexist.py`, `link_import.py` | NV | `test_link_import.py` | Phase 6 |
| R-SMSHIST | SMS history | `READ_SMS` not declared | BLOCKED-PERMISSION (owner approval) | - | owner decision |
| R-OWNHAND | Detect owner's typed in-app replies | not exposed by Android | BLOCKED-PLATFORM; alternative `sent-by-hand` | - | - |
| R-BACKUP | DB backup | none (owner deferred) | MISSING | - | owner decision before SQL |

18-domain status: see the chat report of 2026-11-06 (Identity..Availability); only Phase 1 touched Phone/Priority/Intent so far.

## Update after the code phases (2026-11-06)
| ID | Requirement | Component | Status | Tests |
|---|---|---|---|---|
| R-MEM | Fact provenance, confidence, correction, removal | `memory.py`, routes `/admin/wa/contacts/{id}/facts*` (in `profile.facts`, no SQL) | VERIFIED by unit + SQLite tests (private facts sealed; `learn` no longer wipes facts); app card NOT seen on a device | `test_brain_rest.py` |
| R-REL | Relationship signs | `relationship.py`, route `/admin/wa/contacts/{id}/relationship` | VERIFIED by unit tests (hypotheses only, no score); thresholds are heuristics, unproven on real data | `test_brain_rest.py` |
| R-F0 | Command centre | `f0.py`, `POST /admin/wa/f0/command`, `routes/f0.tsx`, menu entry | Server VERIFIED (SQLite); app screen type-checked only. Name "F0" exists nowhere in code or docs: owner DECIDED 2026-11-06: `/f0` is the Sitting Room / F0 command centre; coverage of directive section 12: see BRAIN_ROLLOUT_PLAN section 5 | `test_brain_rest.py` |
| R-HIST | Dated, resumable, duplicate-free import; imported never answered | `history_import.py`, route `/import-history`, `_process` guard | VERIFIED by SQLite tests; real export files of other app versions/locales NOT tested | `test_brain_rest.py` |
| R-READ | Dismissed-notification hint | Kotlin `onNotificationRemoved`, ingest `type=seen`, `mark_dismissed` | Server VERIFIED; Kotlin module compiled 2026-11-06 (`compileDebugKotlin`, symbols and `item()` signature checked), NOT run on a device; always labelled "not proof of reading" | `test_brain_rest.py` |
| R-TASK2 | Progress/blocker/evidence, due reminders | `task_details.py` (SQL 0003), `send_task_reminders`, route `/progress` | VERIFIED before and after the columns exist (SQLite); SQL 0003 run by the owner 2026-11-06 and verified; behaviour with real data NOT tested | `test_brain_rest.py` |
| R-RULES | Decision trace | `explain_mode`, `meta.rule` on drafts | VERIFIED (existing mode tests unchanged and passing); full precedence rewrite NOT done (documented order only) | `test_unified_inbox.py`, `test_brain_rest.py` |

## Live evidence (2026-11-06) and what is still unproven
Deployed on Render; `/health` 200, `/health/db` connected; `POST /admin/wa/f0/command`, `GET /admin/wa/identity/suggestions`, `POST /admin/wa/tasks/{id}/progress`, `POST /admin/wa/contacts/{id}/import-history`, `GET /admin/wa/tasks` all answer 401 without a token (route present). Every row above stays "tests only": nothing has run on a phone, no row has been exercised with a real token on the live server, (the assistant switch has since been found ON; see docs/AUDIT_2026-11-06.md). Later work and its limits: docs/BRAIN_DELIVERABLES.md. Remaining work and order: `docs/REMAINING_WORK.md`.
