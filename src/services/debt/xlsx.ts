// A focused .xlsx / .csv sheet reader (spec §73-§77).
//
// Deliberately not SheetJS: we only ever need "give me the visible cell text of a
// sheet, as a grid of strings", and a full spreadsheet library would add far more to
// the APK than this file does. `fflate` (a few KB) does the unzip; the rest is a
// targeted parse of the three XML parts Excel/Google Sheets/LibreOffice all write.
//
// Pure — no filesystem imports — so the jest Web project can exercise it directly.

import { strFromU8, unzipSync } from 'fflate';

export interface SheetGrid {
  name: string;
  /** Row-major cell text. Ragged rows are padded so every row has `width` cells. */
  rows: string[][];
  width: number;
}

// ── shared helpers ────────────────────────────────────────────────────────────

/** "A" -> 0, "Z" -> 25, "AA" -> 26. Returns -1 when the reference has no letters. */
export function columnIndex(ref: string): number {
  let n = 0;
  let seen = false;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) { n = n * 26 + (code - 64); seen = true; }
    else if (code >= 97 && code <= 122) { n = n * 26 + (code - 96); seen = true; }
    else break;
  }
  return seen ? n - 1 : -1;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };

function unescapeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

/**
 * Excel stores dates as a day count from 1899-12-30 (the offset already absorbs the
 * 1900 leap-year bug for every date a person would actually type). Fractional days
 * are the time of day, which we drop — this module only feeds date fields.
 */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2_958_465) return null;
  const ms = Math.round(serial) * 86_400_000 + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 -> bytes. Hand-rolled rather than `atob`, which is not guaranteed on every
 * JS engine this app ships to, and which mangles binary data on some of them.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (acc >> bits) & 0xff;
      at += 1;
    }
  }
  return at === out.length ? out : out.subarray(0, at);
}

// ── xlsx ──────────────────────────────────────────────────────────────────────

/** Builtin numFmt ids that mean "this number is a date/time". */
const DATE_FMT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

function looksLikeDateFormat(code: string): boolean {
  // Strip quoted literals and colour/condition blocks before looking for date tokens,
  // so a currency format like [Red]"Tk"#,##0.00 is never mistaken for a date.
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  return /[dmy]/i.test(bare);
}

/** Style index -> is-a-date, read from xl/styles.xml. */
function dateStyles(xml: string | null): Set<number> {
  const out = new Set<number>();
  if (!xml) return out;
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"[^>]*\/?>/g)) {
    custom.set(Number(m[1]), unescapeXml(m[2] ?? ''));
  }
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  let i = 0;
  for (const m of cellXfs.matchAll(/<xf\b[^>]*>/g)) {
    const id = Number(/numFmtId="(\d+)"/.exec(m[0] ?? '')?.[1] ?? '0');
    const code = custom.get(id);
    if (DATE_FMT_IDS.has(id) || (code !== undefined && looksLikeDateFormat(code))) out.add(i);
    i += 1;
  }
  return out;
}

/** Concatenated <t> text of every <si> in xl/sharedStrings.xml, in order. */
function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const body = m[1] ?? '';
    let text = '';
    for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += unescapeXml(t[1] ?? '');
    out.push(text);
  }
  return out;
}

function sheetNames(xml: string | null): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*>/g)].map((m) => unescapeXml(m[1] ?? ''));
}

function parseSheetXml(xml: string, strings: string[], dateStyleIdx: Set<number>): { rows: string[][]; width: number } {
  const rows: string[][] = [];
  let width = 0;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    // Excel omits empty rows entirely and writes others self-closing, so document order
    // alone would misreport which spreadsheet row a header actually sits on. The `r`
    // attribute is the row's true 1-based number; honour it when present.
    const rowNumber = Number(/r="(\d+)"/.exec(rowMatch[1] ?? '')?.[1] ?? '0');
    if (rowNumber > 0) while (rows.length < rowNumber - 1) rows.push([]);

    const cells: string[] = [];
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const ref = /r="([A-Za-z]+)\d+"/.exec(attrs)?.[1] ?? '';
      const at = ref ? columnIndex(ref) : cells.length;
      const type = /t="([^"]*)"/.exec(attrs)?.[1] ?? 'n';
      const styleIdx = Number(/s="(\d+)"/.exec(attrs)?.[1] ?? '-1');

      let text = '';
      if (type === 'inlineStr') {
        for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += unescapeXml(t[1] ?? '');
      } else {
        const raw = unescapeXml(/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
        if (type === 's') text = strings[Number(raw)] ?? '';
        else if (type === 'b') text = raw === '1' ? 'TRUE' : 'FALSE';
        else if (type === 'e') text = '';
        else if (dateStyleIdx.has(styleIdx) && raw !== '' && Number.isFinite(Number(raw))) text = excelSerialToIso(Number(raw)) ?? raw;
        else text = raw;
      }
      while (cells.length < at) cells.push('');
      cells[at] = text;
    }
    width = Math.max(width, cells.length);
    rows.push(cells);
  }
  for (const r of rows) while (r.length < width) r.push('');
  return { rows, width };
}

/** Read every worksheet out of raw .xlsx bytes. Throws when the file is not a workbook. */
export function readXlsx(bytes: Uint8Array): SheetGrid[] {
  const files = unzipSync(bytes);
  const text = (path: string): string | null => (files[path] ? strFromU8(files[path]) : null);

  const strings = sharedStrings(text('xl/sharedStrings.xml'));
  const dateIdx = dateStyles(text('xl/styles.xml'));
  const names = sheetNames(text('xl/workbook.xml'));

  const paths = Object.keys(files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => Number(/(\d+)/.exec(a)?.[1] ?? 0) - Number(/(\d+)/.exec(b)?.[1] ?? 0));
  if (paths.length === 0) throw new Error('ফাইলে কোনো শিট নেই / No worksheet found in this file');

  return paths.map((p, i) => {
    const { rows, width } = parseSheetXml(strFromU8(files[p]!), strings, dateIdx);
    return { name: names[i] ?? `Sheet${i + 1}`, rows, width };
  });
}

// ── csv / tsv ─────────────────────────────────────────────────────────────────

/** RFC-4180 reader: honours quoted fields containing the delimiter, quotes and newlines. */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  for (const r of rows) while (r.length < width) r.push('');
  return rows;
}

/** Pick , ; or tab by whichever wins on the first non-empty line. */
export function sniffDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length) ?? '';
  const counts: [string, number][] = [[',', 0], [';', 0], ['\t', 0]];
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    for (const c of counts) if (ch === c[0]) c[1] += 1;
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]!;
  return best[1] > 0 ? best[0] : ',';
}

export function readDelimitedSheet(text: string): SheetGrid {
  const rows = parseDelimited(text, sniffDelimiter(text));
  return { name: 'CSV', rows, width: rows[0]?.length ?? 0 };
}
