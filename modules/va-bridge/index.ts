import { requireOptionalNativeModule } from 'expo-modules-core';

export type BridgeStatus = {
  paired: boolean;
  notificationAccess: boolean;
  smsReceive: boolean;
  smsSend: boolean;
  phoneState: boolean;
  callLog: boolean;
  postNotifications: boolean;
  batteryExempt: boolean;
  dndAccess: boolean;
  serviceAlive: boolean;
  queued: number;
  lastOk: number;
  lastError: string | null;
  pollSeconds: number;
  packages: string[];
  accountName: string | null;
  accountEmail: string | null;
  activity: boolean;
  alertUrgent: number;
  alertImportant: number;
  alertNormal: number;
  alertVolume: number;
  location: boolean;
  contacts: boolean;
  storage: boolean;
  microphone: boolean;
  exactAlarm: boolean;
  fullScreen: boolean;
  /** READ_SMS granted (old SMS can be brought in). */
  smsRead?: boolean;
  /** The device-admin guard is on. */
  deviceAdmin?: boolean;
};

type Native = {
  getStatus(): BridgeStatus;
  pair(base: string, code: string, name: string): Promise<{ ok: boolean; error?: string }>;
  unpair(): boolean;
  setSecure(on: boolean): boolean;
  loginPassword(base: string, email: string, password: string, totp: string | null, name: string): Promise<LoginResult>;
  loginRequest(base: string, email: string): Promise<{ ok: boolean; error?: string }>;
  installedApps(): { pkg: string; label: string }[];
  openChat(pkg: string, name: string, text: string): { how: 'chat' | 'share' | 'app' | 'none'; hasNumber: boolean };
  loginTelegramRequest(base: string, name: string): Promise<{ ok: boolean; requestId?: string; code?: string; expiresIn?: number; error?: string }>;
  loginTelegramPoll(base: string, requestId: string): Promise<{ ok: boolean; status: 'pending' | 'approved' | 'denied' | 'expired' | 'used' | 'error'; name?: string }>;
  loginVerify(base: string, email: string, code: string, totp: string | null, name: string): Promise<{ ok: boolean; needTotp?: boolean; name?: string; error?: string }>;
  addListener(event: 'inboxChanged', listener: () => void): { remove(): void };
  request(method: string, path: string, body: string | null): Promise<{ status: number; body: string }>;
  flush(): Promise<boolean>;
  startService(): boolean;
  stopService(): boolean;
  /** Seconds the phone has been still and untouched (nobody carrying or using it). */
  stillFor(): number;
  setPackages(list: string[]): boolean;
  setPollSeconds(seconds: number): boolean;
  testAlert(): boolean;
  isInstalled(pkg: string): boolean;
  setAlertLevels(urgent: number, important: number, normal: number, volume: number): boolean;
  testAlertLevel(level: number, volume: number): boolean;
  notify(target: string, body: string, id: string): boolean;
  openNotificationAccess(): boolean;
  openDndAccess(): boolean;
  openBatterySettings(): boolean;
  openAppSettings(): boolean;
  openExactAlarmSettings(): boolean;
  openFullScreenSettings(): boolean;
  smsHistory(days: number, limit: number): Promise<string>;
  requestDeviceAdmin(): boolean;
};

// Optional, like device-state: null in tests and in any build without the native side.
const native = requireOptionalNativeModule<Native>('VaBridge');

export const bridgeAvailable = native != null;

export const emptyStatus: BridgeStatus = {
  paired: false, notificationAccess: false, smsReceive: false, smsSend: false, phoneState: false, callLog: false,
  postNotifications: false, batteryExempt: false, dndAccess: false, serviceAlive: false, queued: 0, lastOk: 0,
  lastError: null, pollSeconds: 20, packages: [], accountName: null, accountEmail: null, activity: false, alertUrgent: 3, alertImportant: 2, alertNormal: 1, alertVolume: 3, location: false, contacts: false, storage: false, microphone: false, exactAlarm: false, fullScreen: false,
};

export function getStatus(): BridgeStatus {
  try { return native ? native.getStatus() : emptyStatus; } catch { return emptyStatus; }
}

export const pair = (base: string, code: string, name: string) =>
  native ? native.pair(base, code, name) : Promise.resolve({ ok: false, error: 'এই বিল্ডে ফোন-মডিউল নেই' });

export const loginPassword = (base: string, email: string, password: string, totp: string | null, name: string): Promise<LoginResult> =>
  native ? native.loginPassword(base, email, password, totp, name) : Promise.resolve({ ok: false, error: 'এই বিল্ডে ফোন-মডিউল নেই' });

export const loginRequest = (base: string, email: string) =>
  native ? native.loginRequest(base, email) : Promise.resolve({ ok: false, error: 'এই বিল্ডে ফোন-মডিউল নেই' });

export type LoginResult = { ok: boolean; needTotp?: boolean; name?: string; error?: string };

/** Password-free sign-in: ask, then wait for the owner's tap in his Telegram bot. */
export const loginTelegramRequest = (base: string, name: string) =>
  native ? native.loginTelegramRequest(base, name) : Promise.resolve({ ok: false, error: 'এই বিল্ডে ফোন-মডিউল নেই' } as { ok: boolean; requestId?: string; code?: string; expiresIn?: number; error?: string });

export const loginTelegramPoll = (base: string, requestId: string) =>
  native ? native.loginTelegramPoll(base, requestId) : Promise.resolve({ ok: false, status: 'error' as const });

export const loginVerify = (base: string, email: string, code: string, totp: string | null, name: string): Promise<LoginResult> =>
  native ? native.loginVerify(base, email, code, totp, name) : Promise.resolve({ ok: false, error: 'এই বিল্ডে ফোন-মডিউল নেই' });

/** Called the moment the server says something changed (a new message, a draft, an alert). Returns an unsubscribe function. */
export function onInboxChanged(listener: () => void): () => void {
  try {
    const sub = native?.addListener('inboxChanged', listener);
    return () => { try { sub?.remove(); } catch { /* already gone */ } };
  } catch { return () => {}; }
}

/** Shown before signing out: messages still waiting on this phone are lost when it is unpaired. Empty when nothing waits. */
export function unsentWarning(bn: boolean): string {
  const n = getStatus().queued;
  if (!n) return '';
  const d = bn ? String(n).replace(/[0-9]/g, (x) => '০১২৩৪৫৬৭৮৯'[Number(x)] ?? x) : String(n);
  return bn ? ` সাবধান: এই ফোনে এখনো ${d}টি বার্তা সার্ভারে যায়নি; এখন বিচ্ছিন্ন করলে সেগুলো হারাবে। আগে ইন্টারনেট চালু রেখে একটু অপেক্ষা করুন।`
    : ` Careful: ${d} message(s) on this phone have not reached the server yet; unpairing now loses them. Stay online for a moment first.`;
}
export const unpair = () => { try { return native?.unpair() ?? false; } catch { return false; } };
/** Screenshot / recent-apps privacy through the app's own native code (Android FLAG_SECURE). */
export const setSecure = (on: boolean) => { try { return native?.setSecure(on) ?? false; } catch { return false; } };

/** Server call through the native side: the device token never reaches JavaScript. */
export async function request<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<{ status: number; data: T | null; reason?: string }> {
  if (!native) return { status: 0, data: null, reason: 'NoBridge' };
  const r = await native.request(method, path, body === undefined ? null : JSON.stringify(body));
  let data: T | null = null;
  try { data = r.body ? (JSON.parse(r.body) as T) : null; } catch { data = null; }
  // On a network failure (status 0) the native side puts the kind of failure in the body, e.g. SocketTimeoutException.
  return { status: r.status, data, reason: r.status === 0 ? r.body : undefined };
}

const call = <K extends keyof Native>(name: K) => (...args: Parameters<Native[K]>) => {
  try { return (native?.[name] as (...a: unknown[]) => unknown)?.(...args); } catch { return undefined; }
};

export const startService = call('startService');
export const stopService = call('stopService');
export const stillFor = call('stillFor');
export const setPackages = call('setPackages');
export const setPollSeconds = call('setPollSeconds');
export const testAlert = call('testAlert');
export const isInstalled = (pkg: string): boolean => { try { return !!native?.isInstalled(pkg); } catch { return false; } };
export const setAlertLevels = call('setAlertLevels');
export const testAlertLevel = call('testAlertLevel');
export const notify = call('notify');
export const openNotificationAccess = call('openNotificationAccess');
export const openDndAccess = call('openDndAccess');
export const openBatterySettings = call('openBatterySettings');
export const openAppSettings = call('openAppSettings');
export const openExactAlarmSettings = call('openExactAlarmSettings');
export const openFullScreenSettings = call('openFullScreenSettings');
export const flush = () => (native ? native.flush() : Promise.resolve(false));

/** Open that person's chat in the chat app with the answer ready (and copied). The owner presses the app's own Send. */
export const openChat = (pkg: string, name: string, text: string): { how: 'chat' | 'share' | 'app' | 'none'; hasNumber: boolean } => {
  try { return native ? native.openChat(pkg, name, text) : { how: 'none', hasNumber: false }; } catch { return { how: 'none', hasNumber: false }; }
};

/** Old SMS from the phone (needs READ_SMS): newest first. An empty list when not allowed; `error` says why. */
export type SmsRow = { a: string; b: string; t: number; k: number };
export async function smsHistory(days: number, limit = 3000): Promise<{ rows: SmsRow[]; error?: string }> {
  try {
    const raw = native?.smsHistory ? await native.smsHistory(days, limit) : 'ERR:unsupported';
    if (raw.startsWith('ERR:')) return { rows: [], error: raw.slice(4) };
    const rows = JSON.parse(raw) as SmsRow[];
    return { rows: Array.isArray(rows) ? rows : [] };
  } catch (e) { return { rows: [], error: e instanceof Error ? e.message : 'error' }; }
}
/** Opens Android's own "activate device admin" page for the app guard. */
export const requestDeviceAdmin = (): boolean => { try { return !!native?.requestDeviceAdmin?.(); } catch { return false; } };

/** Every app on the phone that has an icon, A to Z. Used by "add a new app". */
export const installedApps = (): { pkg: string; label: string }[] => {
  try { return native ? native.installedApps() : []; } catch { return []; }
};

/** One entry of the phone's alert history (what rang or buzzed, newest first). `target` is where tapping it should lead. */
export type AlertHistoryItem = { id: string; title: string; text: string; sub: string; target: string; open?: string; at: number };
type AlertNative = { alertHistory?: () => AlertHistoryItem[]; clearAlertHistory?: () => boolean };

/** The alert history kept by the phone service. An empty list when the native side does not have it. */
export const alertHistory = (): AlertHistoryItem[] => {
  try { const r = (native as unknown as AlertNative | null)?.alertHistory?.(); return Array.isArray(r) ? r : []; } catch { return []; }
};
/** Forget the whole alert history. False when nothing could be cleared. */
export const clearAlertHistory = (): boolean => {
  try { return !!(native as unknown as AlertNative | null)?.clearAlertHistory?.(); } catch { return false; }
};

/** Passkey (Google Credential Manager / fingerprint) sign-in and registration. Never throws: a failure comes back as { ok: false, error }. */
export type PasskeyResult = { ok: boolean; name?: string; error?: string; cancelled?: boolean };
type PasskeyNative = {
  passkeyLogin?: (base: string, name: string) => Promise<PasskeyResult>;
  passkeyRegister?: (base: string) => Promise<PasskeyResult>;
};
const NO_PASSKEY = 'এই ফোনে পাসকির অংশ নেই / Passkey is not available in this build';

export const passkeyLogin = async (base: string, name: string): Promise<PasskeyResult> => {
  try {
    const fn = (native as unknown as PasskeyNative | null)?.passkeyLogin;
    if (!fn) return { ok: false, error: NO_PASSKEY };
    const r = await (native as unknown as PasskeyNative).passkeyLogin!(base, name);
    return r && typeof r === 'object' ? r : { ok: false, error: NO_PASSKEY };
  } catch (e) {
    return { ok: false, error: `পাসকি দিয়ে ঢোকা যায়নি / Passkey sign-in failed${e instanceof Error && e.message ? `: ${e.message}` : ''}` };
  }
};

export const passkeyRegister = async (base: string): Promise<PasskeyResult> => {
  try {
    const fn = (native as unknown as PasskeyNative | null)?.passkeyRegister;
    if (!fn) return { ok: false, error: NO_PASSKEY };
    const r = await (native as unknown as PasskeyNative).passkeyRegister!(base);
    return r && typeof r === 'object' ? r : { ok: false, error: NO_PASSKEY };
  } catch (e) {
    return { ok: false, error: `পাসকি বানানো যায়নি / Could not create the passkey${e instanceof Error && e.message ? `: ${e.message}` : ''}` };
  }
};
