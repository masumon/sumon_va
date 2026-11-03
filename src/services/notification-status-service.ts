import * as Notifications from 'expo-notifications';

export interface ScheduledReminderSummary {
  id: string;
  taskId: string | null;
  dueAt: string | null;
  title: string;
}

export interface NotificationStatus {
  granted: boolean;
  canAskAgain: boolean;
  scheduled: ScheduledReminderSummary[];
}

export async function getNotificationStatus(): Promise<NotificationStatus> {
  try {
    const permission = await Notifications.getPermissionsAsync();
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();

    return {
      granted: permission.granted,
      canAskAgain: permission.canAskAgain,
      scheduled: scheduled.map((item) => {
        const data = item.content.data as { taskId?: unknown; dueAt?: unknown } | undefined;
        return {
          id: item.identifier,
          taskId: typeof data?.taskId === 'string' ? data.taskId : null,
          // Task reminders carry their due time; module reminders (debts, medicines) only have
          // the OS trigger, so the list falls back to when it will ring.
          dueAt: typeof data?.dueAt === 'string' ? data.dueAt : triggerIso(item.trigger),
          title: item.content.body ?? item.content.title ?? 'Task reminder',
        };
      }),
    };
  } catch {
    return { granted: false, canAskAgain: false, scheduled: [] };
  }
}

/** When a scheduled notification will ring, from the OS trigger (date triggers only). */
export function triggerIso(trigger: unknown): string | null {
  if (!trigger || typeof trigger !== 'object') return null;
  const t = trigger as { value?: unknown; date?: unknown; timestamp?: unknown };
  const raw = t.value ?? t.date ?? t.timestamp;
  const ms = typeof raw === 'number' ? raw : raw instanceof Date ? raw.getTime() : typeof raw === 'string' ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}
