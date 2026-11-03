import type { SQLiteDatabase } from 'expo-sqlite';

// A gentle "days in a row you finished something" counter. Local, opt-out by simply not
// completing tasks; never punishes a missed day beyond resetting to 1 on the next finish.
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function read(db: SQLiteDatabase): Promise<{ count: number; date: string }> {
  try {
    const rows = await db.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM app_preferences WHERE key IN ('streakCount','streakDate')");
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return { count: Number(map.get('streakCount') ?? '0') || 0, date: map.get('streakDate') ?? '' };
  } catch { return { count: 0, date: '' }; }
}

async function write(db: SQLiteDatabase, count: number, date: string): Promise<void> {
  try {
    await db.runAsync("INSERT INTO app_preferences (key,value) VALUES ('streakCount',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", String(count));
    await db.runAsync("INSERT INTO app_preferences (key,value) VALUES ('streakDate',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", date);
  } catch { /* non-critical */ }
}

/** Call when the user completes a task. Returns the new streak length. */
export async function bumpStreak(db: SQLiteDatabase, now = new Date()): Promise<number> {
  const today = dayKey(now);
  const { count, date } = await read(db);
  if (date === today) return count; // already counted today
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const next = date === yesterday ? count + 1 : 1;
  await write(db, next, today);
  return next;
}

/** Current streak, but only if it is still "live" (finished today or yesterday). */
export async function getStreak(db: SQLiteDatabase, now = new Date()): Promise<number> {
  const { count, date } = await read(db);
  if (!count) return 0;
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  return date === today || date === yesterday ? count : 0;
}
