import type { SQLiteDatabase } from 'expo-sqlite';
import type { Task } from '../types/task-model';
import { findDueTasks } from './task-repository';

export async function listOverdueTasks(
  db: SQLiteDatabase,
  now = new Date(),
  limit = 100,
): Promise<Task[]> {
  if (Number.isNaN(now.getTime())) throw new Error('Overdue task time must be valid');
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));
  const tasks = await findDueTasks(db, new Date(0).toISOString(), now.toISOString(), safeLimit);
  return tasks.filter((task) => Boolean(task.dueAt && new Date(task.dueAt).getTime() < now.getTime()));
}
