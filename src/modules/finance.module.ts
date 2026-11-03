// আয়-ব্যয়, declared.
//
// The module owns one table and borrows everything else — people, attachments, places,
// money formatting, the reminder screen, the settings screen. Nothing here knows about
// Home, search or the assistant; those read this declaration, which is the whole point of
// the register.

import {
  budgetStatus,
  categoryBreakdown,
  dueAgain,
  listEntries,
  monthKey,
  purgeEntry,
  restoreEntry,
  setBudget,
  spendingByNeed,
  summariseMonth,
} from '../services/finance-service';
import { asciiDigitsToBengali, formatPaisa } from '../services/debt/money';
import { registerModule, type AppModule } from './registry';
import { registerTrashHandlers } from '../services/trash-registry';

const money = (paisa: number, bn: boolean) => formatPaisa(paisa, { bnDigits: bn });
const digits = (value: string | number, bn: boolean) => (bn ? asciiDigitsToBengali(String(value)) : String(value));

/** "সেপ্টেম্বর" — a month the way it is said, not "2026-09". */
const MONTHS_BN = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (key: string, bn: boolean): string => {
  const index = Number(key.slice(5, 7)) - 1;
  return (bn ? MONTHS_BN : MONTHS_EN)[index] ?? key;
};

export const financeModule: AppModule = {
  id: 'finance',
  route: '/finance',
  icon: 'swap-vertical',
  activeIcon: 'swap-vertical',
  tone: 'green',
  inPrimaryNav: true,
  defaultEnabled: true,
  title: (language) => (language === 'bn' ? 'আয়-ব্যয়' : 'Money in & out'),
  description: (language) =>
    language === 'bn'
      ? 'কী এল আর কী গেল — মাস শেষে হাতে কত থাকল তার হিসাব।'
      : 'What came in and what went out, and what was left at the end of the month.',

  // ── Home ───────────────────────────────────────────────────────────────────
  //
  // One line, and it is the line that changes behaviour: what is left this month. A
  // negative number outranks everything, because that is the month someone needs to know
  // about before they spend again.
  async homeLine(db, language) {
    const bn = language === 'bn';
    const summary = await summariseMonth(db);
    if (!summary.entryCount) return null;
    const overspent = summary.netPaisa < 0;
    return {
      label: bn ? `${monthName(summary.month, true)} মাসে` : `In ${monthName(summary.month, false)}`,
      value: overspent
        ? (bn ? `${money(-summary.netPaisa, true)} বেশি খরচ` : `${money(-summary.netPaisa, false)} over`)
        : (bn ? `${money(summary.netPaisa, true)} বাকি` : `${money(summary.netPaisa, false)} left`),
      hint: bn
        ? `আয় ${money(summary.incomePaisa, true)} · ব্যয় ${money(summary.expensePaisa, true)}`
        : `In ${money(summary.incomePaisa, false)} · out ${money(summary.expensePaisa, false)}`,
      route: '/finance',
      icon: overspent ? 'trending-down' : 'swap-vertical',
      weight: overspent ? 78 : 44,
      tone: overspent ? 'orange' : 'green',
    };
  },

  // ── Settings, which live in Settings ───────────────────────────────────────
  // No settings offered: "month starts on" and "monthly spending limit" used to be here but
  // nothing ever read them (every figure counts from the 1st; no Home warning read the
  // limit). Stored values are left untouched. Doing them properly is v1.1 — NEXT_VERSION.md.

  // ── what this module has asked to be reminded about ───────────────────────
  //
  // Only things that repeat monthly and have not been written down yet this month. The
  // reminder is a nudge to record what has happened, never a claim that it has: an
  // electricity bill the app announced as paid, when it was not, would be a lie the
  // ledger then carried forward all year.
  async reminders(db, language) {
    const bn = language === 'bn';
    const waiting = await dueAgain(db);
    if (!waiting.length) return [];

    const now = new Date();
    return waiting.slice(0, 5).map((entry) => {
      // The day of the month it usually falls on, in the month being lived.
      const day = Number(entry.occurredAt.slice(8, 10));
      const at = new Date(now.getFullYear(), now.getMonth(), Math.min(day, 28), 9, 0, 0);
      return {
        id: `fin:${entry.id}`,
        title: bn ? `${entry.category} — লিখে রেখেছেন?` : `${entry.category} — written down yet?`,
        body: bn
          ? `সাধারণত এই সময়ে ${money(entry.amountPaisa, true)} হয়।`
          : `Usually about ${money(entry.amountPaisa, false)} around now.`,
        at: at.toISOString(),
        route: '/finance',
      };
    });
  },

  // ── search ─────────────────────────────────────────────────────────────────
  async search(db, query, language) {
    const bn = language === 'bn';
    // People remember amounts. "৫০০০" or "5000" finds every entry for that sum, which is
    // often the only thing they can recall about a payment months later.
    const asDigits = asciiDigitsToBengali(query.trim()) === query.trim()
      ? query.trim().replace(/[০-৯]/gu, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
      : query.trim();
    const amount = Number(asDigits.replace(/[^\d.]/gu, ''));
    const entries = Number.isFinite(amount) && amount > 0
      ? await db.getAllAsync<never>('SELECT 1').then(async () => {
          const byAmount = await listEntries(db, { search: query, limit: 12 });
          const exact = await listEntries(db, { limit: 200 });
          const matches = exact.filter((e) => Math.round(e.amountPaisa / 100) === Math.round(amount));
          const seen = new Set(matches.map((e) => e.id));
          return [...matches, ...byAmount.filter((e) => !seen.has(e.id))].slice(0, 12);
        })
      : await listEntries(db, { search: query, limit: 12 });
    return entries.map((entry) => ({
      id: entry.id,
      title: `${entry.kind === 'INCOME' ? (bn ? 'আয়' : 'In') : (bn ? 'ব্যয়' : 'Out')} · ${money(entry.amountPaisa, bn)}`,
      subtitle: [entry.category, entry.personName, entry.note].filter(Boolean).join(' · '),
      route: `/finance/entry/${entry.id}`,
      icon: entry.kind === 'INCOME' ? 'arrow-down' : 'arrow-up',
      tone: entry.kind === 'INCOME' ? 'green' : 'orange',
      weight: 40,
    }));
  },

  // ── what the assistant may quote ───────────────────────────────────────────
  async facts(db, language) {
    const bn = language === 'bn';
    const summary = await summariseMonth(db);
    if (!summary.entryCount) return [];
    const out = [
      bn
        ? `এই মাসে আয় ${money(summary.incomePaisa, true)}, ব্যয় ${money(summary.expensePaisa, true)}, বাকি ${money(summary.netPaisa, true)}।`
        : `This month: in ${money(summary.incomePaisa, false)}, out ${money(summary.expensePaisa, false)}, left ${money(summary.netPaisa, false)}.`,
    ];
    const top = (await categoryBreakdown(db, 'EXPENSE')).slice(0, 3);
    if (top.length) {
      out.push(bn
        ? `সবচেয়ে বেশি খরচ: ${top.map((t) => `${t.category} ${money(t.totalPaisa, true)}`).join(', ')}।`
        : `Largest spending: ${top.map((t) => `${t.category} ${money(t.totalPaisa, false)}`).join(', ')}.`);
    }
    const over = (await budgetStatus(db)).filter((b) => b.ratio > 1);
    if (over.length) {
      out.push(bn
        ? `সীমা ছাড়িয়েছে: ${over.map((b) => b.category).join(', ')}।`
        : `Over budget: ${over.map((b) => b.category).join(', ')}.`);
    }
    return out;
  },

  // ── what this module contributes to the shared month picture ───────────────
  //
  // Four numbers in the app's common money language. Nothing here knows a debt module
  // exists; the totals are simply added to whatever else reports money.
  async money(db, month) {
    const [summary, split] = await Promise.all([summariseMonth(db, month), spendingByNeed(db, month)]);
    if (!summary.entryCount) return null;
    return {
      inPaisa: summary.incomePaisa,
      outPaisa: summary.expensePaisa,
      discretionaryPaisa: split.wantPaisa,
    };
  },

  // ── this module's own opinion, given everyone's numbers ────────────────────
  async insights(db, picture, language) {
    const bn = language === 'bn';
    const out = [];

    // A budget the user set for a single category, now overspent. Only finance can say
    // this, because only finance knows what the limits were.
    const over = (await budgetStatus(db, picture.month)).filter((b) => b.ratio > 1);
    if (over.length) {
      const worst = over[0]!;
      out.push({
        id: 'budget-over',
        severity: 'WATCH' as const,
        title: bn ? `${worst.category} খাতে সীমা পেরিয়েছে` : `Over the limit on ${worst.category}`,
        detail: bn
          ? `সীমা ছিল ${money(worst.limitPaisa, true)}, খরচ ${money(worst.spentPaisa, true)}${over.length > 1 ? ` · আরও ${digits(over.length - 1, true)}টি খাতেও` : ''}।`
          : `The limit was ${money(worst.limitPaisa, false)} and ${money(worst.spentPaisa, false)} has gone${over.length > 1 ? `, plus ${over.length - 1} more` : ''}.`,
        route: '/finance',
        from: ['finance'],
        weight: 72,
      });
    }

    // Things that repeat and have not been written down yet this month. A reminder, not
    // an entry: money that has not moved is not money the ledger may claim moved.
    const waiting = await dueAgain(db, picture.month);
    if (waiting.length) {
      out.push({
        id: 'recurring-waiting',
        severity: 'INFO' as const,
        title: bn ? 'নিয়মিত হিসাবগুলো এ মাসে লেখা হয়নি' : 'Regular entries not written yet',
        detail: bn
          ? `${waiting.slice(0, 3).map((e) => e.category).join(', ')} — সাধারণত প্রতি মাসেই থাকে।`
          : `${waiting.slice(0, 3).map((e) => e.category).join(', ')} — usually there every month.`,
        route: '/finance',
        from: ['finance'],
        weight: 38,
      });
    }

    return out;
  },

  // ── what this module expects, day by day ──────────────────────────────────
  //
  // Only things that repeat, and only as an expectation. Rent that has not been paid is
  // not an expense yet, so it is never written into the ledger on the app's initiative —
  // it appears on the day it usually falls, marked as expected, and stays that way until
  // the person writes it down themselves.
  async agenda(db, language, from, to) {
    const bn = language === 'bn';
    const rows = await db.getAllAsync<{
      id: string; kind: string; category: string; amount_paisa: number; occurred_at: string; recurring: string;
    }>(
      `SELECT id, kind, category, amount_paisa, occurred_at, recurring
         FROM fin_entries
        WHERE deleted_at IS NULL AND recurring IS NOT NULL AND recurring = 'MONTHLY'
        GROUP BY category, kind
        ORDER BY occurred_at DESC
        LIMIT 20`,
    );
    if (!rows.length) return [];

    // The day of the month it usually falls on, projected into the range being shown.
    const out = [];
    const months = new Set<string>();
    const cursor = new Date(`${from}T12:00:00Z`);
    const end = new Date(`${to}T12:00:00Z`);
    while (cursor <= end) {
      months.add(cursor.toISOString().slice(0, 7));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    for (const row of rows) {
      const dayOfMonth = row.occurred_at.slice(8, 10);
      for (const month of months) {
        const day = `${month}-${dayOfMonth}`;
        if (day < from || day > to) continue;
        // Already written down for that month? Then it is history, not an expectation.
        const written = await db.getFirstAsync<{ n: number }>(
          `SELECT COUNT(*) AS n FROM fin_entries
            WHERE deleted_at IS NULL AND category = ? AND kind = ?
              AND substr(occurred_at, 1, 7) = ?`,
          row.category, row.kind, month,
        );
        if ((written?.n ?? 0) > 0) continue;
        out.push({
          id: `exp-${row.id}-${month}`,
          module: 'finance',
          kind: 'EXPECTED' as const,
          day,
          title: row.category,
          subtitle: bn ? 'সাধারণত এই সময়ে হয়' : 'usually about now',
          amountPaisa: row.amount_paisa,
          route: '/finance',
          weight: 40,
        });
      }
    }
    return out;
  },

  // ── what has been thrown away, and how to get it back ─────────────────────
  //
  // Entries are soft-deleted, which is worthless on its own: without this the row is
  // marked deleted and no screen ever shows it again. A grocery bill deleted by mistake
  // was simply gone.
  async trash(db, language) {
    const bn = language === 'bn';
    const rows = await db.getAllAsync<{
      id: string; kind: string; amount_paisa: number; category: string; occurred_at: string; deleted_at: string;
    }>(
      `SELECT id, kind, amount_paisa, category, occurred_at, deleted_at
         FROM fin_entries WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200`,
    );
    return rows.map((row) => ({
      id: row.id,
      module: 'finance',
      title: `${row.kind === 'INCOME' ? (bn ? 'আয়' : 'In') : (bn ? 'ব্যয়' : 'Out')} · ${money(row.amount_paisa, bn)}`,
      subtitle: `${row.category} · ${row.occurred_at.slice(0, 10)}`,
      deletedAt: row.deleted_at,
      icon: row.kind === 'INCOME' ? 'arrow-down' : 'arrow-up',
    }));
  },

  factKeywords: () => [
    'আয়', 'ব্যয়', 'খরচ', 'income', 'expense', 'spend', 'spending', 'budget', 'বাজেট',
    'বাজার', 'বেতন', 'salary', 'সঞ্চয়', 'saving', 'টাকা', 'money', 'মাস', 'month',
  ],
};

export { monthKey, setBudget };
registerModule(financeModule);

// Without this the generic trash restore was a bare `UPDATE fin_entries SET deleted_at =
// NULL WHERE id = ?` — the wallet-transfer twin stayed gone and the life event this entry
// carried the story for never came back. Same reasoning as debt.module.ts's own
// registration: an operation this module's schema makes non-trivial belongs with the
// module that understands why.
registerTrashHandlers('finance', { restore: restoreEntry, purge: purgeEntry });
