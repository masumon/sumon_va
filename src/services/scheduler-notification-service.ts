import type { SQLiteDatabase } from 'expo-sqlite';
import { listDueTasks } from './scheduler-service';
import { clearNotificationDelivered, hasNotificationBeenDelivered } from './notification-delivery-repository';

export interface NotificationCandidate {
  taskId: string;
  title: string;
  dueAt: string;
}

export interface SchedulerNotificationState {
  deliveredNotificationKeys?: ReadonlySet<string>;
  /** `taskId:dueAt` keys the OS currently still has scheduled. When provided, a task
   * that is marked delivered but is NOT in this set (and is still in the future) is
   * treated as a *dropped* reminder: its marker is cleared and it is re-queued. */
  liveScheduledKeys?: ReadonlySet<string>;
}

export function notificationKey(taskId: string, dueAt: string): string {
  return `${taskId}:${dueAt}`;
}

export async function getNotificationCandidates(
  db: SQLiteDatabase,
  now = new Date(),
  horizonMinutes = 0,
  state: SchedulerNotificationState = {},
): Promise<NotificationCandidate[]> {
  const tasks = await listDueTasks(db, now, horizonMinutes);
  const candidates: NotificationCandidate[] = [];

  for (const task of tasks) {
    const dueAt = task.dueAt;
    if (!dueAt) continue;
    const key = notificationKey(task.id, dueAt);
    if (state.deliveredNotificationKeys?.has(key)) continue;
    if (await hasNotificationBeenDelivered(db, task.id, dueAt)) {
      const droppedByOs =
        state.liveScheduledKeys !== undefined &&
        !state.liveScheduledKeys.has(key) &&
        new Date(dueAt).getTime() > now.getTime();
      if (!droppedByOs) continue;
      // The OS lost this reminder — reset the marker so it gets scheduled again.
      await clearNotificationDelivered(db, task.id, dueAt);
    }
    candidates.push({ taskId: task.id, title: task.title, dueAt });
  }

  return candidates;
}
