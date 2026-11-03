// What the records say about how things are going — not what happened, but what it means.
//
// The app is full of numbers and has, until now, had nowhere to say anything about them.
// Insights exist per module, but each one only sees its own table: the debt module cannot
// notice that repayments rose in the same month medical costs did, because it cannot see
// medical costs. `life_events` can see both, so this is where a sentence that spans them
// belongs.
//
// Three rules, deliberately:
//
//   * Nothing is said that the records do not show. Every line here is arithmetic over
//     rows, never a guess about what a person should want.
//   * Nothing is said about a month with too little in it. Two entries are not a trend,
//     and an app that calls two entries a trend is one nobody believes the third time.
//   * Nothing scolds. "Medical spending doubled" is a fact worth surfacing; "you are
//     spending too much on health" is a judgement about someone's mother's illness.

import type { SQLiteDatabase } from 'expo-sqlite';
import { bangladeshMonthKey, shiftMonthKey, type AppLanguage } from '../i18n/date-time';
import { formatPaisa } from './debt/money';

export type AdviceTone = 'GOOD' | 'INFO' | 'WATCH';

export interface Advice {
  id: string;
  tone: AdviceTone;
  /** One sentence. The whole point is that it can be read at a glance. */
  text: string;
  /** The figures behind it, so nothing has to be taken on trust. */
  detail?: string;
}

interface MonthTotals {
  inPaisa: number;
  outPaisa: number;
  byType: Map<string, number>;
  count: number;
}

const OUT_TYPES = ['EXPENSE', 'MEDICAL', 'REPAY', 'LEND', 'ASSET_BUY', 'GIFT_OUT', 'LOSS'];
const IN_TYPES = ['INCOME', 'COLLECT', 'BORROW', 'ASSET_SELL', 'GIFT_IN', 'FOUND'];

/** Everything one month did, read once so nothing below has to query again. */
async function monthTotals(db: SQLiteDatabase, month: string): Promise<MonthTotals> {
  const rows = await db.getAllAsync<{ type: string; total: number; n: number }>(
    `SELECT type, COALESCE(SUM(amount_paisa), 0) AS total, COUNT(*) AS n
       FROM life_events
      WHERE deleted_at IS NULL AND amount_paisa IS NOT NULL
        AND substr(occurred_at, 1, 7) = ?
      GROUP BY type`,
    month,
  );
  const byType = new Map<string, number>();
  let inPaisa = 0; let outPaisa = 0; let count = 0;
  for (const r of rows) {
    const total = Number(r.total);
    byType.set(r.type, total);
    count += Number(r.n);
    if (OUT_TYPES.includes(r.type)) outPaisa += total;
    if (IN_TYPES.includes(r.type)) inPaisa += total;
  }
  return { inPaisa, outPaisa, byType, count };
}

/** A month with almost nothing in it cannot be compared with anything. */
const THIN = 3;

/**
 * What is worth saying about this month, compared with the one before it.
 *
 * Returns few things or none. An assistant that always has five observations is one whose
 * observations mean nothing.
 */
export async function monthlyAdvice(
  db: SQLiteDatabase, language: AppLanguage, month = bangladeshMonthKey(),
): Promise<Advice[]> {
  const bn = language === 'bn';
  const money = (p: number) => formatPaisa(p, { symbol: true, bnDigits: bn });
  const previous = shiftMonthKey(month, -1);
  const [now, before] = await Promise.all([monthTotals(db, month), monthTotals(db, previous)]);

  const out: Advice[] = [];
  if (now.count < THIN) return out;

  // ── is more going out than coming in ───────────────────────────────────────
  if (now.inPaisa > 0 || now.outPaisa > 0) {
    const net = now.inPaisa - now.outPaisa;
    if (net < 0) {
      out.push({
        id: 'net-negative',
        tone: 'WATCH',
        text: bn
          ? `এ মাসে যা এসেছে তার চেয়ে ${money(-net)} বেশি বেরিয়েছে।`
          : `${money(-net)} more went out than came in this month.`,
        detail: bn
          ? `এসেছে ${money(now.inPaisa)} · গেছে ${money(now.outPaisa)}`
          : `In ${money(now.inPaisa)} · out ${money(now.outPaisa)}`,
      });
    } else if (net > 0 && now.inPaisa > 0) {
      out.push({
        id: 'net-positive',
        tone: 'GOOD',
        text: bn
          ? `এ মাসে ${money(net)} হাতে থেকেছে।`
          : `${money(net)} stayed in hand this month.`,
        detail: bn
          ? `এসেছে ${money(now.inPaisa)} · গেছে ${money(now.outPaisa)}`
          : `In ${money(now.inPaisa)} · out ${money(now.outPaisa)}`,
      });
    }
  }

  // ── what changed most since last month ─────────────────────────────────────
  //
  // Only a category that was already meaningful last month, and only a change big enough
  // to be a change: a rise from ten taka to thirty is three hundred percent and nothing.
  if (before.count >= THIN) {
    const MATERIAL = 50_000; // ৳500 in paisa — below this, a swing is noise
    let biggest: { type: string; from: number; to: number; delta: number } | null = null;
    for (const type of OUT_TYPES) {
      const to = now.byType.get(type) ?? 0;
      const from = before.byType.get(type) ?? 0;
      if (Math.max(to, from) < MATERIAL) continue;
      const delta = to - from;
      if (Math.abs(delta) < MATERIAL) continue;
      if (!biggest || Math.abs(delta) > Math.abs(biggest.delta)) biggest = { type, from, to, delta };
    }
    if (biggest) {
      const label = TYPE_WORD(biggest.type, language);
      const rose = biggest.delta > 0;
      out.push({
        id: `shift-${biggest.type}`,
        tone: rose ? 'WATCH' : 'GOOD',
        text: bn
          ? `${label} গত মাসের চেয়ে ${money(Math.abs(biggest.delta))} ${rose ? 'বেড়েছে' : 'কমেছে'}।`
          : `${label} ${rose ? 'rose' : 'fell'} by ${money(Math.abs(biggest.delta))} against last month.`,
        detail: bn
          ? `গত মাস ${money(biggest.from)} → এ মাস ${money(biggest.to)}`
          : `Last month ${money(biggest.from)} → this month ${money(biggest.to)}`,
      });
    }
  }

  // ── borrowed money doing the paying ────────────────────────────────────────
  //
  // The one pattern worth naming outright, because it is the one that compounds: money
  // borrowed in the same month it was repaid means the debt did not fall, it moved.
  const borrowed = now.byType.get('BORROW') ?? 0;
  const repaid = now.byType.get('REPAY') ?? 0;
  if (borrowed > 0 && repaid > 0) {
    out.push({
      id: 'borrow-to-repay',
      tone: 'WATCH',
      text: bn
        ? 'এ মাসে ধার নেওয়াও হয়েছে, ঋণ শোধও হয়েছে — মোট দেনা হয়তো কমেনি।'
        : 'Money was both borrowed and repaid this month — the total owed may not have fallen.',
      detail: bn
        ? `ধার নেওয়া ${money(borrowed)} · শোধ ${money(repaid)}`
        : `Borrowed ${money(borrowed)} · repaid ${money(repaid)}`,
    });
  }

  return out;
}

/** The word for a kind of movement, in the language being spoken. */
function TYPE_WORD(type: string, language: AppLanguage): string {
  const bn = language === 'bn';
  const words: Record<string, [string, string]> = {
    EXPENSE: ['খরচ', 'Spending'],
    MEDICAL: ['চিকিৎসার খরচ', 'Medical spending'],
    REPAY: ['ঋণ পরিশোধ', 'Debt repayment'],
    LEND: ['ধার দেওয়া', 'Lending'],
    ASSET_BUY: ['সম্পদ কেনা', 'Asset purchases'],
    GIFT_OUT: ['উপহার দেওয়া', 'Gifts given'],
    LOSS: ['হারানো টাকা', 'Money lost'],
  };
  const pair = words[type];
  return pair ? (bn ? pair[0] : pair[1]) : type;
}
