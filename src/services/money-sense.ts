// Four small pieces of arithmetic that change what a person does.
//
// Each exists because the data was already there and the answer was not. Nothing here
// invents a number; every function is a different question asked of rows the user wrote
// themselves.

import type { SQLiteDatabase } from 'expo-sqlite';
import type { Paisa } from './debt/money';
import { categoryBreakdown, monthKey, spendingByNeed, summariseMonth, TRANSFER_CATEGORY } from './finance-service';

// ── the month, closed out ────────────────────────────────────────────────────

export interface MonthClose {
  month: string;
  incomePaisa: Paisa;
  expensePaisa: Paisa;
  netPaisa: Paisa;
  /** Against the month before: positive means you kept more than last time. */
  netChangePaisa: Paisa;
  spendChangePaisa: Paisa;
  /** The category that moved most against last month, and by how much. */
  biggestMover: { category: string; changePaisa: Paisa } | null;
  essentialShare: number;
  wantShare: number;
  entryCount: number;
}

/**
 * How the month went, and how that compares with the one before.
 *
 * A single month's figures are data; a month against its predecessor is a story, and a
 * story is what someone will act on. The comparison is the whole point of the screen.
 */
export async function closeOutMonth(db: SQLiteDatabase, month = monthKey()): Promise<MonthClose> {
  const previous = shiftMonth(month, -1);
  const [now, before, needs, nowCats, beforeCats] = await Promise.all([
    summariseMonth(db, month),
    summariseMonth(db, previous),
    spendingByNeed(db, month),
    categoryBreakdown(db, 'EXPENSE', month),
    categoryBreakdown(db, 'EXPENSE', previous),
  ]);

  const spent = needs.essentialPaisa + needs.neededPaisa + needs.wantPaisa || 1;

  // Compare like for like: every category either month saw, so something that appeared
  // for the first time counts as the full amount rather than being invisible.
  let biggestMover: MonthClose['biggestMover'] = null;
  const categories = new Set([...nowCats.map((c) => c.category), ...beforeCats.map((c) => c.category)]);
  for (const category of categories) {
    const nowTotal = nowCats.find((c) => c.category === category)?.totalPaisa ?? 0;
    const beforeTotal = beforeCats.find((c) => c.category === category)?.totalPaisa ?? 0;
    const change = nowTotal - beforeTotal;
    if (!biggestMover || Math.abs(change) > Math.abs(biggestMover.changePaisa)) {
      biggestMover = { category, changePaisa: change };
    }
  }

  return {
    month,
    incomePaisa: now.incomePaisa,
    expensePaisa: now.expensePaisa,
    netPaisa: now.netPaisa,
    netChangePaisa: now.netPaisa - before.netPaisa,
    spendChangePaisa: now.expensePaisa - before.expensePaisa,
    biggestMover: biggestMover && biggestMover.changePaisa !== 0 ? biggestMover : null,
    essentialShare: needs.essentialPaisa / spent,
    wantShare: needs.wantPaisa / spent,
    entryCount: now.entryCount,
  };
}

function shiftMonth(key: string, by: number): string {
  const [year = 1970, month = 1] = key.split('-').map(Number);
  const date = new Date(year, month - 1 + by, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// ── what things used to cost ─────────────────────────────────────────────────

export interface PriceMemory {
  category: string;
  lastPaisa: Paisa;
  lastAt: string;
  /** The typical amount, so one unusual month does not become the reference. */
  typicalPaisa: Paisa;
  times: number;
}

/**
 * What this category usually costs, and what it cost last time.
 *
 * The median rather than the mean: one wedding gift in the বাজার category would drag an
 * average up for a year, and the question being answered is "does this look normal",
 * which a middle value answers and an average does not.
 */
export async function priceMemory(db: SQLiteDatabase, category: string): Promise<PriceMemory | null> {
  const name = category.trim();
  if (!name || name === TRANSFER_CATEGORY) return null;

  const rows = await db.getAllAsync<{ amount_paisa: number; occurred_at: string }>(
    `SELECT amount_paisa, occurred_at FROM fin_entries
      WHERE deleted_at IS NULL AND kind = 'EXPENSE' AND category = ?
      ORDER BY occurred_at DESC LIMIT 12`,
    name,
  );
  if (!rows.length) return null;

  const sorted = rows.map((row) => row.amount_paisa).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const typical = sorted.length % 2
    ? sorted[middle]!
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);

  return {
    category: name,
    lastPaisa: rows[0]!.amount_paisa,
    lastAt: rows[0]!.occurred_at,
    typicalPaisa: typical,
    times: rows.length,
  };
}

// ── income that does not arrive on the same day every month ──────────────────

export interface IncomeShape {
  /** The middle of the last few months, which is what to plan against. */
  typicalPaisa: Paisa;
  lowestPaisa: Paisa;
  highestPaisa: Paisa;
  monthsSeen: number;
  /** True when the months differ enough that a single figure would mislead. */
  irregular: boolean;
}

/**
 * What a month usually brings in, for people whose income is not a salary.
 *
 * A farmer, a trader and a day labourer do not earn the same amount twice, and planning
 * against last month alone is how a good month becomes next month's shortfall. The median
 * of recent months is the honest planning figure, and the spread is reported alongside so
 * the app can say "this varies" rather than pretending to a precision it does not have.
 */
export async function incomeShape(db: SQLiteDatabase, months = 6): Promise<IncomeShape | null> {
  const rows = await db.getAllAsync<{ month: string; total: number }>(
    `SELECT substr(occurred_at, 1, 7) AS month, SUM(amount_paisa) AS total
       FROM fin_entries
      WHERE deleted_at IS NULL AND kind = 'INCOME' AND category <> ?
      GROUP BY month ORDER BY month DESC LIMIT ?`,
    TRANSFER_CATEGORY, months,
  );
  if (rows.length < 2) return null;

  const totals = rows.map((row) => row.total).sort((a, b) => a - b);
  const middle = Math.floor(totals.length / 2);
  const typical = totals.length % 2
    ? totals[middle]!
    : Math.round(((totals[middle - 1] ?? 0) + (totals[middle] ?? 0)) / 2);
  const lowest = totals[0] ?? 0;
  const highest = totals[totals.length - 1] ?? 0;

  return {
    typicalPaisa: typical,
    lowestPaisa: lowest,
    highestPaisa: highest,
    monthsSeen: rows.length,
    // A quarter's swing either side is where a single number stops being useful.
    irregular: typical > 0 && (highest - lowest) / typical > 0.5,
  };
}

// ── zakat ────────────────────────────────────────────────────────────────────

export interface ZakatEstimate {
  /** What is counted as wealth: savings on hand plus what people owe you. */
  assetsPaisa: Paisa;
  /** Debts you owe, which come off before the calculation. */
  liabilitiesPaisa: Paisa;
  netPaisa: Paisa;
  /** The threshold below which none is due. */
  nisabPaisa: Paisa;
  duePaisa: Paisa;
  eligible: boolean;
  /** What the app could not know and the person must add themselves. */
  missing: string[];
}

/** Zakat is one fortieth — 2.5% — of qualifying wealth held for a lunar year. */
export const ZAKAT_RATE = 0.025;

/**
 * An estimate, offered as arithmetic rather than as a ruling.
 *
 * The app knows what is in the wallets, what people owe the user and what the user owes.
 * It does not know about gold, land, business stock or the lunar year, and it says so
 * rather than quietly producing a smaller number — a figure that looks authoritative and
 * is missing half the assets is worse than no figure at all.
 *
 * `nisabPaisa` is supplied by the caller because it tracks the price of silver or gold and
 * changes constantly; nothing offline can know today's rate.
 */
export async function estimateZakat(db: SQLiteDatabase, nisabPaisa: Paisa): Promise<ZakatEstimate> {
  const [walletRow, receivableRow, debtRow] = await Promise.all([
    db.getFirstAsync<{ total: number }>(
      `SELECT COALESCE(SUM(w.opening_paisa), 0)
              + COALESCE((SELECT SUM(CASE WHEN kind = 'INCOME' THEN amount_paisa ELSE -amount_paisa END)
                            FROM fin_entries WHERE deleted_at IS NULL AND wallet_id IS NOT NULL), 0) AS total
         FROM wallets w WHERE w.archived_at IS NULL`,
    ).catch(() => null),
    db.getFirstAsync<{ total: number }>(
      `SELECT COALESCE(SUM(a.principal_paisa - COALESCE((
                SELECT SUM(t.amount_paisa) FROM dr_transactions t
                 WHERE t.account_id = a.id AND t.deleted_at IS NULL AND t.kind IN ('REPAYMENT','COLLECTION')
              ), 0)), 0) AS total
         FROM dr_accounts a
        WHERE a.deleted_at IS NULL AND a.closed_at IS NULL AND a.direction = 'RECEIVABLE'`,
    ).catch(() => null),
    db.getFirstAsync<{ total: number }>(
      `SELECT COALESCE(SUM(a.principal_paisa - COALESCE((
                SELECT SUM(t.amount_paisa) FROM dr_transactions t
                 WHERE t.account_id = a.id AND t.deleted_at IS NULL AND t.kind IN ('REPAYMENT','COLLECTION')
              ), 0)), 0) AS total
         FROM dr_accounts a
        WHERE a.deleted_at IS NULL AND a.closed_at IS NULL AND a.direction <> 'RECEIVABLE'`,
    ).catch(() => null),
  ]);

  const wallets = Math.max(0, walletRow?.total ?? 0);
  const receivable = Math.max(0, receivableRow?.total ?? 0);
  const liabilities = Math.max(0, debtRow?.total ?? 0);

  const assets = wallets + receivable;
  const net = Math.max(0, assets - liabilities);
  const eligible = nisabPaisa > 0 && net >= nisabPaisa;

  return {
    assetsPaisa: assets,
    liabilitiesPaisa: liabilities,
    netPaisa: net,
    nisabPaisa,
    duePaisa: eligible ? Math.round(net * ZAKAT_RATE) : 0,
    eligible,
    // Named plainly, because the user has to add these themselves for the figure to mean
    // anything, and a silent omission would make the estimate quietly wrong.
    missing: ['gold', 'silver', 'land', 'business stock', 'lunar year'],
  };
}
