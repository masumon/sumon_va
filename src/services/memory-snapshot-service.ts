import type { SQLiteDatabase } from 'expo-sqlite';
import { getActiveMemories } from './memory-service';
import type { Memory } from '../types/memory-model';

export async function getRecentMemorySnapshot(
  db: SQLiteDatabase,
  limit = 3,
): Promise<Memory[]> {
  const memories = await getActiveMemories(db);
  return memories
    .slice()
    .sort((a, b) => {
      const importance = b.importance - a.importance;
      if (importance !== 0) return importance;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })
    .slice(0, Math.max(0, limit));
}
