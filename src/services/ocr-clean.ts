// Tidying what the built-in reader (ML Kit) hands back, before it reaches the assistant.
//
// ML Kit reads glyphs one line at a time and makes the same few mistakes on the papers
// people here photograph — prescriptions, receipts, medicine strips: a letter O inside a
// number, a lower-case l or I standing for 1, "500 mg" split as "5OO mg", a word broken
// across two lines with a hyphen. None of these is ambiguous in context, so they are fixed
// here rather than left for the reader to spot (RC.1 QA: OCR quality).

/** A number with letter look-alikes inside it: "5OO", "1O.5", "l20" → "500", "10.5", "120". */
function fixDigitLookalikes(token: string): string {
  // Only a token made of nothing but digits and look-alikes — "Omeprazole" stays a word.
  const digits = (token.match(/\d/gu) ?? []).length;
  const lookalikes = (token.match(/[OoIl|]/gu) ?? []).length;
  if (digits === 0 || lookalikes === 0 || !/^[\dOoIl|.,/:+-]+$/u.test(token)) return token;
  return token.replace(/[Oo]/gu, '0').replace(/[Il|]/gu, '1');
}

export function cleanOcrText(raw: string): string {
  return raw
    .replace(/\r\n?/gu, '\n')
    // "Parace-\ntamol" → "Paracetamol": a word broken at the line end.
    .replace(/([A-Za-z])-\n([a-z])/gu, '$1$2')
    .split('\n')
    .map((line) => line
      .split(/(\s+)/u)
      .map((part) => (/\s/u.test(part) ? part : fixDigitLookalikes(part)))
      .join('')
      // "500mg" / "500 mg" / "500 MG" → "500 mg"; same for ml.
      .replace(/(\d)\s*(mg|ml|mcg|gm?)\b/giu, (_m, d: string, unit: string) => `${d} ${unit.toLowerCase()}`)
      // "1 + 0 + 1" dose pattern kept tight: "1+0+1".
      .replace(/\b([0-2](?:\/2)?)\s*\+\s*([0-2](?:\/2)?)\s*\+\s*([0-2](?:\/2)?)\b/gu, '$1+$2+$3')
      .replace(/[ \t]{2,}/gu, ' ')
      .trim())
    .filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
    .join('\n')
    .trim();
}

/**
 * True when the page probably carried Bengali that the built-in reader skipped: very little
 * came back, or only scattered fragments. Used to explain, plainly, that Bengali needs the
 * user's own AI model — instead of a result that silently leaves half the page out.
 */
export function looksLikeMissedBengali(text: string): boolean {
  const letters = (text.match(/[A-Za-z]/gu) ?? []).length;
  const lines = text.split('\n').filter((l) => l.trim()).length;
  return letters < 12 || (lines > 0 && letters / lines < 4);
}

/**
 * The page's own rows, rebuilt from where each line sits. ML Kit hands a receipt back column
 * by column — every item name, then every price — so "Rice 120" arrives as two far-apart
 * lines (RC.4 QA). Lines whose middles share a row are joined left to right; rows go top to
 * bottom. A tilted photo gains nothing from this, so the caller keeps the plain transcript then.
 */
export interface PlacedLine { text: string; boundingBox: { x: number; y: number; width: number; height: number } }
export function rowsFromLines(lines: readonly PlacedLine[]): string {
  // Two columns of running text (a leaflet, a two-column page): read the left column top to
  // bottom, then the right — joined row by row, their sentences interleaved (rc.13 QA G03).
  // A receipt's price column is short numbers, so it never counts as a column of text here.
  const columns = splitTextColumns(lines.filter((l) => l.text.trim()));
  if (columns) return `${joinRows(columns[0])}\n${joinRows(columns[1])}`;
  return joinRows(lines);
}

function splitTextColumns(lines: readonly PlacedLine[]): [PlacedLine[], PlacedLine[]] | null {
  if (lines.length < 6) return null;
  const right = (l: PlacedLine) => l.boundingBox.x + l.boundingBox.width;
  for (const cut of [...new Set(lines.map((l) => l.boundingBox.x))].sort((a, b) => a - b)) {
    const left = lines.filter((l) => right(l) <= cut);
    const rest = lines.filter((l) => l.boundingBox.x >= cut);
    // Every line on one side of the gutter, none straddling it.
    if (left.length + rest.length !== lines.length || left.length < 3 || rest.length < 3) continue;
    const prose = (side: PlacedLine[]) => side.reduce((n, l) => n + l.text.trim().length, 0) / side.length >= 12;
    const span = (side: PlacedLine[]) => [Math.min(...side.map((l) => l.boundingBox.y)), Math.max(...side.map((l) => l.boundingBox.y + l.boundingBox.height))] as const;
    const [lt, lb] = span(left); const [rt, rb] = span(rest);
    const overlap = Math.min(lb, rb) - Math.max(lt, rt);
    // Side by side on the same stretch of page, and both sides are sentences.
    if (overlap > 0.5 * Math.min(lb - lt, rb - rt) && prose(left) && prose(rest)) return [left, rest];
  }
  return null;
}

function joinRows(lines: readonly PlacedLine[]): string {
  const sorted = lines.filter((l) => l.text.trim()).slice().sort((a, b) => (a.boundingBox.y + a.boundingBox.height / 2) - (b.boundingBox.y + b.boundingBox.height / 2));
  const rows: PlacedLine[][] = [];
  for (const line of sorted) {
    const mid = line.boundingBox.y + line.boundingBox.height / 2;
    const row = rows[rows.length - 1];
    const ref = row?.[0]?.boundingBox;
    if (row && ref && Math.abs(mid - (ref.y + ref.height / 2)) < Math.min(ref.height, line.boundingBox.height) / 2) row.push(line);
    else rows.push([line]);
  }
  return rows.map((row) => row.sort((a, b) => a.boundingBox.x - b.boundingBox.x).map((l) => l.text.trim()).join(' ')).join('\n');
}

/**
 * True when what came back is not words at all — the built-in reader's attempt at a Bengali
 * page ("wWI aIG 1ST.com …"). Real English, numbers and doses are mostly tokens of 3+ letters
 * with a vowel, or numbers; garbage is mostly short scraps, vowel-less runs and mixed symbols.
 */
// Two-letter words and units real receipts and prescriptions use.
const SHORT_WORDS = new Set(['tk', 'mg', 'ml', 'kg', 'gm', 'pc', 'no', 'of', 'to', 'in', 'on', 'at', 'by', 'is', 'it', 'or', 'rs', 'dr', 'mr', 'ms', 'am', 'pm', 'x', 'bd']);
export function looksLikeGarbage(text: string, confidence?: number): boolean {
  // ML Kit's own score for what it read, when it gives one: an English reader facing a
  // Bengali page is unsure of nearly every line.
  if (confidence !== undefined && confidence < 0.55) return true;
  // Words only. Numbers prove nothing — a Bengali page read as Latin still yields digits
  // ("9 013 3663 1465"), and counting them as good let rc.6's garbage through (QA T64).
  const words = text.split(/\s+/u).filter((t) => /[A-Za-z]/u.test(t));
  if (words.length < 3) return false;
  const good = words.filter((t) => {
    if (/[@/]|www\.|\.com|\.bd\b/iu.test(t)) return false;
    const core = t.replace(/^[^A-Za-z]+|[^A-Za-z]+$/gu, '');
    if (SHORT_WORDS.has(core.toLowerCase())) return true;
    if (/^\d+(?:mg|ml|g|kg|tk)$/iu.test(t.replace(/[^A-Za-z0-9]/gu, ''))) return true;
    return /^[A-Za-z][a-z'-]{2,}$|^[A-Z]{2,}$/u.test(core) && /[aeiouyAEIOUY]/u.test(core) && !/[bcdfghjklmnpqrstvwxz]{5,}/iu.test(core);
  });
  return good.length / words.length < 0.6;
}
