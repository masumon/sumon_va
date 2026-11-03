import type { Task } from '../types/task-model';
import type { TaskPriority } from '../types';
import { bangladeshDateKey } from '../i18n/date-time';

// Pure weekly-review aggregate over the task list — no DB, no store, unit-testable.
// "This week" runs from the user's week-start day through the next 7 days, in Asia/Dhaka.

export type WeekdayCount = { key: string; label: string; count: number };
export type WeeklyReview = {
  weekStartKey: string;
  weekEndKey: string;
  completed: number;
  created: number;
  stillOpen: number;
  overdue: number;
  carriedOver: number;
  completionRate: number; // 0..1 over (completed + open tasks that were due/planned this week)
  byPriority: Record<TaskPriority, number>; // completed, by priority
  byDay: WeekdayCount[]; // completions per day of the review week
  busiestDay: WeekdayCount | null;
};

const CLOSED: Task['status'][] = ['COMPLETED', 'CANCELLED', 'ARCHIVED'];
const WD_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfWeek(now: Date, weekStartsOn: number): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const shift = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - shift);
  return d;
}

export function weeklyReview(tasks: Task[], now: Date, weekStartsOn: number): WeeklyReview {
  const start = startOfWeek(now, weekStartsOn);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const startKey = bangladeshDateKey(start);
  const endKey = bangladeshDateKey(new Date(end.getTime() - 1));
  const inWeek = (iso: string | null | undefined) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= start.getTime() && t < end.getTime();
  };

  const byPriority: Record<TaskPriority, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 };
  const dayCounts = new Map<string, number>();
  let completed = 0;
  let created = 0;
  let stillOpen = 0;
  let overdue = 0;
  let carriedOver = 0;
  let plannedThisWeek = 0;
  const nowMs = now.getTime();

  for (const task of tasks) {
    if (inWeek(task.createdAt)) created += 1;

    if (task.status === 'COMPLETED' && inWeek(task.completedAt)) {
      completed += 1;
      byPriority[task.priority] += 1;
      const key = bangladeshDateKey(task.completedAt as string);
      dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
    }

    const open = !CLOSED.includes(task.status);
    if (open) {
      stillOpen += 1;
      const anchor = task.dueAt ?? (task.plannedDate ? `${task.plannedDate}T00:00:00` : null);
      if (task.dueAt && new Date(task.dueAt).getTime() < nowMs) overdue += 1;
      if (anchor && new Date(anchor).getTime() < start.getTime()) carriedOver += 1;
      if (anchor && inWeek(anchor)) plannedThisWeek += 1;
    }
  }

  const byDay: WeekdayCount[] = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = bangladeshDateKey(d);
    return { key, label: WD_EN[d.getDay()]!, count: dayCounts.get(key) ?? 0 };
  });
  const busiestDay = byDay.reduce<WeekdayCount | null>((best, d) => (d.count > 0 && (!best || d.count > best.count) ? d : best), null);

  const denom = completed + plannedThisWeek;
  return {
    weekStartKey: startKey,
    weekEndKey: endKey,
    completed,
    created,
    stillOpen,
    overdue,
    carriedOver,
    completionRate: denom > 0 ? completed / denom : 0,
    byPriority,
    byDay,
    busiestDay,
  };
}
