export type MemoryKind = 'NOTE' | 'FACT' | 'PREFERENCE' | 'EVENT' | 'REFLECTION';
export type MemorySource = 'USER' | 'SYSTEM' | 'IMPORTED';

export interface Memory {
  id: string;
  title: string | null;
  content: string;
  kind: MemoryKind;
  source: MemorySource;
  tags: string[];
  importance: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
}

export interface CreateMemoryInput {
  content: string;
  title?: string | null;
  kind?: MemoryKind;
  source?: MemorySource;
  tags?: string[];
  importance?: number;
}

export interface UpdateMemoryInput {
  content?: string;
  title?: string | null;
  kind?: MemoryKind;
  tags?: string[];
  importance?: number;
  archived?: boolean;
}
