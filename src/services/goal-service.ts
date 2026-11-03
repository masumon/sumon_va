// Promises a person made to themselves.
//
// A goal belongs to no module. "This month I will put ৳3,000 against the loan", "I want to
// keep spending under ৳12,000", "thirty minutes of walking a day" and "finish the syllabus
// by December" are the same row: who set it, what kind, over what period, and the number.
//
// The number is stored, never deducted. Money you have promised to a loan is still money
// in your hand — if the child needs medicine it goes on medicine, and a ledger that had
// already subtracted it would have been lying to you all month. What the promise buys you
// is not enforcement but arithmetic: the app can now say how the month is going against
// what you meant to do, which is the only honest kind of help.

import type { SQLiteDatabase } from 'expo-sqlite';
import { parseTakaToPaisa, type Paisa } from './debt/money';

/** The kinds the app understands today. Any module may invent more; nothing here breaks. */
export type GoalKind = 'REPAY' | 'SAVE' | 'SPEND_CAP' | string;

export interface Goal {
  id: string;
  module: string;
  kind: GoalKind;
  /** "2026-09" for one month, or "*" for a standing goal every month. */
  period: string;
  targetPaisa: Paisa | null;
  targetNumber: number | null;
  unit: string | null;
  note: string | null;
}

interface GoalRow {
  id: string;
  module: string;
  kind: string;
  period: string;
  target_paisa: number | null;
  target_number: number | null;
  unit: string | null;
  note: string | null;
}

const toGoal = (row: GoalRow): Goal => ({
  id: row.id,
  module: row.module,
  kind: row.kind,
  period: row.period,
  targetPaisa: row.target_paisa,
  targetNumber: row.target_number,
  unit: row.unit,
  note: row.note,
});

const SELECT = 'SELECT id, module, kind, period, target_paisa, target_number, unit, note FROM goals';
const newId = () => `goal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Set — or clear — a goal.
 *
 * A target of zero clears it, because "no goal" and "a goal of nothing" are the same
 * thing to a person and keeping a zero row would make Home say something meaningless.
 */
export async function setGoal(
  db: SQLiteDatabase,
  input: { module: string; kind: GoalKind; period?: string; target: string | number; unit?: string; note?: string },
): Promise<Goal | null> {
  const period = input.period ?? '*';
  const isMoney = !input.unit || input.unit === 'BDT';
  const numeric = typeof input.target === 'number'
    ? input.target
    : isMoney ? parseTakaToPaisa(input.target) : Number(input.target);
  const value = Math.abs(Number.isFinite(numeric) ? numeric : 0);

  if (!value) {
    await db.runAsync('DELETE FROM goals WHERE module = ? AND kind = ? AND period = ?', input.module, input.kind, period);
    return null;
  }

  const id = newId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO goals (id, module, kind, period, target_paisa, target_number, unit, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (module, kind, period) DO UPDATE SET
       target_paisa = excluded.target_paisa,
       target_number = excluded.target_number,
       unit = excluded.unit,
       note = excluded.note,
       deleted_at = NULL,
       updated_at = excluded.updated_at`,
    id, input.module, input.kind, period,
    isMoney ? value : null,
    isMoney ? null : value,
    input.unit ?? null,
    input.note?.trim() || null,
    now, now,
  );

  return getGoal(db, input.module, input.kind, period);
}

/**
 * The goal in force for a period.
 *
 * A goal set for this particular month beats the standing one, so someone can raise their
 * repayment in a good month without rewriting the promise they keep the rest of the year.
 */
export async function getGoal(
  db: SQLiteDatabase,
  module: string,
  kind: GoalKind,
  period: string,
): Promise<Goal | null> {
  const row = await db.getFirstAsync<GoalRow>(
    `${SELECT} WHERE deleted_at IS NULL AND module = ? AND kind = ? AND period IN (?, '*')
      ORDER BY CASE period WHEN '*' THEN 1 ELSE 0 END LIMIT 1`,
    module, kind, period,
  );
  return row ? toGoal(row) : null;
}

/** Every goal in force for a period, whichever module set it. */
export async function goalsFor(db: SQLiteDatabase, period: string): Promise<Goal[]> {
  const rows = await db.getAllAsync<GoalRow>(
    `${SELECT} WHERE deleted_at IS NULL AND period IN (?, '*') ORDER BY module, kind`,
    period,
  );
  // Collapse to one per (module, kind), the specific month winning over the standing one.
  const chosen = new Map<string, GoalRow>();
  for (const row of rows) {
    const key = `${row.module}:${row.kind}`;
    const existing = chosen.get(key);
    if (!existing || (existing.period === '*' && row.period !== '*')) chosen.set(key, row);
  }
  return [...chosen.values()].map(toGoal);
}

export async function clearGoal(db: SQLiteDatabase, module: string, kind: GoalKind, period: string): Promise<boolean> {
  const result = await db.runAsync(
    'DELETE FROM goals WHERE module = ? AND kind = ? AND period = ?', module, kind, period,
  );
  return result.changes > 0;
}
