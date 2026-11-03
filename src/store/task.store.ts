import type { SQLiteDatabase } from 'expo-sqlite';
import { create } from 'zustand';
import { addTask, completeTask, editTask, listTasks, removeTask, skipRecurrence } from '../services/task-service';
import { restoreTask } from '../services/task-repository';
import { runNotificationScheduler } from '../services/scheduler-runner';
import { recordFrequentTask, recordTimePattern } from '../services/learning-service';
import { bumpStreak } from '../services/streak-service';
import { logAppError } from '../services/error-log';
import type { CreateTaskInput, Task, UpdateTaskInput } from '../types/task-model';

// Reminders must be re-synced the moment a task changes — not only on the next app
// launch or 15-min tick. This runs on create *and* on complete / update / delete so a
// reminder for a task that is now done, rescheduled or date-cleared gets cancelled
// promptly (the scheduler reconciles + schedules and is fully idempotent).
// B-12: also clear a reminder that is already showing in the notification shade.
function dismissShown(taskId: string) {
  void import('../services/expo-notification-adapter').then((m) => m.dismissTaskNotifications(taskId)).catch(() => {});
}

function syncReminders(db: SQLiteDatabase) {
  void runNotificationScheduler(db).catch(() => {});
}

// Feed the on-device learning layer so capture gets smarter (time-of-day habits,
// frequent-task chips). Fire-and-forget; never blocks or throws.
function learnFromTask(db: SQLiteDatabase, task: Task | null) {
  if (!task) return;
  void recordFrequentTask(db, task.title).catch(() => {});
  if (task.dueAt) {
    const d = new Date(task.dueAt);
    if (!Number.isNaN(d.getTime())) void recordTimePattern(db, task.title, d.getHours() * 60 + d.getMinutes()).catch(() => {});
  }
}

interface TaskStore {
  tasks: Task[]; isLoading: boolean; error: string | null;
  load: (db: SQLiteDatabase) => Promise<void>;
  create: (db: SQLiteDatabase, input: CreateTaskInput) => Promise<Task | null>;
  update: (db: SQLiteDatabase, id: string, input: UpdateTaskInput) => Promise<Task | null>;
  complete: (db: SQLiteDatabase, id: string) => Promise<Task | null>;
  remove: (db: SQLiteDatabase, id: string) => Promise<boolean>;
  restore: (db: SQLiteDatabase, id: string) => Promise<boolean>;
  skipOccurrence: (db: SQLiteDatabase, id: string) => Promise<Task | null>;
  clearError: () => void;
}

const STORE_LOAD_LIMIT = 500;

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [], isLoading: false, error: null,
  load: async (db) => { set({ isLoading: true, error: null }); try { set({ tasks: await listTasks(db, { limit: STORE_LOAD_LIMIT }), isLoading: false }); } catch (error) { set({ isLoading: false, error: logAppError('task.load', error, 'Unable to load tasks') }); } },
  create: async (db, input) => { set({ error: null }); try { const task = await addTask(db, input); set((state) => ({ tasks: [task, ...state.tasks.filter((item) => item.id !== task.id)] })); syncReminders(db); learnFromTask(db, task); return task; } catch (error) { set({ error: logAppError('task.create', error, 'Unable to create task') }); return null; } },
  update: async (db, id, input) => { set({ error: null }); try { const task = await editTask(db, id, input); if (task) { set((state) => ({ tasks: task.status === 'ARCHIVED' ? state.tasks.filter((item) => item.id !== id) : state.tasks.map((item) => item.id === id ? task : item) })); // Completing a recurring task (via detail/editor "Mark complete") spawns its next occurrence in the DB — reload so it appears.
      if (input.status === 'COMPLETED' && task.status === 'COMPLETED' && task.recurrence) { try { set({ tasks: await listTasks(db, { limit: STORE_LOAD_LIMIT }) }); } catch { /* keep the optimistic list */ } } } syncReminders(db); return task; } catch (error) { set({ error: logAppError('task.update', error, 'Unable to update task') }); return null; } },
  complete: async (db, id) => { set({ error: null }); try { const task = await completeTask(db, id); if (task) { dismissShown(id); set((state) => ({ tasks: state.tasks.map((item) => item.id === id ? task : item) })); void bumpStreak(db).catch(() => {}); syncReminders(db); // A recurring task spawns its next occurrence in the DB on completion — reload so it shows without a manual refresh.
      if (task.recurrence && task.status === 'COMPLETED') { try { set({ tasks: await listTasks(db, { limit: STORE_LOAD_LIMIT }) }); } catch { /* keep the optimistic list */ } } } return task; } catch (error) { set({ error: logAppError('task.complete', error, 'Unable to complete task') }); return null; } },
  remove: async (db, id) => { set({ error: null }); try { const removed = await removeTask(db, id); if (removed) { dismissShown(id); set((state) => ({ tasks: state.tasks.filter((item) => item.id !== id) })); syncReminders(db); } return removed; } catch (error) { set({ error: logAppError('task.remove', error, 'Unable to delete task') }); return false; } },
  restore: async (db, id) => { set({ error: null }); try { const ok = await restoreTask(db, id); if (ok) { try { set({ tasks: await listTasks(db, { limit: STORE_LOAD_LIMIT }) }); } catch { /* keep list */ } syncReminders(db); } return ok; } catch (error) { set({ error: logAppError('task.restore', error, 'Unable to restore task') }); return false; } },
  skipOccurrence: async (db, id) => { set({ error: null }); try { const task = await skipRecurrence(db, id); if (task) { set((state) => ({ tasks: state.tasks.map((item) => item.id === id ? task : item) })); syncReminders(db); } return task; } catch (error) { set({ error: logAppError('task.skipOccurrence', error, 'Unable to skip this occurrence') }); return null; } },
  clearError: () => set({ error: null }),
}));
