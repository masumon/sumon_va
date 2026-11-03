// Raw SQLite access for the Personal Debt & Receivable module. One file, one row-mapper
// per table, thin CRUD. No business rules here — those live in debt-service.ts. Every
// read excludes soft-deleted rows (`deleted_at IS NULL`) where the column exists.
//
// People are the exception: they moved to the app-wide `people` table in v17, because a
// person is the most reused thing in anyone's life and owning them here meant typing the
// same person again for a task, a memory or a doctor. Writes go to `people`; reads still
// name `dr_people`, which is now a view of it, so the rest of this file is unchanged.

import type { SQLiteDatabase } from 'expo-sqlite';
import { atomic } from '../../database/atomic';
import { personHasLiveRecords } from '../people-service';
import { deleteAttachmentFiles } from '../attachment-service';
import type {
  Account,
  Allocation,
  CreateAccountInput,
  CreatePersonInput,
  Installment,
  Person,
  PromiseToPay,
  Target,
  Transaction,
  TransactionSource,
  TxnKind,
} from './types';

const now = () => new Date().toISOString();
const uid = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const int = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const reqStr = (v: unknown): string => String(v ?? '');
const reqInt = (v: unknown): number => Number(v ?? 0);
const bool = (v: unknown): boolean => Number(v ?? 0) === 1;

// ── people ─────────────────────────────────────────────────────────────────────

function toPerson(r: Row): Person {
  return {
    id: reqStr(r.id), name: reqStr(r.name), phone: str(r.phone), address: str(r.address),
    relationship: str(r.relationship), notes: str(r.notes),
    createdAt: reqStr(r.created_at), updatedAt: reqStr(r.updated_at), deletedAt: str(r.deleted_at),
  };
}

export async function createPerson(db: SQLiteDatabase, input: CreatePersonInput): Promise<Person> {
  const name = input.name.trim();
  if (!name) throw new Error('ব্যক্তির নাম দিন / Name is required');
  const id = uid('per');
  const ts = now();
  await db.runAsync(
    `INSERT INTO people (id, name, phone, address, relationship, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, name, input.phone?.trim() || null, input.address?.trim() || null,
    input.relationship?.trim() || null, input.notes?.trim() || null, ts, ts,
  );
  return (await getPerson(db, id))!;
}

export async function getPerson(db: SQLiteDatabase, id: string): Promise<Person | null> {
  const r = await db.getFirstAsync<Row>('SELECT * FROM dr_people WHERE id = ? AND deleted_at IS NULL LIMIT 1', id);
  return r ? toPerson(r) : null;
}

export async function listPeople(db: SQLiteDatabase): Promise<Person[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM dr_people WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE ASC');
  return rows.map(toPerson);
}

export async function updatePerson(db: SQLiteDatabase, id: string, patch: Partial<CreatePersonInput>): Promise<Person | null> {
  const cur = await getPerson(db, id);
  if (!cur) return null;
  const next = {
    name: patch.name?.trim() ?? cur.name,
    phone: patch.phone === undefined ? cur.phone : (patch.phone?.trim() || null),
    address: patch.address === undefined ? cur.address : (patch.address?.trim() || null),
    relationship: patch.relationship === undefined ? cur.relationship : (patch.relationship?.trim() || null),
    notes: patch.notes === undefined ? cur.notes : (patch.notes?.trim() || null),
  };
  if (!next.name) throw new Error('ব্যক্তির নাম দিন / Name is required');
  await db.runAsync(
    `UPDATE people SET name=?, phone=?, address=?, relationship=?, notes=?, updated_at=? WHERE id=?`,
    next.name, next.phone, next.address, next.relationship, next.notes, now(), id,
  );
  return getPerson(db, id);
}

export async function softDeletePerson(db: SQLiteDatabase, id: string): Promise<boolean> {
  // Guard: a person with any live account, wallet entry, or life event can't be removed —
  // shared with `people-service.deletePerson` so both entry points block on the same set
  // of records instead of two copies quietly drifting apart (this one used to check only
  // dr_accounts, so a person named on a plain expense or a life event was still removable).
  if (await personHasLiveRecords(db, id)) {
    throw new Error('এই ব্যক্তির সক্রিয় হিসাব আছে / This person still has accounts');
  }
  const r = await db.runAsync('UPDATE people SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL', now(), now(), id);
  return (r.changes ?? 0) > 0;
}

// ── accounts ───────────────────────────────────────────────────────────────────

function toAccount(r: Row): Account {
  return {
    id: reqStr(r.id), direction: reqStr(r.direction) as Account['direction'], personId: reqStr(r.person_id),
    title: str(r.title), principalPaisa: reqInt(r.principal_paisa),
    openedDate: str(r.opened_date), openedDateText: str(r.opened_date_text),
    interestType: reqStr(r.interest_type) as Account['interestType'],
    interestRateBps: int(r.interest_rate_bps),
    interestPeriod: str(r.interest_period) as Account['interestPeriod'],
    compoundPeriod: str(r.compound_period) as Account['compoundPeriod'],
    interestBasis: (str(r.interest_basis) as Account['interestBasis']) ?? 'ORIGINAL',
    manualTotalPayablePaisa: int(r.manual_total_payable_paisa),
    firstDueDate: str(r.first_due_date), finalDueDate: str(r.final_due_date),
    purpose: str(r.purpose), priority: reqStr(r.priority) as Account['priority'],
    priorityRank: int(r.priority_rank), status: reqStr(r.status) as Account['status'],
    settledPaisa: int(r.settled_paisa), closedAt: str(r.closed_at), notes: str(r.notes),
    createdAt: reqStr(r.created_at), updatedAt: reqStr(r.updated_at), deletedAt: str(r.deleted_at),
  };
}

/** A rate that is NaN or negative is not a rate — store nothing rather than poison the row. */
function sanitiseBps(bps: number | null | undefined): number | null {
  if (bps === null || bps === undefined) return null;
  if (!Number.isFinite(bps) || bps < 0) return null;
  return Math.round(bps);
}

export async function insertAccount(db: SQLiteDatabase, input: CreateAccountInput): Promise<Account> {
  if (!Number.isSafeInteger(input.principalPaisa) || input.principalPaisa <= 0) {
    throw new Error('মূল টাকার পরিমাণ সঠিক নয় / Principal amount is invalid');
  }
  const id = uid('acc');
  const ts = now();
  await db.runAsync(
    `INSERT INTO dr_accounts
       (id, direction, person_id, title, principal_paisa, opened_date, opened_date_text,
        interest_type, interest_rate_bps, interest_period, compound_period, interest_basis,
        manual_total_payable_paisa,
        first_due_date, final_due_date, purpose, priority, priority_rank, status, settled_paisa,
        notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, input.direction, input.personId, input.title?.trim() || null, input.principalPaisa,
    input.openedDate ?? null, input.openedDateText ?? null,
    input.interestType ?? 'NONE', sanitiseBps(input.interestRateBps), input.interestPeriod ?? null,
    input.compoundPeriod ?? null, input.interestBasis ?? 'ORIGINAL', input.manualTotalPayablePaisa ?? null,
    input.firstDueDate ?? null, input.finalDueDate ?? null, input.purpose?.trim() || null,
    input.priority ?? 'MEDIUM', input.priorityRank ?? null, 'ACTIVE', null,
    input.notes?.trim() || null, ts, ts,
  );
  return (await getAccount(db, id))!;
}

export async function getAccount(db: SQLiteDatabase, id: string): Promise<Account | null> {
  const r = await db.getFirstAsync<Row>('SELECT * FROM dr_accounts WHERE id = ? AND deleted_at IS NULL LIMIT 1', id);
  return r ? toAccount(r) : null;
}

export async function listAccounts(
  db: SQLiteDatabase,
  filter: { direction?: Account['direction']; personId?: string } = {},
): Promise<Account[]> {
  const where = ['deleted_at IS NULL'];
  const args: (string | number | null)[] = [];
  if (filter.direction) { where.push('direction = ?'); args.push(filter.direction); }
  if (filter.personId) { where.push('person_id = ?'); args.push(filter.personId); }
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM dr_accounts WHERE ${where.join(' AND ')} ORDER BY created_at DESC`, ...args,
  );
  return rows.map(toAccount);
}

export async function patchAccount(db: SQLiteDatabase, id: string, fields: Partial<Record<
  'title' | 'openedDate' | 'openedDateText' | 'interestType' | 'interestRateBps' | 'interestPeriod'
  | 'compoundPeriod' | 'manualTotalPayablePaisa' | 'firstDueDate' | 'finalDueDate' | 'purpose'
  | 'priority' | 'priorityRank' | 'status' | 'settledPaisa' | 'notes' | 'principalPaisa'
  | 'interestBasis' | 'closedAt' | 'personId', unknown>>): Promise<Account | null> {
  const map: Record<string, string> = {
    title: 'title', openedDate: 'opened_date', openedDateText: 'opened_date_text', interestType: 'interest_type',
    interestRateBps: 'interest_rate_bps', interestPeriod: 'interest_period', compoundPeriod: 'compound_period',
    manualTotalPayablePaisa: 'manual_total_payable_paisa', firstDueDate: 'first_due_date', finalDueDate: 'final_due_date',
    purpose: 'purpose', priority: 'priority', priorityRank: 'priority_rank', status: 'status',
    settledPaisa: 'settled_paisa', notes: 'notes', principalPaisa: 'principal_paisa',
    interestBasis: 'interest_basis', closedAt: 'closed_at', personId: 'person_id',
  };
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = map[k];
    if (!col) continue;
    sets.push(`${col} = ?`);
    // NaN would bind as NULL on some drivers and as garbage on others; neither is a value.
    args.push(typeof v === 'number' && !Number.isFinite(v) ? null : ((v ?? null) as string | number | null));
  }
  if (!sets.length) return getAccount(db, id);
  sets.push('updated_at = ?');
  args.push(now(), id);
  await db.runAsync(`UPDATE dr_accounts SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, ...args);
  return getAccount(db, id);
}

/**
 * Retire an account, without destroying anything.
 *
 * Every part of it is marked with the same instant: the account, its ledger, its schedule
 * and its promises. Instalments and promises used to be deleted outright here — they had
 * no `deleted_at` to hide behind, and rows nobody could hide went on appearing in the
 * calendar forever. That made Trash a lie for this module: the account came back, and the
 * repayment schedule it came back without was the one thing a person cannot rebuild from
 * memory.
 *
 * The shared instant is what makes the way back exact. `restoreAccount` clears only the
 * rows stamped at that moment, so a promise deleted by hand last week stays deleted.
 */
export async function softDeleteAccount(db: SQLiteDatabase, id: string): Promise<boolean> {
  return atomic(db, async () => {
    const ts = now();
    const r = await db.runAsync('UPDATE dr_accounts SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL', ts, ts, id);
    if ((r.changes ?? 0) > 0) {
      await db.runAsync('UPDATE dr_transactions SET deleted_at=? WHERE account_id=? AND deleted_at IS NULL', ts, id);
      await db.runAsync('UPDATE dr_installments SET deleted_at=? WHERE account_id=? AND deleted_at IS NULL', ts, id);
      await db.runAsync('UPDATE dr_promises SET deleted_at=? WHERE account_id=? AND deleted_at IS NULL', ts, id);
    }
    return (r.changes ?? 0) > 0;
  });
}

/**
 * Bring a retired account back whole — ledger, schedule and promises together.
 *
 * Only what this account's own deletion marked: matching on that instant is what stops a
 * restore from resurrecting a transaction the user had reversed months earlier.
 */
export async function restoreAccount(db: SQLiteDatabase, id: string): Promise<boolean> {
  return atomic(db, async () => {
    const row = await db.getFirstAsync<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM dr_accounts WHERE id = ?', id,
    );
    const ts = row?.deleted_at;
    if (!ts) return false;
    await db.runAsync('UPDATE dr_accounts SET deleted_at=NULL, updated_at=? WHERE id=?', now(), id);
    for (const table of ['dr_transactions', 'dr_installments', 'dr_promises']) {
      await db.runAsync(`UPDATE ${table} SET deleted_at=NULL WHERE account_id=? AND deleted_at=?`, id, ts);
    }
    return true;
  });
}

// ── installments ───────────────────────────────────────────────────────────────

function toInstallment(r: Row): Installment {
  return {
    id: reqStr(r.id), accountId: reqStr(r.account_id), seq: reqInt(r.seq),
    dueDate: str(r.due_date), amountPaisa: reqInt(r.amount_paisa), note: str(r.note),
    createdAt: reqStr(r.created_at), updatedAt: reqStr(r.updated_at),
  };
}

export interface InstallmentRowInput {
  /** Present for a row that already exists. Its id is preserved so allocations stay attached. */
  id?: string | null;
  seq: number;
  dueDate?: string | null;
  amountPaisa: number;
  note?: string | null;
}

/** How much has been paid against each instalment of an account. */
export async function paidByInstallment(db: SQLiteDatabase, accountId: string): Promise<Map<string, number>> {
  const rows = await db.getAllAsync<{ installment_id: string; paid: number }>(
    `SELECT al.installment_id AS installment_id, SUM(al.amount_paisa) AS paid
       FROM dr_allocations al
       JOIN dr_transactions t ON t.id = al.transaction_id
      WHERE t.account_id = ? AND t.deleted_at IS NULL AND t.reversed = 0 AND al.installment_id IS NOT NULL
      GROUP BY al.installment_id`,
    accountId,
  );
  return new Map(rows.map((r) => [r.installment_id, Number(r.paid)]));
}

/**
 * Bring an account's schedule in line with `plan`, in place.
 *
 * The old implementation deleted every instalment and re-inserted the lot. That is fine
 * for a brand-new account and impossible for any other: `dr_allocations.installment_id`
 * references these rows and foreign keys are on, so the DELETE fails outright the moment
 * a single payment has been allocated — rescheduling was unreachable in practice.
 *
 * So: rows that already exist keep their id and are updated, new rows are inserted, and a
 * row that has disappeared from the plan is deleted only when nothing has been paid into
 * it. An instalment can never be shrunk below what has already been paid against it —
 * that would leave the schedule claiming less than the ledger records.
 */
export async function replaceInstallments(
  db: SQLiteDatabase, accountId: string, plan: InstallmentRowInput[],
): Promise<void> {
  const existing = await listInstallments(db, accountId);
  const paid = await paidByInstallment(db, accountId);
  const keep = new Set(plan.map((p) => p.id).filter((id): id is string => !!id));
  const known = new Set(existing.map((i) => i.id));
  const ts = now();

  await atomic(db, async () => {
    for (const row of existing) {
      if (keep.has(row.id)) continue;
      const paidHere = paid.get(row.id) ?? 0;
      if (paidHere > 0) {
        throw new Error('এই কিস্তিতে টাকা জমা আছে, মোছা যাবে না / This instalment has payments against it');
      }
      await db.runAsync('DELETE FROM dr_installments WHERE id = ?', row.id);
    }

    for (const p of plan) {
      if (p.amountPaisa <= 0) continue;
      if (p.id && known.has(p.id)) {
        const paidHere = paid.get(p.id) ?? 0;
        if (p.amountPaisa < paidHere) {
          throw new Error('কিস্তির অঙ্ক জমা টাকার চেয়ে কম হতে পারে না / An instalment cannot be less than what is already paid into it');
        }
        await db.runAsync(
          'UPDATE dr_installments SET seq = ?, due_date = ?, amount_paisa = ?, note = ?, updated_at = ? WHERE id = ?',
          p.seq, p.dueDate ?? null, p.amountPaisa, p.note?.trim() || null, ts, p.id,
        );
      } else {
        await db.runAsync(
          `INSERT INTO dr_installments (id, account_id, seq, due_date, amount_paisa, note, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)`,
          uid('ins'), accountId, p.seq, p.dueDate ?? null, p.amountPaisa, p.note?.trim() || null, ts, ts,
        );
      }
    }
  });
}

export async function listInstallments(db: SQLiteDatabase, accountId: string): Promise<Installment[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM dr_installments WHERE account_id = ? AND deleted_at IS NULL ORDER BY seq ASC', accountId);
  return rows.map(toInstallment);
}

// ── transactions + allocations + sources ───────────────────────────────────────

function toTransaction(r: Row): Transaction {
  return {
    id: reqStr(r.id), kind: reqStr(r.kind) as TxnKind, accountId: reqStr(r.account_id), personId: reqStr(r.person_id),
    amountPaisa: reqInt(r.amount_paisa), adjSign: int(r.adj_sign) as 1 | -1 | null, txnDate: reqStr(r.txn_date),
    method: str(r.method), reference: str(r.reference), note: str(r.note),
    reversesTxnId: str(r.reverses_txn_id), reversed: bool(r.reversed),
    createdAt: reqStr(r.created_at), deletedAt: str(r.deleted_at),
  };
}
function toAllocation(r: Row): Allocation {
  return {
    id: reqStr(r.id), transactionId: reqStr(r.transaction_id), installmentId: str(r.installment_id),
    amountPaisa: reqInt(r.amount_paisa), role: reqStr(r.role) as Allocation['role'],
  };
}
function toSource(r: Row): TransactionSource {
  return {
    id: reqStr(r.id), transactionId: reqStr(r.transaction_id), sourceKey: reqStr(r.source_key),
    amountPaisa: reqInt(r.amount_paisa), linkedAccountId: str(r.linked_account_id), note: str(r.note),
  };
}

export interface InsertTxnInput {
  kind: TxnKind;
  accountId: string;
  personId: string;
  amountPaisa: number;
  txnDate: string;
  adjSign?: 1 | -1 | null;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  reversesTxnId?: string | null;
  allocations?: { installmentId?: string | null; amountPaisa: number; role?: Allocation['role'] }[];
  sources?: { sourceKey: string; amountPaisa: number; linkedAccountId?: string | null; note?: string | null }[];
}

/** Insert one ledger row plus its allocation and source child rows, atomically. */
export async function insertTransaction(db: SQLiteDatabase, input: InsertTxnInput): Promise<Transaction> {
  const id = uid('txn');
  const ts = now();
  await atomic(db, async () => {
    await db.runAsync(
      `INSERT INTO dr_transactions
         (id, kind, account_id, person_id, amount_paisa, adj_sign, txn_date, method, reference, note,
          reverses_txn_id, reversed, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?)`,
      id, input.kind, input.accountId, input.personId, input.amountPaisa, input.adjSign ?? null,
      input.txnDate, input.method ?? null, input.reference ?? null, input.note ?? null,
      input.reversesTxnId ?? null, ts,
    );
    for (const a of input.allocations ?? []) {
      if (a.amountPaisa <= 0) continue;
      await db.runAsync(
        `INSERT INTO dr_allocations (id, transaction_id, installment_id, amount_paisa, role) VALUES (?,?,?,?,?)`,
        uid('alc'), id, a.installmentId ?? null, a.amountPaisa, a.role ?? (a.installmentId ? 'INSTALLMENT' : 'PRINCIPAL'),
      );
    }
    for (const s of input.sources ?? []) {
      if (s.amountPaisa <= 0) continue;
      await db.runAsync(
        `INSERT INTO dr_transaction_sources (id, transaction_id, source_key, amount_paisa, linked_account_id, note)
         VALUES (?,?,?,?,?,?)`,
        uid('src'), id, s.sourceKey, s.amountPaisa, s.linkedAccountId ?? null, s.note ?? null,
      );
    }
  });
  return (await db.getFirstAsync<Row>('SELECT * FROM dr_transactions WHERE id = ?', id).then((r) => (r ? toTransaction(r) : null)))!;
}

/** One ledger row by id, soft-deleted rows included so a correction can still see it. */
export async function listLedgerById(db: SQLiteDatabase, id: string): Promise<Transaction | null> {
  const r = await db.getFirstAsync<Row>('SELECT * FROM dr_transactions WHERE id = ? LIMIT 1', id);
  return r ? toTransaction(r) : null;
}

export async function listAccountTransactions(db: SQLiteDatabase, accountId: string): Promise<Transaction[]> {
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM dr_transactions WHERE account_id = ? AND deleted_at IS NULL ORDER BY txn_date ASC, created_at ASC', accountId,
  );
  return rows.map(toTransaction);
}

export async function listAccountAllocations(db: SQLiteDatabase, accountId: string): Promise<Allocation[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT al.* FROM dr_allocations al
     JOIN dr_transactions t ON t.id = al.transaction_id
     WHERE t.account_id = ? AND t.deleted_at IS NULL AND t.reversed = 0`, accountId,
  );
  return rows.map(toAllocation);
}

export async function listTransactionSources(db: SQLiteDatabase, transactionId: string): Promise<TransactionSource[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM dr_transaction_sources WHERE transaction_id = ?', transactionId);
  return rows.map(toSource);
}

export async function markTransactionReversed(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('UPDATE dr_transactions SET reversed = 1 WHERE id = ?', id);
}

export async function listLedger(
  db: SQLiteDatabase,
  opts: { limit?: number; offset?: number; fromDate?: string; toDate?: string; accountId?: string; personId?: string; kinds?: TxnKind[] } = {},
): Promise<Transaction[]> {
  const where = ['deleted_at IS NULL'];
  const args: (string | number | null)[] = [];
  if (opts.fromDate) { where.push('txn_date >= ?'); args.push(opts.fromDate); }
  if (opts.toDate) { where.push('txn_date <= ?'); args.push(opts.toDate); }
  if (opts.accountId) { where.push('account_id = ?'); args.push(opts.accountId); }
  if (opts.personId) { where.push('person_id = ?'); args.push(opts.personId); }
  if (opts.kinds?.length) {
    where.push(`kind IN (${opts.kinds.map(() => '?').join(',')})`);
    args.push(...opts.kinds);
  }
  const limit = Math.max(1, Math.min(opts.limit ?? 200, 1000));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM dr_transactions WHERE ${where.join(' AND ')} ORDER BY txn_date DESC, created_at DESC LIMIT ? OFFSET ?`,
    ...args, limit, offset,
  );
  return rows.map(toTransaction);
}

/** How many ledger rows match, so a list can say "showing 200 of 1,240". */
export async function countLedger(
  db: SQLiteDatabase,
  opts: { fromDate?: string; toDate?: string; accountId?: string; personId?: string } = {},
): Promise<number> {
  const where = ['deleted_at IS NULL'];
  const args: (string | number | null)[] = [];
  if (opts.fromDate) { where.push('txn_date >= ?'); args.push(opts.fromDate); }
  if (opts.toDate) { where.push('txn_date <= ?'); args.push(opts.toDate); }
  if (opts.accountId) { where.push('account_id = ?'); args.push(opts.accountId); }
  if (opts.personId) { where.push('person_id = ?'); args.push(opts.personId); }
  const r = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM dr_transactions WHERE ${where.join(' AND ')}`, ...args,
  );
  return Number(r?.n ?? 0);
}

// ── promises / targets / settings ──────────────────────────────────────────────

function toPromise(r: Row): PromiseToPay {
  return {
    id: reqStr(r.id), accountId: reqStr(r.account_id), amountPaisa: reqInt(r.amount_paisa),
    promisedDate: reqStr(r.promised_date), followUpDate: str(r.follow_up_date),
    status: reqStr(r.status) as PromiseToPay['status'], note: str(r.note),
    createdAt: reqStr(r.created_at), updatedAt: reqStr(r.updated_at),
  };
}
export async function createPromise(
  db: SQLiteDatabase, input: { accountId: string; amountPaisa: number; promisedDate: string; followUpDate?: string | null; note?: string | null },
): Promise<PromiseToPay> {
  const id = uid('pms');
  const ts = now();
  await db.runAsync(
    `INSERT INTO dr_promises (id, account_id, amount_paisa, promised_date, follow_up_date, status, note, created_at, updated_at)
     VALUES (?,?,?,?,?, 'OPEN', ?,?,?)`,
    id, input.accountId, input.amountPaisa, input.promisedDate, input.followUpDate ?? null, input.note ?? null, ts, ts,
  );
  return (await db.getFirstAsync<Row>('SELECT * FROM dr_promises WHERE id = ? AND deleted_at IS NULL', id).then((r) => (r ? toPromise(r) : null)))!;
}
export async function listPromises(db: SQLiteDatabase, accountId?: string): Promise<PromiseToPay[]> {
  const rows = accountId
    ? await db.getAllAsync<Row>('SELECT * FROM dr_promises WHERE account_id = ? AND deleted_at IS NULL ORDER BY promised_date ASC', accountId)
    : await db.getAllAsync<Row>('SELECT * FROM dr_promises WHERE deleted_at IS NULL ORDER BY promised_date ASC');
  return rows.map(toPromise);
}
export async function setPromiseStatus(db: SQLiteDatabase, id: string, status: PromiseToPay['status']): Promise<void> {
  await db.runAsync('UPDATE dr_promises SET status = ?, updated_at = ? WHERE id = ?', status, now(), id);
}

function toTarget(r: Row): Target {
  return {
    id: reqStr(r.id), periodType: reqStr(r.period_type) as Target['periodType'], periodKey: reqStr(r.period_key),
    kind: reqStr(r.kind) as Target['kind'], targetValue: reqInt(r.target_value), note: str(r.note),
    createdAt: reqStr(r.created_at), updatedAt: reqStr(r.updated_at),
  };
}
export async function upsertTarget(
  db: SQLiteDatabase,
  input: { periodType: Target['periodType']; periodKey: string; kind: Target['kind']; targetValue: number; note?: string | null },
): Promise<Target> {
  const ts = now();
  await db.runAsync(
    `INSERT INTO dr_targets (id, period_type, period_key, kind, target_value, note, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(period_type, period_key, kind) DO UPDATE SET target_value = excluded.target_value, note = excluded.note, updated_at = excluded.updated_at`,
    uid('tgt'), input.periodType, input.periodKey, input.kind, input.targetValue, input.note ?? null, ts, ts,
  );
  const r = await db.getFirstAsync<Row>(
    'SELECT * FROM dr_targets WHERE period_type = ? AND period_key = ? AND kind = ?',
    input.periodType, input.periodKey, input.kind,
  );
  return toTarget(r!);
}
export async function listTargets(db: SQLiteDatabase): Promise<Target[]> {
  const rows = await db.getAllAsync<Row>('SELECT * FROM dr_targets ORDER BY period_key DESC');
  return rows.map(toTarget);
}
export async function getTarget(db: SQLiteDatabase, periodType: Target['periodType'], periodKey: string, kind: Target['kind']): Promise<Target | null> {
  const r = await db.getFirstAsync<Row>(
    'SELECT * FROM dr_targets WHERE period_type = ? AND period_key = ? AND kind = ?', periodType, periodKey, kind,
  );
  return r ? toTarget(r) : null;
}

export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM dr_settings WHERE key = ?', key);
  return r ? r.value : null;
}
export async function setSetting(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO dr_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, value,
  );
}
export async function allSettings(db: SQLiteDatabase): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM dr_settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ── audit ──────────────────────────────────────────────────────────────────────

export async function writeAudit(
  db: SQLiteDatabase,
  entry: { entityType: string; entityId: string; field: string; oldValue?: string | null; newValue?: string | null; action: 'CREATE' | 'UPDATE' | 'DELETE' | 'REVERSE' },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO dr_audit (id, entity_type, entity_id, field, old_value, new_value, action, at)
     VALUES (?,?,?,?,?,?,?,?)`,
    uid('aud'), entry.entityType, entry.entityId, entry.field, entry.oldValue ?? null, entry.newValue ?? null, entry.action, now(),
  );
}

export interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  action: string;
  at: string;
}

/** The change history for one entity, newest first. */
export async function listAudit(db: SQLiteDatabase, entityType: string, entityId: string, limit = 50): Promise<AuditEntry[]> {
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM dr_audit WHERE entity_type = ? AND entity_id = ? ORDER BY at DESC LIMIT ?',
    entityType, entityId, Math.max(1, Math.min(limit, 500)),
  );
  return rows.map((r) => ({
    id: reqStr(r.id), entityType: reqStr(r.entity_type), entityId: reqStr(r.entity_id),
    field: reqStr(r.field), oldValue: str(r.old_value), newValue: str(r.new_value),
    action: reqStr(r.action), at: reqStr(r.at),
  }));
}

/** Everything ever recorded against an account, including its own transactions' entries. */
export async function listAccountAudit(db: SQLiteDatabase, accountId: string, limit = 60): Promise<AuditEntry[]> {
  const rows = await db.getAllAsync<Row>(
    `SELECT a.* FROM dr_audit a
      WHERE (a.entity_type = 'account' AND a.entity_id = ?)
         OR (a.entity_type = 'transaction' AND a.entity_id IN (SELECT id FROM dr_transactions WHERE account_id = ?))
      ORDER BY a.at DESC LIMIT ?`,
    accountId, accountId, Math.max(1, Math.min(limit, 500)),
  );
  return rows.map((r) => ({
    id: reqStr(r.id), entityType: reqStr(r.entity_type), entityId: reqStr(r.entity_id),
    field: reqStr(r.field), oldValue: str(r.old_value), newValue: str(r.new_value),
    action: reqStr(r.action), at: reqStr(r.at),
  }));
}

/**
 * Purge every child row of an account that soft-delete would otherwise strand.
 *
 * Returns the files of the attachment rows it removed, for the caller to delete from disk
 * once the transaction has committed — a rollback must not leave rows pointing at files
 * that are already gone. (This used to delete from `dr_attachments`, a table v16 dropped,
 * so every permanent delete of a debt account threw and the 30-day expiry never ran.)
 */
export async function purgeAccountChildren(db: SQLiteDatabase, accountId: string): Promise<{ uri: string }[]> {
  await db.runAsync(
    `DELETE FROM dr_allocations WHERE transaction_id IN (SELECT id FROM dr_transactions WHERE account_id = ?)`,
    accountId,
  );
  await db.runAsync(
    `DELETE FROM dr_transaction_sources WHERE transaction_id IN (SELECT id FROM dr_transactions WHERE account_id = ?)`,
    accountId,
  );
  // A payment on another account that was funded by this loan keeps its record; it just
  // stops naming a loan that no longer exists (the foreign key would block the delete).
  await db.runAsync('UPDATE dr_transaction_sources SET linked_account_id = NULL WHERE linked_account_id = ?', accountId);
  await db.runAsync('DELETE FROM dr_installments WHERE account_id = ?', accountId);
  await db.runAsync('DELETE FROM dr_promises WHERE account_id = ?', accountId);
  const ownerFilter = `(owner_type = 'DEBT_ACCOUNT' AND owner_id = ?)
      OR (owner_type = 'DEBT_TRANSACTION' AND owner_id IN (SELECT id FROM dr_transactions WHERE account_id = ?))`;
  try {
    const files = await db.getAllAsync<{ uri: string }>(`SELECT uri FROM attachments WHERE ${ownerFilter}`, accountId, accountId);
    await db.runAsync(`DELETE FROM attachments WHERE ${ownerFilter}`, accountId, accountId);
    return files;
  } catch {
    return []; // no attachment store on this schema
  }
}

/**
 * Destroy a retired account for good — children first, so the foreign keys hold.
 *
 * Trash's generic purge is one DELETE on the parent table, which for this module could
 * only ever throw: every ledger row, instalment and promise points back at the account.
 * That left an account in Trash that could not be emptied and could not expire.
 */
export async function purgeAccount(db: SQLiteDatabase, id: string): Promise<boolean> {
  let files: { uri: string }[] = [];
  const purged = await atomic(db, async () => {
    const row = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM dr_accounts WHERE id = ? AND deleted_at IS NOT NULL', id,
    );
    if (!row) return false;
    files = await purgeAccountChildren(db, id);
    await db.runAsync('DELETE FROM dr_transactions WHERE account_id = ?', id);
    await db.runAsync('DELETE FROM dr_accounts WHERE id = ?', id);
    return true;
  });
  // After the commit, as the attachment store does: the rows are gone for good now.
  if (purged && files.length) await deleteAttachmentFiles(files).catch(() => 0);
  return purged;
}

export { uid as newDrId };
