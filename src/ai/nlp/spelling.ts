// "কাল সকাব ৯টায় ব্যাংকে যাব" — was that সকাল? Asked, never assumed (the user's request for 1.0).
//
// A one-letter slip in a time, a day or a unit changes what gets saved — a reminder at the
// wrong hour, an amount in the wrong unit. So আপন asks before anything is saved. It asks
// only about those few words, and only where the sentence itself shows what was meant: a
// time word next to a clock time, a day word before a time, a unit right after a number, a
// weekday — and the app's own words (বাজার, ওষুধ, ডাক্তার…) one letter off. Everything else — names, errands, the person's own words — is never "corrected":
// "দোকানের মাল আনতে হবে" keeps its মাল. Nothing is ever changed without a "yes".

import { editDistance } from './lexicon';

export interface SpellingFix { from: string; to: string }
export interface SpellingSuggestion { corrected: string; fixes: SpellingFix[] }

// Every list in one Unicode form (য় can be one letter or য + nukta), the same the text is put in.
const nfc = (xs: string[]) => xs.map((x) => x.normalize('NFC'));
const TIME_WORDS = nfc(['সকাল', 'সকালে', 'দুপুর', 'দুপুরে', 'বিকাল', 'বিকালে', 'বিকেল', 'বিকেলে', 'সন্ধ্যা', 'সন্ধ্যায়', 'রাত', 'রাতে', 'ভোর', 'ভোরে']);
const DAY_WORDS = nfc(['আজকে', 'কালকে', 'আগামীকাল', 'পরশু', 'গতকাল']);
const WEEKDAYS = nfc(['শনিবার', 'রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার']);
const UNITS = nfc(['টাকা', 'মিনিট', 'ঘণ্টা', 'সপ্তাহ']);
// The app's own words — what a task, a spend or a question is about. Asked about anywhere in
// the sentence, but only at one letter off and never for a correctly inflected form.
const KEYWORDS = nfc(['বাজার', 'ওষুধ', 'ডাক্তার', 'খরচ', 'বেতন', 'ভাড়া', 'বিদ্যুৎ', 'রিমাইন্ডার', 'ব্যাংক', 'মিটিং', 'পরীক্ষা', 'হাসপাতাল', 'মানিব্যাগ', 'বিকাশ', 'পাওনা', 'কিস্তি', 'সঞ্চয়', 'ব্যাকআপ', 'মেমোরি', 'পাসওয়ার্ড']);
const KNOWN = new Set([...TIME_WORDS, ...DAY_WORDS, ...WEEKDAYS, ...KEYWORDS, ...WEEKDAYS.map((w) => `${w}ে`), ...UNITS, 'আজ', 'কাল', 'দিন', 'মাস']);

// "৯টায়" in either Unicode form of য় — the phone's JavaScript (Hermes) keeps it as one
// letter where Node splits it, so both are spelled out (rc.14 phone check PH6).
const CLOCK = /^[০-৯\d]{1,2}(?:[:.][০-৯\d]{2})?\s*(?:টা(?:য়|য়)|টা|টার)?$/u;
const NUMBER = /^[০-৯\d][০-৯\d,.]*$/u;
const isBengali = (w: string) => /[ঀ-৿]/u.test(w);

/** The one known word this token is a slip of, or null. Same first letter, one edit away. */
function nearest(token: string, words: readonly string[], maxDistance: number): string | null {
  const hits = words.filter((w) => w[0] === token[0] && Math.abs(w.length - token.length) <= maxDistance && editDistance(token, w) <= maxDistance);
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * The words that look mistyped, with what they probably meant — or null when nothing does.
 * `protectedWords` (people's names, the person's own titles) are never touched.
 */
export function suggestSpelling(text: string, protectedWords: readonly string[] = []): SpellingSuggestion | null {
  const tokens = text.normalize('NFC').split(/(\s+)/u);
  const words = tokens.filter((t) => t.trim());
  const keep = new Set(protectedWords.flatMap((p) => p.normalize('NFC').split(/\s+/u)));
  const fixes: SpellingFix[] = [];
  const at = (i: number) => words[i] ?? '';

  for (let i = 0; i < words.length; i += 1) {
    const raw = words[i]!;
    const word = raw.replace(/[,।.!?]+$/u, '');
    if (!isBengali(word) || word.length < 3 || KNOWN.has(word) || keep.has(word)) continue;
    const next = at(i + 1).replace(/[,।.!?]+$/u, '');
    const prev = at(i - 1);
    let to: string | null = null;
    // "শুক্রবর" — a weekday is long and distinctive enough to stand on its own.
    if (word.length >= 5) to = nearest(word, WEEKDAYS, 1);
    // "সকাব ৯টায়" — a time-of-day word right before a clock time.
    if (!to && (CLOCK.test(next) || NUMBER.test(next))) to = nearest(word, TIME_WORDS, 1);
    // "কালকা সকালে" — a day word right before a time word or a clock time.
    if (!to && (TIME_WORDS.includes(next) || CLOCK.test(next))) to = nearest(word, DAY_WORDS, 1);
    // "৫০০ টকা" — a unit right after a number.
    if (!to && NUMBER.test(prev)) to = nearest(word, UNITS, 1);
    // "বাজর", "ওষধ", "ডাক্তর" — one of the app's own words with one letter off. Never a
    // correctly inflected form of it ("বাজারে", "খরচা", "ব্যাংকে" all start with the word).
    // A three-letter slip is only matched to a longer word ("ওষধ" → ওষুধ), so a real short word
    // like "খরা" is never made into "খরচ".
    if (!to && word.length >= 3 && !KEYWORDS.some((k) => word.startsWith(k))) to = nearest(word, word.length >= 4 ? KEYWORDS : KEYWORDS.filter((k) => k.length >= 4), 1);
    if (to && to !== word) fixes.push({ from: word, to });
  }
  if (!fixes.length) return null;
  let corrected = text.normalize('NFC');
  for (const f of fixes) corrected = corrected.replace(f.from, f.to);
  return { corrected, fixes };
}
