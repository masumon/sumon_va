import type { SQLiteDatabase } from 'expo-sqlite';
import { readDebtTables, type DebtBackupData } from './debt-tables';
import { dumpPortableTables, type Row } from './portable-tables';

export interface SQLiteBackupData {
  appMetadata: Record<string, unknown>[];
  appPreferences: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  subtasks: Record<string, unknown>[];
  memories: Record<string, unknown>[];
  notificationDeliveries: Record<string, unknown>[];
  relations: Record<string, unknown>[];
  /** Everyone the user knows, shared by every module. Empty before v17. */
  people: Record<string, unknown>[];
  /** Health, study and habit readings, plus their targets. Empty before v16. */
  measurements: Record<string, unknown>[];
  measurementTargets: Record<string, unknown>[];
  /** Every `dr_` table; `{}` on a database still on a pre-v13 schema. */
  debt: DebtBackupData;
  /**
   * Everything else, copied verbatim — income and expenses, promises, places, follow-ups.
   *
   * Kept generic on purpose: these used to be typed out by hand, and the tables added in
   * migrations 18 and 19 were simply forgotten, which would have destroyed them on the
   * first restore. See `portable-tables.ts`.
   */
  tables: Record<string, Row[]>;
  schemaVersion: number;
}

export async function readSQLiteBackupData(db: SQLiteDatabase): Promise<SQLiteBackupData> {
  const [appMetadata, appPreferences, tasks, subtasks, memories, notificationDeliveries, relations, people, measurements, measurementTargets, versionRow] = await Promise.all([
    db.getAllAsync<Record<string, unknown>>('SELECT key, value, updated_at FROM app_metadata ORDER BY key ASC'),
    db.getAllAsync<Record<string, unknown>>("SELECT key, value FROM app_preferences WHERE key <> 'autoBackupPassphrase' ORDER BY key ASC"),
    db.getAllAsync<Record<string, unknown>>('SELECT * FROM tasks ORDER BY id ASC'),
    db.getAllAsync<Record<string, unknown>>('SELECT * FROM subtasks ORDER BY task_id ASC, position ASC, id ASC'),
    db.getAllAsync<Record<string, unknown>>('SELECT * FROM memories ORDER BY id ASC'),
    db.getAllAsync<Record<string, unknown>>('SELECT task_id, due_at, delivered_at FROM notification_deliveries ORDER BY task_id ASC, due_at ASC'),
    Promise.resolve(db.getAllAsync<Record<string, unknown>>('SELECT id, from_type, from_id, to_type, to_id, created_at FROM relations ORDER BY id ASC')).catch(() => []),
    Promise.resolve(db.getAllAsync<Record<string, unknown>>('SELECT * FROM people ORDER BY id ASC')).catch(() => []),
    // Tables added later are read defensively, so a backup taken on an older database
    // still succeeds rather than failing on a table that is not there yet.
    Promise.resolve(db.getAllAsync<Record<string, unknown>>('SELECT * FROM measurements ORDER BY id ASC')).catch(() => []),
    Promise.resolve(db.getAllAsync<Record<string, unknown>>('SELECT * FROM measurement_targets ORDER BY metric ASC, subject_type ASC, subject_id ASC')).catch(() => []),
    db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;'),
  ]);
  const debt = await readDebtTables(db);
  const tables = await dumpPortableTables(db);
  return { appMetadata, appPreferences, tasks, subtasks, memories, notificationDeliveries, relations: relations ?? [], people: people ?? [], measurements: measurements ?? [], measurementTargets: measurementTargets ?? [], debt, tables, schemaVersion: versionRow?.user_version ?? 0 };
}
