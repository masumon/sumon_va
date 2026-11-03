// Excel/CSV export & import for the debt module (spec §73-§78).
//
// EXPORT is complete: whole-portfolio CSV of accounts, the ledger, or a person statement,
// shared through the OS sheet.
//
// IMPORT is the parsing/normalisation engine + a preview builder. The final column
// mapping is finalised once the user shares a sample of their real spreadsheet; the
// engine already handles the two things the spec calls out — partial dates kept as text
// with a NULL normalised value (§74), and the first few valid installment columns
// pulled out as rows, zero rows skipped (§75).

import type { SQLiteDatabase } from 'expo-sqlite';
import { getPortfolio } from './debt-service';
import { getPersonStatement } from './statements';
import { listLedger, listPeople } from './repository';
import { paisaToTakaString, parseTakaToPaisa } from './money';
import type { Direction } from './types';

// ── CSV helpers ───────────────────────────────────────────────────────────────

function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/u.test(s) ? `"${s.replace(/"/gu, '""')}"` : s;
}
function csvRows(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n');
}

// ── export ────────────────────────────────────────────────────────────────────

export type DebtExportKind = 'accounts' | 'ledger' | 'people';

export async function buildDebtCsv(db: SQLiteDatabase, kind: DebtExportKind): Promise<string> {
  if (kind === 'accounts') {
    const { accounts, balances } = await getPortfolio(db);
    const people = await listPeople(db);
    const nameById = new Map(people.map((p) => [p.id, p.name]));
    const balById = new Map(balances.map((b) => [b.accountId, b]));
    const header = ['id', 'direction', 'person', 'title', 'principal', 'total_payable', 'paid', 'remaining', 'status', 'opened_date', 'next_due', 'overdue', 'purpose', 'interest_type', 'rate_bps'];
    const body = accounts.map((a) => {
      const b = balById.get(a.id);
      return [
        a.id, a.direction, nameById.get(a.personId) ?? '', a.title ?? '',
        paisaToTakaString(a.principalPaisa), paisaToTakaString(b?.totalPayablePaisa ?? 0),
        paisaToTakaString(b?.paidPaisa ?? 0), paisaToTakaString(b?.remainingPaisa ?? 0),
        b?.status ?? a.status, a.openedDate ?? a.openedDateText ?? '', b?.nextDueDate ?? '',
        paisaToTakaString(b?.overduePaisa ?? 0), a.purpose ?? '', a.interestType, a.interestRateBps ?? '',
      ];
    });
    return csvRows([header, ...body]);
  }
  if (kind === 'ledger') {
    const rows = await listLedger(db, { limit: 5000 });
    const header = ['id', 'date', 'kind', 'account_id', 'amount', 'method', 'reference', 'note', 'reversed'];
    const body = rows.map((t) => [t.id, t.txnDate, t.kind, t.accountId, paisaToTakaString(t.amountPaisa), t.method ?? '', t.reference ?? '', t.note ?? '', t.reversed ? '1' : '0']);
    return csvRows([header, ...body]);
  }
  // people
  const people = await listPeople(db);
  const header = ['id', 'name', 'phone', 'address', 'relationship', 'debt_remaining', 'receivable_remaining', 'net_to_you'];
  const body: (string | number | null)[][] = [];
  for (const p of people) {
    const st = await getPersonStatement(db, p.id);
    body.push([p.id, p.name, p.phone ?? '', p.address ?? '', p.relationship ?? '',
      paisaToTakaString(st?.totalDebtRemainingPaisa ?? 0), paisaToTakaString(st?.totalReceivableRemainingPaisa ?? 0), paisaToTakaString(st?.netToYouPaisa ?? 0)]);
  }
  return csvRows([header, ...body]);
}


// ── import: date normalisation (spec §74) ────────────────────────────────────

export interface NormalisedDate {
  iso: string | null;
  originalText: string;
}

/**
 * "15/09/2025" → 2025-09-15. "2025", "2025-2026", "next month", "" → { iso: null, text kept }.
 * Accepts d/m/y, y-m-d, y/m/d and Bengali digits.
 */
export function normaliseDate(input: string | null | undefined): NormalisedDate {
  const originalText = (input ?? '').trim();
  if (!originalText) return { iso: null, originalText };
  const s = originalText.replace(/[০-৯]/gu, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d).toString());

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/u.exec(s);
  if (m) return finish(Number(m[1]), Number(m[2]), Number(m[3]), originalText);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/u.exec(s);
  if (m) return finish(Number(m[3]), Number(m[2]), Number(m[1]), originalText);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/u.exec(s);
  if (m) return finish(2000 + Number(m[3]), Number(m[2]), Number(m[1]), originalText);
  return { iso: null, originalText };
}
function finish(y: number, mo: number, d: number, originalText: string): NormalisedDate {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return { iso: null, originalText };
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return { iso: null, originalText };
  return { iso: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, originalText };
}

// ── import: row model + preview (spec §76, §77) ──────────────────────────────

export interface RawImportRow {
  personName?: string;
  phone?: string;
  direction?: string; // 'DEBT' | 'RECEIVABLE' | bn synonyms
  amount?: string;
  takenOrGivenDate?: string;
  dueDate?: string;
  paidAmount?: string;
  purpose?: string;
  notes?: string;
  installments?: string[]; // amounts as text, in column order
}

export interface ParsedImportRow {
  personName: string;
  phone: string | null;
  direction: Direction;
  principalPaisa: number;
  openedDate: string | null;
  openedDateText: string | null;
  firstDueDate: string | null;
  /** The due-date cell as written, when it could not be read as a real date. */
  firstDueDateText: string | null;
  paidPaisa: number;
  purpose: string | null;
  notes: string | null;
  installmentAmountsPaisa: number[];
  errors: string[];
}

export interface ParseOptions {
  maxInstallments?: number;
  /** Used when the sheet has no direction column at all. */
  defaultDirection?: Direction;
  /**
   * Keep rows whose amount cell is blank or zero, as a ৳0 record. Off by default —
   * but a real sheet often lists a person before the figure is known, and dropping
   * them loses information the user typed on purpose.
   */
  allowZeroAmount?: boolean;
}

/** Excel forces a number to text with a leading ' or ` — strip it off a phone cell. */
function cleanPhone(value: string | undefined): string | null {
  const text = (value ?? '').trim().replace(/^[`']+/, '').trim();
  return text || null;
}

export function parseImportRow(raw: RawImportRow, options: ParseOptions | number = {}): ParsedImportRow {
  const opts: ParseOptions = typeof options === 'number' ? { maxInstallments: options } : options;
  const maxInstallments = opts.maxInstallments ?? 12;
  const fallbackDirection: Direction = opts.defaultDirection ?? 'DEBT';

  const errors: string[] = [];
  const personName = (raw.personName ?? '').trim();
  if (!personName) errors.push('missing person name');

  const dirText = (raw.direction ?? '').trim().toUpperCase();
  const direction: Direction = dirText
    ? (['RECEIVABLE', 'পাওনা', 'GIVEN', 'LEND', 'LOAN GIVEN'].some((k) => dirText.includes(k)) ? 'RECEIVABLE' : 'DEBT')
    : fallbackDirection;

  let principalPaisa = 0;
  try { principalPaisa = parseTakaToPaisa(raw.amount ?? '0'); } catch { errors.push('bad amount'); }
  if (principalPaisa <= 0 && !opts.allowZeroAmount) errors.push('missing amount');

  let paidPaisa = 0;
  try { paidPaisa = raw.paidAmount ? parseTakaToPaisa(raw.paidAmount) : 0; } catch { paidPaisa = 0; }

  const opened = normaliseDate(raw.takenOrGivenDate);
  const due = normaliseDate(raw.dueDate);

  const installmentAmountsPaisa: number[] = [];
  for (const cell of (raw.installments ?? []).slice(0, maxInstallments)) {
    if (!cell || !cell.trim()) continue;
    try {
      const p = parseTakaToPaisa(cell);
      if (p > 0) installmentAmountsPaisa.push(p);
    } catch { /* skip a bad installment cell */ }
  }

  return {
    personName, phone: cleanPhone(raw.phone), direction, principalPaisa,
    openedDate: opened.iso, openedDateText: opened.iso ? null : (opened.originalText || null),
    firstDueDate: due.iso, firstDueDateText: due.iso ? null : (due.originalText || null), paidPaisa,
    purpose: (raw.purpose ?? '').trim() || null, notes: (raw.notes ?? '').trim() || null,
    installmentAmountsPaisa, errors,
  };
}

/**
 * A fingerprint for "this is the same loan". Person, amount and opening date together are
 * specific enough that two genuinely different loans almost never collide, and loose
 * enough that re-importing a corrected spreadsheet still recognises its own rows.
 */
export function accountSignature(personName: string, principalPaisa: number, openedDate: string | null): string {
  return `${personName.trim().toLowerCase()}|${principalPaisa}|${(openedDate ?? '').slice(0, 10)}`;
}

export interface ImportPreview {
  totalRows: number;
  validRows: number;
  newPeople: number;
  duplicatePeople: number;
  /** Rows whose account already exists — pre-unticked so a second import adds nothing. */
  duplicateAccounts: number;
  duplicateAccountIndexes: number[];
  newDebts: number;
  newReceivables: number;
  installments: number;
  invalidDates: number;
  missingAmount: number;
  errorRows: { index: number; errors: string[] }[];
  excelTotalPaisa: number;
  parsedTotalPaisa: number;
}

export function buildImportPreview(
  raws: RawImportRow[],
  existingNames: Set<string>,
  options: ParseOptions = {},
  /** Signatures of the accounts already stored — see {@link accountSignature}. */
  existingAccounts: Set<string> = new Set(),
): { rows: ParsedImportRow[]; preview: ImportPreview } {
  const rows = raws.map((r) => parseImportRow(r, options));
  const seen = new Set<string>();
  const seenAccounts = new Set<string>();
  const p: ImportPreview = {
    totalRows: rows.length, validRows: 0, newPeople: 0, duplicatePeople: 0,
    duplicateAccounts: 0, duplicateAccountIndexes: [],
    newDebts: 0, newReceivables: 0, installments: 0, invalidDates: 0, missingAmount: 0,
    errorRows: [], excelTotalPaisa: 0, parsedTotalPaisa: 0,
  };
  raws.forEach((raw, i) => {
    const row = rows[i]!;
    if (raw.amount) { try { p.excelTotalPaisa += parseTakaToPaisa(raw.amount); } catch { /* ignore */ } }
    p.parsedTotalPaisa += row.principalPaisa;
    if (row.errors.length) { p.errorRows.push({ index: i, errors: row.errors }); if (row.errors.includes('missing amount') || row.errors.includes('bad amount')) p.missingAmount += 1; }
    else p.validRows += 1;
    if (row.openedDateText || (raw.dueDate && !row.firstDueDate)) p.invalidDates += 1;
    if (row.direction === 'DEBT') p.newDebts += 1; else p.newReceivables += 1;
    p.installments += row.installmentAmountsPaisa.length;
    const key = row.personName.toLowerCase();
    if (row.personName) {
      if (existingNames.has(key) || seen.has(key)) p.duplicatePeople += 1;
      else { p.newPeople += 1; seen.add(key); }
    }
    // Already imported? Duplicate people were caught before; duplicate ACCOUNTS were not,
    // so running the same file twice quietly doubled every loan in it.
    if (!row.errors.length && row.personName) {
      const sig = accountSignature(row.personName, row.principalPaisa, row.openedDate);
      if (existingAccounts.has(sig) || seenAccounts.has(sig)) {
        p.duplicateAccounts += 1;
        p.duplicateAccountIndexes.push(i);
      } else {
        seenAccounts.add(sig);
      }
    }
  });
  return { rows, preview: p };
}
