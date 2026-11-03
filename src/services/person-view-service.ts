// Everything about one human being, gathered from wherever it lives.
//
// Rahim is currently spread across four places: a row in `people`, some accounts in the
// debt ledger, some entries in the income and expense book, and a list of times you rang
// him. Nobody thinks of a person that way. They think "how do I stand with Rahim" — and
// answering that means one screen that can see all four.
//
// The gathering is done here rather than in the screen, and it is done defensively: any
// one source failing returns nothing for that source rather than emptying the page. A
// module that has not been built yet contributes nothing and breaks nothing.

import type { SQLiteDatabase } from 'expo-sqlite';
import type { Paisa } from './debt/money';
import { getPerson, type Person } from './people-service';
import { listFollowUps, type FollowUp } from './follow-up-service';
import { listEntries, type FinanceEntry } from './finance-service';

/** One thing that happened with this person, whichever module recorded it. */
export interface PersonEvent {
  id: string;
  /** Which module this came from, so the row can be labelled and routed. */
  source: 'debt' | 'finance' | 'followUp';
  at: string;
  title: string;
  subtitle?: string;
  /** Positive means money towards you, negative away. Absent when it is not about money. */
  amountPaisa?: Paisa;
  route?: string;
}

export interface PersonStanding {
  person: Person;
  /** What they owe you, less what you owe them. Positive means they owe you. */
  netPaisa: Paisa;
  theyOwePaisa: Paisa;
  youOwePaisa: Paisa;
  /** Money from them, and money to them, recorded in the income and expense book. */
  receivedPaisa: Paisa;
  givenPaisa: Paisa;
  openAccounts: number;
  lastContact: FollowUp | null;
  contactCount: number;
  events: PersonEvent[];
}

interface DebtRow {
  id: string;
  direction: string;
  title: string | null;
  principal_paisa: number;
  closed_at: string | null;
  created_at: string;
}

interface TxnRow {
  id: string;
  account_id: string;
  kind: string;
  amount_paisa: number;
  txn_date: string;
  note: string | null;
}

/**
 * Everything known about one person, newest event first.
 *
 * The balances come from the debt ledger's own rows rather than being recomputed here —
 * the ledger is the single source of truth for what is owed, and a second implementation
 * of that arithmetic would eventually disagree with the first.
 */
export async function personStanding(db: SQLiteDatabase, personId: string): Promise<PersonStanding | null> {
  const person = await getPerson(db, personId);
  if (!person) return null;

  const standing: PersonStanding = {
    person,
    netPaisa: 0,
    theyOwePaisa: 0,
    youOwePaisa: 0,
    receivedPaisa: 0,
    givenPaisa: 0,
    openAccounts: 0,
    lastContact: null,
    contactCount: 0,
    events: [],
  };

  // ── what the debt ledger knows ─────────────────────────────────────────────
  try {
    const accounts = await db.getAllAsync<DebtRow>(
      `SELECT id, direction, title, principal_paisa, closed_at, created_at
         FROM dr_accounts WHERE person_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
      personId,
    );
    for (const account of accounts) {
      if (!account.closed_at) standing.openAccounts += 1;
      standing.events.push({
        id: `acc-${account.id}`,
        source: 'debt',
        at: account.created_at,
        title: account.title?.trim() || (account.direction === 'RECEIVABLE' ? 'পাওনা' : 'দেনা'),
        subtitle: account.closed_at ? 'শেষ' : 'চলমান',
        amountPaisa: account.direction === 'RECEIVABLE' ? account.principal_paisa : -account.principal_paisa,
        route: `/debt/account/${account.id}`,
      });
    }

    // Outstanding, from the ledger's own view of each account.
    const balances = await db.getAllAsync<{ direction: string; outstanding: number }>(
      `SELECT a.direction,
              a.principal_paisa - COALESCE((
                SELECT SUM(t.amount_paisa) FROM dr_transactions t
                 WHERE t.account_id = a.id AND t.deleted_at IS NULL
                   AND t.kind IN ('REPAYMENT','COLLECTION')
              ), 0) AS outstanding
         FROM dr_accounts a
        WHERE a.person_id = ? AND a.deleted_at IS NULL AND a.closed_at IS NULL`,
      personId,
    );
    for (const row of balances) {
      const left = Math.max(0, row.outstanding);
      if (row.direction === 'RECEIVABLE') standing.theyOwePaisa += left;
      else standing.youOwePaisa += left;
    }

    const txns = await db.getAllAsync<TxnRow>(
      `SELECT id, account_id, kind, amount_paisa, txn_date, note
         FROM dr_transactions WHERE person_id = ? AND deleted_at IS NULL
        ORDER BY txn_date DESC LIMIT 40`,
      personId,
    );
    for (const txn of txns) {
      standing.events.push({
        id: `txn-${txn.id}`,
        source: 'debt',
        at: txn.txn_date,
        title: txn.kind,
        subtitle: txn.note ?? undefined,
        amountPaisa: txn.kind === 'COLLECTION' ? txn.amount_paisa : -txn.amount_paisa,
        route: `/debt/txn/${txn.id}`,
      });
    }
  } catch {
    // No debt module on this database, or its tables are older. The rest still shows.
  }

  // ── what the income and expense book knows ────────────────────────────────
  try {
    const entries: FinanceEntry[] = await listEntries(db, { personId, limit: 40 });
    for (const entry of entries) {
      if (entry.kind === 'INCOME') standing.receivedPaisa += entry.amountPaisa;
      else standing.givenPaisa += entry.amountPaisa;
      standing.events.push({
        id: `fin-${entry.id}`,
        source: 'finance',
        at: entry.occurredAt,
        title: entry.category,
        subtitle: [entry.method, entry.note].filter(Boolean).join(' · ') || undefined,
        amountPaisa: entry.kind === 'INCOME' ? entry.amountPaisa : -entry.amountPaisa,
        route: `/finance/new?id=${entry.id}`,
      });
    }
  } catch {
    // Same again: a missing module is silence, not a failure.
  }

  // ── when they were last chased, and how often ─────────────────────────────
  try {
    const follows = await listFollowUps(db, 'PERSON', personId);
    standing.contactCount = follows.length;
    standing.lastContact = follows[0] ?? null;
    for (const follow of follows.slice(0, 20)) {
      standing.events.push({
        id: `fu-${follow.id}`,
        source: 'followUp',
        at: follow.happenedAt,
        title: follow.channel,
        subtitle: follow.note ?? undefined,
      });
    }
  } catch {
    standing.contactCount = 0;
  }

  standing.netPaisa = standing.theyOwePaisa - standing.youOwePaisa;
  standing.events.sort((a, b) => b.at.localeCompare(a.at));
  return standing;
}

/**
 * Everyone the app knows, with enough to sort a list by.
 *
 * Ordered by how much is outstanding rather than alphabetically: a list of names is a
 * directory, but a list of standings is an answer to "who do I need to deal with".
 */
export interface PersonSummary {
  id: string;
  name: string;
  phone: string | null;
  netPaisa: Paisa;
  openAccounts: number;
  lastContactAt: string | null;
}

export async function listPeopleWithStanding(db: SQLiteDatabase, search = ''): Promise<PersonSummary[]> {
  const term = search.trim();
  const like = `%${term}%`;
  const rows = await db.getAllAsync<{
    id: string; name: string; phone: string | null;
    they_owe: number | null; you_owe: number | null; open_accounts: number | null; last_contact: string | null;
  }>(
    `SELECT p.id, p.name, p.phone,
            (SELECT COALESCE(SUM(a.principal_paisa - COALESCE((
                SELECT SUM(t.amount_paisa) FROM dr_transactions t
                 WHERE t.account_id = a.id AND t.deleted_at IS NULL AND t.kind IN ('REPAYMENT','COLLECTION')
              ), 0)), 0)
               FROM dr_accounts a
              WHERE a.person_id = p.id AND a.deleted_at IS NULL AND a.closed_at IS NULL
                AND a.direction = 'RECEIVABLE') AS they_owe,
            (SELECT COALESCE(SUM(a.principal_paisa - COALESCE((
                SELECT SUM(t.amount_paisa) FROM dr_transactions t
                 WHERE t.account_id = a.id AND t.deleted_at IS NULL AND t.kind IN ('REPAYMENT','COLLECTION')
              ), 0)), 0)
               FROM dr_accounts a
              WHERE a.person_id = p.id AND a.deleted_at IS NULL AND a.closed_at IS NULL
                AND a.direction <> 'RECEIVABLE') AS you_owe,
            (SELECT COUNT(*) FROM dr_accounts a
              WHERE a.person_id = p.id AND a.deleted_at IS NULL AND a.closed_at IS NULL) AS open_accounts,
            (SELECT MAX(f.happened_at) FROM follow_ups f
              WHERE f.owner_type = 'PERSON' AND f.owner_id = p.id) AS last_contact
       FROM people p
      WHERE p.deleted_at IS NULL ${term ? 'AND (p.name LIKE ? OR p.phone LIKE ?)' : ''}
      ORDER BY p.name`,
    ...(term ? [like, like] : []),
  );

  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      netPaisa: Math.max(0, row.they_owe ?? 0) - Math.max(0, row.you_owe ?? 0),
      openAccounts: row.open_accounts ?? 0,
      lastContactAt: row.last_contact,
    }))
    // Anyone with money between you comes first, largest first; then the rest by name.
    .sort((a, b) => {
      const weight = Math.abs(b.netPaisa) - Math.abs(a.netPaisa);
      return weight !== 0 ? weight : a.name.localeCompare(b.name);
    });
}
