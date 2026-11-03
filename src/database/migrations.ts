import type { SQLiteDatabase } from 'expo-sqlite';

const DATABASE_VERSION = 26;

/**
 * Copy the database file before touching it.
 *
 * A migration that rebuilds tables — and several of these do — is the one moment the whole
 * of someone's records passes through code that has never run on their particular data.
 * Every migration here is transactional and tested, and that is still not the same as
 * having the file from five seconds ago.
 *
 * The copy is kept beside the database, overwritten each upgrade, and costs one file copy
 * on the launches where the version actually changes. If anything about it fails, the
 * migration proceeds anyway: refusing to start the app because a precaution did not work
 * would turn a safety net into an outage.
 */
async function keepASafetyCopy(db: SQLiteDatabase, currentVersion: number): Promise<void> {
  try {
    // In WAL mode the newest commits may still sit in the -wal file; copying only the .db
    // would keep a copy missing them. Fold them in first.
    try { await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* copy what is there */ }
    const { Directory, File, Paths } = await import('expo-file-system');
    const source = new File(Paths.document, 'SQLite', 'offline-memory.db');
    if (!source.exists) return;
    const backups = new Directory(Paths.document, 'SQLite');
    backups.create({ intermediates: true, idempotent: true });
    const destination = new File(backups, `offline-memory.pre-v${currentVersion}.db`);
    if (destination.exists) destination.delete();
    source.copy(destination);
  } catch {
    // A precaution that cannot be taken must not stop the app from opening.
  }
}

export type MigrateOptions = {
  /** A scratch database (e.g. an archive being restored) must not overwrite the real
   *  database's pre-vN safety copy with a copy of the live file taken at the wrong moment. */
  skipSafetyCopy?: boolean;
};

export async function migrateDatabase(db: SQLiteDatabase, options: MigrateOptions = {}): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  // RC.4 QA (T51): a restore's one big transaction — every table cleared (foreign keys
  // cascading) and rewritten — makes SQLite spill its statement journal to a temp file.
  // expo-sqlite ships its own SQLite on Android, which has no writable temp directory, so
  // that open failed as "unable to open database file". Temp files live in memory instead;
  // this changes no data, only where SQLite keeps its scratch space.
  await db.execAsync('PRAGMA temp_store = MEMORY;');
  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const currentVersion = versionRow?.user_version ?? 0;

  // Only when something is actually about to change, and only for a database that already
  // holds data — a fresh install has nothing to lose and should not pay for a copy.
  if (currentVersion > 0 && currentVersion < DATABASE_VERSION && !options.skipSafetyCopy) {
    await keepASafetyCopy(db, currentVersion);
  }

  if (currentVersion < 1) {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);`);
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 1, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 1;`);
  }
  if (currentVersion < 2) {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, notes TEXT, status TEXT NOT NULL DEFAULT 'INBOX', priority TEXT NOT NULL DEFAULT 'MEDIUM', due_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK (length(trim(title)) > 0), CHECK (status IN ('INBOX','PLANNED','IN_PROGRESS','COMPLETED','RESCHEDULED','ARCHIVED','CANCELLED')), CHECK (priority IN ('URGENT','HIGH','MEDIUM','LOW')));
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status); CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority); CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at); CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);`);
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 2, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 2;`);
  }
  if (currentVersion < 3) {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS subtasks (id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL, title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK (length(trim(title)) > 0), CHECK (completed IN (0, 1)), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id, position);`);
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 3, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 3;`);
  }
  if (currentVersion < 4) {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY NOT NULL, title TEXT, content TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'NOTE', source TEXT NOT NULL DEFAULT 'USER', tags_json TEXT NOT NULL DEFAULT '[]', importance INTEGER NOT NULL DEFAULT 3, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_accessed_at TEXT, CHECK (length(trim(content)) > 0), CHECK (kind IN ('NOTE','FACT','PREFERENCE','EVENT','REFLECTION')), CHECK (source IN ('USER','SYSTEM','IMPORTED')), CHECK (importance BETWEEN 1 AND 5), CHECK (archived IN (0, 1)));
      CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind); CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance); CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at); CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived);`);
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 4, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 4;`);
  }
  if (currentVersion < 5) {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS notification_deliveries (task_id TEXT NOT NULL, due_at TEXT NOT NULL, delivered_at TEXT NOT NULL, PRIMARY KEY (task_id, due_at), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS idx_notification_deliveries_delivered_at ON notification_deliveries(delivered_at);`);
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 5, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 5;`);
  }
  if (currentVersion < 6) {
    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(tasks);');
    if (!columns.some((column) => column.name === 'planned_date')) await db.execAsync('ALTER TABLE tasks ADD COLUMN planned_date TEXT;');
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_tasks_planned_date ON tasks(planned_date);');
    await db.execAsync('UPDATE tasks SET planned_date = substr(due_at, 1, 10) WHERE planned_date IS NULL AND due_at IS NOT NULL;');
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 6, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 6;`);
  }
  if (currentVersion < 7) {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS app_preferences (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`);
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 7, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 7;`);
  }
  if (currentVersion < 8) {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY NOT NULL,
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER,
      uri TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK (owner_type IN ('TASK','MEMORY'))
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_type, owner_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_created_at ON attachments(created_at);`);
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 8, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 8;`);
  }
  if (currentVersion < 9) {
    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(tasks);');
    if (!columns.some((column) => column.name === 'recurrence')) {
      await db.execAsync("ALTER TABLE tasks ADD COLUMN recurrence TEXT;");
    }
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 9, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 9;`);
  }
  if (currentVersion < 10) {
    // On-device learning: local, per-user statistics that make capture smarter over time.
    // No content is ever sent anywhere; rows are plain counters.
    await db.execAsync(`CREATE TABLE IF NOT EXISTS learning (
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      count INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (kind, key, value),
      CHECK (kind IN ('time_pattern','intent_correction','frequent_task','tag_pair','dismissed_suggestion'))
    );
    CREATE INDEX IF NOT EXISTS idx_learning_kind ON learning(kind, count DESC);`);
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 10, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 10;`);
  }
  if (currentVersion < 11) {
    // Explicit task ↔ memory links. Stored canonically (task on the "from" side,
    // memory on the "to" side) so both directions are a single indexed lookup.
    await db.execAsync(`CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY NOT NULL,
      from_type TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_type TEXT NOT NULL,
      to_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK (from_type IN ('TASK','MEMORY')),
      CHECK (to_type IN ('TASK','MEMORY')),
      UNIQUE (from_type, from_id, to_type, to_id)
    );
    CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_type, from_id);
    CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_type, to_id);`);
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 11, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 11;`);
  }
  if (currentVersion < 12) {
    // Soft delete → a 30-day recovery trash. `deleted_at` NULL means live; a timestamp
    // means it's in the bin. Every read query filters `deleted_at IS NULL`; an auto-purge
    // on launch hard-removes rows past 30 days.
    const taskCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(tasks);');
    if (!taskCols.some((c) => c.name === 'deleted_at')) await db.execAsync('ALTER TABLE tasks ADD COLUMN deleted_at TEXT;');
    const memCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(memories);');
    if (!memCols.some((c) => c.name === 'deleted_at')) await db.execAsync('ALTER TABLE memories ADD COLUMN deleted_at TEXT;');
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at);');
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_memories_deleted_at ON memories(deleted_at);');
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 12, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 12;`);
  }
  if (currentVersion < 13) {
    // ── Personal Debt & Receivable module ──────────────────────────────────────
    // A fully isolated data domain: every table is `dr_` prefixed, nothing here
    // touches tasks / memories / any existing feature. All money is stored as an
    // integer number of minor units (paisa) — never a float. Paid / remaining /
    // outstanding / status are ALWAYS derived from `dr_transactions`; they are
    // never stored, so the ledger is the single source of truth.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS dr_people (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        relationship TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS dr_accounts (
        id TEXT PRIMARY KEY NOT NULL,
        direction TEXT NOT NULL,                 -- 'DEBT' | 'RECEIVABLE'
        person_id TEXT NOT NULL REFERENCES dr_people(id),
        title TEXT,
        principal_paisa INTEGER NOT NULL,
        opened_date TEXT,
        opened_date_text TEXT,                   -- original text when a real date can't be parsed
        interest_type TEXT NOT NULL DEFAULT 'NONE',   -- NONE | FLAT_TOTAL | SIMPLE | COMPOUND | MONTHLY_FLAT
        interest_rate_bps INTEGER,               -- basis points (1% = 100)
        interest_period TEXT,                    -- YEAR | MONTH | WEEK | DAY  (accrual base for SIMPLE/COMPOUND)
        compound_period TEXT,                    -- YEAR | MONTH | WEEK | DAY  (compounding frequency)
        manual_total_payable_paisa INTEGER,     -- when interest_type = FLAT_TOTAL
        first_due_date TEXT,
        final_due_date TEXT,
        purpose TEXT,
        priority TEXT NOT NULL DEFAULT 'MEDIUM', -- CRITICAL | HIGH | MEDIUM | LOW
        priority_rank INTEGER,                   -- manual order for the CUSTOM strategy
        status TEXT NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE|PARTIAL|OVERDUE|COMPLETED|CANCELLED|SETTLED|WRITTEN_OFF
        settled_paisa INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS dr_installments (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES dr_accounts(id),
        seq INTEGER NOT NULL,
        due_date TEXT,
        amount_paisa INTEGER NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dr_transactions (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL,                      -- NEW_DEBT|NEW_RECEIVABLE|PAYMENT|RECEIPT|ADJUSTMENT|REVERSAL|SETTLEMENT|WRITE_OFF|INTEREST_ACCRUAL
        account_id TEXT NOT NULL REFERENCES dr_accounts(id),
        person_id TEXT NOT NULL REFERENCES dr_people(id),
        amount_paisa INTEGER NOT NULL,           -- always positive; direction implied by kind / adj_sign
        adj_sign INTEGER,                        -- +1 or -1 for ADJUSTMENT
        txn_date TEXT NOT NULL,
        method TEXT,
        reference TEXT,
        note TEXT,
        reverses_txn_id TEXT REFERENCES dr_transactions(id),
        reversed INTEGER NOT NULL DEFAULT 0,     -- 1 once reversed → excluded from every calculation
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS dr_allocations (
        id TEXT PRIMARY KEY NOT NULL,
        transaction_id TEXT NOT NULL REFERENCES dr_transactions(id),
        installment_id TEXT REFERENCES dr_installments(id),
        amount_paisa INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'INSTALLMENT' -- INSTALLMENT | PRINCIPAL | ADVANCE | INTEREST
      );

      CREATE TABLE IF NOT EXISTS dr_transaction_sources (
        id TEXT PRIMARY KEY NOT NULL,
        transaction_id TEXT NOT NULL REFERENCES dr_transactions(id),
        source_key TEXT NOT NULL,                -- SALARY | SAVINGS | BORROWED | ... | custom
        amount_paisa INTEGER NOT NULL,
        linked_account_id TEXT REFERENCES dr_accounts(id),  -- BORROWED → the debt that funded this payment
        note TEXT
      );

      CREATE TABLE IF NOT EXISTS dr_promises (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES dr_accounts(id),
        amount_paisa INTEGER NOT NULL,
        promised_date TEXT NOT NULL,
        follow_up_date TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN',     -- OPEN | FULFILLED | BROKEN
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dr_targets (
        id TEXT PRIMARY KEY NOT NULL,
        period_type TEXT NOT NULL,               -- MONTH | YEAR
        period_key TEXT NOT NULL,                -- '2026-09' | '2026'
        kind TEXT NOT NULL DEFAULT 'REPAYMENT',  -- REPAYMENT | REDUCTION_PCT | CLOSE_COUNT
        target_value INTEGER NOT NULL,           -- paisa, or pct×100, or a count
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(period_type, period_key, kind)
      );

      CREATE TABLE IF NOT EXISTS dr_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);

      CREATE TABLE IF NOT EXISTS dr_attachments (
        id TEXT PRIMARY KEY NOT NULL,
        owner_type TEXT NOT NULL,                -- ACCOUNT | TRANSACTION
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER,
        uri TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dr_audit (
        id TEXT PRIMARY KEY NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        action TEXT NOT NULL,                    -- CREATE | UPDATE | DELETE | REVERSE
        at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_dr_people_deleted ON dr_people(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_dr_accounts_person ON dr_accounts(person_id);
      CREATE INDEX IF NOT EXISTS idx_dr_accounts_dir_status ON dr_accounts(direction, status);
      CREATE INDEX IF NOT EXISTS idx_dr_accounts_deleted ON dr_accounts(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_dr_installments_account ON dr_installments(account_id, seq);
      CREATE INDEX IF NOT EXISTS idx_dr_txn_account ON dr_transactions(account_id, txn_date);
      CREATE INDEX IF NOT EXISTS idx_dr_txn_person ON dr_transactions(person_id, txn_date);
      CREATE INDEX IF NOT EXISTS idx_dr_txn_kind_date ON dr_transactions(kind, txn_date);
      CREATE INDEX IF NOT EXISTS idx_dr_txn_deleted ON dr_transactions(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_dr_alloc_txn ON dr_allocations(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_dr_alloc_inst ON dr_allocations(installment_id);
      CREATE INDEX IF NOT EXISTS idx_dr_src_txn ON dr_transaction_sources(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_dr_src_linked ON dr_transaction_sources(linked_account_id);
      CREATE INDEX IF NOT EXISTS idx_dr_promises_account ON dr_promises(account_id, promised_date);
      CREATE INDEX IF NOT EXISTS idx_dr_attach_owner ON dr_attachments(owner_type, owner_id);
      CREATE INDEX IF NOT EXISTS idx_dr_audit_entity ON dr_audit(entity_type, entity_id);
    `);
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 13, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 13;`);
  }
  if (currentVersion < 14) {
    // ── Debt module: stop the clock, and say what interest is charged on ───────
    //
    // `closed_at` is the day an account stopped owing anything. Interest accrues up
    // to min(today, closed_at) — without it an interest-bearing account that was paid
    // off in full silently re-opens the next day, because "total payable" kept growing
    // while "paid" stood still.
    //
    // `interest_basis` records whether interest is charged on the original principal
    // (how informal "X% per month" loans actually work here, and what every existing
    // row already assumed) or on the falling balance (how a bank loan works). The
    // default is ORIGINAL precisely so no stored account changes value on upgrade.
    const accCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(dr_accounts);');
    const have = new Set(accCols.map((c) => c.name));
    if (accCols.length > 0 && !have.has('closed_at')) {
      await db.execAsync('ALTER TABLE dr_accounts ADD COLUMN closed_at TEXT;');
    }
    if (accCols.length > 0 && !have.has('interest_basis')) {
      await db.execAsync("ALTER TABLE dr_accounts ADD COLUMN interest_basis TEXT NOT NULL DEFAULT 'ORIGINAL';");
    }
    if (accCols.length > 0) {
      // Backfill: an already-closed account closed on the day of its LAST real money
      // movement — never "now", which would back-date months of interest onto history.
      await db.runAsync(`
        UPDATE dr_accounts
           SET closed_at = COALESCE(
                 (SELECT MAX(t.txn_date) FROM dr_transactions t
                   WHERE t.account_id = dr_accounts.id
                     AND t.deleted_at IS NULL AND t.reversed = 0
                     AND t.kind IN ('PAYMENT','RECEIPT','SETTLEMENT','WRITE_OFF')),
                 dr_accounts.updated_at)
         WHERE closed_at IS NULL
           AND status IN ('COMPLETED','SETTLED','WRITTEN_OFF','CANCELLED')`);
      await db.execAsync('CREATE INDEX IF NOT EXISTS idx_dr_accounts_closed ON dr_accounts(closed_at);');
    }
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 14, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 14;`);
  }
  if (currentVersion < 15) {
    // ── Let anything link to anything ────────────────────────────────────────
    //
    // `relations` was always the right shape for connecting one record to another —
    // from_type/from_id → to_type/to_id — but a CHECK pinned both ends to TASK and
    // MEMORY. That made every later domain a dead end: a debt could not point at the
    // note explaining it, a prescription could not point at the expense it caused.
    //
    // The columns do not change; only the constraint is lifted, so every existing row
    // survives untouched and every existing query keeps working. SQLite cannot drop a
    // CHECK in place, so the table is rebuilt around the same data — inside one
    // transaction, with foreign keys held off while the swap happens.
    const relCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(relations);');
    if (relCols.length > 0) {
      await db.execAsync('PRAGMA foreign_keys = OFF;');
      await db.withTransactionAsync(async () => {
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS relations_new (
            id TEXT PRIMARY KEY NOT NULL,
            from_type TEXT NOT NULL,
            from_id TEXT NOT NULL,
            to_type TEXT NOT NULL,
            to_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            CHECK (length(trim(from_type)) > 0),
            CHECK (length(trim(to_type)) > 0),
            UNIQUE (from_type, from_id, to_type, to_id)
          );`);
        await db.execAsync(`
          INSERT OR IGNORE INTO relations_new (id, from_type, from_id, to_type, to_id, created_at)
          SELECT id, from_type, from_id, to_type, to_id, created_at FROM relations;`);
        await db.execAsync('DROP TABLE relations;');
        await db.execAsync('ALTER TABLE relations_new RENAME TO relations;');
        await db.execAsync(`
          CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_type, from_id);
          CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_type, to_id);`);
      });
      await db.execAsync('PRAGMA foreign_keys = ON;');
    }
    // `attachments` carries the same lock for the same reason, and a file is wanted by
    // every domain there is — a prescription, a salary slip, an X-ray, a certificate.
    // Lifting it here means a later module can attach one without a fourth copy of this
    // table appearing (the debt module already made a third).
    const attCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(attachments);');
    if (attCols.length > 0) {
      await db.execAsync('PRAGMA foreign_keys = OFF;');
      await db.withTransactionAsync(async () => {
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS attachments_new (
            id TEXT PRIMARY KEY NOT NULL,
            owner_type TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            name TEXT NOT NULL,
            mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
            size INTEGER,
            uri TEXT NOT NULL,
            created_at TEXT NOT NULL,
            CHECK (length(trim(owner_type)) > 0)
          );`);
        await db.execAsync(`
          INSERT OR IGNORE INTO attachments_new (id, owner_type, owner_id, name, mime_type, size, uri, created_at)
          SELECT id, owner_type, owner_id, name, mime_type, size, uri, created_at FROM attachments;`);
        await db.execAsync('DROP TABLE attachments;');
        await db.execAsync('ALTER TABLE attachments_new RENAME TO attachments;');
        await db.execAsync(`
          CREATE INDEX IF NOT EXISTS idx_attachments_owner ON attachments(owner_type, owner_id);
          CREATE INDEX IF NOT EXISTS idx_attachments_created_at ON attachments(created_at);`);
      });
      await db.execAsync('PRAGMA foreign_keys = ON;');
    }
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 15, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 15;`);
  }
  if (currentVersion < 16) {
    // ── One place for files, one place for measurements ───────────────────────
    //
    // Two foundations, done together so the schema moves once.
    //
    // (a) `dr_attachments` was a second copy of `attachments`, written because the
    //     original's CHECK only allowed TASK and MEMORY owners. v15 lifted that, so the
    //     rows can come home. Owner kinds are namespaced (DEBT_ACCOUNT, DEBT_TRANSACTION)
    //     rather than reusing the module's bare 'ACCOUNT', so a later module can have its
    //     own accounts without colliding.
    //
    // (b) `measurements` is new: a number, its unit, what it is about, and when. Weight,
    //     blood pressure, blood sugar, study hours, pages read, kilometres walked, a habit
    //     ticked — all the same shape, so health, study and self-improvement are three
    //     readings of one engine rather than three tables.
    const drAttCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(dr_attachments);');
    if (drAttCols.length > 0) {
      await db.withTransactionAsync(async () => {
        await db.execAsync(`
          INSERT OR IGNORE INTO attachments (id, owner_type, owner_id, name, mime_type, size, uri, created_at)
          SELECT id,
                 CASE owner_type WHEN 'ACCOUNT' THEN 'DEBT_ACCOUNT'
                                 WHEN 'TRANSACTION' THEN 'DEBT_TRANSACTION'
                                 ELSE 'DEBT_' || owner_type END,
                 owner_id, name, mime_type, size, uri, created_at
            FROM dr_attachments;`);
        await db.execAsync('DROP TABLE dr_attachments;');
      });
    }

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS measurements (
        id TEXT PRIMARY KEY NOT NULL,
        -- What is being measured, as a stable key: WEIGHT, BP_SYSTOLIC, STUDY_MINUTES…
        metric TEXT NOT NULL,
        -- Who or what it is about. Usually the user themself (SELF), but it can be any
        -- record: a person's blood pressure, a course's hours, a vehicle's mileage.
        subject_type TEXT NOT NULL DEFAULT 'SELF',
        subject_id TEXT NOT NULL DEFAULT 'me',
        -- Stored as an integer in the metric's smallest unit (grams, minutes, mmHg) for
        -- the same reason money is stored in paisa: floating point loses arithmetic.
        value_num INTEGER NOT NULL,
        unit TEXT NOT NULL,
        -- The moment measured, not the moment recorded, so back-dating is honest.
        at TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        CHECK (length(trim(metric)) > 0),
        CHECK (length(trim(unit)) > 0)
      );
      CREATE INDEX IF NOT EXISTS idx_measurements_metric_at ON measurements(metric, at DESC);
      CREATE INDEX IF NOT EXISTS idx_measurements_subject ON measurements(subject_type, subject_id, at DESC);

      CREATE TABLE IF NOT EXISTS measurement_targets (
        metric TEXT NOT NULL,
        subject_type TEXT NOT NULL DEFAULT 'SELF',
        subject_id TEXT NOT NULL DEFAULT 'me',
        -- The number to reach, and which direction counts as progress. "Down" is not a
        -- failure mode to bolt on later — losing weight and paying off a debt are the
        -- same shape as gaining savings, just aimed the other way.
        target_num INTEGER NOT NULL,
        direction TEXT NOT NULL DEFAULT 'UP',
        unit TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (metric, subject_type, subject_id),
        CHECK (direction IN ('UP','DOWN'))
      );`);

    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 16, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 16;`);
  }
  if (currentVersion < 17) {
    // ── People belong to the person, not to one module ────────────────────────
    //
    // Rahim existed only in `dr_people`, so linking him to a task, a memory, a doctor's
    // appointment or a salary meant typing him again. A person is the most reused thing
    // in anyone's life; owning them inside the debt module was the wrong foundation.
    //
    // Ids are carried across unchanged, so every `person_id` still points at the same
    // person and no account can lose whose loan it is.
    //
    // The two tables that reference people are rebuilt to point at the new one. A view
    // named `dr_people` would have kept reads working, but SQLite will not accept a view
    // as a foreign-key parent — adding a debt afterwards fails with "foreign key
    // mismatch" — so the references are moved properly rather than papered over.
    const drPeopleIsTable = await db.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dr_people'",
    );

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS people (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        relationship TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        CHECK (length(trim(name)) > 0)
      );
      CREATE INDEX IF NOT EXISTS idx_people_name ON people(name);
      CREATE INDEX IF NOT EXISTS idx_people_deleted ON people(deleted_at);`);

    if (drPeopleIsTable) {
      await db.execAsync('PRAGMA foreign_keys = OFF;');
      await db.withTransactionAsync(async () => {
        await db.execAsync(`
          INSERT OR IGNORE INTO people (id, name, phone, address, relationship, notes, created_at, updated_at, deleted_at)
          SELECT id, name, phone, address, relationship, notes, created_at, updated_at, deleted_at
            FROM dr_people
           WHERE length(trim(name)) > 0;`);

        // dr_accounts: same columns, same rows, person_id now pointing at `people`.
        await db.execAsync(`
          CREATE TABLE dr_accounts_new (
            id TEXT PRIMARY KEY NOT NULL,
            direction TEXT NOT NULL,
            person_id TEXT NOT NULL REFERENCES people(id),
            title TEXT,
            principal_paisa INTEGER NOT NULL,
            opened_date TEXT,
            opened_date_text TEXT,
            interest_type TEXT NOT NULL DEFAULT 'NONE',
            interest_rate_bps INTEGER,
            interest_period TEXT,
            compound_period TEXT,
            interest_basis TEXT NOT NULL DEFAULT 'ORIGINAL',
            manual_total_payable_paisa INTEGER,
            first_due_date TEXT,
            final_due_date TEXT,
            purpose TEXT,
            priority TEXT NOT NULL DEFAULT 'MEDIUM',
            priority_rank INTEGER,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            settled_paisa INTEGER,
            closed_at TEXT,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
          );
          INSERT INTO dr_accounts_new SELECT
            id, direction, person_id, title, principal_paisa, opened_date, opened_date_text,
            interest_type, interest_rate_bps, interest_period, compound_period, interest_basis,
            manual_total_payable_paisa, first_due_date, final_due_date, purpose, priority,
            priority_rank, status, settled_paisa, closed_at, notes, created_at, updated_at, deleted_at
            FROM dr_accounts;
          DROP TABLE dr_accounts;
          ALTER TABLE dr_accounts_new RENAME TO dr_accounts;
          CREATE INDEX IF NOT EXISTS idx_dr_accounts_person ON dr_accounts(person_id);
          CREATE INDEX IF NOT EXISTS idx_dr_accounts_dir_status ON dr_accounts(direction, status);
          CREATE INDEX IF NOT EXISTS idx_dr_accounts_deleted ON dr_accounts(deleted_at);
          CREATE INDEX IF NOT EXISTS idx_dr_accounts_closed ON dr_accounts(closed_at);`);

        // dr_transactions: likewise. Its self-reference for reversals is preserved.
        await db.execAsync(`
          CREATE TABLE dr_transactions_new (
            id TEXT PRIMARY KEY NOT NULL,
            kind TEXT NOT NULL,
            account_id TEXT NOT NULL REFERENCES dr_accounts(id),
            person_id TEXT NOT NULL REFERENCES people(id),
            amount_paisa INTEGER NOT NULL,
            adj_sign INTEGER,
            txn_date TEXT NOT NULL,
            method TEXT,
            reference TEXT,
            note TEXT,
            reverses_txn_id TEXT REFERENCES dr_transactions_new(id),
            reversed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            deleted_at TEXT
          );
          INSERT INTO dr_transactions_new SELECT
            id, kind, account_id, person_id, amount_paisa, adj_sign, txn_date, method,
            reference, note, reverses_txn_id, reversed, created_at, deleted_at
            FROM dr_transactions;
          DROP TABLE dr_transactions;
          ALTER TABLE dr_transactions_new RENAME TO dr_transactions;
          CREATE INDEX IF NOT EXISTS idx_dr_txn_account ON dr_transactions(account_id, txn_date);
          CREATE INDEX IF NOT EXISTS idx_dr_txn_person ON dr_transactions(person_id, txn_date);
          CREATE INDEX IF NOT EXISTS idx_dr_txn_kind_date ON dr_transactions(kind, txn_date);
          CREATE INDEX IF NOT EXISTS idx_dr_txn_deleted ON dr_transactions(deleted_at);`);

        await db.execAsync('DROP TABLE dr_people;');
        // A read-only view keeps the debt module's existing SELECTs working unchanged.
        // Writes go to `people` directly — SQLite refuses to write through a view, which
        // is the safeguard that stops the old path drifting back in unnoticed.
        await db.execAsync(`
          CREATE VIEW IF NOT EXISTS dr_people AS
            SELECT id, name, phone, address, relationship, notes, created_at, updated_at, deleted_at
              FROM people;`);
      });
      await db.execAsync('PRAGMA foreign_keys = ON;');
    }

    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 17, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 17;`);
  }

  if (currentVersion < 18) {
    // ── Two more shared foundations, and the first module built on them ───────
    //
    // `places` and `follow_ups` are keyed the way `attachments` is: an owner kind and an
    // owner id, no foreign key. That is what lets a module that does not exist yet attach
    // a place or a phone call to its own rows without a migration here. A place on a
    // memory, a place on an expense and a place on a trip are one mechanism, not three.
    //
    // A follow-up is the record that someone was reminded — a call placed, a message sent.
    // For a debt that is the তাগাদা, and it is the thing that matters when the amount is
    // disputed a year later; the call itself leaves no trace the app can read, so the app
    // writes down the one it made.
    //
    // `fin_entries` is the আয়-ব্যয় module. Money stays integer paisa, people come from
    // the shared `people` table, receipts from `attachments`, and where it was spent from
    // `places` — the module owns only the row that is genuinely its own.
    // A contact picked from the phone book brings an email; people had nowhere to put it.
    const peopleColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(people)');
    if (!peopleColumns.some((column) => column.name === 'email')) {
      await db.execAsync('ALTER TABLE people ADD COLUMN email TEXT;');
    }

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS places (
        id TEXT PRIMARY KEY NOT NULL,
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        label TEXT,
        captured_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        CHECK (length(trim(owner_type)) > 0),
        CHECK (length(trim(owner_id)) > 0)
      );
      CREATE INDEX IF NOT EXISTS idx_places_owner ON places(owner_type, owner_id);

      CREATE TABLE IF NOT EXISTS follow_ups (
        id TEXT PRIMARY KEY NOT NULL,
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('CALL','SMS','MEET','NOTE')),
        direction TEXT NOT NULL CHECK (direction IN ('OUT','IN')),
        happened_at TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        CHECK (length(trim(owner_type)) > 0),
        CHECK (length(trim(owner_id)) > 0)
      );
      CREATE INDEX IF NOT EXISTS idx_follow_ups_owner ON follow_ups(owner_type, owner_id, happened_at);

      CREATE TABLE IF NOT EXISTS fin_entries (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('INCOME','EXPENSE')),
        amount_paisa INTEGER NOT NULL CHECK (amount_paisa > 0),
        category TEXT NOT NULL,
        method TEXT,
        person_id TEXT REFERENCES people(id),
        occurred_at TEXT NOT NULL,
        note TEXT,
        recurring TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        CHECK (length(trim(category)) > 0)
      );
      CREATE INDEX IF NOT EXISTS idx_fin_when ON fin_entries(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_fin_kind_when ON fin_entries(kind, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_fin_category ON fin_entries(category);
      CREATE INDEX IF NOT EXISTS idx_fin_person ON fin_entries(person_id);
      CREATE INDEX IF NOT EXISTS idx_fin_deleted ON fin_entries(deleted_at);

      CREATE TABLE IF NOT EXISTS fin_budgets (
        id TEXT PRIMARY KEY NOT NULL,
        category TEXT NOT NULL,
        month TEXT NOT NULL,
        limit_paisa INTEGER NOT NULL CHECK (limit_paisa > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (category, month)
      );`);

    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 18, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 18;`);
  }


  if (currentVersion < 19) {
    // ── Two tables that let the modules talk without knowing each other ───────
    //
    // `goals` is a promise a person made to themselves — "this month I will put ৳3,000
    // against the loan". It belongs to no module: `module` is a plain string, so a
    // savings goal, a study-hours goal and a blood-pressure goal are the same row shape.
    // Storing the target rather than deducting it up front matters: money you have
    // promised is still money you have, and pretending otherwise makes every total a
    // lie the moment life needs the money for something else.
    //
    // `category_needs` is what makes "unnecessary spending" a computable idea rather
    // than a judgement. The app never decides which of someone's categories are wants —
    // the person marks them once, and from then on the arithmetic is theirs, not ours.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY NOT NULL,
        module TEXT NOT NULL,
        kind TEXT NOT NULL,
        period TEXT NOT NULL,
        target_paisa INTEGER,
        target_number REAL,
        unit TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        CHECK (length(trim(module)) > 0),
        CHECK (length(trim(kind)) > 0),
        UNIQUE (module, kind, period)
      );
      CREATE INDEX IF NOT EXISTS idx_goals_period ON goals(period);
      CREATE INDEX IF NOT EXISTS idx_goals_module ON goals(module, kind);

      CREATE TABLE IF NOT EXISTS category_needs (
        module TEXT NOT NULL,
        category TEXT NOT NULL,
        need TEXT NOT NULL CHECK (need IN ('ESSENTIAL','NEEDED','WANT')),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (module, category)
      );`);

    // The categories almost everyone would mark the same way, so a new user gets useful
    // arithmetic on day one without a setup screen. Every one of them can be changed,
    // and anything not listed counts as NEEDED — the middle, least presumptuous answer.
    const seeded: [string, string][] = [
      ['বাজার', 'ESSENTIAL'], ['বাসা ভাড়া', 'ESSENTIAL'], ['বিদ্যুৎ-গ্যাস-পানি', 'ESSENTIAL'],
      ['চিকিৎসা', 'ESSENTIAL'], ['শিক্ষা', 'ESSENTIAL'],
      ['যাতায়াত', 'NEEDED'], ['মোবাইল-ইন্টারনেট', 'NEEDED'], ['পোশাক', 'NEEDED'], ['মেরামত', 'NEEDED'],
      ['বিনোদন', 'WANT'], ['দান-সাহায্য', 'WANT'],
    ];
    const stamp = new Date().toISOString();
    for (const [category, need] of seeded) {
      await db.runAsync(
        'INSERT OR IGNORE INTO category_needs (module, category, need, updated_at) VALUES (?, ?, ?, ?)',
        'finance', category, need, stamp,
      );
    }

    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 19, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 19;`);
  }


  if (currentVersion < 20) {
    // ── Wallets: money is not in one place ───────────────────────────────────
    //
    // "How much have I got" has never had one answer here. There is cash in a pocket,
    // a bKash balance, maybe a bank account, and they behave differently — you cannot
    // pay the electricity bill with the cash if the cash is in someone else’s hand.
    // A month total that pretends otherwise is arithmetic nobody can act on.
    //
    // The wallet is stored on the entry rather than as a separate ledger, so an entry
    // written before wallets existed simply has none and still counts in every total.
    // Transfers are two rows sharing a transfer_id: money out of one, into the other,
    // both excluded from income and spending totals because nothing was earned or spent.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS wallets (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('CASH','MOBILE','BANK','CARD','OTHER')),
        opening_paisa INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (length(trim(name)) > 0)
      );
      CREATE INDEX IF NOT EXISTS idx_wallets_position ON wallets(position);`);

    const finColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(fin_entries)');
    const has = (name: string) => finColumns.some((column) => column.name === name);
    if (!has('wallet_id')) await db.execAsync('ALTER TABLE fin_entries ADD COLUMN wallet_id TEXT REFERENCES wallets(id);');
    if (!has('transfer_id')) await db.execAsync('ALTER TABLE fin_entries ADD COLUMN transfer_id TEXT;');
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_fin_wallet ON fin_entries(wallet_id);');
    await db.execAsync('CREATE INDEX IF NOT EXISTS idx_fin_transfer ON fin_entries(transfer_id);');

    // The three almost everyone here has. Named, not numbered, and all editable.
    const now = new Date().toISOString();
    const seeded: [string, string, string, number][] = [
      ['wallet-cash', 'নগদ হাতে', 'CASH', 0],
      ['wallet-bkash', 'বিকাশ', 'MOBILE', 1],
      ['wallet-bank', 'ব্যাংক', 'BANK', 2],
    ];
    for (const [id, name, kind, position] of seeded) {
      await db.runAsync(
        'INSERT OR IGNORE INTO wallets (id, name, kind, opening_paisa, position, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
        id, name, kind, position, now, now,
      );
    }

    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 20, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 20;`);
  }


  if (currentVersion < 21) {
    // ── Health: medicines, doctors, tests — and not one paisa of its own ─────
    //
    // The money question was settled before the tables were: a medical cost is an
    // ordinary expense in `fin_entries`, and a health record merely points at the row it
    // created. There is no health ledger to reconcile against the real one, which is the
    // only way to be certain the same 2,000 taka can never be counted twice — the second
    // count would have to come from somewhere, and there is nowhere for it to come from.
    //
    // What lives here is what money cannot express: what the medicine is for, when to
    // take it, how many are left, and whether this morning's dose was actually swallowed.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS hl_prescriptions (
        id TEXT PRIMARY KEY NOT NULL,
        doctor TEXT,
        issued_on TEXT,
        diagnosis TEXT,
        advice TEXT,
        follow_up_on TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS hl_medicines (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        reason TEXT,                       -- what it is for
        doctor TEXT,
        prescription_id TEXT REFERENCES hl_prescriptions(id),
        dose_text TEXT,                    -- "১টি ট্যাবলেট", free text
        per_dose REAL NOT NULL DEFAULT 1,  -- units swallowed each time (0.5 is allowed)
        times_per_day INTEGER NOT NULL DEFAULT 1,
        food TEXT NOT NULL DEFAULT 'ANY',  -- BEFORE | AFTER | WITH | ANY
        start_date TEXT,
        end_date TEXT,
        duration_days INTEGER,
        total_units REAL NOT NULL DEFAULT 0,  -- how many are in the box
        used_units REAL NOT NULL DEFAULT 0,   -- how many have been swallowed
        pharmacy TEXT,
        purchased_on TEXT,
        purchase_entry_id TEXT REFERENCES fin_entries(id),
        note TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      -- The clock times a medicine is due at. One row per time of day, so "three times a
      -- day" is three rows the user can each move, rather than a count the app guesses at.
      CREATE TABLE IF NOT EXISTS hl_medicine_times (
        id TEXT PRIMARY KEY NOT NULL,
        medicine_id TEXT NOT NULL REFERENCES hl_medicines(id),
        at_time TEXT NOT NULL,             -- "08:00", Dhaka wall clock
        label TEXT,                        -- সকাল / দুপুর / বিকাল / রাত
        seq INTEGER NOT NULL DEFAULT 0
      );

      -- One row per dose that has actually come due. Written when the day is opened, not
      -- years in advance: a schedule that has not happened yet is not history, and a
      -- table of a million future rows is a table nobody can edit.
      CREATE TABLE IF NOT EXISTS hl_doses (
        id TEXT PRIMARY KEY NOT NULL,
        medicine_id TEXT NOT NULL REFERENCES hl_medicines(id),
        due_at TEXT NOT NULL,              -- ISO instant
        day_key TEXT NOT NULL,             -- Dhaka YYYY-MM-DD, so a day is one index hit
        status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | TAKEN | SKIPPED | SNOOZED
        acted_at TEXT,
        snooze_until TEXT,
        units REAL NOT NULL DEFAULT 1,
        note TEXT
      );

      CREATE TABLE IF NOT EXISTS hl_visits (
        id TEXT PRIMARY KEY NOT NULL,
        doctor TEXT NOT NULL,
        specialty TEXT,
        visited_on TEXT NOT NULL,
        visited_at_time TEXT,
        reason TEXT,
        diagnosis TEXT,
        fee_paisa INTEGER NOT NULL DEFAULT 0,
        extra_paisa INTEGER NOT NULL DEFAULT 0,
        follow_up_on TEXT,
        prescription_id TEXT REFERENCES hl_prescriptions(id),
        note TEXT,
        fee_entry_id TEXT REFERENCES fin_entries(id),
        extra_entry_id TEXT REFERENCES fin_entries(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS hl_tests (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        reason TEXT,
        tested_on TEXT NOT NULL,
        tested_at_time TEXT,
        lab TEXT,
        cost_paisa INTEGER NOT NULL DEFAULT 0,
        result TEXT,
        reference TEXT,                    -- which doctor asked for it
        repeat_on TEXT,
        note TEXT,
        entry_id TEXT REFERENCES fin_entries(id),
        visit_id TEXT REFERENCES hl_visits(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_hl_med_live ON hl_medicines(deleted_at, archived_at);
      CREATE INDEX IF NOT EXISTS idx_hl_time_med ON hl_medicine_times(medicine_id);
      CREATE INDEX IF NOT EXISTS idx_hl_dose_day ON hl_doses(day_key, status);
      CREATE INDEX IF NOT EXISTS idx_hl_dose_med ON hl_doses(medicine_id, due_at);
      CREATE INDEX IF NOT EXISTS idx_hl_visit_date ON hl_visits(visited_on, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_hl_test_date ON hl_tests(tested_on, deleted_at);
    `);

    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 21, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 21;`);
  }

  // ── v22: a deleted debt keeps its schedule ──────────────────────────────────
  //
  // Retiring an account soft-deleted the account and its ledger, but *destroyed* the
  // instalments and promises, because neither table had a `deleted_at` to hide behind and
  // they would otherwise have gone on appearing in the calendar and the promises list.
  // Trash offered the account back afterwards and it came back without its schedule — the
  // one part of a loan nobody can reconstruct from memory.
  //
  // Giving both tables the same column every other table already has means the delete can
  // mark them instead of dropping them, and restore can bring the whole account back.
  if (currentVersion < 22) {
    // Each column checked first, like v6/v9/v12: an upgrade interrupted after the first
    // ALTER would otherwise throw "duplicate column" on every later launch, for ever.
    const instCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(dr_installments)');
    if (!instCols.some((c) => c.name === 'deleted_at')) await db.execAsync('ALTER TABLE dr_installments ADD COLUMN deleted_at TEXT;');
    const promiseCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(dr_promises)');
    if (!promiseCols.some((c) => c.name === 'deleted_at')) await db.execAsync('ALTER TABLE dr_promises ADD COLUMN deleted_at TEXT;');
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_dr_inst_live ON dr_installments(account_id, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_dr_promise_live ON dr_promises(account_id, deleted_at);
    `);
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 22, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 22;`);
  }

  // ── v23: one thing happened, and several records know about it ──────────────
  //
  // Borrowing twenty thousand taka from a friend is not four events. It is one, and it
  // leaves a debt row, a wallet row, a month's total and a reason. Until now the app had
  // the four records and no name for the thing itself, so nothing could answer "what
  // happened on the tenth", and nothing could say that the medicine bought on Tuesday was
  // paid for with the money borrowed on Monday.
  //
  // The event is deliberately thin. It does not hold the money -- `fin_entries` does, and
  // `dr_transactions` does -- because two places holding an amount is two places to
  // disagree. It holds identity, when it happened, who it was with, where the money came
  // from and what it was for. Everything else is an effect, joined below.
  //
  // Effects live in their own table rather than as an `event_id` column on each domain,
  // so a module added next year can take part without a migration to its neighbours'
  // tables -- and so a single event can reach a kind of record that does not exist yet.
  if (currentVersion < 23) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS life_events (
        id TEXT PRIMARY KEY NOT NULL,
        -- Machine-readable, and deliberately not a CHECK: a module must be able to bring
        -- its own kind of event without editing this file. See LIFE_EVENT_TYPES.
        type TEXT NOT NULL,
        -- The business date: when it happened, not when it was typed in.
        occurred_at TEXT NOT NULL,
        title TEXT,
        person_id TEXT REFERENCES people(id),
        place TEXT,
        purpose TEXT,
        source TEXT,
        destination TEXT,
        -- The headline figure, for a timeline that must not read every effect to show a
        -- line. Null for an event that is not about money.
        amount_paisa INTEGER,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        CHECK (length(trim(type)) > 0)
      );

      CREATE TABLE IF NOT EXISTS life_event_effects (
        event_id TEXT NOT NULL REFERENCES life_events(id),
        -- FINANCE_ENTRY, DEBT_TRANSACTION, HL_VISIT, ... open for the same reason as type.
        effect_type TEXT NOT NULL,
        effect_id TEXT NOT NULL,
        -- What this record is to the event: the money, the ledger, the thing itself.
        role TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (event_id, effect_type, effect_id)
      );

      CREATE INDEX IF NOT EXISTS idx_life_events_when ON life_events(occurred_at, deleted_at);
      CREATE INDEX IF NOT EXISTS idx_life_events_type ON life_events(type, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_life_events_person ON life_events(person_id);
      CREATE INDEX IF NOT EXISTS idx_life_effects_back ON life_event_effects(effect_type, effect_id);
    `);
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 23, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 23;`);
  }

  // ── v24: the records that were here before events existed ───────────────────
  //
  // v23 gave the app a row for the thing that happened, and every writer fills it in from
  // then on. But a person who has been using this app for a year has a year of money and
  // debt with no event beside it — so the timeline opened empty, asking "where did five
  // hundred go last year" found nothing, and the month's advice had nothing to compare.
  // All three would have looked broken while working perfectly.
  //
  // So the existing rows are read once and an event is written for each. Nothing is
  // modified: `fin_entries` and `dr_transactions` are only read from, and the events are
  // built from what those rows already say. The worst a mistake here can do is put a
  // wrong label on a timeline line; no amount is touched, and no total is recomputed.
  //
  // Written in SQL rather than through the services because it runs inside the migration,
  // before anything has loaded, and because a loop of a thousand service calls on a cold
  // start is a visible pause on the one launch a person did not ask for.
  if (currentVersion < 24 && currentVersion > 0) {
    // Wrapped, because this one is a convenience and the launch is not. Every other
    // migration here creates or moves something the app cannot run without; this one only
    // makes history visible on three screens that work either way. A database in a shape
    // this did not expect must not be the reason someone cannot open their own notebook.
    //
    // One transaction, and every insert tolerant of a row already being there: a backfill
    // that half-ran on an earlier launch (autocommit, one statement at a time) left
    // `evt-back-*` rows behind, and a plain INSERT then hit their primary key on every
    // retry — so v24 never finished and the columns v25/v26 add never arrived.
    try {
    await db.withTransactionAsync(async () => {
    await db.execAsync(`
      -- Money already in the book. The kind is read from the category the app itself
      -- reserved for debt movement, so a repayment does not become a plain expense.
      INSERT OR IGNORE INTO life_events (id, type, occurred_at, title, person_id, amount_paisa, note, created_at, updated_at)
      SELECT
        'evt-back-fin-' || e.id,
        CASE
          WHEN e.category = 'ঋণ পরিশোধ' THEN 'REPAY'
          WHEN e.category = 'পাওনা আদায়' THEN 'COLLECT'
          WHEN e.category = 'ধার নেওয়া' THEN 'BORROW'
          WHEN e.category = 'ধার দেওয়া' THEN 'LEND'
          WHEN e.category = '__transfer__' THEN 'TRANSFER'
          WHEN e.kind = 'INCOME' THEN 'INCOME'
          ELSE 'EXPENSE'
        END,
        e.occurred_at, e.category, e.person_id, e.amount_paisa, e.note,
        e.created_at, e.created_at
      FROM fin_entries e
      WHERE e.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM life_event_effects x
           WHERE x.effect_type = 'FINANCE_ENTRY' AND x.effect_id = e.id
        );

      INSERT OR IGNORE INTO life_event_effects (event_id, effect_type, effect_id, role, created_at)
      SELECT 'evt-back-fin-' || e.id, 'FINANCE_ENTRY', e.id, 'MONEY', e.created_at
      FROM fin_entries e
      WHERE e.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM life_events v WHERE v.id = 'evt-back-fin-' || e.id);
    `);

    // The debt ledger, for movements that never had a wallet side and so left no finance
    // entry to have been caught above. Joined to the person so the timeline can say who.
    await db.execAsync(`
      INSERT OR IGNORE INTO life_events (id, type, occurred_at, title, person_id, amount_paisa, note, created_at, updated_at)
      SELECT
        'evt-back-txn-' || t.id,
        CASE t.kind
          WHEN 'PAYMENT' THEN 'REPAY'
          WHEN 'RECEIPT' THEN 'COLLECT'
          WHEN 'NEW_DEBT' THEN 'BORROW'
          WHEN 'NEW_RECEIVABLE' THEN 'LEND'
          ELSE 'OTHER'
        END,
        t.txn_date, a.title, t.person_id, t.amount_paisa, t.note,
        t.created_at, t.created_at
      FROM dr_transactions t
      LEFT JOIN dr_accounts a ON a.id = t.account_id
      WHERE t.deleted_at IS NULL
        AND t.reversed = 0
        AND t.kind IN ('PAYMENT','RECEIPT','NEW_DEBT','NEW_RECEIVABLE')
        AND NOT EXISTS (
          SELECT 1 FROM life_event_effects x
           WHERE x.effect_type = 'DEBT_TRANSACTION' AND x.effect_id = t.id
        );

      INSERT OR IGNORE INTO life_event_effects (event_id, effect_type, effect_id, role, created_at)
      SELECT 'evt-back-txn-' || t.id, 'DEBT_TRANSACTION', t.id, 'LEDGER', t.created_at
      FROM dr_transactions t
      WHERE t.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM life_events v WHERE v.id = 'evt-back-txn-' || t.id);
    `);
    });

    // Only stamped as applied when the backfill actually ran: these two statements were
    // unconditional before, after the try/catch rather than inside it, so a transient
    // failure (a locked file, a full disk) was caught, swallowed, and then recorded as
    // version 24 anyway — permanently, since `currentVersion < 24` is what makes this
    // block run at all. The comment above already promised "a later launch will try
    // again"; this is what makes that true instead of just claimed.
    await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 24, new Date().toISOString());
    await db.execAsync(`PRAGMA user_version = 24;`);
    } catch {
      // Left at the previous version deliberately: a later launch will try again, and
      // until it succeeds the timeline simply starts from today rather than showing a
      // half-built history.
    }
  }

  // ── v25: where the money came from ─────────────────────────────────────────────
  //
  // A wallet says where money sits (cash, bKash, bank); it cannot say whose money it was.
  // Spending borrowed money and spending your salary look identical in a wallet, and so
  // does repaying one loan with another. `fund_source` records it on money going out
  // (INCOME | LOAN | GIFT | SAVINGS | OTHER), and `fund_account_id` which loan when it was
  // borrowed money. Both are nullable and added only: every existing row keeps exactly what
  // it had, and reads as "source not known" until the person fills it in.
  //
  // It builds on v24, so it runs only once the file actually reached 24. If v24's backfill
  // failed and left the version at 23 (deliberately, so the next launch retries it),
  // stamping 25 here would skip that retry for ever — the file is re-read, not assumed.
  const reachedV24 = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;'))?.user_version ?? 0;
  // A brand-new database skips v24 by design (`currentVersion > 0` above) and stays at 23;
  // only an existing database whose v24 failed is held back.
  const v24Pending = currentVersion > 0 && currentVersion < 24 && reachedV24 < 24;
  // The columns themselves do not wait: finance reads and writes them, and a phone whose
  // backfill keeps failing must still be able to save money. Only the version stamp waits,
  // so the v24 retry is not skipped. The ALTERs are guarded, so adding them early is safe.
  if (currentVersion < 25) {
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(fin_entries)');
    const has = (name: string) => cols.some((c) => c.name === name);
    if (!has('fund_source')) await db.execAsync('ALTER TABLE fin_entries ADD COLUMN fund_source TEXT;');
    if (!has('fund_account_id')) await db.execAsync('ALTER TABLE fin_entries ADD COLUMN fund_account_id TEXT;');
    if (!v24Pending) {
      await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 25, new Date().toISOString());
      await db.execAsync(`PRAGMA user_version = 25;`);
    }
  }

  // ── v26: "other" says what it was ──────────────────────────────────────────────
  //
  // Choosing "অন্যান্য" as where the money came from now lets the person write it down
  // (the user's rule: every "other" has a place to type). One nullable column, added only;
  // like v25, the column is added at once and only the version stamp waits for v25.
  const reachedV25 = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;'))?.user_version ?? 0;
  if (currentVersion < 26) {
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(fin_entries)');
    if (!cols.some((c) => c.name === 'fund_note')) await db.execAsync('ALTER TABLE fin_entries ADD COLUMN fund_note TEXT;');
    if (reachedV25 >= 25) {
      await db.runAsync('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)', 26, new Date().toISOString());
      await db.execAsync(`PRAGMA user_version = 26;`);
    }
  }

  // Deliberately not a trailing, unconditional `PRAGMA user_version = DATABASE_VERSION`
  // here: every block above already stamps its own version the moment it completes, and a
  // catch-all at the end was overwriting that — it forced the version to 24 even on the
  // path just above that intentionally left it at 23 after a failed backfill, silently
  // undoing the retry that failure was supposed to get on the next launch.
}

export { DATABASE_VERSION };
