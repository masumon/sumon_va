export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubtaskInput {
  taskId: string;
  title: string;
  position?: number;
}
