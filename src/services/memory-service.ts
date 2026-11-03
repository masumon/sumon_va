import type { SQLiteDatabase } from 'expo-sqlite';
import { archiveMemory, createMemory, deleteMemory, getMemory, listMemories, searchMemories, touchMemory, updateMemory } from './memory-repository';
import type { CreateMemoryInput, Memory, UpdateMemoryInput, MemoryKind } from '../types/memory-model';

export async function addMemory(db: SQLiteDatabase, input: CreateMemoryInput): Promise<Memory> { return createMemory(db, input); }
export async function editMemory(db: SQLiteDatabase, id: string, input: UpdateMemoryInput): Promise<Memory | null> { if (input.content !== undefined && !input.content.trim()) throw new Error('Memory content is required'); return updateMemory(db, id, input); }
export async function readMemory(db: SQLiteDatabase, id: string): Promise<Memory | null> { const memory = await getMemory(db, id); if (memory && !memory.archived) await touchMemory(db, id); return memory; }
export async function findMemories(db: SQLiteDatabase, query: string, matchAll = false): Promise<Memory[]> {
  const memories = await searchMemories(db, query, matchAll);
  await Promise.all(memories.slice(0, 20).map((memory) => touchMemory(db, memory.id)));
  return memories;
}
export async function archiveStoredMemory(db: SQLiteDatabase, id: string): Promise<Memory | null> { return archiveMemory(db, id); }
export async function restoreStoredMemory(db: SQLiteDatabase, id: string): Promise<Memory | null> { return updateMemory(db, id, { archived: false }); }
export async function removeMemory(db: SQLiteDatabase, id: string): Promise<boolean> { return deleteMemory(db, id); }
export async function getActiveMemories(db: SQLiteDatabase): Promise<Memory[]> { return listMemories(db, false); }
export async function getArchivedMemories(db: SQLiteDatabase): Promise<Memory[]> { return listMemories(db, true); }
export async function filterMemories(db: SQLiteDatabase, options: { kind?: MemoryKind; tag?: string; includeArchived?: boolean } = {}): Promise<Memory[]> {
  const memories = await listMemories(db, options.includeArchived ?? false);
  const tag = options.tag?.trim().toLocaleLowerCase();
  return memories.filter((memory) => (!options.kind || memory.kind === options.kind) && (!tag || memory.tags.some((value) => value.toLocaleLowerCase() === tag)));
}
