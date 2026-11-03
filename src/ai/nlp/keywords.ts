// Deterministic keyword / light-NER extraction for the local assistant.
//
// No model and no network: we drop stop-words and interrogatives, strip the common
// Bengali case/possessive endings ("পাসপোর্টের" → "পাসপোর্ট", "বাসায়" → "বাসা"), and
// keep the salient content words. The retrieval layer uses these to find the memory or
// task that answers a question.

import { normalizeText } from './normalize';

// Words that carry no retrieval signal. Kept lowercase + NFKC (post-normalizeText).
export const STOP_WORDS = new Set<string>([
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does',
  'did', 'of', 'to', 'in', 'on', 'at', 'for', 'and', 'or', 'but', 'my', 'your', 'his', 'her',
  'their', 'our', 'its', 'i', 'you', 'he', 'she', 'they', 'we', 'it', 'me', 'him', 'them',
  'this', 'that', 'these', 'those', 'there', 'here', 'please', 'tell', 'show', 'give', 'get',
  'about', 'from', 'with', 'as', 'by', 'so', 'if', 'then', 'will', 'would', 'can', 'could',
  'should', 'has', 'have', 'had', 'what', 'whats', "what's", 'when', 'where', 'who', 'whom',
  'which', 'why', 'how', 'many', 'much', 'long', 'old', 'again', 'now', 'know', 'let',
  // Bengali
  'আমি', 'আমার', 'আমাকে', 'আমরা', 'আমাদের', 'তুমি', 'তোমার', 'তোমাকে', 'আপনি', 'আপনার',
  'সে', 'তার', 'তারা', 'তাদের', 'এটা', 'এটি', 'ওটা', 'ওই', 'এই', 'সেই', 'ওর', 'তা',
  'কি', 'কী', 'কত', 'কতো', 'কবে', 'কখন', 'কোথায়', 'কোন', 'কোনটা', 'কেন', 'কে', 'কয়', 'কয়টা',
  'কাকে', 'কার', 'হবে', 'হয়', 'হল', 'হলো', 'হচ্ছে', 'ছিল', 'আছে', 'নেই', 'করে', 'করা',
  'এবং', 'ও', 'বা', 'কিন্তু', 'তবে', 'যে', 'যা', 'জন্য', 'থেকে', 'দিয়ে', 'দ্বারা', 'মধ্যে',
  'একটা', 'একটি', 'কিছু', 'দয়া', 'অনুগ্রহ', 'বল', 'বলো', 'বলুন', 'দেখাও', 'দাও', 'জানাও',
  'নাকি', 'তো', 'না', 'হ্যাঁ', 'জানি', 'জানো', 'জানেন',
  // standalone postpositions / particles / connectives that slip through
  'এর', 'তে', 'কে', 'রা', 'কি', 'এ', 'ই', 'য়', 'পর', 'পরে', 'আগে', 'দিন', 'সাল',
  'আর', 'ও', 'এবং', 'তারপর', 'এরপর', 'আরও', 'আরো',
]);

// Bengali case / possessive / classifier endings, longest first so we peel the
// biggest match. Applied only when at least 2 letters remain.
const BN_SUFFIXES = [
  'গুলোতে', 'গুলিতে', 'দেরকে', 'গুলোর', 'গুলির', 'দেরও',
  'য়ের', 'য়ে', 'য়', 'এর', 'ের', 'দের', 'কে', 'তে', 'রা', 'টা', 'টি', 'টার', 'টির',
  'খানা', 'খানি', 'গুলো', 'গুলি', 'র',
];

function stripBengaliSuffix(token: string): string {
  for (const suffix of BN_SUFFIXES) {
    if (token.length > suffix.length + 1 && token.endsWith(suffix)) {
      return token.slice(0, token.length - suffix.length);
    }
  }
  return token;
}

/**
 * Salient content words from free text, in first-seen order. Bengali tokens are also
 * emitted in their suffix-stripped form so "পাসপোর্টের" matches a stored "পাসপোর্ট".
 */
export function extractKeywords(input: string, limit = 8): string[] {
  const normalized = normalizeText(input);
  const raw = normalized
    .split(/[\s,;.!?।:()"'/\\[\]{}–—-]+/u)
    .map((token) => token.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (word: string) => {
    if (word.length < 2 || STOP_WORDS.has(word) || seen.has(word)) return;
    if (/^\d+$/u.test(word) && word.length < 3) return; // keep years/counts, drop "1"/"2"
    seen.add(word);
    out.push(word);
  };

  for (const token of raw) {
    if (STOP_WORDS.has(token)) continue; // don't stem a stop-word into a fake keyword
    // For an inflected Bengali word emit ONLY the stem ("পাসপোর্টের" → "পাসপোর্ট").
    // Emitting both used to double-count one concept and dilute keyword-coverage in
    // retrieval, so a correct note could fall below the acceptance floor.
    if (/[ঀ-৿]/u.test(token)) {
      const stem = stripBengaliSuffix(token);
      if (stem !== token && stem.length >= 2 && !STOP_WORDS.has(stem)) {
        push(stem);
        continue;
      }
    }
    push(token);
  }
  return out.slice(0, limit);
}

/** Coarse question type, used to pick which span of an answer sentence to return. */
export type QuestionType = 'QUANTITY' | 'TIME' | 'PLACE' | 'PERSON' | 'REASON' | 'GENERIC';

export function classifyQuestionType(input: string): QuestionType {
  const t = normalizeText(input);
  // Validity / expiry / renewal questions are about a DATE even when they are phrased
  // with "কত" ("মেয়াদ কত?"). Decide TIME first so the span extractor looks for a
  // date, not a stray number — unless the sentence is clearly about an amount of money.
  if (
    /(?<![\p{L}\p{M}])মেয়াদ(?![\p{L}\p{M}])|\bexpir|\bvalidity\b|\brenew|নবায়ন|রিনিউ/u.test(t) &&
    !/(কত\s*টাকা|how much|\bprice\b|\bfee\b|দাম|ভাড়া|ব্যালেন্স|balance)/u.test(t)
  ) {
    return 'TIME';
  }
  if (/(?<![\p{L}\p{M}])(কত|কতো|কয়|কয়টা|কতটা|কতগুলো)(?![\p{L}\p{M}])|\bhow (many|much|old|long)\b|\bnumber\b/u.test(t)) return 'QUANTITY';
  if (/(?<![\p{L}\p{M}])(কবে|কখন)(?![\p{L}\p{M}])|\bwhen\b|\bwhat (date|time|day|year)\b|\bexpir|\bdue\b|মেয়াদ|তারিখ|সময়/u.test(t)) return 'TIME';
  if (/(?<![\p{L}\p{M}])(কোথায়|কোনখানে)(?![\p{L}\p{M}])|\bwhere\b|ঠিকানা|address|location/u.test(t)) return 'PLACE';
  if (/(?<![\p{L}\p{M}])(কে|কাকে|কার)(?![\p{L}\p{M}])|\bwho\b|\bwhose\b|নাম(?![\p{L}\p{M}])|\bname\b/u.test(t)) return 'PERSON';
  if (/(?<![\p{L}\p{M}])কেন(?![\p{L}\p{M}])|\bwhy\b/u.test(t)) return 'REASON';
  return 'GENERIC';
}
