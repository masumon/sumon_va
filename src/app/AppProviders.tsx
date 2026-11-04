import type { PropsWithChildren } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { migrateDatabase } from '../database/migrations';
import { serializeDatabaseCalls } from '../services/db-serializer';
import { onDeadHandle, pinDatabase, SEPARATE_CONNECTION, setLiveDatabase } from '../services/db-connection';
import { AppPreferencesProvider } from './AppPreferences';
import { AppFeedbackProvider } from '../ui/AppFeedback';

/**
 * The very first connection a fresh install opens has to run `migrateDatabase`'s entire
 * chain -- twenty-odd statements, back to back, with nothing cached and nothing warmed up
 * yet. That exact opening burst occasionally rejected with a native `NullPointerException`
 * on the first cold launch right after installing a new build, and the very next launch --
 * same code, same data, nothing changed -- was always clean: the confirmed root cause
 * (NF-03) is that expo-sqlite's `prepareStatement()` has no internal lock, so calls issued
 * close together race on the shared native connection. `serializeDatabaseCalls` in
 * `onDatabaseInit` below closes that race at the source for this call and every one after
 * it. `SQLiteProvider` has no retry of its own regardless; left alone, `onError`'s default
 * handler just rethrows and the whole app crashes on a person's very first open.
 *
 * The retry stays as a second layer, not a replacement: `key={attempt}` forces
 * `SQLiteProvider` to unmount and remount from scratch -- a real do-over, not a patch on
 * the failed instance -- for whatever this doesn't catch. If a second attempt *also*
 * fails, this stops retrying and lets the error surface for real: two failures in a row
 * past a fresh connection are not the same fragile-first-open case this exists for.
 */
function DatabaseGate({ children }: PropsWithChildren) {
  const [attempt, setAttempt] = useState(0);
  const [fatal, setFatal] = useState<Error | null>(null);
  // NF-06: bumped when a query hits a dead native handle; the provider then re-opens. Every
  // open — the first one included — is its own connection (SEPARATE_CONNECTION): a shared
  // one can be killed by any other wrapper of it being garbage-collected, and re-opening it
  // would hand back the same dead handle.
  const [revived, setRevived] = useState(0);
  useEffect(() => onDeadHandle(() => setRevived((n) => n + 1)), []);
  const onError = useCallback((e: Error) => {
    // Functional update, not a separate effect: the retry decision only needs the attempt
    // count that was already current, and this keeps it to the one render `onError` itself
    // already triggers rather than a second pass through an effect right after.
    setAttempt((previous) => {
      if (previous < 1) return previous + 1;
      setFatal(e);
      return previous;
    });
  }, []);
  const onDatabaseInit = useCallback(async (db: SQLiteDatabase) => {
    // Before anything else touches this connection, including migration's own burst of
    // statements -- see db-serializer.ts.
    pinDatabase(db); // never collectable while the app runs — see db-connection.ts
    serializeDatabaseCalls(db);
    await migrateDatabase(db);
    // Only now is it the app's connection: anything still holding an older one is
    // forwarded here, and a query that hit a dead handle is retried here (db-serializer).
    setLiveDatabase(db);
  }, []);
  if (fatal) throw fatal;
  return <SQLiteProvider key={`${attempt}-${revived}`} databaseName="sumon-va.db" options={SEPARATE_CONNECTION} onInit={onDatabaseInit} onError={onError}>{children}</SQLiteProvider>;
}

// Only the settings database, the preferences and the snackbar: alerts and sync live in the native va-bridge service.
export function AppProviders({ children }: PropsWithChildren) {
  return <DatabaseGate><AppPreferencesProvider><AppFeedbackProvider>{children}</AppFeedbackProvider></AppPreferencesProvider></DatabaseGate>;
}
