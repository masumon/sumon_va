// This phone, measured once — so the local AI runs as well as this phone allows.
//
// (The user's request for 1.0: "যে ফোনে যে রকম র‌্যাম রম সিপিউ স্পিড থাকবে সে অনুযায়ী
// সর্বোচ্চ কাজ করবে".) Android does not tell an app how many fast cores it has or how busy
// they are, so the phone is measured instead: during "যাচাই" the model writes a few words
// with 4 and with 6 threads, the faster is kept, and its speed sets how long answers are and
// how long আপন waits. The faster memory options (flash attention, compressed cache) are tried
// once; if the app is closed during that try, they are never tried on this phone again.
// Kept in a small file on the phone — never in the database, never shared.

export type SpeedTier = 'fast' | 'medium' | 'slow';
export type FastOptions = 'untested' | 'trying' | 'ok' | 'off';

export interface DeviceProfile {
  threads: number | null;
  tokensPerSecond: number | null;
  tier: SpeedTier | null;
  fastOptions: FastOptions;
  at: string | null;
}

const EMPTY: DeviceProfile = { threads: null, tokensPerSecond: null, tier: null, fastOptions: 'untested', at: null };

type StoredFile = { exists: boolean; create(o?: { overwrite?: boolean }): void; write(s: string): void; textSync(): string };
function profileFile(): StoredFile | null {
  try {
    // Lazily: the web/jest project has no native file module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require('expo-file-system') as { File: new (dir: unknown, name: string) => StoredFile; Paths: { document: unknown } };
    return new File(Paths.document, 'ai-device-profile.json');
  } catch { return null; }
}

let cached: DeviceProfile | null = null;

export function loadProfile(): DeviceProfile {
  if (cached) return cached;
  try {
    const f = profileFile();
    cached = f?.exists ? { ...EMPTY, ...(JSON.parse(f.textSync()) as Partial<DeviceProfile>) } : { ...EMPTY };
  } catch { cached = { ...EMPTY }; }
  return cached;
}

export function saveProfile(next: Partial<DeviceProfile>): DeviceProfile {
  cached = { ...loadProfile(), ...next };
  try { const f = profileFile(); f?.create({ overwrite: true }); f?.write(JSON.stringify(cached)); } catch { /* best-effort */ }
  return cached;
}

/** For tests: start from a clean profile. */
export function resetProfileCache(p: DeviceProfile | null = null): void { cached = p; }

export function tierFor(tokensPerSecond: number): SpeedTier {
  return tokensPerSecond >= 6 ? 'fast' : tokensPerSecond >= 2.5 ? 'medium' : 'slow';
}

// ── while it runs ──────────────────────────────────────────────────────────────────────
// A phone that suddenly writes at half its measured speed is hot or busy: for ten minutes
// answers are kept shorter, so the person is not left waiting.
let throttledUntil = 0;
export function noteLiveSpeed(tokensPerSecond: number | undefined, now = Date.now()): void {
  const measured = loadProfile().tokensPerSecond;
  if (measured && tokensPerSecond && tokensPerSecond < measured * 0.5) throttledUntil = now + 10 * 60_000;
}
export function isThrottled(now = Date.now()): boolean { return now < throttledUntil; }

/** How much of an answer, and how long to wait, on this phone right now. */
export function generationScale(profile: DeviceProfile = loadProfile(), now = Date.now()): { tokens: number; timeout: number } {
  const base = profile.tier === 'slow' ? { tokens: 0.6, timeout: 1.8 } : profile.tier === 'medium' ? { tokens: 0.8, timeout: 1.3 } : { tokens: 1, timeout: 1 };
  return isThrottled(now) ? { tokens: Math.max(0.4, base.tokens * 0.7), timeout: base.timeout * 1.2 } : base;
}
export function scaledTokens(n: number): number { return Math.max(16, Math.round(n * generationScale().tokens)); }
export function scaledTimeout(ms: number): number { return Math.round(ms * generationScale().timeout); }

/** Keep the model ready longer where memory allows; give it back quickly where it does not. */
export function idleReleaseMs(totalRamBytes: number | null): number {
  const gb = totalRamBytes ? totalRamBytes / 1024 ** 3 : null;
  // Unknown RAM keeps the long-standing two minutes.
  if (gb === null) return 120_000;
  return gb > 6 ? 300_000 : gb > 4 ? 120_000 : 45_000;
}

/**
 * The faster memory options for the next load, tried safely: "trying" is written before the
 * load and replaced after it; finding it still "trying" means the app was closed mid-load,
 * so they are switched off for this phone for good.
 */
export function fastLoadOptions(): Record<string, unknown> {
  const p = loadProfile();
  if (p.fastOptions === 'trying') { saveProfile({ fastOptions: 'off' }); return {}; }
  if (p.fastOptions === 'off') return {};
  if (p.fastOptions === 'untested') saveProfile({ fastOptions: 'trying' });
  return { flash_attn: true, cache_type_k: 'q8_0', cache_type_v: 'q8_0' };
}
export function fastLoadWorked(worked: boolean): void {
  const p = loadProfile();
  if (p.fastOptions === 'trying' || (p.fastOptions === 'ok' && !worked)) saveProfile({ fastOptions: worked ? 'ok' : 'off' });
}

/** The measured threads, if any, as a load option. */
export function threadOptions(): Record<string, unknown> {
  const t = loadProfile().threads;
  return t ? { n_threads: t } : {};
}

// ── advice ─────────────────────────────────────────────────────────────────────────────

/** Which model suits this phone, in plain words, from its RAM and free space. */
export function modelAdvice(totalRamBytes: number | null, freeBytes: number | null, bn: boolean): string[] {
  const gb = totalRamBytes ? totalRamBytes / 1024 ** 3 : null;
  const freeGb = freeBytes !== null ? freeBytes / 1024 ** 3 : null;
  const lines: string[] = [];
  if (gb === null) lines.push(bn ? 'এই ফোনের RAM পড়া গেল না — ছোট মডেল (১–২B, Q4_K_M) দিয়ে শুরু করুন।' : 'This phone’s RAM could not be read — start with a small model (1–2B, Q4_K_M).');
  else if (gb < 4) lines.push(bn ? `RAM ~${gb.toFixed(1)} GB — এই ফোনে AI মডেল না চালানোই ভালো; আপন AI ছাড়াও সব কাজ করে।` : `RAM ~${gb.toFixed(1)} GB — better not to run an AI model here; আপন does everything without it.`);
  else if (gb < 6) lines.push(bn ? `RAM ~${gb.toFixed(1)} GB — ১–২B মডেল, Q4_K_M (ফাইল ~১–১.৫ GB) সবচেয়ে ভালো চলবে।` : `RAM ~${gb.toFixed(1)} GB — a 1–2B model, Q4_K_M (~1–1.5 GB file) runs best.`);
  else if (gb < 10) lines.push(bn ? `RAM ~${gb.toFixed(1)} GB — ৩–৪B মডেল, Q4_K_M (ফাইল ~২–২.৫ GB) ভালো চলবে।` : `RAM ~${gb.toFixed(1)} GB — a 3–4B model, Q4_K_M (~2–2.5 GB file) runs well.`);
  else lines.push(bn ? `RAM ~${gb.toFixed(1)} GB — ৭–৮B পর্যন্ত মডেল (Q4_K_M, ফাইল ~৪–৫ GB) চলবে।` : `RAM ~${gb.toFixed(1)} GB — models up to 7–8B (Q4_K_M, ~4–5 GB file) will run.`);
  if (freeGb !== null && freeGb < 3) lines.push(bn ? `ফোনে খালি জায়গা মাত্র ~${freeGb.toFixed(1)} GB — মডেল যোগের আগে কিছু জায়গা খালি করুন।` : `Only ~${freeGb.toFixed(1)} GB free — make some room before adding a model.`);
  return lines;
}

/** The measured result, in words, for the AI model page. */
export function speedLine(profile: DeviceProfile, bn: boolean): string | null {
  if (!profile.tier || !profile.tokensPerSecond) return null;
  const tps = profile.tokensPerSecond.toFixed(1);
  const word = profile.tier === 'fast' ? (bn ? 'দ্রুত' : 'fast') : profile.tier === 'medium' ? (bn ? 'মাঝারি' : 'medium') : (bn ? 'ধীর' : 'slow');
  return bn
    ? `আপনার ফোনে AI: ${word} (সেকেন্ডে ~${tps} শব্দাংশ${profile.threads ? `, ${profile.threads}টি প্রসেসর-অংশ` : ''})। ${profile.tier === 'slow' ? 'উত্তর ছোট রাখা হবে, অপেক্ষা একটু বেশি।' : profile.tier === 'medium' ? 'উত্তর মাঝারি দৈর্ঘ্যের।' : 'পূর্ণ উত্তর দেওয়া হবে।'}`
    : `AI on this phone: ${word} (~${tps} tokens/s${profile.threads ? `, ${profile.threads} threads` : ''}). ${profile.tier === 'slow' ? 'Answers are kept short; waits are a little longer.' : profile.tier === 'medium' ? 'Answers are medium length.' : 'Full answers.'}`;
}
