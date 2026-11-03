import { NUMBER_WORDS } from './lexicon';

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';
const ASCII_DIGITS = '0123456789';

export function toAsciiDigits(value: string): string {
  return value.replace(/[০-৯]/g, (digit) => ASCII_DIGITS[BENGALI_DIGITS.indexOf(digit)] ?? digit);
}

/** Replace standalone number words with digits ("three" → "3", "তিনটা" → "3টা"). */
export function numberWordsToDigits(value: string): string {
  let out = value;
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Bengali words carry combining marks; English uses ASCII boundaries.
    const boundary = /^[a-z]/u.test(word) ? `\\b${escaped}\\b` : `(?<![\\p{L}\\p{M}])${escaped}`;
    out = out.replace(new RegExp(boundary, 'giu'), String(digit));
  }
  return out;
}

/** NFKC + Bengali→ASCII digits + smart-quote/dash normalisation + whitespace collapse,
 * WITHOUT lower-casing or number-word expansion. Used to recover the user's original
 * capitalisation for stored content (passwords, names) after the lower-cased pipeline
 * has decided *what* to keep. */
export function normalizeKeepCase(input: string, keepDigits = false): string {
  return (keepDigits ? input : toAsciiDigits(input))
    .normalize('NFKC')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// Invisible joiners some Bangla keyboards put inside "অ্যা" (rc.16 review H06: "অ‍্যাপটা
// কিভাবে চালাবো" went unread). They carry no meaning for understanding a sentence, so the
// matching text drops them — but stored text keeps them: emoji sequences and "র‍্যা" need them.
const JOINERS = /[\u200B-\u200D\uFEFF]/g;

export function normalizeText(input: string): string {
  const base = normalizeKeepCase(input).replace(JOINERS, '').toLocaleLowerCase();
  return numberWordsToDigits(base);
}

/**
 * Re-apply the original capitalisation of `source` onto `lowered` (a cleaned, lower-cased
 * fragment). Matches token-by-token, forward-only, so it survives the cleaner having
 * removed date/time spans or leading verbs. Unmatched tokens keep their lower-cased form.
 */
export function recoverCase(source: string, lowered: string): string {
  const low = lowered.trim();
  if (!low) return low;
  const srcTokens = source.split(/\s+/).filter(Boolean);
  const lowTokens = low.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cursor = 0;
  for (const token of lowTokens) {
    let matched: string | undefined;
    for (let k = cursor; k < srcTokens.length; k += 1) {
      // Compared with digits unified, kept as typed: ১২৩৪ stays ১২৩৪ (RC.4 QA).
      // …and with joiners ignored, so the typed token comes back with them intact.
      if (toAsciiDigits(srcTokens[k]!.toLocaleLowerCase()).replace(JOINERS, '') === token) { matched = srcTokens[k]; cursor = k + 1; break; }
    }
    out.push(matched ?? token);
  }
  return out.join(' ');
}

export function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(/[\s,;!?।:()[\]{}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}
