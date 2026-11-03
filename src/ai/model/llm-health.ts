// When the on-device AI is slow or stops — why, in words anyone understands, and what to do.
//
// (The user's request for 1.0.) Android does not let an app read how much memory is free or
// how busy the processor is, and React Native does not pass Android's low-memory signal to
// JavaScript (it is iOS-only). So the cause is read from what the AI itself shows:
//   • the model could not be loaded because memory ran short      → LOW_MEMORY
//   • the app was closed by Android while the model was loading   → KILLED (llama-runtime's marker)
//   • words are coming out very slowly (llama.rn's own timings)   → SLOW
//   • no answer within the time allowed                           → TIMEOUT
//   • the model file is gone                                       → MODEL_MISSING
// Every message says that আপন keeps working without the AI, and nothing is lost.

export type LlmIssueKind = 'LOW_MEMORY' | 'KILLED' | 'SLOW' | 'TIMEOUT' | 'MODEL_MISSING';
export interface LlmIssue { kind: LlmIssueKind; at: string }

const listeners = new Set<(issue: LlmIssue) => void>();
let last: LlmIssue | null = null;
const lastShown = new Map<LlmIssueKind, number>();
/** The same problem is said once in a while, not on every answer. */
const REPEAT_AFTER_MS = 5 * 60_000;

type StoredFile = { exists: boolean; create(o?: { overwrite?: boolean }): void; write(s: string): void; textSync(): string };
function issueFile(): StoredFile | null {
  try {
    // Lazily, like llama-runtime: the web/jest project has no native file module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require('expo-file-system') as { File: new (dir: unknown, name: string) => StoredFile; Paths: { document: unknown } };
    return new File(Paths.document, 'llm-last-issue.json');
  } catch { return null; }
}

/** Say that something went wrong with the AI. Listeners (the আপন screen) show it at once. */
export function reportLlmIssue(kind: LlmIssueKind, now = Date.now()): void {
  const shownAt = lastShown.get(kind);
  if (shownAt !== undefined && now - shownAt < REPEAT_AFTER_MS) return;
  lastShown.set(kind, now);
  last = { kind, at: new Date(now).toISOString() };
  try { const f = issueFile(); f?.create({ overwrite: true }); f?.write(JSON.stringify(last)); } catch { /* best-effort */ }
  for (const fn of listeners) { try { fn(last); } catch { /* a listener never breaks the AI */ } }
}

export function onLlmIssue(fn: (issue: LlmIssue) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The most recent problem, this run or an earlier one — for the AI page and for আপন's answer. */
export function lastLlmIssue(): LlmIssue | null {
  if (last) return last;
  try {
    const f = issueFile();
    if (!f?.exists) return null;
    const saved = JSON.parse(f.textSync()) as Partial<LlmIssue>;
    return saved.kind && saved.at ? { kind: saved.kind, at: saved.at } : null;
  } catch { return null; }
}

/** What a failed model load means, from the error llama.rn gives back. */
export function classifyLoadFailure(error: unknown): LlmIssueKind | null {
  const text = error instanceof Error ? error.message : String(error ?? '');
  if (/no such file|enoent|not found|does not exist|failed to open/iu.test(text)) return 'MODEL_MISSING';
  if (/memory|alloc|\boom\b|bad_alloc|mmap|\bram\b|insufficient|failed to load/iu.test(text)) return 'LOW_MEMORY';
  return null;
}

/** Words coming out slower than about two a second, over a real answer, is slow to a person. */
export function isSlowGeneration(timings: { predicted_n?: number; predicted_per_second?: number } | null | undefined): boolean {
  if (!timings) return false;
  const n = timings.predicted_n ?? 0;
  const rate = timings.predicted_per_second ?? 0;
  return n >= 8 && rate > 0 && rate < 2;
}

export interface LlmIssueCopy { title: string; body: string; steps: string[] }

const CLOSE_APPS_BN = 'ফোনের নিচের ▢ (সাম্প্রতিক অ্যাপ) বোতাম চাপুন, আর ফেসবুক, ইউটিউব, গেমের মতো খোলা অ্যাপগুলো সরিয়ে বন্ধ করুন — এতে ফোনের RAM খালি হয়।';
const CLOSE_APPS_EN = 'Tap the phone’s ▢ (recent apps) button and swipe away open apps like Facebook, YouTube or games — that frees the phone’s RAM.';
const SMALLER_BN = 'বারবার হলে "AI মডেল" পাতায় ছোট মডেল (১–২ GB-এর মতো) নিন।';
const SMALLER_EN = 'If it keeps happening, pick a smaller model (around 1–2 GB) on the "AI model" page.';
const STILL_WORKS_BN = 'চিন্তা নেই — AI ছাড়াও আপন সব কাজ করে, আপনার কোনো তথ্য হারায়নি।';
const STILL_WORKS_EN = 'Don’t worry — আপন does everything without the AI too, and nothing of yours was lost.';

/** The message for one problem, in plain words, with what to do about it. */
export function llmIssueCopy(kind: LlmIssueKind, bn: boolean): LlmIssueCopy {
  switch (kind) {
    case 'LOW_MEMORY':
      return bn
        ? { title: 'ফোনের RAM কম — AI চালু হলো না', body: `এই মুহূর্তে ফোনে অনেক অ্যাপ খোলা, তাই AI-এর জন্য জায়গা (RAM) হয়নি। ${STILL_WORKS_BN}`, steps: [CLOSE_APPS_BN, 'আপনে ফিরে আবার চেষ্টা করুন।', SMALLER_BN] }
        : { title: 'Phone RAM is low — the AI could not start', body: `Too many apps are open, so there was no room (RAM) for the AI. ${STILL_WORKS_EN}`, steps: [CLOSE_APPS_EN, 'Come back to আপন and try again.', SMALLER_EN] };
    case 'KILLED':
      return bn
        ? { title: 'আগের বার AI চালাতে গিয়ে অ্যাপ বন্ধ হয়ে গিয়েছিল', body: `ফোনের RAM ফুরিয়ে যাওয়ায় Android নিজেই আপনকে বন্ধ করে দিয়েছিল। ${STILL_WORKS_BN}`, steps: [CLOSE_APPS_BN, 'তারপর "AI মডেল" পাতায় "আবার যাচাই করুন" চাপুন।', SMALLER_BN] }
        : { title: 'Last time, the app closed while starting the AI', body: `The phone ran out of RAM, so Android closed আপন. ${STILL_WORKS_EN}`, steps: [CLOSE_APPS_EN, 'Then tap "Verify again" on the "AI model" page.', SMALLER_EN] };
    case 'SLOW':
      return bn
        ? { title: 'AI আজ ধীরে চলছে', body: `ফোন ব্যস্ত থাকলে, গরম হলে বা ব্যাটারি-সেভার চালু থাকলে AI ধীরে উত্তর দেয়। ${STILL_WORKS_BN}`, steps: [CLOSE_APPS_BN, 'ফোন গরম হলে একটু ঠান্ডা হতে দিন; ব্যাটারি-সেভার চালু থাকলে বন্ধ করে দেখুন।', SMALLER_BN] }
        : { title: 'The AI is running slowly today', body: `The AI answers slowly when the phone is busy, hot, or in battery saver. ${STILL_WORKS_EN}`, steps: [CLOSE_APPS_EN, 'Let a hot phone cool down; try turning battery saver off.', SMALLER_EN] };
    case 'TIMEOUT':
      return bn
        ? { title: 'AI সময়মতো উত্তর দিতে পারেনি', body: `তাই এবার আপন নিজের সাধারণ নিয়মে কাজটা করেছে। ${STILL_WORKS_BN}`, steps: [CLOSE_APPS_BN, 'ফোন গরম হলে একটু ঠান্ডা হতে দিন; ব্যাটারি-সেভার চালু থাকলে বন্ধ করে দেখুন।', SMALLER_BN] }
        : { title: 'The AI did not answer in time', body: `So আপন did it with its own built-in rules this time. ${STILL_WORKS_EN}`, steps: [CLOSE_APPS_EN, 'Let a hot phone cool down; try turning battery saver off.', SMALLER_EN] };
    case 'MODEL_MISSING':
    default:
      return bn
        ? { title: 'AI মডেলের ফাইল পাওয়া যাচ্ছে না', body: `ফাইলটা সরানো বা মোছা হয়ে থাকতে পারে। ${STILL_WORKS_BN}`, steps: ['"AI মডেল" পাতায় গিয়ে মডেলটা আবার যোগ করুন।'] }
        : { title: 'The AI model file cannot be found', body: `It may have been moved or deleted. ${STILL_WORKS_EN}`, steps: ['Add the model again on the "AI model" page.'] };
  }
}

// ── the phone notification, for when the app itself is closed ─────────────────────────
//
// If Android closes আপন for lack of memory while the model loads, nothing in the app can
// speak any more. So before a load a notification is booked with the phone for three minutes
// later, and cancelled as soon as the load finishes. Only a load that never finished lets
// it through — which is exactly the case the person needs to hear about.

const WATCHDOG_ID = 'llm-watchdog';
// Three minutes: long enough that a big model still loading on a slow phone is not taken
// for a closed app (rc.14 review R2).
const WATCHDOG_AFTER_MS = 180_000;
let language: 'bn' | 'en' = 'bn';
/** The language the booked notification should speak (set by the screens). */
export function setLlmHealthLanguage(lang: 'bn' | 'en'): void { language = lang; }

type NotificationsModule = {
  scheduleNotificationAsync(r: unknown): Promise<string>;
  cancelScheduledNotificationAsync(id: string): Promise<void>;
  getPermissionsAsync(): Promise<{ granted: boolean }>;
  SchedulableTriggerInputTypes: { DATE: string };
};
function notifications(): NotificationsModule | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  try { return require('expo-notifications') as NotificationsModule; } catch { return null; }
}

export async function armLoadWatchdog(): Promise<void> {
  const N = notifications();
  if (!N) return;
  try {
    if (!(await N.getPermissionsAsync()).granted) return;
    const copy = llmIssueCopy('KILLED', language === 'bn');
    await N.scheduleNotificationAsync({
      identifier: WATCHDOG_ID,
      content: {
        title: language === 'bn' ? 'আপন: AI চালাতে গিয়ে ফোনের RAM কম পড়েছে' : 'আপন: the phone ran short of RAM for the AI',
        body: `${copy.steps[0]} ${language === 'bn' ? 'আপনার কোনো তথ্য হারায়নি।' : 'Nothing of yours was lost.'}`,
      },
      trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + WATCHDOG_AFTER_MS) },
    });
  } catch { /* best-effort — never blocks the AI */ }
}

export async function disarmLoadWatchdog(): Promise<void> {
  try { await notifications()?.cancelScheduledNotificationAsync(WATCHDOG_ID); } catch { /* noop */ }
}
