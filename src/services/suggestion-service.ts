import { zonedClock } from '../i18n/date-time';
import type { SQLiteDatabase } from 'expo-sqlite';
import { asciiDigitsToBengali } from '../services/debt/money';
import { listTasks } from './task-repository';
import { wasDismissed } from './learning-service';
import { bangladeshDateKey } from '../i18n/date-time';

/** Bengali numerals inside Bengali text. Android mis-measures a line that mixes ASCII
 *  digits with Bengali and cuts it short, so every number in a Bengali sentence goes
 *  through here. */
const bnNum = (value: number | string) => asciiDigitsToBengali(String(value));

// Local, rule-based proactive suggestions for the Home screen. No model — just the
// user's own on-device data + a few honest heuristics. Nothing here nags: every card
// is dismissible and a dismissed card stays gone (learning-service tracks it).

export type SuggestionAction =
  | { type: 'RESCHEDULE_OVERDUE'; taskIds: string[]; toIso: string }
  | { type: 'MAKE_RECURRING'; title: string }
  | { type: 'OPEN_PLANNING' }
  | { type: 'PREFILL_CAPTURE'; text: string }
  | { type: 'OPEN_BACKUP' };

export interface Suggestion {
  id: string;
  icon: 'calendar-arrow-right' | 'repeat-variant' | 'clipboard-text-clock-outline' | 'lightning-bolt-outline' | 'database-clock-outline';
  message: string;
  actionLabel: string;
  action: SuggestionAction;
}

const CLOSED = new Set(['COMPLETED', 'ARCHIVED', 'CANCELLED']);
const dayKey = (d: Date) => bangladeshDateKey(d);

export async function getSuggestions(db: SQLiteDatabase, now = new Date(), language: 'bn' | 'en' = 'en'): Promise<Suggestion[]> {
  const bn = language === 'bn';
  const out: Suggestion[] = [];
  let tasks: Awaited<ReturnType<typeof listTasks>> = [];
  try { tasks = await listTasks(db, { limit: 500 }); } catch { return []; }
  const active = tasks.filter((t) => !CLOSED.has(t.status));
  const todayKey = dayKey(now);

  // 1) Overdue → offer a one-tap bulk reschedule to tomorrow 9am.
  const overdue = active.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now.getTime());
  if (overdue.length >= 2 && !(await wasDismissed(db, 'overdue-reschedule'))) {
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
    out.push({
      id: 'overdue-reschedule',
      icon: 'calendar-arrow-right',
      message: bn ? `${bnNum(overdue.length)}টি কাজ বকেয়া — সব আগামীকাল সকালে নিয়ে যাব?` : `${bnNum(overdue.length)} tasks are overdue — move them all to tomorrow morning?`,
      actionLabel: bn ? 'সব পিছিয়ে দিন' : 'Reschedule all',
      action: { type: 'RESCHEDULE_OVERDUE', taskIds: overdue.map((t) => t.id), toIso: tomorrow.toISOString() },
    });
  }

  // 2) Same non-recurring title created on 3+ distinct days → suggest making it recurring.
  const byTitle = new Map<string, Set<string>>();
  for (const t of tasks) {
    if (t.recurrence) continue;
    const key = t.title.trim().toLocaleLowerCase();
    const created = t.createdAt.slice(0, 10);
    if (!key) continue;
    (byTitle.get(key) ?? byTitle.set(key, new Set()).get(key)!).add(created);
  }
  for (const [key, days] of byTitle) {
    if (days.size < 3) continue;
    const original = tasks.find((t) => t.title.trim().toLocaleLowerCase() === key)?.title ?? key;
    const sid = `make-recurring:${key}`;
    if (await wasDismissed(db, sid)) continue;
    out.push({
      id: sid,
      icon: 'repeat-variant',
      message: bn ? `"${original}" প্রায়ই যোগ করছেন — এটা রোজ পুনরাবৃত্তি করব?` : `You add "${original}" often — make it repeat daily?`,
      actionLabel: bn ? 'রিপিট বানান' : 'Make recurring',
      action: { type: 'MAKE_RECURRING', title: original },
    });
    break; // one at a time
  }

  // 3) Have inbox items but nothing planned for today → nudge to plan (morning only).
  const inboxCount = active.filter((t) => t.status === 'INBOX').length;
  const plannedToday = active.some((t) => t.plannedDate === todayKey || (t.dueAt ? bangladeshDateKey(t.dueAt) === todayKey : false));
  if (inboxCount > 0 && !plannedToday && appHour(now) >= 5 && appHour(now) < 12 && !(await wasDismissed(db, 'plan-today'))) {
    out.push({
      id: 'plan-today',
      icon: 'clipboard-text-clock-outline',
      message: bn ? `ইনবক্সে ${inboxCount}টি আইটেম — আজকের প্ল্যান সাজাবেন?` : `${inboxCount} items in your inbox — plan your day?`,
      actionLabel: bn ? 'প্ল্যান করুন' : 'Plan today',
      action: { type: 'OPEN_PLANNING' },
    });
  }

  // 4) Backup older than 7 days.
  try {
    const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_preferences WHERE key = 'lastBackupAt'");
    const last = row?.value ? new Date(row.value).getTime() : 0;
    const days = (now.getTime() - last) / 86_400_000;
    if ((last === 0 || days >= 7) && tasks.length >= 5 && !(await wasDismissed(db, 'backup-nudge'))) {
      out.push({
        id: 'backup-nudge',
        icon: 'database-clock-outline',
        message: bn ? 'অনেকদিন ব্যাকআপ নেওয়া হয়নি — এখন একটা ব্যাকআপ নিন?' : "It's been a while since your last backup — make one now?",
        actionLabel: bn ? 'ব্যাকআপ' : 'Back up',
        action: { type: 'OPEN_BACKUP' },
      });
    }
  } catch { /* optional */ }

  return out.slice(0, 2); // at most two cards, ever
}

/** The hour on the app's clock (Bangladesh by default), not the phone's zone. */
function appHour(d: Date): number { return Number(zonedClock(d).slice(0, 2)); }
