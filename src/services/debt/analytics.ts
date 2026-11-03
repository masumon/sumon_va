// Analytics for the Personal Debt & Receivable module (spec §28-§37, §54-§60, §100, §105).
// Pure functions over the ledger — no DB, no dates-of-"now" hidden inside. The caller
// passes `asOf` / `monthKey` so output is deterministic and testable.

import { clampNonNegative, percentOf, type Paisa } from './money';
import type { AccountBalance, Transaction } from './types';

export const monthKeyOf = (iso: string): string => (iso.length >= 7 ? iso.slice(0, 7) : iso);
export const yearKeyOf = (iso: string): string => (iso.length >= 4 ? iso.slice(0, 4) : iso);

function countable(t: Transaction): boolean {
  return !t.deletedAt && !t.reversed && t.kind !== 'REVERSAL';
}

// ── period cash-flow (spec §54, §55, §29) ──────────────────────────────────────

export interface PeriodFlow {
  key: string;
  newDebtPaisa: Paisa;
  newReceivablePaisa: Paisa;
  debtPaidPaisa: Paisa;
  receiptPaisa: Paisa;
  /** payments funded from a BORROWED source (spec §106 — not a real reduction) */
  borrowedFundedPaisa: Paisa;
  /** debtPaid − borrowedFunded − newDebt : how much the debt genuinely fell this period */
  realDebtReductionPaisa: Paisa;
  netDebtChangePaisa: Paisa;
}

export function periodFlow(
  transactions: Transaction[],
  borrowedFundedByTxnId: Map<string, Paisa>,
  key: string,
  granularity: 'MONTH' | 'YEAR' = 'MONTH',
): PeriodFlow {
  const keyOf = granularity === 'MONTH' ? monthKeyOf : yearKeyOf;
  const rows = transactions.filter((t) => countable(t) && keyOf(t.txnDate) === key);
  let newDebtPaisa = 0, newReceivablePaisa = 0, debtPaidPaisa = 0, receiptPaisa = 0, borrowedFundedPaisa = 0;
  for (const t of rows) {
    if (t.kind === 'NEW_DEBT') newDebtPaisa += t.amountPaisa;
    else if (t.kind === 'NEW_RECEIVABLE') newReceivablePaisa += t.amountPaisa;
    else if (t.kind === 'PAYMENT' || t.kind === 'SETTLEMENT') {
      debtPaidPaisa += t.amountPaisa;
      borrowedFundedPaisa += borrowedFundedByTxnId.get(t.id) ?? 0;
    } else if (t.kind === 'RECEIPT') receiptPaisa += t.amountPaisa;
  }
  const realDebtReductionPaisa = debtPaidPaisa - borrowedFundedPaisa - newDebtPaisa;
  const netDebtChangePaisa = newDebtPaisa - debtPaidPaisa - (newReceivablePaisa - receiptPaisa);
  return { key, newDebtPaisa, newReceivablePaisa, debtPaidPaisa, receiptPaisa, borrowedFundedPaisa, realDebtReductionPaisa, netDebtChangePaisa };
}

// ── debt reduction % since a baseline (spec §28) ──────────────────────────────

export function debtReductionPct(startingDebtPaisa: Paisa, currentDebtPaisa: Paisa): number {
  if (startingDebtPaisa <= 0) return 0;
  return percentOf(clampNonNegative(startingDebtPaisa - currentDebtPaisa), startingDebtPaisa, 2);
}

// ── monthly obligation & minimum payment (spec §65, §66) ──────────────────────

export interface DueBuckets {
  todayPaisa: Paisa;
  tomorrowPaisa: Paisa;
  next3Paisa: Paisa;
  next7Paisa: Paisa;
  next30Paisa: Paisa;
  thisMonthPaisa: Paisa;
  overduePaisa: Paisa;
}

interface DueItem { dueDate: string | null; amountPaisa: Paisa }

/** Roll unpaid installment slices into date buckets relative to `asOfKey` (YYYY-MM-DD). */
export function bucketDues(items: DueItem[], asOfIso: string): DueBuckets {
  const asOf = dateKey(asOfIso);
  const day = 86_400_000;
  const b: DueBuckets = { todayPaisa: 0, tomorrowPaisa: 0, next3Paisa: 0, next7Paisa: 0, next30Paisa: 0, thisMonthPaisa: 0, overduePaisa: 0 };
  const asOfMonth = monthKeyOf(asOfIso);
  for (const it of items) {
    if (!it.dueDate || it.amountPaisa <= 0) continue;
    const due = dateKey(it.dueDate);
    const diff = Math.round((due - asOf) / day);
    if (diff < 0) { b.overduePaisa += it.amountPaisa; continue; }
    if (diff === 0) b.todayPaisa += it.amountPaisa;
    if (diff === 1) b.tomorrowPaisa += it.amountPaisa;
    if (diff <= 3) b.next3Paisa += it.amountPaisa;
    if (diff <= 7) b.next7Paisa += it.amountPaisa;
    if (diff <= 30) b.next30Paisa += it.amountPaisa;
    if (monthKeyOf(it.dueDate) === asOfMonth) b.thisMonthPaisa += it.amountPaisa;
  }
  return b;
}

/** Midnight-of-that-day, local time — bucketing is by calendar day, not by clock. */
function dateKey(iso: string): number {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (!Number.isFinite(d.getTime())) return 0;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// ── payment-source breakdown (spec §57) ───────────────────────────────────────

export interface SliceStat { key: string; amountPaisa: Paisa; pct: number }

export function breakdown(pairs: { key: string; amountPaisa: Paisa }[]): SliceStat[] {
  const map = new Map<string, number>();
  for (const p of pairs) map.set(p.key, (map.get(p.key) ?? 0) + p.amountPaisa);
  const total = [...map.values()].reduce((s, v) => s + v, 0);
  return [...map.entries()]
    .map(([key, amountPaisa]) => ({ key, amountPaisa, pct: percentOf(amountPaisa, total || 1, 1) }))
    .sort((a, b) => b.amountPaisa - a.amountPaisa);
}

// ── smart insights (spec §100) ───────────────────────────────────────────────

export interface Insight { tone: 'info' | 'warn' | 'good'; bn: string; en: string }

export function smartInsights(args: {
  balances: AccountBalance[];
  thisMonth: PeriodFlow;
  lastMonth: PeriodFlow;
  startingDebtPaisa: Paisa;
  currentDebtPaisa: Paisa;
  fmt: (p: Paisa) => string;
}): Insight[] {
  const out: Insight[] = [];
  const { balances, thisMonth, lastMonth, fmt } = args;
  const debtBals = balances.filter((b) => b.direction === 'DEBT' && b.remainingPaisa > 0);
  const totalDebt = debtBals.reduce((s, b) => s + b.remainingPaisa, 0);

  // New debt outpacing repayment
  if (thisMonth.newDebtPaisa > thisMonth.debtPaidPaisa && thisMonth.newDebtPaisa > 0) {
    out.push({
      tone: 'warn',
      bn: `এই মাসে নতুন দেনা (${fmt(thisMonth.newDebtPaisa)}) পরিশোধের (${fmt(thisMonth.debtPaidPaisa)}) চেয়ে বেশি।`,
      en: `This month new debt (${fmt(thisMonth.newDebtPaisa)}) is more than repayment (${fmt(thisMonth.debtPaidPaisa)}).`,
    });
  }
  // Concentration
  if (debtBals.length > 1 && totalDebt > 0) {
    const top = [...debtBals].sort((a, b) => b.remainingPaisa - a.remainingPaisa)[0]!;
    const share = percentOf(top.remainingPaisa, totalDebt, 0);
    if (share >= 50) {
      out.push({
        tone: 'info',
        bn: `আপনার দেনার ${share}% একটি হিসাবেই।`,
        en: `${share}% of your debt is in a single account.`,
      });
    }
  }
  // Reduction trend
  if (thisMonth.realDebtReductionPaisa > lastMonth.realDebtReductionPaisa && lastMonth.realDebtReductionPaisa > 0) {
    const up = percentOf(thisMonth.realDebtReductionPaisa - lastMonth.realDebtReductionPaisa, lastMonth.realDebtReductionPaisa, 0);
    out.push({ tone: 'good', bn: `এই মাসে দেনা কমেছে গত মাসের চেয়ে ${up}% বেশি।`, en: `Debt reduction is ${up}% higher than last month.` });
  }
  // Overdue receivables
  const overdueRecv = balances.filter((b) => b.direction === 'RECEIVABLE' && b.overduePaisa > 0);
  const overdueRecvTotal = overdueRecv.reduce((s, b) => s + b.overduePaisa, 0);
  if (overdueRecvTotal > 0) {
    out.push({ tone: 'warn', bn: `আপনার পাওনার ${fmt(overdueRecvTotal)}-এর সময় পেরিয়ে গেছে।`, en: `${fmt(overdueRecvTotal)} of your receivables is overdue.` });
  }
  // Borrowed to repay
  if (thisMonth.borrowedFundedPaisa > 0) {
    out.push({
      tone: 'warn',
      bn: `এই মাসে ${fmt(thisMonth.borrowedFundedPaisa)} পরিশোধ ধার করা টাকায় — আসল দেনা ততটা কমেনি।`,
      en: `${fmt(thisMonth.borrowedFundedPaisa)} of this month's payment was borrowed — real debt did not fall by that much.`,
    });
  }
  return out;
}
