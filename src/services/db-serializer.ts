import type { SQLiteDatabase } from 'expo-sqlite';
import { isInsideTransaction } from '../database/atomic';
import {
  DatabaseConnectionLostError, failedBeforeExecution, hasBeenLive, isDead, isDeadHandleError, isRetired, reportDeadHandle, waitForReplacement,
} from './db-connection';

type DbMethod = (...args: unknown[]) => Promise<unknown>;

/** `withTransactionAsync` bodies in flight, on any connection — see `inTransaction`. */
let openTransactions = 0;
const inTransaction = (): boolean => openTransactions > 0 || isInsideTransaction();

/** "getAllAsync:SELECT tasks" — enough for Diagnostics to say which screen's query it was. */
function describeCall(name: string, args: unknown[]): string {
  const sql = typeof args[0] === 'string' ? args[0] : '';
  const verb = /^\s*(\w+)/u.exec(sql)?.[1]?.toUpperCase();
  const table = /\b(?:FROM|INTO|UPDATE|JOIN)\s+["`]?(\w+)/iu.exec(sql)?.[1];
  return verb ? `${name}:${verb}${table ? ` ${table}` : ''}` : name;
}

/**
 * expo-sqlite@57's `prepareStatement()` -- the path behind every `execAsync`/`runAsync`/
 * `getAllAsync`/`getFirstAsync` call -- has no internal lock, unlike its own `run()`
 * (confirmed by reading `node_modules/expo-sqlite/android/.../SQLiteModule.kt`, NF-03 in
 * the register). Two calls issued close together from different screens can run on
 * different `Dispatchers.IO` threads against the one shared native connection at the same
 * moment -- the confirmed cause of every "NativeDatabase.execAsync/prepareAsync ...
 * NullPointerException" crash this app has hit, on a cold first launch's migration burst
 * and later during ordinary navigation alike.
 *
 * Patched in place on the one shared `SQLiteDatabase` instance every screen's
 * `useSQLiteContext()` already resolves to, so every existing call site is serialized with
 * no change to any of them: only one of these calls is ever actually in flight against the
 * connection, in the order they were made.
 *
 * Deliberately not queued: `prepareAsync` (the four methods above already call it
 * internally -- wrapping it too would queue a call behind itself and hang forever),
 * `withTransactionAsync`/`withExclusiveTransactionAsync` (same self-deadlock shape --
 * their own BEGIN/COMMIT/ROLLBACK go through the now-wrapped `execAsync`, which is enough;
 * `withTransactionAsync` is only counted, never queued), and `getEachAsync` (an async
 * generator, not a promise -- unused anywhere in this app, and queuing it the same way
 * would hand callers a promise instead of the iterator they expect).
 *
 * NF-06 self-healing (see db-connection.ts). When a call fails on a dead native handle:
 *   - outside any transaction, and failed before any SQL ran (prepare/exec entry), it is
 *     retried once on the connection the provider re-opens — the caller never sees it;
 *   - inside a transaction it is never retried: the caller gets one clear
 *     `DatabaseConnectionLostError`, and so does every later statement of that same
 *     transaction on this object (so nothing of it can land outside it, half-written);
 *   - any other stage (a `NativeStatement` step may already have written) is rethrown.
 * Either way the connection is renewed, and from then on every call on this object —
 * held by an old closure, store or hook dependency — goes to the live connection.
 */
export function serializeDatabaseCalls(db: SQLiteDatabase): void {
  const target = db as unknown as Record<string, DbMethod>;
  let tail: Promise<unknown> = Promise.resolve();
  let brokenTransaction = false;
  // Replaced, or dead after having been the live one: send it to the connection that is.
  const moved = (): boolean => isRetired(db) || (isDead(db) && hasBeenLive(db));

  const forward = async (name: string, args: unknown[], error?: unknown): Promise<unknown> => {
    const next = await waitForReplacement(db);
    if (!next) throw error ?? new Error('The database is reconnecting. Please try again.');
    return (next as unknown as Record<string, DbMethod>)[name]!(...args);
  };

  const recover = async (name: string, args: unknown[], error: unknown): Promise<unknown> => {
    if (!isDeadHandleError(error)) throw error;
    const midTransaction = inTransaction();
    reportDeadHandle(describeCall(name, args), error, Date.now(), db);
    if (midTransaction) {
      brokenTransaction = true;
      throw new DatabaseConnectionLostError(error);
    }
    if (!failedBeforeExecution(error) || !hasBeenLive(db)) throw error;
    return forward(name, args, error);
  };

  for (const name of ['execAsync', 'runAsync', 'getAllAsync', 'getFirstAsync'] as const) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    target[name] = (...args: unknown[]) => {
      if (brokenTransaction) {
        if (inTransaction()) return Promise.reject(new DatabaseConnectionLostError(undefined));
        brokenTransaction = false;
      }
      if (moved()) return forward(name, args);
      const attempt = tail.then(() => original.apply(db, args));
      // The queue waits for the attempt only, not for a recovery that may wait on a re-open.
      tail = attempt.then(() => undefined, () => undefined);
      return attempt.catch((error: unknown) => recover(name, args, error));
    };
  }

  // Backups read the whole file through this; an old object must not reach a dead handle.
  const serialize = target.serializeAsync;
  if (typeof serialize === 'function') {
    target.serializeAsync = (...args: unknown[]) => (moved() ? forward('serializeAsync', args) : serialize.apply(db, args));
  }

  const transaction = target.withTransactionAsync;
  if (typeof transaction === 'function') {
    target.withTransactionAsync = async (...args: unknown[]) => {
      openTransactions += 1;
      try {
        return await transaction.apply(db, args);
      } finally {
        openTransactions -= 1;
      }
    };
  }
}
