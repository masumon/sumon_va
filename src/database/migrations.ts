import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * The assistant app keeps only ONE small local table: its own settings (language, theme, text size, app-lock PIN hash, the last
 * login e-mail). Messages, people and tasks live on the server. The old offline-notebook schema (tasks, memories, debts,
 * measurements ... twenty-odd steps on every start) came from another app and is gone: it only slowed the start down.
 */
export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('CREATE TABLE IF NOT EXISTS app_preferences (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);');
}
