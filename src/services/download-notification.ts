import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { hasNotificationPermission } from './notification.service';

// "Report downloaded — tap to open", the way Chrome announces a finished download (the
// user's request, RC.5). The PDF is already in Apon/Reports and in the app's own copy;
// this only tells the person it is there and takes them to it. Tapping opens the app's
// own viewer (app/file-view.tsx), where Share sends it anywhere.
//
// Its own quiet channel, so it never rings like a reminder and can be switched off on its
// own in Android's settings. Without notification permission it simply does not appear —
// the snackbar inside the app still says the file was saved.

export const DOWNLOAD_CHANNEL_ID = 'downloads';
const BRAND = '#0C3C85';

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(DOWNLOAD_CHANNEL_ID, {
      name: 'Downloads · ডাউনলোড',
      description: 'A quiet note when a report or file has been saved.',
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      enableVibrate: false,
      showBadge: false,
      sound: null,
    });
  } catch { /* best-effort */ }
}

/** Where a download notification leads: the viewer, with the file it names. */
export function downloadRoute(uri: string, name: string, mimeType = 'application/pdf') {
  return { route: '/file-view', params: { uri, name, mimeType } };
}

export async function notifyDownloaded(uri: string, name: string, language: 'bn' | 'en'): Promise<boolean> {
  try {
    if (!(await hasNotificationPermission())) return false;
    await ensureChannel();
    const bn = language === 'bn';
    // Same reason as the quick-capture tile: an immediate notification cannot carry a
    // channel on Android, a one-second DATE trigger can.
    await Notifications.scheduleNotificationAsync({
      content: {
        title: bn ? 'রিপোর্ট ডাউনলোড হয়েছে' : 'Report downloaded',
        body: bn ? `${name} — খুলতে চাপুন` : `${name} — tap to open`,
        data: downloadRoute(uri, name),
        color: BRAND,
        autoDismiss: true,
      },
      trigger: Platform.OS === 'android'
        ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + 1000), channelId: DOWNLOAD_CHANNEL_ID }
        : null,
    });
    return true;
  } catch {
    return false;
  }
}
