import type { SQLiteDatabase } from 'expo-sqlite';
import { exclusiveTransaction } from '../database/atomic';
import { DATABASE_VERSION } from '../database';
import { parseM7BackupDocument } from './m7-format';
import { deleteDebtTables, insertDebtTables, validateDebtBackup } from './debt-tables';
import { deletePortableTables, insertPortableTables } from './portable-tables';

interface BackupRow { [key: string]: unknown }
const TASK_STATUSES = new Set(['INBOX', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'RESCHEDULED', 'ARCHIVED', 'CANCELLED']);
const PRIORITIES = new Set(['URGENT', 'HIGH', 'MEDIUM', 'LOW']);
const MEMORY_KINDS = new Set(['NOTE', 'FACT', 'PREFERENCE', 'EVENT', 'REFLECTION']);
/** This phone's own settings, kept across a restore (see restoreSQLiteBackupData). */
export const DEVICE_LOCAL_PREFS = ['aiModel', 'aiEngineId', 'autoBackupPassphrase', 'appFolderUri', 'autoBackupFolderUri', 'appLockHash'] as const;
/** Of those, the ones a restore must never write from the backup, even onto a phone without its own. */
const NEVER_FROM_BACKUP = new Set<string>(['appLockHash', 'autoBackupPassphrase', 'appFolderUri', 'autoBackupFolderUri']);
const MEMORY_SOURCES = new Set(['USER', 'SYSTEM', 'IMPORTED']);
/**
 * Owner kinds whose rows this file restores itself, and can therefore check by id.
 *
 * It is deliberately not the list of owner kinds that exist: modules register their own
 * (`HL_TEST`, `DEBT_ACCOUNT`, `DEBT_TRANSACTION`) through `registerAttachmentOwner`, and
 * a closed list here rejected the whole archive of anyone who had ever attached a photo
 * to a lab report. An unknown kind is carried through untouched; the reconciliation pass
 * in diagnostics is what finds one whose owner has gone.
 */
const CHECKABLE_ATTACHMENT_OWNERS = new Set(['TASK', 'MEMORY']);
/**
 * `app_preferences` is a plain key/value bag that every module writes its own keys into
 * (`aiEngineId`, `aiModel`, `module.enabled.*`, `finance.monthStart`, `streakCount`,
 * `lastBackupAt`, ...), same as `CHECKABLE_ATTACHMENT_OWNERS` above is not the list of
 * owner kinds that exist. This used to be a closed set of the three keys the restorer
 * knew about at the time, so restoring a backup from a phone that had ever touched the
 * AI engine picker, a module toggle, or even just taken a backup before (`lastBackupAt`
 * is written by the app itself right after every successful backup) failed outright with
 * "Unsupported preference key" — which in practice meant almost every real backup, since
 * the key is written before the row order even reaches an allowed one. Only the two keys
 * whose value shape actually matters elsewhere get checked; every other key rides through
 * verbatim, the same way an unrecognised attachment owner kind does.
 */

function rows(data: Record<string, unknown>, key: string): BackupRow[] {
  const value = data[key];
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error(`Backup field ${key} must be an array of objects`);
  return value as BackupRow[];
}
function optionalRows(data: Record<string, unknown>, key: string): BackupRow[] {
  if (!Object.prototype.hasOwnProperty.call(data, key)) return [];
  return rows(data, key);
}
function requiredString(row: BackupRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Backup ${key} must be a non-empty string`);
  return value;
}
function optionalString(row: BackupRow, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`Backup ${key} must be a string or null`);
  return value;
}
function requiredNumber(row: BackupRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Backup ${key} must be a finite number`);
  return value;
}
function uniqueId(row: BackupRow, key: string, seen: Set<string>): string {
  const id = requiredString(row, key);
  if (seen.has(id)) throw new Error(`Duplicate ${key}: ${id}`);
  seen.add(id);
  return id;
}
function validJsonArray(value: string): boolean {
  try { return Array.isArray(JSON.parse(value) as unknown); } catch { return false; }
}

export async function restoreSQLiteBackupData(db: SQLiteDatabase, input: unknown): Promise<void> {
  const backup = parseM7BackupDocument(input);
  const schemaVersion = backup.data.schemaVersion;
  if (typeof schemaVersion !== 'number' || schemaVersion < DATABASE_VERSION - 1 || schemaVersion > DATABASE_VERSION) throw new Error(`Unsupported database schema version: ${String(schemaVersion)}`);

  const appMetadata = rows(backup.data, 'appMetadata');
  // An empty value is a switched-off setting — turning App Lock on and off leaves
  // `appLockHash = ''` — and that one harmless row used to fail the whole restore (RC.1 QA).
  // This phone's own settings still win afterwards (keptPrefs below).
  const appPreferences = optionalRows(backup.data, 'appPreferences').filter((row) => row.value !== '');
  const tasks = rows(backup.data, 'tasks');
  const subtasks = rows(backup.data, 'subtasks');
  const memories = rows(backup.data, 'memories');
  const notificationDeliveries = rows(backup.data, 'notificationDeliveries');
  const hasAttachments = Object.prototype.hasOwnProperty.call(backup.data, 'attachments');
  const attachments = hasAttachments ? rows(backup.data, 'attachments') : [];
  // Optional so a backup taken before the debt module still restores cleanly.
  const hasDebt = Object.prototype.hasOwnProperty.call(backup.data, 'debt');
  const debt = hasDebt ? validateDebtBackup(backup.data.debt) : {};
  const hasRelations = Object.prototype.hasOwnProperty.call(backup.data, 'relations');
  const relations = hasRelations ? rows(backup.data, 'relations') : [];
  // People are restored before the debt tables that reference them, and after the delete
  // pass, so a foreign key never points at a person who is not there yet.
  const hasPeople = Object.prototype.hasOwnProperty.call(backup.data, 'people');
  const people = hasPeople ? rows(backup.data, 'people') : [];
  // Absent from archives written before v16; an older backup simply leaves these alone
  // rather than wiping readings the user has taken since.
  const hasMeasurements = Object.prototype.hasOwnProperty.call(backup.data, 'measurements');
  const measurements = hasMeasurements ? rows(backup.data, 'measurements') : [];
  const hasMeasurementTargets = Object.prototype.hasOwnProperty.call(backup.data, 'measurementTargets');
  const measurementTargets = hasMeasurementTargets ? rows(backup.data, 'measurementTargets') : [];

  const taskIds = new Set<string>();
  for (const row of tasks) {
    uniqueId(row, 'id', taskIds); requiredString(row, 'title');
    const status = requiredString(row, 'status'); if (!TASK_STATUSES.has(status)) throw new Error(`Unsupported task status: ${status}`);
    const priority = requiredString(row, 'priority'); if (!PRIORITIES.has(priority)) throw new Error(`Unsupported task priority: ${priority}`);
    if (schemaVersion >= 6) optionalString(row, 'planned_date');
    if (schemaVersion >= 9) optionalString(row, 'recurrence');
    if (schemaVersion >= 12) optionalString(row, 'deleted_at');
    requiredString(row, 'created_at'); requiredString(row, 'updated_at');
  }
  const subtaskIds = new Set<string>();
  for (const row of subtasks) {
    uniqueId(row, 'id', subtaskIds); const taskId = requiredString(row, 'task_id');
    if (!taskIds.has(taskId)) throw new Error(`Subtask references missing task: ${taskId}`);
    requiredString(row, 'title'); const completed = requiredNumber(row, 'completed');
    if (![0, 1].includes(completed)) throw new Error('Backup completed must be 0 or 1');
    requiredNumber(row, 'position'); requiredString(row, 'created_at'); requiredString(row, 'updated_at');
  }
  const memoryIds = new Set<string>();
  for (const row of memories) {
    uniqueId(row, 'id', memoryIds); requiredString(row, 'content');
    const importance = requiredNumber(row, 'importance');
    if (!Number.isInteger(importance) || importance < 1 || importance > 5) throw new Error('Backup importance must be an integer from 1 to 5');
    const archived = requiredNumber(row, 'archived'); if (![0, 1].includes(archived)) throw new Error('Backup archived must be 0 or 1');
    const kind = requiredString(row, 'kind'); if (!MEMORY_KINDS.has(kind)) throw new Error(`Unsupported memory kind: ${kind}`);
    const source = requiredString(row, 'source'); if (!MEMORY_SOURCES.has(source)) throw new Error(`Unsupported memory source: ${source}`);
    const tags = requiredString(row, 'tags_json'); if (!validJsonArray(tags)) throw new Error('Backup tags_json must be a valid JSON array');
    requiredString(row, 'created_at'); requiredString(row, 'updated_at');
  }
  const notificationKeys = new Set<string>();
  for (const row of notificationDeliveries) {
    const taskId = requiredString(row, 'task_id'); if (!taskIds.has(taskId)) throw new Error(`Notification references missing task: ${taskId}`);
    const dueAt = requiredString(row, 'due_at'); const key = `${taskId}\u0000${dueAt}`;
    if (notificationKeys.has(key)) throw new Error(`Duplicate notification delivery: ${taskId} ${dueAt}`);
    notificationKeys.add(key); requiredString(row, 'delivered_at');
  }
  const metadataKeys = new Set<string>();
  for (const row of appMetadata) { uniqueId(row, 'key', metadataKeys); requiredString(row, 'value'); requiredString(row, 'updated_at'); }
  const preferenceKeys = new Set<string>();
  for (const row of appPreferences) {
    const key = uniqueId(row, 'key', preferenceKeys);
    const value = requiredString(row, 'value');
    if (key === 'language' && !['en', 'bn'].includes(value)) throw new Error('Unsupported language preference');
    if (key === 'themeMode' && !['light', 'dark', 'system'].includes(value)) throw new Error('Unsupported theme preference');
  }
  if (hasAttachments) {
    const attachmentIds = new Set<string>();
    for (const row of attachments) {
      uniqueId(row, 'id', attachmentIds);
      const ownerType = requiredString(row, 'owner_type');
      const ownerId = requiredString(row, 'owner_id');
      if (CHECKABLE_ATTACHMENT_OWNERS.has(ownerType) && !(ownerType === 'TASK' ? taskIds : memoryIds).has(ownerId)) throw new Error(`Attachment references missing ${ownerType.toLowerCase()}: ${ownerId}`);
      requiredString(row, 'name'); requiredString(row, 'mime_type'); requiredString(row, 'uri');
      const size = row.size; if (size !== null && size !== undefined && (typeof size !== 'number' || !Number.isInteger(size) || size < 0)) throw new Error('Backup attachment size must be a non-negative integer or null');
      requiredString(row, 'created_at');
    }
  }

  if (hasRelations) {
    const relationIds = new Set<string>();
    for (const row of relations) {
      uniqueId(row, 'id', relationIds);
      // Any pair of kinds. The table used to hold only TASK -> MEMORY and this checked for
      // exactly that, which meant one wallet-paid debt -- a FINANCE_ENTRY -> DEBT_TRANSACTION
      // link written by the money bridge -- made the owner's entire archive unrestorable.
      const fromType = requiredString(row, 'from_type'); const toType = requiredString(row, 'to_type');
      const fromId = requiredString(row, 'from_id'); const toId = requiredString(row, 'to_id');
      if (fromType === 'TASK' && toType === 'MEMORY') {
        if (!taskIds.has(fromId)) throw new Error(`Relation references missing task: ${fromId}`);
        if (!memoryIds.has(toId)) throw new Error(`Relation references missing memory: ${toId}`);
      }
      requiredString(row, 'created_at');
    }
  }

  // Everything the generic copier owns — income, expenses, promises, places, follow-ups.
  // The reader nests them under `tables`; older archives have nothing there at all, and a
  // flat shape is accepted too so a hand-edited backup still restores.
  const portable = (backup.data as { tables?: Record<string, unknown> }).tables ?? (backup.data as Record<string, unknown>);

  await exclusiveTransaction(db, async () => {
    // Every delete, everywhere, before any insert, anywhere — not table-by-table. Some
    // of `fin_entries`/`hl_medicines`/`hl_visits` (portable) and `dr_accounts`/
    // `dr_transactions` (debt) reference `people`, which this function owns; deleting
    // `people` on its own turn, before those modules' own rows pointing at it were
    // cleared, threw "FOREIGN KEY constraint failed" against exactly the ordinary case —
    // a phone that already has people with linked debts or purchases — restoring onto a
    // phone with no prior data never touched this at all, which is why it took a real
    // device and a real restore to surface. `deletePortableTables`/`deleteDebtTables`
    // already clear each other's internal children-before-parents on their own; the only
    // thing missing was running both of *those* before `people`, and inserting `people`
    // back before either of those modules' own inserts need it to already exist.
    if (hasRelations) await db.runAsync('DELETE FROM relations');
    await deletePortableTables(db, portable);
    await deleteDebtTables(db);
    if (hasPeople) await db.runAsync('DELETE FROM people');
    if (hasMeasurements) await db.runAsync('DELETE FROM measurements');
    if (hasMeasurementTargets) await db.runAsync('DELETE FROM measurement_targets');
    if (hasAttachments) await db.runAsync('DELETE FROM attachments');
    await db.runAsync('DELETE FROM notification_deliveries');
    await db.runAsync('DELETE FROM subtasks');
    await db.runAsync('DELETE FROM memories');
    await db.runAsync('DELETE FROM tasks');
    await db.runAsync('DELETE FROM app_metadata');
    // Settings that belong to this phone, not to the data: the AI model installed here,
    // the auto-backup passphrase (never in a backup, so a restore used to delete it and
    // silently unlock every later backup), folder permissions granted on this phone, and
    // the app lock. A restore replaces the records; it must not undo these.
    const keptPrefs = await db.getAllAsync<{ key: string; value: string }>(
      `SELECT key, value FROM app_preferences WHERE key IN (${DEVICE_LOCAL_PREFS.map(() => '?').join(',')})`,
      ...DEVICE_LOCAL_PREFS,
    );
    await db.runAsync('DELETE FROM app_preferences');

    for (const row of tasks) await db.runAsync(`INSERT INTO tasks (id,title,notes,status,priority,due_at,planned_date,completed_at,recurrence,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, requiredString(row, 'id'), requiredString(row, 'title'), optionalString(row, 'notes'), requiredString(row, 'status'), requiredString(row, 'priority'), optionalString(row, 'due_at'), schemaVersion >= 6 ? optionalString(row, 'planned_date') : null, optionalString(row, 'completed_at'), schemaVersion >= 9 ? optionalString(row, 'recurrence') : null, requiredString(row, 'created_at'), requiredString(row, 'updated_at'), schemaVersion >= 12 ? optionalString(row, 'deleted_at') : null);
    for (const row of subtasks) await db.runAsync('INSERT INTO subtasks (id,task_id,title,completed,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', requiredString(row, 'id'), requiredString(row, 'task_id'), requiredString(row, 'title'), requiredNumber(row, 'completed'), requiredNumber(row, 'position'), requiredString(row, 'created_at'), requiredString(row, 'updated_at'));
    for (const row of memories) await db.runAsync('INSERT INTO memories (id,title,content,kind,source,tags_json,importance,archived,created_at,updated_at,last_accessed_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', requiredString(row, 'id'), optionalString(row, 'title'), requiredString(row, 'content'), requiredString(row, 'kind'), requiredString(row, 'source'), requiredString(row, 'tags_json'), requiredNumber(row, 'importance'), requiredNumber(row, 'archived'), requiredString(row, 'created_at'), requiredString(row, 'updated_at'), optionalString(row, 'last_accessed_at'), schemaVersion >= 12 ? optionalString(row, 'deleted_at') : null);
    if (hasAttachments) for (const row of attachments) await db.runAsync('INSERT INTO attachments (id,owner_type,owner_id,name,mime_type,size,uri,created_at) VALUES (?,?,?,?,?,?,?,?)', requiredString(row, 'id'), requiredString(row, 'owner_type'), requiredString(row, 'owner_id'), requiredString(row, 'name'), requiredString(row, 'mime_type'), row.size === null || row.size === undefined ? null : requiredNumber(row, 'size'), requiredString(row, 'uri'), requiredString(row, 'created_at'));
    for (const row of notificationDeliveries) await db.runAsync('INSERT INTO notification_deliveries (task_id,due_at,delivered_at) VALUES (?,?,?)', requiredString(row, 'task_id'), requiredString(row, 'due_at'), requiredString(row, 'delivered_at'));
    if (hasRelations) for (const row of relations) await db.runAsync('INSERT INTO relations (id,from_type,from_id,to_type,to_id,created_at) VALUES (?,?,?,?,?,?)', requiredString(row, 'id'), requiredString(row, 'from_type'), requiredString(row, 'from_id'), requiredString(row, 'to_type'), requiredString(row, 'to_id'), requiredString(row, 'created_at'));
    // `email` (v18) was left out here, so every restore wiped every saved email. Written
    // whenever this database has the column; a backup without it simply writes null.
    const peopleHasEmail = hasPeople && (await db.getAllAsync<{ name: string }>('PRAGMA table_info(people)')).some((c) => c.name === 'email');
    if (hasPeople) for (const row of people) {
      if (peopleHasEmail) await db.runAsync('INSERT INTO people (id,name,phone,email,address,relationship,notes,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?)', requiredString(row, 'id'), requiredString(row, 'name'), optionalString(row, 'phone'), optionalString(row, 'email'), optionalString(row, 'address'), optionalString(row, 'relationship'), optionalString(row, 'notes'), requiredString(row, 'created_at'), requiredString(row, 'updated_at'), optionalString(row, 'deleted_at'));
      else await db.runAsync('INSERT INTO people (id,name,phone,address,relationship,notes,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?)', requiredString(row, 'id'), requiredString(row, 'name'), optionalString(row, 'phone'), optionalString(row, 'address'), optionalString(row, 'relationship'), optionalString(row, 'notes'), requiredString(row, 'created_at'), requiredString(row, 'updated_at'), optionalString(row, 'deleted_at'));
    }
    if (hasMeasurements) for (const row of measurements) await db.runAsync('INSERT INTO measurements (id,metric,subject_type,subject_id,value_num,unit,at,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)', requiredString(row, 'id'), requiredString(row, 'metric'), requiredString(row, 'subject_type'), requiredString(row, 'subject_id'), Number(row.value_num), requiredString(row, 'unit'), requiredString(row, 'at'), row.note === null || row.note === undefined ? null : String(row.note), requiredString(row, 'created_at'));
    await insertPortableTables(db, portable);
    if (hasMeasurementTargets) for (const row of measurementTargets) await db.runAsync('INSERT INTO measurement_targets (metric,subject_type,subject_id,target_num,direction,unit,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', requiredString(row, 'metric'), requiredString(row, 'subject_type'), requiredString(row, 'subject_id'), Number(row.target_num), requiredString(row, 'direction'), requiredString(row, 'unit'), row.note === null || row.note === undefined ? null : String(row.note), requiredString(row, 'created_at'), requiredString(row, 'updated_at'));
    for (const row of appMetadata) await db.runAsync('INSERT INTO app_metadata (key,value,updated_at) VALUES (?,?,?)', requiredString(row, 'key'), requiredString(row, 'value'), requiredString(row, 'updated_at'));
    // The other phone's lock and granted folders never come over — not even when this phone
    // has none of its own: its App Lock PIN would lock this phone with a code its owner may
    // not know, and a folder URI is a permission this phone was never granted. (The AI
    // choice may still seed a phone that has none; keptPrefs below wins when it has one.)
    for (const row of appPreferences) {
      if (NEVER_FROM_BACKUP.has(requiredString(row, 'key'))) continue;
      await db.runAsync('INSERT INTO app_preferences (key,value) VALUES (?,?)', requiredString(row, 'key'), requiredString(row, 'value'));
    }
    for (const row of keptPrefs) await db.runAsync('INSERT OR REPLACE INTO app_preferences (key,value) VALUES (?,?)', row.key, row.value);
    if (hasDebt) await insertDebtTables(db, debt);
  });
}
