import type { TaskPriority, TaskStatus } from './index';

export type TaskRecurrence = 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY';
export const TASK_RECURRENCES: TaskRecurrence[] = ['DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY'];

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  plannedDate: string | null;
  completedAt: string | null;
  recurrence?: TaskRecurrence | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  notes?: string | null;
  priority?: TaskPriority;
  dueAt?: string | null;
  plannedDate?: string | null;
  status?: TaskStatus;
  recurrence?: TaskRecurrence | null;
}

export interface UpdateTaskInput {
  title?: string;
  notes?: string | null;
  priority?: TaskPriority;
  dueAt?: string | null;
  plannedDate?: string | null;
  status?: TaskStatus;
  recurrence?: TaskRecurrence | null;
}
