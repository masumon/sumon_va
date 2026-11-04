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
};

type Native = {
  getStatus(): BridgeStatus;
  pair(base: string, code: string, name: string): Promise<{ ok: boolean; error?: string }>;
  unpair(): boolean;
  loginPassword(base: string, email: string, password: string, totp: string | null, name: string): Promise<LoginResult>;
  loginRequest(base: string, email: string): Promise<{ ok: boolean; error?: string }>;
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

export const loginVerify = (base: string, email: string, code: string, totp: string | null, name: string): Promise<LoginResult> =>
  native ? native.loginVerify(base, email, code, totp, name) : Promise.resolve({ ok: false, error: 'এই বিল্ডে ফোন-মডিউল নেই' });

/** Called the moment the server says something changed (a new message, a draft, an alert). Returns an unsubscribe function. */
export function onInboxChanged(listener: () => void): () => void {
  try {
    const sub = native?.addListener('inboxChanged', listener);
    return () => { try { sub?.remove(); } catch { /* already gone */ } };
  } catch { return () => {}; }
}

export const unpair = () => { try { return native?.unpair() ?? false; } catch { return false; } };

/** Server call through the native side: the device token never reaches JavaScript. */
export async function request<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
  if (!native) return { status: 0, data: null };
  const r = await native.request(method, path, body === undefined ? null : JSON.stringify(body));
  let data: T | null = null;
  try { data = r.body ? (JSON.parse(r.body) as T) : null; } catch { data = null; }
  return { status: r.status, data };
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
