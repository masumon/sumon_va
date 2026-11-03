// Turning somebody's real spreadsheet into import rows (spec §73, §75, §76).
//
// People keep this data in wildly different shapes, in Bengali or English, with the
// header two rows down and a "মোট" line at the bottom. So: score every one of the
// first rows as a candidate header, map each column to a field by synonym, and hand
// the UI a mapping it can override column by column. Pure — fully unit-testable.

import type { RawImportRow } from './port-core';
import type { SheetGrid } from './xlsx';

export type FieldKey =
  | 'personName' | 'phone' | 'direction' | 'amount' | 'takenOrGivenDate'
  | 'dueDate' | 'paidAmount' | 'purpose' | 'notes' | 'installment';

export const FIELD_KEYS: FieldKey[] = [
  'personName', 'phone', 'direction', 'amount', 'takenOrGivenDate',
  'dueDate', 'paidAmount', 'purpose', 'notes', 'installment',
];

/**
 * Header classification, in priority order — the first rule that matches wins.
 *
 * Ordering beats scoring on real spreadsheets: a header like "১ম কিস্তি (পরিমাণ)"
 * carries two signals (instalment + amount) and a plain synonym score lets the wrong
 * one win. Reading the signals in order of specificity gets it right every time.
 */
function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/[\s_.:/\()\[\]-]+/g, ' ').trim();
}

const HAS = (h: string, ...words: string[]) => words.some((w) => h.includes(normalise(w)));

const INSTALMENT_WORDS = ['কিস্তি', 'installment', 'instalment', 'emi'];
const DATE_WORDS = ['তারিখ', 'date', 'সাল', 'সময়'];
const DUE_WORDS = ['পরিশোধের', 'ফেরত', 'শেষ', 'নির্ধারিত', 'সম্ভাব্য', 'due', 'deadline', 'return', 'repay', 'maturity'];
const PAID_WORDS = ['পরিশোধিত', 'পরিশোধ', 'আদায়', 'জমা', 'paid', 'repaid', 'received', 'settled'];
const DERIVED_WORDS = ['বাকি', 'অবশিষ্ট', 'remaining', 'balance', 'outstanding', 'due amount'];
const NAME_WORDS = ['নাম', 'ব্যক্তি', 'পাওনাদার', 'দেনাদার', 'লোক', 'name', 'person', 'party', 'borrower', 'lender', 'creditor', 'debtor', 'who'];
const PHONE_WORDS = ['ফোন', 'মোবাইল', 'নম্বর', 'phone', 'mobile', 'cell', 'contact', 'number'];
const DIRECTION_WORDS = ['ধরন', 'প্রকার', 'দেনা/পাওনা', 'দেনা-পাওনা', 'type', 'direction', 'kind'];
const AMOUNT_WORDS = ['পরিমাণ', 'মূল', 'মোট ঋণ', 'ঋণ', 'টাকা', 'মোট', 'amount', 'principal', 'total', 'taka', 'tk', 'loan'];
const PURPOSE_WORDS = ['কারণ', 'উদ্দেশ্য', 'খাত', 'purpose', 'reason', 'category'];
const NOTE_WORDS = ['নোট', 'মন্তব্য', 'বিবরণ', 'note', 'remark', 'comment', 'description', 'detail'];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'জানু', 'ফেব', 'মার্চ', 'এপ্রি', 'মে', 'জুন', 'জুলা', 'আগ', 'সেপ', 'অক্টো', 'নভে', 'ডিসে'];

/** `null` = ignore this column. Returns `undefined` when nothing matches at all. */
export function classifyHeader(header: string): FieldKey | null | undefined {
  const h = normalise(header);
  if (!h) return undefined;

  // An instalment column that holds a *date* carries no amount — ignore it rather than
  // trying to parse "১৬/০৬/২০২৫" as money.
  if (HAS(h, ...INSTALMENT_WORDS)) return HAS(h, ...DATE_WORDS) ? null : 'installment';

  // "বাকি আছে" and friends are derived from the ledger; importing them would double-count.
  if (HAS(h, ...DERIVED_WORDS)) return null;

  if (HAS(h, ...DUE_WORDS)) return 'dueDate';
  if (HAS(h, ...DATE_WORDS)) return 'takenOrGivenDate';
  if (HAS(h, ...PAID_WORDS)) return 'paidAmount';
  if (HAS(h, ...NAME_WORDS)) return 'personName';
  if (HAS(h, ...PHONE_WORDS)) return 'phone';
  if (HAS(h, ...DIRECTION_WORDS)) return 'direction';
  if (HAS(h, ...PURPOSE_WORDS)) return 'purpose';
  if (HAS(h, ...NOTE_WORDS)) return 'notes';
  if (HAS(h, ...AMOUNT_WORDS)) return 'amount';

  // A bare month name or lone number is how people label instalment columns.
  if (/^\d{1,2}$/.test(h) || MONTHS.some((m) => h.startsWith(m))) return 'installment';
  return undefined;
}

/** How strongly a header reads as its class: 3 = exact synonym, 2 = edge, 1 = contains. */
function specificity(header: string, field: FieldKey): number {
  const h = normalise(header);
  const words = field === 'personName' ? NAME_WORDS
    : field === 'phone' ? PHONE_WORDS
      : field === 'direction' ? DIRECTION_WORDS
        : field === 'amount' ? AMOUNT_WORDS
          : field === 'paidAmount' ? PAID_WORDS
            : field === 'purpose' ? PURPOSE_WORDS
              : field === 'notes' ? NOTE_WORDS
                : field === 'dueDate' ? DUE_WORDS
                  : field === 'takenOrGivenDate' ? DATE_WORDS
                    : INSTALMENT_WORDS;
  let best = 0;
  for (const w of words) {
    const n = normalise(w);
    if (h === n) return 3;
    if (h.startsWith(n) || h.endsWith(n)) best = Math.max(best, 2);
    else if (h.includes(n)) best = Math.max(best, 1);
  }
  return best;
}

export interface SheetAnalysis {
  /** Index of the row used as the header, or -1 when the sheet has none. */
  headerRowIndex: number;
  headers: string[];
  /** One entry per column: which field it feeds, or null to ignore the column. */
  mapping: (FieldKey | null)[];
  /** Rows below the header, with blank and "total" lines already dropped. */
  dataRows: string[][];
  /** 0-1: how confidently the header row was recognised. */
  confidence: number;
}

const TOTAL_MARKERS = ['মোট', 'সর্বমোট', 'total', 'sum', 'grand total', 'subtotal'];

function isTotalRow(row: string[]): boolean {
  const first = normalise(row.find((c) => c.trim()) ?? '');
  return TOTAL_MARKERS.some((m) => first === normalise(m) || first.startsWith(`${normalise(m)} `));
}

function isBlankRow(row: string[]): boolean {
  return row.every((c) => !c.trim());
}

/**
 * Classify every column, then make sure a single-use field is claimed by only its
 * strongest column — so a sheet with both "নাম" and "পাওনাদারের নাম" does not map both
 * to the person.
 */
export function mapColumns(headers: string[]): (FieldKey | null)[] {
  const classes = headers.map(classifyHeader);
  const mapping: (FieldKey | null)[] = headers.map(() => null);

  const claimed = new Map<FieldKey, number>();
  headers.forEach((h, col) => {
    const field = classes[col];
    if (field === undefined || field === null) return;
    if (field === 'installment') { mapping[col] = field; return; }
    const held = claimed.get(field);
    if (held === undefined || specificity(h, field) > specificity(headers[held] ?? '', field)) {
      if (held !== undefined) mapping[held] = null;
      claimed.set(field, col);
      mapping[col] = field;
    }
  });
  return mapping;
}

/** Positional fallback for a sheet with no recognisable header row. */
function positionalMapping(width: number): (FieldKey | null)[] {
  const order: (FieldKey | null)[] = ['personName', 'amount', 'takenOrGivenDate', 'direction', 'purpose', 'notes'];
  return Array.from({ length: width }, (_, i) => order[i] ?? 'installment');
}

export function analyseSheet(grid: SheetGrid): SheetAnalysis {
  const scan = Math.min(grid.rows.length, 12);
  let bestRow = -1;
  let bestScore = 0;

  for (let r = 0; r < scan; r += 1) {
    const row = grid.rows[r] ?? [];
    if (isBlankRow(row)) continue;
    // A header row is the one whose cells classify into the most *distinct* fields.
    // Counting distinct fields stops a row of 12 amounts from outscoring a real header.
    const hit = new Set<FieldKey>();
    let recognised = 0;
    for (const cell of row) {
      const field = classifyHeader(cell);
      if (field === undefined) continue;
      recognised += 1;
      if (field !== null) hit.add(field);
    }
    const score = hit.size * 2 + Math.min(recognised, 4);
    if (score > bestScore) { bestScore = score; bestRow = r; }
  }

  // Two solid field hits is the floor — below that we are guessing, and a positional
  // fallback the user can correct beats a confidently wrong mapping.
  const found = bestScore >= 6 && bestRow >= 0;
  const headerRowIndex = found ? bestRow : -1;
  const headers = found ? (grid.rows[bestRow] ?? []) : Array.from({ length: grid.width }, (_, i) => `#${i + 1}`);
  const mapping = found ? mapColumns(headers) : positionalMapping(grid.width);

  const body = grid.rows.slice(found ? bestRow + 1 : 0);
  const dataRows = body.filter((r) => !isBlankRow(r) && !isTotalRow(r));

  return {
    headerRowIndex,
    headers,
    mapping,
    dataRows,
    confidence: found ? Math.min(1, bestScore / 16) : 0,
  };
}

/** Apply a mapping (auto or user-edited) to the data rows. */
export function toRawRows(dataRows: string[][], mapping: (FieldKey | null)[]): RawImportRow[] {
  return dataRows.map((row) => {
    const out: RawImportRow = { installments: [] };
    mapping.forEach((field, col) => {
      if (!field) return;
      const value = (row[col] ?? '').trim();
      if (field === 'installment') { out.installments!.push(value); return; }
      if (!value) return;
      out[field] = value;
    });
    return out;
  });
}

/** Convenience: sheet in, import rows out, using the auto-detected mapping. */
export function sheetToRawRows(grid: SheetGrid): { analysis: SheetAnalysis; raws: RawImportRow[] } {
  const analysis = analyseSheet(grid);
  return { analysis, raws: toRawRows(analysis.dataRows, analysis.mapping) };
}
