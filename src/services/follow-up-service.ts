// The record that somebody was actually contacted — তাগাদা.
//
// Android does not let an app read its own call log or incoming messages without
// permissions that exist to be abused, and a phone call leaves no trace this app could
// find afterwards. So the app writes down the contact it made itself: you tapped call,
// the dialler opened, and that moment is on the record with the date beside it.
//
// That turns out to be the part that matters. When a loan is disputed a year later the
// question is never "did the phone ring" but "did you ever ask" — and eleven dated rows
// saying you called are an answer. The same rows are what tell the debt list who has been
// chased this month and who has been left alone since March.
//
// Owner-keyed like attachments and places, so a follow-up hangs off any module's row.

import type { SQLiteDatabase } from 'expo-sqlite';
import { Linking } from 'react-native';

export type FollowUpChannel = 'CALL' | 'SMS' | 'MEET' | 'NOTE';
/** OUT is you reaching them. IN is them reaching you, written down by hand. */
export type FollowUpDirection = 'OUT' | 'IN';

export interface FollowUp {
  id: string;
  ownerType: string;
  ownerId: string;
  channel: FollowUpChannel;
  direction: FollowUpDirection;
  happenedAt: string;
  note: string | null;
}

interface FollowUpRow {
  id: string;
  owner_type: string;
  owner_id: string;
  channel: FollowUpChannel;
  direction: FollowUpDirection;
  happened_at: string;
  note: string | null;
}

const toFollowUp = (row: FollowUpRow): FollowUp => ({
  id: row.id,
  ownerType: row.owner_type,
  ownerId: row.owner_id,
  channel: row.channel,
  direction: row.direction,
  happenedAt: row.happened_at,
  note: row.note,
});

const newId = () => `fu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export async function recordFollowUp(
  db: SQLiteDatabase,
  input: {
    ownerType: string;
    ownerId: string;
    channel: FollowUpChannel;
    direction?: FollowUpDirection;
    happenedAt?: string;
    note?: string | null;
  },
): Promise<FollowUp> {
  const id = newId();
  const now = new Date().toISOString();
  const happenedAt = input.happenedAt ?? now;
  const direction = input.direction ?? 'OUT';
  const note = input.note?.trim() || null;
  await db.runAsync(
    `INSERT INTO follow_ups (id, owner_type, owner_id, channel, direction, happened_at, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, input.ownerType, input.ownerId, input.channel, direction, happenedAt, note, now,
  );
  return { id, ownerType: input.ownerType, ownerId: input.ownerId, channel: input.channel, direction, happenedAt, note };
}

export async function listFollowUps(db: SQLiteDatabase, ownerType: string, ownerId: string): Promise<FollowUp[]> {
  const rows = await db.getAllAsync<FollowUpRow>(
    `SELECT id, owner_type, owner_id, channel, direction, happened_at, note
       FROM follow_ups WHERE owner_type = ? AND owner_id = ? ORDER BY happened_at DESC`,
    ownerType, ownerId,
  );
  return rows.map(toFollowUp);
}

export async function lastFollowUp(db: SQLiteDatabase, ownerType: string, ownerId: string): Promise<FollowUp | null> {
  const row = await db.getFirstAsync<FollowUpRow>(
    `SELECT id, owner_type, owner_id, channel, direction, happened_at, note
       FROM follow_ups WHERE owner_type = ? AND owner_id = ? ORDER BY happened_at DESC LIMIT 1`,
    ownerType, ownerId,
  );
  return row ? toFollowUp(row) : null;
}

export async function countFollowUps(db: SQLiteDatabase, ownerType: string, ownerId: string): Promise<number> {
  const row = await db.getFirstAsync<{ total: number }>(
    'SELECT COUNT(*) AS total FROM follow_ups WHERE owner_type = ? AND owner_id = ?',
    ownerType, ownerId,
  );
  return row?.total ?? 0;
}

export async function deleteFollowUp(db: SQLiteDatabase, id: string): Promise<boolean> {
  const result = await db.runAsync('DELETE FROM follow_ups WHERE id = ?', id);
  return result.changes > 0;
}

export async function removeFollowUpsForOwner(db: SQLiteDatabase, ownerType: string, ownerId: string): Promise<number> {
  const result = await db.runAsync('DELETE FROM follow_ups WHERE owner_type = ? AND owner_id = ?', ownerType, ownerId);
  return result.changes;
}

// ── reaching out, and writing it down in the same breath ─────────────────────

export type ReachOutResult = { status: 'opened'; followUp: FollowUp } | { status: 'unavailable' };

/**
 * Open the dialler or the messaging app, and record the attempt.
 *
 * The row is written even if the user backs out of the call, and that is deliberate: the
 * app cannot tell whether the call connected, so claiming it did would be a lie, while
 * claiming nothing happened would lose the one thing it does know. The note says what it
 * is — "called", not "spoke to".
 *
 * `tel:` and `sms:` are handled by the phone itself and need no permission. The CALL_PHONE
 * permission only decides whether the call starts immediately or waits on the green
 * button, which is why nothing here fails when it has not been granted.
 */
export async function reachOut(
  db: SQLiteDatabase,
  options: {
    ownerType: string;
    ownerId: string;
    phone: string;
    channel: 'CALL' | 'SMS';
    message?: string;
    note?: string;
  },
): Promise<ReachOutResult> {
  const number = options.phone.replace(/[^\d+]/gu, '');
  if (!number) return { status: 'unavailable' };
  const url = options.channel === 'CALL'
    ? `tel:${number}`
    : `sms:${number}${options.message ? `?body=${encodeURIComponent(options.message)}` : ''}`;
  try {
    await Linking.openURL(url);
  } catch {
    return { status: 'unavailable' };
  }
  const followUp = await recordFollowUp(db, {
    ownerType: options.ownerType,
    ownerId: options.ownerId,
    channel: options.channel,
    direction: 'OUT',
    note: options.note ?? null,
  });
  return { status: 'opened', followUp };
}
