import type { SQLiteDatabase } from 'expo-sqlite';
import { exclusiveTransaction } from '../database/atomic';
import type { Task } from '../types/task-model';
import { editTask, getTask, listTasks } from './task-service';
import { bangladeshDateKey, zonedInstant } from '../i18n/date-time';

export interface DailyPlan { date: string; overdue: Task[]; inProgress: Task[]; scheduled: Task[]; inbox: Task[]; }

function localDateKey(date: Date): string {
  return bangladeshDateKey(date);
}

/** The Dhaka day a timestamp falls on, or null when there is no timestamp to read. */
function dayKeyOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return bangladeshDateKey(value);
  } catch {
    return null;
  }
}

export async function getDailyPlan(db: SQLiteDatabase, date = new Date()): Promise<DailyPlan> {
  const dateKey = localDateKey(date);
  const [inbox, inProgress, plannedOnly, rescheduled] = await Promise.all([
    listTasks(db, { status: 'INBOX', limit: 500 }),
    listTasks(db, { status: 'IN_PROGRESS', limit: 500 }),
    listTasks(db, { status: 'PLANNED', limit: 500 }),
    // A moved task is still a planned one (rc.6 QA T20: "মিটিং … সরিয়ে দাও" left it on no day).
    listTasks(db, { status: 'RESCHEDULED', limit: 500 }),
  ]);
  const planned = [...plannedOnly, ...rescheduled];
  // Midnight of that day in Dhaka, as a real instant — the same zone `dateKey` is read
  // in. Built from the device's own calendar it drifted by six hours, so for the first
  // part of every day a task due last night was not yet "overdue".
  const startMs = new Date(zonedInstant(dateKey)).getTime();
  // "Today" has to mean the same thing here as it does on Home, or the two screens count
  // the same day differently and neither number can be trusted. A task due today is on
  // today whether or not anyone dragged it into the plan; Home always counted it, this
  // list did not, so Home said four and Planning said three about one afternoon.
  //
  // `dayKeyOf` exists because a task planned for another day with no due date used to
  // reach the date reader as an empty string, which throws — and one such task made the
  // whole screen fail to load, not just that row.
  const isForToday = (task: Task) => task.plannedDate === dateKey || dayKeyOf(task.dueAt) === dateKey;
  const scheduled = [...planned, ...inProgress].filter((task) => task.dueAt !== null || task.plannedDate !== null).filter(isForToday);
  const scheduledIds = new Set(scheduled.map((task) => task.id));
  // A task already shown under "scheduled today" must not also appear under "overdue" —
  // that used to render the same row twice.
  // Compared as instants, not as strings. Two ISO timestamps only sort correctly
  // character by character when both were written in the same offset, and nothing
  // guarantees that for a value that has passed through an import or an edit.
  const overdue = [...planned, ...inProgress]
    .filter((task) => {
      if (task.dueAt === null || scheduledIds.has(task.id)) return false;
      const due = new Date(task.dueAt).getTime();
      return Number.isFinite(due) && due < startMs;
    })
    .sort((a, b) => new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime());
  return { date: dateKey, overdue, inProgress, scheduled, inbox };
}

export async function planInboxTasks(db: SQLiteDatabase, taskIds: string[], date = new Date()): Promise<Task[]> {
  const uniqueIds = [...new Set(taskIds.filter(Boolean))];
  if (!uniqueIds.length) return [];
  const dateKey = localDateKey(date);
  const planned: Task[] = [];
  await exclusiveTransaction(db, async () => {
    for (const id of uniqueIds) {
      const existing = await getTask(db, id);
      if (!existing) throw new Error(`Task not found: ${id}`);
      if (existing.status !== 'INBOX') throw new Error(`Only inbox tasks can be planned: ${id}`);
      const current = await editTask(db, id, { status: 'PLANNED', plannedDate: dateKey });
      if (!current) throw new Error(`Task not found: ${id}`);
      planned.push(current);
    }
  });
  return planned;
}
