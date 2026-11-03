// Places attached to records, for every module at once.
//
// Keyed the way attachments are — an owner kind and an owner id, no foreign key — so a
// module that does not exist yet can pin a place to its own rows without touching this
// file or the schema. A memory made in Cox's Bazar, an expense at a particular shop and a
// doctor's visit are one mechanism, not three columns copied three times.
//
// Nothing here reads the GPS. Capturing is `src/services/capture/place.ts`, which is the
// only file allowed to ask; this one just stores what it was handed.

import type { SQLiteDatabase } from 'expo-sqlite';
import { exclusiveTransaction } from '../database/atomic';
import { cleanPlaceLabel, type Place } from './capture/place';

export interface StoredPlace extends Place {
  id: string;
  ownerType: string;
  ownerId: string;
}

interface PlaceRow {
  id: string;
  owner_type: string;
  owner_id: string;
  latitude: number;
  longitude: number;
  label: string | null;
  captured_at: string;
}

const toPlace = (row: PlaceRow): StoredPlace => ({
  id: row.id,
  ownerType: row.owner_type,
  ownerId: row.owner_id,
  latitude: row.latitude,
  longitude: row.longitude,
  label: row.label,
  capturedAt: row.captured_at,
});

const newId = () => `place-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Pin a place to a record.
 *
 * A record has one place, not a list — "where was this" has a single answer — so an
 * existing pin is replaced rather than added to.
 */
export async function setPlace(
  db: SQLiteDatabase,
  ownerType: string,
  ownerId: string,
  place: Place,
): Promise<StoredPlace> {
  const id = newId();
  const now = new Date().toISOString();
  await exclusiveTransaction(db, async () => {
    await db.runAsync('DELETE FROM places WHERE owner_type = ? AND owner_id = ?', ownerType, ownerId);
    await db.runAsync(
      `INSERT INTO places (id, owner_type, owner_id, latitude, longitude, label, captured_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, ownerType, ownerId, place.latitude, place.longitude, place.label, place.capturedAt || now, now,
    );
  });
  return { ...place, id, ownerType, ownerId };
}

export async function getPlace(db: SQLiteDatabase, ownerType: string, ownerId: string): Promise<StoredPlace | null> {
  const row = await db.getFirstAsync<PlaceRow>(
    'SELECT id, owner_type, owner_id, latitude, longitude, label, captured_at FROM places WHERE owner_type = ? AND owner_id = ? LIMIT 1',
    ownerType, ownerId,
  );
  return row ? toPlace(row) : null;
}

export async function clearPlace(db: SQLiteDatabase, ownerType: string, ownerId: string): Promise<boolean> {
  const result = await db.runAsync('DELETE FROM places WHERE owner_type = ? AND owner_id = ?', ownerType, ownerId);
  return result.changes > 0;
}

/**
 * Everything pinned near a point, nearest first.
 *
 * Filtered with a plain bounding box rather than a distance formula: SQLite has no
 * trigonometry without an extension, and at the scale of "what else happened around here"
 * a box is the right answer anyway. A degree of latitude is about 111 km everywhere; a
 * degree of longitude shrinks towards the poles, which is why it is divided by the cosine.
 */
export async function placesNear(
  db: SQLiteDatabase,
  latitude: number,
  longitude: number,
  withinKm = 2,
): Promise<StoredPlace[]> {
  const latSpan = withinKm / 111;
  const lonSpan = withinKm / Math.max(1, 111 * Math.cos((latitude * Math.PI) / 180));
  const rows = await db.getAllAsync<PlaceRow>(
    `SELECT id, owner_type, owner_id, latitude, longitude, label, captured_at
       FROM places
      WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?
      ORDER BY captured_at DESC
      LIMIT 100`,
    latitude - latSpan, latitude + latSpan, longitude - lonSpan, longitude + lonSpan,
  );
  return rows.map(toPlace);
}

/** Drop the pins belonging to a record that is being deleted for good. */
export async function removePlacesForOwner(db: SQLiteDatabase, ownerType: string, ownerId: string): Promise<number> {
  const result = await db.runAsync('DELETE FROM places WHERE owner_type = ? AND owner_id = ?', ownerType, ownerId);
  return result.changes;
}

/**
 * Places the user has named before, newest first, one per name — offered as chips so the
 * shop visited every week is one tap, not another GPS reading (the user's rule, RC.4).
 */
export async function recentNamedPlaces(db: SQLiteDatabase, limit = 6): Promise<Place[]> {
  const rows = await db.getAllAsync<{ label: string; latitude: number; longitude: number; captured_at: string }>(
    `SELECT label, latitude, longitude, MAX(captured_at) AS captured_at
       FROM places
      WHERE label IS NOT NULL AND trim(label) <> ''
      GROUP BY label
      ORDER BY captured_at DESC
      LIMIT ?`,
    limit,
  );
  // Labels saved before the Plus Code fix are cleaned here too; one chip per name.
  const seen = new Set<string>();
  return rows
    .map((r) => ({ label: cleanPlaceLabel(r.label), latitude: r.latitude, longitude: r.longitude, capturedAt: r.captured_at }))
    .filter((p): p is Place & { label: string } => Boolean(p.label) && !seen.has(p.label!) && Boolean(seen.add(p.label!)));
}

/** The name already given to a spot within a few hundred metres, if any. */
export async function knownNameNear(db: SQLiteDatabase, latitude: number, longitude: number): Promise<string | null> {
  const near = await placesNear(db, latitude, longitude, 0.3);
  for (const p of near) { const clean = cleanPlaceLabel(p.label); if (clean) return clean; }
  return null;
}
