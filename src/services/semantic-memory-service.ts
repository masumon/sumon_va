import type { SQLiteDatabase } from 'expo-sqlite';
import type { Memory } from '../types/memory-model';
import { VectorIndex } from '../ai/semantic';
import { getActiveMemories } from './memory-service';

// Semantic recall over the user's memories, fully on-device.
//
// A single in-memory VectorIndex is cached and reused between calls; it is only
// rebuilt when the set of active memories actually changes (detected by a cheap
// fingerprint of id + updatedAt). No SQLite schema, no migration, no network.

export interface SemanticMemoryHit {
  memory: Memory;
  score: number;
}

let cache: { fingerprint: string; index: VectorIndex<Memory> } | null = null;

function fingerprint(memories: Memory[]): string {
  let h = `${memories.length}`;
  for (const m of memories) h += `|${m.id}:${m.updatedAt}`;
  return h;
}

function toDoc(memory: Memory) {
  return {
    id: memory.id,
    text: `${memory.title ?? ''}\n${memory.content}\n${memory.tags.join(' ')}`,
    meta: memory,
  };
}

/** Force the next search to rebuild the index (used after bulk changes / in tests). */
export function resetSemanticMemoryIndex(): void {
  cache = null;
}

async function ensureIndex(db: SQLiteDatabase): Promise<VectorIndex<Memory>> {
  const memories = await getActiveMemories(db);
  const fp = fingerprint(memories);
  if (cache && cache.fingerprint === fp) return cache.index;
  const index = new VectorIndex<Memory>();
  index.rebuild(memories.map(toDoc));
  cache = { fingerprint: fp, index };
  return index;
}

/**
 * Memories most semantically similar to `query`, best first. `minScore` (cosine)
 * defaults to a conservative floor so unrelated notes are not returned.
 */
export async function semanticSearchMemories(
  db: SQLiteDatabase,
  query: string,
  k = 5,
  minScore = 0.12,
): Promise<SemanticMemoryHit[]> {
  const value = query.trim();
  if (!value) return [];
  const index = await ensureIndex(db);
  return index.query(value, k, minScore).map((hit) => ({ memory: hit.meta, score: hit.score }));
}
