import { requireOptionalNativeModule } from 'expo-modules-core';

type DeviceStateNative = { isIgnoringBatteryOptimizations(): boolean | null };

// Optional, like pdf-pages: null in tests and on a build without the native side.
const native = requireOptionalNativeModule<DeviceStateNative>('DeviceState');

/** True/false as the phone reports it; null when the phone cannot say. */
export function batteryExempt(): boolean | null {
  try { return native ? native.isIgnoringBatteryOptimizations() : null; } catch { return null; }
}
