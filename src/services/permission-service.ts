// Permissions the app may need — asked for, never taken.
//
// Two rules run through this file.
//
// The first is that nothing is requested until the user has been told what it is for and
// has tapped to allow it. Android will happily show a bare system dialog on launch, and a
// person who is shown one before they know what the app does simply denies it — after
// which the feature is off and the dialog never comes back. So background code may *check*
// a permission but must never *prompt*; prompting belongs to a screen where the reason is
// on the same page as the button.
//
// The second is that a denied permission is not a failure. Each entry says what stops
// working without it, so the app can carry on with less rather than nagging.
//
// Beyond the permissions Android models properly, two settings decide whether reminders
// arrive at all on the phones people here actually use — battery optimisation and
// auto-start. Neither can be granted by an API; both can only be opened, so the app
// explains and takes the user to the right screen.

import { Linking, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Device from 'expo-device';
import { OEM_SCREENS, oemFamily, oemSteps, type OemFamily } from './oem-background';
import * as Contacts from 'expo-contacts';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { downloadVoicePack, voiceOfflineStatus } from './voice-offline-service';
import type { AppLanguage } from '../i18n/date-time';
import { batteryExempt } from '../../modules/device-state';

/** The phone's own answer (modules/device-state); UNKNOWN only on a build without it. */
function batteryState(): PermissionState {
  const exempt = batteryExempt();
  return exempt === null ? 'UNKNOWN' : exempt ? 'GRANTED' : 'DENIED';
}

export type PermissionState = 'GRANTED' | 'DENIED' | 'BLOCKED' | 'UNKNOWN' | 'NOT_NEEDED';

export type PermissionId =
  | 'notifications'
  | 'exactAlarm'
  | 'batteryOptimisation'
  | 'autoStart'
  | 'microphone'
  | 'contacts'
  | 'camera'
  | 'location'
  | 'voicePack';

export interface AppPermission {
  id: PermissionId;
  icon:
    | 'bell-outline'
    | 'alarm'
    | 'battery-charging-outline'
    | 'restart'
    | 'microphone-outline'
    | 'card-account-details-outline'
    | 'camera-outline'
    | 'map-marker-outline'
    | 'phone-outline'
    | 'download-outline';
  title: (language: AppLanguage) => string;
  /** Why the app wants it, in the user's words — shown before any system dialog. */
  why: (language: AppLanguage) => string;
  /** What stops working without it. A denied permission must not read as an error. */
  without: (language: AppLanguage) => string;
  /** Which module or feature needs it, so the list can be filtered later. */
  neededBy: string[];
  check: () => Promise<PermissionState>;
  /**
   * Ask. Only ever called from a screen where `why` is visible.
   * Some entries cannot be granted by an API and open a settings page instead —
   * `opensSettings` says so, and the button label changes accordingly.
   */
  request: () => Promise<PermissionState>;
  opensSettings?: boolean;
  /**
   * What to tell the user straight after `request`, when "allowed" or "blocked" is not the
   * whole truth. Downloading a language pack is the case this exists for: Android may fetch
   * it then and there, open its own dialog, or queue it for wifi, and the honest message
   * differs each time. Returning `null` leaves the screen's generic wording in place.
   */
  note?: (state: PermissionState, language: AppLanguage) => string | null;
  /**
   * Override the screen's generic status word ("Not needed on this phone", etc.) for one
   * state. Exists because `PermissionState` is shared across every entry here and its
   * generic wording can be true but misleading for a specific one — `NOT_NEEDED` reads as
   * "nothing is lost" everywhere else it appears, but for the voice pack it can mean "this
   * phone's voice service does not offer this language at all", which is a real limit, not
   * a non-issue. Returning `null` (or leaving this out) keeps the generic label.
   */
  statusOverride?: (state: PermissionState, language: AppLanguage) => string | null;
}

const bnEn = (bn: string, en: string) => (language: AppLanguage) => (language === 'bn' ? bn : en);

// ── notifications ─────────────────────────────────────────────────────────────

/** Check without prompting. Safe to call from background code. */
export async function checkNotificationPermission(): Promise<PermissionState> {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return 'GRANTED';
    return p.canAskAgain ? 'DENIED' : 'BLOCKED';
  } catch {
    return 'UNKNOWN';
  }
}

/**
 * Ask for notification permission. Only from a screen that has explained why.
 *
 * Background schedulers call {@link checkNotificationPermission} instead: a reminder that
 * silently pops a permission dialog while the user is reading something else is exactly
 * the behaviour this file exists to prevent.
 */
export async function requestNotificationPermissionWithConsent(): Promise<PermissionState> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return 'GRANTED';
    if (!current.canAskAgain) return 'BLOCKED';
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted ? 'GRANTED' : (asked.canAskAgain ? 'DENIED' : 'BLOCKED');
  } catch {
    return 'UNKNOWN';
  }
}

// ── exact alarms ──────────────────────────────────────────────────────────────
//
// From Android 12 a reminder may be delayed by minutes unless the app can schedule an
// exact alarm, and from Android 13 that is a user-granted setting rather than a manifest
// line. There is no runtime dialog for it; the app can only open the page.

async function checkExactAlarm(): Promise<PermissionState> {
  if (Platform.OS !== 'android') return 'NOT_NEEDED';
  // Below Android 12 exact alarms are always allowed.
  if (typeof Platform.Version === 'number' && Platform.Version < 31) return 'GRANTED';
  try {
    // expo-notifications reports this through the same permission response on Android.
    const p = await Notifications.getPermissionsAsync();
    const android = (p as { android?: { allowsAlarm?: boolean } }).android;
    if (android?.allowsAlarm === undefined) return 'UNKNOWN';
    return android.allowsAlarm ? 'GRANTED' : 'DENIED';
  } catch {
    return 'UNKNOWN';
  }
}

async function openExactAlarmSettings(): Promise<PermissionState> {
  if (Platform.OS !== 'android') return 'NOT_NEEDED';
  try {
    await IntentLauncher.startActivityAsync('android.settings.REQUEST_SCHEDULE_EXACT_ALARM', {
      data: 'package:com.masumon.sumonva',
    });
  } catch {
    await Linking.openSettings().catch(() => {});
  }
  return checkExactAlarm();
}

// ── battery optimisation ──────────────────────────────────────────────────────
//
// The single most common reason a reminder never arrives on a phone sold here. Android
// gives no way to read the state without a native module, so the entry is honest about
// not knowing and simply offers to open the page.

async function openBatterySettings(): Promise<PermissionState> {
  if (Platform.OS !== 'android') return 'NOT_NEEDED';
  // One "Allow" dialog for this app first (RC.1 QA) — the full list below asks a
  // non-technical person to find Apon among every app on the phone.
  try {
    await IntentLauncher.startActivityAsync('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', { data: 'package:com.masumon.sumonva' });
    return 'UNKNOWN';
  } catch { /* not offered on this phone — fall back to the list */ }
  try {
    await IntentLauncher.startActivityAsync('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
  } catch {
    await Linking.openSettings().catch(() => {});
  }
  return 'UNKNOWN';
}

// ── auto-start ────────────────────────────────────────────────────────────────
//
// Not an Android permission at all — a manufacturer setting, in a different place on
// every brand. Vivo, Xiaomi, Oppo and Realme all stop a "background" app from running
// after a reboot unless auto-start is on, which silently kills every scheduled reminder.
// The app cannot read it or grant it; it can only take the user to the right screen and
// explain what to turn on.

// This maker's own screens first, then every other maker's (a rebadged phone can carry
// another maker's settings app) — see oem-background.ts for the list and its sources.
function autostartScreens(): { pkg: string; cls: string }[] {
  const mine = oemFamily(Device.manufacturer, Device.brand);
  const rest = (Object.keys(OEM_SCREENS) as OemFamily[]).filter((f) => f !== mine).flatMap((f) => OEM_SCREENS[f]);
  return [...OEM_SCREENS[mine], ...rest];
}

async function openAutoStartSettings(): Promise<PermissionState> {
  if (Platform.OS !== 'android') return 'NOT_NEEDED';
  for (const { pkg, cls } of autostartScreens()) {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
        className: cls,
        packageName: pkg,
      });
      return 'UNKNOWN';
    } catch {
      // This brand's screen is not on this phone — try the next.
    }
  }
  // No manufacturer screen matched, so fall back to the app's own settings page.
  await Linking.openSettings().catch(() => {});
  return 'UNKNOWN';
}


// ── contacts ─────────────────────────────────────────────────────────────────
//
// Read one contact at a time, at the moment the user taps "pick from contacts". The
// permission is what lets the picker hand back the email and address as well as the name
// and number; without it the picker still opens, it just returns less.

async function checkContacts(): Promise<PermissionState> {
  try {
    const p = await Contacts.getPermissionsAsync();
    if (p.granted) return 'GRANTED';
    return p.canAskAgain ? 'DENIED' : 'BLOCKED';
  } catch {
    return 'UNKNOWN';
  }
}

async function requestContacts(): Promise<PermissionState> {
  try {
    const current = await Contacts.getPermissionsAsync();
    if (current.granted) return 'GRANTED';
    if (!current.canAskAgain) return 'BLOCKED';
    const next = await Contacts.requestPermissionsAsync();
    return next.granted ? 'GRANTED' : next.canAskAgain ? 'DENIED' : 'BLOCKED';
  } catch {
    return 'UNKNOWN';
  }
}

// ── camera ───────────────────────────────────────────────────────────────────

async function checkCamera(): Promise<PermissionState> {
  try {
    const p = await ImagePicker.getCameraPermissionsAsync();
    if (p.granted) return 'GRANTED';
    return p.canAskAgain ? 'DENIED' : 'BLOCKED';
  } catch {
    return 'UNKNOWN';
  }
}

async function requestCamera(): Promise<PermissionState> {
  try {
    const current = await ImagePicker.getCameraPermissionsAsync();
    if (current.granted) return 'GRANTED';
    if (!current.canAskAgain) return 'BLOCKED';
    const next = await ImagePicker.requestCameraPermissionsAsync();
    return next.granted ? 'GRANTED' : next.canAskAgain ? 'DENIED' : 'BLOCKED';
  } catch {
    return 'UNKNOWN';
  }
}

// ── location ─────────────────────────────────────────────────────────────
//
// Foreground only, and only while something is being saved. There is no background
// location, no tracking, and no history beyond the places the user chose to attach.

async function checkLocation(): Promise<PermissionState> {
  try {
    const p = await Location.getForegroundPermissionsAsync();
    if (p.granted) return 'GRANTED';
    return p.canAskAgain ? 'DENIED' : 'BLOCKED';
  } catch {
    return 'UNKNOWN';
  }
}

async function requestLocation(): Promise<PermissionState> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return 'GRANTED';
    if (!current.canAskAgain) return 'BLOCKED';
    const next = await Location.requestForegroundPermissionsAsync();
    return next.granted ? 'GRANTED' : next.canAskAgain ? 'DENIED' : 'BLOCKED';
  } catch {
    return 'UNKNOWN';
  }
}

// ── microphone ────────────────────────────────────────────────────────────────

async function checkMicrophone(): Promise<PermissionState> {
  try {
    const mod = await import('expo-speech-recognition');
    const p = await mod.ExpoSpeechRecognitionModule.getPermissionsAsync();
    if (p.granted) return 'GRANTED';
    return p.canAskAgain ? 'DENIED' : 'BLOCKED';
  } catch {
    return 'UNKNOWN';
  }
}

async function requestMicrophone(): Promise<PermissionState> {
  try {
    const mod = await import('expo-speech-recognition');
    const p = await mod.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (p.granted) return 'GRANTED';
    return p.canAskAgain ? 'DENIED' : 'BLOCKED';
  } catch {
    return 'UNKNOWN';
  }
}

// ── the offline voice pack ────────────────────────────────────────────────────
//
// Not a permission at all, and the reason it belongs on this screen anyway is the same
// reason battery saving does: it is a one-time thing the user has to agree to before a
// feature genuinely works, and nothing in the app can do it on their behalf.
//
// Android cannot turn speech into text without a connection until the language pack is on
// the phone. Microphone permission does not get you there; neither does anything in this
// app. So it is listed with everything else the app asks for, granted by a tap, and — once
// the pack is down — never asked for again.

async function checkVoicePack(): Promise<PermissionState> {
  try {
    const status = await voiceOfflineStatus('bn');
    switch (status.state) {
      case 'INSTALLED': return 'GRANTED';
      case 'MISSING': return 'DENIED';
      // A phone with no on-device recogniser cannot have a pack; saying "not allowed yet"
      // would be an invitation to tap a button that can never succeed.
      case 'UNSUPPORTED': return 'NOT_NEEDED';
      default: return 'UNKNOWN';
    }
  } catch {
    return 'UNKNOWN';
  }
}

async function requestVoicePack(): Promise<PermissionState> {
  try {
    const asked = await downloadVoicePack('bn');
    if (!asked.ok) return 'UNKNOWN';
    // Android answers three ways and only one of them means the pack has arrived, so the
    // state is read back from the phone rather than inferred from the answer.
    return checkVoicePack();
  } catch {
    return 'UNKNOWN';
  }
}

// ── the list ──────────────────────────────────────────────────────────────────

// This phone's own maker and steps (oem-background.ts), not a generic brand list.
function autoStartWhy(language: AppLanguage): string {
  const bn = language === 'bn';
  const brand = (Device.manufacturer || Device.brand || '').toString();
  const lead = bn
    ? `${brand ? brand + ' ' : ''}ফোনে ব্যাকগ্রাউন্ডে চলার অনুমতি না থাকলে রিমাইন্ডার বাদ পড়তে পারে। যা করবেন:`
    : `On ${brand || 'this'} phone, reminders can be dropped unless Apon may run in the background. What to do:`;
  return [lead, ...oemSteps(oemFamily(Device.manufacturer, Device.brand), bn).map((step) => `• ${step}`)].join('\n');
}

export const APP_PERMISSIONS: AppPermission[] = [
  {
    id: 'notifications',
    icon: 'bell-outline',
    neededBy: ['reminders', 'debt'],
    title: bnEn('রিমাইন্ডার দেখানো', 'Showing reminders'),
    why: bnEn(
      'কিস্তির তারিখ, কাজের সময় আর ওষুধের সময় মনে করিয়ে দিতে অ্যাপকে নোটিফিকেশন দেখানোর অনুমতি দিতে হবে।',
      'To remind you about instalment dates, task times and anything else you set, the app needs to show notifications.',
    ),
    without: bnEn(
      'অনুমতি না দিলে অ্যাপের বাকি সব কাজ করবে, শুধু কোনো রিমাইন্ডার আসবে না।',
      'Without it everything else still works; you simply get no reminders.',
    ),
    check: checkNotificationPermission,
    request: requestNotificationPermissionWithConsent,
  },
  {
    id: 'exactAlarm',
    icon: 'alarm',
    neededBy: ['reminders'],
    title: bnEn('ঠিক সময়ে বাজা', 'Reminders at the exact time'),
    why: bnEn(
      'অ্যান্ড্রয়েড ১২ থেকে এই অনুমতি ছাড়া রিমাইন্ডার কয়েক মিনিট থেকে কয়েক ঘণ্টা দেরিতে বাজতে পারে।',
      'From Android 12, without this a reminder can arrive minutes or hours late.',
    ),
    without: bnEn(
      'রিমাইন্ডার আসবে, তবে ঠিক সময়ে নাও আসতে পারে।',
      'Reminders still arrive, just not necessarily on time.',
    ),
    check: checkExactAlarm,
    request: openExactAlarmSettings,
    opensSettings: true,
  },
  {
    id: 'batteryOptimisation',
    icon: 'battery-charging-outline',
    neededBy: ['reminders'],
    title: bnEn('ব্যাটারি সাশ্রয় থেকে ছাড়', 'Exempt from battery saving'),
    why: bnEn(
      'ফোনের ব্যাটারি সাশ্রয় ব্যবস্থা অ্যাপটিকে ঘুম পাড়িয়ে দিলে রিমাইন্ডার বাজে না। এখান থেকে ছাড় দিলে সমস্যাটি হয় না।',
      'Battery saving can put the app to sleep, and a sleeping app cannot ring a reminder. Exempting it prevents that.',
    ),
    without: bnEn(
      'রিমাইন্ডার দেরিতে আসতে পারে বা একেবারেই না আসতে পারে — বিশেষ করে ফোন কিছুক্ষণ ব্যবহার না করলে।',
      'Reminders may arrive late or not at all, especially after the phone has been idle.',
    ),
    check: async () => batteryState(),
    request: openBatterySettings,
    opensSettings: true,
  },
  {
    id: 'autoStart',
    icon: 'restart',
    neededBy: ['reminders'],
    title: bnEn('ফোন চালু হলে নিজে চালু হওয়া', 'Start after the phone restarts'),
    why: autoStartWhy,
    without: bnEn(
      'ফোন বন্ধ করে চালু করলে আগের রিমাইন্ডারগুলো আর বাজবে না।',
      'Reminders set before a restart will not ring afterwards.',
    ),
    check: async () => 'UNKNOWN',
    request: openAutoStartSettings,
    opensSettings: true,
  },
  {
    id: 'contacts',
    icon: 'card-account-details-outline',
    neededBy: ['people', 'debt'],
    title: bnEn('ফোনের কন্টাক্ট', 'Your contacts'),
    why: bnEn(
      'কারো নাম লেখার সময় কন্টাক্ট থেকে বেছে নিলে নাম, ফোন নাম্বার, ইমেইল ও ঠিকানা নিজে থেকেই বসে যাবে। শুধু যাকে বেছে নেবেন তাকেই পড়া হয়, পুরো তালিকা নয়।',
      'When you add a person you can pick them from your contacts and the name, number, email and address fill themselves in. Only the one you pick is read, never the whole address book.',
    ),
    without: bnEn(
      'সব তথ্য হাতে লিখে দিতে পারবেন, কিছুই বন্ধ হয় না।',
      'You can still type everything by hand; nothing is blocked.',
    ),
    check: checkContacts,
    request: requestContacts,
  },
  {
    id: 'camera',
    icon: 'camera-outline',
    neededBy: ['attachments', 'debt', 'finance', 'memory'],
    title: bnEn('ক্যামেরা', 'Camera'),
    why: bnEn(
      'রশিদ, কাগজ বা যেকোনো প্রমাণ সাথে সাথে ছবি তুলে হিসাবের সাথে জুড়ে রাখা যায়। ছবি ফোনেই থাকে।',
      'Photograph a receipt or any piece of paper and save it straight onto the record. The photo stays on the phone.',
    ),
    without: bnEn(
      'গ্যালারি থেকে ছবি বেছে দিতে পারবেন, শুধু অ্যাপ থেকে ছবি তোলা যাবে না।',
      'You can still attach a photo from the gallery; only taking one inside the app stops.',
    ),
    check: checkCamera,
    request: requestCamera,
  },
  {
    id: 'location',
    icon: 'map-marker-outline',
    neededBy: ['memory', 'finance'],
    title: bnEn('জায়গা', 'Place'),
    why: bnEn(
      'কোথায় ছিলেন সেটা মেমোরি বা হিসাবের সাথে জুড়ে রাখা যায় — কোথায় বেড়াতে গেলেন, কোন জায়গায় ঘটনাটি হল। শুধু আপনি চাপ দিলে সেই মুহূর্তেই নেওয়া হয়, পিছনে কখনো নয়।',
      'Attach where you were to a memory or a record — where you travelled, where something happened. Taken only at the moment you tap, never in the background.',
    ),
    without: bnEn(
      'জায়গার নাম হাতে লিখে দিতে পারবেন।',
      'You can still type a place name yourself.',
    ),
    check: checkLocation,
    request: requestLocation,
  },
  {
    id: 'microphone',
    icon: 'microphone-outline',
    neededBy: ['capture'],
    title: bnEn('বলে লেখা', 'Speaking instead of typing'),
    why: bnEn(
      'মাইক্রোফোনের অনুমতি দিলে টাইপ না করে বলে কাজ বা নোট যোগ করা যাবে। এই ফোনের ভয়েস সেবা বাংলা অফলাইনে সমর্থন করলে নিচের “ভয়েস ভাষার প্যাকেট”-এ তা দেখাবে।',
      'With microphone access you can speak a task or a note instead of typing. If this phone’s voice service supports Bengali offline, the “Offline voice language pack” row below will say so.',
    ),
    without: bnEn(
      'টাইপ করে সব কিছুই করা যাবে, শুধু বলে লেখা যাবে না।',
      'Everything can still be typed; only speaking is unavailable.',
    ),
    check: checkMicrophone,
    request: requestMicrophone,
  },
  {
    id: 'voicePack',
    icon: 'download-outline',
    neededBy: ['capture'],
    title: bnEn('ভয়েস ভাষার প্যাকেট', 'Offline voice language pack'),
    // Not every phone's voice service actually offers Bengali as an offline model — that
    // is a fact about the phone, not this app, and it can only be known by asking Android
    // (below). So this stays a conditional promise ("if it can be fetched..."), not a
    // guarantee: on a phone where it genuinely cannot, the status line under the title
    // says so plainly instead, and this text is not left contradicting it.
    why: bnEn(
      'এই ফোনের ভয়েস সেবা বাংলা অফলাইনে সমর্থন করলে, প্যাকেটটি একবার নামিয়ে নিলে এরপর থেকে ইন্টারনেট একেবারে বন্ধ রেখেও বলে লেখা যাবে। নামানোর সময় শুধু একবার ইন্টারনেট লাগবে, আর সেটিও ফোনের নিজের ভয়েস সেবার সাথে — অ্যাপের কোথাও কিছু যায় না।',
      'If this phone’s voice service offers Bengali offline, fetching it once means speaking works from then on with the connection completely off. The download itself needs internet that one time, and even then it is between the phone and its own voice service — nothing of yours is sent anywhere.',
    ),
    without: bnEn(
      'ইন্টারনেট চালু থাকলে বলে লেখা কাজ করবে; শুধু ইন্টারনেট ছাড়া অবস্থায় কাজ নাও করতে পারে — কিছু ফোনের ভয়েস সেবা বাংলা অফলাইনে সমর্থনই করে না। টাইপ করে সব কিছুই হবে।',
      'Speaking still works while you have a connection; offline speaking may not — some phones’ voice service does not offer Bengali offline at all. Everything can still be typed.',
    ),
    check: checkVoicePack,
    request: requestVoicePack,
    note: (state, language) => {
      const bn = language === 'bn';
      if (state === 'GRANTED') {
        return bn
          ? 'প্যাকেট নেমে গেছে — এখন ইন্টারনেট ছাড়াই বলে লেখা যাবে'
          : 'Pack downloaded — speaking now works with no connection';
      }
      if (state === 'DENIED') {
        return bn
          ? 'ডাউনলোড শুরু হয়েছে। শেষ হলে এখানে “আছে” দেখাবে।'
          : 'The download has started. This will say “allowed” once it finishes.';
      }
      return bn
        ? 'নামানো গেল না। ইন্টারনেট চালু আছে কিনা দেখে আবার চাপ দিন।'
        : 'Could not fetch it. Check the connection and tap again.';
    },
    statusOverride: (state, language) => {
      if (state !== 'NOT_NEEDED') return null;
      return language === 'bn'
        ? 'এই ফোনে বাংলা অফলাইন ভয়েস নেই'
        : 'This phone has no offline Bengali voice';
    },
  },
];

export function getPermission(id: PermissionId): AppPermission | undefined {
  return APP_PERMISSIONS.find((p) => p.id === id);
}

/** Every permission with its current state, for the permissions screen. */
export async function readPermissionStates(): Promise<{ permission: AppPermission; state: PermissionState }[]> {
  const out: { permission: AppPermission; state: PermissionState }[] = [];
  for (const permission of APP_PERMISSIONS) {
    let state: PermissionState = 'UNKNOWN';
    try { state = await permission.check(); } catch { state = 'UNKNOWN'; }
    out.push({ permission, state });
  }
  return out;
}

/** Open the app's own page in Android settings — the only way back from BLOCKED. */
export async function openAppSettings(): Promise<void> {
  await Linking.openSettings().catch(() => {});
}
