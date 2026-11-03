// Every Android maker stops "background" apps its own way, and a stopped app's reminders
// do not ring (RC.1 QA, and the user's rule: it must work on any Android phone, not only
// vivo). The app cannot read or change these settings. What it can do is recognise the
// maker, try that maker's own settings screens in order, and say — in plain words, for that
// maker — what to switch on. Screens that are not on the phone are skipped silently.
//
// Component names are the ones in common use for this (the dontkillmyapp.com guides and the
// AutoStarter library). On vivo, the screens were checked on a real phone (V2317, Android
// 15): its power screen refuses to be opened by other apps, so the steps say where it is.

export type OemFamily = 'xiaomi' | 'samsung' | 'oppo' | 'huawei' | 'vivo' | 'transsion' | 'asus' | 'nokia' | 'meizu' | 'letv' | 'other';

export function oemFamily(manufacturer: string | null | undefined, brand?: string | null): OemFamily {
  const m = `${manufacturer ?? ''} ${brand ?? ''}`.toLowerCase();
  if (/xiaomi|redmi|poco/u.test(m)) return 'xiaomi';
  if (/samsung/u.test(m)) return 'samsung';
  if (/oppo|realme|oneplus|oplus/u.test(m)) return 'oppo';
  if (/huawei|honor/u.test(m)) return 'huawei';
  if (/vivo|iqoo/u.test(m)) return 'vivo';
  if (/tecno|infinix|itel|transsion/u.test(m)) return 'transsion';
  if (/asus/u.test(m)) return 'asus';
  if (/nokia|hmd/u.test(m)) return 'nokia';
  if (/meizu/u.test(m)) return 'meizu';
  if (/letv|leeco/u.test(m)) return 'letv';
  return 'other';
}

/** Makers known to stop background apps harder than stock Android. */
export function isAggressiveOem(family: OemFamily): boolean {
  return family !== 'other' && family !== 'nokia';
}

type Screen = { pkg: string; cls: string };

/** The maker's own auto-start / background screens, most useful first. */
export const OEM_SCREENS: Record<OemFamily, Screen[]> = {
  xiaomi: [
    { pkg: 'com.miui.securitycenter', cls: 'com.miui.permcenter.autostart.AutoStartManagementActivity' },
    { pkg: 'com.miui.powerkeeper', cls: 'com.miui.powerkeeper.ui.HiddenAppsConfigActivity' },
  ],
  samsung: [
    { pkg: 'com.samsung.android.lool', cls: 'com.samsung.android.sm.ui.battery.BatteryActivity' },
    { pkg: 'com.samsung.android.sm', cls: 'com.samsung.android.sm.ui.battery.BatteryActivity' },
  ],
  oppo: [
    { pkg: 'com.coloros.safecenter', cls: 'com.coloros.safecenter.permission.startup.StartupAppListActivity' },
    { pkg: 'com.coloros.safecenter', cls: 'com.coloros.safecenter.startupapp.StartupAppListActivity' },
    { pkg: 'com.oppo.safe', cls: 'com.oppo.safe.permission.startup.StartupAppListActivity' },
    { pkg: 'com.oneplus.security', cls: 'com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity' },
  ],
  huawei: [
    { pkg: 'com.huawei.systemmanager', cls: 'com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity' },
    { pkg: 'com.huawei.systemmanager', cls: 'com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity' },
    { pkg: 'com.huawei.systemmanager', cls: 'com.huawei.systemmanager.optimize.process.ProtectActivity' },
  ],
  vivo: [
    { pkg: 'com.iqoo.secure', cls: 'com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity' },
    { pkg: 'com.iqoo.secure', cls: 'com.iqoo.secure.ui.phoneoptimize.BgStartUpManager' },
    { pkg: 'com.vivo.permissionmanager', cls: 'com.vivo.permissionmanager.activity.BgStartUpManagerActivity' },
  ],
  transsion: [
    { pkg: 'com.transsion.phonemaster', cls: 'com.cyin.himgr.autostart.AutoStartActivity' },
  ],
  asus: [
    { pkg: 'com.asus.mobilemanager', cls: 'com.asus.mobilemanager.autostart.AutoStartActivity' },
    { pkg: 'com.asus.mobilemanager', cls: 'com.asus.mobilemanager.powersaver.PowerSaverSettings' },
  ],
  nokia: [
    { pkg: 'com.evenwell.powersaving.g3', cls: 'com.evenwell.powersaving.g3.exception.PowerSaverExceptionActivity' },
  ],
  meizu: [
    { pkg: 'com.meizu.safe', cls: 'com.meizu.safe.permission.SmartBGActivity' },
  ],
  letv: [
    { pkg: 'com.letv.android.letvsafe', cls: 'com.letv.android.letvsafe.AutobootManageActivity' },
  ],
  other: [],
};

/** Plain steps for this maker, shown under the reminder settings. */
export function oemSteps(family: OemFamily, bn: boolean): string[] {
  const lock = bn
    ? 'সাম্প্রতিক অ্যাপ (Recents) খুলে Apon-এর কার্ড চেপে ধরে 🔒 লক করুন — সোয়াইপ করে বন্ধ করলে অনেক ফোনে রিমাইন্ডার বাতিল হয়ে যায়।'
    : 'Open Recent apps, long-press Apon’s card and Lock (🔒) it — on many phones swiping it away cancels its reminders.';
  const steps: Record<OemFamily, [string, string][]> = {
    xiaomi: [['সেটিংস → অ্যাপ → Apon → "অটোস্টার্ট" চালু করুন', 'Settings → Apps → Apon → turn on "Autostart"'], ['ব্যাটারি সেভার → "কোনো বাধা নেই" (No restrictions) বেছে নিন', 'Battery saver → choose "No restrictions"']],
    samsung: [['সেটিংস → ব্যাটারি → ব্যাকগ্রাউন্ড ব্যবহারের সীমা → "কখনো ঘুমাবে না" তালিকায় Apon যোগ করুন', 'Settings → Battery → Background usage limits → add Apon to "Never sleeping apps"']],
    oppo: [['সেটিংস → ব্যাটারি → Apon → "ব্যাকগ্রাউন্ডে চলতে দিন" চালু করুন', 'Settings → Battery → Apon → turn on "Allow background activity"'], ['সেটিংস → অ্যাপ → Apon → "অটো লঞ্চ" চালু করুন', 'Settings → Apps → Apon → turn on "Auto launch"']],
    huawei: [['সেটিংস → ব্যাটারি → অ্যাপ লঞ্চ → Apon → "নিজে ঠিক করুন" বেছে তিনটাই চালু রাখুন', 'Settings → Battery → App launch → Apon → "Manage manually", keep all three on']],
    vivo: [['সেটিংস → ব্যাটারি → ব্যাকগ্রাউন্ডে বিদ্যুৎ ব্যবহার (Background power consumption) → Apon → "অনুমতি দিন" — vivo এই পাতা অন্য অ্যাপকে খুলতে দেয় না, তাই নিজে খুলতে হবে', 'Settings → Battery → Background power consumption → Apon → Allow — vivo does not let other apps open that page'], ['সেটিংস → অ্যাপ → অটো-স্টার্ট → Apon চালু করুন', 'Settings → Apps → Autostart → turn on Apon']],
    transsion: [['Phone Master → অটো-স্টার্ট → Apon চালু করুন', 'Phone Master → Auto-start → turn on Apon'], ['সেটিংস → ব্যাটারি → Apon → "ব্যাকগ্রাউন্ডে চলতে দিন"', 'Settings → Battery → Apon → allow background running']],
    asus: [['Mobile Manager → অটো-স্টার্ট → Apon চালু করুন', 'Mobile Manager → Auto-start → turn on Apon']],
    nokia: [['সেটিংস → ব্যাটারি → Apon → "সীমাবদ্ধ নয়" বেছে নিন', 'Settings → Battery → Apon → choose "Unrestricted"']],
    meizu: [['সেটিংস → ব্যাটারি → Apon → "ব্যাকগ্রাউন্ডে চলতে দিন"', 'Settings → Battery → Apon → allow background running']],
    letv: [['সেটিংস → অনুমতি → অটো-স্টার্ট → Apon চালু করুন', 'Settings → Permissions → Autostart → turn on Apon']],
    other: [['সেটিংস → অ্যাপ → Apon → ব্যাটারি → "সীমাবদ্ধ নয়" (Unrestricted) বেছে নিন', 'Settings → Apps → Apon → Battery → choose "Unrestricted"']],
  };
  return [...steps[family].map(([b, e]) => (bn ? b : e)), lock];
}
