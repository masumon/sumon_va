import { Directory, File, Paths } from 'expo-file-system';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import type { SQLiteDatabase } from 'expo-sqlite';
import { bytesToBase64, createBackupArchive } from './backup-archive-service';
import { appSubfolder } from './app-folder-service';
import { encryptArchive } from '../backup/crypto';
import { logAppError } from './error-log';

// Opt-in weekly safety net: once a week (checked on launch) write a full archive. Always
// keeps a rolling few copies in the app's private document dir (survives an in-app
// mishap, pairs with Trash). If the user has picked a folder via the system picker, a
// copy also lands there — that one survives an uninstall / can be moved to a PC.
// Auto copies use their own filename prefix so pruning never touches a manual backup or
// any other file in the chosen folder.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP = 3;
const AUTO_PREFIX = 'apon-autobackup-';
// Copies written before 1.0 carry the old name; they are still ours to keep or prune.
const AUTO_PREFIXES = [AUTO_PREFIX, 'offline-memory-autobackup-'] as const;
const isAutoName = (name: string) => AUTO_PREFIXES.some((p) => name.includes(p));
/** The ISO stamp after either prefix — newest first sorts on this, never on the prefix. */
const stampOf = (name: string) => name.slice(name.lastIndexOf('autobackup-'));
export const LAST_AUTO_BACKUP_KEY = 'lastAutoBackupAt';
/**
 * Why the last weekly run failed, or which files it had to leave out — JSON
 * `{ at, message, skippedFiles }`, removed again by a clean run. The run happens unseen on
 * launch, so without this a backup that failed every week looked exactly like one that
 * worked. Also written to the Diagnostics error list (error-log).
 */
export const LAST_AUTO_BACKUP_ERROR_KEY = 'lastAutoBackupError';

async function recordAutoBackupProblem(db: SQLiteDatabase, message: string | null, skippedFiles = 0): Promise<void> {
  try {
    if (!message && !skippedFiles) {
      await db.runAsync('DELETE FROM app_preferences WHERE key = ?', LAST_AUTO_BACKUP_ERROR_KEY);
      return;
    }
    await db.runAsync(
      'INSERT INTO app_preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      LAST_AUTO_BACKUP_ERROR_KEY, JSON.stringify({ at: new Date().toISOString(), message, skippedFiles }),
    );
  } catch { /* the status is a courtesy; the backup result stands either way */ }
}

/**
 * D8 / B-07: the passphrase the weekly backup is locked with. Kept on this phone only —
 * never written into any backup (sqlite-reader skips this key) — so it protects every
 * copy that leaves the phone: the Apon folder, Drive, a PC, a memory card.
 */
export const AUTO_BACKUP_PASSPHRASE_KEY = 'autoBackupPassphrase';

export async function readAutoBackupPassphrase(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', AUTO_BACKUP_PASSPHRASE_KEY).catch(() => null);
  return row?.value || null;
}

export async function setAutoBackupPassphrase(db: SQLiteDatabase, passphrase: string | null): Promise<void> {
  if (passphrase && passphrase.trim()) {
    await db.runAsync('INSERT INTO app_preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', AUTO_BACKUP_PASSPHRASE_KEY, passphrase.trim());
  } else {
    await db.runAsync('DELETE FROM app_preferences WHERE key = ?', AUTO_BACKUP_PASSPHRASE_KEY);
  }
}

export type AutoBackupResult = { ran: boolean; folderWritten: boolean; folderError?: string; encrypted?: boolean; skippedFiles?: number };

export async function runAutoBackup(db: SQLiteDatabase, folderUri: string | null = null, opts: { force?: boolean; now?: number } = {}): Promise<AutoBackupResult> {
  const now = opts.now ?? Date.now();
  try {
    if (!opts.force) {
      const row = await db.getFirstAsync<{ value: string }>(
        `SELECT value FROM app_preferences WHERE key = '${LAST_AUTO_BACKUP_KEY}'`,
      );
      const last = row ? Date.parse(row.value) : NaN;
      if (Number.isFinite(last) && now - last < WEEK_MS) return { ran: false, folderWritten: false };
    }

    const archive = await createBackupArchive(db);
    const stamp = archive.createdAt.replace(/[:.]/gu, '-');
    // Locked with the passphrase when one is set — the same format a manual encrypted
    // backup uses, so the Backup screen restores it the same way (asks for the passphrase).
    const passphrase = await readAutoBackupPassphrase(db);
    const bytes = passphrase ? await encryptArchive(archive.bytes, passphrase) : archive.bytes;
    const name = `${AUTO_PREFIX}${stamp}.${passphrase ? 'ombak' : 'zip'}`;

    // 1. Private rolling copy (always).
    const file = new File(Paths.document, name);
    file.create({ intermediates: true, overwrite: true });
    file.write(bytes);
    prunePrivate();

    // 2. Chosen-folder copy (best-effort — never fail the whole run if the folder is gone).
    // Apon's own folder (`Apon/Backups`) when one is set; an older, separately chosen
    // backup folder otherwise, so nobody's existing setup stops working.
    let folderWritten = false;
    let folderError: string | undefined;
    const appBackups = await appSubfolder(db, 'Backups').catch(() => null);
    if (appBackups) folderUri = appBackups;
    if (folderUri) {
      try {
        const b64 = bytesToBase64(bytes);
        // Android adds ".zip" itself for a zip, but nothing for octet-stream — the locked copy
        // arrived with no extension and the file picker showed it as "BIN" (RC.1 QA).
        const fileUri = await StorageAccessFramework.createFileAsync(folderUri, passphrase ? name : `${AUTO_PREFIX}${stamp}`, passphrase ? 'application/octet-stream' : 'application/zip');
        await StorageAccessFramework.writeAsStringAsync(fileUri, b64, { encoding: 'base64' });
        folderWritten = true;
        await pruneFolder(folderUri);
      } catch (e) {
        folderError = e instanceof Error ? e.message : String(e);
      }
    }

    await db.runAsync(
      `INSERT INTO app_preferences (key, value) VALUES ('${LAST_AUTO_BACKUP_KEY}', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      new Date(now).toISOString(),
    );
    const skippedFiles = archive.skippedAttachmentCount ?? 0;
    if (skippedFiles) logAppError('auto-backup', new Error(`${skippedFiles} attachment file(s) missing — left out of the backup`), 'Backup left out missing files');
    if (folderError) logAppError('auto-backup-folder', new Error(folderError), 'Backup folder copy failed');
    await recordAutoBackupProblem(db, folderError ? `folder: ${folderError}` : null, skippedFiles);
    return { ran: true, folderWritten, folderError, encrypted: Boolean(passphrase), skippedFiles };
  } catch (e) {
    logAppError('auto-backup', e, 'Backup failed');
    await recordAutoBackupProblem(db, e instanceof Error ? e.message : String(e));
    return { ran: false, folderWritten: false, folderError: e instanceof Error ? e.message : undefined };
  }
}

function prunePrivate(): void {
  try {
    const entries = new Directory(Paths.document)
      .list()
      .filter((e): e is File => e instanceof File && AUTO_PREFIXES.some((p) => e.name.startsWith(p)));
    entries.sort((a, b) => (stampOf(a.name) < stampOf(b.name) ? 1 : -1)); // name embeds an ISO stamp → reverse = newest first
    for (const stale of entries.slice(KEEP)) {
      try { stale.delete(); } catch { /* ignore a locked/removed file */ }
    }
  } catch { /* directory listing is best-effort */ }
}

async function pruneFolder(folderUri: string): Promise<void> {
  try {
    // readDirectoryAsync returns content:// URIs whose last segment is the URL-encoded
    // display name — match on our own prefix only, so nothing else in the folder is touched.
    const uris = await StorageAccessFramework.readDirectoryAsync(folderUri);
    const mine = uris
      .filter((u) => isAutoName(decodeURIComponent(u)))
      .sort((a, b) => (stampOf(decodeURIComponent(a)) < stampOf(decodeURIComponent(b)) ? 1 : -1));
    for (const stale of mine.slice(KEEP)) {
      try { await StorageAccessFramework.deleteAsync(stale); } catch { /* ignore */ }
    }
  } catch { /* listing unsupported on some OEMs — leave the folder alone */ }
}
