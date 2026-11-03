// People, shared by every module.
//
// A creditor, a doctor, a landlord, a teacher and the person who owes you for the rice
// are all the same row. `people` stopped belonging to the debt module in migration 17;
// this is the door every other module uses to reach it, so that adding a person while
// writing down an expense creates the same Rahim the debt ledger already knows.
//
// Matching is deliberately conservative: a phone number is treated as identity, a name
// only when it is written exactly the same way. Merging two people who are not the same
// person is far worse than having two rows the user can tidy later.

import type { SQLiteDatabase } from 'expo-sqlite';

export interface Person {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  relationship: string | null;
  notes: string | null;
}

interface PersonRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  relationship: string | null;
  notes: string | null;
}

const SELECT = 'SELECT id, name, phone, email, address, relationship, notes FROM people';

const newId = () => `person-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The digits that identify a phone, with the ways of writing it stripped away.
 *
 * `01712345678`, `+8801712345678`, `017 1234 5678` and `017-1234-5678` are one person
 * writing one number four ways, and matching them as strings made four Rahims — one per
 * screen that had ever asked for a phone. Four Rahims means a debt on one of them and a
 * medical bill on another, and no total that adds up.
 *
 * The last ten digits are the key. A Bangladeshi mobile is `01XXXXXXXXX`; with +88 in
 * front it is thirteen. Dropping everything before the final ten leaves exactly the part
 * that never changes, whichever prefix was typed. Anything shorter is compared whole,
 * because a five-digit short code is not a mobile and its last ten digits do not exist.
 *
 * Only ever used for comparison. What the user typed is what stays in the row and what
 * every screen shows back: this decides who two rows are, not how a number is spelled.
 */
export function phoneKey(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/gu, '');
  if (!digits) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

const tidy = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim();
  return trimmed || null;
};

export async function getPerson(db: SQLiteDatabase, id: string): Promise<Person | null> {
  const row = await db.getFirstAsync<PersonRow>(`${SELECT} WHERE id = ? AND deleted_at IS NULL`, id);
  return row ?? null;
}

export async function searchPeople(db: SQLiteDatabase, query: string, limit = 12): Promise<Person[]> {
  const term = query.trim();
  if (!term) {
    return db.getAllAsync<PersonRow>(`${SELECT} WHERE deleted_at IS NULL ORDER BY name LIMIT ?`, limit);
  }
  const like = `%${term}%`;
  return db.getAllAsync<PersonRow>(
    `${SELECT} WHERE deleted_at IS NULL AND (name LIKE ? OR phone LIKE ?) ORDER BY name LIMIT ?`,
    like, like, limit,
  );
}

/**
 * The same person, written differently.
 *
 * Kept separate from the exact lookup above so the common path stays a single indexed
 * query. This one only runs when a number was given and nothing matched it character for
 * character, which is the case where a duplicate was about to be created.
 */
async function matchByPhoneDigits(db: SQLiteDatabase, phone: string): Promise<PersonRow | null> {
  const key = phoneKey(phone);
  if (!key) return null;
  const rows = await db.getAllAsync<PersonRow>(
    `${SELECT} WHERE deleted_at IS NULL AND phone IS NOT NULL AND trim(phone) <> ''`,
  );
  return rows.find((row) => phoneKey(row.phone) === key) ?? null;
}

/**
 * Find the person, or make them.
 *
 * A phone number is the strongest signal there is, so it is checked first; a name is
 * matched only on an exact, case-insensitive equal. Anything looser risks quietly folding
 * two different people into one, and a ledger that does that is worse than useless.
 *
 * When an existing row is found, blank fields on it are filled in from what was supplied —
 * so picking someone from contacts a second time adds the email they now have, without
 * ever overwriting something the user typed by hand.
 */
export async function findOrCreatePerson(
  db: SQLiteDatabase,
  input: { name: string; phone?: string | null; email?: string | null; address?: string | null; relationship?: string | null },
): Promise<Person> {
  const name = input.name.trim();
  if (!name) throw new Error('A person needs a name');
  const phone = tidy(input.phone);
  const email = tidy(input.email);
  const address = tidy(input.address);
  const relationship = tidy(input.relationship);

  // Exact first, because it is one indexed lookup and it is what usually happens. Only
  // when that misses is the number compared as digits, and only against rows that have a
  // number at all — a scan of a personal address book, not of a ledger.
  const existing = phone
    ? (await db.getFirstAsync<PersonRow>(`${SELECT} WHERE deleted_at IS NULL AND phone = ? LIMIT 1`, phone))
      ?? await matchByPhoneDigits(db, phone)
    : await db.getFirstAsync<PersonRow>(
        `${SELECT} WHERE deleted_at IS NULL AND lower(trim(name)) = lower(?) LIMIT 1`, name,
      );

  if (existing) {
    const filled = {
      phone: existing.phone ?? phone,
      email: existing.email ?? email,
      address: existing.address ?? address,
      relationship: existing.relationship ?? relationship,
    };
    const changed =
      filled.phone !== existing.phone ||
      filled.email !== existing.email ||
      filled.address !== existing.address ||
      filled.relationship !== existing.relationship;
    if (changed) {
      await db.runAsync(
        'UPDATE people SET phone = ?, email = ?, address = ?, relationship = ?, updated_at = ? WHERE id = ?',
        filled.phone, filled.email, filled.address, filled.relationship, new Date().toISOString(), existing.id,
      );
    }
    return { ...existing, ...filled };
  }

  const id = newId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO people (id, name, phone, email, address, relationship, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    id, name, phone, email, address, relationship, now, now,
  );
  return { id, name, phone, email, address, relationship, notes: null };
}

export async function updatePerson(db: SQLiteDatabase, id: string, patch: Partial<Omit<Person, 'id'>>): Promise<void> {
  const current = await getPerson(db, id);
  if (!current) throw new Error('That person no longer exists');
  await db.runAsync(
    'UPDATE people SET name = ?, phone = ?, email = ?, address = ?, relationship = ?, notes = ?, updated_at = ? WHERE id = ?',
    (patch.name ?? current.name).trim(),
    patch.phone === undefined ? current.phone : tidy(patch.phone),
    patch.email === undefined ? current.email : tidy(patch.email),
    patch.address === undefined ? current.address : tidy(patch.address),
    patch.relationship === undefined ? current.relationship : tidy(patch.relationship),
    patch.notes === undefined ? current.notes : tidy(patch.notes),
    new Date().toISOString(),
    id,
  );
}

/**
 * Remove a person from the list.
 *
 * Soft, so a mistaken tap is recoverable and nothing that referenced them is orphaned.
 *
 * This lives here rather than in a module because people belong to the person, not to
 * whichever module happened to create them: deletion used to exist only inside the debt
 * module's own person screen, which meant somebody who added a contact from the People
 * tab — or who had the debt module switched off — could never remove a name, a number
 * and an address they had entered by mistake. For an app that keeps that kind of thing
 * on principle, "you cannot take it back" is not a small gap.
 */
/**
 * Whether a person still carries any live record that names them — a debt account, a
 * wallet entry, or a life event. Removing the person while any of these stand would leave
 * that record's "who" pointing at someone the app claims does not exist, so this is the one
 * check every deletion path shares (see `deletePerson` below and `debt/repository.ts`'s
 * `softDeletePerson`, which used to run its own copy of only the first of these three).
 */
export async function personHasLiveRecords(db: SQLiteDatabase, id: string): Promise<boolean> {
  // Three independent checks, not one combined query: a schema that lacks one of these
  // tables (a narrower test fixture, an older migration mid-upgrade) must not let a
  // missing table's error swallow a genuine hit in one of the other two.
  const tables = ['dr_accounts', 'fin_entries', 'life_events'];
  for (const table of tables) {
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE person_id = ? AND deleted_at IS NULL`, id,
    ).catch(() => ({ n: 0 }));
    if ((row?.n ?? 0) > 0) return true;
  }
  return false;
}

export async function deletePerson(db: SQLiteDatabase, id: string): Promise<boolean> {
  // A person still carrying live money records is not deletable — removing them would
  // strand the accounts. The caller says so in words; this is the guard behind it.
  if (await personHasLiveRecords(db, id)) throw new PersonHasRecordsError();

  const stamp = new Date().toISOString();
  const result = await db.runAsync(
    'UPDATE people SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    stamp, stamp, id,
  );
  return (result.changes ?? 0) > 0;
}

/** Thrown when a person still has open accounts, so the screen can explain rather than fail. */
export class PersonHasRecordsError extends Error {
  constructor() { super('This person still has open accounts'); this.name = 'PersonHasRecordsError'; }
}
