import type { SQLiteDatabase } from 'expo-sqlite';
import type { CreateTaskInput, Task, TaskRecurrence, UpdateTaskInput } from '../types/task-model';
import { TASK_RECURRENCES } from '../types/task-model';
import type { TaskStatus } from '../types';
import { createTask, deleteTask, findTasksByExactTitle, getTask, listTasks, searchTasks, updateTask } from './task-repository';
import { bangladeshDateKey, zonedClock, zonedInstant } from '../i18n/date-time';

const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  INBOX: ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ARCHIVED'],
  PLANNED: ['IN_PROGRESS', 'COMPLETED', 'RESCHEDULED', 'CANCELLED', 'ARCHIVED'],
  IN_PROGRESS: ['COMPLETED', 'RESCHEDULED', 'CANCELLED', 'ARCHIVED'],
  COMPLETED: ['ARCHIVED', 'IN_PROGRESS'],
  RESCHEDULED: ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ARCHIVED'],
  ARCHIVED: [],
  CANCELLED: ['INBOX', 'ARCHIVED'],
};

function dateKeyFromIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('A valid due date is required');
  // Use the Asia/Dhaka calendar day, not the UTC slice — otherwise a task due
  // 00:00–05:59 local lands on the previous day's plan.
  return bangladeshDateKey(date);
}

function validatePlannedDate(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error('Planned date must use YYYY-MM-DD format');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Planned date must be a valid calendar date');
  }
  return value;
}

function validateDueAt(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Due date/time must be a valid date and time');
  // Canonicalise to a full UTC ISO string. Some entry paths (the local assistant) build
  // a naive "YYYY-MM-DDTHH:MM:00" with no zone; storing mixed formats broke string-based
  // scheduler comparisons and the notification de-dup key.
  return date.toISOString();
}

export async function addTask(db: SQLiteDatabase, input: CreateTaskInput): Promise<Task> {
  const dueAt = validateDueAt(input.dueAt);
  const plannedDate = input.plannedDate !== undefined
    ? validatePlannedDate(input.plannedDate)
    : dueAt
      ? dateKeyFromIso(dueAt)
      : null;
  const recurrence = validateRecurrence(input.recurrence) ?? null;
  return createTask(db, { ...input, dueAt, plannedDate, recurrence });
}

export async function editTask(db: SQLiteDatabase, id: string, input: UpdateTaskInput): Promise<Task | null> {
  let before: Task | null = null;
  if (input.status) {
    before = await getTask(db, id);
    if (!before) return null;
    if (before.status !== input.status && !ALLOWED_TRANSITIONS[before.status].includes(input.status)) {
      throw new Error(`Invalid task status transition: ${before.status} -> ${input.status}`);
    }
  }
  const dueAt = input.dueAt !== undefined ? validateDueAt(input.dueAt) : undefined;
  const plannedDate = input.plannedDate !== undefined
    ? validatePlannedDate(input.plannedDate)
    : dueAt !== undefined && dueAt !== null
      ? dateKeyFromIso(dueAt)
      : undefined;
  const recurrence = validateRecurrence(input.recurrence);
  const spawnsNext = input.status === 'COMPLETED' && before && before.status !== 'COMPLETED' && before.recurrence && before.dueAt;
  // Guarded when it would spawn: a second tap that arrives after the first has completed
  // the row changes nothing, so it cannot create a second next occurrence.
  const updated = spawnsNext
    ? await updateTask(db, id, { ...input, dueAt, plannedDate, recurrence }, { onlyIfNotCompleted: true })
    : await updateTask(db, id, { ...input, dueAt, plannedDate, recurrence });
  if (spawnsNext && !updated) return getTask(db, id);
  // A recurring task spawns its next occurrence the moment it is completed, regardless
  // of which surface completed it (Home checkbox, detail, editor, assistant).
  if (updated && spawnsNext && before && before.recurrence && before.dueAt) {
    await createTask(db, {
      title: before.title,
      notes: before.notes,
      priority: before.priority,
      dueAt: nextOccurrenceAfterNow(before.dueAt, before.recurrence),
      recurrence: before.recurrence,
      status: 'PLANNED',
    });
  }
  return updated;
}

function validateRecurrence(value: TaskRecurrence | null | undefined): TaskRecurrence | null | undefined {
  if (value === undefined || value === null) return value;
  if (!TASK_RECURRENCES.includes(value)) throw new Error(`Unsupported recurrence: ${value}`);
  return value;
}

/**
 * Advance a due timestamp by one recurrence step, preserving the time-of-day.
 *
 * Counted in the app's zone (`appTimeZone`), not the phone's: a phone set to another zone
 * used to move a Dhaka 00:30 task by the wrong calendar day, and see the wrong weekend.
 * WEEKDAYS means Bangladesh's working week — Sunday to Thursday; Friday and Saturday are
 * the weekend.
 */
export function advanceRecurrence(iso: string, rule: TaskRecurrence, from = new Date(iso)): string {
  const [y = 1970, m = 1, d = 1] = bangladeshDateKey(from).split('-').map(Number);
  const clock = zonedClock(from);
  // A pure calendar day, walked in UTC so no zone can shift it.
  const day = new Date(Date.UTC(y, m - 1, d));
  if (rule === 'DAILY') day.setUTCDate(day.getUTCDate() + 1);
  else if (rule === 'WEEKLY') day.setUTCDate(day.getUTCDate() + 7);
  else if (rule === 'MONTHLY') {
    // Clamp to the last day of the target month so Jan 31 → Feb 28, not "Mar 3".
    day.setUTCDate(1);
    day.setUTCMonth(day.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
    day.setUTCDate(Math.min(d, lastDay));
  }
  else if (rule === 'WEEKDAYS') { do { day.setUTCDate(day.getUTCDate() + 1); } while (day.getUTCDay() === 5 || day.getUTCDay() === 6); }
  return zonedInstant(day.toISOString().slice(0, 10), clock);
}

/**
 * The first occurrence after `now`. Completing (or skipping) a daily task three days late
 * used to schedule the next one for a day already gone — past due, so no reminder ever
 * fired. Bounded, so a corrupt date can never spin.
 */
export function nextOccurrenceAfterNow(iso: string, rule: TaskRecurrence, now = Date.now()): string {
  let next = advanceRecurrence(iso, rule);
  for (let guard = 0; guard < 1000 && Date.parse(next) <= now; guard += 1) next = advanceRecurrence(next, rule);
  return next;
}

export async function completeTask(db: SQLiteDatabase, id: string): Promise<Task | null> {
  return editTask(db, id, { status: 'COMPLETED' });
}

/**
 * "Skip this one" — move a recurring task to its next occurrence without completing
 * it or spawning a duplicate. No-op (returns null) for a one-off task or one with no
 * due date, since there is no next occurrence to jump to.
 */
export async function skipRecurrence(db: SQLiteDatabase, id: string): Promise<Task | null> {
  const task = await getTask(db, id);
  if (!task || !task.recurrence || !task.dueAt) return null;
  return editTask(db, id, { dueAt: nextOccurrenceAfterNow(task.dueAt, task.recurrence) });
}

export async function rescheduleTask(db: SQLiteDatabase, id: string, dueAt: string): Promise<Task | null> {
  if (!dueAt) throw new Error('A due date is required to reschedule a task');
  // The planned day moves with it, or the task stayed on its old day as well (rc.6 QA T20).
  return editTask(db, id, { status: 'RESCHEDULED', dueAt, plannedDate: bangladeshDateKey(dueAt) });
}

export async function removeTask(db: SQLiteDatabase, id: string): Promise<boolean> { return deleteTask(db, id); }

export { findTasksByExactTitle, getTask, listTasks, searchTasks, ALLOWED_TRANSITIONS };