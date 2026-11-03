import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { hasNotificationPermission } from './notification.service';

// A persistent, silent notification that acts as an always-there "add" button — tapping
// it deep-links straight into the task editor. Opt-in (Settings), Android-only in practice
// (iOS has no ongoing-notification concept, so there it is a normal dismissible one).

export const QUICK_CAPTURE_CHANNEL_ID = 'quick-capture';
const QUICK_CAPTURE_ID = 'quick-capture-tile';
// The navy the logo is drawn on. This surface appears outside the app, beside the
// launcher icon, so it is one of the few places the brand colour is seen next to itself.
const BRAND = '#0C3C85';

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(QUICK_CAPTURE_CHANNEL_ID, {
      name: 'Quick capture · দ্রুত যোগ',
      description: 'A quiet, always-there shortcut to add a task or memory.',
      importance: Notifications.AndroidImportance.LOW,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableVibrate: false,
      showBadge: false,
      sound: null,
    });
  } catch { /* best-effort */ }
}

export async function showQuickCaptureTile(language: 'bn' | 'en'): Promise<boolean> {
  try {
    // Android 13+ needs an explicit grant; without it scheduleNotificationAsync no-ops
    // silently and the tile just never appears. Ask here so the toggle actually works.
    if (!(await hasNotificationPermission())) return false;
    await ensureChannel();
    const bn = language === 'bn';
    // An immediate (`trigger: null`) Android notification can't carry a channel, so it
    // lands on the noisy fallback channel. Fire it a second out through a DATE trigger
    // instead — that trigger *does* take `channelId`, so it uses our silent LOW channel.
    await Notifications.scheduleNotificationAsync({
      identifier: QUICK_CAPTURE_ID,
      content: {
        title: bn ? 'দ্রুত যোগ করুন' : 'Quick capture',
        body: bn ? 'একটা কাজ বা মেমোরি টুকে রাখুন' : 'Jot down a task or memory',
        data: { route: '/task-editor' },
        color: BRAND,
        sticky: true,
        autoDismiss: false,
      },
      trigger: Platform.OS === 'android'
        ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + 1000), channelId: QUICK_CAPTURE_CHANNEL_ID }
        : null,
    });
    return true;
  } catch {
    return false;
  }
}

export async function hideQuickCaptureTile(): Promise<void> {
  try { await Notifications.dismissNotificationAsync(QUICK_CAPTURE_ID); } catch { /* ignore */ }
  try { await Notifications.cancelScheduledNotificationAsync(QUICK_CAPTURE_ID); } catch { /* ignore */ }
}

// Reconcile the tile with the saved preference (on launch and whenever the toggle
// flips). Returns false when it was asked to show but couldn't — e.g. permission denied.
export async function syncQuickCaptureTile(enabled: boolean, language: 'bn' | 'en'): Promise<boolean> {
  if (!enabled) { await hideQuickCaptureTile(); return true; }
  return showQuickCaptureTile(language);
}
