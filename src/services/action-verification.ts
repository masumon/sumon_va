import type { SQLiteDatabase } from 'expo-sqlite';
import type { ActionExecutionResult } from './ai-action-executor';
import { getEntry } from './finance-service';
import { getTask } from './task-repository';
import { getMemory } from './memory-repository';
import { getAccount } from './debt/repository';

/**
 * Understand → validate → execute → **verify** → respond. A service returning is not proof
 * the row is there: this reads each write back from the database and checks the fields
 * that matter, so the Assistant never says "done" about something that did not land.
 * Reads are answered as-is. Returns the reason on a mismatch, or null when it checks out.
 */
export async function verifyActionResult(db: SQLiteDatabase, result: ActionExecutionResult): Promise<string | null> {
  switch (result.type) {
    case 'ENTRY_RECORDED': {
      const row = await getEntry(db, result.entry.id);
      if (!row) return 'entry-missing';
      return row.amountPaisa === result.entry.amountPaisa && row.kind === result.entry.kind ? null : 'entry-mismatch';
    }
    case 'TASK_CREATED':
    case 'TASK_RESCHEDULED': {
      const row = await getTask(db, result.task.id);
      if (!row) return 'task-missing';
      return row.title === result.task.title && (row.dueAt ?? null) === (result.task.dueAt ?? null) ? null : 'task-mismatch';
    }
    case 'TASK_COMPLETED': {
      const row = await getTask(db, result.task.id);
      return row && row.status === result.task.status ? null : 'task-not-completed';
    }
    case 'MEMORY_CREATED': {
      const row = await getMemory(db, result.memory.id);
      return row ? null : 'memory-missing';
    }
    case 'DEBT_CREATED': {
      const row = await getAccount(db, result.account.id);
      return row && row.principalPaisa === result.account.principalPaisa ? null : 'debt-missing';
    }
    case 'APP_REPLY': {
      // Only the commands that said "done" have something to read back.
      if (!result.done) return null;
      const dose = result.trace.find((t) => t.startsWith('dose:'))?.slice(5);
      if (dose) {
        const row = await db.getFirstAsync<{ status: string }>('SELECT status FROM hl_doses WHERE id = ?', dose);
        return row?.status === 'TAKEN' ? null : 'dose-not-taken';
      }
      if (result.trace.includes('app-command:backup')) {
        const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_preferences WHERE key = 'lastAutoBackupAt'");
        const at = row ? Date.parse(row.value) : NaN;
        return Number.isFinite(at) && Date.now() - at < 10 * 60_000 ? null : 'backup-not-recorded';
      }
      return null;
    }
    default:
      return null;
  }
}

export class ActionNotVerifiedError extends Error {
  constructor(public readonly reason: string) {
    super(`The change could not be confirmed in the database (${reason})`);
    this.name = 'ActionNotVerifiedError';
  }
}
