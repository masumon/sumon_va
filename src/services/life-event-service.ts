// What happened, as opposed to what got written down.
//
// Every module in this app records the consequences of things. The debt ledger records
// that a balance fell; the money book records that a wallet emptied; the health module
// records that a medicine was bought. None of them records the thing itself — that on
// Monday you borrowed twenty thousand taka from Rahim because your mother needed a test,
// and that on Tuesday some of it went to the lab.
//
// A life event is that missing row. It is deliberately thin: it holds identity, a business
// date, who it was with, where the money came from and what it was for. It does not hold
// the money, because `fin_entries` and `dr_transactions` already do, and two tables holding
// one amount is two tables that can disagree. What it adds is a name for the whole, and a
// place to hang the answer to "why".
//
// One event, many effects, one commit. Recording an event is always done inside the same
// `atomic()` boundary as the effects it describes, so an event never survives the records
// it claims to explain, and records never exist without the event that caused them.

import type { SQLiteDatabase } from 'expo-sqlite';
import { atomic } from '../database/atomic';
import { businessInstant } from '../i18n/date-time';

/**
 * The kinds of thing that happen to a person, as a machine can read them.
 *
 * This exists because the app's only machine-readable notion of "this was a repayment,
 * not a grocery bill" was the Bengali text in a category column — `'ঋণ পরিশোধ'` compared
 * as a string. That works until somebody renames a category, and it cannot be translated
 * without changing what the sums mean.
 *
 * Not a database CHECK and not a closed union at the call site: a module written next year
 * must be able to bring its own kind without editing this file. These are the ones the app
 * itself writes, and the ones the timeline knows how to describe.
 */
export const LIFE_EVENT_TYPES = [
  // money in and out, in the plain sense
  'INCOME', 'EXPENSE', 'TRANSFER',
  // money that moves without being earned or spent
  'BORROW', 'LEND', 'REPAY', 'COLLECT',
  // money that changes hands with nothing owed either way
  'GIFT_IN', 'GIFT_OUT', 'GIFT_CONVERSION',
  'LOSS', 'FOUND',
  // things owned, rather than money held
  'ASSET_BUY', 'ASSET_SELL',
  // the rest of a life
  'MEDICAL', 'OTHER',
] as const;

export type LifeEventType = (typeof LIFE_EVENT_TYPES)[number] | (string & {});

/** What a record is to the event that caused it. */
export type EffectRole = 'MONEY' | 'LEDGER' | 'RECORD';

export interface EventEffect {
  /** FINANCE_ENTRY, DEBT_TRANSACTION, HL_VISIT, HL_MEDICINE, HL_TEST, ... */
  type: string;
  id: string;
  role?: EffectRole;
}

export interface LifeEventInput {
  type: LifeEventType;
  /** A day key or an instant. A missing one means today, read in Dhaka. */
  occurredAt?: string | null;
  title?: string | null;
  personId?: string | null;
  place?: string | null;
  /** Why it happened: MEDICAL, EDUCATION, OLD_DEBT... */
  purpose?: string | null;
  /** Where the money came from: SALARY, SAVINGS, BORROWED, ASSET_SALE... */
  source?: string | null;
  /** Where it went: a lab, a creditor, a seller. */
  destination?: string | null;
  amountPaisa?: number | null;
  note?: string | null;
}

export interface LifeEvent extends Omit<Required<LifeEventInput>, 'occurredAt'> {
  id: string;
  occurredAt: string;
  createdAt: string;
}

interface Row {
  id: string; type: string; occurred_at: string; title: string | null;
  person_id: string | null; person_name?: string | null; place: string | null;
  purpose: string | null; source: string | null; destination: string | null;
  amount_paisa: number | null; note: string | null; created_at: string;
}

const SELECT = `SELECT e.id, e.type, e.occurred_at, e.title, e.person_id, p.name AS person_name,
                       e.place, e.purpose, e.source, e.destination, e.amount_paisa, e.note, e.created_at
                  FROM life_events e
                  LEFT JOIN people p ON p.id = e.person_id`;

const newId = () => `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const clean = (value?: string | null) => value?.trim() || null;

function toEvent(row: Row): LifeEvent & { personName: string | null } {
  return {
    id: row.id,
    type: row.type,
    occurredAt: row.occurred_at,
    title: row.title,
    personId: row.person_id,
    personName: row.person_name ?? null,
    place: row.place,
    purpose: row.purpose,
    source: row.source,
    destination: row.destination,
    amountPaisa: row.amount_paisa,
    note: row.note,
    createdAt: row.created_at,
  };
}

/**
 * Write down that something happened, and which records it left behind.
 *
 * Call it from inside the boundary that writes those records. It opens one of its own so
 * it is safe alone, and `atomic` nests, so from inside a wider one it simply joins it —
 * which is the whole point: the event and its effects are one decision.
 *
 * An effect that fails to attach is not worth losing the event over, so this is written to
 * be all-or-nothing with the caller's work rather than to police the caller's ids.
 */
export async function recordLifeEvent(
  db: SQLiteDatabase,
  input: LifeEventInput,
  effects: EventEffect[] = [],
): Promise<string> {
  return atomic(db, async () => {
    const id = newId();
    const stamp = new Date().toISOString();
    const occurredAt = businessInstant(input.occurredAt);
    await db.runAsync(
      `INSERT INTO life_events (id, type, occurred_at, title, person_id, place, purpose, source,
         destination, amount_paisa, note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, input.type, occurredAt, clean(input.title), input.personId ?? null, clean(input.place),
      clean(input.purpose), clean(input.source), clean(input.destination),
      input.amountPaisa ?? null, clean(input.note), stamp, stamp,
    );
    for (const effect of effects) {
      if (!effect.id) continue;
      await db.runAsync(
        `INSERT OR IGNORE INTO life_event_effects (event_id, effect_type, effect_id, role, created_at)
         VALUES (?,?,?,?,?)`,
        id, effect.type, effect.id, effect.role ?? null, stamp,
      );
    }
    return id;
  });
}

/** Attach another record to an event that already exists. */
export async function attachEffect(db: SQLiteDatabase, eventId: string, effect: EventEffect): Promise<void> {
  if (!effect.id) return;
  await db.runAsync(
    `INSERT OR IGNORE INTO life_event_effects (event_id, effect_type, effect_id, role, created_at)
     VALUES (?,?,?,?,?)`,
    eventId, effect.type, effect.id, effect.role ?? null, new Date().toISOString(),
  );
}

/** One event and everything it touched. */
export async function getLifeEvent(db: SQLiteDatabase, id: string) {
  const row = await db.getFirstAsync<Row>(`${SELECT} WHERE e.id = ? AND e.deleted_at IS NULL`, id);
  if (!row) return null;
  const effects = await db.getAllAsync<{ effect_type: string; effect_id: string; role: string | null }>(
    'SELECT effect_type, effect_id, role FROM life_event_effects WHERE event_id = ?', id,
  );
  return {
    ...toEvent(row),
    effects: effects.map((e) => ({ type: e.effect_type, id: e.effect_id, role: (e.role ?? undefined) as EffectRole | undefined })),
  };
}

/**
 * Which event a record belongs to — the way back from an effect to its cause.
 *
 * This is what lets a finance entry opened from the money book offer "see the whole
 * story", instead of the entry being the end of the trail.
 */
export async function eventForEffect(db: SQLiteDatabase, effectType: string, effectId: string) {
  const row = await db.getFirstAsync<{ event_id: string }>(
    'SELECT event_id FROM life_event_effects WHERE effect_type = ? AND effect_id = ? LIMIT 1',
    effectType, effectId,
  );
  return row ? getLifeEvent(db, row.event_id) : null;
}

/**
 * The life timeline: what happened, newest first.
 *
 * Days rather than a flat list, because "the tenth" is how anyone actually asks. The
 * grouping key is the business date already stored on the event, so a thing recorded at
 * one in the morning appears under the day it happened in Dhaka.
 */
export interface TimelineDay {
  dayKey: string;
  events: (LifeEvent & { personName: string | null })[];
}

export async function lifeTimeline(
  db: SQLiteDatabase,
  opts: { from?: string; to?: string; type?: string; personId?: string; limit?: number } = {},
): Promise<TimelineDay[]> {
  const where = ['e.deleted_at IS NULL'];
  const args: (string | number)[] = [];
  if (opts.from) { where.push('substr(e.occurred_at, 1, 10) >= ?'); args.push(opts.from); }
  if (opts.to) { where.push('substr(e.occurred_at, 1, 10) <= ?'); args.push(opts.to); }
  if (opts.type) { where.push('e.type = ?'); args.push(opts.type); }
  if (opts.personId) { where.push('e.person_id = ?'); args.push(opts.personId); }

  const rows = await db.getAllAsync<Row>(
    `${SELECT} WHERE ${where.join(' AND ')} ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT ?`,
    ...args, opts.limit ?? 200,
  );

  const days: TimelineDay[] = [];
  for (const row of rows) {
    const dayKey = row.occurred_at.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.dayKey === dayKey) last.events.push(toEvent(row));
    else days.push({ dayKey, events: [toEvent(row)] });
  }
  return days;
}

/**
 * Where a person's money came from and where it went, over a window.
 *
 * The provenance question the app could not answer: not "how much did I spend on health"
 * but "the money I spent on health — where had it come from?". Sources and destinations
 * are recorded on the event precisely so this can be asked without guessing.
 */
export async function moneyProvenance(
  db: SQLiteDatabase, from: string, to: string,
): Promise<{ sources: { key: string; totalPaisa: number }[]; destinations: { key: string; totalPaisa: number }[] }> {
  const bucket = async (column: 'source' | 'destination') => {
    const rows = await db.getAllAsync<{ key: string; total: number }>(
      `SELECT ${column} AS key, COALESCE(SUM(amount_paisa), 0) AS total
         FROM life_events
        WHERE deleted_at IS NULL AND ${column} IS NOT NULL AND amount_paisa IS NOT NULL
          AND substr(occurred_at, 1, 10) BETWEEN ? AND ?
        GROUP BY ${column}
        ORDER BY total DESC`,
      from, to,
    );
    return rows.map((row) => ({ key: row.key, totalPaisa: Number(row.total) }));
  };
  return { sources: await bucket('source'), destinations: await bucket('destination') };
}

/**
 * Forget the events that existed only to explain a record now gone.
 *
 * Deleting a medicine has to take its line off the timeline, or the app goes on saying
 * something happened that the user has just said did not. But deleting the *bill* for a
 * doctor's visit must not: the visit still happened, it simply turns out to have cost
 * nothing.
 *
 * So the rule is about what the record was to the event. The thing itself — role RECORD —
 * takes the event with it. A consequence takes the event only when it was the last one
 * left, which is the ordinary case of an expense that was its own whole story.
 */
export async function forgetEventsFor(db: SQLiteDatabase, effectType: string, effectId: string): Promise<number> {
  const links = await db.getAllAsync<{ event_id: string; role: string | null }>(
    'SELECT event_id, role FROM life_event_effects WHERE effect_type = ? AND effect_id = ?',
    effectType, effectId,
  );
  let forgotten = 0;
  for (const link of links) {
    if (link.role !== 'RECORD') {
      const others = await db.getFirstAsync<{ n: number }>(
        'SELECT COUNT(*) AS n FROM life_event_effects WHERE event_id = ? AND NOT (effect_type = ? AND effect_id = ?)',
        link.event_id, effectType, effectId,
      );
      if (Number(others?.n ?? 0) > 0) continue;
    }
    if (await softDeleteLifeEvent(db, link.event_id)) forgotten += 1;
  }
  return forgotten;
}

/**
 * Keep an event's headline figure in step with the record that carries it.
 *
 * The event does not hold the money — `fin_entries` and `dr_transactions` do, on purpose,
 * so there is exactly one place an amount can be wrong. But `amount_paisa` on the event
 * itself is a deliberate exception: it is what a day-by-day timeline shows without loading
 * every effect, so it has to be *a copy that stays a copy*. Only a MONEY-role effect drives
 * it — a LEDGER or RECORD effect describes the same event without being its figure, and a
 * multi-effect story (a visit with several bills) must not have its total silently
 * overwritten by whichever one bill happened to change.
 */
export async function syncEventAmountForEffect(
  db: SQLiteDatabase, effectType: string, effectId: string, amountPaisa: number, occurredAt: string,
): Promise<void> {
  const rows = await db.getAllAsync<{ event_id: string; role: string | null }>(
    'SELECT event_id, role FROM life_event_effects WHERE effect_type = ? AND effect_id = ?',
    effectType, effectId,
  );
  for (const row of rows) {
    if (row.role !== 'MONEY') continue;
    await db.runAsync(
      'UPDATE life_events SET amount_paisa = ?, occurred_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      amountPaisa, occurredAt, new Date().toISOString(), row.event_id,
    );
  }
}

/**
 * The other half of `forgetEventsFor`: bring back whatever it quietly took down.
 *
 * Restoring a record from Trash used to stop at the record's own row — the event
 * `forgetEventsFor` soft-deleted alongside it (because that record was the event's whole
 * story) stayed gone, so an undone delete still left the timeline permanently missing that
 * day. The link in `life_event_effects` outlives the soft delete on either side, which is
 * what makes finding it again possible.
 */
export async function restoreEventsFor(db: SQLiteDatabase, effectType: string, effectId: string): Promise<number> {
  const links = await db.getAllAsync<{ event_id: string }>(
    'SELECT event_id FROM life_event_effects WHERE effect_type = ? AND effect_id = ?',
    effectType, effectId,
  );
  let restored = 0;
  for (const link of links) {
    const result = await db.runAsync(
      'UPDATE life_events SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL',
      new Date().toISOString(), link.event_id,
    );
    if (result.changes > 0) restored += 1;
  }
  return restored;
}

/**
 * Retire an event without touching what it explains.
 *
 * Deleting the story must never delete the money: the records stay exactly where they are
 * and go on counting. All that is lost is the sentence tying them together.
 */
export async function softDeleteLifeEvent(db: SQLiteDatabase, id: string): Promise<boolean> {
  const result = await db.runAsync(
    'UPDATE life_events SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    new Date().toISOString(), new Date().toISOString(), id,
  );
  return result.changes > 0;
}
