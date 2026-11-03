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
};

type Native = {
  getStatus(): BridgeStatus;
  pair(base: string, code: string, name: string): Promise<{ ok: boolean; error?: string }>;
  unpair(): boolean;
  request(method: string, path: string, body: string | null): Promise<{ status: number; body: string }>;
  flush(): Promise<boolean>;
  startService(): boolean;
  stopService(): boolean;
  setPackages(list: string[]): boolean;
  setPollSeconds(seconds: number): boolean;
  testAlert(): boolean;
  openNotificationAccess(): boolean;
  openDndAccess(): boolean;
  openBatterySettings(): boolean;
  openAppSettings(): boolean;
};

// Optional, like device-state: null in tests and in any build without the native side.
const native = requireOptionalNativeModule<Native>('VaBridge');

export const bridgeAvailable = native != null;

export const emptyStatus: BridgeStatus = {
  paired: false, notificationAccess: false, smsReceive: false, smsSend: false, phoneState: false, callLog: false,
  postNotifications: false, batteryExempt: false, dndAccess: false, serviceAlive: false, queued: 0, lastOk: 0,
  lastError: null, pollSeconds: 20, packages: [],
};

export function getStatus(): BridgeStatus {
  try { return native ? native.getStatus() : emptyStatus; } catch { return emptyStatus; }
}

export const pair = (base: string, code: string, name: string) =>
  native ? native.pair(base, code, name) : Promise.resolve({ ok: false, error: 'এই বিল্ডে ফোন-মডিউল নেই' });

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
export const setPackages = call('setPackages');
export const setPollSeconds = call('setPollSeconds');
export const testAlert = call('testAlert');
export const openNotificationAccess = call('openNotificationAccess');
export const openDndAccess = call('openDndAccess');
export const openBatterySettings = call('openBatterySettings');
export const openAppSettings = call('openAppSettings');
export const flush = () => (native ? native.flush() : Promise.resolve(false));
