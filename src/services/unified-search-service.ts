import type { SQLiteDatabase } from 'expo-sqlite';
import { findMemories } from './memory-service';
import { semanticSearchMemories } from './semantic-memory-service';
import { searchTasks } from './task-service';
import { collectSearchHits, type AppModule, type SearchHit } from '../modules';
import type { Memory } from '../types/memory-model';
import type { Task } from '../types/task-model';
import type { AppLanguage } from '../i18n/date-time';

export interface UnifiedSearchResult {
  tasks: Task[];
  memories: Memory[];
  /**
   * Hits from every enabled module, grouped by the module that found them.
   *
   * Tasks and memories stay named above because the screen renders them specially; every
   * other module arrives here, so a module added later appears in search with no change
   * to this file or to the search screen.
   */
  modules: { module: AppModule; hits: SearchHit[] }[];
}

// Hybrid memory retrieval: exact/keyword hits first (they also refresh last-accessed),
// then semantically-close notes the keyword pass would have missed — including
// cross-language matches (an English query finding a Bangla note, and vice-versa).
export async function searchAll(db: SQLiteDatabase, query: string, language: AppLanguage = 'bn'): Promise<UnifiedSearchResult> {
  const value = query.trim();
  if (!value) return { tasks: [], memories: [], modules: [] };
  const [tasks, lexical, semantic, modules] = await Promise.all([
    searchTasks(db, value, 100),
    findMemories(db, value),
    semanticSearchMemories(db, value, 12).catch(() => []),
    // Whatever else the user has switched on. A search for a lender's name used to find
    // their notes and their tasks but never the loan itself. Each module renders its own
    // title and subtitle in the reader's language — this used to be hard-coded to Bengali,
    // so a person reading the app in English still got Bengali digits and words inside an
    // otherwise-English results list.
    collectSearchHits(db, value, language).catch(() => []),
  ]);
  const seen = new Set(lexical.map((m) => m.id));
  const memories = [...lexical, ...semantic.filter((h) => !seen.has(h.memory.id)).map((h) => h.memory)];
  return { tasks, memories, modules };
}
