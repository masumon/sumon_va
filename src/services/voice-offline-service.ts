// Making the microphone work with the aeroplane switch on.
//
// The app already asks Android for on-device recognition and never sends audio anywhere.
// That was not enough, and the reason is worth stating plainly: **Android cannot turn
// speech into text offline until the language pack for that language is on the phone.**
// Ask for on-device recognition without the pack and the request simply fails, the app
// quietly falls back to the online recogniser, and with the data off that fails too. To
// the person holding the phone it just looks like voice is broken.
//
// So this file does the one thing that actually fixes it: it finds out whether the pack
// is there, and if it is not, it asks Android to fetch it. That fetch needs the internet
// once. After that the microphone works forever with no connection at all — which is what
// "offline" has to mean if the word is going to be used.

import { Linking, Platform } from 'react-native';

export type VoicePackState =
  /** The pack is installed. Speech works with no connection. */
  | 'INSTALLED'
  /** The recogniser exists and can work offline, but this language is not downloaded yet. */
  | 'MISSING'
  /** Android is too old to install packs (below 13), or has no on-device recogniser. */
  | 'UNSUPPORTED'
  /** Something went wrong asking — treated as "cannot promise offline". */
  | 'UNKNOWN';

export interface VoiceOfflineStatus {
  state: VoicePackState;
  locale: string;
  /** Every language this phone can already do offline. */
  installedLocales: string[];
  /** True when a download would be worth offering. */
  canDownload: boolean;
}

/** Google's on-device recogniser — the only Android service that ships offline packs. */
/**
 * Google's on-device speech service — the one that actually holds the downloaded packs.
 *
 * Exported because asking a *different* recogniser for offline recognition is asking a
 * service that has no pack: the download and the request have to name the same one.
 */
export const ON_DEVICE_PACKAGE = 'com.google.android.as';

export const localeFor = (language: 'bn' | 'en'): string => (language === 'bn' ? 'bn-BD' : 'en-US');

/** Two locale tags naming the same language, e.g. "bn-BD" and "bn_BD" and "bn". */
function sameLanguage(a: string, b: string): boolean {
  const base = (v: string) => v.toLowerCase().replace('_', '-').split('-')[0];
  const full = (v: string) => v.toLowerCase().replace('_', '-');
  return full(a) === full(b) || base(a) === base(b);
}

/**
 * Can this phone turn speech into text with no connection, in this language?
 *
 * Never throws. Every failure lands on `UNKNOWN`, because a diagnostics row that crashes
 * the screen it is reporting on is worse than one that says "not sure".
 */
export async function voiceOfflineStatus(language: 'bn' | 'en'): Promise<VoiceOfflineStatus> {
  const locale = localeFor(language);
  const empty: VoiceOfflineStatus = { state: 'UNKNOWN', locale, installedLocales: [], canDownload: false };
  if (Platform.OS !== 'android') return { ...empty, state: 'UNSUPPORTED' };

  try {
    const { ExpoSpeechRecognitionModule } = await import('expo-speech-recognition');
    if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
      console.log('[voiceOfflineStatus] supportsOnDeviceRecognition() is false — this phone reports no on-device speech capability at all.');
      return { ...empty, state: 'UNSUPPORTED' };
    }
    // Android 12 and below return nothing here — not an error, just no answer.
    const result = await ExpoSpeechRecognitionModule.getSupportedLocales({
      androidRecognitionServicePackage: ON_DEVICE_PACKAGE,
    });
    const installed = result.installedLocales ?? [];
    const supported = result.locales ?? [];
    // Left in deliberately, not stripped after debugging: this is the one line that ever
    // shows what Android itself actually offers for this phone — the difference between
    // "no button because it's already installed", "no button because Android never offers
    // this language here", and "button should be there and isn't" is entirely in these two
    // arrays, and screenshots of this screen are unavailable to whoever needs to read it
    // (block-screenshots is a privacy setting this app itself offers and respects).
    console.log(`[voiceOfflineStatus] wanted=${locale} installed=[${installed.join(',')}] supported=[${supported.join(',')}]`);
    const installedMatch = installed.find((l) => sameLanguage(l, locale));
    if (installedMatch) {
      return { state: 'INSTALLED', locale: installedMatch, installedLocales: installed, canDownload: false };
    }
    // Use the tag the device itself named. Asking for bn-BD on a phone that lists bn-IN
    // is a request Android answers by doing nothing.
    const supportedMatch = supported.find((l) => sameLanguage(l, locale));
    if (!supportedMatch) {
      return { ...empty, state: 'UNSUPPORTED', installedLocales: installed };
    }
    return { state: 'MISSING', locale: supportedMatch, installedLocales: installed, canDownload: true };
  } catch (error) {
    console.log('[voiceOfflineStatus] getSupportedLocales threw:', error);
    return empty;
  }
}

export type VoiceDownloadResult =
  | { ok: true; status: 'download_success' | 'opened_dialog' | 'download_scheduled' }
  | { ok: false; reason: 'unsupported' | 'failed' };

/**
 * Ask Android to fetch the offline pack for this language.
 *
 * Needs a connection this once. On Android 13 it opens the system's own download dialog
 * and tells us nothing more; on 14 and above it either downloads there and then or queues
 * the download for wifi. All three are honest outcomes, so all three are reported as
 * they are rather than flattened into a single "done".
 */
export async function downloadVoicePack(language: 'bn' | 'en', localeOverride?: string): Promise<VoiceDownloadResult> {
  if (Platform.OS !== 'android') return { ok: false, reason: 'unsupported' };
  try {
    const { ExpoSpeechRecognitionModule } = await import('expo-speech-recognition');
    // Prefer the tag the device said it supports; fall back to our own guess.
    const resolved = localeOverride ?? (await voiceOfflineStatus(language).catch(() => null))?.locale ?? localeFor(language);
    const result = await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({
      locale: resolved,
    });
    return { ok: true, status: result.status };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/**
 * When `downloadVoicePack()` fails outright (no dialog, no queue, nothing), the person
 * is stuck unless there is a manual way in. Google's on-device speech service has its
 * own offline-language screen, but it is an internal activity with no public Intent
 * action — undocumented, and not guaranteed to exist on every OEM's build of the app.
 * So it is tried first and never trusted alone: same pattern as this file's
 * manufacturer auto-start intents, a list of specific screens tried in order, each
 * failure falling through to the next, ending on a screen guaranteed to exist.
 */
export async function openVoiceSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const IntentLauncher = await import('expo-intent-launcher');
  try {
    await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
      packageName: 'com.google.android.googlequicksearchbox',
      className: 'com.google.android.voicesearch.network.activity.OfflineLanguageSettingsActivity',
    });
    return;
  } catch { /* this build of the Google app does not have that screen — try the generic one */ }
  try {
    await IntentLauncher.startActivityAsync('android.settings.VOICE_INPUT_SETTINGS');
    return;
  } catch { /* fall through */ }
  await Linking.openSettings().catch(() => {});
}

/** What to tell the user, in their own words. */
export function voiceOfflineCopy(status: VoicePackState, bn: boolean): { title: string; detail: string } {
  switch (status) {
    case 'INSTALLED':
      return bn
        ? { title: 'ভয়েস অফলাইনে চলবে', detail: 'বাংলা ভাষার প্যাকেট ফোনে আছে — ইন্টারনেট বন্ধ রেখেও বলে লেখা যাবে।' }
        : { title: 'Voice works offline', detail: 'The language pack is on this phone, so speaking works with the connection off.' };
    case 'MISSING':
      return bn
        ? { title: 'ভয়েস প্যাকেট নামানো দরকার', detail: 'একবার ইন্টারনেট দিয়ে ভাষার প্যাকেটটি নামিয়ে নিন। এরপর থেকে ইন্টারনেট ছাড়াই কথা বলে লেখা যাবে।' }
        : { title: 'The voice pack is not downloaded', detail: 'Fetch the language pack once over the internet. After that, speaking works with no connection at all.' };
    case 'UNSUPPORTED':
      return bn
        ? { title: 'এই ফোনে অফলাইন ভয়েস নেই', detail: 'ফোনটির অ্যান্ড্রয়েড সংস্করণ বা ভয়েস সেবা অফলাইনে কথা বোঝার সুবিধা দেয় না। লেখা ও বাকি সবকিছু আগের মতোই অফলাইনে চলবে।' }
        : { title: 'This phone has no offline voice', detail: 'Its Android version or voice service cannot recognise speech without a connection. Typing and everything else still work offline.' };
    default:
      return bn
        ? { title: 'ভয়েসের অবস্থা জানা যায়নি', detail: 'ফোনের ভয়েস সেবা কিছু জানায়নি। মাইক চেপে দেখুন — কাজ করলে ঠিকই আছে।' }
        : { title: 'Could not check voice', detail: 'The phone’s voice service did not answer. Try the mic — if it works, it is fine.' };
  }
}
