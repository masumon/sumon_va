export const M7_BACKUP_VERSION = 1 as const;

export interface M7BackupDocument {
  format: 'offline-memory-backup';
  version: typeof M7_BACKUP_VERSION;
  createdAt: string;
  data: Record<string, unknown>;
}

export function createM7BackupDocument(data: Record<string, unknown>, createdAt = new Date().toISOString()): M7BackupDocument {
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('Backup createdAt must be a valid ISO date');
  return { format: 'offline-memory-backup', version: M7_BACKUP_VERSION, createdAt, data };
}

export function parseM7BackupDocument(input: unknown): M7BackupDocument {
  if (!input || typeof input !== 'object') throw new Error('Backup must be an object');
  const value = input as Record<string, unknown>;
  if (value.format !== 'offline-memory-backup') throw new Error('Unsupported backup format');
  if (value.version !== M7_BACKUP_VERSION) throw new Error('Unsupported backup version');
  const createdAt = value.createdAt ?? value.exportedAt;
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) throw new Error('Backup createdAt must be a valid ISO date');
  if (!value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw new Error('Backup data must be an object');
  return { ...value, createdAt } as unknown as M7BackupDocument;
}
