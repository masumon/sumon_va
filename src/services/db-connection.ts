import type { SQLiteDatabase } from 'expo-sqlite';
import { logAppError } from './error-log';

// NF-06 — "data disappears from every screen but Home, and comes back after a restart".
//
// Root cause (expo-sqlite 57.0.x / expo-modules-core 57.0.x, Android only): opening the
// same file again with the same options returns the *same* native connection under a new
// JS wrapper. When any such extra wrapper is garbage-collected, `NativeDatabase.
// sharedObjectDidRelease()` closes the native handle without checking its refCount — so
// the connection the app is still using dies, and every later query rejects with
// "NativeDatabase.prepareAsync … NullPointerException". The data on disk is untouched,
// which is why a restart (a fresh connection) brings everything back.
// Upstream: https://github.com/expo/expo/issues/28176 · https://github.com/boardsesh/boardsesh/issues/5410
//
// Four defences, all here or wired from here:
//   1. every opener — the app's own provider included — uses `useNewConnection: true`, so
//      no connection is ever handed out twice, and no stray wrapper can kill the app's;
//   2. every connection the app itself opens is pinned, so its wrapper can never be
//      collected while the app runs;
//   3. if a dead handle is still seen, the provider re-opens on a brand-new connection —
//      rate-limited, never given up on;
//   4. the call that hit it is retried once on the new connection when that is provably
//      safe, and every later call on the old object is forwarded (db-serializer.ts).

const pinned = new Set<SQLiteDatabase>();

/** Keep a strong reference for the life of the app, so GC can never close it. */
export function pinDatabase(db: SQLiteDatabase): void {
  pinned.add(db);
}

/** Opening options for every connection, the provider's included — never a shared one. */
export const SEPARATE_CONNECTION = { useNewConnection: true } as const;

export function isDeadHandleError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? '')}` : String(error);
  return /NullPointerException/u.test(text) && /NativeDatabase|NativeStatement|prepareAsync/u.test(text);
}

/**
 * True only when the native call that failed is one that cannot have run any SQL: the
 * NPE is thrown on entry to a method of the reset `NativeDatabaseBinding`, before its C++
 * side exists to do anything. `prepareAsync` only compiles; `execAsync` is one
 * `sqlite3_exec` call on that binding. A `NativeStatement.*` failure is NOT safe: `run()`
 * steps the statement first and only then reads `database.ref` for changes/rowid — the
 * write may already have landed when the NPE comes.
 */
export function failedBeforeExecution(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /NativeDatabase\.(?:prepareAsync|execAsync)\b/u.test(text);
}

/** Thrown in place of the native error when a connection dies inside a transaction. */
export class DatabaseConnectionLostError extends Error {
  constructor(cause: unknown) {
    super('The database connection was lost in the middle of a save, so none of it was saved. Please try again.');
    this.name = 'DatabaseConnectionLostError';
    (this as { cause?: unknown }).cause = cause;
  }
}

// --- The live connection --------------------------------------------------------------
// The provider registers each connection here once it is open and migrated. Anything still
// holding an older one (a closure, a store, a hook dependency) is forwarded to this one.

let live: SQLiteDatabase | null = null;
let everLive = new WeakSet<SQLiteDatabase>();
let retired = new WeakSet<SQLiteDatabase>();
let dead = new WeakSet<SQLiteDatabase>();
let liveWaiters: (() => void)[] = [];

export function setLiveDatabase(db: SQLiteDatabase): void {
  if (live && live !== db) retired.add(live);
  live = db;
  everLive.add(db);
  revivalPendingSince = null;
  const ready = liveWaiters;
  liveWaiters = [];
  for (const wake of ready) wake();
}

/**
 * Registered by the provider at some point. A connection still in its own `onInit`
 * (migrations) is not: a failure there is left to the provider's own retry, never healed
 * onto another connection — two migration runs must not interleave.
 */
export function hasBeenLive(db: SQLiteDatabase): boolean { return everLive.has(db); }

/** Replaced by a newer connection: every call on it should go to the live connection. */
export function isRetired(db: SQLiteDatabase): boolean { return retired.has(db); }

/** Seen to fail on a dead native handle; nothing more should be sent to it. */
export function isDead(db: SQLiteDatabase): boolean { return dead.has(db); }

/** The connection that replaced `old`, or null if none is ready within `timeoutMs`. */
export function waitForReplacement(old: SQLiteDatabase, timeoutMs = 8_000): Promise<SQLiteDatabase | null> {
  const current = (): SQLiteDatabase | null => (live && live !== old && !dead.has(live) ? live : null);
  const now = current();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { liveWaiters = liveWaiters.filter((w) => w !== check); resolve(null); }, timeoutMs);
    const check = () => {
      const next = current();
      if (next) { clearTimeout(timer); resolve(next); } else liveWaiters.push(check);
    };
    liveWaiters.push(check);
  });
}

// --- Revival ----------------------------------------------------------------------------

type Listener = () => void;
let listener: Listener | null = null;
let lastRevival = Number.NEGATIVE_INFINITY;
let revivalPendingSince: number | null = null;
let deferred: ReturnType<typeof setTimeout> | null = null;
let recentRevivals: number[] = [];
/** At most one re-open per this long — a burst of failures from one death is one re-open. */
const REVIVAL_GAP_MS = 5_000;
/** A re-open that never produced a connection (open failed) may be asked for again. */
const REVIVAL_STUCK_MS = 15_000;
const STORM_WINDOW_MS = 10 * 60_000;
const STORM_COUNT = 10;

/** The provider registers here to re-open on a fresh connection. */
export function onDeadHandle(fn: Listener): () => void {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

function revive(now: number): void {
  deferred = null;
  if (!listener) return;
  lastRevival = now;
  revivalPendingSince = now;
  recentRevivals = [...recentRevivals.filter((t) => now - t < STORM_WINDOW_MS), now];
  if (recentRevivals.length > STORM_COUNT) {
    // Still re-opening — giving up would leave the app dead until a restart, which is the
    // exact thing this exists to prevent. Loud, so Diagnostics shows something is wrong.
    logAppError('database:dead-handle:storm', new Error(`${recentRevivals.length} connection re-opens in 10 minutes`), 'database connection keeps dropping');
  }
  listener();
}

/**
 * Called when a query failed on a dead handle. Recorded with its time (so Diagnostics shows
 * each death) and the connection is renewed: at once, or — if one was renewed under five
 * seconds ago — as soon as that gap is up. Never more often, and never given up on.
 * `db` is the connection that failed; a failure on one already replaced is only recorded.
 */
export function reportDeadHandle(where: string, error: unknown, now = Date.now(), db?: SQLiteDatabase): boolean {
  if (db) {
    if (dead.has(db)) return false; // this death is already recorded and being handled
    dead.add(db);
  }
  logAppError(`database:dead-handle:${where}`, error, 'database connection lost');
  if (db && live && db !== live) return false; // an old connection; calls on it are forwarded
  if (!listener) return false;
  if (revivalPendingSince !== null && now - revivalPendingSince < REVIVAL_STUCK_MS) return false;
  if (deferred) return false;
  const wait = lastRevival + REVIVAL_GAP_MS - now;
  if (wait > 0) {
    deferred = setTimeout(() => revive(lastRevival + REVIVAL_GAP_MS), wait);
    return false;
  }
  revive(now);
  return true;
}

/** For tests. */
export function resetDbConnectionState(): void {
  pinned.clear(); listener = null; lastRevival = Number.NEGATIVE_INFINITY; revivalPendingSince = null;
  if (deferred) clearTimeout(deferred);
  deferred = null; recentRevivals = []; live = null; liveWaiters = [];
  everLive = new WeakSet(); retired = new WeakSet(); dead = new WeakSet();
}
export function pinnedCount(): number { return pinned.size; }
