import type { SQLiteDatabase } from 'expo-sqlite';
import { createM7BackupDocument, M7_BACKUP_VERSION, type M7BackupDocument } from '../backup/m7-format';
import { readSQLiteBackupData } from '../backup/sqlite-reader';

export const BACKUP_FORMAT_VERSION = M7_BACKUP_VERSION;
export type BackupDocument = M7BackupDocument;

export async function createBackupDocument(
  db: SQLiteDatabase,
  readData: (db: SQLiteDatabase) => Promise<Record<string, unknown>> = async (database) => readSQLiteBackupData(database) as unknown as Record<string, unknown>,
  exportedAt = new Date().toISOString(),
): Promise<BackupDocument> {
  return createM7BackupDocument(await readData(db), exportedAt);
}
