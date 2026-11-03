// The debt module, declared.
//
// Everything the rest of the app needs to know about it is here: where it lives, what it
// says on Home today, which settings belong to it, what it has scheduled, what it can be
// searched for, and what the assistant may quote.
//
// Its three settings — reminders on/off, the hour they fire, and the starting debt figure
// — used to live inside the module's own tools screen, where nobody looking for reminder
// settings would think to go. They are the same rows in `dr_settings`; only the screen
// that shows them has moved, so a user who already turned reminders on stays turned on.

import { getDashboardMetrics, type DashboardMetrics } from '../services/debt/debt-service';
import { bangladeshDateKey, bangladeshMonthKey } from '../i18n/date-time';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getGoal } from '../services/goal-service';
import { getSetting, setSetting, restoreAccount, purgeAccount } from '../services/debt/repository';
import { registerTrashHandlers } from '../services/trash-registry';
import { debtContextLines, searchDebt } from '../services/debt/search';
import { asciiDigitsToBengali, formatPaisa, parseTakaToPaisa } from '../services/debt/money';
import { debtCopy } from '../i18n/debt';
import { registerModule, type AppModule } from './registry';

// The dashboard walks every account and every transaction. Home asks for it five times
// in one pass — once for the money picture, twice while forming opinions, once for the
// home line and once for the assistant's facts — and each walk is the same answer. Held
// for a moment, which is exactly as long as one render needs and short enough that a
// payment recorded on the next screen is never stale.
let metricsCache: { at: number; value: DashboardMetrics } | null = null;
const METRICS_TTL_MS = 800;

async function metrics(db: SQLiteDatabase): Promise<DashboardMetrics> {
  if (metricsCache && Date.now() - metricsCache.at < METRICS_TTL_MS) return metricsCache.value;
  // The real call. A blanket rename once made this line call this function, which is an
  // infinite recursion that no type check and no test caught — it would simply have hung
  // the app on the first Home render.
  const value = await getDashboardMetrics(db);
  metricsCache = { at: Date.now(), value };
  return value;
}

/** Called after anything that changes a balance, so the next read is fresh. */
export function forgetDebtMetrics(): void { metricsCache = null; }

const bnDigits = (v: string | number) => asciiDigitsToBengali(String(v));

/** Money the way each language reads it — Bengali numerals in Bengali, always. */
const money = (paisa: number, bn: boolean) => formatPaisa(paisa, { bnDigits: bn });

/** "সকাল ৯টা" / "9 AM" — the app is Bengali-first, so the label is too. */
function hourLabel(h: number, bn: boolean): string {
  if (!bn) return h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`;
  const digits = bnDigits(h <= 12 ? h : h - 12);
  const part = h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 19 ? 'বিকেল' : 'রাত';
  return `${part} ${digits}টা`;
}

const REMINDER_HOURS = [7, 9, 12, 18, 21];

export const debtModule: AppModule = {
  id: 'debt',
  route: '/debt',
  icon: 'wallet-outline',
  activeIcon: 'wallet',
  tone: 'red',
  inPrimaryNav: true,
  defaultEnabled: true,
  title: (language) => debtCopy(language).module,
  description: (language) => debtCopy(language).tagline,

  /**
   * One line for Home, ordered by what actually needs attention: something overdue beats
   * something due today, which beats the total. Nothing is shown when nothing is owed.
   */
  async homeLine(db, language) {
    const bn = language === 'bn';
    const money = (v: number) => formatPaisa(v, { bnDigits: bn });
    const m = await metrics(db);

    if (m.overduePaisa > 0) {
      return {
        label: bn ? 'সময় পেরোনো দেনা' : 'Overdue debt',
        value: money(m.overduePaisa),
        hint: bn ? `${bnDigits(m.overdueCount)}টি হিসাবে` : `across ${m.overdueCount} accounts`,
        route: '/debt',
      icon: 'wallet-outline',
        weight: 100,
        tone: 'red',
      };
    }
    if (m.dueTodayPaisa > 0) {
      return {
        label: bn ? 'আজ দিতে হবে' : 'Due today',
        value: money(m.dueTodayPaisa),
        route: '/debt',
        weight: 80,
        tone: 'orange',
      };
    }
    if (m.portfolio.outstandingDebtPaisa > 0) {
      return {
        label: bn ? 'মোট দেনা' : 'Total debt',
        value: money(m.portfolio.outstandingDebtPaisa),
        hint: m.dueNext7Paisa > 0
          ? (bn ? `আগামী ৭ দিনে ${money(m.dueNext7Paisa)}` : `${money(m.dueNext7Paisa)} due in 7 days`)
          : undefined,
        route: '/debt',
        weight: 40,
        tone: 'red',
      };
    }
    return null;
  },

  settings(language) {
    const bn = language === 'bn';
    return [
      {
        key: 'remindersEnabled',
        kind: 'TOGGLE',
        label: () => (bn ? 'দেনার রিমাইন্ডার' : 'Debt reminders'),
        hint: () => (bn
          ? 'তারিখের ৭, ৩, ১ ও ০ দিন আগে — আর পেরিয়ে গেলে ১, ৩, ৭, ১৪ ও ৩০ দিন পরেও।'
          : 'Seven, three, one and zero days before — and after 1, 3, 7, 14 and 30 days once a date has passed.'),
        // Absent means on: reminders were on by default before this setting had a screen.
        read: async (db) => (await getSetting(db, 'remindersEnabled')) ?? '1',
        write: async (db, value) => setSetting(db, 'remindersEnabled', value),
      },
      {
        key: 'reminderHour',
        kind: 'CHOICE',
        label: () => (bn ? 'রিমাইন্ডারের সময়' : 'Reminder time'),
        options: () => REMINDER_HOURS.map((h) => ({ value: String(h), label: hourLabel(h, bn) })),
        read: async (db) => (await getSetting(db, 'reminderHour')) ?? '9',
        write: async (db, value) => setSetting(db, 'reminderHour', value),
      },
      {
        key: 'startingDebtPaisa',
        kind: 'AMOUNT',
        label: () => (bn ? 'শুরুর দেনা' : 'Starting debt'),
        hint: () => (bn
          ? 'কত দেনা নিয়ে শুরু করেছিলেন — হ্রাসের শতাংশ এখান থেকে হিসাব হয়।'
          : 'Where you started from — the reduction % is measured against this.'),
        read: async (db) => {
          const raw = await getSetting(db, 'startingDebtPaisa');
          if (!raw) return '';
          // Stored in paisa; shown and typed in taka.
          return String(Math.round(Number(raw) / 100));
        },
        write: async (db, value) => {
          let paisa = 0;
          try { paisa = parseTakaToPaisa(value); } catch { paisa = 0; }
          await setSetting(db, 'startingDebtPaisa', String(paisa));
        },
      },
    ];
  },

  async reminders(db, language) {
    const bn = language === 'bn';
    if ((await getSetting(db, 'remindersEnabled')) === '0') return [];
    const m = await metrics(db);
    const out = [];
    for (const b of m.portfolio.balances) {
      if (!b.nextDueDate || b.nextDuePaisa <= 0) continue;
      if (['COMPLETED', 'SETTLED', 'WRITTEN_OFF', 'CANCELLED'].includes(b.status)) continue;
      const isDebt = b.direction === 'DEBT';
      out.push({
        id: `debt:${b.accountId}:${b.nextDueDate.slice(0, 10)}`,
        title: bn ? (isDebt ? 'দেনা পরিশোধ' : 'পাওনা আদায়') : (isDebt ? 'Payment due' : 'Collection due'),
        body: formatPaisa(b.nextDuePaisa, { bnDigits: bn }),
        at: `${b.nextDueDate.slice(0, 10)}T09:00:00`,
        route: `/debt/account/${b.accountId}`,
      });
    }
    return out;
  },

  async search(db, query, language) {
    const bn = language === 'bn';
    const hits = await searchDebt(db, query);
    return hits.map((h) => ({
      id: h.accountId,
      title: h.title,
      subtitle: `${h.personName ? `${h.personName} · ` : ''}${formatPaisa(h.remainingPaisa, { bnDigits: bn })}`,
      route: `/debt/account/${h.accountId}`,
      icon: h.direction === 'DEBT' ? 'arrow-up-bold-circle-outline' : 'arrow-down-bold-circle-outline',
      tone: h.direction === 'DEBT' ? 'red' : 'green',
      weight: h.remainingPaisa,
    }));
  },

  facts: (db, language) => debtContextLines(db, language),

  /**
   * Words that mean a question is about money owed, in both languages. The assistant
   * reads these rather than carrying its own list, so a module added later brings its
   * own vocabulary instead of editing the assistant.
   */
  // ── what the debt module contributes to the shared month picture ──────────
  //
  // Obligations, not spending. A repayment is deliberately *not* reported as money going
  // out: most people also write the payment down as an expense, and counting it in both
  // places would make every month look twice as expensive as it was. What only this
  // module knows is how much *has* to be found this month, and how much of it already
  // has been — and those two numbers are what let the rest of the app reason about
  // whether the month can still afford an evening out.
  //
  // Only the current month is reported. The dashboard's figures are relative to today, so
  // claiming to know last March's obligations would be inventing them.
  async money(db, month) {
    const now = bangladeshMonthKey();
    if (month !== now) return null;
    const dashboard = await metrics(db);
    const goal = await getGoal(db, 'debt', 'REPAY', month);

    // The promise, if one was made, otherwise what is genuinely due — whichever is larger.
    // Someone who promised ৳3,000 but has ৳5,000 overdue is not in a ৳3,000 month.
    const owed = Math.max(goal?.targetPaisa ?? 0, dashboard.overduePaisa + dashboard.dueNext7Paisa);
    if (!owed && !dashboard.debtPaidThisMonthPaisa) return null;
    return {
      obligationPaisa: owed,
      obligationMetPaisa: dashboard.debtPaidThisMonthPaisa,
    };
  },

  // ── this module's opinion, given everyone's numbers ────────────────────────
  //
  // Note what it reads: `picture.headroomPaisa`, which is mostly made of numbers the
  // income module reported. This file imports nothing from that module and does not know
  // its name — which is what will let a salary, a harvest and a rent all count towards
  // the same sentence when those modules are written.
  async insights(db, picture, language) {
    const bn = language === 'bn';
    const out = [];
    const dashboard = await metrics(db);

    if (dashboard.overduePaisa > 0) {
      const canClear = picture.headroomPaisa >= dashboard.overduePaisa;
      out.push({
        id: 'debt-overdue',
        severity: 'RISK' as const,
        title: bn ? 'মেয়াদ পেরোনো কিস্তি আছে' : 'Something is already past due',
        detail: canClear
          ? (bn
            ? `${money(dashboard.overduePaisa, true)} বকেয়া — খরচের পর হাতে যা আছে তা দিয়ে আজই শোধ করা যায়।`
            : `${money(dashboard.overduePaisa, false)} is overdue — after spending, there is enough in hand to clear it today.`)
          : (bn
            ? `${money(dashboard.overduePaisa, true)} বকেয়া, কিন্তু খরচের পর হাতে আছে ${money(Math.max(0, picture.headroomPaisa), true)}।`
            : `${money(dashboard.overduePaisa, false)} is overdue, and only ${money(Math.max(0, picture.headroomPaisa), false)} is left after spending.`),
        route: '/debt',
        from: canClear ? ['debt', 'finance'] : ['debt', 'finance'],
        weight: 110,
      });
    }

    // A month with room and no promise made. Offering the number is the useful part —
    // "you could commit ৳X" is actionable in a way that "you have ৳X" is not.
    const goal = await getGoal(db, 'debt', 'REPAY', picture.month);
    if (!goal && dashboard.currentDebtPaisa > 0 && picture.headroomPaisa > 0) {
      out.push({
        id: 'debt-set-target',
        severity: 'INFO' as const,
        title: bn ? 'এ মাসে কত শোধ করবেন ঠিক করে নিন' : 'Decide what to repay this month',
        detail: bn
          ? `খরচের পর ${money(picture.headroomPaisa, true)} হাতে থাকছে। লক্ষ্য ঠিক করলে অ্যাপ সারা মাস মনে করিয়ে দেবে।`
          : `${money(picture.headroomPaisa, false)} is free after spending. Set a target and the app will keep it in front of you.`,
        route: '/finance',
        from: ['debt', 'finance'],
        weight: 45,
      });
    }

    return out;
  },

  // ── what this module has on, day by day ───────────────────────────────────
  //
  // Installments and their state. An installment already paid is reported as done rather
  // than left out: a day that quietly drops what you finished reads as an empty day, and
  // an empty day is not the same as a day you got through.
  async agenda(db, language, from, to) {
    const bn = language === 'bn';
    const rows = await db.getAllAsync<{
      id: string; account_id: string; due_date: string; amount_paisa: number;
      person_name: string; paid: number | null;
    }>(
      `SELECT i.id, i.account_id, i.due_date, i.amount_paisa, p.name AS person_name,
              (SELECT COALESCE(SUM(al.amount_paisa), 0)
                 FROM dr_allocations al
                 JOIN dr_transactions t ON t.id = al.transaction_id AND t.deleted_at IS NULL
                WHERE al.installment_id = i.id) AS paid
         FROM dr_installments i
         JOIN dr_accounts a ON a.id = i.account_id AND a.deleted_at IS NULL AND a.closed_at IS NULL
         JOIN people p ON p.id = a.person_id
        WHERE i.deleted_at IS NULL AND substr(i.due_date, 1, 10) BETWEEN ? AND ?
        ORDER BY i.due_date`,
      from, to,
    );

    // Local day, not UTC: before 6am Dhaka the UTC date is still yesterday, which marked
    // instalments overdue a day early on the agenda.
    const today = bangladeshDateKey(new Date());
    return rows.map((row) => {
      const day = row.due_date.slice(0, 10);
      const left = Math.max(0, row.amount_paisa - (row.paid ?? 0));
      const done = left === 0;
      const late = !done && day < today;
      return {
        id: `inst-${row.id}`,
        module: 'debt',
        kind: 'DUE' as const,
        day,
        title: bn ? `${row.person_name} — কিস্তি` : `${row.person_name} — installment`,
        subtitle: done
          ? (bn ? 'দেওয়া হয়েছে' : 'paid')
          : late ? (bn ? 'মেয়াদ পেরিয়েছে' : 'overdue') : undefined,
        amountPaisa: left,
        route: `/debt/account/${row.account_id}`,
        weight: late ? 100 : done ? 20 : 70,
        done,
      };
    });
  },

  // ── deleted accounts, and how to get one back ─────────────────────────────
  //
  // Accounts are soft-deleted, and until now that was worthless: the row was marked and
  // no screen ever showed it again. Deleting the wrong loan by mistake destroyed a year
  // of repayment history with no way back.
  async trash(db, language) {
    const bn = language === 'bn';
    const rows = await db.getAllAsync<{
      id: string; direction: string; title: string | null; principal_paisa: number;
      person_name: string; deleted_at: string;
    }>(
      `SELECT a.id, a.direction, a.title, a.principal_paisa, p.name AS person_name, a.deleted_at
         FROM dr_accounts a
         LEFT JOIN people p ON p.id = a.person_id
        WHERE a.deleted_at IS NOT NULL
        ORDER BY a.deleted_at DESC LIMIT 100`,
    );
    return rows.map((row) => ({
      id: row.id,
      module: 'debt',
      title: `${row.person_name ?? (bn ? 'নাম নেই' : 'no name')} · ${money(row.principal_paisa, bn)}`,
      subtitle: row.title?.trim() || (row.direction === 'RECEIVABLE' ? (bn ? 'পাওনা' : 'receivable') : (bn ? 'দেনা' : 'debt')),
      deletedAt: row.deleted_at,
      icon: 'wallet-outline' as const,
    }));
  },

  factKeywords: () => [
    'দেনা', 'পাওনা', 'ঋণ', 'ধার', 'কিস্তি', 'বাকি', 'পরিশোধ', 'শোধ', 'টাকা', 'সুদ', 'বকেয়া',
    'debt', 'loan', 'owe', 'owed', 'borrow', 'lend', 'lent', 'instalment', 'installment',
    'repay', 'due', 'outstanding', 'interest', 'balance',
  ],
};

// Restoring a debt is not "clear one column": the ledger, the schedule and the promises
// were all marked at the same instant and have to come back with it. Purging it is not one
// DELETE either, because every child row holds a foreign key into the account.
registerTrashHandlers('debt', { restore: restoreAccount, purge: purgeAccount });

registerModule(debtModule);
