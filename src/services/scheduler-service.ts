import type { SQLiteDatabase } from 'expo-sqlite';
import type { Task } from '../types/task-model';
import { findDueTasks } from './task-repository';

export interface ScheduledTask extends Task {
  dueAtDate: Date;
}

/**
 * Deterministic offline scheduler query. It does not mutate tasks or trigger
 * notifications; callers decide how to present/notify the returned tasks.
 */
export async function listDueTasks(
  db: SQLiteDatabase,
  now = new Date(),
  horizonMinutes = 0,
): Promise<ScheduledTask[]> {
  if (Number.isNaN(now.getTime())) throw new Error('Scheduler current time must be valid');
  if (!Number.isFinite(horizonMinutes) || horizonMinutes < 0) {
    throw new Error('Scheduler horizon must be a non-negative finite number');
  }

  const horizon = new Date(now.getTime() + horizonMinutes * 60_000);
  const tasks = await findDueTasks(db, now.toISOString(), horizon.toISOString());

  return tasks
    .map((task) => ({ ...task, dueAtDate: new Date(task.dueAt as string) }))
    .filter(({ dueAtDate }) => !Number.isNaN(dueAtDate.getTime()))
    .sort((a, b) => a.dueAtDate.getTime() - b.dueAtDate.getTime());
}
