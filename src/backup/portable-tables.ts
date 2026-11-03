// Tables a backup carries without anyone having to remember them.
//
// This file exists because of a bug I would rather not repeat. `fin_entries`, `goals`,
// `places`, `follow_ups` and `category_needs` were added to the schema and *not* added to
// the backup, so taking a backup and restoring it would have silently destroyed every
// income and expense entry, every promise, every pinned place and every record of chasing
// a debt. Nothing failed; the data was simply gone.
//
// The cause was that every table had its columns typed out by hand in two places. So the
// copying here is generic: the columns come from the database itself, and adding a table
// to the list below is the only step. A module that adds a table and forgets this list is
// still unprotected — but one line is a much smaller thing to forget than two hand-written
// SQL statements, and the test in `tests/backup-coverage.test.ts` fails when a table in
// the schema is missing from it.
//
// Restoring is deliberately forgiving. A backup written by an older version will not have
// the columns a newer schema added, and one written by a newer version may have columns
// this build has never heard of. Both must restore rather than throw, because the person
// restoring has usually just lost their phone — that is the worst possible moment to be
// strict about a column name.

import type { SQLiteDatabase } from 'expo-sqlite';

export type Row = Record<string, unknown>;

/**
 * Every table copied verbatim by the backup, with the column each is ordered by.
 *
 * Tables handled elsewhere are deliberately absent: `tasks`, `subtasks`, `memories`,
 * `relations`, `people`, `measurements`, `attachments`, `app_metadata` and `app_preferences` have their
 * own hand-written handling in sqlite-reader/sqlite-restore, and the `dr_` tables have
 * `debt-tables.ts`. Duplicating them here would restore them twice.
 */
export const PORTABLE_TABLES: { table: string; orderBy: string }[] = [
  // What the app has learnt about how this person works — their usual times, the
  // corrections they have made, the suggestions they keep dismissing. Losing it does not
  // lose a record, but it does throw away months of the app getting to know them.
  { table: 'learning', orderBy: 'kind, key, value' },
  { table: 'places', orderBy: 'id' },
  { table: 'follow_ups', orderBy: 'id' },
  // Wallets before the entries that point at them: inserting follows this list in
  // order, so parents need to come first the same rule as the Health tables below.
  { table: 'wallets', orderBy: 'position, id' },
  { table: 'fin_entries', orderBy: 'id' },
  { table: 'fin_budgets', orderBy: 'id' },
  { table: 'goals', orderBy: 'id' },
  { table: 'category_needs', orderBy: 'module, category' },

  // Health. Parents before children, because a restore replays this list in order and a
  // dose whose medicine has not arrived yet would be dropped by the foreign key.
  //
  // The costs are not here: a medical expense is a `fin_entries` row, already backed up
  // above. Copying it a second time is exactly the duplication this module was built to
  // make impossible.
  { table: 'hl_prescriptions', orderBy: 'id' },
  { table: 'hl_medicines', orderBy: 'id' },
  { table: 'hl_medicine_times', orderBy: 'medicine_id, seq' },
  { table: 'hl_doses', orderBy: 'due_at, id' },
  { table: 'hl_visits', orderBy: 'id' },
  { table: 'hl_tests', orderBy: 'id' },

  // What happened, as opposed to what it left behind. Last, because an effect row points
  // at an event and an event points at a person, and a restore replays this list in order.
  //
  // Losing these would not lose a taka -- every amount lives in the tables above -- but it
  // would lose every reason. "Why did the wallet drop by five thousand in March" is the
  // question a ledger alone has never been able to answer.
  { table: 'life_events', orderBy: 'occurred_at, id' },
  { table: 'life_event_effects', orderBy: 'event_id, effect_type, effect_id' },
];

/** The columns a table actually has right now, in declaration order. */
export async function tableColumns(db: SQLiteDatabase, table: string): Promise<string[]> {
  try {
    const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    return rows.map((row) => row.name);
  } catch {
    return [];
  }
}

/**
 * Read every portable table.
 *
 * A table that does not exist yet — a backup taken on an older schema — yields nothing
 * rather than failing, so the backup still succeeds.
 */
export async function dumpPortableTables(db: SQLiteDatabase): Promise<Record<string, Row[]>> {
  const out: Record<string, Row[]> = {};
  for (const { table, orderBy } of PORTABLE_TABLES) {
    try {
      // Coerced, because a driver that resolves undefined for an empty table would put
      // `undefined` into the archive — and `undefined` serialises away entirely, so the
      // key would vanish and the restore would treat it as "this backup predates the
      // table" rather than "the table was empty".
      out[table] = (await db.getAllAsync<Row>(`SELECT * FROM ${table} ORDER BY ${orderBy}`)) ?? [];
    } catch {
      out[table] = [];
    }
  }
  return out;
}

/**
 * Write them back.
 *
 * Only tables present in the backup are touched at all: an archive that predates a table
 * must not empty it, because "this backup knows nothing about your expenses" and "you had
 * no expenses" are very different statements.
 *
 * Within a table, a row is inserted using the intersection of its own keys and the
 * columns this build's schema actually has. Unknown keys are dropped, missing ones are
 * left to their defaults, and a single unreadable row is skipped rather than aborting a
 * restore that would otherwise have brought back everything else.
 */
/**
 * Clear every portable table present in the backup, children before parents (the
 * reverse of `PORTABLE_TABLES`' own parents-first order). Split out from insertion --
 * see `restorePortableTables` -- so a caller that also restores tables outside this
 * file (`people`, the `dr_` tables) can run every delete, everywhere, before any
 * insert, anywhere: a portable table and one of those other tables can reference each
 * other in either direction, and only a caller with the full picture can order that
 * correctly. `restoreSQLiteBackupData` is that caller.
 */
export async function deletePortableTables(db: SQLiteDatabase, data: Record<string, unknown>): Promise<void> {
  const present = PORTABLE_TABLES.filter(({ table }) => Object.prototype.hasOwnProperty.call(data, table));
  for (const { table } of [...present].reverse()) {
    if (!(await tableColumns(db, table)).length) continue;
    await db.runAsync(`DELETE FROM ${table}`);
  }
}

/** Insert every portable table present in the backup, parents before children. */
export async function insertPortableTables(
  db: SQLiteDatabase,
  data: Record<string, unknown>,
): Promise<{ table: string; inserted: number; skipped: number }[]> {
  const present = PORTABLE_TABLES.filter(({ table }) => Object.prototype.hasOwnProperty.call(data, table));
  const report: { table: string; inserted: number; skipped: number }[] = [];

  for (const { table } of present) {
    const incoming = Array.isArray(data[table]) ? (data[table] as Row[]) : [];

    const columns = await tableColumns(db, table);
    if (!columns.length) continue; // This build has no such table; nothing to restore into.

    let inserted = 0;
    let skipped = 0;
    for (const row of incoming) {
      if (!row || typeof row !== 'object') { skipped += 1; continue; }
      const usable = columns.filter((column) => Object.prototype.hasOwnProperty.call(row, column));
      if (!usable.length) { skipped += 1; continue; }
      const placeholders = usable.map(() => '?').join(', ');
      const values = usable.map((column) => {
        const value = row[column];
        if (value === null || value === undefined) return null;
        if (typeof value === 'number' || typeof value === 'string') return value;
        if (typeof value === 'boolean') return value ? 1 : 0;
        return String(value);
      });
      try {
        await db.runAsync(
          `INSERT OR REPLACE INTO ${table} (${usable.join(', ')}) VALUES (${placeholders})`,
          ...values,
        );
        inserted += 1;
      } catch {
        skipped += 1;
      }
    }
    report.push({ table, inserted, skipped });
  }

  return report;
}
