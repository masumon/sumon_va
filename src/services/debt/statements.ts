// Statements (spec §79-§81). A person statement rolls every account they are party to
// into one opening → movement → closing view; an account statement is the single-loan
// detail. Both read through debt-service so the numbers match the dashboard exactly.

import type { SQLiteDatabase } from 'expo-sqlite';
import { getAccountView, getPortfolio } from './debt-service';
import { localDayKey } from './derive';
import * as repo from './repository';
import type { Paisa } from './money';
import { formatPaisa } from './money';
import { methodLabel, txnKindLabel } from '../../i18n/debt';
import type { AppLanguage } from '../../i18n/date-time';
import type { Account, AccountBalance, Person, Transaction } from './types';

export interface PersonStatement {
  person: Person;
  accounts: { account: Account; balance: AccountBalance }[];
  totalDebtRemainingPaisa: Paisa;
  totalReceivableRemainingPaisa: Paisa;
  /** > 0 means the person owes you more than you owe them */
  netToYouPaisa: Paisa;
  totalPaidToThemPaisa: Paisa;
  totalReceivedFromThemPaisa: Paisa;
  transactions: Transaction[];
  lastTransactionDate: string | null;
  nextDueDate: string | null;
}

export async function getPersonStatement(db: SQLiteDatabase, personId: string, asOf = new Date().toISOString()): Promise<PersonStatement | null> {
  const person = await repo.getPerson(db, personId);
  if (!person) return null;
  const accounts = await repo.listAccounts(db, { personId });
  const rows: { account: Account; balance: AccountBalance }[] = [];
  const allTxns: Transaction[] = [];
  for (const a of accounts) {
    const view = await getAccountView(db, a.id, asOf);
    rows.push({ account: a, balance: view.balance });
    allTxns.push(...view.transactions);
  }
  allTxns.sort((x, y) => (x.txnDate < y.txnDate ? 1 : -1));

  let totalDebtRemainingPaisa = 0, totalReceivableRemainingPaisa = 0, totalPaidToThemPaisa = 0, totalReceivedFromThemPaisa = 0;
  let nextDueDate: string | null = null;
  for (const r of rows) {
    if (r.account.direction === 'DEBT') { totalDebtRemainingPaisa += r.balance.remainingPaisa; totalPaidToThemPaisa += r.balance.paidPaisa; }
    else { totalReceivableRemainingPaisa += r.balance.remainingPaisa; totalReceivedFromThemPaisa += r.balance.paidPaisa; }
    if (r.balance.nextDueDate && (!nextDueDate || r.balance.nextDueDate < nextDueDate)) nextDueDate = r.balance.nextDueDate;
  }
  return {
    person,
    accounts: rows,
    totalDebtRemainingPaisa,
    totalReceivableRemainingPaisa,
    netToYouPaisa: totalReceivableRemainingPaisa - totalDebtRemainingPaisa,
    totalPaidToThemPaisa,
    totalReceivedFromThemPaisa,
    transactions: allTxns,
    lastTransactionDate: allTxns[0]?.txnDate ?? null,
    nextDueDate,
  };
}

/**
 * A person statement as plain shareable text.
 *
 * This is the thing people actually need from a hand loan — "here is what we agreed, here
 * is what has been paid" — and until now the numbers existed only inside the app. Plain
 * text on purpose: it pastes into WhatsApp, SMS or a note without a viewer, an attachment
 * or a network round trip, which suits a module that is entirely offline.
 */
export function formatPersonStatement(st: PersonStatement, language: AppLanguage = 'bn'): string {
  const bn = language === 'bn';
  const money = (p: Paisa) => formatPaisa(p, { bnDigits: bn });
  const lines: string[] = [];

  lines.push(bn ? `হিসাব — ${st.person.name}` : `Statement — ${st.person.name}`);
  lines.push(bn ? `তারিখ: ${localDayKey(new Date().toISOString())}` : `As of: ${localDayKey(new Date().toISOString())}`);
  lines.push('');

  for (const { account, balance } of st.accounts) {
    const dir = account.direction === 'DEBT'
      ? (bn ? 'আমার দেনা' : 'I owe')
      : (bn ? 'আমার পাওনা' : 'Owed to me');
    lines.push(`${account.title || dir} — ${dir}`);
    lines.push(`  ${bn ? 'মূল' : 'Principal'}: ${money(balance.principalPaisa)}`);
    if (balance.accruedInterestPaisa > 0) lines.push(`  ${bn ? 'সুদ' : 'Interest'}: ${money(balance.accruedInterestPaisa)}`);
    lines.push(`  ${bn ? 'পরিশোধিত' : 'Paid'}: ${money(balance.paidPaisa)}`);
    lines.push(`  ${bn ? 'বাকি' : 'Remaining'}: ${money(balance.remainingPaisa)}`);
    if (balance.nextDueDate) lines.push(`  ${bn ? 'পরবর্তী কিস্তি' : 'Next due'}: ${balance.nextDueDate.slice(0, 10)} · ${money(balance.nextDuePaisa)}`);
    lines.push('');
  }

  lines.push(bn ? '— সারসংক্ষেপ —' : '— Summary —');
  lines.push(`${bn ? 'মোট দেনা' : 'Total I owe'}: ${money(st.totalDebtRemainingPaisa)}`);
  lines.push(`${bn ? 'মোট পাওনা' : 'Total owed to me'}: ${money(st.totalReceivableRemainingPaisa)}`);
  lines.push(
    st.netToYouPaisa >= 0
      ? `${bn ? 'সব মিলিয়ে — আমি পাব' : 'Net — owed to me'}: ${money(st.netToYouPaisa)}`
      : `${bn ? 'সব মিলিয়ে — আমি দেব' : 'Net — I owe'}: ${money(-st.netToYouPaisa)}`,
  );

  const recent = st.transactions.slice(0, 15);
  if (recent.length) {
    lines.push('');
    lines.push(bn ? '— সাম্প্রতিক লেনদেন —' : '— Recent transactions —');
    for (const t of recent) {
      if (t.reversed) continue;
      const method = t.method ? ` (${methodLabel(t.method, language)})` : '';
      lines.push(`${t.txnDate.slice(0, 10)}  ${txnKindLabel(t.kind, language)}  ${money(t.amountPaisa)}${method}`);
    }
  }
  return lines.join('\n');
}

export interface DebtConsolidation {
  count: number;
  totalRemainingPaisa: Paisa;
  averagePaisa: Paisa;
  largestPaisa: Paisa;
  smallestPaisa: Paisa;
  highestInterestAccountId: string | null;
  earliestDueDate: string | null;
  monthlyObligationPaisa: Paisa;
}

/** Portfolio-wide "debt consolidation" view (spec §64, §65). */
export async function getDebtConsolidation(db: SQLiteDatabase, asOf = new Date().toISOString()): Promise<DebtConsolidation> {
  const { accounts, balances } = await getPortfolio(db, { direction: 'DEBT', asOf });
  const live = balances.filter((b) => b.remainingPaisa > 0);
  const remaining = live.map((b) => b.remainingPaisa);
  const total = remaining.reduce((s, v) => s + v, 0);
  const accById = new Map(accounts.map((a) => [a.id, a]));
  let highestInterestAccountId: string | null = null;
  let highestBps = -1;
  let earliestDueDate: string | null = null;
  let monthlyObligationPaisa = 0;
  const asOfMonth = localDayKey(asOf).slice(0, 7);
  for (const b of live) {
    const a = accById.get(b.accountId);
    const bps = a?.interestRateBps ?? 0;
    if (bps > highestBps) { highestBps = bps; highestInterestAccountId = b.accountId; }
    if (b.nextDueDate && (!earliestDueDate || b.nextDueDate < earliestDueDate)) earliestDueDate = b.nextDueDate;
    if (b.nextDueDate && b.nextDueDate.slice(0, 7) <= asOfMonth) monthlyObligationPaisa += b.nextDuePaisa;
  }
  return {
    count: live.length,
    totalRemainingPaisa: total,
    averagePaisa: live.length ? Math.round(total / live.length) : 0,
    largestPaisa: remaining.length ? Math.max(...remaining) : 0,
    smallestPaisa: remaining.length ? Math.min(...remaining) : 0,
    highestInterestAccountId,
    earliestDueDate,
    monthlyObligationPaisa,
  };
}
