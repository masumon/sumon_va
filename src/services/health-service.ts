// স্বাস্থ্য — medicines, doctors, tests, and what each of them cost.
//
// The money decision came first, and everything else follows from it: **this module owns
// no money.** A medical cost is an ordinary EXPENSE row in `fin_entries`, exactly like a
// grocery bill, and a health record simply remembers which row it created. Health totals
// are read back out of that same table.
//
// It would have been easier to keep a `cost_paisa` column here and add it up. It would
// also have been wrong the first time someone edited the expense from the money screen —
// two numbers claiming to be the same amount always drift, and then neither can be
// trusted. Because there is only ever one row, "is the medicine bill double-counted?" is
// not a question that has anywhere to go wrong.
//
// What this module does own is everything money cannot say: what the medicine is for,
// when to take it, how many are left in the box, and whether this morning's dose was
// actually swallowed.

import type { SQLiteDatabase } from 'expo-sqlite';
import { bangladeshDateKey, bangladeshMonthKey, zonedInstant, businessInstant } from '../i18n/date-time';
import { addEntry, deleteEntry, updateEntry, type FinanceEntry, isFundSource, type FundSource } from './finance-service';
import { atomic } from '../database/atomic';
import { recordLifeEvent, attachEffect, forgetEventsFor } from './life-event-service';
import { registerAttachmentOwner } from './attachment-service';
import { type Paisa } from './debt/money';

// A test report is a file like any other in this app — same store, same trash, same
// backup. Registering the owner is what stops a photo being copied in against a test
// that has already been thrown away.
registerAttachmentOwner('HL_TEST', async (db, ownerId) =>
  Boolean(await db.getFirstAsync<{ id: string }>('SELECT id FROM hl_tests WHERE id = ? AND deleted_at IS NULL LIMIT 1', ownerId)));

// ── the categories a medical cost lands in ─────────────────────────────────────
//
// Real finance categories, not a private enum: they appear in the month's category
// breakdown, they can carry a budget, and someone who types "ওষুধ" on the money screen
// without ever opening Health lands in exactly the same bucket.

export const MEDICINE_CATEGORY = 'ওষুধ';
export const DOCTOR_CATEGORY = 'ডাক্তার';
export const TEST_CATEGORY = 'পরীক্ষা';
export const HOSPITAL_CATEGORY = 'হাসপাতাল';
export const TREATMENT_CATEGORY = 'চিকিৎসা';
export const OTHER_HEALTH_CATEGORY = 'স্বাস্থ্য-অন্যান্য';

export const HEALTH_CATEGORIES = [
  MEDICINE_CATEGORY, DOCTOR_CATEGORY, TEST_CATEGORY,
  HOSPITAL_CATEGORY, TREATMENT_CATEGORY, OTHER_HEALTH_CATEGORY,
] as const;
export type HealthCategory = (typeof HEALTH_CATEGORIES)[number];

const IN_HEALTH = `category IN (${HEALTH_CATEGORIES.map((c) => `'${c}'`).join(', ')})`;

export function healthCategoryName(category: string, bn: boolean): string {
  if (bn) return category;
  switch (category) {
    case MEDICINE_CATEGORY: return 'Medicine';
    case DOCTOR_CATEGORY: return 'Doctor';
    case TEST_CATEGORY: return 'Test';
    case HOSPITAL_CATEGORY: return 'Hospital';
    case TREATMENT_CATEGORY: return 'Treatment';
    case OTHER_HEALTH_CATEGORY: return 'Other medical';
    default: return category;
  }
}

// ── shapes ─────────────────────────────────────────────────────────────────────

export type FoodTiming = 'BEFORE' | 'AFTER' | 'WITH' | 'ANY';
export type DoseStatus = 'PENDING' | 'TAKEN' | 'SKIPPED' | 'SNOOZED';

export interface MedicineTime { id: string; medicineId: string; atTime: string; label: string | null; seq: number }

export interface Medicine {
  id: string;
  name: string;
  reason: string | null;
  doctor: string | null;
  prescriptionId: string | null;
  doseText: string | null;
  perDose: number;
  timesPerDay: number;
  food: FoodTiming;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  totalUnits: number;
  usedUnits: number;
  pharmacy: string | null;
  purchasedOn: string | null;
  purchaseEntryId: string | null;
  note: string | null;
  archivedAt: string | null;
  times: MedicineTime[];
}

export interface Dose {
  id: string;
  medicineId: string;
  medicineName?: string;
  dueAt: string;
  dayKey: string;
  status: DoseStatus;
  actedAt: string | null;
  snoozeUntil: string | null;
  units: number;
  note: string | null;
}

export interface Visit {
  id: string;
  doctor: string;
  specialty: string | null;
  visitedOn: string;
  visitedAtTime: string | null;
  reason: string | null;
  diagnosis: string | null;
  feePaisa: Paisa;
  extraPaisa: Paisa;
  followUpOn: string | null;
  prescriptionId: string | null;
  note: string | null;
  feeEntryId: string | null;
  extraEntryId: string | null;
}

export interface MedicalTest {
  id: string;
  name: string;
  reason: string | null;
  testedOn: string;
  testedAtTime: string | null;
  lab: string | null;
  costPaisa: Paisa;
  result: string | null;
  reference: string | null;
  repeatOn: string | null;
  note: string | null;
  entryId: string | null;
  visitId: string | null;
}

export interface Prescription {
  id: string;
  doctor: string | null;
  issuedOn: string | null;
  diagnosis: string | null;
  advice: string | null;
  followUpOn: string | null;
  note: string | null;
}

const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();
const clean = (v?: string | null) => (v?.trim() ? v.trim() : null);

/** The instant a health record's cost is filed at — the same anchor the money screen uses. */
// The app-wide business date. It used to fall back to `new Date()` in UTC, which filed
// a medicine bought at two in the morning on the day before.
const anchorDay = (day?: string | null) => businessInstant(day);

// ── the one place a medical cost becomes money ─────────────────────────────────

/**
 * Write, change or remove the single expense row that stands for one health cost.
 *
 * Everything about a medical expense's life passes through here: created when an amount
 * is first entered, edited when it changes, soft-deleted when it goes to zero or the
 * record is thrown away. The caller hands back whatever id it gets and stores it — that
 * id is the only link between the two worlds, and there is deliberately no second copy of
 * the amount on the health side to disagree with it.
 */
export async function syncCostEntry(
  db: SQLiteDatabase,
  input: {
    entryId: string | null;
    amountPaisa: Paisa;
    category: HealthCategory;
    occurredOn?: string | null;
    walletId?: string | null;
    fundSource?: FundSource | null;
    fundAccountId?: string | null;
    fundNote?: string | null;
    method?: string | null;
    personId?: string | null;
    /** The medical event this cost is part of, so the money book knows what it was for. */
    eventId?: string | null;
    note?: string | null;
  },
): Promise<string | null> {
  const amount = Math.max(0, Math.round(input.amountPaisa));

  if (!amount) {
    // No cost any more. The row has to go, or the month keeps paying for it.
    if (input.entryId) await deleteEntry(db, input.entryId);
    return null;
  }

  const shared = {
    kind: 'EXPENSE' as const,
    amount,
    category: input.category,
    occurredAt: anchorDay(input.occurredOn),
    walletId: input.walletId ?? null,
    fundSource: input.fundSource ?? null,
    fundAccountId: input.fundAccountId ?? null,
    fundNote: input.fundNote ?? null,
    method: clean(input.method),
    personId: input.personId ?? null,
    // Health costs belong to the medical event that caused them, not to a bare expense
    // sitting on its own in the money book with no idea what it was for.
    eventId: input.eventId ?? null,
    note: clean(input.note),
  };

  if (input.entryId) {
    await updateEntry(db, input.entryId, shared);
    return input.entryId;
  }
  const entry = await addEntry(db, shared);
  return entry.id;
}

// ── medicines ──────────────────────────────────────────────────────────────────

type MedRow = {
  id: string; name: string; reason: string | null; doctor: string | null; prescription_id: string | null;
  dose_text: string | null; per_dose: number; times_per_day: number; food: FoodTiming;
  start_date: string | null; end_date: string | null; duration_days: number | null;
  total_units: number; used_units: number; pharmacy: string | null; purchased_on: string | null;
  purchase_entry_id: string | null; note: string | null; archived_at: string | null;
};

const toMedicine = (row: MedRow, times: MedicineTime[]): Medicine => ({
  id: row.id, name: row.name, reason: row.reason, doctor: row.doctor, prescriptionId: row.prescription_id,
  doseText: row.dose_text, perDose: row.per_dose, timesPerDay: row.times_per_day, food: row.food,
  startDate: row.start_date, endDate: row.end_date, durationDays: row.duration_days,
  totalUnits: row.total_units, usedUnits: row.used_units, pharmacy: row.pharmacy,
  purchasedOn: row.purchased_on, purchaseEntryId: row.purchase_entry_id, note: row.note,
  archivedAt: row.archived_at, times,
});

export interface MedicineInput {
  name: string;
  reason?: string | null;
  doctor?: string | null;
  prescriptionId?: string | null;
  doseText?: string | null;
  perDose?: number;
  food?: FoodTiming;
  startDate?: string | null;
  endDate?: string | null;
  durationDays?: number | null;
  totalUnits?: number;
  pharmacy?: string | null;
  purchasedOn?: string | null;
  /** What the box cost. Becomes one EXPENSE row under ওষুধ; zero writes nothing. */
  costPaisa?: Paisa;
  walletId?: string | null;
  fundSource?: FundSource | null;
  fundAccountId?: string | null;
  fundNote?: string | null;
  method?: string | null;
  note?: string | null;
  /** "08:00", "14:00", "21:00" — the clock times it is due. */
  times?: { atTime: string; label?: string | null }[];
}

/**
 * Buying a medicine is one event: the pharmacy bill and the medicine record land together,
 * or neither does.
 */
export async function createMedicine(db: SQLiteDatabase, input: MedicineInput): Promise<Medicine> {
  return atomic(db, () => createMedicineWithin(db, input));
}

async function createMedicineWithin(db: SQLiteDatabase, input: MedicineInput): Promise<Medicine> {
  const name = input.name.trim();
  if (!name) throw new Error('ওষুধের নাম দিন / A medicine needs a name');
  const id = uid('med');
  const stamp = now();
  const times = (input.times ?? []).filter((t) => /^\d{2}:\d{2}$/u.test(t.atTime));

  // Buying a medicine is a thing that happened, and the pharmacy bill is one of its
  // consequences. Naming the event is what lets the money book say what a taka was for.
  const eventId = await recordLifeEvent(db, {
    type: 'MEDICAL', occurredAt: input.purchasedOn ?? input.startDate,
    title: name, place: clean(input.pharmacy), purpose: 'MEDICAL',
    destination: clean(input.pharmacy) ?? MEDICINE_CATEGORY,
    amountPaisa: input.costPaisa ?? null, note: clean(input.reason),
  });

  const purchaseEntryId = await syncCostEntry(db, {
    entryId: null,
    amountPaisa: input.costPaisa ?? 0,
    category: MEDICINE_CATEGORY,
    occurredOn: input.purchasedOn ?? input.startDate,
    walletId: input.walletId, fundSource: input.fundSource, fundAccountId: input.fundAccountId, fundNote: input.fundNote,
    method: input.method,
    eventId,
    note: `${name}${input.pharmacy ? ` · ${input.pharmacy}` : ''}`,
  });

  await atomic(db, async () => {
    await db.runAsync(
      `INSERT INTO hl_medicines (id, name, reason, doctor, prescription_id, dose_text, per_dose,
         times_per_day, food, start_date, end_date, duration_days, total_units, used_units,
         pharmacy, purchased_on, purchase_entry_id, note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)`,
      id, name, clean(input.reason), clean(input.doctor), input.prescriptionId ?? null,
      clean(input.doseText), input.perDose ?? 1, times.length || 1, input.food ?? 'ANY',
      input.startDate ?? null, input.endDate ?? null, input.durationDays ?? null,
      input.totalUnits ?? 0, clean(input.pharmacy), input.purchasedOn ?? null,
      purchaseEntryId, clean(input.note), stamp, stamp,
    );
    for (const [seq, t] of times.entries()) {
      await db.runAsync(
        'INSERT INTO hl_medicine_times (id, medicine_id, at_time, label, seq) VALUES (?,?,?,?,?)',
        uid('mt'), id, t.atTime, clean(t.label), seq,
      );
    }
  });

  await attachEffect(db, eventId, { type: 'HL_MEDICINE', id, role: 'RECORD' });
  return (await getMedicine(db, id))!;
}

/**
 * Correcting what a medicine cost must not be able to move the money without the record.
 */
export async function updateMedicine(db: SQLiteDatabase, id: string, input: Partial<MedicineInput>): Promise<void> {
  return atomic(db, () => updateMedicineWithin(db, id, input));
}

async function updateMedicineWithin(db: SQLiteDatabase, id: string, input: Partial<MedicineInput>): Promise<void> {
  const current = await getMedicine(db, id);
  if (!current) throw new Error('ওষুধটি নেই / That medicine no longer exists');
  const times = input.times?.filter((t) => /^\d{2}:\d{2}$/u.test(t.atTime));

  const purchaseEntryId = input.costPaisa === undefined
    ? current.purchaseEntryId
    : await syncCostEntry(db, {
      entryId: current.purchaseEntryId,
      amountPaisa: input.costPaisa,
      category: MEDICINE_CATEGORY,
      occurredOn: input.purchasedOn ?? current.purchasedOn ?? current.startDate,
      walletId: input.walletId, fundSource: input.fundSource, fundAccountId: input.fundAccountId, fundNote: input.fundNote,
      method: input.method,
      note: `${input.name?.trim() || current.name}`,
    });

  await atomic(db, async () => {
    await db.runAsync(
      `UPDATE hl_medicines SET name = ?, reason = ?, doctor = ?, dose_text = ?, per_dose = ?,
         times_per_day = ?, food = ?, start_date = ?, end_date = ?, duration_days = ?,
         total_units = ?, pharmacy = ?, purchased_on = ?, purchase_entry_id = ?, note = ?, updated_at = ?
       WHERE id = ?`,
      input.name?.trim() || current.name,
      input.reason === undefined ? current.reason : clean(input.reason),
      input.doctor === undefined ? current.doctor : clean(input.doctor),
      input.doseText === undefined ? current.doseText : clean(input.doseText),
      input.perDose ?? current.perDose,
      times ? (times.length || 1) : current.timesPerDay,
      input.food ?? current.food,
      input.startDate === undefined ? current.startDate : input.startDate,
      input.endDate === undefined ? current.endDate : input.endDate,
      input.durationDays === undefined ? current.durationDays : input.durationDays,
      input.totalUnits ?? current.totalUnits,
      input.pharmacy === undefined ? current.pharmacy : clean(input.pharmacy),
      input.purchasedOn === undefined ? current.purchasedOn : input.purchasedOn,
      purchaseEntryId,
      input.note === undefined ? current.note : clean(input.note),
      now(), id,
    );
    if (times) {
      await db.runAsync('DELETE FROM hl_medicine_times WHERE medicine_id = ?', id);
      for (const [seq, t] of times.entries()) {
        await db.runAsync(
          'INSERT INTO hl_medicine_times (id, medicine_id, at_time, label, seq) VALUES (?,?,?,?,?)',
          uid('mt'), id, t.atTime, clean(t.label), seq,
        );
      }
      // Doses not yet acted on belong to the old schedule; the new times replace them.
      await db.runAsync(
        `DELETE FROM hl_doses WHERE medicine_id = ? AND status = 'PENDING' AND due_at >= ?`,
        id, now(),
      );
    }
  });
}

export async function getMedicine(db: SQLiteDatabase, id: string): Promise<Medicine | null> {
  const row = await db.getFirstAsync<MedRow>(
    'SELECT * FROM hl_medicines WHERE id = ? AND deleted_at IS NULL', id,
  );
  if (!row) return null;
  const times = await db.getAllAsync<{ id: string; medicine_id: string; at_time: string; label: string | null; seq: number }>(
    'SELECT * FROM hl_medicine_times WHERE medicine_id = ? ORDER BY seq, at_time', id,
  );
  return toMedicine(row, times.map((t) => ({ id: t.id, medicineId: t.medicine_id, atTime: t.at_time, label: t.label, seq: t.seq })));
}

export async function listMedicines(db: SQLiteDatabase, opts: { includeArchived?: boolean } = {}): Promise<Medicine[]> {
  const rows = await db.getAllAsync<MedRow>(
    `SELECT * FROM hl_medicines WHERE deleted_at IS NULL ${opts.includeArchived ? '' : 'AND archived_at IS NULL'}
      ORDER BY archived_at IS NOT NULL, name`,
  );
  if (!rows.length) return [];
  const times = await db.getAllAsync<{ id: string; medicine_id: string; at_time: string; label: string | null; seq: number }>(
    'SELECT * FROM hl_medicine_times ORDER BY seq, at_time',
  );
  return rows.map((row) => toMedicine(row, times
    .filter((t) => t.medicine_id === row.id)
    .map((t) => ({ id: t.id, medicineId: t.medicine_id, atTime: t.at_time, label: t.label, seq: t.seq }))));
}

/**
 * Throw a medicine away, and take its expense with it.
 *
 * Soft on the health side so the trash can restore it, but the money row is deleted for
 * real (also softly — `fin_entries` has its own trash). Leaving the expense behind would
 * be a ghost: a cost in the month with nothing left to explain it.
 */
/**
 * Removing a medicine removes what it cost. Half of that would leave a ghost expense.
 */
export async function deleteMedicine(db: SQLiteDatabase, id: string): Promise<boolean> {
  return atomic(db, () => deleteMedicineWithin(db, id));
}

async function deleteMedicineWithin(db: SQLiteDatabase, id: string): Promise<boolean> {
  const medicine = await getMedicine(db, id);
  if (!medicine) return false;
  if (medicine.purchaseEntryId) await deleteEntry(db, medicine.purchaseEntryId);
  const r = await db.runAsync('UPDATE hl_medicines SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', now(), id);
  if (r.changes > 0) await forgetEventsFor(db, 'HL_MEDICINE', id);
  return r.changes > 0;
}

export async function archiveMedicine(db: SQLiteDatabase, id: string, archived = true): Promise<void> {
  await db.runAsync('UPDATE hl_medicines SET archived_at = ?, updated_at = ? WHERE id = ?', archived ? now() : null, now(), id);
}

// ── the stock arithmetic ───────────────────────────────────────────────────────

export interface MedicineStock {
  remainingUnits: number;
  perDayUnits: number;
  daysLeft: number | null;
  /** Dhaka day key the box is expected to run out on, or null when it cannot be known. */
  runsOutOn: string | null;
  /** True once there is roughly a week or less left — time to buy more. */
  needsRefill: boolean;
}

export function medicineStock(medicine: Medicine, today = new Date()): MedicineStock {
  const remainingUnits = Math.max(0, medicine.totalUnits - medicine.usedUnits);
  const perDayUnits = Math.max(0, medicine.perDose * Math.max(1, medicine.timesPerDay));
  if (!medicine.totalUnits || !perDayUnits) {
    return { remainingUnits, perDayUnits, daysLeft: null, runsOutOn: null, needsRefill: false };
  }
  // A finished course is not being taken any more — projecting when leftover units would
  // "run out" produced a refill reminder for a medicine the person stopped months ago
  // (executed: a course ended 5 months back still projected a future `runsOutOn`).
  const courseEnded = !!medicine.endDate && bangladeshDateKey(today) > medicine.endDate;
  const daysLeft = Math.floor(remainingUnits / perDayUnits);
  if (courseEnded) {
    return { remainingUnits, perDayUnits, daysLeft, runsOutOn: null, needsRefill: false };
  }
  const out = new Date(today);
  out.setDate(out.getDate() + daysLeft);
  return {
    remainingUnits,
    perDayUnits,
    daysLeft,
    runsOutOn: bangladeshDateKey(out),
    needsRefill: daysLeft <= 7,
  };
}

// ── doses: what is due, and what happened to it ────────────────────────────────

const toDose = (r: {
  id: string; medicine_id: string; due_at: string; day_key: string; status: DoseStatus;
  acted_at: string | null; snooze_until: string | null; units: number; note: string | null; name?: string;
}): Dose => ({
  id: r.id, medicineId: r.medicine_id, medicineName: r.name, dueAt: r.due_at, dayKey: r.day_key,
  status: r.status, actedAt: r.acted_at, snoozeUntil: r.snooze_until, units: r.units, note: r.note,
});

/**
 * Make sure every dose due on `dayKey` exists as a row, then hand them back.
 *
 * Rows are created on the day they are needed rather than months in advance. A schedule
 * that has not happened yet is not history, and materialising a year of it would mean
 * rewriting thousands of rows every time a time of day is nudged by fifteen minutes.
 *
 * Idempotent: called on every screen open, it inserts only what is missing.
 */
export async function ensureDosesForDay(db: SQLiteDatabase, dayKey: string): Promise<Dose[]> {
  const medicines = await listMedicines(db);
  const live = medicines.filter((m) => withinCourse(m, dayKey) && m.times.length > 0);

  if (live.length) {
    const existing = await db.getAllAsync<{ medicine_id: string; due_at: string }>(
      'SELECT medicine_id, due_at FROM hl_doses WHERE day_key = ?', dayKey,
    );
    const seen = new Set(existing.map((e) => `${e.medicine_id}@${e.due_at}`));
    await atomic(db, async () => {
      for (const medicine of live) {
        for (const time of medicine.times) {
          const dueAt = dhakaInstant(dayKey, time.atTime);
          if (seen.has(`${medicine.id}@${dueAt}`)) continue;
          await db.runAsync(
            `INSERT INTO hl_doses (id, medicine_id, due_at, day_key, status, units) VALUES (?,?,?,?,'PENDING',?)`,
            uid('dose'), medicine.id, dueAt, dayKey, medicine.perDose,
          );
        }
      }
    });
  }

  return listDoses(db, dayKey);
}

export async function listDoses(db: SQLiteDatabase, dayKey: string): Promise<Dose[]> {
  const rows = await db.getAllAsync<never>(
    `SELECT d.*, m.name AS name FROM hl_doses d
       JOIN hl_medicines m ON m.id = d.medicine_id
      WHERE d.day_key = ? AND m.deleted_at IS NULL
      ORDER BY d.due_at`,
    dayKey,
  );
  return rows.map(toDose);
}

/** Doses that came due and were never answered — up to `days` back from today. */
export async function missedDoses(db: SQLiteDatabase, days = 3): Promise<Dose[]> {
  const from = new Date();
  from.setDate(from.getDate() - days);
  const rows = await db.getAllAsync<never>(
    `SELECT d.*, m.name AS name FROM hl_doses d
       JOIN hl_medicines m ON m.id = d.medicine_id
      WHERE m.deleted_at IS NULL AND d.status = 'PENDING' AND d.due_at < ? AND d.day_key >= ?
      ORDER BY d.due_at DESC LIMIT 40`,
    now(), bangladeshDateKey(from),
  );
  return rows.map(toDose);
}

/** The next dose still waiting, today or later. */
export async function nextDose(db: SQLiteDatabase): Promise<Dose | null> {
  const row = await db.getFirstAsync<never>(
    `SELECT d.*, m.name AS name FROM hl_doses d
       JOIN hl_medicines m ON m.id = d.medicine_id
      WHERE m.deleted_at IS NULL AND d.status IN ('PENDING','SNOOZED') AND d.due_at >= ?
      ORDER BY d.due_at LIMIT 1`,
    now(),
  );
  return row ? toDose(row) : null;
}

/**
 * Record what happened to a dose, and move the stock.
 *
 * Only TAKEN moves the count: skipping a dose does not consume a tablet, and a box that
 * emptied itself every time someone forgot would predict the wrong refill date. Marking
 * a dose taken twice does not consume it twice either — the previous status is undone
 * first, so this stays safe to tap.
 */
export async function setDoseStatus(
  db: SQLiteDatabase, doseId: string, status: DoseStatus, opts: { snoozeMinutes?: number } = {},
): Promise<void> {
  const dose = await db.getFirstAsync<{ id: string; medicine_id: string; status: DoseStatus; units: number }>(
    'SELECT id, medicine_id, status, units FROM hl_doses WHERE id = ?', doseId,
  );
  if (!dose) return;
  if (dose.status === status && status !== 'SNOOZED') return;

  const wasTaken = dose.status === 'TAKEN';
  const isTaken = status === 'TAKEN';
  const delta = (isTaken ? dose.units : 0) - (wasTaken ? dose.units : 0);
  const snoozeUntil = status === 'SNOOZED'
    ? new Date(Date.now() + (opts.snoozeMinutes ?? 15) * 60_000).toISOString()
    : null;

  await atomic(db, async () => {
    await db.runAsync(
      'UPDATE hl_doses SET status = ?, acted_at = ?, snooze_until = ? WHERE id = ?',
      status, status === 'PENDING' ? null : now(), snoozeUntil, doseId,
    );
    if (delta !== 0) {
      await db.runAsync(
        'UPDATE hl_medicines SET used_units = MAX(0, used_units + ?), updated_at = ? WHERE id = ?',
        delta, now(), dose.medicine_id,
      );
    }
  });
}

/** Is `dayKey` inside this medicine's course? */
export function withinCourse(medicine: Medicine, dayKey: string): boolean {
  if (medicine.archivedAt) return false;
  if (medicine.startDate && dayKey < medicine.startDate.slice(0, 10)) return false;
  if (medicine.endDate && dayKey > medicine.endDate.slice(0, 10)) return false;
  return true;
}

/** A wall-clock dose time on a calendar day, in the app's zone, as a real instant. */
export const dhakaInstant = zonedInstant;

// ── doctor visits ──────────────────────────────────────────────────────────────

type VisitRow = {
  id: string; doctor: string; specialty: string | null; visited_on: string; visited_at_time: string | null;
  reason: string | null; diagnosis: string | null; fee_paisa: number; extra_paisa: number;
  follow_up_on: string | null; prescription_id: string | null; note: string | null;
  fee_entry_id: string | null; extra_entry_id: string | null;
};

const toVisit = (r: VisitRow): Visit => ({
  id: r.id, doctor: r.doctor, specialty: r.specialty, visitedOn: r.visited_on, visitedAtTime: r.visited_at_time,
  reason: r.reason, diagnosis: r.diagnosis, feePaisa: r.fee_paisa, extraPaisa: r.extra_paisa,
  followUpOn: r.follow_up_on, prescriptionId: r.prescription_id, note: r.note,
  feeEntryId: r.fee_entry_id, extraEntryId: r.extra_entry_id,
});

export interface VisitInput {
  doctor: string;
  specialty?: string | null;
  visitedOn: string;
  visitedAtTime?: string | null;
  reason?: string | null;
  diagnosis?: string | null;
  feePaisa?: Paisa;
  extraPaisa?: Paisa;
  followUpOn?: string | null;
  prescriptionId?: string | null;
  note?: string | null;
  walletId?: string | null;
  fundSource?: FundSource | null;
  fundAccountId?: string | null;
  fundNote?: string | null;
  method?: string | null;
  personId?: string | null;
}

/**
 * A visit carries two expense rows, the fee and everything else. Three writes, one decision.
 */
export async function saveVisit(db: SQLiteDatabase, input: VisitInput, id?: string): Promise<Visit> {
  return atomic(db, () => saveVisitWithin(db, input, id));
}

async function saveVisitWithin(db: SQLiteDatabase, input: VisitInput, id?: string): Promise<Visit> {
  const doctor = input.doctor.trim();
  if (!doctor) throw new Error('ডাক্তারের নাম দিন / A visit needs a doctor');
  const existing = id ? await getVisit(db, id) : null;
  const visitId = existing?.id ?? uid('visit');
  const stamp = now();

  // The consultation and whatever else was paid on the day are two different expenses,
  // so they are two rows — a fee that can be compared with the last visit's, and a
  // "everything else" that does not silently inflate it.
  // One visit, up to three records: the fee, everything else paid on the day, and the
  // visit itself. They were three unrelated rows; now they are one thing that happened.
  const eventId = await recordLifeEvent(db, {
    type: 'MEDICAL', occurredAt: input.visitedOn, title: doctor,
    personId: input.personId ?? null, purpose: 'MEDICAL', destination: doctor,
    amountPaisa: (input.feePaisa ?? 0) + (input.extraPaisa ?? 0),
    note: clean(input.reason),
  });

  const feeEntryId = await syncCostEntry(db, {
    entryId: existing?.feeEntryId ?? null,
    amountPaisa: input.feePaisa ?? 0,
    category: DOCTOR_CATEGORY,
    occurredOn: input.visitedOn,
    walletId: input.walletId, fundSource: input.fundSource, fundAccountId: input.fundAccountId, fundNote: input.fundNote, method: input.method, personId: input.personId,
    eventId,
    note: `${doctor}${input.specialty ? ` · ${input.specialty}` : ''}`,
  });
  const extraEntryId = await syncCostEntry(db, {
    entryId: existing?.extraEntryId ?? null,
    amountPaisa: input.extraPaisa ?? 0,
    category: TREATMENT_CATEGORY,
    occurredOn: input.visitedOn,
    walletId: input.walletId, fundSource: input.fundSource, fundAccountId: input.fundAccountId, fundNote: input.fundNote, method: input.method, personId: input.personId,
    eventId,
    note: `${doctor} · ${input.reason?.trim() || 'চিকিৎসা'}`,
  });

  if (existing) {
    await db.runAsync(
      `UPDATE hl_visits SET doctor = ?, specialty = ?, visited_on = ?, visited_at_time = ?, reason = ?,
         diagnosis = ?, fee_paisa = ?, extra_paisa = ?, follow_up_on = ?, prescription_id = ?, note = ?,
         fee_entry_id = ?, extra_entry_id = ?, updated_at = ? WHERE id = ?`,
      doctor, clean(input.specialty), input.visitedOn, clean(input.visitedAtTime), clean(input.reason),
      clean(input.diagnosis), input.feePaisa ?? 0, input.extraPaisa ?? 0, input.followUpOn ?? null,
      input.prescriptionId ?? null, clean(input.note), feeEntryId, extraEntryId, stamp, visitId,
    );
  } else {
    await db.runAsync(
      `INSERT INTO hl_visits (id, doctor, specialty, visited_on, visited_at_time, reason, diagnosis,
         fee_paisa, extra_paisa, follow_up_on, prescription_id, note, fee_entry_id, extra_entry_id,
         created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      visitId, doctor, clean(input.specialty), input.visitedOn, clean(input.visitedAtTime),
      clean(input.reason), clean(input.diagnosis), input.feePaisa ?? 0, input.extraPaisa ?? 0,
      input.followUpOn ?? null, input.prescriptionId ?? null, clean(input.note),
      feeEntryId, extraEntryId, stamp, stamp,
    );
  }
  await attachEffect(db, eventId, { type: 'HL_VISIT', id: visitId, role: 'RECORD' });
  return (await getVisit(db, visitId))!;
}

export async function getVisit(db: SQLiteDatabase, id: string): Promise<Visit | null> {
  const row = await db.getFirstAsync<VisitRow>('SELECT * FROM hl_visits WHERE id = ? AND deleted_at IS NULL', id);
  return row ? toVisit(row) : null;
}

export async function listVisits(db: SQLiteDatabase, opts: { limit?: number; from?: string; to?: string } = {}): Promise<Visit[]> {
  const where = ['deleted_at IS NULL'];
  const args: (string | number)[] = [];
  if (opts.from) { where.push('visited_on >= ?'); args.push(opts.from); }
  if (opts.to) { where.push('visited_on <= ?'); args.push(opts.to); }
  args.push(opts.limit ?? 100);
  const rows = await db.getAllAsync<VisitRow>(
    `SELECT * FROM hl_visits WHERE ${where.join(' AND ')} ORDER BY visited_on DESC, created_at DESC LIMIT ?`, ...args,
  );
  return rows.map(toVisit);
}

/**
 * Both of the visit’s expense rows go with it, or the visit stays.
 */
export async function deleteVisit(db: SQLiteDatabase, id: string): Promise<boolean> {
  return atomic(db, () => deleteVisitWithin(db, id));
}

async function deleteVisitWithin(db: SQLiteDatabase, id: string): Promise<boolean> {
  const visit = await getVisit(db, id);
  if (!visit) return false;
  if (visit.feeEntryId) await deleteEntry(db, visit.feeEntryId);
  if (visit.extraEntryId) await deleteEntry(db, visit.extraEntryId);
  const r = await db.runAsync('UPDATE hl_visits SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', now(), id);
  if (r.changes > 0) await forgetEventsFor(db, 'HL_VISIT', id);
  return r.changes > 0;
}

// ── medical tests ──────────────────────────────────────────────────────────────

type TestRow = {
  id: string; name: string; reason: string | null; tested_on: string; tested_at_time: string | null;
  lab: string | null; cost_paisa: number; result: string | null; reference: string | null;
  repeat_on: string | null; note: string | null; entry_id: string | null; visit_id: string | null;
};

const toTest = (r: TestRow): MedicalTest => ({
  id: r.id, name: r.name, reason: r.reason, testedOn: r.tested_on, testedAtTime: r.tested_at_time,
  lab: r.lab, costPaisa: r.cost_paisa, result: r.result, reference: r.reference,
  repeatOn: r.repeat_on, note: r.note, entryId: r.entry_id, visitId: r.visit_id,
});

export interface TestInput {
  name: string;
  reason?: string | null;
  testedOn: string;
  testedAtTime?: string | null;
  lab?: string | null;
  costPaisa?: Paisa;
  result?: string | null;
  reference?: string | null;
  repeatOn?: string | null;
  note?: string | null;
  visitId?: string | null;
  walletId?: string | null;
  fundSource?: FundSource | null;
  fundAccountId?: string | null;
  fundNote?: string | null;
  method?: string | null;
}

/**
 * The lab bill and the test record are the same event.
 */
export async function saveTest(db: SQLiteDatabase, input: TestInput, id?: string): Promise<MedicalTest> {
  return atomic(db, () => saveTestWithin(db, input, id));
}

async function saveTestWithin(db: SQLiteDatabase, input: TestInput, id?: string): Promise<MedicalTest> {
  const name = input.name.trim();
  if (!name) throw new Error('পরীক্ষার নাম দিন / A test needs a name');
  const existing = id ? await getTest(db, id) : null;
  const testId = existing?.id ?? uid('test');
  const stamp = now();

  const eventId = await recordLifeEvent(db, {
    type: 'MEDICAL', occurredAt: input.testedOn, title: name,
    place: clean(input.lab), purpose: 'MEDICAL', destination: clean(input.lab) ?? TEST_CATEGORY,
    amountPaisa: input.costPaisa ?? null, note: clean(input.reason),
  });

  const entryId = await syncCostEntry(db, {
    entryId: existing?.entryId ?? null,
    amountPaisa: input.costPaisa ?? 0,
    category: TEST_CATEGORY,
    occurredOn: input.testedOn,
    walletId: input.walletId, fundSource: input.fundSource, fundAccountId: input.fundAccountId, fundNote: input.fundNote, method: input.method,
    eventId,
    note: `${name}${input.lab ? ` · ${input.lab}` : ''}`,
  });

  if (existing) {
    await db.runAsync(
      `UPDATE hl_tests SET name = ?, reason = ?, tested_on = ?, tested_at_time = ?, lab = ?, cost_paisa = ?,
         result = ?, reference = ?, repeat_on = ?, note = ?, entry_id = ?, visit_id = ?, updated_at = ? WHERE id = ?`,
      name, clean(input.reason), input.testedOn, clean(input.testedAtTime), clean(input.lab),
      input.costPaisa ?? 0, clean(input.result), clean(input.reference), input.repeatOn ?? null,
      clean(input.note), entryId, input.visitId ?? null, stamp, testId,
    );
  } else {
    await db.runAsync(
      `INSERT INTO hl_tests (id, name, reason, tested_on, tested_at_time, lab, cost_paisa, result,
         reference, repeat_on, note, entry_id, visit_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      testId, name, clean(input.reason), input.testedOn, clean(input.testedAtTime), clean(input.lab),
      input.costPaisa ?? 0, clean(input.result), clean(input.reference), input.repeatOn ?? null,
      clean(input.note), entryId, input.visitId ?? null, stamp, stamp,
    );
  }
  await attachEffect(db, eventId, { type: 'HL_TEST', id: testId, role: 'RECORD' });
  return (await getTest(db, testId))!;
}

export async function getTest(db: SQLiteDatabase, id: string): Promise<MedicalTest | null> {
  const row = await db.getFirstAsync<TestRow>('SELECT * FROM hl_tests WHERE id = ? AND deleted_at IS NULL', id);
  return row ? toTest(row) : null;
}

export async function listTests(db: SQLiteDatabase, opts: { limit?: number; from?: string; to?: string } = {}): Promise<MedicalTest[]> {
  const where = ['deleted_at IS NULL'];
  const args: (string | number)[] = [];
  if (opts.from) { where.push('tested_on >= ?'); args.push(opts.from); }
  if (opts.to) { where.push('tested_on <= ?'); args.push(opts.to); }
  args.push(opts.limit ?? 100);
  const rows = await db.getAllAsync<TestRow>(
    `SELECT * FROM hl_tests WHERE ${where.join(' AND ')} ORDER BY tested_on DESC, created_at DESC LIMIT ?`, ...args,
  );
  return rows.map(toTest);
}

/**
 * The test goes with its cost, or nothing goes.
 */
export async function deleteTest(db: SQLiteDatabase, id: string): Promise<boolean> {
  return atomic(db, () => deleteTestWithin(db, id));
}

async function deleteTestWithin(db: SQLiteDatabase, id: string): Promise<boolean> {
  const test = await getTest(db, id);
  if (!test) return false;
  if (test.entryId) await deleteEntry(db, test.entryId);
  const r = await db.runAsync('UPDATE hl_tests SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', now(), id);
  if (r.changes > 0) await forgetEventsFor(db, 'HL_TEST', id);
  return r.changes > 0;
}

// ── prescriptions ──────────────────────────────────────────────────────────────

export async function savePrescription(
  db: SQLiteDatabase,
  input: { doctor?: string | null; issuedOn?: string | null; diagnosis?: string | null; advice?: string | null; followUpOn?: string | null; note?: string | null },
  id?: string,
): Promise<Prescription> {
  const stamp = now();
  const pid = id ?? uid('rx');
  if (id) {
    await db.runAsync(
      `UPDATE hl_prescriptions SET doctor = ?, issued_on = ?, diagnosis = ?, advice = ?, follow_up_on = ?, note = ?, updated_at = ? WHERE id = ?`,
      clean(input.doctor), input.issuedOn ?? null, clean(input.diagnosis), clean(input.advice),
      input.followUpOn ?? null, clean(input.note), stamp, pid,
    );
  } else {
    await db.runAsync(
      `INSERT INTO hl_prescriptions (id, doctor, issued_on, diagnosis, advice, follow_up_on, note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      pid, clean(input.doctor), input.issuedOn ?? null, clean(input.diagnosis), clean(input.advice),
      input.followUpOn ?? null, clean(input.note), stamp, stamp,
    );
  }
  return (await getPrescription(db, pid))!;
}

export async function getPrescription(db: SQLiteDatabase, id: string): Promise<Prescription | null> {
  const r = await db.getFirstAsync<{ id: string; doctor: string | null; issued_on: string | null; diagnosis: string | null; advice: string | null; follow_up_on: string | null; note: string | null }>(
    'SELECT * FROM hl_prescriptions WHERE id = ? AND deleted_at IS NULL', id,
  );
  return r ? { id: r.id, doctor: r.doctor, issuedOn: r.issued_on, diagnosis: r.diagnosis, advice: r.advice, followUpOn: r.follow_up_on, note: r.note } : null;
}

export async function listPrescriptions(db: SQLiteDatabase, limit = 60): Promise<Prescription[]> {
  const rows = await db.getAllAsync<{ id: string; doctor: string | null; issued_on: string | null; diagnosis: string | null; advice: string | null; follow_up_on: string | null; note: string | null }>(
    'SELECT * FROM hl_prescriptions WHERE deleted_at IS NULL ORDER BY issued_on DESC, created_at DESC LIMIT ?', limit,
  );
  return rows.map((r) => ({ id: r.id, doctor: r.doctor, issuedOn: r.issued_on, diagnosis: r.diagnosis, advice: r.advice, followUpOn: r.follow_up_on, note: r.note }));
}

export async function deletePrescription(db: SQLiteDatabase, id: string): Promise<boolean> {
  const r = await db.runAsync('UPDATE hl_prescriptions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', now(), id);
  return r.changes > 0;
}

// ── the money, read back out of the one ledger ─────────────────────────────────

export interface MedicalSpend {
  totalPaisa: Paisa;
  byCategory: { category: string; totalPaisa: Paisa; count: number }[];
}

/**
 * What medical care cost over a period — read from `fin_entries`, never from a column here.
 *
 * `from`/`to` are Dhaka day keys compared against the stored day prefix, which is how
 * every other month total in the app is keyed, so a health figure and the month's expense
 * figure are answering with the same rows.
 */
export async function medicalSpend(db: SQLiteDatabase, from?: string, to?: string): Promise<MedicalSpend> {
  const where = [`deleted_at IS NULL`, `kind = 'EXPENSE'`, IN_HEALTH];
  const args: string[] = [];
  if (from) { where.push('substr(occurred_at, 1, 10) >= ?'); args.push(from); }
  if (to) { where.push('substr(occurred_at, 1, 10) <= ?'); args.push(to); }
  const rows = await db.getAllAsync<{ category: string; total: number; n: number }>(
    `SELECT category, SUM(amount_paisa) AS total, COUNT(*) AS n FROM fin_entries
      WHERE ${where.join(' AND ')} GROUP BY category ORDER BY total DESC`,
    ...args,
  );
  return {
    totalPaisa: rows.reduce((sum, r) => sum + r.total, 0),
    byCategory: rows.map((r) => ({ category: r.category, totalPaisa: r.total, count: r.n })),
  };
}

export interface MedicalSpendPeriods { todayPaisa: Paisa; monthPaisa: Paisa; yearPaisa: Paisa }

export async function medicalSpendPeriods(db: SQLiteDatabase, today = new Date()): Promise<MedicalSpendPeriods> {
  const day = bangladeshDateKey(today);
  const month = bangladeshMonthKey(today);
  const year = month.slice(0, 4);
  const [d, m, y] = await Promise.all([
    medicalSpend(db, day, day),
    medicalSpend(db, `${month}-01`, `${month}-31`),
    medicalSpend(db, `${year}-01-01`, `${year}-12-31`),
  ]);
  return { todayPaisa: d.totalPaisa, monthPaisa: m.totalPaisa, yearPaisa: y.totalPaisa };
}

/** Every medical expense row, newest first — the money half of the health history. */
export async function listMedicalEntries(db: SQLiteDatabase, limit = 200): Promise<FinanceEntry[]> {
  const rows = await db.getAllAsync<never>(
    `SELECT e.id, e.kind, e.amount_paisa, e.category, e.method, e.person_id, p.name AS person_name,
            e.occurred_at, e.note, e.recurring, e.wallet_id, e.transfer_id, e.fund_source, e.fund_account_id, e.fund_note
       FROM fin_entries e LEFT JOIN people p ON p.id = e.person_id
      WHERE e.deleted_at IS NULL AND e.kind = 'EXPENSE' AND e.${IN_HEALTH}
      ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT ?`,
    limit,
  );
  return (rows as unknown as {
    id: string; kind: 'EXPENSE'; amount_paisa: number; category: string; method: string | null;
    person_id: string | null; person_name: string | null; occurred_at: string; note: string | null;
    recurring: string | null; wallet_id: string | null; transfer_id: string | null;
    fund_source: string | null; fund_account_id: string | null; fund_note: string | null;
  }[]).map((r) => ({
    id: r.id, kind: r.kind, amountPaisa: r.amount_paisa, category: r.category, method: r.method,
    personId: r.person_id, personName: r.person_name, occurredAt: r.occurred_at, note: r.note,
    recurring: r.recurring, walletId: r.wallet_id, transferId: r.transfer_id,
    fundSource: isFundSource(r.fund_source) ? r.fund_source : null, fundAccountId: r.fund_account_id, fundNote: r.fund_note ?? null,
  }));
}

// ── what is coming ─────────────────────────────────────────────────────────────

export interface UpcomingHealth {
  kind: 'FOLLOW_UP' | 'REPEAT_TEST' | 'REFILL' | 'COURSE_END';
  id: string;
  title: string;
  dayKey: string;
  route: string;
}

/** Follow-ups, repeat tests, refills and courses about to end — the next `days` of them. */
export async function upcomingHealth(db: SQLiteDatabase, language: 'bn' | 'en', days = 30): Promise<UpcomingHealth[]> {
  const bn = language === 'bn';
  const today = bangladeshDateKey(new Date());
  const until = new Date();
  until.setDate(until.getDate() + days);
  const untilKey = bangladeshDateKey(until);
  const out: UpcomingHealth[] = [];

  const visits = await db.getAllAsync<{ id: string; doctor: string; follow_up_on: string }>(
    `SELECT id, doctor, follow_up_on FROM hl_visits
      WHERE deleted_at IS NULL AND follow_up_on IS NOT NULL AND follow_up_on >= ? AND follow_up_on <= ?
      ORDER BY follow_up_on LIMIT 20`, today, untilKey,
  );
  for (const v of visits) {
    out.push({
      kind: 'FOLLOW_UP', id: `visit-${v.id}`, dayKey: v.follow_up_on, route: '/health/visits',
      title: bn ? `${v.doctor} — ফলো-আপ` : `${v.doctor} — follow-up`,
    });
  }

  const tests = await db.getAllAsync<{ id: string; name: string; repeat_on: string }>(
    `SELECT id, name, repeat_on FROM hl_tests
      WHERE deleted_at IS NULL AND repeat_on IS NOT NULL AND repeat_on >= ? AND repeat_on <= ?
      ORDER BY repeat_on LIMIT 20`, today, untilKey,
  );
  for (const t of tests) {
    out.push({
      kind: 'REPEAT_TEST', id: `test-${t.id}`, dayKey: t.repeat_on, route: '/health/tests',
      title: bn ? `${t.name} — আবার করাতে হবে` : `${t.name} — repeat test`,
    });
  }

  for (const medicine of await listMedicines(db)) {
    const stock = medicineStock(medicine);
    if (stock.needsRefill && stock.runsOutOn && stock.runsOutOn <= untilKey) {
      out.push({
        kind: 'REFILL', id: `refill-${medicine.id}`, dayKey: stock.runsOutOn,
        route: `/health/medicine/${medicine.id}`,
        title: bn ? `${medicine.name} — ফুরিয়ে আসছে` : `${medicine.name} — running out`,
      });
    }
    if (medicine.endDate && medicine.endDate >= today && medicine.endDate <= untilKey) {
      out.push({
        kind: 'COURSE_END', id: `end-${medicine.id}`, dayKey: medicine.endDate,
        route: `/health/medicine/${medicine.id}`,
        title: bn ? `${medicine.name} — কোর্স শেষ` : `${medicine.name} — course ends`,
      });
    }
  }

  return out.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}
