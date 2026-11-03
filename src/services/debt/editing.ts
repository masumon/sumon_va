// Editing and correcting, for a module whose ledger is append-only.
//
// The rule the whole module rests on: a figure that has already been counted is never
// rewritten in place. So this file splits every edit in two.
//
//   Descriptive fields — a name, a title, a purpose, a note, a priority, a due date —
//   change nothing that was ever added up. They are patched directly, with an audit row
//   recording what they were before.
//
//   Money and dates that ARE counted — a payment's amount, the day it landed, the
//   principal itself — are corrected the way a paper ledger is corrected: the old entry
//   is struck through (reversed, still visible) and a fresh entry written beside it. Both
//   rows stay in the ledger, and `dr_audit` records that the two are a correction pair.
//
// Nothing here deletes history, and nothing here changes a number behind the user's back.

import type { SQLiteDatabase } from 'expo-sqlite';
import { autoAllocate, maybeAutoComplete } from './debt-service';
import * as repo from './repository';
import type { Account, Person, Transaction } from './types';

/** The account fields that carry no arithmetic — safe to write straight to the row. */
export interface AccountDetailsPatch {
  personId?: string;
  title?: string | null;
  purpose?: string | null;
  priority?: Account['priority'];
  notes?: string | null;
  openedDate?: string | null;
  firstDueDate?: string | null;
  finalDueDate?: string | null;
  interestType?: Account['interestType'];
  interestRateBps?: number | null;
  interestPeriod?: Account['interestPeriod'];
  compoundPeriod?: Account['compoundPeriod'];
  interestBasis?: Account['interestBasis'];
  manualTotalPayablePaisa?: number | null;
}

const AUDITED_LABEL: Record<keyof AccountDetailsPatch, string> = {
  personId: 'person', title: 'title', purpose: 'purpose', priority: 'priority', notes: 'notes',
  openedDate: 'openedDate', firstDueDate: 'firstDueDate', finalDueDate: 'finalDueDate',
  interestType: 'interestType', interestRateBps: 'interestRate', interestPeriod: 'interestPeriod',
  compoundPeriod: 'compoundPeriod', interestBasis: 'interestBasis', manualTotalPayablePaisa: 'flatTotal',
};

/**
 * Update an account's descriptive and terms fields, writing one audit row per field that
 * actually moved. Interest terms live here too: changing them re-derives interest from the
 * ledger on the next read, which is exactly what a corrected rate should do — nothing is
 * baked into a stored balance to go stale.
 */
export async function updateAccountDetails(
  db: SQLiteDatabase, accountId: string, patch: AccountDetailsPatch,
): Promise<Account | null> {
  const before = await repo.getAccount(db, accountId);
  if (!before) throw new Error('হিসাব পাওয়া যায়নি / Account not found');

  const changed: Partial<Record<string, unknown>> = {};
  for (const key of Object.keys(patch) as (keyof AccountDetailsPatch)[]) {
    const next = patch[key];
    if (next === undefined) continue;
    const prev = before[key as keyof Account] as unknown;
    const normalised = typeof next === 'string' ? (next.trim() || null) : next;
    if ((prev ?? null) === (normalised ?? null)) continue;
    changed[key] = normalised;
    await repo.writeAudit(db, {
      entityType: 'account', entityId: accountId, field: AUDITED_LABEL[key],
      oldValue: prev === null || prev === undefined ? null : String(prev),
      newValue: normalised === null || normalised === undefined ? null : String(normalised),
      action: 'UPDATE',
    });
  }
  if (!Object.keys(changed).length) return before;

  const after = await repo.patchAccount(db, accountId, changed);
  // Changed terms can flip an account between "clear" and "still owing".
  await maybeAutoComplete(db, accountId, before.openedDate ?? new Date().toISOString());
  return after;
}

/**
 * Correct the principal of an account.
 *
 * Principal is the sum of the account's NEW_DEBT / NEW_RECEIVABLE tranches, so it is
 * corrected the same way any other ledger figure is: reverse the tranches that are there
 * and write one fresh tranche for the corrected amount. The original rows stay visible in
 * the ledger, struck through, which is the whole point — a loan that was recorded as
 * 50,000 and was really 5,000 should show that it was corrected, not pretend it never was.
 */
export async function correctPrincipal(
  db: SQLiteDatabase, accountId: string, newPrincipalPaisa: number, date: string, reason?: string | null,
): Promise<void> {
  const account = await repo.getAccount(db, accountId);
  if (!account) throw new Error('হিসাব পাওয়া যায়নি / Account not found');
  if (!Number.isSafeInteger(newPrincipalPaisa) || newPrincipalPaisa <= 0) {
    throw new Error('মূল টাকার পরিমাণ সঠিক নয় / Principal amount is invalid');
  }
  const kind = account.direction === 'DEBT' ? 'NEW_DEBT' : 'NEW_RECEIVABLE';
  const tranches = (await repo.listAccountTransactions(db, accountId)).filter(
    (t) => t.kind === kind && !t.reversed && !t.deletedAt,
  );
  const current = tranches.reduce((sum, t) => sum + t.amountPaisa, 0) || account.principalPaisa;
  if (current === newPrincipalPaisa) return;

  for (const t of tranches) {
    await repo.markTransactionReversed(db, t.id);
    await repo.insertTransaction(db, {
      kind: 'REVERSAL', accountId, personId: account.personId, amountPaisa: t.amountPaisa,
      txnDate: date, reversesTxnId: t.id, note: reason ?? 'সংশোধন / correction',
    });
  }
  await repo.insertTransaction(db, {
    kind, accountId, personId: account.personId, amountPaisa: newPrincipalPaisa,
    txnDate: account.openedDate ?? date, note: reason ?? 'সংশোধিত মূল টাকা / corrected principal',
  });
  // Keep the cached column in step with the ledger for the no-tranche fallback path.
  await repo.patchAccount(db, accountId, { principalPaisa: newPrincipalPaisa });
  await repo.writeAudit(db, {
    entityType: 'account', entityId: accountId, field: 'principal',
    oldValue: String(current), newValue: String(newPrincipalPaisa), action: 'UPDATE',
  });
  await maybeAutoComplete(db, accountId, date);
}

export interface TransactionCorrection {
  amountPaisa?: number;
  txnDate?: string;
  method?: string | null;
  reference?: string | null;
  note?: string | null;
  /** Where the corrected payment should start landing on the schedule. */
  startInstallmentId?: string | null;
}

/**
 * Correct a ledger row: strike the old one and write the corrected one in its place.
 *
 * The replacement keeps the original's kind and its funding sources, and is re-allocated
 * across the schedule from scratch — an amount that changed has to land somewhere new.
 * Returns the replacement row so the caller can navigate to it.
 */
export async function correctTransaction(
  db: SQLiteDatabase, txnId: string, patch: TransactionCorrection, correctedOn: string,
): Promise<Transaction> {
  const detail = await repo.listLedgerById(db, txnId);
  if (!detail) throw new Error('লেনদেন পাওয়া যায়নি / Transaction not found');
  if (detail.reversed) throw new Error('এটি ইতিমধ্যে বাতিল / Already reversed');
  if (detail.kind === 'REVERSAL') throw new Error('বাতিল সারি সংশোধন করা যায় না / A reversal cannot be corrected');

  const account = await repo.getAccount(db, detail.accountId);
  if (!account) throw new Error('হিসাব পাওয়া যায়নি / Account not found');

  const amountPaisa = patch.amountPaisa ?? detail.amountPaisa;
  if (!Number.isSafeInteger(amountPaisa) || amountPaisa <= 0) throw new Error('পরিমাণ সঠিক নয় / Amount is invalid');
  const txnDate = patch.txnDate ?? detail.txnDate;

  const sources = await repo.listTransactionSources(db, txnId);

  // Strike the original first, so the re-allocation below sees the schedule as it will be.
  await repo.markTransactionReversed(db, txnId);
  await repo.insertTransaction(db, {
    kind: 'REVERSAL', accountId: detail.accountId, personId: detail.personId, amountPaisa: detail.amountPaisa,
    txnDate: correctedOn, reversesTxnId: txnId, note: 'সংশোধনের জন্য বাতিল / reversed for correction',
  });

  const isRepayment = detail.kind === 'PAYMENT' || detail.kind === 'RECEIPT';
  const allocations = isRepayment
    ? await autoAllocate(db, detail.accountId, amountPaisa, patch.startInstallmentId)
    : undefined;

  const replacement = await repo.insertTransaction(db, {
    kind: detail.kind,
    accountId: detail.accountId,
    personId: detail.personId,
    amountPaisa,
    adjSign: detail.adjSign,
    txnDate,
    method: patch.method === undefined ? detail.method : patch.method,
    reference: patch.reference === undefined ? detail.reference : patch.reference,
    note: patch.note === undefined ? detail.note : patch.note,
    allocations,
    // Funding sources are carried over only when the amount is unchanged; they must sum to
    // the payment, and silently rescaling somebody's stated sources would be a lie.
    sources: amountPaisa === detail.amountPaisa
      ? sources.map((s) => ({ sourceKey: s.sourceKey, amountPaisa: s.amountPaisa, linkedAccountId: s.linkedAccountId, note: s.note }))
      : undefined,
  });

  await repo.writeAudit(db, {
    entityType: 'transaction', entityId: txnId, field: 'correction',
    oldValue: `${detail.amountPaisa}@${detail.txnDate}`,
    newValue: `${amountPaisa}@${txnDate}`,
    action: 'UPDATE',
  });
  await maybeAutoComplete(db, detail.accountId, txnDate);
  return replacement;
}

/** Update a person, recording which fields moved. */
export async function updatePersonDetails(
  db: SQLiteDatabase, personId: string,
  patch: { name?: string; phone?: string | null; address?: string | null; relationship?: string | null; notes?: string | null },
): Promise<Person | null> {
  const before = await repo.getPerson(db, personId);
  if (!before) throw new Error('ব্যক্তি পাওয়া যায়নি / Person not found');
  const after = await repo.updatePerson(db, personId, patch);
  if (!after) return null;
  for (const key of ['name', 'phone', 'address', 'relationship', 'notes'] as const) {
    if ((before[key] ?? null) !== (after[key] ?? null)) {
      await repo.writeAudit(db, {
        entityType: 'person', entityId: personId, field: key,
        oldValue: before[key] ?? null, newValue: after[key] ?? null, action: 'UPDATE',
      });
    }
  }
  return after;
}

/** Retire an account, leaving an audit trail behind it. */
export async function deleteAccount(db: SQLiteDatabase, accountId: string, reason?: string | null): Promise<boolean> {
  const account = await repo.getAccount(db, accountId);
  if (!account) return false;
  const ok = await repo.softDeleteAccount(db, accountId);
  if (ok) {
    await repo.writeAudit(db, {
      entityType: 'account', entityId: accountId, field: '*',
      oldValue: account.title ?? account.id, newValue: reason ?? null, action: 'DELETE',
    });
  }
  return ok;
}
