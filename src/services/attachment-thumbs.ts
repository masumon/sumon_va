import type { SQLiteDatabase } from 'expo-sqlite';
import type { AttachmentOwner } from './attachment-service';

// One batched lookup of "the first image attached to each of these items", so a list
// can show a real thumbnail where there is one and fall back to an icon otherwise.
// Keeps it to a single query regardless of list length.
export async function loadImageThumbs(
  db: SQLiteDatabase,
  ownerType: AttachmentOwner,
  ownerIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(ownerIds)].filter(Boolean);
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.getAllAsync<{ owner_id: string; uri: string }>(
    `SELECT owner_id, uri FROM attachments
       WHERE owner_type = ? AND mime_type LIKE 'image/%' AND owner_id IN (${placeholders})
       ORDER BY created_at ASC`,
    ownerType,
    ...ids,
  );
  for (const row of rows) if (!map.has(row.owner_id)) map.set(row.owner_id, row.uri);
  return map;
}
