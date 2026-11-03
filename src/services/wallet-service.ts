// Money is not in one place.
//
// "How much have I got" has never had a single answer: there is cash in a pocket, a bKash
// balance, perhaps a bank account, and they are not interchangeable — you cannot pay an
// electricity bill with cash that is in someone else's hand, and you cannot buy rice at
// the corner shop with a bank balance. A month total that pretends otherwise produces a
// number nobody can act on.
//
// A wallet's balance is derived, never stored. Opening amount, plus everything that came
// in, minus everything that went out — computed on read from the entries themselves. The
// debt ledger learned this the hard way: a stored balance and a list of transactions
// disagree the first time anything is edited, and then neither can be trusted.

import type { SQLiteDatabase } from 'expo-sqlite';
import { atomic } from '../database/atomic';
import { businessInstant } from '../i18n/date-time';
import { parseTakaToPaisa, type Paisa } from './debt/money';
import { TRANSFER_CATEGORY } from './finance-service';
import { recordLifeEvent } from './life-event-service';
import { writeAudit } from './debt/repository';

export type WalletKind = 'CASH' | 'MOBILE' | 'BANK' | 'CARD' | 'OTHER';

export interface Wallet {
  id: string;
  name: string;
  kind: WalletKind;
  openingPaisa: Paisa;
  position: number;
  archivedAt: string | null;
}

export interface WalletBalance extends Wallet {
  /** Opening, plus everything in, minus everything out. */
  balancePaisa: Paisa;
  /** Income and spending — transfers between wallets are not either (rc.6 QA). */
  inPaisa: Paisa;
  outPaisa: Paisa;
  /** Moved in from / out to another wallet. Part of the balance, not income or spending. */
  transferInPaisa: Paisa;
  transferOutPaisa: Paisa;
  entryCount: number;
}

interface WalletRow {
  id: string;
  name: string;
  kind: WalletKind;
  opening_paisa: number;
  position: number;
  archived_at: string | null;
}

const toWallet = (row: WalletRow): Wallet => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  openingPaisa: row.opening_paisa,
  position: row.position,
  archivedAt: row.archived_at,
});

const newId = () => `wallet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export async function listWallets(db: SQLiteDatabase, includeArchived = false): Promise<Wallet[]> {
  const rows = await db.getAllAsync<WalletRow>(
    `SELECT id, name, kind, opening_paisa, position, archived_at FROM wallets
      ${includeArchived ? '' : 'WHERE archived_at IS NULL'}
      ORDER BY position, name`,
  );
  return rows.map(toWallet);
}

export async function createWallet(
  db: SQLiteDatabase,
  input: { name: string; kind?: WalletKind; opening?: string | number },
): Promise<Wallet> {
  const name = input.name.trim();
  if (!name) throw new Error('A wallet needs a name');
  const opening = input.opening === undefined
    ? 0
    : typeof input.opening === 'number' ? input.opening : parseTakaToPaisa(input.opening);
  const id = newId();
  const now = new Date().toISOString();
  const next = await db.getFirstAsync<{ n: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM wallets');
  await db.runAsync(
    `INSERT INTO wallets (id, name, kind, opening_paisa, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, name, input.kind ?? 'OTHER', opening, next?.n ?? 0, now, now,
  );
  return { id, name, kind: input.kind ?? 'OTHER', openingPaisa: opening, position: next?.n ?? 0, archivedAt: null };
}

export async function updateWallet(
  db: SQLiteDatabase,
  id: string,
  patch: { name?: string; kind?: WalletKind; opening?: string | number },
): Promise<void> {
  const row = await db.getFirstAsync<WalletRow>(
    'SELECT id, name, kind, opening_paisa, position, archived_at FROM wallets WHERE id = ?', id,
  );
  if (!row) throw new Error('That wallet no longer exists');
  const opening = patch.opening === undefined
    ? row.opening_paisa
    : typeof patch.opening === 'number' ? patch.opening : parseTakaToPaisa(patch.opening);
  await db.runAsync(
    'UPDATE wallets SET name = ?, kind = ?, opening_paisa = ?, updated_at = ? WHERE id = ?',
    (patch.name ?? row.name).trim(), patch.kind ?? row.kind, opening, new Date().toISOString(), id,
  );
  // An opening-balance edit silently rewrote the wallet's whole running balance — every
  // transaction ever added to it is a delta off this one number — with nothing left to
  // show it had ever been anything else. `dr_audit` is a plain entity/field/old/new log
  // with no foreign key tying it to the debt module specifically; reused here rather than
  // adding a second, near-identical table for the one other place a raw balance changes.
  if (opening !== row.opening_paisa) {
    await writeAudit(db, { entityType: 'wallet', entityId: id, field: 'opening_paisa', oldValue: String(row.opening_paisa), newValue: String(opening), action: 'UPDATE' });
  }
}

/**
 * Put a wallet away without deleting it.
 *
 * Deleting would orphan every entry that pointed at it — the money still moved, and a
 * closed bank account does not un-spend last year's groceries. Archiving hides it from
 * the pickers while every past entry keeps its history.
 */
export async function archiveWallet(db: SQLiteDatabase, id: string, archived = true): Promise<void> {
  await db.runAsync(
    'UPDATE wallets SET archived_at = ?, updated_at = ? WHERE id = ?',
    archived ? new Date().toISOString() : null, new Date().toISOString(), id,
  );
}

/**
 * Every wallet with what is actually in it.
 *
 * Transfers count: money genuinely left one wallet and arrived in another, even though
 * nothing was earned or spent. That is exactly why they are excluded from the income and
 * expense totals but included here.
 */
export async function walletBalances(db: SQLiteDatabase, includeArchived = false): Promise<WalletBalance[]> {
  const wallets = await listWallets(db, includeArchived);
  const sums = await db.getAllAsync<{ wallet_id: string; kind: string; total: number; n: number }>(
    `SELECT wallet_id, CASE WHEN category = '${TRANSFER_CATEGORY}' THEN 'T_' || kind ELSE kind END AS kind,
            SUM(amount_paisa) AS total, COUNT(*) AS n
       FROM fin_entries
      WHERE deleted_at IS NULL AND wallet_id IS NOT NULL
      GROUP BY wallet_id, 2`,
  );

  return wallets.map((wallet) => {
    const inPaisa = sums.find((s) => s.wallet_id === wallet.id && s.kind === 'INCOME')?.total ?? 0;
    const outPaisa = sums.find((s) => s.wallet_id === wallet.id && s.kind === 'EXPENSE')?.total ?? 0;
    const transferInPaisa = sums.find((s) => s.wallet_id === wallet.id && s.kind === 'T_INCOME')?.total ?? 0;
    const transferOutPaisa = sums.find((s) => s.wallet_id === wallet.id && s.kind === 'T_EXPENSE')?.total ?? 0;
    const entryCount = sums
      .filter((s) => s.wallet_id === wallet.id)
      .reduce((total, s) => total + s.n, 0);
    return {
      ...wallet,
      inPaisa,
      outPaisa,
      transferInPaisa,
      transferOutPaisa,
      entryCount,
      balancePaisa: wallet.openingPaisa + inPaisa - outPaisa + transferInPaisa - transferOutPaisa,
    };
  });
}

/**
 * Everything, added up. The one number people mean by "how much have I got".
 *
 * Archived wallets count. Archiving is "stop offering me this in the picker", not "this
 * money no longer exists" — nothing forces a wallet empty before it is put away, so
 * leaving them out made a real balance vanish from the only total anyone reads.
 */
export async function totalOnHand(db: SQLiteDatabase): Promise<Paisa> {
  const [balances, loose] = await Promise.all([walletBalances(db, true), unassignedBalance(db)]);
  return balances.reduce((total, wallet) => total + wallet.balancePaisa, 0) + loose;
}

/**
 * Money written down with no wallet — entries from before wallets existed, or said to আপন
 * without naming one. RC.4 QA: the month card counted these and the wallet total did not,
 * so two screens gave two different "on hand" figures (৳49,600 against ৳39,200). They are
 * real money, so the one on-hand total counts them and shows them as their own line.
 */
export async function unassignedBalance(db: SQLiteDatabase): Promise<Paisa> {
  const row = await db.getFirstAsync<{ inp: number | null; outp: number | null }>(
    `SELECT SUM(CASE WHEN kind = 'INCOME' THEN amount_paisa ELSE 0 END) AS inp,
            SUM(CASE WHEN kind = 'EXPENSE' THEN amount_paisa ELSE 0 END) AS outp
       FROM fin_entries
      WHERE deleted_at IS NULL AND wallet_id IS NULL`,
  );
  return ((row?.inp ?? 0) - (row?.outp ?? 0)) as Paisa;
}

/** The one on-hand figure, with the parts that add up to it. */
export async function onHandBreakdown(db: SQLiteDatabase): Promise<{ wallets: WalletBalance[]; archivedPaisa: Paisa; unassignedPaisa: Paisa; totalPaisa: Paisa }> {
  const [all, loose] = await Promise.all([walletBalances(db, true), unassignedBalance(db)]);
  const wallets = all.filter((w) => !w.archivedAt);
  const archivedPaisa = all.filter((w) => w.archivedAt).reduce((s, w) => s + w.balancePaisa, 0) as Paisa;
  const totalPaisa = (all.reduce((s, w) => s + w.balancePaisa, 0) + loose) as Paisa;
  return { wallets, archivedPaisa, unassignedPaisa: loose, totalPaisa };
}

/**
 * Move money between two wallets.
 *
 * Written as two entries sharing a `transfer_id` — out of one, into the other — under the
 * reserved category every summary already excludes. Nothing was earned and nothing was
 * spent; a transfer counted as both would inflate a month's income and its spending by the
 * same amount, leaving the net right and every percentage wrong.
 */
export async function transfer(
  db: SQLiteDatabase,
  input: { fromWalletId: string; toWalletId: string; amount: string | number; occurredAt?: string; note?: string },
): Promise<string> {
  if (input.fromWalletId === input.toWalletId) throw new Error('A transfer needs two different wallets');
  const amountPaisa = Math.abs(typeof input.amount === 'number' ? input.amount : parseTakaToPaisa(input.amount));
  if (!amountPaisa) throw new Error('Amount must be more than zero');
  // Neither wallet was checked before this wrote two entries pointing at them — an id
  // from a deleted or already-archived wallet (a stale picker, a race with another
  // screen) left `wallet_id` pointing at nothing rather than failing the transfer.
  const [from, to] = await Promise.all([
    db.getFirstAsync<{ id: string }>('SELECT id FROM wallets WHERE id = ?', input.fromWalletId),
    db.getFirstAsync<{ id: string }>('SELECT id FROM wallets WHERE id = ?', input.toWalletId),
  ]);
  if (!from || !to) throw new Error('One of those wallets no longer exists');

  const transferId = `xfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  // `now` is a real instant, for created_at/updated_at. `occurred_at` is a business date —
  // `finance-service.ts`'s addEntry() already draws this line with the same helper; a
  // transfer made a few minutes after midnight Dhaka time defaulting to `now` (a raw UTC
  // instant) landed on the wrong calendar day for anyone west of Dhaka's own clock.
  const occurredAt = input.occurredAt ?? businessInstant();
  const note = input.note?.trim() || null;

  await atomic(db, async () => {
    for (const [kind, walletId] of [['EXPENSE', input.fromWalletId], ['INCOME', input.toWalletId]] as const) {
      const id = `fin-${transferId}-${kind}`;
      await db.runAsync(
        `INSERT INTO fin_entries (id, kind, amount_paisa, category, method, person_id, occurred_at, note, recurring, wallet_id, transfer_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?)`,
        id, kind, amountPaisa, TRANSFER_CATEGORY, occurredAt, note, walletId, transferId, now, now,
      );
      // A transfer made through the migration-v24 backfill got one TRANSFER life event
      // per leg (see migrations.ts) — a transfer made from here on never got one at all,
      // so its own day silently had nothing on the timeline for money that genuinely
      // moved. Matching the backfilled shape keeps old and new transfers reading the same.
      await recordLifeEvent(db, {
        type: 'TRANSFER', occurredAt, title: TRANSFER_CATEGORY, amountPaisa, note,
      }, [{ type: 'FINANCE_ENTRY', id, role: 'MONEY' }]);
    }
  });

  return transferId;
}

/** Undo a transfer, both halves at once. */
export async function undoTransfer(db: SQLiteDatabase, transferId: string): Promise<number> {
  const result = await db.runAsync(
    'UPDATE fin_entries SET deleted_at = ? WHERE transfer_id = ? AND deleted_at IS NULL',
    new Date().toISOString(), transferId,
  );
  return result.changes;
}

/** How a wallet kind reads, and which glyph it wears. */
export function walletLook(kind: WalletKind): { icon: string; bn: string; en: string } {
  switch (kind) {
    case 'CASH': return { icon: 'cash', bn: 'নগদ', en: 'Cash' };
    case 'MOBILE': return { icon: 'cellphone', bn: 'মোবাইল ব্যাংকিং', en: 'Mobile money' };
    case 'BANK': return { icon: 'bank-outline', bn: 'ব্যাংক', en: 'Bank' };
    case 'CARD': return { icon: 'credit-card-outline', bn: 'কার্ড', en: 'Card' };
    default: return { icon: 'wallet-outline', bn: 'অন্যান্য', en: 'Other' };
  }
}
