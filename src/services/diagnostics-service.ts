import type { SQLiteDatabase } from 'expo-sqlite';
import * as Notifications from 'expo-notifications';
import { DATABASE_VERSION } from '../database/migrations';
import { voiceOfflineStatus } from './voice-offline-service';

// The one number the migrations already carry. It used to be typed out again here, and
// then it stopped being updated — so a perfectly healthy phone on schema 21 was told it
// was expecting 11, which is a diagnostic reporting a fault in itself.
const EXPECTED_SCHEMA_VERSION = DATABASE_VERSION;

/**
 * Three answers, not two.
 *
 * "I could not check" is not "it is fine", and reporting it as `ok` is how this screen
 * came to say a database was sound at the exact moment the integrity pragma had thrown.
 * A screen whose whole job is to tell the truth about the app cannot have a state that
 * quietly rounds an unanswered question up to a pass.
 *
 * UNKNOWN is not a failure either: nothing is necessarily wrong, and nothing has been
 * shown to be right. The summary counts it apart from both.
 */
export type DiagnosticStatus = 'PASS' | 'FAIL' | 'UNKNOWN';

export type DiagnosticCheck = {
  /** An offer the screen can render as a button, for a fault the user can actually fix. */
  action?: 'DOWNLOAD_VOICE_PACK';
  /** A stable key per check. Open rather than a closed union: a module that adds its own
   *  check should not have to edit this type, and the screen renders whatever it is given. */
  id: string;
  label: string;
  status: DiagnosticStatus;
  /** True unless the check actually failed, so an unknown never reads as a fault. */
  ok: boolean;
  detail: string;
};

export type DiagnosticsReport = {
  /** Nothing failed. Separate from `verified`, which is the stronger claim. */
  ok: boolean;
  /** Everything was checked, and everything passed. */
  verified: boolean;
  passed: number;
  failed: number;
  unknown: number;
  checks: DiagnosticCheck[];
  generatedAt: string;
};

/** One place that keeps `ok` and `status` from ever disagreeing. */
function check(
  id: string, label: string, status: DiagnosticStatus, detail: string,
  action?: DiagnosticCheck['action'],
): DiagnosticCheck {
  return { id, label, status, ok: status !== 'FAIL', detail, ...(action ? { action } : {}) };
}

const why = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

export async function runDiagnostics(db: SQLiteDatabase): Promise<DiagnosticsReport> {
  const checks: DiagnosticCheck[] = [];

  try {
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const version = Number(row?.user_version ?? 0);
    checks.push(check('database', 'Local database',
      version === EXPECTED_SCHEMA_VERSION ? 'PASS' : 'FAIL',
      `Schema v${version}; expected v${EXPECTED_SCHEMA_VERSION}`));
  } catch (error) {
    checks.push(check('database', 'Local database', 'FAIL', why(error, 'Database check failed')));
  }

  try {
    const permission = await Notifications.getPermissionsAsync();
    checks.push(check('notifications', 'Notification permission',
      permission.granted ? 'PASS' : 'FAIL',
      permission.granted ? 'Granted' : `Not granted (${permission.status})`));
  } catch (error) {
    // The permission may well be granted. We simply do not know, and reporting "not
    // granted" sends someone into Android settings to fix what is not broken.
    checks.push(check('notifications', 'Notification permission', 'UNKNOWN', why(error, 'The permission state could not be read')));
  }

  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    checks.push(check('scheduled', 'Scheduled reminders', 'PASS', `${scheduled.length} reminder(s) currently scheduled by the OS`));
  } catch (error) {
    checks.push(check('scheduled', 'Scheduled reminders', 'UNKNOWN', why(error, 'The OS did not list its scheduled reminders')));
  }

  // ── is the file itself sound ───────────────────────────────────────────────
  //
  // `integrity_check` reads every page and every index; `foreign_key_check` finds rows
  // pointing at parents that no longer exist. Neither is expensive at this size, and
  // corruption found on this screen is corruption found before a backup is taken over it.
  try {
    const integrity = await db.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
    const orphans = await db.getAllAsync<Record<string, unknown>>('PRAGMA foreign_key_check');
    // "Could not be checked" is not "broken". An engine that does not answer the pragma
    // — an older SQLite, or a stub — must not be reported as corruption, the same way a
    // permission whose state cannot be read is reported as unknown rather than denied.
    const answered = integrity?.integrity_check !== undefined;
    const sound = !answered || integrity?.integrity_check === 'ok';
    checks.push(check('integrity', 'Database integrity',
      !answered ? 'UNKNOWN' : sound && orphans.length === 0 ? 'PASS' : 'FAIL',
      !answered
        ? 'This engine does not report an integrity check'
        : !sound
          ? `Integrity check reported: ${integrity?.integrity_check ?? 'unknown'}`
          : orphans.length
            ? `${orphans.length} row(s) point at records that no longer exist`
            : 'File and references are sound'));
  } catch (error) {
    // This is the one that mattered most. A thrown integrity pragma used to be reported
    // as a pass, so a corrupt file could be backed up over a good one with a green tick
    // on the screen the whole time.
    checks.push(check('integrity', 'Database integrity', 'UNKNOWN', `Could not be checked: ${why(error, 'unknown reason')}`));
  }

  // ── would a backup actually carry everything ──────────────────────────────
  //
  // This one exists because it once would not have. Six tables were added to the schema
  // and never added to the backup, so taking a backup and restoring it would have
  // silently destroyed every income entry, every promise and every pinned place. A test
  // guards it now; this check is the same question asked on the user's own database,
  // where a table created by a migration that half-ran would also show up.
  try {
    const { PORTABLE_TABLES } = await import('../backup/portable-tables');
    const known = new Set<string>([
      ...PORTABLE_TABLES.map((entry) => entry.table),
      'app_metadata', 'app_preferences', 'tasks', 'subtasks', 'memories',
      'notification_deliveries', 'relations', 'people', 'measurements',
      'measurement_targets', 'attachments', 'schema_migrations',
    ]);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    );
    const uncovered = tables
      .map((row) => row.name)
      .filter((name) => !known.has(name) && !name.startsWith('dr_') && !name.endsWith('_new'));
    checks.push(check('backup-coverage', 'Backup coverage',
      uncovered.length === 0 ? 'PASS' : 'FAIL',
      uncovered.length
        ? `Not carried by a backup: ${uncovered.join(', ')}`
        : 'Every table is included in a backup'));
  } catch (error) {
    checks.push(check('backup-coverage', 'Backup coverage', 'UNKNOWN', `Could not be checked: ${why(error, 'unknown reason')}`));
  }

  // ── what is actually in there ─────────────────────────────────────────────
  //
  // Not a pass/fail so much as a receipt. After a restore, or an upgrade that rebuilt
  // tables, the one thing a person wants to see is that their records are still counted.
  try {
    const counts: string[] = [];
    for (const [table, label] of [
      ['tasks', 'tasks'], ['memories', 'memories'], ['people', 'people'],
      ['dr_accounts', 'debts'], ['fin_entries', 'entries'], ['attachments', 'files'],
    ] as const) {
      try {
        const row = await db.getFirstAsync<{ n: number }>(
          `SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NULL`,
        );
        if (row) counts.push(`${row.n} ${label}`);
      } catch {
        // A table this schema version does not have yet contributes nothing.
      }
    }
    checks.push(check('records', 'Your records', 'PASS', counts.join(' · ') || 'Nothing saved yet'));
  } catch (error) {
    checks.push(check('records', 'Your records', 'UNKNOWN', `Could not be counted: ${why(error, 'unknown reason')}`));
  }

  // ── Can the microphone work with the connection off? ────────────────────────
  //
  // Reported honestly rather than hopefully: "we ask for on-device recognition" is not the
  // same claim as "this phone can do it", and only the second one is any use to someone
  // about to board a flight.
  try {
    const voice = await voiceOfflineStatus('bn');
    checks.push(check('voice-offline', 'Offline voice',
      // Only a missing pack is a fault, because only a missing pack can be fixed from
      // here. "This phone cannot do it" is a settled fact and passes; "the service did
      // not answer" is genuinely unknown, and now says so instead of passing.
      voice.state === 'MISSING' ? 'FAIL'
        : voice.state === 'INSTALLED' || voice.state === 'UNSUPPORTED' ? 'PASS' : 'UNKNOWN',
      voice.state === 'INSTALLED'
          ? `Bengali pack installed — speech works with no connection${voice.installedLocales.length > 1 ? ` (${voice.installedLocales.length} languages offline)` : ''}`
          : voice.state === 'MISSING'
            ? 'Language pack not downloaded — speech needs the internet until it is'
            : voice.state === 'UNSUPPORTED'
              ? 'This phone has no offline recogniser; typing and everything else still work offline'
              : 'The phone’s voice service did not answer',
      voice.canDownload ? 'DOWNLOAD_VOICE_PACK' : undefined));
  } catch {
    checks.push(check('voice-offline', 'Offline voice', 'UNKNOWN', 'Could not be checked'));
  }

  const tally = (status: DiagnosticStatus) => checks.filter((c) => c.status === status).length;
  const failures = tally('FAIL');
  const unknowns = tally('UNKNOWN');
  return {
    ok: failures === 0,
    verified: failures === 0 && unknowns === 0,
    passed: tally('PASS'),
    failed: failures,
    unknown: unknowns,
    checks,
    generatedAt: new Date().toISOString(),
  };
}

export { EXPECTED_SCHEMA_VERSION };
