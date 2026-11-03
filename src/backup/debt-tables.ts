// Backup coverage for the Debt & Receivable domain.
//
// The archive stores a copy of database.sqlite, but restore replays the row data in
// the manifest — so a table that is not read here is a table that does not survive a
// restore. Every `dr_` table is listed explicitly (rather than discovered at runtime)
// so a schema change has to be mirrored here deliberately, not silently missed.
//
// The payload lives under an optional `debt` key: older app versions ignore it, and
// this version treats its absence as "an older backup", so both directions keep working.

import type { SQLiteDatabase } from 'expo-sqlite';

/** table -> columns, in insert order. Mirrors migration v17 — `dr_people` became the app-wide `people` table and
 * `dr_attachments` merged into `attachments`, so neither is part of this set any more — `dr_attachments`
 * was merged into the app-wide `attachments` table and is no longer part of this set. */
export const DEBT_TABLES: Record<string, string[]> = {
  dr_accounts: ['id', 'direction', 'person_id', 'title', 'principal_paisa', 'opened_date', 'opened_date_text', 'interest_type', 'interest_rate_bps', 'interest_period', 'compound_period', 'interest_basis', 'manual_total_payable_paisa', 'first_due_date', 'final_due_date', 'purpose', 'priority', 'priority_rank', 'status', 'settled_paisa', 'closed_at', 'notes', 'created_at', 'updated_at', 'deleted_at'],
  dr_installments: ['id', 'account_id', 'seq', 'due_date', 'amount_paisa', 'note', 'created_at', 'updated_at', 'deleted_at'],
  dr_transactions: ['id', 'kind', 'account_id', 'person_id', 'amount_paisa', 'adj_sign', 'txn_date', 'method', 'reference', 'note', 'reverses_txn_id', 'reversed', 'created_at', 'deleted_at'],
  dr_allocations: ['id', 'transaction_id', 'installment_id', 'amount_paisa', 'role'],
  dr_transaction_sources: ['id', 'transaction_id', 'source_key', 'amount_paisa', 'linked_account_id', 'note'],
  dr_promises: ['id', 'account_id', 'amount_paisa', 'promised_date', 'follow_up_date', 'status', 'note', 'created_at', 'updated_at', 'deleted_at'],
  dr_targets: ['id', 'period_type', 'period_key', 'kind', 'target_value', 'note', 'created_at', 'updated_at'],
  dr_settings: ['key', 'value'],
  dr_audit: ['id', 'entity_type', 'entity_id', 'field', 'old_value', 'new_value', 'action', 'at'],
};

export type DebtBackupData = Record<string, Record<string, unknown>[]>;

/**
 * Read every `dr_` table. Returns `{}` when the tables are absent (a database still on
 * a pre-v13 schema), so a backup taken there is simply a backup without debt data.
 */
export async function readDebtTables(db: SQLiteDatabase): Promise<DebtBackupData> {
  const out: DebtBackupData = {};
  for (const [table, columns] of Object.entries(DEBT_TABLES)) {
    try {
      const list = await db.getAllAsync<Record<string, unknown>>(`SELECT ${columns.join(', ')} FROM ${table}`);
      if (!Array.isArray(list)) return {};
      out[table] = list;
    } catch {
      return {}; // no dr_ schema at all — nothing to back up
    }
  }
  return out;
}

function cell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') return value;
  throw new Error('Backup debt cell must be a string, number, boolean or null');
}

/** Validate the shape of a `debt` payload before any of it is written. */
export function validateDebtBackup(value: unknown): DebtBackupData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Backup debt data must be an object');
  const input = value as Record<string, unknown>;
  const out: DebtBackupData = {};
  for (const table of Object.keys(input)) {
    if (!DEBT_TABLES[table]) throw new Error(`Unknown debt table in backup: ${table}`);
    const list = input[table];
    if (!Array.isArray(list) || list.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
      throw new Error(`Backup debt table ${table} must be an array of objects`);
    }
    out[table] = list as Record<string, unknown>[];
  }
  return out;
}

/**
 * Clear every `dr_` table, child-table-first. Split out from insertion -- see
 * `restoreDebtTables` -- because `dr_accounts` and `dr_transactions` also reference
 * `people`, a table this file does not own: only a caller with the full picture
 * (`restoreSQLiteBackupData`) can run this before `DELETE FROM people` and still insert
 * people back before this module's own rows need somewhere to point.
 */
export async function deleteDebtTables(db: SQLiteDatabase): Promise<void> {
  for (const table of [...Object.keys(DEBT_TABLES)].reverse()) {
    await db.runAsync(`DELETE FROM ${table}`);
  }
}

/** Insert every `dr_` table present in `data`, parent-table-first. */
export async function insertDebtTables(db: SQLiteDatabase, data: DebtBackupData): Promise<number> {
  let inserted = 0;
  for (const [table, columns] of Object.entries(DEBT_TABLES)) {
    const placeholders = columns.map(() => '?').join(',');
    for (const row of data[table] ?? []) {
      await db.runAsync(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`, ...columns.map((col) => cell(row[col])));
      inserted += 1;
    }
  }
  return inserted;
}

/**
 * Replace the debt domain with the backup's rows. Must be called inside the caller's
 * transaction — deletion runs child-table-first so foreign keys stay satisfied.
 *
 * Kept as a single call for direct debt-only use (tests, and any future caller that
 * only touches this module); `restoreSQLiteBackupData` calls the two halves above
 * separately instead, so it can interleave them correctly with `people`.
 */
export async function restoreDebtTables(db: SQLiteDatabase, data: DebtBackupData): Promise<number> {
  await deleteDebtTables(db);
  return insertDebtTables(db, data);
}
