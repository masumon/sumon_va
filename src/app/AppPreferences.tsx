import { TextScaleContext } from '../ui/AppText';
import { Appearance, I18nManager, NativeModules, Platform } from 'react-native';
import type { PropsWithChildren } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import { getGlassTokens, getThemeAccents, getThemeColors, type GlassTokens, type ThemeAccents, type ThemeColors } from '../theme';
import { setTimeFormatPreference, setTimeZonePreference, BANGLADESH_TIME_ZONE } from '../i18n/date-time';
import * as Crypto from 'expo-crypto';
import { pbkdf2 } from '../backup/crypto';

type Language = 'en' | 'bn';
type ThemeMode = 'light' | 'dark' | 'dim';
// What the user picked. `system` follows the OS; `themeMode` above is always the resolved
// light/dark value so every screen keeps consuming exactly what it did before.
type ThemeSetting = 'light' | 'dark' | 'dim' | 'system';

export type QuietHours = { start: number; end: number };
export type TimeFormat = '12' | '24';
// 0 = Sunday, 1 = Monday, 6 = Saturday (the Bangladesh working-week start, and the default).
export type WeekStart = 0 | 1 | 6;
// Minutes before `dueAt` a reminder fires. 0 = at the due time.
export const REMINDER_LEADS = [0, 15, 60, 1440] as const;

type PreferencesContextValue = {
  language: Language;
  themeMode: ThemeMode;
  themeSetting: ThemeSetting;
  colors: ThemeColors;
  accents: ThemeAccents;
  glass: GlassTokens;
  onboarded: boolean;
  prefsLoaded: boolean;
  reduceMotion: boolean;
  /** Settings → লেখার মাপ: 0.9 ছোট, 1 স্বাভাবিক, 1.1 বড়, 1.2 আরও বড়. */
  textScale: number;
  setTextScale: (value: number) => Promise<void>;
  quietHours: QuietHours | null;
  timeFormat: TimeFormat;
  setTimeZone: (v: string) => Promise<void>;
  /** IANA name, e.g. "Asia/Dhaka". Every date in the app is read in this zone. */
  timeZone: string;
  weekStartsOn: WeekStart;
  reminderLeadMinutes: number;
  quickCaptureTile: boolean;
  /** Hide the app's own content from screenshots and the recents thumbnail. */
  blockScreenshots: boolean;
  autoBackup: boolean;
  autoBackupFolderUri: string | null;
  appLockEnabled: boolean;
  setLanguage: (language: Language) => Promise<void>;
  setThemeMode: (themeSetting: ThemeSetting) => Promise<void>;
  setReduceMotion: (value: boolean) => Promise<void>;
  setQuietHours: (value: QuietHours | null) => Promise<void>;
  setTimeFormat: (value: TimeFormat) => Promise<void>;
  setWeekStartsOn: (value: WeekStart) => Promise<void>;
  setReminderLeadMinutes: (value: number) => Promise<void>;
  setQuickCaptureTile: (value: boolean) => Promise<void>;
  setBlockScreenshots: (value: boolean) => Promise<void>;
  setAutoBackup: (value: boolean) => Promise<void>;
  setAutoBackupFolderUri: (value: string | null) => Promise<void>;
  setAppLockPin: (pin: string | null) => Promise<void>;
  verifyAppLockPin: (pin: string) => Promise<boolean>;
  applyDeviceLanguage: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
};

// ── the app-lock PIN ─────────────────────────────────────────────────────────
//
// The stored value used to be a 32-bit FNV-1a hash with a fixed prefix and no salt. A PIN
// is four to eight digits — at most a hundred million candidates — so an unsalted, single
// -pass hash is not a lock at all: anyone holding the database file (and `allowBackup` put
// it in reach) could enumerate the whole space faster than a person could type one guess.
// FNV also collides freely, which means a *wrong* PIN could open the app.
//
// Now: a random salt per PIN, and PBKDF2-HMAC-SHA256 — the same derivation the backup
// encryption uses, so there is one answer in this codebase to "turn a secret into a key".
// The iteration count is deliberately lower than the backup's: this runs on every unlock
// and has to feel instant, while the backup runs once. It still raises the cost of a
// guess by orders of magnitude over what was here before, and the salt removes
// precomputation entirely.
//
// 20,000 was chosen against a Node.js measurement (1,668 ms) that this file's own comment
// already flagged as optimistic — "Hermes has no JIT". A real device confirmed it: with
// the async, yielding PBKDF2 no longer freezing the UI thread, the honest wall-clock cost
// of 20,000 pure-JS HMAC-SHA256 rounds on real Hermes hardware still measured 7-10 SECONDS
// per unlock attempt — a PIN gate slow enough to read as the app having hung. A 4-8 digit
// PIN's real protection is rate-limiting and lockout, not key-stretching cost (at most a
// hundred million candidates, PBKDF2 iterations barely move that needle either way); this
// keeps the same salted, self-describing scheme and lands unlock under a second on the
// device that measured the old number, while still being three orders of magnitude
// costlier than the unsalted single-pass hash this replaced.
//
// Old hashes are still accepted once, then silently upgraded on the next successful
// unlock, so nobody is locked out by the change — the same mechanism that let this number
// change once already carries the second change for free.
const PIN_ITERATIONS = 2_000;
const PIN_KEY_BYTES = 32;
const PIN_PREFIX = 'pbkdf2$';

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** The retired digest, kept only long enough to recognise and replace a stored one. */
function legacyPinDigest(pin: string): string {
  let h = 2166136261;
  for (const ch of `om::${pin}::lock`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/** `pbkdf2$<iterations>$<salt-hex>$<key-hex>` — self-describing, so the cost can rise later. */
async function pinDigest(pin: string, salt: Uint8Array = Crypto.getRandomValues(new Uint8Array(16)), iterations = PIN_ITERATIONS): Promise<string> {
  const key = await pbkdf2(pin, salt, iterations, PIN_KEY_BYTES);
  return `${PIN_PREFIX}${iterations}$${toHex(salt)}$${toHex(key)}`;
}

/** Constant-time-ish comparison; the strings are equal length whenever the format matches. */
function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when `pin` matches `stored`, whichever format `stored` is in. */
async function pinMatches(pin: string, stored: string): Promise<boolean> {
  if (!stored.startsWith(PIN_PREFIX)) return sameDigest(legacyPinDigest(pin), stored);
  const [, iterationsRaw, saltHex] = stored.split('$');
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0 || !saltHex) return false;
  return sameDigest(await pinDigest(pin, fromHex(saltHex), iterations), stored);
}

/** Whether a stored value should be rewritten on next successful unlock — the oldest
 *  unsalted format, or a PBKDF2 hash whose own iteration count no longer matches
 *  `PIN_ITERATIONS` (lowered once already, on device evidence that 20,000 pure-JS rounds
 *  took 7-10 seconds on real Hermes hardware — a PIN set before that change keeps paying
 *  the old cost forever otherwise, since its hash is self-describing and correct, just slow). */
const isLegacyDigest = (stored: string): boolean => {
  if (!stored.startsWith(PIN_PREFIX)) return true;
  const iterations = Number(stored.split('$')[1]);
  return iterations !== PIN_ITERATIONS;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

// Dependency-free device-locale read so a Bangladeshi user's first launch defaults to
// Bangla instead of English (audit P0), without adding expo-localization.
function deviceLanguage(): Language {
  try {
    const tag =
      (Platform.OS === 'ios'
        ? NativeModules.SettingsManager?.settings?.AppleLocale ||
          NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
        : NativeModules.I18nManager?.localeIdentifier) ||
      (I18nManager as unknown as { getConstants?: () => { localeIdentifier?: string } }).getConstants?.().localeIdentifier ||
      '';
    const tagged = String(tag).toLowerCase();
    if (tagged.startsWith('bn')) return 'bn';
    // A Bangladeshi phone set to English is the common case, not a request for an English
    // app — Apon is written for people who read Bengali, and the onboarding offers the
    // switch on its last page for anyone this guesses wrong about.
    if (tagged.includes('-bd') || tagged.endsWith('bd')) return 'bn';
    return 'en';
  } catch {
    return 'bn';
  }
}

export function AppPreferencesProvider({ children }: PropsWithChildren) {
  const db = useSQLiteContext();
  // Bengali is the default because this app is Bengali-first in every other respect. A
  // person who reads Bengali should not have to get past an English screen to find the
  // language switch; someone who wants English changes it once, on the first screen.
  const [language, setLanguageState] = useState<Language>('bn');
  const [themeSetting, setThemeSettingState] = useState<ThemeSetting>('light');
  const [systemScheme, setSystemScheme] = useState<ThemeMode>(() => (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'));
  const themeMode: ThemeMode = themeSetting === 'system' ? systemScheme : themeSetting;
  const [onboarded, setOnboarded] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [reduceMotion, setReduceMotionState] = useState(false);
  const [textScale, setTextScaleState] = useState(1);
  const [quietHours, setQuietHoursState] = useState<QuietHours | null>(null);
  const [timeFormat, setTimeFormatState] = useState<TimeFormat>('12');
  const [timeZone, setTimeZoneState] = useState<string>(BANGLADESH_TIME_ZONE);
  const [weekStartsOn, setWeekStartsOnState] = useState<WeekStart>(6);
  const [reminderLeadMinutes, setReminderLeadMinutesState] = useState(0);
  const [quickCaptureTile, setQuickCaptureTileState] = useState(false);
  // Defaults ON: this app's recent-apps preview and screenshots would otherwise show
  // ledgers, debts and health records to anyone with the phone unlocked, before the user
  // ever visits Settings to notice the toggle exists. Anyone who wants screenshots back
  // can still turn it off from Settings → Privacy & lock.
  const [blockScreenshots, setBlockScreenshotsState] = useState(false);
  const [autoBackup, setAutoBackupState] = useState(false);
  const [autoBackupFolderUri, setAutoBackupFolderUriState] = useState<string | null>(null);
  const [appLockHash, setAppLockHash] = useState<string | null>(null);
  // The stored preferences could not be read at all, so whether App Lock is on is unknown.
  // Treated as locked (fail closed): a failed read must never be what switches the lock off.
  const [lockUnreadable, setLockUnreadable] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      let readFailed = false;
      try {
        // Retried: a cold start's first read can lose a race with the migration burst, and
        // giving up on the first failure used to leave App Lock silently off.
        let rows: { key: string; value: string }[] | null = null;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 3 && rows === null; attempt += 1) {
          try {
            rows = await db.getAllAsync<{ key: string; value: string }>("SELECT key, value FROM app_preferences WHERE key IN ('language', 'themeMode', 'onboarded', 'reduceMotion', 'quietHours', 'appLockHash', 'timeFormat', 'weekStartsOn', 'reminderLeadMinutes', 'quickCaptureTile', 'blockScreenshots', 'autoBackup', 'autoBackupFolderUri', 'timeZone', 'textScale')");
          } catch (error) {
            lastError = error;
            if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          }
        }
        if (rows === null) { readFailed = true; throw lastError; }
        if (!active) return;
        let loadedTimeFormat: TimeFormat = '12';
        let loadedTimeZone: string = BANGLADESH_TIME_ZONE;
        for (const row of rows) {
          if (row.key === 'language' && (row.value === 'en' || row.value === 'bn')) setLanguageState(row.value);
          if (row.key === 'themeMode' && (row.value === 'light' || row.value === 'dark' || row.value === 'dim' || row.value === 'system')) setThemeSettingState(row.value);
          if (row.key === 'onboarded' && row.value === '1') setOnboarded(true);
          if (row.key === 'reduceMotion') setReduceMotionState(row.value === '1');
          if (row.key === 'textScale') { const v = Number(row.value); if ([0.9, 1, 1.1, 1.2].includes(v)) setTextScaleState(v); }
          if (row.key === 'quietHours') { const m = row.value.match(/^(\d{1,2}):(\d{1,2})$/u); if (m) setQuietHoursState({ start: Number(m[1]), end: Number(m[2]) }); }
          if (row.key === 'appLockHash' && row.value) setAppLockHash(row.value);
          if (row.key === 'timeFormat' && (row.value === '12' || row.value === '24')) { setTimeFormatState(row.value); loadedTimeFormat = row.value; }
          if (row.key === 'timeZone' && row.value) { setTimeZoneState(row.value); loadedTimeZone = row.value; }
          if (row.key === 'weekStartsOn' && (row.value === '0' || row.value === '1' || row.value === '6')) setWeekStartsOnState(Number(row.value) as WeekStart);
          if (row.key === 'reminderLeadMinutes') { const n = Number(row.value); if (Number.isFinite(n) && n >= 0) setReminderLeadMinutesState(n); }
          if (row.key === 'quickCaptureTile') setQuickCaptureTileState(row.value === '1');
          if (row.key === 'blockScreenshots') setBlockScreenshotsState(row.value === '1');
          if (row.key === 'autoBackup') setAutoBackupState(row.value === '1');
          if (row.key === 'autoBackupFolderUri') setAutoBackupFolderUriState(row.value || null);
        }
        setTimeFormatPreference(loadedTimeFormat);
        // Applied before the first screen paints — otherwise today's date is briefly read
        // in the wrong zone and the app disagrees with itself for a frame.
        setTimeZonePreference(loadedTimeZone);
        // No stored choice: stay Bengali. Reading the phone's language here meant a
        // Bengali user with an English phone met onboarding in English — the one screen
        // where being understood matters most. Settings still offers the phone's language.
      } catch {
        // Preferences are non-critical; safe defaults remain active — except the lock,
        // which stays shut until a read can say whether it is on (see verifyAppLockPin).
        if (active && readFailed) setLockUnreadable(true);
      } finally {
        if (active) setPrefsLoaded(true);
      }
    };
    void load();
    return () => { active = false; };
  }, [db]);

  // `system` hands control back to the OS ('unspecified'); an explicit pick forces it.
  // Wait for the stored value to load first, so a dark/system user doesn't get a white
  // flash from the `light` default being pushed to the OS on the first frame.
  useEffect(() => {
    if (!prefsLoaded) return;
    Appearance.setColorScheme(themeSetting === 'system' ? 'unspecified' : themeSetting === 'dim' ? 'dark' : themeSetting);
  }, [themeSetting, prefsLoaded]);

  // Keep the resolved scheme in step with the OS while on `system`.
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => setSystemScheme(colorScheme === 'dark' ? 'dark' : 'light'));
    return () => sub.remove();
  }, []);

  const persist = useCallback(async (key: string, value: string) => {
    await db.runAsync('INSERT INTO app_preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }, [db]);

  const setLanguage = useCallback(async (value: Language) => {
    const previous = language;
    setLanguageState(value);
    try {
      await persist('language', value);
    } catch {
      setLanguageState(previous);
    }
  }, [language, persist]);

  const setThemeMode = useCallback(async (value: ThemeSetting) => {
    const previous = themeSetting;
    setThemeSettingState(value);
    try {
      await persist('themeMode', value);
    } catch {
      setThemeSettingState(previous);
    }
  }, [persist, themeSetting]);

  const completeOnboarding = useCallback(async () => {
    setOnboarded(true);
    try { await persist('onboarded', '1'); } catch { setOnboarded(false); }
  }, [persist]);

  const setReduceMotion = useCallback(async (v: boolean) => {
    const prev = reduceMotion; setReduceMotionState(v);
    try { await persist('reduceMotion', v ? '1' : '0'); } catch { setReduceMotionState(prev); }
  }, [persist, reduceMotion]);

  const setTextScale = useCallback(async (v: number) => {
    const prev = textScale; setTextScaleState(v);
    try { await persist('textScale', String(v)); } catch { setTextScaleState(prev); }
  }, [persist, textScale]);

  const setQuietHours = useCallback(async (v: QuietHours | null) => {
    const prev = quietHours; setQuietHoursState(v);
    try { await persist('quietHours', v ? `${v.start}:${v.end}` : ''); } catch { setQuietHoursState(prev); }
  }, [persist, quietHours]);

  const setTimeFormat = useCallback(async (v: TimeFormat) => {
    const prev = timeFormat; setTimeFormatState(v); setTimeFormatPreference(v);
    try { await persist('timeFormat', v); } catch { setTimeFormatState(prev); setTimeFormatPreference(prev); }
  }, [persist, timeFormat]);

  const setTimeZone = useCallback(async (v: string) => {
    const prev = timeZone; setTimeZoneState(v); setTimeZonePreference(v);
    try { await persist('timeZone', v); } catch { setTimeZoneState(prev); setTimeZonePreference(prev); }
  }, [persist, timeZone]);

  const setWeekStartsOn = useCallback(async (v: WeekStart) => {
    const prev = weekStartsOn; setWeekStartsOnState(v);
    try { await persist('weekStartsOn', String(v)); } catch { setWeekStartsOnState(prev); }
  }, [persist, weekStartsOn]);

  const setReminderLeadMinutes = useCallback(async (v: number) => {
    const prev = reminderLeadMinutes; setReminderLeadMinutesState(v);
    try { await persist('reminderLeadMinutes', String(v)); } catch { setReminderLeadMinutesState(prev); }
  }, [persist, reminderLeadMinutes]);

  const setQuickCaptureTile = useCallback(async (v: boolean) => {
    const prev = quickCaptureTile; setQuickCaptureTileState(v);
    try { await persist('quickCaptureTile', v ? '1' : '0'); } catch { setQuickCaptureTileState(prev); }
  }, [persist, quickCaptureTile]);

  // Off by default: a ledger is private, but so is the freedom to screenshot your own
  // records and send them to the person you are settling with.
  const setBlockScreenshots = useCallback(async (v: boolean) => {
    const prev = blockScreenshots; setBlockScreenshotsState(v);
    try { await persist('blockScreenshots', v ? '1' : '0'); } catch { setBlockScreenshotsState(prev); }
  }, [persist, blockScreenshots]);

  const setAutoBackup = useCallback(async (v: boolean) => {
    const prev = autoBackup; setAutoBackupState(v);
    try { await persist('autoBackup', v ? '1' : '0'); } catch { setAutoBackupState(prev); }
  }, [persist, autoBackup]);

  const setAutoBackupFolderUri = useCallback(async (v: string | null) => {
    const prev = autoBackupFolderUri; setAutoBackupFolderUriState(v);
    try { await persist('autoBackupFolderUri', v ?? ''); } catch { setAutoBackupFolderUriState(prev); }
  }, [persist, autoBackupFolderUri]);

  const applyDeviceLanguage = useCallback(async () => { await setLanguage(deviceLanguage()); }, [setLanguage]);

  const setAppLockPin = useCallback(async (pin: string | null) => {
    const next = pin ? await pinDigest(pin) : null;
    const prev = appLockHash; setAppLockHash(next);
    try { await persist('appLockHash', next ?? ''); setLockUnreadable(false); } catch { setAppLockHash(prev); }
  }, [persist, appLockHash]);
  // A correct PIN stored under the retired digest is re-derived and rewritten in place, so
  // the weak hash disappears from the database the first time it is actually used.
  const verifyAppLockPin = useCallback(async (pin: string) => {
    if (appLockHash === null) {
      if (!lockUnreadable) return false;
      // The start-up read failed; try once more now. No lock stored after all → let the
      // person in (first-run behaviour); a lock stored → check the PIN against it.
      try {
        const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_preferences WHERE key = 'appLockHash'");
        setLockUnreadable(false);
        if (!row?.value) return true;
        setAppLockHash(row.value);
        return pinMatches(pin, row.value);
      } catch {
        return false;
      }
    }
    if (!(await pinMatches(pin, appLockHash))) return false;
    if (isLegacyDigest(appLockHash)) {
      const upgraded = await pinDigest(pin);
      setAppLockHash(upgraded);
      void persist('appLockHash', upgraded).catch(() => setAppLockHash(appLockHash));
    }
    return true;
  }, [appLockHash, persist, lockUnreadable, db]);

  const colors = useMemo(() => getThemeColors(themeMode), [themeMode]);
  const accents = useMemo(() => getThemeAccents(themeMode), [themeMode]);
  const glass = useMemo(() => getGlassTokens(themeMode), [themeMode]);
  const value = useMemo(() => ({ language, themeMode, themeSetting, colors, accents, glass, onboarded, prefsLoaded, reduceMotion, textScale, setTextScale, quietHours, timeFormat, weekStartsOn, reminderLeadMinutes, quickCaptureTile, blockScreenshots, autoBackup, autoBackupFolderUri, appLockEnabled: appLockHash !== null || lockUnreadable, setLanguage, setThemeMode, setReduceMotion, setQuietHours, setTimeFormat, timeZone, setTimeZone, setWeekStartsOn, setReminderLeadMinutes, setQuickCaptureTile, setBlockScreenshots, setAutoBackup, setAutoBackupFolderUri, setAppLockPin, verifyAppLockPin, applyDeviceLanguage, completeOnboarding }), [language, themeMode, themeSetting, colors, accents, glass, onboarded, prefsLoaded, reduceMotion, textScale, setTextScale, quietHours, timeFormat, weekStartsOn, reminderLeadMinutes, quickCaptureTile, blockScreenshots, autoBackup, autoBackupFolderUri, appLockHash, lockUnreadable, setLanguage, setThemeMode, setReduceMotion, setQuietHours, setTimeFormat, timeZone, setTimeZone, setWeekStartsOn, setReminderLeadMinutes, setQuickCaptureTile, setBlockScreenshots, setAutoBackup, setAutoBackupFolderUri, setAppLockPin, verifyAppLockPin, applyDeviceLanguage, completeOnboarding]);
  return <PreferencesContext.Provider value={value}><TextScaleContext.Provider value={textScale}>{children}</TextScaleContext.Provider></PreferencesContext.Provider>;
}

export function useAppPreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('useAppPreferences must be used inside AppPreferencesProvider');
  return context;
}
