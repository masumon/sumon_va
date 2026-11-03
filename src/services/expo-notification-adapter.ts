import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import { hasNotificationBeenDelivered, markNotificationDelivered } from './notification-delivery-repository';
import { getTask } from './task-repository';
import { BRAND_GREEN, hasNotificationPermission, initializeNotifications, TASK_CHANNEL_ID } from './notification.service';
import type { NotificationCandidate } from './scheduler-notification-service';
import { bangladeshDateKey, zonedClock, zonedInstant } from '../i18n/date-time';
function notificationData(notification:Notifications.NotificationRequest):{taskId?:string;dueAt?:string;fireAt?:string}{const data=notification.content.data as {taskId?:unknown;dueAt?:unknown;fireAt?:unknown}|undefined;return{taskId:typeof data?.taskId==='string'?data.taskId:undefined,dueAt:typeof data?.dueAt==='string'?data.dueAt:undefined,fireAt:typeof data?.fireAt==='string'?data.fireAt:undefined};}

// Deterministic identifier so re-running the scheduler (mount + AppState "active" +
// 15-min tick can overlap) can only ever *replace* a task's reminder, never duplicate
// it. Expo/OS keys scheduled notifications by identifier.
function reminderIdentifier(taskId:string,dueAt:string):string{return `task-reminder:${taskId}:${dueAt}`;}

export interface QuietHours { start: number; end: number }

/** If a reminder would fire inside the user's quiet window, delay it to the window's
 * end. The notification keeps the task's real dueAt in its data for dedup/reconcile.
 * Hours are read in the app's zone (`appTimeZone`), the same clock the user set them on. */
export function applyQuietHours(due: Date, quiet?: QuietHours | null): Date {
  if (!quiet || quiet.start === quiet.end) return due;
  const h = Number(zonedClock(due).slice(0, 2));
  const inWindow = quiet.start < quiet.end ? h >= quiet.start && h < quiet.end : h >= quiet.start || h < quiet.end;
  if (!inWindow) return due;
  let dayKey = bangladeshDateKey(due);
  if (quiet.start >= quiet.end && h >= quiet.start) { // crossed midnight
    const [y = 1970, m = 1, d = 1] = dayKey.split('-').map(Number);
    dayKey = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }
  const shifted = new Date(zonedInstant(dayKey, `${String(quiet.end).padStart(2, '0')}:00`));
  return shifted.getTime() <= Date.now() ? due : shifted;
}
/** `taskId:dueAt` keys the OS still has scheduled — for the scheduler to detect and
 * re-add reminders that a battery optimiser / Doze silently dropped. */
export async function getLiveScheduledKeys():Promise<ReadonlySet<string>>{const scheduled=await Notifications.getAllScheduledNotificationsAsync();const keys=new Set<string>();for(const notification of scheduled){const{taskId,dueAt}=notificationData(notification);if(taskId&&dueAt)keys.add(`${taskId}:${dueAt}`);}return keys;}

export async function reconcileScheduledTaskNotifications(db:SQLiteDatabase,now=new Date()):Promise<number>{const scheduled=await Notifications.getAllScheduledNotificationsAsync();let cancelled=0;const seen=new Set<string>();for(const notification of scheduled){const{taskId,dueAt}=notificationData(notification);if(!taskId||!dueAt)continue;
 // Collapse duplicate OS reminders for the same task+time regardless of delivered-state
 // (older builds could double-schedule; this is the only pass that isn't delivery-gated).
 const key=`${taskId}|${dueAt}`;if(seen.has(key)){await Notifications.cancelScheduledNotificationAsync(notification.identifier);cancelled+=1;continue;}
 const task=await getTask(db,taskId);const validStatus=task?.status==='PLANNED'||task?.status==='RESCHEDULED';const dueDate=new Date(dueAt);const valid=Boolean(task&&validStatus&&task.dueAt===dueAt&&!Number.isNaN(dueDate.getTime())&&dueDate.getTime()>now.getTime());if(!valid){await Notifications.cancelScheduledNotificationAsync(notification.identifier);cancelled+=1;continue;}
 seen.add(key);}return cancelled;}

/**
 * "Apon · Reminder", in the language the app is being read in.
 *
 * It was hard-coded English, so a person using the app entirely in Bengali still got an
 * English word on the lock screen — the one place the app appears when it is not open,
 * and so the one place a stray English word is most jarring.
 *
 * Read from the same preference row the rest of the app uses, and falling back to Bengali
 * rather than English: this app's first language is Bengali, and a reminder is not worth
 * failing to schedule over a query that did not answer.
 */
async function reminderTitle(db: SQLiteDatabase): Promise<string> {
  try {
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM app_preferences WHERE key = 'language' LIMIT 1",
    );
    return row?.value === 'en' ? 'Apon · Reminder' : 'আপন · মনে করিয়ে দিচ্ছি';
  } catch {
    return 'আপন · মনে করিয়ে দিচ্ছি';
  }
}

/**
 * Snapshot the parts of `scheduleTaskNotification`'s work that do not vary per candidate,
 * so a batch of N reminders costs one round-trip through each of these instead of N.
 *
 * `getAllScheduledNotificationsAsync()` was the expensive one: it hands back the OS's
 * *entire* scheduled list, growing with every reminder already placed, and the loop in
 * `scheduler-runner.ts` was calling it fresh before every single candidate — an O(n²)
 * amount of native-bridge traffic that measured at 20–190 seconds on a real device for
 * around forty reminders after a reboot, during which none of them were actually live.
 */
export interface ScheduleContext {
  scheduled: Notifications.NotificationRequest[];
  permissionGranted: boolean;
}

export async function buildScheduleContext(): Promise<ScheduleContext> {
  await initializeNotifications();
  const [scheduled, granted] = await Promise.all([
    Notifications.getAllScheduledNotificationsAsync(),
    hasNotificationPermission(),
  ]);
  return { scheduled, permissionGranted: granted };
}

export async function scheduleTaskNotification(db:SQLiteDatabase,candidate:NotificationCandidate,quietHours?:QuietHours|null,leadMinutes=0,context?:ScheduleContext):Promise<string|null>{if(await hasNotificationBeenDelivered(db,candidate.taskId,candidate.dueAt))return null;const dueAtRaw=new Date(candidate.dueAt);if(Number.isNaN(dueAtRaw.getTime())||dueAtRaw.getTime()<=Date.now())return null;
 // Fire `leadMinutes` early when that still lands in the future; otherwise fall back to
 // the due time. The delivered-key and the notification's `dueAt` payload stay the
 // ORIGINAL so tap-routing and de-dup are unaffected.
 const leadMs=Math.max(0,leadMinutes)*60000;const early=new Date(dueAtRaw.getTime()-leadMs);const fireBase=leadMs>0&&early.getTime()>Date.now()?early:dueAtRaw;const dueAt=applyQuietHours(fireBase,quietHours);
 // A caller that already fetched the batch context (the scheduler loop) reuses it; any
 // other caller — including every existing test — gets exactly the old one-off behaviour.
 const scheduled=context?context.scheduled:await Notifications.getAllScheduledNotificationsAsync();
 // Collapse any duplicates for this exact task+time (overlapping scheduler passes could
 // previously each create their own OS reminder). Keep the first, cancel the rest.
 const matches=scheduled.filter(item=>{const data=notificationData(item);return data.taskId===candidate.taskId&&data.dueAt===candidate.dueAt;});
 // A queued reminder set for another moment (the "remind me earlier" setting or quiet
 // hours changed since) is replaced, not kept — RC.4 QA: the setting was ignored.
 const fireAt=dueAt.toISOString();const queued=matches[0]?notificationData(matches[0]):null;if(queued&&(queued.fireAt??queued.dueAt)===fireAt){for(const extra of matches.slice(1)){try{await Notifications.cancelScheduledNotificationAsync(extra.identifier);}catch{}}return matches[0]!.identifier;}for(const stale of matches){try{await Notifications.cancelScheduledNotificationAsync(stale.identifier);}catch{}}
 if(context){if(!context.permissionGranted)return null;}else{await initializeNotifications();if(!(await hasNotificationPermission()))return null;}
 // Scheduling is not delivering. This used to write the delivered-key the moment the OS
 // accepted the reminder, which made the two words mean the same thing — and they do not.
 // Doze and the battery managers on the phones this app is built for drop scheduled
 // notifications silently; `getLiveScheduledKeys` exists precisely to notice that. But a
 // reminder already marked delivered is refused at the top of this function, so the one
 // path that could have put it back was closed by the bookkeeping. The reminder was gone
 // and the app believed it had rung.
 //
 // The key is written when the notification is actually received (see `_layout.tsx`), so a
 // dropped reminder stays un-delivered and the next reconcile can schedule it again.
 // Re-scheduling is safe: the identifier is deterministic and a past-due candidate is
 // rejected above, so nothing can fire twice or fire late.
 return Notifications.scheduleNotificationAsync({identifier:reminderIdentifier(candidate.taskId,candidate.dueAt),content:{title:await reminderTitle(db),body:candidate.title,data:{taskId:candidate.taskId,dueAt:candidate.dueAt,fireAt},color:BRAND_GREEN,priority:Notifications.AndroidNotificationPriority.HIGH},trigger:{type:Notifications.SchedulableTriggerInputTypes.DATE,date:dueAt,...(Platform?.OS==='android'?{channelId:TASK_CHANNEL_ID}:{})}});}

/**
 * Record that a reminder actually reached the user.
 *
 * Called from the notification-received listener at the app root. Best-effort on purpose:
 * failing to write the key means the reminder may be scheduled again later, which is a far
 * better failure than never reminding anyone at all.
 */
export async function recordNotificationDelivery(db:SQLiteDatabase,notification:Notifications.Notification):Promise<void>{const{taskId,dueAt}=notificationData(notification.request);if(!taskId||!dueAt)return;try{await markNotificationDelivered(db,taskId,dueAt)}catch{/* the reminder was seen; the bookkeeping can wait */}}

/**
 * B-12: a reminder already sitting in the notification shade outlives its task — deleting
 * or finishing the task cancelled the *scheduled* one but left the delivered one showing.
 */
export async function dismissTaskNotifications(taskId: string): Promise<void> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    for (const n of shown) {
      const data = n.request.content.data as { taskId?: unknown } | undefined;
      if (data?.taskId === taskId) await Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {});
    }
  } catch { /* nothing shown, or no permission — nothing to clear */ }
}
