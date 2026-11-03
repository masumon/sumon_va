import type { SQLiteDatabase } from 'expo-sqlite';

// On-device learning. Every function is local-only, best-effort, and never throws into the
// caller — capture must never break because a stat write failed.

type LearningKind = 'time_pattern' | 'intent_correction' | 'frequent_task' | 'tag_pair' | 'dismissed_suggestion';

async function bump(db: SQLiteDatabase, kind: LearningKind, key: string, value = ''): Promise<void> {
  try {
    await db.runAsync(
      `INSERT INTO learning (kind, key, value, count, updated_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(kind, key, value) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`,
      kind, key, value, new Date().toISOString(),
    );
  } catch { /* learning is non-critical */ }
}

/** First 1–2 meaningful words of a title, lowercased — the "signature" we learn against. */
export function titleSignature(title: string): string {
  const stop = new Set(['the', 'a', 'an', 'to', 'my', 'for', 'of', 'and', 'at', 'in', 'on', 'এর', 'এ', 'ও', 'করব', 'করতে', 'হবে', 'যাব', 'কে', 'র']);
  const words = title.toLocaleLowerCase().normalize('NFKC').split(/[\s,।-]+/u).filter((w) => w.length > 1 && !stop.has(w));
  return words.slice(0, 2).join(' ');
}

// ── Time-of-day patterns ("gym" → usually 06:00) ──────────────────────────────────────
export async function recordTimePattern(db: SQLiteDatabase, title: string, minutesOfDay: number): Promise<void> {
  const sig = titleSignature(title);
  if (!sig || minutesOfDay < 0 || minutesOfDay > 1439) return;
  const bucket = `${String(Math.floor(minutesOfDay / 60)).padStart(2, '0')}:${String(minutesOfDay % 60).padStart(2, '0')}`;
  await bump(db, 'time_pattern', sig, bucket);
}

export async function suggestTime(db: SQLiteDatabase, title: string): Promise<number | null> {
  const sig = titleSignature(title);
  if (!sig) return null;
  try {
    const row = await db.getFirstAsync<{ value: string; count: number }>(
      `SELECT value, count FROM learning WHERE kind = 'time_pattern' AND key = ? ORDER BY count DESC LIMIT 1`, sig,
    );
    if (!row || row.count < 2) return null;
    const m = row.value.match(/^(\d{2}):(\d{2})$/u);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  } catch { return null; }
}

// ── Task vs memory: learn from the user's corrections ─────────────────────────────────
export async function recordIntentChoice(db: SQLiteDatabase, phrase: string, kind: 'TASK' | 'MEMORY'): Promise<void> {
  const sig = titleSignature(phrase);
  if (sig) await bump(db, 'intent_correction', sig, kind);
}

export async function preferredIntent(db: SQLiteDatabase, phrase: string): Promise<'TASK' | 'MEMORY' | null> {
  const sig = titleSignature(phrase);
  if (!sig) return null;
  try {
    const rows = await db.getAllAsync<{ value: string; count: number }>(
      `SELECT value, count FROM learning WHERE kind = 'intent_correction' AND key = ? ORDER BY count DESC`, sig,
    );
    if (!rows.length || rows[0]!.count < 2) return null;
    return rows[0]!.value === 'MEMORY' ? 'MEMORY' : 'TASK';
  } catch { return null; }
}

// ── Frequent tasks → quick chips ──────────────────────────────────────────────────────
export async function recordFrequentTask(db: SQLiteDatabase, title: string): Promise<void> {
  const t = title.trim();
  if (t.length >= 2 && t.length <= 80) await bump(db, 'frequent_task', t.toLocaleLowerCase(), t);
}

export async function topFrequentTasks(db: SQLiteDatabase, limit = 4): Promise<string[]> {
  try {
    const rows = await db.getAllAsync<{ value: string; count: number }>(
      `SELECT value, count FROM learning WHERE kind = 'frequent_task' AND count >= 3 ORDER BY count DESC, updated_at DESC LIMIT ?`, limit,
    );
    return rows.map((r) => r.value);
  } catch { return []; }
}

// ── Tag co-occurrence ("#office" often with "#report") ────────────────────────────────
export async function recordTagPairs(db: SQLiteDatabase, tags: string[]): Promise<void> {
  const unique = [...new Set(tags.map((t) => t.trim().toLocaleLowerCase()).filter(Boolean))];
  for (const a of unique) for (const b of unique) if (a !== b) await bump(db, 'tag_pair', a, b);
}

export async function suggestTags(db: SQLiteDatabase, tags: string[]): Promise<string[]> {
  const seed = [...new Set(tags.map((t) => t.trim().toLocaleLowerCase()).filter(Boolean))];
  if (!seed.length) return [];
  try {
    const placeholders = seed.map(() => '?').join(',');
    const rows = await db.getAllAsync<{ value: string; count: number }>(
      `SELECT value, SUM(count) AS count FROM learning WHERE kind = 'tag_pair' AND key IN (${placeholders}) GROUP BY value ORDER BY count DESC LIMIT 3`,
      ...seed,
    );
    return rows.filter((r) => r.count >= 2 && !seed.includes(r.value)).map((r) => r.value);
  } catch { return []; }
}

// ── Suggestion dismissals (don't nag) ────────────────────────────────────────────────
export async function recordDismissal(db: SQLiteDatabase, suggestionId: string): Promise<void> {
  await bump(db, 'dismissed_suggestion', suggestionId);
}

export async function wasDismissed(db: SQLiteDatabase, suggestionId: string, threshold = 2): Promise<boolean> {
  try {
    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT count FROM learning WHERE kind = 'dismissed_suggestion' AND key = ?`, suggestionId,
    );
    return (row?.count ?? 0) >= threshold;
  } catch { return false; }
}
