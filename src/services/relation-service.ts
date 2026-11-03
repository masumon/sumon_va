import type { SQLiteDatabase } from 'expo-sqlite';
import type { Memory } from '../types/memory-model';
import type { Task } from '../types/task-model';
import { getMemory } from './memory-repository';
import { getTask } from './task-repository';

// Links between any two records in the app.
//
// One table connects everything: a task to the note behind it, a debt to the illness that
// caused it, a prescription to the expense it created, a course to the exam it leads to.
// Both ends are just a kind and an id, so a module added next year links to one added
// today without either knowing the other exists, and without a new table.
//
// Rows are stored canonically — whichever end the caller names first stays on the "from"
// side — and both directions are one indexed read. Local-only, like everything else;
// links travel in the backup.

/**
 * The kinds of record a link can point at.
 *
 * A plain string on purpose: the database no longer restricts it, and a union listed here
 * would have to be edited every time a module is added, which is exactly the coupling
 * this table exists to avoid. Use SCREAMING_CASE and keep it stable once stored.
 */
export type LinkKind = string;

export interface LinkedRef {
  kind: LinkKind;
  id: string;
}

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Link any two records. Idempotent — a repeat call is a no-op. */
export async function link(db: SQLiteDatabase, from: LinkedRef, to: LinkedRef): Promise<void> {
  if (!from.kind || !from.id || !to.kind || !to.id) throw new Error('Both ends of a link are required');
  await db.runAsync(
    `INSERT INTO relations (id, from_type, from_id, to_type, to_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(from_type, from_id, to_type, to_id) DO NOTHING`,
    createId(), from.kind, from.id, to.kind, to.id, new Date().toISOString(),
  );
}

export async function unlink(db: SQLiteDatabase, from: LinkedRef, to: LinkedRef): Promise<void> {
  await db.runAsync(
    'DELETE FROM relations WHERE from_type = ? AND from_id = ? AND to_type = ? AND to_id = ?',
    from.kind, from.id, to.kind, to.id,
  );
}

/**
 * Everything linked to one record, in either direction, newest first.
 *
 * Callers get kinds and ids, not loaded records — this file must not import every
 * module's repository to stay useful to modules that do not exist yet. Each module loads
 * the ids it recognises and ignores the rest.
 */
export async function listLinks(db: SQLiteDatabase, of: LinkedRef, ofKind?: LinkKind): Promise<LinkedRef[]> {
  const rows = await db.getAllAsync<{ kind: string; id: string }>(
    `SELECT to_type AS kind, to_id AS id, created_at FROM relations WHERE from_type = ? AND from_id = ?
     UNION ALL
     SELECT from_type AS kind, from_id AS id, created_at FROM relations WHERE to_type = ? AND to_id = ?
     ORDER BY created_at DESC`,
    of.kind, of.id, of.kind, of.id,
  );
  const seen = new Set<string>();
  const out: LinkedRef[] = [];
  for (const row of rows) {
    if (ofKind && row.kind !== ofKind) continue;
    const key = `${row.kind}:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: row.kind, id: row.id });
  }
  return out;
}

/** Remove every link touching a record — call this when the record itself is deleted. */
export async function unlinkAll(db: SQLiteDatabase, of: LinkedRef): Promise<void> {
  await db.runAsync(
    'DELETE FROM relations WHERE (from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)',
    of.kind, of.id, of.kind, of.id,
  );
}

// ── task ↔ memory, the pair that already existed ──────────────────────────────
// Thin wrappers over the generic functions above, kept because the task and memory
// screens call them by name and because loading the records is genuinely useful there.

export async function linkTaskMemory(db: SQLiteDatabase, taskId: string, memoryId: string): Promise<void> {
  if (!taskId || !memoryId) throw new Error('A task and a memory are required to link');
  await link(db, { kind: 'TASK', id: taskId }, { kind: 'MEMORY', id: memoryId });
}

export async function unlinkTaskMemory(db: SQLiteDatabase, taskId: string, memoryId: string): Promise<void> {
  await unlink(db, { kind: 'TASK', id: taskId }, { kind: 'MEMORY', id: memoryId });
}

/** Memories explicitly linked to a task, newest link first. */
export async function listLinkedMemories(db: SQLiteDatabase, taskId: string): Promise<Memory[]> {
  const rows = await db.getAllAsync<{ to_id: string }>(
    `SELECT to_id FROM relations WHERE from_type = 'TASK' AND from_id = ? ORDER BY created_at DESC`, taskId,
  );
  const out: Memory[] = [];
  for (const row of rows) {
    const memory = await getMemory(db, row.to_id);
    if (memory) out.push(memory);
  }
  return out;
}

/** Tasks explicitly linked to a memory, newest link first. */
export async function listLinkedTasks(db: SQLiteDatabase, memoryId: string): Promise<Task[]> {
  const rows = await db.getAllAsync<{ from_id: string }>(
    `SELECT from_id FROM relations WHERE to_type = 'MEMORY' AND to_id = ? ORDER BY created_at DESC`, memoryId,
  );
  const out: Task[] = [];
  for (const row of rows) {
    const task = await getTask(db, row.from_id);
    if (task) out.push(task);
  }
  return out;
}
