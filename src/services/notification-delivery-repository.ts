import type { SQLiteDatabase } from 'expo-sqlite';

export async function hasNotificationBeenDelivered(
  db: SQLiteDatabase,
  taskId: string,
  dueAt: string,
): Promise<boolean> {
  if (typeof db.getFirstAsync !== 'function') return false;
  const row = await db.getFirstAsync<{ task_id: string }>(
    'SELECT task_id FROM notification_deliveries WHERE task_id = ? AND due_at = ? LIMIT 1',
    taskId,
    dueAt,
  );
  return Boolean(row);
}

/** Remove the delivery marker so the scheduler can (re)schedule this reminder — used
 * when a previously-scheduled OS notification has gone missing (Doze / OEM app kill)
 * but the task is still planned and in the future. */
export async function clearNotificationDelivered(
  db: SQLiteDatabase,
  taskId: string,
  dueAt: string,
): Promise<void> {
  if (typeof db.runAsync !== 'function') return;
  await db.runAsync('DELETE FROM notification_deliveries WHERE task_id = ? AND due_at = ?', taskId, dueAt);
}

export async function markNotificationDelivered(
  db: SQLiteDatabase,
  taskId: string,
  dueAt: string,
  deliveredAt = new Date().toISOString(),
): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO notification_deliveries (task_id, due_at, delivered_at)
     VALUES (?, ?, ?)`,
    taskId,
    dueAt,
    deliveredAt,
  );
}
