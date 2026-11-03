export type TaskStatus =
  | 'INBOX'
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'RESCHEDULED'
  | 'ARCHIVED'
  | 'CANCELLED';

export type TaskPriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';

export type { CreateTaskInput, Task, UpdateTaskInput } from './task-model';
export type { CreateSubtaskInput, Subtask } from './subtask-model';
export type { CreateMemoryInput, Memory, MemoryKind, MemorySource, UpdateMemoryInput } from './memory-model';
