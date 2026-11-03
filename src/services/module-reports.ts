// What each module's report actually says.
//
// One builder per module, all producing the same `ReportDocument` shape, so the printing,
// the layout and the share sheet stay in one place. Each of these reads the same functions
// the screens read — a report that computed its own totals would be a second opinion, and
// the whole point of a report is that it agrees with what you were just looking at.

import type { SQLiteDatabase } from 'expo-sqlite';
import { formatPaisa } from './debt/money';
import { bangladeshDateKey, bangladeshMonthKey, formatBangladeshDate, type AppLanguage } from '../i18n/date-time';
import { categoryBreakdown, listEntries, summariseMonth } from './finance-service';
import { walletBalances, totalOnHand } from './wallet-service';
import { getDashboardMetrics } from './debt/debt-service';
import { listLedger, listAccounts, listPeople } from './debt/repository';
import { txnKindLabel } from '../i18n/debt';
import { listMedicines, listVisits, listTests, medicalSpend, medicineStock } from './health-service';
import { getDailyPlan } from './planning-service';
import { personStanding } from './person-view-service';
import type { ReportDocument } from './report-service';
import { reportPeriod } from './report-service';

const money = (paisa: number, bn: boolean) => formatPaisa(paisa, { bnDigits: bn });
const day = (iso: string, language: AppLanguage) => {
  try { return formatBangladeshDate(iso, language); } catch { return iso.slice(0, 10); }
};

/** আয়-ব্যয় — what came in, what went out, and what is left where. */
export async function financeReport(db: SQLiteDatabase, language: AppLanguage, month = bangladeshMonthKey()): Promise<ReportDocument> {
  const bn = language === 'bn';
  const [summary, categories, wallets, entries, onHand] = await Promise.all([
    summariseMonth(db, month),
    categoryBreakdown(db, 'EXPENSE', month),
    walletBalances(db, true),
    listEntries(db, { month, limit: 300 }),
    totalOnHand(db),
  ]);

  const sections: ReportDocument['sections'] = [];

  if (wallets.length) {
    sections.push({
      heading: bn ? 'কোথায় কত আছে' : 'Where the money is',
      rows: wallets.map((w) => ({
        label: w.archivedAt ? `${w.name} ${bn ? '(বন্ধ)' : '(archived)'}` : w.name,
        value: money(w.balancePaisa, bn),
        muted: Boolean(w.archivedAt),
      })),
      note: bn ? `মোট হাতে ${money(onHand, bn)}` : `Total on hand ${money(onHand, bn)}`,
    });
  }

  if (categories.length) {
    sections.push({
      heading: bn ? 'কোন খাতে খরচ' : 'Where it went',
      table: {
        columns: [bn ? 'খাত' : 'Category', bn ? 'টাকা' : 'Amount', bn ? 'অংশ' : 'Share'],
        rows: categories.map((c) => [
          c.category,
          money(c.totalPaisa, bn),
          `${Math.round(c.share * 100)}%`,
        ]),
      },
    });
  }

  if (summary.debtInPaisa || summary.debtOutPaisa) {
    sections.push({
      heading: bn ? 'ঋণের চলাচল' : 'Debt movement',
      rows: [
        { label: bn ? 'ধার নেওয়া / আদায়' : 'Borrowed or collected', value: money(summary.debtInPaisa, bn) },
        { label: bn ? 'পরিশোধ / ধার দেওয়া' : 'Repaid or lent out', value: money(summary.debtOutPaisa, bn) },
      ],
      note: bn
        ? 'এই টাকা আয় বা ব্যয় নয় — মানিব্যাগে ধরা আছে, মাসের হিসাবে নয়।'
        : 'This is neither earned nor spent — the wallet counts it, the month does not.',
    });
  }

  if (entries.length) {
    sections.push({
      heading: bn ? 'প্রতিটি লেনদেন' : 'Every entry',
      table: {
        columns: [bn ? 'তারিখ' : 'Date', bn ? 'খাত' : 'Category', bn ? 'ধরন' : 'Type', bn ? 'টাকা' : 'Amount'],
        rows: entries.map((e) => [
          day(e.occurredAt, language),
          e.category,
          e.kind === 'INCOME' ? (bn ? 'আয়' : 'In') : (bn ? 'ব্যয়' : 'Out'),
          money(e.amountPaisa, bn),
        ]),
      },
    });
  }

  return {
    title: bn ? 'আয়-ব্যয়ের হিসাব' : 'Income and spending',
    subtitle: reportPeriod(language, { month }),
    highlights: [
      { label: bn ? 'আয়' : 'Income', value: money(summary.incomePaisa, bn) },
      { label: bn ? 'ব্যয়' : 'Spending', value: money(summary.expensePaisa, bn) },
      { label: bn ? 'বাকি' : 'Left', value: money(summary.netPaisa, bn) },
      { label: bn ? 'হাতে আছে' : 'On hand', value: money(onHand, bn) },
    ],
    sections,
  };
}

/** দেনা-পাওনা — who you owe, who owes you, and what is late. */
export async function debtReport(db: SQLiteDatabase, language: AppLanguage): Promise<ReportDocument> {
  const bn = language === 'bn';
  const [metrics, ledger, accounts, people] = await Promise.all([
    getDashboardMetrics(db),
    listLedger(db, { limit: 200 }),
    listAccounts(db),
    listPeople(db),
  ]);
  const { portfolio } = metrics;

  // A report exists to be read by someone, and an account id like "acc-1738…-a1b2" reads
  // to nobody. Every account belongs to a person, so the row says who — the title too,
  // when the account has one, since a person can carry more than one open account.
  const personName = new Map(people.map((p) => [p.id, p.name]));
  const accountLabel = new Map(accounts.map((a) => {
    const name = personName.get(a.personId) ?? (bn ? 'অজানা' : 'Unknown');
    return [a.id, a.title?.trim() ? `${name} · ${a.title.trim()}` : name];
  }));
  const labelFor = (accountId: string) => accountLabel.get(accountId) ?? accountId;

  const sections: ReportDocument['sections'] = [];

  const live = portfolio.balances.filter((b) => b.remainingPaisa > 0);
  if (live.length) {
    sections.push({
      heading: bn ? 'যা এখনো বাকি' : 'What is still owed',
      table: {
        columns: [
          bn ? 'যার সাথে' : 'Account',
          bn ? 'ধরন' : 'Kind',
          bn ? 'বাকি' : 'Remaining',
          bn ? 'দেরি' : 'Overdue',
        ],
        rows: live.map((b) => [
          labelFor(b.accountId),
          b.direction === 'DEBT' ? (bn ? 'দেনা' : 'Owe') : (bn ? 'পাওনা' : 'Owed to me'),
          money(b.remainingPaisa, bn),
          b.overduePaisa ? money(b.overduePaisa, bn) : '—',
        ]),
      },
    });
  }

  if (ledger.length) {
    sections.push({
      heading: bn ? 'লেনদেনের খতিয়ান' : 'The ledger',
      table: {
        // "PAYMENT" and an internal account id are not words anyone reads a statement to
        // see. Both are turned into what the rest of the app already calls them.
        columns: [bn ? 'তারিখ' : 'Date', bn ? 'যার সাথে' : 'With', bn ? 'ধরন' : 'Kind', bn ? 'টাকা' : 'Amount'],
        rows: ledger.slice(0, 120).map((t) => [
          day(t.txnDate, language),
          personName.get(t.personId) ?? labelFor(t.accountId),
          txnKindLabel(t.kind, language),
          money(t.amountPaisa, bn),
        ]),
      },
    });
  }

  return {
    title: bn ? 'দেনা-পাওনার হিসাব' : 'Debts and receivables',
    subtitle: reportPeriod(language),
    highlights: [
      { label: bn ? 'মোট দেনা' : 'You owe', value: money(portfolio.outstandingDebtPaisa, bn) },
      { label: bn ? 'মোট পাওনা' : 'Owed to you', value: money(portfolio.outstandingReceivablePaisa, bn) },
      { label: bn ? 'সব মিলিয়ে' : 'Overall', value: money(portfolio.netDebtPaisa, bn) },
      { label: bn ? 'বকেয়া' : 'Overdue', value: money(portfolio.overduePaisa, bn) },
    ],
    sections,
  };
}

/** স্বাস্থ্য — medicines, visits, tests, and what care cost. */
export async function healthReport(db: SQLiteDatabase, language: AppLanguage, month = bangladeshMonthKey()): Promise<ReportDocument> {
  const bn = language === 'bn';
  const [medicines, visits, tests, spend] = await Promise.all([
    listMedicines(db, { includeArchived: true }),
    listVisits(db, { limit: 60 }),
    listTests(db, { limit: 60 }),
    medicalSpend(db, `${month}-01`, `${month}-31`),
  ]);

  const sections: ReportDocument['sections'] = [];

  if (medicines.length) {
    sections.push({
      heading: bn ? 'ওষুধ' : 'Medicines',
      table: {
        columns: [
          bn ? 'নাম' : 'Name', bn ? 'কেন' : 'For',
          bn ? 'দিনে' : 'Per day', bn ? 'বাকি' : 'Left',
        ],
        rows: medicines.map((m) => {
          const stock = medicineStock(m);
          return [
            m.archivedAt ? `${m.name} (${bn ? 'বন্ধ' : 'stopped'})` : m.name,
            m.reason ?? '—',
            String(m.timesPerDay),
            m.totalUnits ? String(stock.remainingUnits) : '—',
          ];
        }),
      },
    });
  }

  if (visits.length) {
    sections.push({
      heading: bn ? 'ডাক্তার দেখানো' : 'Doctor visits',
      table: {
        columns: [bn ? 'তারিখ' : 'Date', bn ? 'ডাক্তার' : 'Doctor', bn ? 'কী বলেছেন' : 'Diagnosis', bn ? 'খরচ' : 'Cost'],
        rows: visits.map((v) => [
          day(v.visitedOn, language), v.doctor, v.diagnosis ?? '—',
          money(v.feePaisa + v.extraPaisa, bn),
        ]),
      },
    });
  }

  if (tests.length) {
    sections.push({
      heading: bn ? 'পরীক্ষা' : 'Tests',
      table: {
        columns: [bn ? 'তারিখ' : 'Date', bn ? 'পরীক্ষা' : 'Test', bn ? 'ফল' : 'Result', bn ? 'খরচ' : 'Cost'],
        rows: tests.map((t) => [day(t.testedOn, language), t.name, t.result ?? '—', money(t.costPaisa, bn)]),
      },
    });
  }

  if (spend.byCategory.length) {
    sections.push({
      heading: bn ? 'এই মাসে চিকিৎসার খরচ' : 'Medical spending this month',
      rows: spend.byCategory.map((c) => ({ label: c.category, value: money(c.totalPaisa, bn) })),
      note: bn
        ? 'এই টাকা মাসের মোট ব্যয়ের ভেতরেই আছে — আলাদা করে আবার গোনা হয় না।'
        : 'This money is inside the month’s total spending, not counted again on top of it.',
    });
  }

  return {
    title: bn ? 'স্বাস্থ্যের হিসাব' : 'Health record',
    subtitle: reportPeriod(language, { month }),
    highlights: [
      { label: bn ? 'ওষুধ' : 'Medicines', value: String(medicines.filter((m) => !m.archivedAt).length) },
      { label: bn ? 'ডাক্তার' : 'Visits', value: String(visits.length) },
      { label: bn ? 'পরীক্ষা' : 'Tests', value: String(tests.length) },
      { label: bn ? 'এই মাসে খরচ' : 'Cost this month', value: money(spend.totalPaisa, bn) },
    ],
    sections,
  };
}

/** পরিকল্পনা — what is due, what is late, and what is waiting. */
export async function planningReport(db: SQLiteDatabase, language: AppLanguage): Promise<ReportDocument> {
  const bn = language === 'bn';
  const plan = await getDailyPlan(db);
  const sections: ReportDocument['sections'] = [];

  const asRows = (items: typeof plan.scheduled) => items.map((t) => [
    t.title,
    t.priority,
    t.dueAt ? day(t.dueAt, language) : t.plannedDate ? day(t.plannedDate, language) : '—',
  ]);
  const columns = [bn ? 'কাজ' : 'Task', bn ? 'গুরুত্ব' : 'Priority', bn ? 'কবে' : 'When'];

  if (plan.overdue.length) sections.push({ heading: bn ? 'দেরি হয়ে গেছে' : 'Overdue', table: { columns, rows: asRows(plan.overdue) } });
  if (plan.scheduled.length) sections.push({ heading: bn ? 'আজকের কাজ' : 'Today', table: { columns, rows: asRows(plan.scheduled) } });
  if (plan.inbox.length) sections.push({ heading: bn ? 'ইনবক্সে অপেক্ষায়' : 'Waiting in the inbox', table: { columns, rows: asRows(plan.inbox) } });

  return {
    title: bn ? 'কাজের পরিকল্পনা' : 'Task plan',
    subtitle: reportPeriod(language, { asOf: new Date(`${bangladeshDateKey(new Date())}T12:00:00.000Z`) }),
    highlights: [
      { label: bn ? 'দেরি' : 'Overdue', value: String(plan.overdue.length) },
      { label: bn ? 'আজ' : 'Today', value: String(plan.scheduled.length) },
      { label: bn ? 'ইনবক্স' : 'Inbox', value: String(plan.inbox.length) },
    ],
    sections,
  };
}

/**
 * One person, everything at once.
 *
 * The question this answers is the one people actually ask about someone: "where do I
 * stand with them" — money in both directions, the accounts still open, and every
 * dealing in date order. Built from `personStanding`, which reads the debt ledger's own
 * rows, so the report and the person's screen can never quote different figures.
 */
export async function personReport(db: SQLiteDatabase, language: AppLanguage, personId: string): Promise<ReportDocument> {
  const bn = language === 'bn';
  const standing = await personStanding(db, personId);
  if (!standing) {
    return { title: bn ? 'ব্যক্তি' : 'Person', sections: [] };
  }

  const sections: ReportDocument['sections'] = [];
  const p = standing.person;

  const details: { label: string; value: string }[] = [];
  if (p.phone) details.push({ label: bn ? 'ফোন' : 'Phone', value: p.phone });
  if (p.relationship) details.push({ label: bn ? 'সম্পর্ক' : 'Relationship', value: p.relationship });
  if (p.address) details.push({ label: bn ? 'ঠিকানা' : 'Address', value: p.address });
  if (p.notes) details.push({ label: bn ? 'নোট' : 'Note', value: p.notes });
  if (details.length) sections.push({ heading: bn ? 'পরিচয়' : 'Details', rows: details });

  sections.push({
    heading: bn ? 'টাকার অবস্থান' : 'Where the money stands',
    rows: [
      { label: bn ? 'উনি আপনাকে দেবেন' : 'They owe you', value: money(standing.theyOwePaisa, bn) },
      { label: bn ? 'আপনি ওনাকে দেবেন' : 'You owe them', value: money(standing.youOwePaisa, bn) },
      { label: bn ? 'হাতে পেয়েছেন' : 'Received from them', value: money(standing.receivedPaisa, bn), muted: true },
      { label: bn ? 'দিয়েছেন' : 'Given to them', value: money(standing.givenPaisa, bn), muted: true },
    ],
    note: standing.openAccounts
      ? (bn ? `${standing.openAccounts}টি হিসাব এখনো খোলা।` : `${standing.openAccounts} account(s) still open.`)
      : (bn ? 'কোনো হিসাব খোলা নেই।' : 'No open accounts.'),
  });

  if (standing.events.length) {
    sections.push({
      heading: bn ? 'যা যা হয়েছে' : 'Every dealing',
      table: {
        columns: [bn ? 'তারিখ' : 'Date', bn ? 'কী' : 'What', bn ? 'টাকা' : 'Amount'],
        rows: standing.events.slice(0, 150).map((e) => [
          day(e.at, language),
          e.title,
          e.amountPaisa ? money(e.amountPaisa, bn) : '—',
        ]),
      },
    });
  }

  return {
    title: p.name,
    subtitle: reportPeriod(language),
    highlights: [
      { label: bn ? 'সব মিলিয়ে' : 'Overall', value: money(standing.netPaisa, bn) },
      { label: bn ? 'খোলা হিসাব' : 'Open accounts', value: String(standing.openAccounts) },
      { label: bn ? 'যোগাযোগ' : 'Contacts', value: String(standing.contactCount) },
    ],
    sections,
  };
}
