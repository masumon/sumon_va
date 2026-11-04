// Every store action used to swallow its exception: the screen showed "could not load"
// and the real SQLite/native failure text was discarded at the moment it happened. That is
// why the intermittent "data suddenly stops loading" fault (NF-06) has never once been
// diagnosable — every investigation started with zero evidence.
//
// This keeps the caught error twice: in logcat, and in a small in-memory ring the
// Diagnostics screen can show. In-memory is enough for this fault on purpose — it is alive
// for as long as the process is, and force-closing the app is exactly what clears the
// symptom, so the evidence is still there while the user is looking at the broken screen.

export interface LoggedAppError {
  at: string;
  where: string;
  message: string;
}

const KEEP = 20;

/**
 * Text written for a developer, not for the person holding the phone: a native file error
 * ("No file exists at /data/user/0/…"), a URI, an exception class. Deliberately narrow —
 * the app's own messages (Bengali or English sentences) never match, so every call site
 * that already says something useful keeps saying it.
 */
const TECHNICAL = [
  /\b(?:file|content):\/\//iu,
  /\/data\/(?:user|data)\//u,
  /\bNo file exists\b/iu,
  /\b(?:java|kotlin|expo)\.[a-z]+\./u,
  /\b[A-Za-z]*Exception\b/u,
  /\bSQLITE_[A-Z]+\b/u,
  /\bCall to function\b/u,
];
export function isTechnicalMessage(message: string): boolean {
  return TECHNICAL.some((pattern) => pattern.test(message));
}
const recent: LoggedAppError[] = [];

/**
 * Record a caught error and hand back the message to show the user — a drop-in for the
 * `error instanceof Error ? error.message : fallback` this replaces, so no call site
 * changes what it displays.
 */
export function logAppError(where: string, error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  // The raw text is kept for Diagnostics; the screen gets the call site's own sentence.
  const message = isTechnicalMessage(raw) ? fallback : raw;
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  recent.unshift({ at: new Date().toISOString(), where, message: raw });
  if (recent.length > KEEP) recent.length = KEEP;
  console.error(`[sumon-va:${where}]`, detail);
  return message;
}

export function recentAppErrors(): readonly LoggedAppError[] {
  return recent;
}

export function clearAppErrors(): void {
  recent.length = 0;
}
