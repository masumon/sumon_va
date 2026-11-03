// One day, from every module at once.
//
// "What is happening on the tenth" is a single question, and until now it had four
// answers in four places: an installment in the debt ledger, a task in the planner, a
// reminder in the notification list, and a bill that only exists as a habit. Nobody plans
// a life four screens at a time.
//
// The gathering follows the same rule as the money picture: modules publish, this file
// adds up, and no module imports another. A module that knows nothing about dates simply
// does not implement `agenda` and never appears.

import type { SQLiteDatabase } from 'expo-sqlite';
import { bangladeshDateKey, type AppLanguage } from '../i18n/date-time';
import { enabledModules } from '../modules/registry';
import { listAllTasks } from './task-repository';
import type { Paisa } from './debt/money';

export type AgendaKind = 'DUE' | 'TASK' | 'REMINDER' | 'EXPECTED' | 'NOTE';

export interface AgendaItem {
  id: string;
  /** Which module put it there. */
  module: string;
  kind: AgendaKind;
  /** The local day it belongs to, "2026-09-10". */
  day: string;
  /** ISO instant when it is due, if a time was set. */
  at?: string;
  title: string;
  subtitle?: string;
  amountPaisa?: Paisa;
  route?: string;
  /** Higher sorts first within a day: something overdue outranks something merely planned. */
  weight: number;
  /** Already dealt with — shown struck through rather than hidden, so a day reads honestly. */
  done?: boolean;
}

export interface AgendaDay {
  day: string;
  items: AgendaItem[];
  /** Money that has to be found that day, across every module. */
  duePaisa: Paisa;
  overdue: boolean;
}

/**
 * The local day key, matching how the rest of the app slices dates.
 *
 * Dhaka is UTC+6, so between midnight and 6am `toISOString()` still reports yesterday.
 * Slicing it was giving the calendar the wrong "today" every night: the grid highlighted
 * the previous date and the detail pane listed the previous day's instalments. Home and
 * Planning already went through `bangladeshDateKey`, so the app disagreed with itself
 * about what day it was. There is one answer to that question and it lives here.
 */
export const dayKey = (value: string | Date = new Date()): string => bangladeshDateKey(value);

/** Every day from `from` to `to` inclusive, so an empty day is still a day. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * What every module has on, between two days.
 *
 * Each module is asked separately and its failure is its own: a module that throws
 * contributes nothing rather than emptying the calendar. That matters more here than
 * almost anywhere, because a blank calendar looks exactly like a free week.
 */
async function collectAgenda(
  db: SQLiteDatabase,
  language: AppLanguage,
  from: string,
  to: string,
): Promise<AgendaDay[]> {
  const modules = await enabledModules(db);
  const items: AgendaItem[] = [];

  // Tasks are core, not a module, so they had no `agenda` to publish and never reached the
  // calendar — the one screen whose whole promise is "কিস্তি, কাজ, নিয়মিত খরচ, সব এক
  // জায়গায়". The kind and the legend were already here waiting for them.
  try {
    for (const task of await listAllTasks(db)) {
      if (task.status === 'ARCHIVED') continue;
      const day = task.plannedDate ?? (task.dueAt ? dayKey(task.dueAt) : null);
      if (!day || day < from || day > to) continue;
      const done = task.status === 'COMPLETED';
      items.push({
        id: `task:${task.id}`,
        module: 'tasks',
        kind: 'TASK',
        day,
        at: task.dueAt ?? undefined,
        title: task.title,
        route: `/task-detail?id=${task.id}`,
        // Overdue and undone outranks something merely planned, which is the same rule the
        // modules use, so one day's list reads in one order.
        weight: done ? 0 : task.dueAt && dayKey(task.dueAt) < dayKey() ? 90 : 50,
        done,
      });
    }
  } catch {
    // The calendar still shows every module's day.
  }

  for (const module of modules) {
    if (!module.agenda) continue;
    try {
      items.push(...(await module.agenda(db, language, from, to)));
    } catch {
      // One module's silence, not everyone's.
    }
  }

  const today = dayKey();
  const byDay = new Map<string, AgendaItem[]>();
  for (const item of items) {
    if (item.day < from || item.day > to) continue;
    const list = byDay.get(item.day) ?? [];
    list.push(item);
    byDay.set(item.day, list);
  }

  return daysBetween(from, to).map((day) => {
    const dayItems = (byDay.get(day) ?? []).sort((a, b) => b.weight - a.weight);
    return {
      day,
      items: dayItems,
      duePaisa: dayItems.reduce((total, item) => total + (item.done ? 0 : item.amountPaisa ?? 0), 0),
      overdue: day < today && dayItems.some((item) => !item.done),
    };
  });
}

/** The month a calendar screen shows, day by day. */
export async function agendaForMonth(db: SQLiteDatabase, language: AppLanguage, month: string): Promise<AgendaDay[]> {
  const first = `${month}-01`;
  const lastDate = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0);
  const last = `${month}-${String(lastDate.getDate()).padStart(2, '0')}`;
  return collectAgenda(db, language, first, last);
}
