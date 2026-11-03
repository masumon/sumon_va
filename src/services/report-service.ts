// Turning a screen into a piece of paper.
//
// Every module wanted the same thing — "give me this as a PDF I can send someone" — and
// the tempting shortcut was a print function inside each one. That would have been five
// copies of the same header, the same Bengali font problem, the same share call, drifting
// apart within a month. So there is one builder here and each module hands it a title and
// some rows.
//
// The rendering is plain HTML because that is what the system printer takes. Two details
// carry the weight: the whole page is laid out in `mm` so it comes out the same on any
// phone, and Bengali is left to the device's own font stack rather than a webfont, since
// a PDF is generated offline and a font that has to be downloaded would simply be absent.

import * as Print from 'expo-print';
import { Directory, File, Paths } from 'expo-file-system';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';
import { formatBangladeshDate, formatBangladeshDateTime, type AppLanguage } from '../i18n/date-time';
import { appFolderLabel, appSubfolder, chooseAppFolder, getAppFolder } from './app-folder-service';

/** One line of a report: a label on the left, a value on the right. */
export interface ReportRow { label: string; value: string; muted?: boolean }

/** A block of rows under a heading, optionally as a real table. */
export interface ReportSection {
  heading: string;
  rows?: ReportRow[];
  /** A table, when the data is genuinely columnar — a ledger, a list of visits. */
  table?: { columns: string[]; rows: string[][] };
  note?: string;
}

export interface ReportDocument {
  title: string;
  subtitle?: string;
  /** The headline figures, shown as cards across the top. */
  highlights?: { label: string; value: string }[];
  sections: ReportSection[];
  /** Printed at the foot, under the rule. */
  footnote?: string;
}

const escape = (value: string): string =>
  value.replace(/[&<>"']/gu, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

function renderSection(section: ReportSection): string {
  const rows = section.rows?.length
    ? `<dl class="rows">${section.rows
      .map((r) => `<div class="row${r.muted ? ' muted' : ''}"><dt>${escape(r.label)}</dt><dd>${escape(r.value)}</dd></div>`)
      .join('')}</dl>`
    : '';
  const table = section.table?.rows.length
    ? `<table><thead><tr>${section.table.columns.map((c) => `<th>${escape(c)}</th>`).join('')}</tr></thead>`
      + `<tbody>${section.table.rows
        .map((r) => `<tr>${r.map((cell, i) => `<td${i === 0 ? '' : ' class="num"'}>${escape(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`
    : '';
  const note = section.note ? `<p class="note">${escape(section.note)}</p>` : '';
  if (!rows && !table && !note) return '';
  return `<section><h2>${escape(section.heading)}</h2>${rows}${table}${note}</section>`;
}

/** The document as printable HTML. Exported so it can be tested without a printer. */
export function reportHtml(doc: ReportDocument, language: AppLanguage): string {
  const bn = language === 'bn';
  const printed = formatBangladeshDateTime(new Date(), language);
  const highlights = doc.highlights?.length
    ? `<div class="cards">${doc.highlights
      .map((h) => `<div class="card"><span>${escape(h.label)}</span><strong>${escape(h.value)}</strong></div>`)
      .join('')}</div>`
    : '';
  const body = doc.sections.map(renderSection).join('');
  const madeBy = bn ? 'আপন থেকে তৈরি' : 'Made with Apon';
  const on = bn ? 'তৈরির সময়' : 'Prepared';

  return `<!doctype html><html lang="${bn ? 'bn' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(doc.title)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #14203a; font-size: 10.5pt; line-height: 1.5;
         font-family: -apple-system, "Noto Sans Bengali", "Segoe UI", Roboto, sans-serif; }
  header { border-bottom: 1.4pt solid #0c3c85; padding-bottom: 4mm; margin-bottom: 6mm; }
  h1 { margin: 0; font-size: 17pt; letter-spacing: -0.2pt; }
  .sub { margin: 1.5mm 0 0; color: #56618a; font-size: 10pt; }
  .cards { display: flex; gap: 3mm; margin-bottom: 6mm; flex-wrap: wrap; }
  .card { flex: 1 1 34mm; border: 0.6pt solid #d8deeb; border-radius: 2mm; padding: 3mm; }
  .card span { display: block; color: #56618a; font-size: 8.5pt; }
  .card strong { display: block; margin-top: 1mm; font-size: 13pt; }
  section { margin-bottom: 6mm; break-inside: avoid; }
  h2 { margin: 0 0 2.5mm; font-size: 11pt; color: #0c3c85; }
  .rows { margin: 0; }
  .row { display: flex; justify-content: space-between; gap: 6mm;
         padding: 1.6mm 0; border-bottom: 0.4pt solid #eef1f7; }
  .row.muted { color: #56618a; }
  dt, dd { margin: 0; }
  dd { text-align: right; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 1.6mm 2mm; border-bottom: 0.4pt solid #eef1f7; }
  th { color: #56618a; font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3pt;
       background: #f6f8fc; }
  td.num { text-align: right; }

  /* A ledger runs past one page, and the second page was arriving with no column
     headings on it — every figure in a nameless column. table-header-group is what
     tells the print engine to repeat the head on each page it breaks onto. */
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  /* And a row must not be cut in half by the break itself. */
  tr, .row, .card { break-inside: avoid; page-break-inside: avoid; }
  /* Faint banding, so the eye keeps its place along a wide row of figures. */
  tbody tr:nth-child(even) { background: #fafbfe; }

  /* A section heading stranded at the foot of a page with its table overleaf reads as a
     mistake. Keep it with what it introduces. */
  h2 { break-after: avoid; page-break-after: avoid; }
  .note { margin: 2mm 0 0; color: #56618a; font-size: 9pt; }
  footer { margin-top: 8mm; padding-top: 3mm; border-top: 0.4pt solid #d8deeb;
           color: #56618a; font-size: 8.5pt; display: flex; justify-content: space-between; }
</style></head><body>
<header><h1>${escape(doc.title)}</h1>${doc.subtitle ? `<p class="sub">${escape(doc.subtitle)}</p>` : ''}</header>
${highlights}${body}
<footer><span>${escape(doc.footnote ?? madeBy)}</span><span>${escape(on)}: ${escape(printed)}</span></footer>
</body></html>`;
}

export type ReportResult =
  | { ok: true; uri: string; shared: boolean; saved: boolean; downloaded: boolean; name: string }
  | { ok: false; reason: 'print-failed' | 'nothing-to-report' };

// ── Where a downloaded report goes ──────────────────────────────────────────────────────
//
// "Tap it and it downloads" is one line of intent and a platform problem. Android has not
// let an app write into the public Downloads folder on its own since Android 10; the only
// key is a folder the person hands over through the system picker. There is no permission
// to ask for that would change this, and inventing a native MediaStore module for one PDF
// would be a lot of surface area to maintain offline.
//
// So the first report asks once — with the picker already pointed at Downloads, so it is a
// single tap — and that grant is persisted. Every report after it writes straight into the
// folder with no dialog of any kind, which is what the user actually asked for. The share
// sheet is no longer the default ending; it is the fallback for when there is no folder.
// Reports now live in Apon's own folder (`Apon/Reports`, see app-folder-service), next to
// the backups, instead of a separate folder of their own.
async function rememberedFolder(db: SQLiteDatabase): Promise<string | null> {
  try { return await appSubfolder(db, 'Reports'); } catch { return null; }
}

/** The folder's label, for showing in Settings. `null` when none has been chosen. */
export async function reportFolderName(db: SQLiteDatabase): Promise<string | null> {
  const label = appFolderLabel(await getAppFolder(db));
  return label ? `${label}/Reports` : null;
}

/** Ask for Apon's folder (created if needed). Returns `Apon/Reports`, or null if they backed out. */
export async function chooseReportFolder(db: SQLiteDatabase): Promise<string | null> {
  if (!(await chooseAppFolder(db))) return null;
  try { return await appSubfolder(db, 'Reports'); } catch { return null; }
}

/**
 * Copy the finished PDF into the nominated folder. `false` means it did not get there —
 * no folder, the request was declined, or this is not Android — and the caller should fall
 * back to sharing rather than leaving the person with nothing.
 */
async function downloadReport(db: SQLiteDatabase, fileUri: string, name: string): Promise<boolean> {
  const stem = name.replace(/\.pdf$/iu, '');
  const write = async (folder: string) => {
    const b64 = await new File(fileUri).base64();
    // SAF appends the extension itself from the mime type, hence the stem.
    const target = await StorageAccessFramework.createFileAsync(folder, stem, 'application/pdf');
    await StorageAccessFramework.writeAsStringAsync(target, b64, { encoding: 'base64' });
  };

  const known = await rememberedFolder(db);
  if (known) {
    try { await write(known); return true; } catch { /* the grant may have died — ask below */ }
  }
  // Either nothing was ever chosen, or the folder has been deleted / the card removed /
  // the grant revoked. Asking again beats silently never downloading again.
  const fresh = await chooseReportFolder(db);
  if (!fresh) return false;
  try { await write(fresh); return true; } catch { return false; }
}

/**
 * Build the PDF, keep a private copy, and download it.
 *
 * Two earlier shapes of this function are worth knowing about, because both were wrong in
 * ways that only show up in use:
 *
 * 1. It only shared. `printToFileAsync` writes into the cache, so dismissing the share
 *    sheet — or Android clearing the cache — took the report with it, and there was
 *    nothing to go back to. Hence the private copy, which is kept regardless.
 * 2. It then shared *as the ending*. But a person tapping "PDF report" usually wants the
 *    file, not a list of apps to send it to: the sheet was a dialog standing between them
 *    and the thing they asked for, every single time. So the file is now written into the
 *    folder they nominated once, silently, and the sheet only appears if that is not
 *    possible — which is also the honest signal that they should go and pick a folder.
 *
 * `db` is optional so the report builder stays usable (and testable) without one; without
 * it there is nowhere to remember a folder, and the behaviour is the old share-sheet one.
 */
/** A filesystem-safe stem from a report title, in either script. */
function slugForFile(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]+/gu, '').replace(/\s+/gu, '-').trim();
  return cleaned.slice(0, 60) || 'report';
}

export async function makeAndShareReport(
  doc: ReportDocument, language: AppLanguage, db?: SQLiteDatabase,
): Promise<ReportResult> {
  if (!doc.sections.length && !doc.highlights?.length) return { ok: false, reason: 'nothing-to-report' };
  try {
    const { uri } = await Print.printToFileAsync({ html: reportHtml(doc, language) });

    // A name a person can recognise in a file list, not print-to-file's random hex.
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `${slugForFile(doc.title)}-${stamp}.pdf`;
    let kept = uri;
    let saved = false;
    try {
      const folder = new Directory(Paths.document, 'reports');
      if (!folder.exists) folder.create({ intermediates: true });
      const target = new File(folder, name);
      if (target.exists) target.delete();
      new File(uri).copy(target);
      kept = target.uri;
      saved = true;
    } catch {
      // Keeping it is the bonus; the share sheet is still worth opening either way.
      saved = false;
    }

    // The point of the whole change: the file lands in the folder, and nothing pops up.
    const downloaded = db ? await downloadReport(db, kept, name) : false;

    let shared = false;
    if (!downloaded && await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(kept, { mimeType: 'application/pdf', dialogTitle: doc.title, UTI: 'com.adobe.pdf' });
      shared = true;
    }
    return { ok: true, uri: kept, shared, saved, downloaded, name };
  } catch {
    return { ok: false, reason: 'print-failed' };
  }
}

/** A stable subtitle every report can use: "for September 2026", "as at 6 September". */
export function reportPeriod(language: AppLanguage, opts: { month?: string; asOf?: Date } = {}): string {
  const bn = language === 'bn';
  if (opts.month) {
    const [y, m] = opts.month.split('-').map(Number);
    const label = formatBangladeshDate(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 15)), language);
    // The day is noise in a monthly report; keep the month and the year.
    // Bengali dates carry Bengali digits (date-time.ts), so the day is either kind.
    const trimmed = label.replace(/^[^\d০-৯]*[\d০-৯]+\s*/u, '').trim() || label;
    return bn ? `${trimmed} মাসের হিসাব` : `For ${trimmed}`;
  }
  const day = formatBangladeshDate(opts.asOf ?? new Date(), language);
  return bn ? `${day} পর্যন্ত` : `As at ${day}`;
}
