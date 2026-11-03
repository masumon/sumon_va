// Repayment strategy + simulation engine (spec §21-§35, §67, §100-§102).
// Pure functions. `AccountBalance` rows in, ordered plans / projections out.

import { clampNonNegative, percentOf, type Paisa } from './money';
import { asciiDigitsToBengali } from './money';
import type { AccountBalance, RiskLevel, Strategy } from './types';

export interface PlanRow {
  accountId: string;
  remainingPaisa: Paisa;
  interestRateBps: number;
  overdueDays: number;
  minPaymentPaisa: Paisa;
  priorityRank: number | null;
}

// ── ordering (spec §22-§24) ───────────────────────────────────────────────────

export function orderByStrategy(rows: PlanRow[], strategy: Strategy): PlanRow[] {
  const live = rows.filter((r) => r.remainingPaisa > 0);
  if (strategy === 'SNOWBALL') return [...live].sort((a, b) => a.remainingPaisa - b.remainingPaisa || b.interestRateBps - a.interestRateBps);
  if (strategy === 'AVALANCHE') return [...live].sort((a, b) => b.interestRateBps - a.interestRateBps || a.remainingPaisa - b.remainingPaisa);
  // CUSTOM: explicit rank first (nulls last), then most-overdue, then biggest.
  return [...live].sort((a, b) => {
    const ra = a.priorityRank ?? Number.POSITIVE_INFINITY;
    const rb = b.priorityRank ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
    return b.remainingPaisa - a.remainingPaisa;
  });
}

// ── best next payment (spec §102) ─────────────────────────────────────────────

export interface BestNext {
  accountId: string | null;
  reasonBn: string;
  reasonEn: string;
}

export function bestNextPayment(rows: PlanRow[], strategy: Strategy): BestNext {
  const live = rows.filter((r) => r.remainingPaisa > 0);
  if (!live.length) return { accountId: null, reasonBn: 'সব দেনা শোধ হয়ে গেছে।', reasonEn: 'All debts are cleared.' };

  const mostOverdue = [...live].sort((a, b) => b.overdueDays - a.overdueDays)[0]!;
  if (mostOverdue.overdueDays > 0) {
    return { accountId: mostOverdue.accountId, reasonBn: `${asciiDigitsToBengali(String(mostOverdue.overdueDays))} দিন দেরি হয়ে গেছে — আগে এটি।`, reasonEn: `${mostOverdue.overdueDays} days overdue — clear this first.` };
  }
  const ordered = orderByStrategy(live, strategy);
  const pick = ordered[0]!;
  const why = strategy === 'AVALANCHE'
    ? { bn: 'সবচেয়ে বেশি সুদ — সুদ সাশ্রয় হবে।', en: 'Highest interest — saves the most on interest.' }
    : strategy === 'SNOWBALL'
      ? { bn: 'সবচেয়ে ছোট দেনা — দ্রুত একটি হিসাব বন্ধ হবে।', en: 'Smallest debt — closes an account fastest.' }
      : { bn: 'আপনার নির্ধারিত অগ্রাধিকার অনুযায়ী।', en: 'Matches your set priority.' };
  return { accountId: pick.accountId, reasonBn: why.bn, reasonEn: why.en };
}

// ── what-if single payment (spec §30) ────────────────────────────────────────

export interface WhatIf {
  currentDebtPaisa: Paisa;
  paymentPaisa: Paisa;
  newDebtPaisa: Paisa;
  reductionPct: number;
}

export function whatIfPayment(currentDebtPaisa: Paisa, paymentPaisa: Paisa): WhatIf {
  const pay = clampNonNegative(paymentPaisa);
  const newDebtPaisa = clampNonNegative(currentDebtPaisa - pay);
  return {
    currentDebtPaisa,
    paymentPaisa: pay,
    newDebtPaisa,
    reductionPct: percentOf(currentDebtPaisa - newDebtPaisa, currentDebtPaisa || 1, 2),
  };
}

// ── debt-free projection (spec §31, §32, §101) ───────────────────────────────

export interface ProjectionInput {
  balances: { remainingPaisa: Paisa; monthlyInterestBps: number }[];
  monthlyPaymentPaisa: Paisa;
  /** average extra debt taken each month, if any (spec §31 "নতুন Debt থাকলে") */
  monthlyNewDebtPaisa?: Paisa;
  maxMonths?: number;
}

export interface Projection {
  months: number;
  totalPaidPaisa: Paisa;
  totalInterestPaisa: Paisa;
  clears: boolean;
}

/**
 * Month-by-month sim: each month accrues interest on the outstanding, adds any recurring
 * new debt, then applies `monthlyPayment` (avalanche split — highest rate first).
 */
export function projectDebtFree(input: ProjectionInput): Projection {
  const max = input.maxMonths ?? 600;
  let outstanding = input.balances.map((b) => ({ ...b }));
  let totalPaid = 0;
  let totalInterest = 0;
  const newDebt = input.monthlyNewDebtPaisa ?? 0;

  for (let m = 1; m <= max; m += 1) {
    // accrue interest
    for (const b of outstanding) {
      if (b.remainingPaisa <= 0) continue;
      const i = Math.round((b.remainingPaisa * b.monthlyInterestBps) / 10_000);
      b.remainingPaisa += i;
      totalInterest += i;
    }
    // fresh borrowing spread onto the first bucket (kept simple)
    if (newDebt > 0 && outstanding.length) outstanding[0]!.remainingPaisa += newDebt;

    // apply payment, highest rate first
    let pay = input.monthlyPaymentPaisa;
    for (const b of [...outstanding].sort((a, c) => c.monthlyInterestBps - a.monthlyInterestBps)) {
      if (pay <= 0) break;
      if (b.remainingPaisa <= 0) continue;
      const take = Math.min(b.remainingPaisa, pay);
      b.remainingPaisa -= take;
      pay -= take;
      totalPaid += take;
    }

    const left = outstanding.reduce((s, b) => s + Math.max(0, b.remainingPaisa), 0);
    if (left <= 0) return { months: m, totalPaidPaisa: totalPaid, totalInterestPaisa: totalInterest, clears: true };
    // never clears (payment ≤ interest + new debt)
    if (input.monthlyPaymentPaisa <= 0) break;
  }
  return { months: max, totalPaidPaisa: totalPaid, totalInterestPaisa: totalInterest, clears: false };
}

/** Add `n` whole months to an ISO date, clamping the day-of-month. */
export function addMonths(iso: string, n: number): string {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const tm = d.getMonth() + n;
  const y = d.getFullYear() + Math.floor(tm / 12);
  const mo = ((tm % 12) + 12) % 12;
  const day = Math.min(d.getDate(), new Date(y, mo + 1, 0).getDate());
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ── risk (spec §99) ──────────────────────────────────────────────────────────

export function riskLevel(b: Pick<AccountBalance, 'overdueDays' | 'overduePaisa' | 'remainingPaisa'> & { interestRateBps: number }): RiskLevel {
  let score = 0;
  if (b.overdueDays > 30) score += 3;
  else if (b.overdueDays > 7) score += 2;
  else if (b.overdueDays > 0) score += 1;
  if (b.interestRateBps >= 2_000) score += 2;
  else if (b.interestRateBps >= 1_000) score += 1;
  if (b.remainingPaisa >= 100_000_00) score += 1;
  if (score >= 5) return 'CRITICAL';
  if (score >= 3) return 'HIGH';
  if (score >= 1) return 'MEDIUM';
  return 'LOW';
}

/** Convert an account's stored rate to an approximate monthly bps for the projector. */
export function toMonthlyBps(rateBps: number | null | undefined, period: string | null | undefined): number {
  if (!rateBps || rateBps <= 0) return 0;
  switch (period) {
    case 'DAY': return Math.round(rateBps * 30.4375);
    case 'WEEK': return Math.round(rateBps * (30.4375 / 7));
    case 'MONTH': return rateBps;
    case 'YEAR': default: return Math.round(rateBps / 12);
  }
}
