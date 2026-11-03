// The single source of truth. Given an account, its installments and its ledger rows,
// derive every "current" number the UI shows — paid, remaining, status, next due,
// overdue, progress. Nothing here is stored; call it whenever you need fresh figures.
//
// A transaction counts only when it is not soft-deleted, not reversed, and is not
// itself a REVERSAL row — so a reversed payment nets to exactly nothing (spec §48).

import { bangladeshDateKey } from '../../i18n/date-time';
import { computeInterest } from './interest';
import { clampNonNegative, percentOf, type Paisa } from './money';
import type {
  Account,
  AccountBalance,
  AccountStatus,
  Allocation,
  Installment,
  Transaction,
} from './types';

export interface AccountLedger {
  account: Account;
  installments: Installment[];
  transactions: Transaction[];
  /** allocations for the account's transactions (installmentId may be null) */
  allocations: Allocation[];
}

export function isCountable(txn: Transaction): boolean {
  return !txn.deletedAt && !txn.reversed && txn.kind !== 'REVERSAL';
}

/** Signed contribution of a countable txn to "amount still owed" on its account. */
function owedDelta(txn: Transaction, direction: Account['direction']): Paisa {
  switch (txn.kind) {
    case 'NEW_DEBT':
    case 'NEW_RECEIVABLE':
      return 0; // principal is summed separately (see `principalPaisa` below) so interest can use it
    case 'PAYMENT':
      return direction === 'DEBT' ? -txn.amountPaisa : 0;
    case 'RECEIPT':
      return direction === 'RECEIVABLE' ? -txn.amountPaisa : 0;
    case 'SETTLEMENT':
      return -txn.amountPaisa;
    case 'ADJUSTMENT':
      return (txn.adjSign ?? 1) * txn.amountPaisa;
    case 'WRITE_OFF':
      // Writing off says the money will never arrive: it clears what is owed without
      // ever counting as "paid". The row used to net to nothing, so the balance only
      // changed because `status` was patched alongside it — a ledger that disagreed
      // with its own summary.
      return -txn.amountPaisa;
    case 'INTEREST_ACCRUAL':
      // Interest is derived from the account's terms on every read, so a stored accrual
      // row would double-count it. The kind is kept for imported historical ledgers.
      return 0;
    case 'REVERSAL':
      return 0;
  }
}

/**
 * The calendar day of `iso` in the device's own timezone, as `YYYY-MM-DD`.
 *
 * Slicing an ISO string gives the *UTC* day, which in Asia/Dhaka is yesterday for the
 * first six hours of every day — enough to file an instalment due today under
 * "tomorrow", and to report the previous month's flows on the 1st.
 */
export function localDayKey(iso: string): string {
  try {
    return bangladeshDateKey(iso);
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Midnight-of-that-day, in local time. Comparisons here are day-granular on purpose:
 * an instalment due *today* is not overdue, whatever the clock reads, and a full ISO
 * timestamp must not sort after a bare `YYYY-MM-DD` for the same calendar day.
 */
function toDateKey(iso: string): number {
  const key = iso.length <= 10 ? iso : localDayKey(iso);
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return Number.POSITIVE_INFINITY;
  // UTC midnight of that Dhaka calendar day — a stable integer to compare and subtract,
  // with no second timezone smuggled in by the device's own clock.
  return Date.UTC(year, month - 1, day);
}

/** Full derived balance for one account. `asOfIso` fixes interest + overdue evaluation. */
export function deriveAccountBalance(ledger: AccountLedger, asOfIso: string): AccountBalance {
  const { account, installments } = ledger;
  const txns = ledger.transactions.filter(isCountable);
  const allocs = ledger.allocations;
  const asOfKey = toDateKey(asOfIso);

  // Principal = the sum of every NEW_DEBT / NEW_RECEIVABLE tranche (append-only — topping
  // up an existing loan is just another tranche). Falls back to the cached account field
  // when no principal tranche has been written yet.
  const principalKind = account.direction === 'DEBT' ? 'NEW_DEBT' : 'NEW_RECEIVABLE';
  const trancheTotal = txns.filter((t) => t.kind === principalKind).reduce((s, t) => s + t.amountPaisa, 0);
  // Fall back to the cached column only when the ledger has never held a principal row —
  // not when every one of them has been reversed. Reversing the tranche that opened a loan
  // is how "ধার করে ধার শোধ" is undone, and reading the stale column there brought the
  // cancelled loan back to life still owing its full principal.
  const hasTrancheRow = ledger.transactions.some((t) => t.kind === principalKind);
  const principalPaisa = clampNonNegative(hasTrancheRow ? trancheTotal : account.principalPaisa);

  // Repayments, oldest first — only the reducing-balance basis reads them, but building
  // the list is cheap and keeps the call site honest about what interest depends on.
  const repayKind = account.direction === 'DEBT' ? 'PAYMENT' : 'RECEIPT';
  const repayments = txns
    .filter((t) => t.kind === repayKind || t.kind === 'SETTLEMENT')
    .map((t) => ({ date: t.txnDate, amountPaisa: t.amountPaisa }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const interest = computeInterest(
    {
      principalPaisa,
      interestType: account.interestType,
      interestRateBps: account.interestRateBps,
      interestPeriod: account.interestPeriod,
      compoundPeriod: account.compoundPeriod,
      manualTotalPayablePaisa: account.manualTotalPayablePaisa,
      openedDate: account.openedDate,
      interestBasis: account.interestBasis,
      closedAt: account.closedAt,
      repayments,
    },
    asOfIso,
  );
  const accruedInterestPaisa = clampNonNegative(interest.interestPaisa);

  const adjustmentPaisa = txns
    .filter((t) => t.kind === 'ADJUSTMENT')
    .reduce((s, t) => s + (t.adjSign ?? 1) * t.amountPaisa, 0);

  // Base amount owed before any repayment. Adjustments are applied via `owedFromTxns`
  // below (not here) so they are counted exactly once.
  const totalPayablePaisa = clampNonNegative(principalPaisa + accruedInterestPaisa);

  // Everything actually paid in (payments for a debt, receipts for a receivable) + settlement.
  const settlementPaid = txns.filter((t) => t.kind === 'SETTLEMENT').reduce((s, t) => s + t.amountPaisa, 0);
  const regularPaid = txns
    .filter((t) => (account.direction === 'DEBT' ? t.kind === 'PAYMENT' : t.kind === 'RECEIPT'))
    .reduce((s, t) => s + t.amountPaisa, 0);
  const paidPaisa = regularPaid + settlementPaid;

  // Interest-first, then principal — the order money is applied in for every loan in
  // this module, and the order the reducing-balance engine assumes too, so the analytics
  // split and the interest calculation always tell the same story.
  const paidInterestPaisa = Math.min(paidPaisa, accruedInterestPaisa);
  const paidPrincipalPaisa = clampNonNegative(paidPaisa - paidInterestPaisa);

  const owedFromTxns = txns.reduce((s, t) => s + owedDelta(t, account.direction), 0);
  const rawRemaining = totalPayablePaisa + owedFromTxns; // owedDelta carries the signs (payments −, +adj)
  // Ordinary payments never push remaining negative; the excess is "advance".
  const remainingPaisa = clampNonNegative(rawRemaining);
  const advancePaisa = rawRemaining < 0 ? -rawRemaining : 0;

  // ── installment view ─────────────────────────────────────────────────────────
  const allocByInstallment = new Map<string, Paisa>();
  for (const a of allocs) {
    if (!a.installmentId) continue;
    allocByInstallment.set(a.installmentId, (allocByInstallment.get(a.installmentId) ?? 0) + a.amountPaisa);
  }
  const sortedInst = sortInstallments(installments);
  let installmentsPaidCount = 0;
  let overduePaisa = 0;
  let earliestOverdueKey = Number.POSITIVE_INFINITY;
  let nextDueDate: string | null = null;
  let nextDuePaisa = 0;

  for (const inst of sortedInst) {
    const paidHere = allocByInstallment.get(inst.id) ?? 0;
    const unpaid = clampNonNegative(inst.amountPaisa - paidHere);
    if (unpaid === 0) {
      installmentsPaidCount += 1;
      continue;
    }
    if (inst.dueDate) {
      const key = toDateKey(inst.dueDate);
      if (key < asOfKey) {
        overduePaisa += unpaid;
        earliestOverdueKey = Math.min(earliestOverdueKey, key);
      }
    }
    if (nextDueDate === null) {
      nextDueDate = inst.dueDate;
      nextDuePaisa = unpaid;
    }
  }

  // No schedule → fall back to the account-level final due date.
  if (sortedInst.length === 0 && remainingPaisa > 0) {
    nextDueDate = account.finalDueDate ?? account.firstDueDate;
    nextDuePaisa = remainingPaisa;
    if (nextDueDate && toDateKey(nextDueDate) < asOfKey) {
      overduePaisa = remainingPaisa;
      earliestOverdueKey = toDateKey(nextDueDate);
    }
  }

  const overdueDays =
    earliestOverdueKey === Number.POSITIVE_INFINITY
      ? 0
      : Math.max(0, Math.floor((asOfKey - earliestOverdueKey) / 86_400_000));

  // What the account was ever expected to yield, adjustments and all. Without the
  // adjustment term a +50,000 penalty leaves progress reading 100% with 50,000 still due.
  const expectedTotalPaisa = clampNonNegative(totalPayablePaisa + adjustmentPaisa);

  const status = deriveStatus(account, remainingPaisa, paidPaisa, overduePaisa);
  // A settled / written-off / cancelled account owes nothing further, whatever the raw maths say.
  const effectiveRemaining =
    status === 'SETTLED' || status === 'WRITTEN_OFF' || status === 'CANCELLED' ? 0 : remainingPaisa;

  // You cannot be late on more than you still owe.
  //
  // Overdue is read off the instalment schedule, but what is owed comes from the ledger,
  // and the two can disagree: a written-off loan owes nothing while its schedule still
  // lists unpaid dates, and a payment recorded against no instalment leaves every row in
  // the schedule looking untouched. Both cases put a phantom figure into the dashboard's
  // overdue total and into the obligation the shared money picture works from.
  const effectiveOverdue = Math.min(overduePaisa, effectiveRemaining);
  const effectiveOverdueDays = effectiveOverdue > 0 ? overdueDays : 0;

  return {
    accountId: account.id,
    direction: account.direction,
    totalPayablePaisa,
    principalPaisa,
    accruedInterestPaisa,
    paidPaisa,
    paidPrincipalPaisa,
    paidInterestPaisa,
    remainingPaisa: effectiveRemaining,
    advancePaisa,
    adjustmentPaisa,
    progressPct: percentOf(paidPaisa, expectedTotalPaisa || paidPaisa, 2),
    status,
    nextDueDate,
    nextDuePaisa,
    overduePaisa: effectiveOverdue,
    overdueDays: effectiveOverdueDays,
    installmentsPaidCount,
    installmentsTotalCount: sortedInst.length,
  };
}

/**
 * Due-date order — the order money should actually be applied in. `seq` alone is not it:
 * once a schedule can be edited, instalment 1 can easily fall due after instalment 2, and
 * ordering by seq would then report the wrong "next due" and pay the wrong slice first.
 * Undated instalments sort last; ties fall back to `seq` so the order is always stable.
 */
export function sortInstallments(installments: Installment[]): Installment[] {
  return [...installments].sort((a, b) => {
    const ka = a.dueDate ? toDateKey(a.dueDate) : Number.POSITIVE_INFINITY;
    const kb = b.dueDate ? toDateKey(b.dueDate) : Number.POSITIVE_INFINITY;
    if (ka !== kb) return ka - kb;
    return a.seq - b.seq;
  });
}

export function deriveStatus(
  account: Account,
  remainingPaisa: Paisa,
  paidPaisa: Paisa,
  overduePaisa: Paisa,
): AccountStatus {
  // Terminal states set by an explicit user action win.
  if (account.status === 'CANCELLED') return 'CANCELLED';
  if (account.status === 'WRITTEN_OFF') return 'WRITTEN_OFF';
  if (account.status === 'SETTLED') return 'SETTLED';
  if (remainingPaisa <= 0) return 'COMPLETED';
  if (overduePaisa > 0) return 'OVERDUE';
  if (paidPaisa > 0) return 'PARTIAL';
  return 'ACTIVE';
}

// ── portfolio-level roll-ups ───────────────────────────────────────────────────

export interface PortfolioTotals {
  outstandingDebtPaisa: Paisa;
  outstandingReceivablePaisa: Paisa;
  netDebtPaisa: Paisa;
  totalPaidPaisa: Paisa;
  totalReceivedPaisa: Paisa;
  activeDebtCount: number;
  activeReceivableCount: number;
  completedDebtCount: number;
  completedReceivableCount: number;
  overduePaisa: Paisa;
  overdueCount: number;
}

export function derivePortfolio(balances: AccountBalance[]): PortfolioTotals {
  const t: PortfolioTotals = {
    outstandingDebtPaisa: 0,
    outstandingReceivablePaisa: 0,
    netDebtPaisa: 0,
    totalPaidPaisa: 0,
    totalReceivedPaisa: 0,
    activeDebtCount: 0,
    activeReceivableCount: 0,
    completedDebtCount: 0,
    completedReceivableCount: 0,
    overduePaisa: 0,
    overdueCount: 0,
  };
  for (const b of balances) {
    // A cancelled account is void — its ledger row exists for the audit trail, not for
    // the portfolio's arithmetic. `remainingPaisa` already reads 0 for it, but `paidPaisa`
    // does not: whatever moved before it was cancelled was still being added into
    // `totalPaidPaisa`/`totalReceivedPaisa`, inflating "how much you've paid back" with
    // money attributed to a loan the portfolio otherwise treats as if it never counted.
    if (b.status === 'CANCELLED') continue;
    const done = b.status === 'COMPLETED' || b.status === 'SETTLED' || b.status === 'WRITTEN_OFF';
    if (b.direction === 'DEBT') {
      t.outstandingDebtPaisa += b.remainingPaisa;
      t.totalPaidPaisa += b.paidPaisa;
      if (done) t.completedDebtCount += 1;
      else t.activeDebtCount += 1;
    } else {
      t.outstandingReceivablePaisa += b.remainingPaisa;
      t.totalReceivedPaisa += b.paidPaisa;
      if (done) t.completedReceivableCount += 1;
      else t.activeReceivableCount += 1;
    }
    if (b.overduePaisa > 0) {
      t.overduePaisa += b.overduePaisa;
      t.overdueCount += 1;
    }
  }
  t.netDebtPaisa = t.outstandingDebtPaisa - t.outstandingReceivablePaisa;
  return t;
}
