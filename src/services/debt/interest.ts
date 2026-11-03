// Interest engine for the Personal Debt & Receivable module.
//
// Pure, deterministic, integer-paisa in / integer-paisa out. Five models (spec §60,
// "পূর্ণ সুদের ইঞ্জিন"):
//
//   NONE          total payable = principal.
//   FLAT_TOTAL    the user states the final total directly; interest = total − principal.
//   SIMPLE        I = P × r × t        (r per `interestPeriod`, t = elapsed periods, no compounding)
//   COMPOUND      A = P × (1 + rc)^n   (rc = rate per `compoundPeriod`, n = elapsed compound periods)
//   MONTHLY_FLAT  simple interest fixed to whole calendar months (the common informal
//                 "X% per month" loan) — like SIMPLE with period = MONTH, months floored.
//
// `interestRateBps` is basis points for the given period (1% = 100 bps, 12% = 1200 bps).

import { addPaisa, applyBps, clampNonNegative, type Paisa } from './money';
import type { InterestBasis, InterestType, RatePeriod } from './types';

const MS_PER_DAY = 86_400_000;

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

/** Fractional number of `period`s between two ISO dates (>= 0; 0 if `to` <= `from`). */
export function elapsedPeriods(fromIso: string, toIso: string, period: RatePeriod): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return 0;
  if (to.getTime() <= from.getTime()) return 0;

  if (period === 'DAY') return (to.getTime() - from.getTime()) / MS_PER_DAY;
  if (period === 'WEEK') return (to.getTime() - from.getTime()) / (MS_PER_DAY * 7);

  // Calendar-month counting with a day-of-month fraction, then /12 for years. Measured
  // in whole calendar days (never hours) to match every value this ever produced before.
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) {
    // `to` lands earlier in its month than `from` did in its own (31 Jan -> 1 Feb): the
    // whole-month count above already counted a month that has not fully elapsed. The old
    // fix for this measured the day gap against the ARRIVAL month's length regardless
    // (1 - 31 = -30, over Feb's 28 days), went negative, and was clamped to zero —
    // silently reporting that no time at all had elapsed over a real month boundary.
    // Backing off one whole month and measuring the actual days covered (what was left of
    // `from`'s own month, plus how far into the new one `to` reached) against `from`'s
    // month length never goes negative and still lands on exactly 1 for a full month.
    months -= 1;
    const daysLeftInFromMonth = daysInMonth(from.getFullYear(), from.getMonth()) - from.getDate();
    months += (daysLeftInFromMonth + to.getDate()) / daysInMonth(from.getFullYear(), from.getMonth());
  } else {
    months += (to.getDate() - from.getDate()) / daysInMonth(to.getFullYear(), to.getMonth());
  }
  return period === 'YEAR' ? months / 12 : months;
}

export interface InterestBreakdown {
  principalPaisa: Paisa;
  interestPaisa: Paisa;
  totalPayablePaisa: Paisa;
  asOf: string;
}

/** One repayment, as the reducing-balance walker needs it: when, and how much. */
export interface RepaymentPoint {
  date: string;
  amountPaisa: Paisa;
}

export interface InterestParams {
  principalPaisa: Paisa;
  interestType: InterestType;
  interestRateBps?: number | null;
  interestPeriod?: RatePeriod | null;
  compoundPeriod?: RatePeriod | null;
  manualTotalPayablePaisa?: Paisa | null;
  openedDate?: string | null;
  /** ORIGINAL (default) charges on the full principal forever; REDUCING on what is left. */
  interestBasis?: InterestBasis | null;
  /**
   * The day the account stopped owing anything. Interest is evaluated at
   * `min(asOf, closedAt)` — without this a fully repaid interest-bearing account
   * keeps growing and silently re-opens itself the next day.
   */
  closedAt?: string | null;
  /** Repayments in date order. Only read when `interestBasis` is REDUCING. */
  repayments?: RepaymentPoint[];
}

/**
 * Total interest accrued on `principal` from `openedDate` up to `asOfIso`.
 * Deterministic; call with a fixed `asOf` (e.g. a statement date) for stable output.
 */
export function computeInterest(params: InterestParams, asOfIso: string): InterestBreakdown {
  const principalPaisa = Math.max(0, Math.trunc(params.principalPaisa));
  // The clock stops on the day the account closed. Everything below reads `asOf`.
  const asOf = earlierOf(asOfIso, params.closedAt);
  const zero: InterestBreakdown = {
    principalPaisa,
    interestPaisa: 0,
    totalPayablePaisa: principalPaisa,
    asOf,
  };

  // Reducing balance is a different shape entirely — a walk over the repayments —
  // so it branches before the flat models below.
  if (
    params.interestBasis === 'REDUCING' &&
    (params.interestType === 'SIMPLE' || params.interestType === 'COMPOUND' || params.interestType === 'MONTHLY_FLAT') &&
    params.openedDate &&
    (params.interestRateBps ?? 0) > 0 &&
    principalPaisa > 0
  ) {
    const interestPaisa = reducingBalanceInterest(params, principalPaisa, asOf);
    return { principalPaisa, interestPaisa, totalPayablePaisa: addPaisa(principalPaisa, interestPaisa), asOf };
  }

  switch (params.interestType) {
    case 'NONE':
      return zero;

    case 'FLAT_TOTAL': {
      // Floored at 0, not at the principal: a stated total below the principal is a
      // discount a lender agreed to up front (a term of the loan, not an error), and
      // silently raising it back to the principal overwrote that discount without any
      // sign it had happened. `interestPaisa` goes negative to record exactly that.
      const total = Math.max(0, Math.trunc(params.manualTotalPayablePaisa ?? principalPaisa));
      return { principalPaisa, interestPaisa: total - principalPaisa, totalPayablePaisa: total, asOf };
    }

    case 'SIMPLE': {
      const rateBps = params.interestRateBps ?? 0;
      const period = params.interestPeriod ?? 'YEAR';
      const t = params.openedDate ? elapsedPeriods(params.openedDate, asOf, period) : 0;
      const interestPaisa = Math.round((principalPaisa * rateBps * t) / 10_000);
      return {
        principalPaisa,
        interestPaisa,
        totalPayablePaisa: addPaisa(principalPaisa, interestPaisa),
        asOf,
      };
    }

    case 'MONTHLY_FLAT': {
      const rateBps = params.interestRateBps ?? 0;
      const monthsExact = params.openedDate ? elapsedPeriods(params.openedDate, asOf, 'MONTH') : 0;
      const months = Math.floor(monthsExact);
      const interestPaisa = applyBps(principalPaisa, rateBps) * months;
      return {
        principalPaisa,
        interestPaisa,
        totalPayablePaisa: addPaisa(principalPaisa, interestPaisa),
        asOf,
      };
    }

    case 'COMPOUND': {
      const rateBps = params.interestRateBps ?? 0;
      const ratePeriod = params.interestPeriod ?? 'YEAR';
      const compPeriod = params.compoundPeriod ?? ratePeriod;
      if (!params.openedDate || rateBps <= 0 || principalPaisa <= 0) return zero;

      // Rate per compounding step = nominal period rate scaled by (compound / rate) period length.
      const periodDays = periodInDays(ratePeriod);
      const compDays = periodInDays(compPeriod);
      const ratePerComp = (rateBps / 10_000) * (compDays / periodDays);
      const n = elapsedPeriods(params.openedDate, asOf, compPeriod);
      if (n <= 0) return zero;

      const growth = Math.pow(1 + ratePerComp, n);
      const totalPayablePaisa = Math.round(principalPaisa * growth);
      return {
        principalPaisa,
        interestPaisa: totalPayablePaisa - principalPaisa,
        totalPayablePaisa,
        asOf,
      };
    }

    default:
      return zero;
  }
}

/** The earlier of two ISO instants; `b` is ignored when absent or unparseable. */
function earlierOf(a: string, b?: string | null): string {
  if (!b) return a;
  const ta = new Date(a).getTime();
  const tb = new Date(b.length <= 10 ? `${b}T23:59:59.999` : b).getTime();
  if (!Number.isFinite(tb)) return a;
  if (!Number.isFinite(ta)) return b;
  return tb < ta ? new Date(tb).toISOString() : a;
}

/**
 * Interest on the balance that is actually still outstanding.
 *
 * Walks the timeline from `openedDate` to `asOf`, cut at every repayment: inside each
 * segment interest accrues on the balance carried into it, and at the cut the repayment
 * comes off. The balance can never go below zero, so an overpayment simply stops the
 * clock rather than earning negative interest.
 *
 * MONTHLY_FLAT is walked month by month instead, because "X% per month" is charged in
 * whole months on the balance standing at the start of each one — a part-month at the
 * end earns nothing, exactly as the ORIGINAL-basis model already treats it.
 */
function reducingBalanceInterest(params: InterestParams, principalPaisa: Paisa, asOf: string): Paisa {
  const rateBps = params.interestRateBps ?? 0;
  const openedDate = params.openedDate!;
  const startMs = toMs(openedDate);
  const endMs = toMs(asOf);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;

  // Repayments inside the window, oldest first. Anything dated at or before the opening
  // day counts on day one; anything after `asOf` has not happened yet.
  const points = (params.repayments ?? [])
    .map((r) => ({ ms: Math.max(startMs, toMs(r.date)), amountPaisa: Math.max(0, Math.trunc(r.amountPaisa)) }))
    .filter((r) => Number.isFinite(r.ms) && r.ms <= endMs && r.amountPaisa > 0)
    .sort((a, b) => a.ms - b.ms);

  // A repayment settles the interest already charged before it touches the principal —
  // which is what makes the *principal* the thing interest is charged on next period.
  let principalLeft = principalPaisa;
  let interestUnpaid = 0;
  let accrued = 0;
  const settle = (amountPaisa: Paisa): void => {
    const toInterest = Math.min(interestUnpaid, amountPaisa);
    interestUnpaid -= toInterest;
    principalLeft = clampNonNegative(principalLeft - (amountPaisa - toInterest));
  };

  if (params.interestType === 'MONTHLY_FLAT') {
    // "X% per month" is charged in whole months on the principal standing at the start of
    // each one. A part-month at the end earns nothing, exactly as the ORIGINAL basis does.
    let cursor = startMs;
    let i = 0;
    for (let guard = 0; guard < 1200 && principalLeft > 0; guard += 1) {
      const next = addOneMonth(cursor);
      if (next > endMs) break;
      const charge = applyBps(principalLeft, rateBps);
      accrued += charge;
      interestUnpaid += charge;
      while (i < points.length && points[i]!.ms <= next) {
        settle(points[i]!.amountPaisa);
        i += 1;
      }
      cursor = next;
    }
    return accrued;
  }

  const ratePeriod = params.interestPeriod ?? 'YEAR';
  const isCompound = params.interestType === 'COMPOUND';
  const compPeriod = isCompound ? (params.compoundPeriod ?? ratePeriod) : ratePeriod;
  const ratePerComp = (rateBps / 10_000) * (periodInDays(compPeriod) / periodInDays(ratePeriod));

  let cursor = startMs;
  for (const point of [...points, { ms: endMs, amountPaisa: 0 }]) {
    if (point.ms > cursor && principalLeft > 0) {
      const from = new Date(cursor).toISOString();
      const to = new Date(point.ms).toISOString();
      let charge: Paisa;
      if (isCompound) {
        // Compounding is the one model where unpaid interest genuinely does earn interest.
        const carrying = principalLeft + interestUnpaid;
        const n = elapsedPeriods(from, to, compPeriod);
        charge = n > 0 ? Math.round(carrying * (Math.pow(1 + ratePerComp, n) - 1)) : 0;
      } else {
        // Rounded once, on the real figure — not `applyBps` (itself rounded to a whole
        // period's charge) multiplied by a fractional `t` and rounded again. Two roundings
        // compound their own error every segment the reducing walk cuts at a repayment,
        // silently drifting the REDUCING total away from what SIMPLE computes for the same
        // rate over the same span (which rounds once, the same way this now does).
        const t = elapsedPeriods(from, to, ratePeriod);
        charge = Math.round((principalLeft * rateBps * t) / 10_000);
      }
      accrued += charge;
      interestUnpaid += charge;
    }
    if (point.amountPaisa > 0) settle(point.amountPaisa);
    cursor = Math.max(cursor, point.ms);
  }
  return clampNonNegative(accrued);
}

function toMs(iso: string): number {
  return new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).getTime();
}

/** One calendar month on, clamping the day-of-month (31 Jan + 1 month = 28/29 Feb). */
function addOneMonth(ms: number): number {
  const d = new Date(ms);
  const target = d.getMonth() + 1;
  const y = d.getFullYear() + Math.floor(target / 12);
  const m = ((target % 12) + 12) % 12;
  const day = Math.min(d.getDate(), new Date(y, m + 1, 0).getDate());
  return new Date(y, m, day, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime();
}

function periodInDays(period: RatePeriod): number {
  switch (period) {
    case 'DAY': return 1;
    case 'WEEK': return 7;
    case 'MONTH': return 30.4375;
    case 'YEAR': return 365.25;
  }
}
