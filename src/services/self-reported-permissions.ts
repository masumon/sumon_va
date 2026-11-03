// "চালু করে এসেছেন?" — the few settings Android will not report back.
//
// Auto-start after a restart has no API on any Android version: the app opens the right
// screen, the person flips the switch, and then nothing can read what they did. Leaving
// such a card red forever is wrong — it says "could not be allowed" about something the
// person has just allowed. So the app asks, plainly, and remembers the answer as what it
// is: the person's own word, shown as such, changeable at any time.
//
// It never stands in for a real reading. Anything Android can answer (notifications,
// battery, camera, microphone…) is read from the system every time and this file is not
// involved at all.

import type { SQLiteDatabase } from 'expo-sqlite';

const KEY = 'selfReportedPermissions';

async function readAll(db: SQLiteDatabase): Promise<Record<string, boolean>> {
  try {
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_preferences WHERE key = ?', KEY,
    );
    if (!row?.value) return {};
    const parsed = JSON.parse(row.value) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => v === true),
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}

/** The ids the person has said they turned on themselves. */
export async function selfReportedPermissions(db: SQLiteDatabase): Promise<Set<string>> {
  return new Set(Object.keys(await readAll(db)));
}

/** Remember (or forget) that the person says they turned this one on. */
export async function setSelfReportedPermission(db: SQLiteDatabase, id: string, done: boolean): Promise<void> {
  const all = await readAll(db);
  if (done) all[id] = true; else delete all[id];
  try {
    // The same upsert AppPreferences uses — this table is two columns, key and value.
    await db.runAsync(
      'INSERT INTO app_preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      KEY, JSON.stringify(all),
    );
  } catch { /* a preference that cannot be written is not worth failing the screen for */ }
}
