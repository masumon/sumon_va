import type { SQLiteDatabase } from 'expo-sqlite';
import { getNotificationCandidates } from './scheduler-notification-service';
import * as notificationAdapter from './expo-notification-adapter';

const DEFAULT_HORIZON_MINUTES = 7 * 24 * 60;

export async function runNotificationScheduler(
  db: SQLiteDatabase,
  now = new Date(),
  horizonMinutes = DEFAULT_HORIZON_MINUTES,
): Promise<number> {
  try {
    if (notificationAdapter.reconcileScheduledTaskNotifications) {
      await notificationAdapter.reconcileScheduledTaskNotifications(db, now);
    }
    let quietHours: notificationAdapter.QuietHours | null = null;
    let leadMinutes = 0;
    try {
      const rows = await db.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM app_preferences WHERE key IN ('quietHours', 'reminderLeadMinutes')");
      for (const row of rows) {
        if (row.key === 'quietHours') { const m = row.value.match(/^(\d{1,2}):(\d{1,2})$/u); if (m) quietHours = { start: Number(m[1]), end: Number(m[2]) }; }
        if (row.key === 'reminderLeadMinutes') { const n = Number(row.value); if (Number.isFinite(n) && n >= 0 && n <= 7 * 24 * 60) leadMinutes = n; }
      }
    } catch { /* both preferences are optional */ }
    // What the OS still has queued — lets the candidate query re-schedule reminders a
    // battery optimiser or Doze silently dropped. Undefined = keep plain behaviour.
    let liveScheduledKeys: ReadonlySet<string> | undefined;
    try {
      liveScheduledKeys = notificationAdapter.getLiveScheduledKeys
        ? await notificationAdapter.getLiveScheduledKeys()
        : undefined;
    } catch {
      liveScheduledKeys = undefined;
    }
    const candidates = await getNotificationCandidates(db, now, horizonMinutes, { liveScheduledKeys });
    if (!candidates.length) return 0;
    // One fetch of the OS's scheduled list and one permission check for the whole batch,
    // not one of each per candidate — see `buildScheduleContext`'s own comment for why
    // that was the actual cost of rescheduling reminders after a reboot.
    const context = notificationAdapter.buildScheduleContext
      ? await notificationAdapter.buildScheduleContext()
      : undefined;
    const results = await Promise.all(candidates.map(async (candidate) => {
      try {
        return await notificationAdapter.scheduleTaskNotification(db, candidate, quietHours, leadMinutes, context);
      } catch {
        // One failed platform operation must not block other reminders.
        return null;
      }
    }));
    return results.filter(Boolean).length;
  } catch {
    // Background scheduling is best-effort and must never destabilize the app.
    return 0;
  }
}

export { DEFAULT_HORIZON_MINUTES };
