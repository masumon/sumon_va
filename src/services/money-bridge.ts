// Writing a repayment down once instead of twice.
//
// Most people record a loan payment in both books: once in the debt ledger, because that
// is what reduces the loan, and once in the income and expense book, because the money did
// leave their pocket. Both are correct, and doing both by hand produces two failures — you
// forget one and the books disagree, or you do both and the app double-counts.
//
// So this writes both, as one action, and links them. It is the one file allowed to import
// two modules at once, because bridging them is its entire purpose; everything else still
// goes through the shared money picture. Keeping the coupling in a single named place is
// the difference between a bridge and a tangle.
//
// The two rows are linked through `relations`, so opening either one can show the other,
// and deleting either can offer to remove its twin.

import type { SQLiteDatabase } from 'expo-sqlite';
import { atomic } from '../database/atomic';
import { recordLifeEvent } from './life-event-service';
// The one business-date conversion the whole app shares.
import { businessInstant as anchorDay } from '../i18n/date-time';
import type { Paisa } from './debt/money';
import { parseTakaToPaisa } from './debt/money';
import { createDebtWithTransaction, createReceivableWithTransaction, getPortfolio, getTransactionDetail, recordPayment, recordReceipt, reverseTransaction } from './debt/debt-service';
import { correctTransaction } from './debt/editing';
import { addEntry, deleteEntry, updateEntry, type FinanceEntry, type FundSource, entriesMissingMoneyDetails } from './finance-service';
import { link, listLinks, unlink } from './relation-service';

/** Reserved categories, so a summary can recognise these without guessing at wording. */
export const REPAYMENT_CATEGORY = 'ঋণ পরিশোধ';
export const COLLECTION_CATEGORY = 'পাওনা আদায়';
export const BORROWED_CATEGORY = 'ধার নেওয়া';
export const LENT_CATEGORY = 'ধার দেওয়া';

export interface LinkableAccount {
  id: string;
  direction: 'DEBT' | 'RECEIVABLE';
  personName: string;
  title: string | null;
  outstandingPaisa: Paisa;
}

/**
 * Open accounts, with what is still owed on each.
 *
 * The outstanding figure comes from the ledger's own rows rather than being recalculated
 * here; a second implementation of that arithmetic would eventually disagree with the
 * first, and the ledger is the one that has to be right.
 */
export async function linkableAccounts(db: SQLiteDatabase, direction?: 'DEBT' | 'RECEIVABLE'): Promise<LinkableAccount[]> {
  // This used to compute the outstanding amount with its own SQL, and that SQL subtracted
  // rows of kind 'REPAYMENT' and 'COLLECTION' — kinds this app has never written. It writes
  // PAYMENT and RECEIPT. So nothing was ever subtracted: a debt showed its original amount
  // here no matter how much of it had been repaid, and a debt paid off in full still
  // offered itself as something to pay. It also read principal_paisa alone, so interest,
  // adjustments, settlements and write-offs were all invisible to it.
  //
  // The portfolio already derives every one of those, and it is what the account screen
  // shows. Asking it is the only way this list and that screen can agree.
  const portfolio = await getPortfolio(db, direction ? { direction } : {});
  const nameById = new Map(portfolio.people.map((person) => [person.id, person.name]));
  const accountById = new Map(portfolio.accounts.map((account) => [account.id, account]));

  return portfolio.balances
    .filter((balance) => balance.remainingPaisa > 0)
    .map((balance) => {
      const account = accountById.get(balance.accountId);
      return {
        id: balance.accountId,
        direction: balance.direction,
        personName: (account && nameById.get(account.personId)) ?? '',
        title: account?.title ?? null,
        outstandingPaisa: balance.remainingPaisa,
      };
    })
    .sort((a, b) => b.outstandingPaisa - a.outstandingPaisa);
}

export interface BridgeResult {
  entry: FinanceEntry;
  transactionId: string;
}

/**
 * Pay a debt, and write down that the money left.
 *
 * Order matters: the ledger first, because it is the one that can refuse — an amount
 * larger than the balance, a closed account, a settled installment. Only once it has
 * accepted does the expense get written, so a rejected payment never leaves a phantom
 * expense behind claiming money went somewhere it did not.
 */
/**
 * Paying a debt is one event. The ledger row and the money leaving the wallet commit
 * together — a partial write here meant a debt marked paid out of a pocket still full.
 */
export async function payDebtAndRecordExpense(
  db: SQLiteDatabase,
  input: {
    accountId: string;
    amount: string | number;
    walletId?: string | null;
    occurredAt?: string;
    note?: string | null;
    method?: string | null;
    personId?: string | null;
    /** Whose money went out — repaying, lending. */
    fundSource?: FundSource | null;
    fundAccountId?: string | null;
    fundNote?: string | null;
  },
): Promise<BridgeResult> {
  return atomic(db, () => payDebtAndRecordExpenseWithin(db, input));
}

async function payDebtAndRecordExpenseWithin(
  db: SQLiteDatabase,
  input: {
    accountId: string;
    amount: string | number;
    walletId?: string | null;
    occurredAt?: string;
    note?: string | null;
    method?: string | null;
    personId?: string | null;
    /** Whose money went out — repaying, lending. */
    fundSource?: FundSource | null;
    fundAccountId?: string | null;
    fundNote?: string | null;
  },
): Promise<BridgeResult> {
  const amountPaisa = Math.abs(typeof input.amount === 'number' ? input.amount : parseTakaToPaisa(input.amount));
  if (!amountPaisa) throw new Error('Amount must be more than zero');
  const occurredAt = anchorDay(input.occurredAt);

  const txn = await recordPayment(db, {
    accountId: input.accountId,
    amountPaisa,
    txnDate: occurredAt,
    note: input.note ?? undefined,
  });

  // Repaying is one event with two consequences: the ledger falls and a wallet empties.
  // Naming it here is what stops the month reading the wallet side as ordinary spending.
  const eventId = await recordLifeEvent(db, {
    type: 'REPAY', occurredAt, title: REPAYMENT_CATEGORY,
    personId: input.personId ?? null, destination: 'CREDITOR', purpose: 'OLD_DEBT',
    amountPaisa, note: input.note ?? null,
  }, [{ type: 'DEBT_TRANSACTION', id: txn.id, role: 'LEDGER' }]);

  const entry = await addEntry(db, {
    kind: 'EXPENSE',
    amount: amountPaisa,
    category: REPAYMENT_CATEGORY,
    method: input.method ?? null,
    personId: input.personId ?? null,
    fundSource: input.fundSource ?? null,
    fundAccountId: input.fundAccountId ?? null,
    fundNote: input.fundNote ?? null,
    walletId: input.walletId ?? null,
    occurredAt,
    eventId,
    note: input.note ?? null,
  });

  await link(db,
    { kind: 'FINANCE_ENTRY', id: entry.id },
    { kind: 'DEBT_TRANSACTION', id: txn.id },
  ).catch(() => {
    // The link is a convenience. Both rows are already correct without it, and failing
    // here must not undo a payment the ledger has accepted.
  });

  return { entry, transactionId: txn.id };
}

/**
 * Collect what you are owed, and write down that money arrived.
 *
 * The mirror image, and just as necessary: someone repaying you is income by any honest
 * definition, and a month that ignores it understates what you actually had.
 */
/**
 * Collecting what you are owed is one event, for the same reason as paying one.
 */
export async function collectAndRecordIncome(
  db: SQLiteDatabase,
  input: {
    accountId: string;
    amount: string | number;
    walletId?: string | null;
    occurredAt?: string;
    note?: string | null;
    method?: string | null;
    personId?: string | null;
  },
): Promise<BridgeResult> {
  return atomic(db, () => collectAndRecordIncomeWithin(db, input));
}

async function collectAndRecordIncomeWithin(
  db: SQLiteDatabase,
  input: {
    accountId: string;
    amount: string | number;
    walletId?: string | null;
    occurredAt?: string;
    note?: string | null;
    method?: string | null;
    personId?: string | null;
  },
): Promise<BridgeResult> {
  const amountPaisa = Math.abs(typeof input.amount === 'number' ? input.amount : parseTakaToPaisa(input.amount));
  if (!amountPaisa) throw new Error('Amount must be more than zero');
  const occurredAt = anchorDay(input.occurredAt);

  const txn = await recordReceipt(db, {
    accountId: input.accountId,
    amountPaisa,
    txnDate: occurredAt,
    note: input.note ?? undefined,
  });

  // Money coming back is not earnings, and the event says which it is.
  const eventId = await recordLifeEvent(db, {
    type: 'COLLECT', occurredAt, title: COLLECTION_CATEGORY,
    personId: input.personId ?? null, source: 'RECEIVABLE',
    amountPaisa, note: input.note ?? null,
  }, [{ type: 'DEBT_TRANSACTION', id: txn.id, role: 'LEDGER' }]);

  const entry = await addEntry(db, {
    kind: 'INCOME',
    amount: amountPaisa,
    category: COLLECTION_CATEGORY,
    eventId,
    method: input.method ?? null,
    personId: input.personId ?? null,
    walletId: input.walletId ?? null,
    occurredAt,
    note: input.note ?? null,
  });

  await link(db,
    { kind: 'FINANCE_ENTRY', id: entry.id },
    { kind: 'DEBT_TRANSACTION', id: txn.id },
  ).catch(() => {});

  return { entry, transactionId: txn.id };
}

/**
 * Does this category mean the money went to, or came from, a debt?
 *
 * Matched loosely on purpose. Someone typing "লোন শোধ" or "কিস্তি" means the same thing as
 * the reserved wording, and offering them the account picker is helpful whether or not
 * they chose the exact phrase the app had in mind.
 */
export function looksLikeDebtMovement(category: string): 'DEBT' | 'RECEIVABLE' | null {
  const text = category.trim().toLowerCase();
  if (!text) return null;
  const outward = ['ঋণ পরিশোধ', 'ঋণ শোধ', 'লোন শোধ', 'লোন পরিশোধ', 'কিস্তি', 'দেনা শোধ', 'repay', 'loan payment', 'installment'];
  const inward = ['পাওনা আদায়', 'পাওনা', 'ধার ফেরত', 'টাকা ফেরত', 'collection', 'repaid to me'];
  if (outward.some((word) => text.includes(word.toLowerCase()))) return 'DEBT';
  if (inward.some((word) => text.includes(word.toLowerCase()))) return 'RECEIVABLE';
  return null;
}

/**
 * Does this category mean a *new* debt is being taken on or given out — as opposed to
 * `looksLikeDebtMovement` above, which is about paying down or collecting one that already
 * exists? Kept as a separate check rather than folded into the same one: the two mean
 * opposite UI (pick an existing account vs. open a new one) and conflating them would have
 * offered the wrong picker for whichever wording matched first.
 */
export function looksLikeNewDebtMovement(category: string): 'DEBT' | 'RECEIVABLE' | null {
  const text = category.trim().toLowerCase();
  if (!text) return null;
  const borrowed = ['ধার নেওয়া', 'ধার নিলাম', 'ধার করলাম', 'ঋণ নিলাম', 'ঋণ নেওয়া', 'লোন নিলাম', 'borrowed', 'took a loan'];
  const lent = ['ধার দেওয়া', 'ধার দিলাম', 'ঋণ দিলাম', 'ঋণ দেওয়া', 'লোন দিলাম', 'lent', 'gave a loan'];
  if (borrowed.some((word) => text.includes(word.toLowerCase()))) return 'DEBT';
  if (lent.some((word) => text.includes(word.toLowerCase()))) return 'RECEIVABLE';
  return null;
}

/**
 * Taking on a new debt, or lending money out, recorded from the *money book* side —
 * the mirror of `recordWalletSideOfNewDebt`, which does the same two writes starting from
 * the debt screens. This one opens the account itself (with no interest/instalment terms —
 * those are a debt-module decision, not something a quick money-book entry should have to
 * ask about) and writes the wallet entry in the same breath, atomically, exactly like
 * `payDebtAndRecordExpense`/`collectAndRecordIncome` do for an existing account.
 *
 * The caller is never sent to the new account — `finance/new.tsx` stays on its own save
 * flow, and hands the account id back only so a snackbar can offer it as somewhere to go,
 * not somewhere the save forces you.
 */
export async function openDebtAccountAndRecordEntry(
  db: SQLiteDatabase,
  input: {
    direction: 'DEBT' | 'RECEIVABLE';
    personId: string;
    amount: string | number;
    walletId?: string | null;
    occurredAt?: string;
    note?: string | null;
    /** Whose money went out — repaying, lending. */
    fundSource?: FundSource | null;
    fundAccountId?: string | null;
    fundNote?: string | null;
  },
): Promise<BridgeResult & { accountId: string }> {
  return atomic(db, () => openDebtAccountAndRecordEntryWithin(db, input));
}

async function openDebtAccountAndRecordEntryWithin(
  db: SQLiteDatabase,
  input: {
    direction: 'DEBT' | 'RECEIVABLE';
    personId: string;
    amount: string | number;
    walletId?: string | null;
    occurredAt?: string;
    note?: string | null;
    /** Whose money went out — repaying, lending. */
    fundSource?: FundSource | null;
    fundAccountId?: string | null;
    fundNote?: string | null;
  },
): Promise<BridgeResult & { accountId: string }> {
  const amountPaisa = Math.abs(typeof input.amount === 'number' ? input.amount : parseTakaToPaisa(input.amount));
  if (!amountPaisa) throw new Error('Amount must be more than zero');
  const occurredAt = anchorDay(input.occurredAt);
  const borrowing = input.direction === 'DEBT';

  const create = borrowing ? createDebtWithTransaction : createReceivableWithTransaction;
  const { account, transaction } = await create(db, {
    personId: input.personId,
    principalPaisa: amountPaisa,
    openedDate: occurredAt,
  });

  const eventId = await recordLifeEvent(db, {
    type: borrowing ? 'BORROW' : 'LEND', occurredAt,
    title: borrowing ? BORROWED_CATEGORY : LENT_CATEGORY,
    personId: input.personId,
    source: borrowing ? 'BORROWED' : null,
    destination: borrowing ? null : 'BORROWER',
    amountPaisa, note: input.note ?? null,
  }, [{ type: 'DEBT_TRANSACTION', id: transaction.id, role: 'LEDGER' }]);

  const entry = await addEntry(db, {
    kind: borrowing ? 'INCOME' : 'EXPENSE',
    amount: amountPaisa,
    category: borrowing ? BORROWED_CATEGORY : LENT_CATEGORY,
    personId: input.personId,
    walletId: input.walletId ?? null,
    fundSource: borrowing ? 'LOAN' : (input.fundSource ?? null),
    fundAccountId: borrowing ? null : (input.fundAccountId ?? null),
    fundNote: borrowing ? null : (input.fundNote ?? null),
    occurredAt,
    eventId,
    note: input.note ?? null,
  });

  await link(db,
    { kind: 'FINANCE_ENTRY', id: entry.id },
    { kind: 'DEBT_TRANSACTION', id: transaction.id },
  ).catch(() => {
    // The link is a convenience. Both rows are already correct without it.
  });

  return { entry, transactionId: transaction.id, accountId: account.id };
}


/**
 * The wallet side of a debt movement that was recorded from the debt screens.
 *
 * `payDebtAndRecordExpense` above starts in the money book and writes the ledger too. The
 * debt screens go the other way — they have instalments, sources and references that the
 * money book knows nothing about — so they record the ledger themselves and call this
 * afterwards to write the half that is missing.
 *
 * Without it the two books disagreed in the most ordinary case there is: paying a loan
 * from the debt page reduced the loan and left the wallet untouched, so the money had
 * apparently come from nowhere.
 */
/**
 * The wallet side of a movement the debt ledger has already recorded in this same
 * boundary — so the two halves cannot disagree.
 */
export async function recordWalletSideOfDebtMovement(
  db: SQLiteDatabase,
  input: {
    transactionId: string;
    direction: 'DEBT' | 'RECEIVABLE';
    amountPaisa: Paisa;
    walletId: string;
    occurredAt: string;
    method?: string | null;
    personId?: string | null;
    note?: string | null;
    /** Whose money went out (paying a loan, lending). Borrowing is always LOAN. */
    fundSource?: FundSource | null;
    fundAccountId?: string | null;
    fundNote?: string | null;
  },
): Promise<FinanceEntry> {
  return atomic(db, () => recordWalletSideOfDebtMovementWithin(db, input));
}

async function recordWalletSideOfDebtMovementWithin(
  db: SQLiteDatabase,
  input: {
    transactionId: string;
    direction: 'DEBT' | 'RECEIVABLE';
    amountPaisa: Paisa;
    walletId: string;
    occurredAt: string;
    method?: string | null;
    personId?: string | null;
    note?: string | null;
    /** Whose money went out (paying a loan, lending). Borrowing is always LOAN. */
    fundSource?: FundSource | null;
    fundAccountId?: string | null;
    fundNote?: string | null;
  },
): Promise<FinanceEntry> {
  // Paying a debt takes money out; collecting a receivable brings it in.
  const paying = input.direction === 'DEBT';
  const occurredAt = anchorDay(input.occurredAt);
  const eventId = await recordLifeEvent(db, {
    type: paying ? 'REPAY' : 'COLLECT', occurredAt,
    title: paying ? REPAYMENT_CATEGORY : COLLECTION_CATEGORY,
    personId: input.personId ?? null,
    destination: paying ? 'CREDITOR' : null,
    source: paying ? null : 'RECEIVABLE',
    purpose: paying ? 'OLD_DEBT' : null,
    amountPaisa: input.amountPaisa, note: input.note ?? null,
  }, [{ type: 'DEBT_TRANSACTION', id: input.transactionId, role: 'LEDGER' }]);

  const entry = await addEntry(db, {
    kind: paying ? 'EXPENSE' : 'INCOME',
    amount: input.amountPaisa,
    category: paying ? REPAYMENT_CATEGORY : COLLECTION_CATEGORY,
    method: input.method ?? null,
    personId: input.personId ?? null,
    walletId: input.walletId,
    fundSource: paying ? (input.fundSource ?? null) : null,
    fundAccountId: paying ? (input.fundAccountId ?? null) : null,
    fundNote: paying ? (input.fundNote ?? null) : null,
    occurredAt,
    eventId,
    note: input.note ?? null,
  });

  await link(db,
    { kind: 'FINANCE_ENTRY', id: entry.id },
    { kind: 'DEBT_TRANSACTION', id: input.transactionId },
  ).catch(() => {
    // A convenience, not the record. Both rows are already right without it.
  });

  return entry;
}

/**
 * The wallet side of taking on new debt, or of lending money out.
 *
 * Borrowing puts money in a pocket; lending takes it out. Recorded from the debt screens
 * for the same reason as above.
 */
/**
 * The wallet side of taking on debt, or of lending. One boundary with the ledger row.
 */
export async function recordWalletSideOfNewDebt(
  db: SQLiteDatabase,
  input: {
    transactionId?: string | null;
    direction: 'DEBT' | 'RECEIVABLE';
    amountPaisa: Paisa;
    walletId: string;
    occurredAt: string;
    personId?: string | null;
    note?: string | null;
    /** Whose money went out (paying a loan, lending). Borrowing is always LOAN. */
    fundSource?: FundSource | null;
    fundAccountId?: string | null;
    fundNote?: string | null;
  },
): Promise<FinanceEntry> {
  return atomic(db, () => recordWalletSideOfNewDebtWithin(db, input));
}

async function recordWalletSideOfNewDebtWithin(
  db: SQLiteDatabase,
  input: {
    transactionId?: string | null;
    direction: 'DEBT' | 'RECEIVABLE';
    amountPaisa: Paisa;
    walletId: string;
    occurredAt: string;
    personId?: string | null;
    note?: string | null;
    /** Whose money went out (paying a loan, lending). Borrowing is always LOAN. */
    fundSource?: FundSource | null;
    fundAccountId?: string | null;
    fundNote?: string | null;
  },
): Promise<FinanceEntry> {
  const borrowing = input.direction === 'DEBT';
  const occurredAt = anchorDay(input.occurredAt);
  // Borrowed money arriving in a pocket is not income, and lending is not spending. The
  // event type is what carries that distinction into every later report.
  const eventId = await recordLifeEvent(db, {
    type: borrowing ? 'BORROW' : 'LEND', occurredAt,
    title: borrowing ? BORROWED_CATEGORY : LENT_CATEGORY,
    personId: input.personId ?? null,
    source: borrowing ? 'BORROWED' : null,
    destination: borrowing ? null : 'BORROWER',
    amountPaisa: input.amountPaisa, note: input.note ?? null,
  }, input.transactionId ? [{ type: 'DEBT_TRANSACTION', id: input.transactionId, role: 'LEDGER' }] : []);

  const entry = await addEntry(db, {
    kind: borrowing ? 'INCOME' : 'EXPENSE',
    amount: input.amountPaisa,
    category: borrowing ? BORROWED_CATEGORY : LENT_CATEGORY,
    method: null,
    personId: input.personId ?? null,
    walletId: input.walletId,
    // Borrowed money is loan money from the moment it lands; lending names its source.
    fundSource: borrowing ? 'LOAN' : (input.fundSource ?? null),
    fundAccountId: borrowing ? null : (input.fundAccountId ?? null),
    fundNote: borrowing ? null : (input.fundNote ?? null),
    occurredAt,
    eventId,
    note: input.note ?? null,
  });

  if (input.transactionId) {
    await link(db,
      { kind: 'FINANCE_ENTRY', id: entry.id },
      { kind: 'DEBT_TRANSACTION', id: input.transactionId },
    ).catch(() => {});
  }

  return entry;
}

// ── keeping a linked pair in step after the day it was written ───────────────────────
//
// The three functions above link a wallet entry to a ledger row at the moment both are
// created. None of that holds once either side can change on its own: the debt module
// corrects a ledger row by reversing it and writing a fresh one (never in place — see
// `editing.ts`), and the wallet edits a `fin_entries` row directly. Each of those was
// happening with no idea a linked twin existed, so the twin kept the old figure forever —
// a settled loan whose wallet expense still said the pre-correction amount, or a deleted
// wallet entry whose loan reduction stayed on the books with no money having moved.
//
// These are the four ways a linked pair can drift, one per direction the drift can start
// from. Every one of them is best-effort: the link is a convenience the two sides use to
// stay honest with each other, not the record itself, so a failure here must never undo
// the write that already succeeded on the side that changed first.

/** A debt-side reversal must take the wallet entry riding along with it — it never happened. */
export async function removeFinanceEntryForReversedDebt(db: SQLiteDatabase, transactionId: string): Promise<void> {
  const links = await listLinks(db, { kind: 'DEBT_TRANSACTION', id: transactionId }, 'FINANCE_ENTRY');
  for (const l of links) {
    await deleteEntry(db, l.id).catch(() => {});
  }
}

/**
 * A debt-side correction replaces the ledger row with a new id (see `correctTransaction`),
 * so the linked wallet entry has to both change its amount/date AND move its link to the
 * replacement row — otherwise the next correction can no longer find it.
 */
export async function syncFinanceEntryToDebtCorrection(
  db: SQLiteDatabase,
  oldTransactionId: string,
  replacement: { id: string; amountPaisa: Paisa; txnDate: string },
): Promise<void> {
  const links = await listLinks(db, { kind: 'DEBT_TRANSACTION', id: oldTransactionId }, 'FINANCE_ENTRY');
  for (const l of links) {
    await updateEntry(db, l.id, { amount: replacement.amountPaisa, occurredAt: replacement.txnDate }).catch(() => {});
    await unlink(db, { kind: 'FINANCE_ENTRY', id: l.id }, { kind: 'DEBT_TRANSACTION', id: oldTransactionId }).catch(() => {});
    await link(db, { kind: 'FINANCE_ENTRY', id: l.id }, { kind: 'DEBT_TRANSACTION', id: replacement.id }).catch(() => {});
  }
}

/**
 * The wallet side of a linked pair being corrected: the debt ledger has to move by the
 * same correction, using the ledger's own reverse-and-rewrite rule rather than an in-place
 * edit — a corrected debt amount is still a fact worth keeping the history of.
 */
export async function syncDebtTransactionToFinanceEdit(
  db: SQLiteDatabase, entryId: string, amountPaisa: Paisa, occurredAt: string,
): Promise<void> {
  const links = await listLinks(db, { kind: 'FINANCE_ENTRY', id: entryId }, 'DEBT_TRANSACTION');
  for (const l of links) {
    try {
      const detail = await getTransactionDetail(db, l.id);
      if (!detail || (detail.txn.amountPaisa === amountPaisa && detail.txn.txnDate === occurredAt)) continue;
      const replacement = await correctTransaction(db, l.id, { amountPaisa, txnDate: occurredAt }, occurredAt);
      await unlink(db, { kind: 'FINANCE_ENTRY', id: entryId }, { kind: 'DEBT_TRANSACTION', id: l.id }).catch(() => {});
      await link(db, { kind: 'FINANCE_ENTRY', id: entryId }, { kind: 'DEBT_TRANSACTION', id: replacement.id }).catch(() => {});
    } catch {
      // A reversed or already-closed ledger row cannot be corrected further; the wallet
      // edit the user asked for has already been saved and must not be undone for this.
    }
  }
}

/** Whether a wallet entry is the linked half of a debt payment or collection — for a confirmation dialog to warn about before the delete, not after. */
export async function hasLinkedDebtTransaction(db: SQLiteDatabase, entryId: string): Promise<boolean> {
  const links = await listLinks(db, { kind: 'FINANCE_ENTRY', id: entryId }, 'DEBT_TRANSACTION');
  return links.length > 0;
}

/** The wallet side of a linked pair being deleted: the debt ledger reduction is undone too. */
export async function removeDebtTransactionForDeletedFinanceEntry(db: SQLiteDatabase, entryId: string, date: string): Promise<void> {
  const links = await listLinks(db, { kind: 'FINANCE_ENTRY', id: entryId }, 'DEBT_TRANSACTION');
  for (const l of links) {
    try { await reverseTransaction(db, l.id, date); } catch { /* already reversed — nothing left to undo */ }
  }
}

// ── making old money traceable ─────────────────────────────────────────────────────
//
// Loans entered before every money movement had to name its wallet — a debt imported from
// a spreadsheet, a repayment written without picking a pocket — sit in the ledger with no
// wallet side: the money came from nowhere and went nowhere. These find them and let the
// person give each one its wallet (and, for money going out, its source), one at a time.
// Nothing is ever assigned for them: a guessed wallet is a balance that is quietly wrong.

export interface DebtMoveWithoutWallet {
  transactionId: string;
  accountId: string;
  kind: 'NEW_DEBT' | 'NEW_RECEIVABLE' | 'PAYMENT' | 'RECEIPT';
  amountPaisa: Paisa;
  /** The ledger's own date, 'YYYY-MM-DD'. */
  date: string;
  personId: string | null;
  personName: string;
}

/** Money going out names whose money it was: repaying, lending. */
export const debtMoveNeedsSource = (move: Pick<DebtMoveWithoutWallet, 'kind'>): boolean =>
  move.kind === 'PAYMENT' || move.kind === 'NEW_RECEIVABLE';

/** Money coming in: borrowing, and being paid back. */
export const debtMoveIsIncoming = (move: Pick<DebtMoveWithoutWallet, 'kind'>): boolean =>
  move.kind === 'NEW_DEBT' || move.kind === 'RECEIPT';

/**
 * Live ledger movements of real money that no wallet ever felt. A movement counts as
 * having its wallet side when a live wallet entry is linked to it, shares its life event,
 * or — for loans opened before links were written — is the matching "ধার নেওয়া/দেওয়া"
 * entry for the same person, amount and day. A repayment borrowed straight to the lender
 * never touched a wallet and is not asked about.
 */
export async function debtMovesWithoutWallet(db: SQLiteDatabase): Promise<DebtMoveWithoutWallet[]> {
  return db.getAllAsync<DebtMoveWithoutWallet>(
    `SELECT t.id AS transactionId, t.account_id AS accountId, t.kind, t.amount_paisa AS amountPaisa,
            t.txn_date AS date, a.person_id AS personId, COALESCE(p.name, '') AS personName
       FROM dr_transactions t
       JOIN dr_accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
       LEFT JOIN dr_people p ON p.id = a.person_id
      WHERE t.deleted_at IS NULL AND t.reversed = 0
        AND t.kind IN ('NEW_DEBT', 'NEW_RECEIVABLE', 'PAYMENT', 'RECEIPT')
        AND NOT EXISTS (
          SELECT 1 FROM relations r JOIN fin_entries e ON e.id = r.from_id AND e.deleted_at IS NULL
           WHERE r.from_type = 'FINANCE_ENTRY' AND r.to_type = 'DEBT_TRANSACTION' AND r.to_id = t.id)
        AND NOT EXISTS (
          SELECT 1 FROM life_event_effects x1
            JOIN life_event_effects x2 ON x2.event_id = x1.event_id AND x2.effect_type = 'FINANCE_ENTRY'
            JOIN fin_entries e ON e.id = x2.effect_id AND e.deleted_at IS NULL
           WHERE x1.effect_type = 'DEBT_TRANSACTION' AND x1.effect_id = t.id)
        AND NOT (t.kind IN ('NEW_DEBT', 'NEW_RECEIVABLE') AND EXISTS (
          SELECT 1 FROM fin_entries e
           WHERE e.deleted_at IS NULL AND e.category IN (?, ?) AND e.amount_paisa = t.amount_paisa
             AND substr(e.occurred_at, 1, 10) = t.txn_date AND e.person_id IS a.person_id))
        AND NOT (t.kind = 'PAYMENT' AND COALESCE((
          SELECT SUM(s.amount_paisa) FROM dr_transaction_sources s
           WHERE s.transaction_id = t.id AND s.source_key IN ('BORROWED', 'BANK_LOAN', 'CREDIT')), 0) >= t.amount_paisa)
      ORDER BY t.txn_date ASC, t.id ASC`,
    BORROWED_CATEGORY, LENT_CATEGORY,
  );
}

/**
 * Give an old ledger movement its wallet side — the same writers the debt screens use, so
 * the result is indistinguishable from a movement recorded properly on the day. For a
 * repayment, only the part that left a pocket comes out of the wallet (the part borrowed
 * straight to the lender never sat in one).
 */
export async function attachWalletToDebtMove(
  db: SQLiteDatabase,
  move: DebtMoveWithoutWallet,
  walletId: string,
  source: { fundSource: FundSource | null; fundAccountId?: string | null; fundNote?: string | null } = { fundSource: null },
): Promise<void> {
  const out = debtMoveNeedsSource(move);
  const fundSource = out ? source.fundSource : null;
  const fundAccountId = out && fundSource === 'LOAN' ? (source.fundAccountId ?? null) : null;
  const fundNote = out && fundSource === 'OTHER' ? (source.fundNote ?? null) : null;
  if (move.kind === 'NEW_DEBT' || move.kind === 'NEW_RECEIVABLE') {
    await recordWalletSideOfNewDebt(db, {
      transactionId: move.transactionId, direction: move.kind === 'NEW_DEBT' ? 'DEBT' : 'RECEIVABLE',
      amountPaisa: move.amountPaisa, walletId, occurredAt: move.date, personId: move.personId,
      fundSource, fundAccountId, fundNote,
    });
    return;
  }
  const credit = move.kind === 'PAYMENT'
    ? ((await db.getFirstAsync<{ n: number }>(
      "SELECT COALESCE(SUM(amount_paisa), 0) AS n FROM dr_transaction_sources WHERE transaction_id = ? AND source_key IN ('BORROWED', 'BANK_LOAN', 'CREDIT')",
      move.transactionId,
    ))?.n ?? 0)
    : 0;
  const amountPaisa = move.amountPaisa - credit;
  if (amountPaisa <= 0) return;
  await recordWalletSideOfDebtMovement(db, {
    transactionId: move.transactionId, direction: move.kind === 'PAYMENT' ? 'DEBT' : 'RECEIVABLE',
    amountPaisa, walletId, occurredAt: move.date, personId: move.personId, fundSource, fundAccountId, fundNote,
  });
}

/** How many records still lack a wallet or a source — for the "fix records" door. */
export async function moneyGapCount(db: SQLiteDatabase): Promise<number> {
  const [entries, moves] = await Promise.all([
    entriesMissingMoneyDetails(db).catch(() => []),
    debtMovesWithoutWallet(db).catch(() => []),
  ]);
  return entries.length + moves.length;
}
