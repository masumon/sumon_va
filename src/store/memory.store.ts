import type { SQLiteDatabase } from 'expo-sqlite';
import { create } from 'zustand';
import { addMemory, archiveStoredMemory, editMemory, findMemories, getActiveMemories, getArchivedMemories, removeMemory, restoreStoredMemory } from '../services/memory-service';
import { restoreMemory as untrashMemory } from '../services/memory-repository';
import { logAppError } from '../services/error-log';
import type { CreateMemoryInput, Memory, UpdateMemoryInput } from '../types/memory-model';

interface MemoryStore {
  memories: Memory[]; isLoading: boolean; error: string | null;
  load: (db: SQLiteDatabase) => Promise<void>;
  loadArchived: (db: SQLiteDatabase) => Promise<void>;
  create: (db: SQLiteDatabase, input: CreateMemoryInput) => Promise<Memory | null>;
  update: (db: SQLiteDatabase, id: string, input: UpdateMemoryInput) => Promise<Memory | null>;
  search: (db: SQLiteDatabase, query: string) => Promise<Memory[]>;
  archive: (db: SQLiteDatabase, id: string) => Promise<Memory | null>;
  restore: (db: SQLiteDatabase, id: string) => Promise<Memory | null>;
  remove: (db: SQLiteDatabase, id: string) => Promise<boolean>;
  untrash: (db: SQLiteDatabase, id: string) => Promise<boolean>;
  clearError: () => void;
}

export const useMemoryStore = create<MemoryStore>((set) => ({
  memories: [], isLoading: false, error: null,
  load: async (db) => { set({ isLoading: true, error: null }); try { set({ memories: await getActiveMemories(db), isLoading: false }); } catch (error) { set({ isLoading: false, error: logAppError('memory.load', error, 'Unable to load memories') }); } },
  loadArchived: async (db) => { set({ isLoading: true, error: null }); try { set({ memories: await getArchivedMemories(db), isLoading: false }); } catch (error) { set({ isLoading: false, error: logAppError('memory.loadArchived', error, 'Unable to load archived memories') }); } },
  create: async (db, input) => { set({ error: null }); try { const memory = await addMemory(db, input); set((state) => ({ memories: [memory, ...state.memories] })); if (memory.tags.length > 1) { void import('../services/learning-service').then(m => m.recordTagPairs(db, memory.tags)).catch(() => {}); } return memory; } catch (error) { set({ error: logAppError('memory.create', error, 'Unable to create memory') }); return null; } },
  update: async (db, id, input) => { set({ error: null }); try { const memory = await editMemory(db, id, input); if (memory?.archived) set((state) => ({ memories: state.memories.filter((item) => item.id !== id) })); else if (memory) set((state) => ({ memories: state.memories.map((item) => item.id === id ? memory : item) })); return memory; } catch (error) { set({ error: logAppError('memory.update', error, 'Unable to update memory') }); return null; } },
  search: async (db, query) => { set({ isLoading: true, error: null }); try { const memories = await findMemories(db, query); set({ memories, isLoading: false }); return memories; } catch (error) { set({ isLoading: false, error: logAppError('memory.search', error, 'Unable to search memories') }); return []; } },
  archive: async (db, id) => { set({ error: null }); try { const memory = await archiveStoredMemory(db, id); if (memory) set((state) => ({ memories: state.memories.filter((item) => item.id !== id) })); return memory; } catch (error) { set({ error: logAppError('memory.archive', error, 'Unable to archive memory') }); return null; } },
  restore: async (db, id) => { set({ error: null }); try { const memory = await restoreStoredMemory(db, id); if (memory) set((state) => ({ memories: [memory, ...state.memories.filter((item) => item.id !== id)] })); return memory; } catch (error) { set({ error: logAppError('memory.restore', error, 'Unable to restore memory') }); return null; } },
  remove: async (db, id) => { set({ error: null }); try { const removed = await removeMemory(db, id); if (removed) set((state) => ({ memories: state.memories.filter((item) => item.id !== id) })); return removed; } catch (error) { set({ error: logAppError('memory.remove', error, 'Unable to delete memory') }); return false; } },
  untrash: async (db, id) => { set({ error: null }); try { const ok = await untrashMemory(db, id); if (ok) { try { set({ memories: await getActiveMemories(db) }); } catch { /* keep list */ } } return ok; } catch (error) { set({ error: logAppError('memory.untrash', error, 'Unable to restore memory') }); return false; } },
  clearError: () => set({ error: null }),
}));
