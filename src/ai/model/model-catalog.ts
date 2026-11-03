// Which on-device AI models to offer, decided per phone.
//
// Two separate things live here on purpose. The catalogue is data: models that exist, with
// their real sizes and direct download links (each checked with an HTTP HEAD on 2026-09-18
// — status 200, size as listed). It has to ship inside the app because the app itself never
// goes online. The *choice* — what a given phone is shown, and which one gets the star — is
// never fixed: `recommendModels` works it out from that phone's own RAM, free space and CPU.

export type BengaliQuality = 'good' | 'ok' | 'weak';

export interface CatalogModel {
  id: string;
  name: string;
  /** One plain line, no jargon — what a non-technical person needs to choose. */
  blurb: { bn: string; en: string };
  sizeMB: number;
  url: string;
  bengali: BengaliQuality;
  /** Passed the Assistant connection test on a real phone. Only then is it trusted first. */
  testedOnPhone: boolean;
}

const HF = 'https://huggingface.co/bartowski';

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: 'gemma-2-2b', name: 'Gemma 2 (2B)', sizeMB: 1629, bengali: 'good', testedOnPhone: false,
    url: `${HF}/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf`,
    blurb: { bn: 'বাংলা ভালো লেখে · Google-এর তৈরি', en: 'Writes Bengali well · made by Google' },
  },
  {
    id: 'qwen3-1.7b', name: 'Qwen3 (1.7B)', sizeMB: 1223, bengali: 'good', testedOnPhone: false,
    url: `${HF}/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen_Qwen3-1.7B-Q4_K_M.gguf`,
    blurb: { bn: 'অনেক ভাষা জানে, বাংলাসহ · মাঝারি আকার', en: 'Knows many languages, Bengali included · medium size' },
  },
  {
    id: 'qwen2.5-3b', name: 'Qwen2.5 (3B)', sizeMB: 1840, bengali: 'ok', testedOnPhone: false,
    url: `${HF}/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf`,
    blurb: { bn: 'বড় ও সক্ষম · বাংলা মোটামুটি', en: 'Larger and capable · Bengali is fair' },
  },
  {
    id: 'qwen2.5-1.5b', name: 'Qwen2.5 (1.5B)', sizeMB: 940, bengali: 'ok', testedOnPhone: false,
    url: `${HF}/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf`,
    blurb: { bn: 'হালকা ও দ্রুত · বাংলা মোটামুটি', en: 'Light and quick · Bengali is fair' },
  },
  {
    id: 'qwen3-0.6b', name: 'Qwen3 (0.6B)', sizeMB: 461, bengali: 'ok', testedOnPhone: false,
    url: `${HF}/Qwen_Qwen3-0.6B-GGUF/resolve/main/Qwen_Qwen3-0.6B-Q4_K_M.gguf`,
    blurb: { bn: 'সবচেয়ে ছোট · কম RAM-এর ফোনের জন্য', en: 'The smallest · for phones with little memory' },
  },
  {
    id: 'llama-3.2-1b', name: 'Llama 3.2 (1B)', sizeMB: 770, bengali: 'weak', testedOnPhone: false,
    url: `${HF}/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf`,
    blurb: { bn: 'খুব দ্রুত · বাংলা দুর্বল, ইংরেজি ভালো', en: 'Very quick · weak in Bengali, good in English' },
  },
];

// The phone check (D5): a model may use at most 40% of total RAM, and under 4 GB no model
// at all. Shared with model-manager's verify step so the list and the check never disagree.
export const MIN_TOTAL_RAM_MB = 4096;
const RAM_SHARE_FOR_MODEL = 0.4;
const RUNTIME_OVERHEAD_MB = 350;

export function maxModelSizeForRam(totalRamMB: number): number {
  if (totalRamMB < MIN_TOTAL_RAM_MB) return 0;
  return Math.max(0, Math.floor((totalRamMB * RAM_SHARE_FOR_MODEL - RUNTIME_OVERHEAD_MB) / 1.2));
}

/** Download + the app's own copy exist at once while adding, plus room for the phone. */
export function spaceNeededMB(model: CatalogModel): number {
  return model.sizeMB * 2 + 500;
}

export interface PhoneFacts {
  totalRamMB: number | null;
  freeDiskMB: number | null;
  arm64: boolean;
  /** Rough year-class of the phone's hardware, when the OS says. */
  yearClass: number | null;
}

export type Speed = 'fast' | 'medium' | 'slow';

export interface Suggestion {
  model: CatalogModel;
  speed: Speed;
  star: boolean;
}

export type Recommendation =
  | { kind: 'list'; items: Suggestion[]; maxMB: number }
  | { kind: 'none'; reason: 'not-arm64' | 'low-ram' | 'low-space'; needMoreMB?: number };

const BENGALI_SCORE: Record<BengaliQuality, number> = { good: 3, ok: 2, weak: 1 };
const MAX_SHOWN = 3;

function speedFor(model: CatalogModel, maxMB: number, yearClass: number | null): Speed {
  const load = model.sizeMB / maxMB;
  if (load > 0.8 || (yearClass != null && yearClass < 2019 && model.sizeMB > 1000)) return 'slow';
  if (load < 0.45) return 'fast';
  return 'medium';
}

/**
 * What this phone should be shown. Too big for its RAM or its free space is left out; the
 * rest are ranked by how well they write Bengali, then whether they are proven on a phone,
 * with a penalty for running near the limit (slow, and the first to be killed). The star
 * goes to the best one that also runs comfortably. At most three, so the choice stays easy.
 */
export function recommendModels(facts: PhoneFacts, catalog: CatalogModel[] = MODEL_CATALOG): Recommendation {
  if (!facts.arm64) return { kind: 'none', reason: 'not-arm64' };
  // Unknown RAM: assume a modest phone rather than promise too much.
  const maxMB = facts.totalRamMB == null ? 1000 : maxModelSizeForRam(facts.totalRamMB);
  const fitRam = catalog.filter((m) => m.sizeMB <= maxMB);
  if (!fitRam.length) return { kind: 'none', reason: 'low-ram' };

  const fitSpace = fitRam.filter((m) => facts.freeDiskMB == null || facts.freeDiskMB >= spaceNeededMB(m));
  if (!fitSpace.length) {
    const cheapest = Math.min(...fitRam.map(spaceNeededMB));
    return { kind: 'none', reason: 'low-space', needMoreMB: cheapest - (facts.freeDiskMB ?? 0) };
  }

  const ranked = fitSpace
    .map((model) => {
      const speed = speedFor(model, maxMB, facts.yearClass);
      const score = BENGALI_SCORE[model.bengali] + (model.testedOnPhone ? 1 : 0) - (speed === 'slow' ? 1.5 : 0);
      return { model, speed, score };
    })
    .sort((a, b) => b.score - a.score || b.model.sizeMB - a.model.sizeMB)
    .slice(0, MAX_SHOWN);

  const starIndex = ranked.findIndex((r) => r.speed !== 'slow' && r.model.bengali !== 'weak');
  return {
    kind: 'list',
    maxMB,
    items: ranked.map((r, i) => ({ model: r.model, speed: r.speed, star: i === starIndex })),
  };
}
