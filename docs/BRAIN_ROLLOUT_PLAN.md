# Brain rollout plan (written 2026-11-06, after all code phases)

Nothing below has been done. SQL, build, push, merge and deploy each need the owner's separate OK, in this order.

## 0. What the code does today without anything else
Everything works with OR without the two SQL files. Without them: identity linking and task progress answer HTTP 409 with a plain Bangla reason; all other Brain features run. New automation is off or draft-only by default.

## 1. Order (each step ends with a check; stop at the first failure)
1. **Commit and push** the branch `feature/va-server-2026-11-06` (owner says go). Check: GitHub shows the commits.
2. **Backup check** (owner confirmed a backup on 2026-11-06; re-confirm it is recent before SQL).
3. **SQL 0002** (`server/manual_sql/0002_contact_person_link.sql`): run PREFLIGHT block, run the ALTER/INDEX, run the VERIFY block (expect 1 column row, same contact count, 0 linked). Rollback file exists.
4. **SQL 0003** (`server/manual_sql/0003_task_details.sql`): same three blocks (expect 7 column rows, same task count).
5. **Merge to `main`**, then Render **Manual Deploy**. Check: `/health`, `/health/db`; log in from the existing app; send one test SMS; confirm the inbox still receives.
6. **Turn the assistant on** in the app (owner decision "সহকারী চালু"; mode stays draft/shadow). Without this no Brain alert exists.
7. **Local debug APK build** (owner says go). Order: emulator `Pixel_6` first, then the phone `10EDAX04RL0002X` (`tools\build-apk.ps1`, ask before each build). The first build in a clean cache is long.
8. **Real tests on the phone** (checklist below), then record results in TRANSFER.md.

## 2. Real-device checklist (nothing here is verified yet)
- Missed call from a number with an earlier message: one alert with "অনুমান" and confidence; two more calls within 10 min add no second alert.
- Three calls from an unknown number: exactly one alert.
- Four WhatsApp/SMS messages from one person in 5 minutes: one draft, built from all four. An urgent word skips the wait.
- Notification dismissed: nothing is claimed as read; the reminder text says "নোটিফিকেশন সরানো হয়েছে (এটা পড়ার প্রমাণ নয়)". Check also that replying through the app does not look like "read".
- Same number on SMS and WhatsApp: automatically one person; same name different number: not linked; unlink works.
- "রহিমকে বলো ..." in `/f0`: draft only; approve sends; failure shows the real error; two Rahims: asks which.
- Task request ("লোগোটা কাল পাঠিয়ে দিন"): shows as "প্রস্তাবিত"; "নিশ্চিত করুন" works; "আমার কাজের কী হলো?" tells you the real state and promises nothing.
- Chat export import: run twice, second run adds nothing; imported text never triggers a reply or alert.
- Battery, CPU and screen-off behaviour: measure before/after (not measured so far).
- 1.0x and 1.5x font, light/night/dim themes for the new screens (not checked).
- Kotlin `onNotificationRemoved`: the module compiled on 2026-11-06 (`:va-bridge:compileDebugKotlin`, no APK). It has NOT run on a device: check that dismissing a chat notification produces one `seen` item per minute, and that replying through the app's own reply box does not make a reminder look "read".

## 3. Not buildable (platform or permission), with the safe alternative in place
- Detect the owner's own typed replies inside other apps: Android does not expose them. Alternative: the existing "sent-by-hand" button, F0 sends, Telegram replies.
- Confirmed read receipts: no API. Alternative: "dismissed" hint, always labelled as not proof.
- Full WhatsApp history: no API. Alternative: owner-exported chat import.
- Old SMS history: needs `READ_SMS` (owner decision, not added). Call recording: not an implementation target.

## 4. Known remaining code work (small, optional)
- Semantic search (pgvector) is NOT built; keyword matching only. Needs a resource check first.
- Matching of spelling variants of a name ("Rahim"/"Rohim") is not done.
- (Resolved by design, 2026-11-06 audit) `call()` in `src/va/api.ts` still returns only `data`. The server's free-text `message` is NOT shown on purpose: for an approved message that was only handed to the phone (`status=sending`) it still says "sent". `/f0` now reads the message's own `status`/`error` instead.
- The wording of every new Bangla/English UI string needs the owner's review.

## 5. F0 (`/f0`): what it is, and how it compares with the owner's "Sitting Room / F0" (final audit, 2026-11-06)

**Evidence.** The name "Sitting Room / F0" appears only in the owner's directive files. No screen, route, menu entry or document of the project carries it; `routes/ai.tsx`, which the directive names as the "likely starting point", is the "AI connections" key screen. So there is no existing Sitting Room to be compatible with: `/f0` ("সহকারীকে বলুন", `routes/f0.tsx` + `server/app/assistant/f0.py`) is a NEW, additive screen. Whether it is the owner's Sitting Room is an OWNER DECISION, not something the code can prove.

**What `/f0` really does (all tested on SQLite):** takes a typed command; identifies the person (name, all linked channels; asks "কোন জন?" when several people match; a pick by id also covers the same human's other channels); checks earlier replies (warns "you already answered", 24-hour WhatsApp window, private chat, another waiting draft); creates ONE DRAFT (`reason=owner`, `via=f0`, never sent by itself; the same command again reuses the same draft); sending happens only through the existing approve route and the result shown is the message's own stored status.

**Against `Brain_Prompt.md` section 12 (what the directive asks of F0):**

| Directive item | In `/f0` today |
|---|---|
| Text and voice input | text; voice only through the keyboard's own microphone (no permission added) |
| Identity and contact lookup | yes |
| Context-aware conversation search | NO (no message search) |
| Memory lookup and correction | lookup yes ("X সম্পর্কে কী জানো"); correction only on the contact screen |
| Missed-call summaries | yes (last 24 hours) |
| Unanswered-message follow-up | yes ("কার উত্তর বাকি") |
| Tasks, commitments, deadlines | list and status yes; confirm/progress only on the tasks screen |
| Alerts and priority | NO (separate alerts screen) |
| Draft replies and approval queue | the draft just made can be approved/cancelled; no queue of all drafts (inbox "drafts" filter exists) |
| Rules and automation settings | NO (separate rules screen) |
| Historical audit / import status | NO (server route exists, no screen) |
| Presence, availability, quiet hours | NO |
| Action history, delivery state, error explanation | delivery state of the approved draft yes; no history list |
| Existing health/system views | NO |
Command workflow 12.1: parse, resolve person, ask when ambiguous, check owner already acted (a WARNING, it does not block), preview, execute only after approval, report the real status: done. Partial: context retrieval (reply state only, remembered facts are not used), safety checks (blocked / private / 24 h window; no quiet-hours check).

**Owner decision (2026-11-06): `/f0` IS the Sitting Room / Personal AI Brain command centre.** The other modules stay separate screens and are used from F0 where useful. The rows marked NO above are therefore the planned growth of F0 (added only when the owner asks), not defects. UI wording (Bangla/English) is to be reviewed from screenshots after the first build.
