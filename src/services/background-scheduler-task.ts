// F-016: reminder rescheduling used to be a `setInterval` inside `SchedulerBootstrap`
// alone — a JS timer, which Android suspends the instant the app leaves the foreground.
// A debt or task reminder more than `DEFAULT_HORIZON_MINUTES` (7 days) out would never
// get its OS notification scheduled until someone happened to reopen the app first.
//
// This registers the same `runNotificationScheduler` as a real OS-level background task
// via `expo-background-task`, so Android itself wakes the app briefly and runs it even
// while closed. `SchedulerBootstrap`'s foreground interval is untouched and remains the
// fast path (and the fallback on the OEMs/Android versions that refuse background task
// registration outright) — this only adds the path that still works when the app is not
// open at all.
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { openDatabaseAsync } from 'expo-sqlite';
import { SEPARATE_CONNECTION } from './db-connection';
import { runNotificationScheduler } from './scheduler-runner';

export const BACKGROUND_SCHEDULER_TASK = 'apon-background-scheduler';

// Must be called once at the JS entry point, before anything else runs — exactly the
// rule the widget's own headless handler already follows in index.js — so the task is
// defined even on a cold background launch with no screen ever mounted.
TaskManager.defineTask(BACKGROUND_SCHEDULER_TASK, async () => {
  // This headless run is a second, independent connection to the same file the
  // foreground app already has open — `openDatabaseAsync` only dedupes within one JS
  // context, and a background task gets its own. Left open, it sat on the file after
  // every 15-minute run, and enough of them piling up over a day of testing is exactly
  // what turned Inbox, Planning, and demo-data add/delete into permanent "database is
  // locked" failures for the foreground connection's own writes and reads — a leak, not
  // a schema or query bug, and one that would not show up until it had run a few times.
  let db: Awaited<ReturnType<typeof openDatabaseAsync>> | undefined;
  try {
    // Its own connection: sharing the app's and then letting this wrapper be collected
    // is what closed the app's connection mid-use (NF-06, see db-connection.ts).
    db = await openDatabaseAsync('offline-memory.db', SEPARATE_CONNECTION);
    await runNotificationScheduler(db);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    // `runNotificationScheduler` is already best-effort internally; this catch only
    // guards the database open itself. Either way, background scheduling must never
    // surface as a crash the OS logs against the app.
    return BackgroundTask.BackgroundTaskResult.Failed;
  } finally {
    await db?.closeAsync().catch(() => {});
  }
});

/**
 * Ask the OS to run the task periodically. Idempotent — registering an already-registered
 * task name is a no-op — so this is safe to call on every app launch rather than needing
 * its own "have I done this before" bookkeeping.
 */
export async function registerBackgroundScheduler(): Promise<void> {
  try {
    await BackgroundTask.registerTaskAsync(BACKGROUND_SCHEDULER_TASK, { minimumInterval: 15 });
  } catch {
    // Some OEMs and older Android builds refuse background task registration outright.
    // The foreground interval in SchedulerBootstrap is the fallback either way, so a
    // user on such a device is no worse off than before this existed.
  }
}
