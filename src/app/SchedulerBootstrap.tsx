import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { runNotificationScheduler } from '../services/scheduler-runner';
import { registerBackgroundScheduler } from '../services/background-scheduler-task';
import { isDbBusy } from '../services/db-busy-guard';
import { useAppPreferences } from './AppPreferences';

const SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;

export function SchedulerBootstrap() {
  const db = useSQLiteContext();
  const running = useRef(false);
  const { reminderLeadMinutes, quietHours } = useAppPreferences();
  const quietKey = quietHours ? `${quietHours.start}:${quietHours.end}` : '';
  const settled = useRef<string | null>(null);

  // "Remind me earlier" or quiet hours changed: move the reminders already queued now,
  // not on the next tick (RC.4 QA: the setting seemed to do nothing).
  useEffect(() => {
    const key = `${reminderLeadMinutes}|${quietKey}`;
    if (settled.current === null) { settled.current = key; return; }
    if (settled.current === key || running.current || isDbBusy()) return;
    settled.current = key;
    running.current = true;
    void runNotificationScheduler(db).catch(() => {}).finally(() => { running.current = false; });
  }, [db, reminderLeadMinutes, quietKey]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      // A backup or restore in progress owns the database's full attention right now — this
      // tick will fire again on the next interval or the next foreground transition, so
      // skipping it here costs nothing but the risk of racing a much heavier operation.
      if (!active || running.current || isDbBusy()) return;
      running.current = true;
      try {
        await runNotificationScheduler(db);
      } catch {
        // Scheduling must never create an unhandled rejection or block the app. Note the
        // interval only fires while the app is foregrounded (JS timers are suspended in
        // the background) — the every-15-min tick is really "while open", plus a run on
        // every foreground transition. Real coverage while the app is closed comes from
        // the registered OS background task below (F-016); this interval is the fast,
        // no-wait-for-the-OS path for while it is actually open.
      } finally {
        running.current = false;
      }
    };

    // Every database call shares one queue (db-serializer). Rescheduling all reminders the
    // instant the app opens put the first screen's own reads behind it; a short wait lets
    // Home load first. Reminders already scheduled with the OS are unaffected meanwhile.
    const firstRun = setTimeout(() => { void run(); }, 2500);
    // Fire-and-forget, idempotent — safe on every mount, and failure here (a device that
    // refuses background task registration outright) leaves this foreground path as the
    // only fallback exactly as it always was.
    void registerBackgroundScheduler();
    const intervalId = setInterval(() => void run(), SCHEDULER_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run();
    });

    return () => {
      active = false;
      clearTimeout(firstRun);
      clearInterval(intervalId);
      subscription.remove();
    };
  }, [db]);

  return null;
}
