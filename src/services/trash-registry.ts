// Deleted things, from every module.
//
// A soft delete is only half a safety net. Marking a row deleted stops it appearing in
// lists, but unless some screen can show it again, "deleted" and "destroyed" mean the same
// thing to the person who tapped the wrong button. Trash used to know about tasks and
// memories by name, which meant every module written afterwards quietly lost that net —
// an income entry deleted by mistake was simply gone.
//
// Restoring and purging are done here rather than by each module, because the operation is
// always the same two statements and asking every module to reimplement them is how one of
// them eventually gets it wrong.

import type { SQLiteDatabase } from 'expo-sqlite';
import type { AppLanguage } from '../i18n/date-time';
import type { IconName } from './../modules/types';
import { enabledModules } from '../modules/registry';

export interface TrashedItem {
  id: string;
  /** Which module it belongs to, so restore knows which table to touch. */
  module: string;
  title: string;
  subtitle?: string;
  deletedAt: string;
  icon?: IconName;
}

/**
 * Which table a module's trashed rows live in.
 *
 * Registered rather than inferred: a module may have several tables and only one of them
 * worth restoring, and guessing from the module id would be wrong the first time someone
 * names a module differently from its table.
 */
const tables = new Map<string, string>();

export function registerTrashTable(moduleId: string, table: string): void {
  tables.set(moduleId, table);
}

/**
 * What a module does instead, when clearing one column is not the whole job.
 *
 * Most rows come back with `deleted_at = NULL` and go for good with one DELETE. A debt
 * account does neither: its ledger, schedule and promises were marked at the same instant
 * and have to be cleared with it, and its child rows hold foreign keys that make deleting
 * the parent alone impossible. Registering the pair here keeps that knowledge in the
 * module that owns those tables, instead of teaching this file about every schema.
 */
const handlers = new Map<string, { restore?: (db: SQLiteDatabase, id: string) => Promise<boolean>; purge?: (db: SQLiteDatabase, id: string) => Promise<boolean> }>();

export function registerTrashHandlers(
  moduleId: string,
  overrides: { restore?: (db: SQLiteDatabase, id: string) => Promise<boolean>; purge?: (db: SQLiteDatabase, id: string) => Promise<boolean> },
): void {
  handlers.set(moduleId, { ...handlers.get(moduleId), ...overrides });
}

/**
 * More tables whose deleted rows should expire, for a module whose Trash lists several
 * (health: medicines, visits and tests). Expiry only — restore and purge still go through
 * the module's handler, which finds the row's real table itself.
 */
const extraExpiryTables = new Map<string, string[]>();

export function registerTrashExpiryTable(moduleId: string, table: string): void {
  const list = extraExpiryTables.get(moduleId) ?? [];
  if (!list.includes(table)) extraExpiryTables.set(moduleId, [...list, table]);
}

registerTrashTable('finance', 'fin_entries');
registerTrashTable('debt', 'dr_accounts');

/** Everything every enabled module has thrown away, newest first. */
export async function collectTrash(db: SQLiteDatabase, language: AppLanguage): Promise<TrashedItem[]> {
  const modules = await enabledModules(db);
  const out: TrashedItem[] = [];
  for (const module of modules) {
    if (!module.trash) continue;
    try {
      out.push(...(await module.trash(db, language)));
    } catch {
      // A module that cannot list its trash simply lists none.
    }
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Put it back. Returns false when the module never said where its rows live. */
export async function restoreTrashed(db: SQLiteDatabase, item: TrashedItem): Promise<boolean> {
  const own = handlers.get(item.module)?.restore;
  if (own) return own(db, item.id);
  const table = tables.get(item.module);
  if (!table) return false;
  const result = await db.runAsync(`UPDATE ${table} SET deleted_at = NULL WHERE id = ?`, item.id);
  return result.changes > 0;
}

/** Remove it for good. */
export async function purgeTrashed(db: SQLiteDatabase, item: TrashedItem): Promise<boolean> {
  const own = handlers.get(item.module)?.purge;
  if (own) return own(db, item.id);
  const table = tables.get(item.module);
  if (!table) return false;
  const result = await db.runAsync(`DELETE FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`, item.id);
  return result.changes > 0;
}

/**
 * Clear out anything deleted longer ago than the retention window.
 *
 * Run alongside the existing sweep for tasks and memories, so a module's trash expires on
 * the same schedule as everything else rather than accumulating forever.
 */
export async function purgeExpiredTrash(db: SQLiteDatabase, retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  let removed = 0;
  const pairs: [string, string][] = [];
  for (const [moduleId, table] of tables.entries()) pairs.push([moduleId, table]);
  for (const [moduleId, list] of extraExpiryTables.entries()) for (const table of list) pairs.push([moduleId, table]);
  for (const [moduleId, table] of pairs) {
    let expired: { id: string }[];
    try {
      expired = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ?`, cutoff,
      );
    } catch {
      // A table that does not exist on this schema version has nothing to expire.
      continue;
    }
    // One row at a time, each on its own: a module that owns child rows purges through its
    // own handler (deleting the parent out from under a foreign key simply throws), and one
    // row that cannot go yet must not keep every other expired row in the table forever.
    const own = handlers.get(moduleId)?.purge;
    for (const row of expired) {
      try {
        if (own) {
          if (await own(db, row.id)) removed += 1;
        } else {
          const result = await db.runAsync(`DELETE FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL`, row.id);
          removed += result.changes;
        }
      } catch {
        // Left for the next sweep; the rest of the table still expires.
      }
    }
  }
  return removed;
}
