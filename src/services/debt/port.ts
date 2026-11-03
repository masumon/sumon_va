// The FS/Sharing side of debt export — split from `port-core.ts` (pure engine + CSV
// builders) so tests and the web bundle can use the engine without pulling native FS.

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';
import { buildDebtCsv, type DebtExportKind } from './port-core';
import { formatPersonStatement, getPersonStatement } from './statements';
import { base64ToBytes, readDelimitedSheet, readXlsx, type SheetGrid } from './xlsx';

export * from './port-core';

/** File extensions and mime types we can turn into a sheet grid. */
export const IMPORT_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',
  'text/csv',
  'text/comma-separated-values',
  'text/tab-separated-values',
  'text/plain',
];

/**
 * Read a picked spreadsheet off disk. `.xlsx` comes back as base64 bytes and goes
 * through the unzip reader; everything else is treated as delimited text.
 */
export async function readSheetFile(uri: string, fileName: string): Promise<SheetGrid[]> {
  const isXlsx = /\.xlsx$/i.test(fileName) || /\.xlsm$/i.test(fileName);
  if (isXlsx) {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return readXlsx(base64ToBytes(b64));
  }
  if (/\.xls$/i.test(fileName)) {
    throw new Error('পুরনো .xls সমর্থিত নয় — Excel থেকে .xlsx বা .csv করে দিন / Legacy .xls is not supported — save as .xlsx or .csv');
  }
  const text = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
  return [readDelimitedSheet(text)];
}

export async function shareDebtExport(db: SQLiteDatabase, kind: DebtExportKind): Promise<'shared' | 'unavailable'> {
  const content = await buildDebtCsv(db, kind);
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const uri = `${dir}debt-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  await FileSystem.writeAsStringAsync(uri, content);
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Export debt data', UTI: 'public.comma-separated-values-text' });
  return 'shared';
}

/**
 * Share one person's statement as plain text — the "here is our account" message.
 * Falls back to a file when the platform cannot share a bare string.
 */
export async function sharePersonStatement(
  db: SQLiteDatabase, personId: string, language: 'bn' | 'en' = 'bn',
): Promise<'shared' | 'unavailable' | 'not-found'> {
  const statement = await getPersonStatement(db, personId);
  if (!statement) return 'not-found';
  const text = formatPersonStatement(statement, language);
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const safeName = statement.person.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40) || 'statement';
  const uri = `${dir}${safeName}-${new Date().toISOString().slice(0, 10)}.txt`;
  await FileSystem.writeAsStringAsync(uri, text);
  await Sharing.shareAsync(uri, {
    mimeType: 'text/plain',
    dialogTitle: language === 'bn' ? 'হিসাব পাঠান' : 'Share statement',
    UTI: 'public.plain-text',
  });
  return 'shared';
}


