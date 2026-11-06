import { PermissionsAndroid, type Permission } from 'react-native';
import { openAppSettings, openBatterySettings, openDndAccess, openFullScreenSettings, openNotificationAccess, requestDeviceAdmin, type BridgeStatus } from '../../modules/va-bridge';

/**
 * Every permission the app can use, in one list: what it is for, whether it is needed, how to check it, how to ask for it.
 * The Setup screen only reads this list, so a new permission is one entry here and it shows up with its tick and its reason.
 */
export type Grade = 'must' | 'good' | 'optional';
export type GroupKey = 'catch' | 'alarm' | 'background' | 'optional';

export type PermDef = {
  key: string;
  group: GroupKey;
  grade: Grade;
  bn: string; en: string;
  whyBn: string; whyEn: string;
  ok: (s: BridgeStatus) => boolean;
  /** Runtime permissions the system dialog can grant. */
  runtime?: Permission[];
  /** For switches that only live in system Settings: opens the right page. */
  open?: () => void;
  /** Why it may fail on THIS kind of app (sideloaded, not from Play), shown when it is still off after trying. */
  failBn?: string; failEn?: string;
};

const P = PermissionsAndroid.PERMISSIONS;

export const GROUPS: { key: GroupKey; bn: string; en: string; hintBn: string; hintEn: string }[] = [
  { key: 'catch', bn: 'বার্তা ধরতে', en: 'To catch messages', hintBn: 'এগুলো না দিলে বার্তা আসবে না', hintEn: 'Without these, messages do not arrive' },
  { key: 'alarm', bn: 'জরুরি অ্যালার্মের জন্য', en: 'For the urgent alarm', hintBn: 'ফোন সাইলেন্ট থাকলেও জরুরি বার্তায় বাজবে', hintEn: 'So urgent messages ring even on silent' },
  { key: 'background', bn: 'ব্যাকগ্রাউন্ডে চলার জন্য', en: 'To keep running in the background', hintBn: 'অ্যাপ বন্ধ থাকলেও যেন বার্তা আসতে থাকে', hintEn: 'To stay connected when the app is closed' },
  { key: 'optional', bn: 'ঐচ্ছিক (দিলে সুবিধা বাড়ে)', en: 'Optional (extra comfort)', hintBn: 'না দিলেও মূল কাজ সবই চলবে', hintEn: 'Everything core works without them' },
];

export const PERMISSIONS: PermDef[] = [
  { key: 'notifications', group: 'catch', grade: 'must', bn: 'নোটিফিকেশন দেখানো', en: 'Show notifications', whyBn: 'জরুরি বার্তা ও সতর্কতা আপনাকে জানাতে।', whyEn: 'To show urgent messages and alerts.', ok: (s) => s.postNotifications, runtime: [P.POST_NOTIFICATIONS] },
  {
    key: 'access', group: 'catch', grade: 'must', bn: 'চ্যাট অ্যাপের বার্তা পড়া', en: 'Read chat-app messages', whyBn: 'WhatsApp, Messenger, IMO, Telegram… থেকে বার্তা ধরতে লাগে। “খুলুন” চাপুন, তারপর তালিকায় “সুমনের ভার্চুয়াল সহকারী” চালু করুন।', whyEn: 'To catch messages from WhatsApp, Messenger, IMO, Telegram… Turn on “Sumon’s Virtual Assistant” there.',
    ok: (s) => s.notificationAccess, open: () => { openNotificationAccess(); },
    failBn: 'চালু হচ্ছে না? Play Store ছাড়া অন্য জায়গা থেকে নেওয়া অ্যাপে ফোন এটা আটকে রাখে (“সীমাবদ্ধ সেটিংস”)। “অ্যাপ-তথ্য খুলুন” চাপুন, উপরে ডানে ⋮ চাপুন, “সীমাবদ্ধ সেটিংস অনুমোদন করুন” বেছে নিন। তারপর আবার চেষ্টা করুন।',
    failEn: 'Cannot switch it on? The phone blocks this for sideloaded apps (“restricted settings”). Press “Open app info” → ⋮ top right → “Allow restricted settings”, then try again.',
  },
  { key: 'sms', group: 'catch', grade: 'must', bn: 'SMS পাওয়া ও পাঠানো', en: 'Receive and send SMS', whyBn: 'আসা SMS ধরতে, আর আপনি অনুমোদন দিলে উত্তর পাঠাতে।', whyEn: 'To catch SMS and send replies you approve.', ok: (s) => s.smsReceive && s.smsSend, runtime: [P.RECEIVE_SMS, P.SEND_SMS] },
  { key: 'calls', group: 'catch', grade: 'must', bn: 'মিসড কল ধরা', en: 'Catch missed calls', whyBn: 'কে কল করেছিল তা জানাতে।', whyEn: 'To tell you who called.', ok: (s) => s.phoneState && s.callLog, runtime: [P.READ_PHONE_STATE, P.READ_CALL_LOG] },
  { key: 'dnd', group: 'alarm', grade: 'good', bn: 'ডোন্ট ডিস্টার্ব অ্যাক্সেস', en: 'Do Not Disturb access', whyBn: 'এটা দিলে ফোন সাইলেন্ট থাকলেও পরিবারের জরুরি বার্তায় বাজবে।', whyEn: 'Lets urgent family messages ring even on silent.', ok: (s) => s.dndAccess, open: () => { openDndAccess(); } },
  { key: 'fullscreen', group: 'alarm', grade: 'good', bn: 'লক-স্ক্রিনে অ্যালার্ম', en: 'Alarm on the lock screen', whyBn: 'ফোন লক থাকলেও জরুরি বার্তায় স্ক্রিন জ্বলে উঠবে।', whyEn: 'Wakes the screen for urgent messages while locked.', ok: (s) => s.fullScreen, open: () => { openFullScreenSettings(); } },
  { key: 'battery', group: 'background', grade: 'must', bn: 'ব্যাটারি সীমাহীন', en: 'Unrestricted battery', whyBn: 'না দিলে ফোন অ্যাপটাকে বন্ধ করে দেয়, তখন বার্তা দেরিতে আসে।', whyEn: 'Otherwise the phone puts the app to sleep and messages arrive late.', ok: (s) => s.batteryExempt, open: () => { openBatterySettings(); } },
  { key: 'service', group: 'background', grade: 'must', bn: 'ব্যাকগ্রাউন্ড সিঙ্ক চালু', en: 'Background sync running', whyBn: 'সার্ভারের সাথে সবসময় যুক্ত থাকে, তাই বার্তা সাথে সাথে আসে।', whyEn: 'Stays connected to the server so messages arrive at once.', ok: (s) => s.serviceAlive, open: () => { openAppSettings(); } },  // no internet is not a missing permission: the health strip says that
  { key: 'activity', group: 'optional', grade: 'optional', bn: 'চলাফেরা বোঝা (স্টেপ সেন্সর)', en: 'Activity (step sensor)', whyBn: 'আপনি হাঁটছেন কিনা বুঝতে, যাতে সহকারী আপনার অবস্থা (বিশ্রামে বা পথে) ঠিকমতো ধরতে পারে।', whyEn: 'To know you are walking or using the phone, so the assistant sets the right status (resting / on the road).', ok: (s) => s.activity, runtime: [P.ACTIVITY_RECOGNITION] },
  { key: 'smsread', group: 'optional', grade: 'optional', bn: 'পুরোনো SMS পড়া', en: 'Read old SMS', whyBn: 'আগের SMS ইতিহাস হিসেবে আনতে (সেটিংস → পুরোনো SMS আনুন)। নতুন SMS ধরতে এটা লাগে না।', whyEn: 'To bring earlier SMS in as history (Settings → Bring in old SMS). Not needed for new SMS.', ok: (s) => !!s.smsRead, runtime: [P.READ_SMS] },
  { key: 'guard', group: 'background', grade: 'good', bn: 'সুরক্ষা (ডিভাইস অ্যাডমিন)', en: 'Protection (device admin)', whyBn: 'চালু থাকলে কেউ অ্যাপ মুছতে বা সুরক্ষা বন্ধ করতে চাইলে আপনার Telegram-এ সঙ্গে সঙ্গে খবর যায়। ফোনের কিছু মোছে না।', whyEn: 'Someone removing the app or its protection is reported to your Telegram at once. Never wipes anything.', ok: (s) => !!s.deviceAdmin, open: () => { requestDeviceAdmin(); } },
  { key: 'contacts', group: 'optional', grade: 'optional', bn: 'কন্টাক্টস (নাম চেনার জন্য)', en: 'Contacts (know names)', whyBn: 'SMS ও কলের নম্বরের পাশে আপনার ফোনে সেভ করা নাম দেখাতে।', whyEn: 'Shows the name saved on your phone next to SMS and call numbers.', ok: (s) => s.contacts, runtime: [P.READ_CONTACTS] },
  { key: 'location', group: 'optional', grade: 'optional', bn: 'লোকেশন', en: 'Location', whyBn: '“রুটিন ও জায়গা” পাতায় এখনকার জায়গা সেভ করতে (যেমন অফিস, বাসা), যাতে সহকারী জানে আপনি কোথায় আছেন। না দিলেও বাকি সব চলবে।', whyEn: 'To save your current place (office, home) on the Routine page so the assistant knows where you are. Everything else works without it.', ok: (s) => s.location, runtime: [P.ACCESS_FINE_LOCATION, P.ACCESS_COARSE_LOCATION] },
];

/** The microphone entry was removed: RECORD_AUDIO is not declared in the manifest and nothing uses it, so it could never be granted. */

/** Switches that live only in system Settings (no runtime dialog): the walk-through opens them one by one. */
export const SPECIAL_ORDER = ['access', 'battery', 'dnd', 'fullscreen', 'guard'];
export const specialDefs = (): PermDef[] => SPECIAL_ORDER.map((k) => PERMISSIONS.find((p) => p.key === k)).filter((d): d is PermDef => !!d && !!d.open);

export type Outcome = { ok: boolean; reasonBn: string; reasonEn: string };

/** Ask for a runtime permission group and explain exactly what happened. */
export async function requestRuntime(perms: Permission[]): Promise<Outcome> {
  const res = await PermissionsAndroid.requestMultiple(perms);
  const values = Object.values(res);
  if (values.every((v) => v === 'granted')) return { ok: true, reasonBn: '', reasonEn: '' };
  if (values.some((v) => v === 'never_ask_again')) {
    return { ok: false, reasonBn: 'আগে একবার “না” বলা হয়েছিল, তাই ফোন আর জিজ্ঞেস করবে না। “সেটিংস খুলুন” চাপুন, তারপর অনুমতির পাতায় গিয়ে নিজে চালু করুন।', reasonEn: 'The phone will not ask again because it was refused before. Press “Open settings” and switch it on there.' };
  }
  return { ok: false, reasonBn: 'এবার “অনুমতি দিন” চাপা হয়নি। আরেকবার চেষ্টা করুন, আর ফোনের প্রশ্নে “অনুমতি দিন” চাপুন।', reasonEn: 'You did not press “Allow” this time. Try again.' };
}

/** Honest status of a permission after the owner tried: what is wrong and what to do. */
export function reasonFor(def: PermDef, status: BridgeStatus, last: Outcome | undefined, bn: boolean): string | null {
  if (def.ok(status)) return null;
  if (def.key === 'service' && status.lastError) return status.lastError;
  if (last && !last.ok) return bn ? last.reasonBn : last.reasonEn;
  if (def.failBn && last) return bn ? def.failBn : (def.failEn ?? def.failBn);
  return null;
}
