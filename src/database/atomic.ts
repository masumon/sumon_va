import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Run a body so that either everything it wrote lands, or none of it does — and let those
 * bodies contain each other.
 *
 * `withTransactionAsync` cannot do the second part. SQLite has one transaction per
 * connection, so a service that opens its own transaction cannot be called from inside
 * another one: the inner `BEGIN` fails with "cannot start a transaction within a
 * transaction". That is why paying a debt from a wallet used to be two separate commits —
 * the debt ledger first, the money book after — and why a failure in between left the debt
 * marked paid with the wallet still full.
 *
 * SAVEPOINT is the same primitive without that restriction. The outermost one behaves
 * exactly like BEGIN DEFERRED; an inner one nests, and rolling back to it undoes only what
 * happened since. So a domain service can go on declaring its own boundary while a bridge
 * puts a wider one around two of them.
 *
 * Nothing here makes a write safe on its own. It makes a *set* of writes one decision.
 */

let counter = 0;

/**
 * Two kinds of transaction share the one connection: this file's SAVEPOINTs, and the plain
 * BEGIN/COMMIT of `withTransactionAsync` that a few older services still use. Every
 * statement is already queued one at a time (db-serializer), but a *transaction* is several
 * statements, and nothing stopped one kind from opening while the other was half done — an
 * unrelated COMMIT landing inside a savepoint commits half of it, and its RELEASE then fails
 * with "no such savepoint".
 *
 * So the two kinds take turns. `depth` counts open atomic() levels: a call made while one is
 * open is treated as nested (a savepoint inside it, exactly as before — this is how the money
 * bridge wraps two services), because JavaScript cannot tell a nested call from a concurrent
 * one. A BEGIN/COMMIT transaction can never be legitimately nested (SQLite refuses the inner
 * BEGIN), so `exclusiveTransaction` waits for atomic() to be idle, and atomic() waits for it.
 *
 * The wait is bounded. If it runs out, the call proceeds as it always did — the only way to
 * wait that long is to have been called from inside the other transaction's own body, and
 * waiting on yourself forever is worse than the old behaviour.
 */
let depth = 0;
let exclusiveOpen = false;
let waiters: (() => void)[] = [];
let waitLimitMs = 8_000;

function wakeWaiters(): void {
  const ready = waiters;
  waiters = [];
  for (const wake of ready) wake();
}

/**
 * Resolve once `take()` succeeds, or after the wait limit (false). `take` checks and claims
 * in one synchronous step, so two waiters woken together cannot both get in.
 */
async function waitFor(take: () => boolean): Promise<boolean> {
  const deadline = Date.now() + waitLimitMs;
  while (!take()) {
    const left = deadline - Date.now();
    if (left <= 0) return false;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { waiters = waiters.filter((w) => w !== wake); resolve(); }, left);
      const wake = () => { clearTimeout(timer); resolve(); };
      waiters.push(wake);
    });
  }
  return true;
}

export async function atomic<T>(db: SQLiteDatabase, body: () => Promise<T>): Promise<T> {
  // Outermost only: a nested level must never wait, or it would wait on its own parent.
  const claimed = depth > 0 ? false : await waitFor(() => {
    if (exclusiveOpen) return false;
    depth += 1;
    return true;
  });
  if (!claimed) depth += 1;
  try {
    return await savepoint(db, body);
  } finally {
    depth -= 1;
    if (depth === 0) wakeWaiters();
  }
}

async function savepoint<T>(db: SQLiteDatabase, body: () => Promise<T>): Promise<T> {
  // Unique per call, because the release below names the savepoint it is ending. Reusing
  // a name would release the wrong one when two levels happen to share it.
  const name = `va_sp_${(counter = (counter + 1) % Number.MAX_SAFE_INTEGER)}`;
  await db.execAsync(`SAVEPOINT ${name}`);
  let result: T;
  try {
    result = await body();
  } catch (error) {
    // ROLLBACK TO leaves the savepoint on the stack; RELEASE is what removes it. Both are
    // needed, and a failure to undo must not replace the error that caused it — the caller
    // needs to hear why the work was abandoned, not why the cleanup was awkward.
    try { await db.execAsync(`ROLLBACK TO ${name}; RELEASE ${name}`); } catch { /* the outer level will unwind */ }
    throw error;
  }
  await db.execAsync(`RELEASE ${name}`);
  return result;
}

/**
 * `db.withTransactionAsync(body)`, but taking its turn with atomic() (see above). Used by
 * the services that still open a plain BEGIN/COMMIT, so neither kind can land inside the
 * other. Behaves exactly like `withTransactionAsync` otherwise.
 */
export async function exclusiveTransaction(db: SQLiteDatabase, body: () => Promise<void>): Promise<void> {
  const claimed = await waitFor(() => {
    if (depth > 0 || exclusiveOpen) return false;
    exclusiveOpen = true;
    return true;
  });
  // Timed out: most likely called from inside a transaction's own body. Proceed as before
  // (SQLite will say so if a BEGIN really cannot open) rather than hang.
  if (!claimed) return db.withTransactionAsync(body);
  try {
    await db.withTransactionAsync(body);
  } finally {
    exclusiveOpen = false;
    wakeWaiters();
  }
}

/**
 * An atomic() level or an exclusiveTransaction is open right now. db-serializer reads this
 * so a query that fails on a dead connection is never retried elsewhere mid-transaction.
 */
export function isInsideTransaction(): boolean { return depth > 0 || exclusiveOpen; }

/** Tests only: shorten the bounded wait. */
export function setAtomicWaitLimitForTests(ms: number): void { waitLimitMs = ms; }
