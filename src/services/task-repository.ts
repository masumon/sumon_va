import type { SQLiteDatabase } from 'expo-sqlite';
import { exclusiveTransaction } from '../database/atomic';
import type { CreateTaskInput, Task, UpdateTaskInput } from '../types/task-model';
import type { TaskPriority, TaskStatus } from '../types';
import { deleteAttachmentFiles, listAttachments } from './attachment-service';

export type TrashedTask = Task & { deletedAt: string };

interface TaskRow {
  id: string; title: string; notes: string | null; status: TaskStatus; priority: TaskPriority;
  due_at: string | null; planned_date: string | null; completed_at: string | null; recurrence: string | null; created_at: string; updated_at: string; deleted_at?: string | null;
}
// Every "live" read AND-s this in. Trash reads flip it.
const LIVE = 'deleted_at IS NULL';

function toTask(row: TaskRow): Task {
  return { id: row.id, title: row.title, notes: row.notes, status: row.status, priority: row.priority,
    dueAt: row.due_at, plannedDate: row.planned_date, completedAt: row.completed_at,
    recurrence: (row.recurrence as Task['recurrence']) ?? null,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function createId(): string { return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`; }

const SELECT = `SELECT id, title, notes, status, priority, due_at, planned_date, completed_at, recurrence, created_at, updated_at FROM tasks`;

export async function createTask(db: SQLiteDatabase, input: CreateTaskInput): Promise<Task> {
  const title = input.title.trim();
  if (!title) throw new Error('Task title is required');
  const now = new Date().toISOString();
  const id = createId();
  const status = input.status ?? (input.dueAt ? 'PLANNED' : 'INBOX');
  const priority = input.priority ?? 'MEDIUM';
  await db.runAsync(
    `INSERT INTO tasks (id,title,notes,status,priority,due_at,planned_date,completed_at,recurrence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,NULL,?,?,?)`,
    id, title, input.notes ?? null, status, priority, input.dueAt ?? null, input.plannedDate ?? null, input.recurrence ?? null, now, now,
  );
  const task = await getTask(db, id);
  if (!task) throw new Error('Task could not be created');
  return task;
}

export async function getTask(db: SQLiteDatabase, id: string): Promise<Task | null> {
  const row = await db.getFirstAsync<TaskRow>(`${SELECT} WHERE id = ? AND ${LIVE} LIMIT 1`, id);
  return row ? toTask(row) : null;
}

export async function findTasksByExactTitle(db: SQLiteDatabase, title: string): Promise<Task[]> {
  const normalized = title.trim();
  if (!normalized) return [];
  const rows = await db.getAllAsync<TaskRow>(`${SELECT} WHERE LOWER(TRIM(title)) = LOWER(TRIM(?)) AND ${LIVE} ORDER BY created_at DESC`, normalized);
  return rows.map(toTask);
}

export async function searchTasks(db: SQLiteDatabase, query: string, limit = 100): Promise<Task[]> {
  const normalized = query.normalize('NFKC').trim().toLocaleLowerCase();
  if (!normalized) return [];
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));
  const needle = `%${normalized}%`;
  const rows = await db.getAllAsync<TaskRow>(`${SELECT}
    WHERE (LOWER(title) LIKE ? OR LOWER(COALESCE(notes, '')) LIKE ?) AND ${LIVE}
    ORDER BY CASE WHEN LOWER(title) LIKE ? THEN 0 ELSE 1 END, updated_at DESC LIMIT ?`, needle, needle, needle, safeLimit);
  return rows.map(toTask);
}

export async function findDueTasks(db: SQLiteDatabase, fromIso: string, toIso: string, limit = 500): Promise<Task[]> {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));
  const rows = await db.getAllAsync<TaskRow>(`${SELECT}
    WHERE status IN (?, ?) AND due_at IS NOT NULL AND due_at >= ? AND due_at <= ? AND ${LIVE}
    ORDER BY due_at ASC, created_at DESC LIMIT ?`, 'PLANNED', 'RESCHEDULED', fromIso, toIso, safeLimit);
  return rows.map(toTask);
}

export async function listTasks(db: SQLiteDatabase, options: { status?: TaskStatus; limit?: number } = {}): Promise<Task[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const rows = options.status
    ? await db.getAllAsync<TaskRow>(`${SELECT} WHERE status = ? AND ${LIVE} ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, created_at DESC LIMIT ?`, options.status, limit)
    : await db.getAllAsync<TaskRow>(`${SELECT} WHERE ${LIVE} ORDER BY CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at ASC, created_at DESC LIMIT ?`, limit);
  return rows.map(toTask);
}

// Uncapped, oldest-first — for whole-library export only. Everything else must page.
export async function listAllTasks(db: SQLiteDatabase): Promise<Task[]> {
  const rows = await db.getAllAsync<TaskRow>(`${SELECT} WHERE ${LIVE} ORDER BY created_at ASC`);
  return rows.map(toTask);
}

// ── Trash ─────────────────────────────────────────────────────────────────────
export async function listTrashedTasks(db: SQLiteDatabase): Promise<TrashedTask[]> {
  const rows = await db.getAllAsync<TaskRow>(`SELECT id, title, notes, status, priority, due_at, planned_date, completed_at, recurrence, created_at, updated_at, deleted_at FROM tasks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`);
  return rows.map((row) => ({ ...toTask(row), deletedAt: String(row.deleted_at) }));
}
export async function restoreTask(db: SQLiteDatabase, id: string): Promise<boolean> {
  const r = await db.runAsync('UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL', new Date().toISOString(), id);
  return (r.changes ?? 0) > 0;
}
// Real, irreversible removal — also drops the row's attachments and links.
export async function purgeTask(db: SQLiteDatabase, id: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM tasks WHERE id = ? LIMIT 1', id);
  if (!row) return false;
  const attachments = await listAttachments(db, 'TASK', id);
  await exclusiveTransaction(db, async () => {
    await db.runAsync('DELETE FROM attachments WHERE owner_type=? AND owner_id=?', 'TASK',id);
    await db.runAsync("DELETE FROM relations WHERE (from_type='TASK' AND from_id=?) OR (to_type='TASK' AND to_id=?)", id, id);
    await db.runAsync('DELETE FROM tasks WHERE id=?', id);
  });
  await deleteAttachmentFiles(attachments);
  return true;
}
export async function purgeExpiredTasks(db: SQLiteDatabase, before: string): Promise<number> {
  const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?', before);
  for (const row of rows) await purgeTask(db, row.id).catch(() => {});
  return rows.length;
}
export async function emptyTaskTrash(db: SQLiteDatabase): Promise<number> {
  const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM tasks WHERE deleted_at IS NOT NULL');
  for (const row of rows) await purgeTask(db, row.id).catch(() => {});
  return rows.length;
}

/**
 * `onlyIfNotCompleted`: write only while the row is still open, and return null when it
 * was already completed — so a double tap on a recurring task cannot complete it twice
 * and spawn two next occurrences.
 */
export async function updateTask(db: SQLiteDatabase, id: string, input: UpdateTaskInput, opts: { onlyIfNotCompleted?: boolean } = {}): Promise<Task | null> {
  const current = await getTask(db, id);
  if (!current) return null;
  const nextTitle = input.title === undefined ? current.title : input.title.trim();
  if (!nextTitle) throw new Error('Task title is required');
  const nextStatus = input.status ?? current.status;
  const completedAt = nextStatus === 'COMPLETED' ? current.completedAt ?? new Date().toISOString() : null;
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `UPDATE tasks SET title=?, notes=?, status=?, priority=?, due_at=?, planned_date=?, completed_at=?, recurrence=?, updated_at=? WHERE id=?${opts.onlyIfNotCompleted ? " AND status <> 'COMPLETED'" : ''}`,
    nextTitle,
    input.notes === undefined ? current.notes : input.notes,
    nextStatus,
    input.priority ?? current.priority,
    input.dueAt === undefined ? current.dueAt : input.dueAt,
    input.plannedDate === undefined ? current.plannedDate : input.plannedDate,
    completedAt,
    (input.recurrence === undefined ? current.recurrence : input.recurrence) ?? null,
    now,
    id,
  );
  if (opts.onlyIfNotCompleted && (result?.changes ?? 0) === 0) return null;
  return getTask(db, id);
}

// Soft delete → the row moves to the trash. Attachments and links stay with it so a
// restore is complete; `purgeTask` does the real removal.
export async function deleteTask(db: SQLiteDatabase, id: string): Promise<boolean> {
  const now = new Date().toISOString();
  const r = await db.runAsync('UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', now, now, id);
  return (r.changes ?? 0) > 0;
}

export { toTask };
/**
 * The open task touched most recently — what "সেটা শেষ হয়েছে" points at when the
 * Assistant opens with no conversation of its own yet. The confirm card shows its title
 * before anything changes, so a wrong guess is visible and harmless.
 */
export async function lastOpenTaskTitle(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ title: string }>(
    `SELECT title FROM tasks WHERE ${LIVE} AND status NOT IN ('COMPLETED', 'ARCHIVED', 'CANCELLED') ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
  );
  return row?.title ?? null;
}
