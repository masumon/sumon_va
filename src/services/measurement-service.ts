// Numbers that change over time.
//
// Weight, blood pressure, blood sugar, minutes studied, pages read, kilometres walked, a
// habit ticked, a skill practised — every one of them is the same shape: a number, its
// unit, what it is about, and when it was true. So they are one table and one service,
// not one per domain.
//
// That is also why "progress" and "decline" are not separate features here. A target
// carries a direction: weight aimed DOWN and savings aimed UP are the same arithmetic
// read from opposite ends, and a single `progress()` answers both.
//
// Values are stored as integers in the metric's smallest unit — grams, minutes, mmHg —
// for the same reason money is stored in paisa: floating point loses arithmetic, and a
// weight log that drifts by 0.1kg a year is worse than no weight log.

import type { SQLiteDatabase } from 'expo-sqlite';

/** What the number is about. `SELF` is the user; anything else is a record's id. */
export interface Subject {
  type: string;
  id: string;
}

export const SELF: Subject = { type: 'SELF', id: 'me' };

export interface Measurement {
  id: string;
  metric: string;
  subject: Subject;
  /** Integer, in `unit`'s smallest step. */
  value: number;
  unit: string;
  /** When the reading was true, not when it was typed. */
  at: string;
  note: string | null;
  createdAt: string;
}

export interface MeasurementTarget {
  metric: string;
  subject: Subject;
  target: number;
  /** Which way counts as progress. Losing weight is DOWN; saving is UP. */
  direction: 'UP' | 'DOWN';
  unit: string;
  note: string | null;
}

export interface RecordMeasurementInput {
  metric: string;
  value: number;
  unit: string;
  at?: string;
  subject?: Subject;
  note?: string | null;
}

const now = () => new Date().toISOString();
const uid = () => `msr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

type Row = {
  id: string; metric: string; subject_type: string; subject_id: string;
  value_num: number; unit: string; at: string; note: string | null; created_at: string;
};

const toMeasurement = (r: Row): Measurement => ({
  id: r.id,
  metric: r.metric,
  subject: { type: r.subject_type, id: r.subject_id },
  value: Number(r.value_num),
  unit: r.unit,
  at: r.at,
  note: r.note,
  createdAt: r.created_at,
});

/** Store one reading. Rejects a non-integer, because a rounded-away half is a lost fact. */
export async function recordMeasurement(db: SQLiteDatabase, input: RecordMeasurementInput): Promise<Measurement> {
  const metric = input.metric.trim();
  const unit = input.unit.trim();
  if (!metric) throw new Error('একটি মাপের নাম দিন / A metric is required');
  if (!unit) throw new Error('একক দিন / A unit is required');
  if (!Number.isSafeInteger(input.value)) throw new Error('মান পূর্ণসংখ্যা হতে হবে / The value must be a whole number in its smallest unit');

  const subject = input.subject ?? SELF;
  const id = uid();
  const at = input.at ?? now();
  await db.runAsync(
    `INSERT INTO measurements (id, metric, subject_type, subject_id, value_num, unit, at, note, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id, metric, subject.type, subject.id, input.value, unit, at, input.note?.trim() || null, now(),
  );
  return (await getMeasurement(db, id))!;
}

export async function getMeasurement(db: SQLiteDatabase, id: string): Promise<Measurement | null> {
  const r = await db.getFirstAsync<Row>('SELECT * FROM measurements WHERE id = ? LIMIT 1', id);
  return r ? toMeasurement(r) : null;
}

export async function deleteMeasurement(db: SQLiteDatabase, id: string): Promise<boolean> {
  const r = await db.runAsync('DELETE FROM measurements WHERE id = ?', id);
  return (r.changes ?? 0) > 0;
}

export interface SeriesQuery {
  metric: string;
  subject?: Subject;
  /** Inclusive ISO bounds. */
  from?: string;
  to?: string;
  limit?: number;
}

/** Readings for one metric, newest first. */
export async function listMeasurements(db: SQLiteDatabase, q: SeriesQuery): Promise<Measurement[]> {
  const where = ['metric = ?', 'subject_type = ?', 'subject_id = ?'];
  const subject = q.subject ?? SELF;
  const args: (string | number)[] = [q.metric, subject.type, subject.id];
  if (q.from) { where.push('at >= ?'); args.push(q.from); }
  if (q.to) { where.push('at <= ?'); args.push(q.to); }
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM measurements WHERE ${where.join(' AND ')} ORDER BY at DESC LIMIT ?`,
    ...args, Math.max(1, Math.min(q.limit ?? 200, 2000)),
  );
  return rows.map(toMeasurement);
}

export async function latestMeasurement(db: SQLiteDatabase, metric: string, subject: Subject = SELF): Promise<Measurement | null> {
  const rows = await listMeasurements(db, { metric, subject, limit: 1 });
  return rows[0] ?? null;
}

/** Every metric that has at least one reading, most recently used first. */
export async function listMetrics(db: SQLiteDatabase, subject: Subject = SELF): Promise<{ metric: string; unit: string; count: number; lastAt: string }[]> {
  const rows = await db.getAllAsync<{ metric: string; unit: string; n: number; last_at: string }>(
    `SELECT metric, unit, COUNT(*) AS n, MAX(at) AS last_at
       FROM measurements WHERE subject_type = ? AND subject_id = ?
      GROUP BY metric, unit ORDER BY last_at DESC`,
    subject.type, subject.id,
  );
  return rows.map((r) => ({ metric: r.metric, unit: r.unit, count: Number(r.n), lastAt: r.last_at }));
}

/**
 * Sum readings per day — the shape habits and study time want.
 *
 * Grouped on the date portion of `at`, so a metric logged three times in a day counts
 * once as their total rather than three separate points.
 */
export async function dailyTotals(db: SQLiteDatabase, q: SeriesQuery): Promise<{ day: string; total: number }[]> {
  const subject = q.subject ?? SELF;
  const where = ['metric = ?', 'subject_type = ?', 'subject_id = ?'];
  const args: (string | number)[] = [q.metric, subject.type, subject.id];
  if (q.from) { where.push('at >= ?'); args.push(q.from); }
  if (q.to) { where.push('at <= ?'); args.push(q.to); }
  const rows = await db.getAllAsync<{ day: string; total: number }>(
    `SELECT substr(at, 1, 10) AS day, SUM(value_num) AS total
       FROM measurements WHERE ${where.join(' AND ')}
      GROUP BY day ORDER BY day DESC LIMIT ?`,
    ...args, Math.max(1, Math.min(q.limit ?? 365, 2000)),
  );
  return rows.map((r) => ({ day: r.day, total: Number(r.total) }));
}

// ── targets, and what counts as progress ──────────────────────────────────────

export async function setTarget(
  db: SQLiteDatabase,
  input: { metric: string; target: number; unit: string; direction?: 'UP' | 'DOWN'; subject?: Subject; note?: string | null },
): Promise<MeasurementTarget> {
  const subject = input.subject ?? SELF;
  const ts = now();
  await db.runAsync(
    `INSERT INTO measurement_targets (metric, subject_type, subject_id, target_num, direction, unit, note, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(metric, subject_type, subject_id) DO UPDATE SET
       target_num = excluded.target_num, direction = excluded.direction,
       unit = excluded.unit, note = excluded.note, updated_at = excluded.updated_at`,
    input.metric, subject.type, subject.id, input.target, input.direction ?? 'UP',
    input.unit, input.note?.trim() || null, ts, ts,
  );
  return (await getTarget(db, input.metric, subject))!;
}

export async function getTarget(db: SQLiteDatabase, metric: string, subject: Subject = SELF): Promise<MeasurementTarget | null> {
  const r = await db.getFirstAsync<{ metric: string; subject_type: string; subject_id: string; target_num: number; direction: string; unit: string; note: string | null }>(
    'SELECT * FROM measurement_targets WHERE metric = ? AND subject_type = ? AND subject_id = ?',
    metric, subject.type, subject.id,
  );
  if (!r) return null;
  return {
    metric: r.metric,
    subject: { type: r.subject_type, id: r.subject_id },
    target: Number(r.target_num),
    direction: r.direction === 'DOWN' ? 'DOWN' : 'UP',
    unit: r.unit,
    note: r.note,
  };
}

export async function clearTarget(db: SQLiteDatabase, metric: string, subject: Subject = SELF): Promise<void> {
  await db.runAsync(
    'DELETE FROM measurement_targets WHERE metric = ? AND subject_type = ? AND subject_id = ?',
    metric, subject.type, subject.id,
  );
}

export interface Progress {
  metric: string;
  unit: string;
  /** Where the number started — the earliest reading in the window. */
  startValue: number;
  /** Where it is now — the latest reading. */
  currentValue: number;
  targetValue: number | null;
  direction: 'UP' | 'DOWN';
  /** Signed movement in the direction that counts as progress. */
  movedBy: number;
  /** 0-100 towards the target, or null when there is no target to measure against. */
  pct: number | null;
  /** Which way it is actually going, whatever the target says. */
  trend: 'IMPROVING' | 'DECLINING' | 'FLAT';
  reachedTarget: boolean;
  readings: number;
}

/**
 * How a metric is doing.
 *
 * Answers "উন্নতি না অবনতি" from the same numbers — `trend` reports what is actually
 * happening, and `pct` reports how far that is towards the target. A metric with no
 * target still gets a trend, because knowing your weight is rising is useful even when
 * you never set a goal.
 *
 * `defaultDirection` is the metric's own known "which way is better" (weight: DOWN,
 * steps: UP — see `metricShape` in `health.module.ts`), used only when no target has been
 * set. Without it this silently assumed UP for every untargeted metric, so gaining 12 kg
 * with no goal set read as `trend: 'IMPROVING'` for a metric whose better direction is
 * actually DOWN. A caller with no better-direction knowledge of its own may omit it, in
 * which case UP remains the last resort — honest for a genuinely unknown custom metric,
 * wrong only for the built-in ones a caller can and should identify first.
 */
export async function progress(db: SQLiteDatabase, metric: string, subject: Subject = SELF, from?: string, defaultDirection?: 'UP' | 'DOWN'): Promise<Progress | null> {
  const readings = await listMeasurements(db, { metric, subject, from, limit: 2000 });
  if (!readings.length) return null;
  // listMeasurements is newest-first.
  const current = readings[0]!;
  const start = readings[readings.length - 1]!;
  const target = await getTarget(db, metric, subject);
  const direction = target?.direction ?? defaultDirection ?? 'UP';

  const delta = current.value - start.value;
  const movedBy = direction === 'UP' ? delta : -delta;

  let pct: number | null = null;
  if (target) {
    const distance = direction === 'UP' ? target.target - start.value : start.value - target.target;
    // A target already met at the start has no distance to cover; treat it as complete.
    pct = distance <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((movedBy / distance) * 100)));
  }

  const reachedTarget = target
    ? (direction === 'UP' ? current.value >= target.target : current.value <= target.target)
    : false;

  return {
    metric,
    unit: current.unit,
    startValue: start.value,
    currentValue: current.value,
    targetValue: target?.target ?? null,
    direction,
    movedBy,
    pct,
    trend: movedBy > 0 ? 'IMPROVING' : movedBy < 0 ? 'DECLINING' : 'FLAT',
    reachedTarget,
    readings: readings.length,
  };
}

/** Remove everything recorded about one subject — for when that record is deleted. */
export async function deleteMeasurementsForSubject(db: SQLiteDatabase, subject: Subject): Promise<void> {
  await db.runAsync('DELETE FROM measurements WHERE subject_type = ? AND subject_id = ?', subject.type, subject.id);
  await db.runAsync('DELETE FROM measurement_targets WHERE subject_type = ? AND subject_id = ?', subject.type, subject.id);
}
