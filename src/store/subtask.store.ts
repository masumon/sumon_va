import type { SQLiteDatabase } from 'expo-sqlite';
import { create } from 'zustand';
import {
  addSubtask,
  listSubtaskProgress,
  listSubtasks,
  removeSubtask,
  toggleSubtask,
  type Subtask,
  type SubtaskProgress,
} from '../services/subtask-service';

interface SubtaskStore {
  byTask: Record<string, Subtask[]>;
  progress: Record<string, SubtaskProgress>;
  load: (db: SQLiteDatabase, taskId: string) => Promise<void>;
  loadProgress: (db: SQLiteDatabase) => Promise<void>;
  add: (db: SQLiteDatabase, taskId: string, title: string) => Promise<Subtask | null>;
  toggle: (db: SQLiteDatabase, taskId: string, id: string, completed: boolean) => Promise<void>;
  remove: (db: SQLiteDatabase, taskId: string, id: string) => Promise<void>;
}

function progressOf(list: Subtask[]): SubtaskProgress {
  return { total: list.length, done: list.filter((item) => item.completed).length };
}

export const useSubtaskStore = create<SubtaskStore>((set, get) => ({
  byTask: {},
  progress: {},
  load: async (db, taskId) => {
    const list = await listSubtasks(db, taskId);
    set((state) => ({ byTask: { ...state.byTask, [taskId]: list }, progress: { ...state.progress, [taskId]: progressOf(list) } }));
  },
  loadProgress: async (db) => {
    try { set({ progress: await listSubtaskProgress(db) }); } catch { /* non-critical list decoration */ }
  },
  add: async (db, taskId, title) => {
    try {
      const created = await addSubtask(db, { taskId, title });
      const next = [...(get().byTask[taskId] ?? []), created];
      set((state) => ({ byTask: { ...state.byTask, [taskId]: next }, progress: { ...state.progress, [taskId]: progressOf(next) } }));
      return created;
    } catch { return null; }
  },
  toggle: async (db, taskId, id, completed) => {
    const updated = await toggleSubtask(db, id, completed);
    if (!updated) return;
    const next = (get().byTask[taskId] ?? []).map((item) => (item.id === id ? updated : item));
    set((state) => ({ byTask: { ...state.byTask, [taskId]: next }, progress: { ...state.progress, [taskId]: progressOf(next) } }));
  },
  remove: async (db, taskId, id) => {
    if (!(await removeSubtask(db, id))) return;
    const next = (get().byTask[taskId] ?? []).filter((item) => item.id !== id);
    set((state) => ({ byTask: { ...state.byTask, [taskId]: next }, progress: { ...state.progress, [taskId]: progressOf(next) } }));
  },
}));
