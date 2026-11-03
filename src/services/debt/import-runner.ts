// Writing a reviewed import into the ledger (spec §76, §78).
//
// Runs only after the user has seen the preview: one account per valid row, people
// matched case-insensitively so re-importing the same sheet does not clone everybody,
// and any "already paid" column replayed as a real PAYMENT/RECEIPT so the derived
// balance stays the single source of truth.

import type { SQLiteDatabase } from 'expo-sqlite';
import { atomic } from '../../database/atomic';
import { createDebt, createReceivable, recordPayment, recordReceipt } from './debt-service';
import * as repo from './repository';
import type { ParsedImportRow } from './port-core';
import { bangladeshDateKey } from '../../i18n/date-time';

export interface ImportResult {
  peopleCreated: number;
  peopleReused: number;
  accountsCreated: number;
  installmentsCreated: number;
  paymentsRecorded: number;
  skipped: number;
  failures: { index: number; message: string }[];
}

export interface ImportOptions {
  /** Rows the user unticked in the preview, by index into `rows`. */
  skipIndexes?: Set<number>;
  /** Stamped onto every created account so an import can be recognised later. */
  sourceLabel?: string;
}

export async function applyImport(db: SQLiteDatabase, rows: ParsedImportRow[], opts: ImportOptions = {}): Promise<ImportResult> {
  const result: ImportResult = {
    peopleCreated: 0, peopleReused: 0, accountsCreated: 0,
    installmentsCreated: 0, paymentsRecorded: 0, skipped: 0, failures: [],
  };

  // One lookup up front; new people are folded in as they are created so two rows
  // naming the same person share one record.
  const byName = new Map<string, string>();
  for (const p of await repo.listPeople(db)) byName.set(p.name.trim().toLowerCase(), p.id);

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (opts.skipIndexes?.has(i) || row.errors.length) { result.skipped += 1; continue; }

    const key = row.personName.trim().toLowerCase();
    const reusedPersonId = byName.get(key);

    try {
      // One row's person + account + installments + opening payment is one unit: a sheet
      // that names a payment already made says so as a single fact, and a mid-row failure
      // (say, the payment step rejecting an amount) used to leave the account it belonged
      // to sitting in the database anyway — reported as a "failure" for that row while a
      // half-true version of it had already been committed. Rolling the whole row back
      // together makes "failure" mean nothing was written, which is what it already
      // claimed for every OTHER kind of failure here.
      const outcome = await atomic(db, async () => {
        let personId = reusedPersonId;
        let personCreated = false;
        if (!personId) {
          const person = await repo.createPerson(db, { name: row.personName.trim(), phone: row.phone });
          personId = person.id;
          personCreated = true;
        }

        const installments = row.installmentAmountsPaisa.map((amountPaisa, idx) => ({
          seq: idx + 1,
          dueDate: null,
          amountPaisa,
        }));

        const input = {
          personId,
          title: row.purpose ?? null,
          principalPaisa: row.principalPaisa,
          openedDate: row.openedDate,
          openedDateText: row.openedDateText,
          firstDueDate: row.firstDueDate,
          purpose: row.purpose,
          // Dates the sheet wrote in a form we cannot read (e.g. "2025", "২০২৫-২০২৬")
          // are kept verbatim on the record rather than thrown away.
          notes: [
            row.notes,
            row.openedDateText ? `তারিখ: ${row.openedDateText}` : null,
            row.firstDueDateText ? `ফেরতের তারিখ: ${row.firstDueDateText}` : null,
            opts.sourceLabel,
          ].filter(Boolean).join(' · ') || null,
          interestType: 'NONE' as const,
          ...(installments.length ? { installments } : {}),
        };

        const account = row.direction === 'DEBT' ? await createDebt(db, input) : await createReceivable(db, input);

        let paymentRecorded = false;
        if (row.paidPaisa > 0) {
          const txnDate = row.openedDate ?? bangladeshDateKey(new Date());
          if (row.direction === 'DEBT') await recordPayment(db, { accountId: account.id, amountPaisa: row.paidPaisa, txnDate });
          else await recordReceipt(db, { accountId: account.id, amountPaisa: row.paidPaisa, txnDate });
          paymentRecorded = true;
        }

        return { personId, personCreated, installmentsCount: installments.length, paymentRecorded };
      });

      if (outcome.personCreated) { byName.set(key, outcome.personId); result.peopleCreated += 1; }
      else result.peopleReused += 1;
      result.accountsCreated += 1;
      result.installmentsCreated += outcome.installmentsCount;
      if (outcome.paymentRecorded) result.paymentsRecorded += 1;
    } catch (e) {
      result.failures.push({ index: i, message: e instanceof Error ? e.message : String(e) });
    }
  }

  return result;
}
