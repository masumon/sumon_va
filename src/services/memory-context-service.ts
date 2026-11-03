import type { SQLiteDatabase } from 'expo-sqlite';
import type { Memory } from '../types/memory-model';
import { findMemories } from './memory-service';

export interface MemoryContextOptions {
  limit?: number;
}

/** Returns a bounded, active-memory context for the local orchestrator. */
export async function retrieveMemoryContext(
  db: SQLiteDatabase,
  query: string,
  options: MemoryContextOptions = {},
): Promise<Memory[]> {
  const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 5)));
  if (!query.trim()) return [];
  return (await findMemories(db, query)).slice(0, limit);
}
