import type { SQLiteDatabase } from 'expo-sqlite';
import type { CreateSubtaskInput, Subtask } from '../types/subtask-model';
import {
  createSubtask,
  deleteSubtask,
  listSubtaskProgress,
  listSubtasks,
  reorderSubtasks,
  setSubtaskCompleted,
  type SubtaskProgress,
} from './subtask-repository';

const MAX_SUBTASKS = 50;

export async function addSubtask(db: SQLiteDatabase, input: CreateSubtaskInput): Promise<Subtask> {
  const title = input.title.trim();
  if (!title) throw new Error('Subtask title is required');
  const existing = await listSubtasks(db, input.taskId);
  if (existing.length >= MAX_SUBTASKS) throw new Error('This task already has the maximum number of steps');
  return createSubtask(db, { ...input, title, position: existing.length });
}

export async function toggleSubtask(db: SQLiteDatabase, id: string, completed: boolean): Promise<Subtask | null> {
  return setSubtaskCompleted(db, id, completed);
}

export async function removeSubtask(db: SQLiteDatabase, id: string): Promise<boolean> {
  return deleteSubtask(db, id);
}

export { listSubtasks, reorderSubtasks, listSubtaskProgress };
export type { Subtask, SubtaskProgress };
export const SUBTASK_LIMIT = MAX_SUBTASKS;
