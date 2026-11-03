import { deserializeDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import { unzipSync } from 'fflate';
import { restoreSQLiteBackupData } from '../backup/sqlite-restore';
import { readSQLiteBackupData } from '../backup/sqlite-reader';
import { migrateDatabase, DATABASE_VERSION } from '../database/migrations';
import { base64ToBytes, bytesToBase64, parseBackupArchive, type BackupArchiveAttachment, type DebtArchiveAttachment } from './backup-archive-service';

function safeName(name: string): string { return name.replace(/[^a-zA-Z0-9._-]+/gu, '_').slice(0, 160) || 'file'; }

export interface RestoreArchiveResult { attachmentCount: number; debtAttachmentCount: number; cleanedOldAttachments: number; }
type ExistingAttachment = { uri: string };

/**
 * Restores an attachment-aware ZIP backup. Files are staged in the app document
 * directory first; SQLite is changed only after every binary has been validated
 * and written successfully. Legacy JSON/M7 restore remains handled separately.
 */
/**
 * Bring an older archive's row data up to the schema the app runs today.
 *
 * The reader that writes `manifest.data` describes the schema of the day it ran, and the
 * restorer only understands the current one — so a backup went stale two migrations after
 * it was taken and refused to load. That is the opposite of what a backup is for: the
 * archives most worth restoring are the old ones.
 *
 * Every archive already carries a full `database.sqlite`, and the app already owns a
 * migration chain that takes any version forward. So the old database is opened in memory,
 * migrated exactly as a real upgrade would migrate it, and read back with today's reader.
 * Nothing here duplicates migration logic; if a future migration is correct for a phone,
 * it is correct for a backup.
 *
 * A newer archive than the running app is still refused — that direction cannot work, and
 * saying so plainly beats writing half the rows and stopping.
 */
async function currentShapeData(
  manifest: { data: Record<string, unknown> },
  files: Record<string, Uint8Array>,
): Promise<Record<string, unknown>> {
  const archived = manifest.data.schemaVersion;
  const version = typeof archived === 'number' ? archived : 0;
  if (version > DATABASE_VERSION) {
    throw new Error(`This backup was made by a newer version of the app (schema ${version} against ${DATABASE_VERSION}). Update the app, then restore.`);
  }
  if (version === DATABASE_VERSION) return manifest.data;

  const databaseBytes = files['database.sqlite'];
  if (!databaseBytes?.byteLength) throw new Error('Backup archive database is missing');

  let scratch: SQLiteDatabase | undefined;
  try {
    scratch = await deserializeDatabaseAsync(databaseBytes);
    // A scratch copy must not overwrite the real database's pre-vN safety copy.
    await migrateDatabase(scratch, { skipSafetyCopy: true });
    return await readSQLiteBackupData(scratch) as unknown as Record<string, unknown>;
  } finally {
    try { await scratch?.closeAsync(); } catch { /* the scratch copy is in memory; losing it costs nothing */ }
  }
}

export async function restoreBackupArchive(db: SQLiteDatabase, bytes: Uint8Array): Promise<RestoreArchiveResult> {
  const manifest = parseBackupArchive(bytes);
  const files = unzipSync(bytes);
  // Older archives are migrated to today's shape before anything is written.
  const data = await currentShapeData(manifest, files);
  const attachmentDirectory = new Directory(Paths.document, 'attachments');
  attachmentDirectory.create({ intermediates: true, idempotent: true });
  const existing = await db.getAllAsync<ExistingAttachment>('SELECT uri FROM attachments');
  // Debt files live in `attachments` since v16; the query is kept for archives restored
  // onto a database that has not migrated yet, and returns nothing once it has.
  const existingDebt = await db.getAllAsync<ExistingAttachment>('SELECT uri FROM dr_attachments').catch(() => [] as ExistingAttachment[]);
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const prepared: string[] = [];
  const rows: Record<string, unknown>[] = [];
  const debtUriById = new Map<string, string>();
  let generalCount = 0;

  try {
    for (const attachment of manifest.attachments as BackupArchiveAttachment[]) {
      const payload = files[`attachments/${attachment.id}`];
      if (!payload) throw new Error(`Backup attachment data is missing: ${attachment.id}`);
      if (attachment.size !== null && payload.byteLength !== attachment.size) throw new Error(`Backup attachment size mismatch: ${attachment.id}`);
      const destination = new File(attachmentDirectory, `${attachment.id}-restore-${nonce}-${safeName(attachment.name)}`);
      destination.create({ intermediates: true, overwrite: false });
      destination.write(bytesToBase64(payload), { encoding: 'base64' });
      prepared.push(destination.uri);
      rows.push({ id: attachment.id, owner_type: attachment.ownerType, owner_id: attachment.ownerId, name: attachment.name, mime_type: attachment.mimeType, size: attachment.size, uri: destination.uri, created_at: attachment.createdAt });
    }

    generalCount = rows.length;
    // Debt attachments are staged the same way, then their rows are repointed at the
    // new local paths before the debt tables are written.
    for (const attachment of (manifest.drAttachments ?? []) as DebtArchiveAttachment[]) {
      const payload = files[`dr-attachments/${attachment.id}`];
      if (!payload) throw new Error(`Debt attachment data is missing: ${attachment.id}`);
      const destination = new File(attachmentDirectory, `${attachment.id}-restore-${nonce}-${safeName(attachment.name)}`);
      destination.create({ intermediates: true, overwrite: false });
      destination.write(bytesToBase64(payload), { encoding: 'base64' });
      prepared.push(destination.uri);
      debtUriById.set(attachment.id, destination.uri);
      // A pre-v16 archive is migrated before restore, and that migration moved these rows
      // into `attachments` as DEBT_*. The rows below replace that table wholesale, so the
      // debt files need rows here too — or they were lost and their staged files orphaned.
      if (!rows.some((row) => row.id === attachment.id)) {
        rows.push({ id: attachment.id, owner_type: attachment.ownerType === 'ACCOUNT' ? 'DEBT_ACCOUNT' : 'DEBT_TRANSACTION', owner_id: attachment.ownerId, name: attachment.name, mime_type: attachment.mimeType, size: attachment.size, uri: destination.uri, created_at: attachment.createdAt });
      }
    }

    // Every archive since v16 has no `dr_attachments` key at all — debt files live in
    // `attachments` now, and `DEBT_TABLES` was deliberately updated to no longer accept
    // that name (see debt-tables.ts). This block used to add the key back unconditionally
    // (defaulting to `[]`), which meant every single modern restore failed validation
    // against its own freshly-injected, now-unrecognised key — confirmed by reproducing a
    // plain backup-then-restore round trip end to end. Only genuinely pre-v16 archives
    // (which still carry a `dr_attachments` row set of their own) need the repointing below.
    const debtData = data.debt;
    const hasLegacyDebtAttachments = !!debtData && typeof debtData === 'object' && !Array.isArray(debtData)
      && 'dr_attachments' in (debtData as Record<string, unknown>);
    const repointedDebt = hasLegacyDebtAttachments
      ? {
        ...(debtData as Record<string, unknown>),
        dr_attachments: (((debtData as Record<string, unknown>).dr_attachments as Record<string, unknown>[] | undefined) ?? [])
          .map((row) => ({ ...row, uri: debtUriById.get(String(row.id)) ?? row.uri })),
      }
      : debtData;

    await restoreSQLiteBackupData(db, { format: 'offline-memory-backup', version: 1, createdAt: manifest.createdAt, data: { ...data, attachments: rows, ...(debtData === undefined ? {} : { debt: repointedDebt }) } });
  } catch (error) {
    for (const uri of prepared) { try { const file = new File(uri); if (file.exists) file.delete(); } catch {} }
    throw error;
  }

  let cleanedOldAttachments = 0;
  for (const item of [...existing, ...existingDebt]) {
    try { const file = new File(item.uri); if (file.exists) file.delete(); cleanedOldAttachments += 1; } catch {}
  }
  return { attachmentCount: generalCount, debtAttachmentCount: debtUriById.size, cleanedOldAttachments };
}

export function decodeBackupArchiveBase64(value: string): Uint8Array { return base64ToBytes(value); }
