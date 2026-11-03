// Offline local reminders for debt/receivable due dates (spec §41, §42, §40).
// Own notification channel; identifiers are deterministic (`dr:<accountId>:<dueDate>:<lead>`)
// so re-running the sync just reconciles — it never stacks duplicates.

import * as Notifications from 'expo-notifications';
import { asciiDigitsToBengali, formatPaisa } from './money';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { hasNotificationPermission } from '../notification.service';
import { getPortfolio } from './debt-service';
import { getSetting, listPromises, getPerson } from './repository';
import { triggerIso } from '../notification-status-service';
import { zonedInstant } from '../../i18n/date-time';

export const DEBT_CHANNEL_ID = 'debt-reminders';
const BRAND = '#C13B2E';
const LEAD_DAYS = [7, 3, 1, 0]; // days before due
/**
 * Days AFTER the due date to keep nudging. Without these the app went silent at exactly
 * the moment it mattered: every "days before" trigger is in the past once a date passes,
 * so an overdue debt was never mentioned again.
 */
const OVERDUE_DAYS = [1, 3, 7, 14, 30];
const ID_PREFIX = 'dr:';
const DEFAULT_HOUR = 9;

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(DEBT_CHANNEL_ID, {
      name: 'Debt reminders · দেনা-পাওনা রিমাইন্ডার',
      description: 'Due-date and overdue reminders for personal debts and receivables.',
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableVibrate: true,
      showBadge: true,
    });
  } catch { /* best-effort */ }
}

function dateKey(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

/** `hour`:00 on the due day shifted by `offsetDays`, in the app's zone — not the phone's. */
function fireAt(dueDateIso: string, offsetDays: number, hour = DEFAULT_HOUR): Date {
  const [y = 1970, m = 1, d = 1] = dateKey(dueDateIso).split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
  return new Date(zonedInstant(day, `${String(hour).padStart(2, '0')}:00`));
}

/** The hour of day the user picked in Tools, clamped to something sane. */
function reminderHour(raw: string | null): number {
  // Never set (null) or blank must mean the default 9 AM — Number(null) is 0, which put
  // every debt reminder at midnight (1.0.0 phone check, 2026-10-07).
  if (raw == null || raw.trim() === '') return DEFAULT_HOUR;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? Math.trunc(n) : DEFAULT_HOUR;
}

/**
 * A short, stable fingerprint of what a reminder SAYS. It rides along in the identifier,
 * so when the amount changes the id changes too — the reconciler then cancels the stale
 * notification and schedules the new one. Without it a partly-paid instalment kept
 * announcing its original figure, because an already-scheduled id was simply skipped.
 */
function contentTag(paisa: number): string {
  return String(paisa);
}

/**
 * Reconcile scheduled debt reminders with the current portfolio. Cancels ours that no
 * longer apply, then schedules 7/3/1/0-day reminders for every live upcoming due slice
 * plus follow-up reminders for open promises. No-op without notification permission or
 * when the user has turned debt reminders off.
 */
export async function syncDebtReminders(db: SQLiteDatabase, now = new Date(), language: 'bn' | 'en' = 'bn'): Promise<number> {
  const bn = language === 'bn';
  try {
    if ((await getSetting(db, 'remindersEnabled')) === '0') {
      await cancelAll();
      return 0;
    }
    const wanted = new Map<string, { date: Date; title: string; body: string; data: Record<string, unknown> }>();

    const hour = reminderHour(await getSetting(db, 'reminderHour'));
    const { balances, accounts } = await getPortfolio(db, { asOf: now.toISOString() });
    const accById = new Map(accounts.map((a) => [a.id, a]));
    for (const b of balances) {
      if (!b.nextDueDate || b.nextDuePaisa <= 0) continue;
      if (['COMPLETED', 'SETTLED', 'WRITTEN_OFF', 'CANCELLED'].includes(b.status)) continue;
      const acc = accById.get(b.accountId);
      const isDebt = b.direction === 'DEBT';
      const name = acc?.title ?? (bn ? (isDebt ? 'দেনা' : 'পাওনা') : (isDebt ? 'Debt' : 'Receivable'));
      const amount = formatPaisa(b.nextDuePaisa, { bnDigits: bn });
      const tag = contentTag(b.nextDuePaisa);

      for (const lead of LEAD_DAYS) {
        const at = fireAt(b.nextDueDate, -lead, hour);
        if (at.getTime() <= now.getTime()) continue;
        const id = `${ID_PREFIX}${b.accountId}:${dateKey(b.nextDueDate)}:${lead}:${tag}`;
        const when = bn ? (lead === 0 ? 'আজ' : `${asciiDigitsToBengali(String(lead))} দিনে`) : (lead === 0 ? 'today' : `in ${lead} days`);
        wanted.set(id, {
          date: at,
          title: bn
            ? `${isDebt ? 'দেনা পরিশোধ' : 'পাওনা আদায়'} ${when}`
            : `${isDebt ? 'Payment due' : 'Collection due'} ${when}`,
          body: `${name} · ${amount}`,
          data: { drAccountId: b.accountId, route: `/debt/account/${b.accountId}` },
        });
      }

      // Overdue follow-ups. These are the ones that actually fire for a slipped payment,
      // because "3 days before" is already in the past by then.
      for (const after of OVERDUE_DAYS) {
        const at = fireAt(b.nextDueDate, after, hour);
        if (at.getTime() <= now.getTime()) continue;
        const id = `${ID_PREFIX}${b.accountId}:${dateKey(b.nextDueDate)}:late${after}:${tag}`;
        wanted.set(id, {
          date: at,
          title: bn
            ? `${asciiDigitsToBengali(String(after))} দিন পেরিয়ে গেছে — ${isDebt ? 'দেনা' : 'পাওনা'}`
            : `${after} days overdue — ${isDebt ? 'payment' : 'collection'}`,
          body: `${name} · ${amount}`,
          data: { drAccountId: b.accountId, route: `/debt/account/${b.accountId}` },
        });
      }
    }

    // Promise follow-ups
    for (const p of await listPromises(db)) {
      if (p.status !== 'OPEN') continue;
      const when = p.followUpDate ?? p.promisedDate;
      const at = fireAt(when, 0, hour);
      if (at.getTime() <= now.getTime()) continue;
      const person = await getPerson(db, (await getPromiseAccount(db, p.accountId)) ?? '');
      const id = `${ID_PREFIX}promise:${p.id}:${contentTag(p.amountPaisa)}`;
      wanted.set(id, {
        date: at,
        title: bn ? 'প্রতিশ্রুত টাকা' : 'Promised payment',
        body: `${person?.name ?? ''} · ${formatPaisa(p.amountPaisa, { bnDigits: bn })}`,
        data: { route: `/debt/account/${p.accountId}` },
      });
    }

    // Reconcile: cancel ours that aren't wanted, schedule the rest.
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    const existingIds = new Set<string>();
    for (const n of existing) {
      const nid = n.identifier;
      if (!nid.startsWith(ID_PREFIX)) continue;
      const want = wanted.get(nid);
      // Same reminder but a different ring time (e.g. the reminder hour changed, or an older
      // build set it for midnight) — cancel it so it is scheduled again at the right time.
      const at = triggerIso(n.trigger);
      const moved = want !== undefined && at !== null && Math.abs(Date.parse(at) - want.date.getTime()) > 60_000;
      if (!want || moved) {
        try { await Notifications.cancelScheduledNotificationAsync(nid); } catch { /* ignore */ }
        continue;
      }
      existingIds.add(nid);
    }
    // Only now ask for permission — a fresh install with no debts must never be prompted
    // for a module the user has not opened yet.
    const toSchedule = [...wanted].filter(([id]) => !existingIds.has(id));
    if (toSchedule.length === 0) return 0;
    // Checked, never asked: this runs on launch, and a permission dialog that appears
    // without a reason beside it is one the user denies.
    if (!(await hasNotificationPermission())) return 0;
    await ensureChannel();

    let scheduled = 0;
    for (const [id, w] of toSchedule) {
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: id,
          content: { title: w.title, body: w.body, data: w.data, color: BRAND, priority: Notifications.AndroidNotificationPriority.HIGH },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: w.date,
            ...(Platform.OS === 'android' ? { channelId: DEBT_CHANNEL_ID } : {}),
          },
        });
        scheduled += 1;
      } catch { /* ignore one */ }
    }
    return scheduled;
  } catch {
    return 0;
  }
}

async function getPromiseAccount(db: SQLiteDatabase, accountId: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ person_id: string }>('SELECT person_id FROM dr_accounts WHERE id = ?', accountId);
  return r?.person_id ?? null;
}

async function cancelAll(): Promise<void> {
  try {
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of existing) {
      if (n.identifier.startsWith(ID_PREFIX)) {
        try { await Notifications.cancelScheduledNotificationAsync(n.identifier); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}
