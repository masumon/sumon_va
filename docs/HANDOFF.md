# সুমনের ভার্চুয়াল সহকারী — HANDOFF (read this FIRST, before any work)

Last updated: 2026-11-05 05:30 (code fixes in 3b). Branch `feature/design-2026-11` (local git, no remote), last commit `a749b4f`. `master` holds the older state.
Owner: Sumon, non-technical, writes Bangla. **Reply in short Bangla, one step at a time, save tokens, never repeat a step, never run the same check twice.**

## 1. What the project is
Single-owner Android app (Expo 57, React Native 0.86, expo-router, Kotlin module `modules/va-bridge`, package `com.masumon.sumonva`). It reads chat-app notifications, SMS and missed calls, uploads them to the ABO server (FastAPI on Render, repo `D:\abo_Enterprise\abo-enterprise`), and shows an inbox and assistant console. Business data lives on the server. Never touch the public Apon app (`com.masumon.apon`).
Read next: `docs/PROJECT_CHARTER.md`, `DESIGN.md`, `CLAUDE.md`.

## 2. Hard rules from the owner
- Ask before a build for the PHONE and before installing on it; emulator builds are fine. Push/merge are his. `tools\ship.ps1` run by him counts as permission.
- Free-tier only; no secrets in chat or code; manual SQL given in chat before any server schema change.
- Family and personal contacts are never auto-replied; platforms must be addable by a button; app and website assistant settings stay separate.
- No behaviour change inside a "visual" task. Structural UX changes need his separate OK (the 8 he ticked are approved, see section 5).
- Time: Bangladesh zone (`Asia/Dhaka`) always. Format follows the LANGUAGE: Bangla UI = Bangla digits + এএম/পিএম; English UI = English digits + AM/PM. The 12/24-hour Settings choice must be respected (24h = no AM/PM).
- Text colours by meaning: normal black, urgent/error red, warning dark amber (pure yellow is unreadable), success green, info blue.
- Google passkey sign-in MUST work (login shows it disabled "শীঘ্রই আসছে").

## 3. What is DONE (design phase, all committed on the branch)
- Three design themes, all kept: **aurora (আভা কাচ), premium (প্রিমিয়াম), warm (রঙিন উষ্ণ)**; each with light/dark, plus the old low-light (dim) mode. Chosen in Settings ("ডিজাইন-থিম" card + "মোড (দিন / রাত)").
- Colour follows the place: every section and platform page has its own colour (`src/theme/designs.ts` SECTIONS, `applySection`, wired in `src/app/AppPreferences.tsx` through `usePathname`).
- Glass look = translucent surfaces over a soft colour glow (`src/ui/AppBackdrop.tsx`), floating glass header and bottom bar, gradient hero and buttons, coloured side-menu tiles. **Real blur is NOT implemented** (needs expo-blur `BlurTargetView`, Android 12+; the dialog uses RN `Modal`, so dialogs stay solid by decision). Notes: `D:\abo_Enterprise\sumon-va-design-2026-11-05\06_GLASS_AND_URGENT_NOTES.md`.
- Time format: `src/i18n/date-time.ts`.
- Side menu now starts shut, closes on route change and on app resume (`src/va/Drawer.tsx`); NOT yet verified on a device.
- Installed for the repo: Impeccable (project scope, no hooks, telemetry off via `.impeccable/config.json`), skill `vercel-react-native-skills`; both under `.claude/`.

## 3b. Audit code fixes — DONE in the working tree, NOT committed (session 2026-11-05 05:30, installed on the phone, not yet seen by the owner)
These are the ~24 uncommitted files in `git status`; they are REAL work, not stray edits: never revert, never discard. Commit them as ONE commit on `feature/design-2026-11` when the owner says so.
- F-01: `va_secure.xml` excluded in `data_extraction_rules.xml` (cloud + device-transfer) and `backup_rules.xml`; `Core.kt` `Store.prefs()` deletes an unreadable file and starts clean.
- F-02: `PollService.run` refuses blank / `enc1:` sms+reply text with a Bangla reason.
- U-21 `pair.tsx` catch + Bangla message. U-10 `wa-health.tsx` defaults (0, empty list). C-05 import message without the missing number. U-11 report average in sec/min/hours.
- U-09 `ModuleScreen` header uses `computeChecks`+`verdict` (same as the checklist). U-01 `HealthBanner` only on `/` and `/inbox`. U-03 inbox: 5 state chips + "more filters" button. U-04/U-17 header: theme, language and avatar buttons removed, buttons 48 dp (theme/language live in Settings). U-02 bottom bar = 4 tabs (Modules moved under "আরও", which stays active on /channels and /m/).
- U-16 screenshots blocked by default (`AppPreferences` blockScreenshots=true). U-05/U-14 Bangla digits on tasks/health/setup/ai stats. U-12 AI note colour follows status.
- C-01/C-02/C-03 chat import rejects zip and >3 MB, export of a private chat asks first and the cache file is deleted after sharing.
- F-07 RECORD_AUDIO removed from the manifest. F-10 release build stops without `keystore.properties`. F-11 `security-crypto` 1.1.0 stable. F-06 "Apon" text removed from `app.json`. F-05 partly: `modules/device-state`, `modules/pdf-pages` (git rm, staged), `js-sha256`, dead npm scripts and `allowScripts` removed.
- Checks: tsc 0, eslint (routes src modules) 0, Kotlin `:va-bridge:compileDebugKotlin` OK, `tools\ship.ps1` built and installed on the phone (`-r`, sign-in kept; process running, no crash in logcat).
- NOT done / NOT verified: F-05 rest (`src/database`, `src/services/db-*`, `src/backup/crypto.ts` are NOT dead: preferences, lock and error log use them — keep); ProGuard rules kept on purpose; F-08 (CallReceiver/BootReceiver) untouched, test idea: send a forged `android.intent.action.PHONE_STATE` broadcast with adb and see whether Android refuses it; phone-side look of the new screens, backup→restore re-test, U-13 loading notes, A-01..A-04 accessibility, Silent-vs-Off test, revoke Audit-Emulator devices.

## 4. Verified vs NOT verified
- Verified on the emulator (QA build): aurora design, light and dark: home, inbox, settings, WhatsApp page, side menu; section colours visible.
- NOT verified: premium and warm designs visually, system and dim modes, English UI, 24-hour time, 1.5x font, the other screens, the side-menu fix.

## 5. TODO, in this order (items 2 and 3 are now coded: see 3b; they need commit + a look on the phone)
1. Verify the three designs on the emulator in ONE pass (light/dark/system/dim, Bangla and English, 12/24h, 1.5x font). Force-stop and cold-start the app before each shot so the menu is shut. Fix only what is really wrong (readability on translucent cards first).
2. Urgent safety fixes (audit P1): **F-01** (Android Auto Backup restores `va_secure.xml` without its Keystore key -> silent sign-out and pairing does nothing; exclude `va_secure` in `res/xml/data_extraction_rules.xml` + `backup_rules.xml`, and make `Store.prefs()` in `Core.kt` delete the unreadable file and start clean); **F-02** (reject blank or `enc1:` reply/SMS text in `PollService.run`); **U-21** (`routes/pair.tsx` try/finally has no catch: show a Bangla error).
3. The 8 behaviour changes the owner ticked: one dismissible banner (not on every screen), 4 bottom tabs, 4–5 inbox state tabs + one filter button, fewer header buttons (theme/language to Settings), platform status must come from the checklist (13 of 14 say "সংযুক্ত" wrongly; LINE/Signal not installed) and fix the word "undefined" in `routes/wa-health.tsx:24`, Bangla digits and minutes/hours instead of raw seconds, confirm before exporting a private chat (and size limit/zip in import). Screenshot-blocking default was NOT ticked.
4. Google passkey (Android Credential Manager + server WebAuthn; show the owner before touching the server).
5. Final phone build (arm64) via `tools\build-apk.ps1 -Target phone` or his `tools\ship.ps1`; install `adb install -r` keeps his sign-in (old APK `dist\sumon-va-arm64.apk` of 00:06 is the rollback).
6. Owner housekeeping: revoke the emulator devices (Audit-Emulator, -2, -3) in the admin; Charter §11 five questions; Silent-vs-Off notification test by him (protocol in the audit).

## 6. Practical facts
- Phone adb id `10EDAX04RL0002X` (vivo, Android 15); emulator AVD `Pixel_6` = `emulator-5554`. Signing in is LOST whenever the emulator restarts (the phone is fine); pairing needs a one-time admin code that only the owner can create and type into the emulator window.
- Build runs out of memory if free RAM < ~4 GB: stop the emulator gracefully (`adb shell reboot -p`) and use `-FreeMemory`. `-Qa` builds allow screenshots (never for the final build).
- Typecheck `npx tsc --noEmit`, lint `npx eslint src routes` before every commit.
- Screenshot/tap helper scripts must target `emulator-5554` (an earlier one wrongly targeted the phone id).
- Reports: audit `D:\abo_Enterprise\sumon-va-audit-2026-11-05\` (README + AUDIT_AND_RESEARCH_COMPLETE.md); design `D:\abo_Enterprise\sumon-va-design-2026-11-05\` (README, blueprint, boards). They contain private chat previews: never share.
- Owner memory index: `C:\Users\masum\.claude\projects\d--abo-Enterprise\memory\MEMORY.md` (start with `abo-sumon-va-PROJECT.md`).
