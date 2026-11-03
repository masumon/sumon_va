// Deterministic on-device text embeddings — no model, no download, no network.
//
// This is classical feature hashing (the "hashing trick"): every token and every
// character 3-gram of the text is hashed into one of D buckets with a signed weight,
// then the vector is L2-normalised. Cosine similarity of two such vectors is a robust,
// language-agnostic proxy for "these texts are about the same thing" — and character
// n-grams make it tolerant of Bengali case endings and small typos
// ("পাসপোর্টের" ≈ "পাসপোর্ট", "wifi" ≈ "wi-fi") without any stemming table.
//
// Optional IDF weighting (document frequencies supplied by the caller/index) pushes
// rare, meaningful words above common filler.

import { normalizeText } from '../nlp/normalize';
import { STOP_WORDS } from '../nlp/keywords';
import { expandSynonyms } from './synonyms';

// 1024 buckets keeps collisions low for a personal-scale corpus while a vector is still
// only ~4 KB. Character 3-grams are weighted well below whole-word features — they are a
// morphology/typo safety net, not the main signal.
export const EMBED_DIM = 1024;
const TRIGRAM_WEIGHT = 0.35;

/** FNV-1a, 32-bit. Stable across engines; enough spread for a 256-bucket sketch. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

export function tokenizeForEmbedding(text: string): string[] {
  // Keep combining marks (\p{M}) inside tokens — Bengali matras are marks, and
  // splitting on them shreds every word ("পাসপোর্টের" → "প", "স"…).
  return normalizeText(text)
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

function charTrigrams(token: string): string[] {
  const padded = `^${token}$`;
  if (padded.length <= 3) return [padded];
  const grams: string[] = [];
  for (let i = 0; i + 3 <= padded.length; i += 1) grams.push(padded.slice(i, i + 3));
  return grams;
}

export interface EmbedOptions {
  /** term -> inverse document frequency. Missing terms get `defaultIdf`. */
  idf?: Map<string, number>;
  defaultIdf?: number;
  /** Add bilingual synonyms/equivalents of each token (query-side expansion). */
  expand?: boolean;
}

/** A deterministic, L2-normalised embedding of `text`. */
export function embed(text: string, options: EmbedOptions = {}): Float32Array {
  const vec = new Float32Array(EMBED_DIM);
  const tokens = tokenizeForEmbedding(text);
  if (tokens.length === 0) return vec;

  const idf = options.idf;
  const defaultIdf = options.defaultIdf ?? 1;

  const add = (feature: string, weight: number) => {
    if (weight <= 0) return;
    const h = fnv1a(feature);
    const idx = h % EMBED_DIM;
    const sign = (h & 0x80000000) !== 0 ? -1 : 1;
    vec[idx] = (vec[idx] ?? 0) + sign * weight;
  };

  const bag = new Map<string, number>();
  for (const token of tokens) bag.set(token, (bag.get(token) ?? 0) + 1);
  if (options.expand) {
    for (const extra of expandSynonyms(tokens)) bag.set(extra, Math.max(bag.get(extra) ?? 0, 0.7));
  }

  for (const [token, tf] of bag) {
    const weight = (idf?.get(token) ?? defaultIdf) * (1 + Math.log(tf));
    add(`w:${token}`, weight);
    const grams = charTrigrams(token);
    const gramWeight = (weight * TRIGRAM_WEIGHT) / Math.sqrt(grams.length);
    for (const gram of grams) add(`g:${gram}`, gramWeight);
  }

  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i += 1) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < EMBED_DIM; i += 1) vec[i]! /= norm;
  return vec;
}

/** Cosine similarity of two embeddings (they are already unit-length → just a dot). */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i]! * b[i]!;
  return dot;
}
