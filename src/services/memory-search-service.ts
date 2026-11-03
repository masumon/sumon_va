import type { SQLiteDatabase } from 'expo-sqlite';
import { searchMemories } from './memory-repository';
import type { Memory } from '../types/memory-model';

export interface RankedMemory extends Memory { relevance: number; }

function normalize(value: string): string { return value.normalize('NFKC').toLocaleLowerCase().trim(); }
function tokenize(value: string): string[] { return normalize(value).split(/\s+/u).filter(Boolean).slice(0, 12); }

/** Deterministic local ranking; no network or external model is involved. */
export async function searchRankedMemories(db: SQLiteDatabase, query: string, limit = 20): Promise<RankedMemory[]> {
  const normalized = normalize(query);
  if (!normalized) return [];
  const terms = tokenize(normalized);
  const memories = await searchMemories(db, normalized, false);

  return memories.map((memory) => {
    const title = normalize(memory.title ?? '');
    const content = normalize(memory.content);
    const tags = normalize(memory.tags.join(' '));
    const haystack = `${title} ${content} ${tags}`;
    const matched = terms.filter((term) => haystack.includes(term));
    const exactPhrase = haystack.includes(normalized);
    const titleMatches = terms.filter((term) => title.includes(term)).length;
    const tagMatches = terms.filter((term) => tags.includes(term)).length;
    const relevance = matched.length / Math.max(terms.length, 1) + (exactPhrase ? 1 : 0) + titleMatches * 0.25 + tagMatches * 0.15 + memory.importance * 0.05;
    return { ...memory, relevance };
  }).sort((a, b) => b.relevance - a.relevance || b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}
