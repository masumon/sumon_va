# CLAUDE.md — sumon-va

> **START HERE: `docs/START_HERE.md`** (what the project is, where things are, where to work, reading order, what to update when you finish). Rules: `docs/PROJECT_RULES.md`. Work order: `docs/TRANSFER.md` section 13.
>
> **READ FIRST: `docs/HANDOFF.md`** — current status, owner rules, what is verified, and the ordered TODO. Do not start work before reading it. Update it at the end of every work session.

## What this project is
"সুমনের ভার্চুয়াল সহকারী": a single-owner Android app (Expo 57, React Native 0.86.2, expo-router, zustand, Kotlin module `modules/va-bridge`). It relays chat-app notifications/SMS/calls to the ABO server and shows an inbox and assistant console. All business data lives on the server; the phone keeps only an encrypted token, an offline queue, and app preferences. Owner writes Bangla and is non-technical.

## Design source of truth
- Read `DESIGN.md` before any UI work. The approved direction is "Intercom structure on Sapphire & Gold, restrained glass".
- Code source of truth for tokens: `src/theme/index.ts`. Never hard-code colours, radii, font sizes or spacing in screens; add or change a token there.
- Shared UI lives in `src/ui` (AppKit, AppSurface, AppText, AppFeedback, PrimaryNav) and `src/va` (Page, Hero, StatTile, Drawer, AppHeader…). Extend these instead of styling per screen.

## Design rules (short)
1. Cream canvas, white hairline cards, no shadows on cards; shadows only on dialog/snackbar.
2. One navy action colour; at most one filled primary button per section. No pill buttons.
3. Gold only for AI and urgent. Semantic colours only with their meaning.
4. Weights 400/500/600 (700 only page titles). Never lighter than 400. Bengali in Noto Sans Bengali.
5. Touch targets ≥ 48 dp; every icon-only control has a Bangla accessibility label; decorative icon glyphs are hidden from screen readers.
6. Glass only on bottom navigation (≈0.62) and dialogs/sheets (≈0.80); real blur only on Android 12+ via `blurMethod="dimezisBlurViewSdk31Plus"` with a `BlurTargetView`, otherwise solid. Never on cards, lists, forms or text.
7. Light, night and dim themes must all work; test at 1.0× and 1.5× system font.
8. Digits follow the UI language (Bangla digits in Bangla UI) once the owner approves that change.
9. Never show two different truths for one status; show the real reason for any failure.

## Hard boundaries
- Do not change business logic, API calls, authentication, data or navigation behaviour as part of a visual task. Structural UX changes (single banner, single navigation, fewer filters, header controls, status logic) need the owner's separate approval.
- Never touch the public Apon app (`com.masumon.apon`) or anything outside this project.
- Free-tier services only; no secrets, passwords or tokens in code, chat or docs. No OTA updates.
- Family and personal contacts are never auto-replied. Platforms must stay addable by a button.

## Workflow rules from the owner
- Reply in short Bangla; one step at a time; report what is done, what is left, what the owner must do.
- Ask before every build; running `tools\ship.ps1` himself counts as permission for that build. Test on the emulator first, then the phone.
- Work on a branch; show designs and wait for OK before pushing; the owner merges. Run `npx tsc --noEmit` and `npx eslint .` before reporting done.
- Server SQL changes: give the manual SQL in chat first.

## Commands
- Type check: `npx tsc --noEmit`; lint: `npx eslint .`; one-command build + install: `powershell -ExecutionPolicy Bypass -File tools\ship.ps1`.
- Phone adb id `10EDAX04RL0002X`, package `com.masumon.sumonva`; emulator AVD `Pixel_6`.

## Using the design resources (after install)
- Impeccable (installed in `.claude/skills/impeccable/`, no hooks): use `critique`/`audit` for review and `shape` for planning; it ships Android and native reference notes, but treat its output as advice for the React Native code, not as an automatic editor. Telemetry must stay off (`.impeccable/config.json` has `"telemetry": false`; also set `DO_NOT_TRACK=1`).
- Vercel `vercel-react-native-skills` (installed in `.claude/skills/`): apply for performance, list, animation, image and layout rules.
- Awesome DESIGN.md: reference only (the Intercom file is kept in `_private\sumon-va-design-2026-11-05\`).
