# SUMON VA — 18 Domain Implementation Plan, Report and Test Report (2026-11-07, v1.0)

One file covers the plan, the implementation report and the test report, to save tokens. The directive also names separate `_PLAN` and `_TEST_REPORT` files; their content is the three sections below.

## 1. Plan (gaps, priority, owner)
| P | Gap | Domain | Where | Needs | State |
|---|---|---|---|---|---|
| P1 | Official/legal messages could be auto-answered (only police/court words were blocked) | 6, 14, 16 | `wa_brain.decide`, `wa_config` | code + tests | **DONE today** |
| P2 | Dated invitations and official deadlines were not tracked | 3, 6 | `obligations.py`, `wa_flow._process` | code + tests | **DONE today** |
| P2 | Private folders protected only by a PC-local exclude file | security | `.gitignore` | — | **DONE today** |
| P3 | Server called itself "ABO Enterprise API" | hygiene | `core/config.py` default | — | **DONE today** (a Render `APP_NAME` env value would still override it) |
| P1 | Urgent alert reached the phone but did not ring | 14 | Kotlin alert channel | phone + build | open: needs device logs |
| P2 | `CallReceiver` exported without a sender permission | 7, security | module manifest | check whether `PHONE_STATE` is a protected broadcast; then maybe add `android:permission` | open: build + device test |
| P2 | Outbox lost on sign-out | 8 | Kotlin `Core.kt` | build | open |
| P2 | `ai_catalog` ABO shop router mounted, unusable | hygiene | `api/v1/router.py` | owner OK (removes a module) | open: owner decision |
| P3 | Decision log for non-draft outcomes; relationship-label provenance; organisation field; semantic search | 17, 2, 4, 11 | server | design + maybe SQL | later |
| — | Business data (ABO) | 5 | ABO side | ABO agent | external |
| — | OCR / phone voice audio | 9 | — | platform/cost | blocked |

## 2. What changed (not committed, not pushed, not deployed)
| File | Change | Why |
|---|---|---|
| `server/app/assistant/wa_config.py` | new default lists `official_words`, `invite_words` (additive; deep-merged with saved config) | domains 3 and 6 |
| `server/app/assistant/wa_brain.py` | `decide`: an official word means no reply, handoff + notify, priority raised to 2 (an urgent p1 stays p1), its own Bangla note; reason stays `sensitive` so nothing downstream changes | domain 6: no consequential autonomous reply |
| `server/app/assistant/obligations.py` | NEW, rules only: `detect` (official/invite + due date from the existing promise parser), `proposal_title` (private = no words) | domains 3, 6 |
| `server/app/assistant/wa_flow.py` | `_process`: a DATED obligation becomes ONE proposed task (same path as assignments: no duplicate on reprocess, owner confirms, family words never copied) | domains 3, 6, 4 |
| `server/app/core/config.py` | default `APP_NAME` "Sumon VA API" | honest name |
| `.gitignore` | `_private/`, `sumon-va-audit-*/`, `sumon-va-design-*/` | privacy on every clone |
| `server/tests/test_obligations.py` | NEW, 12 tests | evidence |
API contracts: unchanged (no route added, removed or reshaped). Database: **no SQL**, no new column (only existing `wa_tasks` columns and `task_details` are used). Android/app: unchanged (no build needed for these server changes; deploy needed).

## 3. Tests executed today
| Command | Result |
|---|---|
| `cd server; python -m pytest -q tests/test_obligations.py` | 12 passed |
| `cd server; python -m pytest -q` (full) | **466 passed**, 0 failed (454 before the change + 12 new) |
| `npx tsc --noEmit`, `npx eslint routes src modules` | clean (run before the changes; the app was not touched afterwards) |
| Device, emulator, APK build, live server | **not run** (not authorised; no phone connected) |
What the tests cover: detection of official messages and invitations, no invented due date, owner can empty the lists, an official message gets no reply and priority ≤ 2, urgent stays p1, family keeps its reason, full `_process` on SQLite (one proposed task, no duplicate on reprocess, no outgoing message, alert sent at p ≤ 2), undated invitation = no task, family invitation task stores no words.

## 4. Remaining before release
Owner: review, commit + push (owner's OK), PR merge, Render Manual Deploy. Then check one official-looking test SMS on the phone. No APK build is needed for this change. A build is needed later for the open Kotlin items (alarm ring, `CallReceiver`, outbox), and only after the owner says "build".
