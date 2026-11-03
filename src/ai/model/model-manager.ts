// User-facing "add your own AI model" manager.
//
// Flow, no developer steps:
//   1. pickAndImportModel()  – user chooses a .gguf file from phone storage; we copy
//      it into the app's private folder and read its header.
//   2. verifyModel()         – staged checks, each with a plain-language result.
//   3. the on-device-llm engine picks it up automatically once every check passes
//      (real generation still needs a build that includes the native runtime).
//
// Nothing is downloaded and nothing leaves the device.

import type { SQLiteDatabase } from 'expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import * as LegacyFS from 'expo-file-system/legacy';
import * as Device from 'expo-device';
import { base64ToBytes } from '../../services/backup-archive-service';
import { isArchitectureSupported, parseGgufHeader, summarizeGguf, type GgufSummary } from './gguf';
import { calibrateSpeed, probeRuntime, releaseLlama, smokeTest } from './llama-runtime';
import { loadProfile, speedLine } from './device-profile';
import { maxModelSizeForRam, type PhoneFacts } from './model-catalog';
import { asciiDigitsToBengali as bnd } from '../../services/debt/money';

const PREF_KEY = 'aiModel';
const MODEL_DIR = `${LegacyFS.documentDirectory}ai-models/`;
const HEADER_READ_BYTES = 3 * 1024 * 1024; // 3 MiB — comfortably covers the metadata block.

export interface InstalledModel {
  path: string;
  name: string;
  sizeBytes: number;
  importedAt: string;
  summary: GgufSummary;
  headerTruncated: boolean;
  verifiedAt?: string;
  lastReport?: VerifyReport;
  /**
   * The vision projector that lets this model look at a photograph.
   *
   * Separate and optional because it is a separate file — a multimodal model ships as a
   * pair, the weights and an `mmproj` projector, and a text-only model has no second half.
   * Everything the assistant does works without it; only reading a picture needs it.
   */
  mmprojPath?: string;
  mmprojName?: string;
  /**
   * The Assistant connection test: the Assistant's own answer-writing path, run end to end
   * on this model. Only a pass lets the model serve the Assistant — "it loads" (the verify
   * steps) is not the same as "the Assistant can use it". Cleared by every re-verify.
   */
  connectionTest?: { ok: boolean; at: string; ms: number; sample?: string; fallback?: string };
}

/** Store the Assistant connection test's outcome on the installed model. */
export async function saveConnectionTest(db: SQLiteDatabase, result: NonNullable<InstalledModel['connectionTest']>): Promise<InstalledModel | null> {
  const model = await loadInstalledModel(db);
  if (!model) return null;
  const next = { ...model, connectionTest: result };
  await save(db, next);
  return next;
}

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface VerifyStep {
  id: 'file' | 'container' | 'architecture' | 'quantization' | 'memory' | 'inference' | 'speed';
  label: { bn: string; en: string };
  status: CheckStatus;
  detail: { bn: string; en: string };
}

export interface VerifyReport {
  ok: boolean;
  ranAt: string;
  steps: VerifyStep[];
  /** Present when the inference step actually ran a model. */
  sample?: string;
}

async function ensureDir(): Promise<void> {
  const info = await LegacyFS.getInfoAsync(MODEL_DIR);
  if (!info.exists) await LegacyFS.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
}

async function readHeadBytes(uri: string, length: number): Promise<Uint8Array> {
  // position/length keeps this cheap for multi-GB files. Length is a multiple of 3
  // so the base64 slice has no padding and decodes cleanly.
  const safeLen = length - (length % 3);
  const b64 = await LegacyFS.readAsStringAsync(uri, {
    encoding: LegacyFS.EncodingType.Base64,
    position: 0,
    length: safeLen,
  });
  return base64ToBytes(b64);
}

export async function loadInstalledModel(db: SQLiteDatabase): Promise<InstalledModel | null> {
  try {
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_preferences WHERE key = ?', PREF_KEY,
    );
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as InstalledModel;
    const info = await LegacyFS.getInfoAsync(parsed.path);
    if (!info.exists) { await db.runAsync('DELETE FROM app_preferences WHERE key = ?', PREF_KEY); return null; }
    return parsed;
  } catch {
    return null;
  }
}

async function save(db: SQLiteDatabase, model: InstalledModel): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO app_preferences (key, value) VALUES (?, ?)',
    PREF_KEY, JSON.stringify(model),
  );
}

export async function removeModel(db: SQLiteDatabase): Promise<void> {
  // The warm context is keyed by path: let it go first, or the removed model stays loaded.
  await releaseLlama();
  const existing = await loadInstalledModel(db);
  if (existing) { try { await LegacyFS.deleteAsync(existing.path, { idempotent: true }); } catch { /* noop */ } }
  await db.runAsync('DELETE FROM app_preferences WHERE key = ?', PREF_KEY);
}

export class ModelImportError extends Error {}

/** Opens the system file picker, copies the chosen .gguf in, reads its header, persists it. */
export async function pickAndImportModel(db: SQLiteDatabase, language: 'bn' | 'en' = 'bn'): Promise<InstalledModel | null> {
  const L = (bn: string, en: string) => (language === 'bn' ? bn : en);
  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (!asset?.uri) throw new ModelImportError(L('ফাইলটি খোলা গেল না।', 'Could not open the file.'));

  const looksGguf = asset.name?.toLowerCase().endsWith('.gguf') ?? false;
  const pickedInfo = await LegacyFS.getInfoAsync(asset.uri);
  const size = asset.size ?? (pickedInfo.exists ? pickedInfo.size : 0) ?? 0;
  if (size > 0 && size < 1024 * 1024) {
    throw new ModelImportError(L('ফাইলটি খুব ছোট — এটি কোনো মডেল ফাইল বলে মনে হচ্ছে না।', 'The file is too small to be a model.'));
  }

  // Don't start a multi-GB copy that can't finish.
  const free = await LegacyFS.getFreeDiskStorageAsync().catch(() => null);
  if (free != null && size > 0 && free < size * 1.1) {
    throw new ModelImportError(L('ফোনে যথেষ্ট খালি জায়গা নেই — কিছু জায়গা খালি করে আবার চেষ্টা করুন।', 'Not enough free storage on the phone — free up some space and try again.'));
  }

  // Peek the header before committing a multi-GB copy.
  let head: Uint8Array;
  try {
    head = await readHeadBytes(asset.uri, HEADER_READ_BYTES);
  } catch {
    throw new ModelImportError(L('ফাইলটি পড়া গেল না। আবার চেষ্টা করুন বা অন্য ফাইল বেছে নিন।', 'Could not read the file. Try again or pick another one.'));
  }
  const header = parseGgufHeader(head);
  if (!header) {
    throw new ModelImportError(
      looksGguf
        ? L('ফাইলের নাম .gguf, কিন্তু ভেতরটা ঠিক নেই — ডাউনলোডটি সম্ভবত অসম্পূর্ণ। আবার নামান।', 'The name ends in .gguf, but the file is not whole — the download is likely incomplete. Download it again.')
        : L('এটি AI মডেল ফাইল নয়। নামের শেষে .gguf লেখা ফাইল বেছে নিন।', 'This is not an AI model file. Pick a file whose name ends in .gguf.'),
    );
  }

  await ensureDir();
  const safeName = (asset.name ?? 'model.gguf').replace(/[^\w.\-]+/g, '_');
  const destPath = `${MODEL_DIR}${safeName}`;
  // Same name, same path: without this the old file's loaded context kept answering.
  await releaseLlama();
  try {
    await LegacyFS.deleteAsync(destPath, { idempotent: true });
    await LegacyFS.copyAsync({ from: asset.uri, to: destPath });
  } catch {
    throw new ModelImportError(L('মডেলটি অ্যাপে কপি করা গেল না — স্টোরেজে জায়গা আছে কিনা দেখুন।', 'Could not copy the model into the app — check that there is free storage.'));
  }
  // The picker already copied the file into the cache; drop that copy now that it is
  // safely in the app's model folder, so a big model isn't stored twice.
  void LegacyFS.deleteAsync(asset.uri, { idempotent: true }).catch(() => {});
  const finalInfo = await LegacyFS.getInfoAsync(destPath);

  const model: InstalledModel = {
    path: destPath,
    name: asset.name ?? safeName,
    sizeBytes: finalInfo.exists ? (finalInfo.size ?? size) : size,
    importedAt: new Date().toISOString(),
    summary: summarizeGguf(header),
    headerTruncated: header.truncated,
  };
  await save(db, model);
  return model;
}

/**
 * Add the vision half to an already-installed model.
 *
 * Checked far more lightly than the model itself: it is the same GGUF container, but
 * whether a given projector actually matches a given model is something only the runtime
 * can answer, and it answers it at the first photograph rather than here. Refusing a valid
 * pair on a guess would be worse than letting the real attempt report the real error.
 */
export async function pickAndImportMmproj(db: SQLiteDatabase, language: 'bn' | 'en' = 'bn'): Promise<InstalledModel | null> {
  const L = (bn: string, en: string) => (language === 'bn' ? bn : en);
  const model = await loadInstalledModel(db);
  if (!model) throw new ModelImportError(L('আগে মূল মডেল ফাইলটি যোগ করুন।', 'Add the main model file first.'));

  const picked = await DocumentPicker.getDocumentAsync({
    type: ['application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (!asset?.uri) throw new ModelImportError(L('ফাইলটি খোলা গেল না।', 'Could not open the file.'));

  let head: Uint8Array;
  try {
    head = await readHeadBytes(asset.uri, HEADER_READ_BYTES);
  } catch {
    throw new ModelImportError(L('ফাইলটি পড়া গেল না।', 'Could not read the file.'));
  }
  if (!parseGgufHeader(head)) {
    throw new ModelImportError(L('এটি GGUF ফাইল নয়। মডেলের সাথের mmproj ফাইলটি বেছে নিন।', 'This is not a GGUF file. Pick the model’s mmproj file.'));
  }

  await ensureDir();
  const safeName = (asset.name ?? 'mmproj.gguf').replace(/[^\w.\-]+/g, '_');
  const destPath = `${MODEL_DIR}mmproj-${safeName}`;
  try {
    if (model.mmprojPath) await LegacyFS.deleteAsync(model.mmprojPath, { idempotent: true });
    await LegacyFS.deleteAsync(destPath, { idempotent: true });
    await LegacyFS.copyAsync({ from: asset.uri, to: destPath });
  } catch {
    throw new ModelImportError(L('ফাইলটি অ্যাপে কপি করা গেল না।', 'Could not copy the file into the app.'));
  }
  void LegacyFS.deleteAsync(asset.uri, { idempotent: true }).catch(() => {});

  const next: InstalledModel = { ...model, mmprojPath: destPath, mmprojName: asset.name ?? safeName };
  await save(db, next);
  return next;
}

/** Drop the vision half, keeping the model itself installed and verified. */
export async function removeMmproj(db: SQLiteDatabase): Promise<InstalledModel | null> {
  const model = await loadInstalledModel(db);
  if (!model?.mmprojPath) return model;
  try { await LegacyFS.deleteAsync(model.mmprojPath, { idempotent: true }); } catch { /* noop */ }
  const next: InstalledModel = { ...model };
  delete next.mmprojPath;
  delete next.mmprojName;
  await save(db, next);
  return next;
}

// The phone check (D5). Free RAM cannot be read portably, so the model is held to a
// conservative share of the total — 40%, not the 55% this used to assume, which left
// SQLite starved (NF-06). Below 4 GB the AI is not offered at all. The formula lives in
// model-catalog so the offered list and this check can never disagree.
function totalRamMB(): number | null {
  let total: number | null = null;
  try { total = Device.totalMemory ?? null; } catch { total = null; }
  if (!total || !Number.isFinite(total)) return null;
  return Math.round(total / (1024 * 1024));
}

/** Largest model file (MB) this phone may run, or 0 when it should not run one at all. */
export function maxModelSizeMB(): number | null {
  const total = totalRamMB();
  if (total == null) return null;
  return maxModelSizeForRam(total);
}

/** This phone's facts for `recommendModels` — read fresh, nothing assumed. */
export async function readPhoneFacts(): Promise<PhoneFacts> {
  let freeDiskMB: number | null = null;
  try { freeDiskMB = Math.round((await LegacyFS.getFreeDiskStorageAsync()) / (1024 * 1024)); } catch { freeDiskMB = null; }
  let arm64 = true;
  try { arm64 = (Device.supportedCpuArchitectures ?? ['arm64-v8a']).some((a) => a.startsWith('arm64')); } catch { arm64 = true; }
  let yearClass: number | null = null;
  try { yearClass = Device.deviceYearClass ?? null; } catch { yearClass = null; }
  return { totalRamMB: totalRamMB(), freeDiskMB, arm64, yearClass };
}

const T = (bn: string, en: string) => ({ bn, en });

/** Runs the staged verification and stores the report on the model record. */
export async function verifyModel(db: SQLiteDatabase, model: InstalledModel): Promise<VerifyReport> {
  const steps: VerifyStep[] = [];

  // 1. File present and readable.
  const info = await LegacyFS.getInfoAsync(model.path);
  if (!info.exists) {
    steps.push({ id: 'file', label: T('ফাইল', 'File'), status: 'fail', detail: T('মডেল ফাইলটি আর খুঁজে পাওয়া যাচ্ছে না। আবার যোগ করুন।', 'The model file is missing. Add it again.') });
    const report: VerifyReport = { ok: false, ranAt: new Date().toISOString(), steps };
    await save(db, { ...model, lastReport: report });
    return report;
  }
  const sizeMB = Math.round((info.size ?? model.sizeBytes) / (1024 * 1024));
  steps.push({ id: 'file', label: T('ফাইল', 'File'), status: 'pass', detail: T(`পড়া যাচ্ছে — ${bnd(String(sizeMB))} MB।`, `Readable — ${sizeMB} MB.`) });

  // 2. Valid GGUF container (re-read the head; catches a truncated download).
  let summary = model.summary;
  try {
    const header = parseGgufHeader(await readHeadBytes(model.path, HEADER_READ_BYTES));
    if (!header) {
      steps.push({ id: 'container', label: T('ফাইল ঠিক আছে কি না', 'Is the file whole'), status: 'fail', detail: T('ফাইলটি ঠিক নেই — ডাউনলোডটি সম্ভবত অসম্পূর্ণ। পুরো ফাইলটি আবার নামান।', 'The file is not whole — the download is likely incomplete. Download the whole file again.') });
      const report: VerifyReport = { ok: false, ranAt: new Date().toISOString(), steps };
      await save(db, { ...model, lastReport: report });
      return report;
    }
    summary = summarizeGguf(header);
    steps.push({ id: 'container', label: T('ফাইল ঠিক আছে কি না', 'Is the file whole'), status: 'pass', detail: T(`ঠিক আছে${summary.name ? ` · ${summary.name}` : ''}।`, `Fine${summary.name ? ` · ${summary.name}` : ''}.`) });
  } catch {
    steps.push({ id: 'container', label: T('ফাইল ঠিক আছে কি না', 'Is the file whole'), status: 'fail', detail: T('ফাইলের শুরুটা পড়া গেল না।', 'Could not read the start of the file.') });
    const report: VerifyReport = { ok: false, ranAt: new Date().toISOString(), steps };
    await save(db, { ...model, lastReport: report });
    return report;
  }

  // 3. Architecture the runtime understands.
  if (isArchitectureSupported(summary.architecture)) {
    steps.push({ id: 'architecture', label: T('মডেলের ধরন', 'Model type'), status: 'pass', detail: T(`${summary.architecture} — এই ধরন চলে।`, `${summary.architecture} — this type runs.`) });
  } else {
    steps.push({ id: 'architecture', label: T('মডেলের ধরন', 'Model type'), status: 'warn', detail: T(`${summary.architecture ?? 'অজানা'} — এটি চেনা তালিকায় নেই; চলতে পারে, না-ও পারে।`, `${summary.architecture ?? 'unknown'} — not in the known list; it may or may not run.`) });
  }

  // 4. Mobile-friendly quantisation.
  if (summary.quantIsMobileFriendly) {
    steps.push({ id: 'quantization', label: T('মান', 'Quality level'), status: 'pass', detail: T(`${summary.quantLabel} — ফোনের জন্য ঠিক আছে।`, `${summary.quantLabel} — fine for a phone.`) });
  } else {
    steps.push({ id: 'quantization', label: T('মান', 'Quality level'), status: 'warn', detail: T(`${summary.quantLabel} — এটি বড় ও ধীর হবে। Q4_K_M সংস্করণ নামানো ভালো।`, `${summary.quantLabel} — this will be large and slow. Prefer a Q4_K_M build.`) });
  }

  // 5. RAM headroom.
  // A 'fail' here is a real stop: the test run below is skipped (loading a model that
  // does not fit is exactly what kills the app) and the model is not marked ready.
  const total = totalRamMB();
  const maxMB = maxModelSizeMB();
  const fileMB = Math.round((info.size ?? model.sizeBytes) / (1024 * 1024));
  let ramBlocked = false;
  if (total == null || maxMB == null) {
    steps.push({ id: 'memory', label: T('ফোনের RAM-এ চলবে কি না', 'Does it fit the phone’s RAM'), status: 'skip', detail: T('এই ফোনের RAM পড়া গেল না — সাবধানে চালিয়ে দেখুন।', 'Could not read this phone’s RAM — try it with care.') });
  } else if (maxMB === 0) {
    ramBlocked = true;
    steps.push({ id: 'memory', label: T('ফোনের RAM-এ চলবে কি না', 'Does it fit the phone’s RAM'), status: 'fail', detail: T(`এই ফোনে RAM ~${bnd((total / 1024).toFixed(1))} GB — AI নিরাপদে চালাতে অন্তত ৪ GB লাগে। আপন সাধারণ মোডে ঠিকঠাক চলবে।`, `This phone has ~${(total / 1024).toFixed(1)} GB RAM — the AI needs at least 4 GB to run safely. The Assistant works normally without it.`) });
  } else if (fileMB <= maxMB) {
    steps.push({ id: 'memory', label: T('ফোনের RAM-এ চলবে কি না', 'Does it fit the phone’s RAM'), status: 'pass', detail: T(`মডেল ${bnd(String(fileMB))} MB — এই ফোনে সর্বোচ্চ ~${bnd(String(maxMB))} MB চলবে।`, `Model is ${fileMB} MB — this phone can run up to ~${maxMB} MB.`) });
  } else {
    ramBlocked = true;
    steps.push({ id: 'memory', label: T('ফোনের RAM-এ চলবে কি না', 'Does it fit the phone’s RAM'), status: 'fail', detail: T(`মডেল ${bnd(String(fileMB))} MB, কিন্তু এই ফোনে নিরাপদে চলবে সর্বোচ্চ ~${bnd(String(maxMB))} MB। এর চেয়ে ছোট মডেল নিন (১–২ GB-এর মতো)।`, `Model is ${fileMB} MB, but this phone can safely run at most ~${maxMB} MB. Pick a smaller model (around 1–2 GB).`) });
  }

  // 6. Real inference — only when a native runtime is in this build.
  const probe = probeRuntime();
  let sample: string | undefined;
  if (ramBlocked) {
    steps.push({ id: 'inference', label: T('চালিয়ে দেখা', 'Trying it out'), status: 'skip', detail: T('ফোন-পরীক্ষায় আটকে যাওয়ায় চালানো হয়নি — চালালে অ্যাপ বন্ধ হয়ে যেতে পারত।', 'Not run because the phone check failed — running it could have closed the app.') });
  } else if (!probe.available) {
    steps.push({
      id: 'inference',
      label: T('চালিয়ে দেখা', 'Trying it out'),
      status: 'skip',
      detail: T(
        'এই ফোনে AI চালানো যায় না — আপন AI ছাড়াই সব কাজ ঠিকঠাক করবে।',
        'AI cannot run on this phone — Apon does everything fine without it.',
      ),
    });
  } else {
    const smoke = await smokeTest(model.path, summary.contextLength);
    if (smoke.ok) {
      sample = smoke.sample;
      steps.push({ id: 'inference', label: T('চালিয়ে দেখা', 'Trying it out'), status: 'pass', detail: T(`মডেল চলল (${bnd(String(smoke.elapsedMs))} মি.সে.)। নমুনা: "${smoke.sample}"`, `Model ran (${smoke.elapsedMs} ms). Sample: "${smoke.sample}"`) });
      // This phone's own speed, measured once, so answers fit it (device-profile.ts).
      const speed = await calibrateSpeed(model.path).catch(() => null);
      const profile = loadProfile();
      const lineBn = speed ? speedLine(profile, true) : null;
      const lineEn = speed ? speedLine(profile, false) : null;
      steps.push(lineBn && lineEn
        ? { id: 'speed', label: T('ফোনের গতি মাপা', 'Phone speed'), status: 'pass', detail: T(lineBn, lineEn) }
        : { id: 'speed', label: T('ফোনের গতি মাপা', 'Phone speed'), status: 'skip', detail: T('গতি মাপা গেল না — সাধারণ সেটিংয়ে চলবে।', 'Could not measure — default settings are used.') });
    } else {
      steps.push({ id: 'inference', label: T('চালিয়ে দেখা', 'Trying it out'), status: 'fail', detail: T(smoke.reason ?? 'অজানা কারণে চলল না।', smoke.reason ?? 'Failed for an unknown reason.') });
    }
  }

  const ok = steps.every((s) => s.status === 'pass' || s.status === 'warn' || s.status === 'skip')
    && steps.some((s) => s.id === 'container' && s.status === 'pass');
  const report: VerifyReport = { ok, ranAt: new Date().toISOString(), steps, sample };
  // A failed re-check withdraws an earlier pass — keeping the old `verifiedAt` meant a
  // model that no longer fits stayed "ready" and the Assistant kept loading it.
  await save(db, { ...model, summary, verifiedAt: ok ? report.ranAt : undefined, lastReport: report, connectionTest: undefined });
  return report;
}

export { probeRuntime };
