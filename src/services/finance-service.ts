// আয়-ব্যয় — what came in and what went out.
//
// Built on the shared foundations rather than beside them: money is integer paisa like the
// debt ledger, the person is a row in `people`, the receipt is an `attachments` row and
// the shop is a `places` row. The module owns exactly one table of its own, which is the
// test of whether the foundations were the right ones.
//
// Unlike the debt ledger this is not append-only. A debt entry is a claim against another
// person, so a correction there has to be a visible reversal; an expense is a note to
// yourself, and making someone reverse-and-re-enter their grocery bill would be cruelty
// dressed as rigour. Edits are edits, deletes are soft, and the trash already restores.

import type { SQLiteDatabase } from 'expo-sqlite';
import { atomic } from '../database/atomic';
import { recordLifeEvent, attachEffect, forgetEventsFor, restoreEventsFor, syncEventAmountForEffect } from './life-event-service';
import { bangladeshMonthKey, shiftMonthKey, businessInstant } from '../i18n/date-time';
import { parseTakaToPaisa, type Paisa } from './debt/money';

export type EntryKind = 'INCOME' | 'EXPENSE';

/**
 * Whose money it was, for money going out. A wallet says where money sits; this says
 * where it came from — so "spent from salary", "spent from a loan", "repaid one loan with
 * another" can be told apart. Five words an ordinary person already uses; the debt
 * module's finer list (salary, freelance, bKash balance…) folds onto these.
 */
export type FundSource = 'INCOME' | 'LOAN' | 'GIFT' | 'SAVINGS' | 'OTHER';
export const FUND_SOURCES: readonly FundSource[] = ['INCOME', 'LOAN', 'GIFT', 'SAVINGS', 'OTHER'];
const FUND_LABELS: Record<FundSource, [string, string]> = {
  INCOME: ['আয়', 'Income'], LOAN: ['ঋণ', 'Loan'], GIFT: ['উপহার', 'Gift'],
  SAVINGS: ['সঞ্চয়', 'Savings'], OTHER: ['অন্যান্য', 'Other'],
};
export const fundSourceLabel = (source: FundSource, bn: boolean): string => FUND_LABELS[source][bn ? 0 : 1];
export const isFundSource = (v: unknown): v is FundSource => typeof v === 'string' && (FUND_SOURCES as readonly string[]).includes(v);

/** The debt module's detailed payment sources, folded onto the five. */
export function fundSourceFromDebtKey(key: string): FundSource {
  switch (key) {
    case 'SALARY': case 'FREELANCE': case 'BUSINESS': return 'INCOME';
    case 'BORROWED': case 'BANK_LOAN': case 'CREDIT': return 'LOAN';
    case 'FAMILY': case 'FRIEND': return 'GIFT';
    case 'SAVINGS': case 'CASH': case 'BANK_BALANCE': return 'SAVINGS';
    default: return 'OTHER';
  }
}

export interface FinanceEntry {
  id: string;
  kind: EntryKind;
  amountPaisa: Paisa;
  category: string;
  method: string | null;
  personId: string | null;
  personName: string | null;
  occurredAt: string;
  note: string | null;
  recurring: string | null;
  /** Which pocket it moved through. Null on entries written before wallets existed. */
  walletId: string | null;
  /** Set on both halves of a wallet-to-wallet move. */
  transferId: string | null;
  /** Whose money went out. Null on entries written before sources existed, and on income. */
  fundSource: FundSource | null;
  /** The loan the money came from, when `fundSource` is LOAN and the person named it. */
  fundAccountId: string | null;
  /** The person's own words when the source is OTHER. */
  fundNote: string | null;
}

interface EntryRow {
  id: string;
  kind: EntryKind;
  amount_paisa: number;
  category: string;
  method: string | null;
  person_id: string | null;
  person_name: string | null;
  occurred_at: string;
  note: string | null;
  recurring: string | null;
  wallet_id: string | null;
  transfer_id: string | null;
  fund_source: string | null;
  fund_account_id: string | null;
  fund_note: string | null;
}

const toEntry = (row: EntryRow): FinanceEntry => ({
  id: row.id,
  kind: row.kind,
  amountPaisa: row.amount_paisa,
  category: row.category,
  method: row.method,
  personId: row.person_id,
  personName: row.person_name,
  occurredAt: row.occurred_at,
  note: row.note,
  recurring: row.recurring,
  walletId: row.wallet_id,
  transferId: row.transfer_id,
  fundSource: isFundSource(row.fund_source) ? row.fund_source : null,
  fundAccountId: row.fund_account_id,
  fundNote: row.fund_note ?? null,
});

const SELECT = `SELECT e.id, e.kind, e.amount_paisa, e.category, e.method, e.person_id,
                       p.name AS person_name, e.occurred_at, e.note, e.recurring,
                       e.wallet_id, e.transfer_id, e.fund_source, e.fund_account_id, e.fund_note
                  FROM fin_entries e
                  LEFT JOIN people p ON p.id = e.person_id`;

const newId = () => `fin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * "2026-09" for a date, which is how budgets and every summary are keyed.
 *
 * Read in Asia/Dhaka, never UTC. Slicing an ISO instant put every entry made between
 * midnight and 6am on the 1st into the month that had just ended — so on the morning the
 * month turned, "this month" showed last month's totals.
 */
export const monthKey = (iso: string | Date = new Date()): string =>
  typeof iso === 'string' && iso.length >= 7 && iso[4] === '-' ? iso.slice(0, 7) : bangladeshMonthKey(iso);

// The categories a first-time user sees. They are suggestions, not a closed list: the
// column is free text, so anyone can type their own and it becomes theirs from then on.
export const SUGGESTED_EXPENSE_CATEGORIES = [
  'বাজার', 'বাসা ভাড়া', 'যাতায়াত', 'বিদ্যুৎ-গ্যাস-পানি', 'মোবাইল-ইন্টারনেট',
  'চিকিৎসা', 'শিক্ষা', 'পোশাক', 'দান-সাহায্য', 'বিনোদন', 'মেরামত', 'অন্যান্য',
];
export const SUGGESTED_INCOME_CATEGORIES = [
  'বেতন', 'ব্যবসা', 'ভাড়া', 'ফসল', 'উপহার', 'বোনাস', 'সুদ-মুনাফা', 'অন্যান্য',
];
export const SUGGESTED_EXPENSE_METHODS = ['নগদ', 'বিকাশ', 'নগদ (অ্যাপ)', 'রকেট', 'ব্যাংক', 'কার্ড', 'বাকিতে'];
export const SUGGESTED_INCOME_METHODS = ['নগদ হাতে', 'বিকাশ', 'নগদ (অ্যাপ)', 'ব্যাংকে জমা', 'চেক', 'মোবাইল ব্যাংকিং'];

/**
 * How often something comes back.
 *
 * Stored as a plain word on the row rather than expanded into future rows. A salary that
 * has not been paid yet is not money you have, and writing next month's rent into the
 * ledger today would make every total a guess. The word is what lets the app say "this
 * one usually repeats" and offer it again when the month turns.
 */
export const RECURRENCES = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type Recurrence = (typeof RECURRENCES)[number];


/**
 * Moving money between your own wallets is neither income nor spending.
 *
 * Kept as a reserved category rather than a flag column so that every existing query has
 * to opt out of it explicitly — a new total that forgets is visible in the SQL, whereas a
 * forgotten `AND is_transfer = 0` reads exactly like code that is correct.
 */
export const TRANSFER_CATEGORY = '__transfer__';
/**
 * Categories that move debt principal rather than earn or consume.
 *
 * They belong in a wallet — the cash really does move — but not in the judgement of how
 * a household is spending. Repaying a loan is not groceries.
 */
export const DEBT_MOVEMENT_CATEGORIES = ['ঋণ পরিশোধ', 'পাওনা আদায়', 'ধার নেওয়া', 'ধার দেওয়া'] as const;
const NOT_DEBT_MOVEMENT = `category NOT IN (${DEBT_MOVEMENT_CATEGORIES.map((c) => `'${c}'`).join(', ')})`;
const NOT_TRANSFER = `category <> '${TRANSFER_CATEGORY}'`;

export interface EntryInput {
  kind: EntryKind;
  /** Either already-parsed paisa, or whatever the user typed. */
  amount: string | number;
  category: string;
  method?: string | null;
  personId?: string | null;
  occurredAt?: string;
  /**
   * The event this entry is one consequence of.
   *
   * Passed by anything that already knows the larger story — a debt repayment, a medicine
   * bought — so the entry joins that event instead of inventing a bare "expense" beside
   * it. Left out by the add-entry screen, where the entry *is* the whole event.
   */
  eventId?: string | null;
  note?: string | null;
  recurring?: string | null;
  walletId?: string | null;
  /** Whose money it was (money going out). */
  fundSource?: FundSource | null;
  fundAccountId?: string | null;
  /** What "other" was, in the person's words (kept only when the source is OTHER). */
  fundNote?: string | null;
}

export async function addEntry(db: SQLiteDatabase, input: EntryInput): Promise<FinanceEntry> {
  return atomic(db, () => addEntryWithin(db, input));
}

async function addEntryWithin(db: SQLiteDatabase, input: EntryInput): Promise<FinanceEntry> {
  const amountPaisa = Math.abs(typeof input.amount === 'number' ? input.amount : parseTakaToPaisa(input.amount));
  if (!amountPaisa) throw new Error('Amount must be more than zero');
  const category = input.category.trim();
  if (!category) throw new Error('A category is required');

  const id = newId();
  const now = new Date().toISOString();
  // `created_at` is a real instant; `occurred_at` is a business date. Defaulting the
  // second to the first put an entry made after midnight in Dhaka on yesterday, and on
  // the first of a month into the month that had just ended.
  const occurredAt = input.occurredAt ?? businessInstant();
  await db.runAsync(
    `INSERT INTO fin_entries (id, kind, amount_paisa, category, method, person_id, occurred_at, note, recurring, wallet_id, fund_source, fund_account_id, fund_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, input.kind, amountPaisa, category, input.method?.trim() || null, input.personId ?? null,
    occurredAt, input.note?.trim() || null, input.recurring ?? null, input.walletId ?? null,
    input.fundSource ?? null, input.fundSource === 'LOAN' ? (input.fundAccountId ?? null) : null,
    input.fundSource === 'OTHER' ? (input.fundNote?.trim() || null) : null, now, now,
  );
  // Every entry belongs to something that happened. Usually that something is the entry
  // itself, and the event is written here; when a bridge already knows the larger story,
  // it hands over its id and the entry joins that instead.
  if (input.eventId) {
    await attachEffect(db, input.eventId, { type: 'FINANCE_ENTRY', id, role: 'MONEY' });
  } else {
    await recordLifeEvent(db, {
      type: input.kind === 'INCOME' ? 'INCOME' : 'EXPENSE',
      occurredAt, title: category, personId: input.personId ?? null,
      destination: input.kind === 'EXPENSE' ? category : null,
      source: input.kind === 'INCOME' ? category : null,
      amountPaisa, note: input.note?.trim() || null,
    }, [{ type: 'FINANCE_ENTRY', id, role: 'MONEY' }]);
  }

  return {
    id, kind: input.kind, amountPaisa, category,
    method: input.method?.trim() || null, personId: input.personId ?? null, personName: null,
    occurredAt, note: input.note?.trim() || null, recurring: input.recurring ?? null,
    walletId: input.walletId ?? null, transferId: null,
    fundSource: input.fundSource ?? null,
    fundAccountId: input.fundSource === 'LOAN' ? (input.fundAccountId ?? null) : null,
    fundNote: input.fundSource === 'OTHER' ? (input.fundNote?.trim() || null) : null,
  };
}

export async function updateEntry(db: SQLiteDatabase, id: string, input: Partial<EntryInput>): Promise<void> {
  return atomic(db, () => updateEntryWithin(db, id, input));
}

async function updateEntryWithin(db: SQLiteDatabase, id: string, input: Partial<EntryInput>): Promise<void> {
  const current = await getEntry(db, id);
  if (!current) throw new Error('That entry no longer exists');
  const amountPaisa = input.amount === undefined
    ? current.amountPaisa
    : Math.abs(typeof input.amount === 'number' ? input.amount : parseTakaToPaisa(input.amount));
  if (!amountPaisa) throw new Error('Amount must be more than zero');
  const occurredAt = input.occurredAt ?? current.occurredAt;
  const nextSource = input.fundSource === undefined ? current.fundSource : input.fundSource;
  await db.runAsync(
    `UPDATE fin_entries SET kind = ?, amount_paisa = ?, category = ?, method = ?, person_id = ?,
            occurred_at = ?, note = ?, recurring = ?, wallet_id = ?, fund_source = ?, fund_account_id = ?, fund_note = ?, updated_at = ?
      WHERE id = ?`,
    input.kind ?? current.kind,
    amountPaisa,
    (input.category ?? current.category).trim(),
    input.method === undefined ? current.method : (input.method?.trim() || null),
    input.personId === undefined ? current.personId : input.personId,
    occurredAt,
    input.note === undefined ? current.note : (input.note?.trim() || null),
    input.recurring === undefined ? current.recurring : input.recurring,
    input.walletId === undefined ? current.walletId : input.walletId,
    nextSource,
    nextSource === 'LOAN' ? (input.fundAccountId === undefined ? current.fundAccountId : input.fundAccountId) : null,
    nextSource === 'OTHER' ? (input.fundNote === undefined ? current.fundNote : (input.fundNote?.trim() || null)) : null,
    new Date().toISOString(),
    id,
  );
  // The life event this entry carries the headline figure for (its own, if it was ever
  // given one, or a larger story's if it was attached to one) must not go on describing an
  // amount or a day this entry no longer agrees with.
  if (amountPaisa !== current.amountPaisa || occurredAt !== current.occurredAt) {
    await syncEventAmountForEffect(db, 'FINANCE_ENTRY', id, amountPaisa, occurredAt);
  }
}

export async function getEntry(db: SQLiteDatabase, id: string): Promise<FinanceEntry | null> {
  const row = await db.getFirstAsync<EntryRow>(`${SELECT} WHERE e.id = ? AND e.deleted_at IS NULL`, id);
  return row ? toEntry(row) : null;
}

export async function deleteEntry(db: SQLiteDatabase, id: string): Promise<boolean> {
  return atomic(db, async () => {
    const now = new Date().toISOString();
    // A transfer is one movement written as two rows sharing a `transfer_id` (see
    // `wallet-service.transfer`). Deleting only the row the user tapped left its other
    // half standing — money that had genuinely only moved between two of the user's own
    // wallets then read as if it had arrived from nowhere, inflating `totalOnHand`. Both
    // halves are deleted together, exactly what a dedicated "undo transfer" already did
    // for the one caller that used it; this is that same rule applied everywhere a
    // transfer entry can be deleted from.
    const row = await db.getFirstAsync<{ transfer_id: string | null }>(
      'SELECT transfer_id FROM fin_entries WHERE id = ? AND deleted_at IS NULL', id,
    );
    if (!row) return false;
    // A transfer's two legs each carry their own TRANSFER life event (one per row, the
    // same shape the migration-v24 backfill gave old transfers) — both ids are needed so
    // neither leg's line is left stranded on the timeline when the pair is deleted together.
    const ids = row.transfer_id
      ? (await db.getAllAsync<{ id: string }>('SELECT id FROM fin_entries WHERE transfer_id = ? AND deleted_at IS NULL', row.transfer_id)).map((r) => r.id)
      : [id];
    const result = row.transfer_id
      ? await db.runAsync('UPDATE fin_entries SET deleted_at = ? WHERE transfer_id = ? AND deleted_at IS NULL', now, row.transfer_id)
      : await db.runAsync('UPDATE fin_entries SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', now, id);
    // An entry that was its own whole story takes that story with it. One that was the
    // bill for something larger -- a visit, a repayment -- leaves the event standing,
    // because the visit still happened.
    if (result.changes > 0) for (const entryId of ids) await forgetEventsFor(db, 'FINANCE_ENTRY', entryId);
    return result.changes > 0;
  });
}

export async function restoreEntry(db: SQLiteDatabase, id: string): Promise<boolean> {
  return atomic(db, async () => {
    // Mirrors deleteEntry: a transfer's two rows were taken down together, so bringing
    // just the one the user tapped in Trash back would leave its twin gone and the wallets
    // permanently disagreeing about a move that, from the user's side, was just undone.
    const row = await db.getFirstAsync<{ transfer_id: string | null }>(
      'SELECT transfer_id FROM fin_entries WHERE id = ? AND deleted_at IS NOT NULL', id,
    );
    if (!row) return false;
    const ids = row.transfer_id
      ? (await db.getAllAsync<{ id: string }>('SELECT id FROM fin_entries WHERE transfer_id = ? AND deleted_at IS NOT NULL', row.transfer_id)).map((r) => r.id)
      : [id];
    const result = row.transfer_id
      ? await db.runAsync('UPDATE fin_entries SET deleted_at = NULL WHERE transfer_id = ?', row.transfer_id)
      : await db.runAsync('UPDATE fin_entries SET deleted_at = NULL WHERE id = ?', id);
    // The life event `deleteEntry` took down alongside this entry (if it was the event's
    // whole story) has to come back too, or the timeline stays missing that day forever.
    if (result.changes > 0) for (const entryId of ids) await restoreEventsFor(db, 'FINANCE_ENTRY', entryId);
    return result.changes > 0;
  });
}

const HEALTH_ENTRY_LINKS = [
  ['hl_visits', 'fee_entry_id'], ['hl_visits', 'extra_entry_id'],
  ['hl_medicines', 'purchase_entry_id'], ['hl_tests', 'entry_id'],
] as const;

async function unlinkHealthRecordsFrom(db: SQLiteDatabase, entryId: string): Promise<void> {
  for (const [table, column] of HEALTH_ENTRY_LINKS) {
    // A schema without the health tables has nothing pointing here.
    try { await db.runAsync(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?`, entryId); } catch { /* no such table */ }
  }
}

export async function purgeEntry(db: SQLiteDatabase, id: string): Promise<boolean> {
  return atomic(db, async () => {
    const row = await db.getFirstAsync<{ transfer_id: string | null }>(
      'SELECT transfer_id FROM fin_entries WHERE id = ? AND deleted_at IS NOT NULL', id,
    );
    if (!row) return false;
    // Health records keep a foreign key to the bill they caused. The visit or medicine
    // still happened, so it stays; it simply stops pointing at an entry that is gone —
    // otherwise the DELETE below throws and the entry can never leave the Trash.
    const ids = row.transfer_id
      ? (await db.getAllAsync<{ id: string }>('SELECT id FROM fin_entries WHERE transfer_id = ? AND deleted_at IS NOT NULL', row.transfer_id)).map((r) => r.id)
      : [id];
    for (const entryId of ids) await unlinkHealthRecordsFrom(db, entryId);
    const result = row.transfer_id
      ? await db.runAsync('DELETE FROM fin_entries WHERE transfer_id = ? AND deleted_at IS NOT NULL', row.transfer_id)
      : await db.runAsync('DELETE FROM fin_entries WHERE id = ? AND deleted_at IS NOT NULL', id);
    return result.changes > 0;
  });
}

export interface EntryQuery {
  kind?: EntryKind;
  /** Include the two halves of wallet transfers. Off by default: "what did I spend on"
   *  should not be padded with money that only moved between your own pockets. */
  includeTransfers?: boolean;
  walletId?: string;
  month?: string;
  category?: string;
  personId?: string;
  search?: string;
  limit?: number;
}

export async function listEntries(db: SQLiteDatabase, query: EntryQuery = {}): Promise<FinanceEntry[]> {
  const where: string[] = ['e.deleted_at IS NULL'];
  const args: (string | number)[] = [];
  if (!query.includeTransfers) where.push(`e.category <> '${TRANSFER_CATEGORY}'`);
  if (query.walletId) { where.push('e.wallet_id = ?'); args.push(query.walletId); }
  if (query.kind) { where.push('e.kind = ?'); args.push(query.kind); }
  if (query.month) { where.push('substr(e.occurred_at, 1, 7) = ?'); args.push(query.month); }
  if (query.category) { where.push('e.category = ?'); args.push(query.category); }
  if (query.personId) { where.push('e.person_id = ?'); args.push(query.personId); }
  if (query.search?.trim()) {
    where.push('(e.category LIKE ? OR e.note LIKE ? OR p.name LIKE ?)');
    const like = `%${query.search.trim()}%`;
    args.push(like, like, like);
  }
  args.push(query.limit ?? 200);
  const rows = await db.getAllAsync<EntryRow>(
    `${SELECT} WHERE ${where.join(' AND ')} ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT ?`,
    ...args,
  );
  return rows.map(toEntry);
}

export interface MonthSummary {
  month: string;
  /** What was actually earned. Borrowing is not earning, so it is not in here. */
  incomePaisa: Paisa;
  /** What was actually consumed. Repaying a loan is not consuming, so nor is that. */
  expensePaisa: Paisa;
  /** Income minus expense. Negative means the month was lived beyond its means. */
  netPaisa: Paisa;
  /** Borrowed in / collected back — money that arrived but was never earned. */
  debtInPaisa: Paisa;
  /** Repaid / lent out — money that left but was never spent. */
  debtOutPaisa: Paisa;
  entryCount: number;
}

/**
 * A month, told honestly.
 *
 * The hard part is not the addition, it is deciding what a number means. Borrowing ৳5,000
 * puts ৳5,000 in your pocket, and a summary that files it under income will tell you that
 * the month you went into debt was the month you earned most — and that you saved it all,
 * because nothing was spent. Repaying that loan is the mirror: money leaves, but you have
 * not consumed anything; you have swapped cash for a smaller debt.
 *
 * So the four debt-movement categories are reported on their own two lines. The wallet
 * still counts every one of them, because the cash genuinely moved; `netPaisa` does not,
 * because it answers a different question — did this month pay for itself?
 */
export async function summariseMonth(db: SQLiteDatabase, month = monthKey()): Promise<MonthSummary> {
  const rows = await db.getAllAsync<{ kind: EntryKind; isDebt: number; total: number; n: number }>(
    `SELECT kind, (CASE WHEN ${NOT_DEBT_MOVEMENT} THEN 0 ELSE 1 END) AS isDebt,
            SUM(amount_paisa) AS total, COUNT(*) AS n
       FROM fin_entries
      WHERE deleted_at IS NULL AND ${NOT_TRANSFER} AND substr(occurred_at, 1, 7) = ?
      GROUP BY kind, isDebt`,
    month,
  );
  const pick = (kind: EntryKind, isDebt: number) =>
    rows.find((r) => r.kind === kind && Number(r.isDebt) === isDebt)?.total ?? 0;
  const income = pick('INCOME', 0);
  const expense = pick('EXPENSE', 0);
  return {
    month,
    incomePaisa: income,
    expensePaisa: expense,
    netPaisa: income - expense,
    debtInPaisa: pick('INCOME', 1),
    debtOutPaisa: pick('EXPENSE', 1),
    entryCount: rows.reduce((sum, r) => sum + r.n, 0),
  };
}

// ── where the money came from ────────────────────────────────────────────────────

export interface SourceTotal { source: FundSource | null; totalPaisa: Paisa }

/**
 * This month's spending by whose money paid for it. The same rows, month and exclusions
 * as `summariseMonth`'s expense figure, so the parts always add up to that total; what
 * nobody has said the source of is its own line (`source: null`), never guessed.
 */
export async function spendingBySource(db: SQLiteDatabase, month = monthKey()): Promise<SourceTotal[]> {
  const rows = await db.getAllAsync<{ source: string | null; total: number }>(
    `SELECT fund_source AS source, SUM(amount_paisa) AS total
       FROM fin_entries
      WHERE deleted_at IS NULL AND kind = 'EXPENSE' AND ${NOT_TRANSFER} AND ${NOT_DEBT_MOVEMENT}
        AND substr(occurred_at, 1, 7) = ?
      GROUP BY fund_source`,
    month,
  );
  return foldSources(rows.map((r) => ({ source: isFundSource(r.source) ? r.source : null, totalPaisa: r.total })));
}

/**
 * This month's loan repayments by whose money paid them — the line that shows one loan
 * being repaid with another. The debt ledger's own per-payment sources win; a payment
 * written from the money book instead carries its source on the wallet entry; anything
 * else is "not known".
 */
export async function repaymentBySource(db: SQLiteDatabase, month = monthKey()): Promise<SourceTotal[]> {
  const payments = await db.getAllAsync<{ id: string; amount: number; linked: string | null }>(
    `SELECT t.id, t.amount_paisa AS amount,
            (SELECT e.fund_source FROM relations r JOIN fin_entries e ON e.id = r.from_id AND e.deleted_at IS NULL
              WHERE r.from_type = 'FINANCE_ENTRY' AND r.to_type = 'DEBT_TRANSACTION' AND r.to_id = t.id LIMIT 1) AS linked
       FROM dr_transactions t
      WHERE t.deleted_at IS NULL AND t.reversed = 0 AND t.kind = 'PAYMENT' AND substr(t.txn_date, 1, 7) = ?`,
    month,
  ).catch(() => [] as { id: string; amount: number; linked: string | null }[]);
  const out: SourceTotal[] = [];
  for (const p of payments) {
    const parts = await db.getAllAsync<{ key: string; amount: number }>(
      'SELECT source_key AS key, amount_paisa AS amount FROM dr_transaction_sources WHERE transaction_id = ?', p.id,
    ).catch(() => [] as { key: string; amount: number }[]);
    if (parts.length) {
      let covered = 0;
      for (const part of parts) { out.push({ source: fundSourceFromDebtKey(part.key), totalPaisa: part.amount }); covered += part.amount; }
      if (p.amount > covered) out.push({ source: null, totalPaisa: p.amount - covered });
    } else {
      out.push({ source: isFundSource(p.linked) ? p.linked : null, totalPaisa: p.amount });
    }
  }
  return foldSources(out);
}

/** One line per source, biggest first, "not known" last. */
function foldSources(parts: SourceTotal[]): SourceTotal[] {
  const map = new Map<FundSource | null, number>();
  for (const p of parts) if (p.totalPaisa > 0) map.set(p.source, (map.get(p.source) ?? 0) + p.totalPaisa);
  return [...map.entries()]
    .map(([source, totalPaisa]) => ({ source, totalPaisa }))
    .sort((a, b) => (a.source === null ? 1 : b.source === null ? -1 : b.totalPaisa - a.totalPaisa));
}

/**
 * Money-book entries missing what makes the money traceable: a wallet on any movement, a
 * source on money going out. Entries whose linked loan payment already names its sources
 * in the debt ledger are not asked again. Oldest first — the order they happened.
 */
export async function entriesMissingMoneyDetails(db: SQLiteDatabase): Promise<(FinanceEntry & { missingWallet: boolean; missingSource: boolean })[]> {
  const rows = await db.getAllAsync<EntryRow>(
    `${SELECT}
      WHERE e.deleted_at IS NULL AND e.${NOT_TRANSFER}
        AND (e.wallet_id IS NULL
             OR (e.kind = 'EXPENSE' AND e.fund_source IS NULL
                 AND NOT EXISTS (SELECT 1 FROM relations r JOIN dr_transaction_sources s ON s.transaction_id = r.to_id
                                  WHERE r.from_type = 'FINANCE_ENTRY' AND r.from_id = e.id AND r.to_type = 'DEBT_TRANSACTION')))
      ORDER BY e.occurred_at ASC, e.created_at ASC`,
  );
  return rows.map((row) => {
    const entry = toEntry(row);
    return { ...entry, missingWallet: !entry.walletId, missingSource: entry.kind === 'EXPENSE' && !entry.fundSource };
  });
}

export interface CategoryTotal { category: string; totalPaisa: Paisa; count: number; share: number }

/** Where a month's money went, biggest first, with each slice's share of the whole. */
export async function categoryBreakdown(
  db: SQLiteDatabase,
  kind: EntryKind = 'EXPENSE',
  month = monthKey(),
): Promise<CategoryTotal[]> {
  const rows = await db.getAllAsync<{ category: string; total: number; n: number }>(
    `SELECT category, SUM(amount_paisa) AS total, COUNT(*) AS n
       FROM fin_entries
      WHERE deleted_at IS NULL AND ${NOT_TRANSFER} AND ${NOT_DEBT_MOVEMENT}
        AND kind = ? AND substr(occurred_at, 1, 7) = ?
      GROUP BY category ORDER BY total DESC`,
    kind, month,
  );
  const grand = rows.reduce((sum, r) => sum + r.total, 0) || 1;
  return rows.map((r) => ({ category: r.category, totalPaisa: r.total, count: r.n, share: r.total / grand }));
}

/** The last `count` months, oldest first — enough for a trend line without a chart library. */
export async function recentMonths(db: SQLiteDatabase, count = 6): Promise<MonthSummary[]> {
  const months: string[] = [];
  const current = bangladeshMonthKey();
  for (let i = 0; i < count; i += 1) months.unshift(shiftMonthKey(current, -i));
  const out: MonthSummary[] = [];
  for (const month of months) out.push(await summariseMonth(db, month));
  return out;
}

/** Categories the user has actually used, most-used first, ahead of the suggestions. */
export async function usedCategories(db: SQLiteDatabase, kind: EntryKind): Promise<string[]> {
  const rows = await db.getAllAsync<{ category: string }>(
    `SELECT category FROM fin_entries WHERE deleted_at IS NULL AND ${NOT_TRANSFER} AND kind = ?
      GROUP BY category ORDER BY COUNT(*) DESC LIMIT 24`,
    kind,
  );
  const used = rows.map((r) => r.category);
  const suggested = kind === 'EXPENSE' ? SUGGESTED_EXPENSE_CATEGORIES : SUGGESTED_INCOME_CATEGORIES;
  return [...used, ...suggested.filter((c) => !used.includes(c))];
}

/** Ways of paying the user has actually used, most-used first, then the suggestions. */
export async function usedMethods(db: SQLiteDatabase, kind: EntryKind): Promise<string[]> {
  const rows = await db.getAllAsync<{ method: string }>(
    `SELECT method FROM fin_entries
      WHERE deleted_at IS NULL AND ${NOT_TRANSFER} AND kind = ? AND method IS NOT NULL AND trim(method) <> ''
      GROUP BY method ORDER BY COUNT(*) DESC LIMIT 16`,
    kind,
  );
  const used = rows.map((r) => r.method);
  const suggested = kind === 'EXPENSE' ? SUGGESTED_EXPENSE_METHODS : SUGGESTED_INCOME_METHODS;
  return [...used, ...suggested.filter((m) => !used.includes(m))];
}

/**
 * Entries that repeat and have not been written down again this month.
 *
 * This is what turns the recurrence word into something useful: at the start of a month
 * the rent, the salary and the school fee are offered back rather than retyped. It only
 * suggests — nothing is ever written to the ledger on the app's own initiative, because a
 * figure the user did not enter is a figure they cannot trust.
 */
export async function dueAgain(db: SQLiteDatabase, month = monthKey()): Promise<FinanceEntry[]> {
  const rows = await db.getAllAsync<EntryRow>(
    `${SELECT}
      WHERE e.deleted_at IS NULL
        AND e.category <> '${TRANSFER_CATEGORY}'
        AND e.recurring IS NOT NULL AND e.recurring <> 'NONE'
        AND substr(e.occurred_at, 1, 7) < ?
        AND NOT EXISTS (
          SELECT 1 FROM fin_entries later
           WHERE later.deleted_at IS NULL
             AND later.category = e.category
             AND later.kind = e.kind
             AND substr(later.occurred_at, 1, 7) = ?
        )
      GROUP BY e.category, e.kind
      ORDER BY e.occurred_at DESC
      LIMIT 8`,
    month, month,
  );
  return rows.map(toEntry);
}

/** What a category means to this person's life. Used to tell needs from wants. */
export type Need = 'ESSENTIAL' | 'NEEDED' | 'WANT';
export const NEEDS: Need[] = ['ESSENTIAL', 'NEEDED', 'WANT'];

/**
 * How this person has classified their categories.
 *
 * The app never decides what is unnecessary — a motorbike is a luxury to one person and
 * the only way to work for another. Anything unclassified counts as NEEDED, the middle
 * answer, because assuming someone's spending is frivolous is the worse mistake.
 */
export async function categoryNeeds(db: SQLiteDatabase): Promise<Map<string, Need>> {
  const rows = await db.getAllAsync<{ category: string; need: Need }>(
    "SELECT category, need FROM category_needs WHERE module = 'finance'",
  );
  return new Map(rows.map((r) => [r.category, r.need]));
}

export async function setCategoryNeed(db: SQLiteDatabase, category: string, need: Need): Promise<void> {
  await db.runAsync(
    `INSERT INTO category_needs (module, category, need, updated_at) VALUES ('finance', ?, ?, ?)
     ON CONFLICT (module, category) DO UPDATE SET need = excluded.need, updated_at = excluded.updated_at`,
    category.trim(), need, new Date().toISOString(),
  );
}

export async function getCategoryNeed(db: SQLiteDatabase, category: string): Promise<Need> {
  const row = await db.getFirstAsync<{ need: Need }>(
    "SELECT need FROM category_needs WHERE module = 'finance' AND category = ?", category.trim(),
  );
  return row?.need ?? 'NEEDED';
}

/** A month's spending split by what it was for. */
export interface NeedSplit { essentialPaisa: Paisa; neededPaisa: Paisa; wantPaisa: Paisa }

export async function spendingByNeed(db: SQLiteDatabase, month = monthKey()): Promise<NeedSplit> {
  const [rows, needs] = await Promise.all([
    db.getAllAsync<{ category: string; total: number }>(
      `SELECT category, SUM(amount_paisa) AS total FROM fin_entries
        WHERE deleted_at IS NULL AND ${NOT_TRANSFER} AND ${NOT_DEBT_MOVEMENT}
          AND kind = 'EXPENSE' AND substr(occurred_at, 1, 7) = ?
        GROUP BY category`,
      month,
    ),
    categoryNeeds(db),
  ]);
  const split: NeedSplit = { essentialPaisa: 0, neededPaisa: 0, wantPaisa: 0 };
  for (const row of rows) {
    const need = needs.get(row.category) ?? 'NEEDED';
    if (need === 'ESSENTIAL') split.essentialPaisa += row.total;
    else if (need === 'WANT') split.wantPaisa += row.total;
    else split.neededPaisa += row.total;
  }
  return split;
}

// ── budgets ──────────────────────────────────────────────────────────────────
//
// A budget is stored per category per month, with the literal month `*` meaning "every
// month unless a specific one overrides it" — so someone sets ৳৮০০০ for বাজার once and
// only revisits it in the month Eid falls in.

export interface BudgetStatus {
  category: string;
  limitPaisa: Paisa;
  spentPaisa: Paisa;
  /** Above 1 means the budget is already overspent. */
  ratio: number;
}

export async function setBudget(db: SQLiteDatabase, category: string, limit: string | number, month = '*'): Promise<void> {
  const limitPaisa = Math.abs(typeof limit === 'number' ? limit : parseTakaToPaisa(limit));
  const now = new Date().toISOString();
  if (!limitPaisa) {
    await db.runAsync('DELETE FROM fin_budgets WHERE category = ? AND month = ?', category, month);
    return;
  }
  await db.runAsync(
    `INSERT INTO fin_budgets (id, category, month, limit_paisa, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (category, month) DO UPDATE SET limit_paisa = excluded.limit_paisa, updated_at = excluded.updated_at`,
    `bud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, category, month, limitPaisa, now, now,
  );
}

export async function budgetStatus(db: SQLiteDatabase, month = monthKey()): Promise<BudgetStatus[]> {
  const budgets = await db.getAllAsync<{ category: string; month: string; limit_paisa: number }>(
    'SELECT category, month, limit_paisa FROM fin_budgets WHERE month = ? OR month = ?', month, '*',
  );
  // A month-specific limit wins over the standing one.
  const chosen = new Map<string, number>();
  for (const b of budgets) {
    if (b.month === month || !chosen.has(b.category)) chosen.set(b.category, b.limit_paisa);
  }
  const spend = await categoryBreakdown(db, 'EXPENSE', month);
  const spent = new Map(spend.map((s) => [s.category, s.totalPaisa]));
  return [...chosen.entries()]
    .map(([category, limitPaisa]) => {
      const spentPaisa = spent.get(category) ?? 0;
      return { category, limitPaisa, spentPaisa, ratio: spentPaisa / limitPaisa };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

/**
 * The category of the newest ordinary expense — what "আগেরবারের মতো" / "same as last time"
 * points at when the Assistant opens with no conversation of its own yet. Transfers and
 * debt principal are not spending, so they are never what "last time" meant.
 */
export async function lastExpenseCategory(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ category: string }>(
    `SELECT category FROM fin_entries
      WHERE kind = 'EXPENSE' AND deleted_at IS NULL AND ${NOT_TRANSFER} AND ${NOT_DEBT_MOVEMENT}
      ORDER BY occurred_at DESC, created_at DESC LIMIT 1`,
  );
  return row?.category ?? null;
}
