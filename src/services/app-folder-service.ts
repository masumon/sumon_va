import type { SQLiteDatabase } from 'expo-sqlite';
import { StorageAccessFramework } from 'expo-file-system/legacy';

// Apon's own folder on the phone — like a professional app, one place where its backups and
// reports live, visible in the phone's Files app and kept even if the app is uninstalled.
//
// Android (10+) does not let an app create a folder in shared storage on its own; the one
// sanctioned way is the system folder picker (SAF). So the person grants a location once —
// Documents is suggested — and the app then creates `Apon/` inside it by itself, and
// `Backups/` and `Reports/` inside that, as they are needed. They can change it any time.

const KEY = 'appFolderUri';
const APP_FOLDER_NAME = 'Apon';
export type AppSubfolder = 'Backups' | 'Reports';

/** The last path segment of a SAF uri, decoded — the folder's own name. */
function nameOf(uri: string): string {
  return decodeURIComponent(uri).split(/[:/]/u).filter(Boolean).pop() ?? '';
}

export async function getAppFolder(db: SQLiteDatabase): Promise<string | null> {
  try {
    const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM app_preferences WHERE key = ?', KEY);
    return row?.value || null;
  } catch { return null; }
}

async function saveAppFolder(db: SQLiteDatabase, uri: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO app_preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    KEY, uri,
  );
}

/** A human label for Settings, e.g. "Documents/Apon". */
export function appFolderLabel(uri: string | null): string | null {
  if (!uri) return null;
  const parts = decodeURIComponent(uri).split(/[:/]/u).filter(Boolean);
  return parts.slice(-2).join('/');
}

/** Find a direct child folder by name, or create it. Throws if the grant is gone. */
async function childFolder(parent: string, name: string): Promise<string> {
  const children = await StorageAccessFramework.readDirectoryAsync(parent);
  const found = children.find((c) => nameOf(c) === name);
  return found ?? StorageAccessFramework.makeDirectoryAsync(parent, name);
}

/**
 * Ask once where Apon's folder should go (Documents suggested), then create `Apon/` there.
 * Picking a folder already called "Apon" uses it as is. Returns null if they backed out.
 */
export async function chooseAppFolder(db: SQLiteDatabase): Promise<string | null> {
  try {
    let hint: string | undefined;
    try { hint = StorageAccessFramework.getUriForDirectoryInRoot('Documents'); } catch { hint = undefined; }
    const res = await StorageAccessFramework.requestDirectoryPermissionsAsync(hint);
    if (!res.granted || !res.directoryUri) return null;
    const folder = nameOf(res.directoryUri) === APP_FOLDER_NAME
      ? res.directoryUri
      : await childFolder(res.directoryUri, APP_FOLDER_NAME);
    await saveAppFolder(db, folder);
    return folder;
  } catch { return null; }
}

/** `Apon/Backups` or `Apon/Reports`, created on first use. Null when no folder is set yet. */
export async function appSubfolder(db: SQLiteDatabase, name: AppSubfolder): Promise<string | null> {
  const root = await getAppFolder(db);
  if (!root) return null;
  return childFolder(root, name);
}
