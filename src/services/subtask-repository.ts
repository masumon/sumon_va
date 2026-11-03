import type { SQLiteDatabase } from 'expo-sqlite';
import { exclusiveTransaction } from '../database/atomic';
import type { CreateSubtaskInput, Subtask } from '../types/subtask-model';

interface SubtaskRow {
  id: string;
  task_id: string;
  title: string;
  completed: number;
  position: number;
  created_at: string;
  updated_at: string;
}

function toSubtask(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    completed: row.completed === 1,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function createSubtask(db: SQLiteDatabase, input: CreateSubtaskInput): Promise<Subtask> {
  const title = input.title.trim();
  if (!title) throw new Error('Subtask title is required');

  const task = await db.getFirstAsync<{ id: string }>('SELECT id FROM tasks WHERE id = ? LIMIT 1', input.taskId);
  if (!task) throw new Error('Parent task does not exist');

  const now = new Date().toISOString();
  const id = createId();
  await db.runAsync(
    `INSERT INTO subtasks (id, task_id, title, completed, position, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
    id,
    input.taskId,
    title,
    input.position ?? 0,
    now,
    now,
  );

  const row = await db.getFirstAsync<SubtaskRow>(
    `SELECT id, task_id, title, completed, position, created_at, updated_at
     FROM subtasks WHERE id = ? LIMIT 1`,
    id,
  );
  if (!row) throw new Error('Subtask could not be created');
  return toSubtask(row);
}

export async function listSubtasks(db: SQLiteDatabase, taskId: string): Promise<Subtask[]> {
  const rows = await db.getAllAsync<SubtaskRow>(
    `SELECT id, task_id, title, completed, position, created_at, updated_at
     FROM subtasks WHERE task_id = ? ORDER BY position ASC, created_at ASC`,
    taskId,
  );
  return rows.map(toSubtask);
}

export async function setSubtaskCompleted(
  db: SQLiteDatabase,
  id: string,
  completed: boolean,
): Promise<Subtask | null> {
  const result = await db.runAsync(
    'UPDATE subtasks SET completed = ?, updated_at = ? WHERE id = ?',
    completed ? 1 : 0,
    new Date().toISOString(),
    id,
  );
  if (result.changes === 0) return null;

  const row = await db.getFirstAsync<SubtaskRow>(
    `SELECT id, task_id, title, completed, position, created_at, updated_at
     FROM subtasks WHERE id = ? LIMIT 1`,
    id,
  );
  return row ? toSubtask(row) : null;
}

export async function deleteSubtask(db: SQLiteDatabase, id: string): Promise<boolean> {
  const result = await db.runAsync('DELETE FROM subtasks WHERE id = ?', id);
  return result.changes > 0;
}

export interface SubtaskProgress {
  total: number;
  done: number;
}

/** Bulk progress for list surfaces (Home / Planning) — one query, no per-row fan-out. */
export async function listSubtaskProgress(db: SQLiteDatabase): Promise<Record<string, SubtaskProgress>> {
  const rows = await db.getAllAsync<{ task_id: string; total: number; done: number }>(
    'SELECT task_id, COUNT(*) AS total, SUM(completed) AS done FROM subtasks GROUP BY task_id',
  );
  const out: Record<string, SubtaskProgress> = {};
  for (const row of rows) out[row.task_id] = { total: Number(row.total), done: Number(row.done ?? 0) };
  return out;
}

export async function reorderSubtasks(db: SQLiteDatabase, taskId: string, orderedIds: string[]): Promise<void> {
  await exclusiveTransaction(db, async () => {
    const now = new Date().toISOString();
    for (let index = 0; index < orderedIds.length; index += 1) {
      await db.runAsync('UPDATE subtasks SET position = ?, updated_at = ? WHERE id = ? AND task_id = ?', index, now, orderedIds[index]!, taskId);
    }
  });
}
