import type { SQLiteDatabase } from 'expo-sqlite';
import { categoryBreakdown, monthKey } from './finance-service';
import { formatPaisa } from './debt/money';

// "গত তিন মাসের খরচ বিশ্লেষণ করো" — answered from the ledger itself, read-only.
//
// Every figure comes from `categoryBreakdown` (which already leaves out wallet transfers
// and debt movements, so a loan repaid is not "spending"). The summary is complete without
// any AI; when an on-device model is ready it may *explain* these facts, but the facts are
// fixed here and it is checked against them (analysis-nlg).

export interface SpendingAnalysis {
  months: string[];
  monthTotals: { month: string; totalPaisa: number }[];
  topCategories: { category: string; totalPaisa: number; sharePct: number }[];
  totalPaisa: number;
  avgPerMonthPaisa: number;
  biggestRise?: { category: string; fromPaisa: number; toPaisa: number };
}

function lastMonths(count: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 15)));
  return out;
}

export async function analyzeSpending(db: SQLiteDatabase, months = 3, now = new Date()): Promise<SpendingAnalysis> {
  const span = Math.min(Math.max(Math.round(months) || 3, 1), 12);
  const keys = lastMonths(span, now);
  const perMonth = await Promise.all(keys.map((m) => categoryBreakdown(db, 'EXPENSE', m)));

  const byCategory = new Map<string, number>();
  const monthTotals = keys.map((month, i) => {
    let total = 0;
    for (const row of perMonth[i] ?? []) {
      total += row.totalPaisa;
      byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.totalPaisa);
    }
    return { month, totalPaisa: total };
  });
  const totalPaisa = monthTotals.reduce((s, m) => s + m.totalPaisa, 0);
  const topCategories = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, t]) => ({ category, totalPaisa: t, sharePct: totalPaisa ? Math.round((t / totalPaisa) * 100) : 0 }));

  // The category that grew most between the first and the last month of the span.
  let biggestRise: SpendingAnalysis['biggestRise'];
  if (keys.length >= 2) {
    const first = new Map((perMonth[0] ?? []).map((r) => [r.category, r.totalPaisa]));
    for (const r of perMonth[keys.length - 1] ?? []) {
      const from = first.get(r.category) ?? 0;
      if (r.totalPaisa > from && (!biggestRise || r.totalPaisa - from > biggestRise.toPaisa - biggestRise.fromPaisa)) {
        biggestRise = { category: r.category, fromPaisa: from, toPaisa: r.totalPaisa };
      }
    }
  }

  return { months: keys, monthTotals, topCategories, totalPaisa, avgPerMonthPaisa: Math.round(totalPaisa / span), biggestRise };
}

/** The deterministic summary — complete on its own, and the fact sheet the AI must stay within. */
export function describeSpending(a: SpendingAnalysis, language: 'bn' | 'en'): string {
  const bn = language === 'bn';
  const tk = (p: number) => formatPaisa(p, { symbol: true, bnDigits: bn });
  const n = (v: number) => (bn ? String(v).replace(/\d/gu, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!) : String(v));
  const span = a.months.length;
  if (!a.totalPaisa) return bn ? `গত ${n(span)} মাসে কোনো খরচ লেখা নেই।` : `No spending recorded in the last ${span} months.`;

  const lines: string[] = [];
  lines.push(bn
    ? `গত ${n(span)} মাসে মোট খরচ ${tk(a.totalPaisa)} — মাসে গড়ে ${tk(a.avgPerMonthPaisa)}।`
    : `In the last ${span} months you spent ${tk(a.totalPaisa)} — about ${tk(a.avgPerMonthPaisa)} a month.`);
  lines.push((bn ? 'সবচেয়ে বেশি গেছে: ' : 'Most of it went to: ')
    + a.topCategories.slice(0, 3).map((c) => `${c.category} ${tk(c.totalPaisa)} (${n(c.sharePct)}%)`).join(', ') + (bn ? '।' : '.'));
  if (a.biggestRise) {
    lines.push(bn
      ? `সবচেয়ে বেশি বেড়েছে: ${a.biggestRise.category} (${tk(a.biggestRise.fromPaisa)} → ${tk(a.biggestRise.toPaisa)})।`
      : `Grew the most: ${a.biggestRise.category} (${tk(a.biggestRise.fromPaisa)} → ${tk(a.biggestRise.toPaisa)}).`);
  }
  const top = a.topCategories[0];
  if (top) {
    // Plain arithmetic, not advice from nowhere: a tenth of the biggest category's monthly average.
    const saving = Math.round(top.totalPaisa / span / 10);
    lines.push(bn
      ? `কমানোর একটা হিসাব: "${top.category}"-এ ১০% কমালে মাসে প্রায় ${tk(saving)} বাঁচবে।`
      : `One way to cut: spending 10% less on "${top.category}" saves about ${tk(saving)} a month.`);
  }
  return lines.join('\n');
}
