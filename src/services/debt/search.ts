// Making the debt module findable.
//
// Everything in `dr_` was invisible to the app's own search and to the assistant: asking
// "রহিমকে কত দিতে হবে?" returned nothing while the answer sat two tables away. This file
// is the bridge — a keyword search over accounts and people, and a compact set of facts
// the question-answering layer can quote from.
//
// Read-only. Nothing here writes, so wiring it into more places stays cheap and safe.

import type { SQLiteDatabase } from 'expo-sqlite';
import { getPortfolio } from './debt-service';
import { formatPaisa } from './money';
import type { AppLanguage } from '../../i18n/date-time';
import type { AccountBalance, Account, Person } from './types';

export interface DebtSearchHit {
  accountId: string;
  title: string;
  personName: string;
  direction: 'DEBT' | 'RECEIVABLE';
  remainingPaisa: number;
  status: string;
  nextDueDate: string | null;
  /** Which part of the row matched, so the UI can say why this is here. */
  matchedOn: 'title' | 'person' | 'purpose' | 'note';
}

function haystack(a: Account, personName: string): { field: DebtSearchHit['matchedOn']; text: string }[] {
  return [
    { field: 'title', text: a.title ?? '' },
    { field: 'person', text: personName },
    { field: 'purpose', text: a.purpose ?? '' },
    { field: 'note', text: a.notes ?? '' },
  ];
}

/**
 * Accounts matching a free-text query, most-owed first. Closed accounts are included but
 * sort last — searching for a name you settled last year should still find the record.
 */
export async function searchDebt(db: SQLiteDatabase, query: string, limit = 20): Promise<DebtSearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const { accounts, balances, people } = await getPortfolio(db);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const balById = new Map(balances.map((b) => [b.accountId, b]));

  const hits: DebtSearchHit[] = [];
  for (const a of accounts) {
    const personName = nameById.get(a.personId) ?? '';
    const match = haystack(a, personName).find((h) => h.text.toLowerCase().includes(q));
    if (!match) continue;
    const b = balById.get(a.id);
    hits.push({
      accountId: a.id,
      title: a.title || personName || a.id,
      personName,
      direction: a.direction,
      remainingPaisa: b?.remainingPaisa ?? 0,
      status: b?.status ?? a.status,
      nextDueDate: b?.nextDueDate ?? null,
      matchedOn: match.field,
    });
  }
  return hits
    .sort((x, y) => Number(y.remainingPaisa > 0) - Number(x.remainingPaisa > 0) || y.remainingPaisa - x.remainingPaisa)
    .slice(0, limit);
}

export interface DebtFacts {
  outstandingDebtPaisa: number;
  outstandingReceivablePaisa: number;
  netDebtPaisa: number;
  overduePaisa: number;
  overdueCount: number;
  activeDebtCount: number;
  activeReceivableCount: number;
  nextDue: { title: string; personName: string; dueDate: string; amountPaisa: number } | null;
  /** Per-person net position, biggest first — "who do I owe most?" answered directly. */
  byPerson: { personName: string; owePaisa: number; owedPaisa: number }[];
}

export async function getDebtFacts(db: SQLiteDatabase, asOf = new Date().toISOString()): Promise<DebtFacts> {
  const portfolio = await getPortfolio(db, { asOf });
  const nameById = new Map(portfolio.people.map((p: Person) => [p.id, p.name]));
  const accById = new Map(portfolio.accounts.map((a) => [a.id, a]));

  const perPerson = new Map<string, { owePaisa: number; owedPaisa: number }>();
  let nextDue: DebtFacts['nextDue'] = null;

  for (const b of portfolio.balances as AccountBalance[]) {
    const acc = accById.get(b.accountId);
    if (!acc) continue;
    const personName = nameById.get(acc.personId) ?? '';
    const entry = perPerson.get(personName) ?? { owePaisa: 0, owedPaisa: 0 };
    if (b.direction === 'DEBT') entry.owePaisa += b.remainingPaisa;
    else entry.owedPaisa += b.remainingPaisa;
    perPerson.set(personName, entry);

    if (b.direction === 'DEBT' && b.nextDueDate && b.nextDuePaisa > 0) {
      if (!nextDue || b.nextDueDate < nextDue.dueDate) {
        nextDue = { title: acc.title || personName, personName, dueDate: b.nextDueDate.slice(0, 10), amountPaisa: b.nextDuePaisa };
      }
    }
  }

  return {
    outstandingDebtPaisa: portfolio.outstandingDebtPaisa,
    outstandingReceivablePaisa: portfolio.outstandingReceivablePaisa,
    netDebtPaisa: portfolio.netDebtPaisa,
    overduePaisa: portfolio.overduePaisa,
    overdueCount: portfolio.overdueCount,
    activeDebtCount: portfolio.activeDebtCount,
    activeReceivableCount: portfolio.activeReceivableCount,
    nextDue,
    byPerson: [...perPerson.entries()]
      .map(([personName, v]) => ({ personName, ...v }))
      .filter((p) => p.owePaisa > 0 || p.owedPaisa > 0)
      .sort((a, b) => (b.owePaisa + b.owedPaisa) - (a.owePaisa + a.owedPaisa)),
  };
}

/**
 * The debt picture as a handful of plain sentences, for the assistant to draw on.
 *
 * Deliberately short: this is added to a prompt alongside memories and tasks, so it has to
 * earn its tokens. Nothing is included when there is nothing owed either way.
 */
export async function debtContextLines(db: SQLiteDatabase, language: AppLanguage = 'bn'): Promise<string[]> {
  const bn = language === 'bn';
  const f = await getDebtFacts(db);
  if (f.outstandingDebtPaisa === 0 && f.outstandingReceivablePaisa === 0) return [];
  const money = (p: number) => formatPaisa(p, { bnDigits: bn, symbol: true });
  const out: string[] = [];

  if (f.outstandingDebtPaisa > 0) {
    out.push(bn
      ? `মোট দেনা ${money(f.outstandingDebtPaisa)} (${f.activeDebtCount}টি হিসাবে)।`
      : `Total debt is ${money(f.outstandingDebtPaisa)} across ${f.activeDebtCount} accounts.`);
  }
  if (f.outstandingReceivablePaisa > 0) {
    out.push(bn
      ? `মোট পাওনা ${money(f.outstandingReceivablePaisa)} (${f.activeReceivableCount}টি হিসাবে)।`
      : `Total owed to you is ${money(f.outstandingReceivablePaisa)} across ${f.activeReceivableCount} accounts.`);
  }
  if (f.overduePaisa > 0) {
    out.push(bn
      ? `সময় পেরোনো ${money(f.overduePaisa)}, ${f.overdueCount}টি হিসাবে।`
      : `${money(f.overduePaisa)} is overdue across ${f.overdueCount} accounts.`);
  }
  if (f.nextDue) {
    out.push(bn
      ? `পরবর্তী কিস্তি ${f.nextDue.dueDate} তারিখে — ${f.nextDue.title}, ${money(f.nextDue.amountPaisa)}।`
      : `Next payment due ${f.nextDue.dueDate}: ${f.nextDue.title}, ${money(f.nextDue.amountPaisa)}.`);
  }
  for (const p of f.byPerson.slice(0, 5)) {
    if (!p.personName) continue;
    if (p.owePaisa > 0) {
      out.push(bn ? `${p.personName}-কে দিতে হবে ${money(p.owePaisa)}।` : `You owe ${p.personName} ${money(p.owePaisa)}.`);
    }
    if (p.owedPaisa > 0) {
      out.push(bn ? `${p.personName}-এর কাছে পাওনা ${money(p.owedPaisa)}।` : `${p.personName} owes you ${money(p.owedPaisa)}.`);
    }
  }
  return out;
}
